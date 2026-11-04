#!/usr/bin/env node
/**
 * Structures de la prod (lot 108), module pur : la fixture `tests/fixtures/structures-reference.json` (59 structures uniques, sans texte ni média ni couleur réelle).
 *  - chaque structure de page, rendue synthétique, est VALIDE pour le schéma de son bloc ;
 *  - les réglages de mise en page des structures (noms `none/s/m/l/xl`, `wide/medium/narrow`…) sont relus à l'identique ;
 *  - les couches (`surface`, `background`) des structures relues par le menu « Fond & carte » se réécrivent sans perte (relire ce qu'on vient d'écrire).
 * Usage : node --import tsx scripts/test-structures108.mjs   (inclus dans npm test)
 */
import { BLOCKS } from "../src/blocks/registry.ts";
import { LookSchema, readLook } from "../src/lib/look.ts";
import { readLayout, writeFondCarte } from "../src/themes/fondcarte.ts";
import { resolveSurface } from "../src/themes/surface.ts";
import { FIXTURE, kindOf, synth } from "./lib/structures108.mjs";

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const ENV = { img: 5, slug: "projet", pageId: 2, collection: "characters", wp: [1, 2, 3, 4, 5] };
const canon = (v) => JSON.stringify(v, (_, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
const DEF = resolveSurface({});
ok("la fixture compte 59 structures uniques", FIXTURE.length === 59 && new Set(FIXTURE.map((e) => canon(e.node))).size === 59);
const LAYER_LOOK = ["spaceTop", "spaceBottom", "spaceSides", "width", "marginTop", "marginBottom"];
for (const [i, e] of FIXTURE.entries()) {
  if (kindOf(e) === "page") {
    const b = synth(e, i, ENV);
    const r = BLOCKS[b.type]?.schema.safeParse(b.props);
    ok(`[${i}] ${b.type} : structure synthétique valide pour son bloc`, Boolean(r?.success), r && !r.success ? r.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).slice(0, 3).join(" | ") : "type inconnu");
  }
  const look = e.node.look ?? e.node.props?.look;
  if (look) {
    const layer = Object.fromEntries(Object.entries(look).filter(([k]) => LAYER_LOOK.includes(k)));
    ok(`[${i}] réglages de mise en page relus à l'identique`, canon(readLook(layer) ?? {}) === canon(layer) && LookSchema.safeParse(layer).success);
  }
  const stored = { ...(e.node.surface ?? e.node.props?.surface ? { surface: e.node.surface ?? e.node.props?.surface } : {}), ...(e.node.background ?? e.node.props?.background ? { background: e.node.background ?? e.node.props?.background } : {}) };
  if (kindOf(e) === "page" && (stored.surface || stored.background)) {
    const sy = synth(e, i, ENV).props;
    const st = { ...(sy.surface ? { surface: sy.surface } : {}), ...(sy.background ? { background: sy.background } : {}) };
    const { fc, outer } = readLayout(st, DEF);
    const w = writeFondCarte(fc, { canCard: true, canFond: true }, false, outer ?? undefined);
    const back = readLayout({ ...(w.surface ? { surface: w.surface } : {}), ...(w.background ? { background: w.background } : {}) }, DEF);
    ok(`[${i}] couches : réécrites par le menu puis relues, sans perte`, canon(back.fc) === canon(fc) && back.outer === outer, canon([fc, back.fc]).slice(0, 300));
  }
}
console.log(failures ? `\n${failures} ÉCHEC(S)` : "\nTout passe");
process.exit(failures ? 1 : 0);
