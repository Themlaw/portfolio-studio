#!/usr/bin/env node
/**
 * Fond avec marge et coins arrondis (lot 43), UN chromium. Serveur requis, base NEUVE (seed), une connexion.
 * Page « À propos » remplacée par sept Textes : Alpha (fond primaire bord à bord), Bravo (fond profond, marge M, coins M : l'exemple de
 * l'artiste, entouré par la couleur d'Alpha), Charlie (fond sans réglage : témoin), Delta (sur une carte, marge S), Echo (marge L, coins S,
 * aucun voisin coloré), Foxtrot (sans fond), Golf (fond primaire bord à bord).
 *
 *  A. Public (1440 px) : marge M = 24 px de chaque côté et au-dessus, coins 20 px, ombre pleine = couleur d'Alpha ; témoin inchangé
 *     (bord à bord, coins droits, aucun attribut, aucune ombre) ; un fond avec marge ne fusionne pas ; carte : marge comptée depuis la carte.
 *  B. Téléphone (390 px) : marges et coins réduits, pas de défilement horizontal.
 *  C. Toile : mêmes mesures que le public ; vrais clics dans la fenêtre « Fond » (Avec marge, Petit / Moyen / Grand, Coins, Bord à bord) ;
 *     aperçu immédiat ; couleur qui entoure posée à l'instant (voisin d'après) ; données : champs facultatifs seulement.
 *  D. Planche d'un projet : fond avec marge (public + clics dans la fenêtre « Fond » de la planche).
 *  E. Parité : sans réglage, aucun attribut de marge ni de coins dans le HTML public.
 * Captures : $SHOTS (défaut screenshots/fond-marge43).
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";

import { pageIdOf, placeBoard } from "./lib/page-board.mjs";
import { publishBlocks } from "./lib/page-draft.mjs";
import { autoOpenFine } from "./lib/zone66.mjs";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const DATA = process.env.DATA_DIR ?? "data";
const DB = path.join(DATA, "portfolio.db");
const SHOTS = process.env.SHOTS ?? "screenshots/fond-marge43";
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
async function waitFor(fn, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(300);
  }
  return false;
}
const near = (a, b, tol = 1.5) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= tol;
const draftBlocks = () => JSON.parse(q("select draft from pages where id = ?", PAGE_ID)[0]?.draft || "null")?.blocks ?? [];
const draftOf = (word) => draftBlocks().find((b) => JSON.stringify(b.props).includes(word));
const bgOfDraft = (word) => draftOf(word)?.props.background;

/* ---- Mise en place ---------------------------------------------------------------------------------------------------------- */
const SEED = {
  Alpha: { background: { kind: "color", color: "primary" } },
  Bravo: { background: { kind: "color", color: "bgDeep", inset: "m", round: "m" } },
  Charlie: { background: { kind: "color", color: "surface" } },
  Delta: { surface: { color: "surface" }, background: { kind: "color", color: "primary", inset: "s" } },
  Echo: { background: { kind: "color", color: "bgDeep", inset: "l", round: "s" } },
  Foxtrot: {},
  Golf: { background: { kind: "color", color: "primary" } },
};
const SEED_BLOCKS = Object.entries(SEED).map(([w, extra], i) => ({
  uid: `fm${i}`,
  type: "rich-text",
  props: { paragraphs: [{ fr: `${w} : un texte assez long pour que le fond de couleur ait du contenu à entourer, sur une ligne ou deux.`, en: `${w}: some text.` }], ...extra },
}));
exec("delete from blocks where page_id = ?", PAGE_ID);
exec("update pages set draft = NULL, draft_rev = 0 where id = ?", PAGE_ID);


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
  const cs = fond ? getComputedStyle(fond) : null;
  const px = (v) => parseFloat(v) || 0;
  return {
    fond: box(fond),
    card: box(card),
    bg: cs?.backgroundColor ?? null,
    radius: cs ? px(cs.borderTopLeftRadius) : null,
    radiusBR: cs ? px(cs.borderBottomRightRadius) : null,
    shadow: cs?.boxShadow ?? null,
    clip: cs?.clipPath ?? null,
    marginL: cs ? px(cs.marginLeft) : null,
    attrs: fond ? { inset: fond.getAttribute("data-fond-inset"), round: fond.getAttribute("data-fond-round"), prev: fond.hasAttribute("data-join-prev"), next: fond.hasAttribute("data-join-next") } : null,
    vw: document.documentElement.clientWidth,
    sw: document.documentElement.scrollWidth,
  };
};
const rgb = (css) => (/rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(css ?? "") ?? []).slice(1, 4).map(Number);
const sameRgb = (a, b) => a.length === 3 && b.length === 3 && a.every((v, i) => Math.abs(v - b[i]) <= 1);
const themeColor = async (where, name) =>
  rgb(await where.evaluate((n) => { const s = document.createElement("span"); s.style.color = `var(--t-color-${n})`; document.body.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; }, name));

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const errors = [];

