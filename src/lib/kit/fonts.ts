/**
 * Polices du catalogue embarquées pour l'export du kit (public/kit/fonts/,
 * toutes en OFL, licences à côté) : la signature pré-remplie est le nom du
 * site rendu dans la police de titre du thème, à sa graisse de titre, comme
 * le site l'affiche. Rendu par sharp (Pango) depuis le fichier : aucune police
 * système (image distroless). Instances statiques (Google Fonts).
 */
import type { FontId } from "@/themes/schema";

/** Fichier (dans public/kit/fonts) et description Pango (famille + style). */
export const KIT_FONTS: Record<FontId, { file: string; pango: string }> = {
  "young-serif": { file: "YoungSerif.ttf", pango: "Young Serif" },
  figtree: { file: "Figtree-SemiBold.ttf", pango: "Figtree SemiBold" },
  "spline-sans-mono": { file: "SplineSansMono.ttf", pango: "Spline Sans Mono" },
  "bricolage-grotesque": { file: "BricolageGrotesque-Bold.ttf", pango: "Bricolage Grotesque Bold" },
  "chelsea-market": { file: "ChelseaMarket.ttf", pango: "Chelsea Market" },
  caveat: { file: "Caveat-SemiBold.ttf", pango: "Caveat SemiBold" },
};
