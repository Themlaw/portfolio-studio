/**
 * Planches éditées sur la toile (éditeur visuel, phase 7b).
 *
 * Tout passe par la surcouche d'emplacements PAR PAGE (`slots.draft_*`,
 * `draft_page_id`) : rien n'est public avant « Publier » de cette page,
 * « Abandonner » efface tout (docs/ARCHITECTURE.md).
 *
 * Modèle d'écriture : l'état de brouillon d'une planche (projet × page) se lit
 * en un « instantané » (`BoardSnap` : emplacements visibles dans l'ordre, avec
 * leur média et leurs textes, + champs du projet s'il a été créé dans ce
 * brouillon). Chaque opération (ajouter à une position, déplacer, retirer
 * l'image, retirer la place, remplacer, texte) lit l'instantané, le modifie,
 * puis l'écrit (`writeBoard`). Annuler / Rétablir réécrit simplement
 * l'instantané d'avant ou d'après : l'historique de l'éditeur reste exact,
 * emplacements ajoutés compris (clé stable `draft_key`).
 *
 * Gardes : la page et le projet existent ; le projet est publié ou créé dans
 * CE brouillon ; aucun emplacement du projet ne porte la surcouche d'une
 * autre page ; les emplacements et médias cités appartiennent bien au projet
 * ou existent ; version optimiste de la page (`draft_rev`) comme le brouillon.
 *
 * Textes du projet (nom, contexte, présentation, année ; v0.15) : même
 * instantané (`BoardSnap.project`), même historique, mais une surcouche à part
 * (`projects.draft_text` + `draft_text_page_id`) — une seule source de vérité :
 * le projet. Modifiés depuis n'importe quel bloc qui le montre (planche, titre
 * lié d'un « Projet mis en avant »), ils ne sont publics qu'à la publication
 * de la page ; un projet créé dans CE brouillon porte ses textes sur sa ligne.
 * Une seule page à la fois tient la surcouche de textes d'un projet.
 */
import { randomBytes } from "node:crypto";

import { and, asc, eq, max } from "drizzle-orm";
import { z } from "zod";

import { getPageForEdit } from "@/lib/admin";
import { getDb, schema } from "@/lib/db";
import { slugify } from "@/lib/slug";

import { displayedProjects, projectTextProblem, referencedProjects, type DraftRefusal } from "./drafts";
import { done, fail, type ActionResult } from "./result";

type L = { fr: string; en: string };
const sameL = (a: L | null | undefined, b: L | null | undefined) => (a?.fr ?? "") === (b?.fr ?? "") && (a?.en ?? "") === (b?.en ?? "");
type SlotRow = typeof schema.slots.$inferSelect;

/** Un PDF (bloc CV) ne se pose pas dans une planche. */
const PDF_NOT_IN_BOARD = "Un PDF ne se place pas dans une planche : utilise la rubrique « CV ».";

export const MAX_BOARD_SLOTS = 200;
/** Projets créés au plus dans le brouillon d'une page. */
export const MAX_DRAFT_PROJECTS = 10;

const Loc = (max: number) => z.strictObject({ fr: z.string().max(max), en: z.string().max(max) });
/** Textes du projet : mêmes règles d'espaces que l'écran Projets (`ProjectMetaSchema`) ; le « non vide » se contrôle à l'écriture (`projectTextProblem`). */
const TrimLoc = (max: number) => z.strictObject({ fr: z.string().trim().max(max), en: z.string().trim().max(max) });
const Key = z.string().regex(/^(s\d{1,9}|k[a-z0-9]{8,24})$/);

