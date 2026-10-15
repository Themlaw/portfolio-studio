/**
 * Fond de couleur d'un composant (lot 32) : `props.background`, sur tout grand composant, pleine hauteur de la rubrique et
 * bord à bord de son conteneur (la carte si elle en a une, sinon la page). Module pur (zod + palette) : lu par le registre
 * (schéma commun), le rendu serveur (BlockList), la toile (aperçu immédiat) et les tests (scripts/test-fond.mjs).
 *
 *  - Valeur : `{ kind: "color", color }`, `color` = jeton de la palette (SURFACE_TOKENS) ou `#rrggbb[aa]`. Absent = aucun fond.
 *    `kind` est une union discriminée : un autre fond (papier peint importé) s'ajoute sans toucher à ce qui existe.
 *  - Lisibilité : le texte, les filets, les liens et les boutons passent à la variante lisible de la couleur (`cardStyle`,
 *    même règle que les cartes) ; sous AA, `ok` est faux : avertissement seulement, jamais bloquant.
 *  - Fusion : deux composants CONSÉCUTIFS de même fond (et de même contenant : tous deux sur une carte, ou tous deux sur la page)
 *    se touchent sans espace ni ligne de jointure (`fondJoins`).
 *
 * API pour un conteneur qui rend lui-même une suite de composants (planche composée, lot 31) : `fondOf(props)` lit le fond,
 * `fondJoins(keys)` donne qui se fusionne avec qui, `withFond` (src/blocks/BlockList.tsx) pose l'enveloppe.
 */
import type { z } from "zod";

import { BackgroundSchema } from "./schema";
import { cardStyle, cardVars, type CardPalette, type CardStyle } from "./surface";

export { BackgroundSchema };
export type Background = z.infer<typeof BackgroundSchema>;

/**
 * Grands composants qui reçoivent un fond. Pas l'Ouverture (elle a son propre fond, image ou vidéo), pas les anciens types
 * retirés de la palette, pas les cellules d'une grille (trop petites, la grille elle-même peut recevoir le fond).
 */
export const FOND_TYPES: readonly string[] = ["project-board", "video-single", "grid", "image", "cv", "section-title", "collection-tiles", "rich-text", "contact", "page-link", "profile"];
export const supportsFond = (type: string): boolean => FOND_TYPES.includes(type);

/** Lecture tolérante : une valeur illisible est ignorée (jamais le bloc). */
export function readBackground(raw: unknown): Background | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const parsed = BackgroundSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** Couleur du fond (jeton ou `#rrggbb`), ou undefined s'il n'y en a pas. */
export const fondColor = (bg: Background | undefined): string | undefined => (bg?.kind === "color" ? bg.color : undefined);

/**
 * Identité de fusion : deux composants se fondent quand leurs clés sont égales. `onCard` : posé sur une carte de rubrique ;
 * `border` : signature de la bordure de cette carte (`cardBorderSignature`). Deux cartes de même fond mais de bordures
 * différentes (ou l'une sans bordure) ne fusionnent PAS : une bordure qui s'arrêterait au raccord serait un trait coupé, et
 * « la première bordure l'emporte » ignorerait en silence le réglage de l'autre carte.
 */
export function fondKey(bg: Background | undefined, onCard: boolean, border = ""): string | null {
  const color = fondColor(bg);
  return color ? `${color}|${onCard ? `card|${border}` : "page"}` : null;
}

export type FondJoin = { prev: boolean; next: boolean };

/** Pour une suite de composants : lequel se fond dans son voisin d'avant / d'après (clés égales et non nulles). */
export function fondJoins(keys: readonly (string | null)[]): FondJoin[] {
  return keys.map((k, i) => ({ prev: k !== null && keys[i - 1] === k, next: k !== null && keys[i + 1] === k }));
}

export type FondStyle = { style: CardStyle; vars: Record<string, string> };

/** Couleurs lisibles posées en variables sur l'enveloppe du fond (mêmes `--card-*` que les cartes, lues par look.css). */
export function fondStyle(bg: Background, palette: CardPalette): FondStyle {
  const style = cardStyle(fondColor(bg) ?? "surface", palette);
  return { style, vars: cardVars(style) };
}

/** Attributs de l'enveloppe : `data-fond="on"`, et la fusion avec le voisin d'avant / d'après. */
export function fondAttributes(join: FondJoin): Record<string, string> {
  return { "data-fond": "on", ...(join.prev ? { "data-join-prev": "" } : {}), ...(join.next ? { "data-join-next": "" } : {}) };
}
