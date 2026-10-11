#!/usr/bin/env node
/**
 * Contraste WCAG AA (≥ 4,5:1) de chaque preset de thème.
 *
 * Charge src/themes/presets/<slug>/theme.ts (Node ≥ 23 exécute le TypeScript
 * « effaçable » nativement), les valide avec le schéma zod, puis vérifie
 * les couples texte / fond réellement utilisés par les composants :
 *   ink, inkSoft (texte secondaire ET légendes), eyebrow (défaut : secondary),
 *   secondary, primary (liens) sur bg, bgDeep et surface ;
 *   onPrimary sur primary (boutons).
 * Usage : node scripts/check-contrast.mjs   (exit 1 si un couple échoue)
 */
import { loadPreset, presetSlugs } from "./lib/presets.mjs";

const { ThemeSchema } = await import(new URL("../src/themes/schema.ts", import.meta.url));
// Même logique que l'éditeur de thème et les server actions de l'admin.
const { AA: MIN, contrastReport } = await import(new URL("../src/themes/contrast.ts", import.meta.url));

const wanted = process.argv.slice(2);
const files = presetSlugs().filter((s) => !wanted.length || wanted.includes(s));
let failures = 0;

for (const file of files.sort()) {
  const raw = await loadPreset(file);
  const parsed = ThemeSchema.safeParse(raw);
  if (parsed.success && parsed.data.id !== file) {
    failures++;
    console.error(`✗ ${file} : l'id du thème (« ${parsed.data.id} ») doit être le nom de son dossier`);
    continue;
  }
  if (!parsed.success) {
    failures++;
    console.error(`✗ ${file} : schéma invalide`);
    for (const i of parsed.error.issues) console.error(`    ${i.path.join(".")}: ${i.message}`);
    continue;
  }
  console.log(`\n${parsed.data.id}`);
  for (const pair of contrastReport(parsed.data.tokens.color)) {
    if (!pair.ok) failures++;
    const label = `${pair.fg} / ${pair.bg}`;
    console.log(`  ${pair.ok ? "✓" : "✗"} ${label.padEnd(22)} ${pair.fgValue} sur ${pair.bgValue}  ${pair.ratio.toFixed(2)}:1`);
  }
}

if (failures) {
  console.error(`\ncheck-contrast : ${failures} échec(s) sous ${MIN}:1`);
  process.exit(1);
}
console.log(`\ncheck-contrast : OK (${files.length} presets, tous ≥ ${MIN}:1)`);
