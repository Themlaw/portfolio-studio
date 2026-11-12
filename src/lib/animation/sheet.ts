/**
 * Lot 132 — animations dessinées image par image : module PUR (zod, aucun accès disque), lu par le serveur d'envoi, le worker, le rendu
 * public, la toile de l'éditeur et les tests.
 *
 * Une animation est UN média image ordinaire : une bande horizontale WebP (les images côte à côte), assemblée par sharp à l'envoi. Sa
 * définition (nombre d'images, taille d'une image) est dans `media.variants.anim` ; la cadence (6 / 8 / 12 / 24 i/s) et la boucle sont
 * des réglages de CHAQUE emplacement (image seule, case de grille, planche libre, planche de projet), jamais du média.
 * Lecture : CSS `steps(N, jump-none)` sur `background-position-x` (src/app/animation.css, AnimatedSheet).
 */
import { z } from "zod";

export const ANIM_FPS = [6, 8, 12, 24] as const;
export type AnimFps = (typeof ANIM_FPS)[number];
export const DEFAULT_FPS: AnimFps = 8;
export const ANIM_MIN_FRAMES = 2;
export const ANIM_MAX_FRAMES = 48;
/** Une feuille WebP ne dépasse pas 16 383 px de côté. */
export const SHEET_MAX_SIDE = 16_383;
/** Borne de mégapixels d'une feuille ET d'une image envoyée (sécurité v1.0 : 40 Mpx). */
export const SHEET_MAX_PIXELS = 40_000_000;
/** Feuille de sprites envoyée : colonnes et rangées au plus. */
export const SPRITE_MAX_CELLS = ANIM_MAX_FRAMES;

/** Erreur lisible par l'artiste (envoi refusé). */
export class AnimError extends Error {}

/** Schémas des réglages d'un emplacement : absents = rendu d'avant (aucune ancienne donnée ne change). */
export const fpsSchema = z.union([z.literal(6), z.literal(8), z.literal(12), z.literal(24)]);
export const animSlotFields = { fps: fpsSchema.optional(), loop: z.boolean().optional() };

export type AnimMeta = { frames: number; fw: number; fh: number };

/** Définition d'animation lue dans la colonne `variants` d'un média (JSON déjà lu), ou null. */
export function animOf(variants: unknown): AnimMeta | null {
  const a = (variants as { anim?: Partial<AnimMeta> } | null)?.anim;
  if (!a || typeof a !== "object") return null;
  const { frames, fw, fh } = a;
  if (!Number.isInteger(frames) || !Number.isInteger(fw) || !Number.isInteger(fh)) return null;
  if (frames! < ANIM_MIN_FRAMES || frames! > ANIM_MAX_FRAMES || fw! < 1 || fh! < 1) return null;
  return { frames: frames!, fw: fw!, fh: fh! };
}

/** Dimensions de la feuille d'une animation. */
export const sheetSize = (m: AnimMeta) => ({ w: m.frames * m.fw, h: m.fh });

/**
 * Taille d'une image et de la feuille pour `n` images de `w × h` : réduction proportionnelle si la bande dépasse 16 383 px ou 40 Mpx
 * (une seule feuille ; on réduit plutôt que de découper).
 */
export function planSheet(n: number, w: number, h: number): { fw: number; fh: number; sw: number; sh: number; scaled: boolean } {
  if (!Number.isInteger(n) || n < ANIM_MIN_FRAMES) throw new AnimError(`Une animation demande au moins ${ANIM_MIN_FRAMES} images.`);
  if (n > ANIM_MAX_FRAMES) throw new AnimError(`${ANIM_MAX_FRAMES} images au plus par animation (il y en a ${n}).`);
  if (!(w >= 1) || !(h >= 1)) throw new AnimError("Dimensions d'image illisibles.");
  const k = Math.min(1, SHEET_MAX_SIDE / (n * w), SHEET_MAX_SIDE / h, Math.sqrt(SHEET_MAX_PIXELS / (n * w * h)));
  const fw = Math.max(1, Math.floor(w * k));
  const fh = Math.max(1, Math.floor(h * k));
  return { fw, fh, sw: n * fw, sh: fh, scaled: k < 1 };
}

/** Variables CSS d'une animation (lues par `.anim-sheet`) : nombre d'images et durée d'un tour (images ÷ cadence). */
export function animStyle(meta: AnimMeta, fps: AnimFps = DEFAULT_FPS): Record<"--af-n" | "--af-d", string | number> {
  const d = Math.round((meta.frames / fps) * 1000) / 1000;
  return { "--af-n": meta.frames, "--af-d": `${d}s` };
}
