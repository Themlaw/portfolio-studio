/**
 * Lot 132 — assemblage serveur d'une animation (sharp) : des images (PNG / WebP / JPEG), un zip de PNG numérotés, ou une feuille de
 * sprites (colonnes × rangées) deviennent UNE bande WebP. Bornes de la sécurité v1.0 : 40 Mpx par image et par feuille, 48 images, zip lu
 * défensivement (entrées, taille, taux de compression ; noms jamais utilisés comme chemins).
 */
import sharp, { type OverlayOptions } from "sharp";

import { readZip, ZipError } from "@/lib/themes/zip";

import { ANIM_MAX_FRAMES, ANIM_MIN_FRAMES, AnimError, planSheet, SHEET_MAX_PIXELS, SPRITE_MAX_CELLS, type AnimMeta } from "./sheet";

sharp.concurrency(1);
sharp.cache(false);

const READ = { limitInputPixels: SHEET_MAX_PIXELS, failOn: "error" as const };
const FORMATS = new Set(["png", "webp", "jpeg"]);
const UNREADABLE = "Une des images n'a pas pu être lue (PNG, WebP ou JPEG attendus).";
const naturalName = (a: string, b: string) => a.localeCompare(b, "fr", { numeric: true, sensitivity: "base" });

/** En-tête d'une image : format et taille, SANS décoder (refus avant tout travail si > 40 Mpx). */
async function look(buf: Buffer): Promise<{ w: number; h: number }> {
  const m = await sharp(buf, { limitInputPixels: false }).metadata().catch(() => null);
  if (!m?.width || !m.height || !m.format || !FORMATS.has(m.format)) throw new AnimError(UNREADABLE);
  if (m.width * m.height > SHEET_MAX_PIXELS) {
    throw new AnimError(`Une image est trop grande (${Math.round((m.width * m.height) / 1e6)} mégapixels) : ${SHEET_MAX_PIXELS / 1e6} mégapixels au plus par image.`);
  }
  const rotated = (m.orientation ?? 1) >= 5;
  return rotated ? { w: m.height, h: m.width } : { w: m.width, h: m.height };
}

/** Images → bande horizontale WebP. La première image donne le format ; les autres sont centrées dedans (entières, fond transparent). */
export async function assembleFrames(frames: Buffer[]): Promise<{ sheet: Buffer; meta: AnimMeta }> {
  if (frames.length < ANIM_MIN_FRAMES) throw new AnimError(`Une animation demande au moins ${ANIM_MIN_FRAMES} images.`);
  if (frames.length > ANIM_MAX_FRAMES) throw new AnimError(`${ANIM_MAX_FRAMES} images au plus par animation (il y en a ${frames.length}).`);
  const first = await look(frames[0]);
  const plan = planSheet(frames.length, first.w, first.h);
  const cells: OverlayOptions[] = [];
  for (const [i, buf] of frames.entries()) {
    if (i > 0) await look(buf);
    const input = await sharp(buf, READ)
      .rotate()
      .resize({ width: plan.fw, height: plan.fh, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .ensureAlpha()
      .toColourspace("srgb")
      .png()
      .toBuffer()
      .catch(() => {
        throw new AnimError(UNREADABLE);
      });
    cells.push({ input, left: i * plan.fw, top: 0 });
  }
  const sheet = await sharp({ create: { width: plan.sw, height: plan.sh, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(cells)
    .webp({ quality: 92, alphaQuality: 100, effort: 4, smartSubsample: false })
    .toBuffer();
  return { sheet, meta: { frames: frames.length, fw: plan.fw, fh: plan.fh } };
}

/** Feuille de sprites (cols × rows cases égales) → images dans l'ordre de lecture ; `count` : nombre d'images si la dernière rangée est incomplète. */
export async function splitSheet(buf: Buffer, cols: number, rows: number, count?: number): Promise<Buffer[]> {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) throw new AnimError("Colonnes et rangées : des nombres entiers d'au moins 1.");
  const cells = cols * rows;
  if (cells < ANIM_MIN_FRAMES || cells > SPRITE_MAX_CELLS) throw new AnimError(`La feuille doit avoir de ${ANIM_MIN_FRAMES} à ${SPRITE_MAX_CELLS} cases (${cols} × ${rows} = ${cells}).`);
  const { w, h } = await look(buf);
  if (w % cols !== 0 || h % rows !== 0) throw new AnimError(`La feuille (${w} × ${h} px) ne se divise pas en ${cols} colonnes × ${rows} rangées de cases égales.`);
  const n = count ?? cells;
  if (!Number.isInteger(n) || n < ANIM_MIN_FRAMES || n > cells) throw new AnimError(`Nombre d'images invalide (${n}) pour ${cols} × ${rows} cases.`);
  const cw = w / cols;
  const ch = h / rows;
  const out: Buffer[] = [];
  for (let i = 0; i < n; i++) {
    out.push(
      await sharp(buf, READ)
        .rotate()
        .extract({ left: (i % cols) * cw, top: Math.floor(i / cols) * ch, width: cw, height: ch })
        .png()
        .toBuffer()
        .catch(() => {
          throw new AnimError(UNREADABLE);
        }),
    );
  }
  return out;
}

const ZIP_LIMITS = { maxEntries: 200, maxEntryBytes: 40 * 1024 * 1024, maxTotalBytes: 200 * 1024 * 1024, maxRatio: 400 };
const IMAGE_ENTRY = /\.(png|webp|jpe?g)$/i;

/** Zip d'images → images dans l'ordre naturel des noms (img2 avant img10). Dossiers, `__MACOSX`, fichiers cachés et autres types ignorés. */
export async function framesFromZip(buf: Buffer): Promise<Buffer[]> {
  let entries;
  try {
    entries = readZip(buf, ZIP_LIMITS);
  } catch (error) {
    if (error instanceof ZipError) throw new AnimError(`Archive ZIP refusée : ${error.message}`);
    throw error;
  }
  const kept = entries
    .filter((e) => IMAGE_ENTRY.test(e.name) && !/(^|\/)(__MACOSX|\._)/.test(e.name) && !e.name.split("/").some((p) => p.startsWith(".")))
    .sort((a, b) => naturalName(a.name, b.name));
  if (kept.length < ANIM_MIN_FRAMES) throw new AnimError(`L'archive doit contenir au moins ${ANIM_MIN_FRAMES} images (PNG, WebP ou JPEG).`);
  if (kept.length > ANIM_MAX_FRAMES) throw new AnimError(`${ANIM_MAX_FRAMES} images au plus par animation (l'archive en contient ${kept.length}).`);
  return kept.map((e) => e.data);
}

/** Ordre de lecture de fichiers envoyés un à un : ordre naturel de leurs noms. */
export const sortByName = <T extends { name: string }>(files: T[]): T[] => [...files].sort((a, b) => naturalName(a.name, b.name));
