#!/usr/bin/env node
/**
 * Lot 31d « grille unifiée » — tests unitaires (inclus dans npm test), sans serveur :
 *  1. Modèle (src/blocks/grid-layouts.ts) : disposition de chaque agencement (portrait à gauche / à droite, sur mesure),
 *     places libres, placement dense sans trou, `toCustom` sans rien perdre.
 *  2. Opérations (`applyGridOp`) : échanger, déplacer, retirer, poser une image, taille d'une case, colonnes, inversion,
 *     « Adapter aux images » ; les tailles de cases suivent toujours l'ordre des images.
 *  3. Schéma de la grille et suite d'une planche : nouveaux champs bornés, anciennes grilles (page ET planche) inchangées
 *     (aucune migration : les champs ajoutés sont facultatifs).
 *  4. Messages de la toile : `grid-op`, `cell-look`, cible de dépôt `gcell` (validation).
 * Usage : node --import tsx scripts/test-grille31d.mjs
 */
import assert from "node:assert/strict";

import { layoutProblem } from "../src/blocks/board-layout.ts";
import { gridSchema } from "../src/blocks/GridBlock.tsx";
import { adaptSpan, applyGridOp, cellShare, freeCells, GRID_LAYOUTS, GRID_PATTERN, gridCells, placeCells, toCustom } from "../src/blocks/grid-layouts.ts";
import { treeProblem } from "../src/blocks/tree.ts";
import { FromCanvasSchema } from "../src/lib/edit/protocol.ts";

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`PASS  ${name}`);
};
const kid = (uid, mediaId, extra = {}) => ({ uid, type: "image", props: { width: "wide", mediaId, ...extra } });
const place = (shape, n) => {
  const g = gridCells(shape, n);
  return placeCells(g.cols, g.cells, g.mirror);
};
const uidsOf = (p) => p.children.map((c) => c.uid);

/* ---- 1. Modèle ---- */

test("1a les agencements d'avant sont inchangés (motifs, nombre de places)", () => {
  assert.deepEqual(GRID_LAYOUTS.slice(0, 7), ["1", "1+2", "2", "3", "2x2", "4", "2+1"]);
  assert.deepEqual([GRID_PATTERN["1"], GRID_PATTERN["1+2"], GRID_PATTERN["3"], GRID_PATTERN["2x2"], GRID_PATTERN["2+1"]], [1, 3, 3, 4, 3]);
  assert.deepEqual(place({ layout: "1+2" }, 3), [
    { col: 0, row: 0, w: 2, h: 1 },
    { col: 0, row: 1, w: 1, h: 1 },
    { col: 1, row: 1, w: 1, h: 1 },
  ]);
  assert.deepEqual(place({ layout: "3" }, 4).map((p) => [p.col, p.row]), [[0, 0], [1, 0], [2, 0], [0, 1]]);
});

test("1b portrait à gauche + 2 à droite : une case sur 2 rangées à gauche, deux empilées à droite", () => {
  assert.deepEqual(place({ layout: "portrait-left" }, 3), [
    { col: 0, row: 0, w: 1, h: 2 },
    { col: 1, row: 0, w: 1, h: 1 },
    { col: 1, row: 1, w: 1, h: 1 },
  ]);
});

test("1c portrait à droite + 2 à gauche : le miroir (la case 1 est toujours le portrait)", () => {
  assert.deepEqual(place({ layout: "portrait-right" }, 3), [
    { col: 1, row: 0, w: 1, h: 2 },
    { col: 0, row: 0, w: 1, h: 1 },
    { col: 0, row: 1, w: 1, h: 1 },
  ]);
  // Le motif se répète ligne après ligne.
  assert.deepEqual(place({ layout: "portrait-left" }, 6).slice(3).map((p) => [p.col, p.row, p.h]), [[0, 2, 2], [1, 2, 1], [1, 3, 1]]);
});

test("1d places libres : le reste du motif ; « Sur mesure » : une seule, la prochaine", () => {
  assert.equal(freeCells({ layout: "portrait-left" }, 0).length, 3);
  assert.deepEqual(freeCells({ layout: "portrait-left" }, 1), [{ w: 1, h: 1 }, { w: 1, h: 1 }]);
  assert.equal(freeCells({ layout: "portrait-left" }, 3).length, 0);
  assert.deepEqual(freeCells({ layout: "portrait-left" }, 3).length, 0);
  assert.deepEqual(freeCells({ layout: "custom", cols: 3, spans: [] }, 5), [{ w: 1, h: 1 }]);
  assert.equal(freeCells({ layout: "custom" }, 24).length, 0);
});

