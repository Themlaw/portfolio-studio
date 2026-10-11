#!/usr/bin/env node
/**
 * Régénère le catalogue statique des familles Google Fonts proposées dans
 * l'éditeur (src/themes/google-fonts.json). Lancé à la main, rarement : le
 * catalogue est embarqué dans le dépôt (aucune requête vers Google pour
 * l'afficher). Seules les familles latines, libres, sans écriture principale
 * non latine ni couleur, sont gardées, par popularité.
 *
 * Format compact (une ligne par famille) :
 *   [famille, catégorie, graisses droites, graisses italiques?, latinExt?]
 *   catégorie : s(ans) r (serif) d(isplay) h(andwriting) m(onospace)
 *   graisses : chiffres des centaines (« 47 » = 400 et 700)
 *   latinExt : 0 si la famille n'a pas de sous-ensemble latin-ext
 *
 * Usage : node scripts/gen-google-fonts.mjs
 */
import { writeFileSync } from "node:fs";

const CATEGORY = { "Sans Serif": "s", Serif: "r", Display: "d", Handwriting: "h", Monospace: "m" };
const res = await fetch("https://fonts.google.com/metadata/fonts");
if (!res.ok) throw new Error(`métadonnées Google Fonts : HTTP ${res.status}`);
const { familyMetadataList } = await res.json();

const out = [];
for (const f of familyMetadataList.sort((a, b) => a.popularity - b.popularity)) {
  if (!f.subsets.includes("latin") || f.primaryScript || f.isBrandFont || f.isOpenSource === false || f.colorCapabilities?.length) continue;
  // Familles au nom simple seulement (le nom finit dans une feuille CSS).
  if (!/^[A-Za-z0-9 ]{1,60}$/.test(f.family) || !CATEGORY[f.category]) continue;
  const keys = Object.keys(f.fonts);
  const normal = [...new Set(keys.filter((k) => !k.endsWith("i")).map((k) => k[0]))].sort().join("");
  const italic = [...new Set(keys.filter((k) => k.endsWith("i")).map((k) => k[0]))].sort().join("");
  if (!normal) continue;
  const entry = [f.family, CATEGORY[f.category], normal];
  const ext = f.subsets.includes("latin-ext");
  if (italic || !ext) entry.push(italic);
  if (!ext) entry.push(0);
  out.push(entry);
}
const path = new URL("../src/themes/google-fonts.json", import.meta.url);
writeFileSync(path, JSON.stringify(out).replace(/\],\[/g, "],\n["));
console.log(`${out.length} familles écrites dans src/themes/google-fonts.json`);
