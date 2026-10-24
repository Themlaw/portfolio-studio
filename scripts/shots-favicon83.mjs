#!/usr/bin/env node
/** Lot 83 : planche de contact des icônes (monogramme de chaque forme, thèmes livrés) pour un coup d'œil. Usage : node --import tsx scripts/shots-favicon83.mjs <dossier> */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";

const out = process.argv[2] ?? "/tmp/favicon83";
mkdirSync(out, { recursive: true });
const { PRESETS } = await import("../src/themes/presets/index.ts");
const { planIcon } = await import("../src/lib/favicon-plan.ts");
const { renderSet } = await import("../src/lib/favicon.ts");
const { defaultFaviconConfig } = await import("../src/lib/favicon-spec.ts");

const cells = [];
for (const theme of Object.values(PRESETS)) {
  for (const shape of ["round", "squircle", "none"]) {
    const cfg = defaultFaviconConfig("auto");
    cfg.mono.shape = shape;
    const plan = planIcon({ description: { fr: "", en: "" }, shareImage: null, favicon: null, faviconMode: cfg }, theme, "Camille Roussel");
    const set = await renderSet(plan);
    cells.push({ id: `${theme.id}-${shape}`, p512: set["512.png"], p16: set["16.png"], p32: set["32.png"], mask: set["maskable-512.png"], svg: set["icon.svg"] });
  }
}
const W = 160;
const cols = 6;
const rows = Math.ceil(cells.length / cols);
const comp = [];
for (const [i, c] of cells.entries()) {
  const x = (i % cols) * (W + 8);
  const y = Math.floor(i / cols) * (W + 60);
  comp.push({ input: await sharp(c.p512).resize(W, W).png().toBuffer(), left: x, top: y });
  comp.push({ input: await sharp(c.p16).resize(32, 32, { kernel: "nearest" }).png().toBuffer(), left: x, top: y + W + 4 });
  comp.push({ input: await sharp(c.mask).resize(48, 48).png().toBuffer(), left: x + 40, top: y + W + 4 });
}
await sharp({ create: { width: cols * (W + 8), height: rows * (W + 60), channels: 4, background: "#f1ece4" } }).composite(comp).png().toFile(path.join(out, "monogrammes.png"));
writeFileSync(path.join(out, "premier.svg"), cells[0].svg);
console.log(`ok ${cells.length} icônes, svg ${cells[0].svg.length} octets`);
