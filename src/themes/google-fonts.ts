/**
 * Catalogue statique des familles Google Fonts (src/themes/google-fonts.json,
 * régénéré par scripts/gen-google-fonts.mjs). Module pur : lu par les schémas
 * (une police citée doit être du catalogue), l'éditeur (menu des polices) et
 * le serveur (téléchargement, src/lib/fonts/library.ts). Aucune requête vers
 * Google n'en dépend.
 */
import RAW from "./google-fonts.json";

export type GoogleCategory = "sans" | "serif" | "display" | "handwriting" | "mono";
export type GoogleFamily = {
  family: string;
  category: GoogleCategory;
  /** Graisses droites disponibles (100…900). */
  weights: number[];
  /** Graisses italiques disponibles. */
  italics: number[];
  latinExt: boolean;
};

const CATS: Record<string, GoogleCategory> = { s: "sans", r: "serif", d: "display", h: "handwriting", m: "mono" };
const digits = (s: unknown) => (typeof s === "string" ? [...s].map((c) => Number(c) * 100) : []);

export const GOOGLE_FONTS: GoogleFamily[] = (RAW as unknown[][]).map((e) => ({
  family: String(e[0]),
  category: CATS[String(e[1])] ?? "sans",
  weights: digits(e[2]),
  italics: digits(e[3]),
  latinExt: e[4] !== 0,
}));

const BY_NAME = new Map(GOOGLE_FONTS.map((f) => [f.family, f]));

export function googleFamily(name: string): GoogleFamily | undefined {
  return BY_NAME.get(name);
}

export function isGoogleFamily(name: string): boolean {
  return BY_NAME.has(name);
}

/** Pile de repli système par catégorie (avant le chargement, ou si un fichier manque). */
export const CATEGORY_FALLBACK: Record<GoogleCategory, string> = {
  sans: "ui-sans-serif, system-ui, sans-serif",
  serif: 'Georgia, "Times New Roman", serif',
  display: "ui-sans-serif, system-ui, sans-serif",
  handwriting: "cursive",
  mono: "ui-monospace, monospace",
};

export const CATEGORY_LABELS: Record<GoogleCategory, string> = {
  sans: "Sans empattement",
  serif: "Avec empattement",
  display: "Fantaisie",
  handwriting: "Manuscrite",
  mono: "Chasse fixe",
};

/** Graisse disponible la plus proche (une famille n'a pas toujours le 400). */
export function nearestWeight(f: GoogleFamily, weight: number, italic: boolean): number {
  const list = italic && f.italics.length ? f.italics : f.weights;
  return list.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), list[0] ?? 400);
}
