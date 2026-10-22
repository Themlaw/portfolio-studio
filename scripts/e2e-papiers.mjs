#!/usr/bin/env node
/**
 * Papiers peints (lot 35), UN chromium. Serveur requis (dev ou start), base NEUVE (seed), une connexion.
 * Page « À propos » remplacée par six Textes (Alpha sans carte ni fond ; Bravo et Charlie sur une carte ; Delta, Echo, Foxtrot sur la page).
 *
 *  A. Bibliothèque (Thèmes → Papiers peints) : entrée de menu, état vide, import de 2 PNG transparents (le fichier n'apparaît pas dans la
 *     médiathèque), refus d'un JPEG, renommer, taille / opacité par défaut, vignettes sur fond clair ET sombre.
 *  B. Papier d'une page (éditeur, Réglages de la page) : « Comme le site » ne change rien ; un motif remplace le papier du kit sur CETTE page
 *     seulement ; « Aucun » ; publication ; public = éditeur.
 *  C. Fond d'un composant : « Papier peint » (motif, couleur dessous facultative, taille, opacité), bord à bord, texte lisible ; deux
 *     voisins de même motif fusionnent et la trame se poursuit ; réglages différents : pas de fusion ; Annuler.
 *  D. Cartes : motif sur UNE carte (menu « Carte ») et motif par défaut des cartes du site ; une carte « sous la carte » le cache.
 *  E. Public = éditeur ; téléphone (motif à 60 %, pas de défilement horizontal).
 *  F. Supprimer un motif utilisé : avertissement avec les endroits, corbeille, rendu propre (plus de motif, texte intact, aucune erreur),
 *     restauration.
 *  P. Parité : sans papier peint, aucun calque ni attribut dans le HTML public.
 * Captures : $SHOTS (défaut screenshots/papiers35).
 * Usage : DATA_DIR=… ADMIN_EMAIL=… ADMIN_PASSWORD=… BASE=http://localhost:3102 node scripts/e2e-papiers.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";

import { installPaperTheme, PAPER_THEME_NAME } from "./lib/paper-theme.mjs";
import { placeBoard } from "./lib/page-board.mjs";
import { activateThemeUi, gotoThemesPage } from "./lib/theme-live.mjs";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const DATA = process.env.DATA_DIR ?? "data";
const DB = path.join(DATA, "portfolio.db");
const SHOTS = process.env.SHOTS ?? "screenshots/papiers35";
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
const draftOf = () => JSON.parse(q("select draft from pages where id = ?", PAGE_ID)[0]?.draft || "null");
const draftBlock = (word) => draftOf()?.blocks?.find((b) => JSON.stringify(b.props).includes(word));
const wallpapers = () => q("select w.id, w.name, w.size, w.opacity, w.deleted_at deletedAt, w.media_id mediaId from wallpapers w order by w.id");
async function waitFor(fn, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(300);
  }
  return false;
}
const near = (a, b, tol = 1.5) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= tol;

/* ---- Fixtures : deux motifs PNG sur fond transparent + un JPEG (processus à part) ---------------------------------------- */

const FIX = mkdtempSync(path.join(tmpdir(), "pf-papiers-"));
const gen = `
const sharp = require("sharp");
const dir = process.argv[1];
const dots = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><g fill="#e07a9a"><circle cx="60" cy="60" r="26"/><circle cx="180" cy="180" r="26"/></g><g fill="#7ab0e0"><circle cx="180" cy="60" r="14"/><circle cx="60" cy="180" r="14"/></g></svg>';
const stars = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><g fill="#e0b84a"><path d="M80 30l14 30 33 4-24 23 6 33-29-16-29 16 6-33-24-23 33-4z"/><path d="M240 110l9 19 21 3-15 15 4 21-19-10-19 10 4-21-15-15 21-3z"/></g></svg>';
(async () => {
  await sharp(Buffer.from(dots)).png().toFile(dir + "/Pois roses.png");
  await sharp(Buffer.from(stars)).png().toFile(dir + "/Etoiles dorees.png");
  await sharp({ create: { width: 120, height: 120, channels: 3, background: "#cccccc" } }).jpeg().toFile(dir + "/photo.jpg");
})();
`;
execFileSync(process.execPath, ["-e", gen, FIX], { stdio: "inherit" });
const POIS = path.join(FIX, "Pois roses.png");
const ETOILES = path.join(FIX, "Etoiles dorees.png");
const JPEG = path.join(FIX, "photo.jpg");
writeFileSync(path.join(FIX, "note.txt"), "x");

/* ---- Mise en place : six Textes sur « À propos » ------------------------------------------------------------------------- */

