/**
 * Retouches simulées d'un kit v3 comme le ferait l'illustratrice dans Photoshop
 * (lot 17a) : palette repeinte par plusieurs gestes naturels, tuile de papier
 * de cœurs, logo 1200 × 300. Le reste du fichier est réécrit tel quel.
 * Usage : node --import tsx scripts/kit-poc/simulate-17a.mts <kit.psd> <sortie.psd> [--opaque-logo]
 *   Palette : Fond = pot de peinture (toute la pastille) ; Surface = nouveau calque posé dessus ;
 *   Texte = coup de pinceau sur un tiers ; Action = incrustation couleur (style de calque) ;
 *   Accent secondaire = calque de forme.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { readPsd, writePsdBuffer, type Layer } from "ag-psd";
import sharp from "sharp";

import { ensureAgPsd } from "@/lib/kit/ag-psd-node";
import { frameOf, SLOTS, SWATCH_SLOTS } from "@/lib/kit/spec";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("usage : simulate-17a.mts <kit.psd> <sortie.psd>");
const opaqueLogo = process.argv.includes("--opaque-logo");
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
const swatch = (key: string) => {
  const slot = SWATCH_SLOTS.find((s) => s.paletteKey === key)!;
  return { slot, frame: frameOf(slot, "v2"), layer: find(psd.children, slot.layer)! };
};
const fillAll = (layer: Layer, [r, g, b]: number[]) => {
  const d = layer.imageData!.data;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) d.set([r, g, b], i);
};

// Fond : pot de peinture, toute la pastille.
fillAll(swatch("bg").layer, [0xfd, 0xe8, 0xee]);
// Surface : un nouveau calque posé sur la pastille.
const surface = swatch("surface");
const group = find(psd.children, "8 · Palette")!;
group.children!.push({
  name: "Calque 1",
  left: surface.frame.x + 10,
  top: surface.frame.y + 10,
  right: surface.frame.x + 140,
  bottom: surface.frame.y + 140,
  imageData: await raster(`<svg xmlns="http://www.w3.org/2000/svg" width="130" height="130"><rect width="130" height="130" fill="#fff6f8"/></svg>`),
});
// Texte : un coup de pinceau sur un tiers de la pastille.
const ink = swatch("ink");
{
  const d = ink.layer.imageData!.data;
  const w = ink.layer.imageData!.width;
  for (let y = 0; y < ink.layer.imageData!.height; y++) for (let x = 0; x < w / 3; x++) if (d[(y * w + x) * 4 + 3]) d.set([0x3a, 0x12, 0x24], (y * w + x) * 4);
}
// Action : incrustation couleur.
(swatch("primary").layer as Layer).effects = { solidFill: [{ enabled: true, present: true, color: { r: 0xc2, g: 0x1e, b: 0x56 }, opacity: 1, blendMode: "normal" }] };
// Accent secondaire : calque de forme (couleur de remplissage).
Object.assign(swatch("secondary").layer, { vectorFill: { type: "color", color: { r: 0x8a, g: 0x1c, b: 0x4a } } });
fillAll(swatch("secondary").layer, [0x8a, 0x1c, 0x4a]);

// Papier : tuile de cœurs 512 × 512, opaque.
const paper = find(psd.children, "Papier (tuile)")!;
const hearts = Array.from({ length: 16 }, (_, i) => {
  const cx = 64 + (i % 4) * 128;
  const cy = 64 + Math.floor(i / 4) * 128;
  return `<path transform="translate(${cx} ${cy}) scale(1.1)" d="M0 14 C-34 -8 -18 -34 0 -16 C18 -34 34 -8 0 14Z" fill="#f4b6c6"/>`;
}).join("");
const tile = SLOTS.find((s) => s.id === "papier")!;
const tf = frameOf(tile, "v2");
Object.assign(paper, { left: tf.x, top: tf.y, right: tf.x + 512, bottom: tf.y + 512, imageData: await raster(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#fdf0f3"/>${hearts}</svg>`) });

// Logo 1200 × 300.
const sig = find(psd.children, "Signature")!;
const sf = frameOf(SLOTS.find((s) => s.id === "signature")!, "v2");
const logo = opaqueLogo
  ? `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="300"><rect width="1200" height="300" fill="#ffffff"/><text x="60" y="200" font-family="serif" font-size="150" fill="#c21e56">Mon Studio</text></svg>`
  : `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="300"><text x="60" y="200" font-family="serif" font-size="150" fill="#c21e56">Mon Studio</text></svg>`;
Object.assign(sig, { left: sf.x, top: sf.y, right: sf.x + 1200, bottom: sf.y + 300, imageData: await raster(logo) });

writeFileSync(output, writePsdBuffer({ width: psd.width, height: psd.height, children: psd.children }, { noBackground: true }));
console.log("écrit", output);
