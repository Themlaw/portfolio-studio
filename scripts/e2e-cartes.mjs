#!/usr/bin/env node
/**
 * Cartes de rubrique et ajout de texte (lot 17c), UN chromium, UN onglet. Serveur dev requis, base NEUVE
 * (seed), une connexion. Thème « Papier de cœurs » (tuile de cœurs en fond, comme le kit de l'illustratrice)
 * posé par scripts/lib/paper-theme.mjs, page « À propos ».
 *
 *  A. Ajouter du texte : « + Ajouter un bloc » en bas de page, « + » entre deux rubriques au survol,
 *     case vide d'une grille ; « Texte » et « Titre + texte » en premier ; le texte d'aide est sélectionné
 *     en édition en place ; un texte d'aide resté tel quel refuse la publication.
 *  B. Carte d'une rubrique : interrupteur, couleur de la palette puis couleur perso, en retrait / pleine
 *     largeur, coins ; aperçu immédiat, brouillon, Annuler / Rétablir, contraste du texte, pastille d'alerte.
 *  C. Rendu public après publication : couleur calculée, marge laissant voir le papier, rayon, texte
 *     lisible (≥ 4,5:1), persistance ; rubriques sans carte inchangées.
 *  D. Carte par défaut du thème (Admin → Thèmes) utilisée par une carte sans choix ; presets intacts.
 *  P. Parité : aucune carte, aucun repère d'édition dans le HTML public des 8 presets.
 * Captures : $SHOTS (défaut screenshots/cartes17c).
 * Usage : DATA_DIR=… ADMIN_EMAIL=… ADMIN_PASSWORD=… BASE=http://localhost:3102 node scripts/e2e-cartes.mjs
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";
import sharp from "sharp";

import { installPaperTheme, PAPER_THEME_ID, PAPER_THEME_NAME } from "./lib/paper-theme.mjs";
import { activateThemeUi } from "./lib/theme-live.mjs";
import { autoOpenFine } from "./lib/zone66.mjs";
import { gotoIdle } from "./lib/idle.mjs";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const DATA = process.env.DATA_DIR ?? "data";
const DB = path.join(DATA, "portfolio.db");
const SHOTS = process.env.SHOTS ?? "screenshots/cartes17c";
const ONLY = process.env.ONLY ?? "";
mkdirSync(SHOTS, { recursive: true });
const PAGE_ID = 5;
const run = (k) => !ONLY || ONLY.split(",").includes(k);

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
const draftOf = () => JSON.parse(q("select draft from pages where id = ?", PAGE_ID)[0]?.draft || "null");
const draftBlocks = () => draftOf()?.blocks ?? [];
const publishedBlocks = () => q("select type, props from blocks where page_id = ? order by position", PAGE_ID).map((b) => ({ type: b.type, props: JSON.parse(b.props) }));
async function waitFor(fn, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(300);
  }
  return false;
}

/* ---- Couleurs ------------------------------------------------------------------------------------ */
const rgbOf = (css) => {
  const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(css);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};
const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const lum = ([r, g, b]) => {
  const f = (v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const same = (a, b) => Boolean(a && b) && a.every((v, i) => Math.abs(v - b[i]) <= 1);

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await autoOpenFine(ctx);
const page = await ctx.newPage();
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
  await sleep(600);
}
async function openEditor() {
  await page.goto(`${BASE}/admin/pages/${PAGE_ID}/editer`, { waitUntil: "domcontentloaded" });
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
  return waitFor(async () => /En ligne/.test((await page.locator(".ve-status").textContent()) ?? ""), 120000);
}
async function activateTheme(name) {
  // Lot 60 : « Utiliser ce modèle » / « En faire mon thème », puis « Publier » (scripts/lib/theme-live.mjs).
  await activateThemeUi(page, BASE, name);
}
/** Texte sélectionné dans la toile. */
const selectedText = (f) => f.evaluate(() => window.getSelection()?.toString() ?? "");
const wrapperOf = (f, uid) => f.locator(`[data-edit-block="${uid}"] > .surface-card`);
/** Style calculé de la carte d'un bloc (toile). */
const cardInfo = (f, uid) =>
  f.evaluate((u) => {
    const el = document.querySelector(`[data-edit-block="${u}"] > .surface-card`);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { on: el.getAttribute("data-surface"), width: el.getAttribute("data-width"), corners: el.getAttribute("data-corners"), bg: cs.backgroundColor, radius: parseFloat(cs.borderTopLeftRadius) || 0, marginLeft: parseFloat(cs.marginLeft) || 0, left: r.left, rectW: r.width, vw: document.documentElement.clientWidth };
  }, uid);
/** Les rubriques Texte de la page, dans l'ordre (uid lus sur la toile : ceux du brouillon changent à la publication). */
const textUids = (f) => f.locator('[data-edit-block][data-edit-type="rich-text"]:not([data-edit-parent])').evaluateAll((els) => els.map((e) => e.getAttribute("data-edit-block")));
const inkBlocks = () => draftBlocks().filter((b) => b.type === "rich-text");

/** `html { scroll-behavior: smooth }` : attendre la fin du défilement avant de mesurer. */
async function stableScroll(f) {
  let last = -1;
  for (let i = 0; i < 60; i++) {
    const y = await f.evaluate(() => window.scrollY);
    if (y === last) return;
    last = y;
    await sleep(200);
  }
}

/** Une section qui échoue ne coupe pas les suivantes : un échec nommé, une capture. */
async function section(name, fn) {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 14).join(" "));
    await page.screenshot({ path: path.join(SHOTS, `erreur-${name}.png`) }).catch(() => {});
  }
}

/* ---- Mise en place : thème, page ---------------------------------------------------------------------- */

installPaperTheme(DATA);
await activateTheme(PAPER_THEME_NAME);
let f = await openEditor();
ok("thème « Papier de cœurs » en ligne (tuile de cœurs en fond)", await f.evaluate(() => /kit\/.*\.svg/.test(getComputedStyle(document.body).backgroundImage)), await f.evaluate(() => getComputedStyle(document.body).backgroundImage));
const baseCount = await f.locator("[data-edit-block]:not([data-edit-parent])").count();

