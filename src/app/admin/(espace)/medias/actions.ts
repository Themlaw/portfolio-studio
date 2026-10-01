"use server";

/** Server actions de la médiathèque : texte alternatif, suppression, suivi des traitements. */
import { z } from "zod";

import { getMediaUses, listMediaForAdmin, type AdminMediaRow, type MediaUseRow } from "@/lib/admin";
import { assertAdmin } from "@/lib/auth/guard";
import { deleteMedia, retryMedia, saveMediaAlt, type MediaBlockUse } from "@/lib/edit/media";
import { wakeWorker } from "@/lib/jobs/worker";
import { listPendingUploads, type UploadStatus } from "@/lib/upload/chunks";
import { fail, type ActionResult } from "@/lib/edit/result";
import { revalidateMedia, revalidateProjects } from "@/lib/revalidate";
import { addTagsToMedia, deleteTag, deleteUnusedTags, listTags, mergeTags, removeTagsFromMedia, renameTag, setMediaTags, type TagRow } from "@/lib/tags";

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

/** Relance la conversion ou le traitement d'un média en échec. */
export async function retryMediaAction(mediaId: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const parsed = Id.safeParse(mediaId);
  if (!parsed.success) return fail("Média inconnu.");
  const result = await retryMedia(parsed.data);
  if (result.ok) {
    wakeWorker();
    revalidateMedia();
  }
  return result;
}

/** Envois par morceaux interrompus (à reprendre ou annuler). */
export async function pendingUploadsAction(): Promise<ActionResult<UploadStatus[]>> {
  const { user } = await assertAdmin();
  return { ok: true, data: listPendingUploads(user.id) };
}

/* ---- Tags ------------------------------------------------------------------ */

const Ids = z.array(Id).min(1).max(1000);

/** Tags de la bibliothèque, avec leur nombre d'usages. */
export async function listTagsAction(): Promise<ActionResult<TagRow[]>> {
  await assertAdmin();
  return { ok: true, data: listTags() };
}

/** Remplace les tags d'un média (panneau de détail). */
export async function setMediaTagsAction(mediaId: unknown, labels: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const parsed = Id.safeParse(mediaId);
  if (!parsed.success) return fail("Média inconnu.");
  const result = setMediaTags(parsed.data, labels);
  if (result.ok) revalidateMedia();
  return result;
}

/** Ajoute des tags à un ou plusieurs médias (envoi, sélection multiple). */
export async function addMediaTagsAction(mediaIds: unknown, labels: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const parsed = Ids.safeParse(mediaIds);
  if (!parsed.success) return fail("Requête invalide.");
  const result = addTagsToMedia(parsed.data, labels);
  if (result.ok) revalidateMedia();
  return result;
}

/** Retire des tags (par libellé) d'un ou plusieurs médias. */
export async function removeMediaTagsAction(mediaIds: unknown, labels: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const parsed = Ids.safeParse(mediaIds);
  if (!parsed.success) return fail("Requête invalide.");
  const result = removeTagsFromMedia(parsed.data, labels);
  if (result.ok) revalidateMedia();
  return result;
}

export async function renameTagAction(tagId: unknown, label: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const parsed = Id.safeParse(tagId);
  if (!parsed.success) return fail("Tag inconnu.");
  const result = renameTag(parsed.data, label);
  if (result.ok) revalidateMedia();
  return result;
}

/** Fusionne le tag `fromId` dans `intoId`. */
export async function mergeTagsAction(fromId: unknown, intoId: unknown): Promise<ActionResult<{ moved: number }>> {
  await assertAdmin();
  const parsed = z.tuple([Id, Id]).safeParse([fromId, intoId]);
  if (!parsed.success) return fail("Tag inconnu.");
  const result = mergeTags(parsed.data[0], parsed.data[1]);
  if (result.ok) revalidateMedia();
  return result;
}

/** Supprime les tags posés sur aucun média (bouton de l'onglet Tags). */
export async function deleteUnusedTagsAction(): Promise<ActionResult<{ deleted: number }>> {
  await assertAdmin();
  const result = deleteUnusedTags();
  if (result.ok) revalidateMedia();
  return result;
}

export async function deleteTagAction(tagId: unknown): Promise<ActionResult<{ media: number }>> {
  await assertAdmin();
  const parsed = Id.safeParse(tagId);
  if (!parsed.success) return fail("Tag inconnu.");
  const result = deleteTag(parsed.data);
  if (result.ok) revalidateMedia();
  return result;
}
