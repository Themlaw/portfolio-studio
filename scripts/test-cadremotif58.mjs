#!/usr/bin/env node
/** Lot 58 : cadre du kit en 9 parties (unitaire, sans serveur) : option B par rotation, rendu « round », « Sans cadre » dans le schéma. */
import sharp from "sharp";

import { assembleCornerSide, FRAME_SLICE, framePreview, isCornerSide, renderFrame, roundCount } from "../src/lib/kit/frame9.ts";
import { FrameSchema, frameStyle } from "../src/lib/look.ts";

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};

const W = 300;
const S = FRAME_SLICE;
const blank = () => ({ width: W, height: W, data: Buffer.alloc(W * W * 4) });
const set = (img, x, y, r, g, b, a = 255) => {
  const i = (y * W + x) * 4;
  img.data[i] = r;
  img.data[i + 1] = g;
  img.data[i + 2] = b;
  img.data[i + 3] = a;
};
const get = (img, x, y) => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

// B : un coin rouge (avec un repère vert en haut à gauche) + un côté du haut bleu / jaune.
const b = blank();
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) set(b, x, y, 200, 0, 0);
set(b, 3, 5, 0, 255, 0); // repère asymétrique : prouve la rotation
for (let y = 0; y < S; y++) for (let x = S; x < W - S; x++) set(b, x, y, Math.floor((x - S) / 51) % 2 ? 250 : 20, 100, Math.floor((x - S) / 51) % 2 ? 0 : 220);
ok("B1 coin + côté du haut seuls = option B", isCornerSide(b));
const full = assembleCornerSide(b);
ok("B2 le coin du haut à gauche est gardé tel quel", get(full, 3, 5).join() === "0,255,0,255");
ok("B3 repère tourné de 90° dans le coin haut-droite", get(full, W - 1 - 5, 3).join() === "0,255,0,255", get(full, W - 1 - 5, 3).join());
ok("B4 repère tourné de 180° dans le coin bas-droite", get(full, W - 1 - 3, W - 1 - 5).join() === "0,255,0,255");
ok("B5 repère tourné de 270° dans le coin bas-gauche", get(full, 5, W - 1 - 3).join() === "0,255,0,255");
ok("B6 les 4 côtés existent, le centre reste transparent", [get(full, 150, 10), get(full, 290, 150), get(full, 150, 290), get(full, 10, 150)].every((p) => p[3] === 255) && get(full, 150, 150)[3] === 0);
ok("B7 un cadre complet n'est pas pris pour l'option B", !isCornerSide(full));
ok("B8 case vide : pas l'option B", !isCornerSide(blank()));
const fr = { ...b, data: Buffer.from(b.data) };
set(fr, 100, S + 1, 10, 10, 10, 120); // frange de réduction juste sous la bande
ok("B10 une frange de 1 px sous la bande reste l'option B", isCornerSide(fr));
set(fr, 100, S + 10, 10, 10, 10, 120);
ok("B11 un vrai dessin plus bas n'est plus l'option B", !isCornerSide(fr));
const c2 = blank();
for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) set(c2, x, y, 1, 2, 3);
set(c2, 150, 150, 1, 2, 3);
ok("B9 un pixel au centre : ce n'est plus l'option B", !isCornerSide(c2));

// Rendu : « round ».
ok("R1 nombre de motifs entier, au moins 1", roundCount(1000, 102) === 10 && roundCount(30, 102) === 1 && roundCount(160, 102) === 2);
const sq = await renderFrame(full, 500, 500, 48);
const pano = await renderFrame(full, 1600, 400, 48);
const crop = async (buf, left, top) => sharp(buf).extract({ left, top, width: 48, height: 48 }).raw().toBuffer();
const same = (a, c) => a.equals(c);
ok("R2 coin identique sur un carré et un panorama (haut-gauche)", same(await crop(sq, 0, 0), await crop(pano, 0, 0)));
ok("R3 coin identique (bas-droite)", same(await crop(sq, 452, 452), await crop(pano, 1552, 352)));
// Côtés répétés et non étirés : on compte les alternances bleu / jaune sur le bord du haut.
const runs = async (buf, w) => {
  const row = await sharp(buf).extract({ left: 48, top: 24, width: w - 96, height: 1 }).raw().toBuffer({ resolveWithObject: true });
  let n = 1;
  const px = (i) => row.data[i * row.info.channels] > 128;
  for (let i = 1; i < w - 96; i++) if (px(i) !== px(i - 1)) n++;
  return n;
};
const rs = await runs(sq, 500);
const rp = await runs(pano, 1600);
ok("R4 le panorama répète le motif (plus d'alternances, au prorata de la longueur)", rp > rs * 3, `${rs} / ${rp}`);
ok("R5 le motif garde sa taille (alternances ≈ 51 px)", Math.abs((1600 - 96) / rp - 51) < 12 && Math.abs((500 - 96) / rs - 51) < 12, `${(1600 - 96) / rp} / ${(500 - 96) / rs}`);
const prev = await sharp(await framePreview(full)).metadata();
ok("R6 aperçu de la revue : une image de 3 formats, assez large", prev.width > 900 && prev.height > 300, `${prev.width}x${prev.height}`);

// « Sans cadre ».
// Lot 62 : « Sans cadre » devient le choix « Aucun » (`kind: "none"`) ; l'ancienne forme `size: "none"` est relue à la nouvelle.
ok("N1 « Aucun » est un cadre valide (et l'ancien « Sans cadre » est relu comme tel)", FrameSchema.safeParse({ kind: "none" }).success && FrameSchema.safeParse({ size: "none" }).success);
ok("N2 rendu : data-frame=none", frameStyle({ kind: "none" })?.attrs["data-frame"] === "none" && frameStyle({ size: "none" })?.attrs["data-frame"] === "none");
ok("N3 une épaisseur inconnue reste refusée", !FrameSchema.safeParse({ kind: "band", width: "huge" }).success && !FrameSchema.safeParse({ size: "huge" }).success);

console.log(failures ? `\n${failures} échec(s)` : "\nTout est vert");
process.exit(failures ? 1 : 0);
