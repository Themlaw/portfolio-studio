#!/usr/bin/env node
/**
 * Lot 62 (« Cadres des photos et des vidéos ») — tests unitaires (inclus dans npm test) :
 *  1. Modèle : UN choix `{ kind: none | theme | band | custom, id?, color?, width? }`, validation (dont `custom` prévu), anciennes valeurs relues.
 *  2. Rendu : `frameStyle` est le seul point (attributs + variables), photo et vidéo ; pas de choix = aucun attribut.
 *  3. Migration 0028 (src/lib/db/frame-choice.ts) : `look.frame`, `look.slotFrame`, `items[].frame` de la Planche libre, cases de grille, planches
 *     (`layout` ET `draft_layout`), brouillons de page, publié ; le rendu des choix explicites ne change pas ; les photos sans cadre ne sont pas
 *     touchées ; `draft_rev` augmente ; idempotente. Journal, fichier SQL et bootstrap existent.
 *  4. Protocole : le message `media-look` (ex-`bitem-frame` et opération de planche libre `style`) acceptent la nouvelle forme (et l'ancienne), refusent une valeur inconnue.
 *  5. Réglage du site « Cadre du thème sur toutes les photos » : non par défaut.
 * Usage : node --import tsx scripts/test-cadres62.mjs
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

import Database from "better-sqlite3";

import { freeBoardSchema } from "../src/blocks/free-board.ts";
import { migrateFrames, seedFrameChoices } from "../src/lib/db/frame-choice.ts";
import { acceptFromCanvas, EDIT_MSG } from "../src/lib/edit/protocol.ts";
import { FrameSchema, frameStyle, LookSchema, readLook, readThemeFrameAll, upgradeFrame } from "../src/lib/look.ts";

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`PASS  ${name}`);
};
const kid = (uid, type, props = {}) => ({ uid, type, props });
const T = (s) => JSON.stringify({ fr: s, en: s });

/* ---- 1. Modèle ------------------------------------------------------------------------------------------ */

test("modèle : les quatre choix et leurs réglages", () => {
  for (const f of [{ kind: "none" }, { kind: "theme" }, { kind: "band" }, { kind: "band", width: "fin", color: "primary" }, { kind: "band", width: "epais", color: "#a1b2c3" }, { kind: "custom", id: "bois-clair" }]) {
    assert.ok(FrameSchema.safeParse(f).success, JSON.stringify(f));
  }
  for (const f of [{ kind: "huge" }, {}, { kind: "none", width: "fin" }, { kind: "theme", color: "primary" }, { kind: "custom" }, { kind: "band", id: "x" }, { kind: "custom", id: "A B" }, { kind: "band", width: "medium" }, { kind: "band", color: "red" }, { kind: "band", x: 1 }, "band", 3, [], null]) {
    assert.ok(!FrameSchema.safeParse(f).success, JSON.stringify(f));
  }
});

test("modèle : anciennes valeurs relues sans changer le rendu d'un choix explicite", () => {
  assert.deepEqual(upgradeFrame({ size: "none" }), { kind: "none" });
  assert.deepEqual(upgradeFrame({ size: "thin" }), { kind: "band", width: "fin" });
  assert.deepEqual(upgradeFrame({ size: "medium", color: "primary" }), { kind: "band", width: "moyen", color: "primary" });
  assert.deepEqual(upgradeFrame({ size: "thick", color: "#a1b2c3cc" }), { kind: "band", width: "epais", color: "#a1b2c3cc" });
  for (const same of [{ kind: "theme" }, { size: "huge" }, { size: "thin", extra: 1 }, "x", null, undefined, 4]) assert.deepEqual(upgradeFrame(same), same);
  assert.deepEqual(upgradeFrame(upgradeFrame({ size: "thick" })), { kind: "band", width: "epais" }, "idempotent");
  // Lues par les schémas (sauvegarde ancienne, brouillon non migré) : même résultat.
  assert.deepEqual(readLook({ frame: { size: "thin" } }), { frame: { kind: "band", width: "fin" } });
  assert.deepEqual(readLook({ slotFrame: { a: { size: "none" }, b: { size: "thick", color: "tertiary" } } }), { slotLook: { a: { frame: { kind: "none" } }, b: { frame: { kind: "band", color: "tertiary", width: "epais" } } } });
  assert.ok(LookSchema.safeParse({ frame: { size: "medium" } }).success);
  assert.ok(!FrameSchema.safeParse({ size: "huge" }).success);
});

