#!/usr/bin/env node
/**
 * Lot 17d, de bout en bout (chromium, serveur dev requis + une connexion admin, base de test) :
 *  L  mise en page : une planche de 4 personnages posée DEUX fois (blocs) et deux fois dans une grille, chaque
 *     fois avec un recadrage libre différent : chaque cadre prend le rapport de son rectangle, montre le bon
 *     personnage (pixels de la variante servie), netteté (largeur de la variante / pixels affichés × DPR) ≥ 1 ;
 *     portrait haut plafonné à 85 vh sans rognage, centré ; panorama pleine largeur entier (aucun rognage haut/bas) ;
 *     option « Image entière / Remplir le cadre » ; décors dans une grille en 4:5 (ancien cadrage zoom 150 % et
 *     décor sans cadrage) servis nets.
 *  R  route publique en lecture seule : variante servie avec en-têtes de cache ; signature modifiée, autre
 *     rectangle, autre média, largeur hors liste, format inconnu, remontée de dossier, méthode d'écriture : refusés,
 *     rien écrit sur le disque.
 *  D  modale « Cadrer l'image » dans l'éditeur : « Libre » par défaut, poignées, formats rapides (1:1), enregistrement
 *     par emplacement, réouverture sur l'image ENTIÈRE avec le rectangle, retour à l'image entière (« Original »).
 *  P  page publiée : variantes recadrées servies, aucun repère d'édition dans le HTML.
 *  X  suppression d'un média : son dossier de variantes recadrées disparaît.
 *  M  petit écran (390 px) : portrait plafonné, panorama entier.
 * BEFORE=1 : sans les recadrages libres (captures « avant » sur l'ancien code).
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=L,R,D,P,X,M] [SHOTS=dossier] node scripts/e2e-crop.mjs
 */
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";
import sharp from "sharp";

import { login, pageIdOf, q1, waitFor } from "./lib/medias-setup.mjs";
import { paint, perso, sheet } from "./lib/crop-fixtures.mjs";

const BASE = process.env.BASE ?? "http://localhost:3103";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const BEFORE = process.env.BEFORE === "1";
const TAG = BEFORE ? "avant" : "apres";
const SHOTS = process.env.SHOTS ?? path.join(tmpdir(), "e2e-crop");
const DATA = process.env.DATA_DIR ?? "data";
const DB = path.join(DATA, "portfolio.db");
mkdirSync(SHOTS, { recursive: true });
sharp.cache(false);
sharp.concurrency(1);

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (fn) => {
  const db = new Database(DB);
  db.pragma("busy_timeout = 5000");
  try {
    return fn(db);
  } finally {
    db.close();
  }
};

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);

async function upload(name, buffer) {
  const res = await page.request.post(`${BASE}/admin/api/upload`, { headers: { origin: BASE }, multipart: { file: { name, mimeType: "image/png", buffer } }, timeout: 180000 });
  return res.status();
}
const mediaOf = (name) => q1("select id, status, width, height from media where original_name = ? order by id desc", name);
async function ensure(name, make) {
  if (!mediaOf(name)) await upload(name, await make());
  if (!(await waitFor(() => mediaOf(name)?.status === "ready", 180000))) throw new Error(`${name} : ${JSON.stringify(mediaOf(name))}`);
  return mediaOf(name).id;
}

const SHEET = await ensure("17d-planche.png", sheet);
const PORTRAIT = await ensure("17d-portrait.png", () => paint(1200, 2400, 4));
const PANO = await ensure("17d-pano.png", () => paint(10000, 2500, 1));
const pageId = pageIdOf("personnages");

/** Quatre personnages de la planche (moitiés) et un sous-rectangle serré. */
const P1 = { x: 0, y: 0, w: 0.5, h: 0.5 }; // rouge, 2:1
const P3 = { x: 0, y: 0.5, w: 0.5, h: 0.5 }; // bleu, 2:1
const P2 = { x: 0.52, y: 0.04, w: 0.44, h: 0.42 }; // vert, 2112 × 1008
const P4 = { x: 0.55, y: 0.54, w: 0.2, h: 0.4 }; // jaune, haut (960 × 960 → carré)
const img = (uid, mediaId, props = {}, crop) => ({ uid, type: "image", props: { mediaId, width: "wide", ...props, ...(crop ? { look: { crop: { mediaId: crop } } } : {}) } });
const rectCrop = (rect) => ({ x: 50, y: 50, zoom: 1, rect });

