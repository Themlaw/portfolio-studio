/**
 * Worker de traitements : dans le processus du serveur, deux files séparées
 * (images, vidéos), UN job à la fois dans chacune : une conversion vidéo
 * longue ne bloque pas les images. Démarré par src/lib/db/start.ts ; les jobs
 * `running` laissés par un arrêt brutal sont remis en file au démarrage.
 *
 * Next charge parfois ce module plusieurs fois (instrumentation, routes) :
 * l'état est rangé sur globalThis et la base reste la seule source de vérité.
 * Une route qui ajoute un job appelle wakeWorker() ; sinon le worker relève la
 * file toutes les 2 s.
 */
import { and, asc, eq, gte, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import { dataDir, getDb, schema } from "@/lib/db";
import { originalFile, processImage, processingError } from "@/lib/images/process";
import { getStorage } from "@/lib/storage";
import { videoLimits } from "@/lib/video/limits";
import { transcodeVideo } from "@/lib/video/transcode";
import { notifyMediaChanged } from "@/lib/jobs/notify";

const MAX_ATTEMPTS = 3;
/** Délai avant l'essai suivant (après le 1er, le 2e… échec). */
const BACKOFF_MS = [10_000, 60_000, 300_000];
/** Durée maximale d'un traitement d'image ; au-delà, échec définitif. */
const MAX_JOB_MS = Number(process.env.JOB_MAX_DURATION_S || 120) * 1000;
const later = (attempts: number) => new Date(Date.now() + BACKOFF_MS[Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1]);
const GAVE_UP = "Le traitement a échoué plusieurs fois. Supprime le fichier et renvoie-le, ou essaie un autre format.";
/** Purge des envois abandonnés : au démarrage puis toutes les 15 minutes. */
const PURGE_EVERY_MS = 15 * 60_000;
type Kind = "image" | "video";
type State = { busy: Record<Kind, boolean>; started: boolean; timer?: NodeJS.Timeout };
const G = globalThis as typeof globalThis & { __portfolioJobs2?: State };

function state(): State {
  G.__portfolioJobs2 ??= { busy: { image: false, video: false }, started: false };
  return G.__portfolioJobs2;
}

export function uploadTmpDir(): string {
  return path.join(dataDir(), "tmp");
}

/** Prend le plus ancien job en file de ce type (atomique) ou null. */
function claim(kind: Kind) {
  const db = getDb();
  return db.transaction((tx) => {
    const job = tx
      .select()
      .from(schema.jobs)
      .where(and(eq(schema.jobs.kind, kind), eq(schema.jobs.status, "queued"), or(isNull(schema.jobs.runAfter), lte(schema.jobs.runAfter, new Date()))))
      .orderBy(asc(schema.jobs.id))
      .get();
    if (!job) return null;
    tx.update(schema.jobs)
      .set({ status: "running", attempts: job.attempts + 1, updatedAt: new Date() })
      .where(eq(schema.jobs.id, job.id))
      .run();
    return { ...job, attempts: job.attempts + 1 };
  });
}

async function runImageJob(job: { id: number; mediaId: number; attempts: number }) {
  const db = getDb();
  const media = db.select().from(schema.media).where(eq(schema.media.id, job.mediaId)).get();
  if (!media) {
    db.update(schema.jobs).set({ status: "done", updatedAt: new Date() }).where(eq(schema.jobs.id, job.id)).run();
    return;
  }
  const hash16 = media.sha256?.slice(0, 16) ?? /^originals\/([0-9a-f]{16})/.exec(media.key)?.[1];
  const started = Date.now();
  try {
    if (!hash16) throw new Error(`clé d'original inattendue : ${media.key}`);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`traitement : trop de temps (plus de ${MAX_JOB_MS / 1000} s)`)), MAX_JOB_MS);
    });
    const out = await Promise.race([processImage(media.key, hash16), timeout]).finally(() => clearTimeout(timer));
    db.transaction((tx) => {
      tx.update(schema.media)
        .set({ status: "ready", error: null, variants: out.variants, dominantColor: out.dominantColor })
        .where(eq(schema.media.id, media.id))
        .run();
      tx.update(schema.jobs).set({ status: "done", error: null, updatedAt: new Date() }).where(eq(schema.jobs.id, job.id)).run();
    });
    console.log(`[jobs] image ${media.id} traitée en ${Date.now() - started} ms (${out.variants.files.length} variantes)`);
  } catch (error) {
    const message = processingError(error);
    console.error(`[jobs] image ${media.id} : échec (essai ${job.attempts})`, error instanceof Error ? error.message : error);
    // Une image illisible le restera : pas de nouvel essai. Seul un incident
    // passager du disque est retenté, jusqu'à MAX_ATTEMPTS.
    const retry = job.attempts < MAX_ATTEMPTS && /ENOSPC|EIO|EMFILE|EBUSY/.test(String(error));
    db.transaction((tx) => {
      tx.update(schema.jobs)
        .set({ status: retry ? "queued" : "failed", error: message, runAfter: retry ? later(job.attempts) : null, updatedAt: new Date() })
        .where(eq(schema.jobs.id, job.id))
        .run();
      if (!retry) tx.update(schema.media).set({ status: "failed", error: message }).where(eq(schema.media.id, media.id)).run();
    });
  }
  await notifyMediaChanged(media.id);
}

