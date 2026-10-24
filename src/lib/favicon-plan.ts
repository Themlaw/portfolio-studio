/**
 * Icône de l'onglet (lot 83), le PLAN : d'où vient l'icône, quelles couleurs, quelle empreinte. Aucun décodage d'image ici
 * (pas de sharp, pas de base) : la page publique le calcule à chaque rendu pour poser les balises, le rendu des fichiers est dans
 * favicon.ts.
 *
 * Ordre « Automatique » : calque « Icône » du kit Photoshop s'il est dessiné (`assets.kit.icon`), sinon le logo du thème en ligne
 * (posé sur un fond ; un logo trop large pour 16 px laisse la place au monogramme), sinon un MONOGRAMME : les initiales du nom du
 * site, dans la police des titres et les couleurs du thème en ligne. L'empreinte (`fp`) change avec le thème, ses images, le nom du
 * site et le réglage : les adresses des fichiers la portent, le cache est immuable.
 */
import { createHash } from "node:crypto";

import type { Metadata } from "next";

import { KIT_FONTS } from "@/lib/kit/fonts";
import { luminance, ratio } from "@/themes/contrast";
import { parseColor, resolvePalette, toHex, type PaletteKey } from "@/themes/palette";
import type { FontId, KitImage, Theme } from "@/themes/schema";

import { monoLetters, MONO_COLOR_KEYS, type FaviconConfig, type MonoColorKey, type MonoShape } from "./favicon-spec";
import type { SeoStored } from "./seo-schema";

/** Version du rendu : à augmenter quand le dessin des icônes change (invalide les fichiers gardés). */
export const RENDER_VERSION = 1;
/** Fond d'onglet de référence en thème sombre / clair (Chrome, Firefox) : sert à juger la lisibilité d'une icône sans fond. */
export const DARK_TAB = "#202124";
export const LIGHT_TAB = "#ffffff";
/** Un logo plus large que ça (largeur / hauteur) ne se lit plus à 16 px : monogramme à la place. */
export const MAX_LOGO_ASPECT = 2.2;

export type IconSource = "image" | "kit" | "logo" | "mono";
type Pair = { bg: string; ink: string };

export type IconPlan = {
  /** Empreinte (12 caractères hexadécimaux) : thème, version du rendu, nom du site, réglage. */
  fp: string;
  source: IconSource;
  /** Pourquoi le logo a laissé la place au monogramme (aperçu). */
  fallback: "logo-large" | null;
  shape: MonoShape;
  letters: string;
  fontId: FontId;
  light: Pair;
  /** Couleurs de la variante sombre (SVG du monogramme) ; identiques si elles se lisent déjà. */
  dark: Pair;
  /** Source « image » : dossier de l'icône déclinée à l'enregistrement. */
  dir: string | null;
  /** Sources « kit » et « logo ». */
  kit: KitImage | null;
  /** Logo teinté par le thème (« Prendre la couleur du texte ») ou monogramme : une seule couleur. */
  tinted: boolean;
  themeColor: string;
  backgroundColor: string;
};

const hexOf = (c: string | undefined, fallback: string): string => {
  const p = c ? parseColor(c) : null;
  return p ? toHex(p.rgb) : fallback;
};

/** Variante sombre d'une paire de couleurs : seulement si la paire disparaît sur un onglet sombre. */
export function darkPair(light: Pair, shape: MonoShape, candidates: string[]): Pair {
  const lightest = [...candidates].sort((a, b) => luminance(b) - luminance(a))[0] ?? "#ffffff";
  const darkest = [...candidates].sort((a, b) => luminance(a) - luminance(b))[0] ?? "#000000";
  if (shape === "none") return ratio(light.ink, DARK_TAB) >= 3 ? light : { bg: light.bg, ink: lightest };
  if (ratio(light.bg, DARK_TAB) >= 1.6) return light;
  return { bg: lightest, ink: ratio(light.ink, lightest) >= 3 ? light.ink : darkest };
}

/** Couleurs du thème proposées au monogramme (hex), par nom : l'écran montre ce que le thème en ligne donne. */
export function monoColors(theme: Theme): Record<MonoColorKey, string> {
  const p = resolvePalette(theme.tokens.color, theme.tokens.palette);
  return Object.fromEntries(MONO_COLOR_KEYS.map((k) => [k, hexOf(p[k], "#000000")])) as Record<MonoColorKey, string>;
}

const fingerprint = (o: unknown) => createHash("sha1").update(JSON.stringify(o)).digest("hex").slice(0, 12);

