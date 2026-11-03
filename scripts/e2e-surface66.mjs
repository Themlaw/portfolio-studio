#!/usr/bin/env node
/**
 * Fond unique, « Surface » commune (lot 66) : le menu « Fond » remplace « Carte » + « Fond » ; retours de l'artiste R5, R6, R7. UN chromium.
 * Serveur requis (dev ou start), base NEUVE (seed), une connexion. Thème à papier, deux motifs en bibliothèque (Pois roses, Étoiles dorées),
 * papier peint des cartes du SITE = Pois roses, papier peint de la PAGE « À propos » = Étoiles dorées : c'est exactement la situation de la vidéo.
 * Page « À propos » : Alpha (rien), Bravo (ancienne carte), Charlie (ancien fond de couleur), Delta (la rubrique réglée), Echo (carte ET fond
 * emboîté d'avant), Foxtrot (carte + papier peint d'avant).
 *
 *  R5. « Aucun » et « Couleur » retirent vraiment le papier de la zone réglée ; changer de nature ne remplace JAMAIS un choix (le même motif
 *      revient avec ses réglages, aucun motif n'est choisi par défaut) ; un papier qui vient d'une autre couche est dit (« Papier peint de la
 *      page », avec un lien qui ouvre les Réglages de la page) ; un ancien fond qui montre le papier du site propose de le cacher.
 *  R6. L'opacité du motif descend à 0 %.
 *  R7. Un seul bouton « Fond » (plus de « Carte »), menu court : Aucun / Couleur / Papier peint, Étendue, couleur ; réglages fins repliés.
 *  E.  Étendue : Pleine largeur / Carte en retrait ; ouvrir le menu n'écrit rien (aucune donnée touchée) ; carte + fond emboîté gardés.
 *  P.  Public = éditeur ; aucune donnée de forme nouvelle sauf `paper: "under"` (ajout).
 * Captures : $SHOTS (défaut screenshots/surface66).
 * Usage : DATA_DIR=… ADMIN_EMAIL=… ADMIN_PASSWORD=… BASE=http://localhost:3102 node scripts/e2e-surface66.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";

import { installPaperTheme, PAPER_THEME_NAME } from "./lib/paper-theme.mjs";
import { activateThemeUi } from "./lib/theme-live.mjs";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const DATA = process.env.DATA_DIR ?? "data";
const DB = path.join(DATA, "portfolio.db");
const SHOTS = process.env.SHOTS ?? "screenshots/surface66";
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
    db.pragma("busy_timeout = 5000");
    db.prepare(sql).run(...args);
  } finally {
    db.close();
  }
};
const draftBlocks = () => JSON.parse(q("select draft from pages where id = ?", PAGE_ID)[0]?.draft || "null")?.blocks ?? [];
const draftBlock = (word) => draftBlocks().find((b) => JSON.stringify(b.props).includes(word));
const props = (word) => draftBlock(word)?.props ?? {};
async function waitFor(fn, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(300);
  }
  return false;
}

/* ---- Fixtures : deux motifs PNG sur fond transparent ---------------------------------------------------------------------------- */

const FIX = mkdtempSync(path.join(tmpdir(), "pf-surface66-"));
execFileSync(
  process.execPath,
  [
    "-e",
    `
const sharp = require("sharp");
const dir = process.argv[1];
const dots = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><g fill="#e07a9a"><circle cx="60" cy="60" r="26"/><circle cx="180" cy="180" r="26"/></g></svg>';
const stars = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><g fill="#e0b84a"><path d="M80 30l14 30 33 4-24 23 6 33-29-16-29 16 6-33-24-23 33-4z"/></g></svg>';
(async () => {
  await sharp(Buffer.from(dots)).png().toFile(dir + "/Pois roses.png");
  await sharp(Buffer.from(stars)).png().toFile(dir + "/Etoiles dorees.png");
})();
`,
    FIX,
  ],
  { stdio: "inherit" },
);

/* ---- Mise en place : six Textes sur « À propos » (formes de données d'AVANT le lot 66) ------------------------------------------ */

