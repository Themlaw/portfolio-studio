#!/usr/bin/env node
/**
 * Restaure une sauvegarde automatique (lot 50) dans le dossier de données, SITE ARRÊTÉ.
 * Sans dépendance ni `tar` : fonctionne dans l'image de production (distroless, pas de shell).
 *
 *   node restore-backup.mjs <archive.tar.gz> [dossier-de-données]      (défaut : $DATA_DIR ou /data)
 *   node restore-backup.mjs --list <archive.tar.gz>                    (contenu du manifest, rien n'est modifié)
 *
 * Étapes : l'archive est d'abord extraite en entier dans un dossier de travail (une archive tronquée ou abîmée est refusée
 * avant que quoi que ce soit change) ; l'ancienne base (portfolio.db, -wal, -shm : un -wal oublié fausserait la base
 * restaurée) est RANGÉE dans <données>/restore-previous-<date>/, jamais effacée ; la base et les fichiers de l'archive sont
 * mis en place ; manifest.json est posé à la racine : au démarrage, le site remet en file la régénération des variantes d'images
 * (l'archive ne contient que les originaux et ce qui n'est pas régénérable : kit/, icons/…, voir src/lib/backup/archive.ts). Les fichiers
 * prennent le propriétaire du dossier de données (exécution en root). Une archive d'avant le lot 85 (manifest sans `storage`) est
 * restaurée aussi, avec un AVERTISSEMENT : elle n'a ni kit, ni cadres importés, ni icônes.
 */
