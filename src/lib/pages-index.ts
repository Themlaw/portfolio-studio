/**
 * Existence d'un slug publié, lue directement en base (sans cache Next) :
 * utilisée par le proxy, hors du contexte de rendu. Requête minuscule
 * (quelques lignes), sûre à chaque requête. `includeDrafts` : pages non
 * publiées aussi (aperçu de l'admin ; la page vérifie ensuite draft mode ET
 * session avant de les rendre).
 */
import { and, eq, isNull } from "drizzle-orm";

import { getDb, schema } from "./db";
import { parseJson } from "./json";

/** Slug réservé de la page 404 (jamais un slug de page : « _ » interdit en tête). */
export const NOT_FOUND_SLUG = "_404";

export function publishedSlugExists(locale: string, slug: string, { includeDrafts = false } = {}): boolean {
  // Une page à la corbeille n'existe plus, ni en public ni en aperçu.
  const query = getDb().select({ slug: schema.pages.slug }).from(schema.pages);
  const rows = includeDrafts ? query.where(isNull(schema.pages.deletedAt)).all() : query.where(and(eq(schema.pages.published, true), isNull(schema.pages.deletedAt))).all();
  return rows.some((r) => {
    const value = (typeof r.slug === "string" ? parseJson(r.slug) : r.slug) as Record<string, string> | undefined;
    return (value?.[locale] ?? "") === slug;
  });
}

/**
 * Adresse actuelle d'une page publiée qui a PORTÉ `slug` (renommage avec « garder l'ancienne adresse »,
 * lot 51), ou null. Appelée seulement pour un slug inconnu.
 */
export function redirectedSlug(locale: string, slug: string): string | null {
  const row = getDb().select().from(schema.settings).where(eq(schema.settings.key, "slugRedirects")).get();
  const list = parseJson(row?.value) as { locale?: string; from?: string; pageId?: number }[] | undefined;
  const hit = Array.isArray(list) ? list.find((r) => r?.locale === locale && r.from === slug) : undefined;
  if (!hit || typeof hit.pageId !== "number") return null;
  const page = getDb().select({ slug: schema.pages.slug }).from(schema.pages).where(and(eq(schema.pages.id, hit.pageId), eq(schema.pages.published, true), isNull(schema.pages.deletedAt))).get();
  const value = (typeof page?.slug === "string" ? parseJson(page.slug) : page?.slug) as Record<string, string> | undefined;
  const target = value?.[locale];
  return target && target !== slug ? target : null;
}