const WORDS = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"];
const LEGACY = {
  Bravo: { surface: { color: "primary12", width: "inset", corners: "m" } },
  Charlie: { background: { kind: "color", color: "bgDeep" } },
  Echo: { surface: { color: "surface", width: "inset" }, background: { kind: "color", color: "bgDeep" } },
};
function seedPage(wallpaperIds) {
  exec("delete from blocks where page_id = ?", PAGE_ID);
  exec("update pages set draft = NULL, draft_rev = 0, theme_overrides = NULL where id = ?", PAGE_ID);
  WORDS.forEach((w, i) => {
    const p = { paragraphs: [{ fr: `${w} : un texte assez long pour que le fond ait du contenu à entourer, sur une ligne ou deux.`, en: `${w}: some text.` }], ...(LEGACY[w] ?? {}) };
    if (w === "Foxtrot") p.surface = { color: "surface", width: "inset", paperWallpaper: wallpaperIds[1] };
    exec("insert into blocks (page_id, position, type, props) values (?, ?, 'rich-text', ?)", PAGE_ID, i, JSON.stringify(p));
  });
}

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
const quitPreview = () => page.request.post(`${BASE}/admin/apercu/quitter`, { headers: { origin: BASE } }).catch(() => {});
async function openEditor() {
  await quitPreview();
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
  return waitFor(async () => /En ligne/.test((await page.locator(".ve-status").textContent()) ?? ""), 120000);
}
async function section(name, fn) {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 8).join(" "));
    await page.screenshot({ path: path.join(SHOTS, `erreur-${name}.png`) }).catch(() => {});
  }
}
const undo = () => page.locator('button.a-icon-btn[aria-label="Défaire"]');

/** Ce qu'on voit sur une rubrique (par un mot de son paragraphe) : enveloppes, papiers dessinés dans la zone, papier de la page. */
const MEASURE = (w) => {
  const p = [...document.querySelectorAll("p")].find((e) => e.textContent.includes(w));
  if (!p) return null;
  const fond = p.closest('.fond-bloc[data-fond="on"]');
  const card = p.closest('.surface-card[data-surface="on"]');
  const img = (el, pseudo) => {
    if (!el) return "none";
    const s = getComputedStyle(el, pseudo);
    return s.content === "none" || s.content === "normal" ? "none" : s.backgroundImage;
  };
  const visibleImg = (v) => (v && v !== "none" ? v : null);
  const fondPapers = [visibleImg(img(fond, "::before")), visibleImg(img(fond, "::after"))].filter(Boolean);
  const cardPapers = [visibleImg(img(card, "::before"))].filter(Boolean);
  const box = (e) => {
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return { l: b.left, r: b.right, t: b.top + window.scrollY, b: b.bottom + window.scrollY, h: b.height };
  };
  const pw = document.querySelector(".page-wallpaper");
  return {
    fond: !!fond,
    card: !!card,
    fondBox: box(fond),
    cardBox: box(card),
    fondPapers,
    cardPapers,
    fondOpacity: fond ? getComputedStyle(fond, "::after").opacity : null,
    fondBg: fond ? getComputedStyle(fond).backgroundColor : null,
    pagePaper: pw ? getComputedStyle(pw).backgroundImage : null,
    vw: window.innerWidth,
  };
};

/* ---- Mise en place du site ------------------------------------------------------------------------------------------------------ */

installPaperTheme(DATA);
await activateThemeUi(page, BASE, PAPER_THEME_NAME);
await page.goto(`${BASE}/admin/papiers-peints`, { waitUntil: "networkidle" });
await page.locator('[data-testid="wallpaper-input"]').setInputFiles([path.join(FIX, "Pois roses.png"), path.join(FIX, "Etoiles dorees.png")]);
await waitFor(() => q("select id from wallpapers").length >= 2, 90000);
await sleep(1500);
const IDS = q("select id from wallpapers order by id").map((r) => r.id);
const [POIS, STARS] = IDS;
seedPage(IDS);
// Papier peint des cartes du SITE : Pois roses (le premier motif), posé sur les cartes ET les fonds de couleur.
await page.reload({ waitUntil: "networkidle" });
await page.locator('[data-testid="wallpaper-cards"] [data-testid="wallpaper-cards-on"]').click();
await waitFor(() => q("select value from settings where key = 'cardWallpaper'").length === 1);

