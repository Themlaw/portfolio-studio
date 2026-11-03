#!/usr/bin/env node
/**
 * Plan de la batterie e2e pour GitHub Actions (lot 103) : lit la liste des suites dans
 * scripts/test-all-local.sh (source unique, la même que la batterie locale), les répartit
 * en shards équilibrés par durée estimée (.github/ci-weights.json, .github/ci-shards.json)
 * et écrit des sorties au format $GITHUB_OUTPUT :
 *   shards=<JSON [{name, ids, firefox, est}]>   un élément de matrice par shard
 *   count=<n>
 * Variable d'environnement SUITES (espaces ou virgules) : lance seulement ces suites,
 * dans un shard unique « manuel » (workflow_dispatch). Identifiant inconnu : échec.
 * Usage : node .github/scripts/ci-plan.mjs [--print]
 */
import { appendFileSync, readFileSync } from "node:fs";

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

const want = (process.env.SUITES ?? "").split(/[\s,]+/).filter(Boolean);
let shards;
if (want.length) {
  const unknown = want.filter((id) => !known.includes(id));
  if (unknown.length) {
    console.error(`suite inconnue : ${unknown.join(", ")}\nsuites possibles : ${known.join(" ")}`);
    process.exit(1);
  }
  shards = [{ name: "manuel", ids: want, firefox: want.some((id) => cfg.firefoxIds.includes(id)) }];
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
  for (const s of shards) s.firefox = s.ids.some((id) => cfg.firefoxIds.includes(id));
}
for (const s of shards) s.est = s.ids.reduce((t, id) => t + w(id), 0);
const out = shards.map((s) => ({ name: s.name, ids: s.ids.join(" "), firefox: s.firefox, est: s.est }));
if (process.argv.includes("--print") || !process.env.GITHUB_OUTPUT) {
  for (const s of out) console.log(`${s.name.padEnd(12)} ~${String(Math.round(s.est / 60)).padStart(3)} min  ${s.firefox ? "[firefox] " : ""}${s.ids}`);
  console.log(`${out.length} shards, ${known.length} suites connues`);
}
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `shards=${JSON.stringify(out)}\ncount=${out.length}\n`);
