/**
 * Brouillons de l'éditeur visuel (docs/ARCHITECTURE.md, « Brouillon et
 * publication »).
 *
 * Page : `pages.draft` (JSON) porte TOUT l'état éditable (titre, adresses,
 * méta, publication, menu, accent, blocs avec un identifiant stable `uid`) ;
 * null = pas de brouillon, la version publiée fait foi. L'enregistrement
 * automatique ne contrôle que la forme (types connus, tailles) : un bloc
 * incomplet reste un brouillon. « Publier » passe le brouillon à savePage()
 * — exactement la validation d'un enregistrement — puis vide le brouillon.
 *
 * Contrôle optimiste : `pages.draft_rev` augmente à chaque écriture du contenu
 * éditable (brouillon, publication, abandon, formulaire). Chaque écriture
 * envoie la version qu'elle a lue ; si la base a changé entre-temps (autre
 * onglet, formulaire), elle est refusée (`code: "conflict"`) au lieu
 * d'écraser en silence.
 *
 * Emplacements : surcouche sur la table `slots` (données de projet
 * partagées entre pages) — `draft_state` (« added » : créé dans un
 * brouillon, invisible publiquement ; « removed » : média retiré, la place
 * sera gardée), `draft_position`, `draft_media_id`, et `draft_page_id` : la
 * page dont le brouillon la porte. Le site public ne lit jamais ces colonnes ;
 * la vue brouillon de CETTE page les applique. Publier la page applique sa
 * surcouche ; « Abandonner » l'efface (ses emplacements « added » sont
 * supprimés). Une autre page qui partage le projet n'y touche jamais.
 */
import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { z } from "zod";

import { BLOCKS } from "@/blocks/registry";
import { extractProjectRefs } from "@/blocks/refs";
import { getPageForEdit } from "@/lib/admin";
import { getDb, schema } from "@/lib/db";
import { own } from "@/lib/own";

import { savePage } from "./pages";
import { done, fail, zodFieldErrors, type ActionResult } from "./result";

type L = { fr: string; en: string };

export type DraftBlock = { uid: string; type: string; props: Record<string, unknown> };
export type PageDraft = {
  title: L;
  slug: L;
  meta: { title: L; description: L };
  published: boolean;
  inMenu: boolean;
  accent: string | null;
  blocks: DraftBlock[];
};

/** Refus d'écriture : version périmée, ou brouillon illisible à trancher d'abord. */
export type DraftRefusal = { ok: false; message: string; code: "conflict" | "corrupt"; rev: number };
export type DraftResult<T> = ActionResult<T> | DraftRefusal;

/** Taille maximale d'un brouillon sérialisé. */
export const MAX_DRAFT_BYTES = 256 * 1024;
/** Profondeur maximale d'imbrication JSON d'un brouillon. */
export const MAX_DRAFT_DEPTH = 16;

const CONFLICT_MESSAGE = "Cette page a été modifiée ailleurs (autre onglet, formulaire ou publication). Recharge pour reprendre la dernière version.";
const CORRUPT_MESSAGE = "Ce brouillon ne peut plus être lu (un composant a changé) : repars d'abord de la version publiée.";

const l = (max: number) => z.object({ fr: z.string().max(max), en: z.string().max(max) });
const DraftSchema = z.object({
  title: l(200),
  slug: l(120),
  meta: z.object({ title: l(200), description: l(400) }),
  published: z.boolean(),
  inMenu: z.boolean(),
  accent: z.string().max(7).nullable(),
  blocks: z
    .array(
      z.object({
        uid: z.string().regex(/^[a-z0-9-]{1,32}$/),
        type: z.string().max(60).refine((t) => Boolean(own(BLOCKS, t)), "Type de bloc inconnu."),
        props: z.record(z.string(), z.unknown()),
      }),
    )
    .max(40, "40 blocs au plus par page."),
});