const VIDEO_FAILED = "La vidéo n'a pas pu être convertie (fichier abîmé ou codec non pris en charge). Exporte-la de nouveau en MP4 (H.264) puis renvoie-la.";
const VIDEO_TOO_LONG = "La conversion a pris trop de temps. Raccourcis ou réduis la vidéo, puis renvoie-la.";
const VIDEO_OOM = "La conversion a manqué de mémoire. Exporte la vidéo en 1080p au plus, puis renvoie-la.";

async function runVideoJob(job: { id: number; mediaId: number; attempts: number }) {
  const db = getDb();
  const media = db.select().from(schema.media).where(eq(schema.media.id, job.mediaId)).get();
  if (!media) {
    db.update(schema.jobs).set({ status: "done", updatedAt: new Date() }).where(eq(schema.jobs.id, job.id)).run();
    return;
  }
  const hash16 = media.sha256?.slice(0, 16);
  let lastWrite = 0;
  const onProgress = (p: number) => {
    if (Date.now() - lastWrite < 1000 && p < 100) return;
    lastWrite = Date.now();
    db.update(schema.jobs).set({ progress: p }).where(eq(schema.jobs.id, job.id)).run();
  };
  let source: { file: string; cleanup: () => Promise<void> } | null = null;
  try {
    if (!hash16) throw new Error(`média sans empreinte : ${media.id}`);
    source = await originalFile(media.key);
    const container = media.mime === "video/webm" ? "matroska" : "mov";
    const { result, stats } = await transcodeVideo({ file: source.file, container, hash16, jobId: job.id }, onProgress);
    db.transaction((tx) => {
      tx.update(schema.media)
        .set({
          status: "ready",
          error: null,
          variants: { v: 1, files: result.files, originalRemoved: !videoLimits().keepOriginals },
          dominantColor: result.posterColor,
          duration: result.duration,
          hasAudio: result.hasAudio,
          width: result.width,
          height: result.height,
        })
        .where(eq(schema.media.id, media.id))
        .run();
      tx.update(schema.jobs).set({ status: "done", error: null, progress: 100, updatedAt: new Date() }).where(eq(schema.jobs.id, job.id)).run();
    });
    const sizes = result.files.map((f) => `${f.key.split("/").pop()} ${(f.size / 1024 / 1024).toFixed(1)} Mo`).join(", ");
    console.log(`[jobs] vidéo ${media.id} convertie en ${stats.wallSeconds} s : ffmpeg pic ${stats.peakRssMb} Mo, CPU ${stats.cpuSeconds} s ; ${sizes}`);
    if (!videoLimits().keepOriginals) {
      await source.cleanup();
      source = null;
      await getStorage().delete(media.key).catch(() => {});
      console.log(`[jobs] vidéo ${media.id} : original supprimé (KEEP_VIDEO_ORIGINALS=false)`);
    }
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const message = /trop de temps/.test(raw) ? VIDEO_TOO_LONG : /mémoire insuffisante/.test(raw) ? VIDEO_OOM : VIDEO_FAILED;
    console.error(`[jobs] vidéo ${media.id} : échec (essai ${job.attempts})`, raw);
    const retry = job.attempts < MAX_ATTEMPTS && /ENOSPC|EIO|EMFILE|EBUSY/.test(raw);
    db.transaction((tx) => {
      tx.update(schema.jobs)
        .set({ status: retry ? "queued" : "failed", error: message, runAfter: retry ? later(job.attempts) : null, updatedAt: new Date() })
        .where(eq(schema.jobs.id, job.id))
        .run();
      if (!retry) tx.update(schema.media).set({ status: "failed", error: message }).where(eq(schema.media.id, media.id)).run();
    });
  } finally {
    await source?.cleanup();
  }
  await notifyMediaChanged(media.id);
}

