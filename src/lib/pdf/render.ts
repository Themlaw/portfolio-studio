/**
 * Job « pdf » (file lourde) : aperçu des pages d'un CV.
 *  1. pdfinfo de nouveau (le fichier stocké, pas celui de l'envoi) ;
 *  2. pdftoppm rend les pages en PNG (plus grand côté PDF_RENDER_PX) dans un
 *     dossier temporaire `tmp/pdf-<média>-<horodatage>` (purgé au démarrage) ;
 *  3. chaque page passe par sharp, comme une image envoyée (boîte bornée,
 *     8 bits sRGB, sans métadonnées) : AVIF + WebP en PDF_PAGE_BOXES ;
 *  4. le PDF d'origine est copié sous doc/<hash16>/document.pdf : c'est la
 *     seule clé servie en téléchargement (originals/ ne l'est jamais).
 * Un échec après écriture supprime les clés déjà écrites.
 */
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { createReadStream } from "node:fs";

import sharp from "sharp";

import { dataDir } from "@/lib/db";
import { originalFile } from "@/lib/images/process";
import type { ImageVariants, VariantFile } from "@/lib/images/variants";
import { getStorage } from "@/lib/storage";

import { pageKey, pdfKey, pdfLimits, PDF_PAGE_BOXES } from "./limits";
import { pdfInfo, renderPdf } from "./poppler";

export const pdfTmpDir = (mediaId: number) => path.join(/* turbopackIgnore: true */ dataDir(), "tmp", `pdf-${mediaId}-${Date.now()}`);
export const isPdfTmpName = (name: string) => /^pdf-\d+-\d+$/.test(name);

export type PdfResult = { variants: ImageVariants; width: number; height: number; pages: number; stats: { renderMs: number; renderPeakMb: number; infoPeakMb: number } };

export async function processPdf(mediaId: number, originalKey: string, hash16: string): Promise<PdfResult> {
  const limits = pdfLimits();
  const storage = getStorage();
  const written: string[] = [];
  const source = await originalFile(originalKey);
  const dir = pdfTmpDir(mediaId);
  try {
    await mkdir(dir, { recursive: true });
    const info = await pdfInfo(source.file);
    if (info.encrypted || info.pages < 1 || info.pages > limits.maxPages) throw new Error(`PDF refusé : ${info.pages} page(s), chiffré ${info.encrypted}`);
    const run = await renderPdf(source.file, path.join(/* turbopackIgnore: true */ dir, "p"), info.pages);

    // pdftoppm nomme p-1.png… ou p-01.png selon le nombre de pages : on trie par numéro.
    const pngs = (await readdir(dir))
      .map((name) => ({ name, n: Number(/^p-(\d+)\.png$/.exec(name)?.[1] ?? NaN) }))
      .filter((f) => Number.isInteger(f.n))
      .sort((a, b) => a.n - b.n);
    if (pngs.length !== info.pages) throw new Error(`rendu incomplet : ${pngs.length} page(s) sur ${info.pages}`);

    const files: VariantFile[] = [];
    let first = { width: 0, height: 0 };
    for (const [i, png] of pngs.entries()) {
      const page = i + 1;
      const input = path.join(/* turbopackIgnore: true */ dir, png.name);
      // Boîte bornée au décodage (jamais plus grand que le rendu demandé).
      const opts = { limitInputPixels: limits.renderPx * limits.renderPx, failOn: "error" as const, sequentialRead: true };
      const meta = await sharp(input, opts).metadata();
      if (!meta.width || !meta.height || Math.max(meta.width, meta.height) > limits.renderPx + 2) throw new Error(`page ${page} : dimensions inattendues`);
      if (page === 1) first = { width: meta.width, height: meta.height };
      for (const box of PDF_PAGE_BOXES) {
        for (const format of ["avif", "webp"] as const) {
          const resized = sharp(input, opts).flatten({ background: "#ffffff" }).resize({ width: box, height: box, fit: "inside", withoutEnlargement: true }).toColourspace("srgb");
          const encoded = format === "avif" ? resized.avif({ quality: 60, effort: 2, bitdepth: 8 }) : resized.webp({ quality: 85, effort: 4 });
          const { data, info: out } = await encoded.toBuffer({ resolveWithObject: true });
          const key = pageKey(hash16, page, box, format);
          const stored = await storage.put(key, Readable.from(data));
          written.push(key);
          files.push({ key, w: out.width, h: out.height, format, size: stored.size, page });
        }
      }
      await rm(input, { force: true });
    }
    const docKey = pdfKey(hash16);
    const stored = await storage.put(docKey, createReadStream(source.file));
    written.push(docKey);
    files.push({ key: docKey, w: first.width, h: first.height, format: "pdf", size: stored.size });
    return {
      variants: { v: 1, files, pages: info.pages },
      width: first.width,
      height: first.height,
      pages: info.pages,
      stats: { renderMs: run.ms, renderPeakMb: run.peakMb, infoPeakMb: info.peakMb },
    };
  } catch (error) {
    for (const key of written) await storage.delete(key).catch(() => {});
    throw error;
  } finally {
    await rm(dir, { recursive: true, force: true });
    await source.cleanup();
  }
}
