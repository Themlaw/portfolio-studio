/**
 * Icône de l'onglet (lot 52) : une image de la médiathèque est déclinée en PNG carrés (ICON_SIZES), gardés dans le
 * stockage sous `icons/<média>-<empreinte>/<taille>.png` (jamais servis par /media : seule la route /site-icon les lit).
 *
 * Exception assumée à « pas de sharp dans une requête » : c'est l'enregistrement du réglage, la source est la plus
 * petite variante d'au moins 512 px (≈ 1 Mpx au plus, jamais l'original), un seul thread, cinq sorties minuscules.
 */
import { Readable } from "node:stream";

import { eq } from "drizzle-orm";
import sharp from "sharp";

import { getDb, schema } from "./db";
import { parseVariants } from "./images/variants";
import { ICON_SIZES } from "./seo-schema";
import { getStorage } from "./storage";

sharp.concurrency(1);
sharp.cache(false);

export type FaviconResult = { ok: true; dir: string } | { ok: false; message: string };

export async function buildFavicons(mediaId: number): Promise<FaviconResult> {
  const row = getDb().select().from(schema.media).where(eq(schema.media.id, mediaId)).get();
  if (!row || row.deletedAt || row.status !== "ready" || row.kind !== "image") return { ok: false, message: "Choisis une image de la médiathèque (pas une vidéo ni un PDF)." };
  const storage = getStorage();
  const variants = parseVariants(row.variants);
  const webp = variants?.files.filter((f) => f.format === "webp").sort((a, b) => a.w - b.w) ?? [];
  const source = webp.find((f) => Math.max(f.w, f.h) >= 512) ?? webp.at(-1);
  const key = source?.key ?? (row.mime === "image/svg+xml" ? row.key : null);
  const file = key ? await storage.localPath(key) : null;
  if (!file) return { ok: false, message: "Cette image n'est pas utilisable comme icône : choisis-en une autre." };
  const dir = `icons/${row.id}-${(row.sha256 ?? "seed").slice(0, 8)}`;
  try {
    for (const size of ICON_SIZES) {
      const png = await sharp(file, { limitInputPixels: 24_000_000, density: row.mime === "image/svg+xml" ? 600 : undefined })
        .rotate()
        .resize(size, size, { fit: "cover", position: "centre" })
        .png({ compressionLevel: 9 })
        .toBuffer();
      await storage.put(`${dir}/${size}.png`, Readable.from([png]));
    }
  } catch (error) {
    console.error(`[favicon] média ${mediaId} : déclinaison impossible`, error);
    return { ok: false, message: "Cette image n'a pas pu être transformée en icône : essaie-en une autre." };
  }
  return { ok: true, dir };
}
