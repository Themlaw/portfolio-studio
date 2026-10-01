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
};
