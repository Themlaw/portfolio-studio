#!/usr/bin/env node
/**
 * Aperçu par appareil (éditeur visuel) : généralisation du zoom à tous les appareils.
 *  - Fenêtre de 1000 px : Tablette → iframe à 820 px exactement ; Ordinateur → 1180 px avec zoom < 1 et note de zoom visible.
 *  - Fenêtre de 1600 px : Ordinateur → 1180 px, zoom 1, pas de note.
 *  - Un clic sur un bloc de la toile sous zoom le sélectionne.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… BASE=… node scripts/e2e-apercu-appareils.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3000";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");

const SHOTS = path.join(process.env.BATTERY_DIR ?? tmpdir(), "shots-apercu-appareils");
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());

await page.goto(`${BASE}/admin/connexion`, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL);
await page.fill("#password", PASSWORD);
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/admin/connexion"), { timeout: 60000 }), page.click("button[type=submit]")]);

async function frame(p = page) {
  const handle = await p.waitForSelector("iframe.ve-frame", { timeout: 60000 });
  const f = await handle.contentFrame();
  await f.waitForSelector("html[data-edit-mode]", { timeout: 90000 });
  return f;
}

async function setDevice(p, value) {
  const select = p.locator('select[aria-label="Largeur d\'aperçu"]');
  if (await select.isVisible().catch(() => false)) {
    await select.selectOption(value);
  } else {
    const label = { desktop: "Ordinateur", wide: "Grand écran", tablet: "Tablette", phone: "Téléphone" }[value];
    await p.getByRole("button", { name: label }).click();
  }
}

await page.goto(`${BASE}/admin/pages/1/editer`, { waitUntil: "domcontentloaded" });
let f = await frame();
await sleep(1000);

/* ---- 1000 px --------------------------------------------------------------- */
await page.setViewportSize({ width: 1000, height: 800 });
await sleep(800);

// Tablette
await setDevice(page, "tablet");
await sleep(1200);
f = await frame();
const iwTablet = await f.locator("html").evaluate(() => window.innerWidth);
ok("Tablette à 1000 px : iframe à 820 px exactement", iwTablet === 820, `innerWidth ${iwTablet}`);

// Ordinateur
await setDevice(page, "desktop");
await sleep(1200);
f = await frame();
const iwDesktop = await f.locator("html").evaluate(() => window.innerWidth);
ok("Ordinateur à 1000 px : iframe à 1180 px", iwDesktop === 1180, `innerWidth ${iwDesktop}`);
const noteVisible1000 = await page.locator('[data-testid="zoom-note"]').isVisible().catch(() => false);
ok("Ordinateur à 1000 px : note de zoom visible", noteVisible1000);
// zoom < 1 : la boîte de l'iframe est plus étroite que 1180
const iframeBox1000 = await page.locator("iframe.ve-frame").boundingBox();
ok("Ordinateur à 1000 px : zoom < 1", Boolean(iframeBox1000 && iframeBox1000.width < 1180), JSON.stringify(iframeBox1000));

// clic sur un bloc sous zoom le sélectionne
const blocks = f.locator("[data-edit-block]");
const count = await blocks.count();
if (count > 0) {
  await blocks.first().click();
  await sleep(500);
  const selected = await f.locator("[data-edit-selected]").count();
  ok("Clic sur un bloc sous zoom le sélectionne", selected === 1, `selected=${selected}`);
} else {
  ok("Clic sur un bloc sous zoom le sélectionne", false, "aucun bloc");
}

/* ---- 1600 px --------------------------------------------------------------- */
await page.setViewportSize({ width: 1600, height: 900 });
await sleep(800);
await setDevice(page, "desktop");
await sleep(1200);
f = await frame();
const iwDesktop1600 = await f.locator("html").evaluate(() => window.innerWidth);
ok("Ordinateur à 1600 px : iframe à 1180 px", iwDesktop1600 === 1180, `innerWidth ${iwDesktop1600}`);
const noteVisible1600 = await page.locator('[data-testid="zoom-note"]').isVisible().catch(() => false);
ok("Ordinateur à 1600 px : pas de note de zoom", !noteVisible1600);

await browser.close();
console.log(failures === 0 ? "\nTout est vert." : `\n${failures} échec(s).`);
process.exit(failures === 0 ? 0 : 1);
PY