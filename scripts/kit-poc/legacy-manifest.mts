/**
 * Manifeste d'un kit déjà envoyé, depuis son PSD d'origine (kit v1 sans
 * identifiant d'export) : l'import reconnaîtra ses emplacements inchangés.
 * Usage : node --import tsx scripts/kit-poc/legacy-manifest.mts <psd d'origine> <thème> <dossier des manifestes> [identifiant]
 * Ex. (fixture) : … /root/kitpoc/kit-galerie-lumineuse.psd galerie-lumineuse tests/fixtures legacy-galerie-lumineuse-v1
 */
import path from "node:path";

import { manifestFromPsd } from "@/lib/kit/import";
import { saveManifest } from "@/lib/kit/manifest";

const [psdPath, themeId, dir, exportId = `legacy-${themeId}-v1`] = process.argv.slice(2);
if (!psdPath || !themeId || !dir) throw new Error("usage : legacy-manifest.mts <psd> <thème> <dossier> [identifiant]");
const withPreviews = !process.argv.includes("--no-previews");
const manifest = await manifestFromPsd(psdPath, { exportId, themeId, themeVersion: "legacy" }, withPreviews ? dir : undefined);
await saveManifest(dir, manifest);
console.log(JSON.stringify({ file: path.join(dir, `${exportId}.json`), slots: Object.keys(manifest.slots).length, peakMb: Math.round(process.resourceUsage().maxRSS / 1024) }));
