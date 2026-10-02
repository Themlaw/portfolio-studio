"use server";

/** Messages du formulaire de contact : suppression (un, ou tous). */
import { z } from "zod";

import { assertAdmin } from "@/lib/auth/guard";
import { getDb, schema } from "@/lib/db";
import { done, fail, type ActionResult } from "@/lib/edit/result";
import { eq } from "drizzle-orm";

export async function deleteMessageAction(id: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const parsed = z.number().int().positive().safeParse(id);
  if (!parsed.success) return fail("Message inconnu.");
  getDb().delete(schema.messages).where(eq(schema.messages.id, parsed.data)).run();
  return done(null);
}

export async function deleteAllMessagesAction(confirm: unknown): Promise<ActionResult<{ deleted: number }>> {
  await assertAdmin();
  if (confirm !== "tout") return fail("Confirmation manquante.");
  const res = getDb().delete(schema.messages).run();
  return done({ deleted: res.changes });
}
