/**
 * Carte de rubrique (lot 17c) : un aplat de couleur posé sur le papier du site,
 * derrière UNE rubrique de premier niveau d'une page. Module pur (zod + palette,
 * aucun autre import) : lu par le schéma des blocs (registre), le schéma du thème
 * (carte par défaut), le rendu serveur (BlockList), la toile de l'éditeur (aperçu
 * immédiat) et les tests (scripts/test-surface.mjs).
 *
 *  - `props.surface` d'un bloc : { color, width, corners }, tout facultatif ; la
 *    clé absente = pas de carte (rendu d'avant, au pixel) ; `{}` = carte avec les
 *    réglages par défaut du thème (`tokens.layout.card`, puis FALLBACK_CARD).
 *  - `color` : un jeton de la palette (SURFACE_TOKENS) OU une couleur libre
 *    `#rrggbb[aa]` (même format que la couleur d'un texte, src/lib/color.ts).
 *  - Lisibilité : dans la carte, texte, filets, liens, étiquettes et boutons passent
 *    à une variante lisible (`cardStyle`) : texte du thème, ou texte inverse, selon
 *    le meilleur contraste. Si même ainsi le texte reste sous AA (4,5:1), `ok` est
 *    faux : l'éditeur le signale sans rien bloquer.
 */
import { contrastRatio, mixOklab, opaqueOn, parseColor, toHex, type ResolvedPalette } from "./palette";
import { SURFACE_CORNERS, SURFACE_TOKENS, SURFACE_WIDTHS, SurfaceSchema } from "./schema";
import type { z } from "zod";

// Schéma et listes vivent dans schema.ts (zod seul, chargé tel quel par les scripts Node).
export { SURFACE_CORNERS, SURFACE_TOKENS, SURFACE_WIDTHS, SurfaceSchema };
export const SURFACE_TOKEN_LABELS: Record<SurfaceToken, string> = {
  bg: "Fond",
  bgDeep: "Fond profond",
  surface: "Surface",
  primary: "Action",
  secondary: "Accent secondaire",
  ink: "Texte",
};

export const SURFACE_WIDTH_LABELS: Record<(typeof SURFACE_WIDTHS)[number], string> = { full: "Pleine largeur", inset: "En retrait" };
export const SURFACE_CORNER_LABELS: Record<(typeof SURFACE_CORNERS)[number], string> = { square: "Coins droits", round: "Coins arrondis" };

export type SurfaceToken = (typeof SURFACE_TOKENS)[number];
export type Surface = z.infer<typeof SurfaceSchema>;
/** Carte par défaut d'un thème (`tokens.layout.card`) : mêmes champs que la carte d'un bloc. */
export type CardDefaults = Surface;
export type ResolvedSurface = Required<Surface>;

/** Réglages quand ni le bloc ni le thème ne disent rien. */
export const FALLBACK_CARD: ResolvedSurface = { color: "surface", width: "inset", corners: "round" };

export const isSurfaceToken = (v: string): v is SurfaceToken => (SURFACE_TOKENS as readonly string[]).includes(v);

/** Lecture tolérante : un champ invalide est ignoré (jamais le bloc), `undefined` = pas de carte. */
export function readSurface(raw: unknown): Surface | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const parsed = SurfaceSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const one = SurfaceSchema.safeParse({ [k]: v });
    if (one.success) Object.assign(out, one.data);
  }
  return out as Surface;
}

/** Réglages complets : ceux du bloc, puis la carte par défaut du thème, puis FALLBACK_CARD. */
export function resolveSurface(surface: Surface, theme?: CardDefaults): ResolvedSurface {
  return {
    color: surface.color ?? theme?.color ?? FALLBACK_CARD.color,
    width: surface.width ?? theme?.width ?? FALLBACK_CARD.width,
    corners: surface.corners ?? theme?.corners ?? FALLBACK_CARD.corners,
  };
}

/** Retire les champs vides : `{}` reste une carte (réglages du thème), jamais `undefined`. */
export function cleanSurface(surface: Surface): Surface {
  return Object.fromEntries(Object.entries(surface).filter(([, v]) => v !== undefined)) as Surface;
}

/* ---- Lisibilité ------------------------------------------------------------------ */

/** Couleurs du thème dont la carte a besoin (sous-ensemble de la palette résolue). */
export type CardPalette = Pick<ResolvedPalette, "bg" | "bgDeep" | "surface" | "ink" | "inkSoft" | "primary" | "primaryHover" | "onPrimary" | "secondary" | "eyebrow">;

