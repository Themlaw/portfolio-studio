#!/usr/bin/env node
/**
 * Lot 116 — planche libre : réglages d'une VIDÉO (données facultatives, anciennes planches inchangées). Unitaire, sans serveur.
 *  1. Une ancienne planche (sans `video` ni `poster`) se lit à l'identique et ne gagne aucun champ en passant par les opérations.
 *  2. `media-look` avec `video` : écrit sur la ligne de l'élément (planche libre), `null` le retire ; le panorama reste refusé.
 *  3. Opération `poster` : pose / retire l'affiche, élément inconnu refusé.
 *  4. Le protocole accepte `poster` et `pick` avec `poster`, refuse un identifiant ou un média invalides.
 *  5. Références : l'affiche est comptée comme usage du média.
 * Usage : node --import tsx scripts/test-free116.mjs
 */
import assert from "node:assert/strict";

import { applyFreeLook, applyFreeOp, freeBoardSchema, freeItems } from "../src/blocks/free-board.ts";
import { FreeCanvasOpSchema, MediaTargetSchema } from "../src/lib/edit/protocol.ts";
import { MediaPatchSchema } from "../src/lib/edit/media-look.ts";
import { BLOCK_REFS as REFS } from "../src/blocks/refs.ts";

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`PASS  ${name}`);
};
const legacy = { format: "4:3", phone: "stack", items: [{ id: "a1", media: 3, x: 10, y: 10, w: 30, rot: 5, z: 0 }, { id: "b2", media: 4, x: 50, y: 20, w: 30, rot: 0, z: 1, frame: undefined }] };

test("ancienne planche : lecture identique, aucun champ vidéo ajouté", () => {
  const items = freeItems(legacy);
  assert.equal(items.length, 2);
  assert.ok(items.every((i) => i.video === undefined && i.poster === undefined));
  const parsed = freeBoardSchema.parse(legacy);
  assert.ok(parsed.items.every((i) => !("video" in i) && !("poster" in i)));
  const moved = applyFreeOp(legacy, { op: "place", id: "a1", x: 20 });
  assert.ok("props" in moved && moved.props.items.every((i) => !("video" in i) && !("poster" in i)));
});

test("media-look `video` sur un élément de planche libre", () => {
  const set = applyFreeLook(legacy, "a1", { video: "player" });
  assert.ok("props" in set);
  assert.equal(freeItems(set.props)[0].video, "player");
  assert.equal(freeItems(set.props)[1].video, undefined);
  const back = applyFreeLook(set.props, "a1", { video: null });
  assert.ok("props" in back);
  assert.ok(!("video" in back.props.items[0]));
  const pano = applyFreeLook(legacy, "a1", { pano: "scroll" });
  assert.ok("error" in pano);
  assert.ok("error" in applyFreeLook(legacy, "zz", { video: "loop" }));
  assert.ok(MediaPatchSchema.safeParse({ video: "loop" }).success);
  assert.ok(!MediaPatchSchema.safeParse({ video: "auto" }).success);
});

test("opération `poster`", () => {
  const a = applyFreeOp(legacy, { op: "poster", id: "b2", media: 9 });
  assert.ok("props" in a);
  assert.equal(freeItems(a.props)[1].poster, 9);
  const b = applyFreeOp(a.props, { op: "poster", id: "b2", media: null });
  assert.ok("props" in b);
  assert.ok(!("poster" in b.props.items[1]));
  assert.ok("error" in applyFreeOp(legacy, { op: "poster", id: "nope", media: 9 }));
});

test("protocole : poster / pick poster", () => {
  assert.ok(FreeCanvasOpSchema.safeParse({ op: "poster", id: "a1", media: 5 }).success);
  assert.ok(FreeCanvasOpSchema.safeParse({ op: "poster", id: "a1", media: null }).success);
  assert.ok(!FreeCanvasOpSchema.safeParse({ op: "poster", id: "A 1", media: 5 }).success);
  assert.ok(!FreeCanvasOpSchema.safeParse({ op: "poster", id: "a1", media: -2 }).success);
  assert.ok(FreeCanvasOpSchema.safeParse({ op: "pick", id: "a1", poster: true }).success);
  assert.ok(MediaTargetSchema.safeParse({ kind: "free", uid: "u1", id: "a1" }).success);
});

test("références : l'affiche est un usage du média", () => {
  assert.ok(REFS["free-board"].media.includes("items[].poster"));
  assert.ok(REFS["free-board"].media.includes("items[].media"));
});

console.log(`test-free116 : ${passed} PASS`);
