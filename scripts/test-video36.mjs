#!/usr/bin/env node
/**
 * Lot 36 (« Lecteur vidéo ») — tests unitaires (inclus dans npm test) :
 *  1. Modes de lecture (src/blocks/video-mode.ts) : Boucle / Lecteur, défaut sûr.
 *  2. Migration 0027 (src/lib/db/video-mode.ts) : chaque composant Vidéo reçoit son mode explicite (publié, brouillons de page,
 *     planches `layout` et `draft_layout`, cases de grille de page et de planche), le mode déjà posé est gardé, les bandes ne sont
 *     pas touchées, `draft_rev` augmente, idempotente. Le journal et le fichier SQL de 0027 existent.
 *  3. Grille : l'opération `video-mode` règle la case d'une vidéo (jamais une image) ; le protocole accepte le message
 *     `video-mode` et l'opération de grille, refuse un mode inconnu.
 *  4. Planche : une bande accepte `videoMode` (Boucle / Lecteur), refuse une valeur inconnue.
 * Usage : node --import tsx scripts/test-video36.mjs
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";

import Database from "better-sqlite3";

import { applyGridOp } from "../src/blocks/grid-layouts.ts";
import { layoutProblem } from "../src/blocks/board-layout.ts";
import { isVideoMode, modeOf, VIDEO_MODES } from "../src/blocks/video-mode.ts";
import { migrateVideoModes, seedVideoModes } from "../src/lib/db/video-mode.ts";
import { acceptFromCanvas, EDIT_MSG } from "../src/lib/edit/protocol.ts";

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`PASS  ${name}`);
};
const kid = (uid, type, props = {}) => ({ uid, type, props });

/* ---- 1. Modes ----------------------------------------------------------------------------------------- */

test("modes : Boucle et Lecteur, sans réglage = Lecteur (le comportement d'avant)", () => {
  assert.deepEqual(VIDEO_MODES, ["loop", "player"]);
  assert.ok(isVideoMode("loop") && isVideoMode("player"));
  assert.ok(!isVideoMode("auto") && !isVideoMode(undefined) && !isVideoMode(1));
  assert.equal(modeOf({}), "player");
  assert.equal(modeOf(undefined), "player");
  assert.equal(modeOf({ mode: "loop" }), "loop");
  assert.equal(modeOf({ mode: "n'importe quoi" }), "player");
});

/* ---- 2. Migration ------------------------------------------------------------------------------------- */

test("migration d'une liste : mode absent ou illisible → Lecteur, mode posé gardé, enfants de grille compris, idempotente", () => {
  const list = [
    kid("a", "video-single", { variant: "card", mediaId: 1 }),
    kid("b", "video-single", { mode: "loop", mediaId: 2 }),
    kid("c", "video-single", { mode: "player", mediaId: 3 }),
    kid("d", "video-single", { mode: "auto", mediaId: 4 }),
    kid("g", "grid", { layout: "2", children: [kid("g1", "video-single", { mediaId: 5 }), kid("g2", "image", { mediaId: 6 }), kid("g3", "video-single", { mode: "loop", mediaId: 7 })] }),
    kid("s", "strip", { source: "own", media: [1, 2] }),
    kid("t", "rich-text", { paragraphs: [] }),
  ];
  assert.equal(migrateVideoModes(list), true);
  assert.deepEqual(
    list.slice(0, 4).map((x) => x.props.mode),
    ["player", "loop", "player", "player"],
  );
  assert.deepEqual(
    list[4].props.children.map((x) => x.props.mode),
    ["player", undefined, "loop"],
    "la case image n'a pas de mode",
  );
  assert.deepEqual(list[5].props, { source: "own", media: [1, 2] }, "la bande n'est pas touchée");
  assert.equal(migrateVideoModes(list), false, "idempotente");
  assert.equal(migrateVideoModes(null), false);
  assert.equal(migrateVideoModes([null, 3, { type: "video-single" }]), false);
});

function freshDb() {
  const db = new Database(":memory:");
  const dir = new URL("../drizzle/", import.meta.url).pathname;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    for (const stmt of readFileSync(dir + f, "utf8").split("--> statement-breakpoint")) if (stmt.trim()) db.exec(stmt);
  }
  return db;
}

