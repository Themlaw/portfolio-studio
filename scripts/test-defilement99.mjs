#!/usr/bin/env node
/**
 * Lot 99 (unitaire) : barre de défilement et flèches du kit en COULEURS D'ORIGINE, hauteur constante des bandeaux.
 *  - schéma : le dessin en couleurs (`color` AVIF + WebP) est accepté sur le trait et les flèches, un chemin invalide est refusé ;
 *  - thème : variables et attributs `data-kit-*-color` posés seulement quand le fichier en couleurs existe (kit d'avant le lot 99 : rendu
 *    inchangé, masque teinté) ; taille des flèches = moitié de la case du kit ;
 *  - import : le trait et les deux flèches gardent leurs couleurs (`keepsDrawnColors`), pas les autres emplacements ;
 *  - code : plus de hauteur de bande recalculée au défilement (`--strip-rail-h`, `fitHeight`), la hauteur des images est calculée en CSS.
 * Usage : npm test (via tsx)
 */
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const { KitAssetsSchema } = await import(new URL("../src/themes/schema.ts", import.meta.url));
const { kitVariables, kitAttributes, KIT_ARROW_SCALE } = await import(new URL("../src/themes/css.ts", import.meta.url));
const { keepsDrawnColors, SLOTS } = await import(new URL("../src/lib/kit/spec.ts", import.meta.url));

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? " — " + detail : ""}`);
};

const hash = (n) => n.toString(16).padStart(16, "0");
const mask = (n) => ({ svg: `/media/kit/${hash(n)}.svg`, w: 2320, h: 112 });
const color = (n) => ({ avif: `/media/kit/${hash(n)}.avif`, webp: `/media/kit/${hash(n)}.webp` });
const withColor = {
  stroke: { ...mask(1), color: color(2) },
  icons: { arrowLeft: { svg: `/media/kit/${hash(3)}.svg`, w: 128, h: 128, color: color(4) }, arrowRight: { svg: `/media/kit/${hash(5)}.svg`, w: 128, h: 128, color: color(6) }, close: { svg: `/media/kit/${hash(7)}.svg`, w: 128, h: 128 } },
};
const old = { stroke: mask(1), icons: { arrowLeft: { svg: `/media/kit/${hash(3)}.svg`, w: 128, h: 128 }, arrowRight: { svg: `/media/kit/${hash(5)}.svg`, w: 128, h: 128 } } };

ok("schéma : trait et flèches avec leur dessin en couleurs", KitAssetsSchema.safeParse(withColor).success);
ok("schéma : un kit d'avant (sans couleurs) reste valide", KitAssetsSchema.safeParse(old).success);
ok("schéma : chemin de couleurs invalide refusé", !KitAssetsSchema.safeParse({ stroke: { ...mask(1), color: { avif: "/media/kit/x.avif", webp: color(2).webp } } }).success);
ok("schéma : champ inconnu dans `color` refusé", !KitAssetsSchema.safeParse({ stroke: { ...mask(1), color: { ...color(2), extra: 1 } } }).success);

const vars = kitVariables(withColor);
const attrs = kitAttributes(withColor);
ok("variables : image en couleurs du trait et des deux flèches (image-set AVIF + WebP)", /image-set\(.*\.avif.*\.webp/.test(vars["--t-kit-stroke-color"]) && /\.avif/.test(vars["--t-kit-icon-arrow-left-color"]) && /\.webp/.test(vars["--t-kit-icon-arrow-right-color"]));
ok("variables : le masque teinté reste là (soulignement, filets, visionneuse)", Boolean(vars["--t-kit-stroke"] && vars["--t-kit-icon-arrow-left"] && vars["--t-kit-icon-close"]));
ok("variables : taille des flèches = moitié de la case du kit (64 px pour 128)", KIT_ARROW_SCALE === 0.5 && vars["--t-kit-icon-arrow-left-w"] === "64px" && vars["--t-kit-icon-arrow-right-h"] === "64px", JSON.stringify(vars));
ok("variables : bouts de la barre = moitié de sa hauteur, en % de sa largeur (2,414 %)", vars["--t-kit-stroke-cap"] === "2.414%", vars["--t-kit-stroke-cap"]);
ok("attributs : data-kit-stroke-color et data-kit-icon-arrow-*-color", "data-kit-stroke-color" in attrs && "data-kit-icon-arrow-left-color" in attrs && "data-kit-icon-arrow-right-color" in attrs && !("data-kit-icon-close-color" in attrs));
const oldVars = kitVariables(old);
const oldAttrs = kitAttributes(old);
ok("kit d'avant le lot 99 : aucune variable ni attribut de couleur, rendu inchangé (masque teinté)", !Object.keys(oldVars).some((k) => k.endsWith("-color") || k.endsWith("-cap")) && !Object.keys(oldAttrs).some((k) => k.endsWith("-color")) && "data-kit-stroke" in oldAttrs);

ok("import : le trait et les deux flèches gardent leurs couleurs", SLOTS.filter((s) => keepsDrawnColors(s)).map((s) => s.id).sort().join() === ["icones/fleche-droite", "icones/fleche-gauche", "trait"].sort().join(), SLOTS.filter((s) => keepsDrawnColors(s)).map((s) => s.id).join());

const strip = readFileSync(`${root}src/components/StripRail.tsx`, "utf8");
const css = readFileSync(`${root}src/app/globals.css`, "utf8");
ok("hauteur constante : plus de `--strip-rail-h` ni de `fitHeight` (la bande ne se resserre plus sur les cases vues)", !/strip-rail-h|fitHeight/.test(strip + css));
ok("hauteur constante : la hauteur des images (--strip-band) est posée en CSS pur, depuis la liste des images", /"--strip-band": band/.test(strip) && /max\(\$\{cases\.join/.test(strip));
ok("flèches du thème : jamais sous 32 px (40 px au doigt)", /max\(var\(--strip-nav-size\), 32px\)/.test(css) && /max\(var\(--strip-nav-size\), 40px\)/.test(css));

if (failures) {
  console.log(`\n${failures} échec(s)`);
  process.exit(1);
}
console.log("\nTout passe");
