#!/usr/bin/env node
/**
 * Lot 90 : retour arrière v0.33 → v0.31.x avec une opacité de papier > 0,6, MESURÉ (données synthétiques).
 * Le même fichier tourne sur les deux arbres : il détecte lequel (la v0.31.x refuse 0,9, la v0.33 l'accepte) et vérifie le comportement de chacun.
 *   v0.31.x (le constat, ce qu'une base écrite par la v0.33 ferait à une v0.31) :
 *     - rendu : la carte garde couleur / largeur / motif, seule l'opacité retombe sur celle du motif (readSurface est tolérant champ par champ) ;
 *     - enregistrement d'une page (def.schema, `surface: …catch(undefined)`) : la carte ENTIÈRE du bloc est perdue ;
 *     - éditeur : le message « surface » de ce bloc est refusé ;
 *     - thème : kit.paper.overHero / onCardsOpacity > 0,6 → le thème ENTIER est refusé (garde-fou : la v0.33 garde ce plafond).
 *   v0.33 : la carte de bloc accepte jusqu'à 1 ; le papier du thème reste borné à 0,6.
 * Usage : node --import tsx scripts/test-retour90.mjs   (inclus dans npm test)
 */
import { BLOCKS } from "../src/blocks/registry.ts";
import { acceptFromCanvas, EDIT_MSG } from "../src/lib/edit/protocol.ts";
import { PRESETS } from "../src/themes/presets/index.ts";
import { ThemeSchema } from "../src/themes/schema.ts";
import { readSurface, SurfaceSchema } from "../src/themes/surface.ts";

import { isDeepStrictEqual } from "node:util";

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};

const surf = { color: "surface", width: "inset", paperWallpaper: 3, paperSize: 120, paperOpacity: 0.9 };
const newTree = SurfaceSchema.safeParse(surf).success;
console.log(`# arbre mesuré : ${newTree ? "v0.33 (lot 90)" : "v0.31.x"}`);

const props = { paragraphs: [{ fr: "a", en: "a" }], surface: surf };
const parsed = BLOCKS["rich-text"].schema.safeParse(props);
const read = readSurface(surf);
const ORIGIN = "http://localhost";
const frame = {};
const msg = (data) => ({ origin: ORIGIN, source: frame, data: { type: EDIT_MSG, ...data } });
const accepted = acceptFromCanvas(msg({ kind: "surface", uid: "b1", surface: surf }), ORIGIN, frame);
const themeWith = (field, v) => ThemeSchema.safeParse({ ...PRESETS["carnet-d-atelier"], assets: { kit: { paper: { image: { svg: "/media/kit/aaaaaaaaaaaaaaaa.svg", w: 160, h: 160 }, [field]: v } } } }).success;

if (newTree) {
  ok("v0.33 : la carte d'un bloc garde 0,9 à l'enregistrement de la page", parsed.success && parsed.data.surface?.paperOpacity === 0.9);
  ok("v0.33 : lecture complète (couleur, largeur, motif, opacité)", isDeepStrictEqual(read, surf), JSON.stringify(read));
  ok("v0.33 : l'éditeur accepte le message « surface » à 0,9", accepted?.kind === "surface");
  ok("v0.33 : 1 accepté, 1,01 refusé", SurfaceSchema.safeParse({ paperOpacity: 1 }).success && !SurfaceSchema.safeParse({ paperOpacity: 1.01 }).success);
  ok("v0.33 : le papier du thème garde son plafond de 0,6 (sinon la v0.31 refuserait le thème entier)", themeWith("onCardsOpacity", 0.6) && !themeWith("onCardsOpacity", 0.9) && themeWith("overHero", 0.6) && !themeWith("overHero", 0.9));
} else {
  ok("v0.31 rendu : seule l'opacité est perdue (couleur, largeur et motif restent)", JSON.stringify(read) === JSON.stringify({ color: "surface", width: "inset", paperWallpaper: 3, paperSize: 120 }), JSON.stringify(read));
  ok("v0.31 enregistrement de la page : la carte ENTIÈRE du bloc est perdue", parsed.success && parsed.data.surface === undefined, JSON.stringify(parsed.success && parsed.data.surface));
  ok("v0.31 éditeur : le message « surface » du bloc est refusé", accepted === null);
  ok("v0.31 thème : onCardsOpacity / overHero > 0,6 refusent le thème entier", !themeWith("onCardsOpacity", 0.9) && !themeWith("overHero", 0.9) && themeWith("onCardsOpacity", 0.6));
}
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
