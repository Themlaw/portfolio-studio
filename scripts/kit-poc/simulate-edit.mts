/**
 * Modification simulée d'un kit v2 (aller-retour sans Photoshop) : redessine
 * « Flèche droite » (flèche pleine, autre forme) et l'enregistre comme le fait
 * Photoshop — calque recadré à son contenu, déplacé dans sa case. Le reste du
 * fichier est réécrit tel quel (pixels identiques).
 * Usage : node --import tsx scripts/kit-poc/simulate-edit.mts <kit.psd> <sortie.psd> [--signature]
 *   --signature : ajoute aussi un sous-groupe (deux calques, l'un en « Produit ») dans « 2 · Signature »
 */
import { readFileSync, writeFileSync } from "node:fs";

import { readPsd, writePsdBuffer, type Layer } from "ag-psd";
import sharp from "sharp";

import { ensureAgPsd } from "@/lib/kit/ag-psd-node";
import { frameOf, SLOTS } from "@/lib/kit/spec";

const [input, output] = process.argv.slice(2);
const withSignature = process.argv.includes("--signature");
if (!input || !output) throw new Error("usage : simulate-edit.mts <kit.psd> <sortie.psd>");
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
const raster = async (svg: string) => {
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
};

const arrow = find(psd.children, "Flèche droite");
if (!arrow) throw new Error("calque « Flèche droite » introuvable");
// Flèche pleine 92 × 80, posée 18 px à droite et 22 px plus bas que le coin de la case.
const img = await raster(`<svg xmlns="http://www.w3.org/2000/svg" width="92" height="80"><path d="M2 28 H52 V4 L90 40 L52 76 V52 H2 Z" fill="#1f2a6b"/></svg>`);
// Coin de la case (le calque exporté est déjà rogné à son contenu).
const box = frameOf(SLOTS.find((s) => s.id === "icones/fleche-droite")!, "v2");
const x = box.x + 18;
const y = box.y + 22;
Object.assign(arrow, { left: x, top: y, right: x + img.width, bottom: y + img.height, imageData: img });

if (withSignature) {
  const group = find(psd.children, "2 · Signature");
  const sig = find(group?.children, "Signature");
  if (!group || !sig) throw new Error("groupe « 2 · Signature » introuvable");
  const zone = frameOf(SLOTS.find((s) => s.id === "signature")!, "v2");
  const sx = zone.x;
  const sy = zone.y;
  group.children!.push({
    name: "mes essais",
    children: [
      { name: "ligne", left: sx + 100, top: sy + 200, right: sx + 900, bottom: sy + 230, imageData: await raster(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="30"><rect width="800" height="30" rx="15" fill="#2a2c33"/></svg>`) },
      { name: "ombre", blendMode: "multiply", opacity: 0.6, left: sx + 100, top: sy + 215, right: sx + 900, bottom: sy + 245, imageData: await raster(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="30"><rect width="800" height="30" fill="#8a8f98"/></svg>`) },
    ],
  });
}

writeFileSync(output, writePsdBuffer({ ...psd, imageData: undefined, canvas: undefined }, { noBackground: true }));
console.log(JSON.stringify({ output, arrow: { left: x, top: y, w: img.width, h: img.height }, signature: withSignature }));
