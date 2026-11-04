#!/usr/bin/env node
/**
 * Sécurité du compte (audit de sécurité, P3), sans serveur (inclus dans npm test) :
 *  1. durées de session : inactivité et durée absolue, `sessionTooOld` ;
 *  2. navigateur lisible (`describeUserAgent`) ;
 *  3. script de réinitialisation `reset-password.mjs` (celui de l'image) sur une VRAIE base migrée : empreinte vérifiable par
 *     Better Auth, toutes les sessions coupées, compte « credential » créé s'il manque, e-mail inconnu refusé sans rien changer,
 *     mot de passe lu sur l'entrée standard (jamais en argument), mot de passe aléatoire affiché une fois ;
 *  4. crochet `before` de Better Auth : /change-password force `revokeOtherSessions` (lecture du source).
 * Le changement de mot de passe dans un vrai navigateur (deux contextes) : scripts/e2e-compte.mjs ; les refus HTTP : test-auth (A19s).
 * Usage : node --import tsx scripts/test-compte.mjs
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

let failures = 0;
const ok = (label, pass, detail = "") => {
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${!pass && detail ? ` — ${detail}` : ""}`);
};
const ROOT = new URL("..", import.meta.url).pathname;

const { sessionTooOld, describeUserAgent, SESSION_IDLE_S, SESSION_MAX_MS, SESSION_UPDATE_AGE_S } = await import("../src/lib/auth/sessions.ts");

/* ---- 1. durées ---- */
{
  const now = 1_800_000_000_000;
  ok("durées : inactivité 3 jours, durée absolue 7 jours, prolongation au plus une fois par heure", SESSION_IDLE_S === 3 * 86_400 && SESSION_MAX_MS === 7 * 86_400_000 && SESSION_UPDATE_AGE_S === 3600);
  ok("durée absolue : 6 jours oui, 8 jours non, date illisible non", !sessionTooOld(now - 6 * 86_400_000, now) && sessionTooOld(now - 8 * 86_400_000, now) && sessionTooOld("pas une date", now));
  const src = readFileSync(path.join(ROOT, "src/lib/auth/index.ts"), "utf8");
  ok("Better Auth : expiresIn = inactivité, updateAge réglé", /expiresIn:\s*SESSION_IDLE_S/.test(src) && /updateAge:\s*SESSION_UPDATE_AGE_S/.test(src));
  const guard = readFileSync(path.join(ROOT, "src/lib/auth/guard.ts"), "utf8");
  ok("garde : session trop ancienne refusée (getAdminSession ET isAdminRequest)", (guard.match(/sessionTooOld\(/g) ?? []).length >= 2);
  ok("crochet before : /change-password force revokeOtherSessions côté serveur", /ctx\.path === "\/change-password"/.test(src) && /revokeOtherSessions:\s*true/.test(src));
}

/* ---- 2. navigateur lisible ---- */
{
  ok("navigateur : Firefox sur Linux", describeUserAgent("Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0") === "Firefox sur Linux");
  ok("navigateur : Chrome sur Windows, Safari sur iPhone, Edge", describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36") === "Chrome sur Windows" && describeUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1") === "Safari sur iPhone" && describeUserAgent("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/129.0 Safari/537.36 Edg/129.0") === "Edge sur Windows");
  ok("navigateur : programme, absent", describeUserAgent("curl/8.5.0") === "Programme (pas un navigateur)" && describeUserAgent(null) === "Navigateur inconnu");
}

