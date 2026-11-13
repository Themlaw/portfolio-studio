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
 *  6. N11 (docs/SECURITE.md) : restaurer ou remettre en ligne une page rejoue les contrôles de publication (formulaire
 *     dont l'identifiant est déjà publié ailleurs → restaurée HORS LIGNE, remise en ligne refusée) ; copie d'un formulaire
 *     désactivé = nouvel identifiant ; deux formulaires publiés au même identifiant → envoi refusé (409) et journalisé.
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
const { createPage, deletePage, restorePage, savePage, setPublished } = await import("../src/lib/edit/pages.ts");
const { withFreshUids } = await import("../src/blocks/tree.ts");
const { defaultContactForm } = await import("../src/lib/contact-form.ts");
const { POST: CONTACT_POST } = await import("../src/app/api/contact/route.ts");
const { createProject, deleteProject, restoreProject } = await import("../src/lib/edit/projects.ts");
const { deleteMedia, restoreMedia } = await import("../src/lib/edit/media.ts");
const { purgeTrash, purgeOne, emptyTrash } = await import("../src/lib/edit/trash.ts");
const { reviveIfTrashed } = await import("../src/lib/upload/revive.ts");
const { saveDraft, readDraft } = await import("../src/lib/edit/drafts.ts");
const { publishedSlugExists } = await import("../src/lib/pages-index.ts");
const { findMediaByKey } = await import("../src/lib/media.ts");
const { getTrashSummary, listPagesForAdmin, listTrashedPages, listProjectsForAdmin, listTrashedProjects, listMediaForAdmin, listTrashedMedia, getMediaUses, getPageForEdit, getProjectForEdit } = await import("../src/lib/admin.ts");
const { mediaUsagesByMedia } = await import("../src/lib/references.ts");
const { readNav } = await import("../src/lib/edit/nav.ts");
const { daysLeft, purgeAt, TRASH_DAYS, lostWithPage, lostWithProject, emptyTrashParts, willBeDeleted, restoredMessage } = await import("../src/lib/trash.ts");
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

/* ---- 5. Supprimer définitivement, vider la corbeille --------------------------------- */
await test("définitif : refusé hors corbeille ; média bloqué → projet supprimé définitivement → média supprimable", async () => {
  const free = addMedia("bloque.png", "dd44dd44dd44dd44");
  const project = createProject({ title: L("Bloqueur") }).data.id;
  db.insert(schema.slots).values({ projectId: project, position: 0, mediaId: free.id, slug: "bloqueur-1", collection: "characters", title: L(""), description: L(""), year: 2026 }).run();
  assert.equal((await purgeOne("project", project)).ok, false, "pas à la corbeille : refusé");
  assert.equal((await purgeOne("media", free.id)).ok, false);
  assert.equal(db.select().from(schema.projects).where(eq(schema.projects.id, project)).get() !== undefined, true);
  assert.equal(deleteProject(project).ok, true);
  assert.equal((await deleteMedia(free.id)).ok, false, "bloqué par le projet de la corbeille");
  const r = await purgeOne("project", project);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(db.select().from(schema.projects).where(eq(schema.projects.id, project)).get(), undefined, "projet effacé tout de suite (pas 30 jours)");
  assert.equal((await deleteMedia(free.id)).ok, true, "média de nouveau supprimable");
  assert.equal((await purgeOne("media", free.id)).ok, true);
  assert.equal(existsSync(free.file), false, "fichiers effacés");
  assert.equal((await purgeOne("media", free.id)).ok, false, "déjà parti");
  assert.equal((await purgeOne("page", 999999)).ok, false);
});
await test("définitif : une page encore citée reste ; « vider » supprime tout dans l'ordre, résumé exact", async () => {
  const kept = createPage({ title: L("Citée"), slug: L("citee") }).data.id;
  assert.equal(deletePage(kept).ok, true);
  const home = db.select().from(schema.pages).all().find((p) => p.slug.fr === "").id;
  db.insert(schema.blocks).values({ pageId: home, position: 98, type: "hero", props: JSON.stringify({ eyebrow: L(""), statement: L(""), reelPageId: kept }) }).run();
  assert.equal((await purgeOne("page", kept)).ok, false, "citée : refusée");
  const pg = createPage({ title: L("Vidable"), slug: L("vidable") }).data.id;
  deletePage(pg);
  const free = addMedia("vidable.png", "ee55ee55ee55ee55");
  const pr = createProject({ title: L("Vidable P") }).data.id;
  db.insert(schema.slots).values({ projectId: pr, position: 0, mediaId: free.id, slug: "vidable-1", collection: "characters", title: L(""), description: L(""), year: 2026 }).run();
  deleteProject(pr);
  const sum = getTrashSummary();
  assert.equal(sum.projects, 1);
  assert.equal(sum.slots, 1);
  assert.ok(sum.pages >= 2 && sum.total === sum.pages + sum.projects + sum.media);
  const rep = await emptyTrash();
  assert.equal(rep.projects, 1);
  assert.equal(db.select().from(schema.pages).where(eq(schema.pages.id, pg)).get(), undefined);
  assert.ok(db.select().from(schema.pages).where(eq(schema.pages.id, kept)).get(), "page citée gardée");
  assert.equal(rep.kept, 1, "une seule gardée");
  db.delete(schema.blocks).where(eq(schema.blocks.position, 98)).run();
  assert.equal((await emptyTrash()).kept, 0, "libérée : tout part");
  assert.equal(getTrashSummary().total, 0);
});

/* ---- 6. Références du lot 26 : logo du site et couverture d'une tuile (intégration v0.20) --------------------- */
await test("logo du site et couverture d'une tuile comptés comme usages : compteur, détail, suppression et purge refusées", async () => {
  const home = db.select().from(schema.pages).all().find((p) => p.slug.fr === "").id;
  const setStyles = (v) => db.insert(schema.settings).values({ key: "styles", value: JSON.stringify(v) }).onConflictDoUpdate({ target: schema.settings.key, set: { value: JSON.stringify(v) } }).run();
  const before = db.select().from(schema.settings).where(eq(schema.settings.key, "styles")).get()?.value;
  // Logo publié.
  const logo = addMedia("logo.png", "1090109010901090");
  setStyles({ logo: { mediaId: logo.id } });
  assert.equal(mediaUsagesByMedia().get(logo.id)?.length, 1, "le logo compte (compteur de la médiathèque)");
  assert.deepEqual(getMediaUses(logo.id).map((u) => [u.kind, u.blockType, u.pageId]), [["block", "Logo du site", home]]);
  const refused = await deleteMedia(logo.id);
  assert.equal(refused.ok, false);
  assert.equal(refused.references.length, 1);
  assert.equal(db.select().from(schema.media).where(eq(schema.media.id, logo.id)).get().deletedAt, null, "pas à la corbeille");
  // Logo seulement dans le brouillon du site, tenu par une page.
  setStyles({});
  db.insert(schema.settings).values({ key: "siteDraft", value: JSON.stringify({ pageId: home, snap: { styles: { logo: { mediaId: logo.id } } } }) }).run();
  assert.equal(mediaUsagesByMedia().get(logo.id)?.length, 1, "le brouillon du site compte aussi");
  assert.equal((await deleteMedia(logo.id)).ok, false);
  db.delete(schema.settings).where(eq(schema.settings.key, "siteDraft")).run();
  // Couverture choisie sur une tuile de collection (items[].mediaId, manuel).
  const cover = addMedia("couv.png", "1090109010902090");
  db.insert(schema.blocks).values({ pageId: home, position: 97, type: "collection-tiles", props: JSON.stringify({ items: [{ pageId: home, mediaId: cover.id }] }) }).run();
  assert.equal(mediaUsagesByMedia().get(cover.id)?.length, 1, "couverture de tuile comptée (une fois par page et par type)");
  assert.equal((await deleteMedia(cover.id)).ok, false);
  db.delete(schema.blocks).where(eq(schema.blocks.position, 97)).run();
  // Libres : corbeille possible, mais le logo ne peut plus choisir une image à la corbeille.
  assert.equal((await deleteMedia(cover.id)).ok, true);
  assert.equal(mediaUsagesByMedia().get(cover.id), undefined);
  if (before === undefined) db.delete(schema.settings).where(eq(schema.settings.key, "styles")).run();
  else setStyles(JSON.parse(before));
});

/* ---- 7. Phrases des confirmations : accords et zéro ------------------------------------------------------------ */
await test("confirmations de suppression définitive : zéro, un, plusieurs ; pas de « brouillon » s'il n'y en a pas", () => {
  assert.equal(lostWithPage(0, false), "elle est vide : rien d'autre ne disparaît.");
  assert.equal(lostWithPage(0, true), "son brouillon disparaît.");
  assert.equal(lostWithPage(1, false), "son bloc disparaît.");
  assert.equal(lostWithPage(1, true), "son bloc et son brouillon disparaissent.");
  assert.equal(lostWithPage(3, false), "ses 3 blocs disparaissent.");
  assert.equal(lostWithPage(3, true), "ses 3 blocs et son brouillon disparaissent.");
  assert.match(lostWithProject(0), /^sa mise en page \(sans emplacement\) disparaît/);
  assert.match(lostWithProject(1), /^sa mise en page et son emplacement disparaissent/);
  assert.match(lostWithProject(4), /^sa mise en page et ses 4 emplacements disparaissent/);
  assert.deepEqual(emptyTrashParts({ pages: 1, projects: 0, media: 2, slots: 0 }), ["1 page", "2 médias"]);
  assert.deepEqual(emptyTrashParts({ pages: 2, projects: 1, media: 0, slots: 1 }), ["2 pages", "1 projet (avec 1 emplacement)"]);
  assert.deepEqual(emptyTrashParts({ pages: 0, projects: 2, media: 0, slots: 0 }), ["2 projets (sans emplacement)"]);
  assert.equal(willBeDeleted(1), "1 élément sera supprimé");
  assert.equal(willBeDeleted(3), "3 éléments seront supprimés");
});

/* ---- 8. Audit v0.20 (Mo1) : une page à la corbeille n'est pas une entrée de collection ------------------------------ */
const { getEditorContext } = await import("../src/lib/admin.ts");
await test("Mo1 : une page de collection mise à la corbeille n'est plus proposée aux tuiles (collectionPages)", () => {
  const seeded = db.select().from(schema.pages).where(eq(schema.pages.collection, "animation")).get();
  if (seeded) db.update(schema.pages).set({ collection: null }).where(eq(schema.pages.id, seeded.id)).run();
  const id = createPage({ title: L("Collection Mo1"), slug: L("collection-mo1") }).data.id;
  db.update(schema.pages).set({ published: true, collection: "animation" }).where(eq(schema.pages.id, id)).run();
  assert.ok(getEditorContext().collectionPages.some((p) => p.pageId === id || p.id === id), "présente avant");
  assert.equal(deletePage(id).ok, true);
  assert.ok(!getEditorContext().collectionPages.some((p) => p.pageId === id || p.id === id), "absente à la corbeille");
  restorePage(id);
  db.update(schema.pages).set({ collection: null }).where(eq(schema.pages.id, id)).run();
  if (seeded) db.update(schema.pages).set({ collection: "animation" }).where(eq(schema.pages.id, seeded.id)).run();
});

/* ---- 9. Audit v0.20 (Mo2, m6) : collection d'une page à la corbeille, adresse de restauration ------------------------ */
await test("Mo2 : une page à la corbeille ne retient plus sa collection ; restaurée après reprise, elle la perd (et le dit)", () => {
  const seeded = db.select().from(schema.pages).where(eq(schema.pages.collection, "backgrounds")).get();
  if (seeded) db.update(schema.pages).set({ collection: null }).where(eq(schema.pages.id, seeded.id)).run();
  const meta = { title: L(""), description: L("") };
  const a = createPage({ title: L("Décors A"), slug: L("decors-a") }).data.id;
  const b = createPage({ title: L("Décors B"), slug: L("decors-b") }).data.id;
  const input = (title, slug, collection) => ({ title: L(title), slug: L(slug), meta, published: false, inMenu: false, accent: null, collection, blocks: [] });
  assert.equal(savePage(a, input("Décors A", "decors-a", "backgrounds")).ok, true);
  assert.equal(deletePage(a).ok, true);
  assert.equal(db.select().from(schema.pages).where(eq(schema.pages.id, a)).get().collection, "backgrounds", "la page garde sa collection à la corbeille");
  const saved = savePage(b, input("Décors B", "decors-b", "backgrounds"));
  assert.equal(saved.ok, true, JSON.stringify(saved));
  const r = restorePage(a);
  assert.equal(r.ok, true);
  assert.equal(r.data.collectionDropped, true);
  assert.equal(db.select().from(schema.pages).where(eq(schema.pages.id, a)).get().collection, null);
  assert.equal(db.select().from(schema.pages).where(eq(schema.pages.id, b)).get().collection, "backgrounds");
  assert.match(restoredMessage("Décors A", r.data), /restaurée · sa collection est maintenant celle d'une autre page/);
  // Collection libre : conservée à la restauration.
  assert.equal(deletePage(b).ok, true);
  const r2 = restorePage(b);
  assert.equal(r2.data.collectionDropped, false);
  assert.equal(db.select().from(schema.pages).where(eq(schema.pages.id, b)).get().collection, "backgrounds");
  db.update(schema.pages).set({ collection: null }).where(eq(schema.pages.id, b)).run();
  if (seeded) db.update(schema.pages).set({ collection: "backgrounds" }).where(eq(schema.pages.id, seeded.id)).run();
});
await test("m6 : restauration — variante d'adresse par langue, valide et libre", () => {
  const p = createPage({ title: L("Carte"), slug: { fr: "carte-m6", en: "map-m6" } }).data.id;
  assert.equal(deletePage(p).ok, true);
  createPage({ title: L("Autre"), slug: { fr: "carte-m6", en: "autre-m6" } });
  const r = restorePage(p);
  assert.equal(r.ok, true);
  assert.equal(r.data.slugChanged, true);
  assert.deepEqual(slugOf(p), { fr: "carte-m6-2", en: "map-m6" }, "seule la langue prise change");
});

/* ---- 10. Audit v0.20 (m3) : Ouverture unique aussi côté serveur ------------------------------------------------------ */
await test("m3 : deux Ouvertures sur une page → enregistrement refusé, l'exemplaire en trop nommé", () => {
  const id = createPage({ title: L("Deux ouvertures"), slug: L("deux-ouvertures") }).data.id;
  const hero = (uid) => ({ uid, type: "hero", props: { eyebrow: L(""), statement: L("Accroche") } });
  const r = savePage(id, { title: L("Deux ouvertures"), slug: L("deux-ouvertures"), meta: { title: L(""), description: L("") }, published: false, inMenu: false, accent: null, blocks: [hero("h1"), hero("h2")] });
  assert.equal(r.ok, false);
  assert.match(r.fieldErrors?.["blocks.1"] ?? "", /ne se pose qu'une fois par page/);
  assert.equal(r.fieldErrors?.["blocks.0"], undefined, "la première reste valable");
});

/* ---- 11. Audit v0.20 (m4) : fichier redemandé pendant la purge ----------------------------------------------------- */
await test("m4 : un fichier réutilisé par une ligne média apparue pendant la purge n'est pas supprimé", async () => {
  const { getStorage } = await import("../src/lib/storage/index.ts");
  const m = addMedia("course.png", "4444aaaa4444aaaa");
  db.update(schema.media).set({ deletedAt: new Date(Date.now() - 40 * DAY) }).where(eq(schema.media.id, m.id)).run();
  const storage = getStorage();
  const realDelete = storage.delete.bind(storage);
  let calls = 0;
  storage.delete = async (key) => {
    calls++;
    if (calls === 1) {
      // Entre deux suppressions : le même contenu est renvoyé (autre original, mêmes variantes).
      db.insert(schema.media).values({ key: "originals/autre-m4.png", sha256: "4444aaaa4444aaaa".padEnd(64, "0"), kind: "image", mime: "image/png", originalName: "revenu.png", size: 1, width: 10, height: 10, variants: { v: 1, files: [{ key: m.key, format: "webp", w: 960, h: 960 }] }, status: "ready", alt: L("") }).run();
    }
    return realDelete(key);
  };
  try {
    assert.equal(await purgeOne("media", m.id).then((r) => r.ok), true);
  } finally {
    storage.delete = realDelete;
  }
  assert.ok(existsSync(m.file), "la variante, redevenue utilisée, est restée sur le disque");
});

/* ---- 12. Audit v0.20 (m5) : la page qui cite est à la corbeille ----------------------------------------------------- */
await test("m5 : refus de supprimer une page citée par une page à la corbeille — la référence est marquée « trashed »", () => {
  const a = createPage({ title: L("Citée m5"), slug: L("citee-m5") }).data.id;
  const b = createPage({ title: L("Citante m5"), slug: L("citante-m5") }).data.id;
  db.insert(schema.blocks).values({ pageId: b, position: 0, type: "page-link", props: JSON.stringify({ pageId: a, label: L("Voir") }) }).run();
  assert.equal(deletePage(b).ok, true, "la citante part d'abord à la corbeille");
  const r = deletePage(a);
  assert.equal(r.ok, false);
  assert.deepEqual(r.references.map((x) => [x.pageId, x.trashed]), [[b, true]]);
  db.delete(schema.blocks).where(eq(schema.blocks.pageId, b)).run();
});

/* ---- 6. N11 : restauration et remise en ligne rejouent les contrôles de publication ---------------------------------- */
{
  const meta = { title: L(""), description: L("") };
  const formBlock = (uid, formId, form = true) => ({ uid, type: "contact", props: { ...defaultContactForm(), form, formId } });
  const input = (title, slug, blocks, published = true) => ({ title: L(title), slug: L(slug), meta, published, inMenu: false, accent: null, blocks });
  const isPublished = (id) => db.select().from(schema.pages).where(eq(schema.pages.id, id)).get().published;
  const a = createPage({ title: L("Contact N11 A"), slug: L("contact-n11-a") }).data.id;
  const b = createPage({ title: L("Contact N11 B"), slug: L("contact-n11-b") }).data.id;

  await test("N11 restaurer : formulaire dont l'identifiant a été publié ailleurs entre-temps → page restaurée HORS LIGNE (raison donnée)", () => {
    assert.equal(savePage(a, input("Contact N11 A", "contact-n11-a", [formBlock("fa", "fn11dup01")])).ok, true);
    assert.equal(deletePage(a).ok, true);
    // Pendant que A est à la corbeille, B publie un formulaire au même identifiant (A ne compte plus : accepté).
    const saved = savePage(b, input("Contact N11 B", "contact-n11-b", [formBlock("fb", "fn11dup01")]));
    assert.equal(saved.ok, true, JSON.stringify(saved));
    const r = restorePage(a);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.match(r.data.unpublished ?? "", /autre page/);
    assert.equal(isPublished(a), false, "revient hors ligne");
    assert.equal(isPublished(b), true, "l'autre page n'est pas touchée");
    assert.match(restoredMessage("Contact N11 A", r.data), /restaurée · elle revient hors ligne : .*autre page/);
  });
  await test("N11 remettre en ligne (liste des pages) : refusé tant que l'identifiant est publié ailleurs ; accepté ensuite", () => {
    const r = setPublished(a, true);
    assert.equal(r.ok, false);
    assert.match(r.message, /Publication impossible : .*autre page/);
    assert.equal(isPublished(a), false);
    assert.equal(setPublished(b, false).ok, true, "dépublier n'est jamais refusé");
    assert.equal(setPublished(a, true).ok, true, "l'autre page hors ligne : plus de doublon");
    assert.equal(setPublished(b, true).ok, false, "et c'est maintenant B qui ne peut plus revenir en ligne");
  });
  await test("N11 restaurer une page sans conflit : elle reste en ligne (« Annuler » d'une suppression)", () => {
    const c = createPage({ title: L("Contact N11 C"), slug: L("contact-n11-c") }).data.id;
    assert.equal(savePage(c, input("Contact N11 C", "contact-n11-c", [formBlock("fc", "fn11solo01")])).ok, true);
    assert.equal(deletePage(c).ok, true);
    const r = restorePage(c);
    assert.equal(r.ok, true);
    assert.equal(r.data.unpublished, undefined);
    assert.equal(isPublished(c), true);
    assert.equal(deletePage(c).ok, true);
  });
  await test("N11 copie d'un formulaire DÉSACTIVÉ (identifiant gardé) : la copie reçoit un nouvel identifiant", () => {
    let n = 0;
    const off = withFreshUids(formBlock("x", "fn11off001", false), () => `u${++n}`);
    assert.notEqual(off.props.formId, "fn11off001");
    assert.match(off.props.formId, /^[a-z0-9]{6,32}$/);
    const on = withFreshUids(formBlock("y", "fn11on0001", true), () => `u${++n}`);
    assert.notEqual(on.props.formId, "fn11on0001");
    const plain = withFreshUids({ uid: "z", type: "contact", props: { email: "a@b.fr" } }, () => `u${++n}`);
    assert.equal(plain.props.formId, undefined, "un Contact sans formulaire ni identifiant n'en reçoit pas");
  });
  await test("N11 deux formulaires publiés au même identifiant (base écrite à la main) : envoi refusé (409) et journalisé", async () => {
    const props = JSON.stringify({ ...defaultContactForm(), form: true, formId: "fn11twice1" });
    for (const id of [a, b]) db.insert(schema.blocks).values({ pageId: id, position: 50, type: "contact", props }).run();
    db.update(schema.pages).set({ published: true }).where(eq(schema.pages.id, b)).run();
    const errors = [];
    const error = console.error;
    console.error = (...x) => errors.push(x.join(" "));
    const res = await CONTACT_POST(new Request("http://localhost/api/contact", { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: JSON.stringify({ form: "fn11twice1", locale: "fr", values: { femail: "a@b.fr", fmessage: "x" } }) }));
    console.error = error;
    assert.equal(res.status, 409);
    assert.ok(errors.some((e) => /\[contact\] formulaire fn11twice1 publié 2 fois/.test(e)), errors.join(" | "));
    assert.equal(db.select().from(schema.messages).all().length, 0, "rien n'est rangé");
    db.delete(schema.blocks).where(eq(schema.blocks.position, 50)).run();
  });
}

console.log(`\ntest-trash : ${passed} tests OK`);
