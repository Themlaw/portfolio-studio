#!/usr/bin/env node
/**
 * Papier du site sur les cartes de rubrique (lot 28), UN chromium. Serveur dev requis, base NEUVE (seed), une connexion.
 * Thème « Papier à dessins » (tuile de ronds et d'étoiles sombres, bien contrastée) posé par scripts/lib/paper-theme.mjs, page « À propos ».
 *
 *  A. Défaut inchangé : une carte sans réglage de papier cache le papier (aucun attribut, pseudo-élément absent, aplat uni).
 *  B. Menu « Carte » : « Papier du site » (comme le site / sous la carte / sur la carte), curseur d'intensité, aperçu immédiat,
 *     brouillon { paper, paperOpacity }, publication ; le motif est visible DANS la carte (pixels hors texte), texte et lien
 *     cliquables (elementFromPoint, vrai clic).
 *  C. Réglage du site (Admin → Thèmes → Papier dessiné) : « Papier visible sur les cartes » + intensité ; « Comme le site » le suit,
 *     « Sous la carte » le surcharge.
 *  D. Thème sans papier : l'option est remplacée par une phrase d'aide, aucun papier dessiné.
 *  P. Parité : 8 presets × accueil et /fr/personnages, aucun attribut de papier de carte dans le HTML public.
 * Captures : $SHOTS (défaut screenshots/papier28).
 * Usage : DATA_DIR=… ADMIN_EMAIL=… ADMIN_PASSWORD=… BASE=http://localhost:3102 node scripts/e2e-papier28.mjs
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";
import sharp from "sharp";

import { installPaperTheme } from "./lib/paper-theme.mjs";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const DATA = process.env.DATA_DIR ?? "data";
const DB = path.join(DATA, "portfolio.db");
const SHOTS = process.env.SHOTS ?? "screenshots/papier28";
mkdirSync(SHOTS, { recursive: true });
const PAGE_ID = 5;
const THEME_ID = "papier-dessins";
const THEME_NAME = "Papier à dessins";

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
const draftBlocks = () => JSON.parse(q("select draft from pages where id = ?", PAGE_ID)[0]?.draft || "null")?.blocks ?? [];
const inkBlocks = () => draftBlocks().filter((b) => b.type === "rich-text");
const publishedSurface = () => q("select type, props from blocks where page_id = ? order by position", PAGE_ID).filter((b) => b.type === "rich-text").map((b) => JSON.parse(b.props).surface);
async function waitFor(fn, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(300);
  }
  return false;
}

/** Tuile 160 × 160 (affichée à 80 px) : ronds et étoiles sombres, nets, très contrastés avec une carte claire ou foncée. */
const TILE = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160"><g fill="#1b2a49"><circle cx="40" cy="40" r="22"/><path d="M120 96 l9 22 24 2 -18 16 6 24 -21 -13 -21 13 6 -24 -18 -16 24 -2z" transform="translate(-6 -22)"/></g></svg>`;

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
  const f = await handle.contentFrame();
  await f.waitForSelector("html[data-edit-mode]", { timeout: 180000 });
  return f;
}
async function settled() {
  await page.waitForFunction(() => !/Enregistrement/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, { timeout: 120000 });
  await sleep(600);
}
// uid de la rubrique d'essai : ceux du brouillon changent à la publication, relus sur la toile à chaque ouverture.
let uid = "";
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
  const uids = await f.locator('[data-edit-block][data-edit-type="rich-text"]:not([data-edit-parent])').evaluateAll((els) => els.map((e) => e.getAttribute("data-edit-block")));
  if (uids.length) uid = uids.at(-1);
  return f;
}
async function publish() {
  await settled();
  await page.getByRole("button", { name: "Publier", exact: true }).click();
  return waitFor(async () => /En ligne/.test((await page.locator(".ve-status").textContent()) ?? ""), 120000);
}
async function activateTheme(id) {
  await page.goto(`${BASE}/admin/themes`, { waitUntil: "networkidle" });
  const card = page.locator(`.a-theme-card[aria-labelledby="theme-${id}"]`);
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

/* ---- Mesures sur la page publique ---------------------------------------------------------------------------------------- */

async function openPublic() {
  const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pub = await anon.newPage();
  pub.on("pageerror", (e) => errors.push(e.message));
  await pub.goto(`${BASE}/fr/a-propos`, { waitUntil: "networkidle" });
  return { pub, close: () => anon.close() };
}
/** Réglages calculés de la carte : attribut, pseudo-élément, empilement. */
const cardState = (pub) =>
  pub.evaluate(() => {
    const el = document.querySelector(".surface-card[data-surface='on']");
    if (!el) return null;
    const before = getComputedStyle(el, "::before");
    const html = document.documentElement;
    return {
      attr: el.getAttribute("data-paper"),
      htmlPaper: html.hasAttribute("data-kit-paper"),
      htmlCards: html.hasAttribute("data-kit-paper-cards"),
      content: before.content,
      opacity: before.opacity,
      image: before.backgroundImage,
      zIndex: before.zIndex,
      pointer: before.pointerEvents,
      isolation: getComputedStyle(el).isolation,
      bg: getComputedStyle(el).backgroundColor,
    };
  });
/**
 * Pixels du motif DANS la carte : capture de la carte, on ne garde que l'intérieur (16 px de marge : coins arrondis) hors des
 * rectangles du contenu (texte, images, liens, boutons, +4 px) et on compte ceux qui ne sont pas la couleur de fond.
 */
async function motifPixels(pub, file) {
  const card = pub.locator(".surface-card[data-surface='on']").first();
  await card.scrollIntoViewIfNeeded();
  await sleep(600);
  const geo = await card.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const boxes = [...el.querySelectorAll("h1,h2,h3,p,a,button,img,li,figure,svg")].map((e) => {
      const b = e.getBoundingClientRect();
      return { x: b.left - r.left - 4, y: b.top - r.top - 4, w: b.width + 8, h: b.height + 8 };
    });
    return { w: r.width, h: r.height, boxes };
  });
  const buf = await card.screenshot({ path: file ? path.join(SHOTS, file) : undefined, animations: "disabled" });
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => {
    const i = (y * info.width + x) * 3;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const bg = px(20, 20);
  let n = 0;
  let total = 0;
  for (let y = 16; y < info.height - 16; y++) {
    for (let x = 16; x < info.width - 16; x++) {
      if (geo.boxes.some((b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)) continue;
      total++;
      const p = px(x, y);
      if (Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) > 6) n++;
    }
  }
  return { motif: n, total };
}