export function planIcon(seo: SeoStored, theme: Theme, siteName: string): IconPlan {
  const cfg: FaviconConfig = seo.faviconMode;
  const p = resolvePalette(theme.tokens.color, theme.tokens.palette);
  const color = (k: PaletteKey) => hexOf(p[k], "#000000");
  const palette = (["bg", "surface", "ink", "primary", "secondary", "tertiary", "onPrimary"] as const).map(color);
  const kit = theme.assets.kit;
  const fontId = (Object.hasOwn(KIT_FONTS, theme.tokens.font.display) ? theme.tokens.font.display : "figtree") as FontId;
  const letters = monoLetters(cfg.mono, siteName);
  let shape: MonoShape = cfg.mono.shape;
  let light: Pair = { bg: color(cfg.mono.bg), ink: color(cfg.mono.ink) };
  // Sans fond, les lettres se posent sur l'onglet : la couleur choisie doit se lire sur le fond du site, sinon la couleur du fond
  // choisie (action par défaut), sinon le texte du thème. (Lettres blanches « sur l'action » : invisibles sans le rond.)
  if (shape === "none") {
    const ground = color("bg");
    const ink = [light.ink, light.bg, color("ink")].find((c) => ratio(c, ground) >= 3) ?? color("ink");
    light = { bg: light.bg, ink };
  }

  let source: IconSource = "mono";
  let fallback: IconPlan["fallback"] = null;
  let image: KitImage | null = null;
  let tinted = true;
  if (cfg.mode === "image" && seo.favicon) source = "image";
  else {
    if (kit?.icon) {
      source = "kit";
      image = kit.icon;
    } else if (cfg.mode !== "kit" && kit?.signature) {
      if (kit.signature.w / kit.signature.h > MAX_LOGO_ASPECT) fallback = "logo-large";
      else {
        source = "logo";
        image = kit.signature;
        tinted = kit.signature.colors !== true;
        // Un logo en couleurs se pose sur le fond du site (la couleur d'action du monogramme pourrait le noyer).
        if (!tinted) light = { bg: color("bg"), ink: light.ink };
      }
    }
  }
  const dark = source === "mono" || source === "logo" ? darkPair(light, shape, palette) : light;
  if (source === "image" || source === "kit") shape = "none";
  const dir = source === "image" ? seo.favicon!.dir : null;
  const fp = fingerprint({ v: RENDER_VERSION, source, dir, image, tinted, shape, letters, fontId, light, dark, name: source === "mono" ? siteName : "" });
  return { fp, source, fallback, shape, letters, fontId, light, dark, dir, kit: image, tinted, themeColor: color("surface"), backgroundColor: color("bg") };
}

/** Adresse d'un fichier de l'icône, avec l'empreinte (cache immuable). */
export const iconUrl = (file: string, fp: string) => `/site-icon/${file}?v=${fp}`;

/** Icônes déclarées dans <head> : l'adresse porte l'empreinte, un nouveau thème ou réglage passe le cache. */
export function iconLinks(plan: IconPlan): NonNullable<Metadata["icons"]> {
  const png = (size: number) => ({ url: iconUrl(`${size}.png`, plan.fp), sizes: `${size}x${size}`, type: "image/png" });
  return {
    icon: [
      { url: `/favicon.ico?v=${plan.fp}`, sizes: "16x16 32x32 48x48", type: "image/x-icon" },
      ...(plan.source === "mono" ? [{ url: iconUrl("icon.svg", plan.fp), sizes: "any", type: "image/svg+xml" }] : []),
      png(32),
      png(48),
      png(192),
      png(512),
    ],
    apple: [png(180)],
  };
}

export const manifestUrl = (plan: IconPlan) => `/manifest.webmanifest?v=${plan.fp}`;

/** `manifest.webmanifest` : nom du site, couleurs du thème, icônes (dont la « maskable » d'Android). */
export function manifestOf(plan: IconPlan, siteName: string, lang: string) {
  const short = siteName.length > 12 ? plan.letters : siteName;
  return {
    name: siteName,
    short_name: short || siteName,
    lang,
    start_url: "/",
    display: "browser",
    theme_color: plan.themeColor,
    background_color: plan.backgroundColor,
    icons: [
      { src: iconUrl("192.png", plan.fp), sizes: "192x192", type: "image/png", purpose: "any" },
      { src: iconUrl("512.png", plan.fp), sizes: "512x512", type: "image/png", purpose: "any" },
      { src: iconUrl("maskable-512.png", plan.fp), sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
