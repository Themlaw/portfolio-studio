/**
 * Journal d'édition (lot 97) : table `edit_log` d'une base SQLite À PART (`${DATA_DIR}/edit-log.db`).
 *
 * Pourquoi un fichier séparé : (1) les sauvegardes détectent « il y a eu des modifications » par `PRAGMA data_version` sur
 * portfolio.db : une ligne de journal (refus, erreur du navigateur) ne doit pas déclencher une sauvegarde ; (2) aucune migration
 * SQL, aucune table dans le schéma du site, aucun verrou partagé avec les écritures de l'artiste ; (3) l'archive de sauvegarde
 * ne prend que portfolio.db, media/ et fonts/ : le journal n'y entre pas, et une restauration (qui remplace portfolio.db) le
 * LAISSE INTACT, ce qui permet justement de savoir ce qui s'est passé avant et après la restauration.
 *
 * Rétention : 30 jours ou 20 000 lignes (la plus stricte), purge automatique (à l'ouverture, puis toutes les 500 écritures
 * ou 10 minutes). JAMAIS une entrée de moins de 7 jours (docs/SECURITE.md P5) : noyer le journal ne peut plus effacer les
 * traces récentes d'une intrusion. Plafond dur de HARD_MAX_ROWS lignes (disque) : au-delà, les NOUVELLES entrées ne sont plus
 * écrites (les anciennes, celles qui comptent après une intrusion, restent) ; stdout garde tout. Jamais de contenu de média, de mot de passe, de jeton ni de corps de message (voir summary.ts).
 * Toutes les fonctions d'écriture avalent leurs erreurs : le journal ne doit jamais casser une action.
 */
import path from "node:path";

import Database from "better-sqlite3";

import { dataDir } from "@/lib/db";

export const LOG_FILE = "edit-log.db";
export const MAX_ROWS = 20_000;
export const MAX_DAYS = 30;
/** Âge en dessous duquel une entrée n'est jamais purgée, ni par l'ancienneté ni par le nombre de lignes. */
export const MIN_KEEP_DAYS = 7;
/** Plafond dur du nombre de lignes (une semaine d'écritures en rafale ne doit pas remplir le disque). */
export const HARD_MAX_ROWS = 200_000;

export type EntryResult = "ok" | "refus" | "conflit" | "erreur";
export type EntryType = "modification" | "creation" | "suppression" | "publication" | "abandon" | "restauration" | "import" | "theme" | "reglage" | "compte" | "telechargement" | "erreur";
export type NewEntry = {
  kind: "action" | "client";
  action: string;
  type: EntryType;
  user: string | null;
  pageId: number | null;
  page: string | null;
  target: string | null;
  revFrom: number | null;
  revTo: number | null;
  result: EntryResult;
  ms: number | null;
  version: string;
  label: string;
  summary: unknown;
};

export type Entry = Omit<NewEntry, "summary" | "pageId" | "revFrom" | "revTo"> & { id: number; t: number; pageId: number | null; revFrom: number | null; revTo: number | null; summary: unknown };

