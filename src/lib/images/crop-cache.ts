/**
 * Variantes recadrées (serveur) : extraites de l'ORIGINAL à la première demande,
 * puis gardées sur disque (`${DATA_DIR}/cache/crops/<média>/<rect>/<largeur>.<format>`,
 * clé = média + rectangle arrondi au dix-millième + largeur + format).
 *
 * Garde-fous (route publique, donc déni de service) :
 *  - le rectangle est signé (HMAC du média et du rectangle, posé au rendu de la
 *    page par le serveur) : on ne génère que ce que le site a lui-même écrit,
 *    brouillon compris, jamais un recadrage choisi par un tiers ;
 *  - la largeur appartient à une liste fermée (cropWidths) et la sortie est
 *    plafonnée en pixels (CROP_MAX_PIXELS) ;
 *  - une seule extraction à la fois (concurrence 1), file d'attente bornée
 *    (CropBusy → 503 + Retry-After) ; deux demandes de la même variante n'en
 *    font qu'une ;
 *  - au plus MAX_RECTS recadrages gardés par média (le plus ancien est effacé) ;
 *  - mémoire : sharp lit le CHEMIN de l'original, l'extraction précède la
 *    réduction, le budget de décodage de budget.ts est vérifié avant.
 * Purge : `purgeCrops(média)` à la suppression du média.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readdir, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { dataDir } from "@/lib/db";

import { decodeProblem } from "./budget";
import { cropHeight, cropWidths, rectKey, rectPixels, SIG_LENGTH, type RectUnits } from "./crop";
import { ImageTooHeavy, MAX_PIXELS, originalFile } from "./process";
import type { VariantFormat } from "./variants";

/** Recadrages gardés par média ; au-delà, le plus ancien est effacé (il se régénère si on le redemande). */
export const MAX_RECTS = 32;
/** Demandes en attente au plus (hors celle en cours) ; au-delà : CropBusy. */
export const MAX_WAITING = 24;

/** Demande refusée parce que la file est pleine (réponse 503, à réessayer). */
export class CropBusy extends Error {}
/** Demande hors des bornes (largeur inconnue, média sans original…) : réponse 404. */
export class CropRejected extends Error {}

/* ---- Signature -------------------------------------------------------------------- */

// Hors production sans secret : valeur fixe (dev, tests). En production la connexion exige BETTER_AUTH_SECRET
// (src/lib/auth/config.ts) ; s'il manquait ici quand même, un secret aléatoire du processus évite toute signature devinable.
const DEV_SECRET = "secret-de-dev-supprime";
const PROCESS_SECRET = randomBytes(32).toString("hex");
const secret = () => process.env.BETTER_AUTH_SECRET || (process.env.NODE_ENV === "production" ? PROCESS_SECRET : DEV_SECRET);
const digest = (mediaId: number, key: string) => createHmac("sha256", secret()).update(`crop1:${mediaId}:${key}`).digest("hex").slice(0, SIG_LENGTH);

/** Signature d'un recadrage (rendu du site) : n'accepte que ce que le serveur a écrit lui-même. */
export function signCrop(mediaId: number, key: string): string {
  return digest(mediaId, key);
}

