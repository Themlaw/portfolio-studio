"use server";

/**
 * Server action du réglage « Cadre du thème sur toutes les photos » (lot 62). `await assertAdmin()`, charge validée par zod, cache des
 * réglages invalidé (les pages publiques et la toile relisent `themeFrameAll`).
 */
import { assertAdmin } from "@/lib/auth/guard";
import { saveThemeFrameAll } from "@/lib/edit/frame-all";
import type { ActionResult } from "@/lib/edit/result";
import { revalidateSettings } from "@/lib/revalidate";

export async function saveThemeFrameAllAction(input: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const result = saveThemeFrameAll(input);
  if (result.ok) revalidateSettings();
  return result;
}
