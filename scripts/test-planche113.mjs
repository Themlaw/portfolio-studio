#!/usr/bin/env node
/**
 * Lot 113 « Planche libre : recadrer le cadre par ses bords et ses coins » : tests unitaires (inclus dans npm test), sans serveur.
 * ÉCRITS AVANT le code produit : ils échouent sur la base 7f64836 (exports absents), puis passent.
 *  1. Non-régression : une planche sans `crop` se lit, se rend (variables CSS du cadre) et se modifie comme avant ; aucune donnée réécrite.
 *  2. Modèle `crop` (marges de recadrage en % du plan) : lecture tolérante, bornes, format du cadre, variables CSS.
 *  3. Opération `crop` d'`applyFreeOp` : valeurs absolues, arrondis, effacement, jamais de cadre < 10 %, un format fixe efface le recadrage.
 *  4. Magnétisme : formats repères (3:2, 4:3, 1:1, 16:9) et bords du contenu (`snapCrop`, `contentBounds`).
 *  5. Messages de la toile : `free-op` accepte `crop` ; une grille de page accepte une planche libre, une grille de planche de projet non.
 * Usage : node --import tsx scripts/test-planche113.mjs
 */
import assert from "node:assert/strict";

import { layoutProblem } from "../src/blocks/board-layout.ts";
import {
  applyFreeOp,
  contentBounds,
  cropOf,
  cropStyle,
  FREE_CROP_MIN,
  freeBoardSchema,
  frameAspect,
  snapCrop,
  zoneAspect,
} from "../src/blocks/free-board.ts";
import { containerAccepts, treeProblem } from "../src/blocks/tree.ts";
import { FromCanvasSchema } from "../src/lib/edit/protocol.ts";

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`PASS  ${name}`);
};
const item = (id, extra = {}) => ({ id, media: 7, x: 10, y: 10, w: 30, rot: 0, z: 0, ...extra });
const base = (items = [], extra = {}) => ({ format: "3:2", phone: "scale", items, ...extra });
const ok = (res) => {
  assert.ok(!("error" in res), "error" in res ? res.error : "");
  return res.props;
};
const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t;

/* ---- 1. Non-régression ---- */

test("1a une planche d'avant (sans crop) : aucun recadrage, rien de changé par la lecture ni par les opérations existantes", () => {
  for (const p of [base(), base([item("a")], { format: "4:3" }), base([item("a", { x: -20, y: -30, rot: 25, z: 3 })], { format: "1:1", phone: "stack" }), { format: "free", aspect: 2.2, phone: "scale", items: [] }, { items: [] }]) {
    const frozen = JSON.stringify(p);
    assert.equal(cropOf(p), null);
    assert.equal(cropStyle(p), null, "aucune variable de cadre pour une planche non recadrée");
    assert.ok(near(frameAspect(p), zoneAspect(p)));
    assert.equal(JSON.stringify(p), frozen);
    const moved = ok(applyFreeOp(p, { op: "set", phone: "stack" }));
    assert.equal("crop" in moved, false, "un réglage existant n'écrit pas de crop");
  }
});

test("1b le schéma accepte l'absence de crop (valeurs d'avant lues à l'identique)", () => {
  assert.deepEqual(freeBoardSchema.parse({}), { format: "3:2", phone: "scale", items: [] });
  const p = freeBoardSchema.parse({ format: "16:9", phone: "stack", items: [item("a")] });
  assert.equal(p.crop, undefined);
});

/* ---- 2. Modèle ---- */

test("2a le crop se lit (t, r, b, l en % du plan) ; absent, nul ou illisible = pas de recadrage", () => {
  assert.deepEqual(cropOf(base([], { crop: { t: 10, r: 5, b: 20, l: 0 } })), { t: 10, r: 5, b: 20, l: 0 });
  assert.deepEqual(cropOf(base([], { crop: { b: 20 } })), { t: 0, r: 0, b: 20, l: 0 });
  for (const bad of [null, {}, { t: 0, r: 0, b: 0, l: 0 }, "x", [], { t: "a" }, { b: Number.NaN }]) assert.equal(cropOf(base([], { crop: bad })), null, JSON.stringify(bad));
});

test("2b format du cadre = format du plan × (100 − g − d) ÷ (100 − h − b)", () => {
  const p = base([], { crop: { t: 0, r: 0, b: 50, l: 0 } });
  assert.ok(near(frameAspect(p), 3));
  const q = base([], { format: "1:1", crop: { t: 10, r: 20, b: 10, l: 20 } });
  assert.ok(near(frameAspect(q), 60 / 80));
  const grown = base([], { crop: { t: 0, r: 0, b: -50, l: 0 } });
  assert.ok(near(frameAspect(grown), 1.5 / 1.5));
});

test("2c variables CSS du cadre : position et taille du cadre dans le plan", () => {
  const s = cropStyle(base([], { crop: { t: 10, r: 20, b: 30, l: 5 } }));
  assert.deepEqual(s, { "--fb-cl": 5, "--fb-ct": 10, "--fb-cw": 75, "--fb-ch": 60, "--fb-fa": (1.5 * 75) / 60 });
});

