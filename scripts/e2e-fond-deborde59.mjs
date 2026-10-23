#!/usr/bin/env node
/**
 * Fond qui déborde / contenu collé au bord d'une zone colorée (lot 59, ticket 45), UN chromium. Serveur requis, base NEUVE (seed), une connexion.
 *
 *  Cas 1 (page « personnages ») : la planche d'un projet porte des images avec Fond (couleur, marge, coins, papier peint, fond derrière l'image),
 *     posée sur une page nue, une Carte verte, un fond vert, une Carte + fond.
 *  Cas 2 (accueil) : Entrées des collections, titres, textes, images, grilles sur papier peint (bord à bord, marge, Carte), fond de couleur.
 *
 *  Mesure automatique, aux 6 largeurs (390 / 768 / 1024 / 1280 / 1440 / 1920) : en public, en Aperçu de l'éditeur et sur la toile, tout
 *  descendant visible (image, vidéo, titre, texte, entrée) d'une zone colorée (fond ou carte) est DANS la zone avec au moins 16 px de marge,
 *  et tout fond reste dans la carte qui le porte et dans la fenêtre ; pas de défilement horizontal.
 * Captures : $SHOTS. Mode DIAG=1 : affiche les mesures sans compter d'échec.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { chromium } from "playwright";
import sharp from "sharp";

import { img, login, makeMedia, pageIdOf, q1, setBoardDraft, sleep, sql, waitFor } from "./lib/grille31d.mjs";
import { publishBlocks } from "./lib/page-draft.mjs";
import { autoOpenFine } from "./lib/zone66.mjs";

const BASE = process.env.BASE ?? "http://localhost:3600";
const SHOTS = process.env.SHOTS ?? "screenshots/fond-deborde59";
const DIAG = process.env.DIAG === "1";
const WIDTHS = (process.env.WIDTHS ?? "390,768,1024,1280,1440,1920").split(",").map(Number);
mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond && !DIAG) failures++;
  console.log(`${cond ? "PASS" : DIAG ? "DIAG-FAIL" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};

const GREEN = "#4d8f5b";
const PINK = "#f4a6c0";
const tile = await sharp({ create: { width: 96, height: 96, channels: 4, background: "#f6b3c9" } })
  .composite(await Promise.all([[0, 0], [48, 48]].map(async ([left, top]) => ({ input: await sharp({ create: { width: 48, height: 48, channels: 4, background: "#e0709a" } }).png().toBuffer(), left, top }))))
  .png()
  .toBuffer();
const WP_FILE = path.join(SHOTS, "carreaux-roses.png");
writeFileSync(WP_FILE, tile);

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await autoOpenFine(ctx);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);
const M = await makeMedia(page, BASE);

await page.goto(`${BASE}/admin/papiers-peints`, { waitUntil: "networkidle" });
await page.locator('[data-testid="wallpaper-input"]').setInputFiles([WP_FILE]);
await waitFor(() => q1("select count(*) n from wallpapers w join media m on m.id = w.media_id where m.status = 'ready'")?.n >= 1, 90000);
const wp = q1("select id from wallpapers order by id desc");
const WP = (extra = {}) => ({ kind: "wallpaper", wallpaper: wp.id, ...extra });
const COLOR = (color, extra = {}) => ({ kind: "color", color, ...extra });

/* ---- Cas 1 : planche de projet sur personnages ------------------------------------------------------------------------------------ */
const personnages = pageIdOf("personnages");
const project = q1("select id, slug from projects order by id limit 1");
const L = (fr) => ({ fr, en: fr });
const bimg = (uid, props = {}) => ({ uid, type: "image", props: { mediaId: M.paysage, width: "wide", ...props } });
const boardItems = [
  bimg("i0"),
  bimg("i1", { background: COLOR(PINK) }),
  bimg("i2", { background: COLOR(PINK, { inset: "m", round: "m" }) }),
  bimg("i3", { background: COLOR(PINK, { inset: "l", round: "l" }) }),
  bimg("i4", { background: WP({ inset: "m", round: "m" }) }),
  bimg("i5", { width: "full", background: COLOR(PINK, { inset: "m" }) }),
  bimg("i6", { background: COLOR(PINK, { inset: "s" }), look: { imageBg: "#ffffff" } }),
  { uid: "g1", type: "grid", props: { layout: "3", gap: "normal", align: "stretch", ratio: "auto", top: "gap", background: COLOR(PINK, { inset: "m", round: "m" }), children: [img("c1", M.portrait), img("c2", M.paysage), img("c3", M.carre)] } },
  { uid: "s1", type: "strip", props: { background: COLOR(PINK, { inset: "m", round: "m" }) } },
  { uid: "f1", type: "free-board", props: { format: "3:2", phone: "scale", background: COLOR(PINK), items: [{ id: "a1", media: M.carre, x: 2, y: 10, w: 30 }, { id: "a2", media: M.paysage, x: 60, y: 30, w: 38 }] } },
  { uid: "t1", type: "rich-text", props: { title: L("Un texte"), paragraphs: [L("Un paragraphe posé dans un fond avec marge, qui doit rester à l'intérieur.")], background: COLOR(PINK, { inset: "m", round: "m" }) } },
];
const boardBlock = (uid, extra = {}) => ({ uid, type: "project-board", props: { project: project.slug, ...extra } });
const CARD = { color: GREEN };
const CARD_INSET = { color: GREEN, width: "inset", corners: "m" };
const CASE1 = [
  ["P0 planche nue", {}],
  ["P1 Carte verte", { surface: CARD }],
  ["P2 Carte en retrait", { surface: CARD_INSET }],
  ["P3 fond vert bord à bord", { background: COLOR(GREEN) }],
  ["P4 fond vert marge M coins M", { background: COLOR(GREEN, { inset: "m", round: "m" }) }],
  ["P5 Carte + fond vert marge L", { surface: CARD, background: COLOR(GREEN, { inset: "l", round: "l" }) }],
  ["P6 Carte + papier peint marge M", { surface: CARD, background: WP({ inset: "m", round: "m" }) }],
  ["P7 Carte en retrait coins droits", { surface: { color: GREEN, width: "inset", corners: "square" } }],
];
const page1Blocks = CASE1.map(([, extra], i) => boardBlock(`pb${i}`, extra));
// Une image seule avec fond, posée sur une Carte verte, puis sur un fond vert.
page1Blocks.push(
  { uid: "pi0", type: "image", props: { mediaId: M.paysage, width: "wide", surface: CARD, background: COLOR(PINK, { inset: "m", round: "m" }) } },
  { uid: "pi1", type: "image", props: { mediaId: M.paysage, width: "full", surface: CARD_INSET, background: COLOR(PINK) } },
  { uid: "pi2", type: "image", props: { mediaId: M.paysage, width: "wide", surface: CARD, look: { imageBg: "#ffffff" } } },
);

