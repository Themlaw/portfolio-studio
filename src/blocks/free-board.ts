/**
 * Planche libre (lot 42) : une zone dans laquelle des images (ou des vidéos) sont posées avec une position, une taille et une
 * rotation LIBRES. Module pur (zod, look) : lu par le registre, le rendu serveur, la toile (calque d'édition), l'éditeur et les
 * tests Node.
 *
 * Géométrie : `x`, `y` (coin haut gauche, avant rotation) et `w` (largeur) sont des pourcentages de la zone ; la hauteur d'une
 * image découle de son format : `h = w × format de la zone ÷ format du média` (en % de la hauteur de la zone). La composition
 * est donc la même à toutes les largeurs d'écran (elle se met à l'échelle). `z` = rang d'empilement, `rot` = degrés (−180 à 180).
 */
import { z } from "zod";

import { applyMediaPatchToFree, type MediaPatch } from "../lib/edit/media-look";
import { FrameSchema, ImageBgSchema, RADII, SLOT_VIDEO_MODES } from "../lib/look";

import { localizedText } from "./types";

/** Formats de la zone ; « free » = hauteur libre (poignée du bas), mémorisée dans `aspect`. */
export const FREE_FORMATS = ["16:9", "3:2", "4:3", "1:1", "free"] as const;
export type FreeFormat = (typeof FREE_FORMATS)[number];
export const FREE_FORMAT_LABELS: Record<FreeFormat, string> = { "16:9": "16:9", "3:2": "3:2", "4:3": "4:3", "1:1": "Carré", free: "Hauteur libre" };
/** Largeur ÷ hauteur de chaque format fixe. */
export const FREE_RATIOS: Record<Exclude<FreeFormat, "free">, number> = { "16:9": 16 / 9, "3:2": 3 / 2, "4:3": 4 / 3, "1:1": 1 };
/** Bornes du format libre (largeur ÷ hauteur). */
export const FREE_ASPECT_MIN = 0.4;
export const FREE_ASPECT_MAX = 4;
export const MAX_FREE_ITEMS = 40;
/** Largeur d'une image neuve (% de la zone). */
export const FREE_DEFAULT_W = 30;
export const FREE_MIN_W = 4;
export const FREE_MAX_W = 150;
export const FREE_PHONE_MODES = ["scale", "stack"] as const;
export const FREE_PHONE_LABELS: Record<(typeof FREE_PHONE_MODES)[number], string> = { scale: "À l'échelle", stack: "Empilées" };

export const FreeItemSchema = z.object({
  /** Identité stable de l'image (elle suit l'image quand on la remplace ou qu'on change l'ordre). */
  id: z.string().regex(/^[a-z0-9]{1,12}$/),
  media: z.number().int().positive(),
  x: z.number().min(-50).max(150),
  y: z.number().min(-50).max(150),
  w: z.number().min(FREE_MIN_W).max(FREE_MAX_W),
  rot: z.number().int().min(-180).max(180).default(0),
  z: z.number().int().min(0).max(999).default(0),
  /** Arrondi propre à cette image (rien = coins droits, comme un PNG détouré). */
  radius: z.enum(RADII).optional(),
  /** Cadre propre à cette image (lot 34). */
  frame: FrameSchema.optional(),
  /** Fond derrière cette image (lot 41 : utile derrière un PNG détouré) : `card`, teinte de la palette ou couleur libre. */
  bg: ImageBgSchema.optional(),
  /** Lecture d'une VIDÉO (lot 116) : « loop » = Boucle (muette, un clic lance / met en pause), « player » = Lecteur (image d'attente + ▶, s'ouvre en grand). Absent = Boucle (le comportement d'avant : aucune ancienne planche ne change). */
  video: z.enum(SLOT_VIDEO_MODES).optional(),
  /** Image d'attente choisie pour une vidéo (identifiant de la médiathèque) ; absent = celle de la vidéo. */
  poster: z.number().int().positive().optional(),
});
export type FreeItem = z.infer<typeof FreeItemSchema>;

export const freeBoardSchema = z.object({
  format: z.enum(FREE_FORMATS).default("3:2"),
  /** Largeur ÷ hauteur de la zone en « Hauteur libre ». */
  aspect: z.number().min(FREE_ASPECT_MIN).max(FREE_ASPECT_MAX).optional(),
  /** Sous 640 px : la composition reste à l'échelle, ou les images s'empilent dans l'ordre de lecture. */
  phone: z.enum(FREE_PHONE_MODES).default("scale"),
  items: z.array(FreeItemSchema).max(MAX_FREE_ITEMS).default([]),
  /** Cliquer pour agrandir (lot 44) : absent = oui, `false` la coupe. */
  zoom: z.boolean().optional(),
  /** Titre / Légende / Date sous la planche (lot 39). */
  captionTitle: localizedText.optional(),
  caption: localizedText.optional(),
  captionDate: localizedText.optional(),
});
export type FreeBoardProps = z.infer<typeof freeBoardSchema>;

