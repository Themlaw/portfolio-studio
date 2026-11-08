#!/usr/bin/env node
/**
 * Sécurité v1.0, phase 1, domaine A (accès / session / proxy / en-têtes) : tests d'ATTAQUE contre des serveurs LOCAUX de test
 * (build standalone, 127.0.0.1, données synthétiques). Un PASS = l'attaque est BLOQUÉE ; un FAIL = l'attaque réussit.
 * Sur v0.34.0 seule ces tests échouent (attaque réussie) ; avec les correctifs (#52 #56 #57 #59 #61 #62 #63 #65 #66 #67 #68) ils passent.
 * Les lignes « INFO » donnent une mesure ou un constat (jamais comptées).
 *
 *   node scripts/e2e-secuA.mjs                      (toutes les parties)
 *   SECUA_ONLY=68,57 node scripts/e2e-secuA.mjs     (parties choisies : 68 67 66 65 63 62 61 59 57 56 52)
 *   SECUA_PORT=4200 (serveur de test ; serveur annexe +1, OIDC simulé +2, sonde +3 : tout tient dans le bloc de 8 ports de la batterie)
 *
 * Prérequis : `npm run build` (standalone). Id batterie 104 : secuA (SECUA_PORT, SECUA_TMP donnés par la batterie).
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { request as httpRequest, createServer } from "node:http";
import path from "node:path";

import Database from "better-sqlite3";

const ONLY = (process.env.SECUA_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const run = (id) => ONLY.length === 0 || ONLY.includes(String(id));

const ROOT = new URL("..", import.meta.url).pathname;
const SA = path.join(ROOT, ".next/standalone");
const TMP = process.env.SECUA_TMP ?? "/tmp/portfolio-secuA";
const PORT = Number(process.env.SECUA_PORT ?? 4200);
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = "secuA-secret-0123456789abcdef-0123456789abcdef";
const ADMIN = { email: "artiste@example.test", password: "mot-de-passe-du-test-42" };

let failures = 0;
const results = [];
const ok = (label, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  results.push([label, pass]);
  if (!pass) failures++;
};
const info = (label, detail = "") => console.log(`INFO  ${label}${detail ? " — " + detail : ""}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- outils -- */
function prepareStandalone() {
  if (!existsSync(path.join(SA, "server.js"))) throw new Error("Build absent : lancer `npm run build` d'abord.");
  const ready = ["drizzle", "seed", "public", ".next/static"].every((d) => existsSync(path.join(SA, d)));
  if (ready) return;
  for (const dir of ["drizzle", "seed", "public"]) cpSync(path.join(ROOT, dir), path.join(SA, dir), { recursive: true });
  cpSync(path.join(ROOT, ".next/static"), path.join(SA, ".next/static"), { recursive: true });
}
const servers = new Set();
function descendants(pid) {
  const out = [];
  const kids = spawnSync("pgrep", ["-P", String(pid)], { encoding: "utf8" }).stdout.split("\n").filter(Boolean).map(Number);
  for (const k of kids) out.push(k, ...descendants(k));
  return out;
}
process.on("exit", () => {
  for (const c of servers) {
    if (c.exitCode !== null) continue;
    const kids = descendants(c.pid);
    c.kill("SIGKILL");
    for (const p of kids) {
      try {
        process.kill(p, "SIGKILL");
      } catch {}
    }
  }
});

function startServer(dataDir, env = {}, { probe = "/fr", port = PORT } = {}) {
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
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  servers.add(child);
  child.stdout.on("data", (d) => logs.push(String(d)));
  child.stderr.on("data", (d) => logs.push(String(d)));
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  const ready = (async () => {
    for (let i = 0; i < 80; i++) {
      if (child.exitCode !== null) return false;
      try {
        if ((await fetch(`http://127.0.0.1:${port}${probe}`)).status === 200) return true;
      } catch {}
      await sleep(250);
    }
    return false;
  })();
  return { child, logs, exited, ready, text: () => logs.join(""), port };
}
async function stop(server) {
  if (server.child.exitCode === null) server.child.kill("SIGTERM");
  await Promise.race([server.exited, sleep(8000)]);
  if (server.child.exitCode === null) server.child.kill("SIGKILL");
  await server.exited;
}

class Jar {
  cookies = new Map();
  store(response) {
    for (const line of response.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      const expired = attrs.some((a) => /max-age=0\b/i.test(a) || /expires=Thu, 01 Jan 1970/i.test(a)) || value === "";
      if (expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  copy() {
    const j = new Jar();
    for (const [k, v] of this.cookies) j.cookies.set(k, v);
    return j;
  }
}
async function http(url, { jar, method = "GET", body, raw, form, headers = {}, base = BASE } = {}) {
  const res = await fetch(url.startsWith("http") ? url : `${base}${url}`, {
    method,
    redirect: "manual",
    headers: {
      ...(jar && jar.cookies.size ? { cookie: jar.header() } : {}),
      ...(body ? { "content-type": "application/json", origin: base } : {}),
      ...headers,
    },
    body: form ?? raw ?? (body ? JSON.stringify(body) : undefined),
  });
  jar?.store(res);
  return res;
}
/** Requête brute : chemin exact (pas de normalisation par fetch), en-têtes en liste [nom, valeur] (doublons possibles). */
function rawRequest(pathname, { method = "GET", headers = [], body = null, port = PORT, timeout = 15000 } = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    // httpRequest ne permet pas les doublons par objet : on passe par un tableau plat (rawHeaders).
    const withHost = headers.some(([k]) => k.toLowerCase() === "host") ? headers : [["host", `127.0.0.1:${port}`], ...headers];
    const flat = withHost.flat();
    const r = httpRequest({ host: "127.0.0.1", port, path: pathname, method, headers: flat, setHost: false }, (res) => {
      const chunks = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8"), ms: Date.now() - t0 }));
    });
    r.on("error", (e) => resolve({ status: -1, headers: {}, body: String(e), ms: Date.now() - t0 }));
    r.setTimeout(timeout, () => r.destroy());
    if (body) r.write(body);
    r.end();
  });
}
const signIn = (jar, email, password, xff = "203.0.113.10", extra = {}) =>
  http(extra.path ?? "/api/auth/sign-in/email", { jar, method: "POST", body: { email, password }, headers: { "x-forwarded-for": xff } });
const codeOf = async (res) => (res.status === 429 || res.status >= 400 ? ((await res.json().catch(() => ({}))).code ?? String(res.status)) : String(res.status));

function query(dataDir, sql, ...params) {
  const db = new Database(path.join(dataDir, "portfolio.db"), { readonly: true });
  const row = db.prepare(sql).get(...params);
  db.close();
  return row;
}
function writeDb(dataDir, sql, ...params) {
  const db = new Database(path.join(dataDir, "portfolio.db"));
  db.pragma("busy_timeout = 5000");
  const r = db.prepare(sql).run(...params);
  db.close();
  return r;
}
function procMem(pid) {
  const status = readFileSync(`/proc/${pid}/status`, "utf8");
  const kb = (k) => Number(new RegExp(`${k}:\\s+(\\d+)`).exec(status)?.[1] ?? 0);
  return { hwm: Math.round(kb("VmHWM") / 1024), rss: Math.round(kb("VmRSS") / 1024) };
}
function actionIds(names) {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, ".next/server/server-reference-manifest.json"), "utf8"));
  const ids = {};
  for (const [id, entry] of Object.entries(manifest.node ?? {})) {
    const text = JSON.stringify(entry);
    for (const name of names) if (entry.exportedName === name || text.includes(`"${name}"`)) ids[name] ??= id;
  }
  return ids;
}
async function callActionJson(jar, id, args, page = "/admin", headers = {}) {
  const r = await http(page, { jar, method: "POST", raw: JSON.stringify(args), headers: { "next-action": id, "content-type": "text/plain;charset=UTF-8", origin: BASE, ...headers } });
  return { status: r.status, text: await r.text(), headers: r.headers };
}