const WORDS = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"];
function seedPage() {
  exec("delete from blocks where page_id = ?", PAGE_ID);
  exec("update pages set draft = NULL, draft_rev = 0, theme_overrides = NULL where id = ?", PAGE_ID);
  WORDS.forEach((w, i) => {
    const props = { paragraphs: [{ fr: `${w} : un texte assez long pour que le papier peint ait du contenu à entourer, sur une ligne ou deux.`, en: `${w}: some text.` }] };
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
// Lot 61 : la bibliothèque est dans l'éditeur de thème, dont l'aperçu pose le cookie d'aperçu du thème : on le quitte avant de regarder le site.
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
const rgb = (css) => (/rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(css) ?? []).slice(1, 4).map(Number);
const lum = ([r, g, b]) => {
  const f = (v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
async function anonPage(viewport = { width: 1440, height: 900 }, mobile = false) {
  const c = await browser.newContext({ viewport, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  return { c, p };
}

/** Mesures d'un Texte (par un mot de son paragraphe) : enveloppe de fond, motif (pseudo-élément), carte, page. */
const MEASURE = (w) => {
  const p = [...document.querySelectorAll("p")].find((e) => e.textContent.includes(w));
  if (!p) return null;
  const fond = p.closest('.fond-bloc[data-fond="on"]');
  const card = p.closest('.surface-card[data-surface="on"]');
  const box = (e) => {
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return { l: b.left, r: b.right, t: b.top + window.scrollY, b: b.bottom + window.scrollY, h: b.height };
  };
  const after = fond ? getComputedStyle(fond, "::after") : null;
  const before = fond ? getComputedStyle(fond, "::before") : null;
  const cardBefore = card ? getComputedStyle(card, "::before") : null;
  return {
    p: box(p),
    pColor: getComputedStyle(p).color,
    fond: box(fond),
    fondBg: fond ? getComputedStyle(fond).backgroundColor : null,
    fondAttrs: fond ? { wallpaper: fond.hasAttribute("data-wallpaper"), clear: fond.hasAttribute("data-fond-clear"), prev: fond.hasAttribute("data-join-prev"), next: fond.hasAttribute("data-join-next") } : null,
    wp: after ? { img: after.backgroundImage, size: after.backgroundSize, posY: after.backgroundPositionY, opacity: parseFloat(after.opacity), content: after.content } : null,
    fondBefore: before ? { content: before.content, img: before.backgroundImage } : null,
    card: box(card),
    cardAttrs: card ? { paperWp: card.hasAttribute("data-paper-wp"), paper: card.getAttribute("data-paper") } : null,
    cardWp: cardBefore ? { content: cardBefore.content, img: cardBefore.backgroundImage, size: cardBefore.backgroundSize, opacity: parseFloat(cardBefore.opacity) } : null,
    vw: document.documentElement.clientWidth,
    sw: document.documentElement.scrollWidth,
  };
};
const measure = (where, w) => where.evaluate(MEASURE, w);
/** Calque du papier d'une page + papier du kit sur le corps. */
const PAGE_PAPER = () => {
  const layer = document.querySelector(".page-wallpaper");
  const cs = layer ? getComputedStyle(layer) : null;
  const r = layer?.getBoundingClientRect();
  const frame = document.querySelector(".site-frame")?.getBoundingClientRect();
  return {
    layer: Boolean(layer),
    mode: layer?.getAttribute("data-mode") ?? null,
    img: cs?.backgroundImage ?? null,
    size: cs?.backgroundSize ?? null,
    opacity: cs ? parseFloat(cs.opacity) : null,
    covers: r && frame ? Math.abs(r.width - frame.width) < 1.5 && Math.abs(r.height - frame.height) < 1.5 : null,
    bodyImg: getComputedStyle(document.body).backgroundImage,
    kit: document.documentElement.hasAttribute("data-kit-paper"),
  };
};

/** Mesures du papier de la page, relues jusqu'à ce que `pred` soit vrai (la toile se recharge après un réglage de page). */
async function paperWhen(pred, timeout = 60000) {
  let last = null;
  await waitFor(async () => {
    try {
      last = await f.evaluate(PAGE_PAPER);
      return pred(last);
    } catch {
      return false;
    }
  }, timeout);
  return last;
}

/* ---- P. Parité : rien sans réglage ------------------------------------------------------------------------------------------ */

await section("P", async () => {
  const { c, p } = await anonPage();
  await p.goto(PUBLIC, { waitUntil: "networkidle" });
  const html = await p.content();
  ok("P1 sans papier peint : aucun calque, aucune variable, aucun attribut dans le HTML public", !/page-wallpaper/.test(html) && !/data-wallpaper/.test(html) && !/--wp-/.test(html) && !/data-paper-wp/.test(html) && !/data-wp-cards/.test(html) && !/data-fond/.test(html));
  await c.close();
});

/* ---- A. Bibliothèque -------------------------------------------------------------------------------------------------------- */

await section("A", async () => {
  await page.goto(`${BASE}/admin/themes`, { waitUntil: "networkidle" });
  // Lot 61 : « Papiers peints » n'est plus une page du menu mais un onglet de l'étape « Papier et motifs » ; l'ancienne adresse y redirige.
  ok("A0 « Papiers peints » n'est plus dans le menu", (await page.locator('.a-nav a[href="/admin/papiers-peints"]').count()) === 0);
  await page.goto(`${BASE}/admin/papiers-peints`, { waitUntil: "networkidle" });
  ok("A0b l'ancienne adresse redirige vers l'onglet « Mes papiers peints » de l'éditeur de thème", /\/admin\/themes\/[^/?]+\?etape=papier&onglet=papiers-peints$/.test(page.url()) && (await page.locator('[data-testid="paper-tab-wallpapers"]').getAttribute("aria-selected")) === "true", page.url());
  await page.locator('[data-testid="wallpaper-library"]').waitFor();
  ok("A1 bibliothèque vide : une phrase qui dit quoi faire", await page.locator('[data-testid="wallpaper-empty"]').isVisible());
  await page.screenshot({ path: path.join(SHOTS, "a-vide.png") });

  const inMedias = async () => {
    await page.goto(`${BASE}/admin/medias`, { waitUntil: "networkidle" });
    return page.locator("body").innerText();
  };
  await page.goto(`${BASE}/admin/papiers-peints`, { waitUntil: "networkidle" });
  await page.locator('[data-testid="wallpaper-input"]').setInputFiles([POIS, ETOILES]);
  ok("A2 import de 2 PNG transparents : deux motifs prêts", await waitFor(async () => (await page.locator('[data-testid="wallpaper"][data-status="ready"]').count()) === 2, 120000), `${await page.locator('[data-testid="wallpaper"]').count()} carte(s)`);
  const rows = wallpapers();
  ok("A2 deux lignes en base, nom d'après le fichier, taille de départ (moitié de la largeur), opacité pleine", rows.length === 2 && rows[0].name === "Pois roses" && rows[0].size === 120 && rows[0].opacity === 1 && rows[1].name === "Etoiles dorees" && rows[1].size === 160, JSON.stringify(rows));
  ok("A3 aucun des deux fichiers n'apparaît dans la médiathèque", !/Pois roses|Etoiles dorees/.test(await inMedias()));
  await page.goto(`${BASE}/admin/papiers-peints`, { waitUntil: "networkidle" });
  await page.locator('[data-testid="wallpaper-input"]').setInputFiles([JPEG]);
  ok("A4 un JPEG est refusé avec un message clair (PNG ou WebP)", await page.getByText(/doit être un PNG ou un WebP/).first().waitFor({ timeout: 15000 }).then(() => true, () => false));
  ok("A4 … et aucun motif de plus", wallpapers().length === 2);
  await page.locator('[data-testid="wallpaper-input"]').setInputFiles([POIS]);
  ok("A5 le même fichier une seconde fois : « Déjà dans la bibliothèque », aucun doublon", (await page.getByText(/Déjà dans la bibliothèque/).first().waitFor({ timeout: 60000 }).then(() => true, () => false)) && wallpapers().length === 2);

  const card = page.locator(`[data-testid="wallpaper"][data-wallpaper-id="${rows[0].id}"]`);
  const name = card.locator('[data-testid="wallpaper-name"]');
  await name.fill("Pois roses");
  await name.press("Enter");
  await name.fill("Petits pois");
  await name.press("Enter");
  ok("A6 renommer : le nom est enregistré", await waitFor(() => wallpapers()[0].name === "Petits pois"), JSON.stringify(wallpapers()[0]));
  await card.locator('[data-testid="wallpaper-size"]').fill("200");
  await card.locator('[data-testid="wallpaper-opacity"]').fill("80");
  ok("A7 taille et opacité par défaut du motif enregistrées", await waitFor(() => wallpapers()[0].size === 200 && Math.abs(wallpapers()[0].opacity - 0.8) < 0.001), JSON.stringify(wallpapers()[0]));
  const prev = await card.locator(".a-wp-preview .a-wp-half").evaluateAll((els) => els.map((e) => [e.getAttribute("data-tone"), getComputedStyle(e).backgroundColor, getComputedStyle(e.firstElementChild).backgroundImage.startsWith("url(")]));
  ok("A8 vignette sur un fond clair ET sur un fond sombre", prev.length === 2 && prev[0][0] === "light" && prev[1][0] === "dark" && prev[0][1] !== prev[1][1] && prev.every((x) => x[2]), JSON.stringify(prev));
  ok("A9 aucune alerte de transparence pour un PNG transparent", (await page.locator('[data-testid="wallpaper-opaque"]').count()) === 0);
  await page.screenshot({ path: path.join(SHOTS, "a-bibliotheque.png"), fullPage: true });
  ok("A10 « utilisé » : pas encore utilisé", (await card.locator('[data-testid="wallpaper-uses"]').textContent())?.includes("Pas encore"));
});

const IDS = wallpapers().map((w) => w.id);
const [POIS_ID, STAR_ID] = IDS;

/* ---- B. Papier d'une page ----------------------------------------------------------------------------------------------------- */

let f = null;
await section("B", async () => {
  installPaperTheme(DATA);
  await activateTheme(PAPER_THEME_NAME);
  f = await openEditor();
  let pp = await f.evaluate(PAGE_PAPER);
  ok("B0 thème à papier : le papier du kit est sur le corps, aucun calque de page", pp.kit && pp.bodyImg !== "none" && !pp.layer, JSON.stringify(pp));
  await page.getByRole("tab", { name: "Réglages" }).click();
  const field = page.locator('[data-testid="page-wallpaper"]');
  await field.waitFor({ timeout: 20000 });
  ok("B1 « Papier peint de la page » : Comme le site / Aucun / Un papier peint, « Comme le site » par défaut", (await field.locator('[data-mode="site"]').getAttribute("aria-checked")) === "true" && (await field.locator("[role=radio]").count()) === 3);
  await field.locator('[data-mode="wallpaper"]').click();
  ok("B2 « Un papier peint » : le premier motif est posé, enregistré dans le brouillon", await waitFor(() => draftOf()?.wallpaper?.mode === "wallpaper" && draftOf().wallpaper.wallpaper === POIS_ID), JSON.stringify(draftOf()?.wallpaper));
  f = await canvas();
  pp = await paperWhen((x) => x.layer && x.mode === "wallpaper");
  ok("B3 la toile montre le motif sur toute la page, et le papier du kit n'y est plus", pp.layer && pp.mode === "wallpaper" && pp.img.includes("/media/img/") && pp.covers && pp.bodyImg === "none", JSON.stringify(pp));
  ok("B3 taille et opacité du motif (120 px par défaut ici = celles réglées dans la bibliothèque : 200 px, 80 %)", pp.size.startsWith("200px") && Math.abs(pp.opacity - 0.8) < 0.01, JSON.stringify([pp.size, pp.opacity]));
  await field.locator('[data-testid="page-wallpaper-size"]').fill("90");
  ok("B4 taille propre à la page : enregistrée dans le brouillon", await waitFor(() => draftOf()?.wallpaper?.size === 90), JSON.stringify(draftOf()?.wallpaper));
  f = await canvas();
  pp = await paperWhen((x) => x.layer && x.size?.startsWith("90px"));
  ok("B4 … et visible (90 px)", pp.size.startsWith("90px"), pp.size);
  await page.screenshot({ path: path.join(SHOTS, "b-papier-de-page-editeur.png") });
  await field.locator(`[data-wallpaper-id="${STAR_ID}"]`).click();
  ok("B5 autre motif choisi", await waitFor(() => draftOf()?.wallpaper?.wallpaper === STAR_ID));
  f = await canvas();
  await sleep(1000);
  await field.locator('[data-mode="none"]').click();
  ok("B6 « Aucun » : enregistré", await waitFor(() => draftOf()?.wallpaper?.mode === "none"));
  f = await canvas();
  pp = await paperWhen((x) => x.layer && x.mode === "none");
  ok("B6 … la page n'a plus aucun papier (ni motif ni papier du kit)", pp.layer && pp.mode === "none" && pp.img === "none" && pp.bodyImg === "none", JSON.stringify(pp));
  await field.locator('[data-mode="site"]').click();
  ok("B7 « Comme le site » : le réglage disparaît du brouillon", await waitFor(() => !draftOf()?.wallpaper));
  f = await canvas();
  pp = await paperWhen((x) => !x.layer);
  ok("B7 … le papier du kit est revenu, plus de calque : rien n'a changé", !pp.layer && pp.bodyImg !== "none", JSON.stringify(pp));
  // Publication avec un motif.
  await field.locator('[data-mode="wallpaper"]').click();
  await waitFor(() => draftOf()?.wallpaper?.mode === "wallpaper");
  await field.locator(`[data-wallpaper-id="${STAR_ID}"]`).click();
  await waitFor(() => draftOf()?.wallpaper?.wallpaper === STAR_ID);
  ok("B8 publication", await publish());
  ok("B8 le papier de la page est publié (réglage de la page)", JSON.parse(q("select theme_overrides t from pages where id = ?", PAGE_ID)[0].t).wallpaper.wallpaper === STAR_ID);
  const { c, p } = await anonPage();
  await p.goto(PUBLIC, { waitUntil: "networkidle" });
  const pub = await p.evaluate(PAGE_PAPER);
  ok("B9 public : même calque, même motif, même taille (celle du motif : 160 px) que sur la toile", pub.layer && pub.mode === "wallpaper" && pub.img.includes("/media/img/") && pub.covers && pub.bodyImg === "none" && pub.size.startsWith("160px"), JSON.stringify(pub));
  const img = await p.evaluate(async () => {
    const m = /url\("([^"]+)"\)/.exec(getComputedStyle(document.querySelector(".page-wallpaper")).backgroundImage);
    const r = m ? await fetch(m[1]) : null;
    return r ? { status: r.status, type: r.headers.get("content-type"), cache: r.headers.get("cache-control") } : null;
  });
  ok("B9 le fichier du motif est servi (WebP) et mis en cache", img?.status === 200 && /webp/.test(img.type ?? "") && /max-age|immutable/.test(img.cache ?? ""), JSON.stringify(img));
  await p.screenshot({ path: path.join(SHOTS, "b-papier-de-page-public.png"), fullPage: true });
  await p.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  const home = await p.evaluate(PAGE_PAPER);
  ok("B10 une autre page garde le papier du site (réglage de CETTE page seulement)", !home.layer && home.bodyImg !== "none", JSON.stringify(home));
  await c.close();
});

/* ---- C. Fond d'un composant --------------------------------------------------------------------------------------------------- */

async function openFond(word) {
  const host = f.locator('[data-edit-block][data-edit-type="rich-text"]', { hasText: word }).first();
  await host.scrollIntoViewIfNeeded();
  await host.locator("section").first().click({ position: { x: 40, y: 30 } });
  await f.locator('.pe-tools [data-testid="fond-button"]').click();
  const menu = f.locator('[data-testid="fond-menu"]');
  await menu.waitFor({ timeout: 20000 });
  return menu;
}
async function setWallpaper(word, id) {
  const menu = await openFond(word);
  if ((await menu.locator('[data-kind="wallpaper"]').getAttribute("aria-checked")) !== "true") await menu.locator('[data-kind="wallpaper"]').click();
  if (id) await menu.locator(`[data-wallpaper-id="${id}"]`).click();
  return menu;
}
const bgOf = (word) => draftBlock(word)?.props.background;
const undo = () => page.locator('button.a-icon-btn[aria-label="Défaire"]');

await section("C", async () => {
  // Retour au thème sans papier de page : on repart d'une page vierge de réglage de page.
  f = await openEditor();
  await page.getByRole("tab", { name: "Réglages" }).click();
  await page.locator('[data-testid="page-wallpaper"] [data-mode="site"]').click();
  await settled();
  f = await canvas();
  await sleep(1000);

  let menu = await openFond("Delta");
  ok("C1 « Fond » propose Aucun / Couleur / Papier peint", (await menu.locator("[data-kind]").evaluateAll((els) => els.map((e) => e.getAttribute("data-kind")))).join() === "none,color,wallpaper");
  await menu.locator('[data-kind="wallpaper"]').click();
  ok("C2 « Papier peint » pose le premier motif de la bibliothèque", await waitFor(() => bgOf("Delta")?.kind === "wallpaper" && bgOf("Delta")?.wallpaper === POIS_ID), JSON.stringify(bgOf("Delta")));
  await sleep(500);
  let d = await measure(f, "Delta");
  ok("C3 aperçu immédiat : bande pleine largeur avec le motif (image répétée, taille du motif, opacité du motif)", d.fond && near(d.fond.l, 0, 1.5) && near(d.fond.r, d.vw, 1.5) && d.fondAttrs.wallpaper && d.wp.img.includes("/media/img/") && d.wp.size.startsWith("200px") && Math.abs(d.wp.opacity - 0.8) < 0.01, JSON.stringify(d));
  ok("C3 sans couleur dessous : le fond est transparent (le papier du site reste visible dessous) et le texte garde l'encre du thème", d.fondAttrs.clear && d.fondBg === "rgba(0, 0, 0, 0)");
  await page.screenshot({ path: path.join(SHOTS, "c-un-papier-peint.png") });

  // Taille et opacité propres à ce composant.
  await menu.locator('[data-testid="wp-size"]').fill("60");
  ok("C4 taille propre au composant enregistrée", await waitFor(() => bgOf("Delta")?.size === 60), JSON.stringify(bgOf("Delta")));
  await sleep(400);
  d = await measure(f, "Delta");
  ok("C4 … visible (60 px)", d.wp.size.startsWith("60px"), d.wp.size);
  await menu.locator('[data-testid="wp-opacity"]').fill("50");
  ok("C5 opacité propre enregistrée", await waitFor(() => Math.abs((bgOf("Delta")?.opacity ?? 0) - 0.5) < 0.001), JSON.stringify(bgOf("Delta")));
  await menu.locator('[data-testid="wp-reset"]').click();
  ok("C6 « Reprendre les réglages du motif » retire taille et opacité", await waitFor(() => bgOf("Delta") && bgOf("Delta").size === undefined && bgOf("Delta").opacity === undefined), JSON.stringify(bgOf("Delta")));

  // Couleur dessous.
  await menu.locator('[data-testid="card-da-color"][data-token="ink"]').click();
  ok("C7 couleur sous le motif : jeton enregistré, le motif reste", await waitFor(() => bgOf("Delta")?.color === "ink" && bgOf("Delta")?.wallpaper === POIS_ID), JSON.stringify(bgOf("Delta")));
  await sleep(400);
  d = await measure(f, "Delta");
  ok("C7 la couleur est sous le motif et le texte reste lisible dessus (≥ 4,5:1)", !d.fondAttrs.clear && d.fondBg !== "rgba(0, 0, 0, 0)" && ratio(rgb(d.pColor), rgb(d.fondBg)) >= 4.5, JSON.stringify([d.pColor, d.fondBg]));
  await page.screenshot({ path: path.join(SHOTS, "c-papier-peint-et-couleur.png") });
  await menu.locator('[data-testid="card-color-auto"]').click();
  ok("C8 « Aucune couleur » retire la couleur, garde le motif", await waitFor(() => bgOf("Delta")?.color === undefined && bgOf("Delta")?.wallpaper === POIS_ID), JSON.stringify(bgOf("Delta")));
  await page.keyboard.press("Escape");

  // Deux voisins de même motif : fusion et trame continue.
  await setWallpaper("Echo", POIS_ID);
  await page.keyboard.press("Escape");
  await waitFor(() => bgOf("Echo")?.wallpaper === POIS_ID);
  await sleep(1200);
  d = await measure(f, "Delta");
  let e = await measure(f, "Echo");
  ok("C9 deux voisins de même motif et mêmes réglages : fusionnés (aucun écart, attributs de jonction)", near(e.fond.t, d.fond.b, 1.5) && d.fondAttrs.next && e.fondAttrs.prev, JSON.stringify([d.fond, e.fond, d.fondAttrs, e.fondAttrs]));
  // Trame : la position verticale du second = -(hauteur du premier) modulo la hauteur d'une tuile (200 px de large, carré).
  const tile = 200;
  const gapJoined = e.p.t - d.p.b;
  const expected = -(d.fond.h % tile);
  const posY = parseFloat(e.wp.posY);
  ok("C10 la trame se poursuit d'un composant au suivant (décalage = -(hauteur du premier mod tuile))", Math.abs(posY - expected) < 1.5 || Math.abs(posY - (expected + tile)) < 1.5, JSON.stringify([posY, expected, d.fond.h]));
  await page.screenshot({ path: path.join(SHOTS, "c-deux-voisins-fusionnes.png") });

  // Autre taille : plus de fusion.
  menu = await openFond("Echo");
  await menu.locator('[data-testid="wp-size"]').fill("100");
  await waitFor(() => bgOf("Echo")?.size === 100);
  await page.keyboard.press("Escape");
  await sleep(600);
  d = await measure(f, "Delta");
  e = await measure(f, "Echo");
  ok("C11 réglages différents : pas de fusion, l'espace entre les deux textes est celui de deux bandes distinctes (plus grand)", !d.fondAttrs.next && !e.fondAttrs.prev && e.p.t - d.p.b > gapJoined + 4, JSON.stringify([d.fondAttrs, e.fondAttrs, e.p.t - d.p.b, gapJoined]));
  await undo().click();
  ok("C12 Défaire : Echo reprend ses réglages d'avant, les deux fusionnent de nouveau", await waitFor(async () => bgOf("Echo")?.size === undefined && (await measure(f, "Echo")).fondAttrs.prev));

  // Foxtrot : couleur simple voisine d'un papier peint = pas de fusion.
  menu = await openFond("Foxtrot");
  await menu.locator('[data-kind="color"]').click();
  await waitFor(() => bgOf("Foxtrot")?.kind === "color");
  await page.keyboard.press("Escape");
  await sleep(500);
  e = await measure(f, "Echo");
  ok("C13 une couleur voisine d'un papier peint ne fusionne pas avec lui", !e.fondAttrs.next);
  menu = await openFond("Foxtrot");
  await menu.locator('[data-kind="none"]').click();
  await waitFor(() => bgOf("Foxtrot") === undefined);
  await page.keyboard.press("Escape");
  ok("C14 publication", await publish());
});

/* ---- D. Cartes ------------------------------------------------------------------------------------------------------------------ */

async function openCard(word) {
  const host = f.locator('[data-edit-block][data-edit-type="rich-text"]', { hasText: word }).first();
  await host.scrollIntoViewIfNeeded();
  await host.locator("section").first().click({ position: { x: 40, y: 30 } });
  await f.locator(".pe-tools .sm-button:not([data-testid])").click();
  const menu = f.locator(".sm").first();
  await menu.waitFor({ timeout: 20000 });
  return menu;
}
await section("D", async () => {
  f = await openEditor();
  let menu = await openCard("Bravo");
  ok("D1 le menu « Carte » propose les motifs de la bibliothèque", (await menu.locator(`.wp-item[data-wallpaper-id]`).count()) === 2);
  await menu.locator(`.wp-item[data-wallpaper-id="${STAR_ID}"]`).click();
  ok("D2 motif sur la carte : enregistré (`paperWallpaper`)", await waitFor(() => draftBlock("Bravo")?.props.surface?.paperWallpaper === STAR_ID), JSON.stringify(draftBlock("Bravo")?.props.surface));
  await page.keyboard.press("Escape");
  await sleep(600);
  let b = await measure(f, "Bravo");
  ok("D3 aperçu : le motif est dessiné SUR la carte, sous le contenu (le thème a un papier de kit : c'est le motif qui est montré)", b.cardAttrs.paperWp && b.cardAttrs.paper === "over" && b.cardWp.content !== "none" && b.cardWp.img.includes("/media/img/") && b.cardWp.size.startsWith("160px"), JSON.stringify(b.cardWp));
  await page.screenshot({ path: path.join(SHOTS, "d-motif-sur-une-carte.png") });
  menu = await openCard("Bravo");
  await menu.locator('[data-testid="wp-opacity"]').fill("30");
  await waitFor(() => Math.abs((draftBlock("Bravo")?.props.surface?.paperOpacity ?? 0) - 0.3) < 0.001);
  await menu.locator('[data-testid="wp-size"]').fill("80");
  ok("D4 taille et intensité propres à la carte (plafond 60 %)", await waitFor(() => draftBlock("Bravo")?.props.surface?.paperSize === 80), JSON.stringify(draftBlock("Bravo")?.props.surface));
  await page.keyboard.press("Escape");
  await sleep(500);
  b = await measure(f, "Bravo");
  ok("D4 … visibles (80 px, 30 %)", b.cardWp.size.startsWith("80px") && Math.abs(b.cardWp.opacity - 0.3) < 0.01, JSON.stringify(b.cardWp));
  const c = await measure(f, "Charlie");
  ok("D5 l'autre carte n'est pas touchée", !c.cardAttrs.paperWp);
  ok("D6 publication", await publish());
});

await section("Dsite", async () => {
  // Papier peint par défaut des cartes du site : réglé dans la bibliothèque.
  await page.goto(`${BASE}/admin/papiers-peints`, { waitUntil: "networkidle" });
  const panel = page.locator('[data-testid="wallpaper-cards"]');
  await panel.locator('[data-testid="wallpaper-cards-on"]').click();
  ok("D7 papier des cartes du site : le premier motif est posé", await waitFor(() => q("select value from settings where key = 'cardWallpaper'")[0] && JSON.parse(q("select value from settings where key = 'cardWallpaper'")[0].value).wallpaper === POIS_ID));
  await panel.locator(`[data-wallpaper-id="${STAR_ID}"]`).click();
  await panel.locator('[data-testid="wallpaper-cards-opacity"]').fill("40");
  ok("D8 motif et opacité du site enregistrés", await waitFor(() => { const v = JSON.parse(q("select value from settings where key = 'cardWallpaper'")[0]?.value ?? "{}"); return v.wallpaper === STAR_ID && Math.abs((v.opacity ?? 0) - 0.4) < 0.001; }));
  await page.screenshot({ path: path.join(SHOTS, "d-cartes-du-site-admin.png"), fullPage: true });
  const { c, p } = await anonPage();
  await p.goto(PUBLIC, { waitUntil: "networkidle" });
  const ch = await measure(p, "Charlie");
  const br = await measure(p, "Bravo");
  ok("D9 public : une carte sans réglage montre le motif du site (160 px, 40 %)", ch.cardWp.content !== "none" && ch.cardWp.img.includes("/media/img/") && ch.cardWp.size.startsWith("160px") && Math.abs(ch.cardWp.opacity - 0.4) < 0.01, JSON.stringify(ch.cardWp));
  ok("D10 public : la carte qui a son propre motif garde le sien (80 px, 30 %)", br.cardWp.size.startsWith("80px") && Math.abs(br.cardWp.opacity - 0.3) < 0.01, JSON.stringify(br.cardWp));
  await p.screenshot({ path: path.join(SHOTS, "d-public-cartes.png"), fullPage: true });
  await c.close();
  // Papier de la page : on le repose (la section C l'a retiré) pour que la page publiée montre les trois endroits.
  f = await openEditor();
  await page.getByRole("tab", { name: "Réglages" }).click();
  const field = page.locator('[data-testid="page-wallpaper"]');
  await field.waitFor({ timeout: 20000 });
  await field.locator('[data-mode="wallpaper"]').click();
  await waitFor(() => draftOf()?.wallpaper?.mode === "wallpaper");
  await field.locator(`[data-wallpaper-id="${STAR_ID}"]`).click();
  await waitFor(() => draftOf()?.wallpaper?.wallpaper === STAR_ID);
  f = await canvas();
  await paperWhen((x) => x.layer && x.mode === "wallpaper");
  // Une carte « sous la carte » cache le motif du site.
  const menu = await openCard("Charlie");
  await menu.locator('[data-testid="surface-paper"] [data-paper="under"]').click();
  await waitFor(() => draftBlock("Charlie")?.props.surface?.paper === "under");
  await page.keyboard.press("Escape");
  await sleep(500);
  const cu = await measure(f, "Charlie");
  ok("D11 carte « Sous la carte » : le motif du site n'est pas dessiné", cu.cardWp.content === "none" || cu.cardWp.img === "none", JSON.stringify(cu.cardWp));
  ok("D11 publication", await publish());
});

/* ---- E. Public = éditeur, téléphone --------------------------------------------------------------------------------------------- */

await section("E", async () => {
  const { c, p } = await anonPage();
  await p.goto(PUBLIC, { waitUntil: "networkidle" });
  const d = await measure(p, "Delta");
  const e = await measure(p, "Echo");
  ok("E1 public : bande pleine largeur avec le motif, deux voisins fusionnés", d.fond && near(d.fond.l, 0, 1.5) && near(d.fond.r, d.vw, 1.5) && d.wp.img.includes("/media/img/") && near(e.fond.t, d.fond.b, 1.5), JSON.stringify([d.fond, d.wp, e.fond]));
  await p.waitForFunction(() => getComputedStyle(document.querySelectorAll(".fond-bloc[data-wallpaper]")[1] ?? document.body, "::after").backgroundPositionY !== "0px", null, { timeout: 15000 }).catch(() => {});
  const e2 = await measure(p, "Echo");
  const expected = -(d.fond.h % 200);
  ok("E2 public : la trame se poursuit entre les deux voisins", Math.abs(parseFloat(e2.wp.posY) - expected) < 1.5 || Math.abs(parseFloat(e2.wp.posY) - (expected + 200)) < 1.5, JSON.stringify([e2.wp.posY, expected]));
  await p.screenshot({ path: path.join(SHOTS, "e-public-bureau.png"), fullPage: true });
  await c.close();
  const phone = await anonPage({ width: 390, height: 800 }, true);
  await phone.p.goto(PUBLIC, { waitUntil: "networkidle" });
  const t = await measure(phone.p, "Delta");
  const tc = await measure(phone.p, "Bravo");
  const pp = await phone.p.evaluate(PAGE_PAPER);
  ok("E3 téléphone : motif de composant réduit à 60 % (200 → 120 px)", t.wp.size.startsWith("120px"), t.wp.size);
  ok("E3 téléphone : motif de page réduit à 60 % (160 → 96 px)", pp.size.startsWith("96px"), pp.size);
  ok("E3 téléphone : motif de carte réduit à 60 % (carte de Bravo : 80 → 48 px)", tc.cardWp.size.startsWith("48px"), tc.cardWp.size);
  ok("E4 téléphone : pas de défilement horizontal, bande pleine largeur", t.sw <= t.vw + 1 && near(t.fond.r - t.fond.l, t.vw, 1.5), JSON.stringify([t.sw, t.vw]));
  await phone.p.screenshot({ path: path.join(SHOTS, "e-public-telephone.png"), fullPage: true });
  await phone.c.close();
});

/* ---- F. Supprimer un motif utilisé -------------------------------------------------------------------------------------------- */

await section("F", async () => {
  await page.goto(`${BASE}/admin/papiers-peints`, { waitUntil: "networkidle" });
  const pois = page.locator(`[data-testid="wallpaper"][data-wallpaper-id="${POIS_ID}"]`);
  ok("F1 le motif posé sur des composants le dit (« Utilisé à N endroits »)", /Utilisé à \d+ endroit/.test((await pois.locator('[data-testid="wallpaper-uses"]').textContent()) ?? ""));
  await pois.locator('[data-testid="wallpaper-delete"]').click();
  const dlg = page.locator("dialog[open]");
  await dlg.waitFor();
  const list = await dlg.locator('[data-testid="wallpaper-delete-uses"]').innerText();
  ok("F2 l'avertissement liste les endroits qui l'utilisent (page et composant)", /À propos/.test(list) && /Texte/.test(list), list);
  await page.screenshot({ path: path.join(SHOTS, "f-avertissement.png") });
  await dlg.getByRole("button", { name: "Mettre à la corbeille" }).click();
  await dlg.waitFor({ state: "detached" });
  ok("F3 le motif est à la corbeille (restaurable), plus dans la bibliothèque", await waitFor(() => wallpapers().find((w) => w.id === POIS_ID)?.deletedAt != null) && (await waitFor(async () => (await page.locator(`[data-testid="wallpaper"][data-wallpaper-id="${POIS_ID}"]`).count()) === 0)));
  ok("F3 « Annuler » est proposé 10 s (toast)", (await page.getByRole("button", { name: "Annuler" }).count()) >= 1);
  ok("F3 la corbeille des papiers peints le montre", await page.locator('[data-testid="wallpaper-trash"]').getByText("Petits pois").first().waitFor({ timeout: 20000 }).then(() => true, () => false));

  // Rendu propre : le motif disparaît, le reste de la page est intact.
  const { c, p } = await anonPage();
  const before = errors.length;
  await p.goto(PUBLIC, { waitUntil: "networkidle" });
  const d = await measure(p, "Delta");
  ok("F4 public : le composant n'a plus de motif (aucune image), son texte est toujours là et lisible", d.wp.img === "none" && ratio(rgb(d.pColor), [255, 255, 255]) > 1 && d.p.h > 10, JSON.stringify(d.wp));
  ok("F4 aucune erreur dans la page", errors.length === before);
  const html = await p.content();
  ok("F4 plus aucune image de ce motif dans le rendu", !/Pois|aaaaaaaa/.test(html) && d.fondAttrs.wallpaper === true);
  await p.screenshot({ path: path.join(SHOTS, "f-public-apres-suppression.png"), fullPage: true });
  await c.close();
  // L'éditeur ne casse pas non plus : le menu dit que le motif n'est plus là.
  f = await openEditor();
  const menu = await openFond("Delta");
  ok("F5 éditeur : « Ce papier peint n'est plus dans la bibliothèque »", await menu.locator('[data-testid="wp-missing"]').isVisible());
  await page.keyboard.press("Escape");

  // Restauration : tout revient.
  await page.goto(`${BASE}/admin/papiers-peints`, { waitUntil: "networkidle" });
  await page.locator('[data-testid="wallpaper-restore"]').first().click();
  ok("F6 restaurer : le motif revient dans la bibliothèque", await waitFor(() => wallpapers().find((w) => w.id === POIS_ID)?.deletedAt == null));
  const again = await anonPage();
  await again.p.goto(PUBLIC, { waitUntil: "networkidle" });
  const d2 = await measure(again.p, "Delta");
  ok("F6 … et chez les composants qui l'utilisaient", d2.wp.img.includes("/media/img/"), JSON.stringify(d2.wp));
  await again.c.close();
});

/* ---- G. Papier peint sur un composant de PLANCHE (lots 31 × 35) : barre du composant, fusion, rendu public ---------------------------- */

await section("G", async () => {
  const project = q("select id, slug from projects order by position limit 1")[0];
  ok("G0 planche posée sur la page", await placeBoard(page, BASE, PAGE_ID, project.slug));
  f = await openEditor();
  const board = f.locator(`[data-edit-board="${project.id}"]`).first();
  await board.scrollIntoViewIfNeeded();
  // Deux composants à papier peint identique : la bande du projet, puis une image (ajoutée par « + Ajouter »).
  await board.locator("[data-edit-bitem-add]").last().click({ force: true });
  await f.locator('.pe-bitem-menu [data-bitem-type="image"]').click();
  await page.getByRole("button", { name: "Choisir une image" }).first().click();
  await page.locator(".a-picker-scroll button").first().click();
  await settled();
  const layout = () => JSON.parse(q("select draft_layout, layout from projects where id = ?", project.id).map((r) => r.draft_layout ?? r.layout)[0] ?? "[]");
  ok("G1 deux composants dans la planche", await waitFor(() => layout().length === 2), JSON.stringify(layout().map((i) => i.type)));
  for (const i of [0, 1]) {
    const fr = board.locator("[data-edit-bitem]").nth(i);
    await fr.scrollIntoViewIfNeeded();
    await fr.hover();
    await fr.locator('[data-edit-bitem-op="fond"]').click();
    const menu = f.locator('[data-testid="fond-menu"]');
    await menu.waitFor({ timeout: 20000 });
    if (i === 0) ok("G2 la fenêtre « Fond » d'un composant de planche propose Aucun / Couleur / Papier peint", (await menu.locator("[data-kind]").evaluateAll((els) => els.map((e) => e.getAttribute("data-kind")))).join() === "none,color,wallpaper");
    await menu.locator('[data-kind="wallpaper"]').click();
    await menu.locator(`[data-wallpaper-id="${POIS_ID}"]`).click();
    ok(`G3 composant ${i + 1} : papier peint enregistré dans la suite du projet`, await waitFor(() => layout()[i]?.props?.background?.kind === "wallpaper" && layout()[i].props.background.wallpaper === POIS_ID), JSON.stringify(layout()[i]?.props));
    await page.keyboard.press("Escape");
    await settled();
  }
  const geo = () =>
    f.evaluate((id) => [...document.querySelectorAll(`[data-edit-board="${id}"] [data-edit-bitem] .fond-bloc[data-wallpaper]`)].map((w) => ({ img: getComputedStyle(w).getPropertyValue("--wp-img"), prev: w.hasAttribute("data-join-prev"), next: w.hasAttribute("data-join-next"), y: w.style.getPropertyValue("--wp-y") })), project.id);
  let g = [];
  ok("G4 toile : deux fonds à papier peint fusionnés (même motif, mêmes réglages)", await waitFor(async () => { g = await geo(); return g.length === 2 && g[0].next && g[1].prev && g[0].img.includes("url("); }), JSON.stringify(g));
  await page.screenshot({ path: path.join(SHOTS, "g-papier-peint-planche.png") });
  ok("G5 publication", await publish());
  await sleep(1500);
  const c = await anonPage();
  await c.p.goto(PUBLIC, { waitUntil: "networkidle" });
  const pub = await c.p.evaluate((slug) => {
    const sect = document.querySelector(`[aria-labelledby="project-${slug}"]`);
    const ws = [...(sect?.querySelectorAll('.fond-bloc[data-wallpaper]') ?? [])];
    return ws.map((w) => ({ img: getComputedStyle(w).getPropertyValue("--wp-img"), prev: w.hasAttribute("data-join-prev"), next: w.hasAttribute("data-join-next"), edit: Boolean(w.closest("[data-edit-bitem]")) }));
  }, project.slug);
  ok("G6 public : deux fonds à papier peint dans la planche, fusionnés, sans repère d'édition", pub.length === 2 && pub[0].next && pub[1].prev && pub.every((x) => x.img.includes("url(") && !x.edit), JSON.stringify(pub));
  await c.p.locator(`[aria-labelledby="project-${project.slug}"]`).screenshot({ path: path.join(SHOTS, "g-public-papier-peint-planche.png") }).catch(() => {});
  await c.c.close();
});

/* ---- I. Grille de planche « Portrait à gauche + 2 à droite » sur un papier peint (lots 31d × 35) ----------------------------------- */

await section("I", async () => {
  const project = q("select id, slug from projects order by position limit 1")[0];
  const items = () => JSON.parse(q("select draft_layout, layout from projects where id = ?", project.id).map((r) => r.draft_layout ?? r.layout)[0] ?? "[]");
  f = await openEditor();
  const board = f.locator(`[data-edit-board="${project.id}"]`).first();
  await board.scrollIntoViewIfNeeded();
  await board.locator("[data-edit-bitem-add]").last().click({ force: true });
  await f.locator('.pe-bitem-menu [data-bitem-type="grid"]').click();
  await page.getByTestId("board-item-panel").waitFor({ timeout: 30000 });
  for (let i = 0; i < 3; i++) {
    // Grille unifiée (31d) : « + Ajouter une image » ouvre le sélecteur de médias, un clic sur une vignette la place.
    await page.getByTestId("board-grid-add-image").click();
    const dlg = page.locator("dialog[open]").last();
    await dlg.waitFor({ timeout: 20000 });
    await dlg.getByRole("button", { name: /\.svg/ }).nth(i).click();
    const use = dlg.getByRole("button", { name: "Utiliser cette image" });
    if (await use.isVisible().catch(() => false)) await use.click();
    await dlg.waitFor({ state: "detached", timeout: 20000 }).catch(() => {});
    await settled();
  }
  const gridItem = () => items().find((i) => i.type === "grid");
  ok("I1 grille de planche : trois images", await waitFor(() => (gridItem()?.props.children?.length ?? 0) === 3), JSON.stringify(gridItem()?.props));
  const frame = board.locator('[data-edit-bitem-type="grid"]');
  const cell = frame.locator(".block-grid-cell").first();
  await cell.scrollIntoViewIfNeeded();
  const b = await cell.boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + Math.min(b.height / 2, 120));
  // Lot 31e : « Réglages » du composant grille ouvre la fenêtre blanche sur la toile (plus de barre de grille ouverte d'elle-même).
  await frame.locator('[data-edit-bitem-op="settings"]').click();
  await f.locator('[data-testid="gridsettings"]').waitFor({ timeout: 20000 });
  await f.locator('.pe-gm-layout[data-layout="portrait-left"]').click();
  ok("I2 agencement « Portrait à gauche + 2 à droite » enregistré", await waitFor(() => gridItem()?.props.layout === "portrait-left"), JSON.stringify(gridItem()?.props.layout));
  await settled();
  await page.mouse.click(5, 5);
  await frame.hover();
  await frame.locator('[data-edit-bitem-op="fond"]').click();
  const menu = f.locator('[data-testid="fond-menu"]');
  await menu.waitFor({ timeout: 20000 });
  await menu.locator('[data-kind="wallpaper"]').click();
  await menu.locator(`[data-wallpaper-id="${POIS_ID}"]`).click();
  ok("I3 la grille de planche reçoit un papier peint", await waitFor(() => gridItem()?.props.background?.kind === "wallpaper"), JSON.stringify(gridItem()?.props.background));
  await menu.locator('[data-testid="card-da-color"]').first().click();
  ok("I4 … et une couleur dessous", await waitFor(() => typeof gridItem()?.props.background?.color === "string"), JSON.stringify(gridItem()?.props.background));
  await page.keyboard.press("Escape");
  await settled();
  await frame.scrollIntoViewIfNeeded();
  await sleep(600);
  await page.screenshot({ path: path.join(SHOTS, "i-portrait-gauche-papier-peint.png") });
});

/* ---- H. Une GRILLE (page et planche) reçoit un papier peint ET une couleur (lots 31d × 32 × 35) --------------------------------------- */

await section("H", async () => {
  const media = q("select id from media where kind = 'image' and status = 'ready' and id not in (select media_id from wallpapers) order by id limit 1")[0]?.id;
  ok("H0 une image prête dans la médiathèque", Boolean(media));
  const kid = (uid) => ({ uid, type: "image", props: { mediaId: media, width: "wide" } });
  exec("insert into blocks (page_id, position, type, props) values (?, 99, 'grid', ?)", PAGE_ID, JSON.stringify({ layout: "2", gap: "normal", align: "stretch", ratio: "1:1", top: "gap", children: [kid("hk1"), kid("hk2")] }));
  exec("update pages set draft = NULL, draft_rev = draft_rev + 1 where id = ?", PAGE_ID);
  f = await openEditor();
  const grid = f.locator('[data-edit-block][data-edit-type="grid"]').first();
  await grid.locator(".block-grid").first().scrollIntoViewIfNeeded();
  await grid.locator(".block-grid").first().click({ position: { x: 2, y: 2 } });
  // Le clic choisit une case (barre de case) : le fil d'Ariane « Grille » remonte à la rubrique, dont la barre porte « Fond ».
  await f.locator(".pe-crumbs .pe-crumb", { hasText: "Grille" }).first().click();
  await f.locator('.pe-tools [data-testid="fond-button"]').waitFor({ timeout: 20000 });
  ok("H1 grille de page : le bouton « Fond » est dans la barre de la rubrique", true);
  await f.locator('.pe-tools [data-testid="fond-button"]').click();
  const menu = f.locator('[data-testid="fond-menu"]');
  await menu.waitFor({ timeout: 20000 });
  await menu.locator('[data-kind="wallpaper"]').click();
  await menu.locator(`[data-wallpaper-id="${POIS_ID}"]`).click();
  const gridBg = () => draftOf()?.blocks?.find((b) => b.type === "grid")?.props.background;
  ok("H2 grille de page : papier peint enregistré", await waitFor(() => gridBg()?.kind === "wallpaper" && gridBg().wallpaper === POIS_ID), JSON.stringify(gridBg()));
  await menu.locator('[data-testid="card-da-color"]').first().click();
  ok("H3 … avec une couleur dessous", await waitFor(() => gridBg()?.kind === "wallpaper" && typeof gridBg().color === "string"), JSON.stringify(gridBg()));
  const wrapped = await waitFor(async () => (await f.locator('[data-edit-type="grid"] .fond-bloc[data-wallpaper]:not([data-fond-clear])').count()) === 1);
  ok("H4 toile : la grille est dans son enveloppe de fond (papier peint sur couleur)", wrapped);
  await page.keyboard.press("Escape");
  await settled();
  await page.screenshot({ path: path.join(SHOTS, "h-grille-page-papier-peint.png") });
  // Remise en état : la grille de passage disparaît, la page redevient celle des autres sections.
  exec("delete from blocks where page_id = ? and type = 'grid'", PAGE_ID);
  exec("update pages set draft = NULL, draft_rev = draft_rev + 1 where id = ?", PAGE_ID);
});

ok("aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
