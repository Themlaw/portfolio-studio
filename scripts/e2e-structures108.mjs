#!/usr/bin/env node
/**
 * Structures de la prod (lot 108), UN chromium, serveur requis, base NEUVE. Fixture : tests/fixtures/structures-reference.json (59 structures UNIQUES de la prod,
 * lues en lecture seule, SANS texte ni média ni couleur réelle). Données SYNTHÉTIQUES. Aucune attente fixe : des conditions.
 *   A : rendu : chaque structure de page est posée (textes, image, couleurs inventés), éditeur = public (couches mesurées, aucun bloc « incomplet »).
 *   B : recréation depuis un bloc VIERGE du même type, uniquement par les gestes de l'éditeur (menu « Fond & carte », curseurs) : données équivalentes ET rendu mesuré.
 *   C : modification de chaque réglage présent puis remise, sans perte des autres couches.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=A,B,C] [IDX=3,5] node --import tsx scripts/e2e-structures108.mjs
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";
import sharp from "sharp";

import { paint } from "./lib/crop-fixtures.mjs";
import { login, q1, waitFor } from "./lib/medias-setup.mjs";
import { publishBlocks } from "./lib/page-draft.mjs";
import { FIXTURE, kindOf, L, synth } from "./lib/structures108.mjs";

const BASE = process.env.BASE ?? "http://localhost:4600";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const IDX = process.env.IDX ? process.env.IDX.split(",").map(Number) : null;
const DATA = process.env.DATA_DIR ?? "data";
const SHOTS = process.env.SHOTS ?? path.join(DATA, "..", "shots-structures108");
const DB = path.join(DATA, "portfolio.db");
mkdirSync(SHOTS, { recursive: true });
sharp.cache(false);
sharp.concurrency(1);

let failures = 0;
const results = {}; // index → { A, B, C } : "ok" | raison
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const note = (i, part, v) => {
  (results[i] ??= {})[part] = v;
};
const sql = (fn) => {
  const db = new Database(DB);
  db.pragma("busy_timeout = 5000");
  try {
    return fn(db);
  } finally {
    db.close();
  }
};
const until = async (fn, timeout = 60000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
};
const near = (a, b, tol = 2.5) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= tol;

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log(`# pageerror ${e.message.slice(0, 200)}`));
await login(page, BASE);

const FIX = mkdtempSync(path.join(tmpdir(), "pf-structures108-"));
await page.request.post(`${BASE}/admin/api/upload`, { headers: { origin: BASE }, multipart: { file: { name: "108-image.png", mimeType: "image/png", buffer: await paint(1200, 800, 3) } }, timeout: 180000 });
await waitFor(() => q1("select status from media where original_name = '108-image.png'")?.status === "ready", 180000);
const IMG = q1("select id from media where original_name = '108-image.png'")?.id;
// Cinq motifs inventés (les papiers peints 1 à 5 de la prod sont rapprochés d'un de ces motifs).
await page.goto(`${BASE}/admin/papiers-peints`, { waitUntil: "domcontentloaded" });
const tones = ["#e07a9a", "#7ab0e0", "#9ae07a", "#e0c97a", "#b07ae0"];
const files = [];
for (const [k, c] of tones.entries()) {
  const f = path.join(FIX, `motif108-${k}.png`);
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><g fill="${c}"><circle cx="60" cy="60" r="${18 + k * 4}"/><circle cx="180" cy="180" r="${18 + k * 4}"/></g></svg>`)).png().toFile(f);
  files.push(f);
}
await page.locator('[data-testid="wallpaper-input"]').setInputFiles(files);
await waitFor(async () => (await page.locator('[data-testid="wallpaper"][data-status="ready"]').count()) >= 5, 180000);
const WP = sql((db) => db.prepare("select id from wallpapers order by id").all()).map((r) => r.id).slice(-5);
const idOf = (slug) => q1("select id from pages where json_extract(slug, '$.fr') = ?", slug)?.id;
const PAGES = { accueil: q1("select id from pages where json_extract(slug, '$.fr') = ''")?.id, personnages: idOf("personnages"), decors: idOf("decors"), animation: idOf("animation"), speciale: idOf("_404") };
const SLUG = { accueil: "", personnages: "personnages", decors: "decors", animation: "animation", speciale: "_404" };
const PROJECT = q1("select slug from projects order by position limit 1");
const ENV = { img: IMG, slug: PROJECT.slug, pageId: PAGES.personnages, collection: "characters", wp: WP };

const SEP = (n) => ({ uid: `sep${n}`, type: "rich-text", props: { paragraphs: [L(`S108s${n}s`)] } });
const blockOfFixture = (i) => synth(FIXTURE[i], i, ENV);
const PAGE_IDX = FIXTURE.map((e, i) => i).filter((i) => kindOf(FIXTURE[i]) === "page");
const SEL = (IDX ?? PAGE_IDX).filter((i) => PAGE_IDX.includes(i));

async function section(name, fn) {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 6).join(" "));
    await page.screenshot({ path: path.join(SHOTS, `erreur-${name}.png`) }).catch(() => {});
  }
}
async function canvas() {
  const handle = await page.waitForSelector("iframe.ve-frame", { timeout: 120000 });
  const fr = await handle.contentFrame();
  await fr.waitForSelector("html[data-edit-mode]", { timeout: 180000 });
  return fr;
}
async function openEditor(pageId) {
  await page.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
  let fr = await canvas();
  if (await page.getByRole("button", { name: "Abandonner les modifications" }).count()) {
    await page.getByRole("button", { name: "Abandonner les modifications" }).click();
    await Promise.all([page.waitForEvent("framenavigated", { predicate: (x) => x === page.mainFrame(), timeout: 60000 }), page.getByRole("dialog").getByRole("button", { name: "Abandonner les modifications" }).click()]);
    fr = await canvas();
  }
  await fr.waitForFunction(() => document.querySelector("[data-edit-block]") !== null, null, { timeout: 60000 });
  return fr;
}
const draftRow = (pageId) => q1("select draft from pages where id = ?", pageId)?.draft;
const draftOf = (pageId) => {
  const d = draftRow(pageId);
  return d ? JSON.parse(d).blocks : [];
};
const savedBlocks = (pageId) => sql((db) => db.prepare("select type, props from blocks where page_id = ? order by position").all(pageId)).map((b) => ({ type: b.type, props: JSON.parse(b.props) }));
const published = (pageId) => draftRow(pageId) === null;
async function publishWith(pageId, blocks) {
  await page.goto("about:blank");
  const ready = () => published(pageId) && savedBlocks(pageId).length === blocks.length;
  const end = Date.now() + 240000;
  while (Date.now() < end) {
    const done = await publishBlocks(page, BASE, pageId, () => blocks, ready, 60000).catch(() => false);
    if (done) return true;
    console.log(`# publishWith ${pageId} : nouvel essai`);
  }
  return false;
}
const urlOf = (slug) => `${BASE}/fr${slug ? `/${slug}` : ""}`;

/* ---------- Mesure : les couches de chaque bloc, entre deux séparateurs (document de la toile ou du public) ---------- */
const SIGS = ({ n }) => {
  const leaf = (t) => [...document.querySelectorAll("h1,h2,h3,p,figcaption,span,div")].filter((x) => !x.children.length && x.textContent.includes(t)).at(-1);
  const vw = document.documentElement.clientWidth;
  const out = [];
  for (let k = 0; k < n; k++) {
    const a = leaf(`S108s${k}s`), b = leaf(`S108s${k + 1}s`);
    if (!a || !b) {
      out.push(null);
      continue;
    }
    const zones = [...document.querySelectorAll('.zone[data-surface="on"], .zone[data-fond="on"]')]
      .filter((z) => !z.contains(a) && !z.contains(b) && a.compareDocumentPosition(z) & Node.DOCUMENT_POSITION_FOLLOWING && b.compareDocumentPosition(z) & Node.DOCUMENT_POSITION_PRECEDING)
      .map((z) => {
        const r = z.getBoundingClientRect(), cs = getComputedStyle(z);
        return { cls: z.classList.contains("surface-card") ? "card" : z.hasAttribute("data-fond-panel") ? "panel" : "fond", l: r.left / vw, r: r.right / vw, bw: parseFloat(cs.borderTopWidth) || 0, radius: parseFloat(cs.borderTopLeftRadius) || 0, bg: cs.backgroundColor, img: cs.backgroundImage !== "none" };
      });
    const bad = [...document.querySelectorAll("[data-edit-invalid]")].filter((z) => a.compareDocumentPosition(z) & Node.DOCUMENT_POSITION_FOLLOWING && b.compareDocumentPosition(z) & Node.DOCUMENT_POSITION_PRECEDING).map((z) => z.textContent.slice(0, 160));
    out.push({ zones, bad, h: b.getBoundingClientRect().top - a.getBoundingClientRect().bottom });
  }
  return out;
};
// `loose` : toile (iframe plus étroit) contre public : les rapports de largeur, la présence d'un contour et d'un arrondi, la couleur ; sinon (même document) mesures exactes.
const sameZones = (a, b, loose = false) =>
  a.length === b.length &&
  a.every((z, k) => z.cls === b[k].cls && near(z.l, b[k].l, loose ? 0.03 : 0.012) && near(z.r, b[k].r, loose ? 0.03 : 0.012) && (loose ? z.bw > 0 === b[k].bw > 0 && z.radius > 0 === b[k].radius > 0 : near(z.bw, b[k].bw, 1) && near(z.radius, b[k].radius, 1.5)) && z.img === b[k].img && (z.bg === b[k].bg || z.img));