/* ---- 3. Opération crop ---- */

test("3a crop : valeurs absolues, arrondies à 0,01, items inchangés", () => {
  const p = base([item("a"), item("b", { x: 50 })]);
  const q = ok(applyFreeOp(p, { op: "crop", b: 33.3333, l: 10.006 }));
  assert.deepEqual(q.crop, { t: 0, r: 0, b: 33.33, l: 10.01 });
  assert.deepEqual(q.items, p.items);
  assert.equal(q.format, "3:2");
  assert.equal(p.crop, undefined, "props n'est jamais modifié");
});

test("3b crop : une valeur à la fois, les autres sont gardées ; tout à zéro efface la clé", () => {
  const p = ok(applyFreeOp(base(), { op: "crop", t: 10, b: 20 }));
  const q = ok(applyFreeOp(p, { op: "crop", b: 5 }));
  assert.deepEqual(q.crop, { t: 10, r: 0, b: 5, l: 0 });
  const z = ok(applyFreeOp(ok(applyFreeOp(q, { op: "crop", t: 0 })), { op: "crop", b: 0 }));
  assert.equal("crop" in z, false);
  assert.deepEqual(z, base());
  const r = ok(applyFreeOp(q, { op: "crop", reset: true }));
  assert.equal("crop" in r, false);
});

test("3c bornes : g, d, h ≥ 0 ; b peut devenir négatif (le cadre dépasse le plan vers le bas) ; jamais un cadre sous 10 % ; format borné", () => {
  const p = base();
  assert.equal(ok(applyFreeOp(p, { op: "crop", l: -5 })).crop, undefined);
  assert.equal(ok(applyFreeOp(p, { op: "crop", t: -5 })).crop, undefined);
  assert.equal(ok(applyFreeOp(p, { op: "crop", b: -40 })).crop.b, -40);
  assert.equal(ok(applyFreeOp(p, { op: "crop", b: -500 })).crop.b, -150);
  const c = ok(applyFreeOp(p, { op: "crop", l: 80, r: 80, t: 70, b: 70 })).crop;
  assert.ok(100 - c.l - c.r >= FREE_CROP_MIN - 1e-9 && 100 - c.t - c.b >= FREE_CROP_MIN - 1e-9, JSON.stringify(c));
  const fa = frameAspect({ ...p, crop: ok(applyFreeOp(p, { op: "crop", l: 0, r: 0, t: 0, b: 89 })).crop });
  assert.ok(fa <= 8 + 1e-9);
});

test("3d un format fixe (ou la hauteur libre) choisi dans le panneau efface le recadrage ; le format du plan n'est pas touché par un recadrage", () => {
  const p = ok(applyFreeOp(base(), { op: "crop", b: 20, l: 10 }));
  assert.equal(p.format, "3:2");
  const q = ok(applyFreeOp(p, { op: "set", format: "16:9" }));
  assert.equal("crop" in q, false);
  assert.equal(q.format, "16:9");
  const r = ok(applyFreeOp(p, { op: "set", phone: "stack" }));
  assert.deepEqual(r.crop, p.crop, "un réglage sans format garde le recadrage");
});

test("3e les opérations sur les images gardent le recadrage (put, place, remplacer, retirer)", () => {
  let p = ok(applyFreeOp(base(), { op: "crop", b: 25 }));
  p = ok(applyFreeOp(p, { op: "put", id: "n1", media: 3, x: 50, y: 40, ratio: 1 }));
  p = ok(applyFreeOp(p, { op: "place", id: "n1", x: 12 }));
  p = ok(applyFreeOp(p, { op: "replace", id: "n1", media: 4 }));
  assert.deepEqual(p.crop, { t: 0, r: 0, b: 25, l: 0 });
  p = ok(applyFreeOp(p, { op: "remove", id: "n1" }));
  assert.deepEqual(p.crop, { t: 0, r: 0, b: 25, l: 0 });
});

/* ---- 4. Magnétisme ---- */

test("4a contentBounds : boîte englobante des images (rotation comprise), en % du plan", () => {
  const b = contentBounds([item("a", { x: 10, y: 20, w: 30 }), item("b", { x: 50, y: 10, w: 20 })], 1.5, { a: 1, b: 2 });
  // a : 30 de large, hauteur 30×1,5÷1 = 45 ; b : 20 de large, hauteur 20×1,5÷2 = 15.
  assert.ok(near(b.x0, 10) && near(b.x1, 70) && near(b.y0, 10) && near(b.y1, 65), JSON.stringify(b));
  const r = contentBounds([item("a", { x: 40, y: 40, w: 20, rot: 90 })], 1, { a: 1 });
  assert.ok(near(r.x0, 40, 1e-6) && near(r.x1, 60, 1e-6) && near(r.y0, 40, 1e-6) && near(r.y1, 60, 1e-6), JSON.stringify(r));
  assert.equal(contentBounds([], 1.5, {}), null);
});

