#!/usr/bin/env node
/**
 * Ordre d'affichage des pages (écran admin « Pages » et sélecteur de l'éditeur) :
 * fonction pure `orderPages` (src/lib/pages-order.ts).
 * Usage : node --import tsx scripts/test-pages-order.mjs
 */
import assert from "node:assert/strict";

import { orderPages } from "../src/lib/pages-order.ts";

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`PASS  ${name}`);
};

test("ordre enregistré respecté", () => {
  const pages = [{ id: 2 }, { id: 3 }, { id: 1 }];
  const out = orderPages(pages, [3, 1]);
  assert.deepEqual(out.map((p) => p.id), [3, 1, 2]);
});

test("pages absentes à la fin, par identifiant", () => {
  const pages = [{ id: 5 }, { id: 2 }, { id: 9 }];
  const out = orderPages(pages, [9]);
  assert.deepEqual(out.map((p) => p.id), [9, 2, 5]);
});

test("ordre vide : toutes par identifiant", () => {
  const pages = [{ id: 7 }, { id: 1 }, { id: 4 }];
  const out = orderPages(pages, []);
  assert.deepEqual(out.map((p) => p.id), [1, 4, 7]);
});

test("ordre null/undefined : toutes par identifiant", () => {
  const pages = [{ id: 3 }, { id: 1 }];
  assert.deepEqual(orderPages(pages, null).map((p) => p.id), [1, 3]);
  assert.deepEqual(orderPages(pages, undefined).map((p) => p.id), [1, 3]);
});

test("doublons et inconnus ignorés", () => {
  const pages = [{ id: 1 }, { id: 2 }];
  const out = orderPages(pages, [2, 2, 99, 1]);
  assert.deepEqual(out.map((p) => p.id), [2, 1]);
});

test("entrées invalides ignorées", () => {
  const pages = [{ id: 1 }, { id: 2 }];
  const out = orderPages(pages, [0, -1, 1.5, "x", 1]);
  assert.deepEqual(out.map((p) => p.id), [1, 2]);
});

test("ne mute pas l'entrée", () => {
  const pages = [{ id: 2 }, { id: 1 }];
  const copy = pages.slice();
  orderPages(pages, [2, 1]);
  assert.deepEqual(pages, copy);
});

test("tableau vide", () => {
  assert.deepEqual(orderPages([], [1, 2]), []);
});

console.log(`\n${passed} tests passés`);
