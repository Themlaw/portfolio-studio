#!/usr/bin/env node
/**
 * Crée le squelette d'un thème livré à partir d'un thème existant :
 *   src/themes/presets/<slug>/theme.ts   (copie du thème de base, id et nom remplacés)
 *   public/themes/<slug>/                (copie de ses assets : calques du hero…)
 * puis régénère le registre (registry.generated.ts). Voir docs/THEMES.md.
 *
 * Usage : npm run theme:new -- <slug> [--from <thème de base>] [--name "Nom affiché"]
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { PRESETS_DIR, PUBLIC_THEMES_DIR, ROOT, SLUG, presetSlugs } from "./lib/presets.mjs";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const base = opt("--from") ?? "galerie-lumineuse";
const nameArg = opt("--name");
const slug = args[0];

const die = (msg) => {
  console.error(`theme:new : ${msg}`);
  process.exit(1);
};
if (!slug || !SLUG.test(slug) || slug.length > 60) die("donne un identifiant en minuscules, chiffres et tirets (ex. npm run theme:new -- aquarelle).");
if (existsSync(path.join(PRESETS_DIR, slug))) die(`le thème « ${slug} » existe déjà (src/themes/presets/${slug}/).`);
if (!presetSlugs().includes(base)) die(`thème de base inconnu « ${base} ». Thèmes livrés : ${presetSlugs().join(", ")}.`);

const name = nameArg ?? slug.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
const src = readFileSync(path.join(PRESETS_DIR, base, "theme.ts"), "utf8");
let out = src
  .replace(new RegExp(`id: "${base}"`), `id: "${slug}"`)
  .replace(/name: "[^"]*"/, `name: ${JSON.stringify(name)}`)
  .replaceAll(`/themes/${base}/`, `/themes/${slug}/`);
// En-tête : la direction artistique du nouveau thème, à écrire.
out = out.replace(/\/\*\*[\s\S]*?\*\/\n(?=const theme)/, `/**\n * ${name} — direction artistique en une phrase (à écrire).\n * Créé par \`npm run theme:new\` à partir de « ${base} ».\n */\n`);
if (!out.includes(`id: "${slug}"`)) die(`impossible de remplacer l'id dans la copie de ${base}/theme.ts.`);

const dir = path.join(PRESETS_DIR, slug);
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, "theme.ts"), out);
const assets = path.join(PUBLIC_THEMES_DIR, base);
if (existsSync(assets)) {
  cpSync(assets, path.join(PUBLIC_THEMES_DIR, slug), { recursive: true });
  // La vignette est celle du thème de base : à régénérer.
  for (const f of ["thumb.webp", "thumb.json"]) rmSync(path.join(PUBLIC_THEMES_DIR, slug, f), { force: true });
}
const reg = spawnSync(process.execPath, [path.join(ROOT, "scripts/theme-registry.mjs")], { stdio: "inherit" });
if (reg.status !== 0) process.exit(1);

console.log(`
Thème « ${name} » créé :
  src/themes/presets/${slug}/theme.ts   ← couleurs, polices, variantes
  public/themes/${slug}/                ← assets (calques du hero…)${existsSync(assets) ? "" : " (aucun : le thème de base n'en a pas)"}
Ensuite :
  1. modifie theme.ts ;
  2. npm run theme:check -- ${slug}            (schéma, contraste, assets) ;
  3. redémarre le serveur dev (le thème entre en base au démarrage), puis
     PORT=3001 npm run theme:thumbs -- ${slug}  (vignette de la galerie) ;
  4. aperçu : http://localhost:3001/api/theme-preview?id=${slug}`);
