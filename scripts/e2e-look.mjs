#!/usr/bin/env node
/**
 * Mise en page sur la toile (lot 2), UN chromium sobre. Serveur dev requis,
 * base NEUVE (seed), une connexion, accès réseau du SERVEUR à Google Fonts.
 *
 *  A. Poignées d'espacement : glisser (aimanté aux crans), clavier ; rendu.
 *  B. Barre typographique : taille de CE texte ; italique de tous les « Titre 1 »
 *     (styles du site).
 *  C. Police Google choisie dans le menu : téléchargée par le SERVEUR, servie
 *     par /fonts/, appliquée ; AUCUNE requête du navigateur vers Google.
 *  D. Cadrage du portrait (format imposé) : zone déplacée et zoomée au clavier.
 *  E. Ouverture : fond du métier (bandeau) depuis la barre du texte.
 *  F. Publication : rendu public (espaces, styles, police servie localement,
 *     cadrage), aucun repère d'édition.
 *
 * Usage : DATA_DIR=/root/pf-lot2 ADMIN_EMAIL=… ADMIN_PASSWORD=… BASE=http://localhost:3102 \
 *         SHOTS=/root/shots-lot2 node scripts/e2e-look.mjs
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const DATA = process.env.DATA_DIR ?? "data";
const DB = path.join(DATA, "portfolio.db");
const SHOTS = process.env.SHOTS ?? "screenshots/look";
const ONLY = process.env.ONLY ?? "";
const FONT = process.env.FONT ?? "Lora";
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
const draftOf = (id) => JSON.parse(q("select draft from pages where id = ?", id)[0]?.draft ?? "null");
const setting = (key) => JSON.parse(q("select value from settings where key = ?", key)[0]?.value ?? "null");
const blockOf = (id, type) => draftOf(id)?.blocks?.find((b) => b.type === type);
const run = (k) => !ONLY || ONLY.split(",").includes(k);

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
// Toute requête du navigateur (éditeur, toile, pages publiques) vers Google est une faute.
const googleRequests = [];
const fontRequests = [];
ctx.on("request", (r) => {
  const u = r.url();
  if (/fonts\.(googleapis|gstatic)\.com|google/i.test(new URL(u).hostname)) googleRequests.push(u);
  if (new URL(u).pathname.startsWith("/fonts/")) fontRequests.push(u);
});
const page = await ctx.newPage();
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
const until = (f, fn, arg, timeout = 60000) =>
  f.waitForFunction(fn, arg, { timeout, polling: 200 }).then(
    () => true,
    () => false,
  );
async function waitFor(fn, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(300);
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
/** Valeur en px d'un cran du thème, mesurée dans la toile. */
const cranPx = (f, key) =>
  f.evaluate((k) => {
    const p = document.createElement("div");
    p.style.paddingTop = k === "none" ? "0px" : `var(--t-space-${k})`;
    document.body.appendChild(p);
    const v = parseFloat(getComputedStyle(p).paddingTop);
    p.remove();
    return v;
  }, key);
const introPad = (f) => f.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-edit-type="collection-intro"] section')).paddingTop));

let f;

/* ---- A. Poignées d'espacement ---------------------------------------------------- */

if (run("A") || run("B") || run("C") || run("F")) {
  f = await openEditor(2);
  await sleep(1200);
}

if (run("A")) {
  const before = await introPad(f);
  await f.locator('[data-edit-type="collection-intro"] h1').first().click();
  ok("A1 bloc choisi : poignées d'espacement haut et bas", await until(f, () => document.querySelectorAll(".lk-space-handle").length === 2));
  const handle = f.locator('.lk-space-handle[data-side="top"]');
  const hb = await handle.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2, hb.y - 30, { steps: 6 });
  await page.mouse.move(hb.x + hb.width / 2, hb.y - 400, { steps: 12 });
  await sleep(300);
  const label = await f.locator('.lk-space-zone[data-side="top"] .lk-space-value').textContent().catch(() => "");
  ok("A2 pendant le glisser : valeur aimantée affichée (« Aucun »)", /Aucun/.test(label ?? ""), label);
  await page.screenshot({ path: `${SHOTS}/A-poignee-espacement-glisser.png` });
  await page.mouse.up();
  await settled();
  ok("A3 relâché : espace haut « Aucun » enregistré dans le brouillon", await waitFor(() => blockOf(2, "collection-intro")?.props.look?.spaceTop === "none"), JSON.stringify(blockOf(2, "collection-intro")?.props.look));
  ok("A4 rendu : padding haut à 0 (avant : " + Math.round(before) + " px)", await until(f, () => parseFloat(getComputedStyle(document.querySelector('[data-edit-type="collection-intro"] section')).paddingTop) === 0));
  // Clavier : flèche bas = cran suivant.
  await f.locator('[data-edit-type="collection-intro"] h1').first().click();
  await until(f, () => document.querySelectorAll(".lk-space-handle").length === 2);
  await f.locator('.lk-space-handle[data-side="top"]').focus();
  await page.keyboard.press("ArrowDown");
  await settled();
  await waitFor(() => blockOf(2, "collection-intro")?.props.look?.spaceTop === "s");
  const kb = blockOf(2, "collection-intro")?.props.look?.spaceTop;
  ok("A5 clavier (flèche bas) : cran suivant « S »", kb === "s", String(kb));
  const s = await cranPx(f, "s");
  ok(`A6 rendu : padding haut = cran S du thème (${s} px)`, await until(f, (v) => Math.abs(parseFloat(getComputedStyle(document.querySelector('[data-edit-type="collection-intro"] section')).paddingTop) - v) < 0.5, s));
  await f.locator('[data-edit-type="collection-intro"] h1').first().click();
  await sleep(400);
  await page.screenshot({ path: `${SHOTS}/A-poignees-espacement.png` });
}