let f = null;
// Papier peint de la PAGE : Étoiles dorées.
async function setPageWallpaper() {
  f = await openEditor();
  await page.getByRole("tab", { name: "Réglages" }).click();
  const field = page.locator('[data-testid="page-wallpaper"]');
  await field.waitFor({ timeout: 20000 });
  await field.locator('[data-mode="wallpaper"]').click();
  await sleep(600);
  await field.locator(`[data-wallpaper-id="${STARS}"]`).click();
  await waitFor(async () => JSON.parse(q("select draft from pages where id = ?", PAGE_ID)[0]?.draft || "{}")?.wallpaper?.wallpaper === STARS);
  // Publié : chaque section rouvre l'éditeur en abandonnant son brouillon, le papier de la page doit être celui de la page publiée.
  ok("mise en place : papier peint de la page publié", await publish());
  f = await openEditor();
}
await section("mise en place", setPageWallpaper);

async function openFond(word) {
  const host = f.locator('[data-edit-block][data-edit-type="rich-text"]', { hasText: word }).first();
  await host.locator("section").first().evaluate((e) => e.scrollIntoView({ block: "center" }));
  await sleep(300);
  await host.locator("section").first().click({ position: { x: 40, y: 30 }, force: true });
  await f.locator('.pe-tools [data-testid="fond-button"]').click();
  const menu = f.locator('[data-testid="fond-menu"]');
  await menu.waitFor({ timeout: 20000 });
  return menu;
}
const measure = (word) => f.evaluate(MEASURE, word);
const sec = (menu, slot) => menu.locator(`[data-testid="fond-section-${slot}"]`);
const kinds = (menu, slot = "fond") => sec(menu, slot).locator("[data-kind]").evaluateAll((els) => els.map((e) => e.getAttribute("data-kind")));
const checkedKind = (menu, slot = "carte") => sec(menu, slot).locator("[data-kind][aria-checked=true]").getAttribute("data-kind");
const bgOf = (word) => props(word).background;

/* ---- R7. Un seul bouton, un menu court ------------------------------------------------------------------------------------------- */

await section("R7", async () => {
  const host = f.locator('[data-edit-block][data-edit-type="rich-text"]', { hasText: "Delta" }).first();
  await host.scrollIntoViewIfNeeded();
  await host.locator("section").first().click({ position: { x: 40, y: 30 } });
  const labels = await f.locator(".pe-tools button").evaluateAll((els) => els.map((e) => e.textContent.trim()));
  ok("R7 un seul bouton « Fond & carte » dans la barre de la rubrique (lot 100)", labels.includes("Fond & carte") && !labels.some((l) => /^Carte/.test(l)), JSON.stringify(labels));
  await f.locator('.pe-tools [data-testid="fond-button"]').click();
  const menu = f.locator('[data-testid="fond-menu"]');
  await menu.waitFor();
  ok("R7 chaque section (Fond, Carte) propose Aucun / Couleur / Papier peint, toutes deux toujours affichées", (await kinds(menu, "fond")).join() === "none,color,wallpaper" && (await kinds(menu, "carte")).join() === "none,color,wallpaper" && (await sec(menu, "fond").isVisible()) && (await sec(menu, "carte").isVisible()));
  ok("R7 rien n'est écrit par l'ouverture du menu (le bloc est intact)", draftBlock("Delta") === undefined || JSON.stringify(props("Delta")) === JSON.stringify(JSON.parse(q("select props from blocks where page_id = ? and position = 3", PAGE_ID)[0].props)));
  const h0 = await menu.evaluate((e) => e.getBoundingClientRect().height);
  await sec(menu, "fond").locator('[data-kind="color"]').click();
  await waitFor(() => bgOf("Delta")?.kind === "color");
  await sleep(500);
  const h1 = await menu.evaluate((e) => e.getBoundingClientRect().height);
  ok("R7 menu COURT : tient dans la fenêtre (hauteur ≤ 640 px avec les deux sections)", h1 <= 640, String(h1));
  ok("R7 les réglages fins (coins, marge, bordure, papier du site) sont dans la section Carte, repliée", (await menu.locator('[data-testid="fond-fine"]').count()) === 0 || (await menu.locator('[data-testid="fond-fine"]').evaluate((d) => !d.open)), h0 + "/" + h1);
  await page.screenshot({ path: path.join(SHOTS, "r7-menu-court.png") });
  await menu.locator('[data-testid="fond-section-fond"] [data-kind="none"]').click();
  await waitFor(() => bgOf("Delta") === undefined);
  await page.keyboard.press("Escape");
});

/* ---- R5. Impossible d'enlever un papier peint --------------------------------------------------------------------------------------- */

