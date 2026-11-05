/**
 * Messages entre l'éditeur visuel (/admin/pages/<id>/editer) et sa toile
 * (iframe de la même origine, vue brouillon). Chaque côté vérifie l'origine
 * (la sienne) et la source (la fenêtre parente, ou l'iframe), puis valide le
 * message par un schéma discriminé par `kind` : un message étranger ou
 * malformé est ignoré, sans exception.
 */
import { z } from "zod";

import { BOARD_ITEM_TYPES, MAX_BOARD_ITEMS, type BoardItemType } from "../../blocks/board-layout";
import { FREE_FORMATS } from "../../blocks/free-board";
import { GRID_LAYOUTS, MAX_GRID_CELLS } from "../../blocks/grid-layouts";
import { RATIO_VALUES } from "../images/formats";
import { FIELD_OP_NAMES } from "../../blocks/optional-fields";
import { BackgroundSchema } from "../../themes/schema";
import { SurfaceSchema } from "../../themes/surface";
import { LogoSchema, LookSchema, ROLES, SitePaletteSchema, TextStyleSchema } from "../look";
import { MediaPatchSchema } from "./media-look";
import { BASE_KEYS } from "../../themes/palette";

export const EDIT_MSG = "portfolio:edit";

/** « add-<champ> » / « remove-<champ> » pour chaque champ facultatif (src/blocks/optional-fields.ts). */
type FieldOp = `${"add" | "remove"}-${(typeof FIELD_OP_NAMES)[number]}`;
const FIELD_OPS = FIELD_OP_NAMES.flatMap((f) => [`add-${f}`, `remove-${f}`]) as [FieldOp, ...FieldOp[]];

const Uid = z.string().regex(/^[a-z0-9-]{1,32}$/);
/** `parent` : conteneur du bloc (v0.13) ; absent = bloc de la page. */
const Block = z.object({ uid: Uid, type: z.string().max(60), label: z.string().max(120), parent: Uid.optional() });
const Blocks = z.array(Block).max(400);
/** Liste visée par un dépôt ou un déplacement : la page (null), ou un conteneur. */
const Parent = Uid.nullable();
const MediaField = z.enum(["mediaId", "backgroundMediaId", "portraitMediaId"]);
/** Clé stable d'un lien du menu ou d'un réseau (voir site-schema : navKeyOf, socialKeyOf). */
const SiteKey = z.string().max(400);
const NavIndex = z.number().int().min(0).max(20);
const Coord = z.number().finite().min(-100000).max(100000);
const Index = z.number().int().min(0).max(60);
const Href = z.string().trim().min(1).max(300);
const SlotIndex = z.number().int().min(0).max(200);
const Board = z.number().int().positive();
/** Emplacement du projet (`s12`, `k…`) ou place d'un carrousel à liste propre (`<uid>.<rang>`, lot 31f). */
const SlotKey = z.string().regex(/^(s\d{1,9}|k[a-z0-9]{8,24}|[a-z0-9-]{1,32}\.\d{1,3})$/);
const Slug = z.string().regex(/^[a-z0-9-]{1,80}$/);
/** Type d'un composant de planche (lot 31). */
const BoardItemKind = z.enum(BOARD_ITEM_TYPES as [BoardItemType, ...BoardItemType[]]);
const Locale = z.enum(["fr", "en"]);
const Rev = z.number().int().min(0).max(1_000_000_000);
const UpTo = z.number().int().min(-1).max(1_000_000_000);
/** Où déposer un média ou des fichiers : dans une bande (position), sur une place vide, sur une planche neuve. */
const DropTarget = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("board"), board: Board, index: SlotIndex, collection: z.enum(["characters", "backgrounds", "animation"]).optional() }),
  z.object({ kind: z.literal("slot"), board: Board, key: SlotKey }),
  // Lot 31f : une position précise d'un carrousel à liste propre (même geste qu'une position de la bande du projet).
  z.object({ kind: z.literal("rail"), board: Board, uid: Uid, index: SlotIndex }),
  z.object({ kind: z.literal("new"), uid: Uid }),
  // v0.13 : image ou vidéo d'un bloc (image, vidéo, fond de l'ouverture, portrait), place libre d'une grille.
  z.object({ kind: z.literal("media"), uid: Uid, field: MediaField }),
  z.object({ kind: z.literal("cell"), uid: Uid }),
  // Lot 31b : un composant de la planche (Image : remplace ; Grille, carrousel : ajoute) — média de la médiathèque seulement.
  z.object({ kind: z.literal("bitem"), board: Board, uid: Uid }),
  // Lot 31d : une case précise d'une grille (page : `uid` = la grille ; planche : `board` + `uid` du composant). `index` au-delà de
  // la dernière image : la prochaine case libre (une grille se remplit dans l'ordre).
  z.object({ kind: z.literal("gcell"), uid: Uid, board: Board.optional(), props: z.string().max(100_000).optional(), index: z.number().int().min(0).max(MAX_GRID_CELLS) }),
  // Lot 42 : une planche libre (page : `uid` = la rubrique ; planche : `board` + `uid` du composant). (x, y) = le point visé, en % de la
  // zone : le centre de l'image posée.
  z.object({ kind: z.literal("free"), uid: Uid, board: Board.optional(), props: z.string().max(100_000).optional(), x: z.number().finite().min(-50).max(150), y: z.number().finite().min(-50).max(150) }),
]);
/** Case d'une grille (rang de l'image, de 0 à 23). */
const CellIndex = z.number().int().min(0).max(MAX_GRID_CELLS - 1);
const Step = z.number().int().min(-3).max(3);
/**
 * Opérations de la grille unifiée (lot 31d) : les mêmes pour une grille de page et une grille de planche (voir
 * `applyGridOp`, src/blocks/grid-layouts.ts). « pick » : choisir une image ou une vidéo pour une case (remplacer, ou
 * ajouter à la suite) dans la médiathèque ou sur l'ordinateur.
 */
