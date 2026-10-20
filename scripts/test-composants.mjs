#!/usr/bin/env node
/**
 * v0.19 — tests unitaires (inclus dans npm test) :
 *  1. Registre des blocs : tout bloc créable a un groupe et un rang, aucun doublon (clé, rang dans un groupe),
 *     le conteneur « Projet mis en avant » n'est plus proposé ; regroupement et recherche (groups.ts).
 *  2. Migration de contenu 0021 (src/lib/db/unwrap.ts) sur une base SQLite en mémoire : conteneurs déballés
 *     (publié, brouillon, grille imbriquée), projet porté en dur, look / carte reportés, lien « voir plus » en
 *     bloc, aucun texte perdu, idempotente, borne de 40 blocs.
 * Usage : node --import tsx scripts/test-composants.mjs
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

import Database from "better-sqlite3";

import { BLOCKS, blockCatalog } from "../src/blocks/registry.ts";
import { BLOCK_GROUPS, groupEntries, matchesSearch, pickerGroups } from "../src/blocks/groups.ts";
import { STARTER_LIST } from "../src/blocks/help-text.ts";
import { treeProblem } from "../src/blocks/tree.ts";
import { expandContainer, unwrapContainers, unwrapList } from "../src/lib/db/unwrap.ts";
import { seedLegacyPage } from "./lib/legacy-containers.mjs";

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`PASS  ${name}`);
};

/* ---- 1. Registre et regroupement ------------------------------------------------------------- */

const catalog = blockCatalog();
const creatable = catalog.filter((c) => !c.hidden);

test("registre : tout bloc créable a un groupe connu et un rang", () => {
  const ids = new Set(BLOCK_GROUPS.map((g) => g.id));
  for (const c of creatable) {
    assert.ok(c.group && ids.has(c.group), `${c.key} : groupe ${c.group}`);
    assert.ok(Number.isInteger(c.order), `${c.key} : rang ${c.order}`);
  }
});
test("registre : aucune clé en double, aucun rang en double dans un groupe", () => {
  assert.equal(new Set(catalog.map((c) => c.key)).size, catalog.length);
  const seen = new Set();
  for (const c of creatable) {
    const k = `${c.group}:${c.order}`;
    assert.ok(!seen.has(k), `rang en double ${k} (${c.key})`);
    seen.add(k);
  }
});
test("registre : « Projet mis en avant » n'est plus créable (ancien type, encore rendu)", () => {
  assert.ok(BLOCKS["featured-project"].deprecated);
  assert.ok(catalog.find((c) => c.type === "featured-project").hidden);
  assert.ok(!creatable.some((c) => c.type === "featured-project" || /mis en avant/i.test(c.label)));
  assert.ok(!pickerGroups(catalog, STARTER_LIST).flatMap((g) => g.entries).some((e) => e.type === "featured-project"));
});
test("regroupement : ordre Texte, Projets, Images et vidéos, Grilles, Autres ; contenu attendu", () => {
  const groups = pickerGroups(catalog, STARTER_LIST);
  assert.deepEqual(groups.map((g) => g.label), ["Texte", "Projets", "Images et vidéos", "Grilles", "Autres"]);
  const names = (g) => [...g.starters, ...g.entries].map((e) => e.label);
  assert.deepEqual(names(groups[0]), ["Texte", "Titre", "Titre + texte"]);
  assert.deepEqual(names(groups[1]), ["Planche d'un projet"]);
  assert.deepEqual(names(groups[2]), ["Image", "Vidéo", "Planche libre"]);
  // Lot 27 : « Grille » et « Contact » proposent leurs modèles sous leur carte (pas de cartes à part).
  assert.deepEqual(names(groups[3]), ["Grille"]);
  assert.deepEqual(groups[3].entries[0].models.map((m) => m.short), ["Avec 3 images", "Avec des vidéos"]);
  assert.deepEqual(names(groups[4]), ["CV", "Profil", "Contact", "Lien vers une page", "Ouverture", "Entrées des collections"]);
  assert.deepEqual(groups[4].entries.find((e) => e.type === "contact").models.map((m) => m.key), ["contact-with-form"]);
  // Chaque composant créable (hors rich-text / section-title, remplacés par les trois raccourcis) apparaît une seule fois.
  const all = groups.flatMap((g) => g.entries.map((e) => e.key));
  assert.equal(new Set(all).size, all.length);
  assert.equal(all.length, creatable.filter((c) => !c.preset && c.type !== "rich-text" && c.type !== "section-title").length);
});
test("regroupement : groupEntries ignore les entrées masquées", () => {
  const g = groupEntries([{ group: "other", order: 2, hidden: true }, { group: "other", order: 1 }]);
  assert.equal(g.length, 1);
  assert.equal(g[0].entries.length, 1);
});
test("recherche : nom et description, sans accents ni casse, tous les mots", () => {
  const find = (q) => pickerGroups(catalog, STARTER_LIST, q).flatMap((g) => [...g.starters, ...g.entries].map((e) => e.label));
  assert.deepEqual(find("planche"), ["Planche d'un projet", "Planche libre"], "nom ou description");
  assert.ok(find("VIDEO").includes("Vidéo") && find("vidéo").includes("Grille"), "un type correspond aussi par ses modèles");
  assert.ok(find("ecrire").includes("Contact"), "description : « écrire »");
  assert.deepEqual(find("grille image"), ["Grille"], "tous les mots, dans nom + description");
  assert.ok(find("titre").includes("Titre + texte") && find("titre").includes("Titre"));
  assert.deepEqual(find("xyzzy"), []);
  const everything = creatable.filter((c) => !c.preset).length - 2 + STARTER_LIST.length; // rich-text et section-title sont remplacés par les trois raccourcis
  assert.equal(find("").length, everything, "requête vide : tout");
  assert.equal(find("   ").length, everything);
  assert.ok(matchesSearch({ label: "Éléphant", description: "" }, "elephant"));
});

