#!/usr/bin/env node
/**
 * Lot 117 : « Entrées des collections » acceptent n'importe quelle page publiée (liste choisie à la main). UN chromium, base NEUVE (seed),
 * données SYNTHÉTIQUES (pages « Atelier ouvert » publiée et « Coulisses » non publiée, images de test).
 *
 *  A. Mode automatique inchangé : seules les pages de collection ; la page simple n'y est pas.
 *  B. Manuel : « + Ajouter une entrée » propose la page simple publiée (pas la non publiée, pas l'accueil, pas une page déjà utilisée) ;
 *     entrée sans collection ; avis « pas d'image » sur la toile ; image choisie ; texte modifié en place ; rechargement ; publication ;
 *     public FR/EN : lien correct, image, pas de compteur d'œuvres (les entrées de collection gardent le leur).
 *  E. Entrée de page simple sans image : masquée en public (repli explicite), l'avis reste sur la toile.
 *  C. Page retirée du site : entrée masquée en public, signalée sur la toile, retirable.
 *  D. Retour en automatique : liste retirée, trois tuiles, plus de « + Ajouter une entrée ».
 *  M. Admin Pages : « Ordre du menu » n'a pas de case vide (une page au titre vide a un libellé lisible).
 * Usage : BASE=… DATA_DIR=… ADMIN_EMAIL=… ADMIN_PASSWORD=… SHOTS=… node scripts/e2e-entrees117.mjs
 */
import { mkdirSync } from "node:fs";

import { chromium } from "playwright";

import { login, makeMedia, openEditor, pageIdOf, q1, settled, sleep, sql, waitFor } from "./lib/grille31d.mjs";
import { publishBlocks } from "./lib/page-draft.mjs";

