#!/usr/bin/env node
/**
 * Intégration v0.17 : cartes de rubrique (17c) × palette et logo du site (17f) × recadrage libre (17d).
 * UN chromium, base NEUVE (seed), une connexion. Page « À propos » : trois cartes (jeton « primary », jeton « bg »,
 * couleur libre), une image au recadrage libre, de quoi défiler.
 *
 *  I1. Toile : une carte à jeton suit la palette du site EN APERÇU (avant l'enregistrement).
 *  I2. Public : la carte est calculée sur la palette EFFECTIVE du site (fond de la carte, texte lisible dessus), pas
 *      sur celle du thème ; la couleur libre reste telle quelle ; les cartes n'ont aucun repère d'édition.
 *  I3. Public : logo réduit au défilement (24 px au moins), image en recadrage libre servie par /media/crop/.
 *  I4. Sans palette du site : les cartes retrouvent la palette du thème.
 * Captures : $SHOTS (1440 px). Usage : DATA_DIR=… ADMIN_EMAIL=… ADMIN_PASSWORD=… BASE=http://localhost:3220 node scripts/e2e-integ17.mjs
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";

import { sheet } from "./lib/crop-fixtures.mjs";
import { pageIdOf, q1, waitFor } from "./lib/medias-setup.mjs";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const DB = path.join(process.env.DATA_DIR ?? "data", "portfolio.db");
const SHOTS = process.env.SHOTS ?? "screenshots/integ17";
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rgbOf = (css) => (/rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(css) ?? []).slice(1, 4).map(Number);
const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const near = (a, b, tol = 2) => a.length === 3 && b.length === 3 && a.every((v, i) => Math.abs(v - b[i]) <= tol);
const lum = ([r, g, b]) => {
  const f = (v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const NEW_BG = "#f7f3e8";
const NEW_PRIMARY = "#7a1f10";
const FREE = "#2a4d8f";

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(120000);
page.setDefaultNavigationTimeout(180000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(`${BASE}/admin/connexion`, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL);
await page.fill("#password", PASSWORD);
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/admin/connexion"), { timeout: 90000 }), page.click("button[type=submit]")]);

/* ---- média + brouillon de la page ---------------------------------------------------------------- */
const NAME = "integ17-planche.png";
const up = await ctx.request.post(`${BASE}/admin/api/upload`, { headers: { origin: BASE }, multipart: { file: { name: NAME, mimeType: "image/png", buffer: await sheet() } } });
if (up.status() >= 300) throw new Error(`envoi : ${up.status()}`);
const mediaOf = () => q1("select id, status from media where original_name = ? order by id desc", NAME);
if (!(await waitFor(() => mediaOf()?.status === "ready", 240000))) throw new Error(`média : ${JSON.stringify(mediaOf())}`);
const MEDIA = mediaOf().id;
const PAGE_ID = pageIdOf("a-propos");

const text = (uid, title, surface) => ({
  uid,
  type: "rich-text",
  props: { title: { fr: title, en: title }, paragraphs: [{ fr: "Un paragraphe pour vérifier la lisibilité du texte sur la carte.", en: "A paragraph to check text legibility on the card." }], ...(surface ? { surface } : {}) },
});
const BLOCKS = [
  text("t-intro", "Introduction"),
  text("c-primary", "Carte couleur principale", { color: "primary", width: "inset", corners: "round" }),
  text("c-bg", "Carte fond de page", { color: "bg", width: "inset", corners: "round" }),
  text("c-libre", "Carte couleur libre", { color: FREE, width: "inset", corners: "round" }),
  { uid: "i-libre", type: "image", props: { mediaId: MEDIA, width: "wide", look: { crop: { mediaId: { x: 50, y: 50, zoom: 1, rect: { x: 0.52, y: 0.04, w: 0.44, h: 0.42 } } } } } },
  text("t-1", "Suite 1"),
  text("t-2", "Suite 2"),
  text("t-3", "Suite 3"),
  text("t-4", "Suite 4"),
];
{
  const db = new Database(DB);
  db.pragma("busy_timeout = 5000");
  const row = db.prepare("select title, slug, meta, nav_order from pages where id = ?").get(PAGE_ID);
  const draft = { title: JSON.parse(row.title), slug: JSON.parse(row.slug), meta: row.meta ? JSON.parse(row.meta) : { title: { fr: "", en: "" }, description: { fr: "", en: "" } }, published: true, inMenu: row.nav_order !== null, accent: null, blocks: BLOCKS };
  db.prepare("update pages set draft = ?, draft_updated_at = unixepoch(), draft_rev = draft_rev + 1 where id = ?").run(JSON.stringify(draft), PAGE_ID);
  db.close();
}

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
const cardOf = (f, uid) =>
  f.evaluate((u) => {
    const el = document.querySelector(`[data-edit-block="${u}"] > .surface-card`);
    if (!el) return null;
    return { bg: getComputedStyle(el).backgroundColor, ink: getComputedStyle(el.querySelector("h1,h2,h3,p")).color, on: el.getAttribute("data-surface") };
  }, uid);

