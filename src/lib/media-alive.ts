/** Un média est-il une image prête, hors corbeille ? (choix de l'icône et de l'image de partage, icône encore valide). Lecture directe. */
import { and, eq, isNull } from "drizzle-orm";

import { getDb, schema } from "./db";

export function isReadyImage(id: number): boolean {
  return Boolean(
    getDb()
      .select({ id: schema.media.id })
      .from(schema.media)
      .where(and(eq(schema.media.id, id), eq(schema.media.kind, "image"), eq(schema.media.status, "ready"), isNull(schema.media.deletedAt)))
      .get(),
  );
}
