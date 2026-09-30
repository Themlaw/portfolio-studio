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

type FontEntry = {
  /** Classe next/font qui déclare la variable CSS. */
  className: string;
  /** Pile complète : police auto-hébergée + repli système. */
  stack: string;
  /** Graisse des titres quand la police sert de display. */
  headingWeight: number;
};

export const FONT_CATALOG: Record<FontId, FontEntry> = {
  "young-serif": {
    className: youngSerif.variable,
    stack: 'var(--font-young-serif), Georgia, "Times New Roman", serif',
    headingWeight: 400,
  },
  figtree: {
    className: figtree.variable,
    stack: "var(--font-figtree), ui-sans-serif, system-ui, sans-serif",
    headingWeight: 600,
  },
  "spline-sans-mono": {
    className: splineSansMono.variable,
    stack: "var(--font-spline-mono), ui-monospace, SFMono-Regular, monospace",
    headingWeight: 400,
  },
  "bricolage-grotesque": {
    className: bricolage.variable,
    stack: "var(--font-bricolage), ui-sans-serif, system-ui, sans-serif",
    headingWeight: 700,
  },
  "chelsea-market": {
    className: chelseaMarket.variable,
    stack: 'var(--font-chelsea-market), "Comic Sans MS", cursive',
    headingWeight: 400,
  },
  caveat: {
    className: caveat.variable,
    stack: 'var(--font-caveat), "Segoe Print", "Bradley Hand", cursive',
    headingWeight: 600,
  },
};

/** Toutes les classes de variables, à poser sur <html>. */
export const FONT_VARIABLE_CLASSES = Object.values(FONT_CATALOG)
  .map((f) => f.className)
  .join(" ");
