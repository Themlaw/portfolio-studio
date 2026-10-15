#!/usr/bin/env node
/**
 * Lot 26 (v0.20) : couleurs et logo. UN chromium sobre, base NEUVE (seed), une connexion admin.
 *
 *  V. Vocabulaire de couleurs unique : les six rôles (Fond de page, Cartes et encadrés, Texte, Boutons et liens, Accent,
 *     Ornements), même nom et même ordre dans le panneau « Couleurs », la barre d'un texte (pastilles nommées, nom de la couleur
 *     choisie visible, plus de seconde rangée « couleurs du thème » dans la roue), la carte d'une rubrique (bouton « Carte »,
 *     plus « Fond »), le fond du texte (« Fond du texte »), la liste des thèmes ; « Accent de la page » devient « Boutons et liens
 *     de cette page » et se règle avec les autres réglages de la page (formulaire de la page ET éditeur visuel).
 *  L. Logo : image choisie dans la médiathèque ou envoyée depuis le panneau « Logo » (brouillon du site, toile, public après
 *     publication), retour au logo texte.
 *  T. Couverture d'une entrée de collection choisie depuis la tuile (« Changer la couverture », retour à « Couverture
 *     automatique ») ; collection vide : avis dans la tuile sur la toile, rien en public.
 *
 * Usage : BASE=http://localhost:3340 DATA_DIR=~/pf/data-26 ADMIN_EMAIL=… ADMIN_PASSWORD=… SHOTS=/dossier [ONLY=V,L,T] node scripts/e2e-couleurs26.mjs
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";
import sharp from "sharp";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const DB = path.join(process.env.DATA_DIR ?? "data", "portfolio.db");
const SHOTS = process.env.SHOTS ?? "screenshots/couleurs26";
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
const homeId = q("select page_id id from blocks where type = 'hero' limit 1")[0].id;
const draftOf = (id) => JSON.parse(q("select draft from pages where id = ?", id)[0]?.draft ?? "null");
const setting = (key) => JSON.parse(q("select value from settings where key = ?", key)[0]?.value ?? "null");
const tilesDraft = () => draftOf(homeId)?.blocks?.find((b) => b.type === "collection-tiles")?.props;
const siteLogo = () => setting("siteDraft")?.snap?.styles?.logo ?? null;
async function waitFor(fn, timeout = 60000) {
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(300)) if (await fn()) return true;
  return false;
}
const until = (f, fn, arg, timeout = 60000) => f.waitForFunction(fn, arg, { timeout, polling: 200 }).then(() => true, () => false);

const ROLES = ["Fond de page", "Cartes et encadrés", "Texte", "Boutons et liens", "Accent", "Ornements"];

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());

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
  await sleep(1500);
  return f;
}
async function publish() {
  await settled();
  await page.getByRole("button", { name: "Publier", exact: true }).click();
  return waitFor(async () => /Publié/.test((await page.locator(".ve-status").textContent()) ?? ""), 120000);
}
async function anon(p) {
  const r = await fetch(BASE + p, { redirect: "manual" });
  return { status: r.status, html: await r.text() };
}
/** Ouvre la barre typographique d'un texte (« Aa » au survol). */
async function openBar(f, sel, nth = 0) {
  if (await f.locator(".lk-bar").count()) {
    await f.locator(".lk-bar .lk-close").click().catch(() => {});
    await f.locator(".lk-bar").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  }
  const target = f.locator(sel).nth(nth);
  await target.scrollIntoViewIfNeeded();
  for (let essai = 0; essai < 4; essai++) {
    await page.mouse.move(700, 8);
    await sleep(150);
    await target.hover();
    if (!(await until(f, () => Boolean(document.querySelector(".lk-aa")), null, 8000))) continue;
    try {
      await f.locator(".lk-aa").click({ timeout: 4000 });
      if (await until(f, () => Boolean(document.querySelector(".lk-bar")), null, 8000)) return true;
    } catch {
      /* le « Aa » suit le survol : on recommence */
    }
  }
  return false;
}

/** Interrupteur « Boutons et liens de cette page » (la piste de l'interrupteur recouvre la case : on clique son libellé). */
async function setPageColor(on) {
  const sw = page.getByRole("switch", { name: "Boutons et liens de cette page" });
  if ((await sw.isChecked()) !== on) await page.locator("label.a-toggle", { hasText: "Boutons et liens de cette page" }).click();
  await page.waitForFunction(([want]) => document.querySelector('[data-testid="page-buttons-color"] input[role="switch"]')?.checked === want, [on], { timeout: 10000 });
}

