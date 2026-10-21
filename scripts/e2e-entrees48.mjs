#!/usr/bin/env node
/**
 * Entrées des collections sur papier peint (lot 48, ticket 33), UN chromium. Serveur requis, base NEUVE (seed), une connexion.
 * L'accueil porte : un composant « Entrées des collections » nu (G0) et quatre sur un Fond avec marge (G1 : papier peint, voisin vert bord à
 * bord ; G3 : Carte verte + papier peint marge M ; G4 : Carte + papier peint marge L ; G5 : Carte + fond de couleur marge M).
 *
 *  A. Public, 390 / 768 / 1024 / 1440 px : le titre, les tuiles et les images restent DANS la zone colorée, avec au moins 16 px de marge ;
 *     image et texte s'empilent sous 42 rem de LARGEUR DE CONTENEUR (et pas de fenêtre) ; pas de défilement horizontal ;
 *     sur grand écran (1440), le Fond ne change ni la largeur ni la place du contenu (parité du lot 47).
 *  B. Toile (éditeur) : mêmes mesures, fenêtres de 390 / 768 / 1024 / 1440 px et modes Tablette / Téléphone.
 *  C. Aucune commande d'édition hors de la toile : Aperçu de l'éditeur, puis le site ouvert avec la session admin (vue brouillon) ; sur la
 *     toile en mode édition, les commandes sont bien là. Aucun élément `.pe-*` ni `[data-edit-*-op]` visible, aucun texte de commande.
 *  D. Quitter l'éditeur (← Retour aux pages) coupe la vue brouillon (cookies `page-draft` et `__prerender_bypass`) ; l'Aperçu volontaire
 *     (« Prévisualiser la page ») fonctionne toujours, sans commandes.
 * Captures : $SHOTS. Mode DIAG=1 : affiche les mesures sans compter d'échec.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { chromium } from "playwright";
import sharp from "sharp";

import { login, q1, sleep, sql, waitFor } from "./lib/grille31d.mjs";
import { publishBlocks } from "./lib/page-draft.mjs";

const BASE = process.env.BASE ?? "http://localhost:3600";
const SHOTS = process.env.SHOTS ?? "screenshots/entrees48";
const DIAG = process.env.DIAG === "1";
mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond && !DIAG) failures++;
  console.log(`${cond ? "PASS" : DIAG ? "DIAG-FAIL" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const MIN = 16;
const STACK_REM = 42;

const GREEN = "#4d8f5b";
const PINK = "#f4a6c0";
const tile = await sharp({ create: { width: 96, height: 96, channels: 4, background: "#f6b3c9" } })
  .composite(
    await Promise.all(
      [[0, 0], [48, 48]].map(async ([left, top]) => ({ input: await sharp({ create: { width: 48, height: 48, channels: 4, background: "#e0709a" } }).png().toBuffer(), left, top })),
    ),
  )
  .png()
  .toBuffer();
const WP_FILE = path.join(SHOTS, "carreaux-roses.png");
writeFileSync(WP_FILE, tile);

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);

// Papier peint rose à carreaux (bibliothèque).
await page.goto(`${BASE}/admin/papiers-peints`, { waitUntil: "networkidle" });
await page.locator('[data-testid="wallpaper-input"]').setInputFiles([WP_FILE]);
await waitFor(() => q1("select count(*) n from wallpapers w join media m on m.id = w.media_id where m.status = 'ready'")?.n >= 1, 90000);
const wp = q1("select id from wallpapers order by id desc");
const WP = (extra = {}) => ({ kind: "wallpaper", wallpaper: wp.id, ...extra });
const tiles = (uid, tag, extra = {}) => ({ uid, type: "collection-tiles", props: { eyebrow: { fr: tag, en: tag }, title: { fr: "Catégories", en: "Categories" }, mode: "auto", size: "medium", ...extra } });
const blocks = [
  tiles("g0", "G0 sans fond ni carte"),
  { uid: "s1", type: "section-title", props: { eyebrow: { fr: "S1 voisin vert", en: "S1" }, title: { fr: "Section verte", en: "Green" }, background: { kind: "color", color: GREEN } } },
  tiles("g1", "G1 papier peint marge M, voisin vert", { background: WP({ inset: "m", round: "m" }) }),
  tiles("g3", "G3 carte verte + papier peint marge M", { surface: { color: GREEN }, background: WP({ inset: "m", round: "m" }) }),
  tiles("g4", "G4 carte verte + papier peint marge L", { surface: { color: GREEN }, background: WP({ inset: "l", round: "l" }) }),
  tiles("g5", "G5 carte verte + fond rose marge M", { surface: { color: GREEN }, background: { kind: "color", color: PINK, inset: "m", round: "m" } }),
];
const GROUPS = ["G1", "G3", "G4", "G5"];
const done = () => q1("select count(*) n from blocks where page_id = 1")?.n === blocks.length;
sql((db) => db.prepare("update pages set draft = NULL, draft_rev = 0 where id = 1").run());
let published = await publishBlocks(page, BASE, 1, () => blocks, done);
for (let t = 0; !published && t < 3; t++) {
  await page.getByRole("button", { name: "Publier", exact: true }).click().catch(() => {});
  published = await waitFor(done, 20000);
}
ok("0 page d'accueil publiée (papier peint, 5 composants)", published);

/** Mesures d'un composant (repéré par son surtitre « Gn … »), dans le document ou le cadre de la toile. */
const MEASURE = (tag) => {
  const box = (e) => {
    if (!e) return null;
    const b = e.getBoundingClientRect();
    return { l: b.left, r: b.right, w: b.width, t: b.top + scrollY, b: b.bottom + scrollY };
  };
  const eb = [...document.querySelectorAll(".eyebrow")].find((e) => e.textContent.trim().startsWith(`${tag} `));
  if (!eb) return null;
  const section = eb.closest("section");
  const tilesEl = section.querySelector(".tiles");
  const first = tilesEl?.querySelector(".tile");
  return {
    vw: document.documentElement.clientWidth,
    sw: document.documentElement.scrollWidth,
    zone: box(section.closest('.fond-bloc[data-fond="on"]')),
    h2: box(section.querySelector("h2")),
    tiles: [...section.querySelectorAll(".tile")].map(box),
    imgs: [...section.querySelectorAll(".tile img")].map(box),
    box: box(tilesEl),
    firstImg: box(first?.querySelector(".tile-img")),
    firstTxt: box(first?.querySelector(".tile-txt")),
    h3: first ? parseFloat(getComputedStyle(first.querySelector("h3")).fontSize) : 0,
    h2px: parseFloat(getComputedStyle(section.querySelector("h2")).fontSize),
    covers: section.querySelectorAll(".pe-tile-cover").length,
  };
};
const fmtBox = (b) => (b ? `${b.l.toFixed(0)}..${b.r.toFixed(0)}` : "—");

