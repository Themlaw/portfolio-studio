#!/usr/bin/env node
/**
 * Captures + contrôles calculés de chaque preset, via le cookie d'aperçu.
 * Serveur dev requis (PORT, défaut 3001). Un seul chromium, contextes en série.
 *
 * Sorties : screenshots/<SHOTS_DIR, défaut phase1>/<preset>/*.png (hors git).
 * Contrôles (exit 1 si échec) : data-theme, --color-bg calculé, fond du body,
 * police de titre appliquée ET chargée, nom du site (en-tête) dans la police
 * et la graisse de titre du thème.
 * Usage : PORT=3001 [SHOTS_DIR=phase1b] node scripts/theme-shots.mjs [preset…]
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

import { loadPresets } from "./lib/presets.mjs";

const PORT = process.env.PORT ?? "3001";
const BASE = `http://localhost:${PORT}`;
const OUT = new URL(`../screenshots/${process.env.SHOTS_DIR ?? "phase1"}/`, import.meta.url).pathname;

/** Graisse de titre et nom de famille CSS attendus (catalogue src/themes/font-stacks.ts ;
 *  next/font garde le nom Google, qui est le libellé du catalogue). */
const { FONT_STACKS } = await import(new URL("../src/themes/font-stacks.ts", import.meta.url));
const HEADING_WEIGHT = Object.fromEntries(Object.entries(FONT_STACKS).map(([id, f]) => [id, String(f.headingWeight)]));
const FAMILY = Object.fromEntries(Object.entries(FONT_STACKS).map(([id, f]) => [id, f.label]));

const hexToRgb = (hex) => {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};

const wanted = process.argv.slice(2);
const presets = [];
presets.push(...(await loadPresets(wanted)));

const fail = [];
const ok = (label, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!pass) fail.push(label);
};

async function settle(page) {
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
}

/** Défilement progressif : déclenche le lazy-loading avant la pleine page. */
async function scrollThrough(page) {
  await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.7);
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 180));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(700);
}

const browser = await chromium.launch();

for (const preset of presets) {
  const dir = `${OUT}${preset.id}/`;
  mkdirSync(dir, { recursive: true });
  console.log(`\n== ${preset.id}`);

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  // Aperçu = draft mode + cookie d'id, posés par la route (dev uniquement).
  await page.goto(`${BASE}/api/theme-preview?id=${preset.id}&redirect=/fr&banner=0`);

  await page.goto(`${BASE}/fr`);
  await settle(page);

  const family = FAMILY[preset.tokens.font.display];
  const probe = await page.evaluate((family) => {
    const root = getComputedStyle(document.documentElement);
    const h1 = document.querySelector("h1");
    const brand = document.querySelector(".site-brand");
    return {
      brandFont: brand ? getComputedStyle(brand).fontFamily : "",
      brandWeight: brand ? getComputedStyle(brand).fontWeight : "",
      theme: document.documentElement.dataset.theme,
      colorBg: root.getPropertyValue("--color-bg").trim(),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      h1Font: h1 ? getComputedStyle(h1).fontFamily : "",
      h1Weight: h1 ? getComputedStyle(h1).fontWeight : "",
      loaded: document.fonts.check(`${h1 ? getComputedStyle(h1).fontWeight : 400} 32px "${family}"`),
    };
  }, family);

  ok(`${preset.id} data-theme`, probe.theme === preset.id, probe.theme);
  ok(
    `${preset.id} --color-bg calculé`,
    probe.colorBg.toLowerCase() === preset.tokens.color.bg.toLowerCase(),
    probe.colorBg,
  );
  ok(`${preset.id} fond du body`, probe.bodyBg === hexToRgb(preset.tokens.color.bg), probe.bodyBg);
  ok(
    `${preset.id} police de titre`,
    probe.h1Font.split(",")[0].replaceAll(/['"]/g, "").trim() === family && probe.loaded,
    `${probe.h1Font.split(",")[0]} ${probe.h1Weight}, chargée=${probe.loaded}`,
  );

  ok(
    `${preset.id} nom du site`,
    probe.brandFont.split(",")[0].replaceAll(/['"]/g, "").trim() === family &&
      probe.brandWeight === HEADING_WEIGHT[preset.tokens.font.display],
    `${probe.brandFont.split(",")[0]} ${probe.brandWeight}`,
  );

  await page.screenshot({ path: `${dir}home-1440.png` });
  await scrollThrough(page);
  await page.screenshot({ path: `${dir}home-1440-full.png`, fullPage: true });

  await page.goto(`${BASE}/fr/personnages`);
  await settle(page);
  await page.screenshot({ path: `${dir}personnages-1440.png` });
  await scrollThrough(page);
  await page.screenshot({ path: `${dir}personnages-1440-full.png`, fullPage: true });

  await page.locator(".strip-frame").first().click();
  await page.waitForTimeout(900);
  ok(`${preset.id} lightbox ouverte`, await page.locator(".lightbox").isVisible());
  await page.screenshot({ path: `${dir}lightbox-1440.png` });
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/fr`);
  await settle(page);
  await page.screenshot({ path: `${dir}home-390.png` });
  await scrollThrough(page);
  await page.screenshot({ path: `${dir}home-390-full.png`, fullPage: true });

  await context.close();
}

await browser.close();
console.log(fail.length ? `\nECHECS: ${fail.join(", ")}` : "\nTOUT PASSE");
process.exit(fail.length ? 1 : 0);