/* ---- 2. Rendu ------------------------------------------------------------------------------------------- */

test("rendu : frameStyle, un seul point, exactement le choix", () => {
  assert.equal(frameStyle(undefined), null);
  assert.equal(frameStyle(null), null);
  assert.equal(frameStyle({ kind: "huge" }), null);
  assert.deepEqual(frameStyle({ kind: "none" }), { attrs: { "data-frame": "none" }, style: {} });
  assert.deepEqual(frameStyle({ kind: "theme" }), { attrs: { "data-frame": "theme" }, style: {} });
  assert.deepEqual(frameStyle({ kind: "band" }), { attrs: { "data-frame": "band", "data-frame-w": "moyen" }, style: { "--frame-color": "var(--color-ink)" } });
  assert.deepEqual(frameStyle({ kind: "band", width: "fin", color: "secondary" }), { attrs: { "data-frame": "band", "data-frame-w": "fin" }, style: { "--frame-color": "var(--t-color-secondary)" } });
  assert.deepEqual(frameStyle({ kind: "custom", id: "bois" }), { attrs: { "data-frame": "custom", "data-frame-id": "bois" }, style: {} });
  // Ancienne forme : même rendu qu'avant pour un choix explicite.
  assert.deepEqual(frameStyle({ size: "thick", color: "#000000" }), { attrs: { "data-frame": "band", "data-frame-w": "epais" }, style: { "--frame-color": "#000000" } });
  assert.equal(frameStyle({ size: "none" }).attrs["data-frame"], "none");
});

test("rendu : une seule boîte (MediaFrame) porte le cadre de la photo ET de la vidéo, jamais d'« interrupteur » ancien", () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  const mediaFrame = read("../src/app/media-frame.css");
  const variants = read("../src/themes/variants.css");
  assert.match(mediaFrame, /\.media-frame\[data-frame="band"\] \{/);
  assert.match(variants, /\[data-kit-frame\] :is\(\s*\.media-frame\[data-frame="theme"\],/);
  assert.match(variants, /\[data-frame-all\] \.media-frame\[data-kind="image"\]:not\(\[data-frame\]\)/);
  // Sans choix et sans réglage du site, aucune règle ne pose le cadre du thème (les règles « sans choix » passent toutes par [data-frame-all]).
  for (const rule of variants.split("}")) {
    if (/border-image-source: var\(--t-kit-frame\)/.test(rule) && /not\(\[data-frame\]\)/.test(rule)) {
      for (const sel of rule.split("{")[0].split(",")) if (/not\(\[data-frame\]\)/.test(sel)) assert.match(sel, /\[data-frame-all\]/, sel.trim());
    }
  }
});

/* ---- 3. Migration 0028 --------------------------------------------------------------------------------- */

function freshDb() {
  const db = new Database(":memory:");
  const dir = new URL("../drizzle/", import.meta.url).pathname;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    for (const stmt of readFileSync(dir + f, "utf8").split("--> statement-breakpoint")) if (stmt.trim()) db.exec(stmt);
  }
  return db;
}

test("migration 0028 : fichier SQL, entrée du journal, bootstrap", () => {
  const dir = new URL("../drizzle/", import.meta.url).pathname;
  assert.ok(readdirSync(dir).includes("0028_cadre_choix.sql"));
  const journal = JSON.parse(readFileSync(dir + "meta/_journal.json", "utf8"));
  assert.ok(journal.entries.map((e) => e.tag).includes("0028_cadre_choix"));
  const when = journal.entries.map((e) => e.when);
  assert.deepEqual([...when].sort((a, b) => a - b), when, "journal chronologique");
  assert.match(readFileSync(new URL("../src/lib/db/bootstrap.ts", import.meta.url), "utf8"), /"0028_cadre_choix"/);
});

