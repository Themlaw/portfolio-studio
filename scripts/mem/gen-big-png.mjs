import { writeFileSync } from "node:fs";
import sharp from "sharp";
// PNG 8 bits entrelacé (Adam7) de 20000 × 4000 (80 Mpx, ~320 Mo décodé en RGBA) : l'image lourde de l'audit (mesurée 556-585 Mo seule).
const noise = Buffer.alloc(1000 * 1000 * 3);
for (let i = 0; i < noise.length; i++) noise[i] = (i * 7919 + (i >> 9) + (i >> 3)) & 255;
const tile = await sharp(noise, { raw: { width: 1000, height: 1000, channels: 3 } }).png().toBuffer();
const comp = [];
for (let i = 0; i < 20; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2 === 0) comp.push({ input: tile, left: i * 1000, top: j * 1000 });
const buf = await sharp({ create: { width: 20000, height: 4000, channels: 4, background: { r: 60, g: 90, b: 130, alpha: 1 } } })
  .composite(comp)
  .png({ progressive: true, compressionLevel: 3 })
  .toBuffer();
writeFileSync(process.argv[2], buf);
console.log("big.png", buf.length);
