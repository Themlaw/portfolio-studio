/**
 * Cadre du kit en 9 parties (lot 58) : 4 coins fixes, 4 côtés qui RÉPÈTENT leur motif (CSS `border-image-repeat: round`).
 *
 * - Option A (par défaut) : un cadre carré complet, découpé aux repères (`FRAME_SLICE` px du bord, dans la case de 300 px).
 * - Option B (avancée) : seulement le coin du haut à gauche et le côté du haut ; les 4 coins et les 4 côtés sont fabriqués
 *   par rotation (`assembleCornerSide`).
 * - `framePreview` : aperçu de l'import (carré, panorama, portrait) calculé comme le navigateur le fait.
 */
import sharp, { type OverlayOptions } from "sharp";

import type { Rgba } from "./formats";

/** Épaisseur du bord dans la case de 300 px (px) ; affiché à moitié (24 px CSS), donc net en écran 2x. */
export const FRAME_SLICE = 48;
const ALPHA_EMPTY = 8;
const EDGE_FRINGE = 3;

const px = (img: Rgba, x: number, y: number) => (y * img.width + x) * 4;

function region(img: Rgba, x0: number, y0: number, x1: number, y1: number): Rgba {
  const w = x1 - x0;
  const h = y1 - y0;
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) img.data.copy(data, y * w * 4, px(img, x0, y0 + y), px(img, x0 + w, y0 + y));
  return { width: w, height: h, data };
}

/** Rotation de 90° dans le sens des aiguilles d'une montre. */
function rotate90(img: Rgba): Rgba {
  const { width: w, height: h } = img;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) img.data.copy(out, ((x * h) + (h - 1 - y)) * 4, px(img, x, y), px(img, x, y) + 4);
  return { width: h, height: w, data: out };
}

/**
 * Option B : seuls le coin du haut à gauche et le côté du haut sont dessinés (tout le reste de la case est vide).
 * Renvoie vrai si c'est le cas et que ces deux parties contiennent quelque chose.
 */
export function isCornerSide(img: Rgba, s = FRAME_SLICE): boolean {
  const { width: W, height: H } = img;
  let inside = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const a = img.data[px(img, x, y) + 3];
      if (a <= ALPHA_EMPTY) continue;
      if (y < s && x < W - s) inside++;
      // Marge de quelques pixels : la réduction de la case (900 → 300 px) déborde un peu hors du dessin.
      else if (y >= s + EDGE_FRINGE || x >= W - s + EDGE_FRINGE) return false;
    }
  return inside > 0;
}

/** Fabrique le cadre complet (case carrée) depuis un coin (haut-gauche) et un côté (haut). */
export function assembleCornerSide(img: Rgba, s = FRAME_SLICE): Rgba {
  const W = img.width;
  const corner = region(img, 0, 0, s, s);
  const side = region(img, s, 0, W - s, s);
  const out = Buffer.alloc(W * W * 4);
  const put = (p: Rgba, x0: number, y0: number) => {
    for (let y = 0; y < p.height; y++) p.data.copy(out, ((y0 + y) * W + x0) * 4, y * p.width * 4, (y + 1) * p.width * 4);
  };
  const c1 = rotate90(corner);
  const c2 = rotate90(c1);
  const c3 = rotate90(c2);
  put(corner, 0, 0);
  put(c1, W - s, 0);
  put(c2, W - s, W - s);
  put(c3, 0, W - s);
  const s1 = rotate90(side);
  const s2 = rotate90(s1);
  const s3 = rotate90(s2);
  put(side, s, 0);
  put(s1, W - s, s);
  put(s2, s, W - s);
  put(s3, 0, s);
  return { width: W, height: W, data: out };
}

const png = (img: Rgba) => sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } });

/** Nombre de motifs entiers sur un côté de longueur `len` pour un motif de `tile` : « round » (au moins 1). */
export const roundCount = (len: number, tile: number) => Math.max(1, Math.round(len / tile));

/** Cadre posé sur une boîte `w × h` (px d'écran), bord de `b` px, comme `border-image: … / b round` : coins fixes, côtés répétés. */
export async function renderFrame(cell: Rgba, w: number, h: number, b: number, s = FRAME_SLICE): Promise<Buffer> {
  const W = cell.width;
  const k = b / s;
  const parts: OverlayOptions[] = [];
  const add = async (r: Rgba, rw: number, rh: number, left: number, top: number) => {
    parts.push({ input: await png(r).resize(Math.max(1, rw), Math.max(1, rh), { fit: "fill", kernel: "lanczos3" }).png().toBuffer(), left, top });
  };
  await add(region(cell, 0, 0, s, s), b, b, 0, 0);
  await add(region(cell, W - s, 0, W, s), b, b, w - b, 0);
  await add(region(cell, 0, W - s, s, W), b, b, 0, h - b);
  await add(region(cell, W - s, W - s, W, W), b, b, w - b, h - b);
  const top = region(cell, s, 0, W - s, s);
  const bottom = region(cell, s, W - s, W - s, W);
  const left = region(cell, 0, s, s, W - s);
  const right = region(cell, W - s, s, W, W - s);
  const lenX = w - 2 * b;
  const lenY = h - 2 * b;
  const nx = roundCount(lenX, (W - 2 * s) * k);
  const ny = roundCount(lenY, (W - 2 * s) * k);
  for (let i = 0; i < nx; i++) {
    const x0 = b + Math.round((i * lenX) / nx);
    const x1 = b + Math.round(((i + 1) * lenX) / nx);
    await add(top, x1 - x0, b, x0, 0);
    await add(bottom, x1 - x0, b, x0, h - b);
  }
  for (let i = 0; i < ny; i++) {
    const y0 = b + Math.round((i * lenY) / ny);
    const y1 = b + Math.round(((i + 1) * lenY) / ny);
    await add(left, b, y1 - y0, 0, y0);
    await add(right, b, y1 - y0, w - b, y0);
  }
  // Un « tirage » neutre à l'intérieur : dégradé doux, pour juger du cadre sur une photo.
  const inner = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#cfd8dc"/><stop offset="1" stop-color="#90a4ae"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/></svg>`);
  return sharp(inner).composite(parts).png().toBuffer();
}

/** Formats de l'aperçu (px CSS) : carré, panorama 4:1, portrait 3:4. */
export const PREVIEW_FORMATS = [
  { id: "carre", w: 200, h: 200 },
  { id: "panorama", w: 400, h: 100 },
  { id: "portrait", w: 150, h: 200 },
] as const;

/** Aperçu de la revue d'import : le cadre sur les 3 formats, sur fond de papier clair, rendu 2x. */
export async function framePreview(cell: Rgba): Promise<Buffer> {
  const scale = 2;
  const b = (FRAME_SLICE / 2) * scale; // bord affiché : 24 px CSS = 48 px à l'écran 2x
  const gap = 24 * scale;
  const H = 200 * scale + 2 * gap;
  const W = PREVIEW_FORMATS.reduce((n, f) => n + f.w * scale + gap, gap);
  let x = gap;
  const parts: OverlayOptions[] = [];
  for (const f of PREVIEW_FORMATS) {
    parts.push({ input: await renderFrame(cell, f.w * scale, f.h * scale, b), left: x, top: gap + Math.round(((200 - f.h) * scale) / 2) });
    x += f.w * scale + gap;
  }
  return sharp({ create: { width: W, height: H, channels: 3, background: "#f5f1e8" } }).composite(parts).png({ compressionLevel: 9 }).toBuffer();
}
