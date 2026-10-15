#!/usr/bin/env node
/**
 * Fond de couleur d'un composant et bordure de carte (lot 32), UN chromium. Serveur dev requis, base NEUVE (seed), une connexion.
 * Page « À propos » remplacée par six Textes (Alpha sans carte ni fond ; Bravo et Charlie sur une carte ; Delta, Echo, Foxtrot sur la page).
 *
 *  A. Fond de couleur dans une carte : « Fond » (barre du composant), couleur de la palette ; la couleur va d'un bord à l'autre de la
 *     carte et sur toute sa hauteur ; deux cartes de même fond : aucun écart, coins et bordure de jonction supprimés ; couleur
 *     différente : écart normal ; Annuler / Rétablir.
 *  B. Hors carte : bande pleine largeur de la page ; deux composants de même couleur se touchent ; couleur différente : bandes distinctes.
 *  C. Public = éditeur (écarts, largeur, couleur) ; téléphone ; texte lisible sur le fond (contraste) ; pas de défilement horizontal.
 *  D. Bordure de carte : interrupteur, Fin / Moyen / Épais (2 / 6 / 12 px, 1,5 / 4 / 8 sur téléphone), couleur par défaut (texte de la
 *     carte) / palette ; le fond s'arrête à l'intérieur de la bordure ; désactivation ; valeur par défaut du thème (« Cartes des rubriques »).
 *  E. Papier du site (lot 28) × fond : sur la carte (papier « dessus ») le fond montre le papier ; « dessous » : rien ; hors carte : réglage du site.
 *  P. Parité : sans fond ni bordure, aucune enveloppe ni attribut dans le HTML public.
 * Captures : $SHOTS (défaut screenshots/fond32).
 * Usage : DATA_DIR=… ADMIN_EMAIL=… ADMIN_PASSWORD=… BASE=http://localhost:3102 node scripts/e2e-fond.mjs
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";

import { installPaperTheme, PAPER_THEME_ID, PAPER_THEME_NAME } from "./lib/paper-theme.mjs";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const DATA = process.env.DATA_DIR ?? "data";
const DB = path.join(DATA, "portfolio.db");
const SHOTS = process.env.SHOTS ?? "screenshots/fond32";
mkdirSync(SHOTS, { recursive: true });
const PAGE_ID = 5;
const PUBLIC = `${BASE}/fr/a-propos`;

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
const exec = (sql, ...args) => {
  const db = new Database(DB);
  try {
    db.prepare(sql).run(...args);
  } finally {
    db.close();
  }
};
const draftBlocks = () => JSON.parse(q("select draft from pages where id = ?", PAGE_ID)[0]?.draft || "null")?.blocks ?? [];
const draftOf = (word) => draftBlocks().find((b) => JSON.stringify(b.props).includes(word));
async function waitFor(fn, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(300);
  }
  return false;
}
const near = (a, b, tol = 1.5) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= tol;

/* ---- Mise en place : six Textes sur « À propos » ------------------------------------------------------------------- */

const WORDS = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"];
function seedPage() {
  exec("delete from blocks where page_id = ?", PAGE_ID);
  exec("update pages set draft = NULL, draft_rev = 0 where id = ?", PAGE_ID);
  WORDS.forEach((w, i) => {
    const props = { paragraphs: [{ fr: `${w} : un texte assez long pour que le fond de couleur ait du contenu à entourer, sur une ligne ou deux.`, en: `${w}: some text.` }] };
    if (w === "Bravo" || w === "Charlie") props.surface = { color: "surface" };
    exec("insert into blocks (page_id, position, type, props) values (?, ?, 'rich-text', ?)", PAGE_ID, i, JSON.stringify(props));
  });
}
seedPage();

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(`${BASE}/admin/connexion`, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL);
await page.fill("#password", PASSWORD);
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/admin/connexion"), { timeout: 90000 }), page.click("button[type=submit]")]);