function setDraft(blocks) {
  sql((db) => {
    const row = db.prepare("select title, slug, meta, nav_order from pages where id = ?").get(pageId);
    const draft = {
      title: JSON.parse(row.title),
      slug: JSON.parse(row.slug),
      meta: row.meta ? JSON.parse(row.meta) : { title: { fr: "", en: "" }, description: { fr: "", en: "" } },
      published: true,
      inMenu: row.nav_order !== null,
      accent: null,
      blocks,
    };
    db.prepare("update pages set draft = ?, draft_updated_at = unixepoch(), draft_rev = draft_rev + 1 where id = ?").run(JSON.stringify(draft), pageId);
  });
}

const LAYOUT = [
  // Même planche, deux placements, deux recadrages libres (un personnage à la fois).
  ...(BEFORE ? [] : [img("a-rouge", SHEET, {}, rectCrop(P1)), img("a-bleu", SHEET, {}, rectCrop(P3))]),
  ...(BEFORE ? [] : [{
    uid: "g-persos",
    type: "grid",
    props: { layout: "2", gap: "normal", align: "stretch", ratio: "auto", top: "gap", children: [img("c-vert", SHEET, {}, rectCrop(P2)), img("c-jaune", SHEET, {}, rectCrop(P4))] },
  }]),
  img("b-portrait", PORTRAIT),
  img("b-pano-plein", PANO, { width: "full" }),
  img("b-pano-169", PANO, { width: "full", ratio: "16:9" }),
  img("b-pano-169-cover", PANO, { width: "full", ratio: "16:9", fit: "cover" }),
  {
    uid: "g-decors",
    type: "grid",
    props: { layout: "3", gap: "normal", align: "stretch", ratio: "4:5", top: "gap", children: [img("d1", PANO, {}, { x: 50, y: 50, zoom: 1.5 }), img("d2", PANO), img("d3", PORTRAIT)] },
  },
];
setDraft(LAYOUT);

async function openToile(p = page) {
  const toile = await ctx.request.get(`${BASE}/admin/api/editeur/toile?page=${pageId}&langue=fr`, { headers: { origin: BASE }, maxRedirects: 0 });
  await p.goto(BASE + (toile.headers().location ?? "/fr"), { waitUntil: "networkidle" });
}
/** Charge toutes les images paresseuses de la page. */
async function loadAll(p) {
  await p.evaluate(() => document.querySelectorAll("img").forEach((i) => (i.loading = "eager")));
  await p.waitForFunction(() => [...document.querySelectorAll("img")].every((i) => i.complete), null, { timeout: 120000 });
  await sleep(300);
}
const imgInfo = (p, sel) =>
  p.locator(sel).first().evaluate((i) => {
    const r = i.getBoundingClientRect();
    const px = Number(/\/(\d+)\.(?:avif|webp)$/.exec(i.currentSrc)?.[1] ?? 0);
    const options = [...i.parentElement.querySelectorAll("source[type='image/webp']")].flatMap((s) => (s.srcset || "").split(",").map((x) => Number(/(\d+)w/.exec(x)?.[1] ?? 0)));
    const cs = getComputedStyle(i);
    return { w: r.width, h: r.height, x: r.x, src: i.currentSrc, px, best: Math.max(0, ...options), fit: cs.objectFit, nat: [i.naturalWidth, i.naturalHeight], dpr: devicePixelRatio, vw: innerWidth, vh: innerHeight, cropped: i.hasAttribute("data-cropped"), attr: [i.getAttribute("width"), i.getAttribute("height")] };
  });
const blockImg = (uid) => `[data-edit-block="${uid}"] img.block-image-media`;

