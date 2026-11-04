/**
 * Fabrication d'une archive de sauvegarde (lot 50) : instantané cohérent de la base, originaux des médias, polices,
 * manifest.json ; écriture en flux dans un .tmp puis renommage atomique ; rotation APRÈS l'écriture complète.
 *
 * Ce qui entre dans l'archive (lot 85 : PAR EXCLUSION, pas par liste) :
 *  - portfolio.db : copie par l'API de sauvegarde de SQLite (better-sqlite3 `.backup`), jamais une copie du fichier en
 *    écriture ; prise pendant que le site tourne, sans verrou d'écriture.
 *  - media/ : TOUT le stockage, SAUF ce qui est prouvé régénérable :
 *      · les variantes img/, vid/ et doc/ d'un média dont l'original est présent (le worker les refait : restore.ts) ;
 *      · icons-auto/ (icônes « automatiques », refaites à la première requête) ;
 *      · tmp/, cache/, kit-imports/, backup/ et les restes d'écriture *.tmp.
 *    Un dossier que personne n'a prévu est donc sauvegardé par défaut. Y entrent notamment originals/ (envois), kit/ (dessins du
 *    kit appliqués aux thèmes, logo, cadres importés, fichiers d'une archive de thème importée), icons/ (icône du site en mode
 *    image), les variantes d'un média SANS original (vidéo dont l'original est supprimé après conversion) et les médias du seed.
 *  - cache/kits/manifests : fiches et aperçus des kits exportés (l'import d'un PSD retouché en a besoin : seule exception à cache/).
 *  - BACKUP_MEDIA=0 : base, polices, kit/, icons/ et fiches de kit seulement.
 *  - fonts/ : polices installées (téléchargées depuis Google à l'installation ; quelques centaines de Ko).
 *  - manifest.json (premier fichier) : compte les fichiers par catégorie et signale toute référence /media/… de la base dont le
 *    fichier n'est ni dans l'archive ni régénérable (refs.ts) : garde-fou contre un futur oubli, jamais bloquant.
 */
import { createWriteStream } from "node:fs";
import { mkdir, open, readdir, rename, rm, stat, statfs } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { constants as zc, createGzip, gunzipSync } from "node:zlib";

import Database from "better-sqlite3";

import type { BackupConfig } from "./config";
import { isRegenerableKey, mediaRefsInDb, otherCitedNames, regenerableDirs, variantKeys } from "./refs";
import { archiveName, retentionPlan, sortArchives, type DueReason } from "./schedule";
import { isSafeEntryName, tarChunks, type TarEntry, type TarReport } from "./tar";

export const BACKUP_DIRNAME = "backup";
/** Marge d'espace libre exigée en plus du poids brut de ce qui part dans l'archive. */
export const FREE_MARGIN_BYTES = 64 * 1024 * 1024;

/** Renoncement volontaire (pas une panne) : journalisé en avertissement. */
export class BackupSkipped extends Error {}

export type BackupResult = {
  name: string;
  /** Taille de l'archive compressée. */
  bytes: number;
  ms: number;
  /** Fichiers dans l'archive (base, manifest et médias compris). */
  files: number;
  mediaCount: number;
  kept: number;
  removed: number;
  shortfall: number;
  /** Fichiers par catégorie et références /media/… manquantes (lot 85). */
  storage: StorageCounts;
  missingRefs: string[];
  /** Les archives gardées dépassent quand même le plafond de place (les protégées, à elles seules). */
  overCap: boolean;
};

export const backupDir = (dataDir: string) => path.join(/* turbopackIgnore: true */ dataDir, BACKUP_DIRNAME);

/** Archives présentes, de la plus ancienne à la plus récente, avec leur date de fin d'écriture. */
export async function listArchives(dir: string): Promise<{ name: string; mtimeMs: number; size: number }[]> {
  const names = sortArchives(await readdir(dir).catch(() => [] as string[]));
  const out: { name: string; mtimeMs: number; size: number }[] = [];
  for (const name of names) {
    const info = await stat(path.join(/* turbopackIgnore: true */ dir, name)).catch(() => null);
    if (info?.isFile()) out.push({ name, mtimeMs: info.mtimeMs, size: info.size });
  }
  return out;
}

type MediaRow = { key: string; variants: string | null; status?: string };
type Counted = { files: number; bytes: number };
export type StorageCategory = "originals" | "kit" | "icons" | "variants" | "seed" | "other";
export type StorageCounts = { saved: Record<StorageCategory, Counted>; regenerable: { variants: Counted; iconsAuto: Counted } };
export type StorageFile = { key: string; file: string; size: number; mtime: number; category: StorageCategory };
export type StoragePlan = { files: StorageFile[]; counts: StorageCounts; isRegenerable: (key: string) => boolean };

