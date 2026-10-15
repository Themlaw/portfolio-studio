/**
 * Couleurs personnalisées d'un texte (lot 7) : conversions et validation, module
 * pur (aucun import) lu par le schéma (src/lib/look.ts), le sélecteur de
 * l'éditeur (ColorPicker) et les tests. Une couleur stockée a UN seul format :
 * `#rrggbb`, ou `#rrggbbaa` quand elle est translucide, en minuscules. Rien
 * d'autre n'entre dans une feuille CSS.
 */

export type Rgba = { r: number; g: number; b: number; a: number };
/** h : 0-360, s / v / l : 0-1, a : 0-1. */
export type Hsva = { h: number; s: number; v: number; a: number };
export type Hsla = { h: number; s: number; l: number; a: number };

/** Format canonique stocké (minuscules, 6 ou 8 chiffres). */
export const CUSTOM_COLOR_RE = /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const byte = (n: number) => clamp(Math.round(n), 0, 255);
const hex2 = (n: number) => byte(n).toString(16).padStart(2, "0");

export function rgbaToHex({ r, g, b, a }: Rgba): string {
  const alpha = byte(a * 255);
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${alpha === 255 ? "" : hex2(alpha)}`;
}

/**
 * Analyse une saisie libre : #rgb, #rgba, #rrggbb, #rrggbbaa (avec ou sans #),
 * rgb(…) / rgba(…), hsl(…) / hsla(…). Null si ce n'est pas une couleur.
 */
export function parseColor(input: string): Rgba | null {
  const s = input.trim().toLowerCase();
  if (!s || s.length > 60) return null;
  const hex = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(s);
  if (hex) {
    let h = hex[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join("");
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  const fn = /^(rgb|hsl)a?\(\s*([^)]*)\)$/.exec(s);
  if (!fn) return null;
  const parts = fn[2].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;
  const num = (p: string, pct = 1) => (/^-?\d*\.?\d+(%|deg)?$/.test(p) ? parseFloat(p) * (p.endsWith("%") ? pct : 1) : NaN);
  const alpha = parts[3] === undefined ? 1 : num(parts[3], 0.01);
  if (Number.isNaN(alpha)) return null;
  if (fn[1] === "rgb") {
    const [r, g, b] = parts.slice(0, 3).map((p) => num(p, 2.55));
    return [r, g, b].some(Number.isNaN) ? null : { r: byte(r), g: byte(g), b: byte(b), a: clamp(alpha, 0, 1) };
  }
  const [h, sat, l] = [num(parts[0]), num(parts[1], 0.01), num(parts[2], 0.01)];
  if ([h, sat, l].some(Number.isNaN)) return null;
  return { ...hslToRgb({ h: ((h % 360) + 360) % 360, s: clamp(sat, 0, 1), l: clamp(l, 0, 1), a: 1 }), a: clamp(alpha, 0, 1) };
}

/** Saisie libre → format canonique stocké, ou null. */
export function normalizeCustomColor(input: string): string | null {
  const rgba = parseColor(input);
  return rgba ? rgbaToHex(rgba) : null;
}

export const isCustomColor = (v: unknown): v is string => typeof v === "string" && CUSTOM_COLOR_RE.test(v);

/* ---- Modèles de couleur -------------------------------------------------------- */

export function hsvToRgb({ h, s, v, a }: Hsva): Rgba {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
  };
  return { r: byte(f(5)), g: byte(f(3)), b: byte(f(1)), a };
}

/** `hueHint` : teinte gardée quand la couleur est grise (la teinte n'est alors pas définie). */
export function rgbToHsv({ r, g, b, a }: Rgba, hueHint = 0): Hsva {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const d = max - Math.min(rr, gg, bb);
  let h = hueHint;
  if (d > 0) {
    h = max === rr ? ((gg - bb) / d + (gg < bb ? 6 : 0)) * 60 : max === gg ? ((bb - rr) / d + 2) * 60 : ((rr - gg) / d + 4) * 60;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max, a };
}

export function hsvToHsl({ h, s, v, a }: Hsva): Hsla {
  const l = v * (1 - s / 2);
  return { h, s: l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l), l, a };
}

export function hslToHsv({ h, s, l, a }: Hsla): Hsva {
  const v = l + s * Math.min(l, 1 - l);
  return { h, s: v === 0 ? 0 : 2 * (1 - l / v), v, a };
}

export function hslToRgb(hsl: Hsla): Rgba {
  return hsvToRgb(hslToHsv(hsl));
}

/** Couleur `fg` (éventuellement translucide) posée sur le fond `bg` : résultat opaque. */
export function over(fg: Rgba, bg: Rgba): Rgba {
  const mix = (a: number, b: number) => a * fg.a + b * (1 - fg.a);
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a: 1 };
}

/** Dégradé conique de la pastille « roue des couleurs » (calculé : aucune couleur écrite à la main). */
export function wheelGradient(): string {
  const stops = Array.from({ length: 13 }, (_, i) => `${rgbaToHex(hsvToRgb({ h: i * 30, s: 1, v: 1, a: 1 }))} ${Math.round((i / 12) * 100)}%`);
  return `conic-gradient(${stops.join(", ")})`;
}

/* ---- Sélecteur « à la Photoshop » (lot 29) ------------------------------------------- */

/** Dégradé vertical de la bande de teinte : rouge en haut (360°), magenta, bleu, cyan, vert, jaune, rouge en bas (0°). */
export function hueStripGradient(): string {
  const stops = Array.from({ length: 13 }, (_, i) => `${rgbaToHex(hsvToRgb({ h: 360 - i * 30, s: 1, v: 1, a: 1 }))} ${Math.round((i / 12) * 100)}%`);
  return `linear-gradient(to bottom, ${stops.join(", ")})`;
}

/** Fond du carré saturation × luminosité pour une teinte : couleur pure, voile blanc à gauche, voile noir en bas. */
export function saturationPlane(h: number): { backgroundColor: string; backgroundImage: string } {
  const white = rgbaToHex(hsvToRgb({ h: 0, s: 0, v: 1, a: 1 }));
  const black = rgbaToHex(hsvToRgb({ h: 0, s: 0, v: 0, a: 1 }));
  return {
    backgroundColor: rgbaToHex(hsvToRgb({ h, s: 1, v: 1, a: 1 })),
    backgroundImage: `linear-gradient(to top, ${black}, transparent), linear-gradient(to right, ${white}, transparent)`,
  };
}

/** Point du carré (fractions 0-1 depuis le coin haut gauche) → saturation (gauche → droite) et luminosité (bas → haut). */
export function planeToSv(fx: number, fy: number): { s: number; v: number } {
  return { s: clamp(fx, 0, 1), v: 1 - clamp(fy, 0, 1) };
}

/** Position verticale (fraction 0-1 depuis le haut) sur la bande → teinte : haut = 360°, bas = 0°. */
export function stripToHue(fy: number): number {
  return (1 - clamp(fy, 0, 1)) * 360;
}
