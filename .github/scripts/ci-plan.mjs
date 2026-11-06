#!/usr/bin/env node
/**
 * Plan de la batterie e2e pour GitHub Actions (lot 103) : lit la liste des suites dans
 * scripts/test-all-local.sh (source unique, la même que la batterie locale), les répartit
 * en shards équilibrés par durée estimée (.github/ci-weights.json, .github/ci-shards.json)
 * et écrit des sorties au format $GITHUB_OUTPUT :
 *   shards=<JSON [{name, ids, firefox, est}]>   un élément de matrice par shard
 *   count=<n>
 *
 * Découpage : si scripts/test-all-local.sh sait répartir les suites (`--shards N --shard k`, lot 104), c'est
 * LUI qui décide (même mécanisme que la batterie multi-machines), avec les durées de ci-weights.json passées
 * par BATT_DURATIONS ; `build` et `checks` en sont retirés (jobs dédiés du workflow). Sinon (script sans
 * --shards), repli : glouton local sur ci-weights.json et ci-shards.json (suites isolées, navigateurs).
 * CI_PLAN_LEGACY=1 force le repli.
 *
 * Variable d'environnement SUITES (espaces ou virgules) : lance seulement ces suites,
 * dans un shard unique « manuel » (workflow_dispatch). Identifiant inconnu : échec.
 * Usage : node .github/scripts/ci-plan.mjs [--print]
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const root = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const cfg = JSON.parse(read(".github/ci-shards.json"));
const weights = JSON.parse(read(".github/ci-weights.json"));

// Suites e2e : lignes « "id|commande|navigateur|..." » du tableau E2E, plus les suites à serveurs propres.
const script = read("scripts/test-all-local.sh");
const e2e = [...script.matchAll(/^\s*"([A-Za-z0-9-]+)\|[^"]*"\s*$/gm)].map((m) => m[1]);
const known = ["auth", "domaine88", "pdf", ...e2e];
if (new Set(known).size !== known.length) throw new Error("identifiant de suite en double dans scripts/test-all-local.sh");
const w = (id) => weights[id] ?? cfg.defaultWeight;
// Navigateur de chaque suite (3e champ du tableau E2E) : firefox n'est installé que dans les shards qui en ont besoin.
const firefoxSuites = new Set([...cfg.firefoxIds, ...[...script.matchAll(/^\s*"([A-Za-z0-9-]+)\|[^|"]*\|firefox\|/gm)].map((m) => m[1])]);
const supportsShards = /--shards\b/.test(script) && !process.env.CI_PLAN_LEGACY;

const want = (process.env.SUITES ?? "").split(/[\s,]+/).filter(Boolean);
let shards;
if (want.length) {
  const unknown = want.filter((id) => !known.includes(id));
  if (unknown.length) {
    console.error(`suite inconnue : ${unknown.join(", ")}\nsuites possibles : ${known.join(" ")}`);
    process.exit(1);
  }
  shards = [{ name: "manuel", ids: want, firefox: want.some((id) => firefoxSuites.has(id)) }];
} else if (supportsShards) {
  // Durées de CI (secondes) au format de scripts/batt-durations.tsv : id, secondes, poids.
  const dir = mkdtempSync(path.join(tmpdir(), "ci-plan-"));
  const tsv = path.join(dir, "durations.tsv");
  writeFileSync(tsv, `${["checks", "build", ...known].map((id) => `${id}\t${w(id)}\t1`).join("\n")}\n`);
  const n = cfg.shards;
  shards = [];
  const seen = new Set();
  for (let k = 1; k <= n; k++) {
    const out = execFileSync("bash", ["scripts/test-all-local.sh", "--shards", String(n), "--shard", String(k), "--list"], {
      cwd: new URL(".", root),
      env: { ...process.env, BATT_DURATIONS: tsv },
      encoding: "utf8",
    });
    const ids = out.trim().split("\n").pop().trim().split(/\s+/).filter((id) => id && id !== "build" && id !== "checks");
    ids.forEach((id) => seen.add(id));
    if (ids.length) shards.push({ name: `s${String(k).padStart(2, "0")}`, ids, firefox: ids.some((id) => firefoxSuites.has(id)) });
  }
  const missing = known.filter((id) => !seen.has(id));
  if (missing.length) throw new Error(`suites absentes du découpage --shards : ${missing.join(" ")}`);
} else {
  const fixed = [cfg.isolated, cfg.browsers].map((s) => ({ name: s.name, ids: s.ids.filter((id) => known.includes(id)) }));
  const taken = new Set(fixed.flatMap((s) => s.ids));
  const rest = known.filter((id) => !taken.has(id)).sort((a, b) => w(b) - w(a));
  const n = Math.max(1, cfg.shards - fixed.length);
  const bins = Array.from({ length: n }, (_, i) => ({ name: `s${String(i + 1).padStart(2, "0")}`, ids: [], load: 0 }));
  for (const id of rest) {
    const bin = bins.reduce((a, b) => (b.load < a.load ? b : a));
    bin.ids.push(id);
    bin.load += w(id);
  }
  shards = [...fixed, ...bins.filter((b) => b.ids.length)];
  for (const s of shards) s.firefox = s.ids.some((id) => firefoxSuites.has(id));
}
for (const s of shards) s.est = s.ids.reduce((t, id) => t + w(id), 0);
const out = shards.map((s) => ({ name: s.name, ids: s.ids.join(" "), firefox: s.firefox, est: s.est }));
if (process.argv.includes("--print") || !process.env.GITHUB_OUTPUT) {
  for (const s of out) console.log(`${s.name.padEnd(12)} ~${String(Math.round(s.est / 60)).padStart(3)} min  ${s.firefox ? "[firefox] " : ""}${s.ids}`);
  console.log(`${out.length} shards, ${known.length} suites connues`);
}
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `shards=${JSON.stringify(out)}\ncount=${out.length}\n`);
