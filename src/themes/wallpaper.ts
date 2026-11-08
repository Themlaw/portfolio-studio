/**
 * Papiers peints (lot 35) : motifs répétés importés dans la bibliothèque (Admin → Thèmes → Papiers peints). Module pur (zod + schema.ts,
 * aucun accès à la base) : lu par le rendu serveur (BlockList, layout), la toile de l'éditeur (aperçu immédiat) et les tests
 * (scripts/test-papiers.mjs).
 *
 * Trois endroits les utilisent, tous par l'IDENTIFIANT du motif (jamais une URL : un motif supprimé disparaît du rendu sans rien casser) :
 *  - le fond d'un grand composant : `props.background = { kind: "wallpaper", wallpaper, color?, size?, opacity? }` (fond.ts) ;
 *  - le papier d'une page : `PagePaper` (`none` | un motif), remplace le papier du kit pour cette page seulement ;
 *  - le papier d'une carte : `surface.paperWallpaper` (+ `paperSize`, `paperOpacity`) et le réglage du site `CardWallpaper`.
 *
 * Rendu : le motif est une image de fond RÉPÉTÉE, donc taille d'une tuile = `--wp-size` (px), réduite à 60 % sous 768 px
 * (`--wp-size-m`). La variante WebP choisie est la plus petite qui couvre la tuile en double densité (écrans nets, pas de fichier géant).
 */
import type { z } from "zod";

import { CardWallpaperSchema, PagePaperSchema, WALLPAPER_SIZE_MAX, WALLPAPER_SIZE_MIN } from "./schema";

export { CardWallpaperSchema, PagePaperSchema, WALLPAPER_SIZE_MAX, WALLPAPER_SIZE_MIN };
export type PagePaper = z.infer<typeof PagePaperSchema>;
export type CardWallpaper = z.infer<typeof CardWallpaperSchema>;

/** Un motif de la bibliothèque, tel que le rendu le lit (variantes WebP d'un média prêt). */
/**
 * Entrée de RENDU d'un motif (site public, flux RSC compris) : jamais son nom, qui vient par défaut du nom du fichier envoyé
 * (« client-x-confidentiel.png » → « client x confidentiel ») et ne doit pas atteindre le site public (docs/SECURITE.md N9).
 */
export type WallpaperEntry = {
  id: number;
  /** Dimensions du fichier d'origine (rapport hauteur / largeur d'une tuile). */
  w: number;
  h: number;
  /** Réglages du motif : largeur d'une tuile (px) et opacité par défaut. */
  size: number;
  opacity: number;
  /** Variantes WebP du média, de la plus étroite à la plus large. */
  files: { w: number; url: string }[];
};
export type WallpaperLookup = (id: number) => WallpaperEntry | undefined;
/** Motif tel que la toile de l'éditeur le propose (vue brouillon seulement) : avec son nom, pour la grille de choix. */
export type WallpaperCatalogEntry = WallpaperEntry & { name: string };

/** Sous 768 px (téléphone), la tuile est réduite à 60 % (jamais sous le minimum). */
export const WALLPAPER_PHONE_RATIO = 0.6;
export const WALLPAPER_SIZE_DEFAULT = 300;

/** Taille de départ d'un motif importé : la moitié de sa largeur (dessiné en double densité), entre 80 et 600 px. */
export function defaultWallpaperSize(width: number | null | undefined): number {
  const half = Math.round((width ?? WALLPAPER_SIZE_DEFAULT * 2) / 2);
  return Math.min(600, Math.max(80, half));
}

const clampSize = (n: number) => Math.min(WALLPAPER_SIZE_MAX, Math.max(WALLPAPER_SIZE_MIN, Math.round(n)));

/** URL de la plus petite variante qui couvre `size` px en double densité, sinon la plus large. */
export function pickFile(entry: WallpaperEntry, size: number): string | undefined {
  const files = [...entry.files].sort((a, b) => a.w - b.w);
  return (files.find((f) => f.w >= size * 2) ?? files.at(-1))?.url;
}

export type WallpaperOwn = { size?: number; opacity?: number };

