/**
 * Processus enfant du kit PSD (jobs « kit » et « kit-import » de la file
 * lourde). Entrée : JSON sur stdin ; sortie : une ligne JSON.
 *  - export : { mode: "export", theme, publicDir, out, exportId, themeVersion, siteName, manifestDir }
 *  - import : { mode: "import", psd, outDir, manifestDir, themeId }
 * Lancé avec MALLOC_ARENA_MAX=2 et MALLOC_MMAP_THRESHOLD_ (mémoire rendue au
 * système), FONTCONFIG_FILE (aucune police système), sous nice. En production,
 * bundle esbuild `kit-child.cjs` à la racine du standalone ; en dev, via tsx.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";

import { ThemeSchema } from "@/themes/schema";

import { buildKit, type BuildOptions } from "./build";
import { importKit } from "./import";
import { loadManifests } from "./manifest";

type Input =
  | { mode?: "export"; theme: unknown; publicDir: string; out: string; exportId: string; themeVersion: string; siteName: string; manifestDir: string; assets?: BuildOptions["assets"] }
  | { mode: "import"; psd: string; outDir: string; manifestDir: string; themeId?: string };

const peakMb = () => Math.round(process.resourceUsage().maxRSS / 1024);

/**
 * Priorité OOM maximale : en cas de manque de mémoire du conteneur, le noyau
 * tue cet enfant, jamais le serveur (augmenter son propre score est permis
 * sans privilège ; le parent l'écrit aussi juste après le lancement).
 */
function oomFirst(): number | null {
  try {
    writeFileSync("/proc/self/oom_score_adj", "1000");
  } catch {
    // /proc absent (hors Linux) : sans effet
  }
  try {
    return Number(readFileSync("/proc/self/oom_score_adj", "utf8").trim());
  } catch {
    return null;
  }
}
const oom = oomFirst();

async function main() {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const input = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Input;
  const t0 = Date.now();
  if (input.mode === "import") {
    const report = await importKit(input.psd, input.outDir, { manifests: await loadManifests(input.manifestDir), themeId: input.themeId });
    process.stdout.write(`${JSON.stringify({ ok: true, reportOk: report.ok, problem: report.problem ?? null, ms: Date.now() - t0, peakMb: peakMb(), oom })}\n`);
    return;
  }
  const theme = ThemeSchema.parse(input.theme);
  const { psd, stats } = await buildKit(theme, input.publicDir, { exportId: input.exportId, themeVersion: input.themeVersion, siteName: input.siteName, assets: input.assets, manifestDir: input.manifestDir });
  // Écriture atomique : le fichier n'apparaît en cache qu'entier.
  await writeFile(`${input.out}.tmp`, psd);
  await rename(`${input.out}.tmp`, input.out);
  process.stdout.write(`${JSON.stringify({ ok: true, bytes: psd.length, ms: Date.now() - t0, peakMb: peakMb(), oom, stats })}\n`);
}

main().catch((error: unknown) => {
  process.stdout.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exit(1);
});