/* ---- Mise en place ----------------------------------------------------------------------------------------------------------- */

installPaperTheme(DATA, { id: THEME_ID, name: THEME_NAME, key: "d0a1c4e8b2f30028", tile: TILE });
await activateTheme(THEME_ID);
let f = await openEditor();
ok("thème « Papier à dessins » en ligne (tuile en fond, papier au site)", await f.evaluate(() => /kit\/.*\.svg/.test(getComputedStyle(document.body).backgroundImage) && document.documentElement.hasAttribute("data-kit-paper")));

// Une rubrique « Titre + texte » en fin de page, avec une carte aux réglages du thème.
await section("A0", async () => {
  const addEnd = f.locator('[data-edit-add="end"]');
  await addEnd.scrollIntoViewIfNeeded();
  await addEnd.click();
  const dlg = page.locator("dialog.ve-add");
  await dlg.waitFor({ timeout: 20000 });
  await dlg.locator(".ve-add-card").nth(2).click();
  ok("A0 rubrique « Titre + texte » ajoutée", await waitFor(() => inkBlocks().length >= 1 && inkBlocks().at(-1).props.title?.fr === "Titre de la rubrique"));
  await f.locator('[data-editing][data-inline="title"]').waitFor({ timeout: 60000 });
  // Le texte d'aide resté tel quel refuse la publication : on saisit un vrai titre et un vrai paragraphe.
  await page.keyboard.type("Mes carnets d'été");
  await page.keyboard.press("Enter");
  ok("A0 titre saisi", await waitFor(() => inkBlocks().at(-1)?.props.title?.fr === "Mes carnets d'été"));
  await f.locator('[data-edit-type="rich-text"] [data-inline="paragraphs.0"]').last().dblclick();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Croquis d'observation au bord de l'eau, pris sur le vif pendant deux semaines de vacances.");
  await page.keyboard.press("Enter");
  ok("A0 paragraphe saisi", await waitFor(() => /Croquis/.test(inkBlocks().at(-1)?.props.paragraphs?.[0]?.fr ?? "")));
  await settled();
});
uid = inkBlocks().at(-1)?.uid ?? "";
const sectionOf = () => f.locator(`[data-edit-block="${uid}"] section`).first();
async function selectBlock() {
  await f.locator(`.pe-focus[data-uid="${uid}"]`).scrollIntoViewIfNeeded();
  await sectionOf().click({ position: { x: 40, y: 30 } });
}
async function openMenu() {
  await selectBlock();
  await f.locator(".pe-tools button[title^=\"Carte de la rubrique\"]").click();
  const menu = f.locator(".sm");
  await menu.waitFor({ timeout: 20000 });
  return menu;
}
const canvasCard = () => f.evaluate((u) => {
  const el = document.querySelector(`[data-edit-block="${u}"] > .surface-card`);
  if (!el) return null;
  const b = getComputedStyle(el, "::before");
  return { attr: el.getAttribute("data-paper"), content: b.content, opacity: b.opacity, on: el.getAttribute("data-surface") };
}, uid);
const surfaceOfDraft = () => inkBlocks().at(-1)?.props.surface;

