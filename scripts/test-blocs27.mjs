#!/usr/bin/env node
/**
 * v0.20 (lot 27, « blocs ») — tests unitaires (inclus dans npm test) :
 *  1. Champs facultatifs : table optional-fields.ts (ajout, retrait, drapeau inversé), opérations de la toile
 *     acceptées par le protocole.
 *  2. Registre : « Formulaire de contact » fusionné dans « Contact » (modèle de départ), Grille et ses modèles,
 *     Ouverture une seule fois, aucun type ancien proposé ni créable.
 *  3. Migration 0023 (src/lib/db/blocs.ts) sur une base SQLite en mémoire : formulaire → Contact (même formId,
 *     mêmes champs), champs vides retirés (Grille, Contact, Profil, CV ; publié, brouillons, composants), aucun texte
 *     perdu, draft_rev + 1, idempotente ; anciens blocs rejoués.
 * Usage : node --import tsx scripts/test-blocs27.mjs
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

import Database from "better-sqlite3";

import { BLOCKS, blockCatalog } from "../src/blocks/registry.ts";
import { pickerGroups } from "../src/blocks/groups.ts";
import { STARTER_LIST } from "../src/blocks/help-text.ts";
import { fieldOpDef, FIELD_OP_NAMES, hasOptionalField, hasText, withOptionalField } from "../src/blocks/optional-fields.ts";
import { contactSchema } from "../src/blocks/ContactBlock.tsx";
import { defaultContactForm, isFormBlock, withContactForm } from "../src/lib/contact-form.ts";
import { mergeBlocks, migrateBlock } from "../src/lib/db/blocs.ts";
import { acceptFromCanvas, EDIT_MSG } from "../src/lib/edit/protocol.ts";

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`PASS  ${name}`);
};
const T = (fr, en = fr) => ({ fr, en });
const E = T("", "");

/* ---- 1. Champs facultatifs ------------------------------------------------------------------------- */

test("champs facultatifs : Grille, Contact, Profil et CV ont leurs boutons « + Ajouter … », chaque champ est connu du protocole", () => {
  for (const type of ["grid", "contact", "profile", "cv"]) {
    const def = fieldOpDef(type, "eyebrow");
    assert.ok(def, `${type} : étiquette`);
  }
  assert.ok(fieldOpDef("contact", "cta") && fieldOpDef("profile", "contact-label") && fieldOpDef("profile", "name") && fieldOpDef("cv", "intro"));
  assert.equal(fieldOpDef("constructor", "title"), undefined);
  assert.equal(fieldOpDef("contact", "__proto__"), undefined);
  const origin = "https://portfolio.example";
  const frame = { name: "toile" };
  const msg = (data) => ({ origin, source: frame, data: { type: EDIT_MSG, ...data } });
  for (const name of FIELD_OP_NAMES) for (const verb of ["add", "remove"]) assert.equal(acceptFromCanvas(msg({ kind: "field-op", uid: "b1", op: `${verb}-${name}` }), origin, frame)?.op, `${verb}-${name}`);
  for (const op of ["add-nom", "remove-", "add-contact", "add-__proto__", "toggle-title"]) assert.equal(acceptFromCanvas(msg({ kind: "field-op", uid: "b1", op }), origin, frame), null, op);
});
test("champ texte : « add » crée la clé vide, « remove » la retire ; un texte saisi n'est jamais écrasé", () => {
  const def = fieldOpDef("contact", "intro");
  const props = { title: T("Écris-moi") };
  assert.equal(hasOptionalField(def, props), false);
  const added = withOptionalField(def, props, true);
  assert.deepEqual(added.intro, E);
  assert.equal(hasOptionalField(def, added), true);
  assert.deepEqual(withOptionalField(def, added, false), props);
  assert.deepEqual(props, { title: T("Écris-moi") }, "copie : l'original n'est pas modifié");
});
test("drapeau inversé (nom du Profil) : absent = affiché, « remove » pose false, « add » retire la clé", () => {
  const def = fieldOpDef("profile", "name");
  assert.equal(hasOptionalField(def, {}), true);
  const hidden = withOptionalField(def, { paragraphs: [E] }, false);
  assert.equal(hidden.showName, false);
  assert.equal(hasOptionalField(def, hidden), false);
  assert.equal("showName" in withOptionalField(def, hidden, true), false);
});
test("hasText : vide ou espaces = pas de texte, une seule langue suffit", () => {
  assert.equal(hasText(E), false);
  assert.equal(hasText(T("  ", "")), false);
  assert.equal(hasText(T("", "Hello")), true);
  assert.equal(hasText(undefined), false);
});

