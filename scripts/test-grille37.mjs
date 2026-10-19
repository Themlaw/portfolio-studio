#!/usr/bin/env node
/**
 * Lot 37 « grille justifiée » : tests unitaires du calcul des rangées (inclus dans npm test), sans serveur.
 * Usage : node --import tsx scripts/test-grille37.mjs
 */
import assert from "node:assert/strict";

import { gridSchema } from "../src/blocks/GridBlock.tsx";
import { applyGridOp, freeCells, isJustified, justifyRows } from "../src/blocks/grid-layouts.ts";

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`PASS  ${name}`);
};
const near = (a, b, t = 0.001) => Math.abs(a - b) <= t;

test("37a carré + 2/3 : largeurs proportionnelles (~60 / 40) donc même hauteur", () => {
  const r = justifyRows([1, 2 / 3], 2);
  const total = r[0].k + r[1].k;
  assert.ok(near(total, 2), "la rangée remplit ses 2 colonnes");
  assert.ok(near(r[0].k / total, 0.6), String(r[0].k / total));
  assert.ok(near(r[0].k / r[0].r, r[1].k / r[1].r), "largeur / format identique = même hauteur");
  assert.equal(r[0].row, r[1].row);
  assert.ok(!r[0].part && !r[0].full);
});

test("37b un panorama (>= 1,9) reste seul sur sa rangée pleine largeur ; l'ordre est gardé", () => {
  const r = justifyRows([1.5, 1, 2.4, 0.67, 1.5], 2);
  assert.deepEqual(r.map((c) => c.row), [0, 0, 1, 2, 2]);
  assert.ok(r[2].full && near(r[2].k, 2));
  assert.equal(r.length, 5);
});

test("37c rangée incomplète : garde la largeur de ses colonnes (part), même seule", () => {
  const r = justifyRows([1.5, 2.4, 0.67], 2);
  assert.ok(r[0].part && near(r[0].k, 1));
  assert.ok(r[2].part && near(r[2].k, 1));
});

test("37d case vide ou format inconnu = 1 ; formats invalides ignorés ; 3 et 4 colonnes", () => {
  const r = justifyRows([null, undefined, Number.NaN, 0], 4);
  assert.ok(r.every((c) => near(c.r, 1) && near(c.k, 1) && !c.part));
  const t = justifyRows([1, 1, 1, 1], 3);
  assert.deepEqual(t.map((c) => c.row), [0, 0, 0, 1]);
  assert.ok(t[3].part);
  assert.deepEqual(justifyRows([], 2), []);
});

test("37e Automatique et colonnes simples (2, 3, 4, 2x2) + format Libre sont justifiés ; grandes cases, Sur mesure et formats imposés inchangés", () => {
  assert.ok(isJustified({ layout: "auto" }));
  assert.ok(isJustified({ layout: "auto", ratio: "auto" }));
  assert.ok(!isJustified({ layout: "auto", ratio: "1:1" }));
  for (const l of ["2", "3", "2x2", "4"]) {
    assert.ok(isJustified({ layout: l, ratio: "auto" }), l);
    assert.ok(isJustified({ layout: l }), `${l} sans format`);
    assert.ok(!isJustified({ layout: l, ratio: "1:1" }), `${l} Carré`);
    assert.ok(!isJustified({ layout: l, ratio: "16:9" }), `${l} 16:9`);
  }
  for (const l of ["1", "1+2", "2+1", "portrait-left", "portrait-right", "custom"]) assert.ok(!isJustified({ layout: l, ratio: "auto" }), l);
  // aucune donnée nouvelle : le schéma accepte et garde les anciennes grilles telles quelles
  const old = { layout: "auto", children: [] };
  assert.deepEqual(gridSchema.parse(old).layout, "auto");
});