await section("R5", async () => {
  f = await openEditor();
  let m = await measure("Delta");
  ok("R5 départ : Delta sans fond, le papier peint de la PAGE (étoiles) est dessous", !m.fond && m.pagePaper?.includes("/media/img/"), JSON.stringify(m));
  let menu = await openFond("Delta");
  ok("R5 « Aucun » : le menu DIT que le papier peint vient de la page, avec un lien pour le régler", (await menu.locator('[data-testid="fond-page-paper"]').first().textContent())?.includes("Papier peint de la page") && (await menu.locator('[data-testid="fond-page-paper-link"]').count()) === 1);
  await page.screenshot({ path: path.join(SHOTS, "r5-1-aucun-papier-de-la-page.png") });

  // 1. « Couleur » : plus aucun papier dans la zone (ni celui du site, ni un autre).
  await menu.locator('[data-testid="fond-section-fond"] [data-kind="color"]').click();
  ok("R5 « Couleur » : enregistré avec le papier du site caché", await waitFor(() => bgOf("Delta")?.kind === "color" && bgOf("Delta")?.paper === "under"), JSON.stringify(bgOf("Delta")));
  await sleep(700);
  m = await measure("Delta");
  ok("R5 … et la zone ne montre AUCUN papier peint (le pois du site n'est plus redessiné sur la couleur)", m.fond && m.fondPapers.length === 0 && m.fondBg !== "rgba(0, 0, 0, 0)", JSON.stringify(m));
  await page.screenshot({ path: path.join(SHOTS, "r5-2-couleur-sans-papier.png") });

  // 2. « Papier peint » sans motif choisi avant : on choisit PAS à la place de l'artiste.
  await menu.locator('[data-testid="fond-section-fond"] [data-kind="wallpaper"]').click();
  await sleep(600);
  ok("R5 « Papier peint » sans motif choisi avant : aucun motif n'est posé à sa place (le fond reste une couleur)", bgOf("Delta")?.kind === "color" && (await menu.locator('[data-testid="wp-grid"] [aria-checked=true]').count()) === 0, JSON.stringify(bgOf("Delta")));
  await menu.locator(`[data-wallpaper-id="${STARS}"]`).click();
  ok("R5 le motif cliqué est posé (ici le DEUXIÈME de la bibliothèque), la couleur reste dessous", await waitFor(() => bgOf("Delta")?.kind === "wallpaper" && bgOf("Delta")?.wallpaper === STARS && bgOf("Delta")?.color === "surface"), JSON.stringify(bgOf("Delta")));
  await menu.locator('[data-testid="wp-opacity"]').fill("40");
  await menu.locator('[data-testid="wp-size"]').fill("90");
  await waitFor(() => Math.abs((bgOf("Delta")?.opacity ?? 0) - 0.4) < 0.001 && bgOf("Delta")?.size === 90);
  await sleep(600);
  await page.screenshot({ path: path.join(SHOTS, "r5-3-papier-choisi.png") });

  // 3. Couleur puis retour : le MÊME motif, avec sa taille et son opacité.
  await menu.locator('[data-testid="fond-section-fond"] [data-kind="color"]').click();
  await waitFor(() => bgOf("Delta")?.kind === "color");
  await sleep(500);
  m = await measure("Delta");
  ok("R5 retour sur « Couleur » : plus aucun papier dans la zone", m.fondPapers.length === 0, JSON.stringify(m.fondPapers));
  await menu.locator('[data-testid="fond-section-fond"] [data-kind="wallpaper"]').click();
  ok("R5 retour sur « Papier peint » : le MÊME motif (pas le premier de la bibliothèque), avec sa taille et son opacité", await waitFor(() => bgOf("Delta")?.kind === "wallpaper" && bgOf("Delta")?.wallpaper === STARS && bgOf("Delta")?.size === 90 && Math.abs((bgOf("Delta")?.opacity ?? 0) - 0.4) < 0.001), JSON.stringify(bgOf("Delta")));
  // 4. Fermer et rouvrir le menu : la mémoire tient (même session).
  await page.keyboard.press("Escape");
  menu = await openFond("Delta");
  await menu.locator('[data-testid="fond-section-fond"] [data-kind="color"]').click();
  await waitFor(() => bgOf("Delta")?.kind === "color");
  await menu.locator('[data-testid="fond-section-fond"] [data-kind="wallpaper"]').click();
  ok("R5 … même après fermeture du menu", await waitFor(() => bgOf("Delta")?.wallpaper === STARS), JSON.stringify(bgOf("Delta")));
  // 5. « Aucun » : tout part, y compris dans le brouillon.
  await menu.locator('[data-testid="fond-section-fond"] [data-kind="none"]').click();
  ok("R5 « Aucun » : la zone est retirée du brouillon (ni fond ni carte)", await waitFor(() => bgOf("Delta") === undefined && props("Delta").surface === undefined), JSON.stringify(props("Delta")));
  await sleep(600);
  m = await measure("Delta");
  ok("R5 … et le bloc n'a plus aucun papier à lui (seul celui de la page se voit)", !m.fond && !m.card && m.pagePaper?.includes("/media/img/"), JSON.stringify(m));
  await page.keyboard.press("Escape");
  await undo().click();
  ok("R5 Défaire : la zone revient d'un seul pas", await waitFor(() => bgOf("Delta")?.wallpaper === STARS), JSON.stringify(bgOf("Delta")));
});