/** Profondeur d'imbrication d'une valeur JSON (s'arrête dès que `limit` est dépassé). */
function depthExceeds(value: unknown, limit: number, depth = 0): boolean {
  if (depth > limit) return true;
  if (value === null || typeof value !== "object") return false;
  for (const v of Array.isArray(value) ? value : Object.values(value)) if (depthExceeds(v, limit, depth + 1)) return true;
  return false;
}

function pageRow(pageId: number) {
  return getDb()
    .select({ draft: schema.pages.draft, at: schema.pages.draftUpdatedAt, rev: schema.pages.draftRev })
    .from(schema.pages)
    .where(eq(schema.pages.id, pageId))
    .get();
}

export type DraftState = {
  draft: PageDraft;
  /** Un brouillon est enregistré (lisible ou non). */
  hasDraft: boolean;
  /** Brouillon enregistré mais illisible : `draft` est alors la version publiée. */
  corrupt: boolean;
  updatedAt: Date | null;
  rev: number;
  isHome: boolean;
};

/** Brouillon d'une page tel que l'éditeur le reprend : le brouillon enregistré, sinon la version publiée. */
export function readDraft(pageId: number): DraftState | null {
  const row = pageRow(pageId);
  const page = getPageForEdit(pageId);
  if (!row || !page) return null;
  const parsed = DraftSchema.safeParse(row.draft);
  if (parsed.success) return { draft: parsed.data as PageDraft, hasDraft: true, corrupt: false, updatedAt: row.at ?? null, rev: row.rev, isHome: page.isHome };
  const corrupt = row.draft !== null;
  if (corrupt) console.error(`[brouillon] page ${pageId} : brouillon illisible, en attente d'un choix explicite`);
  const { title, slug, meta, published, inMenu, accent, blocks } = page;
  return {
    draft: { title, slug, meta, published, inMenu, accent, blocks: blocks.map((b, i) => ({ uid: `b${i}`, type: b.type, props: b.props })) },
    hasDraft: corrupt,
    corrupt,
    updatedAt: row.at ?? null,
    rev: row.rev,
    isHome: page.isHome,
  };
}

const conflict = (rev: number): DraftRefusal => ({ ok: false, message: CONFLICT_MESSAGE, code: "conflict", rev });
const corruptRefusal = (rev: number): DraftRefusal => ({ ok: false, message: CORRUPT_MESSAGE, code: "corrupt", rev });
const isCorrupt = (draft: unknown) => draft !== null && !DraftSchema.safeParse(draft).success;
const validRev = (rev: unknown): rev is number => Number.isInteger(rev) && (rev as number) >= 0;

/** Enregistrement automatique : forme contrôlée, contenu pas encore (c'est un brouillon). */
export function saveDraft(pageId: number, input: unknown, rev: unknown): DraftResult<{ savedAt: number; rev: number }> {
  try {
    if (!validRev(rev)) return fail("Requête invalide (version manquante) : recharge l'éditeur.");
    const row = pageRow(pageId);
    if (!row) return fail("Cette page n'existe plus.");
    if (row.rev !== rev) return conflict(row.rev);
    if (isCorrupt(row.draft)) return corruptRefusal(row.rev);
    if (depthExceeds(input, MAX_DRAFT_DEPTH)) return fail("Brouillon invalide (imbrication trop profonde) : recharge l'éditeur.");
    const json = JSON.stringify(input);
    if (json === undefined || Buffer.byteLength(json) > MAX_DRAFT_BYTES) return fail("Ce brouillon est trop lourd : retire des blocs ou raccourcis les textes.");
    const parsed = DraftSchema.safeParse(input);
    if (!parsed.success) return fail("Brouillon invalide : recharge l'éditeur.", zodFieldErrors(parsed.error.issues));
    const uids = parsed.data.blocks.map((b) => b.uid);
    if (new Set(uids).size !== uids.length) return fail("Brouillon invalide (blocs en double) : recharge l'éditeur.");
    const now = new Date();
    // Écriture conditionnelle : la version n'a pas bougé depuis la lecture.
    const result = getDb()
      .update(schema.pages)
      .set({ draft: parsed.data, draftUpdatedAt: now, draftRev: rev + 1 })
      .where(and(eq(schema.pages.id, pageId), eq(schema.pages.draftRev, rev)))
      .run();
    if (result.changes !== 1) return conflict(pageRow(pageId)?.rev ?? rev);
    return done({ savedAt: now.getTime(), rev: rev + 1 });
  } catch (error) {
    console.error(`[brouillon] page ${pageId} : enregistrement impossible`, error);
    return fail("Brouillon invalide : recharge l'éditeur.");
  }
}

