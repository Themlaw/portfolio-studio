#!/usr/bin/env node
/**
 * Lot 118 (urgent) : sauvegardes automatiques, bout en bout sur un VRAI serveur de production (lancé par ce script, base neuve).
 * Réglages : BACKUP_QUIET_SEC=6, BACKUP_ALERT_GRACE_SEC=8.
 *  1. Première sauvegarde au démarrage ; aucun reste d'instantané (`snapshot-*`) ensuite.
 *  2. Un geste de l'artiste par l'envoi d'une image (route d'écriture enveloppée par le journal) : l'écran Sauvegardes voit l'activité,
 *     une sauvegarde « calme » suit la quiétude.
 *  3. Le bruit : la base change toutes les 0,8 s SANS geste de l'artiste pendant 55 s (autre connexion, comme les traitements de fond) :
 *     des sauvegardes « bruit » partent (au plus une par 18 s), aucune « calme » ; le bruit cesse : une « calme » ferme la marche.
 *  4. Une sauvegarde due qui ne peut pas se faire (dossier en lecture seule) : l'écran Sauvegardes l'affiche en rouge, le journal porte
 *     « [backup] ALERTE (retard) » avec les tables qui ont bougé ; le dossier redevient inscriptible : la sauvegarde part, l'alerte disparaît.
 *  5. Aucun reste d'instantané à la fin.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… PORT=… [STANDALONE_DIR=…] node scripts/e2e-backup118.mjs
 */
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import sharp from "sharp";

import { readManifest } from "./restore-backup.mjs";

const PORT = Number(process.env.PORT ?? 3001) + 50; // le serveur de la suite (PORT) et les autres suites en parallèle gardent leurs ports
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, timeout = 60000, step = 400) => {
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(step)) if (await fn()) return true;
  return false;
};
let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const info = (label, v) => console.log(`INFO ${label} : ${typeof v === "string" ? v : JSON.stringify(v)}`);

const tmpRoot = mkdtempSync(path.join(process.env.TEST_TMP ?? tmpdir(), "pf-e2e-backup118-"));
const DATA = path.join(tmpRoot, "data");
const BACKUP_DIR = path.join(DATA, "backup");
const archives = () => (existsSync(BACKUP_DIR) ? readdirSync(BACKUP_DIR).filter((n) => /^portfolio-\d{8}-\d{6}(-\d+)?\.tar\.gz$/.test(n)).sort() : []);
const reasonOf = async (name) => (await readManifest(path.join(BACKUP_DIR, name)))?.reason ?? null;
const reasons = async (from = 0) => {
  const out = [];
  for (const n of archives().slice(from)) out.push(await reasonOf(n));
  return out;
};

function startServer() {
  const SA = process.env.STANDALONE_DIR ?? path.join(process.cwd(), ".next/standalone");
  const env = {
    ...process.env,
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: String(PORT),
    DATA_DIR: DATA,
    PUBLIC_BASE_URL: BASE,
    WITH_BACKUP: "1",
    BACKUP_QUIET_SEC: "6",
    BACKUP_KEEP: "30",
    BACKUP_ALERT_GRACE_SEC: "8",
  };
  const out = [];
  const child = spawn("node", ["server.js"], { cwd: SA, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => out.push(String(d)));
  child.stderr.on("data", (d) => out.push(String(d)));
  return { child, log: () => out.join(""), stop: () => { try { process.kill(-child.pid, "SIGTERM"); } catch {} } };
}

async function login() {
  const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
  });
  if (!res.ok) throw new Error(`connexion refusée (${res.status})`);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
let n = 0;
async function upload(cookie) {
  n++;
  const png = await sharp({ create: { width: 96, height: 64, channels: 3, background: { r: (n * 53) % 256, g: (Date.now() / 7) % 256, b: (n * 97) % 256 } } }).png().toBuffer();
  const form = new FormData();
  form.set("file", new Blob([png], { type: "image/png" }), `sauvegarde118-${Date.now()}-${n}.png`);
  const res = await fetch(`${BASE}/admin/api/upload`, { method: "POST", headers: { cookie, origin: BASE }, body: form });
  const body = await res.json();
  if (!body.ok) throw new Error(`envoi refusé : ${JSON.stringify(body)}`);
}
/** Écran Sauvegardes (HTML rendu par le serveur) : alerte rouge et activité vue. */
async function screen(cookie) {
  const html = await (await fetch(`${BASE}/admin/sauvegardes`, { headers: { cookie } })).text();
  const alert = /data-testid="alerte-sauvegarde"[^>]*data-kind="(\w+)"/.exec(html);
  const act = /data-testid="activite-sauvegarde"([^>]*)>/.exec(html)?.[1] ?? "";
  const attr = (k) => new RegExp(`data-${k}="([^"]*)"`).exec(act)?.[1] ?? "";
  return { alert: alert ? alert[1] : null, lastUser: attr("last-user"), lastChange: attr("last-change"), changes: attr("changes") };
}

