#!/usr/bin/env node
/**
 * Lot 31 — contenu d'une planche de projet (suite de composants) sur une VRAIE base, sans serveur :
 *  1. schéma (forme, bornes, une seule bande) ;
 *  2. migration 0025 : idempotente, rend la planche d'avant (suite = bande seule), ne touche pas une suite réglée ;
 *  3. cycle brouillon → Publier : surcouche portée par la page, public inchangé avant, appliquée après, abandon ;
 *  4. une autre page ne peut pas modifier tant qu'une page tient la surcouche ;
 *  5. références : un média d'une grille compte comme utilisé.
 * Usage : node --import tsx scripts/test-planche31.mjs
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "pf-test-planche31-"));
process.env.DATA_DIR = dir;
const log = console.log;
console.log = () => {};
const { bootstrap } = await import("../src/lib/db/bootstrap.ts");
await bootstrap();
console.log = log;
const { getDb, getSqlite, schema } = await import("../src/lib/db/index.ts");
const { eq } = await import("drizzle-orm");
const { layoutProblem, readLayout, defaultLayout, layoutMediaIds, MAX_BOARD_ITEMS } = await import("../src/blocks/board-layout.ts");
const { seedProjectLayouts } = await import("../src/lib/db/project-layout.ts");
const { readDraft, saveDraft, publishDraft, discardDraft } = await import("../src/lib/edit/drafts.ts");
const { createPage } = await import("../src/lib/edit/pages.ts");
const { boardOp, restoreBoard, readBoard } = await import("../src/lib/edit/boards.ts");
const { mediaUsagesByMedia } = await import("../src/lib/references.ts");

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
const newPage = (slug) => createPage({ title: L(slug), slug: L(slug) }).data.id;
const [P, Q] = db.select().from(schema.projects).all();
const row = (id) => db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
const withBoard = (page, p) => saveDraft(page, { ...base(page), blocks: [{ uid: "b", type: "project-board", props: { project: p.slug } }] }, rev(page));
const media = db.select().from(schema.media).all().filter((m) => m.kind === "image" && m.status === "ready");
assert.ok(media.length >= 2, "médias du seed");

await test("schéma : forme, bornes, une seule bande, grille d'images / vidéos seulement", () => {
  assert.equal(layoutProblem(defaultLayout()), null);
  assert.equal(layoutProblem([]), null);
  assert.ok(layoutProblem([{ uid: "a", type: "strip", props: {} }, { uid: "b", type: "strip", props: {} }]));
  assert.ok(layoutProblem([{ uid: "a", type: "hero", props: {} }]));
  assert.ok(layoutProblem([{ uid: "a", type: "image", props: {} }, { uid: "a", type: "image", props: {} }]), "uid en double");
  assert.ok(layoutProblem(Array.from({ length: MAX_BOARD_ITEMS + 1 }, (_, i) => ({ uid: `i${i}`, type: "image", props: {} }))));
  assert.ok(layoutProblem([{ uid: "g", type: "grid", props: { children: [{ uid: "x", type: "rich-text", props: {} }] } }]));
  assert.ok(layoutProblem([{ uid: "g", type: "image", props: { children: [] } }]));
  assert.deepEqual(readLayout(null), defaultLayout());
  assert.deepEqual(readLayout("n'importe quoi"), defaultLayout());
});

await test("migration 0025 : idempotente, suite = bande seule, une suite réglée n'est jamais remplacée", () => {
  const sqlite = getSqlite();
  sqlite.prepare("UPDATE projects SET layout = NULL").run();
  const n = db.select().from(schema.projects).all().length;
  assert.equal(seedProjectLayouts(sqlite), n);
  for (const p of db.select().from(schema.projects).all()) assert.deepEqual(p.layout, defaultLayout());
  assert.equal(seedProjectLayouts(sqlite), 0, "deuxième passage : rien");
  const custom = [{ uid: "i1", type: "image", props: { mediaId: media[0].id, width: "full" } }];
  sqlite.prepare("UPDATE projects SET layout = ? WHERE id = ?").run(JSON.stringify(custom), Q.id);
  assert.equal(seedProjectLayouts(sqlite), 0);
  assert.deepEqual(row(Q.id).layout, custom);
  sqlite.prepare("UPDATE projects SET layout = NULL WHERE id = ?").run(Q.id);
});

await test("brouillon : ajouter une grille, retirer la bande, réordonner → surcouche de la page, public inchangé", () => {
  const page = newPage("t31a");
  assert.equal(withBoard(page, P).ok, true);
  assert.deepEqual(readBoard(page, P.id).layout, defaultLayout());
  let r = boardOp(page, P.id, { op: "item-add", type: "grid", index: 1, uid: "g1" }, rev(page));
  assert.equal(r.ok, true, JSON.stringify(r));
  r = boardOp(page, P.id, { op: "item-add", type: "image", index: 2, uid: "i1" }, rev(page));
  assert.equal(r.ok, true);
  r = boardOp(page, P.id, { op: "item-move", uid: "i1", dir: "up" }, rev(page));
  assert.deepEqual(r.data.after.layout.map((i) => i.uid), ["strip", "i1", "g1"]);
  r = boardOp(page, P.id, { op: "item-remove", uid: "strip" }, rev(page));
  assert.deepEqual(r.data.after.layout.map((i) => i.uid), ["i1", "g1"]);
  const p = row(P.id);
  assert.equal(p.draftLayoutPageId, page);
  assert.deepEqual(p.layout, defaultLayout().length ? p.layout : null);
  assert.ok(!JSON.stringify(p.layout ?? "").includes("g1"), "version publiée intacte");
  // Bande des images du projet : une seule (les carrousels à liste propre, eux, se multiplient : voir plus bas).
  assert.equal(boardOp(page, P.id, { op: "item-add", type: "strip", index: 0, source: "project" }, rev(page)).ok, true, "bande du projet retirée : on peut la remettre");
  assert.equal(boardOp(page, P.id, { op: "item-add", type: "strip", index: 0, source: "project" }, rev(page)).ok, false, "mais pas deux");
  discardDraft(page, rev(page));
  assert.equal(row(P.id).draftLayoutPageId, null);
  assert.equal(row(P.id).draftLayout, null);
});

await test("publication : refus d'un composant vide, puis suite appliquée au projet, surcouche vidée", () => {
  const page = newPage("t31b");
  withBoard(page, P);
  boardOp(page, P.id, { op: "item-add", type: "image", index: 1, uid: "im" }, rev(page));
  const refused = publishDraft(page, rev(page));
  assert.equal(refused.ok, false);
  assert.match(refused.message, /vide|image/i);
  assert.equal(row(P.id).layout?.some?.((i) => i.uid === "im") ?? false, false);
  const set = boardOp(page, P.id, { op: "item-set", uid: "im", props: { mediaId: media[0].id, width: "full" } }, rev(page));
  assert.equal(set.ok, true, JSON.stringify(set));
  const ok = publishDraft(page, rev(page));
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const p = row(P.id);
  assert.deepEqual(p.layout.map((i) => i.uid), ["strip", "im"]);
  assert.equal(p.draftLayout, null);
  assert.equal(p.draftLayoutPageId, null);
});

await test("une autre page affiche la même suite publiée ; tenue par une page, l'autre est refusée (nommée)", () => {
  const a = newPage("t31c");
  const b = newPage("t31d");
  withBoard(a, P);
  withBoard(b, P);
  assert.deepEqual(readBoard(b, P.id).layout.map((i) => i.uid), ["strip", "im"], "publiée visible ailleurs");
  assert.equal(boardOp(a, P.id, { op: "item-move", uid: "im", dir: "up" }, rev(a)).ok, true);
  const refused = boardOp(b, P.id, { op: "item-move", uid: "strip", dir: "down" }, rev(b));
  assert.equal(refused.ok, false);
  assert.match(refused.message, /t31c/);
  assert.deepEqual(readBoard(b, P.id).layout.map((i) => i.uid), ["strip", "im"], "brouillon de A invisible pour B");
});

await test("Annuler / Rétablir : instantané réécrit", () => {
  const page = newPage("t31e");
  withBoard(page, Q);
  const r = boardOp(page, Q.id, { op: "item-add", type: "rich-text", index: 1, uid: "tx" }, rev(page));
  const undone = restoreBoard(page, r.data.before, rev(page));
  assert.equal(undone.ok, true, JSON.stringify(undone));
  assert.deepEqual(readBoard(page, Q.id).layout, defaultLayout());
  assert.equal(row(Q.id).draftLayoutPageId, null, "revenu au publié : plus de surcouche");
  const redone = restoreBoard(page, r.data.after, rev(page));
  assert.equal(redone.ok, true);
  assert.deepEqual(readBoard(page, Q.id).layout.map((i) => i.uid), ["strip", "tx"]);
  discardDraft(page, rev(page));
});

await test("références : un média posé dans une grille de planche est « utilisé » (publié et brouillon)", () => {
  const page = newPage("t31f");
  withBoard(page, Q);
  const m = media[1].id;
  const grid = { layout: "2", children: [{ uid: "k1", type: "image", props: { mediaId: m } }] };
  assert.equal(boardOp(page, Q.id, { op: "item-add", type: "grid", index: 1, uid: "gr" }, rev(page)).ok, true);
  const setr = boardOp(page, Q.id, { op: "item-set", uid: "gr", props: grid }, rev(page));
  assert.equal(setr.ok, true, JSON.stringify(setr));
  assert.deepEqual(layoutMediaIds(readBoard(page, Q.id).layout), [m]);
  const uses = (mediaUsagesByMedia().get(m) ?? []).filter((u) => u.kind === "layout");
  assert.equal(uses.length, 1);
  assert.equal(uses[0].draftPageId, page);
  assert.equal(publishDraft(page, rev(page)).ok, true);
  const after = (mediaUsagesByMedia().get(m) ?? []).filter((u) => u.kind === "layout");
  assert.equal(after.length, 1);
  assert.equal(after[0].draftPageId, undefined);
});

/* ---- Lot 31b : carrousels à liste propre, largeur / alignement, médias déposés, réordonnancement ---- */

