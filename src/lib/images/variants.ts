/**
 * Variantes publiques d'une image téléversée (module pur, utilisable côté
 * client). L'original (clé `originals/…`) n'est jamais servi : le site ne
 * montre que ces variantes, ré-encodées sans métadonnées.
 */

export const VARIANT_WIDTHS = [480, 960, 1600, 2400] as const;
export const VARIANT_FORMATS = ["avif", "webp"] as const;
export type VariantFormat = (typeof VARIANT_FORMATS)[number];

export type VariantFile = { key: string; w: number; h: number; format: VariantFormat | "mp4" | "pdf"; size: number; /** PDF : numéro de la page (images d'aperçu). */ page?: number };
export type ImageVariants = {
  v: 1;
  files: VariantFile[];
  /** Vidéo : original supprimé après conversion. */
  originalRemoved?: boolean;
  /** PDF : nombre de pages. */
  pages?: number;
};

export const ORIGINALS_PREFIX = "originals/";
export const VARIANTS_PREFIX = "img/";
export const VIDEO_PREFIX = "vid/";
/** PDF (bloc CV) : images des pages et copie téléchargeable (src/lib/pdf/limits.ts). */
export const DOC_PREFIX = "doc/";

/**
 * Décors panoramiques (au moins 2 fois plus larges que hauts) : un cadre
 * étroit n'en montre qu'une bande, étirée bien au-delà de 2400 px (case
 * portrait d'une grille, zoom d'un cadrage) ; deux variantes de plus, sans
 * quoi cette bande est floue. Peu coûteux : 4800 × 960 px = 4,6 Mpx.
 */
export const PANORAMA_MIN_RATIO = 2;
export const PANORAMA_WIDTHS = [3600, 4800] as const;

/** Plus grande boîte (côté le plus long) produite pour une image de ces dimensions. */
export function topBox(width: number, height: number): number {
  const panorama = Math.max(width, height) / Math.max(1, Math.min(width, height)) >= PANORAMA_MIN_RATIO;
  return panorama ? PANORAMA_WIDTHS[PANORAMA_WIDTHS.length - 1] : VARIANT_WIDTHS[VARIANT_WIDTHS.length - 1];
}

/**
 * Tailles à produire : chaque variante tient dans une boîte carrée de cette
 * taille (côté le plus long), jamais au-delà de l'original ; l'original
 * lui-même si son plus grand côté est sous la plus grande boîte (2400, ou 4800
 * pour un panorama : `shortSide` donné).
 */
export function variantBoxes(longSide: number, shortSide = longSide): number[] {
  const top = topBox(longSide, shortSide);
  const all: number[] = [...VARIANT_WIDTHS, ...(top > VARIANT_WIDTHS[VARIANT_WIDTHS.length - 1] ? PANORAMA_WIDTHS : [])];
  const out: number[] = all.filter((w) => w < longSide);
  out.push(Math.min(longSide, top));
  return [...new Set(out)].sort((a, b) => a - b);
}

export function variantKey(hash16: string, width: number, format: VariantFormat): string {
  return `${VARIANTS_PREFIX}${hash16}/${width}.${format}`;
}

/** Préfixe de hash d'une clé de variante (img/<hash16>/… ou vid/<hash16>/…), ou null. */
export function hashOfVariantKey(key: string): string | null {
  const m =
    /^img\/([0-9a-f]{16})\/\d{1,5}\.(avif|webp)$/.exec(key) ??
    /^vid\/([0-9a-f]{16})\/(?:\d{3,4}\.mp4|poster-(?:\d{3,4}|full)\.webp)$/.exec(key) ??
    /^doc\/([0-9a-f]{16})\/(?:document\.pdf|p\d{1,2}-\d{3,4}\.(?:avif|webp))$/.exec(key);
  return m ? m[1] : null;
}

/** Type MIME d'une variante d'après son extension. */
export function variantMime(key: string): string {
  if (key.endsWith(".pdf")) return "application/pdf";
  return key.endsWith(".mp4") ? "video/mp4" : key.endsWith(".avif") ? "image/avif" : "image/webp";
}

/** Sources d'une vidéo convertie (URL publiques). */
export type VideoSources = {
  /** Du plus grand au plus petit : 1080 (si présent) puis 720. */
  mp4: { src: string; w: number; h: number }[];
  poster: PictureSources;
};

export function videoSources(variants: ImageVariants, urlOf: (key: string) => string, color: string | null): VideoSources | null {
  const mp4 = variants.files.filter((f) => f.format === "mp4").sort((a, b) => b.h * b.w - a.h * a.w);
  const posters = variants.files.filter((f) => f.format === "webp").sort((a, b) => a.w - b.w);
  if (!mp4.length || !posters.length) return null;
  const top = posters.at(-1)!;
  const srcset = posters.map((f) => `${urlOf(f.key)} ${f.w}w`).join(", ");
  return {
    mp4: mp4.map((f) => ({ src: urlOf(f.key), w: f.w, h: f.h })),
    poster: { avif: "", webp: srcset, largest: { avif: "", webp: urlOf(top.key), w: top.w, h: top.h }, color },
  };
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

/** Aperçu d'un PDF : sources <picture> de chaque page, et le fichier téléchargeable. */
export type PdfView = {
  pages: { sources: PictureSources; w: number; h: number }[];
  /** URL du PDF (servi en pièce jointe, jamais affiché sur le site). */
  href: string;
  size: number;
};

export function pdfView(variants: ImageVariants, urlOf: (key: string) => string): PdfView | null {
  const doc = variants.files.find((f) => f.format === "pdf");
  const count = variants.pages ?? 0;
  if (!doc || count < 1) return null;
  const pages: PdfView["pages"] = [];
  for (let page = 1; page <= count; page++) {
    const files = variants.files.filter((f) => f.page === page && (f.format === "avif" || f.format === "webp"));
    if (!files.some((f) => f.format === "webp")) return null;
    const sources = pictureSources({ v: 1, files }, urlOf, null);
    pages.push({ sources, w: sources.largest.w, h: sources.largest.h });
  }
  return { pages, href: urlOf(doc.key), size: doc.size };
}
