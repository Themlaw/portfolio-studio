/**
 * Palette du SITE (lot 17f) : les couleurs de base choisies depuis l'éditeur
 * visuel (`styles.palette` du brouillon du site), posées par-dessus celles du
 * thème actif. Module pur (palette.ts et contrast.ts seulement) : lu par le
 * rendu (css.ts), le panneau « Couleurs » de l'éditeur, la toile (aperçu), le
 * serveur (contraste à la publication) et les tests.
 *
 * Source de vérité : le thème garde SES couleurs (jamais modifiées d'ici, même
 * pour un thème livré) ; le site en surcharge explicitement quelques-unes, et
 * les deux côtés le disent (panneau « Couleurs » : « thème » / « modifiée » ;
 * éditeur de thème : avis « le site remplace… »). Les nuances (fond profond,
 * filets, survol, texte secondaire…) qui dépendent d'une base changée sont
 * recalculées (« auto ») ; celles qu'un thème a forcées volontairement sans
 * dépendre d'elle (ombres, voile…) restent.
 */
import { AA, contrastReport, lightnessCandidates, ratio } from "./contrast";
import {
  BASE_KEYS,
  normalizePalette,
  ROLE_NAMES,
  PALETTE_GROUPS,
  resolvePalette,
  STORED_NUANCES,
  type BaseKey,
  type NuanceKey,
  type PaletteColors,
  type PaletteState,
  type ResolvedPalette,
  type StoredNuance,
} from "./palette";

export type SitePalette = Partial<Record<BaseKey, string>>;

/** Nuances enregistrées recalculées quand la base change (celles dont la dérivation la lit). */
const DEPENDENT: Record<BaseKey, StoredNuance[]> = {
  bg: ["bgDeep", "line", "inkSoft", "onPrimary"],
  surface: ["inkSoft"],
  ink: ["line", "inkSoft", "onPrimary"],
  primary: ["primaryHover", "onPrimary"],
  secondary: [],
  tertiary: [],
};

export type RoleInfo = {
  key: BaseKey;
  /** Nom parlant, vu de l'utilisatrice (pas du schéma). */
  name: string;
  /** Une phrase : à quoi ça sert, où ça se voit. */
  phrase: string;
  /** Repli du « utilisé par » quand la toile n'a rien trouvé. */
  uses: string;
  /** Nuances qui en dépendent (affichées en lecture seule). */
  nuances: NuanceKey[];
};

/** Les rôles de couleur, dans l'ordre du panneau. */
export const SITE_ROLES: RoleInfo[] = [
  { key: "bg", name: ROLE_NAMES.bg, phrase: "La couleur derrière tout le site.", uses: "fond des pages et de l'en-tête", nuances: ["bgDeep", "line", "scrim", "onScrim"] },
  { key: "surface", name: ROLE_NAMES.surface, phrase: "Le fond des cartes, des champs de saisie et des encadrés.", uses: "cartes, champs, encadrés", nuances: [] },
  { key: "ink", name: ROLE_NAMES.ink, phrase: "Titres, paragraphes et menus.", uses: "titres, paragraphes, menu", nuances: ["inkSoft", "shadow"] },
  { key: "primary", name: ROLE_NAMES.primary, phrase: "Les liens et les boutons : tout ce qui se clique.", uses: "liens, boutons", nuances: ["primaryHover", "onPrimary"] },
  { key: "secondary", name: ROLE_NAMES.secondary, phrase: "Les petits détails mis en valeur : étiquettes, soulignés.", uses: "étiquettes, soulignés", nuances: ["eyebrow"] },
  { key: "tertiary", name: ROLE_NAMES.tertiary, phrase: "Traits et ornements discrets.", uses: "ornements, détails", nuances: [] },
];

/** Usage de chaque nuance, en clair. */
export const NUANCE_USES: Record<NuanceKey, string> = {
  bgDeep: "Sépare deux sections sans filet.",
  line: "Traits de séparation.",
  inkSoft: "Présentations et légendes.",
  shadow: "Teinte des ombres des cartes et des images.",
  primaryHover: "Boutons et liens sous la souris.",
  onPrimary: "Posé sur la couleur des boutons.",
  eyebrow: "Petits textes au-dessus des titres.",
  scrim: "Fond derrière une image agrandie.",
  onScrim: "Légendes et boutons de la visionneuse.",
};

export const nuanceLabel = (key: NuanceKey): string => PALETTE_GROUPS.flatMap((g) => g.nuances).find((n) => n.key === key)?.label ?? key;

export const roleInfo = (key: BaseKey): RoleInfo => SITE_ROLES.find((r) => r.key === key)!;

/** Couleurs du thème avec les bases du site posées dessus (nuances dépendantes recalculées). */
export function applySitePalette<C extends PaletteColors>(color: C, palette: PaletteState | undefined, overrides: SitePalette | undefined): { color: C; palette: PaletteState | undefined } {
  const keys = BASE_KEYS.filter((k) => typeof overrides?.[k] === "string");
  if (!keys.length) return { color, palette };
  const auto = new Set<StoredNuance>(palette?.auto ?? []);
  for (const k of keys) for (const n of DEPENDENT[k]) auto.add(n);
  const p: PaletteState = { auto: STORED_NUANCES.filter((n) => auto.has(n)) };
  const next = { ...color } as Record<string, string | undefined>;
  for (const k of keys) next[k] = overrides![k];
  return { color: normalizePalette(next as C, p), palette: p };
}

