#!/usr/bin/env node
/**
 * Sécurité v1.0, domaine C : chaîne d'approvisionnement et CI (PR #50 .dockerignore / cache BuildKit, #49 e2e.sh, #48 .npmrc ignore-scripts,
 * #47 dépendances, #19 permissions et SHA des actions). Démonstrations LOCALES : aucune image docker, aucun push, aucun réseau.
 * Chaque test est une ATTAQUE : PASS = attaque bloquée. À lancer dans le dépôt éprouvé (ou BATT_SECUC_REPO=<arbre extrait par git archive> pour
 * éprouver une révision sans la sortir : v0.34.0 seul = les sections échouent, avec le correctif = elles passent).
 *  K  (#50) contexte docker : ce qui y entrerait (émulation du .dockerignore) et mode du cache BuildKit
 *  E  (#49) e2e.sh : DATA_DIR hors de RUNNER_TEMP effacé ? (dossier jetable) ; chemins /tmp fixes
 *  N  (#48) paquet local synthétique avec postinstall : exécuté par `npm install` ?
 *  V  (#47) versions des dépendances vulnérables (lock, build) et accessibilité des failles de next
 *  W  (#19) workflows : déclencheurs, permissions, épinglage par SHA, secrets, persist-credentials
 * Usage : [BATT_SECUC_REPO=<arbre git archive d'une révision>] [ONLY=K,E,N,V,W] node scripts/secuC-chaine.mjs
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { excludedBy, parseDockerignore } from "./lib/dockerignore.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const OVERRIDE = process.env.BATT_SECUC_REPO ?? "";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
let failures = 0;
const ok = (label, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!pass) failures++;
};
const info = (m) => console.log(`INFO  ${m}`);

/** Dépôt éprouvé : l'arbre de travail, ou une révision sortie dans un dossier jetable (git archive, sans toucher au dépôt). */
const work = mkdtempSync(path.join(tmpdir(), "secuC-chaine-"));
let REPO = OVERRIDE || ROOT;
const rd = (f) => (existsSync(path.join(REPO, f)) ? readFileSync(path.join(REPO, f), "utf8") : null);
const walk = (dir, base = dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "node_modules" || e.name === ".git" ? [] : walk(path.join(dir, e.name), base)) : [path.relative(base, path.join(dir, e.name))]));

/* ------------------------------------------------------------ K : #50 -- */
if (run("K")) {
  // Émulation du .dockerignore sans dépendance (scripts/lib/dockerignore.mjs, la même que `npm test`) ; @balena/dockerignore reste utilisé
  // si BATT_SECUC_TOOLS le fournit (comparaison indépendante).
  let ig;
  const tools = process.env.BATT_SECUC_TOOLS;
  if (tools) {
    const ignoreLib = createRequire(path.join(tools, "x.js"))("@balena/dockerignore");
    ig = ignoreLib().add((rd(".dockerignore") ?? "").split("\n"));
  } else {
    const rules = parseDockerignore(rd(".dockerignore") ?? "");
    ig = { ignores: (f) => excludedBy(rules, f) !== null };
  }
  const files = walk(REPO);
  // Fichiers piégés (synthétiques) posés dans une COPIE du dépôt : ce qu'un poste de dev ou une VM peut contenir sans que git le suive.
  const planted = [".npmrc", "zz.key", "deploy.p12", "zz.db", "zz.db-wal", "data-de-test.sqlite3", ".local/zz/secret", ".local/worktrees/tmp/portfolio.db", "src/zz/id_ed25519", "src/zz/id_rsa.pub", "scripts/zz/cert.pem", "docs/SECURITE.md", "docs/rapport-audit.md"];
  const has = (f) => !ig.ignores(f);
  const before = files.filter(has).length;
  const entering = planted.filter(has);
  info(`contexte docker (émulation du .dockerignore) : ${files.length} fichiers dans l'arbre, ${before} entrent dans le contexte ; fichiers piégés qui entrent : ${entering.join(", ") || "aucun"}`);
  ok("K1 aucun fichier piégé (docs, .npmrc, clés, bases SQLite, .local) n'entre dans le contexte docker", entering.length === 0, entering.join(", "));
  const extra = ["id_ed25519", "deploy.key", "private.pem", "x/y/.npmrc"].filter(has);
  ok("K1b contournement : mêmes motifs à la racine et dans un sous-dossier (« **/ » vise aussi la racine)", extra.length === 0, extra.join(", "));
  const wf = rd(".github/workflows/docker.yml") ?? "";
  const cacheTo = [...wf.matchAll(/cache-to:\s*(\S+)/g)].map((m) => m[1]);
  ok("K2 le cache BuildKit exporté par la CI est en mode=min (jamais la couche « COPY . . »)", cacheTo.length > 0 && cacheTo.every((c) => /(^|,)mode=min(,|$)/.test(c)), `cache-to : ${cacheTo.join(" ") || "(aucun)"}`);
  const more = [".netrc", ".aws/credentials", "release.jks", "server.crt", "secrets.json", "service-account.json", ".ssh/config", "credentials.json"].filter(has);
  info(`autres noms de secrets qui entreraient encore dans le contexte (hors liste de la PR) : ${more.join(", ") || "aucun"}`);
}

