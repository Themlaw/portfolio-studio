"use server";

import { z } from "zod";

import { assertAdmin } from "@/lib/auth/guard";
import { createShareLink, deleteShareLink, replaceShareLinkMedia, setShareLinkEnabled, updateShareLink } from "@/lib/edit/share-links";
import { fail, type ActionResult } from "@/lib/edit/result";
import { revalidatePath } from "next/cache";
import { audited } from "@/lib/journal/audit";

const Id = z.number().int().positive();

export const createShareLinkAction = audited("createShareLinkAction", async function createShareLinkAction(input: unknown): Promise<ActionResult<{ id: number }>> {
  await assertAdmin();
  const result = createShareLink(input);
  if (result.ok) revalidatePath("/[locale]/l/[slug]", "page");
  return result;
});

export const updateShareLinkAction = audited("updateShareLinkAction", async function updateShareLinkAction(id: unknown, input: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const parsed = Id.safeParse(id);
  if (!parsed.success) return fail("Lien inconnu.");
  const result = updateShareLink(parsed.data, input);
  if (result.ok) revalidatePath("/[locale]/l/[slug]", "page");
  return result;
});

export const deleteShareLinkAction = audited("deleteShareLinkAction", async function deleteShareLinkAction(id: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const parsed = Id.safeParse(id);
  if (!parsed.success) return fail("Lien inconnu.");
  const result = deleteShareLink(parsed.data);
  if (result.ok) revalidatePath("/[locale]/l/[slug]", "page");
  return result;
});

export const setShareLinkEnabledAction = audited("setShareLinkEnabledAction", async function setShareLinkEnabledAction(id: unknown, enabled: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const parsedId = Id.safeParse(id);
  if (!parsedId.success) return fail("Lien inconnu.");
  const parsedEnabled = z.boolean().safeParse(enabled);
  if (!parsedEnabled.success) return fail("Valeur invalide.");
  const result = setShareLinkEnabled(parsedId.data, parsedEnabled.data);
  if (result.ok) revalidatePath("/[locale]/l/[slug]", "page");
  return result;
});

export const replaceShareLinkMediaAction = audited("replaceShareLinkMediaAction", async function replaceShareLinkMediaAction(id: unknown, mediaId: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const parsedId = Id.safeParse(id);
  if (!parsedId.success) return fail("Lien inconnu.");
  const parsedMedia = z.number().int().positive().safeParse(mediaId);
  if (!parsedMedia.success) return fail("Valeur invalide.");
  const result = replaceShareLinkMedia(parsedId.data, parsedMedia.data);
  if (result.ok) revalidatePath("/[locale]/l/[slug]", "page");
  return result;
});