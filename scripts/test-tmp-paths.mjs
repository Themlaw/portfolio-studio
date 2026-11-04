#!/usr/bin/env node
/**
 * Garde-fous des dossiers temporaires des tests (S5, npm test) :
 *  1. `.github/scripts/e2e.sh` efface DATA_DIR : il REFUSE (code 2, rien d'effacé) un DATA_DIR ou un SHOTS hérité qui n'est
 *     pas strictement sous RUNNER_TEMP (autre dossier, « .. » qui ressort, lien symbolique qui sort, RUNNER_TEMP lui-même) ;
 *     sous RUNNER_TEMP, il l'efface et le recrée comme avant, en 0700 (umask 077).
 *  2. Les scripts de test ne visent plus de chemin /tmp fixe et prévisible (test-auth, e2e-domaine88, e2e-v013) : dossier
 *     créé par mkdtemp (nom imprévisible, 0700) quand aucune variable ne le fixe.
 * Usage : node scripts/test-tmp-paths.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
let failures = 0;
const ok = (label, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${!pass && detail ? " — " + detail : ""}`);
  if (!pass) failures++;
};

const base = mkdtempSync(path.join(tmpdir(), "pf-test-tmp-paths-"));
try {
  const runner = path.join(base, "runner");
  mkdirSync(runner);
  // Dossier « précieux » hors de RUNNER_TEMP (la base de dev, par exemple) : ne doit jamais être effacé.
  const precious = path.join(base, "data-de-dev");
  mkdirSync(precious);
  writeFileSync(path.join(precious, "portfolio.db"), "base de dev");
  const out = path.join(base, "dehors");
  mkdirSync(out);
  symlinkSync(out, path.join(runner, "lien-dehors"), "dir");

  // STANDALONE_DIR absent + BATT_SERVER=start : le script s'arrête juste après la préparation des dossiers (aucun serveur lancé).
  const run = (env) =>
    // cwd = dossier de test : un DATA_DIR relatif y est résolu (jamais dans le dépôt, même si le script régressait).
    spawnSync("bash", [path.join(ROOT, ".github/scripts/e2e.sh"), "garde", "true"], {
      cwd: base,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, RUNNER_TEMP: runner, BATT_SERVER: "start", STANDALONE_DIR: path.join(base, "pas-de-standalone"), ...env },
      encoding: "utf8",
    });

  const refused = [
    ["DATA_DIR hors de RUNNER_TEMP (base de dev)", { DATA_DIR: precious }],
    ["DATA_DIR relatif (./data-de-dev, comme DATA_DIR=./data)", { DATA_DIR: "./data-de-dev" }],
    ["DATA_DIR qui ressort par « .. »", { DATA_DIR: path.join(runner, "..", "data-de-dev") }],
    ["DATA_DIR = RUNNER_TEMP lui-même", { DATA_DIR: runner }],
    ["DATA_DIR sous un lien qui sort de RUNNER_TEMP", { DATA_DIR: path.join(runner, "lien-dehors", "x") }],
    ["SHOTS hors de RUNNER_TEMP", { SHOTS: path.join(base, "captures") }],
  ];
  for (const [label, env] of refused) {
    const r = run(env);
    ok(`e2e.sh refuse ${label} (code 2, rien d'effacé)`, r.status === 2 && /n'est pas sous/.test(r.stderr) && readFileSync(path.join(precious, "portfolio.db"), "utf8") === "base de dev" && !existsSync(path.join(base, "captures")), `code ${r.status} ${r.stderr.slice(0, 200)}`);
  }

  // Cas normal : DATA_DIR sous RUNNER_TEMP (test-all-local.sh), ou par défaut ($RUNNER_TEMP/data-<id>) : effacé puis recréé.
  const inside = path.join(runner, "base-x");
  mkdirSync(inside);
  writeFileSync(path.join(inside, "ancienne.db"), "à effacer");
  const r1 = run({ DATA_DIR: inside });
  ok("e2e.sh accepte un DATA_DIR sous RUNNER_TEMP : effacé et recréé vide, en 0700", r1.status !== 2 && existsSync(inside) && !existsSync(path.join(inside, "ancienne.db")) && (statSync(inside).mode & 0o777) === 0o700, `code ${r1.status} ${r1.stderr.slice(0, 200)}`);
  const r2 = run({});
  ok("e2e.sh : DATA_DIR par défaut ($RUNNER_TEMP/data-<id>) accepté", r2.status !== 2 && existsSync(path.join(runner, "data-garde")), `code ${r2.status} ${r2.stderr.slice(0, 200)}`);

  // 2. Aucun chemin /tmp fixe dans les scripts de test visés (hors contrôle « /tmp/pwn.txt » de TH6, qui vérifie l'ABSENCE d'un fichier).
  for (const f of ["scripts/test-auth.mjs", "scripts/e2e-domaine88.mjs", "scripts/e2e-v013.mjs"]) {
    const src = readFileSync(path.join(ROOT, f), "utf8");
    const fixed = [...src.matchAll(/["'`]\/tmp\/[^"'`]*["'`]/g)].map((m) => m[0]).filter((m) => m !== '"/tmp/pwn.txt"');
    ok(`${f} : aucun chemin /tmp fixe (mkdtemp)`, fixed.length === 0 && /mkdtempSync\(/.test(src), fixed.join(", "));
  }
  const e2e = readFileSync(path.join(ROOT, ".github/scripts/e2e.sh"), "utf8");
  ok("e2e.sh : umask 077 et pot de cookies par mktemp -d", /^umask 077$/m.test(e2e) && /JAR_DIR=\$\(mktemp -d /.test(e2e) && !/JAR="\$ROOT_TMP\/jar-/.test(e2e));
} finally {
  rmSync(base, { recursive: true, force: true });
}

if (failures) {
  console.error(`test-tmp-paths : ${failures} échec(s)`);
  process.exit(1);
}
console.log("test-tmp-paths : OK");
