/**
 * Données de mise en page pour l'éditeur visuel (lot 2) : palette du thème
 * actif (pastilles de couleur du panneau, qui ne charge pas la feuille du
 * thème) et polices Google déjà téléchargées par le serveur.
 */
import { eq } from "drizzle-orm";

import { PRESETS, DEFAULT_THEME_ID } from "@/themes/presets";
import type { PaletteColors, PaletteState } from "@/themes/palette";
import { ThemeSchema, type Theme } from "@/themes/schema";

import { getDb, schema } from "../db";
import { readFontLibrary } from "../fonts/library";
import type { FontLibrary } from "../fonts/faces";
import { parseJson } from "../json";
import type { PaletteColor } from "../look";

/** Thème actif, tel que la toile le rend (repli : le thème par défaut). */
export function activeThemeForEdit(): Theme {
  const db = getDb();
  const active = parseJson(db.select().from(schema.settings).where(eq(schema.settings.key, "activeThemeId")).get()?.value);
  const row = typeof active === "string" ? db.select().from(schema.themes).where(eq(schema.themes.id, active)).get() : undefined;
  return ThemeSchema.safeParse(parseJson(row?.data)).data ?? PRESETS[DEFAULT_THEME_ID];
}

export type LookContext = {
  palette: Record<PaletteColor, string>;
  fonts: FontLibrary;
  /** Couleurs du thème actif SANS la palette du site (panneau « Couleurs » : `thème` / `modifiée`, contraste en direct). */
  theme: { name: string; color: PaletteColors; palette: PaletteState | null };
};

export function lookContextForEditor(): LookContext {
  const theme = activeThemeForEdit();
  const c = theme.tokens.color;
  return {
    theme: { name: theme.name, color: c as PaletteColors, palette: theme.tokens.palette ?? null },
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