/* ---- Emplacements : surcouche de brouillon -------------------------------- */

/**
 * Projets dont les planches apparaissent dans ces blocs : projets choisis
 * (`projects` déclarés dans refs.ts), projets d'une collection (planches de
 * collection), projets mis en avant (projets mis en avant sans choix).
 * Sert à revalider le cache des projets touchés par une publication.
 */
export function referencedProjects(blocks: { type: string; props: unknown }[]): number[] {
  const db = getDb();
  const ids = new Set<number>();
  const slugs = new Set<string>();
  const collections = new Set<string>();
  let featured = false;
  for (const b of blocks) {
    for (const s of extractProjectRefs(b.type, b.props)) slugs.add(s);
    const p = (b.props ?? {}) as Record<string, unknown>;
    if (b.type === "collection-projects" && typeof p.collection === "string") collections.add(p.collection);
    if (b.type === "featured-projects" && !(Array.isArray(p.projects) && p.projects.length)) featured = true;
  }
  if (slugs.size) for (const r of db.select({ id: schema.projects.id }).from(schema.projects).where(inArray(schema.projects.slug, [...slugs])).all()) ids.add(r.id);
  if (featured) for (const r of db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.featured, true)).all()) ids.add(r.id);
  if (collections.size) {
    for (const r of db
      .select({ id: schema.slots.projectId })
      .from(schema.slots)
      .where(inArray(schema.slots.collection, [...collections] as ("characters" | "backgrounds" | "animation")[]))
      .all())
      ids.add(r.id);
  }
  return [...ids].sort((a, b) => a - b);
}

const hasSlotDraft = or(isNotNull(schema.slots.draftState), isNotNull(schema.slots.draftPosition), isNotNull(schema.slots.draftMediaId));
const CLEAR = { draftState: null, draftPosition: null, draftMediaId: null, draftPageId: null } as const;
/*
 * Une seule connexion SQLite (better-sqlite3, synchrone) : appelées dans une
 * transaction, ces fonctions en font partie, getDb() compris.
 */

/** Emplacements d'un projet avec une modification de brouillon en attente. */
export function pendingSlotDrafts(projectId: number): number {
  return getDb().select({ id: schema.slots.id }).from(schema.slots).where(and(eq(schema.slots.projectId, projectId), hasSlotDraft)).all().length;
}

/** Surcouche d'un emplacement, portée par le brouillon de `pageId` (éditeur visuel, phase 7b ; tests). */
export function setSlotDraft(pageId: number, slotId: number, patch: { state?: "added" | "removed" | null; position?: number | null; mediaId?: number | null }): void {
  const set: Partial<typeof schema.slots.$inferInsert> = { draftPageId: pageId };
  if (patch.state !== undefined) set.draftState = patch.state;
  if (patch.position !== undefined) set.draftPosition = patch.position;
  if (patch.mediaId !== undefined) set.draftMediaId = patch.mediaId;
  getDb().update(schema.slots).set(set).where(eq(schema.slots.id, slotId)).run();
}

