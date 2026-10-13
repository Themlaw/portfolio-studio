#!/usr/bin/env node
/**
 * Visuels du tutoriel du kit Photoshop pour le kit v4 (lot 17e), tirés du VRAI export
 * (buildKitMulti : les trois PSD, composites rendus par l'export) — sans serveur ni
 * navigateur : vue d'ensemble des trois fichiers, LISEZ-MOI du décor, carte du logo
 * lue case par case, et une carte par élément au-dessus des captures du site « avant /
 * après » déjà prises par scripts/tuto-shots.mjs (rognées dans les images existantes :
 * seule la carte du kit change). Les visuels qui montrent l'admin (themes, renvoyer,
 * revue, appliquer) restent ceux de tuto-shots.mjs (à relancer avec un navigateur).
 *
 * Sortie : public/admin/tuto/<nom>.avif + .webp et mise à jour de
 * src/app/admin/(espace)/themes/tuto/shots.json (taille de chaque image et boîtes nommées).
 * Usage : node --expose-gc --import tsx scripts/tuto-shots-v4.mjs
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const { buildKitMulti } = await import(new URL("../src/lib/kit/build-multi.ts", import.meta.url));
const { exportIdOf } = await import(new URL("../src/lib/kit/manifest.ts", import.meta.url));
const { KIT_FILES, KIT_ROLES, KIT_V4_VERSION, MULTI_CARDS, DECOR_HEAD, frameOf, ALL_SLOTS } = await import(new URL("../src/lib/kit/spec.ts", import.meta.url));
const { PRESETS } = await import(new URL("../src/themes/presets/index.ts", import.meta.url));

const OUT = path.join(root, "public/admin/tuto");
const MANIFEST = path.join(root, "src/app/admin/(espace)/themes/tuto/shots.json");
const TMP = path.join(tmpdir(), "tuto-shots-v4");
const MAX_W = 1600;
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
mkdirSync(OUT, { recursive: true });
const previous = JSON.parse(readFileSync(MANIFEST, "utf8"));
const shots = {};

const box = (x, y, w, h) => [Math.round(x), Math.round(y), Math.round(w), Math.round(h)];
async function save(name, input, boxes = {}) {
  const meta = await sharp(input).metadata();
  const scale = Math.min(1, MAX_W / meta.width);
  const w = Math.round(meta.width * scale);
  const h = Math.round(meta.height * scale);
  const img = sharp(input).resize(w, h).flatten({ background: "#ffffff" });
  await img.clone().avif({ quality: 52, effort: 6 }).toFile(path.join(OUT, `${name}.avif`));
  await img.clone().webp({ quality: 74, effort: 5 }).toFile(path.join(OUT, `${name}.webp`));
  shots[name] = { w, h, boxes: Object.fromEntries(Object.entries(boxes).map(([k, b]) => [k, b.map((v) => Math.round(v * scale))])) };
  console.log(`${name} : ${w} × ${h}, AVIF ${Math.round(statSync(path.join(OUT, `${name}.avif`)).size / 1024)} Ko`);
}
async function compose(width, height, parts, background = "#ffffff") {
  return sharp({ create: { width, height, channels: 3, background } })
    .composite(parts.map((p) => ({ input: p.input, left: Math.round(p.left), top: Math.round(p.top) })))
    .png()
    .toBuffer();
}
const fit = async (input, w, h) => {
  const out = await sharp(input).resize({ width: w, height: h, fit: "inside" }).png().toBuffer({ resolveWithObject: true });
  return { input: out.data, w: out.info.width, h: out.info.height };
};

/* ---- 1. L'export réel (trois composites) ------------------------------------ */
const theme = PRESETS["galerie-lumineuse"];
const exportId = exportIdOf(theme.id, "tuto", KIT_V4_VERSION);
await buildKitMulti(theme, path.join(root, "public"), { exportId, themeVersion: "tuto", siteName: "Camille Roussel", outDir: path.join(TMP, "psd"), compositeDir: path.join(TMP, "png") });
const composite = (role) => path.join(TMP, "png", `${role}.png`);

let ensemble;
/** Panneaux « Télécharger » et « site » de l'ancienne image du principe (lus avant d'être réécrits). */
const oldPrincipe = async (which) => {
  const b = previous.principe.boxes[which];
  return sharp(path.join(OUT, "principe.webp")).extract({ left: b[0], top: b[1], width: b[2], height: b[3] }).png().toBuffer();
};
const [principeLeft, principeRight] = [await oldPrincipe("etape1"), await oldPrincipe("etape3")];

/* ---- 2. Vue d'ensemble : les trois fichiers côte à côte ------------------------- */
{
  const H = 900;
  const gap = 36;
  const panels = [];
  for (const role of KIT_ROLES) panels.push({ role, ...(await fit(composite(role), 1400, H)) });
  const W = panels.reduce((n, p) => n + p.w, 0) + gap * (panels.length - 1);
  let x = 0;
  const parts = [];
  const boxes = {};
  for (const p of panels) {
    parts.push({ input: p.input, left: x, top: 0 });
    const doc = KIT_FILES[p.role].doc;
    const s = p.w / doc.width;
    boxes[p.role] = box(x, 0, p.w, p.h);
    boxes[`entete-${p.role}`] = box(x, 0, p.w, (p.role === "decor" ? DECOR_HEAD : 640) * s);
    x += p.w + gap;
  }
  ensemble = await compose(W, H, parts, "#e9ebef");
  await save("kit-ensemble", ensemble, boxes);
}