test("37f « Seule sur sa ligne » : rangée pleine largeur, les voisines se rangent avant et après", () => {
  const r = justifyRows([1, 1.5, 0.67, 1, 1.5], 3, [false, false, true, false, false]);
  assert.deepEqual(r.map((c) => c.row), [0, 0, 1, 2, 2]);
  assert.ok(r[2].full && near(r[2].k, 3) && !r[2].part);
  assert.ok(r[0].part && r[3].part, "les rangées incomplètes gardent la largeur de leurs colonnes");
  // la première image seule, puis un panorama, puis le reste
  const s = justifyRows([0.67, 1, 2.4, 1], 2, [true, false, false, false]);
  assert.deepEqual(s.map((c) => c.row), [0, 1, 2, 3]);
  assert.ok(s[0].full && near(s[0].r, 0.67));
  // sans drapeau : comportement du lot 37 inchangé
  assert.deepEqual(justifyRows([1, 1, 1], 3, [false, false, false]).map((c) => c.row), [0, 0, 0]);
});

test("37g l'option « alone » suit son image (déplacer, retirer, ajouter) et se range sans passer en Sur mesure", () => {
  const kid = (uid) => ({ uid, type: "image", props: { mediaId: 1 } });
  const base = { layout: "3", ratio: "auto", children: [kid("a"), kid("b"), kid("c")] };
  const r1 = applyGridOp(base, { op: "alone", index: 1, alone: true });
  assert.ok("props" in r1);
  assert.deepEqual(r1.props.alone, [false, true, false]);
  assert.equal(r1.props.layout, "3", "reste en préréglage, pas de Sur mesure");
  assert.equal(r1.props.spans, undefined);
  const mv = applyGridOp(r1.props, { op: "move", from: 1, to: 0 });
  assert.deepEqual(mv.props.alone, [true, false, false]);
  assert.deepEqual(mv.props.children.map((c) => c.uid), ["b", "a", "c"]);
  const sw = applyGridOp(r1.props, { op: "swap", a: 1, b: 2 });
  assert.deepEqual(sw.props.alone, [false, false, true]);
  const rm = applyGridOp(r1.props, { op: "remove", index: 0 });
  assert.deepEqual(rm.props.alone, [true, false]);
  const rm2 = applyGridOp(r1.props, { op: "remove", index: 1 });
  assert.equal(rm2.props.alone, undefined, "plus aucun drapeau : la clé disparaît");
  const put = applyGridOp(r1.props, { op: "put", index: 3, child: kid("d") });
  assert.deepEqual(put.props.alone, [false, true, false, false]);
  const back = applyGridOp(r1.props, { op: "alone", index: 1, alone: false });
  assert.equal(back.props.alone, undefined, "« Avec les autres » : retour à l'état d'origine");
  assert.deepEqual(back.props, base);
  assert.ok("error" in applyGridOp(base, { op: "alone", index: 9, alone: true }));
  assert.ok("error" in applyGridOp({ ...base, ratio: "1:1" }, { op: "alone", index: 0, alone: true }), "format imposé : sans effet");
  assert.ok("error" in applyGridOp({ ...base, layout: "portrait-left" }, { op: "alone", index: 0, alone: true }));
  assert.deepEqual(gridSchema.parse({ layout: "3", alone: [false, true], children: [] }).alone, [false, true]);
  assert.equal(gridSchema.parse({ layout: "3", children: [] }).alone, undefined);
});

test("37h places libres d'un préréglage justifié : une case, ou une rangée complète sur une grille vide", () => {
  assert.equal(freeCells({ layout: "3", ratio: "auto" }, 0).length, 3);
  assert.equal(freeCells({ layout: "3", ratio: "auto" }, 4).length, 1);
  assert.equal(freeCells({ layout: "4", ratio: "auto" }, 0).length, 4);
  // inchangé hors justification : motif complété
  assert.equal(freeCells({ layout: "3", ratio: "1:1" }, 4).length, 2);
  assert.equal(freeCells({ layout: "portrait-left", ratio: "auto" }, 1).length, 2);
});

console.log(`\n${passed} tests passés`);
