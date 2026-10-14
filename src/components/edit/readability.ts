/**
 * Lisibilité d'un texte sur son fond, en mots (lot 24) : « bonne », « juste » ou « insuffisante ». Le rapport de contraste
 * (4,5:1…) reste disponible pour l'info-bulle : l'artiste lit un verdict, pas un nombre. Seuils : `need` (4,5 pour du texte courant,
 * 3 pour du grand texte) = « juste » ; 20 % de marge au-dessus = « bonne ». Module pur (testé par node).
 */
import { AA } from "@/themes/contrast";

export type Readability = { level: "good" | "fair" | "poor"; label: "bonne" | "juste" | "insuffisante" };

export function readability(ratio: number, need: number = AA): Readability {
  if (ratio >= need * 1.2) return { level: "good", label: "bonne" };
  if (ratio >= need) return { level: "fair", label: "juste" };
  return { level: "poor", label: "insuffisante" };
}

/** Rapport avec virgule française, une décimale (« 4,0 »). */
export const frRatio = (n: number) => n.toFixed(1).replace(".", ",");

/** « Lisibilité : bonne » */
export const readabilityText = (ratio: number, need: number = AA) => `Lisibilité : ${readability(ratio, need).label}`;

/**
 * Verdict d'un ensemble de paires texte / fond (une couleur de base, un jeton de palette) : « insuffisante » dès qu'une paire
 * échoue à SON seuil (3:1 pour du grand texte), sinon « bonne » ou « juste » selon la plus faible.
 */
export function pairsReadability(pairs: { ratio: number; ok: boolean }[]): Readability {
  if (pairs.some((p) => !p.ok)) return { level: "poor", label: "insuffisante" };
  const r = readability(Math.min(...pairs.map((p) => p.ratio)));
  return r.level === "poor" ? { level: "fair", label: "juste" } : r;
}

/** Info-bulle : le chiffre derrière le verdict. */
export const ratioTip = (ratio: number, need: number = AA) => `Contraste ${frRatio(ratio)}:1 (il faut au moins ${frRatio(need)}:1)`;