type Props = Record<string, unknown>;
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Largeur ÷ hauteur de la zone. */
export function zoneAspect(props: { format?: unknown; aspect?: unknown }): number {
  const f = props.format as FreeFormat | undefined;
  if (f && f !== "free" && Object.hasOwn(FREE_RATIOS, f)) return FREE_RATIOS[f];
  return typeof props.aspect === "number" && Number.isFinite(props.aspect) ? clamp(props.aspect, FREE_ASPECT_MIN, FREE_ASPECT_MAX) : FREE_RATIOS["3:2"];
}

/** Hauteur d'une image en % de la hauteur de la zone. */
export const itemHeight = (w: number, zone: number, mediaRatio: number): number => (w * zone) / Math.max(0.05, mediaRatio);

/** Ordre de lecture (haut → bas, puis gauche → droite) : l'ordre du DOM public. Copie triée. */
export function readingOrder<T extends { id: string; x: number; y: number }>(items: T[]): T[] {
  return items.slice().sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1));
}

/** Les items d'une suite de réglages, tels que le schéma les lit (illisibles : ignorés). */
export function freeItems(props: Props): FreeItem[] {
  const raw = Array.isArray(props.items) ? props.items : [];
  const out: FreeItem[] = [];
  for (const r of raw) {
    const p = FreeItemSchema.safeParse(r);
    if (p.success) out.push(p.data);
  }
  return out;
}

/** Rangs d'empilement recompactés (0, 1, 2…) dans l'ordre actuel : les opérations ne les laissent jamais grandir sans fin. */
function compactZ(items: FreeItem[]): FreeItem[] {
  const order = items.map((it, i) => ({ i, z: it.z })).sort((a, b) => a.z - b.z || a.i - b.i);
  const rank = new Map(order.map((o, k) => [o.i, k]));
  return items.map((it, i) => ({ ...it, z: rank.get(i)! }));
}

/** Opérations sur les réglages (le modèle partagé par la toile, le panneau et les tests). */
export type FreeModelOp =
  | { op: "set"; format?: FreeFormat; aspect?: number; phone?: "scale" | "stack" }
  /** Pose une image neuve : (x, y) = son CENTRE en % de la zone ; `ratio` = largeur ÷ hauteur du média. */
  | { op: "put"; id: string; media: number; x: number; y: number; ratio: number; w?: number }
  /** Déplace, redimensionne ou fait pivoter UNE image (un geste = une opération). */
  | { op: "place"; id: string; x?: number; y?: number; w?: number; rot?: number }
  | { op: "front"; id: string }
  | { op: "back"; id: string }
  | { op: "remove"; id: string }
  | { op: "replace"; id: string; media: number }
  /** Image d'attente d'une vidéo (lot 116) ; `null` la retire (retour à celle de la vidéo). */
  | { op: "poster"; id: string; media: number | null };

const GONE = "Cette image n'est plus dans la planche libre.";

/**
 * Applique une opération : les nouveaux réglages, ou un message d'erreur en français. `props` n'est jamais modifié.
 * Les valeurs sont arrondies (position et taille à 0,01 %, rotation au degré) et bornées.
 */