await test("31b schéma : plusieurs carrousels à liste propre, une seule bande du projet, largeur 20–100 et alignement contrôlés", () => {
  const own = (uid, media = []) => ({ uid, type: "strip", props: { source: "own", media } });
  assert.equal(layoutProblem([own("a"), own("b"), { uid: "p", type: "strip", props: {} }]), null, "deux carrousels propres + la bande du projet");
  assert.ok(layoutProblem([{ uid: "p", type: "strip", props: {} }, { uid: "q", type: "strip", props: {} }]), "deux bandes du projet refusées");
  assert.ok(layoutProblem([own("a", ["x"])]), "médias : entiers");
  assert.ok(layoutProblem([{ ...own("a"), box: { width: 10 } }]), "largeur < 20 refusée");
  assert.ok(layoutProblem([{ ...own("a"), box: { width: 50, align: "haut" } }]), "alignement inconnu");
  assert.ok(layoutProblem([{ ...own("a"), box: { width: 50, couleur: 1 } }]), "clé inconnue");
  assert.equal(layoutProblem([{ ...own("a"), box: { width: 50, align: "right" } }]), null);
  assert.deepEqual(layoutMediaIds([own("a", [3, 4])]), [3, 4]);
});

await test("31b : deux carrousels aux images différentes, média déposé (Image : remplace ; Grille, carrousel : ajoutent), réordonner, largeur", () => {
  const page = newPage("t31g");
  withBoard(page, Q);
  const [m1, m2] = [media[0].id, media[1].id];
  assert.equal(boardOp(page, Q.id, { op: "item-add", type: "strip", index: 1, uid: "r1" }, rev(page)).ok, true);
  assert.equal(boardOp(page, Q.id, { op: "item-add", type: "strip", index: 2, uid: "r2" }, rev(page)).ok, true, "un 2e carrousel");
  assert.equal(boardOp(page, Q.id, { op: "item-add", type: "strip", index: 0, source: "project" }, rev(page)).ok, false, "la bande du projet est déjà là");
  assert.equal(boardOp(page, Q.id, { op: "item-media", uid: "r1", mediaId: m1 }, rev(page)).ok, true);
  assert.equal(boardOp(page, Q.id, { op: "item-media", uid: "r2", mediaId: m2 }, rev(page)).ok, true);
  assert.equal(boardOp(page, Q.id, { op: "item-media", uid: "r2", mediaId: m1 }, rev(page)).ok, true);
  let snap = readBoard(page, Q.id);
  assert.deepEqual(snap.layout.find((i) => i.uid === "r1").props.media, [m1]);
  assert.deepEqual(snap.layout.find((i) => i.uid === "r2").props.media, [m2, m1], "images différentes d'un carrousel à l'autre");
  assert.equal(boardOp(page, Q.id, { op: "item-media", uid: "strip", mediaId: m1 }, rev(page)).ok, false, "la bande du projet ne reçoit pas de média par ici");
  // Image : remplace ; Grille : ajoute.
  boardOp(page, Q.id, { op: "item-add", type: "image", index: 3, uid: "im" }, rev(page));
  boardOp(page, Q.id, { op: "item-media", uid: "im", mediaId: m1 }, rev(page));
  boardOp(page, Q.id, { op: "item-media", uid: "im", mediaId: m2 }, rev(page));
  assert.equal(readBoard(page, Q.id).layout.find((i) => i.uid === "im").props.mediaId, m2, "Image : remplacée");
  boardOp(page, Q.id, { op: "item-add", type: "grid", index: 4, uid: "gd" }, rev(page));
  boardOp(page, Q.id, { op: "item-media", uid: "gd", mediaId: m1 }, rev(page));
  boardOp(page, Q.id, { op: "item-media", uid: "gd", mediaId: m2 }, rev(page));
  assert.equal(readBoard(page, Q.id).layout.find((i) => i.uid === "gd").props.children.length, 2, "Grille : ajoutés");
  assert.equal(boardOp(page, Q.id, { op: "item-add", type: "rich-text", index: 5, uid: "tx" }, rev(page)).ok, true);
  assert.equal(boardOp(page, Q.id, { op: "item-media", uid: "tx", mediaId: m1 }, rev(page)).ok, false, "un texte n'accepte pas d'image");
  // Réordonner par rang (glisser).
  const order = () => readBoard(page, Q.id).layout.map((i) => i.uid).join();
  assert.equal(boardOp(page, Q.id, { op: "item-to", uid: "gd", index: 0 }, rev(page)).ok, true);
  assert.equal(order().split(",")[0], "gd");
  assert.equal(boardOp(page, Q.id, { op: "item-to", uid: "gd", index: 99 }, rev(page)).ok, false, "rang hors bornes refusé");
  // Largeur et alignement : commun à tous les types, effaçable.
  for (const uid of ["r1", "im", "gd", "tx", "strip"]) {
    const r = boardOp(page, Q.id, { op: "item-set", uid, box: { width: 50, align: "right" } }, rev(page));
    assert.equal(r.ok, true, `${uid} : ${JSON.stringify(r)}`);
  }
  assert.deepEqual(readBoard(page, Q.id).layout.find((i) => i.uid === "gd").box, { width: 50, align: "right" });
  assert.equal(boardOp(page, Q.id, { op: "item-set", uid: "gd", box: { width: 10 } }, rev(page)).ok, false);
  boardOp(page, Q.id, { op: "item-set", uid: "gd", box: null }, rev(page));
  assert.equal(readBoard(page, Q.id).layout.find((i) => i.uid === "gd").box, undefined, "réglage effacé : rendu d'avant");
  // Références : médias des carrousels comptés.
  const uses = (mediaUsagesByMedia().get(m1) ?? []).filter((u) => u.kind === "layout" && u.projectId === Q.id);
  assert.equal(uses.length, 1);
  // Publication : un carrousel vide est refusé, rempli il est publié avec sa largeur.
  boardOp(page, Q.id, { op: "item-add", type: "strip", index: 0, uid: "vide" }, rev(page));
  assert.equal(publishDraft(page, rev(page)).ok, false, "carrousel vide");
  boardOp(page, Q.id, { op: "item-remove", uid: "vide" }, rev(page));
  boardOp(page, Q.id, { op: "item-set", uid: "tx", props: { paragraphs: [{ fr: "Un mot", en: "A word" }] } }, rev(page));
  const pub = publishDraft(page, rev(page));
  assert.equal(pub.ok, true, JSON.stringify(pub));
  snap = readBoard(page, Q.id);
  assert.deepEqual(snap.layout.find((i) => i.uid === "r2").props.media, [m2, m1]);
  assert.deepEqual(snap.layout.find((i) => i.uid === "tx").box, { width: 50, align: "right" });
  assert.deepEqual(row(Q.id).layout.find((i) => i.uid === "strip"), { uid: "strip", type: "strip", props: {}, box: { width: 50, align: "right" } }, "la bande d'origine reste celle du projet (props vides)");
});

