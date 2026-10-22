#!/usr/bin/env node
/**
 * Lot 50 « sauvegardes automatiques » (ticket 36) sur un VRAI serveur, sans navigateur. Le serveur de la suite est lancé avec
 * WITH_BACKUP=1 BACKUP_QUIET_SEC=4 (voir `backup50` dans scripts/test-all-local.sh).
 *  1. Première sauvegarde au démarrage (aucune n'existe), journal « sauvegardes activées ».
 *  2. Modification par l'API d'envoi (comme l'artiste) : une sauvegarde part après la quiétude ; l'archive contient une base qui
 *     s'ouvre et porte la modification, l'ORIGINAL du média (et pas ses variantes), un manifest.
 *  3. Rotation à 3 après plusieurs modifications ; aucun .tmp ; les plus récentes restent.
 *  4. Aucune modification : aucune nouvelle sauvegarde.
 *  5. Restauration de bout en bout (mode start) : archive extraite par le script dans un dossier neuf, serveur démarré SANS
 *     WITH_BACKUP : les variantes manquantes sont régénérées et servies ; aucun dossier backup/ n'est créé.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… PORT=… node scripts/e2e-backup50.mjs
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import sharp from "sharp";

import { extractAll, readManifest, restore } from "./restore-backup.mjs";

const BASE = process.env.BASE ?? "http://localhost:3630";
const DATA = process.env.DATA_DIR ?? "data";
const PORT = Number(process.env.PORT ?? new URL(BASE).port);
const QUIET_S = Number(process.env.BACKUP_QUIET_SEC ?? 4);
const BACKUP_DIR = path.join(DATA, "backup");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, timeout = 60000) => {
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(400)) if (await fn()) return true;
  return false;
};
let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const info = (label, v) => console.log(`INFO ${label} : ${typeof v === "string" ? v : JSON.stringify(v)}`);

const archives = (dir = BACKUP_DIR) => (existsSync(dir) ? readdirSync(dir).filter((n) => /^portfolio-\d{8}-\d{6}(-\d+)?\.tar\.gz$/.test(n)).sort() : []);
const q = (dataDir, sql, ...args) => {
  const db = new Database(path.join(dataDir, "portfolio.db"), { readonly: true });
  try {
    return db.prepare(sql).get(...args);
  } finally {
    db.close();
  }
};

async function login(base) {
  const res = await fetch(`${base}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: base },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
  });
  if (!res.ok) throw new Error(`connexion refusée (${res.status})`);
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

let n = 0;
/** Envoie une image neuve (contenu unique) par l'API d'envoi. Retourne { name, id }. */
async function upload(base, cookie) {
  n++;
  const name = `sauvegarde50-${Date.now()}-${n}.png`;
  const png = await sharp({ create: { width: 96, height: 64, channels: 3, background: { r: (n * 53) % 256, g: (Date.now() / 7) % 256, b: (n * 97) % 256 } } }).png().toBuffer();
  const form = new FormData();
  form.set("file", new Blob([png], { type: "image/png" }), name);
  const res = await fetch(`${base}/admin/api/upload`, { method: "POST", headers: { cookie, origin: base }, body: form });
  const body = await res.json();
  if (!body.ok) throw new Error(`envoi refusé : ${JSON.stringify(body)}`);
  return { name, id: body.media.id };
}

