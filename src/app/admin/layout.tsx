import type { Metadata } from "next";

import { FONT_CATALOG } from "@/themes/fonts";

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

const FONTS = [FONT_CATALOG.figtree, FONT_CATALOG["spline-sans-mono"], FONT_CATALOG["young-serif"]]
  .map((f) => f.className)
  .join(" ");

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={FONTS}>
      <body className="admin">{children}</body>
    </html>
  );
}
