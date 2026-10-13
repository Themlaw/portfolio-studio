/**
 * Worker de traitements : dans le processus du serveur, deux files séparées,
 * UN job à la fois dans chacune :
 *  - légère : images ;
 *  - lourde : conversions vidéo (ffmpeg), exports et imports de kit PSD
 *    (processus enfant), aperçus de PDF (pdftoppm) : jamais deux à la fois, la mémoire du conteneur ne tiendrait pas
 *    (docs/THEME-KIT.md). Une conversion longue ne bloque pas les images. Exception mémoire : un kit (export ou
 *    import) et une image lourde ne tournent jamais ensemble (memory-gate.ts) ; une image légère passe toujours. Démarré par src/lib/db/start.ts ; les jobs
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

import sharp from "sharp";

import { dataDir, getDb, schema } from "@/lib/db";
import { isHeavyImage } from "@/lib/images/budget";
import { originalFile, processImage, processingError } from "@/lib/images/process";
import { memoryGate } from "@/lib/jobs/memory-gate";
import { getStorage } from "@/lib/storage";
import { videoLimits } from "@/lib/video/limits";
import { transcodeVideo } from "@/lib/video/transcode";
import { notifyMediaChanged } from "@/lib/jobs/notify";
import { runKitJob } from "@/lib/kit/export-job";
import { isImportId, purgeKitImports, removeImportSources, runKitImportJob } from "@/lib/kit/import-job";
import { isPdfTmpName, processPdf } from "@/lib/pdf/render";

const MAX_ATTEMPTS = 3;
/** Délai avant l'essai suivant (après le 1er, le 2e… échec). */
const BACKOFF_MS = [10_000, 60_000, 300_000];
/** Durée maximale d'un traitement d'image ; au-delà, échec définitif. */
const MAX_JOB_MS = Number(process.env.JOB_MAX_DURATION_S || 120) * 1000;
const later = (attempts: number) => new Date(Date.now() + BACKOFF_MS[Math.min(Math.max(attempts, 1), BACKOFF_MS.length) - 1]);
const KIT_INTERRUPTED = "Traitement du kit interrompu (serveur redémarré) : renvoie le fichier ou relance le téléchargement.";
/** Essais d'une image dont le traitement a déjà interrompu le serveur (mémoire ?) : un seul nouvel essai, jamais en boucle. */
const IMAGE_CRASH_ATTEMPTS = 2;
const IMAGE_INTERRUPTED = "Le serveur s'est arrêté pendant le traitement de cette image (probablement faute de mémoire). Réduis-la (moins de pixels) puis renvoie-la, ou touche « Réessayer ».";
const STALLED = "Le traitement ne répond plus. Touche « Réessayer », ou renvoie l'image.";
const GAVE_UP = "Le traitement a échoué plusieurs fois. Supprime le fichier et renvoie-le, ou essaie un autre format.";
/** Purge des envois abandonnés : au démarrage puis toutes les 15 minutes. */
const PURGE_EVERY_MS = 15 * 60_000;
type Lane = "light" | "heavy";
const LANES: Record<Lane, ("image" | "video" | "kit" | "kit-import" | "pdf")[]> = { light: ["image"], heavy: ["video", "kit", "kit-import", "pdf"] };
type State = { busy: Record<Lane, boolean>; started: boolean; timer?: NodeJS.Timeout; /** Jobs en cours dans ce processus (le chien de garde ne les touche pas). */ current: Set<number> };
const G = globalThis as typeof globalThis & { __portfolioJobs2?: State };

function state(): State {
  G.__portfolioJobs2 ??= { busy: { light: false, heavy: false }, started: false, current: new Set() };
  // État d'une version précédente du module (files image / vidéo) : remis à neuf.
  if (!("light" in G.__portfolioJobs2.busy)) G.__portfolioJobs2.busy = { light: false, heavy: false };
  G.__portfolioJobs2.current ??= new Set();
  return G.__portfolioJobs2;
}

export function uploadTmpDir(): string {
  return path.join(/* turbopackIgnore: true */ dataDir(), "tmp");
}

type Job = typeof schema.jobs.$inferSelect;

/** Jobs de cette file prêts à partir, du plus ancien au plus récent (borné). */
function candidates(lane: Lane): Job[] {
  return getDb()
    .select()
    .from(schema.jobs)
    .where(and(inArray(schema.jobs.kind, LANES[lane]), eq(schema.jobs.status, "queued"), or(isNull(schema.jobs.runAfter), lte(schema.jobs.runAfter, new Date()))))
    .orderBy(asc(schema.jobs.id))
    .limit(25)
    .all();
}

