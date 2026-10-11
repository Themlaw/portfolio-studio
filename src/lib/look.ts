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

import { RADIUS_VALUES } from "../themes/css";
import { FONT_STACKS } from "../themes/font-stacks";
import { CATEGORY_FALLBACK, googleFamily, isGoogleFamily } from "../themes/google-fonts";
import { FONT_IDS, TEXT_ROLES, type FontId, type Theme } from "../themes/schema";

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

export const SIZES = ["xs", "s", "m", "l", "xl", "2xl", "3xl", "4xl", "5xl"] as const;
export type Size = (typeof SIZES)[number];
/** Échelle typographique (corps fluides pour les grands titres). */
export const SIZE_VALUES: Record<Size, string> = {
  xs: "0.75rem",
  s: "0.875rem",
  m: "1rem",
  l: "1.25rem",
  xl: "1.5rem",
  "2xl": "clamp(1.6rem, 3vw, 2.1rem)",
  "3xl": "clamp(2rem, 4.5vw, 3rem)",
  "4xl": "clamp(2.5rem, 7vw, 4.5rem)",
  "5xl": "clamp(3rem, 10vw, 7.5rem)",
};
export const SIZE_LABELS: Record<Size, string> = { xs: "XS", s: "S", m: "M", l: "L", xl: "XL", "2xl": "2XL", "3xl": "3XL", "4xl": "4XL", "5xl": "5XL" };

export const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
export const PALETTE = ["ink", "ink-soft", "primary", "secondary", "tertiary", "eyebrow", "bg", "surface"] as const;
export type PaletteColor = (typeof PALETTE)[number];
export const PALETTE_LABELS: Record<PaletteColor, string> = {
  ink: "Encre",
  "ink-soft": "Encre douce",
  primary: "Principale",
  secondary: "Secondaire",
  tertiary: "Tertiaire",
  eyebrow: "Étiquettes",
  bg: "Fond",
  surface: "Surface",
};

/** Rôles : liste unique dans le schéma du thème (typographie du thème, mêmes sélecteurs). */
export const ROLES = TEXT_ROLES;
export type Role = (typeof ROLES)[number];
export const ROLE_LABELS: Record<Role, string> = {
  h1: "Titre 1",
  h2: "Titre 2",
  eyebrow: "Étiquette",
  body: "Texte",
  caption: "Légende",
  menu: "Menu",
  brand: "Nom du site",
};
/**
 * Éléments visés par chaque rôle (feuille globale). Le menu et le nom du
 * site passent avant les légendes : leurs liens portent aussi `.caption-text`.
 */
export const ROLE_SELECTORS: Record<Role, string> = {
  h1: "#contenu h1",
  h2: "#contenu :is(h2, h3)",
  eyebrow: ".eyebrow",
  body: "#contenu :is(p, li):not(.eyebrow, .caption-text, .strip-caption)",
  caption: ":is(.caption-text, figcaption, .strip-caption):not(.site-header *)",
  menu: ".site-header nav :is(a, a > span)",
  brand: ".site-brand",
};

export const BACKDROPS = ["none", "shadow", "band", "highlight"] as const;
export type Backdrop = (typeof BACKDROPS)[number];
export const BACKDROP_LABELS: Record<Backdrop, string> = { none: "Aucun", shadow: "Ombre douce", band: "Bandeau", highlight: "Surlignage" };

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
  /** Ajustement fin de la taille (×0,5 à ×2). */
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
  color: z.enum(PALETTE).optional(),
  align: z.enum(["left", "center", "right"]).optional(),
});
export type TextStyle = z.infer<typeof TextStyleSchema>;

