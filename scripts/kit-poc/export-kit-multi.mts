/**
 * Export du kit v4 (trois PSD) d'un thème livré : écrit les PSD, mesure le pic
 * mémoire par étape, relit chaque fichier (arborescence, emplacements résolus).
 * Usage : node --expose-gc --import tsx scripts/kit-poc/export-kit-multi.mts <dossier> [thème] [--shots <dossier>]
 *   KIT_MEM_DEBUG=1 : pic et RSS courant par étape sur stderr
 *   SITE_NAME       : nom du site (logo pré-rempli), défaut « Camille Roussel »
 */
import { readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { readPsd, type Layer } from "ag-psd";

import { ensureAgPsd } from "@/lib/kit/ag-psd-node";
import { buildKitMulti } from "@/lib/kit/build-multi";
import { exportIdOf } from "@/lib/kit/manifest";
import { layoutOf, resolveDecor, resolveSlots } from "@/lib/kit/resolve";
import { KIT_FILES, KIT_V4_VERSION, slotsOfRole } from "@/lib/kit/spec";
import { themeVersion } from "@/lib/kit/version";
import { PRESETS } from "@/themes/presets";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const shots = opt("--shots");
const [outDir, themeId = "galerie-lumineuse"] = args;
const theme = PRESETS[themeId];
if (!theme) throw new Error(`thème inconnu : ${themeId}`);
const siteName = process.env.SITE_NAME ?? "Camille Roussel";
const version = themeVersion(theme, siteName);
const exportId = exportIdOf(theme.id, version, KIT_V4_VERSION);
await mkdir(outDir, { recursive: true });
if (shots) await mkdir(shots, { recursive: true });
const t0 = Date.now();
const res = await buildKitMulti(theme, path.resolve("public"), { exportId, themeVersion: version, siteName, manifestDir: path.join(outDir, "manifests"), outDir, compositeDir: shots });
const peak = Math.round(process.resourceUsage().maxRSS / 1024);
console.log(JSON.stringify({ ms: Date.now() - t0, peakMb: peak, files: res.files.map((f) => ({ role: f.role, mb: Math.round(f.bytes / 1048576) })), layers: res.stats.layers, prefilled: res.stats.prefilled, placeholders: res.stats.placeholders }));

ensureAgPsd();
for (const f of res.files) {
  const back = readPsd(readFileSync(f.path), { useImageData: true, skipCompositeImageData: true, skipLayerImageData: true, skipThumbnail: true });
  const layout = layoutOf(back.width, back.height);
  const lines: string[] = [];
  const tree = (list: Layer[] | undefined, depth: number) => {
    for (const l of [...(list ?? [])].reverse()) {
      const lock = l.protected?.position ? " [verrouillé]" : "";
      const size = l.children ? "" : `  ${(l.right ?? 0) - (l.left ?? 0)} × ${(l.bottom ?? 0) - (l.top ?? 0)} à (${l.left}, ${l.top})`;
      lines.push(`${"    ".repeat(depth)}${l.children ? "▾ " : "  "}${l.name}${lock}${size}`);
      tree(l.children, depth + 1);
    }
  };
  tree(back.children, 0);
  if (shots) writeFileSync(path.join(shots, `${f.role}-calques.txt`), `${lines.join("\n")}\n`);
  if (f.role === "decor") {
    const d = resolveDecor(back.children);
    console.log(`${KIT_FILES[f.role].file} : ${back.width} × ${back.height}, layout ${layout}, ${d.plans.length} plans, rôle ${d.role}, id ${d.exportId}`);
  } else {
    const r = resolveSlots(back.children, layout!, f.role);
    const missing = slotsOfRole(f.role).filter((s) => !r.sources.has(s.id)).map((s) => s.id);
    console.log(`${KIT_FILES[f.role].file} : ${back.width} × ${back.height}, layout ${layout}, manquants [${missing}], ignorés [${r.ignored}], rôle ${r.role}, id ${r.exportId}`);
  }
}
