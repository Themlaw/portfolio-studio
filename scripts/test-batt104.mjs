#!/usr/bin/env node
/**
 * Lot 104 : tests unitaires de l'outillage de la batterie.
 *  A  allocateur de ports : blocs disjoints, plage épuisée, port occupé par un tiers évité (jamais tué),
 *     verrou d'un pid mort repris, libération, accès concurrents sans doublon.
 *  S  sélection : ids du script, partage en shards (couverture exacte, pas de doublon, équilibre, capacités,
 *     déterminisme), mode ciblé (socle, script de suite, bibliothèque, règle, repli, tout).
 *  P  découpe de `npm test` en étapes (test-parallel).
 *  D  durées : toutes les suites du script ont une durée et un poids.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { alloc, list, portFree, release } from "./lib/port-alloc.mjs";
import { BASE_SUITES, buildContext, parseDurations, parseScript, selectChanged, shardIds, suitesForFile, tokensOf } from "./batt-select.mjs";
import { splitSteps } from "./test-parallel.mjs";

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};

const ROOT = new URL("..", import.meta.url).pathname;
const tmp = mkdtempSync(path.join(os.tmpdir(), "pf-test-batt104-"));
// Hors de la plage éphémère du noyau (32768-60999) : un port sortant en cours d usage ferait sauter un bloc.
let BASE_PORT = 20000 + Math.floor(Math.random() * 9000);
// Plage de test entièrement libre (sinon le test mesurerait la machine, pas l allocateur).
for (let t = 0; t < 20; t++) {
  let libre = true;
  for (let p = BASE_PORT; p < BASE_PORT + 520 && libre; p++) libre = await portFree(p);
  if (libre) break;
  BASE_PORT = 20000 + Math.floor(Math.random() * 9000);
}

/* ---- A. allocateur ---- */
{
  const dir = path.join(tmp, "ports");
  const a = await alloc({ min: BASE_PORT, max: BASE_PORT + 31, size: 8, dir });
  const b = await alloc({ min: BASE_PORT, max: BASE_PORT + 31, size: 8, dir });
  ok("A1 deux blocs demandés → deux blocs disjoints de 8 ports", a && b && a.port !== b.port && Math.abs(a.port - b.port) >= 8, `${a?.port} ${b?.port}`);
  const c = await alloc({ min: BASE_PORT, max: BASE_PORT + 31, size: 8, dir });
  const d = await alloc({ min: BASE_PORT, max: BASE_PORT + 31, size: 8, dir });
  const e = await alloc({ min: BASE_PORT, max: BASE_PORT + 31, size: 8, dir });
  ok("A2 plage épuisée (4 blocs de 8 dans 32 ports) → null au 5e", c && d && e === null);
  b.release();
  const f = await alloc({ min: BASE_PORT, max: BASE_PORT + 31, size: 8, dir });
  ok("A3 un bloc libéré est redonné", f && f.port === b.port, `${f?.port} vs ${b?.port}`);
  ok("A4 list : 32 verrous vivants", list(dir).length === 32 && list(dir).every((l) => l.alive));
  for (const x of [a, c, d, f]) x?.release();
  ok("A5 tout libéré → aucun verrou", list(dir).length === 0);

  // Un tiers écoute sur un port du premier bloc : le bloc est sauté, le tiers n'est pas touché.
  const dir2 = path.join(tmp, "ports2");
  const squatter = net.createServer();
  await new Promise((r) => squatter.listen(BASE_PORT + 3, "127.0.0.1", r));
  const g = await alloc({ min: BASE_PORT, max: BASE_PORT + 15, size: 8, dir: dir2 });
  ok("A6 port occupé par un tiers → bloc suivant", g && g.port === BASE_PORT + 8, String(g?.port));
  ok("A7 le tiers écoute toujours", squatter.listening && !(await portFree(BASE_PORT + 3)));
  ok("A8 le bloc sauté n'est pas verrouillé", list(dir2).every((l) => l.port >= BASE_PORT + 8));
  g.release();
  squatter.close();

  // Verrou d'un pid mort (processus terminé) : repris.
  const dir3 = path.join(tmp, "ports3");
  const dead = spawn(process.execPath, ["-e", "0"]);
  await new Promise((r) => dead.on("close", r));
  const h = await alloc({ min: BASE_PORT + 100, max: BASE_PORT + 107, size: 8, dir: dir3, owner: dead.pid });
  ok("A9 bloc pris au nom d'un pid", h && list(dir3).every((l) => l.pid === dead.pid));
  const i = await alloc({ min: BASE_PORT + 100, max: BASE_PORT + 107, size: 8, dir: dir3 });
  ok("A10 verrou d'un pid mort → bloc repris par un vivant", i && i.port === BASE_PORT + 100 && list(dir3).every((l) => l.pid === process.pid && l.alive));
  i.release();

  // Accès concurrents : 12 processus, aucun doublon de port.
  const dir4 = path.join(tmp, "ports4");
  const cli = path.join(ROOT, "scripts/lib/port-alloc.mjs");
  const runCli = () =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, [cli, "alloc", "--min", String(BASE_PORT + 200), "--max", String(BASE_PORT + 200 + 8 * 12 - 1), "--size", "8", "--dir", dir4, "--owner", String(process.pid)]);
      let out = "";
      p.stdout.on("data", (x) => (out += x));
      p.on("close", (code) => resolve({ code, port: Number(out.trim()) }));
    });
  const res = await Promise.all(Array.from({ length: 12 }, runCli));
  const ports = res.map((r) => r.port);
  ok("A11 12 allocations simultanées (CLI) → 12 blocs distincts, tous réussis", res.every((r) => r.code === 0) && new Set(ports).size === 12, ports.join(","));
  const extra = await runCli();
  ok("A12 13e allocation → code 1 (plage épuisée)", extra.code === 1);
  for (const p of ports) release(p, 8, dir4);
  ok("A13 CLI release → plus de verrou", list(dir4).length === 0);

  // Sur-souscription : 60 processus simultanés pour 12 blocs → exactement 12 réussites, tous distincts (régression : un verrou
  // lu vide pendant sa création était jugé mort et volé, deux jobs recevaient le même bloc).
  const dir5 = path.join(tmp, "ports5");
  const runCli5 = () =>
    new Promise((resolve) => {
      const p = spawn(process.execPath, [cli, "alloc", "--min", String(BASE_PORT + 400), "--max", String(BASE_PORT + 400 + 8 * 12 - 1), "--size", "8", "--dir", dir5, "--owner", String(process.pid)]);
      let out = "";
      p.stdout.on("data", (x) => (out += x));
      p.on("close", (code) => resolve({ code, port: Number(out.trim()) }));
    });
  const res5 = await Promise.all(Array.from({ length: 60 }, runCli5));
  const won = res5.filter((r) => r.code === 0).map((r) => r.port);
  ok("A14 60 allocations simultanées pour 12 blocs → exactement 12 blocs distincts", won.length === 12 && new Set(won).size === 12, `${won.length} réussites, ${new Set(won).size} distincts [${BASE_PORT}] ${won.sort().join(",")}`);
}

