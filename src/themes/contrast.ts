/**
 * Contraste WCAG des thèmes — logique UNIQUE, partagée par :
 *  - scripts/check-contrast.mjs (CI, presets) ;
 *  - l'éditeur de thème (indicateurs en direct, « Ajuster ») ;
 *  - les server actions (revalidation côté serveur, jamais de confiance au client).
 * Module pur, sans import : chargeable directement par Node.
 */

export const AA = 4.5;

type ColorTokens = {
  bg: string;
  bgDeep: string;
  surface: string;
  ink: string;
  inkSoft: string;
  primary: string;
  onPrimary: string;
  secondary: string;
  eyebrow?: string;
};

export type ContrastPair = {
  /** Token de texte (clé de color), ou « eyebrow » effectif. */
  fg: keyof ColorTokens;
  bg: keyof ColorTokens;
  label: string;
};

// Noms des six rôles (`ROLE_NAMES`, palette.ts : vocabulaire unique de l'interface, vérifié par test-couleurs26) ; ce
// module n'importe rien (script Node de la CI), les noms sont donc répétés ici.
const TEXTS: [keyof ColorTokens, string][] = [
  ["ink", "Texte"],
  ["inkSoft", "Texte secondaire"],
  ["eyebrow", "Étiquettes"],
  ["secondary", "Accent"],
  ["primary", "Boutons et liens"],
];
const GROUNDS: [keyof ColorTokens, string][] = [
  ["bg", "fond de page"],
  ["bgDeep", "fond profond"],
  ["surface", "cartes et encadrés"],
];

/** Couples texte / fond vérifiés (ceux que les composants utilisent réellement). */
export const CONTRAST_PAIRS: ContrastPair[] = [
  ...TEXTS.flatMap(([fg, fl]) => GROUNDS.map(([bg, bl]) => ({ fg, bg, label: `${fl} sur ${bl}` }))),
  { fg: "onPrimary", bg: "primary", label: "Texte des boutons" },
];

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

export function luminance(hex: string): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Valeur effective d'un token (eyebrow retombe sur secondary). */
export function tokenValue(colors: ColorTokens, key: keyof ColorTokens): string {
  return key === "eyebrow" ? (colors.eyebrow ?? colors.secondary) : (colors[key] as string);
}

export type PairResult = ContrastPair & { fgValue: string; bgValue: string; ratio: number; ok: boolean };

export function contrastReport(colors: ColorTokens, min = AA): PairResult[] {
  return CONTRAST_PAIRS.map((pair) => {
    const fgValue = tokenValue(colors, pair.fg);
    const bgValue = tokenValue(colors, pair.bg);
    const r = ratio(fgValue, bgValue);
    return { ...pair, fgValue, bgValue, ratio: r, ok: r >= min };
  });
}

/** Couples qui concernent un token (en texte ou en fond). */
export function pairsForToken(colors: ColorTokens, key: keyof ColorTokens, min = AA): PairResult[] {
  return contrastReport(colors, min).filter(
    (p) => p.fg === key || p.bg === key || (key === "secondary" && p.fg === "eyebrow" && !colors.eyebrow),
  );
}

/* ---- Teinte la plus proche qui passe (même teinte, luminosité corrigée) -- */

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === rr ? (gg - bb) / d + (gg < bb ? 6 : 0) : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
  h /= 6;
  return [h, s, l];
}

