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

test("conteneurs (v0.13) : les références des composants comptent, sur deux niveaux, pas au-delà", () => {
  const container = {
    id: 7,
    pageId: 1,
    type: "featured-project",
    props: {
      project: "atelier",
      more: { pageId: 3 },
      children: [
        { uid: "a", type: "image", props: { mediaId: 11 } },
        { uid: "b", type: "project-board", props: { project: "autre" } },
        {
          uid: "c",
          type: "grid",
          props: {
            children: [
              { uid: "d", type: "video-single", props: { mediaId: 12, posterMediaId: 13 } },
              // Au-delà de deux niveaux de conteneurs : jamais lu.
              { uid: "e", type: "grid", props: { children: [{ uid: "f", type: "image", props: { mediaId: 99 } }] } },
            ],
          },
        },
      ],
    },
  };
  const rows = { slots: [], blocks: [container] };
  for (const m of [11, 12, 13]) assert.deepEqual(mediaUsages(m, rows).map((u) => u.blockId), [7], `média ${m}`);
  assert.equal(mediaUsages(99, rows).length, 0);
  assert.deepEqual(projectReferences("atelier", [container]).map((u) => u.blockId), [7]);
  assert.deepEqual(projectReferences("autre", [container]).map((u) => u.blockId), [7]);
  assert.deepEqual(pageReferences(3, [container]).map((u) => u.blockId), [7]);
  // Profondeur « références propres seulement » (validation composant par composant).
  assert.deepEqual(extractRefs("featured-project", container.props, 2), { media: [], pages: [3] });
});

test("chaque type de bloc déclare ses références", () => {
  for (const type of ["hero", "collection-tiles", "featured-projects", "featured-project", "grid", "video-single", "image", "section-title", "project-board", "collection-intro", "collection-projects", "video", "rich-text", "contact", "profile"]) {
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
    // Avant ou après la migration 0014 (« featured-projects » → conteneur « featured-project »).
    const types = pageReferences(characters.id, blocks).map((u) => u.type.replace("featured-projects", "featured-project")).sort();
    assert.deepEqual(types, ["collection-tiles", "featured-project"]);
  });
  db.close();
} else {
  console.log("(pas de base de dev : tests sur le seed réel ignorés)");
}

console.log(`\n${passed} test(s) OK`);
