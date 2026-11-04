/**
 * Envoi par morceaux, reprenable (vidéos, grandes images) :
 *   init → identifiant ; chunk(offset) écrit exactement à l'offset attendu ;
 *   status → offset courant (reprise) ; complete → détection et job ; cancel.
 * Fichier partiel : ${DATA_DIR}/tmp/uploads/<id>.part. Quota vérifié à init
 * (taille annoncée réservée, dans la MÊME transaction que le contrôle : deux
 * init simultanés ne passent pas tous deux) et à chaque morceau ; espace libre
 * du disque (statfs) aussi ; MAX_OPEN_UPLOADS envois ouverts au plus par
 * administrateur. Un envoi sans nouvelle depuis 24 h est purgé par le worker.
 */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { dataDir, getDb, schema } from "@/lib/db";
import { CHUNK_BYTES, videoLimits } from "@/lib/video/limits";
import { ingestVideo } from "@/lib/video/ingest";

import { attachUploadTags, parseTagLabels, tagCapacityProblem } from "@/lib/tags";

import { wakeWorker } from "@/lib/jobs/worker";
import { loadSavedTheme } from "@/lib/kit/export-job";
import { DEFAULT_LIMITS } from "@/lib/kit/limits";
import { createKitImport, KitImportBatchError, MAX_IMPORT_FILES } from "@/lib/kit/import-job";
import { DAMAGED_FILE, preflightProblem, preflightPsd, PsdPreflightError } from "@/lib/kit/psd-header";
import { extractEntry, KitZipError, listZip } from "@/lib/kit/zip-archive";

import { ingestImage, type IngestedMedia } from "./ingest";
import { diskProblem, quotaProblem } from "./quota";
import { cleanFilename, sniffImage, sniffPdf, sniffVideo, SNIFF_BYTES, VIDEO_REJECTED_MESSAGE } from "./sniff";
import { ingestPdf } from "@/lib/pdf/ingest";
import { pdfLimits } from "@/lib/pdf/limits";
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
  purpose: z
    .strictObject({
      kind: z.literal("kit"),
      themeId: z.string().regex(/^[a-z0-9-]{1,80}$/),
      /** Plusieurs PSD envoyés l'un après l'autre (identifiant choisi par le client) : le dernier (`last`) lance l'import. */
      batch: z.strictObject({ id: z.string().uuid(), last: z.boolean() }).optional(),
    })
    .optional(),
});

const Id = z.string().uuid();

/** Envois ouverts (en cours ou interrompus, pas encore purgés) au plus par administrateur : la file de l'admin en tient un à la fois. */
export const MAX_OPEN_UPLOADS = 10;

/** Ce que les envois ouverts doivent encore écrire sur le disque (réservé pour le contrôle de l'espace libre). */
function pendingBytes(): number {
  return getDb().select({ n: sql<number>`coalesce(sum(${schema.uploads.size} - ${schema.uploads.offset}), 0)` }).from(schema.uploads).get()?.n ?? 0;
}

/**
 * Réserve un envoi : nombre d'envois ouverts, quota et insertion dans UNE transaction synchrone (BEGIN IMMEDIATE) : rien ne s'intercale
 * entre le contrôle et la réservation, même avec plusieurs requêtes ou processus. Refus = UploadError, rien d'écrit.
 */
function reserveUpload(values: typeof schema.uploads.$inferInsert & { userId: string }): void {
  const db = getDb();
  db.transaction(
    () => {
      const open = db.select({ n: sql<number>`count(*)` }).from(schema.uploads).where(eq(schema.uploads.userId, values.userId)).get()?.n ?? 0;
      if (open >= MAX_OPEN_UPLOADS) {
        throw new UploadError(429, `Tu as déjà ${open} envois en cours ou interrompus : reprends-les ou annule-les dans la médiathèque avant d'en commencer un autre (un envoi abandonné est effacé au bout de 24 h).`);
      }
      const full = quotaProblem(values.size);
      if (full) throw new UploadError(507, full);
      db.insert(schema.uploads).values(values).run();
    },
    { behavior: "immediate" },
  );
}

/** Après la réservation : fichier partiel vide (s'il ne peut pas être créé, la réservation est rendue). */
async function createPart(id: string): Promise<void> {
  try {
    await mkdir(partDir(), { recursive: true });
    await (await open(partPath(id), "wx")).close();
  } catch (error) {
    getDb().delete(schema.uploads).where(eq(schema.uploads.id, id)).run();
    throw error;
  }
}

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

