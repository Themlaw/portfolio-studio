#!/usr/bin/env node
/**
 * Registre des thèmes livrés : (re)génère src/themes/presets/registry.generated.ts
 * à partir des dossiers src/themes/presets/<slug>/theme.ts.
 *
 * Next (Turbopack) a besoin d'imports statiques : ce fichier généré les écrit,
 * pour qu'ajouter un thème se résume à créer son dossier. Appelé par
 * `npm run theme:new` ; `--check` (npm test, theme:check) échoue si le
 * registre ne correspond plus aux dossiers (thème ajouté sans régénérer).
 * Usage : node scripts/theme-registry.mjs [--check]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PRESETS_DIR, presetSlugs, thumbPath } from "./lib/presets.mjs";

const OUT = path.join(PRESETS_DIR, "registry.generated.ts");

export function renderRegistry() {
  const slugs = presetSlugs();
  const ident = (slug) => "t_" + slug.replace(/-/g, "_");
  const lines = [
    "/**",
    " * GÉNÉRÉ par scripts/theme-registry.mjs — ne pas modifier à la main.",
    " * Un dossier src/themes/presets/<slug>/theme.ts = un thème livré ;",
    " * `npm run theme:new -- <slug>` crée le dossier et régénère ce fichier.",
    " */",
    'import type { ThemeInput } from "../schema";',
    "",
    ...slugs.map((slug) => `import ${ident(slug)} from "./${slug}/theme";`),
    "",
    "/** Données brutes des thèmes livrés, par ordre alphabétique de dossier. */",
    `export const RAW_PRESETS: readonly ThemeInput[] = [${slugs.map(ident).join(", ")}];`,
    "",
    "/** Dossier → vignette d'aperçu générée (npm run theme:thumbs). */",
    "export const PRESET_THUMBS: Readonly<Record<string, string>> = {",
    ...slugs.filter((slug) => existsSync(thumbPath(slug))).map((slug) => `  "${slug}": "/themes/${slug}/thumb.webp",`),
    "};",
    "",
  ];
  return { slugs, text: lines.join("\n") };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isMain) {
  const { slugs, text } = renderRegistry();
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (process.argv.includes("--check")) {
    if (current !== text) {
      console.error("theme-registry : ÉCHEC — registre périmé. Lance `node scripts/theme-registry.mjs` (ou npm run theme:new).");
      process.exit(1);
    }
    console.log(`theme-registry : OK (${slugs.length} thèmes livrés : ${slugs.join(", ")})`);
  } else if (current !== text) {
    writeFileSync(OUT, text);
    console.log(`theme-registry : ${path.relative(process.cwd(), OUT)} régénéré (${slugs.length} thèmes)`);
  } else {
    console.log("theme-registry : déjà à jour");
  }
}
