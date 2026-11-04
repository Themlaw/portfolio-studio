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
 *
 * Contenu de la planche (lot 31 : la suite de composants sous l'en-tête, `BoardSnap.layout`) : même instantané,
 * même historique, une surcouche à part (`projects.draft_layout` + `draft_layout_page_id`) tenue par une seule
 * page à la fois ; publiée avec la page qui la tient, abandonnée avec elle. Un projet créé dans CE brouillon
 * garde sa suite sur sa ligne (invisible ailleurs).
 *
 * Contenu et textes PROPRES au bloc (lot 111) : un bloc Projet porte sa copie de la suite (`props.layout`) et des textes du projet
 * (`props.text`), dans le brouillon puis la version de la page, comme le reste du bloc. Ils sont lus à la place de ceux du projet
 * (`BoardSnap.own`, `BoardSnap.ownText`). Copie à l'écriture : la première modification faite depuis une page copie ce que la page
 * voit (son brouillon du projet s'il le tient, sinon le contenu publié) dans SON bloc ; aucune autre page n'est touchée et aucun
 * verrou n'existe plus entre pages. Aucune migration : un bloc sans copie se rend comme avant. Un projet créé dans CE brouillon
 * garde tout sur sa ligne (invisible ailleurs).
 */
import { randomBytes } from "node:crypto";

import { and, asc, eq, max } from "drizzle-orm";
import { z } from "zod";

import { applyFreeOp, newFreeId } from "@/blocks/free-board";
import { BOARD_ITEM_TYPES, BOX_MIN, ownLayoutOf, ownTextOf, type OwnText, CAPTION_STYLE_FIELDS, projectCaptionStyle, MAX_BOARD_ITEMS, MAX_RAIL_MEDIA, defaultLayout, isProjectStrip, newBoardItem, parseCaptionPath, railIds, railList, readLayout, sameLayout, type BoardItem, type StripCaption } from "@/blocks/board-layout";
import { convertTarget } from "@/blocks/grid-strip";
import { boardRefs, updateBlock, type TreeBlock } from "@/blocks/tree";
import { isVideoMode } from "@/blocks/video-mode";
import { getPageForEdit } from "@/lib/admin";
import { LookSchema, readLook, TextStyleSchema } from "@/lib/look";
import { HELP_TEXT } from "@/blocks/help-text";
import { applyMediaPatch, MediaPatchSchema } from "./media-look";
import { setLocalizedAt } from "./protocol";
import { getDb, schema } from "@/lib/db";
import { newProjectSlug, startTitle } from "./project-id";
import { BackgroundSchema } from "@/themes/schema";

import { checkLayout } from "./board-layout";
import { displayedProjects, projectTextProblem, referencedProjects, type DraftRefusal } from "./drafts";
import { done, fail, type ActionResult } from "./result";

type L = { fr: string; en: string };
const textDiffers = (a: { title: L; context: L; description: L; year: string }, b: { title: L; context: L; description: L; year: string }) => !(sameL(a.title, b.title) && sameL(a.context, b.context) && sameL(a.description, b.description) && a.year === b.year);
const sameL = (a: L | null | undefined, b: L | null | undefined) => (a?.fr ?? "") === (b?.fr ?? "") && (a?.en ?? "") === (b?.en ?? "");
type SlotRow = typeof schema.slots.$inferSelect;

/** Un PDF (bloc CV) ne se pose pas dans une planche. */
const PDF_NOT_IN_BOARD = "Un PDF ne se place pas dans un projet : utilise le bloc « CV ».";

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
const Uid = z.string().regex(/^[a-z0-9-]{1,32}$/);
/** Chemin d'un texte modifié en place (« title », « paragraphs.0 », « children.2.props.caption », « captions.<place>.date »). */
export const ItemTextPath = z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z0-9-]{1,80}){0,3}$/).max(120);
/** Un composant de la suite de la planche : la forme ici, les réglages par le registre (`checkLayout`). */
/** Largeur (20 à 100 %) et alignement communs à tous les composants (lot 31b). */
const Box = z.strictObject({ width: z.number().min(BOX_MIN).max(100).optional(), align: z.enum(["left", "center", "right"]).optional() });
const LayoutItem = z.strictObject({ uid: Uid, type: z.enum(BOARD_ITEM_TYPES as [BoardItem["type"], ...BoardItem["type"][]]), props: z.record(z.string(), z.unknown()), box: Box.optional(), captionStyle: z.strictObject({ title: TextStyleSchema.optional(), legend: TextStyleSchema.optional(), date: TextStyleSchema.optional() }).optional() });
/** Textes d'une grille de planche modifiables en place : les siens, et ceux de ses cases (lot 39). */
const GRID_TEXT_PATH = /^((eyebrow|title|captionTitle|caption|captionDate)|children\.\d{1,2}\.props\.(eyebrow|title|description|captionTitle|caption|captionDate))$/;
export const BoardSnapSchema = z.strictObject({
  projectId: z.number().int().positive(),
  project: z.strictObject({ title: TrimLoc(120), context: TrimLoc(200), description: TrimLoc(2000), year: z.string().trim().max(20) }).nullable(),
  slots: z.array(SnapSlot).max(MAX_BOARD_SLOTS),
  /** Suite de composants de la planche (lot 31). */
  layout: z.array(LayoutItem).max(MAX_BOARD_ITEMS),
  /** Vrai : `layout` est le contenu propre du bloc Projet de la page (lot 111) ; absent : le contenu partagé du projet. */
  own: z.literal(true).optional(),
  /** Vrai : `project` (textes) est la copie propre du bloc Projet de la page (lot 111) ; absent : textes du projet. */
  ownText: z.literal(true).optional(),
});
export type BoardSnap = z.infer<typeof BoardSnapSchema>;