export const GridCanvasOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("set"),
    layout: z.enum(GRID_LAYOUTS).optional(),
    gap: z.enum(["none", "tight", "normal", "wide"]).optional(),
    ratio: z.enum(RATIO_VALUES).optional(),
    align: z.enum(["start", "center", "end", "stretch"]).optional(),
    cols: z.number().int().min(2).max(4).optional(),
    mirror: z.boolean().optional(),
  }),
  z.object({ op: z.literal("remove"), index: CellIndex }),
  z.object({ op: z.literal("swap"), a: CellIndex, b: CellIndex }),
  z.object({ op: z.literal("move"), from: CellIndex, to: CellIndex }),
  // Lot 37b : rangées justifiées, une image seule sur sa ligne ou rangée avec les autres.
  z.object({ op: z.literal("alone"), index: CellIndex, alone: z.boolean() }),
  z.object({ op: z.literal("span"), index: CellIndex, dw: Step.optional(), dh: Step.optional() }),
  z.object({ op: z.literal("adapt"), ratios: z.array(z.number().finite().min(0.05).max(20)).max(MAX_GRID_CELLS).optional() }),
  z.object({ op: z.literal("pick"), index: z.number().int().min(0).max(MAX_GRID_CELLS), media: z.enum(["image", "video"]).optional() }),
  // Lot 36 : lecture de la vidéo de la case n° `index` (Boucle ou Lecteur).
  z.object({ op: z.literal("video-mode"), index: CellIndex, mode: z.enum(["loop", "player"]) }),
]);
export type GridCanvasOp = z.infer<typeof GridCanvasOpSchema>;
/** Identité d'une image de la planche libre (lot 42). */
const FreeId = z.string().regex(/^[a-z0-9]{1,12}$/);
/**
 * Opérations de la planche libre depuis la toile (lot 42), les mêmes pour une rubrique de page et un composant de planche (voir
 * `applyFreeOp`, src/blocks/free-board.ts). « pick » : choisir une image ou une vidéo (remplacer celle de `id`, ou en ajouter une).
 * Un geste (déplacer, redimensionner, pivoter) = UNE opération « place » = un pas d'historique.
 */