async function tick(kind: Kind) {
  const s = state();
  if (s.busy[kind]) return;
  s.busy[kind] = true;
  try {
    for (let job = claim(kind); job; job = claim(kind)) {
      if (job.attempts > MAX_ATTEMPTS) {
        getDb().transaction((tx) => {
          tx.update(schema.jobs).set({ status: "failed", error: GAVE_UP, updatedAt: new Date() }).where(eq(schema.jobs.id, job.id)).run();
          tx.update(schema.media).set({ status: "failed", error: GAVE_UP }).where(eq(schema.media.id, job.mediaId)).run();
        });
      } else if (job.kind === "image") await runImageJob(job);
      else if (job.kind === "video") await runVideoJob(job);
      else {
        getDb()
          .update(schema.jobs)
          .set({ status: "failed", error: "type de job non pris en charge", updatedAt: new Date() })
          .where(eq(schema.jobs.id, job.id))
          .run();
      }
    }
  } catch (error) {
    console.error("[jobs] erreur du worker", error);
  } finally {
    s.busy[kind] = false;
  }
}

/** Réveille les deux files (après l'ajout d'un job). */
export function wakeWorker() {
  void tick("image");
  void tick("video");
}

const PURGE_AGE_MS = 3600_000;
/** Un envoi par morceaux sans nouvelle depuis 24 h est abandonné. */
const UPLOAD_TTL_MS = 24 * 3600_000;

async function purgeOld(dir: string, match: (name: string) => boolean, recursive: boolean): Promise<number> {
  let removed = 0;
  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0; // dossier absent : rien à purger
  }
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) removed += await purgeOld(file, match, true);
      continue;
    }
    if (!entry.isFile() || !match(entry.name)) continue;
    const info = await stat(file).catch(() => null);
    if (info && Date.now() - info.mtimeMs > PURGE_AGE_MS) {
      await rm(file, { force: true });
      removed++;
    }
  }
  return removed;
}

/**
 * Fichiers abandonnés depuis plus d'une heure : envois interrompus
 * (${DATA_DIR}/tmp) et écritures atomiques inachevées du stockage (*.tmp).
 */
