/**
 * Aération du fond d'un texte (lot 68) : « Serré · Normal · Aéré », des CRANS (pas de curseur libre), en em du texte.
 * Module sans dépendance (lu par le schéma du thème, le rendu, les menus et les tests).
 *
 *  - « Serré » reproduit EXACTEMENT le rendu d'avant le lot 68.
 *  - « Normal » est le nouveau défaut (rien d'enregistré) : un peu plus d'air.
 *  - Défaut du thème : `tokens.layout.textAir` (étape « Textes » de l'éditeur guidé), émis en variables `--bd-*` sur `:root` ;
 *    un texte ou un rôle qui choisit sa propre aération écrit les valeurs, qui passent devant.
 */
export const AIRS = ["tight", "normal", "airy"] as const;
export type Air = (typeof AIRS)[number];
export const AIR_LABELS: Record<Air, string> = { tight: "Serré", normal: "Normal", airy: "Aéré" };
export const DEFAULT_AIR: Air = "normal";

/**
 * Valeurs par cran. `padY` / `padX` : marge intérieure du bandeau ; `outline` : débord du bandeau d'un rôle (la boîte garde sa
 * place) ; `thick` / `offset` : trait du surlignage (épaisseur et décalage, centrés sur les lettres : plus épais = plus d'air autour
 * des lettres, en haut comme en bas).
 */
export const AIR_VALUES: Record<Air, { padY: string; padX: string; outline: string; thick: string; offset: string }> = {
  tight: { padY: "0.45em", padX: "0.8em", outline: "0.45em", thick: "1.15em", offset: "-0.88em" },
  normal: { padY: "0.55em", padX: "1em", outline: "0.55em", thick: "1.32em", offset: "-0.97em" },
  airy: { padY: "0.65em", padX: "1.2em", outline: "0.7em", thick: "1.5em", offset: "-1.06em" },
};

const VAR_NAMES = { padY: "--bd-pady", padX: "--bd-padx", outline: "--bd-outline", thick: "--bd-thick", offset: "--bd-offset" } as const;

/** Valeur d'une propriété d'aération : la valeur du cran choisi, sinon la variable du thème (repli : Normal). */
export function airValue(key: keyof typeof VAR_NAMES, air: Air | undefined): string {
  return air ? AIR_VALUES[air][key] : `var(${VAR_NAMES[key]}, ${AIR_VALUES[DEFAULT_AIR][key]})`;
}

/** Variables du défaut d'un thème (rien pour « Normal » : le repli des déclarations suffit). */
export function airVariables(air: Air | undefined): Record<string, string> {
  if (!air || air === DEFAULT_AIR) return {};
  return Object.fromEntries((Object.keys(VAR_NAMES) as (keyof typeof VAR_NAMES)[]).map((k) => [VAR_NAMES[k], AIR_VALUES[air][k]]));
}