/* ---- 3. reset-password.mjs sur une vraie base migrée ---- */
const tmp = mkdtempSync(path.join(process.env.TEST_TMP ?? tmpdir(), "pf-test-compte-"));
try {
  const data = path.join(tmp, "data");
  mkdirSync(path.join(data, "media"), { recursive: true });
  process.env.DATA_DIR = data;
  const log = console.log;
  console.log = () => {};
  const { bootstrap } = await import("../src/lib/db/bootstrap.ts");
  await bootstrap();
  console.log = log;
  const db = new Database(path.join(data, "portfolio.db"));
  const now = Date.now();
  db.prepare("insert into user (id, name, email, email_verified, created_at, updated_at) values ('u1', 'artiste', 'artiste@example.test', 1, ?, ?), ('u2', 'oidc', 'autre@example.test', 1, ?, ?)").run(now, now, now, now);
  db.prepare("insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at) values ('a1', 'u1', 'credential', 'u1', 'ancien:hash', ?, ?)").run(now, now);
  for (const [id, u] of [["s1", "u1"], ["s2", "u1"], ["s3", "u2"]]) db.prepare("insert into session (id, expires_at, token, created_at, updated_at, user_id) values (?, ?, ?, ?, ?, ?)").run(id, now + 86_400_000, `tok-${id}`, now, now, u);
  db.close();
  const script = path.join(ROOT, "scripts/reset-password.mjs");
  const run = (args, input) => spawnSync(process.execPath, [script, ...args], { input, encoding: "utf8", env: { ...process.env, DATA_DIR: data } });
  const q = (sql, ...a) => {
    const d = new Database(path.join(data, "portfolio.db"), { readonly: true });
    try {
      return d.prepare(sql).get(...a);
    } finally {
      d.close();
    }
  };
  const { verifyPassword } = await import("better-auth/crypto");

  const bad = run(["inconnu@example.test", data], "nouveau-mot-de-passe-42\n");
  ok("reset : e-mail inconnu refusé (code 1), rien ne change", bad.status === 1 && /aucun utilisateur/.test(bad.stderr) && q("select count(*) n from session").n === 3 && q("select password p from account where id = 'a1'").p === "ancien:hash", bad.stderr);
  const short = run(["artiste@example.test", data], "court\n");
  ok("reset : mot de passe trop court refusé (code 2)", short.status === 2 && q("select password p from account where id = 'a1'").p === "ancien:hash");
  const r = run(["Artiste@Example.test", data], "une phrase de passe neuve\n");
  const hash = q("select password p from account where id = 'a1'").p;
  ok("reset : mot de passe lu sur l'entrée standard, jamais affiché", r.status === 0 && !r.stdout.includes("une phrase de passe neuve"), r.stderr || r.stdout);
  ok("reset : empreinte au format de Better Auth, vérifiée par better-auth/crypto", /^[0-9a-f]{32}:[0-9a-f]{128}$/.test(hash) && (await verifyPassword({ hash, password: "une phrase de passe neuve" })) && !(await verifyPassword({ hash, password: "autre chose" })));
  ok("reset : TOUTES les sessions coupées (tous les comptes)", q("select count(*) n from session").n === 0 && /3 session\(s\) coupée\(s\)/.test(r.stdout), r.stdout);
  const gen = run(["autre@example.test", data], "");
  const shown = /: ([a-z2-9]{5}(?:-[a-z2-9]{5}){3})$/m.exec(gen.stdout)?.[1];
  const created = q("select password p from account where user_id = 'u2' and provider_id = 'credential'")?.p;
  ok("reset : sans entrée, mot de passe aléatoire affiché une fois ; compte « credential » créé s'il manquait", gen.status === 0 && Boolean(shown) && Boolean(created) && (await verifyPassword({ hash: created, password: shown })), gen.stdout + gen.stderr);
  const usage = run([], "");
  ok("reset : sans e-mail, mode d'emploi (code 2)", usage.status === 2 && /Usage/.test(usage.stderr));
  ok("reset : le mot de passe n'est jamais un argument (lu sur stdin)", !/process\.argv\[3\]|argv\.slice\(2\)\[2\]/.test(readFileSync(script, "utf8")));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

/* ---- 4. le script est dans l'image ---- */
{
  const docker = readFileSync(path.join(ROOT, "Dockerfile"), "utf8");
  const ignore = readFileSync(path.join(ROOT, ".dockerignore"), "utf8");
  ok("image : reset-password.mjs copié à côté de restore-backup.mjs, et pas exclu du contexte", /scripts\/reset-password\.mjs \/app\/reset-password\.mjs/.test(docker) && /^!scripts\/reset-password\.mjs$/m.test(ignore));
}

console.log(failures ? `\n${failures} échec(s)` : "\nTout est vert");
process.exit(failures ? 1 : 0);
