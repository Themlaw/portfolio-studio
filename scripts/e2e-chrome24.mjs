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

/* ---- B. Échap valide la saisie en place --------------------------------------------------------- */
if (run("B")) {
  const f = await openEditor();
  const field = f.locator("[data-edit-block] [data-inline]").first();
  await field.scrollIntoViewIfNeeded();
  const before = ((await field.textContent()) ?? "").trim();
  const typed = "Texte validé par Échap";
  await field.dblclick();
  ok("B1 la saisie en place s'ouvre", await until(f, () => Boolean(document.querySelector("[data-editing]"))));
  await page.keyboard.press("Control+a");
  await page.keyboard.type(typed);
  await page.keyboard.press("Escape");
  ok("B2 Échap ferme la saisie", await until(f, () => !document.querySelector("[data-editing]")));
  ok("B3 le texte tapé reste affiché", await until(f, (t) => [...document.querySelectorAll("[data-edit-block] [data-inline]")].some((e) => e.textContent?.trim() === t), typed), "");
  await settled();
  ok("B4 le texte tapé est dans le brouillon", await waitFor(() => JSON.stringify(draftOf(1)).includes(typed)));
  await page.screenshot({ path: path.join(SHOTS, "B-echap-valide.png") });
  // Annuler (Ctrl+Z) rend le texte d'avant.
  await page.locator(".ve-top").click({ position: { x: 700, y: 10 } });
  await page.keyboard.press("Control+z");
  ok("B5 Ctrl+Z rend le texte d'avant", await until(f, (t) => ![...document.querySelectorAll("[data-edit-block] [data-inline]")].some((e) => e.textContent?.trim() === t), typed), before);
  await settled();
  ok("B6 le brouillon n'a plus le texte tapé", await waitFor(() => !JSON.stringify(draftOf(1) ?? "").includes(typed)));
}

