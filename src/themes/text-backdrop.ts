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
import { airValue, type Air } from "./backdrop-air";
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
  /**
   * Style d'un RÔLE (feuille globale) : il vise tous les éléments du rôle, dont des blocs (`p`). Le bandeau n'y change donc
   * pas leur `display` (des `inline-block` les mettraient côte à côte) et n'ajoute pas de marge intérieure.
   */
  role?: boolean;
  /** Aération du fond (lot 68) : crans Serré · Normal · Aéré ; absente = celle du thème (variables `--bd-*`, repli « Normal »). */
  air?: Air;
};

/** Propriétés posées par un fond (le style d'un rôle les range à part pour le menu). */
export const BACKDROP_PROPS = new Set(["display", "width", "outline", "padding", "background", "text-shadow", "text-decoration", "text-decoration-line", "text-decoration-color", "text-decoration-thickness", "text-decoration-skip-ink", "text-underline-offset"]);


/** Déclarations CSS d'un fond de texte (kebab-case) ; vide sans fond choisi. */
export function backdropDecls(backdrop: BackdropKind | undefined, color: string | undefined, { palette, userColor, role, air }: BackdropOptions = {}): [string, string][] {
  if (!backdrop) return [];
  const css = color ? backdropColorCss(color) : null;
  const ink = (auto: string | null): [string, string][] => {
    if (userColor) return [];
    const readable = color ? (palette ? cardStyle(color, palette).ink : null) : auto;
    return readable ? [["color", `var(--user-ink, ${readable})`]] : [];
  };
  switch (backdrop) {
    case "none":
      return [["background", "none"], ["padding", "0"], ["text-shadow", "none"], ["text-decoration", "none"]];
    case "shadow":
      return [["background", "none"], ["padding", "0"], ["text-shadow", css ? shadowStack(css) : "var(--role-shadow)"], ["text-decoration", "none"], ...ink(null)];
    case "band":
      // Rôle : la boîte garde sa place (ni `display`, ni padding : les voisins ne bougent pas) ; le bandeau est son fond plus un
      // contour de même couleur qui l'élargit, au ras du texte (largeur du contenu).
      if (role) {
        const c = css ?? "color-mix(in srgb, var(--color-bg) 86%, transparent)";
        return [["width", "fit-content"], ["background", c], ["outline", `${airValue("outline", air)} solid ${c}`], ["text-shadow", "none"], ["text-decoration", "none"], ...ink(null)];
      }
      return [["display", "inline-block"], ["padding", `${airValue("padY", air)} ${airValue("padX", air)}`], ["background", css ?? "color-mix(in srgb, var(--color-bg) 86%, transparent)"], ["text-shadow", "none"], ["text-decoration", "none"], ...ink(null)];
    case "highlight":
      // Surlignage : un gros trait de soulignement posé DERRIÈRE le texte, ligne par ligne. L'élément garde sa boîte
      // (display, marges, retours à la ligne) ; un `display: inline` la lui aurait fait perdre (marges verticales).
      return [
        ["background", "none"],
        ["text-shadow", "none"],
        ["text-decoration-line", "underline"],
        ["text-decoration-color", css ?? "var(--color-primary)"],
        ["text-decoration-thickness", airValue("thick", air)],
        ["text-underline-offset", airValue("offset", air)],
        ["text-decoration-skip-ink", "none"],
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