import { createReadStream, createWriteStream } from "node:fs";
import { chown, mkdir, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";

// media/ (tout le stockage non régénérable), fonts/, et les fiches des kits exportés (lot 85) : seuls endroits où l'archive écrit.
const TOP = /^(?:manifest\.json|portfolio\.db|media\/.+|fonts\/.+|cache\/kits\/manifests\/.+)$/;
/** Dossiers de premier niveau de <données> créés par la restauration : rendus au propriétaire des données. */
const OWNED_DIRS = ["media", "fonts", "cache"];

/** Lecteur d'octets exacts sur un flux asynchrone. */
class Reader {
  constructor(source) {
    this.it = source[Symbol.asyncIterator]();
    this.buf = Buffer.alloc(0);
    this.done = false;
  }
  async fill(n) {
    while (this.buf.length < n && !this.done) {
      const { value, done } = await this.it.next();
      if (done) this.done = true;
      else this.buf = this.buf.length ? Buffer.concat([this.buf, value]) : value;
    }
  }
  /** Jusqu'à n octets (moins seulement en fin de flux). */
  async read(n) {
    await this.fill(n);
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(out.length);
    return out;
  }
}

const field = (b, from, len) => {
  const raw = b.subarray(from, from + len);
  const end = raw.indexOf(0);
  return raw.subarray(0, end < 0 ? len : end).toString("utf8");
};
const num = (b, from, len) => {
  if (b[from] & 0x80) {
    // base 256 (gros fichiers écrits par d'autres outils)
    let v = b[from] & 0x7f;
    for (let i = 1; i < len; i++) v = v * 256 + b[from + i];
    return v;
  }
  return parseInt(field(b, from, len).trim() || "0", 8);
};

function paxRecords(data) {
  const out = {};
  let i = 0;
  while (i < data.length) {
    const sp = data.indexOf(0x20, i);
    if (sp < 0) break;
    const len = Number(data.subarray(i, sp).toString());
    if (!(len > 0)) break;
    const rec = data.subarray(sp + 1, i + len - 1).toString("utf8");
    const eq = rec.indexOf("=");
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
    i += len;
  }
  return out;
}

/**
 * Parcourt une archive tar (flux d'octets non compressés). `onFile(name, size, reader)` DOIT lire exactement `size` octets
 * (utiliser `copyTo`). Les entrées autres que fichiers et dossiers sont refusées (liens, périphériques).
 */
export async function readTar(source, onFile) {
  const r = new Reader(source);
  let pax = {};
  for (;;) {
    const h = await r.read(512);
    if (h.length === 0) throw new Error("archive tronquée (fin d'archive absente)");
    if (h.length < 512) throw new Error("archive tronquée (en-tête incomplet)");
    if (h.every((x) => x === 0)) return;
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    if (sum !== parseInt(field(h, 148, 8).trim() || "-1", 8)) throw new Error("archive abîmée (somme de contrôle d'en-tête fausse)");
    const type = String.fromCharCode(h[156] || 48);
    let size = num(h, 124, 12);
    let name = field(h, 0, 100);
    const prefix = field(h, 345, 155);
    if (prefix && field(h, 257, 5) === "ustar") name = `${prefix}/${name}`;
    const skipPad = async (n) => {
      const p = (512 - (n % 512)) % 512;
      if (p) await r.read(p);
    };
    if (type === "x" || type === "g") {
      const data = await r.read(size);
      if (data.length < size) throw new Error("archive tronquée");
      await skipPad(size);
      if (type === "x") pax = { ...pax, ...paxRecords(data) };
      continue;
    }
    if (pax.path) name = pax.path;
    if (pax.size) size = Number(pax.size);
    pax = {};
    if (type === "5") continue;
    if (type !== "0") throw new Error(`entrée non prise en charge (type ${JSON.stringify(type)}) : ${name}`);
    await onFile(name, size, r);
    await skipPad(size);
  }
}

/** Copie exactement `size` octets du lecteur vers un flux d'écriture. */
export async function copyTo(r, size, out) {
  let left = size;
  while (left > 0) {
    const chunk = await r.read(Math.min(left, 1 << 20));
    if (chunk.length === 0) throw new Error("archive tronquée (fichier incomplet)");
    left -= chunk.length;
    if (!out.write(chunk)) await new Promise((res) => out.once("drain", res));
  }
}

const safe = (name) => name.length > 0 && !name.startsWith("/") && !name.includes("\0") && name.split("/").every((s) => s && s !== "." && s !== "..");

/** Contenu du manifest sans rien extraire d'autre. */
export async function readManifest(archive) {
  let manifest = null;
  const stream = createReadStream(archive).pipe(createGunzip());
  try {
    await readTar(stream, async (name, size, r) => {
      // Le manifest est toujours la première entrée : on s'arrête là, sans lire le reste de l'archive.
      if (name !== "manifest.json" || size > 1 << 20) throw new Error("manifest.json absent en tête d'archive : ce n'est pas une sauvegarde du portfolio");
      manifest = JSON.parse((await r.read(size)).toString("utf8"));
      throw Object.assign(new Error("fin"), { stop: true });
    });
  } catch (e) {
    if (!e?.stop) throw e;
  } finally {
    stream.destroy();
  }
  if (!manifest) throw new Error("manifest.json introuvable dans l'archive");
  return manifest;
}

/** Avertissements à montrer à celui qui restaure (liste vide : rien à signaler). */
export function archiveWarnings(m) {
  const out = [];
  if (m && m.includesMedia !== false && !m.storage) {
    out.push(
      "AVERTISSEMENT : cette sauvegarde date d'avant le lot 85. Elle ne contient pas les dessins du kit appliqués aux thèmes, les cadres importés, le logo du thème, les fichiers d'un thème importé ni l'icône du site en image : ces images seront cassées après la restauration, jusqu'à ce qu'elles soient renvoyées (kit Photoshop, cadres, logo, icône).",
    );
  }
  if (m?.missingRefs?.count > 0) {
    out.push(`AVERTISSEMENT : lors de cette sauvegarde, ${m.missingRefs.count} fichier(s) cité(s) par le site n'étaient déjà plus là (ex. ${(m.missingRefs.samples ?? []).slice(0, 3).join(", ")}) : à renvoyer.`);
  }
  return out;
}

const versionParts = (v) => (/^\d+(\.\d+)*$/.test(String(v ?? "")) ? String(v).split(".").map(Number) : null);
/** Vrai si la version `a` est strictement plus récente que `b` (inconnues ou non numériques : faux). */
export function isNewer(a, b) {
  const x = versionParts(a);
  const y = versionParts(b);
  if (!x || !y) return false;
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}
/** Version de l'application qui exécute le script : PORTFOLIO_VERSION, sinon package.json à côté du script. */
export async function appVersion() {
  if (process.env.PORTFOLIO_VERSION) return process.env.PORTFOLIO_VERSION;
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const f of [path.join(here, "package.json"), path.join(here, "..", "package.json")]) {
    try {
      const v = JSON.parse(await readFile(f, "utf8")).version;
      if (typeof v === "string") return v;
    } catch {
      // pas là
    }
  }
  return null;
}

