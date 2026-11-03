#!/usr/bin/env node
/** Lot 100 : pastilles du Contour (doublons, confondues avec le fond de page, choix enregistré gardé) et règle « une teinte choisie = la couleur affichée » (fond image). */
import assert from "node:assert/strict";

import { contrast, hiddenContourSwatches } from "../src/themes/contour-swatches.ts";
import { PALETTE, imageBgCss } from "../src/lib/look.ts";

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const C = (r, g, b) => ({ r, g, b });
const order = ["bg", "surface", "ink", "primary", "secondary", "tertiary"];
const colors = { bg: C(241, 232, 216), surface: C(248, 242, 231), ink: C(58, 50, 42), primary: C(177, 62, 43), secondary: C(99, 104, 59), tertiary: C(58, 50, 42) };
const def = C(58, 50, 42);
const page = C(241, 232, 216);

let h = hiddenContourSwatches(order, colors, def, page);
ok("doublon du texte par défaut : « ink » et « tertiary » (même couleur) masqués", h.has("ink") && h.has("tertiary"), [...h].join());
ok("couleur confondue avec le fond de la page masquée (« bg »)", h.has("bg"));
ok("une couleur distincte reste (primary, secondary)", !h.has("primary") && !h.has("secondary"));
h = hiddenContourSwatches(order, colors, def, page, "bg");
ok("le choix enregistré n'est jamais masqué, même confondu avec la page", !h.has("bg"));
h = hiddenContourSwatches(order, colors, def, undefined);
ok("sans fond de page connu : rien n'est masqué pour cette raison", !h.has("bg") || h.has("bg") === false);
h = hiddenContourSwatches(order, {}, def, page);
ok("couleur inconnue : la pastille est gardée", h.size === 0);
ok("contraste : blanc / noir = 21", Math.abs(contrast(C(255, 255, 255), C(0, 0, 0)) - 21) < 0.01);
for (const c of PALETTE) assert.equal(imageBgCss(c), `var(--t-color-${c})`);
ok("fond image : une teinte choisie est la couleur du thème (--t-color-x), jamais la variante remappée de la zone", PALETTE.every((c) => imageBgCss(c) === `var(--t-color-${c})`));
ok("fond image : « couleur de la carte » et couleur libre inchangés", imageBgCss("card") === "var(--card-bg, var(--t-color-surface))" && imageBgCss("#a1b2c3cc") === "#a1b2c3cc");
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
