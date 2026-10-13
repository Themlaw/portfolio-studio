/** Images de test du lot 17d (planche de 4 personnages, dégradés à rayures) : partagées par e2e-crop et e2e-crop-http. */
import sharp from "sharp";

/** Planche d'export : 4 personnages (2 × 2), chacun d'une couleur et de fines rayures verticales (un flou se voit). */
export async function sheet() {
  const w = 4800;
  const h = 2400;
  const colors = [
    [220, 40, 40],
    [40, 200, 60],
    [50, 80, 230],
    [230, 210, 40],
  ];
  const buf = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = colors[(y >= h / 2 ? 2 : 0) + (x >= w / 2 ? 1 : 0)];
      const dim = x % 40 < 3 ? 60 : 0;
      const i = (y * w + x) * 3;
      buf[i] = c[0] - dim;
      buf[i + 1] = c[1] - dim;
      buf[i + 2] = c[2] - dim;
    }
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png({ compressionLevel: 6 }).toBuffer();
}
const COLORS = { red: [220, 40, 40], green: [40, 200, 60], blue: [50, 80, 230], yellow: [230, 210, 40] };
/** Couleur de personnage la plus proche de la moyenne d'une image. */
export async function perso(buffer) {
  const s = await sharp(buffer).stats();
  const m = s.channels.slice(0, 3).map((c) => c.mean);
  return Object.entries(COLORS).sort((a, b) => dist(a[1], m) - dist(b[1], m))[0][0];
}
const dist = (a, b) => a.reduce((t, v, i) => t + (v - b[i]) ** 2, 0);

/** Dégradé à rayures (portrait, panorama). */
export async function paint(w, h, seed) {
  const buf = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const stripe = x % 40 < 3 ? 60 : 0;
      buf[i] = ((x * 255) / w + seed * 40 + stripe) & 255;
      buf[i + 1] = ((y * 255) / h + stripe) & 255;
      buf[i + 2] = (seed * 90 + stripe + (x + y) / 40) & 255;
    }
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png({ compressionLevel: 6 }).toBuffer();
}