export function applyFreeOp(props: Props, op: FreeModelOp): { props: Props } | { error: string } {
  const items = freeItems(props);
  const zone = zoneAspect(props);
  const done = (next: FreeItem[]): { props: Props } => ({ props: { ...props, items: next } });
  const at = (id: string) => items.findIndex((i) => i.id === id);
  switch (op.op) {
    case "set": {
      const next: Props = { ...props };
      if (op.format) {
        next.format = op.format;
        // Un format fixe fait oublier la hauteur libre ; « Hauteur libre » garde le format actuel comme point de départ.
        if (op.format !== "free") delete next.aspect;
        else if (op.aspect === undefined && next.aspect === undefined) next.aspect = round(zone);
      }
      if (op.aspect !== undefined) {
        next.format = "free";
        next.aspect = round(clamp(op.aspect, FREE_ASPECT_MIN, FREE_ASPECT_MAX), 3);
      }
      if (op.phone) next.phone = op.phone;
      return { props: next };
    }
    case "put": {
      if (items.length >= MAX_FREE_ITEMS) return { error: `${MAX_FREE_ITEMS} images au plus par planche libre.` };
      if (items.some((i) => i.id === op.id)) return { error: "Image en double." };
      const w = clamp(op.w ?? FREE_DEFAULT_W, FREE_MIN_W, FREE_MAX_W);
      const h = itemHeight(w, zone, op.ratio);
      // Le centre reste dans la zone.
      const cx = clamp(op.x, 0, 100);
      const cy = clamp(op.y, 0, 100);
      const top = items.reduce((m, i) => Math.max(m, i.z), -1) + 1;
      const item: FreeItem = { id: op.id, media: op.media, x: round(cx - w / 2), y: round(cy - h / 2), w: round(w), rot: 0, z: top };
      return done([...items, item]);
    }
    case "place": {
      const i = at(op.id);
      if (i < 0) return { error: GONE };
      const cur = items[i];
      const next: FreeItem = {
        ...cur,
        ...(op.x !== undefined ? { x: round(clamp(op.x, -50, 150)) } : {}),
        ...(op.y !== undefined ? { y: round(clamp(op.y, -50, 150)) } : {}),
        ...(op.w !== undefined ? { w: round(clamp(op.w, FREE_MIN_W, FREE_MAX_W)) } : {}),
        ...(op.rot !== undefined ? { rot: clamp(Math.round(op.rot), -180, 180) } : {}),
      };
      return done(items.map((x, k) => (k === i ? next : x)));
    }
    case "front":
    case "back": {
      const i = at(op.id);
      if (i < 0) return { error: GONE };
      const zs = items.map((x) => x.z);
      const z = op.op === "front" ? Math.max(...zs) + 1 : Math.min(...zs) - 1;
      // Rang négatif le temps du tri : le compactage le ramène à 0.
      return done(compactZ(items.map((x, k) => (k === i ? { ...x, z } : x))));
    }
    case "remove": {
      if (at(op.id) < 0) return { error: GONE };
      return done(compactZ(items.filter((x) => x.id !== op.id)));
    }
    case "replace": {
      const i = at(op.id);
      if (i < 0) return { error: GONE };
      return done(items.map((x, k) => (k === i ? { ...x, media: op.media } : x)));
    }
    case "poster": {
      const i = at(op.id);
      if (i < 0) return { error: GONE };
      return done(
        items.map((x, k) => {
          if (k !== i) return x;
          const { poster: _p, ...rest } = x;
          void _p;
          return op.media === null ? rest : { ...rest, poster: op.media };
        }),
      );
    }
  }
}

/**
 * Habillage d'UNE image (cadre, fond derrière l'image, arrondi) : l'écriture commune `media-look` (lot 75, src/lib/edit/media-look.ts),
 * posée sur la ligne de l'image. Remplace l'ancienne opération « style ». Les nouveaux réglages, ou un message d'erreur en français.
 */
export function applyFreeLook(props: Props, id: string, patch: MediaPatch): { props: Props } | { error: string } {
  const items = freeItems(props);
  const i = items.findIndex((x) => x.id === id);
  if (i < 0) return { error: GONE };
  const res = applyMediaPatchToFree(items[i], patch);
  if ("error" in res) return res;
  return { props: { ...props, items: items.map((x, k) => (k === i ? res.item : x)) } };
}

/* ---- Repères d'alignement magnétiques (déplacement) ----------------------------------------------------------------------- */

export type FreeBox = { x: number; y: number; w: number; h: number };
export type FreeGuides = { v: number[]; h: number[] };

/**
 * Colle une boîte aux bords et au centre de la zone (0, 50, 100) et à ceux des autres images, à `tolX` / `tolY` près (% de la
 * zone). Renvoie la boîte corrigée et les repères touchés (positions des lignes verticales `v` et horizontales `h`).
 * Gauche / centre / droite de la boîte sont comparés aux lignes ; seul l'écart le plus petit de chaque axe est appliqué.
 */
export function snapBox(box: FreeBox, others: FreeBox[], tolX: number, tolY: number): { box: FreeBox; guides: FreeGuides } {
  const linesX = [0, 50, 100, ...others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w])];
  const linesY = [0, 50, 100, ...others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h])];
  const best = (edges: number[], lines: number[], tol: number) => {
    let delta: number | null = null;
    for (const e of edges) for (const l of lines) {
      const d = l - e;
      if (Math.abs(d) <= tol && (delta === null || Math.abs(d) < Math.abs(delta))) delta = d;
    }
    return delta;
  };
  const dx = best([box.x, box.x + box.w / 2, box.x + box.w], linesX, tolX) ?? 0;
  const dy = best([box.y, box.y + box.h / 2, box.y + box.h], linesY, tolY) ?? 0;
  const out = { ...box, x: box.x + dx, y: box.y + dy };
  const hit = (edges: number[], lines: number[]) => [...new Set(lines.filter((l) => edges.some((e) => Math.abs(l - e) < 0.05)).map((l) => round(l)))];
  return {
    box: out,
    guides: {
      v: hit([out.x, out.x + out.w / 2, out.x + out.w], linesX),
      h: hit([out.y, out.y + out.h / 2, out.y + out.h], linesY),
    },
  };
}

/** Identité d'une image neuve (lettres minuscules et chiffres, 12 caractères au plus). */
export function newFreeId(): string {
  return `f${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`.slice(0, 12);
}