/** Extrait toute l'archive sous `dest` (dossier vide). Retourne les chemins relatifs des fichiers. */
export async function extractAll(archive, dest, owner) {
  const files = [];
  const made = new Set();
  const ensureDir = async (dir) => {
    if (made.has(dir)) return;
    await mkdir(dir, { recursive: true });
    made.add(dir);
  };
  const own = async (p) => {
    if (owner) await chown(p, owner.uid, owner.gid).catch(() => {});
  };
  const src = createReadStream(archive).pipe(createGunzip());
  await readTar(src, async (name, size, r) => {
    if (!safe(name) || !TOP.test(name)) throw new Error(`chemin inattendu dans l'archive : ${JSON.stringify(name)}`);
    const target = path.join(dest, name);
    await ensureDir(path.dirname(target));
    const out = createWriteStream(target, { mode: 0o640 });
    try {
      await copyTo(r, size, out);
    } finally {
      await new Promise((res) => out.end(res));
    }
    await own(target);
    files.push(name);
  });
  return files;
}

async function walkDirs(root) {
  const out = [];
  for (const d of await readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (d.isDirectory()) out.push(path.join(root, d.name), ...(await walkDirs(path.join(root, d.name))));
  }
  return out;
}

export async function restore(archive, dataDir) {
  const info = await stat(dataDir).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`dossier de données introuvable : ${dataDir}`);
  const owner = process.getuid?.() === 0 ? { uid: info.uid, gid: info.gid } : null;
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const work = path.join(dataDir, `restore-tmp-${stamp}`);
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  try {
    const files = await extractAll(archive, work, owner);
    if (!files.includes("manifest.json") || !files.includes("portfolio.db")) throw new Error("archive incomplète : manifest.json ou portfolio.db absent");
    const head = (await readFile(path.join(work, "portfolio.db"))).subarray(0, 16).toString("latin1");
    if (head !== "SQLite format 3\0") throw new Error("portfolio.db de l'archive n'est pas une base SQLite");
    // Tout est lu et vérifié : on change enfin quelque chose. L'ancienne base est rangée, pas effacée.
    const previous = path.join(dataDir, `restore-previous-${stamp}`);
    let moved = 0;
    for (const f of ["portfolio.db", "portfolio.db-wal", "portfolio.db-shm"]) {
      if (await stat(path.join(dataDir, f)).catch(() => null)) {
        await mkdir(previous, { recursive: true });
        await rename(path.join(dataDir, f), path.join(previous, f));
        moved++;
      }
    }
    for (const name of files) {
      const to = path.join(dataDir, name);
      await mkdir(path.dirname(to), { recursive: true });
      await rename(path.join(work, name), to);
    }
    // Dossiers créés en root : rendus au propriétaire des données.
    // Cache des recadrages : indexé par IDENTIFIANT de média, que la base restaurée a pu réattribuer à d'autres images : on le vide.
    await rm(path.join(dataDir, "cache", "crops"), { recursive: true, force: true });
    if (owner) for (const d of OWNED_DIRS) for (const p of [path.join(dataDir, d), ...(await walkDirs(path.join(dataDir, d)))]) await chown(p, owner.uid, owner.gid).catch(() => {});
    return { files: files.length, previous: moved ? previous : null };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  const list = args[0] === "--list";
  const force = args.includes("--force");
  const rest = (list ? args.slice(1) : args).filter((a) => a !== "--force");
  const [archive, dataArg] = rest;
  if (!archive || rest.some((a) => a.startsWith("--"))) {
    console.error("Usage : node restore-backup.mjs [--force] <archive.tar.gz> [dossier-de-données]\n        node restore-backup.mjs --list <archive.tar.gz>");
    process.exit(2);
  }
  if (list) {
    console.log(JSON.stringify(await readManifest(archive), null, 2));
    return;
  }
  const dataDir = path.resolve(dataArg ?? process.env.DATA_DIR ?? "/data");
  const m = await readManifest(archive);
  console.log(`Archive du ${m.createdAt} (version ${m.version}, ${m.mediaCount} média(s), ${m.includesMedia ? "médias inclus" : "base seule"}).`);
  const current = await appVersion();
  if (!force && isNewer(m.version, current)) {
    console.error(`Refusé : cette sauvegarde vient de la version ${m.version}, plus récente que ce site (${current}). Une base plus récente peut ne pas tourner sur une image plus ancienne : utilise une image de la version ${m.version} ou plus, ou ajoute --force à tes risques.`);
    process.exit(1);
  }
  for (const w of archiveWarnings(m)) console.warn(w);
  const out = await restore(archive, dataDir);
  console.log(`Restauré : ${out.files} fichier(s) dans ${dataDir}.`);
  if (out.previous) console.log(`Ancienne base rangée dans ${out.previous} (à supprimer une fois la restauration vérifiée).`);
  console.log("Redémarre le site : il régénère lui-même les variantes d'images manquantes.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`Échec : ${e.message}`);
    process.exit(1);
  });
}
