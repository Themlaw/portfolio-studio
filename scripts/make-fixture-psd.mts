/**
 * Génère le PSD de test SYNTHÉTIQUE `tests/fixtures/kit-synthetique.psd`
 * (lot 103) et le manifeste du kit v1 « d origine » associé. Aucune donnée réelle :
 * tout est dessiné ici (ag-psd + sharp), avec un hasard reproductible.
 *
 * Il imite le fichier que les tests attendaient : un kit v1 (2880 × 2560, RVB 8 bits,
 * compression RLE comme Photoshop, 14 emplacements) réenregistré, où seule la
 * « flèche droite » a été redessinée (calque recadré à 97 × 85 px, posé au centre de
 * sa case de 128 × 128). Les 13 autres emplacements sont identiques au kit d origine,
 * dont les empreintes sont écrites dans le manifeste.
 *
 * Les deux fichiers ne sont PAS commités (.gitignore) : `npm test` et `scripts/test-all-local.sh` les génèrent
 * s'ils manquent (--if-missing). Les empreintes du manifeste dépendent des pixels rendus sur CETTE machine.
 * Usage : node --import tsx scripts/make-fixture-psd.mts [--out tests/fixtures] [--check] [--if-missing]
 *   --check : régénère en mémoire et échoue si les fichiers du dépôt diffèrent.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { writePsdBuffer, type Layer } from "ag-psd";
import sharp from "sharp";

import { manifestFromPsd } from "@/lib/kit/import";
import { DOC_V1 as DOC, frameOf, SLOTS, type SlotSpec } from "@/lib/kit/spec";

const args = process.argv.slice(2);
const check = args.includes("--check");
const ifMissing = args.includes("--if-missing");
const outIdx = args.indexOf("--out");
const outDir = path.resolve(outIdx >= 0 ? args[outIdx + 1] : "tests/fixtures");

type Raster = { width: number; height: number; data: Uint8ClampedArray };

// Hasard reproductible (même fichier à chaque exécution).
let seed = 1031;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

async function svgRaster(svg: string, w: number, h: number): Promise<Raster> {
  const { data, info } = await sharp(Buffer.from(svg)).resize(w, h).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

const v1Layer = (s: SlotSpec) => s.aliases[0];
const v1Group = (s: SlotSpec) => (s.kind === "plan" ? "hero" : s.kind === "icon" ? "icones" : s.kind === "tape" ? "accessoires" : null);

function handEdge(w: number, base: number, amp: number, jitter: number, step = 6): string {
  const pts: string[] = [];
  const phase = rand() * 10;
  for (let x = -step; x <= w + step; x += step) {
    const y = base + Math.sin(x / (w / 3) + phase) * amp + Math.sin(x / 97 + phase * 2) * amp * 0.25 + (rand() - 0.5) * jitter;
    pts.push(`${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return pts.join(" L ");
}

async function flatPlan(slot: SlotSpec, color: string): Promise<Raster> {
  const { w, h } = slot.size;
  const top = h - (slot.usefulHeight ?? h) + 80;
  return svgRaster(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><path d="M -10 ${h + 10} L ${handEdge(w, top, 70, 5)} L ${w + 10} ${h + 10} Z" fill="${color}"/></svg>`, w, h);
}

function paintedSky(w: number, h: number): Raster {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const t = y / h;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const n = Math.round(Math.sin(y / 90) * 6); // constant par rangée : le RLE reste léger
      data[i] = 120 + 110 * t + n;
      data[i + 1] = 150 + 80 * t + n;
      data[i + 2] = 210 + 30 * t + n;
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

function paperTile(size: number): Raster {
  const data = new Uint8ClampedArray(size * size * 4);
  const k = (2 * Math.PI) / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const v = 238 + Math.sin(3 * k * x + 2 * k * y) * 4 + Math.sin(7 * k * y) * 3 + Math.cos(11 * k * x) * 2;
      data[i] = v + 4;
      data[i + 1] = v;
      data[i + 2] = v - 10;
      data[i + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

const wobbly = (points: [number, number][], jitter: number) => points.map(([x, y], i) => `${i ? "L" : "M"} ${(x + (rand() - 0.5) * jitter).toFixed(1)} ${(y + (rand() - 0.5) * jitter).toFixed(1)}`).join(" ");

function thickStroke(w: number, h: number): string {
  const up: string[] = [];
  const down: string[] = [];
  for (let x = 16; x <= w - 16; x += 8) {
    const mid = h / 2 + Math.sin(x / 90) * 8;
    const half = 9 + Math.sin(x / 37) * 3 + (rand() - 0.5) * 3;
    up.push(`${x} ${(mid - half).toFixed(1)}`);
    down.unshift(`${x} ${(mid + half).toFixed(1)}`);
  }
  return `M ${up.join(" L ")} L ${down.join(" L ")} Z`;
}

async function slotRaster(slot: SlotSpec): Promise<Raster> {
  const { w, h } = slot.size;
  const ink = "#2a2c33";
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">`;
  switch (slot.kind) {
    case "plan": {
      const n = Number(v1Layer(slot).split("-")[1]);
      return n === 1 ? paintedSky(w, h) : flatPlan(slot, ["", "", "#a8b4cf", "#7d88a6", "#4f5873", "#2b3044"][n]);
    }
    case "tile":
      return paperTile(w);
    case "signature": {
      const pts: [number, number][] = [];
      for (let x = 40; x < w - 40; x += 10) pts.push([x, h / 2 + Math.sin(x / 45) * 70 + Math.sin(x / 13) * 18]);
      return svgRaster(`${open}<path d="${wobbly(pts, 3)}" fill="none" stroke="${ink}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/></svg>`, w, h);
    }
    case "nine": {
      const e = 22;
      const pts: [number, number][] = [];
      for (let x = e; x <= w - e; x += 12) pts.push([x, e]);
      for (let y = e; y <= h - e; y += 12) pts.push([w - e, y]);
      for (let x = w - e; x >= e; x -= 12) pts.push([x, h - e]);
      for (let y = h - e; y >= e; y -= 12) pts.push([e, y]);
      return svgRaster(`${open}<path d="${wobbly(pts, 4)} Z" fill="none" stroke="${ink}" stroke-width="16" stroke-linejoin="round"/></svg>`, w, h);
    }
    case "stroke":
      return svgRaster(`${open}<path d="${thickStroke(w, h)}" fill="#2e4e9e"/></svg>`, w, h);
    case "icon": {
      const shapes: Record<string, [number, number][][]> = {
        "fleche-gauche": [[[84, 24], [64, 44], [44, 64], [64, 84], [84, 104]]],
        "fleche-droite": [[[44, 24], [64, 44], [84, 64], [64, 84], [44, 104]]],
        fermer: [[[32, 32], [64, 64], [96, 96]], [[96, 32], [64, 64], [32, 96]]],
        lecture: [[[40, 24], [72, 44], [104, 64], [72, 84], [40, 104], [40, 64], [40, 24]]],
      };
      const d = (shapes[v1Layer(slot)] ?? []).map((p) => wobbly(p, 3)).join(" ");
      const fill = v1Layer(slot) === "lecture" ? ink : "none";
      return svgRaster(`${open}<path d="${d}" fill="${fill}" stroke="${ink}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/></svg>`, w, h);
    }
    case "tape": {
      const pts: [number, number][] = [[24, 44]];
      for (let x = 24; x <= w - 24; x += 20) pts.push([x, 44 + (rand() - 0.5) * 6]);
      for (let y = 44; y <= h - 44; y += 8) pts.push([w - 24 + (rand() - 0.5) * 10, y]);
      for (let x = w - 24; x >= 24; x -= 20) pts.push([x, h - 44 + (rand() - 0.5) * 6]);
      for (let y = h - 44; y >= 44; y -= 8) pts.push([24 + (rand() - 0.5) * 10, y]);
      return svgRaster(`${open}<path d="${wobbly(pts, 1)} Z" fill="#d9c27a" fill-opacity="0.6" transform="rotate(-4 ${w / 2} ${h / 2})"/></svg>`, w, h);
    }
    default:
      return svgRaster(`${open}</svg>`, w, h);
  }
}

/** Flèche « redessinée » : polygone plein de 97 × 85 px (boîte recadrée par l éditeur). */
const REDRAWN = { w: 97, h: 85 };
const redrawnArrow = () =>
  svgRaster(`<svg xmlns="http://www.w3.org/2000/svg" width="${REDRAWN.w}" height="${REDRAWN.h}"><path d="M 0 26 L 52 26 L 52 0 L 97 42.5 L 52 85 L 52 59 L 0 59 Z" fill="#2a2c33"/></svg>`, REDRAWN.w, REDRAWN.h);