/** Applique la surcouche portée par le brouillon d'une page (publication). Renvoie les projets touchés. */
export function applySlotDrafts(pageId: number): number[] {
  const db = getDb();
  const rows = db.select().from(schema.slots).where(eq(schema.slots.draftPageId, pageId)).all();
  for (const s of rows) {
    const patch: Partial<typeof schema.slots.$inferInsert> = { ...CLEAR };
    if (s.draftPosition !== null) patch.position = s.draftPosition;
    if (s.draftMediaId !== null) patch.mediaId = s.draftMediaId;
    // Média retiré : la place est gardée (comme dans l'écran Projets).
    if (s.draftState === "removed") patch.mediaId = null;
    db.update(schema.slots).set(patch).where(eq(schema.slots.id, s.id)).run();
  }
  return [...new Set(rows.map((s) => s.projectId))];
}

/** Efface la surcouche portée par le brouillon d'une page (abandon) : ses emplacements « added » disparaissent. */
export function discardSlotDrafts(pageId: number): number[] {
  const db = getDb();
  const rows = db.select({ id: schema.slots.id, state: schema.slots.draftState, projectId: schema.slots.projectId }).from(schema.slots).where(eq(schema.slots.draftPageId, pageId)).all();
  for (const s of rows) {
    if (s.state === "added") db.delete(schema.slots).where(eq(schema.slots.id, s.id)).run();
    else db.update(schema.slots).set(CLEAR).where(eq(schema.slots.id, s.id)).run();
  }
  return [...new Set(rows.map((s) => s.projectId))];
}

/* ---- Publier, abandonner -------------------------------------------------- */

export type PublishResult = { projects: number[]; blocks: number; rev: number };

/**
 * Publie le brouillon, en une transaction : validation et écriture de
 * savePage() (erreurs par champ, `blocks.<i>…` dans l'ordre du brouillon),
 * surcouche de la page appliquée, brouillon vidé, version incrémentée. Sans
 * brouillon (ou brouillon illisible, ou version périmée) : refus immédiat,
 * rien n'est écrit.
 */
export function publishDraft(pageId: number, rev: unknown): DraftResult<PublishResult> {
  if (!validRev(rev)) return fail("Requête invalide (version manquante) : recharge l'éditeur.");
  const state = readDraft(pageId);
  if (!state) return fail("Cette page n'existe plus.");
  if (state.rev !== rev) return conflict(state.rev);
  if (state.corrupt) return corruptRefusal(state.rev);
  if (!state.hasDraft) return fail("Aucune modification à publier.");
  // Version publiée lue AVANT l'écriture : les projets retirés du brouillon
  // sont revalidés eux aussi.
  const before = getPageForEdit(pageId);
  const { draft } = state;
  const db = getDb();
  let outcome: DraftResult<PublishResult> = fail("Publication impossible.");
  try {
    db.transaction((tx) => {
      const result = savePage(pageId, { ...draft, blocks: draft.blocks.map(({ type, props }) => ({ type, props })) });
      if (!result.ok) {
        outcome = result;
        return;
      }
      const touched = applySlotDrafts(pageId);
      const cleared = tx
        .update(schema.pages)
        .set({ draft: null, draftUpdatedAt: null, draftRev: rev + 1 })
        .where(and(eq(schema.pages.id, pageId), eq(schema.pages.draftRev, rev)))
        .run();
      // Écrit entre la lecture et la transaction : tout est annulé.
      if (cleared.changes !== 1) throw new ConflictError();
      const projects = [...new Set([...referencedProjects([...draft.blocks, ...(before?.blocks ?? [])]), ...touched])].sort((a, b) => a - b);
      outcome = done({ projects, blocks: draft.blocks.length, rev: rev + 1 });
    });
  } catch (error) {
    if (error instanceof ConflictError) return conflict(pageRow(pageId)?.rev ?? rev);
    throw error;
  }
  return outcome;
}

class ConflictError extends Error {}