/* ---- R5 (suite). Le lien « Papier peint de la page » et les anciens fonds qui montrent le papier du site ------------------------------ */

await section("R5b", async () => {
  f = await openEditor();
  let menu = await openFond("Delta");
  await menu.locator('[data-testid="fond-section-fond"] [data-kind="none"]').click();
  await waitFor(() => bgOf("Delta") === undefined);
  await menu.locator('[data-testid="fond-page-paper-link"]').click();
  const field = page.locator('[data-testid="page-wallpaper"]');
  ok("R5 le lien « Papier peint de la page » ouvre les Réglages de la page, sur le papier peint", await field.waitFor({ timeout: 15000 }).then(() => true, () => false));
  ok("R5 … aucun bloc n'est choisi (ce sont bien les réglages de la PAGE)", (await page.locator(".ve-panel [data-testid=\"page-wallpaper\"]").count()) === 1 || (await field.count()) === 1);
  await page.screenshot({ path: path.join(SHOTS, "r5-4-lien-papier-de-la-page.png") });

  // Ancien fond de couleur (Charlie) : montre le papier du site (le pois), le menu le dit et propose de le cacher.
  f = await openEditor();
  let m = await measure("Charlie");
  ok("R5 ancien fond de couleur (Charlie) : le papier du site est dessiné dessus (comme avant, rien n'a changé)", m.fond && m.fondPapers.length === 1, JSON.stringify(m));
  menu = await openFond("Charlie");
  ok("R5 … le menu le dit : « Le papier du site se voit sur ce fond »", (await menu.locator('[data-testid="fond-site-paper"]').count()) === 1);
  ok("R5 … ouvrir le menu n'a rien écrit : l'ancien fond est intact", draftBlock("Charlie") === undefined || JSON.stringify(bgOf("Charlie")) === JSON.stringify(LEGACY.Charlie.background));
  await menu.locator('[data-testid="fond-site-paper-hide"]').click();
  ok("R5 « Le cacher » : `paper: under` ajouté, la couleur ne bouge pas", await waitFor(() => bgOf("Charlie")?.paper === "under" && bgOf("Charlie")?.color === "bgDeep" && bgOf("Charlie")?.kind === "color"), JSON.stringify(bgOf("Charlie")));
  await sleep(700);
  m = await measure("Charlie");
  ok("R5 … et le papier du site a disparu de la zone", m.fondPapers.length === 0, JSON.stringify(m.fondPapers));
  await page.keyboard.press("Escape");
  await page.screenshot({ path: path.join(SHOTS, "r5-5-ancien-fond-sans-papier.png") });
  ok("R5 publication (le public est vérifié en P)", await publish());
});

/* ---- R6. Opacité à 0 ------------------------------------------------------------------------------------------------------------------ */

