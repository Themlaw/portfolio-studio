/**
 * Catalogue de polices (next/font/google, auto-hébergées, sans CLS).
 *
 * Un thème choisit ses polices par id dans ce catalogue. Toutes les variables
 * `--font-xxx` sont posées sur <html> (pas sur <body> : les tokens
 * `--t-font-*` sont déclarés sur :root et doivent les résoudre au même niveau).
 *
 * next/font exige des appels littéraux au niveau module : `preload` est donc
 * fixé ici. Seules les polices du thème par défaut sont préchargées ; les
 * autres se téléchargent à la demande quand un thème les utilise.
 */
import {
  Big_Shoulders,
  Bowlby_One,
  Bricolage_Grotesque,
  Caveat,
  Chelsea_Market,
  Courier_Prime,
  Figtree,
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  Inter_Tight,
  Kalam,
  Space_Grotesk,
  Spline_Sans_Mono,
  Young_Serif,
} from "next/font/google";

import { FONT_STACKS, type FontStack } from "./font-stacks";
import type { FontId } from "./schema";

const youngSerif = Young_Serif({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  variable: "--font-young-serif",
});

const figtree = Figtree({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-figtree",
});

const splineSansMono = Spline_Sans_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-spline-mono",
});

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["400", "700"],
  display: "swap",
  preload: false,
  variable: "--font-bricolage",
});

const chelseaMarket = Chelsea_Market({
  subsets: ["latin"],
  weight: "400",
  display: "swap",
  preload: false,
  variable: "--font-chelsea-market",
});

const caveat = Caveat({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-caveat",
});

// Polices des thèmes livrés v0.14 : jamais préchargées (téléchargées seulement
// quand le thème affiché les utilise).
const kalam = Kalam({ subsets: ["latin"], weight: ["400", "700"], display: "swap", preload: false, variable: "--font-kalam" });
const courierPrime = Courier_Prime({ subsets: ["latin"], weight: ["400", "700"], display: "swap", preload: false, variable: "--font-courier-prime" });
const bigShoulders = Big_Shoulders({ subsets: ["latin"], weight: ["600", "800"], display: "swap", preload: false, variable: "--font-big-shoulders" });
const ibmPlexSans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "600"], display: "swap", preload: false, variable: "--font-ibm-plex-sans" });
const ibmPlexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], display: "swap", preload: false, variable: "--font-ibm-plex-mono" });
const interTight = Inter_Tight({ subsets: ["latin"], weight: ["400", "600"], display: "swap", preload: false, variable: "--font-inter-tight" });
const bowlbyOne = Bowlby_One({ subsets: ["latin"], weight: "400", display: "swap", preload: false, variable: "--font-bowlby-one" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], weight: ["400", "600"], display: "swap", preload: false, variable: "--font-space-grotesk" });

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
