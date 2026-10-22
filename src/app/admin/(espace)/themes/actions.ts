"use server";

/**
 * Server actions des thèmes. Chacune : `await assertAdmin()` (vérifié par
 * scripts/test-admin-guard.mjs), validation serveur (src/lib/edit/themes.ts :
 * zod + contraste AA), puis invalidation de l'étiquette « theme ».
 */
import { cookies, draftMode } from "next/headers";
import { z } from "zod";

import { assertAdmin } from "@/lib/auth/guard";
import { applyKitImport } from "@/lib/kit/apply";
import { logoFromMedia } from "@/lib/kit/logo";
import { purgeKitData, purgeKits } from "@/lib/kit/export-job";
import { isImportId, purgeThemeImports } from "@/lib/kit/import-job";
import { activateTheme, deleteTheme, duplicateTheme, saveTheme } from "@/lib/edit/themes";
import { fail, type ActionResult } from "@/lib/edit/result";
import { resetPublishedSitePalette } from "@/lib/edit/site";
import { revalidateSettings, revalidateTheme } from "@/lib/revalidate";
import { PREVIEW_COOKIE } from "@/lib/theme";
import type { KitImage } from "@/themes/schema";

const Id = z.string().regex(/^[a-z0-9-]{1,80}$/);

function themeId(id: unknown): string | null {
  const parsed = Id.safeParse(id);
  return parsed.success ? parsed.data : null;
}

export async function duplicateThemeAction(id: unknown): Promise<ActionResult<{ id: string }>> {
  await assertAdmin();
  const tid = themeId(id);
  if (!tid) return fail("Thème inconnu.");
  const result = duplicateTheme(tid);
  if (result.ok) revalidateTheme();
  return result;
}

/** `confirmLive` : confirmation de la mise en ligne, exigée (côté serveur) quand le thème enregistré est le thème actif. */
export async function saveThemeAction(id: unknown, input: unknown, confirmLive?: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const tid = themeId(id);
  if (!tid) return fail("Thème inconnu.");
  const result = saveTheme(tid, input, confirmLive === true);
  if (result.ok) {
    revalidateTheme();
    // Le thème a changé : ses kits en cache sont périmés.
    await purgeKits(tid);
  }
  return result;
}

/**
 * Mise en ligne d'un thème. `options.resetColors` : les couleurs personnalisées du site ne restent pas par-dessus
 * le nouveau thème (lot 55). Le thème qui était en ligne est retenu (« Revenir au thème précédent »).
 */
export async function activateThemeAction(id: unknown, options?: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const tid = themeId(id);
  if (!tid) return fail("Thème inconnu.");
  const resetColors = Boolean(options && typeof options === "object" && (options as { resetColors?: unknown }).resetColors === true);
  const result = activateTheme(tid, resetColors);
  if (result.ok) {
    revalidateTheme();
    if (resetColors) revalidateSettings();
  }
  return result;
}

/** « Revenir aux couleurs du thème » : retire les couleurs personnalisées du site (lot 55). */
export async function resetSiteColorsAction(): Promise<ActionResult<null>> {
  await assertAdmin();
  const result = resetPublishedSitePalette();
  if (result.ok) {
    revalidateSettings();
    revalidateTheme();
  }
  return result;
}

export async function deleteThemeAction(id: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const tid = themeId(id);
  if (!tid) return fail("Thème inconnu.");
  const result = deleteTheme(tid);
  if (result.ok) {
    revalidateTheme();
    // Le thème supprimé était peut-être en aperçu : l'aperçu s'arrête (sinon le site passerait en « aperçu des brouillons » sans explication).
    const jar = await cookies();
    if (jar.get(PREVIEW_COOKIE)?.value === tid) {
      jar.delete(PREVIEW_COOKIE);
      (await draftMode()).disable();
    }
    // Kits en cache, manifestes et aperçus, imports du thème.
    await purgeKitData(tid);
    await purgeThemeImports(tid);
  }
  return result;
}

/**
 * Import de kit relu : crée une COPIE BROUILLON du thème avec les nouveaux
 * assets (jamais le thème en ligne remplacé). Options : `mirror` (une seule flèche redessinée : son miroir pour l'autre),
 * `colors` (couleurs repeintes dans « 8 · Palette »), `base` (thème sur lequel poser le kit).
 */
export async function applyKitImportAction(themeIdInput: unknown, importId: unknown, options: unknown): Promise<ActionResult<{ id: string }>> {
  await assertAdmin();
  const tid = themeId(themeIdInput);
  if (!tid || !isImportId(importId)) return fail("Import inconnu.");
  const o = (options && typeof options === "object" ? options : {}) as { mirror?: unknown; colors?: unknown; base?: unknown };
  const base = o.base === undefined ? undefined : themeId(o.base);
  if (o.base !== undefined && !base) return fail("Thème de départ inconnu.");
  const result = await applyKitImport(tid, importId, { mirror: o.mirror === true, colors: o.colors === true, baseThemeId: base ?? undefined });
  if (result.ok) revalidateTheme();
  return result;
}

/**
 * Logo importé depuis une image de la médiathèque (lot 61, étape « Logo » de l'éditeur) : rend l'élément `signature` à poser dans le
 * thème en cours d'édition ; rien n'est écrit sur le thème avant « Enregistrer ».
 */
export async function importThemeLogoAction(mediaId: unknown): Promise<ActionResult<{ signature: KitImage }>> {
  await assertAdmin();
  return logoFromMedia(mediaId);
}
