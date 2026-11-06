#!/usr/bin/env node
/**
 * Lot 104 : sélection des suites de la batterie (mode ciblé et shards).
 *
 *   node scripts/batt-select.mjs --script scripts/test-all-local.sh --durations scripts/batt-durations.tsv
 *        [--all] [--ids "a b"] [--changed <base>] [--shards N --shard k [--capacity 1,2]] [--explain] [--regen]
 *
 * - --all             tous les ids du script (checks build auth domaine88 pdf + tableau E2E)
 * - --changed <base>  fichiers modifiés depuis <base> (git diff, plus l'arbre de travail et les fichiers non suivis)
 *                     → suites liées (scripts/batt-map.json) + socle fixe (checks state editor public67 integ33)
 * - --shards/--shard  partage glouton (plus longues d'abord, sur la file la moins chargée / sa capacité) ;
 *                     `build` va au shard 1 (chaque shard reconstruit de toute façon ce dont il a besoin)
 * - --regen           régénère scripts/batt-map.json (index des jetons, voir plus bas)
 *
 * Carte fichiers → suites (batt-map.json), trois étages :
 *   1. règles écrites à la main (`rules`) : domaines que l'index ne voit pas (sauvegardes, migrations…) ;
 *   2. index généré (`index`) : pour chaque fichier de src/, les suites dont le script (et les bibliothèques
 *      scripts/lib qu'il importe) cite un de ses jetons distinctifs (classes CSS, attributs data-*, routes) ;
 *   3. repli (`wide`) : un fichier de src/ inconnu de l'index déclenche un ensemble large de suites.
 * Les suites e2e-XXX.mjs modifiées déclenchent leurs propres suites ; un fichier de scripts/lib déclenche les suites qui l'importent.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BASE_SUITES = ["checks", "state", "editor", "public67", "integ33"];
const FIXED = ["checks", "build", "domaine88", "pdf"];

/**
 * Ids de suites : ids fixes, parties de test-auth.mjs (tableau AUTHS), puis tableau E2E du script, avec la commande (pour relier les
 * fichiers aux suites). `groups` : suite d'origine → parties (tableau PARTS_OF, lot 104b : « auth » = authA authF… ; citer la suite
 * d'origine, dans une règle de la carte ou sur la ligne de commande, sélectionne toutes ses parties).
 */
export function parseScript(text) {
  const e2e = [];
  for (const m of text.matchAll(/^\s+"([^"|]+)\|([^"|]*)\|([^"|]*)\|/gm)) e2e.push({ id: m[1], cmd: m[2].trim() });
  const auths = [...text.matchAll(/^\s+"(auth\w+)\|[^"|]*"$/gm)].map((m) => m[1]);
  const groups = new Map();
  for (const m of text.matchAll(/^\s+"(\w+): ([^"]+)"$/gm)) groups.set(m[1], m[2].trim().split(/\s+/));
  const fixed = [...FIXED, ...auths];
  return { fixed, e2e, groups, ids: [...fixed, ...e2e.map((e) => e.id)] };
}

/** Développe les suites d'origine d'une liste d'ids en leurs parties (les autres ids sont gardés). */
export function expandGroups(list, groups) {
  const out = [];
  for (const id of list) for (const p of groups?.get(id) ?? [id]) if (!out.includes(p)) out.push(p);
  return out;
}

/** Suite d'origine d'une partie (ou l'id lui-même). */
export function logicalOf(id, groups) {
  for (const [name, parts] of groups ?? []) if (parts.includes(id)) return name;
  return id;
}

/** Durées : id \t secondes \t poids. */
export function parseDurations(text) {
  const d = new Map();
  for (const line of text.split("\n")) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [id, s, w] = line.split("\t");
    d.set(id, { sec: Number(s) || 120, weight: Number(w) || 1 });
  }
  return d;
}

/** Partage glouton (LPT) pondéré par la capacité des shards. Déterministe. Renvoie les ids du shard k (1..N). */
export function shardIds(ids, durations, n, k, capacity = []) {
  if (!(n >= 1) || !(k >= 1 && k <= n)) throw new Error(`shard ${k}/${n} invalide`);
  const cap = Array.from({ length: n }, (_, i) => Number(capacity[i]) || 1);
  const load = Array(n).fill(0);
  const out = Array.from({ length: n }, () => []);
  const items = ids
    .filter((id) => id !== "build")
    .map((id) => ({ id, sec: durations.get(id)?.sec ?? 120 }))
    .sort((a, b) => b.sec - a.sec || a.id.localeCompare(b.id));
  for (const it of items) {
    let best = 0;
    for (let i = 1; i < n; i++) if ((load[i] + it.sec) / cap[i] < (load[best] + it.sec) / cap[best]) best = i;
    load[best] += it.sec;
    out[best].push(it.id);
  }
  if (ids.includes("build")) out[0].unshift("build");
  return out[k - 1];
}