/* ---- 3. LISEZ-MOI (bande de consignes du fichier décor) -------------------------- */
{
  const doc = KIT_FILES.decor.doc;
  await save("lisezmoi", await sharp(composite("decor")).extract({ left: 10, top: 6, width: doc.width - 20, height: DECOR_HEAD - 30 }).png().toBuffer());
}

/* ---- 4. Lire une carte : le logo --------------------------------------------------- */
const cardOf = async (role, card) => ({ input: await sharp(composite(role)).extract({ left: card.board.x, top: card.board.y, width: card.board.w, height: card.board.h }).png().toBuffer(), card });
{
  const card = MULTI_CARDS.find((c) => c.element === "signature");
  const c = await cardOf("logo", card);
  const slot = ALL_SLOTS.find((s) => s.id === "signature");
  const f = frameOf(slot, "multi");
  await save("carte-logo", c.input, {
    titre: box(0, 4, 1500, 54),
    zone: box(f.x - card.board.x - 8, f.y - card.board.y - 8, f.w + 16, f.h + 16),
    legende: box(f.x - card.board.x, f.y - card.board.y + f.h + 8, 560, 100),
    phrase: box(card.panel.x - 8, card.panel.y - 8, 1600, 112),
    consignes: box(card.panel.x - 8, card.panel.y + 112, card.panel.w - 400, 280),
    vignette: box(card.vignette.x - 6, card.vignette.y - 6, card.vignette.w + 12, card.vignette.h + 12),
  });
}

/* ---- 5. Une carte par élément + le site avant / après (rognés des images existantes) --- */
/** Panneau (avant ou après) d'une ancienne slide, rogné dans son image. */
async function oldPanel(name, which) {
  const b = previous[name].boxes[which];
  return sharp(path.join(OUT, `${name}.webp`)).extract({ left: b[0], top: b[1], width: b[2], height: b[3] }).png().toBuffer();
}
/** `[avant, après]` : panneaux lus dans l'ancienne image AVANT de la réécrire. */
async function elementSlide(name, cardImage, [before, after]) {
  const a = await fit(before, 780, 520);
  const b = await fit(after, 780, 520);
  const card = await fit(cardImage, 1600, 640);
  const rowH = Math.max(a.h, b.h);
  const gap = 64;
  const cardLeft = Math.round((1600 - card.w) / 2);
  const img = await compose(1600, card.h + gap + rowH, [
    { input: card.input, left: cardLeft, top: 0 },
    { input: a.input, left: (780 - a.w) / 2, top: card.h + gap },
    { input: b.input, left: 1600 - 780 + (780 - b.w) / 2, top: card.h + gap },
  ]);
  await save(name, img, {
    carte: box(cardLeft, 0, card.w, card.h),
    avant: box((780 - a.w) / 2, card.h + gap, a.w, a.h),
    apres: box(1600 - 780 + (780 - b.w) / 2, card.h + gap, b.w, b.h),
  });
}
const cards = {};
for (const card of MULTI_CARDS) cards[card.element] = (await cardOf(card.role, card)).input;
// Décor : le document entier (bande de consignes et cadre du décor).
const decorWhole = await sharp(composite("decor")).png().toBuffer();
// Les panneaux lus dans les anciennes images ne servent qu'une fois : lecture complète d'abord.
const pending = [
  ["el-paysage", decorWhole],
  ["el-signature", cards.signature],
  ["el-papier", cards.papier],
  ["el-trait", cards.trait],
  ["el-icones", cards.icones],
  ["el-curseur", cards.curseur],
  ["el-cadre", cards.cadre],
  ["el-scotch", cards.scotch],
];
const panels = {};
for (const [name] of pending) panels[name] = [await oldPanel(name, "avant"), await oldPanel(name, "apres")];
for (const [name, image] of pending) await elementSlide(name, image, panels[name]);

// Le principe : la page Thèmes, les TROIS fichiers du kit, le site.
{
  const left = await fit(principeLeft, 470, 360);
  const mid = await fit(ensemble, 470, 360);
  const right = await fit(principeRight, 470, 360);
  const gap = (1600 - 3 * 470) / 2;
  const top = 30;
  const midLeft = 470 + gap + (470 - mid.w) / 2;
  await save("principe", await compose(1600, 420, [{ input: left.input, left: 0, top }, { input: mid.input, left: midLeft, top }, { input: right.input, left: 2 * (470 + gap), top }]), {
    etape1: box(0, top, 470, left.h),
    etape2: box(midLeft, top, mid.w, mid.h),
    etape3: box(2 * (470 + gap), top, 470, right.h),
  });
}

writeFileSync(MANIFEST, `${JSON.stringify({ ...previous, ...shots }, null, 1)}\n`);
// La palette sort du kit : son visuel n'a plus de slide.
for (const f of ["el-palette.avif", "el-palette.webp", "carte-signature.avif", "carte-signature.webp"]) if (existsSync(path.join(OUT, f))) rmSync(path.join(OUT, f));
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8"));
delete manifest["el-palette"];
delete manifest["carte-signature"];
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 1)}\n`);
console.log(`tuto-shots-v4 : ${Object.keys(shots).join(", ")}`);
rmSync(TMP, { recursive: true, force: true });
