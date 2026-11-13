#!/usr/bin/env node
/**
 * Contexte Docker : tout ce dont `npm run build` a besoin doit y être.
 * Lit les scripts `build` / `build:local` de package.json, en extrait les
 * fichiers référencés (scripts appelés, point d'entrée et alias esbuild), y
 * ajoute les fichiers lus à l'exécution par le processus enfant du kit
 * (polices, configuration fontconfig), puis vérifie qu'aucun n'est exclu par
 * .dockerignore (motifs Docker : ordre, négation « ! », « * », « ** ») et que
 * chacun existe. Échoue sinon : un `docker build` cassé est vu dès `check`
 * (v0.9.0 : scripts/copy-kit-native.mjs exclu, `npm run build` en échec).
 * Inversement (S6, S7), ce qui ne doit JAMAIS partir dans le contexte (ni donc dans le cache BuildKit exporté par la CI) :
 * documentation (dont le rapport d'audit), secrets (.npmrc, clés), bases SQLite, dossier .local/ (worktrees, notes) ; et le
 * cache de la CI reste en `mode=min` (seules les couches de l'image finale, jamais celle du `COPY . .`).
 * Usage : node scripts/check-docker-context.mjs   (npm test, CI job check)
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { excludedBy, parseDockerignore } from "./lib/dockerignore.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

/** Fichiers lus à l'exécution, hors traçage de Next (kit-child.cjs, visuels statiques du tuto). */
const RUNTIME = ["public/kit/fonts.conf", "public/kit/pdf-fonts.conf", "public/kit/Figtree.ttf", "public/kit/fonts", "public/admin/tuto", "drizzle", "seed", "src/lib/kit/child.ts", "scripts/restore-backup.mjs", "scripts/reset-password.mjs"];

const referenced = new Set(RUNTIME);
for (const name of ["build", "build:local"]) {
  for (const token of (pkg.scripts?.[name] ?? "").split(/\s+/)) {
    const value = token.includes("=") ? token.slice(token.lastIndexOf("=") + 1) : token;
    const clean = value.replace(/^\.\//, "");
    if (/^(scripts|src|public|node_modules)\//.test(clean)) referenced.add(clean);
  }
}

/** Règles .dockerignore (scripts/lib/dockerignore.mjs : motifs Docker, ordre, négation « ! », « * », « ** »). */
const rules = parseDockerignore(readFileSync(path.join(root, ".dockerignore"), "utf8"));
const excluded = (file) => excludedBy(rules, file);

const problems = [];
for (const file of [...referenced].sort()) {
  // node_modules : installé dans l'image (npm ci), pas copié du contexte.
  if (file.startsWith("node_modules/")) continue;
  if (!existsSync(path.join(root, file))) problems.push(`${file} : introuvable`);
  const by = excluded(file);
  if (by) problems.push(`${file} : exclu du contexte Docker par « ${by} » (ajoute « !${file} » à .dockerignore)`);
}
// Ce qui ne doit jamais entrer dans le contexte (S6, S7) : exemples de chemins qui DOIVENT être exclus.
const MUST_EXCLUDE = [
  "docs/SECURITE.md",
  "docs/ARCHITECTURE.md",
  ".npmrc",
  "scripts/.npmrc",
  "deploy.key",
  "src/certs/serveur.key",
  "cert.p12",
  "id_ed25519",
  "id_rsa.pub",
  "portfolio.db",
  "tests/base-de-test.db",
  "anciennes/donnees.sqlite",
  ".local/worktrees/tmp/portfolio.db",
  ".local/settings.local.json",
];
for (const file of MUST_EXCLUDE) if (!excluded(file)) problems.push(`${file} : doit être exclu du contexte Docker (.dockerignore)`);
// Cache BuildKit de la CI : `mode=max` exporterait la couche du `COPY . .` (tout le contexte) dans le cache GitHub Actions.
const dockerWorkflow = readFileSync(path.join(root, ".github/workflows/docker.yml"), "utf8");
for (const m of dockerWorkflow.matchAll(/cache-to:\s*(\S+)/g)) {
  if (!/(^|,)mode=min(,|$)/.test(m[1])) problems.push(`.github/workflows/docker.yml : « cache-to: ${m[1]} » doit être en mode=min (mode=max exporte la couche COPY . . et tout le contexte)`);
}

// Commandes externes lancées par l'application (spawn, nice -n 10 <outil>,
// runPoppler) : chacune doit être copiée dans l'image (stage « ffmpeg » du
// Dockerfile, binaire + fermeture ldd) — l'image distroless n'a rien d'autre.
const dockerfile = readFileSync(path.join(root, "Dockerfile"), "utf8");
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []));
const commands = new Set();
for (const file of walk(path.join(root, "src"))) {
  const src = readFileSync(file, "utf8");
  for (const re of [/spawn\("([\w-]+)"/g, /\["-n", "10", "([\w-]+)"/g, /runPoppler\("([\w-]+)"/g]) for (const m of src.matchAll(re)) commands.add(m[1]);
}
for (const cmd of [...commands].sort()) {
  if (!new RegExp(`cp -a [^\\n]*/usr/bin/${cmd}\\b`).test(dockerfile) || !new RegExp(`ldd [^\\n]*/usr/bin/${cmd}\\b`).test(dockerfile)) {
    problems.push(`commande « ${cmd} » lancée par l'application mais absente de l'image (Dockerfile : cp -a /usr/bin/${cmd} et fermeture ldd)`);
  }
}

if (problems.length) {
  console.error(`check-docker-context : ÉCHEC (${problems.length})\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`check-docker-context : OK (${referenced.size} chemins requis par le build présents dans le contexte ; commandes externes dans l'image : ${[...commands].sort().join(", ")})`);
