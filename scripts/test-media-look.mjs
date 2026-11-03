#!/usr/bin/env node
/**
 * Lot 64 (« MediaFrame » : une seule boîte pour toutes les photos et vidéos) — tests unitaires (inclus dans npm test) :
 *  T1  Données : `mediaLookAttrs` est LE point de rendu de l'habillage (cadre, fond, arrondi) ; chaque conteneur (image seule, vidéo,
 *      case, place de carrousel, image de la Planche libre) accepte les MÊMES jetons de couleur ; « Couleur de la carte » = la carte
 *      réellement dessous ; une teinte de la palette passe par la variable remappée dans une carte.
 *  T2  Feuilles de style : une règle de cadre / de fond ne vise que `.media-frame` (aucune copie par conteneur), le cadre du kit porte les
 *      QUATRE épaisseurs réelles, la boîte peint son fond dans sa zone intérieure ; plus de passe-partout propre à la vidéo, plus de classe
 *      de boîte spécifique à un conteneur.
 *  T3  Source : un seul composant de boîte (MediaFrame), utilisé par image, vidéo, carrousel (image, vidéo, boucle) et Planche libre.
 * Usage : node --import tsx scripts/test-media-look.mjs
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { freeBoardSchema } from "../src/blocks/free-board.ts";
import { FrameSchema, ImageBgSchema, LookSchema, PALETTE, frameColorCss, imageBgCss, mediaLookAttrs } from "../src/lib/look.ts";
import { kitVariables } from "../src/themes/css.ts";

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`PASS  ${name}`);
};
const ROOT = new URL("../", import.meta.url).pathname;
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const walk = (dir, out = []) => {
  for (const f of readdirSync(path.join(ROOT, dir))) {
    const p = `${dir}/${f}`;
    if (statSync(path.join(ROOT, p)).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

/* ---- T1. Données ------------------------------------------------------------------------------------------ */

test("T1 mediaLookAttrs : rien par défaut ; cadre, fond et arrondi propres, exactement ce qui est choisi", () => {
  assert.deepEqual(mediaLookAttrs(undefined), { attrs: {}, style: {} });
  assert.deepEqual(mediaLookAttrs({}), { attrs: {}, style: {} });
  assert.deepEqual(mediaLookAttrs({ frame: { kind: "theme" } }), { attrs: { "data-frame": "theme" }, style: {} });
  assert.deepEqual(mediaLookAttrs({ frame: { kind: "none" } }), { attrs: { "data-frame": "none" }, style: {} });
  assert.deepEqual(mediaLookAttrs({ frame: { kind: "band", width: "epais", color: "primary" }, bg: "#ffcc00", radius: "strong" }), {
    attrs: { "data-frame": "band", "data-frame-w": "epais", "data-img-bg": "" },
    style: { "--frame-color": "var(--color-primary)", "--img-bg": "#ffcc00", "--media-radius": "20px" },
  });
  // Valeurs invalides : ignorées, jamais d'injection.
  assert.deepEqual(mediaLookAttrs({ frame: { kind: "huge" }, bg: "red; background:url(x)", radius: "gigantic" }), { attrs: {}, style: {} });
  // Ancien cadre (size) relu à la nouvelle forme.
  assert.equal(mediaLookAttrs({ frame: { size: "thin" } }).attrs["data-frame-w"], "fin");
});

test("T1 les mêmes jetons de couleur partout : image seule, case, place de carrousel, Planche libre", () => {
  const tokens = ["card", ...PALETTE, "#a1b2c3", "#a1b2c3cc", "#ffffff"];
  for (const t of tokens) {
    assert.ok(LookSchema.safeParse({ imageBg: t }).success, `imageBg ${t}`);
    assert.ok(LookSchema.safeParse({ slotBg: { a: t } }).success, `slotBg ${t}`);
    assert.ok(freeBoardSchema.safeParse({ items: [{ id: "a", media: 1, x: 1, y: 1, w: 10, bg: t }] }).success, `bg libre ${t}`);
    assert.ok(ImageBgSchema.safeParse(t).success, t);
    assert.ok(mediaLookAttrs({ bg: t }).attrs["data-img-bg"] === "", `rendu ${t}`);
  }
  for (const t of [...PALETTE, "#a1b2c3", "#a1b2c3cc"]) {
    const f = { kind: "band", color: t };
    assert.ok(LookSchema.safeParse({ frame: f }).success && LookSchema.safeParse({ slotFrame: { a: f } }).success && FrameSchema.safeParse(f).success, `couleur de bande ${t}`);
    assert.ok(freeBoardSchema.safeParse({ items: [{ id: "a", media: 1, x: 1, y: 1, w: 10, frame: f }] }).success, `bande libre ${t}`);
  }
});

test("T1 couleurs : « carte » = la carte réellement dessous ; la palette passe par la variable remappée dans une carte", () => {
  assert.equal(imageBgCss("card"), "var(--card-bg, var(--t-color-surface))");
  assert.equal(mediaLookAttrs({ bg: "card" }).style["--img-bg"], "var(--card-bg, var(--t-color-surface))");
  for (const c of PALETTE) {
    assert.equal(imageBgCss(c), `var(--t-color-${c})`, `fond ${c}`);
    assert.equal(frameColorCss(c), `var(--color-${c})`, `bande ${c}`);
  }
  // La bande par défaut et la bande « Texte » donnent la même couleur (même variable).
  assert.equal(frameColorCss(undefined), frameColorCss("ink"));
  // Aucune variable de thème brute (--t-color-*) hors le repli de « carte ».
  for (const c of PALETTE) assert.ok(!/--t-color/.test(frameColorCss(c)));
});