/* ---- A. Ajouter du texte ----------------------------------------------------------------------------------- */

if (run("A") || run("B") || run("C"))
  await section("A", async () => {
  const addEnd = f.locator('[data-edit-add="end"]');
  await addEnd.scrollIntoViewIfNeeded();
  ok("A1 « + Ajouter un bloc » toujours visible en bas de page", (await addEnd.isVisible()) && /Ajouter un bloc/.test((await addEnd.textContent()) ?? ""));
  await page.screenshot({ path: path.join(SHOTS, "a1-bouton-bas.png") });
  // La barre de style (fenêtre ancrée, lot 65) peut recouvrir « + Ajouter » : on la ferme comme le ferait l'artiste.
  await f.evaluate(() => document.querySelector(".lk-bar .lk-close")?.click());
  await addEnd.click();
  const dlg = page.locator("dialog.ve-add");
  ok("A2 le choix illustré s'ouvre", await dlg.waitFor({ timeout: 20000 }).then(() => true, () => false));
  const cards = dlg.locator(".ve-add-card");
  const first = [(await cards.nth(0).getAttribute("data-starter")), (await cards.nth(1).getAttribute("data-starter")), (await cards.nth(2).getAttribute("data-starter"))];
  ok("A2 « Texte », « Titre » et « Titre + texte » en premier", first.join() === "text,title,title-text" && /Texte/.test((await cards.nth(0).textContent()) ?? "") && /Titre \+ texte/.test((await cards.nth(2).textContent()) ?? ""), first.join());
  ok("A2 les autres composants suivent (avec leur vignette)", (await cards.count()) > 6 && (await dlg.locator(".ve-add-card .ve-thumb").count()) === (await cards.count()));
  await page.screenshot({ path: path.join(SHOTS, "a2-choix-illustre.png") });
  await cards.nth(2).click();
  ok("A3 « Titre + texte » ajouté à la fin de la page", await waitFor(() => draftBlocks().length === baseCount + 1 && draftBlocks().at(-1).type === "rich-text" && draftBlocks().at(-1).props.title?.fr === "Titre du bloc"));
  ok("A3 édition en place ouverte sur le titre, texte d'aide sélectionné", (await f.locator('[data-editing][data-inline="title"]').waitFor({ timeout: 60000 }).then(() => true, () => false)) && (await selectedText(f)) === "Titre du bloc", await selectedText(f));
  await page.screenshot({ path: path.join(SHOTS, "a3-edition-en-place.png") });
  // Un texte d'aide resté tel quel : accepté dans le brouillon (enregistré, aucun bandeau d'erreur), refusé à la publication seulement.
  await page.keyboard.press("Escape");
  await settled();
  ok("A3b texte d'aide laissé tel quel : brouillon enregistré (état « enregistré », pas de bandeau d'erreur)", (await waitFor(() => draftBlocks().at(-1)?.props.title?.fr === "Titre du bloc" && draftBlocks().at(-1)?.props.paragraphs?.[0]?.fr === "Écris ton texte ici.")) && /enregistré|Modifications non publiées/i.test((await page.locator(".ve-status").textContent()) ?? "") && (await page.locator(".ve-alert").count()) === 0, (await page.locator(".ve-status").textContent()) ?? "");
  await page.getByRole("button", { name: "Publier", exact: true }).click();
  ok("A4 texte d'aide resté tel quel : publication refusée, message clair", await page.getByText(/Remplace le texte d'exemple/).first().waitFor({ timeout: 60000 }).then(() => true, () => false));
  ok("A4 le message de refus vient de la publication (bandeau), le brouillon reste enregistré", (await page.locator(".ve-alert").count()) === 1 && /enregistré|Modifications non publiées/i.test((await page.locator(".ve-status").textContent()) ?? ""));
  // Saisie du titre puis du paragraphe.
  await f.locator('[data-edit-type="rich-text"] [data-inline="title"]').last().dblclick();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Mes carnets d'été");
  await page.keyboard.press("Enter");
  ok("A5 titre saisi en place, enregistré", await waitFor(() => inkBlocks().at(-1)?.props.title?.fr === "Mes carnets d'été"));
  ok("A5 le bandeau périmé disparaît dès qu'on modifie le brouillon", await page.locator(".ve-alert").waitFor({ state: "detached", timeout: 20000 }).then(() => true, () => false));
  await f.locator('[data-edit-type="rich-text"] [data-inline="paragraphs.0"]').last().dblclick();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Croquis d'observation au bord de l'eau, pris sur le vif pendant deux semaines de vacances.");
  await page.keyboard.press("Enter");
  ok("A5 paragraphe saisi en place, enregistré", await waitFor(() => /Croquis/.test(inkBlocks().at(-1)?.props.paragraphs?.[0]?.fr ?? "")));
  await settled();

  // « + » entre deux rubriques, au survol de la frontière.
  const tops = draftBlocks();
  const uidA = tops[0].uid;
  const uidB = tops[1].uid;
  // La frontière au milieu de la fenêtre (pas contre le bord haut de la toile).
  await f.evaluate((u) => {
    const top = document.querySelector(`.pe-focus[data-uid="${u}"]`).getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: Math.max(0, top - 300), behavior: "instant" });
  }, uidB);
  await stableScroll(f);
  const boxA = await f.locator(`.pe-focus[data-uid="${uidA}"]`).boundingBox();
  const boxB = await f.locator(`.pe-focus[data-uid="${uidB}"]`).boundingBox();
  const edge = (boxA.y + boxA.height + boxB.y) / 2;
  const gx = boxA.x + 240;
  await f.evaluate(() => {
    window.__pm = null;
    document.addEventListener("pointermove", (e) => (window.__pm = [Math.round(e.clientY), e.target.tagName, String(e.target.className).slice(0, 30)]), true);
  });
  // La barre de style (fenêtre ancrée, lot 65) peut recouvrir le « + » : on la ferme comme le ferait l'artiste.
  await f.evaluate(() => document.querySelector(".lk-bar .lk-close")?.click());
  await page.mouse.move(gx, edge - 60);
  await page.mouse.move(gx, edge, { steps: 6 });
  const gapBtn = f.locator(".pe-gap button");
  const gapShown = await gapBtn.waitFor({ timeout: 20000 }).then(() => true, () => false);
  ok("A6 « + » entre deux rubriques au survol de la frontière", gapShown, JSON.stringify({ boxA, boxB, edge, state: await f.evaluate(() => ({ pm: window.__pm, sy: scrollY, ih: innerHeight, focus: [...document.querySelectorAll(".pe-focus")].map((b) => [b.dataset.uid, Math.round(b.getBoundingClientRect().top), Math.round(b.getBoundingClientRect().bottom)]) })) }));
  await page.screenshot({ path: path.join(SHOTS, "a6-entre-deux-rubriques.png") });
  await gapBtn.click();
  await dlg.waitFor({ timeout: 20000 });
  ok("A6 le choix annonce l'endroit visé", /Entre deux blocs/.test((await dlg.locator(".ve-add-where").textContent()) ?? ""));
  await dlg.locator('[data-starter="text"]').click();
  ok("A6 « Texte » inséré entre les deux rubriques, sans titre", await waitFor(() => draftBlocks()[1]?.type === "rich-text" && draftBlocks()[1].props.title === undefined && draftBlocks()[1].props.paragraphs?.[0]?.fr === "Écris ton texte ici."));
  ok("A6 édition en place sur le paragraphe, texte d'aide sélectionné", (await f.locator('[data-editing][data-inline="paragraphs.0"]').waitFor({ timeout: 60000 }).then(() => true, () => false)) && (await selectedText(f)) === "Écris ton texte ici.");
  await page.keyboard.type("Un petit mot de l'atelier : les feutres sont rangés, la saison commence.");
  await page.keyboard.press("Enter");
  ok("A6 texte saisi d'une frappe sur le texte d'aide", await waitFor(() => /feutres/.test(draftBlocks()[1]?.props.paragraphs?.[0]?.fr ?? "")));
  await settled();

  // Case vide d'une grille : « Texte ».
  await f.locator('[data-edit-add="end"]').scrollIntoViewIfNeeded();
  // La barre de style (fenêtre ancrée, lot 65) peut recouvrir « + Ajouter » : on la ferme comme le ferait l'artiste.
  await f.evaluate(() => document.querySelector(".lk-bar .lk-close")?.click());
  await f.locator('[data-edit-add="end"]').click();
  await dlg.waitFor({ timeout: 20000 });
  await dlg.locator('.ve-add-card[data-key="grid"]').click();
  ok("A7 grille ajoutée", await waitFor(() => draftBlocks().at(-1)?.type === "grid"));
  const cellBtn = f.locator("[data-edit-cell-text]").first();
  ok("A7 la case vide propose « Texte »", await cellBtn.waitFor({ timeout: 60000 }).then(() => true, () => false));
  await cellBtn.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "a7-case-vide.png") });
  await cellBtn.click();
  ok("A7 « Texte » ajouté DANS la grille", await waitFor(() => draftBlocks().at(-1)?.props.children?.[0]?.type === "rich-text"));
  ok("A7 édition en place ouverte dans la case", await f.locator('[data-editing][data-inline="paragraphs.0"]').waitFor({ timeout: 60000 }).then(() => true, () => false));
  await page.keyboard.type("Dans la grille");
  await page.keyboard.press("Enter");
  ok("A7 texte de la case enregistré", await waitFor(() => draftBlocks().at(-1)?.props.children?.[0]?.props.paragraphs?.[0]?.fr === "Dans la grille"));
  // La grille de l'essai est retirée.
  await settled();
  const gridUid = draftBlocks().at(-1).uid;
  await f.evaluate((u) => document.querySelector(`.pe-focus[data-uid="${u}"]`)?.click(), gridUid);
  await f.locator('.pe-tools [aria-label="Supprimer"]').click();
  await page.locator("dialog[open]").getByRole("button", { name: /Supprimer/ }).click();
  ok("A7 grille de l'essai retirée", await waitFor(() => draftBlocks().every((b) => b.type !== "grid")));
  await settled();

  // Panneau « Ajouter » : les deux rubriques de texte sont en tête.
  await page.getByRole("tab", { name: "Ajouter" }).click();
  const starters = page.locator(".ve-starters .ve-starter");
  ok("A8 panneau « Ajouter » : « Texte », « Titre » et « Titre + texte » en tête", (await starters.count()) === 3 && /Texte/.test((await starters.first().textContent()) ?? ""));
});