export const BoardOpSchema = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("add"), mediaId: z.number().int().positive(), index: z.number().int().min(0).max(MAX_BOARD_SLOTS), collection: Collection.optional(), end: z.literal(true).optional() }),
  z.strictObject({ op: z.literal("move"), key: Key, index: z.number().int().min(0).max(MAX_BOARD_SLOTS) }),
  z.strictObject({ op: z.literal("remove"), key: Key }),
  z.strictObject({ op: z.literal("retire"), key: Key }),
  z.strictObject({ op: z.literal("fill"), key: Key, mediaId: z.number().int().positive() }),
  z.strictObject({ op: z.literal("text"), key: Key, field: z.enum(["title", "description"]), locale: z.enum(["fr", "en"]), value: z.string().max(2000) }),
  z.strictObject({ op: z.literal("project"), field: z.enum(["title", "context", "description", "year"]), locale: z.enum(["fr", "en"]), value: z.string().max(2000) }),
  // Contenu de la planche (lot 31) : ajouter un composant à une position, le déplacer d'un cran, le retirer, régler ses props.
  z.strictObject({ op: z.literal("item-add"), type: z.enum(BOARD_ITEM_TYPES as [BoardItem["type"], ...BoardItem["type"][]]), index: z.number().int().min(0).max(MAX_BOARD_ITEMS), uid: Uid.optional(), source: z.literal("project").optional(), after: Uid.optional() }),
  // Lot 31c : texte modifié en place sur la toile (chemin « title », « paragraphs.0 »…), et mise en forme (« Aa ») d'un composant.
  z.strictObject({ op: z.literal("item-text"), uid: Uid, path: ItemTextPath, locale: z.enum(["fr", "en"]), value: z.string().max(2000) }),
  z.strictObject({ op: z.literal("item-look"), uid: Uid, look: LookSchema.nullable() }),
  // Lot 98 : style des légendes du PROJET (un style par champ ; null = aucun), porté par la suite et publié avec elle.
  z.strictObject({ op: z.literal("captions-style"), style: z.strictObject({ title: TextStyleSchema.optional(), legend: TextStyleSchema.optional(), date: TextStyleSchema.optional() }).nullable() }),
  // Lot 31b : un média de la médiathèque posé sur un composant (Image / Vidéo : remplace ; Grille, carrousel : ajoute).
  z.strictObject({ op: z.literal("item-media"), uid: Uid, mediaId: z.number().int().positive() }),
  z.strictObject({ op: z.literal("item-to"), uid: Uid, index: z.number().int().min(0).max(MAX_BOARD_ITEMS) }),
  z.strictObject({ op: z.literal("item-move"), uid: Uid, dir: z.enum(["up", "down"]) }),
  z.strictObject({ op: z.literal("item-remove"), uid: Uid }),
  // Lot 32 : fond de couleur du composant (`props.background`, null = aucun) ; vaut aussi pour la bande des images du projet.
  z.strictObject({ op: z.literal("item-fond"), uid: Uid, background: BackgroundSchema.nullable() }),
  // Lot 75 (R4) : cadre, fond derrière l'image ou arrondi d'un composant Image ou Vidéo, par l'écriture commune `media-look`
  // (`props.look.frame` / `imageBg` / `radius`, null = retiré). Remplace `item-frame` (lots 34 et 62) et `item-imgbg` (lot 41).
  z.strictObject({ op: z.literal("item-media-look"), uid: Uid, patch: MediaPatchSchema }),
  // Lot 31f : les places d'un carrousel à liste propre (`at` : rang dans sa liste), mêmes gestes que les emplacements de la bande du projet.
  z.strictObject({ op: z.literal("rail-add"), uid: Uid, mediaId: z.number().int().positive(), index: z.number().int().min(0).max(MAX_RAIL_MEDIA) }),
  z.strictObject({ op: z.literal("rail-fill"), uid: Uid, at: z.number().int().min(0).max(MAX_RAIL_MEDIA), mediaId: z.number().int().positive() }),
  z.strictObject({ op: z.literal("rail-clear"), uid: Uid, at: z.number().int().min(0).max(MAX_RAIL_MEDIA) }),
  z.strictObject({ op: z.literal("rail-retire"), uid: Uid, at: z.number().int().min(0).max(MAX_RAIL_MEDIA) }),
  z.strictObject({ op: z.literal("rail-move"), uid: Uid, at: z.number().int().min(0).max(MAX_RAIL_MEDIA), index: z.number().int().min(0).max(MAX_RAIL_MEDIA) }),
  z.strictObject({ op: z.literal("item-set"), uid: Uid, props: z.record(z.string(), z.unknown()).optional(), box: Box.nullable().optional() }),
  // Lot 69 : « Afficher en : Grille / Images qui défilent » : le composant change de forme SUR PLACE (même uid, même rang, même largeur) ;
  // les nouvelles données sont calculées par l'éditeur (src/blocks/grid-strip.ts) et contrôlées ici comme toute suite de planche.
  z.strictObject({ op: z.literal("item-convert"), uid: Uid, to: z.enum(["grid", "strip"]), props: z.record(z.string(), z.unknown()) }),
]);
export type BoardOp = z.infer<typeof BoardOpSchema>;

/** `slug` : projet de la planche (l'éditeur reconnaît son bloc). */
export type OwnBlock = { uid: string; layout: BoardItem[] | null; text: OwnText | null };
export type BoardResult = {
  before: BoardSnap;
  after: BoardSnap;
  rev: number;
  slug: string;
  /** Lot 111 : blocs du brouillon dont le serveur a écrit la copie propre (`layout`, `text` null : absent) ; l'éditeur recopie ces changements dans son brouillon. */
  blocks?: OwnBlock[];
};

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
  if (!displayedProjects(draftBlocks(pageId)).includes(projectId)) return "Cette page n'affiche pas ce projet : ajoute d'abord son projet à la page.";
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

