/**
 * Données de mise en page pour l'éditeur visuel (lot 2) : palette du thème
 * actif (pastilles de couleur du panneau, qui ne charge pas la feuille du
 * thème) et polices Google déjà téléchargées par le serveur.
 */
import { getMineState } from "@/lib/themes/versions";
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
  // Lot 60 : la version PUBLIÉE de Mon thème (`live_data`) quand son brouillon en est différent.
  return ThemeSchema.safeParse(parseJson(row?.liveData ?? row?.data)).data ?? PRESETS[DEFAULT_THEME_ID];
}

/** Thème en préparation (lot 55) : aperçu admin d'un thème pas encore en ligne ; le panneau Couleurs montre CE thème. */
export type PreparingInfo = {
  id: string;
  name: string;
  liveName: string;
  /** Lot 60 : un modèle (« Utiliser ce modèle »), un ancien thème (« En faire mon thème »), ou Mon thème en brouillon (« Publier cette version »). */
  kind: "model" | "old" | "mine";
  /** Version en cours de Mon thème (null : il n'existe pas encore) : la fenêtre « Remplacer mon thème (version N)… ». */
  mineVersion: number | null;
  /** Ce qui est en ligne, pour la fenêtre « avant → après » (« Mon thème : v3 » ou le nom du thème). */
  liveLabel: string;
};

export type LookContext = {
  /** Thème prévisualisé, pas encore en ligne (bandeau de l'éditeur) ; null : l'éditeur montre le thème en ligne. */
  preparing: PreparingInfo | null;
  palette: Record<PaletteColor, string>;
  fonts: FontLibrary;
  /** Couleurs du thème actif SANS la palette du site (panneau « Couleurs » : `thème` / `modifiée`, contraste en direct). */
  theme: { name: string; color: PaletteColors; palette: PaletteState | null };
  /** Le thème actif dessine sa propre signature (kit) : « Revenir au logo du thème » plutôt que « au logo texte » (lot 26). */
  signature: boolean;
};

function preparingInfo(preparing: Theme, live: Theme): PreparingInfo {
  const mine = getMineState();
  const kind = mine?.id === preparing.id ? "mine" : preparing.preset ? "model" : "old";
  const liveLabel = mine?.live && mine.publishedVersion != null ? `${mine.name} : v${mine.publishedVersion}` : live.name;
  return { id: preparing.id, name: preparing.name, liveName: live.name, kind, mineVersion: mine?.version ?? null, liveLabel };
}

export function lookContextForEditor(preparing?: Theme | null): LookContext {
  const live = activeThemeForEdit();
  const theme = preparing ?? live;
  const c = theme.tokens.color;
  return {
    preparing: preparing ? preparingInfo(preparing, live) : null,
    theme: { name: theme.name, color: c as PaletteColors, palette: theme.tokens.palette ?? null },
    signature: Boolean(theme.assets.kit?.signature),
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
