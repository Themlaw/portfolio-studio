/**
 * Modification simulée d'un kit v3 (aller-retour sans Photoshop, lot 4) :
 *  - pastilles repeintes (« Action · survol » par défaut, couleur au choix) ;
 *  - curseurs « Normal » et « Clic » redessinés (crayon et main ronde, noirs
 *    au contour blanc), calques recadrés à leur contenu comme Photoshop ;
 *    repère « point chaud » déplacé sur la pointe du nouveau dessin.
 * Le reste du fichier est réécrit tel quel (pixels identiques).
 * Usage : node --import tsx scripts/kit-poc/simulate-v3-edit.mts <kit.psd> <sortie.psd> ["Action · survol=#8b1e3f" …]
 */
import { readFileSync, writeFileSync } from "node:fs";

import { readPsd, writePsdBuffer, type Layer } from "ag-psd";
import sharp from "sharp";

import { ensureAgPsd } from "@/lib/kit/ag-psd-node";
import { CURSOR_SLOTS, frameOf } from "@/lib/kit/spec";

const [input, output, ...paints] = process.argv.slice(2);
if (!input || !output) throw new Error("usage : simulate-v3-edit.mts <kit.psd> <sortie.psd> [\"Nom=#rrggbb\" …]");
ensureAgPsd();
const psd = readPsd(readFileSync(input), { useImageData: true, skipCompositeImageData: true, skipThumbnail: true });
const find = (list: Layer[] | undefined, name: string): Layer | undefined => {
  for (const l of list ?? []) {
    if (l.name === name) return l;
    const inner = find(l.children, name);
    if (inner) return inner;
  }
  return undefined;
};

// Pastilles repeintes (toute la forme, comme Alt+Maj+Retour arrière).
for (const p of paints.length ? paints : ["Action · survol=#8b1e3f"]) {
  const [name, hex] = p.split("=");
  const layer = find(find(psd.children, "8 · Palette")?.children, name);
  if (!layer?.imageData) throw new Error(`pastille « ${name} » introuvable`);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const d = layer.imageData.data;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) d.set([r, g, b, 255], i);
}

// Curseurs : crayon (pointe en haut à gauche) et main ronde.
const DRAWINGS = {
  Normal: { svg: `<path d="M6 6 L20 44 L28 36 L52 60 L60 52 L36 28 L44 20 Z" fill="#2b1d3a" stroke="#ffffff" stroke-width="3" stroke-linejoin="round" paint-order="stroke"/>`, hotspot: { x: 6, y: 6 } },
  Clic: { svg: `<circle cx="32" cy="34" r="20" fill="#2b1d3a" stroke="#ffffff" stroke-width="3"/><path d="M28 4 L36 4 L36 30 L28 30 Z" fill="#2b1d3a" stroke="#ffffff" stroke-width="3" stroke-linejoin="round" paint-order="stroke"/>`, hotspot: { x: 32, y: 5 } },
} as const;
const cursorGroup = find(psd.children, "9 · Curseur");
for (const slot of CURSOR_SLOTS) {
  const group = cursorGroup?.children?.find((l) => l.name === slot.layer);
  const drawing = group?.children?.find((l) => l.name === "Dessin");
  const marker = group?.children?.find((l) => l.name === "point chaud");
  if (!drawing || !marker) throw new Error(`curseur « ${slot.layer} » incomplet`);
  const spec = DRAWINGS[slot.layer as keyof typeof DRAWINGS];
  const data = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">${spec.svg}</svg>`)).ensureAlpha().raw().toBuffer();
  // Recadré à son contenu (comme Photoshop l'enregistre).
  let [t, b, l, r] = [64, -1, 64, -1];
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (data[(y * 64 + x) * 4 + 3]) [t, b, l, r] = [Math.min(t, y), Math.max(b, y), Math.min(l, x), Math.max(r, x)];
  const w = r - l + 1;
  const h = b - t + 1;
  const crop = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) crop.set(data.subarray(((t + y) * 64 + l) * 4, ((t + y) * 64 + l + w) * 4), y * w * 4);
  const zone = frameOf(slot, "v2");
  Object.assign(drawing, { left: zone.x + l, top: zone.y + t, right: zone.x + l + w, bottom: zone.y + t + h, imageData: { width: w, height: h, data: crop } });
  // Repère déplacé : son centre sur la pointe du dessin.
  const mw = (marker.right ?? 0) - (marker.left ?? 0);
  const mh = (marker.bottom ?? 0) - (marker.top ?? 0);
  marker.left = zone.x + spec.hotspot.x - Math.floor((mw - 1) / 2);
  marker.top = zone.y + spec.hotspot.y - Math.floor((mh - 1) / 2);
  marker.right = marker.left + mw;
  marker.bottom = marker.top + mh;
}
writeFileSync(output, writePsdBuffer({ width: psd.width, height: psd.height, children: psd.children }, { noBackground: true }));
console.log(JSON.stringify({ output, paints: paints.length ? paints : ["Action · survol=#8b1e3f"], cursors: Object.fromEntries(Object.entries(DRAWINGS).map(([k, v]) => [k, v.hotspot])) }));
