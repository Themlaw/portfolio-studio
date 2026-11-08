/** Écriture du partage et du référencement du site (admin, lots 52 et 83) : description, image de partage, icône de l'onglet. */
import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { buildFavicons } from "@/lib/favicon";
import { parseJson } from "@/lib/json";
import { FaviconInputSchema } from "@/lib/favicon-spec";
import { isReadyImage } from "@/lib/media-alive";
import { readSeo, SeoInputSchema, withLiveFavicon, type SeoStored } from "@/lib/seo-schema";

import { done, fail, zodFieldErrors, type ActionResult } from "./result";

/** Réglage tel qu'il est gardé (valeurs par défaut si absent). */
export function readStoredSeo(): SeoStored {
  const row = getDb().select().from(schema.settings).where(eq(schema.settings.key, "seo")).get();
  return readSeo(row ? parseJson(row.value) : undefined);
}

/** Réglage lu pour un RENDU de l'icône (kit) : une icône dont le média a disparu n'est pas suivie (`withLiveFavicon`). */
export function readLiveSeo(): SeoStored {
  return withLiveFavicon(readStoredSeo(), isReadyImage);
}

function writeSeo(value: SeoStored) {
  const json = JSON.stringify(value);
  getDb()
    .insert(schema.settings)
    .values({ key: "seo", value: json })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: json } })
    .run();
}

/** Description du site et image de partage. L'icône de l'onglet garde son propre enregistrement (saveFavicon) : elle n'est pas touchée. */
export async function saveSeo(input: unknown): Promise<ActionResult<null>> {
  const parsed = SeoInputSchema.safeParse(input);
  if (!parsed.success) return fail("Certains champs sont invalides : corrige les champs signalés.", zodFieldErrors(parsed.error.issues));
  const { description, shareImage } = parsed.data;
  if (shareImage !== null && !isReadyImage(shareImage)) return fail("Cette image de partage n'existe plus : choisis-en une autre.", { shareImage: "Choisis une image de la médiathèque." });
  writeSeo({ ...readStoredSeo(), description, shareImage });
  return done(null);
}

/**
 * Icône de l'onglet (lot 83) : le mode (automatique, une de mes images, kit), les options du monogramme, l'image choisie et son
 * recadrage carré. UN seul réglage de site, enregistré depuis Réglages → Référencement ET depuis l'étape « Logo » du thème.
 * L'image est déclinée ici (tous les formats) ; le monogramme, le logo et le calque du kit sont produits à la première requête.
 */
export async function saveFavicon(input: unknown): Promise<ActionResult<null>> {
  const parsed = FaviconInputSchema.safeParse(input);
  if (!parsed.success) return fail("Certains champs sont invalides : corrige les champs signalés.", zodFieldErrors(parsed.error.issues));
  const { mode, mediaId, mono, crop } = parsed.data;
  if (mode === "image" && mediaId === null) return fail("Choisis une image de la médiathèque.", { mediaId: "Choisis une image de la médiathèque." });
  const current = readStoredSeo();
  let favicon: SeoStored["favicon"] = null;
  if (mediaId !== null && (mode === "image" || current.favicon?.mediaId === mediaId)) {
    const unchanged = current.favicon?.mediaId === mediaId && JSON.stringify(current.faviconMode.crop) === JSON.stringify(crop);
    if (unchanged && current.favicon) favicon = current.favicon;
    else if (mode === "image") {
      const built = await buildFavicons(mediaId, crop);
      if (!built.ok) return fail(built.message, { mediaId: built.message });
      favicon = { mediaId, dir: built.dir };
    }
  }
  writeSeo({ ...current, favicon, faviconMode: { mode, mono, crop } });
  return done(null);
}
