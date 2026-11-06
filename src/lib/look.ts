/**
 * Mise en page réglée sur la toile (lot 2) : espaces haut / bas, arrondi des
 * images, position des titres, cadrage, style des textes (police, taille,
 * graisse…), fond du métier dans l'ouverture.
 *
 * - Réglages LOCAUX : `props.look` de chaque bloc (y compris un composant de
 *   conteneur), validés avec les props du bloc (registre : schéma étendu).
 * - Styles GLOBAUX par rôle (Titre 1, Titre 2, Étiquette, Texte, Légende,
 *   Menu, Nom du site) + arrondi du site : `styles` du brouillon du site
 *   (src/lib/site-schema.ts), publiés avec la page comme l'en-tête.
 * - Un réglage local surcharge le global, qui surcharge le thème.
 *
 * Toutes les valeurs sont des crans bornés (tokens du thème, palette du
 * thème, catalogue de polices) : rien de libre n'atteint une feuille CSS.
 * Module pur (zod + catalogues) : lu par le serveur, l'éditeur, la toile et
 * les tests (scripts/test-look.mjs).
 */
import { z } from "zod";

import { RectSchema } from "@/lib/images/crop";

import { IMAGE_BG_CARD } from "../themes/image-bg";
import { CUSTOM_COLOR_RE } from "./color";

import { RADIUS_VALUES } from "../themes/css";
import { BASE_KEYS, NUANCE_KEYS, NUANCE_NAMES, ROLE_NAMES } from "../themes/palette";
import { FONT_STACKS } from "../themes/font-stacks";
import { CATEGORY_FALLBACK, googleFamily, isGoogleFamily } from "../themes/google-fonts";
import { FONT_IDS, SURFACE_TOKENS, TEXT_ROLES, type FontId, type Theme } from "../themes/schema";
import { AIRS } from "../themes/backdrop-air";
import { BACKDROP_PROPS, backdropDecls } from "../themes/text-backdrop";
import type { CardPalette } from "../themes/surface";

/* ---- Crans ------------------------------------------------------------------ */

export const SPACES = ["none", "s", "m", "l", "xl"] as const;
export type Space = (typeof SPACES)[number];
/** Lot 108 : un espace est un cran nommé (lu à l'identique depuis toujours) OU un nombre de pixels (curseur aimanté). */
export type SpaceVal = Space | number;
export const SPACE_MAX = 240;
export const SIDE_MAX = 160;
export const WIDTH_MIN = 30;
/** Valeur de repère (px, thème par défaut) de chaque cran nommé : place du cran sur le curseur. */
export const SPACE_REF: Record<Space, number> = { none: 0, s: 12, m: 32, l: 56, xl: 88 };
export const WIDTH_REF: Record<"wide" | "medium" | "narrow", number> = { wide: 88, medium: 72, narrow: 56 };
export const spaceRef = (v: SpaceVal): number => (typeof v === "number" ? v : SPACE_REF[v]);
export const SPACE_LABELS: Record<Space, string> = { none: "Aucun", s: "S", m: "M", l: "L", xl: "XL" };
/**
 * Largeur d'un bloc de la page (lot 107) : le composant (son contenu et le fond et la carte posés dedans) ne prend pas toute la largeur, il est décollé
 * des bords, centré. Absent = pleine largeur (comme avant). `look.width`, mêmes écritures que les autres réglages de mise en page (intention `look`).
 */
export const BLOCK_WIDTHS = ["wide", "medium", "narrow"] as const;
export const SIDE_SPACES = ["s", "m", "l"] as const;
export type SideSpace = (typeof SIDE_SPACES)[number];
export type BlockWidth = (typeof BLOCK_WIDTHS)[number];
export type BlockWidthVal = BlockWidth | number;
export const BLOCK_WIDTH_LABELS: Record<BlockWidth | "full", string> = { full: "Pleine", wide: "Large", medium: "Moyenne", narrow: "Étroite" };
export const spaceLabel = (v: SpaceVal): string => (typeof v === "number" ? `${v} px` : SPACE_LABELS[v]);
export const widthLabel = (v: BlockWidthVal): string => (typeof v === "number" ? `${v} %` : BLOCK_WIDTH_LABELS[v]);
/** Valeur CSS d'un cran (tokens du thème, src/themes/css.ts). */
export const SPACE_VALUES: Record<Space, string> = {
  none: "0px",
  s: "var(--t-space-s)",
  m: "var(--t-space-m)",
  l: "var(--t-space-l)",
  xl: "var(--t-space-xl)",
};

export const RADII = ["none", "soft", "medium", "strong"] as const;
export type Radius = (typeof RADII)[number];
export const RADIUS_LABELS: Record<Radius, string> = { none: "Aucun", soft: "Léger", medium: "Moyen", strong: "Fort" };

