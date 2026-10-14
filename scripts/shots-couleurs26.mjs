#!/usr/bin/env node
/**
 * Captures avant / après du lot 26 (couleurs et logo) : même script sur l'ancien et le nouveau code, chaque capture est tentée
 * séparément (une absence de contrôle, avant le lot, ne bloque pas les suivantes).
 * Usage : BASE=http://localhost:3340 DATA_DIR=… ADMIN_EMAIL=… ADMIN_PASSWORD=… SHOTS=/dossier node scripts/shots-couleurs26.mjs
 * La collection « Animation » est vidée dans la base avant la dernière capture de la toile (collection vide).
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
const SHOTS = process.env.SHOTS ?? "screenshots/couleurs26";
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
await step("01-panneau-logo", async () => {
  await page.getByRole("tab", { name: "Réglages" }).click();
  await page.locator('[data-testid="logo-panel"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/01-panneau-logo.png` });
});
await step("02-panneau-couleurs", async () => {
  await page.locator('[data-testid="colors-panel"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/02-panneau-couleurs.png` });
});
await step("03-barre-texte", async () => {
  await openBar(f, 'h2[data-inline="title"]');
  await page.screenshot({ path: `${SHOTS}/03-barre-texte.png` });
  await f.locator(".lk-bar .tc-wheel").click();
  await sleep(500);
  await page.screenshot({ path: `${SHOTS}/03b-roue-couleurs.png` });
  await f.locator(".lk-bar .lk-close").click().catch(() => {});
});
await step("04-carte", async () => {
  await f.locator('[data-edit-type="collection-tiles"] h2').first().click();
  await f.locator(".pe-tools .sm-button").click();
  await f.locator(".sm").waitFor({ timeout: 10000 });
  const sw = f.locator('.sm [role="switch"]');
  if ((await sw.getAttribute("aria-checked")) !== "true") await sw.click();
  await sleep(600);
  await page.screenshot({ path: `${SHOTS}/04-carte.png` });
  await sw.click();
});
await step("05-tuile-survol", async () => {
  await f.locator('[data-edit-type="collection-tiles"] .tile').first().scrollIntoViewIfNeeded();
  await f.locator('[data-edit-type="collection-tiles"] .tile').first().hover();
  await sleep(600);
  await page.screenshot({ path: `${SHOTS}/05-tuile-survol.png` });
});
{
  const db = new Database(DB);
  db.prepare("delete from slots where collection = 'animation'").run();
  db.close();
  f = await openEditor(homeId);
  await step("06-collection-vide", async () => {
    await f.locator('[data-edit-type="collection-tiles"]').first().scrollIntoViewIfNeeded();
    await f.evaluate(() => (document.querySelector("[data-tile-empty]") ?? document.querySelector(".tiles"))?.scrollIntoView({ block: "center" }));
    await sleep(600);
    await page.screenshot({ path: `${SHOTS}/06-collection-vide.png` });
  });
}
await step("07-formulaire-page", async () => {
  await page.goto(`${BASE}/admin/pages/${homeId}`, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${SHOTS}/07-formulaire-page.png`, fullPage: true });
});
await browser.close();