/** Dossiers de media/ jamais sauvegardés (et pourquoi) : temporaires, caches refaits à la demande, imports de kit en cours, sauvegardes elles-mêmes. */
export const EXCLUDED_MEDIA_DIRS: readonly string[] = ["tmp", "cache", "kit-imports", "backup"];
/** Dossiers de media/ refaits tout seuls (comptés, jamais sauvegardés). */
const REGENERABLE_DIR = "icons-auto";
const VARIANT_TOPS = ["img", "vid", "doc"];
const hasVariantFiles = (v: unknown) => variantKeys(v).length > 0;
const emptyCounts = (): StorageCounts => ({
  saved: { originals: { files: 0, bytes: 0 }, kit: { files: 0, bytes: 0 }, icons: { files: 0, bytes: 0 }, variants: { files: 0, bytes: 0 }, seed: { files: 0, bytes: 0 }, other: { files: 0, bytes: 0 } },
  regenerable: { variants: { files: 0, bytes: 0 }, iconsAuto: { files: 0, bytes: 0 } },
});

/**
 * Tout media/ SAUF ce qui est prouvé régénérable (voir l'en-tête). `rows` : lignes de la base INSTANTANÉE (clé et variantes) ; elles ne
 * servent qu'à PROUVER qu'un dossier de variantes se refait (original présent), jamais à décider ce qui est sauvegardé.
 */
export async function storageToSave(rows: MediaRow[], mediaDir: string): Promise<StoragePlan> {
  const regen = await regenerableDirs(rows, async (key) => isSafeEntryName(key) && !!(await stat(path.join(/* turbopackIgnore: true */ mediaDir, key)).catch(() => null))?.isFile());
  const files: StorageFile[] = [];
  const counts = emptyCounts();
  const walk = async (dir: string, rel: string) => {
    for (const d of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      const abs = path.join(/* turbopackIgnore: true */ dir, d.name);
      if (d.isDirectory()) {
        if (!rel && EXCLUDED_MEDIA_DIRS.includes(d.name)) continue;
        await walk(abs, r);
        continue;
      }
      if (!d.isFile() || d.name.endsWith(".tmp") || !isSafeEntryName(r)) continue; // lien, reste d'écriture atomique, nom impossible dans une archive
      const info = await stat(abs).catch(() => null);
      if (!info?.isFile()) continue;
      const top = r.split("/")[0];
      if (top === REGENERABLE_DIR) {
        counts.regenerable.iconsAuto.files++;
        counts.regenerable.iconsAuto.bytes += info.size;
        continue;
      }
      const isVariant = VARIANT_TOPS.includes(top) && r.includes("/");
      if (isVariant && isRegenerableKey(r, regen)) {
        counts.regenerable.variants.files++;
        counts.regenerable.variants.bytes += info.size;
        continue;
      }
      const category: StorageCategory = isVariant ? "variants" : top === "originals" ? "originals" : top === "kit" ? "kit" : top === "icons" ? "icons" : !r.includes("/") ? "seed" : "other";
      counts.saved[category].files++;
      counts.saved[category].bytes += info.size;
      files.push({ key: r, file: abs, size: info.size, mtime: Math.floor(info.mtimeMs / 1000), category });
    }
  };
  await walk(mediaDir, "");
  files.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  return { files, counts, isRegenerable: (key) => isRegenerableKey(key, regen) };
}

async function fontFiles(dataDir: string): Promise<{ key: string; file: string; size: number; mtime: number }[]> {
  const root = path.join(/* turbopackIgnore: true */ dataDir, "fonts");
  const out: { key: string; file: string; size: number; mtime: number }[] = [];
  const walk = async (dir: string, rel: string) => {
    for (const d of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const r = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) await walk(path.join(/* turbopackIgnore: true */ dir, d.name), r);
      else if (d.isFile() && isSafeEntryName(r)) {
        const info = await stat(path.join(/* turbopackIgnore: true */ dir, d.name)).catch(() => null);
        if (info) out.push({ key: r, file: path.join(/* turbopackIgnore: true */ dir, d.name), size: info.size, mtime: Math.floor(info.mtimeMs / 1000) });
      }
    }
  };
  await walk(root, "");
  return out;
}