/**
 * Le contenu de la planche est-il modifiable depuis le brouillon de cette page ? Comme les emplacements : la page doit
 * AFFICHER la planche de ce projet ; la surcouche ne peut être tenue que par une page à la fois.
 */
function layoutAccess(pageId: number, projectId: number): string | null {
  const db = getDb();
  const project = db
    .select({ draftPageId: schema.projects.draftPageId, layoutPage: schema.projects.draftLayoutPageId })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();
  if (!project) return "Ce projet n'existe plus : recharge l'éditeur.";
  const pageName = (id: number) => db.select({ title: schema.pages.title }).from(schema.pages).where(eq(schema.pages.id, id)).get()?.title.fr || `n° ${id}`;
  if (project.draftPageId !== null && project.draftPageId !== pageId) {
    return `Ce projet est en cours de création sur la page ${pageName(project.draftPageId)} : publie-la ou abandonne-la d'abord.`;
  }
  if (project.layoutPage !== null && project.layoutPage !== pageId) {
    return `Le contenu de ce projet est en cours de modification sur la page ${pageName(project.layoutPage)} : publie-le ou abandonne-le d'abord.`;
  }
  if (!displayedProjects(draftBlocks(pageId)).includes(projectId)) return "Cette page n'affiche pas ce projet : ajoute d'abord son projet à la page.";
  return null;
}

/** Blocs du brouillon de la page (sinon de la version publiée). */
function draftBlocks(pageId: number): { type: string; props: unknown }[] {
  const draft = getDb().select({ draft: schema.pages.draft }).from(schema.pages).where(eq(schema.pages.id, pageId)).get()?.draft as { blocks?: unknown } | null | undefined;
  if (draft && Array.isArray(draft.blocks)) return (draft.blocks as { type?: unknown; props?: unknown }[]).filter((b) => typeof b?.type === "string") as { type: string; props: unknown }[];
  return getPageForEdit(pageId)?.blocks ?? [];
}

/** Blocs Projet de la page (brouillon, sinon version publiée) qui affichent ce projet, dans l'ordre de lecture. */
function boardBlocks(pageId: number, slug: string): TreeBlock[] {
  return boardRefs(draftBlocks(pageId) as TreeBlock[]).filter((b) => b.slug === slug).map((b) => b.block);
}

/** Contenu propre de la page pour ce projet (lot 111) : celui du premier bloc Projet qui en porte un, sinon null (contenu partagé). */
function ownLayout(pageId: number, slug: string): BoardItem[] | null {
  for (const b of boardBlocks(pageId, slug)) {
    const own = ownLayoutOf(b.props);
    if (own) return own;
  }
  return null;
}

/** Textes propres de la page pour ce projet (lot 111) : ceux du premier bloc Projet qui en porte, sinon null. */
function ownTextOfPage(pageId: number, slug: string): OwnText | null {
  for (const b of boardBlocks(pageId, slug)) {
    const own = ownTextOf(b.props);
    if (own) return own;
  }
  return null;
}

/**
 * Le contenu propre de la page s'écrit-il ? Le projet n'est pas en cours de création sur une autre page, et la page a un bloc Projet pour lui
 * (c'est ce bloc qui porte le contenu). Aucun verrou de projet : le brouillon d'une autre page ne gêne pas.
 */
function ownAccess(pageId: number, projectId: number): string | null {
  const db = getDb();
  const project = db.select({ slug: schema.projects.slug, draftPageId: schema.projects.draftPageId }).from(schema.projects).where(eq(schema.projects.id, projectId)).get();
  if (!project) return "Ce projet n'existe plus : recharge l'éditeur.";
  if (project.draftPageId !== null && project.draftPageId !== pageId) {
    const name = db.select({ title: schema.pages.title }).from(schema.pages).where(eq(schema.pages.id, project.draftPageId)).get()?.title.fr || `n° ${project.draftPageId}`;
    return `Ce projet est en cours de création sur la page ${name} : publie-la ou abandonne-la d'abord.`;
  }
  if (!boardBlocks(pageId, project.slug).length) return "Cette page n'a pas de bloc Projet pour ce projet : ajoute-le d'abord à la page.";
  return null;
}

