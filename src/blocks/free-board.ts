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
import { RevealSchema } from "./reveal";

import { animSlotFields } from "../lib/animation/sheet";
import { applyMediaPatchToFree, type MediaPatch } from "../lib/edit/media-look";
import { FrameSchema, ImageBgSchema, RADII, SLOT_VIDEO_MODES, SLOT_VIDEO_SOUNDS } from "../lib/look";

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
  /** Son au départ d'une VIDÉO (lot 127) : « off » = coupé ; absent = activé (le défaut, jamais écrit : aucune ancienne planche ne change). */
  sound: z.enum(SLOT_VIDEO_SOUNDS).optional(),
  /** Image d'attente choisie pour une vidéo (identifiant de la médiathèque) ; absent = celle de la vidéo. */
  poster: z.number().int().positive().optional(),
  /** Apparition au défilement de cette image (lot 133) ; illisible = ignorée. */
  reveal: RevealSchema.optional().catch(undefined),
  /** Lot 132 : animation image par image : cadence (6 / 8 / 12 / 24) et boucle (`false` = un tour) de CETTE image. Absent = rendu d'avant. */
  ...animSlotFields,
});
export type FreeItem = z.infer<typeof FreeItemSchema>;

/**
 * Recadrage du cadre (lot 113) : le « plan » est la zone telle que `format` / `aspect` la décrivent (les images y sont posées en % comme
 * toujours) ; le cadre est la fenêtre visible dans ce plan, définie par quatre marges en % du plan (haut, droite, bas, gauche). Rien
 * n'est réécrit dans les images : recadrer puis ré-agrandir rend exactement l'état d'avant. Absent = pas de recadrage (rendu d'avant).
 * Gauche, droite et haut restent dans le plan (>= 0) ; le bas peut descendre sous le plan (négatif jusqu'à -150).
 */
export const FREE_CROP_MIN = 10;
export const FREE_CROP_B_MIN = -150;
export const FREE_FRAME_ASPECT_MIN = 0.25;
export const FREE_FRAME_ASPECT_MAX = 8;
export const FreeCropSchema = z.object({
  t: z.number().min(0).max(90).optional(),
  r: z.number().min(0).max(90).optional(),
  b: z.number().min(FREE_CROP_B_MIN).max(90).optional(),
  l: z.number().min(0).max(90).optional(),
});
export type FreeCrop = { t: number; r: number; b: number; l: number };