await page.goto(`${BASE}/admin/pages/${PAGE_ID}/editer`, { waitUntil: "domcontentloaded" });
let f = await canvas();
if (await page.getByRole("button", { name: "Abandonner les modifications" }).count()) {
  // Le brouillon écrit en base est celui qu'on veut : pas d'abandon, l'éditeur le reprend.
}
await sleep(1500);
await page.getByRole("tab", { name: "Réglages" }).click();

/* ---- I1. Palette du site en aperçu sur la toile --------------------------------------------------- */
const before = await cardOf(f, "c-primary");
ok("I1a carte « primary » présente sur la toile avant réglage", before?.on === "on", JSON.stringify(before));
const pick = async (name, hex) => {
  const item = page.locator(".lc-role-item", { has: page.locator(".lc-role strong", { hasText: name }) });
  if ((await item.getAttribute("data-open")) === null) await item.locator(".lc-role").click();
  const field = item.locator(".cp-hex");
  await field.waitFor();
  await field.fill(hex);
  await field.press("Enter");
};
await pick("Boutons et liens", NEW_PRIMARY);
const t0 = Date.now();
let seen = null;
for (; Date.now() - t0 < 3000; await sleep(100)) {
  seen = await cardOf(f, "c-primary");
  if (near(rgbOf(seen?.bg ?? ""), hexRgb(NEW_PRIMARY))) break;
}
ok("I1b aperçu : le fond de la carte « primary » suit la palette du site avant l'enregistrement", near(rgbOf(seen?.bg ?? ""), hexRgb(NEW_PRIMARY)), JSON.stringify(seen));
ok("I1c aperçu : texte de la carte lisible (≥ 4,5:1)", ratio(rgbOf(seen.ink), rgbOf(seen.bg)) >= 4.5, `${ratio(rgbOf(seen.ink), rgbOf(seen.bg)).toFixed(2)}`);
await settled();
await pick("Fond de page", NEW_BG);
await settled();
const free = await cardOf(f, "c-libre");
ok("I1d couleur libre inchangée par la palette", near(rgbOf(free?.bg ?? ""), hexRgb(FREE)), JSON.stringify(free));

/* ---- logo : réduit au défilement ------------------------------------------------------------------ */
const slider = page.locator("#lp-logo-size");
await slider.fill("120");
await page.getByRole("radio", { name: /réduit au défilement/ }).check();
await settled();
await page.getByRole("button", { name: "Publier", exact: true }).click();
ok("I2a publication", await waitFor(async () => /En ligne/.test((await page.locator(".ve-status").textContent()) ?? ""), 120000));

/* ---- I2/I3. Public ---------------------------------------------------------------------------------- */
const pub = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const pp = await pub.newPage();
await pp.goto(`${BASE}/fr/a-propos`, { waitUntil: "networkidle" });
const html = await pp.content();
const marks = await pp.evaluate(() => document.querySelectorAll("[data-edit-block],[data-edit-surface],[data-edit-media],[data-edit-add],[data-card-default],[data-nav-key],.pe-host").length);
ok("I2b public : aucun repère d'édition dans le DOM", marks === 0, String(marks));
const pubCard = (uid) =>
  pp.evaluate((title) => {
    const h = [...document.querySelectorAll("h1,h2,h3")].find((e) => e.textContent.includes(title));
    const el = h?.closest(".surface-card");
    return el ? { bg: getComputedStyle(el).backgroundColor, ink: getComputedStyle(h).color, cardBg: el.style.getPropertyValue("--card-bg") } : null;
  }, uid);