async function buildKit(redrawn: boolean): Promise<Buffer> {
  seed = 1031;
  const groups = new Map<string | null, Layer[]>();
  for (const slot of SLOTS) {
    const r = await slotRaster(slot); // toujours tiré, pour garder le même hasard dans les deux versions
    let layer: Layer;
    const f = frameOf(slot, "v1");
    if (redrawn && slot.id === "icones/fleche-droite") {
      const a = await redrawnArrow();
      const ox = Math.round((slot.size.w - a.width) / 2);
      const oy = Math.round((slot.size.h - a.height) / 2);
      layer = { name: v1Layer(slot), left: f.x + ox, top: f.y + oy, right: f.x + ox + a.width, bottom: f.y + oy + a.height, imageData: a };
    } else {
      layer = { name: v1Layer(slot), left: f.x, top: f.y, right: f.x + r.width, bottom: f.y + r.height, imageData: r };
    }
    const list = groups.get(v1Group(slot)) ?? [];
    list.push(layer);
    groups.set(v1Group(slot), list);
  }
  const children: Layer[] = [{ name: "hero", children: groups.get("hero") ?? [] }];
  for (const l of groups.get(null) ?? []) children.push(l);
  for (const g of ["icones", "accessoires"]) children.push({ name: g, children: groups.get(g) ?? [] });
  return writePsdBuffer({ width: DOC.width, height: DOC.height, children }, { noBackground: true });
}

