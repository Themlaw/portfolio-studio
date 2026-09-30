#!/usr/bin/env node
/**
 * Garde des server actions de l'admin (analyse statique).
 *
 * Règle : toute server action définie sous src/app/admin ou src/components/admin
 * — fonction exportée d'un fichier "use server", ou fonction marquée
 * "use server" en ligne — commence par `await assertAdmin()`. De même pour les
 * gestionnaires mutants (POST, PUT, PATCH, DELETE) des route.ts de src/app/admin.
 * Échoue aussi si aucune action n'est trouvée (test qui ne vérifierait rien).
 * Usage : node scripts/test-admin-guard.mjs   (inclus dans npm test)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const DIRS = ["src/app/admin", "src/components/admin"];
const GUARD = /^\s*(?:const\s+\w+\s*=\s*)?await\s+assertAdmin\(\)\s*;/;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/** Corps d'une fonction à partir de l'accolade ouvrante (appariement simple). */
function bodyAfter(source, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(openIndex + 1, i);
  }
  return "";
}

const failures = [];
let checked = 0;

for (const dir of DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const rel = relative(ROOT, file);
    const src = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const fileLevel = /^\s*["']use server["'];?/.test(src);

    if (fileLevel) {
      // Toute fonction exportée d'un fichier "use server" est une server action.
      const exportFn = /export\s+(?:default\s+)?async\s+function\s+(\w+)\s*\([^)]*\)[^{]*\{/g;
      const exportArrow = /export\s+const\s+(\w+)\s*=\s*async\s*\([^)]*\)[^=]*=>\s*\{/g;
      for (const re of [exportFn, exportArrow]) {
        for (const m of src.matchAll(re)) {
          checked++;
          const body = bodyAfter(src, m.index + m[0].length - 1);
          if (!GUARD.test(body)) failures.push(`${rel} : action « ${m[1]} » sans \`await assertAdmin()\` en première instruction`);
        }
      }
      if (/export\s+(?:const|let)\s+\w+\s*=\s*(?!async)/.test(src)) {
        failures.push(`${rel} : un fichier "use server" ne doit exporter que des fonctions async gardées`);
      }
    }

    // Routes mutantes de l'admin.
    if (/\/route\.tsx?$/.test(rel)) {
      for (const m of src.matchAll(/export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\s*\([^)]*\)[^{]*\{/g)) {
        checked++;
        const body = bodyAfter(src, m.index + m[0].length - 1);
        if (!GUARD.test(body)) failures.push(`${rel} : route ${m[1]} sans \`await assertAdmin()\` en première instruction`);
      }
      if (/export\s+(?:const|function)\s+(POST|PUT|PATCH|DELETE)\b(?![\s\S]*?async)/.test(src)) {
        failures.push(`${rel} : gestionnaire mutant non async (garde impossible à vérifier)`);
      }
    }

    // Actions en ligne : fonction dont la première instruction est "use server".
    for (const m of src.matchAll(/\{\s*["']use server["'];?/g)) {
      checked++;
      const after = src.slice(m.index + m[0].length);
      if (!GUARD.test(after)) failures.push(`${rel} : action en ligne sans \`await assertAdmin()\` juste après "use server"`);
    }
  }
}

if (checked === 0) failures.push("aucune server action trouvée : le test ne vérifie rien (chemins à revoir ?)");

if (failures.length) {
  console.error("test-admin-guard : ÉCHEC");
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log(`test-admin-guard : OK (${checked} server action(s) et route(s) mutante(s) gardée(s))`);
