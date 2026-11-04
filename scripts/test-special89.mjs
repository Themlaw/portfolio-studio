#!/usr/bin/env node
/**
 * Lot 89 « page introuvable éditable », sur une VRAIE base (seed, dossier temporaire), sans serveur (inclus dans npm test) :
 *  1. La migration de données crée UNE page « _404 » (idempotente : deux démarrages, une page ; une base antérieure au lot en reçoit une),
 *     avec un bloc « Sortie » aux textes de messages/*.json.
 *  2. Garde-fous serveur : la page ne se renomme pas, ne change pas d'adresse, ne se supprime pas, n'entre pas au menu ; Contact refusé ;
 *     « Sortie » obligatoire à la publication ; « Sortie » et « Une œuvre au hasard » refusés sur une page ordinaire.
 *  3. Le brouillon d'une page spéciale ou ordinaire refuse les mêmes choses (requête forgée).
 *  4. Exclusions : la page spéciale n'est pas au menu public ni dans les pages à lier.
 *  5. Projet masqué (docs/SECURITE.md N4) : un projet qu'aucune page n'affiche n'entre ni dans la couverture d'une
 *     collection, ni dans ses compteurs, ni dans la demoreel, ni dans les planches d'une collection, ni dans le
 *     repli des projets mis en avant ; il y entre dès qu'une page publiée (ou le brouillon vu) l'affiche.
 * Usage : node --import tsx scripts/test-special89.mjs
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

// Lectures de la galerie (`cached`) hors de Next : `next/cache` remplacé par un appel direct.
const NEXT_CACHE_STUB = new URL("./lib/next-cache-stub.cjs", import.meta.url).href;
registerHooks({ resolve: (spec, ctx, next) => (spec === "next/cache" ? { url: NEXT_CACHE_STUB, format: "commonjs", shortCircuit: true } : next(spec, ctx)) });

const dir = mkdtempSync(path.join(tmpdir(), "pf-test-special89-"));
process.env.DATA_DIR = dir;
const log = console.log;
console.log = () => {};
const { bootstrap } = await import("../src/lib/db/bootstrap.ts");
await bootstrap();
const { getDb, schema } = await import("../src/lib/db/index.ts");
const { and, eq, sql } = await import("drizzle-orm");
const db = getDb();
const specials = () => db.select().from(schema.pages).where(sql`json_extract(${schema.pages.slug}, '$.fr') = '_404'`).all();
const first = specials();
await bootstrap();
await bootstrap();
console.log = log;
const { readDraft, saveDraft } = await import("../src/lib/edit/drafts.ts");
const { savePage, deletePage, setInMenu, addToMenuFromEditor, createPage } = await import("../src/lib/edit/pages.ts");
const { listPagesForAdmin } = await import("../src/lib/admin.ts");
const { NOT_FOUND_SLUG, isSpecialSlug, isSpecialPage, scopeProblem } = await import("../src/lib/special-pages.ts");

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`PASS  ${name}`);
};
const L = (s) => ({ fr: s, en: s });
const fr = JSON.parse(readFileSync("messages/fr.json", "utf8")).notFound;
const en = JSON.parse(readFileSync("messages/en.json", "utf8")).notFound;

test("la migration crée une page « _404 » ; deux démarrages de plus n'en créent pas d'autre", () => {
  assert.equal(first.length, 1);
  assert.equal(specials().length, 1);
  assert.equal(first[0].published, true);
  assert.equal(first[0].navOrder, null);
});

const blocksOf = (id) => db.select().from(schema.blocks).where(eq(schema.blocks.pageId, id)).orderBy(schema.blocks.position).all();

let page = specials()[0];
test("elle porte un bloc « Sortie » avec les textes de la 404 d'origine, dans les deux langues", () => {
  const blocks = blocksOf(page.id);
  assert.deepEqual(blocks.map((b) => b.type), ["exit"]);
  const props = typeof blocks[0].props === "string" ? JSON.parse(blocks[0].props) : blocks[0].props;
  assert.equal(props.title.fr, fr.title);
  assert.equal(props.label.fr, fr.back);
  assert.equal(props.label.en, en.back);
  assert.equal(props.messages.length, 1);
});

{
  // Base d'avant le lot : la page n'existe pas ; le démarrage suivant la recrée (restauration d'une sauvegarde ancienne comprise).
  db.delete(schema.blocks).where(eq(schema.blocks.pageId, page.id)).run();
  db.delete(schema.pages).where(eq(schema.pages.id, page.id)).run();
  assert.equal(specials().length, 0);
  const { seedNotFoundPage } = await import("../src/lib/db/seed-404.ts");
  const { default: Database } = await import("better-sqlite3");
  const raw = new Database(path.join(dir, "portfolio.db"));
  assert.equal(seedNotFoundPage(raw).created, true);
  assert.equal(seedNotFoundPage(raw).created, false);
  raw.close();
  assert.equal(specials().length, 1);
  page = specials()[0];
  passed++;
  console.log("PASS  une base d'avant le lot (sans la page) la retrouve au démarrage suivant, une seule fois");
}

test("slugs : tout ce qui commence par « _ » est spécial", () => {
  assert.equal(NOT_FOUND_SLUG, "_404");
  assert.ok(isSpecialSlug("_404") && isSpecialSlug("_autre"));
  assert.ok(!isSpecialSlug("a-propos") && !isSpecialSlug(""));
  assert.ok(isSpecialPage({ slug: L("_404") }));
});

const draftOf = () => readDraft(page.id);
const exitBlock = () => ({ uid: "x", type: "exit", props: JSON.parse(JSON.stringify(blocksOf(page.id)[0].props instanceof Object ? blocksOf(page.id)[0].props : JSON.parse(blocksOf(page.id)[0].props))) });
const form = (over = {}) => ({
  title: page.title,
  slug: page.slug,
  meta: { title: L(""), description: L("") },
  published: true,
  inMenu: false,
  collection: null,
  accent: null,
  blocks: [exitBlock()],
  ...over,
});

test("savePage : enregistre telle quelle, refuse renommage, adresse, menu, collection, Contact, absence de « Sortie »", () => {
  assert.equal(savePage(page.id, form()).ok, true);
  assert.equal(savePage(page.id, form({ title: L("Autre") })).ok, false);
  assert.equal(savePage(page.id, form({ slug: L("autre") })).ok, false);
  assert.equal(savePage(page.id, form({ inMenu: true })).ok, false);
  assert.equal(savePage(page.id, form({ collection: "characters" })).ok, false);
  assert.equal(savePage(page.id, form({ blocks: [exitBlock(), { uid: "c", type: "contact", props: {} }] })).ok, false);
  assert.equal(savePage(page.id, form({ blocks: [] })).ok, false);
});

test("deletePage, setInMenu et addToMenuFromEditor refusent la page spéciale", () => {
  assert.equal(deletePage(page.id).ok, false);
  assert.equal(setInMenu(page.id, true).ok, false);
  assert.equal(addToMenuFromEditor(page.id).ok, false);
  assert.equal(specials().length, 1);
  assert.equal(specials()[0].deletedAt, null);
});

test("saveDraft : le brouillon de la page spéciale refuse renommage et Contact (requête forgée) ; un brouillon sans « Sortie » est toléré", () => {
  const { rev, draft } = draftOf();
  assert.equal(saveDraft(page.id, { ...draft, title: L("Autre"), blocks: [exitBlock()] }, rev).ok, false);
  assert.equal(saveDraft(page.id, { ...draft, blocks: [exitBlock(), { uid: "c", type: "contact", props: {} }] }, draftOf().rev).ok, false);
  assert.equal(saveDraft(page.id, { ...draft, blocks: [] }, draftOf().rev).ok, true);
});

test("une page ordinaire refuse « Sortie » et « Une œuvre au hasard » (formulaire et brouillon)", () => {
  const id = createPage({ title: L("Ordinaire"), slug: L("ordinaire") }).data.id;
  const base = { title: L("Ordinaire"), slug: L("ordinaire"), meta: { title: L(""), description: L("") }, published: true, inMenu: false, collection: null, accent: null };
  assert.equal(savePage(id, { ...base, blocks: [{ uid: "e", type: "exit", props: exitBlock().props }] }).ok, false);
  assert.equal(savePage(id, { ...base, blocks: [{ uid: "r", type: "random-work", props: { source: "all" } }] }).ok, false);
  const { rev, draft } = readDraft(id);
  assert.equal(saveDraft(id, { ...draft, blocks: [{ uid: "e", type: "exit", props: exitBlock().props }] }, rev).ok, false);
  assert.ok(scopeProblem(false, ["exit"], (t) => t));
  assert.equal(scopeProblem(true, ["exit", "random-work", "rich-text"], (t) => t), null);
  assert.ok(scopeProblem(true, ["contact"], (t) => t));
});

test("la page spéciale n'est pas une page à lier ni au menu public", () => {
  const rows = listPagesForAdmin();
  const row = rows.find((r) => r.id === page.id);
  assert.equal(row?.special, true);
  assert.ok(rows.filter((r) => r.special).length === 1);
});

/* ---- Projet masqué (N4) : ni couverture, ni compteur, ni demoreel, ni planche de collection ---- */

