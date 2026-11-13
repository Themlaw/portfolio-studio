#!/usr/bin/env node
/**
 * Garde-fou (npm test) : les scripts d'installation des paquets restent désactivés en local.
 *  - `.npmrc` à la racine pose `ignore-scripts=true` (un paquet compromis ne s'exécute pas au `npm ci`) ;
 *  - package.json n'a aucun script `pre…` / `post…` : sous ce réglage, npm les ignorerait en silence.
 * Voir README, « Scripts d'installation des paquets désactivés ».
 */
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
let failures = 0;
const ok = (label, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!pass) failures++;
};

let npmrc = "";
try {
  npmrc = readFileSync(new URL(".npmrc", root), "utf8");
} catch {
  // absent : signalé ci-dessous
}
// Format ini de npm : « clé=valeur », commentaires # ou ; ; la dernière occurrence l'emporte.
const values = npmrc
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#") && !l.startsWith(";"))
  .map((l) => l.split("=").map((s) => s.trim()))
  .filter(([k]) => k === "ignore-scripts");
ok(".npmrc : ignore-scripts=true", values.length > 0 && values.at(-1)[1] === "true", npmrc ? "" : ".npmrc absent");

const scripts = JSON.parse(readFileSync(new URL("package.json", root), "utf8")).scripts ?? {};
// Un « preX » / « postX » n'est un crochet que si X est un script du projet ou une étape de npm (install, test…).
const LIFECYCLE = new Set(["install", "uninstall", "publish", "pack", "version", "test", "start", "stop", "restart", "prepare"]);
const hooks = Object.keys(scripts).filter((k) => {
  const m = k.match(/^(?:pre|post)(.+)$/);
  return m && (Object.hasOwn(scripts, m[1]) || LIFECYCLE.has(m[1]));
});
ok("package.json : aucun script pre… / post… (ignorés sous ignore-scripts)", hooks.length === 0, hooks.join(", "));

if (failures) {
  console.error(`check-npmrc : ${failures} échec(s)`);
  process.exit(1);
}
console.log("check-npmrc : OK");