const Collection = z.enum(["characters", "backgrounds", "animation"]);
const SnapSlot = z.strictObject({
  key: Key,
  mediaId: z.number().int().positive().nullable(),
  title: Loc(120),
  description: Loc(2000),
  /** Métier d'un emplacement ajouté depuis une planche filtrée (planche d'une collection migrée). */
  collection: Collection.optional(),
});
export const BoardSnapSchema = z.strictObject({
  projectId: z.number().int().positive(),
  project: z.strictObject({ title: TrimLoc(120), context: TrimLoc(200), description: TrimLoc(2000), year: z.string().trim().max(20) }).nullable(),
  slots: z.array(SnapSlot).max(MAX_BOARD_SLOTS),
});
export type BoardSnap = z.infer<typeof BoardSnapSchema>;

export const BoardOpSchema = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("add"), mediaId: z.number().int().positive(), index: z.number().int().min(0).max(MAX_BOARD_SLOTS), collection: Collection.optional() }),
  z.strictObject({ op: z.literal("move"), key: Key, index: z.number().int().min(0).max(MAX_BOARD_SLOTS) }),
  z.strictObject({ op: z.literal("remove"), key: Key }),
  z.strictObject({ op: z.literal("retire"), key: Key }),
  z.strictObject({ op: z.literal("fill"), key: Key, mediaId: z.number().int().positive() }),
  z.strictObject({ op: z.literal("text"), key: Key, field: z.enum(["title", "description"]), locale: z.enum(["fr", "en"]), value: z.string().max(2000) }),
  z.strictObject({ op: z.literal("project"), field: z.enum(["title", "context", "description", "year"]), locale: z.enum(["fr", "en"]), value: z.string().max(2000) }),
]);
export type BoardOp = z.infer<typeof BoardOpSchema>;

/** `slug` : projet de la planche (l'éditeur reconnaît son bloc). */
export type BoardResult = { before: BoardSnap; after: BoardSnap; rev: number; slug: string };

const keyOf = (s: SlotRow) => s.draftKey ?? `s${s.id}`;
const validRev = (rev: unknown): rev is number => Number.isInteger(rev) && (rev as number) >= 0;
const conflict = (rev: number): DraftRefusal => ({
  ok: false,
  message: "Cette page a été modifiée ailleurs (autre onglet, formulaire ou publication). Recharge pour reprendre la dernière version.",
  code: "conflict",
  rev,
});

/** La planche est-elle modifiable depuis le brouillon de cette page ? Message de refus sinon. */
function access(pageId: number, projectId: number): string | null {
  const db = getDb();
  const project = db.select({ id: schema.projects.id, draftPageId: schema.projects.draftPageId }).from(schema.projects).where(eq(schema.projects.id, projectId)).get();
  if (!project) return "Ce projet n'existe plus : recharge l'éditeur.";
  // La page qui tient le projet est nommée : l'artiste sait où aller.
  const pageName = (id: number) => db.select({ title: schema.pages.title }).from(schema.pages).where(eq(schema.pages.id, id)).get()?.title.fr || `n° ${id}`;
  if (project.draftPageId !== null && project.draftPageId !== pageId) {
    return `Ce projet est en cours de création sur la page ${pageName(project.draftPageId)} : publie-la ou abandonne-la d'abord.`;
  }
  const other = db
    .select({ page: schema.slots.draftPageId })
    .from(schema.slots)
    .where(eq(schema.slots.projectId, projectId))
    .all()
    .find((s) => s.page !== null && s.page !== pageId);
  if (other?.page) return `Ce projet est en cours de modification sur la page ${pageName(other.page)} : publie-la ou abandonne-la d'abord.`;
  // La page doit afficher ce projet (bloc qui le cite, projets d'une
  // collection ou mis en avant) : une surcouche hors de la page ne se publierait pas.
  if (!displayedProjects(draftBlocks(pageId)).includes(projectId)) return "Cette page n'affiche pas ce projet : ajoute d'abord sa planche à la page.";
  return null;
}

/**
 * Les textes du projet sont-ils modifiables depuis le brouillon de cette page ?
 * Il suffit qu'elle le cite (planche, projet d'un conteneur, titre lié) ; la
 * surcouche ne peut être tenue que par une page à la fois.
 */