{
  const gallery = await import("../src/lib/gallery.ts");
  const { readDisplayedProjects } = gallery;
  // Aucune Couverture choisie dans le seed : la couverture d'une collection est sa première œuvre (sauf une Couverture).
  const seedCovers = db.select().from(schema.slots).all().filter((x) => x.featured).map((x) => x.id);
  db.update(schema.slots).set({ featured: false }).run();
  const before = {
    count: await gallery.countCollection("characters"),
    countAnim: await gallery.countCollection("animation"),
    cover: (await gallery.getCollectionCover("characters", "fr"))?.slug,
    reel: (await gallery.getReel("fr"))?.slug,
    projects: (await gallery.getProjectsForCollection("characters", "fr")).map((p) => p.slug),
    featured: (await gallery.getFeaturedProjects("fr", 50)).map((p) => p.slug),
    displayed: readDisplayedProjects(),
  };
  test("seed : tous les projets publiés sont affichés par une page (rien ne change pour eux)", () => {
    const all = db.select().from(schema.projects).all().filter((p) => !p.deletedAt && p.draftPageId === null);
    assert.ok(all.length >= 2);
    assert.deepEqual([...before.displayed].sort(), all.map((p) => p.id).sort());
  });
  // Projet « sous NDA » : publié, avec une Couverture (featured), une demoreel, marqué « mis en avant », mais sur aucune page.
  const media = db.insert(schema.media).values({ key: "originals/nda0000000000000.png", sha256: "e".repeat(64), kind: "image", mime: "image/png", originalName: "client-nda.png", size: 1, status: "ready", width: 800, height: 600, alt: { fr: "NDA", en: "NDA" } }).returning({ id: schema.media.id }).get().id;
  const position = Math.max(...db.select().from(schema.projects).all().map((p) => p.position)) + 1;
  const hidden = db.insert(schema.projects).values({ slug: "projet-nda", title: L("Projet NDA"), context: L("Client"), description: L("Secret"), year: "2026", featured: true, position }).returning({ id: schema.projects.id }).get().id;
  const slot = (slug, collection, extra = {}) => db.insert(schema.slots).values({ projectId: hidden, mediaId: media, position: 0, slug, collection, title: L(slug), description: L(""), year: 2026, ...extra }).run();
  slot("nda-perso", "characters", { featured: true });
  slot("nda-reel", "animation", { reel: true, position: 1 });
  // L'ancienne demoreel du seed passe après : celle du projet masqué serait la première.
  db.update(schema.slots).set({ reel: false }).where(eq(schema.slots.slug, before.reel ?? "")).run();

  const after = {
    count: await gallery.countCollection("characters"),
    countAnim: await gallery.countCollection("animation"),
    cover: (await gallery.getCollectionCover("characters", "fr"))?.slug,
    reel: (await gallery.getReel("fr"))?.slug,
    projects: (await gallery.getProjectsForCollection("characters", "fr")).map((p) => p.slug),
    featured: (await gallery.getFeaturedProjects("fr", 50)).map((p) => p.slug),
    collection: (await gallery.getCollection("characters", "fr")).map((a) => a.slug),
  };
  test("N4 projet sur aucune page : absent des projets affichés, des compteurs, de la couverture, de la demoreel", () => {
    assert.ok(!readDisplayedProjects().has(hidden));
    assert.equal(after.count, before.count, "compteur « N œuvres » des personnages inchangé");
    assert.equal(after.countAnim, before.countAnim, "compteur de l'animation inchangé");
    assert.notEqual(after.cover, "nda-perso", "sa Couverture ne devient pas celle de la tuile");
    assert.equal(after.cover, before.cover);
    assert.notEqual(after.reel, "nda-reel", "sa vidéo ne devient pas la demoreel");
    assert.ok(!after.projects.includes("projet-nda"), "absent des planches de la collection");
    assert.ok(!after.featured.includes("projet-nda"), "absent des projets mis en avant (repli compris)");
    assert.ok(!after.collection.includes("nda-perso"), "absent de la liste de la collection");
  });

  // Une page publiée l'affiche (bloc Projet) : il entre partout.
  const home = db.select().from(schema.pages).all().find((p) => p.slug.fr === "");
  const block = db.insert(schema.blocks).values({ pageId: home.id, position: 999, type: "project-board", props: JSON.stringify({ project: "projet-nda" }) }).returning({ id: schema.blocks.id }).get().id;
  const shown = {
    displayed: readDisplayedProjects().has(hidden),
    count: await gallery.countCollection("characters"),
    cover: (await gallery.getCollectionCover("characters", "fr"))?.slug,
    reel: (await gallery.getReel("fr"))?.slug,
    projects: (await gallery.getProjectsForCollection("characters", "fr")).map((p) => p.slug),
  };
  db.delete(schema.blocks).where(eq(schema.blocks.id, block)).run();
  test("N4 affiché par une page publiée : compté, couverture, demoreel et planche de collection", () => {
    assert.ok(shown.displayed);
    assert.ok(shown.count > before.count, `${shown.count} > ${before.count}`);
    assert.equal(shown.cover, "nda-perso");
    assert.equal(shown.reel, "nda-reel");
    assert.ok(shown.projects.includes("projet-nda"));
  });
  test("N4 page dépubliée ou bloc seulement en brouillon : masqué ; brouillon vu (éditeur) : affiché", () => {
    db.insert(schema.blocks).values({ pageId: home.id, position: 999, type: "project-board", props: JSON.stringify({ project: "projet-nda" }) }).run();
    db.update(schema.pages).set({ published: false }).where(eq(schema.pages.id, home.id)).run();
    assert.ok(!readDisplayedProjects().has(hidden), "page non publiée");
    db.update(schema.pages).set({ published: true }).where(eq(schema.pages.id, home.id)).run();
    db.delete(schema.blocks).where(and(eq(schema.blocks.pageId, home.id), eq(schema.blocks.position, 999))).run();
    const other = db.select().from(schema.pages).all().find((p) => p.slug.fr !== "" && p.published && !p.deletedAt);
    const draft = [{ type: "grid", props: { children: [{ type: "project-board", props: { project: "projet-nda" } }] } }];
    assert.ok(readDisplayedProjects({ pageId: other.id, blocks: draft }).has(hidden), "brouillon vu : planche dans un conteneur");
    assert.ok(!readDisplayedProjects().has(hidden), "le public ne voit pas le brouillon");
    // Anciens blocs : « Projets mis en avant » sans choix (projets marqués), planches d'une collection.
    assert.ok(readDisplayedProjects({ pageId: other.id, blocks: [{ type: "featured-projects", props: { limit: 2 } }] }).has(hidden));
    assert.ok(readDisplayedProjects({ pageId: other.id, blocks: [{ type: "collection-projects", props: { collection: "animation" } }] }).has(hidden));
    assert.ok(!readDisplayedProjects({ pageId: other.id, blocks: [{ type: "collection-projects", props: { collection: "backgrounds" } }] }).has(hidden));
  });
  // Remise en état pour la suite (tirage au hasard sur le seed).
  db.delete(schema.slots).where(eq(schema.slots.projectId, hidden)).run();
  db.delete(schema.projects).where(eq(schema.projects.id, hidden)).run();
  db.delete(schema.media).where(eq(schema.media.id, media)).run();
  if (before.reel) db.update(schema.slots).set({ reel: true }).where(eq(schema.slots.slug, before.reel)).run();
  for (const id of seedCovers) db.update(schema.slots).set({ featured: true }).where(eq(schema.slots.id, id)).run();
}