/* ---- Cas 2 : accueil ------------------------------------------------------------------------------------------------------------ */
const tiles = (uid, extra) => ({ uid, type: "collection-tiles", props: { eyebrow: L("Entrées"), title: L("Catégories"), mode: "auto", size: "medium", ...extra } });
const CASE2 = [
  ["A0 papier peint bord à bord", { background: WP() }],
  ["A1 papier peint marge M", { background: WP({ inset: "m", round: "m" }) }],
  ["A2 Carte verte + papier peint", { surface: CARD, background: WP() }],
  ["A3 Carte + papier peint marge M", { surface: CARD, background: WP({ inset: "m", round: "m" }) }],
  ["A4 Carte en retrait + papier peint marge L", { surface: CARD_INSET, background: WP({ inset: "l", round: "l" }) }],
  ["A5 fond vert marge M", { background: COLOR(GREEN, { inset: "m", round: "m" }) }],
];
const page2Blocks = CASE2.flatMap(([, extra], i) => [
  tiles(`at${i}`, extra),
  { uid: `as${i}`, type: "section-title", props: { eyebrow: L("Étiquette"), title: L("Un titre de section"), intro: L("Une présentation un peu longue pour passer à la ligne sur les écrans étroits."), ...extra } },
  { uid: `ar${i}`, type: "rich-text", props: { title: L("Texte"), paragraphs: [L("Un paragraphe posé sur le fond, qui doit rester à l'intérieur de la zone avec de la marge.")], ...extra } },
  { uid: `ai${i}`, type: "image", props: { mediaId: M.paysage, width: "wide", ...extra } },
  { uid: `af${i}`, type: "image", props: { mediaId: M.paysage, width: "full", ...extra } },
  { uid: `ag${i}`, type: "grid", props: { layout: "3", gap: "normal", align: "stretch", ratio: "auto", top: "gap", ...extra, children: [img(`ag${i}a`, M.portrait), img(`ag${i}b`, M.paysage), img(`ag${i}c`, M.carre)] } },
]);

