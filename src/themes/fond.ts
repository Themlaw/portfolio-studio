/**
 * Fond de couleur d'un composant (lot 32) : `props.background`, sur tout grand composant, pleine hauteur de la rubrique et
 * bord à bord de son conteneur (la carte si elle en a une, sinon la page). Module pur (zod + palette) : lu par le registre
 * (schéma commun), le rendu serveur (BlockList), la toile (aperçu immédiat) et les tests (scripts/test-fond.mjs).
 *
 *  - Valeur : `{ kind: "color", color }`, `color` = jeton de la palette (SURFACE_TOKENS) ou `#rrggbb[aa]`. Absent = aucun fond.
 *    `{ kind: "wallpaper", wallpaper, color?, size?, opacity? }` (lot 35) : un motif de la bibliothèque (src/themes/wallpaper.ts), répété
 *    sur toute l'enveloppe, avec une couleur facultative DESSOUS. Sans couleur, le texte garde l'encre du thème. Motif supprimé : il disparaît
 *    du rendu, la couleur reste.
 *  - Lisibilité : le texte, les filets, les liens et les boutons passent à la variante lisible de la couleur (`cardStyle`,
 *    même règle que les cartes) ; sous AA, `ok` est faux : avertissement seulement, jamais bloquant.
 *  - Marge et coins (lot 43) : `inset` (s / m / l) laisse un espace tout autour du fond (comme un passe-partout), `round` (s / m / l)
 *    arrondit ses coins (visible avec une marge). Absents = bord à bord, coins droits : rien ne change. Un fond avec marge ne fusionne
 *    jamais avec ses voisins (`fondKey` null). Ce qui entoure : la couleur du voisin bord à bord (celui d'avant, sinon d'après) quand il
 *    en a une (`around`), sinon la carte ou la page. Ces champs vivent sur l'objet Background : tout fond (image, planche libre) les réutilise.
 *  - Fusion : deux composants CONSÉCUTIFS de même fond (et de même contenant : tous deux sur une carte, ou tous deux sur la page)
 *    se touchent sans espace ni ligne de jointure (`fondJoins`).
 *
 * API pour un conteneur qui rend lui-même une suite de composants (planche composée, lot 31) : `fondOf(props)` lit le fond,
 * `fondJoins(keys)` donne qui se fusionne avec qui, `withFond` (src/blocks/BlockList.tsx) pose l'enveloppe.
 */
import type { z } from "zod";

import { BackgroundSchema, FOND_STEPS } from "./schema";
import { cardStyle, cardVars, type CardPalette, type CardStyle } from "./surface";
import { wallpaperVars, type WallpaperLookup } from "./wallpaper";

export { BackgroundSchema };
export type Background = z.infer<typeof BackgroundSchema>;
export type FondStep = (typeof FOND_STEPS)[number];

/** Marge autour du fond (undefined = bord à bord) et arrondi des coins (sans effet visible sans marge, donc ignoré). */
export const fondInset = (bg: Background | undefined): FondStep | undefined => bg?.inset;
export const fondRound = (bg: Background | undefined): FondStep | undefined => (bg?.inset ? bg.round : undefined);

/**
 * Grands composants qui reçoivent un fond. Pas l'Ouverture (elle a son propre fond, image ou vidéo), pas les anciens types
 * retirés de la palette, pas les cellules d'une grille (trop petites, la grille elle-même peut recevoir le fond).
 */
export const FOND_TYPES: readonly string[] = ["project-board", "video-single", "grid", "image", "free-board", "cv", "section-title", "collection-tiles", "rich-text", "contact", "page-link", "profile"];
export const supportsFond = (type: string): boolean => FOND_TYPES.includes(type);