export const SIZES = ["xs", "s", "m", "l", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl"] as const;
export type Size = (typeof SIZES)[number];
/**
 * Échelle typographique ABSOLUE (indépendante du thème) : chaque cran est
 * nettement plus grand que le précédent, à toute largeur d'écran (vérifié par
 * scripts/test-look.mjs de 320 à 2560 px). Corps fluides au-delà de XL ; les
 * plus grands crans dépassent le titre d'accueil des thèmes (144 px à 1440).
 */
export const SIZE_VALUES: Record<Size, string> = {
  xs: "0.75rem",
  s: "0.875rem",
  m: "1rem",
  l: "1.25rem",
  xl: "1.5rem",
  "2xl": "clamp(1.75rem, 3vw, 2.25rem)",
  "3xl": "clamp(2.25rem, 5vw, 3.25rem)",
  "4xl": "clamp(3rem, 8vw, 5rem)",
  "5xl": "clamp(3.75rem, 11vw, 7rem)",
  "6xl": "clamp(4.5rem, 14vw, 10rem)",
  "7xl": "clamp(5.5rem, 18vw, 13rem)",
};
/** Libellés de la liste : le cran et sa valeur (plage en px pour les corps fluides). */
export const SIZE_LABELS: Record<Size, string> = {
  xs: "XS · 12 px",
  s: "S · 14 px",
  m: "M · 16 px",
  l: "L · 20 px",
  xl: "XL · 24 px",
  "2xl": "2XL · 28–36 px",
  "3xl": "3XL · 36–52 px",
  "4xl": "4XL · 48–80 px",
  "5xl": "5XL · 60–112 px",
  "6xl": "6XL · 72–160 px",
  "7xl": "7XL · 88–208 px",
};

export const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
export const PALETTE = ["ink", "ink-soft", "primary", "secondary", "tertiary", "eyebrow", "bg", "surface"] as const;
export type PaletteColor = (typeof PALETTE)[number];
/**
 * Couleur libre d'un texte (sélecteur de l'éditeur) : `#rrggbb` ou `#rrggbbaa`,
 * minuscules. Format unique et borné : la valeur est écrite telle quelle dans
 * `color:`, rien d'autre ne peut y entrer.
 */
export const CustomColorSchema = z.string().max(9).regex(CUSTOM_COLOR_RE, "Couleur invalide (#rrggbb).");
/**
 * Noms des couleurs d'un texte : ceux des six rôles de la palette du site (« Fond de page », « Texte »,
 * « Boutons et liens »…, `ROLE_NAMES`), partout les mêmes ; les deux nuances gardent leur nom de nuance.
 */
export const PALETTE_LABELS: Record<PaletteColor, string> = {
  ink: ROLE_NAMES.ink,
  "ink-soft": NUANCE_NAMES["ink-soft"],
  primary: ROLE_NAMES.primary,
  secondary: ROLE_NAMES.secondary,
  tertiary: ROLE_NAMES.tertiary,
  eyebrow: NUANCE_NAMES.eyebrow,
  bg: ROLE_NAMES.bg,
  surface: ROLE_NAMES.surface,
};
/** Ordre d'affichage des couleurs d'un texte : les six rôles dans l'ordre du panneau « Couleurs », puis les deux nuances. */
export const PALETTE_DISPLAY: readonly PaletteColor[] = ["bg", "surface", "ink", "primary", "secondary", "tertiary", "ink-soft", "eyebrow"];

/** Rôles : liste unique dans le schéma du thème (typographie du thème, mêmes sélecteurs). */
export const ROLES = TEXT_ROLES;
export type Role = (typeof ROLES)[number];
export const ROLE_LABELS: Record<Role, string> = {
  h1: "Titre de page",
  h2: "Titres",
  eyebrow: "Étiquette",
  body: "Texte",
  caption: "Légende",
  menu: "Menu",
  brand: "Nom du site",
};
/**
 * Éléments visés par chaque rôle (feuille globale) : UN rôle par texte (lot 68). Le menu et le nom du
 * site passent avant les légendes : leurs liens portent aussi `.caption-text`.
 * « Titres » (h2) est la base de TOUS les titres, titre de page compris ; « Titre de page » (h1) n'en est que l'exception
 * (déclarée après : elle gagne). La taille de « Titres » ne vise que les titres de section (le titre de page garde la sienne).
 */
export const ROLE_SELECTORS: Record<Role, string> = {
  h1: "#contenu h1",
  h2: "#contenu :is(h1, h2, h3)",
  eyebrow: ".eyebrow",
  body: "#contenu :is(p, li):not(.eyebrow, .caption-text, .strip-caption)",
  caption: ":is(.caption-text, figcaption, .strip-caption):not(.site-header *)",
  menu: ".site-header :is(nav a, nav a > span, .text-line, button)",
  brand: ".site-brand",
};
/** Rôles dont la TAILLE ne vise qu'une partie des éléments du rôle. */
export const ROLE_SIZE_SELECTORS: Partial<Record<Role, string>> = { h2: "#contenu :is(h2, h3)" };
/**
 * Textes qui prennent la POLICE (graisse, italique, casse, espacement) d'un rôle mais pas sa taille ni sa couleur : boutons,
 * adresse e-mail, champs du formulaire de contact (ils ont leur propre taille et leur propre fond).
 */
export const ROLE_FONT_ONLY_SELECTORS: Partial<Record<Role, string>> = { body: ".btn, .email-link, footer :is(p, a):not(.eyebrow), #contenu :is(a.link-underline, input, textarea, select)" };
const FONT_PROPS = new Set(["font-family", "font-weight", "font-style", "text-transform", "letter-spacing"]);

/** Règles CSS d'un rôle (déclarations déjà calculées) : éléments du rôle, taille à part, police seule des textes à part. */
function roleRules(role: Role, decls: [string, string][], prefix: string): string[] {
  if (!decls.length) return [];
  const sizeSel = ROLE_SIZE_SELECTORS[role];
  const own = sizeSel ? decls.filter(([k]) => k !== "font-size") : decls;
  const size = sizeSel ? decls.filter(([k]) => k === "font-size") : [];
  const fontOnly = ROLE_FONT_ONLY_SELECTORS[role];
  const css = (list: [string, string][]) => list.map(([k, v]) => `${k}:${v}`).join(";");
  const out: string[] = [];
  if (own.length) out.push(`${prefix}${ROLE_SELECTORS[role]}{${css(own)}}`);
  if (size.length && sizeSel) out.push(`${prefix}${sizeSel}{${css(size)}}`);
  const font = fontOnly ? decls.filter(([k]) => FONT_PROPS.has(k)) : [];
  if (font.length && fontOnly) out.push(`${prefix}${fontOnly}{${css(font)}}`);
  return out;
}

export const BACKDROPS = ["none", "shadow", "band", "highlight"] as const;
export type Backdrop = (typeof BACKDROPS)[number];
export const BACKDROP_LABELS: Record<Backdrop, string> = { none: "Aucun", shadow: "Ombre douce", band: "Bandeau", highlight: "Surlignage" };
/**
 * Rôles qui ne peuvent techniquement pas recevoir de fond : la ligne « Fond » reste visible mais désactivée,
 * avec cette phrase en infobulle (jamais de disparition silencieuse). Aucun pour l'instant : les sept rôles
 * (titres, étiquette, texte, légende, menu, nom du site) et les textes de blocs en acceptent un.
 */
export const BACKDROP_BLOCKED: Partial<Record<Role, string>> = {};

/* ---- Polices ------------------------------------------------------------------ */

/**
 * Police d'un style : `theme:display|body|caption` (polices du thème),
 * `embed:<id>` (polices embarquées OFL, src/themes/fonts.ts), `g:<Famille>`
 * (Google Fonts, téléchargée et servie par le serveur).
 */
export const THEME_FONTS = ["display", "body", "caption"] as const;
export const THEME_FONT_LABELS: Record<(typeof THEME_FONTS)[number], string> = { display: "Titres du thème", body: "Texte du thème", caption: "Légendes du thème" };

export function isFontRef(v: string): boolean {
  const [kind, ...rest] = v.split(":");
  const name = rest.join(":");
  if (kind === "theme") return (THEME_FONTS as readonly string[]).includes(name);
  if (kind === "embed") return (FONT_IDS as readonly string[]).includes(name);
  if (kind === "g") return isGoogleFamily(name);
  return false;
}
export const FontRefSchema = z.string().max(80).refine(isFontRef, "Police inconnue : choisis-la dans le catalogue.");

/** Famille Google citée par une référence, ou null. */
export function googleOf(ref: string | undefined): string | null {
  return ref?.startsWith("g:") && isGoogleFamily(ref.slice(2)) ? ref.slice(2) : null;
}

/** Pile CSS d'une police (les noms Google sont du catalogue : lettres, chiffres, espaces). */
export function fontStack(ref: string): string | null {
  if (!isFontRef(ref)) return null;
  const [kind, ...rest] = ref.split(":");
  const name = rest.join(":");
  if (kind === "theme") return `var(--t-font-${name})`;
  if (kind === "embed") return FONT_STACKS[name as FontId].stack;
  const g = googleFamily(name)!;
  return `"${g.family}", ${CATEGORY_FALLBACK[g.category]}`;
}

export function fontLabel(ref: string): string {
  const [kind, ...rest] = ref.split(":");
  const name = rest.join(":");
  if (kind === "theme") return THEME_FONT_LABELS[name as (typeof THEME_FONTS)[number]] ?? name;
  if (kind === "embed") return FONT_STACKS[name as FontId]?.label ?? name;
  return name;
}

/* ---- Style d'un texte ------------------------------------------------------------ */

export const TextStyleSchema = z.strictObject({
  font: FontRefSchema.optional(),
  size: z.enum(SIZES).optional(),
  /** Ajustement fin de la taille (×0,5 à ×2) ; sans effet sans `size` (aucune base à ajuster). */
  scale: z.number().min(0.5).max(2).optional(),
  weight: z
    .number()
    .int()
    .refine((w) => (WEIGHTS as readonly number[]).includes(w), "Graisse invalide.")
    .optional(),
  italic: z.boolean().optional(),
  /** Casse : normale, ou MAJUSCULES. */
  case: z.enum(["normal", "upper"]).optional(),
  /** Interlettrage, en em. */
  tracking: z.number().min(-0.05).max(0.4).optional(),
  /** Teinte de la palette du thème, ou couleur libre (#rrggbb[aa]). */
  color: z.union([z.enum(PALETTE), CustomColorSchema]).optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  /** Fond derrière le texte (lot 21) : même définition pour tous les rôles et les textes de blocs. */
  backdrop: z.enum(BACKDROPS).optional(),
  /**
   * Couleur de ce fond : jeton de la palette ou teinte douce (suit la palette), ou `#rrggbb[aa]`, comme les cartes.
   * Absente (« Auto ») : la couleur du thème. Sans effet sans `backdrop`.
   */
  backdropColor: z.union([z.enum(SURFACE_TOKENS), CustomColorSchema]).optional(),
  /** Aération du fond (lot 68) : Serré · Normal · Aéré. Absente : celle du thème (« Normal » par défaut). Sans effet sans fond Bandeau ou Surlignage. */
  air: z.enum(AIRS).optional(),
});
export type TextStyle = z.infer<typeof TextStyleSchema>;

/** Le style local surcharge le global, propriété par propriété. */
export function resolveTextStyle(global: TextStyle | undefined, local: TextStyle | undefined): TextStyle {
  const out: TextStyle = { ...(global ?? {}) };
  for (const [k, v] of Object.entries(local ?? {})) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * Déclarations CSS d'un style (propriétés kebab-case), valeurs déjà bornées. `palette` (palette effective du
 * thème) sert à choisir la couleur de texte lisible sur un fond coloré ; sans elle, le fond reste appliqué.
 */
export function textStyleDecls(style: TextStyle | undefined, palette?: CardPalette, role = false): [string, string][] {
  const parsed = TextStyleSchema.safeParse(style ?? {});
  if (!parsed.success) return [];
  const s = parsed.data;
  const out: [string, string][] = [];
  const stack = s.font ? fontStack(s.font) : null;
  if (stack) out.push(["font-family", stack]);
  // L'ajustement se compte sur un cran : sans cran, « 1em » serait la taille du
  // PARENT (pas celle du thème pour ce rôle) et le texte s'effondrerait.
  if (s.size) out.push(["font-size", s.scale && s.scale !== 1 ? `calc(${SIZE_VALUES[s.size]} * ${round(s.scale)})` : SIZE_VALUES[s.size]]);
  if (s.weight) out.push(["font-weight", String(s.weight)]);
  if (s.italic !== undefined) out.push(["font-style", s.italic ? "italic" : "normal"]);
  if (s.case) out.push(["text-transform", s.case === "upper" ? "uppercase" : "none"]);
  if (s.tracking !== undefined) out.push(["letter-spacing", `${round(s.tracking)}em`]);
  // Fond avant la couleur : un texte de couleur choisie garde sa couleur (déclaration suivante).
  out.push(...backdropDecls(s.backdrop, s.backdrop === "none" ? undefined : s.backdropColor, { palette, userColor: Boolean(s.color), role, air: s.air }));
  if (s.color) out.push(["color", (PALETTE as readonly string[]).includes(s.color) ? `var(--t-color-${s.color})` : s.color]);
  if (s.align) out.push(["text-align", s.align]);
  return out;
}

/** Style React (camelCase) d'un style local. */
export function textStyleObject(style: TextStyle | undefined, palette?: CardPalette): Record<string, string> | undefined {
  const decls = textStyleDecls(style, palette);
  if (!decls.length) return undefined;
  return Object.fromEntries(decls.map(([k, v]) => [k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()), v]));
}

/* ---- Cadrage ------------------------------------------------------------------- */

export const CropSchema = z.strictObject({
  /** Point focal (object-position), en % de l'image. */
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
  /** Zoom autour du point focal (1 = image entière dans son cadre). */
  zoom: z.number().min(1).max(4),
  /**
   * Recadrage libre (rectangle normalisé de l'image entière, voir images/crop.ts) : quand il est
   * présent, il remplace point focal et zoom (laissés à 50 / 50 / 1) ; le cadre suit son rapport.
   */
  rect: RectSchema.optional(),
});
export type Crop = z.infer<typeof CropSchema>;
export const CROP_FIELDS = ["mediaId", "backgroundMediaId", "portraitMediaId"] as const;
/** Tuiles de collection (accueil) : un cadrage par collection montrée. */
export const TILE_KEYS = ["characters", "backgrounds", "animation"] as const;
export type TileKey = (typeof TILE_KEYS)[number];

/**
 * Fenêtre gardée (fractions de l'image) pour un cadrage, une image de ratio
 * `imageRatio` (l/h) tenue en « cover » dans un cadre de ratio `boxRatio`.
 * object-position x % place la fenêtre ; le zoom la réduit autour du point
 * focal : fenêtre = (largeur couverte / zoom), gauche = x · (1 − largeur).
 */
export function cropWindow(crop: Crop, imageRatio: number, boxRatio: number): { left: number; top: number; width: number; height: number } {
  const fw = imageRatio > boxRatio ? boxRatio / imageRatio : 1;
  const fh = imageRatio > boxRatio ? 1 : imageRatio / boxRatio;
  const width = fw / crop.zoom;
  const height = fh / crop.zoom;
  return { left: (crop.x / 100) * (1 - width), top: (crop.y / 100) * (1 - height), width, height };
}

/** Inverse : cadrage d'une fenêtre (gauche / haut en fractions) à un zoom donné. */
export function cropFromWindow(left: number, top: number, zoom: number, imageRatio: number, boxRatio: number): Crop {
  const z = Math.min(4, Math.max(1, zoom));
  const { width, height } = cropWindow({ x: 0, y: 0, zoom: z }, imageRatio, boxRatio);
  const pct = (pos: number, size: number) => (size >= 0.9999 ? 50 : Math.min(100, Math.max(0, (pos / (1 - size)) * 100)));
  return { x: round(pct(left, width), 2), y: round(pct(top, height), 2), zoom: round(z, 3) };
}

/** Image au format de son cadre (à 2 % près) : rien à cadrer. */
export function needsCrop(imageRatio: number, boxRatio: number): boolean {
  return Math.abs(imageRatio / boxRatio - 1) > 0.02;
}

/* ---- Cadre autour d'une photo ou d'une vidéo (lots 34, 58, 62) ---------------------------------- */