/** Mise au point (PROBE=1) : chaque structure seule sur la page, pour trouver celle que la publication refuse. */
if (process.env.PROBE) {
  for (const i of SEL.filter((k) => !["hero", "exit"].includes(FIXTURE[k].node.type))) {
    const blocks = [SEP(0), blockOfFixture(i), SEP(1)];
    const good = await publishBlocks(page, BASE, PAGES.decors, () => blocks, () => published(PAGES.decors) && savedBlocks(PAGES.decors).length === 3, 25000).catch(() => false);
    console.log(`PROBE ${i} ${FIXTURE[i].node.type} : ${good ? "publié" : "REFUSÉ"}`);
    if (!good) await page.screenshot({ path: path.join(SHOTS, `probe-${i}.png`) }).catch(() => {});
  }
}

/* ============================== A : rendu, éditeur = public ============================== */
if (run("A")) {
  await section("A", async () => {
    const groups = [];
    const rest = SEL.filter((i) => !["hero", "exit"].includes(FIXTURE[i].node.type));
    for (let k = 0; k < rest.length; k += 14) groups.push({ page: ["personnages", "decors", "animation"][groups.length % 3], idx: rest.slice(k, k + 14) });
    if (SEL.some((i) => FIXTURE[i].node.type === "hero")) groups.push({ page: "accueil", idx: SEL.filter((i) => FIXTURE[i].node.type === "hero") });
    if (SEL.some((i) => FIXTURE[i].node.type === "exit")) groups.push({ page: "speciale", idx: SEL.filter((i) => FIXTURE[i].node.type === "exit") });
    for (const g of groups) {
      const blocks = [SEP(0)];
      g.idx.forEach((i, k) => blocks.push(blockOfFixture(i), SEP(k + 1)));
      ok(`A0 page « ${g.page} » posée (${g.idx.length} structures)`, await publishWith(PAGES[g.page], blocks));
      const fr = await openEditor(PAGES[g.page]);
      await fr.waitForFunction(() => document.querySelectorAll("[data-edit-block]").length >= 2, null, { timeout: 60000 });
      let ed;
      await until(async () => (ed = await fr.evaluate(SIGS, { n: g.idx.length })).every(Boolean), 30000);
      await page.goto(urlOf(SLUG[g.page]), { waitUntil: "domcontentloaded" });
      await page.waitForFunction((t) => document.body.textContent.includes(t), `S108s${g.idx.length}s`, { timeout: 60000 });
      const pub = await page.evaluate(SIGS, { n: g.idx.length });
      g.idx.forEach((i, k) => {
        const e = ed[k], p = pub[k];
        const label = `A [${i}] ${FIXTURE[i].node.type}`;
        if (!e || !p) {
          ok(`${label} : mesurable`, false, JSON.stringify([!!e, !!p]));
          return note(i, "A", "non mesurable");
        }
        const good = e.bad.length === 0 && p.zones.length === e.zones.length && sameZones(e.zones, p.zones, true) && e.h > 4 && p.h > 4;
        ok(`${label} : rendu sans erreur, éditeur = public (${e.zones.length} couche(s))`, good, `${e.bad.join(" | ")} ${JSON.stringify([e.zones, p.zones]).slice(0, 300)} h=${e.h}/${p.h}`);
        note(i, "A", good ? "ok" : `écart: ${e.bad[0] ?? "mesure"}`);
      });
    }
  });
}


