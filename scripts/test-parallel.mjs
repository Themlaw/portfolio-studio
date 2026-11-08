#!/usr/bin/env node
/**
 * Lot 104 : `npm test` en parallèle. Découpe le script `test` de package.json (chaîne de
 * « a && b && c ») et lance les étapes N à la fois ; mêmes commandes, mêmes assertions, seul
 * l'ordre d'exécution change (les étapes sont indépendantes : chacune crée son dossier
 * temporaire par mkdtemp et n'ouvre aucun port fixe).
 * Chaque étape est journalisée en bloc (pas de mélange) ; code 1 si une étape échoue,
 * avec la liste des étapes en échec. Les lignes PASS/FAIL sont conservées telles quelles.
 *
 * Usage : node scripts/test-parallel.mjs [--jobs N] [--skip motif] [--script nom] [--list]
 *   --jobs   étapes simultanées (défaut : BATT_UNIT_JOBS ou min(8, cœurs))
 *   --skip   motif (sous-chaîne) d'étapes à ne pas lancer (répétable)
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Découpe une chaîne de commandes sur « && » (aucune étape n'en contient dans une chaîne). */
export function splitSteps(script) {
  return script
    .split(/\s+&&\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function arg(argv, name, def) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
}

async function main() {
  const argv = process.argv.slice(2);
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const steps = splitSteps(pkg.scripts[arg(argv, "script", "test")]);
  const skips = argv.flatMap((a, i) => (a === "--skip" ? [argv[i + 1]] : []));
  const jobs = Number(arg(argv, "jobs", process.env.BATT_UNIT_JOBS ?? Math.min(8, os.cpus().length)));
  const todo = steps.filter((s) => !skips.some((k) => s.includes(k)));
  if (argv.includes("--list")) {
    for (const s of todo) console.log(s);
    return 0;
  }
  const t0 = Date.now();
  const failed = [];
  let next = 0;
  let pass = 0;
  let fail = 0;
  const worker = async () => {
    while (next < todo.length) {
      const step = todo[next++];
      const t = Date.now();
      const out = [];
      const code = await new Promise((resolve) => {
        const p = spawn("sh", ["-c", step], { stdio: ["ignore", "pipe", "pipe"], env: process.env });
        p.stdout.on("data", (d) => out.push(d));
        p.stderr.on("data", (d) => out.push(d));
        p.on("close", (c) => resolve(c ?? 1));
      });
      const text = Buffer.concat(out).toString("utf8");
      pass += (text.match(/^PASS\b/gm) ?? []).length;
      fail += (text.match(/^FAIL\b/gm) ?? []).length;
      console.log(`##### ${step}  [${code === 0 ? "ok" : `ECHEC code ${code}`}, ${((Date.now() - t) / 1000).toFixed(1)} s]`);
      process.stdout.write(text.endsWith("\n") || !text ? text : `${text}\n`);
      if (code !== 0) failed.push(step);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, jobs) }, worker));
  console.log(`##### ${todo.length} étapes, ${jobs} en parallèle, ${((Date.now() - t0) / 1000).toFixed(1)} s ; PASS ${pass} FAIL ${fail}`);
  if (failed.length) {
    for (const f of failed) console.log(`FAIL étape en échec : ${f}`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) process.exit(await main());
