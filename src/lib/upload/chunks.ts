/**
 * Envoi par morceaux, reprenable (vidéos, grandes images) :
 *   init → identifiant ; chunk(offset) écrit exactement à l'offset attendu ;
 *   status → offset courant (reprise) ; complete → détection et job ; cancel.
 * Fichier partiel : ${DATA_DIR}/tmp/uploads/<id>.part. Quota vérifié à init
 * (taille annoncée réservée) et à chaque morceau. Un envoi sans nouvelle
 * depuis 24 h est purgé par le worker.
 */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { dataDir, getDb, schema } from "@/lib/db";
import { CHUNK_BYTES, videoLimits } from "@/lib/video/limits";
import { ingestVideo } from "@/lib/video/ingest";

import { attachUploadTags, parseTagLabels, tagCapacityProblem } from "@/lib/tags";

import { wakeWorker } from "@/lib/jobs/worker";
import { loadSavedTheme } from "@/lib/kit/export-job";
import { DEFAULT_LIMITS } from "@/lib/kit/limits";
import { createKitImport } from "@/lib/kit/import-job";
import { preflightProblem, preflightPsd, PsdPreflightError } from "@/lib/kit/psd-header";

import { ingestImage, type IngestedMedia } from "./ingest";
import { quotaProblem } from "./quota";
import { cleanFilename, sniffImage, sniffVideo, SNIFF_BYTES, VIDEO_REJECTED_MESSAGE } from "./sniff";
import { maxImageBytes, UploadError } from "./receive";

const partDir = () => path.join(/* turbopackIgnore: true */ dataDir(), "tmp", "uploads");
const partPath = (id: string) => path.join(/* turbopackIgnore: true */ partDir(), `${id}.part`);

const InitSchema = z.strictObject({
  name: z.string().max(300),
  size: z.number().int().positive(),
  type: z.string().max(100),
  /** Tags du fichier : gardés sur l'envoi, attachés au média à sa création. */
  tags: z.unknown().optional(),
  /** Kit de thème (PSD) : jamais un média, rangé pour l'import du thème visé. */
  purpose: z.strictObject({ kind: z.literal("kit"), themeId: z.string().regex(/^[a-z0-9-]{1,80}$/) }).optional(),
});

const Id = z.string().uuid();

/** Un morceau à la fois par envoi (deux PUT simultanés : le second attend son tour… et échoue sur l'offset). */
const G = globalThis as typeof globalThis & { __portfolioUploadLocks?: Set<string> };
const locks = () => (G.__portfolioUploadLocks ??= new Set());

/** Envoi de CET administrateur (un autre n'y a pas accès : même réponse qu'un envoi inconnu). */
function row(id: unknown, userId: string) {
  const parsed = Id.safeParse(id);
  if (!parsed.success) throw new UploadError(404, "Envoi introuvable : recommence l'envoi.");
  const r = getDb().select().from(schema.uploads).where(eq(schema.uploads.id, parsed.data)).get();
  if (!r || r.userId !== userId) throw new UploadError(404, "Envoi introuvable ou expiré : recommence l'envoi.");
  return r;
}

export type UploadStatus = { id: string; name: string; size: number; offset: number; kind: "image" | "video" | "kit"; chunkSize: number };

/** Kit PSD : extension .psd, taille du kit au plus (refus AVANT l'envoi), thème existant. */
function kitProblem(name: string, size: number, themeId: string): UploadError | null {
  if (!/\.psd$/i.test(name)) return new UploadError(415, "Choisis le fichier Photoshop du kit (.psd).");
  if (size > DEFAULT_LIMITS.maxFileBytes) return new UploadError(413, `Ce fichier fait ${Math.round(size / 1024 / 1024)} Mo : ${Math.round(DEFAULT_LIMITS.maxFileBytes / 1024 / 1024)} Mo au plus. Supprime les calques inutiles (ou fusionne-les), puis réenregistre.`);
  if (!loadSavedTheme(themeId)) return new UploadError(404, "Ce thème n'existe plus.");
  return null;
}

