#!/usr/bin/env node
/**
 * Lot 90 : opacité du papier peint de 0 à 100 % et barre d'outils d'un bloc (chromium, serveur requis, base neuve, une connexion admin).
 * Données SYNTHÉTIQUES : un motif de pois généré ici, un PNG généré ici, des textes inventés.
 *  P  Parité : une carte à papier peint SANS réglage d'opacité affiche 100 % (la vraie valeur du rendu), le brouillon n'est pas touché au simple
 *     fait d'ouvrir le menu, le rendu public est celui d'avant (empreinte de la capture publique écrite en PARITY_SHA, comparée v0.31.1 / lot).
 *  X  Valeurs extrêmes : 100 %, 0 %, 100 % de nouveau, en carte et en pleine largeur ; le rendu (opacité du calque) suit.
 *  R  Après rechargement de l'éditeur et en public : la valeur enregistrée est relue.
 *  W  Avertissement non bloquant au-delà de 60 % quand du texte est posé sur le fond ; absent à 60 % et en dessous.
 *  L  Papier peint des cartes du site (bibliothèque) : curseur de 0 à 100 %, avertissement au-delà de 60 %.
 *  B  Barre d'outils : plus de rond ; Espacement / Taille / Cadre montrent la valeur en texte ; échantillon CARRÉ de couleur sur Fond et Fond image ; rien sans fond.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=P,X,R,W,L,B] [SHOTS=dossier] node scripts/e2e-opacite90.mjs
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";
import sharp from "sharp";

import { paint } from "./lib/crop-fixtures.mjs";
import { autoOpenFine } from "./lib/zone66.mjs";
import { login, pageIdOf, q1, waitFor } from "./lib/medias-setup.mjs";

const BASE = process.env.BASE ?? "http://localhost:3550";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? (process.env.DATA_DIR ? path.join(process.env.DATA_DIR, "..", "shots-opacite90") : path.join(tmpdir(), "e2e-opacite90"));
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
const near = (a, b, tol = 0.011) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= tol;

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await autoOpenFine(ctx);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);

/* ---- Fixtures synthétiques --------------------------------------------------------------------------------------------------- */

const FIX = mkdtempSync(path.join(tmpdir(), "pf-opacite90-"));
const POIS = path.join(FIX, "Pois test.png");
{
  const dots = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><g fill="#e07a9a"><circle cx="60" cy="60" r="26"/><circle cx="180" cy="180" r="26"/></g><g fill="#7ab0e0"><circle cx="180" cy="60" r="14"/><circle cx="60" cy="180" r="14"/></g></svg>';
  await sharp(Buffer.from(dots)).png().toFile(POIS);
}
await page.goto(`${BASE}/admin/papiers-peints`, { waitUntil: "networkidle" });
await page.locator('[data-testid="wallpaper-input"]').setInputFiles([POIS]);
await waitFor(async () => (await page.locator('[data-testid="wallpaper"][data-status="ready"]').count()) === 1, 120000);
const WP = q1("select id, opacity from wallpapers order by id desc")?.id;
if (!WP) throw new Error("motif de test non importé");
ok("0 motif synthétique importé, opacité de départ 100 % (celle de la bibliothèque)", q1("select opacity from wallpapers where id = ?", WP)?.opacity === 1);

const upload = async (name, buffer) => (await page.request.post(`${BASE}/admin/api/upload`, { headers: { origin: BASE }, multipart: { file: { name, mimeType: "image/png", buffer } }, timeout: 180000 })).status();
const mediaOf = (name) => q1("select id, status from media where original_name = ? order by id desc", name);
if (!mediaOf("90-image.png")) await upload("90-image.png", await paint(1200, 800, 3));
await waitFor(() => mediaOf("90-image.png")?.status === "ready", 180000);
const IMG = mediaOf("90-image.png")?.id;

