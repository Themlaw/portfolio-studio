/**
 * Thème actif — seul point d'entrée pour le lire.
 *
 * Source : settings.activeThemeId + table themes (en cache, étiquette
 * « theme » ; src/lib/revalidate.ts → revalidateTheme()). PORTFOLIO_THEME ne
 * sert qu'au seed initial. Pendant `next build` (aucune base), repli sur le
 * preset par défaut.
 *
 * Aperçu : activé depuis l'admin (server action, protégée contre le CSRF) ou,
 * en développement seulement, par GET /api/theme-preview?id=… : draft mode de
 * Next + cookie `theme-preview`. Le cookie n'est appliqué que si le draft mode
 * est actif ET qu'une session admin valide existe (en développement : sans
 * session). Ces requêtes contournent le cache ISR ; un visiteur anonyme reçoit
 * toujours la page en cache, jamais un aperçu.
 */
import { own } from "./own";
import { eq } from "drizzle-orm";
import { cookies, draftMode } from "next/headers";
import { cache } from "react";

import { DEFAULT_THEME_ID, PRESETS } from "@/themes/presets";
import { ThemeSchema, type Theme } from "@/themes/schema";

import { getAdminSession } from "./auth/guard";

import { cached, isBuildPhase, TAGS } from "./cache";
import { getDb, schema } from "./db";
import { parseJson } from "./json";

export const PREVIEW_COOKIE = "theme-preview";
/** Développement : les scripts de capture masquent le bandeau d'aperçu. */
export const PREVIEW_BANNER_COOKIE = "theme-preview-banner";

/** Développement : bandeau d'aperçu masqué pour les captures (banner=0). */
export async function isPreviewBannerHidden(): Promise<boolean> {
  return isThemePreviewOpen() && (await cookies()).get(PREVIEW_BANNER_COOKIE)?.value === "off";
}

/** Aperçu ouvert sans session ? (développement uniquement : scripts de test) */
export function isThemePreviewOpen(): boolean {
  return process.env.NODE_ENV !== "production";
}

/** Thème prévisualisable par la requête courante (draft mode + droit), sinon null. */
async function previewThemeId(): Promise<string | null> {
  if (!(await draftMode()).isEnabled) return null;
  const id = (await cookies()).get(PREVIEW_COOKIE)?.value;
  if (!id) return null;
  if (!isThemePreviewOpen() && !(await getAdminSession())) return null;
  return id;
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

/**
 * Thème actuellement PRÉVISUALISÉ (bandeau d'aperçu), ou null. Même règle que
 * getActiveTheme : draft mode + droit d'aperçu. Masquable en développement
 * seulement (captures automatiques).
 */
export async function getPreviewTheme(): Promise<Theme | null> {
  if (isBuildPhase()) return null;
  const id = await previewThemeId();
  if (!id) return null;
  if (isThemePreviewOpen() && (await cookies()).get(PREVIEW_BANNER_COOKIE)?.value === "off") return null;
  const state = await getThemeState();
  return Object.hasOwn(state.themes, id) ? state.themes[id] : null;
}

export const getActiveTheme = cache(async (): Promise<Theme> => {
  if (isBuildPhase()) return PRESETS[DEFAULT_THEME_ID];

  const state = await getThemeState();
  // draftMode().isEnabled ne rend pas la page dynamique ; cookies() et la
  // session ne sont lus que dans une requête en draft mode, déjà hors cache ISR.
  const previewId = await previewThemeId();
  if (previewId && Object.hasOwn(state.themes, previewId)) return state.themes[previewId];
  const active = own(state.themes, state.activeId);
  if (!active) {
    console.error(`[theme] thème actif « ${state.activeId} » introuvable, repli sur ${DEFAULT_THEME_ID}`);
    return state.themes[DEFAULT_THEME_ID] ?? PRESETS[DEFAULT_THEME_ID];
  }
  return active;
});
