/**
 * Enregistrement d'une vidéo reçue (envoi par morceaux terminé) : conteneur
 * vérifié par signature (ISO-BMFF ou Matroska) puis confirmé par ffprobe
 * (piste vidéo réelle), durée et dimensions bornées, un contenu = une ligne
 * (sha256). Média créé en `processing`, job vidéo ajouté. Le fichier reçu est
 * supprimé dans tous les cas.
 */
import { createReadStream } from "node:fs";
import { rm } from "node:fs/promises";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { ORIGINALS_PREFIX } from "@/lib/images/variants";
import { wakeWorker } from "@/lib/jobs/worker";
import { getStorage } from "@/lib/storage";
import type { IngestedMedia } from "@/lib/upload/ingest";
import { quotaProblem } from "@/lib/upload/quota";
import { UploadError, type Received } from "@/lib/upload/receive";
import { sniffVideo, VIDEO_REJECTED_MESSAGE } from "@/lib/upload/sniff";

import { formatDuration, isAllowedAudio, isAllowedVideo, videoLimits } from "./limits";
import { runProbe, type Probe } from "./probe";

function isUniqueConflict(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return (e.code ?? e.cause?.code ?? "").startsWith("SQLITE_CONSTRAINT");
}

export async function ingestVideo(file: Received): Promise<IngestedMedia> {
  try {
    const type = sniffVideo(file.head);
    if (!type) throw new UploadError(415, VIDEO_REJECTED_MESSAGE);
    const limits = videoLimits();
    if (file.size > limits.maxBytes) {
      throw new UploadError(413, `Cette vidéo dépasse ${Math.round(limits.maxBytes / 1024 / 1024)} Mo : réduis-la avant de l'envoyer.`);
    }
    let probe: Probe;
    try {
      probe = await runProbe(file.tmpPath, type.container);
    } catch (e) {
      const noVideo = /aucune piste vidéo/.test(String(e));
      throw new UploadError(
        422,
        noVideo
          ? "Ce fichier ne contient pas de piste vidéo lisible. Formats possibles : MP4, MOV, WebM."
          : "Ce fichier n'a pas pu être lu comme une vidéo (fichier abîmé ou incomplet ?). Exporte-le de nouveau en MP4.",
      );
    }
    if (!isAllowedVideo(probe.videoCodec)) {
      throw new UploadError(422, `Ce codec vidéo n'est pas pris en charge (${probe.videoCodec || "inconnu"}). Exporte en H.264 ou ProRes.`);
    }
    if (probe.audioCodec && !isAllowedAudio(probe.audioCodec)) {
      throw new UploadError(422, `Ce codec audio n'est pas pris en charge (${probe.audioCodec}). Exporte le son en AAC.`);
    }
    if (probe.duration > limits.maxDurationS) {
      throw new UploadError(
        422,
        `Cette vidéo dure ${formatDuration(probe.duration)} : ${formatDuration(limits.maxDurationS)} au plus. Raccourcis-la avant de l'envoyer.`,
      );
    }
    if (Math.max(probe.width, probe.height) > limits.maxDimension) {
      throw new UploadError(
        422,
        `Cette vidéo est trop grande (${probe.width} × ${probe.height} px) : ${limits.maxDimension} px au plus de côté. Exporte-la en ${limits.maxDimension >= 3840 ? "4K" : `${limits.maxDimension} px`} au plus.`,
      );
    }

    const db = getDb();
    const known = db.select().from(schema.media).where(eq(schema.media.sha256, file.sha256)).get();
    if (known) {
      if (known.status === "failed") {
        db.transaction((tx) => {
          tx.update(schema.media).set({ status: "processing", error: null }).where(eq(schema.media.id, known.id)).run();
          tx.delete(schema.jobs).where(eq(schema.jobs.mediaId, known.id)).run();
          tx.insert(schema.jobs).values({ kind: "video", mediaId: known.id }).run();
        });
        wakeWorker();
        return { id: known.id, status: "processing", width: known.width, height: known.height, name: known.originalName ?? "vidéo", reused: true };
      }
      return { id: known.id, status: known.status, width: known.width, height: known.height, name: known.originalName ?? "vidéo", reused: true };
    }
    const full = quotaProblem(file.size);
    if (full) throw new UploadError(507, full);

    const key = `${ORIGINALS_PREFIX}${file.sha256}.${type.ext}`;
    const storage = getStorage();
    await storage.put(key, createReadStream(file.tmpPath));
    try {
      const id = db.transaction((tx) => {
        const row = tx
          .insert(schema.media)
          .values({
            key,
            sha256: file.sha256,
            kind: "video",
            mime: type.mime,
            originalName: file.filename,
            size: file.size,
            width: probe.width,
            height: probe.height,
            duration: probe.duration,
            hasAudio: probe.hasAudio,
            status: "processing",
            alt: { fr: "", en: "" },
          })
          .returning({ id: schema.media.id })
          .get();
        tx.insert(schema.jobs).values({ kind: "video", mediaId: row.id }).run();
        return row.id;
      });
      wakeWorker();
      return { id, status: "processing", width: probe.width, height: probe.height, name: file.filename, reused: false };
    } catch (error) {
      if (isUniqueConflict(error)) {
        const winner = db.select().from(schema.media).where(eq(schema.media.sha256, file.sha256)).get();
        if (winner) return { id: winner.id, status: winner.status, width: winner.width, height: winner.height, name: winner.originalName ?? "vidéo", reused: true };
      }
      if (!db.select({ id: schema.media.id }).from(schema.media).where(eq(schema.media.key, key)).get()) await storage.delete(key).catch(() => {});
      throw error;
    }
  } finally {
    await rm(file.tmpPath, { force: true });
  }
}
