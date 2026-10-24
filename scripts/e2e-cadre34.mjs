#!/usr/bin/env node
/**
 * Lot 34 « cadre autour des photos » (chromium, serveur requis, base neuve, une connexion admin).
 *  I  Image seule : choix « Bordure » (lot 62 : plus d'interrupteur), épaisseur Fin / Moyen / Épais, couleur par défaut, pastille de la
 *     palette, couleur libre ; rendu sur la toile (style calculé), enregistré dans `look.frame`.
 *  G  Case de grille : même réglage ; la case garde sa taille extérieure (celle de ses voisines), rien n'est rogné.
 *  B  Image d'une planche de projet : bouton « Cadre » de la barre de l'image, enregistré dans `look.slotLook[slug].frame` (par emplacement).
 *  U  Annuler retire le cadre ; « Aucun » aussi (plus de bordure).
 *  P  Publication : même rendu en public (style calculé), pas de cadre sur les autres photos ni dans la visionneuse,
 *     téléphone (390 px) : cadre plus mince, aucun débordement horizontal.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=I,G,B,U,P] [SHOTS=dossier] node scripts/e2e-cadre34.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";
import sharp from "sharp";

import { paint } from "./lib/crop-fixtures.mjs";
import { login, pageIdOf, q1, waitFor } from "./lib/medias-setup.mjs";

const BASE = process.env.BASE ?? "http://localhost:3340";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(tmpdir(), "e2e-cadre34");
const DB = path.join(process.env.DATA_DIR ?? "data", "portfolio.db");
mkdirSync(SHOTS, { recursive: true });
sharp.cache(false);
sharp.concurrency(1);

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (fn) => {
  const db = new Database(DB);
  db.pragma("busy_timeout = 5000");
  try {
    return fn(db);
  } finally {
    db.close();
  }
};

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);

async function upload(name, buffer) {
  const res = await page.request.post(`${BASE}/admin/api/upload`, { headers: { origin: BASE }, multipart: { file: { name, mimeType: "image/png", buffer } }, timeout: 180000 });
  return res.status();
}
const mediaOf = (name) => q1("select id, status from media where original_name = ? order by id desc", name);
async function ensure(name, make) {
  if (!mediaOf(name)) await upload(name, await make());
  if (!(await waitFor(() => mediaOf(name)?.status === "ready", 180000))) throw new Error(`${name} : ${JSON.stringify(mediaOf(name))}`);
  return mediaOf(name).id;
}
const A = await ensure("34-paysage.png", () => paint(1500, 1000, 1));
const B = await ensure("34-portrait.png", () => paint(1000, 1500, 2));
const pageId = pageIdOf("personnages");
const project = q1("select slug from projects order by id limit 1")?.slug;
if (!project) throw new Error("aucun projet dans la base de test");

const img = (uid, mediaId, props = {}) => ({ uid, type: "image", props: { mediaId, width: "wide", ...props } });
const grid = (uid, ratio, children) => ({ uid, type: "grid", props: { layout: "2", gap: "normal", align: "stretch", ratio, top: "gap", children } });
function setDraft(blocks) {
  sql((db) => {
    const row = db.prepare("select title, slug, meta, nav_order from pages where id = ?").get(pageId);
    const draft = {
      title: JSON.parse(row.title),
      slug: JSON.parse(row.slug),
      meta: row.meta ? JSON.parse(row.meta) : { title: { fr: "", en: "" }, description: { fr: "", en: "" } },
      published: true,
      inMenu: row.nav_order !== null,
      accent: null,
      blocks,
    };
    db.prepare("update pages set draft = ?, draft_updated_at = unixepoch(), draft_rev = draft_rev + 1 where id = ?").run(JSON.stringify(draft), pageId);
  });
}
const draftBlocks = () => JSON.parse(sql((db) => db.prepare("select draft from pages where id = ?").get(pageId)).draft).blocks;
const find = (list, uid) => {
  for (const b of list) {
    if (b.uid === uid) return b;
    const inner = find(b.props?.children ?? [], uid);
    if (inner) return inner;
  }
  return null;
};
const lookOfDraft = (uid) => find(draftBlocks(), uid)?.props.look;

setDraft([
  img("solo", A),
  grid("gridr", "1:1", [img("ga", A), img("gb", B)]),
  grid("grida", "auto", [img("aa", A), img("ab", A)]),
  { uid: "board1", type: "project-board", props: { project } },
]);

async function canvas() {
  const handle = await page.waitForSelector("iframe.ve-frame", { timeout: 120000 });
  const fr = await handle.contentFrame();
  await fr.waitForSelector("html[data-edit-mode]", { timeout: 180000 });
  return fr;
}
async function openEditor() {
  await page.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
  const fr = await canvas();
  await sleep(2000);
  return fr;
}
async function settled() {
  await page.waitForFunction(() => !/Enregistrement/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, { timeout: 120000 });
  await sleep(500);
}

/** Style calculé de la photo d'un bloc (ou de l'emplacement `slot` d'une planche) dans le document `fr`. */
const readFrame = (fr, sel) =>
  fr.evaluate((s) => {
    // Lot 64 : le cadre est posé sur la boîte du média (MediaFrame), pas sur l'<img> qu'elle contient.
    const el0 = document.querySelector(s);
    const el = el0?.closest(".media-frame") ?? el0;
    if (!el) return null;
    const cs = getComputedStyle(el);
    // Lot 64 : taille = celle de la CASE quand il y en a une (sa taille ne dépend jamais du cadre) ; sinon (image seule) la boîte, qui grandit.
    const r = (el.closest(".media-box") ?? el).getBoundingClientRect();
    return { top: parseFloat(cs.borderTopWidth), right: parseFloat(cs.borderRightWidth), bottom: parseFloat(cs.borderBottomWidth), left: parseFloat(cs.borderLeftWidth), style: cs.borderTopStyle, color: cs.borderTopColor, w: r.width, h: r.height, box: cs.boxSizing, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  }, sel);
/** Couleur calculée d'une valeur CSS (variable du thème comprise) dans le document `fr`. */
const colorOf = (fr, css) =>
  fr.evaluate((c) => {
    const p = document.createElement("span");
    p.style.color = c;
    document.body.appendChild(p);
    const v = getComputedStyle(p).color;
    p.remove();
    return v;
  }, css);
const SOLO = '[data-edit-block="solo"] img';
const GA = '[data-edit-block="ga"] img';
const GB = '[data-edit-block="gb"] img';
const AA = '[data-edit-block="aa"] img';
const AB = '[data-edit-block="ab"] img';
const SLOT0 = '[data-edit-block="board1"] [data-edit-slot] .strip-media img';
const near = (a, b, tol = 0.6) => Math.abs(a - b) <= tol;
const uniform = (s, px, tol = 0.6) => s && near(s.top, px, tol) && near(s.right, px, tol) && near(s.bottom, px, tol) && near(s.left, px, tol);
const section = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 8).join(" "));
    await page.screenshot({ path: path.join(SHOTS, `erreur-${name}.png`) }).catch(() => {});
  }
};
async function pick(fr, uid) {
  const el = fr.locator(`[data-edit-block="${uid}"] img`).first();
  await el.scrollIntoViewIfNeeded();
  await el.click();
  await sleep(500);
}
/** Ouvre la fenêtre « Cadre » de la barre d'outils du bloc image sélectionné. */
async function openMenu(fr, uid) {
  await pick(fr, uid);
  const dlg = fr.getByRole("dialog", { name: "Cadre de la photo" });
  if (!(await dlg.isVisible().catch(() => false))) {
    // Case de grille (lot 31d) : une seule barre, celle de la case ; image seule : la barre de la rubrique.
    const tools = fr.locator('.pe-tools [data-testid="frame-button"]');
    if (await tools.count()) await tools.click();
    else await fr.locator('[data-testid="cellbar"] [data-cb="frame"]').click();
  }
  await dlg.waitFor({ timeout: 15000 });
  return dlg;
}
// Lot 62 : plus d'interrupteurs : UN choix (Aucun · Cadre du thème · Bordure). `sw` = le choix « Bordure » (ce que l'interrupteur
// « Cadre » activait), `sizeBtn` = l'épaisseur (thin/medium/thick = Fin/Moyen/Épais).
const sw = (dlg) => dlg.locator('[data-frame-kind="band"]');
const WIDTH = { thin: "fin", medium: "moyen", thick: "epais" };
const sizeBtn = (dlg, s) => dlg.locator(`[data-frame-width="${WIDTH[s]}"]`);
/** Le cadre enregistré est cette bande (épaisseur, couleur facultative), quel que soit l'ordre des clés. */
const isBand = (f, width, color) => Boolean(f) && f.kind === "band" && f.width === width && f.color === color && Object.keys(f).length === 2 + (color ? 1 : 0);