/** Seuil AA du texte courant (src/themes/contrast.ts). */
const AA = 4.5;
/** Un bouton « Action » doit se distinguer du fond de la carte (contraste d'un élément graphique). */
const BUTTON_MIN = 2;

export type CardStyle = {
  /** Fond de la carte (valeur CSS : hex de la palette, ou la couleur libre telle quelle). */
  bg: string;
  ink: string;
  inkSoft: string;
  line: string;
  link: string;
  linkHover: string;
  eyebrow: string;
  accent: string;
  btnBg: string;
  btnFg: string;
  btnHover: string;
  /** Contraste du texte choisi sur la carte. */
  ratio: number;
  /** Le texte atteint AA : sinon l'éditeur le signale (jamais bloquant). */
  ok: boolean;
};

const CARD_KEYS: Record<SurfaceToken, keyof CardPalette> = { bg: "bg", bgDeep: "bgDeep", surface: "surface", primary: "primary", secondary: "secondary", ink: "ink" };

/** Fond CSS d'une couleur de carte (jeton résolu dans la palette du thème, ou couleur libre). */
export function cardBackground(color: string, p: CardPalette): string {
  return isSurfaceToken(color) ? p[CARD_KEYS[color]] : color;
}

/**
 * Variante lisible de tout ce qui se pose sur la carte. Texte : celui du thème s'il passe AA, sinon le
 * texte inverse (fond du thème, texte des boutons), sinon le meilleur des trois. Les autres teintes
 * (secondaire, liens, étiquettes, bouton) gardent leur couleur du thème tant qu'elles se lisent.
 */
export function cardStyle(color: string, p: CardPalette): CardStyle {
  const bg = cardBackground(color, p);
  // Une carte translucide se lit sur le fond du thème.
  const ground = opaqueOn(bg, p.bg);
  const candidates = [p.ink, p.bg, p.onPrimary];
  const ink = candidates.find((c) => contrastRatio(c, ground) >= AA) ?? candidates.reduce((a, b) => (contrastRatio(b, ground) > contrastRatio(a, ground) ? b : a));
  const ratio = contrastRatio(ink, ground);
  // Texte secondaire : celui du thème s'il se lit ; sinon l'encre choisie, éclaircie vers la carte tant que ça passe.
  let inkSoft = ink;
  if (ink === p.ink && contrastRatio(p.inkSoft, ground) >= AA) inkSoft = p.inkSoft;
  else {
    const softer = mixOklab(ink, ground, 0.2);
    if (contrastRatio(softer, ground) >= AA) inkSoft = softer;
  }
  const [r, g, b] = parseColor(ink)?.rgb ?? [0, 0, 0];
  const linkOk = contrastRatio(p.primary, ground) >= AA;
  const link = linkOk ? p.primary : ink;
  const linkHover = linkOk && contrastRatio(p.primaryHover, ground) >= AA ? p.primaryHover : ink;
  const buttonOk = contrastRatio(p.primary, ground) >= BUTTON_MIN;
  return {
    bg,
    ink,
    inkSoft,
    line: `rgba(${r}, ${g}, ${b}, 0.18)`,
    link,
    linkHover,
    eyebrow: contrastRatio(p.eyebrow, ground) >= AA ? p.eyebrow : inkSoft,
    accent: contrastRatio(p.secondary, ground) >= AA ? p.secondary : inkSoft,
    btnBg: buttonOk ? p.primary : ink,
    btnFg: buttonOk ? p.onPrimary : toHex(parseColor(ground)?.rgb ?? [255, 255, 255]),
    btnHover: buttonOk ? p.primaryHover : inkSoft,
    ratio,
    ok: ratio >= AA,
  };
}

/** Variables CSS de la carte (lues par src/app/look.css, `.surface-card`). */
export function cardVars(style: CardStyle): Record<string, string> {
  return {
    "--card-bg": style.bg,
    "--card-ink": style.ink,
    "--card-ink-soft": style.inkSoft,
    "--card-line": style.line,
    "--card-link": style.link,
    "--card-link-hover": style.linkHover,
    "--card-eyebrow": style.eyebrow,
    "--card-accent": style.accent,
    "--card-btn-bg": style.btnBg,
    "--card-btn-fg": style.btnFg,
    "--card-btn-hover": style.btnHover,
  };
}

/** Attributs de l'enveloppe de la carte (la feuille y accroche largeur et coins). */
export function surfaceAttributes(s: ResolvedSurface): Record<string, string> {
  return { "data-surface": "on", "data-width": s.width, "data-corners": s.corners };
}
