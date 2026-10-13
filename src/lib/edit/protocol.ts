/**
 * Messages entre l'éditeur visuel (/admin/pages/<id>/editer) et sa toile
 * (iframe de la même origine, vue brouillon). Chaque côté vérifie l'origine
 * (la sienne) et la source (la fenêtre parente, ou l'iframe), puis valide le
 * message par un schéma discriminé par `kind` : un message étranger ou
 * malformé est ignoré, sans exception.
 */
import { z } from "zod";

import { SurfaceSchema } from "../../themes/surface";
import { LookSchema, ROLES, TextStyleSchema } from "../look";

export const EDIT_MSG = "portfolio:edit";

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
const SlotKey = z.string().regex(/^(s\d{1,9}|k[a-z0-9]{8,24})$/);
const Slug = z.string().regex(/^[a-z0-9-]{1,80}$/);
const Locale = z.enum(["fr", "en"]);
const Rev = z.number().int().min(0).max(1_000_000_000);
const UpTo = z.number().int().min(-1).max(1_000_000_000);
/** Où déposer un média ou des fichiers : dans une bande (position), sur une place vide, sur une planche neuve. */
const DropTarget = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("board"), board: Board, index: SlotIndex, collection: z.enum(["characters", "backgrounds", "animation"]).optional() }),
  z.object({ kind: z.literal("slot"), board: Board, key: SlotKey }),
  z.object({ kind: z.literal("new"), uid: Uid }),
  // v0.13 : image ou vidéo d'un bloc (image, vidéo, fond de l'ouverture, portrait), place libre d'une grille.
  z.object({ kind: z.literal("media"), uid: Uid, field: MediaField }),
  z.object({ kind: z.literal("cell"), uid: Uid }),
]);
const FileValue = z.custom<File>((v) => typeof File !== "undefined" && v instanceof File, "Fichier attendu");

/** Toile → éditeur. */
export const FromCanvasSchema = z.union([
  z.object({ kind: z.literal("ready"), path: z.string().max(400), locale: z.string().max(5), blocks: Blocks }),
  z.object({ kind: z.literal("blocks"), blocks: Blocks }),
  z.object({ kind: z.literal("select"), uid: Uid.nullable() }),
  z.object({ kind: z.literal("op"), op: z.enum(["up", "down", "duplicate", "delete", "out", "in"]), uid: Uid }),
  z.object({ kind: z.literal("move"), uid: Uid, index: Index, parent: Parent.optional() }),
  z.object({ kind: z.literal("text"), uid: Uid, path: z.string().regex(/^[a-zA-Z]+(\.(\d{1,2}|[a-zA-Z]+))*$/).max(80), locale: z.enum(["fr", "en"]), value: z.string().max(2000) }),
  z.object({ kind: z.literal("drag-index"), index: Index, parent: Parent.optional(), refused: z.boolean().optional() }),
  z.object({ kind: z.literal("key"), key: z.enum(["undo", "redo", "escape"]) }),
  // Planches (phase 7b).
  z.object({ kind: z.literal("board-create"), uid: Uid, name: z.string().trim().min(1).max(120) }),
  z.object({ kind: z.literal("board-pick"), uid: Uid, slug: Slug }),
  z.object({ kind: z.literal("slot-op"), board: Board, key: SlotKey, op: z.enum(["remove", "retire", "replace"]) }),
  z.object({ kind: z.literal("slot-move"), board: Board, key: SlotKey, index: SlotIndex }),
  z.object({ kind: z.literal("slot-text"), board: Board, key: SlotKey, field: z.enum(["title", "description"]), locale: Locale, value: z.string().max(2000) }),
  z.object({ kind: z.literal("project-text"), board: Board, field: z.enum(["title", "context", "description", "year"]), locale: Locale, value: z.string().max(2000) }),
  z.object({ kind: z.literal("drop-target"), target: DropTarget.nullable() }),
  z.object({ kind: z.literal("files"), target: DropTarget, files: z.array(FileValue).min(1).max(30) }),
  z.object({ kind: z.literal("ghost-op"), id: z.string().max(40), op: z.enum(["retry", "remove"]) }),
  // v0.13 : médias des blocs, grilles, en-tête / pied / réseaux (communs au site).
  z.object({ kind: z.literal("media-op"), uid: Uid, field: MediaField, op: z.enum(["replace", "clear"]) }),
  z.object({ kind: z.literal("layout"), uid: Uid, layout: z.enum(["1", "1+2", "2", "3", "2x2", "4", "2+1"]) }),
  // Formulaire de contact : champs retirés, déplacés, ajoutés sur la toile.
  z.object({
    kind: z.literal("form-field"),
    uid: Uid,
    op: z.enum(["remove", "move", "add"]),
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
  z.object({ kind: z.literal("surface"), uid: Uid, surface: SurfaceSchema.nullable() }),
  // Ajout d'une rubrique depuis la toile (lot 17c) : `choose` ouvre le choix illustré de l'éditeur, les
  // autres ajoutent aussitôt un texte (bloc `rich-text` avec son texte d'aide) à cet endroit.
  z.object({ kind: z.literal("insert"), parent: Parent, index: Index, what: z.enum(["choose", "text", "title-text"]) }),
]);

/** Éditeur → toile. */
export const ToCanvasSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("mode"), mode: z.enum(["edit", "preview"]) }),
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
  z.object({ kind: z.literal("site-lock"), page: z.string().max(200).nullable() }),
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
