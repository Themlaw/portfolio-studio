import { z } from "zod";

import type { AppLocale } from "@/i18n/routing";

export const localized = z.object({ fr: z.string(), en: z.string() });
export type Localized = z.infer<typeof localized>;

export const pageRef = z.number().int().positive();
export const collection = z.enum(["characters", "backgrounds", "animation"]);

export type BlockContext = { locale: AppLocale; pageId: number };

export function tr(value: Localized, locale: AppLocale): string {
  return value[locale] ?? value.fr;
}