/** Le contenu PARTAGÉ du projet tel que le brouillon de cette page le voit (son brouillon du projet s'il le tient, sinon le contenu publié). */
function sharedLayout(pageId: number, projectId: number): BoardItem[] {
  const project = getDb().select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();
  return project ? projectLayout(project, pageId) : defaultLayout();
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

/** Suite de composants telle que le brouillon de la page la montre : sa surcouche, sinon la suite du projet. */
function projectLayout(row: ProjectRow, pageId: number): BoardItem[] {
  if (row.draftLayoutPageId === pageId && row.draftLayout) return readLayout(row.draftLayout);
  return readLayout(row.layout);
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
  const own = project ? ownLayout(pageId, project.slug) : null;
  const ownText = project ? ownTextOfPage(pageId, project.slug) : null;
  return {
    projectId,
    project: ownText ?? (project ? projectText(project, pageId) : null),
    ...(ownText ? { ownText: true as const } : {}),
    layout: own ?? (project ? projectLayout(project, pageId) : defaultLayout()),
    ...(own ? { own: true as const } : {}),
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
    if (keys.has(s.key)) return "Projet invalide (emplacement en double) : recharge l'éditeur.";
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
/**
 * Écrit (ou retire, `layout` null) le contenu propre dans le brouillon de la page : `props.layout` du bloc Projet de ce projet.
 * Poser : le bloc qui en porte déjà un, sinon le premier. Retirer : tous les blocs du projet (un seul contenu propre à la fois).
 * Renvoie l'uid du bloc touché (pour l'éditeur). Dans la transaction de l'appelant, après `touchPage` (brouillon garanti).
 */
function writeOwn(pageId: number, slug: string, patch: { layout?: BoardItem[] | null; text?: OwnText | null }): OwnBlock[] {
  const db = getDb();
  const row = db.select({ draft: schema.pages.draft }).from(schema.pages).where(eq(schema.pages.id, pageId)).get();
  const draft = row?.draft as { blocks?: TreeBlock[] } | null | undefined;
  if (!draft || !Array.isArray(draft.blocks)) return [];
  const refs = boardRefs(draft.blocks).filter((b) => b.slug === slug && b.block.uid);
  let blocks = draft.blocks;
  const touched = new Set<string>();
  for (const key of ["layout", "text"] as const) {
    const value = patch[key];
    if (value === undefined) continue;
    const has = (b: TreeBlock) => (b.props as Record<string, unknown> | undefined)?.[key] !== undefined;
    const targets = value === null ? refs.filter((b) => has(b.block)) : [refs.find((b) => has(b.block)) ?? refs[0]].filter(Boolean);
    for (const t of targets) {
      blocks = updateBlock(blocks, t.block.uid!, (b) => {
        const props = { ...((b.props as Record<string, unknown> | undefined) ?? {}) };
        if (value) props[key] = value;
        else delete props[key];
        return { ...b, props };
      });
      touched.add(t.block.uid!);
    }
  }
  if (!touched.size) return [];
  db.update(schema.pages).set({ draft: { ...draft, blocks } as never }).where(eq(schema.pages.id, pageId)).run();
  return boardRefs(blocks)
    .filter((b) => b.block.uid && touched.has(b.block.uid))
    .map((b) => ({ uid: b.block.uid!, layout: ownLayoutOf(b.block.props), text: ownTextOf(b.block.props) }));
}

function writeBoard(pageId: number, snap: BoardSnap, only: { slots: boolean; text: boolean; layout: boolean }): OwnBlock[] {
  const touchedBlock: OwnBlock[] = [];
  const db = getDb();
  const project = db.select().from(schema.projects).where(eq(schema.projects.id, snap.projectId)).get();
  if (!project) throw new Error("projet disparu");
  if (only.text && snap.project) {
    const t = snap.project;
    if (project.draftPageId === pageId) {
      // Projet créé dans ce brouillon : ses textes sont sur sa ligne (invisible ailleurs).
      db.update(schema.projects).set({ title: t.title, context: t.context, description: t.description, year: t.year }).where(eq(schema.projects.id, project.id)).run();
    } else if (snap.ownText) {
      // Textes propres au bloc (lot 111) : dans le bloc, jamais dans le projet. Le brouillon de textes que CETTE page tenait lui est devenu
      // inutile (copié dans le bloc) ; celui d'une autre page n'est pas touché.
      touchedBlock.push(...writeOwn(pageId, project.slug, { text: t }));
      if (project.draftTextPageId === pageId) db.update(schema.projects).set({ draftText: null, draftTextPageId: null }).where(eq(schema.projects.id, project.id)).run();
    } else {
      touchedBlock.push(...writeOwn(pageId, project.slug, { text: null }));
      // Projet publié, sans bloc Projet pour porter une copie : surcouche de la page ; revenir aux textes publiés l'efface.
      const same = sameL(t.title, project.title) && sameL(t.context, project.context) && sameL(t.description, project.description) && t.year === project.year;
      if (project.draftTextPageId === null || project.draftTextPageId === pageId) {
        db.update(schema.projects)
          .set(same ? { draftText: null, draftTextPageId: null } : { draftText: t, draftTextPageId: pageId })
          .where(eq(schema.projects.id, project.id))
          .run();
      }
    }
  }
  if (only.layout) {
    if (snap.own) {
      // Contenu propre à la page (lot 111) : dans le bloc, jamais dans le projet. Le brouillon du projet que CETTE page tenait lui est
      // devenu inutile (son contenu est dans le bloc) ; celui d'une autre page n'est pas touché.
      touchedBlock.push(...writeOwn(pageId, project.slug, { layout: snap.layout }));
      if (project.draftLayoutPageId === pageId) db.update(schema.projects).set({ draftLayout: null, draftLayoutPageId: null }).where(eq(schema.projects.id, project.id)).run();
    } else {
      touchedBlock.push(...writeOwn(pageId, project.slug, { layout: null }));
      if (project.draftPageId === pageId) {
        // Projet créé dans ce brouillon : sa suite est sur sa ligne (invisible ailleurs).
        db.update(schema.projects).set({ layout: snap.layout }).where(eq(schema.projects.id, project.id)).run();
      } else if (project.draftLayoutPageId === null || project.draftLayoutPageId === pageId) {
        // Projet publié : surcouche de la page ; revenir à la suite publiée l'efface. Le brouillon d'une AUTRE page n'est jamais effacé ici.
        const same = sameLayout(snap.layout, readLayout(project.layout));
        db.update(schema.projects)
          .set(same ? { draftLayout: null, draftLayoutPageId: null } : { draftLayout: snap.layout, draftLayoutPageId: pageId })
          .where(eq(schema.projects.id, project.id))
          .run();
      }
    }
  }
  if (!only.slots) return touchedBlock;
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
  return touchedBlock;
}

/** Brouillon de la page garanti (copie de la version publiée) et version incrémentée. */
export function touchPage(pageId: number, rev: number): boolean {
  const db = getDb();
  const page = db.select({ draft: schema.pages.draft }).from(schema.pages).where(eq(schema.pages.id, pageId)).get();
  let draft = page?.draft ?? null;
  if (draft === null) {
    const published = getPageForEdit(pageId);
    if (!published) return false;
    const { title, slug, meta, published: pub, inMenu, accent, wallpaper, collection, blocks } = published;
    draft = { title, slug, meta, published: pub, inMenu, accent, wallpaper, collection, blocks: blocks.map((b, i) => ({ uid: `b${i}`, type: b.type, props: b.props })) };
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
function mutate(pageId: number, projectIdInput: unknown, rev: unknown, change: (snap: BoardSnap) => BoardSnap | string, restoring = false, textOp = false, layoutOp = false): ActionResult<BoardResult> | DraftRefusal {
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
  const textChangedRaw = JSON.stringify(before.project) !== JSON.stringify(next.project);
  // Copie à l'écriture (lot 111) : toute modification du contenu ou des textes, depuis une page qui a un bloc Projet pour ce projet, s'écrit
  // dans CE bloc (copie de ce que la page voit) ; jamais dans le projet, jamais chez une autre page. Projet créé dans ce brouillon : sa ligne.
  const proj = getDb().select({ slug: schema.projects.slug, draftPageId: schema.projects.draftPageId }).from(schema.projects).where(eq(schema.projects.id, projectId.data)).get();
  const local = proj?.draftPageId === pageId;
  const hasBlock = Boolean(proj) && boardBlocks(pageId, proj!.slug).length > 0;
  if (proj && !local && hasBlock) {
    if (!next.own && !sameLayout(next.layout, sharedLayout(pageId, projectId.data))) next.own = true;
    if (!next.ownText && next.project && textDiffers(next.project, projectText(getDb().select().from(schema.projects).where(eq(schema.projects.id, projectId.data)).get()!, pageId))) next.ownText = true;
  }
  const ownChanged = Boolean(before.own) !== Boolean(next.own);
  const ownTextChanged = Boolean(before.ownText) !== Boolean(next.ownText);
  const textChanged = textChangedRaw || ownTextChanged;
  const layoutChanged = !sameLayout(before.layout, next.layout) || ownChanged;
  // Un texte « modifié » à l'identique : rien à écrire, rien à garder (pas de faux refus d'accès à la planche).
  if (textOp && !textChanged) return done({ before, after: before, rev: current, slug: slugOf(projectId.data) });
  // Un composant déjà tout en haut / en bas, des réglages identiques : rien à écrire non plus.
  if (layoutOp && !layoutChanged) return done({ before, after: before, rev: current, slug: slugOf(projectId.data) });
  if (slotsChanged || (!textChanged && !layoutChanged)) {
    const denied = access(pageId, projectId.data);
    if (denied) return fail(denied);
  }
  if (layoutChanged) {
    // Contenu propre au bloc (lot 111) : seul le bloc de la page est écrit, aucun verrou de projet. Projet créé dans ce brouillon : sa ligne.
    const denied = local ? layoutAccess(pageId, projectId.data) : ownAccess(pageId, projectId.data);
    if (denied) return fail(denied);
    // Forme, réglages (schémas du registre) et médias de la suite ; un composant inachevé reste un brouillon.
    const checked = checkLayout(next.layout, { allowPending: restoring });
    if ("error" in checked) return fail(checked.error);
    next.layout = checked.layout;
  }
  if (textChanged) {
    const denied = !local && hasBlock ? ownAccess(pageId, projectId.data) : textAccess(pageId, projectId.data);
    if (denied) return fail(denied);
    // Même exigence que l'écran Projets : un titre (fr) et une année jamais vides.
    const problem = next.project && projectTextProblem(next.project);
    if (problem) return fail(problem);
  }
  if (next.slots.length > MAX_BOARD_SLOTS) return fail(`${MAX_BOARD_SLOTS} emplacements au plus par projet.`);
  const problem = checkSnap(pageId, next, restoring);
  if (problem) return fail(problem);
  let block: OwnBlock[] = [];
  try {
    getDb().transaction(() => {
      if (!touchPage(pageId, rev)) throw new ConflictError();
      block = writeBoard(pageId, next, { slots: slotsChanged || (!textChanged && !layoutChanged), text: textChanged, layout: layoutChanged });
    });
  } catch (error) {
    if (error instanceof ConflictError) return conflict(pageRev(pageId) ?? rev);
    throw error;
  }
  return done({ before, after: readBoard(pageId, projectId.data), rev: rev + 1, slug: slugOf(projectId.data), ...(block.length ? { blocks: block } : {}) });
}

const slugOf = (projectId: number) => getDb().select({ slug: schema.projects.slug }).from(schema.projects).where(eq(schema.projects.id, projectId)).get()?.slug ?? "";

const newKey = () => `k${randomBytes(8).toString("hex")}`;
/**
 * Un Texte de planche neuf porte le texte d'exemple dans les DEUX langues ; dès qu'une langue est écrite, l'exemple de l'autre est
 * retiré (comme sur une page, où il n'est posé que dans la langue éditée) : sinon la publication le refuserait.
 */
function settleHelp(props: Record<string, unknown>): Record<string, unknown> {
  const fix = (v: unknown, help: { fr: string; en: string }): unknown => {
    if (!v || typeof v !== "object") return v;
    const l = v as { fr?: string; en?: string };
    const frHelp = l.fr === help.fr;
    const enHelp = l.en === help.en;
    if (frHelp && !enHelp && l.en) return { ...l, fr: "" };
    if (enHelp && !frHelp && l.fr) return { ...l, en: "" };
    return v;
  };
  const out = { ...props };
  if (out.title) out.title = fix(out.title, HELP_TEXT.title);
  if (Array.isArray(out.paragraphs)) out.paragraphs = out.paragraphs.map((p) => fix(p, HELP_TEXT.paragraph));
  return out;
}

/** Identité d'une place de carrousel (`railIds`). */
const newPlaceId = () => `n${randomBytes(4).toString("hex")}`;
const newItemUid = () => `c${randomBytes(6).toString("hex")}`;
const EMPTY: L = { fr: "", en: "" };

/**
 * Le style des légendes du projet (lot 98) suit toute opération de la suite : retirer ou déplacer le composant qui le portait ne le perd
 * pas (il est remis sur le premier composant). Seule `captions-style` le change.
 */
const keepCaptionStyle = (opName: string, change: (snap: BoardSnap) => BoardSnap | string) => (snap: BoardSnap): BoardSnap | string => {
  const keep = projectCaptionStyle(snap.layout);
  const next = change(snap);
  if (typeof next !== "string" && opName !== "captions-style" && keep && !projectCaptionStyle(next.layout) && next.layout.length) next.layout[0] = { ...next.layout[0], captionStyle: keep };
  return next;
};

/** Une opération sur la planche (toile : ajouter, déplacer, retirer, remplacer, textes). */
export function boardOp(pageId: number, projectId: unknown, opInput: unknown, rev: unknown): ActionResult<BoardResult> | DraftRefusal {
  const parsed = BoardOpSchema.safeParse(opInput);
  if (!parsed.success) return fail("Opération invalide : recharge l'éditeur.");
  const op = parsed.data;
  return mutate(pageId, projectId, rev, keepCaptionStyle(op.op, (snap) => {
    const at = (key: string) => snap.slots.findIndex((s) => s.key === key);
    switch (op.op) {
      case "add": {
        // `end` : à la fin de la planche, sans connaître son nombre d'emplacements (clic sur un média de l'onglet Médias).
        const index = op.end ? snap.slots.length : op.index;
        if (index > snap.slots.length) return "Position invalide.";
        snap.slots.splice(index, 0, { key: newKey(), mediaId: op.mediaId, title: EMPTY, description: EMPTY, ...(op.collection ? { collection: op.collection } : {}) });
        return snap;
      }
      case "move": {
        const from = at(op.key);
        if (from < 0) return "Cet emplacement n'est pas sur ce projet.";
        if (op.index > snap.slots.length) return "Position invalide.";
        const [item] = snap.slots.splice(from, 1);
        snap.slots.splice(Math.min(op.index > from ? op.index - 1 : op.index, snap.slots.length), 0, item);
        return snap;
      }
      case "remove":
      case "fill": {
        const i = at(op.key);
        if (i < 0) return "Cet emplacement n'est pas sur ce projet.";
        snap.slots[i].mediaId = op.op === "fill" ? op.mediaId : null;
        return snap;
      }
      case "retire": {
        const i = at(op.key);
        if (i < 0) return "Cet emplacement n'est pas sur ce projet.";
        snap.slots.splice(i, 1);
        return snap;
      }
      case "text": {
        const i = at(op.key);
        if (i < 0) return "Cet emplacement n'est pas sur ce projet.";
        const max = op.field === "title" ? 120 : 2000;
        snap.slots[i][op.field] = { ...snap.slots[i][op.field], [op.locale]: op.value.slice(0, max) };
        return snap;
      }
      case "item-add": {
        if (snap.layout.length >= MAX_BOARD_ITEMS) return `${MAX_BOARD_ITEMS} blocs au plus par projet.`;
        // `after` : sous ce composant (clic sur une carte de la palette), sinon à la position donnée.
        const at = op.after ? snap.layout.findIndex((i) => i.uid === op.after) + 1 : op.index;
        if (op.after && at === 0) return "Ce bloc n'est plus sur ce projet.";
        if (at > snap.layout.length) return "Position invalide.";
        if (op.type === "strip" && op.source === "project" && snap.layout.some(isProjectStrip)) return "Ce projet montre déjà ses images.";
        const uid = op.uid ?? newItemUid();
        if (snap.layout.some((i) => i.uid === uid)) return "Bloc en double.";
        snap.layout.splice(at, 0, newBoardItem(op.type, uid, op.source));
        return snap;
      }
      case "item-move": {
        const from = snap.layout.findIndex((i) => i.uid === op.uid);
        if (from < 0) return "Ce bloc n'est plus sur ce projet.";
        const to = from + (op.dir === "up" ? -1 : 1);
        if (to < 0 || to >= snap.layout.length) return snap;
        const [item] = snap.layout.splice(from, 1);
        snap.layout.splice(to, 0, item);
        return snap;
      }
      case "item-media": {
        const item = snap.layout.find((i) => i.uid === op.uid);
        if (!item) return "Ce bloc n'est plus sur ce projet.";
        const media = getDb().select({ kind: schema.media.kind, width: schema.media.width, height: schema.media.height }).from(schema.media).where(eq(schema.media.id, op.mediaId)).get();
        if (!media) return "Ce média n'existe plus.";
        if (media.kind === "pdf") return PDF_NOT_IN_BOARD;
        if (item.type === "image") {
          if (media.kind !== "image") return "Cette image attend une image, pas une vidéo.";
          item.props = { ...item.props, mediaId: op.mediaId };
        } else if (item.type === "video-single") {
          if (media.kind !== "video") return "Cette vidéo attend une vidéo, pas une image.";
          item.props = { ...item.props, mediaId: op.mediaId };
        } else if (item.type === "free-board") {
          // Planche libre (lot 42) : l'image se pose au centre de la zone (le glisser-déposer sur la toile choisit l'endroit).
          if (media.kind !== "image" && media.kind !== "video") return "Une planche libre accueille des images et des vidéos.";
          const res = applyFreeOp(item.props, { op: "put", id: newFreeId(), media: op.mediaId, x: 50, y: 50, ratio: media.width && media.height ? media.width / media.height : 1.5 });
          if ("error" in res) return res.error;
          item.props = res.props;
        } else if (item.type === "grid") {
          const kids = Array.isArray(item.props.children) ? (item.props.children as unknown[]) : [];
          if (kids.length >= 24) return "24 éléments au plus par grille.";
          const child = media.kind === "video" ? { type: "video-single", props: { variant: "card", mode: "player", mediaId: op.mediaId } } : { type: "image", props: { width: "wide", mediaId: op.mediaId } };
          item.props = { ...item.props, children: [...kids, { uid: newItemUid(), ...child }] };
        } else if (item.type === "strip" && !isProjectStrip(item)) {
          const list = railList(item.props);
          if (list.length >= MAX_RAIL_MEDIA) return `${MAX_RAIL_MEDIA} médias au plus par carrousel.`;
          item.props = { ...item.props, media: [...list, op.mediaId], ids: [...railIds(item.props), newPlaceId()] };
        } else return item.type === "strip" ? "Cette bande montre les images du projet : dépose l'image sur la bande." : "Ce bloc n'accepte pas d'image.";
        return snap;
      }
      case "rail-add":
      case "rail-fill":
      case "rail-clear":
      case "rail-retire":
      case "rail-move": {
        const item = snap.layout.find((i) => i.uid === op.uid);
        if (!item || item.type !== "strip" || isProjectStrip(item)) return "Ce carrousel n'est plus sur ce projet.";
        const list = railList(item.props);
        const ids = railIds(item.props);
        if (op.op === "rail-add") {
          if (op.index > list.length) return "Position invalide.";
          if (list.length >= MAX_RAIL_MEDIA) return `${MAX_RAIL_MEDIA} médias au plus par carrousel.`;
          list.splice(op.index, 0, op.mediaId);
          ids.splice(op.index, 0, newPlaceId());
        } else {
          if (op.at >= list.length) return "Cette place n'est plus dans ce carrousel.";
          if (op.op === "rail-fill") list[op.at] = op.mediaId;
          else if (op.op === "rail-clear") list[op.at] = null;
          else if (op.op === "rail-retire") {
            list.splice(op.at, 1);
            ids.splice(op.at, 1);
          } else {
            if (op.index > list.length) return "Position invalide.";
            const to = Math.min(op.index > op.at ? op.index - 1 : op.index, list.length - 1);
            const [moved] = list.splice(op.at, 1);
            const [movedId] = ids.splice(op.at, 1);
            list.splice(to, 0, moved);
            ids.splice(to, 0, movedId);
          }
        }
        item.props = { ...item.props, media: list, ids };
        return snap;
      }
      case "item-text": {
        const item = snap.layout.find((i) => i.uid === op.uid);
        if (!item) return "Ce bloc n'est plus sur ce projet.";
        // Titre / Légende / Date sous les images d'une bande (lot 39) : `captions.<place>.<champ>`.
        if (item.type === "strip") {
          const cap = parseCaptionPath(op.path);
          if (!cap) return "Ce bloc n'a pas de texte à modifier ici.";
          const prev = item.props.captions;
          const captions: Record<string, StripCaption> = typeof prev === "object" && prev !== null && !Array.isArray(prev) ? { ...(prev as Record<string, StripCaption>) } : {};
          const entry: StripCaption = { ...(Object.hasOwn(captions, cap.key) ? captions[cap.key] : {}) };
          entry[cap.field] = { fr: "", en: "", ...(entry[cap.field] ?? {}), [op.locale]: op.value };
          captions[cap.key] = entry;
          item.props = { ...item.props, captions };
          return snap;
        }
        // Une grille : ses textes (étiquette, titre, légende) et ceux de ses cases (légende d'une image, d'une vidéo).
        if (item.type === "grid" && !GRID_TEXT_PATH.test(op.path)) return "Ce bloc n'a pas de texte à modifier ici.";
        if (item.type === "grid" && op.path.startsWith("children.")) {
          const rank = Number(op.path.split(".")[1]);
          if (!Array.isArray(item.props.children) || rank >= item.props.children.length) return "Cette case n'existe plus.";
        }
        // Planche libre : Titre / Légende / Date sous la zone (lot 39 branché par l'intégration v0.27).
        if (item.type === "free-board" && !/^(captionTitle|caption|captionDate)$/.test(op.path)) return "Ce bloc n'a pas de texte à modifier ici.";
        item.props = item.type === "rich-text" ? settleHelp(setLocalizedAt(item.props, op.path, op.locale, op.value)) : setLocalizedAt(item.props, op.path, op.locale, op.value);
        return snap;
      }
      case "item-look": {
        const item = snap.layout.find((i) => i.uid === op.uid);
        if (!item) return "Ce bloc n'est plus sur ce projet.";
        // La bande n'a qu'un réglage de mise en forme : l'espace au-dessus (lot 40).
        if (item.type === "strip" && op.look && Object.keys(op.look).some((k) => k !== "spaceTop")) return "Ce bloc n'a pas de mise en forme propre.";
        const { look: _old, ...rest } = item.props;
        void _old;
        item.props = op.look && Object.keys(op.look).length ? { ...rest, look: op.look } : rest;
        return snap;
      }
      case "captions-style": {
        if (!snap.layout.length) return "Ce projet n'a pas de contenu.";
        const style = op.style ? Object.fromEntries(CAPTION_STYLE_FIELDS.flatMap((f) => (op.style![f] && Object.keys(op.style![f]!).length ? [[f, op.style![f]]] : []))) : {};
        snap.layout = snap.layout.map((item, i) => {
          const { captionStyle: _old, ...rest } = item;
          void _old;
          return i === 0 && Object.keys(style).length ? { ...rest, captionStyle: style } : rest;
        });
        return snap;
      }
      case "item-to": {
        const from = snap.layout.findIndex((i) => i.uid === op.uid);
        if (from < 0) return "Ce bloc n'est plus sur ce projet.";
        if (op.index > snap.layout.length) return "Position invalide.";
        // Index compté dans la liste d'origine (avant le retrait), comme moveTo.
        const [item] = snap.layout.splice(from, 1);
        snap.layout.splice(Math.min(op.index > from ? op.index - 1 : op.index, snap.layout.length), 0, item);
        return snap;
      }
      case "item-remove": {
        const from = snap.layout.findIndex((i) => i.uid === op.uid);
        if (from < 0) return "Ce bloc n'est plus sur ce projet.";
        snap.layout.splice(from, 1);
        return snap;
      }
      case "item-fond": {
        const item = snap.layout.find((i) => i.uid === op.uid);
        if (!item) return "Ce bloc n'est plus sur ce projet.";
        const props = { ...item.props };
        if (op.background) props.background = op.background;
        else delete props.background;
        item.props = props;
        return snap;
      }
      case "item-media-look": {
        const item = snap.layout.find((i) => i.uid === op.uid);
        if (!item) return "Ce bloc n'est plus sur ce projet.";
        if (item.type !== "image" && item.type !== "video-single") return "Le cadre, le fond et l'arrondi ne concernent que les images et les vidéos.";
        if (op.patch.bg !== undefined && op.patch.bg !== null && item.type !== "image") return "Le fond ne concerne que les images.";
        const res = applyMediaPatch(readLook(item.props.look), op.patch);
        if ("error" in res) return res.error;
        const props = { ...item.props };
        if (res.look) props.look = res.look;
        else delete props.look;
        item.props = props;
        return snap;
      }
      case "item-set": {
        const item = snap.layout.find((i) => i.uid === op.uid);
        if (!item) return "Ce bloc n'est plus sur ce projet.";
        if (op.props !== undefined) {
          if (isProjectStrip(item)) {
            // Seul réglage de la bande du projet (lot 36) : la lecture de ses vidéos.
            if (Object.keys(op.props).some((k) => k !== "videoMode")) return "Cette bande montre les images du projet : elle n'a pas de réglage de contenu.";
            if (op.props.videoMode !== undefined && !isVideoMode(op.props.videoMode)) return "Lecture de vidéo inconnue.";
          } else if (item.type === "strip" && op.props.videoMode !== undefined && !isVideoMode(op.props.videoMode)) return "Lecture de vidéo inconnue.";
          item.props = item.type === "rich-text" ? settleHelp(op.props) : op.props;
        }
        if (op.box !== undefined) {
          // Rien de réglé (ou 100 %, sans alignement) : la clé disparaît, le rendu redevient celui d'avant.
          const b = op.box;
          if (!b || (b.width === undefined && b.align === undefined)) delete item.box;
          else item.box = { ...(b.width !== undefined ? { width: b.width } : {}), ...(b.align !== undefined ? { align: b.align } : {}) };
        }
        return snap;
      }
      case "item-convert": {
        const item = snap.layout.find((i) => i.uid === op.uid);
        if (!item) return "Ce bloc n'est plus sur ce projet.";
        const target = convertTarget(item);
        if ("reason" in target) return target.reason;
        if (target.to !== op.to) return op.to === "strip" ? "Ce bloc est déjà en images qui défilent." : "Ce bloc est déjà une grille.";
        // Un carrousel qui devient grille ne peut pas en porter plus que la grille ; une grille garde ses cases.
        item.type = op.to === "strip" ? "strip" : "grid";
        item.props = op.props;
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
  }), false, op.op === "project", op.op.startsWith("item-") || op.op.startsWith("rail-") || op.op === "captions-style");
}

/** Annuler / Rétablir : réécrit un instantané (contrôlé). */
export function restoreBoard(pageId: number, snapInput: unknown, rev: unknown, fromInput?: unknown): ActionResult<BoardResult> | DraftRefusal {
  const parsed = BoardSnapSchema.safeParse(snapInput);
  if (!parsed.success) return fail("Projet invalide : recharge l'éditeur.");
  const snap = parsed.data;
  // `from` : la planche telle que l'éditeur la croit (celle que ce pas d'historique quitte).
  const from = fromInput === undefined || fromInput === null ? null : BoardSnapSchema.safeParse(fromInput);
  if (from && !from.success) return fail("Projet invalide : recharge l'éditeur.");
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
export function createDraftProject(pageId: number, titleInput?: unknown): ActionResult<{ id: number; slug: string; title: string }> {
  // Lot 111 : aucun nom demandé ; slug = id aléatoire unique, titre par défaut (un titre donné par un appel d'API est gardé, jamais utilisé pour le slug).
  const given = z.string().trim().max(120).optional().safeParse(titleInput ?? undefined);
  if (!given.success) return fail("Nom invalide.");
  const title = { success: true as const, data: startTitle(given.data) };
  const db = getDb();
  if (!db.select({ id: schema.pages.id }).from(schema.pages).where(eq(schema.pages.id, pageId)).get()) return fail("Cette page n'existe plus.");
  const pending = db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.draftPageId, pageId)).all().length;
  if (pending >= MAX_DRAFT_PROJECTS) return fail(`${MAX_DRAFT_PROJECTS} projets au plus créés dans un même brouillon : publie ou abandonne d'abord.`);
  const slug = newProjectSlug((s) => Boolean(db.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.slug, s)).get()));
  const [{ m }] = db.select({ m: max(schema.projects.position) }).from(schema.projects).all();
  const row = db
    .insert(schema.projects)
    .values({
      slug,
      title: title.data,
      context: { fr: "", en: "" },
      description: { fr: "", en: "" },
      year: String(new Date().getFullYear()),
      featured: false,
      position: (m ?? 0) + 1,
      draftPageId: pageId,
    })
    .returning({ id: schema.projects.id })
    .get();
  return done({ id: row.id, slug, title: title.data.fr });
}

