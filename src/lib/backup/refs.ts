/**
 * Garde-fou des sauvegardes (lot 85) : quels fichiers du stockage la base CITE-t-elle ?
 *
 * Toute adresse `/media/<clé>` écrite dans une colonne texte de la base (thèmes et leurs versions, réglages, pages, brouillons,
 * blocs, projets, bibliothèque de cadres, référencement…) est une promesse faite au visiteur : le fichier doit exister. Le parcours
 * est volontairement GÉNÉRIQUE (toutes les colonnes texte de toutes les tables, sauf sessions et jetons) : un futur champ qui cite
 * un média est vu sans qu'on ait à penser à l'ajouter ici.
 *
 * Partagé par la fabrication de l'archive (archive.ts : référence ni sauvegardée ni régénérable = avertissement) et par le
 * démarrage après une restauration (restore.ts : la même vérification sur le volume restauré).
 */
import type Database from "better-sqlite3";

/** Tables sans média et pleines de secrets : jamais lues. */
const SKIP_TABLES = new Set(["session", "account", "verification", "rate_limit", "auth_throttle"]);
/** `/media/<clé>` ; la clé est faite de segments [A-Za-z0-9._-] (voir isValidKey du stockage). Pas de lettre avant « /media » (un lien externe). */
const REF = /(?<![A-Za-z0-9._~-])\/media\/((?:[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/)*[A-Za-z0-9][A-Za-z0-9._-]{0,127})/g;

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Clés (sans le préfixe /media/) citées dans la base. Lecture seule ; aucune table n'est chargée en mémoire d'un bloc. */
export function mediaRefsInDb(db: Database.Database): Set<string> {
  const found = new Set<string>();
  const tables = db.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite\\_%' escape '\\' and name not like '\\_\\_%' escape '\\'").all() as { name: string }[];
  for (const { name } of tables) {
    if (SKIP_TABLES.has(name)) continue;
    const columns = (db.prepare(`pragma table_info(${ident(name)})`).all() as { name: string; type: string }[]).filter((c) => !/^(integer|int|real|numeric|boolean|blob)/i.test(c.type));
    for (const c of columns) {
      const rows = db.prepare(`select ${ident(c.name)} as v from ${ident(name)} where typeof(${ident(c.name)}) = 'text' and ${ident(c.name)} like '%/media/%'`).iterate() as IterableIterator<{ v: string }>;
      for (const row of rows) for (const m of row.v.matchAll(REF)) found.add(m[1]);
    }
  }
  return found;
}

type MediaRow = { key: string; variants: unknown };

/**
 * Dossiers de variantes (`img/<h>`, `vid/<h>`, `doc/<h>`) qu'on sait REFAIRE : ceux des médias dont l'original est présent. Le worker les
 * régénère depuis l'original (c'est ce que fait « Réessayer » et ce que fait le démarrage après une restauration). `hasOriginal` dit si
 * la clé d'un original est un fichier du stockage.
 */
export async function regenerableDirs(rows: MediaRow[], hasOriginal: (key: string) => Promise<boolean>): Promise<Set<string>> {
  const dirs = new Set<string>();
  for (const row of rows) {
    if (!row.key.startsWith("originals/") || !(await hasOriginal(row.key))) continue;
    // Le dossier de variantes porte les 16 premiers caractères du sha256, qui est le nom de l'original.
    const h = /^originals\/([0-9a-f]{16})/.exec(row.key)?.[1];
    if (h) for (const top of ["img", "vid", "doc"]) dirs.add(`${top}/${h}`);
    let parsed: unknown = row.variants;
    if (typeof parsed === "string") {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        parsed = null;
      }
    }
    const files = (parsed as { files?: unknown } | null)?.files;
    if (!Array.isArray(files)) continue;
    for (const f of files) {
      const key = (f as { key?: unknown } | null)?.key;
      const m = typeof key === "string" ? /^(img|vid|doc)\/([^/]+)\//.exec(key) : null;
      if (m) dirs.add(`${m[1]}/${m[2]}`);
    }
  }
  return dirs;
}

/** Clé refaisable sans l'archive : variante d'un original présent, ou icône « auto » (refaite à la première requête). */
export function isRegenerableKey(key: string, dirs: Set<string>): boolean {
  if (key.startsWith("icons-auto/")) return true;
  const m = /^(img|vid|doc)\/([^/]+)\//.exec(key);
  return !!m && dirs.has(`${m[1]}/${m[2]}`);
}

/** Clés de fichiers listées dans la colonne `variants` d'un média (JSON texte ou objet déjà lu). */
export function variantKeys(variants: unknown): string[] {
  let parsed = variants;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  const files = (parsed as { files?: unknown } | null)?.files;
  if (!Array.isArray(files)) return [];
  return files.map((f) => (f as { key?: unknown } | null)?.key).filter((k): k is string => typeof k === "string");
}

/**
 * Références qui ne s'écrivent pas `/media/…` : le dossier de l'icône du site en mode image (`seo.favicon.dir`, sans préfixe) et les polices
 * de la bibliothèque (`fontLibrary` → fonts/<empreinte>.woff2). Noms RELATIFS À L'ARCHIVE (`media/icons/…/512.png`, `fonts/….woff2`).
 */
export function otherCitedNames(db: Database.Database): Set<string> {
  const out = new Set<string>();
  const value = (key: string) => {
    try {
      return (db.prepare("select value from settings where key = ?").get(key) as { value: string } | undefined)?.value;
    } catch {
      return undefined; // pas de table settings (base de test)
    }
  };
  try {
    const dir = (JSON.parse(value("seo") ?? "null") as { favicon?: { dir?: unknown } } | null)?.favicon?.dir;
    if (typeof dir === "string" && /^icons\/[A-Za-z0-9._-]+$/.test(dir)) out.add(`media/${dir}/512.png`);
  } catch {
    // réglage illisible : ignoré
  }
  for (const m of (value("fontLibrary") ?? "").matchAll(/\b([0-9a-f]{16}\.woff2)\b/g)) out.add(`fonts/${m[1]}`);
  return out;
}
