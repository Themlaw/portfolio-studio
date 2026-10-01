/**
 * Messages entre l'éditeur visuel (/admin/pages/<id>/editer) et sa toile
 * (iframe de la même origine, vue brouillon). Chaque côté vérifie l'origine
 * (la sienne) et la source (la fenêtre parente, ou l'iframe), puis valide le
 * message par un schéma discriminé par `kind` : un message étranger ou
 * malformé est ignoré, sans exception.
 */
import { z } from "zod";

export const EDIT_MSG = "portfolio:edit";

const Uid = z.string().regex(/^[a-z0-9-]{1,32}$/);
const Block = z.object({ uid: Uid, type: z.string().max(60), label: z.string().max(120) });
const Blocks = z.array(Block).max(60);
const Coord = z.number().finite().min(-100000).max(100000);
const Index = z.number().int().min(0).max(60);
const SlotIndex = z.number().int().min(0).max(200);
const Board = z.number().int().positive();
const SlotKey = z.string().regex(/^(s\d{1,9}|k[a-z0-9]{8,24})$/);
const Slug = z.string().regex(/^[a-z0-9-]{1,80}$/);
const Locale = z.enum(["fr", "en"]);
/** Où déposer un média ou des fichiers : dans une bande (position), sur une place vide, sur une planche neuve. */
const DropTarget = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("board"), board: Board, index: SlotIndex }),
  z.object({ kind: z.literal("slot"), board: Board, key: SlotKey }),
  z.object({ kind: z.literal("new"), uid: Uid }),
]);
const FileValue = z.custom<File>((v) => typeof File !== "undefined" && v instanceof File, "Fichier attendu");

/** Toile → éditeur. */
export const FromCanvasSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready"), path: z.string().max(400), locale: z.string().max(5), blocks: Blocks }),
  z.object({ kind: z.literal("blocks"), blocks: Blocks }),
  z.object({ kind: z.literal("select"), uid: Uid.nullable() }),
  z.object({ kind: z.literal("op"), op: z.enum(["up", "down", "duplicate", "delete"]), uid: Uid }),
  z.object({ kind: z.literal("move"), uid: Uid, index: Index }),
  z.object({ kind: z.literal("text"), uid: Uid, path: z.string().regex(/^[a-zA-Z]+(\.(\d{1,2}|[a-zA-Z]+))*$/).max(80), locale: z.enum(["fr", "en"]), value: z.string().max(2000) }),
  z.object({ kind: z.literal("drag-index"), index: Index }),
  z.object({ kind: z.literal("key"), key: z.enum(["undo", "redo", "escape"]) }),
  // Planches (phase 7b).
  z.object({ kind: z.literal("board-create"), uid: Uid, name: z.string().trim().min(1).max(120) }),
  z.object({ kind: z.literal("board-pick"), uid: Uid, slug: Slug }),
  z.object({ kind: z.literal("slot-op"), board: Board, key: SlotKey, op: z.enum(["remove", "retire", "replace"]) }),
  z.object({ kind: z.literal("slot-move"), board: Board, key: SlotKey, index: SlotIndex }),
  z.object({ kind: z.literal("slot-text"), board: Board, key: SlotKey, field: z.enum(["title", "description"]), locale: Locale, value: z.string().max(2000) }),
  z.object({ kind: z.literal("project-text"), board: Board, field: z.enum(["title", "context", "year"]), locale: Locale, value: z.string().max(200) }),
  z.object({ kind: z.literal("drop-target"), target: DropTarget.nullable() }),
  z.object({ kind: z.literal("files"), target: DropTarget, files: z.array(FileValue).min(1).max(30) }),
  z.object({ kind: z.literal("ghost-op"), id: z.string().max(40), op: z.enum(["retry", "remove"]) }),
]);

/** Éditeur → toile. */
export const ToCanvasSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("mode"), mode: z.enum(["edit", "preview"]) }),
  z.object({ kind: z.literal("select"), uid: Uid.nullable(), scroll: z.boolean().optional() }),
  z.object({ kind: z.literal("refresh") }),
  z.object({ kind: z.literal("drag"), x: Coord, y: Coord, label: z.string().max(120), payload: z.enum(["block", "media"]).optional() }),
  z.object({ kind: z.literal("drag-end") }),
  z.object({ kind: z.literal("projects"), list: z.array(z.object({ slug: Slug, title: z.string().max(200) })).max(500) }),
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

export const acceptFromCanvas = (event: MessageLike, origin: string, frame: unknown) => accept(FromCanvasSchema, event, origin, frame);
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
