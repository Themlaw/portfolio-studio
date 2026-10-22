#!/usr/bin/env node
/**
 * Lot 11 (v0.16) : médias et thèmes. UN chromium sobre. Serveur dev requis,
 * base NEUVE (seed), une connexion admin.
 *
 *  A. Fond de l'ouverture remplaçable dans TOUTES les variantes à fond visuel
 *     (calques, projecteur) : choisi, cadré (point focal + zoom), rendu public,
 *     retour au fond du thème ; avertissement de lisibilité mesuré au pixel
 *     (image à damier = alerte, image calme = aucune). Ouverture typographique :
 *     l'option n'est pas proposée.
 *  B. Tuiles de collection (accueil) : format imposé, cadrage par tuile (point
 *     focal + zoom), arrondi des images respecté, rendu public.
 *  C. Admin → Thèmes : édition de `tokens.type` (polices, graisse, italique,
 *     casse, interlettrage par rôle), aperçu en direct, enregistrement validé,
 *     export puis import sans perte.
 *
 * Usage : BASE=http://localhost:3102 DATA_DIR=/root/pf-lot11 ADMIN_EMAIL=… ADMIN_PASSWORD=… \
 *         SHOTS=/dossier [ONLY=A,B,C] node scripts/e2e-lot11.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const DB = path.join(process.env.DATA_DIR ?? "data", "portfolio.db");
const SHOTS = process.env.SHOTS ?? "screenshots/lot11";
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
const draftOf = (id) => JSON.parse(q("select draft from pages where id = ?", id)[0]?.draft ?? "null");
const blockOf = (id, type) => draftOf(id)?.blocks?.find((b) => b.type === type);
async function waitFor(fn, timeout = 60000) {
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(300)) if (await fn()) return true;
  return false;
}
const until = (f, fn, arg, timeout = 60000) => f.waitForFunction(fn, arg, { timeout, polling: 200 }).then(() => true, () => false);

/* ---- Images de test (processus à part) ------------------------------------------------------ */
const DIR = path.join(tmpdir(), "lot11");
mkdirSync(DIR, { recursive: true });
execFileSync(process.execPath, ["-e", `
const sharp = require("sharp");
const out = ${JSON.stringify(DIR)};
const W = 1600, H = 900;
(async () => {
  // Damier noir / blanc : aucune couleur de texte n'y est lisible.
  const buf = Buffer.alloc(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = ((x >> 4) + (y >> 4)) & 1 ? 255 : 0; const o = (y * W + x) * 3; buf[o] = buf[o + 1] = buf[o + 2] = v; }
  await sharp(buf, { raw: { width: W, height: H, channels: 3 } }).png().toFile(out + "/lot11-damier.png");
  // Aplats calmes, clair puis sombre (un thème clair et un thème sombre).
  for (const [name, rgb] of [["clair", { r: 244, g: 241, b: 234 }], ["sombre", { r: 20, g: 18, b: 15 }]])
    await sharp({ create: { width: W, height: H, channels: 3, background: rgb } }).png().toFile(out + "/lot11-calme-" + name + ".png");
})();
`], { cwd: process.cwd() });

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

