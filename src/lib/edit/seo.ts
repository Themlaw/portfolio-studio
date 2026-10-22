/** Écriture du partage et du référencement du site (admin, lot 52) : description, image de partage, icône de l'onglet. */
import { and, eq, isNull } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { buildFavicons } from "@/lib/favicon";
import { parseJson } from "@/lib/json";
import { readSeo, SeoInputSchema, type SeoStored } from "@/lib/seo-schema";

import { done, fail, zodFieldErrors, type ActionResult } from "./result";

/** Réglage tel qu'il est gardé (valeurs par défaut si absent). */
export function readStoredSeo(): SeoStored {
  const row = getDb().select().from(schema.settings).where(eq(schema.settings.key, "seo")).get();
  return readSeo(row ? parseJson(row.value) : undefined);
}

const isReadyImage = (id: number) =>
  Boolean(getDb().select({ id: schema.media.id }).from(schema.media).where(and(eq(schema.media.id, id), eq(schema.media.kind, "image"), eq(schema.media.status, "ready"), isNull(schema.media.deletedAt))).get());

export async function saveSeo(input: unknown): Promise<ActionResult<null>> {
  const parsed = SeoInputSchema.safeParse(input);
  if (!parsed.success) return fail("Certains champs sont invalides : corrige les champs signalés.", zodFieldErrors(parsed.error.issues));
  const { description, shareImage, favicon } = parsed.data;
  if (shareImage !== null && !isReadyImage(shareImage)) return fail("Cette image de partage n'existe plus : choisis-en une autre.", { shareImage: "Choisis une image de la médiathèque." });
  const current = readStoredSeo();
  let stored: SeoStored["favicon"] = null;
  if (favicon !== null) {
    if (current.favicon?.mediaId === favicon) stored = current.favicon;
    else {
      const built = await buildFavicons(favicon);
      if (!built.ok) return fail(built.message, { favicon: built.message });
      stored = { mediaId: favicon, dir: built.dir };
    }
  }
  const value = JSON.stringify({ description, shareImage, favicon: stored } satisfies SeoStored);
  getDb()
    .insert(schema.settings)
    .values({ key: "seo", value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
    .run();
  return done(null);
}