async function canvas() {
  const handle = await page.waitForSelector("iframe.ve-frame", { timeout: 120000 });
  const fr = await handle.contentFrame();
  await fr.waitForSelector("html[data-edit-mode]", { timeout: 180000 });
  return fr;
}
async function settled() {
  await page.waitForFunction(() => !/Enregistrement/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, { timeout: 120000 });
  await sleep(600);
}
async function openEditor() {
  await page.goto(`${BASE}/admin/pages/${PAGE_ID}/editer`, { waitUntil: "domcontentloaded" });
  let fr = await canvas();
  if (await page.getByRole("button", { name: "Abandonner les modifications" }).count()) {
    await page.getByRole("button", { name: "Abandonner les modifications" }).click();
    await Promise.all([
      page.waitForEvent("framenavigated", { predicate: (x) => x === page.mainFrame(), timeout: 60000 }),
      page.getByRole("dialog").getByRole("button", { name: "Abandonner les modifications" }).click(),
    ]);
    fr = await canvas();
  }
  await sleep(1500);
  return fr;
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
async function section(name, fn) {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 2).join(" "));
    await page.screenshot({ path: path.join(SHOTS, `erreur-${name}.png`) }).catch(() => {});
  }
}

/** Mesures d'un Texte (par un mot de son paragraphe) : enveloppe de fond, carte, bordure, couleurs. Rectangles en coordonnées du document. */
const MEASURE = (w) => {
  const p = [...document.querySelectorAll("p")].find((e) => e.textContent.includes(w));
  if (!p) return null;
  const fond = p.closest('.fond-bloc[data-fond="on"]');
  const card = p.closest('.surface-card[data-surface="on"]');
  const box = (e) => {
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return { l: b.left, r: b.right, t: b.top + window.scrollY, b: b.bottom + window.scrollY };
  };
  const cs = (e) => (e ? getComputedStyle(e) : null);
  const px = (v) => parseFloat(v) || 0;
  const pcs = getComputedStyle(p);
  return {
    p: box(p),
    pColor: pcs.color,
    fond: box(fond),
    fondBg: cs(fond)?.backgroundColor ?? null,
    fondJoin: fond ? [fond.hasAttribute("data-join-prev"), fond.hasAttribute("data-join-next")] : null,
    card: box(card),
    cardBg: cs(card)?.backgroundColor ?? null,
    cardJoin: card ? [card.hasAttribute("data-join-prev"), card.hasAttribute("data-join-next")] : null,
    radius: card ? [px(cs(card).borderTopLeftRadius), px(cs(card).borderBottomLeftRadius)] : null,
    border: card ? { t: px(cs(card).borderTopWidth), l: px(cs(card).borderLeftWidth), r: px(cs(card).borderRightWidth), b: px(cs(card).borderBottomWidth), color: cs(card).borderTopColor, attr: card.getAttribute("data-border"), style: cs(card).borderTopStyle } : null,
    cardInk: card ? cs(card).getPropertyValue("--card-ink").trim() : null,
    vw: document.documentElement.clientWidth,
    sw: document.documentElement.scrollWidth,
    paper: fond ? getComputedStyle(fond, "::before").content : null,
  };
};
const measure = (where, w) => where.evaluate(MEASURE, w);
const rgb = (css) => (/rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(css) ?? []).slice(1, 4).map(Number);
const lum = ([r, g, b]) => {
  const f = (v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const sameRgb = (a, b) => a.length === 3 && b.length === 3 && a.every((v, i) => Math.abs(v - b[i]) <= 1);
async function themeColor(where, name) {
  return rgb(await where.evaluate((n) => { const s = document.createElement("span"); s.style.color = `var(--t-color-${n})`; document.body.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; }, name));
}

let f = await openEditor();

/** Sélectionne un Texte, ouvre son menu « Fond ». */
async function openFond(word) {
  const host = f.locator('[data-edit-block][data-edit-type="rich-text"]', { hasText: word }).first();
  await host.scrollIntoViewIfNeeded();
  await host.locator("section").first().click({ position: { x: 4, y: 30 } });
  await f.locator('.pe-tools [data-testid="fond-button"]').click();
  const menu = f.locator('[data-testid="fond-menu"]');
  await menu.waitFor({ timeout: 20000 });
  return menu;
}
async function setFond(word, token) {
  const menu = await openFond(word);
  if (token === null) await menu.locator('[data-kind="none"]').click();
  else {
    if ((await menu.locator('[data-kind="color"]').getAttribute("aria-checked")) !== "true") await menu.locator('[data-kind="color"]').click();
    await menu.locator(`[data-testid="card-da-color"][data-token="${token}"]`).click();
  }
  await page.keyboard.press("Escape");
  await sleep(500);
}
const bgOfDraft = (word) => draftOf(word)?.props.background;
const undo = () => page.locator('button.a-icon-btn[aria-label="Défaire"]');
const redo = () => page.locator('button.a-icon-btn[aria-label="Rétablir"]');

/* ---- A. Fond dans une carte ---------------------------------------------------------------------------------------- */

let primary = [0, 0, 0];
await section("A", async () => {
  primary = await themeColor(f, "primary");
  const before = await measure(f, "Bravo");
  ok("A0 sans fond : carte seule, aucune enveloppe de fond active", before.fond === null && before.card !== null);
  const menu = await openFond("Bravo");
  ok("A1 le bouton « Fond » est dans la barre du composant", true);
  ok("A1 « Aucun » est coché au départ", (await menu.locator('[data-kind="none"]').getAttribute("aria-checked")) === "true");
  await menu.locator('[data-kind="color"]').click();
  ok("A2 « Couleur » pose le fond profond du thème par défaut", await waitFor(() => JSON.stringify(bgOfDraft("Bravo")) === '{"kind":"color","color":"bgDeep"}'), JSON.stringify(bgOfDraft("Bravo")));
  await menu.locator('[data-testid="card-da-color"][data-token="primary"]').click();
  ok("A3 couleur de la palette : jeton enregistré (suit le thème)", await waitFor(() => JSON.stringify(bgOfDraft("Bravo")) === '{"kind":"color","color":"primary"}'), JSON.stringify(bgOfDraft("Bravo")));
  await page.keyboard.press("Escape");
  await sleep(500);
  let m = await measure(f, "Bravo");
  ok("A4 aperçu immédiat : fond actif, couleur de la palette", m.fond !== null && sameRgb(rgb(m.fondBg), primary), JSON.stringify([m.fondBg, primary]));
  ok("A5 la couleur va d'un bord à l'autre de la carte (largeur) et sur toute sa hauteur", m.fond && m.card && near(m.fond.l, m.card.l) && near(m.fond.r, m.card.r) && near(m.fond.t, m.card.t) && near(m.fond.b, m.card.b), JSON.stringify([m.fond, m.card]));
  ok("A5 le contenu ne colle pas aux bords (rembourrage)", m.fond && m.p.t - m.fond.t >= 12 && m.fond.b - m.p.b >= 12 && m.p.l - m.fond.l >= 12, JSON.stringify([m.fond, m.p]));
  await page.screenshot({ path: path.join(SHOTS, "a-un-fond-dans-une-carte.png") });

  await setFond("Charlie", "primary");
  ok("A6 deuxième composant, même couleur : enregistré", await waitFor(() => JSON.stringify(bgOfDraft("Charlie")) === '{"kind":"color","color":"primary"}'));
  m = await measure(f, "Bravo");
  const c = await measure(f, "Charlie");
  ok("A7 deux cartes de même fond : aucun écart entre les deux couleurs", c.fond && m.fond && near(c.fond.t, m.fond.b, 1.5), JSON.stringify([m.fond, c.fond]));
  ok("A7 les deux cartes se touchent (aucune marge entre elles)", near(c.card.t, m.card.b, 1.5), JSON.stringify([m.card, c.card]));
  ok("A8 jonction : coins droits au contact (haut de la 2e, bas de la 1re), arrondi conservé aux extrémités", c.radius[0] === 0 && m.radius[1] === 0 && m.radius[0] > 0 && c.radius[1] > 0, JSON.stringify([m.radius, c.radius]));
  ok("A8 attributs de fusion posés sur l'enveloppe et la carte", m.fondJoin[1] && c.fondJoin[0] && m.cardJoin[1] && c.cardJoin[0] && !m.fondJoin[0] && !c.fondJoin[1], JSON.stringify([m.fondJoin, c.fondJoin, m.cardJoin, c.cardJoin]));
  await page.screenshot({ path: path.join(SHOTS, "a-deux-cartes-meme-fond.png") });
  const gapSame = c.card.t - m.card.b;

  await setFond("Charlie", "ink");
  await waitFor(() => bgOfDraft("Charlie")?.color === "ink");
  const m2 = await measure(f, "Bravo");
  const c2 = await measure(f, "Charlie");
  ok("A9 couleur différente : écart normal entre les deux cartes", c2.card.t - m2.card.b > 8 && !m2.fondJoin[1] && !c2.fondJoin[0], JSON.stringify([m2.card.b, c2.card.t, m2.fondJoin, c2.fondJoin]));
  ok("A9 texte lisible sur le fond sombre (≥ 4,5:1)", ratio(rgb(c2.pColor), rgb(c2.fondBg)) >= 4.5, JSON.stringify([c2.pColor, c2.fondBg]));
  await page.screenshot({ path: path.join(SHOTS, "a-deux-cartes-couleurs-differentes.png") });

  await undo().click();
  ok("A10 Annuler : Charlie reprend la couleur d'avant, les deux cartes se rejoignent", await waitFor(async () => bgOfDraft("Charlie")?.color === "primary" && near((await measure(f, "Charlie")).card.t - (await measure(f, "Bravo")).card.b, gapSame, 1.5)));
  await undo().click();
  ok("A10 Annuler encore : Charlie sans fond, Bravo garde le sien (écart normal)", await waitFor(async () => bgOfDraft("Charlie") === undefined && (await measure(f, "Charlie")).fond === null && bgOfDraft("Bravo")?.color === "primary"));
  await redo().click();
  await redo().click();
  ok("A11 Rétablir deux fois : fond de Charlie différent de nouveau", await waitFor(() => bgOfDraft("Charlie")?.color === "ink"));
  await setFond("Charlie", "primary");
  await waitFor(() => bgOfDraft("Charlie")?.color === "primary");
});

/* ---- B. Hors carte : bande pleine largeur ----------------------------------------------------------------------------- */

await section("B", async () => {
  await setFond("Delta", "secondary");
  await setFond("Echo", "secondary");
  await setFond("Foxtrot", "ink");
  await waitFor(() => bgOfDraft("Foxtrot")?.color === "ink");
  const d = await measure(f, "Delta");
  const e = await measure(f, "Echo");
  const x = await measure(f, "Foxtrot");
  ok("B1 hors carte : bande pleine largeur de la page", d.fond && near(d.fond.l, 0, 1.5) && near(d.fond.r, d.vw, 1.5), JSON.stringify([d.fond, d.vw]));
  ok("B2 deux composants de même couleur : aucun écart", near(e.fond.t, d.fond.b, 1.5), JSON.stringify([d.fond, e.fond]));
  ok("B2 fusion posée", d.fondJoin[1] && e.fondJoin[0] && !e.fondJoin[1], JSON.stringify([d.fondJoin, e.fondJoin]));
  ok("B3 couleur différente : bande distincte, jointure nette", x.fond && near(x.fond.t, e.fond.b, 1.5) && rgb(x.fondBg).join() !== rgb(e.fondBg).join(), JSON.stringify([e.fondBg, x.fondBg]));
  ok("B3 l'écart entre les textes est plus grand que celui de deux composants fusionnés", x.p.t - e.p.b > e.p.t - d.p.b + 4, JSON.stringify([e.p.t - d.p.b, x.p.t - e.p.b]));
  ok("B4 chaque bande a son rembourrage haut et bas", e.p.t - e.fond.t >= 12 && x.fond.b - x.p.b >= 12);
  await page.screenshot({ path: path.join(SHOTS, "b-hors-carte.png"), fullPage: false });
  await f.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(500);
  await page.screenshot({ path: path.join(SHOTS, "b-hors-carte-bas.png") });
});

/* ---- C. Public = éditeur, téléphone, lisibilité -------------------------------------------------------------------------- */

let editorFacts = null;
await section("C", async () => {
  const facts = async (where) => {
    const [a, b, c, d, e, x] = await Promise.all(["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"].map((w) => measure(where, w)));
    return { gapCards: c.card.t - b.card.b, gapDE: e.fond.t - d.fond.b, gapEX: x.fond.t - e.fond.b, cardW: b.card.r - b.card.l, fondW: b.fond.r - b.fond.l, bandW: d.fond.r - d.fond.l, vw: d.vw, a, b, c, d, e, x };
  };
  editorFacts = await facts(f);
  ok("C0 publication", await publish());
  const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pub = await anon.newPage();
  pub.on("pageerror", (e) => errors.push(e.message));
  await pub.goto(PUBLIC, { waitUntil: "networkidle" });
  const p = await facts(pub);
  ok("C1 public : couleur d'un bord à l'autre de la carte, toute la hauteur", near(p.b.fond.l, p.b.card.l) && near(p.b.fond.r, p.b.card.r) && near(p.b.fond.t, p.b.card.t) && near(p.b.fond.b, p.b.card.b), JSON.stringify([p.b.fond, p.b.card]));
  ok("C1 public : deux cartes de même fond sans écart, coins de jonction droits", near(p.gapCards, 0, 1.5) && p.c.radius[0] === 0 && p.b.radius[1] === 0, JSON.stringify([p.gapCards, p.b.radius, p.c.radius]));
  ok("C2 public : bande pleine largeur de la page, aucun écart entre Delta et Echo, jointure nette avec Foxtrot", near(p.d.fond.l, 0, 1.5) && near(p.bandW, p.vw, 1.5) && near(p.gapDE, 0, 1.5) && near(p.gapEX, 0, 1.5), JSON.stringify([p.bandW, p.vw, p.gapDE, p.gapEX]));
  ok("C3 public = éditeur : mêmes écarts, mêmes couleurs", near(p.gapCards, editorFacts.gapCards, 1.5) && near(p.gapDE, editorFacts.gapDE, 1.5) && near(p.gapEX, editorFacts.gapEX, 1.5) && sameRgb(rgb(p.b.fondBg), rgb(editorFacts.b.fondBg)) && sameRgb(rgb(p.x.fondBg), rgb(editorFacts.x.fondBg)) && sameRgb(rgb(p.x.pColor), rgb(editorFacts.x.pColor)));
  ok("C4 texte lisible sur chaque fond (≥ 4,5:1)", [p.b, p.c, p.d, p.e, p.x].every((m) => ratio(rgb(m.pColor), rgb(m.fondBg)) >= 4.5), [p.b, p.c, p.d, p.e, p.x].map((m) => ratio(rgb(m.pColor), rgb(m.fondBg)).toFixed(1)).join());
  ok("C5 Alpha (sans fond) : aucune enveloppe dans le HTML public", p.a.fond === null && !(await pub.evaluate(() => document.querySelector(".fond-bloc:not([data-fond])") !== null)));
  await pub.screenshot({ path: path.join(SHOTS, "c-public-bureau.png"), fullPage: true });
  await anon.close();

  const phone = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
  const ph = await phone.newPage();
  await ph.goto(PUBLIC, { waitUntil: "networkidle" });
  const t = await facts(ph);
  ok("C6 téléphone : bord à bord de la carte, fusion, bande pleine largeur", near(t.b.fond.l, t.b.card.l) && near(t.b.fond.r, t.b.card.r) && near(t.gapCards, 0, 1.5) && near(t.bandW, t.vw, 1.5) && near(t.gapDE, 0, 1.5), JSON.stringify([t.b.fond, t.b.card, t.gapCards, t.bandW, t.vw]));
  ok("C6 téléphone : pas de défilement horizontal", t.d.sw <= t.d.vw + 1, `${t.d.sw} > ${t.d.vw}`);
  ok("C6 téléphone : rembourrage du contenu", t.e.p.l - t.e.fond.l >= 12 && t.e.p.t - t.e.fond.t >= 12);
  await ph.screenshot({ path: path.join(SHOTS, "c-public-telephone.png"), fullPage: true });
  await phone.close();
});

/* ---- D. Bordure de carte ---------------------------------------------------------------------------------------------------- */

async function openCard(word) {
  const host = f.locator('[data-edit-block][data-edit-type="rich-text"]', { hasText: word }).first();
  await host.scrollIntoViewIfNeeded();
  await host.locator("section").first().click({ position: { x: 4, y: 30 } });
  await f.locator(".pe-tools .sm-button:not([data-testid])").click();
  const menu = f.locator(".sm").first();
  await menu.waitFor({ timeout: 20000 });
  return menu;
}
const borderOf = (word) => draftOf(word)?.props.surface?.border;
await section("D", async () => {
  f = await openEditor();
  let menu = await openCard("Bravo");
  const sw = menu.locator('[data-testid="surface-border-switch"]');
  ok("D1 interrupteur « Bordure » éteint au départ", (await sw.getAttribute("aria-checked")) === "false");
  await sw.click();
  ok("D2 bordure posée : `{}` (Moyen, couleur par défaut)", await waitFor(() => JSON.stringify(borderOf("Bravo")) === "{}"), JSON.stringify(borderOf("Bravo")));
  let m = await measure(f, "Bravo");
  ok("D3 aperçu : bordure Moyenne de 6 px, pleine", m.border.attr === "medium" && near(m.border.t, 6, 0.6) && near(m.border.l, 6, 0.6) && m.border.style === "solid", JSON.stringify(m.border));
  ok("D4 la couleur de la bordure suit la couleur lisible du texte de la carte", sameRgb(rgb(m.border.color), rgb(m.cardInk.startsWith("#") ? hexToRgbCss(m.cardInk) : m.cardInk)), JSON.stringify([m.border.color, m.cardInk]));
  ok("D5 le fond s'arrête à l'intérieur de la bordure", near(m.fond.l, m.card.l + 6, 1.5) && near(m.fond.r, m.card.r - 6, 1.5) && near(m.fond.t, m.card.t + 6, 1.5) && near(m.fond.b, m.card.b - 6, 1.5), JSON.stringify([m.fond, m.card]));
  await menu.locator('[data-border-width="thick"]').click();
  await waitFor(() => borderOf("Bravo")?.width === "thick");
  m = await measure(f, "Bravo");
  ok("D6 Épais : 12 px", near(m.border.t, 12, 0.6), JSON.stringify(m.border));
  await menu.locator('[data-border-width="thin"]').click();
  await waitFor(() => borderOf("Bravo")?.width === "thin");
  m = await measure(f, "Bravo");
  ok("D6 Fin : 2 px", near(m.border.t, 2, 0.6), JSON.stringify(m.border));
  await menu.locator('[aria-label="Couleur de la bordure"] [data-token="tertiary"]').first().click();
  ok("D7 couleur de la palette : jeton enregistré", await waitFor(() => borderOf("Bravo")?.color === "tertiary"), JSON.stringify(borderOf("Bravo")));
  const tertiary = await themeColor(f, "tertiary");
  m = await measure(f, "Bravo");
  ok("D7 la bordure prend la couleur de la palette (suit le thème)", sameRgb(rgb(m.border.color), tertiary) || tertiary.every((v) => v === 0), JSON.stringify([m.border.color, tertiary]));
  await menu.locator('[data-border-width="thick"]').click();
  await waitFor(() => borderOf("Bravo")?.width === "thick");
  await page.keyboard.press("Escape");
  await page.screenshot({ path: path.join(SHOTS, "d-bordure-epaisse.png") });
  ok("D8 publication", await publish());

  const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pub = await anon.newPage();
  await pub.goto(PUBLIC, { waitUntil: "networkidle" });
  const pm = await measure(pub, "Bravo");
  ok("D9 public : bordure visible, épaisse (12 px), suit les coins arrondis", pm.border.attr === "thick" && near(pm.border.t, 12, 0.6) && pm.radius[0] > 0 && pm.border.style === "solid", JSON.stringify([pm.border, pm.radius]));
  ok("D9 public : le fond s'arrête à l'intérieur de la bordure", near(pm.fond.l, pm.card.l + 12, 1.5) && near(pm.fond.r, pm.card.r - 12, 1.5), JSON.stringify([pm.fond, pm.card]));
  const cm = await measure(pub, "Charlie");
  ok("D10 la bordure d'une carte n'en met pas à sa voisine", cm.border.attr === null && near(cm.border.t, 0));
  await pub.screenshot({ path: path.join(SHOTS, "d-public-bordure.png"), fullPage: true });
  await anon.close();
  const phone = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
  const ph = await phone.newPage();
  await ph.goto(PUBLIC, { waitUntil: "networkidle" });
  const tm = await measure(ph, "Bravo");
  ok("D11 téléphone : bordure Épaisse ajustée (8 px)", near(tm.border.t, 8, 0.6), JSON.stringify(tm.border));
  ok("D11 téléphone : pas de défilement horizontal", tm.sw <= tm.vw + 1);
  await ph.screenshot({ path: path.join(SHOTS, "d-telephone-bordure.png"), fullPage: true });
  await phone.close();

  f = await openEditor();
  menu = await openCard("Bravo");
  await menu.locator('[data-testid="surface-border-switch"]').click();
  ok("D12 interrupteur éteint : `border: false`", await waitFor(() => borderOf("Bravo") === false), JSON.stringify(borderOf("Bravo")));
  m = await measure(f, "Bravo");
  ok("D12 plus de bordure sur la toile", m.border.attr === null && near(m.border.t, 0) && near(m.fond.l, m.card.l));
  await page.keyboard.press("Escape");
  await undo().click();
  ok("D13 Annuler : la bordure revient", await waitFor(() => borderOf("Bravo")?.width === "thick"));
  await redo().click();
  await waitFor(() => borderOf("Bravo") === false);
  await settled();
});

/* ---- E. Papier du site × fond --------------------------------------------------------------------------------------------- */

await section("E", async () => {
  installPaperTheme(DATA);
  await activateTheme(PAPER_THEME_NAME);
  f = await openEditor();
  const hasPaper = await f.evaluate(() => document.documentElement.hasAttribute("data-kit-paper"));
  ok("E0 thème à papier en ligne", hasPaper);
  let b = await measure(f, "Bravo");
  ok("E1 par défaut (le site ne montre pas le papier sur les cartes) : aucun papier sur le fond", b.paper === "none" || b.paper === "normal", String(b.paper));
  let menu = await openCard("Bravo");
  await menu.locator('[data-paper="over"]').click();
  await waitFor(() => draftOf("Bravo")?.props.surface?.paper === "over");
  await page.keyboard.press("Escape");
  await sleep(500);
  b = await measure(f, "Bravo");
  ok("E2 carte « Sur la carte » : le papier est dessiné sur le fond de couleur (sous le texte)", /"/.test(String(b.paper)) || b.paper === '""', String(b.paper));
  await page.screenshot({ path: path.join(SHOTS, "e-papier-sur-fond.png") });
  menu = await openCard("Bravo");
  await menu.locator('[data-paper="under"]').click();
  await waitFor(() => draftOf("Bravo")?.props.surface?.paper === "under");
  await page.keyboard.press("Escape");
  await sleep(500);
  b = await measure(f, "Bravo");
  ok("E3 carte « Sous la carte » : pas de papier sur le fond", b.paper === "none" || b.paper === "normal", String(b.paper));
  const d = await measure(f, "Delta");
  ok("E4 fond posé sur la page : sans papier tant que le site ne le montre pas sur les cartes", d.paper === "none" || d.paper === "normal", String(d.paper));
  ok("E5 publication", await publish());
  const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pub = await anon.newPage();
  await pub.goto(PUBLIC, { waitUntil: "networkidle" });
  const pb = await measure(pub, "Bravo");
  ok("E6 public = éditeur (papier sous la carte : rien sur le fond)", pb.paper === "none" || pb.paper === "normal");
  await anon.close();
  // Le site montre le papier sur les cartes : fond sur la page et sur une carte sans réglage de papier.
  const row = q("select data from themes where id = ?", PAPER_THEME_ID)[0];
  const th = JSON.parse(row.data);
  th.assets.kit.paper.onCards = true;
  th.assets.kit.paper.onCardsOpacity = 0.4;
  exec("update themes set data = ? where id = ?", JSON.stringify(th), PAPER_THEME_ID);
  const anon2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pub2 = await anon2.newPage();
  await pub2.goto(PUBLIC, { waitUntil: "networkidle" });
  const pc = await measure(pub2, "Charlie");
  const pd = await measure(pub2, "Delta");
  const pbb = await measure(pub2, "Bravo");
  ok("E7 papier visible sur les cartes (site) : sur le fond d'une carte sans réglage ET sur un fond posé sur la page", /"/.test(String(pc.paper)) && /"/.test(String(pd.paper)), JSON.stringify([pc.paper, pd.paper]));
  ok("E7 une carte qui dit « sous » garde son fond sans papier", pbb.paper === "none" || pbb.paper === "normal", String(pbb.paper));
  await pub2.screenshot({ path: path.join(SHOTS, "e-public-papier-site.png"), fullPage: true });
  await anon2.close();
});

/* ---- D'. Bordure par défaut du thème ------------------------------------------------------------------------------------------ */

await section("Dprime", async () => {
  const row = q("select data from themes where id = ?", PAPER_THEME_ID)[0];
  const th = JSON.parse(row.data);
  th.tokens.layout = { ...(th.tokens.layout ?? {}), card: { border: { width: "thin", color: "primary" } } };
  exec("update themes set data = ? where id = ?", JSON.stringify(th), PAPER_THEME_ID);
  const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pub = await anon.newPage();
  await pub.goto(PUBLIC, { waitUntil: "networkidle" });
  const c = await measure(pub, "Charlie");
  const primaryRgb = await themeColor(pub, "primary");
  ok("D14 « Cartes des rubriques » : la bordure par défaut du thème s'applique à une carte sans réglage (Fin, palette)", c.border.attr === "thin" && near(c.border.t, 2, 0.6) && sameRgb(rgb(c.border.color), primaryRgb), JSON.stringify([c.border, primaryRgb]));
  const b = await measure(pub, "Bravo");
  ok("D14 une carte avec `border: false` reste sans bordure", b.border.attr === null && near(b.border.t, 0));
  await anon.close();
});

/* ---- P. Parité : rien sans réglage -------------------------------------------------------------------------------------------- */

await section("P", async () => {
  seedPage();
  exec("update pages set draft = NULL where id = ?", PAGE_ID);
  const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pub = await anon.newPage();
  await pub.goto(PUBLIC, { waitUntil: "networkidle" });
  const html = await pub.content();
  ok("P1 sans fond : aucune enveloppe de fond, aucun attribut de fusion dans le HTML public", !/fond-bloc/.test(html) && !/data-fond/.test(html) && !/data-join/.test(html));
  ok("P1 une carte sans bordure n'a pas d'attribut de bordure", !/data-border/.test(html));
  await anon.close();
});

ok("aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);

function hexToRgbCss(hex) {
  const h = hex.replace("#", "");
  return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`;
}
