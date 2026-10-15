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
 *
 * Textes d'un projet (v0.15) : surcouche du même genre sur la table `projects`
 * (`draft_text`, `draft_text_page_id`) — le projet reste la source unique de
 * ses textes, modifiables depuis tout bloc qui le montre ; publier la page qui
 * cite le projet les applique, « Abandonner » les efface.
 */
import { and, asc, eq, inArray, isNotNull, or } from "drizzle-orm";
import { z } from "zod";

import { BLOCKS } from "@/blocks/registry";
import { extractProjectRefs } from "@/blocks/refs";
import { boardRefs, errorPath, flatBlocks, treeProblem } from "@/blocks/tree";
import { getPageForEdit } from "@/lib/admin";
import { getDb, schema } from "@/lib/db";
import { own } from "@/lib/own";

import { deprecatedProblem, formIdProblem, mediaKindProblem, savePage } from "./pages";
import { PagePaperSchema } from "@/themes/schema";
import type { PagePaper } from "@/themes/wallpaper";
import { done, fail, zodFieldErrors, type ActionResult } from "./result";
import { applySiteDraft, discardSiteDraft } from "./site";

type L = { fr: string; en: string };

export type DraftBlock = { uid: string; type: string; props: Record<string, unknown> };
export type PageDraft = {
  title: L;
  slug: L;
  meta: { title: L; description: L };
  published: boolean;
  inMenu: boolean;
  accent: string | null;
  /** Papier peint de la page (lot 35) ; absent d'un brouillon d'avant = celui de la page publiée, null = celui du site. */
  wallpaper?: PagePaper | null;
  /** Collection que la page présente (lot 22) ; un brouillon d'avant ne la porte pas (= celle de la page publiée). */
  collection: "characters" | "backgrounds" | "animation" | null;
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
  wallpaper: PagePaperSchema.nullable().optional(),
  collection: z.enum(["characters", "backgrounds", "animation"]).nullable().optional(),
  blocks: z
    .array(
      z.object({
        uid: z.string().regex(/^[a-z0-9-]{1,32}$/),
        type: z.string().max(60).refine((t) => Boolean(own(BLOCKS, t)), "Type de rubrique inconnu."),
        props: z.record(z.string(), z.unknown()),
      }),
    )
    .max(40, "40 rubriques au plus par page.")
    // Conteneurs (v0.13) : composants acceptés, deux niveaux au plus, uid uniques.
    .superRefine((blocks, ctx) => {
      const problem = treeProblem(blocks, (t) => Boolean(own(BLOCKS, t)));
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    }),
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
  if (parsed.success) return { draft: { ...parsed.data, wallpaper: parsed.data.wallpaper === undefined ? page.wallpaper : parsed.data.wallpaper, collection: parsed.data.collection === undefined ? page.collection : parsed.data.collection } as PageDraft, hasDraft: true, corrupt: false, updatedAt: row.at ?? null, rev: row.rev, isHome: page.isHome };
  const corrupt = row.draft !== null;
  if (corrupt) console.error(`[brouillon] page ${pageId} : brouillon illisible, en attente d'un choix explicite`);
  const { title, slug, meta, published, inMenu, accent, wallpaper, collection, blocks } = page;
  return {
    draft: { title, slug, meta, published, inMenu, accent, wallpaper, collection, blocks: blocks.map((b, i) => ({ uid: `b${i}`, type: b.type, props: b.props })) },
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
    if (json === undefined || Buffer.byteLength(json) > MAX_DRAFT_BYTES) return fail("Ce brouillon est trop lourd : retire des rubriques ou raccourcis les textes.");
    const parsed = DraftSchema.safeParse(input);
    if (!parsed.success) return fail("Brouillon invalide : recharge l'éditeur.", zodFieldErrors(parsed.error.issues));
    const uids = flatBlocks(parsed.data.blocks).map((b) => b.uid);
    if (new Set(uids).size !== uids.length) return fail("Brouillon invalide (rubriques en double) : recharge l'éditeur.");
    // Types retirés de la palette : on n'en crée plus (ceux déjà sur la page restent lisibles).
    const old = deprecatedProblem(pageId, parsed.data.blocks);
    if (old) return fail(old);
    const dupForm = formIdProblem(pageId, parsed.data.blocks);
    if (dupForm) return fail(dupForm.message, { [dupForm.path]: dupForm.message });
    for (const b of flatBlocks(parsed.data.blocks)) {
      const wrongKind = mediaKindProblem(b.type, b.props);
      if (wrongKind) return fail(wrongKind, { [errorPath(parsed.data.blocks, b) ?? "blocks"]: wrongKind });
    }
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
 * Projets dont les PLANCHES (images) apparaissent dans ces blocs : blocs
 * « Planche d'un projet », y compris dans un conteneur (où une planche sans
 * projet prend celui du conteneur), et types anciens encore lisibles
 * (planches d'une collection, projets mis en avant). Seule la surcouche de
 * ces projets est appliquée à la publication (correction I1) ; c'est aussi
 * la condition pour modifier une planche depuis la toile. Un conteneur qui
 * cite un projet sans montrer sa planche n'en fait pas partie.
 */
export function displayedProjects(input: { type: string; props: unknown }[]): number[] {
  const db = getDb();
  // Sur l'arbre tel que la publication le garde (clés inconnues retirées, blocs invalides écartés).
  const blocks = parsedTree(input);
  const ids = new Set<number>();
  const slugs = new Set<string>();
  const collections = new Set<string>();
  let featured = false;
  for (const s of boardRefs(blocks)) slugs.add(s.slug);
  for (const b of flatBlocks(blocks)) {
    const p = (b.props ?? {}) as Record<string, unknown>;
    if (b.type === "collection-projects" && typeof p.collection === "string") collections.add(p.collection);
    if (b.type === "featured-projects") {
      if (Array.isArray(p.projects) && p.projects.length) {
        for (const x of p.projects) if (typeof x === "string") slugs.add(x);
      } else featured = true;
    }
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

/**
 * L'arbre passé par les schémas du registre, comme savePage le garde : clés
 * inconnues retirées, bloc (ou composant) invalide écarté, composants des
 * conteneurs parsés eux aussi. Sert à décider ce qui est réellement affiché.
 */
export function parsedTree(blocks: { uid?: unknown; type: string; props: unknown }[], depth = 0): { uid?: string; type: string; props: Record<string, unknown> }[] {
  const out: { uid?: string; type: string; props: Record<string, unknown> }[] = [];
  for (const b of blocks) {
    const def = b && typeof b.type === "string" ? own(BLOCKS, b.type) : undefined;
    const parsed = def?.schema.safeParse(b.props);
    if (!def || !parsed?.success) continue;
    const props = { ...(parsed.data as Record<string, unknown>) };
    if (def.container) props.children = depth < 2 && Array.isArray(props.children) ? parsedTree(props.children as { type: string; props: unknown }[], depth + 1) : [];
    out.push({ ...(typeof b.uid === "string" ? { uid: b.uid } : {}), type: b.type, props });
  }
  return out;
}

/**
 * Projets cités par ces blocs, à quelque titre que ce soit (planches, projet
 * d'un conteneur, titre lié) : revalidation du cache après une publication.
 */
export function referencedProjects(input: { type: string; props: unknown }[]): number[] {
  const blocks = parsedTree(input);
  const slugs = new Set(flatBlocks(blocks).flatMap((b) => extractProjectRefs(b.type, b.props, 2)));
  const ids = new Set(displayedProjects(blocks));
  if (slugs.size) for (const r of getDb().select({ id: schema.projects.id }).from(schema.projects).where(inArray(schema.projects.slug, [...slugs])).all()) ids.add(r.id);
  return [...ids].sort((a, b) => a - b);
}

const hasSlotDraft = or(isNotNull(schema.slots.draftState), isNotNull(schema.slots.draftPosition), isNotNull(schema.slots.draftMediaId), isNotNull(schema.slots.draftPageId));
const CLEAR = { draftState: null, draftPosition: null, draftMediaId: null, draftPageId: null, draftTitle: null, draftDescription: null, draftKey: null } as const;
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

/** Ratio largeur/hauteur d'un média, ou null. */
function mediaAspect(mediaId: number | null): number | null {
  if (mediaId === null) return null;
  const m = getDb().select({ width: schema.media.width, height: schema.media.height }).from(schema.media).where(eq(schema.media.id, mediaId)).get();
  return m?.width && m.height ? m.width / m.height : null;
}

/**
 * Applique la surcouche portée par le brouillon d'une page (publication) :
 * ordre, média (une nouvelle image impose son ratio, une place vidée garde le
 * sien), textes, emplacements ajoutés rendus publics, places retirées
 * supprimées ; positions renumérotées 0…n-1. Renvoie les projets touchés.
 */
export function applySlotDrafts(pageId: number, cited?: Set<number>): number[] {
  const db = getDb();
  const all = db.select().from(schema.slots).where(eq(schema.slots.draftPageId, pageId)).all();
  // Surcouche d'un projet que la page publiée n'affiche plus : effacée, jamais appliquée.
  const rows = cited ? all.filter((s) => cited.has(s.projectId)) : all;
  for (const s of all) {
    if (rows.includes(s)) continue;
    if (s.draftState === "added") db.delete(schema.slots).where(eq(schema.slots.id, s.id)).run();
    else db.update(schema.slots).set(CLEAR).where(eq(schema.slots.id, s.id)).run();
  }
  for (const s of rows) {
    if (s.draftState === "retired") {
      db.delete(schema.slots).where(eq(schema.slots.id, s.id)).run();
      continue;
    }
    const patch: Partial<typeof schema.slots.$inferInsert> = { ...CLEAR };
    if (s.draftPosition !== null) patch.position = s.draftPosition;
    if (s.draftMediaId !== null && s.draftMediaId !== s.mediaId) {
      patch.mediaId = s.draftMediaId;
      patch.aspect = mediaAspect(s.draftMediaId) ?? s.aspect;
    }
    if (s.draftTitle) patch.title = s.draftTitle;
    if (s.draftDescription) patch.description = s.draftDescription;
    // Média retiré : la place est gardée (comme dans l'écran Projets), à son ratio.
    if (s.draftState === "removed") {
      patch.mediaId = null;
      if (s.aspect === null) patch.aspect = mediaAspect(s.mediaId);
    }
    db.update(schema.slots).set(patch).where(eq(schema.slots.id, s.id)).run();
  }
  const projects = [...new Set(rows.map((s) => s.projectId))];
  const dropped = [...new Set(all.filter((s) => !rows.includes(s)).map((s) => s.projectId))];
  for (const projectId of projects) {
    db.select({ id: schema.slots.id })
      .from(schema.slots)
      .where(eq(schema.slots.projectId, projectId))
      .orderBy(asc(schema.slots.position), asc(schema.slots.id))
      .all()
      .forEach((x, position) => db.update(schema.slots).set({ position }).where(eq(schema.slots.id, x.id)).run());
  }
  return [...new Set([...projects, ...dropped])];
}

const CLEAR_TEXT = { draftText: null, draftTextPageId: null } as const;

/** Mêmes exigences que l'écran Projets (`ProjectMetaSchema`) : titre français et année jamais vides. */
export function projectTextProblem(t: { title: { fr: string }; year: string }): string | null {
  if (!t.title.fr.trim()) return "Le titre du projet ne peut pas être vide (en français).";
  if (!t.year.trim()) return "L'année du projet ne peut pas être vide.";
  return null;
}

/** Garde-fou de publication : textes de projet en brouillon vides (écrits hors des contrôles) → message, sinon null. */
function invalidProjectTexts(pageId: number, cited: Set<number>): string | null {
  const rows = getDb().select().from(schema.projects).where(eq(schema.projects.draftTextPageId, pageId)).all();
  for (const p of rows) {
    const problem = p.draftText && cited.has(p.id) ? projectTextProblem(p.draftText) : null;
    if (problem) return `Publication impossible : ${problem.charAt(0).toLowerCase()}${problem.slice(1).replace(/\.$/, "")} (projet « ${p.title.fr || p.slug} »). Corrige-le sur la toile ou abandonne les modifications.`;
  }
  return null;
}

/**
 * Applique les textes de projet portés par le brouillon d'une page
 * (publication). `cited` : projets que la page publiée cite encore ; la
 * surcouche d'un autre projet est effacée sans être appliquée. Renvoie les
 * projets touchés (revalidation).
 */
export function applyProjectTextDrafts(pageId: number, cited: Set<number>): number[] {
  const db = getDb();
  const rows = db.select().from(schema.projects).where(eq(schema.projects.draftTextPageId, pageId)).all();
  const touched: number[] = [];
  for (const p of rows) {
    // Dernier garde-fou : un texte invalide (titre ou année vide) n'est jamais publié, la ligne publiée reste.
    if (p.draftText && cited.has(p.id) && !projectTextProblem(p.draftText)) {
      db.update(schema.projects)
        .set({ title: p.draftText.title, context: p.draftText.context, description: p.draftText.description, year: p.draftText.year, updatedAt: new Date(), ...CLEAR_TEXT })
        .where(eq(schema.projects.id, p.id))
        .run();
    } else {
      db.update(schema.projects).set(CLEAR_TEXT).where(eq(schema.projects.id, p.id)).run();
    }
    touched.push(p.id);
  }
  return touched;
}

/** Efface les textes de projet portés par le brouillon d'une page (abandon, suppression). */
export function discardProjectTextDrafts(pageId: number): number[] {
  const db = getDb();
  const ids = db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.draftTextPageId, pageId)).all().map((r) => r.id);
  if (ids.length) db.update(schema.projects).set(CLEAR_TEXT).where(eq(schema.projects.draftTextPageId, pageId)).run();
  return ids;
}

/**
 * Efface la surcouche portée par le brouillon d'une page (abandon) : ses
 * emplacements « added » et les projets créés dans ce brouillon disparaissent.
 */
export function discardSlotDrafts(pageId: number): number[] {
  const db = getDb();
  const rows = db.select({ id: schema.slots.id, state: schema.slots.draftState, projectId: schema.slots.projectId }).from(schema.slots).where(eq(schema.slots.draftPageId, pageId)).all();
  for (const s of rows) {
    if (s.state === "added") db.delete(schema.slots).where(eq(schema.slots.id, s.id)).run();
    else db.update(schema.slots).set(CLEAR).where(eq(schema.slots.id, s.id)).run();
  }
  // Projets créés dans ce brouillon (emplacements en cascade).
  db.delete(schema.projects).where(eq(schema.projects.draftPageId, pageId)).run();
  return [...new Set([...rows.map((s) => s.projectId), ...discardProjectTextDrafts(pageId)])];
}

/**
 * Planche d'un projet créé dans ce brouillon et encore sans image : on ne
 * publie pas un projet vide. Erreurs par bloc, ou null.
 */
function emptyDraftBoards(pageId: number, blocks: { type: string; props: unknown }[]): Record<string, string> | null {
  const db = getDb();
  const errors: Record<string, string> = {};
  // Planches de la page, composants des conteneurs compris (projet hérité du conteneur).
  boardRefs(blocks).forEach(({ slug, block }) => {
    const at = errorPath(blocks, block);
    if (!at) return;
    const project = db.select().from(schema.projects).where(eq(schema.projects.slug, slug)).get();
    if (!project || project.draftPageId !== pageId) return;
    const withImage = db
      .select({ id: schema.slots.id })
      .from(schema.slots)
      .where(and(eq(schema.slots.projectId, project.id), isNotNull(schema.slots.mediaId)))
      .all().length;
    if (!withImage) errors[at] = `La planche « ${project.title.fr} » n'a encore aucune image : ajoute-en une, ou retire cette rubrique.`;
  });
  return Object.keys(errors).length ? errors : null;
}

/**
 * Publication : les projets créés dans ce brouillon et cités par la page
 * publiée deviennent publics ; les autres (créés puis abandonnés en route)
 * sont supprimés.
 */
function settleDraftProjects(pageId: number, blocks: { type: string; props: unknown }[]): void {
  const db = getDb();
  const cited = new Set(blocks.flatMap((b) => extractProjectRefs(b.type, b.props)));
  for (const p of db.select({ id: schema.projects.id, slug: schema.projects.slug }).from(schema.projects).where(eq(schema.projects.draftPageId, pageId)).all()) {
    if (cited.has(p.slug)) db.update(schema.projects).set({ draftPageId: null, updatedAt: new Date() }).where(eq(schema.projects.id, p.id)).run();
    else db.delete(schema.projects).where(eq(schema.projects.id, p.id)).run();
  }
}

/* ---- Publier, abandonner -------------------------------------------------- */

/** `site` : l'en-tête, le pied ou les réseaux (communs à toutes les pages) ont changé. */
export type PublishResult = { projects: number[]; blocks: number; rev: number; site: boolean };

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
  const empty = emptyDraftBoards(pageId, state.draft.blocks);
  if (empty) return fail("Publication impossible : corrige ce qui est signalé.", empty);
  const invalidText = invalidProjectTexts(pageId, new Set(referencedProjects(state.draft.blocks)));
  if (invalidText) return fail(invalidText);
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
      const touched = [
        ...applySlotDrafts(pageId, new Set(displayedProjects(draft.blocks))),
        ...applyProjectTextDrafts(pageId, new Set(referencedProjects(draft.blocks))),
      ];
      settleDraftProjects(pageId, draft.blocks);
      const site = applySiteDraft(pageId);
      const cleared = tx
        .update(schema.pages)
        .set({ draft: null, draftUpdatedAt: null, draftRev: rev + 1 })
        .where(and(eq(schema.pages.id, pageId), eq(schema.pages.draftRev, rev)))
        .run();
      // Écrit entre la lecture et la transaction : tout est annulé.
      if (cleared.changes !== 1) throw new ConflictError();
      const projects = [...new Set([...referencedProjects([...draft.blocks, ...(before?.blocks ?? [])]), ...touched])].sort((a, b) => a - b);
      outcome = done({ projects, blocks: draft.blocks.length, rev: rev + 1, site });
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
      discardSiteDraft(pageId);
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
export function savePageFromForm(pageId: number, input: unknown, rev: unknown): DraftResult<{ projects: number[]; rev: number; site: boolean }> {
  if (!validRev(rev)) return fail("Requête invalide (version manquante) : recharge la page.");
  const row = pageRow(pageId);
  if (!row) return fail("Cette page n'existe plus. Recharge la liste des pages.");
  if (row.rev !== rev) return conflict(row.rev);
  if (isCorrupt(row.draft)) return corruptRefusal(row.rev);
  const invalidText = invalidProjectTexts(pageId, new Set(referencedProjects((input as { blocks?: { type: string; props: unknown }[] })?.blocks ?? [])));
  if (invalidText) return fail(invalidText);
  const before = getPageForEdit(pageId);
  const draftBlocks = (DraftSchema.safeParse(row.draft).data?.blocks ?? []) as DraftBlock[];
  const db = getDb();
  let outcome: DraftResult<{ projects: number[]; rev: number; site: boolean }> = fail("Enregistrement impossible.");
  try {
    db.transaction((tx) => {
      const result = savePage(pageId, input);
      if (!result.ok) {
        outcome = result;
        return;
      }
      const formBlocks = (input as { blocks?: { type: string; props: unknown }[] })?.blocks ?? [];
      const touched = [
        ...applySlotDrafts(pageId, new Set(displayedProjects(formBlocks))),
        ...applyProjectTextDrafts(pageId, new Set(referencedProjects(formBlocks))),
      ];
      settleDraftProjects(pageId, formBlocks);
      const site = applySiteDraft(pageId);
      const cleared = tx
        .update(schema.pages)
        .set({ draft: null, draftUpdatedAt: null, draftRev: rev + 1 })
        .where(and(eq(schema.pages.id, pageId), eq(schema.pages.draftRev, rev)))
        .run();
      if (cleared.changes !== 1) throw new ConflictError();
      const after = (input as { blocks?: { type: string; props: unknown }[] })?.blocks ?? [];
      const projects = [...new Set([...referencedProjects([...draftBlocks, ...(before?.blocks ?? []), ...after]), ...touched])];
      outcome = done({ projects, rev: rev + 1, site });
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
