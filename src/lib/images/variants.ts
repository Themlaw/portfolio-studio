/**
 * Variantes publiques d'une image téléversée (module pur, utilisable côté
 * client). L'original (clé `originals/…`) n'est jamais servi : le site ne
 * montre que ces variantes, ré-encodées sans métadonnées.
 */

export const VARIANT_WIDTHS = [480, 960, 1600, 2400] as const;
export const VARIANT_FORMATS = ["avif", "webp"] as const;
export type VariantFormat = (typeof VARIANT_FORMATS)[number];

export type VariantFile = { key: string; w: number; h: number; format: VariantFormat; size: number };
export type ImageVariants = { v: 1; files: VariantFile[] };

export const ORIGINALS_PREFIX = "originals/";
export const VARIANTS_PREFIX = "img/";

/**
 * Tailles à produire : chaque variante tient dans une boîte carrée de cette
 * taille (côté le plus long), jamais au-delà de l'original ; l'original
 * lui-même si son plus grand côté est sous 2400.
 */
export function variantBoxes(longSide: number): number[] {
  const out: number[] = VARIANT_WIDTHS.filter((w) => w < longSide);
  out.push(Math.min(longSide, VARIANT_WIDTHS[VARIANT_WIDTHS.length - 1]));
  return [...new Set(out)].sort((a, b) => a - b);
}

export function variantKey(hash16: string, width: number, format: VariantFormat): string {
  return `${VARIANTS_PREFIX}${hash16}/${width}.${format}`;
}

/** Préfixe de hash d'une clé de variante (img/<hash16>/…), ou null. */
export function hashOfVariantKey(key: string): string | null {
  const m = /^img\/([0-9a-f]{16})\/\d{1,5}\.(avif|webp)$/.exec(key);
  return m ? m[1] : null;
}

export function parseVariants(value: unknown): ImageVariants | null {
  const v = value as ImageVariants | null;
  if (!v || v.v !== 1 || !Array.isArray(v.files) || v.files.length === 0) return null;
  return v;
}

/** Sources d'une balise <picture> (URL publiques). */
export type PictureSources = {
  avif: string;
  webp: string;
  /** Plus grande variante (lightbox, repli <img>). */
  largest: { avif: string; webp: string; w: number; h: number };
  color: string | null;
};

export function pictureSources(variants: ImageVariants, urlOf: (key: string) => string, color: string | null): PictureSources {
  const by = (format: VariantFormat) => variants.files.filter((f) => f.format === format).sort((a, b) => a.w - b.w);
  const srcset = (format: VariantFormat) => by(format).map((f) => `${urlOf(f.key)} ${f.w}w`).join(", ");
  const top = (format: VariantFormat) => by(format).at(-1)!;
  return {
    avif: srcset("avif"),
    webp: srcset("webp"),
    largest: { avif: urlOf(top("avif").key), webp: urlOf(top("webp").key), w: top("webp").w, h: top("webp").h },
    color,
  };
}
