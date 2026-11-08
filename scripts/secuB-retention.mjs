#!/usr/bin/env node
/**
 * Sécurité v1.0 : #4, rétention des sauvegardes face à une session volée (régler « garder 1 » puis « Sauvegarder maintenant »
 * en boucle ; remplir le disque avec 30 copies). Vraies archives (runBackup) dans un dossier de données synthétique, horloge simulée.
 * PASS = attaque bloquée. Usage : node --import tsx scripts/secuB-retention.mjs
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, statSync, statfsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { emit, finish, info, ok, ROOT } from "./lib/secu-b.mjs";

const SELF = new URL(import.meta.url).pathname;
const DAY = 86_400_000;

if (process.argv[2] === "child") {
  const [scenario, keepDays] = [process.argv[3], Number(process.argv[4] ?? 0)];
  const dir = process.env.DATA_DIR;
  const log = console.log;
  console.log = () => {};
  const { bootstrap } = await import("../src/lib/db/bootstrap.ts");
  await bootstrap();
  const { runBackup, backupDir } = await import("../src/lib/backup/archive.ts");
  const { default: Database } = await import("better-sqlite3");
  const reader = new Database(path.join(dir, "portfolio.db"), { readonly: true });
  const T0 = Date.now();
  const arch = () => readdirSync(backupDir(dir)).filter((n) => /^portfolio-.*\.tar\.gz$/.test(n)).sort();
  const run = (reason, keep, at, extra = {}) => runBackup({ dataDir: dir, config: { media: false, keep, keepDays, ...extra }, reason, reader, now: () => new Date(at) });
  const out = { scenario };
  if (scenario === "wipe") {
    // 6 sauvegardes d'avant, une par jour (midi) sur 6 jours, puis deux récentes (30 h et 5 h) ; réglage normal : on garde tout
    const seedAt = [...[6, 5, 4, 3, 2, 1].map((d) => T0 - d * DAY), T0 - 30 * 3600_000, T0 - 5 * 3600_000];
    for (const at of seedAt) await run("calme", 50, at);
    const before = arch();
    // l'attaquant : « garder 1 » puis « Sauvegarder maintenant » × 8
    for (let k = 1; k <= 8; k++) await run("manuel", 1, T0 + k * 2000);
    const after = arch();
    out.before = before.length;
    out.after = after;
    const ageOf = (n) => {
      const m = /portfolio-(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)/.exec(n);
      return T0 - Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    };
    out.survivorsOld = after.filter((n) => ageOf(n) >= 48 * 3600_000 && before.includes(n));
    out.survivorsPre = after.filter((n) => before.includes(n));
  } else if (scenario === "disk") {
    const first = await run("calme", 30, T0);
    const S = first.bytes;
    const fs = statfsSync(dir);
    const pct = ((2.5 * S) / (Number(fs.blocks) * Number(fs.bsize))) * 100; // plafond ≈ 2,5 archives
    for (let k = 1; k <= 12; k++) await run("manuel", 30, T0 + k * 2000, { maxDiskPct: pct });
    const files = arch();
    out.size = S;
    out.count = files.length;
    out.total = files.reduce((n, f) => n + statSync(path.join(backupDir(dir), f)).size, 0);
    out.cap = Math.round(2.5 * S);
  }
  console.log = log;
  emit(out);
  process.exit(0);
}

const go = (scenario, keepDays) => {
  const dir = mkdtempSync(path.join(process.env.SECUB_TMP ?? tmpdir(), "secub-ret-"));
  const r = spawnSync(process.execPath, ["--import", "tsx", SELF, "child", scenario, String(keepDays)], { cwd: ROOT, env: { ...process.env, DATA_DIR: dir }, encoding: "utf8", timeout: 240_000 });
  const line = r.stdout.split("\n").find((l) => l.startsWith("RESULT "));
  if (!line) {
    console.log(r.stdout.slice(-300), r.stderr.slice(-600));
    return null;
  }
  return JSON.parse(line.slice(7));
};

console.log("== P1 : session volée, « garder 1 » puis « Sauvegarder maintenant » × 8 (sans la rétention par jour du lot 118 : keepDays = 0)");
const w0 = go("wipe", 0);
info("archives restantes", w0 ? `${w0.after.length} sur ${w0.before} d'avant + 8 manuelles : ${w0.after.join(", ")}` : "échec");
ok("SB4 P1 une sauvegarde de plus de 48 h, d'avant l'intrusion, survit", Boolean(w0 && w0.survivorsOld.length >= 1), w0 ? `${w0.survivorsOld.length} ancienne(s), ${w0.survivorsPre.length} d'avant au total` : "");
console.log("== P1b : même attaque avec la rétention par jour du serveur (lot 118, BACKUP_KEEP_DAYS = 7, défaut de la v0.34.0)");
const w7 = go("wipe", 7);
info("archives d'avant qui survivent (keepDays = 7)", w7 ? `${w7.survivorsPre.length} sur ${w7.before} : ${w7.survivorsPre.join(", ")}` : "échec");
ok("SB4 P1b avec keepDays = 7 : au moins les 6 sauvegardes quotidiennes d'avant l'intrusion survivent (la rétention du lot 118 n'est pas perdue)", Boolean(w7 && w7.survivorsPre.length >= 6), w7 ? `${w7.survivorsPre.length} survivantes` : "");
console.log("== P6 : « garder 30 » + « Sauvegarder maintenant » × 12 : place des sauvegardes plafonnée");
const d = go("disk", 0);
info("place", d ? `${d.count} archives, ${d.total} octets (une archive = ${d.size} ; plafond réglé à ≈ ${d.cap})` : "échec");
ok("SB4 P6 le total des sauvegardes reste au plus à plafond + 2 archives protégées", Boolean(d && d.total <= d.cap + 2 * d.size), d ? `${d.count} archives, ${(d.total / d.size).toFixed(1)} × une archive` : "");
finish();
