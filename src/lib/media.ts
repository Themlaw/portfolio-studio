import { and, eq, like } from "drizzle-orm";

import { hashOfVariantKey, ORIGINALS_PREFIX, parseVariants, pictureSources, VARIANTS_PREFIX, type PictureSources } from "./images/variants";

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
  mime: string;
  width: number | null;
  height: number | null;
  alt: L | null;
};

/** URL publique d'un média (servie par src/app/media/[...key]/route.ts). */
export function mediaUrl(key: string): string {
  return `/media/${key}`;
}

/** Sources <picture> d'une ligne média (variantes), ou null. */
export function mediaSources(row: { variants: unknown; dominantColor: string | null }): PictureSources | null {
  const variants = parseVariants(row.variants);
  return variants ? pictureSources(variants, mediaUrl, row.dominantColor) : null;
}

/** URL affichable d'un média (variante WebP la plus large, sinon la clé). */
export function displayUrl(row: { key: string; variants: unknown; dominantColor: string | null }): string {
  return mediaSources(row)?.largest.webp ?? mediaUrl(row.key);
}

export async function getMedia(id: number | undefined | null): Promise<MediaInfo | null> {
  if (!id) return null;
  return cached([`media:${id}`], [TAGS.media], () => {
    const row = getDb().select().from(schema.media).where(eq(schema.media.id, id)).get();
    if (!row || row.status !== "ready") return null;
    const sources = mediaSources(row);
    return {
      id: row.id,
      key: row.key,
      url: sources ? sources.largest.webp : mediaUrl(row.key),
      sources,
      mime: row.mime,
      width: row.width,
      height: row.height,
      alt: row.alt ?? null,
    };
  });
}

/**
 * Lecture directe (route /media) : type et statut d'une clé publique.
 * - originals/… : jamais servi (original conservé pour régénérer) ;
 * - img/<hash>/<largeur>.<format> : variante d'un média prêt, listée dans
 *   ses variantes ;
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
      .where(and(like(schema.media.sha256, `${hash16}%`), eq(schema.media.status, "ready")))
      .get();
    const file = row ? parseVariants(row.variants)?.files.find((f) => f.key === key) : undefined;
    if (!row || !file) return null;
    return { mime: file.format === "avif" ? "image/avif" : "image/webp", status: row.status };
  }
  if (key.startsWith(VARIANTS_PREFIX)) return null;
  const row = db
    .select({ mime: schema.media.mime, status: schema.media.status })
    .from(schema.media)
    .where(and(eq(schema.media.key, key), eq(schema.media.status, "ready")))
    .get();
  return row ?? null;
}