test("1e « Sur mesure » : tailles bornées (1 à colonnes, 1 ou 2 rangées), placement dense sans trou", () => {
  const spans = [{ w: 1, h: 2 }, { w: 2, h: 1 }, { w: 1, h: 1 }, { w: 1, h: 1 }];
  const g = gridCells({ layout: "custom", cols: 3, spans }, 4);
  assert.equal(g.cols, 3);
  assert.deepEqual(placeCells(g.cols, g.cells), [
    { col: 0, row: 0, w: 1, h: 2 },
    { col: 1, row: 0, w: 2, h: 1 },
    { col: 1, row: 1, w: 1, h: 1 },
    { col: 2, row: 1, w: 1, h: 1 },
  ]);
  // Largeur plus grande que les colonnes, hauteur 5 : ramenées aux bornes ; case sans taille : 1 × 1.
  const clamped = gridCells({ layout: "custom", cols: 2, spans: [{ w: 4, h: 5 }] }, 2);
  assert.deepEqual(clamped.cells, [{ w: 2, h: 2 }, { w: 1, h: 1 }]);
  // Aucun trou : toute la surface occupée, ligne par ligne, quel que soit l'ordre des tailles.
  const mix = [{ w: 2, h: 1 }, { w: 1, h: 2 }, { w: 1, h: 1 }, { w: 2, h: 1 }, { w: 1, h: 1 }, { w: 1, h: 2 }, { w: 1, h: 1 }];
  const cells = gridCells({ layout: "custom", cols: 3, spans: mix }, mix.length);
  const placed = placeCells(3, cells.cells);
  const seen = new Set();
  for (const p of placed) for (let y = p.row; y < p.row + p.h; y++) for (let x = p.col; x < p.col + p.w; x++) assert.ok(!seen.has(`${x},${y}`), "deux cases au même endroit");
  for (const p of placed) for (let y = p.row; y < p.row + p.h; y++) for (let x = p.col; x < p.col + p.w; x++) seen.add(`${x},${y}`);
  assert.ok(placed.every((p) => p.col + p.w <= 3));
});

test("1f toCustom : chaque agencement prédéfini devient « Sur mesure » avec la MÊME disposition (rien n'est perdu)", () => {
  for (const layout of GRID_LAYOUTS.filter((l) => l !== "custom")) {
    for (const n of [1, 3, 4, 7]) {
      const c = toCustom({ layout }, n);
      assert.equal(c.layout, "custom");
      // « 1 » (une colonne) devient deux colonnes à cases pleine largeur : même disposition, une case par rangée.
      const before = place({ layout }, n);
      const after = place(c, n);
      assert.deepEqual(after.map((p) => [p.row, p.h]), before.map((p) => [p.row, p.h]), `${layout} × ${n} : rangées`);
      if (layout !== "1") assert.deepEqual(after, before, `${layout} × ${n}`);
    }
  }
  assert.equal(toCustom({ layout: "portrait-right" }, 3).mirror, true);
});

test("1g part des colonnes pour la taille affichée (attribut sizes)", () => {
  assert.equal(cellShare("1+2", 0), 1);
  assert.equal(cellShare("2x2", 3), 2);
  assert.equal(cellShare("portrait-left", 1), 2);
  assert.equal(cellShare({ layout: "custom", cols: 4, spans: [{ w: 2, h: 1 }] }, 0, 3), 2);
  assert.equal(cellShare({ layout: "custom", cols: 4, spans: [] }, 1, 3), 4);
});

/* ---- 2. Opérations ---- */

const base = (extra = {}) => ({ layout: "portrait-left", gap: "normal", children: [kid("a", 1), kid("b", 2), kid("c", 3), kid("d", 4)], ...extra });