test("T1 cadre du kit : les QUATRE épaisseurs réelles (haut, droite, bas, gauche) sont émises", () => {
  const v = kitVariables({ frame: { image: { avif: "/a.avif", webp: "/a.webp", w: 300, h: 300 }, slice: [48, 40, 120, 56] } });
  assert.equal(v["--t-kit-fwt"], "24");
  assert.equal(v["--t-kit-fwr"], "20");
  assert.equal(v["--t-kit-fwb"], "60");
  assert.equal(v["--t-kit-fwl"], "28");
  assert.equal(v["--t-kit-frame-slice"], "48 40 120 56");
  assert.ok(!("--t-kit-frame-w" in v) && !("--t-kit-frame-width" in v), "anciennes variables (une épaisseur, ou quatre valeurs en un jet) supprimées");
});

/* ---- T2. Feuilles de style ------------------------------------------------------------------------------- */

test("T2 une règle de cadre ou de fond ne vise que `.media-frame` (aucune copie par conteneur)", () => {
  for (const file of walk("src").filter((f) => f.endsWith(".css"))) {
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
    for (const rule of css.split("}")) {
      const sel = rule.split("{")[0];
      if (!/\[data-frame|\[data-img-bg|data-frame-all/.test(sel)) continue;
      assert.ok(/\.media-frame|\.media-box/.test(sel), `${file} : « ${sel.trim().replace(/\s+/g, " ")} » vise autre chose que .media-frame`);
      assert.ok(file.endsWith("media-frame.css") || file.endsWith("themes/variants.css"), `${file} : règle de cadre hors des deux feuilles prévues`);
    }
  }
  // Chaque sélecteur de cadre « bande » et de fond n'existe qu'une fois.
  const mf = read("src/app/media-frame.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal((mf.match(/\.media-frame\[data-frame="band"\] \{/g) ?? []).length, 1);
  assert.equal((mf.match(/\.media-frame\[data-img-bg\] \{/g) ?? []).length, 1);
});

test("T2 le cadre du kit : une seule règle, quatre épaisseurs, valable pour la tuile ; la boîte peint son fond dans sa zone intérieure", () => {
  const variants = read("src/themes/variants.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.equal((variants.match(/border-image-source: var\(--t-kit-frame\)/g) ?? []).length, 1, "une seule règle pose le dessin du kit");
  const rule = variants.split("}").find((r) => /border-image-source: var\(--t-kit-frame\)/.test(r)) ?? "";
  for (const side of ["fwt", "fwr", "fwb", "fwl"]) assert.match(rule, new RegExp(`--t-kit-${side}`));
  assert.match(rule, /\.tile-media/, "les tuiles passent par la même règle");
  assert.match(rule.split("{")[0], /\.media-frame\[data-frame="theme"\]/);
  const mf = read("src/app/media-frame.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const base = mf.split("}").find((r) => /^\s*\.media-frame \{/.test(r)) ?? "";
  assert.match(base, /background-clip: padding-box/, "le fond (de l'artiste, de chargement) ne passe jamais sous le cadre");
  assert.match(base, /box-sizing: content-box/, "la zone intérieure garde le format du média : le cadre s'ajoute autour, il ne rogne jamais");
  assert.match(base, /aspect-ratio: var\(--box-r/, "le format est posé sur la zone intérieure (non remplacée)");
  assert.match(mf, /\.media-box \{[^}]*container-type: size/, "la case (taille indépendante du cadre) contient la boîte");
});

/* ---- T3. Source ---------------------------------------------------------------------------------------- */

test("T3 un seul composant de boîte : image, vidéo (seule, carrousel, boucle) et Planche libre l'utilisent ; plus de copies", () => {
  for (const f of ["src/blocks/ImageBlock.tsx", "src/components/AnimationShowcase.tsx", "src/components/VideoCard.tsx", "src/components/StripRail.tsx", "src/components/LoopVideo.tsx", "src/blocks/FreeBoardBlock.tsx"]) {
    assert.match(read(f), /MediaFrame/, `${f} passe par MediaFrame`);
  }
  const src = walk("src").filter((f) => /\.(tsx?|css)$/.test(f));
  for (const f of src) {
    const text = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/video-frame|free-media|free-video|block-image-frame/.test(text), `${f} : classe de boîte propre à un conteneur`);
  }
  // La vidéo n'a plus de passe-partout propre (.mat n'habille plus que les tuiles de collection).
  for (const f of ["src/components/VideoCard.tsx", "src/components/AnimationShowcase.tsx"]) assert.ok(!/className="mat"|mat-hover/.test(read(f)), `${f} : plus de passe-partout`);
  assert.ok(!/aspect-video/.test(read("src/components/VideoCard.tsx") + read("src/components/AnimationShowcase.tsx")), "plus de 16:9 forcé");
  // frameStyle / imageBgAttrs ne sont plus lus que par mediaLookAttrs (et le menu qui relit l'état).
  for (const f of src.filter((x) => x.endsWith(".tsx"))) {
    const text = read(f);
    if (/\bimageBgAttrs\b/.test(text)) assert.fail(`${f} : imageBgAttrs lu hors de mediaLookAttrs`);
  }
});

console.log(`\n${passed} tests OK`);
