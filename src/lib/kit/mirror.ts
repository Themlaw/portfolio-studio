/**
 * Miroir d'une flèche (paire gauche / droite) : retournement horizontal de
 * l'asset déjà converti, SANS re-tracer. SVG : contenu enveloppé dans une
 * transformation matrix(-1 0 0 1 largeur 0) ; bitmap : sharp.flop().
 */
import sharp from "sharp";

import type { KitReport, SlotReport } from "./import";

export function mirrorSvg(svg: string): string {
  const open = svg.match(/<svg\b[^>]*>/);
  const end = svg.lastIndexOf("</svg>");
  if (!open || end < 0) throw new Error("SVG illisible");
  const viewBox = open[0].match(/viewBox="\s*([-\d.]+)[ ,]+([-\d.]+)[ ,]+([-\d.]+)[ ,]+([-\d.]+)\s*"/);
  if (!viewBox) throw new Error("SVG sans viewBox");
  const [x, w] = [Number(viewBox[1]), Number(viewBox[3])];
  const start = (open.index ?? 0) + open[0].length;
  return `${svg.slice(0, start)}<g transform="matrix(-1 0 0 1 ${2 * x + w} 0)">${svg.slice(start, end)}</g>${svg.slice(end)}`;
}

/** Bitmap retourné, réencodé dans son format (AVIF ou WebP). */
export async function mirrorBitmap(data: Buffer, format: "avif" | "webp"): Promise<Buffer> {
  const img = sharp(data).flop();
  return format === "avif" ? img.avif({ quality: 50, effort: 4 }).toBuffer() : img.webp({ quality: 78, alphaQuality: 90, effort: 4 }).toBuffer();
}

/** Emplacement à convertir : redessiné (ou nouveau), sans erreur, avec des fichiers. */
export const isApplicable = (s: SlotReport) => (s.change === "redrawn" || s.change === "new") && s.status !== "error" && Boolean(s.files?.length);

/** Une seule flèche redessinée : laquelle, et celle qui peut recevoir son miroir. */
export function arrowMirror(report: KitReport): { from: SlotReport; to: "icones/fleche-gauche" | "icones/fleche-droite" } | null {
  const left = report.slots.find((s) => s.id === "icones/fleche-gauche");
  const right = report.slots.find((s) => s.id === "icones/fleche-droite");
  const l = Boolean(left && isApplicable(left));
  const r = Boolean(right && isApplicable(right));
  if (l === r) return null;
  return l ? { from: left!, to: "icones/fleche-droite" } : { from: right!, to: "icones/fleche-gauche" };
}