const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await autoOpenFine(ctx);
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${BASE}/admin/connexion`, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL);
await page.fill("#password", PASSWORD);
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/admin/connexion"), { timeout: 90000 }), page.click("button[type=submit]")]);

// La page est publiée comme le fait l'artiste (revalidation du cache public comprise).
ok("0 page de test publiée (sept Textes)", await publishBlocks(page, BASE, PAGE_ID, () => SEED_BLOCKS, () => q("select count(*) n from blocks where page_id = ?", PAGE_ID)[0].n === SEED_BLOCKS.length && q("select draft from pages where id = ?", PAGE_ID)[0].draft === null));

/* ---- A + E. Public, ordinateur ------------------------------------------------------------------------------------------------ */
let primary = [0, 0, 0];
const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const pub = await anon.newPage();
pub.on("pageerror", (e) => errors.push(e.message));
await pub.goto(PUBLIC, { waitUntil: "networkidle" });
primary = await themeColor(pub, "primary");
{
  const [a, b, c, d, e] = [await pub.evaluate(MEASURE, "Alpha"), await pub.evaluate(MEASURE, "Bravo"), await pub.evaluate(MEASURE, "Charlie"), await pub.evaluate(MEASURE, "Delta"), await pub.evaluate(MEASURE, "Echo")];
  ok("A1 Alpha bord à bord (témoin de l'exemple)", near(a.fond.l, 0) && near(a.fond.r, a.vw), JSON.stringify(a.fond));
  ok("A2 Bravo : marge M de 24 px à gauche et à droite", near(b.fond.l, 24) && near(b.fond.r, b.vw - 24), JSON.stringify(b.fond));
  ok("A3 Bravo : 24 px d'écart au-dessus (entre le fond d'Alpha et le sien)", near(b.fond.t - a.fond.b, 24, 2), `${b.fond.t - a.fond.b}`);
  ok("A4 Bravo : coins arrondis M (20 px)", near(b.radius, 20) && near(b.radiusBR, 20), JSON.stringify([b.radius, b.radiusBR]));
  ok("A5 Bravo : sa couleur (fond profond) et, autour, la couleur d'Alpha (lot 100 : plus de couleur du voisin autour, le fond de la page se voit)", !sameRgb(rgb(b.bg), primary) && rgb(b.bg).length === 3 && !b.shadow.includes(`rgb(${primary[0]}, ${primary[1]}, ${primary[2]})`) && b.clip === "none", JSON.stringify([b.bg, b.shadow, b.clip]));
  ok("A6 un fond avec marge ne fusionne pas (ni Alpha ni lui n'ont de jonction)", !a.attrs.next && !b.attrs.prev && !b.attrs.next && b.attrs.inset === "m" && b.attrs.round === "m", JSON.stringify([a.attrs, b.attrs]));
  ok("A7 témoin sans réglage (Charlie) : bord à bord, coins droits, ni marge, ni ombre, aucun attribut", near(c.fond.l, 0) && near(c.fond.r, c.vw) && c.radius === 0 && c.marginL === 0 && c.shadow === "none" && c.attrs.inset === null && c.attrs.round === null, JSON.stringify([c.fond, c.radius, c.shadow, c.attrs]));
  ok("A8 sur une carte (Delta, marge S) : 12 px depuis le bord de la carte, jamais à l'extérieur", d.card && near(d.fond.l - d.card.l, 12) && near(d.card.r - d.fond.r, 12) && d.fond.t >= d.card.t + 11, JSON.stringify([d.fond, d.card]));
  ok("A9 sur une carte : pas de couleur voisine (la carte entoure le fond)", d.shadow === "none" || /rgba\(0, 0, 0, 0\)/.test(d.shadow), d.shadow);
  ok("A10 Echo : marge L (48 px), coins S (10 px), aucun voisin coloré avant : ombre transparente", near(e.fond.l, 48) && near(e.radius, 10) && (e.shadow === "none" || /rgba\(0, 0, 0, 0\)/.test(e.shadow)), JSON.stringify([e.fond, e.radius, e.shadow]));
  ok("A11 pas de défilement horizontal", b.sw <= b.vw + 1, `${b.sw} / ${b.vw}`);
  await pub.evaluate(() => [...document.querySelectorAll("p")].find((e) => e.textContent.includes("Alpha"))?.scrollIntoView({ block: "start" }));
  await sleep(500);
  await pub.screenshot({ path: path.join(SHOTS, "public-exemple.png") });
  const html = await pub.content();
  ok("E1 le HTML public ne porte data-fond-inset que sur les fonds réglés (3 enveloppes) et data-fond-round sur 2", (html.match(/data-fond-inset=/g) ?? []).length === 3 && (html.match(/data-fond-round=/g) ?? []).length === 2, `${(html.match(/data-fond-inset=/g) ?? []).length}/${(html.match(/data-fond-round=/g) ?? []).length}`);
}
await anon.close();

/* ---- B. Téléphone ------------------------------------------------------------------------------------------------------------- */
{
  const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const pp = await ph.newPage();
  await pp.goto(PUBLIC, { waitUntil: "networkidle" });
  const [a, b, c, e] = [await pp.evaluate(MEASURE, "Alpha"), await pp.evaluate(MEASURE, "Bravo"), await pp.evaluate(MEASURE, "Charlie"), await pp.evaluate(MEASURE, "Echo")];
  ok("B1 téléphone : Bravo, marge réduite (14 px) et coins réduits (14 px)", near(b.fond.l, 14) && near(b.fond.r, b.vw - 14) && near(b.radius, 14), JSON.stringify([b.fond, b.radius]));
  ok("B2 téléphone : Echo (L) = 24 px, coins S = 8 px", near(e.fond.l, 24) && near(e.radius, 8), JSON.stringify([e.fond, e.radius]));
  ok("B3 téléphone : Alpha et le témoin restent bord à bord", near(a.fond.l, 0) && near(c.fond.l, 0) && near(c.fond.r, c.vw) && c.radius === 0, JSON.stringify([a.fond, c.fond]));
  ok("B4 téléphone : pas de défilement horizontal", b.sw <= b.vw + 1, `${b.sw} / ${b.vw}`);
  await pp.evaluate(() => [...document.querySelectorAll("p")].find((x) => x.textContent.includes("Alpha"))?.scrollIntoView({ block: "start" }));
  await sleep(400);
  await pp.screenshot({ path: path.join(SHOTS, "telephone-exemple.png") });
  await ph.close();
}

/* ---- C. Toile --------------------------------------------------------------------------------------------------------------- */
async function canvas() {
  const handle = await page.waitForSelector("iframe.ve-frame", { timeout: 120000 });
  const fr = await handle.contentFrame();
  await fr.waitForSelector("html[data-edit-mode]", { timeout: 180000 });
  return fr;
}
async function settled() {
  await page.waitForFunction(() => !/Enregistrement/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, { timeout: 120000 });
  await sleep(700);
}
await page.goto(`${BASE}/admin/pages/${PAGE_ID}/editer`, { waitUntil: "domcontentloaded" });
let f = await canvas();
await sleep(1500);
async function openFond(word) {
  const host = f.locator('[data-edit-block][data-edit-type="rich-text"]', { hasText: word }).first();
  for (let attempt = 0; ; attempt++) {
    try {
      await host.scrollIntoViewIfNeeded();
      await host.locator("section").first().click({ position: { x: 4, y: 30 } });
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
try {
  {
    const [a, b, c] = [await f.evaluate(MEASURE, "Alpha"), await f.evaluate(MEASURE, "Bravo"), await f.evaluate(MEASURE, "Charlie")];
    ok("C1 toile : même rendu que le public (Bravo à 24 px des bords, coins 20 px, ombre de la couleur d'Alpha)", near(b.fond.l - a.fond.l, 24) && near(a.fond.r - b.fond.r, 24) && near(b.radius, 20) && !b.shadow.includes(`rgb(${primary[0]}, ${primary[1]}, ${primary[2]})`), JSON.stringify([a.fond, b.fond, b.radius, b.shadow]));
    ok("C2 toile : le témoin reste bord à bord, coins droits", near(c.fond.l, a.fond.l) && near(c.fond.r, a.fond.r) && c.radius === 0, JSON.stringify([c.fond, c.radius]));
    await f.evaluate(() => [...document.querySelectorAll("p")].find((e) => e.textContent.includes("Alpha"))?.scrollIntoView({ block: "start" }));
    await sleep(500);
    await page.screenshot({ path: path.join(SHOTS, "toile-exemple.png") });
  }

  // Vrais clics sur Charlie (témoin) : « Avec marge », tailles, coins, retour « Bord à bord ».
  let menu = await openFond("Charlie");
  ok("C3 lot 100 : la fenêtre a deux sections ; la Carte est sur « Aucune », pas de ligne Marge", (await menu.locator('[data-testid="fond-section-carte"] [data-kind="none"]').getAttribute("aria-checked")) === "true" && (await menu.locator('[data-testid="fond-section-carte"] [data-testid="fond-inset"]').count()) === 0);
  await menu.locator('[data-testid="fond-section-carte"] [data-kind="color"]').click();
  ok("C4 « Avec marge » : `inset: m` enregistré, rien d'autre ne change", await waitFor(() => JSON.stringify(bgOfDraft("Charlie")) === '{"kind":"color","color":"surface","inset":"m","paper":"under"}'), JSON.stringify(bgOfDraft("Charlie")));
  let m = await f.evaluate(MEASURE, "Charlie");
  ok("C5 aperçu immédiat : marge M de 24 px", near(m.marginL, 24) && m.attrs.inset === "m", JSON.stringify([m.marginL, m.attrs]));
  await menu.locator('[data-testid="fond-section-carte"] [data-testid="fond-inset"] [data-step="l"]').click();
  ok("C6 « Grand » : `inset: l`, marge 48 px", (await waitFor(() => bgOfDraft("Charlie")?.inset === "l")) && near((await f.evaluate(MEASURE, "Charlie")).marginL, 48), JSON.stringify(bgOfDraft("Charlie")));
  await menu.locator('[data-testid="fond-section-carte"] [data-testid="fond-round"] [data-step="m"]').click();
  ok("C7 Coins « Moyen » : `round: m`, rayon 20 px", (await waitFor(() => bgOfDraft("Charlie")?.round === "m")) && near((await f.evaluate(MEASURE, "Charlie")).radius, 20), JSON.stringify(bgOfDraft("Charlie")));
  await page.screenshot({ path: path.join(SHOTS, "toile-fenetre-fond.png") });
  await menu.locator('[data-testid="fond-section-carte"] [data-testid="fond-round"] [data-step="none"]').click();
  ok("C8 Coins « Droits » : `round` retiré", (await waitFor(() => bgOfDraft("Charlie") && !("round" in bgOfDraft("Charlie")))) && (await f.evaluate(MEASURE, "Charlie")).radius === 0, JSON.stringify(bgOfDraft("Charlie")));
  await menu.locator('[data-testid="fond-section-fond"] [data-kind="color"]').click();
  ok("C9 lot 100 : poser un Fond (zone autour) ne touche pas la marge de la Carte", bgOfDraft("Charlie")?.inset === "l", JSON.stringify(bgOfDraft("Charlie")));
  // Changer de couleur garde la marge choisie.
  await menu.locator('[data-testid="fond-section-carte"] [data-kind="color"]').click();
  await menu.locator('[data-testid="fond-section-carte"] [data-testid="card-da-color"][data-token="primary"]').click();
  ok("C10 changer la couleur garde la marge", await waitFor(() => JSON.stringify(bgOfDraft("Charlie")) === '{"kind":"color","color":"primary","inset":"l","paper":"under"}'), JSON.stringify(bgOfDraft("Charlie")));
  await page.keyboard.press("Escape");
  await settled();

  // Foxtrot (sans fond) : marge posée à la main, la couleur de Golf (voisin d'après) l'entoure aussitôt.
  menu = await openFond("Foxtrot");
  await menu.locator('[data-testid="fond-section-fond"] [data-kind="color"]').click();
  await menu.locator('[data-testid="fond-section-carte"] [data-kind="color"]').click();
  ok("C11 Foxtrot : fond + marge enregistrés", await waitFor(() => bgOfDraft("Foxtrot")?.inset === "m" && bgOfDraft("Foxtrot")?.kind === "color"), JSON.stringify(bgOfDraft("Foxtrot")));
  await sleep(500);
  m = await f.evaluate(MEASURE, "Foxtrot");
  ok("C12 aperçu : lot 100 : la couleur du voisin d'après (Golf) n'entoure plus le fond (ce qui entoure est le fond de la page)", !m.shadow.includes(`rgb(${primary[0]}, ${primary[1]}, ${primary[2]})`), m.shadow);
  await page.keyboard.press("Escape");
  await settled();
  await f.evaluate(() => [...document.querySelectorAll("p")].find((e) => e.textContent.includes("Foxtrot"))?.scrollIntoView({ block: "center" }));
  await sleep(500);
  await page.screenshot({ path: path.join(SHOTS, "toile-apercu-voisin.png") });
  await page.keyboard.press("Control+z");
  await sleep(800);
  ok("C13 Annuler : revient en arrière sans casser la page", (await f.evaluate(MEASURE, "Alpha")) !== null);

  /* ---- D. Planche d'un projet ---- */
  const PROJECT = q("select id, slug from projects order by position limit 1")[0];
  const HOME = pageIdOf("");
  ok("D0 planche posée sur l'accueil", await placeBoard(page, BASE, HOME, PROJECT.slug));
  const layout = [
    { uid: "bm1", type: "strip", props: { background: { kind: "color", color: "primary" } } },
    { uid: "bm2", type: "rich-text", props: { paragraphs: [{ fr: "Planche : un texte avec marge.", en: "x" }], background: { kind: "color", color: "bgDeep", inset: "m", round: "m" } } },
    { uid: "bm3", type: "rich-text", props: { paragraphs: [{ fr: "Planche : un texte témoin.", en: "y" }], background: { kind: "color", color: "surface" } } },
  ];
  exec("update projects set draft_layout = ?, draft_layout_page_id = ? where id = ?", JSON.stringify(layout), HOME, PROJECT.id);
  ok("D0b suite du projet publiée par l'éditeur", await publishBlocks(page, BASE, HOME, (b) => b, () => { const r = q("select layout, draft_layout from projects where id = ?", PROJECT.id)[0]; return r.draft_layout === null && String(r.layout).includes('"inset":"m"'); }));
  const geo = (where) =>
    where.evaluate((slug) => {
      const sect = document.querySelector(`[aria-labelledby="project-${slug}"]`) ?? document.querySelector("[data-edit-board]");
      const s = sect.getBoundingClientRect();
      return [...sect.querySelectorAll(".fond-bloc")].map((w) => {
        const r = w.getBoundingClientRect();
        const cs = getComputedStyle(w);
        return { l: r.left - s.left, r: s.right - r.right, radius: parseFloat(cs.borderTopLeftRadius) || 0, shadow: cs.boxShadow, bg: cs.backgroundColor, inset: w.getAttribute("data-fond-inset"), next: w.hasAttribute("data-join-next"), prev: w.hasAttribute("data-join-prev") };
      });
    }, PROJECT.slug);
  const anon2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ap = await anon2.newPage();
  await ap.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  const g = await geo(ap);
  ok("D1 public, planche : 3 enveloppes ; la bande bord à bord, le texte avec marge (24 px, coins 20 px, couleur de la bande autour), le témoin bord à bord", g.length === 3 && near(g[0].l, 0) && near(g[1].l, 24) && near(g[1].r, 24) && near(g[1].radius, 20) && !g[1].shadow.includes(`rgb(${primary[0]}, ${primary[1]}, ${primary[2]})`) && near(g[2].l, 0) && g[2].radius === 0 && g[2].shadow === "none", JSON.stringify(g));
  ok("D2 public, planche : le fond avec marge ne fusionne pas avec la bande", !g[0].next && !g[1].prev && !g[1].next && !g[2].prev, JSON.stringify(g.map((x) => [x.prev, x.next])));
  await ap.locator(`[aria-labelledby="project-${PROJECT.slug}"]`).screenshot({ path: path.join(SHOTS, "public-planche.png") }).catch(() => {});
  await anon2.close();

  await page.goto(`${BASE}/admin/pages/${HOME}/editer`, { waitUntil: "domcontentloaded" });
  f = await canvas();
  await sleep(1500);
  const board = f.locator(`[data-edit-board="${PROJECT.id}"]`).first();
  await board.scrollIntoViewIfNeeded();
  const frames = board.locator("[data-edit-bitem]");
  ok("D3 toile : trois composants", await waitFor(async () => (await frames.count()) === 3));
  const gc = await f.evaluate((id) => {
    const sect = document.querySelector(`[data-edit-board="${id}"]`);
    const s = sect.getBoundingClientRect();
    return [...sect.querySelectorAll(".fond-bloc")].map((w) => ({ l: w.getBoundingClientRect().left - s.left, radius: parseFloat(getComputedStyle(w).borderTopLeftRadius) || 0 }));
  }, PROJECT.id);
  ok("D4 toile, planche : même rendu que le public", gc.length === 3 && near(gc[0].l, 0) && near(gc[1].l, 24) && near(gc[1].radius, 20) && near(gc[2].l, 0), JSON.stringify(gc));
  // Clics dans la fenêtre « Fond » de la planche, sur le témoin (3e composant).
  const fr3 = frames.nth(2);
  await fr3.scrollIntoViewIfNeeded();
  await fr3.hover();
  await fr3.locator('[data-edit-bitem-op="fond"]').click();
  const bmenu = f.locator('[data-testid="fond-menu"]');
  await bmenu.waitFor({ timeout: 20000 });
  await bmenu.locator('[data-testid="fond-section-carte"] [data-kind="color"]').click();
  const effective = () => (q("select draft_layout from projects where id = ?", PROJECT.id)[0].draft_layout ? JSON.parse(q("select draft_layout from projects where id = ?", PROJECT.id)[0].draft_layout) : layout);
  ok("D5 planche : « Avec marge » enregistré dans le brouillon du projet", await waitFor(() => effective()[2]?.props?.background?.inset === "m"), JSON.stringify(effective()[2]?.props?.background));
  await bmenu.locator('[data-testid="fond-section-carte"] [data-testid="fond-inset"] [data-step="s"]').click();
  await bmenu.locator('[data-testid="fond-section-carte"] [data-testid="fond-round"] [data-step="l"]').click();
  ok("D6 planche : Petit et coins Grand enregistrés", await waitFor(() => { const b = effective()[2]?.props?.background; return b?.inset === "s" && b?.round === "l"; }), JSON.stringify(effective()[2]?.props?.background));
  await page.keyboard.press("Escape");
  await settled();
  const gc2 = await f.evaluate((id) => {
    const sect = document.querySelector(`[data-edit-board="${id}"]`);
    const s = sect.getBoundingClientRect();
    return [...sect.querySelectorAll(".fond-bloc")].map((w) => ({ l: w.getBoundingClientRect().left - s.left, radius: parseFloat(getComputedStyle(w).borderTopLeftRadius) || 0 }));
  }, PROJECT.id);
  ok("D7 toile, planche : le composant garde sa marge S (12 px) et ses coins L (36 px) après rechargement", near(gc2[2]?.l, 12) && near(gc2[2]?.radius, 36), JSON.stringify(gc2));
  await board.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await sleep(500);
  await page.screenshot({ path: path.join(SHOTS, "toile-planche.png") });
  ok("F aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
}
if (failures) {
  console.log(`${failures} échec(s)`);
  process.exit(1);
}