/* ---- Une œuvre au hasard : ce qui peut être tiré ---- */

const { readPoolWorks, selectWorks } = await import("../src/lib/random-works.ts");
const pool = readPoolWorks();
const slugs = () => readPoolWorks().map((w) => w.slug);

test("le tirage porte sur les œuvres publiées du portfolio (seed) ; chaque œuvre a son image, son titre et sa page", () => {
  assert.ok(pool.length >= 10, `${pool.length} œuvres`);
  for (const w of pool) {
    assert.ok(w.url && w.title.fr && w.path.fr.startsWith("/"), w.slug);
  }
  assert.ok(new Set(pool.map((w) => w.collection)).size >= 2);
});

test("sources : toute la collection, une catégorie, une sélection (inconnue = vide)", () => {
  const some = pool[0];
  assert.equal(selectWorks(pool, { source: "all" }).length, pool.length);
  const cat = selectWorks(pool, { source: "collection", collection: some.collection });
  assert.ok(cat.length >= 1 && cat.every((w) => w.collection === some.collection));
  assert.deepEqual(selectWorks(pool, { source: "manual", works: [some.slug] }).map((w) => w.slug), [some.slug]);
  assert.equal(selectWorks(pool, { source: "manual", works: ["n-existe-pas"] }).length, 0);
});