test("2a échanger deux cases : images et tailles suivent ; hors limites refusé", () => {
  const p = base({ layout: "custom", cols: 3, spans: [{ w: 1, h: 2 }, { w: 2, h: 1 }, { w: 1, h: 1 }, { w: 1, h: 1 }] });
  const r = applyGridOp(p, { op: "swap", a: 0, b: 1 });
  assert.ok("props" in r);
  assert.deepEqual(uidsOf(r.props), ["b", "a", "c", "d"]);
  assert.deepEqual(r.props.spans.slice(0, 2), [{ w: 2, h: 1 }, { w: 1, h: 2 }]);
  assert.ok("error" in applyGridOp(p, { op: "swap", a: 0, b: 9 }));
  // Sous un agencement prédéfini sans tailles stockées : seules les images changent de place.
  const q = applyGridOp(base(), { op: "swap", a: 1, b: 3 });
  assert.deepEqual(uidsOf(q.props), ["a", "d", "c", "b"]);
  assert.equal("spans" in q.props, false);
});

test("2b déplacer, retirer", () => {
  const m = applyGridOp(base(), { op: "move", from: 0, to: 3 });
  assert.deepEqual(uidsOf(m.props), ["b", "c", "d", "a"]);
  const r = applyGridOp(base({ spans: [{ w: 1, h: 2 }, { w: 1, h: 1 }, { w: 2, h: 1 }, { w: 1, h: 1 }] }), { op: "remove", index: 1 });
  assert.deepEqual(uidsOf(r.props), ["a", "c", "d"]);
  assert.deepEqual(r.props.spans, [{ w: 1, h: 2 }, { w: 2, h: 1 }, { w: 1, h: 1 }]);
  assert.ok("error" in applyGridOp(base(), { op: "remove", index: 4 }));
});

test("2c poser une image : à la suite (case libre), en remplacement (garde cadre et légende, perd le recadrage)", () => {
  const added = applyGridOp(base(), { op: "put", index: 4, child: kid("e", 5) });
  assert.deepEqual(uidsOf(added.props), ["a", "b", "c", "d", "e"]);
  // Au-delà de la dernière : à la suite aussi (le premier index libre).
  assert.deepEqual(uidsOf(applyGridOp(base(), { op: "put", index: 4, child: kid("e", 5) }).props).at(-1), "e");
  const decorated = base({ children: [kid("a", 1, { caption: { fr: "Légende", en: "" }, look: { frame: { size: "thin" }, crop: { mediaId: { x: 10, y: 10, zoom: 2 } } } })] });
  const replaced = applyGridOp(decorated, { op: "put", index: 0, child: kid("zz", 9) });
  const c = replaced.props.children[0];
  assert.equal(c.uid, "a");
  assert.equal(c.props.mediaId, 9);
  assert.deepEqual(c.props.caption, { fr: "Légende", en: "" });
  assert.deepEqual(c.props.look, { frame: { size: "thin" } });
  // Une vidéo à la place d'une image : la case est refaite.
  const video = { uid: "v", type: "video-single", props: { variant: "card", mode: "player", mediaId: 8 } };
  assert.equal(applyGridOp(decorated, { op: "put", index: 0, child: video }).props.children[0].type, "video-single");
  // Pleine : refusé.
  const full = base({ children: Array.from({ length: 24 }, (_, i) => kid(`k${i}`, i + 1)) });
  assert.ok("error" in applyGridOp(full, { op: "put", index: 24, child: kid("x", 1) }));
});

test("2d taille d'une case : passe en « Sur mesure » sans rien perdre, bornes respectées", () => {
  const r = applyGridOp(base(), { op: "span", index: 1, dw: 1 });
  assert.equal(r.props.layout, "custom");
  assert.equal(r.props.cols, 2);
  // La case 0 (portrait) garde ses 2 rangées ; la case 1 passe sur 2 colonnes.
  assert.deepEqual(r.props.spans.slice(0, 3), [{ w: 1, h: 2 }, { w: 2, h: 1 }, { w: 1, h: 1 }]);
  assert.deepEqual(uidsOf(r.props), ["a", "b", "c", "d"]);
  // Trop large : bornée aux colonnes ; moins que 1 : bornée à 1 ; hauteur 2 au plus.
  const wide = applyGridOp(r.props, { op: "span", index: 1, dw: 3 });
  assert.equal(wide.props.spans[1].w, 2);
  const narrow = applyGridOp(r.props, { op: "span", index: 1, dw: -3 });
  assert.equal(narrow.props.spans[1].w, 1);
  const tall = applyGridOp(r.props, { op: "span", index: 2, dh: 2 });
  assert.equal(tall.props.spans[2].h, 2);
  // Elle laisse les mêmes cases pour un motif prédéfini d'une colonne (« 1 » → 2 colonnes pleine largeur).
  const one = applyGridOp({ layout: "1", children: [kid("a", 1), kid("b", 2)] }, { op: "span", index: 0, dh: 1 });
  assert.deepEqual(one.props.spans, [{ w: 2, h: 2 }, { w: 2, h: 1 }]);
});

