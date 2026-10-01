/**
 * Import d'un kit PSD et mesures (phase 6b). Un processus par mesure : le pic
 * (maxRSS = VmHWM) est celui de l'import seul.
 * Usage : node --import tsx scripts/kit-poc/run-import.mts <psd> <sortie> [--relaxed] [--full-decode] [--keep]
 *   --relaxed     : limites levées (mesurer un PSD que le préalable refuserait)
 *   --full-decode : ag-psd décode TOUS les calques d'un coup (référence)
 *   --keep        : garde les calques rognés en PNG (captures avant/après)
 *   --manifests <dossier> : manifestes des kits exportés (emplacements inchangés)
 */
import { readFileSync } from "node:fs";

import { readPsd } from "ag-psd";

import { ensureAgPsd } from "@/lib/kit/ag-psd-node";
import { DEFAULT_LIMITS, importKit } from "@/lib/kit/import";
import { loadManifests } from "@/lib/kit/manifest";

const [psdPath, outDir] = process.argv.slice(2);
const flags = new Set(process.argv.slice(4));
const mb = (kb: number) => Math.round(kb / 1024);

if (flags.has("--full-decode")) {
  ensureAgPsd();
  const t0 = Date.now();
  const psd = readPsd(readFileSync(psdPath), { useImageData: true, skipCompositeImageData: true, skipThumbnail: true });
  console.log(JSON.stringify({ mode: "full-decode", layers: psd.children?.length, ms: Date.now() - t0, peakMb: mb(process.resourceUsage().maxRSS) }));
  process.exit(0);
}

const startMb = mb(process.resourceUsage().maxRSS);
const t0 = Date.now();
const limits = flags.has("--relaxed") ? { ...DEFAULT_LIMITS, maxFileBytes: 2 ** 31, maxLayers: 1000, maxLayerArea: 1e12 } : DEFAULT_LIMITS;
const mIdx = process.argv.indexOf("--manifests");
const manifests = mIdx > 0 ? await loadManifests(process.argv[mIdx + 1]) : [];
const report = await importKit(psdPath, outDir, { limits, keepCrops: flags.has("--keep"), manifests });
console.log(
  JSON.stringify({
    mode: "import",
    ok: report.ok,
    problem: report.problem,
    preflight: report.preflight,
    readMs: report.readMs,
    afterReadMb: report.afterReadMb,
    afterFreeMb: report.afterFreeMb,
    startMb: startMb,
    totalMs: Date.now() - t0,
    peakMb: mb(process.resourceUsage().maxRSS),
    totals: report.totals,
    layout: report.layout,
    reference: report.reference,
    slots: report.slots.map((s) => ({ id: s.id, status: s.status, change: s.change, src: s.source, ms: s.ms, peakMb: s.peakMb, fid: s.fidelity, chosen: s.chosen, bytes: s.bytes, cand: s.candidates, tex: s.textured, seam: s.seam, mono: s.mono, msg: s.messages })),
    ignored: report.ignoredLayers,
    palette: report.palette,
  }),
);