export async function initUpload(input: unknown, userId: string): Promise<UploadStatus> {
  const parsed = InitSchema.safeParse(input);
  if (!parsed.success) throw new UploadError(400, "Requête invalide.");
  const { size, type, purpose } = parsed.data;
  const name = cleanFilename(parsed.data.name);
  if (purpose) {
    const problem = kitProblem(name, size, purpose.themeId);
    if (problem) throw problem;
    const full = quotaProblem(size);
    if (full) throw new UploadError(507, full);
    const id = randomUUID();
    await mkdir(partDir(), { recursive: true });
    await (await open(partPath(id), "wx")).close();
    getDb().insert(schema.uploads).values({ id, name, size, declaredType: type.slice(0, 100), kind: "kit", target: purpose.themeId, offset: 0, userId, tags: [] }).run();
    return { id, name, size, offset: 0, kind: "kit", chunkSize: CHUNK_BYTES };
  }
  const tags = parseTagLabels(parsed.data.tags ?? []);
  if (!tags.ok) throw new UploadError(400, tags.message);
  const tagsFull = tagCapacityProblem(tags.labels);
  if (tagsFull) throw new UploadError(422, tagsFull);
  const kind: "image" | "video" = type.startsWith("video/") || /\.(mp4|mov|m4v|webm|mkv)$/i.test(name) ? "video" : "image";
  const max = kind === "video" ? videoLimits().maxBytes : maxImageBytes();
  if (size > max) {
    throw new UploadError(
      413,
      kind === "video"
        ? `Cette vidéo dépasse ${Math.round(max / 1024 / 1024)} Mo : réduis-la avant de l'envoyer.`
        : `Ce fichier dépasse ${Math.round(max / 1024 / 1024)} Mo : réduis-le avant de l'envoyer.`,
    );
  }
  const full = quotaProblem(size);
  if (full) throw new UploadError(507, full);
  const id = randomUUID();
  await mkdir(partDir(), { recursive: true });
  await (await open(partPath(id), "wx")).close();
  getDb().insert(schema.uploads).values({ id, name, size, declaredType: type.slice(0, 100), kind, offset: 0, userId, tags: tags.labels }).run();
  return { id, name, size, offset: 0, kind, chunkSize: CHUNK_BYTES };
}

export function uploadStatus(id: unknown, userId: string): UploadStatus {
  const r = row(id, userId);
  return { id: r.id, name: r.name, size: r.size, offset: r.offset, kind: r.kind, chunkSize: CHUNK_BYTES };
}

export async function writeChunk(id: unknown, offsetParam: string | null, request: Request, userId: string): Promise<UploadStatus> {
  const r = row(id, userId);
  if (!offsetParam || !/^\d{1,15}$/.test(offsetParam)) throw new UploadError(400, "Offset manquant ou invalide.");
  const offset = Number(offsetParam);
  if (offset !== r.offset) {
    throw new UploadError(409, `Morceau hors de place : l'envoi reprend à l'octet ${r.offset}.`);
  }
  const length = Number(request.headers.get("content-length") || -1);
  if (!Number.isInteger(length) || length <= 0 || length > CHUNK_BYTES) throw new UploadError(400, `Morceau invalide : ${CHUNK_BYTES / 1024 / 1024} Mo au plus, taille annoncée.`);
  if (offset + length > r.size) throw new UploadError(400, "Morceau au-delà de la taille annoncée.");
  if (!request.body) throw new UploadError(400, "Morceau vide.");
  // Quota : la réservation de cet envoi est déjà comptée ; un autre ajout a
  // pu remplir l'espace depuis.
  const full = quotaProblem(0);
  if (full) throw new UploadError(507, full);
  if (locks().has(r.id)) throw new UploadError(409, `Un morceau est déjà en cours d'écriture : l'envoi reprend à l'octet ${r.offset}.`);
  locks().add(r.id);
  try {
    // Le fichier doit faire exactement `offset` octets (reprise après coupure).
    const file = partPath(r.id);
    const onDisk = (await stat(file)).size;
    if (onDisk !== offset) {
      const h = await open(file, "r+");
      await h.truncate(offset);
      await h.close();
    }
    let received = 0;
    const counter = new (await import("node:stream")).Transform({
      transform(chunk: Buffer, _enc, cb) {
        received += chunk.length;
        if (received > length) return cb(new UploadError(400, "Morceau plus long qu'annoncé."));
        cb(null, chunk);
      },
    });
    try {
      await pipeline(Readable.fromWeb(request.body as import("node:stream/web").ReadableStream), counter, createWriteStream(file, { flags: "r+", start: offset }));
    } catch (error) {
      // Morceau incomplet : on revient à l'offset confirmé.
      const h = await open(file, "r+");
      await h.truncate(offset);
      await h.close();
      throw error instanceof UploadError ? error : new UploadError(400, "Morceau interrompu : l'envoi reprendra à l'octet " + offset + ".");
    }
    if (received !== length) {
      const h = await open(file, "r+");
      await h.truncate(offset);
      await h.close();
      throw new UploadError(400, "Morceau incomplet.");
    }
    const next = offset + received;
    getDb().update(schema.uploads).set({ offset: next, updatedAt: new Date() }).where(eq(schema.uploads.id, r.id)).run();
    return { id: r.id, name: r.name, size: r.size, offset: next, kind: r.kind, chunkSize: CHUNK_BYTES };
  } finally {
    locks().delete(r.id);
  }
}