test("migration 0028 : parcours d'un arbre (look.frame, slotFrame, items[].frame, cases de grille)", () => {
  const tree = [
    kid("a", "image", { look: { frame: { size: "thin" } } }),
    kid("b", "image", { look: { frame: { size: "none" }, imageSize: "large" } }),
    kid("c", "grid", { children: [kid("d", "image", { look: { frame: { size: "thick", color: "primary" } } }), kid("e", "video-single", { look: { frame: { kind: "theme" } } })] }),
    kid("f", "strip", { look: { slotFrame: { x: { size: "medium", color: "#112233" }, y: { kind: "none" }, z: { size: "none" } } } }),
    kid("g", "free-board", { items: [{ id: "i1", media: 1, x: 1, y: 1, w: 10, frame: { size: "thick" } }, { id: "i2", media: 2, x: 1, y: 1, w: 10 }] }),
    kid("h", "image", { look: { crop: { mediaId: { x: 1, y: 2, zoom: 1 } } } }),
    kid("i", "image", { look: { frame: { size: "huge" } } }),
  ];
  assert.equal(migrateFrames(tree), true);
  assert.deepEqual(tree[0].props.look.frame, { kind: "band", width: "fin" });
  assert.deepEqual(tree[1].props.look, { frame: { kind: "none" }, imageSize: "large" });
  assert.deepEqual(tree[2].props.children[0].props.look.frame, { kind: "band", width: "epais", color: "primary" });
  assert.deepEqual(tree[2].props.children[1].props.look.frame, { kind: "theme" }, "déjà à la nouvelle forme : intact");
  assert.deepEqual(tree[3].props.look.slotFrame, { x: { kind: "band", width: "moyen", color: "#112233" }, y: { kind: "none" }, z: { kind: "none" } });
  assert.deepEqual(tree[4].props.items[0].frame, { kind: "band", width: "epais" });
  assert.equal("frame" in tree[4].props.items[1], false, "photo sans cadre : pas touchée");
  assert.deepEqual(tree[5].props.look, { crop: { mediaId: { x: 1, y: 2, zoom: 1 } } });
  assert.deepEqual(tree[6].props.look.frame, { size: "huge" }, "valeur illisible : laissée telle quelle (ignorée à la lecture)");
  assert.equal(migrateFrames(tree), false, "idempotent");
  // Chaque valeur migrée est valide pour le schéma, et rend comme avant.
  for (const f of [tree[0].props.look.frame, tree[2].props.children[0].props.look.frame, tree[3].props.look.slotFrame.x]) assert.ok(FrameSchema.safeParse(f).success);
  assert.ok(freeBoardSchema.safeParse({ format: "3:2", phone: "scale", items: tree[4].props.items }).success);
});

