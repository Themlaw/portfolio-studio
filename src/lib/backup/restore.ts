/**
 * Après une restauration (archive extraite dans /data, conteneur arrêté) : au démarrage, le site voit `manifest.json`
 * à la racine de /data (il n'y est jamais autrement) ; les médias dont des variantes manquent (l'archive ne contient que
 * les originaux) sont remis en file pour le worker, comme « Réessayer » dans la médiathèque. Ensuite le manifest est
 * renommé `manifest.restored.json`. Un seul geste côté administrateur : extraire l'archive.
 * Un coup d'œil (un `stat`) à chaque démarrage, qu'il y ait ou non des sauvegardes activées ; rien n'est créé sans restauration.
 */
import { rename, stat } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";

import { dataDir, getDb, schema } from "@/lib/db";

const MARKER = "manifest.json";

type VariantFiles = { files?: { key?: unknown }[] };

export async function healRestoredMedia(): Promise<void> {
  const root = dataDir();
  const marker = path.join(/* turbopackIgnore: true */ root, MARKER);
  const info = await stat(marker).catch(() => null);
  if (!info?.isFile()) return;
  const mediaDir = path.join(/* turbopackIgnore: true */ root, "media");
  const exists = async (key: string) => !!(await stat(path.join(/* turbopackIgnore: true */ mediaDir, key)).catch(() => null))?.isFile();
  const db = getDb();
  let requeued = 0;
  let lost = 0;
  for (const m of db.select().from(schema.media).all()) {
    if (m.status !== "ready" || !m.key.startsWith("originals/")) continue;
    const files = ((m.variants ?? null) as VariantFiles | null)?.files ?? [];
    let missing = false;
    for (const f of files) {
      if (typeof f.key === "string" && !(await exists(f.key))) {
        missing = true;
        break;
      }
    }
    if (!missing) continue;
    if (!(await exists(m.key))) {
      lost++;
      continue;
    }
    db.transaction((tx) => {
      tx.update(schema.media).set({ status: "processing", error: null }).where(eq(schema.media.id, m.id)).run();
      tx.delete(schema.jobs).where(eq(schema.jobs.mediaId, m.id)).run();
      tx.insert(schema.jobs).values({ kind: m.kind, mediaId: m.id }).run();
    });
    requeued++;
  }
  await rename(marker, path.join(/* turbopackIgnore: true */ root, "manifest.restored.json"));
  console.log(`[backup] restauration détectée : ${requeued} média(s) remis en file pour régénérer leurs variantes${lost ? `, ${lost} sans original (à renvoyer)` : ""}`);
}