/** Prend ce job (atomique : un autre appel a pu le prendre entre-temps) ou null. */
function claimJob(id: number) {
  const db = getDb();
  return db.transaction((tx) => {
    const job = tx.select().from(schema.jobs).where(and(eq(schema.jobs.id, id), eq(schema.jobs.status, "queued"))).get();
    if (!job) return null;
    tx.update(schema.jobs)
      .set({ status: "running", attempts: job.attempts + 1, updatedAt: new Date() })
      .where(eq(schema.jobs.id, job.id))
      .run();
    return { ...job, attempts: job.attempts + 1 };
  });
}

/** Image lourde à traiter ? (en-tête seul : aucune décompression). Illisible : lourde, par prudence. */
async function heavyImageOf(mediaId: number | null): Promise<boolean> {
  if (!mediaId) return false;
  const media = getDb().select().from(schema.media).where(eq(schema.media.id, mediaId)).get();
  if (!media) return false;
  let source: { file: string; cleanup: () => Promise<void> } | null = null;
  try {
    source = await originalFile(media.key);
    const meta = await sharp(source.file, { limitInputPixels: false, failOn: "none", pages: 1, sequentialRead: true }).metadata();
    return isHeavyImage({ ...meta, width: meta.width ?? 0, height: meta.height ?? 0 });
  } catch {
    return true;
  } finally {
    await source?.cleanup();
  }
}

/**
 * Ce job doit-il attendre ? Un kit ne part pas pendant le traitement d'une image lourde, une image lourde
 * ne part pas pendant un kit (ni quand un kit est prêt à partir : pas de famine), mais une image légère
 * passe toujours (src/lib/jobs/memory-gate.ts).
 */
async function mustWait(job: Job): Promise<boolean> {
  const holder = memoryGate().holder();
  if (job.kind === "kit" || job.kind === "kit-import") return holder === "image";
  if (job.kind !== "image") return false;
  const kitReady = !state().busy.heavy && candidates("heavy").some((j) => j.kind === "kit" || j.kind === "kit-import");
  if (holder !== "kit" && !kitReady) return false;
  return heavyImageOf(job.mediaId);
}

/** Prend le plus ancien job de la file qui peut partir maintenant, ou null. */
async function claim(lane: Lane) {
  for (const candidate of candidates(lane)) {
    if (await mustWait(candidate)) continue;
    const job = claimJob(candidate.id);
    if (job) return job;
  }
  return null;
}

/**
 * Marque un job (et son média) en échec ou à retenter. Ne lève jamais : un
 * incident de base ici laisserait sinon le job « running » pour toujours (le
 * chien de garde le reprend alors).
 */
function settleFailure(job: { id: number; mediaId: number | null }, message: string, retryAt: Date | null) {
  try {
    getDb().transaction((tx) => {
      tx.update(schema.jobs)
        .set({ status: retryAt ? "queued" : "failed", error: message, runAfter: retryAt, updatedAt: new Date() })
        .where(eq(schema.jobs.id, job.id))
        .run();
      if (!retryAt && job.mediaId) tx.update(schema.media).set({ status: "failed", error: message }).where(eq(schema.media.id, job.mediaId)).run();
    });
  } catch (error) {
    console.error(`[jobs] job ${job.id} : état d'échec non enregistré`, error);
  }
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
    const work = async () => {
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`traitement : trop de temps (plus de ${MAX_JOB_MS / 1000} s)`)), MAX_JOB_MS);
      });
      return Promise.race([processImage(media.key, hash16), timeout]).finally(() => clearTimeout(timer));
    };
    // Image lourde : jamais en même temps qu'un import ou un export de kit (mémoire du conteneur) ; le délai ne court qu'une fois la porte prise.
    const out = (await heavyImageOf(media.id)) ? await memoryGate().run("image", work) : await work();
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
    settleFailure({ id: job.id, mediaId: media.id }, message, retry ? later(job.attempts) : null);
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

const PDF_FAILED = "L'aperçu de ce PDF n'a pas pu être préparé (fichier abîmé ou trop complexe). Exporte-le de nouveau en PDF standard, puis renvoie-le.";
const PDF_HEAVY = "Ce PDF est trop lourd à afficher (pages trop complexes ou trop longues à rendre). Exporte-le avec des images compressées, puis renvoie-le.";

/**
 * Job « pdf » (file lourde) : pages rendues par pdftoppm dans un processus à
 * part (délai et mémoire bornés), puis variantes d'images (src/lib/pdf/render.ts).
 */
