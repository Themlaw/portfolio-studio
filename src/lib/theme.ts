/**
 * Thème actif — seul point d'entrée pour le lire.
 *
 * Source : settings.activeThemeId + table themes (en cache, étiquette
 * « theme » ; src/lib/revalidate.ts → revalidateTheme()). PORTFOLIO_THEME ne
 * sert qu'au seed initial. Pendant `next build` (aucune base), repli sur le
 * preset par défaut.
 *
 * Aperçu : GET /api/theme-preview?id=… active le draft mode de Next et pose
 * le cookie `theme-preview`. Le cookie n'est lu QUE si le draft mode est
 * actif : ces requêtes contournent le cache ISR (rendu dynamique), un visiteur
 * anonyme reçoit toujours la page en cache, jamais un aperçu. Route réservée
 * au développement tant que l'auth n'existe pas (phase 3 : admins connectés).
 */
import { eq } from "drizzle-orm";
import { cookies, draftMode } from "next/headers";
import { cache } from "react";

import { DEFAULT_THEME_ID, PRESETS } from "@/themes/presets";
import { ThemeSchema, type Theme } from "@/themes/schema";

import { cached, isBuildPhase, TAGS } from "./cache";
import { getDb, schema } from "./db";
import { parseJson } from "./json";

export const PREVIEW_COOKIE = "theme-preview";

/** Aperçu de thème disponible ? (phase 3 : réservé aux admins connectés) */
export function isThemePreviewEnabled(): boolean {
  return process.env.NODE_ENV !== "production";
}

type ThemeState = { activeId: string; themes: Record<string, Theme> };

async function getThemeState(): Promise<ThemeState> {
  return cached(["theme-state"], [TAGS.theme], () => {
    const db = getDb();
    const themes: Record<string, Theme> = {};
    for (const row of db.select().from(schema.themes).all()) {
      const parsed = ThemeSchema.safeParse(parseJson(row.data));
      if (parsed.success) themes[row.id] = parsed.data;
      else console.error(`[theme] thème « ${row.id} » invalide en base, ignoré`);
    }
    const active = db.select().from(schema.settings).where(eq(schema.settings.key, "activeThemeId")).get();
    const activeId = parseJson(active?.value);
    return { activeId: typeof activeId === "string" ? activeId : DEFAULT_THEME_ID, themes };
  });
}

/** Thèmes disponibles (base), ou presets pendant le build. */
export async function listThemes(): Promise<Record<string, Theme>> {
  if (isBuildPhase()) return { ...PRESETS };
  return (await getThemeState()).themes;
}

export async function getTheme(id: string): Promise<Theme | undefined> {
  const themes = await listThemes();
  return Object.hasOwn(themes, id) ? themes[id] : undefined;
}

export const getActiveTheme = cache(async (): Promise<Theme> => {
  if (isBuildPhase()) return PRESETS[DEFAULT_THEME_ID];

  const state = await getThemeState();
  // draftMode().isEnabled ne rend pas la page dynamique ; cookies() n'est lu
  // que dans une requête en draft mode, déjà hors cache ISR.
  if ((await draftMode()).isEnabled) {
    const id = (await cookies()).get(PREVIEW_COOKIE)?.value;
    if (id && Object.hasOwn(state.themes, id)) return state.themes[id];
  }
  const active = state.themes[state.activeId];
  if (!active) {
    console.error(`[theme] thème actif « ${state.activeId} » introuvable, repli sur ${DEFAULT_THEME_ID}`);
    return state.themes[DEFAULT_THEME_ID] ?? PRESETS[DEFAULT_THEME_ID];
  }
  return active;
});
