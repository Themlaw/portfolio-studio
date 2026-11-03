import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";

import EditThisPage from "@/components/EditThisPage";
import LangScrollRestore from "@/components/LangScrollRestore";
import PreviewBanner from "@/components/PreviewBanner";
import { routing, type AppLocale } from "@/i18n/routing";
import { isBuildPhase } from "@/lib/cache";
import { themeTypeCss } from "@/lib/look";
import { iconLinks, manifestUrl, planIcon } from "@/lib/favicon-plan";
import { getSeoSettings, getSite } from "@/lib/settings";
import { getActiveTheme, getPublishedTheme } from "@/lib/theme";
import { themeAttributes, themeToCss } from "@/themes/css";
import { FONT_VARIABLE_CLASSES } from "@/themes/fonts";
import "../globals.css";
import "../look.css";
import "../media-frame.css";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

const DEFAULT_BASE_URL = "http://localhost:3001";

/** URL publique (PUBLIC_BASE_URL) : canonical et hreflang deviennent absolus. */
export async function generateMetadata(): Promise<Metadata> {
  let base: URL;
  try {
    base = new URL(process.env.PUBLIC_BASE_URL || DEFAULT_BASE_URL);
  } catch {
    base = new URL(DEFAULT_BASE_URL);
  }
  // Icône de l'onglet (lots 52 et 83) : l'image choisie, sinon le logo ou le monogramme du thème EN LIGNE ; jamais une icône d'origine.
  // Le plan ne décode rien (empreinte seulement) ; les fichiers sont produits à la première requête (route /site-icon).
  if (isBuildPhase()) return { metadataBase: base };
  const [seo, theme, site] = await Promise.all([getSeoSettings(), getPublishedTheme(), getSite("fr")]);
  const plan = planIcon(seo, theme, site.name);
  return { metadataBase: base, icons: iconLinks(plan), manifest: manifestUrl(plan) };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale as AppLocale);
  const theme = await getActiveTheme();

  return (
    // Les variables de next/font sont posees sur <html> : les tokens
    // --t-font-* sont declares sur :root et doivent pouvoir resoudre
    // var(--font-young-serif) au meme niveau. Les data-* portent les
    // variantes de forme du theme (src/themes/variants.css).
    <html lang={locale} className={FONT_VARIABLE_CLASSES} {...themeAttributes(theme)}>
      <head>
        <style id="theme" dangerouslySetInnerHTML={{ __html: [themeToCss(theme), themeTypeCss(theme)].filter(Boolean).join("\n") }} />
      </head>
      <body className="bg-bg text-ink antialiased">
        <NextIntlClientProvider>
          <a
            href="#contenu"
            className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:bg-surface focus:px-4 focus:py-2 focus:rounded-md focus:shadow-card"
          >
            {locale === "fr" ? "Aller au contenu" : "Skip to content"}
          </a>
          {/* En-tête, <main> et pied : src/app/[locale]/[[...slug]]/layout.tsx
              (ils dépendent de la page courante, lue en base). */}
          {children}
          <PreviewBanner />
          {/* Client seulement : remet la page à sa place après un changement de langue (lot 87). */}
          <LangScrollRestore />
          {/* Client seulement : rien dans le HTML en cache (voir le composant). */}
          <EditThisPage />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
