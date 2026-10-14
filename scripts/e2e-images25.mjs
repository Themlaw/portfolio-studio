#!/usr/bin/env node
/**
 * Lot 25 « images » (chromium, serveur requis, base neuve, une connexion admin).
 *  F  Formats unifiés : UNE liste (Libre, Carré 1:1, Portrait 3:4, Portrait 2:3, Paysage 4:3, Paysage 3:2, Panoramique 2:1,
 *     Panoramique 21:9) pour l'image ; un cadrage libre met à jour le Format affiché (ratio détecté ou « Libre »),
 *     un format choisi remplace le cadrage libre ; un ancien format (16:9) reste valide et affiché.
 *  P  Sélecteur d'images : image ENTIÈRE (object-fit: contain), nom sous chaque vignette, recherche par nom.
 *  M  Onglet Médias : vignettes nommées et cliquables (poser dans le bloc sélectionné, sinon aperçu).
 *  B  Planche sur la toile : bouton « Ajouter des images » (sélecteur de fichiers, ajout à la fin).
 *  G  Case vide de grille : deux choix « Image » / « Vidéo » (sélecteur du bon type, média posé dans la grille).
 *  V  Cadre vide d'une vidéo : petit (pas pleine largeur).
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=F,P,M,B,G,V] [SHOTS=dossier] node scripts/e2e-images25.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";
import sharp from "sharp";

import { paint } from "./lib/crop-fixtures.mjs";
import { login, pageIdOf, q1, waitFor } from "./lib/medias-setup.mjs";

const BASE = process.env.BASE ?? "http://localhost:3330";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(tmpdir(), "e2e-images25");
const DATA = process.env.DATA_DIR ?? "data";
const DB = path.join(DATA, "portfolio.db");
mkdirSync(SHOTS, { recursive: true });
sharp.cache(false);
sharp.concurrency(1);

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
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
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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
const A = await ensure("25-paysage.png", () => paint(1500, 1000, 1));
const B = await ensure("25-portrait.png", () => paint(1000, 1500, 2));
const C = await ensure("25-carre.png", () => paint(1200, 1200, 3));
const pageId = pageIdOf("personnages");
const project = q1("select slug from projects order by id limit 1")?.slug;

const img = (uid, mediaId, props = {}, rect) => ({ uid, type: "image", props: { mediaId, width: "wide", ...props, ...(rect ? { look: { crop: { mediaId: { x: 50, y: 50, zoom: 1, rect } } } } : {}) } });
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
const draftBlocks = () => JSON.parse(sql((db) => db.prepare("select draft from pages where id = ?").get(pageId)).draft).blocks;
const find = (list, uid) => {
  for (const b of list) {
    if (b.uid === uid) return b;
    const inner = find(b.props?.children ?? [], uid);
    if (inner) return inner;
  }
  return null;
};

setDraft([
  img("i-plain", A),
  img("i-3x2", A, {}, { x: 0, y: 0, w: 0.5, h: 0.5 }),
  img("i-odd", A, {}, { x: 0, y: 0, w: 0.6, h: 0.8 }),
  img("i-old", A, { ratio: "16:9" }),
  { uid: "grid1", type: "grid", props: { layout: "2", gap: "normal", align: "stretch", ratio: "auto", top: "gap", children: [] } },
  { uid: "vid1", type: "video-single", props: { variant: "card", mode: "player" } },
  ...(project ? [{ uid: "board1", type: "project-board", props: { project } }] : []),
]);

async function canvas() {
  const handle = await page.waitForSelector("iframe.ve-frame", { timeout: 120000 });
  const fr = await handle.contentFrame();
  await fr.waitForSelector("html[data-edit-mode]", { timeout: 180000 });
  return fr;
}
async function openEditor() {
  await page.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
  const fr = await canvas();
  await sleep(2000);
  return fr;
}
async function settled() {
  await page.waitForFunction(() => !/Enregistrement/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, { timeout: 120000 });
  await sleep(500);
}
const tab = (id) => page.locator(`#ve-tab-${id}`).click();
async function pick(fr, uid) {
  const el = fr.locator(`[data-edit-block="${uid}"] img, [data-edit-block="${uid}"] .pe-media-empty`).first();
  await el.scrollIntoViewIfNeeded();
  await el.click();
  await sleep(500);
}
const formatSelect = () => page.getByLabel("Format", { exact: true });
const section = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 2).join(" "));
    await page.screenshot({ path: path.join(SHOTS, `erreur-${name}.png`) }).catch(() => {});
  }
};

let f = await openEditor();

/* ---- F. Formats unifiés -------------------------------------------------------------------------------------------- */
if (run("F"))
  await section("F", async () => {
    await pick(f, "i-plain");
    await tab("reglages");
    const sel = formatSelect();
    await sel.waitFor({ timeout: 30000 });
    const labels = await sel.locator("option").allInnerTexts();
    ok("F1 la liste de formats de l'image", labels.join("|") === "Libre|Carré 1:1|Portrait 3:4|Portrait 2:3|Paysage 4:3|Paysage 3:2|Panoramique 2:1|Panoramique 21:9", labels.join("|"));
    ok("F1 sans cadrage ni format : « Libre »", (await sel.inputValue()) === "auto");
    await page.screenshot({ path: path.join(SHOTS, "f1-formats.png") });

    await pick(f, "i-3x2");
    ok("F2 un cadrage libre de rapport 3:2 : Format affiché « Paysage 3:2 »", await waitFor(async () => (await formatSelect().inputValue()) === "3:2", 15000), await formatSelect().inputValue());
    await pick(f, "i-odd");
    ok("F3 un cadrage libre sans format de la liste : « Libre »", await waitFor(async () => (await formatSelect().inputValue()) === "auto", 15000));
    ok("F3 la note indique le rapport détecté", /Cadrage libre en place/.test((await page.locator(".ve-pane").textContent()) ?? ""));

    await pick(f, "i-3x2");
    await formatSelect().selectOption("2:1");
    await settled();
    const b = find(draftBlocks(), "i-3x2");
    ok("F4 choisir un format remplace le cadrage libre (ratio 2:1, plus de rect)", b?.props.ratio === "2:1" && !b.props.look?.crop?.mediaId?.rect, JSON.stringify(b?.props));

    await pick(f, "i-old");
    ok("F5 un ancien format (16:9) reste valide et affiché", await waitFor(async () => (await formatSelect().inputValue()) === "16:9", 15000));
    const r = await f.locator('[data-edit-block="i-old"] .block-image-media').first().evaluate((i) => i.getBoundingClientRect().width / i.getBoundingClientRect().height);
    ok("F5 …et rendu en 16:9", Math.abs(r / (16 / 9) - 1) < 0.03, String(r));
  });

