import type { MetadataRoute } from "next";

import { routing } from "@/i18n/routing";
import { getPageIndex, localizedPath } from "@/lib/pages";
import { publicBase } from "@/lib/seo";
import { isSpecialPage } from "@/lib/special-pages";

/** Lu à chaque demande (base de données) ; la liste des pages est en cache, invalidée à la publication. */
export const dynamic = "force-dynamic";

/** Plan du site : pages publiées, dans toutes les langues, avec leurs équivalents (hreflang). */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = publicBase();
  const pages = await getPageIndex();
  // Les pages spéciales (« Page introuvable », lot 89) ne sont pas des adresses à indexer.
  return pages.filter((page) => !isSpecialPage(page)).flatMap((page) => {
    const languages = Object.fromEntries(routing.locales.map((l) => [l, `${base}${localizedPath(page, l)}`]));
    return routing.locales.map((locale) => ({ url: `${base}${localizedPath(page, locale)}`, alternates: { languages } }));
  });
}
