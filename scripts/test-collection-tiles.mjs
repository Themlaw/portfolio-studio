#!/usr/bin/env node
/**
 * Lot 22 (v0.19) — entrées des collections, tests unitaires (inclus dans npm test) :
 *  1. Sélection automatique (src/blocks/collection-pages.ts) : pages de collection, ordre du menu, textes de
 *     l'en-tête, textes modifiés sur la tuile, page ajoutée / retirée / dépubliée (liste des publiées en entrée).
 *  2. Mode manuel : entrée dont la page n'est plus publiée = « broken ».
 *  3. Migration 0022 (autoCollectionTiles) sur une base en mémoire : auto seulement si la liste correspond
 *     exactement, sinon manuel, aucune perte de texte, brouillons compris, idempotente.
 *  4. Schéma du bloc (anciens blocs, mode, taille, bornes).
 * Usage : node --import tsx scripts/test-collection-tiles.mjs
 */
import assert from "node:assert/strict";

import Database from "better-sqlite3";

import {
  autoEntries,
  pageHeader,
  editsFromItems,
  itemsFromEntries,
  manualEntries,
  MAX_TILES,
  migrateTilesProps,
  orderCollectionPages,
  tilesMode,
  tileSize,
  TILE_GEOMETRY,
} from "../src/blocks/collection-pages.ts";
import { collectionTilesSchema } from "../src/blocks/CollectionTilesBlock.tsx";
import { sectionTitleSchema } from "../src/blocks/SectionTitleBlock.tsx";
import { collectionPages } from "../src/lib/db/upgrade.ts";

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`PASS  ${name}`);
};
const L = (fr, en = "") => ({ fr, en });
/** Titre de page de collection : le premier bloc Titre (section-title) en fournit les textes. */
const titre = (name) => ({ type: "section-title", props: { eyebrow: L(`${name} — ey`, `${name} en ey`), title: L(name, `${name} en`), intro: L(`Intro ${name}`, `Intro ${name} en`), main: true, counts: true } });
/** Ancien « En-tête de collection » (avant la migration 0022). */
const intro = (collection, name) => ({ type: "collection-intro", props: { collection, eyebrow: L(`${name} — ey`, `${name} en ey`), title: L(name, `${name} en`), intro: L(`Intro ${name}`, `Intro ${name} en`), showCounts: true } });
const page = (id, name, collection, extra = []) => ({ id, title: L(name), collection: collection ?? null, blocks: [...(collection ? [titre(name)] : []), ...extra] });

/* ---- 1. Sélection automatique -------------------------------------------- */

test("textes d'une tuile = premier Titre de la page ; sans Titre (ou sans titre) = titre de la page", () => {
  assert.deepEqual(pageHeader([{ type: "rich-text", props: {} }], L("Page")), { eyebrow: L(""), title: L("Page"), intro: L("") });
  assert.deepEqual(pageHeader([], L("Page")).title, L("Page"));
  const h = pageHeader([titre("Persos")], L("Titre page"));
  assert.deepEqual(h.title, L("Persos", "Persos en"), "texte du Titre, pas le titre de la page");
  assert.deepEqual(h.eyebrow, L("Persos — ey", "Persos en ey"));
  assert.deepEqual(h.intro, L("Intro Persos", "Intro Persos en"));
  assert.deepEqual(pageHeader([{ type: "section-title", props: { eyebrow: L("E") } }], L("Page")), { eyebrow: L("E"), title: L("Page"), intro: L("") }, "Titre sans titre");
  assert.equal(pageHeader([{ type: "section-title", props: { title: L(" ", "") } }], L("Page")).title.fr, "Page", "titre vide : le titre de la page");
  assert.equal(pageHeader([{ type: "section-title", props: { linked: true, title: L("Projet") } }, titre("Vrai")], L("P")).title.fr, "Vrai", "un Titre lié à un projet est ignoré");
  assert.equal(pageHeader([{ type: "section-title", props: null }], L("Page")).title.fr, "Page", "props illisibles");
  assert.equal(pageHeader([intro("characters", "Ancien")], L("P")).title.fr, "Ancien", "ancien En-tête de collection non migré");
  assert.equal(pageHeader([{ type: "rich-text", props: {} }, titre("Premier"), titre("Second")], L("P")).title.fr, "Premier", "le premier Titre");
});

