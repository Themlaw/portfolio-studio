#!/usr/bin/env node
/**
 * Lot 31f — un seul carrousel : les places d'un carrousel à liste propre se gèrent comme les emplacements de la bande du projet,
 * sur une VRAIE base, sans serveur :
 *  1. clés de place (`<uid>.<rang>`), liste lue avec ses places vides ;
 *  2. schéma : une place vide (null) est permise, un identifiant illisible ne l'est pas ;
 *  3. gestes serveur : remplir, vider (la place reste), retirer la place, déplacer, ajouter à un rang ; refus (bande du projet, rang, médias) ;
 *  4. compteur et références : une place vide ne compte pas ; un carrousel de places vides n'est pas publiable ;
 *  5. protocole : la clé d'une place passe le schéma des messages, un message de glisser sur un carrousel aussi.
 * Usage : node --import tsx scripts/test-carrousel31f.mjs
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "pf-test-carrousel31f-"));
process.env.DATA_DIR = dir;
const log = console.log;
console.log = () => {};
const { bootstrap } = await import("../src/lib/db/bootstrap.ts");
await bootstrap();
console.log = log;
const { getDb, schema } = await import("../src/lib/db/index.ts");
const { layoutProblem, itemEmpty, mediaCount, layoutMediaIds, railKey, parseRailKey, railList, railIds } = await import("../src/blocks/board-layout.ts");
const { readDraft, saveDraft, publishDraft, discardDraft } = await import("../src/lib/edit/drafts.ts");
const { createPage } = await import("../src/lib/edit/pages.ts");
const { boardOp, readBoard } = await import("../src/lib/edit/boards.ts");
const { FromCanvasSchema } = await import("../src/lib/edit/protocol.ts");

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
assert.ok(media.length >= 3, "médias du seed");
const [m1, m2, m3] = media.map((m) => m.id);

await test("clés de place et liste lue avec ses places vides", () => {
  assert.equal(railKey("c1a", 3), "c1a.3");
  assert.deepEqual(parseRailKey("c1a.3"), { uid: "c1a", at: 3 });
  assert.equal(parseRailKey("s12"), null, "un emplacement du projet n'est pas une place de carrousel");
  assert.equal(parseRailKey("kabcdef0123456789"), null);
  assert.deepEqual(railList({ media: [5, null, "x", -2, 7.5, 9] }), [5, null, null, null, null, 9]);
  assert.deepEqual(railList({}), []);
  assert.deepEqual(railIds({ media: [5, null] }), ["p0", "p1"], "carrousel d'avant 31f : identités déduites du rang");
  assert.deepEqual(railIds({ media: [5, null], ids: ["a1", "b2"] }), ["a1", "b2"]);
  assert.deepEqual(railIds({ media: [5, null], ids: ["a1", "a1"] }), ["p0", "p1"], "doublon : ignoré");
  assert.deepEqual(railIds({ media: [5, null], ids: ["a1"] }), ["p0", "p1"], "longueur différente : ignoré");
});

await test("schéma : une place vide est permise, un identifiant illisible ne l'est pas", () => {
  const item = (media) => [{ uid: "r", type: "strip", props: { source: "own", media } }];
  assert.equal(layoutProblem(item([1, null, 2])), null);
  assert.ok(layoutProblem(item([1, "2"])));
  assert.ok(layoutProblem(item([0])));
  assert.ok(layoutProblem(item(Array.from({ length: 61 }, () => 1))));
  assert.ok(layoutProblem([{ uid: "r", type: "strip", props: { source: "own", media: [1], ids: ["A B"] } }]), "identité de place illisible");
  assert.equal(layoutProblem([{ uid: "r", type: "strip", props: { source: "own", media: [1], ids: ["a1"] } }]), null);
});

await test("compteur, références et vacuité : une place vide ne compte pas", () => {
  const strip = (media) => ({ uid: "r", type: "strip", props: { source: "own", media } });
  assert.equal(mediaCount([strip([m1, null, m2])]), 2);
  assert.deepEqual(layoutMediaIds([strip([m1, null, m2])]), [m1, m2]);
  assert.equal(itemEmpty(strip([])), true);
  assert.equal(itemEmpty(strip([null, null])), true, "que des places vides : rien à montrer");
  assert.equal(itemEmpty(strip([null, m1])), false);
});

await test("gestes sur un carrousel : remplir, vider, retirer la place, déplacer, ajouter à un rang", () => {
  const page = createPage({ title: L("t31f"), slug: L("t31f") }).data.id;
  assert.equal(saveDraft(page, { ...base(page), blocks: [{ uid: "b", type: "project-board", props: { project: P.slug } }] }, rev(page)).ok, true);
  const list = () => readBoard(page, P.id).layout.find((i) => i.uid === "car").props.media;
  const places = () => readBoard(page, P.id).layout.find((i) => i.uid === "car").props.ids;
  assert.equal(boardOp(page, P.id, { op: "item-add", type: "strip", index: 1, uid: "car" }, rev(page)).ok, true);
  for (const id of [m1, m2, m3]) assert.equal(boardOp(page, P.id, { op: "item-media", uid: "car", mediaId: id }, rev(page)).ok, true);
  assert.deepEqual(list(), [m1, m2, m3]);
  const [i1, i2, i3] = places();
  assert.equal(new Set([i1, i2, i3]).size, 3, "chaque place a son identité");
  assert.equal(boardOp(page, P.id, { op: "rail-clear", uid: "car", at: 1 }, rev(page)).ok, true);
  assert.deepEqual(list(), [m1, null, m3], "Supprimer : la place reste, vide");
  assert.deepEqual(places(), [i1, i2, i3], "…avec son identité (ses réglages d'arrondi et de cadre)");
  assert.equal(boardOp(page, P.id, { op: "rail-fill", uid: "car", at: 1, mediaId: m3 }, rev(page)).ok, true);
  assert.deepEqual(list(), [m1, m3, m3], "Remplacer : cette place seulement");
  assert.deepEqual(places(), [i1, i2, i3], "Remplacer garde l'identité de la place");
  assert.equal(boardOp(page, P.id, { op: "rail-move", uid: "car", at: 0, index: 3 }, rev(page)).ok, true);
  assert.deepEqual(list(), [m3, m3, m1], "glisser la première après la dernière");
  assert.deepEqual(places(), [i2, i3, i1], "l'identité suit l'image déplacée");
  assert.equal(boardOp(page, P.id, { op: "rail-move", uid: "car", at: 2, index: 0 }, rev(page)).ok, true);
  assert.deepEqual(list(), [m1, m3, m3]);
  assert.deepEqual(places(), [i1, i2, i3]);
  assert.equal(boardOp(page, P.id, { op: "rail-retire", uid: "car", at: 0 }, rev(page)).ok, true);
  assert.deepEqual(list(), [m3, m3], "Retirer la place : la liste raccourcit");
  assert.deepEqual(places(), [i2, i3], "…les autres places gardent leur identité");
  assert.equal(boardOp(page, P.id, { op: "rail-add", uid: "car", mediaId: m2, index: 1 }, rev(page)).ok, true);
  assert.deepEqual(list(), [m3, m2, m3], "fichier ou média déposé à un rang");
  assert.deepEqual([places()[0], places()[2]], [i2, i3]);
  assert.ok(!places().slice(0, 1).concat(places().slice(2)).includes(places()[1]), "la place neuve a une identité neuve");
  // Refus.
  assert.equal(boardOp(page, P.id, { op: "rail-add", uid: "car", mediaId: m2, index: 9 }, rev(page)).ok, false, "rang hors liste");
  assert.equal(boardOp(page, P.id, { op: "rail-fill", uid: "car", at: 9, mediaId: m2 }, rev(page)).ok, false, "place absente");
  assert.equal(boardOp(page, P.id, { op: "rail-clear", uid: "strip", at: 0 }, rev(page)).ok, false, "la bande du projet se gère par ses emplacements");
  assert.equal(boardOp(page, P.id, { op: "rail-fill", uid: "car", at: 0, mediaId: 999999 }, rev(page)).ok, false, "média inconnu");
  assert.equal(boardOp(page, P.id, { op: "rail-clear", uid: "nexistepas", at: 0 }, rev(page)).ok, false);
  assert.equal(boardOp(page, P.id, { op: "rail-fill", uid: "car", at: 0 }, rev(page)).ok, false, "média obligatoire");
  // Que des places vides : pas publiable ; au moins une image : publiable, places vides gardées sur la fiche.
  for (let i = 0; i < 3; i++) boardOp(page, P.id, { op: "rail-clear", uid: "car", at: i }, rev(page));
  assert.equal(publishDraft(page, rev(page)).ok, false, "un carrousel de places vides n'est pas publiable");
  boardOp(page, P.id, { op: "rail-fill", uid: "car", at: 2, mediaId: m1 }, rev(page));
  const pub = publishDraft(page, rev(page));
  assert.equal(pub.ok, true, JSON.stringify(pub));
  const stored = JSON.parse(db.$client.prepare("select props from blocks where page_id = ? and type = 'project-board'").get(page).props).layout.find((i) => i.uid === "car"); // lot 111 : publié dans le bloc de la page
  assert.deepEqual(stored.props.media, [null, null, m1], "publié avec ses places vides (masquées en public)");
  discardDraft(page, rev(page));
});

await test("protocole : clé de place de carrousel et cible de dépôt « rail »", () => {
  const parse = (m) => FromCanvasSchema.safeParse(m).success;
  assert.ok(parse({ kind: "slot-op", board: 1, key: "c1a2b3.2", op: "remove" }));
  assert.ok(parse({ kind: "slot-move", board: 1, key: "c1a2b3.2", index: 0 }));
  assert.ok(parse({ kind: "slot-op", board: 1, key: "s12", op: "retire" }), "emplacement du projet : inchangé");
  assert.ok(!parse({ kind: "slot-op", board: 1, key: "c1a2b3.x", op: "remove" }));
  assert.ok(!parse({ kind: "slot-op", board: 1, key: "../x.1", op: "remove" }));
  assert.ok(parse({ kind: "files", target: { kind: "rail", board: 1, uid: "c1a2b3", index: 2 }, files: [new File(["x"], "a.png", { type: "image/png" })] }));
  assert.ok(!parse({ kind: "files", target: { kind: "rail", board: 1, uid: "BAD UID", index: 2 }, files: [new File(["x"], "a.png")] }));
});

console.log(`${passed} tests OK`);
process.exit(0);
