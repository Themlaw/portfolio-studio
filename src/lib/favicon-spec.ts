/**
 * Icône de l'onglet (lot 83), partie pure : réglage `faviconMode` (mode, monogramme, recadrage), initiales du nom du site.
 * Module pur (zod seulement) : réglages, éditeur, serveur et tests.
 *
 * Trois façons d'avoir une icône :
 *  - `auto` : le calque « Icône » du kit Photoshop s'il est dessiné, sinon le logo du thème en ligne, sinon un monogramme
 *    (les initiales du nom du site, dans la police des titres et les couleurs du thème en ligne) ;
 *  - `image` : une image de la médiathèque, recadrée en carré (`crop`) ;
 *  - `kit` : seulement le calque « Icône » du kit (sinon : comme `auto`).
 * Les couleurs du monogramme sont des NOMS de couleurs du thème (jamais un hex figé) : l'icône suit le thème en ligne.
 */
import { z } from "zod";

import { RectSchema } from "./images/crop";

export const FAVICON_MODES = ["auto", "image", "kit"] as const;
export type FaviconModeId = (typeof FAVICON_MODES)[number];
export const MONO_SHAPES = ["round", "squircle", "none"] as const;
export type MonoShape = (typeof MONO_SHAPES)[number];
/** Couleurs du thème proposées pour le fond et les lettres du monogramme. */
export const MONO_COLOR_KEYS = ["bg", "surface", "ink", "primary", "secondary", "tertiary", "onPrimary"] as const;
export type MonoColorKey = (typeof MONO_COLOR_KEYS)[number];

/** 2 ou 3 lettres (chiffres admis) ; null : les initiales du nom du site. */
export const LETTERS_RE = /^[\p{L}\p{N}]{2,3}$/u;

const MonoSchema = z.strictObject({
  letters: z.string().trim().regex(LETTERS_RE, "Écris 2 ou 3 lettres.").nullable(),
  shape: z.enum(MONO_SHAPES),
  bg: z.enum(MONO_COLOR_KEYS),
  ink: z.enum(MONO_COLOR_KEYS),
});
export type FaviconMono = z.infer<typeof MonoSchema>;

/** Réglage gardé dans `seo.faviconMode`. */
export const FaviconModeSchema = z.strictObject({ mode: z.enum(FAVICON_MODES), mono: MonoSchema, crop: RectSchema.nullable() });
export type FaviconConfig = z.infer<typeof FaviconModeSchema>;

export const DEFAULT_MONO: FaviconMono = { letters: null, shape: "round", bg: "primary", ink: "onPrimary" };
export const defaultFaviconConfig = (mode: FaviconModeId = "auto"): FaviconConfig => ({ mode, mono: { ...DEFAULT_MONO }, crop: null });

/** Ce que l'écran envoie : le réglage et l'image choisie (mode « image »). */
export const FaviconInputSchema = z.strictObject({ mode: z.enum(FAVICON_MODES), mediaId: z.number().int().positive().nullable(), mono: MonoSchema, crop: RectSchema.nullable() });
export type FaviconInput = z.infer<typeof FaviconInputSchema>;

/** Lecture tolérante : un champ absent ou corrompu retombe sur son défaut. `hasImage` : une image est déjà choisie (réglage d'avant le lot 83). */
export function readFaviconConfig(raw: unknown, hasImage: boolean): FaviconConfig {
  const base = defaultFaviconConfig(hasImage ? "image" : "auto");
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  const mode = (FAVICON_MODES as readonly string[]).includes(o.mode as string) ? (o.mode as FaviconModeId) : base.mode;
  const m = (o.mono ?? {}) as Record<string, unknown>;
  const letters = typeof m.letters === "string" && LETTERS_RE.test(m.letters) ? m.letters : null;
  const shape = (MONO_SHAPES as readonly string[]).includes(m.shape as string) ? (m.shape as MonoShape) : DEFAULT_MONO.shape;
  const color = (v: unknown, d: MonoColorKey) => ((MONO_COLOR_KEYS as readonly string[]).includes(v as string) ? (v as MonoColorKey) : d);
  const crop = RectSchema.safeParse(o.crop);
  return { mode, mono: { letters, shape, bg: color(m.bg, DEFAULT_MONO.bg), ink: color(m.ink, DEFAULT_MONO.ink) }, crop: crop.success ? crop.data : null };
}

/**
 * Initiales du nom du site : première lettre du premier et du dernier mot (« Camille Roussel » → « CR »), deux premières lettres
 * d'un nom d'un seul mot (« Camille » → « CA »). Majuscules ; « ? » si le nom n'a aucune lettre.
 */
export function initialsOf(siteName: string): string {
  const words = siteName.split(/[\s\-–—'’.,/]+/u).map((w) => [...w.replace(/[^\p{L}\p{N}]/gu, "")]).filter((w) => w.length > 0);
  if (words.length === 0) return "?";
  const out = words.length === 1 ? words[0].slice(0, 2).join("") : words[0][0] + words[words.length - 1][0];
  return out.toLocaleUpperCase("fr");
}

/** Lettres du monogramme : celles du réglage, sinon les initiales. */
export const monoLetters = (mono: FaviconMono, siteName: string) => (mono.letters ? mono.letters.toLocaleUpperCase("fr") : initialsOf(siteName));
