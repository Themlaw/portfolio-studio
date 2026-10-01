/**
 * Worker de traitements (images ; vidéo en phase 5) : dans le processus du
 * serveur, UN job à la fois. Démarré par src/lib/db/start.ts ; les jobs
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
import { processImage, processingError } from "@/lib/images/process";
import { notifyMediaChanged } from "@/lib/jobs/notify";

const MAX_ATTEMPTS = 3;
/** Délai avant l'essai suivant (après le 1er, le 2e… échec). */
const BACKOFF_MS = [10_000, 60_000, 300_000];
/** Durée maximale d'un traitement d'image ; au-delà, échec définitif. */
const MAX_JOB_MS = Number(process.env.JOB_MAX_DURATION_S || 120) * 1000;
const later = (attempts: number) => new Date(Date.now() + BACKOFF_MS[Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1]);
const GAVE_UP = "Le traitement a échoué plusieurs fois. Supprime l'image et renvoie-la, ou essaie un autre format.";
/** Purge des envois abandonnés : au démarrage puis toutes les 15 minutes. */
const PURGE_EVERY_MS = 15 * 60_000;
type State = { busy: boolean; started: boolean; timer?: NodeJS.Timeout };
const G = globalThis as typeof globalThis & { __portfolioJobs?: State };

function state(): State {
  G.__portfolioJobs ??= { busy: false, started: false };
  return G.__portfolioJobs;
}

export function uploadTmpDir(): string {
  return path.join(dataDir(), "tmp");
}

/** Prend le plus ancien job en file (atomique) ou null. */
function claim() {
  const db = getDb();
  return db.transaction((tx) => {
    const job = tx
      .select()
      .from(schema.jobs)
      .where(and(eq(schema.jobs.status, "queued"), or(isNull(schema.jobs.runAfter), lte(schema.jobs.runAfter, new Date()))))
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

async function tick() {
  const s = state();
  if (s.busy) return;
  s.busy = true;
  try {
    for (let job = claim(); job; job = claim()) {
      if (job.attempts > MAX_ATTEMPTS) {
        getDb().transaction((tx) => {
          tx.update(schema.jobs).set({ status: "failed", error: GAVE_UP, updatedAt: new Date() }).where(eq(schema.jobs.id, job.id)).run();
          tx.update(schema.media).set({ status: "failed", error: GAVE_UP }).where(eq(schema.media.id, job.mediaId)).run();
        });
      } else if (job.kind === "image") await runImageJob(job);
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
    s.busy = false;
  }
}

/** Réveille le worker (après l'ajout d'un job). */
export function wakeWorker() {
  void tick();
}

const PURGE_AGE_MS = 3600_000;

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
  await purgeTmp();
  s.timer = setInterval(() => void tick(), 2000);
  s.timer.unref();
  setInterval(() => void purgeTmp(), PURGE_EVERY_MS).unref();
  void tick();
}
