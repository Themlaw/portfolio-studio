/**
 * Données de mise en page pour l'éditeur visuel (lot 2) : palette du thème
 * actif (pastilles de couleur du panneau, qui ne charge pas la feuille du
 * thème) et polices Google déjà téléchargées par le serveur.
 */
import { eq } from "drizzle-orm";

import { PRESETS, DEFAULT_THEME_ID } from "@/themes/presets";
import { ThemeSchema } from "@/themes/schema";

import { getDb, schema } from "../db";
import { readFontLibrary } from "../fonts/library";
import type { FontLibrary } from "../fonts/faces";
import { parseJson } from "../json";
import type { PaletteColor } from "../look";

export type LookContext = { palette: Record<PaletteColor, string>; fonts: FontLibrary };

export function lookContextForEditor(): LookContext {
  const db = getDb();
  const active = parseJson(db.select().from(schema.settings).where(eq(schema.settings.key, "activeThemeId")).get()?.value);
  const row = typeof active === "string" ? db.select().from(schema.themes).where(eq(schema.themes.id, active)).get() : undefined;
  const c = (ThemeSchema.safeParse(parseJson(row?.data)).data ?? PRESETS[DEFAULT_THEME_ID]).tokens.color;
  return {
    palette: {
      ink: c.ink,
      "ink-soft": c.inkSoft,
      primary: c.primary,
      secondary: c.secondary,
      tertiary: c.tertiary,
      eyebrow: c.eyebrow ?? c.secondary,
      bg: c.bg,
      surface: c.surface,
    },
    fonts: readFontLibrary(),
  };
}