/* ---- B. Carte d'une rubrique ----------------------------------------------------------------------------------- */

let uidFirst = "";
let uidSecond = "";
if (run("B") || run("C"))
  await section("B", async () => {
  const texts = inkBlocks();
  uidFirst = texts[0].uid; // « Texte » (sans titre)
  uidSecond = texts[1].uid; // « Titre + texte »
  const sectionOf = (uid) => f.locator(`[data-edit-block="${uid}"] section`).first();
  await f.locator(`[data-edit-block="${uidFirst}"]`).scrollIntoViewIfNeeded().catch(() => {});
  await f.locator(`.pe-focus[data-uid="${uidFirst}"]`).scrollIntoViewIfNeeded();
  await sectionOf(uidFirst).click({ position: { x: 40, y: 30 } });
  const fond = f.locator(".pe-tools [data-testid=\"fond-button\"]");
  ok("B1 le bloc a UN bouton « Fond » dans sa barre d'outils (lot 66 : la « Carte » est fusionnée au « Fond »)", await fond.waitFor({ timeout: 30000 }).then(() => true, () => false) && /^Fond/.test((await fond.textContent()) ?? ""));
  ok("B1 pas de carte au départ (l'enveloppe est sans boîte)", (await cardInfo(f, uidFirst))?.on === "off");
  await fond.click();
  const menu = f.locator('[data-testid="fond-menu"]');
  ok("B1 le popover s'ouvre (nature « Aucun » cochée : pas de carte)", (await menu.waitFor({ timeout: 20000 }).then(() => true, () => false)) && (await menu.locator('[data-testid="fond-section-carte"] [data-kind][aria-checked=true]').getAttribute("data-kind")) === "none");
  await menu.locator('[data-testid="fond-section-carte"] [data-kind="color"]').click();
  // Aperçu immédiat : avant tout aller-retour avec le serveur.
  const info = await cardInfo(f, uidFirst);
  ok("B2 carte activée : aperçu immédiat (fond coloré, retrait, coins arrondis)", info.on === "on" && info.bg !== "rgba(0, 0, 0, 0)" && info.width === "inset" && info.corners === "round" && info.radius >= 12 && info.marginLeft > 0, JSON.stringify(info));
  ok("B2 le brouillon reçoit la carte (lot 100 : étendue et papier « sous » ; couleur et coins : ceux du thème)", await waitFor(() => JSON.stringify(inkBlocks()[0]?.props.surface) === JSON.stringify({ width: "inset", paper: "under" })), JSON.stringify(inkBlocks()[0]?.props.surface));
  const themeRgb = await f.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const probe = (v) => {
      const p = document.createElement("i");
      p.style.color = `var(${v})`;
      document.body.append(p);
      const c = getComputedStyle(p).color;
      p.remove();
      return c;
    };
    return { surface: probe("--t-color-surface"), primary: probe("--t-color-primary"), ink: probe("--t-color-ink"), bg: probe("--t-color-bg"), bgDeep: probe("--t-color-bg-deep"), gutter: cs.getPropertyValue("--t-space-gutter") };
  });
  ok("B2 par défaut : couleur « Surface » du thème", same(rgbOf((await cardInfo(f, uidFirst)).bg), rgbOf(themeRgb.surface)), `${(await cardInfo(f, uidFirst)).bg} vs ${themeRgb.surface}`);
  await page.screenshot({ path: path.join(SHOTS, "b2-popover-ouvert.png") });

  // Couleur de la palette : « Action ».
  await menu.locator('[data-token="primary"]').click();
  ok("B3 pastille « Action » : fond de la carte = action du thème, immédiat", same(rgbOf((await cardInfo(f, uidFirst)).bg), rgbOf(themeRgb.primary)));
  ok("B3 brouillon : color = jeton « primary »", await waitFor(() => inkBlocks()[0]?.props.surface?.color === "primary"));
  const para = f.locator(`[data-edit-block="${uidFirst}"] [data-inline="paragraphs.0"]`);
  const colors = async (loc) => loc.evaluate((el) => ({ fg: getComputedStyle(el).color, bg: getComputedStyle(el.closest(".surface-card")).backgroundColor }));
  let c1 = await colors(para);
  // Couleur en cours de transition : le navigateur la rend parfois en `color(srgb …)` ; on attend une valeur rgb() stable.
  for (let i = 0; i < 20 && (!rgbOf(c1.fg) || !rgbOf(c1.bg)); i++) {
    await sleep(150);
    c1 = await colors(para);
  }
  ok("B3 texte lisible dans la carte « Action » (≥ 4,5:1)", ratio(rgbOf(c1.fg), rgbOf(c1.bg)) >= 4.5, `${c1.fg} sur ${c1.bg} = ${ratio(rgbOf(c1.fg), rgbOf(c1.bg)).toFixed(2)}`);

  // Couleur perso par « Autre couleur… ».
  await menu.getByRole("button", { name: "Couleur personnalisée" }).click();
  const hex = f.locator('.cp input[aria-label="Code couleur"]');
  await hex.waitFor({ timeout: 20000 });
  await hex.fill("#f6d6e4");
  await hex.press("Enter");
  ok("B4 couleur perso #f6d6e4 : appliquée à l'instant", await waitFor(async () => same(rgbOf((await cardInfo(f, uidFirst)).bg), hexRgb("#f6d6e4")), 10000));
  ok("B4 brouillon : color = #f6d6e4", await waitFor(() => inkBlocks()[0]?.props.surface?.color === "#f6d6e4"), JSON.stringify(inkBlocks()[0]?.props.surface));
  await page.keyboard.press("Escape");
  await sleep(300);
  if (!(await menu.isVisible())) await fond.click();
  await menu.waitFor();

  // Largeur et coins.
  await menu.locator('[data-testid="fond-section-fond"] [data-kind="color"]').click();
  const full = await cardInfo(f, uidFirst);
  ok("B5 « Pleine largeur » : bord à bord", full.width === "full" && full.marginLeft === 0 && Math.abs(full.left) < 1 && Math.abs(full.rectW - full.vw) < 2, JSON.stringify(full));
  // Lot 100 : on revient à la carte seule (en retrait) en retirant le Fond, puis la Carte, puis en la reposant : forme canonique d'une carte seule.
  await menu.locator('[data-testid="fond-section-fond"] [data-kind="none"]').click();
  await menu.locator('[data-testid="fond-section-carte"] [data-kind="none"]').click();
  await menu.locator('[data-testid="fond-section-carte"] [data-kind="color"]').click();
  await sleep(600);
  const inset = await cardInfo(f, uidFirst);
  const gutterPx = await f.evaluate(() => {
    const p = document.createElement("i");
    p.style.cssText = "display:block;position:absolute;width:var(--t-space-gutter)";
    document.body.append(p);
    const w = p.getBoundingClientRect().width;
    p.remove();
    return w;
  });
  const pageMaxPx = await f.evaluate(() => { const p = document.createElement("i"); p.style.cssText = "display:block;position:absolute;width:var(--t-space-page-max)"; document.body.append(p); const w = p.getBoundingClientRect().width; p.remove(); return w; });
  const expectedMx = Math.min(gutterPx, gutterPx / 2 + Math.max(0, (inset.vw - pageMaxPx) / 2));
  ok("B5 « En retrait » : marge latérale = gouttière du thème (rapprochée du bord sur un écran étroit, lot 47b)", inset.width === "inset" && Math.abs(inset.marginLeft - expectedMx) < 9, `${JSON.stringify(inset)} gouttière ${gutterPx}`);
  await menu.locator('[data-corners="square"]').click();
  ok("B6 « Coins droits » : rayon nul", (await cardInfo(f, uidFirst)).radius === 0);
  await menu.locator('[data-corners="m"]').click();
  const round = await cardInfo(f, uidFirst);
  ok("B6 Coins « Moyen » : rayon de 20 px (≥ 12 px)", round.radius >= 12, String(round.radius));
  ok("B6 brouillon : width = inset, corners = m", await waitFor(() => inkBlocks()[0]?.props.surface?.width === "inset" && inkBlocks()[0].props.surface.corners === "m"), JSON.stringify(inkBlocks()[0]?.props.surface));

  // Contraste : une teinte moyenne n'est lisible avec aucun des textes du thème.
  await menu.getByRole("button", { name: "Couleur personnalisée" }).click();
  await hex.waitFor({ timeout: 20000 });
  await hex.fill("#808080");
  await hex.press("Enter");
  ok("B7 teinte moyenne : pastille d'alerte au bouton « Carte » et message dans le popover (jamais bloquant)", (await f.locator(".pe-tools .sm-alert").waitFor({ timeout: 20000 }).then(() => true, () => false)) && (await f.getByTestId("fond-warning").isVisible()), "");
  await page.screenshot({ path: path.join(SHOTS, "b7-alerte-contraste.png") });
  ok("B7 l'enregistrement n'est pas bloqué", await waitFor(() => inkBlocks()[0]?.props.surface?.color === "#808080"));
  await hex.fill("#f6d6e4");
  await hex.press("Enter");
  ok("B7 teinte lisible : l'alerte disparaît", await f.locator(".pe-tools .sm-alert").waitFor({ state: "detached", timeout: 20000 }).then(() => true, () => false));
  await page.keyboard.press("Escape");
  await settled();

  // Annuler / Rétablir passent par l'historique de l'éditeur : UN PAS PAR RÉGLAGE DISTINCT. Deux clics du popover (une couleur de la
  // palette, puis la largeur) enchaînés bien en moins de 1,2 s ne sont jamais fusionnés ; seuls les glissements continus (roue, curseurs) le sont.
  const look = (s) => ({ color: s?.color ?? null, width: s?.width ?? "inset" });
  const surfaceNow = () => look(inkBlocks()[0]?.props.surface);
  // La teinte lisible du B7 doit être arrivée au brouillon avant de photographier l'état de départ (sinon course : s0 = l'ancienne couleur).
  await waitFor(() => inkBlocks()[0]?.props.surface?.color === "#f6d6e4");
  const s0 = surfaceNow();
  const s1 = { ...s0, color: "primary" };
  const s2 = { ...s1, color: "secondary" }; // lot 100 : la largeur n'est plus un réglage de la carte (elle vient du Fond) ; le second réglage enchaîné est la taille des coins
  if (!(await menu.isVisible())) await fond.click();
  await menu.waitFor();
  await menu.locator('[data-token="primary"]').click();
  await menu.locator('[data-token="secondary"]').click();
  ok("B8 deux réglages enchaînés : le brouillon porte les deux", await waitFor(() => JSON.stringify(surfaceNow()) === JSON.stringify(s2)), JSON.stringify(surfaceNow()));
  await settled();
  await page.keyboard.press("Escape");
  await settled();
  const undo = page.locator('button.a-icon-btn[aria-label="Défaire"]');
  const redo = page.locator('button.a-icon-btn[aria-label="Rétablir"]');
  await undo.click();
  ok("B8 Annuler (1er pas) : seul le second réglage (couleur) est défait, la première couleur reste", await waitFor(() => JSON.stringify(surfaceNow()) === JSON.stringify(s1)), JSON.stringify(surfaceNow()));
  await undo.click();
  ok("B8 Annuler (2e pas) : la couleur d'avant revient", await waitFor(() => JSON.stringify(surfaceNow()) === JSON.stringify(s0)), JSON.stringify(surfaceNow()));
  await redo.click();
  ok("B8 Rétablir (1er pas) : la première couleur revient", await waitFor(() => JSON.stringify(surfaceNow()) === JSON.stringify(s1)), JSON.stringify(surfaceNow()));
  await redo.click();
  ok("B8 Rétablir (2e pas) : le second réglage revient", await waitFor(() => JSON.stringify(surfaceNow()) === JSON.stringify(s2)), JSON.stringify(surfaceNow()));
  // Retour à l'état d'avant le test pour la suite (deux pas, un par réglage).
  await undo.click();
  await undo.click();
  ok("B8 retour à l'état d'avant (deux Annuler)", await waitFor(() => JSON.stringify(surfaceNow()) === JSON.stringify(s0)), JSON.stringify(surfaceNow()));
  await settled();

  // Deuxième rubrique : carte sombre (jeton « Texte »), pleine largeur, coins droits.
  await f.locator(`.pe-focus[data-uid="${uidSecond}"]`).scrollIntoViewIfNeeded();
  await sectionOf(uidSecond).click({ position: { x: 40, y: 30 } });
  await fond.click();
  await menu.locator('[data-testid="fond-section-carte"] [data-kind="color"]').click();
  await menu.locator('[data-token="ink"]').click();
  await menu.locator('[data-testid="fond-section-fond"] [data-kind="color"]').click();
  await menu.locator('[data-testid="fond-section-fond"] [data-token="ink"]').click();
  await menu.locator('[data-corners="square"]').click();
  const inkInfo = await cardInfo(f, uidSecond);
  ok("B9 deuxième rubrique : carte sombre, pleine largeur (lot 100 : coins du thème)", same(rgbOf(inkInfo.bg), rgbOf(themeRgb.ink)) && inkInfo.width === "full", JSON.stringify(inkInfo));
  const c2 = await colors(f.locator(`[data-edit-block="${uidSecond}"] [data-inline="paragraphs.0"]`));
  const c2t = await colors(f.locator(`[data-edit-block="${uidSecond}"] [data-inline="title"]`));
  ok("B9 texte inversé automatiquement sur la carte sombre (titre = fond du thème, paragraphe ≥ 4,5:1)", ratio(rgbOf(c2.fg), rgbOf(c2.bg)) >= 4.5 && same(rgbOf(c2t.fg), rgbOf(themeRgb.bg)), `${c2.fg} / ${c2t.fg} sur ${c2.bg}`);
  ok("B9 brouillon de la deuxième carte", await waitFor(() => inkBlocks()[1]?.props.surface?.color === "ink" && inkBlocks()[1]?.props.surface?.width === "full", 30000), JSON.stringify(inkBlocks()[1]?.props.surface));
  await page.keyboard.press("Escape");
  await f.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
  await settled();
  // Bloc de conteneur : pas de bouton Fond (la carte est celle d'une rubrique de premier niveau).
  await page.screenshot({ path: path.join(SHOTS, "b9-deux-cartes-toile.png") });
});

