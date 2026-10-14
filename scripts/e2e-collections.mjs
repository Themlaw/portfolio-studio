#!/usr/bin/env node
/**
 * Lot 22 (v0.19) : entrées des collections (accueil). UN chromium sobre, base NEUVE (seed), une connexion admin.
 *
 *  A. Taille des images : Petite / Moyenne (défaut) / Grande, mesurée (hauteur de l'image <= plafond en % de
 *     l'écran, part de la colonne image), réglage du panneau et de la barre de la toile.
 *  B. Mobile 390 px : image au-dessus du texte, hauteur plafonnée, pas de défilement horizontal.
 *  C. Automatique : le seed est automatique ; une page de collection retirée (réglage « aucune »), ajoutée (page
 *     créée avec le réglage) puis dépubliée se reflète sur l'accueil public, et le texte vient du Titre de la page.
 *  D. Manuel : bascule automatique <-> manuel depuis le panneau, entrées ajoutées / retirées / ordonnées depuis la
 *     toile ; entrée vers une page dépubliée : masquée en public, signalée sur la toile.
 *
 * Usage : BASE=http://localhost:3150 DATA_DIR=/root/pf-22 ADMIN_EMAIL=… ADMIN_PASSWORD=… SHOTS=/dossier node scripts/e2e-collections.mjs
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
const SHOTS = process.env.SHOTS ?? "screenshots/collections22";
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
const pageIdOf = (slugFr) => q("select id from pages where json_extract(slug, '$.fr') = ?", slugFr)[0]?.id;
const draftOf = (id) => JSON.parse(q("select draft from pages where id = ?", id)[0]?.draft ?? "null");
const tilesDraft = () => draftOf(homeId)?.blocks?.find((b) => b.type === "collection-tiles")?.props;
const tilesPublished = () => JSON.parse(q("select props from blocks where page_id = ? and type = 'collection-tiles'", homeId)[0].props);
async function waitFor(fn, timeout = 60000) {
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(300)) if (await fn()) return true;
  return false;
}
const until = (f, fn, arg, timeout = 60000) => f.waitForFunction(fn, arg, { timeout, polling: 200 }).then(() => true, () => false);

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
async function anon(p) {
  const r = await fetch(BASE + p, { redirect: "manual" });
  return { status: r.status, html: await r.text() };
}
/** Tuiles de l'accueil public : titre, lien. */
async function publicTiles(lang = "fr") {
  const { html } = await anon(`/${lang}`);
  const section = html.slice(html.indexOf('class="tiles'));
  const end = section.indexOf("</section>");
  const tiles = [...section.slice(0, end).matchAll(/<a[^>]*class="tile [^"]*"[^>]*href="([^"]*)"[\s\S]*?<h3[^>]*>([^<]*)<\/h3>/g)];
  return tiles.map((m) => ({ href: m[1], title: m[2].replace(/&#x27;/g, "'") }));
}
/** Mesures d'une vue (cadre de la toile ou page) : tailles des images et de leur colonne. */
const MEASURE = () => {
  const tiles = document.querySelector(".tiles");
  const vh = innerHeight;
  const first = tiles.querySelector(".tile");
  const imgs = [...tiles.querySelectorAll(".tile-frame img")];
  return {
    size: tiles.getAttribute("data-size"),
    vh,
    heights: imgs.map((i) => i.offsetHeight),
    maxPct: Math.max(...imgs.map((i) => i.offsetHeight)) / vh,
    col: first.querySelector(".tile-img").offsetWidth / first.offsetWidth,
    count: tiles.querySelectorAll(".tile").length,
  };
};

/* ---- A. Taille des images ------------------------------------------------------------- */
console.log("== A. Taille des images");
{
  const f = await openEditor(homeId);
  const tiles = '[data-edit-type="collection-tiles"]';
  await f.locator(tiles).first().scrollIntoViewIfNeeded();
  const d = await f.evaluate(MEASURE);
  ok("A1 défaut : Moyenne, hauteur de l'image <= 70 % de l'écran", d.size === "medium" && d.maxPct <= 0.7 + 0.002, JSON.stringify(d));
  ok("A2 défaut : colonne image environ la moitié (pas les 2/3 d'avant)", d.col > 0.44 && d.col < 0.56, String(d.col));
  ok("A2b un portrait est réduit, pas coupé (rapport de l'image conservé)", await f.evaluate(() => { const i = document.querySelector(".tile-frame img"); return Math.abs(i.offsetWidth / i.offsetHeight - 0.75) < 0.02; }));
  await f.locator(`${tiles} h2`).first().click();
  await page.getByRole("tab", { name: "Réglages" }).click();
  const expect = { small: [0.5, 0.35, 0.45], medium: [0.7, 0.44, 0.56], large: [0.85, 0.6, 0.72] };
  for (const [size, label] of [["small", "Petite"], ["large", "Grande"], ["medium", "Moyenne"]]) {
    await page.getByLabel("Taille des images").selectOption(size);
    await settled();
    const [cap, lo, hi] = expect[size];
    ok(`A3 panneau « ${label} » : enregistrée au brouillon`, await waitFor(() => tilesDraft()?.size === size));
    ok(`A3 ${label} : hauteur <= ${cap * 100} % de l'écran`, await until(f, ([s, c]) => { const t = document.querySelector(".tiles"); return t.getAttribute("data-size") === s && Math.max(...[...t.querySelectorAll(".tile-frame img")].map((i) => i.offsetHeight)) <= c * innerHeight + 1; }, [size, cap]));
    const m = await f.evaluate(MEASURE);
    ok(`A4 ${label} : part de la colonne image ${lo}-${hi}`, m.col >= lo && m.col <= hi, JSON.stringify(m));
    await page.screenshot({ path: `${SHOTS}/A-${size}.png` });
  }
  // Le plafond suit l'écran : plus l'écran est bas, plus l'image est réduite, sans rognage.
  await page.setViewportSize({ width: 1440, height: 700 });
  await sleep(1200);
  ok("A5 écran plus bas : l'image reste sous 70 % de la nouvelle hauteur", await until(f, () => Math.max(...[...document.querySelectorAll(".tile-frame img")].map((i) => i.offsetHeight)) <= 0.7 * innerHeight + 1));
  await page.setViewportSize({ width: 1440, height: 900 });
  // Barre de la toile : « Taille des images », aperçu immédiat puis enregistrement.
  await f.locator(`${tiles} h2`).first().click();
  await f.locator('.pe-tools button:has-text("Taille des images")').click();
  await f.getByRole("radio", { name: "Grande" }).click();
  ok("A6 barre de la toile : aperçu immédiat (data-size)", await until(f, () => document.querySelector(".tiles").getAttribute("data-size") === "large", null, 3000));
  await settled();
  ok("A6b barre de la toile : enregistrée au brouillon", await waitFor(() => tilesDraft()?.size === "large"));
  await f.getByRole("radio", { name: "Moyenne" }).click();
  await settled();
  ok("A6c retour à Moyenne", await waitFor(() => tilesDraft()?.size === "medium"));
  // Pas de nouvelle publication de la taille : le public garde le défaut (moyenne).
}

/* ---- B. Mobile -------------------------------------------------------------------------- */
console.log("== B. Mobile 390 px");
{
  const m = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await m.newPage();
  await p.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  await p.locator(".tiles").scrollIntoViewIfNeeded();
  const r = await p.evaluate(() => {
    const tile = document.querySelector(".tile");
    const img = tile.querySelector(".tile-frame img").getBoundingClientRect();
    const txt = tile.querySelector(".tile-txt").getBoundingClientRect();
    return { imgBottom: img.bottom, txtTop: txt.top, h: tile.querySelector(".tile-frame img").offsetHeight, vh: innerHeight, scroll: document.documentElement.scrollWidth - innerWidth };
  });
  ok("B1 mobile : l'image est au-dessus du texte", r.imgBottom <= r.txtTop + 1, JSON.stringify(r));
  ok("B2 mobile : hauteur de l'image <= 70 % de l'écran", r.h <= 0.7 * r.vh + 1, JSON.stringify(r));
  ok("B3 mobile : aucun défilement horizontal", r.scroll <= 0, JSON.stringify(r));
  await p.screenshot({ path: `${SHOTS}/B-mobile.png` });
  await m.close();
}

/* ---- C. Automatique --------------------------------------------------------------------- */
console.log("== C. Entrées automatiques");
const animationId = pageIdOf("animation");
{
  ok("C1 le contenu de départ est automatique (liste = pages de collection)", tilesPublished().mode === "auto" && !tilesPublished().items, JSON.stringify(tilesPublished()));
  let t = await publicTiles();
  ok("C2 accueil public : une tuile par page de collection, dans l'ordre du menu", t.map((x) => x.title).join("|") === "Personnages|Décors|Animation", JSON.stringify(t));
  ok("C2b la page Animation porte le réglage de collection", q("select collection from pages where id = ?", animationId)[0].collection === "animation");

  // Retrait : la page Animation n'est plus une page de collection.
  await page.goto(`${BASE}/admin/pages/${animationId}`, { waitUntil: "networkidle" });
  await page.getByLabel("Cette page est la collection").selectOption("");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.locator(".a-toast", { hasText: "Enregistré" }).first().waitFor({ timeout: 20000 });
  ok("C3 page retirée des collections : tuile retirée de l'accueil", await waitFor(async () => (await publicTiles()).map((x) => x.title).join("|") === "Personnages|Décors"));

  // Ajout : une page neuve, publiée, qui présente la collection Animation.
  await page.goto(`${BASE}/admin/pages`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Créer une page" }).click();
  const d = page.locator("dialog[open]");
  await d.getByLabel("Titre en français").fill("Carnets d'été");
  await d.getByLabel("Titre en anglais").fill("Summer sketchbooks");
  await d.getByLabel("Adresse en français").fill("carnets");
  await d.getByRole("button", { name: "Créer la page" }).click();
  // Lot 23 : « Créer la page » mène à l'éditeur visuel ; le formulaire (informations, collection) est l'écran voisin.
  await page.waitForURL(/\/admin\/pages\/\d+\/editer$/, { timeout: 90000 });
  const carnetsId = Number(page.url().split("/").at(-2));
  await page.goto(`${BASE}/admin/pages/${carnetsId}`, { waitUntil: "networkidle" });
  await page.locator("label.a-toggle", { hasText: "Publiée" }).click();
  ok("C4 les collections déjà prises ne sont pas proposées", !(await page.getByLabel("Cette page est la collection").locator("option[value=characters]").count()) && (await page.getByLabel("Cette page est la collection").locator("option[value=animation]").count()) === 1);
  await page.getByLabel("Cette page est la collection").selectOption("animation");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.locator(".a-toast", { hasText: "Enregistré" }).first().waitFor({ timeout: 20000 });
  ok("C5 page de collection ajoutée : tuile ajoutée, texte = titre de la page, lien vers elle", await waitFor(async () => { const x = await publicTiles(); return x.length === 3 && x[2].title === "Carnets d'été" && x[2].href === "/fr/carnets"; }), JSON.stringify(await publicTiles()));
  ok("C5b en anglais aussi", (await publicTiles("en")).at(-1)?.title === "Summer sketchbooks");
  ok("C6 une collection n'a qu'une page (index unique en base)", (() => { try { const db = new Database(DB); db.prepare("update pages set collection = 'animation' where id = ?").run(pageIdOf("personnages")); db.close(); return false; } catch { return true; } })());
  await page.screenshot({ path: `${SHOTS}/C-page-collection.png` });
  globalThis.carnetsId = carnetsId;
}

/* ---- D. Manuel : bascule, toile, lien cassé ------------------------------------------ */
console.log("== D. Entrées choisies à la main");
{
  const f = await openEditor(homeId);
  const tiles = '[data-edit-type="collection-tiles"]';
  await f.locator(`${tiles} h2`).first().click();
  await page.getByRole("tab", { name: "Réglages" }).click();
  ok("D1 panneau : « Entrées » = Automatiques (liste des pages, textes modifiables)", (await page.getByLabel("Entrées", { exact: true }).inputValue()) === "auto" && (await page.locator("[data-tile-page]").count()) === 3);
  // Texte modifié sur une tuile automatique : gardé, attaché à la page.
  const first = page.locator("[data-tile-page]").first();
  await first.getByLabel("Titre", { exact: true }).first().fill("Mes personnages");
  await settled();
  ok("D2 texte modifié sur la tuile : gardé au brouillon, attaché à la page", await waitFor(() => tilesDraft()?.edits?.[0]?.title?.fr === "Mes personnages" && tilesDraft().edits[0].pageId === pageIdOf("personnages")), JSON.stringify(tilesDraft()));
  ok("D2b rendu sur la toile", await until(f, () => [...document.querySelectorAll(".tile h3")].some((h) => h.textContent === "Mes personnages")));
  await first.getByRole("button", { name: "Reprendre les textes de la page" }).click();
  await settled();
  ok("D2c « Reprendre les textes de la page » retire la modification", await waitFor(() => !tilesDraft()?.edits));

  await page.getByLabel("Entrées", { exact: true }).selectOption("manual");
  await settled();
  ok("D3 bascule en manuel : la liste reprend les trois entrées", await waitFor(() => tilesDraft()?.mode === "manual" && tilesDraft().items.length === 3 && !tilesDraft().edits), JSON.stringify(tilesDraft()));
  ok("D3b toile : outils d'entrée et « + Ajouter une entrée »", await until(f, () => document.querySelectorAll("[data-edit-tile-op=remove]").length === 3 && Boolean(document.querySelector("[data-edit-tile-add]"))));
  ok("D3c plus aucune page de collection sans entrée : ajout désactivé", await f.evaluate(() => document.querySelector("[data-edit-tile-add]").disabled));

  // Retrait depuis la toile (au survol), puis ajout par le choix de page.
  const tile = f.locator(`${tiles} .tile`).nth(1);
  await tile.scrollIntoViewIfNeeded();
  await tile.hover();
  await tile.locator("[data-edit-tile-op=remove]").click();
  ok("D4 retirer une entrée depuis la toile", await waitFor(() => tilesDraft()?.items?.length === 2 && tilesDraft().items.every((i) => i.title.fr !== "Décors")), JSON.stringify(tilesDraft()?.items?.map((i) => i.title.fr)));
  ok("D4b la toile suit", await until(f, () => document.querySelectorAll(".tile").length === 2));
  await f.locator("[data-edit-tile-add]").scrollIntoViewIfNeeded();
  await f.locator("[data-edit-tile-add]").click();
  ok("D5 « + Ajouter une entrée » propose la page retirée", await f.getByRole("menuitem", { name: "Décors" }).isVisible());
  await f.getByRole("menuitem", { name: "Décors" }).click();
  ok("D5b entrée ajoutée en fin de liste, avec les textes du Titre de la page", await waitFor(() => tilesDraft()?.items?.length === 3 && tilesDraft().items[2].title.fr === "Décors" && tilesDraft().items[2].intro.fr.startsWith("Décors peints")), JSON.stringify(tilesDraft()?.items?.map((i) => i.title.fr)));
  ok("D5c la toile suit", await until(f, () => document.querySelectorAll(".tile").length === 3));
  const t0 = f.locator(`${tiles} .tile`).nth(0);
  await t0.scrollIntoViewIfNeeded();
  await t0.hover();
  await t0.locator("[data-edit-tile-op=down]").click();
  const order = () => tilesDraft()?.items?.map((i) => i.title.fr).join("|");
  ok("D6 descendre une entrée : la première passe en seconde", await waitFor(() => order() === "Carnets d'été|Personnages|Décors"), order());

  // Annuler / rétablir passent par l'historique de l'éditeur.
  await page.getByRole("button", { name: "Défaire", exact: true }).click();
  await settled();
  ok("D7 annuler rétablit l'ordre précédent", await waitFor(() => order() === "Personnages|Carnets d'été|Décors"), order());
  await page.getByRole("button", { name: "Rétablir", exact: true }).click();
  await settled();
  ok("D7b rétablir", await waitFor(() => order() === "Carnets d'été|Personnages|Décors"), order());
  await page.screenshot({ path: `${SHOTS}/D-manuel.png` });

  ok("D9 publication du mode manuel", await publish());
  ok("D9b public : trois tuiles dans l'ordre de la liste, mode manuel enregistré", (await waitFor(async () => (await publicTiles()).map((x) => x.title).join("|") === "Carnets d'été|Personnages|Décors")) && tilesPublished().mode === "manual");
}

/* ---- E. Lien cassé ------------------------------------------------------------------------- */
console.log("== E. Entrée vers une page dépubliée");
{
  // Dépublier la page Carnets, citée par la liste, depuis la liste des pages.
  const victimId = globalThis.carnetsId;
  const title = "Carnets d'été";
  await page.goto(`${BASE}/admin/pages`, { waitUntil: "networkidle" });
  const row = page.locator("tr", { hasText: title }).first();
  await row.getByRole("button", { name: "Dépublier" }).click();
  await page.locator(".a-toast", { hasText: "dépubliée" }).first().waitFor({ timeout: 20000 });
  ok("E1 public : l'entrée vers la page dépubliée est masquée", await waitFor(async () => { const t = await publicTiles(); return t.length === 2 && !t.some((x) => x.title === title); }), JSON.stringify(await publicTiles()));
  const f = await openEditor(homeId);
  ok("E2 toile : l'entrée cassée est signalée (et retirable)", await until(f, () => Boolean(document.querySelector("[data-tile-broken] [data-edit-tile-op=remove]"))));
  await f.locator("[data-tile-broken]").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/E-lien-casse.png` });
  await f.locator("[data-tile-broken]").first().hover();
  await f.locator("[data-tile-broken] [data-edit-tile-op=remove]").click();
  ok("E3 retirer l'entrée cassée depuis la toile", await waitFor(() => tilesDraft()?.items?.length === 2 && tilesDraft().items.every((i) => i.pageId !== victimId)), JSON.stringify(tilesDraft()?.items?.map((i) => i.pageId)));
  // Retour en automatique.
  await f.locator('[data-edit-type="collection-tiles"] h2').first().click();
  await page.getByRole("tab", { name: "Réglages" }).click();
  await page.getByLabel("Entrées", { exact: true }).selectOption("auto");
  await settled();
  ok("E4 retour en automatique : liste retirée, mode enregistré", await waitFor(() => tilesDraft()?.mode === "auto" && !tilesDraft().items));
  ok("E4b la toile montre les pages de collection publiées", await until(f, () => document.querySelectorAll(".tile").length === 2 && !document.querySelector("[data-edit-tile-add]")));
}

ok("aucune erreur de page", errors.length === 0, errors.join(" | ").slice(0, 300));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
