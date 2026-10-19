#!/usr/bin/env node
/**
 * Lot 39 — Titre / Légende / Date sous les médias, sur une VRAIE base, sans serveur :
 *  1. schémas : image, vidéo, grille acceptent captionTitle / caption / captionDate (texte long permis), refusent un texte démesuré ;
 *  2. bande d'images : `props.captions` lu (entrées illisibles ignorées), chemin `captions.<place>.<champ>` ;
 *  3. gestes serveur sur une planche : texte d'une image, d'une grille entière, d'une case de grille, d'une place de carrousel,
 *     date de la bande du projet ; refus d'un chemin hors liste ; Annuler/Rétablir par les instantanés ;
 *  4. publication : les textes arrivent en base (planche publiée) ;
 *  5. protocole : le chemin d'un texte de case et d'une place passe le schéma des messages.
 * Usage : node --import tsx scripts/test-legendes39.mjs
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "pf-test-legendes39-"));
process.env.DATA_DIR = dir;
const log = console.log;
console.log = () => {};
const { bootstrap } = await import("../src/lib/db/bootstrap.ts");
await bootstrap();
console.log = log;
const { getDb, schema } = await import("../src/lib/db/index.ts");
const { layoutProblem, stripCaptions, parseCaptionPath } = await import("../src/blocks/board-layout.ts");
const { BLOCKS } = await import("../src/blocks/registry.ts");
const { readDraft, saveDraft, publishDraft, discardDraft } = await import("../src/lib/edit/drafts.ts");
const { createPage } = await import("../src/lib/edit/pages.ts");
const { boardOp, readBoard } = await import("../src/lib/edit/boards.ts");
const { FromCanvasSchema, inlineAllowed } = await import("../src/lib/edit/protocol.ts");

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log(`PASS  ${name}`);
};
const db = getDb();
const L = (s) => ({ fr: s, en: s });
const rev = (id) => readDraft(id).rev;
const base = (id) => readDraft(id).draft;
const [P] = db.select().from(schema.projects).all();
const media = db.select().from(schema.media).all().filter((m) => m.kind === "image" && m.status === "ready");
const [m1, m2] = media.map((m) => m.id);

await test("schémas : Titre / Légende / Date sur l'image, la vidéo et la grille", () => {
  const long = "x".repeat(1500);
  const image = BLOCKS.image.schema;
  assert.equal(image.safeParse({ mediaId: m1, caption: { fr: long, en: "" }, captionTitle: L("T"), captionDate: L("mars 2026") }).success, true, "légende longue permise");
  assert.equal(image.safeParse({ mediaId: m1, captionDate: { fr: "x".repeat(2001), en: "" } }).success, false, "texte démesuré refusé");
  assert.equal(image.safeParse({ mediaId: m1, caption: L("ancienne") }).success, true, "une légende existante reste valide");
  const video = BLOCKS["video-single"].schema;
  assert.equal(video.safeParse({ mediaId: m1, variant: "plain", captionTitle: L("T"), captionDate: L("2026"), description: L("L") }).success, true);
  const grid = BLOCKS.grid.schema;
  assert.equal(grid.safeParse({ layout: "2", caption: L("sous la grille"), captionTitle: L("T"), captionDate: L("D"), children: [] }).success, true);
  // Les champs sont modifiables en place (liste `inline` du registre).
  for (const [type, path] of [["image", "captionDate"], ["image", "caption"], ["image", "captionTitle"], ["grid", "caption"], ["grid", "captionDate"], ["video-single", "captionTitle"], ["video-single", "captionDate"], ["video-single", "description"]]) {
    assert.ok(inlineAllowed(BLOCKS[type].inline, path), `${type}.${path}`);
  }
});

await test("bande d'images : textes des places lus, entrées illisibles ignorées", () => {
  const props = { captions: { "a-p0": { title: L("T"), date: L("2026") }, "B Bad": { title: L("x") }, "a-p1": { title: "pas localisé", caption: L("ok") }, "a-p2": 5 } };
  assert.deepEqual(stripCaptions(props), { "a-p0": { title: L("T"), date: L("2026") }, "a-p1": { caption: L("ok") } });
  assert.deepEqual(stripCaptions({}), {});
  assert.deepEqual(parseCaptionPath("captions.car-p0.date"), { key: "car-p0", field: "date" });
  assert.equal(parseCaptionPath("captions.car-p0.alt"), null);
  assert.equal(parseCaptionPath("captions.BAD.date"), null);
  assert.equal(parseCaptionPath("title"), null);
  const item = (captions) => [{ uid: "r", type: "strip", props: { source: "own", media: [1], captions } }];
  assert.equal(layoutProblem(item({ "r-p0": { date: L("2026") } })), null);
  assert.ok(layoutProblem(item({ "r-p0": { date: "2026" } })));
  assert.ok(layoutProblem(item({ "BAD KEY": { date: L("x") } })));
  assert.ok(layoutProblem(item({ "r-p0": { surprise: L("x") } })));
  assert.ok(layoutProblem(item([])), "pas une liste");
});

await test("planche : textes d'une image, d'une grille, d'une case, d'un carrousel et de la bande du projet", () => {
  const page = createPage({ title: L("t39"), slug: L("t39") }).data.id;
  assert.equal(saveDraft(page, { ...base(page), blocks: [{ uid: "b", type: "project-board", props: { project: P.slug } }] }, rev(page)).ok, true);
  const item = (uid) => readBoard(page, P.id).layout.find((i) => i.uid === uid);
  const text = (uid, p, value, locale = "fr") => boardOp(page, P.id, { op: "item-text", uid, path: p, locale, value }, rev(page));
  assert.equal(boardOp(page, P.id, { op: "item-add", type: "image", index: 1, uid: "img" }, rev(page)).ok, true);
  assert.equal(boardOp(page, P.id, { op: "item-media", uid: "img", mediaId: m1 }, rev(page)).ok, true);
  assert.equal(text("img", "captionTitle", "Mon titre").ok, true);
  assert.equal(text("img", "caption", "Une légende").ok, true);
  assert.equal(text("img", "captionDate", "2026").ok, true);
  assert.equal(text("img", "captionDate", "2027", "en").ok, true);
  assert.deepEqual(item("img").props.captionDate, { fr: "2026", en: "2027" }, "FR et EN sont deux textes d'un même champ");
  assert.equal(item("img").props.captionTitle.fr, "Mon titre");
  // Grille : ses propres textes et ceux de ses cases.
  assert.equal(boardOp(page, P.id, { op: "item-add", type: "grid", index: 2, uid: "gr" }, rev(page)).ok, true);
  assert.equal(boardOp(page, P.id, { op: "item-media", uid: "gr", mediaId: m1 }, rev(page)).ok, true);
  assert.equal(boardOp(page, P.id, { op: "item-media", uid: "gr", mediaId: m2 }, rev(page)).ok, true);
  assert.equal(text("gr", "caption", "Sous la grille").ok, true);
  assert.equal(text("gr", "captionDate", "été 2026").ok, true);
  assert.equal(text("gr", "children.1.props.captionTitle", "Case 2").ok, true);
  assert.equal(text("gr", "children.0.props.caption", "Case 1").ok, true);
  assert.equal(item("gr").props.caption.fr, "Sous la grille");
  assert.equal(item("gr").props.children[1].props.captionTitle.fr, "Case 2");
  assert.equal(item("gr").props.children[0].props.caption.fr, "Case 1");
  assert.equal(text("gr", "layout", "1").ok, false, "un réglage n'est pas un texte");
  assert.equal(text("gr", "children.0.props.mediaId", "1").ok, false, "ni le média d'une case");
  assert.equal(text("gr", "children.9.props.caption", "x").ok, false, "case absente");
  // Carrousel à liste propre : les trois champs de chaque place.
  assert.equal(boardOp(page, P.id, { op: "item-add", type: "strip", index: 3, uid: "car" }, rev(page)).ok, true);
  assert.equal(boardOp(page, P.id, { op: "item-media", uid: "car", mediaId: m1 }, rev(page)).ok, true);
  const place = item("car").props.ids[0];
  const key = `car-${place}`;
  assert.equal(text("car", `captions.${key}.title`, "Vue 1").ok, true);
  assert.equal(text("car", `captions.${key}.date`, "2026").ok, true);
  assert.deepEqual(stripCaptions(item("car").props)[key], { title: { fr: "Vue 1", en: "" }, date: { fr: "2026", en: "" } });
  assert.equal(text("car", "captions.BAD KEY.date", "x").ok, false);
  assert.equal(text("car", "captions.car-p0.alt", "x").ok, false, "champ inconnu");
  assert.equal(text("car", "media", "x").ok, false, "la liste d'images n'est pas un texte");
  // Bande du projet : la date seulement (le titre et la légende restent ceux de l'emplacement).
  assert.equal(text("strip", `captions.${P.slug}-1.date`, "juin 2026").ok, true);
  assert.equal(stripCaptions(item("strip").props)[`${P.slug}-1`].date.fr, "juin 2026");
  // Publication : tout arrive en base.
  const pub = publishDraft(page, rev(page));
  assert.equal(pub.ok, true, JSON.stringify(pub));
  const stored = db.select().from(schema.projects).all().find((p) => p.id === P.id).layout;
  assert.equal(stored.find((i) => i.uid === "img").props.captionTitle.fr, "Mon titre");
  assert.equal(stored.find((i) => i.uid === "gr").props.children[1].props.captionTitle.fr, "Case 2");
  assert.equal(stored.find((i) => i.uid === "car").props.captions[key].title.fr, "Vue 1");
  discardDraft(page, rev(page));
});

await test("protocole : chemins de texte d'une case de grille et d'une place de carrousel", () => {
  const msg = (path) => ({ kind: "bitem-text", board: 1, uid: "gr", path, locale: "fr", value: "x" });
  const ok = (path) => FromCanvasSchema.safeParse(msg(path)).success;
  assert.ok(ok("caption"));
  assert.ok(ok("paragraphs.0"), "chemin d'avant : inchangé");
  assert.ok(ok("children.2.props.captionDate"));
  assert.ok(ok("captions.car-p0.title"));
  assert.ok(!ok("../x"));
  assert.ok(!ok("a b"));
  assert.ok(!ok("children..props"));
  assert.ok(!ok("a.b.c.d.e"));
});

console.log(`${passed} tests OK`);
process.exit(0);
