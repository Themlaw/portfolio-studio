#!/usr/bin/env node
/**
 * Lot 127 (son activé par défaut, réglable par vidéo ; plein écran) : tests unitaires (inclus dans npm test), sans serveur.
 *  1. Module pur `video-sound` : « on » / « off », absent = activé, valeur inconnue = activé.
 *  2. Données facultatives `sound` : composant Vidéo, place de carrousel (`slotLook`), ligne de la planche libre ; valeur inconnue refusée ;
 *     une ancienne donnée se lit à l'identique et ne gagne aucun champ en passant par les opérations.
 *  3. Écritures : `media-look` (place, planche libre ; refusé sur un média seul), opération de grille `video-sound`, message `video-sound` du protocole.
 *  4. Conversion grille <-> carrousel : le réglage suit, l'aller-retour reste exact.
 *  5. Le visiteur prime (module `visitor-sound`), plein écran : composants d'icônes isolés et nommés (lot 121).
 * Usage : node --import tsx scripts/test-sound127.mjs
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { applyFreeLook, freeBoardSchema, freeItems } from "../src/blocks/free-board.ts";
import { applyGridOp } from "../src/blocks/grid-layouts.ts";
import { convertItem } from "../src/blocks/grid-strip.ts";
import { VIDEO_SOUNDS, isVideoSound, soundOf } from "../src/blocks/video-sound.ts";
import { videoSingleSchema } from "../src/blocks/VideoSingleBlock.tsx";
import { applyMediaPatch, MediaPatchSchema } from "../src/lib/edit/media-look.ts";
import { acceptFromCanvas, EDIT_MSG } from "../src/lib/edit/protocol.ts";
import { LookSchema, readLook } from "../src/lib/look.ts";

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log(`PASS  ${name}`);
};
const clone = (v) => JSON.parse(JSON.stringify(v));
const ROOT = new URL("../", import.meta.url).pathname;

await test("1 module video-sound : activé par défaut, valeur inconnue = activé", () => {
  assert.deepEqual([...VIDEO_SOUNDS], ["on", "off"]);
  assert.ok(isVideoSound("on") && isVideoSound("off") && !isVideoSound("auto") && !isVideoSound(undefined));
  assert.equal(soundOf(undefined), "on");
  assert.equal(soundOf({}), "on");
  assert.equal(soundOf({ sound: "off" }), "off");
  assert.equal(soundOf({ sound: "zzz" }), "on");
});

await test("2a composant Vidéo : `sound` facultatif, ancien composant inchangé", () => {
  const old = videoSingleSchema.parse({ mediaId: 3, variant: "card", mode: "loop" });
  assert.ok(!("sound" in old) || old.sound === undefined);
  assert.equal(videoSingleSchema.parse({ mediaId: 3, sound: "off" }).sound, "off");
  assert.ok(!videoSingleSchema.safeParse({ mediaId: 3, sound: "muet" }).success);
});

await test("2b place de carrousel : `slotLook[slug].sound` lu, valeur inconnue refusée", () => {
  const look = LookSchema.parse({ slotLook: { "r-a1": { sound: "off" } } });
  assert.equal(look.slotLook["r-a1"].sound, "off");
  assert.equal(readLook({ slotLook: { "r-a1": { video: "loop" } } }).slotLook["r-a1"].sound, undefined);
  assert.ok(!LookSchema.safeParse({ slotLook: { "r-a1": { sound: "loud" } } }).success);
});

await test("2c planche libre : `sound` sur la ligne, ancienne planche inchangée", () => {
  const legacy = { format: "4:3", phone: "stack", items: [{ id: "a1", media: 3, x: 10, y: 10, w: 30, rot: 5, z: 0 }] };
  assert.ok(freeItems(legacy).every((i) => i.sound === undefined));
  assert.ok(freeBoardSchema.parse(legacy).items.every((i) => !("sound" in i)));
  const s = freeBoardSchema.parse({ ...legacy, items: [{ ...legacy.items[0], sound: "off" }] });
  assert.equal(s.items[0].sound, "off");
  assert.ok(!freeBoardSchema.safeParse({ ...legacy, items: [{ ...legacy.items[0], sound: "x" }] }).success);
});

await test("3a media-look `sound` : place de carrousel et planche libre, jamais sur un média seul", () => {
  assert.ok(MediaPatchSchema.safeParse({ sound: "off" }).success);
  assert.ok(MediaPatchSchema.safeParse({ sound: null }).success);
  assert.ok(!MediaPatchSchema.safeParse({ sound: "auto" }).success);
  const slot = applyMediaPatch({ spaceTop: "l" }, { sound: "off" }, "rail-aa1");
  assert.ok("look" in slot);
  assert.equal(slot.look.slotLook["rail-aa1"].sound, "off");
  assert.equal(slot.look.spaceTop, "l");
  const back = applyMediaPatch(slot.look, { sound: null }, "rail-aa1");
  assert.ok("look" in back);
  assert.equal(back.look?.slotLook, undefined, "plus aucun réglage : la place disparaît");
  assert.ok("error" in applyMediaPatch(undefined, { sound: "off" }), "pas sur une image seule / une case : elle a `props.sound`");
  const legacy = { format: "4:3", phone: "stack", items: [{ id: "a1", media: 3, x: 10, y: 10, w: 30, rot: 5, z: 0 }, { id: "b2", media: 4, x: 50, y: 20, w: 30, rot: 0, z: 1 }] };
  const set = applyFreeLook(legacy, "a1", { sound: "off" });
  assert.ok("props" in set);
  assert.equal(freeItems(set.props)[0].sound, "off");
  assert.equal(freeItems(set.props)[1].sound, undefined);
  const reset = applyFreeLook(set.props, "a1", { sound: null });
  assert.ok("props" in reset);
  assert.ok(!("sound" in reset.props.items[0]));
});

await test("3b grille : l'opération `video-sound` règle la case d'une vidéo, jamais une image", () => {
  const kid = (uid, type, props) => ({ uid, type, props });
  const props = { layout: "2", children: [kid("i", "image", { mediaId: 1 }), kid("v", "video-single", { mediaId: 2, mode: "loop" })] };
  const res = applyGridOp(props, { op: "video-sound", index: 1, sound: "off" });
  assert.ok("props" in res);
  assert.equal(res.props.children[1].props.sound, "off");
  assert.equal(res.props.children[1].props.mode, "loop", "le reste de la case ne bouge pas");
  assert.equal(props.children[1].props.sound, undefined, "l'original n'est pas modifié");
  assert.ok("error" in applyGridOp(props, { op: "video-sound", index: 0, sound: "off" }));
  assert.ok("error" in applyGridOp(props, { op: "video-sound", index: 9, sound: "off" }));
  const back = applyGridOp(res.props, { op: "video-sound", index: 1, sound: "on" });
  assert.ok("props" in back);
  assert.equal(back.props.children[1].props.sound, undefined, "« activé » est le défaut : le champ disparaît");
});

await test("3c protocole : message `video-sound` et opération de grille acceptés, valeur inconnue refusée", () => {
  const origin = "https://portfolio.example";
  const frame = { name: "toile" };
  const msg = (data) => ({ origin, source: frame, data: { type: EDIT_MSG, ...data } });
  assert.equal(acceptFromCanvas(msg({ kind: "video-sound", uid: "b1", sound: "off" }), origin, frame)?.sound, "off");
  assert.equal(acceptFromCanvas(msg({ kind: "video-sound", uid: "b1", board: 3, item: "video-single", props: "{}", sound: "on" }), origin, frame)?.board, 3);
  assert.equal(acceptFromCanvas(msg({ kind: "video-sound", uid: "b1", sound: "loud" }), origin, frame), null);
  assert.equal(acceptFromCanvas(msg({ kind: "grid-op", uid: "g", op: { op: "video-sound", index: 2, sound: "off" } }), origin, frame)?.op?.sound, "off");
  assert.equal(acceptFromCanvas(msg({ kind: "grid-op", uid: "g", op: { op: "video-sound", index: 2, sound: "zzz" } }), origin, frame), null);
  assert.equal(acceptFromCanvas(msg({ kind: "media-look", target: { kind: "free", uid: "u1", id: "a1" }, patch: { sound: "off" } }), origin, frame)?.patch?.sound, "off");
});

await test("4 conversion grille <-> carrousel : le réglage du son suit, l'aller-retour reste exact", () => {
  const T = (s) => ({ fr: s, en: s });
  const grid = {
    uid: "g1",
    type: "grid",
    props: {
      layout: "2",
      gap: "normal",
      align: "stretch",
      ratio: "auto",
      top: "gap",
      children: [
        { uid: "ka1", type: "video-single", props: { variant: "card", mode: "loop", mediaId: 13, sound: "off", description: T("Clip") } },
        { uid: "kb2", type: "video-single", props: { variant: "card", mode: "player", mediaId: 14 } },
      ],
    },
  };
  let n = 0;
  const ctx = (look) => ({ kinds: { 13: "video", 14: "video" }, newUid: () => `n${++n}`, look });
  const a = convertItem(clone(grid), "strip", ctx({}));
  assert.ok(!("error" in a), JSON.stringify(a));
  const slugs = Object.keys(a.look.slotLook);
  assert.equal(a.look.slotLook[slugs.find((s) => a.look.slotLook[s].video === "loop")].sound, "off", "le son coupé passe sur la place");
  assert.ok(slugs.every((s) => a.look.slotLook[s].sound !== "on"));
  const b = convertItem(clone(a.item), "grid", ctx(clone(a.look)));
  assert.ok(!("error" in b), JSON.stringify(b));
  assert.deepEqual(b.item, grid, "la grille revient exactement, son compris");
});

await test("5a le choix du visiteur prime sur le réglage de la vidéo", async () => {
  const m = await import("../src/components/visitor-sound.ts");
  m.resetVisitorSound();
  assert.equal(m.wantsSound(true), true);
  assert.equal(m.wantsSound(false), false);
  m.setVisitorSound(false);
  assert.equal(m.wantsSound(true), false, "le visiteur a coupé : même une vidéo « activé » reste muette");
  m.setVisitorSound(true);
  assert.equal(m.wantsSound(false), true, "le visiteur a remis le son : même une vidéo « coupé » parle");
  m.resetVisitorSound();
  assert.equal(m.wantsSound(false), false);
});

await test("5b icônes vidéo : composants isolés et nommés (le lot 121 les remplacera)", () => {
  const file = "src/components/video-icons.tsx";
  assert.ok(existsSync(ROOT + file), `${file} existe`);
  const src = readFileSync(ROOT + file, "utf8");
  for (const name of ["SoundOnIcon", "SoundOffIcon", "FullscreenIcon", "ExitFullscreenIcon", "LoopIcon", "PlayIcon", "PauseIcon"]) {
    assert.match(src, new RegExp(`export function ${name}\\b`), `${name} exporté`);
  }
  for (const consumer of ["LoopVideo.tsx", "VideoPlayer.tsx", "VideoBadge.tsx"]) {
    const s = readFileSync(`${ROOT}src/components/${consumer}`, "utf8");
    assert.match(s, /video-icons/, `${consumer} utilise les icônes isolées`);
    assert.ok(!/<path d="M4 9h4l5-4v14l-5-4H4Z"/.test(s), `${consumer} ne dessine plus le haut-parleur en ligne`);
  }
});

console.log(`test-sound127 : ${passed} PASS`);
