#!/usr/bin/env node
/**
 * Contraste au pixel des éléments dessinés teintés (icônes, traits, signature)
 * du thème de test : pour chaque élément, capture de sa boîte, couleur de fond
 * dominante, couleur la plus contrastée ; seuil 3:1 (WCAG 1.4.11, éléments
 * graphiques). Barre du rail : épaisseur d'encre de la poignée colonne par
 * colonne (≥ 3 px au plus mince), longueur couverte (≥ 95 % de sa boîte :
 * longueur proportionnelle), piste perceptible (≥ 1.5:1 hors poignée).
 * Serveur dev (aperçu /api/theme-preview).
 * Usage : PORT=3001 node scripts/kit-poc/kit-contrast.mjs [thème]
 */
import { chromium } from "playwright";
import sharp from "sharp";

const theme = process.argv[2] ?? "kit-a";
const B = `http://localhost:${process.env.PORT ?? 3001}`;
const lum = ([r, g, b]) => {
  const c = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

/** Géométrie visible de la barre du rail (voir en-tête). */
async function railGeometry(page) {
  const bar = page.locator(".rail-bar").first();
  await bar.scrollIntoViewIfNeeded();
  const b = await bar.boundingBox();
  const t = await page.locator(".rail-bar-thumb").first().boundingBox();
  const clip = { x: b.x, y: b.y - 4, width: b.width, height: b.height + 8 };
  const { data, info } = await sharp(await page.screenshot({ clip })).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (x, y) => [data[(y * info.width + x) * 3], data[(y * info.width + x) * 3 + 1], data[(y * info.width + x) * 3 + 2]];
  const bg = at(0, 0);
  const t0 = Math.round(t.x - clip.x);
  const t1 = Math.min(info.width, Math.round(t.x + t.width - clip.x));
  const thick = [];
  for (let x = t0; x < t1; x++) {
    let n = 0;
    for (let y = 0; y < info.height; y++) if (ratio(at(x, y), bg) >= 3) n++;
    thick.push(n);
  }
  const inked = thick.filter((n) => n > 0).length / Math.max(1, thick.length);
  // Poignée privée de ses 2 % d'extrémités (pointes du trait) : épaisseur au plus mince.
  const core = thick.slice(Math.floor(thick.length * 0.02), Math.ceil(thick.length * 0.98)).sort((a, z) => a - z);
  let track = 1;
  for (let x = 0; x < info.width; x++) {
    if (x >= t0 - 2 && x < t1 + 2) continue;
    for (let y = 0; y < info.height; y++) track = Math.max(track, ratio(at(x, y), bg));
  }
  return { minThick: core[0] ?? 0, medThick: core[core.length >> 1] ?? 0, inked, track: Math.round(track * 100) / 100, thumbW: Math.round(t.width), barW: Math.round(b.width) };
}

async function measure(page, selector, label) {
  const el = page.locator(selector).first();
  if (!(await el.count()) || !(await el.first().isVisible())) return { label, missing: true };
  await el.scrollIntoViewIfNeeded();
  const box = await el.boundingBox();
  const pad = 6;
  const png = await page.screenshot({ clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + 2 * pad, height: box.height + 2 * pad } });
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const counts = new Map();
  for (let i = 0; i < data.length; i += 3) {
    const k = `${data[i] >> 2},${data[i + 1] >> 2},${data[i + 2] >> 2}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const bgKey = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0].split(",").map(Number);
  const bg = bgKey.map((v) => v * 4 + 2);
  let best = 1;
  let fg = bg;
  for (let i = 0; i < data.length; i += 3) {
    const px = [data[i], data[i + 1], data[i + 2]];
    const r = ratio(px, bg);
    if (r > best) {
      best = r;
      fg = px;
    }
  }
  const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  return { label, ratio: Math.round(best * 100) / 100, fg: hex(fg), bg: hex(bg), w: info.width, h: info.height };
}

const browser = await chromium.launch({ args: ["--disable-gpu"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const go = async (path) => {
  await page.goto(`${B}/api/theme-preview?id=${theme}&redirect=${encodeURIComponent(path)}&banner=0`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
};
const results = [];
await go("/fr/personnages");
results.push(await measure(page, ".site-signature", "signature (encre)"));
results.push(await measure(page, '.nav-underline[class*="w-full"]', "soulignement actif (primaire)"));
// Flèches de la bande (v0.14, `--strip-nav-*`) : effacées tant que la bande n'est pas survolée.
const rail0 = page.locator(".strip-frame").first();
await rail0.scrollIntoViewIfNeeded();
await rail0.hover();
await page.waitForTimeout(500);
results.push(await measure(page, '.strip-nav-next:not(:disabled) [data-icon="arrow-right"]', "flèche de la bande"));
results.push(await measure(page, ".rail-bar-thumb", "barre du rail (primaire)"));
const rail = await railGeometry(page);
const strip = page.locator(".strip").filter({ has: page.locator(".strip-frame:nth-child(2)") }).first();
await strip.locator(".strip-frame").first().click();
await page.locator(".lightbox-frame").waitFor();
await page.waitForTimeout(700);
results.push(await measure(page, '.lightbox [data-icon="close"]', "fermer (visionneuse)"));
results.push(await measure(page, '.lightbox [data-icon="arrow-right"]', "flèche (visionneuse)"));
await page.keyboard.press("Escape");
await go("/fr/animation");
results.push(await measure(page, '[data-icon="play"]', "lecture"));
await browser.close();
let failures = 0;
for (const r of results) {
  // Un thème sans kit n'a ni signature ni soulignement dessinés : sans objet.
  const skip = r.missing && !/^kit/.test(theme);
  const pass = skip || (!r.missing && r.ratio >= 3);
  if (!pass) failures++;
  console.log(`${skip ? "SKIP" : pass ? "PASS" : "FAIL"}  ${r.label} : ${r.missing ? "absent" : `${r.ratio}:1 (${r.fg} sur ${r.bg})`}`);
}
{
  const pass = rail.minThick >= 3 && rail.inked >= 0.95 && rail.track >= 1.5;
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  barre du rail, géométrie : poignée ${rail.thumbW}/${rail.barW} px encrée sur ${Math.round(rail.inked * 100)} %, épaisseur min ${rail.minThick} px (médiane ${rail.medThick}) ; piste ${rail.track}:1`);
}
process.exit(failures ? 1 : 0);
