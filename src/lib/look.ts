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
export const SPACE_LABELS: Record<Space, string> = { none: "Aucun", s: "S", m: "M", l: "L", xl: "XL" };
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
 * « Bande de couleur » (`band` : un filet d'épaisseur et de couleur choisies) ou, plus tard, un cadre de la bibliothèque
 * (`custom`, `id` = son identifiant : prévu dans les types, la validation et le rendu, pas encore proposé dans l'interface).
 * Sans choix (réglage absent), la photo suit le réglage du site « Cadre du thème sur toutes les photos » (non par défaut).
 */
export const FRAME_KINDS = ["none", "theme", "band", "custom"] as const;
export type FrameKind = (typeof FRAME_KINDS)[number];
/** Épaisseurs de la bande de couleur (largeurs réelles en CSS : src/app/look.css, adaptées au téléphone). */
export const FRAME_WIDTHS = ["fin", "moyen", "epais"] as const;
export type FrameWidth = (typeof FRAME_WIDTHS)[number];
export const FRAME_WIDTH_LABELS: Record<FrameWidth, string> = { fin: "Fin", moyen: "Moyen", epais: "Épais" };
export const FRAME_DEFAULT_WIDTH: FrameWidth = "moyen";
export const FRAME_KIND_LABELS: Record<Exclude<FrameKind, "custom">, string> = { none: "Aucun", theme: "Cadre du thème", band: "Bande de couleur" };
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
 * rendu d'un choix explicite : « none » = Aucun, une épaisseur = Bande de couleur de cette épaisseur. Une valeur déjà à la nouvelle forme,
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

/** Couleur CSS d'une bande : teinte de la palette (suit le thème), couleur libre, ou la couleur par défaut. */
export function frameColorCss(color: string | undefined): string {
  // `--color-x` (relais Tailwind du thème), pas `--t-color-x` : dans une carte ou sur un fond de couleur, la carte REMAPPE ces variables
  // (texte lisible) ; « Texte » est donc la même couleur partout (lot 64, A5 D5).
  if (color && (PALETTE as readonly string[]).includes(color)) return `var(--color-${color})`;
  if (color && CUSTOM_COLOR_RE.test(color)) return color;
  // `--color-ink` : le texte du thème, mais remappé en encre LISIBLE dans une carte ou sur un fond de couleur (lot 32) : un cadre
  // par défaut ne disparaît pas sur un fond sombre.
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
 * `--color-x`, remappé dans une carte (lot 64).
 */
export function imageBgCss(bg: string | undefined): string | null {
  if (bg === undefined) return null;
  if (bg === IMAGE_BG_CARD) return "var(--card-bg, var(--t-color-surface))";
  if ((PALETTE as readonly string[]).includes(bg)) return `var(--color-${bg})`;
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
 * (`look.frame` / `look.imageBg`, `slotFrame[slug]` / `slotBg[slug]` / `slotRadius[slug]`, `items[].frame` / `.bg` / `.radius`) et les passe ici :
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

/* ---- Réglages d'un bloc (props.look) --------------------------------------------- */

/** Chemin d'un texte du bloc (comme `inline` au registre) ; `site.name` / `site.role` : textes du site posés dans le bloc. */
const TextPath = z.string().max(80).regex(/^[a-zA-Z]+(\.(\d{1,2}|[a-zA-Z]+))*$/);
const bounded = <T extends z.ZodType>(rec: T, max: number, label: string) =>
  rec.refine((v) => Object.keys(v as object).length <= max, `${max} ${label} au plus.`);

export const LookSchema = z.strictObject({
  spaceTop: z.enum(SPACES).optional(),
  spaceBottom: z.enum(SPACES).optional(),
  radius: z.enum(RADII).optional(),
  titleV: z.enum(["top", "middle", "bottom"]).optional(),
  titleH: z.enum(["left", "center", "right"]).optional(),
  text: bounded(z.record(TextPath, TextStyleSchema), 40, "styles de texte").optional(),
  crop: z.partialRecord(z.enum(CROP_FIELDS), CropSchema).optional(),
  /** Cadrage de l'image de chaque tuile d'un bloc « tuiles de collection », par collection. */
  tileCrop: z.partialRecord(z.enum(TILE_KEYS), CropSchema).optional(),
  /** Ancien fond du métier de l'ouverture (avant le lot 21) : toujours rendu tel quel ; la barre le migre dans `text['site.role'].backdrop` à la première modification. */
  roleBackdrop: z.enum(BACKDROPS).optional(),
  /**
   * Arrondi d'une image précise d'une planche (intégration lots 2 + 3), par
   * emplacement (slug de l'emplacement) : surcharge l'arrondi du bloc.
   */
  slotRadius: bounded(z.record(z.string().max(80).regex(/^[a-z0-9-]+$/), z.enum(RADII)), 200, "arrondis d'images").optional(),
  /** Cadre autour de la photo d'un bloc Image (page, case de grille) : lot 34. */
  frame: FrameSchema.optional(),
  /** Cadre d'une image précise d'une planche, par emplacement (slug) : lot 34. */
  slotFrame: bounded(z.record(z.string().max(80).regex(/^[a-z0-9-]+$/), FrameSchema), 200, "cadres d'images").optional(),
  /** Lecture d'une vidéo précise d'un carrousel (Boucle / Lecteur), par emplacement (slug) : lot 38. Absent : le réglage ancien de la bande, sinon la nature de la vidéo. */
  slotVideo: bounded(z.record(z.string().max(80).regex(/^[a-z0-9-]+$/), z.enum(["loop", "player"])), 200, "lectures de vidéos").optional(),
  /** Image seule (page ou planche, lot 40) : « large » lève le plafond de hauteur ; absent = Normale (comme avant). */
  imageSize: z.enum(["large"]).optional(),
  /** Image seule (lot 40) : place de l'image (et de sa légende) dans le cadre ; absent = comme avant (centrée, légende pleine largeur). */
  imageAlign: z.enum(IMAGE_ALIGNS).optional(),
  /** Fond derrière l'image d'un bloc Image (page, case de grille, image de planche) : lot 41. */
  imageBg: ImageBgSchema.optional(),
  /** Fond derrière une image précise d'une planche ou d'un carrousel, par emplacement (slug) : lot 41. */
  slotBg: bounded(z.record(z.string().max(80).regex(/^[a-z0-9-]+$/), ImageBgSchema), 200, "fonds d'images").optional(),
  /** Panorama d'une image précise d'un carrousel, par emplacement (slug) : lot 45. Absent = « fit » (entière, jamais plus large que le carrousel) ; « scroll » = à faire défiler (comme avant). */
  slotPano: bounded(z.record(z.string().max(80).regex(/^[a-z0-9-]+$/), z.enum(["fit", "scroll"])), 200, "panoramas d'images").optional(),
});
export type Look = z.infer<typeof LookSchema>;

/** Lecture tolérante : un réglage invalide est ignoré, jamais fatal. */
export function readLook(raw: unknown): Look | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const parsed = LookSchema.safeParse(raw);
  if (parsed.success) return isEmptyLook(parsed.data) ? undefined : parsed.data;
  // Garde ce qui passe, clé par clé.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    const one = LookSchema.safeParse({ [k]: v });
    if (one.success) Object.assign(out, one.data);
  }
  return isEmptyLook(out as Look) ? undefined : (out as Look);
}

export function isEmptyLook(look: Look | undefined): boolean {
  if (!look) return true;
  return Object.values(look).every((v) => v === undefined || (typeof v === "object" && v !== null && Object.keys(v).length === 0));
}

/** Retire les clés vides (un « Auto » remis efface le réglage). */
export function cleanLook(look: Look): Look | undefined {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(look)) {
    if (v === undefined) continue;
    if (v && typeof v === "object") {
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
  if (look.spaceTop) a["data-pt"] = look.spaceTop;
  if (look.spaceBottom) a["data-pb"] = look.spaceBottom;
  if (look.radius) a["data-radius"] = look.radius;
  if (look.titleV) a["data-tv"] = look.titleV;
  if (look.titleH) a["data-th"] = look.titleH;
  if (look.roleBackdrop) a["data-role-bd"] = look.roleBackdrop;
  const crop = look.crop && Object.values(look.crop)[0];
  // Recadrage libre : l'image affichée EST la zone gardée (variante extraite), rien à décaler ni à zoomer en CSS.
  if (crop && !crop.rect) a["data-crop"] = "";
  return Object.keys(a).length ? a : null;
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
export const LogoSchema = z.strictObject({
  size: z.number().int().min(LOGO_SIZE_MIN).max(LOGO_SIZE_MAX).optional(),
  mode: z.enum([...LOGO_MODES, "overhang"]).optional(),
  mediaId: z.number().int().positive().optional(),
});
export type Logo = z.infer<typeof LogoSchema>;

export const SiteStylesSchema = z.strictObject({
  roles: z.partialRecord(z.enum(ROLES), TextStyleSchema).optional(),
  /** Arrondi des images et cartes du site (surcharge le thème). */
  radius: z.enum(RADII).optional(),
  palette: SitePaletteSchema.optional(),
  logo: LogoSchema.optional(),
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
  // Rien d'injectable n'arrive ici (crans et catalogue), ceinture quand même.
  return rules.join("\n").replace(/</g, "\\3c ");
}

/**
 * Feuille du logo (lot 17f, refaite au lot 68). Hauteur `--lh` : la taille réglée (mobile : ×0,75, entre 24 et 64 px).
 * La hauteur de la BARRE ne dépend plus de celle du logo : elle garde la hauteur qu'elle avait sans réglage (`--bh`, la rangée
 * naturelle : nom en texte, signature du kit ou image), quelle que soit la taille choisie. Un logo plus grand que cette rangée
 * déborde SOUS la barre, par-dessus le contenu (sa place dans la mise en page est la rangée naturelle : marge basse négative) ;
 * un logo plus petit est centré dans la rangée. Le contenu ne bouge jamais.
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
  const H = `${WIN} .site-header`;
  const rules = [
    // --bh : rangée naturelle de l'en-tête sans réglage (nom en texte 1,125 / 1,25 rem ; signature du kit 2,25 / 2,6 rem).
    `${WIN}{--lg:${size};--bp:1rem;--bh:1.125rem;--lh-top:clamp(24px,calc(var(--lg)*.75px),64px);--lh-min:max(24px,calc(var(--lh-top)*.6))}`,
    `${WIN}[data-kit-signature]{--bh:2.25rem}`,
    `@media (min-width:48rem){${WIN}{--bp:1.25rem;--bh:1.25rem;--lh-top:calc(var(--lg)*1px)}${WIN}[data-kit-signature]{--bh:2.6rem}}`,
    `${H}{--lh:var(--lh-top)}`,
  ];
  if (l.mode === "shrink") rules.push(`${H}[data-scrolled]{--lh:var(--lh-min)}`);
  rules.push(
    // La barre ne descend jamais sous sa rangée naturelle ; le logo, lui, n'y compte que pour cette rangée (marge basse négative s'il est plus grand).
    // Lot 67 (filet de sécurité : la barre passe à la ligne) cède ici au lot 68 : avec un logo réglé, la barre garde sa hauteur, le nom en texte cède de la place.
    `${H} .site-header-bar{min-height:calc(var(--bh) + 2*var(--bp))}`,
    `${H} .site-header-bar,${H} nav{flex-wrap:nowrap}`,
    `${WIN} .site-brand{display:flex;align-items:center;height:var(--lh);margin-bottom:min(0px,calc(var(--bh) - var(--lh)));min-width:0;max-width:60vw;font-size:calc(var(--lh)*.5)}`,
    // Le menu ne passe jamais à la ligne (la barre ne grandirait pas pour autant, mais il se lirait mal) : c'est le nom en texte qui cède de la place.
    `${H} nav,${H} .site-header-bar>div{flex-shrink:0}${H} nav a,${H} button{white-space:nowrap}`,
    // Menu téléphone ouvert : le logo reste visible au-dessus du panneau, dont les liens commencent sous lui.
    `${WIN} .site-brand{position:relative;z-index:1}${H} #nav-mobile{padding-top:max(0px,calc(var(--lh) - var(--bh)))}`,
    `${WIN} .site-brand-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`,
    `${WIN} .site-signature{height:var(--lh);max-width:100%}`,
    `${WIN} .site-logo-img{height:var(--lh);max-width:100%}`,
    `@media (prefers-reduced-motion:no-preference){${WIN} .site-signature,${WIN} .site-logo-img{transition:height .5s var(--ease-soft)}${WIN} .site-brand{transition:color .15s,height .5s var(--ease-soft),font-size .5s var(--ease-soft),margin-bottom .5s var(--ease-soft)}}`,
  );
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
    if (k === "roles" || same(rec(base)[k], rec(mine)[k])) continue;
    if (rec(mine)[k] === undefined) delete out[k];
    else out[k] = rec(mine)[k];
  }
  const roles: Record<string, Record<string, unknown>> = { ...((theirs?.roles ?? {}) as Record<string, Record<string, unknown>>) };
  const b = (base?.roles ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const m = (mine?.roles ?? {}) as Record<string, Record<string, unknown> | undefined>;
  for (const r of new Set([...Object.keys(b), ...Object.keys(m)])) {
    if (same(b[r], m[r])) continue;
    const t = { ...(roles[r] ?? {}) };
    for (const f of new Set([...Object.keys(b[r] ?? {}), ...Object.keys(m[r] ?? {})])) {
      if (same(b[r]?.[f], m[r]?.[f])) continue;
      if (m[r]?.[f] === undefined) delete t[f];
      else t[f] = m[r]![f];
    }
    if (Object.keys(t).length) roles[r] = t;
    else delete roles[r];
  }
  if (Object.keys(roles).length) out.roles = roles;
  else delete out.roles;
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
  const out: SiteStyles = { ...(roles && Object.keys(roles).length ? { roles } : {}), ...(styles.radius ? { radius: styles.radius } : {}), ...(palette ? { palette } : {}), ...(logo ? { logo } : {}) };
  return Object.keys(out).length ? out : undefined;
}
