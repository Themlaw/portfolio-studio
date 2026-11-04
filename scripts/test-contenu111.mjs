#!/usr/bin/env node
/**
 * Lot 111 — contenu d'un bloc Projet propre à la page, et création d'un projet sans nom, sur une VRAIE base, sans serveur. Données SYNTHÉTIQUES.
 *  1. modèle : `props.layout` du bloc (lecture, références de médias, compteurs) ;
 *  2. ancien bloc : rendu identique ; copie à l'écriture (contenu et textes) : la première modification copie dans SON bloc, aucune autre page touchée, aucun verrou ;
 *  3. publication des deux pages, Annuler / Rétablir ;
 *  4. brouillon de projet tenu par une page (données antérieures) : devient la copie propre de son bloc, sans perte ;
 *  6. aucune donnée réécrite sans geste (le démarrage ne touche rien) ;
 *  7. création : slug aléatoire unique, titre par défaut, titre modifiable sans changer le slug, anciens slugs inchangés.
 * Usage : node --import tsx scripts/test-contenu111.mjs
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "pf-test-contenu111-"));
process.env.DATA_DIR = dir;
const log = console.log;
console.log = () => {};
const { bootstrap } = await import("../src/lib/db/bootstrap.ts");
await bootstrap();
console.log = log;
const { getDb, getSqlite, schema } = await import("../src/lib/db/index.ts");
const { eq } = await import("drizzle-orm");
const { ownLayoutOf, layoutMediaIds } = await import("../src/blocks/board-layout.ts");
const { extractRefs } = await import("../src/blocks/refs.ts");
const { countKey } = await import("../src/blocks/tree.ts");
const { readDraft, saveDraft, publishDraft } = await import("../src/lib/edit/drafts.ts");
const { createPage } = await import("../src/lib/edit/pages.ts");
const { boardOp, restoreBoard, readBoard, createDraftProject } = await import("../src/lib/edit/boards.ts");
const { createProject, saveProject } = await import("../src/lib/edit/projects.ts");
const { getPageForEdit } = await import("../src/lib/admin.ts");
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
const [P] = db.select().from(schema.projects).all();
const row = () => db.select().from(schema.projects).where(eq(schema.projects.id, P.id)).get();
const media = db.select().from(schema.media).all().filter((m) => m.kind === "image" && m.status === "ready");
assert.ok(media.length >= 3, "médias du seed");
const withBoard = (page) => saveDraft(page, { ...base(page), blocks: [{ uid: "b", type: "project-board", props: { project: P.slug } }] }, rev(page));
const draftBlock = (page) => readDraft(page).draft.blocks[0];
const publishedBlock = (page) => getPageForEdit(page).blocks[0];
const dump = () =>
  createHash("sha256")
    .update(JSON.stringify(getSqlite().prepare("select id, layout, draft_layout, draft_layout_page_id from projects order by id").all()))
    .update(JSON.stringify(getSqlite().prepare("select page_id, type, props from blocks order by id").all()))
    .digest("hex");

/** Contenu publié du projet : la bande du projet et une image. */
const PUBLISHED = [
  { uid: "strip", type: "strip", props: {} },
  { uid: "im1", type: "image", props: { mediaId: media[0].id, width: "full" } },
];
getSqlite().prepare("UPDATE projects SET layout = ?, draft_layout = NULL, draft_layout_page_id = NULL WHERE id = ?").run(JSON.stringify(PUBLISHED), P.id);

const A = newPage("t111a");
const B = newPage("t111b");
for (const p of [A, B]) {
  assert.equal(withBoard(p).ok, true);
  assert.equal(publishDraft(p, rev(p)).ok, true);
}

await test("modèle : contenu propre lu à la place du partagé, références de médias, compteurs distincts", () => {
  assert.equal(ownLayoutOf({ project: "x" }), null);
  assert.equal(ownLayoutOf({ layout: "n'importe quoi" }), null, "illisible : contenu partagé");
  assert.deepEqual(ownLayoutOf({ layout: [] }), [], "un contenu propre VIDE reste un contenu propre");
  assert.deepEqual(ownLayoutOf({ layout: PUBLISHED }), PUBLISHED);
  const own = [
    { uid: "a", type: "image", props: { mediaId: 5 } },
    { uid: "g", type: "grid", props: { children: [{ uid: "k", type: "video-single", props: { mediaId: 6, posterMediaId: 7 } }] } },
    { uid: "s", type: "strip", props: { source: "own", media: [8, null, 9] } },
    { uid: "f", type: "free-board", props: { items: [{ id: "i", media: 10 }] } },
  ];
  assert.deepEqual(layoutMediaIds(own).sort((x, y) => x - y), [5, 6, 7, 8, 9, 10]);
  assert.deepEqual(extractRefs("project-board", { project: "x", layout: own }).media.sort((x, y) => x - y), [5, 6, 7, 8, 9, 10], "références de la médiathèque = celles de layoutMediaIds");
  assert.deepEqual(extractRefs("project-board", { project: "x" }).media, []);
  assert.notEqual(countKey("p", undefined, { uid: "u1", type: "project-board", props: { layout: [] } }), countKey("p", undefined, { uid: "u2", type: "project-board", props: { layout: [] } }));
  assert.equal(countKey("p", "characters", { uid: "u1", type: "project-board", props: {} }), countKey("p", "characters", { uid: "u2", type: "project-board", props: {} }));
});