/** Fiches et aperçus des kits exportés (cache/kits/manifests) : exception au cache, l'import d'un PSD retouché en a besoin (lot 85). */
export const KIT_MANIFESTS_DIR = "cache/kits/manifests";
async function kitManifestFiles(dataDir: string): Promise<{ key: string; file: string; size: number; mtime: number }[]> {
  const dir = path.join(/* turbopackIgnore: true */ dataDir, KIT_MANIFESTS_DIR);
  const out: { key: string; file: string; size: number; mtime: number }[] = [];
  for (const d of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (!d.isFile() || d.name.endsWith(".tmp") || !isSafeEntryName(d.name)) continue;
    const info = await stat(path.join(/* turbopackIgnore: true */ dir, d.name)).catch(() => null);
    if (info?.isFile()) out.push({ key: d.name, file: path.join(/* turbopackIgnore: true */ dir, d.name), size: info.size, mtime: Math.floor(info.mtimeMs / 1000) });
  }
  return out;
}

export type BackupProgress = { phase: "preparation" | "ecriture"; done: number; total: number };

/** Ce que l'archive dit d'elle-même (manifest.json, premier fichier de l'archive). */
export type ArchiveManifest = {
  version?: string;
  createdAt?: string;
  reason?: string;
  includesMedia?: boolean;
  mediaCount?: number;
  bytes?: number;
  /** Lot 85 : présent = archive faite par exclusion (kit/, icons/… comptés) ; absent = archive d'avant. */
  storage?: Record<string, Counted>;
  /** Références /media/… de la base que l'archive ne contient pas et qui ne se régénèrent pas (nombre et quelques exemples). */
  missingRefs?: { count: number; samples: string[] };
};

const readMissing = (v: unknown): ArchiveManifest["missingRefs"] => {
  const o = v as { count?: unknown; samples?: unknown } | null;
  return o && typeof o.count === "number" ? { count: o.count, samples: Array.isArray(o.samples) ? o.samples.filter((x): x is string => typeof x === "string") : [] } : undefined;
};

const manifestCache = new Map<string, ArchiveManifest | null>();

/**
 * Lit le manifest.json d'une archive SANS la décompresser en entier : c'est la première entrée du tar, donc dans les
 * premiers Ko du flux gzip. Null si illisible (archive d'une autre origine, tronquée…). Mémorisé par nom + date + taille.
 */
export async function readArchiveManifest(file: string): Promise<ArchiveManifest | null> {
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return null;
  const cacheKey = `${file}|${info.mtimeMs}|${info.size}`;
  if (manifestCache.has(cacheKey)) return manifestCache.get(cacheKey) ?? null;
  let result: ArchiveManifest | null = null;
  const fh = await open(/* turbopackIgnore: true */ file, "r").catch(() => null);
  if (fh) {
    try {
      const head = Buffer.alloc(Math.min(65536, info.size));
      const { bytesRead } = await fh.read(head, 0, head.length, 0);
      // finishFlush : on ne veut que le début du flux, la fin manque forcément.
      const tar = gunzipSync(head.subarray(0, bytesRead), { finishFlush: zc.Z_SYNC_FLUSH });
      const name = tar.toString("utf8", 0, 100).replace(/\0[^]*$/, "");
      const size = parseInt(tar.toString("ascii", 124, 136).replace(/\0[^]*$/, "").trim(), 8);
      if (name === "manifest.json" && Number.isFinite(size) && size > 0 && size < 16384 && tar.length >= 512 + size) {
        const m = JSON.parse(tar.subarray(512, 512 + size).toString("utf8")) as Record<string, unknown>;
        result = {
          version: typeof m.version === "string" ? m.version : undefined,
          createdAt: typeof m.createdAt === "string" ? m.createdAt : undefined,
          reason: typeof m.reason === "string" ? m.reason : undefined,
          includesMedia: typeof m.includesMedia === "boolean" ? m.includesMedia : undefined,
          mediaCount: typeof m.mediaCount === "number" ? m.mediaCount : undefined,
          bytes: typeof m.bytes === "number" ? m.bytes : undefined,
          storage: m.storage && typeof m.storage === "object" ? (m.storage as Record<string, Counted>) : undefined,
          missingRefs: readMissing(m.missingRefs),
        };
      }
    } catch {
      result = null;
    } finally {
      await fh.close();
    }
  }
  if (manifestCache.size > 200) manifestCache.clear();
  manifestCache.set(cacheKey, result);
  return result;
}

export type RunOptions = {
  dataDir: string;
  /** `maxDiskPct` absent : 30 % (défaut de config.ts). */
  config: Pick<BackupConfig, "media" | "keep"> & { maxDiskPct?: number };
  reason: DueReason;
  /** Connexion en LECTURE SEULE distincte de celle du site (jamais la connexion qui écrit). */
  reader: Database.Database;
  version?: string;
  now?: () => Date;
  /** Avancement (écran Sauvegardes) : préparation, puis un appel par fichier écrit. */
  onProgress?: (p: BackupProgress) => void;
};

