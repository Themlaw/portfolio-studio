/**
 * Thème → feuille `:root{…}` + attributs `data-*` pour <html>.
 *
 * Les variables émises portent le préfixe `--t-` : `globals.css` les relaie
 * vers les noms Tailwind (`--color-bg: var(--t-color-bg)`), sans jamais
 * d'auto-référence (`--color-bg: var(--color-bg)` serait un cycle CSS).
 * Module pur (sans next/font) : l'éditeur de thème l'utilise côté client pour
 * l'aperçu en direct.
 */
import { FONT_STACKS as FONT_CATALOG } from "./font-stacks";
import { airVariables } from "./backdrop-air";
import { resolvePalette, type PaletteColors } from "./palette";
import { applySitePalette, type SitePalette } from "./site-palette";
import type { KitAssets, KitCursor, KitImage, Theme } from "./schema";

/** Image d'un asset du kit : SVG, ou AVIF + WebP (image-set). Chemins validés par le schéma. */
function kitImage(k: KitImage): string {
  return k.svg ? `url("${k.svg}")` : `image-set(url("${k.avif}") type("image/avif"), url("${k.webp}") type("image/webp"))`;
}
/** Masque (mask-image) : SVG, sinon le WebP (alpha) — image-set n'est pas sûr dans mask-image. */
function kitMask(k: KitImage): string {
  return `url("${k.svg ?? k.webp}")`;
}
const ICONS = [
  ["arrowLeft", "arrow-left"],
  ["arrowRight", "arrow-right"],
  ["close", "close"],
  ["play", "play"],
] as const;

/* ---- Curseurs (lot 4) ---- */
/** `cursor` sûr partout : PNG 32 × 32, point chaud, repli obligatoire. */
const cursorValue = (c: KitCursor, fallback: "auto" | "pointer") => `url("${c.png}") ${c.x} ${c.y}, ${fallback}`;
/** HiDPI : image-set 1x / 2x (utilisé sous @supports dans variants.css). */
const cursorValueHd = (c: KitCursor, fallback: "auto" | "pointer") => `image-set(url("${c.png}") 1x, url("${c.png2x}") 2x) ${c.x} ${c.y}, ${fallback}`;
/** Curseurs dessinés actifs (présents et non désactivés). */
export function activeCursors(kit: KitAssets | undefined): { default?: KitCursor; pointer?: KitCursor } {
  const c = kit?.cursors;
  if (!c || c.off) return {};
  return { ...(c.default ? { default: c.default } : {}), ...(c.pointer ? { pointer: c.pointer } : {}) };
}
/* ---- fin Curseurs (lot 4) ---- */

/** Variables des éléments dessinés (aucune si le thème n'en a pas : rendu inchangé). */
export function kitVariables(kit: KitAssets | undefined): Record<string, string> {
  const v: Record<string, string> = {};
  if (!kit) return v;
  if (kit.signature) {
    v["--t-kit-signature"] = kit.signature.colors ? kitImage(kit.signature) : kitMask(kit.signature);
    v["--t-kit-signature-ratio"] = `${kit.signature.w} / ${kit.signature.h}`;
  }
  if (kit.paper) {
    v["--t-kit-paper"] = kitImage(kit.paper.image);
    // Tuile dessinée en 2× : affichée à la moitié de sa taille.
    v["--t-kit-paper-size"] = `${Math.round(kit.paper.image.w / 2)}px ${Math.round(kit.paper.image.h / 2)}px`;
    if (kit.paper.overHero !== undefined) v["--t-kit-paper-hero"] = String(kit.paper.overHero);
    if (kit.paper.onCardsOpacity !== undefined) v["--t-kit-paper-cards"] = String(kit.paper.onCardsOpacity);
  }
  if (kit.frame) {
    const [t, r, b, l] = kit.frame.slice;
    v["--t-kit-frame"] = kitImage(kit.frame.image);
    v["--t-kit-frame-slice"] = `${t} ${r} ${b} ${l}`;
    // Épaisseurs RÉELLES des quatre côtés (px, sans unité : l'épaisseur se réduit proportionnellement sur petit écran, variants.css).
    v["--t-kit-fwt"] = String(Math.round(t / 2));
    v["--t-kit-fwr"] = String(Math.round(r / 2));
    v["--t-kit-fwb"] = String(Math.round(b / 2));
    v["--t-kit-fwl"] = String(Math.round(l / 2));
  }
  if (kit.stroke) v["--t-kit-stroke"] = kitMask(kit.stroke);
  for (const [key, name] of ICONS) {
    const icon = kit.icons?.[key];
    if (icon) v[`--t-kit-icon-${name}`] = kitMask(icon);
  }
  if (kit.tape) {
    v["--t-kit-tape"] = kitImage(kit.tape);
    v["--t-kit-tape-ratio"] = `${kit.tape.w} / ${kit.tape.h}`;
  }
  const cursors = activeCursors(kit);
  if (cursors.default) {
    v["--t-cursor-default"] = cursorValue(cursors.default, "auto");
    v["--t-cursor-default-hd"] = cursorValueHd(cursors.default, "auto");
  }
  if (cursors.pointer) {
    v["--t-cursor-pointer"] = cursorValue(cursors.pointer, "pointer");
    v["--t-cursor-pointer-hd"] = cursorValueHd(cursors.pointer, "pointer");
  }
  return v;
}

