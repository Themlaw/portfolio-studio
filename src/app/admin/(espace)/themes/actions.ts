"use server";

/**
 * Server actions des thèmes. Chacune : `await assertAdmin()` (vérifié par
 * scripts/test-admin-guard.mjs), validation serveur (src/lib/edit/themes.ts :
 * zod + contraste AA), puis invalidation de l'étiquette « theme ».
 */
import { z } from "zod";

import { assertAdmin } from "@/lib/auth/guard";
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
  if (result.ok) revalidateTheme();
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
  if (result.ok) revalidateTheme();
  return result;
}