/** Serveur standalone à part (port, dossier de données, environnement). */
function startServer(port, dataDir) {
  const SA = process.env.STANDALONE_DIR ?? path.join(process.cwd(), ".next/standalone");
  const env = { ...process.env, NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: String(port), DATA_DIR: dataDir, PUBLIC_BASE_URL: `http://localhost:${port}` };
  for (const k of Object.keys(env)) if (k === "WITH_BACKUP" || k.startsWith("BACKUP_")) delete env[k];
  const out = [];
  const child = spawn("node", ["server.js"], { cwd: SA, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => out.push(String(d)));
  child.stderr.on("data", (d) => out.push(String(d)));
  return { child, log: () => out.join(""), stop: () => { try { process.kill(-child.pid, "SIGTERM"); } catch {} } };
}

const tmpRoot = mkdtempSync(path.join(process.env.TEST_TMP ?? tmpdir(), "pf-e2e-backup50-"));
let second = null;
try {
  /* 1. première sauvegarde au démarrage */
  ok("1. première sauvegarde au démarrage (aucune n'existait)", await waitFor(() => archives().length >= 1, 60000), `dossier : ${existsSync(BACKUP_DIR) ? readdirSync(BACKUP_DIR).join(",") : "absent"}`);
  const logFile = path.join(process.env.RUNNER_TEMP ?? "", "logs", "backup50-server.log");
  if (process.env.RUNNER_TEMP && existsSync(logFile)) {
    const log = readFileSync(logFile, "utf8");
    ok("1. journal : « sauvegardes activées » au démarrage, une ligne par sauvegarde", /\[backup\] sauvegardes activées/.test(log) && /\[backup\] portfolio-\d{8}-\d{6}\.tar\.gz : .* gardée\(s\)/.test(log), log.split("\n").filter((l) => l.includes("[backup]")).join(" | "));
  } else info("journal du serveur", "introuvable, vérification ignorée");

  const cookie = await login(BASE);

  /* 2. une modification par l'API, puis la quiétude */
  const count0 = archives().length;
  const first = await upload(BASE, cookie);
  const ready = await waitFor(() => q(DATA, "select status from media where id = ?", first.id)?.status === "ready", 60000);
  ok("2. image envoyée et traitée", ready);
  const t0 = Date.now();
  ok("2. une sauvegarde part après la quiétude", await waitFor(() => archives().length > count0, (QUIET_S + 40) * 1000));
  info("délai modification → archive", `${Math.round((Date.now() - t0) / 1000)} s (quiétude ${QUIET_S} s)`);
  // la sauvegarde part après le DERNIER geste : l'archive la plus récente doit porter l'image (la copie peut précéder la fin du traitement, pas l'envoi)
  await sleep(1500);
  const latest = path.join(BACKUP_DIR, archives().at(-1));
  const out1 = path.join(tmpRoot, "x1");
  mkdirSync(out1);
  const files = await extractAll(latest, out1);
  const row = q(out1, "select key, original_name, status from media where original_name = ?", first.name);
  ok("2. archive : la base s'ouvre et contient la modification", !!row, `fichiers : ${files.join(",")}`);
  ok("2. archive : l'original du média est présent", !!row && files.includes(`media/${row.key}`), `clé ${row?.key}`);
  ok("2. archive : aucune variante régénérable (img/, cache/)", files.every((f) => !f.startsWith("media/img/") && !f.startsWith("cache/")), files.filter((f) => f.startsWith("media/img/")).join(","));
  const man = await readManifest(latest);
  ok("2. manifest : version, date, nombre de médias, taille", typeof man.version === "string" && man.version !== "" && !Number.isNaN(Date.parse(man.createdAt)) && man.mediaCount >= 1 && man.bytes > 0, JSON.stringify(man));
  ok("2. aucun fichier temporaire dans backup/", readdirSync(BACKUP_DIR).every((f) => !f.endsWith(".tmp")), readdirSync(BACKUP_DIR).join(","));

  /* 3. rotation à 3 */
  const seen = new Set(archives());
  for (let i = 0; i < 4; i++) {
    const before = archives().length;
    const lastName = archives().at(-1);
    await upload(BASE, cookie);
    const got = await waitFor(() => archives().at(-1) !== lastName && !readdirSync(BACKUP_DIR).some((f) => f.endsWith(".tmp")), (QUIET_S + 60) * 1000);
    if (!got) ok(`3. sauvegarde n° ${i + 1} après une nouvelle modification`, false, `avant : ${before}, dossier : ${readdirSync(BACKUP_DIR).join(",")}`);
    for (const a of archives()) seen.add(a);
    await sleep(1200);
  }
  const kept = archives();
  ok("3. rotation : 3 sauvegardes gardées (BACKUP_KEEP=3)", kept.length === 3, kept.join(","));
  ok("3. rotation : plus de 3 ont existé, les plus anciennes sont parties", seen.size > 3 && kept.every((k) => [...seen].sort().slice(-3).includes(k)), `vues : ${[...seen].join(",")}`);
  ok("3. rotation : aucun .tmp", readdirSync(BACKUP_DIR).every((f) => !f.endsWith(".tmp")));

  /* 4. aucune modification : aucune sauvegarde */
  await sleep(1500);
  const quietBefore = archives();
  await sleep(Math.max(12000, QUIET_S * 3000));
  ok("4. aucune modification : aucune nouvelle sauvegarde", JSON.stringify(archives()) === JSON.stringify(quietBefore), `${quietBefore.join(",")} → ${archives().join(",")}`);

  /* 5. restauration de bout en bout dans un dossier neuf, serveur SANS WITH_BACKUP */
  if (process.env.BATT_SERVER === "start") {
    const dataB = path.join(tmpRoot, "data-restauree");
    mkdirSync(dataB, { recursive: true });
    const archive = path.join(BACKUP_DIR, archives().at(-1));
    const res = await restore(archive, dataB);
    ok("5. restauration : fichiers extraits, manifest posé à la racine", res.files > 2 && existsSync(path.join(dataB, "manifest.json")) && !existsSync(path.join(dataB, "backup")));
    const portB = PORT + 1;
    second = startServer(portB, dataB);
    const baseB = `http://localhost:${portB}`;
    const up = await waitFor(async () => (await fetch(`${baseB}/fr`).catch(() => null))?.status === 200, 90000);
    ok("5. serveur sur les données restaurées démarré", up, second.log().slice(-600));
    ok("5. restauration détectée au démarrage (journal)", /\[backup\] restauration détectée : \d+ média\(s\) remis en file/.test(second.log()), second.log().slice(-600));
    const all = await waitFor(() => q(dataB, "select count(*) n from media where status != 'ready'").n === 0 && q(dataB, "select count(*) n from jobs where kind = 'image' and status in ('queued','running')").n === 0, 120000);
    ok("5. variantes régénérées à partir des originaux", all, `${JSON.stringify(q(dataB, "select group_concat(id || ':' || status || ':' || coalesce(error,''), ' | ') s from media where status != 'ready'"))} ${JSON.stringify(q(dataB, "select group_concat(id || ':' || kind || ':' || status || ':' || attempts, ' | ') s from jobs"))} ${second.log().slice(-800)}`);
    const m = q(dataB, "select variants from media where original_name = ?", first.name);
    const vkey = m && JSON.parse(m.variants).files[0].key;
    const r = vkey ? await fetch(`${baseB}/media/${vkey}`) : null;
    ok("5. une variante régénérée est servie (200)", r?.status === 200, `${vkey} → ${r?.status}`);
    await sleep(QUIET_S * 2000);
    ok("5. WITH_BACKUP absent : ni dossier backup/ ni journal [backup] de sauvegarde", !existsSync(path.join(dataB, "backup")) && !/sauvegardes activées/.test(second.log()), second.log().slice(-400));
    second.stop();
    second = null;
  } else info("5. restauration de bout en bout", "ignorée hors mode start (BATT_SERVER=start) : couverte par test-backup.mjs");
} catch (error) {
  failures++;
  console.log(`FAIL erreur inattendue — ${error?.stack ?? error}`);
} finally {
  second?.stop();
  rmSync(tmpRoot, { recursive: true, force: true });
}
console.log(failures ? `${failures} échec(s)` : "Tout est vert");
process.exit(failures ? 1 : 0);
