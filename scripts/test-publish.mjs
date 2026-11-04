#!/usr/bin/env node
/**
 * v0.13 — publication, menu et formulaire sur une VRAIE base (seed, dans un
 * dossier temporaire), sans serveur (inclus dans npm test, léger) :
 *  1. Correction I1 : la surcouche d'une planche qui n'est plus sur la page
 *     (bloc retiré, conteneur supprimé) n'est JAMAIS appliquée ; celle d'une
 *     planche imbriquée présente l'est. (Tue le mutant « applySlotDrafts sans
 *     l'ensemble des projets affichés ».)
 *  2. Menu et brouillon de l'en-tête : changements faits ailleurs (liste des
 *     pages, ordre, page supprimée, case « dans le menu ») jamais défaits par
 *     la publication de l'en-tête ; jamais de blocage de l'éditeur.
 *  3. POST /api/contact : IP calculée derrière les proxys de confiance (XFF
 *     inventé ignoré), corps lu en flux et coupé (RSS stable), formulaire
 *     désigné par un identifiant stable entre deux publications ; jeton signé,
 *     délai minimal, plafond par préfixe /24 /64, empreinte HMAC, valeurs nettoyées,
 *     ménage après les limites (docs/SECURITE.md §2.3, §2.12).
 * Usage : node --import tsx scripts/test-publish.mjs
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "pf-test-publish-"));
process.env.DATA_DIR = dir;
process.env.AUTH_TRUSTED_PROXY_HOPS = "1";
const log = console.log;
console.log = () => {}; // journaux du démarrage
const { bootstrap } = await import("../src/lib/db/bootstrap.ts");
await bootstrap();
console.log = log;
const { getDb, schema } = await import("../src/lib/db/index.ts");
const { eq } = await import("drizzle-orm");
const { readDraft, saveDraft, publishDraft, discardDraft } = await import("../src/lib/edit/drafts.ts");
const { createPage, deletePage, setInMenu, reorderMenu } = await import("../src/lib/edit/pages.ts");
const { saveSiteDraft, discardSiteDraft, readPublishedSite, readSiteDraft, siteForEditor } = await import("../src/lib/edit/site.ts");
const { readSiteRev } = await import("../src/lib/edit/site-rev.ts");
const { boardOp, restoreBoard, readBoard } = await import("../src/lib/edit/boards.ts");
const { saveProject } = await import("../src/lib/edit/projects.ts");
const { POST } = await import("../src/app/api/contact/route.ts");
const { withFreshUids } = await import("../src/blocks/tree.ts");
const { defaultContactForm } = await import("../src/lib/contact-form.ts");
const { issueContactToken, resetContactGuard, ipPrefix, MIN_DELAY_MS } = await import("../src/lib/contact-guard.ts");
const { GET: GET_TOKEN } = await import("../src/app/api/contact/token/route.ts");

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
const k = (uid, type, props = {}) => ({ uid, type, props });
const newPage = (slug) => createPage({ title: L(slug), slug: L(slug) }).data.id;
const slotsOf = (pid) => db.select().from(schema.slots).where(eq(schema.slots.projectId, pid)).all().map((s) => [s.id, s.mediaId, s.position]);
const navIds = () => readPublishedSite().nav.flatMap((i) => (i.kind === "page" ? [i.pageId] : []));
const [P, Q] = db.select().from(schema.projects).all();

/* ---- 1. Correction I1 --------------------------------------------------------- */

await test("I1 : planche retirée (bloc supprimé) → surcouche jamais appliquée, images en ligne intactes", () => {
  const page = newPage("t-i1a");
  const before = JSON.stringify(slotsOf(Q.id));
  assert.equal(saveDraft(page, { ...base(page), blocks: [k("b", "project-board", { project: Q.slug })] }, rev(page)).ok, true);
  const first = db.select().from(schema.slots).where(eq(schema.slots.projectId, Q.id)).all()[0];
  assert.equal(boardOp(page, Q.id, { op: "retire", key: `s${first.id}` }, rev(page)).ok, true);
  assert.equal(saveDraft(page, { ...base(page), blocks: [] }, rev(page)).ok, true);
  assert.equal(publishDraft(page, rev(page)).ok, true);
  assert.equal(JSON.stringify(slotsOf(Q.id)), before);
  assert.equal(db.select().from(schema.slots).where(eq(schema.slots.draftPageId, page)).all().length, 0, "surcouche effacée");
});
await test("I1 : grille supprimée (planche imbriquée à projet en dur) → rien d'appliqué", () => {
  const page = newPage("t-i1b");
  const before = JSON.stringify(slotsOf(P.id));
  saveDraft(page, { ...base(page), blocks: [k("g", "grid", { children: [k("b", "project-board", { project: P.slug })] })] }, rev(page));
  const first = db.select().from(schema.slots).where(eq(schema.slots.projectId, P.id)).all()[0];
  assert.equal(boardOp(page, P.id, { op: "retire", key: `s${first.id}` }, rev(page)).ok, true, "planche imbriquée modifiable depuis la toile");
  // Un Titre lié cite le projet mais n'en montre plus la planche : pas affiché.
  saveDraft(page, { ...base(page), blocks: [k("t", "section-title", { linked: true, project: P.slug })] }, rev(page));
  assert.equal(publishDraft(page, rev(page)).ok, true);
  assert.equal(JSON.stringify(slotsOf(P.id)), before);
});
await test("I1 : planche imbriquée présente → sa surcouche est appliquée", () => {
  const page = newPage("t-i1c");
  const count = slotsOf(P.id).length;
  saveDraft(page, { ...base(page), blocks: [k("g", "grid", { children: [k("b", "project-board", { project: P.slug })] })] }, rev(page));
  const first = db.select().from(schema.slots).where(eq(schema.slots.projectId, P.id)).all()[0];
  boardOp(page, P.id, { op: "retire", key: `s${first.id}` }, rev(page));
  assert.equal(publishDraft(page, rev(page)).ok, true);
  assert.equal(slotsOf(P.id).length, count - 1);
});
await test("I1 : clé inconnue dans les props (non publiée) n'ouvre pas l'application d'une surcouche", () => {
  const page = newPage("t-i1d");
  const before = JSON.stringify(slotsOf(Q.id));
  saveDraft(page, { ...base(page), blocks: [k("b", "project-board", { project: Q.slug })] }, rev(page));
  const first = db.select().from(schema.slots).where(eq(schema.slots.projectId, Q.id)).all()[0];
  boardOp(page, Q.id, { op: "retire", key: `s${first.id}` }, rev(page));
  // Une clé `children` glissée dans un bloc simple : refusée par la forme ; une clé
  // inconnue d'un Titre (« project ») est retirée par le schéma et ne compte pas.
  saveDraft(page, { ...base(page), blocks: [k("t", "section-title", { project: Q.slug })] }, rev(page));
  assert.equal(publishDraft(page, rev(page)).ok, true);
  assert.equal(JSON.stringify(slotsOf(Q.id)), before);
});

