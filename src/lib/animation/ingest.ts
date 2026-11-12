/**
 * Lot 132 — enregistrement d'une animation assemblée (voir assemble.ts). Comme une image : un contenu = une ligne (media.sha256 de LA
 * FEUILLE, donc les mêmes images donnent le même média), l'original est la feuille WebP rangée sous originals/<sha256>.webp (jamais
 * servie), le média est créé en `processing` avec sa définition (`variants.anim`) et un job image. Le worker (processAnimation) pose la
 * variante publique ; une restauration de sauvegarde (les variantes ne sont pas sauvegardées) la refait de la même façon.
 */
import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import { eq } from "drizzle-orm";

import { getDb, schema } from "@/lib/db";
import { wakeWorker } from "@/lib/jobs/worker";
import { getStorage } from "@/lib/storage";
import { ORIGINALS_PREFIX } from "@/lib/images/variants";
import { quotaProblem } from "@/lib/upload/quota";
import { UploadError } from "@/lib/upload/receive";
import { reviveIfTrashed } from "@/lib/upload/revive";

import { assembleFrames } from "./assemble";
import { AnimError, sheetSize, type AnimMeta } from "./sheet";

export type IngestedAnimation = { id: number; status: string; width: number; height: number; name: string; reused: boolean; frames: number; importedAt?: number; kind: "image" };

export async function ingestAnimation(frames: Buffer[], name: string): Promise<IngestedAnimation> {
  let assembled;
  try {
    assembled = await assembleFrames(frames);
  } catch (error) {
    if (error instanceof AnimError) throw new UploadError(422, error.message);
    throw error;
  }
  const { sheet, meta } = assembled;
  const size = sheetSize(meta);
  const sha256 = createHash("sha256").update(sheet).digest("hex");
  const db = getDb();
  const known = db.select().from(schema.media).where(eq(schema.media.sha256, sha256)).get();
  if (known) {
    const importedAt = reviveIfTrashed(known);
    return { id: known.id, status: known.status, width: known.width ?? size.w, height: known.height ?? size.h, name: known.originalName ?? name, reused: true, frames: meta.frames, importedAt, kind: "image" };
  }
  // La feuille est stockée deux fois (original + variante publique) : le quota compte les deux.
  const full = quotaProblem(sheet.length * 2);
  if (full) throw new UploadError(507, full);
  const key = `${ORIGINALS_PREFIX}${sha256}.webp`;
  const storage = getStorage();
  await storage.put(key, Readable.from(sheet));
  try {
    const id = db.transaction((tx) => {
      const row = tx
        .insert(schema.media)
        .values({
          key,
          sha256,
          kind: "image",
          mime: "image/webp",
          originalName: name,
          size: sheet.length,
          width: size.w,
          height: size.h,
          status: "processing",
          variants: { v: 1, files: [], anim: meta satisfies AnimMeta },
          alt: { fr: "", en: "" },
          lastImportAt: Date.now(),
        })
        .returning({ id: schema.media.id })
        .get();
      tx.insert(schema.jobs).values({ kind: "image", mediaId: row.id }).run();
      return row.id;
    });
    wakeWorker();
    return { id, status: "processing", width: size.w, height: size.h, name, reused: false, frames: meta.frames, kind: "image" };
  } catch (error) {
    const winner = db.select().from(schema.media).where(eq(schema.media.sha256, sha256)).get();
    if (winner) return { id: winner.id, status: winner.status, width: size.w, height: size.h, name, reused: true, frames: meta.frames, kind: "image" };
    if (!db.select({ id: schema.media.id }).from(schema.media).where(eq(schema.media.key, key)).get()) await storage.delete(key).catch(() => {});
    throw error;
  }
}