/**
 * Cible d'un envoi de kit, rangée dans `uploads.target` : `<thème>`, ou `<thème>#<lot>#<0|1>` pour un
 * PSD d'un envoi groupé (identifiant du lot, dernier fichier ou non). Pas de migration : la colonne est du texte.
 */
const kitTarget = (themeId: string, batch?: { id: string; last: boolean }) => (batch ? `${themeId}#${batch.id}#${batch.last ? 1 : 0}` : themeId);
function parseKitTarget(target: string | null): { themeId: string; batch?: { id: string; last: boolean } } {
  const [themeId, id, last] = (target ?? "").split("#");
  return id ? { themeId, batch: { id, last: last === "1" } } : { themeId };
}

/** Archive du kit : les trois PSD (300 Mo au plus chacun) et un peu de marge. */
const MAX_KIT_ZIP_BYTES = MAX_IMPORT_FILES * DEFAULT_LIMITS.maxFileBytes + 16 * 1024 * 1024;

/** Kit : un .psd ou l'archive .zip du kit, taille bornée (refus AVANT l'envoi), thème existant. */
function kitProblem(name: string, size: number, themeId: string): UploadError | null {
  const zip = /\.zip$/i.test(name);
  if (!zip && !/\.psd$/i.test(name)) return new UploadError(415, "Choisis le kit : l'archive .zip, ou un ou plusieurs fichiers Photoshop (.psd).");
  if (zip && size > MAX_KIT_ZIP_BYTES) return new UploadError(413, `Cette archive fait ${Math.round(size / 1024 / 1024)} Mo : ${Math.round(MAX_KIT_ZIP_BYTES / 1024 / 1024)} Mo au plus.`);
  if (!zip && size > DEFAULT_LIMITS.maxFileBytes) return new UploadError(413, `Ce fichier fait ${Math.round(size / 1024 / 1024)} Mo : ${Math.round(DEFAULT_LIMITS.maxFileBytes / 1024 / 1024)} Mo au plus. Supprime les calques inutiles (ou fusionne-les), puis réenregistre.`);
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
    const disk = await diskProblem(size, pendingBytes());
    if (disk) throw new UploadError(507, disk);
    const id = randomUUID();
    reserveUpload({ id, name, size, declaredType: type.slice(0, 100), kind: "kit", target: kitTarget(purpose.themeId, purpose.batch), offset: 0, userId, tags: [] });
    await createPart(id);
    return { id, name, size, offset: 0, kind: "kit", chunkSize: CHUNK_BYTES };
  }
  const tags = parseTagLabels(parsed.data.tags ?? []);
  if (!tags.ok) throw new UploadError(400, tags.message);
  const tagsFull = tagCapacityProblem(tags.labels);
  if (tagsFull) throw new UploadError(422, tagsFull);
  const kind: "image" | "video" = type.startsWith("video/") || /\.(mp4|mov|m4v|webm|mkv)$/i.test(name) ? "video" : "image";
  // PDF annoncé (type ou extension) : sa propre limite, vérifiée avant l'envoi (le contenu fait foi à la fin).
  const pdf = kind === "image" && (type === "application/pdf" || /\.pdf$/i.test(name));
  const max = kind === "video" ? videoLimits().maxBytes : pdf ? pdfLimits().maxBytes : maxImageBytes();
  if (size > max) {
    throw new UploadError(
      413,
      kind === "video"
        ? `Cette vidéo dépasse ${Math.round(max / 1024 / 1024)} Mo : réduis-la avant de l'envoyer.`
        : pdf
          ? `Ce PDF dépasse ${Math.round(max / 1024 / 1024)} Mo : exporte-le plus léger (images compressées) avant de l'envoyer.`
          : `Ce fichier dépasse ${Math.round(max / 1024 / 1024)} Mo : réduis-le avant de l'envoyer.`,
    );
  }
  const disk = await diskProblem(size, pendingBytes());
  if (disk) throw new UploadError(507, disk);
  const id = randomUUID();
  reserveUpload({ id, name, size, declaredType: type.slice(0, 100), kind, offset: 0, userId, tags: tags.labels });
  await createPart(id);
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
  // Disque : ce morceau doit tenir en laissant la marge libre (un autre envoi, une conversion ou une sauvegarde a pu la consommer).
  const disk = await diskProblem(length);
  if (disk) throw new UploadError(507, disk);
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
export type CompletedUpload = { media: IngestedMedia & { kind: "image" | "video" | "pdf"; tagWarning?: string } } | { kitImport: { id: string; themeId: string } };

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
 * Fin d'un envoi de kit : un PSD, plusieurs PSD d'un envoi groupé, ou l'archive .zip du kit.
 * Signature et en-tête de chaque PSD contrôlés SANS décodage (psd-header.ts : PSB, RVB, 8 bits,
 * dimensions, calques) ; l'archive est lue défensivement (zip-archive.ts : seules les entrées
 * .psd sont extraites, tailles bornées). Puis import en file.
 */
