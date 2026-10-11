#!/usr/bin/env node
/**
 * v0.13 — tests unitaires (inclus dans npm test) :
 *  1. Arbre de blocs (src/blocks/tree.ts) : forme validée (conteneurs, types
 *     acceptés, deux niveaux, 24 composants, uid), insertion / déplacement /
 *     sortie, planches imbriquées et projet hérité (correction I1), compteurs.
 *  2. Migration de contenu 0014 (src/lib/db/upgrade.ts) sur une base SQLite en
 *     mémoire (migrations SQL du dépôt) : publié ET brouillon, idempotente,
 *     listes figées dans l'état du moment, filtre de métier pour un projet mixte.
 *  3. Données du site (src/lib/site-schema.ts) : liens http(s)/mailto seulement,
 *     reconnaissance du réseau, bornes.
 * Usage : node --import tsx scripts/test-containers.mjs
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

import Database from "better-sqlite3";

import {
  boardRefs,
  blockAtPath,
  canPlace,
  errorPath,
  insertBlock,
  locate,
  MAX_CHILDREN,
  moveBlock,
  pageCounts,
  removeBlock,
  treeProblem,
  withFreshUids,
} from "../src/blocks/tree.ts";
import { renameVideoLook, upgradeContent } from "../src/lib/db/upgrade.ts";
import { defaultContactForm, makeField, validateSubmission, ContactFormSchema } from "../src/lib/contact-form.ts";
import { canonicalSnap, detectNetwork, NavItemSchema, safeNavHref, safeSocialHref, SiteSnapSchema, SocialSchema } from "../src/lib/site-schema.ts";

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`PASS  ${name}`);
};
const KNOWN = new Set(["featured-project", "grid", "section-title", "project-board", "image", "rich-text", "video-single", "cv", "hero", "contact", "collection-intro"]);
const known = (t) => KNOWN.has(t);
const kid = (uid, type, props = {}) => ({ uid, type, props });

/* ---- 1. Arbre ------------------------------------------------------------- */

