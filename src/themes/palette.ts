/**
 * Palette d'un thème : couleurs de base et leurs nuances (docs/THEME-KIT.md,
 * section « Palette »). Module pur (aucun import) : chargé par css.ts, par
 * l'éditeur (client), par le kit PSD et par les scripts de test.
 *
 * Modèle :
 *  - 6 couleurs de BASE, toujours choisies : bg, surface, ink, primary,
 *    secondary, tertiary ;
 *  - des NUANCES, chacune « auto » (dérivée de sa base, en OKLCH) ou
 *    « forcée » (valeur choisie) :
 *      · nuances ENREGISTRÉES (bgDeep, line, inkSoft, primaryHover, onPrimary) :
 *        toujours présentes dans `tokens.color` (valeur effective, lue telle
 *        quelle par tout le code) ; « auto » = listées dans `tokens.palette.auto`,
 *        valeur recalculée à chaque changement (normalizePalette) ;
 *      · nuances FACULTATIVES (eyebrow, shadow, scrim, onScrim) : absentes =
 *        auto, dérivées exactement comme avant ce modèle (eyebrow = secondary,
 *        ombre / voile selon clair-sombre) ; présentes = forcées.
 *  - Migration : aucune. Un thème existant n'a pas de `tokens.palette` : ses
 *    nuances enregistrées sont forcées à leur valeur actuelle, ses nuances
 *    facultatives absentes restent dérivées par la règle d'avant. Rendu
 *    identique (scripts/test-palette.mjs le vérifie preset par preset).
 */

export const BASE_KEYS = ["bg", "surface", "ink", "primary", "secondary", "tertiary"] as const;
export type BaseKey = (typeof BASE_KEYS)[number];
/** Nuances toujours présentes dans tokens.color (auto : listées dans tokens.palette.auto). */
export const STORED_NUANCES = ["bgDeep", "line", "inkSoft", "primaryHover", "onPrimary"] as const;
/** Nuances facultatives (absentes : auto). */
export const OPTIONAL_NUANCES = ["eyebrow", "shadow", "scrim", "onScrim"] as const;
export type StoredNuance = (typeof STORED_NUANCES)[number];
export type OptionalNuance = (typeof OPTIONAL_NUANCES)[number];
export type NuanceKey = StoredNuance | OptionalNuance;
export type PaletteKey = BaseKey | NuanceKey;
/** Ordre de dérivation (une nuance peut dépendre d'une précédente : inkSoft lit bgDeep). */
export const NUANCE_KEYS: NuanceKey[] = ["bgDeep", "line", "inkSoft", "shadow", "primaryHover", "onPrimary", "eyebrow", "scrim", "onScrim"];

/** Couleurs telles que stockées (forme de tokens.color, sans dépendre de zod). */
export type PaletteColors = {
  bg: string;
  bgDeep: string;
  surface: string;
  ink: string;
  inkSoft: string;
  line: string;
  primary: string;
  primaryHover: string;
  onPrimary: string;
  secondary: string;
  tertiary: string;
  eyebrow?: string;
  shadow?: string;
  scrim?: string;
  onScrim?: string;
  [k: string]: string | undefined;
};
export type PaletteState = { auto?: StoredNuance[] };
/** Toutes les couleurs de la palette, nuances résolues. */
export type ResolvedPalette = Record<PaletteKey, string>;

export type NuanceSpec = {
  key: NuanceKey;
  /** Libellé dans l'éditeur (identique aux anciens libellés : tests et habitudes). */
  label: string;
  /** Nom court dans le kit (« survol » → calque « Action · survol »). */
  short: string;
  help: string;
  /** Accepte une transparence (rgba) : filets. */
  free?: boolean;
  /** Texte : contraste vérifié (contrast.ts). */
  contrast?: boolean;
  /** Règle « auto » en clair, pour l'éditeur. */
  rule: string;
};
export type PaletteGroup = {
  id: string;
  /** Libellé du groupe (et nom de la base dans le kit). */
  label: string;
  base: BaseKey | null;
  baseHelp?: string;
  baseFree?: boolean;
  nuances: NuanceSpec[];
};

