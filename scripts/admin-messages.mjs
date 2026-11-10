#!/usr/bin/env node
/**
 * Lot 130 : assemble messages/admin-parts/<espace>.{fr,en}.json en messages/admin.fr.json et admin.en.json (un espace de noms par
 * fichier, ordre alphabétique, déterministe). `--check` : échoue si les catalogues assemblés ne sont pas à jour.
 * Usage : node scripts/admin-messages.mjs [--check]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const PARTS = path.join(ROOT, "messages/admin-parts");
const check = process.argv.includes("--check");
let stale = 0;
for (const lang of ["fr", "en"]) {
  const out = {};
  for (const f of readdirSync(PARTS).filter((n) => n.endsWith(`.${lang}.json`)).sort()) {
    out[f.slice(0, -`.${lang}.json`.length)] = JSON.parse(readFileSync(path.join(PARTS, f), "utf8"));
  }
  const text = `${JSON.stringify(out, null, 2)}\n`;
  const file = path.join(ROOT, `messages/admin.${lang}.json`);
  if (check) {
    if (!existsSync(file) || readFileSync(file, "utf8") !== text) {
      stale++;
      console.error(`messages/admin.${lang}.json n'est pas à jour : lance node scripts/admin-messages.mjs`);
    }
  } else {
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, text);
    renameSync(tmp, file);
  }
}
process.exit(stale ? 1 : 0);
