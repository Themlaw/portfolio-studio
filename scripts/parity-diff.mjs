#!/usr/bin/env node
/**
 * Diff pixel à pixel de deux séries de captures de parité
 * (scripts/parity-shots.mjs) : pour chaque image, identique, ou nombre de
 * pixels différents et boîte englobante (en px). Écrit aussi une image
 * côte à côte (avant | après | différences en rouge) par page qui diffère.
 * Usage : node scripts/parity-diff.mjs <labelAvant> <labelAprès> [preset…]
 */
import { existsSync, mkdirSync, readdirSync } from "node:fs";

import sharp from "sharp";

const [before, after, ...wanted] = process.argv.slice(2);
if (!before || !after) throw new Error("usage : parity-diff.mjs <avant> <après> [preset…]");
const root = new URL("../screenshots/parity/", import.meta.url).pathname;
const out = `${root}diff-${before}-${after}/`;
mkdirSync(out, { recursive: true });
let differing = 0;
for (const preset of readdirSync(`${root}${before}`)) {
  if (wanted.length && !wanted.includes(preset)) continue;
  if (!existsSync(`${root}${after}/${preset}`)) continue;
  for (const file of readdirSync(`${root}${before}/${preset}`)) {
    const a = await sharp(`${root}${before}/${preset}/${file}`).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
    const b = await sharp(`${root}${after}/${preset}/${file}`).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
    if (a.info.width !== b.info.width || a.info.height !== b.info.height) {
      differing++;
      console.log(`${preset}/${file} : TAILLE ${a.info.width}×${a.info.height} → ${b.info.width}×${b.info.height}`);
      continue;
    }
    const { width, height } = a.info;
    const mask = Buffer.alloc(width * height * 4);
    let n = 0;
    let [x0, y0, x1, y1] = [width, height, -1, -1];
    for (let i = 0; i < width * height; i++) {
      const o = i * 4;
      const same = a.data[o] === b.data[o] && a.data[o + 1] === b.data[o + 1] && a.data[o + 2] === b.data[o + 2];
      if (same) {
        mask[o] = a.data[o] >> 2;
        mask[o + 1] = a.data[o + 1] >> 2;
        mask[o + 2] = a.data[o + 2] >> 2;
      } else {
        n++;
        mask[o] = 255;
        const x = i % width;
        const y = (i / width) | 0;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
      mask[o + 3] = 255;
    }
    if (!n) {
      console.log(`${preset}/${file} : identique`);
      continue;
    }
    differing++;
    console.log(`${preset}/${file} : ${n} px différents, boîte x ${x0}–${x1}, y ${y0}–${y1}`);
    const tile = (buf) => sharp(buf, { raw: { width, height, channels: 4 } }).png().toBuffer();
    await sharp({ create: { width: width * 3 + 40, height, channels: 4, background: "#ffffff" } })
      .composite([
        { input: await tile(a.data), left: 0, top: 0 },
        { input: await tile(b.data), left: width + 20, top: 0 },
        { input: await tile(mask), left: width * 2 + 40, top: 0 },
      ])
      .png()
      .toFile(`${out}${preset}-${file}`);
  }
}
console.log(differing ? `${differing} capture(s) différente(s) — côte à côte dans ${out}` : "toutes identiques");