function textAccess(pageId: number, projectId: number): string | null {
  const db = getDb();
  const project = db
    .select({ draftPageId: schema.projects.draftPageId, textPage: schema.projects.draftTextPageId })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();
  if (!project) return "Ce projet n'existe plus : recharge l'éditeur.";
  const pageName = (id: number) => db.select({ title: schema.pages.title }).from(schema.pages).where(eq(schema.pages.id, id)).get()?.title.fr || `n° ${id}`;
  if (project.draftPageId !== null && project.draftPageId !== pageId) {
    return `Ce projet est en cours de création sur la page ${pageName(project.draftPageId)} : publie-la ou abandonne-la d'abord.`;
  }
  if (project.textPage !== null && project.textPage !== pageId) {
    return `Les textes de ce projet sont en cours de modification sur la page ${pageName(project.textPage)} : publie-la ou abandonne-la d'abord.`;
  }
  if (!referencedProjects(draftBlocks(pageId)).includes(projectId)) return "Cette page n'affiche pas ce projet : ajoute-le d'abord à la page.";
  return null;
}

/** Blocs du brouillon de la page (sinon de la version publiée). */
function draftBlocks(pageId: number): { type: string; props: unknown }[] {
  const draft = getDb().select({ draft: schema.pages.draft }).from(schema.pages).where(eq(schema.pages.id, pageId)).get()?.draft as { blocks?: unknown } | null | undefined;
  if (draft && Array.isArray(draft.blocks)) return (draft.blocks as { type?: unknown; props?: unknown }[]).filter((b) => typeof b?.type === "string") as { type: string; props: unknown }[];
  return getPageForEdit(pageId)?.blocks ?? [];
}

function rowsOf(projectId: number): SlotRow[] {
  return getDb().select().from(schema.slots).where(eq(schema.slots.projectId, projectId)).orderBy(asc(schema.slots.position), asc(schema.slots.id)).all();
}

type ProjectRow = typeof schema.projects.$inferSelect;
type ProjectText = NonNullable<BoardSnap["project"]>;

/** Textes du projet tels que le brouillon de la page les montre : sa surcouche, sinon ceux de la ligne. */
function projectText(row: ProjectRow, pageId: number): ProjectText {
  if (row.draftTextPageId === pageId && row.draftText) return row.draftText;
  return { title: row.title, context: row.context, description: row.description, year: row.year };
}

/** Instantané de la planche telle que le brouillon de la page la montre. */
export function readBoard(pageId: number, projectId: number): BoardSnap {
  const db = getDb();
  const project = db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
  const rows = rowsOf(projectId)
    .map((row) => {
      const mine = row.draftPageId === pageId;
      return { row, mine, order: mine && row.draftPosition !== null ? row.draftPosition : row.position };
    })
    .filter(({ row, mine }) => (mine ? row.draftState !== "retired" : row.draftState !== "added"))
    .sort((a, b) => a.order - b.order || a.row.id - b.row.id);
  return {
    projectId,
    project: project ? projectText(project, pageId) : null,
    slots: rows.map(({ row, mine }) => ({
      key: keyOf(row),
      mediaId: mine ? (row.draftState === "removed" ? null : (row.draftMediaId ?? row.mediaId)) : row.mediaId,
      title: (mine ? row.draftTitle : null) ?? row.title,
      description: (mine ? row.draftDescription : null) ?? row.description,
    })),
  };
}

function aspectOf(mediaId: number | null): number | null {
  if (mediaId === null) return null;
  const m = getDb().select({ width: schema.media.width, height: schema.media.height }).from(schema.media).where(eq(schema.media.id, mediaId)).get();
  return m?.width && m.height ? m.width / m.height : null;
}

function uniqueSlotSlug(projectSlug: string): string {
  const db = getDb();
  for (let n = 1; ; n++) {
    const slug = `${projectSlug}-${n}`.slice(0, 80);
    if (!db.select({ id: schema.slots.id }).from(schema.slots).where(eq(schema.slots.slug, slug)).get()) return slug;
  }
}


