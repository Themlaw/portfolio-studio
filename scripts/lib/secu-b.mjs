/**
 * Utilitaires des tests de sécurité du domaine « fichiers / médias / SVG / sauvegardes » (secu-v100).
 * Chaque test d'attaque : PASS = attaque BLOQUÉE. Sur v0.34.0 sans correctif, ces tests échouent (attaque réussie).
 * Les mesures de temps passent par un processus enfant borné par un délai (jamais de blocage de la machine).
 */
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export const ROOT = new URL("../..", import.meta.url).pathname;

let failures = 0;
export const ok = (label, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
};
export const info = (label, detail = "") => console.log(`INFO  ${label}${detail ? ` — ${detail}` : ""}`);
export const finish = () => {
  console.log(failures ? `\n${failures} échec(s) : l'attaque réussit` : "\nattaques bloquées");
  process.exit(failures ? 1 : 0);
};
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Dossier de données neuf et migré (bootstrap dans un enfant : une base par appel de `freshData`). */
let template;
export function freshData(script) {
  if (!template) {
    template = mkdtempSync(path.join(process.env.SECUB_TMP ?? tmpdir(), "secub-tpl-"));
    const r = spawnSync(process.execPath, ["--import", "tsx", script, "child", "init"], { cwd: ROOT, env: { ...process.env, DATA_DIR: template }, encoding: "utf8", timeout: 120_000 });
    if (r.status !== 0) throw new Error(`init : ${r.stdout}${r.stderr}`);
  }
  const dir = mkdtempSync(path.join(process.env.SECUB_TMP ?? tmpdir(), "secub-d-"));
  cpSync(template, dir, { recursive: true });
  return dir;
}

/** Lance l'enfant `kind` ; rend { ms, timedOut, result, stderr }. `timeoutMs` : borne dure (SIGKILL). */
export function runChild(script, kind, args = [], { timeoutMs = 30_000, env = {}, data } = {}) {
  const t = Date.now();
  const r = spawnSync(process.execPath, ["--import", "tsx", script, "child", kind, ...args.map(String)], {
    cwd: ROOT,
    env: { ...process.env, ...(data ? { DATA_DIR: data } : {}), ...env },
    encoding: "utf8",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: 64 * 1024 * 1024,
  });
  const ms = Date.now() - t;
  const timedOut = r.error?.code === "ETIMEDOUT" || r.signal === "SIGKILL";
  const line = (r.stdout ?? "").split("\n").find((l) => l.startsWith("RESULT "));
  return { ms, timedOut, result: line ? JSON.parse(line.slice(7)) : null, stderr: (r.stderr ?? "").slice(-600), stdout: r.stdout };
}
export const emit = (o) => console.log(`RESULT ${JSON.stringify(o)}`);
export const exists = existsSync;
export const mk = (d) => mkdirSync(d, { recursive: true });