test("migration 0028 sur une base : publié, brouillons de page, planches et brouillons de planche ; draft_rev ; idempotente", () => {
  const db = freshDb();
  const page = db.prepare("insert into pages (slug, title, meta, nav_order, published, draft, draft_rev) values (?, ?, null, ?, 1, ?, 4)");
  const draft = (blocks) => JSON.stringify({ title: T("x"), blocks });
  const p1 = page.run(T("a"), T("A"), 0, draft([kid("d1", "image", { mediaId: 1, look: { frame: { size: "medium" } } }), kid("d2", "grid", { layout: "2", children: [kid("d3", "image", { mediaId: 2, look: { frame: { size: "none" } } })] })])).lastInsertRowid;
  const p2 = page.run(T("b"), T("B"), 1, draft([kid("e1", "image", { mediaId: 1 })])).lastInsertRowid;
  const p3 = page.run(T("c"), T("C"), 2, null).lastInsertRowid;
  const block = db.prepare("insert into blocks (page_id, position, type, props) values (?, ?, ?, ?)");
  block.run(p1, 0, "image", JSON.stringify({ mediaId: 1, look: { frame: { size: "thick", color: "tertiary" } } }));
  block.run(p1, 1, "free-board", JSON.stringify({ format: "3:2", phone: "scale", items: [{ id: "a1", media: 1, x: 1, y: 1, w: 30, frame: { size: "thin" } }] }));
  block.run(p1, 2, "rich-text", JSON.stringify({ paragraphs: [] }));
  block.run(p3, 0, "image", JSON.stringify({ mediaId: 9, look: { frame: { kind: "band", width: "fin" } } }));
  block.run(p3, 1, "image", JSON.stringify({ mediaId: 9 }));
  const project = db.prepare("insert into projects (slug, title, context, description, year, featured, position, layout, draft_layout, draft_layout_page_id) values (?, ?, ?, ?, '2024', 0, ?, ?, ?, ?)");
  const layout = [kid("strip", "strip", { look: { slotFrame: { s1: { size: "thin" } } } }), kid("v1", "image", { mediaId: 4, look: { frame: { size: "thick" } } })];
  const over = [kid("strip", "strip", {}), kid("v1", "image", { mediaId: 4, look: { frame: { size: "none" } } })];
  project.run("pa", T("Pa"), T("c"), T(""), 1, JSON.stringify(layout), JSON.stringify(over), p2);
  project.run("pb", T("Pb"), T("c"), T(""), 2, null, null, null);

  assert.deepEqual(seedFrameChoices(db), { published: 2, drafts: 1, layouts: 1, draftLayouts: 1 });
  const blocks = db.prepare("select props from blocks order by id").all().map((r) => JSON.parse(r.props));
  assert.deepEqual(blocks[0].look.frame, { kind: "band", width: "epais", color: "tertiary" });
  assert.deepEqual(blocks[1].items[0].frame, { kind: "band", width: "fin" });
  assert.deepEqual(blocks[2], { paragraphs: [] });
  assert.deepEqual(blocks[3].look.frame, { kind: "band", width: "fin" }, "déjà migré : intact");
  assert.equal(blocks[4].look, undefined, "photo sans cadre : toujours sans cadre (elle suit le réglage du site)");
  const rows = db.prepare("select id, draft, draft_rev from pages order by id").all();
  const d1 = JSON.parse(rows[0].draft);
  assert.deepEqual(d1.blocks[0].props.look.frame, { kind: "band", width: "moyen" });
  assert.deepEqual(d1.blocks[1].props.children[0].props.look.frame, { kind: "none" });
  assert.equal(rows[0].draft_rev, 5, "brouillon réécrit : version + 1");
  assert.equal(rows[1].draft_rev, 5, "la page qui tient la surcouche de planche : version + 1");
  assert.equal(rows[2].draft, null);
  assert.equal(rows[2].draft_rev, 4, "page sans brouillon : version inchangée");
  const pr = db.prepare("select layout, draft_layout from projects order by id").all();
  assert.deepEqual(JSON.parse(pr[0].layout)[0].props.look.slotFrame.s1, { kind: "band", width: "fin" });
  assert.deepEqual(JSON.parse(pr[0].layout)[1].props.look.frame, { kind: "band", width: "epais" });
  assert.deepEqual(JSON.parse(pr[0].draft_layout)[1].props.look.frame, { kind: "none" });
  assert.equal(pr[1].layout, null);
  const snap = () => JSON.stringify([db.prepare("select props from blocks order by id").all(), db.prepare("select id, draft, draft_rev from pages order by id").all(), db.prepare("select layout, draft_layout from projects order by id").all()]);
  const before = snap();
  assert.deepEqual(seedFrameChoices(db), { published: 0, drafts: 0, layouts: 0, draftLayouts: 0 }, "deuxième passage : rien à faire");
  assert.equal(snap(), before, "rien n'a bougé");
  db.close();
});

/* ---- 4. Protocole --------------------------------------------------------------------------------------- */

test("protocole : media-look (cadre) accepte la nouvelle forme (et l'ancienne), refuse une valeur inconnue ; plus de bitem-frame", () => {
  const origin = "http://localhost";
  const parent = {};
  const send = (data) => acceptFromCanvas({ origin, source: parent, data: { type: EDIT_MSG, ...data } }, origin, parent);
  const target = { kind: "item", board: 1, uid: "b1" };
  for (const frame of [{ kind: "band", width: "fin" }, { kind: "theme" }, { kind: "none" }, { size: "thick" }, null]) assert.ok(send({ kind: "media-look", target, patch: { frame } }) !== null, JSON.stringify(frame));
  for (const frame of [{ kind: "huge" }, { size: "huge" }, { kind: "custom" }, "band"]) assert.equal(send({ kind: "media-look", target, patch: { frame } }), null, JSON.stringify(frame));
  assert.equal(send({ kind: "bitem-frame", board: 1, uid: "b1", frame: null }), null, "ancienne intention retirée");
});

/* ---- 5. Réglage du site -------------------------------------------------------------------------------- */

test("réglage « Cadre du thème sur toutes les photos » : non par défaut", () => {
  assert.equal(readThemeFrameAll(undefined), false);
  assert.equal(readThemeFrameAll(null), false);
  assert.equal(readThemeFrameAll("true"), false);
  assert.equal(readThemeFrameAll(true), true);
});

/* ---- 7. Sécurité : sharp dans la requête d'import (docs/SECURITE.md §2.6) ------------------------------------------ */

