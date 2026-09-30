/**
 * Pages et blocs. Les slugs sont localisés et viennent de la base :
 * « / » + slug[locale] est le chemin de la page, sans préfixe de langue
 * (le Link de next-intl l'ajoute).
 */
import { asc, eq } from "drizzle-orm";

import { routing, type AppLocale } from "@/i18n/routing";

import { cached, TAGS } from "./cache";
import { getDb, schema } from "./db";
import { parseJson } from "./json";

type L = { fr: string; en: string };

export type PageSummary = {
  id: number;
  slug: L;
  title: L;
  meta: { title: L; description: L } | null;
  navOrder: number | null;
};

/** Bloc lu en base. `props` vaut undefined si le JSON stocké est corrompu. */
export type RawBlock = { id: number; type: string; props: unknown; corrupt: boolean };

export type NavItem = { id: number; href: string; label: string };

/** Pages publiées (sans leurs blocs). */
export async function getPageIndex(): Promise<PageSummary[]> {
  return cached(["pages-index"], [TAGS.nav], () =>
    getDb()
      .select({
        id: schema.pages.id,
        slug: schema.pages.slug,
        title: schema.pages.title,
        meta: schema.pages.meta,
        navOrder: schema.pages.navOrder,
      })
      .from(schema.pages)
      .where(eq(schema.pages.published, true))
      .orderBy(asc(schema.pages.id))
      .all(),
  );
}

export function pagePath(page: PageSummary, locale: AppLocale): string {
  const slug = page.slug[locale] ?? page.slug.fr;
  return slug ? `/${slug}` : "/";
}

/** Chemin complet avec préfixe de langue, ex. /en/characters. */
export function localizedPath(page: PageSummary, locale: AppLocale): string {
  const p = pagePath(page, locale);
  return p === "/" ? `/${locale}` : `/${locale}${p}`;
}

/**
 * Page publiée pour un chemin localisé (segments du catch-all). Les segments
 * arrivent déjà décodés par Next : pas de second décodage (/fr/%2570… ≠ /fr/p…).
 */
export async function findPage(locale: AppLocale, segments: string[] = []): Promise<PageSummary | null> {
  const wanted = segments.join("/");
  const index = await getPageIndex();
  return index.find((p) => (p.slug[locale] ?? "") === wanted) ?? null;
}

export async function getPageById(id: number): Promise<PageSummary | null> {
  return (await getPageIndex()).find((p) => p.id === id) ?? null;
}

/** Chemin (sans langue) d'une page référencée par un bloc ; "/" si introuvable. */
export async function hrefForPage(id: number | undefined, locale: AppLocale): Promise<string> {
  const page = id ? await getPageById(id) : null;
  return page ? pagePath(page, locale) : "/";
}

export async function getPageBlocks(id: number): Promise<RawBlock[]> {
  return cached([`page-blocks:${id}`], [TAGS.page(id)], () =>
    getDb()
      .select({ id: schema.blocks.id, type: schema.blocks.type, props: schema.blocks.props })
      .from(schema.blocks)
      .where(eq(schema.blocks.pageId, id))
      .orderBy(asc(schema.blocks.position))
      .all()
      .map((row) => {
        const props = parseJson(row.props);
        return { id: row.id, type: row.type, props, corrupt: props === undefined };
      }),
  );
}

export async function getNav(locale: AppLocale): Promise<NavItem[]> {
  return (await getPageIndex())
    .filter((p) => p.navOrder !== null)
    .sort((a, b) => (a.navOrder ?? 0) - (b.navOrder ?? 0))
    .map((p) => ({ id: p.id, href: pagePath(p, locale), label: p.title[locale] ?? p.title.fr }));
}

/** Chemins de la même page dans chaque langue (sélecteur de langue, hreflang). */
export function alternatesFor(page: PageSummary | null): Record<AppLocale, string> {
  return Object.fromEntries(
    routing.locales.map((l) => [l, page ? pagePath(page, l) : "/"]),
  ) as Record<AppLocale, string>;
}
