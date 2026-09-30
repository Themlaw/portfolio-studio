import { eq } from "drizzle-orm";

import { cached, TAGS } from "./cache";
import { getDb, schema } from "./db";

type L = { fr: string; en: string };

export type MediaInfo = {
  id: number;
  key: string;
  url: string;
  mime: string;
  width: number | null;
  height: number | null;
  alt: L | null;
};

/** URL publique d'un média (servie par src/app/media/[...key]/route.ts). */
export function mediaUrl(key: string): string {
  return `/media/${key}`;
}

export async function getMedia(id: number | undefined | null): Promise<MediaInfo | null> {
  if (!id) return null;
  return cached([`media:${id}`], [TAGS.media], () => {
    const row = getDb().select().from(schema.media).where(eq(schema.media.id, id)).get();
    return row
      ? { id: row.id, key: row.key, url: mediaUrl(row.key), mime: row.mime, width: row.width, height: row.height, alt: row.alt ?? null }
      : null;
  });
}

/** Lecture directe (route /media) : mime et statut d'une clé. */
export function findMediaByKey(key: string): { mime: string; status: string } | null {
  const row = getDb()
    .select({ mime: schema.media.mime, status: schema.media.status })
    .from(schema.media)
    .where(eq(schema.media.key, key))
    .get();
  return row ?? null;
}