const pageId = pageIdOf("personnages");
const text = (word) => ({ paragraphs: [{ fr: `${word} : un texte inventé assez long pour que le papier peint ait du contenu à entourer, sur une ligne ou deux.`, en: `${word}: some text.` }] });
const BLOCKS = [
  { uid: "tcard", type: "rich-text", props: { ...text("Aubepine"), surface: { color: "surface", width: "inset", paperWallpaper: WP } } },
  { uid: "tfond", type: "rich-text", props: { ...text("Bruyere"), background: { kind: "wallpaper", wallpaper: WP } } },
  { uid: "tplain", type: "rich-text", props: text("Chicoree") },
  { uid: "tcolor", type: "rich-text", props: { ...text("Digitale"), background: { kind: "color", color: "#336699" } } },
  { uid: "img1", type: "image", props: { mediaId: IMG, width: "wide" } },
  { uid: "img2", type: "image", props: { mediaId: IMG, width: "wide", look: { imageSize: "large", imageAlign: "left", frame: { kind: "none" }, spaceTop: "none" } } },
];
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
const draftBlock = (uid) => JSON.parse(sql((db) => db.prepare("select draft from pages where id = ?").get(pageId)).draft).blocks.find((b) => b.uid === uid);
const surfaceOf = (uid) => draftBlock(uid)?.props.surface;
const bgOf = (uid) => draftBlock(uid)?.props.background;
const lookOf = (uid) => draftBlock(uid)?.props.look;
setDraft(BLOCKS);
sql((db) => db.prepare("delete from blocks where page_id = ?").run(pageId));

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
async function publish() {
  await settled();
  await page.getByRole("button", { name: "Publier", exact: true }).click();
  return waitFor(async () => /En ligne/.test((await page.locator(".ve-status").textContent()) ?? ""), 120000);
}
async function section(name, fn) {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 4).join(" "));
    await page.screenshot({ path: path.join(SHOTS, `erreur-${name}.png`) }).catch(() => {});
  }
}

/** Opacité du calque de papier peint d'un texte : carte (::before de la carte) ou pleine largeur (::after de l'enveloppe de fond). */
const OPACITIES = (word) => {
  const p = [...document.querySelectorAll("p")].find((e) => e.textContent.includes(word));
  if (!p) return null;
  const card = p.closest('.surface-card[data-surface="on"]');
  const fond = p.closest('.fond-bloc[data-fond="on"]');
  return { card: card ? parseFloat(getComputedStyle(card, "::before").opacity) : null, fond: fond ? parseFloat(getComputedStyle(fond, "::after").opacity) : null };
};
const opac = (where, word) => where.evaluate(OPACITIES, word);

/** La publication vide le brouillon (les blocs perdent leurs uid) : on le repose, neuf, avant de rouvrir l'éditeur. */
async function reseed(blocks = BLOCKS) {
  setDraft(blocks);
  return openEditor();
}
let f = await openEditor();

/** Sélectionne un bloc texte (clic dans sa section) et ouvre « Fond ». */
async function openFond(fr, uid) {
  const host = fr.locator(`[data-edit-block="${uid}"]`).first();
  await host.scrollIntoViewIfNeeded();
  await host.locator("section").first().click({ position: { x: 40, y: 30 } });
  await fr.locator('.pe-tools [data-testid="fond-button"]').click();
  const menu = fr.locator('[data-testid="fond-menu"]').first();
  await menu.waitFor({ timeout: 20000 });
  if (!(await menu.locator('[data-testid="wp-opacity"]').count())) await menu.locator('[data-testid="fond-section-fond"] [data-kind="wallpaper"]').click();
  await menu.locator('[data-testid="wp-opacity"]').waitFor({ timeout: 20000 });
  return menu;
}
const slider = (menu) => menu.locator('[data-testid="wp-opacity"]');
const warning = (menu) => menu.locator('[data-testid="wp-opacity-warning"]');