/**
 * Contrôle d'un instantané reçu (Annuler / Rétablir) : chaque clé désigne un
 * emplacement DE CE PROJET (ou un emplacement ajouté par cette page, recréé
 * s'il manque), chaque média existe et n'est pas en échec, pas de doublon.
 */
function checkSnap(pageId: number, snap: BoardSnap, allowPending = false): string | null {
  const rows = rowsOf(snap.projectId);
  const byKey = new Map(rows.map((r) => [keyOf(r), r]));
  const keys = new Set<string>();
  const db = getDb();
  for (const s of snap.slots) {
    if (keys.has(s.key)) return "Planche invalide (emplacement en double) : recharge l'éditeur.";
    keys.add(s.key);
    const row = byKey.get(s.key);
    if (s.key.startsWith("s") && !row) return "Un emplacement n'existe plus ou appartient à un autre projet : recharge l'éditeur.";
    if (row && row.draftState === "added" && row.draftPageId !== pageId) return "Emplacement d'une autre page.";
    if (s.mediaId !== null) {
      const m = db.select({ status: schema.media.status, kind: schema.media.kind }).from(schema.media).where(eq(schema.media.id, s.mediaId)).get();
      if (!m) return "Une image n'existe plus : recharge l'éditeur.";
      if (m.kind === "pdf") return PDF_NOT_IN_BOARD;
      if (m.status === "failed") return "Ce média est en échec : relance-le depuis la médiathèque avant de le placer.";
      // Un média se place une fois prêt (Annuler/Rétablir peut rétablir un média encore en conversion).
      if (m.status !== "ready" && !(allowPending && m.status === "processing")) return "Ce média est encore en conversion : attends qu'il soit prêt pour le placer.";
    }
  }
  return null;
}

/** Écrit l'instantané comme surcouche de la page (dans une transaction de l'appelant). */
function writeBoard(pageId: number, snap: BoardSnap, only: { slots: boolean; text: boolean }): void {
  const db = getDb();
  const project = db.select().from(schema.projects).where(eq(schema.projects.id, snap.projectId)).get();
  if (!project) throw new Error("projet disparu");
  if (only.text && snap.project) {
    const t = snap.project;
    if (project.draftPageId === pageId) {
      // Projet créé dans ce brouillon : ses textes sont sur sa ligne (invisible ailleurs).
      db.update(schema.projects).set({ title: t.title, context: t.context, description: t.description, year: t.year }).where(eq(schema.projects.id, project.id)).run();
    } else {
      // Projet publié : surcouche de la page ; revenir aux textes publiés l'efface.
      const same = sameL(t.title, project.title) && sameL(t.context, project.context) && sameL(t.description, project.description) && t.year === project.year;
      db.update(schema.projects)
        .set(same ? { draftText: null, draftTextPageId: null } : { draftText: t, draftTextPageId: pageId })
        .where(eq(schema.projects.id, project.id))
        .run();
    }
  }
  if (!only.slots) return;
  const rows = rowsOf(snap.projectId);
  const byKey = new Map(rows.map((r) => [keyOf(r), r]));
  const wanted = new Set(snap.slots.map((s) => s.key));
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.collection, (counts.get(r.collection) ?? 0) + 1);
  const collection = ([...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "characters") as SlotRow["collection"];

  // Emplacements absents de l'instantané : ajoutés → supprimés ; publiés → place retirée.
  for (const r of rows) {
    if (wanted.has(keyOf(r))) continue;
    if (r.draftState === "added") {
      if (r.draftPageId === pageId) db.delete(schema.slots).where(eq(schema.slots.id, r.id)).run();
    } else {
      db.update(schema.slots)
        .set({ draftState: "retired", draftPageId: pageId, draftPosition: null, draftMediaId: null, draftTitle: null, draftDescription: null })
        .where(eq(schema.slots.id, r.id))
        .run();
    }
  }
  snap.slots.forEach((s, index) => {
    const row = byKey.get(s.key);
    if (!row) {
      // Emplacement ajouté (ou recréé à l'identique par Rétablir).
      db.insert(schema.slots)
        .values({
          projectId: snap.projectId,
          position: 10_000 + index,
          mediaId: s.mediaId,
          aspect: aspectOf(s.mediaId),
          slug: uniqueSlotSlug(project.slug),
          collection: s.collection ?? collection,
          title: s.title,
          description: s.description,
          year: new Date().getFullYear(),
          featured: false,
          draftState: "added",
          draftPageId: pageId,
          draftPosition: index,
          draftKey: s.key,
        })
        .run();
      return;
    }
    if (row.draftState === "added") {
      db.update(schema.slots)
        .set({ mediaId: s.mediaId, aspect: s.mediaId !== null ? aspectOf(s.mediaId) : row.aspect, title: s.title, description: s.description, draftPosition: index })
        .where(eq(schema.slots.id, row.id))
        .run();
      return;
    }
    // Emplacement publié : surcouche explicite.
    const removed = s.mediaId === null && row.mediaId !== null;
    db.update(schema.slots)
      .set({
        draftPageId: pageId,
        draftState: removed ? "removed" : null,
        draftPosition: index,
        draftMediaId: s.mediaId !== null && s.mediaId !== row.mediaId ? s.mediaId : null,
        draftTitle: sameL(s.title, row.title) ? null : s.title,
        draftDescription: sameL(s.description, row.description) ? null : s.description,
      })
      .where(eq(schema.slots.id, row.id))
      .run();
  });
}

