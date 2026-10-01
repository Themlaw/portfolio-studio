#!/usr/bin/env node
/**
 * Test des références blocs → médias / pages (src/blocks/refs.ts).
 * 1. Cas synthétiques (toujours, y compris en CI).
 * 2. Si une base de dev existe (./data/portfolio.db), vérifie sur le seed réel :
 *    le portrait n'est utilisé que par le bloc profile, chaque œuvre par un slot,
 *    la page Personnages est référencée par les tuiles et « voir tous les projets ».
 * Usage : npm test
 */
import { existsSync } from "node:fs";
import assert from "node:assert/strict";

const refs = await import(new URL("../src/blocks/refs.ts", import.meta.url));
const { BLOCK_REFS, valuesAt, extractRefs, mediaUsages, pageReferences, projectReferences } = refs;

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`PASS  ${name}`);
};

test("projets cités par « Projets mis en avant »", () => {
  const blocks = [
    { id: 1, pageId: 1, type: "featured-projects", props: { projects: ["a", "b"] } },
    { id: 2, pageId: 2, type: "featured-projects", props: {} },
    { id: 3, pageId: 2, type: "rich-text", props: { projects: ["a"] } },
  ];
  assert.deepEqual(projectReferences("a", blocks).map((u) => u.blockId), [1]);
  assert.deepEqual(projectReferences("c", blocks), []);
  assert.deepEqual(projectReferences("constructor", [{ id: 4, pageId: 1, type: "constructor", props: {} }]), []);
});

test("valuesAt : chemins simples, imbriqués et tableaux", () => {
  const props = { a: 1, more: { pageId: 7 }, items: [{ pageId: 2 }, { pageId: 3 }, {}] };
  assert.deepEqual(valuesAt(props, "a"), [1]);
  assert.deepEqual(valuesAt(props, "more.pageId"), [7]);
  assert.deepEqual(valuesAt(props, "items[].pageId"), [2, 3]);
  assert.deepEqual(valuesAt(props, "absent.x"), []);
  assert.deepEqual(valuesAt(null, "a"), []);
});

test("extractRefs : seuls les entiers aux chemins déclarés comptent", () => {
  assert.deepEqual(extractRefs("profile", { portraitMediaId: 5 }), { media: [5], pages: [] });
  assert.deepEqual(extractRefs("hero", { reelPageId: "4" }), { media: [], pages: [] });
  assert.deepEqual(extractRefs("inconnu", { portraitMediaId: 5 }), { media: [], pages: [] });
});

test("mediaUsages : slots (FK) et blocs (props)", () => {
  const rows = {
    slots: [
      { id: 1, projectId: 10, slug: "a", mediaId: 5 },
      { id: 2, projectId: 10, slug: "b", mediaId: null },
    ],
    blocks: [
      { id: 100, pageId: 1, type: "profile", props: { portraitMediaId: 5 } },
      { id: 101, pageId: 1, type: "profile", props: { portraitMediaId: 6 } },
      { id: 102, pageId: 2, type: "profile", props: undefined }, // JSON corrompu
    ],
  };
  const u = mediaUsages(5, rows);
  assert.equal(u.length, 2);
  assert.deepEqual(u.map((x) => x.kind).sort(), ["block", "slot"]);
  assert.equal(mediaUsages(99, rows).length, 0);
});

test("pageReferences : tuiles, lien « voir plus », bouton demoreel", () => {
  const blocks = [
    { id: 1, pageId: 1, type: "collection-tiles", props: { items: [{ pageId: 2 }, { pageId: 3 }] } },
    { id: 2, pageId: 1, type: "featured-projects", props: { more: { pageId: 2 } } },
    { id: 3, pageId: 1, type: "hero", props: { reelPageId: 4 } },
  ];
  assert.deepEqual(pageReferences(2, blocks).map((u) => u.blockId), [1, 2]);
  assert.deepEqual(pageReferences(4, blocks).map((u) => u.blockId), [3]);
  assert.equal(pageReferences(9, blocks).length, 0);
});

test("chaque type de bloc déclare ses références", () => {
  for (const type of ["hero", "collection-tiles", "featured-projects", "collection-intro", "collection-projects", "video", "rich-text", "contact", "profile"]) {
    assert.ok(BLOCK_REFS[type], type);
  }
});

const dbFile = new URL("../data/portfolio.db", import.meta.url).pathname;
if (existsSync(dbFile)) {
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(dbFile, { readonly: true });
  const blocks = db
    .prepare("select id, page_id as pageId, type, props from blocks")
    .all()
    .map((b) => ({ ...b, props: JSON.parse(b.props) }));
  const slots = db.prepare("select id, project_id as projectId, slug, media_id as mediaId from slots").all();
  const portrait = db.prepare("select id from media where original_name = 'portrait.svg'").get();
  const characters = db.prepare("select id from pages where json_extract(slug, '$.fr') = 'personnages'").get();

  test("seed réel : le portrait n'est utilisé que par le bloc profile", () => {
    const u = mediaUsages(portrait.id, { slots, blocks });
    assert.deepEqual(u.map((x) => x.kind === "block" && x.type), ["profile"]);
  });
  test("seed réel : chaque média d'œuvre est utilisé par exactement un slot", () => {
    for (const s of slots) assert.equal(mediaUsages(s.mediaId, { slots, blocks }).length, 1, s.slug);
  });
  test("seed réel : Personnages référencée par les tuiles et « voir tous les projets »", () => {
    assert.deepEqual(pageReferences(characters.id, blocks).map((u) => u.type).sort(), ["collection-tiles", "featured-projects"]);
  });
  db.close();
} else {
  console.log("(pas de base de dev : tests sur le seed réel ignorés)");
}

console.log(`\n${passed} test(s) OK`);