/* ---- L : mise en page ------------------------------------------------------------------ */
if (run("L")) {
  await openToile();
  console.log(`  toile : ${page.url()} — ${await page.locator("[data-edit-block]").count()} blocs`);
  await loadAll(page);
  if (!BEFORE) {
    const near = (a, b, tol = 0.02) => Math.abs(a / b - 1) < tol;
    const cases = [
      ["a-rouge", "red", P1, 4800 * P1.w, 2400 * P1.h],
      ["a-bleu", "blue", P3, 4800 * P3.w, 2400 * P3.h],
      ["c-vert", "green", P2, 4800 * P2.w, 2400 * P2.h],
      ["c-jaune", "yellow", P4, 4800 * P4.w, 2400 * P4.h],
    ];
    const srcs = new Set();
    for (const [uid, color, , pw, ph] of cases) {
      await page.locator(blockImg(uid)).scrollIntoViewIfNeeded();
      await sleep(200);
      const m = await imgInfo(page, blockImg(uid));
      ok(`L ${uid} : le cadre prend le rapport du recadrage (${(pw / ph).toFixed(2)})`, near(m.w / m.h, pw / ph, 0.015), `${Math.round(m.w)} × ${Math.round(m.h)}`);
      ok(`L ${uid} : variante recadrée servie (extraite de l'original)`, /\/media\/crop\/\d+\/x\d+y\d+w\d+h\d+-[0-9a-f]{20}\/\d+\.(avif|webp)$/.test(m.src) && m.cropped, m.src);
      srcs.add(m.src.replace(/\/\d+\.(avif|webp)$/, ""));
      const body = await (await page.request.get(m.src)).body();
      const got = await perso(body);
      const meta = await sharp(body).metadata();
      ok(`L ${uid} : montre le personnage ${color} (et lui seul)`, got === color, `${got}, ${meta.width}×${meta.height}`);
      const needed = m.w * m.dpr;
      ok(`L ${uid} : netteté ≥ 1 (variante ${m.px} px pour ${Math.round(needed)} px affichés × DPR, plus grande ${m.best})`, m.px >= Math.min(needed, m.best) * 0.99, `${(m.px / needed).toFixed(2)}`);
      if (uid === "a-rouge" || uid === "c-vert") ok(`L ${uid} : netteté pleine tant que l'original a assez de pixels (${m.px} ≥ ${Math.round(needed)})`, m.px >= needed * 0.99 || m.px >= pw * 0.99, `${m.px} / ${Math.round(needed)}`);
    }
    ok("L même image posée 4 fois : 4 recadrages différents (4 rectangles distincts)", srcs.size === 4, String(srcs.size));
    const rows = await page.evaluate(() => [...document.querySelectorAll('[data-edit-block="g-persos"] .block-grid-cell img')].map((i) => { const r = i.getBoundingClientRect(); return { top: Math.round(r.top + scrollY), h: Math.round(r.height), w: Math.round(r.width) }; }));
    ok("L grille : cases au rapport de leur recadrage, alignées en haut de la rangée", rows.length === 2 && Math.abs(rows[0].top - rows[1].top) <= 1 && rows[0].h !== rows[1].h, JSON.stringify(rows));
    const g = await page.locator('[data-edit-block="g-persos"]').first().boundingBox();
    await page.screenshot({ path: `${SHOTS}/L-grille-persos-${TAG}.png`, clip: { x: 0, y: g.y - 10, width: 1440, height: Math.min(900, g.height + 20) }, fullPage: true });
    const a = await page.locator('[data-edit-block="a-rouge"]').first().boundingBox();
    await page.screenshot({ path: `${SHOTS}/L-deux-placements-${TAG}.png`, clip: { x: 0, y: a.y - 10, width: 1440, height: 900 }, fullPage: true });
  }

  // Portrait haut : plafonné à 85 % de la hauteur de l'écran, réduit et centré, jamais rogné.
  await page.locator(blockImg("b-portrait")).scrollIntoViewIfNeeded();
  let m = await imgInfo(page, blockImg("b-portrait"));
  const fig = await page.locator('[data-edit-block="b-portrait"]').first().boundingBox();
  console.log(`  portrait 1:2 : ${Math.round(m.w)} × ${Math.round(m.h)} (écran ${m.vh}, plafond ${Math.round(m.vh * 0.85)})`);
  if (BEFORE) ok("L (avant) portrait : dépasse l'écran", m.h > m.vh, `${Math.round(m.h)}`);
  else {
    ok("L portrait haut : hauteur ≤ 85 % de l'écran", m.h <= m.vh * 0.85 + 1, `${Math.round(m.h)} / ${Math.round(m.vh * 0.85)}`);
    ok("L portrait haut : proportions intactes (rien de rogné ni d'étiré)", Math.abs(m.w / m.h - 0.5) < 0.01, `${(m.w / m.h).toFixed(3)}`);
    ok("L portrait haut : centré dans la page", Math.abs(m.x + m.w / 2 - 720) < 3, `${Math.round(m.x + m.w / 2)}`);
  }
  await page.screenshot({ path: `${SHOTS}/L-portrait-${TAG}.png`, clip: { x: 0, y: Math.max(0, fig.y - 20), width: 1440, height: 1000 }, fullPage: true });

  // Panorama pleine largeur : entier (largeur de la page, hauteur naturelle).
  await page.locator(blockImg("b-pano-plein")).scrollIntoViewIfNeeded();
  m = await imgInfo(page, blockImg("b-pano-plein"));
  ok("L panorama pleine largeur : largeur de la page, hauteur naturelle (4:1), aucun rognage haut/bas", Math.abs(m.w - m.vw) <= 1 && Math.abs(m.w / m.h - 4) < 0.02, `${Math.round(m.w)} × ${Math.round(m.h)}`);
  ok("L panorama pleine largeur : variante nette", m.px >= Math.min(m.w * m.dpr, m.best) * 0.99, `${m.px} px pour ${Math.round(m.w * m.dpr)}`);
  const pf = await page.locator('[data-edit-block="b-pano-plein"]').first().boundingBox();
  await page.screenshot({ path: `${SHOTS}/L-panorama-plein-${TAG}.png`, clip: { x: 0, y: Math.max(0, pf.y - 20), width: 1440, height: Math.min(700, pf.height + 40) }, fullPage: true });

  // Pleine largeur avec un format imposé : « Image entière » par défaut (bandes vides), « Remplir le cadre » rogne.
  await page.locator(blockImg("b-pano-169")).scrollIntoViewIfNeeded();
  m = await imgInfo(page, blockImg("b-pano-169"));
  ok("L pleine largeur + 16:9 : « Image entière » par défaut (object-fit: contain, cadre 16:9)", m.fit === "contain" && Math.abs(m.w / m.h - 16 / 9) < 0.02, `${m.fit} ${(m.w / m.h).toFixed(2)}`);
  const p169 = await page.locator('[data-edit-block="b-pano-169"]').first().boundingBox();
  await page.screenshot({ path: `${SHOTS}/L-pano-169-entier-${TAG}.png`, clip: { x: 0, y: Math.max(0, p169.y - 20), width: 1440, height: Math.min(900, p169.height + 40) }, fullPage: true });
  await page.locator(blockImg("b-pano-169-cover")).scrollIntoViewIfNeeded();
  m = await imgInfo(page, blockImg("b-pano-169-cover"));
  ok("L pleine largeur + 16:9 + « Remplir le cadre » : rogné (cover)", m.fit === "cover" && Math.abs(m.w / m.h - 16 / 9) < 0.02, `${m.fit} ${(m.w / m.h).toFixed(2)}`);
  if (!BEFORE) {
    ok("L « Remplir le cadre » : variante recadrée au rapport du cadre (fenêtre centrée, nette)", m.cropped && m.px >= Math.min(m.w * m.dpr, m.best) * 0.99, `${m.px} px pour ${Math.round(m.w * m.dpr)}, ${m.src}`);
  }

  // Décors dans une grille en 4:5 : cadrage ancien (zoom 150 %) et décor sans cadrage, nets.
  const grid = page.locator('[data-edit-block="g-decors"]').first();
  await grid.scrollIntoViewIfNeeded();
  for (const [uid, label] of [["d1", "décor cadré (zoom 150 %)"], ["d2", "décor sans cadrage"]]) {
    m = await imgInfo(page, blockImg(uid));
    const needed = m.w * m.dpr;
    // Le panorama 10000 × 2500 donne 1333 px de large pour la fenêtre zoomée, 2000 px pour la centrée : plus que les ~780 px nécessaires.
    ok(`L ${label} dans une case 4:5 : netteté ≥ 1 (variante ${m.px} px pour ${Math.round(needed)} px)`, m.px >= needed * 0.99, `${(m.px / needed).toFixed(2)} (BEFORE=0,49 avec zoom)`);
    ok(`L ${label} : case 4:5 respectée`, Math.abs(m.w / m.h - 0.8) < 0.02, `${(m.w / m.h).toFixed(3)}`);
  }
  const gb = await grid.boundingBox();
  await page.screenshot({ path: `${SHOTS}/L-decors-grille-${TAG}.png`, clip: { x: 0, y: Math.max(0, gb.y - 20), width: 1440, height: Math.min(900, gb.height + 40) }, fullPage: true });
}