/* ---- P. Parité ---------------------------------------------------------------------------------------------------------------- */
if (run("P"))
  await section("P", async () => {
    const before = JSON.stringify(draftBlock("tcard"));
    const menu = await openFond(f, "tcard");
    const sl = slider(menu);
    ok("P1 carte à papier peint, aucun réglage : le curseur affiche 100 % (la vraie valeur du rendu)", (await sl.inputValue()) === "100" && (await menu.getByText("100 %", { exact: true }).count()) >= 1, await sl.inputValue());
    ok("P2 le curseur va de 0 à 100 (carte)", (await sl.getAttribute("min")) === "0" && (await sl.getAttribute("max")) === "100");
    ok("P3 le rendu de la toile est à 100 % sans manipulation", near((await opac(f, "Aubepine")).card, 1), JSON.stringify(await opac(f, "Aubepine")));
    ok("P4 le rendu est à 100 % avec du texte posé dessus : le menu prévient dès l'ouverture (non bloquant)", (await warning(menu).count()) === 1);
    await page.keyboard.press("Escape");
    await sleep(500);
    ok("P5 ouvrir le menu ne modifie pas le brouillon", JSON.stringify(draftBlock("tcard")) === before, JSON.stringify(surfaceOf("tcard")));
    const menuFull = await openFond(f, "tfond");
    ok("P6 pleine largeur, aucun réglage : 100 %, de 0 à 100", (await slider(menuFull).inputValue()) === "100" && (await slider(menuFull).getAttribute("max")) === "100");
    await page.keyboard.press("Escape");
    await sleep(300);
    // Rendu public, sans aucune manipulation : empreinte de la capture (comparée entre la v0.31.1 et le lot par le script de lancement).
    ok("P7 publication", await publish());
    const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await anon.newPage();
    await p.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
    const o = await p.evaluate(OPACITIES, "Aubepine");
    ok("P8 public : calque de la carte à 100 %", near(o.card, 1), JSON.stringify(o));
    const o2 = await p.evaluate(OPACITIES, "Bruyere");
    ok("P9 public : calque pleine largeur à 100 %", near(o2.fond, 1), JSON.stringify(o2));
    await p.evaluate(() => window.scrollTo(0, 0));
    const shot = await p.screenshot({ fullPage: true });
    console.log(`PARITY_SHA ${createHash("sha256").update(shot).digest("hex")}`);
    await p.screenshot({ path: path.join(SHOTS, "01-public-sans-manipulation.png"), fullPage: true });
    await anon.close();
    f = await reseed();
  });

/* ---- X. Valeurs extrêmes ------------------------------------------------------------------------------------------------------- */
if (run("X"))
  await section("X", async () => {
    for (const [label, uid, word, where, read] of [
      ["carte", "tcard", "Aubepine", "card", () => surfaceOf("tcard")?.paperOpacity],
      ["pleine largeur", "tfond", "Bruyere", "fond", () => bgOf("tfond")?.opacity],
    ]) {
      const menu = await openFond(f, uid);
      for (const [i, v] of [100, 0, 100].entries()) {
        await slider(menu).fill(String(v));
        // Le premier 100 % est déjà la valeur affichée : rien n'est écrit (parité), le rendu le montre déjà.
        if (i > 0) ok(`X ${label} : ${v} % enregistré`, await waitFor(() => near(read(), v / 100, 0.0001), 20000), String(read()));
        else ok(`X ${label} : 100 % de départ, rien d'écrit sans manipulation`, read() === undefined, String(read()));
        ok(`X ${label} : ${v} % rendu (opacité du calque)`, await waitFor(async () => near((await opac(f, word))[where], v / 100), 20000), JSON.stringify(await opac(f, word)));
        ok(`X ${label} : le curseur affiche ${v}`, (await slider(menu).inputValue()) === String(v));
      }
      await page.keyboard.press("Escape");
      await sleep(400);
    }
    await page.screenshot({ path: path.join(SHOTS, "02-extremes.png") });
  });

/* ---- R. Rechargement et public -------------------------------------------------------------------------------------------------- */
if (run("R"))
  await section("R", async () => {
    let menu = await openFond(f, "tcard");
    await slider(menu).fill("85");
    await waitFor(() => near(surfaceOf("tcard")?.paperOpacity, 0.85, 0.0001), 20000);
    menu = null;
    await page.keyboard.press("Escape");
    await settled();
    f = await openEditor();
    ok("R1 après rechargement de l'éditeur, le rendu est à 85 %", near((await opac(f, "Aubepine")).card, 0.85), JSON.stringify(await opac(f, "Aubepine")));
    menu = await openFond(f, "tcard");
    ok("R2 … et le curseur affiche 85", (await slider(menu).inputValue()) === "85");
    await page.keyboard.press("Escape");
    ok("R3 publication", await publish());
    const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await anon.newPage();
    await p.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
    ok("R4 public : le calque de la carte est à 85 %", near((await p.evaluate(OPACITIES, "Aubepine")).card, 0.85), JSON.stringify(await p.evaluate(OPACITIES, "Aubepine")));
    await p.screenshot({ path: path.join(SHOTS, "03-public-85.png"), fullPage: true });
    await anon.close();
    f = await reseed();
  });

