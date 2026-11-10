#!/usr/bin/env node
/**
 * Lot 132 — animations dessinées image par image + boiling line. Unitaire (sharp, sans serveur), données SYNTHÉTIQUES. ÉCRIT AVANT le code.
 *  1. planSheet : bornes (2 à 48 images, côté 16 383 px, 40 Mpx) ; réduction proportionnelle ; refus hors bornes.
 *  2. assembleFrames : des PNG numérotés deviennent UNE feuille WebP (bande horizontale), chaque case a la couleur de son image.
 *  3. splitSheet : une feuille de sprites (colonnes × rangées) donne les mêmes images ; bornes.
 *  4. framesFromZip : ordre naturel (img2 < img10), fichiers étrangers et dossiers ignorés, bombe / trop d'entrées refusées.
 *  5. Image démesurée (> 40 Mpx) refusée avant tout décodage.
 *  6. Données : anim lue dans `variants.anim`, absente = null ; animStyle (durée = images ÷ cadence) ; cadences permises.
 *  7. Schémas : fps / loop facultatifs (image seule, planche libre), anciennes données lues à l'identique.
 *  8. pictureSources sans AVIF (la feuille n'a que du WebP).
 *  9. Boiling line : `kit.boil` facultatif (3 à 6 dessins), CSS émise seulement s'il existe ; sans lui, variables et attributs identiques.
 * Usage : node --import tsx scripts/test-animation132.mjs
 */
import assert from "node:assert/strict";

import sharp from "sharp";

import { writeZip } from "../src/lib/themes/zip.ts";

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log(`PASS  ${name}`);
};
const {
  ANIM_FPS, ANIM_MAX_FRAMES, SHEET_MAX_PIXELS, SHEET_MAX_SIDE, AnimError, planSheet, animOf, animStyle,
} = await import("../src/lib/animation/sheet.ts");
const { assembleFrames, splitSheet, framesFromZip } = await import("../src/lib/animation/assemble.ts");

const png = (w, h, rgb) => sharp({ create: { width: w, height: h, channels: 4, background: { r: rgb[0], g: rgb[1], b: rgb[2], alpha: 1 } } }).png().toBuffer();
const COLORS = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [0, 255, 255], [255, 0, 255]];
const px = async (buf, x, y) => {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * 4;
  return [data[i], data[i + 1], data[i + 2]];
};
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 12);

await test("planSheet : bornes et réduction", () => {
  assert.deepEqual(ANIM_FPS, [6, 8, 12, 24]);
  const ok = planSheet(6, 200, 100);
  assert.deepEqual([ok.fw, ok.fh, ok.sw, ok.sh, ok.scaled], [200, 100, 1200, 100, false]);
  const wide = planSheet(24, 2000, 1000);
  assert.ok(wide.sw <= SHEET_MAX_SIDE && wide.sw * wide.sh <= SHEET_MAX_PIXELS && wide.scaled);
  assert.ok(Math.abs(wide.fw / wide.fh - 2) < 0.02, "le format d'une image est gardé");
  const tall = planSheet(48, 300, 12000);
  assert.ok(tall.sh <= SHEET_MAX_SIDE && tall.sw * tall.sh <= SHEET_MAX_PIXELS);
  assert.throws(() => planSheet(1, 100, 100), AnimError);
  assert.throws(() => planSheet(ANIM_MAX_FRAMES + 1, 100, 100), AnimError);
  assert.throws(() => planSheet(4, 0, 100), AnimError);
});

await test("assembleFrames : des PNG numérotés → une feuille WebP", async () => {
  const frames = await Promise.all(COLORS.slice(0, 4).map((c) => png(120, 80, c)));
  const { sheet, meta } = await assembleFrames(frames);
  assert.deepEqual(meta, { frames: 4, fw: 120, fh: 80 });
  const info = await sharp(sheet).metadata();
  assert.equal(info.format, "webp");
  assert.deepEqual([info.width, info.height], [480, 80]);
  for (let i = 0; i < 4; i++) assert.ok(near(await px(sheet, i * 120 + 60, 40), COLORS[i]), `case ${i}`);
});

await test("assembleFrames : image de taille différente centrée, première image = référence ; refus d'un fichier illisible", async () => {
  const { meta, sheet } = await assembleFrames([await png(100, 100, COLORS[0]), await png(50, 100, COLORS[1])]);
  assert.deepEqual(meta, { frames: 2, fw: 100, fh: 100 });
  assert.ok(near(await px(sheet, 150, 50), COLORS[1]));
  assert.equal((await px(sheet, 102, 50)).join() !== COLORS[1].join(), true);
  const one = await png(10, 10, COLORS[0]);
  await assert.rejects(() => assembleFrames([one, Buffer.from("pas une image")]), AnimError);
  await assert.rejects(() => assembleFrames([one]), AnimError);
});

