#!/usr/bin/env node
/**
 * Captures pleine page des 5 pages publiques (thème actif), pour comparer la
 * mise en page avant / après un resserrement (lot 2). Un seul chromium sobre.
 * Mesure aussi la hauteur de chaque page (sortie JSON) : un resserrement doit
 * la réduire.
 *
 * Usage : BASE=http://localhost:3102 SHOTS=/root/shots-lot2/avant node scripts/look-shots.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3001";
const OUT = process.env.SHOTS ?? "screenshots/look";
const PAGES = [
  ["accueil", "/fr"],
  ["personnages", "/fr/personnages"],
  ["decors", "/fr/decors"],
  ["animation", "/fr/animation"],
  ["a-propos", "/fr/a-propos"],
];
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const heights = {};
for (const [name, path] of PAGES) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 180000 });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo({ top: y, behavior: "instant" });
      await new Promise((r) => setTimeout(r, 80));
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  await page.waitForTimeout(1200);
  heights[name] = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true, animations: "disabled" });
  process.stdout.write(`${name} ${heights[name]}px\n`);
}
writeFileSync(`${OUT}/hauteurs.json`, JSON.stringify(heights, null, 2));
await browser.close();
