/**
 * Export du kit v2 pré-rempli d'un thème livré, puis relecture ag-psd
 * (aller-retour : arborescence, emplacements résolus, identifiant d'export).
 * Usage : node --expose-gc --import tsx scripts/kit-poc/export-kit.mts <sortie.psd> [thème] [--shots <dossier>] [--manifests <dossier>]
 *   --shots     : arborescence des calques (texte + PNG) et rendu composite (vue d'ensemble)
 *   --manifests : dossier où écrire le manifeste (sinon à côté du PSD)
 *   SITE_NAME   : nom du site (signature pré-remplie), défaut « Camille Roussel »
 */
import { readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { readPsd, type Layer } from "ag-psd";
import sharp from "sharp";

import { ensureAgPsd } from "@/lib/kit/ag-psd-node";
import { buildKit } from "@/lib/kit/build";
import { exportIdOf } from "@/lib/kit/manifest";
import { layoutOf, resolveSlots } from "@/lib/kit/resolve";
import { ALL_SLOTS as SLOTS, DOC, KIT_VERSION } from "@/lib/kit/spec";
import { themeVersion } from "@/lib/kit/version";
import { PRESETS } from "@/themes/presets";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const shots = opt("--shots");
const manifestDir = opt("--manifests") ?? path.dirname(path.resolve(args[0]));
const [outFile, themeId = "galerie-lumineuse"] = args;
const theme = PRESETS[themeId];
if (!theme) throw new Error(`thème inconnu : ${themeId}`);

const siteName = process.env.SITE_NAME ?? "Camille Roussel";
const version = themeVersion(theme, siteName);
const exportId = exportIdOf(theme.id, version, KIT_VERSION);
const t0 = Date.now();
if (shots) await mkdir(shots, { recursive: true });
const compositeFile = shots ? path.join(shots, "composite-source.png") : undefined;
const { psd, stats } = await buildKit(theme, path.resolve("public"), { exportId, themeVersion: version, siteName, manifestDir, compositeFile });
const buildMs = Date.now() - t0;
writeFileSync(outFile, psd);
const buildPeak = Math.round(process.resourceUsage().maxRSS / 1024);

ensureAgPsd();
const back = readPsd(readFileSync(outFile), { useImageData: true, skipCompositeImageData: !shots, skipLayerImageData: true, skipThumbnail: true });
const layout = layoutOf(back.width, back.height);
const res = resolveSlots(back.children, layout ?? "v2");
const missing = SLOTS.filter((s) => !res.sources.has(s.id)).map((s) => s.id);

// Arborescence telle que Photoshop l'affiche (du haut vers le bas).
const lines: string[] = [];
const tree = (list: Layer[] | undefined, depth: number) => {
  for (const l of [...(list ?? [])].reverse()) {
    const lock = l.protected?.position ? " [verrouillé]" : "";
    const size = l.children ? "" : `  ${(l.right ?? 0) - (l.left ?? 0)} × ${(l.bottom ?? 0) - (l.top ?? 0)} à (${l.left}, ${l.top})`;
    lines.push(`${"    ".repeat(depth)}${l.children ? "▾ " : "  "}${l.name}${lock}${size}`);
    tree(l.children, depth + 1);
  }
};
tree(back.children, 0);

let compositeCheck = "non vérifié";
if (shots) {
  writeFileSync(path.join(shots, "kit-v2-calques.txt"), `${lines.join("\n")}\n`);
  // Panneau « Calques » rendu en image (texte de l'arborescence).
  const font = path.resolve("public/kit/Figtree.ttf");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const text = await sharp({ text: { text: `<span foreground="#1f2226">${lines.map((l) => esc(l).replace(/^( +)/, (m) => " ".repeat(m.length))).join("\n")}</span>`, fontfile: font, font: "Figtree 22", rgba: true, dpi: 72, spacing: 8 } })
    .png()
    .toBuffer({ resolveWithObject: true });
  await sharp({ create: { width: text.info.width + 60, height: text.info.height + 60, channels: 4, background: "#f4f5f7" } })
    .composite([{ input: text.data, left: 30, top: 30 }])
    .png()
    .toFile(path.join(shots, "kit-v2-calques.png"));
  const img = back.imageData!;
  // Composite réencodé (RLE maison) : identique au PNG composé ?
  const ref = await sharp(compositeFile!).removeAlpha().raw().toBuffer();
  let diff = 0;
  for (let i = 0, j = 0; j < ref.length; i += 4, j += 3) if (img.data[i] !== ref[j] || img.data[i + 1] !== ref[j + 1] || img.data[i + 2] !== ref[j + 2]) diff++;
  compositeCheck = diff === 0 ? "identique" : `${diff} pixels différents`;
  await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), { raw: { width: img.width, height: img.height, channels: 4 } })
    .resize({ width: 2000 })
    .png()
    .toFile(path.join(shots, "kit-v2-vue-ensemble.png"));
  await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), { raw: { width: img.width, height: img.height, channels: 4 } })
    .extract({ left: 0, top: 2070, width: 2400, height: 1930 })
    .png()
    .toFile(path.join(shots, "kit-v2-detail-100.png"));
  // Carte « 2 · Signature » à 100 % (nom du site pré-rempli dans la police de titre).
  await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length), { raw: { width: img.width, height: img.height, channels: 4 } })
    .extract({ left: 0, top: 2070, width: 2310, height: 650 })
    .png()
    .toFile(path.join(shots, "kit-v2-signature-100.png"));
}

console.log(
  JSON.stringify({
    file: outFile,
    mb: Math.round((psd.length / 1024 / 1024) * 10) / 10,
    buildMs,
    buildPeakMb: buildPeak,
    stats,
    roundTrip: {
      width: back.width,
      height: back.height,
      dimsOk: back.width === DOC.width && back.height === DOC.height,
      layout,
      composite: compositeCheck,
      exportIdRead: res.exportId,
      exportIdOk: res.exportId === exportId,
      slots: res.sources.size,
      missing,
      ignored: res.ignored,
      topLevel: [...(back.children ?? [])].reverse().map((l) => l.name),
    },
  }),
);
