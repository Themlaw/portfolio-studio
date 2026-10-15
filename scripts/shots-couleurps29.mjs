#!/usr/bin/env node
/**
 * Captures avant / après du lot 29 (sélecteur « à la Photoshop », nuances) : même script sur l'ancien et le nouveau code,
 * chaque capture est tentée séparément (un contrôle absent avant le lot ne bloque pas les suivantes).
 * Usage : BASE=http://localhost:3381 DATA_DIR=… ADMIN_EMAIL=… ADMIN_PASSWORD=… SHOTS=/dossier [PHASE=avant|apres] node scripts/shots-couleurps29.mjs
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const DB = path.join(process.env.DATA_DIR ?? "data", "portfolio.db");
const SHOTS = process.env.SHOTS ?? "screenshots/couleurps29";
const PHASE = process.env.PHASE ?? "apres";
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (sql) => {
  const db = new Database(DB, { readonly: true });
  try {
    return db.prepare(sql).all();
  } finally {
    db.close();
  }
};
const homeId = q("select page_id id from blocks where type = 'hero' limit 1")[0].id;
const shot = (name) => `${SHOTS}/${PHASE}-${name}.png`;

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/admin/connexion`, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL);
await page.fill("#password", PASSWORD);
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/admin/connexion"), { timeout: 90000 }), page.click("button[type=submit]")]);

const step = async (name, fn) => {
  try {
    await fn();
    console.log(`SHOT  ${name}`);
  } catch (e) {
    console.log(`SKIP  ${name} — ${String(e.message).split("\n")[0]}`);
  }
};
async function canvas() {
  const handle = await page.waitForSelector("iframe.ve-frame", { timeout: 120000 });
  const f = await handle.contentFrame();
  await f.waitForSelector("html[data-edit-mode]", { timeout: 180000 });
  return f;
}
async function openEditor(id) {
  await page.goto(`${BASE}/admin/pages/${id}/editer`, { waitUntil: "domcontentloaded" });
  let f = await canvas();
  if (await page.getByRole("button", { name: "Abandonner les modifications" }).count()) {
    await page.getByRole("button", { name: "Abandonner les modifications" }).click();
    await Promise.all([
      page.waitForEvent("framenavigated", { predicate: (fr) => fr === page.mainFrame(), timeout: 60000 }),
      page.getByRole("dialog").getByRole("button", { name: "Abandonner les modifications" }).click(),
    ]);
    f = await canvas();
  }
  await sleep(2000);
  return f;
}
async function openBar(f, sel) {
  const target = f.locator(sel).first();
  await target.scrollIntoViewIfNeeded();
  for (let essai = 0; essai < 4; essai++) {
    await page.mouse.move(700, 8);
    await sleep(150);
    await target.hover();
    try {
      await f.locator(".lk-aa").waitFor({ timeout: 6000 });
      await f.locator(".lk-aa").click({ timeout: 4000 });
      await f.locator(".lk-bar").waitFor({ timeout: 6000 });
      return;
    } catch {
      /* on recommence */
    }
  }
  throw new Error("barre du texte introuvable");
}

