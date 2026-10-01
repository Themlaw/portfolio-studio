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
  Bricolage_Grotesque,
  Caveat,
  Chelsea_Market,
  Figtree,
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
};

export const FONT_CATALOG = Object.fromEntries(
  (Object.keys(FONT_STACKS) as FontId[]).map((id) => [id, { ...FONT_STACKS[id], className: CLASSES[id] }]),
) as Record<FontId, FontEntry>;

/** Toutes les classes de variables, à poser sur <html>. */
export const FONT_VARIABLE_CLASSES = Object.values(CLASSES).join(" ");
