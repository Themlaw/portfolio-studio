#!/usr/bin/env node
/**
 * Lot 23 — corbeille, création de page, compteur d'usages, sur une VRAIE base (seed, dossier temporaire),
 * sans serveur (inclus dans npm test) :
 *  1. Titre anglais facultatif (repli sur le français) à la création et à l'enregistrement.
 *  2. Pages : supprimer = corbeille (plus publique, hors liste, hors menu, non éditable), restaurer (menu retrouvé,
 *     adresse reprise → variante libre), refusée tant qu'un bloc la montre, purge après 30 jours (simulée).
 *  3. Projets : même cycle ; refus tant qu'un bloc le montre.
 *  4. Médias : un média utilisé ne se supprime pas (liste des endroits), un média libre va à la corbeille (n'est
 *     plus servi), se restaure, ressort si le même contenu est renvoyé, est purgé (fichiers compris).
 *  5. Compteur d'usages = détail : une seule règle, le brouillon d'un bloc publié n'est pas une seconde place.
 * Usage : node --import tsx scripts/test-trash.mjs
 */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "pf-test-trash-"));
process.env.DATA_DIR = dir;
const log = console.log;
console.log = () => {};
const { bootstrap } = await import("../src/lib/db/bootstrap.ts");
await bootstrap();
const { getDb, schema } = await import("../src/lib/db/index.ts");
const { eq } = await import("drizzle-orm");
const { createPage, deletePage, restorePage, savePage } = await import("../src/lib/edit/pages.ts");
const { createProject, deleteProject, restoreProject } = await import("../src/lib/edit/projects.ts");
const { deleteMedia, restoreMedia } = await import("../src/lib/edit/media.ts");
const { purgeTrash } = await import("../src/lib/edit/trash.ts");
const { reviveIfTrashed } = await import("../src/lib/upload/revive.ts");
const { saveDraft, readDraft } = await import("../src/lib/edit/drafts.ts");
const { publishedSlugExists } = await import("../src/lib/pages-index.ts");
const { findMediaByKey } = await import("../src/lib/media.ts");
const { listPagesForAdmin, listTrashedPages, listProjectsForAdmin, listTrashedProjects, listMediaForAdmin, listTrashedMedia, getMediaUses, getPageForEdit, getProjectForEdit } = await import("../src/lib/admin.ts");
const { mediaUsagesByMedia } = await import("../src/lib/references.ts");
const { readNav } = await import("../src/lib/edit/nav.ts");
const { daysLeft, purgeAt, TRASH_DAYS } = await import("../src/lib/trash.ts");
console.log = log;

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log(`PASS  ${name}`);
};
const db = getDb();
const L = (s) => ({ fr: s, en: s });
const DAY = 86_400_000;
const backdate = (table, id, days) => db.update(table).set({ deletedAt: new Date(Date.now() - days * DAY) }).where(eq(table.id, id)).run();
const navIds = () => readNav().flatMap((i) => (i.kind === "page" ? [i.pageId] : []));
const slugOf = (id) => db.select().from(schema.pages).where(eq(schema.pages.id, id)).get().slug;

/* ---- 0. Délais ------------------------------------------------------------------ */
await test("délai : 30 jours, jours restants arrondis vers le haut, jamais négatifs", () => {
  assert.equal(TRASH_DAYS, 30);
  const t0 = Date.UTC(2026, 0, 1);
  assert.equal(purgeAt(t0), t0 + 30 * DAY);
  assert.equal(daysLeft(t0, t0), 30);
  assert.equal(daysLeft(t0, t0 + 29 * DAY + 1), 1);
  assert.equal(daysLeft(t0, t0 + 90 * DAY), 0);
});