/** Brouillon de la page garanti (copie de la version publiée) et version incrémentée. */
export function touchPage(pageId: number, rev: number): boolean {
  const db = getDb();
  const page = db.select({ draft: schema.pages.draft }).from(schema.pages).where(eq(schema.pages.id, pageId)).get();
  let draft = page?.draft ?? null;
  if (draft === null) {
    const published = getPageForEdit(pageId);
    if (!published) return false;
    const { title, slug, meta, published: pub, inMenu, accent, collection, blocks } = published;
    draft = { title, slug, meta, published: pub, inMenu, accent, collection, blocks: blocks.map((b, i) => ({ uid: `b${i}`, type: b.type, props: b.props })) };
  }
  const res = db
    .update(schema.pages)
    .set({ draft, draftUpdatedAt: new Date(), draftRev: rev + 1 })
    .where(and(eq(schema.pages.id, pageId), eq(schema.pages.draftRev, rev)))
    .run();
  return res.changes === 1;
}

class ConflictError extends Error {}

function pageRev(pageId: number): number | null {
  return getDb().select({ rev: schema.pages.draftRev }).from(schema.pages).where(eq(schema.pages.id, pageId)).get()?.rev ?? null;
}

/** Applique une transformation de l'instantané, gardée et versionnée. */
function mutate(pageId: number, projectIdInput: unknown, rev: unknown, change: (snap: BoardSnap) => BoardSnap | string, restoring = false, textOp = false): ActionResult<BoardResult> | DraftRefusal {
  if (!validRev(rev)) return fail("Requête invalide (version manquante) : recharge l'éditeur.");
  const projectId = z.number().int().positive().safeParse(projectIdInput);
  if (!projectId.success) return fail("Projet inconnu.");
  const current = pageRev(pageId);
  if (current === null) return fail("Cette page n'existe plus.");
  if (current !== rev) return conflict(current);
  const before = readBoard(pageId, projectId.data);
  const next = change(structuredClone(before));
  if (typeof next === "string") return fail(next);
  // Images (surcouche d'emplacements) et textes du projet (surcouche de textes) :
  // deux écritures, deux gardes. Un texte seul ne touche pas aux emplacements.
  const slotsChanged = JSON.stringify(before.slots) !== JSON.stringify(next.slots);
  const textChanged = JSON.stringify(before.project) !== JSON.stringify(next.project);
  // Un texte « modifié » à l'identique : rien à écrire, rien à garder (pas de faux refus d'accès à la planche).
  if (textOp && !textChanged) return done({ before, after: before, rev: current, slug: slugOf(projectId.data) });
  if (slotsChanged || !textChanged) {
    const denied = access(pageId, projectId.data);
    if (denied) return fail(denied);
  }
  if (textChanged) {
    const denied = textAccess(pageId, projectId.data);
    if (denied) return fail(denied);
    // Même exigence que l'écran Projets : un titre (fr) et une année jamais vides.
    const problem = next.project && projectTextProblem(next.project);
    if (problem) return fail(problem);
  }
  if (next.slots.length > MAX_BOARD_SLOTS) return fail(`${MAX_BOARD_SLOTS} emplacements au plus par planche.`);
  const problem = checkSnap(pageId, next, restoring);
  if (problem) return fail(problem);
  try {
    getDb().transaction(() => {
      if (!touchPage(pageId, rev)) throw new ConflictError();
      writeBoard(pageId, next, { slots: slotsChanged || !textChanged, text: textChanged });
    });
  } catch (error) {
    if (error instanceof ConflictError) return conflict(pageRev(pageId) ?? rev);
    throw error;
  }
  return done({ before, after: readBoard(pageId, projectId.data), rev: rev + 1, slug: slugOf(projectId.data) });
}

