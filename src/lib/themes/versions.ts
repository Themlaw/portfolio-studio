/**
 * « Mon thème » et ses versions (lot 60). Les thèmes livrés sont des MODÈLES, jamais modifiés ; l'utilisatrice a UN « Mon thème »
 * (ligne `themes` avec `mine`) qui évolue par versions : chaque application d'un kit, import, changement de modèle et
 * enregistrement de l'éditeur crée une version (instantané complet dans `theme_versions`, avec ses références du kit, rangées par
 * leur contenu sous /media/kit/… : jamais dupliquées).
 *
 * Modèle de données (aucune lecture du site public ne change) :
 * - `themes.data`  = la version EN COURS (brouillon) : éditeur, aperçu, kit, export ;
 * - `themes.live_data` = la version PUBLIÉE quand elle diffère de la version en cours (null : la publiée EST `data`) ; le site public lit
 *   `live_data ?? data` (src/lib/theme.ts) ;
 * - enregistrer ou créer une version ne publie jamais : seule « Publier cette version » met `activeThemeId` sur Mon thème et aligne la publiée.
 *
 * Rétention : toutes les versions marquées (`pinned`, dont celles qui ont été publiées) et les RETAIN_UNPINNED dernières sinon ;
 * la version en cours et la version publiée ne sont jamais supprimées.
 */