test("forme : conteneur valide, composants acceptés", () => {
  const blocks = [{ uid: "c1", type: "featured-project", props: { project: "p", children: [kid("t", "section-title"), kid("b", "project-board")] } }];
  assert.equal(treeProblem(blocks, known), null);
});
test("forme : type refusé dans un conteneur (ouverture, contact)", () => {
  assert.match(treeProblem([{ uid: "c", type: "featured-project", props: { children: [kid("h", "hero")] } }], known), /n'accepte pas/);
  assert.match(treeProblem([{ uid: "c", type: "grid", props: { children: [kid("x", "contact")] } }], known), /n'accepte pas/);
});
test("forme : grille dans un projet mis en avant OK ; conteneur dans une grille refusé ; 3 niveaux refusés", () => {
  const ok = [{ uid: "c", type: "featured-project", props: { children: [kid("g", "grid", { children: [kid("v", "video-single")] })] } }];
  assert.equal(treeProblem(ok, known), null);
  assert.match(treeProblem([{ uid: "g", type: "grid", props: { children: [kid("f", "featured-project")] } }], known), /n'accepte pas/);
  assert.match(treeProblem([{ uid: "g", type: "grid", props: { children: [kid("g2", "grid")] } }], known), /n'accepte pas/);
});
test("forme : bloc CV (lot 3) accepté dans une grille et dans un projet mis en avant", () => {
  assert.equal(treeProblem([{ uid: "g", type: "grid", props: { children: [kid("cv", "cv")] } }], known), null);
  assert.equal(treeProblem([{ uid: "c", type: "featured-project", props: { children: [kid("cv", "cv"), kid("g", "grid", { children: [kid("cv2", "cv")] })] } }], known), null);
});
test("forme : composants bornés, uid obligatoires, uniques, bien formés", () => {
  const many = Array.from({ length: MAX_CHILDREN + 1 }, (_, i) => kid(`k${i}`, "image"));
  assert.match(treeProblem([{ uid: "g", type: "grid", props: { children: many } }], known), /au plus/);
  assert.match(treeProblem([{ uid: "g", type: "grid", props: { children: [{ type: "image", props: {} }] } }], known), /Identifiant/);
  assert.match(treeProblem([{ uid: "g", type: "grid", props: { children: [kid("g", "image")] } }], known), /double/);
  assert.match(treeProblem([{ uid: "g", type: "grid", props: { children: [kid("<x>", "image")] } }], known), /Identifiant/);
  assert.match(treeProblem([{ uid: "g", type: "grid", props: { children: "nope" } }], known), /illisibles/);
  assert.match(treeProblem([{ uid: "g", type: "grid", props: { children: [kid("a", "inconnu")] } }], known), /inconnu/);
});
test("forme : un bloc simple ne porte pas de composants (même vide)", () => {
  assert.match(treeProblem([{ uid: "r", type: "rich-text", props: { children: [] } }], known), /Seul un conteneur/);
  assert.match(treeProblem([{ uid: "g", type: "grid", props: { children: [kid("i", "image", { children: [] })] } }], known), /Seul un conteneur/);
});
test("opérations : insérer dans, refuser, déplacer entre page et conteneur, sortir", () => {
  let blocks = [{ uid: "a", type: "rich-text", props: {} }, { uid: "c", type: "featured-project", props: { children: [] } }, { uid: "h", type: "hero", props: {} }];
  blocks = insertBlock(blocks, kid("i", "image"), "c", 0);
  assert.equal(blocks[1].props.children[0].uid, "i");
  assert.equal(insertBlock(blocks, kid("x", "hero"), "c", 0), null, "ouverture refusée");
  assert.equal(moveBlock(blocks, "h", "c", 0), null, "bloc de page non accepté : refusé");
  blocks = moveBlock(blocks, "a", "c", 1);
  assert.deepEqual(blocks.map((b) => b.uid), ["c", "h"]);
  assert.deepEqual(blocks[0].props.children.map((b) => b.uid), ["i", "a"]);
  assert.deepEqual(locate(blocks, "a"), { parent: "c", index: 1, depth: 1 });
  blocks = moveBlock(blocks, "i", null, 1); // sortir, juste après le conteneur
  assert.deepEqual(blocks.map((b) => b.uid), ["c", "i", "h"]);
  assert.equal(moveBlock(blocks, "c", "c", 0), null, "un conteneur ne va pas en lui-même");
  assert.deepEqual(removeBlock(blocks, "a")[0].props.children, []);
});
test("opérations : grille + projet mis en avant (2 niveaux), pas plus", () => {
  let blocks = [{ uid: "c", type: "featured-project", props: { children: [] } }];
  const grid = { uid: "g", type: "grid", props: { children: [kid("v", "video-single")] } };
  blocks = insertBlock(blocks, grid, "c", 0);
  assert.ok(blocks);
  assert.equal(canPlace(blocks, kid("x", "grid"), "g"), false);
  const copy = withFreshUids(grid, (() => {
    let n = 0;
    return () => `n${n++}`;
  })());
  assert.deepEqual([copy.uid, copy.props.children[0].uid], ["n0", "n1"]);
});
test("planches : imbriquées comptées, projet hérité du conteneur (correction I1)", () => {
  const blocks = [
    { type: "project-board", props: { project: "a" } },
    { type: "featured-project", props: { project: "b", children: [kid("t", "section-title", { linked: true }), kid("p", "project-board")] } },
    { type: "featured-project", props: { project: "c", children: [kid("t2", "section-title")] } },
    { type: "featured-project", props: { children: [kid("g", "grid", { children: [kid("p2", "project-board", { project: "d", collection: "characters" })] })] } },
  ];
  // « c » : conteneur sans planche → ses images ne sont pas sur la page.
  assert.deepEqual(boardRefs(blocks).map((b) => `${b.slug}${b.collection ? `/${b.collection}` : ""}`), ["a", "b", "d/characters"]);
});
test("compteurs : M planches présentes, N œuvres affichées (places vides exclues)", () => {
  const blocks = [
    { type: "project-board", props: { project: "a" } },
    { type: "featured-project", props: { project: "b", children: [kid("p", "project-board"), kid("q", "project-board", { project: "absent" })] } },
  ];
  const shown = (slug) => ({ a: 3, b: 2 })[slug] ?? null;
  assert.deepEqual(pageCounts(blocks, shown), { works: 5, projects: 2 });
  assert.deepEqual(pageCounts([], shown), { works: 0, projects: 0 });
});
test("chemins d'erreur : bloc ↔ « blocks.1.props.children.0 »", () => {
  const child = kid("p", "project-board");
  const blocks = [{ type: "hero", props: {} }, { uid: "c", type: "featured-project", props: { children: [child] } }];
  assert.equal(errorPath(blocks, child), "blocks.1.props.children.0");
  assert.equal(blockAtPath(blocks, "blocks.1.props.children.0.props.project"), child);
  assert.equal(blockAtPath(blocks, "blocks.1.props.more.pageId").uid, "c");
  assert.equal(blockAtPath(blocks, "title.fr"), null);
});

/* ---- 2. Migration 0014 ------------------------------------------------------ */

function freshDb() {
  const db = new Database(":memory:");
  const dir = new URL("../drizzle/", import.meta.url).pathname;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    for (const stmt of readFileSync(dir + f, "utf8").split("--> statement-breakpoint")) if (stmt.trim()) db.exec(stmt);
  }
  return db;
}
const L = (fr) => JSON.stringify({ fr, en: fr });
function fixture() {
  const db = freshDb();
  const media = db.prepare("insert into media (kind, key, original_name, mime, size, status, width, height) values (?, ?, ?, ?, 1, 'ready', 100, 100)");
  for (let i = 1; i <= 8; i++) media.run(i === 8 ? "video" : "image", `k${i}`, `m${i}`, i === 8 ? "video/mp4" : "image/png");
  const project = db.prepare("insert into projects (slug, title, context, description, year, featured, position) values (?, ?, ?, ?, '2024', ?, ?)");
  project.run("alpha", L("Alpha"), L(""), L(""), 1, 0);
  project.run("beta", L("Beta"), L(""), L(""), 0, 1);
  project.run("gamma", L("Gamma"), L(""), L(""), 1, 2);
  const slot = db.prepare("insert into slots (project_id, position, media_id, slug, collection, title, description, year, reel) values (?, ?, ?, ?, ?, ?, ?, 2024, ?)");
  slot.run(1, 0, 1, "a1", "characters", L("a1"), L(""), 0);
  slot.run(1, 1, 2, "a2", "backgrounds", L("a2"), L(""), 0); // alpha : projet mixte
  slot.run(2, 0, 3, "b1", "characters", L("b1"), L(""), 0);
  slot.run(3, 0, 4, "g1", "animation", L("g1"), L(""), 1); // demoreel
  slot.run(3, 1, 5, "g2", "animation", L("g2"), L(""), 0);
  slot.run(3, 2, 6, "g3", "animation", L("g3"), L(""), 0);
  const page = db.prepare("insert into pages (slug, title, meta, nav_order, published) values (?, ?, null, ?, 1)");
  page.run(JSON.stringify({ fr: "", en: "" }), L("Accueil"), null);
  page.run(JSON.stringify({ fr: "perso", en: "chars" }), L("Personnages"), 1);
  page.run(JSON.stringify({ fr: "anim", en: "anim" }), L("Animation"), 2);
  const block = db.prepare("insert into blocks (page_id, position, type, props) values (?, ?, ?, ?)");
  const featured = { eyebrow: { fr: "Projets", en: "Projects" }, title: { fr: "Deux", en: "Two" }, intro: { fr: "Intro", en: "Intro" }, limit: 2, more: { label: { fr: "Voir", en: "See" }, pageId: 2 } };
  block.run(1, 0, "hero", JSON.stringify({ eyebrow: { fr: "x", en: "x" }, statement: { fr: "", en: "" } }));
  block.run(1, 1, "featured-projects", JSON.stringify(featured));
  block.run(2, 0, "collection-intro", JSON.stringify({ collection: "characters", eyebrow: { fr: "", en: "" }, title: { fr: "", en: "" }, intro: { fr: "", en: "" } }));
  block.run(2, 1, "collection-projects", JSON.stringify({ collection: "characters" }));
  block.run(3, 0, "video", JSON.stringify({ reelEyebrow: { fr: "Reel", en: "Reel" }, cardsEyebrow: { fr: "Plans", en: "Shots" }, cardsTitle: { fr: "Extraits", en: "Excerpts" } }));
  // Brouillon de l'accueil : même ancien bloc, uid du brouillon.
  db.prepare("update pages set draft = ? where id = 1").run(JSON.stringify({ title: { fr: "Accueil", en: "Home" }, blocks: [{ uid: "b0", type: "hero", props: {} }, { uid: "b1", type: "featured-projects", props: featured }] }));
  return db;
}
const blocksOf = (db, page) => db.prepare("select type, props from blocks where page_id = ? order by position").all(page).map((b) => ({ type: b.type, props: JSON.parse(b.props) }));

test("migration : « Projets mis en avant » → conteneur, mêmes textes, projets figés, alternance gardée", () => {
  const db = fixture();
  assert.equal(upgradeContent(db), 3);
  const [hero, c] = blocksOf(db, 1);
  assert.equal(hero.type, "hero");
  assert.equal(c.type, "featured-project");
  assert.equal(c.props.project, "alpha", "premier projet « mis en avant »");
  assert.deepEqual(c.props.more, { label: { fr: "Voir", en: "See" }, pageId: 2 });
  assert.deepEqual(c.props.children.map((k) => k.type), ["section-title", "project-board", "project-board"]);
  assert.deepEqual(c.props.children[0].props, { eyebrow: { fr: "Projets", en: "Projects" }, title: { fr: "Deux", en: "Two" }, intro: { fr: "Intro", en: "Intro" } });
  assert.deepEqual(c.props.children[1].props, { deep: true }, "1re planche : projet hérité du conteneur, fond profond");
  assert.deepEqual(c.props.children[2].props, { project: "gamma", deep: false });
  assert.equal(treeProblem([c], known), null);
});
test("migration : « Planches d'une collection » → une planche par projet, filtre si projet mixte", () => {
  const db = fixture();
  upgradeContent(db);
  const blocks = blocksOf(db, 2);
  assert.deepEqual(blocks.map((b) => b.type), ["collection-intro", "project-board", "project-board"]);
  assert.deepEqual(blocks[1].props, { project: "alpha", deep: false, collection: "characters" });
  assert.deepEqual(blocks[2].props, { project: "beta", deep: true });
});
test("migration : ancienne vitrine vidéo → grille 1 grand (demoreel) + grille 2 (plans)", () => {
  const db = fixture();
  upgradeContent(db);
  const [reel, cards] = blocksOf(db, 3);
  assert.equal(reel.props.layout, "1");
  assert.equal(reel.props.top, "none");
  assert.deepEqual({ ...reel.props.children[0].props }, { variant: "feature", mode: "player", eyebrow: { fr: "Reel", en: "Reel" }, slot: "g1" });
  assert.equal(cards.props.layout, "2");
  assert.equal(cards.props.top, "gap");
  assert.deepEqual(cards.props.title, { fr: "Extraits", en: "Excerpts" });
  assert.deepEqual(cards.props.children.map((k) => k.props.slot), ["g2", "g3"]);
});
test("migration : brouillons convertis aussi, uid uniques et bien formés", () => {
  const db = fixture();
  upgradeContent(db);
  const draft = JSON.parse(db.prepare("select draft from pages where id = 1").get().draft);
  assert.deepEqual(draft.blocks.map((b) => b.type), ["hero", "featured-project"]);
  assert.equal(draft.title.fr, "Accueil", "le reste du brouillon est gardé");
  assert.equal(treeProblem(draft.blocks, known), null);
});
test("migration : menu en réglage `nav` depuis l'ordre des pages ; idempotente", () => {
  const db = fixture();
  upgradeContent(db);
  assert.deepEqual(JSON.parse(db.prepare("select value from settings where key = 'nav'").get().value), [{ kind: "page", pageId: 2 }, { kind: "page", pageId: 3 }]);
  const before = JSON.stringify([blocksOf(db, 1), blocksOf(db, 2), blocksOf(db, 3), db.prepare("select draft from pages").all()]);
  assert.equal(upgradeContent(db), 0, "deuxième passage : rien à convertir");
  assert.equal(JSON.stringify([blocksOf(db, 1), blocksOf(db, 2), blocksOf(db, 3), db.prepare("select draft from pages").all()]), before);
});
test("migration : uid créés uniques même avec des uid longs au même début (préfixe tronqué)", () => {
  const db = fixture();
  const long = "abcdefghijklmnopqrstu"; // 21 caractères : tronqués à 20, collision possible sans compteur
  const fp = JSON.parse(db.prepare("select props from blocks where type = 'featured-projects'").get().props);
  db.prepare("update pages set draft = ? where id = 1").run(
    JSON.stringify({ title: { fr: "A", en: "A" }, blocks: [{ uid: `${long}1`, type: "featured-projects", props: fp }, { uid: `${long}2`, type: "featured-projects", props: fp }] }),
  );
  upgradeContent(db);
  const draft = JSON.parse(db.prepare("select draft from pages where id = 1").get().draft);
  assert.equal(treeProblem(draft.blocks, known), null, "uid uniques et bien formés");
});
test("migration : collection très fournie → planches regroupées, jamais plus de 40 blocs, rendu sans boîte", () => {
  const db = fixture();
  const project = db.prepare("insert into projects (slug, title, context, description, year, featured, position) values (?, ?, ?, ?, '2024', 0, ?)");
  const slot = db.prepare("insert into slots (project_id, position, media_id, slug, collection, title, description, year, reel) values (?, 0, 1, ?, 'characters', ?, ?, 2024, 0)");
  for (let i = 0; i < 60; i++) {
    const id = project.run(`p${i}`, L(`P${i}`), L(""), L(""), 10 + i).lastInsertRowid;
    slot.run(id, `p${i}-s`, L(""), L(""));
  }
  upgradeContent(db);
  const blocks = blocksOf(db, 2);
  assert.ok(blocks.length <= 40, `${blocks.length} blocs`);
  const boards = blocks.flatMap((b) => (b.type === "project-board" ? [b.props.project] : b.type === "featured-project" ? b.props.children.map((c) => c.props.project) : []));
  assert.equal(boards.length, 62, "toutes les planches, dans l'ordre");
  assert.deepEqual(boards.slice(0, 2), ["alpha", "beta"]);
  const containers = blocks.filter((b) => b.type === "featured-project");
  assert.ok(containers.length >= 1 && containers.every((c) => !c.props.project && c.props.children.length <= 24));
  assert.equal(treeProblem(blocks.map((b, i) => ({ uid: `t${i}`, ...b })), known), null);
});
test("migration : base neuve (avant le seed) → pas de menu vide figé", () => {
  const db = freshDb();
  upgradeContent(db);
  assert.equal(db.prepare("select value from settings where key = 'nav'").get(), undefined);
});

test("0016 : présentation du bloc Vidéo look → variant (publié, composants, brouillon), réglages du lot 2 gardés, idempotente", () => {
  const db = new Database(":memory:");
  db.exec("create table blocks (id integer primary key, page_id integer, position integer, type text, props text); create table pages (id integer primary key, draft text)");
  db.prepare("insert into blocks (page_id, position, type, props) values (1, 0, 'video-single', ?)").run(JSON.stringify({ look: "feature", mode: "player" }));
  db.prepare("insert into blocks (page_id, position, type, props) values (1, 1, 'grid', ?)").run(JSON.stringify({ children: [kid("v", "video-single", { look: "plain" }), kid("i", "image", { look: { spaceTop: "m" } })] }));
  db.prepare("insert into blocks (page_id, position, type, props) values (1, 2, 'video-single', ?)").run(JSON.stringify({ variant: "card", look: { spaceTop: "s" } }));
  db.prepare("insert into pages (id, draft) values (1, ?)").run(JSON.stringify({ blocks: [{ uid: "a", type: "video-single", props: { look: "card" } }] }));
  assert.equal(renameVideoLook(db), 3);
  const rows = db.prepare("select props from blocks order by position").all().map((r) => JSON.parse(r.props));
  assert.deepEqual(rows[0], { mode: "player", variant: "feature" });
  assert.deepEqual(rows[1].children[0].props, { variant: "plain" });
  assert.deepEqual(rows[1].children[1].props, { look: { spaceTop: "m" } });
  assert.deepEqual(rows[2], { variant: "card", look: { spaceTop: "s" } });
  assert.deepEqual(JSON.parse(db.prepare("select draft from pages").get().draft).blocks[0].props, { variant: "card" });
  assert.equal(renameVideoLook(db), 0);
});

/* ---- 3. Données du site ----------------------------------------------------- */
test("site : headerSocials false ≡ absent (forme canonique, aucun brouillon fantôme)", () => {
  const id = { name: "A", role: { fr: "", en: "" }, email: "", credit: { fr: "", en: "" } };
  const snap = (identity) => ({ identity, nav: [], socials: [] });
  assert.equal(JSON.stringify(canonicalSnap(snap({ ...id, headerSocials: false }))), JSON.stringify(canonicalSnap(snap(id))));
  assert.notEqual(JSON.stringify(canonicalSnap(snap({ ...id, headerSocials: true }))), JSON.stringify(canonicalSnap(snap(id))));
});

test("liens de réseau : https/http et mailto seulement", () => {
  for (const ok of ["https://www.instagram.com/x", "http://exemple.fr/a", "mailto:moi@exemple.fr"]) assert.ok(safeSocialHref(ok), ok);
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://x.fr", "//evil.example", "mailto:pas-une-adresse", "https://user:pw@x.fr", "vbscript:x", " javascript:alert(1)"])
    assert.ok(!safeSocialHref(bad), bad);
  assert.equal(SocialSchema.safeParse({ label: "X", href: "https://x.com/a".padEnd(301, "a") }).success, false, "longueur bornée");
});
test("liens de réseau (audit M-6) : mailto sans paramètres, ni espaces ni caractères de contrôle (même encodés)", () => {
  for (const bad of [
    "mailto:a@b.fr?bcc=x@y.z",
    "mailto:a@b.fr?body=salut",
    "mailto:a@b.fr%0ABcc:x@y.z",
    "https://x.fr/a b",
    "https://x.fr/%0d%0aSet-Cookie:x",
    "https://x.fr/%00",
    "https://x.fr/\u0007",
  ])
    assert.ok(!safeSocialHref(bad), bad);
  assert.ok(safeSocialHref("https://x.fr/a%C3%A9"), "accent encodé accepté");
  assert.equal(SocialSchema.safeParse({ label: "Instagram", href: "#" }).success, true, "lien « à compléter » gardé (jamais publié)");
});
test("liens du menu : chemin du site ou http(s), jamais d'autre schéma ni l'administration ou l'API", () => {
  for (const ok of ["/fr/decors", "/", "https://boutique.example.org/"]) assert.ok(safeNavHref(ok), ok);
  for (const bad of ["//evil.example", "javascript:alert(1)", "/../admin", "data:,x", "fr/decors", "/admin", "/admin/pages", "/api/contact", "/API/x", "/media/x", "/fr/a b"]) assert.ok(!safeNavHref(bad), bad);
  assert.equal(NavItemSchema.safeParse({ kind: "link", href: "https://a.fr", label: { fr: "A", en: "A" }, extra: 1 }).success, false, "champ arbitraire refusé");
});
test("reconnaissance du réseau d'après l'adresse (sans la réécrire)", () => {
  assert.equal(detectNetwork("https://www.instagram.com/camille"), "instagram");
  assert.equal(detectNetwork("https://twitter.com/c"), "x");
  assert.equal(detectNetwork("https://camille.bsky.social"), "bluesky");
  assert.equal(detectNetwork("https://youtu.be/abc"), "youtube");
  assert.equal(detectNetwork("https://ko-fi.com/c"), "kofi");
  assert.equal(detectNetwork("https://evilinstagram.com/c"), "website", "un domaine qui ressemble n'est pas le réseau");
  assert.equal(detectNetwork("mailto:a@b.fr"), "email");
  assert.equal(detectNetwork("pas une url"), null);
});
test("instantané du site : 12 liens et 12 réseaux au plus, champs stricts", () => {
  const base = { identity: { name: "C", role: { fr: "", en: "" }, email: "", credit: { fr: "", en: "" } }, nav: [], socials: [] };
  assert.ok(SiteSnapSchema.safeParse(base).success);
  const s = { label: "S", href: "https://s.fr" };
  assert.equal(SiteSnapSchema.safeParse({ ...base, socials: Array(13).fill(s) }).success, false);
  assert.equal(SiteSnapSchema.safeParse({ ...base, nav: Array(13).fill({ kind: "page", pageId: 1 }) }).success, false);
  assert.equal(SiteSnapSchema.safeParse({ ...base, admin: true }).success, false);
  assert.equal(SiteSnapSchema.safeParse({ ...base, identity: { ...base.identity, name: "" } }).success, false);
});

/* ---- 4. Formulaire de contact ------------------------------------------------ */

const form = ContactFormSchema.parse({
  ...defaultContactForm(),
  fields: [...defaultContactForm().fields, { ...makeField("select"), id: "fsujet", required: true }],
});
test("formulaire : envoi valide, libellés de la langue, adresse de réponse", () => {
  const r = validateSubmission(form, { fname: "Lou", femail: "lou@exemple.fr", fmessage: "Bonjour\nça va ?", fsujet: "Projet" }, "fr");
  assert.equal(r.ok, true);
  assert.equal(r.replyTo, "lou@exemple.fr");
  assert.deepEqual(r.values.map((v) => v.label), ["Ton nom", "Ton e-mail", "Ton message", "Sujet"]);
});
test("formulaire : champ inconnu, objet, tableau → refusés", () => {
  assert.equal(validateSubmission(form, { fname: "a", femail: "a@b.fr", fmessage: "m", fsujet: "Projet", admin: "1" }, "fr").field, "admin");
  assert.equal(validateSubmission(form, [], "fr").ok, false);
  assert.equal(validateSubmission(form, { femail: ["a@b.fr"], fmessage: "m", fsujet: "Projet" }, "fr").ok, false);
  assert.equal(validateSubmission(form, { __proto__: { x: 1 }, femail: "a@b.fr", fmessage: "m", fsujet: "Projet" }, "fr").ok, true, "prototype ignoré, pas de champ fantôme");
});
test("formulaire : obligatoires, longueurs, e-mail, choix strict, saut de ligne hors texte long", () => {
  const base = { femail: "a@b.fr", fmessage: "m", fsujet: "Projet" };
  assert.equal(validateSubmission(form, { ...base, femail: "" }, "fr").error, "Champ obligatoire.");
  assert.equal(validateSubmission(form, { ...base, fmessage: "x".repeat(4001) }, "fr").error, "Texte trop long.");
  assert.equal(validateSubmission(form, { ...base, femail: "pas-une-adresse" }, "fr").error, "Adresse e-mail invalide.");
  assert.equal(validateSubmission(form, { ...base, fsujet: "<script>" }, "fr").error, "Choix invalide.");
  assert.equal(validateSubmission(form, { ...base, fname: "a\nb" }, "fr").error, "Valeur invalide.");
});
test("formulaire : définition bornée (12 champs, un seul champ de réponse, ids)", () => {
  const f = defaultContactForm();
  assert.equal(ContactFormSchema.safeParse({ ...f, fields: Array.from({ length: 13 }, (_, i) => ({ ...makeField("text"), id: `f${i}` })) }).success, false);
  assert.equal(ContactFormSchema.safeParse({ ...f, fields: [{ ...makeField("email"), id: "fa", reply: true }, { ...makeField("email"), id: "fb", reply: true }] }).success, false);
  assert.equal(ContactFormSchema.safeParse({ ...f, fields: [{ ...makeField("text"), id: "../x" }] }).success, false);
});

console.log(`\n${passed} test(s) OK`);