test("page de collection = page qui porte le réglage « collection » (valide) ; les autres sont ignorées", () => {
  const out = orderCollectionPages([page(1, "Accueil"), page(2, "A", "characters"), { ...page(3, "B"), collection: "pastels" }, { ...page(4, "C"), collection: undefined }], []);
  assert.deepEqual(out.map((p) => [p.pageId, p.collection]), [[2, "characters"]]);
  assert.equal(orderCollectionPages([{ ...page(2, "A"), collection: "characters", blocks: [intro("backgrounds", "X")] }], [])[0].collection, "characters", "la collection vient du réglage de la page, pas d'un bloc");
});

const pages = [page(1, "Accueil"), page(2, "Persos", "characters"), page(3, "Décors", "backgrounds"), page(4, "Anim", "animation"), page(5, "À propos")];

test("ordre du menu, puis les pages hors menu par identifiant", () => {
  assert.deepEqual(orderCollectionPages(pages, [1, 4, 2, 3, 5]).map((p) => p.pageId), [4, 2, 3]);
  assert.deepEqual(orderCollectionPages(pages, []).map((p) => p.pageId), [2, 3, 4]);
  assert.deepEqual(orderCollectionPages(pages, [3]).map((p) => p.pageId), [3, 2, 4], "hors menu après");
  assert.deepEqual(orderCollectionPages(pages, [2, 2, 3]).map((p) => p.pageId), [2, 3, 4], "doublon du menu");
});

test("page ajoutée = tuile ajoutée ; page retirée ou dépubliée = tuile retirée", () => {
  const menu = [2, 3, 4];
  const before = autoEntries(orderCollectionPages(pages, menu), undefined);
  assert.deepEqual(before.map((e) => e.pageId), [2, 3, 4]);
  const added = [...pages, { ...page(6, "Nouvelle", "characters"), collection: null }, { ...page(7, "Autre"), collection: "characters" }];
  assert.deepEqual(autoEntries(orderCollectionPages(added, [...menu, 7]), undefined).map((e) => e.pageId), [2, 3, 4, 7], "page ajoutée");
  assert.deepEqual(autoEntries(orderCollectionPages(added, [7, ...menu]), undefined).map((e) => e.pageId), [7, 2, 3, 4], "ordre du menu");
  // Le serveur ne passe que les pages publiées : dépublier ou supprimer = absente de la liste.
  assert.deepEqual(autoEntries(orderCollectionPages(pages.filter((p) => p.id !== 3), menu), undefined).map((e) => e.pageId), [2, 4]);
  assert.deepEqual(autoEntries([], undefined), []);
});

test("textes : ceux du Titre de la page, sauf ceux modifiés sur la tuile (gardés, attachés à la page)", () => {
  const found = orderCollectionPages(pages, [2, 3, 4]);
  const [persos, decors] = autoEntries(found, [{ pageId: 2, title: L("Mes personnages", "My characters") }]);
  assert.deepEqual(persos.title, L("Mes personnages", "My characters"));
  assert.deepEqual(persos.edited, { title: true });
  assert.deepEqual(persos.eyebrow, L("Persos — ey", "Persos en ey"), "les autres champs suivent le Titre");
  assert.deepEqual(decors.edited, {});
  // Modification d'une page qui n'existe plus : sans effet.
  assert.deepEqual(autoEntries(found, [{ pageId: 99, title: L("x") }]).map((e) => e.title.fr), ["Persos", "Décors", "Anim"]);
  // Un texte vide modifié reste vide (clé présente).
  assert.equal(autoEntries(found, [{ pageId: 2, intro: L("") }])[0].intro.fr, "");
});

test("au plus MAX_TILES tuiles", () => {
  const many = Array.from({ length: 40 }, (_, i) => page(100 + i, `P${i}`, "characters"));
  assert.equal(autoEntries(orderCollectionPages(many, []), undefined).length, MAX_TILES);
});

/* ---- 2. Manuel : liens cassés ---------------------------------------------- */

test("manuel : une entrée dont la page n'est plus publiée est marquée cassée", () => {
  const item = (pageId, collection = "characters") => ({ collection, pageId, eyebrow: L(""), title: L("t" + pageId), intro: L("") });
  const out = manualEntries([item(2), item(77), item(3, "backgrounds")], new Set([1, 2, 3]));
  assert.deepEqual(out.map((e) => [e.pageId, e.broken]), [[2, false], [77, true], [3, false]]);
  assert.deepEqual(manualEntries([], new Set()), []);
});