/** Toutes les couleurs effectives du site (thème + surcharges), nuances résolues. */
export function effectiveSitePalette(color: PaletteColors, palette: PaletteState | undefined, overrides: SitePalette | undefined): ResolvedPalette {
  const a = applySitePalette(color, palette, overrides);
  return resolvePalette(a.color, a.palette);
}

/**
 * Palette que lisent les pages : la palette effective du site, ou celle du thème si la palette du site rendrait du
 * texte illisible (ignorée au rendu public ; la vue brouillon la montre pour la corriger). Mêmes règles que le layout.
 */
export function pagePalette(color: PaletteColors, palette: PaletteState | undefined, overrides: SitePalette | undefined, edit: boolean): ResolvedPalette {
  const usable = overrides && (edit || !sitePaletteProblem(color, palette, overrides));
  return usable ? effectiveSitePalette(color, palette, overrides) : resolvePalette(color, palette);
}

/** Un couple texte / fond : libellé, ratio et jetons de la palette concernés (texte, fond). */
export type SiteContrastPair = { label: string; ratio: number; ok: boolean; tokens: [string, string] };

/** Tous les couples vérifiés avec la palette du site (couples du thème + voile de la visionneuse). */
export function sitePalettePairs(color: PaletteColors, palette: PaletteState | undefined, overrides: SitePalette | undefined): SiteContrastPair[] {
  const p = effectiveSitePalette(color, palette, overrides);
  const pairs: SiteContrastPair[] = contrastReport(p).map((r) => ({ label: r.label, ratio: r.ratio, ok: r.ok, tokens: [r.fg, r.bg] }));
  const scrim = ratio(p.onScrim, p.scrim);
  pairs.push({ label: "Texte sur le voile de la visionneuse", ratio: scrim, ok: scrim >= AA, tokens: ["onScrim", "scrim"] });
  return pairs;
}

/** Couples sous 4,5:1 avec la palette du site, voile de la visionneuse compris. */
export function sitePaletteIssues(color: PaletteColors, palette: PaletteState | undefined, overrides: SitePalette | undefined): SiteContrastPair[] {
  return sitePalettePairs(color, palette, overrides).filter((p) => !p.ok);
}

/** Jetons de la palette (bases et nuances qui en dépendent) dont le contraste engage chaque rôle. */
const ROLE_TOKENS: Record<BaseKey, string[]> = {
  bg: ["bg", "bgDeep", "scrim", "onScrim"],
  surface: ["surface"],
  ink: ["ink", "inkSoft", "scrim", "onScrim"],
  primary: ["primary", "onPrimary"],
  secondary: ["secondary", "eyebrow"],
  tertiary: [],
};

/** Couples (réussis ou non) que ce rôle engage : texte sur fond profond compris pour « Fond de page ». */
export function rolePairs(color: PaletteColors, palette: PaletteState | undefined, overrides: SitePalette | undefined, key: BaseKey): SiteContrastPair[] {
  const own = ROLE_TOKENS[key];
  return sitePalettePairs(color, palette, overrides).filter((p) => p.tokens.some((t) => own.includes(t)));
}

/** Message de refus (publication), ou null si tout passe. */
export function sitePaletteProblem(color: PaletteColors, palette: PaletteState | undefined, overrides: SitePalette | undefined): string | null {
  const issues = sitePaletteIssues(color, palette, overrides);
  if (!issues.length) return null;
  const worst = issues.reduce((a, b) => (b.ratio < a.ratio ? b : a));
  return `Les couleurs du site rendraient du texte illisible (${worst.label.toLowerCase()} : ${worst.ratio.toFixed(2).replace(".", ",")}:1, il faut au moins ${AA.toString().replace(".", ",")}:1). Ajuste-les dans « Couleurs » ou rétablis celles du thème.`;
}

/** Bases dont le contraste est vérifié (le texte et les fonds qu'il touche). */
export const CONTRAST_BASES: readonly BaseKey[] = ["bg", "surface", "ink", "primary", "secondary"];

/**
 * « Ajuster automatiquement » : la teinte la plus proche (même teinte et saturation, luminosité déplacée au
 * minimum : assombrir ou éclaircir selon le cas) après laquelle la palette n'a pas plus de couples sous 4,5:1
 * qu'avant ce changement, NUANCES RECALCULÉES COMPRISES (un fond plus teinté change le fond profond, qui doit
 * lui aussi tenir). Null si aucune teinte proche ne convient.
 *
 * `allowedIssues` (couleurs du thème, lot 19b) : nombre de couples sous 4,5:1 toléré, quand `color` porte déjà la
 * couleur à ajuster (ici le thème lui-même, pas une surcharge qu'on retire pour savoir ce qui était acceptable).
 */
export function autoAdjustBase(color: PaletteColors, palette: PaletteState | undefined, overrides: SitePalette | undefined, key: BaseKey, allowedIssues?: number): string | null {
  if (!CONTRAST_BASES.includes(key)) return null;
  const without: SitePalette = { ...(overrides ?? {}) };
  const current = effectiveSitePalette(color, palette, overrides)[key];
  delete without[key];
  const allowed = allowedIssues ?? sitePaletteIssues(color, palette, without).length;
  for (const candidate of lightnessCandidates(current)) {
    if (sitePaletteIssues(color, palette, { ...without, [key]: candidate.toLowerCase() }).length <= allowed) return candidate.toLowerCase();
  }
  return null;
}