export const FreeCanvasOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set"), format: z.enum(FREE_FORMATS).optional(), aspect: z.number().finite().min(0.4).max(4).optional(), phone: z.enum(["scale", "stack"]).optional() }),
  z.object({ op: z.literal("pick"), id: FreeId.optional(), poster: z.boolean().optional() }),
  /** Recadrage du cadre (lot 113) : marges absolues en % du plan, ou `reset` (plan entier). */
  z.object({
    op: z.literal("crop"),
    t: z.number().finite().min(0).max(90).optional(),
    r: z.number().finite().min(0).max(90).optional(),
    b: z.number().finite().min(-150).max(90).optional(),
    l: z.number().finite().min(0).max(90).optional(),
    reset: z.boolean().optional(),
  }),
  /** Image d'attente d'une vidéo (lot 116) ; `media` null la retire. */
  z.object({ op: z.literal("poster"), id: FreeId, media: z.number().int().positive().nullable() }),
  z.object({
    op: z.literal("place"),
    id: FreeId,
    x: z.number().finite().min(-50).max(150).optional(),
    y: z.number().finite().min(-50).max(150).optional(),
    w: z.number().finite().min(1).max(150).optional(),
    rot: z.number().finite().min(-180).max(180).optional(),
  }),
  z.object({ op: z.literal("front"), id: FreeId }),
  z.object({ op: z.literal("back"), id: FreeId }),
  z.object({ op: z.literal("remove"), id: FreeId }),
]);
export type FreeCanvasOp = z.infer<typeof FreeCanvasOpSchema>;
/**
 * Où s'écrit l'habillage d'un média (lot 75, intention `media-look`) : une rubrique ou une case de grille de la page (`block`), un composant
 * de planche (`item`), la case d'une grille de planche (`cell` ; `props` = les réglages de la grille tels que la toile les a lus, repli),
 * une place de carrousel (`slot` : `slug` de la place, écrit dans la rubrique de la page `uid`) ou une image de la Planche libre (`free`).
 */
export const MediaTargetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("block"), uid: Uid }),
  z.object({ kind: z.literal("item"), board: Board, uid: Uid }),
  z.object({ kind: z.literal("cell"), board: Board, grid: Uid, uid: Uid, props: z.string().max(100_000).optional() }),
  z.object({ kind: z.literal("slot"), uid: Uid, slug: z.string().max(80).regex(/^[a-z0-9-]+$/) }),
  z.object({ kind: z.literal("free"), uid: Uid, board: Board.optional(), props: z.string().max(100_000).optional(), id: FreeId }),
]);
export type MediaTarget = z.infer<typeof MediaTargetSchema>;
const FileValue = z.custom<File>((v) => typeof File !== "undefined" && v instanceof File, "Fichier attendu");

