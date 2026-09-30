#!/usr/bin/env node
/**
 * Contraste WCAG AA (≥ 4,5:1) de chaque preset de thème.
 *
 * Charge src/themes/presets/*.ts (Node ≥ 23 exécute le TypeScript
 * « effaçable » nativement), les valide avec le schéma zod, puis vérifie
 * les couples texte / fond réellement utilisés par les composants :
 *   ink, inkSoft (texte secondaire ET légendes), eyebrow (défaut : secondary),
 *   secondary, primary (liens) sur bg, bgDeep et surface ;
 *   onPrimary sur primary (boutons).
 * Usage : node scripts/check-contrast.mjs   (exit 1 si un couple échoue)
 */
import { readdirSync } from "node:fs";

const MIN = 4.5;
const dir = new URL("../src/themes/presets/", import.meta.url);
const { ThemeSchema } = await import(new URL("../src/themes/schema.ts", import.meta.url));

function luminance(hex) {
  let h = hex.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && f !== "index.ts");
let failures = 0;

for (const file of files.sort()) {
  const raw = (await import(new URL(file, dir))).default;
  const parsed = ThemeSchema.safeParse(raw);
  if (!parsed.success) {
    failures++;
    console.error(`✗ ${file} : schéma invalide`);
    for (const i of parsed.error.issues) console.error(`    ${i.path.join(".")}: ${i.message}`);
    continue;
  }
  const c = parsed.data.tokens.color;
  const texts = {
    ink: c.ink,
    inkSoft: c.inkSoft,
    "eyebrow": c.eyebrow ?? c.secondary,
    secondary: c.secondary,
    primary: c.primary,
  };
  const grounds = { bg: c.bg, bgDeep: c.bgDeep, surface: c.surface };
  const rows = [];
  for (const [tn, tv] of Object.entries(texts)) {
    for (const [gn, gv] of Object.entries(grounds)) rows.push([`${tn} / ${gn}`, tv, gv]);
  }
  rows.push(["onPrimary / primary", c.onPrimary, c.primary]);

  console.log(`\n${parsed.data.id}`);
  for (const [label, fg, bg] of rows) {
    const r = ratio(fg, bg);
    const ok = r >= MIN;
    if (!ok) failures++;
    console.log(`  ${ok ? "✓" : "✗"} ${label.padEnd(22)} ${fg} sur ${bg}  ${r.toFixed(2)}:1`);
  }
}

if (failures) {
  console.error(`\ncheck-contrast : ${failures} échec(s) sous ${MIN}:1`);
  process.exit(1);
}
console.log(`\ncheck-contrast : OK (${files.length} presets, tous ≥ ${MIN}:1)`);