const jsonRead = (f) => JSON.parse(readFileSync(f, "utf8"));

/** Suites liées à un fichier modifié. Renvoie { suites:Set, why:string } ; suites "*" = toute la batterie. */
export function suitesForFile(file, map, ctx) {
  const hit = new Set();
  let why = "";
  const add = (arr, w) => {
    for (const s of arr) hit.add(s);
    why ||= w;
  };
  // Scripts de test : leurs propres suites.
  const bySuite = ctx.scriptSuites.get(file);
  if (bySuite) add(bySuite, "script de la suite");
  if (/^scripts\/lib\//.test(file) && ctx.libUsers.get(file)) add(ctx.libUsers.get(file), "bibliothèque importée");
  if (/^scripts\/test-.*\.mjs$/.test(file)) add(["checks"], "test unitaire");
  for (const r of map.rules ?? []) {
    if (new RegExp(r.match).test(file)) add(r.suites, `règle ${r.match}`);
  }
  if (map.index?.[file]) add(map.index[file], "index des jetons");
  if (!hit.size && /^src\//.test(file)) add(map.wide ?? [], "repli (fichier inconnu de l'index)");
  return { suites: hit, why };
}

export function selectChanged(files, map, ctx, ids) {
  const groups = ctx.groups;
  const sel = new Set(expandGroups(BASE_SUITES, groups));
  const explain = [];
  for (const f of files) {
    const { suites, why } = suitesForFile(f, map, ctx);
    if (suites.has("*")) {
      ids.forEach((i) => sel.add(i));
      explain.push(`${f} → toute la batterie (${why})`);
      continue;
    }
    for (const s of expandGroups([...suites], groups)) if (ids.includes(s)) sel.add(s);
    if (suites.size) explain.push(`${f} → ${[...suites].join(" ")} (${why})`);
  }
  // Une suite e2e a besoin du build (ajouté seulement si une suite le demande, voir le script) ; `build` n'est pas un id utile ici.
  return { ids: ids.filter((i) => sel.has(i)), explain };
}

/* ---------- index généré ---------- */

const KEBAB = /[a-z][a-z0-9]*(?:-[a-z0-9]+)+/g;
const ROUTE = /\/admin\/[a-z0-9-]+/g;

function walk(dir, exts, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => p.endsWith(x))) out.push(p);
  }
  return out;
}

/** Fichiers .mjs locaux importés par un fichier (chemins relatifs à la racine du dépôt). */
function importsOf(file, text) {
  return [...text.matchAll(/from\s+"(\.{1,2}\/[^"]+\.mjs)"/g)].map((m) => path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1])));
}

/** Jetons d'un texte : classes/attributs kebab-case d'au moins 9 caractères, plus les routes /admin/xxx. */
export function tokensOf(text) {
  const t = new Set();
  for (const m of text.matchAll(KEBAB)) if (m[0].length >= 9) t.add(m[0]);
  for (const m of text.matchAll(ROUTE)) t.add(m[0]);
  return t;
}

export function buildContext(root, scriptText) {
  const { e2e, groups } = parseScript(scriptText);
  const scriptSuites = new Map(); // fichier de script → suites (d'origine : les parties sont développées à la sélection)
  const libUsers = new Map(); // fichier de lib → suites
  const suiteTokens = new Map(); // suite → jetons
  for (const { id: partId, cmd } of e2e) {
    const id = logicalOf(partId, groups);
    const m = cmd.match(/(scripts\/[\w.-]+\.mjs)/);
    if (!m) continue;
    const files = [m[1]];
    const seen = new Set();
    let text = "";
    while (files.length) {
      const f = files.pop();
      if (seen.has(f) || !existsSync(path.join(root, f))) continue;
      seen.add(f);
      const t = readFileSync(path.join(root, f), "utf8");
      text += `\n${t}`;
      files.push(...importsOf(f, t));
    }
    for (const f of seen) {
      const prev = f === m[1] ? scriptSuites : libUsers;
      if (!(prev.get(f) ?? []).includes(id)) prev.set(f, [...(prev.get(f) ?? []), id]);
    }
    suiteTokens.set(id, tokensOf(text));
  }
  // auth / domaine88 : scripts propres.
  scriptSuites.set("scripts/test-auth.mjs", ["auth"]);
  scriptSuites.set("scripts/e2e-domaine88.mjs", ["domaine88"]);
  scriptSuites.set("scripts/test-pdf.mjs", ["pdf", "checks"]);
  return { scriptSuites, libUsers, suiteTokens, e2e, groups };
}

