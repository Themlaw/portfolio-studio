#!/usr/bin/env node
/**
 * Lot 118 (urgent) : sauvegardes automatiques, bout en bout sur un VRAI serveur de production (lancé par ce script, base neuve).
 * Réglages : BACKUP_QUIET_SEC=6, BACKUP_MAX_HOURS=0.005 (18 s), BACKUP_KEEP=3, BACKUP_KEEP_DAYS=7, BACKUP_ALERT_GRACE_SEC=8.
 *  1. Première sauvegarde au démarrage ; aucun reste d'instantané (`snapshot-*`) ensuite.
 *  2. Un geste de l'artiste par l'envoi d'une image (route d'écriture enveloppée par le journal) : l'écran Sauvegardes voit l'activité,
 *     une sauvegarde « calme » suit la quiétude.
 *  3. Écritures de fond (toutes les 0,8 s, 40 s, SANS geste) : aucune sauvegarde ; elles cessent : une « calme ». Édition continue de 50 s
 *     (plafond 18 s) : des sauvegardes « delai », aucune « calme » avant la pause. Conservation : 3 dernières + une par jour sur 7 jours
 *     (archives des jours passés posées dans le dossier), marques « récente » / « du jour » dans l'admin.
 *  4. Une sauvegarde due qui ne peut pas se faire (dossier en lecture seule) : l'écran Sauvegardes l'affiche en rouge, le journal porte
 *     « [backup] ALERTE (retard) » avec les tables qui ont bougé ; le dossier redevient inscriptible : la sauvegarde part, l'alerte disparaît.
 *  5. Aucun reste d'instantané à la fin.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… PORT=… [STANDALONE_DIR=…] node scripts/e2e-backup118.mjs
 */