/* ---- 1. Titre anglais facultatif ------------------------------------------------- */
await test("création : titre anglais vide → repris du français ; adresse anglaise vide → reprise du français", () => {
  const r = createPage({ title: { fr: "Carnets", en: "" }, slug: { fr: "carnets", en: "" } });
  assert.equal(r.ok, true, JSON.stringify(r));
  const row = db.select().from(schema.pages).where(eq(schema.pages.id, r.data.id)).get();
  assert.deepEqual(row.title, { fr: "Carnets", en: "Carnets" });
  assert.deepEqual(row.slug, { fr: "carnets", en: "carnets" });
  assert.equal(row.published, false);
});
await test("création : le titre français reste obligatoire ; l'anglais est borné", () => {
  assert.equal(createPage({ title: { fr: "", en: "Sketch" }, slug: { fr: "x", en: "y" } }).ok, false);
  assert.equal(createPage({ title: { fr: "A", en: "x".repeat(81) }, slug: { fr: "a-1", en: "a-1" } }).ok, false);
  assert.equal(createPage({ title: { fr: "A", en: "Sketch" } }).ok, false);
});
await test("enregistrement d'une page : titre anglais vide accepté (repli sur le français)", () => {
  const id = createPage({ title: L("Encore"), slug: L("encore") }).data.id;
  const r = savePage(id, { title: { fr: "Encore", en: "" }, slug: { fr: "encore", en: "encore-en" }, meta: { title: { fr: "", en: "" }, description: { fr: "", en: "" } }, published: false, inMenu: false, accent: null, blocks: [] });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(db.select().from(schema.pages).where(eq(schema.pages.id, id)).get().title.en, "Encore");
});

/* ---- 2. Pages --------------------------------------------------------------------- */
const pagePayload = (title, slug, blocks = []) => ({ title: L(title), slug: L(slug), meta: { title: L(""), description: L("") }, published: true, inMenu: true, accent: null, blocks });
await test("page : corbeille → plus publique, hors liste, hors menu, non éditable, dans la corbeille", () => {
  const id = createPage({ title: L("Croquis"), slug: L("croquis") }).data.id;
  assert.equal(savePage(id, pagePayload("Croquis", "croquis")).ok, true);
  assert.equal(publishedSlugExists("fr", "croquis"), true);
  assert.ok(navIds().includes(id), "au menu");
  const r = deletePage(id);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.title, "Croquis");
  assert.equal(publishedSlugExists("fr", "croquis"), false, "plus publique");
  assert.equal(publishedSlugExists("fr", "croquis", { includeDrafts: true }), false, "ni en aperçu");
  assert.equal(listPagesForAdmin().some((p) => p.id === id), false);
  assert.equal(listTrashedPages().some((p) => p.id === id), true);
  assert.equal(getPageForEdit(id), null, "non éditable");
  assert.equal(navIds().includes(id), false, "hors menu");
  assert.equal(savePage(id, pagePayload("Croquis", "croquis")).ok, false, "non enregistrable");
  assert.equal(deletePage(id).ok, false, "déjà à la corbeille");
});
await test("page : restaurer → de retour (liste, menu, publique) ; la corbeille ne retient pas l'adresse", () => {
  const id = listTrashedPages().find((p) => p.title === "Croquis").id;
  // Adresse reprise par une autre page entre-temps.
  const other = createPage({ title: L("Autre"), slug: L("croquis") }).data.id;
  assert.equal(other > 0, true, "l'adresse d'une page à la corbeille est libre");
  const r = restorePage(id);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.slugChanged, true, "adresse reprise → variante libre");
  assert.equal(slugOf(id).fr, "croquis-2");
  assert.equal(listTrashedPages().some((p) => p.id === id), false);
  assert.equal(getPageForEdit(id)?.title.fr, "Croquis");
  assert.ok(navIds().includes(id), "retrouve le menu");
  assert.equal(publishedSlugExists("fr", "croquis-2"), true);
  assert.equal(restorePage(id).ok, false, "pas dans la corbeille");
});
await test("page : la page d'accueil ne se supprime pas ; une page montrée par un bloc non plus (liste donnée)", () => {
  const home = db.select().from(schema.pages).all().find((p) => p.slug.fr === "").id;
  assert.equal(deletePage(home).ok, false);
  const perso = db.select().from(schema.pages).all().find((p) => p.slug.fr === "personnages").id;
  const r = deletePage(perso);
  assert.equal(r.ok, false);
  assert.ok(r.references.length > 0 && r.references.every((x) => x.pageTitle && x.blockType), "références nommées");
  const row = listPagesForAdmin().find((p) => p.id === perso);
  assert.ok(row.blockedBy.length > 0, "l'écran connaît le blocage à l'avance (bouton inactif)");
  assert.equal(db.select().from(schema.pages).where(eq(schema.pages.id, perso)).get().deletedAt, null);
});
await test("page : purge après 30 jours (pas avant) ; blocs et brouillon partent ; une page encore montrée reste", async () => {
  const id = createPage({ title: L("Éphémère"), slug: L("ephemere") }).data.id;
  assert.equal(deletePage(id).ok, true);
  await purgeTrash();
  assert.ok(db.select().from(schema.pages).where(eq(schema.pages.id, id)).get(), "29 jours : encore là");
  backdate(schema.pages, id, 29);
  await purgeTrash();
  assert.ok(db.select().from(schema.pages).where(eq(schema.pages.id, id)).get(), "29 jours : encore là");
  backdate(schema.pages, id, 31);
  const rep = await purgeTrash();
  assert.equal(rep.pages >= 1, true);
  assert.equal(db.select().from(schema.pages).where(eq(schema.pages.id, id)).get(), undefined, "purgée");
  // Page à la corbeille mais montrée par un lien ajouté depuis : la purge ne casse pas de lien.
  const kept = createPage({ title: L("Gardée"), slug: L("gardee") }).data.id;
  assert.equal(deletePage(kept).ok, true);
  const home = db.select().from(schema.pages).all().find((p) => p.slug.fr === "").id;
  db.insert(schema.blocks).values({ pageId: home, position: 99, type: "hero", props: JSON.stringify({ eyebrow: L(""), statement: L(""), reelPageId: kept }) }).run();
  backdate(schema.pages, kept, 40);
  await purgeTrash();
  assert.ok(db.select().from(schema.pages).where(eq(schema.pages.id, kept)).get(), "encore citée : reste à la corbeille");
  db.delete(schema.blocks).where(eq(schema.blocks.position, 99)).run();
  await purgeTrash();
  assert.equal(db.select().from(schema.pages).where(eq(schema.pages.id, kept)).get(), undefined, "plus citée : purgée");
});

