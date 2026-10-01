#!/usr/bin/env node
/**
 * Contenu de .next/standalone (ce qui part dans l'image) : ni sources, ni
 * données, ni documentation, ni base, ni secrets, ni fichiers de config.
 * Un accès fs dynamique mal marqué (turbopackIgnore) fait tracer tout le
 * projet : ce contrôle l'attrape.
 *
 * Usage : node scripts/check-standalone.mjs [--require]
 *   sans --require (npm test) : ignoré s'il n'y a pas de build ;
 *   avec --require (CI, après next build) : échoue sans standalone.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// STANDALONE_DIR : autre dossier à contrôler (test du contrôle lui-même).
const ROOT = process.env.STANDALONE_DIR ?? new URL("../.next/standalone/", import.meta.url).pathname;
if (!existsSync(ROOT)) {
  if (process.argv.includes("--require")) {
    console.error("check-standalone : .next/standalone absent (lancer next build d'abord)");
    process.exit(1);
  }
  console.log("check-standalone : ignoré (pas de build)");
  process.exit(0);
}

/** Entrées autorisées à la racine du standalone. */
const ALLOWED_TOP = new Set([".next", "node_modules", "server.js", "package.json", "drizzle", "seed", "public"]);
const FORBIDDEN_FILE = [
  /\.db(-wal|-shm)?$/,
  /^\.env/,
  /^(next|postcss|eslint|drizzle|tailwind)\.config\.[cm]?[jt]s$/,
  /^tsconfig.*\.json$/,
  /\.tsbuildinfo$/,
  /^package-lock\.json$/,
  /^(README)\.md$/,
];

const problems = [];
for (const name of readdirSync(ROOT)) {
  if (!ALLOWED_TOP.has(name)) problems.push(`${name} (entrée non autorisée à la racine)`);
}
// Fichiers interdits n'importe où hors node_modules (dépendances : leur affaire).
function walk(dir, rel = "") {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const r = rel ? `${rel}/${name}` : name;
    if (name === "node_modules") continue;
    if (statSync(full).isDirectory()) {
      if (["src", "data", "docs"].includes(name)) problems.push(`${r}/ (dossier interdit)`);
      walk(full, r);
    } else if (FORBIDDEN_FILE.some((re) => re.test(name))) {
      problems.push(`${r} (fichier interdit)`);
    }
  }
}
walk(ROOT);

if (problems.length) {
  console.error(`check-standalone : ÉCHEC (${problems.length})`);
  for (const p of problems.slice(0, 30)) console.error(`  ${p}`);
  process.exit(1);
}
console.log("check-standalone : OK (ni sources, ni données, ni configuration)");
