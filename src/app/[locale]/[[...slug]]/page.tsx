import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";

import { getTranslations } from "next-intl/server";

import BlockList from "@/blocks/BlockList";
import NotFoundView from "@/components/NotFoundView";
import { routing, type AppLocale } from "@/i18n/routing";
import { findPage, getPageBlocks, localizedPath } from "@/lib/pages";
import { getSite } from "@/lib/settings";

/**
 * Route unique des pages publiques : la page est résolue par son slug
 * localisé en base, puis rendue bloc par bloc.
 *
 * Aucune page n'est générée au build (la base n'existe pas encore) : chaque
 * chemin est rendu à sa première visite puis servi depuis le cache (ISR à la
 * demande). Les lectures en base sont étiquetées (src/lib/cache.ts) et
 * invalidées par src/lib/revalidate.ts.
 */
export const dynamicParams = true;
export const revalidate = false;

export function generateStaticParams() {
  return [];
}

type Params = Promise<{ locale: string; slug?: string[] }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale: raw, slug } = await params;
  const locale = raw as AppLocale;
  const page = await findPage(locale, slug);
  if (!page) {
    // Page 404 (servie par le proxy avec le statut 404).
    const [t, site] = await Promise.all([getTranslations({ locale, namespace: "notFound" }), getSite(locale)]);
    return { title: `${t("title")} — ${site.name}`, robots: { index: false, follow: true } };
  }
  return {
    title: page.meta?.title[locale] ?? page.title[locale],
    description: page.meta?.description[locale],
    alternates: {
      canonical: localizedPath(page, locale),
      languages: Object.fromEntries(routing.locales.map((l) => [l, localizedPath(page, l)])),
    },
  };
}

export default async function Page({ params }: { params: Params }) {
  const { locale: raw, slug } = await params;
  const locale = raw as AppLocale;
  setRequestLocale(locale);

  const page = await findPage(locale, slug);
  // Slug inconnu : le proxy l'a déjà aiguillé vers la page 404 réservée
  // (statut 404). Rendue ici comme une page normale, elle profite du layout
  // (thème, en-tête, pied) et du cache ISR.
  if (!page) return <NotFoundView />;

  const blocks = await getPageBlocks(page.id);
  return <BlockList blocks={blocks} ctx={{ locale, pageId: page.id }} />;
}