/** Titre, tuiles et images dans la zone (≥ 16 px) ; empilement selon la largeur du conteneur ; pas de défilement horizontal. */
function checkGroup(label, g, m) {
  if (!m || !m.zone) return ok(`${label} ${g} mesuré`, false, JSON.stringify(m));
  const inside = (b) => b.l >= m.zone.l + MIN - 1 && b.r <= m.zone.r - MIN + 1;
  const all = [m.h2, ...m.tiles, ...m.imgs];
  const bad = all.filter((b) => !inside(b));
  ok(`${label} ${g} : titre, ${m.tiles.length} tuiles et ${m.imgs.length} images à ${MIN} px au moins du bord de la zone (${fmtBox(m.zone)})`, m.tiles.length === 3 && m.imgs.length === 3 && bad.length === 0, `hors zone : ${bad.map(fmtBox).join(" ")} ; titre ${fmtBox(m.h2)}`);
  const side = m.firstTxt.t < m.firstImg.b - 4 && m.firstTxt.l >= m.firstImg.r - 1;
  const rem = m.box.w / 16;
  ok(`${label} ${g} : ${rem.toFixed(1)} rem de conteneur → ${rem >= STACK_REM ? "côte à côte" : "empilé"}`, side === rem >= STACK_REM, `côte à côte ${side}, largeur ${m.box.w.toFixed(0)}`);
  ok(`${label} ${g} : pas de défilement horizontal`, m.sw <= m.vw + 1, `${m.sw}/${m.vw}`);
}

