#!/usr/bin/env node
/**
 * Lot 104 : met à jour scripts/batt-durations.tsv (id, secondes, poids) à partir d'une ou plusieurs
 * batteries terminées ($BATTERY_DIR/.res/*). Durée = médiane des passages VERTS ; une suite jamais verte
 * garde sa durée précédente. Les poids existants sont conservés (2 = suite lourde : elle occupe 2 créneaux).
 * Usage : node scripts/batt-durations.mjs <dossier de batterie>… [--out scripts/batt-durations.tsv] [--sleep]
 *   --sleep  affiche aussi, par suite, la part d'attente fixe mesurée (BATT_SLEEP_PROBE=1)
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const out = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : "scripts/batt-durations.tsv";
const dirs = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--out");
const prev = new Map();
if (existsSync(out)) {
  for (const l of readFileSync(out, "utf8").split("\n")) {
    if (!l.trim() || l.startsWith("#")) continue;
    const [id, s, w] = l.split("\t");
    prev.set(id, { sec: Number(s), weight: Number(w) || 1 });
  }
}
const runs = new Map(); // id → [secondes des passages verts]
const sleeps = new Map();
for (const d of dirs) {
  const res = path.join(d, ".res");
  if (!existsSync(res)) continue;
  for (const id of readdirSync(res)) {
    const [, verdict, , , sec, sl] = readFileSync(path.join(res, id), "utf8").trim().split("\t");
    if (verdict === "PASS") {
      runs.set(id, [...(runs.get(id) ?? []), Number(sec)]);
      sleeps.set(id, [...(sleeps.get(id) ?? []), Number(sl) || 0]);
    }
  }
}
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const ids = new Set([...prev.keys(), ...runs.keys()]);
const rows = [...ids].map((id) => ({
  id,
  sec: runs.has(id) ? median(runs.get(id)) : prev.get(id).sec,
  weight: prev.get(id)?.weight ?? 1,
  sleep: sleeps.has(id) ? median(sleeps.get(id)) : null,
}));
rows.sort((a, b) => b.sec - a.sec || a.id.localeCompare(b.id));
writeFileSync(out, `${rows.map((r) => `${r.id}\t${r.sec}\t${r.weight}`).join("\n")}\n`);
console.log(`${out} : ${rows.length} suites, total ${rows.reduce((t, r) => t + r.sec, 0)} s`);
if (argv.includes("--sleep")) for (const r of rows) console.log(`${r.id.padEnd(18)} ${String(r.sec).padStart(6)} s  attente ${r.sleep ?? "?"} s`);