const BASE = process.env.BASE ?? "http://localhost:5001";
const SHOTS = process.env.SHOTS ?? "screenshots/entrees117";
mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${String(detail).slice(0, 500)}` : ""}`);
};
const until = (f, fn, arg, timeout = 60000) => f.waitForFunction(fn, arg, { timeout, polling: 200 }).then(() => true, () => false);
const homeId = q1("select page_id id from blocks where type = 'hero' limit 1").id;
const draftOf = (id) => JSON.parse(q1("select draft from pages where id = ?", id)?.draft ?? "null");
const tilesDraft = () => draftOf(homeId)?.blocks?.find((b) => b.type === "collection-tiles")?.props;
const tilesPublished = () => JSON.parse(q1("select props from blocks where page_id = ? and type = 'collection-tiles'", homeId).props);
const anon = async (p) => (await fetch(BASE + p, { redirect: "manual" })).text();
/** Tuiles de l'accueil public : lien, titre, image, nombre de paragraphes d'étiquette (CTA, compteur). */
async function publicTiles(lang = "fr") {
  const html = await anon(`/${lang}`);
  const from = html.indexOf('class="tiles');
  const section = from < 0 ? "" : html.slice(from, html.indexOf("</section>", from));
  return [...section.matchAll(/<a[^>]*class="tile [^"]*"[^>]*href="([^"]*)"[\s\S]*?<\/a>/g)].map((m) => ({
    href: m[1],
    title: (/<h3[^>]*>([^<]*)<\/h3>/.exec(m[0])?.[1] ?? "").replace(/&#x27;/g, "'"),
    img: /<img/.test(m[0]),
    eyebrows: (m[0].match(/<p class="eyebrow/g) ?? []).length,
  }));
}

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());
await login(page, BASE);
await makeMedia(page, BASE);

async function createPage(title, titleEn, slug, slugEn, online) {
  await page.goto(`${BASE}/admin/pages`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Créer une page" }).click();
  const d = page.locator("dialog[open]");
  await d.getByLabel("Titre en français").fill(title);
  await d.getByLabel("Titre en anglais").fill(titleEn);
  await d.getByLabel("Adresse en français").fill(slug);
  await d.getByLabel("Adresse en anglais").fill(slugEn);
  await d.getByRole("button", { name: "Créer la page" }).click();
  await page.waitForURL(/\/admin\/pages\/\d+\/editer$/, { timeout: 90000 });
  const id = Number(page.url().split("/").at(-2));
  if (online) {
    await page.goto(`${BASE}/admin/pages/${id}`, { waitUntil: "networkidle" });
    await page.locator("label.a-toggle", { hasText: "En ligne" }).click();
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await page.locator(".a-toast", { hasText: "Enregistré" }).first().waitFor({ timeout: 20000 });
  }
  return id;
}
const atelierId = await createPage("Atelier ouvert", "Open studio", "atelier", "open-studio", true);
const coulissesId = await createPage("Coulisses", "Backstage", "coulisses", "backstage", false);
ok("0 pages synthétiques : « Atelier ouvert » publiée sans collection, « Coulisses » non publiée", q1("select published p, collection c from pages where id = ?", atelierId).p === 1 && q1("select collection c from pages where id = ?", atelierId).c === null && q1("select published p from pages where id = ?", coulissesId).p === 0);

console.log("== A. Automatique inchangé");
{
  const t = await publicTiles();
  ok("A1 public : trois tuiles de collection, aucune vers la page simple", t.length === 3 && !t.some((x) => x.href.includes("atelier")), JSON.stringify(t));
  const f = await openEditor(page, BASE, homeId);
  await f.locator('[data-edit-type="collection-tiles"] h2').first().click();
  await page.getByRole("tab", { name: "Réglages" }).click();
  ok("A2 panneau automatique : trois pages de collection seulement", (await page.locator("[data-tile-page]").count()) === 3 && !(await page.locator("[data-tile-page]", { hasText: "Atelier ouvert" }).count()));
}

console.log("== B. Manuel : page simple en entrée");
let ENTRY_MEDIA;
{
  const f = await openEditor(page, BASE, homeId);
  const tiles = '[data-edit-type="collection-tiles"]';
  await f.locator(`${tiles} h2`).first().click();
  await page.getByRole("tab", { name: "Réglages" }).click();
  await page.getByLabel("Entrées", { exact: true }).selectOption("manual");
  await settled(page);
  ok("B1 bascule en manuel : trois entrées de collection", await waitFor(() => tilesDraft()?.mode === "manual" && tilesDraft().items.length === 3), JSON.stringify(tilesDraft()));
  ok("B2 « + Ajouter une entrée » n'est plus désactivé : il reste des pages publiées", await until(f, () => { const b = document.querySelector("[data-edit-tile-add]"); return Boolean(b) && !b.disabled; }));
  const cands = await f.evaluate(() => JSON.parse(document.querySelector("[data-edit-tile-add]").dataset.candidates).map((c) => c.title));
  ok("B3 candidates : la page simple publiée, ni la non publiée, ni l'accueil, ni les pages déjà utilisées", cands.includes("Atelier ouvert") && !cands.includes("Coulisses") && !cands.includes("Personnages") && !cands.includes("Décors") && !cands.includes("Animation") && !cands.some((c) => /^(Accueil|Home|Page introuvable)/i.test(c)), JSON.stringify(cands));
  await f.locator("[data-edit-tile-add]").scrollIntoViewIfNeeded();
  await f.locator("[data-edit-tile-add]").click();
  await f.getByRole("menuitem", { name: "Atelier ouvert" }).click();
  const added = () => tilesDraft()?.items?.[3];
  ok("B4 entrée ajoutée : page choisie, SANS collection", await waitFor(() => tilesDraft()?.items?.length === 4 && added().pageId === atelierId && !("collection" in added())), JSON.stringify(tilesDraft()?.items));
  ok("B5 toile : avis « pas d'image » (rien d'afficher sans image) avec « Changer la couverture »", await until(f, () => Boolean(document.querySelector("[data-tile-noimage] [data-edit-tile-op=cover]"))));
  await f.locator("[data-tile-noimage]").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/B-sans-image.png` });
  await f.locator("[data-tile-noimage] [data-edit-tile-op=cover]").click({ force: true });
  await page.locator("dialog[open] li button").first().waitFor({ state: "attached", timeout: 60000 });
  await page.locator("dialog[open] li button").first().click();
  ok("B6 image choisie : mediaId sur l'entrée", await waitFor(() => typeof added()?.mediaId === "number"), JSON.stringify(added()));
  ENTRY_MEDIA = added()?.mediaId;
  ok("B7 toile : la tuile a son image, plus d'avis, quatre tuiles", await until(f, () => document.querySelectorAll(".tile").length === 4 && !document.querySelector("[data-tile-noimage]") && Boolean(document.querySelectorAll(".tile")[3].querySelector("img"))));
  const t4 = f.locator(`${tiles} .tile`).nth(3);
  await t4.scrollIntoViewIfNeeded();
  ok("B8 toile : pas de compteur d'œuvres sur l'entrée de page (2 paragraphes d'étiquette : surtitre et lien, contre 3 avec le compteur) ; les collections gardent le leur", (await t4.locator(".tile-txt p.eyebrow").count()) === 2 && (await f.locator(`${tiles} .tile`).nth(0).locator(".tile-txt p.eyebrow").count()) === 3);
  const h3 = t4.locator("h3");
  for (let k = 0; k < 4; k++) if (await h3.dblclick({ timeout: 8000 }).then(() => true, () => false)) break;
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Mon atelier");
  await page.keyboard.press("Enter");
  ok("B9 titre modifié en place : écrit dans l'entrée", await waitFor(() => added()?.title?.fr === "Mon atelier"), JSON.stringify(added()));
  await settled(page);
  await page.screenshot({ path: `${SHOTS}/B-avec-image.png` });
  const f2 = await openEditor(page, BASE, homeId);
  ok("B10 rechargement : quatre tuiles, titre et image gardés", await until(f2, () => document.querySelectorAll(".tile").length === 4 && document.querySelectorAll(".tile h3")[3].textContent === "Mon atelier" && Boolean(document.querySelectorAll(".tile")[3].querySelector("img"))));
  await settled(page);
  await page.getByRole("button", { name: "Publier", exact: true }).click();
  ok("B11 publication", await waitFor(async () => /En ligne/.test((await page.locator(".ve-status").textContent()) ?? "") && tilesPublished().items?.length === 4, 120000));
  const fr = await publicTiles("fr");
  const en = await publicTiles("en");
  const slug = JSON.parse(q1("select slug from pages where id = ?", atelierId).slug);
  ok("B12 public FR : quatre tuiles, la quatrième mène à la page, titre modifié, image, sans compteur", fr.length === 4 && fr[3].href === `/fr/${slug.fr}` && fr[3].title === "Mon atelier" && fr[3].img && fr[3].eyebrows === 2 && fr[0].eyebrows === 3, JSON.stringify(fr));
  ok("B13 public EN : lien vers la page anglaise, titre de la page", en.length === 4 && en[3].href === `/en/${slug.en}` && en[3].title === "Open studio", JSON.stringify(en));
  // Téléphone (390 px) : l'entrée de page se présente comme les autres (image au-dessus du texte, pas de défilement horizontal).
  const m = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
  const mp = await m.newPage();
  await mp.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  const geo = await mp.evaluate(() => {
    const r = (e) => e.getBoundingClientRect();
    const tiles = [...document.querySelectorAll(".tile")];
    const g = (t) => ({ imgBottom: r(t.querySelector("img")).bottom, txtTop: r(t.querySelector(".tile-txt")).top, w: r(t.querySelector("img")).width });
    return { n: tiles.length, first: g(tiles[0]), last: g(tiles[3]), scroll: document.documentElement.scrollWidth - innerWidth };
  });
  ok("B15 téléphone 390 px : image au-dessus du texte comme les autres entrées, pleine largeur, pas de défilement horizontal", geo.n === 4 && geo.last.imgBottom <= geo.last.txtTop + 1 && Math.abs(geo.last.w - geo.first.w) < 2 && geo.scroll <= 0, JSON.stringify(geo));
  await m.close();
  const anonPage = await fetch(`${BASE}${fr[3]?.href ?? "/fr/x"}`);
  ok("B14 le lien de l'entrée ouvre la page (200)", anonPage.status === 200, anonPage.status);
}

console.log("== E. Page simple sans image : masquée en public");
{
  const set = (items) => (list) => list.map((b) => (b.type === "collection-tiles" ? { ...b, props: { ...b.props, items } } : b));
  const items = tilesPublished().items;
  const noImg = items.map((i) => (i.pageId === atelierId ? (({ mediaId: _m, ...r }) => r)(i) : i));
  await publishBlocks(page, BASE, homeId, set(noImg), () => tilesPublished().items.every((i) => i.mediaId === undefined || i.pageId !== atelierId));
  ok("E1 public : l'entrée sans image est masquée (trois tuiles)", await waitFor(async () => (await publicTiles()).length === 3), JSON.stringify(await publicTiles()));
  const f = await openEditor(page, BASE, homeId);
  ok("E2 toile : l'avis reste affiché", await until(f, () => Boolean(document.querySelector("[data-tile-noimage]"))));
  await publishBlocks(page, BASE, homeId, set(items), () => tilesPublished().items.some((i) => i.pageId === atelierId && i.mediaId === ENTRY_MEDIA));
  ok("E3 image remise : l'entrée revient en public", await waitFor(async () => (await publicTiles()).length === 4));
}

console.log("== C. Page retirée du site");
{
  await page.goto(`${BASE}/admin/pages`, { waitUntil: "networkidle" });
  await page.locator("tr", { hasText: "Atelier ouvert" }).first().getByRole("button", { name: "Retirer du site" }).click();
  await page.locator(".a-toast", { hasText: "retirée du site" }).first().waitFor({ timeout: 20000 });
  ok("C1 public : l'entrée vers la page retirée est masquée", await waitFor(async () => { const t = await publicTiles(); return t.length === 3 && !t.some((x) => x.href.includes("atelier")); }), JSON.stringify(await publicTiles()));
  const f = await openEditor(page, BASE, homeId);
  ok("C2 toile : entrée signalée (page non publiée) et retirable", await until(f, () => Boolean(document.querySelector("[data-tile-broken] [data-edit-tile-op=remove]"))));
  await f.locator("[data-tile-broken]").first().scrollIntoViewIfNeeded();
  await f.locator("[data-tile-broken]").first().hover();
  await f.locator("[data-tile-broken] [data-edit-tile-op=remove]").click();
  ok("C3 retirée de la liste", await waitFor(() => tilesDraft()?.items?.length === 3 && tilesDraft().items.every((i) => i.pageId !== atelierId)), JSON.stringify(tilesDraft()?.items?.map((i) => i.pageId)));
}

console.log("== D. Retour en automatique");
{
  const f = await openEditor(page, BASE, homeId);
  await f.locator('[data-edit-type="collection-tiles"] h2').first().click();
  await page.getByRole("tab", { name: "Réglages" }).click();
  await page.getByLabel("Entrées", { exact: true }).selectOption("auto");
  await settled(page);
  ok("D1 automatique : liste retirée, trois tuiles, plus d'ajout", (await waitFor(() => tilesDraft()?.mode === "auto" && !tilesDraft().items)) && (await until(f, () => document.querySelectorAll(".tile").length === 3 && !document.querySelector("[data-edit-tile-add]"))));
}

console.log("== M. Ordre du menu : pas de case vide");
{
  // Une page du menu dont le titre français est vide : sa ligne est lisible (pas une case blanche).
  sql((db) => db.prepare("update pages set title = ?, nav_order = 99 where id = ?").run(JSON.stringify({ fr: "", en: "Backstage" }), coulissesId));
  await page.goto(`${BASE}/admin/pages`, { waitUntil: "networkidle" });
  const rows = await page.locator("#p-menu ~ * .a-sortable-item, section[aria-labelledby=p-menu] .a-sortable-item").evaluateAll((els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
  ok("M1 chaque ligne de l'ordre du menu a un libellé lisible", rows.length >= 2 && rows.every((r) => /[A-Za-zÀ-ÿ]{3,}/.test(r)), JSON.stringify(rows));
  ok("M2 la ligne sans titre dit « Page sans titre »", rows.some((r) => r.includes("Page sans titre")), JSON.stringify(rows));
  await page.screenshot({ path: `${SHOTS}/M-menu.png` });
}

ok("aucune erreur de page", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
