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
import { and, eq } from "drizzle-orm";
import { cookies, draftMode } from "next/headers";
import { cache } from "react";

import { withFrameRing } from "@/lib/kit/frame-ring";
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

/**
 * `themes` : le rendu PUBLIC (la version publiée, lot 60) ; `drafts` : pour un thème dont la version en cours (brouillon) diffère de la
 * publiée, la version en cours : c'est elle que montre l'aperçu admin.
 */
type ThemeState = { activeId: string; themes: Record<string, Theme>; drafts: Record<string, { theme: Theme; version: number }> };

async function getThemeState(): Promise<ThemeState> {
  return cached(["theme-state"], [TAGS.theme], async () => {
    const db = getDb();
    const themes: Record<string, Theme> = {};
    const drafts: ThemeState["drafts"] = {};
    for (const row of db.select().from(schema.themes).all()) {
      const current = ThemeSchema.safeParse(parseJson(row.data));
      // Mon thème (lot 60) : la version publiée est dans `live_data` tant qu'elle diffère de la version en cours (`data`).
      const live = row.liveData ? ThemeSchema.safeParse(parseJson(row.liveData)) : current;
      // Lot 79 : l'épaisseur pleine du cadre du kit est mesurée sur son fichier (une fois), pas stockée.
      if (live.success) themes[row.id] = await withFrameRing(live.data);
      else if (current.success) {
        console.error(`[theme] version publiée du thème « ${row.id} » invalide en base, version en cours utilisée`);
        themes[row.id] = await withFrameRing(current.data);
      } else console.error(`[theme] thème « ${row.id} » invalide en base, ignoré`);
      if (row.liveData && current.success) drafts[row.id] = { theme: await withFrameRing(current.data), version: row.version };
    }
    const active = db.select().from(schema.settings).where(eq(schema.settings.key, "activeThemeId")).get();
    const activeId = parseJson(active?.value);
    return { activeId: typeof activeId === "string" ? activeId : DEFAULT_THEME_ID, themes, drafts };
  });
}

/** Aperçu d'une version précise de Mon thème : identifiant `<thème>@<n>` (cookie d'aperçu). */
const VERSION_PREVIEW = /^([a-z0-9-]{1,80})@(\d{1,6})$/;

/**
 * Thème montré par un aperçu admin : la version en cours (brouillon) du thème, ou une version précise (`id@n`), sinon null.
 * Requête déjà dynamique (draft mode) : la lecture d'une version en base ne touche pas au cache des pages publiques.
 */
async function resolvePreview(id: string, state: ThemeState): Promise<{ theme: Theme; name: string; draft: boolean } | null> {
  const m = VERSION_PREVIEW.exec(id);
  if (m) {
    if (!Object.hasOwn(state.themes, m[1])) return null;
    const row = getDb().select().from(schema.themeVersions).where(and(eq(schema.themeVersions.themeId, m[1]), eq(schema.themeVersions.n, Number(m[2])))).get();
    const parsed = row ? ThemeSchema.safeParse(parseJson(row.data)) : null;
    return parsed?.success ? { theme: await withFrameRing(parsed.data), name: `${state.themes[m[1]].name} (version ${m[2]})`, draft: true } : null;
  }
  const draft = own(state.drafts, id);
  if (draft) return { theme: draft.theme, name: `${draft.theme.name} (version ${draft.version}, brouillon)`, draft: true };
  const theme = own(state.themes, id);
  return theme ? { theme, name: theme.name, draft: false } : null;
}

/** Thèmes disponibles (base), ou presets pendant le build. */
export async function listThemes(): Promise<Record<string, Theme>> {
  if (isBuildPhase()) return { ...PRESETS };
  return (await getThemeState()).themes;
}

/**
 * Thème d'un identifiant : le rendu public, ou — pour un aperçu admin — la version en cours (brouillon) de Mon thème et ses versions
 * (`id@n`), dont le nom dit de quoi il s'agit.
 */
export async function getTheme(id: string): Promise<Theme | undefined> {
  if (isBuildPhase()) return Object.hasOwn(PRESETS, id) ? PRESETS[id] : undefined;
  const preview = await resolvePreview(id, await getThemeState());
  return preview ? (preview.draft ? { ...preview.theme, name: preview.name } : preview.theme) : undefined;
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
  const preview = await resolvePreview(id, await getThemeState());
  // Un brouillon ou une version de Mon thème : le bandeau dit laquelle (« Mon thème (version 2) »).
  return preview ? (preview.draft ? { ...preview.theme, name: preview.name } : preview.theme) : null;
}

/**
 * Thème « en préparation » (lot 55) : prévisualisé par la requête courante ET différent de ce que voient les visiteurs (un autre thème,
 * une autre version de Mon thème, ou son brouillon). Admin seulement (draft mode + droit d'aperçu).
 */
export async function getPreparingTheme(): Promise<{ id: string; name: string } | null> {
  if (isBuildPhase()) return null;
  const id = await previewThemeId();
  if (!id) return null;
  const state = await getThemeState();
  const preview = await resolvePreview(id, state);
  if (!preview) return null;
  if (id === state.activeId && !preview.draft) return null;
  return { id, name: preview.name };
}

/**
 * Le thème que voient les VISITEURS (publié, jamais l'aperçu), pour ce qui ne suit pas l'aperçu d'un administrateur : l'icône de
 * l'onglet et le manifeste (lot 83). Lecture en cache, étiquette « theme ».
 */
export async function getPublishedTheme(): Promise<Theme> {
  if (isBuildPhase()) return PRESETS[DEFAULT_THEME_ID];
  const state = await getThemeState();
  return own(state.themes, state.activeId) ?? state.themes[DEFAULT_THEME_ID] ?? PRESETS[DEFAULT_THEME_ID];
}

export const getActiveTheme = cache(async (): Promise<Theme> => {
  if (isBuildPhase()) return PRESETS[DEFAULT_THEME_ID];

  const state = await getThemeState();
  // draftMode().isEnabled ne rend pas la page dynamique ; cookies() et la
  // session ne sont lus que dans une requête en draft mode, déjà hors cache ISR.
  const previewId = await previewThemeId();
  const preview = previewId ? await resolvePreview(previewId, state) : null;
  if (preview) return preview.theme;
  const active = own(state.themes, state.activeId);
  if (!active) {
    console.error(`[theme] thème actif « ${state.activeId} » introuvable, repli sur ${DEFAULT_THEME_ID}`);
    return state.themes[DEFAULT_THEME_ID] ?? PRESETS[DEFAULT_THEME_ID];
  }
  return active;
});