await test("splitSheet : colonnes × rangées", async () => {
  const cells = [];
  for (let i = 0; i < 6; i++) cells.push({ input: await png(50, 40, COLORS[i]), left: (i % 3) * 50, top: Math.floor(i / 3) * 40 });
  const sheet = await sharp({ create: { width: 150, height: 80, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(cells).png().toBuffer();
  const frames = await splitSheet(sheet, 3, 2);
  assert.equal(frames.length, 6);
  for (let i = 0; i < 6; i++) assert.ok(near(await px(frames[i], 25, 20), COLORS[i]));
  assert.equal((await splitSheet(sheet, 3, 2, 5)).length, 5);
  await assert.rejects(() => splitSheet(sheet, 1, 1), AnimError);
  await assert.rejects(() => splitSheet(sheet, 7, 7), AnimError);
  await assert.rejects(() => splitSheet(sheet, 4, 2), AnimError, "150 px ne se divise pas en 4");
});

await test("framesFromZip : ordre naturel, intrus ignorés, bornes", async () => {
  const entries = [];
  for (const n of [10, 2, 1]) entries.push({ name: `anim/img${n}.png`, data: await png(8, 8, COLORS[n % 6]) });
  entries.push({ name: "anim/notes.txt", data: Buffer.from("x") }, { name: "__MACOSX/anim/._img1.png", data: Buffer.from("x") });
  const frames = await framesFromZip(writeZip(entries));
  assert.equal(frames.length, 3);
  assert.ok(near(await px(frames[0], 4, 4), COLORS[1]) && near(await px(frames[1], 4, 4), COLORS[2]) && near(await px(frames[2], 4, 4), COLORS[10 % 6]));
  await assert.rejects(() => framesFromZip(Buffer.from("PK pas une archive")), AnimError);
  await assert.rejects(() => framesFromZip(writeZip([{ name: "a.txt", data: Buffer.from("x") }])), AnimError);
  const many = Array.from({ length: ANIM_MAX_FRAMES + 1 }, (_, i) => ({ name: `f${String(i).padStart(3, "0")}.png`, data: Buffer.from("x") }));
  await assert.rejects(() => framesFromZip(writeZip(many)), AnimError);
});

await test("image démesurée refusée avant décodage (40 Mpx)", async () => {
  const big = await sharp({ create: { width: 9000, height: 5000, channels: 3, background: "#fff" } }).png({ compressionLevel: 9 }).toBuffer();
  await assert.rejects(() => assembleFrames([big, big]), AnimError);
});

await test("données : variants.anim et animStyle", () => {
  assert.equal(animOf(null), null);
  assert.equal(animOf({ v: 1, files: [{ key: "img/a", w: 1, h: 1, format: "webp", size: 1 }] }), null);
  assert.equal(animOf({ v: 1, files: [], anim: { frames: 1, fw: 10, fh: 10 } }), null);
  assert.deepEqual(animOf({ v: 1, files: [], anim: { frames: 6, fw: 200, fh: 100 } }), { frames: 6, fw: 200, fh: 100 });
  const s = animStyle({ frames: 6, fw: 200, fh: 100 }, 12);
  assert.equal(s["--af-n"], 6);
  assert.equal(s["--af-d"], "0.5s");
  assert.equal(animStyle({ frames: 24, fw: 1, fh: 1 }, 24)["--af-d"], "1s");
});

await test("schémas : fps / loop facultatifs, anciennes données identiques", async () => {
  const { imageSchema } = await import("../src/blocks/ImageBlock.tsx");
  const { freeBoardSchema, freeItems } = await import("../src/blocks/free-board.ts");
  const old = imageSchema.parse({ mediaId: 3, width: "wide" });
  assert.ok(!("fps" in old) && !("loop" in old));
  const on = imageSchema.parse({ mediaId: 3, fps: 12, loop: false });
  assert.equal(on.fps, 12);
  assert.equal(on.loop, false);
  assert.ok(!imageSchema.safeParse({ mediaId: 3, fps: 7 }).success);
  const board = { format: "4:3", phone: "scale", items: [{ id: "a1", media: 3, x: 1, y: 1, w: 30, rot: 0, z: 0 }] };
  assert.ok(!("fps" in freeBoardSchema.parse(board).items[0]));
  const withFps = freeBoardSchema.parse({ ...board, items: [{ ...board.items[0], fps: 24, loop: false }] });
  assert.equal(freeItems(withFps)[0].fps, 24);
  assert.ok(!freeBoardSchema.safeParse({ ...board, items: [{ ...board.items[0], fps: 5 }] }).success);
});

await test("pictureSources sans AVIF", async () => {
  const { pictureSources } = await import("../src/lib/images/variants.ts");
  const s = pictureSources({ v: 1, files: [{ key: "img/0123456789abcdef/1200.webp", w: 1200, h: 100, format: "webp", size: 10 }] }, (k) => `/media/${k}`, null);
  assert.equal(s.avif, "");
  assert.equal(s.largest.webp, "/media/img/0123456789abcdef/1200.webp");
});

await test("boiling line : kit.boil facultatif, sans lui rien ne change", async () => {
  const { ThemeSchema } = await import("../src/themes/schema.ts");
  const { kitVariables, kitAttributes } = await import("../src/themes/css.ts");
  const { boilCss, BOIL_MIN, BOIL_MAX } = await import("../src/lib/animation/boil.ts");
  const img = (n) => ({ svg: `/media/kit/${String(n).padStart(16, "0")}.svg`, w: 1200, h: 80 });
  const base = { stroke: img(1), signature: img(2) };
  const vars0 = kitVariables(base);
  const attrs0 = kitAttributes(base);
  assert.ok(!Object.keys(vars0).some((k) => k.includes("boil")) && !Object.keys(attrs0).some((k) => k.includes("boil")));
  assert.equal(boilCss(base), "");
  const boil = { stroke: [img(3), img(4)], signature: [img(5), img(6), img(7)] };
  const kit = { ...base, boil };
  const attrs = kitAttributes(kit);
  assert.ok("data-kit-boil" in attrs);
  const css = boilCss(kit);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /steps\(/);
  assert.ok(!/<|javascript:|url\(\s*["']?https?:/i.test(css));
  assert.deepEqual([BOIL_MIN, BOIL_MAX], [2, 6]);
  // Les variables d'avant sont inchangées.
  for (const [k, v] of Object.entries(vars0)) assert.equal(kitVariables(kit)[k], v);
  assert.ok(Object.keys(kitVariables(kit)).some((k) => k.startsWith("--t-kit-boil-stroke-")));
  // Schéma : 2 à 6 dessins (le dessin de base + 1 à 5), au-delà refusé.
  const parse = (b) => ThemeSchema.shape.assets.safeParse({ kit: { ...base, boil: b } });
  assert.ok(parse(boil).success);
  assert.ok(!parse({ stroke: [img(1), img(2), img(3), img(4), img(5), img(6)] }).success);
  assert.ok(!parse({ stroke: [{ svg: "/media/kit/../x.svg", w: 1, h: 1 }] }).success);
});

await test("planche libre : réglages fps / loop par image (media-look)", async () => {
  const { applyFreeLook, freeItems } = await import("../src/blocks/free-board.ts");
  const { MediaPatchSchema, applyMediaPatch } = await import("../src/lib/edit/media-look.ts");
  const board = { format: "4:3", phone: "scale", items: [{ id: "a1", media: 3, x: 1, y: 1, w: 30, rot: 0, z: 0 }, { id: "b2", media: 4, x: 50, y: 1, w: 30, rot: 0, z: 1 }] };
  assert.ok(MediaPatchSchema.safeParse({ fps: 12 }).success && MediaPatchSchema.safeParse({ loop: false }).success);
  assert.ok(!MediaPatchSchema.safeParse({ fps: 7 }).success);
  const set = applyFreeLook(board, "a1", { fps: 24, loop: false });
  assert.ok("props" in set);
  assert.deepEqual([freeItems(set.props)[0].fps, freeItems(set.props)[0].loop, freeItems(set.props)[1].fps], [24, false, undefined]);
  const back = applyFreeLook(set.props, "a1", { fps: 8, loop: true });
  assert.ok("props" in back && !("fps" in back.props.items[0]) && !("loop" in back.props.items[0]), "les défauts ne s'écrivent jamais");
  const gone = applyFreeLook(set.props, "a1", { fps: null, loop: null });
  assert.ok("props" in gone && !("fps" in gone.props.items[0]));
  assert.ok("error" in applyMediaPatch(undefined, { fps: 12 }), "ailleurs que dans la planche libre : refusé");
  assert.ok("error" in applyMediaPatch(undefined, { fps: 12 }, "slot-1"));
});

await test("journal : la route d'envoi d'une animation a son libellé", async () => {
  const { SPECS } = await import("../src/lib/journal/catalog.ts");
  assert.equal(SPECS["route:animation"]?.type, "import");
  assert.ok(SPECS["route:animation"].label.length > 5);
});

console.log(`\n${passed} test(s) passés`);
