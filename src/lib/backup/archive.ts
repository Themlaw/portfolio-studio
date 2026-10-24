/**
 * Fabrication d'une archive de sauvegarde (lot 50) : instantané cohérent de la base, originaux des médias, polices,
 * manifest.json ; écriture en flux dans un .tmp puis renommage atomique ; rotation APRÈS l'écriture complète.
 *
 * Ce qui entre dans l'archive (et pourquoi) :
 *  - portfolio.db : copie par l'API de sauvegarde de SQLite (better-sqlite3 `.backup`), jamais une copie du fichier en
 *    écriture ; prise pendant que le site tourne, sans verrou d'écriture.
 *  - media/originals/… : les ORIGINAUX envoyés. Les variantes (img/, vid/, doc/) sont régénérées par le worker à partir
 *    d'eux : la restauration les remet en file toute seule (src/lib/backup/restore.ts).
 *  - EXCEPTIONS (non régénérables) : un média dont l'original n'existe plus (vidéo dont l'original est supprimé après
 *    conversion, `originalRemoved`) garde ses variantes dans l'archive ; un média du seed (clé hors originals/, par
 *    exemple un SVG) est copié tel quel.
 *  - fonts/ : polices installées (téléchargées depuis Google à l'installation ; quelques centaines de Ko).
 *  - Jamais : tmp/ (envois en cours), cache/ (recadrages, kits : régénérés à la demande), kit-imports/, backup/.
 */
import { createWriteStream } from "node:fs";
import { mkdir, open, readdir, rename, rm, stat, statfs } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { constants as zc, createGzip, gunzipSync } from "node:zlib";

import Database from "better-sqlite3";

import type { BackupConfig } from "./config";
import { archiveName, rotationPlan, sortArchives, type DueReason } from "./schedule";
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

type MediaRow = { key: string; variants: string | null };

/** Clés (relatives à media/) à mettre dans l'archive, d'après les lignes de la base INSTANTANÉE. */
export async function mediaKeysToSave(rows: MediaRow[], mediaDir: string): Promise<{ key: string; file: string; size: number; mtime: number }[]> {
  const out = new Map<string, { key: string; file: string; size: number; mtime: number }>();
  const add = async (key: unknown) => {
    if (typeof key !== "string" || !isSafeEntryName(key)) return false;
    if (out.has(key)) return true;
    const file = path.join(/* turbopackIgnore: true */ mediaDir, key);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) return false;
    out.set(key, { key, file, size: info.size, mtime: Math.floor(info.mtimeMs / 1000) });
    return true;
  };
  for (const row of rows) {
    const isUpload = row.key.startsWith("originals/");
    const haveOriginal = await add(row.key);
    if (isUpload && haveOriginal) continue; // les variantes se régénèrent depuis l'original
    // Pas d'original utilisable (supprimé après conversion) ou média du seed : on garde aussi ce qui est servi.
    let files: unknown[] = [];
    try {
      const parsed = row.variants ? JSON.parse(row.variants) : null;
      if (parsed && Array.isArray(parsed.files)) files = parsed.files;
    } catch {
      // variantes illisibles : ignorées
    }
    for (const f of files) await add((f as { key?: unknown } | null)?.key);
  }
  return [...out.values()];
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

export type BackupProgress = { phase: "preparation" | "ecriture"; done: number; total: number };

/** Ce que l'archive dit d'elle-même (manifest.json, premier fichier de l'archive). */
export type ArchiveManifest = { version?: string; createdAt?: string; reason?: string; includesMedia?: boolean; mediaCount?: number; bytes?: number };

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
  config: Pick<BackupConfig, "media" | "keep">;
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
    try {
      rows = snap.prepare("select key, variants from media").all() as MediaRow[];
    } finally {
      snap.close();
    }

    // 2. Ce qui part avec : originaux (sauf BACKUP_MEDIA=0) et polices.
    const mediaDir = path.join(/* turbopackIgnore: true */ opts.dataDir, "media");
    const media = opts.config.media ? await mediaKeysToSave(rows, mediaDir) : [];
    const fonts = await fontFiles(opts.dataDir);
    const payload = [...media.map((m) => ({ ...m, name: `media/${m.key}` })), ...fonts.map((f) => ({ ...f, name: `fonts/${f.key}` }))];
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

    // 5. Rotation : seulement maintenant que la nouvelle est complète.
    const all = (await listArchives(dir)).map((a) => a.name);
    const doomed = rotationPlan(all, opts.config.keep).filter((n) => n !== name);
    for (const n of doomed) await rm(path.join(/* turbopackIgnore: true */ dir, n), { force: true });
    return { name, bytes, ms: Date.now() - started, files: entries.length, mediaCount: rows.length, kept: all.length - doomed.length, removed: doomed.length, shortfall: report.shortfall };
  } finally {
    await rm(snapshot, { force: true });
    if (tmpArchive) await rm(tmpArchive, { force: true });
  }
}
