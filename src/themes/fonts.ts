/**
 * Catalogue de polices (next/font/local, fichiers du dépôt, sans CLS).
 *
 * Un thème choisit ses polices par id dans ce catalogue. Toutes les variables
 * `--font-xxx` sont posées sur <html> (pas sur <body> : les tokens
 * `--t-font-*` sont déclarés sur :root et doivent les résoudre au même niveau).
 *
 * Fichiers : src/themes/fonts/*.woff2 (OFL, sous-ensemble latin + latin-ext,
 * graisses utilisées ; polices variables réduites à l'axe wght), produits par
 * scripts/build-theme-fonts.py. AUCUN accès réseau au build : next/font/google
 * cassait le build quand Google change les adresses de ses fichiers
 * (« Module not found … font/google/inter_tight_… »).
 *
 * next/font exige des appels littéraux au niveau module : `preload` est donc
 * fixé ici. Seules les polices du thème par défaut sont préchargées ; les
 * autres se téléchargent à la demande quand un thème les utilise.
 */
import localFont from "next/font/local";

import { FONT_STACKS, type FontStack } from "./font-stacks";
import type { FontId } from "./schema";

const youngSerif = localFont({ src: [{ path: "./fonts/young-serif-400.woff2", weight: "400", style: "normal" }], display: "swap", variable: "--font-young-serif" });
const figtree = localFont({ src: [{ path: "./fonts/figtree-var.woff2", weight: "300 900", style: "normal" }], display: "swap", variable: "--font-figtree" });
const splineSansMono = localFont({ src: [{ path: "./fonts/spline-sans-mono-var.woff2", weight: "300 700", style: "normal" }], display: "swap", variable: "--font-spline-mono" });
const bricolage = localFont({ src: [{ path: "./fonts/bricolage-grotesque-var.woff2", weight: "400 700", style: "normal" }], display: "swap", preload: false, variable: "--font-bricolage" });
const chelseaMarket = localFont({ src: [{ path: "./fonts/chelsea-market-400.woff2", weight: "400", style: "normal" }], display: "swap", preload: false, variable: "--font-chelsea-market" });
const caveat = localFont({ src: [{ path: "./fonts/caveat-var.woff2", weight: "400 700", style: "normal" }], display: "swap", preload: false, variable: "--font-caveat" });

// Polices des thèmes livrés v0.14 : jamais préchargées (téléchargées seulement
// quand le thème affiché les utilise).
const kalam = localFont({
  src: [
    { path: "./fonts/kalam-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/kalam-700.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  preload: false,
  variable: "--font-kalam",
});
const courierPrime = localFont({
  src: [
    { path: "./fonts/courier-prime-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/courier-prime-700.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  preload: false,
  variable: "--font-courier-prime",
});
const bigShoulders = localFont({ src: [{ path: "./fonts/big-shoulders-var.woff2", weight: "600 800", style: "normal" }], display: "swap", preload: false, variable: "--font-big-shoulders" });
const ibmPlexSans = localFont({ src: [{ path: "./fonts/ibm-plex-sans-var.woff2", weight: "400 600", style: "normal" }], display: "swap", preload: false, variable: "--font-ibm-plex-sans" });
const ibmPlexMono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-500.woff2", weight: "500", style: "normal" },
  ],
  display: "swap",
  preload: false,
  variable: "--font-ibm-plex-mono",
});
const interTight = localFont({ src: [{ path: "./fonts/inter-tight-var.woff2", weight: "400 600", style: "normal" }], display: "swap", preload: false, variable: "--font-inter-tight" });
const bowlbyOne = localFont({ src: [{ path: "./fonts/bowlby-one-400.woff2", weight: "400", style: "normal" }], display: "swap", preload: false, variable: "--font-bowlby-one" });
const spaceGrotesk = localFont({ src: [{ path: "./fonts/space-grotesk-var.woff2", weight: "400 600", style: "normal" }], display: "swap", preload: false, variable: "--font-space-grotesk" });

type FontEntry = FontStack & {
  /** Classe next/font qui déclare la variable CSS. */
  className: string;
};

const CLASSES: Record<FontId, string> = {
  "young-serif": youngSerif.variable,
  figtree: figtree.variable,
  "spline-sans-mono": splineSansMono.variable,
  "bricolage-grotesque": bricolage.variable,
  "chelsea-market": chelseaMarket.variable,
  caveat: caveat.variable,
  kalam: kalam.variable,
  "courier-prime": courierPrime.variable,
  "big-shoulders": bigShoulders.variable,
  "ibm-plex-sans": ibmPlexSans.variable,
  "ibm-plex-mono": ibmPlexMono.variable,
  "inter-tight": interTight.variable,
  "bowlby-one": bowlbyOne.variable,
  "space-grotesk": spaceGrotesk.variable,
};

export const FONT_CATALOG = Object.fromEntries(
  (Object.keys(FONT_STACKS) as FontId[]).map((id) => [id, { ...FONT_STACKS[id], className: CLASSES[id] }]),
) as Record<FontId, FontEntry>;

/** Toutes les classes de variables, à poser sur <html>. */
export const FONT_VARIABLE_CLASSES = Object.values(CLASSES).join(" ");