/**
 * Un seul choix par photo ou vidéo (lot 62) : « Aucun » (`none`), « Cadre du thème » (`theme` : le cadre dessiné dans le kit),
 * « Bordure » (`band` : un filet d'épaisseur et de couleur choisies) ou, plus tard, un cadre de la bibliothèque
 * (`custom`, `id` = son identifiant ; lot 74 : proposé dans le menu « Cadre » sous le nom « Cadre perso », rendu par src/themes/frame-library.ts).
 * Sans choix (réglage absent), la photo suit le réglage du site « Cadre du thème sur toutes les photos » (non par défaut).
 */
export const FRAME_KINDS = ["none", "theme", "band", "custom"] as const;
export type FrameKind = (typeof FRAME_KINDS)[number];
/** Épaisseurs de la bande de couleur (largeurs réelles en CSS : src/app/look.css, adaptées au téléphone). */
export const FRAME_WIDTHS = ["fin", "moyen", "epais"] as const;
export type FrameWidth = (typeof FRAME_WIDTHS)[number];
export const FRAME_WIDTH_LABELS: Record<FrameWidth, string> = { fin: "Fin", moyen: "Moyen", epais: "Épais" };
export const FRAME_DEFAULT_WIDTH: FrameWidth = "moyen";
export const FRAME_KIND_LABELS: Record<FrameKind, string> = { none: "Aucun", theme: "Cadre du thème", band: "Bordure", custom: "Cadre perso" };
/**
 * Couleur de la bande quand rien n'est choisi (« Couleur par défaut ») : le texte du thème (`ink`). C'est la seule teinte
 * lisible sur le papier de tous les thèmes livrés (l'ornement `tertiary` est presque invisible sur le thème Studio : 1,7:1)
 * et elle suit le thème (claire sur un thème sombre).
 */
export const FRAME_DEFAULT_COLOR: PaletteColor = "ink";

/** Anciennes épaisseurs (avant le lot 62 : `size`) → nouvelles. */
const LEGACY_FRAME_WIDTHS: Record<string, FrameWidth> = { thin: "fin", medium: "moyen", thick: "epais" };

/**
 * Ancien réglage de cadre (avant le lot 62 : `{ size: "thin" | "medium" | "thick" | "none", color? }`) → nouvelle forme, sans changer le
 * rendu d'un choix explicite : « none » = Aucun, une épaisseur = Bordure de cette épaisseur. Une valeur déjà à la nouvelle forme,
 * ou qui n'est pas un ancien cadre, est rendue telle quelle. Idempotent. Sert à la migration des données ET à la lecture (sauvegarde ancienne,
 * brouillon non migré).
 */
export function upgradeFrame(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const o = raw as Record<string, unknown>;
  if ("kind" in o || !("size" in o)) return raw;
  const { size, color, ...rest } = o;
  if (Object.keys(rest).length) return raw;
  if (size === "none") return { kind: "none" };
  if (typeof size === "string" && Object.hasOwn(LEGACY_FRAME_WIDTHS, size)) return { kind: "band", width: LEGACY_FRAME_WIDTHS[size], ...(color !== undefined ? { color } : {}) };
  return raw;
}

const FrameCoreSchema = z
  .strictObject({
    kind: z.enum(FRAME_KINDS),
    /** Cadre de la bibliothèque (`kind: "custom"` seulement). */
    id: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/).optional(),
    /** Couleur de la bande : clé de palette ou `#rrggbb[aa]` ; absente = la couleur par défaut. */
    color: z.union([z.enum(PALETTE), CustomColorSchema]).optional(),
    /** Épaisseur de la bande ; absente = Moyen. */
    width: z.enum(FRAME_WIDTHS).optional(),
  })
  .refine((f) => (f.kind === "custom") === (f.id !== undefined), { message: "Un cadre de la bibliothèque porte son identifiant (et lui seul)." })
  .refine((f) => f.kind === "band" || (f.color === undefined && f.width === undefined), { message: "Couleur et épaisseur ne vont qu'avec une bande de couleur." });
/** Cadre d'une photo ou d'une vidéo. Absent = pas de choix (suit le site). Les anciens réglages (`size`) sont relus à la nouvelle forme. */
export const FrameSchema = z.preprocess(upgradeFrame, FrameCoreSchema);
export type Frame = z.infer<typeof FrameCoreSchema>;

/**
 * Couleur CSS d'une bande : teinte de la palette (suit le thème), couleur libre, ou la couleur par défaut.
 *
 * Lot 95 : une teinte CHOISIE passe par `--t-color-x` (la couleur du thème, celle de la pastille du menu), jamais par `--color-x`. Dans une
 * carte ou sur un fond de couleur, la zone REMAPPE `--color-ink`, `--color-ink-soft`, `--color-primary`, `--color-secondary` et `--color-eyebrow`
 * (variante lisible pour du TEXTE, src/app/look.css) : le cadre prenait alors une autre couleur que sa pastille (lot 64 croyait le contraire).
 * `--t-color-x` n'est jamais remappée ; le thème la pose sur `:root` (et l'accent de page, qui pose les deux).
 */
export function frameColorCss(color: string | undefined): string {
  // « Texte » = la couleur par défaut (même variable, adaptée à la zone) : en `--t-color-ink`, le cadre se confondrait avec une carte sombre.
  if (color === FRAME_DEFAULT_COLOR) return `var(--color-${FRAME_DEFAULT_COLOR})`;
  if (color && (PALETTE as readonly string[]).includes(color)) return `var(--t-color-${color})`;
  if (color && CUSTOM_COLOR_RE.test(color)) return color;
  // Sans choix : `--color-ink`, le texte du thème, mais remappé en encre LISIBLE dans une carte ou sur un fond de couleur (lot 32) : un cadre
  // par défaut ne disparaît pas sur un fond sombre. C'est la seule couleur qui s'adapte à l'endroit où se trouve la photo.
  return `var(--color-${FRAME_DEFAULT_COLOR})`;
}

export type FrameRender = {
  /** Attributs à poser sur l'élément qui porte le cadre (src/app/look.css et src/themes/variants.css s'y accrochent). */
  attrs: { "data-frame": FrameKind; "data-frame-w"?: FrameWidth; "data-frame-id"?: string };
  /** Variables CSS (`--frame-color`) à poser avec. */
  style: Record<string, string>;
};

/**
 * LE point de rendu d'un cadre (photo et vidéo : image seule, case de grille, planche, carrousel, Planche libre, vidéo seule) :
 * le choix, tel quel, en attributs + variables. Ce qui s'affiche est exactement le choix coché. `null` = pas de choix (ou choix
 * invalide) : aucun attribut, la photo suit le réglage du site « Cadre du thème sur toutes les photos ».
 */
export function frameStyle(frame: unknown): FrameRender | null {
  const ok = frame === undefined || frame === null ? null : FrameSchema.safeParse(frame);
  if (!ok || !ok.success) return null;
  const f = ok.data;
  if (f.kind === "band") return { attrs: { "data-frame": "band", "data-frame-w": f.width ?? FRAME_DEFAULT_WIDTH }, style: { "--frame-color": frameColorCss(f.color) } };
  if (f.kind === "custom") return { attrs: { "data-frame": "custom", "data-frame-id": f.id }, style: {} };
  return { attrs: { "data-frame": f.kind }, style: {} };
}

/** Réglage du site « Cadre du thème sur toutes les photos » (réglage `themeFrameAll`, non par défaut) : lecture tolérante. */
export const readThemeFrameAll = (raw: unknown): boolean => raw === true;

/* ---- Taille et alignement d'une image seule (lot 40) ------------------------------- */

/** Taille d'une image seule : Normale (plafond de 85 % de la hauteur de l'écran, rien d'enregistré), Grande (plafond levé : toute la largeur du cadre). */
export const IMAGE_SIZES = ["normal", "large"] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];
export const IMAGE_SIZE_LABELS: Record<ImageSize, string> = { normal: "Normale", large: "Grande" };
export const IMAGE_ALIGNS = ["left", "center", "right"] as const;
export type ImageAlign = (typeof IMAGE_ALIGNS)[number];
export const IMAGE_ALIGN_LABELS: Record<ImageAlign, string> = { left: "Gauche", center: "Centre", right: "Droite" };

/* ---- Fond derrière une image (lot 41) -------------------------------------------- */

/**
 * Fond d'une image (utile derrière un PNG détouré) : « card » = la couleur des cartes du thème, une teinte de la palette
 * (suit le thème), ou une couleur libre `#rrggbb[aa]` (le blanc en est une : `IMAGE_BG_WHITE`). Absent = aucun fond (transparent).
 */
export const ImageBgSchema = z.union([z.literal(IMAGE_BG_CARD), z.enum(PALETTE), CustomColorSchema]);
export type ImageBg = z.infer<typeof ImageBgSchema>;

/**
 * Couleur CSS d'un fond d'image, ou null (absent / invalide : aucun fond). « Couleur de la carte » = la carte RÉELLEMENT sous l'image
 * (`--card-bg`, posée par la carte et par le fond de composant), sinon la couleur des cartes du thème ; une teinte de la palette passe par
 * `--t-color-x` (lot 100 ; `--color-x` est remappé dans une carte).
 */
export function imageBgCss(bg: string | undefined): string | null {
  if (bg === undefined) return null;
  if (bg === IMAGE_BG_CARD) return "var(--card-bg, var(--t-color-surface))";
  // Lot 100 (même règle que le cadre, lot 95) : une teinte CHOISIE est la couleur du thème (`--t-color-x`, celle de la pastille), jamais `--color-x` : dans une carte ou sur un fond
  // de couleur, la zone remappe `--color-ink`, `--color-primary`… en variante lisible pour du texte, et le fond prenait une autre couleur que sa pastille.
  if ((PALETTE as readonly string[]).includes(bg)) return `var(--t-color-${bg})`;
  if (CUSTOM_COLOR_RE.test(bg)) return bg;
  return null;
}

/** Attributs de rendu d'un fond d'image (`data-img-bg` + variable `--img-bg`, lues par src/app/look.css), ou null sans fond. */
export function imageBgAttrs(bg: string | undefined): { "data-img-bg": ""; style: Record<string, string> } | null {
  const css = imageBgCss(bg);
  return css ? { "data-img-bg": "", style: { "--img-bg": css } } : null;
}

/* ---- Habillage d'un média : UN module de données pour toutes les photos et vidéos (lot 64) ---------------------------------- */

/**
 * Habillage d'une photo ou d'une vidéo, quel que soit son conteneur (image seule, vidéo seule, case de grille, composant de planche,
 * place d'un carrousel, image de la Planche libre) : cadre, fond derrière le média, arrondi propre. Chaque conteneur lit SES clés
 * (`look.frame` / `look.imageBg`, `slotLook[slug]`, `items[].frame` / `.bg` / `.radius`) et les passe ici :
 * le rendu est le même (composant MediaFrame).
 */