await section("R6", async () => {
  f = await openEditor();
  const menu = await openFond("Delta");
  await menu.locator('[data-testid="fond-section-fond"] [data-kind="wallpaper"]').click();
  await menu.locator(`[data-wallpaper-id="${POIS}"]`).click();
  await waitFor(() => bgOf("Delta")?.wallpaper === POIS);
  const min = await menu.locator('[data-testid="wp-opacity"]').getAttribute("min");
  ok("R6 le curseur d'opacité du papier peint commence à 0 (il s'arrêtait à 5)", min === "0", String(min));
  await menu.locator('[data-testid="wp-opacity"]').fill("0");
  ok("R6 opacité 0 enregistrée dans le brouillon", await waitFor(() => bgOf("Delta")?.opacity === 0), JSON.stringify(bgOf("Delta")));
  await sleep(600);
  const m = await measure("Delta");
  ok("R6 … et le motif est invisible (opacité calculée 0)", m.fondOpacity === "0", String(m.fondOpacity));
  await page.screenshot({ path: path.join(SHOTS, "r6-opacite-0.png") });
  // Sur une carte (Foxtrot, ancienne carte à motif) : même curseur, de 0 à 100 % (lot 90 : plus de plafond à 60 %).
  await page.keyboard.press("Escape");
  const mf = await openFond("Foxtrot");
  await mf.locator('[data-testid="fond-section-carte"] [data-kind="wallpaper"][aria-checked="true"]').waitFor();
  ok("R6 carte à motif : le curseur va aussi de 0 à 100 % (lot 90)", (await mf.locator('[data-testid="wp-opacity"]').getAttribute("min")) === "0" && (await mf.locator('[data-testid="wp-opacity"]').getAttribute("max")) === "100");
  await mf.locator('[data-testid="wp-opacity"]').fill("0");
  ok("R6 … opacité 0 sur la carte enregistrée", await waitFor(() => props("Foxtrot").surface?.paperOpacity === 0), JSON.stringify(props("Foxtrot").surface));
  await page.keyboard.press("Escape");
});

/* ---- E. Fond & carte (lot 100) : deux sections, anciennes cartes, carte + fond emboîtés ------------------------------------------------ */