/* ---- 2. Registre ----------------------------------------------------------------------------------- */

const catalog = blockCatalog();

test("registre : « Formulaire de contact » n'est plus créable ; « Contact » propose « Avec un formulaire »", () => {
  assert.ok(BLOCKS["contact-form"].deprecated, "ancien type gardé pour la lecture");
  assert.ok(catalog.find((c) => c.key === "contact-form").hidden);
  const model = catalog.find((c) => c.key === "contact-with-form");
  assert.ok(model?.preset && model.type === "contact" && model.defaults.form === true && model.defaults.fields?.length >= 3);
  assert.equal(isFormBlock("contact", model.defaults), true);
  assert.equal(isFormBlock("contact", { eyebrow: E }), false, "sans l'option : un Contact simple");
  assert.equal(isFormBlock("contact-form", {}), true, "l'ancien type reste un formulaire");
  assert.ok(contactSchema.safeParse(model.defaults).success, "le modèle passe le schéma de Contact");
  assert.ok(contactSchema.safeParse(BLOCKS.contact.defaults).success);
});
test("panneau Ajouter : « Grille » porte ses modèles (images, vidéos), plus de cartes « Grille d'images / de vidéos »", () => {
  const groups = pickerGroups(catalog, STARTER_LIST);
  const labels = groups.flatMap((g) => g.entries.map((e) => e.label));
  assert.ok(!labels.includes("Grille d'images") && !labels.includes("Grille de vidéos") && !labels.includes("Formulaire de contact"));
  const grid = groups.flatMap((g) => g.entries).find((e) => e.type === "grid");
  assert.deepEqual(grid.models.map((m) => m.key), ["grid-images", "grid-videos"]);
  assert.equal(grid.models[0].defaults.children.length, 3);
  assert.equal(grid.models[1].defaults.layout, "1+2");
  assert.equal(grid.models[1].defaults.children.every((c) => c.type === "video-single"), true);
});
test("Ouverture : une seule fois par page (raison dans le catalogue) ; aucun autre type n'est limité", () => {
  assert.match(catalog.find((c) => c.type === "hero").single, /déjà une Ouverture/);
  // Hors types réservés à la page spéciale (« Sortie », lot 89), jamais proposés sur une page ordinaire.
  assert.deepEqual(catalog.filter((c) => c.single && !c.hidden).map((c) => c.type), ["hero"]);
});
test("types anciens (« ancien », deprecated) : jamais dans le panneau, jamais créables, libellés marqués", () => {
  const old = Object.values(BLOCKS).filter((b) => b.deprecated);
  assert.ok(old.length >= 5);
  for (const b of old) {
    assert.match(b.label, /\(ancien\)/, b.type);
    const entries = catalog.filter((c) => c.type === b.type);
    assert.ok(entries.every((c) => c.hidden), b.type);
    assert.ok(!b.group, `${b.type} : pas de groupe d'ajout`);
  }
  assert.ok(!Object.values(BLOCKS).some((b) => /\(ancien\)/.test(b.label) && !b.deprecated), "tout « (ancien) » est deprecated");
  const shown = pickerGroups(catalog, STARTER_LIST).flatMap((g) => [...g.entries, ...g.entries.flatMap((e) => e.models)]);
  assert.ok(!shown.some((e) => /ancien/i.test(e.label)));
});

/* ---- 3. Migration 0023 -------------------------------------------------------------------------- */

function freshDb() {
  const db = new Database(":memory:");
  const dir = new URL("../drizzle/", import.meta.url).pathname;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    for (const stmt of readFileSync(dir + f, "utf8").split("--> statement-breakpoint")) if (stmt.trim()) db.exec(stmt);
  }
  return db;
}
const field = (id, type, required = false) => ({ id, type, label: T(id), required });
const form = () => ({ formId: "fmigr0001", eyebrow: E, title: T("Écris-moi", "Write"), intro: E, fields: [field("fname", "text"), { ...field("femail", "email", true), reply: true }, field("fmessage", "textarea", true)], submit: T("Envoyer"), success: T("Merci"), error: T("Oups"), subject: T("Sujet"), look: { text: { "fields.0.label": { size: "l" } } } });
const kid = (uid, type, props = {}) => ({ uid, type, props });