export const freeBoardSchema = z.object({
  format: z.enum(FREE_FORMATS).default("3:2"),
  /** Recadrage du cadre (lot 113), absent = le plan entier. */
  crop: FreeCropSchema.optional(),
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

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
/** Le recadrage lu tolérant (valeurs hors bornes ramenées), ou null s'il n'y en a pas (absent, nul, illisible). */
export function cropOf(props: { crop?: unknown }): FreeCrop | null {
  const c = props.crop;
  if (!c || typeof c !== "object" || Array.isArray(c)) return null;
  const o = c as Record<string, unknown>;
  const crop = { t: clamp(num(o.t), 0, 90), r: clamp(num(o.r), 0, 90), b: clamp(num(o.b), FREE_CROP_B_MIN, 90), l: clamp(num(o.l), 0, 90) };
  return crop.t === 0 && crop.r === 0 && crop.b === 0 && crop.l === 0 ? null : crop;
}

/** Marges ramenées dans les bornes : cadre d'au moins 10 % du plan dans chaque sens, format du cadre entre 0,25 et 8. */
export function clampCrop(c: FreeCrop, zone: number): FreeCrop {
  const t = clamp(c.t, 0, 90);
  let r = clamp(c.r, 0, 90);
  let b = clamp(c.b, FREE_CROP_B_MIN, 90);
  let l = clamp(c.l, 0, 90);
  if (100 - l - r < FREE_CROP_MIN) r = Math.max(0, 100 - l - FREE_CROP_MIN);
  if (100 - l - r < FREE_CROP_MIN) l = 100 - r - FREE_CROP_MIN;
  if (100 - t - b < FREE_CROP_MIN) b = 100 - t - FREE_CROP_MIN;
  const w = 100 - l - r;
  const hMin = (zone * w) / FREE_FRAME_ASPECT_MAX;
  const hMax = (zone * w) / FREE_FRAME_ASPECT_MIN;
  if (100 - t - b < hMin) b = 100 - t - hMin;
  if (100 - t - b > hMax) b = 100 - t - hMax;
  const q = (n: number) => Math.round(n * 100) / 100;
  return { t: q(t), r: q(r), b: q(b), l: q(l) };
}

/** Largeur ÷ hauteur du CADRE (la fenêtre visible), recadrage compris. */
export function frameAspect(props: { format?: unknown; aspect?: unknown; crop?: unknown }): number {
  const zone = zoneAspect(props);
  const c = cropOf(props);
  return c ? (zone * (100 - c.l - c.r)) / (100 - c.t - c.b) : zone;
}

/**
 * Variables CSS du cadre recadré (`--fb-cl` / `--fb-ct` : coin haut gauche du cadre dans le plan, `--fb-cw` / `--fb-ch` : sa taille, en % du
 * plan ; `--fb-fa` : son format), ou null sans recadrage : le rendu d'avant reste strictement celui d'avant.
 */
export function cropStyle(props: { format?: unknown; aspect?: unknown; crop?: unknown }): Record<string, number> | null {
  const c = cropOf(props);
  if (!c) return null;
  return { "--fb-cl": c.l, "--fb-ct": c.t, "--fb-cw": 100 - c.l - c.r, "--fb-ch": 100 - c.t - c.b, "--fb-fa": (zoneAspect(props) * (100 - c.l - c.r)) / (100 - c.t - c.b) };
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
  /** Recadre le cadre (lot 113) : marges absolues en % du plan (celles qui manquent sont gardées) ; `reset` : plan entier. */
  | { op: "crop"; t?: number; r?: number; b?: number; l?: number; reset?: boolean }
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
        // Un format choisi dans le panneau redonne le plan entier : le recadrage s'efface.
        delete next.crop;
        next.format = op.format;
        // Un format fixe fait oublier la hauteur libre ; « Hauteur libre » garde le format actuel comme point de départ.
        if (op.format !== "free") delete next.aspect;
        else if (op.aspect === undefined && next.aspect === undefined) next.aspect = round(zone);
      }
      if (op.aspect !== undefined) {
        delete next.crop;
        next.format = "free";
        next.aspect = round(clamp(op.aspect, FREE_ASPECT_MIN, FREE_ASPECT_MAX), 3);
      }
      if (op.phone) next.phone = op.phone;
      return { props: next };
    }
    case "crop": {
      const next: Props = { ...props };
      if (op.reset) {
        delete next.crop;
        return { props: next };
      }
      const cur = cropOf(props) ?? { t: 0, r: 0, b: 0, l: 0 };
      const want = { t: op.t ?? cur.t, r: op.r ?? cur.r, b: op.b ?? cur.b, l: op.l ?? cur.l };
      const c = clampCrop(want, zone);
      if (c.t === 0 && c.r === 0 && c.b === 0 && c.l === 0) delete next.crop;
      else next.crop = c;
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

/* ---- Magnétisme du recadrage (lot 113) ------------------------------------------------------------------------------------- */

export const FREE_SNAP_RATIOS: [string, number][] = [["3:2", 3 / 2], ["4:3", 4 / 3], ["1:1", 1], ["16:9", 16 / 9]];
export type FreeContent = { x0: number; y0: number; x1: number; y1: number };

/** Boîte englobante des images en % du plan (rotation comprise) ; `ratios` : largeur ÷ hauteur de chaque média, par id d'image. Null sans image. */
export function contentBounds(items: FreeItem[], zone: number, ratios: Record<string, number>): FreeContent | null {
  let box: FreeContent | null = null;
  for (const it of items) {
    const h = itemHeight(it.w, zone, ratios[it.id] ?? 1);
    const cx = it.x + it.w / 2;
    const cy = it.y + h / 2;
    // Largeur en % de la largeur du plan, hauteur en % de sa hauteur : la rotation se calcule en unités égales (largeur du plan = 1).
    const hu = h / zone;
    const th = (it.rot * Math.PI) / 180;
    const ex = (Math.abs(it.w * Math.cos(th)) + Math.abs(hu * Math.sin(th))) / 2;
    const ey = ((Math.abs(it.w * Math.sin(th)) + Math.abs(hu * Math.cos(th))) / 2) * zone;
    const b = { x0: cx - ex, x1: cx + ex, y0: cy - ey, y1: cy + ey };
    box = box ? { x0: Math.min(box.x0, b.x0), x1: Math.max(box.x1, b.x1), y0: Math.min(box.y0, b.y0), y1: Math.max(box.y1, b.y1) } : b;
  }
  return box;
}

/**
 * Magnétisme d'un geste de recadrage : `moved` = bords déplacés. D'abord les bords du contenu (priorité : le bord déplacé colle à l'image la
 * plus proche, à `tolPct` % du plan près), sinon le format du cadre colle à un repère (3:2, 4:3, 1:1, 16:9) à `tol` près (relatif) en
 * ajustant le bord vertical déplacé (bas de préférence), sinon l'horizontal. `tol` = 0 : aucun magnétisme (Alt).
 */
export function snapCrop(crop: FreeCrop, moved: ("t" | "r" | "b" | "l")[], o: { zone: number; tol: number; content: FreeContent | null; tolPct?: number }): { crop: FreeCrop; snap?: string } {
  const out = { ...crop };
  const tolPct = o.tolPct ?? 0;
  if (o.content && tolPct > 0) {
    const c = o.content;
    const want: Record<"t" | "r" | "b" | "l", number> = { t: c.y0, b: 100 - c.y1, l: c.x0, r: 100 - c.x1 };
    let hit = false;
    for (const k of moved) {
      if (Math.abs(out[k] - want[k]) <= tolPct && (k === "b" || want[k] >= 0)) {
        out[k] = Math.round(want[k] * 100) / 100;
        hit = true;
      }
    }
    if (hit) return { crop: out, snap: "contenu" };
  }
  if (o.tol > 0) {
    const w = 100 - out.l - out.r;
    const h = 100 - out.t - out.b;
    const fa = (o.zone * w) / h;
    let best: [string, number] | null = null;
    for (const r of FREE_SNAP_RATIOS) if (Math.abs(fa - r[1]) / r[1] <= o.tol && (!best || Math.abs(fa - r[1]) < Math.abs(fa - best[1]))) best = r;
    if (best) {
      if (moved.includes("b") || moved.includes("t")) {
        const nh = (o.zone * w) / best[1];
        if (moved.includes("b")) out.b = Math.round((100 - out.t - nh) * 100) / 100;
        else out.t = Math.round((100 - out.b - nh) * 100) / 100;
      } else {
        const nw = (best[1] * h) / o.zone;
        if (moved.includes("r")) out.r = Math.round((100 - out.l - nw) * 100) / 100;
        else out.l = Math.round((100 - out.r - nw) * 100) / 100;
      }
      return { crop: out, snap: best[0] };
    }
  }
  return { crop };
}

/** Identité d'une image neuve (lettres minuscules et chiffres, 12 caractères au plus). */
export function newFreeId(): string {
  return `f${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`.slice(0, 12);
}