await section("E", async () => {
  f = await openEditor();
  // Delta : Fond (couleur) → + Carte → Carte retirée.
  let menu = await openFond("Delta");
  await sec(menu, "fond").locator('[data-kind="color"]').click();
  await waitFor(() => bgOf("Delta")?.kind === "color");
  await sleep(500);
  let m = await measure("Delta");
  ok("E1 Fond : la couleur va d'un bord à l'autre de la page", m.fondBox && Math.abs(m.fondBox.l) < 1.5 && Math.abs(m.fondBox.r - m.vw) < 1.5, JSON.stringify(m.fondBox));
  await sec(menu, "carte").locator('[data-kind="color"]').click();
  ok("E2 + Carte : le Fond passe dehors (`surface` pleine largeur), la Carte dedans (`background` avec marge M)", await waitFor(() => props("Delta").surface?.width === "full" && props("Delta").background?.inset === "m"), JSON.stringify(props("Delta")));
  await sleep(600);
  m = await measure("Delta");
  ok("E2 … la carte est en retrait des bords du fond (le Fond va d'un bord à l'autre)", m.fondBox && m.cardBox && m.fondBox.l > m.cardBox.l + 10 && m.fondBox.r < m.cardBox.r - 10 && Math.abs(m.cardBox.l) < 1.5, JSON.stringify([m.fondBox, m.cardBox]));
  await page.screenshot({ path: path.join(SHOTS, "e-fond-et-carte.png") });
  await sec(menu, "carte").locator('[data-kind="none"]').click();
  ok("E3 Carte retirée : le Fond reste (R9b : régler la carte ne fait jamais perdre le fond autour)", await waitFor(() => props("Delta").surface?.width === "full" && props("Delta").background === undefined), JSON.stringify(props("Delta")));
  await page.keyboard.press("Escape");

  // Bravo : ancienne carte en retrait = section Carte, Fond vide ; le menu la règle sans rien perdre.
  menu = await openFond("Bravo");
  ok("E4 ancienne carte (Bravo) : section Carte en Couleur, section Fond sur Aucun", (await checkedKind(menu, "carte")) === "color" && (await checkedKind(menu, "fond")) === "none");
  ok("E4 … ouvrir le menu n'a rien écrit", draftBlock("Bravo") === undefined || JSON.stringify(props("Bravo").surface) === JSON.stringify(LEGACY.Bravo.surface));
  await sec(menu, "carte").locator('[data-testid="card-da-color"][data-token="ink"]').click();
  ok("E5 changer la couleur d'une ancienne carte : la carte garde ses coins et sa largeur", await waitFor(() => props("Bravo").surface?.color === "ink" && props("Bravo").surface?.corners === "m" && props("Bravo").surface?.width === "inset"), JSON.stringify(props("Bravo").surface));
  await sec(menu, "fond").locator('[data-kind="color"]').click();
  ok("E6 + Fond sur une ancienne carte : le Fond passe dehors, la carte dedans (couleur et coins gardés)", await waitFor(() => props("Bravo").surface?.width === "full" && props("Bravo").background?.inset === "m" && props("Bravo").background?.color === "ink" && props("Bravo").background?.round === "m"), JSON.stringify(props("Bravo")));
  await page.keyboard.press("Escape");

  // Echo : carte ET fond emboîté d'avant : les deux sections sont remplies, chacune réglable.
  menu = await openFond("Echo");
  ok("E7 carte + fond emboîté (Echo) : les sections Fond ET Carte sont en Couleur", (await checkedKind(menu, "fond")) === "color" && (await checkedKind(menu, "carte")) === "color");
  ok("E7 … plus de choix « Régler : La carte / Le fond sur la carte »", (await menu.locator('[data-testid="fond-layer"], [data-testid="fond-inner-add"]').count()) === 0);
  await sec(menu, "fond").locator('[data-testid="card-da-color"][data-token="primary"]').click();
  ok("E8 régler le Fond ne touche pas la Carte (chacune garde sa couche d'avant : rien n'est déplacé)", await waitFor(() => props("Echo").background?.color === "primary" && props("Echo").surface?.color === "surface" && props("Echo").surface?.width === "inset"), JSON.stringify(props("Echo")));
  await sec(menu, "fond").locator('[data-kind="none"]').click();
  ok("E9 Fond « Aucun » : seule la Carte reste", await waitFor(() => props("Echo").background === undefined && props("Echo").surface?.color === "surface"), JSON.stringify(props("Echo")));
  await sec(menu, "carte").locator('[data-kind="none"]').click();
  ok("E9 Carte « Aucune » : plus rien", await waitFor(() => props("Echo").surface === undefined && props("Echo").background === undefined), JSON.stringify(props("Echo")));
  await undo().click();
  ok("E9 Défaire : la Carte revient d'un seul pas", await waitFor(() => props("Echo").surface?.color === "surface"), JSON.stringify(props("Echo")));
  await page.keyboard.press("Escape");

  // Bordure : un réglage de la carte, posé depuis les réglages fins quand le Fond est sur « Aucun ».
  menu = await openFond("Delta");
  await sec(menu, "carte").locator('[data-kind="color"]').click();
  await waitFor(() => props("Delta").background?.inset === "m");
  ok("E10 avec un Fond, la bordure est dite indisponible (elle vit sur la couche extérieure)", (await menu.locator('[data-testid="fond-border-locked"]').count()) === 1);
  await sec(menu, "fond").locator('[data-kind="none"]').click();
  await waitFor(() => props("Delta").surface === undefined);
  await sleep(500);
  await menu.locator('[data-contour="medium"]').click();
  ok("E10 bordure sur une carte sans Fond : la carte garde sa couleur, avec bordure", await waitFor(() => props("Delta").surface?.border !== undefined && props("Delta").surface?.border !== false && props("Delta").background === undefined && typeof props("Delta").surface?.color === "string"), JSON.stringify(props("Delta")));
  await page.keyboard.press("Escape");
  ok("E11 publication", await publish());
});

/* ---- P. Public = éditeur ----------------------------------------------------------------------------------------------------------------- */

await section("P", async () => {
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(PUBLIC, { waitUntil: "networkidle" });
  const pub = await p.evaluate(MEASURE, "Charlie");
  ok("P1 public : l'ancien fond de couleur dont l'artiste a caché le papier du site n'en montre plus", pub.fond && pub.fondPapers.length === 0, JSON.stringify(pub));
  const bravo = await p.evaluate(MEASURE, "Bravo");
  ok("P2 public : l'ancienne carte (Bravo) est une carte, pleine largeur depuis le réglage de l'artiste", bravo.card, JSON.stringify(bravo));
  await p.screenshot({ path: path.join(SHOTS, "p-public.png"), fullPage: true });
  const html = await p.content();
  ok("P3 public : aucune donnée d'édition dans le HTML", !/data-edit-/.test(html));
  await c.close();
});

ok("aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
