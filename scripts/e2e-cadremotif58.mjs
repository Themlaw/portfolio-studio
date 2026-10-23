#!/usr/bin/env node
/**
 * Lot 58 « cadre du kit en 9 parties qui se répètent » (ticket 44). Chromium, serveur requis, base neuve.
 *  CA  Option A (cadre complet) : revue (aperçu sur 3 formats), cadre appliqué ; en public les coins sont identiques sur un carré, un
 *      panorama et un portrait (au pixel), les côtés RÉPÈTENT le motif (et ne s'étirent pas), l'épaisseur se réduit sur téléphone ;
 *      captures avant (stretch) / après (round) sur un panorama et une vignette.
 *  CB  Option B (un coin + un côté) : la revue le dit, le cadre est fabriqué par rotation (coins et côtés aux 4 bords).
 *  CS  Lot 62 : le cadre du kit n'est posé que sur le choix « Cadre du thème » (public ET toile) ; une photo sans choix n'en a pas, « Aucun » non plus ;
 *      le bouton Cadre propose « Aucun · Cadre du thème · Bande de couleur ».
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=CA,CB,CS] [SHOTS=dossier] node scripts/e2e-cadremotif58.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";
import sharp from "sharp";

import { login, pageIdOf, q1, waitFor } from "./lib/medias-setup.mjs";

const BASE = process.env.BASE ?? "http://localhost:3340";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(tmpdir(), "e2e-cadremotif58");
const DATA = process.env.DATA_DIR ?? "data";
const DB = path.join(DATA, "portfolio.db");
mkdirSync(SHOTS, { recursive: true });
sharp.cache(false);
sharp.concurrency(1);

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const info = (label, v) => console.log(`INFO ${label} : ${typeof v === "string" ? v : JSON.stringify(v)}`);
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
page.setDefaultTimeout(60000);
page.setDefaultNavigationTimeout(180000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);

async function canvas() {
  const handle = await page.waitForSelector("iframe.ve-frame", { timeout: 120000 });
  const fr = await handle.contentFrame();
  await fr.waitForSelector("html[data-edit-mode]", { timeout: 180000 });
  return fr;
}
const section = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 8).join(" "));
    await page.screenshot({ path: path.join(SHOTS, `erreur-${name}.png`) }).catch(() => {});
  }
};

async function publishBlocks(pg, base, pageId, blocks, done, timeout = 240000) {
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
  await pg.goto(`${base}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
  await canvas();
  await sleep(1500);
  await pg.getByRole("button", { name: "Publier", exact: true }).click();
  const ok2 = await waitFor(() => done(), timeout);
  await sleep(800);
  return ok2;
}

const DIR = path.join(tmpdir(), "e2e-cadremotif58-kit");
mkdirSync(DIR, { recursive: true });

/** Exporte le kit de Studio (une fois). */
let kitZip = null;
async function exportKit() {
  if (kitZip) return kitZip;
  const kitUrl = `${BASE}/admin/api/theme-kit/studio`;
  let ready = false;
  for (let i = 0; i < 90 && !ready; i++) {
    const res = await page.request.post(kitUrl, { headers: { origin: BASE } });
    ready = (await res.json()).ready === true;
    if (!ready) await sleep(2000);
  }
  ok("0 export du kit de Studio prêt", ready);
  kitZip = path.join(DIR, "kit-studio.zip");
  writeFileSync(kitZip, await (await page.request.get(kitUrl)).body());
  return kitZip;
}

/** Retour simulé (cadre58a / cadre58b), revue, application, mise en ligne. Renvoie la carte « cadre » de la revue. */
async function importFrame(cmd, tag) {
  const edited = path.join(DIR, `retour-${cmd}.zip`);
  execFileSync(process.execPath, ["--import", "tsx", "scripts/kit-poc/simulate-multi.mts", cmd, await exportKit(), edited], { stdio: "inherit" });
  await page.goto(`${BASE}/admin/themes/studio/kit`, { waitUntil: "networkidle" });
  await page.setInputFiles('[data-testid="kit-file"]', edited);
  await page.waitForURL(/\/kit\?import=/, { timeout: 180000 });
  await page.locator(".a-kit-card").nth(0).waitFor({ timeout: 240000 });
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => [...document.querySelectorAll(".a-kit-card img")].every((i) => i.complete), null, { timeout: 30000 });
  await page.screenshot({ path: path.join(SHOTS, `revue-${tag}.png`), fullPage: true });
  const cad = await page.$$eval('.a-kit-card[data-slot="cadre"]', (els) => els.map((e) => ({ change: e.dataset.change, status: e.dataset.status, msgs: [...e.querySelectorAll("li")].map((l) => l.textContent), imgs: [...e.querySelectorAll("img")].map((i) => ({ alt: i.alt, w: i.naturalWidth, h: i.naturalHeight })) })));
  // Lot 60 : le kit crée une nouvelle VERSION de Mon thème (brouillon) ; on la publie ensuite depuis l'écran Thèmes.
  await Promise.all([page.waitForURL(/\/admin\/themes\?nouvelle=\d+&via=kit/, { timeout: 60000 }), page.getByRole("button", { name: /^Appliquer à mon thème/ }).click()]);
  const draftId = sql((db) => db.prepare("select id from themes where mine = 1").get()).id;
  await page.getByTestId("mine-publish").click();
  await page.locator("dialog[open]").getByRole("button", { name: "Publier", exact: true }).click();
  await page.locator("dialog[open]").waitFor({ state: "detached" });
  await sleep(1500);
  return { card: cad[0], draftId };
}

