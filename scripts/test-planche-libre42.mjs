#!/usr/bin/env node
/**
 * Lot 42 « Planche libre » — tests unitaires (inclus dans npm test), sans serveur :
 *  1. Schéma : valeurs par défaut, bornes (.max), anciennes données inchangées (aucune migration : nouveau type).
 *  2. Opérations (`applyFreeOp`) : poser (centre), déplacer / redimensionner / pivoter (arrondis, bornes), devant / derrière
 *     (rangs recompactés), retirer, remplacer, arrondi et cadre, format de la zone.
 *  3. Repères magnétiques (`snapBox`) et ordre de lecture.
 *  4. Registre, planche de projet (type, vide, médias cités, compteur), références, fond de couleur.
 *  5. Messages de la toile : `free-op` et cible de dépôt `free` (validation).
 * Usage : node --import tsx scripts/test-planche-libre42.mjs
 */
import assert from "node:assert/strict";

import { BOARD_ITEM_LABELS, BOARD_ITEM_TYPES, defaultLayout, itemEmpty, layoutMediaIds, layoutProblem, mediaCount, newBoardItem, readLayout } from "../src/blocks/board-layout.ts";
import { applyFreeOp, FREE_DEFAULT_W, freeBoardSchema, freeItems, itemHeight, MAX_FREE_ITEMS, newFreeId, readingOrder, snapBox, zoneAspect } from "../src/blocks/free-board.ts";
import { extractRefs } from "../src/blocks/refs.ts";
import { BLOCKS } from "../src/blocks/registry.ts";
import { FromCanvasSchema } from "../src/lib/edit/protocol.ts";
import { supportsFond } from "../src/themes/fond.ts";

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

/* ---- 1. Schéma ---- */

test("1a une planche neuve : 3:2, à l'échelle sur téléphone, sans image", () => {
  const p = freeBoardSchema.parse({});
  assert.deepEqual(p, { format: "3:2", phone: "scale", items: [] });
  assert.equal(zoneAspect(p), 1.5);
});

test("1b une image : id, média, x, y, w, rot et z (rot et z par défaut 0)", () => {
  const p = freeBoardSchema.parse({ items: [{ id: "a1", media: 4, x: 1.5, y: -3, w: 20 }] });
  assert.deepEqual(p.items[0], { id: "a1", media: 4, x: 1.5, y: -3, w: 20, rot: 0, z: 0 });
});

test("1c bornes : 40 images au plus, w de 4 à 150, rotation entière de −180 à 180, id bien formé", () => {
  const many = Array.from({ length: MAX_FREE_ITEMS + 1 }, (_, i) => item(`i${i}`));
  assert.equal(freeBoardSchema.safeParse({ items: many }).success, false);
  assert.equal(freeBoardSchema.safeParse({ items: many.slice(0, MAX_FREE_ITEMS) }).success, true);
  for (const bad of [{ w: 3 }, { w: 151 }, { rot: 181 }, { rot: -181 }, { rot: 1.5 }, { x: 151 }, { y: -51 }, { id: "A!" }, { id: "" }, { media: 0 }, { media: 1.5 }, { z: -1 }])
    assert.equal(freeBoardSchema.safeParse({ items: [item("a", bad)] }).success, false, JSON.stringify(bad));
});

test("1d format libre : la hauteur (aspect) est bornée ; un format fixe donne son rapport", () => {
  assert.equal(freeBoardSchema.safeParse({ format: "free", aspect: 0.3 }).success, false);
  assert.equal(freeBoardSchema.safeParse({ format: "free", aspect: 4.1 }).success, false);
  assert.equal(zoneAspect({ format: "free", aspect: 2.5 }), 2.5);
  assert.equal(zoneAspect({ format: "1:1" }), 1);
  assert.ok(Math.abs(zoneAspect({ format: "16:9" }) - 16 / 9) < 1e-9);
  assert.equal(freeBoardSchema.safeParse({ format: "5:4" }).success, false);
});

test("1e une image illisible est ignorée sans faire échouer les autres (lecture tolérante)", () => {
  const items = freeItems({ items: [item("a"), { id: "b" }, "x", item("c")] });
  assert.deepEqual(items.map((i) => i.id), ["a", "c"]);
});

/* ---- 2. Opérations ---- */

test("2a poser : (x, y) est le CENTRE, la hauteur découle du format du média, l'image passe devant", () => {
  const p0 = base([item("a", { z: 3 })]);
  const p = ok(applyFreeOp(p0, { op: "put", id: "n1", media: 9, x: 50, y: 50, ratio: 1.5 }));
  const n = p.items[1];
  assert.equal(n.w, FREE_DEFAULT_W);
  assert.equal(n.x, 35);
  // zone 3:2 et média 3:2 : la hauteur en % vaut la largeur en % → centre à 50 %.
  assert.equal(n.y, 35);
  assert.equal(n.z, 4);
  assert.equal(n.rot, 0);
  assert.equal(p0.items.length, 1, "les réglages d'origine ne sont pas modifiés");
});