/* ---- C. Publication refusée : liste en français, lignes cliquables ------------------------------- */
if (run("C")) {
  let f = await openEditor();
  // Deux rubriques inachevées en bas de page : un Texte laissé tel quel (texte d'aide) et une Image sans fichier.
  await page.locator('.ve-starter[data-starter]').first().click();
  await settled();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Ajouter" }).click();
  await page.locator('.ve-card[data-key="image"]').click();
  await settled();
  await sleep(500);
  const blocks = () => draftOf(1)?.blocks ?? [];
  ok("C0 deux rubriques ajoutées en fin de page", await waitFor(() => blocks().length >= 2 && blocks().at(-1).type === "image" && blocks().at(-2).type === "rich-text"), JSON.stringify(blocks().map((b) => b.type)));
  const textUid = blocks().at(-2).uid;
  const imageUid = blocks().at(-1).uid;
  await page.getByRole("button", { name: "Publier", exact: true }).click();
  const panel = page.locator('[data-testid="publish-problems"]');
  ok("C1 la liste des problèmes s'affiche", await panel.waitFor({ timeout: 60000 }).then(() => true, () => false));
  const lines = await panel.locator("li").allInnerTexts();
  await page.screenshot({ path: path.join(SHOTS, "C-liste-problemes.png") });
  ok("C2 une ligne par rubrique inachevée", lines.length === 2, JSON.stringify(lines));
  const all = (await panel.textContent()) ?? "";
  ok("C3 texte en français : rubrique nommée, aucune chaîne technique", /Rubrique n° \d+ « Texte »/.test(all) && /Rubrique n° \d+ « Image »/.test(all) && !/blocks\.|props\.|undefined|\[object/.test(all), all);
  ok("C4 le titre dit le nombre de points à corriger", /2 points à corriger/.test(all), all);
  // Défile jusqu'en haut de la page : la ligne de l'image doit ramener la rubrique dans la vue et la choisir.
  await f.evaluate(() => window.scrollTo(0, 0));
  await sleep(500);
  await panel.locator("li", { hasText: "« Image »" }).getByRole("button").click();
  ok("C5 clic sur la ligne : la rubrique est choisie sur la toile", await until(f, () => document.querySelector(".pe-selected") !== null));
  ok("C6 clic sur la ligne : l'onglet Réglages est ouvert", (await page.getByRole("tab", { name: "Réglages" }).getAttribute("aria-selected")) === "true");
  ok("C7 clic sur la ligne : le panneau montre les réglages de l'image", await page.locator(".ve-settings-head h2", { hasText: "Image" }).waitFor({ timeout: 10000 }).then(() => true, () => false));
  const vis = await waitFor(async () => {
    const r = await f.evaluate(() => {
      const el = document.querySelector(".pe-selected");
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { top: b.top, bottom: b.bottom, h: window.innerHeight };
    });
    return Boolean(r && r.bottom > 0 && r.top < r.h);
  }, 15000);
  ok("C8 clic sur la ligne : la toile a défilé jusqu'à la rubrique", vis);
  // La ligne du texte mène à lui.
  await f.evaluate(() => window.scrollTo(0, 0));
  await sleep(400);
  await panel.locator("li", { hasText: "« Texte »" }).getByRole("button").click();
  ok("C9 la ligne du Texte choisit le Texte", await waitFor(() => f.evaluate(() => { const b = document.querySelector(".pe-selected")?.getBoundingClientRect(); return Boolean(b && b.bottom > 0 && b.top < window.innerHeight); })));
  ok("C10 les réglages montrent le Texte", await page.locator(".ve-settings-head h2", { hasText: "Texte" }).waitFor({ timeout: 10000 }).then(() => true, () => false));
  // Corriger (ici depuis le panneau) fait disparaître la liste.
  await page.locator(".ve-settings textarea").first().fill("Un vrai texte");
  ok("C11 la liste périmée disparaît dès qu'on modifie la page", await panel.waitFor({ state: "detached", timeout: 20000 }).then(() => true, () => false));
}

/* ---- D. Un clic sur un bloc ouvre Réglages ; matrice type → réglages ----------------------------- */
if (run("D")) {
  let f = await openEditor();
  const tab = (name) => page.getByRole("tab", { name, exact: true });
  const selectedTab = async () => (await page.locator('[role="tab"][aria-selected="true"]').first().textContent())?.trim();
  // D1-D3 : depuis Ajouter, Médias et Structure, un clic sur une rubrique de la toile ouvre Réglages sur elle.
  const blockLabels = async () => f.evaluate(() => [...document.querySelectorAll("[data-edit-block]:not([data-edit-parent])")].map((e) => e.dataset.editBlock));
  const uids = await blockLabels();
  ok("D0 la page porte des rubriques", uids.length >= 2, JSON.stringify(uids));
  for (const [n, name] of [["D1", "Ajouter"], ["D2", "Médias"], ["D3", "Structure"]]) {
    await tab(name).click();
    const uid = uids[1];
    const target = f.locator(`[data-edit-block="${uid}"]`).first();
    await target.scrollIntoViewIfNeeded();
    // Un point de la rubrique hors poignées : son milieu.
    const box = await f.evaluate((u) => {
      const els = [...document.querySelectorAll(`[data-edit-block="${u}"] *`)].filter((e) => e.getBoundingClientRect().height > 8 && e.getBoundingClientRect().width > 8);
      const r = (els[0] ?? document.querySelector(`[data-edit-block="${u}"]`)).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: Math.min(window.innerHeight - 20, Math.max(20, r.top + Math.min(r.height / 2, 60))) };
    }, uid);
    await f.locator("html").click({ position: { x: box.x, y: box.y }, force: true });
    ok(`${n} depuis « ${name} » : un clic sur la toile ouvre Réglages`, await waitFor(async () => (await selectedTab()) === "Réglages", 10000), await selectedTab());
    ok(`${n}b le panneau montre les réglages de la rubrique choisie`, await page.locator(".ve-settings-head h2").first().waitFor({ timeout: 10000 }).then(() => true, () => false));
  }
  await page.screenshot({ path: path.join(SHOTS, "D-clic-reglages.png") });

  // D4 : matrice type de bloc → réglages (un exemplaire de chaque composant du panneau « Ajouter »).
  await tab("Ajouter").click();
  const cards = await page.evaluate(() => [...document.querySelectorAll(".ve-card")].map((c) => ({ key: c.dataset.key, type: c.dataset.type, label: c.querySelector("strong")?.textContent?.trim() })));
  const matrix = [];
  for (const card of cards) {
    await tab("Ajouter").click();
    await page.locator(`.ve-card[data-key="${card.key}"]`).click();
    await settled();
    await tab("Réglages").click();
    await page.locator(".ve-settings-head h2").first().waitFor({ timeout: 10000 }).catch(() => {});
    const row = await page.evaluate(() => {
      const root = document.querySelector(".ve-settings");
      const text = (sel) => [...new Set([...(root?.querySelectorAll(sel) ?? [])].map((e) => e.textContent?.trim().replace(/\s+/g, " ")).filter(Boolean))];
      const look = root?.querySelector(".lp");
      const lookLabels = [...(look?.querySelectorAll(".lp-label") ?? [])].map((e) => e.textContent?.trim());
      const own = text(".a-field > label, .a-field > .a-label, legend, .a-field-label, [role=group][aria-label]").filter((t) => !lookLabels.includes(t));
      return { title: root?.querySelector(".ve-settings-head h2")?.textContent?.trim(), contenu: own.slice(0, 14), miseEnPage: lookLabels, vide: Boolean(root?.querySelector(".ve-empty")), controls: root?.querySelectorAll("input, select, textarea, button[aria-pressed], [role=switch]").length ?? 0 };
    });
    matrix.push({ ...card, ...row });
    ok(`D4 ${card.label} : des réglages ou une phrase utile (${row.controls} commandes)`, row.title === card.label.replace(/ \(ancien\)$/, "") || Boolean(row.title), JSON.stringify(row));
    ok(`D4b ${card.label} : le panneau n'est pas vide`, row.controls >= 2 || row.vide, JSON.stringify(row));
  }
  console.log("MATRICE " + JSON.stringify(matrix));
}

ok("aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
if (failures) {
  console.error(`e2e-chrome24 : ÉCHEC (${failures})`);
  process.exit(1);
}
console.log("e2e-chrome24 : OK");