/* ------------------------------------------------------------ E : #49 -- */
if (run("E")) {
  const script = path.join(REPO, ".github/scripts/e2e.sh");
  const base = mkdtempSync(path.join(tmpdir(), "secuC-e2e-"));
  const runner = path.join(base, "runner");
  mkdirSync(runner);
  const outside = path.join(base, "dehors");
  mkdirSync(outside);
  symlinkSync(outside, path.join(runner, "lien"), "dir");
  const precious = (n) => {
    const d = path.join(base, n);
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, "portfolio.db"), "base de dev");
    return d;
  };
  const alive = (d) => existsSync(path.join(d, "portfolio.db"));
  // STANDALONE_DIR absent + BATT_SERVER=start : le script s'arrête juste après la préparation des dossiers (aucun serveur lancé).
  const e2e = (env, cwd = base) =>
    spawnSync("bash", [script, "garde", "true"], { cwd, env: { PATH: process.env.PATH, HOME: process.env.HOME, RUNNER_TEMP: runner, BATT_SERVER: "start", STANDALONE_DIR: path.join(base, "pas-de-standalone"), ...env }, encoding: "utf8", timeout: 20000 });
  const cases = [
    ["DATA_DIR hérité = la base de dev, hors de RUNNER_TEMP", () => ({ DATA_DIR: precious("data-dev") }), "data-dev"],
    ["DATA_DIR relatif (./data-rel, comme DATA_DIR=./data)", () => (precious("data-rel"), { DATA_DIR: "./data-rel" }), "data-rel"],
    ["DATA_DIR qui ressort par « .. »", () => ({ DATA_DIR: path.join(runner, "..", "data-pt", "") }), null],
    ["DATA_DIR sous un lien symbolique qui sort de RUNNER_TEMP", () => ({ DATA_DIR: path.join(runner, "lien", "sub") }), null],
    ["DATA_DIR = RUNNER_TEMP lui-même", () => ({ DATA_DIR: runner }), null],
    ["DATA_DIR avec barre finale et « . » (runner/./../data-dev2/)", () => (precious("data-dev2"), { DATA_DIR: `${runner}/./../data-dev2/` }), "data-dev2"],
  ];
  for (const [label, mk, dir] of cases) {
    const env = mk();
    if (label.includes("lien")) { mkdirSync(path.join(outside, "sub"), { recursive: true }); writeFileSync(path.join(outside, "sub", "portfolio.db"), "base de dev"); }
    if (label.includes("= RUNNER_TEMP")) writeFileSync(path.join(runner, "portfolio.db"), "base de dev");
    if (label.includes("« .. »")) { mkdirSync(path.join(base, "data-pt"), { recursive: true }); writeFileSync(path.join(base, "data-pt", "portfolio.db"), "base de dev"); }
    const r = e2e(env);
    const survived = label.includes("lien") ? alive(path.join(outside, "sub")) : label.includes("= RUNNER_TEMP") ? alive(runner) : label.includes("« .. »") ? alive(path.join(base, "data-pt")) : alive(path.join(base, dir));
    ok(`E1 e2e.sh n'efface pas : ${label}`, survived && r.status === 2, `${survived ? "base intacte" : "BASE EFFACÉE"}, code ${r.status}`);
  }
  const rs = e2e({ SHOTS: path.join(base, "captures") });
  ok("E2 SHOTS hors de RUNNER_TEMP refusé, rien créé", rs.status === 2 && !existsSync(path.join(base, "captures")), `code ${rs.status}`);
  const ids = spawnSync("bash", [script, "../../../../dehors-id", "true"], { cwd: base, env: { PATH: process.env.PATH, HOME: process.env.HOME, RUNNER_TEMP: runner, BATT_SERVER: "start", STANDALONE_DIR: path.join(base, "x") }, encoding: "utf8", timeout: 20000 });
  ok("E3 contournement : un identifiant de suite avec « ../ » ne vise pas hors de RUNNER_TEMP", ids.status === 2 || !existsSync(path.join(base, "data-dehors-id")), `code ${ids.status}`);
  const inside = path.join(runner, "base-x");
  mkdirSync(inside, { recursive: true });
  writeFileSync(path.join(inside, "ancienne.db"), "x");
  const r1 = e2e({ DATA_DIR: inside });
  ok("E4 (témoin) un DATA_DIR sous RUNNER_TEMP est toujours effacé et recréé", r1.status !== 2 && existsSync(inside) && !existsSync(path.join(inside, "ancienne.db")), `code ${r1.status}`);
  // RUNNER_TEMP non défini : la racine retombe sur /tmp (dossier jetable ici : on pose /tmp/secuC-... sous TMPDIR=base).
  const home = mkdtempSync(path.join(process.env.HOME ?? ROOT, "secuC-loose-"));
  const loose = path.join(home, "data-dev");
  mkdirSync(loose);
  writeFileSync(path.join(loose, "portfolio.db"), "base de dev");
  const r2 = spawnSync("bash", [script, "garde", "true"], { cwd: base, env: { PATH: process.env.PATH, HOME: process.env.HOME, BATT_SERVER: "start", STANDALONE_DIR: path.join(base, "x"), DATA_DIR: loose }, encoding: "utf8", timeout: 20000 });
  ok("E5 sans RUNNER_TEMP, un DATA_DIR hors de /tmp (base de dev) n'est pas effacé", alive(loose) && r2.status === 2, `${alive(loose) ? "intacte" : "EFFACÉE"}, code ${r2.status}`);
  rmSync(home, { recursive: true, force: true });
  info("limite connue : sans RUNNER_TEMP la racine autorisée est /tmp tout entier (un DATA_DIR=/tmp/<n'importe quoi> reste effaçable) ; TOCTOU entre le contrôle (realpath) et le rm -rf non fermé");
  rmSync(base, { recursive: true, force: true });
  // Chemins /tmp fixes restants dans les scripts de test.
  const fixed = [];
  for (const f of walk(path.join(REPO, "scripts")).filter((f) => /\.(mjs|sh|cjs|mts)$/.test(f))) {
    const src = rd(path.join("scripts", f)) ?? "";
    for (const m of src.matchAll(/["'`](\/tmp\/[A-Za-z0-9._-]+[^"'`]*)["'`]/g)) fixed.push(`${f}:${m[1]}`);
  }
  const visees = ["test-auth.mjs", "e2e-domaine88.mjs", "e2e-v013.mjs"].map((n) => fixed.filter((x) => x.startsWith(n + ":") && !x.endsWith("/tmp/pwn.txt")));
  ok("E6 test-auth, e2e-domaine88, e2e-v013 n'écrivent plus dans un chemin /tmp fixe", visees.every((v) => v.length === 0), visees.flat().join(", "));
  info(`autres chemins /tmp fixes dans scripts/ (hors ces trois) : ${fixed.filter((x) => !/^(test-auth|e2e-domaine88|e2e-v013)\.mjs:/.test(x)).length}`);
}

/* ------------------------------------------------------------ N : #48 -- */
if (run("N")) {
  // Paquet local synthétique dont le postinstall écrit un fichier-témoin : `npm install` doit ne PAS l'exécuter sous le .npmrc du dépôt.
  const proj = path.join(work, "projet-npm");
  const pkg = path.join(proj, "paquet-piege");
  mkdirSync(pkg, { recursive: true });
  const marker = path.join(work, "TEMOIN-POSTINSTALL");
  writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "paquet-piege", version: "1.0.0", scripts: { postinstall: `node -e "require('fs').writeFileSync(process.env.SECUC_MARK,'exécuté')"` } }));
  writeFileSync(path.join(proj, "package.json"), JSON.stringify({ name: "projet-secuc", version: "1.0.0", private: true, dependencies: { "paquet-piege": "file:./paquet-piege" } }));
  const npmrc = rd(".npmrc");
  if (npmrc !== null) writeFileSync(path.join(proj, ".npmrc"), npmrc);
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, SECUC_MARK: marker, npm_config_cache: path.join(work, "npm-cache"), npm_config_update_notifier: "false" };
  const r = spawnSync("npm", ["install", "--no-audit", "--no-fund", "--offline"], { cwd: proj, env, encoding: "utf8", timeout: 120000 });
  ok("N1 un postinstall de paquet n'est pas exécuté par `npm install` sous le .npmrc du dépôt", r.status === 0 && !existsSync(marker), `${existsSync(marker) ? "SCRIPT EXÉCUTÉ" : "non exécuté"} (npm ${r.status}${r.status ? " " + r.stderr.slice(0, 160) : ""})`);
  rmSync(marker, { force: true });
  const r2 = spawnSync("npm", ["rebuild", "paquet-piege"], { cwd: proj, env, encoding: "utf8", timeout: 60000 });
  ok("N2 `npm rebuild` n'exécute pas non plus le script (reconstruction explicite = --ignore-scripts=false)", !existsSync(marker), `npm ${r2.status}`);
  const r3 = spawnSync("npm", ["rebuild", "paquet-piege", "--ignore-scripts=false"], { cwd: proj, env, encoding: "utf8", timeout: 60000 });
  ok("N3 (témoin) la reconstruction explicite --ignore-scripts=false exécute bien le script", npmrc === null ? true : existsSync(marker), `npm ${r3.status}`);
  const pj = JSON.parse(rd("package.json") ?? "{}");
  const hooks = Object.keys(pj.scripts ?? {}).filter((k) => /^(pre|post)/.test(k) && (Object.hasOwn(pj.scripts, k.replace(/^(pre|post)/, "")) || ["install", "test", "start", "prepare", "publish"].includes(k.replace(/^(pre|post)/, ""))));
  ok("N4 aucun script pre…/post… du projet (ils seraient ignorés en silence sous ignore-scripts)", hooks.length === 0, hooks.join(", "));
  // Paquets de la chaîne qui déclarent un script d'installation (le lock le dit : hasInstallScript).
  const lock = JSON.parse(rd("package-lock.json") ?? "{}");
  const withScripts = Object.entries(lock.packages ?? {}).filter(([, v]) => v.hasInstallScript).map(([k, v]) => `${k.replace(/^.*node_modules\//, "")}@${v.version}`);
  info(`paquets du lock avec script d'installation : ${withScripts.join(", ") || "aucun"}`);
}

/* ------------------------------------------------------------ V : #47 -- */
if (run("V")) {
  const lock = JSON.parse(rd("package-lock.json") ?? "{}").packages ?? {};
  const v = (n) => lock[`node_modules/${n}`]?.version ?? "?";
  const ge = (a, b) => a.split(".").map(Number).reduce((r, x, i) => (r !== 0 ? r : x - Number(b.split(".")[i])), 0) >= 0;
  ok("V1 next hors de la plage vulnérable 16.0.0–16.4.0 (GHSA-p3m5-59mp-jv5r, GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr)", ge(v("next"), "16.4.1"), `next ${v("next")}`);
  ok("V2 zod ≥ 4.6.6 (GHSA-mrhx-c7xc-m3w5)", ge(v("zod"), "4.6.6"), `zod ${v("zod")}`);
  ok("V3 source-map-js ≥ 1.2.2 (GHSA-68fv-2mgg-jv7q)", ge(v("source-map-js"), "1.2.2"), `source-map-js ${v("source-map-js")}`);
  const pj = JSON.parse(rd("package.json") ?? "{}");
  const nextSpec = pj.dependencies?.next ?? "?";
  ok("V4 la version de next est épinglée exactement (pas de ^ qui rouvre la plage)", /^\d+\.\d+\.\d+$/.test(nextSpec), `package.json : next ${nextSpec}`);
  ok("V5 eslint-config-next aligné sur next", v("eslint-config-next").split(".").slice(0, 2).join(".") === v("next").split(".").slice(0, 2).join("."), `eslint-config-next ${v("eslint-config-next")} / next ${v("next")}`);
  info(`sharp ${v("sharp")} (≥ 0.35.5 requis par GHSA-2464 : ${ge(v("sharp"), "0.35.5") ? "oui" : "NON"}) ; image optimizer : ${/unoptimized:\s*true/.test(rd("next.config.ts") ?? "") ? "désactivé (images.unoptimized)" : "actif"} ; « use cache » : ${spawnSync("grep", ["-rl", "use cache", path.join(REPO, "src")]).stdout.length ? "présent" : "absent"}`);
}

/* ------------------------------------------------------------ W : #19 -- */
if (run("W")) {
  const dir = path.join(REPO, ".github/workflows");
  const flows = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
  const src = Object.fromEntries(flows.map((f) => [f, readFileSync(path.join(dir, f), "utf8")]));
  const all = Object.values(src).join("\n");
  ok("W1 aucun déclencheur pull_request_target ni workflow_run (jamais le code d'un fork avec les droits du dépôt)", !/pull_request_target|workflow_run/.test(all));
  const top = (s) => /^permissions:\s*\n((?:[ ]+\S.*\n)+)/m.exec(s)?.[1].trim().split("\n").map((l) => l.trim()) ?? null;
  const bad = flows.filter((f) => { const p = top(src[f]); return !p || p.length !== 1 || !/^contents:\s*read\b/.test(p[0]); });
  ok("W2 chaque workflow a des permissions de départ « contents: read » seulement", bad.length === 0, bad.map((f) => `${f}: ${JSON.stringify(top(src[f]))}`).join(" ; "));
  const writes = [];
  for (const f of flows) {
    const lines = src[f].split("\n");
    let job = "";
    lines.forEach((l, i) => { const m = /^  ([a-z0-9_-]+):\s*$/.exec(l); if (m) job = m[1]; if (/^\s+(packages|contents|id-token|actions|pull-requests|checks|statuses|deployments|issues):\s*write/.test(l) && i > 0) writes.push(`${f}:${job}:${l.trim().split(/\s+#/)[0]}`); });
  }
  ok("W3 une seule écriture, au niveau d'un job, pour le job qui pousse l'image (packages: write)", writes.length === 1 && /^docker\.yml:image:packages: write/.test(writes[0]), writes.join(" | ") || "aucune");
  const uses = [...all.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
  const unpinned = uses.filter((u) => !/^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[0-9a-f]{40}$/.test(u));
  ok(`W4 toutes les actions (${uses.length}) sont épinglées par un SHA de commit de 40 caractères`, unpinned.length === 0, unpinned.join(", "));
  const checkouts = (all.match(/uses:\s*actions\/checkout@\S+/g) ?? []).length;
  const persisted = [...all.matchAll(/uses:\s*actions\/checkout@\S+[^\n]*\n((?:\s+(?:with|persist-credentials|[a-z-]+):[^\n]*\n)*)/g)].filter((m) => /persist-credentials:\s*false/.test(m[1])).length;
  ok(`W5 chaque checkout (${checkouts}) porte persist-credentials: false`, checkouts > 0 && persisted === checkouts, `${persisted}/${checkouts}`);
  const secrets = [...new Set([...all.matchAll(/\$\{\{\s*secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]))];
  ok("W6 aucun secret privé nécessaire pour qu'un fork public fasse tourner la CI (seul GITHUB_TOKEN)", secrets.every((s) => s === "GITHUB_TOKEN"), secrets.join(", ") || "aucun");
  const pr = /^on:\s*\n(?:.*\n)*?(?=^\S)/m.exec(all)?.[0] ?? "";
  info(`déclencheurs : ${flows.map((f) => `${f}=${(/^on:\s*\n((?:[ ]+.*\n)+)/m.exec(src[f])?.[1].match(/^\s{2}([a-z_]+):/gm) ?? []).map((x) => x.trim().replace(":", "")).join("+")}`).join(" ; ")}`);
  void pr;
}
rmSync(work, { recursive: true, force: true });
console.log(failures ? `\n${failures} échec(s)` : "\nTous les tests passent");
process.exit(failures ? 1 : 0);