import { spawn } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
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
// La rotation supprime les plus anciennes : on compare des ENSEMBLES de noms, pas des effectifs.
const snap = () => new Set(archives());
const fresh = (before) => archives().filter((n) => !before.has(n));
const reasons = async (before) => {
  const out = [];
  for (const n of fresh(before)) out.push(await reasonOf(n));
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
    BACKUP_KEEP: "3",
    BACKUP_KEEP_DAYS: "7",
    BACKUP_MAX_HOURS: "0.005",
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

  /* 3 : écritures de fond sans geste de l'artiste : AUCUNE sauvegarde tant qu'elles durent (pas de « bruit »), puis une « calme » */
  await sleep(12000); // plus de geste, plus de traitement de l'image envoyée
  const n3 = snap();
  noise = new Database(path.join(DATA, "portfolio.db"));
  noise.pragma("busy_timeout = 5000");
  const write = noise.prepare("insert or replace into settings (key, value) values ('bruit118', ?)");
  const noiseEnd = Date.now() + 40000;
  while (Date.now() < noiseEnd) {
    write.run(String(Date.now()));
    await sleep(800);
  }
  const during = await reasons(n3);
  ok("3. 40 s d'écritures de fond sans geste de l'artiste (plafond 18 s, quiétude 6 s) : aucune sauvegarde", during.length === 0, JSON.stringify(during));
  noise.close();
  noise = null;
  ok("3. le fond s'arrête : une « calme » part", await waitFor(() => fresh(n3).length > 0, 30000));
  ok("3. raison « calme »", (await reasonOf(archives().at(-1))) === "calme", String(await reasonOf(archives().at(-1))));

  /* 3b : modification continue de l'artiste, plus longue que le plafond : sauvegarde « delai » sans attendre la pause */
  await sleep(10000);
  const n3b = snap();
  const burstEnd = Date.now() + 50000;
  while (Date.now() < burstEnd) {
    await upload(cookie); // un geste toutes les ~3 s : jamais 6 s de calme
    await sleep(2500);
  }
  const burst = await reasons(n3b);
  info("3b. sauvegardes pendant l'édition continue", burst);
  ok("3b. édition continue de 50 s (plafond 18 s) : au moins deux sauvegardes « delai », aucune « calme » avant la pause", burst.filter((r) => r === "delai").length >= 2 && !burst.includes("calme"), JSON.stringify(burst));
  const n3c = snap();
  ok("3b. la pause venue, une « calme » ferme la marche", await waitFor(() => fresh(n3c).length > 0, 45000));
  await sleep(4000);
  ok("3b. le tableau Sauvegardes affiche le plafond réglé", /data-testid="reglage-delai"/.test(await (await fetch(`${BASE}/admin/sauvegardes`, { headers: { cookie } })).text()));

  /* 3c : conservation : les 3 dernières + la dernière de chaque jour (Paris) sur 7 jours */
  await sleep(10000);
  const dayOf = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  const instantOf = (n) => {
    const m = /^portfolio-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(n);
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  };
  const nameAt = (ms) => {
    const d = new Date(ms);
    const p2 = (n) => String(n).padStart(2, "0");
    return `portfolio-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.tar.gz`;
  };
  const DAY = 86_400_000;
  const base = path.join(BACKUP_DIR, archives().at(-1));
  const seeded = [Date.now() - 12 * DAY, Date.now() - 5 * DAY - 3 * 3_600_000, Date.now() - 5 * DAY, Date.now() - 2 * DAY, Date.now() - DAY - 2 * 3_600_000, Date.now() - DAY].map(nameAt);
  for (const n of seeded) copyFileSync(base, path.join(BACKUP_DIR, n));
  await sleep(1500);
  await upload(cookie); // un geste : une « calme » suit, qui range le dossier
  const beforeRot = new Set(archives());
  ok("3c. une sauvegarde suit le geste (la rotation passe)", await waitFor(() => archives().some((n) => !beforeRot.has(n)), 45000));
  await sleep(1500);
  const all = new Set([...beforeRot, ...archives()]);
  const sortedAll = [...all].sort();
  const expected = new Set(sortedAll.slice(-3));
  const lastOf = new Map();
  for (const n of sortedAll) lastOf.set(dayOf(instantOf(n)), n);
  const today = dayOf(Date.now());
  for (let i = 0; i < 7; i++) {
    const [y, m, d] = today.split("-").map(Number);
    const day = new Date(Date.UTC(y, m - 1, d - i, 12)).toISOString().slice(0, 10);
    if (lastOf.has(day)) expected.add(lastOf.get(day));
  }
  const got = archives();
  ok("3c. dossier = les 3 dernières + la dernière de chaque jour sur 7 jours (celle de il y a 12 jours est supprimée)", got.length === expected.size && got.every((n) => expected.has(n)) && !got.includes(seeded[0]), `reste ${got.join(", ")} ; attendu ${[...expected].join(", ")}`);
  const html = await (await fetch(`${BASE}/admin/sauvegardes`, { headers: { cookie } })).text();
  const badges = [...html.matchAll(/data-testid="conservation" data-kind="(\w+)" data-day="([\d-]+)"/g)].map((m) => m[1]);
  ok("3c. l'admin marque chaque archive : 3 « récentes », les autres « du jour »", badges.length === got.length && badges.filter((k) => k === "recente").length === 3 && badges.filter((k) => k === "jour").length === got.length - 3, JSON.stringify(badges));
  ok("3c. l'admin dit la règle de conservation", /Les 3 dernières, plus la dernière de chacun des 7 derniers jours/.test(html.replace(/<!-- -->/g, "")));
  noise = null;
  await sleep(2000);
  ok("3. plus aucune alerte quand tout va bien", (await screen(cookie)).alert === null);

  /* 4 : sauvegarde due qui ne peut pas se faire */
  const n4 = snap();
  chmodSync(BACKUP_DIR, 0o500);
  noise = new Database(path.join(DATA, "portfolio.db"));
  noise.prepare("insert or replace into settings (key, value) values ('bruit118', ?)").run("alerte");
  noise.close();
  noise = null;
  ok("4. l'écran Sauvegardes affiche l'alerte rouge (retard)", await waitFor(async () => (await screen(cookie)).alert === "retard", 60000, 1000), JSON.stringify(await screen(cookie)));
  const alertLogged = await waitFor(() => /\[backup\] ALERTE \(retard\)[^\n]*tables qui ont bougé : [^\n]*settings/.test(server.log()), 20000, 500);
  ok("4. le journal porte « [backup] ALERTE (retard) » avec le détail des tables", alertLogged, server.log().split("\n").filter((l) => l.includes("ALERTE")).join(" | "));
  ok("4. aucune sauvegarde n'a été faite entre-temps", fresh(n4).length === 0);
  chmodSync(BACKUP_DIR, 0o700);
  ok("4. le dossier redevient inscriptible : la sauvegarde part (reprise après échec)", await waitFor(() => fresh(n4).length > 0, 100000, 1000));
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