/* ---- A. Défaut inchangé ---------------------------------------------------------------------------------------------------------- */

await section("A", async () => {
  let menu = await openMenu();
  await menu.getByRole("switch", { name: "Une carte sous la rubrique" }).click();
  ok("A1 carte posée (réglages du thème : `{}`)", await waitFor(() => JSON.stringify(surfaceOfDraft()) === "{}"), JSON.stringify(surfaceOfDraft()));
  ok("A2 le menu propose « Papier du site » (le thème a un papier)", await menu.locator('[data-testid="surface-paper"]').isVisible() && (await menu.locator('[data-testid="surface-paper-none"]').count()) === 0);
  const site = menu.locator('[data-paper="site"]');
  ok("A2 défaut : « Comme le site (sous) » coché, pas de curseur", (await site.getAttribute("aria-checked")) === "true" && /sous/.test((await site.textContent()) ?? "") && (await menu.locator('[data-testid="surface-paper-opacity"]').count()) === 0);
  const c = await canvasCard();
  ok("A3 toile : aucun attribut de papier, pseudo-élément absent", c.attr === null && c.content === "none", JSON.stringify(c));
  await page.keyboard.press("Escape");
  await settled();
  ok("A4 publication", await publish());
  const { pub, close } = await openPublic();
  const s = await cardState(pub);
  ok("A5 public : aucun attribut de papier, pseudo-élément absent, aplat sans empilement propre", s.attr === null && s.content === "none" && s.isolation === "auto" && s.htmlPaper && !s.htmlCards, JSON.stringify(s));
  const m = await motifPixels(pub, "avant-carte-sous-le-papier.png");
  ok("A5 public : la carte est un aplat uni (papier caché dessous)", m.motif === 0 && m.total > 5000, JSON.stringify(m));
  await pub.screenshot({ path: path.join(SHOTS, "avant-page.png") });
  await close();
});

/* ---- B. Option par carte ---------------------------------------------------------------------------------------------------------- */