async function runPdfJob(job: { id: number; mediaId: number; attempts: number }) {
  const db = getDb();
  const media = db.select().from(schema.media).where(eq(schema.media.id, job.mediaId)).get();
  if (!media) {
    db.update(schema.jobs).set({ status: "done", updatedAt: new Date() }).where(eq(schema.jobs.id, job.id)).run();
    return;
  }
  const hash16 = media.sha256?.slice(0, 16);
  try {
    if (!hash16) throw new Error(`média sans empreinte : ${media.id}`);
    const out = await processPdf(media.id, media.key, hash16);
    db.transaction((tx) => {
      tx.update(schema.media)
        .set({ status: "ready", error: null, variants: out.variants, width: out.width, height: out.height, dominantColor: null })
        .where(eq(schema.media.id, media.id))
        .run();
      tx.update(schema.jobs).set({ status: "done", error: null, progress: 100, updatedAt: new Date() }).where(eq(schema.jobs.id, job.id)).run();
    });
    console.log(`[jobs] PDF ${media.id} : ${out.pages} page(s) rendue(s) en ${out.stats.renderMs} ms, pdftoppm pic ${out.stats.renderPeakMb} Mo`);
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const message = /trop de temps|mémoire|arrêté/.test(raw) ? PDF_HEAVY : PDF_FAILED;
    console.error(`[jobs] PDF ${media.id} : échec (essai ${job.attempts})`, raw);
    const retry = job.attempts < MAX_ATTEMPTS && /ENOSPC|EIO|EMFILE|EBUSY/.test(raw);
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

async function tick(lane: Lane) {
  const s = state();
  if (s.busy[lane]) return;
  s.busy[lane] = true;
  try {
    reapStalled(lane);
    for (let job = await claim(lane); job; job = await claim(lane)) {
      s.current.add(job.id);
      try {
        await runJob(job);
      } finally {
        s.current.delete(job.id);
      }
    }
  } catch (error) {
    console.error("[jobs] erreur du worker", error);
  } finally {
    s.busy[lane] = false;
  }
}

async function runJob(job: NonNullable<Awaited<ReturnType<typeof claim>>>) {
  try {
    if (job.attempts > MAX_ATTEMPTS) {
      getDb().transaction((tx) => {
        tx.update(schema.jobs).set({ status: "failed", error: GAVE_UP, updatedAt: new Date() }).where(eq(schema.jobs.id, job.id)).run();
        if (job.mediaId) tx.update(schema.media).set({ status: "failed", error: GAVE_UP }).where(eq(schema.media.id, job.mediaId)).run();
      });
    } else if (job.kind === "image" && job.mediaId) await runImageJob({ ...job, mediaId: job.mediaId });
    else if (job.kind === "video" && job.mediaId) await runVideoJob({ ...job, mediaId: job.mediaId });
    else if (job.kind === "pdf" && job.mediaId) await runPdfJob({ ...job, mediaId: job.mediaId });
    else if (job.kind === "kit") await memoryGate().run("kit", () => runKitJob(job));
    else if (job.kind === "kit-import") await memoryGate().run("kit", () => runKitImportJob(job));
    else {
      getDb()
        .update(schema.jobs)
        .set({ status: "failed", error: "type de job non pris en charge", updatedAt: new Date() })
        .where(eq(schema.jobs.id, job.id))
        .run();
    }
  } catch (error) {
    // Exception hors des garde-fous de chaque type de job : jamais « running » pour toujours.
    console.error(`[jobs] job ${job.id} (${job.kind}) : erreur imprévue`, error);
    settleFailure(job, job.kind === "image" ? STALLED : "Le traitement a échoué de façon imprévue : relance-le.", null);
  }
}

/**
 * Chien de garde : un job « running » que ce processus ne traite pas (échec
 * d'écriture en base, ancienne copie du module…) depuis plus de deux fois la
 * durée maximale est mis en échec, média compris : l'artiste voit « Échec » et
 * « Réessayer » au lieu d'un « traitement » éternel.
 */
export function reapStalled(lane: Lane = "light") {
  const s = state();
  const db = getDb();
  const limit = new Date(Date.now() - 2 * MAX_JOB_MS - 60_000);
  if (lane !== "light") return; // les conversions longues (file lourde) ont leurs propres délais
  const stale = db
    .select({ id: schema.jobs.id, mediaId: schema.jobs.mediaId })
    .from(schema.jobs)
    .where(and(inArray(schema.jobs.kind, LANES[lane]), eq(schema.jobs.status, "running"), lt(schema.jobs.updatedAt, limit)))
    .all()
    .filter((j) => !s.current.has(j.id));
  for (const j of stale) {
    console.warn(`[jobs] job ${j.id} resté « running » sans traitement : mis en échec`);
    settleFailure(j, STALLED, null);
  }
}

/** Réveille les deux files (après l'ajout d'un job). */
export function wakeWorker() {
  const g = globalThis as typeof globalThis & { __portfolioGateWake?: boolean };
  if (!g.__portfolioGateWake) {
    g.__portfolioGateWake = true;
    // Porte mémoire libérée : l'autre file relève ce qu'elle avait laissé en attente.
    memoryGate().onRelease(() => {
      void tick("light");
      void tick("heavy");
    });
  }
  void tick("light");
  void tick("heavy");
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
    const file = path.join(/* turbopackIgnore: true */ dir, entry.name);
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
  for (const u of stale) await rm(path.join(/* turbopackIgnore: true */ uploadTmpDir(), "uploads", `${u.id}.part`), { force: true });
  if (stale.length) console.log(`[jobs] ${stale.length} envoi(s) abandonné(s) purgé(s)`);
  // Fichiers partiels sans ligne (ligne supprimée, base restaurée…) : même délai.
  const known = new Set(getDb().select({ id: schema.uploads.id }).from(schema.uploads).all().map((u) => u.id));
  const partsDir = path.join(/* turbopackIgnore: true */ uploadTmpDir(), "uploads");
  for (const name of await readdir(partsDir).catch(() => [] as string[])) {
    const id = name.replace(/\.part$/, "");
    if (known.has(id)) continue;
    const info = await stat(path.join(/* turbopackIgnore: true */ partsDir, name)).catch(() => null);
    if (info && Date.now() - info.mtimeMs > UPLOAD_TTL_MS) await rm(path.join(/* turbopackIgnore: true */ partsDir, name), { force: true });
  }
  const kits = await purgeKitImports();
  if (kits) console.log(`[jobs] ${kits} import(s) de kit de plus de 7 jours purgé(s)`);
  const a = await purgeOld(uploadTmpDir(), () => true, false);
  const b = await purgeOld(path.join(/* turbopackIgnore: true */ dataDir(), "media"), (n) => n.endsWith(".tmp"), true);
  if (a + b) console.log(`[jobs] ${a + b} fichier(s) temporaire(s) abandonné(s) supprimé(s)`);
  return a + b;
}

export async function startWorker() {
  const s = state();
  if (s.started) return;
  s.started = true;
  const db = getDb();
  // Export ou import de kit interrompu (le serveur a pu tomber À CAUSE de ce
  // fichier) : pas de nouvel essai automatique, échec lisible, PSD supprimé.
  const kitDead = db
    .update(schema.jobs)
    .set({ status: "failed", error: KIT_INTERRUPTED, updatedAt: new Date() })
    .where(and(eq(schema.jobs.status, "running"), inArray(schema.jobs.kind, ["kit", "kit-import"])))
    .returning({ kind: schema.jobs.kind, payload: schema.jobs.payload })
    .all();
  for (const j of kitDead) {
    const importId = j.kind === "kit-import" ? j.payload?.importId : null;
    if (isImportId(importId)) await removeImportSources(importId);
  }
  if (kitDead.length) console.warn(`[jobs] ${kitDead.length} job(s) de kit interrompu(s) : en échec, sans nouvel essai`);
  // Jobs interrompus (processus arrêté pendant un traitement) : remis en file
  // tant qu'il reste des essais ; sinon échec définitif, média compris (il
  // reste supprimable).
  // Une image dont le traitement a déjà coupé le serveur une fois (mémoire) : pas de boucle de
  // plantages, échec lisible avec « Réessayer » (un nouvel essai se fait à la demande).
  const crashed = db.transaction((tx) => {
    const dead = tx
      .update(schema.jobs)
      .set({ status: "failed", error: IMAGE_INTERRUPTED, updatedAt: new Date() })
      .where(and(eq(schema.jobs.status, "running"), eq(schema.jobs.kind, "image"), gte(schema.jobs.attempts, IMAGE_CRASH_ATTEMPTS)))
      .returning({ mediaId: schema.jobs.mediaId })
      .all();
    for (const j of dead) {
      if (j.mediaId) tx.update(schema.media).set({ status: "failed", error: IMAGE_INTERRUPTED }).where(eq(schema.media.id, j.mediaId)).run();
    }
    return dead.length;
  });
  if (crashed) console.warn(`[jobs] ${crashed} image(s) en échec : le serveur s'était arrêté pendant leur traitement`);
  const exhausted = db.transaction((tx) => {
    const dead = tx
      .update(schema.jobs)
      .set({ status: "failed", error: GAVE_UP, updatedAt: new Date() })
      .where(and(eq(schema.jobs.status, "running"), gte(schema.jobs.attempts, MAX_ATTEMPTS)))
      .returning({ mediaId: schema.jobs.mediaId })
      .all();
    for (const j of dead) {
      if (j.mediaId) tx.update(schema.media).set({ status: "failed", error: GAVE_UP }).where(eq(schema.media.id, j.mediaId)).run();
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
    if (/^video-\d+-\d+$/.test(name) || isPdfTmpName(name)) await rm(path.join(/* turbopackIgnore: true */ uploadTmpDir(), name), { recursive: true, force: true });
  }
  await purgeTmp();
  s.timer = setInterval(() => wakeWorker(), 2000);
  s.timer.unref();
  setInterval(() => void purgeTmp(), PURGE_EVERY_MS).unref();
  wakeWorker();
}
