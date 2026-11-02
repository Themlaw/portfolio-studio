#!/usr/bin/env node
/**
 * Lot 84 « position du logo dans la barre du haut » : UN chromium, serveur dev, base NEUVE (seed), une connexion.
 * Le logo de test est une image SYNTHÉTIQUE large (texte et formes générés ici) ; aucune image de l'artiste.
 *
 *  P. Parité : réglages d'avant (taille 120, réduit au défilement) publiés ; feuille du logo identique à celle de la v0.31.0 (fixture),
 *     en-tête sans variable ajoutée ; captures de l'accueil sur 2 thèmes à 1440, 1024 et 390 px gardées pour le contrôle final.
 *  A. « Centré dans la barre » : logo centré sur la hauteur de la barre (±1 px), barre et bande dessous immobiles (0 px), logo coupé
 *     à la barre (rien ne le touche sous la barre), réduit au défilement en « Aperçu exact » toujours centré.
 *  B. « La barre s'agrandit » : barre = logo + marge, logo centré dans la barre, la bande descend d'autant.
 *  C. Position horizontale : curseur, Gauche / Centre / Droite, plafonds (jamais sous le menu, jamais hors de l'écran).
 *  D. Toile : poignée de position (glisser, flèches, Début), glisser le logo lui-même, plafond respecté.
 *  E. Pas de « Aa » sur un logo image (médiathèque, signature du kit) ; « Aa » présent sur le logo texte.
 *  F. Rechargement de l'éditeur, Défaire / Rétablir.
 *  G. Public : publication, rendu à 1440, 1024 et 390 px (décalage proportionnel, plafonné, jamais sous le menu), réduit au défilement.
 *  R. Retour aux réglages d'avant : feuille et captures IDENTIQUES à celles de P, au pixel, sur 2 thèmes × 3 largeurs.
 *
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… [BASE=http://localhost:3001] [SHOTS=…] [ONLY=P,A] node scripts/e2e-logo84.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";
import sharp from "sharp";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const DATA = process.env.DATA_DIR ?? "data";
const DB = path.join(DATA, "portfolio.db");
const SHOTS = process.env.SHOTS ?? "screenshots/logo84";
const ONLY = process.env.ONLY ?? "";
const run = (k) => !ONLY || ONLY.split(",").includes(k);
mkdirSync(SHOTS, { recursive: true });
const TMP = path.join(tmpdir(), "e2e-logo84");
mkdirSync(TMP, { recursive: true });

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const info = (label, v) => console.log(`   (${label}: ${typeof v === "string" ? v : JSON.stringify(v)})`);
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
const siteDraftLogo = () => setting("siteDraft")?.snap?.styles?.logo;
const publishedLogo = () => setting("styles")?.logo;
async function waitFor(fn, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(250);
  }
  return false;
}
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
const tsx = (code) => execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { encoding: "utf8" });

/* ---- Logo synthétique : image large (nom dessiné + formes), 500 × 200 ---------------------------------- */
const LOGO_NAME = "logo84-synthetique.png";
const logoPng = await sharp(
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="200" viewBox="0 0 500 200"><rect x="0" y="0" width="500" height="200" rx="24" fill="#2e4e9e"/><circle cx="100" cy="100" r="70" fill="#f2b705"/><rect x="200" y="30" width="270" height="30" fill="#e8553d"/><text x="200" y="150" font-family="sans-serif" font-size="56" fill="#ffffff">Atelier</text></svg>`,
  ),
)
  .png()
  .toBuffer();
writeFileSync(path.join(TMP, LOGO_NAME), logoPng);

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
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
  await sleep(700);
}
const until = (f, fn, arg, timeout = 30000) =>
  f.waitForFunction(fn, arg, { timeout, polling: 100 }).then(
    () => true,
    () => false,
  );
async function openEditor(id, { abandon = true } = {}) {
  await page.goto(`${BASE}/admin/pages/${id}/editer`, { waitUntil: "domcontentloaded" });
  const f = await canvas();
  if (abandon && (await page.getByRole("button", { name: "Abandonner les modifications" }).count())) {
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
  const goLive = page.locator("dialog[open]").getByRole("button", { name: "Mettre en ligne" });
  if (await goLive.waitFor({ timeout: 3000 }).then(() => true, () => false)) await goLive.click();
  return waitFor(async () => /En ligne/.test((await page.locator(".ve-status").textContent()) ?? ""), 120000);
}
async function section(name, fn) {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 6).join(" "));
    await page.screenshot({ path: path.join(SHOTS, `erreur-${name}.png`) }).catch(() => {});
  }
}

/** Mesures de l'en-tête (rectangles dans la fenêtre), lues une fois les transitions terminées. */
const readGeo = (fr) =>
  fr.evaluate(() => {
    const r = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height, cx: (b.left + b.right) / 2, cy: (b.top + b.bottom) / 2 };
    };
    const brand = document.querySelector(".site-header .site-brand");
    const nav = [...brand.parentElement.children].find((e) => e !== brand && e.offsetParent !== null);
    const main = document.querySelector("#contenu").getBoundingClientRect();
    return {
      brand: r(brand),
      img: r(document.querySelector(".site-header .site-logo-img")),
      bar: r(document.querySelector(".site-header-bar")),
      head: r(document.querySelector(".site-header")),
      nav: r(nav),
      mainTop: main.top + window.scrollY,
      iw: window.innerWidth,
      sw: document.documentElement.scrollWidth,
      clip: getComputedStyle(brand).clipPath,
      translate: getComputedStyle(brand).translate,
    };
  });
async function geo(fr) {
  let prev = null;
  for (let i = 0; i < 30; i++) {
    const g = await readGeo(fr);
    if (prev && JSON.stringify(prev) === JSON.stringify(g)) return g;
    prev = g;
    await sleep(200);
  }
  return prev;
}
const shot = async (name, target = page) => target.screenshot({ path: path.join(SHOTS, `${name}.png`) });
const draftHas = (pred) => waitFor(() => pred(siteDraftLogo() ?? {}), 20000);

/* ---- Envoi du logo synthétique ----------------------------------------------------------------------- */
const up = await ctx.request.post(`${BASE}/admin/api/upload`, { multipart: { file: { name: LOGO_NAME, mimeType: "image/png", buffer: logoPng } }, headers: { origin: BASE } });
const upBody = await up.json();
if (!upBody.ok) throw new Error(`envoi refusé : ${JSON.stringify(upBody)}`);
const MEDIA_ID = upBody.media.id;
ok("S0 logo synthétique envoyé", await waitFor(() => q("select status from media where id = ?", MEDIA_ID)[0]?.status === "ready", 120000));

const THEMES = ["galerie-lumineuse", "pro"];
const WIDTHS = [1440, 1024, 390];
const legacyFixture = JSON.parse(readFileSync(new URL("./lib/logo-css-v031.json", import.meta.url), "utf8"));
const LEGACY_CSS = legacyFixture.find((e) => e.logo.size === 120 && e.logo.mode === "shrink" && !e.logo.mediaId).css;
const parityShots = {};
/** Accueil public (2 thèmes × 3 largeurs) : capture du haut de page, octet pour octet. */
async function captureParity(label) {
  const out = {};
  for (const theme of THEMES) {
    for (const w of WIDTHS) {
      const c = await browser.newContext({ viewport: { width: w, height: 900 } });
      const pg = await c.newPage();
      await pg.goto(`${BASE}/api/theme-preview?id=${theme}&redirect=/fr&banner=0`, { waitUntil: "networkidle" });
      await pg.evaluate(() => document.fonts.ready);
      await sleep(1500);
      out[`${theme}-${w}`] = await pg.screenshot({ clip: { x: 0, y: 0, width: w, height: 420 }, animations: "disabled" });
      if (label === "avant") writeFileSync(path.join(SHOTS, `P-${theme}-${w}.png`), out[`${theme}-${w}`]);
      await c.close();
    }
  }
  return out;
}

let f;

/* ======================================== P. Parité (avant) ======================================== */
await section("P", async () => {
  f = await openEditor(2);
  await sleep(1500);
  await page.getByRole("tab", { name: "Réglages" }).click();
  ok("P0 la toile est assez large pour la mise en page « grand écran »", (await geo(f)).iw >= 768, String((await geo(f)).iw));
  await page.getByTestId("logo-choose").click();
  await page.getByRole("button", { name: `Choisir ${LOGO_NAME}` }).click();
  await page.locator("#lp-logo-size").fill("120");
  await page.getByRole("radio", { name: "Grand en haut, réduit au défilement" }).check();
  await settled();
  ok("P1 réglages d'avant au brouillon : taille 120, réduit, image", await draftHas((l) => l.size === 120 && l.mode === "shrink" && l.mediaId === MEDIA_ID), JSON.stringify(siteDraftLogo()));
  ok("P1b aucun champ du lot 84 ajouté tout seul", (() => { const l = siteDraftLogo() ?? {}; return !("align" in l) && !("x" in l) && !("anchor" in l); })(), JSON.stringify(siteDraftLogo()));
  ok("P2 publication des réglages d'avant", await publish());
  ok("P2b publié : seulement taille, comportement, image", JSON.stringify(publishedLogo()) === JSON.stringify({ size: 120, mode: "shrink", mediaId: MEDIA_ID }), JSON.stringify(publishedLogo()));
  const html = await (await fetch(`${BASE}/fr`)).text();
  const sheet = /<style id="site-logo">([\s\S]*?)<\/style>/.exec(html)?.[1] ?? "";
  ok("P3 feuille du logo publiée = celle de la v0.31.0, octet pour octet (fixture)", sheet.replaceAll("&gt;", ">") === LEGACY_CSS, sheet.slice(0, 200));
  const vctx = await browser.newContext();
  const pg = await vctx.newPage();
  await pg.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  await sleep(800);
  const hs = await pg.evaluate(() => document.querySelector(".site-header").getAttribute("style"));
  ok("P4 en-tête public : aucune variable de position ajoutée (rendu d'avant)", hs === null || !/--lx/.test(hs), String(hs));
  await vctx.close();
  Object.assign(parityShots, await captureParity("avant"));
  ok("P5 captures d'avant gardées (2 thèmes × 3 largeurs)", Object.keys(parityShots).length === 6);
});

/* ======================================== A. Centré ======================================== */
let base; // mesures « En haut, déborde dessous », taille 120, fixe
await section("A", async () => {
  f = await openEditor(2);
  await sleep(1500);
  await page.getByRole("tab", { name: "Réglages" }).click();
  await page.getByRole("radio", { name: "Fixe" }).check();
  await settled();
  base = await geo(f);
  info("avant", { bar: base.bar, brand: base.brand, mainTop: base.mainTop });
  ok("A0 départ : le logo (120 px) déborde sous la barre", base.brand.b - base.bar.b > 30, JSON.stringify([base.brand.b, base.bar.b]));
  const names = (await page.locator("[data-testid=logo-align] strong").allTextContents()).map((s) => s.trim());
  ok("A1 trois places, libellés exacts", JSON.stringify(names) === JSON.stringify(["En haut, déborde dessous", "Centré dans la barre", "La barre s'agrandit"]), JSON.stringify(names));
  ok("A1b « En haut, déborde dessous » coché au départ", await page.getByTestId("logo-align-top").isChecked());
  await shot("A-avant-haut-1440");
  await page.getByRole("radio", { name: "Centré dans la barre" }).check();
  await settled();
  ok("A2 brouillon : align = center", await draftHas((l) => l.align === "center"), JSON.stringify(siteDraftLogo()));
  const g = await geo(f);
  info("centré", { bar: g.bar, brand: g.brand, clip: g.clip });
  ok("A3 le logo est centré dans la barre (±1 px)", near(g.brand.cy, g.bar.cy, 1), `${g.brand.cy} / ${g.bar.cy}`);
  ok("A4 la barre garde sa hauteur (0 px)", near(g.bar.h, base.bar.h, 0.01), `${g.bar.h} / ${base.bar.h}`);
  ok("A5 la bande sous la barre ne bouge pas (0 px)", near(g.mainTop, base.mainTop, 0.01), `${g.mainTop} / ${base.mainTop}`);
  ok("A6 le logo garde sa taille (120 px)", near(g.brand.h, 120, 1));
  ok("A7 coupé aux limites de la barre (clip-path)", /inset/.test(g.clip), g.clip);
  const hit = await f.evaluate(({ x, y1, y2 }) => ({ below: document.elementsFromPoint(x, y1).some((e) => e.closest(".site-brand")), inside: document.elementsFromPoint(x, y2).some((e) => e.closest(".site-brand")) }), { x: g.brand.l + 60, y1: g.bar.b + 6, y2: g.bar.b - 6 });
  ok("A8 rien du logo n'est visible sous la barre (ni touchable) ; il l'est dans la barre", !hit.below && hit.inside, JSON.stringify(hit));
  const above = await f.evaluate(({ x, y }) => document.elementsFromPoint(x, y).some((e) => e.closest(".site-brand")), { x: g.brand.l + 60, y: g.bar.t - 6 });
  ok("A8b ce qui dépasse en haut est coupé aussi", !above || g.bar.t < 8);
  await shot("A-centre-1440");

  // Réduit au défilement + centré : « Aperçu exact », en-tête collant.
  await page.getByRole("radio", { name: "Grand en haut, réduit au défilement" }).check();
  await settled();
  await page.getByRole("button", { name: "Aperçu", exact: true }).click();
  await f.waitForFunction(() => !document.documentElement.hasAttribute("data-edit-canvas"), null, { timeout: 30000 });
  await sleep(600);
  await f.evaluate(() => window.scrollTo(0, 0));
  await sleep(900);
  const top = await geo(f);
  await f.evaluate(() => window.scrollTo(0, 500));
  await sleep(1300);
  const sc = await geo(f);
  ok("A9 réduit + centré : 120 px en haut, 72 px défilé", near(top.brand.h, 120, 1.5) && near(sc.brand.h, 72, 2), JSON.stringify([top.brand.h, sc.brand.h]));
  ok("A10 réduit + centré : toujours centré dans la barre, en haut comme défilé (±1,5 px)", near(top.brand.cy, top.bar.cy, 1.5) && near(sc.brand.cy, sc.bar.cy, 1.5), JSON.stringify([top.brand.cy - top.bar.cy, sc.brand.cy - sc.bar.cy]));
  ok("A11 réduit + centré : la barre et la page ne bougent pas au défilement", near(top.bar.h, sc.bar.h, 0.5) && near(top.mainTop, sc.mainTop, 0.5), JSON.stringify([top.bar.h, sc.bar.h, top.mainTop, sc.mainTop]));
  await shot("A-defile-1440");
  await f.evaluate(() => window.scrollTo(0, 0));
  await page.locator(".ve-exit-preview").click();
  await f.waitForFunction(() => document.documentElement.hasAttribute("data-edit-canvas"), null, { timeout: 30000 });
  await page.getByRole("radio", { name: "Fixe" }).check();
  await settled();
});

/* ======================================== B. La barre s'agrandit ======================================== */
await section("B", async () => {
  await page.getByRole("radio", { name: "La barre s'agrandit" }).check();
  await settled();
  ok("B1 brouillon : align = grow", await draftHas((l) => l.align === "grow"), JSON.stringify(siteDraftLogo()));
  const g = await geo(f);
  info("grandit", { bar: g.bar, brand: g.brand, mainTop: g.mainTop });
  // Grand écran : marge du thème 1,25 rem (20 px) de chaque côté de la rangée.
  ok("B2 la barre prend la hauteur du logo plus la même marge (120 + 2 × 20 px)", near(g.bar.h, 160, 1), `${g.bar.h} / 160`);
  ok("B3 le logo est centré dans la barre (±1 px)", near(g.brand.cy, g.bar.cy, 1), `${g.brand.cy} / ${g.bar.cy}`);
  ok("B4 plus rien ne déborde sous la barre", g.brand.b <= g.bar.b + 0.5 && g.brand.t >= g.bar.t - 0.5, JSON.stringify([g.brand, g.bar]));
  ok("B5 la bande descend d'autant que la barre grandit", near(g.mainTop - base.mainTop, g.bar.h - base.bar.h, 1), `${g.mainTop - base.mainTop} / ${g.bar.h - base.bar.h}`);
  ok("B6 le logo ne mord pas sur la bande", g.brand.b <= g.mainTop + 0.5);
  ok("B7 pas de coupe nécessaire (clip-path sans effet : rien ne dépasse)", g.brand.h <= g.bar.h);
  await shot("B-grandit-1440");
  // Petit logo : la barre ne rétrécit jamais sous sa hauteur naturelle.
  await page.locator("#lp-logo-size").fill("32");
  await settled();
  const small = await geo(f);
  ok("B8 petit logo (32 px) : la barre = logo + marges (72 px), logo centré", near(small.bar.h, 72, 1) && near(small.brand.cy, small.bar.cy, 1), JSON.stringify([small.bar.h, small.brand.cy - small.bar.cy]));
  await page.locator("#lp-logo-size").fill("120");
  await page.getByRole("radio", { name: "Centré dans la barre" }).check();
  await settled();
});

/* ======================================== C. Position horizontale (panneau) ======================================== */
let left0;
await section("C", async () => {
  left0 = await geo(f);
  const xs = page.locator("#lp-logo-x");
  ok("C0 bornes du curseur de décalage : −200 à 600 px", (await xs.getAttribute("min")) === "-200" && (await xs.getAttribute("max")) === "600");
  const labels = (await page.locator("[data-testid=logo-position] .lc-modes-row button").allTextContents()).map((s) => s.trim());
  ok("C1 boutons Gauche / Centre / Droite", JSON.stringify(labels) === JSON.stringify(["Gauche", "Centre", "Droite"]), JSON.stringify(labels));
  await xs.fill("100");
  await settled();
  ok("C2 brouillon : x = 100", await draftHas((l) => l.x === 100), JSON.stringify(siteDraftLogo()));
  let g = await geo(f);
  ok("C3 le logo se décale de 100 px à droite (±1)", near(g.brand.l - left0.brand.l, 100, 1), String(g.brand.l - left0.brand.l));
  ok("C3b la hauteur n'a pas bougé (centré, barre et bande immobiles)", near(g.brand.cy, g.bar.cy, 1) && near(g.mainTop, base.mainTop, 0.01));
  ok("C4 la valeur lue : +100 px", /\+100 px/.test((await page.getByTestId("logo-x-out").textContent()) ?? ""));
  await shot("C-x100-1440");
  await xs.fill("600");
  await settled();
  g = await geo(f);
  info("x=600", { brandR: g.brand.r, navL: g.nav.l });
  ok("C5 x = 600 : plafonné, le logo s'arrête avant le menu (jamais dessous)", g.brand.r <= g.nav.l - 8 && g.brand.r > left0.brand.r + 10, JSON.stringify([g.brand.r, g.nav.l]));
  await xs.fill("-200");
  await settled();
  g = await geo(f);
  ok("C6 x = −200 : le logo reste dans l'écran (≥ 0)", g.brand.l >= 0 && g.brand.l <= left0.brand.l, String(g.brand.l));
  await xs.fill("0");
  await page.getByTestId("logo-anchor-center").click();
  await settled();
  g = await geo(f);
  // Le menu occupe la moitié droite de la toile : le milieu de la page est sous lui, le logo s'arrête donc contre lui (le plafond gagne).
  const wantC = Math.min(g.head.cx, g.nav.l - 16 - g.brand.w / 2);
  ok("C7 « Centre » : le logo va vers le milieu de la page, sans passer sous le menu (±2 px)", near(g.brand.cx, wantC, 2) && g.brand.cx > left0.brand.cx + 20, `${g.brand.cx} / ${wantC}`);
  ok("C7b brouillon : anchor = center", await draftHas((l) => l.anchor === "center"), JSON.stringify(siteDraftLogo()));
  await shot("C-centre-1440");
  await page.getByTestId("logo-anchor-right").click();
  await settled();
  g = await geo(f);
  ok("C8 « Droite » : le logo va jusqu'au menu sans passer dessous", g.brand.r <= g.nav.l && g.nav.l - g.brand.r < 30, `${g.brand.r} / ${g.nav.l}`);
  await page.getByTestId("logo-anchor-left").click();
  await settled();
  g = await geo(f);
  ok("C9 « Gauche » : retour à la place d'avant", near(g.brand.l, left0.brand.l, 0.5) && (await draftHas((l) => l.anchor === undefined && l.x === undefined)), JSON.stringify([g.brand.l, left0.brand.l, siteDraftLogo()]));
  ok("C10 « Remettre le logo à gauche » absent quand rien n'est décalé", (await page.getByTestId("logo-pos-reset").count()) === 0);
  await xs.fill("50");
  await settled();
  await page.getByTestId("logo-pos-reset").click();
  await settled();
  ok("C11 « Remettre le logo à gauche » : plus de x ni d'ancrage", await draftHas((l) => l.x === undefined && l.anchor === undefined), JSON.stringify(siteDraftLogo()));
});

/* ======================================== D. Poignée de position sur la toile ======================================== */
await section("D", async () => {
  await f.locator(".site-header").hover();
  const h = f.getByTestId("logo-xhandle");
  ok("D1 survol de l'en-tête : poignée de position", await h.waitFor({ timeout: 10000 }).then(() => true, () => false));
  const sh = f.getByTestId("logo-handle");
  const hb0 = await h.boundingBox();
  const sb0 = await sh.boundingBox();
  const g0 = await geo(f);
  const fb = await (await f.frameElement()).boundingBox();
  ok("D1b la poignée de position est au bord gauche du logo, celle de taille en bas à droite", Math.abs(hb0.x + 9 - fb.x - g0.brand.l) <= 3 && sb0.x > hb0.x + 100, JSON.stringify([hb0, sb0, fb, g0.brand.l]));
  ok("D1c elle annonce sa valeur et ses bornes", (await h.getAttribute("aria-valuenow")) === "0" && Number(await h.getAttribute("aria-valuemax")) > 50 && Number(await h.getAttribute("aria-valuemin")) <= 0);
  await page.mouse.move(hb0.x + hb0.width / 2, hb0.y + hb0.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb0.x + hb0.width / 2 + 30, hb0.y + hb0.height / 2, { steps: 4 });
  await page.mouse.move(hb0.x + hb0.width / 2 + 60, hb0.y + hb0.height / 2, { steps: 4 });
  await sleep(300);
  const dx = Number(await h.getAttribute("aria-valuenow"));
  ok("D2 glisser vers la droite de 60 px : x ≈ 60", dx >= 58 && dx <= 62, String(dx));
  ok("D2b la toile suit pendant le geste", near((await readGeo(f)).brand.l - g0.brand.l, dx, 4));
  await page.mouse.up();
  await settled();
  ok("D2c enregistré au relâchement", await draftHas((l) => l.x === dx), JSON.stringify(siteDraftLogo()));
  ok("D2d le curseur du panneau suit", (await page.locator("#lp-logo-x").inputValue()) === String(dx));
  await h.focus();
  await page.keyboard.press("ArrowRight");
  ok("D3 clavier : flèche droite = +2 px", await waitFor(async () => Number(await h.getAttribute("aria-valuenow")) === dx + 2));
  await page.keyboard.press("Shift+ArrowLeft");
  ok("D4 clavier : Maj + flèche gauche = −10 px", await waitFor(async () => Number(await h.getAttribute("aria-valuenow")) === dx - 8));
  await page.keyboard.press("Home");
  ok("D5 clavier : Début = retour à 0", await waitFor(async () => Number(await h.getAttribute("aria-valuenow")) === 0) && near((await geo(f)).brand.l, g0.brand.l, 0.5));
  // Beaucoup trop loin : le plafond arrête la poignée AVANT le menu.
  const hb1 = await h.boundingBox();
  await page.mouse.move(hb1.x + 9, hb1.y + 9);
  await page.mouse.down();
  await page.mouse.move(hb1.x + 9 + 900, hb1.y + 9, { steps: 12 });
  await sleep(300);
  const far = await readGeo(f);
  await page.mouse.up();
  ok("D6 trop loin : le logo s'arrête avant le menu, la valeur reste dans les bornes", far.brand.r <= far.nav.l && Number(await h.getAttribute("aria-valuenow")) <= Number(await h.getAttribute("aria-valuemax")), JSON.stringify([far.brand.r, far.nav.l]));
  await settled();
  await h.focus();
  await page.keyboard.press("Home");
  await settled();
  // Glisser le logo lui-même.
  const url0 = f.url();
  const gi = await geo(f);
  const fb2 = await (await f.frameElement()).boundingBox();
  const cx = fb2.x + gi.img.cx;
  const cy = fb2.y + gi.bar.cy; // le milieu de la barre : la partie visible du logo (coupé aux limites de la barre)
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 20, cy, { steps: 3 });
  await page.mouse.move(cx + 40, cy, { steps: 3 });
  await sleep(300);
  await page.mouse.up();
  await settled();
  const after = await geo(f);
  info("D7 variables", await f.evaluate(() => ({ s: document.querySelector(".site-header").getAttribute("style"), vm: document.querySelector("[data-testid=logo-xhandle]")?.getAttribute("aria-valuemax") })));
  ok("D7 glisser le logo lui-même : il suit la souris (≈ +40 px)", near(after.brand.l - gi.brand.l, 40, 6), String(after.brand.l - gi.brand.l));
  ok("D7b le clic qui suit n'ouvre pas la page d'accueil", f.url() === url0);
  ok("D7c enregistré", await draftHas((l) => typeof l.x === "number" && l.x >= 30), JSON.stringify(siteDraftLogo()));
  await h.focus();
  await page.keyboard.press("Home");
  await settled();
});

/* ======================================== E. Pas de « Aa » sur un logo image ======================================== */
await section("E", async () => {
  await page.mouse.move(700, 600);
  await sleep(400);
  await f.locator(".site-header .site-logo-img").hover();
  await sleep(1000);
  ok("E1 logo image (médiathèque) survolé : pas de « Aa »", (await f.locator(".lk-aa").count()) === 0);
  await shot("E-sans-aa-1440");
  // Signature du kit (comme le test de la taille du logo : attributs posés sur la toile).
  await page.getByRole("button", { name: /Revenir au logo/ }).click();
  await settled();
  ok("E2 logo texte : le nom du site est écrit dans l'en-tête", await draftHas((l) => l.mediaId === undefined), JSON.stringify(siteDraftLogo()));
  await page.mouse.move(700, 600);
  await sleep(500);
  const text = f.locator(".site-header .site-brand-text");
  await text.hover();
  ok("E3 logo texte survolé : « Aa » présent", await f.locator(".lk-aa").waitFor({ timeout: 8000 }).then(() => true, () => false));
  await page.mouse.move(700, 600);
  await f.evaluate(() => {
    document.documentElement.setAttribute("data-kit-signature", "");
    const svg = "data:image/svg+xml;utf8," + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 40'><rect width='200' height='40'/></svg>");
    document.documentElement.style.setProperty("--t-kit-signature", `url("${svg}")`);
    document.documentElement.style.setProperty("--t-kit-signature-ratio", "3 / 1");
  });
  await sleep(900);
  await f.locator(".site-header .site-signature").hover();
  await sleep(1000);
  ok("E4 signature dessinée du kit survolée : pas de « Aa »", (await f.locator(".lk-aa").count()) === 0);
  await f.evaluate(() => {
    document.documentElement.removeAttribute("data-kit-signature");
    document.documentElement.style.removeProperty("--t-kit-signature");
    document.documentElement.style.removeProperty("--t-kit-signature-ratio");
  });
  // L'image revient.
  await page.getByTestId("logo-choose").click();
  await page.getByRole("button", { name: `Choisir ${LOGO_NAME}` }).click();
  await settled();
  ok("E5 image rechoisie", await draftHas((l) => l.mediaId === MEDIA_ID), JSON.stringify(siteDraftLogo()));
});

/* ======================================== F. Rechargement, Défaire / Rétablir ======================================== */
let chosen;
await section("F", async () => {
  await page.getByRole("radio", { name: "Centré dans la barre" }).check();
  await page.locator("#lp-logo-x").fill("80");
  await settled();
  ok("F1 brouillon : taille, centré, x = 80, image", await draftHas((l) => l.size === 120 && l.align === "center" && l.x === 80 && l.mediaId === MEDIA_ID), JSON.stringify(siteDraftLogo()));
  await sleep(1000);
  chosen = await geo(f);
  ok("F1b le logo est décalé de 80 px", near(chosen.brand.l - left0.brand.l, 80, 1.5), String(chosen.brand.l - left0.brand.l));
  await page.locator(".ve-history").getByRole("button", { name: "Défaire" }).click();
  await settled();
  ok("F4 Défaire : le décalage revient en arrière (x ≠ 80)", await draftHas((l) => l.x !== 80 && l.align === "center"), JSON.stringify(siteDraftLogo()));
  ok("F4b Défaire : le panneau suit", !/\+80 px/.test((await page.getByTestId("logo-x-out").textContent()) ?? ""));
  const undone = await geo(f);
  ok("F4c Défaire : le logo a quitté la position à +80", !near(undone.brand.l, chosen.brand.l, 1), `${undone.brand.l} / ${chosen.brand.l}`);
  await page.locator(".ve-history").getByRole("button", { name: "Rétablir" }).click();
  await settled();
  ok("F5 Rétablir : x = 80 revient", await draftHas((l) => l.x === 80), JSON.stringify(siteDraftLogo()));
  const redone = await geo(f);
  ok("F5b Rétablir : le logo retrouve sa position", near(redone.brand.l, chosen.brand.l, 1), `${redone.brand.l} / ${chosen.brand.l}`);
  ok("F5c Rétablir : le panneau suit", /\+80 px/.test((await page.getByTestId("logo-x-out").textContent()) ?? ""));
  // Défaire / Rétablir de la place verticale.
  await page.getByRole("radio", { name: "La barre s'agrandit" }).check();
  await settled();
  await page.locator(".ve-history").getByRole("button", { name: "Défaire" }).click();
  await settled();
  ok("F6 Défaire la place : « Centré dans la barre » revient (panneau et brouillon)", (await draftHas((l) => l.align === "center")) && (await page.getByTestId("logo-align-center").isChecked()));
  await page.locator(".ve-history").getByRole("button", { name: "Rétablir" }).click();
  await settled();
  ok("F7 Rétablir la place : « La barre s'agrandit »", (await draftHas((l) => l.align === "grow")) && (await page.getByTestId("logo-align-grow").isChecked()));
  await page.getByRole("radio", { name: "Centré dans la barre" }).check();
  await settled();
  ok("F8 retour au centrage avant publication", await draftHas((l) => l.align === "center" && l.x === 80), JSON.stringify(siteDraftLogo()));
  chosen = await geo(f);
  await page.reload({ waitUntil: "domcontentloaded" });
  f = await canvas();
  await sleep(1500);
  await page.getByRole("tab", { name: "Réglages" }).click();
  const g = await geo(f);
  ok("F2 rechargement : le panneau garde « Centré dans la barre » et +80 px", (await page.getByTestId("logo-align-center").isChecked()) && /\+80 px/.test((await page.getByTestId("logo-x-out").textContent()) ?? ""));
  ok("F3 rechargement : la toile montre le même logo, à la même place", near(g.brand.l, chosen.brand.l, 0.5) && near(g.brand.cy, g.bar.cy, 1) && near(g.mainTop, chosen.mainTop, 0.01), JSON.stringify([g.brand.l, chosen.brand.l]));
});

/* ======================================== G. Public ======================================== */
await section("G", async () => {
  await page.locator("#lp-logo-x").fill("300");
  await page.getByRole("radio", { name: "Fixe" }).check();
  await settled();
  ok("G0 publication : taille 120, centré, x = 300", await publish());
  ok("G0b publié : taille, image, centré, x = 300", publishedLogo()?.align === "center" && publishedLogo()?.x === 300 && publishedLogo()?.size === 120 && publishedLogo()?.mediaId === MEDIA_ID, JSON.stringify(publishedLogo()));
  const geoPub = async (w, css) => {
    const c = await browser.newContext({ viewport: { width: w, height: 900 } });
    const pg = await c.newPage();
    await pg.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
    await sleep(700);
    if (css) {
      await pg.evaluate((t) => {
        document.getElementById("site-logo").textContent = t;
      }, css);
      await pg.evaluate(() => window.dispatchEvent(new Event("resize")));
      await sleep(900);
    }
    return { pg, c, g: await geo(pg) };
  };
  const cssFor = (logo) => tsx(`import { logoCss } from "./src/lib/look.ts"; process.stdout.write(logoCss(${JSON.stringify(logo)}));`);
  for (const w of [1440, 1024]) {
    const { pg, c, g } = await geoPub(w);
    info(`public ${w}`, { brandL: g.brand.l, brandR: g.brand.r, navL: g.nav.l });
    ok(`G1 public ${w} : logo centré dans la barre (±1 px)`, near(g.brand.cy, g.bar.cy, 1), `${g.brand.cy} / ${g.bar.cy}`);
    ok(`G2 public ${w} : décalé à droite sans passer sous le menu`, g.brand.r <= g.nav.l - 8 && g.brand.l > 30, JSON.stringify([g.brand.l, g.brand.r, g.nav.l]));
    ok(`G3 public ${w} : pas de défilement horizontal`, g.sw <= g.iw);
    await pg.screenshot({ path: path.join(SHOTS, `G-public-${w}.png`), clip: { x: 0, y: 0, width: w, height: 300 } });
    await c.close();
  }
  // Téléphone : décalage ×0,75, plafonné à 120 px, jamais sous « Menu » ni hors de l'écran (390 px : peu de place ; 700 px : le plafond de 120 px joue).
  const hiOf = (pg) => pg.evaluate(() => Number.parseFloat(document.querySelector(".site-header").style.getPropertyValue("--lx-hi")));
  for (const w of [390, 700]) {
    for (const [label, logo, want] of [
      ["x = 300", { size: 120, mediaId: MEDIA_ID, align: "center", x: 300 }, 120],
      ["x = 100", { size: 120, mediaId: MEDIA_ID, align: "center", x: 100 }, 75],
      ["x = 600 à droite", { size: 120, mediaId: MEDIA_ID, align: "center", x: 600, anchor: "right" }, null],
      ["x = −200", { size: 120, mediaId: MEDIA_ID, align: "center", x: -200 }, null],
    ]) {
      const { pg, c, g } = await geoPub(w, cssFor(logo));
      const ref = await geoPub(w, cssFor({ size: 120, mediaId: MEDIA_ID, align: "center" }));
      const shift = g.brand.l - ref.g.brand.l;
      const hi = await hiOf(pg);
      info(`${w} ${label}`, { shift, hi, brandL: g.brand.l, brandR: g.brand.r, navL: g.nav.l });
      ok(`G4 ${w} px, ${label} : le logo ne passe jamais sous « Menu »`, g.brand.r <= g.nav.l - 4, JSON.stringify([g.brand.r, g.nav.l]));
      ok(`G5 ${w} px, ${label} : le logo reste dans l'écran`, g.brand.l >= 0 && g.brand.r <= g.iw && g.sw <= g.iw, JSON.stringify([g.brand.l, g.brand.r, g.iw, g.sw]));
      if (!logo.anchor) ok(`G6 ${w} px, ${label} : décalage plafonné à 120 px`, Math.abs(shift) <= 121, String(shift));
      if (want !== null) ok(`G7 ${w} px, ${label} : ×0,75 puis plafond de 120 px, puis la place libre avant le menu (${Math.min(want, Math.round(hi))} px attendus)`, near(shift, Math.min(want, hi), 1.5), `${shift} / ${Math.min(want, hi)}`);
      if (label === "x = −200") ok(`G7b ${w} px, x = −200 : le logo s'arrête à 8 px du bord de l'écran au plus près`, g.brand.l >= 7.5, String(g.brand.l));
      ok(`G8 ${w} px, ${label} : logo centré dans la barre (±1 px)`, near(g.brand.cy, g.bar.cy, 1), `${g.brand.cy} / ${g.bar.cy}`);
      if (label === "x = 300" && w === 390) await pg.screenshot({ path: path.join(SHOTS, "G-public-390.png"), clip: { x: 0, y: 0, width: 390, height: 260 } });
      if (label === "x = 300" && w === 700) await pg.screenshot({ path: path.join(SHOTS, "G-public-700.png"), clip: { x: 0, y: 0, width: 700, height: 260 } });
      await c.close();
      await ref.c.close();
    }
  }
  // Réduit au défilement + centré, rendu public.
  {
    const css = cssFor({ size: 120, mode: "shrink", mediaId: MEDIA_ID, align: "center", x: 100 });
    const { pg, c } = await geoPub(1440, css);
    await pg.evaluate(() => window.scrollTo(0, 600));
    await sleep(1400);
    const g = await geo(pg);
    ok("G9 public : réduit au défilement (72 px), toujours centré (±1,5 px)", near(g.brand.h, 72, 2) && near(g.brand.cy, g.bar.cy, 1.5), JSON.stringify([g.brand.h, g.brand.cy - g.bar.cy]));
    await pg.screenshot({ path: path.join(SHOTS, "G-public-defile-1440.png"), clip: { x: 0, y: 0, width: 1440, height: 200 } });
    await c.close();
  }
  // La barre s'agrandit : public.
  {
    const css = cssFor({ size: 120, mediaId: MEDIA_ID, align: "grow", x: 100 });
    const { pg, c, g } = await geoPub(1440, css);
    ok("G10 public « La barre s'agrandit » : barre ≥ logo, logo centré, la bande sous la barre", g.bar.h >= 120 && near(g.brand.cy, g.bar.cy, 1) && g.brand.b <= g.mainTop + 0.5, JSON.stringify([g.bar.h, g.brand.cy - g.bar.cy, g.brand.b, g.mainTop]));
    await pg.screenshot({ path: path.join(SHOTS, "G-public-grandit-1440.png"), clip: { x: 0, y: 0, width: 1440, height: 260 } });
    await c.close();
  }
  ok("G11 public : aucun repère d'édition", !(await (await fetch(`${BASE}/fr`)).text()).match(/data-edit|pe-host|sl-logo-handle|sl-logo-xhandle/));
});