/* ---- 3. Projets ------------------------------------------------------------------- */
await test("projet : corbeille (hors liste, non éditable), restauration, refus tant qu'un bloc le montre, purge", async () => {
  const id = createProject({ title: L("Jetable") }).data.id;
  assert.equal(listProjectsForAdmin().some((p) => p.id === id), true);
  const r = deleteProject(id);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(listProjectsForAdmin().some((p) => p.id === id), false);
  assert.equal(listTrashedProjects().some((p) => p.id === id), true);
  assert.equal(getProjectForEdit(id), null);
  assert.equal(restoreProject(id).ok, true);
  assert.equal(getProjectForEdit(id)?.title.fr, "Jetable");
  assert.equal(restoreProject(id).ok, false);
  // Cité par une planche : refus, avec la liste, connue de l'écran à l'avance.
  const slug = db.select().from(schema.projects).where(eq(schema.projects.id, id)).get().slug;
  const page = createPage({ title: L("Avec planche"), slug: L("avec-planche") }).data.id;
  assert.equal(saveDraft(page, { ...readDraft(page).draft, blocks: [{ uid: "p1", type: "project-board", props: { project: slug } }] }, readDraft(page).rev).ok, true);
  const refused = deleteProject(id);
  assert.equal(refused.ok, false);
  assert.ok(refused.references.length > 0);
  assert.ok(listProjectsForAdmin().find((p) => p.id === id).blockedBy.length > 0);
  db.update(schema.pages).set({ draft: null }).where(eq(schema.pages.id, page)).run();
  assert.equal(deleteProject(id).ok, true);
  backdate(schema.projects, id, 31);
  const rep = await purgeTrash();
  assert.equal(rep.projects >= 1, true);
  assert.equal(db.select().from(schema.projects).where(eq(schema.projects.id, id)).get(), undefined);
});

