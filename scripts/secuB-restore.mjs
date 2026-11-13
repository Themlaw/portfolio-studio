#!/usr/bin/env node
/**
 * Sécurité v1.0 : #22, la restauration ne suit plus les liens symboliques. Archive synthétique, dossier de données piégé
 * (liens posés par un site compromis), jamais de données réelles. PASS = attaque bloquée.
 * Usage : node scripts/secuB-restore.mjs        (en root dans un conteneur : vérifie aussi les propriétaires, voir R4)
 * Sur v0.34.0 sans correctif : la restauration écrit / supprime HORS du dossier de données en suivant les liens.
 */
import { spawn as spawnAsync, spawnSync } from "node:child_process";
import { chownSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { finish, info, ok } from "./lib/secu-b.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const SCRIPT = path.join(ROOT, "scripts/restore-backup.mjs");
const isRoot = process.getuid?.() === 0;

/* --- archive tar synthétique (ustar + PAX) --- */
function header(name, size, type = "0", linkname = "") {
  const h = Buffer.alloc(512);
  h.write(name.slice(0, 100), 0);
  h.write("0000640\0", 100);
  h.write("0001750\0", 108);
  h.write("0001750\0", 116);
  h.write(size.toString(8).padStart(11, "0") + "\0", 124);
  h.write("00000000000\0", 136);
  h.write("        ", 148);
  h.write(type, 156);
  h.write(linkname.slice(0, 100), 157);
  h.write("ustar\0" + "00", 257);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  return h;
}
const pad = (b) => Buffer.concat([b, Buffer.alloc((512 - (b.length % 512)) % 512)]);
function tar(entries) {
  const parts = [];
  for (const e of entries) {
    if (e.pax) {
      const rec = ` path=${e.pax}\n`;
      let len = rec.length + String(rec.length).length;
      if (String(len).length !== String(rec.length).length) len++;
      const body = Buffer.from(`${len}${rec}`);
      parts.push(header("PaxHeader", body.length, "x"), pad(body));
    }
    const data = Buffer.from(e.data ?? "");
    parts.push(header(e.name, e.type && e.type !== "0" ? 0 : data.length, e.type ?? "0", e.link ?? ""), e.type && e.type !== "0" ? Buffer.alloc(0) : pad(data));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}
const MANIFEST = JSON.stringify({ version: "0.34.0", createdAt: "2026-11-08T00:00:00.000Z", reason: "manuel", mediaCount: 1, includesMedia: true, storage: {} });
const DB = "SQLite format 3\0" + "x".repeat(100);
const GOOD = [
  { name: "manifest.json", data: MANIFEST },
  { name: "portfolio.db", data: DB },
  { name: "fonts/Synth-400.woff2", data: "font" },
  { name: "media/originals/aaaaaaaaaaaaaaaa.png", data: "png" },
];

const tmp = mkdtempSync(path.join(process.env.SECUB_TMP ?? tmpdir(), "secub-restore-"));
let n = 0;
/** Bac à sable : data/ (propriétaire normal), outside/ (cible des liens, sentinelle dedans), archive. */
function sandbox(entries = GOOD) {
  const dir = path.join(tmp, `s${n++}`);
  const data = path.join(dir, "data");
  const outside = path.join(dir, "outside");
  mkdirSync(data, { recursive: true });
  mkdirSync(path.join(outside, "crops"), { recursive: true });
  writeFileSync(path.join(outside, "sentinelle.txt"), "intacte");
  writeFileSync(path.join(outside, "crops", "garde.txt"), "a ne pas supprimer");
  writeFileSync(path.join(data, "portfolio.db"), "ANCIENNE BASE");
  writeFileSync(path.join(dir, "a.tar.gz"), tar(entries));
  if (isRoot) {
    chownSync(data, 1000, 1000);
    chownSync(outside, 12345, 12345);
  }
  return { dir, data, outside, archive: path.join(dir, "a.tar.gz") };
}
const restore = (s, args = []) => spawnSync(process.execPath, [SCRIPT, "--force", ...args, s.archive, s.data], { encoding: "utf8", timeout: 60_000 });
const names = (d) => (existsSync(d) ? readdirSync(d).sort() : []);

console.log("== R0 régression : restauration normale");
{
  const s = sandbox();
  const r = restore(s);
  ok("SB22 restauration normale : réussie, base et fichiers en place", r.status === 0 && readFileSync(path.join(s.data, "portfolio.db"), "latin1").startsWith("SQLite format 3") && existsSync(path.join(s.data, "fonts/Synth-400.woff2")) && existsSync(path.join(s.data, "media/originals/aaaaaaaaaaaaaaaa.png")), `${r.status} ${r.stderr.slice(0, 120)}`);
  ok("SB22 ancienne base rangée dans restore-previous-*", names(s.data).some((x) => x.startsWith("restore-previous-")));
}

console.log("== R1 fonts/ remplacé par un lien vers l'extérieur");
{
  const s = sandbox();
  symlinkSync(s.outside, path.join(s.data, "fonts"));
  const r = restore(s);
  const escaped = existsSync(path.join(s.outside, "Synth-400.woff2"));
  ok("SB22 R1 aucun fichier écrit hors du dossier de données", !escaped, escaped ? `ÉCRIT dans outside/ : ${names(s.outside)}` : "");
  ok("SB22 R1 la restauration est refusée AVANT toute modification (base ancienne intacte, code ≠ 0)", r.status !== 0 && readFileSync(path.join(s.data, "portfolio.db"), "utf8") === "ANCIENNE BASE", `code ${r.status} ${r.stderr.trim().slice(0, 140)}`);
}

console.log("== R2 media/originals remplacé par un lien (sous-dossier)");
{
  const s = sandbox();
  mkdirSync(path.join(s.data, "media"));
  symlinkSync(s.outside, path.join(s.data, "media", "originals"));
  const r = restore(s);
  const escaped = existsSync(path.join(s.outside, "aaaaaaaaaaaaaaaa.png"));
  ok("SB22 R2 aucun original écrit hors du dossier de données", !escaped && r.status !== 0, escaped ? "ÉCRIT dans outside/" : `code ${r.status}`);
}

console.log("== R3 cache/ remplacé par un lien : suppression de cache/crops hors du dossier");
{
  const s = sandbox();
  symlinkSync(s.outside, path.join(s.data, "cache"));
  const r = restore(s);
  const deleted = !existsSync(path.join(s.outside, "crops"));
  ok("SB22 R3 outside/crops n'est pas supprimé", !deleted, deleted ? "SUPPRIMÉ hors du dossier de données" : `code ${r.status}`);
}

console.log("== R4 propriétaires (chown suit les liens) — seulement en root");
if (isRoot) {
  const s = sandbox();
  symlinkSync(s.outside, path.join(s.data, "fonts"));
  restore(s);
  const owner = lstatSync(s.outside).uid;
  ok("SB22 R4 le dossier extérieur garde son propriétaire (12345)", owner === 12345, `propriétaire devenu ${owner}`);
} else info("R4 ignoré (non root)", "lancer dans un conteneur en --user 0:0");

console.log("== R5 liens et chemins piégés DANS l'archive (déjà refusés avant les PR ?)");
for (const [label, entries] of Object.entries({
  "entrée lien symbolique fonts/x → /etc": [...GOOD, { name: "fonts/x", type: "2", link: "/etc/passwd" }],
  "entrée lien dur": [...GOOD, { name: "fonts/y", type: "1", link: "portfolio.db" }],
  "chemin avec ..": [...GOOD, { name: "media/../../evil.txt", data: "x" }],
  "chemin absolu": [...GOOD, { name: "/tmp/evil.txt", data: "x" }],
  "chemin PAX avec ..": [...GOOD, { name: "media/ok.txt", pax: "media/../../evil.txt", data: "x" }],
  "chemin avec antislash": [...GOOD, { name: "media\\..\\..\\evil.txt", data: "x" }],
  "dossier fonts/.": [...GOOD, { name: "fonts/./../../evil.txt", data: "x" }],
  "entrée hors liste (cache/crops/x)": [...GOOD, { name: "cache/crops/x", data: "x" }],
})) {
  const s = sandbox(entries);
  const r = restore(s);
  const bad = existsSync(path.join(s.dir, "evil.txt")) || existsSync(path.join(s.dir, "..", "evil.txt")) || existsSync("/tmp/evil.txt") || existsSync(path.join(s.data, "cache/crops/x"));
  const okBackslash = label === "chemin avec antislash" ? (!bad && true) : !bad && r.status !== 0;
  ok(`SB22 R5 archive piégée refusée : ${label}`, okBackslash, `code ${r.status} ${r.stderr.trim().slice(0, 90)}`);
}

console.log("== R6 régressions : le dossier donné en argument peut être un lien (choix de l'administrateur)");
{
  const s = sandbox();
  const real = path.join(s.dir, "vrai-data");
  mkdirSync(real);
  writeFileSync(path.join(real, "portfolio.db"), "ANCIENNE BASE");
  const link = path.join(s.dir, "data-lien");
  symlinkSync(real, link);
  const r = spawnSync(process.execPath, [SCRIPT, "--force", s.archive, link], { encoding: "utf8" });
  ok("SB22 R6 dossier de données = lien vers un vrai dossier : restauration réussie", r.status === 0 && existsSync(path.join(real, "fonts/Synth-400.woff2")), `${r.status} ${r.stderr.slice(0, 100)}`);
}
console.log("== R7 contournements du correctif");
{
  // lien posé sur le dossier restore-previous-* (prévisible à la seconde) : la base ancienne partirait hors du dossier
  const s = sandbox();
  const stamp = new Date();
  const mkStamp = (d) => d.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  for (let i = -1; i <= 2; i++) {
    const t = mkStamp(new Date(stamp.getTime() + i * 1000));
    symlinkSync(s.outside, path.join(s.data, `restore-previous-${t}`));
    symlinkSync(s.outside, path.join(s.data, `restore-tmp-${t}`));
  }
  const r = restore(s);
  const moved = existsSync(path.join(s.outside, "portfolio.db"));
  ok("SB22 R7 liens restore-previous-* / restore-tmp-* prévisibles : rien n'est déplacé ni écrit hors du dossier", !moved && !existsSync(path.join(s.outside, "manifest.json")) && !existsSync(path.join(s.outside, "fonts")), moved ? "ancienne base DÉPLACÉE dans outside/" : `code ${r.status} ${r.stderr.trim().slice(0, 90)}`);
}
{
  // lien sur portfolio.db lui-même vers un fichier extérieur : doit rester inoffensif (le lien est déplacé, pas suivi)
  const s = sandbox();
  rmLink(path.join(s.data, "portfolio.db"));
  symlinkSync(path.join(s.outside, "sentinelle.txt"), path.join(s.data, "portfolio.db"));
  const r = restore(s);
  ok("SB22 R7 portfolio.db = lien vers un fichier extérieur : sentinelle intacte", readFileSync(path.join(s.outside, "sentinelle.txt"), "utf8") === "intacte", `code ${r.status} ${r.stderr.trim().slice(0, 90)}`);
}
function rmLink(p) {
  spawnSync("rm", ["-f", p]);
}

console.log("== R8 course (TOCTOU) : un processus bascule data/fonts entre « absent » et « lien vers l'extérieur » pendant la restauration");
{
  // Le site est censé être arrêté (docs/SAUVEGARDES.md) : résultat INFORMATIF, pas un échec.
  const many = [...GOOD.filter((e) => !e.name.startsWith("fonts/")), ...Array.from({ length: 600 }, (_, i) => ({ name: `fonts/f${i}.woff2`, data: "x" }))];
  let escapes = 0;
  const rounds = 12;
  for (let k = 0; k < rounds; k++) {
    const s = sandbox(many);
        const code = `const fs=require("fs");const l=${JSON.stringify(path.join(s.data, "fonts"))};const t=${JSON.stringify(s.outside)};const end=Date.now()+6000;while(Date.now()<end){try{fs.symlinkSync(t,l)}catch{}try{fs.unlinkSync(l)}catch{}}`;
    const child = spawnAsync(process.execPath, ["-e", code], { stdio: "ignore" });
    const r = await new Promise((res) => {
      const p = spawnAsync(process.execPath, [SCRIPT, "--force", s.archive, s.data], { stdio: "ignore" });
      p.on("exit", (c) => res(c));
    });
    child.kill("SIGKILL");
    if (readdirSync(s.outside).some((n) => n.endsWith(".woff2"))) escapes++;
  }
  info("R8 résultat", `${escapes} restauration(s) sur ${rounds} ont écrit hors du dossier malgré les contrôles (fenêtre entre lstat et rename ; le site arrêté ferme cette fenêtre)`);
}

finish();
