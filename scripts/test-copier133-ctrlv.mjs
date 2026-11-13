#!/usr/bin/env node
/**
 * Lot 133, Ctrl+V : un seul collage par frappe. `pasteBlock` est asynchrone (aller-retour serveur) ; sans garde de réentrance, un second
 * déclenchement pendant l'attente colle une deuxième fois (3 POST, 2 blocs, toast en double) pour un seul keydown. Ce test vérifie que le
 * collage est protégé contre une exécution concurrente (garde en cours). Données statiques (sans navigateur).
 * Usage : node scripts/test-copier133-ctrlv.mjs
 */
import { readFileSync } from "node:fs";

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const ROOT = new URL("..", import.meta.url).pathname;
const src = readFileSync(`${ROOT}src/components/admin/editor/VisualEditor.tsx`, "utf8");

// Extrait le corps de pasteBlock (jusqu'au début de pasteStyleOn).
const m = src.match(/const pasteBlock = async \(\) => \{([\s\S]*?)\n  \/\*\* Colle le style copié/);
ok("V0 pasteBlock trouvé", Boolean(m));
const body = m?.[1] ?? "";

// Garde de réentrance : un indicateur "collage en cours" (ref) lu en tête et posé avant l'attente, libéré en fin (finally), pour qu'un second
// appel pendant l'aller-retour serveur ne relance pas l'insertion.
ok("V1 refuse un collage déjà en cours (garde lue en tête)", /if\s*\(\s*\w+\.current\s*\)\s*return/.test(body.slice(0, 200)), "aucun retour anticipé sur garde en tête de pasteBlock");
ok("V2 marque le collage en cours avant l'attente serveur", /\w+\.current\s*=\s*true/.test(body) && body.indexOf(".current = true") < body.indexOf("await pasteBlocksAction"));
ok("V3 libère la garde à la fin (finally)", /finally\s*\{[\s\S]*\.current\s*=\s*false/.test(body));

if (failures) {
  console.log(`\n${failures} échec(s)`);
  process.exit(1);
}
console.log("\ntest-copier133-ctrlv : OK");