function hslToHex([h, s, l]: [number, number, number]): string {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/**
 * Teinte la plus proche de `hex` (même teinte et saturation, luminosité
 * déplacée au minimum) qui atteint `min` contre TOUS les fonds donnés.
 * Renvoie null si aucune luminosité ne convient.
 */
export function nearestPassing(hex: string, grounds: string[], min = AA): string | null {
  if (grounds.every((g) => ratio(hex, g) >= min)) return hex;
  const [h, s, l0] = rgbToHsl(hexToRgb(hex));
  for (let step = 1; step <= 100; step++) {
    for (const dir of [-1, 1]) {
      const l = l0 + (dir * step) / 100;
      if (l < 0 || l > 1) continue;
      const candidate = hslToHex([h, s, l]);
      if (grounds.every((g) => ratio(candidate, g) >= min)) return candidate;
    }
  }
  return null;
}

/**
 * Ajuste un token de TEXTE pour qu'il passe sur ses fonds, ou un token de FOND
 * pour que ses textes passent dessus. Renvoie la nouvelle valeur ou null.
 */
export function adjustToken(colors: ColorTokens, key: keyof ColorTokens, min = AA): string | null {
  const failing = pairsForToken(colors, key, min).filter((p) => !p.ok);
  if (failing.length === 0) return tokenValue(colors, key);
  const asText = failing.filter((p) => p.fg === key || (key === "secondary" && p.fg === "eyebrow"));
  const asGround = failing.filter((p) => p.bg === key);
  const current = tokenValue(colors, key);
  const [h, s, l0] = rgbToHsl(hexToRgb(current));
  for (let step = 0; step <= 100; step++) {
    for (const dir of step === 0 ? [0] : [-1, 1]) {
      const l = l0 + (dir * step) / 100;
      if (l < 0 || l > 1) continue;
      const candidate = step === 0 ? current : hslToHex([h, s, l]);
      const textsOk = asText.every((p) => ratio(candidate, p.bgValue) >= min);
      const groundsOk = asGround.every((p) => ratio(p.fgValue, candidate) >= min);
      if (textsOk && groundsOk) return candidate;
    }
  }
  return null;
}

/**
 * Variantes d'une couleur (même teinte et saturation), de la plus proche à la plus lointaine en luminosité
 * (un point à la fois, des deux côtés ; la couleur elle-même en premier). Sert à chercher la teinte la plus
 * proche qui passe un contrôle qu'on ne sait pas écrire comme un simple contraste (nuances recalculées).
 */
export function lightnessCandidates(hex: string): string[] {
  const [h, s, l0] = rgbToHsl(hexToRgb(hex));
  const out = [hex];
  for (let step = 1; step <= 100; step++) {
    for (const dir of [-1, 1]) {
      const l = l0 + (dir * step) / 100;
      if (l >= 0 && l <= 1) out.push(hslToHex([h, s, l]));
    }
  }
  return out;
}

/** Teinte de survol : même teinte, luminosité décalée de 8 points (vers le noir si clair). */
export function hoverShade(hex: string): string {
  const [h, s, l] = rgbToHsl(hexToRgb(hex));
  return hslToHex([h, s, Math.max(0, Math.min(1, l > 0.5 ? l - 0.08 : l + 0.08))]);
}

/**
 * Accent de page (remplace « primary » sur la page) : lisible comme lien sur
 * les trois fonds, et sous le texte des boutons. Message, ou null s'il passe.
 */
export function accentProblem(
  accent: string,
  colors: { bg: string; bgDeep: string; surface: string; onPrimary: string },
  min = AA,
): string | null {
  const grounds: [string, string][] = [
    [colors.bg, "le fond"],
    [colors.bgDeep, "le fond profond"],
    [colors.surface, "la surface"],
  ];
  for (const [g, name] of grounds) {
    const r = ratio(accent, g);
    if (r < min) return `Contraste insuffisant sur ${name} : ${r.toFixed(2)}:1, il faut au moins ${min}:1.`;
  }
  const r = ratio(colors.onPrimary, accent);
  if (r < min) return `Le texte des boutons serait illisible sur cet accent : ${r.toFixed(2)}:1, il faut au moins ${min}:1.`;
  return null;
}

/** Accent le plus proche (même teinte) qui passe accentProblem, ou null. */
export function nearestAccent(
  accent: string,
  colors: { bg: string; bgDeep: string; surface: string; onPrimary: string },
  min = AA,
): string | null {
  if (!accentProblem(accent, colors, min)) return accent;
  const [h, s, l0] = rgbToHsl(hexToRgb(accent));
  for (let step = 1; step <= 100; step++) {
    for (const dir of [-1, 1]) {
      const l = l0 + (dir * step) / 100;
      if (l < 0 || l > 1) continue;
      const c = hslToHex([h, s, l]);
      if (!accentProblem(c, colors, min)) return c;
    }
  }
  return null;
}