/** Toile → éditeur. */
export const FromCanvasSchema = z.union([
  z.object({ kind: z.literal("ready"), path: z.string().max(400), locale: z.string().max(5), blocks: Blocks }),
  z.object({ kind: z.literal("blocks"), blocks: Blocks }),
  // `click` : choisi d'un clic (ou d'Entrée) sur la toile ; l'éditeur ouvre alors Réglages. Sans : sélection venue d'ailleurs (saisie, Échap).
  z.object({ kind: z.literal("select"), uid: Uid.nullable(), click: z.boolean().optional() }),
  z.object({ kind: z.literal("op"), op: z.enum(["up", "down", "duplicate", "delete", "out", "in"]), uid: Uid }),
  z.object({ kind: z.literal("move"), uid: Uid, index: Index, parent: Parent.optional() }),
  z.object({ kind: z.literal("text"), uid: Uid, path: z.string().regex(/^[a-zA-Z]+(\.(\d{1,2}|[a-zA-Z]+))*$/).max(80), locale: z.enum(["fr", "en"]), value: z.string().max(2000) }),
  z.object({ kind: z.literal("drag-index"), index: Index, parent: Parent.optional(), refused: z.boolean().optional() }),
  z.object({ kind: z.literal("key"), key: z.enum(["undo", "redo", "escape"]) }),
  // Planches (phase 7b).
  // Lot 111 : plus de nom à la création (slug aléatoire, titre par défaut, modifiable en place) ; `name` ne sert plus qu'aux anciens appels.
  z.object({ kind: z.literal("board-create"), uid: Uid, name: z.string().trim().max(120).optional() }),
  z.object({ kind: z.literal("board-pick"), uid: Uid, slug: Slug }),
  z.object({ kind: z.literal("slot-op"), board: Board, key: SlotKey, op: z.enum(["remove", "retire", "replace"]) }),
  z.object({ kind: z.literal("slot-move"), board: Board, key: SlotKey, index: SlotIndex }),
  z.object({ kind: z.literal("slot-text"), board: Board, key: SlotKey, field: z.enum(["title", "description"]), locale: Locale, value: z.string().max(2000) }),
  z.object({ kind: z.literal("project-text"), board: Board, field: z.enum(["title", "context", "description", "year"]), locale: Locale, value: z.string().max(2000) }),
  // Contenu de la planche (lot 31) : ajouter un composant à une position (menu « + Ajouter »), le monter, le descendre, le supprimer.
  z.object({ kind: z.literal("bitem-add"), board: Board, item: BoardItemKind, index: z.number().int().min(0).max(MAX_BOARD_ITEMS), source: z.literal("project").optional() }),
  // Lot 31b : composant de la palette glissé au-dessus d'une planche (position visée, ou null hors planche) ; réordonner par la poignée.
  // Lot 31c : texte d'un composant modifié en place (chemin du champ), mise en forme (« Aa ») d'un composant.
  z.object({ kind: z.literal("bitem-text"), board: Board, uid: Uid, path: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z0-9-]{1,80}){0,3}$/).max(120), locale: Locale, value: z.string().max(2000) }),
  z.object({ kind: z.literal("bitem-look"), board: Board, uid: Uid, look: LookSchema.nullable() }),
  // Lot 98 : style des légendes d'un PROJET (portée « Les légendes de ce projet » de la barre « Aa »), un style par champ ; null = aucun.
  z.object({ kind: z.literal("board-captions"), board: Board, style: z.strictObject({ title: TextStyleSchema.optional(), legend: TextStyleSchema.optional(), date: TextStyleSchema.optional() }).nullable() }),
  z.object({ kind: z.literal("bitem-drop"), board: Board.nullable(), index: z.number().int().min(0).max(MAX_BOARD_ITEMS) }),
  z.object({ kind: z.literal("bitem-to"), board: Board, uid: Uid, index: z.number().int().min(0).max(MAX_BOARD_ITEMS) }),
  z.object({ kind: z.literal("bitem-op"), board: Board, uid: Uid, op: z.enum(["up", "down", "remove"]) }),
  // Lot 111 : contenu propre à la page. « own » : copier le contenu que la page voit dans le bloc (« Garder ce contenu pour cette page seulement » / « Contenu propre à cette page ») ;
  // « shared » : demander à revenir au contenu partagé du projet (l'éditeur confirme dans la page avant d'écrire).
  // Lot 32 : fond de couleur d'un composant de la planche (null = aucun fond) ; `continuous` : roue de couleur en cours de glissé.
  z.object({ kind: z.literal("bitem-fond"), board: Board, uid: Uid, background: BackgroundSchema.nullable(), continuous: z.boolean().optional() }),
  // Un composant de la planche choisi sur la toile : l'éditeur montre ses réglages (props = JSON des réglages tels que la toile les a lus).
  z.object({ kind: z.literal("bitem-select"), board: Board, uid: Uid, item: BoardItemKind, props: z.string().max(100_000) }),
  z.object({ kind: z.literal("drop-target"), target: DropTarget.nullable() }),
  z.object({ kind: z.literal("files"), target: DropTarget, files: z.array(FileValue).min(1).max(30) }),
  z.object({ kind: z.literal("ghost-op"), id: z.string().max(40), op: z.enum(["retry", "remove"]) }),
  // v0.13 : médias des blocs, grilles, en-tête / pied / réseaux (communs au site).
  z.object({ kind: z.literal("media-op"), uid: Uid, field: MediaField, op: z.enum(["replace", "clear"]) }),
  z.object({ kind: z.literal("layout"), uid: Uid, layout: z.enum(GRID_LAYOUTS) }),
  // Lot 31d : grille unifiée (page ou planche). `board` : composant de planche (`props` = ses réglages tels que la toile les a lus,
  // repli si l'éditeur n'a pas encore l'état de la planche) ; absent : la grille est une rubrique de la page.
  z.object({ kind: z.literal("grid-op"), uid: Uid, board: Board.optional(), props: z.string().max(100_000).optional(), op: GridCanvasOpSchema }),
  // Lot 42 : planche libre (page ou planche). `board` : composant de planche (`props` = ses réglages tels que la toile les a lus, repli).
  z.object({ kind: z.literal("free-op"), uid: Uid, board: Board.optional(), props: z.string().max(100_000).optional(), op: FreeCanvasOpSchema }),
  // Lot 36 : lecture d'une vidéo (Boucle / Lecteur) depuis sa barre sur la toile : composant Vidéo d'une page (`uid`), composant
  // Vidéo ou bande de la planche (`board` + `uid` ; `props` = ses réglages lus par la toile, repli). `mode` null : la bande suit
  // la nature de chaque vidéo (réglage d'avant).
  z.object({ kind: z.literal("video-mode"), uid: Uid, board: Board.optional(), item: BoardItemKind.optional(), props: z.string().max(100_000).optional(), mode: z.enum(["loop", "player"]).nullable() }),
  // Lot 31d : mise en forme (cadre, recadrage) de la case d'une grille de PLANCHE (la case n'est pas un bloc de la page).
  z.object({ kind: z.literal("cell-look"), board: Board, grid: Uid, props: z.string().max(100_000).optional(), uid: Uid, look: LookSchema.nullable() }),
  // Lot 75 (R4) : UNE écriture pour l'habillage d'un média (cadre, fond d'image, arrondi, panorama, lecture), tous conteneurs.
  z.object({ kind: z.literal("media-look"), target: MediaTargetSchema, patch: MediaPatchSchema }),
  // Entrées des collections (lot 22) : entrées choisies à la main (ajouter une page de collection, retirer, ordre).
  z.object({ kind: z.literal("tile-op"), uid: Uid, op: z.enum(["add", "remove", "up", "down", "cover", "cover-clear", "mode-manual", "mode-auto"]), index: z.number().int().min(0).max(23).optional(), pageId: z.number().int().positive().optional() }),
  // Entrées des collections (lot 22) : taille des images, depuis la barre du bloc.
  z.object({ kind: z.literal("tile-size"), uid: Uid, size: z.enum(["small", "medium", "large"]) }),
  // Formulaire de contact : champs retirés, déplacés, ajoutés sur la toile.
  z.object({
    kind: z.literal("form-field"),
    uid: Uid,
    op: z.enum(["remove", "move", "add", "help-add", "help-remove"]),
    index: z.number().int().min(0).max(11).optional(),
    to: z.number().int().min(0).max(11).optional(),
    fieldType: z.enum(["text", "email", "textarea", "select"]).optional(),
    /** Identifiant du champ ajouté, choisi par la toile (son aperçu et le champ réel se reconnaissent). */
    id: z.string().regex(/^f[a-z0-9]{6,12}$/).optional(),
  }),
  z.object({
    kind: z.literal("site-text"),
    field: z.enum(["name", "role", "email", "credit", "nav"]),
    index: NavIndex.optional(),
    /** Clé stable du lien (data-nav-key) : prime sur le rang (qui compte les aperçus en attente de la toile). */
    key: SiteKey.optional(),
    locale: Locale,
    value: z.string().max(200),
  }),
  z.object({ kind: z.literal("site-op"), op: z.literal("nav-remove"), index: NavIndex, key: SiteKey.optional() }),
  z.object({ kind: z.literal("site-op"), op: z.literal("nav-move"), index: NavIndex, key: SiteKey.optional(), to: NavIndex }),
  z.object({ kind: z.literal("site-op"), op: z.literal("nav-add-page"), pageId: z.number().int().positive() }),
  z.object({ kind: z.literal("site-op"), op: z.literal("nav-add-link"), href: Href, label: z.string().trim().min(1).max(60) }),
  z.object({ kind: z.literal("site-op"), op: z.literal("social-remove"), index: NavIndex, key: SiteKey.optional() }),
  z.object({ kind: z.literal("site-op"), op: z.literal("social-move"), index: NavIndex, key: SiteKey.optional(), to: NavIndex }),
  z.object({ kind: z.literal("site-op"), op: z.literal("social-edit"), index: NavIndex, key: SiteKey.optional(), href: Href }),
  z.object({ kind: z.literal("site-op"), op: z.literal("social-add"), href: Href, label: z.string().trim().min(1).max(40), network: z.string().max(20) }),
  // Mise en page (lot 2) : réglages d'un bloc (null = tout revient au thème),
  // style global d'un rôle de texte (null = réinitialiser).
  z.object({ kind: z.literal("look"), uid: Uid, look: LookSchema.nullable() }),
  z.object({ kind: z.literal("site-style"), role: z.enum(ROLES), style: TextStyleSchema.nullable() }),
  // Carte de rubrique (lot 17c) : fond d'un bloc de premier niveau (null = pas de carte).
  // `continuous` : glissement de la roue ou d'un curseur (fusionné dans l'historique pendant 1,2 s) ; un clic est un pas à lui seul.
  z.object({ kind: z.literal("surface"), uid: Uid, surface: SurfaceSchema.nullable(), continuous: z.boolean().optional() }),
  // Fond de couleur d'un composant (lot 32) : `background` de n'importe quel grand composant, de la page ou d'un conteneur (null = aucun fond).
  z.object({ kind: z.literal("background"), uid: Uid, background: BackgroundSchema.nullable(), continuous: z.boolean().optional() }),
  // Fond unique (lot 66, « Surface » commune) : les deux couches d'un bloc (carte `surface`, fond `background`) écrites d'un seul pas d'historique.
  // null = couche retirée ; un bloc qui ne sait pas porter une couche (carte : premier niveau seulement ; fond : grands composants) refuse tout.
  z.object({ kind: z.literal("fond"), uid: Uid, surface: SurfaceSchema.nullable(), background: BackgroundSchema.nullable(), continuous: z.boolean().optional() }),
  // Lot 66 (R5) : « Régler » le papier peint de la page, depuis le menu Fond de la toile : ouvre les Réglages de la page (aucun bloc choisi).
  z.object({ kind: z.literal("page-settings"), focus: z.enum(["wallpaper"]).optional() }),
  // Ajout d'une rubrique depuis la toile (lot 17c) : `choose` ouvre le choix illustré de l'éditeur, les
  // autres ajoutent aussitôt un texte (bloc `rich-text` avec son texte d'aide) à cet endroit.
  z.object({ kind: z.literal("insert"), parent: Parent, index: Index, what: z.enum(["choose", "text", "title", "title-text", "free"]) }),
  // Case vide de grille, « Image » / « Vidéo » (lot 25) : l'éditeur ouvre le choix du média, posé dans une nouvelle case de la grille `uid`.
  z.object({ kind: z.literal("cell-media"), uid: Uid, media: z.enum(["image", "video"]) }),
  // Champ facultatif d'un bloc Texte, ajouté ou retiré depuis la toile (lot 19a) : « + Ajouter un titre » / « Retirer le titre » (Texte), « + Ajouter une étiquette » / « Retirer l'étiquette » (Titre).
  // Lot 27 : même geste pour Grille, Contact, Profil et CV (src/blocks/optional-fields.ts).
  z.object({ kind: z.literal("field-op"), uid: Uid, op: z.enum(FIELD_OPS) }),
  // Palette et logo du site (lot 17f) : état COMPLET voulu (palette = bases choisies, logo = taille et comportement).
  z.object({ kind: z.literal("site-look"), palette: SitePaletteSchema, logo: LogoSchema }),
  // Ce que la toile a trouvé pour le rôle de couleur survolé (légende « utilisé par »).
  z.object({ kind: z.literal("highlight-info"), role: z.enum(BASE_KEYS).nullable(), count: z.number().int().min(0).max(100000), uses: z.array(z.string().max(40)).max(12) }),
  // Lot 77 (MENU-11) : une fenêtre modale s'ouvre / se ferme dans la toile (« Cadrer l'image ») ; l'éditeur voile son panneau et sa barre.
  z.object({ kind: z.literal("modal"), open: z.boolean() }),
]);