test("2b poser : un média portrait dans une zone large est plus haut en % ; le centre reste dans la zone", () => {
  const p = ok(applyFreeOp(base(), { op: "put", id: "n1", media: 9, x: 150, y: -20, ratio: 0.5, w: 20 }));
  const n = p.items[0];
  assert.equal(itemHeight(20, 1.5, 0.5), 60);
  assert.equal(n.x, 90);
  assert.equal(n.y, -30);
});

test("2c poser : refuse les doublons et la 41e image", () => {
  assert.match(applyFreeOp(base([item("a")]), { op: "put", id: "a", media: 1, x: 5, y: 5, ratio: 1 }).error, /double/);
  const full = base(Array.from({ length: MAX_FREE_ITEMS }, (_, i) => item(`i${i}`)));
  assert.match(applyFreeOp(full, { op: "put", id: "zz", media: 1, x: 5, y: 5, ratio: 1 }).error, /40/);
});

test("2d déplacer, redimensionner, pivoter : arrondis (0,01 % et 1°), bornes, champs omis inchangés", () => {
  const p = ok(applyFreeOp(base([item("a")]), { op: "place", id: "a", x: 12.3456, y: -80, w: 3, rot: 200.4 }));
  assert.deepEqual([p.items[0].x, p.items[0].y, p.items[0].w, p.items[0].rot], [12.35, -50, 4, 180]);
  const q = ok(applyFreeOp(p, { op: "place", id: "a", rot: -12.6 }));
  assert.deepEqual([q.items[0].x, q.items[0].rot], [12.35, -13]);
  assert.match(applyFreeOp(p, { op: "place", id: "nope", x: 1 }).error, /n'est plus/);
});

test("2e devant / derrière : les rangs restent 0, 1, 2… sans trou", () => {
  const p0 = base([item("a", { z: 0 }), item("b", { z: 1 }), item("c", { z: 2 })]);
  const front = ok(applyFreeOp(p0, { op: "front", id: "a" }));
  assert.deepEqual(front.items.map((i) => [i.id, i.z]), [["a", 2], ["b", 0], ["c", 1]]);
  const back = ok(applyFreeOp(front, { op: "back", id: "a" }));
  assert.deepEqual(back.items.map((i) => [i.id, i.z]), [["a", 0], ["b", 1], ["c", 2]]);
  const again = ok(applyFreeOp(back, { op: "front", id: "c" }));
  assert.deepEqual(again.items.map((i) => i.z), [0, 1, 2]);
});

test("2g fond image (lot 41) : style bg pose / retire le fond de CETTE image, couleur invalide refusée, zoom et légendes acceptés", () => {
  const p0 = freeBoardSchema.parse({ items: [{ id: "a", media: 1, x: 10, y: 10, w: 20 }, { id: "b", media: 2, x: 40, y: 10, w: 20 }] });
  const s = ok(applyFreeOp(p0, { op: "style", id: "a", bg: "card" }));
  assert.equal(freeItems(s.props)[0].bg, "card");
  assert.equal(freeItems(s.props)[1].bg, undefined);
  const t = ok(applyFreeOp(s.props, { op: "style", id: "a", bg: null }));
  assert.equal(freeItems(t.props)[0].bg, undefined);
  assert.ok(!freeBoardSchema.safeParse({ items: [{ id: "a", media: 1, x: 1, y: 1, w: 20, bg: "red" }] }).success);
  assert.ok(freeBoardSchema.safeParse({ zoom: false, captionTitle: { fr: "a", en: "b" }, caption: { fr: "", en: "" } }).success);
});

test("2f retirer recompacte les rangs ; remplacer garde la place ; style : arrondi et cadre, null les retire", () => {
  const p0 = base([item("a", { z: 0 }), item("b", { z: 5 }), item("c", { z: 9 })]);
  const r = ok(applyFreeOp(p0, { op: "remove", id: "b" }));
  assert.deepEqual(r.items.map((i) => [i.id, i.z]), [["a", 0], ["c", 1]]);
  const rep = ok(applyFreeOp(p0, { op: "replace", id: "a", media: 99 }));
  assert.deepEqual([rep.items[0].media, rep.items[0].x, rep.items[0].w], [99, 10, 30]);
  const s = ok(applyFreeOp(p0, { op: "style", id: "a", radius: "medium", frame: { size: "thin" } }));
  assert.deepEqual([s.items[0].radius, s.items[0].frame], ["medium", { size: "thin" }]);
  const t = ok(applyFreeOp(s, { op: "style", id: "a", radius: null, frame: null }));
  assert.ok(!("radius" in t.items[0]) && !("frame" in t.items[0]));
  assert.match(applyFreeOp(p0, { op: "remove", id: "zz" }).error, /n'est plus/);
});

test("2g format : un format fixe oublie la hauteur libre ; « Hauteur libre » part du format actuel ; la poignée du bas passe en libre", () => {
  const libre = ok(applyFreeOp(base([], { format: "16:9" }), { op: "set", format: "free" }));
  assert.equal(libre.format, "free");
  assert.ok(Math.abs(libre.aspect - 1.78) < 0.01);
  const haut = ok(applyFreeOp(base(), { op: "set", aspect: 2.123456 }));
  assert.deepEqual([haut.format, haut.aspect], ["free", 2.123]);
  const fixe = ok(applyFreeOp(haut, { op: "set", format: "4:3" }));
  assert.ok(!("aspect" in fixe));
  assert.equal(ok(applyFreeOp(base(), { op: "set", phone: "stack" })).phone, "stack");
  assert.equal(freeBoardSchema.safeParse(ok(applyFreeOp(base(), { op: "set", aspect: 99 }))).success, true, "borné, jamais invalide");
});

test("2h newFreeId : conforme au schéma, différent à chaque appel", () => {
  const ids = new Set(Array.from({ length: 50 }, () => newFreeId()));
  assert.equal(ids.size, 50);
  for (const id of ids) assert.match(id, /^[a-z0-9]{1,12}$/);
});

/* ---- 3. Repères magnétiques, ordre de lecture ---- */

test("3a repères : le centre de la zone, ses bords, et les bords / centres des autres images", () => {
  // Une image de 20 × 10 dont le centre est à 51 % : collée au centre (50), repère vertical à 50.
  const c = snapBox({ x: 41, y: 20, w: 20, h: 10 }, [], 2, 2);
  assert.equal(c.box.x, 40);
  assert.deepEqual(c.guides.v, [50]);
  // Bord gauche à 1,2 % : collé au bord de la zone.
  assert.equal(snapBox({ x: 1.2, y: 30, w: 20, h: 10 }, [], 2, 2).box.x, 0);
  // Bord droit de l'autre image (x 10 + w 30 = 40) : le bord gauche de la nôtre s'y colle, et son repère est tracé.
  const o = snapBox({ x: 41.5, y: 60, w: 10, h: 10 }, [{ x: 10, y: 10, w: 30, h: 20 }], 2, 2);
  assert.equal(o.box.x, 40);
  assert.ok(o.guides.v.includes(40));
  // Horizontalement : haut sur le bas de l'autre (10 + 20 = 30).
  const h = snapBox({ x: 70, y: 31, w: 10, h: 10 }, [{ x: 10, y: 10, w: 30, h: 20 }], 2, 2);
  assert.equal(h.box.y, 30);
  assert.deepEqual(h.guides.h, [30]);
});

test("3b repères : rien au-delà de la tolérance ; l'écart le plus petit gagne ; pas de repère sans collage", () => {
  const far = snapBox({ x: 20, y: 20, w: 10, h: 10 }, [{ x: 60, y: 60, w: 10, h: 10 }], 2, 2);
  assert.deepEqual([far.box.x, far.box.y, far.guides.v, far.guides.h], [20, 20, [], []]);
  const two = snapBox({ x: 49.2, y: 5, w: 10, h: 10 }, [{ x: 51, y: 50, w: 4, h: 4 }], 2, 2);
  assert.equal(two.box.x, 50, "50 (écart 0,8) plutôt que 51 (écart 1,8)");
});

test("3c ordre de lecture : de haut en bas, puis de gauche à droite", () => {
  const items = [item("c", { x: 60, y: 50 }), item("a", { x: 50, y: 5 }), item("b", { x: 5, y: 50 }), item("d", { x: 5, y: 5 })];
  assert.deepEqual(readingOrder(items).map((i) => i.id), ["d", "a", "b", "c"]);
});

/* ---- 4. Registre, planche de projet ---- */

test("4a registre : type « free-board » dans Images et vidéos, schéma commun, publication exige une image", () => {
  const def = BLOCKS["free-board"];
  assert.equal(def.label, "Planche libre");
  assert.equal(def.group, "media");
  assert.ok(Number.isFinite(def.order));
  assert.ok(def.schema.safeParse(def.defaults).success);
  assert.ok(def.publishCheck(def.defaults, {}));
  assert.equal(def.publishCheck(base([item("a")]), {}), null);
  assert.equal(def.deprecated, undefined);
});

test("4b références : chaque image cite un média (compteur « utilisée dans… », blocage de suppression)", () => {
  assert.deepEqual(extractRefs("free-board", base([item("a", { media: 3 }), item("b", { media: 8 })])).media, [3, 8]);
});

test("4c fond de couleur : la planche libre en reçoit un (« carte dans la carte »)", () => {
  assert.equal(supportsFond("free-board"), true);
  const def = BLOCKS["free-board"];
  const withBg = def.schema.parse({ ...base([item("a")]), background: { kind: "color", color: "#ffffff" } });
  assert.equal(withBg.background.color, "#ffffff");
});

test("4d planche de projet : le type est proposé, validé, vide ou non, ses médias sont cités et comptés", () => {
  assert.ok(BOARD_ITEM_TYPES.includes("free-board"));
  assert.equal(BOARD_ITEM_LABELS["free-board"], "Planche libre");
  const neuf = newBoardItem("free-board", "fb1");
  assert.deepEqual(neuf.props, { format: "3:2", phone: "scale", items: [] });
  assert.equal(itemEmpty(neuf), true);
  const rempli = { uid: "fb1", type: "free-board", props: base([item("a", { media: 5 }), item("b", { media: 6 })]) };
  assert.equal(itemEmpty(rempli), false);
  assert.deepEqual(layoutMediaIds([rempli]), [5, 6]);
  assert.equal(mediaCount([rempli]), 2);
  assert.equal(layoutProblem([...defaultLayout(), rempli]), null);
  assert.equal(layoutProblem([{ uid: "x1", type: "free-board", props: { children: [] } }]), "Seule une grille en porte d'autres.");
  assert.equal(readLayout([...defaultLayout(), rempli]).length, 2);
});

test("4e aucune migration : une planche d'avant (sans free-board) se lit comme avant", () => {
  const avant = [{ uid: "strip", type: "strip", props: {} }, { uid: "g1", type: "grid", props: { layout: "2", children: [] } }, { uid: "i1", type: "image", props: { mediaId: 3 } }];
  assert.equal(layoutProblem(avant), null);
  assert.deepEqual(readLayout(avant), avant);
  assert.deepEqual(layoutMediaIds(avant), [3]);
});

/* ---- 5. Messages de la toile ---- */

const parse = (m) => FromCanvasSchema.safeParse({ type: "portfolio:edit", ...m }).success;
test("5a free-op : opérations valides (page et planche) et refus des valeurs hors bornes ou inconnues", () => {
  const msg = (op, extra = {}) => ({ kind: "free-op", uid: "fb1", op, ...extra });
  assert.ok(parse(msg({ op: "place", id: "a1", x: 12.5, y: 40, w: 25, rot: -30 })));
  assert.ok(parse(msg({ op: "place", id: "a1", x: 12.5 }, { board: 4, props: "{}" })));
  for (const op of ["front", "back", "remove"]) assert.ok(parse(msg({ op, id: "a1" })));
  assert.ok(parse(msg({ op: "pick" })));
  assert.ok(parse(msg({ op: "pick", id: "a1" })));
  assert.ok(parse(msg({ op: "set", format: "free", aspect: 2 })));
  assert.ok(parse(msg({ op: "style", id: "a1", radius: null, frame: { size: "medium" } })));
  assert.equal(parse(msg({ op: "place", id: "a1", x: 999 })), false);
  assert.equal(parse(msg({ op: "place", id: "a1", rot: 400 })), false);
  assert.equal(parse(msg({ op: "place", id: "A 1" })), false);
  assert.equal(parse(msg({ op: "set", aspect: 9 })), false);
  assert.equal(parse(msg({ op: "set", format: "7:5" })), false);
  assert.equal(parse(msg({ op: "delete", id: "a1" })), false);
  assert.equal(parse(msg({ op: "place", id: "a1", x: 1 }, { props: "x".repeat(100_001) })), false);
});

test("5b cible de dépôt « free » : point visé borné ; fichiers et média de la médiathèque", () => {
  const files = (target) => ({ kind: "files", target, files: [new File(["x"], "a.png", { type: "image/png" })] });
  assert.ok(parse(files({ kind: "free", uid: "fb1", x: 12, y: 80 })));
  assert.ok(parse(files({ kind: "free", uid: "fb1", board: 3, props: "{}", x: 0, y: 100 })));
  assert.equal(parse(files({ kind: "free", uid: "fb1", x: 500, y: 1 })), false);
  assert.equal(parse(files({ kind: "free", uid: "fb1", x: 1 })), false);
  assert.ok(parse({ kind: "drop-target", target: { kind: "free", uid: "fb1", x: 3, y: 4 } }));
  assert.ok(parse({ kind: "bitem-add", board: 2, item: "free-board", index: 0 }));
});

console.log(`\n${passed} tests passent.`);