function fixture() {
  const db = freshDb();
  const page = db.prepare("insert into pages (slug, title, meta, nav_order, published) values (?, ?, null, ?, 1)");
  page.run(JSON.stringify(T("")), JSON.stringify(T("Accueil")), null);
  page.run(JSON.stringify(T("apropos", "about")), JSON.stringify(T("À propos")), 1);
  const put = db.prepare("insert into blocks (page_id, position, type, props) values (?, ?, ?, ?)");
  [
    ["contact", { eyebrow: E, title: T("Contact"), intro: E, cta: T("Écrire") }],
    ["contact", { eyebrow: E, title: E, intro: E, cta: E }],
    ["contact-form", form()],
    ["grid", { layout: "2", eyebrow: E, title: T("Mon titre", ""), children: [kid("k1", "image", { mediaId: 1 })] }],
    ["profile", { portraitCaption: E, eyebrow: T("Moi"), paragraphs: [T("Texte")], contactEyebrow: E, contactLabel: E, socialEyebrow: T("", "Social") }],
    ["cv", { eyebrow: E, title: T("CV"), intro: E, button: E, fileName: "cv" }],
  ].forEach(([type, props], i) => put.run(1, i, type, JSON.stringify(props)));
  put.run(2, 0, "rich-text", "{pas du json");
  const draft = {
    title: T("Accueil"),
    blocks: [
      { uid: "d0", type: "contact-form", props: form() },
      { uid: "d1", type: "grid", props: { layout: "3", title: E, children: [kid("d1a", "image", {})] } },
      { uid: "d2", type: "contact", props: { eyebrow: T("Avant"), title: E, intro: T("", "Intro"), cta: E } },
      { uid: "d3", type: "profile", props: { paragraphs: [T("x")], showName: false, portraitCaption: E } },
    ],
  };
  db.prepare("update pages set draft = ?, draft_rev = 7 where id = 1").run(JSON.stringify(draft));
  return db;
}
const rows = (db, id) => db.prepare("select type, props from blocks where page_id = ? order by position").all(id).map((b) => ({ type: b.type, text: b.props, props: (() => { try { return JSON.parse(b.props); } catch { return null; } })() }));
const draftOf = (db, id) => JSON.parse(db.prepare("select draft from pages where id = ?").get(id).draft);
const strings = (v, out = new Set()) => {
  if (typeof v === "string") out.add(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (k !== "uid" && k !== "type") strings(x, out);
  return out;
};

test("0023 : « Formulaire de contact » → « Contact » avec formulaire : mêmes champs, même identifiant, mêmes styles", () => {
  const db = fixture();
  const r = mergeBlocks(db);
  assert.equal(r.forms, 2, "un publié + un brouillon");
  const home = rows(db, 1);
  assert.deepEqual(home.map((b) => b.type), ["contact", "contact", "contact", "grid", "profile", "cv"], "même ordre, même place");
  const f = home[2].props;
  assert.equal(f.form, true);
  assert.equal(f.formId, "fmigr0001");
  assert.deepEqual(f.fields.map((x) => x.id), ["fname", "femail", "fmessage"]);
  assert.deepEqual(f.look, form().look);
  assert.equal(f.title.fr, "Écris-moi");
  assert.equal("intro" in f || "eyebrow" in f, false, "présentation et étiquette vides retirées");
  assert.equal(isFormBlock(home[2].type, f), true);
  assert.ok(contactSchema.safeParse(f).success, "le résultat passe le schéma de Contact");
  const d = draftOf(db, 1).blocks[0];
  assert.deepEqual([d.uid, d.type, d.props.form, d.props.formId], ["d0", "contact", true, "fmigr0001"]);
});
test("0023 : champs vides retirés (Grille, Contact, Profil, CV), textes saisis gardés, même dans une seule langue", () => {
  const db = fixture();
  mergeBlocks(db);
  const [c1, c2, , grid, profile, cv] = rows(db, 1).map((b) => b.props);
  assert.deepEqual(c1, { title: T("Contact"), cta: T("Écrire") });
  assert.deepEqual(c2, {}, "un Contact entièrement vide ne garde rien");
  assert.deepEqual(grid, { layout: "2", title: T("Mon titre", ""), children: [kid("k1", "image", { mediaId: 1 })] });
  assert.deepEqual(profile, { eyebrow: T("Moi"), paragraphs: [T("Texte")], socialEyebrow: T("", "Social") });
  assert.deepEqual(cv, { title: T("CV"), fileName: "cv" });
  // Bloc illisible : texte exact conservé.
  assert.equal(rows(db, 2)[0].text, "{pas du json");
});
test("0023 : brouillon — champs vides retirés, showName gardé, draft_rev + 1 (conflit pour un onglet ouvert)", () => {
  const db = fixture();
  const r = mergeBlocks(db);
  assert.equal(r.drafts, 1);
  assert.equal(db.prepare("select draft_rev r from pages where id = 1").get().r, 8);
  const [form_, grid, contact, profile] = draftOf(db, 1).blocks;
  assert.equal(form_.type, "contact");
  assert.deepEqual(grid.props, { layout: "3", children: [kid("d1a", "image", {})] });
  assert.deepEqual(contact.props, { eyebrow: T("Avant"), intro: T("", "Intro") });
  assert.deepEqual(profile.props, { paragraphs: [T("x")], showName: false });
  // Page sans brouillon : rien touché.
  assert.equal(db.prepare("select draft_rev r from pages where id = 2").get().r, 0);
});
test("0023 : aucun texte saisi perdu", () => {
  const db = fixture();
  const before = new Set([...rows(db, 1).flatMap((b) => [...strings(b.props)]), ...[...strings(draftOf(db, 1))]]);
  mergeBlocks(db);
  const after = new Set([...rows(db, 1).flatMap((b) => [...strings(b.props)]), ...[...strings(draftOf(db, 1))]]);
  for (const s of before) if (s !== "" && s !== "contact-form") assert.ok(after.has(s), `texte perdu : ${s}`);
});
test("0023 : idempotente (second passage : rien ne change, draft_rev stable)", () => {
  const db = fixture();
  mergeBlocks(db);
  const snap = () => JSON.stringify([db.prepare("select * from blocks order by id").all(), db.prepare("select id, draft, draft_rev from pages order by id").all()]);
  const once = snap();
  const r = mergeBlocks(db);
  assert.equal(snap(), once);
  assert.deepEqual([r.published, r.drafts, r.forms], [0, 0, 0]);
});
test("0023 : anciens blocs restés dans un brouillon migrés (rejeu 0021 : conteneur déballé, draft_rev + 1)", () => {
  const db = fixture();
  const draft = draftOf(db, 1);
  draft.blocks.push({ uid: "old", type: "featured-project", props: { project: "alpha", children: [kid("o1", "section-title", { title: T("Dedans") })] } });
  db.prepare("update pages set draft = ? where id = 1").run(JSON.stringify(draft));
  const r = mergeBlocks(db);
  const types = draftOf(db, 1).blocks.map((b) => b.type);
  assert.ok(!types.includes("featured-project") && types.at(-1) === "section-title", types.join(","));
  assert.equal(r.legacy, 0);
  assert.ok(db.prepare("select draft_rev r from pages where id = 1").get().r > 7);
});
test("migrateBlock : composants d'un conteneur parcourus ; une valeur illisible n'est pas touchée", () => {
  const node = { type: "grid", props: { title: "pas un objet", eyebrow: { fr: 3 }, children: [{ uid: "a", type: "contact-form", props: form() }] } };
  assert.equal(migrateBlock(node), true);
  assert.equal(node.props.title, "pas un objet");
  assert.deepEqual(node.props.eyebrow, { fr: 3 });
  assert.equal(node.props.children[0].type, "contact");
  assert.equal(defaultContactForm().fields.length, 3);
});

test("audit m1 : publishCheck d'un Contact avec formulaire = même contrôle que le rendu (ContactFormSchema)", () => {
  const check = BLOCKS.contact.publishCheck;
  assert.equal(check({ form: false }), null);
  assert.match(check({ form: true }), /identifiant/);
  const good = withContactForm({}, true);
  assert.equal(check(good), null, JSON.stringify(check(good)));
  assert.match(check({ ...good, fields: [{ id: "A!", type: "text", label: { fr: "x", en: "x" } }] }), /formulaire est incomplet/);
  assert.match(check({ ...good, fields: [] }), /formulaire est incomplet/);
});
test("audit m2 : réactiver « Avec un formulaire » garde l'identifiant et les champs existants", () => {
  const on = withContactForm({}, true);
  assert.equal(on.form, true);
  const off = withContactForm(on, false);
  assert.equal(off.form, false);
  assert.equal(off.formId, on.formId, "l'identifiant est gardé à la désactivation");
  const again = withContactForm(off, true);
  assert.equal(again.formId, on.formId, "…et à la réactivation");
  assert.deepEqual(again.fields, on.fields);
  const migrated = withContactForm({ form: false, formId: "fmigre12345" }, true);
  assert.equal(migrated.formId, "fmigre12345");
  assert.match(withContactForm({}, true).formId, /^f[a-z0-9]{6,31}$/);
});

console.log(`\n${passed} test(s) OK`);
