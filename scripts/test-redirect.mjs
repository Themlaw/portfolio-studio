#!/usr/bin/env node
/**
 * Chemins de retour (docs/SECURITE.md N17) : `/api/theme-preview?redirect=/.//evil.com` renvoyait `Location: //evil.com`
 * (adresse sans schéma, donc un autre site). Même défaut latent dans `localPath` (src/lib/preview.ts). Sans serveur.
 * Usage : node --import tsx scripts/test-redirect.mjs   (inclus dans npm test)
 */
import { adminScreen, localPath, sameOriginPath } from "../src/lib/preview.ts";

let failures = 0;
const ok = (label, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!pass) failures++;
};

const ORIGIN = "http://localhost:3001";
const EVIL = ["/.//evil.example", "/./\\evil.example", "//evil.example", "/\\evil.example", "/%2e//evil.example", "https://evil.example/x", "\\\\evil.example", "/\t/evil.example", "/././/evil.example/a?b=1"];
const preview = EVIL.map((c) => sameOriginPath(c, ORIGIN));
ok("R1 aperçu de thème : aucun retour vers un autre site (« /.//x », « //x », « /\\x »…) → « / »", preview.every((p) => p === "/"), preview.join(" | "));
const local = EVIL.map((c) => localPath(c, "/repli"));
ok("R2 localPath : aucun chemin « //… » rendu → repli", local.every((p) => p === "/repli" || !/^\/[/\\]/.test(p)), local.join(" | "));
ok("R2b localPath(« /.//evil.example ») → repli", localPath("/.//evil.example", "/repli") === "/repli", localPath("/.//evil.example", "/repli"));

// Les retours légitimes ne changent pas.
ok("R3 chemins locaux gardés (aperçu)", sameOriginPath("/fr/personnages?x=1", ORIGIN) === "/fr/personnages?x=1" && sameOriginPath(`${ORIGIN}/en`, ORIGIN) === "/en" && sameOriginPath(null, ORIGIN) === "/");
ok("R3b chemins locaux gardés (localPath, adminScreen)", localPath("/fr/decors", "/repli") === "/fr/decors" && adminScreen("/admin/themes?x=1") === "/admin/themes?x=1" && adminScreen("//evil.example/admin") === null);
ok("R3c chemin avec « // » au milieu gardé (même site)", sameOriginPath("/fr//a", ORIGIN) === "/fr//a");

if (failures) {
  console.error(`test-redirect : ${failures} échec(s)`);
  process.exit(1);
}
console.log("test-redirect : OK");
