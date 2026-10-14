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

/** Info-bulle : le chiffre derrière le verdict. */
export const ratioTip = (ratio: number, need: number = AA) => `Contraste ${frRatio(ratio)}:1 (il faut au moins ${frRatio(need)}:1)`;
