#!/usr/bin/env node
/**
 * Captures de parité visuelle : 4 thèmes × pages publiques, pleine page.
 * Sert à comparer deux états du site (ex. avant/après une refonte des données).
 *
 * Usage : PORT=3001 PARITY_LABEL=avant node scripts/parity-shots.mjs [preset…]
 * Sortie : screenshots/parity/<label>/<preset>/<page>.png (hors git).
 * Comparaison : diff pixel à pixel des deux dossiers (ex. PIL ImageChops).
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const PORT = process.env.PORT ?? "3001";
const BASE = `http://localhost:${PORT}`;
const LABEL = process.env.PARITY_LABEL ?? "courant";
const OUT = new URL(`../screenshots/parity/${LABEL}/`, import.meta.url).pathname;

const PRESETS = ["galerie-lumineuse", "pro", "salle-de-projection", "carnet-d-atelier"];
const PAGES = [
  ["accueil", "/fr"],
  ["personnages", "/fr/personnages"],
  ["decors", "/fr/decors"],
  ["animation", "/fr/animation"],
  ["a-propos", "/fr/a-propos"],
  ["en-accueil", "/en"],
  ["en-characters", "/en/characters"],
];
const MOBILE = [["accueil-390", "/fr"]];

const wanted = process.argv.slice(2);
const presets = wanted.length ? PRESETS.filter((p) => wanted.includes(p)) : PRESETS;

async function shoot(page, url, file) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  // Défilement complet (images paresseuses), puis retour en haut et repos :
  // la parallaxe et l'en-tête « défilé » reviennent à leur état initial.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo({ top: y, behavior: "instant" });
      await new Promise((r) => setTimeout(r, 100));
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
}

const browser = await chromium.launch();
for (const preset of presets) {
  const dir = `${OUT}${preset}/`;
  mkdirSync(dir, { recursive: true });
  for (const [viewport, pages] of [
    [{ width: 1440, height: 900 }, PAGES],
    [{ width: 390, height: 844 }, MOBILE],
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    // Aperçu = draft mode + cookie d'id, posés par la route (dev uniquement).
    await page.goto(`${BASE}/api/theme-preview?id=${preset}&redirect=/fr`);
    for (const [name, path] of pages) {
      await shoot(page, `${BASE}${path}`, `${dir}${name}.png`);
      process.stdout.write(".");
    }
    await context.close();
  }
  console.log(` ${preset}`);
}
await browser.close();
console.log(`captures : ${OUT}`);