/* ---- A. Public -------------------------------------------------------------------------------------------------------------------- */
const PUBLIC = {};
for (const width of [390, 768, 1024, 1440]) {
  const c = await browser.newContext({ viewport: { width, height: 1000 }, ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) });
  const p = await c.newPage();
  await p.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  await sleep(800);
  PUBLIC[width] = { G0: await p.evaluate(MEASURE, "G0") };
  for (const g of GROUPS) {
    const m = await p.evaluate(MEASURE, g);
    PUBLIC[width][g] = m;
    checkGroup(`A${width}`, g, m);
  }
  if (width === 390 || width === 1440) {
    const g4 = p.locator('.eyebrow:text-matches("^G4 ")').first();
    await g4.scrollIntoViewIfNeeded();
    await p.screenshot({ path: path.join(SHOTS, `public-G4-${width}.png`) });
  }
  const html = await p.content();
  ok(`A${width} aucune commande d'édition dans le HTML public`, !/pe-tile-cover|data-edit-|Changer la couverture/.test(html));
  await c.close();
}
{
  const g0 = PUBLIC[1440].G0;
  for (const g of GROUPS) {
    const m = PUBLIC[1440][g];
    ok(`A1440 ${g} : parité du lot 47 : les images gardent la largeur et la place de « G0 » (sans fond)`, m.imgs.every((b, i) => Math.abs(b.l - g0.imgs[i].l) <= 1 && Math.abs(b.w - g0.imgs[i].w) <= 1), `${m.imgs.map(fmtBox)} / ${g0.imgs.map(fmtBox)}`);
  }
  const fs = PUBLIC[1440].G0;
  ok("A1440 titres : 52 px (plafond) pour les entrées, 72 px pour le grand titre", Math.abs(fs.h3 - 52) < 0.6 && Math.abs(fs.h2px - 72) < 0.6, `${fs.h3} / ${fs.h2px}`);
  ok("A390 titres : bornes en rem (32 px et 36 px au plus bas)", PUBLIC[390].G0.h3 >= 31.9 && PUBLIC[390].G0.h2px >= 35.9, `${PUBLIC[390].G0.h3} / ${PUBLIC[390].G0.h2px}`);
}

/* ---- B. Toile --------------------------------------------------------------------------------------------------------------------- */
async function openCanvas(width, device) {
  await page.setViewportSize({ width, height: 2600 });
  await page.goto(`${BASE}/admin/pages/1/editer`, { waitUntil: "domcontentloaded" });
  const handle = await page.waitForSelector("iframe.ve-frame", { timeout: 120000 });
  const fr = await handle.contentFrame();
  await fr.waitForSelector("html[data-edit-mode]", { timeout: 120000 });
  await fr.waitForSelector(".tile", { timeout: 60000 });
  await sleep(2000);
  if (device) {
    await page.locator(`.ve-seg button[title^="${device}"]`).click();
    await sleep(1500);
  }
  return fr;
}
let frame;
for (const [width, device] of [[390], [768], [1024], [1440], [1440, "Tablette"], [1440, "Téléphone"]]) {
  frame = await openCanvas(width, device);
  const label = `B${width}${device ? " " + device : ""}`;
  for (const g of GROUPS) {
    const m = await frame.evaluate(MEASURE, g);
    checkGroup(label, g, m);
    if (!device && width === 1440 && g === "G4") {
      await frame.locator('.eyebrow:text-matches("^G4 ")').first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(SHOTS, "toile-G4-1440.png") });
    }
  }
}