/* ---- C. Rendu public ------------------------------------------------------------------------------------------- */

if (run("C"))
  await section("C", async () => {
  ok("C0 publication", await publish(), `${await page.locator(".ve-status").textContent()} | ${(await page.locator('[role="alert"], .ve-banner, .a-alert').allTextContents()).join(" / ").slice(0, 300)}`);
  const published = publishedBlocks().filter((b) => b.type === "rich-text");
  ok("C0 les cartes sont publiées avec le bloc", published.length === 2 && JSON.stringify(published[0].props.surface) === JSON.stringify({ color: "#f6d6e4", width: "inset", corners: "m", paper: "under" }) && published[1].props.surface?.color === "ink", JSON.stringify(published.map((p) => p.props.surface)));
  const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pub = await anon.newPage();
  await pub.goto(`${BASE}/fr/a-propos`, { waitUntil: "networkidle" });
  const html = await pub.content();
  ok("C1 public : aucun repère d'édition", !/data-edit-|pe-add-end|data-card-default/.test(html));
  const cards = await pub.evaluate(() =>
    [...document.querySelectorAll(".surface-card")].map((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const text = el.querySelector("p, h2");
      const first = el.querySelector("h2, p");
      const last = [...el.querySelectorAll("p")].at(-1);
      const gapTop = first ? first.getBoundingClientRect().top - r.top : 0;
      const gapBottom = last ? r.bottom - last.getBoundingClientRect().bottom : 0;
      return { gapTop, gapBottom, bg: cs.backgroundColor, radius: parseFloat(cs.borderTopLeftRadius) || 0, left: r.left + scrollX, width: r.width, top: r.top + scrollY, height: r.height, vw: document.documentElement.clientWidth, fg: text ? getComputedStyle(text).color : "", width_attr: el.getAttribute("data-width") };
    }),
  );
  ok("C1 public : deux cartes", cards.length === 2, String(cards.length));
  const [c1, c2] = cards;
  ok("C2 carte 1 : couleur calculée #f6d6e4, en retrait, coins arrondis", same(rgbOf(c1.bg), hexRgb("#f6d6e4")) && c1.left > 20 && c1.width < c1.vw - 40 && c1.radius >= 12, JSON.stringify(c1));
  ok("C2 carte 2 : couleur du texte du thème, bord à bord, coins du thème", c2.left < 1 && Math.abs(c2.width - c2.vw) < 2 && c2.bg !== c1.bg, JSON.stringify(c2));
  ok("C2b carte 1 : padding symétrique (rien ne s'ajoute en haut, pas de titre vide)", Math.abs(c1.gapTop - c1.gapBottom) <= 8 && c1.gapTop < 80, `haut ${c1.gapTop.toFixed(1)} px, bas ${c1.gapBottom.toFixed(1)} px`);
  ok("C2b carte 2 : padding symétrique", Math.abs(c2.gapTop - c2.gapBottom) <= 12, `haut ${c2.gapTop.toFixed(1)} px, bas ${c2.gapBottom.toFixed(1)} px`);
  ok("C3 texte lisible dans chaque carte (≥ 4,5:1)", cards.every((c) => ratio(rgbOf(c.fg), rgbOf(c.bg)) >= 4.5), cards.map((c) => `${c.fg}/${c.bg}`).join(" | "));
  // Le papier se voit dans la marge de la carte en retrait (pas dans la carte, bord à bord).
  await pub.evaluate((y) => window.scrollTo(0, Math.max(0, y - 120)), c1.top);
  await sleep(500);
  const rect1 = await pub.evaluate(() => {
    const r = document.querySelector(".surface-card").getBoundingClientRect();
    return { top: r.top, height: r.height, left: r.left };
  });
  const strip = await pub.screenshot({ clip: { x: 0, y: Math.max(0, rect1.top + 8), width: Math.max(8, rect1.left - 6), height: Math.max(8, Math.min(rect1.height - 16, 400)) } });
  const { data } = await sharp(strip).raw().toBuffer({ resolveWithObject: true });
  const seen = new Set();
  for (let i = 0; i < data.length; i += 3) seen.add(`${data[i] >> 3},${data[i + 1] >> 3},${data[i + 2] >> 3}`);
  ok("C4 la marge d'une carte en retrait laisse voir le papier (cœurs)", seen.size >= 3, `${seen.size} couleurs dans la marge`);
  const inCard = await pub.screenshot({ clip: { x: rect1.left + 30, y: Math.max(0, rect1.top + 8), width: 40, height: 40 } });
  const cardPixels = await sharp(inCard).raw().toBuffer();
  ok("C4 dans la carte, le papier est caché (aplat)", new Set([...Array(cardPixels.length / 3).keys()].map((i) => `${cardPixels[i * 3]},${cardPixels[i * 3 + 1]},${cardPixels[i * 3 + 2]}`)).size <= 2);
  await pub.screenshot({ path: path.join(SHOTS, "c-public-deux-cartes.png"), fullPage: true });
  ok("C5 les autres rubriques n'ont pas de carte (profil inchangé)", (await pub.locator(".surface-card").count()) === 2 && (await pub.locator("main").evaluate((m) => m.children.length)) > 2);
  // C8. Espacement de section autour des cartes : une carte garde, vis-à-vis de ses voisins, l'écart normal du thème
  // (celui de deux rubriques sans carte), mesuré du bord de la carte au contenu voisin.
  const measureGaps = async (p) =>
    p.evaluate(() => {
      const LEAF = "h1,h2,h3,h4,p,a,button,img,figure,li,blockquote,input,textarea,label,video,[class*='frame']";
      const extent = (el) => {
        const rs = [...el.querySelectorAll(LEAF)].map((n) => n.getBoundingClientRect()).filter((r) => r.height > 0 && r.width > 0);
        return rs.length ? { top: Math.min(...rs.map((r) => r.top)) + scrollY, bottom: Math.max(...rs.map((r) => r.bottom)) + scrollY } : null;
      };
      const main = document.querySelector("main");
      const kidsNow = () => [...main.children].filter((el) => el.getBoundingClientRect().height > 0);
      const isCard = (el) => el.classList.contains("surface-card");
      const abs = (el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top + scrollY, bottom: r.bottom + scrollY };
      };
      const kids = kidsNow();
      const cards = kids.filter(isCard);
      const firstCard = kids.indexOf(cards[0]);
      const last = cards.at(-1);
      const footer = document.querySelector("footer");
      const proto = cards[0]?.querySelector(":scope > .card-in > section, :scope > section");
      // Références : la MÊME rubrique sans carte (copie de la section de la première carte), posée à la place de la carte.
      const clone = () => proto.cloneNode(true);
      const before = firstCard > 0 && !isCard(kids[firstCard - 1]) ? extent(kids[firstCard - 1]) : null;
      let refAfterPlain = null;
      let refPair = null;
      let refFooter = null;
      if (proto) {
        const c1 = clone();
        main.insertBefore(c1, cards[0]);
        if (before) refAfterPlain = extent(c1).top - before.bottom;
        const c2 = clone();
        main.insertBefore(c2, cards[0]);
        refPair = extent(c2).top - extent(c1).bottom;
        c1.remove();
        c2.remove();
        if (kids.at(-1) === last && footer) {
          const c3 = clone();
          main.append(c3);
          refFooter = footer.getBoundingClientRect().top + scrollY - extent(c3).bottom;
          c3.remove();
        }
      }
      return {
        refAfterPlain,
        refPair,
        refFooter,
        afterPlain: before ? abs(cards[0]).top - before.bottom : null,
        cardToCard: cards.length >= 2 && kids.indexOf(cards[1]) === firstCard + 1 ? abs(cards[1]).top - abs(cards[0]).bottom : null,
        beforeFooter: footer && kids.at(-1) === last ? footer.getBoundingClientRect().top + scrollY - abs(last).bottom : null,
      };
    });
  for (const [label, width] of [["1440", 1440], ["390", 390]]) {
    const ctxW = await browser.newContext({ viewport: { width, height: 900 } });
    const pw = await ctxW.newPage();
    await pw.goto(`${BASE}/fr/a-propos`, { waitUntil: "networkidle" });
    const g = await measureGaps(pw);
    const near = (v, ref) => ref != null && v != null && Math.abs(v - ref) <= 4;
    ok(`C8 (${label} px) références mesurables (même rubrique sans carte)`, [g.refAfterPlain, g.refPair, g.refFooter].every((v) => v != null && v > 8), JSON.stringify(g));
    ok(`C8 (${label} px) carte après un bloc sans carte : écart = celui de deux rubriques sans carte (${g.refAfterPlain?.toFixed(1)} px)`, near(g.afterPlain, g.refAfterPlain), `${g.afterPlain?.toFixed(1)} px`);
    ok(`C8 (${label} px) deux cartes consécutives : séparées de l'écart normal (${g.refPair?.toFixed(1)} px), pas collées`, near(g.cardToCard, g.refPair) && g.cardToCard > 8, `${g.cardToCard?.toFixed(1)} px`);
    ok(`C8 (${label} px) carte avant le pied de page : écart normal (${g.refFooter?.toFixed(1)} px)`, near(g.beforeFooter, g.refFooter), `${g.beforeFooter?.toFixed(1)} px`);
    if (label === "1440") {
      // Un espace choisi à la main sur la toile (data-pt) garde la main : il s'ajoute au padding de la carte au lieu d'être écrasé.
      const hand = await pw.evaluate(() => {
        const card = document.querySelector(".surface-card");
        const sec = card.firstElementChild;
        const probe = document.createElement("div");
        probe.style.paddingTop = "var(--t-space-xl)";
        document.body.append(probe);
        const xl = parseFloat(getComputedStyle(probe).paddingTop);
        probe.remove();
        const before = getComputedStyle(sec).paddingTop;
        const w = document.createElement("div");
        w.className = "blk";
        w.dataset.pt = "xl";
        w.style.display = "contents";
        card.insertBefore(w, sec);
        w.append(sec);
        return { xl, before: parseFloat(before), after: parseFloat(getComputedStyle(sec).paddingTop) };
      });
      ok("C8 espace choisi à la main (data-pt) : respecté dans la carte", hand.after === hand.xl && hand.before === 0, JSON.stringify(hand));
    }
    if (label === "1440") await pw.screenshot({ path: path.join(SHOTS, "c8-ecarts-1440.png"), fullPage: true });
    await ctxW.close();
  }
  // Persistance : rouvrir l'éditeur retrouve les réglages.
  await anon.close();
  f = await openEditor();
  [uidFirst, uidSecond] = await textUids(f);
  const again = await cardInfo(f, uidFirst);
  ok("C6 persistance : l'éditeur rouvert montre les cartes publiées", again?.on === "on" && same(rgbOf(again.bg), hexRgb("#f6d6e4")) && again.corners === "m", JSON.stringify(again));
  await f.locator(`.pe-focus[data-uid="${uidFirst}"]`).scrollIntoViewIfNeeded();
  await f.locator(`[data-edit-block="${uidFirst}"] section`).first().click({ position: { x: 40, y: 10 } });
  await f.locator(".pe-tools [data-testid=\"fond-button\"]").click();
  const menu = f.locator('[data-testid="fond-menu"]');
  ok("C6 le popover relit la carte : interrupteur allumé, couleur perso, en retrait, coins arrondis", (await menu.locator('[data-testid="fond-section-carte"] [data-kind][aria-checked=true]').getAttribute("data-kind")) !== "none" && (await menu.locator('[data-testid="fond-section-fond"] [data-kind="none"]').getAttribute("aria-checked")) === "true" && (await menu.locator('[data-corners="m"]').getAttribute("aria-checked")) === "true");
  await page.screenshot({ path: path.join(SHOTS, "c6-popover-relu.png") });
  // Retirer la carte : « Aucun ».
  await menu.locator('[data-testid="fond-section-carte"] [data-kind="none"]').click();
  ok("C7 carte retirée : l'enveloppe redevient sans boîte, la clé disparaît du brouillon", (await cardInfo(f, uidFirst)).on === "off" && (await waitFor(() => inkBlocks()[0]?.props.surface === undefined)));
  await page.keyboard.press("Escape");
});