async function upload(file) {
  // Déjà envoyée par un essai précédent (même base) : réutilisée.
  const known = q("select id from media where original_name = ? and status = 'ready' order by id desc limit 1", path.basename(file))[0]?.id;
  if (known) return known;
  const res = await page.request.post(`${BASE}/admin/api/upload`, { headers: { origin: BASE }, multipart: { file: { name: path.basename(file), mimeType: "image/png", buffer: readFileSync(file) } } });
  const body = await res.json();
  if (!body.ok) throw new Error(`envoi refusé : ${JSON.stringify(body)}`);
  const id = body.media.id;
  if (!(await waitFor(() => q("select status from media where id = ?", id)[0]?.status === "ready", 120000))) throw new Error("conversion trop longue");
  return id;
}
const media = {
  damier: await upload(path.join(DIR, "lot11-damier.png")),
  clair: await upload(path.join(DIR, "lot11-calme-clair.png")),
  sombre: await upload(path.join(DIR, "lot11-calme-sombre.png")),
};

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
async function activateTheme(name) {
  await page.goto(`${BASE}/admin/themes`, { waitUntil: "networkidle" });
  const card = page.locator(".a-theme-card", { hasText: name }).first();
  if ((await card.getAttribute("data-active")) === "true") return;
  await card.getByRole("button", { name: "Mettre en ligne" }).click();
  await page.locator("dialog[open]").getByRole("button", { name: "Mettre en ligne" }).click();
  await page.locator("dialog[open]").waitFor({ state: "detached" });
  await sleep(800);
}
/** Choisit un fond de l'ouverture dans la médiathèque, depuis le panneau « Réglages » du bloc. */
async function pickHeroBackground(f, mediaId) {
  await f.locator('[data-edit-type="hero"] h1').first().click();
  await page.getByRole("tab", { name: "Réglages" }).click();
  const field = page.locator(".a-media-field").first();
  await field.getByRole("button", { name: /Choisir une image|Changer d'image/ }).click();
  const dialog = page.locator("dialog[open], [role=dialog]").last();
  const name = q("select original_name n from media where id = ?", mediaId)[0].n;
  await dialog.locator(`.a-media-tile[title="${name}"], .a-media-tile[title="${name.replace(/\.[^.]+$/, "")}"]`).first().click();
  await dialog.getByRole("button", { name: "Utiliser cette image" }).click();
  await settled();
}

/* ---- A. Fond de l'ouverture --------------------------------------------------------------- */

async function heroScenario(label, themeName, variant) {
  await activateTheme(themeName);
  const f = await openEditor(homeId);
  const hero = '.hero[data-edit-media="backgroundMediaId"]';
  ok(`A ${label} : ouverture « ${variant} » à fond remplaçable (repère d'édition)`, (await f.locator(hero).count()) === 1);
  // Image à damier : texte illisible → avertissement ; fond posé sur la toile.
  await pickHeroBackground(f, media.damier);
  ok(`A ${label} : fond choisi (brouillon) et affiché derrière le texte`, (await waitFor(() => blockOf(homeId, "hero")?.props.backgroundMediaId === media.damier)) && (await until(f, () => Boolean(document.querySelector(".hero .hero-backdrop img")))));
  ok(`A ${label} : petits textes à halo sur le fond`, await until(f, () => document.querySelector(".hero .eyebrow")?.classList.contains("hero-halo") === true));
  ok(`A ${label} : avertissement de lisibilité (damier)`, await until(f, () => Boolean(document.querySelector('[data-testid="hero-contrast-warning"]')), null, 30000));
  const warn = await f.locator('[data-testid="hero-contrast-warning"]').textContent().catch(() => "");
  const warnTip = (await f.locator('[data-testid="hero-contrast-warning"]').getAttribute("title").catch(() => "")) ?? "";
  ok(`A ${label} : avertissement en mots (pas de ratio dans le texte), ratio et seuil en info-bulle`, /peu lisible/.test(warn ?? "") && !/:1/.test(warn ?? "") && /Contraste \d+,\d:1 \(il faut au moins (4,5|3,0):1\)/.test(warnTip), `${warn} | ${warnTip}`);
  await page.screenshot({ path: `${SHOTS}/A-${label}-damier.png` });
  // Cadrage (point focal + zoom), comme les autres images.
  await f.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await f.locator("h1").first().hover();
  await f.locator(hero).hover({ position: { x: 300, y: 200 } });
  ok(`A ${label} : « Cadrer » au survol du fond`, await until(f, () => Boolean(document.querySelector(".lk-crop-btn"))));
  await f.locator(".lk-crop-btn").click();
  await f.locator(".lk-crop [data-testid=crop-window]").waitFor();
  for (let i = 0; i < 4; i++) await page.keyboard.press("+");
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await f.getByRole("button", { name: "Enregistrer le cadrage" }).click();
  await settled();
  ok(`A ${label} : cadrage enregistré (look.crop.backgroundMediaId, zoom > 1)`, await waitFor(() => (blockOf(homeId, "hero")?.props.look?.crop?.backgroundMediaId?.zoom ?? 1) > 1.2), JSON.stringify(blockOf(homeId, "hero")?.props.look));
  ok(
    `A ${label} : cadrage appliqué à l'image (cover, zoom)`,
    await until(f, () => {
      const cs = getComputedStyle(document.querySelector(".hero .hero-backdrop img"));
      return cs.objectFit === "cover" && cs.transform !== "none";
    }),
  );
  // Image calme adaptée au thème : plus d'avertissement.
  const darkInk = await f.evaluate(() => {
    const [r, g, b] = getComputedStyle(document.querySelector(".hero h1")).color.match(/\d+(\.\d+)?/g).map(Number);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
  });
  await pickHeroBackground(f, darkInk ? media.clair : media.sombre);
  ok(`A ${label} : image calme (${darkInk ? "claire" : "sombre"}) : aucun avertissement`, await until(f, () => !document.querySelector('[data-testid="hero-contrast-warning"]') && document.querySelectorAll(".hero .hero-backdrop img").length === 1, null, 30000), await f.evaluate(() => document.querySelector('[data-testid="hero-contrast-warning"]')?.getAttribute("data-measures") ?? "").catch(() => ""));
  await sleep(1500);
  ok(`A ${label} : toujours aucun avertissement après remesure`, (await f.locator('[data-testid="hero-contrast-warning"]').count()) === 0);
  await page.screenshot({ path: `${SHOTS}/A-${label}-calme.png` });
  // Publication : rendu public.
  ok(`A ${label} : page publiée`, await publish());
  const pub = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pp = await pub.newPage();
  await pp.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  const shown = await pp.evaluate(() => ({ img: Boolean(document.querySelector(".hero .hero-backdrop img")), edit: Boolean(document.querySelector("[data-edit-media]")), halo: document.querySelector(".hero .eyebrow")?.classList.contains("hero-halo") }));
  ok(`A ${label} : public : fond affiché, halo, aucun repère d'édition`, shown.img && shown.halo && !shown.edit, JSON.stringify(shown));
  await pp.screenshot({ path: `${SHOTS}/A-${label}-public.png` });
  await pub.close();
  // Retour au fond du thème.
  await f.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await f.locator(hero).hover({ position: { x: 300, y: 200 } });
  await f.getByRole("button", { name: "Fond du thème" }).dispatchEvent("click");
  await settled();
  ok(`A ${label} : retour au fond du thème (prop retirée, plus d'image de fond)`, (await waitFor(() => blockOf(homeId, "hero")?.props.backgroundMediaId === undefined)) && (await until(f, () => !document.querySelector(".hero .hero-backdrop img"))));
  await page.screenshot({ path: `${SHOTS}/A-${label}-theme.png` });
  ok(`A ${label} : plus d'avertissement sur le fond du thème`, (await f.locator('[data-testid="hero-contrast-warning"]').count()) === 0);
  await publish();
}

if (run("A")) {
  console.log("== A. Fond de l'ouverture");
  await heroScenario("calques", "Galerie lumineuse", "calques");
  await heroScenario("projecteur", "Salle de projection", "projecteur");
  await activateTheme("Carnet d'atelier");
  const f = await openEditor(homeId);
  ok("A typographique : aucun repère de fond sur l'ouverture", (await f.locator(".hero[data-edit-media]").count()) === 0);
  await f.locator('[data-edit-type="hero"] h1').first().click();
  await page.getByRole("tab", { name: "Réglages" }).click();
  ok("A typographique : l'option « Image de fond » n'est pas proposée", (await page.getByText("Image de fond (facultative)").count()) === 0);
  await activateTheme("Galerie lumineuse");
}

/* ---- B. Tuiles de collection -------------------------------------------------------------- */

if (run("B")) {
  console.log("== B. Tuiles de collection");
  const f = await openEditor(homeId);
  const tiles = '[data-edit-type="collection-tiles"]';
  await f.locator(`${tiles} h2`).first().click();
  await page.getByRole("tab", { name: "Réglages" }).click();
  await page.getByLabel("Format des images").selectOption("3:2");
  await settled();
  ok("B1 format imposé (3:2, liste des formats du lot 25) enregistré au brouillon", await waitFor(() => blockOf(homeId, "collection-tiles")?.props.ratio === "3:2"));
  ok("B2 images des tuiles au format imposé", await until(f, () => { const i = document.querySelector(".tile-frame img"); return i && Math.abs(i.clientWidth / i.clientHeight - 3 / 2) < 0.03; }));
  // Arrondi des images : respecté par le cadre des tuiles.
  await page.getByRole("button", { name: "Fort" }).first().click();
  await settled();
  ok("B3 arrondi « fort » respecté par le cadre (rogne l'image zoomée)", await until(f, () => { const cs = getComputedStyle(document.querySelector(".tile-frame")); return cs.overflow === "hidden" && parseFloat(cs.borderTopLeftRadius) === 20; }));
  const frame0 = f.locator(".tile-frame").first();
  await frame0.scrollIntoViewIfNeeded();
  await frame0.hover();
  ok("B4 « Cadrer » au survol d'une tuile", await until(f, () => Boolean(document.querySelector(".lk-crop-btn"))));
  await f.locator(".lk-crop-btn").click();
  await f.locator(".lk-crop [data-testid=crop-window]").waitFor();
  for (let i = 0; i < 4; i++) await page.keyboard.press("+");
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowDown");
  await page.screenshot({ path: `${SHOTS}/B-cadrage-tuile.png` });
  await f.getByRole("button", { name: "Enregistrer le cadrage" }).click();
  await settled();
  const key = blockOf(homeId, "collection-tiles")?.props.items?.[0]?.collection ?? "characters"; // entrées automatiques (lot 22) : pas de liste, la première tuile est Personnages
  ok("B5 cadrage enregistré pour CETTE tuile (look.tileCrop[collection], zoom > 1)", await waitFor(() => (blockOf(homeId, "collection-tiles")?.props.look?.tileCrop?.[key]?.zoom ?? 1) > 1.2), JSON.stringify(blockOf(homeId, "collection-tiles")?.props.look));
  ok("B6 rendu : image cadrée (cover, zoom, point focal) ; la tuile suivante intacte", await until(f, () => {
    const frames = [...document.querySelectorAll(".tile-frame")];
    const a = getComputedStyle(frames[0].querySelector("img"));
    const b = frames[1] && getComputedStyle(frames[1].querySelector("img"));
    return frames[0].hasAttribute("data-crop") && a.transform !== "none" && a.objectPosition !== "50% 50%" && (!b || (b.transform === "none" && !frames[1].hasAttribute("data-crop")));
  }));
  await frame0.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/B-tuile-cadree.png` });
  ok("B7 page publiée", await publish());
  const pub = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pp = await pub.newPage();
  await pp.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  const shown = await pp.evaluate(() => {
    const fr = document.querySelector(".tile-frame");
    const cs = getComputedStyle(fr.querySelector("img"));
    return { zoom: cs.transform, pos: cs.objectPosition, radius: getComputedStyle(fr).borderTopLeftRadius, edit: Boolean(document.querySelector("[data-edit-tile]")) };
  });
  ok("B8 public : tuile cadrée, coins arrondis, aucun repère d'édition", shown.zoom !== "none" && shown.pos !== "50% 50%" && shown.radius === "20px" && !shown.edit, JSON.stringify(shown));
  await pub.close();
  // Recentrer depuis le panneau.
  await f.locator(`${tiles} h2`).first().click();
  await page.getByRole("tab", { name: "Réglages" }).click();
  await page.getByRole("button", { name: "Recentrer" }).first().click();
  await settled();
  ok("B9 « Recentrer » retire le cadrage de la tuile", await waitFor(() => !blockOf(homeId, "collection-tiles")?.props.look?.tileCrop?.[key]));
  await page.getByLabel("Format des images").selectOption("auto");
  await settled();
  await publish();
}

/* ---- C. Typographie du thème ---------------------------------------------------------------- */

/** Menu « … » d'une carte de thème (lot 23) : l'ouvre, puis choisit l'entrée. */
const menuItem = async (card, name) => {
  await card.getByRole("button", { name: /Plus d'actions/ }).click();
  await page.getByRole("menuitem", { name }).click();
};

if (run("C")) {
  console.log("== C. Admin → Thèmes : tokens.type");
  await page.goto(`${BASE}/admin/themes`, { waitUntil: "networkidle" });
  const before = await page.locator(".a-theme-card").count();
  await menuItem(page.locator(".a-theme-card", { hasText: "Galerie lumineuse" }).first(), "Dupliquer");
  await page.waitForFunction((n) => document.querySelectorAll(".a-theme-card").length > n, before, { timeout: 30000 }).catch(() => {});
  await page.waitForLoadState("networkidle");
  const copyId = q("select id from themes where id like 'galerie-lumineuse-%' order by rowid desc limit 1")[0]?.id ?? q("select id from themes order by rowid desc limit 1")[0].id;
  await page.goto(`${BASE}/admin/themes/${encodeURIComponent(copyId)}`, { waitUntil: "networkidle" });
  const type = page.getByTestId("theme-type");
  ok("C1 éditeur de thème : section « Styles par rôle » (sept rôles)", (await type.locator("fieldset").count()) === 7);
  const h2 = type.locator('fieldset[data-role="h2"]');
  await h2.getByLabel("Police").selectOption("caption");
  await h2.getByLabel("Graisse").selectOption("300");
  await h2.getByLabel("Italique").selectOption("1");
  await h2.getByLabel("Casse").selectOption("upper");
  await h2.getByLabel("Interlettrage (em)").fill("0.12");
  // Aperçu en direct (postMessage) : la feuille du thème porte la règle.
  const frame = page.frameLocator("iframe.a-preview-frame");
  ok("C2 aperçu en direct : <style id=theme> porte les règles de h2", await waitFor(async () => {
    const css = await page.frames().find((fr) => fr !== page.mainFrame() && fr.name().startsWith("apercu-"))?.evaluate(() => document.getElementById("theme")?.textContent ?? "").catch(() => "");
    return /font-family:var\(--t-font-caption\)/.test(css ?? "") && /text-transform:uppercase/.test(css) && /letter-spacing:0\.12em/.test(css) && /font-weight:300/.test(css);
  }, 30000), "");
  void frame;
  await page.screenshot({ path: `${SHOTS}/C-theme-type.png`, fullPage: false });
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  ok("C3 enregistré : tokens.type.h2 en base (validé par le schéma)", await waitFor(() => {
    const t = JSON.parse(q("select data from themes where id = ?", copyId)[0].data).tokens.type?.h2;
    return t?.font === "caption" && t?.weight === 300 && t?.italic === true && t?.case === "upper" && t?.tracking === 0.12;
  }, 30000));
  // « Revenir au thème d'origine » d'un rôle.
  await type.locator('fieldset[data-role="h1"]').getByLabel("Casse").selectOption("upper");
  await type.locator('fieldset[data-role="h1"]').getByRole("button", { name: "Revenir au thème d'origine" }).click();
  ok("C4 « Revenir au thème d'origine » : le rôle n'a plus de style", (await type.locator('fieldset[data-role="h1"]').getByLabel("Casse").inputValue()) === "");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click().catch(() => {});
  await sleep(1500);
  // Aperçu serveur du thème enregistré : h2 en majuscules.
  const pv = await ctx.newPage();
  await pv.goto(`${BASE}/api/theme-preview?id=${encodeURIComponent(copyId)}&redirect=/fr/personnages&banner=0`, { waitUntil: "networkidle" });
  const css = await pv.evaluate(() => {
    const h = document.querySelector("h2");
    const cs = getComputedStyle(h);
    return { tt: cs.textTransform, w: cs.fontWeight, ls: cs.letterSpacing, fs: cs.fontStyle };
  });
  ok("C5 rendu du thème enregistré : h2 en majuscules, graisse 300, italique, interlettrage", css.tt === "uppercase" && css.w === "300" && css.fs === "italic" && parseFloat(css.ls) > 0, JSON.stringify(css));
  await pv.close();
  // Export puis import : tokens.type conservé (transfer.ts).
  const zip = await page.evaluate(async (id) => {
    const r = await fetch(`/admin/api/themes/${encodeURIComponent(id)}/export`);
    return [...new Uint8Array(await r.arrayBuffer())];
  }, copyId);
  const imported = await page.evaluate(async (bytes) => {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type: "application/zip" }), "theme.zip");
    const r = await fetch("/admin/api/themes/import", { method: "POST", body: form });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, zip);
  const importedId = imported.body?.theme?.id;
  const row = importedId ? q("select data from themes where id = ?", importedId)[0] : null;
  const kept = row && JSON.parse(row.data).tokens.type?.h2;
  ok("C6 export puis import : tokens.type conservé", imported.status === 200 && kept?.case === "upper" && kept?.weight === 300 && kept?.font === "caption", JSON.stringify(imported.body).slice(0, 200));
  // Cleanup : les deux copies.
  await page.goto(`${BASE}/admin/themes`, { waitUntil: "networkidle" });
  for (let i = 0; i < 2; i++) {
    // Copies seulement : ni thème livré, ni thème en ligne (leur menu n'a pas « Supprimer »).
    const extra = page.locator('.a-theme-card[data-active="false"]', { hasNotText: "Thème fourni" }).first();
    if (!(await extra.count())) break;
    await menuItem(extra, "Supprimer");
    await page.locator("dialog[open]").getByRole("button", { name: "Supprimer" }).click();
    await page.locator("dialog[open]").waitFor({ state: "detached" });
    await page.reload({ waitUntil: "networkidle" });
  }
  ok("C7 copies supprimées", (await page.locator(".a-theme-card").count()) === before);
}

ok("aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\nECHECS : ${failures}` : "\nTOUT PASSE");
process.exit(failures ? 1 : 0);
