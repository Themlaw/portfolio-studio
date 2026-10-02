import { z } from "zod";

import type { AppLocale } from "@/i18n/routing";

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
  project?: string;
  parent?: string;
  pageBlocks?: { type: string; props: unknown }[];
  /** Rendu dans une cellule de grille : pas de marges de section. */
  cell?: boolean;
  /** Identifiant en base du bloc rendu (version publiée ; négatif en vue brouillon). */
  blockId?: number;
};

/**
 * Marqueur d'un champ éditable en place (déclaré dans `inline` au registre) :
 * seulement en vue brouillon, jamais dans le HTML public.
 */
export function inline(ctx: BlockContext, path: string): { "data-inline"?: string } {
  return ctx.edit ? { "data-inline": path } : {};
}

export function tr(value: Localized, locale: AppLocale): string {
  return value[locale] ?? value.fr;
}