type Row = { id: number; t: number; kind: string; action: string; type: string; user: string | null; page_id: number | null; page: string | null; target: string | null; rev_from: number | null; rev_to: number | null; result: string; ms: number | null; version: string; label: string; summary: string | null };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS edit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  t INTEGER NOT NULL,
  kind TEXT NOT NULL,
  action TEXT NOT NULL,
  type TEXT NOT NULL,
  user TEXT,
  page_id INTEGER,
  page TEXT,
  target TEXT,
  rev_from INTEGER,
  rev_to INTEGER,
  result TEXT NOT NULL,
  ms REAL,
  version TEXT NOT NULL,
  label TEXT NOT NULL,
  summary TEXT
);
CREATE INDEX IF NOT EXISTS edit_log_t ON edit_log (t);
CREATE INDEX IF NOT EXISTS edit_log_page ON edit_log (page_id, t);
CREATE INDEX IF NOT EXISTS edit_log_type ON edit_log (type, t);
CREATE INDEX IF NOT EXISTS edit_log_result ON edit_log (result, t);
`;

type State = { db: Database.Database; file: string; inserts: number; lastPurge: number; insert: Database.Statement; full: boolean; fullWarned: number };
const g = globalThis as unknown as { __editLog?: State };

const limits = () => ({
  rows: Math.max(1, Number(process.env.EDIT_LOG_MAX_ROWS) || MAX_ROWS),
  days: Math.max(0.0001, Number(process.env.EDIT_LOG_MAX_DAYS) || MAX_DAYS),
  hard: Math.max(1, Number(process.env.EDIT_LOG_HARD_MAX) || HARD_MAX_ROWS),
});

function open(): State {
  const file = path.join(/* turbopackIgnore: true */ dataDir(), LOG_FILE);
  if (g.__editLog && g.__editLog.file === file) return g.__editLog;
  try {
    g.__editLog?.db.close();
  } catch {
    // déjà fermée
  }
  const db = new Database(file, { timeout: 2000 });
  db.pragma("busy_timeout = 2000");
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = OFF");
  db.exec(SCHEMA);
  const insert = db.prepare(
    "INSERT INTO edit_log (t, kind, action, type, user, page_id, page, target, rev_from, rev_to, result, ms, version, label, summary) VALUES (@t, @kind, @action, @type, @user, @page_id, @page, @target, @rev_from, @rev_to, @result, @ms, @version, @label, @summary)",
  );
  g.__editLog = { db, file, inserts: 0, lastPurge: 0, insert, full: false, fullWarned: 0 };
  purgeLog();
  return g.__editLog;
}

/** Applique la rétention. Renvoie le nombre de lignes retirées. */
export function purgeLog(now = Date.now(), opts: { rows?: number; days?: number } = {}): number {
  try {
    const s = open();
    const l = limits();
    const rows = opts.rows ?? l.rows;
    const days = opts.days ?? l.days;
    s.lastPurge = now;
    // Rien de plus récent que MIN_KEEP_DAYS ne part, quelle que soit la limite demandée.
    const keepFrom = now - MIN_KEEP_DAYS * 86_400_000;
    const a = s.db.prepare("DELETE FROM edit_log WHERE t < ?").run(Math.min(now - days * 86_400_000, keepFrom)).changes;
    const b = s.db.prepare("DELETE FROM edit_log WHERE id <= (SELECT MAX(id) FROM edit_log) - ? AND t < ?").run(rows, keepFrom).changes;
    s.full = (s.db.prepare("SELECT COUNT(*) AS n FROM edit_log").get() as { n: number }).n >= l.hard;
    return a + b;
  } catch {
    return 0;
  }
}

const clip = (v: string | null, n: number) => (v === null ? null : v.length > n ? `${v.slice(0, n - 1)}…` : v);

/** Ajoute une entrée. Renvoie son identifiant (ou null si l'écriture a échoué : jamais d'exception). */
export function writeEntry(e: NewEntry, at = Date.now()): number | null {
  try {
    const s = open();
    if (s.full) {
      if (at - s.fullWarned > 600_000) {
        s.fullWarned = at;
        console.error(`[journal] plafond de ${limits().hard} lignes atteint (rien de moins de ${MIN_KEEP_DAYS} jours n'est purgé) : nouvelles entrées non écrites (stdout seulement)`);
      }
      s.inserts++;
      if (s.inserts % 500 === 0 || at - s.lastPurge > 600_000) purgeLog(at);
      return null;
    }
    const r = s.insert.run({
      t: at,
      kind: e.kind,
      action: clip(e.action, 80),
      type: e.type,
      user: clip(e.user, 64),
      page_id: e.pageId,
      page: clip(e.page, 120),
      target: clip(e.target, 200),
      rev_from: e.revFrom,
      rev_to: e.revTo,
      result: e.result,
      ms: e.ms === null ? null : Math.round(e.ms * 100) / 100,
      version: clip(e.version, 32),
      label: clip(e.label, 300),
      summary: e.summary === undefined || e.summary === null ? null : clip(JSON.stringify(e.summary), 6000),
    });
    s.inserts++;
    if (s.inserts % 500 === 0 || at - s.lastPurge > 600_000) purgeLog(at);
    return Number(r.lastInsertRowid);
  } catch (error) {
    console.error("[journal] écriture impossible :", (error as Error).message);
    return null;
  }
}

