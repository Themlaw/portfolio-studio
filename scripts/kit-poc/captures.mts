/**
 * Captures avant / après du kit PSD (phase 6b) : calque d'origine (rogné) à
 * gauche, rendu du format retenu à droite (SVG rastérisé, ou AVIF décodé), sur
 * damier ; plus un détail à 100 % (bords « faits main »).
 * Usage : node --import tsx scripts/kit-poc/captures.mts <sortie de run-import --keep> <dossier des captures>
 */
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

const [outDir, shots] = process.argv.slice(2);
mkdirSync(shots, { recursive: true });
const report = JSON.parse(readFileSync(path.join(outDir, "rapport.json"), "utf8")) as { slots: { id: string; chosen?: string; bytes?: number; candidates?: { svg?: number; avif?: number } }[] };

const INK = "#2a2c33";

async function checker(w: number, h: number): Promise<Buffer> {
  const s = 16;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><pattern id="c" width="${2 * s}" height="${2 * s}" patternUnits="userSpaceOnUse"><rect width="${2 * s}" height="${2 * s}" fill="#fff"/><rect width="${s}" height="${s}" fill="#e6e6e6"/><rect x="${s}" y="${s}" width="${s}" height="${s}" fill="#e6e6e6"/></pattern></defs><rect width="${w}" height="${h}" fill="url(#c)"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Rendu du format retenu à la taille de la source. */
async function rendered(base: string, chosen: string, w: number, h: number): Promise<Buffer> {
  if (chosen === "avif") return sharp(path.join(outDir, `${base}.avif`)).resize(w, h).png().toBuffer();
  let svg = readFileSync(path.join(outDir, chosen === "svg-mask" ? `${base}.mask.svg` : `${base}.svg`), "utf8");
  // Masque : la forme prend la couleur d'encre (comme mask-image + background-color).
  if (chosen === "svg-mask") svg = svg.replace(/fill="(#0{3}|#0{6}|black)"/gi, `fill="${INK}"`).replace(/<path(?![^>]*fill=)/g, `<path fill="${INK}"`);
  return sharp(Buffer.from(svg), { density: 300 }).resize(w, h, { fit: "fill" }).png().toBuffer();
}

async function sideBySide(id: string, file: string, maxW: number, detail?: { x: number; y: number; w: number; h: number }) {
  const slot = report.slots.find((s) => s.id === id);
  if (!slot?.chosen) return console.log(`${id} : pas de rendu`);
  const base = id.replace(/\//g, "--");
  const src = path.join(outDir, `${base}.source.png`);
  const meta = await sharp(src).metadata();
  const w = meta.width!;
  const h = meta.height!;
  const out = await rendered(base, slot.chosen, w, h);
  const scale = Math.min(1, maxW / w);
  const sw = Math.round(w * scale);
  const sh = Math.round(h * scale);
  const gap = 24;
  const tiles: { input: Buffer; left: number; top: number }[] = [];
  const bg = await checker(sw * 2 + gap, sh);
  tiles.push({ input: await sharp(src).resize(sw, sh).png().toBuffer(), left: 0, top: 0 });
  tiles.push({ input: await sharp(out).resize(sw, sh).png().toBuffer(), left: sw + gap, top: 0 });
  await sharp(bg).composite(tiles).png().toFile(path.join(shots, `${file}.png`));
  if (detail) {
    const d = { left: detail.x, top: detail.y, width: Math.min(detail.w, w - detail.x), height: Math.min(detail.h, h - detail.y) };
    const bgd = await checker(d.width * 2 + gap, d.height);
    await sharp(bgd)
      .composite([
        { input: await sharp(src).extract(d).png().toBuffer(), left: 0, top: 0 },
        { input: await sharp(out).extract(d).png().toBuffer(), left: d.width + gap, top: 0 },
      ])
      .png()
      .toFile(path.join(shots, `${file}-detail-100.png`));
  }
  console.log(`${file} : ${slot.chosen}, ${slot.bytes} o (SVG ${slot.candidates?.svg ?? "—"} / AVIF ${slot.candidates?.avif ?? "—"})`);
}

await sideBySide("hero/plan-3", "plan-aplats", 1400, { x: 900, y: 0, w: 600, h: 260 });
await sideBySide("hero/plan-1", "plan-texture", 1400, { x: 1200, y: 600, w: 600, h: 300 });
await sideBySide("icones/fleche-droite", "icone-fleche-droite", 512);
await sideBySide("icones/fermer", "icone-fermer-effet", 512);
await sideBySide("trait", "trait", 1200, { x: 0, y: 0, w: 400, h: 80 });
await sideBySide("signature", "signature", 1200);
await sideBySide("accessoires/scotch", "scotch-transparence", 800);
