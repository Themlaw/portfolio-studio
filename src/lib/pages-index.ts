/**
 * Existence d'un slug publié, lue directement en base (sans cache Next) :
 * utilisée par le proxy, hors du contexte de rendu. Requête minuscule
 * (quelques lignes), sûre à chaque requête. `includeDrafts` : pages non
 * publiées aussi (aperçu de l'admin ; la page vérifie ensuite draft mode ET
 * session avant de les rendre).
 */
import { eq } from "drizzle-orm";

import { getDb, schema } from "./db";
import { parseJson } from "./json";

/** Slug réservé de la page 404 (jamais un slug de page : « _ » interdit en tête). */
export const NOT_FOUND_SLUG = "_404";

export function publishedSlugExists(locale: string, slug: string, { includeDrafts = false } = {}): boolean {
  const query = getDb().select({ slug: schema.pages.slug }).from(schema.pages);
  const rows = includeDrafts ? query.all() : query.where(eq(schema.pages.published, true)).all();
  return rows.some((r) => {
    const value = (typeof r.slug === "string" ? parseJson(r.slug) : r.slug) as Record<string, string> | undefined;
    return (value?.[locale] ?? "") === slug;
  });
}
