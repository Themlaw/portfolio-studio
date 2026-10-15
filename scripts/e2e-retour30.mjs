#!/usr/bin/env node
/**
 * Lot 30 (v0.22.1) : « Revenir… » d'une nuance du panneau « Couleurs » efface le choix (la clé disparaît du brouillon du
 * site, pas de « auto » écrit) : on retombe sur la valeur FIXÉE PAR LE THÈME si elle existe, sinon sur le calcul.
 *
 *  R. Thème livré qui force le survol (galerie lumineuse) : changer le survol puis « Revenir à la couleur du thème » →
 *     libellé, badge « thème », clé absente, toile ET public (:hover d'un bouton) exactement comme avant.
 *  S. Nuance non fixée par le thème (voile) : « Revenir à l'automatique », badge « automatique », clé absente.
 *  L. Placement du sélecteur de couleur : à côté de son déclencheur (droite, sinon gauche), jamais en dessous sauf écran
 *     trop étroit, entièrement dans la fenêtre : barre du texte (toile), panneau « Couleurs », sélecteur de l'administration,
 *     téléphone.
 *
 * Usage : BASE=http://localhost:3390 DATA_DIR=~/pf/data-30 ADMIN_EMAIL=… ADMIN_PASSWORD=… SHOTS=/dossier [ONLY=R,S,L] node scripts/e2e-retour30.mjs
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
const SHOTS = process.env.SHOTS ?? "screenshots/retour30";
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
const homeId = q("select page_id id from blocks where type = 'hero' limit 1")[0].id;
const setting = (key) => JSON.parse(q("select value from settings where key = ?", key)[0]?.value ?? "null");
const sitePalette = () => setting("siteDraft")?.snap?.styles?.palette ?? {};
async function waitFor(fn, timeout = 60000) {
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(300)) if (await fn()) return true;
  return false;
}

/* ---- Couleurs : conversions de contrôle (indépendantes du code testé) ---- */
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
const paletteSheet = (html) => /<style id="site-palette"[^>]*>([^<]*)<\/style>/.exec(html)?.[1] ?? "";
/** Propriété personnalisée d'un document (valeur brute). */
const rootVar = (f, name) => f.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toLowerCase(), name);
/** Variable de couleur résolue (rgb). */
const colorVar = (f, name) =>
  f.evaluate((n) => {
    const p = document.createElement("span");
    p.style.color = `var(${n})`;
    document.body.appendChild(p);
    const v = getComputedStyle(p).color;
    p.remove();
    return v;
  }, name);