/* ---- R : route publique ---------------------------------------------------------------- */
if (run("R") && !BEFORE) {
  await openToile();
  await loadAll(page);
  const good = await page.locator(blockImg("a-rouge")).first().evaluate((i) => i.currentSrc);
  const url = new URL(good);
  const abs = (p) => BASE + p;
  const cacheDir = path.join(DATA, "cache", "crops");
  const filesNow = () => (existsSync(cacheDir) ? readdirSync(cacheDir, { recursive: true }).length : 0);
  const anon = await browser.newContext(); // sans cookies : visiteur
  const get = async (p, method = "GET") => anon.request.fetch(abs(p), { method, maxRedirects: 0, failOnStatusCode: false });
  const r0 = await get(url.pathname);
  ok("R variante signée servie à un visiteur, en lecture seule (200, image, cache d'un an immuable)", r0.status() === 200 && /^image\/(avif|webp)$/.test(r0.headers()["content-type"] ?? "") && /immutable/.test(r0.headers()["cache-control"] ?? "") && /max-age=31536000/.test(r0.headers()["cache-control"] ?? ""), `${r0.status()} ${r0.headers()["content-type"]} ${r0.headers()["cache-control"]}`);
  ok("R HEAD sans corps, mêmes en-têtes", (await get(url.pathname, "HEAD")).status() === 200);
  const parts = /^(\/media\/crop\/)(\d+)\/(x\d+y\d+w\d+h\d+)-([0-9a-f]{20})\/(\d+)\.(avif|webp)$/.exec(url.pathname);
  const [, base, id, rect, sig, width, fmt] = parts;
  const flip = (s) => s.slice(0, -1) + (s.endsWith("0") ? "1" : "0");
  const before = filesNow();
  const bad = {
    "signature modifiée": `${base}${id}/${rect}-${flip(sig)}/${width}.${fmt}`,
    "signature d'un autre rectangle": `${base}${id}/x1y1w5000h5000-${sig}/${width}.${fmt}`,
    "rectangle jamais écrit, signature inventée": `${base}${id}/x0y0w10000h10000-${"0".repeat(20)}/960.${fmt}`,
    "autre média, même signature": `${base}${Number(id) + 1}/${rect}-${sig}/${width}.${fmt}`,
    "média inexistant": `${base}99999/${rect}-${sig}/${width}.${fmt}`,
    "largeur hors liste (signature valide)": `${base}${id}/${rect}-${sig}/1234.${fmt}`,
    "largeur énorme": `${base}${id}/${rect}-${sig}/9000.${fmt}`,
    "format inconnu": `${base}${id}/${rect}-${sig}/${width}.gif`,
    "remontée de dossier": `${base}${id}/${rect}-${sig}/..%2F..%2F${width}.${fmt}`,
    "remontée vers les originaux": `/media/crop/..%2Foriginals%2F${q1("select key from media where id = ?", SHEET).key.split("/")[1]}`,
    "rectangle trop petit": `${base}${id}/x0y0w50h50-${sig}/${width}.${fmt}`,
    "segments en trop": `${base}${id}/${rect}-${sig}/${width}.${fmt}/x`,
  };
  for (const [label, p] of Object.entries(bad)) {
    const res = await get(p);
    ok(`R refusé : ${label}`, res.status() === 404, `${res.status()} ${p.slice(0, 80)}`);
  }
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    const res = await get(url.pathname, method);
    ok(`R ${method} refusé (lecture seule)`, res.status() === 405 || res.status() === 404, String(res.status()));
  }
  ok("R l'original reste introuvable", (await get("/media/" + q1("select key from media where id = ?", SHEET).key)).status() === 404);
  ok("R aucune variante écrite par les demandes refusées", filesNow() === before, `${before} → ${filesNow()}`);
  // Variante déjà en cache : 304 sur If-None-Match.
  const etag = r0.headers().etag;
  const r304 = await anon.request.fetch(abs(url.pathname), { headers: { "if-none-match": etag }, failOnStatusCode: false });
  ok("R If-None-Match → 304", r304.status() === 304, String(r304.status()));
  await anon.close();
}