let f = await openEditor();
const base = {};
base.solo = await readFrame(f, SOLO);
base.ga = await readFrame(f, GA);
base.gb = await readFrame(f, GB);
base.aa = await readFrame(f, AA);
base.slot = await readFrame(f, SLOT0);

/* ---- I. Image seule ------------------------------------------------------------------------------------------------ */
if (run("I"))
  await section("I", async () => {
    ok("I0 aucun cadre par défaut : ni bordure, ni réglage", [base.solo, base.ga, base.gb, base.aa, base.slot].every((s) => s && s.top === 0 && s.left === 0) && !lookOfDraft("solo"), JSON.stringify(base.solo));
    const dlg = await openMenu(f, "solo");
    await page.screenshot({ path: path.join(SHOTS, "i0-menu-sans-cadre.png") });
    ok("I1 le choix « Bordure » n'est pas coché au départ : ni épaisseur ni couleur", (await sw(dlg).getAttribute("aria-checked")) === "false" && (await dlg.locator("[data-frame-width]").count()) === 0);
    await sw(dlg).click();
    ok("I2 allumé : épaisseur et couleur apparaissent, Moyen choisi", (await sw(dlg).getAttribute("aria-checked")) === "true" && (await sizeBtn(dlg, "medium").getAttribute("aria-checked")) === "true" && (await dlg.getByRole("radio", { name: "Couleur par défaut" }).getAttribute("aria-checked")) === "true");
    ok("I2 enregistré : look.frame = { kind: band, width: moyen }", await waitFor(() => isBand(lookOfDraft("solo")?.frame, "moyen"), 30000), JSON.stringify(lookOfDraft("solo")));
    const ink = await colorOf(f, "var(--t-color-ink)");
    let s;
    ok("I3 toile : bordure Moyen (3 à 6 px) dans la couleur par défaut = le texte du thème", await waitFor(async () => { s = await readFrame(f, SOLO); return s && s.top >= 3 && s.top <= 6.01 && uniform(s, s.top) && s.color === ink && s.style === "solid"; }, 30000), JSON.stringify(s) + ink);
    // Lot 79 : le cadre DÉPASSE autour de la photo. La zone intérieure (boîte moins la bordure) garde la taille de « Aucun » ; la boîte mesurée grandit de la bordure.
    ok("I3 la zone intérieure de l'image garde sa taille de « Aucun » (content-box, cadre qui dépasse), sans rien rogner", s && s.box === "content-box" && near(s.w - s.left - s.right, base.solo.w, 1) && near(s.h - s.top - s.bottom, base.solo.h, 1), `${JSON.stringify(s)} / ${JSON.stringify(base.solo)}`);
    await page.screenshot({ path: path.join(SHOTS, "i1-moyen.png") });

    await sizeBtn(dlg, "thick").click();
    ok("I4 Épais : 5 à 12 px", await waitFor(async () => { s = await readFrame(f, SOLO); return s && s.top >= 5 && s.top <= 12.01 && s.top > 6; }, 30000), JSON.stringify(s));
    ok("I4 enregistré : width epais", await waitFor(() => lookOfDraft("solo")?.frame?.width === "epais", 30000));
    const thick = s.top;
    await sizeBtn(dlg, "thin").click();
    ok("I5 Fin : 2 px", await waitFor(async () => { s = await readFrame(f, SOLO); return s && near(s.top, 2, 0.1); }, 30000), JSON.stringify(s));
    ok("I5 Fin < Moyen < Épais", s.top < thick);
    await sizeBtn(dlg, "thick").click();
    await waitFor(async () => (await readFrame(f, SOLO))?.top > 6, 30000);

    await dlg.locator('[data-frame-color="tertiary"]').click();
    const tertiary = await colorOf(f, "var(--t-color-tertiary)");
    ok("I6 pastille « Ornements » : la bordure prend la couleur du thème", await waitFor(async () => (await readFrame(f, SOLO))?.color === tertiary, 30000), `${(await readFrame(f, SOLO))?.color} / ${tertiary}`);
    ok("I6 enregistré : color tertiary (référence de palette, pas un hex)", await waitFor(() => lookOfDraft("solo")?.frame?.color === "tertiary", 30000));
    ok("I6 le nom de la couleur est dit", /Ornements/.test((await dlg.locator('[data-testid="frame-color-name"]').textContent()) ?? ""));

    await dlg.getByRole("button", { name: "Couleur personnalisée" }).click();
    const hex = f.locator('.cp input[aria-label="Code couleur"]');
    await hex.waitFor({ timeout: 20000 });
    await hex.fill("#12ab34");
    await hex.press("Enter");
    ok("I7 couleur libre #12ab34 : bordure rgb(18, 171, 52)", await waitFor(async () => (await readFrame(f, SOLO))?.color === "rgb(18, 171, 52)", 30000), (await readFrame(f, SOLO))?.color);
    ok("I7 enregistré : color #12ab34", await waitFor(() => lookOfDraft("solo")?.frame?.color === "#12ab34", 30000), JSON.stringify(lookOfDraft("solo")));
    await page.keyboard.press("Escape");
    await sleep(300);
    await page.screenshot({ path: path.join(SHOTS, "i2-epais-libre.png") });
    if (!(await dlg.isVisible().catch(() => false))) await f.locator('.pe-tools [data-testid="frame-button"]').click();
    await dlg.waitFor();
    await dlg.getByRole("radio", { name: "Couleur par défaut" }).click();
    ok("I8 « Couleur par défaut » : revient à la couleur du texte du thème, et le réglage n'a plus de couleur", await waitFor(async () => (await readFrame(f, SOLO))?.color === ink && lookOfDraft("solo")?.frame && !("color" in lookOfDraft("solo").frame), 30000), JSON.stringify(lookOfDraft("solo")));
    await dlg.locator('[data-frame-color="primary"]').click();
    await waitFor(() => lookOfDraft("solo")?.frame?.color === "primary", 30000);
  });

