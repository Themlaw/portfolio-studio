import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";

/**
 * Un contenu renvoyé alors que son média est à la corbeille (lot 23) le ressort : un contenu = une ligne
 * (SHA-256 unique), ses fichiers sont toujours là tant que la purge n'est pas passée.
 */
export function reviveIfTrashed(row: { id: number; deletedAt?: Date | null }): void {
  if (row.deletedAt) getDb().update(schema.media).set({ deletedAt: null }).where(eq(schema.media.id, row.id)).run();
}