const server = startServer();
let noise = null;
try {
  ok("0. serveur prêt", await waitFor(async () => (await fetch(`${BASE}/fr`).catch(() => ({ status: 0 }))).status === 200, 90000));
  /* 1 */
  ok("1. première sauvegarde au démarrage", await waitFor(() => archives().length >= 1, 60000));
  ok("1. raison « premier »", (await reasonOf(archives()[0])) === "premier");
  const cookie = await login();

  /* 2 */
  await sleep(1500);
  const before = archives().length;
  await upload(cookie);
  const s2 = await screen(cookie);
  ok("2. l'écran Sauvegardes voit le geste de l'artiste (activité notée par le journal)", s2.lastUser !== "" && Number(s2.lastUser) > Date.now() - 60000, JSON.stringify(s2));
  ok("2. une sauvegarde « calme » suit la quiétude", await waitFor(() => archives().length > before, 45000));
  ok("2. raison « calme »", (await reasonOf(archives().at(-1))) === "calme", String(await reasonOf(archives().at(-1))));

  /* 3 : bruit */
  await sleep(9000); // plus de geste depuis plus que la quiétude
  const n3 = archives().length;
  noise = new Database(path.join(DATA, "portfolio.db"));
  noise.pragma("busy_timeout = 5000");
  const write = noise.prepare("insert or replace into settings (key, value) values ('bruit118', ?)");
  const noiseEnd = Date.now() + 55000;
  while (Date.now() < noiseEnd) {
    write.run(String(Date.now()));
    await sleep(800);
  }
  const during = await reasons(n3);
  info("3. sauvegardes pendant le bruit", during);
  ok("3. des sauvegardes « bruit » partent pendant le bruit (au plus une par 18 s : 2 à 4 en 55 s)", during.filter((r) => r === "bruit").length >= 2 && during.filter((r) => r === "bruit").length <= 4, JSON.stringify(during));
  ok("3. aucune « calme » tant que le bruit dure", !during.includes("calme"), JSON.stringify(during));
  const n3b = archives().length;
  ok("3. le bruit cesse : une dernière sauvegarde ferme la marche", await waitFor(() => archives().length > n3b, 30000));
  ok("3. raison « calme » une fois le bruit fini", (await reasonOf(archives().at(-1))) === "calme", String(await reasonOf(archives().at(-1))));
  noise.close();
  noise = null;
  await sleep(2000);
  ok("3. plus aucune alerte quand tout va bien", (await screen(cookie)).alert === null);

  /* 4 : sauvegarde due qui ne peut pas se faire */
  const n4 = archives().length;
  chmodSync(BACKUP_DIR, 0o500);
  noise = new Database(path.join(DATA, "portfolio.db"));
  noise.prepare("insert or replace into settings (key, value) values ('bruit118', ?)").run("alerte");
  noise.close();
  noise = null;
  ok("4. l'écran Sauvegardes affiche l'alerte rouge (retard)", await waitFor(async () => (await screen(cookie)).alert === "retard", 60000, 1000), JSON.stringify(await screen(cookie)));
  const alertLogged = await waitFor(() => /\[backup\] ALERTE \(retard\)[^\n]*tables qui ont bougé : [^\n]*settings/.test(server.log()), 20000, 500);
  ok("4. le journal porte « [backup] ALERTE (retard) » avec le détail des tables", alertLogged, server.log().split("\n").filter((l) => l.includes("ALERTE")).join(" | "));
  ok("4. aucune sauvegarde n'a été faite entre-temps", archives().length === n4);
  chmodSync(BACKUP_DIR, 0o700);
  ok("4. le dossier redevient inscriptible : la sauvegarde part (reprise après échec)", await waitFor(() => archives().length > n4, 100000, 1000));
  ok("4. et l'alerte disparaît", await waitFor(async () => (await screen(cookie)).alert === null, 30000, 1000));

  /* 5 */
  ok("5. aucun reste d'instantané dans le dossier des sauvegardes", await waitFor(() => readdirSync(BACKUP_DIR).every((f) => !f.startsWith("snapshot-")), 10000), readdirSync(BACKUP_DIR).filter((f) => f.startsWith("snapshot-")).join(","));
} catch (error) {
  failures++;
  console.log("FAIL exception —", error);
} finally {
  try {
    noise?.close();
  } catch {}
  try {
    chmodSync(BACKUP_DIR, 0o700);
  } catch {}
  server.stop();
  await sleep(500);
  rmSync(tmpRoot, { recursive: true, force: true });
}
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