/* ---- B. Barre typographique ---------------------------------------------------------- */

const h1 = '[data-edit-type="collection-intro"] h1[data-inline="title"]';
if (run("B")) {
  await f.locator(h1).hover();
  ok("B1 survol d'un titre : « Aa »", await until(f, () => Boolean(document.querySelector(".lk-aa"))));
  await f.locator(".lk-aa").click();
  ok("B2 barre typographique ouverte", await until(f, () => Boolean(document.querySelector(".lk-bar"))));
  await page.screenshot({ path: `${SHOTS}/B-barre-typo.png` });
  await f.locator(".lk-bar select").first().selectOption("4xl");
  await settled();
  ok("B3 taille de CE texte enregistrée (look.text.title)", await waitFor(() => blockOf(2, "collection-intro")?.props.look?.text?.title?.size === "4xl"), JSON.stringify(blockOf(2, "collection-intro")?.props.look));
  ok("B4 rendu : taille en ligne sur le titre", await until(f, (s) => (document.querySelector(s)?.getAttribute("style") ?? "").includes("clamp(2.5rem"), h1));
  // Tous les « Titre 1 » : style du site.
  if (!(await f.locator(".lk-bar").count())) {
    await f.locator(h1).hover();
    await f.locator(".lk-aa").click();
  }
  await f.locator(".lk-bar [role=radio]", { hasText: "Tous les « Titre 1 »" }).click();
  await f.locator(".lk-bar .tc-italic").click();
  await settled();
  ok("B5 italique de tous les « Titre 1 » : brouillon du site", (await waitFor(() => setting("siteDraft")?.snap?.styles?.roles?.h1?.italic === true, 20000)), JSON.stringify(setting("siteDraft")?.snap?.styles));
  ok("B6 rendu : feuille des styles du site (italique)", await until(f, () => (document.getElementById("site-styles")?.textContent ?? "").includes("#contenu h1{font-style:italic}")));
  ok("B7 le titre est en italique", await until(f, (s) => getComputedStyle(document.querySelector(s)).fontStyle === "italic", h1));
}

/* ---- C. Police Google téléchargée par le serveur ------------------------------------- */