/* ---- M : petit écran ------------------------------------------------------------------- */
if (run("M")) {
  const mob = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  const mp = await mob.newPage();
  await mp.setViewportSize({ width: 390, height: 844 });
  // Cookies du contexte principal (vue brouillon).
  await mob.addCookies(await ctx.cookies());
  const toile = await ctx.request.get(`${BASE}/admin/api/editeur/toile?page=${pageId}&langue=fr`, { headers: { origin: BASE }, maxRedirects: 0 });
  await mob.addCookies(await ctx.cookies());
  await mp.goto(BASE + (toile.headers().location ?? "/fr"), { waitUntil: "networkidle" });
  await loadAll(mp);
  await mp.locator(blockImg("b-portrait")).scrollIntoViewIfNeeded();
  let m = await imgInfo(mp, blockImg("b-portrait"));
  const fig = await mp.locator('[data-edit-block="b-portrait"]').first().boundingBox();
  console.log(`  390 px, portrait 1:2 : ${Math.round(m.w)} × ${Math.round(m.h)} (écran ${m.vh})`);
  if (BEFORE) ok("M (avant) portrait : plus haut que l'écran", m.h > m.vh, `${Math.round(m.h)}`);
  else {
    ok("M portrait 1:2 : au plus 85 % de la hauteur, centré, proportions intactes", m.h <= m.vh * 0.85 + 1 && Math.abs(m.x + m.w / 2 - 195) < 3 && Math.abs(m.w / m.h - 0.5) < 0.01, `${Math.round(m.w)} × ${Math.round(m.h)} @${Math.round(m.x)}`);
  }
  await mp.screenshot({ path: `${SHOTS}/M-portrait-${TAG}.png`, clip: { x: 0, y: Math.max(0, fig.y - 20), width: 390, height: 844 }, fullPage: true });
  await mp.locator(blockImg("b-pano-plein")).scrollIntoViewIfNeeded();
  m = await imgInfo(mp, blockImg("b-pano-plein"));
  ok("M panorama pleine largeur : entier (390 px de large, 4:1)", Math.abs(m.w - 390) <= 1 && Math.abs(m.w / m.h - 4) < 0.02, `${Math.round(m.w)} × ${Math.round(m.h)}`);
  const pf = await mp.locator('[data-edit-block="b-pano-plein"]').first().boundingBox();
  await mp.screenshot({ path: `${SHOTS}/M-panorama-${TAG}.png`, clip: { x: 0, y: Math.max(0, pf.y - 40), width: 390, height: 300 }, fullPage: true });
  if (!BEFORE) {
    await mp.locator('[data-edit-block="a-rouge"]').first().scrollIntoViewIfNeeded();
    const rouge = await imgInfo(mp, blockImg("a-rouge"));
    ok("M recadrage libre sur mobile : rapport 2:1 et variante nette (≥ pixels × DPR 3 ou plus grande)", Math.abs(rouge.w / rouge.h - 2) < 0.03 && rouge.px >= Math.min(rouge.w * 3, rouge.best) * 0.99, `${Math.round(rouge.w)} × ${Math.round(rouge.h)}, ${rouge.px} px`);
    const rb = await mp.locator('[data-edit-block="a-rouge"]').first().boundingBox();
    await mp.screenshot({ path: `${SHOTS}/M-recadrage-${TAG}.png`, clip: { x: 0, y: Math.max(0, rb.y - 20), width: 390, height: 500 }, fullPage: true });
  }
  await mob.close();
}