/* ---- 4. Médias -------------------------------------------------------------------- */
const addMedia = (name, sha) => {
  const key = `img/${sha}/960.webp`;
  const file = path.join(dir, "media", key);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, "x");
  const row = db
    .insert(schema.media)
    .values({ key: `originals/${sha}.png`, sha256: sha.padEnd(64, "0"), kind: "image", mime: "image/png", originalName: name, size: 1, width: 10, height: 10, variants: { v: 1, files: [{ key, format: "webp", w: 960, h: 960 }] }, status: "ready", alt: L("") })
    .returning({ id: schema.media.id })
    .get();
  return { id: row.id, key, file };
};
await test("média utilisé : suppression refusée, endroits listés (planche et bloc) ; compteur = détail", async () => {
  const used = db.select().from(schema.media).all().find((m) => getMediaUses(m.id).some((u) => u.kind === "slot"));
  const r = await deleteMedia(used.id);
  assert.equal(r.ok, false);
  assert.ok(r.references.some((x) => x.kind === "slot" && x.projectTitle), "planche nommée");
  const portrait = db.select().from(schema.media).where(eq(schema.media.originalName, "portrait.svg")).get();
  const rp = await deleteMedia(portrait.id);
  assert.equal(rp.ok, false);
  assert.ok(rp.references.some((x) => x.kind === "block" && x.pageTitle), "bloc nommé");
  assert.equal(db.select().from(schema.media).where(eq(schema.media.id, portrait.id)).get().deletedAt, null);
});
await test("compteur d'usages de la médiathèque = longueur du détail, pour chaque média", () => {
  const counts = new Map(listMediaForAdmin().map((m) => [m.id, m.uses]));
  assert.ok(counts.size > 5);
  for (const [id, n] of counts) assert.equal(getMediaUses(id).length, n, `média ${id}`);
});
await test("compteur : le brouillon d'un bloc publié est la même place (1, pas 2)", () => {
  const portrait = db.select().from(schema.media).where(eq(schema.media.originalName, "portrait.svg")).get();
  const about = db.select().from(schema.pages).all().find((p) => p.slug.fr === "a-propos");
  const before = getMediaUses(portrait.id).length;
  const blocks = db.select().from(schema.blocks).where(eq(schema.blocks.pageId, about.id)).all().map((b, i) => ({ uid: `b${i}`, type: b.type, props: JSON.parse(b.props) }));
  assert.equal(saveDraft(about.id, { ...readDraft(about.id).draft, blocks }, readDraft(about.id).rev).ok, true);
  assert.equal(getMediaUses(portrait.id).length, before, "publié + brouillon du même bloc : une place");
  assert.equal(listMediaForAdmin().find((m) => m.id === portrait.id).uses, before);
  assert.equal(mediaUsagesByMedia().get(portrait.id).length, before);
  db.update(schema.pages).set({ draft: null }).where(eq(schema.pages.id, about.id)).run();
});
await test("média libre : corbeille (plus servi, hors médiathèque), restauration, même contenu renvoyé, purge des fichiers", async () => {
  const m = addMedia("libre.png", "aa11aa11aa11aa11");
  assert.equal(findMediaByKey(m.key)?.mime, "image/webp", "servi avant");
  const r = await deleteMedia(m.id);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.data.name, "libre.png");
  assert.equal(findMediaByKey(m.key), null, "plus servi à la corbeille");
  assert.equal(listMediaForAdmin().some((x) => x.id === m.id), false);
  assert.equal(listTrashedMedia().some((x) => x.id === m.id), true);
  assert.equal(restoreMedia(m.id).ok, true);
  assert.equal(findMediaByKey(m.key)?.mime, "image/webp", "servi de nouveau");
  assert.equal(restoreMedia(m.id).ok, false);
  await deleteMedia(m.id);
  reviveIfTrashed(db.select().from(schema.media).where(eq(schema.media.id, m.id)).get());
  assert.equal(db.select().from(schema.media).where(eq(schema.media.id, m.id)).get().deletedAt, null, "renvoyé : ressorti");
  await deleteMedia(m.id);
  assert.ok(existsSync(m.file));
  backdate(schema.media, m.id, 31);
  const rep = await purgeTrash();
  assert.equal(rep.media >= 1, true);
  assert.equal(db.select().from(schema.media).where(eq(schema.media.id, m.id)).get(), undefined);
  assert.equal(existsSync(m.file), false, "fichiers effacés");
});
await test("un média en traitement ne se supprime pas ; une planche d'un projet à la corbeille garde son média « utilisé »", async () => {
  const m = addMedia("encours.png", "bb22bb22bb22bb22");
  db.update(schema.media).set({ status: "processing" }).where(eq(schema.media.id, m.id)).run();
  assert.equal((await deleteMedia(m.id)).ok, false);
  const free = addMedia("planche.png", "cc33cc33cc33cc33");
  const project = createProject({ title: L("Porteur") }).data.id;
  db.insert(schema.slots).values({ projectId: project, position: 0, mediaId: free.id, slug: "porteur-1", collection: "characters", title: L(""), description: L(""), year: 2026 }).run();
  assert.equal(deleteProject(project).ok, true);
  const r = await deleteMedia(free.id);
  assert.equal(r.ok, false, "toujours utilisé par la planche du projet à la corbeille");
  const use = getMediaUses(free.id)[0];
  assert.equal(use.kind === "slot" && use.trashed, true, "signalé « projet à la corbeille »");
  backdate(schema.projects, project, 31);
  await purgeTrash();
  assert.equal((await deleteMedia(free.id)).ok, true, "projet purgé : le média est libre");
});

console.log(`\ntest-trash : ${passed} tests OK`);
