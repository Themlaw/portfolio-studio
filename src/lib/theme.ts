/**
 * Thème actif — seul point d'entrée pour le lire.
 *
 * Phase 1 : `PORTFOLIO_THEME` (défaut galerie-lumineuse). En production les
 * pages sont prérendues : la variable est donc lue AU BUILD.
 *
 * Aperçu : hors production, ou avec THEME_PREVIEW=1, le cookie `theme-preview`
 * (posé par GET /api/theme-preview?id=…) surcharge le thème. En production sans
 * THEME_PREVIEW, `cookies()` n'est jamais appelé : les pages restent statiques.
 */
import { cookies } from "next/headers";
import { cache } from "react";

import { DEFAULT_THEME_ID, PRESET_IDS, PRESETS } from "@/themes/presets";
import type { Theme } from "@/themes/schema";

export const PREVIEW_COOKIE = "theme-preview";

export function isThemePreviewEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.THEME_PREVIEW === "1";
}

export function getTheme(id: string): Theme | undefined {
  return Object.hasOwn(PRESETS, id) ? PRESETS[id] : undefined;
}

function configuredTheme(): Theme {
  const id = process.env.PORTFOLIO_THEME || DEFAULT_THEME_ID;
  const theme = getTheme(id);
  if (!theme) {
    throw new Error(
      `PORTFOLIO_THEME="${id}" ne correspond à aucun thème (disponibles : ${PRESET_IDS.join(", ")}).`,
    );
  }
  return theme;
}

export const getActiveTheme = cache(async (): Promise<Theme> => {
  if (isThemePreviewEnabled()) {
    const id = (await cookies()).get(PREVIEW_COOKIE)?.value;
    const preview = id ? getTheme(id) : undefined;
    if (preview) return preview;
  }
  return configuredTheme();
});