const slugOf = (projectId: number) => getDb().select({ slug: schema.projects.slug }).from(schema.projects).where(eq(schema.projects.id, projectId)).get()?.slug ?? "";

const newKey = () => `k${randomBytes(8).toString("hex")}`;
const EMPTY: L = { fr: "", en: "" };

/** Une opération sur la planche (toile : ajouter, déplacer, retirer, remplacer, textes). */
export function boardOp(pageId: number, projectId: unknown, opInput: unknown, rev: unknown): ActionResult<BoardResult> | DraftRefusal {
  const parsed = BoardOpSchema.safeParse(opInput);
  if (!parsed.success) return fail("Opération invalide : recharge l'éditeur.");
  const op = parsed.data;
  return mutate(pageId, projectId, rev, (snap) => {
    const at = (key: string) => snap.slots.findIndex((s) => s.key === key);
    switch (op.op) {
      case "add":
        if (op.index > snap.slots.length) return "Position invalide.";
        snap.slots.splice(op.index, 0, { key: newKey(), mediaId: op.mediaId, title: EMPTY, description: EMPTY, ...(op.collection ? { collection: op.collection } : {}) });
        return snap;
      case "move": {
        const from = at(op.key);
        if (from < 0) return "Cet emplacement n'est pas sur cette planche.";
        if (op.index > snap.slots.length) return "Position invalide.";
        const [item] = snap.slots.splice(from, 1);
        snap.slots.splice(Math.min(op.index > from ? op.index - 1 : op.index, snap.slots.length), 0, item);
        return snap;
      }
      case "remove":
      case "fill": {
        const i = at(op.key);
        if (i < 0) return "Cet emplacement n'est pas sur cette planche.";
        snap.slots[i].mediaId = op.op === "fill" ? op.mediaId : null;
        return snap;
      }
      case "retire": {
        const i = at(op.key);
        if (i < 0) return "Cet emplacement n'est pas sur cette planche.";
        snap.slots.splice(i, 1);
        return snap;
      }
      case "text": {
        const i = at(op.key);
        if (i < 0) return "Cet emplacement n'est pas sur cette planche.";
        const max = op.field === "title" ? 120 : 2000;
        snap.slots[i][op.field] = { ...snap.slots[i][op.field], [op.locale]: op.value.slice(0, max) };
        return snap;
      }
      case "project": {
        if (!snap.project) return "Ce projet n'existe plus : recharge l'éditeur.";
        // Espaces retirés avant la coupe, comme l'écran Projets (`trim` puis `max`).
        const value = op.value.trim();
        if (op.field === "year") snap.project.year = value.slice(0, 20);
        else if (op.field === "title") snap.project.title = { ...snap.project.title, [op.locale]: value.slice(0, 120) };
        else if (op.field === "context") snap.project.context = { ...snap.project.context, [op.locale]: value.slice(0, 200) };
        else snap.project.description = { ...snap.project.description, [op.locale]: value.slice(0, 2000) };
        return snap;
      }
    }
  }, false, op.op === "project");
}

