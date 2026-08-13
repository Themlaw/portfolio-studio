import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Figtree, Spline_Sans_Mono, Young_Serif } from "next/font/google";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import { routing, type AppLocale } from "@/i18n/routing";
import "../globals.css";

const display = Young_Serif({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  variable: "--font-young-serif",
});

const body = Figtree({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-figtree",
});

const caption = Spline_Sans_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-spline-mono",
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "home.meta" });

  return {
    title: { default: t("title"), template: "%s" },
    description: t("description"),
  };
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

  return (
    // Les variables de next/font sont posees sur <html> : les tokens
    // --font-display / --font-body / --font-caption sont declares sur :root
    // et doivent pouvoir resoudre var(--font-young-serif) au meme niveau.
    <html
      lang={locale}
      className={`${display.variable} ${body.variable} ${caption.variable}`}
    >
      <body className="bg-bg text-ink antialiased">
        <NextIntlClientProvider>
          <a
            href="#contenu"
            className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:bg-surface focus:px-4 focus:py-2 focus:rounded-md focus:shadow-card"
          >
            {locale === "fr" ? "Aller au contenu" : "Skip to content"}
          </a>
          <SiteHeader />
          <main id="contenu">{children}</main>
          <SiteFooter />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
