/**
 * Données pures du catalogue de polices (sans next/font) : piles CSS, graisse
 * des titres, nom affiché. Importable côté client (éditeur de thème) et par
 * src/themes/css.ts ; src/themes/fonts.ts y ajoute les classes next/font.
 */
import type { FontId } from "./schema";

export type FontStack = {
  /** Nom affiché dans l'éditeur. */
  label: string;
  /** Pile complète : police auto-hébergée + repli système. */
  stack: string;
  /** Graisse des titres quand la police sert de display. */
  headingWeight: number;
};

export const FONT_STACKS: Record<FontId, FontStack> = {
  "young-serif": {
    label: "Young Serif",
    stack: 'var(--font-young-serif), Georgia, "Times New Roman", serif',
    headingWeight: 400,
  },
  figtree: {
    label: "Figtree",
    stack: "var(--font-figtree), ui-sans-serif, system-ui, sans-serif",
    headingWeight: 600,
  },
  "spline-sans-mono": {
    label: "Spline Sans Mono",
    stack: "var(--font-spline-mono), ui-monospace, SFMono-Regular, monospace",
    headingWeight: 400,
  },
  "bricolage-grotesque": {
    label: "Bricolage Grotesque",
    stack: "var(--font-bricolage), ui-sans-serif, system-ui, sans-serif",
    headingWeight: 700,
  },
  "chelsea-market": {
    label: "Chelsea Market",
    stack: 'var(--font-chelsea-market), "Comic Sans MS", cursive',
    headingWeight: 400,
  },
  caveat: {
    label: "Caveat",
    stack: 'var(--font-caveat), "Segoe Print", "Bradley Hand", cursive',
    headingWeight: 600,
  },
  kalam: {
    label: "Kalam",
    stack: 'var(--font-kalam), "Segoe Print", "Bradley Hand", cursive',
    headingWeight: 700,
  },
  "courier-prime": {
    label: "Courier Prime",
    stack: 'var(--font-courier-prime), "Courier New", ui-monospace, monospace',
    headingWeight: 700,
  },
  "big-shoulders": {
    label: "Big Shoulders",
    stack: 'var(--font-big-shoulders), "Arial Narrow", ui-sans-serif, sans-serif',
    headingWeight: 800,
  },
  "ibm-plex-sans": {
    label: "IBM Plex Sans",
    stack: "var(--font-ibm-plex-sans), ui-sans-serif, system-ui, sans-serif",
    headingWeight: 600,
  },
  "ibm-plex-mono": {
    label: "IBM Plex Mono",
    stack: "var(--font-ibm-plex-mono), ui-monospace, SFMono-Regular, monospace",
    headingWeight: 500,
  },
  "inter-tight": {
    label: "Inter Tight",
    stack: "var(--font-inter-tight), ui-sans-serif, system-ui, sans-serif",
    headingWeight: 600,
  },
  "bowlby-one": {
    label: "Bowlby One",
    stack: 'var(--font-bowlby-one), Impact, "Arial Black", sans-serif',
    headingWeight: 400,
  },
  "space-grotesk": {
    label: "Space Grotesk",
    stack: "var(--font-space-grotesk), ui-sans-serif, system-ui, sans-serif",
    headingWeight: 600,
  },
};