/** Éditeur → toile. */
export const ToCanvasSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("mode"), mode: z.enum(["edit", "preview"]) }),
  /** Lot 31c : ajouter un composant à la planche de cette rubrique (clic sur une carte de la palette) ; la toile connaît l'identifiant du projet. */
  z.object({ kind: z.literal("board-add"), uid: Uid, item: BoardItemKind }),
  z.object({ kind: z.literal("select"), uid: Uid.nullable(), scroll: z.boolean().optional() }),
  /**
   * Rafraîchir la toile. `rev` : révision du brouillon écrite par l'éditeur ;
   * `upTo` : dernier numéro d'intention (`seq`) dont rien n'est plus attendu
   * (tout enregistré, aucune écriture en vol), -1 sinon. Voir optimistic.ts.
   */
  z.object({ kind: z.literal("refresh"), rev: Rev.optional(), upTo: UpTo.optional() }),
  /** Rien à rafraîchir, mais tout jusqu'à `upTo` est acquitté à la révision `rev`. */
  z.object({ kind: z.literal("settle"), rev: Rev, upTo: UpTo }),
  /** L'écriture de l'intention `seq` a été refusée ou a échoué : retirer son aperçu et rétablir la valeur d'origine. */
  z.object({ kind: z.literal("revert"), seq: z.number().int().min(1).max(999_999_999) }),
  /**
   * Annuler / Rétablir en cours : la toile ne peut pas deviner le résultat, elle montre un état
   * « en cours » (libellé) jusqu'au prochain acquittement ; null le retire.
   */
  z.object({ kind: z.literal("pending"), label: z.string().max(60).nullable() }),
  z.object({
    kind: z.literal("drag"),
    x: Coord,
    y: Coord,
    label: z.string().max(120),
    payload: z.enum(["block", "media"]).optional(),
    /**
     * Bloc glissé (palette) : type et conteneurs qu'il apporte, pour savoir où
     * il peut aller. (`blockType`, pas `type` : `type` est l'enveloppe du message.)
     */
    blockType: z.string().max(60).optional(),
    nesting: z.number().int().min(0).max(2).optional(),
  }),
  z.object({ kind: z.literal("drag-end") }),
  z.object({
    kind: z.literal("projects"),
    list: z.array(z.object({ slug: Slug, title: z.string().max(200), onPage: z.boolean().optional(), draft: z.boolean().optional() })).max(500),
  }),
  z.object({ kind: z.literal("pages"), list: z.array(z.object({ id: z.number().int().positive(), title: z.string().max(200) })).max(200) }),
  /** Formulaire de contact : montrer le formulaire, ou son message de confirmation / d'erreur. */
  z.object({ kind: z.literal("form-preview"), uid: Uid, pane: z.enum(["form", "success", "error"]) }),
  /** En-tête du site tenu par une autre page (son nom), ou null. */
  z.object({
    kind: z.literal("ghosts"),
    items: z
      .array(
        z.object({
          id: z.string().max(40),
          board: Board,
          /** Position dans la bande (avant le n-ième emplacement), ou place remplie. */
          index: SlotIndex.optional(),
          slot: SlotKey.optional(),
          /** Carrousel à liste propre qui reçoit le fichier (absent : la bande des images du projet). */
          rail: Uid.optional(),
          label: z.string().max(200),
          preview: z.string().regex(/^blob:/).max(200).optional(),
          aspect: z.number().min(0.1).max(10),
          progress: z.number().min(0).max(1).nullable(),
          phase: z.enum(["upload", "convert", "failed", "done"]),
          message: z.string().max(300).optional(),
          /** Emplacement créé : le fantôme s'efface dès qu'il est rendu. */
          key: SlotKey.optional(),
        }),
      )
      .max(60),
  }),
  z.object({ kind: z.literal("focus-slot"), key: SlotKey }),
  /** Ouvrir l'édition en place d'un texte du bloc (rubrique Texte tout juste ajoutée), son texte d'aide sélectionné. */
  z.object({ kind: z.literal("edit-text"), uid: Uid, path: z.string().regex(/^[a-zA-Z]+(\.(\d{1,2}|[a-zA-Z]+))*$/).max(80) }),
  /**
   * Palette et logo du site posés depuis le panneau (lot 17f) : la toile les montre aussitôt (aperçu
   * gardé jusqu'à l'acquittement, optimistic.ts) et renvoie l'intention `site-look` (numéro `seq`),
   * que l'éditeur enregistre comme toute intention de la toile.
   */
  z.object({ kind: z.literal("site-look"), palette: SitePaletteSchema, logo: LogoSchema }),
  /** Surligner les éléments qui utilisent ce rôle de couleur (null : retirer). */
  z.object({ kind: z.literal("highlight"), role: z.enum(BASE_KEYS).nullable() }),
  /** Polices Google déjà téléchargées par le serveur (menu des polices, lot 2). */
  z.object({ kind: z.literal("fonts"), installed: z.array(z.string().max(60)).max(20), busy: z.string().max(60).nullable().optional() }),
]);