/** Serveur `next dev` (dossier de build à part) : seule configuration où NODE_ENV n'est PAS figé à « production » à la compilation. */
function startDev(dataDir, env = {}, port = PORT) {
  mkdirSync(dataDir, { recursive: true });
  const logs = [];
  const child = spawn(process.execPath, [path.join(ROOT, "node_modules/next/dist/bin/next"), "dev", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NEXT_DIST_DIR: ".next/d-secuA", NEXT_TELEMETRY_DISABLED: "1", DATA_DIR: dataDir, PUBLIC_BASE_URL: `http://127.0.0.1:${port}`, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  servers.add(child);
  child.stdout.on("data", (d) => logs.push(String(d)));
  child.stderr.on("data", (d) => logs.push(String(d)));
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  const ready = (async () => {
    for (let i = 0; i < 480; i++) {
      if (child.exitCode !== null) return false;
      try {
        if ((await fetch(`http://127.0.0.1:${port}/fr`)).status === 200) return true;
      } catch {}
      await sleep(250);
    }
    return false;
  })();
  return { child, logs, exited, ready, text: () => logs.join(""), port };
}
const baseEnv = { BETTER_AUTH_SECRET: SECRET, ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, AUTH_TRUSTED_PROXY_HOPS: "1" };
let n = 0;
const fresh = (name) => {
  const dir = `${TMP}/${name}-${++n}`;
  rmSync(dir, { recursive: true, force: true });
  return dir;
};
async function boot(name, env = {}, opts = {}) {
  const dir = fresh(name);
  const s = startServer(dir, { ...baseEnv, ...env }, opts);
  const up = await s.ready;
  if (!up) console.log(`!! serveur ${name} non démarré :\n${s.text().slice(-600)}`);
  return { s, dir, up };
}
async function login(xff = "203.0.113.10", password = ADMIN.password) {
  const jar = new Jar();
  const r = await signIn(jar, ADMIN.email, password, xff);
  await r.text();
  return { jar, status: r.status };
}

mkdirSync(TMP, { recursive: true });
prepareStandalone();
console.log(`== secuA : build ${ROOT} (version ${JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version}), port ${PORT}`);

/* ------------------------------------------------ #68 force brute connexion -- */
if (run(68)) {
  console.log("\n== #68 force brute de la connexion (IPv6 /64, IPv4 mappée, délai par compte, /change-password, 12 caractères)");
  {
    const { s, up } = await boot("b68a");
    if (up) {
      const codes = [];
      for (let i = 1; i <= 12; i++) codes.push(await codeOf(await signIn(new Jar(), ADMIN.email, "mauvais", `2001:db8:77:1::${i.toString(16)}`)));
      ok("S68a IPv6 : 12 essais depuis 12 adresses d'un même /64 → freinés (429) avant la fin", codes.some((c) => c === "IP_RATE_LIMITED"), codes.join(","));
      const m = [];
      for (let i = 0; i < 5; i++) m.push(await codeOf(await signIn(new Jar(), ADMIN.email, "mauvais", "198.51.100.7")));
      for (let i = 0; i < 5; i++) m.push(await codeOf(await signIn(new Jar(), ADMIN.email, "mauvais", "::ffff:198.51.100.7")));
      ok("S68b IPv4 (5 essais) puis la même adresse écrite ::ffff:a.b.c.d (5 essais) : un seul compteur, donc 429 dès le lot « mappé »", m.slice(5).some((c) => c === "IP_RATE_LIMITED"), m.join(","));
      const x = [];
      for (let i = 0; i < 8; i++) x.push(await codeOf(await signIn(new Jar(), ADMIN.email, "mauvais", `10.0.${i}.1, 192.0.2.99`)));
      ok("S68c XFF « faux, vrai » avec un saut de confiance : la partie gauche inventée ne change pas le compteur", x.slice(5).every((c) => c === "IP_RATE_LIMITED"), x.join(","));
      const dup = [];
      for (let i = 0; i < 8; i++) {
        const res = await rawRequest("/api/auth/sign-in/email", { method: "POST", headers: [["content-type", "application/json"], ["origin", BASE], ["x-forwarded-for", `10.1.${i}.1`], ["x-forwarded-for", "192.0.2.77"]], body: JSON.stringify({ email: ADMIN.email, password: "mauvais" }) });
        dup.push(res.status === 429 ? "429" : String(res.status));
      }
      ok("S68d XFF en deux lignes d'en-tête : le dernier saut (vrai) compte, 429 dès le 6e", dup.slice(5).every((c) => c === "429"), dup.join(","));
      await stop(s);
    }
  }
  {
    // Botnet : un échec par IP, 25 IP différentes, puis le bon mot de passe depuis une IP inconnue.
    const { s, up } = await boot("b68b");
    if (up) {
      const known = await login("203.0.113.10");
      const seen = [];
      for (let i = 0; i < 25; i++) seen.push(await codeOf(await signIn(new Jar(), ADMIN.email, "mauvais", `198.51.100.${100 + i}`)));
      const throttled = seen.filter((c) => c === "ACCOUNT_THROTTLED").length;
      ok("S68e botnet (25 IP, 1 essai chacune) : le compte finit par être freiné (ACCOUNT_THROTTLED)", throttled > 0, `${throttled} refus sur 25 ; ${[...new Set(seen)].join(",")}`);
      const guess = await signIn(new Jar(), ADMIN.email, ADMIN.password, "198.51.100.200");
      const gc = await codeOf(guess);
      ok("S68f … et même le BON mot de passe depuis une IP inconnue attend (le botnet ne peut pas deviner à la volée)", gc === "ACCOUNT_THROTTLED", gc);
      const usual = await signIn(new Jar(), ADMIN.email, ADMIN.password, "203.0.113.10");
      ok("S68g l'IP habituelle de l'artiste (déjà connectée) n'est jamais enfermée dehors", usual.status === 200, String(usual.status));
      await usual.text();
      info("S68 session initiale de l'artiste", String(known.status));
      await stop(s);
    }
  }
  {
    // Contournement : Better Auth accepte aussi application/x-www-form-urlencoded ; le frein par compte lit seulement du JSON.
    const { s, up } = await boot("b68o");
    if (up) {
      const form = async (xff, password) => {
        const r = await http("/api/auth/sign-in/email", { method: "POST", raw: `email=${encodeURIComponent(ADMIN.email)}&password=${encodeURIComponent(password)}`, headers: { "content-type": "application/x-www-form-urlencoded", origin: BASE, "x-forwarded-for": xff } });
        return { status: r.status, code: await codeOf(r) };
      };
      const outs = [];
      for (let i = 0; i < 25; i++) outs.push((await form(`198.51.100.${100 + i}`, "mauvais")).code);
      const throttled = outs.filter((c) => c === "ACCOUNT_THROTTLED").length;
      const good = await form("198.51.100.220", ADMIN.password);
      ok("S68o botnet (25 IP) avec un corps application/x-www-form-urlencoded : le frein par compte s'applique aussi (v0.34.0 et #68 : AUCUN frein, corps non lu)", throttled > 0 && good.code === "ACCOUNT_THROTTLED", `${throttled} refus sur 25 ; essai final avec le BON mot de passe d'une IP inconnue → ${good.status} ${good.code}`);
      const single = [];
      for (let i = 0; i < 8; i++) single.push((await form("198.51.100.230", "mauvais")).code);
      ok("S68p même corps form-urlencoded depuis UNE IP : la limite par IP, elle, joue toujours (429 au 6e)", single.slice(5).every((c) => c === "IP_RATE_LIMITED"), single.join(","));
      // Complément #68 : un corps que Better Auth lirait (multipart, texte brut, sans type) mais que le frein ne sait pas lire est refusé.
      const odd = [];
      for (const [label, headers, raw] of [
        ["multipart", { "content-type": "multipart/form-data; boundary=zz" }, `--zz\r\nContent-Disposition: form-data; name="email"\r\n\r\n${ADMIN.email}\r\n--zz--\r\n`],
        ["text/plain", { "content-type": "text/plain" }, `email=${ADMIN.email}&password=mauvais`],
        ["sans type", {}, `email=${ADMIN.email}&password=mauvais`],
      ]) {
        const r = await http("/api/auth/sign-in/email", { method: "POST", raw, headers: { ...headers, origin: BASE, "x-forwarded-for": "198.51.100.240" } });
        odd.push(`${label}:${r.status}`);
      }
      ok("S68q complément #68 : multipart, texte brut et corps sans type refusés (415) sur la connexion, jamais passés sans frein par compte", odd.every((x) => x.endsWith(":415")), odd.join(" "));
      const jsonOk = await http("/api/auth/sign-in/email", { method: "POST", raw: JSON.stringify({ email: ADMIN.email, password: "mauvais" }), headers: { "content-type": "application/json; charset=utf-8", origin: BASE, "x-forwarded-for": "198.51.100.241" } });
      ok("S68r … et le JSON (avec charset) passe toujours par le frein normal (401 sur mauvais mot de passe)", jsonOk.status === 401, String(jsonOk.status));
      await stop(s);
    }
  }
  {
    // /change-password : cookie de session, essais du mot de passe actuel depuis des IP changeantes.
    const { s, up } = await boot("b68c");
    if (up) {
      const { jar } = await login("203.0.113.10");
      const cp = async (current, next, xff) => {
        const r = await http("/api/auth/change-password", { jar, method: "POST", body: { currentPassword: current, newPassword: next }, headers: { "x-forwarded-for": xff } });
        return { status: r.status, code: await codeOf(r) };
      };
      const outs = [];
      for (let i = 0; i < 16; i++) outs.push((await cp(`faux-${i}`, "nouveau-mot-de-passe-solide-1", `198.51.100.${50 + i}`)).code);
      ok("S68h /change-password : 16 mauvais mots de passe actuels depuis 16 IP → freinés", outs.some((c) => c === "ACCOUNT_THROTTLED" || c === "IP_RATE_LIMITED"), outs.join(","));
      const good = await cp(ADMIN.password, "nouveau-mot-de-passe-solide-1", "198.51.100.99");
      ok("S68i … et le bon mot de passe actuel, depuis une IP inconnue, est lui aussi freiné pendant le délai du compte", good.code === "ACCOUNT_THROTTLED", `${good.status} ${good.code}`);
      const same = [];
      for (let i = 0; i < 7; i++) same.push((await cp(`faux-${i}`, "nouveau-mot-de-passe-solide-1", "198.51.100.5")).code);
      ok("S68j /change-password depuis UNE IP : 429 au 6e essai (même frein que la connexion)", same.slice(5).includes("IP_RATE_LIMITED") || same.slice(5).includes("429"), same.join(","));
      await stop(s);
    }
  }
  {
    const { s, up } = await boot("b68d");
    if (up) {
      const { jar } = await login("203.0.113.10");
      const r = await http("/api/auth/change-password", { jar, method: "POST", body: { currentPassword: ADMIN.password, newPassword: "onzecarac-1" }, headers: { "x-forwarded-for": "203.0.113.10" } });
      const body = await r.json().catch(() => ({}));
      ok("S68k nouveau mot de passe de 11 caractères → refusé (12 au moins)", r.status === 400, `${r.status} ${body.code ?? ""}`);
      await stop(s);
    }
  }
  {
    // Compte existant au mot de passe court (créé avant la règle) : la connexion marche-t-elle encore ?
    const { s, dir, up } = await boot("b68e");
    if (up) {
      const { hashPassword } = await import("better-auth/crypto");
      const uid = query(dir, "select id from user where email = ?", ADMIN.email).id;
      writeDb(dir, "update account set password = ? where user_id = ? and provider_id = 'credential'", await hashPassword("court-8c"), uid);
      const r = await signIn(new Jar(), ADMIN.email, "court-8c", "203.0.113.31");
      ok("S68l mot de passe admin ACTUEL de 8 caractères (compte ancien) : la connexion l'accepte toujours", r.status === 200, String(r.status));
      await r.text();
      await stop(s);
    }
  }
  {
    // Premier démarrage : ADMIN_PASSWORD de 10 caractères sur une base vide.
    const { s, dir, up } = await boot("b68f", { ADMIN_PASSWORD: "dixcarac-1" });
    if (up) {
      const count = query(dir, "select count(*) n from user").n;
      info("S68m amorçage avec ADMIN_PASSWORD de 10 caractères (base vide)", count === 1 ? "admin créé (v0.34.0 : 8 caractères suffisent)" : `AUCUN admin créé (12 caractères exigés) ; journal : ${(s.text().match(/\[auth\][^\n]*trop court[^\n]*/) ?? [""])[0]}`);
      await stop(s);
    }
  }
  {
    // Variantes de chemin : la limite par IP doit s'appliquer quelle que soit l'écriture de l'adresse.
    const { s, up } = await boot("b68g");
    if (up) {
      const variants = ["/api/auth/sign-in/email/", "/api/auth//sign-in/email", "/api/auth/sign-in/%65mail", "/api/auth/SIGN-IN/EMAIL", "/api/auth/sign-in/email?x=1", "/api/auth/sign-in/email%2F"];
      let k = 0;
      for (const v of variants) {
        const ip = `192.0.2.${150 + k++}`;
        const outs = [];
        for (let i = 0; i < 10; i++) {
          const res = await rawRequest(v, { method: "POST", headers: [["content-type", "application/json"], ["origin", BASE], ["x-forwarded-for", ip]], body: JSON.stringify({ email: `x${k}@example.test`, password: "mauvais" }) });
          outs.push(res.status === 429 ? "429" : String(res.status));
        }
        const accepted = outs.includes("401");
        if (!accepted) info(`S68n variante « ${v} » non servie par Better Auth`, outs.join(","));
        else ok(`S68n variante « ${v} » servie ET freinée (429 avant le 7e essai)`, outs.slice(6).every((c) => c === "429"), outs.join(","));
      }
      await stop(s);
    }
  }
}

/* ------------------------------------------------------------ #67 COOP / fetch-metadata -- */
if (run(67)) {
  console.log("\n== #67 COOP de l'admin, URL profondes venues d'un autre site, déconnexion qui efface les cookies");
  const { s, up } = await boot("b67");
  if (up) {
    const { jar } = await login();
    const adm = await http("/admin", { jar });
    await adm.text();
    ok("S67a Cross-Origin-Opener-Policy: same-origin sur /admin", adm.headers.get("cross-origin-opener-policy") === "same-origin", adm.headers.get("cross-origin-opener-policy") ?? "absent");
    const lg = await http("/admin/connexion");
    await lg.text();
    ok("S67b COOP aussi sur la page de connexion (sans session)", lg.headers.get("cross-origin-opener-policy") === "same-origin", lg.headers.get("cross-origin-opener-policy") ?? "absent");
    const rows = [];
    for (const [site, want] of [["cross-site", 307], ["same-site", 307], ["same-origin", 200], ["none", 200]]) {
      const res = await http("/admin/messages", { jar, headers: { "sec-fetch-site": site, "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" } });
      await res.text();
      rows.push(`${site}→${res.status}${want === res.status ? "" : "≠" + want}`);
    }
    ok("S67c /admin/messages ouvert depuis un autre site (cross-site, same-site) → renvoyé vers /admin ; same-origin et barre d'adresse servis", rows.every((r) => !r.includes("≠")), rows.join(" "));
    // Variantes : chemin encodé / majuscules / HEAD / sans mode « navigate ».
    const variants = [["/admin/messages/", {}], ["/admin/reglages", { "sec-fetch-mode": "cors" }], ["/admin/themes", { "sec-fetch-dest": "iframe" }], ["/admin//messages", {}]];
    const leak = [];
    for (const [p, h] of variants) {
      const res = await http(p, { jar, headers: { "sec-fetch-site": "cross-site", ...h } });
      await res.text();
      if (res.status === 200) leak.push(`${p} ${JSON.stringify(h)} → 200`);
    }
    ok("S67d variantes de chemin et de mode (barre finale, double barre, dest=iframe, mode=cors) depuis cross-site → jamais rendues", leak.length === 0, leak.join(" ; "));
    const ids = actionIds(["signOutAction"]);
    const j2 = jar.copy();
    j2.cookies.set("page-draft", "1");
    j2.cookies.set("preview-from", "/admin/themes");
    j2.cookies.set("theme-preview-banner", "off");
    const hint = j2.cookies.has("portfolio-admin");
    const so = await callActionJson(j2, ids.signOutAction, [], "/admin");
    j2.store({ headers: { getSetCookie: () => so.headers.getSetCookie() } });
    const left = ["portfolio-admin", "page-draft", "preview-from", "theme-preview-banner"].filter((c) => j2.cookies.has(c));
    ok("S67e déconnexion : portfolio-admin, page-draft, preview-from, theme-preview-banner effacés", hint && left.length === 0, `indicateur posé=${hint}, restent : ${left.join(",") || "aucun"}`);
    await stop(s);
  }
}

/* ------------------------------------------------------------ #66 HSTS / CSP publique -- */
if (run(66)) {
  console.log("\n== #66 HSTS, CSP minimale du site public (ISR), CSP sandbox de l'icône");
  const { s, dir, up } = await boot("b66");
  if (up) {
    const get = async (p, o = {}) => {
      const r = await http(p, o);
      await r.arrayBuffer();
      return r;
    };
    const pub = await get("/fr/personnages");
    const csp = pub.headers.get("content-security-policy") ?? "";
    ok("S66a HSTS (un an, sous-domaines) sur le site public", pub.headers.get("strict-transport-security") === "max-age=31536000; includeSubDomains", pub.headers.get("strict-transport-security") ?? "absent");
    ok("S66b CSP publique : object-src 'none', base-uri 'self', form-action 'self', frame-ancestors 'none'", ["object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"].every((d) => csp.includes(d)), csp);
    ok("S66c CSP publique SANS script-src / default-src / media-src / font-src / img-src (rien de bloqué : éditeur, vidéos, polices, kit)", !/(script-src|default-src|media-src|font-src|img-src|style-src|connect-src)/.test(csp) && !/nonce-|sha256-/.test(csp), csp);
    const again = await get("/fr/personnages");
    ok("S66d ISR intact : s-maxage (ou Cache-Control public) et x-nextjs-cache HIT à la 2e requête", /public/.test(again.headers.get("cache-control") ?? "") && again.headers.get("x-nextjs-cache") === "HIT", `${again.headers.get("cache-control")} / ${again.headers.get("x-nextjs-cache")}`);
    const html = await (await http("/fr/personnages")).text();
    const forms = [...html.matchAll(/<form[^>]*>/gi)].map((m) => m[0]).filter((f) => /action="https?:/i.test(f));
    ok("S66e aucun <form action=\"http…\"> ni <base> vers un autre site dans la page publique (form-action 'self' sans effet)", forms.length === 0 && !/<base\s/i.test(html), forms.join(" | "));
    const icons = [];
    for (const u of ["/site-icon/icon.svg", "/site-icon/32.png", "/site-icon/192.png", "/favicon.ico", "/site-icon/icon.svg?x=1", "/site-icon//icon.svg"]) {
      const r = await get(u);
      if (r.status === 200) icons.push([u, r.headers.get("content-security-policy") ?? ""]);
    }
    ok("S66f icône de l'onglet (+ variantes ?x, //) : CSP sandbox exacte", icons.length > 0 && icons.every(([, c]) => c === "default-src 'none'; style-src 'unsafe-inline'; sandbox"), icons.map(([u, c]) => `${u} « ${c.slice(0, 40)} »`).join(" ; ") || "aucune icône servie");
    const nf = await get("/fr/page-inconnue-secua");
    info("S66g 404 (page inconnue) : en-têtes", `HSTS=${nf.headers.get("strict-transport-security") ?? "absent"} ; CSP=${nf.headers.get("content-security-policy") ?? "absent"} ; XFO=${nf.headers.get("x-frame-options") ?? "absent"}`);
    ok("S66h la page 404 porte aussi HSTS et la CSP publique", nf.headers.get("strict-transport-security") === "max-age=31536000; includeSubDomains" && /object-src 'none'/.test(nf.headers.get("content-security-policy") ?? ""), `${nf.status}`);
    const red = await get("/");
    info("S66i redirection de « / » : en-têtes", `${red.status} HSTS=${red.headers.get("strict-transport-security") ?? "absent"}`);
    const media = await get("/media/inexistant.svg");
    info("S66j /media : CSP", media.headers.get("content-security-policy") ?? "absent");
    // Vue brouillon (toile de l'éditeur) et vignettes : même CSP minimale, jamais plus stricte que frame-ancestors 'self'.
    const { jar } = await login();
    const ap = await http("/admin/apercu", { jar, method: "POST", form: (() => { const f = new FormData(); f.append("id", "pro"); return f; })(), headers: { origin: BASE } });
    await ap.text();
    const draft = await get("/fr/personnages", { jar });
    const dcsp = draft.headers.get("content-security-policy") ?? "";
    ok("S66k aperçu admin (draft mode) : frame-ancestors 'self' + object-src/base-uri/form-action ; X-Frame-Options SAMEORIGIN", dcsp.includes("frame-ancestors 'self'") && dcsp.includes("object-src 'none'") && draft.headers.get("x-frame-options") === "SAMEORIGIN", `${dcsp} | ${draft.headers.get("x-frame-options")}`);
    const adm = await get("/admin", { jar });
    ok("S66l CSP de l'admin inchangée (nonce, strict-dynamic) et HSTS présent", /script-src 'self' 'nonce-/.test(adm.headers.get("content-security-policy") ?? "") && Boolean(adm.headers.get("strict-transport-security")), adm.headers.get("strict-transport-security") ?? "HSTS absent");
    await stop(s);
  }
}

/* ------------------------------------------------------------ #65 proxy durci -- */
if (run(65)) {
  console.log("\n== #65 proxy durci (port interne, en-têtes, secret, X-Forwarded-Host, cache de la redirection)");
  const OLD = "old.example.org";
  const { s, up } = await boot("b65", { REDIRECT_FROM: OLD });
  if (up) {
    const nf = async (headers) => {
      const r = await rawRequest("/fr/page-qui-n-existe-pas-secua", { headers });
      return { status: r.status, len: r.body.length, cache: r.headers["cache-control"] ?? "" };
    };
    let r = await nf([["expect", "100-continue"]]);
    ok("S65a page inconnue avec « Expect: 100-continue » → vraie page 404 (v0.34.0 : 500)", r.status === 404 && r.len > 500, `${r.status} ${r.len} o`);
    r = await nf([["host", "127.0.0.1:9"]]);
    ok("S65b port de l'en-tête Host ignoré (page 404 servie par le vrai serveur)", r.status === 404 && r.len > 500, `${r.status} ${r.len} o`);
    r = await nf([["x-portfolio-internal", "00000000-0000-4000-8000-000000000000"]]);
    ok("S65c faux en-tête interne → traité comme une requête publique (404)", r.status === 404 && r.len > 500 && /no-store/.test(r.cache), `${r.status} ${r.len} o`);
    // X-Forwarded-Host fait de milliers de points : coût CPU de la regex /\.+$/ (REDIRECT_FROM actif).
    const dots = "a" + ".".repeat(14000) + "x";
    const t = [];
    for (let i = 0; i < 3; i++) t.push((await rawRequest("/fr", { headers: [["x-forwarded-host", dots]] })).ms);
    const base = [];
    for (let i = 0; i < 3; i++) base.push((await rawRequest("/fr", { headers: [["x-forwarded-host", "www.example.org"]] })).ms);
    const med = (a) => [...a].sort((x, y) => x - y)[1];
    ok("S65d X-Forwarded-Host de 14 000 points : pas plus de 40 ms de plus qu'une requête normale (regex quadratique)", med(t) - med(base) < 40, `${med(t)} ms contre ${med(base)} ms`);
    // Cache de la redirection d'ancien domaine : dépend de X-Forwarded-Host.
    const red = await rawRequest("/fr/personnages", { headers: [["x-forwarded-host", OLD]] });
    info("S65e redirection pilotée par X-Forwarded-Host seul (Host = domaine principal)", `${red.status} Location=${red.headers.location} Cache-Control=${red.headers["cache-control"]}`);
    ok("S65f cette redirection n'est jamais publique (Cache-Control: private) : un cache partagé ne peut pas la garder", /private/.test(red.headers["cache-control"] ?? "") && !/public/.test(red.headers["cache-control"] ?? ""), red.headers["cache-control"] ?? "");
    const dupe = await rawRequest("/fr", { headers: [["x-forwarded-host", OLD], ["x-forwarded-host", "www.example.org"]] });
    info("S65g X-Forwarded-Host en deux lignes (ancien domaine d'abord)", `${dupe.status} ${dupe.headers.location ?? ""}`);
    await stop(s);
  }
  {
    // PORT absent de l'environnement du processus (lancement hors de l'image) : `next start -p`, pour que le port interne dépende de Host.
    const port = PORT + 1;
    const canary = createServer((req, res) => {
      canary.hits.push(`${req.method} ${req.url}`);
      res.end("canary");
    });
    canary.hits = [];
    const cport = PORT + 3;
    await new Promise((r) => canary.listen(cport, "127.0.0.1", r));
    const dir = fresh("b65b");
    mkdirSync(dir, { recursive: true });
    const env = { PATH: process.env.PATH, NODE_ENV: "production", DATA_DIR: dir, HOSTNAME: "127.0.0.1", ...baseEnv, PUBLIC_BASE_URL: `http://127.0.0.1:${port}` };
    const child = spawn(process.execPath, [path.join(ROOT, "node_modules/next/dist/bin/next"), "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    servers.add(child);
    const logs = [];
    child.stdout.on("data", (d) => logs.push(String(d)));
    child.stderr.on("data", (d) => logs.push(String(d)));
    let ready = false;
    for (let i = 0; i < 80 && !ready; i++) {
      try {
        ready = (await fetch(`http://127.0.0.1:${port}/fr`)).status === 200;
      } catch {}
      if (!ready) await sleep(250);
    }
    if (!ready) info("S65h next start sans PORT : serveur non démarré", logs.join("").slice(-300));
    else {
      const res = await rawRequest("/fr/inconnue-secua", { port, headers: [["host", `127.0.0.1:${cport}`]] });
      await sleep(300);
      ok("S65h SSRF : sans PORT dans l'environnement, l'en-tête Host ne dirige pas la requête interne vers un autre port local (sonde jamais touchée)", canary.hits.length === 0, `sonde touchée ${canary.hits.length} fois (${canary.hits[0] ?? ""}) ; réponse ${res.status}`);
      const plain = await rawRequest("/fr/inconnue-secua", { port });
      info("S65i sans PORT dans l'environnement, page 404 normale", `${plain.status} ${plain.body.length} o (si 500 : le repli sur 3000 casse les 404 hors de l'image)`);
    }
    child.kill("SIGTERM");
    await sleep(500);
    canary.close();
  }
}

/* #65 (suite) : `next dev` n'a pas PORT dans l'environnement : le port de la requête interne vient-il de l'en-tête Host ? */
if (run(65)) {
  const cport = PORT + 3;
  const canary = createServer((req, res) => {
    canary.hits.push(`${req.method} ${req.url}`);
    res.end("canary");
  });
  canary.hits = [];
  await new Promise((r) => canary.listen(cport, "127.0.0.1", r));
  const dir = fresh("d65");
  const sv = startDev(dir, { ...baseEnv });
  const up = await sv.ready;
  if (!up) info("S65j `next dev` non démarré", sv.text().slice(-300));
  else {
    await rawRequest("/fr/inconnue-chauffe-secua", { timeout: 90000 });
    const res = await rawRequest("/fr/inconnue-secua", { headers: [["host", `127.0.0.1:${cport}`]], timeout: 60000 });
    await sleep(500);
    ok("S65j `next dev` (PORT absent de l'environnement) : l'en-tête Host ne dirige pas la requête interne de la page 404 vers un autre port local (SSRF)", canary.hits.length === 0, `sonde touchée ${canary.hits.length} fois (${canary.hits[0] ?? ""}) ; réponse ${res.status}`);
    const plain = await rawRequest("/fr/inconnue-secua", { timeout: 60000 });
    info("S65k `next dev` : page 404 normale (si 500 : le repli sur le port 3000 la casse en dev)", `${plain.status} ${plain.body.length} o`);
    await stop(sv);
  }
  canary.close();
}

/* ------------------------------------------------------------ #63 PORTFOLIO_DEV -- */
if (run(63)) {
  console.log("\n== #63 drapeau explicite PORTFOLIO_DEV=1 au lieu de NODE_ENV pour les facilités de dev");
  {
    // Build de production : NODE_ENV est figé à la compilation (« production »). Le scénario « NODE_ENV oublié » n'existe donc PAS dans l'image.
    const dir = fresh("b63a");
    const sv = startServer(dir, { ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, NODE_ENV: "development" });
    const up = await sv.ready;
    ok("S63a build de production lancé avec NODE_ENV=development et SANS BETTER_AUTH_SECRET → démarrage refusé (NODE_ENV figé à la compilation)", !up && (await Promise.race([sv.exited, sleep(10000).then(() => null)])) === 1, up ? "le serveur a démarré avec un secret de dev" : sv.text().match(/\[auth\][^\n]*/)?.[0] ?? "");
    if (up) await stop(sv);
    const { s, up: up2 } = await boot("b63b", { NODE_ENV: "development" });
    if (up2) {
      const r = await http("/api/theme-preview?id=pro&redirect=/fr");
      await r.text();
      ok("S63b build de production, NODE_ENV=development à l'exécution : l'aperçu de thème reste fermé aux anonymes (404)", r.status === 404, String(r.status));
      await stop(s);
    }
    const dir2 = fresh("b63c");
    const sv2 = startServer(dir2, { ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, PORTFOLIO_DEV: "1" });
    const up3 = await sv2.ready;
    ok("S63c build de production + PORTFOLIO_DEV=1 sans secret → arrêt (le drapeau seul ne suffit pas)", !up3 && (await Promise.race([sv2.exited, sleep(10000).then(() => null)])) === 1, up3 ? "démarré !" : "");
    if (up3) await stop(sv2);
  }
  // `next dev` : la seule configuration où les facilités de dev existent vraiment.
  {
    const dir = fresh("d63a");
    const sv = startDev(dir, { ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password });
    const up = await sv.ready;
    ok("S63d `next dev` SANS PORTFOLIO_DEV et SANS BETTER_AUTH_SECRET → démarrage refusé (v0.34.0 : secret de dev local utilisé en silence)", !up, up ? "le serveur de dev a démarré avec un secret de dev" : sv.text().match(/\[auth\][^\n]*/)?.[0] ?? "refusé");
    if (up) await stop(sv);
  }
  {
    const dir = fresh("d63b");
    const sv = startDev(dir, { ...baseEnv });
    const up = await sv.ready;
    if (!up) info("S63e–g `next dev` avec secret, sans PORTFOLIO_DEV : non démarré", sv.text().slice(-300));
    else {
      let r = await http("/api/theme-preview?id=pro&redirect=/fr");
      await r.text();
      ok("S63e `next dev` sans PORTFOLIO_DEV : l'aperçu de thème est fermé aux anonymes (404 ; v0.34.0 : 303 + cookies d'aperçu)", r.status === 404, `${r.status} ; cookies posés : ${r.headers.getSetCookie().length}`);
      r = await http("/admin/connexion");
      await r.text();
      const c = r.headers.get("content-security-policy") ?? "";
      ok("S63f … et la CSP de l'admin n'a ni unsafe-eval ni ws: (v0.34.0 : les deux)", !/unsafe-eval|ws:/.test(c), c.slice(0, 160));
      const o = await http("/api/auth/sign-in/email", { method: "POST", raw: JSON.stringify({ email: ADMIN.email, password: "mauvais" }), headers: { "content-type": "application/json", origin: "http://localhost:3001", "x-forwarded-for": "203.0.113.55" } });
      await o.text();
      ok("S63g … et l'origine http://localhost:3001 n'est pas de confiance pour l'authentification (403 ; v0.34.0 : 401 « identifiants »)", o.status === 403, String(o.status));
      await stop(sv);
    }
  }
  {
    const dir = fresh("d63c");
    const sv = startDev(dir, { ...baseEnv, PORTFOLIO_DEV: "1" });
    const up = await sv.ready;
    if (up) {
      const r = await http("/api/theme-preview?id=pro&redirect=/fr");
      await r.text();
      ok("S63h `next dev` AVEC PORTFOLIO_DEV=1 : l'aperçu de thème reste utilisable (scripts de test, 303)", r.status === 303, String(r.status));
      await stop(sv);
    } else info("S63h `next dev` avec PORTFOLIO_DEV=1 non démarré", sv.text().slice(-300));
  }
}

/* ------------------------------------------------------------ #62 corps du proxy borné -- */
if (run(62)) {
  console.log("\n== #62 corps du proxy borné à 1 Mo, route d'auth lue en flux après la limite par IP");
  const { s, up } = await boot("b62");
  if (up) {
    const big = Buffer.alloc(5 * 1024 * 1024, 0x61);
    for (let i = 0; i < 2; i++) await http("/api/auth/sign-in/email", { method: "POST", raw: big.subarray(0, 600 * 1024), headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": `203.0.113.${150 + i}` } }).then((x) => x.text());
    await sleep(500);
    const before = procMem(s.child.pid);
    const sized = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        http("/api/auth/sign-in/email", { method: "POST", raw: big, headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": `203.0.113.${200 + i}` } }).then(async (res) => (await res.text(), res.status)),
      ),
    );
    await sleep(500);
    const after = procMem(s.child.pid);
    info("S62 mémoire du serveur après 10 POST de 5 Mo", `pic ${before.hwm} → ${after.hwm} Mo (+${after.hwm - before.hwm}) ; courant ${before.rss} → ${after.rss} Mo ; statuts ${sized.join(",")}`);
    ok("S62a 10 POST de 5 Mo vers /api/auth/sign-in/email → 413 (corps abandonné), croissance du pic < 100 Mo", sized.every((x) => x === 413) && after.hwm - before.hwm < 100, `${sized.join(",")} ; +${after.hwm - before.hwm} Mo`);
    const chunks = (async function* () {
      for (let i = 0; i < 64; i++) yield new Uint8Array(32 * 1024).fill(0x61);
    })();
    const res = await fetch(`${BASE}/api/auth/sign-in/email`, { method: "POST", body: chunks, duplex: "half", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": "203.0.113.230" } });
    await res.text();
    ok("S62b corps de 2 Mo SANS Content-Length (flux découpé) → 413", res.status === 413, String(res.status));
    // La limite par IP passe AVANT la lecture du corps : une IP bloquée n'envoie plus rien en mémoire.
    const ipCodes = [];
    for (let i = 0; i < 8; i++) ipCodes.push(await codeOf(await http("/api/auth/sign-in/email", { method: "POST", raw: Buffer.alloc(200 * 1024, 0x61), headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": "203.0.113.240" } })));
    info("S62c 8 POST de 200 Ko depuis une même IP", ipCodes.join(","));
    await http("/api/contact", { method: "POST", raw: Buffer.alloc(2 * 1024 * 1024, 0x61), headers: { "content-type": "application/json", origin: BASE } }).then((x) => x.text());
    await sleep(300);
    ok("S62d corps de 2 Mo sur /api/contact : le proxy plafonne à 1 Mo (journal Next « exceeded 1MB »), pas 10 Mo", /Request body exceeded 1MB/.test(s.text()) && !/Request body exceeded 10MB/.test(s.text()), (/Request body exceeded [^.\n]*/.exec(s.text()) ?? ["aucun message"])[0]);
    const ok1 = await signIn(new Jar(), ADMIN.email, ADMIN.password, "203.0.113.250");
    ok("S62e régression : une connexion normale marche toujours (corps de quelques octets)", ok1.status === 200, String(ok1.status));
    await ok1.text();
    await stop(s);
  }
}

/* ------------------------------------------------------------ #61 sécurité du compte / sessions -- */
if (run(61)) {
  console.log("\n== #61 sessions bornées (3 j d'inactivité, 7 j absolus), changement de mot de passe qui coupe les autres sessions, écran Sécurité du compte");
  const { s, dir, up } = await boot("b61");
  if (up) {
    const A = await login("203.0.113.10");
    const sess = query(dir, "select created_at c, expires_at e from session order by created_at desc limit 1");
    const days = (sess.e - sess.c) / 86_400_000;
    // les dates sont en secondes ou en millisecondes selon la colonne : normalisation
    const span = days > 1000 ? (sess.e - sess.c) / 86_400 / 1000 : days;
    ok("S61a durée d'une nouvelle session : 3 jours (v0.34.0 : 7 jours glissants)", Math.abs(span - 3) < 0.1, `${span.toFixed(2)} jours`);
    // Cookie volé : session B, puis changement de mot de passe depuis A SANS demander la coupure des autres.
    const B = await login("203.0.113.11");
    const ra = await http("/api/auth/change-password", { jar: A.jar, method: "POST", body: { currentPassword: ADMIN.password, newPassword: "nouveau-mot-de-passe-42", revokeOtherSessions: false }, headers: { "x-forwarded-for": "203.0.113.10" } });
    await ra.text();
    const stillB = await http("/admin/reglages", { jar: B.jar });
    await stillB.text();
    ok("S61b changement de mot de passe (revokeOtherSessions:false forcé par le client) : la session volée B est coupée (307)", ra.status === 200 && stillB.status === 307, `change=${ra.status}, session B → ${stillB.status}`);
    // Durée absolue : session créée il y a 8 jours, encore « valide » côté Better Auth (prolongée chaque jour).
    const C = await login("203.0.113.12", "nouveau-mot-de-passe-42");
    const last = query(dir, "select id, created_at c from session order by created_at desc limit 1");
    const unit = last.c > 1e11 ? 1 : 1000;
    writeDb(dir, "update session set created_at = ?, expires_at = ? where id = ?", Date.now() / unit - (8 * 86400 * 1000) / unit, Date.now() / unit + (2 * 86400 * 1000) / unit, last.id);
    const old = await http("/admin/reglages", { jar: C.jar });
    await old.text();
    ok("S61c session ouverte il y a 8 jours mais prolongée (expire dans 2 j) → refusée (v0.34.0 : acceptée, jamais d'expiration absolue)", old.status === 307, String(old.status));
    const gone = query(dir, "select count(*) n from session where id = ?", last.id).n;
    info("S61c’ la session périmée est supprimée de la base", gone === 0 ? "oui" : "non");
    const D = await login("203.0.113.13", "nouveau-mot-de-passe-42");
    const screen = await http("/admin/compte", { jar: D.jar });
    const screenHtml = await screen.text();
    ok("S61d écran /admin/compte (Sécurité du compte) servi à l'admin", screen.status === 200 && screenHtml.includes("Sécurité du compte"), String(screen.status));
    const anon = await http("/admin/compte");
    await anon.text();
    ok("S61e /admin/compte sans session → 307 vers la connexion", anon.status === 307, String(anon.status));
    // Server action : mêmes freins que la connexion ? (essais du mot de passe actuel depuis des IP changeantes d'un même /64)
    const ids = actionIds(["changePasswordAction", "revokeOtherSessionsAction"]);
    if (ids.changePasswordAction) {
      const act = async (input, xff) => {
        const r = await callActionJson(D.jar, ids.changePasswordAction, [input], "/admin/compte", { "x-forwarded-for": xff });
        return r.text;
      };
      const outs = [];
      for (let i = 1; i <= 16; i++) outs.push(await act({ currentPassword: `faux-${i}`, newPassword: "encore-un-mot-de-passe-9", confirm: "encore-un-mot-de-passe-9" }, `2001:db8:61:1::${i.toString(16)}`));
      const blocked = outs.filter((t) => /Trop d.essais|Trop d.échecs|réessaie dans/.test(t)).length;
      ok("S61f server action « changer le mot de passe » : 16 essais du mot de passe actuel depuis 16 adresses d'un même /64 → freinés", blocked > 0, `${blocked} refus sur 16 ; ${[...new Set(outs.map((t) => (/Mot de passe actuel incorrect/.test(t) ? "incorrect" : t.slice(0, 60))))].join(" | ")}`);
      const short = await act({ currentPassword: "nouveau-mot-de-passe-42", newPassword: "onzecarac-1", confirm: "onzecarac-1" }, "203.0.113.14");
      info("S61g action : nouveau mot de passe de 11 caractères", short.slice(0, 160));
      ok("S61h … message d'erreur cohérent avec la règle des 12 caractères (jamais « Entre 8 et 128 »)", !/8 et 128|8 caractères/.test(short) && /12/.test(short), short.slice(0, 160));
    } else info("S61f/g/h action changePasswordAction absente de ce build (v0.34.0 : aucun écran de changement de mot de passe)");
    await stop(s);
  }
  {
    // Script de réinitialisation (image distroless) : présent ? fonctionne ? coupe toutes les sessions ?
    const script = path.join(ROOT, "scripts/reset-password.mjs");
    ok("S61i scripts/reset-password.mjs présent (procédure d'incident)", existsSync(script), existsSync(script) ? "oui" : "absent (v0.34.0 : aucun moyen de couper les sessions ni de réinitialiser le mot de passe sans SQL)");
    if (existsSync(script)) {
      const { s: s2, dir: d2, up: up2 } = await boot("b61r");
      if (up2) {
        const J = await login("203.0.113.15");
        await stop(s2);
        const out = spawnSync(process.execPath, [script, ADMIN.email, d2], { input: "reinit-mot-de-passe-77\n", encoding: "utf8", cwd: ROOT });
        const left = query(d2, "select count(*) n from session").n;
        ok("S61j reset-password.mjs : réussit et supprime toutes les sessions", out.status === 0 && left === 0, `${out.status} ${out.stdout.trim().slice(0, 120)} ; sessions restantes ${left} ; ${out.stderr.slice(0, 100)}`);
        const s3 = startServer(d2, baseEnv);
        await s3.ready;
        const r1 = await signIn(new Jar(), ADMIN.email, "reinit-mot-de-passe-77", "203.0.113.16");
        const r2 = await signIn(new Jar(), ADMIN.email, ADMIN.password, "203.0.113.17");
        const old = await http("/admin/reglages", { jar: J.jar });
        await old.text();
        ok("S61k après la réinitialisation : nouveau mot de passe accepté, ancien refusé, ancienne session coupée", r1.status === 200 && r2.status === 401 && old.status === 307, `${r1.status}/${r2.status}/${old.status}`);
        await r1.text();
        await r2.text();
        const short = spawnSync(process.execPath, [script, ADMIN.email, d2], { input: "court-8c\n", encoding: "utf8", cwd: ROOT });
        info("S61l reset-password.mjs avec un mot de passe de 8 caractères", short.status === 0 ? "ACCEPTÉ (le script ne suit pas la règle des 12 caractères)" : `refusé : ${short.stderr.trim().slice(0, 80)}`);
        await stop(s3);
      }
    }
  }
}

/* ------------------------------------------------------------ #59 e-mails OIDC ASCII -- */
if (run(59)) {
  console.log("\n== #59 e-mails OIDC acceptés en ASCII seulement avant la comparaison avec ADMIN_EMAILS");
  const { OAuth2Server } = await import("oauth2-mock-server");
  const MOCK_PORT = PORT + 2;
  const mock = new OAuth2Server();
  await mock.issuer.keys.generate("RS256");
  await mock.start(MOCK_PORT, "127.0.0.1");
  const issuer = `http://127.0.0.1:${MOCK_PORT}`;
  let identity = {};
  const claims = () => ({ sub: identity.sub, email: identity.email, email_verified: identity.email_verified, name: "x", groups: identity.groups });
  mock.service.on("beforeTokenSigning", (token) => Object.assign(token.payload, claims()));
  mock.service.on("beforeUserinfo", (u) => {
    u.body = claims();
  });
  const env = { AUTH_PASSWORD_DISABLED: "true", AUTH_OIDC_ISSUER: issuer, AUTH_OIDC_CLIENT_ID: "portfolio", AUTH_OIDC_CLIENT_SECRET: "secret-du-client", ADMIN_EMAILS: "kate@example.test,autorise@example.test", AUTH_ADMIN_GROUP: "admins-portfolio" };
  const { s, dir, up } = await boot("b59", env);
  if (up) {
    let ip = 60;
    const flow = async (who) => {
      identity = { email_verified: true, groups: [], ...who };
      const jar = new Jar();
      let res = await http("/api/auth/sign-in/social", { jar, method: "POST", body: { provider: "authentik", callbackURL: "/admin", errorCallbackURL: "/admin/connexion" }, headers: { "x-forwarded-for": `203.0.113.${ip++}` } });
      const { url } = await res.json();
      res = await http(url);
      const callback = res.headers.get("location");
      res = await http(callback, { jar });
      const final = res.headers.get("location") ?? "";
      const probe = await http("/admin/reglages", { jar });
      await probe.text();
      return { final, admin: probe.status === 200, jar, callbackStatus: res.status, callback };
    };
    // Kelvin EN PREMIER : base vierge (sinon account_not_linked refuserait avant toute comparaison, pour une autre raison).
    const before = query(dir, "select count(*) n from user").n;
    const kelvin = await flow({ sub: "u-kelvin", email: "\u212Aate@example.test" });
    ok("S59b e-mail avec le signe Kelvin « K » (U+212A → « k » par toLowerCase), vérifié, base vierge → refusé, aucun compte créé", !kelvin.admin && /error=/.test(kelvin.final) && query(dir, "select count(*) n from user").n === before, `${kelvin.final.slice(0, 80)} ; admin=${kelvin.admin} ; comptes ${before} → ${query(dir, "select count(*) n from user").n}`);
    await stop(s);
    const { s: s1, dir: dir1, up: up1 } = await boot("b59b", env);
    if (!up1) throw new Error("serveur S59b non démarré");
    const sGood = s1;
    const good = await flow({ sub: "u-kate", email: "Kate@Example.test" });
    ok("S59a la vraie adresse listée (ASCII, casse différente), vérifiée → session admin (callback /api/auth/callback/authentik)", good.admin && /\/api\/auth\/callback\/authentik/.test(good.callback), `${good.final} ${good.callback.slice(0, 70)}`);
    const homoglyph = await flow({ sub: "u-cyr", email: "аutorise@example.test" });
    ok("S59c homoglyphe cyrillique « а » (U+0430) → refusé", !homoglyph.admin && homoglyph.final.includes("admin_not_allowed"), homoglyph.final.slice(0, 80));
    const others = [];
    for (const [label, email] of [["pleine chasse ｋ", "ｋate@example.test"], ["I turc İ", "autorise@examplİ.test"], ["s long ſ", "kate@example.teſt"], ["zéro-largeur", "kate​@example.test"], ["espace final", "kate@example.test "], ["octet nul", "kate@example.test\u0000"], ["majuscule composée", "KATE@EXAMPLE.TEST"]]) {
      const f = await flow({ sub: `u-${label}`, email });
      others.push(`${label}:${f.admin ? "ADMIS" : "refusé"}`);
    }
    info("S59d autres variantes Unicode / casse", others.join(" ; "));
    ok("S59e aucune variante non ASCII n'est admise (seule la forme ASCII, quelle que soit la casse, l'est)", others.filter((o) => !o.startsWith("majuscule")).every((o) => o.endsWith("refusé")), others.join(" ; "));
    const unverified = await flow({ sub: "u-nv", email: "autorise@example.test", email_verified: false });
    const kelvinLate = await flow({ sub: "u-kelvin-2", email: "\u212Aate@example.test" });
    ok("S59b’ le même e-mail Kelvin APRÈS la création du vrai compte : refusé (account_not_linked ou admin_not_allowed)", !kelvinLate.admin, kelvinLate.final.slice(0, 80));
    ok("S59f e-mail listé mais NON vérifié → refusé", !unverified.admin, unverified.final.slice(0, 60));
    const asString = await flow({ sub: "u-str", email: "autorise@example.test", email_verified: "true" });
    ok("S59g email_verified = « true » (chaîne) → refusé", !asString.admin, asString.final.slice(0, 60));
    await stop(sGood);
    // ADMIN_EMAILS contenant le signe Kelvin lui-même : écarté avec avertissement.
    const { s: s2, up: up2 } = await boot("b59w", { ...env, ADMIN_EMAILS: "Kate@example.test" });
    if (up2) {
      const k2 = await flow({ sub: "u-kelvin2", email: "kate@example.test" });
      const warned = /ADMIN_EMAILS : une adresse contient des caractères non ASCII/.test(s2.text());
      ok("S59h ADMIN_EMAILS contenant le signe Kelvin : entrée écartée, avertissement journalisé, « kate@ » ASCII non admise par erreur", warned && !k2.admin, `avertissement=${warned} admin=${k2.admin}`);
      await stop(s2);
    }
  }
  await mock.stop();
}

/* ------------------------------------------------------------ #57 session admin vérifiée en base -- */
if (run(57)) {
  console.log("\n== #57 session de l'admin vérifiée en base (proxy et pages) : cookie inventé + RSC, cookie révoqué");
  const { s, dir, up } = await boot("b57");
  if (up) {
    const ADMIN_PAGES = ["/admin", "/admin/messages", "/admin/reglages", "/admin/journal", "/admin/sauvegardes", "/admin/pages", "/admin/pages/1", "/admin/pages/1/editer", "/admin/projets", "/admin/medias", "/admin/themes", "/admin/cadres", "/admin/papiers-peints"];
    const tree = encodeURIComponent(JSON.stringify(["", { children: ["admin", { children: ["(espace)", { children: ["pages", { children: ["__PAGE__", {}] }] }] }] }, null, null]));
    const fake = "__Secure-better-auth.session_token=totally.made.up.AAAA; better-auth.session_token=totally.made.up.AAAA";
    const rscHeaders = (cookie) => ({ cookie, RSC: "1", "Next-Router-State-Tree": tree, "Next-Url": "/admin/pages" });
    const probe = async (page, headers) => {
      for (const url of [`${page}?_rsc=a1b2c`, page]) {
        let res = await http(url, { headers });
        const loc = res.headers.get("location");
        if (res.status === 307 && loc?.includes("_rsc=")) res = await http(loc, { headers });
        const body = await res.text();
        if (res.status === 200 && body.length > 1000) return `${url} → 200 ${body.length} o`;
      }
      return null;
    };
    writeDb(dir, "insert into messages (subject, fields, reply_to, ip_hash) values (?, ?, ?, ?)", "SECUA-SUJET-PRIVE", JSON.stringify({ message: "SECUA-MESSAGE-PRIVE du visiteur" }), "visiteur@example.test", "h");
    const leaks = [];
    for (const p of ADMIN_PAGES) {
      const l = await probe(p, rscHeaders(fake));
      if (l) leaks.push(l);
    }
    const marker = await (async () => {
      const h = rscHeaders(fake);
      let res = await http("/admin/messages?_rsc=a", { headers: h });
      const loc = res.headers.get("location");
      if (res.status === 307 && loc?.includes("_rsc=")) res = await http(loc, { headers: h });
      const body = await res.text();
      return res.status === 200 && /SECUA-(SUJET|MESSAGE)-PRIVE|visiteur@example\.test/.test(body);
    })();
    ok("S57a0 le message privé d'un visiteur (sujet, texte, e-mail de réponse) est lisible avec un cookie inventé + RSC → doit être refusé", !marker, marker ? "MESSAGE PRIVÉ LU SANS CONNEXION" : "refusé");
    ok("S57a cookie de session INVENTÉ + « RSC: 1 » : aucune des 13 pages de l'admin ne répond du contenu (v0.34.0 : lecture de l'admin sans connexion)", leaks.length === 0, `${leaks.length} fuite(s) : ${leaks.slice(0, 4).join(" ; ")}`);
    // Cookie RÉEL puis session révoquée en base (déconnexion ailleurs, changement de mot de passe, retrait d'accès).
    const A = await login();
    const real = A.jar.header();
    writeDb(dir, "delete from session");
    const revoked = [];
    for (const p of ["/admin/messages", "/admin/reglages", "/admin/journal"]) {
      const l = await probe(p, rscHeaders(real));
      if (l) revoked.push(l);
    }
    ok("S57b cookie RÉEL dont la session a été supprimée en base + RSC → aucun contenu", revoked.length === 0, revoked.join(" ; "));
    const plain = await http("/admin/reglages", { headers: { cookie: real } });
    await plain.text();
    ok("S57c … et sans RSC (navigation classique) → redirection vers la connexion", plain.status === 307, String(plain.status));
    // Contournements : encodages du chemin, casse, doubles barres, point-virgule, X-Middleware-Subrequest.
    const bypass = [];
    const variants = ["/admin%2fmessages", "//admin/messages", "/admin/./messages", "/admin/../admin/messages", "/ADMIN/messages", "/admin/messages/", "/%61dmin/messages", "/ad%6din/messages", "/admin/%6dessages", "/admin;x/messages", "/admin%5cmessages", "/admin/messages%00", "/admin/messages/..;/messages"];
    for (const v of variants) {
      for (const cookie of [null, fake]) {
        const res = await rawRequest(v, { headers: [...(cookie ? [["cookie", cookie]] : []), ["rsc", "1"], ["next-router-state-tree", tree], ["next-url", "/admin/pages"]] });
        if (res.status === 200 && res.body.length > 1000 && /Messages|messages/.test(res.body)) bypass.push(`${v} ${cookie ? "faux cookie" : "sans cookie"} → 200 ${res.body.length} o`);
        else if (res.status === 308 || res.status === 307) {
          const loc = res.headers.location ?? "";
          if (/^https?:\/\/(?!127\.0\.0\.1)/.test(loc) || /^\/\//.test(loc)) bypass.push(`${v} → Location ${loc}`);
        }
      }
    }
    ok("S57d chemins encodés / casse / double barre / point-virgule / null / « .. » (avec faux cookie ou sans cookie) : aucun contenu d'admin", bypass.length === 0, bypass.join(" ; "));
    const sub = [];
    for (const v of ["middleware", "src/middleware", "proxy", "src/proxy", "pages/_middleware"]) {
      const res = await rawRequest("/admin/messages", { headers: [["x-middleware-subrequest", Array(6).fill(v).join(":")]] });
      if (res.status === 200) sub.push(`${v} → ${res.status}`);
    }
    ok("S57e en-tête X-Middleware-Subrequest (contournement de middleware de Next) : /admin/messages n'est jamais servi (pas de 200)", sub.length === 0, sub.join(" ; "));
    // Pages de l'admin hors proxy : /admin/api/* se garde seul.
    const apis = [];
    for (const [m, p] of [["GET", "/admin/api/cadres"], ["GET", "/admin/api/fonts/recent"], ["GET", "/admin/api/editeur/session"], ["GET", "/admin/api/themes/pro/export"], ["POST", "/admin/api/upload"], ["POST", "/admin/api/upload/init"], ["GET", "/api/admin/sauvegardes/x.zip"], ["POST", "/admin/api/themes/import"]]) {
      const res = await rawRequest(p, { method: m, headers: [["cookie", fake], ["origin", BASE], ["content-length", "0"]] });
      const harmless = res.status === 200 && /^\{"admin":false\}$/.test(res.body.trim());
      if (![401, 403, 404, 405, 307, 400].includes(res.status) && !harmless) apis.push(`${m} ${p} → ${res.status}`);
      if (res.status === 200 && !harmless) apis.push(`${m} ${p} → 200 ${res.body.slice(0, 40)}`);
    }
    ok("S57f routes /admin/api/* et /api/admin/* (hors proxy) avec un faux cookie : refusées", apis.length === 0, apis.join(" ; "));
    await stop(s);
  }
}

/* ------------------------------------------------------------ #56 LEGACY_SKIP -- */
if (run(56)) {
  console.log("\n== #56 /admin testé avant LEGACY_SKIP, liste fermée des chemins hors proxy");
  const { s, up } = await boot("b56");
  if (up) {
    const g = async (p, o = {}) => {
      const r = await http(p, o);
      await r.arrayBuffer();
      return r;
    };
    let r = await g("/admin/x.y");
    ok("S56a /admin/x.y sans session → la garde de l'admin répond (307 vers la connexion)", r.status === 307 && (r.headers.get("location") ?? "").endsWith("/admin/connexion"), `${r.status}`);
    r = await g("/admin/themes/a.b");
    ok("S56b /admin/themes/a.b (segment à point) sans session → 307", r.status === 307, `${r.status}`);
    const dotted = [];
    for (const u of ["/fr/a.b", "/fr/x.1", "/en/a.b", "/fr/personnages.html", "/wp-login.php"]) {
      let res = await g(u);
      if (res.status === 307 || res.status === 308) res = await g(res.headers.get("location") ?? "/");
      if (res.status !== 404 || !/no-store/.test(res.headers.get("cache-control") ?? "") || res.headers.get("x-nextjs-cache")) dotted.push(`${u} ${res.status} ${res.headers.get("cache-control")} ${res.headers.get("x-nextjs-cache")}`);
    }
    ok("S56c chemins à point (/fr/a.b, /fr/x.1, /wp-login.php…) → vrai 404 no-store, jamais rendus ni mis en cache ISR", dotted.length === 0, dotted.join(" ; "));
    const statuses = [];
    for (let i = 0; i < 12; i++) statuses.push((await g(`/fr/secua-${i}.zz`)).headers.get("x-nextjs-cache") ?? "-");
    info("S56d 12 chemins /fr/secua-N.zz distincts : en-tête x-nextjs-cache", statuses.join(","));
    // Régression : tout fichier de public/ doit toujours être servi (hors admin/tuto, désormais derrière la garde).
    const walk = (d) => readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : [path.join(d, f)]));
    const pub = walk(path.join(ROOT, "public")).map((f) => "/" + path.relative(path.join(ROOT, "public"), f).split(path.sep).map(encodeURIComponent).join("/"));
    const missing = [];
    for (const u of pub) {
      if (u.startsWith("/admin/")) continue;
      const res = await g(u);
      if (res.status !== 200) missing.push(`${u} ${res.status}`);
    }
    ok(`S56e les ${pub.filter((u) => !u.startsWith("/admin/")).length} fichiers de public/ (hors admin/) sont toujours servis (200)`, missing.length === 0, missing.slice(0, 6).join(" ; "));
    const tuto = pub.filter((u) => u.startsWith("/admin/")).slice(0, 2);
    for (const u of tuto) info(`S56f image du tuto sans session`, `${u} → ${(await g(u)).status} (fix : 307 ; baseline : 200 publique)`);
    const roots = [];
    for (const u of ["/favicon.ico", "/robots.txt", "/sitemap.xml", "/manifest.webmanifest", "/site-icon/icon.svg", "/site-icon/32.png", "/fonts/Figtree.ttf", "/kit/Figtree.ttf", "/media/x.svg"]) {
      const res = await g(u);
      roots.push(`${u} ${res.status}`);
    }
    info("S56g fichiers et routes de la racine", roots.join(" ; "));
    await stop(s);
  }
}

/* ------------------------------------------------------------ #52 redirection ouverte -- */
if (run(52)) {
  console.log("\n== #52 redirection ouverte (« //… », « /\\… », « %2f%2f », « /%5c »)");
  {
    // /api/theme-preview n'existe qu'en développement (`next dev` ; PORTFOLIO_DEV=1 avec #63) : réponse 404 dans un build de production.
    const dir = fresh("d52");
    const s = startDev(dir, { ...baseEnv, PORTFOLIO_DEV: "1" });
    const up = await s.ready;
    if (!up) info("S52a `next dev` non démarré", s.text().slice(-300));
    else {
      await http("/api/theme-preview?id=pro&redirect=/fr").then((x) => x.text()); // compile la route (dev)
      await http("/api/theme-preview?id=").then((x) => x.text());
      const probes = ["/.//evil.example", "/./\\evil.example", "/%2e//evil.example", "/././/evil.example/a?b=1", "//evil.example", "/\\evil.example", "/\t/evil.example", "https://evil.example/x", "/%2f/evil.example", "/%5c/evil.example", "/..//evil.example", "/a/../..//evil.example", "/.%2f/evil.example", "\\\\evil.example", "/fr/page"];
      const bad = [];
      const seen = [];
      for (const p of probes) {
        const res = await rawRequest(`/api/theme-preview?id=pro&redirect=${encodeURIComponent(p)}`);
        const loc = res.headers.location ?? "";
        seen.push(`${p} → ${res.status} ${loc}`);
        if (/^[/\\]{2}/.test(loc) || /^[/\\][/\\]/.test(loc.replace(/\t/g, "")) || /^[a-z][a-z0-9+.-]*:/i.test(loc)) bad.push(`${p} → ${loc}`);
      }
      ok("S52a /api/theme-preview?redirect=… : aucun Location protocole-relatif (« //x », « /\\x ») ni absolu vers un autre site", bad.length === 0, bad.join(" ; "));
      info("S52a’ détail", seen.slice(0, 8).join(" | "));
      const refBad = [];
      for (const p of ["/.//evil.example", `http://127.0.0.1:${PORT}/.//evil.example`]) {
        const res = await rawRequest("/api/theme-preview?id=pro", { headers: [["referer", p]] });
        const loc = res.headers.location ?? "";
        if (/^[/\\]{2}/.test(loc)) refBad.push(`Referer ${p} → ${loc}`);
      }
      ok("S52b repli sur l'en-tête Referer : même garantie", refBad.length === 0, refBad.join(" ; "));
      await stop(s);
    }
  }
  {
    // Redirections du proxy et de next-intl sur les chemins « // », « /\ », « %2f%2f », « /%5c » (serveur de production normal).
    const { s, up } = await boot("b52b");
    if (up) {
      const bad = [];
      const rows = [];
      for (const p of ["//evil.example", "//evil.example/fr", "/\\evil.example", "/%5cevil.example", "/%2f%2fevil.example", "/%2fevil.example", "/fr//evil.example", "/fr/%2f%2fevil.example", "/en//evil.example", "///evil.example", "/fr/\\evil.example"]) {
        for (const cookie of [null, "lang-choice=en", "portfolio-lang=en"]) {
          const res = await rawRequest(p, { headers: cookie ? [["cookie", cookie]] : [] });
          const loc = res.headers.location ?? "";
          rows.push(`${p}${cookie ? " [" + cookie + "]" : ""} → ${res.status} ${loc}`);
          if (/^[/\\]{2}/.test(loc) || /^https?:\/\/(?!127\.0\.0\.1)/i.test(loc)) bad.push(`${p} → ${loc}`);
        }
      }
      ok("S52c redirections du proxy / next-intl sur « //x », « /\\x », « %2f%2fx », « /%5cx » (avec et sans cookie de langue) : jamais vers un autre site", bad.length === 0, bad.join(" ; "));
      info("S52c’ échantillon", rows.slice(0, 4).join(" | "));
      const hostile = await rawRequest("/admin", { headers: [["host", "evil.example"]] });
      info("S52d /admin sans session avec Host: evil.example (hors périmètre : l'hôte vient du reverse proxy)", `${hostile.status} ${hostile.headers.location ?? ""}`);
      await stop(s);
    }
  }
}

console.log(`\nsecuA : ${results.filter(([, p]) => p).length} PASS, ${failures} FAIL`);
if (failures) console.log("échecs : " + results.filter(([, p]) => !p).map(([l]) => l.split(" ")[0]).join(" "));
process.exit(failures ? 1 : 0);
