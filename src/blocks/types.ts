import { z } from "zod";

import type { AppLocale } from "@/i18n/routing";

/** Texte court localisé (étiquette, titre, bouton). */
export const localized = z.object({ fr: z.string().max(200), en: z.string().max(200) });
/** Texte long localisé (présentation, paragraphe). */
export const localizedText = z.object({ fr: z.string().max(2000), en: z.string().max(2000) });
export type Localized = z.infer<typeof localized>;

export const pageRef = z.number().int().positive();
export const collection = z.enum(["characters", "backgrounds", "animation"]);

export type BlockContext = { locale: AppLocale; pageId: number };

export function tr(value: Localized, locale: AppLocale): string {
  return value[locale] ?? value.fr;
}
