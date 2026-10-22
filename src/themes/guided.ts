/**
 * Éditeur de thème guidé (lot 61) : réglages SIMPLIFIÉS (un seul « Arrondi », espacements en trois niveaux) posés par-dessus les
 * valeurs précises du modèle de thème, sans jamais les remplacer tant qu'on n'y touche pas.
 *
 * Règle de données : le thème garde ses valeurs précises (`tokens.radius`, `tokens.space`). L'éditeur LIT ces valeurs et montre le cran
 * qui y correspond (exactement, ou « le plus proche » quand le thème a des valeurs que aucun cran ne reproduit) ; seul un clic sur un
 * cran écrit les valeurs de ce cran. Rien n'est jamais normalisé à l'ouverture ni à l'enregistrement.
 *
 * Module pur (palette.ts et types du schéma seulement) : lu par l'éditeur (client), l'e2e et `scripts/test-guide61.mjs`.
 */
import { isAuto, NUANCE_KEYS, resolvePalette, setNuance, type NuanceKey, type PaletteColors, type PaletteState } from "./palette";
import type { Theme } from "./schema";

type Radius = Theme["tokens"]["radius"];
type Space = Theme["tokens"]["space"];
type Button = Theme["variants"]["button"];

/** Un cran d'arrondi : les rayons de petits éléments, cartes, grands blocs et images de planches, et la forme des boutons. */
export type RoundLevel = { id: string; label: string; radius: Pick<Radius, "sm" | "md" | "lg" | "strip">; button: Button };

/**
 * De « carré » à « très rond ». Les crans 0 à 3 reprennent les jeux de valeurs des thèmes livrés (Studio, Planche de story,
 * Carnet d'atelier, Galerie lumineuse) : choisir le cran d'un thème livré redonne exactement ses rayons.
 */
export const ROUND_LEVELS: readonly RoundLevel[] = [
  { id: "carre", label: "Carré", radius: { sm: "0px", md: "0px", lg: "0px", strip: "0px" }, button: "square" },
  { id: "leger", label: "Léger", radius: { sm: "2px", md: "3px", lg: "4px", strip: "2px" }, button: "square" },
  { id: "moyen", label: "Moyen", radius: { sm: "4px", md: "8px", lg: "14px", strip: "2px" }, button: "pill" },
  { id: "rond", label: "Rond", radius: { sm: "6px", md: "12px", lg: "20px", strip: "4px" }, button: "pill" },
  { id: "tres-rond", label: "Très rond", radius: { sm: "10px", md: "20px", lg: "32px", strip: "8px" }, button: "pill" },
];

/** Rayon d'un bouton pour un cran : pastille (boutons arrondis) ou le petit rayon (la variante « droits » s'appuie dessus). */
const buttonRadius = (level: RoundLevel) => (level.button === "pill" ? "999px" : level.radius.sm);

export const px = (v: string): number | null => (/^\d+(\.\d+)?px$/.test(v) ? parseFloat(v) : null);

/** Cran d'arrondi d'un thème : `exact` si tous ses rayons ET la forme des boutons sont ceux du cran, sinon le cran le plus proche (par les cartes). */
export function roundLevelOf(radius: Radius, button: Button): { index: number; exact: boolean } {
  const exact = ROUND_LEVELS.findIndex(
    (l) =>
      l.radius.sm === radius.sm &&
      l.radius.md === radius.md &&
      l.radius.lg === radius.lg &&
      l.radius.strip === radius.strip &&
      l.button === button &&
      buttonRadius(l) === radius.btn,
  );
  if (exact >= 0) return { index: exact, exact: true };
  const md = px(radius.md) ?? 8;
  let best = 0;
  ROUND_LEVELS.forEach((l, i) => {
    if (Math.abs((px(l.radius.md) ?? 0) - md) < Math.abs((px(ROUND_LEVELS[best].radius.md) ?? 0) - md)) best = i;
  });
  return { index: best, exact: false };
}

/** Rayons et forme des boutons écrits par un cran (le seul endroit où le réglage simplifié remplace les valeurs précises). */
export function applyRoundLevel(index: number): { radius: Radius; button: Button } {
  const level = ROUND_LEVELS[Math.min(ROUND_LEVELS.length - 1, Math.max(0, index))];
  return { radius: { ...level.radius, btn: buttonRadius(level) }, button: level.button };
}

/** Un niveau d'espacement : entre les sections et marges latérales. La largeur maximale du contenu reste un réglage précis. */
export type SpaceLevel = { id: string; label: string; sectionGap: string; gutter: string };

