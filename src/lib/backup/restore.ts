/**
 * Après une restauration (archive extraite dans /data, conteneur arrêté) : au démarrage, le site voit `manifest.json`
 * à la racine de /data (il n'y est jamais autrement) ; les médias dont des variantes manquent (l'archive ne contient que
 * les originaux) sont remis en file pour le worker, comme « Réessayer » dans la médiathèque. Ensuite le manifest est
 * renommé `manifest.restored.json`. Un seul geste côté administrateur : extraire l'archive.
 * Un coup d'œil (un `stat`) à chaque démarrage, qu'il y ait ou non des sauvegardes activées ; rien n'est créé sans restauration.
 */
import { readFile, rename, stat } from "node:fs/promises";
import path from "node:path";

import { eq } from "drizzle-orm";

import { dataDir, getDb, getSqlite, schema } from "@/lib/db";

import { isRegenerableKey, mediaRefsInDb, otherCitedNames, regenerableDirs } from "./refs";

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
  await warnAboutRestored(marker, exists);
  await rename(marker, path.join(/* turbopackIgnore: true */ root, "manifest.restored.json"));
  console.log(`[backup] restauration détectée : ${requeued} média(s) remis en file pour régénérer leurs variantes${lost ? `, ${lost} sans original (à renvoyer)` : ""}`);
}

/**
 * Lot 85 : ce que la restauration n'a PAS pu remettre. (1) Une archive d'avant le lot (pas de `storage` dans son manifest) ne contient ni
 * les dessins du kit, ni les cadres importés, ni le logo, ni les icônes en image. (2) Dans tous les cas, toute adresse /media/… citée
 * par la base dont le fichier manque du volume et ne se régénère pas. Journal seulement : le site démarre quoi qu'il arrive.
 */
async function warnAboutRestored(marker: string, exists: (key: string) => Promise<boolean>): Promise<void> {
  try {
    const manifest = JSON.parse(await readFile(marker, "utf8")) as { includesMedia?: unknown; storage?: unknown } | null;
    if (manifest && manifest.includesMedia !== false && !manifest.storage) {
      console.warn(
        "[backup] AVERTISSEMENT : cette sauvegarde date d'avant le lot 85 : elle ne contient pas les dessins du kit appliqués aux thèmes, les cadres importés, le logo du thème, les fichiers d'un thème importé ni l'icône du site en image. Les images concernées seront cassées tant qu'elles ne sont pas renvoyées (kit Photoshop, cadres, logo, icône).",
      );
    }
  } catch {
    // manifest illisible ou vide (ex. « {} ») : pas d'avertissement sur l'âge de l'archive
  }
  try {
    const db = getSqlite();
    const rows = db.prepare("select key, variants from media").all() as { key: string; variants: string | null }[];
    const regen = await regenerableDirs(rows, exists);
    const missing: string[] = [];
    for (const key of mediaRefsInDb(db)) if (!isRegenerableKey(key, regen) && !(await exists(key))) missing.push(key);
    for (const n of otherCitedNames(db)) if (!(await stat(path.join(/* turbopackIgnore: true */ dataDir(), n)).catch(() => null))?.isFile()) missing.push(n);
    if (missing.length) {
      missing.sort();
      console.warn(`[backup] AVERTISSEMENT : ${missing.length} fichier(s) cité(s) dans la base manquent après la restauration et ne se régénèrent pas : ${missing.slice(0, 20).join(", ")}${missing.length > 20 ? ", …" : ""}`);
    }
  } catch (error) {
    console.warn("[backup] vérification des fichiers cités impossible :", (error as Error).message);
  }
}