/**
 * Groupes de la palette, dans l'ordre de l'éditeur et du kit. Les libellés des
 * bases reprennent ceux de l'éditeur de thème (« Action » = primary).
 */
export const PALETTE_GROUPS: PaletteGroup[] = [
  {
    id: "fond",
    label: "Fond",
    base: "bg",
    baseHelp: "Le fond des pages.",
    nuances: [
      { key: "bgDeep", label: "Fond profond", short: "profond", help: "Sépare deux sections sans filet.", contrast: true, rule: "le fond, un cran plus foncé (plus clair sur un thème sombre)" },
      { key: "line", label: "Filets", short: "filets", help: "Traits de séparation ; transparence acceptée.", free: true, rule: "12 % du texte dans le fond" },
    ],
  },
  { id: "surface", label: "Surface", base: "surface", baseHelp: "Cartes, champs, visionneuse.", nuances: [] },
  {
    id: "texte",
    label: "Texte",
    base: "ink",
    baseHelp: "Titres et paragraphes.",
    nuances: [
      { key: "inkSoft", label: "Texte secondaire", short: "secondaire", help: "Présentations et légendes.", contrast: true, rule: "le texte éclairci vers le fond, juste assez pour rester lisible" },
      { key: "shadow", label: "Ombres", short: "ombres", help: "Teinte des ombres des cartes et des images.", rule: "le texte (noir sur un thème sombre)" },
    ],
  },
  {
    id: "action",
    label: "Action",
    base: "primary",
    baseHelp: "Liens et fond des boutons.",
    nuances: [
      { key: "primaryHover", label: "Action au survol", short: "survol", help: "Boutons et liens sous la souris.", rule: "l'action un cran plus foncée (plus claire sur un thème sombre)" },
      { key: "onPrimary", label: "Texte des boutons", short: "texte dessus", help: "Posé sur la couleur d'action.", contrast: true, rule: "blanc, ou la couleur la plus sombre du thème si elle se lit mieux" },
    ],
  },
  {
    id: "secondaire",
    label: "Accent secondaire",
    base: "secondary",
    baseHelp: "Détails mis en valeur.",
    nuances: [{ key: "eyebrow", label: "Étiquettes", short: "étiquettes", help: "Petits textes au-dessus des titres.", contrast: true, rule: "l'accent secondaire" }],
  },
  { id: "details", label: "Détails", base: "tertiary", baseHelp: "Ornements discrets ; transparence acceptée.", baseFree: true, nuances: [] },
  {
    id: "visionneuse",
    label: "Visionneuse",
    base: null,
    nuances: [
      { key: "scrim", label: "Voile de la visionneuse", short: "voile", help: "Fond sombre derrière une image agrandie ou une vidéo.", rule: "le texte (le fond sur un thème sombre)" },
      { key: "onScrim", label: "Texte sur le voile", short: "texte", help: "Légendes et boutons posés sur le voile.", contrast: true, rule: "le fond (le texte sur un thème sombre)" },
    ],
  },
];

export const BASE_LABELS: Record<BaseKey, string> = { bg: "Fond", surface: "Surface", ink: "Texte", primary: "Action", secondary: "Accent secondaire", tertiary: "Détails" };

export const isStoredNuance = (k: string): k is StoredNuance => (STORED_NUANCES as readonly string[]).includes(k);
export const isOptionalNuance = (k: string): k is OptionalNuance => (OPTIONAL_NUANCES as readonly string[]).includes(k);
export const isNuance = (k: string): k is NuanceKey => isStoredNuance(k) || isOptionalNuance(k);

/** Libellé complet d'une couleur de la palette : « Action · survol », « Fond ». */
export function paletteLabel(key: PaletteKey): string {
  for (const g of PALETTE_GROUPS) {
    if (g.base === key) return g.label;
    const n = g.nuances.find((x) => x.key === key);
    if (n) return `${g.label} · ${n.short}`;
  }
  return key;
}

/* ---- Couleur : sRVB ↔ OKLab / OKLCH -------------------------------------- */

type Rgb = [number, number, number];
type Lab = [number, number, number];