test("migration 0027 : fichier SQL et entrée du journal", () => {
  const dir = new URL("../drizzle/", import.meta.url).pathname;
  assert.ok(existsSync(dir + "0027_video_mode.sql"));
  const journal = JSON.parse(readFileSync(dir + "meta/_journal.json", "utf8"));
  const tags = journal.entries.map((e) => e.tag);
  assert.ok(tags.includes("0027_video_mode"));
  const when = journal.entries.map((e) => e.when);
  assert.deepEqual([...when].sort((a, b) => a - b), when, "journal chronologique");
  assert.match(readFileSync(new URL("../src/lib/db/bootstrap.ts", import.meta.url), "utf8"), /"0027_video_mode"/);
});

test("migration 0027 sur une base : publié, brouillons de page, planches et brouillons de planche ; draft_rev ; idempotente", () => {
  const db = freshDb();
  const T = (s) => JSON.stringify({ fr: s, en: s });
  const page = db.prepare("insert into pages (slug, title, meta, nav_order, published, draft, draft_rev) values (?, ?, null, ?, 1, ?, 4)");
  const draft = (blocks) => JSON.stringify({ title: T("x"), blocks });
  const p1 = page.run(T("a"), T("A"), 0, draft([kid("d1", "video-single", { mediaId: 1 }), kid("d2", "grid", { layout: "2", children: [kid("d3", "video-single", { mode: "loop", mediaId: 2 })] })])).lastInsertRowid;
  const p2 = page.run(T("b"), T("B"), 1, draft([kid("e1", "video-single", { mode: "player", mediaId: 1 })])).lastInsertRowid;
  const p3 = page.run(T("c"), T("C"), 2, null).lastInsertRowid;
  const block = db.prepare("insert into blocks (page_id, position, type, props) values (?, ?, ?, ?)");
  block.run(p1, 0, "video-single", JSON.stringify({ variant: "plain", mediaId: 1 }));
  block.run(p1, 1, "grid", JSON.stringify({ layout: "2", children: [kid("k1", "video-single", { mediaId: 2 }), kid("k2", "video-single", { mode: "loop", mediaId: 3 })] }));
  block.run(p1, 2, "rich-text", JSON.stringify({ paragraphs: [] }));
  block.run(p3, 0, "video-single", JSON.stringify({ mode: "loop", mediaId: 9 }));
  const project = db.prepare("insert into projects (slug, title, context, description, year, featured, position, layout, draft_layout, draft_layout_page_id) values (?, ?, ?, ?, '2024', 0, ?, ?, ?, ?)");
  const layout = [kid("strip", "strip", {}), kid("v1", "video-single", { variant: "plain", mediaId: 4 }), kid("gr", "grid", { layout: "2", children: [kid("gv", "video-single", { mediaId: 5 })] })];
  const over = [kid("strip", "strip", { videoMode: "loop" }), kid("v1", "video-single", { mediaId: 4 })];
  project.run("pa", T("Pa"), T("c"), T(""), 1, JSON.stringify(layout), JSON.stringify(over), p2);
  project.run("pb", T("Pb"), T("c"), T(""), 2, null, null, null);

  const report = seedVideoModes(db);
  assert.deepEqual(report, { published: 2, drafts: 1, layouts: 1, draftLayouts: 1 });

  const blocks = db.prepare("select props from blocks order by id").all().map((r) => JSON.parse(r.props));
  assert.equal(blocks[0].mode, "player");
  assert.deepEqual(blocks[1].children.map((c) => c.props.mode), ["player", "loop"]);
  assert.equal(blocks[2].mode, undefined, "un texte n'a pas de mode");
  assert.equal(blocks[3].mode, "loop", "déjà réglé : non réécrit");

  const rows = db.prepare("select id, draft, draft_rev from pages order by id").all();
  const d1 = JSON.parse(rows[0].draft);
  assert.equal(d1.blocks[0].props.mode, "player");
  assert.equal(d1.blocks[1].props.children[0].props.mode, "loop");
  assert.equal(rows[0].draft_rev, 5, "brouillon réécrit : version + 1");
  assert.equal(rows[1].draft_rev, 4 + 1, "la page qui tient la surcouche de planche : version + 1 (le brouillon de page déjà à jour ne change pas de contenu)");
  assert.equal(JSON.parse(rows[1].draft).blocks[0].props.mode, "player");
  assert.equal(rows[2].draft, null);
  assert.equal(rows[2].draft_rev, 4, "page sans brouillon : version inchangée");

  const pr = db.prepare("select layout, draft_layout from projects order by id").all();
  const l = JSON.parse(pr[0].layout);
  assert.deepEqual(l[0].props, {}, "bande du projet intacte");
  assert.equal(l[1].props.mode, "player");
  assert.equal(l[2].props.children[0].props.mode, "player");
  const dl = JSON.parse(pr[0].draft_layout);
  assert.equal(dl[0].props.videoMode, "loop", "bande : réglage gardé");
  assert.equal(dl[1].props.mode, "player");
  assert.equal(pr[1].layout, null);
  assert.equal(pr[1].draft_layout, null);

  const before = JSON.stringify([blocks, rows, pr]);
  assert.deepEqual(seedVideoModes(db), { published: 0, drafts: 0, layouts: 0, draftLayouts: 0 }, "deuxième passage : rien à faire");
  assert.equal(JSON.stringify([db.prepare("select props from blocks order by id").all().map((r) => JSON.parse(r.props)), db.prepare("select id, draft, draft_rev from pages order by id").all(), db.prepare("select layout, draft_layout from projects order by id").all()]), before);
  db.close();
});