/**
 * Fin d'envoi. `tagsInput` : tags courants du client (une reprise a pu les
 * changer depuis init), validés comme à init ; absents : ceux d'init.
 */
export type CompletedUpload = { media: IngestedMedia & { kind: "image" | "video"; tagWarning?: string } } | { kitImport: { id: string; themeId: string } };

export async function completeUpload(id: unknown, userId: string, tagsInput?: unknown): Promise<CompletedUpload> {
  const r = row(id, userId);
  if (r.kind === "kit") return { kitImport: await completeKit(r, userId) };
  let tags = r.tags ?? [];
  if (tagsInput !== undefined) {
    const parsed = parseTagLabels(tagsInput);
    if (!parsed.ok) throw new UploadError(400, parsed.message);
    tags = parsed.labels;
  }
  const media = await ingestCompleted(r);
  const tagWarning = attachUploadTags(media.id, tags);
  return { media: tagWarning ? { ...media, tagWarning } : media };
}

/**
 * Fin d'un envoi de kit : signature et en-tête contrôlés SANS décodage
 * (psd-header.ts : PSB, RVB, 8 bits, dimensions, calques), puis import en file.
 */
async function completeKit(r: typeof schema.uploads.$inferSelect, userId: string): Promise<{ id: string; themeId: string }> {
  if (r.offset !== r.size) throw new UploadError(409, `Envoi incomplet : ${r.offset} octets reçus sur ${r.size}.`);
  const file = partPath(r.id);
  getDb().delete(schema.uploads).where(eq(schema.uploads.id, r.id)).run();
  const reject = async (status: number, message: string): Promise<never> => {
    await rm(file, { force: true });
    throw new UploadError(status, message);
  };
  const themeId = r.target ?? "";
  if (!loadSavedTheme(themeId)) return reject(404, "Ce thème n'existe plus.");
  let pre: Awaited<ReturnType<typeof preflightPsd>>;
  try {
    pre = await preflightPsd(file, DEFAULT_LIMITS.maxLayers * 4);
  } catch (error) {
    return reject(415, error instanceof PsdPreflightError ? `${error.message} Enregistre le kit depuis Photoshop au format PSD.` : "Fichier illisible : enregistre le kit depuis Photoshop au format PSD.");
  }
  const problem = preflightProblem(pre, DEFAULT_LIMITS);
  if (problem) return reject(422, problem);
  const meta = await createKitImport({ file, themeId, userId, fileName: r.name, size: r.size }, wakeWorker);
  return { id: meta.id, themeId };
}

async function ingestCompleted(r: typeof schema.uploads.$inferSelect): Promise<IngestedMedia & { kind: "image" | "video" }> {
  if (r.offset !== r.size) throw new UploadError(409, `Envoi incomplet : ${r.offset} octets reçus sur ${r.size}.`);
  const file = partPath(r.id);
  // L'envoi est clos : sa réservation disparaît, le contenu fait foi.
  getDb().delete(schema.uploads).where(eq(schema.uploads.id, r.id)).run();
  const hash = createHash("sha256");
  const head: Buffer[] = [];
  let headLen = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk as Buffer);
    if (headLen < SNIFF_BYTES) {
      head.push((chunk as Buffer).subarray(0, SNIFF_BYTES - headLen));
      headLen += Math.min((chunk as Buffer).length, SNIFF_BYTES - headLen);
    }
  }
  const received = { tmpPath: file, size: r.size, sha256: hash.digest("hex"), head: new Uint8Array(Buffer.concat(head)), filename: r.name };
  if (sniffVideo(received.head)) return { ...(await ingestVideo(received)), kind: "video" };
  if (sniffImage(received.head)) {
    if (r.size > maxImageBytes()) {
      await rm(file, { force: true });
      throw new UploadError(413, `Cette image dépasse ${Math.round(maxImageBytes() / 1024 / 1024)} Mo : réduis-la avant de l'envoyer.`);
    }
    return { ...(await ingestImage(received)), kind: "image" };
  }
  await rm(file, { force: true });
  throw new UploadError(415, VIDEO_REJECTED_MESSAGE);
}

export async function cancelUpload(id: unknown, userId: string): Promise<void> {
  const r = row(id, userId);
  getDb().delete(schema.uploads).where(eq(schema.uploads.id, r.id)).run();
  await rm(partPath(r.id), { force: true });
}

/** Envois interrompus (médiathèque : « Reprendre »). */
export function listPendingUploads(userId: string): UploadStatus[] {
  return getDb()
    .select()
    .from(schema.uploads)
    .where(eq(schema.uploads.userId, userId))
    .all()
    .filter((r) => r.kind !== "kit")
    .map((r) => ({ id: r.id, name: r.name, size: r.size, offset: r.offset, kind: r.kind, chunkSize: CHUNK_BYTES }));
}