export async function purgeTmp(): Promise<number> {
  // Envois par morceaux sans nouvelle depuis 24 h : ligne et fichier partiel.
  const stale = getDb()
    .delete(schema.uploads)
    .where(lt(schema.uploads.updatedAt, new Date(Date.now() - UPLOAD_TTL_MS)))
    .returning({ id: schema.uploads.id })
    .all();
  for (const u of stale) await rm(path.join(uploadTmpDir(), "uploads", `${u.id}.part`), { force: true });
  if (stale.length) console.log(`[jobs] ${stale.length} envoi(s) abandonné(s) purgé(s)`);
  // Fichiers partiels sans ligne (ligne supprimée, base restaurée…) : même délai.
  const known = new Set(getDb().select({ id: schema.uploads.id }).from(schema.uploads).all().map((u) => u.id));
  const partsDir = path.join(uploadTmpDir(), "uploads");
  for (const name of await readdir(partsDir).catch(() => [] as string[])) {
    const id = name.replace(/\.part$/, "");
    if (known.has(id)) continue;
    const info = await stat(path.join(partsDir, name)).catch(() => null);
    if (info && Date.now() - info.mtimeMs > UPLOAD_TTL_MS) await rm(path.join(partsDir, name), { force: true });
  }
  const a = await purgeOld(uploadTmpDir(), () => true, false);
  const b = await purgeOld(path.join(dataDir(), "media"), (n) => n.endsWith(".tmp"), true);
  if (a + b) console.log(`[jobs] ${a + b} fichier(s) temporaire(s) abandonné(s) supprimé(s)`);
  return a + b;
}

export async function startWorker() {
  const s = state();
  if (s.started) return;
  s.started = true;
  const db = getDb();
  // Jobs interrompus (processus arrêté pendant un traitement) : remis en file
  // tant qu'il reste des essais ; sinon échec définitif, média compris (il
  // reste supprimable).
  const exhausted = db.transaction((tx) => {
    const dead = tx
      .update(schema.jobs)
      .set({ status: "failed", error: GAVE_UP, updatedAt: new Date() })
      .where(and(eq(schema.jobs.status, "running"), gte(schema.jobs.attempts, MAX_ATTEMPTS)))
      .returning({ mediaId: schema.jobs.mediaId })
      .all();
    for (const j of dead) {
      tx.update(schema.media).set({ status: "failed", error: GAVE_UP }).where(eq(schema.media.id, j.mediaId)).run();
    }
    return dead.length;
  });
  if (exhausted) console.warn(`[jobs] ${exhausted} job(s) abandonné(s) après ${MAX_ATTEMPTS} essais interrompus`);
  const orphans = db
    .update(schema.jobs)
    .set({ status: "queued", runAfter: new Date(Date.now() + BACKOFF_MS[0]), updatedAt: new Date() })
    .where(and(eq(schema.jobs.status, "running"), lt(schema.jobs.attempts, MAX_ATTEMPTS)))
    .returning({ id: schema.jobs.id })
    .all();
  if (orphans.length) console.warn(`[jobs] ${orphans.length} job(s) interrompu(s) remis en file`);
  // Médias restés « processing » sans job actif (base restaurée…) : échec lisible.
  const active = db.select({ mediaId: schema.jobs.mediaId }).from(schema.jobs).where(inArray(schema.jobs.status, ["queued", "running"])).all();
  const stuck = db
    .select({ id: schema.media.id })
    .from(schema.media)
    .where(eq(schema.media.status, "processing"))
    .all()
    .filter((m) => !active.some((a) => a.mediaId === m.id));
  for (const m of stuck) {
    db.update(schema.media)
      .set({ status: "failed", error: "Traitement interrompu : envoie l'image de nouveau." })
      .where(eq(schema.media.id, m.id))
      .run();
  }
  // Dossiers de conversion laissés par un arrêt brutal : plus aucun job ne tourne.
  for (const name of await readdir(uploadTmpDir()).catch(() => [] as string[])) {
    if (/^video-\d+-\d+$/.test(name)) await rm(path.join(uploadTmpDir(), name), { recursive: true, force: true });
  }
  await purgeTmp();
  s.timer = setInterval(() => wakeWorker(), 2000);
  s.timer.unref();
  setInterval(() => void purgeTmp(), PURGE_EVERY_MS).unref();
  wakeWorker();
}