/** Abandonne le brouillon (même illisible) et la surcouche que la page portait. */
export function discardDraft(pageId: number, rev: unknown): DraftResult<{ projects: number[]; rev: number }> {
  if (!validRev(rev)) return fail("Requête invalide (version manquante) : recharge l'éditeur.");
  const row = pageRow(pageId);
  if (!row) return fail("Cette page n'existe plus.");
  if (row.rev !== rev) return conflict(row.rev);
  const db = getDb();
  let projects: number[] = [];
  try {
    db.transaction((tx) => {
      projects = discardSlotDrafts(pageId);
      const cleared = tx
        .update(schema.pages)
        .set({ draft: null, draftUpdatedAt: null, draftRev: rev + 1 })
        .where(and(eq(schema.pages.id, pageId), eq(schema.pages.draftRev, rev)))
        .run();
      if (cleared.changes !== 1) throw new ConflictError();
    });
  } catch (error) {
    if (error instanceof ConflictError) return conflict(pageRow(pageId)?.rev ?? rev);
    throw error;
  }
  return done({ projects, rev: rev + 1 });
}

/** Brouillon en attente sur une page (liste des pages, ancien formulaire). */
export function hasPageDraft(pageId: number): boolean {
  return Boolean(pageRow(pageId)?.draft);
}

/**
 * Enregistrement par l'ancien formulaire de page : il publie (comme avant)
 * ce qu'il montre — le brouillon s'il y en avait un — puis vide le brouillon
 * et applique la surcouche de la page : un seul état, jamais deux. Même
 * contrôle de version que l'éditeur ; un brouillon illisible se tranche
 * d'abord dans l'éditeur.
 */
export function savePageFromForm(pageId: number, input: unknown, rev: unknown): DraftResult<{ projects: number[]; rev: number }> {
  if (!validRev(rev)) return fail("Requête invalide (version manquante) : recharge la page.");
  const row = pageRow(pageId);
  if (!row) return fail("Cette page n'existe plus. Recharge la liste des pages.");
  if (row.rev !== rev) return conflict(row.rev);
  if (isCorrupt(row.draft)) return corruptRefusal(row.rev);
  const before = getPageForEdit(pageId);
  const draftBlocks = (DraftSchema.safeParse(row.draft).data?.blocks ?? []) as DraftBlock[];
  const db = getDb();
  let outcome: DraftResult<{ projects: number[]; rev: number }> = fail("Enregistrement impossible.");
  try {
    db.transaction((tx) => {
      const result = savePage(pageId, input);
      if (!result.ok) {
        outcome = result;
        return;
      }
      const touched = applySlotDrafts(pageId);
      const cleared = tx
        .update(schema.pages)
        .set({ draft: null, draftUpdatedAt: null, draftRev: rev + 1 })
        .where(and(eq(schema.pages.id, pageId), eq(schema.pages.draftRev, rev)))
        .run();
      if (cleared.changes !== 1) throw new ConflictError();
      const after = (input as { blocks?: { type: string; props: unknown }[] })?.blocks ?? [];
      const projects = [...new Set([...referencedProjects([...draftBlocks, ...(before?.blocks ?? []), ...after]), ...touched])];
      outcome = done({ projects, rev: rev + 1 });
    });
  } catch (error) {
    if (error instanceof ConflictError) return conflict(pageRow(pageId)?.rev ?? rev);
    throw error;
  }
  return outcome;
}

/**
 * Publication et menu changés depuis la liste des pages : le brouillon en
 * attente suit (et sa version augmente : un éditeur ouvert le saura), sinon
 * sa publication rétablirait l'ancien réglage.
 */
export function syncDraftFlags(pageId: number, flags: { published?: boolean; inMenu?: boolean }): void {
  const row = pageRow(pageId);
  if (!row?.draft || typeof row.draft !== "object" || Array.isArray(row.draft)) return;
  getDb()
    .update(schema.pages)
    .set({ draft: { ...(row.draft as Record<string, unknown>), ...flags }, draftRev: row.rev + 1 })
    .where(eq(schema.pages.id, pageId))
    .run();
}