export async function runBackup(opts: RunOptions): Promise<BackupResult> {
  const started = Date.now();
  opts.onProgress?.({ phase: "preparation", done: 0, total: 0 });
  const dir = backupDir(opts.dataDir);
  await mkdir(dir, { recursive: true, mode: 0o750 });
  // Restes d'une écriture interrompue (arrêt brutal) : jamais une sauvegarde valable.
  for (const n of await readdir(dir)) if (n.endsWith(".tmp")) await rm(path.join(/* turbopackIgnore: true */ dir, n), { force: true });

  const stamp = (opts.now ?? (() => new Date()))();
  const snapshot = path.join(/* turbopackIgnore: true */ dir, `snapshot-${process.pid}.db.tmp`);
  let tmpArchive = "";
  try {
    // 1. Instantané cohérent : l'API de sauvegarde lit par pages pendant que le site écrit (WAL), sans le bloquer.
    await opts.reader.backup(snapshot);
    const snapInfo = await stat(snapshot);
    const snap = new Database(snapshot, { readonly: true });
    let rows: MediaRow[];
    let cited: Set<string>;
    let others: Set<string>;
    try {
      rows = snap.prepare("select key, variants, status from media").all() as MediaRow[];
      cited = mediaRefsInDb(snap);
      others = otherCitedNames(snap);
    } finally {
      snap.close();
    }

    // 2. Ce qui part avec : tout media/ sauf le régénérable, les polices, les fiches de kit. BACKUP_MEDIA=0 garde quand même kit/ et
    // icons/ (petits, l'artiste ne peut pas les renvoyer) : une base seule ne doit pas faire perdre ses thèmes à kit.
    const mediaDir = path.join(/* turbopackIgnore: true */ opts.dataDir, "media");
    const plan = await storageToSave(rows, mediaDir);
    const media = opts.config.media ? plan.files : plan.files.filter((f) => f.category === "kit" || f.category === "icons");
    const saved = emptyCounts().saved;
    for (const f of media) {
      saved[f.category].files++;
      saved[f.category].bytes += f.size;
    }
    const fonts = await fontFiles(opts.dataDir);
    const kitManifests = await kitManifestFiles(opts.dataDir);
    // Une conversion (vidéo) à cheval sur l'instantané : la base la voit en cours, l'original a été supprimé depuis. Sauvegarder ainsi
    // perdrait la vidéo : on renonce, le délai de reprise fait le reste.
    if (opts.config.media) {
      const have = new Set(media.map((m) => m.key));
      const racing = rows.filter((r) => r.status === "processing" && r.key.startsWith("originals/") && !have.has(r.key) && !hasVariantFiles(r.variants));
      if (racing.length) throw new BackupSkipped(`${racing.length} média(s) en cours de conversion dont l'original vient de disparaître : sauvegarde reportée à la fin du traitement`);
    }
    // Garde-fou : tout ce que la base cite (adresses /media/…, icône du site, polices, médias) doit être dans l'archive ou se régénérer.
    const names = new Set([...media.map((m) => `media/${m.key}`), ...fonts.map((f) => `fonts/${f.key}`)]);
    const missingSet = new Set<string>();
    if (opts.config.media) {
      for (const k of cited) if (!names.has(`media/${k}`) && !plan.isRegenerable(k)) missingSet.add(k);
      for (const r of rows) {
        if (r.status !== "ready" || names.has(`media/${r.key}`)) continue;
        if (variantKeys(r.variants).some((k) => names.has(`media/${k}`))) continue;
        missingSet.add(r.key);
      }
    }
    for (const n of others) if (!names.has(n)) missingSet.add(n);
    const missingRefs = [...missingSet].sort();
    const payload = [...media.map((m) => ({ ...m, name: `media/${m.key}` })), ...fonts.map((f) => ({ ...f, name: `fonts/${f.key}` })), ...kitManifests.map((f) => ({ ...f, name: `${KIT_MANIFESTS_DIR}/${f.key}` }))];
    const rawBytes = snapInfo.size + payload.reduce((n, f) => n + f.size, 0);

    // 3. Assez de place ? Sinon on renonce, sans toucher aux sauvegardes existantes.
    const fs = await statfs(dir);
    const free = Number(fs.bavail) * Number(fs.bsize);
    if (free < rawBytes + FREE_MARGIN_BYTES) {
      const mo = (b: number) => `${Math.ceil(b / 1048576)} Mo`;
      throw new BackupSkipped(
        `espace libre insuffisant (${mo(free)} libres, jusqu'à ${mo(rawBytes + FREE_MARGIN_BYTES)} nécessaires) : pas de sauvegarde${opts.config.media ? ' ; BACKUP_MEDIA=0 ne sauvegarde que la base' : ""}`,
      );
    }

    const manifest = Buffer.from(
      `${JSON.stringify(
        {
          format: 1,
          app: "portfolio",
          version: opts.version ?? "inconnue",
          createdAt: stamp.toISOString(),
          reason: opts.reason,
          includesMedia: opts.config.media,
          mediaCount: rows.length,
          mediaFiles: media.length,
          fontFiles: fonts.length,
          complete: opts.config.media,
          storage: { ...saved, kitManifests: { files: kitManifests.length, bytes: kitManifests.reduce((n, f) => n + f.size, 0) } },
          regenerable: plan.counts.regenerable,
          missingRefs: { count: missingRefs.length, samples: missingRefs.slice(0, 8).map((k) => k.slice(0, 120)) },
          dbBytes: snapInfo.size,
          bytes: rawBytes,
        },
        null,
        2,
      )}\n`,
    );
    const mtime = Math.floor(stamp.getTime() / 1000);
    const entries: TarEntry[] = [
      { name: "manifest.json", size: manifest.length, mtime, source: { data: manifest } },
      { name: "portfolio.db", size: snapInfo.size, mtime, source: { file: snapshot } },
      ...payload.map((f) => ({ name: f.name, size: f.size, mtime: f.mtime, source: { file: f.file } })),
    ];

    // 4. Écriture en flux (gzip niveau 3 : léger ; les images sont déjà compressées) dans un .tmp, puis renommage.
    let name = archiveName(stamp);
    for (let i = 1; (await stat(path.join(/* turbopackIgnore: true */ dir, name)).catch(() => null)) !== null; i++) name = archiveName(stamp, i);
    tmpArchive = path.join(/* turbopackIgnore: true */ dir, `${name}.${process.pid}.tmp`);
    const report: TarReport = { shortfall: 0 };
    const tracked = function* () {
      for (let i = 0; i < entries.length; i++) {
        opts.onProgress?.({ phase: "ecriture", done: i, total: entries.length });
        yield entries[i];
      }
    };
    await pipeline(Readable.from(tarChunks(tracked(), report)), createGzip({ level: 3 }), createWriteStream(tmpArchive, { mode: 0o640 }));
    // Un fichier raccourci ou disparu pendant la copie est complété de zéros par le flux tar : jamais une archive qui a l'air bonne.
    if (report.shortfall > 0) throw new BackupSkipped(`${report.shortfall} octet(s) manquants : un fichier a changé pendant la copie ; sauvegarde refusée, nouvel essai plus tard`);
    const fh = await open(/* turbopackIgnore: true */ tmpArchive, "r+");
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
    const finalPath = path.join(/* turbopackIgnore: true */ dir, name);
    await rename(tmpArchive, finalPath);
    tmpArchive = "";
    const bytes = (await stat(finalPath)).size;

    // 5. Rotation : seulement maintenant que la nouvelle est complète (règles : retentionPlan). Une archive manuelle se reconnaît à la
    // raison de son manifest ; illisible = comptée comme automatique (la réserve la plus stricte).
    const listed = await listArchives(dir);
    const infos: { name: string; size: number; manual: boolean }[] = [];
    for (const a of listed) {
      const manual = a.name === name ? opts.reason === "manuel" : (await readArchiveManifest(path.join(/* turbopackIgnore: true */ dir, a.name)))?.reason === "manuel";
      infos.push({ name: a.name, size: a.size, manual });
    }
    const maxBytes = Math.floor((Number(fs.blocks) * Number(fs.bsize) * (opts.config.maxDiskPct ?? 30)) / 100);
    const doomed = retentionPlan(infos, { keep: opts.config.keep, now: stamp.getTime(), maxBytes }).filter((n) => n !== name);
    for (const n of doomed) await rm(path.join(/* turbopackIgnore: true */ dir, n), { force: true });
    const keptBytes = infos.filter((a) => !doomed.includes(a.name)).reduce((n, a) => n + a.size, 0);
    return { name, bytes, ms: Date.now() - started, files: entries.length, mediaCount: rows.length, kept: infos.length - doomed.length, removed: doomed.length, shortfall: report.shortfall, storage: { saved, regenerable: plan.counts.regenerable }, missingRefs, overCap: keptBytes > maxBytes };
  } finally {
    await rm(snapshot, { force: true });
    if (tmpArchive) await rm(tmpArchive, { force: true });
  }
}
