"use server";

/** Server actions de la médiathèque : texte alternatif, suppression, suivi des traitements. */
import { z } from "zod";

import { getMediaUses, listMediaForAdmin, type AdminMediaRow, type MediaUseRow } from "@/lib/admin";
import { assertAdmin } from "@/lib/auth/guard";
import { backfillTaken, type TakenFill } from "@/lib/edit/media-taken";
import { deleteMedia, restoreMedia, retryMedia, saveMediaAlt, type MediaUseRef } from "@/lib/edit/media";
import { wakeWorker } from "@/lib/jobs/worker";
import { listPendingUploads, type UploadStatus } from "@/lib/upload/chunks";
import { fail, type ActionResult } from "@/lib/edit/result";
import { revalidateMedia, revalidateProjects } from "@/lib/revalidate";
import { addTagsToMedia, deleteTag, deleteUnusedTags, listTags, mergeTags, removeTagsFromMedia, renameTag, setMediaTags, type TagRow } from "@/lib/tags";
import { audited } from "@/lib/journal/audit";
import { adminT } from "@/i18n/admin-msg";

const Id = z.number().int().positive();

export const saveMediaAltAction = audited("saveMediaAltAction", async function saveMediaAltAction(mediaId: unknown, alt: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const t = adminT("actions");
  const parsed = Id.safeParse(mediaId);
  if (!parsed.success) return fail(t(t("unknownImage")));
  const result = saveMediaAlt(parsed.data, alt);
  if (result.ok) revalidateMedia();
  return result;
});

/** Supprimer = mettre à la corbeille (restaurable 30 jours : `restoreMediaAction`) ; refusé si le média sert. */
export const deleteMediaAction = audited("deleteMediaAction", async function deleteMediaAction(
  mediaId: unknown,
): Promise<ActionResult<{ name: string }> | { ok: false; message: string; references: MediaUseRef[] }> {
  await assertAdmin();
  const t = adminT("actions");
  const parsed = Id.safeParse(mediaId);
  if (!parsed.success) return fail(t(t("unknownImage")));
  const result = await deleteMedia(parsed.data);
  if (result.ok) {
    revalidateMedia();
    revalidateProjects();
  }
  return result;
});

/** Restaure un média de la corbeille. */
export const restoreMediaAction = audited("restoreMediaAction", async function restoreMediaAction(mediaId: unknown): Promise<ActionResult<{ name: string }>> {
  await assertAdmin();
  const t = adminT("actions");
  const parsed = Id.safeParse(mediaId);
  if (!parsed.success) return fail(t(t("unknownImage")));
  const result = restoreMedia(parsed.data);
  if (result.ok) {
    revalidateMedia();
    revalidateProjects();
  }
  return result;
});

/** État des médias suivis par l'interface (traitement en cours → prêt / échec). */
export async function mediaStatusAction(ids: unknown): Promise<ActionResult<AdminMediaRow[]>> {
  await assertAdmin();
  const t = adminT("actions");
  const parsed = z.array(Id).max(100).safeParse(ids);
  if (!parsed.success) return fail(t("invalidRequest"));
  const wanted = new Set(parsed.data);
  return { ok: true, data: listMediaForAdmin().filter((m) => wanted.has(m.id)) };
}

/** Lot 112 : lit la date de création d'un lot de médias anciens (métadonnées seulement), pour le tri « Date de création ». */
export async function backfillTakenAction(): Promise<ActionResult<{ done: TakenFill[]; remaining: number }>> {
  await assertAdmin();
  const t = adminT("actions");
  return { ok: true, data: await backfillTaken(20) };
}

/** « Utilisé dans… » d'un média. */
export async function mediaUsesAction(mediaId: unknown): Promise<ActionResult<MediaUseRow[]>> {
  await assertAdmin();
  const t = adminT("actions");
  const parsed = Id.safeParse(mediaId);
  if (!parsed.success) return fail(t(t("unknownImage")));
  return { ok: true, data: getMediaUses(parsed.data) };
}

