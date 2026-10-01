/**
 * Compromis poids / fidélité du contour (phase 6c) : chaque plan en aplat de
 * kit-A vectorisé avec plusieurs réglages vtracer, mesuré contre l'original.
 * Usage : node --import tsx scripts/kit-poc/fidelity.mts <sortie de run-import --keep>
 */
import path from "node:path";

import { PathSimplifyMode } from "@neplex/vectorizer";
import sharp from "sharp";

import { contourFidelity, encodeBitmap, textureStats, vectorizeLayer, type VectorTuning } from "@/lib/kit/formats";

const dir = process.argv[2];
const TUNINGS: Record<string, VectorTuning> = {
  "actuel (speckle 4, coin 60, splice 45, précision 1)": {},
  "fin (speckle 2, coin 30, longueur 2, splice 25, précision 2)": { filterSpeckle: 2, cornerThreshold: 30, lengthThreshold: 2, spliceThreshold: 25, pathPrecision: 2 },
  "très fin (speckle 1, coin 20, longueur 1.5, splice 15, précision 2)": { filterSpeckle: 1, cornerThreshold: 20, lengthThreshold: 1.5, spliceThreshold: 15, pathPrecision: 2 },
  "polygone (speckle 1, précision 1)": { filterSpeckle: 1, mode: PathSimplifyMode.Polygon, pathPrecision: 1 },
  "pleine résolution, actuel": {},
  "pleine résolution, très fin": { filterSpeckle: 1, cornerThreshold: 20, lengthThreshold: 1.5, spliceThreshold: 15, pathPrecision: 2 },
  "pleine résolution, polygone": { filterSpeckle: 1, mode: PathSimplifyMode.Polygon, pathPrecision: 1 },
};
for (const plan of [2, 3, 4, 5]) {
  const file = path.join(dir, `hero--plan-${plan}.source.png`);
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const img = { width: info.width, height: info.height, data };
  const { avif } = await encodeBitmap(img);
  const tex = textureStats(img);
  const fa = await contourFidelity(img, avif);
  console.log(JSON.stringify({ plan, name: "AVIF (référence)", svg: 0, avif: avif.length, paths: 0, iou: Number(fa.iou.toFixed(5)), deviation: Number(fa.deviation.toFixed(3)), ms: 0 }));
  for (const [name, tuning] of Object.entries(TUNINGS)) {
    const t0 = Date.now();
    const full = name.startsWith("pleine");
    const v = await vectorizeLayer(img, "flat", tex.dominant, tuning, full ? 4096 : undefined);
    const f = await contourFidelity(img, v.svg);
    console.log(JSON.stringify({ plan, name, svg: Buffer.byteLength(v.svg), avif: avif.length, paths: v.paths, iou: Number(f.iou.toFixed(5)), deviation: Number(f.deviation.toFixed(3)), ms: Date.now() - t0 }));
  }
}

// Captures (screenshots/kit-poc2) : détail à 100 % du bord du plan 3 : original,
// réglage de la PoC (réduit à 1920 px), pleine résolution « très fin », polygone.
if (process.argv[3]) {
  const shots = process.argv[3];
  const { mkdirSync } = await import("node:fs");
  mkdirSync(shots, { recursive: true });
  const file = path.join(dir, "hero--plan-3.source.png");
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const img = { width: info.width, height: info.height, data };
  const tex = textureStats(img);
  const crop = { left: 900, top: 0, width: 520, height: 220 };
  const variants: [string, Buffer][] = [["original", await sharp(file).png().toBuffer()]];
  for (const [label, tuning, full] of [
    ["poc", {}, false],
    ["tres-fin", TUNINGS["très fin (speckle 1, coin 20, longueur 1.5, splice 15, précision 2)"], true],
    ["polygone", TUNINGS["polygone (speckle 1, précision 1)"], true],
  ] as const) {
    const v = await vectorizeLayer(img, "flat", tex.dominant, tuning, full ? 4096 : undefined);
    variants.push([label, await sharp(Buffer.from(v.svg), { density: 72 }).resize(img.width, img.height, { fit: "fill" }).png().toBuffer()]);
  }
  const gap = 16;
  const tiles = await Promise.all(variants.map(async ([, buf], i) => ({ input: await sharp(buf).extract(crop).png().toBuffer(), left: i * (crop.width + gap), top: 0 })));
  await sharp({ create: { width: variants.length * (crop.width + gap) - gap, height: crop.height, channels: 4, background: "#ffffff" } })
    .composite(tiles)
    .png()
    .toFile(path.join(shots, "contour-plan3-original-poc-tresfin-polygone.png"));
  console.log("capture :", path.join(shots, "contour-plan3-original-poc-tresfin-polygone.png"));
}