export type MediaLook = { frame?: unknown; bg?: string; radius?: Radius };
export type MediaLookRender = {
  /** Attributs de la boîte du média (`data-frame`, `data-frame-w`, `data-frame-id`, `data-img-bg`) : src/app/media-frame.css s'y accroche. */
  attrs: Record<string, string>;
  /** Variables CSS (`--frame-color`, `--img-bg`, `--media-radius`) à poser avec. */
  style: Record<string, string>;
};

/** LE point de rendu de l'habillage d'un média (cadre + fond + arrondi propre) : jamais lu ailleurs que par MediaFrame. */
export function mediaLookAttrs(look: MediaLook | undefined): MediaLookRender {
  const f = frameStyle(look?.frame);
  const b = imageBgAttrs(look?.bg);
  const radius = look?.radius && Object.hasOwn(RADIUS_VALUES, look.radius) ? RADIUS_VALUES[look.radius] : undefined;
  return {
    attrs: { ...(f?.attrs ?? {}), ...(b ? { "data-img-bg": "" } : {}) },
    style: { ...(f?.style ?? {}), ...(b?.style ?? {}), ...(radius ? { "--media-radius": radius } : {}) },
  };
}

/* ---- Habillage ENREGISTRÉ d'un média (lot 75, R4) ------------------------------------------------------------------------- */

/** Lecture d'une vidéo (Boucle / Lecteur) et mise en page d'un panorama (entier / à faire défiler) d'une place de carrousel. */
export const SLOT_VIDEO_MODES = ["loop", "player"] as const;
export const SLOT_PANO_MODES = ["fit", "scroll"] as const;
export type SlotVideoMode = (typeof SLOT_VIDEO_MODES)[number];
export type SlotPanoMode = (typeof SLOT_PANO_MODES)[number];

/**
 * Tout ce que l'artiste règle pour UN média, sous une seule forme (lot 75) : cadre, fond derrière l'image, arrondi, panorama et lecture
 * de la vidéo. Une place de carrousel le garde dans `look.slotLook[slug]` (elle remplace les cinq cartes `slotFrame`, `slotBg`,
 * `slotRadius`, `slotPano` et `slotVideo`), une image de la Planche libre dans `frame` / `bg` / `radius` de sa ligne.
 */
export const MediaLookDataSchema = z.strictObject({
  frame: FrameSchema.optional(),
  bg: ImageBgSchema.optional(),
  radius: z.enum(RADII).optional(),
  pano: z.enum(SLOT_PANO_MODES).optional(),
  video: z.enum(SLOT_VIDEO_MODES).optional(),
});
export type MediaLookData = z.infer<typeof MediaLookDataSchema>;
export const MEDIA_LOOK_FIELDS = ["frame", "bg", "radius", "pano", "video"] as const;
export type MediaLookField = (typeof MEDIA_LOOK_FIELDS)[number];

/** Anciennes cartes par place (avant le lot 75) → champ de `slotLook[slug]`. */
const LEGACY_SLOT_MAPS = { slotFrame: "frame", slotBg: "bg", slotRadius: "radius", slotPano: "pano", slotVideo: "video" } as const;

/**
 * Ancien `look` (cinq cartes par place : `slotFrame`, `slotBg`, `slotRadius`, `slotPano`, `slotVideo`) → nouvelle forme (`slotLook`), sans
 * changer ce qui s'affiche. Une valeur déjà posée dans `slotLook` prime. Idempotent ; une valeur qui n'est pas un `look` à l'ancienne
 * forme est rendue telle quelle (même objet). Sert à la migration des données ET à la lecture (sauvegarde ancienne, brouillon non migré).
 */
export function upgradeLook(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const o = raw as Record<string, unknown>;
  if (!Object.keys(LEGACY_SLOT_MAPS).some((k) => k in o)) return raw;
  const out: Record<string, unknown> = {};
  const slots: Record<string, Record<string, unknown>> = {};
  const own = o.slotLook;
  if (own && typeof own === "object" && !Array.isArray(own)) {
    for (const [slug, v] of Object.entries(own)) if (v && typeof v === "object" && !Array.isArray(v)) slots[slug] = { ...(v as Record<string, unknown>) };
  }
  for (const [key, value] of Object.entries(o)) {
    if (!Object.hasOwn(LEGACY_SLOT_MAPS, key)) {
      out[key] = value;
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const field = LEGACY_SLOT_MAPS[key as keyof typeof LEGACY_SLOT_MAPS];
    for (const [slug, v] of Object.entries(value)) {
      if (v === undefined) continue;
      const entry = (slots[slug] ??= {});
      if (entry[field] === undefined) entry[field] = v;
    }
  }
  if (Object.keys(slots).length) out.slotLook = slots;
  else delete out.slotLook;
  return out;
}

/* ---- Réglages d'un bloc (props.look) --------------------------------------------- */

/**
 * Lot 120 : portée « Tout le projet » d'une planche de projet. Une clé par TYPE de texte (titres, étiquettes, textes, et les trois champs d'une légende) ;
 * la valeur est un style de texte. Elle se range dans les réglages (`props.look.projectText`) du bloc « planche de projet » qui montre le projet,
 * donc propre à CETTE page (comme le contenu de la planche, lot 111), jamais dans la table des projets.
 */
export const PROJECT_TEXT_KEYS = ["h2", "eyebrow", "body", "cap.title", "cap.legend", "cap.date"] as const;
export type ProjectTextKey = (typeof PROJECT_TEXT_KEYS)[number];
/** Légendes : le style du projet est posé en ligne sur chaque légende (avec celui de la légende seule) ; les autres types passent par une feuille. */
export const PROJECT_CAPTION_KEYS: Record<"title" | "legend" | "date", ProjectTextKey> = { title: "cap.title", legend: "cap.legend", date: "cap.date" };

/** Chemin d'un texte du bloc (comme `inline` au registre) ; `site.name` / `site.role` : textes du site posés dans le bloc. */
export const TEXT_PATH_RE = /^([a-zA-Z]+(\.(\d{1,2}|[a-zA-Z]+))*|captions\.[a-z0-9-]{1,60}\.(title|caption|date))$/;
const TextPath = z.string().max(80).regex(TEXT_PATH_RE);
/** Plafond des styles de texte d'un bloc (lot 98 : 40 faisait perdre TOUS les réglages d'un gros carrousel). */
export const MAX_TEXT_STYLES = 600;
const bounded = <T extends z.ZodType>(rec: T, max: number, label: string) =>
  rec.refine((v) => Object.keys(v as object).length <= max, `${max} ${label} au plus.`);

const SpaceSchema = z.union([z.enum(SPACES), z.number().int().min(0).max(SPACE_MAX)]);
const LookCoreSchema = z.strictObject({
  spaceTop: SpaceSchema.optional(),
  spaceBottom: SpaceSchema.optional(),
  /**
   * Lot 107, DEHORS (la page se voit, jamais le papier du fond ni de la carte) : largeur du bloc (côtés, absent = pleine) et marge extérieure haut / bas.
   * DEDANS (couverts par le fond et la carte) : `spaceTop` / `spaceBottom` (depuis toujours, en padding) et `spaceSides` (côtés).
   */
  width: z.union([z.enum(BLOCK_WIDTHS), z.number().int().min(WIDTH_MIN).max(99)]).optional(),
  marginTop: SpaceSchema.optional(),
  marginBottom: SpaceSchema.optional(),
  spaceSides: z.union([z.enum(SIDE_SPACES), z.number().int().min(0).max(SIDE_MAX)]).optional(),
  /**
   * Lot 129 : espacement intérieur HAUT / BAS de la zone colorée (carte, fond) : la distance entre son bord et le contenu. Absent = le rembourrage
   * d'avant (carte : « M » du thème ; fond seul : l'espace de section). Mêmes crans et mêmes valeurs repères que `spaceTop` / `spaceBottom`,
   * dont il se distingue : eux se posent SUR le premier / dernier élément du bloc (et s'ajoutent au rembourrage de la zone), celui-ci REMPLACE ce rembourrage. Sans carte ni fond : sans effet.
   */
  padTop: SpaceSchema.optional(),
  padBottom: SpaceSchema.optional(),
  radius: z.enum(RADII).optional(),
  titleV: z.enum(["top", "middle", "bottom"]).optional(),
  titleH: z.enum(["left", "center", "right"]).optional(),
  text: bounded(z.record(TextPath, TextStyleSchema), MAX_TEXT_STYLES, "styles de texte").optional(),
  /** Lot 120 : style de TOUS les textes d'un type dans cette planche de projet (voir `PROJECT_TEXT_KEYS`). */
  projectText: z.partialRecord(z.enum(PROJECT_TEXT_KEYS), TextStyleSchema).optional(),
  crop: z.partialRecord(z.enum(CROP_FIELDS), CropSchema).optional(),
  /** Cadrage de l'image de chaque tuile d'un bloc « tuiles de collection », par collection. */
  tileCrop: z.partialRecord(z.enum(TILE_KEYS), CropSchema).optional(),
  /** Ancien fond du métier de l'ouverture (avant le lot 21) : toujours rendu tel quel ; la barre le migre dans `text['site.role'].backdrop` à la première modification. */
  roleBackdrop: z.enum(BACKDROPS).optional(),
  /**
   * Arrondi d'une image précise d'une planche (intégration lots 2 + 3), par
   * emplacement (slug de l'emplacement) : surcharge l'arrondi du bloc.
   */
  /** Cadre autour de la photo d'un bloc Image (page, case de grille) : lot 34. */
  frame: FrameSchema.optional(),
  /** Image seule (page ou planche, lot 40) : « large » lève le plafond de hauteur ; absent = Normale (comme avant). */
  imageSize: z.enum(["large"]).optional(),
  /** Image seule (lot 40) : place de l'image (et de sa légende) dans le cadre ; absent = comme avant (centrée, légende pleine largeur). */
  imageAlign: z.enum(IMAGE_ALIGNS).optional(),
  /** Fond derrière l'image d'un bloc Image (page, case de grille, image de planche) : lot 41. */
  imageBg: ImageBgSchema.optional(),
  /**
   * Habillage de chaque place d'un carrousel (lot 75, R4), par emplacement (slug) : cadre, fond d'image, arrondi, panorama et lecture de
   * la vidéo, en UNE carte (avant : `slotFrame`, `slotBg`, `slotRadius`, `slotPano`, `slotVideo`, relues par `upgradeLook`). Il suit la place
   * (déplacée, image remplacée). Propriétaire : la rubrique de la page qui montre la planche (voir le rapport du lot 75).
   */
  slotLook: bounded(z.record(z.string().max(80).regex(/^[a-z0-9-]+$/), MediaLookDataSchema), 500, "habillages d'images").optional(),
});
export const LookSchema = z.preprocess(upgradeLook, LookCoreSchema);
export type Look = z.infer<typeof LookSchema>;

/** Lecture tolérante : un réglage invalide est ignoré, jamais fatal. L'ancienne forme des places de carrousel est relue en `slotLook`. */
export function readLook(raw: unknown): Look | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const parsed = LookSchema.safeParse(raw);
  if (parsed.success) return isEmptyLook(parsed.data) ? undefined : parsed.data;
  // Garde ce qui passe, clé par clé (les places d'un carrousel : place par place, champ par champ).
  const up = upgradeLook(raw) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(up)) {
    const one = LookSchema.safeParse({ [k]: v });
    if (one.success) Object.assign(out, one.data);
    else if (k === "text" && v && typeof v === "object" && !Array.isArray(v)) {
      // Lot 98 : un style illisible (ou en trop) ne fait jamais perdre les autres textes du bloc.
      const texts: Record<string, unknown> = {};
      for (const [path, style] of Object.entries(v)) {
        if (Object.keys(texts).length >= MAX_TEXT_STYLES) break;
        const ok = LookSchema.safeParse({ text: { [path]: style } });
        if (ok.success) Object.assign(texts, (ok.data as Look).text);
      }
      if (Object.keys(texts).length) Object.assign(out, { text: texts });
    } else if (k === "slotLook" && v && typeof v === "object" && !Array.isArray(v)) {
      const slots: Record<string, unknown> = {};
      for (const [slug, entry] of Object.entries(v)) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        const keep: Record<string, unknown> = {};
        for (const [f, x] of Object.entries(entry)) {
          const ok = LookSchema.safeParse({ slotLook: { [slug]: { [f]: x } } });
          if (ok.success) Object.assign(keep, (ok.data as Look).slotLook?.[slug]);
        }
        if (Object.keys(keep).length) slots[slug] = keep;
      }
      if (Object.keys(slots).length) {
        const ok = LookSchema.safeParse({ slotLook: slots });
        if (ok.success) Object.assign(out, ok.data);
      }
    }
  }
  return isEmptyLook(out as Look) ? undefined : (out as Look);
}

