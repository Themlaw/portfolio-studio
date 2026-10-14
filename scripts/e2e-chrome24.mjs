#!/usr/bin/env node
/**
 * Chrome de l'éditeur (lot 24), UN chromium. Serveur dev ou start requis, base NEUVE (seed), une connexion.
 *
 *  A. Barre du haut : « Publier » visible et cliquable à 1024, 1280, 1440 et 1920 px (actions secondaires rangées dans « Autres actions »).
 *  B. Échap pendant une saisie en place VALIDE le texte (comme un clic ailleurs) ; Annuler / Ctrl+Z le défait.
 *  C. Publication refusée : liste des problèmes en français, chaque ligne mène au bloc concerné (défilement + sélection).
 *  D. Un clic sur un bloc ouvre l'onglet Réglages ; un bloc sans réglage affiche une phrase utile ; matrice type → réglages.
 *  E. Vocabulaire : « rubrique » partout (ni bloc, ni section, ni conteneur dans l'interface de l'éditeur).
 *  F. « Défaire » (dernière action) distinct de « Annuler / Fermer » ; l'étiquette du type ne recouvre ni texte ni bouton.
 *  G. Barre typographique : « Majuscules », « Espacement des lettres », « Code couleur », « Lisibilité » (ratio en info-bulle).
 *
 * Captures : $SHOTS (défaut screenshots/chrome24).
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… [BASE=http://localhost:3320] [SHOTS=…] [ONLY=A,B] node scripts/e2e-chrome24.mjs
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const DATA = process.env.DATA_DIR ?? "data";
const DB = path.join(DATA, "portfolio.db");
const SHOTS = process.env.SHOTS ?? "screenshots/chrome24";
const ONLY = process.env.ONLY ?? "";
const run = (k) => !ONLY || ONLY.split(",").includes(k);
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
function ok(label, cond, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (sql, ...args) => {
  const db = new Database(DB, { readonly: true });
  try {
    return db.prepare(sql).all(...args);
  } finally {
    db.close();
  }
};
const exec = (sql, ...args) => {
  const db = new Database(DB);
  try {
    return db.prepare(sql).run(...args);
  } finally {
    db.close();
  }
};
const draftOf = (id) => JSON.parse(q("select draft from pages where id = ?", id)[0]?.draft ?? "null");
async function waitFor(fn, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(250);
  }
  return false;
}
const until = (f, fn, arg, timeout = 30000) =>
  f.waitForFunction(fn, arg, { timeout, polling: 200 }).then(
    () => true,
    () => false,
  );

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
page.setDefaultNavigationTimeout(180000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(`${BASE}/admin/connexion`, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL);
await page.fill("#password", PASSWORD);
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/admin/connexion"), { timeout: 90000 }), page.click("button[type=submit]")]);

async function canvas() {
  const handle = await page.waitForSelector("iframe.ve-frame", { timeout: 120000 });
  const f = await handle.contentFrame();
  await f.waitForSelector("html[data-edit-mode]", { timeout: 180000 });
  return f;
}
async function settled() {
  await page.waitForFunction(() => !/Enregistrement/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, { timeout: 120000 });
  await sleep(500);
}
/** Ouvre l'éditeur d'une page, repart de la version publiée (abandonne un brouillon s'il y en a un). */
async function openEditor(id = 1) {
  await page.goto(`${BASE}/admin/pages/${id}/editer`, { waitUntil: "domcontentloaded" });
  const f = await canvas();
  const discard = page.getByRole("button", { name: "Abandonner les modifications" });
  const more = page.getByRole("button", { name: "Autres actions" });
  if ((await discard.count()) || (await more.count())) {
    if (!(await discard.count())) {
      await more.click();
      if (!(await page.getByRole("menuitem", { name: "Abandonner les modifications" }).count())) {
        await page.keyboard.press("Escape");
        return f;
      }
      await page.getByRole("menuitem", { name: "Abandonner les modifications" }).click();
    } else await discard.click();
    await Promise.all([
      page.waitForEvent("framenavigated", { predicate: (fr) => fr === page.mainFrame(), timeout: 60000 }),
      page.getByRole("dialog").getByRole("button", { name: "Abandonner les modifications" }).click(),
    ]);
    return canvas();
  }
  return f;
}

/* ---- A. Barre du haut --------------------------------------------------------------------------- */
if (run("A")) {
  let f = await openEditor();
  // Un brouillon pour que « Abandonner » existe.
  await page.locator('.ve-starter[data-starter]').first().click();
  await settled();
  await sleep(800);
  for (const w of [1920, 1440, 1280, 1024]) {
    await page.setViewportSize({ width: w, height: 900 });
    await sleep(600);
    const pub = page.getByRole("button", { name: "Publier", exact: true });
    const box = await pub.boundingBox();
    ok(`A1 ${w} px : « Publier » entièrement visible dans la fenêtre`, Boolean(box && box.x >= 0 && box.x + box.width <= w), JSON.stringify(box));
    const overflow = await page.evaluate(() => {
      const el = document.querySelector(".ve-top");
      return el ? el.scrollWidth - el.clientWidth : -1;
    });
    ok(`A2 ${w} px : la barre ne déborde pas`, overflow <= 0, String(overflow));
    await page.screenshot({ path: path.join(SHOTS, `A-barre-${w}.png`), clip: { x: 0, y: 0, width: w, height: 64 } });
  }
  // Menu « Autres actions » : « Abandonner » à 1280 px, la largeur d'aperçu en plus à 1024 px.
  for (const [w, preview] of [[1280, false], [1024, true]]) {
    await page.setViewportSize({ width: w, height: 900 });
    await sleep(500);
    await page.getByRole("button", { name: "Autres actions" }).click();
    ok(`A3 ${w} px : « Abandonner les modifications » est dans le menu`, (await page.getByRole("menuitem", { name: "Abandonner les modifications" }).count()) === 1);
    ok(`A4 ${w} px : la largeur d'aperçu ${preview ? "est" : "n'est pas"} dans le menu`, (await page.getByRole("menuitemradio", { name: "Tablette" }).count()) === (preview ? 1 : 0));
    await page.screenshot({ path: path.join(SHOTS, `A-menu-${w}.png`), clip: { x: Math.max(0, w - 420), y: 0, width: Math.min(w, 420), height: 220 } });
    if (preview) {
      await page.getByRole("menuitemradio", { name: "Tablette" }).click();
      ok("A5 choisir « Tablette » dans le menu change la largeur de la toile", await waitFor(async () => ((await page.locator(".ve-frame-wrap").boundingBox())?.width ?? 0) < 900), "");
      await page.getByRole("button", { name: "Autres actions" }).click();
      await page.getByRole("menuitemradio", { name: "Ordinateur" }).click();
    } else await page.keyboard.press("Escape");
    ok(`A6 ${w} px : Échap referme le menu`, await waitFor(async () => (await page.getByRole("menu").count()) === 0, 5000));
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

ok("aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
if (failures) {
  console.error(`e2e-chrome24 : ÉCHEC (${failures})`);
  process.exit(1);
}
console.log("e2e-chrome24 : OK");