{
  // frames.ts importe « svgo/browser » (export ESM seul) : tsx le charge en CommonJS, on lui indique le fichier.
  const { registerHooks } = await import("node:module");
  const svgoBrowser = new URL("../node_modules/svgo/dist/svgo.browser.js", import.meta.url).href;
  registerHooks({ resolve: (spec, ctx, next) => (spec === "svgo/browser" ? { url: svgoBrowser, format: "module", shortCircuit: true } : next(spec, ctx)) });
  const { processSvg, processBitmap } = await import("../src/lib/edit/frames.ts");
  const { default: sharp } = await import("sharp");
  const src = readFileSync(new URL("../src/lib/edit/frames.ts", import.meta.url), "utf8");

  test("rendu d'un SVG : taille fixe (≤ 1200 px, sans suréchantillonnage), borne de pixels et délai explicites", () => {
    assert.ok(!/density:\s*96\s*\*\s*2/.test(src), "plus de density × 2");
    assert.match(src, /density:\s*72\s*\*\s*scale,\s*limitInputPixels:\s*RASTER_MAX_PIXELS/);
    assert.match(src, /const RASTER_SIDE = 1200;/);
    assert.equal((src.match(/\.timeout\(\{ seconds: SHARP_TIMEOUT_S \}\)/g) ?? []).length, 3, "délai sur le rendu SVG, le décodage et les encodeurs");
    assert.match(src, /decodeProblem\(\{ \.\.\.meta/);
  });

  // Bord déduit : identique à l'ancien rendu (vérifié sur 35 cadres de 37 à 4096 px) ; ici quelques cas exacts.
  const ring = (w, h, t) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><path fill-rule="evenodd" fill="#123" d="M0 0H${w}V${h}H0Z M${t} ${t}V${h - t}H${w - t}V${t}Z"/></svg>`);
  for (const [w, h, t] of [[300, 300, 30], [4096, 4096, 300], [2400, 1600, 120], [120, 80, 12]]) {
    const r = await processSvg(ring(w, h, t));
    assert.equal(typeof r, "object", String(r));
    assert.ok(r.detected && r.slice.every((s) => Math.abs(s - t) <= 1), `${w}×${h} bord ${t} : ${JSON.stringify(r.slice)}`);
    passed++;
    console.log(`PASS  SVG ${w}×${h} : bord ${t} px retrouvé (${JSON.stringify(r.slice)})`);
  }

  // Bitmap au-delà de 40 Mpx : refusé sur l'en-tête, sans décodage (PNG tronqué : en-tête IHDR et quelques octets de données).
  const { crc32, deflateSync } = await import("node:zlib");
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(10000, 0);
  ihdr.writeUInt32BE(5000, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const huge = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.alloc(64))), chunk("IEND", Buffer.alloc(0))]);
  const big = await processBitmap(huge);
  assert.ok(typeof big === "string" && /trop grande/.test(big), String(big));
  passed++;
  console.log("PASS  bitmap de 50 Mpx refusé sur l'en-tête (aucun décodage)");

  // Budget de décodage : un WebP (décodé d'un bloc) au-delà du budget est refusé avant d'ouvrir.
  const rgba = Buffer.alloc(4000 * 4000 * 4, 0);
  const webp = await sharp(rgba, { raw: { width: 4000, height: 4000, channels: 4 } }).webp({ lossless: true }).toBuffer();
  const before = process.env.IMAGE_DECODE_BUDGET_MB;
  process.env.IMAGE_DECODE_BUDGET_MB = "50";
  const refused = await processBitmap(webp);
  if (before === undefined) delete process.env.IMAGE_DECODE_BUDGET_MB;
  else process.env.IMAGE_DECODE_BUDGET_MB = before;
  assert.ok(typeof refused === "string" && /trop lourde à ouvrir/.test(refused), String(refused));
  passed++;
  console.log("PASS  bitmap au-delà du budget de décodage refusé (decodeProblem)");

  // Cadre PNG ordinaire : toujours accepté, bord trouvé.
  const w = 400;
  const px = Buffer.alloc(w * w * 4);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) if (x < 40 || y < 40 || x >= w - 40 || y >= w - 40) px.set([200, 30, 30, 255], (y * w + x) * 4);
  const okPng = await processBitmap(await sharp(px, { raw: { width: w, height: w, channels: 4 } }).png().toBuffer());
  assert.ok(typeof okPng === "object" && okPng.detected && okPng.slice.every((s) => s === 40), JSON.stringify(okPng.slice ?? okPng));
  passed++;
  console.log("PASS  cadre PNG ordinaire accepté, bord de 40 px retrouvé");
}

console.log(`\n${passed} test(s) réussi(s)`);
