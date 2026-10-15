/**
 * Enregistrement d'une image reçue. Un contenu = une ligne (media.sha256,
 * unique) :
 *  - type vérifié par signature ; dimensions lues dans l'en-tête (aucun
 *    décodage) : côtés, mégapixels et PNG 16 bits bornés ;
 *  - contenu déjà connu → son média (relancé s'il était en échec) ;
 *  - sinon original rangé sous originals/<sha256>.<ext> (jamais servi, sans
 *    le nom du fichier), média créé en `processing` et job ajouté ;
 *  - deux envois simultanés du même contenu : le conflit d'unicité renvoie
 *    la ligne gagnante ; tout autre échec supprime l'original écrit.
 * Le fichier temporaire est supprimé dans tous les cas.
 */
import { reviveIfTrashed } from "./revive";
import { createReadStream } from "node:fs";
import { rm } from "node:fs/promises";

import { eq } from "drizzle-orm";
import sharp from "sharp";

import { getDb, schema } from "@/lib/db";
import { decodeProblem } from "@/lib/images/budget";
import { MAX_PIXELS, MAX_PIXELS_16BIT, MAX_SIDE } from "@/lib/images/process";
import { ORIGINALS_PREFIX } from "@/lib/images/variants";
import { wakeWorker } from "@/lib/jobs/worker";
import { getStorage } from "@/lib/storage";

import { quotaProblem } from "./quota";
import type { Received } from "./receive";
import { UploadError } from "./receive";
import { REJECTED_MESSAGE, sniffImage } from "./sniff";

export type IngestedMedia = { id: number; status: string; width: number | null; height: number | null; name: string; reused: boolean };

const mp = (n: number) => Math.round(n / 1e6);

function isUniqueConflict(error: unknown): boolean {
  // L'erreur SQLite peut arriver enveloppée par Drizzle (cause).
  const e = error as { code?: string; cause?: { code?: string } };
  return (e.code ?? e.cause?.code ?? "").startsWith("SQLITE_CONSTRAINT");
}

function asIngested(row: typeof schema.media.$inferSelect, reused: boolean): IngestedMedia {
  return { id: row.id, status: row.status, width: row.width, height: row.height, name: row.originalName ?? "image", reused };
}

/** Relance le traitement d'une ligne en échec (nouvel envoi du même contenu). */
function retryFailed(row: typeof schema.media.$inferSelect): IngestedMedia {
  const db = getDb();
  db.transaction((tx) => {
    tx.update(schema.media).set({ status: "processing", error: null }).where(eq(schema.media.id, row.id)).run();
    tx.delete(schema.jobs).where(eq(schema.jobs.mediaId, row.id)).run();
    tx.insert(schema.jobs).values({ kind: "image", mediaId: row.id }).run();
  });
  wakeWorker();
  return { ...asIngested(row, true), status: "processing" };
}

export async function ingestImage(file: Received): Promise<IngestedMedia> {
  try {
    const type = sniffImage(file.head);
    if (!type) throw new UploadError(415, REJECTED_MESSAGE);

    // En-tête seulement (aucun décodage des pixels).
    const meta = await sharp(file.tmpPath, { limitInputPixels: false }).metadata().catch(() => null);
    if (!meta) throw new UploadError(422, "Le fichier n'a pas pu être lu comme une image (fichier abîmé ou incomplet ?).");
    if (!meta.width || !meta.height) throw new UploadError(422, "Dimensions de l'image illisibles.");
    if (meta.width > MAX_SIDE || meta.height > MAX_SIDE) {
      throw new UploadError(
        422,
        `Cette image est trop grande (${meta.width} × ${meta.height} px) : ${MAX_SIDE.toLocaleString("fr-FR")} px au plus de chaque côté. Réduis-la avant de l'envoyer.`,
      );
    }
    const pixels = meta.width * meta.height;
    if (pixels > MAX_PIXELS) {
      throw new UploadError(422, `Cette image est trop grande (${mp(pixels)} mégapixels) : 100 mégapixels au plus. Réduis-la avant de l'envoyer.`);
    }
    if (meta.depth === "ushort" && pixels > MAX_PIXELS_16BIT) {
      throw new UploadError(
        422,
        `Cette image en 16 bits par couleur est trop grande (${mp(pixels)} mégapixels) : ${mp(MAX_PIXELS_16BIT)} mégapixels au plus en 16 bits. Exporte-la en 8 bits, ou réduis-la.`,
      );
    }
    const heavy = decodeProblem({ ...meta, width: meta.width, height: meta.height });
    if (heavy) throw new UploadError(422, heavy);
    // Orientation EXIF 5 à 8 : l'image affichée est tournée d'un quart de tour.
    const rotated = (meta.orientation ?? 1) >= 5;
    const width = rotated ? meta.height : meta.width;
    const height = rotated ? meta.width : meta.height;

    const db = getDb();
    const known = db.select().from(schema.media).where(eq(schema.media.sha256, file.sha256)).get();
    if (known) {
      reviveIfTrashed(known);
      return known.status === "failed" ? retryFailed(known) : asIngested(known, true);
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
          .values({ key, sha256: file.sha256, kind: "image", mime: type.mime, originalName: file.filename, size: file.size, width, height, status: "processing", alt: { fr: "", en: "" } })
          .returning({ id: schema.media.id })
          .get();
        tx.insert(schema.jobs).values({ kind: "image", mediaId: row.id }).run();
        return row.id;
      });
      wakeWorker();
      return { id, status: "processing", width, height, name: file.filename, reused: false };
    } catch (error) {
      if (isUniqueConflict(error)) {
        // Envoi simultané du même contenu : la ligne gagnante (même original).
        const winner = db.select().from(schema.media).where(eq(schema.media.sha256, file.sha256)).get();
        if (winner) return asIngested(winner, true);
      }
      // Autre échec : l'original écrit ne doit pas rester orphelin.
      if (!db.select({ id: schema.media.id }).from(schema.media).where(eq(schema.media.key, key)).get()) {
        await storage.delete(key).catch(() => {});
      }
      throw error;
    }
  } finally {
    await rm(file.tmpPath, { force: true });
  }
}
