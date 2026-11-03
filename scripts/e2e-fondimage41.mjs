#!/usr/bin/env node
/**
 * Lot 41 « fond derrière les images transparentes » (chromium, serveur requis, base neuve, une connexion admin). Un PNG détouré
 * (alpha) est posé partout où une image s'affiche ; le test MESURE UN PIXEL transparent dans une capture (couleur de la page par
 * défaut, puis le fond choisi), sur la toile ET en public.
 *  D  Défaut : aucun réglage, aucun attribut, pixel transparent = couleur de la page, partout (image seule, cases de grille,
 *     image de la bande, carrousel, image de planche).
 *  I  Image seule : « Fond image » dans la barre ; Blanc, Couleur de la carte, pastille de la palette, couleur libre, Aucun ;
 *     enregistré dans `look.imageBg` ; Annuler.
 *  G  Case de grille : « Fond image » dans la barre de la case ; « Dans la case » : toute la case est colorée, la taille ne change pas.
 *  B  Image de la bande du projet et d'un carrousel : bouton de la barre de l'image, enregistré dans `look.slotLook[slug].bg` (par emplacement).
 *  K  Image d'une planche composée : bouton de la barre du composant, enregistré dans `props.look.imageBg`.
 *  N  Panneau : le fond se règle aussi en haut du panneau de l'image.
 *  U  Une seule fenêtre ouverte à la fois (Cadre / Fond image).
 *  P  Publication : mêmes pixels en public, aucun repère d'édition.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=D,I,G,B,K,N,U,P] [SHOTS=dossier] node scripts/e2e-fondimage41.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";
import sharp from "sharp";

import { paint } from "./lib/crop-fixtures.mjs";
import { login, pageIdOf, q1, waitFor } from "./lib/medias-setup.mjs";

const BASE = process.env.BASE ?? "http://localhost:3550";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? (process.env.DATA_DIR ? path.join(process.env.DATA_DIR, "..", "shots-fondimage41") : path.join(tmpdir(), "e2e-fondimage41"));
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

/** PNG détouré : transparent partout (alpha 0), sauf un disque rouge au centre. Les coins sont donc transparents. */
async function cutout() {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><circle cx="600" cy="400" r="280" fill="rgb(200,30,30)"/></svg>');
  return sharp({ create: { width: 1200, height: 800, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: svg }])
    .png()
    .toBuffer();
}
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
const PNG = await ensure("41-detoure.png", cutout);
const OTHER = await ensure("41-paysage.png", () => paint(1500, 1000, 1));
const pageId = pageIdOf("personnages");
const PROJECT = q1("select id, slug from projects order by id limit 1");
if (!PROJECT) throw new Error("aucun projet dans la base de test");
const project = PROJECT.slug;

// La première image de la bande du projet est le PNG détouré ; la planche compose : bande, image, carrousel à liste propre.
sql((db) => {
  const slot = db.prepare("select id from slots where project_id = ? and media_id is not null and video_id is null order by position, id limit 1").get(PROJECT.id);
  db.prepare("update slots set media_id = ?, aspect = 1.5 where id = ?").run(PNG, slot.id);
  db.prepare("update projects set layout = ?, draft_layout = null, draft_layout_page_id = null where id = ?").run(
    JSON.stringify([
      { uid: "kstrip", type: "strip", props: {} },
      { uid: "kimg", type: "image", props: { mediaId: PNG } },
      { uid: "kcar", type: "strip", props: { source: "own", media: [PNG, OTHER] } },
    ]),
    PROJECT.id,
  );
});

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
/** Lot 75 : un champ d'habillage des places (`look.slotLook[slug][champ]`) sous l'ancienne forme « carte par slug » (undefined sans réglage). */
const slotMap = (look, field) => {
  const m = Object.fromEntries(Object.entries(look?.slotLook ?? {}).filter(([, v]) => v[field] !== undefined).map(([k, v]) => [k, v[field]]));
  return Object.keys(m).length ? m : undefined;
};
const layoutNow = () => {
  const r = sql((db) => db.prepare("select layout, draft_layout from projects where id = ?").get(PROJECT.id));
  return JSON.parse(r.draft_layout ?? r.layout);
};