await test("ancien bloc sans copie propre : rendu identique (contenu et textes du projet), rien n'est écrit à la lecture", () => {
  const before = dump();
  for (const page of [A, B]) {
    const snap = readBoard(page, P.id);
    assert.equal(snap.own, undefined);
    assert.equal(snap.ownText, undefined);
    assert.deepEqual(snap.layout, PUBLISHED);
    assert.deepEqual(snap.project.title, row().title);
  }
  assert.equal(dump(), before);
});

await test("copie à l'écriture : la première modification depuis A copie le contenu dans le bloc de A ; ni le projet ni B ne bougent", () => {
  let r = boardOp(A, P.id, { op: "item-add", type: "image", index: 2, uid: "im2" }, rev(A));
  assert.equal(r.ok, true, r.message);
  r = boardOp(A, P.id, { op: "item-set", uid: "im2", props: { mediaId: media[1].id, width: "full" } }, rev(A));
  assert.equal(r.ok, true, r.message);
  assert.equal(r.data.after.own, true);
  assert.equal(draftBlock(A).props.layout.length, 3, "le bloc de A porte sa copie");
  assert.deepEqual(row().layout, PUBLISHED, "le contenu du projet n'a pas bougé");
  assert.equal(row().draftLayout, null, "plus de brouillon de projet");
  assert.equal(row().draftLayoutPageId, null, "plus de verrou");
  const b = readBoard(B, P.id);
  assert.equal(b.own, undefined);
  assert.equal(b.layout.length, 2, "B voit toujours le contenu du projet");
});

await test("aucun verrou : B modifie son contenu pendant que A a un brouillon ; chacune de son côté", () => {
  const r = boardOp(B, P.id, { op: "item-set", uid: "im1", box: { width: 50 } }, rev(B));
  assert.equal(r.ok, true, r.message);
  assert.equal(r.data.after.own, true);
  assert.deepEqual(draftBlock(B).props.layout[1].box, { width: 50 });
  assert.equal(draftBlock(A).props.layout.length, 3);
  assert.equal(draftBlock(A).props.layout[1].box, undefined, "la modification de B n'atteint pas A");
  assert.deepEqual(row().layout, PUBLISHED);
  // Et dans l'autre sens : A modifie, B reste telle qu'elle est.
  const bBefore = JSON.stringify(draftBlock(B).props);
  assert.equal(boardOp(A, P.id, { op: "item-move", uid: "im2", dir: "up" }, rev(A)).ok, true);
  assert.equal(JSON.stringify(draftBlock(B).props), bBefore);
});

await test("textes : la première modification copie les textes dans le bloc ; le projet et les autres pages gardent les leurs", () => {
  const titleBefore = row().title;
  const r = boardOp(A, P.id, { op: "project", field: "title", locale: "fr", value: "Titre propre à A" }, rev(A));
  assert.equal(r.ok, true, r.message);
  assert.equal(r.data.after.ownText, true);
  assert.equal(draftBlock(A).props.text.title.fr, "Titre propre à A");
  assert.equal(draftBlock(A).props.text.year, row().year, "les autres champs sont copiés tels quels");
  assert.deepEqual(row().title, titleBefore, "titre du projet intact");
  assert.equal(row().draftTextPageId, null);
  assert.deepEqual(readBoard(B, P.id).project.title, titleBefore);
  assert.equal(draftBlock(B).props.text, undefined);
  // B change aussi son titre : indépendant.
  assert.equal(boardOp(B, P.id, { op: "project", field: "title", locale: "fr", value: "Titre propre à B" }, rev(B)).ok, true);
  assert.equal(draftBlock(A).props.text.title.fr, "Titre propre à A");
  assert.equal(draftBlock(B).props.text.title.fr, "Titre propre à B");
  // Même texte qu'avant : rien à écrire.
  const same = boardOp(B, P.id, { op: "project", field: "title", locale: "fr", value: "Titre propre à B" }, rev(B));
  assert.equal(same.ok, true);
});

