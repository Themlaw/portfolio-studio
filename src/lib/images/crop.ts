/**
 * Recadrage libre d'une image (module pur, utilisable côté client et serveur).
 *
 * Un recadrage est un rectangle normalisé {x, y, w, h} (0..1, fractions de
 * l'image ORIENTÉE), stocké par emplacement (`look.crop` d'un bloc ou d'une
 * case, `look.tileCrop` d'une tuile) : l'original n'est jamais modifié, la même
 * image peut être posée plusieurs fois avec des recadrages différents.
 *
 * Côté serveur, un recadrage donne des variantes AVIF/WebP extraites de
 * l'ORIGINAL (src/lib/images/crop-cache.ts), servies par
 * `/media/crop/<média>/<rect>-<signature>/<largeur>.<format>`. Tout ce qui
 * peut arriver dans cette URL est borné ici : rectangle en dix-millièmes
 * (précision de la clé de cache), largeurs d'une liste fermée.
 */
import { z } from "zod";

import type { PictureSources, VariantFormat } from "./variants";

/** Précision du rectangle : le dix-millième de l'image (20 000 px de large → 2 px). */
export const RECT_UNITS = 10_000;
/** Plus petit côté d'un recadrage : 1 % de l'image. */
export const MIN_SIDE = 0.01;

export const RectSchema = z
  .strictObject({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().min(MIN_SIDE).max(1),
    h: z.number().min(MIN_SIDE).max(1),
  })
  .refine((r) => r.x + r.w <= 1.0001 && r.y + r.h <= 1.0001, "Le recadrage sort de l'image.");
export type Rect = z.infer<typeof RectSchema>;

/** Rectangle en unités entières (clé de cache) : x, y, w, h en dix-millièmes. */
export type RectUnits = { x: number; y: number; w: number; h: number };

/** Arrondit au dix-millième et garde le rectangle dans l'image. */
export function toUnits(rect: Rect): RectUnits {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const w = clamp(Math.round(rect.w * RECT_UNITS), RECT_UNITS * MIN_SIDE, RECT_UNITS);
  const h = clamp(Math.round(rect.h * RECT_UNITS), RECT_UNITS * MIN_SIDE, RECT_UNITS);
  return { x: clamp(Math.round(rect.x * RECT_UNITS), 0, RECT_UNITS - w), y: clamp(Math.round(rect.y * RECT_UNITS), 0, RECT_UNITS - h), w, h };
}

export function fromUnits(u: RectUnits): Rect {
  return { x: u.x / RECT_UNITS, y: u.y / RECT_UNITS, w: u.w / RECT_UNITS, h: u.h / RECT_UNITS };
}

export const rectKey = (u: RectUnits) => `x${u.x}y${u.y}w${u.w}h${u.h}`;

/** Inverse de rectKey, ou null si la clé n'est pas un rectangle valide. */
export function parseRectKey(key: string): RectUnits | null {
  const m = /^x(\d{1,5})y(\d{1,5})w(\d{1,5})h(\d{1,5})$/.exec(key);
  if (!m) return null;
  const [x, y, w, h] = m.slice(1).map(Number);
  const min = RECT_UNITS * MIN_SIDE;
  if (w < min || h < min || w > RECT_UNITS || h > RECT_UNITS || x + w > RECT_UNITS || y + h > RECT_UNITS) return null;
  return { x, y, w, h };
}

/** Le rectangle couvre (presque) toute l'image : rien à recadrer. */
export function isWholeImage(rect: Rect): boolean {
  return rect.w >= 0.998 && rect.h >= 0.998;
}

/** Dimensions et position du recadrage en pixels de l'image orientée (au moins 1 px). */
export function rectPixels(u: RectUnits, width: number, height: number): { w: number; h: number; left: number; top: number } {
  const px = (v: number, side: number) => Math.round((v / RECT_UNITS) * side);
  const w = Math.max(1, Math.min(width, px(u.w, width)));
  const h = Math.max(1, Math.min(height, px(u.h, height)));
  return { w, h, left: Math.min(width - w, px(u.x, width)), top: Math.min(height - h, px(u.y, height)) };
}

/**
 * Rectangle de l'image VUE (orientation EXIF appliquée), `px` en pixels, reporté dans le repère du
 * FICHIER (`width × height`, non tourné) : permet d'extraire en lecture séquentielle puis d'orienter la
 * petite découpe, au lieu de décoder l'image entière tournée. Orientations 1 à 8 (5 à 8 échangent les axes).
 */