test("passages manuel <-> automatique : rien ne se perd", () => {
  const found = orderCollectionPages(pages, [2, 3, 4]);
  const entries = autoEntries(found, [{ pageId: 3, title: L("Mes décors") }]);
  const items = itemsFromEntries(entries);
  assert.equal(items[1].title.fr, "Mes décors", "auto -> manuel : la liste reprend ce qui s'affichait");
  assert.deepEqual(editsFromItems(items, found), [{ pageId: 3, title: L("Mes décors") }], "manuel -> auto : seul le texte modifié est gardé");
  assert.deepEqual(editsFromItems(itemsFromEntries(autoEntries(found, undefined)), found), [], "aucune modification");
});

/* ---- 3. Migration ----------------------------------------------------------- */

const item = (pageId, collection, name, over = {}) => ({ collection, pageId, eyebrow: L(`${name} — ey`, `${name} en ey`), title: L(name, `${name} en`), intro: L(`Intro ${name}`, `Intro ${name} en`), ...over });
const base = { eyebrow: L("Collections"), title: L("Trois manières") };

test("migrateTilesProps : liste = pages de collection -> automatique, sans liste", () => {
  const found = orderCollectionPages(pages, [2, 3, 4]);
  const props = { ...base, ratio: "4:3", look: { tileCrop: { characters: { x: 50, y: 50, zoom: 1.4 } } }, items: [item(2, "characters", "Persos"), item(3, "backgrounds", "Décors"), item(4, "animation", "Anim")] };
  const r = migrateTilesProps(props, found);
  assert.equal(r.mode, "auto");
  assert.equal(r.props.mode, "auto");
  assert.equal("items" in r.props, false);
  assert.equal("edits" in r.props, false, "textes identiques à l'en-tête : aucune modification");
  assert.equal(r.props.ratio, "4:3", "réglages gardés");
  assert.equal(r.props.look.tileCrop.characters.zoom, 1.4, "cadrage gardé");
});

test("migrateTilesProps : textes différents de l'en-tête = modifications de tuile (aucune perte)", () => {
  const found = orderCollectionPages(pages, [2, 3, 4]);
  const props = { ...base, items: [item(2, "characters", "Persos", { title: L("Persos perso", "My chars") }), item(3, "backgrounds", "Décors"), item(4, "animation", "Anim", { intro: L("") })] };
  const r = migrateTilesProps(props, found);
  assert.equal(r.mode, "auto");
  assert.deepEqual(r.props.edits, [{ pageId: 2, title: L("Persos perso", "My chars") }, { pageId: 4, intro: L("") }]);
  const shown = autoEntries(found, r.props.edits);
  assert.deepEqual(shown.map((e) => e.title), [L("Persos perso", "My chars"), L("Décors", "Décors en"), L("Anim", "Anim en")], "le rendu est celui d'avant");
  assert.equal(shown[2].intro.fr, "");
});

test("migrateTilesProps : liste différente (ordre, page en moins ou en trop, collection, page inconnue) -> manuel, liste intacte", () => {
  const found = orderCollectionPages(pages, [2, 3, 4]);
  const A = item(2, "characters", "Persos"), B = item(3, "backgrounds", "Décors"), C = item(4, "animation", "Anim");
  for (const [label, items] of [
    ["ordre", [B, A, C]],
    ["page en moins", [A, B]],
    ["page en trop", [A, B, C, item(5, "characters", "X")]],
    ["collection différente", [A, { ...B, collection: "characters" }, C]],
    ["page inconnue", [A, B, item(99, "animation", "C")]],
    ["doublon", [A, A, B, C]],
    ["liste vide alors que des pages existent", []],
  ]) {
    const r = migrateTilesProps({ ...base, items }, found);
    assert.equal(r.mode, "manual", label);
    assert.deepEqual(r.props.items, items, `${label} : liste intacte`);
  }
  // Pas de page de collection et liste vide : rien à suivre, automatique.
  assert.equal(migrateTilesProps({ ...base, items: [] }, []).mode, "auto");
});

test("migrateTilesProps : idempotente, un mode existant n'est pas retouché", () => {
  const found = orderCollectionPages(pages, [2, 3, 4]);
  const man = { ...base, mode: "manual", items: [] };
  assert.equal(migrateTilesProps(man, found).changed, false);
  assert.equal(migrateTilesProps(man, found).props, man);
  const auto = { ...base, mode: "auto" };
  assert.equal(migrateTilesProps(auto, found).changed, false);
});

