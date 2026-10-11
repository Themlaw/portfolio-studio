#!/usr/bin/env node
/**
 * Lot 8 (v0.15) — édition de la page d'accueil, UN chromium, clics réels.
 * Serveur dev requis, base NEUVE (admin de test).
 *
 *  A. Indicateur de défilement de l'ouverture : texte par défaut inchangé en
 *     public (fr « Faire défiler », en « Scroll »), modifiable en place, « Aa »
 *     (style local au bloc), repli par langue, masquable (case du panneau).
 *  B. Textes d'un projet depuis un bloc qui le montre : titre / présentation
 *     modifiés en place sur l'accueil → rien en ligne avant « Publier », puis
 *     visibles sur la planche d'une autre page ; indicateur au survol avec
 *     « Voir le projet » ; un même projet montré deux fois sur la page
 *     (titre lié + planche) se met à jour ensemble ; mise en forme locale au
 *     bloc (le contenu reste partagé).
 *  C. L'inverse : modifié depuis la planche d'une autre page → visible sur
 *     l'accueil après publication.
 *  D. Conflits : deuxième onglet (version de la page périmée → « modifié
 *     ailleurs ») ; deuxième page (textes tenus ailleurs → refus qui la nomme,
 *     lecture seule indiquée), libre après abandon.
 *
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… SHOTS=… node scripts/e2e-lot8.mjs
 *         ONLY=A,B (sections choisies)
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
const SHOTS = process.env.SHOTS ?? "screenshots/lot8-e2e";
const ONLY = process.env.ONLY ?? "";
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
const run = (k) => !ONLY || ONLY.split(",").includes(k);
const homeId = q("select page_id id from blocks where type = 'hero' limit 1")[0].id;
/** Attend (sondage de la base) qu'une condition devienne vraie : l'enregistrement automatique est différé. */
async function eventually(fn, timeout = 20000) {
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(300)) if (fn()) return true;
  return false;
}
const draftOf = (id) => JSON.parse(q("select draft from pages where id = ?", id)[0]?.draft ?? "null");
const project = (slug) => q("select * from projects where slug = ?", slug)[0];
const parse = (s) => (s ? JSON.parse(s) : null);

const HAUTS = "les-hauts-chemins";
// Page (autre que l'accueil) dont la planche montre ce projet.
const otherPage = q(
  "select distinct page_id id from blocks where type = 'project-board' and json_extract(props, '$.project') = ? and page_id <> ?",
  HAUTS,
  homeId,
)[0]?.id;

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

/* ---- Aides ------------------------------------------------------------------ */

const until = (f, fn, arg, timeout = 60000) =>
  f.waitForFunction(fn, arg, { timeout, polling: 200 }).then(
    () => true,
    () => false,
  );
async function canvas(p = page) {
  const handle = await p.waitForSelector("iframe.ve-frame", { timeout: 90000 });
  const f = await handle.contentFrame();
  await f.waitForSelector("html[data-edit-mode]", { timeout: 120000 });
  await sleep(1200);
  return f;
}
async function settled(p = page) {
  await p.waitForFunction(() => !/Enregistrement/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, { timeout: 90000 });
  await sleep(600);
}
async function openEditor(id, p = page) {
  if (/\/editer/.test(p.url())) await settled(p).catch(() => {});
  await p.goto(`${BASE}/admin/pages/${id}/editer`, { waitUntil: "domcontentloaded" });
  const f = await canvas(p);
  if (await p.getByRole("button", { name: "Abandonner les modifications" }).count()) {
    await p.getByRole("button", { name: "Abandonner les modifications" }).click();
    await Promise.all([
      p.waitForEvent("framenavigated", { predicate: (fr) => fr === p.mainFrame(), timeout: 60000 }),
      p.getByRole("dialog").getByRole("button", { name: "Abandonner les modifications" }).click(),
    ]);
    return canvas(p);
  }
  return f;
}
const published = (p = page) => until(p, () => /^Publié/.test(document.querySelector(".ve-status")?.textContent?.trim() ?? "") && !document.querySelector(".ve-alert[role=alert]"), null, 90000);
async function publish(p = page) {
  await p.getByRole("button", { name: "Publier" }).click();
  return published(p);
}
/** Texte en place : double-clic sur l'élément, tout sélectionner, saisir, Entrée. */
async function typeInPlace(p, f, selector, text, position = { x: 12, y: 6 }) {
  await f.locator(selector).first().scrollIntoViewIfNeeded();
  await f.locator(selector).first().dblclick({ position });
  await sleep(300);
  await p.keyboard.press("ControlOrMeta+a");
  await p.keyboard.type(text);
  await p.keyboard.press("Enter");
  await settled(p);
}
/** Survol « frais » : la souris quitte l'endroit où elle était (sinon aucun mouvement n'est émis). */
async function hover(locator, position) {
  await page.mouse.move(5, 5);
  await sleep(100);
  await locator.hover(position ? { position } : undefined);
  await sleep(250);
}
const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const get = async (url) => (await anon.request.get(`${BASE}${url}`)).text();
const reset = async () => {
  // Remise à zéro : brouillon et surcouches abandonnés.
  for (const id of [homeId, otherPage].filter(Boolean)) await openEditor(id);
};