/** Le style local surcharge le global, propriété par propriété. */
export function resolveTextStyle(global: TextStyle | undefined, local: TextStyle | undefined): TextStyle {
  const out: TextStyle = { ...(global ?? {}) };
  for (const [k, v] of Object.entries(local ?? {})) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

/** Déclarations CSS d'un style (propriétés kebab-case), valeurs déjà bornées. */
export function textStyleDecls(style: TextStyle | undefined): [string, string][] {
  const parsed = TextStyleSchema.safeParse(style ?? {});
  if (!parsed.success) return [];
  const s = parsed.data;
  const out: [string, string][] = [];
  const stack = s.font ? fontStack(s.font) : null;
  if (stack) out.push(["font-family", stack]);
  if (s.size || s.scale) {
    const base = s.size ? SIZE_VALUES[s.size] : "1em";
    out.push(["font-size", s.scale && s.scale !== 1 ? `calc(${base} * ${round(s.scale)})` : base]);
  }
  if (s.weight) out.push(["font-weight", String(s.weight)]);
  if (s.italic !== undefined) out.push(["font-style", s.italic ? "italic" : "normal"]);
  if (s.case) out.push(["text-transform", s.case === "upper" ? "uppercase" : "none"]);
  if (s.tracking !== undefined) out.push(["letter-spacing", `${round(s.tracking)}em`]);
  if (s.color) out.push(["color", `var(--t-color-${s.color})`]);
  if (s.align) out.push(["text-align", s.align]);
  return out;
}

/** Style React (camelCase) d'un style local. */
export function textStyleObject(style: TextStyle | undefined): Record<string, string> | undefined {
  const decls = textStyleDecls(style);
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
});
export type Crop = z.infer<typeof CropSchema>;
export const CROP_FIELDS = ["mediaId", "backgroundMediaId", "portraitMediaId"] as const;

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
  roleBackdrop: z.enum(BACKDROPS).optional(),
  /**
   * Arrondi d'une image précise d'une planche (intégration lots 2 + 3), par
   * emplacement (slug de l'emplacement) : surcharge l'arrondi du bloc.
   */
  slotRadius: bounded(z.record(z.string().max(80).regex(/^[a-z0-9-]+$/), z.enum(RADII)), 200, "arrondis d'images").optional(),
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
  if (crop) a["data-crop"] = "";
  return Object.keys(a).length ? a : null;
}

/** Variables de cadrage posées sur l'enveloppe (un seul média recadrable par bloc). */
export function cropStyle(look: Look | undefined): Record<string, string> | undefined {
  const crop = look?.crop && Object.values(look.crop)[0];
  if (!crop) return undefined;
  return { "--crop-pos": `${round(crop.x, 2)}% ${round(crop.y, 2)}%`, "--crop-zoom": String(round(crop.zoom)) };
}

/* ---- Styles du site (globaux) --------------------------------------------------------- */

export const SiteStylesSchema = z.strictObject({
  roles: z.partialRecord(z.enum(ROLES), TextStyleSchema).optional(),
  /** Arrondi des images et cartes du site (surcharge le thème). */
  radius: z.enum(RADII).optional(),
});
export type SiteStyles = z.infer<typeof SiteStylesSchema>;

export const radiusValue = (r: Radius) => RADIUS_VALUES[r];

/** Feuille des styles globaux (règles générées depuis des crans validés). */
export function siteStylesCss(styles: SiteStyles | undefined): string {
  const parsed = SiteStylesSchema.safeParse(styles ?? {});
  if (!parsed.success) return "";
  const s = parsed.data;
  const rules: string[] = [];
  if (s.radius) rules.push(`:root{--media-radius:${RADIUS_VALUES[s.radius]}}`);
  // Ordre : légendes avant menu et nom du site (à spécificité égale, le dernier gagne).
  for (const role of ["body", "caption", "eyebrow", "h2", "h1", "menu", "brand"] as Role[]) {
    const decls = textStyleDecls(s.roles?.[role]);
    if (decls.length) rules.push(`${ROLE_SELECTORS[role]}{${decls.map(([k, v]) => `${k}:${v}`).join(";")}}`);
  }
  // Rien d'injectable n'arrive ici (crans et catalogue), ceinture quand même.
  return rules.join("\n").replace(/</g, "\\3c ");
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
    const decls = textStyleDecls({ ...t, font: t.font ? `theme:${t.font}` : undefined });
    if (decls.length) rules.push(`${ROLE_SELECTORS[role]}{${decls.map(([k, v]) => `${k}:${v}`).join(";")}}`);
  }
  return rules.join("\n").replace(/</g, "\\3c ");
}

/** Familles Google citées par des styles (globaux ou locaux). */
export function googleFamiliesOf(styles: (TextStyle | undefined)[]): string[] {
  return [...new Set(styles.map((s) => googleOf(s?.font)).filter((f): f is string => Boolean(f)))];
}

/** Styles du site sans rôle vide ; undefined s'il ne reste rien (= thème seul). */
export function cleanSiteStyles(styles: SiteStyles | undefined): SiteStyles | undefined {
  if (!styles) return undefined;
  const roles = Object.fromEntries(
    Object.entries(styles.roles ?? {})
      .map(([k, v]) => [k, Object.fromEntries(Object.entries(v ?? {}).filter(([, x]) => x !== undefined))])
      .filter(([, v]) => Object.keys(v as object).length),
  ) as SiteStyles["roles"];
  const out: SiteStyles = { ...(roles && Object.keys(roles).length ? { roles } : {}), ...(styles.radius ? { radius: styles.radius } : {}) };
  return Object.keys(out).length ? out : undefined;
}