export type BlockInfo = z.infer<typeof Block>;
export type DropTargetInfo = z.infer<typeof DropTarget>;
export type Ghost = Extract<z.infer<typeof ToCanvasSchema>, { kind: "ghosts" }>["items"][number];
export type FromCanvas = z.infer<typeof FromCanvasSchema>;
export type ToCanvas = z.infer<typeof ToCanvasSchema>;

type MessageLike = { origin: string; source: unknown; data: unknown };

/**
 * Message reçu, s'il vient de la bonne fenêtre, de la même origine, et qu'il
 * respecte le schéma ; sinon null.
 */
function accept<S extends z.ZodType>(schema: S, event: MessageLike, origin: string, source: unknown): z.infer<S> | null {
  if (event.origin !== origin || !source || event.source !== source) return null;
  const data = event.data as { type?: unknown } | null;
  if (!data || typeof data !== "object" || data.type !== EDIT_MSG) return null;
  const parsed = schema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/**
 * Message de la toile validé, avec son numéro d'intention (`seq`, hors schéma :
 * il ne fait que dater le message pour l'état optimiste, voir optimistic.ts).
 */
export function acceptFromCanvas(event: MessageLike, origin: string, frame: unknown): (FromCanvas & { seq?: number }) | null {
  const msg = accept(FromCanvasSchema, event, origin, frame);
  if (!msg) return null;
  const seq = (event.data as { seq?: unknown }).seq;
  return typeof seq === "number" && Number.isInteger(seq) && seq > 0 && seq < 1_000_000_000 ? { ...msg, seq } : msg;
}
export const acceptToCanvas = (event: MessageLike, origin: string, parent: unknown) => accept(ToCanvasSchema, event, origin, parent);

/** Index d'insertion : nombre de blocs dont le milieu est au-dessus de y. */
export function insertionIndex(mids: number[], y: number): number {
  let i = 0;
  while (i < mids.length && mids[i] < y) i++;
  return i;
}

/** Déplace l'élément `from` pour qu'il s'insère à l'index `to` (compté dans la liste d'origine). */
export function moveTo<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return list;
  const target = to > from ? to - 1 : to;
  if (target === from) return list;
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, target)), 0, item);
  return next;
}

