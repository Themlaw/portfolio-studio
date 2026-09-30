import { setRequestLocale } from "next-intl/server";

import SiteFooter from "@/components/SiteFooter";
import SiteHeader from "@/components/SiteHeader";
import type { AppLocale } from "@/i18n/routing";
import { alternatesFor, findPage, getNav } from "@/lib/pages";
import { getSite, getSocials } from "@/lib/settings";

/**
 * Cadre du site (en-tête, contenu, pied), construit depuis la base : menu
 * (pages.nav_order), identité (réglages) et chemins de la page courante dans
 * chaque langue pour le sélecteur de langue.
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

  const [page, nav, site, socials] = await Promise.all([
    findPage(locale, slug),
    getNav(locale),
    getSite(locale),
    getSocials(),
  ]);

  return (
    <>
      <SiteHeader siteName={site.name} nav={nav} alternates={alternatesFor(page)} />
      <main id="contenu">{children}</main>
      <SiteFooter site={site} nav={nav} socials={socials} />
    </>
  );
}