if (run("C")) {
  if (!(await f.locator(".lk-bar").count())) {
    await f.locator(h1).hover();
    await f.locator(".lk-aa").click();
    await until(f, () => Boolean(document.querySelector(".lk-bar")));
  }
  await f.locator(".lk-bar [role=radio]", { hasText: "Ce texte" }).click();
  await f.locator(".lk-bar .tc-font").click();
  ok("C1 menu des polices ouvert (thème, embarquées, Google)", await until(f, () => document.querySelectorAll(".fm-item").length > 20));
  ok("C2 aperçus chargés depuis le serveur (/admin/api/fonts/preview)", await until(f, () => document.querySelectorAll('.fm-name[style*="pv "]').length >= 3, null, 90000));
  await page.screenshot({ path: `${SHOTS}/C-menu-des-polices.png` });
  await f.locator(".fm-search").fill(FONT);
  await sleep(500);
  await until(f, (n) => Boolean(document.querySelector(`.fm-item[data-font="g:${n}"]`)), FONT);
  await page.screenshot({ path: `${SHOTS}/C-menu-des-polices-recherche.png` });
  await f.locator(`.fm-item[data-font="g:${FONT}"]`).click();
  ok(`C3 « ${FONT} » téléchargée par le serveur (fontLibrary)`, await waitFor(() => Boolean(setting("fontLibrary")?.[FONT]?.length), 90000), JSON.stringify(setting("fontLibrary")));
  await settled();
  const faces = setting("fontLibrary")?.[FONT] ?? [];
  ok("C4 fichiers woff2 latin + latin-ext dans le volume de données", faces.some((x) => x.subset === "latin") && faces.every((x) => existsSync(path.join(DATA, "fonts", x.file))), JSON.stringify(faces));
  ok("C5 police appliquée à CE texte (brouillon)", await waitFor(() => blockOf(2, "collection-intro")?.props.look?.text?.title?.font === `g:${FONT}`));
  ok("C6 @font-face servi par le site (/fonts/…)", await until(f, (n) => { const t = document.getElementById("site-styles")?.textContent ?? ""; return t.includes(`font-family:"${n}"`) && t.includes('url("/fonts/'); }, FONT));
  ok("C7 titre rendu dans la police téléchargée", await until(f, async (args) => { await document.fonts.ready; return getComputedStyle(document.querySelector(args.s)).fontFamily.replace(/"/g, "").startsWith(`${args.n},`) && document.fonts.check(`40px "${args.n}"`); }, { s: h1, n: FONT }, 60000));
  if (faces[0]) {
    const res = await page.request.get(`${BASE}/fonts/${faces[0].file}`);
    ok("C8 /fonts/<fichier> : 200, font/woff2, cache immuable", res.status() === 200 && res.headers()["content-type"] === "font/woff2" && /immutable/.test(res.headers()["cache-control"] ?? ""), `${res.status()} ${res.headers()["content-type"]}`);
  }
  await page.keyboard.press("Escape");
  await f.locator(h1).click();
  await sleep(500);
  await page.screenshot({ path: `${SHOTS}/C-titre-police-google.png` });
}

/* ---- F (1). Publication de la page « Personnages » -------------------------------------- */

if (run("F")) {
  ok("F1 page publiée (styles du site compris)", await publish());
  const pub = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  pub.on("request", (r) => {
    const u = new URL(r.url());
    if (/google/i.test(u.hostname)) googleRequests.push(r.url());
    if (u.pathname.startsWith("/fonts/")) fontRequests.push(r.url());
  });
  const pp = await pub.newPage();
  await pp.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
  const html = await pp.content();
  ok("F2 public : aucun repère d'édition", !html.includes("data-edit-") && !html.includes("data-inline"));
  const r = await pp.evaluate(async (n) => {
    await document.fonts.ready;
    const h = document.querySelector("#contenu h1");
    const sec = h.closest("section");
    const cs = getComputedStyle(h);
    return { family: cs.fontFamily, italic: cs.fontStyle, size: h.getAttribute("style") ?? "", pad: parseFloat(getComputedStyle(sec).paddingTop), loaded: document.fonts.check(`40px "${n}"`) };
  }, FONT);
  const s = await pp.evaluate(() => {
    const p = document.createElement("div");
    p.style.paddingTop = "var(--t-space-s)";
    document.body.appendChild(p);
    return parseFloat(getComputedStyle(p).paddingTop);
  });
  ok(`F3 public : titre en « ${FONT} » (servie par le site), italique, taille réglée`, r.family.replace(/"/g, "").startsWith(`${FONT},`) && r.loaded && r.italic === "italic" && r.size.includes("clamp(2.5rem"), JSON.stringify(r));
  ok("F4 public : espace haut = cran S", Math.abs(r.pad - s) < 0.5, `${r.pad} / ${s}`);
  ok("F5 public : la police vient de /fonts/ (requête vers le site)", fontRequests.length > 0, String(fontRequests.length));
  await pp.screenshot({ path: `${SHOTS}/F-public-personnages.png` });
  await pub.close();
}

/* ---- D. Cadrage du portrait ---------------------------------------------------------------- */

if (run("D")) {
  f = await openEditor(5);
  await sleep(1200);
  await f.locator('[data-edit-type="profile"] [data-edit-media="portraitMediaId"] img').first().click();
  await page.getByRole("tab", { name: "Réglages" }).click();
  await page.getByLabel("Format du portrait").selectOption("1:1");
  await settled();
  ok("D1 format imposé (carré)", blockOf(5, "profile")?.props.portraitRatio === "1:1");
  await until(f, () => { const i = document.querySelector('[data-edit-media="portraitMediaId"] img'); return i && Math.abs(i.clientWidth - i.clientHeight) < 2; });
  await f.locator('[data-edit-media="portraitMediaId"] img').first().hover();
  ok("D2 image hors format : « Cadrer » au survol", await until(f, () => Boolean(document.querySelector(".lk-crop-btn"))));
  await f.locator(".lk-crop-btn").click();
  ok("D3 vue de cadrage : zone gardée claire, reste grisé", await until(f, () => Boolean(document.querySelector(".lk-crop [data-testid=crop-window]"))));
  const w0 = await f.locator("[data-testid=crop-window]").boundingBox();
  for (let i = 0; i < 3; i++) await page.keyboard.press("+");
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowDown");
  await sleep(300);
  // Puis à la souris : la zone se déplace vers la gauche.
  const w1 = await f.locator("[data-testid=crop-window]").boundingBox();
  await page.mouse.move(w1.x + w1.width / 2, w1.y + w1.height / 2);
  await page.mouse.down();
  await page.mouse.move(w1.x + w1.width / 2 - 40, w1.y + w1.height / 2, { steps: 6 });
  await page.mouse.up();
  await sleep(300);
  const w2 = await f.locator("[data-testid=crop-window]").boundingBox();
  ok("D4 zoom (+) : zone plus petite ; flèches et souris : zone déplacée", w1.width < w0.width && w2.x < w1.x, `${JSON.stringify(w0)} ${JSON.stringify(w1)} ${JSON.stringify(w2)}`);
  await page.screenshot({ path: `${SHOTS}/D-cadrage.png` });
  await f.getByRole("button", { name: "Enregistrer le cadrage" }).click();
  await settled();
  await waitFor(() => blockOf(5, "profile")?.props.look?.crop?.portraitMediaId);
  const crop = blockOf(5, "profile")?.props.look?.crop?.portraitMediaId;
  ok("D5 cadrage enregistré par emplacement (point focal + zoom)", crop && crop.zoom > 1.2 && crop.y > 50, JSON.stringify(crop));
  ok(
    "D6 rendu : object-position et zoom sur le portrait",
    await until(f, () => {
      const i = document.querySelector('[data-edit-media="portraitMediaId"] img');
      const cs = getComputedStyle(i);
      return cs.objectFit === "cover" && cs.objectPosition !== "50% 50%" && cs.transform !== "none";
    }),
  );
  await page.screenshot({ path: `${SHOTS}/D-cadrage-applique.png` });
  ok("D7 page publiée", await publish());
  const pub = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pp = await pub.newPage();
  await pp.goto(`${BASE}/fr/a-propos`, { waitUntil: "networkidle" });
  const pos = await pp.evaluate(() => {
    const i = document.querySelector(".profile-portrait img");
    const cs = getComputedStyle(i);
    return { pos: cs.objectPosition, t: cs.transform, ratio: i.clientWidth / i.clientHeight };
  });
  ok("D8 public : portrait carré cadré (object-position + zoom), sans recalcul d'image", pos.pos !== "50% 50%" && pos.t !== "none" && Math.abs(pos.ratio - 1) < 0.02, JSON.stringify(pos));
  await pub.close();
}

/* ---- E. Ouverture : fond du métier ---------------------------------------------------------- */

if (run("E")) {
  f = await openEditor(1);
  await sleep(1500);
  await page.screenshot({ path: `${SHOTS}/E-ouverture-ombre-douce.png` });
  const role = '[data-hero-text="role"]';
  await f.locator(role).hover();
  await until(f, () => Boolean(document.querySelector(".lk-aa")));
  await f.locator(".lk-aa").click();
  await until(f, () => Boolean(document.querySelector(".lk-bar")));
  ok("E1 barre du métier : choix du fond", (await f.locator(".lk-bar .lk-row button").count()) === 4);
  await f.locator(".lk-bar .lk-row button", { hasText: "Bandeau" }).click();
  await settled();
  ok("E2 fond « bandeau » enregistré sur l'ouverture", await waitFor(() => blockOf(1, "hero")?.props.look?.roleBackdrop === "band"));
  ok("E3 rendu : bandeau derrière le métier", await until(f, (s) => getComputedStyle(document.querySelector(s)).backgroundColor !== "rgba(0, 0, 0, 0)", role));
  await page.keyboard.press("Escape");
  await sleep(600);
  await page.screenshot({ path: `${SHOTS}/E-ouverture-bandeau.png` });
  // Retour au thème (aucun fond), brouillon abandonné.
  await openEditor(1);
}

ok("G1 aucune requête du navigateur vers Google (éditeur, toile, pages publiques)", googleRequests.length === 0, googleRequests.slice(0, 3).join(" "));
ok("G2 aucune erreur JavaScript", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `e2e-look : ${failures} échec(s)` : "e2e-look : OK");
process.exit(failures ? 1 : 0);
