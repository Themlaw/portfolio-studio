#!/usr/bin/env node
/**
 * Palette et logo du site depuis l'éditeur visuel (lot 17f), UN chromium sobre. Serveur dev requis, base
 * NEUVE (seed, thème galerie-lumineuse), une connexion.
 *
 *  P. Palette : panneau « Couleurs » (noms, phrases, nuances calculées repliées), surlignage au survol et au
 *     focus clavier + légende « utilisé par » (halo sans animation si mouvement réduit), « Fond de page » et
 *     « Boutons et liens » changés depuis le sélecteur avec aperçu immédiat sur la toile (avant
 *     l'enregistrement), brouillon du site, thème jamais modifié ; contraste AA en direct, avertissement,
 *     « Ajuster automatiquement », saisie jamais bloquée mais publication refusée ; publication et rendu
 *     public (aucun repère d'édition) ; Annuler / Rétablir ; retour aux couleurs du thème (aperçu et rendu
 *     public strictement ceux du thème).
 *  L. Logo : taille (curseur, poignée sur la toile : glisser, clavier, bornes 24–160), aperçu immédiat, trois
 *     comportements mesurés (hauteur rendue en haut et après défilement, aucun décalage de mise en page,
 *     CLS ~ 0, mouvement réduit), signature du kit, publication et rendu public, mobile 390 px (hauteur
 *     proportionnelle et plafonnée), sans réglage : rendu du thème (parité).
 *
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… [BASE=http://localhost:3206] [SHOTS=…] [ONLY=P,L] node scripts/e2e-palette-logo.mjs
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
const SHOTS = process.env.SHOTS ?? "screenshots/palogo17f";
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
const setting = (key) => JSON.parse(q("select value from settings where key = ?", key)[0]?.value ?? "null");
const siteDraftStyles = () => setting("siteDraft")?.snap?.styles;
const activeThemeRow = () => q("select data from themes where id = ?", setting("activeThemeId"))[0]?.data;

/* ---- Couleurs ------------------------------------------------------------------------------ */
const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const parseRgb = (s) => (/rgba?\((\d+), (\d+), (\d+)/.exec(s) ?? []).slice(1, 4).map(Number);
const lum = ([r, g, b]) => {
  const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const nearRgbStr = (str, hex, tol = 2) => {
  const got = parseRgb(str);
  return got.length === 3 && toRgb(hex).every((v, i) => Math.abs(v - got[i]) <= tol);
};
const nearHex = (a, b, tol = 3) => typeof a === "string" && typeof b === "string" && toRgb(a).every((v, i) => Math.abs(v - toRgb(b)[i]) <= tol);

const NEW_BG = "#f7f3e8";
// Un fond plus teinté fait passer le fond profond (nuance recalculée) sous 4,5:1 pour les étiquettes.
const TOO_TINTED_BG = "#f1ead9";
const NEW_PRIMARY = "#7a1f10";
const BAD_INK = "#eee6d4";

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(120000);
page.setDefaultNavigationTimeout(180000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => /Content Security Policy|Refused to/.test(m.text()) && errors.push("CSP : " + m.text().slice(0, 200)));

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
  await sleep(700);
}
const until = (f, fn, arg, timeout = 30000) =>
  f.waitForFunction(fn, arg, { timeout, polling: 100 }).then(
    () => true,
    () => false,
  );
async function waitFor(fn, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(250);
  }
  return false;
}
async function openEditor(id) {
  await page.goto(`${BASE}/admin/pages/${id}/editer`, { waitUntil: "domcontentloaded" });
  const f = await canvas();
  if (await page.getByRole("button", { name: "Abandonner les modifications" }).count()) {
    await page.getByRole("button", { name: "Abandonner les modifications" }).click();
    await Promise.all([
      page.waitForEvent("framenavigated", { predicate: (fr) => fr === page.mainFrame(), timeout: 60000 }),
      page.getByRole("dialog").getByRole("button", { name: "Abandonner les modifications" }).click(),
    ]);
    return canvas();
  }
  return f;
}
async function publish() {
  await settled();
  await page.getByRole("button", { name: "Publier", exact: true }).click();
  return waitFor(async () => /Publié/.test((await page.locator(".ve-status").textContent()) ?? ""), 120000);
}
/** Variable de couleur du thème, telle que la toile l'affiche (notation rvb du navigateur). */
const themeVar = (f, name) =>
  f.evaluate((n) => {
    const p = document.createElement("span");
    p.style.color = `var(${n})`;
    document.body.appendChild(p);
    const v = getComputedStyle(p).color;
    p.remove();
    return v;
  }, name);