/** Relance la conversion ou le traitement d'un média en échec. */
export const retryMediaAction = audited("retryMediaAction", async function retryMediaAction(mediaId: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const t = adminT("actions");
  const parsed = Id.safeParse(mediaId);
  if (!parsed.success) return fail(t("unknownMedia"));
  const result = await retryMedia(parsed.data);
  if (result.ok) {
    wakeWorker();
    revalidateMedia();
  }
  return result;
});

/** Envois par morceaux interrompus (à reprendre ou annuler). */
export async function pendingUploadsAction(): Promise<ActionResult<UploadStatus[]>> {
  const { user } = await assertAdmin();
  const t = adminT("actions");
  return { ok: true, data: listPendingUploads(user.id) };
}

/* ---- Tags ------------------------------------------------------------------ */

const Ids = z.array(Id).min(1).max(1000);

/** Tags de la bibliothèque, avec leur nombre d'usages. */
export async function listTagsAction(): Promise<ActionResult<TagRow[]>> {
  await assertAdmin();
  const t = adminT("actions");
  return { ok: true, data: listTags() };
}

/** Remplace les tags d'un média (panneau de détail). */
export const setMediaTagsAction = audited("setMediaTagsAction", async function setMediaTagsAction(mediaId: unknown, labels: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const t = adminT("actions");
  const parsed = Id.safeParse(mediaId);
  if (!parsed.success) return fail(t("unknownMedia"));
  const result = setMediaTags(parsed.data, labels);
  if (result.ok) revalidateMedia();
  return result;
});

/** Ajoute des tags à un ou plusieurs médias (envoi, sélection multiple). */
export const addMediaTagsAction = audited("addMediaTagsAction", async function addMediaTagsAction(mediaIds: unknown, labels: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const t = adminT("actions");
  const parsed = Ids.safeParse(mediaIds);
  if (!parsed.success) return fail(t("invalidRequest"));
  const result = addTagsToMedia(parsed.data, labels);
  if (result.ok) revalidateMedia();
  return result;
});

/** Retire des tags (par libellé) d'un ou plusieurs médias. */
export const removeMediaTagsAction = audited("removeMediaTagsAction", async function removeMediaTagsAction(mediaIds: unknown, labels: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const t = adminT("actions");
  const parsed = Ids.safeParse(mediaIds);
  if (!parsed.success) return fail(t("invalidRequest"));
  const result = removeTagsFromMedia(parsed.data, labels);
  if (result.ok) revalidateMedia();
  return result;
});

export const renameTagAction = audited("renameTagAction", async function renameTagAction(tagId: unknown, label: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const t = adminT("actions");
  const parsed = Id.safeParse(tagId);
  if (!parsed.success) return fail(t(t("unknownTag")));
  const result = renameTag(parsed.data, label);
  if (result.ok) revalidateMedia();
  return result;
});

/** Fusionne le tag `fromId` dans `intoId`. */
export const mergeTagsAction = audited("mergeTagsAction", async function mergeTagsAction(fromId: unknown, intoId: unknown): Promise<ActionResult<{ moved: number }>> {
  await assertAdmin();
  const t = adminT("actions");
  const parsed = z.tuple([Id, Id]).safeParse([fromId, intoId]);
  if (!parsed.success) return fail(t(t("unknownTag")));
  const result = mergeTags(parsed.data[0], parsed.data[1]);
  if (result.ok) revalidateMedia();
  return result;
});

/** Supprime les tags posés sur aucun média (bouton de l'onglet Tags). */
export const deleteUnusedTagsAction = audited("deleteUnusedTagsAction", async function deleteUnusedTagsAction(): Promise<ActionResult<{ deleted: number }>> {
  await assertAdmin();
  const t = adminT("actions");
  const result = deleteUnusedTags();
  if (result.ok) revalidateMedia();
  return result;
});

export const deleteTagAction = audited("deleteTagAction", async function deleteTagAction(tagId: unknown): Promise<ActionResult<{ media: number }>> {
  await assertAdmin();
  const t = adminT("actions");
  const parsed = Id.safeParse(tagId);
  if (!parsed.success) return fail(t(t("unknownTag")));
  const result = deleteTag(parsed.data);
  if (result.ok) revalidateMedia();
  return result;
});
