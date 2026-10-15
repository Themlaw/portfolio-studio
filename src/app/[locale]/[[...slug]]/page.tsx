import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";

import { getTranslations } from "next-intl/server";

import BlockList from "@/blocks/BlockList";
import NotFoundView from "@/components/NotFoundView";
import { routing, type AppLocale } from "@/i18n/routing";
import { getDraftBlocks, getDraftPageInfo, getDraftRev, isDraftView, setDraftViewPage } from "@/lib/draft-view";
import { resolvePage } from "@/lib/page-preview";
import { getPageBlocks, localizedPath, pageAccent } from "@/lib/pages";
import { getActiveTheme } from "@/lib/theme";
import { hoverShade } from "@/themes/contrast";
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
  const page = await resolvePage(locale, slug);
  if (!page) {
    // Page 404 (servie par le proxy avec le statut 404).
    const [t, site] = await Promise.all([getTranslations({ locale, namespace: "notFound" }), getSite(locale)]);
    return { title: `${t("title")} — ${site.name}`, robots: { index: false, follow: true } };
  }
  // Vue brouillon : titre et méta du brouillon (jamais hors draft mode).
  const draft = (await isDraftView()) ? getDraftPageInfo(page.id) : null;
  const meta = draft ? draft.meta : page.meta;
  const title = draft ? draft.title : page.title;
  return {
    title: meta?.title[locale] || title[locale],
    description: meta?.description[locale] || undefined,
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

  const page = await resolvePage(locale, slug);
  // Slug inconnu : le proxy l'a déjà aiguillé vers la page 404 réservée
  // (statut 404). Rendue ici comme une page normale, elle profite du layout
  // (thème, en-tête, pied) et du cache ISR.
  if (!page) return <NotFoundView />;

  // Vue brouillon de l'éditeur visuel (admin, draft mode, cookie dédié) : le
  // brouillon s'il existe, sinon la version publiée, blocs repérés par un uid
  // stable (b0, b1… comme l'éditeur les reprend). Jamais en cache public.
  const draftView = await isDraftView();
  if (draftView) setDraftViewPage(page.id);
  const blocks = draftView
    ? ((await getDraftBlocks(page.id)) ?? (await getPageBlocks(page.id)).map((b, i) => ({ ...b, uid: `b${i}` })))
    : await getPageBlocks(page.id);
  // Vue brouillon : repère de la révision rendue (invisible), lu par la couche d'édition de la toile.
  const rev = draftView ? getDraftRev(page.id) : null;
  const list = (
    <>
      <BlockList blocks={blocks} ctx={{ locale, pageId: page.id, edit: draftView }} />
      {rev !== null && <span hidden data-edit-rev={rev} />}
    </>
  );
  const draftInfo = draftView ? getDraftPageInfo(page.id) : null;
  const accent = draftInfo ? draftInfo.accent : pageAccent(page);
  if (!accent) return list;
  // Accent peu contrasté : appliqué quand même (avertissement seulement dans l'éditeur, v0.21.1).
  // Accent de page : surcharge des tokens primaires pour le contenu de la page
  // (display: contents → aucune boîte ajoutée, mise en page inchangée).
  const style = {
    "--t-color-primary": accent,
    "--color-primary": accent,
    "--t-color-primary-hover": hoverShade(accent),
    "--color-primary-hover": hoverShade(accent),
    display: "contents",
  } as React.CSSProperties;
  return <div style={style}>{list}</div>;
}