test("4b snapCrop : le format du cadre colle au repère proche (16:9, 4:3, 3:2, 1:1), le bord déplacé s'ajuste", () => {
  const zone = 1.5;
  // bas remonté : 16:9 = hauteur 84,375 % → b = 15,625
  const near169 = snapCrop({ t: 0, r: 0, b: 17, l: 0 }, ["b"], { zone, tol: 0.03, content: null });
  assert.equal(near169.snap, "16:9");
  assert.ok(near(near169.crop.b, 15.625, 0.01), JSON.stringify(near169));
  assert.ok(near(frameAspect({ format: "3:2", crop: near169.crop }), 16 / 9, 0.002));
  // loin de tout repère : rien
  const far = snapCrop({ t: 0, r: 0, b: 30, l: 0 }, ["b"], { zone, tol: 0.03, content: null });
  assert.equal(far.snap, undefined);
  assert.deepEqual(far.crop, { t: 0, r: 0, b: 30, l: 0 });
  // 4:3 en agrandissant vers le bas
  const s43 = snapCrop({ t: 0, r: 0, b: -11, l: 0 }, ["b"], { zone, tol: 0.03, content: null });
  assert.equal(s43.snap, "4:3");
  assert.ok(near(s43.crop.b, -12.5, 0.01));
  // un gest horizontal ajuste la largeur
  const h = snapCrop({ t: 0, r: 2, b: 0, l: 0 }, ["r"], { zone: 4 / 3, tol: 0.03, content: null });
  assert.equal(h.snap, "4:3", "98 % de largeur sur un plan 4:3 : toujours près de 4:3");
});

test("4c snapCrop : le bord colle au contenu (priorité sur les formats), tolérance en % du plan", () => {
  const content = { x0: 10, y0: 12, x1: 70, y1: 73.9 };
  const s = snapCrop({ t: 0, r: 0, b: 26.8, l: 0 }, ["b"], { zone: 1.5, tol: 0.03, content, tolPct: 1 });
  assert.ok(near(s.crop.b, 26.1, 0.01), JSON.stringify(s));
  assert.equal(s.snap, "contenu");
  const t = snapCrop({ t: 12.4, r: 0, b: 0, l: 0 }, ["t"], { zone: 1.5, tol: 0.03, content, tolPct: 1 });
  assert.ok(near(t.crop.t, 12, 0.01));
  const rr = snapCrop({ t: 0, r: 29.5, b: 0, l: 0 }, ["r"], { zone: 1.5, tol: 0.03, content, tolPct: 1 });
  assert.ok(near(rr.crop.r, 30, 0.01));
  const nope = snapCrop({ t: 0, r: 0, b: 35, l: 0 }, ["b"], { zone: 1.5, tol: 0.03, content, tolPct: 1 });
  assert.equal(nope.snap, undefined);
});

test("4d snapCrop est sans effet quand il est coupé (Alt) : tol = 0", () => {
  const s = snapCrop({ t: 0, r: 0, b: 17, l: 0 }, ["b"], { zone: 1.5, tol: 0, content: { x0: 0, y0: 0, x1: 100, y1: 80 }, tolPct: 0 });
  assert.equal(s.snap, undefined);
  assert.deepEqual(s.crop, { t: 0, r: 0, b: 17, l: 0 });
});

/* ---- 5. Protocole et grille ---- */

test("5a la toile envoie `crop` (free-op) ; valeurs hors bornes refusées", () => {
  const msg = (op) => ({ kind: "free-op", uid: "fb1", op });
  assert.equal(FromCanvasSchema.safeParse(msg({ op: "crop", b: 12.5, t: 3 })).success, true);
  assert.equal(FromCanvasSchema.safeParse(msg({ op: "crop", reset: true })).success, true);
  assert.equal(FromCanvasSchema.safeParse(msg({ op: "crop", b: 1000 })).success, false);
  assert.equal(FromCanvasSchema.safeParse(msg({ op: "crop", l: "x" })).success, false);
});

test("5b une grille de page accepte une planche libre en cellule ; la validation de l'arbre la laisse passer", () => {
  assert.equal(containerAccepts("grid", "free-board"), true);
  assert.equal(containerAccepts("featured-project", "free-board"), false, "seule la grille la reçoit");
  const grid = { uid: "g1", type: "grid", props: { layout: "2", children: [{ uid: "c1", type: "free-board", props: base([item("a")]) }, { uid: "c2", type: "rich-text", props: {} }] } };
  assert.equal(treeProblem([grid], (t) => ["grid", "free-board", "rich-text"].includes(t)), null);
});

test("5c une grille de planche de projet : inchangée (images et vidéos seulement)", () => {
  const layout = [{ uid: "g", type: "grid", props: { layout: "2", children: [{ uid: "c1", type: "free-board", props: {} }] } }];
  assert.equal(typeof layoutProblem(layout), "string");
});

console.log(`\n${passed} tests unitaires passés.`);
