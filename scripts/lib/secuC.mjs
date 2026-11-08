/**
 * Outils communs des tests de sécurité du domaine C (phase 1 de la vérification v1.0) : serveur standalone local,
 * base synthétique, pot à cookies, appel de server actions, lecture / écriture directes de la base de test.
 * Variables : BATT_SECUC_SA (dossier .next/standalone du build à éprouver, défaut celui du dépôt),
 * BATT_SECUC_PORT (défaut 3810), BATT_SECUC_TMP (dossiers de données, défaut mkdtemp).
 * Données SYNTHÉTIQUES seulement ; le serveur n'écoute que 127.0.0.1.
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

export const ROOT = new URL("../..", import.meta.url).pathname;
export const SA = process.env.BATT_SECUC_SA ?? path.join(ROOT, ".next/standalone");
export const PORT = Number(process.env.BATT_SECUC_PORT ?? 3810);
export const BASE = `http://127.0.0.1:${PORT}`;
export const TMP = process.env.BATT_SECUC_TMP ?? mkdtempSync(path.join(tmpdir(), "secuC-"));
export const SECRET = "test-secret-0123456789abcdef-0123456789abcdef";
export const ADMIN = { email: "artiste@example.test", password: "mot-de-passe-du-test-42" };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
export const ok = (label, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!pass) failures++;
};
/** Mode « attaque » : l'attaque doit être BLOQUÉE (PASS = bloquée). Sur v0.34.0 sans correctif, ces PASS deviennent FAIL. */
export const finish = () => {
  console.log(failures ? `\n${failures} échec(s)` : "\nTous les tests passent");
  process.exit(failures ? 1 : 0);
};

export function prepareStandalone() {
  if (!existsSync(path.join(SA, "server.js"))) throw new Error(`Build absent : ${SA}`);
  const root = path.resolve(SA, "../..");
  const ready = ["drizzle", "seed", "public", ".next/static"].every((d) => existsSync(path.join(SA, d)));
  if (ready) return;
  for (const dir of ["drizzle", "seed", "public"]) cpSync(path.join(root, dir), path.join(SA, dir), { recursive: true });
  cpSync(path.join(root, ".next/static"), path.join(SA, ".next/static"), { recursive: true });
}

const servers = new Set();
const descendants = (pid) => {
  const out = [];
  const kids = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" }).stdout.split("\n").filter(Boolean).map(Number);
  for (const k of kids) out.push(k, ...descendants(k));
  return out;
};
process.on("exit", () => {
  for (const c of servers) {
    if (c.exitCode !== null) continue;
    const kids = descendants(c.pid);
    c.kill("SIGKILL");
    for (const p of kids) try { process.kill(p, "SIGKILL"); } catch {}
  }
});

/** Démarre le serveur standalone sur DATA_DIR ; `ready` résout vrai quand /fr répond 200. */
export function startServer(dataDir, env = {}, { port = PORT, probe = "/admin/connexion" } = {}) {
  mkdirSync(dataDir, { recursive: true });
  const logs = [];
  const child = spawn(process.execPath, ["server.js"], {
    cwd: SA,
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      DATA_DIR: dataDir,
      PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
      BETTER_AUTH_SECRET: SECRET,
      ADMIN_EMAIL: ADMIN.email,
      ADMIN_PASSWORD: ADMIN.password,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  servers.add(child);
  child.stdout.on("data", (d) => logs.push(String(d)));
  child.stderr.on("data", (d) => logs.push(String(d)));
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  const ready = (async () => {
    for (let i = 0; i < 120; i++) {
      if (child.exitCode !== null) return false;
      try {
        if ((await fetch(`http://127.0.0.1:${port}${probe}`)).status === 200) return true;
      } catch {}
      await sleep(250);
    }
    return false;
  })();
  return { child, logs, exited, ready, text: () => logs.join("") };
}
export async function stop(server) {
  if (server.child.exitCode === null) server.child.kill("SIGTERM");
  await Promise.race([server.exited, sleep(5000)]);
  if (server.child.exitCode === null) server.child.kill("SIGKILL");
}

export class Jar {
  cookies = new Map();
  store(response) {
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      const expired = attrs.some((a) => /max-age=0\b/i.test(a)) || value === "";
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

export async function http(url, { jar, method = "GET", body, raw, headers = {}, base = BASE } = {}) {
  const res = await fetch(url.startsWith("http") ? url : `${base}${url}`, {
    method,
    redirect: "manual",
    headers: {
      ...(jar && jar.cookies.size ? { cookie: jar.header() } : {}),
      ...(body ? { "content-type": "application/json", origin: base } : {}),
      ...headers,
    },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  jar?.store(res);
  return res;
}

export async function login(jar, xff = "203.0.113.10") {
  const r = await http("/api/auth/sign-in/email", { jar, method: "POST", body: ADMIN, headers: { "x-forwarded-for": xff } });
  return r.status;
}

export const dbPath = (dataDir) => path.join(dataDir, "portfolio.db");
export function query(dataDir, sql, ...params) {
  const db = new Database(dbPath(dataDir), { readonly: true });
  const rows = db.prepare(sql).all(...params);
  db.close();
  return rows;
}
export function exec(dataDir, sql, ...params) {
  const db = new Database(dbPath(dataDir));
  db.pragma("busy_timeout = 5000");
  const r = db.prepare(sql).run(...params);
  db.close();
  return r;
}
/** Base du journal d'édition (edit-log.db). */
export function logRows(dataDir, sql = "select * from edit_log order by id", ...params) {
  const f = path.join(dataDir, "edit-log.db");
  if (!existsSync(f)) return [];
  const db = new Database(f, { readonly: true });
  try {
    return db.prepare(sql).all(...params);
  } finally {
    db.close();
  }
}

/** Identifiants des server actions du build, lus dans le manifeste (par nom exporté). */
export function actionIds(names) {
  const manifest = JSON.parse(readFileSync(path.join(SA, ".next/server/server-reference-manifest.json"), "utf8"));
  const ids = {};
  for (const [id, entry] of Object.entries(manifest.node ?? {})) {
    const text = JSON.stringify(entry);
    for (const name of names) if (entry.exportedName === name || text.includes(`"${name}"`)) ids[name] ??= id;
  }
  return ids;
}
export async function callActionJson(jar, id, args, page = "/admin", { origin = BASE } = {}) {
  const r = await http(page, { jar, method: "POST", raw: JSON.stringify(args), headers: { "next-action": id, "content-type": "text/plain;charset=UTF-8", origin } });
  return { status: r.status, text: await r.text() };
}
export function freshDir(name) {
  const d = path.join(TMP, name);
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  return d;
}
export const cleanup = () => { if (!process.env.BATT_SECUC_TMP) rmSync(TMP, { recursive: true, force: true }); };