/** Base en mémoire : pages (avec `collection`), blocs, menu, brouillons. */
function makeDb() {
  const db = new Database(":memory:");
  db.exec("create table pages (id integer primary key, title text, published integer, nav_order integer, collection text unique, draft text)");
  db.exec("create table blocks (id integer primary key, page_id integer, position integer, type text, props text)");
  db.exec("create table settings (key text primary key, value text)");
  /** `blocks` : écrits tels quels ; `collection` : réglage de la page (déjà posé) ou null. */
  const addPage = (id, name, blocks = [], published = 1, navOrder = null, collection = null) => {
    db.prepare("insert into pages (id, title, published, nav_order, collection) values (?, ?, ?, ?, ?)").run(id, JSON.stringify(L(name)), published, navOrder, collection);
    blocks.forEach((b, i) => db.prepare("insert into blocks (page_id, position, type, props) values (?, ?, ?, ?)").run(id, i, b.type, JSON.stringify(b.props)));
  };
  const addTiles = (pageId, props) => db.prepare("insert into blocks (page_id, position, type, props) values (?, 9, 'collection-tiles', ?)").run(pageId, typeof props === "string" ? props : JSON.stringify(props));
  const tiles = () => db.prepare("select props from blocks where type = 'collection-tiles' order by id").all().map((r) => JSON.parse(r.props));
  const row = (id) => db.prepare("select * from pages where id = ?").get(id);
  const blocksOf = (id) => db.prepare("select type, props from blocks where page_id = ? and type != 'collection-tiles' order by position").all(id).map((b) => ({ type: b.type, props: JSON.parse(b.props) }));
  return { db, addPage, addTiles, tiles, row, blocksOf };
}

test("0022 : base vide, sans bloc, bloc illisible", () => {
  const { db, addTiles } = makeDb();
  assert.equal(collectionPages(db), 0, "base vide");
  addTiles(1, "{pas du json");
  assert.equal(collectionPages(db), 0, "illisible : laissé tel quel");
  assert.equal(db.prepare("select props from blocks").get().props, "{pas du json");
});

test("0022 : réglage « collection » de chaque page depuis son En-tête de collection (publiées d'abord, une page par collection)", () => {
  const { db, addPage, row } = makeDb();
  addPage(1, "Accueil");
  addPage(2, "Brouillon-page", [intro("characters", "Faux")], 0); // non publiée, id plus petit que la publiée qui suit
  addPage(3, "Persos", [intro("characters", "Persos")], 1, 1);
  addPage(4, "Doublon", [intro("characters", "Doublon")], 1, 2); // la collection est déjà prise par la page 3
  addPage(5, "Anciennes planches", [{ type: "collection-projects", props: { collection: "backgrounds" } }]);
  addPage(6, "Déjà réglée", [intro("animation", "Anim")], 1, 3, "animation");
  db.prepare("update pages set draft = ? where id = 5").run(JSON.stringify({ title: L("x"), blocks: [] }));
  collectionPages(db);
  assert.equal(row(3).collection, "characters");
  assert.equal(row(2).collection, null, "non publiée : la publiée passe avant");
  assert.equal(row(4).collection, null, "une collection n'a qu'une page");
  assert.equal(row(5).collection, "backgrounds", "anciennes planches d'une collection : compte aussi");
  assert.equal(row(6).collection, "animation", "réglage existant intact");
  assert.equal(row(1).collection, null);
  assert.equal(JSON.parse(row(5).draft).collection, "backgrounds", "le brouillon porte le même réglage");
  assert.equal(JSON.parse(row(5).draft).title.fr, "x", "reste du brouillon intact");
});

test("0022 : un En-tête de collection placé seulement dans le brouillon règle quand même la page", () => {
  const { db, addPage, row } = makeDb();
  addPage(1, "Nouvelle");
  db.prepare("update pages set draft = ? where id = 1").run(JSON.stringify({ blocks: [{ uid: "i", type: "collection-intro", props: { collection: "animation", eyebrow: L("a"), title: L("b"), intro: L("c") } }] }));
  collectionPages(db);
  assert.equal(row(1).collection, "animation");
  const draft = JSON.parse(row(1).draft);
  assert.equal(draft.collection, "animation");
  assert.equal(draft.blocks[0].type, "section-title", "converti dans le brouillon");
  assert.equal(draft.blocks[0].props.counts, true, "showCounts absent = compteurs (défaut du schéma)");
});