await test("v0.19 : « Projet mis en avant » refusé à la création, toléré sur une page qui en a déjà un (publié)", () => {
  const fresh = newPage("t-v19a");
  const container = [k("c", "featured-project", { project: P.slug, children: [k("t", "section-title", { linked: true })] })];
  const refused = saveDraft(fresh, { ...base(fresh), blocks: container }, rev(fresh));
  assert.equal(refused.ok, false, JSON.stringify(refused));
  assert.match(JSON.stringify(refused), /n'existe plus/);
  const old = newPage("t-v19b");
  db.insert(schema.blocks).values({ pageId: old, position: 0, type: "featured-project", props: JSON.stringify({ project: P.slug, children: [] }) }).run();
  assert.equal(saveDraft(old, { ...base(old), blocks: container }, rev(old)).ok, true, "page qui en avait déjà un : brouillon enregistrable");
  assert.equal(publishDraft(old, rev(old)).ok, true, "… et republiable");
});
await test("v0.19 : Titre lié sans projet refusé à la publication ; avec projet, accepté et projet cité", () => {
  const page = newPage("t-v19c");
  saveDraft(page, { ...base(page), blocks: [k("t", "section-title", { linked: true })] }, rev(page));
  const refused = publishDraft(page, rev(page));
  assert.equal(refused.ok, false);
  assert.match(JSON.stringify(refused), /Choisis le projet/);
  saveDraft(page, { ...base(page), blocks: [k("t", "section-title", { linked: true, project: P.slug })] }, rev(page));
  assert.equal(publishDraft(page, rev(page)).ok, true);
  const row = db.select().from(schema.blocks).where(eq(schema.blocks.pageId, page)).all()[0];
  assert.equal(JSON.parse(row.props).project, P.slug);
  saveDraft(page, { ...base(page), blocks: [k("t", "section-title", { linked: true, project: "projet-qui-n-existe-pas" })] }, rev(page));
  assert.equal(publishDraft(page, rev(page)).ok, false, "projet cité inexistant : refusé");
});
await test("v0.19 : « Lien vers une page » : page exigée à la publication, page supprimée refusée", () => {
  const page = newPage("t-v19d");
  saveDraft(page, { ...base(page), blocks: [k("l", "page-link", { label: L("Voir") })] }, rev(page));
  assert.equal(publishDraft(page, rev(page)).ok, false);
  const target = newPage("t-v19e");
  saveDraft(page, { ...base(page), blocks: [k("l", "page-link", { label: L("Voir"), pageId: target })] }, rev(page));
  assert.equal(publishDraft(page, rev(page)).ok, true);
  assert.equal(deletePage(target).ok, false, "page citée par un lien : suppression refusée");
});

/* ---- 1b. Textes d'un projet depuis un bloc qui le montre (v0.15) ------------------ */

const text = (id) => db.select().from(schema.projects).where(eq(schema.projects.id, id)).get();
const projectOp = (page, id, field, value, locale = "fr") => boardOp(page, id, { op: "project", field, locale, value }, rev(page));
// v0.19 : le Titre lié porte lui-même son projet (plus de conteneur « Projet mis en avant »).
const featuredTitle = (project) => [k("t", "section-title", { linked: true, project })];

await test("T1 : titre modifié depuis un Titre lié (sans planche) → surcouche ; public inchangé jusqu'à la publication", () => {
  const page = newPage("t-txt1");
  const published = text(P.id).title.fr;
  saveDraft(page, { ...base(page), blocks: featuredTitle(P.slug) }, rev(page));
  const r = projectOp(page, P.id, "title", "Titre depuis l'accueil");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(text(P.id).title.fr, published, "la ligne publiée n'a pas bougé");
  assert.equal(text(P.id).draftTextPageId, page);
  assert.equal(readBoard(page, P.id).project.title.fr, "Titre depuis l'accueil", "la vue de la page montre sa surcouche");
  assert.equal(slotsOf(P.id).length > 0 && db.select().from(schema.slots).where(eq(schema.slots.draftPageId, page)).all().length, 0, "un texte seul ne prend pas les emplacements");
  const description = projectOp(page, P.id, "description", "Présentation éditée");
  assert.equal(description.ok, true);
  assert.equal(publishDraft(page, rev(page)).ok, true);
  const after = text(P.id);
  assert.equal(after.title.fr, "Titre depuis l'accueil");
  assert.equal(after.description.fr, "Présentation éditée");
  assert.equal(after.title.en, text(P.id).title.en);
  assert.equal(after.draftText, null);
  assert.equal(after.draftTextPageId, null);
});
await test("T2 : une autre page ne peut pas modifier les textes tenus ailleurs (la page est nommée) ; libre après abandon", () => {
  const a = newPage("t-txt2a");
  const b = newPage("t-txt2b");
  saveDraft(a, { ...base(a), blocks: featuredTitle(P.slug) }, rev(a));
  saveDraft(b, { ...base(b), blocks: featuredTitle(P.slug) }, rev(b));
  assert.equal(projectOp(a, P.id, "year", "1999").ok, true);
  const refused = projectOp(b, P.id, "year", "2001");
  assert.equal(refused.ok, false);
  assert.match(refused.message, /en cours de modification sur la page t-txt2a/);
  assert.equal(readBoard(b, P.id).project.year, text(P.id).year, "la page B voit les textes publiés");
  assert.equal(discardDraft(a, rev(a)).ok, true);
  assert.equal(text(P.id).draftTextPageId, null);
  assert.equal(projectOp(b, P.id, "year", "2001").ok, true);
  assert.equal(discardDraft(b, rev(b)).ok, true);
  assert.notEqual(text(P.id).year, "2001");
});
await test("T3 : écran Projets refusé tant qu'une page tient les textes ; page non citée refusée ; version périmée = conflit", () => {
  const page = newPage("t-txt3");
  const other = newPage("t-txt3b");
  saveDraft(page, { ...base(page), blocks: featuredTitle(P.slug) }, rev(page));
  assert.equal(projectOp(other, P.id, "title", "x").ok, false, "page qui ne cite pas le projet");
  const stale = rev(page);
  assert.equal(projectOp(page, P.id, "context", "Contexte").ok, true);
  const conflict = boardOp(page, P.id, { op: "project", field: "context", locale: "fr", value: "Autre" }, stale);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, "conflict");
  const meta = text(P.id);
  const admin = saveProject(P.id, { title: meta.title, context: meta.context, description: meta.description, year: meta.year, featured: meta.featured });
  assert.equal(admin.ok, true, "seuls les champs non textuels sont enregistrés (T9)");
  assert.match(admin.data.textsHeld, /en cours de modification sur la page « t-txt3 »/);
  assert.equal(discardDraft(page, rev(page)).ok, true);
  assert.equal(saveProject(P.id, { title: meta.title, context: meta.context, description: meta.description, year: meta.year, featured: meta.featured }).ok, true);
});
await test("T4 : Annuler (restoreBoard) revient aux textes publiés et efface la surcouche ; Rétablir la remet", () => {
  const page = newPage("t-txt4");
  saveDraft(page, { ...base(page), blocks: featuredTitle(P.slug) }, rev(page));
  const r = projectOp(page, P.id, "title", "Éphémère");
  assert.equal(r.ok, true);
  const undone = restoreBoard(page, r.data.before, rev(page));
  assert.equal(undone.ok, true, JSON.stringify(undone));
  assert.equal(text(P.id).draftTextPageId, null, "revenu aux textes publiés : plus de surcouche");
  const redone = restoreBoard(page, r.data.after, rev(page));
  assert.equal(redone.ok, true);
  assert.equal(text(P.id).draftText.title.fr, "Éphémère");
  assert.equal(discardDraft(page, rev(page)).ok, true);
});
await test("T5 : la page publiée ne cite plus le projet → surcouche effacée, jamais appliquée", () => {
  const page = newPage("t-txt5");
  const published = text(P.id).title.fr;
  saveDraft(page, { ...base(page), blocks: featuredTitle(P.slug) }, rev(page));
  assert.equal(projectOp(page, P.id, "title", "Ne doit pas partir").ok, true);
  saveDraft(page, { ...base(page), blocks: [] }, rev(page));
  assert.equal(publishDraft(page, rev(page)).ok, true);
  assert.equal(text(P.id).title.fr, published);
  assert.equal(text(P.id).draftTextPageId, null);
});