/* ---- A. Indicateur de défilement ---------------------------------------------- */

if (run("A")) {
  const f0 = await get("/fr");
  const e0 = await get("/en");
  ok("A1 public, par défaut : « Faire défiler » (fr) et « Scroll » (en) comme avant", /class="scroll-hint/.test(f0) && /class="eyebrow[^"]*"[^>]*>Faire défiler</.test(f0) && e0.includes(">Scroll<"));
  let f = await openEditor(homeId);
  await f.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  const sel = '[data-edit-type="hero"] [data-inline="scroll"]';
  ok("A2 toile : le libellé de défilement est un texte éditable (comme l'étiquette)", (await f.locator(sel).count()) === 1 && (await f.locator(sel).textContent()).trim() === "Faire défiler");
  await typeInPlace(page, f, sel, "Descends");
  const hero = () => draftOf(homeId).blocks.find((b) => b.type === "hero").props;
  ok("A3 modifié en place : fr enregistré au brouillon, en laissé vide", hero().scroll?.fr === "Descends" && hero().scroll?.en === "", JSON.stringify(hero().scroll));
  // « Aa » : style local au bloc.
  // La saisie ouvre d'elle-même la barre typographique ; on la ferme pour essayer le bouton « Aa » du survol.
  if (await f.locator(".lk-close").count()) await f.locator(".lk-close").click();
  await hover(f.locator(sel));
  ok("A4 survol : « Aa » proposé sur ce texte", await until(f, () => Boolean(document.querySelector(".lk-aa"))));
  await f.locator(".lk-aa").click();
  await f.locator('.lk-bar button[title="Italique"]').click();
  await settled(page);
  ok("A5 typographie locale : look.text.scroll dans le bloc", await eventually(() => hero().look?.text?.scroll?.italic === true), JSON.stringify(hero().look));
  ok("A5b rendu : le libellé est en italique sur la toile", await until(f, (s) => getComputedStyle(document.querySelector(s)).fontStyle === "italic", sel));
  await page.screenshot({ path: `${SHOTS}/A-defilement-modifie.png` });
  ok("A6 publication", await publish());
  const fr = await get("/fr");
  const en = await get("/en");
  ok("A7 public fr : « Descends » ; en : repli sur « Scroll » (langue non renseignée)", /class="eyebrow[^"]*"[^>]*>Descends</.test(fr) && !/class="eyebrow[^"]*"[^>]*>Faire défiler</.test(fr) && en.includes(">Scroll<"));
  // Masquer.
  f = await openEditor(homeId);
  await f.locator('[data-edit-type="hero"] h1').first().click();
  await page.getByRole("tab", { name: "Réglages" }).click();
  await page.locator("label.a-toggle", { hasText: "Afficher l'indicateur de défilement" }).waitFor({ timeout: 30000 }).catch(async (e) => {
    await page.screenshot({ path: `${SHOTS}/A-debug-panneau.png` });
    throw e;
  });
  await page.locator("label.a-toggle", { hasText: "Afficher l'indicateur de défilement" }).click();
  await settled(page);
  ok("A8 case décochée : showScroll false au brouillon", hero().showScroll === false);
  ok("A8b toile : l'indicateur disparaît", await until(f, () => !document.querySelector(".hero .scroll-hint")));
  ok("A9 publication", await publish());
  ok("A10 public : plus d'indicateur", !/class="scroll-hint/.test(await get("/fr")));
  // Remise en état.
  f = await openEditor(homeId);
  await f.locator('[data-edit-type="hero"] h1').first().click();
  await page.getByRole("tab", { name: "Réglages" }).click();
  await page.locator("label.a-toggle", { hasText: "Afficher l'indicateur de défilement" }).click();
  await settled(page);
  ok("A11 réaffiché", await publish());
}

/* ---- B. Titre et présentation d'un projet depuis l'accueil -------------------- */

const NEW_TITLE = "Chemins élevés";
const NEW_DESC = "Présentation éditée depuis l'accueil.";
if (run("B")) {
  const before = project(HAUTS);
  let f = await openEditor(homeId);
  // Le Titre du conteneur reprend le projet : le même projet est alors montré deux fois (titre lié + planche).
  await f.locator('[data-edit-type="section-title"] h2').first().scrollIntoViewIfNeeded();
  await f.locator('[data-edit-type="section-title"] h2').first().click({ position: { x: 4, y: 4 } });
  await page.getByRole("tab", { name: "Réglages" }).click();
  await page.locator("label.a-toggle", { hasText: "Reprendre le nom et la présentation du projet" }).click();
  await settled(page);
  const linkedSel = '[data-edit-type="section-title"] h2[data-project-inline="title"]';
  ok("B1 Titre lié : son titre est éditable en place (texte du projet)", await until(f, (s) => Boolean(document.querySelector(s)), linkedSel));
  ok("B1b le titre lié montre le titre du projet", (await f.locator(linkedSel).innerText()).trim() === "Les hauts chemins");
  await f.locator(linkedSel).scrollIntoViewIfNeeded();
  // Indicateur au survol.
  await hover(f.locator(linkedSel), { x: 20, y: 10 });
  ok("B2 survol : indicateur « Texte du projet … modifié aussi sur sa planche et sa page »", await until(f, () => /Texte du projet « Les hauts chemins » — modifié aussi sur sa planche et sa page/.test(document.querySelector(".pe-project-hint")?.textContent ?? "")));
  ok("B2b lien « Voir le projet » vers l'écran du projet", (await f.locator(".pe-project-hint a").getAttribute("href")) === `/admin/projets/${before.id}`);
  await page.screenshot({ path: `${SHOTS}/B-indicateur-projet.png` });
  // Édition.
  await typeInPlace(page, f, linkedSel, NEW_TITLE);
  const after = project(HAUTS);
  ok("B3 surcouche enregistrée, ligne du projet (donc le site) inchangée", parse(after.draft_text)?.title?.fr === NEW_TITLE && after.draft_text_page_id === homeId && parse(after.title).fr === "Les hauts chemins");
  ok("B3b les deux occurrences (titre lié + planche) montrent le nouveau titre", await until(f, (t) => [...document.querySelectorAll('[data-project-inline="title"]')].filter((e) => e.textContent === t).length >= 2, NEW_TITLE));
  ok("B3c le brouillon de la page n'a pas copié le texte (une seule source)", !JSON.stringify(draftOf(homeId)).includes(NEW_TITLE));
  // Présentation depuis la planche.
  await typeInPlace(page, f, `[data-edit-board="${before.id}"][data-edit-board-label] header [data-project-inline="description"]`, NEW_DESC);
  ok("B4 présentation modifiée en place (planche) : surcouche", parse(project(HAUTS).draft_text)?.description?.fr === NEW_DESC);
  // Mise en forme locale du bloc.
  await hover(f.locator(linkedSel), { x: 20, y: 10 });
  await f.locator(".lk-aa").click();
  await f.locator('.lk-bar button[title="Italique"]').click();
  await settled(page);
  const titleBlock = () => draftOf(homeId).blocks.flatMap((b) => b.props.children ?? []).find((c) => c.type === "section-title");
  ok("B5 « Aa » sur le titre lié : mise en forme dans le bloc (look.text.title), contenu toujours au projet", (await eventually(() => titleBlock()?.props?.look?.text?.title?.italic === true)) && !JSON.stringify(draftOf(homeId)).includes(NEW_TITLE), JSON.stringify(titleBlock()?.props));
  ok("B5b la planche du même projet garde sa propre mise en forme", await f.evaluate((id) => getComputedStyle(document.querySelector(`[data-edit-board="${id}"][data-edit-board-label] header h2`)).fontStyle !== "italic", before.id));
  // Rien en ligne avant Publier.
  const anonBefore = await get("/fr");
  ok("B6 avant « Publier » : le site ne montre pas le nouveau titre", !anonBefore.includes(NEW_TITLE) && anonBefore.includes("Les hauts chemins"));
  ok("B7 publication", await publish());
  const row = project(HAUTS);
  ok("B7b projet mis à jour, surcouche vidée", parse(row.title).fr === NEW_TITLE && parse(row.description).fr === NEW_DESC && row.draft_text === null && row.draft_text_page_id === null);
  const fr = await get("/fr");
  ok("B8 accueil public : nouveau titre et présentation", fr.includes(NEW_TITLE) && fr.includes(NEW_DESC));
  const others = (await Promise.all(["/fr/personnages", "/fr/decors", "/fr/animation"].map(get))).join("\n");
  ok("B9 sa planche (page projet) montre aussi le nouveau titre", others.includes(NEW_TITLE));
  await page.screenshot({ path: `${SHOTS}/B-apres-publication.png` });
}

/* ---- C. L'inverse : depuis la planche d'une autre page -------------------------- */

const BACK = "Hauts chemins, version planche";
if (run("C") && otherPage) {
  const f = await openEditor(otherPage);
  const sel = `[data-edit-board][data-edit-board-label] [data-project-inline="title"]`;
  const mine = (await f.locator(sel).evaluateAll((els) => els.map((e) => e.textContent))).findIndex((t) => /hauts chemins|Chemins élevés/i.test(t ?? ""));
  ok("C1 la planche de l'autre page expose le titre du projet à l'édition", mine >= 0);
  await typeInPlace(page, f, `${sel} >> nth=${mine}`, BACK);
  ok("C2 surcouche tenue par CETTE page", project(HAUTS).draft_text_page_id === otherPage && parse(project(HAUTS).draft_text).title.fr === BACK);
  ok("C3 publication", await publish());
  ok("C4 accueil public : le titre suit", (await get("/fr")).includes(BACK));
  ok("C5 page projet public : le titre suit", (await get(`/fr${q("select json_extract(slug,'$.fr') s from pages where id = ?", otherPage)[0].s ? "/" + q("select json_extract(slug,'$.fr') s from pages where id = ?", otherPage)[0].s : ""}`)).includes(BACK));
}

/* ---- D. Conflits --------------------------------------------------------------- */

if (run("D")) {
  const f = await openEditor(homeId);
  // D1 : deux onglets.
  const other = await ctx.newPage();
  other.on("dialog", (d) => d.accept());
  const of = await openEditor(homeId, other);
  const titleSel = `[data-edit-board][data-edit-board-label] [data-project-inline="title"]`;
  await typeInPlace(other, of, `${titleSel} >> nth=0`, "Depuis l'onglet 2");
  ok("D1 onglet 2 : texte du projet enregistré", parse(project(HAUTS).draft_text)?.title?.fr === "Depuis l'onglet 2");
  await typeInPlace(page, f, `${titleSel} >> nth=0`, "Depuis l'onglet 1 (périmé)").catch(() => {});
  ok("D2 onglet en retard : « modifié ailleurs », rien d'écrasé", await page.getByTestId("conflict").waitFor({ state: "visible", timeout: 30000 }).then(() => true, () => false) && parse(project(HAUTS).draft_text)?.title?.fr === "Depuis l'onglet 2");
  await page.screenshot({ path: `${SHOTS}/D-conflit-onglets.png` });
  await other.close();
  // D3 : la page qui tient les textes est nommée sur l'autre page.
  if (otherPage) {
    const g = await openEditor(otherPage);
    const sel = `[data-edit-board][data-edit-board-label] [data-project-inline="title"]`;
    await g.locator(sel).first().scrollIntoViewIfNeeded();
    await hover(g.locator(sel).first(), { x: 20, y: 10 });
    ok("D3 autre page : indicateur « en cours de modification sur la page … : lecture seule »", await until(g, () => /en cours de modification sur la page .* lecture seule/.test(document.querySelector(".pe-project-hint")?.textContent ?? "")));
    await page.screenshot({ path: `${SHOTS}/D-lecture-seule.png` });
    await g.locator(sel).first().dblclick({ position: { x: 12, y: 6 } });
    await sleep(500);
    ok("D4 double-clic : pas d'éditeur ouvert (annonce de la page qui tient les textes)", (await g.locator(".pe-text-editor").count()) === 0);
    // Abandon de l'accueil : la surcouche part, l'autre page peut modifier.
    await openEditor(homeId);
    ok("D5 accueil abandonné : surcouche effacée", project(HAUTS).draft_text_page_id === null && project(HAUTS).draft_text === null);
  }
}

await reset().catch(() => {});
await browser.close();
if (errors.length) console.log(`erreurs de page : ${errors.slice(0, 3).join(" | ")}`);
console.log(failures ? `${failures} échec(s)` : "tout est vert");
process.exit(failures ? 1 : 0);