/* ---- Lot 31c : texte en place, mise en forme, ajout sous un composant ---- */

await test("31c : texte modifié en place (item-text), mise en forme du composant (item-look), ajout « sous » un composant (after)", () => {
  const page = newPage("t31h");
  withBoard(page, Q);
  const base = readBoard(page, Q.id).layout.map((i) => i.uid);
  assert.equal(boardOp(page, Q.id, { op: "item-add", type: "rich-text", index: base.length, uid: "tt" }, rev(page)).ok, true);
  const t = boardOp(page, Q.id, { op: "item-text", uid: "tt", path: "paragraphs.0", locale: "fr", value: "Bonjour la planche" }, rev(page));
  assert.equal(t.ok, true, JSON.stringify(t));
  assert.equal(readBoard(page, Q.id).layout.find((i) => i.uid === "tt").props.paragraphs[0].fr, "Bonjour la planche");
  assert.equal(readBoard(page, Q.id).layout.find((i) => i.uid === "tt").props.paragraphs[0].en, "", "l exemple de l autre langue est retiré (sinon la publication le refuserait)");
  assert.equal(boardOp(page, Q.id, { op: "item-text", uid: "tt", path: "paragraphs.0", locale: "fr", value: "x".repeat(2001) }, rev(page)).ok, false, "trop long refusé");
  assert.equal(boardOp(page, Q.id, { op: "item-text", uid: "tt", path: "../x", locale: "fr", value: "a" }, rev(page)).ok, false, "chemin invalide");
  assert.equal(boardOp(page, Q.id, { op: "item-text", uid: "strip", path: "title", locale: "fr", value: "a" }, rev(page)).ok, false, "une bande n'a pas de texte");
  const l = boardOp(page, Q.id, { op: "item-look", uid: "tt", look: { text: { "paragraphs.0": { italic: true } } } }, rev(page));
  assert.equal(l.ok, true, JSON.stringify(l));
  assert.equal(readBoard(page, Q.id).layout.find((i) => i.uid === "tt").props.look.text["paragraphs.0"].italic, true);
  assert.equal(boardOp(page, Q.id, { op: "item-look", uid: "tt", look: null }, rev(page)).ok, true);
  assert.equal(readBoard(page, Q.id).layout.find((i) => i.uid === "tt").props.look, undefined, "mise en forme retirée");
  assert.equal(boardOp(page, Q.id, { op: "item-look", uid: "tt", look: { text: { x: { inconnu: 1 } } } }, rev(page)).ok, false, "réglage inconnu refusé");
  // Sous un composant (clic sur la carte de la palette).
  const r = boardOp(page, Q.id, { op: "item-add", type: "strip", index: 0, after: base[0], uid: "apres" }, rev(page));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(readBoard(page, Q.id).layout[1].uid, "apres");
  assert.equal(boardOp(page, Q.id, { op: "item-add", type: "strip", index: 0, after: "nexistepas" }, rev(page)).ok, false);
  discardDraft(page, rev(page));
});

console.log(`${passed} tests OK`);
process.exit(0);