/* ---- 3. Grille et protocole --------------------------------------------------------------------------- */

test("grille : « video-mode » règle la case d'une vidéo, refuse une image et une case absente, sans effet si déjà réglée", () => {
  const props = { layout: "2", children: [kid("i", "image", { mediaId: 1 }), kid("v", "video-single", { mediaId: 2 })] };
  const res = applyGridOp(props, { op: "video-mode", index: 1, mode: "loop" });
  assert.ok("props" in res);
  assert.equal(res.props.children[1].props.mode, "loop");
  assert.equal(props.children[1].props.mode, undefined, "l'original n'est pas modifié");
  assert.ok("error" in applyGridOp(props, { op: "video-mode", index: 0, mode: "loop" }));
  assert.ok("error" in applyGridOp(props, { op: "video-mode", index: 5, mode: "loop" }));
  const again = applyGridOp(res.props, { op: "video-mode", index: 1, mode: "loop" });
  assert.equal(again.props, res.props);
});

test("protocole : message video-mode et opération de grille acceptés, mode inconnu refusé", () => {
  const origin = "https://portfolio.example";
  const frame = { name: "toile" };
  const msg = (data) => ({ origin, source: frame, data: { type: EDIT_MSG, ...data } });
  assert.equal(acceptFromCanvas(msg({ kind: "video-mode", uid: "b1", mode: "loop" }), origin, frame)?.mode, "loop");
  assert.equal(acceptFromCanvas(msg({ kind: "video-mode", uid: "b1", board: 3, item: "strip", props: "{}", mode: null }), origin, frame)?.mode, null);
  assert.equal(acceptFromCanvas(msg({ kind: "video-mode", uid: "b1", mode: "auto" }), origin, frame), null);
  assert.equal(acceptFromCanvas(msg({ kind: "video-mode", uid: "b1", board: 3, item: "image", mode: "loop" }), origin, frame)?.item, "image", "le type est contrôlé par l'éditeur, pas par le protocole");
  assert.equal(acceptFromCanvas(msg({ kind: "grid-op", uid: "g", op: { op: "video-mode", index: 2, mode: "player" } }), origin, frame)?.op?.mode, "player");
  assert.equal(acceptFromCanvas(msg({ kind: "grid-op", uid: "g", op: { op: "video-mode", index: 2, mode: "zzz" } }), origin, frame), null);
  assert.equal(acceptFromCanvas(msg({ kind: "grid-op", uid: "g", op: { op: "video-mode", index: -1, mode: "loop" } }), origin, frame), null);
});

/* ---- 4. Planche --------------------------------------------------------------------------------------- */

test("planche : une bande accepte « videoMode » (Boucle / Lecteur), pas une valeur inconnue", () => {
  const strip = (props) => [{ uid: "s", type: "strip", props }];
  assert.equal(layoutProblem(strip({})), null);
  assert.equal(layoutProblem(strip({ videoMode: "loop" })), null);
  assert.equal(layoutProblem(strip({ source: "own", media: [1], videoMode: "player" })), null);
  assert.ok(layoutProblem(strip({ videoMode: "auto" })));
  assert.ok(layoutProblem(strip({ source: "own", media: [], videoMode: 3 })));
});

console.log(`\n${passed} tests OK`);
