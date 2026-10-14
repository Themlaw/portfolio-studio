/**
 * Fond d'un texte (lot 21) : « Ombre douce », « Bandeau » ou « Surlignage » derrière un texte, avec une
 * couleur au choix. UNE seule définition, lue par le style local d'un texte (`look.text`), le style global
 * d'un rôle (`styles.roles`), la barre typographique de la toile et le panneau « Styles du site ».
 *
 *  - Sans couleur (« Auto »), le rendu est celui d'avant (lot 2) : fond du thème (ombre, bandeau) ou couleur
 *    principale (surlignage), via les variables `--color-*`, donc adapté aussi dans une carte de rubrique.
 *  - Avec une couleur : un jeton de la palette (suit les changements de palette) ou une teinte douce (lot 19b)
 *    — traduits en variables CSS, la toile les suit en direct —, ou une couleur libre `#rrggbb[aa]`.
 *    L'ombre douce est alors un halo de cette couleur (elle a donc une couleur, la pastille s'applique).
 *  - Lisibilité : la couleur du texte devient celle que choisit la règle des cartes (`cardStyle`, lot 17c),
 *    SAUF si le texte a une couleur choisie : `var(--user-ink, …)` — le style du rôle publie son choix dans
 *    `--user-ink`, un choix local est une déclaration `color` posée après. Dans ce cas, `backdropContrast`
 *    mesure le contraste pour que l'éditeur affiche une alerte.
 *
 * Module pur (palette + surface, aucun DOM) : lu par le serveur, la toile, le panneau et les tests.
 */
import { contrastRatio, opaqueOn } from "./palette";
import { cardStyle, isSurfaceTint, isSurfaceToken, tintParts, type CardPalette } from "./surface";

export type BackdropKind = "none" | "shadow" | "band" | "highlight";

/** Variable CSS (émise par le layout) de chaque jeton de base. */
const TOKEN_VARS: Record<string, string> = {
  bg: "--t-color-bg",
  bgDeep: "--t-color-bg-deep",
  surface: "--t-color-surface",
  primary: "--t-color-primary",
  secondary: "--t-color-secondary",
  ink: "--t-color-ink",
  tertiary: "--t-color-tertiary",
};

/** Valeur CSS d'une couleur de fond : jeton (variable), teinte douce (mélange Oklab sur le fond de page) ou hex. */
export function backdropColorCss(color: string): string {
  if (isSurfaceTint(color)) {
    const { base, percent } = tintParts(color);
    return `color-mix(in oklab, var(${TOKEN_VARS[base]}) ${percent}%, var(--t-color-bg))`;
  }
  return isSurfaceToken(color) ? `var(${TOKEN_VARS[color]})` : color;
}

/** Halo d'une couleur : même empilement que `--role-shadow` (src/app/look.css), dont la couleur est celle du fond. */
function shadowStack(c: string): string {
  const radii = [1, 2, 3, 4, 6, 6, 8, 8, 10, 10, 10, 12, 12, 12, 14, 14];
  return [...radii.map((r) => `0 0 ${r}px ${c}`), `0 0 20px color-mix(in srgb, ${c} 60%, transparent)`].join(", ");
}

export type BackdropOptions = {
  /** Palette du thème actif : sans elle, pas de couleur de texte lisible (le fond, lui, suit les variables). */
  palette?: CardPalette;
  /** Le texte a une couleur choisie : on ne la remplace pas. */
  userColor?: boolean;
};

/** Propriétés posées par un fond (le style d'un rôle les range à part pour le menu). */
export const BACKDROP_PROPS = new Set(["display", "padding", "background", "text-shadow", "box-decoration-break", "-webkit-box-decoration-break"]);

/** Déclarations CSS d'un fond de texte (kebab-case) ; vide sans fond choisi. */
export function backdropDecls(backdrop: BackdropKind | undefined, color: string | undefined, { palette, userColor }: BackdropOptions = {}): [string, string][] {
  if (!backdrop) return [];
  const css = color ? backdropColorCss(color) : null;
  const ink = (auto: string | null): [string, string][] => {
    if (userColor) return [];
    const readable = color ? (palette ? cardStyle(color, palette).ink : null) : auto;
    return readable ? [["color", `var(--user-ink, ${readable})`]] : [];
  };
  switch (backdrop) {
    case "none":
      return [["background", "none"], ["padding", "0"], ["text-shadow", "none"]];
    case "shadow":
      return [["background", "none"], ["padding", "0"], ["text-shadow", css ? shadowStack(css) : "var(--role-shadow)"], ...ink(null)];
    case "band":
      return [["display", "inline-block"], ["padding", "0.45em 0.8em"], ["background", css ?? "color-mix(in srgb, var(--color-bg) 86%, transparent)"], ["text-shadow", "none"], ...ink(null)];
    case "highlight":
      return [
        ["display", "inline"],
        ["padding", "0.2em 0.45em"],
        ["background", css ?? "var(--color-primary)"],
        ["text-shadow", "none"],
        ["box-decoration-break", "clone"],
        ["-webkit-box-decoration-break", "clone"],
        ...ink("var(--color-on-primary)"),
      ];
  }
}

/** Clé de la palette du thème d'une teinte de texte (`ink-soft` → `inkSoft`). */
export const TEXT_PALETTE_KEYS: Record<string, keyof CardPalette> = { ink: "ink", "ink-soft": "inkSoft", primary: "primary", secondary: "secondary", tertiary: "tertiary", eyebrow: "eyebrow", bg: "bg", surface: "surface" };

/**
 * Contraste d'un texte de couleur CHOISIE (teinte de la palette ou couleur libre) sur un fond coloré
 * (jeton, teinte douce ou couleur libre). `null` : rien à mesurer (fond « Auto », texte non choisi).
 * Même seuil que les cartes : AA, 4,5:1.
 */
export function backdropContrast(backdropColor: string | undefined, textColor: string | undefined, palette: CardPalette): { ratio: number; ok: boolean } | null {
  if (!backdropColor || !textColor) return null;
  const bg = cardStyle(backdropColor, palette).bg;
  const text = TEXT_PALETTE_KEYS[textColor] ? palette[TEXT_PALETTE_KEYS[textColor]] : textColor;
  const ground = opaqueOn(bg, palette.bg);
  const ratio = contrastRatio(opaqueOn(text, ground), ground);
  return Number.isFinite(ratio) ? { ratio, ok: ratio >= 4.5 } : null;
}