async function publish(pageId, blocks, check) {
  let done = await publishBlocks(page, BASE, pageId, () => blocks, check);
  for (let t = 0; !done && t < 4; t++) {
    await page.getByRole("button", { name: "Publier", exact: true }).click().catch(() => {});
    done = await waitFor(check, 20000);
  }
  return done;
}
sql((db) => db.prepare("update pages set draft = NULL, draft_rev = 0 where id in (?, 1)").run(personnages));
sql((db) => db.prepare("update projects set draft_layout = NULL, draft_layout_page_id = NULL where id = ?").run(project.id));
setBoardDraft(project.id, personnages, boardItems);
ok("0a personnages publiée (planche + 7 réglages)", await publish(personnages, page1Blocks, () => q1("select count(*) n from blocks where page_id = ?", personnages).n === page1Blocks.length && q1("select layout from projects where id = ?", project.id)?.layout?.includes('"i0"')));
ok("0b accueil publié", await publish(1, page2Blocks, () => q1("select count(*) n from blocks where page_id = 1").n === page2Blocks.length));

/** Mesure (dans le document ou le cadre de la toile) : contenu des zones colorées, fonds dans leur carte, défilement horizontal. */
const MEASURE = (MIN) => {
  const vis = (el) => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return r.width > 2 && r.height > 2 && cs.visibility !== "hidden" && cs.display !== "none" && parseFloat(cs.opacity) > 0 && cs.position !== "fixed";
  };
  const desc = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 1).join(".") : ""}${el.dataset?.width ? "[" + el.dataset.width + "]" : ""}`;
  const zoneBox = (z) => {
    const b = z.getBoundingClientRect(), cs = getComputedStyle(z);
    const bl = parseFloat(cs.borderLeftWidth) || 0, br = parseFloat(cs.borderRightWidth) || 0;
    return { l: b.left + bl, r: b.right - br };
  };
  const zones = [...document.querySelectorAll('.fond-bloc[data-fond="on"], .surface-card[data-surface="on"]')];
  const zname = (z) => {
    const a = z.dataset;
    return `${z.classList.contains("fond-bloc") ? "fond" : "carte"}${a.fondInset ? ` marge${a.fondInset}` : ""}${a.wallpaper !== undefined ? " pp" : ""}${a.width ? ` ${a.width}` : ""}`;
  };
  const idx = (z) => zones.indexOf(z);
  const out = [];
  const leaves = [...document.querySelectorAll("main img, main video, main h1, main h2, main h3, main p, main .tile, main .free-item, main figure, main .strip-viewport, main .free-board")]
    .filter((e) => vis(e) && !e.parentElement.closest(".strip-viewport, .free-board, .pe-media-empty, .pe-field-ops, .preview-banner, [class*='pe-tile-'], [data-edit-bitems] > .pe-badd") && !e.closest(".pe-media-empty, .pe-field-ops"));
  for (const e of leaves) {
    const b = e.getBoundingClientRect();
    for (let z = e.parentElement?.closest('.fond-bloc[data-fond="on"], .surface-card[data-surface="on"]'); z; z = z.parentElement?.closest('.fond-bloc[data-fond="on"], .surface-card[data-surface="on"]')) {
      const zb = zoneBox(z);
      const need = e.matches(".strip-viewport") ? 0 : MIN;
      if (b.left < zb.l + need - 1 || b.right > zb.r - need + 1) out.push({ k: "contenu", z: idx(z), zone: zname(z), el: desc(e), dl: +(b.left - zb.l).toFixed(1), dr: +(zb.r - b.right).toFixed(1) });
    }
  }
  for (const z of zones) {
    const zb = zoneBox(z);
    const outer = z.parentElement?.closest('.fond-bloc[data-fond="on"], .surface-card[data-surface="on"]');
    if (outer) {
      const ob = zoneBox(outer);
      if (zb.l < ob.l - 1 || zb.r > ob.r + 1) out.push({ k: "fond hors zone mère", z: idx(z), zone: zname(z), el: "—", dl: +(zb.l - ob.l).toFixed(1), dr: +(ob.r - zb.r).toFixed(1) });
    }
    if (zb.l < -1 || zb.r > document.documentElement.clientWidth + 1) out.push({ k: "zone hors fenêtre", z: idx(z), zone: zname(z), el: "—", dl: +zb.l.toFixed(1), dr: +(document.documentElement.clientWidth - zb.r).toFixed(1) });
  }
  return { n: zones.length, leaves: leaves.length, vw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth, bad: out };
};
const MIN = 16;
function report(label, m, expectedZones) {
  if (!m) return ok(`${label} mesuré`, false, "rien");
  const dedup = new Map();
  for (const b of m.bad) if (!/^img\./.test(b.el)) dedup.set(`${b.k}|${b.z}`, b);
  const list = [...dedup.values()];
  ok(`${label} : ${m.n} zones, ${m.leaves} éléments, tous à ${MIN} px au moins du bord de leur zone, fonds dans leur carte`, m.n >= expectedZones && list.length === 0,
    `zones ${m.n}/${expectedZones} ; ${list.length} hors zone : ` + list.slice(0, Number(process.env.SHOW ?? 8)).map((b) => `[${b.k} #${b.z} ${b.zone} ${b.el} g=${b.dl} d=${b.dr}]`).join(" "));
  ok(`${label} : pas de défilement horizontal`, m.sw <= m.vw + 1, `${m.sw}/${m.vw}`);
}

