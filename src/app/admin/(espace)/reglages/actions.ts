"use server";

/** Server action des réglages : assertAdmin + zod (https seulement) + étiquette « settings ». */
import { assertAdmin } from "@/lib/auth/guard";
import { saveSeo } from "@/lib/edit/seo";
import { saveSettings } from "@/lib/edit/settings";
import { deleteFont } from "@/lib/fonts/library";
import type { ActionResult } from "@/lib/edit/result";
import { revalidateSettings } from "@/lib/revalidate";

export async function saveSettingsAction(input: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const result = saveSettings(input);
  if (result.ok) revalidateSettings();
  return result;
}

/** Partage et moteurs de recherche (lot 52) : description du site, image de partage, icône de l'onglet. */
export async function saveSeoAction(input: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const result = await saveSeo(input);
  if (result.ok) revalidateSettings();
  return result;
}

/** Supprime une police téléchargée inutilisée (Réglages → Polices téléchargées). */
export async function deleteFontAction(family: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const result = await deleteFont(family);
  if (!result.ok) return result;
  revalidateSettings();
  return { ok: true, data: null };
}