if (ifMissing && existsSync(path.join(outDir, "kit-synthetique.psd")) && existsSync(path.join(outDir, "kit-galerie-lumineuse-v1.manifest.json"))) process.exit(0);
const { ensureAgPsd } = await import("@/lib/kit/ag-psd-node");
ensureAgPsd();
const tmp = mkdtempSync(path.join(os.tmpdir(), "make-fixture-psd-"));
try {
  const original = path.join(tmp, "original.psd");
  writeFileSync(original, await buildKit(false));
  const manifest = await manifestFromPsd(original, { exportId: "legacy-galerie-lumineuse-v1", themeId: "galerie-lumineuse", themeVersion: "legacy" });
  const psd = await buildKit(true);
  const manifestText = JSON.stringify(manifest, null, 1);
  const targets: [string, Buffer | string][] = [
    [path.join(outDir, "kit-synthetique.psd"), psd],
    [path.join(outDir, "kit-galerie-lumineuse-v1.manifest.json"), manifestText],
  ];
  const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex").slice(0, 12);
  if (check) {
    let bad = 0;
    for (const [f, content] of targets) {
      const now = readFileSync(f);
      const same = sha(now) === sha(content);
      console.log(`${same ? "PASS" : "FAIL"}  ${path.basename(f)} ${same ? "identique à la génération" : "diffère"}`);
      if (!same) bad++;
    }
    process.exit(bad ? 1 : 0);
  }
  mkdirSync(outDir, { recursive: true });
  for (const [f, content] of targets) {
    writeFileSync(f, content);
    console.log(`${f} : ${(content.length / 1024).toFixed(0)} Ko`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