/* ---- W. Avertissement de lisibilité --------------------------------------------------------------------------------------------- */
if (run("W"))
  await section("W", async () => {
    for (const [label, uid] of [["carte", "tcard"], ["pleine largeur", "tfond"]]) {
      const menu = await openFond(f, uid);
      await slider(menu).fill("80");
      await sleep(300);
      ok(`W ${label} : à 80 %, l'avertissement apparaît avec le texte attendu`, (await warning(menu).count()) === 1 && /Au-delà de 60 %, le texte peut devenir moins lisible/.test((await warning(menu).textContent()) ?? ""));
      if (uid === "tcard") await page.screenshot({ path: path.join(SHOTS, "04-avertissement.png") });
      await slider(menu).fill("61");
      await sleep(300);
      ok(`W ${label} : à 61 %, il est encore là`, (await warning(menu).count()) === 1);
      await slider(menu).fill("60");
      await sleep(300);
      ok(`W ${label} : à 60 %, il a disparu`, (await warning(menu).count()) === 0);
      await slider(menu).fill("30");
      await sleep(300);
      ok(`W ${label} : à 30 %, il a disparu`, (await warning(menu).count()) === 0);
      ok(`W ${label} : il ne bloque pas (valeur enregistrée à 100 % possible)`, await (async () => { await slider(menu).fill("100"); return waitFor(() => near(uid === "tcard" ? surfaceOf(uid)?.paperOpacity : bgOf(uid)?.opacity, 1, 0.0001), 20000); })());
      await page.keyboard.press("Escape");
      await sleep(300);
    }
  });

/* ---- L. Papier peint des cartes du site ----------------------------------------------------------------------------------------- */
if (run("L"))
  await section("L", async () => {
    await page.goto(`${BASE}/admin/papiers-peints`, { waitUntil: "networkidle" });
    const panel = page.locator('[data-testid="wallpaper-cards"]');
    await panel.locator('[data-testid="wallpaper-cards-on"]').click();
    const sl = panel.locator('[data-testid="wallpaper-cards-opacity"]');
    await sl.waitFor({ timeout: 30000 });
    ok("L1 le curseur du site va de 0 à 100 et montre 100 % (celui du motif)", (await sl.getAttribute("min")) === "0" && (await sl.getAttribute("max")) === "100" && (await sl.inputValue()) === "100");
    ok("L2 à 100 %, l'avertissement est là", (await panel.locator('[data-testid="wallpaper-cards-warning"]').count()) === 1);
    await sl.fill("90");
    const setting = () => JSON.parse(q1("select value from settings where key = 'cardWallpaper'")?.value ?? "{}");
    ok("L3 90 % enregistré", await waitFor(() => near(setting().opacity, 0.9, 0.0001), 20000), JSON.stringify(setting()));
    await sl.fill("40");
    await sleep(500);
    ok("L4 à 40 %, plus d'avertissement", await waitFor(async () => (await panel.locator('[data-testid="wallpaper-cards-warning"]').count()) === 0, 15000));
    await panel.locator('[data-testid="wallpaper-cards-none"]').click();
    await waitFor(() => !q1("select value from settings where key = 'cardWallpaper'")?.value || q1("select value from settings where key = 'cardWallpaper'").value === "null", 20000);
  });