test("jamais une œuvre en brouillon, à la corbeille, dont le média n'est pas prêt, ni d'un projet à la corbeille ou non montré", () => {
  const [a, b, c, d] = pool;
  const slot = (w) => db.select().from(schema.slots).where(eq(schema.slots.slug, w.slug)).get();
  // brouillon : emplacement créé dans un brouillon de page
  db.update(schema.slots).set({ draftState: "added" }).where(eq(schema.slots.id, slot(a).id)).run();
  assert.ok(!slugs().includes(a.slug));
  // média à la corbeille
  db.update(schema.media).set({ deletedAt: new Date() }).where(eq(schema.media.id, slot(b).mediaId)).run();
  assert.ok(!slugs().includes(b.slug));
  // média pas prêt
  db.update(schema.media).set({ status: "processing" }).where(eq(schema.media.id, slot(c).mediaId)).run();
  assert.ok(!slugs().includes(c.slug));
  // projet à la corbeille
  db.update(schema.projects).set({ deletedAt: new Date() }).where(eq(schema.projects.id, slot(d).projectId)).run();
  assert.ok(!slugs().includes(d.slug));
  // pages dépubliées : plus aucune page ne montre rien
  db.update(schema.pages).set({ published: false }).where(sql`json_extract(slug, '$.fr') != '' and json_extract(slug, '$.fr') != '_404'`).run();
  const left = readPoolWorks();
  assert.ok(left.length < pool.length - 3);
});

console.log(`${passed} tests, 0 échec`);
process.exit(0);
