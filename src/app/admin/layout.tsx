import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";

import JournalReporter from "@/components/admin/JournalReporter";
import { intlLocale } from "@/i18n/admin-lang";
import { getAdminLang, getClientMessages } from "@/i18n/admin-server";
import { FONT_VARIABLE_CLASSES } from "@/themes/fonts";

import "./admin.css";

/**
 * Racine de l'admin : sa propre page HTML, langue de l'interface FR / EN (lot 130, catalogues messages/admin.*.json), hors thème
 * public (tokens --admin-* de admin.css). Toujours rendue à la demande, jamais
 * indexée.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s — Admin" },
  robots: { index: false, follow: false },
};

// Variables de TOUTES les polices du catalogue : l'admin emploie les siennes
// (Figtree, Spline Sans Mono, Young Serif) ; les autres ne servent qu'aux
// échantillons et vignettes des thèmes et ne se téléchargent que là.
const FONTS = FONT_VARIABLE_CLASSES;

export default async function AdminRootLayout({ children }: { children: React.ReactNode }) {
  // Lot 130 : langue de l'interface (réglage du compte, cookie, sinon français), indépendante de la langue du site public.
  const lang = await getAdminLang();
  const messages = await getClientMessages();
  return (
    <html lang={lang} className={FONTS}>
      <body className="admin">
        <NextIntlClientProvider locale={intlLocale(lang)} messages={messages as never} timeZone="Europe/Paris">
          <JournalReporter />
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