await test("publication des deux pages : chacune garde contenu et textes, le projet ne change pas, médias comptés comme utilisés", () => {
  const titleBefore = row().title;
  assert.equal(publishDraft(A, rev(A)).ok, true);
  assert.equal(publishDraft(B, rev(B)).ok, true);
  assert.equal(publishedBlock(A).props.layout.length, 3);
  assert.equal(publishedBlock(B).props.layout.length, 2);
  assert.deepEqual(publishedBlock(B).props.layout[1].box, { width: 50 });
  assert.equal(publishedBlock(A).props.text.title.fr, "Titre propre à A");
  assert.equal(publishedBlock(B).props.text.title.fr, "Titre propre à B");
  assert.deepEqual(row().layout, PUBLISHED);
  assert.deepEqual(row().title, titleBefore);
  const usedByA = (mediaUsagesByMedia().get(media[1].id) ?? []).some((u) => u.kind === "block" && u.pageId === A);
  assert.equal(usedByA, true, "le média du contenu propre de A est utilisé par A");
  assert.equal((mediaUsagesByMedia().get(media[1].id) ?? []).some((u) => u.kind === "block" && u.pageId === B), false);
});

await test("Annuler / Rétablir : annuler la première modification retire la copie du bloc (retour au contenu du projet)", () => {
  const C0 = newPage("t111u");
  assert.equal(withBoard(C0).ok, true);
  assert.equal(publishDraft(C0, rev(C0)).ok, true);
  const r = boardOp(C0, P.id, { op: "item-add", type: "image", index: 2, uid: "imu" }, rev(C0));
  assert.equal(r.ok, true, r.message);
  assert.equal(draftBlock(C0).props.layout.length, 3);
  const undone = restoreBoard(C0, r.data.before, rev(C0), r.data.after);
  assert.equal(undone.ok, true, undone.message);
  assert.equal(draftBlock(C0).props.layout, undefined, "plus de copie : le bloc relit le projet");
  assert.equal(undone.data.blocks[0].layout, null, "l'éditeur est informé");
  const redone = restoreBoard(C0, r.data.after, rev(C0), r.data.before);
  assert.equal(redone.ok, true, redone.message);
  assert.equal(draftBlock(C0).props.layout.length, 3);
  assert.deepEqual(row().layout, PUBLISHED);
});

await test("brouillon de projet tenu par une page (données antérieures) : devient la copie propre de SON bloc, sans perte ; les autres pages gardent le publié", () => {
  const E = newPage("t111h");
  const F = newPage("t111i");
  for (const x of [E, F]) {
    assert.equal(withBoard(x).ok, true);
    assert.equal(publishDraft(x, rev(x)).ok, true);
  }
  const heldLayout = [...PUBLISHED, { uid: "imh", type: "image", props: { mediaId: media[2].id, width: "full" } }];
  const heldText = { title: L("Titre tenu par E"), context: row().context, description: row().description, year: row().year };
  getSqlite().prepare("UPDATE projects SET draft_layout = ?, draft_layout_page_id = ?, draft_text = ?, draft_text_page_id = ? WHERE id = ?").run(JSON.stringify(heldLayout), E, JSON.stringify(heldText), E, P.id);
  const titlePublished = row().title;
  // Lecture : E voit son brouillon, F le publié ; rien n'est écrit.
  const before = dump();
  assert.equal(readBoard(E, P.id).layout.length, 3);
  assert.equal(readBoard(E, P.id).project.title.fr, "Titre tenu par E");
  assert.equal(readBoard(F, P.id).layout.length, 2);
  assert.deepEqual(readBoard(F, P.id).project.title, titlePublished);
  assert.equal(dump(), before);
  // F (pas la page tenante) modifie : copie du contenu PUBLIÉ dans son bloc, sans refus ; le brouillon tenu par E n'est pas touché.
  const r = boardOp(F, P.id, { op: "item-set", uid: "im1", box: { width: 30 } }, rev(F));
  assert.equal(r.ok, true, r.message);
  assert.equal(draftBlock(F).props.layout.length, 2);
  assert.equal(row().draftLayoutPageId, E);
  assert.equal(JSON.stringify(row().draftLayout), JSON.stringify(heldLayout));
  // E publie sans avoir rien modifié : son brouillon devient la copie propre de son bloc.
  const savedE = draftBlock(E);
  assert.ok(savedE, "E a (ou n'a pas) de brouillon : on en crée un en touchant la page");
  assert.equal(saveDraft(E, { ...base(E), blocks: [{ ...draftBlock(E), props: { ...draftBlock(E).props } }] }, rev(E)).ok, true);
  const pub = publishDraft(E, rev(E));
  assert.equal(pub.ok, true, pub.message);
  assert.equal(publishedBlock(E).props.layout.length, 3, "le brouillon n'est pas perdu");
  assert.equal(publishedBlock(E).props.text.title.fr, "Titre tenu par E");
  assert.deepEqual(row().layout, PUBLISHED, "le contenu publié du projet reste celui des autres pages");
  assert.deepEqual(row().title, titlePublished);
  assert.equal(row().draftLayoutPageId, null);
  assert.equal(row().draftTextPageId, null);
  assert.equal(publishDraft(F, rev(F)).ok, true);
  assert.equal(publishedBlock(F).props.layout.length, 2);
});

