#!/usr/bin/env node
/**
 * Captures du thème de test « kit-a » (phase 6c) : accueil, personnages,
 * visionneuse ouverte (projet à plusieurs œuvres : flèches), Animation (lecture),
 * en 1440 et 390. Serveur dev (aperçu par /api/theme-preview).
 * Usage : node scripts/kit-poc/kit-theme-shots.mjs [thème] [dossier]
 */
import { mkdirSync } from "node:fs";

import { chromium } from "playwright";

const theme = process.argv[2] ?? "kit-a";
const out = process.argv[3] ?? "screenshots/phase6c";
mkdirSync(out, { recursive: true });
const B = "http://localhost:3001";
const browser = await chromium.launch({ args: ["--disable-gpu", "--disable-dev-shm-usage"] });
const errors = [];
for (const [w, h] of [
  [1440, 900],
  [390, 844],
]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on("pageerror", (e) => errors.push(e.message));
  const go = async (path) => {
    await page.goto(`${B}/api/theme-preview?id=${theme}&redirect=${encodeURIComponent(path)}&banner=0`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
  };
  await go("/fr");
  await page.screenshot({ path: `${out}/accueil-${w}.png` });
  await go("/fr/personnages");
  await page.screenshot({ path: `${out}/personnages-${w}.png` });
  // Projet à plusieurs œuvres : la visionneuse montre les flèches.
  const strip = page.locator(".strip").filter({ has: page.locator(".strip-frame:nth-child(2)") }).first();
  await strip.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/planche-scotch-fleches-${w}.png` });
  await strip.locator(".strip-frame").first().click();
  await page.locator(".lightbox-frame").waitFor();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/visionneuse-${w}.png` });
  await page.keyboard.press("Escape");
  await go("/fr/animation");
  // Icône de lecture dessinée (pastille des plans du demoreel).
  const play = page.locator('[data-icon="play"]').first();
  if (await play.count()) {
    await play.scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: `${out}/animation-lecture-${w}.png`, fullPage: false });
  await page.close();
}
await browser.close();
console.log(errors.length ? `erreurs JS : ${errors.slice(0, 3).join(" | ")}` : "aucune erreur JS");