/* ---- P. Sélecteur d'images ----------------------------------------------------------------------------------------- */
if (run("P"))
  await section("P", async () => {
    await pick(f, "i-plain");
    await f.locator('[data-edit-block="i-plain"] img').first().hover();
    await f.locator(".pe-media-tools button", { hasText: "Remplacer" }).click();
    const dlg = page.locator("dialog.ve-picker[open]");
    await dlg.waitFor({ timeout: 20000 });
    await page.screenshot({ path: path.join(SHOTS, "p1-selecteur.png") });
    const info = await dlg.evaluate((d) => {
      const imgs = [...d.querySelectorAll(".ve-picker-grid img")];
      return { n: imgs.length, fits: [...new Set(imgs.map((i) => getComputedStyle(i).objectFit))], names: [...d.querySelectorAll(".ve-picker-name")].map((e) => e.textContent), search: Boolean(d.querySelector('input[type="search"]')) };
    });
    ok("P1 images entières (object-fit: contain)", info.n > 0 && info.fits.join() === "contain", JSON.stringify(info.fits));
    ok("P2 le nom sous chaque vignette", info.names.length === info.n && info.names.includes("25-portrait.png"), JSON.stringify(info.names.slice(0, 5)));
    ok("P3 une recherche par nom", info.search);
    await dlg.locator('input[type="search"]').fill("25-port");
    ok("P3 la recherche filtre la grille", await waitFor(async () => (await dlg.locator(".ve-picker-grid li").count()) === 1, 10000));
    await page.screenshot({ path: path.join(SHOTS, "p2-recherche.png") });
    await dlg.locator(".ve-picker-grid button").first().click();
    ok("P4 choisir l'image la pose dans le bloc", await waitFor(async () => { await settled(); return find(draftBlocks(), "i-plain")?.props.mediaId === B; }, 20000));
  });

/* ---- M. Onglet Médias ---------------------------------------------------------------------------------------------- */
if (run("M"))
  await section("M", async () => {
    f = await openEditor();
    await tab("medias");
    const li = page.locator(`.ve-media li[data-media="${C}"]`);
    await li.waitFor({ timeout: 30000 });
    ok("M1 la vignette porte son nom", ((await li.locator(".ve-media-name").textContent()) ?? "").trim() === "25-carre.png");
    ok("M1 image entière (contain)", (await li.locator("img").evaluate((i) => getComputedStyle(i).objectFit)) === "contain");
    await li.click();
    ok("M2 sans bloc pouvant la recevoir : aperçu de l'image", await page.locator('[data-testid="media-preview"] img').waitFor({ timeout: 10000 }).then(() => true, () => false));
    await page.screenshot({ path: path.join(SHOTS, "m1-apercu.png") });
    await page.keyboard.press("Escape");
    await pick(f, "i-3x2");
    await tab("medias");
    await li.click();
    ok("M3 avec une image sélectionnée : la vignette est posée dans le bloc", await waitFor(async () => { await settled(); return find(draftBlocks(), "i-3x2")?.props.mediaId === C; }, 20000));
    await page.locator('.ve-media-search input[type="search"]').fill("25-paysage");
    ok("M4 recherche par nom dans l'onglet", await waitFor(async () => (await page.locator(".ve-media li").count()) === 1, 10000));
  });