export type Filters = { pageId?: number | "none" | null; type?: string | null; result?: string | null; from?: number | null; to?: number | null; kind?: string | null };

function where(f: Filters): { sql: string; args: unknown[] } {
  const c: string[] = [];
  const a: unknown[] = [];
  if (f.pageId === "none") c.push("page_id IS NULL");
  else if (typeof f.pageId === "number") (c.push("page_id = ?"), a.push(f.pageId));
  if (f.type) (c.push("type = ?"), a.push(f.type));
  if (f.result) (c.push("result = ?"), a.push(f.result));
  if (f.kind) (c.push("kind = ?"), a.push(f.kind));
  if (typeof f.from === "number") (c.push("t >= ?"), a.push(f.from));
  if (typeof f.to === "number") (c.push("t < ?"), a.push(f.to));
  return { sql: c.length ? `WHERE ${c.join(" AND ")}` : "", args: a };
}

const toEntry = (r: Row): Entry => ({
  id: r.id,
  t: r.t,
  kind: r.kind as Entry["kind"],
  action: r.action,
  type: r.type as EntryType,
  user: r.user,
  pageId: r.page_id,
  page: r.page,
  target: r.target,
  revFrom: r.rev_from,
  revTo: r.rev_to,
  result: r.result as EntryResult,
  ms: r.ms,
  version: r.version,
  label: r.label,
  summary: r.summary ? safeParse(r.summary) : null,
});

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Entrées les plus récentes d'abord. */
export function listEntries(f: Filters = {}, limit = 100, offset = 0): { rows: Entry[]; total: number } {
  try {
    const s = open();
    const w = where(f);
    const total = (s.db.prepare(`SELECT COUNT(*) AS n FROM edit_log ${w.sql}`).get(...w.args) as { n: number }).n;
    const rows = (s.db.prepare(`SELECT * FROM edit_log ${w.sql} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...w.args, limit, offset) as Row[]).map(toEntry);
    return { rows, total };
  } catch {
    return { rows: [], total: 0 };
  }
}

/** Pages et types présents dans le journal (listes de l'écran de filtres). */
export function facets(): { pages: { id: number; title: string }[]; types: string[]; count: number } {
  try {
    const s = open();
    const pages = s.db.prepare("SELECT page_id AS id, page AS title FROM edit_log WHERE page_id IS NOT NULL GROUP BY page_id ORDER BY MAX(id) DESC LIMIT 100").all() as { id: number; title: string }[];
    const types = (s.db.prepare("SELECT DISTINCT type FROM edit_log ORDER BY type").all() as { type: string }[]).map((r) => r.type);
    const count = (s.db.prepare("SELECT COUNT(*) AS n FROM edit_log").get() as { n: number }).n;
    return { pages, types, count };
  } catch {
    return { pages: [], types: [], count: 0 };
  }
}

/** Ouvre le journal au démarrage (schéma, purge) pour que la première écriture ne paie pas l'ouverture. Renvoie le nombre d'entrées. */
export function warmLog(): number {
  try {
    return (open().db.prepare("SELECT COUNT(*) AS n FROM edit_log").get() as { n: number }).n;
  } catch (error) {
    console.error("[journal] ouverture impossible :", (error as Error).message);
    return 0;
  }
}

/** Fermeture propre (tests et arrêt). */
export function closeLog(): void {
  try {
    g.__editLog?.db.close();
  } catch {
    // rien
  }
  g.__editLog = undefined;
}
