#!/usr/bin/env node
/**
 * Captures de parité visuelle : 4 thèmes × pages publiques, pleine page.
 * Sert à comparer deux états du site (ex. avant/après une refonte des données).
 *
 * Usage : PORT=3001 PARITY_LABEL=avant [PARITY_PAGES=accueil,personnages] [PARITY_EXTRA=nom:/fr/chemin,…] node scripts/parity-shots.mjs [preset…]
 * PARITY_EXTRA ajoute des pages (nom:chemin) à la liste : ex. une page ajoutée en base pour l'occasion.
 * Sortie : screenshots/parity/<label>/<preset>/<page>.png (hors git).
 * Comparaison : diff pixel à pixel des deux dossiers (ex. PIL ImageChops).
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

import { presetSlugs } from "./lib/presets.mjs";

const PORT = process.env.PORT ?? "3001";
const BASE = `http://localhost:${PORT}`;
const LABEL = process.env.PARITY_LABEL ?? "courant";
const OUT = new URL(`../screenshots/parity/${LABEL}/`, import.meta.url).pathname;

const PRESETS = presetSlugs();
const PAGES = [
  ["accueil", "/fr"],
  ["personnages", "/fr/personnages"],
  ["decors", "/fr/decors"],
  ["animation", "/fr/animation"],
  ["a-propos", "/fr/a-propos"],
  ["en-accueil", "/en"],
  ["en-characters", "/en/characters"],
];
for (const item of (process.env.PARITY_EXTRA ?? "").split(",").filter(Boolean)) {
  const [name, ...rest] = item.split(":");
  PAGES.push([name, rest.join(":")]);
}
const MOBILE = [["accueil-390", "/fr"]];

// PARITY_PAGES=accueil,personnages : seulement ces pages (par nom ci-dessus) ; vide = toutes.
const only = (process.env.PARITY_PAGES ?? "").split(",").filter(Boolean);
const keep = (list) => (only.length ? list.filter(([name]) => only.includes(name)) : list);

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
    [{ width: 1440, height: 900 }, keep(PAGES)],
    [{ width: 390, height: 844 }, keep(MOBILE)],
  ]) {
    if (!pages.length) continue;
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    // Aperçu = draft mode + cookie d'id, posés par la route (dev uniquement).
    await page.goto(`${BASE}/api/theme-preview?id=${preset}&redirect=/fr&banner=0`);
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
