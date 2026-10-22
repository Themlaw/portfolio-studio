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
 * Usage : node scripts/check-docker-context.mjs   (npm test, CI job check)
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));

/** Fichiers lus à l'exécution, hors traçage de Next (kit-child.cjs, visuels statiques du tuto). */
const RUNTIME = ["public/kit/fonts.conf", "public/kit/pdf-fonts.conf", "public/kit/Figtree.ttf", "public/kit/fonts", "public/admin/tuto", "drizzle", "seed", "src/lib/kit/child.ts", "scripts/restore-backup.mjs"];

const referenced = new Set(RUNTIME);
for (const name of ["build", "build:local"]) {
  for (const token of (pkg.scripts?.[name] ?? "").split(/\s+/)) {
    const value = token.includes("=") ? token.slice(token.lastIndexOf("=") + 1) : token;
    const clean = value.replace(/^\.\//, "");
    if (/^(scripts|src|public|node_modules)\//.test(clean)) referenced.add(clean);
  }
}

/** Règles .dockerignore → { négation, expression } (chemins relatifs à la racine du contexte). */
const rules = readFileSync(path.join(root, ".dockerignore"), "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"))
  .map((l) => {
    const neg = l.startsWith("!");
    const pat = (neg ? l.slice(1) : l).replace(/^\/+/, "").replace(/\/+$/, "");
    const re = pat
      .split("/")
      .map((seg) => (seg === "**" ? ".*" : seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]")))
      .join("/");
    return { neg, re: new RegExp(`^${re}$`), pat: l };
  });

/** Exclu si la dernière règle qui touche le chemin (ou un de ses dossiers parents) n'est pas une négation. */
function excluded(file) {
  const parts = file.split("/");
  let out = false;
  let by = "";
  for (const r of rules) {
    for (let i = 1; i <= parts.length; i++) {
      if (r.re.test(parts.slice(0, i).join("/"))) {
        out = !r.neg;
        by = r.pat;
        break;
      }
    }
  }
  return out ? by : null;
}

const problems = [];
for (const file of [...referenced].sort()) {
  // node_modules : installé dans l'image (npm ci), pas copié du contexte.
  if (file.startsWith("node_modules/")) continue;
  if (!existsSync(path.join(root, file))) problems.push(`${file} : introuvable`);
  const by = excluded(file);
  if (by) problems.push(`${file} : exclu du contexte Docker par « ${by} » (ajoute « !${file} » à .dockerignore)`);
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