const PAGES = [["personnages", "fr/personnages", CASE1.length + 3 + 6], ["accueil", "fr", 1]];
/* ---- A. Public -------------------------------------------------------------------------------------------------------------------- */
for (const width of WIDTHS) {
  const c = await browser.newContext({ viewport: { width, height: 1000 }, ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) });
  const p = await c.newPage();
  for (const [name, url, min] of PAGES) {
    await p.goto(`${BASE}/${url}`, { waitUntil: "networkidle" });
    await sleep(700);
    report(`A${width} public ${name}`, await p.evaluate(MEASURE, MIN), min);
    if (process.env.SHOT_TAG && [390, 1440].includes(width)) await p.screenshot({ path: path.join(SHOTS, `${process.env.SHOT_TAG}-public-${name}-${width}.png`), fullPage: true });
  }
  await c.close();
}

/* ---- B. Aperçu de l'éditeur et toile ------------------------------------------------------------------------------------------------ */
async function openCanvas(pageId, width) {
  await page.setViewportSize({ width, height: 2600 });
  await page.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
  const handle = await page.waitForSelector("iframe.ve-frame", { timeout: 120000 });
  const fr = await handle.contentFrame();
  await fr.waitForSelector("html[data-edit-mode]", { timeout: 120000 });
  await sleep(2500);
  return fr;
}
const CANVAS_WIDTHS = WIDTHS.filter((w) => w >= 768);
for (const [name, , min] of PAGES) {
  const pageId = name === "accueil" ? 1 : personnages;
  for (const width of CANVAS_WIDTHS) {
    const fr = await openCanvas(pageId, width);
    report(`B${width} toile ${name}`, await fr.evaluate(MEASURE, MIN), min);
    await page.getByRole("button", { name: "Aperçu", exact: true }).click();
    await sleep(2500);
    const m = await fr.evaluate(MEASURE, MIN);
    report(`B${width} Aperçu ${name}`, m, min);
    if (process.env.SHOT_TAG && width === 1440) await page.screenshot({ path: path.join(SHOTS, `${process.env.SHOT_TAG}-apercu-${name}-${width}.png`) });
  }
}
ok("Z aucune erreur JavaScript de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures === 0 ? "OK" : `${failures} échec(s)`);
process.exit(failures === 0 ? 0 : 1);