await section("B", async () => {
  f = await openEditor();
  const menu = await openMenu();
  await menu.locator('[data-paper="over"]').click();
  const c = await canvasCard();
  ok("B1 aperçu immédiat sur la toile : papier dessiné sur la carte (pseudo-élément, intensité 0,35 par défaut)", c.attr === "over" && c.content === '""' && Math.abs(Number(c.opacity) - 0.35) < 0.01, JSON.stringify(c));
  ok("B1 brouillon : { paper: over }", await waitFor(() => JSON.stringify(surfaceOfDraft()) === '{"paper":"over"}'), JSON.stringify(surfaceOfDraft()));
  const slider = menu.locator('[data-testid="surface-paper-opacity"]');
  ok("B2 le curseur d'intensité apparaît (35 % par défaut, jusqu'à 60 %)", (await slider.waitFor({ timeout: 10000 }).then(() => true, () => false)) && (await slider.inputValue()) === "35" && (await slider.getAttribute("max")) === "60");
  await slider.fill("50");
  const c2 = await canvasCard();
  ok("B2 curseur : intensité 0,5 immédiate sur la toile", Math.abs(Number(c2.opacity) - 0.5) < 0.01, JSON.stringify(c2));
  ok("B2 brouillon : { paper: over, paperOpacity: 0.5 }", await waitFor(() => surfaceOfDraft()?.paper === "over" && surfaceOfDraft()?.paperOpacity === 0.5), JSON.stringify(surfaceOfDraft()));
  await page.screenshot({ path: path.join(SHOTS, "menu-carte-papier.png") });
  // Annuler / Rétablir passent par l'historique.
  await page.keyboard.press("Escape");
  await settled();
  ok("B3 publication", await publish());
  ok("B3 publié avec la carte", JSON.stringify(publishedSurface().at(-1)) === '{"paper":"over","paperOpacity":0.5}', JSON.stringify(publishedSurface()));
  const { pub, close } = await openPublic();
  const s = await cardState(pub);
  ok("B4 public : data-paper=over, pseudo-élément dessiné avec la tuile, intensité 0,5, empilement isolé, sans prise de clic, sous le contenu", s.attr === "over" && s.content === '""' && /kit\/.*\.svg/.test(s.image) && Math.abs(Number(s.opacity) - 0.5) < 0.01 && s.isolation === "isolate" && s.zIndex === "-1" && s.pointer === "none", JSON.stringify(s));
  const m = await motifPixels(pub, "apres-carte-sur-le-papier.png");
  ok("B5 public : le motif est visible DANS la carte (pixels hors texte)", m.motif > 200, JSON.stringify(m));
  // Texte et lien : au-dessus du papier, cliquables.
  const hits = await pub.evaluate(() => {
    const card = document.querySelector(".surface-card[data-surface='on']");
    const out = {};
    for (const sel of ["h2", "p"]) {
      const el = card.querySelector(sel);
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + Math.min(20, r.width / 2), r.top + r.height / 2);
      out[sel] = hit === el || el.contains(hit);
    }
    const a = document.createElement("a");
    a.href = "#papier28";
    a.textContent = "Lien d'essai";
    a.dataset.probe = "";
    card.querySelector("p").after(a);
    a.scrollIntoView({ block: "center" });
    const r = a.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    out.a = hit === a;
    out.pos = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    return out;
  });
  ok("B6 elementFromPoint : le titre, le paragraphe et un lien reçoivent le point (jamais le papier)", hits.h2 && hits.p && hits.a, JSON.stringify(hits));
  await pub.mouse.click(hits.pos.x, hits.pos.y);
  ok("B6 un vrai clic sur le lien fonctionne", (await pub.evaluate(() => location.hash)) === "#papier28");
  // Le texte reste net : même couleur de texte qu'avant (le papier ne le teinte pas).
  const ink = await pub.evaluate(() => getComputedStyle(document.querySelector(".surface-card p")).color);
  ok("B6 la couleur du texte n'est pas touchée", /^rgb\(/.test(ink), ink);
  await pub.screenshot({ path: path.join(SHOTS, "apres-page.png") });
  await close();
});

/* ---- C. Réglage du site ---------------------------------------------------------------------------------------------------------- */

