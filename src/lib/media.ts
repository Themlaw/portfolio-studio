import { and, eq, isNull, like } from "drizzle-orm";

import { DOC_PREFIX, hashOfVariantKey, ORIGINALS_PREFIX, parseVariants, pdfView, pictureSources, variantMime, VARIANTS_PREFIX, VIDEO_PREFIX, videoSources, type PdfView, type PictureSources, type VideoSources } from "./images/variants";
import { animOf, type AnimMeta } from "./animation/sheet";
import { formatDuration, isLoop } from "./video/limits";

import { cached, TAGS } from "./cache";
import { getDb, schema } from "./db";

type L = { fr: string; en: string };

export type MediaInfo = {
  id: number;
  key: string;
  /** URL affichable : la plus grande variante pour une image téléversée. */
  url: string;
  /** Sources <picture> d'une image téléversée (null : média du seed, servi tel quel). */
  sources: PictureSources | null;
  /** Vidéo hébergée convertie, sinon null. */
  video: VideoView | null;
  /** PDF (bloc CV) : pages en images et fichier téléchargeable, sinon null. */
  pdf: PdfView | null;
  mime: string;
  width: number | null;
  height: number | null;
  alt: L | null;
  /** Lot 132 : animation image par image (width / height sont alors ceux d'UNE image ; `url` / `sources` la bande entière). */
  anim?: AnimMeta;
};

/** URL publique d'un média (servie par src/app/media/[...key]/route.ts). */
export function mediaUrl(key: string): string {
  return `/media/${key}`;
}

/** Sources <picture> d'une ligne média (variantes), ou null. Vidéo : son poster. */
export function mediaSources(row: { variants: unknown; dominantColor: string | null; kind?: string }): PictureSources | null {
  const variants = parseVariants(row.variants);
  if (!variants) return null;
  if (row.kind === "video") return videoSources(variants, mediaUrl, row.dominantColor)?.poster ?? null;
  if (row.kind === "pdf") return pdfView(variants, mediaUrl)?.pages[0]?.sources ?? null;
  return pictureSources(variants, mediaUrl, row.dominantColor);
}

/** `hasAudio` : la vidéo a une piste son audible (inconnu = oui : le bouton son reste proposé). */
export type VideoView = {
  sources: VideoSources;
  duration: number;
  durationLabel: string;
  loop: boolean;
  hasAudio: boolean;
  /** Lot 127 : l'artiste a réglé « Son au départ : coupé » pour CET emplacement (jamais écrit dans le média ; voir src/blocks/video-sound.ts, `withSound`). */
  soundOff?: boolean;
};

/** Lecture d'une vidéo convertie (sources MP4, poster, durée, boucle ?), ou null. */
export function videoView(row: { kind: string; variants: unknown; dominantColor: string | null; duration: number | null; hasAudio: boolean | null }): VideoView | null {
  if (row.kind !== "video") return null;
  const variants = parseVariants(row.variants);
  const sources = variants ? videoSources(variants, mediaUrl, row.dominantColor) : null;
  if (!sources) return null;
  return { sources, duration: row.duration ?? 0, durationLabel: formatDuration(row.duration), loop: isLoop(row), hasAudio: row.hasAudio !== false };
}

/** Aperçu d'un PDF traité (pages, fichier), ou null. */
export function pdfViewOf(row: { kind: string; variants: unknown }): PdfView | null {
  if (row.kind !== "pdf") return null;
  const variants = parseVariants(row.variants);
  return variants ? pdfView(variants, mediaUrl) : null;
}

/** URL affichable d'un média (variante WebP la plus large, sinon la clé). */
export function displayUrl(row: { key: string; variants: unknown; dominantColor: string | null }): string {
  return mediaSources(row)?.largest.webp ?? mediaUrl(row.key);
}

export async function getMedia(id: number | undefined | null): Promise<MediaInfo | null> {
  if (!id) return null;
  return cached([`media:${id}`], [TAGS.media], () => {
    const row = getDb().select().from(schema.media).where(eq(schema.media.id, id)).get();
    if (!row || row.status !== "ready" || row.deletedAt) return null;
    const sources = mediaSources(row);
    const anim = row.kind === "image" ? animOf(row.variants) : null;
    return {
      id: row.id,
      key: row.key,
      url: sources ? sources.largest.webp : mediaUrl(row.key),
      sources,
      video: videoView(row),
      pdf: row.kind === "pdf" ? pdfViewOf(row) : null,
      mime: row.mime,
      width: anim ? anim.fw : row.width,
      height: anim ? anim.fh : row.height,
      alt: row.alt ?? null,
      ...(anim ? { anim } : {}),
    };
  });
}

/**
 * Média dont on peut extraire un recadrage (route /media/crop) : image raster prête, avec son original
 * (clé de stockage) et ses dimensions orientées. Null pour le reste (vidéo, PDF, SVG du seed, absent).
 */
export function findCropSource(id: number): { id: number; key: string; width: number; height: number } | null {
  const row = getDb().select().from(schema.media).where(eq(schema.media.id, id)).get();
  if (!row || row.deletedAt || row.status !== "ready" || row.kind !== "image" || !row.width || !row.height || !row.sha256 || !parseVariants(row.variants)) return null;
  if (!isOriginalKey(row.key) || row.mime === "image/svg+xml") return null;
  return { id: row.id, key: row.key, width: row.width, height: row.height };
}

const isOriginalKey = (key: string) => key.startsWith(ORIGINALS_PREFIX);

/**
 * Lecture directe (route /media) : type et statut d'une clé publique.
 * - originals/… : jamais servi (original conservé pour régénérer) ;
 * - img/<hash>/<largeur>.<format> (et vid/…, doc/…) : variante d'un média
 *   prêt, listée dans ses variantes (doc/…/document.pdf : servi en pièce
 *   jointe seulement, voir la route /media) ;
 * - autre clé : média du seed servi tel quel (SVG, par sa clé exacte).
 */
export function findMediaByKey(key: string): { mime: string; status: string } | null {
  if (key.startsWith(ORIGINALS_PREFIX)) return null;
  const hash16 = hashOfVariantKey(key);
  const db = getDb();
  if (hash16) {
    const row = db
      .select({ status: schema.media.status, variants: schema.media.variants })
      .from(schema.media)
      .where(and(like(schema.media.sha256, `${hash16}%`), eq(schema.media.status, "ready"), isNull(schema.media.deletedAt)))
      .get();
    const file = row ? parseVariants(row.variants)?.files.find((f) => f.key === key) : undefined;
    if (!row || !file) return null;
    return { mime: variantMime(key), status: row.status };
  }
  if (key.startsWith(VARIANTS_PREFIX) || key.startsWith(VIDEO_PREFIX) || key.startsWith(DOC_PREFIX)) return null;
  const row = db
    .select({ mime: schema.media.mime, status: schema.media.status })
    .from(schema.media)
    .where(and(eq(schema.media.key, key), eq(schema.media.status, "ready"), isNull(schema.media.deletedAt)))
    .get();
  return row ?? null;
}
