import { z } from "zod";

import type { AppLocale } from "@/i18n/routing";

/** Texte court localisé (étiquette, titre, bouton). */
export const localized = z.object({ fr: z.string().max(200), en: z.string().max(200) });
/** Texte long localisé (présentation, paragraphe). */
export const localizedText = z.object({ fr: z.string().max(2000), en: z.string().max(2000) });
export type Localized = z.infer<typeof localized>;

export const pageRef = z.number().int().positive();
export const collection = z.enum(["characters", "backgrounds", "animation"]);

/** `edit` : vue brouillon de l'éditeur visuel (marqueurs d'édition en place). */
export type BlockContext = { locale: AppLocale; pageId: number; edit?: boolean };

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
