import { writeFileSync } from "node:fs";
import sharp from "sharp";
// JPEG de base (non progressif) de 100 Mpx (10000 × 10000) : l'image « lourde » du scénario de l'audit.
const noise = Buffer.alloc(1000 * 1000 * 3);
for (let i = 0; i < noise.length; i++) noise[i] = (i * 7919 + (i >> 9) + (i >> 3)) & 255;
const tile = await sharp(noise, { raw: { width: 1000, height: 1000, channels: 3 } }).png().toBuffer();
const buf = await sharp({ create: { width: 10000, height: 10000, channels: 3, background: { r: 60, g: 90, b: 130 } } })
  .composite(Array.from({ length: 10 }, (_, i) => ({ input: tile, left: i * 1000, top: i * 1000 })).concat(Array.from({ length: 9 }, (_, i) => ({ input: tile, left: (i + 1) * 1000, top: i * 1000 }))))
  .jpeg({ quality: 82, progressive: false })
  .toBuffer();
writeFileSync(process.argv[2], buf);
console.log("big.jpg", buf.length);