/* ======================================== V. Vocabulaire ======================================== */
if (run("V")) {
  console.log("== V. Vocabulaire de couleurs");
  const f = await openEditor(homeId);
  await page.getByRole("tab", { name: "Réglages" }).click();
  const panel = (await page.locator(".lc-role strong").allTextContents()).map((t) => t.trim());
  ok("V1 panneau « Couleurs » : les six rôles dans l'ordre", JSON.stringify(panel) === JSON.stringify(ROLES), JSON.stringify(panel));
  await page.screenshot({ path: `${SHOTS}/V1-panneau-couleurs.png` });

  // Barre d'un texte : les six rôles d'abord (même ordre), puis deux nuances ; nom de la couleur choisie visible.
  const H2 = 'h2[data-inline="title"]';
  ok("V2 barre d'un texte ouverte", await openBar(f, H2));
  const labels = await f.locator('.lk-bar .tc-swatches [role="radio"]').evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  ok("V2b pastilles du texte : les six rôles dans l'ordre, puis Texte secondaire et Étiquettes", JSON.stringify(labels) === JSON.stringify([...ROLES, "Texte secondaire", "Étiquettes"]), JSON.stringify(labels));
  const titles = await f.locator('.lk-bar .tc-swatches [role="radio"]').evaluateAll((els) => els.map((e) => e.getAttribute("title")));
  ok("V2c chaque pastille a son nom en info-bulle", JSON.stringify(titles) === JSON.stringify(labels));
  ok("V2d aucune couleur choisie : pas de nom affiché", (await f.locator('[data-testid="text-color-name"]').count()) === 0);
  await f.locator('.lk-bar .tc-swatches [aria-label="Boutons et liens"]').click();
  ok("V2e couleur choisie : son nom est visible", await until(f, () => document.querySelector('[data-testid="text-color-name"]')?.textContent === "Boutons et liens", null, 8000));
  await page.screenshot({ path: `${SHOTS}/V2-barre-texte.png` });
  await f.locator(".lk-bar .tc-wheel").click();
  ok("V3 roue des couleurs : plus de seconde rangée « Couleurs du thème »", (await f.locator('.cp [aria-label="Couleurs du thème"]').count()) === 0 && (await f.locator(".cp .cp-wheel").count()) === 1);
  await f.locator(".cp .cp-foot button", { hasText: "Fermer" }).click();
  // Fond du texte : libellé distinct de la carte.
  ok("V4 ligne « Fond du texte : »", /Fond du texte/.test((await f.locator(".lk-bar .tc-bd-label").textContent()) ?? ""));
  await f.locator(".lk-bar .lk-close").click();

  // Carte d'une rubrique : bouton « Carte » (plus « Fond »), couleurs nommées comme le panneau.
  await f.locator('[data-edit-type="collection-tiles"] h2').first().click();
  const button = f.locator(".pe-tools .sm-button");
  ok("V5 bouton « Carte » dans la barre de la rubrique", await button.waitFor({ timeout: 20000 }).then(() => true, () => false) && /^\s*Carte/.test((await button.textContent()) ?? "") && !/Fond/.test((await button.textContent()) ?? ""));
  await button.click();
  const menu = f.locator(".sm");
  ok("V5b popover « Carte de la rubrique »", (await menu.getAttribute("aria-label")) === "Carte de la rubrique");
  await menu.getByRole("switch", { name: "Une carte sous la rubrique" }).click();
  await menu.locator('[data-testid="card-da-color"]').first().waitFor({ timeout: 10000 });
  const cards = (await menu.locator('[data-testid="card-da-color"] .cc-name').allTextContents()).map((t) => t.trim());
  ok("V5c couleurs de la carte : les six rôles dans l'ordre (nom visible)", JSON.stringify(cards.slice(0, 6)) === JSON.stringify(ROLES), JSON.stringify(cards));
  ok("V5d « Couleur de la carte » (jamais « Fond »)", /Couleur de la carte/.test((await menu.textContent()) ?? "") && !/\bFond\b(?! de page| profond)/.test((await menu.textContent()) ?? ""));
  await page.screenshot({ path: `${SHOTS}/V5-carte.png` });
  await menu.getByRole("switch", { name: "Une carte sous la rubrique" }).click();
  await settled();

  // Liste des thèmes : mêmes six rôles.
  await page.goto(`${BASE}/admin/themes`, { waitUntil: "networkidle" });
  const sw = await page.locator(".a-swatches").first().locator(".a-swatch").evaluateAll((els) => els.map((e) => (e.getAttribute("title") ?? "").replace(/ #?[0-9a-fA-F]{3,8}$/, "")));
  ok("V6 miniature d'un thème : les six rôles dans l'ordre", JSON.stringify(sw) === JSON.stringify(ROLES), JSON.stringify(sw));

  // « Accent de la page » → « Boutons et liens de cette page », avec les autres réglages de la page.
  await page.goto(`${BASE}/admin/pages/${homeId}`, { waitUntil: "networkidle" });
  ok("V7 formulaire : plus de panneau « Accent de la page »", (await page.getByRole("heading", { name: "Accent de la page" }).count()) === 0);
  const where = await page.locator('[data-testid="page-buttons-color"]').evaluate((el) => el.closest("section")?.querySelector("h2")?.textContent ?? "");
  ok("V7b la couleur des boutons et liens est dans « Informations »", where === "Informations", where);
  await setPageColor(true);
  ok("V7c la couleur apparaît, contraste AA", (await page.locator("#pe-accent-hex").count()) === 1 && (await page.locator(".a-ratio-ok").count()) >= 1);
  await page.screenshot({ path: `${SHOTS}/V7-formulaire-page.png`, fullPage: true });
  await setPageColor(false);
  // Éditeur visuel : même réglage, avec les autres réglages de la page (collection).
  await openEditor(homeId);
  await page.getByRole("tab", { name: "Réglages" }).click();
  await page.locator('[data-testid="page-buttons-color"]').waitFor({ timeout: 20000 });
  ok("V8 éditeur visuel : réglage de page « Boutons et liens de cette page » à côté de « Cette page est la collection »", (await page.locator(".ve-page-collection").locator('[data-testid="page-buttons-color"]').count()) === 1);
  await setPageColor(true);
  await settled();
  ok("V8b brouillon : couleur enregistrée", await waitFor(() => typeof draftOf(homeId)?.accent === "string"));
  await page.screenshot({ path: `${SHOTS}/V8-editeur-reglages-page.png` });
  await setPageColor(false);
  await settled();
  ok("V8c retirée du brouillon", await waitFor(() => draftOf(homeId)?.accent === null));
}

/* ======================================== L. Logo ======================================== */
if (run("L")) {
  console.log("== L. Image du logo");
  const f = await openEditor(homeId);
  await page.getByRole("tab", { name: "Réglages" }).click();
  const logo = page.locator('[data-testid="logo-image"]');
  await logo.scrollIntoViewIfNeeded();
  ok("L1 panneau Logo : section « Image du logo » avec « Choisir une image… »", (await logo.getByRole("button", { name: /Choisir une image/ }).count()) === 1 && (await logo.locator('[data-testid="logo-revert"]').count()) === 0);
  await page.screenshot({ path: `${SHOTS}/L1-logo-sans-image.png` });
  await logo.getByRole("button", { name: /Choisir une image/ }).click();
  const dlg = page.locator("dialog.ve-picker[open]");
  await dlg.waitFor({ timeout: 10000 });
  ok("L2 médiathèque proposée + envoi d'un fichier", (await dlg.locator('ul[aria-label="Bibliothèque"] button').count()) > 0 && (await dlg.getByText("Envoyer un fichier de l'ordinateur").count()) === 1);
  const first = dlg.locator('ul[aria-label="Bibliothèque"] button').first();
  const name = ((await first.getAttribute("aria-label")) ?? "").replace(/^Choisir /, "");
  await first.click();
  ok("L3 image choisie : enregistrée dans le brouillon du site", await waitFor(() => Number.isInteger(siteLogo()?.mediaId)));
  const picked = siteLogo()?.mediaId;
  ok("L3b c'est bien une image de la médiathèque", q("select kind, original_name as name from media where id = ?", picked)[0]?.kind === "image" && q("select original_name as name from media where id = ?", picked)[0]?.name === name, `${picked} ${name}`);
  ok("L4 la toile montre l'image à la place du nom", await until(f, () => Boolean(document.querySelector(".site-brand[data-logo-image] img.site-logo-img")), null, 60000));
  ok("L4b l'image a la hauteur du logo (pas de nom en texte visible)", await f.evaluate(() => { const i = document.querySelector(".site-logo-img"); const t = document.querySelector(".site-brand-text"); return i.getBoundingClientRect().height >= 20 && t.getBoundingClientRect().width <= 2; }));
  ok("L5 le panneau montre l'image choisie et propose « Remplacer » et « Revenir au logo texte »", await until(page.mainFrame(), () => Boolean(document.querySelector('[data-testid="logo-thumb"]')) && Boolean(document.querySelector('[data-testid="logo-revert"]')), null, 30000));
  await page.screenshot({ path: `${SHOTS}/L5-logo-image.png` });
  // Remplacer par un fichier envoyé (PNG transparent).
  const png = await sharp({ create: { width: 320, height: 96, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await sharp({ create: { width: 200, height: 40, channels: 4, background: { r: 30, g: 60, b: 160, alpha: 1 } } }).png().toBuffer(), left: 40, top: 28 }])
    .png()
    .toBuffer();
  await logo.getByRole("button", { name: /Remplacer l'image/ }).click();
  await dlg.waitFor({ timeout: 10000 });
  await dlg.locator('input[type="file"]').setInputFiles({ name: "logo-test-26.png", mimeType: "image/png", buffer: png });
  ok("L6 fichier envoyé depuis le panneau : nouveau logo enregistré", await waitFor(() => Number.isInteger(siteLogo()?.mediaId) && siteLogo().mediaId !== picked, 180000));
  const uploaded = siteLogo()?.mediaId;
  ok("L6b le média envoyé est une image de la médiathèque", q("select kind, original_name as name from media where id = ?", uploaded)[0]?.name === "logo-test-26.png");
  ok("L6c la toile montre le logo envoyé", await until(f, () => Boolean(document.querySelector(".site-brand[data-logo-image] img.site-logo-img")), null, 60000));
  // Médiathèque : l'image du logo n'est pas supprimable (elle casserait l'en-tête).
  await settled();
  await page.goto(`${BASE}/admin/medias`, { waitUntil: "networkidle" });
  await page.locator('button.a-media-tile[title="logo-test-26.png"]').first().click();
  // Lot 23 : le refus est annoncé d'avance (bouton inactif, endroits listés), le logo en fait partie.
  await page.locator('[data-testid="media-usages"]').waitFor({ timeout: 20000 }).catch(() => {});
  const usesText = await page.locator('[data-testid="media-usages"]').innerText().catch(() => "");
  ok("L6d suppression refusée d'avance tant que l'image est le logo du site (bouton inactif, « Logo du site » listé)", (await page.getByRole("button", { name: "Supprimer l'image" }).isDisabled()) && /Logo du site/.test(usesText) && !/Rubrique « Logo/.test(usesText) && q("select id from media where id = ?", uploaded).length === 1, usesText);
  await page.keyboard.press("Escape");
  // Retour dans l'éditeur SANS abandonner le brouillon (openEditor le fait).
  await page.goto(`${BASE}/admin/pages/${homeId}/editer`, { waitUntil: "domcontentloaded" });
  const f3 = await canvas();
  await sleep(1500);
  ok("L6e le logo est toujours là au retour dans l'éditeur", await until(f3, () => Boolean(document.querySelector(".site-brand[data-logo-image] img.site-logo-img")), null, 60000));
  // Publication : le public montre l'image ; le nom reste lisible des lecteurs d'écran.
  ok("L7 publication", await publish());
  const pub = await anon("/fr");
  ok("L7b public : image du logo dans l'en-tête, nom du site conservé pour les lecteurs d'écran", /data-logo-image/.test(pub.html) && /class="site-logo-img"/.test(pub.html) && /class="site-brand-text"/.test(pub.html), pub.html.match(/<a[^>]*site-brand[^>]*>/)?.[0]);
  await page.screenshot({ path: `${SHOTS}/L7-logo-publie.png` });
  // Retour au logo texte.
  await openEditor(homeId);
  await page.getByRole("tab", { name: "Réglages" }).click();
  await page.locator('[data-testid="logo-revert"]').click();
  ok("L8 « Revenir au logo texte » : plus d'image dans le brouillon du site", await waitFor(() => setting("siteDraft") !== null && siteLogo()?.mediaId === undefined));
  await settled();
  const f2 = await canvas();
  ok("L8b la toile redonne le nom en texte", await until(f2, () => !document.querySelector(".site-brand[data-logo-image]") && document.querySelector(".site-brand-text").getBoundingClientRect().width > 20, null, 60000));
  ok("L8c publication : le public redonne le nom en texte", (await publish()) && !/data-logo-image/.test((await anon("/fr")).html));
  await page.screenshot({ path: `${SHOTS}/L8-logo-texte.png` });
  ok("L9 aucune erreur de page", errors.length === 0, errors.join(" | "));
}

/* ======================================== T. Couverture d'une tuile ======================================== */
if (run("T")) {
  console.log("== T. Couverture d'une entrée de collection");
  let f = await openEditor(homeId);
  const tiles = '[data-edit-type="collection-tiles"]';
  await f.locator(tiles).first().scrollIntoViewIfNeeded();
  const tile = f.locator(`${tiles} .tile`).first();
  const imgSrc = () => f.evaluate(() => document.querySelector(".tiles .tile .tile-frame img")?.currentSrc ?? "");
  const before = await imgSrc();
  await tile.hover();
  const change = f.locator(".tiles .tile").first().locator(".pe-tile-cover button", { hasText: "Changer la couverture" });
  ok("T1 « Changer la couverture » au survol de la tuile", await change.waitFor({ state: "visible", timeout: 15000 }).then(() => true, () => false));
  ok("T1b pas de « Couverture automatique » tant qu'aucune couverture n'est choisie", (await f.locator(".pe-tile-cover button", { hasText: "Couverture automatique" }).count()) === 0);
  await page.screenshot({ path: `${SHOTS}/T1-tuile-couverture.png` });
  const pageId = Number(await tile.locator(".pe-tile-cover button").first().getAttribute("data-page-id"));
  await change.click();
  const dlg = page.locator("dialog.ve-picker[open]");
  await dlg.waitFor({ timeout: 10000 });
  const options = dlg.locator('ul[aria-label="Bibliothèque"] button');
  // Une image différente de la couverture actuelle (celle de la tuile, par son nom de fichier).
  const labels = await options.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""));
  const current = decodeURIComponent(before.split("/").pop() ?? "").replace(/^[0-9a-f]+-/, "").replace(/\.[a-z]+$/, "");
  const at = labels.findIndex((l) => !l.includes(current));
  const label = labels[at] ?? "";
  await options.nth(at).click();
  ok("T2 image choisie : posée sur l'entrée au brouillon", await waitFor(() => Number.isInteger(tilesDraft()?.edits?.find((e) => e.pageId === pageId)?.mediaId)));
  const chosen = tilesDraft().edits.find((e) => e.pageId === pageId).mediaId;
  ok("T2b c'est l'image choisie dans la médiathèque", q("select original_name as name from media where id = ?", chosen)[0]?.name === label.replace(/^Choisir /, ""), `${chosen} ${label}`);
  ok("T3 la tuile montre la nouvelle image", await until(f, (old) => (document.querySelector(".tiles .tile .tile-frame img")?.currentSrc ?? "") !== old, before, 60000), `avant ${before} / maintenant ${await imgSrc()} / brouillon ${JSON.stringify(tilesDraft()?.edits)}`);
  await f.locator(".tiles .tile").first().hover();
  const auto = f.locator(".tiles .tile").first().locator(".pe-tile-cover button", { hasText: "Couverture automatique" });
  ok("T3b « Couverture automatique » proposé", await auto.waitFor({ state: "visible", timeout: 15000 }).then(() => true, () => false));
  await page.screenshot({ path: `${SHOTS}/T3-tuile-couverture-choisie.png` });
  await auto.click();
  ok("T4 retour à la couverture de la collection : plus rien au brouillon", await waitFor(() => !(tilesDraft()?.edits ?? []).some((e) => e.mediaId !== undefined)));
  ok("T4b la tuile reprend son image", await until(f, (old) => (document.querySelector(".tiles .tile .tile-frame img")?.currentSrc ?? "") === old, before, 60000));

  // Collection vide : avis dans la tuile (toile), rien en public.
  const home = await anon("/fr");
  exec("delete from slots where collection = 'animation'");
  f = await openEditor(homeId);
  await f.locator(tiles).first().scrollIntoViewIfNeeded();
  const empty = f.locator("[data-tile-empty]");
  ok("T5 collection vide : avis dans la tuile sur la toile", await empty.first().waitFor({ timeout: 30000 }).then(() => true, () => false) && /Cette collection n'a encore aucune œuvre publiée/.test((await empty.first().textContent()) ?? ""), (await empty.first().textContent().catch(() => "")) ?? "");
  ok("T5b l'avis nomme la collection", /Animation/.test((await empty.first().textContent()) ?? ""));
  ok("T5c les autres tuiles restent", (await f.locator(`${tiles} .tile`).count()) === 2);
  await empty.first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/T5-collection-vide.png` });
  ok("T6 public : jamais d'avis (repères d'édition seulement sur la toile)", !/data-tile-empty|aucune œuvre publiée/.test(home.html) && !/data-tile-empty|aucune œuvre publiée/.test((await anon("/fr")).html));
  ok("T7 aucune erreur de page", errors.length === 0, errors.join(" | "));
}

await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
