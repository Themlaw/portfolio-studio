"use server";

/** Server actions de la médiathèque : texte alternatif, suppression, suivi des traitements. */
import { z } from "zod";

import { getMediaUses, listMediaForAdmin, type AdminMediaRow, type MediaUseRow } from "@/lib/admin";
import { assertAdmin } from "@/lib/auth/guard";
import { deleteMedia, saveMediaAlt, type MediaBlockUse } from "@/lib/edit/media";
import { fail, type ActionResult } from "@/lib/edit/result";
import { revalidateMedia, revalidateProjects } from "@/lib/revalidate";

const Id = z.number().int().positive();

export async function saveMediaAltAction(mediaId: unknown, alt: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const parsed = Id.safeParse(mediaId);
  if (!parsed.success) return fail("Image inconnue.");
  const result = saveMediaAlt(parsed.data, alt);
  if (result.ok) revalidateMedia();
  return result;
}

export async function deleteMediaAction(
  mediaId: unknown,
): Promise<ActionResult<{ emptiedSlots: number; projectIds: number[] }> | { ok: false; message: string; references: MediaBlockUse[] }> {
  await assertAdmin();
  const parsed = Id.safeParse(mediaId);
  if (!parsed.success) return fail("Image inconnue.");
  const result = await deleteMedia(parsed.data);
  if (result.ok) {
    revalidateMedia();
    revalidateProjects();
  }
  return result;
}

/** État des médias suivis par l'interface (traitement en cours → prêt / échec). */
export async function mediaStatusAction(ids: unknown): Promise<ActionResult<AdminMediaRow[]>> {
  await assertAdmin();
  const parsed = z.array(Id).max(100).safeParse(ids);
  if (!parsed.success) return fail("Requête invalide.");
  const wanted = new Set(parsed.data);
  return { ok: true, data: listMediaForAdmin().filter((m) => wanted.has(m.id)) };
}

/** « Utilisé dans… » d'un média. */
export async function mediaUsesAction(mediaId: unknown): Promise<ActionResult<MediaUseRow[]>> {
  await assertAdmin();
  const parsed = Id.safeParse(mediaId);
  if (!parsed.success) return fail("Image inconnue.");
  return { ok: true, data: getMediaUses(parsed.data) };
}
