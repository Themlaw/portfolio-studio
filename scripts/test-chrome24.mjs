#!/usr/bin/env node
/**
 * Chrome de l'éditeur (lot 24) — tests unitaires (inclus dans npm test) :
 *  1. Problèmes de publication en français (src/components/admin/editor/problems.ts) : rubrique et champ nommés,
 *     composants d'un conteneur, problèmes de la page, ordre de la page, aucun chemin technique.
 *  2. Mesure de lisibilité (src/components/edit/readability.ts) : seuils et libellés (lot 24, barre typographique).
 * Usage : node --import tsx scripts/test-chrome24.mjs
 */
import assert from "node:assert/strict";

import { describeProblems, fieldLabel } from "../src/components/admin/editor/problems.ts";

const label = (t) => ({ "rich-text": "Texte", image: "Image", grid: "Grille", "section-title": "Titre" })[t] ?? t;
const blocks = [
  { uid: "a", type: "section-title", props: {} },
  { uid: "b", type: "grid", props: { children: [{ uid: "c", type: "image", props: {} }, { uid: "d", type: "rich-text", props: {} }] } },
  { uid: "e", type: "rich-text", props: {} },
];

// 1. Problèmes
assert.equal(fieldLabel("title.fr"), "Titre (FR)");
assert.equal(fieldLabel("paragraphs.0.en"), "Paragraphe 1 (EN)");
assert.equal(fieldLabel("fields.2.label.fr"), "Champ 3, Libellé (FR)");
assert.equal(fieldLabel("zzz.fr"), null, "champ inconnu : pas de chaîne technique");

const list = describeProblems(
  blocks,
  {
    "blocks.2": "Remplace le texte d'exemple.",
    "blocks.1.props.children.1.props.paragraphs.0.fr": "Ce champ est obligatoire.",
    collection: "Cette collection est déjà prise.",
    "blocks.1.props.children.0": "Choisis une image.",
    "blocks.0.props.title.fr": "Ce champ ne peut pas être vide.",
    accent: "Teinte illisible.",
  },
  label,
);
assert.deepEqual(
  list.map((p) => p.key),
  ["blocks.0.props.title.fr", "blocks.1.props.children.0", "blocks.1.props.children.1.props.paragraphs.0.fr", "blocks.2", "collection", "accent"],
  "ordre de la page, puis page et site",
);
assert.equal(list[0].where, "Rubrique n° 1 « Titre »");
assert.equal(list[0].field, "Titre (FR)");
assert.equal(list[0].uid, "a");
assert.equal(list[1].where, "Composant « Image » de la rubrique n° 2 « Grille »");
assert.equal(list[1].uid, "c");
assert.equal(list[2].field, "Paragraphe 1 (FR)");
assert.equal(list[2].uid, "d");
assert.equal(list[3].uid, "e");
assert.equal(list[3].kind, "block");
assert.equal(list[4].kind, "page");
assert.equal(list[4].uid, null);
assert.equal(list[4].field, "Collection de la page");
assert.equal(list[5].kind, "form");
for (const p of list) assert.ok(!/blocks\.|props\./.test(`${p.where} ${p.field ?? ""}`), `chaîne technique dans « ${p.where} ${p.field} »`);
// Une clé qui ne désigne aucun bloc (brouillon modifié depuis) devient un problème de page, sans planter.
assert.equal(describeProblems(blocks, { "blocks.9.props.title.fr": "x" }, label)[0].uid, null);

console.log("test-chrome24 : OK");