test("0022 : En-tête de collection -> Titre principal, mêmes textes, compteurs selon showCounts, réglages gardés (publié, brouillon, composant)", () => {
  const { db, addPage, blocksOf, row } = makeDb();
  const look = { spaceTop: "l" };
  const surface = { color: "paper" };
  addPage(1, "Persos", [
    { type: "collection-intro", props: { collection: "characters", eyebrow: L("E", "E en"), title: L("T", "T en"), intro: L("I", "I en"), showCounts: true, look, surface } },
    { type: "rich-text", props: { paragraphs: [L("p")] } },
  ]);
  addPage(2, "Anim", [{ type: "collection-intro", props: { collection: "animation", eyebrow: L(""), title: L("Animation"), intro: L(""), showCounts: false } }]);
  db.prepare("update pages set draft = ? where id = 2").run(JSON.stringify({ blocks: [{ uid: "g", type: "grid", props: { children: [{ uid: "k", type: "collection-intro", props: { collection: "animation", eyebrow: L(""), title: L("D"), intro: L("") } }] } }] }));
  const changed = collectionPages(db);
  assert.ok(changed >= 4, `lignes réécrites : ${changed}`);
  const [a, p] = blocksOf(1);
  assert.equal(a.type, "section-title");
  assert.deepEqual(a.props, { eyebrow: L("E", "E en"), title: L("T", "T en"), intro: L("I", "I en"), main: true, counts: true, look, surface }, "aucun texte perdu, look et carte gardés, collection retirée du bloc");
  assert.equal(p.type, "rich-text", "autres blocs intacts");
  const [b] = blocksOf(2);
  assert.deepEqual(b.props, { eyebrow: L(""), title: L("Animation"), intro: L(""), main: true }, "showCounts false : pas de compteurs");
  const kid = JSON.parse(row(2).draft).blocks[0].props.children[0];
  assert.equal(kid.type, "section-title", "composant de conteneur converti");
  assert.equal(kid.uid, "k");
  assert.equal(db.prepare("select count(*) n from blocks where type = 'collection-intro'").get().n, 0);
});

test("0022 : entrées des collections — auto si la liste suit les pages (ordre du menu), manuel sinon, publié et brouillon", () => {
  const { db, addPage, addTiles, tiles, row } = makeDb();
  addPage(1, "Accueil", [], 1, null);
  addPage(2, "Persos", [intro("characters", "Persos")], 1, 1);
  addPage(3, "Décors", [intro("backgrounds", "Décors")], 1, 2);
  addPage(4, "Anim", [intro("animation", "Anim")], 1, 3);
  addPage(5, "Brouillon-page", [intro("characters", "Faux")], 0, null); // non publiée : pas une entrée
  const exact = [item(2, "characters", "Persos"), item(3, "backgrounds", "Décors", { title: L("Mes décors") }), item(4, "animation", "Anim")];
  addTiles(1, { ...base, items: exact });
  addTiles(3, { ...base, items: [exact[1], exact[0], exact[2]] });
  addTiles(4, { ...base, items: exact, mode: "manual" });
  db.prepare("update pages set draft = ? where id = 1").run(JSON.stringify({ blocks: [{ uid: "t", type: "collection-tiles", props: { ...base, items: exact } }, { uid: "r", type: "rich-text", props: {} }, { uid: "u", type: "collection-tiles", props: { ...base, items: exact.slice(0, 1) } }] }));
  collectionPages(db);
  const [a, b, c] = tiles();
  assert.equal(a.mode, "auto");
  assert.equal("items" in a, false);
  assert.deepEqual(a.edits, [{ pageId: 3, title: L("Mes décors") }], "texte modifié gardé, attaché à la page");
  assert.equal(b.mode, "manual", "ordre différent : manuel");
  assert.equal(b.items.length, 3);
  assert.equal(c.mode, "manual");
  assert.equal(c.items.length, 3, "mode déjà posé : intact");
  const draft = JSON.parse(row(1).draft);
  assert.equal(draft.blocks[0].props.mode, "auto", "brouillon : liste exacte -> auto");
  assert.deepEqual(draft.blocks[0].props.edits, [{ pageId: 3, title: L("Mes décors") }]);
  assert.equal(draft.blocks[1].props.mode, undefined, "autre bloc intact");
  assert.equal(draft.blocks[2].props.mode, "manual", "brouillon : liste partielle -> manuel");
  assert.equal(draft.blocks[2].props.items.length, 1);
  const again = JSON.stringify([tiles(), row(1).draft]);
  assert.equal(collectionPages(db), 0, "idempotente");
  assert.equal(JSON.stringify([tiles(), row(1).draft]), again);
});

