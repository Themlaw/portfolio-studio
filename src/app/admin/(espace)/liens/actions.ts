"use server";

import { z } from "zod";

import { assertAdmin } from "@/lib/auth/guard";
import { deleteShareLink, updateShareLink, createShareLink, type ShareLinkRow } from "@/lib/edit/share-links";
import { fail, type ActionResult } from "@/lib/edit/result";
import { revalidatePath } from "next/cache";
import { audited } from "@/lib/journal/audit";
import { adminT } from "@/i18n/admin-msg";

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