setDraft([
  img("solo", PNG),
  // Grille carrée : une case remplie (cover), une case « Image entière » (bandes vides en haut et en bas de la case).
  grid("gridr", "1:1", [img("ga", PNG), img("gb", PNG, { fit: "contain" })]),
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
  await sleep(2500);
  return fr;
}
async function settled() {
  await page.waitForFunction(() => !/Enregistrement/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, { timeout: 120000 });
  await sleep(500);
}
const colorOf = (fr, css) =>
  fr.evaluate((c) => {
    const p = document.createElement("span");
    p.style.color = c;
    document.body.appendChild(p);
    const v = getComputedStyle(p).color;
    p.remove();
    return v;
  }, css);
const rgb = (s) => (/rgba?\((\d+), (\d+), (\d+)/.exec(s) ?? []).slice(1, 4).map(Number);
/**
 * Rend visible la zone mesurée : masque (visibility) tout ce qui recouvre l'image aux deux points mesurés — barres, fenêtres et
 * notifications de l'éditeur, dans la toile comme dans la page qui la contient — le temps d'une capture. Rend la fonction qui restaure.
 */
async function clearView(loc, frameEl) {
  const mask = (els) => els.forEach((el) => { el.dataset.pxPrev = el.style.visibility; el.style.setProperty("visibility", "hidden", "important"); });
  const inner = await loc.evaluate((img) => {
    const r = img.getBoundingClientRect();
    const pts = [[r.left + 24, r.bottom - 25], [r.right - 25, r.bottom - 25]];
    const over = [];
    for (const [x, y] of pts) for (const el of document.elementsFromPoint(x, y)) { if (el === img) break; if (!el.contains(img)) over.push(el); }
    over.forEach((el) => { el.dataset.pxPrev = el.style.visibility; el.style.setProperty("visibility", "hidden", "important"); });
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
  let outer = false;
  if (frameEl) {
    const fb = await frameEl.boundingBox();
    outer = await page.evaluate(({ fb, inner }) => {
      const pts = [[fb.x + inner.x + 24, fb.y + inner.y + inner.h - 25], [fb.x + inner.x + inner.w - 25, fb.y + inner.y + inner.h - 25]];
      let n = 0;
      for (const [x, y] of pts) for (const el of document.elementsFromPoint(x, y)) { if (el.tagName === "IFRAME") break; el.dataset.pxPrev = el.style.visibility; el.style.setProperty("visibility", "hidden", "important"); n++; }
      return n > 0;
    }, { fb, inner });
  }
  return async () => {
    const un = () => document.querySelectorAll("[data-px-prev]").forEach((el) => { el.style.visibility = el.dataset.pxPrev; delete el.dataset.pxPrev; if (!el.getAttribute("style")) el.removeAttribute("style"); });
    await loc.evaluate(un).catch(() => {});
    if (outer) await page.evaluate(un).catch(() => {});
  };
}
/** Deux pixels de l'élément, mesurés dans une capture, près des coins BAS de la boîte de l'image (transparents dans le PNG ; à 24 px du bord pour rester dans l'arrondi). */
async function pixel(frame, selector) {
  const loc = frame.locator(selector).first();
  await loc.scrollIntoViewIfNeeded();
  await loc.evaluate((i) => (i.decode ? i.decode().catch(() => {}) : null));
  await sleep(250);
  const restore = await clearView(loc, frame === f ? await page.$("iframe.ve-frame") : null);
  try {
    const buf = await loc.screenshot();
    const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const at = (x, y) => [0, 1, 2].map((c) => data[(y * info.width + x) * info.channels + c]);
    return { px: at(24, info.height - 25), px2: at(info.width - 25, info.height - 25), w: info.width, h: info.height };
  } finally {
    await restore();
  }
}
const close = (a, b, tol = 12) => a.length === 3 && b.length === 3 && a.every((v, i) => Math.abs(v - b[i]) <= tol);
/** Le pixel mesuré a la couleur CSS attendue (calculée dans le même document). */
async function isColor(frame, selector, css, tol = 12) {
  const want = rgb(await colorOf(frame, css));
  let m;
  const good = await waitFor(async () => {
    m = await pixel(frame, selector);
    return close(m.px, want, tol) && close(m.px2, want, tol);
  }, 20000);
  return { good, m, want };
}

const SOLO = '[data-edit-block="solo"] img';
const GA = '[data-edit-block="ga"] img';
const GB = '[data-edit-block="gb"] img';
const SLOT0 = '[data-edit-block="board1"] [data-edit-rail=""] > [data-edit-slot] .strip-media img';
const CAR0 = '[data-edit-block="board1"] [data-edit-rail="kcar"] > [data-edit-slot] .strip-media img';
const BOARDIMG = '[data-edit-block="board1"] [data-edit-bitem] figure.block-image .block-image-media';
const section = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    const mutations = await page.frames().find((x) => x !== page.mainFrame())?.evaluate(() => new Promise((res) => { let n = 0; const mo = new MutationObserver((l) => { n += l.length; }); mo.observe(document.body, { subtree: true, childList: true, attributes: true }); setTimeout(() => { mo.disconnect(); res(n); }, 1500); })).catch(() => "?");
    ok(`${name} : exception inattendue`, false, `${String(e.message).split("\n").slice(0, 8).join(" ")} [mutations du DOM en 1,5 s : ${mutations}]`);
    await page.screenshot({ path: path.join(SHOTS, `erreur-${name}.png`) }).catch(() => {});
  }
};
async function pick(fr, uid) {
  const el = fr.locator(`[data-edit-block="${uid}"] img`).first();
  await el.scrollIntoViewIfNeeded();
  await el.click();
  await sleep(500);
}
const DLG = (fr) => fr.getByRole("dialog", { name: "Fond de l'image" });
/** Ouvre la fenêtre « Fond de l'image » de l'image seule (barre de la rubrique) ou de la case (barre de la case). */
async function openBg(fr, uid) {
  await pick(fr, uid);
  const dlg = DLG(fr);
  if (!(await dlg.isVisible().catch(() => false))) {
    const tools = fr.locator('.pe-tools [data-testid="imgbg-button"]');
    if (await tools.count()) await tools.click();
    else await fr.locator('[data-testid="cellbar"] [data-cb="imgbg"]').click();
  }
  await dlg.waitFor({ timeout: 15000 });
  return dlg;
}
const choose = (dlg, key) => dlg.locator(`[data-imgbg="${key}"]`).click();

let f = await openEditor();
const WHITE = "rgb(255, 255, 255)";

/* ---- D. Défaut ----------------------------------------------------------------------------------------------------- */
if (run("D"))
  await section("D", async () => {
    for (const [name, sel] of [["image seule", SOLO], ["case remplie", GA], ["case « image entière »", GB], ["bande du projet", SLOT0], ["carrousel", CAR0], ["image de planche", BOARDIMG]]) {
      const r = await isColor(f, sel, "var(--t-color-bg)");
      ok(`D1 ${name} : par défaut, le pixel transparent a la couleur de la page`, r.good, JSON.stringify([r.m?.px, r.m?.px2, r.want]));
    }
    ok("D2 aucun réglage de fond dans le brouillon, aucun attribut sur la toile", !lookOfDraft("solo") && !lookOfDraft("ga") && !lookOfDraft("gb") && !lookOfDraft("board1") && (await f.locator("[data-img-bg]").count()) === 0);
    await f.locator('[data-edit-block="solo"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, "01-sans-fond-toile.png") });
  });

/* ---- I. Image seule ------------------------------------------------------------------------------------------------ */
if (run("I"))
  await section("I", async () => {
    const dlg = await openBg(f, "solo");
    await page.screenshot({ path: path.join(SHOTS, "02-fenetre-choix.png") });
    ok("I1 la fenêtre propose Aucun / Blanc / Couleur de la carte / Couleur…, « Aucun » choisi", (await dlg.locator('[data-imgbg="none"]').getAttribute("aria-checked")) === "true" && (await dlg.locator("[data-imgbg]").allTextContents()).join("|") === "Aucun|Blanc|Couleur de la carte" && (await dlg.getByText("Couleur…").count()) === 1);
    await choose(dlg, "white");
    ok("I2 Blanc : enregistré dans look.imageBg (#ffffff)", await waitFor(() => lookOfDraft("solo")?.imageBg === "#ffffff", 30000), JSON.stringify(lookOfDraft("solo")));
    let r = await isColor(f, SOLO, WHITE, 3);
    ok("I2 Blanc : le pixel transparent est blanc sur la toile", r.good, JSON.stringify(r.m));
    await page.screenshot({ path: path.join(SHOTS, "03-blanc-toile.png") });
    await choose(dlg, "card");
    ok("I3 Couleur de la carte : look.imageBg = card", await waitFor(() => lookOfDraft("solo")?.imageBg === "card", 30000));
    r = await isColor(f, SOLO, "var(--t-color-surface)");
    ok("I3 …et le pixel a la couleur des cartes du thème", r.good, JSON.stringify([r.m?.px, r.want]));
    await dlg.locator('[data-imgbg-color="primary"]').click();
    ok("I4 pastille de la palette : look.imageBg = primary (une référence de palette, pas un hex)", await waitFor(() => lookOfDraft("solo")?.imageBg === "primary", 30000));
    r = await isColor(f, SOLO, "var(--t-color-primary)");
    ok("I4 …et le pixel a la couleur « Boutons et liens » du thème", r.good, JSON.stringify([r.m?.px, r.want]));
    await dlg.getByRole("button", { name: "Couleur personnalisée" }).click();
    const hex = f.locator('.cp input[aria-label="Code couleur"]');
    await hex.waitFor({ timeout: 20000 });
    await hex.fill("#336699");
    await hex.press("Enter");
    ok("I5 couleur libre #336699 enregistrée", await waitFor(() => lookOfDraft("solo")?.imageBg === "#336699", 30000), JSON.stringify(lookOfDraft("solo")));
    r = await isColor(f, SOLO, "#336699", 3);
    ok("I5 …et le pixel mesuré est rgb(51, 102, 153)", r.good, JSON.stringify(r.m));
    await page.keyboard.press("Escape");
    await sleep(300);
    await page.screenshot({ path: path.join(SHOTS, "04-couleur-libre-toile.png") });
    ok("I6 l'échantillon carré du bouton « Fond image » montre la couleur choisie (lot 90 : plus de pastille ronde)", await f.locator('.pe-tools [data-testid="imgbg-button"] .sm-swatch').evaluate((d) => getComputedStyle(d).backgroundColor === "rgb(51, 102, 153)" && parseFloat(getComputedStyle(d).borderTopLeftRadius) < 6));
    await settled();
    // Annuler : le dernier réglage est défait (les réglages d'un même bloc rapprochés peuvent former un seul pas d'historique).
    await page.locator('button[aria-label="Défaire"]').click();
    ok("I7 Annuler : le fond libre est retiré", await waitFor(() => lookOfDraft("solo")?.imageBg !== "#336699", 30000), JSON.stringify(lookOfDraft("solo")));
    const undone = await pixel(f, SOLO);
    ok("I7 …le pixel suit le brouillon (plus le bleu libre)", !close(undone.px, [51, 102, 153], 3), JSON.stringify(undone));
    await page.locator('button[aria-label="Rétablir"]').click();
    ok("I7 Rétablir : le fond libre revient", await waitFor(() => lookOfDraft("solo")?.imageBg === "#336699", 30000));
    const d2 = await openBg(f, "solo");
    await choose(d2, "none");
    ok("I8 Aucun : le réglage disparaît (look retiré), le pixel redevient celui de la page", await waitFor(() => lookOfDraft("solo") === undefined, 30000), JSON.stringify(lookOfDraft("solo")));
    r = await isColor(f, SOLO, "var(--t-color-bg)");
    ok("I8 …transparent à nouveau", r.good, JSON.stringify(r.m));
    await choose(d2, "white");
    await waitFor(() => lookOfDraft("solo")?.imageBg === "#ffffff", 30000);
    await page.keyboard.press("Escape");
  });

/* ---- G. Case de grille --------------------------------------------------------------------------------------------- */
if (run("G"))
  await section("G", async () => {
    await settled();
    const before = await pixel(f, GB);
    const dlg = await openBg(f, "gb");
    await choose(dlg, "card");
    ok("G1 case « Image entière » : look.imageBg = card enregistré sur la case", await waitFor(() => lookOfDraft("gb")?.imageBg === "card", 30000), JSON.stringify(lookOfDraft("gb")));
    const r = await isColor(f, GB, "var(--t-color-surface)");
    ok("G1 …et toute la case est colorée, bandes vides comprises (les deux coins opposés)", r.good, JSON.stringify([r.m?.px, r.m?.px2, r.want]));
    ok("G1 la taille de la case ne change pas", r.m.w === before.w && r.m.h === before.h, `${r.m.w}x${r.m.h} / ${before.w}x${before.h}`);
    const ra = await isColor(f, GA, "var(--t-color-bg)");
    ok("G2 la case voisine n'a pas de fond (transparente)", ra.good && !lookOfDraft("ga"), JSON.stringify(ra.m));
    await page.keyboard.press("Escape");
    const d2 = await openBg(f, "ga");
    await choose(d2, "white");
    ok("G3 case remplie : Blanc, le coin de la case est blanc", (await waitFor(() => lookOfDraft("ga")?.imageBg === "#ffffff", 30000)) && (await isColor(f, GA, WHITE, 3)).good);
    await f.locator('[data-edit-block="gridr"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, "05-grille-toile.png") });
    await page.keyboard.press("Escape");
    await choose(await openBg(f, "ga"), "none");
    ok("G4 Aucun sur la case remplie : réglage retiré", await waitFor(() => lookOfDraft("ga") === undefined, 30000));
    await page.keyboard.press("Escape");
  });

/* ---- B. Image de la bande et d'un carrousel ------------------------------------------------------------------------ */
async function slotBar(fr, railSel) {
  const slot = fr.locator(`[data-edit-block="board1"] ${railSel} > [data-edit-slot]`).first();
  for (let i = 0; i < 4; i++) {
    try {
      await slot.scrollIntoViewIfNeeded({ timeout: 8000 });
      break;
    } catch (e) {
      if (i === 3) throw e;
      await sleep(1500);
    }
  }
  await slot.hover();
  const bar = fr.locator(".pe-slot-tools");
  await bar.waitFor({ timeout: 15000 });
  const slug = await slot.getAttribute("data-slot-slug");
  await bar.locator('[data-testid="slot-imgbg-button"]').click();
  const dlg = DLG(fr);
  await dlg.waitFor({ timeout: 15000 });
  return { dlg, slug };
}
const slotBg = () => slotMap(lookOfDraft("board1"), "bg");
if (run("B"))
  await section("B", async () => {
    await settled();
    let { dlg, slug } = await slotBar(f, '[data-edit-rail=""]');
    ok("B1 le bouton « Fond image » est dans la barre de l'image de la bande", true);
    await choose(dlg, "white");
    ok("B2 bande du projet : look.slotLook[slug].bg = #ffffff", await waitFor(() => slotBg()?.[slug] === "#ffffff", 30000), JSON.stringify(lookOfDraft("board1")));
    let r = await isColor(f, SLOT0, WHITE, 3);
    ok("B2 …et le pixel transparent de l'image est blanc", r.good, JSON.stringify(r.m));
    ok("B2 les autres images de la bande n'ont pas de fond", await f.locator('[data-edit-block="board1"] [data-edit-rail=""] > [data-edit-slot]').evaluateAll((l) => l.slice(1).every((e) => !e.hasAttribute("data-img-bg") && !e.querySelector("[data-img-bg]"))));
    await page.screenshot({ path: path.join(SHOTS, "06-bande-blanc-toile.png") });
    await page.keyboard.press("Escape");
    await sleep(300);
    ({ dlg, slug: slug } = await slotBar(f, '[data-edit-rail="kcar"]'));
    const carSlug = slug;
    await dlg.locator('[data-imgbg-color="secondary"]').click();
    ok("B3 carrousel : look.slotLook[slug].bg = secondary, séparé de la bande", await waitFor(() => slotBg()?.[carSlug] === "secondary" && Object.keys(slotBg()).length === 2, 30000), JSON.stringify(slotBg()));
    r = await isColor(f, CAR0, "var(--t-color-secondary)");
    ok("B3 …et le pixel du carrousel a la couleur « Accent » du thème", r.good, JSON.stringify([r.m?.px, r.want]));
    await page.keyboard.press("Escape");
    await settled();
    await page.locator('button[aria-label="Défaire"]').click();
    ok("B4 Annuler : le fond du carrousel est retiré", await waitFor(() => !slotBg() || slotBg()[carSlug] !== "secondary", 30000), JSON.stringify(slotBg()));
    await page.locator('button[aria-label="Rétablir"]').click();
    await waitFor(() => slotBg()?.[carSlug] === "secondary", 30000);
    ({ dlg, slug } = await slotBar(f, '[data-edit-rail=""]'));
    await choose(dlg, "card");
    await waitFor(() => slotBg()?.[slug] === "card", 30000);
    await page.keyboard.press("Escape");
  });

/* ---- K. Image d'une planche composée ------------------------------------------------------------------------------- */
if (run("K"))
  await section("K", async () => {
    await settled();
    const board = f.locator(`[data-edit-board="${PROJECT.id}"]`).first();
    await board.scrollIntoViewIfNeeded();
    const fr = board.locator("[data-edit-bitem]").nth(1);
    await fr.scrollIntoViewIfNeeded();
    await fr.hover();
    ok("K0 la bande n'a pas de bouton « Fond image » (seules les images en ont un)", (await board.locator("[data-edit-bitem]").nth(0).locator('[data-edit-bitem-op="imgbg"]').count()) === 0);
    await fr.locator('[data-edit-bitem-op="imgbg"]').click();
    const dlg = DLG(f);
    await dlg.waitFor({ timeout: 20000 });
    await choose(dlg, "white");
    ok("K1 image de planche : props.look.imageBg = #ffffff dans la suite du projet", await waitFor(() => layoutNow()[1]?.props?.look?.imageBg === "#ffffff", 30000), JSON.stringify(layoutNow()[1]));
    const sel = `[data-edit-board="${PROJECT.id}"] [data-edit-bitem] figure.block-image .block-image-media`;
    const r = await isColor(f, sel, WHITE, 3);
    ok("K1 …et le pixel transparent de l'image est blanc sur la toile", r.good, JSON.stringify(r.m));
    await page.screenshot({ path: path.join(SHOTS, "07-image-planche-toile.png") });
    await page.keyboard.press("Escape");
    await settled();
    await page.keyboard.press("Control+z");
    ok("K2 Annuler (planche) : le fond disparaît", await waitFor(() => layoutNow()[1]?.props?.look === undefined, 30000), JSON.stringify(layoutNow()[1]));
    await page.locator('button[aria-label="Rétablir"]').click();
    ok("K2 Rétablir : le fond revient", await waitFor(() => layoutNow()[1]?.props?.look?.imageBg === "#ffffff", 30000), JSON.stringify(layoutNow()[1]));
  });

/* ---- N. Panneau ---------------------------------------------------------------------------------------------------- */
if (run("N"))
  await section("N", async () => {
    await settled();
    await pick(f, "solo");
    const pan = page.locator('[data-testid="panel-imgbg"]');
    await pan.waitFor({ timeout: 20000 });
    ok("N1 le panneau de l'image montre « Fond de l'image »", (await pan.getByText("Fond de l'image").count()) >= 1);
    const first = await pan.evaluate((p) => {
      const lab = p.parentElement?.querySelector(".a-field, label:not(.sm-label)");
      return lab ? Boolean(p.compareDocumentPosition(lab) & Node.DOCUMENT_POSITION_FOLLOWING) : null;
    });
    ok("N1 …et il est placé AVANT les réglages de l'image", first === true, String(first));
    await pan.locator('[data-imgbg="card"]').click();
    ok("N2 panneau : « Couleur de la carte » enregistré dans look.imageBg", await waitFor(() => lookOfDraft("solo")?.imageBg === "card", 30000), JSON.stringify(lookOfDraft("solo")));
    const r = await isColor(f, SOLO, "var(--t-color-surface)");
    ok("N2 …et la toile le montre", r.good, JSON.stringify(r.m));
    await page.screenshot({ path: path.join(SHOTS, "08-panneau.png") });
    await pan.locator('[data-imgbg="white"]').click();
    await waitFor(() => lookOfDraft("solo")?.imageBg === "#ffffff", 30000);
  });

/* ---- U. Une seule fenêtre à la fois -------------------------------------------------------------------------------- */
if (run("U"))
  await section("U", async () => {
    await settled();
    const dlg = await openBg(f, "solo");
    await f.locator('.pe-tools [data-testid="frame-button"]').click();
    const frame = f.getByRole("dialog", { name: "Cadre de la photo" });
    await frame.waitFor({ timeout: 15000 });
    ok("U1 ouvrir « Cadre » ferme « Fond de l'image »", !(await dlg.isVisible().catch(() => false)));
    await f.locator('.pe-tools [data-testid="imgbg-button"]').click();
    await dlg.waitFor({ timeout: 15000 });
    ok("U2 ouvrir « Fond image » ferme « Cadre »", !(await frame.isVisible().catch(() => false)));
    await page.keyboard.press("Escape");
  });

/* ---- P. Publication, public ---------------------------------------------------------------------------------------- */
if (run("P"))
  await section("P", async () => {
    await settled();
    // État final voulu : image seule blanche, case « image entière » = carte, case remplie sans fond, bande = carte (B), carrousel = accent, image de planche = blanche.
    const want = { solo: lookOfDraft("solo")?.imageBg, gb: lookOfDraft("gb")?.imageBg, ga: lookOfDraft("ga")?.imageBg };
    await page.getByRole("button", { name: "Publier", exact: true }).click();
    ok("P0 page publiée", await waitFor(async () => /En ligne/.test((await page.locator(".ve-status").textContent()) ?? ""), 120000));
    const pp = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    pp.on("pageerror", (e) => errors.push(e.message));
    await pp.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
    const solo = "figure.block-image[data-solo] .block-image-media";
    const media = pp.locator("figure.block-image .block-image-media");
    ok("P1 public : cinq images (seule, 2 cases, image de planche, …)", (await media.count()) >= 4, String(await media.count()));
    const px = async (loc, css, tol = 12) => {
      const want = rgb(await colorOf(pp, css));
      await loc.scrollIntoViewIfNeeded();
      await loc.evaluate((i) => (i.decode ? i.decode().catch(() => {}) : null));
      let m;
      const good = await waitFor(async () => {
        const restore = await clearView(loc, null);
        try {
          const buf = await loc.screenshot();
          const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
          const at = (x, y) => [0, 1, 2].map((c) => data[(y * info.width + x) * info.channels + c]);
          m = { a: at(24, info.height - 25), b: at(info.width - 25, info.height - 25) };
        } finally {
          await restore();
        }
        return close(m.a, want, tol) && close(m.b, want, tol);
      }, 20000);
      return { good, m, want };
    };
    let r = await px(pp.locator(solo).first(), want.solo === "#ffffff" ? WHITE : "var(--t-color-surface)", 3);
    ok("P2 public : image seule, même fond que sur la toile", r.good, JSON.stringify(r));
    await pp.locator(solo).first().scrollIntoViewIfNeeded();
    await pp.screenshot({ path: path.join(SHOTS, "09-public-image-seule.png") });
    r = await px(pp.locator('figure.block-image:not([data-solo]) .block-image-media').nth(1), want.gb === "card" ? "var(--t-color-surface)" : WHITE);
    ok("P3 public : case « Image entière », toute la case colorée", r.good, JSON.stringify(r));
    r = await px(pp.locator('figure.block-image:not([data-solo]) .block-image-media').nth(0), want.ga === "#ffffff" ? WHITE : "var(--t-color-bg)");
    ok("P4 public : case voisine, par défaut transparente = couleur de la page", r.good, JSON.stringify(r));
    await pp.locator("figure.block-image:not([data-solo])").first().scrollIntoViewIfNeeded();
    await pp.screenshot({ path: path.join(SHOTS, "10-public-grille.png") });
    r = await px(pp.locator(".strip-rail").nth(0).locator(".strip-frame .strip-media img").first(), "var(--t-color-surface)");
    ok("P5 public : image de la bande, couleur des cartes", r.good, JSON.stringify(r));
    r = await px(pp.locator(".strip-rail").nth(1).locator(".strip-frame .strip-media img").first(), "var(--t-color-secondary)");
    ok("P6 public : image du carrousel, couleur « Accent »", r.good, JSON.stringify(r));
    r = await px(pp.locator('[aria-labelledby="project-' + project + '"] figure.block-image .block-image-media').first(), WHITE, 3);
    ok("P7 public : image de la planche composée, blanche", r.good, JSON.stringify(r));
    await pp.locator(".strip-rail").first().scrollIntoViewIfNeeded();
    await pp.screenshot({ path: path.join(SHOTS, "11-public-planche.png") });
    ok("P8 public : aucun repère d'édition", (await pp.locator("[data-edit-block], [data-edit-slot]").count()) === 0);
    // Cache de la page publique : la première image de la bande sans fond de la planche n'a pas de data-img-bg.
    ok("P9 public : seules les images réglées portent data-img-bg", (await pp.locator("[data-img-bg]").count()) >= 5);
    await pp.context().close();
  });

ok("aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `e2e-fondimage41 : ${failures} échec(s)` : "e2e-fondimage41 : OK");
process.exit(failures ? 1 : 0);