/* ---- C. Aucune commande d'édition hors de la toile ------------------------------------------------------------------------------- */
const CONTROLS = () => {
  const visible = (el) => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && parseFloat(cs.opacity) > 0;
  };
  const marked = [...document.querySelectorAll("*")].filter((el) => {
    // Repères de structure (data-edit-global / -background / -surface, pe-field-host) et lien « Modifier cette page » du bandeau : pas des commandes.
    const cls = [...el.classList].some((c) => /^pe-/.test(c) && !/^pe-(field-host|edit-this)$/.test(c));
    const attr = [...el.attributes].some((a) => /^data-edit-(.+-op|.+-add|.+-pick|container-.*|free-empty|empty-media|tile-add)$/.test(a.name));
    return (cls || attr) && visible(el);
  });
  const text = document.body.innerText;
  const words = ["Changer la couverture", "Couverture automatique", "Ajouter une rubrique", "Ajouter une entrée", "Monter l'entrée", "Retirer l'entrée"].filter((w) => text.includes(w));
  return { marked: marked.map((e) => `${e.tagName.toLowerCase()}.${[...e.classList].join(".")}`), words, inDom: document.querySelectorAll(".pe-tile-cover, .pe-tile-tools, .pe-tile-add-row").length };
};
{
  // Sur la toile en mode édition, les commandes d'entrée sont bien là (le test n'est pas vide).
  frame = await openCanvas(1440);
  const edit = await frame.evaluate(CONTROLS);
  ok("C1 toile en mode édition : « Changer la couverture » présent sur les entrées", edit.inDom >= 3, JSON.stringify(edit));
  await page.getByRole("button", { name: "Aperçu", exact: true }).click();
  await sleep(2500);
  const prev = await frame.evaluate(CONTROLS);
  ok("C2 Aperçu de l'éditeur : aucune commande visible (.pe-*, data-edit-*-op, textes de commande)", prev.marked.length === 0 && prev.words.length === 0, JSON.stringify(prev));
  ok("C3 Aperçu de l'éditeur : les commandes d'entrée ne sont même pas dans le DOM", prev.inDom === 0, JSON.stringify(prev));
  const m = await frame.evaluate(MEASURE, "G3");
  ok("C4 Aperçu de l'éditeur : l'image de Personnages garde sa place (colonne image à gauche, texte à droite, pas de case fantôme)", m.firstImg.r <= m.firstTxt.l + 1 && m.firstTxt.t < m.firstImg.b, JSON.stringify([m.firstImg, m.firstTxt]));
  await page.screenshot({ path: path.join(SHOTS, "toile-apercu-1440.png") });
  // Le site ouvert avec la session admin, cookies de vue brouillon encore posés (comme après un passage dans l'éditeur).
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  await sleep(1500);
  const site = await page.evaluate(CONTROLS);
  const banner = await page.locator(".preview-banner").count();
  ok("C5 site ouvert avec la session admin (vue brouillon) : aucune commande visible, aucune dans le DOM", site.marked.length === 0 && site.words.length === 0 && site.inDom === 0, JSON.stringify(site));
  ok("C6 … le bandeau « Aperçu » signale la vue brouillon", banner === 1);
  const sm = await page.evaluate(MEASURE, "G3");
  ok("C7 … et les entrées sont mises en page comme en public (mêmes boîtes)", Math.abs(sm.firstImg.l - PUBLIC[1440].G3.firstImg.l) <= 1 && Math.abs(sm.firstTxt.l - PUBLIC[1440].G3.firstTxt.l) <= 1, JSON.stringify([sm.firstImg, PUBLIC[1440].G3.firstImg]));
  await page.screenshot({ path: path.join(SHOTS, "site-session-admin-1440.png") });
}

/* ---- D. Sortie de l'éditeur, Aperçu volontaire ---------------------------------------------------------------------------------- */
{
  const names = async () => (await ctx.cookies()).map((c) => c.name);
  const before = await names();
  ok("D1 avant de quitter : les cookies de vue brouillon sont posés (page-draft, __prerender_bypass)", before.includes("page-draft") && before.includes("__prerender_bypass"), before.join());
  await openCanvas(1440);
  await page.locator("a.ve-brand").click();
  await page.waitForURL(/\/admin\/pages$/, { timeout: 60000 });
  const after = await names();
  ok("D2 « ← Retour aux pages » retire page-draft et __prerender_bypass", !after.includes("page-draft") && !after.includes("__prerender_bypass"), after.join());
  await page.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  ok("D3 le site ne s'ouvre plus en Aperçu : ni bandeau, ni commande, ni brouillon", (await page.locator(".preview-banner").count()) === 0 && (await page.evaluate(CONTROLS)).marked.length === 0);
  // Lien « formulaire de la page » de l'éditeur : même sortie.
  await openCanvas(1440);
  ok("D4 retour dans l'éditeur : la vue brouillon est reposée (cookies)", (await names()).includes("page-draft"));
  await page.locator("#ve-tab-reglages").click();
  await page.getByRole("link", { name: "formulaire de la page" }).first().click();
  await page.waitForURL(/\/admin\/pages\/1$/, { timeout: 60000 });
  const after2 = await names();
  ok("D5 « formulaire de la page » retire aussi les cookies de vue brouillon", !after2.includes("page-draft") && !after2.includes("__prerender_bypass"), after2.join());
  // Aperçu volontaire : « Prévisualiser la page » (nouvel onglet).
  const [popup] = await Promise.all([ctx.waitForEvent("page"), page.getByRole("button", { name: /Prévisualiser la page/ }).click()]);
  await popup.waitForLoadState("networkidle");
  await sleep(1200);
  ok("D6 « Prévisualiser la page » : l'aperçu s'ouvre (bandeau « Aperçu »), pages telles qu'enregistrées", (await popup.locator(".preview-banner").count()) === 1 && (await popup.locator(".tile").count()) >= 3);
  const pc = await popup.evaluate(CONTROLS);
  ok("D7 … sans aucune commande d'édition", pc.marked.length === 0 && pc.words.length === 0 && pc.inDom === 0, JSON.stringify(pc));
  await popup.close();
}
ok("Z aucune erreur JavaScript de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures === 0 ? "OK" : `${failures} échec(s)`);
process.exit(failures === 0 ? 0 : 1);
