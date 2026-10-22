#!/usr/bin/env node
/**
 * Éditeur de thème guidé (lot 61) : réglages simplifiés (Arrondi, Espacements) lus sur les thèmes livrés SANS les modifier,
 * écrits seulement par un clic sur un cran ; compteur des nuances choisies ; variante choisie pour un logo importé.
 * Usage : node --import tsx scripts/test-guide61.mjs
 */
import assert from "node:assert/strict";

import { applyRoundLevel, applySpaceLevel, customNuances, pickLogoVariant, ROUND_LEVELS, roundLevelOf, SPACE_LEVELS, spaceLevelOf } from "../src/themes/guided.ts";
import { setNuance } from "../src/themes/palette.ts";
import { ThemeSchema } from "../src/themes/schema.ts";
import { loadPresets } from "./lib/presets.mjs";

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};

const presets = await loadPresets();
ok("8 thèmes livrés lus", presets.length === 8, String(presets.length));
const by = Object.fromEntries(presets.map((p) => [p.id, p]));

// 1. Lecture seule : lire le cran ne modifie rien.
for (const p of presets) {
  const before = JSON.stringify(p);
  roundLevelOf(p.tokens.radius, p.variants.button);
  spaceLevelOf(p.tokens.space);
  customNuances(p.tokens.color, p.tokens.palette);
  ok(`${p.id} : la lecture des crans ne modifie pas le thème`, JSON.stringify(p) === before);
}

// 2. Crans reconnus exactement : ceux dont les valeurs ont servi de modèle.
const lv = (id) => roundLevelOf(by[id].tokens.radius, by[id].variants.button);
ok("Studio = Carré (exact)", lv("studio").index === 0 && lv("studio").exact);
ok("Planche de story = Léger (exact)", lv("planche-de-story").index === 1 && lv("planche-de-story").exact);
ok("Carnet d'atelier = Moyen (exact)", lv("carnet-d-atelier").index === 2 && lv("carnet-d-atelier").exact);
ok("Galerie lumineuse = Rond (exact)", lv("galerie-lumineuse").index === 3 && lv("galerie-lumineuse").exact);
// Valeurs précises sans cran : gardées, cran le plus proche affiché, jamais « exact ».
for (const id of ["fanzine-riso", "pro", "salle-de-montage", "salle-de-projection"]) ok(`${id} : arrondis précis, cran proche seulement`, !lv(id).exact);
ok("Pro (6 / 12 / 20 px) : cran Rond le plus proche", lv("pro").index === 3);
ok("Salle de montage (2 / 3 / 4 px) : cran Léger le plus proche", lv("salle-de-montage").index === 1);
const sp = (id) => spaceLevelOf(by[id].tokens.space);
ok("Studio = Serré (exact)", sp("studio").index === 0 && sp("studio").exact);
ok("Fanzine riso = Normal (exact)", sp("fanzine-riso").index === 1 && sp("fanzine-riso").exact);
ok("Carnet d'atelier = Aéré (exact)", sp("carnet-d-atelier").index === 2 && sp("carnet-d-atelier").exact);
ok("Galerie lumineuse : espacement précis, Serré le plus proche", !sp("galerie-lumineuse").exact && sp("galerie-lumineuse").index === 0);

// 3. Un clic sur un cran écrit ses valeurs, relues exactement ; le thème reste valide.
for (let i = 0; i < ROUND_LEVELS.length; i++) {
  const next = applyRoundLevel(i);
  const read = roundLevelOf(next.radius, next.button);
  ok(`cran d'arrondi « ${ROUND_LEVELS[i].label} » : écrit puis relu à l'identique`, read.index === i && read.exact);
  const t = structuredClone(by.studio);
  t.tokens.radius = next.radius;
  t.variants.button = next.button;
  ok(`cran d'arrondi « ${ROUND_LEVELS[i].label} » : thème valide`, ThemeSchema.safeParse(t).success);
}
for (let i = 0; i < SPACE_LEVELS.length; i++) {
  const next = applySpaceLevel({ ...by.pro.tokens.space, pageMax: "1333px" }, i);
  ok(`espacement « ${SPACE_LEVELS[i].label} » : écrit puis relu, largeur maximale gardée`, spaceLevelOf(next).index === i && spaceLevelOf(next).exact && next.pageMax === "1333px");
  const t = structuredClone(by.pro);
  t.tokens.space = next;
  ok(`espacement « ${SPACE_LEVELS[i].label} » : thème valide`, ThemeSchema.safeParse(t).success);
}
ok("hors bornes : cran borné", applyRoundLevel(99).radius.md === ROUND_LEVELS.at(-1).radius.md && applyRoundLevel(-3).radius.md === "0px");

// 4. Compteur de couleurs avancées : seul ce qui s'écarte du calcul automatique.
for (const p of presets) {
  const n = customNuances(p.tokens.color, p.tokens.palette);
  let color = p.tokens.color;
  let palette = p.tokens.palette;
  for (const k of n) ({ color, palette } = setNuance(color, palette, k, null));
  ok(`${p.id} : ${n.length} nuance(s) hors calcul ; toutes remises en auto = 0`, customNuances(color, palette).length === 0);
}

// 5. Logo importé : plus petite variante qui atteint 960 px (AVIF + WebP de même taille), sinon la plus grande.
const f = (format, w, h = w / 2) => ({ key: `img/x/${w}.${format}`, w, h, format });
const files = [f("avif", 480), f("webp", 480), f("avif", 960), f("webp", 960), f("avif", 1600), f("webp", 1600), f("avif", 4800), f("webp", 4800)];
ok("variante : 960 px", pickLogoVariant(files)?.avif.w === 960 && pickLogoVariant(files)?.webp.w === 960);
ok("variante : trop petite → la plus grande", pickLogoVariant(files.filter((x) => x.w <= 480))?.avif.w === 480);
ok("variante : au-delà de 4096 px écartée", pickLogoVariant(files.filter((x) => x.w === 4800)) === null);
ok("variante : AVIF sans WebP jumeau écarté", pickLogoVariant([f("avif", 960)]) === null);

if (failures) {
  console.error(`test-guide61 : ${failures} échec(s)`);
  process.exit(1);
}
console.log("test-guide61 : OK");
