"use server";

/**
 * Server actions de la bibliothèque de cadres (lot 74) : renommer, régler l'épaisseur, où un cadre sert, supprimer. L'import passe par
 * POST /admin/api/cadres (envoi de fichier). Chacune : `await assertAdmin()`, identifiants et charges validés, cache invalidé.
 */
import { z } from "zod";

import { assertAdmin } from "@/lib/auth/guard";
import { deleteFrame, frameUseCounts, renameFrame, setFrameThickness } from "@/lib/edit/frames";
import { fail, type ActionResult } from "@/lib/edit/result";
import { listFramesForAdmin, type AdminFrame } from "@/lib/frames";
import { revalidateFrames, revalidatePage, revalidateProject } from "@/lib/revalidate";
import { audited } from "@/lib/journal/audit";
import { adminT } from "@/i18n/admin-msg";

const Id = z.string().min(1).max(80).regex(/^[a-z0-9-]+$/);

export const renameFrameAction = audited("renameFrameAction", async function renameFrameAction(id: unknown, name: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const parsed = Id.safeParse(id);
  if (!parsed.success) return fail("Cadre inconnu.");
  const r = renameFrame(parsed.data, name);
  if (r.ok) revalidateFrames();
  return r;
});

export const setFrameThicknessAction = audited("setFrameThicknessAction", async function setFrameThicknessAction(id: unknown, value: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const parsed = Id.safeParse(id);
  if (!parsed.success) return fail("Cadre inconnu.");
  const r = setFrameThickness(parsed.data, value);
  if (r.ok) revalidateFrames();
  return r;
});

/** Combien d'images portent ce cadre (avertissement avant de le supprimer). */
export async function frameUsesAction(id: unknown): Promise<ActionResult<{ images: number }>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const parsed = Id.safeParse(id);
  if (!parsed.success) return fail("Cadre inconnu.");
  return { ok: true, data: { images: frameUseCounts().get(parsed.data) ?? 0 } };
}

/** Supprimer = retirer de la bibliothèque ; les images qui le portaient repassent à « Aucun ». */
export const deleteFrameAction = audited("deleteFrameAction", async function deleteFrameAction(id: unknown): Promise<ActionResult<{ name: string; images: number }>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const parsed = Id.safeParse(id);
  if (!parsed.success) return fail("Cadre inconnu.");
  const r = deleteFrame(parsed.data);
  if (!r.ok) return r;
  revalidateFrames();
  for (const p of r.data.touched.pages) revalidatePage(p);
  for (const p of r.data.touched.projects) revalidateProject(p);
  return { ok: true, data: { name: r.data.name, images: r.data.images } };
});

export async function listFramesAction(): Promise<ActionResult<AdminFrame[]>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  return { ok: true, data: listFramesForAdmin() };
}
