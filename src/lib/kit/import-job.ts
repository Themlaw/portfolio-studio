/**
 * Import d'un kit PSD rempli (admin) :
 *  - l'envoi par morceaux (kind « kit ») est contrôlé à la fin SANS décodage
 *    (signature 8BPS, en-tête, limites : psd-header.ts), puis rangé dans
 *    ${DATA_DIR}/kit-imports/<id>/source.psd avec meta.json ;
 *  - un job « kit-import » de la file LOURDE (exclusif avec la vidéo et
 *    l'export) lance l'import dans un processus enfant (child.ts) : rapport,
 *    assets convertis et aperçus dans <id>/out ; le PSD est alors supprimé ;
 *  - l'écran de revue lit le rapport ; « Appliquer » (apply.ts) crée une
 *    copie brouillon du thème. Un import est purgé au bout de 7 jours.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { desc, eq } from "drizzle-orm";

import { dataDir, getDb, schema } from "@/lib/db";

import { manifestDir, runKitChild } from "./export-job";
import type { KitReport } from "./import";

/** Durée maximale d'un import (au-delà : processus tué, job en échec). */
const IMPORT_TIMEOUT_MS = Number(process.env.KIT_IMPORT_MAX_DURATION_S || 300) * 1000;
/** Imports gardés par thème (les plus récents). */
export const KEEP_IMPORTS = 5;
const KEEP_MS = 7 * 24 * 3600_000;

export const kitImportsDir = () => path.join(/* turbopackIgnore: true */ dataDir(), "kit-imports");
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isImportId = (id: unknown): id is string => typeof id === "string" && ID.test(id);
export const importDir = (id: string) => path.join(/* turbopackIgnore: true */ kitImportsDir(), id);
export const importOutDir = (id: string) => path.join(/* turbopackIgnore: true */ importDir(id), "out");

export type KitImportMeta = {
  id: string;
  themeId: string;
  userId: string;
  fileName: string;
  size: number;
  createdAt: string;
  /** Copie brouillon créée par « Appliquer au thème ». */
  appliedThemeId?: string | null;
};

export type KitImportState = {
  meta: KitImportMeta;
  status: "queued" | "running" | "done" | "failed";
  error: string | null;
  report: KitReport | null;
};

/** Range le PSD reçu et met l'import en file. */
export async function createKitImport(input: { file: string; themeId: string; userId: string; fileName: string; size: number }, wake: () => void): Promise<KitImportMeta> {
  const id = randomUUID();
  const dir = importDir(id);
  await mkdir(dir, { recursive: true });
  await rename(input.file, path.join(/* turbopackIgnore: true */ dir, "source.psd"));
  const meta: KitImportMeta = { id, themeId: input.themeId, userId: input.userId, fileName: input.fileName, size: input.size, createdAt: new Date().toISOString(), appliedThemeId: null };
  await writeFile(path.join(/* turbopackIgnore: true */ dir, "meta.json"), JSON.stringify(meta));
  getDb().insert(schema.jobs).values({ kind: "kit-import", payload: { importId: id, themeId: input.themeId } }).run();
  wake();
  await pruneImports(input.themeId);
  return meta;
}

export async function readImportMeta(id: string): Promise<KitImportMeta | null> {
  if (!isImportId(id)) return null;
  try {
    return JSON.parse(await readFile(path.join(/* turbopackIgnore: true */ importDir(id), "meta.json"), "utf8")) as KitImportMeta;
  } catch {
    return null;
  }
}

export async function writeImportMeta(meta: KitImportMeta): Promise<void> {
  await writeFile(path.join(/* turbopackIgnore: true */ importDir(meta.id), "meta.json"), JSON.stringify(meta));
}

function jobOf(id: string) {
  return getDb()
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.kind, "kit-import"))
    .orderBy(desc(schema.jobs.id))
    .all()
    .find((j) => j.payload?.importId === id);
}

/**
 * État d'un import (job + rapport). `themeId` : l'import doit appartenir à ce
 * thème (écran de revue, routes, action) ; sinon null, comme un import inconnu.
 */
export async function getKitImport(id: string, themeId?: string): Promise<KitImportState | null> {
  const meta = await readImportMeta(id);
  if (!meta || (themeId !== undefined && meta.themeId !== themeId)) return null;
  const job = jobOf(id);
  let report: KitReport | null = null;
  try {
    report = JSON.parse(await readFile(path.join(/* turbopackIgnore: true */ importOutDir(id), "rapport.json"), "utf8")) as KitReport;
  } catch {
    report = null;
  }
  const status = report ? "done" : ((job?.status ?? "failed") as KitImportState["status"]);
  return { meta, status, error: job?.status === "failed" ? (job.error ?? "L'import a échoué.") : null, report };
}