/** Annuler / Rétablir : réécrit un instantané (contrôlé). */
export function restoreBoard(pageId: number, snapInput: unknown, rev: unknown, fromInput?: unknown): ActionResult<BoardResult> | DraftRefusal {
  const parsed = BoardSnapSchema.safeParse(snapInput);
  if (!parsed.success) return fail("Planche invalide : recharge l'éditeur.");
  const snap = parsed.data;
  // `from` : la planche telle que l'éditeur la croit (celle que ce pas d'historique quitte).
  const from = fromInput === undefined || fromInput === null ? null : BoardSnapSchema.safeParse(fromInput);
  if (from && !from.success) return fail("Planche invalide : recharge l'éditeur.");
  const known = from?.data.projectId === snap.projectId ? from.data.project : null;
  return mutate(
    pageId,
    snap.projectId,
    rev,
    (current) => {
      // Textes du projet : seuls les champs que ce pas change vraiment (instantané ≠ `from`) sont
      // réécrits ; les autres gardent la valeur d'aujourd'hui (modifiée entre-temps dans l'écran
      // Projets, par exemple). Sans `from`, ceux de l'instantané ; sans instantané, ceux d'aujourd'hui.
      if (!current.project) return { ...snap, project: null };
      if (!snap.project) return { ...snap, project: current.project };
      if (!known) return snap;
      const pick = <T,>(wanted: T, was: T, now: T) => (JSON.stringify(wanted) === JSON.stringify(was) ? now : wanted);
      const loc = (a: L, b: L, c: L): L => ({ fr: pick(a.fr, b.fr, c.fr), en: pick(a.en, b.en, c.en) });
      const p = snap.project;
      return {
        ...snap,
        project: {
          title: loc(p.title, known.title, current.project.title),
          context: loc(p.context, known.context, current.project.context),
          description: loc(p.description, known.description, current.project.description),
          year: pick(p.year, known.year, current.project.year),
        },
      };
    },
    true,
  );
}

/**
 * Projet créé depuis la toile (planche neuve) : en brouillon de la page,
 * invisible ailleurs jusqu'à sa publication.
 */
export function createDraftProject(pageId: number, titleInput: unknown): ActionResult<{ id: number; slug: string; title: string }> {
  const title = z.string().trim().min(1, "Donne un nom au projet.").max(120).safeParse(titleInput);
  if (!title.success) return fail(title.error.issues[0]?.message ?? "Nom invalide.");
  const db = getDb();
  if (!db.select({ id: schema.pages.id }).from(schema.pages).where(eq(schema.pages.id, pageId)).get()) return fail("Cette page n'existe plus.");
  const pending = db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.draftPageId, pageId)).all().length;
  if (pending >= MAX_DRAFT_PROJECTS) return fail(`${MAX_DRAFT_PROJECTS} projets au plus créés dans un même brouillon : publie ou abandonne d'abord.`);
  const root = slugify(title.data) || "projet";
  let slug = root;
  for (let n = 2; db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.slug, slug)).get(); n++) slug = `${root}-${n}`;
  const [{ m }] = db.select({ m: max(schema.projects.position) }).from(schema.projects).all();
  const row = db
    .insert(schema.projects)
    .values({
      slug,
      title: { fr: title.data, en: title.data },
      context: { fr: "", en: "" },
      description: { fr: "", en: "" },
      year: String(new Date().getFullYear()),
      featured: false,
      position: (m ?? 0) + 1,
      draftPageId: pageId,
    })
    .returning({ id: schema.projects.id })
    .get();
  return done({ id: row.id, slug, title: title.data });
}

