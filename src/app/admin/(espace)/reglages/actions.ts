"use server";

/** Server action des réglages : assertAdmin + zod (https seulement) + étiquette « settings ». */
import { assertAdmin } from "@/lib/auth/guard";
import { saveSettings } from "@/lib/edit/settings";
import type { ActionResult } from "@/lib/edit/result";
import { revalidateSettings } from "@/lib/revalidate";

export async function saveSettingsAction(input: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const result = saveSettings(input);
  if (result.ok) revalidateSettings();
  return result;
}