const SIZES = { carre: [300, 300], panorama: [1200, 300], portrait: [225, 300], vignette: [90, 90] };
/** Pose dans la page publique des photos de tailles connues (même structure que l'image seule : le CSS du thème s'y applique). */
async function injectBoxes(pg, stretch = false) {
  await pg.evaluate(
    ([sizes, stretchOld]) => {
      document.getElementById("e58")?.remove();
      const root = document.createElement("div");
      root.id = "e58";
      root.style.cssText = "position:absolute;left:0;top:0;z-index:99999;background:#f5f1e8;padding:16px;display:flex;flex-direction:column;gap:16px;align-items:flex-start";
      for (const [k, [w, h]] of Object.entries(sizes)) {
        const fig = document.createElement("figure");
        fig.className = "block-image";
        fig.style.margin = "0";
        const m = document.createElement("div");
        // Lot 64 : la boîte du média (MediaFrame) porte le cadre. Lot 62 : le cadre du thème n'est posé que sur le choix « Cadre du thème » (ou le réglage du site), ici le choix de la photo.
        m.className = "media-frame";
        m.dataset.frame = "theme";
        m.dataset.kind = "image";
        m.dataset.k = k;
        m.style.cssText = `width:${w}px;height:${h}px;background:#9aa7ad;display:block`;
        fig.appendChild(m);
        root.appendChild(fig);
      }
      document.body.appendChild(root);
      if (stretchOld) {
        const st = document.createElement("style");
        st.id = "e58-old";
        st.textContent = "#e58 .media-frame{border-image-repeat:stretch !important}";
        document.head.appendChild(st);
      }
    },
    [SIZES, stretch],
  );
  await pg.waitForTimeout(600);
}
async function shotBox(pg, k) {
  return pg.locator(`#e58 [data-k="${k}"]`).screenshot();
}
async function raw(buf) {
  const { data, info: i } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  return { data, w: i.width, h: i.height, c: i.channels };
}
const pxAt = (r, x, y) => [...r.data.subarray((y * r.w + x) * r.c, (y * r.w + x) * r.c + 3)];
/** Alternances bleu / jaune le long du bord du haut, à mi-épaisseur du bord. */
function runsTop(r, border) {
  let n = 1;
  let prev = null;
  const y = Math.floor(border / 2);
  let count = 0;
  for (let x = border; x < r.w - border; x++) {
    const p = pxAt(r, x, y);
    const yellow = p[0] > 140 && p[2] < 150;
    if (prev !== null && yellow !== prev) n++;
    prev = yellow;
    count++;
  }
  return { runs: n, avg: count / n };
}
const meanDiff = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
};
const cornerOf = async (buf, corner, size = 48) => {
  const m = await sharp(buf).metadata();
  const left = corner === "tl" || corner === "bl" ? 0 : m.width - size;
  const top = corner === "tl" || corner === "tr" ? 0 : m.height - size;
  return sharp(buf).extract({ left, top, width: size, height: size }).removeAlpha().raw().toBuffer();
};

const A = () => q1("select id from media where status = 'ready' and kind = 'image' order by id limit 1")?.id;

/* ============================================================================================================================
 * CA. Option A
 * ========================================================================================================================== */
let pub;
if (run("CA") || run("CS") || run("CB")) pub = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })).newPage();