/** Taille et opacité effectives : les réglages posés à l'endroit d'usage, sinon ceux du motif. */
export function effectivePaint(entry: WallpaperEntry, own: WallpaperOwn = {}): { size: number; opacity: number } {
  return { size: clampSize(own.size ?? entry.size), opacity: own.opacity ?? entry.opacity };
}

/**
 * Variables CSS d'un motif (préfixe `--wp` pour un fond / une page, `--card-wp` pour une carte). Vide si le motif n'existe plus
 * (supprimé, à la corbeille, pas encore prêt) : l'endroit d'usage perd simplement son motif.
 */
export function wallpaperVars(entry: WallpaperEntry | undefined, own: WallpaperOwn = {}, prefix: "--wp" | "--card-wp" = "--wp"): Record<string, string> {
  if (!entry) return {};
  const { size, opacity } = effectivePaint(entry, own);
  const url = pickFile(entry, size);
  if (!url) return {};
  const phone = Math.max(WALLPAPER_SIZE_MIN, Math.round(size * WALLPAPER_PHONE_RATIO));
  return {
    [`${prefix}-img`]: `url("${url}")`,
    [`${prefix}-size`]: `${size}px`,
    [`${prefix}-size-m`]: `${phone}px`,
    [`${prefix}-ratio`]: String(entry.h / Math.max(1, entry.w)),
    [`${prefix}-opacity`]: String(Math.round(opacity * 100) / 100),
  };
}

/** Lecture tolérante du papier d'une page (valeur illisible = comme le site). */
export function readPagePaper(raw: unknown): PagePaper | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const parsed = PagePaperSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** Lecture tolérante du papier peint par défaut des cartes (réglage du site). */
export function readCardWallpaper(raw: unknown): CardWallpaper | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const parsed = CardWallpaperSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** Même réglage visuel ? (deux composants voisins qui montrent le même motif de la même façon se fondent en un seul). */
export const samePaint = (a: WallpaperOwn, b: WallpaperOwn) => a.size === b.size && a.opacity === b.opacity;

/* ---- Où un motif est utilisé ------------------------------------------------------------------------------ */

type AnyNode = { type?: unknown; props?: unknown };

/** Identifiants de motifs cités par UN composant : fond, papier de sa carte. Ses composants (`children`) comptent aussi (deux niveaux au plus). */
export function wallpaperIdsOf(node: AnyNode, depth = 0): number[] {
  const props = node.props && typeof node.props === "object" && !Array.isArray(node.props) ? (node.props as Record<string, unknown>) : null;
  if (!props) return [];
  const out: number[] = [];
  const bg = props.background as { kind?: unknown; wallpaper?: unknown } | undefined;
  if (bg && bg.kind === "wallpaper" && Number.isInteger(bg.wallpaper)) out.push(bg.wallpaper as number);
  const surface = props.surface as { paperWallpaper?: unknown } | undefined;
  if (surface && Number.isInteger(surface.paperWallpaper)) out.push(surface.paperWallpaper as number);
  if (depth < 2 && Array.isArray(props.children)) {
    for (const child of props.children) if (child && typeof child === "object") out.push(...wallpaperIdsOf(child as AnyNode, depth + 1));
  }
  return out;
}

/* ---- Raccord du motif entre composants fusionnés ----------------------------------------------------------- */

export type ChainItem = { joinPrev: boolean; joinNext: boolean; height: number; tile: number };

/**
 * Décalage vertical de départ du motif de chaque composant d'une suite (en px, ≤ 0) pour que la trame se poursuive d'un composant
 * fusionné au suivant : la somme des hauteurs de ce qui le précède DANS la même chaîne, modulo la hauteur d'une tuile. Un composant qui
 * n'est pas fusionné avec le précédent repart de zéro. Pur (testé par scripts/test-papiers.mjs) ; le navigateur fournit hauteurs et tuile
 * (src/components/WallpaperAlign.tsx).
 */
export function chainOffsets(items: readonly ChainItem[]): number[] {
  let acc = 0;
  return items.map((it, i) => {
    const continues = i > 0 && it.joinPrev && items[i - 1].joinNext;
    if (!continues) acc = 0;
    const offset = it.tile > 0 && acc > 0 ? -(acc % it.tile) : 0;
    acc += it.height;
    return offset === 0 ? 0 : Math.round(offset * 100) / 100;
  });
}
