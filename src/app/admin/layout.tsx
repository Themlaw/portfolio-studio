import type { Metadata } from "next";

import JournalReporter from "@/components/admin/JournalReporter";
import { FONT_VARIABLE_CLASSES } from "@/themes/fonts";

import "./admin.css";

/**
 * Racine de l'admin : sa propre page HTML, en français, hors i18n et hors thème
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

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={FONTS}>
      <body className="admin">
        <JournalReporter />
        {children}
      </body>
    </html>
  );
}
