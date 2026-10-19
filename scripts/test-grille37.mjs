#!/usr/bin/env node
/**
 * Lot 37 « grille justifiée » : tests unitaires du calcul des rangées (inclus dans npm test), sans serveur.
 * Usage : node --import tsx scripts/test-grille37.mjs
 */
import assert from "node:assert/strict";

import { gridSchema } from "../src/blocks/GridBlock.tsx";
import { isJustified, justifyRows } from "../src/blocks/grid-layouts.ts";

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

test("37e seul Automatique + format Libre est justifié ; préréglages et formats imposés inchangés", () => {
  assert.ok(isJustified({ layout: "auto" }));
  assert.ok(isJustified({ layout: "auto", ratio: "auto" }));
  assert.ok(!isJustified({ layout: "auto", ratio: "1:1" }));
  for (const l of ["1", "1+2", "2", "3", "2x2", "4", "2+1", "portrait-left", "portrait-right", "custom"]) assert.ok(!isJustified({ layout: l, ratio: "auto" }), l);
  // aucune donnée nouvelle : le schéma accepte et garde les anciennes grilles telles quelles
  const old = { layout: "auto", children: [] };
  assert.deepEqual(gridSchema.parse(old).layout, "auto");
});

console.log(`\n${passed} tests passés`);
