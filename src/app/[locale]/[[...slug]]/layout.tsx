import { setRequestLocale } from "next-intl/server";

import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import type { AppLocale } from "@/i18n/routing";
import { isDraftView } from "@/lib/draft-view";
import { resolvePage } from "@/lib/page-preview";
import { alternatesFor, getNav } from "@/lib/pages";
import { getSiteView } from "@/lib/settings";

/**
 * Cadre du site (en-tête, contenu, pied), construit depuis la base : menu
 * (réglage `nav`), identité et réseaux (réglages) et chemins de la page
 * courante dans chaque langue pour le sélecteur de langue. Vue brouillon de
 * l'éditeur : le brouillon de l'en-tête porté par cette page, et les repères
 * d'édition (en-tête et pied communs à toutes les pages).
 */
export default async function SiteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string; slug?: string[] }>;
}) {
  const { locale: raw, slug } = await params;
  const locale = raw as AppLocale;
  setRequestLocale(locale);

  const [page, edit] = await Promise.all([resolvePage(locale, slug), isDraftView()]);
  const view = await getSiteView(locale, page?.id);
  const nav = await getNav(locale, view.draft ? view.nav : undefined);

  return (
    <>
      <SiteHeader siteName={view.site.name} nav={nav} alternates={alternatesFor(page)} edit={edit} />
      <main id="contenu">{children}</main>
      <SiteFooter site={view.site} nav={nav} socials={view.socials} edit={edit} />
    </>
  );
}
