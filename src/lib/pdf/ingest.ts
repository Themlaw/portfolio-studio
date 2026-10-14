/**
 * Enregistrement d'un PDF reçu (bloc « CV ») — même contrat que les images
 * (src/lib/upload/ingest.ts) : un contenu = une ligne (sha256 unique),
 * original rangé sous originals/<sha256>.pdf (jamais servi), média créé en
 * `processing` avec un job « pdf » (file lourde : rendu des pages dans un
 * processus à part). Contrôles AVANT tout enregistrement : signature
 * `%PDF-`, taille, structure lisible par pdfinfo (délai et mémoire bornés),
 * pas de mot de passe, nombre de pages. Fichier temporaire toujours supprimé.
 */
import { reviveIfTrashed } from "@/lib/upload/revive";
import { createReadStream } from "node:fs";
import { rm } from "node:fs/promises";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { ORIGINALS_PREFIX } from "@/lib/images/variants";
import { wakeWorker } from "@/lib/jobs/worker";
import { getStorage } from "@/lib/storage";
import type { IngestedMedia } from "@/lib/upload/ingest";
import { quotaProblem } from "@/lib/upload/quota";
import { type Received, UploadError } from "@/lib/upload/receive";

import { isPdfHead, pdfLimits, renderedSize } from "./limits";
import { pdfInfo, PdfToolError } from "./poppler";

const mb = (n: number) => Math.round(n / 1024 / 1024);

function isUniqueConflict(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } };
  return (e.code ?? e.cause?.code ?? "").startsWith("SQLITE_CONSTRAINT");
}

const asIngested = (row: typeof schema.media.$inferSelect, reused: boolean): IngestedMedia => ({
  id: row.id,
  status: row.status,
  width: row.width,
  height: row.height,
  name: row.originalName ?? "document.pdf",
  reused,
});

export async function ingestPdf(file: Received): Promise<IngestedMedia> {
  try {
    if (!isPdfHead(file.head)) throw new UploadError(415, "Ce fichier n'est pas un PDF.");
    const limits = pdfLimits();
    if (file.size > limits.maxBytes) throw new UploadError(413, `Ce PDF dépasse ${mb(limits.maxBytes)} Mo : exporte-le plus léger (images compressées) avant de l'envoyer.`);

    const db = getDb();
    const known = db.select().from(schema.media).where(eq(schema.media.sha256, file.sha256)).get();
    if (known) reviveIfTrashed(known);
    if (known && known.status !== "failed") return asIngested(known, true);

    // Structure (pdfinfo : aucun rendu) : lisible, sans mot de passe, pages bornées.
    let info: Awaited<ReturnType<typeof pdfInfo>>;
    try {
      info = await pdfInfo(file.tmpPath);
    } catch (error) {
      const reason = error instanceof PdfToolError ? error.reason : "échec";
      console.warn(`[upload] PDF refusé à la lecture (${reason})`, error instanceof Error ? error.message : error);
      if (/password|Incorrect/i.test(String(error))) throw new UploadError(422, "Ce PDF est protégé par un mot de passe : exporte-le sans protection, puis renvoie-le.");
      throw new UploadError(422, "Ce PDF n'a pas pu être lu (fichier abîmé, protégé ou trop complexe). Exporte-le de nouveau depuis ton logiciel, puis renvoie-le.");
    }
    if (info.encrypted) throw new UploadError(422, "Ce PDF est protégé (chiffré) : exporte-le sans protection, puis renvoie-le.");
    if (info.pages < 1) throw new UploadError(422, "Ce PDF n'a aucune page.");
    if (info.pages > limits.maxPages) throw new UploadError(422, `Ce PDF a ${info.pages} pages : ${limits.maxPages} au plus pour un CV.`);
    const { width, height } = renderedSize(info.width, info.height, limits.renderPx);

    if (known) {
      // Même contenu, en échec : nouveau traitement de la même ligne.
      db.transaction((tx) => {
        tx.update(schema.media).set({ status: "processing", error: null }).where(eq(schema.media.id, known.id)).run();
        tx.delete(schema.jobs).where(eq(schema.jobs.mediaId, known.id)).run();
        tx.insert(schema.jobs).values({ kind: "pdf", mediaId: known.id }).run();
      });
      wakeWorker();
      return { ...asIngested(known, true), status: "processing" };
    }

    const full = quotaProblem(file.size * 2);
    if (full) throw new UploadError(507, full);

    const key = `${ORIGINALS_PREFIX}${file.sha256}.pdf`;
    const storage = getStorage();
    await storage.put(key, createReadStream(file.tmpPath));
    try {
      const id = db.transaction((tx) => {
        const row = tx
          .insert(schema.media)
          .values({ key, sha256: file.sha256, kind: "pdf", mime: "application/pdf", originalName: file.filename, size: file.size, width, height, status: "processing", alt: { fr: "", en: "" } })
          .returning({ id: schema.media.id })
          .get();
        tx.insert(schema.jobs).values({ kind: "pdf", mediaId: row.id }).run();
        return row.id;
      });
      wakeWorker();
      console.log(`[upload] PDF ${id} : ${info.pages} page(s), pdfinfo ${info.ms} ms, pic ${info.peakMb} Mo`);
      return { id, status: "processing", width, height, name: file.filename, reused: false };
    } catch (error) {
      if (isUniqueConflict(error)) {
        const winner = db.select().from(schema.media).where(eq(schema.media.sha256, file.sha256)).get();
        if (winner) return asIngested(winner, true);
      }
      if (!db.select({ id: schema.media.id }).from(schema.media).where(eq(schema.media.key, key)).get()) {
        await storage.delete(key).catch(() => {});
      }
      throw error;
    }
  } finally {
    await rm(file.tmpPath, { force: true });
  }
}
