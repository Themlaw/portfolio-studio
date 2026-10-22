/**
 * Pages et blocs. Les slugs sont localisés et viennent de la base :
 * « / » + slug[locale] est le chemin de la page, sans préfixe de langue
 * (le Link de next-intl l'ajoute).
 */
import { and, asc, eq, isNull } from "drizzle-orm";

import { routing, type AppLocale } from "@/i18n/routing";

import { cached, TAGS } from "./cache";
import { getDb, schema } from "./db";
import { parseJson } from "./json";
import { getNavSetting } from "./settings";
import type { NavItem as SiteNavItem } from "./site-schema";

type L = { fr: string; en: string };

export type PageSummary = {
  id: number;
  slug: L;
  title: L;
  meta: { title: L; description: L; /** Image de partage choisie pour la page (média), lot 52. */ image?: number | null } | null;
  navOrder: number | null;
  /** Collection que la page présente (réglage « Cette page est la collection »), ou null. */
  collection: string | null;
  /** Surcharges de tokens de la page (accent : { primary }). */
  themeOverrides?: unknown;
};

/**
 * Bloc lu en base. `props` vaut undefined si le JSON stocké est corrompu.
 * `uid` : identifiant stable du bloc dans un brouillon (vue brouillon de
 * l'éditeur visuel).
 */
export type RawBlock = { id: number; type: string; props: unknown; corrupt: boolean; uid?: string };

/** Lien du menu : `id` (clé stable), `pageId` pour une page du site, `external` pour une adresse hors site. */
export type NavItem = { id: string; href: string; label: string; pageId?: number; external?: boolean };

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
        collection: schema.pages.collection,
        themeOverrides: schema.pages.themeOverrides,
      })
      .from(schema.pages)
      .where(and(eq(schema.pages.published, true), isNull(schema.pages.deletedAt)))
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

/**
 * Menu : le réglage `nav` (liens ordonnés, v0.13) s'il existe — sinon les
 * pages du menu (nav_order). `items` : un menu de brouillon (vue brouillon).
 * Une page non publiée ou disparue n'y figure jamais.
 */
export async function getNav(locale: AppLocale, items?: SiteNavItem[] | null): Promise<NavItem[]> {
  const index = await getPageIndex();
  const list = items !== undefined ? items : await getNavSetting();
  if (!list) {
    return index
      .filter((p) => p.navOrder !== null)
      .sort((a, b) => (a.navOrder ?? 0) - (b.navOrder ?? 0))
      .map((p) => ({ id: `p${p.id}`, pageId: p.id, href: pagePath(p, locale), label: p.title[locale] ?? p.title.fr }));
  }
  const out: NavItem[] = [];
  list.forEach((item, i) => {
    if (item.kind === "page") {
      const p = index.find((x) => x.id === item.pageId);
      if (!p) return;
      out.push({ id: `p${p.id}`, pageId: p.id, href: pagePath(p, locale), label: item.label?.[locale] || item.label?.fr || p.title[locale] || p.title.fr });
    } else {
      out.push({ id: `l${i}`, href: item.href, label: item.label[locale] || item.label.fr, external: !item.href.startsWith("/") });
    }
  });
  return out;
}

/** Chemins de la même page dans chaque langue (sélecteur de langue, hreflang). */
export function alternatesFor(page: PageSummary | null): Record<AppLocale, string> {
  return Object.fromEntries(
    routing.locales.map((l) => [l, page ? pagePath(page, l) : "/"]),
  ) as Record<AppLocale, string>;
}

/** Accent d'une page (couleur #rrggbb validée à l'enregistrement), ou null. */
export function pageAccent(page: PageSummary): string | null {
  const o = page.themeOverrides as { primary?: unknown } | null | undefined;
  return typeof o?.primary === "string" && /^#[0-9a-fA-F]{6}$/.test(o.primary) ? o.primary : null;
}