/* ---- D : modale « Cadrer l'image » dans l'éditeur -------------------------------------- */
let f;
const until = (fr, fn, arg, timeout = 60000) =>
  fr.waitForFunction(fn, arg, { timeout, polling: 200 }).then(
    () => true,
    () => false,
  );
const draftBlock = (uid) => JSON.parse(q1("select draft from pages where id = ?", pageId).draft).blocks.find((b) => b.uid === uid);
async function openEditor() {
  await page.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
  const handle = await page.waitForSelector("iframe.ve-frame", { timeout: 120000 });
  const fr = await handle.contentFrame();
  await fr.waitForSelector("html[data-edit-mode]", { timeout: 180000 });
  return fr;
}
const settled = async () => {
  await page.waitForFunction(() => !/Enregistrement/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, { timeout: 120000 });
  await sleep(500);
};
if (run("D") && !BEFORE) {
  // Un seul bloc image, sans recadrage, pour partir de zéro.
  setDraft([img("e-planche", SHEET), img("e-pano", PANO, { width: "full" })]);
  f = await openEditor();
  await sleep(1500);
  const target = f.locator(blockImg("e-planche")).first();
  await target.scrollIntoViewIfNeeded();
  await target.hover();
  ok("D1 image seule : « Cadrer » au survol (même sans format imposé)", await until(f, () => Boolean(document.querySelector(".lk-crop-btn"))));
  await f.locator(".lk-crop-btn").click();
  ok("D2 la modale s'ouvre en mode Libre : formats rapides et huit poignées", await until(f, () => document.querySelectorAll(".lk-crop [data-handle]").length === 8 && document.querySelectorAll(".lk-crop-formats button").length === 6));
  const formats = await f.locator(".lk-crop-formats button").allInnerTexts();
  ok("D2 formats : Libre, Original, 1:1, 4:5, 3:2, 16:9 ; « Libre » actif", formats.join("|") === "Libre|Original|1:1|4:5|3:2|16:9" && (await f.locator('.lk-crop-formats button[data-format="libre"]').getAttribute("aria-pressed")) === "true", formats.join("|"));
  const stageBg = await f.locator("[data-testid=crop-stage]").evaluate((e) => e.style.backgroundImage);
  ok("D2 la modale montre l'image ENTIÈRE", /\/media\/img\//.test(stageBg), stageBg.slice(0, 80));
  await page.screenshot({ path: `${SHOTS}/D-modale-libre-${TAG}.png` });
  const rectOf = async () => (await f.locator("[data-testid=crop-window]").getAttribute("data-rect")).split(",").map(Number);
  const handle = async (h) => (await f.locator(`.lk-crop [data-handle="${h}"]`).boundingBox());
  const drag = async (h, dx, dy) => {
    const b = await handle(h);
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + dx / 2, cy + dy / 2, { steps: 4 });
    await page.mouse.move(cx + dx, cy + dy, { steps: 4 });
    await page.mouse.up();
    await sleep(150);
  };
  const full = await rectOf();
  ok("D3 départ : le rectangle couvre l'image", full[2] > 0.99 && full[3] > 0.99, full.join());
  const stage = await f.locator("[data-testid=crop-stage]").boundingBox();
  await drag("se", -stage.width * 0.4, -stage.height * 0.3);
  const r1 = await rectOf();
  ok("D3 poignée du coin : rectangle quelconque (largeur et hauteur changent indépendamment)", Math.abs(r1[2] - 0.6) < 0.03 && Math.abs(r1[3] - 0.7) < 0.03, r1.join());
  await drag("w", stage.width * 0.1, 0);
  const r2 = await rectOf();
  ok("D3 poignée d'un bord : seul ce bord bouge", Math.abs(r2[0] - 0.1) < 0.03 && Math.abs(r2[2] - 0.5) < 0.03 && Math.abs(r2[3] - r1[3]) < 0.005, r2.join());
  const wb = await f.locator("[data-testid=crop-window]").boundingBox();
  await page.mouse.move(wb.x + wb.width / 2, wb.y + wb.height / 2);
  await page.mouse.down();
  await page.mouse.move(wb.x + wb.width / 2 + 30, wb.y + wb.height / 2 + 20, { steps: 5 });
  await page.mouse.up();
  await sleep(150);
  const r3 = await rectOf();
  ok("D3 glisser dedans : le rectangle se déplace sans changer de taille", r3[0] > r2[0] && r3[1] > r2[1] && Math.abs(r3[2] - r2[2]) < 0.002 && Math.abs(r3[3] - r2[3]) < 0.002, r3.join());
  await f.locator('.lk-crop-formats button[data-format="1:1"]').click();
  await sleep(200);
  const r4 = await rectOf();
  ok("D4 format 1:1 : le rectangle devient carré en pixels (4800 × 2400)", Math.abs((r4[2] * 4800) / (r4[3] * 2400) - 1) < 0.01, r4.join());
  ok("D4 format verrouillé : seuls les coins gardent leur poignée", (await f.locator(".lk-crop [data-handle]").count()) === 4);
  const size = await f.locator("[data-testid=crop-size]").innerText();
  ok("D4 taille affichée en pixels de l'original", /^(\d+) × \1 px/.test(size), size);
  await drag("nw", 20, 20);
  const r5 = await rectOf();
  ok("D4 coin tiré avec le format verrouillé : reste carré", Math.abs((r5[2] * 4800) / (r5[3] * 2400) - 1) < 0.01, r5.join());
  await f.getByRole("button", { name: "Enregistrer le cadrage" }).click();
  await settled();
  ok("D5 recadrage enregistré par emplacement : rectangle normalisé dans le bloc", await waitFor(() => draftBlock("e-planche")?.props.look?.crop?.mediaId?.rect, 60000));
  const saved = draftBlock("e-planche").props.look.crop.mediaId;
  ok("D5 rectangle valide, carré en pixels, précision 1/10000", Math.abs((saved.rect.w * 4800) / (saved.rect.h * 2400) - 1) < 0.01 && saved.rect.w <= 1 && saved.rect.x + saved.rect.w <= 1.0001, JSON.stringify(saved));
  ok("D5 le bloc voisin (autre image) n'est pas touché", !draftBlock("e-pano").props.look);
  ok("D6 la toile affiche la variante recadrée, cadre carré", await until(f, () => { const i = document.querySelector('[data-edit-block="e-planche"] img.block-image-media'); const r = i?.getBoundingClientRect(); return Boolean(i) && /\/media\/crop\//.test(i.currentSrc) && Math.abs(r.width / r.height - 1) < 0.02; }));
  await f.locator(blockImg("e-planche")).first().hover();
  await until(f, () => Boolean(document.querySelector(".lk-crop-btn")));
  ok("D7 le bouton devient « Recadrer »", (await f.locator(".lk-crop-btn").innerText()) === "Recadrer");
  await f.locator(".lk-crop-btn").click();
  await f.locator("[data-testid=crop-window]").waitFor();
  const again = await rectOf();
  const bg2 = await f.locator("[data-testid=crop-stage]").evaluate((e) => e.style.backgroundImage);
  ok("D7 réouverture : l'image ENTIÈRE avec le rectangle enregistré", /\/media\/img\//.test(bg2) && !/\/media\/crop\//.test(bg2) && Math.abs(again[0] - saved.rect.x) < 0.001 && Math.abs(again[2] - saved.rect.w) < 0.001, `${bg2.slice(0, 60)} ${again.join()}`);
  await page.screenshot({ path: `${SHOTS}/D-modale-reouverte-${TAG}.png` });
  await f.locator('.lk-crop-formats button[data-format="original"]').click();
  await f.getByRole("button", { name: "Enregistrer le cadrage" }).click();
  await settled();
  ok("D8 « Original » : recadrage retiré du bloc", await waitFor(() => !draftBlock("e-planche")?.props.look?.crop, 60000));
  ok("D8 la toile revient à l'image entière", await until(f, () => { const i = document.querySelector('[data-edit-block="e-planche"] img.block-image-media'); return Boolean(i) && /\/media\/img\//.test(i.currentSrc); }));
  // Échap ferme sans enregistrer.
  await f.locator(blockImg("e-planche")).first().hover();
  await until(f, () => Boolean(document.querySelector(".lk-crop-btn")));
  await f.locator(".lk-crop-btn").click();
  await f.locator("[data-testid=crop-window]").waitFor();
  await page.keyboard.press("Escape");
  ok("D9 Échap ferme la modale sans rien enregistrer", (await f.locator(".lk-crop").count()) === 0 && !draftBlock("e-planche")?.props.look);
}

/* ---- P : page publiée ------------------------------------------------------------------ */
if (run("P") && !BEFORE) {
  setDraft(LAYOUT);
  f = await openEditor();
  await sleep(1000);
  await settled();
  await page.getByRole("button", { name: "Publier", exact: true }).click();
  const published = await waitFor(async () => /Publié/.test((await page.locator(".ve-status").textContent()) ?? ""), 120000);
  ok("P page publiée", published);
  const pub = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  const pp = await pub.newPage();
  const failed = [];
  pp.on("response", (r) => r.url().includes("/media/") && r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`));
  await pp.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
  await loadAll(pp);
  const crops = await pp.evaluate(() => [...document.querySelectorAll("img[data-cropped]")].map((i) => ({ src: i.currentSrc, w: i.getBoundingClientRect().width, h: i.getBoundingClientRect().height })));
  ok("P public : les images recadrées sont des variantes extraites (4 libres + grille de décors)", crops.filter((c) => /\/media\/crop\//.test(c.src)).length >= 6, JSON.stringify(crops.map((c) => c.src.split("/").slice(-3, -1).join("/"))));
  ok("P public : aucune variante en erreur", failed.length === 0, failed.join(" | "));
  const html = await pp.content();
  ok("P public : aucun repère d'édition (data-full-src, data-edit-box…)", !/data-full-src|data-edit-box|data-full-ratio/.test(html));
  const rouge = crops[0];
  ok("P public : premier recadrage au rapport 2:1", Math.abs(rouge.w / rouge.h - 2) < 0.03, `${Math.round(rouge.w)} × ${Math.round(rouge.h)}`);
  await pub.close();
}

/* ---- X : suppression d'un média ----------------------------------------------------- */
if (run("X") && !BEFORE) {
  const name = "17d-jetable.png";
  const id = await ensure(name, () => paint(1600, 1000, 7));
  setDraft([...LAYOUT, img("x-jetable", id, {}, rectCrop({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 }))]);
  await openToile();
  await loadAll(page);
  const src = await page.locator(blockImg("x-jetable")).first().evaluate((i) => i.currentSrc);
  const dir = path.join(DATA, "cache", "crops", String(id));
  ok("X une variante recadrée existe sur le disque pour ce média", src.includes(`/crop/${id}/`) && existsSync(dir) && readdirSync(dir, { recursive: true }).length > 0, src);
  setDraft(LAYOUT);
  await page.goto(`${BASE}/admin/medias`, { waitUntil: "networkidle" });
  await page.locator(`button.a-media-tile[title="${name}"]`).first().click();
  await page.getByRole("button", { name: "Supprimer l'image" }).click();
  await page.locator("dialog[open]").getByRole("button", { name: "Supprimer", exact: true }).click();
  ok("X média supprimé", await waitFor(() => !mediaOf(name), 30000));
  ok("X son dossier de variantes recadrées est purgé", await waitFor(() => !existsSync(dir), 15000));
}

ok("aucune erreur JavaScript de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
