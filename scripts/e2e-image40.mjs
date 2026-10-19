#!/usr/bin/env node
/**
 * Lot 40 « image seule plus grande / centrée, espace entre composants » (chromium, serveur requis, base neuve, une connexion admin).
 *  S  Taille d'une image seule (page) : Normale (plafond d'avant, par défaut) / Grande (toute la largeur du cadre), portrait ET carré ;
 *     Gauche / Centre / Droite ; la légende suit l'image (même bord, largeur max = celle de l'image) ; réglage aussi en haut du panneau ;
 *     une image sans réglage garde exactement ses dimensions d'avant.
 *  G  Espace au-dessus d'un bloc de la page : Aucun / S / Auto (0 px mesuré entre un texte et une image), enregistré dans look.spaceTop.
 *  B  Planche d'un projet : « Taille » et « Espace » dans la barre du composant Image, « Espace » sur la bande ; mêmes mesures.
 *  P  Publication : mêmes rapports en public, téléphone (390 px) sans débordement, image existante inchangée.
 * Les clics sont de vrais clics de souris. Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=S,G,B,P] [SHOTS=dossier] node scripts/e2e-image40.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";
import sharp from "sharp";

import { paint } from "./lib/crop-fixtures.mjs";
import { login, pageIdOf, q1, waitFor } from "./lib/medias-setup.mjs";

const BASE = process.env.BASE ?? "http://localhost:3540";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(process.env.RUNNER_TEMP ?? tmpdir(), "shots-image40");
const DB = path.join(process.env.DATA_DIR ?? "data", "portfolio.db");
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
const mediaOf = (name) => q1("select id, status from media where original_name = ? order by id desc", name);
async function ensure(name, make) {
  if (!mediaOf(name)) await upload(name, await make());
  if (!(await waitFor(() => mediaOf(name)?.status === "ready", 180000))) throw new Error(`${name} : ${JSON.stringify(mediaOf(name))}`);
  return mediaOf(name).id;
}
const PORTRAIT = await ensure("40-portrait.png", () => paint(1000, 1500, 2));
const SQUARE = await ensure("40-carre.png", () => paint(1200, 1200, 3));
const LAND = await ensure("40-paysage.png", () => paint(1500, 1000, 1));
const pageId = pageIdOf("personnages");
const PROJECT = q1("select id, slug from projects order by id limit 1");
if (!PROJECT) throw new Error("aucun projet dans la base de test");

const img = (uid, mediaId, props = {}) => ({ uid, type: "image", props: { mediaId, width: "wide", ...props } });
const text = (uid, t) => ({ uid, type: "rich-text", props: { paragraphs: [{ fr: t, en: t }] } });
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
const lookOfDraft = (uid) => draftBlocks().find((b) => b.uid === uid)?.props.look;
const draftLayout = () => JSON.parse(sql((db) => db.prepare("select coalesce(draft_layout, layout) d from projects where id = ?").get(PROJECT.id)).d ?? "[]");
const lookOfItem = (uid) => draftLayout().find((i) => i.uid === uid)?.props?.look;

const CAPTION = "Légende de l'image de test";
setDraft([
  text("t1", "Un texte avant les images."),
  img("solo", PORTRAIT, { caption: { fr: CAPTION, en: CAPTION } }),
  img("sq", SQUARE),
  img("legacy", PORTRAIT),
  text("t2", "Un texte juste avant une image."),
  img("spaced", LAND),
  { uid: "board1", type: "project-board", props: { project: PROJECT.slug } },
]);
sql((db) => {
  const items = [
    { uid: "bstrip", type: "strip", props: {} },
    { uid: "btxt", type: "rich-text", props: { paragraphs: [{ fr: "Un texte de la planche.", en: "Un texte de la planche." }] } },
    { uid: "bimg", type: "image", props: { mediaId: PORTRAIT, width: "wide", caption: { fr: CAPTION, en: CAPTION } } },
  ];
  db.prepare("update projects set layout = ?, draft_layout = ?, draft_layout_page_id = ? where id = ?").run(JSON.stringify(items), JSON.stringify(items), pageId, PROJECT.id);
});

async function canvas() {
  const handle = await page.waitForSelector("iframe.ve-frame", { timeout: 120000 });
  const fr = await handle.contentFrame();
  await fr.waitForSelector("html[data-edit-mode]", { timeout: 180000 });
  return fr;
}
async function openEditor() {
  await page.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
  const fr = await canvas();
  await sleep(2500);
  return fr;
}
async function settled() {
  await page.waitForFunction(() => !/Enregistrement/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, { timeout: 120000 });
  await sleep(500);
}
const section = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 8).join(" "));
    await page.screenshot({ path: path.join(SHOTS, `erreur-${name}.png`) }).catch(() => {});
  }
};
const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;

/** Mesures d'une image seule dans le document `fr` : figure, image, légende (hôte = sélecteur de la figure). */
const measure = (fr, figSel) =>
  fr.evaluate((s) => {
    const fig = document.querySelector(s);
    if (!fig) return null;
    const m = fig.querySelector(".block-image-media");
    const c = fig.querySelector("figcaption");
    const rf = fig.getBoundingClientRect();
    const rm = m?.getBoundingClientRect();
    const rc = c?.getBoundingClientRect();
    return { fig: { l: rf.left, r: rf.right, w: rf.width, t: rf.top }, img: rm && { l: rm.left, r: rm.right, w: rm.width, h: rm.height, t: rm.top }, cap: rc && { l: rc.left, r: rc.right, w: rc.width, t: rc.top }, size: fig.dataset.size ?? null, align: fig.dataset.align ?? null, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  }, figSel);
/** Écart vertical entre le bas de `aSel` et le haut de `bSel`. */
const gapBetween = (fr, aSel, bSel) =>
  fr.evaluate(([a, b]) => {
    const ea = document.querySelector(a);
    const eb = document.querySelector(b);
    return ea && eb ? eb.getBoundingClientRect().top - ea.getBoundingClientRect().bottom : null;
  }, [aSel, bSel]);

const FIG = (uid) => `[data-edit-block="${uid}"] figure.block-image`;
const BFIG = '[data-edit-bitem="bimg"] figure.block-image';

/** La fenêtre est posée sous le bouton cliqué et au-dessus de lui (intégration v0.26) : le bouton est dans sa largeur, elle commence sous lui. */
async function anchoredUnder(dlg, btn) {
  const d = await dlg.boundingBox();
  const b = await btn.boundingBox();
  const cx = b ? b.x + b.width / 2 : -1;
  return Boolean(d && b && cx >= d.x - 1 && cx <= d.x + d.width + 1 && d.y >= b.y + b.height - 2 && d.y <= b.y + b.height + 40);
}

async function pick(fr, uid) {
  const el = fr.locator(`[data-edit-block="${uid}"] img`).first();
  await el.scrollIntoViewIfNeeded();
  await el.click();
  await sleep(500);
}
/** Ouvre la fenêtre « Taille » ou « Espace » de la barre du bloc `uid` de la page. */
async function openQuick(fr, uid, kind) {
  await pick(fr, uid);
  const dlg = fr.locator(`[data-testid="${kind}-menu"]`);
  if (!(await dlg.isVisible().catch(() => false))) await fr.locator(`.pe-tools [data-testid="${kind}-button"]`).click();
  await dlg.waitFor({ timeout: 15000 });
  return dlg;
}

let f = await openEditor();
// Hauteur de l'écran de la toile (l'iframe de l'éditeur) : le plafond est 85 % de CETTE hauteur ; en public, 900 px.
const H = await f.evaluate(() => window.innerHeight);
const HP = 900;
const base = { solo: await measure(f, FIG("solo")), sq: await measure(f, FIG("sq")), legacy: await measure(f, FIG("legacy")) };

/* ---- S. Taille et alignement -------------------------------------------------------------------------------------- */
if (run("S"))
  await section("S", async () => {
    const cap = 0.85 * H * (2 / 3);
    ok("S0 sans réglage : le portrait est plafonné à 85 % de la hauteur (85 % de la hauteur de la toile × son rapport), centré, aucun attribut de taille", near(base.legacy.img.w, cap, 2) && base.legacy.size === null && base.legacy.align === null && !lookOfDraft("legacy"), JSON.stringify(base.legacy));
    ok("S0 sans réglage : la légende occupe toute la largeur de la figure (comme avant)", near(base.solo.cap.w, base.solo.fig.w, 1), JSON.stringify(base.solo));

    // Portrait : Grande
    const dlg = await openQuick(f, "solo", "size");
    await page.screenshot({ path: path.join(SHOTS, "s0-menu-taille.png") });
    ok("S1 la fenêtre Taille s'ouvre sous le bouton cliqué (pas au bord du bloc)", await anchoredUnder(dlg, f.locator('.pe-tools [data-testid="size-button"]')), JSON.stringify([await dlg.boundingBox(), await f.locator('.pe-tools [data-testid="size-button"]').boundingBox()]));
    ok("S1 la fenêtre propose Normale (choisie) et Grande, et Gauche / Centre / Droite", (await dlg.locator('[data-image-size="normal"]').getAttribute("aria-checked")) === "true" && (await dlg.locator("[data-image-align]").count()) === 3);
    await dlg.locator('[data-image-size="large"]').click();
    let m;
    ok("S2 portrait Grande : l'image prend toute la largeur du cadre", await waitFor(async () => { m = await measure(f, FIG("solo")); return m && m.size === "large" && near(m.img.w, m.fig.w, 1.5) && m.img.w > base.solo.img.w + 100; }, 30000), JSON.stringify(m));
    ok("S2 enregistré : look.imageSize = large", await waitFor(() => lookOfDraft("solo")?.imageSize === "large", 30000), JSON.stringify(lookOfDraft("solo")));
    ok("S2 la légende suit : même largeur que l'image", m && near(m.cap.w, m.img.w, 1.5) && near(m.cap.l, m.img.l, 1.5), JSON.stringify(m));
    ok("S2 les autres images n'ont pas bougé", near((await measure(f, FIG("legacy"))).img.w, base.legacy.img.w, 0.6) && near((await measure(f, FIG("sq"))).img.w, base.sq.img.w, 0.6));
    await page.screenshot({ path: path.join(SHOTS, "s1-portrait-grande.png") });

    // Normale + alignements
    await dlg.locator('[data-image-size="normal"]').click();
    ok("S3 Normale : retour aux dimensions d'avant, réglage retiré", await waitFor(async () => { m = await measure(f, FIG("solo")); return m && near(m.img.w, base.solo.img.w, 0.6) && lookOfDraft("solo")?.imageSize === undefined; }, 30000), JSON.stringify([m, lookOfDraft("solo")]));
    await dlg.locator('[data-image-align="left"]').click();
    ok("S4 Gauche : l'image touche le bord gauche du cadre", await waitFor(async () => { m = await measure(f, FIG("solo")); return m && m.align === "left" && near(m.img.l, m.fig.l, 1.5) && near(m.img.w, base.solo.img.w, 1.5); }, 30000), JSON.stringify(m));
    ok("S4 la légende suit : même bord gauche, largeur max = celle de l'image", m && near(m.cap.l, m.img.l, 1.5) && m.cap.w <= m.img.w + 1.5, JSON.stringify(m));
    ok("S4 enregistré : look.imageAlign = left", await waitFor(() => lookOfDraft("solo")?.imageAlign === "left", 30000));
    await page.screenshot({ path: path.join(SHOTS, "s2-portrait-gauche.png") });
    await dlg.locator('[data-image-align="right"]').click();
    ok("S5 Droite : l'image et sa légende touchent le bord droit", await waitFor(async () => { m = await measure(f, FIG("solo")); return m && m.align === "right" && near(m.img.r, m.fig.r, 1.5) && near(m.cap.r, m.img.r, 1.5); }, 30000), JSON.stringify(m));
    await dlg.locator('[data-image-align="center"]').click();
    ok("S6 Centre : l'image est centrée dans le cadre", await waitFor(async () => { m = await measure(f, FIG("solo")); return m && m.align === "center" && near(m.img.l - m.fig.l, m.fig.r - m.img.r, 1.5) && near(m.cap.l, m.img.l, 1.5); }, 30000), JSON.stringify(m));
    await page.screenshot({ path: path.join(SHOTS, "s3-portrait-centre.png") });
    await dlg.locator('[data-image-align="left"]').click();
    await waitFor(() => lookOfDraft("solo")?.imageAlign === "left", 30000);
    await page.keyboard.press("Escape");

    // Carré : Grande
    const d2 = await openQuick(f, "sq", "size");
    ok("S7 carré Normale : plafonné à 85 % de la hauteur (85 % de la hauteur)", near(base.sq.img.w, 0.85 * H, 2) && base.sq.img.w < base.sq.fig.w - 50, JSON.stringify(base.sq));
    await d2.locator('[data-image-size="large"]').click();
    ok("S7 carré Grande : toute la largeur du cadre", await waitFor(async () => { m = await measure(f, FIG("sq")); return m && near(m.img.w, m.fig.w, 1.5) && m.img.w > base.sq.img.w + 100; }, 30000), JSON.stringify(m));
    await page.screenshot({ path: path.join(SHOTS, "s4-carre-grande.png") });
    await page.keyboard.press("Escape");

    // Panneau : même réglage, en haut
    await pick(f, "spaced");
    const sec = page.getByTestId("image-size-section");
    await sec.waitFor({ timeout: 20000 });
    const top = await page.evaluate(() => {
      const s = document.querySelector('[data-testid="image-size-section"]');
      const h = document.querySelector(".ve-settings-head, .ve-settings h2");
      const form = document.querySelector(".ve-settings .a-field, .ve-settings label");
      return { s: s.getBoundingClientRect().top, h: h?.getBoundingClientRect().top ?? 0, form: form?.getBoundingClientRect().top ?? 1e9 };
    });
    ok("S8 panneau : « Taille de l'image » est en haut, avant les champs du formulaire", top.s >= top.h && top.s <= top.form, JSON.stringify(top));
    await sec.getByRole("button", { name: "Grande" }).click();
    ok("S8 panneau : Grande agrandit l'image sur la toile et s'enregistre", await waitFor(async () => { m = await measure(f, FIG("spaced")); return m && m.size === "large" && lookOfDraft("spaced")?.imageSize === "large"; }, 30000), JSON.stringify(m));
    await sec.getByRole("button", { name: "Normale" }).click();
    ok("S8 panneau : Normale retire le réglage", await waitFor(() => lookOfDraft("spaced") === undefined, 30000), JSON.stringify(lookOfDraft("spaced")));
    ok("S9 l'image existante sans réglage n'a pas changé de dimensions", near((await measure(f, FIG("legacy"))).img.w, base.legacy.img.w, 0.6) && near((await measure(f, FIG("legacy"))).img.h, base.legacy.img.h, 0.6));
  });

/* ---- G. Espace au-dessus (page) ----------------------------------------------------------------------------------- */
if (run("G"))
  await section("G", async () => {
    await settled();
    const T2 = '[data-edit-block="t2"] section';
    const auto = await gapBetween(f, T2, FIG("spaced"));
    ok("G0 sans réglage : un espace du thème entre le texte et l'image (> 20 px)", auto > 20, String(auto));
    const dlg = await openQuick(f, "spaced", "space");
    await page.screenshot({ path: path.join(SHOTS, "g0-menu-espace.png") });
    ok("G1 la fenêtre propose Aucun / S / M / Auto, Auto choisi", (await dlg.locator("[data-space-top]").count()) === 4 && (await dlg.locator('[data-space-top="auto"]').getAttribute("aria-checked")) === "true");
    await dlg.locator('[data-space-top="none"]').click();
    let g;
    ok("G2 Aucun : 0 px entre le texte et l'image", await waitFor(async () => { g = await gapBetween(f, T2, FIG("spaced")); return g !== null && Math.abs(g) <= 1; }, 30000), String(g));
    ok("G2 enregistré : look.spaceTop = none (le réglage existant, sans nouveau champ)", await waitFor(() => lookOfDraft("spaced")?.spaceTop === "none", 30000), JSON.stringify(lookOfDraft("spaced")));
    await page.screenshot({ path: path.join(SHOTS, "g1-espace-aucun.png") });
    await dlg.locator('[data-space-top="s"]').click();
    ok("G3 S : un petit espace (entre 0 et Auto)", await waitFor(async () => { g = await gapBetween(f, T2, FIG("spaced")); return g > 3 && g < auto - 3; }, 30000), `${g} / auto ${auto}`);
    await dlg.locator('[data-space-top="auto"]').click();
    ok("G4 Auto : retour à l'espace d'avant, réglage retiré", await waitFor(async () => { g = await gapBetween(f, T2, FIG("spaced")); return near(g, auto, 1) && lookOfDraft("spaced") === undefined; }, 30000), `${g} / ${auto} ${JSON.stringify(lookOfDraft("spaced"))}`);
    await dlg.locator('[data-space-top="none"]').click();
    await waitFor(() => lookOfDraft("spaced")?.spaceTop === "none", 30000);
    await page.keyboard.press("Escape");
    // Un texte a aussi son « Espace ».
    await f.locator('[data-edit-block="t1"] p').first().click();
    ok("G5 un bloc Texte a aussi le bouton « Espace » dans sa barre", await f.locator('.pe-tools [data-testid="space-button"]').isVisible());
  });

/* ---- B. Planche d'un projet --------------------------------------------------------------------------------------- */
if (run("B"))
  await section("B", async () => {
    await settled();
    const bimg = f.locator(BFIG);
    await bimg.scrollIntoViewIfNeeded();
    const b0 = await measure(f, BFIG);
    ok("B0 planche : l'image est plafonnée comme sur une page (même plafond que sur une page)", b0 && near(b0.img.w, 0.85 * H * (2 / 3), 2), JSON.stringify(b0));
    const frame = f.locator('[data-edit-bitem="bimg"]');
    await frame.hover();
    const sizeBtn = frame.locator('[data-testid="bitem-size-button"]');
    ok("B1 la barre de l'image de la planche a « Taille » et « Espace »", (await sizeBtn.count()) === 1 && (await frame.locator('[data-testid="bitem-space-button"]').count()) === 1);
    await sizeBtn.click();
    const dlg = f.locator('[data-testid="size-menu"]');
    await dlg.waitFor({ timeout: 15000 });
    ok("B1 la fenêtre Taille s'ouvre sous le bouton de la barre", await anchoredUnder(dlg, sizeBtn), JSON.stringify([await dlg.boundingBox(), await sizeBtn.boundingBox()]));
    ok("B1 cliquer « Taille » choisit aussi le composant (panneau à jour)", await waitFor(async () => (await f.locator('[data-edit-bitem="bimg"][data-selected]').count()) === 1, 15000));
    await dlg.locator('[data-image-size="large"]').click();
    let m;
    ok("B2 planche : Grande = toute la largeur de la colonne", await waitFor(async () => { m = await measure(f, BFIG); return m && m.size === "large" && near(m.img.w, m.fig.w, 1.5) && m.img.w > b0.img.w + 100; }, 30000), JSON.stringify(m));
    ok("B2 enregistré dans le composant : look.imageSize = large", await waitFor(() => lookOfItem("bimg")?.imageSize === "large", 30000), JSON.stringify(draftLayout()));
    await dlg.locator('[data-image-size="normal"]').click();
    await dlg.locator('[data-image-align="right"]').click();
    ok("B3 planche : Droite, la légende suit", await waitFor(async () => { m = await measure(f, BFIG); return m && m.align === "right" && near(m.img.r, m.fig.r, 1.5) && near(m.cap.r, m.img.r, 1.5) && near(m.img.w, b0.img.w, 1.5); }, 30000), JSON.stringify(m));
    await page.screenshot({ path: path.join(SHOTS, "b1-planche-droite.png") });
    await dlg.locator('[data-image-align="center"]').click();
    await page.keyboard.press("Escape");

    // Espace : image sous un texte
    const BT = '[data-edit-bitem="btxt"] section';
    const auto = await gapBetween(f, BT, BFIG);
    ok("B4 planche : un espace du thème entre le texte et l'image (> 20 px)", auto > 20, String(auto));
    await frame.hover();
    await frame.locator('[data-testid="bitem-space-button"]').click();
    const sp = f.locator('[data-testid="space-menu"]');
    await sp.waitFor({ timeout: 15000 });
    ok("B4 la fenêtre Espace s'ouvre sous le bouton de la barre", await anchoredUnder(sp, frame.locator('[data-testid="bitem-space-button"]')), JSON.stringify([await sp.boundingBox(), await frame.locator('[data-testid="bitem-space-button"]').boundingBox()]));
    await sp.locator('[data-space-top="none"]').click();
    let g;
    ok("B5 planche, Aucun : 0 px entre le texte et l'image", await waitFor(async () => { g = await gapBetween(f, BT, BFIG); return g !== null && Math.abs(g) <= 1; }, 30000), String(g));
    ok("B5 enregistré : look.spaceTop = none", await waitFor(() => lookOfItem("bimg")?.spaceTop === "none", 30000), JSON.stringify(draftLayout()));
    await page.keyboard.press("Escape");

    // Bande : « Espace » ajouté
    const strip = f.locator('[data-edit-bitem="bstrip"]');
    await strip.scrollIntoViewIfNeeded();
    const topOf = () => f.evaluate(() => document.querySelector(".strip-viewport")?.getBoundingClientRect().top - document.querySelector(".strip > header")?.getBoundingClientRect().bottom);
    const sAuto = await topOf();
    await strip.hover();
    ok("B6 la barre de la bande a « Espace »", (await strip.locator('[data-testid="bitem-space-button"]').count()) === 1);
    await strip.locator('[data-testid="bitem-space-button"]').click();
    await sp.waitFor({ timeout: 15000 });
    await sp.locator('[data-space-top="none"]').click();
    let s0;
    ok("B7 bande, Aucun : la bande se rapproche de ce qui la précède", await waitFor(async () => { s0 = await topOf(); return s0 < sAuto - 10; }, 30000), `${s0} / ${sAuto}`);
    ok("B7 enregistré sur la bande : look.spaceTop = none", await waitFor(() => lookOfItem("bstrip")?.spaceTop === "none", 30000), JSON.stringify(draftLayout()));
    await sp.locator('[data-space-top="auto"]').click();
    ok("B8 bande, Auto : retour à l'espace d'avant, réglage retiré", await waitFor(async () => { s0 = await topOf(); return near(s0, sAuto, 1) && lookOfItem("bstrip") === undefined; }, 30000), `${s0} / ${sAuto}`);
    await sp.locator('[data-space-top="none"]').click();
    await waitFor(() => lookOfItem("bstrip")?.spaceTop === "none", 30000);
    await page.keyboard.press("Escape");
    await page.screenshot({ path: path.join(SHOTS, "b2-planche-espace.png") });
  });

/* ---- P. Publication, public, téléphone ---------------------------------------------------------------------------- */
if (run("P"))
  await section("P", async () => {
    await settled();
    await page.getByRole("button", { name: "Publier", exact: true }).click();
    ok("P0 page publiée", await waitFor(async () => /Publié/.test((await page.locator(".ve-status").textContent()) ?? ""), 120000));
    await sleep(1500);
    const PUB = (uid) => `figure.block-image[data-solo]`;
    const visitor = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pp = await visitor.newPage();
    pp.on("pageerror", (e) => errors.push(e.message));
    await pp.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
    const figs = await pp.locator("figure.block-image[data-solo]").evaluateAll((l) =>
      l.map((fig) => {
        const m = fig.querySelector(".block-image-media").getBoundingClientRect();
        const c = fig.querySelector("figcaption")?.getBoundingClientRect();
        const r = fig.getBoundingClientRect();
        return { size: fig.dataset.size ?? null, align: fig.dataset.align ?? null, imgW: m.width, imgL: m.left, figW: r.width, figL: r.left, capL: c?.left ?? null, capW: c?.width ?? null };
      }),
    );
    // Ordre de la page : solo (gauche), sq (grande), legacy, spaced, puis l'image de la planche.
    const [solo, sq, legacy, spaced] = figs;
    ok("P1 public : image gauche, légende au même bord, largeur ≤ image", solo && solo.align === "left" && near(solo.imgL, solo.figL) && near(solo.capL, solo.imgL) && solo.capW <= solo.imgW + 1.5, JSON.stringify(solo));
    ok("P2 public : le carré Grande prend toute la largeur du cadre", sq && sq.size === "large" && near(sq.imgW, sq.figW, 1.5), JSON.stringify(sq));
    ok("P3 public : l'image sans réglage a les mêmes dimensions qu'avant (85 % de 900 px × 2/3 = 510 px, centrée)", legacy && legacy.size === null && legacy.align === null && near(legacy.imgW, 0.85 * HP * (2 / 3), 1) && near(legacy.imgL - legacy.figL, legacy.figL + legacy.figW - (legacy.imgL + legacy.imgW), 1.5), JSON.stringify(legacy));
    const gapPub = await pp.evaluate(() => {
      const t = [...document.querySelectorAll("section")].find((s) => /juste avant une image/.test(s.textContent ?? "") && !s.querySelector("figure"));
      const fgs = [...document.querySelectorAll("figure.block-image[data-solo]")];
      const fg = fgs[3];
      return t && fg ? fg.getBoundingClientRect().top - t.getBoundingClientRect().bottom : null;
    });
    ok("P4 public : 0 px entre le texte et l'image réglée sur Aucun", gapPub !== null && Math.abs(gapPub) <= 1, String(gapPub));
    ok("P5 public : parité avec la toile (rapport largeur image / cadre du carré, de l'image gauche)", sq && Math.abs(sq.imgW / sq.figW - 1) < 0.01 && solo && Math.abs(solo.imgW - 0.85 * HP * (2 / 3)) <= 1.5);
    const b = await pp.evaluate(() => {
      const fig = document.querySelectorAll("figure.block-image[data-solo]")[4];
      const t = document.querySelector(".strip");
      if (!fig) return null;
      const m = fig.querySelector(".block-image-media").getBoundingClientRect();
      const r = fig.getBoundingClientRect();
      return { size: fig.dataset.size ?? null, align: fig.dataset.align ?? null, imgW: m.width, figW: r.width, spaced: Boolean(t?.querySelector(".strip-spaced[data-strip-pt=none]")) };
    });
    ok("P6 public : planche, image centrée Normale (≈ 510 px), bande avec son espace", b && near(b.imgW, 0.85 * HP * (2 / 3), 1.5) && b.spaced, JSON.stringify(b));
    await pp.locator("figure.block-image[data-solo]").nth(1).scrollIntoViewIfNeeded();
    await pp.screenshot({ path: path.join(SHOTS, "p1-public-carre-grand.png") });
    await visitor.close();

    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const mp = await phone.newPage();
    mp.on("pageerror", (e) => errors.push(e.message));
    await mp.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
    const ph = await mp.locator("figure.block-image[data-solo]").evaluateAll((l) => l.map((fig) => ({ imgW: fig.querySelector(".block-image-media").getBoundingClientRect().width, figW: fig.getBoundingClientRect().width, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth })));
    ok("P7 téléphone : toutes les images tiennent dans la colonne (390 px), aucun débordement", ph.length >= 4 && ph.every((x) => x.imgW <= x.figW + 1 && x.overflow <= 0), JSON.stringify(ph));
    ok("P7 téléphone : le carré Grande prend toute la largeur", ph[1] && near(ph[1].imgW, ph[1].figW, 1.5));
    await mp.locator("figure.block-image[data-solo]").first().scrollIntoViewIfNeeded();
    await mp.screenshot({ path: path.join(SHOTS, "p2-telephone.png") });
    await phone.close();
  });

ok("aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `e2e-image40 : ${failures} échec(s)` : "e2e-image40 : OK");
process.exit(failures ? 1 : 0);