await test("brouillon tenu par une page : sa première modification part de ce brouillon (rien n'est perdu)", () => {
  const G = newPage("t111j");
  assert.equal(withBoard(G).ok, true);
  assert.equal(publishDraft(G, rev(G)).ok, true);
  const heldLayout = [...PUBLISHED, { uid: "imk", type: "image", props: { mediaId: media[2].id, width: "full" } }];
  getSqlite().prepare("UPDATE projects SET draft_layout = ?, draft_layout_page_id = ? WHERE id = ?").run(JSON.stringify(heldLayout), G, P.id);
  const r = boardOp(G, P.id, { op: "item-set", uid: "im1", box: { width: 20 } }, rev(G));
  assert.equal(r.ok, true, r.message);
  assert.equal(draftBlock(G).props.layout.length, 3, "la copie part du brouillon tenu");
  assert.equal(row().draftLayoutPageId, null);
  assert.equal(row().draftLayout, null);
  assert.deepEqual(row().layout, PUBLISHED);
});

await test("garde : une page sans bloc Projet ne peut rien écrire ; publication refusée si le contenu propre est inachevé", () => {
  const C = newPage("t111c");
  const r = boardOp(C, P.id, { op: "item-add", type: "image", index: 2, uid: "x" }, rev(C));
  assert.equal(r.ok, false);
  const D = newPage("t111d");
  assert.equal(withBoard(D).ok, true);
  assert.equal(boardOp(D, P.id, { op: "item-add", type: "image", index: 2, uid: "vide" }, rev(D)).ok, true);
  const refused = publishDraft(D, rev(D));
  assert.equal(refused.ok, false);
  assert.match(refused.message, /contenu propre à cette page/);
});

await test("aucune migration automatique : le démarrage ne réécrit rien (projets, blocs)", async () => {
  const before = dump();
  console.log = () => {};
  await bootstrap();
  console.log = log;
  assert.equal(dump(), before);
});

await test("création : slug aléatoire unique, titre par défaut, deux créations = deux projets même avec le même titre", () => {
  const taken = new Set(db.select().from(schema.projects).all().map((p) => p.slug));
  const a = createProject();
  const b = createProject();
  assert.equal(a.ok && b.ok, true);
  assert.match(a.data.slug, /^p-[a-z0-9]{8}$/);
  assert.match(b.data.slug, /^p-[a-z0-9]{8}$/);
  assert.notEqual(a.data.slug, b.data.slug);
  assert.notEqual(a.data.id, b.data.id);
  assert.equal(taken.has(a.data.slug) || taken.has(b.data.slug), false);
  const pa = db.select().from(schema.projects).where(eq(schema.projects.id, a.data.id)).get();
  assert.deepEqual(pa.title, { fr: "Projet sans titre", en: "Untitled project" });
  const c = createProject({ title: { fr: "Même titre", en: "" } });
  const d = createProject({ title: { fr: "Même titre", en: "" } });
  assert.notEqual(c.data.slug, d.data.slug, "le titre ne donne plus le slug");
  assert.match(c.data.slug, /^p-[a-z0-9]{8}$/);
  const page = newPage("t111e");
  const e = createDraftProject(page);
  const f = createDraftProject(page);
  assert.equal(e.ok && f.ok, true);
  assert.match(e.data.slug, /^p-[a-z0-9]{8}$/);
  assert.notEqual(e.data.slug, f.data.slug);
  assert.equal(e.data.title, "Projet sans titre");
  assert.equal(createDraftProject(page, "Nom donné").data.title, "Nom donné");
  assert.match(createDraftProject(page, "Nom donné").data.slug, /^p-[a-z0-9]{8}$/);
});

await test("titre modifiable sans toucher au slug ; les projets existants gardent leur slug", () => {
  const before = db.select().from(schema.projects).where(eq(schema.projects.id, P.id)).get().slug;
  assert.equal(before, P.slug);
  const a = createProject();
  const p = db.select().from(schema.projects).where(eq(schema.projects.id, a.data.id)).get();
  const r = saveProject(a.data.id, { title: L("Un vrai titre"), context: L(""), description: L(""), year: "2026", featured: false });
  assert.equal(r.ok, true, r.message);
  const after = db.select().from(schema.projects).where(eq(schema.projects.id, a.data.id)).get();
  assert.equal(after.slug, p.slug);
  assert.equal(after.title.fr, "Un vrai titre");
});

console.log(`\n${passed} tests passent.`);