/** Le chemin `path` (« title », « paragraphs.2 ») correspond-il à un motif déclaré (« paragraphs.* ») ? */
export function inlineAllowed(patterns: string[], path: string): boolean {
  const parts = path.split(".");
  return patterns.some((p) => {
    const q = p.split(".");
    return q.length === parts.length && q.every((s, i) => (s === "*" ? /^\d{1,2}$/.test(parts[i]) : s === parts[i]));
  });
}

const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Copie de `obj` où la valeur localisée au chemin reçoit `value` pour la langue. */
export function setLocalizedAt(obj: Record<string, unknown>, path: string, locale: "fr" | "en", value: string): Record<string, unknown> {
  const parts = path.split(".");
  const root: Record<string, unknown> = JSON.parse(JSON.stringify(obj));
  if (parts.some((p) => UNSAFE_KEYS.has(p))) return root;
  let cur: Record<string, unknown> | unknown[] = root;
  for (let i = 0; i < parts.length; i++) {
    const key = /^\d+$/.test(parts[i]) ? Number(parts[i]) : parts[i];
    const container = cur as Record<string | number, unknown>;
    if (i === parts.length - 1) {
      const prev = container[key];
      const base = prev && typeof prev === "object" ? (prev as Record<string, unknown>) : { fr: "", en: "" };
      container[key] = { fr: "", en: "", ...base, [locale]: value };
    } else {
      if (!container[key] || typeof container[key] !== "object") return root;
      cur = container[key] as Record<string, unknown>;
    }
  }
  return root;
}