const bodyBg = (f) => f.evaluate(() => getComputedStyle(document.body).backgroundColor);
const role = (name) => page.locator(".lc-role-item", { has: page.locator(".lc-role strong", { hasText: name }) });
async function pickColor(name, hex) {
  const item = role(name);
  if ((await item.getAttribute("data-open")) === null) await item.locator(".lc-role").click();
  const field = item.locator(".cp-hex");
  await field.waitFor();
  await field.fill(hex);
  await field.press("Enter");
}
const brandRect = (f) =>
  f.evaluate(() => {
    const b = document.querySelector(".site-header .site-brand").getBoundingClientRect();
    const bar = document.querySelector(".site-header-bar").getBoundingClientRect();
    const head = document.querySelector(".site-header").getBoundingClientRect();
    const main = document.querySelector("#contenu").getBoundingClientRect();
    return { h: b.height, bottom: b.bottom, barH: bar.height, barBottom: bar.bottom, headTop: head.top, mainDocTop: main.top + window.scrollY, scrollY: window.scrollY };
  });
const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;

let f;

/* ======================================== P. Palette ======================================== */

let baseBg = "";
let baseInk = "";
let basePrimary = "";
let themeRow = "";
if (run("P")) {
  f = await openEditor(2);
  await sleep(1500);
  await page.getByRole("tab", { name: "Réglages" }).click();
  themeRow = activeThemeRow();
  baseBg = await bodyBg(f);
  baseInk = await themeVar(f, "--t-color-ink");
  basePrimary = await themeVar(f, "--t-color-primary");
  ok("P0 thème clair de départ (les couleurs de test supposent un fond clair)", lum(parseRgb(baseBg)) > 0.5, baseBg);

  /* P1. Le panneau */
  for (const n of ["Fond de page", "Cartes et encadrés", "Texte", "Boutons et liens", "Accent"]) ok(`P1 rôle « ${n} »`, (await page.locator(".lc-role strong", { hasText: n }).count()) === 1);
  ok("P1b chaque rôle a une phrase qui dit à quoi il sert", (await page.locator(".lc-role small").allTextContents()).every((t) => t.trim().length > 15));
  ok("P1c aucun jargon de schéma dans les noms (Surface, Action, profond, filets)", !/Surface|Action\b|profond|filets/i.test((await page.locator(".lc-role strong").allTextContents()).join(" ")));
  ok("P1d « Nuances calculées » repliées", (await page.locator("details.lc-nuances").getAttribute("open")) === null);
  await page.locator("details.lc-nuances summary").click();
  ok("P1e nuances en lecture seule : neuf, avec leur usage, sans champ", (await page.locator(".lc-nuance-list li").count()) === 9 && (await page.locator(".lc-nuances input, .lc-nuances button").count()) === 0 && /Fond profond/.test((await page.locator(".lc-nuance-list").textContent()) ?? ""));
  await page.locator("details.lc-nuances summary").click();

  /* P2. Surlignage */
  await role("Texte").locator(".lc-role").hover();
  ok("P2a survol : la toile surligne les éléments du rôle", await until(f, () => document.querySelectorAll('[data-testid="hl-box"]').length > 0));
  ok("P2b légende « utilisé par » avec les éléments trouvés", await waitFor(async () => /Utilisé par : .*(titres|paragraphes|menu)/.test((await page.locator('[data-testid="hl-legend"]').textContent().catch(() => "")) ?? "")));
  ok("P2c la légende compte les éléments", /\d+ éléments? sur cette page/.test((await page.locator('[data-testid="hl-legend"]').textContent().catch(() => "")) ?? ""));
  const anim = await f.evaluate(() => getComputedStyle(document.querySelector(".sl-hl")).animationName);
  ok("P2d halo animé discret (mouvement autorisé)", anim === "sl-pulse", anim);
  await page.screenshot({ path: `${SHOTS}/P-survol-texte-1440.png` });
  await page.emulateMedia({ reducedMotion: "reduce" });
  ok("P2e mouvement réduit : plus d'animation", await until(f, () => getComputedStyle(document.querySelector(".sl-hl")).animationName === "none"));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.mouse.move(5, 5);
  ok("P2f pointeur parti : plus de surlignage", await until(f, () => document.querySelectorAll('[data-testid="hl-box"]').length === 0 && !document.querySelector('[data-testid="hl-frame"]')));
  await role("Fond de page").locator(".lc-role").hover();
  ok("P2g « Fond de page » : cadre de la fenêtre ou boîtes des fonds", await until(f, () => Boolean(document.querySelector('[data-testid="hl-frame"]')) || document.querySelectorAll('[data-testid="hl-box"]').length > 0));
  await page.mouse.move(5, 5);
  await role("Boutons et liens").locator(".lc-role").focus();
  ok("P2h focus clavier : légende et surlignage comme au survol", await waitFor(async () => /Utilisé par/.test((await page.locator('[data-testid="hl-legend"]').textContent().catch(() => "")) ?? "")));
  await page.evaluate(() => document.activeElement?.blur());

  /* P3. « Fond de page » depuis le sélecteur */
  const bgDeepBefore = await themeVar(f, "--t-color-bg-deep");
  await pickColor("Fond de page", NEW_BG);
  const t0 = Date.now();
  ok("P3a aperçu immédiat sur la toile (avant l'enregistrement)", await waitFor(async () => nearRgbStr(await bodyBg(f), NEW_BG), 1500), await bodyBg(f));
  console.log(`   (aperçu après ${Date.now() - t0} ms)`);
  ok("P3b le fond profond (nuance) suit le fond de page", (await themeVar(f, "--t-color-bg-deep")) !== bgDeepBefore);
  await page.screenshot({ path: `${SHOTS}/P-selecteur-fond-1440.png` });
  await settled();
  ok("P3c brouillon du site : palette.bg enregistrée", await waitFor(() => nearHex(siteDraftStyles()?.palette?.bg, NEW_BG)), JSON.stringify(siteDraftStyles()));
  ok("P3d état de l'éditeur : brouillon enregistré, rien en ligne", /Brouillon/.test((await page.locator(".ve-status").textContent()) ?? "") && setting("styles") === null);
  ok("P3e le thème n'est jamais modifié", activeThemeRow() === themeRow);
  ok("P3f le rôle est marqué « modifiée »", /modifiée/.test((await role("Fond de page").locator(".lc-state").textContent()) ?? ""));
  ok("P3g toile après acquittement du serveur : même couleur (pas de retour à l'ancienne)", nearRgbStr(await bodyBg(f), NEW_BG));

  /* P3''. Fond trop teinté : le défaut vient d'une NUANCE (fond profond), l'avertissement et l'ajustement la voient */
  await pickColor("Fond de page", TOO_TINTED_BG);
  ok("P3m fond trop teinté : avertissement sur « Fond de page » (fond profond nommé)", await waitFor(async () => /Contraste insuffisant.*fond profond/i.test((await page.locator('[data-testid="contrast-status"]').textContent().catch(() => "")) ?? "")));
  await page.getByTestId("contrast-fix").click();
  ok("P3n « Ajuster automatiquement » : contraste suffisant, nuances comprises", await waitFor(async () => /Contraste suffisant/.test((await page.locator('[data-testid="contrast-status"]').textContent().catch(() => "")) ?? "")));
  await pickColor("Fond de page", NEW_BG);
  await settled();

  /* P3'. « Boutons et liens » */
  const hoverBefore = await themeVar(f, "--t-color-primary-hover");
  await pickColor("Boutons et liens", NEW_PRIMARY);
  ok("P3h aperçu immédiat : couleur des boutons et liens", await waitFor(async () => nearRgbStr(await themeVar(f, "--t-color-primary"), NEW_PRIMARY), 1500));
  ok("P3i survol et texte des boutons recalculés", (await themeVar(f, "--t-color-primary-hover")) !== hoverBefore);
  await settled();
  ok("P3j brouillon du site : palette.primary enregistrée, bg conservée", await waitFor(() => nearHex(siteDraftStyles()?.palette?.primary, NEW_PRIMARY) && nearHex(siteDraftStyles()?.palette?.bg, NEW_BG)), JSON.stringify(siteDraftStyles()));
  ok("P3k contraste suffisant affiché", /Contraste suffisant/.test((await page.locator('[data-testid="contrast-status"]').textContent().catch(() => "")) ?? ""));

  /* P4. Contraste : avertissement, ajustement, publication bloquée */
  await pickColor("Texte", BAD_INK);
  ok("P4a avertissement clair + proposition", await waitFor(async () => /Contraste insuffisant/.test((await page.locator('[data-testid="contrast-status"]').textContent().catch(() => "")) ?? "")) && (await page.getByTestId("contrast-fix").isVisible()));
  ok("P4b le rôle est signalé en erreur", (await role("Texte").getAttribute("data-invalid")) !== null);
  await settled();
  ok("P4c la saisie n'est pas bloquée : palette.ink enregistrée au brouillon", await waitFor(() => nearHex(siteDraftStyles()?.palette?.ink, BAD_INK)), JSON.stringify(siteDraftStyles()));
  await page.screenshot({ path: `${SHOTS}/P-contraste-alerte-1440.png` });
  await page.getByRole("button", { name: "Publier", exact: true }).click();
  ok("P4d publication refusée : texte illisible nommé", await waitFor(async () => /illisible/.test((await page.locator(".ve").textContent()) ?? ""), 60000));
  ok("P4e rien n'est publié", setting("styles") === null);
  await page.getByTestId("contrast-fix").click();
  ok("P4f « Ajuster automatiquement » : contraste suffisant", await waitFor(async () => /Contraste suffisant/.test((await page.locator('[data-testid="contrast-status"]').textContent().catch(() => "")) ?? "")));
  await settled();
  const inkNow = parseRgb(await themeVar(f, "--t-color-ink"));
  const bgNow = parseRgb(await bodyBg(f));
  ok("P4g texte ajusté : au moins 4,5:1 sur le fond", ratio(inkNow, bgNow) >= 4.5, ratio(inkNow, bgNow).toFixed(2));
  ok("P4h brouillon : l'encre ajustée est enregistrée (≠ la saisie illisible)", await waitFor(() => siteDraftStyles()?.palette?.ink && !nearHex(siteDraftStyles().palette.ink, BAD_INK)), JSON.stringify(siteDraftStyles()));

  /* P5. Publication et rendu public */
  ok("P5a publication acceptée", await publish());
  const styles = setting("styles");
  ok("P5b réglages publiés : bg, primary, ink", nearHex(styles?.palette?.bg, NEW_BG) && nearHex(styles?.palette?.primary, NEW_PRIMARY) && Boolean(styles?.palette?.ink), JSON.stringify(styles));
  ok("P5c le thème en ligne reste celui du thème", activeThemeRow() === themeRow);
  const html = await (await fetch(`${BASE}/fr`)).text();
  const sheet = /<style id="site-palette"[^>]*>([^<]*)<\/style>/.exec(html)?.[1] ?? "";
  ok("P5d public : feuille de la palette du site dans la page", sheet.startsWith(":root:root{") && sheet.includes(`--t-color-bg:${styles?.palette?.bg}`), sheet.slice(0, 120));
  ok("P5e public : aucun repère d'édition", !/data-edit|data-nav-key|pe-host/.test(html));
  const pub = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pp = await pub.newPage();
  await pp.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  const pbg = await pp.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok("P5f public : fond de page rendu", nearHex("#" + parseRgb(pbg).map((v) => v.toString(16).padStart(2, "0")).join(""), styles?.palette?.bg), pbg);
  await pp.screenshot({ path: `${SHOTS}/P-public-1440.png` });
  await pp.setViewportSize({ width: 390, height: 844 });
  await pp.reload({ waitUntil: "networkidle" });
  ok("P5g public mobile 390 : pas de défilement horizontal", await pp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await pp.screenshot({ path: `${SHOTS}/P-public-390.png` });
  await pub.close();

  /* P6. Annuler / Rétablir */
  await pickColor("Fond de page", "#faf5e8");
  await settled();
  ok("P6a nouveau fond au brouillon", await waitFor(() => nearHex(siteDraftStyles()?.palette?.bg, "#faf5e8")), JSON.stringify(siteDraftStyles()));
  await page.locator(".ve-history").getByRole("button", { name: "Annuler" }).click();
  ok("P6b Annuler : le fond publié revient (brouillon identique au publié = plus de brouillon du site)", await waitFor(() => setting("siteDraft") === null || nearHex(siteDraftStyles()?.palette?.bg, NEW_BG)), JSON.stringify(setting("siteDraft")));
  ok("P6c Annuler : la toile montre le fond d'avant", await until(f, (c) => getComputedStyle(document.body).backgroundColor === c, `rgb(${bgNow.join(", ")})`, 8000), await bodyBg(f));
  await page.locator(".ve-history").getByRole("button", { name: "Rétablir" }).click();
  ok("P6d Rétablir : le fond voulu revient", await waitFor(() => nearHex(siteDraftStyles()?.palette?.bg, "#faf5e8")), JSON.stringify(siteDraftStyles()));
  await page.locator(".ve-history").getByRole("button", { name: "Annuler" }).click();
  await settled();

  /* P7. Retour aux couleurs du thème */
  await page.getByRole("button", { name: "Revenir aux couleurs du thème" }).click();
  ok("P7a aperçu immédiat : la toile retrouve les couleurs du thème (par-dessus la feuille du serveur)", await until(f, (c) => getComputedStyle(document.body).backgroundColor === c, baseBg, 2000), await bodyBg(f));
  ok("P7b texte et boutons aussi", (await themeVar(f, "--t-color-ink")) === baseInk && (await themeVar(f, "--t-color-primary")) === basePrimary);
  await settled();
  ok("P7c brouillon : plus de palette", await waitFor(() => !siteDraftStyles()?.palette), JSON.stringify(siteDraftStyles()));
  ok("P7d publication", await publish());
  const html2 = await (await fetch(`${BASE}/fr`)).text();
  ok("P7e public : plus aucune feuille de palette (rendu du thème)", !html2.includes('id="site-palette"') && setting("styles") === null);
  ok("P7f le thème n'a jamais bougé", activeThemeRow() === themeRow);
}

/* ======================================== L. Logo ======================================== */

if (run("L")) {
  f = await openEditor(2);
  await sleep(1500);
  await page.getByRole("tab", { name: "Réglages" }).click();
  const initial = await brandRect(f);
  ok("L0 sans réglage : pas de feuille du logo ni de palette dans la page publique", !(await (await fetch(`${BASE}/fr`)).text()).match(/id="site-(logo|palette)"/));

  /* L1. Curseur */
  const slider = page.locator("#lp-logo-size");
  ok("L1a bornes du curseur : 24 à 160 px", (await slider.getAttribute("min")) === "24" && (await slider.getAttribute("max")) === "160");
  await slider.fill("96");
  const t0 = Date.now();
  ok("L1b aperçu immédiat sur la toile (hauteur du logo ≈ 96 px)", await until(f, () => Math.abs(document.querySelector(".site-header .site-brand").getBoundingClientRect().height - 96) < 1.5, null, 1500), JSON.stringify(await brandRect(f)));
  console.log(`   (aperçu après ${Date.now() - t0} ms)`);
  ok("L1c valeur lue : 96 px", /96 px/.test((await page.getByTestId("logo-size-out").textContent()) ?? ""));
  await settled();
  ok("L1d brouillon du site : logo.size = 96", await waitFor(() => siteDraftStyles()?.logo?.size === 96), JSON.stringify(siteDraftStyles()));
  await slider.fill("5");
  ok("L1e en dessous de la borne : 24 px", (await slider.inputValue()) === "24");
  await slider.fill("96");

  /* L2. Poignée sur la toile */
  await f.locator(".site-header").hover();
  const handle = f.getByTestId("logo-handle");
  ok("L2a survol de l'en-tête : poignée de taille sous le logo", await handle.waitFor({ timeout: 10000 }).then(() => true, () => false));
  ok("L2b la poignée annonce la taille et ses bornes", (await handle.getAttribute("aria-valuenow")) === "96" && (await handle.getAttribute("aria-valuemin")) === "24" && (await handle.getAttribute("aria-valuemax")) === "160");
  await page.screenshot({ path: `${SHOTS}/L-poignee-1440.png` });
  const hb = await handle.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2 + 12, { steps: 4 });
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2 + 24, { steps: 4 });
  await sleep(300);
  const dragged = Number(await handle.getAttribute("aria-valuenow"));
  ok("L2c glisser vers le bas : le logo grandit (≈ +24 px)", dragged >= 116 && dragged <= 122, String(dragged));
  ok("L2d la toile suit pendant le geste", await until(f, (v) => Math.abs(document.querySelector(".site-header .site-brand").getBoundingClientRect().height - v) < 1.5, dragged, 2000));
  await page.mouse.up();
  await settled();
  ok("L2e enregistré au relâchement", await waitFor(() => siteDraftStyles()?.logo?.size === dragged), JSON.stringify(siteDraftStyles()));
  ok("L2f le curseur du panneau suit", (await slider.inputValue()) === String(dragged));
  await handle.focus();
  await page.keyboard.press("ArrowUp");
  ok("L2g clavier : flèche haut = −2 px", await waitFor(async () => Number(await handle.getAttribute("aria-valuenow")) === dragged - 2));
  await page.keyboard.press("End");
  ok("L2h clavier : Fin = 160 px (borne haute)", await until(f, () => Math.abs(document.querySelector(".site-header .site-brand").getBoundingClientRect().height - 160) < 1.5, null, 2000));
  await page.keyboard.press("Home");
  ok("L2i clavier : Début = 24 px (borne basse)", await until(f, () => Math.abs(document.querySelector(".site-header .site-brand").getBoundingClientRect().height - 24) < 1.5, null, 2000));
  await settled();
  await slider.fill("120");
  await settled();

  /* L3. Logo image du kit : même réglage */
  await f.evaluate(() => {
    document.documentElement.setAttribute("data-kit-signature", "");
    const svg = "data:image/svg+xml;utf8," + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 40'><rect width='200' height='40'/></svg>");
    document.documentElement.style.setProperty("--t-kit-signature", `url("${svg}")`);
    document.documentElement.style.setProperty("--t-kit-signature-ratio", "5 / 1");
  });
  const sig = await f.evaluate(() => {
    const s = document.querySelector(".site-signature").getBoundingClientRect();
    return { h: s.height, w: s.width };
  });
  ok("L3 signature du kit : même hauteur (120 px), largeur selon sa proportion", near(sig.h, 120) && near(sig.w, 600, 4), JSON.stringify(sig));
  await f.evaluate(() => {
    document.documentElement.removeAttribute("data-kit-signature");
    document.documentElement.style.removeProperty("--t-kit-signature");
    document.documentElement.style.removeProperty("--t-kit-signature-ratio");
  });

  /* L4. Les trois comportements, mesurés dans l'aperçu exact (en-tête collant) */
  const mode = async (label) => {
    await page.getByRole("radio", { name: label }).check();
    await settled();
  };
  const measure = async (name) => {
    await page.getByRole("button", { name: "Aperçu", exact: true }).click();
    await f.waitForFunction(() => !document.documentElement.hasAttribute("data-edit-canvas"), null, { timeout: 30000 });
    await sleep(500);
    await f.evaluate(() => {
      window.scrollTo(0, 0);
      window.__cls = 0;
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
      }).observe({ type: "layout-shift", buffered: false });
    });
    await sleep(800);
    const top = await brandRect(f);
    await f.evaluate(() => window.scrollTo(0, 500));
    await sleep(1200);
    const scrolled = await brandRect(f);
    const cls = await f.evaluate(() => window.__cls);
    await page.screenshot({ path: `${SHOTS}/L-${name}-defile-1440.png` });
    await f.evaluate(() => window.scrollTo(0, 0));
    await sleep(1200);
    const back = await brandRect(f);
    return { top, scrolled, back, cls };
  };
  const exitPreview = async () => {
    await page.locator(".ve-exit-preview").click();
    await f.waitForFunction(() => document.documentElement.hasAttribute("data-edit-canvas"), null, { timeout: 30000 });
  };

  await mode("Fixe");
  let m = await measure("fixe");
  ok("L4a Fixe : 120 px en haut et après défilement", near(m.top.h, 120) && near(m.scrolled.h, 120), JSON.stringify([m.top.h, m.scrolled.h]));
  ok("L4b Fixe : la page ne bouge pas (contenu au même endroit)", near(m.top.mainDocTop, m.scrolled.mainDocTop));
  await exitPreview();

  await mode("Grand en haut, réduit au défilement");
  m = await measure("reduit");
  ok("L4c Réduit : 120 px en haut", near(m.top.h, 120), String(m.top.h));
  ok("L4d Réduit : 72 px (60 %) après défilement", near(m.scrolled.h, 72, 2), String(m.scrolled.h));
  ok("L4e Réduit : retour à 120 px en haut de page", near(m.back.h, 120, 2), String(m.back.h));
  ok("L4f Réduit : aucun décalage de mise en page (contenu au même endroit)", near(m.top.mainDocTop, m.scrolled.mainDocTop, 1) && near(m.top.mainDocTop, m.back.mainDocTop, 1), JSON.stringify([m.top.mainDocTop, m.scrolled.mainDocTop, m.back.mainDocTop]));
  ok("L4g Réduit : CLS ≈ 0", m.cls < 0.02, String(m.cls));
  ok("L4h Réduit : l'en-tête reste collé en haut", near(m.scrolled.headTop, 0, 1), String(m.scrolled.headTop));
  const trans = await f.evaluate(() => getComputedStyle(document.querySelector(".site-header .site-brand")).transitionProperty);
  ok("L4i transition fluide de la hauteur (mouvement autorisé)", trans.includes("height"), trans);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const transReduced = await f.evaluate(() => getComputedStyle(document.querySelector(".site-header .site-brand")).transitionProperty);
  ok("L4j mouvement réduit : plus de transition de la hauteur", !transReduced.includes("height"), transReduced);
  await f.evaluate(() => window.scrollTo(0, 500));
  await sleep(300);
  ok("L4k mouvement réduit : la réduction se fait quand même, sans animation", near((await brandRect(f)).h, 72, 2));
  await f.evaluate(() => window.scrollTo(0, 0));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await exitPreview();
  await f.evaluate(() => window.scrollTo(0, 500));
  await sleep(1000);
  ok("L4l sur la toile d'édition (en-tête non collant) le logo garde sa taille réglée", near((await brandRect(f)).h, 120));
  await f.evaluate(() => window.scrollTo(0, 0));

  await mode("Déborde sous le bandeau");
  m = await measure("deborde");
  ok("L4m Déborde : le logo dépasse sous la barre du haut (≥ 40 px)", m.top.bottom - m.top.barBottom >= 40, JSON.stringify([m.top.bottom, m.top.barBottom]));
  ok("L4n Déborde : barre plus basse que le logo, en haut comme défilé", m.top.barH < m.top.h && near(m.top.barH, m.scrolled.barH, 1));
  ok("L4o Déborde : le logo dépasse encore en défilant, en-tête collé", m.scrolled.bottom - m.scrolled.barBottom >= 40 && near(m.scrolled.headTop, 0, 1));
  ok("L4p Déborde : aucun décalage de mise en page", near(m.top.mainDocTop, m.scrolled.mainDocTop, 1) && m.cls < 0.02, JSON.stringify([m.top.mainDocTop, m.scrolled.mainDocTop, m.cls]));
  await exitPreview();

  /* L5. Publication : rendu public (réduit) et mobile 390 px */
  await mode("Grand en haut, réduit au défilement");
  ok("L5a publication", await publish());
  ok("L5b réglages publiés : logo", JSON.stringify(setting("styles")?.logo) === JSON.stringify({ size: 120, mode: "shrink" }), JSON.stringify(setting("styles")));
  const pubCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pg = await pubCtx.newPage();
  await pg.addInitScript(() => {
    window.__cls = 0;
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  await pg.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  const rect = () => brandRect(pg);
  await sleep(500);
  const pTop = await rect();
  await pg.screenshot({ path: `${SHOTS}/L-public-haut-1440.png` });
  await pg.evaluate(() => (window.__cls = 0));
  await pg.evaluate(() => window.scrollTo(0, 500));
  await sleep(1200);
  const pScrolled = await rect();
  const pCls = await pg.evaluate(() => window.__cls);
  await pg.screenshot({ path: `${SHOTS}/L-public-defile-1440.png` });
  ok("L5c public : 120 px en haut, 72 px après défilement", near(pTop.h, 120) && near(pScrolled.h, 72, 2), JSON.stringify([pTop.h, pScrolled.h]));
  ok("L5d public : contenu immobile pendant la réduction, CLS ≈ 0", near(pTop.mainDocTop, pScrolled.mainDocTop, 1) && pCls < 0.02, JSON.stringify([pTop.mainDocTop, pScrolled.mainDocTop, pCls]));
  ok("L5e public : aucun repère d'édition", !(await pg.evaluate(() => document.documentElement.outerHTML)).match(/data-edit|pe-host|sl-logo-handle/));
  await pg.setViewportSize({ width: 390, height: 844 });
  await pg.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  await sleep(500);
  const mTop = await rect();
  await pg.screenshot({ path: `${SHOTS}/L-public-haut-390.png` });
  await pg.evaluate(() => window.scrollTo(0, 500));
  await sleep(1200);
  const mScrolled = await rect();
  await pg.screenshot({ path: `${SHOTS}/L-public-defile-390.png` });
  ok("L5f mobile 390 : taille proportionnelle et plafonnée (120 × 0,75 → 64 px)", near(mTop.h, 64), String(mTop.h));
  ok("L5g mobile 390 : réduit au défilement (60 %, 24 px au moins)", near(mScrolled.h, 38.4, 2) && mScrolled.h >= 24, String(mScrolled.h));
  ok("L5h mobile 390 : pas de défilement horizontal, bouton Menu visible", (await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)) && (await pg.getByRole("button", { name: /Menu/i }).isVisible()));
  ok("L5i mobile 390 : contenu immobile", near(mTop.mainDocTop, mScrolled.mainDocTop, 1), JSON.stringify([mTop.mainDocTop, mScrolled.mainDocTop]));
  await pubCtx.close();

  /* L6. Retour au thème : parité */
  f = await openEditor(2);
  await sleep(1500);
  await page.getByRole("tab", { name: "Réglages" }).click();
  await page.getByRole("button", { name: "Revenir à la taille du thème" }).click();
  await page.getByRole("radio", { name: "Fixe" }).check();
  await settled();
  ok("L6a brouillon : plus de réglage de logo", await waitFor(() => !siteDraftStyles()?.logo), JSON.stringify(siteDraftStyles()));
  const reset = await brandRect(f);
  ok("L6b la toile retrouve exactement la taille du thème", near(reset.h, initial.h, 0.5) && near(reset.barH, initial.barH, 0.5), JSON.stringify([reset, initial]));
  ok("L6c publication", await publish());
  const html3 = await (await fetch(`${BASE}/fr`)).text();
  ok("L6d public : plus de feuille du logo ni de palette (rendu du thème)", !/id="site-(logo|palette)"/.test(html3) && setting("styles") === null);
}

ok("aucune erreur de page ni de CSP", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
if (failures) {
  console.error(`e2e-palette-logo : ÉCHEC (${failures})`);
  process.exit(1);
}
console.log("e2e-palette-logo : tout passe");