test("0022 : l'ordre du réglage `nav` fait foi ; anciennes planches seules comptent ; page non publiée ignorée", () => {
  const { db, addPage, addTiles, tiles } = makeDb();
  addPage(2, "Persos", [intro("characters", "Persos")], 1, 1);
  addPage(3, "Décors", [{ type: "collection-projects", props: { collection: "backgrounds" } }], 1, 2);
  addPage(4, "Anim", [intro("animation", "Anim")], 1, 3);
  addPage(5, "Caché", [intro("characters", "Caché")], 0, null);
  db.prepare("insert into settings (key, value) values ('nav', ?)").run(JSON.stringify([{ kind: "page", pageId: 4 }, { kind: "link", href: "/x", label: L("x") }, { kind: "page", pageId: 2 }, { kind: "page", pageId: 3 }]));
  addTiles(2, { ...base, items: [item(4, "animation", "Anim"), item(2, "characters", "Persos"), { ...item(3, "backgrounds", "Décors"), title: L("Décors"), eyebrow: L("Un jour"), intro: L("") }] });
  collectionPages(db);
  const [t] = tiles();
  assert.equal(t.mode, "auto", "suit l'ordre du menu (nav), pas nav_order");
  assert.deepEqual(t.edits, [{ pageId: 3, eyebrow: L("Un jour") }], "page à planches seules : titre = titre de la page, étiquette modifiée gardée");
});

/* ---- 4. Schéma ------------------------------------------------------------- */

test("schéma : ancien bloc (liste seule) valide et manuel ; mode, taille, modifications ; bornes", () => {
  const old = collectionTilesSchema.safeParse({ ...base, items: [item(2, "characters", "P")] });
  assert.equal(old.success, true);
  assert.equal(tilesMode(old.data), "manual", "sans mode : manuel (bloc d'avant la v0.19)");
  assert.equal(tilesMode({ mode: "auto" }), "auto");
  assert.equal(collectionTilesSchema.safeParse({ ...base }).success, true, "ni liste ni mode : valide");
  // Titre (section-title) : titre principal et compteurs (lot 22).
  assert.deepEqual(sectionTitleSchema.parse({ title: L("T"), main: true, counts: true }), { title: L("T"), main: true, counts: true });
  assert.equal(sectionTitleSchema.safeParse({ title: L("T") }).success, true, "ancien Titre valide");
  assert.equal(sectionTitleSchema.safeParse({ title: L("T"), main: "oui" }).success, false);
  assert.equal(sectionTitleSchema.safeParse({ title: L("T"), counts: 1 }).success, false);
  assert.equal(collectionTilesSchema.safeParse({ ...base, mode: "auto", size: "large", edits: [{ pageId: 2, title: L("x") }] }).success, true);
  for (const bad of [{ mode: "zzz" }, { size: "huge" }, { size: "" }, { edits: [{ pageId: 0 }] }, { edits: [{ pageId: 1, title: { fr: "x" } }] }, { edits: Array.from({ length: MAX_TILES * 2 + 1 }, (_, i) => ({ pageId: i + 1 })) }, { items: Array.from({ length: MAX_TILES + 1 }, () => item(2, "characters", "P")) }, { items: [{ ...item(2, "characters", "P"), collection: "pastels" }] }]) {
    assert.equal(collectionTilesSchema.safeParse({ ...base, ...bad }).success, false, JSON.stringify(bad).slice(0, 60));
  }
});

test("taille : défaut moyenne, plafonds croissants, jamais plus que l'écran", () => {
  assert.equal(tileSize(undefined), "medium");
  assert.equal(tileSize("n'importe quoi"), "medium");
  assert.equal(tileSize("small"), "small");
  const caps = ["small", "medium", "large"].map((s) => TILE_GEOMETRY[s].cap);
  assert.ok(caps[0] < caps[1] && caps[1] < caps[2] && caps[2] <= 100 && caps[1] <= 70, caps.join());
});

console.log(`\n${passed} tests passés`);
