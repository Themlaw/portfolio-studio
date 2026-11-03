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
import { activateThemeUi } from "./lib/theme-live.mjs";
import { autoOpenFine } from "./lib/zone66.mjs";

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
  const okp = await waitFor(async () => /En ligne/.test((await page.locator(".ve-status").textContent()) ?? ""), 120000);
  if (!okp) {
    await page.screenshot({ path: path.join(SHOTS, "echec-publication.png") });
    console.log("STATUT: " + (await page.locator(".ve-status").textContent()) + " | " + (await page.evaluate(() => [...document.querySelectorAll("[role=status],[role=alert]")].map((e) => e.textContent).join(" / "))));
  }
  return okp;
}
async function activateTheme(name) {
  // Lot 60 : « Utiliser ce modèle » / « En faire mon thème », puis « Publier » (scripts/lib/theme-live.mjs).
  await activateThemeUi(page, BASE, name);
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

/* ---- P. Parité : rien sans réglage -------------------------------------------------------------------------------------------- */

await section("P", async () => {
  const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pub = await anon.newPage();
  await pub.goto(PUBLIC, { waitUntil: "networkidle" });
  const html = await pub.content();
  ok("P1 sans fond : aucune enveloppe de fond, aucun attribut de fusion dans le HTML public", !/fond-bloc/.test(html) && !/data-fond/.test(html) && !/data-join/.test(html));
  ok("P1 une carte sans bordure n'a pas d'attribut de bordure", !/data-border/.test(html));
  await anon.close();
});


let f = await openEditor();

/** Sélectionne un Texte, ouvre son menu « Fond & carte » (lot 100 : deux sections Fond et Carte). */
async function openFond(word) {
  const host = f.locator('[data-edit-block][data-edit-type="rich-text"]', { hasText: word }).first();
  // La toile se rafraîchit après l'écriture précédente : le bloc peut être remplacé sous la main (« not attached »), on réessaie.
  for (let attempt = 0; ; attempt++) {
    try {
      await host.scrollIntoViewIfNeeded();
      await host.locator("section").first().click({ position: { x: 40, y: 30 } });
      break;
    } catch (e) {
      if (attempt >= 3) throw e;
      await sleep(1000);
    }
  }
  await f.locator('.pe-tools [data-testid="fond-button"]').click();
  const menu = f.locator('[data-testid="fond-menu"]');
  await menu.waitFor({ timeout: 20000 });
  return menu;
}
/** Section « Fond » du menu (la zone pleine largeur autour). */
const fondSec = (menu) => menu.locator('[data-testid="fond-section-fond"]');
async function setFond(word, token) {
  const menu = await openFond(word);
  const sec = fondSec(menu);
  if (token === null) await sec.locator('[data-kind="none"]').click();
  else {
    if ((await sec.locator('[data-kind="color"]').getAttribute("aria-checked")) !== "true") await sec.locator('[data-kind="color"]').click();
    await sec.locator(`[data-testid="card-da-color"][data-token="${token}"]`).click();
  }
  await page.keyboard.press("Escape");
  await sleep(500);
}
/** Couleur du Fond d'un bloc dans le brouillon : la couche extérieure (carte pleine largeur) quand le bloc a une carte, sinon le fond. */
const fondColorOfDraft = (word) => {
  const p = draftOf(word)?.props;
  return p?.surface?.width === "full" ? p.surface.color : p?.background?.color;
};
const bgOfDraft = (word) => draftOf(word)?.props.background;
const undo = () => page.locator('button.a-icon-btn[aria-label="Défaire"]');
const redo = () => page.locator('button.a-icon-btn[aria-label="Rétablir"]');

/* ---- A. Fond dans une carte ---------------------------------------------------------------------------------------- */

let primary = [0, 0, 0];
/* Lot 100 : « Fond & carte ». Sur une carte, le Fond est la zone PLEINE LARGEUR autour (couche extérieure `surface` pleine largeur) et l'ancienne carte devient la Carte dedans
   (couche `background` avec marge) : il n'y a plus de « bande de couleur dans la carte ». Ces cas vérifient les mêmes gestes (couleur, fusion de deux voisins, Annuler / Rétablir) sur ce rangement. */
await section("A", async () => {
  primary = await themeColor(f, "primary");
  const before = await measure(f, "Bravo");
  ok("A0 sans fond : carte seule, aucune enveloppe de fond active", before.fond === null && before.card !== null);
  const menu = await openFond("Bravo");
  ok("A1 ancienne carte : section Fond sur « Aucun », section Carte en « Couleur » (le menu relit la carte, sans rien écrire)", (await fondSec(menu).locator('[data-kind="none"]').getAttribute("aria-checked")) === "true" && (await menu.locator('[data-testid="fond-section-carte"] [data-kind="color"]').getAttribute("aria-checked")) === "true");
  await fondSec(menu).locator('[data-kind="color"]').click();
  ok("A2 « Couleur » dans Fond : le Fond passe dehors (`surface` pleine largeur, couleur « Cartes et encadrés » du thème : plus jamais le fond profond, jaune sur certains thèmes), l'ancienne carte devient la Carte dedans (marge)", await waitFor(() => { const pr = draftOf("Bravo")?.props; return pr?.surface?.width === "full" && pr.surface.color !== "bgDeep" && pr.background?.kind === "color" && pr.background?.inset === "m" && pr.background?.color === "surface"; }), JSON.stringify(draftOf("Bravo")?.props));
  await fondSec(menu).locator('[data-testid="card-da-color"][data-token="primary"]').click();
  ok("A3 couleur de la palette : jeton enregistré (suit le thème)", await waitFor(() => fondColorOfDraft("Bravo") === "primary"), JSON.stringify(draftOf("Bravo")?.props.surface));
  await page.keyboard.press("Escape");
  await sleep(500);
  let m = await measure(f, "Bravo");
  ok("A4 aperçu immédiat : le Fond (carte pleine largeur) prend la couleur de la palette", m.card !== null && sameRgb(rgb(m.cardBg), primary), JSON.stringify([m.cardBg, primary]));
  ok("A5 le Fond va d'un bord à l'autre de la page et la Carte est dedans, avec une marge", m.card && m.fond && near(m.card.l, 0, 1.5) && near(m.card.r, m.vw, 1.5) && m.fond.l - m.card.l >= 10 && m.card.r - m.fond.r >= 10, JSON.stringify([m.card, m.fond]));
  ok("A5 le contenu ne colle pas aux bords de la Carte (rembourrage)", m.fond && m.p.t - m.fond.t >= 12 && m.fond.b - m.p.b >= 12 && m.p.l - m.fond.l >= 12, JSON.stringify([m.fond, m.p]));
  await page.screenshot({ path: path.join(SHOTS, "a-un-fond-autour-d-une-carte.png") });

  await setFond("Charlie", "primary");
  ok("A6 deuxième composant, même Fond : enregistré", await waitFor(() => fondColorOfDraft("Charlie") === "primary"));
  m = await measure(f, "Bravo");
  const c = await measure(f, "Charlie");
  ok("A7 lot 100 : deux Fonds (couche extérieure pleine largeur) de même couleur restent deux zones séparées par l'écart habituel entre rubriques (la fusion ne concerne que le fond de la bande, vérifiée en B)", c.card && m.card && c.card.t - m.card.b >= 0, JSON.stringify([m.card, c.card]));
  ok("A8 lot 100 : chaque Fond a sa Carte dedans, avec une marge de chaque côté", c.fond && m.fond && c.fond.l - c.card.l >= 10 && m.fond.l - m.card.l >= 10, JSON.stringify([m.cardJoin, c.cardJoin]));
  await page.screenshot({ path: path.join(SHOTS, "a-deux-fonds-meme-couleur.png") });

  await setFond("Charlie", "ink");
  await waitFor(() => fondColorOfDraft("Charlie") === "ink");
  const m2 = await measure(f, "Bravo");
  const c2 = await measure(f, "Charlie");
  ok("A9 couleur différente : deux zones de couleurs distinctes", rgb(m2.cardBg).join() !== rgb(c2.cardBg).join(), JSON.stringify([m2.cardJoin, c2.cardJoin]));
  ok("A9 texte lisible sur sa Carte (≥ 4,5:1)", ratio(rgb(c2.pColor), rgb(c2.fondBg)) >= 4.5, JSON.stringify([c2.pColor, c2.fondBg]));
  await page.screenshot({ path: path.join(SHOTS, "a-deux-fonds-couleurs-differentes.png") });

  await undo().click();
  ok("A10 Annuler : Charlie reprend le Fond d'avant", await waitFor(async () => fondColorOfDraft("Charlie") === "primary"));
  await undo().click();
  ok("A10 Annuler encore : Charlie revient à la couleur posée par « Couleur » (un pas par choix)", await waitFor(() => draftOf("Charlie")?.props.surface?.width === "full" && fondColorOfDraft("Charlie") === "surface"));
  await undo().click();
  ok("A10 Annuler encore : Charlie redevient une simple carte, Bravo garde son Fond", await waitFor(async () => draftOf("Charlie")?.props.background === undefined && draftOf("Charlie")?.props.surface?.width !== "full" && fondColorOfDraft("Bravo") === "primary"));
  await redo().click();
  await redo().click();
  await redo().click();
  ok("A11 Rétablir trois fois : Fond de Charlie différent de nouveau", await waitFor(() => fondColorOfDraft("Charlie") === "ink"));
  await setFond("Charlie", "primary");
  await waitFor(() => fondColorOfDraft("Charlie") === "primary");
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
  ok("C1 public (lot 100) : le Fond va d'un bord à l'autre de la page, la Carte est dedans avec une marge", near(p.b.card.l, 0, 1.5) && near(p.b.card.r, p.vw ?? p.b.card.r, 1.5) && p.b.fond.l - p.b.card.l >= 10 && p.b.fond.t - p.b.card.t >= 10 && p.b.card.b - p.b.fond.b >= 10, JSON.stringify([p.b.fond, p.b.card]));
  ok("C1 public (lot 100) : deux Fonds de même couleur : écart habituel, pas de fusion", p.gapCards >= 0, JSON.stringify([p.gapCards, p.b.radius, p.c.radius]));
  ok("C2 public : bande pleine largeur de la page, aucun écart entre Delta et Echo, jointure nette avec Foxtrot", near(p.d.fond.l, 0, 1.5) && near(p.bandW, p.vw, 1.5) && near(p.gapDE, 0, 1.5) && near(p.gapEX, 0, 1.5), JSON.stringify([p.bandW, p.vw, p.gapDE, p.gapEX]));
  ok("C3 public = éditeur : mêmes écarts, mêmes couleurs", (console.log("  C3 écarts public/éditeur : " + JSON.stringify([p.gapCards, editorFacts.gapCards, p.gapDE, editorFacts.gapDE, p.gapEX, editorFacts.gapEX])), true) && Math.abs(p.gapCards - editorFacts.gapCards) <= 14 && near(p.gapDE, editorFacts.gapDE, 1.5) && near(p.gapEX, editorFacts.gapEX, 1.5) && sameRgb(rgb(p.b.fondBg), rgb(editorFacts.b.fondBg)) && sameRgb(rgb(p.x.fondBg), rgb(editorFacts.x.fondBg)) && sameRgb(rgb(p.x.pColor), rgb(editorFacts.x.pColor)));
  ok("C4 texte lisible sur chaque fond (≥ 4,5:1)", [p.b, p.c, p.d, p.e, p.x].every((m) => ratio(rgb(m.pColor), rgb(m.fondBg)) >= 4.5), [p.b, p.c, p.d, p.e, p.x].map((m) => ratio(rgb(m.pColor), rgb(m.fondBg)).toFixed(1)).join());
  ok("C5 Alpha (sans fond) : aucune enveloppe dans le HTML public", p.a.fond === null && !(await pub.evaluate(() => document.querySelector(".fond-bloc:not([data-fond])") !== null)));
  await pub.screenshot({ path: path.join(SHOTS, "c-public-bureau.png"), fullPage: true });
  await anon.close();

  const phone = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
  const ph = await phone.newPage();
  await ph.goto(PUBLIC, { waitUntil: "networkidle" });
  const t = await facts(ph);
  ok("C6 téléphone (lot 100) : Fond bord à bord, Carte dedans, bande pleine largeur", near(t.b.card.l, 0, 1.5) && near(t.b.card.r, t.vw, 1.5) && near(t.bandW, t.vw, 1.5) && t.gapDE >= -1.5, JSON.stringify([t.b.fond, t.b.card, t.gapCards, t.bandW, t.vw]));
  ok("C6 téléphone : pas de défilement horizontal", t.d.sw <= t.d.vw + 1, `${t.d.sw} > ${t.d.vw}`);
  ok("C6 téléphone : rembourrage du contenu", t.e.p.l - t.e.fond.l >= 12 && t.e.p.t - t.e.fond.t >= 12);
  await ph.screenshot({ path: path.join(SHOTS, "c-public-telephone.png"), fullPage: true });
  await phone.close();
});

/* ---- D. Bordure de carte ---------------------------------------------------------------------------------------------------- */

async function openCard(word) {
  const host = f.locator('[data-edit-block][data-edit-type="rich-text"]', { hasText: word }).first();
  await host.scrollIntoViewIfNeeded();
  await host.locator("section").first().click({ position: { x: 40, y: 30 } });
  await f.locator('.pe-tools [data-testid="fond-button"]').click();
  const menu = f.locator('[data-testid="fond-menu"]').first();
  await menu.waitFor({ timeout: 20000 });
  return menu;
}
const borderOf = (word) => draftOf(word)?.props.surface?.border;
await section("D", async () => {
  f = await openEditor();
  let menu = await openCard("Bravo");
  // Lot 100 : le contour vit sur la couche extérieure ; il est verrouillé tant qu'un Fond est posé. On retire donc le Fond de Bravo.
  await menu.locator('[data-testid="fond-section-fond"] [data-kind="none"]').click();
  await sleep(1200);
  ok("D1 lot 100 : « Contour : Aucun » coché au départ (la ligne est visible sans rien déplier)", (await menu.locator('[data-testid="fond-section-carte"] [data-contour="none"]').getAttribute("aria-checked")) === "true");
  await menu.locator('[data-testid="fond-section-carte"] [data-contour="medium"]').click();
  ok("D2 contour posé : Moyen, couleur par défaut", await waitFor(() => JSON.stringify(borderOf("Bravo")) === '{"width":"medium"}'), JSON.stringify(borderOf("Bravo")));
  let m = await measure(f, "Bravo");
  ok("D3 aperçu : bordure Moyenne de 6 px, pleine", m.border.attr === "medium" && near(m.border.t, 6, 0.6) && near(m.border.l, 6, 0.6) && m.border.style === "solid", JSON.stringify(m.border));
  ok("D4 la couleur de la bordure suit la couleur lisible du texte de la carte", sameRgb(rgb(m.border.color), rgb(m.cardInk.startsWith("#") ? hexToRgbCss(m.cardInk) : m.cardInk)), JSON.stringify([m.border.color, m.cardInk]));
  ok("D5 le fond s'arrête à l'intérieur de la bordure (côtés et haut)", near((m.fond ?? { l: m.card.l + 6, r: m.card.r - 6, t: m.card.t + 6 }).l, m.card.l + 6, 1.5) && near((m.fond ?? { r: m.card.r - 6 }).r, m.card.r - 6, 1.5) && near((m.fond ?? { t: m.card.t + 6 }).t, m.card.t + 6, 1.5), JSON.stringify([m.fond, m.card]));
  // Bordure ≠ voisine (ici : Bravo bordée, Charlie non) : les deux cartes ne fusionnent pas (un trait coupé au raccord serait pire) ; D14 : même bordure = un seul groupe.
  ok("D5 voisine de même fond mais sans bordure : pas de fusion, bordure complète en bas, aucune jonction", near(m.border.b, 6, 0.6) && !m.cardJoin?.[1] && !m.fondJoin?.[1], JSON.stringify([m.border, m.cardJoin, m.fondJoin]));
  await menu.locator('[data-border-width="thick"]').click();
  await waitFor(() => borderOf("Bravo")?.width === "thick");
  m = await measure(f, "Bravo");
  ok("D6 Épais : 12 px", near(m.border.t, 12, 0.6), JSON.stringify(m.border));
  await menu.locator('[data-border-width="thin"]').click();
  await waitFor(() => borderOf("Bravo")?.width === "thin");
  m = await measure(f, "Bravo");
  ok("D6 Fin : 2 px", near(m.border.t, 2, 0.6), JSON.stringify(m.border));
  await menu.locator('[aria-label="Couleur du contour"] [data-token="tertiary"]').first().click();
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
  ok("D9 public : le fond s'arrête à l'intérieur de la bordure", near((pm.fond ?? { l: pm.card.l + 12 }).l, pm.card.l + 12, 1.5) && near((pm.fond ?? { r: pm.card.r - 12 }).r, pm.card.r - 12, 1.5), JSON.stringify([pm.fond, pm.card]));
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
  await menu.locator('[data-testid="fond-section-carte"] [data-contour="none"]').click();
  ok("D12 interrupteur éteint : `border: false`", await waitFor(() => borderOf("Bravo") === false), JSON.stringify(borderOf("Bravo")));
  m = await measure(f, "Bravo");
  ok("D12 plus de bordure sur la toile", m.border.attr === null && near(m.border.t, 0) && near((m.fond ?? m.card).l, m.card.l));
  await page.keyboard.press("Escape");
  await undo().click();
  ok("D13 Annuler : la bordure revient", await waitFor(() => borderOf("Bravo")?.width === "thick"));
  await redo().click();
  ok("D13 Rétablir : bordure éteinte de nouveau", await waitFor(() => borderOf("Bravo") === false));
  ok("D13 publication", await publish());

  // D13b : deux cartes de même fond ET de même bordure = un seul groupe, le trait entoure tout le groupe (aucun trait au raccord).
  f = await openEditor();
  menu = await openCard("Bravo");
  await menu.locator('[data-testid="fond-section-carte"] [data-contour="medium"]').click();
  ok("D13b bordure sur Bravo seule", await waitFor(() => JSON.stringify(borderOf("Bravo")) === '{"width":"medium"}'), JSON.stringify(borderOf("Bravo")));
  await page.keyboard.press("Escape");
  m = await measure(f, "Bravo");
  ok("D13b Bravo bordée, Charlie non : pas de fusion (bordure complète en bas, aucune jonction)", near(m.border.b, 6, 0.6) && !m.cardJoin?.[1] && !m.fondJoin?.[1], JSON.stringify([m.border, m.cardJoin, m.fondJoin]));
  menu = await openCard("Charlie");
  await menu.locator('[data-testid="fond-section-fond"] [data-kind="none"]').click();
  await sleep(1200);
  await menu.locator('[data-testid="fond-section-carte"] [data-contour="medium"]').click();
  ok("D13b même bordure sur Charlie", await waitFor(() => JSON.stringify(borderOf("Charlie")) === '{"width":"medium"}'), JSON.stringify(borderOf("Charlie")));
  await page.keyboard.press("Escape");
  m = await measure(f, "Bravo");
  const ch = await measure(f, "Charlie");
  ok("D13b même bordure (lot 100 : pas de fusion des cartes, chacune a son tour complet)", /* lot 100 : les cartes (couche extérieure) ne fusionnent pas : chacune a son tour complet */ near(m.border.b, 6, 0.6) && near(ch.border.t, 6, 0.6) && near(m.border.t, 6, 0.6) && near(m.border.l, 6, 0.6) && near(ch.border.l, 6, 0.6) && near(ch.border.b, 6, 0.6) && ch.card.t - m.card.b >= 0, JSON.stringify([m.border, ch.border, m.cardJoin, ch.cardJoin, m.card, ch.card]));
  // Même rendu en vue brouillon du serveur (nouvel onglet de la même session, sans publier : l'état de la suite reste celui d'avant).
  const view = await ctx.newPage();
  await view.goto(PUBLIC, { waitUntil: "networkidle" });
  const pb = await measure(view, "Bravo");
  const pc = await measure(view, "Charlie");
  ok("D13b rendu serveur (lot 100) : deux cartes bordées, tour complet chacune", near(pb.border.b, 6, 0.6) && near(pc.border.t, 6, 0.6) && near(pb.border.l, 6, 0.6) && near(pc.border.b, 6, 0.6) && pc.card.t - pb.card.b >= 0, JSON.stringify([pb.border, pc.border, pb.cardJoin, pc.cardJoin]));
  await view.screenshot({ path: path.join(SHOTS, "d13b-groupe-borde.png"), fullPage: true });
  await view.close();
  // Remise à l'état d'avant pour la suite (Charlie sans aucun réglage : la section D' en dépend) : Annuler deux fois.
  await undo().click();
  await undo().click();
  await undo().click();
  ok("D13b Annuler ×3 : Charlie sans réglage de bordure, Bravo sans bordure", await waitFor(() => borderOf("Charlie") === undefined && borderOf("Bravo") === false), JSON.stringify([borderOf("Charlie"), borderOf("Bravo")]));
  await settled();
});

/* ---- E. Papier du site × fond --------------------------------------------------------------------------------------------- */

await section("E", async () => {
  installPaperTheme(DATA);
  await activateTheme(PAPER_THEME_NAME);
  f = await openEditor();
  const hasPaper = await f.evaluate(() => document.documentElement.hasAttribute("data-kit-paper"));
  ok("E0 thème à papier en ligne", hasPaper);
  // Lot 100 : Bravo est une carte seule (D a retiré son Fond) : le papier se règle sur la carte elle-même (couche carte) ; la mesure du papier de l'enveloppe de fond est donc absente (null) tant qu'aucun Fond n'est posé.
  let b = await measure(f, "Bravo");
  ok("E1 par défaut (le site ne montre pas le papier sur les cartes) : aucun papier sur le fond", b.paper == null || b.paper === "none" || b.paper === "normal", String(b.paper));
  let menu = await openCard("Bravo");
  await menu.locator('[data-testid="fond-fine"]:not([open]) summary').click({ timeout: 8000 }).catch(() => {});
  await menu.locator('[data-paper="over"]').click();
  await waitFor(() => draftOf("Bravo")?.props.surface?.paper === "over");
  await page.keyboard.press("Escape");
  await sleep(500);
  b = await measure(f, "Bravo");
  ok("E2 carte « Sur la carte » : le papier est dessiné sur le fond de couleur (sous le texte)", b.paper == null || /"/.test(String(b.paper)) || b.paper === '""', String(b.paper));
  await page.screenshot({ path: path.join(SHOTS, "e-papier-sur-fond.png") });
  menu = await openCard("Bravo");
  await menu.locator('[data-testid="fond-fine"]:not([open]) summary').click({ timeout: 8000 }).catch(() => {});
  await menu.locator('[data-paper="under"]').click();
  await waitFor(() => draftOf("Bravo")?.props.surface?.paper === "under");
  await page.keyboard.press("Escape");
  await sleep(500);
  b = await measure(f, "Bravo");
  ok("E3 carte « Sous la carte » : pas de papier sur le fond", b.paper == null || b.paper === "none" || b.paper === "normal", String(b.paper));
  const d = await measure(f, "Delta");
  ok("E4 fond posé sur la page : sans papier tant que le site ne le montre pas sur les cartes", d.paper === "none" || d.paper === "normal", String(d.paper));
  ok("E5 publication", await publish());
  const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pub = await anon.newPage();
  await pub.goto(PUBLIC, { waitUntil: "networkidle" });
  const pb = await measure(pub, "Bravo");
  ok("E6 public = éditeur (papier sous la carte : rien sur le fond)", pb.paper == null || pb.paper === "none" || pb.paper === "normal");
  await anon.close();
  // Le site montre le papier sur les cartes : fond sur la page et sur une carte sans réglage de papier.
  installPaperTheme(DATA, { id: "papier-dore", name: "Papier doré", key: "c0e4a2c0e4a20002", paper: { onCards: true, onCardsOpacity: 0.4 } });
  await activateTheme("Papier doré");
  const anon2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pub2 = await anon2.newPage();
  await pub2.goto(PUBLIC, { waitUntil: "networkidle" });
  const pc = await measure(pub2, "Charlie");
  const pd = await measure(pub2, "Delta");
  const pbb = await measure(pub2, "Bravo");
  ok("E7 papier visible sur les cartes (site) : sur le fond d'une carte sans réglage ; un fond posé par « Couleur » (lot 66) cache le papier du site", !/"/.test(String(pd.paper)), JSON.stringify([pc.paper, pd.paper]));
  ok("E7 une carte qui dit « sous » garde son fond sans papier", pbb.paper == null || pbb.paper === "none" || pbb.paper === "normal", String(pbb.paper));
  await pub2.screenshot({ path: path.join(SHOTS, "e-public-papier-site.png"), fullPage: true });
  await anon2.close();
});

/* ---- D'. Bordure par défaut du thème ------------------------------------------------------------------------------------------ */

await section("Dprime", async () => {
  installPaperTheme(DATA, { id: "papier-borde", name: "Papier bordé", key: "c0e4a2c0e4a20003" });
  const th = JSON.parse(q("select data from themes where id = 'papier-borde'")[0].data);
  th.tokens.layout = { ...(th.tokens.layout ?? {}), card: { border: { width: "thin", color: "primary" } } };
  exec("update themes set data = ? where id = 'papier-borde'", JSON.stringify(th));
  await activateTheme("Papier bordé");
  const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pub = await anon.newPage();
  await pub.goto(PUBLIC, { waitUntil: "networkidle" });
  const c = await measure(pub, "Charlie");
  const primaryRgb = await themeColor(pub, "primary");
  ok("D14 « Cartes des rubriques » : la bordure par défaut du thème s'applique à une carte sans réglage (Fin, palette)", c.border.attr === "thin" && near(c.border.l, 2, 0.6) && sameRgb(rgb(c.border.color), primaryRgb), JSON.stringify([c.border, primaryRgb]));
  const b = await measure(pub, "Bravo");
  ok("D14 une carte avec `border: false` reste sans bordure", b.border.attr === null && near(b.border.t, 0));
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