/** Attributs des éléments dessinés présents (les règles CSS du kit s'y accrochent). */
export function kitAttributes(kit: KitAssets | undefined): Record<`data-${string}`, string> {
  const a: Record<`data-${string}`, string> = {};
  if (!kit) return a;
  if (kit.signature) a["data-kit-signature"] = kit.signature.colors ? "colors" : "";
  if (kit.paper) a["data-kit-paper"] = "";
  if (kit.paper?.overHero !== undefined) a["data-kit-paper-hero"] = "";
  if (kit.paper?.underHeader) a["data-kit-paper-header"] = "";
  if (kit.paper?.onCards) a["data-kit-paper-cards"] = "";
  if (kit.frame) a["data-kit-frame"] = "";
  if (kit.stroke) a["data-kit-stroke"] = "";
  for (const [key, name] of ICONS) if (kit.icons?.[key]) a[`data-kit-icon-${name}`] = "";
  if (kit.tape) a["data-kit-tape"] = "";
  const cursors = activeCursors(kit);
  if (cursors.default) a["data-kit-cursor"] = "";
  if (cursors.pointer) a["data-kit-cursor-pointer"] = "";
  return a;
}

/** Luminance relative WCAG d'une couleur #rgb / #rrggbb. */
export function relativeLuminance(hex: string): number {
  let h = hex.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Canaux 0–255 d'une couleur du schéma (#rgb, #rrggbb, #rrggbbaa, rgb(a)) ; null sinon. */
function rgbOf(color: string): [number, number, number] | null {
  const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(color);
  if (fn) return [Number(fn[1]), Number(fn[2]), Number(fn[3])];
  let h = color.replace("#", "");
  if (!/^[0-9a-fA-F]+$/.test(h)) return null;
  if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map((c) => c + c).join("");
  if (h.length !== 6 && h.length !== 8) return null;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/**
 * Gris neutre (R = G = B) de même luminance relative que `color` : le fond de
 * la visionneuse garde la profondeur du voile du thème sans sa teinte (une
 * œuvre se juge sur un gris, pas sur un brun ou un bleu).
 */
export function neutralGray(color: string): string {
  const rgb = rgbOf(color) ?? [0, 0, 0];
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const y = 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  const srgb = y <= 0.0031308 ? 12.92 * y : 1.055 * y ** (1 / 2.4) - 0.055;
  const g = Math.round(Math.min(1, Math.max(0, srgb)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${g}${g}${g}`;
}

/** Clair ou sombre, d'après la luminance du fond. */
export function themeScheme(theme: Theme): "light" | "dark" {
  return relativeLuminance(theme.tokens.color.bg) < 0.2 ? "dark" : "light";
}

// ── Mise en page (lot 2) ────────────────────────────────────────────────────
/** Valeurs d'un thème sans bloc `layout` : son rendu d'avant (espaces fixes). */
export const DEFAULT_LAYOUT = {
  spaceS: "0.75rem",
  spaceM: "clamp(1.5rem, 3vw, 2.25rem)",
  spaceL: "clamp(2.5rem, 5vw, 4rem)",
  spaceXL: "clamp(4rem, 8vw, 6.5rem)",
  pageTop: "clamp(6rem, 14vh, 10rem)",
  stripPad: "clamp(3rem, 7vw, 5.5rem)",
} as const;
/** Rayon CSS d'un cran d'arrondi des images et cartes. */
export const RADIUS_VALUES = { none: "0px", soft: "4px", medium: "10px", strong: "20px" } as const;

/** Variables de mise en page ; `--t-media-radius` seulement si le thème le fixe. */
export function layoutVariables(theme: Theme): Record<string, string> {
  const l = { ...DEFAULT_LAYOUT, ...theme.tokens.layout };
  return {
    "--t-space-s": l.spaceS,
    "--t-space-m": l.spaceM,
    "--t-space-l": l.spaceL,
    "--t-space-xl": l.spaceXL,
    "--t-page-top": l.pageTop,
    "--t-board-pad": l.stripPad,
    ...airVariables(theme.tokens.layout?.textAir),
    ...(theme.tokens.layout?.mediaRadius ? { "--t-media-radius": RADIUS_VALUES[theme.tokens.layout.mediaRadius] } : {}),
  };
}
// ── fin mise en page ────────────────────────────────────────────────────────

/** Couleurs du thème d'un jeu de couleurs (nuances « auto » dérivées : src/themes/palette.ts). */
export type ThemeColor = Theme["tokens"]["color"];
export function colorVariables(color: ThemeColor, palette: Theme["tokens"]["palette"]): Record<string, string> {
  const p = resolvePalette(color, palette);
  return {
    "--t-color-bg": p.bg,
    "--t-color-bg-deep": p.bgDeep,
    "--t-color-surface": p.surface,
    "--t-color-ink": p.ink,
    "--t-color-ink-soft": p.inkSoft,
    "--t-color-line": p.line,
    "--t-color-primary": p.primary,
    "--t-color-primary-hover": p.primaryHover,
    "--t-color-on-primary": p.onPrimary,
    "--t-color-secondary": p.secondary,
    "--t-color-tertiary": p.tertiary,
    // Auto : secondary.
    "--t-color-eyebrow": p.eyebrow,
    "--t-color-accent-glow": color.accentGlow ?? "transparent",
    // Voile (lightbox, vidéo) et son texte. Auto : en clair l'encre et le
    // fond, en sombre le fond et l'encre.
    "--t-color-scrim": p.scrim,
    "--t-color-on-scrim": p.onScrim,
    // Fond de la visionneuse (lot 3) : le voile (palette, lot 4), désaturé
    // (gris neutre, même luminance).
    "--t-color-viewer": neutralGray(p.scrim),
    // Ombres. Auto : teintées d'encre en clair, noires en sombre.
    "--t-color-shadow": p.shadow,
  };
}

/** Variables runtime du thème (préfixe --t-). */
export function themeVariables(theme: Theme): Record<string, string> {
  const { color, font, radius, space, motion } = theme.tokens;
  const display = FONT_CATALOG[font.display];

  return {
    ...colorVariables(color, theme.tokens.palette),
    "--t-hero-halo": color.heroHalo ?? "transparent",
    // Halo des images de planche : émis seulement si le thème en a un.
    "--t-strip-halo": color.accentGlow
      ? `0 0 34px color-mix(in srgb, ${color.accentGlow} 13%, transparent)`
      : "none",
    // Place verticale du rail quand les images ont un halo (sinon rognée).
    "--t-strip-pad": color.accentGlow ? "1.75rem" : "0px",

    "--t-font-display": display.stack,
    "--t-font-display-weight": String(display.headingWeight),
    "--t-font-body": FONT_CATALOG[font.body].stack,
    "--t-font-caption": FONT_CATALOG[font.caption].stack,

    "--t-radius-sm": radius.sm,
    "--t-radius-md": radius.md,
    "--t-radius-lg": radius.lg,
    "--t-radius-btn": radius.btn,
    "--t-radius-strip": radius.strip,

    "--t-space-section-gap": space.sectionGap,
    "--t-space-page-max": space.pageMax,
    "--t-space-gutter": space.gutter,

    "--t-motion-dur-fast": motion.durFast,
    "--t-motion-dur-base": motion.durBase,
    "--t-motion-easing": motion.easing,
    ...layoutVariables(theme),
    ...kitVariables(theme.assets.kit),
  };
}

/** Contenu de `<style id="theme">`. Les valeurs sont déjà filtrées par le schéma. */
export function themeToCss(theme: Theme): string {
  const decls = Object.entries(themeVariables(theme))
    .map(([k, v]) => `${k}:${v};`)
    .join("");
  return `:root{color-scheme:${themeScheme(theme)};${decls}}`.replace(/</g, "\\3c ");
}

/**
 * Palette du site (lot 17f, src/themes/site-palette.ts) : variables de couleur du
 * thème dont la valeur change quand les bases du site sont posées dessus. `all` :
 * toutes les variables (aperçu de la toile, qui doit pouvoir REVENIR à la couleur du
 * thème par-dessus la feuille que le serveur a déjà rendue). Ne lit que les couleurs
 * du thème : la toile n'en reçoit pas davantage.
 */
export function sitePaletteVariables(base: { color: ThemeColor; palette?: Theme["tokens"]["palette"] | null }, overrides: SitePalette | undefined, all = false): Record<string, string> {
  const palette = base.palette ?? undefined;
  const applied = applySitePalette(base.color as PaletteColors, palette, overrides);
  if (applied.color === base.color && !all) return {};
  const before = colorVariables(base.color, palette);
  const after = colorVariables(applied.color as ThemeColor, applied.palette);
  // Voile choisi par l'artiste (lot 29) : la visionneuse prend SA couleur, telle quelle. Calculé (auto), le fond de la
  // visionneuse reste un gris neutre de même luminance (on juge une œuvre sur un gris).
  const chosenScrim = overrides?.scrim;
  if (typeof chosenScrim === "string" && chosenScrim !== "auto") after["--t-color-viewer"] = chosenScrim;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(after)) if (all || before[k] !== v) out[k] = v;
  return out;
}

/**
 * Feuille de la palette du site : `:root:root` (passe devant le `:root` du thème). Vide sans
 * surcharge (rendu strictement celui du thème). `color-scheme` suit le fond effectif.
 */
export function sitePaletteCss(base: { color: ThemeColor; palette?: Theme["tokens"]["palette"] | null }, overrides: SitePalette | undefined, all = false): string {
  const vars = sitePaletteVariables(base, overrides, all);
  if (!Object.keys(vars).length) return "";
  const bg = applySitePalette(base.color as PaletteColors, base.palette ?? undefined, overrides).color.bg;
  const scheme = relativeLuminance(bg) < 0.2 ? "dark" : "light";
  const decls = Object.entries(vars).map(([k, v]) => `${k}:${v};`).join("");
  return `:root:root{color-scheme:${scheme};${decls}}`.replace(/</g, "\\3c ");
}

/** Attributs de variantes, posés sur <html>. */
export function themeAttributes(theme: Theme): Record<`data-${string}`, string> {
  const v = theme.variants;
  return {
    "data-theme": theme.id,
    "data-scheme": themeScheme(theme),
    "data-header": v.header,
    "data-hero": v.hero,
    "data-strip": v.strip,
    "data-caption": v.caption,
    "data-lightbox": v.lightbox,
    "data-button": v.button,
    "data-texture": v.texture,
    ...(theme.tokens.layout?.heroRoleBackdrop ? { "data-hero-role": theme.tokens.layout.heroRoleBackdrop } : {}),
    ...kitAttributes(theme.assets.kit),
  };
}