/* ======================================== R. Retour aux réglages d'avant : parité ======================================== */
await section("R", async () => {
  f = await openEditor(2);
  await sleep(1500);
  await page.getByRole("tab", { name: "Réglages" }).click();
  await page.getByRole("radio", { name: "En haut, déborde dessous" }).check();
  await page.getByRole("radio", { name: "Grand en haut, réduit au défilement" }).check();
  await page.getByTestId("logo-pos-reset").click();
  await settled();
  ok("R1 brouillon : retour exact aux réglages d'avant", await draftHas((l) => l.size === 120 && l.mode === "shrink" && l.mediaId === MEDIA_ID && !("align" in l) && !("x" in l) && !("anchor" in l)), JSON.stringify(siteDraftLogo()));
  ok("R2 publication", await publish());
  ok("R2b publié = réglages d'avant", JSON.stringify(publishedLogo()) === JSON.stringify({ size: 120, mode: "shrink", mediaId: MEDIA_ID }), JSON.stringify(publishedLogo()));
  const html = await (await fetch(`${BASE}/fr`)).text();
  const sheet = /<style id="site-logo">([\s\S]*?)<\/style>/.exec(html)?.[1] ?? "";
  ok("R3 feuille du logo = celle de la v0.31.0 (fixture)", sheet.replaceAll("&gt;", ">") === LEGACY_CSS);
  const apres = await captureParity("apres");
  for (const key of Object.keys(parityShots)) {
    const same = Object.hasOwn(apres, key) && parityShots[key].equals(apres[key]);
    if (!same && apres[key]) writeFileSync(path.join(SHOTS, `R-DIFF-${key}.png`), apres[key]);
    ok(`R4 parité au pixel (${key})`, same);
  }
});

ok("aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
if (failures) {
  console.error(`e2e-logo84 : ÉCHEC (${failures})`);
  process.exit(1);
}
console.log("e2e-logo84 : tout passe");