export function isEmptyLook(look: Look | undefined): boolean {
  if (!look) return true;
  return Object.values(look).every((v) => v === undefined || (typeof v === "object" && v !== null && Object.keys(v).length === 0));
}

/** Retire les clés vides (un « Auto » remis efface le réglage). Les habillages de places (`slotLook`) sont nettoyés champ par champ. */
export function cleanLook(look: Look): Look | undefined {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(upgradeLook(look) as Look)) {
    if (v === undefined) continue;
    if (k === "slotLook" && v && typeof v === "object") {
      const slots: Record<string, unknown> = {};
      for (const [slug, entry] of Object.entries(v as Record<string, Record<string, unknown>>)) {
        const inner = Object.fromEntries(Object.entries(entry ?? {}).filter(([, x]) => x !== undefined));
        if (Object.keys(inner).length) slots[slug] = inner;
      }
      if (Object.keys(slots).length) out[k] = slots;
    } else if (v && typeof v === "object") {
      const inner = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined && !(x && typeof x === "object" && Object.keys(x).length === 0)));
      if (Object.keys(inner).length) out[k] = inner;
    } else out[k] = v;
  }
  return Object.keys(out).length ? (out as Look) : undefined;
}

/**
 * Attributs de l'enveloppe d'un bloc (`.blk`, display: contents) : la feuille
 * src/app/look.css s'y accroche. Aucun attribut = aucune enveloppe.
 */
export function lookAttributes(look: Look | undefined): Record<string, string> | null {
  if (!look) return null;
  const a: Record<string, string> = {};
  if (look.spaceTop !== undefined) a["data-pt"] = typeof look.spaceTop === "number" ? "n" : look.spaceTop;
  if (look.spaceBottom !== undefined) a["data-pb"] = typeof look.spaceBottom === "number" ? "n" : look.spaceBottom;
  if (look.spaceSides !== undefined) a["data-ps"] = typeof look.spaceSides === "number" ? "n" : look.spaceSides;
  if (look.padTop !== undefined) a["data-zt"] = typeof look.padTop === "number" ? "n" : look.padTop;
  if (look.padBottom !== undefined) a["data-zb"] = typeof look.padBottom === "number" ? "n" : look.padBottom;
  if (look.radius) a["data-radius"] = look.radius;
  if (look.titleV) a["data-tv"] = look.titleV;
  if (look.titleH) a["data-th"] = look.titleH;
  if (look.roleBackdrop) a["data-role-bd"] = look.roleBackdrop;
  const crop = look.crop && Object.values(look.crop)[0];
  // Recadrage libre : l'image affichée EST la zone gardée (variante extraite), rien à décaler ni à zoomer en CSS.
  if (crop && !crop.rect) a["data-crop"] = "";
  return Object.keys(a).length ? a : null;
}

/** Valeurs numériques (lot 108) des espaces intérieurs, en variables CSS de l'enveloppe `.blk` ; absent si tout est nommé. */
export function spaceStyle(look: Look | undefined): Record<string, string> | undefined {
  if (!look) return undefined;
  const o: Record<string, string> = {};
  if (typeof look.spaceTop === "number") o["--kn-pt"] = `${look.spaceTop}px`;
  if (typeof look.spaceBottom === "number") o["--kn-pb"] = `${look.spaceBottom}px`;
  if (typeof look.spaceSides === "number") o["--kn-ps"] = `${look.spaceSides}px`;
  return Object.keys(o).length ? o : undefined;
}
/**
 * Lot 129 : variables posées sur la carte et le fond (les enveloppes de zone, pas `.blk` : un enfant ne règle pas son parent en CSS) : `--zy-t` / `--zy-b` = distance entre le bord
 * de la zone colorée et le contenu, en haut / en bas. Absentes : look.css retombe sur le rembourrage d'avant (`var(--zy-t, …)`), rendu inchangé.
 */
export function zoneStyle(look: Look | undefined): Record<string, string> | undefined {
  if (!look || (look.padTop === undefined && look.padBottom === undefined)) return undefined;
  const px = (v: SpaceVal) => (typeof v === "number" ? `${v}px` : SPACE_VALUES[v]);
  const o: Record<string, string> = {};
  if (look.padTop !== undefined) o["--zy-t"] = px(look.padTop);
  if (look.padBottom !== undefined) o["--zy-b"] = px(look.padBottom);
  return o;
}
/** Idem pour l'enveloppe extérieure `.blk-out` (largeur en %, marges en px). */
export function outerStyle(look: Look | undefined): Record<string, string> | undefined {
  if (!look) return undefined;
  const o: Record<string, string> = {};
  if (typeof look.width === "number") o["--kn-w"] = `${look.width}%`;
  if (typeof look.marginTop === "number") o["--kn-mt"] = `${look.marginTop}px`;
  if (typeof look.marginBottom === "number") o["--kn-mb"] = `${look.marginBottom}px`;
  return Object.keys(o).length ? o : undefined;
}

/** Variables de cadrage posées sur l'enveloppe (un seul média recadrable par bloc). */
export function cropStyle(look: Look | undefined): Record<string, string> | undefined {
  const crop = look?.crop && Object.values(look.crop)[0];
  return crop && !crop.rect ? cropVars(crop) : undefined;
}

/** Variables CSS d'un cadrage (`--crop-pos`, `--crop-zoom`), lues par src/app/look.css. */
export function cropVars(crop: Crop): Record<string, string> {
  return { "--crop-pos": `${round(crop.x, 2)}% ${round(crop.y, 2)}%`, "--crop-zoom": String(round(crop.zoom)) };
}

/* ---- Styles du site (globaux) --------------------------------------------------------- */

/**
 * Préfixe de spécificité des styles du site : un réglage de l'utilisateur doit
 * toujours gagner sur les variantes du thème (`[data-caption] .eyebrow`,
 * `[data-header] .site-brand`…, spécificité 0,2,0) et sur les classes des blocs.
 * Sans lui, la taille choisie était ignorée sur ces rôles (lot 7).
 */
const WIN = ":root:root:root";


/**
 * Palette du site (lot 17f) : couleurs de BASE choisies depuis l'éditeur visuel,
 * par-dessus celles du thème (jamais écrites dans le thème). `#rrggbb` opaque,
 * minuscules ; les nuances (fond profond, filets, survol…) en sont recalculées
 * (src/themes/site-palette.ts). Absent = la couleur du thème.
 */
