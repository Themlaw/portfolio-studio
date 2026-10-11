#!/usr/bin/env node
/**
 * Contrôle complet des thèmes livrés (docs/THEMES.md), un rapport par thème :
 *  - registre à jour (thème ajouté sans régénérer ?) ;
 *  - id = nom du dossier ; schéma zod valide, SANS clé inconnue ;
 *  - contraste AA (même logique que check:contrast, l'éditeur et l'import) ;
 *  - polices au catalogue avec leur fichier OFL embarqué (kit Photoshop) ;
 *  - calques du hero présents dans public/, rangés dans le dossier du thème ;
 *  - vignette d'aperçu présente et à jour (empreinte thumb.json) ;
 *  - avec --render (serveur dev sur PORT) : vignette re-rendue, sans erreur
 *    console, police de titre chargée.
 * Usage : npm run theme:check [-- <slug>…] [--render]
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { loadPreset, presetSlugs, ROOT, thumbPath, thumbStampPath } from "./lib/presets.mjs";
import { renderThumbs, themeStamp } from "./theme-thumbs.mjs";

const args = process.argv.slice(2);
const render = args.includes("--render");
const wanted = args.filter((a) => !a.startsWith("--"));
const slugs = presetSlugs().filter((s) => !wanted.length || wanted.includes(s));
for (const w of wanted) if (!presetSlugs().includes(w)) console.error(`thème inconnu « ${w} » (dossiers : ${presetSlugs().join(", ")})`);

const { ThemeSchema } = await import(new URL("../src/themes/schema.ts", import.meta.url));
const { AA, contrastReport } = await import(new URL("../src/themes/contrast.ts", import.meta.url));
const { unknownKeys } = await import(new URL("../src/themes/strict.ts", import.meta.url));
const { FONT_STACKS } = await import(new URL("../src/themes/font-stacks.ts", import.meta.url));
const { KIT_FONTS } = await import(new URL("../src/lib/kit/fonts.ts", import.meta.url));

let failures = 0;
const report = (ok, label) => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failures++;
};

const reg = spawnSync(process.execPath, [path.join(ROOT, "scripts/theme-registry.mjs"), "--check"], { encoding: "utf8" });
console.log(reg.status === 0 ? "✓ registre à jour" : `✗ ${reg.stderr.trim()}`);
if (reg.status !== 0) failures++;

for (const slug of slugs) {
  console.log(`\n${slug}`);
  const raw = await loadPreset(slug);
  const parsed = ThemeSchema.safeParse(raw);
  if (!parsed.success) {
    report(false, `schéma : ${parsed.error.issues.map((i) => `${i.path.join(".")} — ${i.message}`).join(" ; ")}`);
    continue;
  }
  const theme = parsed.data;
  report(theme.id === slug, `id « ${theme.id} » = nom du dossier`);
  report(theme.preset === true, "preset: true (thème livré)");
  const extra = unknownKeys(raw, theme);
  report(extra.length === 0, extra.length ? `clés inconnues : ${extra.join(", ")}` : "schéma valide, aucune clé inconnue");

  const failing = contrastReport(theme.tokens.color).filter((p) => !p.ok);
  report(failing.length === 0, failing.length ? `contraste sous ${AA}:1 : ${failing.map((p) => `${p.fg}/${p.bg} ${p.ratio.toFixed(2)}`).join(", ")}` : `contraste AA (${contrastReport(theme.tokens.color).length} couples ≥ ${AA}:1)`);

  for (const role of ["display", "body", "caption"]) {
    const id = theme.tokens.font[role];
    const kit = KIT_FONTS[id];
    report(Boolean(FONT_STACKS[id] && kit && existsSync(path.join(ROOT, "public/kit/fonts", kit.file))), `police ${role} : ${FONT_STACKS[id]?.label ?? id}`);
  }

  const layers = theme.assets.heroLayers ?? [];
  const missing = layers.filter((l) => !existsSync(path.join(ROOT, "public", l)));
  const foreign = layers.filter((l) => !l.startsWith(`/themes/${slug}/`));
  if (theme.variants.hero === "parallax-layers") report(layers.length > 0, `hero parallax-layers : ${layers.length} calque(s)`);
  if (layers.length) {
    report(missing.length === 0, missing.length ? `calques absents : ${missing.join(", ")}` : "calques présents dans public/");
    report(foreign.length === 0, foreign.length ? `calques hors de public/themes/${slug}/ : ${foreign.join(", ")}` : `calques rangés dans public/themes/${slug}/`);
  }

  const stamp = await themeStamp(raw);
  const saved = existsSync(thumbStampPath(slug)) ? JSON.parse(readFileSync(thumbStampPath(slug), "utf8")).theme : null;
  if (!render) {
    report(existsSync(thumbPath(slug)), existsSync(thumbPath(slug)) ? "vignette présente" : `vignette absente : PORT=… npm run theme:thumbs -- ${slug}`);
    report(saved === stamp, saved === stamp ? "vignette à jour" : `vignette périmée (thème modifié depuis) : PORT=… npm run theme:thumbs -- ${slug}`);
  }
}

if (render) {
  console.log(`\nRendu des vignettes (serveur dev sur le port ${process.env.PORT ?? "3001"})`);
  const bad = await renderThumbs(slugs);
  failures += bad.length;
  spawnSync(process.execPath, [path.join(ROOT, "scripts/theme-registry.mjs")], { stdio: "inherit" });
}

if (failures) {
  console.error(`\ntheme:check : ${failures} problème(s)`);
  process.exit(1);
}
console.log(`\ntheme:check : OK (${slugs.length} thème(s))`);
