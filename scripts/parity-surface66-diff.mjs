#!/usr/bin/env node
/**
 * Compare deux séries de captures de scripts/parity-surface66.mjs au pixel : identique, ou nombre de pixels différents et boîte englobante.
 * Écrit aussi une image « avant | après | écarts en rouge » par capture qui diffère.
 * Usage : node scripts/parity-surface66-diff.mjs <dossierAvant> <dossierAprès> <dossierSortie>
 */
import { mkdirSync, readdirSync } from "node:fs";

import sharp from "sharp";

const [A, B, OUT] = process.argv.slice(2);
if (!A || !B || !OUT) throw new Error("usage : parity-surface66-diff.mjs <avant> <après> <sortie>");
mkdirSync(OUT, { recursive: true });
let diff = 0;
for (const f of readdirSync(A).filter((x) => x.endsWith(".png")).sort()) {
  const a = await sharp(`${A}/${f}`).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  const b = await sharp(`${B}/${f}`).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) {
    diff++;
    console.log(`${f} : TAILLE ${a.info.width}x${a.info.height} -> ${b.info.width}x${b.info.height}`);
    continue;
  }
  const { width, height } = a.info;
  let n = 0;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  const red = Buffer.from(b.data);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) {
        n++;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        red[i] = 255; red[i + 1] = 0; red[i + 2] = 0;
      }
    }
  if (!n) console.log(`${f} : IDENTIQUE (${width}x${height})`);
  else {
    diff++;
    console.log(`${f} : ${n} px différents, boîte x ${x0}-${x1}, y ${y0}-${y1} (${width}x${height})`);
    await sharp(red, { raw: { width, height, channels: 4 } }).png().toFile(`${OUT}/ecarts-${f}`);
  }
}
console.log(diff ? `${diff} capture(s) diffèrent` : "TOUTES IDENTIQUES");
process.exit(diff ? 1 : 0);
