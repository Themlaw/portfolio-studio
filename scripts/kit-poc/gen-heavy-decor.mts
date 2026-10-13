/**
 * Décor « lourd » légitime pour mesurer l'import (kit v4) : N plans pleine toile
 * (5760 × 3200), dégradés doux + grain, écrits par ag-psd (RLE). Sert à mesurer
 * le pic mémoire de l'import dans le processus enfant (docs/THEME-KIT.md).
 * Usage : node --import tsx scripts/kit-poc/gen-heavy-decor.mts <sortie.psd> [plans=8] [grain=6]
 */
import { writeFileSync } from "node:fs";

import { writePsdBuffer } from "ag-psd";

import { ensureAgPsd } from "@/lib/kit/ag-psd-node";
import { DECOR_CANVAS, DECOR_HEAD, KIT_FILES } from "@/lib/kit/spec";

const [out, n = "8", grain = "6"] = process.argv.slice(2);
ensureAgPsd();
const W = DECOR_CANVAS.width;
const H = DECOR_CANVAS.height;
const children = [];
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
for (let k = 0; k < Number(n); k++) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    const gy = y / H;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const g = (Math.sin(x / 700 + k) * 0.5 + 0.5) * 60 + gy * 120 + k * 8;
      const noise = (rnd() - 0.5) * Number(grain) * 2;
      data[i] = g + noise;
      data[i + 1] = g * 0.9 + noise;
      data[i + 2] = g * 0.8 + noise;
      // plans 2+ : transparents dans leur moitié haute (un plan opaque serait refusé)
      data[i + 3] = k === 0 || y > H * 0.45 ? 255 : 0;
    }
  }
  children.push({ name: k === 0 ? "ciel" : `plan ${k + 1}`, left: 0, top: DECOR_HEAD, right: W, bottom: DECOR_HEAD + H, imageData: { width: W, height: H, data } });
}
const buf = writePsdBuffer({ width: KIT_FILES.decor.doc.width, height: KIT_FILES.decor.doc.height, children }, { noBackground: true });
writeFileSync(out, buf);
console.log(`${out} : ${Math.round(buf.length / 1048576)} Mo, ${n} plans pleine toile`);