/* ---- D. Carte par défaut du thème ------------------------------------------------------------------------------- */

if (run("D"))
  await section("D", async () => {
  await gotoIdle(page, `${BASE}/admin/themes/${PAPER_THEME_ID}?etape=cartes`);
  const section = page.locator("section.a-panel", { has: page.getByRole("heading", { name: "Cartes des rubriques" }) });
  ok("D1 l'éditeur de thème a « Cartes des rubriques »", await section.waitFor({ timeout: 30000 }).then(() => true, () => false));
  await section.locator('[data-token="bgDeep"]').click();
  await section.getByRole("button", { name: "Pleine largeur" }).click();
  await section.getByRole("button", { name: "Coins droits" }).click();
  // Thème en ligne : le bouton s'appelle « Enregistrer et publier… » (lot 55).
  await page.getByRole("button", { name: /^Enregistrer( et publier…)?$/ }).click();
  ok("D2 réglage enregistré dans le thème (tokens.layout.card)", await waitFor(() => JSON.stringify(JSON.parse(q("select data from themes where id = ?", PAPER_THEME_ID)[0].data).tokens.layout?.card) === JSON.stringify({ color: "bgDeep", width: "full", corners: "square" })));
  ok("D3 les thèmes livrés n'ont pas de carte par défaut", q("select data from themes where preset = 1").every((r) => !JSON.parse(r.data).tokens.layout?.card));
  f = await openEditor();
  const uid = (await textUids(f))[0];
  await f.locator(`.pe-focus[data-uid="${uid}"]`).scrollIntoViewIfNeeded();
  await f.locator(`[data-edit-block="${uid}"] section`).first().click({ position: { x: 40, y: 10 } });
  await f.locator(".pe-tools [data-testid=\"fond-button\"]").click();
  // La rubrique publiée a déjà sa carte : éteinte puis rallumée, elle repart des réglages du thème (`{}`).
  const dm = f.locator('[data-testid="fond-menu"]');
  if ((await dm.locator('[data-testid="fond-section-carte"] [data-kind][aria-checked=true]').getAttribute("data-kind")) !== "none") await dm.locator('[data-testid="fond-section-carte"] [data-kind="none"]').click();
  await dm.locator('[data-testid="fond-section-carte"] [data-kind="color"]').click();
  const d = await cardInfo(f, uid);
  const bgDeep = await f.evaluate(() => {
    const p = document.createElement("i");
    p.style.color = "var(--t-color-bg-deep)";
    document.body.append(p);
    const c = getComputedStyle(p).color;
    p.remove();
    return c;
  });
  ok("D4 une carte posée sans choix prend couleur et coins du thème (lot 100 : plus jamais le fond profond imposé, coins droits) ; l'étendue est celle demandée (Carte en retrait)", d.width === "inset" && d.corners === "square" && d.radius === 0 && !same(rgbOf(d.bg), rgbOf(bgDeep)), JSON.stringify(d));
  await page.screenshot({ path: path.join(SHOTS, "d4-defaut-du-theme.png") });
});

/* ---- P. Parité : rien ne change sans carte ----------------------------------------------------------------------- */

if (run("P"))
  await section("P", async () => {
  const presets = q("select id from themes where preset = 1 order by id").map((r) => r.id);
  const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pub = await anon.newPage();
  const bad = [];
  for (const id of presets) {
    await pub.goto(`${BASE}/api/theme-preview?id=${id}&redirect=/fr&banner=0`, { waitUntil: "domcontentloaded" });
    for (const p of ["/fr", "/fr/personnages"]) {
      const res = await pub.goto(`${BASE}${p}`, { waitUntil: "domcontentloaded" });
      const html = await pub.content();
      if (res?.status() !== 200 || /surface-card|data-surface|pe-add-end|data-edit-/.test(html)) bad.push(`${id}${p}`);
    }
  }
  ok(`P1 ${presets.length} presets : aucune enveloppe de carte, aucun repère d'édition dans le HTML public`, presets.length === 8 && bad.length === 0, bad.join(" "));
  await anon.close();
});

ok("aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
