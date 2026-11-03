import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";

import { getTranslations } from "next-intl/server";

import BlockList from "@/blocks/BlockList";
import { BLOCKS } from "@/blocks/registry";
import NotFoundView from "@/components/NotFoundView";
import { Link } from "@/i18n/navigation";
import { own } from "@/lib/own";
import { isSpecialPage } from "@/lib/special-pages";
import type { AppLocale } from "@/i18n/routing";
import { getDraftBlocks, getDraftPageInfo, getDraftRev, isDraftView, setDraftViewPage } from "@/lib/draft-view";
import { resolvePage } from "@/lib/page-preview";
import { getPageBlocks, pageAccent } from "@/lib/pages";
import { hoverShade } from "@/themes/contrast";
import { pageSocialMetadata } from "@/lib/seo";
import { getSeoSettings, getSite } from "@/lib/settings";

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
  // Page « Page introuvable » (lot 89) : mêmes métadonnées que la 404 d'avant (titre fixe, noindex, ni adresse canonique ni balises de partage).
  if (!page || isSpecialPage(page)) {
    // Page 404 (servie par le proxy avec le statut 404).
    const [t, site] = await Promise.all([getTranslations({ locale, namespace: "notFound" }), getSite(locale)]);
    return { title: `${t("title")} — ${site.name}`, robots: { index: false, follow: true } };
  }
  // Vue brouillon : titre et méta du brouillon (jamais hors draft mode).
  const draft = (await isDraftView()) ? getDraftPageInfo(page.id) : null;
  const meta = draft ? draft.meta : page.meta;
  const title = draft ? draft.title : page.title;
  // Titre d'onglet « Page — Nom du site », description (page, sinon site) et balises de partage (lot 52).
  const [site, seo] = await Promise.all([getSite(locale), getSeoSettings()]);
  const isHome = !page.slug.fr && !page.slug.en;
  return pageSocialMetadata({
    page: draft ? { ...page, meta: draft.meta } : page,
    locale,
    title: meta?.title[locale] || (isHome ? "" : title[locale]),
    description: meta?.description[locale] || "",
    siteName: site.name,
    seo,
  });
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
  // Page « Page introuvable » (lot 89) : le proxy en garde le statut 404, noindex et no-store. Si elle n'a rien à montrer (aucun bloc lisible : page
  // vide, blocs corrompus ou invalides), la 404 d'origine s'affiche : jamais de page blanche. Sur la toile de l'éditeur, la page vide reste éditable.
  const special = isSpecialPage(page);
  const renderable = blocks.filter((b) => !b.corrupt && own(BLOCKS, b.type)?.schema.safeParse(b.props).success);
  if (special && !draftView && renderable.length === 0) return <NotFoundView />;
  // Filet : sans bloc « Sortie » lisible (données anciennes, restauration), un bouton « Retour à l'accueil » est ajouté après les blocs.
  const needsExit = special && !draftView && !renderable.some((b) => b.type === "exit");
  const back = needsExit ? await getTranslations({ locale, namespace: "notFound" }) : null;
  // Vue brouillon : repère de la révision rendue (invisible), lu par la couche d'édition de la toile.
  const rev = draftView ? getDraftRev(page.id) : null;
  const list = (
    <>
      <BlockList blocks={blocks} ctx={{ locale, pageId: page.id, edit: draftView }} />
      {rev !== null && <span hidden data-edit-rev={rev} />}
      {back && (
        <section className="shell pt-[var(--section-gap)]" data-exit-fallback="">
          <Link href="/" className="btn">
            {back("back")}
            <span aria-hidden="true">→</span>
          </Link>
        </section>
      )}
    </>
  );
  const draftInfo = draftView ? getDraftPageInfo(page.id) : null;
  const accent = draftInfo ? draftInfo.accent : pageAccent(page);
  if (!accent) return list;
  // Lisibilité (lot 29) : jamais bloquante, la couleur choisie est toujours appliquée (l'éditeur avertit).
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