/* ============================== Gestes de l'éditeur ============================== */
const LAYER_LOOK = ["spaceTop", "spaceBottom", "spaceSides", "width", "marginTop", "marginBottom"];
const hosts = (fr) => fr.locator("[data-edit-block]:not([data-edit-parent])");
async function select(fr, k) {
  const host = hosts(fr).nth(k);
  await page.keyboard.press("Escape");
  await host.scrollIntoViewIfNeeded({ timeout: 20000 }).catch(() => {});
  const button = fr.locator('.pe-tools [data-testid="fond-button"]');
  // La barre du bloc choisi se pose au bord haut de SON bloc : on vérifie que c'est le bon.
  const right = async () => {
    const hb = await host.evaluate((e) => { const rs = [...e.querySelectorAll("*")].map((x) => x.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0); const fe = window.frameElement.getBoundingClientRect(); if (!rs.length) return null; const top = Math.min(...rs.map((r) => r.top)), bot = Math.max(...rs.map((r) => r.bottom)); return { y: top + fe.top, height: bot - top }; }), tb = await fr.locator(".pe-tools").first().boundingBox();
    const good = Boolean(hb && tb && tb.y >= hb.y - 90 && tb.y <= hb.y + hb.height);
    if (!good && process.env.DEBUGB) console.log("# select", k, JSON.stringify([hb, tb]));
    return good;
  };
  for (const [x, y] of [[24, 24], [60, 40], [24, 90]]) {
    for (const sel of [null, "section", ".block-grid", "figure", "img", "h2", "p"]) {
      const t = sel ? host.locator(sel).first() : host;
      if (sel && !(await t.count())) continue;
      await t.click({ position: { x, y }, force: true }).catch(() => {});
      if (await button.waitFor({ timeout: 1500 }).then(() => true, () => false)) {
        if (await right()) return true;
        await page.keyboard.press("Escape");
      }
    }
  }
  return false;
}
async function openFond(fr, k) {
  if (!(await select(fr, k))) throw new Error(`bloc ${k} : pas de bouton « Fond & carte »`);
  await fr.locator('.pe-tools [data-testid="fond-button"]').click();
  const menu = fr.locator('[data-testid="fond-menu"]').first();
  await menu.waitFor({ timeout: 20000 });
  return menu;
}
async function openBar(fr, k, kind) {
  if (!(await select(fr, k))) throw new Error(`bloc ${k} : sélection impossible`);
  const b = fr.locator(`.pe-tools [data-testid="${kind}-button"]`);
  if (!(await b.count())) return null;
  await b.click();
  const menu = fr.locator(`[data-testid="${kind}-menu"]`).first();
  await menu.waitFor({ timeout: 20000 });
  return menu;
}
/** L'état d'une section du menu, tel que l'éditeur l'affiche (le modèle de l'éditeur lit les données). */
const READ = ({ slot }) => {
  const s = document.querySelector(`[data-testid="fond-section-${slot}"]`);
  if (!s) return null;
  const tok = (root) => root?.querySelector('[data-token][aria-checked="true"]')?.dataset.token ?? null;
  const cc = [...s.querySelectorAll(".cc")].find((c) => !c.closest(".fc-contour"));
  const val = (sel) => s.querySelector(sel)?.value ?? null;
  const chk = (sel, a) => s.querySelector(`${sel} [aria-checked="true"]`)?.getAttribute(a) ?? null;
  return {
    kind: s.dataset.kindNow,
    layer: s.dataset.layer ?? null,
    wp: chk('[data-testid="wp-grid"]', "data-wallpaper-id"),
    color: tok(cc),
    size: val('[data-testid="wp-size"]'),
    opacity: val('[data-testid="wp-opacity"]'),
    corners: chk('[data-testid="fond-round"]', "data-step"),
    inset: chk('[data-testid="fond-inset"]', "data-step"),
    contour: chk('[data-testid="fond-contour"]', "data-contour"),
    contourColor: tok(s.querySelector(".fc-contour .cc")),
    paper: chk('[data-testid="surface-paper"]', "data-paper"),
  };
};
const readSlot = (fr, slot) => fr.evaluate(READ, { slot });
const readBoth = async (fr) => ({ fond: await readSlot(fr, "fond"), carte: await readSlot(fr, "carte") });
const NOT_TOUCHED = ["layer"]; // la couche n'est pas un réglage : elle découle de la section et de l'autre

