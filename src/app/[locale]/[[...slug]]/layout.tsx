import { setRequestLocale } from "next-intl/server";

import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import type { AppLocale } from "@/i18n/routing";
import { isDraftView } from "@/lib/draft-view";
import { resolvePage } from "@/lib/page-preview";
import { alternatesFor, getNav } from "@/lib/pages";
import { siteStylesCss } from "@/lib/look";
import { getFontFacesCss, getSiteView } from "@/lib/settings";

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
  const [nav, fontFaces] = await Promise.all([getNav(locale, view.draft ? view.nav : undefined), getFontFacesCss()]);
  // Styles du site (lot 2) : polices téléchargées (servies par /fonts) et
  // styles des textes par rôle ; vue brouillon : ceux du brouillon du site.
  const siteCss = [fontFaces, siteStylesCss(view.styles)].filter(Boolean).join("\n");

  return (
    // Cadre pleine hauteur (v0.13.1) : le contenu s'étire, le pied reste en bas
    // de l'écran même sur une page courte (`.site-frame`, globals.css).
    <div className="site-frame">
      {(siteCss || edit) && <style id="site-styles" dangerouslySetInnerHTML={{ __html: siteCss }} {...(edit ? { "data-edit-styles": JSON.stringify(view.styles ?? {}) } : {})} />}
      <SiteHeader siteName={view.site.name} nav={nav} alternates={alternatesFor(page)} socials={view.site.headerSocials ? view.socials : []} edit={edit} />
      <main id="contenu">{children}</main>
      <SiteFooter site={view.site} nav={nav} socials={view.socials} edit={edit} />
    </div>
  );
}