export function parseColor(input: string): { rgb: Rgb; alpha: number } | null {
  const s = input.trim();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = [...h].map((c) => c + c).join("");
    const n = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
    return { rgb: n, alpha: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s);
  if (m) return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])].map((v) => Math.max(0, Math.min(255, v))) as Rgb, alpha: m[4] === undefined ? 1 : Math.max(0, Math.min(1, Number(m[4]))) };
  return null;
}

export const toHex = ([r, g, b]: Rgb) => `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;

/** Couleur opaque : posée sur `ground` si elle est transparente (filets en rgba). */
export function opaqueOn(color: string, ground: string): string {
  const c = parseColor(color);
  const g = parseColor(ground);
  if (!c || !g) return color;
  if (c.alpha >= 1) return toHex(c.rgb);
  return toHex(c.rgb.map((v, i) => v * c.alpha + g.rgb[i] * (1 - c.alpha)) as Rgb);
}

const lin = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const gam = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

export function rgbToOklab([r8, g8, b8]: Rgb): Lab {
  const [r, g, b] = [lin(r8), lin(g8), lin(b8)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** OKLab → sRVB linéaire non borné (pour tester l'appartenance au gamut). */
function oklabToLinear([L, a, b]: Lab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
const inGamut = (c: Rgb) => c.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

export type Oklch = { l: number; c: number; h: number };
export function toOklch(hex: string): Oklch {
  const p = parseColor(hex);
  const [L, a, b] = rgbToOklab(p ? p.rgb : [0, 0, 0]);
  return { l: L, c: Math.hypot(a, b), h: (Math.atan2(b, a) * 180) / Math.PI };
}
/** OKLCH → #rrggbb ; hors gamut : chroma réduite (même teinte, même luminosité). */
export function fromOklch({ l, c, h }: Oklch): string {
  const L = Math.max(0, Math.min(1, l));
  const rad = (h * Math.PI) / 180;
  const lab = (cc: number): Lab => [L, cc * Math.cos(rad), cc * Math.sin(rad)];
  let cc = Math.max(0, c);
  if (!inGamut(oklabToLinear(lab(cc)))) {
    let lo = 0;
    let hi = cc;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklabToLinear(lab(mid)))) lo = mid;
      else hi = mid;
    }
    cc = lo;
  }
  return toHex(oklabToLinear(lab(cc)).map((v) => gam(Math.max(0, Math.min(1, v)))) as Rgb);
}
/** Mélange en OKLab : t = 0 → a, t = 1 → b. */
export function mixOklab(a: string, b: string, t: number): string {
  const A = rgbToOklab(parseColor(a)?.rgb ?? [0, 0, 0]);
  const B = rgbToOklab(parseColor(b)?.rgb ?? [0, 0, 0]);
  const m = A.map((v, i) => v + (B[i] - v) * t) as Lab;
  return fromOklch({ l: m[0], c: Math.hypot(m[1], m[2]), h: (Math.atan2(m[2], m[1]) * 180) / Math.PI });
}

/* ---- Contraste (mêmes formules que contrast.ts, sans import) ------------- */

function luminance(hex: string): number {
  const p = parseColor(hex);
  if (!p) return 0;
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(p.rgb[0]) + 0.7152 * f(p.rgb[1]) + 0.0722 * f(p.rgb[2]);
}
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const AA = 4.5;

/** Clair ou sombre (même seuil que css.ts). */
export const isDarkBg = (bg: string) => luminance(bg) < 0.2;

/* ---- Dérivation « auto » ------------------------------------------------- */

/** Réglages de dérivation (OKLCH), documentés dans docs/THEME-KIT.md. */
export const DERIVE = {
  /** Fond profond : décalage de luminosité OKLCH. */
  bgDeepShift: 0.025,
  /** Fond profond : chroma multipliée (un papier profond est un peu plus teinté). */
  bgDeepChroma: 1.5,
  /** Filets : part du texte mélangée au fond (OKLab). */
  lineMix: 0.12,
  /** Texte secondaire : part du fond mélangée au texte, réduite jusqu'à l'AA. */
  inkSoftMix: 0.35,
  /** Survol : décalage de luminosité OKLCH. */
  hoverShift: 0.06,
} as const;

/**
 * Valeur « auto » d'une nuance, d'après les couleurs déjà résolues (`c` : bases
 * et nuances précédentes dans NUANCE_KEYS).
 */
export function deriveNuance(key: NuanceKey, c: Record<string, string | undefined>): string {
  const bg = c.bg!;
  const ink = c.ink!;
  const dark = isDarkBg(bg);
  switch (key) {
    case "bgDeep": {
      const o = toOklch(bg);
      return fromOklch({ ...o, l: o.l + (dark ? DERIVE.bgDeepShift : -DERIVE.bgDeepShift), c: Math.min(0.37, o.c * DERIVE.bgDeepChroma) });
    }
    case "line":
      return mixOklab(bg, ink, DERIVE.lineMix);
    case "inkSoft": {
      const grounds = [bg, c.bgDeep ?? bg, c.surface ?? bg];
      for (let t = DERIVE.inkSoftMix; t > 0; t -= 0.01) {
        const v = mixOklab(ink, bg, t);
        if (grounds.every((g) => contrastRatio(v, g) >= AA)) return v;
      }
      return toHex(parseColor(ink)?.rgb ?? [0, 0, 0]);
    }
    case "shadow":
      return dark ? "#000000" : ink;
    case "primaryHover": {
      const o = toOklch(c.primary!);
      return fromOklch({ ...o, l: o.l + (dark ? DERIVE.hoverShift : -DERIVE.hoverShift) });
    }
    case "onPrimary": {
      const darkest = luminance(ink) < luminance(bg) ? ink : bg;
      const white = "#ffffff";
      return contrastRatio(white, c.primary!) >= contrastRatio(darkest, c.primary!) ? white : darkest;
    }
    case "eyebrow":
      return c.secondary!;
    case "scrim":
      return dark ? bg : ink;
    case "onScrim":
      return dark ? ink : bg;
  }
}

/** La nuance est-elle « auto » ? */
export function isAuto(color: PaletteColors, palette: PaletteState | undefined, key: NuanceKey): boolean {
  return isStoredNuance(key) ? Boolean(palette?.auto?.includes(key)) : color[key] === undefined;
}

/** Toutes les couleurs de la palette, nuances auto dérivées (rendu, aperçu, kit). */
export function resolvePalette(color: PaletteColors, palette?: PaletteState): ResolvedPalette {
  const out: Record<string, string> = {};
  for (const k of BASE_KEYS) out[k] = color[k];
  for (const k of NUANCE_KEYS) out[k] = isAuto(color, palette, k) ? deriveNuance(k, out) : color[k]!;
  return out as ResolvedPalette;
}

/** Recalcule les nuances enregistrées en « auto » (après tout changement d'une base). */
export function normalizePalette<C extends PaletteColors>(color: C, palette?: PaletteState): C {
  if (!palette?.auto?.length) return color;
  const resolved = resolvePalette(color, palette);
  const out = { ...color };
  for (const k of palette.auto) (out as Record<string, string>)[k] = resolved[k];
  return out;
}

/**
 * Change une nuance : `value` = valeur forcée, `null` = revenir à auto.
 * Renvoie les nouvelles couleurs (normalisées) et le nouvel état de palette.
 */
export function setNuance<C extends PaletteColors>(color: C, palette: PaletteState | undefined, key: NuanceKey, value: string | null): { color: C; palette: PaletteState | undefined } {
  const auto = new Set(palette?.auto ?? []);
  const next = { ...color } as Record<string, string | undefined>;
  if (isStoredNuance(key)) {
    if (value === null) auto.add(key);
    else {
      auto.delete(key);
      next[key] = value;
    }
  } else if (value === null) delete next[key];
  else next[key] = value;
  const p: PaletteState | undefined = auto.size ? { auto: STORED_NUANCES.filter((k) => auto.has(k)) } : undefined;
  return { color: normalizePalette(next as C, p), palette: p };
}

/** Change une base : les nuances auto suivent. */
export function setBase<C extends PaletteColors>(color: C, palette: PaletteState | undefined, key: BaseKey, value: string): C {
  return normalizePalette({ ...color, [key]: value }, palette);
}