/** Aperçus « avant » disponibles (manifeste du kit d'origine), par nom de fichier d'emplacement. */
export async function beforePreviews(exportId: string | undefined): Promise<Set<string>> {
  if (!exportId || !/^[a-z0-9-]{1,80}$/.test(exportId)) return new Set();
  const names = await readdir(manifestDir()).catch(() => [] as string[]);
  return new Set(names.filter((n) => n.startsWith(`${exportId}--`) && n.endsWith(".png")).map((n) => n.slice(exportId.length + 2, -4)));
}

/** Imports d'un thème, du plus récent au plus ancien. */
export async function listKitImports(themeId: string): Promise<KitImportMeta[]> {
  const out: KitImportMeta[] = [];
  for (const name of await readdir(kitImportsDir()).catch(() => [] as string[])) {
    const meta = await readImportMeta(name);
    if (meta?.themeId === themeId) out.push(meta);
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Job « kit-import » (file lourde) : import dans un processus enfant, puis suppression du PSD. */
export async function runKitImportJob(job: { id: number; payload: Record<string, unknown> | null }): Promise<void> {
  const db = getDb();
  const finish = (status: "done" | "failed", error: string | null = null) =>
    db.update(schema.jobs).set({ status, error, updatedAt: new Date() }).where(eq(schema.jobs.id, job.id)).run();
  const id = String(job.payload?.importId ?? "");
  const meta = await readImportMeta(id);
  if (!meta) return void finish("failed", "Cet import n'existe plus.");
  const source = path.join(/* turbopackIgnore: true */ importDir(id), "source.psd");
  if (!(await stat(source).catch(() => null))) return void finish("failed", "Le fichier reçu a disparu : renvoie le kit.");
  await mkdir(manifestDir(), { recursive: true });
  const result = await runKitChild({ mode: "import", psd: source, outDir: importOutDir(id), manifestDir: manifestDir(), themeId: meta.themeId }, IMPORT_TIMEOUT_MS);
  await rm(source, { force: true });
  if (!result.ok) {
    console.error(`[kit] import ${id} : échec`, result.error);
    await rm(importOutDir(id), { recursive: true, force: true });
    const message = /trop de temps/.test(result.error ?? "")
      ? "L'import a pris trop de temps : allège le fichier (moins de calques, calques rognés à leur case) et renvoie-le."
      : /mémoire/.test(result.error ?? "")
        ? "Ce fichier demande trop de mémoire à l'import : allège-le (moins de calques, calques rognés à leur case) et renvoie-le."
        : "L'import a échoué. Renvoie le fichier ; si ça recommence, vérifie l'espace disque du serveur.";
    return void finish("failed", message);
  }
  console.log(`[kit] import ${id} (thème ${meta.themeId}) : ${result.ms} ms, pic ${result.peakMb} Mo, oom ${result.oom}`);
  finish("done");
}

/** Garde les KEEP_IMPORTS imports les plus récents d'un thème ; jamais un import en file ou en cours. */
async function pruneImports(themeId: string): Promise<void> {
  for (const old of (await listKitImports(themeId)).slice(KEEP_IMPORTS)) {
    const st = jobOf(old.id)?.status;
    if (st === "queued" || st === "running") continue;
    await rm(importDir(old.id), { recursive: true, force: true });
  }
}

/** Thème supprimé : tous ses imports. */
export async function purgeThemeImports(themeId: string): Promise<void> {
  for (const m of await listKitImports(themeId)) await rm(importDir(m.id), { recursive: true, force: true });
}

/** Imports de plus de 7 jours, et au-delà des 5 derniers d'un thème : supprimés. */
export async function purgeKitImports(): Promise<number> {
  let removed = 0;
  const themes = new Set<string>();
  for (const name of await readdir(kitImportsDir()).catch(() => [] as string[])) {
    const meta = await readImportMeta(name);
    if (meta) themes.add(meta.themeId);
    const age = meta ? Date.now() - Date.parse(meta.createdAt) : Infinity;
    if (age > KEEP_MS) {
      await rm(importDir(name), { recursive: true, force: true });
      removed++;
    }
  }
  for (const t of themes) await pruneImports(t);
  return removed;
}

/**
 * Aperçu PNG d'un emplacement pour la revue : « apres » depuis le dossier de
 * l'import, « avant » depuis le manifeste du kit d'origine. Chemins calculés
 * ici (emplacement de la spec, identifiant du rapport), jamais par le client.
 */
export async function readPreview(id: string, themeId: string, slotId: string, which: "avant" | "apres"): Promise<Buffer | null> {
  const state = await getKitImport(id, themeId);
  if (!state?.report) return null;
  const base = slotId.replace(/\//g, "--");
  let name: string | null = null;
  let dir: string;
  if (which === "apres") {
    const r = state.report.slots.find((s) => s.id === slotId);
    if (!r?.preview) return null;
    name = path.basename(r.preview);
    dir = importOutDir(id);
  } else {
    const ref = state.report.reference?.exportId;
    if (!ref || !/^[a-z0-9-]{1,80}$/.test(ref)) return null;
    name = `${ref}--${base}.png`;
    dir = manifestDir();
  }
  return readFile(path.join(/* turbopackIgnore: true */ dir, name)).catch(() => null);
}