/** Lecture tolérante : une valeur illisible est ignorée (jamais le bloc). */
export function readBackground(raw: unknown): Background | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const parsed = BackgroundSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** Couleur du fond (jeton ou `#rrggbb`), ou undefined s'il n'y en a pas (un papier peint sans couleur dessous n'en a pas). */
export const fondColor = (bg: Background | undefined): string | undefined => (bg ? bg.color : undefined);

/**
 * Identité de fusion : deux composants se fondent quand leurs clés sont égales. `onCard` : posé sur une carte de rubrique ;
 * `border` : signature de la bordure de cette carte (`cardBorderSignature`). Deux cartes de même fond mais de bordures
 * différentes (ou l'une sans bordure) ne fusionnent PAS : une bordure qui s'arrêterait au raccord serait un trait coupé, et
 * « la première bordure l'emporte » ignorerait en silence le réglage de l'autre carte.
 * Un papier peint se fond avec son voisin seulement si le motif ET ses réglages (taille, opacité, couleur dessous) sont les mêmes.
 */
export function fondKey(bg: Background | undefined, onCard: boolean, border = ""): string | null {
  if (!bg || bg.inset) return null;
  const where = onCard ? `card|${border}` : "page";
  const paper = bg.paper === "under" ? "|u" : "";
  if (bg.kind === "wallpaper") return `wp:${bg.wallpaper}:${bg.size ?? ""}:${bg.opacity ?? ""}:${bg.color ?? ""}|${where}${paper}`;
  return `${bg.color}|${where}${paper}`;
}

/** `around` : couleur (jeton ou `#rrggbb`) qui entoure un fond avec marge, quand un voisin en a une (lot 43). */
export type FondJoin = { prev: boolean; next: boolean; around?: string };

/**
 * Couleur qui entoure le fond avec marge n° `i` : celle du voisin d'avant, sinon d'après, s'il a un fond de couleur bord à bord
 * (`bgs` : le fond de chaque composant du même contenant, undefined pour ceux sans fond ou posés sur une carte).
 */
export function fondAround(bgs: readonly (Background | undefined)[], i: number): string | undefined {
  if (!bgs[i]?.inset) return undefined;
  for (const n of [bgs[i - 1], bgs[i + 1]]) if (n && !n.inset && n.color) return n.color;
  return undefined;
}

/**
 * Pour une suite de composants : lequel se fond dans son voisin d'avant / d'après (clés égales et non nulles). Avec `bgs`, ajoute aussi
 * `around` aux composants à marge.
 */
export function fondJoins(keys: readonly (string | null)[], bgs?: readonly (Background | undefined)[]): FondJoin[] {
  return keys.map((k, i) => {
    const around = bgs ? fondAround(bgs, i) : undefined;
    return { prev: k !== null && keys[i - 1] === k, next: k !== null && keys[i + 1] === k, ...(around ? { around } : {}) };
  });
}

export type FondStyle = { style: CardStyle; vars: Record<string, string> };

/**
 * Couleurs lisibles posées en variables sur l'enveloppe du fond (mêmes `--card-*` que les cartes, lues par look.css). Papier peint :
 * en plus `--wp-*` (motif, taille, opacité) d'après `lookup` (la bibliothèque) ; sans couleur dessous, le texte reste à l'encre du thème
 * (calculée sur le fond de page) et le motif se pose directement sur la page ou la carte.
 */
export function fondStyle(bg: Background, palette: CardPalette, lookup?: WallpaperLookup, around?: string): FondStyle {
  const style = cardStyle(fondColor(bg) ?? "bg", palette);
  const vars = cardVars(style);
  if (bg.kind === "wallpaper") Object.assign(vars, wallpaperVars(lookup?.(bg.wallpaper), { size: bg.size, opacity: bg.opacity }));
  if (bg.inset && around) vars["--fond-around"] = cardStyle(around, palette).bg;
  return { style, vars };
}

/** Attributs de l'enveloppe : `data-fond="on"`, la fusion avec le voisin d'avant / d'après, et le papier peint (`data-wallpaper`, `data-fond-clear` sans couleur dessous). */
export function fondAttributes(join: FondJoin, bg?: Background): Record<string, string> {
  return {
    "data-fond": "on",
    ...(bg?.inset ? { "data-fond-inset": bg.inset, ...(bg.round ? { "data-fond-round": bg.round } : {}), ...(join.around ? { "data-fond-around": "" } : {}) } : {}),
    ...(bg?.paper === "under" ? { "data-paper": "under" } : {}),
    ...(join.prev ? { "data-join-prev": "" } : {}),
    ...(join.next ? { "data-join-next": "" } : {}),
    ...(bg?.kind === "wallpaper" ? { "data-wallpaper": "", ...(bg.color ? {} : { "data-fond-clear": "" }) } : {}),
  };
}
