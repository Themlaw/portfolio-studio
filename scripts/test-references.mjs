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
const { BLOCK_REFS, valuesAt, extractRefs, mediaUsages, mediaUsageIndex, pageReferences, projectReferences } = refs;

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

test("mediaUsageIndex (lot 23) : le brouillon d'un bloc publié est la même place (compteur = détail)", () => {
  const blocks = [
    { id: 1, pageId: 1, type: "profile", props: { portraitMediaId: 5 } },
    // Brouillon de la même page : le même bloc, retouché.
    { id: -1001, pageId: 1, type: "profile", props: { portraitMediaId: 5 }, draft: true },
    // Autre page : une autre place.
    { id: 2, pageId: 2, type: "profile", props: { portraitMediaId: 5 } },
    // Brouillon seul (bloc ajouté, pas encore publié) : une place.
    { id: -2001, pageId: 3, type: "profile", props: { portraitMediaId: 5 }, draft: true },
    // Deux blocs publiés de même type sur une page : deux places ; leur brouillon ne les double pas.
    { id: 3, pageId: 4, type: "image", props: { mediaId: 7 } },
    { id: 4, pageId: 4, type: "image", props: { mediaId: 7 } },
    { id: -4001, pageId: 4, type: "image", props: { mediaId: 7 }, draft: true },
    { id: -4002, pageId: 4, type: "image", props: { mediaId: 7 }, draft: true },
  ];
  const slots = [
    { id: 1, projectId: 10, slug: "a", mediaId: 5 },
    // Même emplacement vu deux fois (média publié et média de brouillon identiques) : une place.
    { id: 1, projectId: 10, slug: "a", mediaId: 5, draftPageId: 1 },
    { id: 2, projectId: 10, slug: "b", mediaId: 8, draftPageId: 1 },
  ];
  const index = mediaUsageIndex({ slots, blocks });
  assert.equal(index.get(5).length, 1 + 3, "1 emplacement + pages 1, 2, 3");
  assert.equal(index.get(7).length, 2, "deux blocs, pas quatre");
  assert.equal(index.get(8)[0].draftPageId, 1, "la page du brouillon est nommée");
  for (const m of [5, 7, 8]) assert.equal(mediaUsages(m, { slots, blocks }).length, index.get(m).length, "mediaUsages = index");
  assert.equal(index.get(99), undefined);
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
  for (const type of ["hero", "collection-tiles", "featured-projects", "featured-project", "grid", "video-single", "image", "cv", "section-title", "project-board", "collection-intro", "collection-projects", "video", "rich-text", "contact", "profile"]) {
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

/* ---- Partage et référencement (docs/SECURITE.md N7) : icône, image de partage du site, image de partage d'une page -------- */
// Sur une VRAIE base jetable (seed), sans serveur : mediaUsagesByMedia (src/lib/references.ts, la source unique), refus de la
// corbeille et de la purge, puis dossiers icons/<média>-* supprimés avec le média.
{
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  // Script lancé sans tsx (npm test) : on l'enregistre ici, pour ESM et CommonJS (alias « @/ » du tsconfig compris).
  (await import("tsx/esm/api")).register();
  (await import("tsx/cjs/api")).register();
  const dir = mkdtempSync(path.join(tmpdir(), "pf-test-references-"));
  process.env.DATA_DIR = dir;
  const log = console.log;
  console.log = () => {};
  const { bootstrap } = await import("../src/lib/db/bootstrap.ts");
  await bootstrap();
  const { getDb, schema } = await import("../src/lib/db/index.ts");
  const { eq } = await import("drizzle-orm");
  const { mediaUsagesByMedia, FAVICON_USAGE_TYPE, SHARE_USAGE_TYPE, PAGE_SHARE_USAGE_TYPE } = await import("../src/lib/references.ts");
  const { deleteMedia } = await import("../src/lib/edit/media.ts");
  const { purgeMedia } = await import("../src/lib/edit/trash.ts");
  console.log = log;
  const db = getDb();
  const L = (s) => ({ fr: s, en: s });
  const addMedia = (sha) => {
    const key = `img/${sha}/960.webp`;
    mkdirSync(path.join(dir, "media", path.dirname(key)), { recursive: true });
    writeFileSync(path.join(dir, "media", key), "x");
    return db
      .insert(schema.media)
      .values({ key: `originals/${sha}.png`, sha256: sha.padEnd(64, "0"), kind: "image", mime: "image/png", originalName: "x.png", size: 1, width: 10, height: 10, variants: { v: 1, files: [{ key, format: "webp", w: 960, h: 960 }] }, status: "ready", alt: L("") })
      .returning({ id: schema.media.id })
      .get().id;
  };
  const setSeo = (v) => db.insert(schema.settings).values({ key: "seo", value: JSON.stringify(v) }).onConflictDoUpdate({ target: schema.settings.key, set: { value: JSON.stringify(v) } }).run();
  const home = db.select({ id: schema.pages.id }).from(schema.pages).orderBy(schema.pages.id).get().id;
  const other = db.select({ id: schema.pages.id }).from(schema.pages).orderBy(schema.pages.id).all()[1].id;
  const uses = (id) => (mediaUsagesByMedia().get(id) ?? []).map((u) => [u.type, u.pageId]);

  const icon = addMedia("5e05e05e05e05e01");
  const share = addMedia("5e05e05e05e05e02");
  const pageImg = addMedia("5e05e05e05e05e03");
  const draftImg = addMedia("5e05e05e05e05e04");
  setSeo({ description: L(""), shareImage: share, favicon: { mediaId: icon, dir: `icons/${icon}-5e05e05e` } });
  const page = db.select().from(schema.pages).where(eq(schema.pages.id, other)).get();
  db.update(schema.pages).set({ meta: { ...(page.meta ?? { title: L(""), description: L("") }), image: pageImg } }).where(eq(schema.pages.id, other)).run();
  db.update(schema.pages).set({ draft: { ...(page.draft ?? {}), meta: { title: L(""), description: L(""), image: draftImg } } }).where(eq(schema.pages.id, other)).run();

  test("N7 icône de l'onglet (seo.favicon.mediaId) : un usage, rattaché à l'accueil", () => assert.deepEqual(uses(icon), [[FAVICON_USAGE_TYPE, home]]));
  test("N7 image de partage du site (seo.shareImage) : un usage", () => assert.deepEqual(uses(share), [[SHARE_USAGE_TYPE, home]]));
  test("N7 image de partage d'une page : publiée (pages.meta.image) et brouillon (draft.meta.image)", () => {
    assert.deepEqual(uses(pageImg), [[PAGE_SHARE_USAGE_TYPE, other]]);
    assert.deepEqual(uses(draftImg), [[PAGE_SHARE_USAGE_TYPE, other]]);
  });
  // Même image publiée ET en brouillon sur la même page : une seule place.
  db.update(schema.pages).set({ draft: { ...(page.draft ?? {}), meta: { title: L(""), description: L(""), image: pageImg } } }).where(eq(schema.pages.id, other)).run();
  test("N7 même image de partage publiée et en brouillon : comptée une fois", () => assert.equal(uses(pageImg).length, 1));

  for (const [label, id] of [["icône", icon], ["image de partage du site", share], ["image de partage de la page", pageImg]]) {
    const r = await deleteMedia(id);
    test(`N7 ${label} : mise à la corbeille refusée, endroit nommé`, () => {
      assert.equal(r.ok, false);
      assert.equal(r.references?.length, 1);
      assert.equal(db.select().from(schema.media).where(eq(schema.media.id, id)).get().deletedAt, null);
    });
  }
  // Purge : une icône encore citée (média passé à la corbeille par une ancienne version) n'est pas purgée ; libérée, ses dossiers partent.
  const iconDir = path.join(dir, "media", "icons", `${icon}-5e05e05e`);
  const iconCrop = path.join(dir, "media", "icons", `${icon}-5e05e05e-cabcdef`);
  const neighbour = path.join(dir, "media", "icons", `${icon}0-5e05e05e`);
  for (const d of [iconDir, iconCrop, neighbour]) {
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, "32.png"), "x");
  }
  db.update(schema.media).set({ deletedAt: new Date(Date.now() - 40 * 86400_000) }).where(eq(schema.media.id, icon)).run();
  const kept = await purgeMedia(icon);
  test("N7 purge refusée tant que l'icône est réglée", () => assert.equal(kept, false));
  setSeo({ description: L(""), shareImage: share, favicon: null });
  const purged = await purgeMedia(icon);
  test("N7 purge d'un média libre : ses dossiers icons/<id>-* supprimés, pas ceux d'un autre média", () => {
    assert.equal(purged, true);
    assert.equal(existsSync(iconDir), false);
    assert.equal(existsSync(iconCrop), false);
    assert.equal(existsSync(neighbour), true, `icons/${icon}0-… appartient à un autre média`);
  });
}

console.log(`\n${passed} test(s) OK`);