/* ---- 2. Migration 0021 --------------------------------------------------------------------------- */

function freshDb() {
  const db = new Database(":memory:");
  const dir = new URL("../drizzle/", import.meta.url).pathname;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    for (const stmt of readFileSync(dir + f, "utf8").split("--> statement-breakpoint")) if (stmt.trim()) db.exec(stmt);
  }
  return db;
}
const T = (fr, en = fr) => ({ fr, en });
const kid = (uid, type, props = {}) => ({ uid, type, props });
const known = (t) => Boolean(BLOCKS[t]);
const strings = (v, out = new Set()) => {
  if (typeof v === "string") out.add(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (k !== "uid" && k !== "type") strings(x, out);
  return out;
};

/** Trois conteneurs réalistes : titre + planche + lien, images + texte (look et carte), grille dedans. */
const C1 = { project: "alpha", more: { label: T("Voir tous les projets", "See all projects"), pageId: 2 }, children: [kid("t1", "section-title", { eyebrow: T("Projet"), linked: true }), kid("b1", "project-board", { header: false })] };
const C2 = {
  project: "beta",
  look: { spaceTop: "l", spaceBottom: "s", radius: "soft", titleH: "center" },
  surface: { color: "primary12", width: "inset" },
  children: [
    kid("i1", "image", { mediaId: 1, caption: T("Légende image") }),
    kid("r1", "rich-text", { title: T("Un titre"), paragraphs: [T("Un paragraphe de texte.")], look: { spaceTop: "xl", radius: "strong" } }),
    kid("g1", "grid", { layout: "2", children: [kid("gb", "project-board", {}), kid("gt", "section-title", { linked: true, eyebrow: T("Dans la grille") }), kid("gv", "image", { mediaId: 2 })] }),
  ],
};
const C3 = { children: [kid("t3", "section-title", { title: T("Titre figé"), intro: T("Présentation figée") }), kid("b3", "project-board", { project: "gamma" })] };

function fixture() {
  const db = freshDb();
  const page = db.prepare("insert into pages (slug, title, meta, nav_order, published) values (?, ?, null, ?, 1)");
  page.run(JSON.stringify(T("")), JSON.stringify(T("Accueil")), null);
  page.run(JSON.stringify(T("perso", "chars")), JSON.stringify(T("Personnages")), 1);
  page.run(JSON.stringify(T("anim", "anim")), JSON.stringify(T("Animation")), 2);
  const put = db.prepare("insert into blocks (page_id, position, type, props) values (?, ?, ?, ?)");
  // Page 1 : intro, conteneur 1, contact, conteneur 2 (carte), conteneur 3
  const home = [
    ["rich-text", { paragraphs: [T("Intro")] }],
    ["featured-project", C1],
    ["contact", { eyebrow: T("c"), title: T("Contact"), intro: T("i"), cta: T("Écrire") }],
    ["featured-project", C2],
    ["featured-project", C3],
  ];
  home.forEach(([type, props], i) => put.run(1, i, type, JSON.stringify(props)));
  // Page 2 : un bloc illisible, un conteneur
  put.run(2, 0, "rich-text", "{pas du json");
  put.run(2, 1, "featured-project", JSON.stringify(C3));
  // Brouillon de la page 1 : même contenu avec uid de brouillon, plus un conteneur vide à lien, et un conteneur imbriqué dans un conteneur
  const draft = {
    title: T("Accueil"),
    blocks: [
      { uid: "d0", type: "rich-text", props: { paragraphs: [T("Intro")] } },
      { uid: "d1", type: "featured-project", props: JSON.parse(JSON.stringify(C1)) },
      { uid: "d2", type: "featured-project", props: { more: { label: T("Lien seul"), pageId: 3 }, children: [] } },
      { uid: "d3", type: "featured-project", props: { project: "delta", children: [kid("n1", "featured-project", { children: [kid("n2", "project-board", {})] }), kid("n3", "section-title", { linked: true })] } },
    ],
  };
  db.prepare("update pages set draft = ?, draft_rev = 4 where id = 1").run(JSON.stringify(draft));
  return db;
}
const published = (db, id) => db.prepare("select type, props from blocks where page_id = ? order by position").all(id).map((b) => ({ type: b.type, text: b.props, props: (() => { try { return JSON.parse(b.props); } catch { return null; } })() }));
const draftOf = (db, id) => JSON.parse(db.prepare("select draft from pages where id = ?").get(id).draft);

test("0021 : publié — plus de conteneur, enfants à la même place et dans le même ordre", () => {
  const db = fixture();
  const r = unwrapContainers(db);
  assert.equal(r.unwrapped, 7, "3 conteneurs publiés (accueil) + 1 (page 2) + 3 du brouillon (celui qui n'a qu'un lien aussi)");
  const home = published(db, 1);
  assert.deepEqual(
    home.map((b) => b.type),
    ["rich-text", "section-title", "project-board", "page-link", "contact", "image", "rich-text", "grid", "section-title", "project-board"],
  );
  assert.ok(!home.some((b) => b.type === "featured-project"));
  // Page 2 : le bloc illisible garde son texte exact
  const p2 = published(db, 2);
  assert.equal(p2[0].text, "{pas du json");
  assert.deepEqual(p2.map((b) => b.type), ["rich-text", "section-title", "project-board"]);
});
test("0021 : le projet du conteneur est porté en dur (Planche, Titre lié, dans la grille aussi), le lien est gardé", () => {
  const db = fixture();
  unwrapContainers(db);
  const [, title, board, link, , , , grid] = published(db, 1);
  assert.deepEqual(title.props, { eyebrow: T("Projet"), linked: true, project: "alpha" });
  assert.deepEqual(board.props, { header: false, project: "alpha" });
  assert.deepEqual(link.props, { label: T("Voir tous les projets", "See all projects"), pageId: 2 });
  const [gb, gt, gv] = grid.props.children;
  assert.equal(gb.props.project, "beta");
  assert.deepEqual(gt.props, { linked: true, eyebrow: T("Dans la grille"), project: "beta" });
  assert.equal("project" in gv.props, false, "une image n'a pas de projet");
  // Conteneur sans projet : titre figé et planche à projet propre, inchangés
  const last = published(db, 1).slice(-2);
  assert.deepEqual(last[0].props, { title: T("Titre figé"), intro: T("Présentation figée") });
  assert.deepEqual(last[1].props, { project: "gamma" });
});
test("0021 : look du conteneur (espaces aux extrémités, reste à chacun, le réglage du composant gagne) et carte", () => {
  const db = fixture();
  unwrapContainers(db);
  const [, , , , , image, text, grid] = published(db, 1);
  assert.deepEqual(image.props.look, { spaceTop: "l", radius: "soft", titleH: "center" }, "premier composant : espace du haut");
  assert.deepEqual(text.props.look, { spaceTop: "xl", radius: "strong", titleH: "center" }, "son propre espace et son arrondi gagnent");
  assert.deepEqual(grid.props.look, { spaceBottom: "s", radius: "soft", titleH: "center" }, "dernier composant : espace du bas");
  for (const b of [image, text, grid]) assert.deepEqual(b.props.surface, { color: "primary12", width: "inset" }, "carte du conteneur sur chaque composant");
  assert.equal("surface" in published(db, 1)[1].props, false, "pas de carte sans carte");
});
test("0021 : style du texte « voir plus » et carte du conteneur reportés sur le lien (plus sur les composants)", () => {
  const container = {
    type: "featured-project",
    props: {
      project: "alpha",
      more: { label: T("Voir plus"), pageId: 2 },
      look: { radius: "soft", text: { "more.label": { size: "l", italic: true }, title: { weight: 700 } } },
      surface: { color: "primary12", width: "inset" },
      children: [kid("k1", "rich-text", { paragraphs: [T("x")] })],
    },
  };
  const [text, link] = expandContainer(JSON.parse(JSON.stringify(container)), { draft: false, used: new Set() });
  assert.deepEqual(link.props.look, { text: { label: { size: "l", italic: true } } });
  assert.deepEqual(link.props.surface, { color: "primary12", width: "inset" });
  assert.deepEqual(text.props.look, { radius: "soft", text: { title: { weight: 700 } } }, "le style du lien ne reste pas sur le composant");
  // Sans style de lien ni carte : le lien reste nu.
  const bare = { type: "featured-project", props: { more: { label: T("Voir"), pageId: 2 }, children: [kid("k2", "rich-text", {})] } };
  const [, l2] = expandContainer(bare, { draft: false, used: new Set() });
  assert.equal("look" in l2.props || "surface" in l2.props, false);
});
test("0021 : brouillon — uid conservés et uniques, lien posé, conteneur imbriqué aplati, arbre valide, version augmentée", () => {
  const db = fixture();
  unwrapContainers(db);
  const d = draftOf(db, 1);
  assert.deepEqual(
    d.blocks.map((b) => b.type),
    ["rich-text", "section-title", "project-board", "page-link", "page-link", "project-board", "section-title"],
  );
  assert.deepEqual(d.blocks.slice(0, 3).map((b) => b.uid), ["d0", "t1", "b1"]);
  const uids = d.blocks.map((b) => b.uid);
  assert.equal(new Set(uids).size, uids.length);
  assert.ok(uids.every((u) => /^[a-z0-9-]{1,32}$/.test(u)));
  assert.equal(d.blocks[4].props.pageId, 3, "lien d'un conteneur vide gardé dans le brouillon");
  assert.equal(d.blocks[5].props.project, "delta", "composant du conteneur imbriqué : projet du conteneur extérieur");
  assert.equal(d.blocks[6].props.project, "delta");
  assert.equal(treeProblem(d.blocks, known), null);
  assert.equal(db.prepare("select draft_rev r from pages where id = 1").get().r, 5);
  assert.equal(d.title.fr, "Accueil", "le reste du brouillon est intact");
});
test("0021 : aucun texte perdu (publié et brouillon)", () => {
  const before = fixture();
  const after = fixture();
  unwrapContainers(after);
  for (const id of [1, 2]) {
    const was = strings(published(before, id).map((b) => b.props));
    const now = strings(published(after, id).map((b) => b.props));
    for (const s of was) assert.ok(now.has(s), `page ${id} : « ${s} » perdu`);
  }
  const was = strings(draftOf(before, 1));
  const now = strings(draftOf(after, 1));
  for (const s of was) assert.ok(now.has(s), `brouillon : « ${s} » perdu`);
});
test("0021 : conteneur vide en version publiée — disparaît avec son lien (il n'affichait rien)", () => {
  const db = freshDb();
  db.prepare("insert into pages (slug, title, meta, nav_order, published) values ('{}', '{}', null, null, 1)").run();
  db.prepare("insert into blocks (page_id, position, type, props) values (1, 0, 'featured-project', ?)").run(JSON.stringify({ more: { label: T("x"), pageId: 1 }, children: [] }));
  unwrapContainers(db);
  assert.equal(published(db, 1).length, 0);
});
test("0021 : idempotente — second passage sans effet, base identique", () => {
  const db = fixture();
  unwrapContainers(db);
  const snap = JSON.stringify([db.prepare("select * from blocks order by id").all(), db.prepare("select id, draft, draft_rev from pages order by id").all()]);
  const again = unwrapContainers(db);
  assert.deepEqual(again, { pages: 0, published: 0, drafts: 0, unwrapped: 0, kept: 0 });
  assert.equal(JSON.stringify([db.prepare("select * from blocks order by id").all(), db.prepare("select id, draft, draft_rev from pages order by id").all()]), snap);
});
test("0021 : base sans conteneur — rien ne bouge", () => {
  const db = freshDb();
  db.prepare("insert into pages (slug, title, meta, nav_order, published) values ('{}', '{}', null, null, 1)").run();
  db.prepare("insert into blocks (page_id, position, type, props) values (1, 0, 'rich-text', ?)").run(JSON.stringify({ paragraphs: [T("a")] }));
  assert.deepEqual(unwrapContainers(db), { pages: 0, published: 0, drafts: 0, unwrapped: 0, kept: 0 });
});
test("0021 : plus de 40 blocs une fois déballé — le conteneur reste en place (encore lu), journalisé", () => {
  const big = { children: Array.from({ length: 24 }, (_, i) => kid(`k${i}`, "image", { mediaId: 1 })) };
  const list = [{ type: "featured-project", props: big }, { type: "featured-project", props: big }, { type: "rich-text", props: { paragraphs: [T("a")] } }];
  const r = unwrapList(list, false);
  assert.equal(r.unwrapped, 1);
  assert.equal(r.kept, 1);
  assert.equal(r.blocks.length, 24 + 1 + 1);
  assert.equal(r.blocks.at(-2).type, "featured-project");
  assert.equal(unwrapList(r.blocks, false).blocks.length, 26, "second passage : même issue");
});

/* ---- 3. Démarrage : base v0.18 réaliste, seed complet --------------------------------------------- */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dataDir = mkdtempSync(path.join(tmpdir(), "composants-"));
process.env.DATA_DIR = dataDir;
const { bootstrap } = await import("../src/lib/db/bootstrap.ts");
const { getSqlite } = await import("../src/lib/db/index.ts");
await bootstrap();
const live = getSqlite();

test("seed : l'accueil neuf n'a plus de conteneur (Titre, deux Planches à projet en dur, lien « voir plus »)", () => {
  const home = live.prepare("select type, props from blocks where page_id = (select id from pages order by id limit 1) order by position").all().map((b) => ({ type: b.type, props: JSON.parse(b.props) }));
  assert.ok(!home.some((b) => b.type === "featured-project"), home.map((b) => b.type).join());
  const types = home.map((b) => b.type);
  const i = types.indexOf("section-title");
  assert.deepEqual(types.slice(i, i + 4), ["section-title", "project-board", "project-board", "page-link"]);
  assert.ok(home[i + 1].props.project && home[i + 2].props.project, "planches à projet en dur");
  assert.ok(home[i + 3].props.pageId > 0 && home[i + 3].props.label.fr);
});

// Retour à une base v0.18 : migrations 0021 (déballage), 0022 (colonne pages.collection), 0023 (fusion des rubriques) et
// 0024 (colonnes de la corbeille) à rejouer.
live.prepare("delete from __drizzle_migrations where created_at >= 1791766309564").run();
live.exec("DROP INDEX pages_collection_unique; ALTER TABLE pages DROP COLUMN collection;");
live.exec("DROP TABLE IF EXISTS wallpapers;"); // 0026 (lot 35) : rejouée avec les migrations qui suivent 0020
live.exec("ALTER TABLE media DROP COLUMN deleted_at; ALTER TABLE pages DROP COLUMN deleted_at; ALTER TABLE pages DROP COLUMN trashed_in_menu; ALTER TABLE projects DROP COLUMN deleted_at;");
// 0025 (contenu de planche, lot 31) : colonnes de projet à rejouer aussi.
live.exec("ALTER TABLE projects DROP COLUMN layout; ALTER TABLE projects DROP COLUMN draft_layout; ALTER TABLE projects DROP COLUMN draft_layout_page_id;");
const legacy = seedLegacyPage(live);
test("démarrage : base v0.18 (migrations jusqu'à 0020 faites) avec trois conteneurs publiés + un brouillon", () => {
  assert.equal(live.prepare("select count(*) n from blocks where page_id = ? and type = 'featured-project'").get(legacy.id).n, 3);
  assert.equal((live.prepare("select draft from pages where id = ?").get(legacy.id).draft.match(/"featured-project"/g) ?? []).length, 3);
});
await bootstrap();
const afterBoot = JSON.stringify([live.prepare("select * from blocks order by id").all(), live.prepare("select id, draft, draft_rev from pages order by id").all()]);
test("démarrage : 0021 jouée par le migrateur — conteneurs déballés (publié et brouillon), arbre valide", () => {
  const types = live.prepare("select type from blocks where page_id = ? order by position").all(legacy.id).map((b) => b.type);
  assert.deepEqual(types, ["rich-text", "section-title", "project-board", "page-link", "rich-text", "image", "rich-text", "grid", "section-title", "project-board"]);
  const draft = JSON.parse(live.prepare("select draft from pages where id = ?").get(legacy.id).draft);
  assert.deepEqual(draft.blocks.map((b) => b.type), ["rich-text", "section-title", "project-board", "page-link", "rich-text", "rich-text", "image", "rich-text", "grid", "section-title", "project-board"]);
  assert.equal(treeProblem(draft.blocks, known), null);
  assert.equal(live.prepare("select count(*) n from __drizzle_migrations where created_at = 1791766309564").get().n, 1);
});
await bootstrap();
test("démarrage suivant : rien ne bouge (migration une seule fois, base identique)", () => {
  assert.equal(JSON.stringify([live.prepare("select * from blocks order by id").all(), live.prepare("select id, draft, draft_rev from pages order by id").all()]), afterBoot);
});

import { rmSync } from "node:fs";
rmSync(dataDir, { recursive: true, force: true });

console.log(`\n${passed} test(s) OK`);