const BaseColor = z.string().max(7).regex(/^#[0-9a-f]{6}$/, "Couleur invalide (#rrggbb).");
/** Nuance (lot 29) : une couleur, ou « auto » = le calcul (même si le thème avait forcé une valeur). */
const NuanceColor = z.union([BaseColor, z.literal("auto")]);
export const SitePaletteSchema = z.strictObject({
  ...(Object.fromEntries(BASE_KEYS.map((k) => [k, BaseColor.optional()])) as Record<(typeof BASE_KEYS)[number], z.ZodOptional<typeof BaseColor>>),
  ...(Object.fromEntries(NUANCE_KEYS.map((k) => [k, NuanceColor.optional()])) as Record<(typeof NUANCE_KEYS)[number], z.ZodOptional<typeof NuanceColor>>),
});
export type SitePalette = z.infer<typeof SitePaletteSchema>;

/**
 * Logo du site (lot 17f) : taille (hauteur en px sur grand écran, proportionnelle
 * et plafonnée sur mobile) et comportement. S'applique à la signature du kit et,
 * sans logo, au nom du site. Absent = rendu du thème.
 *
 * Image du logo (lot 26) : `mediaId` = une image de la médiathèque qui REMPLACE la signature du thème ou le nom du site
 * écrit en texte (le nom reste lu par les lecteurs d'écran). Absent = le logo du thème (ou le nom en texte).
 */
export const LOGO_SIZE_MIN = 24;
export const LOGO_SIZE_MAX = 160;
/** Taille de départ du curseur quand rien n'est réglé (≈ la signature des thèmes à kit). */
export const LOGO_SIZE_DEFAULT = 40;
/** Tailles rapides du logo (hauteur en px sur grand écran) : « Petit », « Moyen » (un peu plus que la taille du thème, assez pour un dessin détaillé), « Grand ». */
export const LOGO_SIZE_PRESETS = [
  { id: "small", label: "Petit", size: 32 },
  { id: "medium", label: "Moyen", size: 56 },
  { id: "large", label: "Grand", size: 96 },
] as const;
/**
 * Comportements proposés. « Déborde sous le bandeau » (`overhang`, avant le lot 68) est devenu le comportement de base : la
 * barre garde TOUJOURS sa hauteur et un logo plus grand qu'elle déborde dessous. L'ancienne valeur reste lisible (données déjà
 * enregistrées) et se comporte comme « Fixe ».
 */
export const LOGO_MODES = ["fixed", "shrink"] as const;
export type LogoMode = (typeof LOGO_MODES)[number] | "overhang";
export const LOGO_MODE_LABELS: Record<(typeof LOGO_MODES)[number], string> = {
  fixed: "Fixe",
  shrink: "Grand en haut, réduit au défilement",
};
/**
 * Place du logo dans la hauteur de la barre (lots 84 puis 106). Le logo tient TOUJOURS dans la barre, entier : sa hauteur est
 * plafonnée à celle de la barre moins ses marges (`margin`), sans jamais être coupé ni déborder sur ce qui suit.
 * « center » (défaut, jamais écrit) : centré sur la hauteur de la barre. « top » / « bottom » : collé en haut / en bas de la barre
 * (à la marge près). « grow » : la barre prend la hauteur du logo (plus ses marges, ou celles du thème sans réglage) et le logo y est centré.
 * Avant le lot 106, « top » était le défaut : le logo partait du haut de la rangée et débordait sous la barre ; « center » le coupait
 * aux limites de la barre. Les anciennes données restent lues : une valeur absente ou « center » donne le logo centré.
 */
export const LOGO_ALIGNS = ["center", "top", "bottom", "grow"] as const;
export type LogoAlign = (typeof LOGO_ALIGNS)[number];
export const LOGO_ALIGN_LABELS: Record<LogoAlign, string> = {
  center: "Centré dans la barre",
  top: "En haut de la barre",
  bottom: "En bas de la barre",
  grow: "La barre s'agrandit",
};
/** Ajustement dans sa boîte (lot 106) : « contain » (défaut, jamais écrit) = le logo entier ; « cover » = remplit toute la hauteur de la barre (marges ignorées), rogné sur les côtés s'il est très large. */
export const LOGO_FITS = ["contain", "cover"] as const;
export type LogoFit = (typeof LOGO_FITS)[number];
export const LOGO_FIT_LABELS: Record<LogoFit, string> = { contain: "Logo entier", cover: "Remplir la hauteur" };
/** Marges verticales autour du logo (lot 106) : « small » (défaut, jamais écrit) = 0,25 rem ; « none » = aucune ; « normal » = 0,75 rem. */
export const LOGO_MARGINS = ["none", "small", "normal"] as const;
export type LogoMargin = (typeof LOGO_MARGINS)[number];
export const LOGO_MARGIN_LABELS: Record<LogoMargin, string> = { none: "Aucune", small: "Petites", normal: "Normales" };
export const LOGO_MARGIN_CSS: Record<LogoMargin, string> = { none: "0px", small: "0.25rem", normal: "0.75rem" };
/** Sur téléphone (lot 106) : « reduced » (défaut, jamais écrit) = la taille ×0,75 d'avant ; « same » = la même taille qu'au grand écran (toujours dans la barre). */
export const LOGO_MOBILES = ["reduced", "same"] as const;
export type LogoMobile = (typeof LOGO_MOBILES)[number];
export const LOGO_MOBILE_LABELS: Record<LogoMobile, string> = { reduced: "Logo réduit", same: "Même logo" };
/**
 * Position horizontale (lot 84) : `anchor` = d'où l'on part (bord gauche = le rendu d'avant, centre de la page, bord droit libre avant
 * le menu), `x` = décalage en px à partir de là (grand écran ; téléphone : ×0,75, au plus 120 px). Le logo ne passe jamais sous le menu
 * ni hors de l'écran : le plafond est mesuré dans la page (SiteHeader) et posé en variables --lx-lo / --lx-mid / --lx-hi.
 */
export const LOGO_ANCHORS = ["left", "center", "right"] as const;
export type LogoAnchor = (typeof LOGO_ANCHORS)[number];
export const LOGO_ANCHOR_LABELS: Record<LogoAnchor, string> = { left: "Gauche", center: "Centre", right: "Droite" };
export const LOGO_X_MIN = -200;
export const LOGO_X_MAX = 600;
/** Plafond du décalage sur téléphone (px, après le ×0,75). */
export const LOGO_X_MOBILE_CAP = 120;
export const LogoSchema = z.strictObject({
  size: z.number().int().min(LOGO_SIZE_MIN).max(LOGO_SIZE_MAX).optional(),
  mode: z.enum([...LOGO_MODES, "overhang"]).optional(),
  mediaId: z.number().int().positive().optional(),
  align: z.enum(LOGO_ALIGNS).optional(),
  x: z.number().int().min(LOGO_X_MIN).max(LOGO_X_MAX).optional(),
  anchor: z.enum(LOGO_ANCHORS).optional(),
  fit: z.enum(LOGO_FITS).optional(),
  margin: z.enum(LOGO_MARGINS).optional(),
  mobile: z.enum(LOGO_MOBILES).optional(),
});
export type Logo = z.infer<typeof LogoSchema>;

/**
 * Couleur posée par-dessus le TRAIT dessiné du kit (lot 110) : la teinte (#rrggbb) et son opacité (1 à 100 %), mélangées au dessin
 * d'origine (teinte du thème, ou couleurs d'origine du fichier). Absente = le rendu du thème, strictement.
 */
export const StrokeTintSchema = z.strictObject({
  color: z.string().regex(/^#[0-9a-f]{6}$/),
  opacity: z.number().int().min(1).max(100),
});
export type StrokeTint = z.infer<typeof StrokeTintSchema>;
/** Réglages du site : `all` = valeur par défaut (barres des rangées d'images, filets, soulignement), `header` = soulignement de l'en-tête seul. */
export const SiteStrokeSchema = z.strictObject({ all: StrokeTintSchema.optional(), header: StrokeTintSchema.optional() });
export type SiteStroke = z.infer<typeof SiteStrokeSchema>;
/** Teinte lisible ou undefined (donnée illisible = pas de teinte, jamais d'erreur au rendu). */
export function readTint(v: unknown): StrokeTint | undefined {
  const p = StrokeTintSchema.safeParse(v);
  return p.success ? p.data : undefined;
}
/** Variables de la teinte (`--stroke-c`, `--stroke-a`, `--stroke-ao`) ; `prefix` "nav-" pour l'en-tête. */
export function tintVars(t: StrokeTint, prefix = ""): Record<string, string> {
  return prefix
    ? { [`--stroke-${prefix}c`]: t.color, [`--stroke-${prefix}a`]: `${t.opacity}%` }
    : { "--stroke-c": t.color, "--stroke-a": `${t.opacity}%`, "--stroke-ao": String(t.opacity / 100) };
}
export function cleanSiteStroke(s: SiteStroke | undefined): SiteStroke | undefined {
  const all = readTint(s?.all);
  const header = readTint(s?.header);
  return all || header ? { ...(all ? { all } : {}), ...(header ? { header } : {}) } : undefined;
}
const declsOf = (v: Record<string, string>) => Object.entries(v).map(([k, x]) => `${k}:${x}`).join(";");

/* ---- En-tête et pied de page (lot 124) ------------------------------------------------------------ */

/** Zones : « Tout le menu » (liens de l'en-tête) et « Tout le pied de page ». */
export const HZ_ZONES = ["menu", "footer"] as const;
export type HzZone = (typeof HZ_ZONES)[number];
export const HZ_ZONE_LABELS: Record<HzZone, string> = { menu: "Tout le menu", footer: "Tout le pied de page" };
/**
 * Clé d'un texte de l'en-tête ou du pied de page (`data-site-text` de l'élément) : `brand` (nom du site), `n:<lien>` (lien du menu),
 * `f:<texte>` (texte du pied : `f:email`, `f:role`, `f:credit`, `f:copy`, `f:eb-…`, `f:n:<lien>`, `f:s:<réseau>`).
 */
export const SITE_TEXT_KEY_RE = /^(brand|n:.{1,150}|f:.{1,150})$/;
export const SiteTextKeySchema = z.string().regex(SITE_TEXT_KEY_RE, "Texte inconnu.");
/** Zone d'un texte (portée « Tout le menu » / « Tout le pied de page »), ou null (nom du site : pas de zone). */
export const siteTextZone = (key: string): HzZone | null => (key.startsWith("n:") ? "menu" : key.startsWith("f:") ? "footer" : null);
export const MAX_SITE_TEXTS = 200;

export const SiteStylesSchema = z.strictObject({
  roles: z.partialRecord(z.enum(ROLES), TextStyleSchema).optional(),
  /** Réglage propre à UN texte de l'en-tête ou du pied (clé `data-site-text`) : passe devant sa zone et le site. */
  texts: z.record(SiteTextKeySchema, TextStyleSchema).refine((r) => Object.keys(r).length <= MAX_SITE_TEXTS, "Trop de réglages de texte.").optional(),
  /** Réglage de toute une zone (menu, pied de page) : passe devant le site, derrière le texte seul. */
  zones: z.strictObject({ menu: TextStyleSchema.optional(), footer: TextStyleSchema.optional() }).optional(),
  /** Arrondi des images et cartes du site (surcharge le thème). */
  radius: z.enum(RADII).optional(),
  palette: SitePaletteSchema.optional(),
  logo: LogoSchema.optional(),
  /** Couleur du trait dessiné du kit (lot 110). */
  stroke: SiteStrokeSchema.optional(),
});
export type SiteStyles = z.infer<typeof SiteStylesSchema>;

/** Palette du site sans clé vide ; undefined s'il ne reste rien. */
export function cleanSitePalette(p: SitePalette | undefined): SitePalette | undefined {
  const out = Object.fromEntries(Object.entries(p ?? {}).filter(([, v]) => typeof v === "string")) as SitePalette;
  return Object.keys(out).length ? out : undefined;
}

/**
 * Logo canonique : « Fixe » est le comportement par défaut (jamais écrit) ;
 * undefined s'il ne reste aucun réglage (le rendu est alors celui du thème).
 */
export function cleanLogo(l: Logo | undefined): Logo | undefined {
  if (!l) return undefined;
  const out: Logo = {};
  if (l.size !== undefined) out.size = l.size;
  if (l.mode === "shrink") out.mode = l.mode;
  if (l.mediaId !== undefined) out.mediaId = l.mediaId;
  if (l.align === "top" || l.align === "bottom" || l.align === "grow") out.align = l.align;
  if (l.x !== undefined && l.x !== 0) out.x = l.x;
  if (l.anchor === "center" || l.anchor === "right") out.anchor = l.anchor;
  if (l.fit === "cover") out.fit = l.fit;
  if (l.margin === "none" || l.margin === "normal") out.margin = l.margin;
  if (l.mobile === "same") out.mobile = l.mobile;
  return Object.keys(out).length ? out : undefined;
}

export const radiusValue = (r: Radius) => RADIUS_VALUES[r];

/** Feuille des styles globaux (règles générées depuis des crans validés). */
export function siteStylesCss(styles: SiteStyles | undefined, palette?: CardPalette): string {
  const parsed = SiteStylesSchema.safeParse(styles ?? {});
  if (!parsed.success) return "";
  const s = parsed.data;
  const rules: string[] = [];
  if (s.radius) rules.push(`:root{--media-radius:${RADIUS_VALUES[s.radius]}}`);
  // Lot 110 : couleur du trait du kit. Rien d'écrit sans réglage : les règles de variants.css retombent sur le dessin du thème.
  const stroke = cleanSiteStroke(s.stroke);
  if (stroke?.all) rules.push(`${WIN}{${declsOf(tintVars(stroke.all))}}`);
  if (stroke?.header) rules.push(`${WIN} .site-header{${declsOf(tintVars(stroke.header, "nav-"))}}`);
  // Ordre : légendes avant menu et nom du site (à spécificité égale, le dernier gagne).
  for (const role of ["body", "caption", "eyebrow", "h2", "h1", "menu", "brand"] as Role[]) {
    // Menu et nom du site : de petits éléments en ligne (le bandeau y est `inline-block`) ; les autres rôles visent aussi des blocs.
    const decls = textStyleDecls(s.roles?.[role], palette, role !== "menu" && role !== "brand");
    // Choix de couleur du rôle : publié pour qu'un fond posé sur un texte précis (style local) ne le remplace pas.
    const chosen = s.roles?.[role]?.color ? decls.find(([k]) => k === "color") : undefined;
    // Menu : le fond se pose sur le lien seul (le sélecteur du rôle vise aussi son <span>, la boîte serait doublée).
    // Corps : le fond se pose sur les paragraphes seuls, pas sur les `li` de structure (réseaux du Profil, cartes vidéo, pages du CV),
    // et la couleur de texte lisible qui l'accompagne (`--user-ink`) aussi.
    const isBox = ([k, v]: [string, string]) => BACKDROP_PROPS.has(k) || (role === "body" && k === "color" && v.startsWith("var(--user-ink,"));
    const boxedTarget = role === "menu" ? ".site-header nav a" : role === "body" ? "#contenu p:not(.eyebrow, .caption-text, .strip-caption)" : null;
    const boxed = boxedTarget ? decls.filter(isBox) : [];
    const plain = boxedTarget ? decls.filter((d) => !isBox(d)) : decls;
    rules.push(...roleRules(role, plain, `${WIN} `));
    if (boxed.length && boxedTarget) rules.push(`${WIN} ${boxedTarget}{${boxed.map(([k, v]) => `${k}:${v}`).join(";")}}`);
    if (chosen) rules.push(`${WIN} ${ROLE_SELECTORS[role]}{--user-ink:${chosen[1]}}`);
  }
  rules.push(...hzRules(s.zones, s.texts, palette));
  // Rien d'injectable n'arrive ici (crans et catalogue), ceinture quand même.
  return rules.join("\n").replace(/</g, "\\3c ");
}

/** Valeur de chaîne CSS d'une clé de texte (guillemets et barres échappés, sauts de ligne retirés). */
const cssStr = (v: string) => v.replace(/[\\"]/g, "\\$&").replace(/[\n\r\f]/g, " ");
/** Éléments visés par chaque zone (le lien du menu, le bouton « Menu » du téléphone ; tous les textes repérés du pied). */
const HZ_ZONE_TARGET: Record<HzZone, string> = {
  menu: '.site-header :is([data-site-text^="n:"], [data-site-text="menu-btn"])',
  footer: 'footer :is([data-site-text^="f:"])',
};
/** Un cran de plus que les styles de rôle (spécificité 0,5,0 au plus) : la zone passe devant le site ; le texte seul, un cran devant la zone. */
const HZ_WIN = ":root:root:root:root";
const HZ_WIN_ONE = ":root:root:root:root:root:root";

/** Règles d'un style posé sur un ensemble d'éléments (`target`) : le fond sur l'élément seul, le reste aussi sur son <span> (libellé en édition, adresse e-mail). */
function hzRule(prefix: string, scope: string, target: string, style: TextStyle | undefined, palette: CardPalette | undefined): string[] {
  const decls = textStyleDecls(style, palette, false);
  if (!decls.length) return [];
  const css = (list: [string, string][]) => list.map(([k, v]) => `${k}:${v}`).join(";");
  const box = decls.filter(([k]) => BACKDROP_PROPS.has(k));
  const plain = decls.filter(([k]) => !BACKDROP_PROPS.has(k));
  const at = `${prefix} ${scope}`.trim();
  const out: string[] = [];
  if (plain.length) out.push(`${at} :is(${target}),${at} :is(${target}) > span{${css(plain)}}`);
  if (box.length) out.push(`${at} :is(${target}){${css(box)}}`);
  // Couleur choisie : publiée pour qu'un fond lisible (`var(--user-ink, …)`) ne la remplace pas (comme les styles de rôle).
  const chosen = style?.color ? decls.find(([k]) => k === "color") : undefined;
  if (chosen) out.push(`${at} :is(${target}){--user-ink:${chosen[1]}}`);
  return out;
}

/**
 * Feuille de l'en-tête et du pied de page (lot 124) : la zone (liens du menu, pied de page), puis chaque texte seul. Priorité élément > zone > site > thème :
 * la zone passe devant les styles de rôle du site (spécificité), le texte seul devant la zone. Sans réglage de zone ni de texte, aucune règle :
 * le rendu reste celui des styles de rôle d'avant.
 */
function hzRules(zones: SiteStyles["zones"], texts: SiteStyles["texts"], palette: CardPalette | undefined): string[] {
  const rules: string[] = [];
  for (const zone of HZ_ZONES) rules.push(...hzRule(HZ_WIN, "", HZ_ZONE_TARGET[zone], zones?.[zone], palette));
  for (const [key, style] of Object.entries(texts ?? {})) {
    if (!SITE_TEXT_KEY_RE.test(key)) continue;
    rules.push(...hzRule(HZ_WIN_ONE, "", `[data-site-text="${cssStr(key)}"]`, style, palette));
  }
  return rules;
}

/**
 * Feuille du logo (lot 17f, refaite aux lots 68 et 106). Taille réglée `--lh` (mobile : ×0,75 entre 24 et 64 px, sauf « Même logo »).
 * Lot 106 : le logo est TOUJOURS entier dans la barre. Sa hauteur affichée `--lhe` = min(taille réglée, hauteur de la barre `--bar`
 * moins deux marges `--lm`) : jamais coupé, jamais de débordement sur le contenu, proportions gardées (`object-fit: contain`).
 * La barre garde sa hauteur naturelle (`--bar` = rangée du thème `--bh` + deux marges `--bp`) ; la boîte du logo ne pèse que la rangée dans la mise en page
 * (marges haute ET basse égales, négatives si le logo est plus grand) : centrée sur la barre, le contenu ne bouge pas. « top » / « bottom » la
 * décalent (`--ly`) jusqu'au bord de la barre. « grow » : la barre prend la hauteur du logo (`--lh-top`) plus ses marges.
 * « shrink » : au défilement (`data-scrolled` sur l'en-tête, posé par SiteHeader) le logo passe à 60 % (24 px au moins).
 * Les transitions n'existent que si l'utilisateur ne demande pas moins de mouvement.
 * Posée AVANT les styles de rôle : une taille réglée sur « Nom du site » passe devant celle du logo.
 * Aucun réglage = chaîne vide : le rendu est exactement celui du thème.
 */
export function logoCss(logo: Logo | undefined): string {
  const parsed = LogoSchema.safeParse(logo ?? {});
  if (!parsed.success) return "";
  const l = cleanLogo(parsed.data);
  if (!l) return "";
  const size = l.size ?? LOGO_SIZE_DEFAULT;
  const align = l.align ?? "center";
  const grow = align === "grow";
  const cover = l.fit === "cover";
  const H = `${WIN} .site-header`;
  // Marge : réglée, sinon 0,25 rem (barre fixe) ou celle du thème (« La barre s'agrandit », comme avant).
  const lm = l.margin ? LOGO_MARGIN_CSS[l.margin] : grow ? "var(--bp)" : LOGO_MARGIN_CSS.small;
  const rules = [
    // --bh : rangée naturelle de l'en-tête sans réglage (nom en texte 1,125 / 1,25 rem ; signature du kit 2,25 / 2,6 rem).
    `${WIN}{--lg:${size};--bp:1rem;--bh:1.125rem;--lh-top:clamp(24px,calc(var(--lg)*.75px),64px);--lh-min:max(24px,calc(var(--lh-top)*.6))}`,
    `${WIN}[data-kit-signature]{--bh:2.25rem}`,
    `@media (min-width:48rem){${WIN}{--bp:1.25rem;--bh:1.25rem;--lh-top:calc(var(--lg)*1px)}${WIN}[data-kit-signature]{--bh:2.6rem}}`,
  ];
  // « Même logo » sur téléphone : la taille du grand écran (la barre la plafonne).
  if (l.mobile === "same") rules.push(`${WIN}{--lh-top:calc(var(--lg)*1px)}`);
  rules.push(`${H}{--lh:var(--lh-top);--bar:calc(var(--bh) + 2*var(--bp));--lm:${lm}}`);
  if (l.mode === "shrink") rules.push(`${H}[data-scrolled]{--lh:var(--lh-min)}`);
  // Hauteur affichée : plafonnée à la barre (« Remplir » : toute la hauteur de la barre) ; « grow » : la taille réglée, la barre s'adapte.
  const lhe = grow ? "var(--lh)" : cover ? "var(--bar)" : "max(0px,min(var(--lh),calc(var(--bar) - 2*var(--lm))))";
  rules.push(
    `${H}{--lhe:${lhe}}`,
    // La barre ne descend jamais sous sa rangée naturelle ; « grow » la fait monter à la hauteur du logo (réglée, pas celle du défilement : la page ne saute pas).
    `${H} .site-header-bar{min-height:${grow ? "calc(max(var(--bh),var(--lh-top)) + 2*var(--lm))" : "var(--bar)"}}`,
    `${H} .site-header-bar,${H} nav{flex-wrap:nowrap}`,
    // Boîte du logo : ne pèse que la rangée naturelle dans la mise en page (marges égales, négatives si elle est plus haute), « grow » : sa vraie hauteur.
    `${WIN} .site-brand{display:flex;align-items:center;height:var(--lhe);margin-block:${grow ? "calc(var(--lm) - var(--bp))" : "calc((var(--bh) - var(--lhe))/2)"};min-width:0;max-width:60vw;font-size:calc(var(--lhe)*.5)}`,
    // Le menu ne passe jamais à la ligne (la barre ne grandirait pas pour autant, mais il se lirait mal) : c'est le nom en texte qui cède de la place.
    `${H} nav,${H} .site-header-bar>div{flex-shrink:0}${H} nav a,${H} button{white-space:nowrap}`,
    `${WIN} .site-brand{position:relative;z-index:1}`,
    `${WIN} .site-brand-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`,
    `${WIN} .site-signature{height:var(--lhe);max-width:100%}`,
    `${WIN} .site-logo-img{height:var(--lhe);max-width:100%;object-fit:${cover ? "cover" : "contain"}}`,
    `@media (prefers-reduced-motion:no-preference){${WIN} .site-signature,${WIN} .site-logo-img{transition:height .5s var(--ease-soft)}${WIN} .site-brand{transition:color .15s,height .5s var(--ease-soft),font-size .5s var(--ease-soft),margin .5s var(--ease-soft)}${H} .site-header-bar{transition:min-height .5s var(--ease-soft)}}`,
  );
  // Décalage vertical vers le bord de la barre (« top » / « bottom » ; la boîte est centrée sur la barre sans lui).
  const vertical = align === "top" || align === "bottom";
  if (vertical) {
    const sign = align === "top" ? "" : "-";
    rules.push(`${H}{--ly:calc(${sign}1*(var(--lm) + var(--lhe)/2 - var(--bar)/2))}`);
  }
  const moved = l.x !== undefined || l.anchor !== undefined;
  if (moved) {
    const base = l.anchor === "center" ? "var(--lx-mid,0px)" : l.anchor === "right" ? "var(--lx-hi,0px)" : "0px";
    rules.push(
      // Décalage : ×0,75 et au plus 120 px sur téléphone (comme la taille). Le plafond (menu, bord de l'écran) vient des variables mesurées par SiteHeader.
      `${WIN}{--lx:${l.x ?? 0};--lxs:clamp(-${LOGO_X_MOBILE_CAP}px,calc(var(--lx)*.75px),${LOGO_X_MOBILE_CAP}px)}`,
      `@media (min-width:48rem){${WIN}{--lxs:calc(var(--lx)*1px)}}`,
      `${WIN} .site-brand{translate:clamp(var(--lx-lo,-1rem),calc(${base} + var(--lxs)),var(--lx-hi,max(0px,min(var(--lxs),10vw)))) ${vertical ? "var(--ly,0px)" : "0"}}`,
    );
  } else if (vertical) {
    rules.push(`${WIN} .site-brand{translate:0 var(--ly,0px)}`);
  }
  if (moved || vertical) {
    rules.push(`@media (prefers-reduced-motion:no-preference){${WIN} .site-brand{transition:color .15s,height .5s var(--ease-soft),font-size .5s var(--ease-soft),margin .5s var(--ease-soft),translate .5s var(--ease-soft)}}`);
  }
  return rules.join("\n");
}

/**
 * Feuille de la typographie du THÈME (`tokens.type`), émise avec les variables
 * du thème dans `<style id="theme">` (avant les styles du site, qui gagnent à
 * spécificité égale). Mêmes sélecteurs et même ordre que les styles du site.
 */
export function themeTypeCss(theme: Pick<Theme, "tokens">): string {
  const type = theme.tokens.type;
  if (!type) return "";
  const rules: string[] = [];
  for (const role of ["body", "caption", "eyebrow", "h2", "h1", "menu", "brand"] as Role[]) {
    const t = type[role];
    if (!t) continue;
    rules.push(...roleRules(role, textStyleDecls({ ...t, font: t.font ? `theme:${t.font}` : undefined }), ""));
  }
  return rules.join("\n").replace(/</g, "\\3c ");
}

/** Familles Google citées par des styles (globaux ou locaux). */
export function googleFamiliesOf(styles: (TextStyle | undefined)[]): string[] {
  return [...new Set(styles.map((s) => googleOf(s?.font)).filter((f): f is string => Boolean(f)))];
}

/**
 * Rebase de styles du site (lot 70) : `mine` = ce que l'artiste vient de régler, calculé sur `base` (ce qu'il avait sous les yeux) ;
 * `theirs` = le brouillon du site qu'une autre page portait et qui lui est confié. On garde `theirs` et on y pose seulement ce que
 * `mine` change par rapport à `base`, champ par champ (un rôle de texte, l'arrondi, la palette, le logo) : un réglage en attente sur
 * l'autre page n'est jamais écrasé par un réglage fait ici sur un autre champ.
 */
export function rebaseSiteStyles(base: SiteStyles | undefined, mine: SiteStyles | undefined, theirs: SiteStyles | undefined): SiteStyles | undefined {
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const out: Record<string, unknown> = { ...(theirs ?? {}) };
  const rec = (s: SiteStyles | undefined) => (s ?? {}) as Record<string, unknown>;
  for (const k of new Set([...Object.keys(rec(base)), ...Object.keys(rec(mine))])) {
    if (k === "roles" || k === "texts" || k === "zones" || same(rec(base)[k], rec(mine)[k])) continue;
    if (rec(mine)[k] === undefined) delete out[k];
    else out[k] = rec(mine)[k];
  }
  // Rôles, textes de l'en-tête et du pied, zones : même fusion, champ par champ.
  for (const name of ["roles", "texts", "zones"] as const) {
    const merged: Record<string, Record<string, unknown>> = { ...((theirs?.[name] ?? {}) as Record<string, Record<string, unknown>>) };
    const b = (base?.[name] ?? {}) as Record<string, Record<string, unknown> | undefined>;
    const m = (mine?.[name] ?? {}) as Record<string, Record<string, unknown> | undefined>;
    for (const r of new Set([...Object.keys(b), ...Object.keys(m)])) {
      if (same(b[r], m[r])) continue;
      const t = { ...(merged[r] ?? {}) };
      for (const f of new Set([...Object.keys(b[r] ?? {}), ...Object.keys(m[r] ?? {})])) {
        if (same(b[r]?.[f], m[r]?.[f])) continue;
        if (m[r]?.[f] === undefined) delete t[f];
        else t[f] = m[r]![f];
      }
      if (Object.keys(t).length) merged[r] = t;
      else delete merged[r];
    }
    if (Object.keys(merged).length) (out as Record<string, unknown>)[name] = merged;
    else delete out[name];
  }
  return Object.keys(out).length ? (out as SiteStyles) : undefined;
}

/** Styles du site sans rôle vide ; undefined s'il ne reste rien (= thème seul). */
export function cleanSiteStyles(styles: SiteStyles | undefined): SiteStyles | undefined {
  if (!styles) return undefined;
  const roles = Object.fromEntries(
    Object.entries(styles.roles ?? {})
      .map(([k, v]) => [k, Object.fromEntries(Object.entries(v ?? {}).filter(([, x]) => x !== undefined))])
      .filter(([, v]) => Object.keys(v as object).length),
  ) as SiteStyles["roles"];
  const palette = cleanSitePalette(styles.palette);
  const logo = cleanLogo(styles.logo);
  const bare = (v: object | undefined) => Object.fromEntries(Object.entries(v ?? {}).filter(([, x]) => x !== undefined));
  const texts = Object.fromEntries(
    Object.entries(styles.texts ?? {})
      .map(([k, v]) => [k, bare(v)] as const)
      .filter(([, v]) => Object.keys(v).length)
      .slice(0, MAX_SITE_TEXTS),
  ) as SiteStyles["texts"];
  const zones = Object.fromEntries(
    HZ_ZONES.map((z) => [z, bare(styles.zones?.[z])] as const).filter(([, v]) => Object.keys(v).length),
  ) as SiteStyles["zones"];
  const stroke = cleanSiteStroke(styles.stroke);
  const out: SiteStyles = {
    ...(roles && Object.keys(roles).length ? { roles } : {}),
    ...(texts && Object.keys(texts).length ? { texts } : {}),
    ...(zones && Object.keys(zones).length ? { zones } : {}),
    ...(styles.radius ? { radius: styles.radius } : {}),
    ...(palette ? { palette } : {}),
    ...(logo ? { logo } : {}),
    ...(stroke ? { stroke } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

/** Repère d'une planche de projet dans le DOM (`data-pscope`) : l'identifiant de son bloc, réduit aux caractères sûrs d'un sélecteur. */
export const pscopeId = (uid: string): string => uid.replace(/[^a-zA-Z0-9_-]/g, "");

/**
 * Feuille de la portée « Tout le projet » (lot 120) : les styles de titres, d'étiquettes et de textes d'UNE planche de projet, limités à elle
 * (`[data-pscope]`). Même fabrication que les styles de rôle du site (`textStyleDecls`, mêmes éléments visés, même cas des fonds et de la
 * couleur choisie) ; elle passe devant le site (un cran de spécificité de plus) et derrière le style propre d'un texte (en ligne).
 * Les légendes ne passent pas par ici : leur style de projet est posé en ligne sur chaque légende (`captionCss`).
 */
export function projectStylesCss(scope: string, texts: Look["projectText"] | undefined, palette?: CardPalette): string {
  const id = pscopeId(scope);
  if (!id || !texts) return "";
  const at = `${WIN} #contenu [data-pscope="${id}"]`;
  const rules: string[] = [];
  const css = (list: [string, string][]) => list.map(([k, v]) => `${k}:${v}`).join(";");
  const targets: Record<"h2" | "eyebrow" | "body", string> = {
    h2: ":is(h1, h2, h3)",
    eyebrow: ".eyebrow",
    body: ":is(p, li):not(.eyebrow, .caption-text, .strip-caption)",
  };
  for (const key of ["body", "eyebrow", "h2"] as const) {
    const parsed = texts[key] ? TextStyleSchema.safeParse(texts[key]) : null;
    if (!parsed?.success) continue;
    const decls = textStyleDecls(parsed.data, palette, true);
    if (!decls.length) continue;
    const isBox = ([k, v]: [string, string]) => BACKDROP_PROPS.has(k) || (key === "body" && k === "color" && v.startsWith("var(--user-ink,"));
    // Corps : le fond se pose sur les paragraphes seuls (comme pour le site) ; titres : la taille ne vise que les titres de section.
    const boxed = key === "body" ? decls.filter(isBox) : [];
    const plain = key === "body" ? decls.filter((d) => !isBox(d)) : decls;
    const own = key === "h2" ? plain.filter(([k]) => k !== "font-size") : plain;
    const size = key === "h2" ? plain.filter(([k]) => k === "font-size") : [];
    if (own.length) rules.push(`${at} ${targets[key]}{${css(own)}}`);
    if (size.length) rules.push(`${at} :is(h2, h3){${css(size)}}`);
    if (boxed.length) rules.push(`${at} p:not(.eyebrow, .caption-text, .strip-caption){${css(boxed)}}`);
    const chosen = parsed.data.color ? decls.find(([k]) => k === "color") : undefined;
    if (chosen) rules.push(`${at} ${targets[key]}{--user-ink:${chosen[1]}}`);
  }
  return rules.join("\n").replace(/</g, "\\3c ");
}
