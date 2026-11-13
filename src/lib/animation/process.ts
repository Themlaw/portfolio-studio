/**
 * Lot 132 — traitement (worker) d'une animation : la variante publique est la feuille elle-même (WebP, déjà assemblée à l'envoi), copiée
 * sous img/<hash16>/<largeur>.webp. Pas de réduction ni d'AVIF : les cases doivent rester alignées et nettes. Aussi appelé après une
 * restauration (variantes absentes de la sauvegarde) et par « Réessayer ».
 */
import { Readable } from "node:stream";

import sharp from "sharp";

import { originalFile } from "@/lib/images/process";
import { variantKey, type ImageVariants } from "@/lib/images/variants";
import { getStorage } from "@/lib/storage";

import { AnimError, sheetSize, type AnimMeta } from "./sheet";

export async function processAnimation(originalKey: string, hash16: string, anim: AnimMeta): Promise<{ dominantColor: string | null; variants: ImageVariants & { anim: AnimMeta } }> {
  const storage = getStorage();
  const { file, cleanup } = await originalFile(originalKey);
  try {
    const meta = await sharp(file, { limitInputPixels: 40_000_000 }).metadata();
    const want = sheetSize(anim);
    if (meta.format !== "webp" || meta.width !== want.w || meta.height !== want.h) throw new AnimError("La feuille de l'animation ne correspond plus à sa définition : renvoie les images.");
    const key = variantKey(hash16, want.w, "webp");
    const stored = await storage.put(key, (await storage.getStream(originalKey)) as Readable);
    return { dominantColor: null, variants: { v: 1, files: [{ key, w: want.w, h: want.h, format: "webp", size: stored.size }], anim } };
  } finally {
    await cleanup();
  }
}