await test("T6 : titre et année jamais vides, espaces retirés (écriture) ; en anglais vide accepté ; texte d'origine intact après refus", () => {
  const page = newPage("t-txt6");
  saveDraft(page, { ...base(page), blocks: featuredTitle(P.slug) }, rev(page));
  const published = text(P.id);
  for (const [field, value, re] of [["title", "", /titre/], ["title", "   ", /titre/], ["year", "   ", /année/], ["year", "", /année/]]) {
    const r = projectOp(page, P.id, field, value);
    assert.equal(r.ok, false, `${field} « ${value} » refusé`);
    assert.match(r.message, re);
  }
  assert.equal(text(P.id).draftTextPageId, null, "rien écrit");
  assert.equal(readBoard(page, P.id).project.title.fr, published.title.fr);
  assert.equal(projectOp(page, P.id, "title", "  Titre propre \n").ok, true);
  assert.equal(readBoard(page, P.id).project.title.fr, "Titre propre", "espaces retirés");
  assert.equal(projectOp(page, P.id, "title", "", "en").ok, true, "titre anglais vide : accepté comme dans l'écran Projets");
  // Annuler / Rétablir : un instantané vidé n'est pas écrit non plus.
  const snap = readBoard(page, P.id);
  const emptied = restoreBoard(page, { ...snap, project: { ...snap.project, title: { fr: "  ", en: "x" } } }, rev(page));
  assert.equal(emptied.ok, false);
  const noYear = restoreBoard(page, { ...snap, project: { ...snap.project, year: " " } }, rev(page));
  assert.equal(noYear.ok, false);
  assert.equal(discardDraft(page, rev(page)).ok, true);
});
await test("T7 : garde-fou de publication — un texte vide déjà en base (écrit hors des contrôles) n'est jamais publié", () => {
  const page = newPage("t-txt7");
  saveDraft(page, { ...base(page), blocks: featuredTitle(P.slug) }, rev(page));
  const published = text(P.id);
  const forged = { title: { fr: "   ", en: "x" }, context: published.context, description: published.description, year: published.year };
  db.update(schema.projects).set({ draftText: forged, draftTextPageId: page }).where(eq(schema.projects.id, P.id)).run();
  const refused = publishDraft(page, rev(page));
  assert.equal(refused.ok, false);
  assert.match(refused.message, /titre/);
  assert.equal(text(P.id).title.fr, published.title.fr, "ligne publiée intacte");
  // Dernier recours : même sans le contrôle amont, l'application ne publie pas un texte invalide.
  db.update(schema.projects).set({ draftText: { ...forged, title: published.title, year: "" } }).where(eq(schema.projects.id, P.id)).run();
  assert.equal(publishDraft(page, rev(page)).ok, false);
  assert.equal(discardDraft(page, rev(page)).ok, true);
  assert.equal(text(P.id).year, published.year);
});
await test("T8 : opération de texte sans changement → aucune garde d'accès ni écriture (Titre lié compris) ; la citation par Titre lié suffit aux textes", () => {
  const page = newPage("t-txt8");
  saveDraft(page, { ...base(page), blocks: featuredTitle(P.slug) }, rev(page));
  const r0 = rev(page);
  const same = projectOp(page, P.id, "title", text(P.id).title.fr);
  assert.equal(same.ok, true, JSON.stringify(same));
  assert.equal(rev(page), r0, "version inchangée : rien écrit");
  assert.equal(text(P.id).draftTextPageId, null);
  // Page qui cite le projet par un Titre lié seulement : les textes passent, les images non.
  assert.equal(projectOp(page, P.id, "context", "Via titre lié").ok, true);
  const slotRefused = boardOp(page, P.id, { op: "retire", key: `s${db.select().from(schema.slots).where(eq(schema.slots.projectId, P.id)).get().id}` }, rev(page));
  assert.equal(slotRefused.ok, false);
  assert.match(slotRefused.message, /n'affiche pas ce projet/);
  assert.equal(discardDraft(page, rev(page)).ok, true);
});
await test("T9 : écran Projets — page qui tient les textes : « Mis en avant » enregistré, textes laissés de côté (avec explication)", () => {
  const page = newPage("t-txt9");
  saveDraft(page, { ...base(page), blocks: featuredTitle(P.slug) }, rev(page));
  assert.equal(projectOp(page, P.id, "context", "Tenu").ok, true);
  const meta = text(P.id);
  const res = saveProject(P.id, { title: { fr: "Écrasé ?", en: "" }, context: meta.context, description: meta.description, year: "1980", featured: !meta.featured });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.match(res.data.textsHeld, /en cours de modification sur la page « t-txt9 »/);
  const after = text(P.id);
  assert.equal(after.featured, !meta.featured);
  assert.equal(after.title.fr, meta.title.fr, "titre du formulaire non écrit");
  assert.equal(after.year, meta.year);
  assert.equal(saveProject(P.id, { title: meta.title, context: meta.context, description: meta.description, year: meta.year, featured: meta.featured }).data.textsHeld !== null, true);
  assert.equal(discardDraft(page, rev(page)).ok, true);
  const free = saveProject(P.id, { title: meta.title, context: meta.context, description: meta.description, year: meta.year, featured: meta.featured });
  assert.equal(free.ok, true);
  assert.equal(free.data.textsHeld, null);
});
await test("T10 : Rétablir avec la planche connue de l'éditeur → seuls les champs du pas sont réécrits (modif de l'écran Projets entre-temps conservée)", () => {
  const page = newPage("t-txt10");
  saveDraft(page, { ...base(page), blocks: featuredTitle(P.slug) }, rev(page));
  const r = projectOp(page, P.id, "title", "Titre du pas");
  assert.equal(r.ok, true);
  assert.equal(restoreBoard(page, r.data.before, rev(page), r.data.after).ok, true, "Annuler");
  assert.equal(text(P.id).draftTextPageId, null, "plus de surcouche : l'écran Projets est libre");
  const meta = text(P.id);
  assert.equal(saveProject(P.id, { title: meta.title, context: { fr: "Contexte changé ailleurs", en: meta.context.en }, description: meta.description, year: meta.year, featured: meta.featured }).ok, true);
  const redone = restoreBoard(page, r.data.after, rev(page), r.data.before);
  assert.equal(redone.ok, true, JSON.stringify(redone));
  const now = readBoard(page, P.id).project;
  assert.equal(now.title.fr, "Titre du pas", "le champ du pas est rétabli");
  assert.equal(now.context.fr, "Contexte changé ailleurs", "la modification faite entre-temps est conservée");
  // Sans la planche connue : ancien comportement (tout l'instantané).
  assert.equal(restoreBoard(page, r.data.after, rev(page)).data.after.project.context.fr, r.data.after.project.context.fr);
  assert.equal(discardDraft(page, rev(page)).ok, true);
  saveProject(P.id, { title: meta.title, context: meta.context, description: meta.description, year: meta.year, featured: meta.featured });
});
await test("T11 : supprimer la page efface la surcouche de textes qu'elle portait", () => {
  const page = newPage("t-txt11");
  saveDraft(page, { ...base(page), blocks: featuredTitle(P.slug) }, rev(page));
  assert.equal(projectOp(page, P.id, "title", "Disparaîtra avec la page").ok, true);
  assert.equal(text(P.id).draftTextPageId, page);
  // Une page citée par un autre bloc est protégée ; celle-ci ne l'est pas.
  const res = deletePage(page);
  assert.equal(res.ok, true, JSON.stringify(res));
  const row = text(P.id);
  assert.equal(row.draftTextPageId, null);
  assert.equal(row.draftText, null);
  assert.notEqual(row.title.fr, "Disparaîtra avec la page");
});

/* ---- 2. Menu et brouillon de l'en-tête (scénarios D4–D12, E1–E2 de l'audit) ---- */

const A = newPage("t-nav-a");
const B = newPage("t-nav-b");
const C = newPage("t-nav-c");
const about = db.select().from(schema.pages).all().find((p) => p.slug.fr === "a-propos").id;
await test("D4–D5 page mise au menu depuis la liste pendant un brouillon d'en-tête : reportée dans le brouillon", () => {
  const pub = readPublishedSite();
  assert.equal(saveSiteDraft(A, { ...pub, identity: { ...pub.identity, name: { fr: "Nom brouillon", en: "Brouillon name" } } }, readSiteRev()).ok, true);
  assert.equal(setInMenu(B, true).ok, true);
  assert.ok(navIds().includes(B), "menu publié");
  assert.ok(readSiteDraft().snap.nav.some((i) => i.kind === "page" && i.pageId === B), "brouillon de l'en-tête");
});
await test("D6 page supprimée : retirée du menu publié ET du brouillon de l'en-tête", () => {
  assert.equal(deletePage(about).ok, true);
  assert.ok(!navIds().includes(about));
  assert.ok(!readSiteDraft().snap.nav.some((i) => i.kind === "page" && i.pageId === about));
});
await test("D7–D10 publier l'en-tête : la page supprimée ne revient pas, la page ajoutée ailleurs reste", () => {
  assert.equal(publishDraft(A, rev(A)).ok, true);
  assert.ok(!navIds().includes(about));
  assert.ok(navIds().includes(B));
  assert.equal(db.select({ n: schema.pages.navOrder }).from(schema.pages).where(eq(schema.pages.id, B)).get().n !== null, true);
  assert.deepEqual(readPublishedSite().identity.name, { fr: "Nom brouillon", en: "Brouillon name" });
});
await test("D11–D12 l'éditeur n'est jamais bloqué : une page disparue est retirée en silence", () => {
  const pub = readPublishedSite();
  const res = saveSiteDraft(A, { ...pub, nav: [...pub.nav, { kind: "page", pageId: 99999 }], identity: { ...pub.identity, name: { fr: "Encore", en: "" } } }, readSiteRev());
  assert.equal(res.ok, true);
  assert.ok(!readSiteDraft().snap.nav.some((i) => i.kind === "page" && i.pageId === 99999));
  assert.ok(siteForEditor(A).snap.nav.every((i) => i.kind !== "page" || i.pageId !== 99999));
  assert.equal(discardSiteDraft(readSiteRev()).ok, true);
});
await test("ordre du menu changé depuis la liste pendant un brouillon d'en-tête : reporté", () => {
  const pub = readPublishedSite();
  saveSiteDraft(C, { ...pub, identity: { ...pub.identity, name: { fr: "C", en: "" } } }, readSiteRev());
  const pages = navIds();
  const reversed = [...pages].reverse();
  assert.equal(reorderMenu(reversed).ok, true);
  assert.deepEqual(readSiteDraft().snap.nav.flatMap((i) => (i.kind === "page" ? [i.pageId] : [])), reversed);
  publishDraft(C, rev(C));
  assert.deepEqual(navIds(), reversed);
});
await test("E1–E2 case « dans le menu » cochée dans le brouillon de la page + en-tête modifié : la page entre au menu", () => {
  const pub = readPublishedSite();
  saveDraft(A, { ...base(A), published: true, inMenu: true, blocks: [] }, rev(A));
  saveSiteDraft(A, { ...pub, identity: { ...pub.identity, name: { fr: "X", en: "" } } }, readSiteRev());
  assert.equal(publishDraft(A, rev(A)).ok, true);
  assert.ok(navIds().includes(A));
});
await test("retirer une page par l'en-tête n'est pas défait à la publication suivante d'une autre page", () => {
  saveDraft(B, { ...base(B), blocks: [] }, rev(B));
  assert.equal(base(B).inMenu, true);
  const pub = readPublishedSite();
  saveSiteDraft(C, { ...pub, nav: pub.nav.filter((i) => !(i.kind === "page" && i.pageId === B)) }, readSiteRev());
  publishDraft(C, rev(C));
  assert.ok(!navIds().includes(B));
  assert.equal(base(B).inMenu, false, "le brouillon de B a suivi");
  publishDraft(B, rev(B));
  assert.ok(!navIds().includes(B));
});

await test("G1–G8 éditeur resté ouvert : un changement du menu fait ailleurs rend son instantané périmé (conflit), B reste au menu", () => {
  const GA = newPage("t-g-a");
  const GB = newPage("t-g-b");
  saveDraft(GB, { ...base(GB), published: true, blocks: [] }, rev(GB));
  publishDraft(GB, rev(GB));
  const snap = siteForEditor(GA).snap;
  const r1 = saveSiteDraft(GA, { ...snap, identity: { ...snap.identity, name: { fr: "N1", en: "" } } }, readSiteRev());
  assert.equal(r1.ok, true);
  const { after, rev: revA } = r1.data;
  assert.equal(setInMenu(GB, true).ok, true);
  assert.ok(readSiteDraft().snap.nav.some((i) => i.kind === "page" && i.pageId === GB), "reporté dans le brouillon");
  assert.equal(readSiteRev(), revA + 1, "version du brouillon du site incrémentée (lot 96 : plus celle d'une page)");
  const stale = saveSiteDraft(GA, { ...after, identity: { ...after.identity, name: { fr: "N2", en: "" } } }, revA);
  assert.equal(stale.ok, false);
  assert.equal(stale.code, "conflict", "l'éditeur périmé reçoit « Modifié ailleurs »");
  assert.equal(publishDraft(GA, rev(GA)).ok, true);
  assert.ok(navIds().includes(GB), "B toujours au menu après la publication");
});

/* ---- 2b. Palette et logo du site (lot 17f) ------------------------------------------ */

const { activeThemeForEdit } = await import("../src/lib/edit/look-context.ts");
const { savePageFromForm } = await import("../src/lib/edit/drafts.ts");
const settingOf = (key) => {
  const raw = db.select().from(schema.settings).where(eq(schema.settings.key, key)).get()?.value;
  return raw ? JSON.parse(raw) : undefined;
};

await test("17f (lot 29) : palette peu lisible → enregistrée, publiée et appliquée : avertissement seulement, jamais de refus", () => {
  const page = newPage("t-17f-a");
  const theme = activeThemeForEdit();
  const pub = readPublishedSite();
  saveDraft(page, { ...base(page), blocks: [k("b", "section-title", { title: L("Titre") })] }, rev(page));
  // Fond = couleur du texte : la saisie est acceptée…
  const saved = saveSiteDraft(page, { ...pub, styles: { palette: { bg: theme.tokens.color.ink } } }, readSiteRev());
  assert.equal(saved.ok, true, "enregistrement du brouillon jamais bloqué");
  // …la mise en ligne aussi (lot 29), et la couleur est bien celle qui est publiée.
  const published = publishDraft(page, rev(page));
  assert.equal(published.ok, true, JSON.stringify(published.fieldErrors));
  assert.equal(settingOf("styles")?.palette?.bg, theme.tokens.color.ink, "la couleur choisie est publiée telle quelle");
  // Le formulaire de la page n'est pas bloqué non plus.
  const viaForm = savePageFromForm(page, { ...base(page), blocks: [] }, rev(page));
  assert.equal(viaForm.ok, true);
  // Nettoyage : retour à la palette du thème, publié.
  assert.equal(saveSiteDraft(page, { ...pub, styles: {} }, readSiteRev()).ok, true);
  assert.equal(publishDraft(page, rev(page)).ok, true);
  assert.equal(settingOf("styles")?.palette, undefined, "palette retirée");
});
await test("17f : palette lisible → publiée avec la page, thème intact ; Annuler (retour à la palette du thème) la retire", () => {
  const page = newPage("t-17f-b");
  const themeBefore = JSON.stringify(activeThemeForEdit());
  const pub = readPublishedSite();
  saveDraft(page, { ...base(page), blocks: [k("b", "section-title", { title: L("Titre") })] }, rev(page));
  assert.equal(saveSiteDraft(page, { ...pub, styles: { palette: { primary: "#7a1f10" }, logo: { size: 96, mode: "shrink" } } }, readSiteRev()).ok, true);
  assert.deepEqual(readSiteDraft().snap.styles, { palette: { primary: "#7a1f10" }, logo: { size: 96, mode: "shrink" } });
  assert.equal(settingOf("styles")?.palette, undefined, "brouillon : rien en ligne avant Publier");
  const done = publishDraft(page, rev(page));
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.deepEqual(settingOf("styles"), { palette: { primary: "#7a1f10" }, logo: { size: 96, mode: "shrink" } });
  assert.equal(JSON.stringify(activeThemeForEdit()), themeBefore, "le thème n'est jamais modifié");
  // Retour aux réglages du thème : palette et logo vides disparaissent des styles publiés.
  const after = readPublishedSite();
  assert.deepEqual(after.styles?.palette, { primary: "#7a1f10" });
  saveDraft(page, { ...base(page), blocks: [k("b", "section-title", { title: L("Titre") })] }, rev(page));
  assert.equal(saveSiteDraft(page, { ...after, styles: { palette: {}, logo: { mode: "fixed" } } }, readSiteRev()).ok, true);
  assert.equal(readSiteDraft().snap.styles, undefined, "palette / logo vides = pas de styles");
  assert.equal(publishDraft(page, rev(page)).ok, true);
  assert.equal(settingOf("styles"), undefined);
});

/* ---- 3. POST /api/contact ------------------------------------------------------ */

const F = newPage("t-form");
const form = withFreshUids({ uid: "", type: "contact", props: { ...defaultContactForm(), form: true } }, () => "fx");
saveDraft(F, { ...base(F), published: true, blocks: [{ ...form, uid: "f1" }] }, rev(F));
assert.equal(publishDraft(F, rev(F)).ok, true);
const formId = form.props.formId;
// Jeton délivré il y a 10 s (délai minimal passé) : `token: null` = envoi sans jeton.
const tokenFor = (id, ageMs = 10_000) => issueContactToken(id, Date.now() - ageMs);
const sendRaw = async (body, headers = {}) =>
  POST(new Request("http://localhost/api/contact", { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));
const send = async (body, headers = {}) => {
  const withToken = typeof body === "string" || "token" in body ? body : { ...body, token: tokenFor(body.form) };
  return (await sendRaw(withToken, headers)).status;
};
const ok = { form: formId, locale: "fr", values: { fname: "Lou", femail: "a@b.fr", fmessage: "salut" } };
await test("contact : XFF dont la partie gauche tourne = même client réel → 429 au 6e (AUTH_TRUSTED_PROXY_HOPS=1)", async () => {
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push(await send(ok, { "x-forwarded-for": `10.9.${i}.1, 198.51.100.7` }));
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 429, 429]);
  assert.equal(await send(ok, { "x-forwarded-for": "10.9.9.9, 198.51.100.8" }), 200, "un autre client n'est pas bloqué");
});
await test("contact : identifiant stable — après une republication, le formulaire répond toujours", async () => {
  saveDraft(F, { ...base(F), title: L("t-form bis") }, rev(F));
  assert.equal(publishDraft(F, rev(F)).ok, true);
  assert.equal(await send(ok, { "x-forwarded-for": "198.51.100.20" }), 200);
  assert.equal(await send({ ...ok, form: "inconnu123" }, { "x-forwarded-for": "198.51.100.21" }), 404);
});
await test("formId en double : refusé au brouillon et à la publication (même page, autre page publiée)", () => {
  const G = newPage("t-form-dup");
  const r1 = saveDraft(G, { ...base(G), published: true, blocks: [{ ...form, uid: "c1" }] }, rev(G));
  assert.equal(r1.ok, false, "même identifiant qu'un formulaire publié d'une autre page (brouillon)");
  assert.match(r1.message, /autre page/);
  const other = withFreshUids({ uid: "", type: "contact", props: { ...defaultContactForm(), form: true } }, () => "gx");
  const r2 = saveDraft(G, { ...base(G), published: true, blocks: [{ ...other, uid: "c1" }, { ...other, uid: "c2" }] }, rev(G));
  assert.equal(r2.ok, false, "deux fois le même identifiant sur la page");
  assert.match(r2.message, /même identifiant/);
  // Publication : le contrôle tient aussi dans la transaction (brouillon écrit sans passer par saveDraft).
  db.update(schema.pages).set({ draft: { ...base(G), published: true, blocks: [{ ...form, uid: "c1" }] } }).where(eq(schema.pages.id, G)).run();
  const pub = publishDraft(G, rev(G));
  assert.equal(pub.ok, false);
  assert.ok(Object.values(pub.fieldErrors ?? {}).some((m) => /autre page/.test(m)), JSON.stringify(pub.fieldErrors));
  assert.equal(saveDraft(G, { ...base(G), blocks: [{ ...other, uid: "c1" }] }, rev(G)).ok, true, "un identifiant neuf passe");
});
await test("fond de l'ouverture : un PDF est refusé au brouillon ET à la publication, image et vidéo passent", () => {
  const media = (kind, mime) => db.insert(schema.media).values({ key: `t-bg-${kind}`, kind, mime, size: 1, status: "ready" }).returning({ id: schema.media.id }).get().id;
  const pdf = media("pdf", "application/pdf");
  const img = media("image", "image/webp");
  const vid = media("video", "video/mp4");
  const G = newPage("t-bg-kind");
  const hero = (backgroundMediaId) => k("h", "hero", { eyebrow: L("x"), statement: L("y"), backgroundMediaId });
  const refused = saveDraft(G, { ...base(G), blocks: [hero(pdf)] }, rev(G));
  assert.equal(refused.ok, false, "PDF refusé au brouillon");
  assert.match(refused.message, /image ou une vidéo/);
  // Dans un conteneur aussi.
  assert.equal(saveDraft(G, { ...base(G), blocks: [k("c", "grid", { children: [hero(pdf)] })] }, rev(G)).ok, false, "PDF refusé dans un conteneur");
  assert.equal(saveDraft(G, { ...base(G), blocks: [hero(img)] }, rev(G)).ok, true, "image acceptée");
  assert.equal(saveDraft(G, { ...base(G), blocks: [hero(vid)] }, rev(G)).ok, true, "vidéo acceptée");
  // Publication : brouillon écrit sans passer par saveDraft.
  db.update(schema.pages).set({ draft: { ...base(G), blocks: [hero(pdf)] } }).where(eq(schema.pages.id, G)).run();
  const pub = publishDraft(G, rev(G));
  assert.equal(pub.ok, false, "PDF refusé à la publication");
  assert.ok(Object.values(pub.fieldErrors ?? {}).some((m) => /image ou une vidéo/.test(m)), JSON.stringify(pub.fieldErrors));
});
await test("entrées des collections : le cadrage d'une collection retirée du bloc est purgé à la publication", () => {
  const G = newPage("t-tilecrop");
  const crop = { x: 40, y: 60, zoom: 1.5 };
  const item = (collection) => ({ collection, pageId: G, eyebrow: L("e"), title: L("t"), intro: L("i") });
  const block = (items, tileCrop) => k("t", "collection-tiles", { eyebrow: L("a"), title: L("b"), items, look: { tileCrop } });
  const published = () => db.select().from(schema.blocks).where(eq(schema.blocks.pageId, G)).all().map((b) => JSON.parse(b.props));
  assert.equal(saveDraft(G, { ...base(G), blocks: [block([item("characters")], { characters: crop, backgrounds: crop })] }, rev(G)).ok, true);
  const pub = publishDraft(G, rev(G));
  assert.equal(pub.ok, true, JSON.stringify(pub));
  assert.deepEqual(Object.keys(published()[0].look.tileCrop), ["characters"], "backgrounds purgé, characters gardé");
  assert.equal(saveDraft(G, { ...base(G), blocks: [block([item("characters")], { characters: crop })] }, rev(G)).ok, true);
  assert.equal(publishDraft(G, rev(G)).ok, true);
  assert.deepEqual(published()[0].look.tileCrop, { characters: crop }, "rien à purger : inchangé");
  assert.equal(saveDraft(G, { ...base(G), blocks: [block([item("animation")], { characters: crop })] }, rev(G)).ok, true);
  assert.equal(publishDraft(G, rev(G)).ok, true);
  assert.equal(published()[0].look?.tileCrop, undefined, "plus aucune tuile cadrée : tileCrop retiré");
});
await test("contact : Content-Length trop grand → 413 sans lecture ; corps énorme sans longueur (flux) → 413, RSS stable", async () => {
  assert.equal(await send(JSON.stringify(ok), { "content-length": String(10 * 1024 * 1024) }), 413);
  const chunk = new TextEncoder().encode("a".repeat(64 * 1024));
  let sent = 0;
  const stream = new ReadableStream({
    pull(c) {
      if (sent++ > 400) c.close(); // ~25 Mo si tout était lu
      else c.enqueue(chunk);
    },
  });
  const rss0 = process.memoryUsage().rss;
  const res = await POST(new Request("http://localhost/api/contact", { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" }, body: stream, duplex: "half" }));
  assert.equal(res.status, 413);
  assert.ok(sent < 5, `lecture coupée tôt (${sent} morceaux lus)`);
  assert.ok(process.memoryUsage().rss - rss0 < 20e6, "RSS stable");
});

await test("contact : jeton exigé (absent, falsifié, autre formulaire, réutilisé → 403 code token ; trop tôt → 429 code early)", async () => {
  resetContactGuard();
  const xff = { "x-forwarded-for": "192.0.2.10" };
  const code = async (body) => {
    const res = await sendRaw(body, xff);
    return `${res.status}:${(await res.json()).code ?? ""}`;
  };
  assert.equal(await code({ ...ok, token: undefined }), "403:token", "sans jeton");
  assert.equal(await code({ ...ok, token: "x" }), "403:token", "jeton illisible");
  const t = tokenFor(formId);
  assert.equal(await code({ ...ok, token: t.slice(0, -1) + (t.endsWith("A") ? "B" : "A") }), "403:token", "signature falsifiée");
  assert.equal(await code({ ...ok, token: tokenFor("autreform1") }), "403:token", "jeton d'un autre formulaire");
  assert.equal(await code({ ...ok, token: tokenFor(formId, 3 * 3600_000) }), "403:token", "jeton expiré");
  const early = await sendRaw({ ...ok, token: tokenFor(formId, 500) }, xff);
  const earlyBody = await early.json();
  assert.equal(early.status, 429, "envoi 0,5 s après l'affichage");
  assert.equal(earlyBody.code, "early");
  assert.ok(earlyBody.waitMs > 0 && earlyBody.waitMs <= MIN_DELAY_MS, String(earlyBody.waitMs));
  assert.equal(await code({ ...ok, token: t }), "200:", "jeton valable");
  assert.equal(await code({ ...ok, token: t }), "403:token", "le même jeton ne sert qu'une fois");
  // Un envoi refusé (champ invalide) ne consomme pas le jeton : la personne corrige et renvoie.
  const t2 = tokenFor(formId);
  assert.equal(await code({ ...ok, values: { ...ok.values, femail: "pas-une-adresse" }, token: t2 }), "400:");
  assert.equal(await code({ ...ok, token: t2 }), "200:");
  // Route GET : réponse jamais mise en cache, jeton accepté après le délai.
  const res = GET_TOKEN(new Request(`http://localhost/api/contact/token?form=${formId}`));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const { token } = await res.json();
  assert.equal(await code({ ...ok, token }), "429:early", "jeton tout juste délivré : trop tôt");
  assert.equal(GET_TOKEN(new Request("http://localhost/api/contact/token?form=../x")).status, 400);
});
await test("contact : plafond par préfixe /24 et /64 (adresses voisines = même réseau)", async () => {
  resetContactGuard();
  assert.equal(ipPrefix("203.0.113.77"), "203.0.113.0/24");
  assert.equal(ipPrefix("::ffff:203.0.113.9"), "203.0.113.0/24");
  assert.equal(ipPrefix("2001:db8:0:12::1"), "2001:db8:0:12::/64");
  assert.equal(ipPrefix("2001:0db8:0000:0012:ffff:1:2:3"), "2001:db8:0:12::/64");
  assert.equal(ipPrefix("pas une ip"), null);
  const codes = [];
  for (let i = 1; i <= 12; i++) codes.push(await send(ok, { "x-forwarded-for": `203.0.113.${i}` }));
  assert.deepEqual(codes, [...Array(10).fill(200), 429, 429], "10 adresses différentes du même /24, puis refus");
  assert.equal(await send(ok, { "x-forwarded-for": "203.0.114.1" }), 200, "le /24 voisin n'est pas bloqué");
  const v6 = [];
  for (let i = 1; i <= 11; i++) v6.push(await send(ok, { "x-forwarded-for": `2001:db8:0:12::${i.toString(16)}` }));
  assert.deepEqual(v6, [...Array(10).fill(200), 429], "même /64");
  assert.equal(await send(ok, { "x-forwarded-for": "2001:db8:0:13::1" }), 200, "autre /64");
  db.delete(schema.messages).run();
});
await test("contact : empreinte d'IP = HMAC avec secret (pas sha256(\"contact:\"+ip)), valeurs sans \\p{Cf}, e-mail ASCII", async () => {
  resetContactGuard();
  const { createHash } = await import("node:crypto");
  assert.equal(await send({ ...ok, values: { fname: "Lou\u202Eevil\u200B", femail: "a@b.fr", fmessage: "sa\u2066lut" } }, { "x-forwarded-for": "192.0.2.55" }), 200);
  const row = db.select().from(schema.messages).all().at(-1);
  assert.notEqual(row.ipHash, createHash("sha256").update("contact:192.0.2.55").digest("hex").slice(0, 32), "empreinte sans secret : réversible");
  assert.match(row.ipHash, /^[0-9a-f]{32}$/);
  const values = JSON.parse(row.fields).map((f) => f.value);
  assert.deepEqual(values, ["Louevil", "a@b.fr", "salut"], "caractères de format retirés");
  assert.ok(!/\p{Cf}/u.test(row.fields));
  for (const bad of ["k\u0430te@exemple.fr", "kate@ex\u0435mple.fr", "\u212Aate@exemple.fr", "caf\u00e9@exemple.fr"])
    assert.equal(await send({ ...ok, values: { ...ok.values, femail: bad } }, { "x-forwarded-for": "192.0.2.56" }), 400, bad);
  db.delete(schema.messages).run();
});
await test("contact : ménage APRÈS les limites et au plus une fois par heure", async () => {
  resetContactGuard();
  const old = new Date(Date.now() - 400 * 86400_000);
  const plant = () => db.insert(schema.messages).values({ pageId: F, subject: "vieux", fields: "[]", ipHash: "x".repeat(32), createdAt: old }).run();
  const olds = () => db.select().from(schema.messages).all().filter((m) => m.subject === "vieux").length;
  plant();
  // Envois refusés (sans jeton, client au plafond) : aucune écriture, le vieux message reste.
  await sendRaw({ ...ok }, { "x-forwarded-for": "192.0.2.70" });
  for (let i = 0; i < 5; i++) assert.equal(await send(ok, { "x-forwarded-for": "192.0.2.71" }), 200);
  // Le ménage a eu lieu au 1er envoi accepté (vieux message parti), pas aux suivants.
  assert.equal(olds(), 0, "ménage fait au premier envoi accepté");
  plant();
  assert.equal(await send(ok, { "x-forwarded-for": "192.0.2.71" }), 429, "client au plafond");
  assert.equal(await send(ok, { "x-forwarded-for": "192.0.2.72" }), 200);
  assert.equal(olds(), 1, "moins d'une heure après le précédent : pas de nouveau ménage");
  db.delete(schema.messages).run();
});

console.log(`\n${passed} test(s) OK`);
rmSync(dir, { recursive: true, force: true });
process.exit(0);
