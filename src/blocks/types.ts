import { z } from "zod";

import type { CSSProperties } from "react";

import type { AppLocale } from "@/i18n/routing";
import { textStyleObject, type Look } from "@/lib/look";
import type { CardPalette } from "@/themes/surface";
import type { WallpaperEntry } from "@/themes/wallpaper";

/** Texte court localisé (étiquette, titre, bouton). */
export const localized = z.object({ fr: z.string().max(200), en: z.string().max(200) });
/** Texte long localisé (présentation, paragraphe). */
export const localizedText = z.object({ fr: z.string().max(2000), en: z.string().max(2000) });
export type Localized = z.infer<typeof localized>;

export const pageRef = z.number().int().positive();
export const mediaRef = z.number().int().positive();
export const projectSlug = z.string().regex(/^[a-z0-9-]+$/).max(80);

/**
 * Composant d'un conteneur, tel que le conteneur le porte (props.children) :
 * ses réglages sont validés ensuite par le schéma de son propre type
 * (publication : src/lib/edit/pages.ts ; rendu : BlockList).
 */
export const childBlock = z.object({
  uid: z.string().regex(/^[a-z0-9-]{1,32}$/),
  type: z.string().max(60),
  props: z.record(z.string(), z.unknown()),
});
export const collection = z.enum(["characters", "backgrounds", "animation"]);

/**
 * `edit` : vue brouillon de l'éditeur visuel (marqueurs d'édition en place).
 * `project` : projet du conteneur parent (un composant sans projet propre le
 * reprend). `parent` : uid du conteneur (vue brouillon). `pageBlocks` : tous
 * les blocs de la page rendue (compteurs calculés depuis le contenu).
 */
export type BlockContext = {
  locale: AppLocale;
  pageId: number;
  edit?: boolean;
  /** Composant de planche (lot 31c) : seuls les repères de texte modifiable en place (`data-inline`), sans les autres commandes de la toile. */
  inlineEdit?: boolean;
  project?: string;
  parent?: string;
  pageBlocks?: { type: string; props: unknown }[];
  /** Rendu dans une cellule de grille : pas de marges de section. */
  cell?: boolean;
  /**
   * Grille d'une planche de projet sur la toile (lot 31d) : les repères d'édition des cases (numéros, places libres,
   * « + Image », média cadrable) sont posés comme sur une page, sans les autres commandes de la toile (`edit`).
   */
  gridCanvas?: boolean;
  /** Grille : uid et mise en forme (JSON) de chacune de ses cases, dans l'ordre (vue brouillon de page, ou `gridCanvas`). */
  cellInfo?: { uid: string; type: string; look?: string }[];
  /** Cellule de grille : nombre de colonnes (≥ 768 px) et format imposé aux images (« auto » = le leur). */
  cellColumns?: number;
  cellRatio?: string;
  /** Identifiant en base du bloc rendu (version publiée ; négatif en vue brouillon). */
  blockId?: number;
  /** Réglages de mise en page du bloc (props.look, lot 2) : styles de ses textes. */
  look?: Look;
  /** Palette effective du thème : choisit le texte lisible sur un fond de texte coloré (lot 21). Absente = non lue. */
  palette?: CardPalette;
  /** Papiers peints de la bibliothèque (lot 35), lus seulement si la page en montre un (ou en vue brouillon). */
  wallpapers?: ReadonlyMap<number, WallpaperEntry>;
};

/**
 * Marqueur d'un champ éditable en place (déclaré dans `inline` au registre) :
 * seulement en vue brouillon, jamais dans le HTML public.
 */
export function inline(ctx: BlockContext, path: string): { "data-inline"?: string; style?: CSSProperties } {
  return { ...(ctx.edit || ctx.inlineEdit ? { "data-inline": path } : {}), ...textStyle(ctx, path) };
}

/**
 * Style local d'un texte du bloc (barre typographique de la toile, lot 2) :
 * en ligne, il passe devant le style global du rôle et les classes du bloc.
 */
export function textStyle(ctx: BlockContext, path: string): { style?: CSSProperties } {
  const own = ctx.look?.text && Object.hasOwn(ctx.look.text, path) ? ctx.look.text[path] : undefined;
  const style = textStyleObject(own, ctx.palette);
  return style ? { style: style as CSSProperties } : {};
}

export function tr(value: Localized, locale: AppLocale): string {
  return value[locale] ?? value.fr;
}
