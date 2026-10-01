/**
 * Traitement d'une image téléversée (worker, un job à la fois) : lecture de
 * l'original par fichier (au plus 100 mégapixels), réduction à une boîte de
 * 2400 × 2400 au décodage, orientation EXIF appliquée APRÈS réduction (sur
 * l'image réduite : jamais de rotation d'une image entière), toutes les
 * métadonnées retirées, variantes AVIF + WebP dans des boîtes de
 * VARIANT_WIDTHS px sans agrandir, 8 bits sRGB, couleur dominante.
 *
 * Mémoire : sharp tourne sur un seul thread sans cache et lit un CHEMIN de
 * fichier (un flux serait gardé entièrement en mémoire). Chaque variante part
 * de l'image intermédiaire (≤ 2400 px).
 */
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import sharp from "sharp";

import { dataDir } from "@/lib/db";
import { getStorage } from "@/lib/storage";

import { variantBoxes, variantKey, VARIANT_WIDTHS, type ImageVariants, type VariantFile } from "./variants";

sharp.concurrency(1);
sharp.cache(false);

export const MAX_PIXELS = 100_000_000;
/** Plus grand côté accepté (en-tête) : borne la mémoire même pour une image très haute. */
export const MAX_SIDE = 16_384;
/**
 * PNG 16 bits (pas de réduction au décodage, deux octets par canal) : plafond
 * propre, réglable. Mesuré (test:auth, section F) : +217 Mo de pic pour un
 * PNG 16 bits de 99 Mpx, sous le seuil de 500 Mo : par défaut, le plafond
 * général de 100 Mpx suffit. MAX_MEGAPIXELS_16BIT l'abaisse si besoin.
 */
export const MAX_PIXELS_16BIT = Math.max(1, Number(process.env.MAX_MEGAPIXELS_16BIT || 100)) * 1_000_000;

/** Message lisible par l'artiste pour une erreur de traitement. */
export function processingError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/pixel limit|exceeds pixel/i.test(message)) return "L'image dépasse 100 mégapixels : réduis-la avant de l'envoyer.";
  if (/trop de temps/.test(message)) return "Le traitement a pris trop de temps. Réduis l'image ou essaie un autre format, puis renvoie-la.";
  return "Le fichier n'a pas pu être lu comme une image (fichier abîmé ou incomplet ?). Essaie de l'exporter de nouveau.";
}

const hex = (n: number) => Math.round(n).toString(16).padStart(2, "0");

/** Orientation EXIF (1 à 8) appliquée à une image déjà réduite. */
function orient(img: ReturnType<typeof sharp>, orientation: number | undefined): ReturnType<typeof sharp> {
  switch (orientation) {
    case 2:
      return img.flop();
    case 3:
      return img.rotate(180);
    case 4:
      return img.flip();
    case 5:
      return img.rotate(90).flop();
    case 6:
      return img.rotate(90);
    case 7:
      return img.rotate(270).flop();
    case 8:
      return img.rotate(270);
    default:
      return img;
  }
}

/** Chemin lisible de l'original : celui du stockage local, sinon une copie temporaire. */
async function originalFile(key: string): Promise<{ file: string; cleanup: () => Promise<void> }> {
  const storage = getStorage();
  const local = await storage.localPath(key);
  if (local) return { file: local, cleanup: async () => {} };
  const dir = path.join(dataDir(), "tmp");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `job-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await pipeline(await storage.getStream(key), createWriteStream(file, { flags: "wx" }));
  return { file, cleanup: () => rm(file, { force: true }) };
}

export async function processImage(originalKey: string, hash16: string): Promise<{
  dominantColor: string | null;
  variants: ImageVariants;
}> {
  const storage = getStorage();
  const { file, cleanup } = await originalFile(originalKey);
  try {
    const options = { limitInputPixels: MAX_PIXELS, failOn: "error" as const, pages: 1, sequentialRead: true };
    const { orientation } = await sharp(file, options).metadata();
    const top = VARIANT_WIDTHS[VARIANT_WIDTHS.length - 1];
    // Boîte carrée : l'orientation ne change pas le résultat de « fit: inside ».
    const reduced = await sharp(file, options)
      .resize({ width: top, height: top, fit: "inside", withoutEnlargement: true })
      .toColourspace("srgb")
      .raw({ depth: "uchar" })
      .toBuffer({ resolveWithObject: true });
    const { data, info } = await orient(
      sharp(reduced.data, { raw: { width: reduced.info.width, height: reduced.info.height, channels: reduced.info.channels } }),
      orientation,
    )
      .raw()
      .toBuffer({ resolveWithObject: true });
    const raw = { raw: { width: info.width, height: info.height, channels: info.channels } };

    // Couleur de fond pendant le chargement : seulement pour une image opaque.
    const stats = await sharp(data, raw).stats();
    const d = stats.dominant;
    const dominantColor = stats.isOpaque ? `#${hex(d.r)}${hex(d.g)}${hex(d.b)}` : null;

    const files: VariantFile[] = [];
    for (const box of variantBoxes(Math.max(info.width, info.height))) {
      for (const format of ["avif", "webp"] as const) {
        const resized = sharp(data, raw).resize({ width: box, height: box, fit: "inside", withoutEnlargement: true });
        const encoded =
          format === "avif"
            ? resized.avif({ quality: 55, effort: 2, bitdepth: 8 })
            : resized.webp({ quality: 80, effort: 4, smartSubsample: true });
        const { data: out, info: outInfo } = await encoded.toBuffer({ resolveWithObject: true });
        const key = variantKey(hash16, box, format);
        const stored = await storage.put(key, Readable.from(out));
        files.push({ key, w: outInfo.width, h: outInfo.height, format, size: stored.size });
      }
    }
    return { dominantColor, variants: { v: 1, files } };
  } finally {
    await cleanup();
  }
}
