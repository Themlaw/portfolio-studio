#!/usr/bin/env node
/**
 * Non-régression : repli WebP pour les images raster du kit (logo, papier, cadres, …)
 * sur les navigateurs sans `image-set(… type())`.
 * Usage : node --import tsx scripts/test-kitimage-fallback.mjs
 */
import assert from "node:assert/strict";

const { PRESETS } = await import(new URL("../src/themes/presets/index.ts", import.meta.url));
const { ThemeSchema } = await import(new URL("../src/themes/schema.ts", import.meta.url));
const { themeToCss, kitVariables } = await import(new URL("../src/themes/css.ts", import.meta.url));
const { frameLibraryCss } = await import(new URL("../src/themes/frame-library.ts", import.meta.url));

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? " — " + detail : ""}`);
};

const base = PRESETS["galerie-lumineuse"];
const H = (n) => n.toString(16).padStart(16, "0");
const AVIF = (n) => `/media/kit/${H(n)}.avif`;
const WEBP = (n) => `/media/kit/${H(n)}.webp`;
const SVG = (n) => `/media/kit/${H(n)}.svg`;
const imgRaster = (n, w = 100, h = 50) => ({ avif: AVIF(n), webp: WEBP(n), w, h });
const imgSvg = (n, w = 100, h = 50) => ({ svg: SVG(n), w, h });

const kit = {
  signature: { ...imgRaster(1, 1200, 300), colors: true },
  paper: { image: imgRaster(2, 512, 512), overHero: 0.35 },
  frame: { image: imgRaster(3, 300, 300), slice: [48, 48, 48, 48] },
  stroke: { ...imgSvg(4, 1200, 80), color: { avif: AVIF(5), webp: WEBP(5) } },
  icons: { arrowLeft: { ...imgSvg(6, 128, 128), color: { avif: AVIF(7), webp: WEBP(7) } }, close: imgSvg(8, 64, 64) },
  vicons: { badge: imgRaster(9, 64, 64) },
  tape: imgRaster(10, 400, 160),
  boil: { signature: [imgRaster(11, 1200, 300)], frame: [imgRaster(12, 300, 300)] },
};

const theme = ThemeSchema.parse({ ...base, id: "test-kitimage", preset: false, assets: { ...base.assets, kit } });
const css = themeToCss(theme);

function splitSupports(s) {
  const i = s.indexOf("@supports");
  if (i === -1) return { outside: s, inside: "" };
  const start = s.indexOf("{", i);
  let depth = 0, j = start;
  for (; j < s.length; j++) {
    if (s[j] === "{") depth++;
    else if (s[j] === "}") { depth--; if (depth === 0) break; }
  }
  return { outside: s.slice(0, i) + s.slice(j + 1), inside: s.slice(start + 1, j) };
}
const { outside, inside } = splitSupports(css);

ok("un bloc @supports est émis", inside.length > 0, css.slice(0, 200));
ok("aucun image-set( hors @supports", !outside.includes("image-set("), outside.slice(0, 300));

// Variables raster : valeur par défaut url("….webp") hors @supports.
const rasterVars = [
  "--t-kit-signature",
  "--t-kit-paper",
  "--t-kit-frame",
  "--t-kit-stroke-color",
  "--t-kit-icon-arrow-left-color",
  "--t-kit-vicon-badge",
  "--t-kit-tape",
  "--t-kit-boil-signature-1",
  "--t-kit-boil-frame-1",
];
for (const name of rasterVars) {
  const re = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ':url\\("' + "[^)]*\\.webp" + '"\\)');
  ok(`${name} : url("….webp") hors @supports`, re.test(outside), outside.match(new RegExp(name + ":[^;]*;"))?.[0]);
}

// Variante image-set(…type("image/avif")…) à l'intérieur du @supports.
ok("image-set type(image/avif) présent dans @supports", /image-set\(url\("[^"]*\.avif"\) type\("image\/avif"\)/.test(inside), inside.slice(0, 200));
for (const name of rasterVars) {
  const re = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ':image-set\\(');
  ok(`${name} : image-set( dans @supports`, re.test(inside));
}

// SVG et masques inchangés : url("….svg"), jamais image-set.
ok("--t-kit-icon-close : url svg hors @supports", /--t-kit-icon-close:url\("[^"]*\.svg"\)/.test(outside));
ok("--t-kit-stroke (masque) : url (pas image-set) hors @supports", /--t-kit-stroke:url\(/.test(outside) && !/--t-kit-stroke:image-set/.test(outside));

// frame-library : urlOf repli WebP + @supports.
const entry = {
  id: "cadre-test",
  name: "cadre",
  image: { avif: AVIF(20), webp: WEBP(20), w: 100, h: 100 },
  slice: [10, 10, 10, 10],
  thickness: 5,
  detected: false,
  createdAt: 0,
};
const frameCss = frameLibraryCss([entry]);
const fi = splitSupports(frameCss);
ok("frame-library : border-image-source url(webp) hors @supports", /border-image-source:url\("[^"]*\.webp"\)/.test(fi.outside));
ok("frame-library : aucun image-set hors @supports", !fi.outside.includes("image-set("));
ok("frame-library : image-set type(avif) dans @supports", /image-set\(url\("[^"]*\.avif"\) type\("image\/avif"\)/.test(fi.inside));

if (failures) {
  console.error(`\ntest-kitimage-fallback : ${failures} échec(s)`);
  process.exit(1);
}
console.log("\ntest-kitimage-fallback : OK");