test("2e réglages : agencement, colonnes (2 à 4), inversion ; le choix « Sur mesure » garde la disposition", () => {
  const custom = applyGridOp(base(), { op: "set", layout: "custom" });
  assert.equal(custom.props.layout, "custom");
  assert.deepEqual(place(custom.props, 4), place(base(), 4));
  const cols = applyGridOp(custom.props, { op: "set", cols: 4 });
  assert.equal(cols.props.cols, 4);
  const narrowed = applyGridOp({ ...cols.props, spans: [{ w: 4, h: 1 }, { w: 1, h: 1 }] }, { op: "set", cols: 2 });
  assert.equal(narrowed.props.spans[0].w, 2);
  // Régler les colonnes depuis un agencement prédéfini passe en « Sur mesure ».
  assert.equal(applyGridOp(base(), { op: "set", cols: 3 }).props.layout, "custom");
  const mirrored = applyGridOp(base({ layout: "portrait-right" }), { op: "set", layout: "custom" });
  assert.equal(mirrored.props.mirror, true);
  assert.equal(applyGridOp(mirrored.props, { op: "set", mirror: false }).props.mirror, undefined);
  // Les autres réglages passent tels quels ; revenir à un agencement prédéfini garde les tailles (retrouvées au retour).
  const back = applyGridOp(custom.props, { op: "set", layout: "3", gap: "none", ratio: "4:3" });
  assert.equal(back.props.layout, "3");
  assert.equal(back.props.gap, "none");
  assert.equal(back.props.ratio, "4:3");
  assert.ok(Array.isArray(back.props.spans));
});

test("2f « Adapter aux images » : un portrait prend 2 rangées, un panorama 2 colonnes ; Annuler = réglages d'avant", () => {
  assert.deepEqual(adaptSpan(0.66, 3), { w: 1, h: 2 });
  assert.deepEqual(adaptSpan(2.4, 3), { w: 2, h: 1 });
  assert.deepEqual(adaptSpan(3.5, 3), { w: 3, h: 1 });
  assert.deepEqual(adaptSpan(1.5, 3), { w: 1, h: 1 });
  assert.deepEqual(adaptSpan(2.4, 2), { w: 2, h: 1 });
  const p = base();
  const r = applyGridOp(p, { op: "adapt", ratios: [0.67, 1.5, 3, 1] });
  assert.equal(r.props.layout, "custom");
  assert.deepEqual(r.props.spans, [{ w: 1, h: 2 }, { w: 1, h: 1 }, { w: 2, h: 1 }, { w: 1, h: 1 }]);
  assert.deepEqual(uidsOf(r.props), ["a", "b", "c", "d"]);
  // Fonction pure : l'original n'est pas touché (c'est ce qui rend « Défaire » exact).
  assert.equal(p.layout, "portrait-left");
  assert.equal(p.spans, undefined);
  assert.ok("error" in applyGridOp({ layout: "2", children: [] }, { op: "adapt", ratios: [] }));
});

/* ---- 3. Schéma, anciennes données ---- */

