"use server";

/**
 * Server actions des thèmes. Chacune : `await assertAdmin()` (vérifié par
 * scripts/test-admin-guard.mjs), validation serveur (src/lib/edit/themes.ts :
 * zod + contraste AA), puis invalidation de l'étiquette « theme ».
 */
import { z } from "zod";

import { assertAdmin } from "@/lib/auth/guard";
import { applyKitImport } from "@/lib/kit/apply";
import { purgeKitData, purgeKits } from "@/lib/kit/export-job";
import { isImportId, purgeThemeImports } from "@/lib/kit/import-job";
import { activateTheme, deleteTheme, duplicateTheme, saveTheme } from "@/lib/edit/themes";
import { fail, type ActionResult } from "@/lib/edit/result";
import { revalidateTheme } from "@/lib/revalidate";

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

export async function saveThemeAction(id: unknown, input: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const tid = themeId(id);
  if (!tid) return fail("Thème inconnu.");
  const result = saveTheme(tid, input);
  if (result.ok) {
    revalidateTheme();
    // Le thème a changé : ses kits en cache sont périmés.
    await purgeKits(tid);
  }
  return result;
}

export async function activateThemeAction(id: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const tid = themeId(id);
  if (!tid) return fail("Thème inconnu.");
  const result = activateTheme(tid);
  if (result.ok) revalidateTheme();
  return result;
}

export async function deleteThemeAction(id: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const tid = themeId(id);
  if (!tid) return fail("Thème inconnu.");
  const result = deleteTheme(tid);
  if (result.ok) {
    revalidateTheme();
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