const cp = await pubCard("Carte couleur principale");
ok("I2c public : la carte « primary » prend la couleur PRINCIPALE DU SITE", near(rgbOf(cp?.bg ?? ""), hexRgb(NEW_PRIMARY)), JSON.stringify(cp));
ok("I2d public : texte de cette carte ≥ 4,5:1", cp && ratio(rgbOf(cp.ink), rgbOf(cp.bg)) >= 4.5);
const cb = await pubCard("Carte fond de page");
ok("I2e public : la carte « fond de page » prend le fond du SITE", near(rgbOf(cb?.bg ?? ""), hexRgb(NEW_BG)), JSON.stringify(cb));
const cl = await pubCard("Carte couleur libre");
ok("I2f public : couleur libre telle quelle", near(rgbOf(cl?.bg ?? ""), hexRgb(FREE)), JSON.stringify(cl));
ok("I2g public : feuille de la palette du site présente", /<style id="site-palette"/.test(html));

const logoH = () => pp.evaluate(() => document.querySelector(".site-header .site-brand").getBoundingClientRect().height);
const top = await logoH();
await pp.evaluate(() => document.querySelector(".surface-card h2, .surface-card h1, .surface-card h3").scrollIntoView({ block: "start", behavior: "instant" }));
await sleep(900);
const small = await logoH();
ok("I3a logo : grand en haut (≈ 120 px) puis réduit au défilement", top > 100 && small < top - 10 && small >= 24, `${top} → ${small}`);
const img = await pp.evaluate(() => {
  const i = document.querySelector("img[data-cropped]");
  return i ? { src: i.currentSrc || i.src, cropped: true, srcset: i.getAttribute("srcset") ?? "" } : null;
});
const srcs = await pp.evaluate(() => [...document.querySelectorAll("picture source, img")].map((e) => e.getAttribute("srcset") ?? e.getAttribute("src") ?? "").join(" "));
ok("I3b image en recadrage libre : variantes /media/crop/", Boolean(img) && /\/media\/crop\//.test(srcs), JSON.stringify(img));
await pp.evaluate(() => document.querySelector("img[data-cropped]")?.scrollIntoView({ block: "center", behavior: "instant" }));
await sleep(900);
await pp.screenshot({ path: `${SHOTS}/integ-carte-palette-logo-recadrage-1440.png` });
await pp.evaluate(() => document.querySelector(".surface-card")?.scrollIntoView({ block: "start", behavior: "instant" }));
await sleep(900);
await pp.screenshot({ path: `${SHOTS}/integ-cartes-1440.png` });
await pp.evaluate(() => scrollTo(0, 0));
await sleep(700);
await pp.screenshot({ path: `${SHOTS}/integ-haut-1440.png` });

/* ---- I4. Sans palette du site : palette du thème -------------------------------------------------- */
await page.getByRole("button", { name: "Revenir aux couleurs du thème" }).click();
await settled();
await page.getByRole("button", { name: "Publier", exact: true }).click();
ok("I4a republication", await waitFor(async () => /En ligne/.test((await page.locator(".ve-status").textContent()) ?? ""), 120000));
await pp.goto(`${BASE}/fr/a-propos`, { waitUntil: "networkidle" });
const cp2 = await pubCard("Carte couleur principale");
ok("I4b sans palette du site : la carte « primary » retrouve la couleur du thème", cp2 && !near(rgbOf(cp2.bg), hexRgb(NEW_PRIMARY)), JSON.stringify(cp2));
await pub.close();

ok("aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures === 0 ? "TOUT VERT" : `${failures} échec(s)`);
process.exit(failures === 0 ? 0 : 1);