/** Serré, Normal, Aéré : jeux de valeurs de Studio, Fanzine riso et Carnet d'atelier. */
export const SPACE_LEVELS: readonly SpaceLevel[] = [
  { id: "serre", label: "Serré", sectionGap: "clamp(2.5rem, 5vw, 4.5rem)", gutter: "clamp(1rem, 3vw, 2rem)" },
  { id: "normal", label: "Normal", sectionGap: "clamp(3rem, 7vw, 6rem)", gutter: "clamp(1rem, 4vw, 2.5rem)" },
  { id: "aere", label: "Aéré", sectionGap: "clamp(4.5rem, 10vw, 9rem)", gutter: "clamp(1.25rem, 5vw, 3.5rem)" },
];

const squash = (v: string) => v.replace(/\s+/g, "").toLowerCase();
/** Plus grande valeur d'un `clamp(min, préféré, max)` en rem (le cran visé sur grand écran), ou null. */
const clampMaxRem = (v: string): number | null => {
  const m = /^clamp\(([\d.]+)rem,\s*[\d.]+vw,\s*([\d.]+)rem\)$/.exec(v.trim());
  return m ? parseFloat(m[2]) : null;
};

/** Niveau d'espacement d'un thème : exact, ou le plus proche (par l'espace entre les sections). */
export function spaceLevelOf(space: Space): { index: number; exact: boolean } {
  const exact = SPACE_LEVELS.findIndex((l) => squash(l.sectionGap) === squash(space.sectionGap) && squash(l.gutter) === squash(space.gutter));
  if (exact >= 0) return { index: exact, exact: true };
  const gap = clampMaxRem(space.sectionGap) ?? 6;
  let best = 0;
  SPACE_LEVELS.forEach((l, i) => {
    if (Math.abs((clampMaxRem(l.sectionGap) ?? 0) - gap) < Math.abs((clampMaxRem(SPACE_LEVELS[best].sectionGap) ?? 0) - gap)) best = i;
  });
  return { index: best, exact: false };
}

/** Espacements écrits par un niveau : la largeur maximale du contenu est conservée. */
export function applySpaceLevel(space: Space, index: number): Space {
  const level = SPACE_LEVELS[Math.min(SPACE_LEVELS.length - 1, Math.max(0, index))];
  return { ...space, sectionGap: level.sectionGap, gutter: level.gutter };
}

/** Largeur maximale « standard » du contenu : au-delà ou en deçà, c'est un réglage précis (compté dans « Affiner »). */
export const PAGE_MAX_STANDARD = "1240px";

/**
 * Nuances de couleur choisies qui diffèrent du calcul automatique (réglages « avancés » de l'étape Couleurs). Une nuance forcée
 * à la valeur même que donnerait le calcul n'est pas comptée : seul ce qui s'écarte du calcul est un réglage de l'artiste.
 */
export function customNuances(colors: PaletteColors, palette: PaletteState | undefined): NuanceKey[] {
  const now = resolvePalette(colors, palette);
  return NUANCE_KEYS.filter((k) => {
    if (isAuto(colors, palette, k)) return false;
    const next = setNuance(colors, palette, k, null);
    return resolvePalette(next.color, next.palette)[k].toLowerCase() !== now[k].toLowerCase();
  });
}

/* ---- Logo importé : choix de la variante à copier ---- */

/** Fichier de variante d'une image de la médiathèque (forme de `VariantFile`, src/lib/images/variants.ts). */
export type LogoVariantFile = { key: string; w: number; h: number; format: string };
/** Largeur visée : assez pour un en-tête net sur écran HiDPI (le logo s'affiche à 2,6 rem de haut). */
const WANTED_WIDTH = 960;
/** Borne d'un élément du kit (schéma `kitImage`). */
const KIT_MAX = 4096;

/** Variante (AVIF + WebP de même largeur) à copier : la plus petite qui atteint la largeur visée, sinon la plus grande. */
export function pickLogoVariant(files: LogoVariantFile[]): { avif: LogoVariantFile; webp: LogoVariantFile } | null {
  const pairs = files
    .filter((f) => f.format === "avif" && f.w <= KIT_MAX && f.h <= KIT_MAX)
    .flatMap((avif) => {
      const webp = files.find((f) => f.format === "webp" && f.w === avif.w && f.h === avif.h);
      return webp ? [{ avif, webp }] : [];
    })
    .sort((a, b) => a.avif.w - b.avif.w);
  return pairs.find((p) => p.avif.w >= WANTED_WIDTH) ?? pairs.at(-1) ?? null;
}