/* ---- G. Case de grille --------------------------------------------------------------------------------------------- */
if (run("G"))
  await section("G", async () => {
    // Grille au format imposé (1:1) : la case cadrée garde exactement la taille de sa voisine.
    const dlg = await openMenu(f, "ga");
    await sw(dlg).click();
    await sizeBtn(dlg, "thick").click();
    await dlg.locator('[data-frame-color="secondary"]').click();
    const sec = await colorOf(f, "var(--t-color-secondary)");
    let s;
    ok("G1 case de grille : bordure Épais, couleur « Accent »", await waitFor(async () => { s = await readFrame(f, GA); return s && s.top > 6 && uniform(s, s.top) && s.color === sec; }, 30000), JSON.stringify(s));
    ok("G1 enregistré sur la case : look.frame = { thick, secondary }", await waitFor(() => isBand(lookOfDraft("ga")?.frame, "epais", "secondary"), 30000), JSON.stringify(lookOfDraft("ga")));
    const nb = await readFrame(f, GB);
    ok("G2 la case cadrée garde sa taille extérieure (largeur ET hauteur avant/après)", near(s.w, base.ga.w, 0.6) && near(s.h, base.ga.h, 0.6), `${s.w}x${s.h} / avant ${base.ga.w}x${base.ga.h}`);
    ok("G2 …égale à celle de sa voisine non cadrée", near(s.w, nb.w, 0.6) && near(s.h, nb.h, 0.6), `${s.w}x${s.h} / ${nb.w}x${nb.h}`);
    ok("G2 la voisine n'a pas de cadre et n'a pas bougé", nb.top === 0 && near(nb.w, base.gb.w, 0.6) && near(nb.h, base.gb.h, 0.6));
    await f.locator('[data-edit-block="gridr"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, "g1-grille.png") });
    await page.keyboard.press("Escape");

    // Grille « Libre » : la largeur ne change pas, la hauteur varie d'une épaisseur de cadre au plus (la photo est réduite, pas rognée).
    const d2 = await openMenu(f, "aa");
    await sw(d2).click();
    await sizeBtn(d2, "thick").click();
    ok("G3 grille libre : cadre posé", await waitFor(async () => { s = await readFrame(f, AA); return s && s.top > 6; }, 30000), JSON.stringify(s));
    const nab = await readFrame(f, AB);
    ok("G3 grille libre : largeur extérieure inchangée, hauteur à 2 épaisseurs près, voisine intacte", near(s.w, base.aa.w, 0.6) && Math.abs(s.h - base.aa.h) <= 2 * s.top && nab.top === 0, `${s.w}x${s.h} / ${base.aa.w}x${base.aa.h}`);
    await page.keyboard.press("Escape");
  });

/* ---- B. Image d'une planche ---------------------------------------------------------------------------------------- */
if (run("B"))
  await section("B", async () => {
    const slot = f.locator('[data-edit-block="board1"] [data-edit-slot]').first();
    await slot.scrollIntoViewIfNeeded();
    const slug = await slot.getAttribute("data-slot-slug");
    await slot.hover();
    const bar = f.locator(".pe-slot-tools");
    await bar.waitFor({ timeout: 15000 });
    const btn = bar.locator('[data-testid="slot-frame-button"]');
    ok("B1 la barre de l'image de la planche a un bouton « Cadre »", (await btn.count()) === 1 && ((await btn.textContent()) ?? "").trim() === "Cadre");
    await btn.click();
    const dlg = f.getByRole("dialog", { name: "Cadre de la photo" });
    await dlg.waitFor({ timeout: 15000 });
    await sw(dlg).click();
    await sizeBtn(dlg, "thick").click();
    await dlg.locator('[data-frame-color="primary"]').click();
    const primary = await colorOf(f, "var(--t-color-primary)");
    let s;
    ok("B2 planche : bordure Épais dans la couleur « Boutons et liens »", await waitFor(async () => { s = await readFrame(f, SLOT0); return s && s.top >= 6 && uniform(s, s.top) && s.color === primary; }, 30000), JSON.stringify(s)); // lot 79 : plafonné à la place entre deux places de la planche (6 px)
    ok("B2 la hauteur de l'image de la bande ne change pas", near(s.h, base.slot.h, 0.6), `${s.h} / ${base.slot.h}`);
    ok("B3 enregistré dans le bloc planche : look.slotLook[slug].frame", await waitFor(() => isBand(lookOfDraft("board1")?.slotLook?.[slug]?.frame, "epais", "primary"), 30000), JSON.stringify(lookOfDraft("board1")));
    ok("B3 les autres images de la planche n'ont pas de cadre", (await f.locator('[data-edit-block="board1"] [data-edit-slot] .strip-media .media-frame').evaluateAll((l) => l.slice(1).every((i) => parseFloat(getComputedStyle(i).borderTopWidth) === 0))));
    ok("B4 la fenêtre reste ouverte et la barre de l'image avec elle", await dlg.isVisible() && (await bar.count()) === 1);
    await page.screenshot({ path: path.join(SHOTS, "b1-planche.png") });
    await page.keyboard.press("Escape");
  });

/* ---- U. Annuler, désactiver ---------------------------------------------------------------------------------------- */
if (run("U"))
  await section("U", async () => {
    await settled();
    const dlg = await openMenu(f, "gb");
    await sw(dlg).click();
    ok("U1 cadre posé sur la seconde case", await waitFor(async () => (await readFrame(f, GB))?.top > 0 && lookOfDraft("gb")?.frame, 30000));
    await page.keyboard.press("Escape");
    await settled();
    await page.locator('button[aria-label="Défaire"]').click();
    ok("U2 Annuler : le cadre disparaît de la toile et du brouillon", await waitFor(async () => (await readFrame(f, GB))?.top === 0 && !lookOfDraft("gb")?.frame, 30000), JSON.stringify(lookOfDraft("gb")));
    await page.locator('button[aria-label="Rétablir"]').click();
    ok("U3 Rétablir : il revient", await waitFor(async () => (await readFrame(f, GB))?.top > 0 && lookOfDraft("gb")?.frame, 30000));

    const d2 = await openMenu(f, "gb");
    await d2.locator('[data-frame-kind="none"]').click();
    ok("U4 « Aucun » : plus de bordure, le choix est « Aucun » (aucun cadre, ni bande ni cadre du thème)", await waitFor(async () => (await readFrame(f, GB))?.top === 0 && lookOfDraft("gb")?.frame?.kind === "none", 30000), JSON.stringify(lookOfDraft("gb")));
    const nb = await readFrame(f, GB);
    ok("U4 …et la case retrouve sa taille d'origine", near(nb.w, base.gb.w, 0.6) && near(nb.h, base.gb.h, 0.6));
    await page.keyboard.press("Escape");
  });

/* ---- P. Publication, public, téléphone ----------------------------------------------------------------------------- */
if (run("P"))
  await section("P", async () => {
    await settled();
    // L'état de la toile avant publication (parité).
    const edit = { solo: await readFrame(f, SOLO), ga: await readFrame(f, GA), gb: await readFrame(f, GB), slot: await readFrame(f, SLOT0) };
    await page.getByRole("button", { name: "Publier", exact: true }).click();
    ok("P0 page publiée", await waitFor(async () => /En ligne/.test((await page.locator(".ve-status").textContent()) ?? ""), 120000));
    const visitor = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pp = await visitor.newPage();
    pp.on("pageerror", (e) => errors.push(e.message));
    await pp.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
    const pub = {
      solo: await readFrame(pp, 'figure.block-image[data-solo] .block-image-media'),
      slot: await readFrame(pp, ".strip-rail .strip-frame .strip-media img"),
    };
    const frames = await pp.locator("figure.block-image .media-frame").evaluateAll((l) => l.map((i) => ({ w: parseFloat(getComputedStyle(i).borderTopWidth), c: getComputedStyle(i).borderTopColor, r: i.getBoundingClientRect().width })));
    const primary = await colorOf(pp, "var(--t-color-primary)");
    const secondary = await colorOf(pp, "var(--t-color-secondary)");
    ok("P1 public : l'image seule a le cadre épais, couleur « Boutons et liens »", pub.solo && pub.solo.top > 6 && uniform(pub.solo, pub.solo.top) && pub.solo.color === primary && pub.solo.style === "solid", JSON.stringify(pub.solo));
    ok("P2 public : la case de grille a le cadre épais « Accent », ses voisines n'en ont pas", frames.filter((x) => x.w > 0).length === 3 && frames.filter((x) => x.c === secondary && x.w > 6).length === 1, JSON.stringify(frames));
    ok("P3 public : l'image de la planche a le cadre épais « Boutons et liens »", pub.slot && pub.slot.top >= 6 && pub.slot.color === primary, JSON.stringify(pub.slot));
    ok("P4 parité éditeur / public : mêmes épaisseurs et couleurs (image seule, planche)", edit.solo.top > 0 && edit.slot.top > 0 && pub.slot.color === edit.slot.color && pub.solo.color === edit.solo.color, `${edit.solo.top}/${pub.solo.top} ${edit.slot.top}/${pub.slot.top}`);
    await pp.locator(".block-grid").first().scrollIntoViewIfNeeded();
    await pp.screenshot({ path: path.join(SHOTS, "p1-public-grille.png") });
    await pp.locator(".strip-rail").first().scrollIntoViewIfNeeded();
    await pp.screenshot({ path: path.join(SHOTS, "p2-public-planche.png") });
    // Visionneuse : pas de cadre.
    await pp.locator(".strip-rail .strip-frame").first().click();
    const lb = pp.locator(".lightbox img").first();
    await lb.waitFor({ timeout: 15000 });
    ok("P5 visionneuse : l'image agrandie n'a pas de cadre", parseFloat(await lb.evaluate((i) => getComputedStyle(i).borderTopWidth)) === 0);
    await pp.screenshot({ path: path.join(SHOTS, "p3-visionneuse.png") });
    await pp.keyboard.press("Escape");
    await visitor.close();

    // Téléphone.
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const mp = await phone.newPage();
    mp.on("pageerror", (e) => errors.push(e.message));
    await mp.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
    const ms = await readFrame(mp, 'figure.block-image[data-solo] .block-image-media');
    const mslot = await readFrame(mp, ".strip-rail .strip-frame .strip-media img");
    ok("P6 téléphone : cadre Épais plus mince (5 à 8 px), photo cadrée entière", ms && ms.top >= 5 && ms.top <= 8 && ms.top < pub.solo.top && mslot && mslot.top >= 5 && mslot.top <= 8, JSON.stringify([ms?.top, mslot?.top]));
    ok("P6 téléphone : aucun débordement horizontal de la page", ms.overflowX <= 0, String(ms?.overflowX));
    await mp.locator("figure.block-image[data-solo]").first().scrollIntoViewIfNeeded();
    await mp.screenshot({ path: path.join(SHOTS, "p4-telephone.png") });
    await phone.close();
  });

ok("aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `e2e-cadre34 : ${failures} échec(s)` : "e2e-cadre34 : OK");
process.exit(failures ? 1 : 0);