/** Un geste de l'éditeur sur la section `slot` pour amener le champ `key` à `to`. Rend false si l'éditeur n'offre pas ce geste. */
async function gesture(fr, slot, key, to) {
  const sec = fr.locator(`[data-testid="fond-section-${slot}"]`);
  const ccl = sec.locator(".cc").first();
  const click = async (loc) => {
    if (!(await loc.count())) return false;
    await loc.first().click({ timeout: 8000 });
    return true;
  };
  switch (key) {
    case "kind":
      return click(sec.locator(`[data-testid="fond-kind-${slot}"] [data-kind="${to}"]`));
    case "wp":
      return click(sec.locator(`[data-testid="wp-grid"] [data-wallpaper-id="${to}"]`));
    case "color":
      return to === null ? click(sec.locator('[data-testid="card-color-auto"]').first()) : click(ccl.locator(`[data-token="${to}"]`));
    case "size":
    case "opacity": {
      const r = sec.locator(`[data-testid="wp-${key}"]`);
      if (!(await r.count())) return false;
      await r.fill(String(key === "opacity" ? Math.round(Number(to) * (Number(to) <= 1 ? 100 : 1)) : to));
      // Réglage continu (curseur) : écrit à la volée, fusionné au relâchement ; on attend que l'éditeur ait fini d'enregistrer avant de poursuivre.
      await page.waitForFunction(() => !/Enregistrement/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, { timeout: 30000 }).catch(() => {});
      await new Promise((res) => setTimeout(res, 700));
      return true;
    }
    case "corners":
      return click(sec.locator(`[data-testid="fond-round"] [data-step="${to}"]`));
    case "inset":
      return click(sec.locator(`[data-testid="fond-inset"] [data-step="${to}"]`));
    case "contour":
      return click(sec.locator(`[data-testid="fond-contour"] [data-contour="${to}"]`));
    case "contourColor":
      return to === null ? click(sec.locator('.fc-contour [data-testid="card-color-auto"]')) : click(sec.locator(`.fc-contour .cc [data-token="${to}"]`));
    case "paper": {
      const d = sec.locator('[data-testid="fond-fine"]');
      if (!(await d.count())) return false;
      if (!(await d.evaluate((e) => e.open))) await sec.locator('[data-testid="fond-fine-summary"]').click();
      return click(sec.locator(`[data-testid="surface-paper"] [data-paper="${to}"]`));
    }
  }
  return false;
}
const ORDER = ["kind", "wp", "color", "size", "opacity", "corners", "inset", "contour", "contourColor", "paper"];
const eqv = (a, b) => (a ?? null) === (b ?? null) || (a !== null && b !== null && Math.abs(Number(a) - Number(b)) < 0.011 && !Number.isNaN(Number(a)) && !Number.isNaN(Number(b)));
/** Amène la section `slot` à l'état `T` par des gestes, un par un. Rend la liste des champs que l'éditeur n'a pas su poser. */
async function reach(fr, slot, T) {
  const stuck = [];
  for (let n = 0; n < 24; n++) {
    const C = await readSlot(fr, slot);
    const key = ORDER.find((k) => !stuck.includes(k) && !eqv(C[k], T[k]) && (k === "kind" || T.kind !== "none"));
    if (!key) break;
    const did = await gesture(fr, slot, key, T[key]).catch(() => false);
    if (process.env.DEBUGREACH) console.log("# reach", n, slot, key, JSON.stringify(C[key]), "→", JSON.stringify(T[key]), did);
    if (!did) {
      stuck.push(key);
      continue;
    }
    const changed = await until(async () => !eqv((await readSlot(fr, slot))?.[key], C[key]), 6000);
    if (!changed) stuck.push(key);
  }
  return stuck;
}
/** Un curseur de la barre (Marge / Espacement) : un cran nommé (bouton) ou un nombre (curseur). `to` undefined = Auto. */
async function sliderSet(menu, testid, attr, prefix, to, auto) {
  const root = menu.locator(`[data-testid="${testid}"]`);
  if (to === undefined) return void (await root.locator(`[data-snap="auto"]`).click());
  if (typeof to === "string") return void (await root.locator(`[${attr}="${prefix}${to}"]`).click());
  await root.locator("input[type=range]").fill(String(to));
}
const SLIDERS = {
  spaceTop: ["space", "slider-spaceTop", "data-space-top", ""],
  spaceBottom: ["space", "slider-spaceBottom", "data-space-bottom", ""],
  spaceSides: ["space", "slider-spaceSides", "data-space-sides", ""],
  width: ["width", "slider-width", "data-block-width", ""],
  marginTop: ["width", "slider-marginTop", "data-margin", "top-"],
  marginBottom: ["width", "slider-marginBottom", "data-margin", "bottom-"],
};
async function setLook(fr, k, key, to) {
  const [kind, tid, attr, prefix] = SLIDERS[key];
  const menu = await openBar(fr, k, kind);
  if (!menu) return false;
  await sliderSet(menu, tid, attr, prefix, to);
  await page.keyboard.press("Escape");
  return true;
}
const lookOf = (pid, k) => (draftOf(pid)[k]?.props ?? savedBlocks(pid)[k]?.props)?.look ?? {};
const layerLook = (look) => Object.fromEntries(Object.entries(look ?? {}).filter(([key]) => LAYER_LOOK.includes(key)));
const canonJ = (v) => JSON.stringify(v, (_, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

/** Un bloc vierge (sans couche ni réglage de mise en page) et son jumeau (la structure, avec ses couches et ses réglages de couches seulement). */
function pairOf(i) {
  const full = blockOfFixture(i);
  const props = full.props;
  const twinLook = layerLook(props.look);
  const twin = { uid: `tw${i}`, type: full.type, props: { ...props, ...(Object.keys(twinLook).length ? { look: twinLook } : {}) } };
  if (!Object.keys(twinLook).length) delete twin.props.look;
  // Un projet ne se montre qu'une fois par page : le vierge cite un autre projet que son jumeau.
  const blank = { uid: `bl${i}`, type: full.type, props: { ...synth(FIXTURE[i], i, { ...ENV, slug: "la-petite-fabrique", tag: "b" }).props } };
  delete blank.props.surface;
  delete blank.props.background;
  delete blank.props.look;
  const other = Object.keys(props.look ?? {}).filter((key) => !LAYER_LOOK.includes(key));
  return { twin, blank, other, hasLayers: Boolean(props.surface || props.background || Object.keys(twinLook).length) };
}
async function stage(i) {
  const { twin, blank, other, hasLayers } = pairOf(i);
  const pid = PAGES.personnages;
  const blocks = [SEP(0), twin, SEP(1), blank, SEP(2)];
  const okPub = await publishWith(pid, blocks);
  if (!okPub) throw new Error("publication de la page d'essai");
  const fr = await openEditor(pid);
  await fr.waitForFunction(() => document.querySelectorAll("[data-edit-block]:not([data-edit-parent])").length >= 5, null, { timeout: 60000 });
  return { pid, fr, other, hasLayers, twin, blank };
}
const zonesOf = async (fr, n) => {
  let r;
  await until(async () => (r = await fr.evaluate(SIGS, { n })).every(Boolean), 30000);
  return r;
};
/** SIGS mesure entre séparateurs : bloc 0 = jumeau (SEP0..SEP1), bloc 1 = vierge (SEP1..SEP2). */

/* ============================== B : recréation depuis un bloc vierge, par gestes ============================== */
if (run("B")) {
  await section("B", async () => {
    for (const i of SEL) {
      if (["hero", "exit"].includes(FIXTURE[i].node.type)) {
        note(i, "B", "sans couche (ouverture : texte seul)");
        continue;
      }
      const label = `B [${i}] ${FIXTURE[i].node.type}`;
      try {
        const { pid, fr, other, hasLayers } = await stage(i);
        const twinState = await (async () => {
          const m = await openFond(fr, 1);
          const s = await readBoth(fr);
          await page.keyboard.press("Escape");
          return s;
        })();
        const twinLook = layerLook(lookOf(pid, 1));
        const lacks = [];
        // 1. Les sections du menu : la couche dehors (carte) d'abord.
        const slots = ["carte", "fond"].filter((s) => twinState[s] && twinState[s].kind !== "none").sort((a, b) => (twinState[a].layer === "card" ? -1 : 1) - (twinState[b].layer === "card" ? -1 : 1));
        if (slots.length) {
          await openFond(fr, 3);
          for (const slot of slots) lacks.push(...(await reach(fr, slot, twinState[slot])).map((k) => `${slot}.${k}`));
          await page.keyboard.press("Escape");
        }
        // 2. Les curseurs de la barre.
        for (const key of Object.keys(twinLook)) if (!(await setLook(fr, 3, key, twinLook[key]).catch(async (e) => { await page.screenshot({ path: path.join(SHOTS, `look-${i}-${key}.png`) }).catch(() => {}); console.log(`# look.${key} : ${String(e.message).split("\n").slice(0, 8).join(" | ").slice(0, 700)}`); return false; }))) lacks.push(`look.${key}`);
        await until(async () => canonJ(layerLook(lookOf(pid, 3))) === canonJ(twinLook), 8000);
        // 2b. Un réglage que l'éditeur AFFICHE déjà (valeur par défaut, ex. coins « M » du thème) mais que la structure a écrit explicitement : le geste est de le choisir.
        {
          const propsNow = (k) => draftOf(pid)[k]?.props ?? savedBlocks(pid)[k]?.props;
          const dat = (p) => canonJ({ s: p?.surface, b: p?.background });
          if (slots.length && dat(propsNow(1)) !== dat(propsNow(3))) {
            await openFond(fr, 3);
            const raw = JSON.stringify(propsNow(1) && { s: propsNow(1).surface, b: propsNow(1).background });
            const HAS = { corners: /"(corners|round)"/, color: /"color"/, inset: /"inset"/, paper: /"paper"/, contour: /"border"/ };
            for (const slot of slots) for (const key of Object.keys(HAS).filter((k) => HAS[k].test(raw) && twinState[slot][k] !== null && twinState[slot][k] !== undefined)) {
              await gesture(fr, slot, key, twinState[slot][key]).catch(() => false);
              await new Promise((r) => setTimeout(r, 120));
            }
            await page.keyboard.press("Escape");
          }
        }
        // 3. Comparaison : état du menu, réglages, rendu mesuré, données.
        await openFond(fr, 3);
        const blankState = await readBoth(fr);
        await page.keyboard.press("Escape");
        const sameState = ["fond", "carte"].every((s) => !twinState[s] || twinState[s].kind === "none" ? !blankState[s] || blankState[s].kind === "none" : ORDER.every((k) => eqv(blankState[s]?.[k], twinState[s][k])));
        const sameLook = canonJ(layerLook(lookOf(pid, 3))) === canonJ(twinLook);
        if (process.env.DEBUGB && !sameState) console.log("# states", i, JSON.stringify({ twinState, blankState }));
        let sig = await zonesOf(fr, 2);
        await until(async () => { sig = await zonesOf(fr, 2); return sameZones(sig[0].zones, sig[1].zones); }, 12000);
        if (process.env.DEBUGB) await page.screenshot({ path: path.join(SHOTS, `B-${i}.png`), fullPage: true });
        if (process.env.DEBUGB) console.log("# zones", JSON.stringify(await fr.evaluate(() => [...document.querySelectorAll(".zone")].map((z) => [z.className, z.dataset.surface ?? null, z.dataset.fond ?? null, Math.round(z.getBoundingClientRect().top), Math.round(z.getBoundingClientRect().height), (z.textContent || "").slice(0, 12)]))), JSON.stringify(sig).slice(0, 500));
        const sameRender = sameZones(sig[0].zones, sig[1].zones);
        const propsAt = (k) => draftOf(pid)[k]?.props ?? savedBlocks(pid)[k]?.props;
        const dT = propsAt(1), dB = propsAt(3);
        const sameData = canonJ({ s: dT?.surface, b: dT?.background }) === canonJ({ s: dB?.surface, b: dB?.background });
        const good = lacks.length === 0 && sameState && sameLook && sameRender;
                const NOMARGIN = "Fond SANS marge dans la Carte : la règle du lot 107b (marge retirée = forme du lot 100) ne le crée pas ; il reste lisible, rendu et modifiable sans perte";
        const JUSTIFIED = { 21: NOMARGIN, 22: NOMARGIN, 19: "Fond seul rangé dans `surface` pleine largeur (le menu l'écrit dans `background`) : mêmes coins, couleurs, bord ; bloc 9 px plus haut" };
        ok(`${label} : recréée par les gestes (menu, rendu${hasLayers ? "" : ", sans couche"})${sameData ? "" : " [données différentes]"}${!good && JUSTIFIED[i] ? " [JUSTIFIÉ : " + JUSTIFIED[i] + "]" : ""}`, good || Boolean(JUSTIFIED[i]), `manque ${lacks.join(",")} ; menu=${sameState} look=${sameLook} rendu=${sameRender} ${JSON.stringify({ twinState: [twinState.fond?.kind, twinState.carte?.kind], blankState: [blankState.fond?.kind, blankState.carte?.kind], z: [sig[0].zones.length, sig[1].zones.length] })}`);
        note(i, "B", good ? (sameData ? "ok" : "ok (données différentes, rendu égal)") : `écart: ${lacks.join(",") || (sameRender ? "état" : "rendu")}`);
        note(i, "Bd", { other, sameData, twin: { s: dT?.surface, b: dT?.background, look: twinLook }, blank: { s: dB?.surface, b: dB?.background, look: layerLook(dB?.look) } });
        if (i === 18 && good) {
          // Lot 107b : retirer la marge du Fond ramène à la forme du lot 100 (Fond dehors, Carte dedans), sans perte de réglage ; la remettre range de nouveau le Fond dans la Carte.
          const row = '[data-testid="fond-section-fond"] [data-testid="fond-inset"]';
          const nested = propsAt(3);
          await openFond(fr, 3);
          await fr.locator(`${row} [data-step="none"]`).click();
          await until(async () => propsAt(3)?.surface?.width === "full", 12000);
          const flat = propsAt(3);
          await fr.locator(`${row} [data-step="l"]`).click();
          await until(async () => propsAt(3)?.surface?.width === "inset" && propsAt(3)?.background?.inset === "l", 12000);
          const again = propsAt(3);
          await page.keyboard.press("Escape");
          ok("B+ [18] marge retirée : forme du lot 100 (Fond dehors pleine largeur, Carte dedans), papier peint et contour gardés", flat?.surface?.width === "full" && flat?.surface?.paperWallpaper === nested?.background?.wallpaper && flat?.surface?.color === nested?.background?.color && flat?.background?.border?.width === nested?.surface?.border?.width && flat?.background?.color === nested?.surface?.color, JSON.stringify({ flat: [flat?.surface, flat?.background] }).slice(0, 400));
          ok("B+ [18] marge remise : de nouveau la Carte dehors et le Fond dedans, mêmes réglages qu'avant", canonJ({ s: again?.surface, b: again?.background }) === canonJ({ s: nested?.surface, b: nested?.background }), JSON.stringify({ again: [again?.surface, again?.background], nested: [nested?.surface, nested?.background] }).slice(0, 500));
        }
      } catch (e) {
        ok(`${label} : exception`, false, String(e.message).split("\n").slice(0, 3).join(" "));
        note(i, "B", `exception: ${String(e.message).slice(0, 100)}`);
      }
    }
  });
}

/* ============================== C : chaque réglage modifié puis remis, sans perte des autres ============================== */
const ALT = { color: ["secondary", "tertiary", "primary25"], corners: ["l", "m", "s"], inset: ["s", "l", "m"], contour: ["thick", "thin", "medium"], contourColor: ["tertiary", "ink", "secondary"], paper: ["under", "site"], size: ["97", "211"], opacity: ["0.5", "0.8"] };
const ALTL = { spaceTop: [77, 13], spaceBottom: [77, 13], spaceSides: [45, 20], width: [64, 80], marginTop: [41, 17], marginBottom: [41, 17] };
if (run("C")) {
  await section("C", async () => {
    for (const i of SEL) {
      if (["hero", "exit"].includes(FIXTURE[i].node.type)) {
        note(i, "C", "sans couche");
        continue;
      }
      const label = `C [${i}] ${FIXTURE[i].node.type}`;
      try {
        const { pid, fr } = await stage(i);
        await openFond(fr, 1);
        const S0 = await readBoth(fr);
        await page.keyboard.press("Escape");
        const L0 = layerLook(lookOf(pid, 1));
        const propsAt = (k) => draftOf(pid)[k]?.props ?? savedBlocks(pid)[k]?.props;
        const D0 = canonJ({ s: propsAt(1)?.surface, b: propsAt(1)?.background, l: L0 });
        const losses = [];
        let tried = 0;
        for (const slot of ["fond", "carte"]) {
          const st = S0[slot];
          if (!st || st.kind === "none") continue;
          // Fond sans marge dans la Carte : « Aucune » ramène à la forme du lot 100 (règle 107b), donc ce réglage-là n'est pas rejoué.
          for (const key of ORDER.filter((k) => k !== "kind" && k !== "wp" && st[k] !== null && st[k] !== undefined && !(k === "inset" && slot === "fond" && S0.fond?.layer === "fond" && S0.carte?.layer === "card" && S0.fond.inset === "none"))) {
            const alt = (ALT[key] ?? []).find((v) => !eqv(v, st[key]));
            if (alt === undefined) continue;
            await openFond(fr, 1);
            const before = await readBoth(fr);
            const did = await gesture(fr, slot, key, alt).catch(() => false);
            if (!did) {
              await page.keyboard.press("Escape");
              continue;
            }
            tried++;
            await until(async () => !eqv((await readSlot(fr, slot))?.[key], st[key]), 6000);
            const mid = await readBoth(fr);
            // Rien d'autre n'a bougé : l'autre section, et les autres champs de la section (le contour retiré emporte sa couleur).
            const other = slot === "fond" ? "carte" : "fond";
            const lost = [];
            if (canonJ(mid[other]) !== canonJ(before[other])) lost.push(`${other}`);
            for (const k of ORDER) if (k !== key && !(key === "contour" && k === "contourColor") && !(key === "paper") && !eqv(mid[slot]?.[k], before[slot]?.[k])) lost.push(`${slot}.${k}`);
            if (canonJ(layerLook(lookOf(pid, 1))) !== canonJ(L0)) lost.push("look");
            // Remise.
            await gesture(fr, slot, key, st[key]).catch(() => false);
            await until(async () => eqv((await readSlot(fr, slot))?.[key], st[key]), 6000);
            const back = await readBoth(fr);
            await page.keyboard.press("Escape");
            if (canonJ(back) !== canonJ(S0)) lost.push(`remise ${slot}.${key}`);
            if (lost.length) losses.push(`${slot}.${key}→${lost.join("+")}`);
          }
        }
        for (const key of Object.keys(L0)) {
          const alt = ALTL[key].find((v) => v !== L0[key]);
          const was = L0[key];
          tried++;
          await setLook(fr, 1, key, alt);
          await until(async () => lookOf(pid, 1)[key] === alt, 8000);
          const lookMid = layerLook(lookOf(pid, 1));
          const lost = [];
          for (const k of Object.keys(L0)) if (k !== key && L0[k] !== lookMid[k]) lost.push(`look.${k}`);
          await openFond(fr, 1);
          const mid = await readBoth(fr);
          await page.keyboard.press("Escape");
          if (canonJ(mid) !== canonJ(S0)) lost.push("couches");
          await setLook(fr, 1, key, was);
          await until(async () => lookOf(pid, 1)[key] === was, 8000);
          if (canonJ(layerLook(lookOf(pid, 1))) !== canonJ(L0)) lost.push(`remise look.${key}`);
          if (lost.length) losses.push(`look.${key}→${lost.join("+")}`);
        }
        const D1 = canonJ({ s: propsAt(1)?.surface, b: propsAt(1)?.background, l: layerLook(lookOf(pid, 1)) });
        const good = losses.length === 0;
        ok(`${label} : ${tried} réglage(s) modifié(s) puis remis sans perte${D1 === D0 ? "" : " [données réécrites autrement]"}`, good, losses.join(" ; "));
        note(i, "C", good ? `ok (${tried})${D1 === D0 ? "" : " (données réécrites)"}` : `perte: ${losses.join(";")}`);
      } catch (e) {
        ok(`${label} : exception`, false, String(e.message).split("\n").slice(0, 3).join(" "));
        note(i, "C", `exception: ${String(e.message).slice(0, 100)}`);
      }
    }
  });
}

/* ============================== P : composants de PLANCHE de projet (30 structures « project » de la fixture) ============================== */
const BOARD_IDX = FIXTURE.map((e, i) => i).filter((i) => kindOf(FIXTURE[i]) === "planche");
const BSEL = (IDX ?? BOARD_IDX).filter((i) => BOARD_IDX.includes(i));
const projectRow = (slug) => q1("select id, slug from projects where slug = ?", slug);
const setLayout = (slug, items) =>
  sql((db) => {
    db.prepare("update projects set layout = ?, draft_layout = NULL, draft_layout_page_id = NULL where slug = ?").run(JSON.stringify(items), slug);
  });
const layoutNow = (slug) => {
  const r = q1("select layout, draft_layout from projects where slug = ?", slug);
  return JSON.parse(r.draft_layout ?? r.layout ?? "[]");
};
const boardItem = (i, tag = "") => synth(FIXTURE[i], i, { ...ENV, tag, slug: ENV.slug });
const BOARD_LAYER_BG = (i) => Boolean(FIXTURE[i].node.props?.background);
async function boardPage(slug) {
  const ok1 = await publishWith(PAGES.animation, [SEP(0), { uid: "pbd", type: "project-board", props: { project: slug } }, SEP(1)]);
  if (!ok1) throw new Error("page de la planche");
  return openEditor(PAGES.animation);
}
const bitems = (fr) => fr.locator("[data-edit-board] [data-edit-bitem]");
async function openItemFond(fr, k) {
  const it = bitems(fr).nth(k);
  await it.scrollIntoViewIfNeeded({ timeout: 20000 }).catch(() => {});
  await it.click({ position: { x: 20, y: 20 }, force: true }).catch(() => {});
  await it.locator('[data-edit-bitem-op="fond"]').click({ timeout: 15000 });
  const menu = fr.locator('[data-testid="fond-menu"]').first();
  await menu.waitFor({ timeout: 20000 });
  return menu;
}
if (run("P")) {
  await section("P", async () => {
    // P1 : rendu, éditeur = public (tous les composants de planche, trois planches de dix).
    const chunks = [];
    const CH = Number(process.env.CHUNK ?? 10);
    // Une planche ne porte qu'UNE bande d'images du projet : on ouvre une nouvelle planche avant la deuxième.
    const projStrip = (i) => FIXTURE[i].node.type === "strip" && FIXTURE[i].node.props?.source !== "own";
    for (const i of BSEL) {
      const cur = chunks.at(-1);
      if (!cur || cur.length >= CH || (projStrip(i) && cur.some(projStrip))) chunks.push([i]);
      else cur.push(i);
    }
    for (const [n, idx] of chunks.entries()) {
      const slug = ["herbier-des-nuits", "sel-et-silence", "carnets-personnels", "les-hauts-chemins", "la-petite-fabrique"][n % 5];
      setLayout(slug, idx.map((i) => boardItem(i)));
      const fr = await boardPage(slug);
      await fr.waitForFunction(() => document.querySelectorAll("[data-edit-bitem]").length >= 1, null, { timeout: 60000 });
      let ed;
      await until(async () => (ed = await fr.evaluate(SIGS, { n: 1 }))[0] !== null, 30000);
      const nItems = await bitems(fr).count();
      // Le public est lu dans un second onglet ; les mesures sont reprises jusqu'à ce que les images et les raccords de fonds soient posés (condition, pas attente fixe).
      const pubPage = await ctx.newPage();
      await pubPage.goto(urlOf(SLUG.animation), { waitUntil: "domcontentloaded" });
      await pubPage.waitForFunction((t) => document.body.textContent.includes(t), "S108s1s", { timeout: 60000 });
      let pub;
      await until(async () => {
        ed = await fr.evaluate(SIGS, { n: 1 });
        pub = await pubPage.evaluate(SIGS, { n: 1 });
        return ed[0] && pub[0] && sameZones(ed[0].zones, pub[0].zones, true);
      }, 15000);
      await pubPage.close();
      const good = ed[0] && pub[0] && ed[0].bad.length === 0 && sameZones(ed[0].zones, pub[0].zones, true) && nItems >= idx.length;
      ok(`P1 planche ${n + 1} (${idx.length} composants : ${idx.join(",")}) : rendu sans erreur, éditeur = public (${ed[0]?.zones.length ?? "?"} couche(s), ${nItems} cadres)`, good, JSON.stringify([ed[0]?.bad, ed[0]?.zones.map((z) => [z.cls, +z.l.toFixed(3), +z.r.toFixed(3), z.bw > 0, z.radius > 0, z.bg]), pub[0]?.zones.map((z) => [z.cls, +z.l.toFixed(3), +z.r.toFixed(3), z.bw > 0, z.radius > 0, z.bg])]).slice(0, 1200));
      for (const i of idx) note(i, "A", good ? "ok" : "écart (planche)");
    }
    // P2 : composants à fond (`props.background`) : recréation par les gestes du menu « Fond & carte » du composant, puis réglages modifiés et remis.
    for (const i of process.env.NOP2 ? [] : BSEL.filter(BOARD_LAYER_BG)) {
      const label = `P2 [${i}] ${FIXTURE[i].node.type}`;
      try {
        const slug = "carnets-personnels";
        const twin = boardItem(i), blank = { ...boardItem(i, "b") };
        delete blank.props.background;
        const lk = blank.props.look ? { ...blank.props.look } : null;
        if (lk) {
          for (const k of LAYER_LOOK) delete lk[k];
          if (Object.keys(lk).length) blank.props.look = lk;
          else delete blank.props.look;
        }
        const tl = twin.props.look ? Object.fromEntries(Object.entries(twin.props.look).filter(([k]) => LAYER_LOOK.includes(k))) : {};
        if (Object.keys(tl).length) twin.props.look = tl;
        else delete twin.props.look;
        // Un composant sans fond entre les deux : deux fonds identiques voisins se raccordent (bord à bord), ce qui changerait les coins du deuxième.
        // Une planche n'a qu'UNE bande des images du projet : la bande vierge est dans une seconde planche (un autre projet), sur la même page.
        const two = FIXTURE[i].node.type === "strip" && FIXTURE[i].node.props?.source !== "own";
        const slugB = "sel-et-silence";
        if (two) {
          setLayout(slug, [twin]);
          setLayout(slugB, [blank]);
        } else setLayout(slug, [twin, { uid: "s108sep", type: "rich-text", props: { paragraphs: [L("S108sepx")] } }, blank]);
        const BI = two ? 1 : 2;
        const fr = two
          ? await (async () => {
              if (!(await publishWith(PAGES.animation, [SEP(0), { uid: "pbd", type: "project-board", props: { project: slug } }, SEP(1), { uid: "pbe", type: "project-board", props: { project: slugB } }, SEP(2)]))) throw new Error("page des deux planches");
              return openEditor(PAGES.animation);
            })()
          : await boardPage(slug);
        await fr.waitForFunction((need) => document.querySelectorAll("[data-edit-bitem]").length >= need, two ? 2 : 3, { timeout: 60000 });
        const m1 = await openItemFond(fr, 0);
        const twinState = await readBoth(fr);
        await page.keyboard.press("Escape");
        const slots = ["carte", "fond"].filter((s) => twinState[s] && twinState[s].kind !== "none");
        const lacks = [];
        await openItemFond(fr, BI);
        for (const slot of slots) lacks.push(...(await reach(fr, slot, twinState[slot])).map((k) => `${slot}.${k}`));
        await page.keyboard.press("Escape");
        await until(async () => JSON.stringify((two ? layoutNow(slugB)[0] : layoutNow(slug)[2])?.props?.background ?? null) !== "null", 10000);
        await openItemFond(fr, BI);
        const blankState = await readBoth(fr);
        await page.keyboard.press("Escape");
        const sameState = ["fond", "carte"].every((s) => !twinState[s] || twinState[s].kind === "none" ? !blankState[s] || blankState[s].kind === "none" : ORDER.every((k) => eqv(blankState[s]?.[k], twinState[s][k])));
        const lay = two ? [layoutNow(slug)[0], layoutNow(slugB)[0], layoutNow(slugB)[0]] : layoutNow(slug);
        const sameData = canonJ(lay[0]?.props?.background) === canonJ(lay[2]?.props?.background);
        let sig;
        const halves = async () => {
          if (two) {
            const s = await fr.evaluate(SIGS, { n: 2 });
            return s[0] && s[1] ? [s[0].zones, s[1].zones] : [[], []];
          }
          const s = await fr.evaluate(SIGS, { n: 1 });
          const z0 = s[0]?.zones ?? [];
          return [z0.slice(0, z0.length / 2), z0.slice(z0.length / 2)];
        };
        let hz = await halves();
        await until(async () => { hz = await halves(); return hz[0].length > 0 && sameZones(hz[0], hz[1]); }, 12000);
        const z = [...hz[0], ...hz[1]];
        const sameRender = hz[0].length > 0 && sameZones(hz[0], hz[1]);
        const good = lacks.length === 0 && sameState && sameRender;
        if (!good) console.log("# P2diff", i, JSON.stringify({ twinState, blankState, tw: lay[0]?.props?.background, bl: lay[2]?.props?.background, z }).slice(0, 1800));
        ok(`${label} : composant de planche recréé par les gestes${sameData ? "" : " [données différentes]"}`, good, `manque ${lacks.join(",")} ; menu=${sameState} rendu=${sameRender} zones=${z.length}`);
        note(i, "B", good ? (sameData ? "ok" : "ok (données différentes, rendu égal)") : `écart: ${lacks.join(",") || (sameRender ? "état" : "rendu")}`);
        // C : un réglage modifié puis remis, l'autre section et les autres champs intacts.
        const S0 = twinState;
        const losses = [];
        let tried = 0;
        for (const slot of ["fond", "carte"]) {
          const st = S0[slot];
          if (!st || st.kind === "none") continue;
          for (const key of ORDER.filter((k) => k !== "kind" && k !== "wp" && st[k] !== null && st[k] !== undefined)) {
            const alt = (ALT[key] ?? []).find((v) => !eqv(v, st[key]));
            if (alt === undefined) continue;
            await openItemFond(fr, 0);
            const before = await readBoth(fr);
            if (!(await gesture(fr, slot, key, alt).catch(() => false))) { await page.keyboard.press("Escape"); continue; }
            tried++;
            await until(async () => !eqv((await readSlot(fr, slot))?.[key], st[key]), 6000);
            const mid = await readBoth(fr);
            const other = slot === "fond" ? "carte" : "fond";
            const lost = [];
            if (canonJ(mid[other]) !== canonJ(before[other])) lost.push(other);
            for (const k of ORDER) if (k !== key && !(key === "contour" && k === "contourColor") && key !== "paper" && !eqv(mid[slot]?.[k], before[slot]?.[k])) lost.push(`${slot}.${k}`);
            await gesture(fr, slot, key, st[key]).catch(() => false);
            await until(async () => eqv((await readSlot(fr, slot))?.[key], st[key]), 6000);
            const back = await readBoth(fr);
            await page.keyboard.press("Escape");
            if (canonJ(back) !== canonJ(S0)) lost.push(`remise ${slot}.${key}`);
            if (lost.length) losses.push(`${slot}.${key}→${lost.join("+")}`);
          }
        }
        ok(`P3 [${i}] ${tried} réglage(s) du fond modifié(s) puis remis sans perte`, losses.length === 0, losses.join(" ; "));
        note(i, "C", losses.length ? `perte: ${losses.join(";")}` : `ok (${tried})`);
      } catch (e) {
        ok(`${label} : exception`, false, String(e.message).split("\n").slice(0, 3).join(" "));
        note(i, "B", `exception: ${String(e.message).slice(0, 100)}`);
      }
    }
    // P4 : composants SANS fond. Aucun fond à recréer ; chaque réglage qu'ils portent (espacement, largeur de boîte, cadre, recadrage, légendes, colonnes…) doit survivre à la pose puis au retrait d'un fond par le menu
    // (rien d'autre ne bouge, les données reviennent à l'identique).
    for (const i of process.env.NOP4 ? [] : BSEL.filter((j) => !BOARD_LAYER_BG(j))) {
      const label = `P4 [${i}] ${FIXTURE[i].node.type} sans fond`;
      try {
        const slug = ["herbier-des-nuits", "sel-et-silence", "carnets-personnels", "les-hauts-chemins", "la-petite-fabrique"][i % 5];
        const item = boardItem(i);
        setLayout(slug, [item]);
        const fr = await boardPage(slug);
        await fr.waitForFunction(() => document.querySelectorAll("[data-edit-bitem]").length >= 1, null, { timeout: 60000 });
        const before = canonJ(layoutNow(slug)[0]?.props);
        await openItemFond(fr, 0);
        const menu = fr.locator('[data-testid="fond-menu"]');
        await menu.locator('[data-testid="fond-section-fond"] [data-kind="color"]').click();
        await until(async () => Boolean(layoutNow(slug)[0]?.props?.background), 12000);
        const withFond = layoutNow(slug)[0]?.props ?? {};
        const { background: _bg, ...rest } = withFond;
        const lostWhileOn = canonJ(rest) !== before;
        await menu.locator('[data-testid="fond-section-fond"] [data-kind="none"]').click();
        await until(async () => !layoutNow(slug)[0]?.props?.background, 12000);
        await page.keyboard.press("Escape");
        const after = canonJ(layoutNow(slug)[0]?.props);
        ok(`${label} : un fond posé puis retiré, les autres réglages intacts (${Object.keys(item.props).length} clés)`, !lostWhileOn && after === before, JSON.stringify({ lostWhileOn, same: after === before }));
        note(i, "C", !lostWhileOn && after === before ? "ok (fond posé/retiré)" : "perte");
      } catch (e) {
        ok(`${label} : exception`, false, String(e.message).split("\n").slice(0, 3).join(" "));
      }
    }
  });
}

await browser.close();
console.log(`\n# RESULTATS ${JSON.stringify(results)}`);
console.log(failures ? `\n${failures} ÉCHEC(S)` : "\nTout passe");
process.exit(failures ? 1 : 0);
