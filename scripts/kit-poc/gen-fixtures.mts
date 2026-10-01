/**
 * Jeux de test du kit PSD (phase 6b), générés et légitimes (ag-psd + sharp) :
 *  - A « réaliste » : plans en aplats aux bords irréguliers « faits main »,
 *    ciel peint (grain + dégradé), papier qui se raccorde, cadre, icônes et
 *    trait épais irréguliers, un calque avec effet de calque déclaré, noms
 *    écrits librement (casse, accents, espaces) ;
 *  - B « lourd » : A + calques pleine toile de brouillon (~200 Mo).
 * Usage : node --import tsx scripts/kit-poc/gen-fixtures.mts <dossier> [A|B|all]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { writePsdBuffer, type Layer } from "ag-psd";
import sharp from "sharp";

import { DOC_V1 as DOC, frameOf, SLOTS, type SlotSpec } from "@/lib/kit/spec";

/** Kit v1 (fixtures de la phase 6b) : nom du calque et groupe d'origine. */
const v1Layer = (s: SlotSpec) => s.aliases[0];
const v1Group = (s: SlotSpec) => (s.kind === "plan" ? "hero" : s.kind === "icon" ? "icones" : s.kind === "tape" ? "accessoires" : null);

const out = process.argv[2] ?? "/tmp/kit-poc";
const which = process.argv[3] ?? "all";
mkdirSync(out, { recursive: true });

// Hasard reproductible.
let seed = 42;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
type Raster = { width: number; height: number; data: Uint8ClampedArray };

async function svgRaster(svg: string, w: number, h: number): Promise<Raster> {
  const { data, info } = await sharp(Buffer.from(svg)).resize(w, h).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

/** Contour « fait main » : profil lent + tremblement de quelques px. */
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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><path d="M -10 ${h + 10} L ${handEdge(w, top, 70, 5)} L ${w + 10} ${h + 10} Z" fill="${color}"/></svg>`;
  return svgRaster(svg, w, h);
}

/** Ciel peint : dégradé vertical + grain. */
function paintedSky(w: number, h: number): Raster {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const t = y / h;
    const r = 120 + 110 * t;
    const g = 150 + 80 * t;
    const b = 210 + 30 * t;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const n = (rand() - 0.5) * 22 + Math.sin(x / 140 + y / 90) * 6;
      data[i] = r + n;
      data[i + 1] = g + n;
      data[i + 2] = b + n;
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/** Papier : fréquences entières sur 512 (raccord parfait) + grain. */
function paperTile(size: number): Raster {
  const data = new Uint8ClampedArray(size * size * 4);
  const k = (2 * Math.PI) / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const fibre = Math.sin(3 * k * x + 2 * k * y) * 4 + Math.sin(7 * k * y) * 3 + Math.cos(11 * k * x) * 2;
      const v = 238 + fibre + (rand() - 0.5) * 10;
      data[i] = v + 4;
      data[i + 1] = v;
      data[i + 2] = v - 10;
      data[i + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

/** Polyligne tremblée (icône, trait, signature). */
function wobbly(points: [number, number][], jitter: number): string {
  return points.map(([x, y], i) => `${i ? "L" : "M"} ${(x + (rand() - 0.5) * jitter).toFixed(1)} ${(y + (rand() - 0.5) * jitter).toFixed(1)}`).join(" ");
}

/** Trait épais à l'épaisseur irrégulière : polygone autour d'une ligne médiane. */
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
      if (n === 1) return paintedSky(w, h);
      return flatPlan(slot, ["", "", "#a8b4cf", "#7d88a6", "#4f5873", "#2b3044"][n]);
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
  }
}

/** Noms écrits « librement » (tolérance à vérifier) pour quelques calques. */
const FREE_NAMES: Record<string, string> = { "hero/plan-3": "Plan 3", "icones/fleche-gauche": "Flèche gauche", "accessoires/scotch": "Scotch" };
const FREE_GROUPS: Record<string, string> = { hero: "Héro", icones: "Icônes", accessoires: "Accessoires" };

async function buildFixture(heavy: boolean): Promise<Buffer> {
  const groups = new Map<string | null, Layer[]>();
  for (const slot of SLOTS) {
    const r = await slotRaster(slot);
    const f = frameOf(slot, "v1");
    const layer: Layer = { name: FREE_NAMES[slot.id] ?? v1Layer(slot), left: f.x, top: f.y, right: f.x + r.width, bottom: f.y + r.height, imageData: r };
    // Effet de calque déclaré (ombre portée) : l'import doit demander de pixelliser.
    if (slot.id === "icones/fermer") {
      layer.effects = {
        dropShadow: [{ enabled: true, color: { r: 0, g: 0, b: 0 }, opacity: 0.5, angle: 120, distance: { units: "Pixels", value: 6 }, size: { units: "Pixels", value: 6 }, blendMode: "multiply" }],
      };
    }
    const list = groups.get(v1Group(slot)) ?? [];
    list.push(layer);
    groups.set(v1Group(slot), list);
  }
  const children: Layer[] = [{ name: FREE_GROUPS.hero, children: groups.get("hero") ?? [] }];
  for (const l of groups.get(null) ?? []) children.push(l);
  for (const g of ["icones", "accessoires"]) children.push({ name: FREE_GROUPS[g], children: groups.get(g) ?? [] });
  // Calque inconnu (ignoré, signalé) et guides verrouillés (ignorés).
  children.push({ name: "esquisse perso", left: 100, top: 100, right: 400, bottom: 300, imageData: await svgRaster(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><circle cx="150" cy="100" r="80" fill="red"/></svg>`, 300, 200) });
  children.push({ name: "_guides", protected: { transparency: true, composite: true, position: true }, children: [] });
  if (heavy) {
    // Brouillons pleine toile, bruit peu compressible : ~29 Mo chacun.
    const drafts: Layer[] = [];
    for (let k = 0; k < 7; k++) {
      const data = new Uint8ClampedArray(DOC.width * DOC.height * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = (rand() * 255) | 0;
        data[i + 1] = (rand() * 255) | 0;
        data[i + 2] = (rand() * 255) | 0;
        data[i + 3] = 255;
      }
      drafts.push({ name: `brouillon ${k + 1}`, hidden: true, left: 0, top: 0, right: DOC.width, bottom: DOC.height, imageData: { width: DOC.width, height: DOC.height, data } });
    }
    children.unshift({ name: "brouillons", children: drafts });
  }
  return writePsdBuffer({ width: DOC.width, height: DOC.height, children }, { noBackground: true });
}

for (const [name, heavy] of [
  ["A", false],
  ["B", true],
] as const) {
  if (which !== "all" && which !== name) continue;
  seed = 42;
  const t0 = Date.now();
  const buf = await buildFixture(heavy);
  const file = path.join(out, `kit-${name}.psd`);
  writeFileSync(file, buf);
  console.log(`${file} : ${(buf.length / 1024 / 1024).toFixed(1)} Mo en ${Date.now() - t0} ms, pic ${Math.round(process.resourceUsage().maxRSS / 1024)} Mo`);
}