let f = await openEditor(homeId);
await step("01-barre-typo-autre-couleur", async () => {
  await openBar(f, 'h2[data-inline="title"]');
  await f.locator(".lk-bar .tc-wheel").click();
  await sleep(600);
  await page.screenshot({ path: shot("01-barre-typo-autre-couleur") });
  await page.keyboard.press("Escape");
  await f.locator(".lk-bar .lk-close").click().catch(() => {});
});
await step("02-carte-rubrique", async () => {
  await f.locator('[data-edit-type="collection-tiles"] h2').first().click();
  await f.locator(".pe-tools .sm-button").click();
  await f.locator(".sm").waitFor({ timeout: 10000 });
  const sw = f.locator('.sm [role="switch"]');
  if ((await sw.getAttribute("aria-checked")) !== "true") await sw.click();
  await sleep(500);
  await f.locator(".sm").getByRole("button", { name: "Couleur personnalisée" }).click();
  await sleep(700);
  await page.screenshot({ path: shot("02-carte-rubrique") });
  await page.keyboard.press("Escape");
});
f = await openEditor(homeId);
await step("03-panneau-couleurs-site", async () => {
  await page.getByRole("tab", { name: "Réglages" }).click();
  await page.locator('[data-testid="colors-panel"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot("03a-panneau-couleurs-complet"), fullPage: false });
  await page.locator('.lc-role-item[data-role="primary"] .lc-role').click();
  await sleep(700);
  await page.locator('.lc-role-item[data-role="primary"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot("03b-palette-site-selecteur") });
});
await step("04-couleurs-da-theme", async () => {
  await page.goto(`${BASE}/admin/themes/galerie-lumineuse`, { waitUntil: "networkidle" });
  await page.locator('.a-da .lc-role-item[data-role="ink"] .lc-role').click();
  await sleep(700);
  await page.locator('.a-da .lc-role-item[data-role="ink"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot("04-couleurs-da-theme") });
});
await step("05-palette-editor-admin", async () => {
  // La palette ne s'édite que sur une copie du thème livré : on la crée (comme le fait l'interface).
  await page.goto(`${BASE}/admin/themes/galerie-lumineuse`, { waitUntil: "networkidle" });
  const ink = page.locator('.a-da .lc-role-item[data-role="ink"]');
  await ink.locator(".lc-role").click();
  await ink.locator(".cp-hex").fill("#2a2a2a");
  await ink.locator(".cp-hex").press("Enter");
  await page.locator('[data-testid="da-copy"]').click();
  await page.waitForURL(/galerie-lumineuse-copie$/, { timeout: 60000 });
  await page.locator('[data-testid="da-section"]').waitFor();
  const pal = page.locator('.a-color[data-token="primary"]');
  await pal.scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot("05a-palette-admin-avant-clic") });
  await pal.getByRole("button", { name: "Boutons et liens : sélecteur" }).click({ timeout: 4000 });
  await sleep(700);
  await pal.scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot("05b-palette-admin-selecteur") });
  await page.keyboard.press("Escape");
});
await step("06-couleur-boutons-page", async () => {
  await page.goto(`${BASE}/admin/pages/${homeId}`, { waitUntil: "networkidle" });
  await page.locator("label.a-toggle", { hasText: "Boutons et liens de cette page" }).click();
  await sleep(500);
  await page.getByRole("button", { name: "Couleur des boutons et liens de la page : sélecteur" }).click({ timeout: 4000 });
  await sleep(700);
  await page.screenshot({ path: shot("06-couleur-boutons-page"), fullPage: true });
  await page.keyboard.press("Escape");
  await page.locator("label.a-toggle", { hasText: "Boutons et liens de cette page" }).click();
});
if (PHASE === "apres") {
  f = await openEditor(homeId);
  await page.getByRole("tab", { name: "Réglages" }).click();
  const item = (k) => page.locator(`.lc-nuance-item[data-nuance="${k}"]`);
  const pick = async (k, hex) => {
    await item(k).locator(".lc-nuance").click();
    await item(k).locator(".cp-hex").fill(hex);
    await item(k).locator(".cp-hex").press("Enter");
    await sleep(300);
    await item(k).locator(".lc-nuance").click();
  };
  await step("07-nuances-choisies", async () => {
    await pick("primaryHover", "#aa0000");
    await pick("eyebrow", "#00aa00");
    await pick("scrim", "#102030");
    await pick("onScrim", "#fefefe");
    await page.waitForFunction(() => !/Enregistrement/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, { timeout: 60000 });
    await page.locator('[data-testid="colors-panel"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot("07-panneau-couleurs-nuances") });
    await page.screenshot({ path: shot("07b-panneau-couleurs-complet"), fullPage: true });
  });
  await step("08-publication", async () => {
    await page.getByRole("button", { name: "Publier", exact: true }).click();
    await page.waitForFunction(() => /Publié/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, { timeout: 120000 });
  });
  const pub = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pp = await pub.newPage();
  await step("09-survol-bouton", async () => {
    await pp.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
    const btn = pp.locator("a.btn, button.btn").first();
    await btn.scrollIntoViewIfNeeded();
    await btn.hover();
    await sleep(900);
    await pp.screenshot({ path: shot("09-survol-bouton") });
  });
  await step("10-visionneuse-voile", async () => {
    await pp.goto(`${BASE}/fr/decors`, { waitUntil: "networkidle" });
    await pp.locator("section:has(.strip-frame + .strip-frame) .strip-frame").first().click();
    await pp.locator(".lightbox").waitFor({ state: "visible", timeout: 15000 });
    await sleep(900);
    await pp.screenshot({ path: shot("10-visionneuse-voile-choisi") });
  });
  await pub.close();
  // Nettoyage : retour aux couleurs du thème, republié.
  await step("11-nettoyage", async () => {
    await page.getByRole("button", { name: "Revenir aux couleurs du thème" }).click();
    await sleep(500);
    await page.getByRole("button", { name: "Publier", exact: true }).click();
    await page.waitForFunction(() => /Publié/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, { timeout: 120000 });
  });
} else {
  await step("07-panneau-couleurs-complet", async () => {
    await openEditor(homeId);
    await page.getByRole("tab", { name: "Réglages" }).click();
    await page.locator('[data-testid="colors-panel"]').scrollIntoViewIfNeeded();
    await page.locator("details.lc-nuances summary").click();
    await page.screenshot({ path: shot("07-panneau-couleurs-nuances-calculees") });
  });
}
await browser.close();
