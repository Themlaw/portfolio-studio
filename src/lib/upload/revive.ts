import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

/**
 * Un contenu renvoyé alors que son média est à la corbeille (lot 23) le ressort : un contenu = une ligne
 * (SHA-256 unique), ses fichiers sont toujours là tant que la purge n'est pas passée.
 * Lot 112 : tout renvoi d'un contenu connu note la date de ce dernier envoi (media.last_import_at) : le média remonte en
 * tête de « Ajouté récemment » au lieu de rester à sa place d'origine. Renvoie cette date (ms).
 */
export function reviveIfTrashed(row: { id: number; deletedAt?: Date | null }): number {
  const now = Date.now();
  getDb()
    .update(schema.media)
    .set({ lastImportAt: now, ...(row.deletedAt ? { deletedAt: null } : {}) })
    .where(eq(schema.media.id, row.id))
    .run();
  return now;
}