await section("C", async () => {
  await page.goto(`${BASE}/admin/themes/${THEME_ID}`, { waitUntil: "networkidle" });
  const panel = page.locator("section", { has: page.getByRole("heading", { name: "Papier dessiné" }) });
  ok("C1 l'éditeur de thème a « Papier dessiné » avec « Papier visible sur les cartes »", await panel.waitFor({ timeout: 30000 }).then(() => true, () => false) && (await panel.locator('[data-testid="paper-on-cards"]').count()) === 1);
  ok("C1 curseur d'intensité masqué tant que la case est décochée", (await panel.locator('[data-testid="paper-on-cards-opacity"]').count()) === 0);
  await panel.locator('[data-testid="paper-on-cards"]').check();
  const range = panel.locator('[data-testid="paper-on-cards-opacity"]');
  await range.fill("40");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  ok("C2 réglage enregistré dans le thème (assets.kit.paper.onCards / onCardsOpacity)", await waitFor(() => {
    const p = JSON.parse(q("select data from themes where id = ?", THEME_ID)[0].data).assets.kit.paper;
    return p.onCards === true && p.onCardsOpacity === 0.4;
  }));

  f = await openEditor();
  const menu = await openMenu();
  const site = menu.locator('[data-paper="site"]');
  ok("C3 « Comme le site (sur) » dans le menu", /sur/.test((await site.textContent()) ?? ""));
  await site.click();
  ok("C3 brouillon : la carte ne porte plus de réglage de papier", await waitFor(() => JSON.stringify(surfaceOfDraft()) === "{}"), JSON.stringify(surfaceOfDraft()));
  const c = await canvasCard();
  ok("C3 toile : le papier est sur la carte avec l'intensité du site (0,4)", c.attr === null && c.content === '""' && Math.abs(Number(c.opacity) - 0.4) < 0.01, JSON.stringify(c));
  const sl = menu.locator('[data-testid="surface-paper-opacity"]');
  ok("C3 le curseur montre l'intensité du site (40 %)", (await sl.inputValue()) === "40");
  await page.keyboard.press("Escape");
  await settled();
  ok("C4 publication", await publish());
  let { pub, close } = await openPublic();
  let s = await cardState(pub);
  ok("C4 public : html data-kit-paper-cards, carte sans attribut, papier dessiné à 0,4", s.htmlCards && s.attr === null && s.content === '""' && Math.abs(Number(s.opacity) - 0.4) < 0.01, JSON.stringify(s));
  let m = await motifPixels(pub, "site-papier-sur-les-cartes.png");
  ok("C4 public : le motif est visible dans la carte", m.motif > 150, JSON.stringify(m));
  await close();

  // La carte surcharge le site : « Sous la carte ».
  f = await openEditor();
  const menu2 = await openMenu();
  await menu2.locator('[data-paper="under"]').click();
  ok("C5 brouillon : { paper: under }", await waitFor(() => JSON.stringify(surfaceOfDraft()) === '{"paper":"under"}'), JSON.stringify(surfaceOfDraft()));
  ok("C5 toile : papier caché malgré le site", (await canvasCard()).content === "none");
  ok("C5 plus de curseur quand le papier est caché", (await menu2.locator('[data-testid="surface-paper-opacity"]').count()) === 0);
  await page.keyboard.press("Escape");
  await settled();
  ok("C5 publication", await publish());
  ({ pub, close } = await openPublic());
  s = await cardState(pub);
  ok("C5 public : data-paper=under, pas de pseudo-élément", s.attr === "under" && s.content === "none" && s.htmlCards, JSON.stringify(s));
  m = await motifPixels(pub);
  ok("C5 public : carte unie", m.motif === 0, JSON.stringify(m));
  await close();
});

/* ---- D. Thème sans papier ---------------------------------------------------------------------------------------------------------- */

await section("D", async () => {
  await activateTheme("carnet-d-atelier");
  const actives = await page.locator(".a-theme-card").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-active")}:${(e.textContent ?? "").slice(0, 24)}`));
  ok("D0 thème sans papier en ligne", actives.some((a) => /^true:Carnet/.test(a)), actives.join(" | "));
  await page.screenshot({ path: path.join(SHOTS, "d0-themes.png") });
  // Les écrans d'édition de thème laissent un aperçu (cookie) du thème édité : on le quitte pour revoir le thème en ligne.
  await page.goto(`${BASE}/api/theme-preview?id=&banner=0`, { waitUntil: "domcontentloaded" });
  f = await openEditor();
  const menu = await openMenu();
  ok("D1 sans papier dans le thème : phrase d'aide, aucune option", await menu.locator('[data-testid="surface-paper-none"]').isVisible() && (await menu.locator('[data-testid="surface-paper"]').count()) === 0 && /pas de papier/.test((await menu.locator('[data-testid="surface-paper-none"]').textContent()) ?? ""));
  await page.screenshot({ path: path.join(SHOTS, "menu-carte-sans-papier.png") });
  await page.keyboard.press("Escape");
  await settled();
  const { pub, close } = await openPublic();
  const s = await cardState(pub);
  ok("D2 public : aucun papier, aucun pseudo-élément", !s.htmlPaper && s.content === "none", JSON.stringify(s));
  await close();
  await activateTheme(THEME_ID);
});

/* ---- P. Parité : rien ne change sans réglage de papier ------------------------------------------------------------------------------ */

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
      if (res?.status() !== 200 || /data-paper=|data-kit-paper-cards|card-paper-opacity/.test(html)) bad.push(`${id}${p}`);
    }
  }
  ok(`P1 ${presets.length} presets : aucun repère de papier de carte dans le HTML public`, presets.length === 8 && bad.length === 0, bad.join(" "));
  await anon.close();
});

ok("aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
