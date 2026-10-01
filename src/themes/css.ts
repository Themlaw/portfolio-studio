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
import type { Theme } from "./schema";

/** Luminance relative WCAG d'une couleur #rgb / #rrggbb. */
export function relativeLuminance(hex: string): number {
  let h = hex.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Clair ou sombre, d'après la luminance du fond. */
export function themeScheme(theme: Theme): "light" | "dark" {
  return relativeLuminance(theme.tokens.color.bg) < 0.2 ? "dark" : "light";
}

/** Variables runtime du thème (préfixe --t-). */
export function themeVariables(theme: Theme): Record<string, string> {
  const { color, font, radius, space, motion } = theme.tokens;
  const scheme = themeScheme(theme);
  const light = scheme === "light";
  const display = FONT_CATALOG[font.display];

  return {
    "--t-color-bg": color.bg,
    "--t-color-bg-deep": color.bgDeep,
    "--t-color-surface": color.surface,
    "--t-color-ink": color.ink,
    "--t-color-ink-soft": color.inkSoft,
    "--t-color-line": color.line,
    "--t-color-primary": color.primary,
    "--t-color-primary-hover": color.primaryHover,
    "--t-color-on-primary": color.onPrimary,
    "--t-color-secondary": color.secondary,
    "--t-color-tertiary": color.tertiary,
    "--t-color-eyebrow": color.eyebrow ?? color.secondary,
    "--t-color-accent-glow": color.accentGlow ?? "transparent",
    // Voile (lightbox, vidéo) : la teinte la plus sombre du thème, et son
    // texte. En clair : l'encre ; en sombre : le fond.
    "--t-color-scrim": light ? color.ink : color.bg,
    "--t-color-on-scrim": light ? color.bg : color.ink,
    // Ombres : teintées d'encre en clair, noires en sombre.
    "--t-color-shadow": light ? color.ink : "#000000",
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
  };
}

/** Contenu de `<style id="theme">`. Les valeurs sont déjà filtrées par le schéma. */
export function themeToCss(theme: Theme): string {
  const decls = Object.entries(themeVariables(theme))
    .map(([k, v]) => `${k}:${v};`)
    .join("");
  return `:root{color-scheme:${themeScheme(theme)};${decls}}`.replace(/</g, "\\3c ");
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
  };
}
