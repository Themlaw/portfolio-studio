#!/usr/bin/env node
/**
 * Fond d'un texte, pour tous les textes (lot 21), UN chromium. Serveur dev requis, base NEUVE (seed), une connexion.
 *
 *  A. La ligne « Fond : Aucun / Ombre douce / Bandeau / Surlignage » est dans la barre de TOUS les textes : étiquette,
 *     titres, paragraphe, légende (métier de l'ouverture), « Faire défiler », nom du site (ouverture et en-tête), menu,
 *     pied de page — « Ce texte » comme « Tous les X » (un seul composant, une seule définition).
 *  B. Bandeau + couleur de la DA, puis teinte douce, puis couleur libre : pastille unique (« Auto » par défaut, absente
 *     sans fond), rendu de la toile, brouillon, rendu PUBLIC (couleur calculée).
 *  C. « Tous les X » : le fond et sa couleur valent pour tous les textes du rôle (toile et public).
 *  D. Lisibilité : texte rendu lisible tout seul sur un fond foncé ; une couleur de texte CHOISIE n'est pas écrasée
 *     (style local, ou style du rôle) et déclenche la pastille « ! ».
 *  E. Annuler / Rétablir, persistance après rechargement, « Revenir au style global ».
 *  F. Fond du métier réglé avant le lot (look.roleBackdrop) : montré, rendu comme avant, migré à la première modification.
 *
 * Captures 1440 px : $SHOTS (défaut screenshots/fond-texte).
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… [BASE=http://localhost:3290] [SHOTS=…] [ONLY=A,B] node scripts/e2e-fond-texte.mjs
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
const SHOTS = process.env.SHOTS ?? "screenshots/fond-texte";
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
const setting = (key) => JSON.parse(q("select value from settings where key = ?", key)[0]?.value ?? "null");
const heroLook = () => draftOf(1)?.blocks?.find((b) => b.type === "hero")?.props.look;
const siteRoles = () => setting("siteDraft")?.snap?.styles?.roles ?? {};
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

/* ---- Couleurs ------------------------------------------------------------------------------------ */
const same = (a, b, tol = 3) => Boolean(a && b) && a.slice(0, 3).every((v, i) => Math.abs(v - b[i]) <= tol);
const lum = ([r, g, b]) => {
  const f = (v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
/** Teinte douce attendue : p % de la couleur mélangés au fond de page, en Oklab (comme les cartes, src/themes/palette.ts). */
const toLin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLin = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const toLab = ([r, g, b]) => {
  const [lr, lg, lb] = [toLin(r), toLin(g), toLin(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};
const fromLab = ([L, a, b]) => {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map((v) => Math.max(0, Math.min(255, fromLin(v))));
};
const tint = (base, ground, p) => {
  const [a, b] = [toLab(ground), toLab(base)];
  return fromLab(a.map((v, i) => v + (b[i] - v) * p));
};

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
async function openEditor(id = 1) {
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
/** Valeur d'une couleur CSS (variables du thème comprises) en [r, g, b, a], dans le document du cadre. */
const rgbaIn = (fr, css) =>
  fr.evaluate((c) => {
    const probe = document.createElement("span");
    probe.style.color = c;
    document.body.appendChild(probe);
    const v = getComputedStyle(probe).color;
    probe.remove();
    const cv = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    cv.clearRect(0, 0, 1, 1);
    cv.fillStyle = v;
    cv.fillRect(0, 0, 1, 1);
    return [...cv.getImageData(0, 0, 1, 1).data];
  }, css);
/** Couleur calculée d'un élément (propriété), en [r, g, b, a]. */
const styleRgba = (fr, sel, prop, nth = 0) =>
  fr.evaluate(
    ({ sel, prop, nth }) => {
      const el = document.querySelectorAll(sel)[nth];
      if (!el) return null;
      const v = getComputedStyle(el)[prop];
      const cv = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
      cv.clearRect(0, 0, 1, 1);
      cv.fillStyle = v;
      cv.fillRect(0, 0, 1, 1);
      return [...cv.getImageData(0, 0, 1, 1).data];
    },
    { sel, prop, nth },
  );
const bgOf = (fr, sel, nth = 0) => styleRgba(fr, sel, "backgroundColor", nth);
const inkOf = (fr, sel, nth = 0) => styleRgba(fr, sel, "color", nth);

/** Ouvre la barre typographique d'un texte (« Aa » au survol). */
async function openBar(f, sel, nth = 0) {
  if (await f.locator(".lk-bar").count()) {
    await f.locator(".lk-bar .lk-close").click().catch(() => {});
    await f.locator(".lk-bar").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  }
  const target = f.locator(sel).nth(nth);
  await target.scrollIntoViewIfNeeded();
  for (let essai = 0; essai < 4; essai++) {
    // Le curseur sort d'abord de la toile : un texte redessiné sous un curseur immobile ne reçoit aucun survol.
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
const scopeButton = (f, name) => f.locator(".lk-bar [role=radio]", { hasText: name }).first();
const radios = (f) => f.locator('.lk-bar .tc-bd [role="radio"]');
const pick = async (f, label) => {
  await f.locator('.lk-bar .tc-bd [role="radio"]', { hasText: label }).click();
  await settled();
};
const dot = (f) => f.locator(".lk-bar .tc-bd-dot");
const openDot = async (f) => {
  if (!(await f.locator(".bd-pop").count())) await dot(f).click();
  await f.locator(".bd-pop").waitFor({ timeout: 10000 });
};
const popToken = (f, t) => f.locator(`.bd-pop [data-token="${t}"]`).first();
const undo = page.locator('button.a-icon-btn[aria-label="Annuler"]');
const redo = page.locator('button.a-icon-btn[aria-label="Rétablir"]');

const EYEBROW = '[data-edit-type="hero"] [data-inline="eyebrow"]';
const SCROLL = '[data-inline="scroll"]';
const NAME = '[data-edit-type="hero"] h1[data-site-inline="name"]';
const ROLE = '[data-hero-text="role"]';
const H2 = 'h2[data-inline="title"]';
const INTRO = 'p[data-inline="intro"]';
const BRAND = ".site-header .site-brand-text";
const MENU = '.site-header nav span[data-site-inline="nav"]';
const FOOT = 'footer [data-site-inline="role"]';
const EYEBROWS = '[data-inline="eyebrow"]';

let f = await openEditor(1);
await sleep(1500);
// Couleurs du thème, telles que la toile les montre.
const P = {};
for (const k of ["bg", "ink", "primary", "secondary", "tertiary", "on-primary"]) P[k] = await rgbaIn(f, `var(--t-color-${k})`);

/* ---- A. La ligne « Fond » est partout ---------------------------------------------------------------- */

if (run("A")) {
  const cases = [
    ["Étiquette (ouverture)", EYEBROW, 0, true, "Étiquette"],
    ["Titre 1 / nom (ouverture)", NAME, 0, true, "Titre 1"],
    ["Titre 2", H2, 0, true, "Titre 2"],
    ["Paragraphe", INTRO, 0, true, "Texte"],
    ["Légende (métier)", ROLE, 0, true, "Légende"],
    ["Faire défiler (ouverture)", SCROLL, 0, true, "Étiquette"],
    ["Nom du site (en-tête)", BRAND, 0, false, "Nom du site"],
    ["Menu", MENU, 0, false, "Menu"],
    ["Pied de page", FOOT, 0, false, "Légende"],
  ];
  for (const [label, sel, nth, hasLocal, roleName] of cases) {
    const opened = await openBar(f, sel, nth);
    if (!opened) {
      ok(`A ${label} : barre ouverte`, false, `${await f.locator(sel).count()} élément(s)`);
      continue;
    }
    const n = await radios(f).count();
    const disabled = await f.locator('.lk-bar .tc-bd [role="radio"]:disabled').count();
    ok(`A ${label} : « Fond » Aucun / Ombre douce / Bandeau / Surlignage`, n === 4 && disabled === 0, `${n} choix, ${disabled} désactivé(s)`);
    ok(`A ${label} : pas de pastille de couleur sans fond choisi`, (await dot(f).count()) === 0);
    if (hasLocal) {
      ok(`A ${label} : « Ce texte » proposé`, (await scopeButton(f, "Ce texte").count()) === 1);
      await scopeButton(f, "Ce texte").click();
      ok(`A ${label} : la ligne est là pour « Ce texte »`, (await radios(f).count()) === 4);
    }
    await scopeButton(f, "Tous les").click();
    ok(`A ${label} : la ligne est là pour « Tous les « ${roleName} » »`, (await radios(f).count()) === 4 && (await f.locator(".lk-bar .lk-seg [aria-checked=true]").innerText()).includes(roleName), await f.locator(".lk-bar .lk-seg").innerText());
  }
  // Un seul composant : une seule ligne par barre, mêmes libellés.
  await openBar(f, EYEBROW);
  ok("A une seule ligne « Fond » par barre", (await f.locator(".lk-bar .tc-bd").count()) === 1 && (await f.locator('.lk-bar [aria-label="Fond du texte"]').count()) === 1);
  await f.locator(".lk-bar .lk-close").click();
}

/* ---- B. Bandeau + couleur de la DA, teinte douce, couleur libre ---------------------------------------------- */

const pub = await ctx.newPage();
pub.setDefaultTimeout(60000);
const publicRgba = async (selFn, prop = "backgroundColor") => {
  await pub.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  return pub.evaluate(
    ({ fn, prop }) => {
      const el = new Function(`return (${fn})()`)();
      if (!el) return null;
      const v = getComputedStyle(el)[prop];
      const cv = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
      cv.clearRect(0, 0, 1, 1);
      cv.fillStyle = v;
      cv.fillRect(0, 0, 1, 1);
      return [...cv.getImageData(0, 0, 1, 1).data];
    },
    { fn: selFn, prop },
  );
};
const pubEyebrow = `() => [...document.querySelectorAll("p.eyebrow")].find((e) => e.textContent.includes("Portfolio"))`;

if (run("B")) {
  f = await openEditor(1);
  await sleep(1200);
  ok("B0 barre de l'étiquette", await openBar(f, EYEBROW));
  await scopeButton(f, "Ce texte").click();
  await pick(f, "Bandeau");
  ok("B1 après « Bandeau » : la pastille unique apparaît, « Auto » par défaut", (await f.locator(".lk-bar .tc-bd-dot").waitFor({ timeout: 10000 }).then(() => true, () => false)) && (await dot(f).count()) === 1 && /Auto/.test((await dot(f).getAttribute("aria-label")) ?? ""), (await dot(f).getAttribute("aria-label")) ?? "");
  const autoBg = await bgOf(f, EYEBROW);
  ok("B2 « Auto » : le fond du thème (fond de page à 86 %), rendu d'avant", autoBg && autoBg[3] > 200 && autoBg[3] < 230 && same(autoBg, P.bg, 3), JSON.stringify(autoBg));
  ok("B3 brouillon : backdrop = band, pas de couleur", await waitFor(() => heroLook()?.text?.eyebrow?.backdrop === "band" && heroLook().text.eyebrow.backdropColor === undefined), JSON.stringify(heroLook()));
  await page.screenshot({ path: path.join(SHOTS, "b-barre-etiquette-fond.png") });

  // Couleur de la DA.
  await openDot(f);
  ok("B4 popover compact : Auto, couleurs de la DA, teintes douces, « Autre couleur… »", (await f.locator(".bd-pop .bd-auto").count()) === 1 && (await f.locator('.bd-pop [data-testid="card-da-color"]').count()) >= 6 && (await f.locator('.bd-pop [data-testid="card-tint"]').count()) === 8 && /Autre couleur/.test(await f.locator(".bd-pop").innerText()));
  await page.screenshot({ path: path.join(SHOTS, "b-pastille-ouverte.png") });
  await popToken(f, "secondary").click();
  await settled();
  ok("B5 DA « Accent » : brouillon en jeton (suit la palette)", await waitFor(() => heroLook()?.text?.eyebrow?.backdropColor === "secondary"), JSON.stringify(heroLook()));
  ok("B6 toile : fond = couleur « secondary » du thème", await until(f, () => true) && same(await bgOf(f, EYEBROW), P.secondary), JSON.stringify(await bgOf(f, EYEBROW)));
  const chipColor = () => dot(f).evaluate((e) => getComputedStyle(e).backgroundColor).then((c) => rgbaIn(f, c));
  ok("B7 la pastille montre la couleur choisie", await waitFor(async () => same(await chipColor(), P.secondary)), `${JSON.stringify(await chipColor())} attendu ${P.secondary}`);
  await f.locator(".lk-bar .lk-close").click();
  ok("B8 publication", await publish());
  const pubBg = await publicRgba(pubEyebrow);
  ok("B9 PUBLIC : bandeau de la couleur de la DA (couleur calculée)", same(pubBg, P.secondary), JSON.stringify(pubBg));
  const pubBox = await pub.evaluate((fn) => { const e = new Function(`return (${fn})()`)(); const cs = getComputedStyle(e); return { display: cs.display, pad: cs.paddingLeft }; }, pubEyebrow);
  ok("B10 PUBLIC : boîte en ligne avec marge (bandeau)", pubBox.display === "inline-block" && parseFloat(pubBox.pad) > 5, JSON.stringify(pubBox));
  await pub.screenshot({ path: path.join(SHOTS, "b-public-bandeau.png") });

  // Teinte douce du lot 19b.
  f = await openEditor(1);
  await sleep(1200);
  await openBar(f, EYEBROW);
  await scopeButton(f, "Ce texte").click();
  ok("B11 rechargé : « Bandeau » coché, pastille présente", (await f.locator('.lk-bar .tc-bd [aria-checked="true"]').innerText()) === "Bandeau" && (await dot(f).count()) === 1);
  await openDot(f);
  await popToken(f, "primary12").click();
  await settled();
  ok("B12 teinte « primary12 » : brouillon", await waitFor(() => heroLook()?.text?.eyebrow?.backdropColor === "primary12"), JSON.stringify(heroLook()));
  const t = tint(P.primary, P.bg, 0.12);
  const tintBg = await bgOf(f, EYEBROW);
  ok("B13 toile : fond = 12 % de la couleur principale sur le fond de page", same(tintBg, t, 4), `${JSON.stringify(tintBg)} attendu ${t.map(Math.round)}`);

  // Couleur libre.
  await popToken(f, "primary12").waitFor();
  await f.locator('.bd-pop').getByRole("button", { name: "Couleur personnalisée" }).click();
  const hex = f.locator('.cp input[aria-label="Valeur hexadécimale"]');
  await hex.waitFor({ timeout: 20000 });
  await hex.fill("#f6d6e4");
  await hex.press("Enter");
  ok("B14 couleur libre #f6d6e4 : brouillon", await waitFor(() => heroLook()?.text?.eyebrow?.backdropColor === "#f6d6e4"), JSON.stringify(heroLook()));
  ok("B15 toile : fond = #f6d6e4", await until(f, () => true) && same(await bgOf(f, EYEBROW), hexRgb("#f6d6e4"), 2), JSON.stringify(await bgOf(f, EYEBROW)));
  await page.keyboard.press("Escape");
  await f.locator(".lk-bar .lk-close").click().catch(() => {});
  ok("B16 publication", await publish());
  const pubBg2 = await publicRgba(pubEyebrow);
  ok("B17 PUBLIC : couleur libre", same(pubBg2, hexRgb("#f6d6e4"), 2), JSON.stringify(pubBg2));
  await pub.screenshot({ path: path.join(SHOTS, "b-public-couleur-libre.png") });
}

/* ---- C. « Tous les X » ------------------------------------------------------------------------------------------ */

if (run("C")) {
  f = await openEditor(1);
  await sleep(1200);
  // Tous les « Légende » : le style du rôle (le métier de l'ouverture est une légende ; le menu, lui, a son rôle).
  await openBar(f, ROLE);
  await scopeButton(f, "Tous les").click();
  await pick(f, "Surlignage");
  await openDot(f);
  await popToken(f, "tertiary").click();
  await settled();
  ok("C1 style du site : roles.caption = surlignage + jeton", await waitFor(() => siteRoles().caption?.backdrop === "highlight" && siteRoles().caption?.backdropColor === "tertiary"), JSON.stringify(siteRoles()));
  // Hors métier (qui a son propre style local éventuel) : toutes les légendes de la page.
  const legendes = await f.evaluate(() => [...document.querySelectorAll(".caption-text, figcaption, .strip-caption")].filter((e) => !e.closest(".site-header")).length);
  const colored = await f.evaluate(
    () => {
      const els = [...document.querySelectorAll(".caption-text, figcaption, .strip-caption")].filter((e) => !e.closest(".site-header"));
      return els.filter((e) => getComputedStyle(e).backgroundColor !== "rgba(0, 0, 0, 0)").length;
    },
    null,
  );
  ok("C2 toile : tous les textes du rôle « Légende » ont le fond", legendes > 0 && colored === legendes, `${colored}/${legendes}`);
  ok("C3 toile : de la couleur tertiaire", same(await bgOf(f, ROLE), P.tertiary));
  await f.locator(".lk-bar .lk-close").click();
  ok("C4 publication", await publish());
  await pub.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  const pubInfo = await pub.evaluate(() => {
    const els = [...document.querySelectorAll(".caption-text, figcaption, .strip-caption")].filter((e) => !e.closest(".site-header"));
    return { n: els.length, colored: els.filter((e) => getComputedStyle(e).backgroundColor !== "rgba(0, 0, 0, 0)").length };
  });
  ok("C5 PUBLIC : tous les textes du rôle ont le fond", pubInfo.n > 0 && pubInfo.n === pubInfo.colored, JSON.stringify(pubInfo));
  const pubCap = await pub.evaluate(() => { const e = document.querySelector("[data-hero-text=role]"); const cv = document.createElement("canvas").getContext("2d", { willReadFrequently: true }); cv.fillStyle = getComputedStyle(e).backgroundColor; cv.fillRect(0, 0, 1, 1); return [...cv.getImageData(0, 0, 1, 1).data]; });
  ok("C6 PUBLIC : couleur « Ornements » du thème", same(pubCap, P.tertiary), JSON.stringify(pubCap));
  // Étiquettes du pied : un autre rôle, un autre fond, sans toucher aux légendes.
  await openBar(f, EYEBROWS, 1);
  await scopeButton(f, "Tous les").click();
  await pick(f, "Ombre douce");
  await openDot(f);
  await popToken(f, "secondary").click();
  await settled();
  const foot = await f.evaluate((s) => getComputedStyle(document.querySelectorAll(s)[2]).textShadow, EYEBROWS);
  ok("C7 « Ombre douce » colorée : halo de la couleur choisie (la pastille s'applique)", await waitFor(() => siteRoles().eyebrow?.backdrop === "shadow" && siteRoles().eyebrow?.backdropColor === "secondary") && foot !== "none" && foot.includes("rgb"), foot.slice(0, 120));
  await page.screenshot({ path: path.join(SHOTS, "c-tous-les-textes.png") });
  // Retour au thème des deux rôles (la suite mesure le rendu d'avant).
  await f.locator(".lk-bar .tc-reset").click();
  await settled();
  await f.locator(".lk-bar .lk-close").click();
  await openBar(f, ROLE);
  await scopeButton(f, "Tous les").click();
  await f.locator(".lk-bar .tc-reset").click();
  await settled();
  await f.locator(".lk-bar .lk-close").click();
  ok("C8 « Revenir au thème » : les deux rôles redeviennent ceux du thème", await waitFor(() => !siteRoles().caption && !siteRoles().eyebrow), JSON.stringify(siteRoles()));
  ok("C9 publication (le site public revient au thème)", await publish());
  await pub.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  ok("C10 PUBLIC : plus de fond sur les légendes", await pub.evaluate(() => [...document.querySelectorAll(".caption-text")].filter((e) => !e.closest(".site-header")).every((e) => getComputedStyle(e).backgroundColor === "rgba(0, 0, 0, 0)")));
}

/* ---- D. Lisibilité ------------------------------------------------------------------------------------------------- */

if (run("D")) {
  f = await openEditor(1);
  await sleep(1200);
  await openBar(f, SCROLL);
  await scopeButton(f, "Ce texte").click();
  await pick(f, "Surlignage");
  await openDot(f);
  await popToken(f, "ink").click();
  await settled();
  const bg = await bgOf(f, SCROLL);
  const fg = await inkOf(f, SCROLL);
  ok("D1 fond foncé (« Texte » du thème) : le texte devient lisible tout seul (≥ 4,5:1)", same(bg, P.ink) && ratio(fg, bg) >= 4.5, `fond ${bg} texte ${fg} ${ratio(fg, bg).toFixed(2)}`);
  ok("D2 aucune alerte : le texte n'a pas de couleur choisie", (await f.locator('[data-testid="bd-alert"]').count()) === 0);
  await popToken(f, "bg").click();
  await settled();
  const fg2 = await inkOf(f, SCROLL);
  ok("D3 fond clair : le texte repasse sombre (lisible)", ratio(fg2, await bgOf(f, SCROLL)) >= 4.5 && lum(fg2) < lum(await bgOf(f, SCROLL)), `texte ${fg2}`);
  // Couleur de texte choisie : conservée, alerte.
  await popToken(f, "ink").click();
  await settled();
  await f.locator('.lk-bar .tc-swatches [aria-label="Encre"]').click();
  await settled();
  ok("D4 couleur de texte choisie (Encre) sur fond Encre : conservée, pas écrasée", await until(f, () => true) && same(await inkOf(f, SCROLL), P.ink), JSON.stringify(await inkOf(f, SCROLL)));
  ok("D5 pastille « ! » d'alerte de contraste", await f.locator('[data-testid="bd-alert"]').waitFor({ timeout: 10000 }).then(() => true, () => false));
  await page.screenshot({ path: path.join(SHOTS, "d-alerte-contraste.png") });
  ok("D6 l'enregistrement n'est pas bloqué", await waitFor(() => heroLook()?.text?.scroll?.color === "ink" && heroLook().text.scroll.backdropColor === "ink"), JSON.stringify(heroLook()));
  // Fond lisible : l'alerte disparaît.
  await openDot(f);
  await popToken(f, "bg").click();
  await settled();
  ok("D7 fond clair + texte Encre : plus d'alerte", await f.locator('[data-testid="bd-alert"]').waitFor({ state: "detached", timeout: 10000 }).then(() => true, () => false));
  // Couleur du texte choisie dans le style du RÔLE : un fond local ne l'écrase pas non plus.
  await scopeButton(f, "Tous les").click();
  await f.locator('.lk-bar .tc-swatches [aria-label="Principale"]').click();
  await settled();
  await scopeButton(f, "Ce texte").click();
  await f.locator('.lk-bar .tc-swatches [aria-label="Encre"]').click();
  await settled(); // retire la couleur locale (re-clic = retour au style global)
  await openDot(f).catch(() => {});
  await popToken(f, "ink").click();
  await settled();
  const fg3 = await inkOf(f, SCROLL);
  ok("D8 couleur choisie dans le style du site : conservée sous un fond local", same(fg3, P.primary), `${JSON.stringify(fg3)} attendu ${P.primary}`);
  const wantAlert = ratio(P.primary, P.ink) < 4.5 ? 1 : 0;
  ok("D9 … et l'alerte le signale (Principale sur Encre)", await waitFor(async () => (await f.locator('[data-testid="bd-alert"]').count()) === wantAlert, 10000), `${await f.locator('[data-testid="bd-alert"]').count()} alerte(s), contraste ${ratio(P.primary, P.ink).toFixed(2)}`);
  // Nettoyage : retour au thème pour ce texte et ce rôle.
  await f.locator(".lk-bar .tc-reset").click();
  await settled();
  await scopeButton(f, "Tous les").click();
  await f.locator(".lk-bar .tc-reset").click();
  await settled();
  await f.locator(".lk-bar .lk-close").click();
}

/* ---- E. Annuler / Rétablir, persistance ---------------------------------------------------------------------------------------- */

if (run("E")) {
  f = await openEditor(1);
  await sleep(1200);
  await openBar(f, NAME);
  await scopeButton(f, "Ce texte").click();
  const s0 = JSON.stringify(heroLook()?.text?.["site.name"] ?? null);
  await pick(f, "Surlignage");
  await openDot(f);
  await popToken(f, "secondary25").click();
  await settled();
  const full = { backdrop: "highlight", backdropColor: "secondary25" };
  const now = () => heroLook()?.text?.["site.name"];
  ok("E1 deux réglages enregistrés", await waitFor(() => JSON.stringify(now()) === JSON.stringify(full)), JSON.stringify(now()));
  await page.keyboard.press("Escape");
  await f.locator(".lk-bar .lk-close").click().catch(() => {});
  const revOf = () => f.evaluate(() => document.querySelector("[data-edit-rev]")?.dataset.editRev);
  // La toile se redessine quelques secondes après un enregistrement : on laisse l'utilisatrice la voir à jour avant d'annuler.
  const caughtUp = () => revOf().then((r) => Number(r) >= q("select draft_rev from pages where id = 1")[0].draft_rev);
  ok("E1b la toile a rattrapé l'enregistrement", await waitFor(caughtUp, 30000));
  await undo.click();
  ok("E2 Annuler : la couleur est défaite, le surlignage reste", await waitFor(() => JSON.stringify(now()) === JSON.stringify({ backdrop: "highlight" })), JSON.stringify(now()));
  ok("E3 toile : couleur Auto (couleur principale du thème)", await waitFor(async () => same(await bgOf(f, NAME), P.primary)), JSON.stringify(await bgOf(f, NAME)) + " " + (await f.locator(NAME).getAttribute("style")));
  ok("E3b la toile a rattrapé l'annulation", await waitFor(caughtUp, 30000));
  await undo.click();
  ok("E4 Annuler (2e pas) : l'état d'avant", await waitFor(() => JSON.stringify(heroLook()?.text?.["site.name"] ?? null) === s0), JSON.stringify(now()));
  await redo.click();
  await redo.click();
  await waitFor(caughtUp, 30000);
  ok("E5 Rétablir ×2 : les deux réglages reviennent", await waitFor(() => JSON.stringify(now()) === JSON.stringify(full)), JSON.stringify(now()));
  await settled();
  // Persistance : rechargement SANS abandonner le brouillon.
  await page.reload({ waitUntil: "domcontentloaded" });
  f = await canvas();
  await sleep(1500);
  await openBar(f, NAME);
  await scopeButton(f, "Ce texte").click();
  ok("E6 après rechargement : « Surlignage » coché et pastille présente", (await f.locator('.lk-bar .tc-bd [aria-checked="true"]').innerText()) === "Surlignage" && (await dot(f).count()) === 1);
  const tintBg = await bgOf(f, NAME);
  ok("E7 après rechargement : teinte douce « Accent 25 % » rendue", same(tintBg, tint(P.secondary, P.bg, 0.25), 4), `${JSON.stringify(tintBg)}`);
  // Revenir au style global : fond et couleur partent avec le reste.
  await f.locator(".lk-bar .tc-reset").click();
  await settled();
  ok("E8 « Revenir au style global » : plus de fond ni de couleur", await waitFor(() => heroLook()?.text?.["site.name"] === undefined) && (await bgOf(f, NAME))[3] === 0, JSON.stringify(heroLook()));
  await f.locator(".lk-bar .lk-close").click();
}

/* ---- F. Réglage d'avant le lot (look.roleBackdrop) ---------------------------------------------------------------------------------------- */

if (run("F")) {
  f = await openEditor(1);
  await sleep(1200);
  // Un brouillon existe dès la première modification : on y pose le réglage comme avant le lot (bandeau sur le métier, nulle part ailleurs).
  await openBar(f, ROLE);
  await scopeButton(f, "Ce texte").click();
  await pick(f, "Ombre douce");
  await waitFor(() => draftOf(1) !== null);
  await f.locator(".lk-bar .lk-close").click();
  const draft = draftOf(1);
  const hero = draft.blocks.find((b) => b.type === "hero");
  hero.props.look = { roleBackdrop: "band" };
  exec("update pages set draft = ?, draft_rev = draft_rev + 1 where id = 1", JSON.stringify(draft));
  await page.goto(`${BASE}/admin/pages/1/editer`, { waitUntil: "domcontentloaded" });
  f = await canvas();
  await sleep(1500);
  const before = await bgOf(f, ROLE);
  ok("F1 réglage d'avant : rendu comme avant (bandeau du thème)", before && before[3] > 200 && same(before, P.bg, 3), JSON.stringify(before));
  await openBar(f, ROLE);
  await scopeButton(f, "Ce texte").click();
  ok("F2 la barre montre ce fond (« Bandeau » coché)", (await f.locator('.lk-bar .tc-bd [aria-checked="true"]').innerText()) === "Bandeau");
  await openDot(f);
  await popToken(f, "primary25").click();
  await settled();
  ok("F3 modifié : migré dans le style du texte, ancien champ retiré", await waitFor(() => heroLook()?.text?.["site.role"]?.backdrop === "band" && heroLook().text["site.role"].backdropColor === "primary25" && heroLook().roleBackdrop === undefined), JSON.stringify(heroLook()));
  ok("F4 rendu : la couleur choisie", same(await bgOf(f, ROLE), tint(P.primary, P.bg, 0.25), 4), JSON.stringify(await bgOf(f, ROLE)));
  // Le bloc perd son enveloppe (plus de réglage d'avant) et la toile se redessine : la barre se referme, on la rouvre une fois la toile à jour.
  await waitFor(async () => Number(await f.evaluate(() => document.querySelector("[data-edit-rev]")?.dataset.editRev)) >= q("select draft_rev from pages where id = 1")[0].draft_rev, 30000);
  await f.locator(".lk-bar").waitFor({ state: "detached", timeout: 15000 }).catch(() => {});
  ok("F4b la barre sans cible se referme (elle ne bloque pas le « Aa » des autres textes)", (await f.locator(".lk-bar").count()) === 0);
  await openBar(f, ROLE);
  await scopeButton(f, "Ce texte").click();
  await f.locator(".lk-bar .tc-reset").click();
  await settled();
  ok("F5 « Revenir au style global » : l'ancien fond part aussi", await waitFor(() => heroLook()?.roleBackdrop === undefined && heroLook()?.text?.["site.role"] === undefined), JSON.stringify(heroLook()));
  await f.locator(".lk-bar .lk-close").click();
}

ok("aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
if (failures) {
  console.error(`e2e-fond-texte : ÉCHEC (${failures})`);
  process.exit(1);
}
console.log("e2e-fond-texte : OK");