/* ---- B. Barre d'outils ---------------------------------------------------------------------------------------------------------- */
const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
async function pickText(fr, uid) {
  const host = fr.locator(`[data-edit-block="${uid}"]`).first();
  await host.scrollIntoViewIfNeeded();
  await host.locator("section").first().click({ position: { x: 40, y: 30 } });
  await fr.locator(".pe-tools").first().waitFor({ timeout: 20000 });
  await sleep(400);
}
async function pickImage(fr, uid) {
  const el = fr.locator(`[data-edit-block="${uid}"] img`).first();
  await el.scrollIntoViewIfNeeded();
  await el.click();
  await fr.locator(".pe-tools").first().waitFor({ timeout: 20000 });
  await sleep(500);
}
const btn = (fr, id) => fr.locator(`.pe-tools [data-testid="${id}"]`);
const label = async (fr, id) => norm(await btn(fr, id).textContent());
if (run("B"))
  await section("B", async () => {
    f = await openEditor();
    await pickText(f, "tplain");
    ok("B1 texte sans fond : plus aucun rond dans la barre", (await f.locator(".pe-tools .sm-dot").count()) === 0);
    ok("B2 le bouton s'appelle « Espacement » (plus « Espace »), sans valeur tant que le thème décide", (await label(f, "space-button")) === "Espacement", await label(f, "space-button"));
    ok("B3 « Fond » sans fond : aucun échantillon", (await label(f, "fond-button")) === "Fond & carte" && (await f.locator('.pe-tools [data-testid="fond-button"] .sm-swatch').count()) === 0);
    ok("B4 l'infobulle d'Espacement reste « Espace au-dessus de ce bloc »", (await btn(f, "space-button").getAttribute("title")) === "Espace au-dessus de ce bloc");
    await btn(f, "space-button").click();
    const dlg = f.getByRole("dialog", { name: "Espacement" });
    await dlg.waitFor({ timeout: 15000 });
    ok("B5 la fenêtre s'appelle « Espacement » et sa rangée aussi", (await dlg.locator(".sm-label").first().textContent()) === "Espacement");
    await dlg.locator('[data-space-top="none"]').click();
    ok("B6 « Aucun » est un choix comme un autre : « Espacement · aucun »", await waitFor(async () => (await label(f, "space-button")) === "Espacement · aucun", 15000), await label(f, "space-button"));
    await dlg.locator('[data-space-top="m"]').click();
    ok("B7 M : « Espacement · M »", await waitFor(async () => (await label(f, "space-button")) === "Espacement · M", 15000), await label(f, "space-button"));
    await page.screenshot({ path: path.join(SHOTS, "05-espacement-valeur.png") });
    await dlg.locator('[data-space-top="auto"]').click();
    ok("B8 Auto : seulement le libellé", await waitFor(async () => (await label(f, "space-button")) === "Espacement", 15000), await label(f, "space-button"));
    ok("B9 enregistré : spaceTop retiré du brouillon", await waitFor(() => lookOf("tplain")?.spaceTop === undefined, 15000), JSON.stringify(lookOf("tplain")));
    await page.keyboard.press("Escape");

    await pickText(f, "tcolor");
    const sw = f.locator('.pe-tools [data-testid="fond-button"] .sm-swatch');
    ok("B10 fond de couleur : un échantillon", (await sw.count()) === 1);
    const st = await sw.evaluate((e) => ({ bg: getComputedStyle(e).backgroundColor, r: getComputedStyle(e).borderTopLeftRadius, w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height }));
    ok("B11 … de la couleur du fond (#336699), carré arrondi (pas un rond)", st.bg === "rgb(51, 102, 153)" && st.w === st.h && parseFloat(st.r) < st.w / 2, JSON.stringify(st));
    await page.screenshot({ path: path.join(SHOTS, "06-echantillon-fond.png") });
    await pickText(f, "tfond");
    ok("B12 papier peint sans couleur : l'échantillon du motif (damier)", (await f.locator('.pe-tools [data-testid="fond-button"] .sm-swatch[data-wallpaper]').count()) === 1);
    ok("B13 jamais de rond sur Fond", (await f.locator(".pe-tools .sm-dot").count()) === 0);

    await pickImage(f, "img1");
    ok("B14 image sans réglage : Taille, Cadre, Espacement sans valeur ni rond", (await label(f, "size-button")) === "Taille" && (await label(f, "frame-button")) === "Cadre" && (await label(f, "space-button")) === "Espacement" && (await f.locator(".pe-tools .sm-dot").count()) === 0, JSON.stringify([await label(f, "size-button"), await label(f, "frame-button"), await label(f, "space-button")]));
    ok("B15 « Fond image » sans fond : aucun échantillon", (await f.locator('.pe-tools [data-testid="imgbg-button"] .sm-swatch').count()) === 0);
    await pickImage(f, "img2");
    ok("B16 image réglée : « Taille · grande, gauche », « Cadre · aucun », « Espacement · aucun »", (await label(f, "size-button")) === "Taille · grande, gauche" && (await label(f, "frame-button")) === "Cadre · aucun" && (await label(f, "space-button")) === "Espacement · aucun", JSON.stringify([await label(f, "size-button"), await label(f, "frame-button"), await label(f, "space-button")]));
    ok("B17 … et toujours aucun rond", (await f.locator(".pe-tools .sm-dot").count()) === 0);
    await btn(f, "imgbg-button").click();
    const bg = f.getByRole("dialog", { name: "Fond de l'image" });
    await bg.waitFor({ timeout: 15000 });
    await bg.locator('[data-imgbg="white"]').click();
    ok("B18 « Fond image » : échantillon carré blanc une fois le fond posé", await waitFor(async () => (await f.locator('.pe-tools [data-testid="imgbg-button"] .sm-swatch').count()) === 1, 15000));
    await page.screenshot({ path: path.join(SHOTS, "07-image-barre.png") });
    await page.keyboard.press("Escape");
  });

ok("aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `e2e-opacite90 : ${failures} échec(s)` : "e2e-opacite90 : OK");
process.exit(failures ? 1 : 0);