async function completeKit(r: typeof schema.uploads.$inferSelect, userId: string): Promise<{ id: string; themeId: string }> {
  if (r.offset !== r.size) throw new UploadError(409, `Envoi incomplet : ${r.offset} octets reçus sur ${r.size}.`);
  const file = partPath(r.id);
  getDb().delete(schema.uploads).where(eq(schema.uploads.id, r.id)).run();
  const extracted: string[] = [];
  const reject = async (status: number, message: string): Promise<never> => {
    await rm(file, { force: true });
    for (const f of extracted) await rm(f, { force: true });
    throw new UploadError(status, message);
  };
  const { themeId, batch } = parseKitTarget(r.target);
  if (!loadSavedTheme(themeId)) return reject(404, "Ce thème n'existe plus.");

  // Les PSD de cet envoi : le fichier lui-même, ou ceux de l'archive.
  const psds: { file: string; name: string; size: number }[] = [];
  if (/\.zip$/i.test(r.name)) {
    if (batch) return reject(400, "Une archive .zip s'envoie seule.");
    let entries: Awaited<ReturnType<typeof listZip>>;
    try {
      entries = (await listZip(file)).filter((e) => /\.psd$/i.test(e.name) && !/(^|\/)(__MACOSX\/|\._)/.test(e.name) && !e.name.endsWith("/"));
    } catch (error) {
      return reject(415, error instanceof KitZipError ? error.message : "Archive illisible : ce n'est pas un .zip valide.");
    }
    if (entries.length === 0) return reject(422, "Aucun fichier Photoshop (.psd) dans cette archive : envoie le .zip du kit tel que tu l'as téléchargé.");
    if (entries.length > MAX_IMPORT_FILES) return reject(422, `Cette archive contient ${entries.length} fichiers .psd : le kit en compte ${MAX_IMPORT_FILES} au plus.`);
    let left = MAX_IMPORT_FILES * DEFAULT_LIMITS.maxFileBytes;
    for (const [i, e] of entries.entries()) {
      const dest = path.join(partDir(), `${r.id}-zip-${i}.part`);
      extracted.push(dest);
      try {
        left -= await extractEntry(file, e, dest, Math.min(DEFAULT_LIMITS.maxFileBytes, left));
      } catch (error) {
        return reject(422, error instanceof KitZipError ? error.message : "Archive illisible : réessaie avec le .zip du kit tel que tu l'as téléchargé.");
      }
      psds.push({ file: dest, name: e.name.split("/").pop() ?? e.name, size: (await stat(dest)).size });
    }
    await rm(file, { force: true });
  } else {
    psds.push({ file, name: r.name, size: r.size });
  }
  const label = (name: string) => (psds.length > 1 || batch ? `« ${name} » : ` : "");
  for (const p of psds) {
    let pre: Awaited<ReturnType<typeof preflightPsd>>;
    try {
      pre = await preflightPsd(p.file, DEFAULT_LIMITS.maxLayers * 4);
    } catch (error) {
      extracted.push(p.file);
      return reject(415, `${label(p.name)}${error instanceof PsdPreflightError ? `${error.message}${error.message === DAMAGED_FILE ? "" : " Enregistre le kit depuis Photoshop au format PSD."}` : "Fichier illisible : enregistre le kit depuis Photoshop au format PSD."}`);
    }
    const problem = preflightProblem(pre, DEFAULT_LIMITS);
    if (problem) {
      extracted.push(p.file);
      return reject(422, `${label(p.name)}${problem}`);
    }
  }
  try {
    const meta = await createKitImport({ files: psds, themeId, userId, ...(batch ? { batch } : {}) }, wakeWorker);
    return { id: meta.id, themeId };
  } catch (error) {
    if (error instanceof KitImportBatchError) {
      for (const p of psds) await rm(p.file, { force: true });
      throw new UploadError(409, error.message);
    }
    throw error;
  }
}

async function ingestCompleted(r: typeof schema.uploads.$inferSelect): Promise<IngestedMedia & { kind: "image" | "video" | "pdf" }> {
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
  // PDF (bloc CV) : taille, pages et structure contrôlées par ingestPdf.
  if (sniffPdf(received.head)) return { ...(await ingestPdf(received)), kind: "pdf" };
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