export function fileRect(
  px: { left: number; top: number; w: number; h: number },
  orientation: number,
  width: number,
  height: number,
): { left: number; top: number; w: number; h: number } {
  const { left, top, w, h } = px;
  switch (orientation) {
    case 2:
      return { left: width - left - w, top, w, h };
    case 3:
      return { left: width - left - w, top: height - top - h, w, h };
    case 4:
      return { left, top: height - top - h, w, h };
    case 5:
      return { left: top, top: left, w: h, h: w };
    case 6:
      return { left: top, top: height - left - w, w: h, h: w };
    case 7:
      return { left: width - top - h, top: height - left - w, w: h, h: w };
    case 8:
      return { left: width - top - h, top: left, w: h, h: w };
    default:
      return { left, top, w, h };
  }
}

/* ---- Largeurs servies ------------------------------------------------------------- */

export const CROP_WIDTHS = [480, 960, 1600, 2400, 3600, 4800] as const;
/** Pixels de sortie au plus par variante : borne l'encodage en mémoire (3600 × 2000 ≈ 7 Mpx passe, 4800 × 4800 non). */
export const CROP_MAX_PIXELS = 12_000_000;
export const CROP_FORMATS = ["avif", "webp"] as const;

/**
 * Largeurs (px) produites pour un recadrage de `w × h` pixels : la liste fermée
 * sous la taille réelle (jamais d'agrandissement), puis la taille réelle
 * elle-même si elle est sous le plafond, le tout borné à CROP_MAX_PIXELS.
 */
export function cropWidths(w: number, h: number): number[] {
  const ratio = w / Math.max(1, h);
  const fits = (x: number) => x * (x / ratio) <= CROP_MAX_PIXELS;
  const top = CROP_WIDTHS[CROP_WIDTHS.length - 1];
  const out: number[] = CROP_WIDTHS.filter((x) => x < w && fits(x));
  if (w <= top && fits(w)) out.push(w);
  else if (!out.length) out.push(Math.min(w, CROP_WIDTHS[0]));
  return [...new Set(out)].sort((a, b) => a - b);
}

/** Hauteur d'une variante de largeur `width` (le rapport exact du recadrage). */
export const cropHeight = (width: number, w: number, h: number) => Math.max(1, Math.round((width * h) / w));

/* ---- URL ------------------------------------------------------------------------------ */

export const CROP_PREFIX = "crop/";
export const SIG_LENGTH = 20;

export function cropKey(mediaId: number, units: RectUnits, sig: string, width: number, format: VariantFormat): string {
  return `${CROP_PREFIX}${mediaId}/${rectKey(units)}-${sig}/${width}.${format}`;
}

export type CropRequest = { mediaId: number; units: RectUnits; sig: string; width: number; format: VariantFormat };

/** Analyse d'une clé `crop/…` ; null si la forme ou une borne n'est pas respectée (la signature se vérifie ailleurs). */
export function parseCropKey(key: string): CropRequest | null {
  const m = /^crop\/([1-9]\d{0,8})\/(x\d{1,5}y\d{1,5}w\d{1,5}h\d{1,5})-([0-9a-f]{20})\/(\d{3,4})\.(avif|webp)$/.exec(key);
  if (!m) return null;
  const units = parseRectKey(m[2]);
  const mediaId = Number(m[1]);
  if (!units || mediaId < 1) return null;
  return { mediaId, units, sig: m[3], width: Number(m[4]), format: m[5] as VariantFormat };
}

/**
 * Sources <picture> d'un recadrage (mêmes formes que pictureSources) : un
 * srcset AVIF et un WebP aux largeurs de cropWidths ; `largest` = la plus
 * grande. `sign` fournit la signature (serveur, secret).
 */
export function cropSources(
  media: { id: number; width: number; height: number },
  rect: Rect,
  sign: (mediaId: number, rectKey: string) => string,
  urlOf: (key: string) => string,
  color: string | null,
): { sources: PictureSources; width: number; height: number } {
  const units = toUnits(rect);
  const px = rectPixels(units, media.width, media.height);
  const sig = sign(media.id, rectKey(units));
  const widths = cropWidths(px.w, px.h);
  const srcset = (format: VariantFormat) => widths.map((w) => `${urlOf(cropKey(media.id, units, sig, w, format))} ${w}w`).join(", ");
  const top = widths[widths.length - 1];
  return {
    width: px.w,
    height: px.h,
    sources: {
      avif: srcset("avif"),
      webp: srcset("webp"),
      largest: { avif: urlOf(cropKey(media.id, units, sig, top, "avif")), webp: urlOf(cropKey(media.id, units, sig, top, "webp")), w: top, h: cropHeight(top, px.w, px.h) },
      color,
    },
  };
}
