#!/usr/bin/env node
/**
 * Lot 117 : entrées des collections vers n'importe quelle page (tests unitaires, inclus dans npm test, données SYNTHÉTIQUES).
 *  1. orderEntryPages : toutes les pages publiées sauf l'accueil et les pages spéciales, ordre du menu puis identifiant, collection gardée.
 *  2. Schéma : une entrée sans `collection` est valide ; les anciennes entrées (avec collection) se lisent à l'identique ; collection inconnue refusée.
 *  3. Liste manuelle : entrée sans collection = « broken » si sa page n'est plus publiée ; passage en automatique : entrée de page simple écartée, rien d'autre ne change.
 * Usage : node --import tsx scripts/test-entrees117.mjs
 */
import assert from "node:assert/strict";

import { collectionTilesSchema } from "../src/blocks/CollectionTilesBlock.tsx";
import { editsFromItems, itemsFromEntries, autoEntries, manualEntries, orderCollectionPages, orderEntryPages } from "../src/blocks/collection-pages.ts";

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`PASS  ${name}`);
};
const L = (fr, en = fr) => ({ fr, en });
const page = (id, slug, title, collection = null, blocks = []) => ({ id, slug: L(slug), title: L(title), collection, blocks });
const pages = [
  page(1, "", "Accueil"),
  page(2, "personnages", "Personnages", "characters", [{ type: "section-title", props: { eyebrow: L("Galerie"), title: L("Mes personnages"), intro: L("Présentation") } }]),
  page(3, "projets", "Projets"),
  page(4, "_404", "Page introuvable"),
  page(5, "decors", "Décors", "backgrounds"),
  page(6, "contact", "Contact"),
];

test("orderEntryPages : toutes les pages publiées sauf l'accueil et les pages spéciales", () => {
  const out = orderEntryPages(pages, []);
  assert.deepEqual(out.map((p) => p.pageId), [2, 3, 5, 6]);
});
test("orderEntryPages : ordre du menu d'abord, puis identifiant ; collection gardée seulement pour une page de collection", () => {
  const out = orderEntryPages(pages, [6, 3]);
  assert.deepEqual(out.map((p) => p.pageId), [6, 3, 2, 5]);
  assert.equal(out.find((p) => p.pageId === 3).collection, undefined);
  assert.ok(!("collection" in out.find((p) => p.pageId === 3)));
  assert.equal(out.find((p) => p.pageId === 2).collection, "characters");
});
test("orderEntryPages : textes = en-tête de la page (Titre) ou titre de la page", () => {
  const out = orderEntryPages(pages, []);
  assert.equal(out.find((p) => p.pageId === 2).title.fr, "Mes personnages");
  assert.equal(out.find((p) => p.pageId === 2).eyebrow.fr, "Galerie");
  assert.equal(out.find((p) => p.pageId === 3).title.fr, "Projets");
});
test("orderCollectionPages (mode automatique) : inchangé, pages de collection seulement", () => {
  const out = orderCollectionPages(pages.map(({ slug: _s, ...p }) => p), []);
  assert.deepEqual(out.map((p) => p.pageId), [2, 5]);
});

const base = { eyebrow: L("a"), title: L("b"), intro: L("c") };
test("schéma : entrée sans collection valide, image facultative dans le schéma", () => {
  const r = collectionTilesSchema.safeParse({ eyebrow: L(""), title: L("t"), mode: "manual", items: [{ pageId: 3, ...base, mediaId: 7 }, { pageId: 3, ...base }] });
  assert.ok(r.success, JSON.stringify(r.error?.issues));
  assert.ok(!("collection" in r.data.items[0]));
});
test("schéma : ancienne entrée (collection + page) lue à l'identique", () => {
  const old = { eyebrow: L(""), title: L("t"), items: [{ collection: "characters", pageId: 2, ...base }] };
  const r = collectionTilesSchema.safeParse(old);
  assert.ok(r.success);
  assert.deepEqual(r.data.items, old.items);
  assert.equal(r.data.mode, undefined);
});
test("schéma : collection inconnue refusée", () => {
  assert.equal(collectionTilesSchema.safeParse({ eyebrow: L(""), title: L("t"), items: [{ collection: "videos", pageId: 2, ...base }] }).success, false);
});
test("manualEntries : entrée sans collection dont la page n'est plus publiée = broken", () => {
  const items = [{ pageId: 3, ...base, mediaId: 7 }, { collection: "characters", pageId: 2, ...base }];
  assert.deepEqual(manualEntries(items, new Set([2, 3])).map((i) => i.broken), [false, false]);
  assert.deepEqual(manualEntries(items, new Set([2])).map((i) => i.broken), [true, false]);
});
test("passage en automatique : l'entrée de page simple est écartée, les textes modifiés des collections sont gardés", () => {
  const found = orderCollectionPages(pages.map(({ slug: _s, ...p }) => p), []);
  const items = [{ collection: "characters", pageId: 2, ...base, title: L("Autre titre") }, { pageId: 3, ...base, mediaId: 9 }];
  const edits = editsFromItems(items, found);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].pageId, 2);
  assert.equal(edits[0].title.fr, "Autre titre");
});
test("auto -> manuel : la liste de départ garde collection et textes (round trip)", () => {
  const found = orderCollectionPages(pages.map(({ slug: _s, ...p }) => p), []);
  const items = itemsFromEntries(autoEntries(found, []));
  assert.deepEqual(items.map((i) => i.collection), ["characters", "backgrounds"]);
});

console.log(`\n${passed} tests passés`);
