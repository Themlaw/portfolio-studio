#!/usr/bin/env node
/**
 * Hero du kit : aucune discontinuité aux bords des boîtes des plans.
 * Pour chaque plan dessiné, ligne juste au-dessus (y-1) et juste au-dessous
 * (y+1) du bord haut de sa boîte : écart signé de luminance colonne par
 * colonne, médiane sur la largeur (les colonnes sont du ciel hors des sommets ;
 * le grain du papier est un bruit sans signe que la médiane annule, une bande
 * est un décalage de même signe partout). Seuil : |médiane| < 2 niveaux.
 * Témoin : la même mesure sur une ligne sans bord. Texte du hero masqué pour
 * la mesure (la capture, elle, le garde).
 * Vérifie aussi qu'aucun placeholder ne reste en fond après le chargement.
 * Usage : node scripts/kit-poc/hero-seams.mjs [thème] [dossier des captures]
 */
import { mkdirSync } from "node:fs";

import { chromium } from "playwright";
import sharp from "sharp";

const theme = process.argv[2] ?? "kit-a";
const shots = process.argv[3];
if (shots) mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ args: ["--disable-gpu"] });
let failures = 0;
for (const [w, h] of [
  [1440, 900],
  [390, 844],
]) {
  // Mouvement réduit : parallaxe figée, boîtes à leur place.
  const page = await browser.newPage({ viewport: { width: w, height: h }, reducedMotion: "reduce" });
  await page.goto(`http://localhost:3001/api/theme-preview?id=${theme}&redirect=/fr&banner=0`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const { hero, plans } = await page.evaluate(() => ({
    hero: (() => {
      const r = document.querySelector(".hero-parallax").getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    })(),
    plans: [...document.querySelectorAll(".hero-plan")].map((el) => {
      const r = el.getBoundingClientRect();
      const img = el.querySelector("img");
      return { top: r.top, bg: getComputedStyle(el).backgroundImage, loaded: img?.complete && img.naturalWidth > 0 };
    }),
  }));
  if (shots) await sharp(await page.screenshot()).toFile(`${shots}/accueil-${w}.png`);
  // Mesure sur le décor seul : le texte du hero (halo compris) masqué.
  await page.addStyleTag({ content: ".hero-parallax > .shell { visibility: hidden }" });
  const png = await page.screenshot();
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const luma = (x, y) => {
    const i = (y * info.width + x) * 3;
    return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  };
  const shift = (y) => {
    const diffs = [];
    for (let x = 0; x < info.width; x++) diffs.push(luma(x, y + 1) - luma(x, y - 1));
    diffs.sort((a, b) => a - b);
    return diffs[diffs.length >> 1];
  };
  const lo = Math.ceil(hero.top) + 2;
  const hi = Math.min(info.height, Math.floor(hero.bottom)) - 2;
  const control = Math.round((lo + Math.round(plans[1]?.top ?? hi)) / 2);
  console.log(`${w}px témoin : ligne y=${control} sans bord, médiane ${shift(control).toFixed(2)} niveaux`);
  for (const [i, p] of plans.entries()) {
    const edge = Math.round(p.top);
    const placeholder = p.bg !== "none";
    if (edge < lo || edge > hi) {
      console.log(`${w}px plan ${i + 1} : bord hors du hero visible (y=${edge}), placeholder restant : ${placeholder ? "OUI" : "non"}`);
      if (placeholder) failures++;
      continue;
    }
    const median = shift(edge);
    const pass = Math.abs(median) < 2 && !placeholder;
    if (!pass) failures++;
    console.log(`${pass ? "PASS" : "FAIL"}  ${w}px plan ${i + 1} : bord à y=${edge}, écart médian ${median.toFixed(2)} niveaux ; placeholder restant : ${placeholder ? "OUI" : "non"} ; image chargée : ${p.loaded}`);
  }
  await page.close();
}
await browser.close();
console.log(failures ? `hero-seams : ${failures} échec(s)` : "hero-seams : OK");
process.exit(failures ? 1 : 0);
