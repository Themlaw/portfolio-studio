"use server";

/**
 * Server actions des pages. Chacune : `await assertAdmin()`, validation
 * serveur (src/lib/edit/pages.ts), puis invalidation de la page et du menu.
 */
import { z } from "zod";

import { assertAdmin } from "@/lib/auth/guard";
import {
  createPage,
  deletePage,
  reorderMenu,
  savePage,
  setInMenu,
  setPublished,
  type PageReference,
} from "@/lib/edit/pages";
import { fail, type ActionResult } from "@/lib/edit/result";
import { revalidateNav, revalidatePage } from "@/lib/revalidate";

const Id = z.number().int().positive();

function pageId(id: unknown): number | null {
  const parsed = Id.safeParse(id);
  return parsed.success ? parsed.data : null;
}

export async function createPageAction(input: unknown): Promise<ActionResult<{ id: number }>> {
  await assertAdmin();
  const result = createPage(input);
  if (result.ok) revalidateNav();
  return result;
}

export async function savePageAction(id: unknown, input: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const pid = pageId(id);
  if (!pid) return fail("Page inconnue.");
  const result = savePage(pid, input);
  if (result.ok) revalidatePage(pid, { structure: true });
  return result;
}

export async function setPublishedAction(id: unknown, published: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const pid = pageId(id);
  if (!pid || typeof published !== "boolean") return fail("Requête invalide.");
  const result = setPublished(pid, published);
  if (result.ok) revalidatePage(pid, { structure: true });
  return result;
}

export async function setInMenuAction(id: unknown, inMenu: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const pid = pageId(id);
  if (!pid || typeof inMenu !== "boolean") return fail("Requête invalide.");
  const result = setInMenu(pid, inMenu);
  if (result.ok) revalidateNav();
  return result;
}

export async function reorderMenuAction(ids: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const result = reorderMenu(ids);
  if (result.ok) revalidateNav();
  return result;
}

export async function deletePageAction(
  id: unknown,
): Promise<ActionResult<null> | { ok: false; message: string; references: PageReference[] }> {
  await assertAdmin();
  const pid = pageId(id);
  if (!pid) return fail("Page inconnue.");
  const result = deletePage(pid);
  if (result.ok) revalidatePage(pid, { structure: true });
  return result;
}