const item = (k) => page.locator(`.lc-nuance-item[data-nuance="${k}"]`);
const pick = async (k, hex) => {
  if ((await item(k).getAttribute("data-open")) === null) await item(k).locator(".lc-nuance").click();
  const field = item(k).locator(".cp-hex");
  await field.waitFor();
  await field.fill(hex);
  await field.press("Enter");
};
const resetBtn = (k) => item(k).locator(".cp-foot button", { hasText: /^Revenir à (la couleur du thème|l'automatique)$/ });
async function openPanel() {
  const f = await openEditor(homeId);
  await page.getByRole("tab", { name: "Réglages" }).click();
  await item("primaryHover").waitFor();
  return f;
}
/** Couleurs d'un bouton public au repos et au survol. */
async function publicButton() {
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pp = await ctx2.newPage();
  await pp.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  const btn = pp.locator("a.btn, button.btn").first();
  await btn.scrollIntoViewIfNeeded();
  await pp.mouse.move(5, 5);
  await sleep(500);
  const rest = await btn.evaluate((e) => getComputedStyle(e).backgroundColor);
  await btn.hover();
  await sleep(900);
  const hover = await btn.evaluate((e) => `${getComputedStyle(e).backgroundColor} / ${getComputedStyle(e).color}`);
  const sheet = paletteSheet(await pp.content());
  await ctx2.close();
  return { rest, hover, sheet };
}

if (run("R")) {
  console.log("== R. Thème qui force le survol");
  const f = await openPanel();
  ok("R0 le thème livré fixe le survol : badge « thème »", (await item("primaryHover").getAttribute("data-origin")) === "theme" && /thème/.test((await item("primaryHover").locator(".lc-nstate").textContent()) ?? ""));
  const startVar = await colorVar(f, "--t-color-primary-hover");
  const before = await publicButton();
  await pick("primaryHover", "#aa0000");
  await settled();
  ok("R1 survol choisi : enregistré dans le brouillon du site", await waitFor(() => sitePalette().primaryHover === "#aa0000"), JSON.stringify(sitePalette()));
  ok("R1b badge « choisie »", (await item("primaryHover").getAttribute("data-origin")) === "site");
  ok("R2 le bouton dit « Revenir à la couleur du thème » (pas « automatique »)", (await resetBtn("primaryHover").count()) === 1 && (await resetBtn("primaryHover").textContent()).trim() === "Revenir à la couleur du thème", await item("primaryHover").locator(".cp-foot").allTextContents().then((t) => t.join("|")));
  await page.screenshot({ path: `${SHOTS}/survol-choisi.png` });
  ok("R2b publication avec le survol choisi", await publish());
  const mid = await publicButton();
  ok("R2c public : le survol a bien changé (contrôle)", mid.hover !== before.hover && mid.sheet.includes("--t-color-primary-hover:#aa0000"), mid.hover);
  await resetBtn("primaryHover").click();
  await settled();
  ok("R3 la clé du survol disparaît du brouillon (aucun « auto » écrit)", await waitFor(() => !("primaryHover" in sitePalette())), JSON.stringify(sitePalette()));
  ok("R3b badge « thème » (pas « automatique »)", (await item("primaryHover").getAttribute("data-origin")) === "theme" && (await item("primaryHover").locator(".lc-nstate").textContent()).trim() === "thème");
  ok("R3c la toile retrouve exactement la couleur du thème", (await colorVar(f, "--t-color-primary-hover")) === startVar, `${await colorVar(f, "--t-color-primary-hover")} / ${startVar}`);
  await page.screenshot({ path: `${SHOTS}/survol-revenu.png` });
  ok("R4 publication du retour", await publish());
  const after = await publicButton();
  ok("R4b public : repos et survol d'un bouton exactement comme avant", after.rest === before.rest && after.hover === before.hover, `${JSON.stringify(before)} / ${JSON.stringify(after)}`);
  ok("R4c public : plus de feuille de palette du site", after.sheet === "", after.sheet.slice(0, 200));
}

if (run("S")) {
  console.log("== S. Nuance que le thème ne fixe pas");
  const f = await openPanel();
  const startScrim = await rootVar(f, "--t-color-viewer");
  ok("S0 le voile est calculé : badge « automatique »", (await item("scrim").getAttribute("data-origin")) === "auto");
  await pick("scrim", "#102030");
  await settled();
  ok("S1 voile choisi enregistré", await waitFor(() => sitePalette().scrim === "#102030"), JSON.stringify(sitePalette()));
  ok("S2 le bouton dit « Revenir à l'automatique »", (await resetBtn("scrim").count()) === 1 && (await resetBtn("scrim").textContent()).trim() === "Revenir à l'automatique");
  await resetBtn("scrim").click();
  await settled();
  ok("S3 la clé disparaît du brouillon, pas de « auto »", await waitFor(() => !("scrim" in sitePalette())), JSON.stringify(sitePalette()));
  ok("S3b badge « automatique » et toile comme avant", (await item("scrim").getAttribute("data-origin")) === "auto" && (await rootVar(f, "--t-color-viewer")) === startScrim);
  // Un deuxième choix puis retour sur une nuance dépendante d'une base changée : le calcul suit la base.
  await pick("primaryHover", "#aa0000");
  await settled();
  await resetBtn("primaryHover").click();
  await settled();
  ok("S4 palette du site entièrement vide après les retours", await waitFor(() => Object.keys(sitePalette()).length === 0), JSON.stringify(sitePalette()));
}


const H2 = 'h2[data-inline="title"]';
const until = (f, fn, arg, timeout = 60000) => f.waitForFunction(fn, arg, { timeout, polling: 200 }).then(() => true, () => false);
async function openBar(f, sel) {
  if (await f.locator(".lk-bar").count()) {
    await f.locator(".lk-bar .lk-close").click().catch(() => {});
    await f.locator(".lk-bar").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  }
  const target = f.locator(sel).first();
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
/** Rectangles utiles dans le document `d` (page ou toile) : fenêtre, déclencheur, fenêtre du sélecteur. */
const rects = (d, trig) =>
  d.evaluate((sel) => {
    const r = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
    const trigger = document.querySelector(sel);
    const cp = document.querySelector(".cp");
    return { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight, trigger: trigger && r(trigger), cp: cp && r(cp), side: cp?.getAttribute("data-side") ?? null };
  }, trig);
/** À côté (pas en dessous), alignée en haut ou remontée, entièrement visible. */
const beside = (m) => m.cp && m.trigger && (m.cp.l >= m.trigger.r - 1 || m.cp.r <= m.trigger.l + 1) && m.cp.t <= m.trigger.t + 1 && m.cp.t >= 7 && m.cp.b <= m.h - 7 && m.cp.l >= 7 && m.cp.r <= m.w - 7;
const inside = (m) => m.cp && m.cp.l >= -1 && m.cp.r <= m.w + 1 && m.cp.t >= -1;

if (run("L")) {
  console.log("== L. Placement du sélecteur de couleur");
  await page.setViewportSize({ width: 1280, height: 800 });
  // 1. Barre du texte, sur la toile, à plusieurs largeurs (le côté suit la place).
  for (const width of [1280, 1180, 1100, 1000, 820]) {
    await page.setViewportSize({ width, height: 800 });
    const f = await openEditor(homeId);
    ok(`L1 ${width} px : barre du texte ouverte`, await openBar(f, H2));
    await f.locator(".lk-bar .tc-wheel").first().click();
    await f.locator(".cp").waitFor({ timeout: 10000 });
    await sleep(300);
    const m = await rects(f, ".lk-bar .tc-wheel");
    // Côté choisi d'après la place : à droite si elle suffit, sinon à gauche ; ni l'un ni l'autre = dessous, compact, sans déborder.
    const frame = await f.locator(".lk-bar").evaluate((e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right }; });
    const trig = m.trigger;
    const fits = (r, l) => m.w - 8 - r - 8 >= 300 ? "right" : l - 16 >= 300 ? "left" : null;
    const want = fits(frame.r, frame.l) ?? fits(trig.r, trig.l);
    console.log(`  (${width} px : iframe ${m.w} px, côté ${m.side}, attendu ${want})`);
    ok(`L1b ${width} px : côté ${m.side ?? "dessous (écran étroit)"}, comme la place le veut`, (m.side ?? null) === want, JSON.stringify({ m, roomR, roomL }));
    ok(`L1c ${width} px : ${want ? "à côté du déclencheur, alignée en haut, " : ""}entièrement visible`, want ? beside(m) : inside(m) && m.cp.r <= m.w + 1, JSON.stringify(m));
    if (width === 1280) await page.screenshot({ path: `${SHOTS}/placement-barre.png` });
    await f.locator(".cp").press("Escape");
  }
  // 2. Panneau « Couleurs » (colonne de gauche) : s'ouvre à droite du panneau, sur la toile.
  await page.setViewportSize({ width: 1280, height: 800 });
  {
    await openPanel();
    const row = page.locator('.lc-role-item[data-role="ink"] .lc-role');
    await row.click();
    await page.locator(".lc-role-item[data-role=ink] .cp").waitFor();
    await sleep(300);
    const aside = await page.locator("aside.ve-panel").evaluate((e) => e.getBoundingClientRect().right);
    const m = await rects(page, '.lc-role-item[data-role="ink"] .lc-role');
    ok("L2 panneau « Couleurs » : le sélecteur s'ouvre à droite du panneau, sur la toile", m.cp && m.cp.l >= aside - 1 && inside(m) && m.cp.b <= m.h + 1 && m.side === "right", JSON.stringify({ aside, ...m }));
    await page.screenshot({ path: `${SHOTS}/placement-panneau-couleurs.png` });
    await page.locator(".lc-role-item[data-role=ink] .cp").press("Escape");
    // Nuance : même règle.
    await item("primaryHover").locator(".lc-nuance").click();
    await item("primaryHover").locator(".cp").waitFor();
    await sleep(300);
    const n = await rects(page, '.lc-nuance-item[data-nuance="primaryHover"] .lc-nuance');
    ok("L2b nuance : idem, à droite du panneau", n.cp && n.cp.l >= aside - 1 && inside(n) && n.side === "right", JSON.stringify(n));
    await item("primaryHover").locator(".cp").press("Escape");
  }
  // 3. Sélecteur de l'administration (couleur des boutons de la page).
  {
    const sw = page.getByRole("switch", { name: "Boutons et liens de cette page" });
    if (await sw.count()) {
      if (!(await sw.isChecked())) await page.locator("label.a-toggle", { hasText: "Boutons et liens de cette page" }).click();
      await page.locator(".cpw-chip").first().click();
      await page.locator(".cpw .cp").waitFor({ timeout: 10000 });
      await sleep(300);
      const m = await rects(page, ".cpw-chip");
      ok("L3 sélecteur de l'administration : à côté de la pastille, entièrement visible", beside(m), JSON.stringify(m));
      await page.screenshot({ path: `${SHOTS}/placement-admin.png` });
      await page.locator(".cpw .cp").press("Escape");
      if (await sw.isChecked()) await page.locator("label.a-toggle", { hasText: "Boutons et liens de cette page" }).click();
    } else ok("L3 réglage « Boutons et liens de cette page » introuvable", false);
  }
  // 4. Téléphone : dans la fenêtre, compact.
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`${BASE}/admin/themes/galerie-lumineuse`, { waitUntil: "networkidle" });
  {
    const role = page.locator('.a-da .lc-role-item[data-role="ink"] .lc-role');
    await role.click();
    await page.locator('.a-da .lc-role-item[data-role="ink"] .cp').waitFor();
    await sleep(300);
    const m = await rects(page, '.a-da .lc-role-item[data-role="ink"] .lc-role');
    ok("L4 téléphone (390 px) : le sélecteur ne déborde pas de la fenêtre", inside(m) && m.cp.r <= m.w + 1, JSON.stringify(m));
    await page.screenshot({ path: `${SHOTS}/placement-telephone.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

await browser.close();
console.log(failures === 0 ? "\nTOUT PASSE" : `\n${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);
