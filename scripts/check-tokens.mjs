#!/usr/bin/env node
/**
 * Garde-fou : aucune couleur en dur hors de src/themes/.
 *
 * Parcourt src/components, src/app et src/blocks (sauf globals.css, qui ne fait que
 * relayer les variables du thème) et échoue sur :
 *   - un hexadécimal de couleur (#abc, #aabbcc, #aabbccdd) ;
 *   - rgb( / rgba( / hsl( / hsla( / oklch( … ;
 *   - une couleur nommée de la palette Tailwind (bg-white, text-slate-500…).
 * Usage : node scripts/check-tokens.mjs   (exit 1 si violation)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const DIRS = ["src/components", "src/app", "src/blocks"];
// globals.css relaie les variables du thème ; admin.css définit le jeu de
// tokens fixe de l'admin (indépendant du thème public).
// EditThisPage : bouton de l'admin posé sur le site, styles en ligne (pas de CSS admin dans le bundle public).
const EXCLUDE = new Set(["src/app/globals.css", "src/app/admin/admin.css", "src/app/admin/preview-banner.css", "src/app/admin/edit-layer.css", "src/components/EditThisPage.tsx"]);
const EXT = /\.(tsx?|jsx?|mjs|css)$/;

const PALETTE =
  "white|black|slate|gray|grey|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const PREFIX =
  "bg|text|border|border-[trblxy]|from|via|to|fill|stroke|ring|ring-offset|outline|shadow|decoration|divide|accent|caret|placeholder";

const RULES = [
  { name: "hex", re: /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g },
  { name: "fonction couleur", re: /\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/g },
  {
    name: "couleur Tailwind nommée",
    re: new RegExp(`(?<![\\w-])(?:[\\w-]+:)*(?:${PREFIX})-(?:${PALETTE})(?:-\\d{2,3})?(?:\\/\\d+)?(?![\\w-])`, "g"),
  },
];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const violations = [];
for (const dir of DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const rel = relative(ROOT, file);
    if (!EXT.test(file) || EXCLUDE.has(rel)) continue;
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        for (const { name, re } of RULES) {
          for (const m of line.matchAll(re)) {
            violations.push(`${rel}:${i + 1}  ${name}  « ${m[0]} »`);
          }
        }
      });
  }
}

if (violations.length) {
  console.error(`check-tokens : ${violations.length} couleur(s) en dur hors src/themes/ :`);
  for (const v of violations) console.error("  " + v);
  console.error("→ utiliser un token du thème (bg-bg, text-ink, var(--color-primary)…).");
  process.exit(1);
}
console.log(`check-tokens : OK (${DIRS.join(", ")} sans couleur en dur)`);