import { and, desc, eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { parseJson } from "@/lib/json";
import { slugify } from "@/lib/slug";
import { normalizePalette } from "@/themes/palette";
import { ThemeSchema, type Theme } from "@/themes/schema";

import { done, fail, type ActionResult } from "../edit/result";
import { PRESETS } from "@/themes/presets";

import { cleanThemeName, ownThemeName, summarizeVersion, type VersionSource } from "./summary";

export const MINE_DEFAULT_NAME = "Mon thème";
const presetNames = () => Object.values(PRESETS).map((p) => p.name);
export const RETAIN_UNPINNED = 30;
/** Enregistrements de l'éditeur regroupés en UNE version tant que la séance dure (sans pause plus longue que cela). */
export const EDITOR_SESSION_MS = 10 * 60 * 1000;

type ThemeRow = typeof schema.themes.$inferSelect;
type VersionRow = typeof schema.themeVersions.$inferSelect;

export type VersionInfo = {
  n: number;
  source: string;
  summary: string;
  /** Millisecondes. */
  createdAt: number;
  pinned: boolean;
  published: boolean;
  current: boolean;
};

export type MineState = {
  id: string;
  name: string;
  basedOn: string | null;
  version: number;
  publishedVersion: number | null;
  /** Mon thème est le thème en ligne. */
  live: boolean;
  /** Millisecondes : dernière modification de la version en cours. */
  updatedAt: number;
  /** Version en cours (brouillon). */
  theme: Theme;
  /** Version publiée si elle diffère de la version en cours ; sinon `theme`. null : jamais publiée. */
  published: Theme | null;
  versions: number;
};

const parseTheme = (text: string | null | undefined): Theme | null => {
  const parsed = ThemeSchema.safeParse(parseJson(text));
  return parsed.success ? parsed.data : null;
};

export function activeThemeId(): string {
  const row = getDb().select().from(schema.settings).where(eq(schema.settings.key, "activeThemeId")).get();
  const value = parseJson(row?.value);
  return typeof value === "string" ? value : "";
}

export function getMineRow(): ThemeRow | null {
  return getDb().select().from(schema.themes).where(eq(schema.themes.mine, true)).get() ?? null;
}

export function getMineState(): MineState | null {
  const row = getMineRow();
  if (!row) return null;
  const theme = parseTheme(row.data);
  if (!theme) return null;
  const published = row.publishedVersion == null ? null : row.liveData ? parseTheme(row.liveData) : theme;
  const versions = getDb().select({ n: schema.themeVersions.n }).from(schema.themeVersions).where(eq(schema.themeVersions.themeId, row.id)).all().length;
  return {
    id: row.id,
    name: row.name,
    basedOn: row.basedOn,
    version: row.version,
    publishedVersion: row.publishedVersion,
    live: activeThemeId() === row.id,
    updatedAt: row.updatedAt.getTime(),
    theme,
    published,
    versions,
  };
}

function versionRow(themeId: string, n: number): VersionRow | undefined {
  return getDb().select().from(schema.themeVersions).where(and(eq(schema.themeVersions.themeId, themeId), eq(schema.themeVersions.n, n))).get();
}

/** Thème d'une version (instantané), ou null. */
export function getVersionTheme(themeId: string, n: number): Theme | null {
  const row = versionRow(themeId, n);
  return row ? parseTheme(row.data) : null;
}

export function listVersions(themeId: string): VersionInfo[] {
  const row = getDb().select().from(schema.themes).where(eq(schema.themes.id, themeId)).get();
  if (!row) return [];
  return getDb()
    .select()
    .from(schema.themeVersions)
    .where(eq(schema.themeVersions.themeId, themeId))
    .orderBy(desc(schema.themeVersions.n))
    .all()
    .map((v) => ({
      n: v.n,
      source: v.source,
      summary: v.summary,
      createdAt: v.createdAt.getTime(),
      pinned: v.pinned,
      published: row.publishedVersion === v.n,
      current: row.version === v.n,
    }));
}

/** Identifiant libre : `base`, `base-2`, … */
function freeId(base: string): string {
  const db = getDb();
  let id = base;
  for (let n = 2; db.select({ id: schema.themes.id }).from(schema.themes).where(eq(schema.themes.id, id)).get(); n++) id = `${base}-${n}`;
  return id;
}

/** Nettoyage : garde les versions marquées, la version en cours, la publiée et les RETAIN_UNPINNED dernières ; supprime le reste. */
export function pruneVersions(themeId: string, retain = RETAIN_UNPINNED): number {
  const db = getDb();
  const row = db.select().from(schema.themes).where(eq(schema.themes.id, themeId)).get();
  if (!row) return 0;
  const all = db.select().from(schema.themeVersions).where(eq(schema.themeVersions.themeId, themeId)).orderBy(desc(schema.themeVersions.n)).all();
  const keep = new Set<number>([row.version]);
  if (row.publishedVersion != null) keep.add(row.publishedVersion);
  for (const v of all) if (v.pinned) keep.add(v.n);
  for (const v of all.slice(0, retain)) keep.add(v.n);
  const drop = all.filter((v) => !keep.has(v.n));
  for (const v of drop) db.delete(schema.themeVersions).where(and(eq(schema.themeVersions.themeId, themeId), eq(schema.themeVersions.n, v.n))).run();
  return drop.length;
}

type WriteOptions = {
  source: VersionSource;
  /** Texte du résumé (sinon généré par comparaison avec la version précédente). */
  detail?: string;
  /** Enregistrement de l'éditeur : regroupé dans la version en cours si la séance est ouverte. */
  coalesce?: boolean;
  basedOn?: string | null;
  now?: Date;
};

/**
 * Écrit une nouvelle version de Mon thème (ou met à jour la version en cours d'une séance d'édition). Renvoie le numéro, et si une
 * version a réellement été écrite (`changed` faux : réglages identiques, rien n'est créé).
 */
function writeVersion(row: ThemeRow, input: Theme, opts: WriteOptions): { n: number; changed: boolean } {
  const db = getDb();
  const now = opts.now ?? new Date();
  const prev = parseTheme(row.data);
  // Le nom de Mon thème ne change que par l'éditeur (champ « Nom ») ou en revenant à une version : un modèle, un kit, un import ne le renomment pas.
  const name = opts.source === "editor" || opts.source === "revert" ? input.name || row.name : row.name;
  const data: Theme = { ...input, id: row.id, name, preset: false };
  const json = JSON.stringify(data);
  if (opts.coalesce && row.data === json && opts.basedOn === undefined) return { n: row.version, changed: false };
  const result = db.transaction((tx) => {
    const last = tx.select().from(schema.themeVersions).where(and(eq(schema.themeVersions.themeId, row.id), eq(schema.themeVersions.n, row.version))).get();
    const open =
      opts.coalesce === true &&
      last !== undefined &&
      last.source === "editor" &&
      !last.sealed &&
      row.version !== row.publishedVersion &&
      !last.pinned &&
      now.getTime() - last.createdAt.getTime() < EDITOR_SESSION_MS;
    if (open && last) {
      // Même séance : la version en cours est réécrite (sa date devient celle de la dernière modification).
      const base = row.version > 1 ? getVersionTheme(row.id, row.version - 1) : null;
      tx.update(schema.themeVersions)
        .set({ data: json, summary: summarizeVersion("editor", base, data), createdAt: now })
        .where(and(eq(schema.themeVersions.themeId, row.id), eq(schema.themeVersions.n, last.n)))
        .run();
      tx.update(schema.themes).set({ name, data: json, updatedAt: now, ...(opts.basedOn !== undefined ? { basedOn: opts.basedOn } : {}) }).where(eq(schema.themes.id, row.id)).run();
      return { n: last.n, changed: true };
    }
    const n = row.version + 1;
    // La version publiée était la version en cours : elle est figée dans `live_data` avant d'écrire le brouillon.
    const freeze = row.publishedVersion != null && row.publishedVersion === row.version && row.liveData == null ? { liveData: row.data } : {};
    tx.insert(schema.themeVersions)
      .values({ themeId: row.id, n, data: json, source: opts.source, summary: summarizeVersion(opts.source, prev, data, opts.detail), createdAt: now, pinned: false, sealed: false })
      .run();
    tx.update(schema.themes)
      .set({ name, data: json, version: n, updatedAt: now, ...freeze, ...(opts.basedOn !== undefined ? { basedOn: opts.basedOn } : {}) })
      .where(eq(schema.themes.id, row.id))
      .run();
    return { n, changed: true };
  });
  // Rétention : les 30 dernières, les marquées, la version en cours et la publiée.
  if (result.changed) pruneVersions(row.id);
  return result;
}

/** Crée Mon thème (version 1) à partir d'un thème. Échoue s'il existe déjà. */
function createMine(theme: Theme, opts: { source: VersionSource; detail?: string; basedOn: string | null; name?: string; now?: Date }): ThemeRow {
  const db = getDb();
  const now = opts.now ?? new Date();
  const id = freeId("mon-theme");
  const name = opts.name ?? MINE_DEFAULT_NAME;
  const data: Theme = { ...theme, id, name, preset: false };
  const json = JSON.stringify(data);
  db.transaction((tx) => {
    tx.insert(schema.themes).values({ id, name, preset: false, data: json, mine: true, basedOn: opts.basedOn, version: 1, publishedVersion: null, liveData: null, updatedAt: now }).run();
    tx.insert(schema.themeVersions).values({ themeId: id, n: 1, data: json, source: opts.source, summary: summarizeVersion(opts.source, null, data, opts.detail), createdAt: now, pinned: false, sealed: false }).run();
  });
  return db.select().from(schema.themes).where(eq(schema.themes.id, id)).get()!;
}

function themeRow(id: string): { row: ThemeRow; theme: Theme } | null {
  const row = getDb().select().from(schema.themes).where(eq(schema.themes.id, id)).get();
  const theme = row ? parseTheme(row.data) : null;
  return row && theme ? { row, theme } : null;
}

/** Met un thème en ligne SANS toucher au « thème précédent » (création de Mon thème à partir du modèle déjà en ligne : rien ne change à l'écran). */
function setActive(id: string) {
  const v = JSON.stringify(id);
  getDb().insert(schema.settings).values({ key: "activeThemeId", value: v }).onConflictDoUpdate({ target: schema.settings.key, set: { value: v } }).run();
}

/** Publie la version EN COURS de Mon thème : elle devient la version publiée (le site public la lit). Ne change pas le thème actif. */
export function alignPublished(themeId: string): void {
  const db = getDb();
  const row = db.select().from(schema.themes).where(eq(schema.themes.id, themeId)).get();
  if (!row?.mine) return;
  db.transaction((tx) => {
    tx.update(schema.themes).set({ publishedVersion: row.version, liveData: null }).where(eq(schema.themes.id, themeId)).run();
    // Une version qui a été en ligne est gardée : le nettoyage ne la supprime pas.
    tx.update(schema.themeVersions).set({ pinned: true }).where(and(eq(schema.themeVersions.themeId, themeId), eq(schema.themeVersions.n, row.version))).run();
  });
}

/* ---- Actions de l'utilisatrice ------------------------------------------ */

export type ApplyModelResult = { id: string; version: number; created: boolean; published: boolean };

/**
 * « Utiliser ce modèle ». Sans Mon thème : le crée (version 1) ; si ce modèle est déjà le thème en ligne, Mon thème en prend aussitôt la
 * place (même rendu, rien ne bouge pour les visiteurs). Avec Mon thème : `replace` = nouvelle version de Mon thème à partir du modèle ;
 * `second` = un thème à part (ancien thème), Mon thème reste tel quel.
 */
export function applyModel(modelId: string, mode?: "replace" | "second"): ActionResult<ApplyModelResult & { second?: boolean }> {
  const model = themeRow(modelId);
  if (!model) return fail("Ce modèle n'existe plus. Recharge la page.");
  if (!model.row.preset) return fail("Ce thème n'est pas un modèle.");
  const mine = getMineRow();
  if (!mine) {
    const row = createMine(model.theme, { source: "model", detail: model.theme.name, basedOn: model.theme.name });
    const published = activeThemeId() === modelId;
    if (published) {
      setActive(row.id);
      alignPublished(row.id);
    }
    return done({ id: row.id, version: 1, created: true, published });
  }
  if (mode === "second") {
    const copy = createSecondTheme(model.theme);
    return done({ id: copy, version: 0, created: true, published: false, second: true });
  }
  if (mode !== "replace") return fail("Choisis : remplacer Mon thème, ou créer un second thème.");
  const written = writeVersion(mine, model.theme, { source: "model", detail: model.theme.name, basedOn: model.theme.name });
  return done({ id: mine.id, version: written.n, created: false, published: false });
}

/** Thème à part (hors Mon thème) à partir d'un thème : va dans « Mes anciens thèmes ». */
export function createSecondTheme(theme: Theme, name?: string): string {
  const db = getDb();
  const base = slugify(name ?? theme.name) || "theme";
  const id = freeId(`${base}-copie`);
  const label = name ?? theme.name;
  const copy: Theme = { ...theme, id, name: label, preset: false };
  db.insert(schema.themes).values({ id, name: label, preset: false, data: JSON.stringify(copy) }).run();
  return id;
}

/** Enregistrement de l'éditeur : une version par séance. Un enregistrement sans changement ne crée rien. */
export function saveMine(id: string, input: unknown, now?: Date): ActionResult<{ version: number; created: boolean }> {
  const current = themeRow(id);
  if (!current?.row.mine) return fail("Ce n'est pas Mon thème.");
  const parsed = ThemeSchema.safeParse({ ...(input as object), id, preset: false });
  if (!parsed.success) return fail("Certains réglages sont invalides : corrige les champs signalés.");
  const data: Theme = { ...parsed.data, tokens: { ...parsed.data.tokens, color: normalizePalette(parsed.data.tokens.color, parsed.data.tokens.palette) } };
  const written = writeVersion(current.row, data, { source: "editor", coalesce: true, now });
  return done({ version: written.n, created: written.changed });
}

/** Fin de séance d'édition (sortie de l'éditeur) : le prochain enregistrement crée une nouvelle version. */
export function sealEditorSession(id: string): void {
  const row = getDb().select().from(schema.themes).where(eq(schema.themes.id, id)).get();
  if (!row?.mine) return;
  getDb().update(schema.themeVersions).set({ sealed: true }).where(and(eq(schema.themeVersions.themeId, id), eq(schema.themeVersions.n, row.version))).run();
}

/** Nouvelle version venant du kit Photoshop (thème complet déjà construit par apply.ts). */
export function addKitVersion(theme: Theme, fallbackBase: Theme): { id: string; version: number; created: boolean } {
  let mine = getMineRow();
  let created = false;
  if (!mine) {
    mine = createMine(fallbackBase, { source: "model", detail: fallbackBase.name, basedOn: cleanThemeName(fallbackBase.name) });
    created = true;
  }
  const written = writeVersion(mine, theme, { source: "kit" });
  return { id: mine.id, version: written.n, created };
}

/** Import d'une archive « comme nouvelle version de mon thème ». Sans Mon thème : il est créé depuis l'archive. */
export function addImportedVersion(theme: Theme, fileLabel?: string): { id: string; version: number; created: boolean } {
  const mine = getMineRow();
  if (!mine) {
    const row = createMine(theme, { source: "import", detail: fileLabel, basedOn: cleanThemeName(theme.name), name: ownThemeName(theme.name, presetNames()) });
    return { id: row.id, version: 1, created: true };
  }
  const written = writeVersion(mine, theme, { source: "import", detail: fileLabel, basedOn: cleanThemeName(theme.name) });
  return { id: mine.id, version: written.n, created: false };
}

/** « Revenir à cette version » : une NOUVELLE version identique à l'ancienne (rien n'est perdu). */
export function revertToVersion(id: string, n: number): ActionResult<{ version: number }> {
  const current = themeRow(id);
  if (!current?.row.mine) return fail("Ce n'est pas Mon thème.");
  const old = getVersionTheme(id, n);
  if (!old) return fail("Cette version n'existe plus (le nettoyage garde les 30 dernières). Recharge la page.");
  const written = writeVersion(current.row, old, { source: "revert", detail: String(n) });
  return done({ version: written.n });
}

/** « Garder une copie à part » : la version devient un thème à part (dans « Mes anciens thèmes »). */
export function keepVersionCopy(id: string, n: number): ActionResult<{ id: string; name: string }> {
  const current = themeRow(id);
  if (!current?.row.mine) return fail("Ce n'est pas Mon thème.");
  const old = getVersionTheme(id, n);
  if (!old) return fail("Cette version n'existe plus. Recharge la page.");
  const name = `${current.row.name} (version ${n})`.slice(0, 80);
  const copyId = createSecondTheme(old, name);
  return done({ id: copyId, name });
}

/** Marque (ou démarque) une version : le nettoyage ne supprime jamais une version marquée. */
export function pinVersion(id: string, n: number, pinned: boolean): ActionResult<null> {
  if (!versionRow(id, n)) return fail("Cette version n'existe plus. Recharge la page.");
  getDb().update(schema.themeVersions).set({ pinned }).where(and(eq(schema.themeVersions.themeId, id), eq(schema.themeVersions.n, n))).run();
  return done(null);
}

/** « En faire mon thème (nouvelle version) » : un ancien thème (copie, import…) devient une version de Mon thème (créé s'il n'existe pas). */
export function adoptOldTheme(oldId: string): ActionResult<{ id: string; version: number; created: boolean }> {
  const old = themeRow(oldId);
  if (!old) return fail("Ce thème n'existe plus. Recharge la page.");
  if (old.row.preset || old.row.mine) return fail("Ce thème n'est pas un ancien thème.");
  const mine = getMineRow();
  const basedOn = cleanThemeName(old.theme.name);
  if (!mine) {
    const row = createMine(old.theme, { source: "adopt", detail: old.theme.name, basedOn, name: ownThemeName(old.theme.name, presetNames()) });
    return done({ id: row.id, version: 1, created: true });
  }
  const written = writeVersion(mine, old.theme, { source: "adopt", detail: old.theme.name, basedOn });
  return done({ id: mine.id, version: written.n, created: false });
}

/** Suppression de Mon thème refusée ; ses versions partent avec un thème supprimé (jamais appelé pour Mon thème). */
export function deleteVersionsOf(themeId: string): void {
  getDb().delete(schema.themeVersions).where(eq(schema.themeVersions.themeId, themeId)).run();
}

/* ---- Lecture pour l'écran Thèmes ---------------------------------------- */

export type OldTheme = { theme: Theme; updatedAt: number };

export function getThemeLibrary(): { activeId: string; mine: MineState | null; models: Theme[]; olds: OldTheme[] } {
  const db = getDb();
  const rows = db.select().from(schema.themes).all();
  const models: Theme[] = [];
  const olds: OldTheme[] = [];
  for (const row of rows) {
    if (row.mine) continue;
    const theme = parseTheme(row.data);
    if (!theme) continue;
    if (row.preset) models.push(theme);
    else olds.push({ theme, updatedAt: row.updatedAt.getTime() });
  }
  models.sort((a, b) => a.name.localeCompare(b.name, "fr"));
  olds.sort((a, b) => b.updatedAt - a.updatedAt || a.theme.name.localeCompare(b.theme.name, "fr"));
  return { activeId: activeThemeId(), mine: getMineState(), models, olds };
}