/* ---- B. Planche : Ajouter des images ------------------------------------------------------------------------------- */
if (run("B") && project)
  await section("B", async () => {
    f = await openEditor();
    const btn = f.locator('[data-edit-block="board1"] [data-edit-board-add]');
    await btn.scrollIntoViewIfNeeded();
    ok("B1 bouton « Ajouter des images » sur la planche", ((await btn.textContent()) ?? "").trim() === "Ajouter des images" && (await btn.isVisible()));
    await page.screenshot({ path: path.join(SHOTS, "b1-planche.png") });
    const before = await f.locator('[data-edit-block="board1"] [data-edit-slot]').count();
    const file = path.join(tmpdir(), "25-ajout.png");
    writeFileSync(file, await paint(900, 600, 7));
    const chooser = page.waitForEvent("filechooser", { timeout: 20000 });
    await btn.click();
    (await chooser).setFiles(file);
    ok("B2 l'image envoyée s'ajoute à la fin de la planche", await waitFor(async () => (await f.locator('[data-edit-block="board1"] [data-edit-slot]').count()) === before + 1, 180000), `${before} emplacements avant`);
    const last = await f.locator('[data-edit-block="board1"] [data-edit-slot]').last().getAttribute("data-slot-slug");
    ok("B2 …en dernière position", Boolean(last) && (await f.locator('[data-edit-block="board1"] [data-edit-slot]').count()) === before + 1);
    await page.screenshot({ path: path.join(SHOTS, "b2-ajoutee.png") });
  });

/* ---- G. Case vide de grille ---------------------------------------------------------------------------------------- */
if (run("G"))
  await section("G", async () => {
    f = await openEditor();
    const cell = f.locator('[data-edit-block="grid1"] [data-edit-cell-free]').first();
    await cell.scrollIntoViewIfNeeded();
    const labels = await cell.locator("[data-edit-cell-media]").allInnerTexts();
    ok("G1 deux choix clairs : Image, Vidéo", labels.map((l) => l.replace(/[+\s]/g, "")).join("|") === "Image|Vidéo", JSON.stringify(labels));
    await page.screenshot({ path: path.join(SHOTS, "g1-case-vide.png") });
    await cell.locator('[data-edit-cell-media="video"]').click();
    const dlg = page.locator("dialog.ve-picker[open]");
    await dlg.waitFor({ timeout: 20000 });
    ok("G2 « Vidéo » ouvre le choix d'une vidéo (aucune image proposée)", ((await dlg.locator("h2").textContent()) ?? "") === "Choisir une vidéo" && (await dlg.locator(".ve-picker-grid img[src]").count()) === (await dlg.locator(".ve-picker-grid li").count()), await dlg.locator("h2").textContent());
    await dlg.getByRole("button", { name: "Annuler" }).click();
    await cell.locator('[data-edit-cell-media="image"]').click();
    await dlg.waitFor({ timeout: 20000 });
    ok("G3 « Image » ouvre le choix d'une image", ((await dlg.locator("h2").textContent()) ?? "") === "Choisir une image");
    await dlg.getByRole("button", { name: `Choisir 25-carre.png` }).click();
    ok("G4 l'image choisie est posée dans une nouvelle case de la grille", await waitFor(async () => { await settled(); const g = find(draftBlocks(), "grid1"); return g?.props.children.length === 1 && g.props.children[0].type === "image" && g.props.children[0].props.mediaId === C; }, 20000), JSON.stringify(find(draftBlocks(), "grid1")?.props.children));
  });

/* ---- V. Cadre vide d'une vidéo ------------------------------------------------------------------------------------- */
if (run("V"))
  await section("V", async () => {
    f = await openEditor();
    const box = f.locator('[data-edit-block="vid1"] .pe-media-video').first();
    await box.scrollIntoViewIfNeeded();
    const m = await box.evaluate((e) => ({ w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height, parent: e.parentElement.getBoundingClientRect().width }));
    ok("V1 le cadre vide d'une vidéo est petit (≤ 24 rem, pas pleine largeur)", m.w <= 24 * 16 + 1 && m.w < m.parent * 0.6, JSON.stringify(m));
    await page.screenshot({ path: path.join(SHOTS, "v1-cadre-video.png") });
  });

ok("aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `e2e-images25 : ${failures} échec(s)` : "e2e-images25 : OK");
process.exit(failures ? 1 : 0);