/* ---- S. sélection ---- */
const scriptText = readFileSync(path.join(ROOT, "scripts/test-all-local.sh"), "utf8");
const parsed = parseScript(scriptText);
const durText = readFileSync(path.join(ROOT, "scripts/batt-durations.tsv"), "utf8");
const durations = parseDurations(durText);
{
  ok("S1 le script déclare des suites e2e et les ids fixes", parsed.e2e.length >= 90 && ["checks", "build", "auth", "domaine88", "pdf"].every((i) => parsed.ids.includes(i)), String(parsed.e2e.length));
  ok("S2 aucun id en double", new Set(parsed.ids).size === parsed.ids.length);
  const missing = parsed.ids.filter((i) => !durations.has(i));
  ok("D1 chaque suite du script a une durée et un poids dans batt-durations.tsv", missing.length === 0, missing.join(" "));
  const unknown = [...durations.keys()].filter((i) => !parsed.ids.includes(i));
  ok("D2 aucune ligne de durée pour une suite qui n'existe plus", unknown.length === 0, unknown.join(" "));
  ok("D3 poids valides (1 ou 2)", [...durations.values()].every((v) => v.weight === 1 || v.weight === 2));

  for (const n of [2, 3, 4, 7]) {
    const shards = Array.from({ length: n }, (_, k) => shardIds(parsed.ids, durations, n, k + 1));
    const flat = shards.flat();
    ok(`S3 ${n} shards : chaque suite exactement une fois`, flat.length === parsed.ids.length && new Set(flat).size === parsed.ids.length && parsed.ids.every((i) => flat.includes(i)));
    const loads = shards.map((s) => s.filter((i) => i !== "build").reduce((t, i) => t + (durations.get(i)?.sec ?? 120), 0));
    const biggest = Math.max(...parsed.ids.map((i) => durations.get(i)?.sec ?? 120));
    ok(`S4 ${n} shards : écart de charge ≤ la plus longue suite`, Math.max(...loads) - Math.min(...loads) <= biggest, loads.join("/"));
    ok(`S5 ${n} shards : build seulement dans le shard 1`, shards[0].includes("build") && shards.slice(1).every((s) => !s.includes("build")));
  }
  const again = shardIds(parsed.ids, durations, 3, 2);
  ok("S6 partage déterministe", JSON.stringify(again) === JSON.stringify(shardIds(parsed.ids, durations, 3, 2)));
  const capShards = [1, 2].map((k) => shardIds(parsed.ids, durations, 2, k, ["1", "3"]));
  const cl = capShards.map((s) => s.reduce((t, i) => t + (durations.get(i)?.sec ?? 120), 0));
  ok("S7 capacités 1:3 → le 2e shard porte environ 3 fois plus", cl[1] > 2 * cl[0], cl.join("/"));
  let threw = false;
  try {
    shardIds(parsed.ids, durations, 3, 4);
  } catch {
    threw = true;
  }
  ok("S8 shard hors bornes refusé", threw);

  // Mode ciblé.
  const ctx = buildContext(ROOT, scriptText);
  const map = JSON.parse(readFileSync(path.join(ROOT, "scripts/batt-map.json"), "utf8"));
  const ids = parsed.ids.filter((i) => i !== "build");
  const sel = (files) => selectChanged(files, map, ctx, ids).ids;
  const none = sel([]);
  ok("T1 aucun fichier modifié → le socle fixe seul", JSON.stringify(none) === JSON.stringify(ids.filter((i) => BASE_SUITES.includes(i))) && BASE_SUITES.every((i) => none.includes(i)), none.join(" "));
  const own = sel(["scripts/e2e-planche31.mjs"]);
  ok("T2 un script de suite modifié → cette suite + le socle", own.includes("planche31") && BASE_SUITES.every((i) => own.includes(i)) && own.length === BASE_SUITES.length + 1, own.join(" "));
  const shared = sel(["scripts/e2e-medias.mjs"]);
  ok("T3 un script partagé (medias / medias-firefox) → les deux suites", shared.includes("medias") && shared.includes("medias-firefox"));
  const lib = sel(["scripts/lib/defil99.mjs"]);
  ok("T4 une bibliothèque de tests → les suites qui l'importent", lib.includes("defilement99") && lib.length > BASE_SUITES.length, lib.join(" "));
  const b85 = sel(["src/lib/backup/manifest.ts"]);
  ok("T5 un fichier du domaine sauvegarde → backup85 (règle)", b85.includes("backup85") || b85.includes("backup50"), b85.join(" "));
  const unk = suitesForFile("src/lib/zzz-inconnu.ts", map, ctx);
  ok("T6 un fichier src/ inconnu → le repli large", unk.suites.size >= 5 && unk.why.startsWith("repli"), unk.why);
  const doc = sel(["docs/notes.md", "README.md"]);
  ok("T7 documentation seule → le socle seul", doc.length === BASE_SUITES.length, doc.join(" "));
  const mig = sel(["drizzle/0030_x.sql"]);
  ok("T8 une migration → toute la batterie", mig.length === ids.length, `${mig.length}/${ids.length}`);
  const idx = Object.keys(map.index ?? {});
  ok("T9 l'index généré couvre au moins 150 fichiers de src/", idx.length >= 150, String(idx.length));
  const bl = sel(["src/components/BoardLayer.tsx"]);
  ok("T10 BoardLayer.tsx → planche31 et boards (index des jetons)", bl.includes("planche31") && bl.includes("boards"), bl.join(" "));
  ok("T11 jetons : classes kebab-case et routes, pas les mots courts", tokensOf('a "pe-slot-tools" x-y /admin/medias ab-cd').size === 2);
  for (const s of map.base ?? []) ok(`T12 socle ${s} existe`, parsed.ids.includes(s));
  ok("T13 le socle du script = le socle de la carte", JSON.stringify([...BASE_SUITES].sort()) === JSON.stringify([...(map.base ?? [])].sort()));
}

/* ---- P. npm test en parallèle ---- */
{
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const steps = splitSteps(pkg.scripts.test);
  ok("P1 `npm test` découpé en étapes", steps.length >= 60 && steps.every((s) => !s.includes("&&")), String(steps.length));
  ok("P2 la jonction des étapes redonne exactement le script", steps.join(" && ") === pkg.scripts.test.replace(/\s+/g, " ").trim() || steps.join(" && ") === pkg.scripts.test);
}

rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `\n${failures} échec(s)` : "\ntout est bon");
process.exit(failures ? 1 : 0);
