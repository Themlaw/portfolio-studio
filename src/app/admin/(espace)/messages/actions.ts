"use server";

/** Messages du formulaire de contact : suppression (un, ou tous). */
import { z } from "zod";

import { assertAdmin } from "@/lib/auth/guard";
import { getDb, schema } from "@/lib/db";
import { done, fail, type ActionResult } from "@/lib/edit/result";
import { lastSeenMessageId } from "@/lib/admin";
import { desc, eq } from "drizzle-orm";
import { audited } from "@/lib/journal/audit";
import { adminT } from "@/i18n/admin-msg";

/** Arrivée sur la page Messages : tout ce qui est arrivé jusque-là est vu (pastille du menu, tableau de bord). Ne recule jamais. */
export const markMessagesSeenAction = audited("markMessagesSeenAction", async function markMessagesSeenAction(upTo: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const parsed = z.number().int().positive().safeParse(upTo);
  if (!parsed.success) return fail("Message inconnu.");
  const db = getDb();
  const max = db.select({ id: schema.messages.id }).from(schema.messages).orderBy(desc(schema.messages.id)).limit(1).get()?.id ?? 0;
  const seen = Math.min(parsed.data, max);
  if (seen > lastSeenMessageId()) {
    const value = JSON.stringify(seen);
    db.insert(schema.settings).values({ key: "messagesSeen", value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } }).run();
  }
  return done(null);
});

export const deleteMessageAction = audited("deleteMessageAction", async function deleteMessageAction(id: unknown): Promise<ActionResult<null>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  const parsed = z.number().int().positive().safeParse(id);
  if (!parsed.success) return fail("Message inconnu.");
  getDb().delete(schema.messages).where(eq(schema.messages.id, parsed.data)).run();
  return done(null);
});

export const deleteAllMessagesAction = audited("deleteAllMessagesAction", async function deleteAllMessagesAction(confirm: unknown): Promise<ActionResult<{ deleted: number }>> {
  await assertAdmin();
  const t = adminT("actions");
  const t = adminT("actions");
  if (confirm !== "tout") return fail("Confirmation manquante.");
  const res = getDb().delete(schema.messages).run();
  return done({ deleted: res.changes });
});