if (run("CA"))
  await section("CA", async () => {
    const { card, draftId } = await importFrame("cadre58a", "a");
    info("CA revue cadre", card);
    ok("CA1 revue : le cadre est reconnu redessiné, sans erreur", card?.change === "redrawn" && card?.status !== "error", JSON.stringify(card));
    ok("CA1 revue : l'aperçu dit « trois formats »", /trois formats/.test((card?.msgs ?? []).join(" ")), JSON.stringify(card?.msgs));
    const apres = card?.imgs?.find((i) => /après/.test(i.alt));
    ok("CA1 revue : l'aperçu « après » montre les 3 formats (image large)", (apres?.w ?? 0) > 900, JSON.stringify(apres));
    const data = JSON.parse(sql((db) => db.prepare("select data from themes where id = ?").get(draftId))?.data ?? "null");
    ok("CA2 thème : le cadre est rangé", Boolean(data?.assets?.kit?.frame), JSON.stringify(data?.assets?.kit?.frame));

    await pub.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
    await pub.waitForTimeout(800);
    const kitAttr = await pub.evaluate(() => document.documentElement.hasAttribute("data-kit-frame"));
    ok("CA3 public : le thème porte le cadre du kit", kitAttr);
    await injectBoxes(pub);
    const css = await pub.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('#e58 [data-k="carre"]'));
      return { repeat: cs.borderImageRepeat, w: parseFloat(cs.borderTopWidth), src: cs.borderImageSource.slice(0, 20) };
    });
    ok("CA4 le CSS répète les côtés (round), pas d'étirement", /round/.test(css.repeat) && !/stretch/.test(css.repeat), JSON.stringify(css));
    ok("CA4 épaisseur du bord : 24 px (moitié de la découpe)", css.w === 24, JSON.stringify(css));
    const shots = {};
    for (const k of Object.keys(SIZES)) shots[k] = await shotBox(pub, k);
    await pub.screenshot({ path: path.join(SHOTS, "ca-apres-formats.png"), clip: { x: 0, y: 0, width: 1260, height: 1000 } });
    for (const k of ["carre", "panorama", "portrait"]) writeFileSync(path.join(SHOTS, `ca-apres-${k}.png`), shots[k]);
    writeFileSync(path.join(SHOTS, "ca-apres-vignette.png"), shots.vignette);
    // Coins identiques, au pixel, sur les 3 formats.
    const tl = await Promise.all(["carre", "panorama", "portrait"].map((k) => cornerOf(shots[k], "tl")));
    const br = await Promise.all(["carre", "panorama", "portrait"].map((k) => cornerOf(shots[k], "br")));
    ok("CA5 coin haut-gauche identique sur carré, panorama, portrait", meanDiff(tl[0], tl[1]) < 1.5 && meanDiff(tl[0], tl[2]) < 1.5, `${meanDiff(tl[0], tl[1])} / ${meanDiff(tl[0], tl[2])}`);
    ok("CA5 coin bas-droite identique sur carré, panorama, portrait", meanDiff(br[0], br[1]) < 1.5 && meanDiff(br[0], br[2]) < 1.5, `${meanDiff(br[0], br[1])} / ${meanDiff(br[0], br[2])}`);
    // Le coin est bien celui du dessin (rouge avec un point blanc).
    const cr = await raw(shots.panorama);
    const red = pxAt(cr, 6, 6);
    const dot = pxAt(cr, 24, 24);
    ok("CA5 le coin est celui du dessin (rouge, point blanc)", red[0] > 150 && red[1] < 90 && dot[0] > 220 && dot[1] > 220, `${red} / ${dot}`);
    // Le bord garde la même épaisseur (48 px d'écran = 24 CSS) quelle que soit la taille de la photo, vignette comprise.
    const widths = {};
    for (const k of ["carre", "panorama", "portrait", "vignette"]) {
      const r2 = await raw(shots[k]);
      let x = 0;
      while (x < r2.w && pxAt(r2, x, 2)[0] > 150 && pxAt(r2, x, 2)[1] < 90) x++;
      widths[k] = x;
    }
    ok("CA5 épaisseur du coin : 48 px d'écran sur chaque format (pas de mise à l'échelle avec la photo)", Object.values(widths).every((w) => w === 48), JSON.stringify(widths));
    // Côtés répétés, non étirés.
    const rs = runsTop(await raw(shots.carre), 48);
    const rp = runsTop(await raw(shots.panorama), 48);
    info("CA6 alternances du bord du haut", { carre: rs, panorama: rp });
    ok("CA6 le panorama répète le motif (≥ 3 fois plus d'alternances que le carré)", rp.runs >= rs.runs * 3, JSON.stringify({ rs, rp }));
    ok("CA6 le motif garde sa taille sur le panorama (≈ 25 px d'écran par couleur)", rp.avg > 17 && rp.avg < 36, JSON.stringify(rp));
    // Avant : même page en étirement (ancien rendu).
    await injectBoxes(pub, true);
    writeFileSync(path.join(SHOTS, "ca-avant-panorama.png"), await shotBox(pub, "panorama"));
    writeFileSync(path.join(SHOTS, "ca-avant-vignette.png"), await shotBox(pub, "vignette"));
    const old = runsTop(await raw(await shotBox(pub, "panorama")), 48);
    ok("CA6 (témoin) l'ancien rendu étirait : moins d'alternances que le rendu actuel", old.runs < rp.runs / 2, JSON.stringify({ old, rp }));

    // Téléphone : l'épaisseur se réduit.
    const phone = await (await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2 })).newPage();
    await phone.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
    await injectBoxes(phone);
    const pw = await phone.evaluate(() => ({ carre: parseFloat(getComputedStyle(document.querySelector('#e58 [data-k="carre"]')).borderTopWidth), vignette: parseFloat(getComputedStyle(document.querySelector('#e58 [data-k="vignette"]')).borderTopWidth), overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
    info("CA7 téléphone", pw);
    ok("CA7 téléphone : l'épaisseur se réduit (jamais plus de 4 % de la largeur de l'écran)", pw.carre <= 16 && pw.carre >= 8, JSON.stringify(pw));
    writeFileSync(path.join(SHOTS, "ca-apres-telephone-vignette.png"), await shotBox(phone, "vignette"));
    await phone.context().close();
  });

/* ============================================================================================================================
 * CS. « Sans cadre »
 * ========================================================================================================================== */
if (run("CS"))
  await section("CS", async () => {
    const media = A();
    const pageId = pageIdOf("decors");
    const blocks = [
      { uid: "s1", type: "image", props: { mediaId: media, width: "wide" } },
      { uid: "s2", type: "image", props: { mediaId: media, width: "wide", look: { frame: { kind: "none" } } } },
      { uid: "s3", type: "image", props: { mediaId: media, width: "wide", look: { frame: { kind: "band", width: "epais", color: "#12ab34" } } } },
      { uid: "s4", type: "image", props: { mediaId: media, width: "wide", look: { frame: { kind: "theme" } } } },
    ];
    const done = await publishBlocks(page, BASE, pageId, blocks, () => q1("select count(*) n from blocks where page_id = ?", pageId).n === blocks.length, 300000);
    ok("CS0 page publiée", done);
    const kitOn = await (async () => {
      await pub.goto(`${BASE}/fr/decors`, { waitUntil: "networkidle" });
      await pub.waitForTimeout(800);
      return pub.evaluate(() => document.documentElement.hasAttribute("data-kit-frame"));
    })();
    ok("CS0 le thème porte un cadre du kit", kitOn, "lance CA avant CS");
    const read = (sel) => `[...document.querySelectorAll(${JSON.stringify(sel)})].map((el) => { const cs = getComputedStyle(el); return { src: cs.borderImageSource.slice(0, 12), w: parseFloat(cs.borderTopWidth), color: cs.borderTopColor }; })`;
    const f = await pub.evaluate(`({ plain: ${read("figure.block-image .media-frame:not([data-frame])")}, none: ${read('figure.block-image .media-frame[data-frame="none"]')}, chosen: ${read('figure.block-image .media-frame[data-frame="band"]')}, theme: ${read('figure.block-image .media-frame[data-frame="theme"]')} })`);
    info("CS public", f);
    ok("CS1 public : la photo SANS choix n'a pas le cadre du kit (lot 62 : plus posé d'office)", f.plain.length === 1 && f.plain[0].src === "none" && f.plain[0].w === 0, JSON.stringify(f.plain));
    ok("CS2 public : « Aucun » = aucun cadre (ni kit, ni bordure)", f.none.length === 1 && f.none[0].src === "none" && f.none[0].w === 0, JSON.stringify(f.none));
    ok("CS3 public : une bande choisie est une bande (pas le cadre du kit)", f.chosen.length === 1 && f.chosen[0].src === "none" && f.chosen[0].w > 0, JSON.stringify(f.chosen));
    ok("CS3b public : « Cadre du thème » = le cadre du kit", f.theme.length === 1 && f.theme[0].src !== "none" && f.theme[0].w > 4, JSON.stringify(f.theme));
    await pub.screenshot({ path: path.join(SHOTS, "cs-public.png"), fullPage: true });
    // Toile (parité).
    await page.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
    const fr = await canvas();
    await sleep(2000);
    const c = await fr.evaluate(`({ plain: ${read("figure.block-image .media-frame:not([data-frame])")}, none: ${read('figure.block-image .media-frame[data-frame="none"]')}, theme: ${read('figure.block-image .media-frame[data-frame="theme"]')} })`);
    info("CS toile", c);
    ok("CS4 toile : même rendu que le public (sans choix et Aucun : rien ; Cadre du thème : le kit)", c.plain.length === 1 && c.plain[0].src === "none" && c.none.length === 1 && c.none[0].src === "none" && c.none[0].w === 0 && c.theme.length === 1 && c.theme[0].src !== "none", JSON.stringify(c));
    // Le bouton Cadre propose les trois choix (clic sur la photo sans choix, puis Cadre).
    await fr.locator('figure.block-image .media-frame:not([data-frame])').first().click();
    await sleep(600);
    await fr.locator('.pe-tools [data-testid="frame-button"]').click({ timeout: 15000 }).catch(() => {});
    const dlg = fr.getByRole("dialog", { name: "Cadre de la photo" });
    const menu = (await dlg.locator("[data-frame-kind]").allTextContents().catch(() => [])).map((t) => t.trim()).join(" · ");
    ok("CS5 le bouton Cadre propose « Aucun · Cadre du thème · Bande de couleur »", menu === "Aucun · Cadre du thème · Bande de couleur", menu);
    if (menu) {
      await dlg.locator('[data-frame-kind="theme"]').click();
      await sleep(1500);
      const after = await fr.evaluate(`document.querySelectorAll('figure.block-image .media-frame[data-frame="theme"]').length`);
      ok("CS5 « Cadre du thème » choisi : la photo reçoit le cadre du kit sur la toile", after === 2, String(after));
    }
    await page.screenshot({ path: path.join(SHOTS, "cs-menu.png") });
  });

/* ============================================================================================================================
 * CB. Option B
 * ========================================================================================================================== */
if (run("CB"))
  await section("CB", async () => {
    const { card } = await importFrame("cadre58b", "b");
    info("CB revue cadre", card);
    ok("CB1 revue : le cadre est reconnu redessiné, sans erreur", card?.change === "redrawn" && card?.status !== "error", JSON.stringify(card));
    ok("CB1 revue : le message dit « Option B »", /Option B/.test((card?.msgs ?? []).join(" ")), JSON.stringify(card?.msgs));
    await pub.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
    await pub.waitForTimeout(800);
    await injectBoxes(pub);
    const shots = {};
    for (const k of ["carre", "panorama", "portrait"]) shots[k] = await shotBox(pub, k);
    for (const k of ["carre", "panorama", "portrait"]) writeFileSync(path.join(SHOTS, `cb-${k}.png`), shots[k]);
    const r = await raw(shots.panorama);
    const redish = (p) => p[0] > 150 && p[1] < 90 && p[2] < 90;
    ok("CB2 les quatre coins viennent du coin dessiné (rouge)", redish(pxAt(r, 6, 6)) && redish(pxAt(r, r.w - 7, 6)) && redish(pxAt(r, 6, r.h - 7)) && redish(pxAt(r, r.w - 7, r.h - 7)), [pxAt(r, 6, 6), pxAt(r, r.w - 7, 6), pxAt(r, 6, r.h - 7), pxAt(r, r.w - 7, r.h - 7)].join(" | "));
    const grey = (p) => Math.abs(p[0] - 0x9a) < 14 && Math.abs(p[1] - 0xa7) < 14 && Math.abs(p[2] - 0xad) < 14;
    const sides = [pxAt(r, r.w / 2, 10), pxAt(r, r.w / 2, r.h - 11), pxAt(r, 10, r.h / 2), pxAt(r, r.w - 11, r.h / 2)];
    const sp = await raw(shots.portrait);
    const sides2 = [pxAt(sp, sp.w / 2, 10), pxAt(sp, sp.w / 2, sp.h - 11), pxAt(sp, 10, sp.h / 2), pxAt(sp, sp.w - 11, sp.h / 2)];
    ok("CB3 les quatre côtés sont dessinés (bleu / jaune, pas le fond de la photo)", [...sides, ...sides2].every((p) => !grey(p)), JSON.stringify([...sides, ...sides2]));
    const rp = runsTop(r, 48);
    ok("CB4 le côté du haut répète son motif sur le panorama", rp.runs > 40, JSON.stringify(rp));
  });

console.log(errors.length ? `ERREURS PAGE : ${errors.slice(0, 5).join(" | ")}` : "aucune erreur de page");
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout est vert");
process.exit(failures ? 1 : 0);
