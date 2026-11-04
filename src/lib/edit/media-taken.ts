/**
 * Lecture paresseuse de la date de création des médias déjà présents (lot 112, tri « Date de création ») : par petits lots,
 * à la demande de l'éditeur (jamais au démarrage), en lisant seulement les métadonnées de l'original (aucun pixel décodé,
 * aucun fichier modifié). `taken_checked` évite de relire un fichier sans date.
 */
import { and, eq, isNull, sql } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { readTakenAt } from "@/lib/media-taken";
import { getStorage } from "@/lib/storage";

export type TakenFill = { id: number; takenAt: number | null };

let busy: Promise<unknown> = Promise.resolve();

/** Lit jusqu'à `limit` médias non encore lus ; renvoie ce qui a été lu et ce qu'il en reste. */
export function backfillTaken(limit = 20): Promise<{ done: TakenFill[]; remaining: number }> {
  // Un lot à la fois (deux onglets ouverts ne relisent pas les mêmes fichiers en parallèle).
  const run = busy.then(async () => {
    const db = getDb();
    const todo = db
      .select({ id: schema.media.id, key: schema.media.key, kind: schema.media.kind, mime: schema.media.mime })
      .from(schema.media)
      .where(and(isNull(schema.media.takenChecked), isNull(schema.media.deletedAt)))
      .orderBy(sql`${schema.media.id} desc`)
      .limit(limit)
      .all();
    const storage = getStorage();
    const done: TakenFill[] = [];
    for (const m of todo) {
      const file = m.kind === "pdf" ? null : await storage.localPath(m.key).catch(() => null);
      const takenAt = file ? await readTakenAt(m.kind, m.mime, file) : null;
      db.update(schema.media).set({ takenAt, takenChecked: 1 }).where(and(eq(schema.media.id, m.id), isNull(schema.media.takenChecked))).run();
      done.push({ id: m.id, takenAt });
    }
    const remaining = db
      .select({ n: sql<number>`count(*)` })
      .from(schema.media)
      .where(and(isNull(schema.media.takenChecked), isNull(schema.media.deletedAt)))
      .get()?.n ?? 0;
    return { done, remaining };
  });
  busy = run.catch(() => {});
  return run;
}