export function regenIndex(root, scriptText, { maxSuitesPerToken = 8, maxPerFile = 24 } = {}) {
  const ctx = buildContext(root, scriptText);
  const df = new Map(); // jeton → nombre de suites
  for (const toks of ctx.suiteTokens.values()) for (const t of toks) df.set(t, (df.get(t) ?? 0) + 1);
  const index = {};
  for (const f of walk(path.join(root, "src"), [".ts", ".tsx", ".css"]).sort()) {
    const rel = path.relative(root, f);
    const toks = tokensOf(readFileSync(f, "utf8"));
    const score = new Map();
    for (const [id, st] of ctx.suiteTokens) {
      let n = 0;
      for (const t of toks) if (st.has(t) && df.get(t) <= maxSuitesPerToken) n++;
      if (n) score.set(id, n);
    }
    const best = [...score].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, maxPerFile).map((x) => x[0]);
    if (best.length) index[rel] = best.sort();
  }
  return index;
}

/* ---------- git ---------- */

export function changedFiles(base, cwd) {
  const run = (args) => execFileSync("git", args, { cwd, encoding: "utf8" }).split("\n").filter(Boolean);
  const set = new Set([...run(["diff", "--name-only", base]), ...run(["ls-files", "-o", "--exclude-standard"])]);
  return [...set].sort();
}

/* ---------- CLI ---------- */

function arg(argv, name, def) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
}

async function main() {
  const argv = process.argv.slice(2);
  const root = process.cwd();
  const script = arg(argv, "script", "scripts/test-all-local.sh");
  const scriptText = readFileSync(script, "utf8");
  const parsed = parseScript(scriptText);
  const durFile = arg(argv, "durations", "scripts/batt-durations.tsv");
  const durations = existsSync(durFile) ? parseDurations(readFileSync(durFile, "utf8")) : new Map();
  const mapFile = arg(argv, "map", "scripts/batt-map.json");
  if (argv.includes("--regen")) {
    const map = existsSync(mapFile) ? jsonRead(mapFile) : { base: BASE_SUITES, rules: [], wide: [] };
    map.base = BASE_SUITES;
    map.index = regenIndex(root, scriptText);
    writeFileSync(mapFile, `${JSON.stringify(map, null, 1)}\n`);
    console.log(`${mapFile} : ${Object.keys(map.index).length} fichiers indexés`);
    return;
  }
  let ids = arg(argv, "ids", "").split(/\s+/).filter(Boolean);
  const explicit = ids.length > 0;
  const bad = ids.filter((i) => !parsed.ids.includes(i) && !parsed.groups.has(i));
  if (bad.length) throw new Error(`suite inconnue : ${bad.join(" ")}`);
  ids = expandGroups(ids, parsed.groups);
  const changed = arg(argv, "changed", "");
  let explain = [];
  if (changed) {
    const map = jsonRead(mapFile);
    const ctx = buildContext(root, scriptText);
    const files = changedFiles(changed, root);
    const r = selectChanged(files, map, ctx, parsed.ids.filter((i) => i !== "build"));
    explain = r.explain;
    ids = [...new Set([...r.ids, ...ids])];
  } else if (!explicit) ids = parsed.ids.slice();
  // Ordre de la liste d'origine.
  ids = parsed.ids.filter((i) => ids.includes(i));
  if (argv.includes("--shards") || argv.includes("--shard")) {
    ids = shardIds(ids, durations, Number(arg(argv, "shards", 1)), Number(arg(argv, "shard", 1)), arg(argv, "capacity", "").split(",").filter(Boolean));
  }
  if (argv.includes("--explain")) for (const l of explain) console.error(l);
  console.log(ids.join(" "));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(2);
  });
}