test("3a schéma : champs du « Sur mesure » bornés ; anciens réglages inchangés (aucune clé ajoutée)", () => {
  const old = gridSchema.parse({ layout: "2x2", gap: "tight", children: [] });
  assert.equal("spans" in old, false);
  assert.equal("cols" in old, false);
  assert.equal("mirror" in old, false);
  assert.equal(gridSchema.parse({ layout: "custom", cols: 4, spans: [{ w: 4, h: 2 }], mirror: true, children: [] }).cols, 4);
  assert.equal(gridSchema.parse({ layout: "portrait-right", children: [] }).layout, "portrait-right");
  assert.equal(gridSchema.safeParse({ layout: "custom", cols: 5, children: [] }).success, false);
  assert.equal(gridSchema.safeParse({ layout: "custom", cols: 1, children: [] }).success, false);
  assert.equal(gridSchema.safeParse({ layout: "custom", spans: [{ w: 5, h: 1 }], children: [] }).success, false);
  assert.equal(gridSchema.safeParse({ layout: "custom", spans: [{ w: 1, h: 3 }], children: [] }).success, false);
  assert.equal(gridSchema.safeParse({ layout: "custom", spans: Array.from({ length: 25 }, () => ({ w: 1, h: 1 })), children: [] }).success, false);
  assert.equal(gridSchema.safeParse({ layout: "spirale", children: [] }).success, false);
  assert.equal(gridSchema.parse({ gap: "none", children: [] }).gap, "none");
});

test("3b grille de page et grille de planche : mêmes données, mêmes contrôles", () => {
  const props = { layout: "custom", cols: 3, spans: [{ w: 1, h: 2 }, { w: 2, h: 1 }], children: [kid("a", 1), kid("b", 2)] };
  // Page : l'arbre de blocs accepte la grille.
  assert.equal(treeProblem([{ uid: "g1", type: "grid", props }], () => true), null);
  // Planche : la suite du projet accepte la même grille, avec ses tailles.
  assert.equal(layoutProblem([{ uid: "bg", type: "grid", props }]), null);
  // Anciennes grilles de planche (sans tailles, case vide d'avant) : toujours valides.
  assert.equal(layoutProblem([{ uid: "bg", type: "grid", props: { layout: "3", children: [{ uid: "e", type: "image", props: { width: "wide" } }] } }]), null);
  assert.equal(layoutProblem([{ uid: "bg", type: "grid", props: { layout: "3", children: [] } }]), null);
  // Une planche n'accepte que des images et des vidéos dans sa grille (inchangé).
  assert.notEqual(layoutProblem([{ uid: "bg", type: "grid", props: { layout: "3", children: [{ uid: "t", type: "rich-text", props: {} }] } }]), null);
});

/* ---- 4. Messages de la toile ---- */

test("4a grid-op, cell-look et cible gcell : valides ou refusés par le schéma", () => {
  const ok = (m) => FromCanvasSchema.safeParse(m).success;
  assert.ok(ok({ kind: "grid-op", uid: "g1", op: { op: "set", layout: "portrait-left" } }));
  assert.ok(ok({ kind: "grid-op", uid: "g1", board: 4, props: "{}", op: { op: "span", index: 2, dw: 1 } }));
  assert.ok(ok({ kind: "grid-op", uid: "g1", op: { op: "adapt" } }));
  assert.ok(ok({ kind: "grid-op", uid: "g1", op: { op: "pick", index: 24, media: "video" } }));
  assert.ok(ok({ kind: "layout", uid: "g1", layout: "custom" }));
  assert.ok(!ok({ kind: "grid-op", uid: "g1", op: { op: "set", layout: "spirale" } }));
  assert.ok(!ok({ kind: "grid-op", uid: "g1", op: { op: "set", cols: 5 } }));
  assert.ok(!ok({ kind: "grid-op", uid: "g1", op: { op: "span", index: 30 } }));
  assert.ok(!ok({ kind: "grid-op", uid: "g1", op: { op: "swap", a: 0 } }));
  assert.ok(!ok({ kind: "grid-op", uid: "G1!", op: { op: "adapt" } }));
  assert.ok(!ok({ kind: "grid-op", uid: "g1", board: -1, op: { op: "adapt" } }));
  assert.ok(ok({ kind: "cell-look", board: 3, grid: "g1", uid: "c1", look: null }));
  assert.ok(!ok({ kind: "cell-look", board: 3, grid: "g1", uid: "c1" }));
  assert.ok(ok({ kind: "drop-target", target: { kind: "gcell", uid: "g1", index: 2 } }));
  assert.ok(ok({ kind: "drop-target", target: { kind: "gcell", uid: "g1", board: 5, index: 0 } }));
  assert.ok(!ok({ kind: "drop-target", target: { kind: "gcell", uid: "g1", index: 99 } }));
});

console.log(`\n${passed} tests passés`);