export function verifyCrop(mediaId: number, key: string, sig: string): boolean {
  const a = Buffer.from(digest(mediaId, key));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ---- Disque ------------------------------------------------------------------------ */

const cacheRoot = () => path.join(/* turbopackIgnore: true */ dataDir(), "cache", "crops");
const mediaDir = (mediaId: number) => path.join(/* turbopackIgnore: true */ cacheRoot(), String(mediaId));

export function cropFile(mediaId: number, units: RectUnits, width: number, format: VariantFormat): string {
  return path.join(/* turbopackIgnore: true */ mediaDir(mediaId), rectKey(units), `${width}.${format}`);
}

async function statFile(file: string): Promise<{ file: string; size: number } | null> {
  try {
    const s = await stat(file);
    return s.isFile() ? { file, size: s.size } : null;
  } catch {
    return null;
  }
}

/** Supprime tous les recadrages d'un média (média supprimé). */
export async function purgeCrops(mediaId: number): Promise<void> {
  await rm(mediaDir(mediaId), { recursive: true, force: true }).catch((e) => console.error(`[crop] purge du média ${mediaId} impossible`, e));
}

/** Fait de la place pour un nouveau recadrage : efface les plus anciens au-delà de MAX_RECTS. */
async function evict(mediaId: number, keep: string): Promise<void> {
  const dir = mediaDir(mediaId);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  if (names.length < MAX_RECTS) return;
  const dated = await Promise.all(names.filter((n) => n !== keep).map(async (n) => ({ n, t: (await stat(path.join(/* turbopackIgnore: true */ dir, n)).catch(() => null))?.mtimeMs ?? 0 })));
  dated.sort((a, b) => a.t - b.t);
  for (const { n } of dated.slice(0, names.length - MAX_RECTS + 1)) await rm(path.join(/* turbopackIgnore: true */ dir, n), { recursive: true, force: true });
}

/* ---- File d'attente (concurrence 1) ----------------------------------------------- */

let tail: Promise<unknown> = Promise.resolve();
let waiting = 0;
const inflight = new Map<string, Promise<{ file: string; size: number }>>();

function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  if (waiting >= MAX_WAITING) return Promise.reject(new CropBusy("file pleine"));
  waiting++;
  const run = tail.then(fn);
  tail = run.then(
    () => {},
    () => {},
  );
  return run.finally(() => {
    waiting--;
  });
}

/** Demandes en cours ou en attente (tests, diagnostic). */
export const cropQueueLength = () => waiting;

/* ---- Génération -------------------------------------------------------------------- */

export type CropMedia = { id: number; /** Clé de l'original (stockage). */ key: string; width: number; height: number };

async function generate(media: CropMedia, units: RectUnits, width: number, format: VariantFormat, file: string): Promise<{ file: string; size: number }> {
  const again = await statFile(file);
  if (again) return again;
  await evict(media.id, rectKey(units));
  const { file: source, cleanup } = await originalFile(media.key);
  try {
    const orientation = (await sharp(source, { limitInputPixels: MAX_PIXELS, failOn: "error", pages: 1 }).metadata()).orientation ?? 1;
    // Orientation EXIF : l'image est tournée AVANT l'extraction (le rectangle est celui de l'image vue), ce qui oblige à une lecture non séquentielle.
    const options = { limitInputPixels: MAX_PIXELS, failOn: "error" as const, pages: 1, sequentialRead: orientation === 1 };
    const meta = await sharp(source, options).metadata();
    if (!meta.width || !meta.height) throw new CropRejected("dimensions illisibles");
    const heavy = decodeProblem({ ...meta, width: meta.width, height: meta.height });
    if (heavy) throw new ImageTooHeavy(heavy);
    const ow = orientation >= 5 ? meta.height : meta.width;
    const oh = orientation >= 5 ? meta.width : meta.height;
    const px = rectPixels(units, ow, oh);
    let img = sharp(source, options);
    if (orientation > 1) img = img.rotate();
    const resized = img
      .extract({ left: px.left, top: px.top, width: px.w, height: px.h })
      .resize({ width, height: cropHeight(width, px.w, px.h), fit: "fill" })
      .toColourspace("srgb");
    const encoded = format === "avif" ? resized.avif({ quality: 55, effort: 2, bitdepth: 8 }) : resized.webp({ quality: 80, effort: 4, smartSubsample: true });
    const out = await encoded.toBuffer();
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, out, { flag: "wx" });
    await rename(tmp, file);
    const now = new Date();
    await utimes(path.dirname(file), now, now).catch(() => {});
    return { file, size: out.length };
  } finally {
    await cleanup();
  }
}

/**
 * Fichier de la variante recadrée (générée au besoin). Lève CropRejected (largeur
 * hors liste, dimensions incohérentes) ou CropBusy (file pleine).
 */
export async function ensureCrop(media: CropMedia, units: RectUnits, width: number, format: VariantFormat): Promise<{ file: string; size: number }> {
  const px = rectPixels(units, media.width, media.height);
  if (!cropWidths(px.w, px.h).includes(width)) throw new CropRejected("largeur non proposée");
  const file = cropFile(media.id, units, width, format);
  const hit = await statFile(file);
  if (hit) return hit;
  let flight = inflight.get(file);
  if (!flight) {
    flight = exclusive(() => generate(media, units, width, format, file)).finally(() => inflight.delete(file));
    inflight.set(file, flight);
  }
  return flight;
}
