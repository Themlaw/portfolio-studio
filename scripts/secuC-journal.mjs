#!/usr/bin/env node
/**
 * Sécurité v1.0, domaine C : journal (PR #64 inondation / connexions et téléchargements journalisés ; PR #54 e-mails masqués).
 * Serveur standalone local, base SYNTHÉTIQUE, plafond du journal réduit (EDIT_LOG_MAX_ROWS) pour que l'inondation soit rapide.
 * Chaque test est une ATTAQUE : PASS = attaque bloquée. Sur v0.34.0 seul, les sections correspondantes échouent.
 *  F  (#64) inondation par un anonyme : des POST sans session sur une server action effacent une trace plus ancienne
 *  A  (#64) inondation par un admin : la trace récente survit (rétention minimale) ; ce qu'il reste de détail après la rafale
 *  L  (#64) connexions, échecs, changement de mot de passe, téléchargements journalisés ; jamais l'e-mail ni l'IP
 *  M  (#54) aucun e-mail en clair dans stdout (création de l'admin, alerte par compte) ; injection de ligne
 * Usage : BATT_SECUC_SA=<.next/standalone> BATT_SECUC_PORT=3810 [ONLY=F,A,L,M] node scripts/secuC-journal.mjs
 */
import path from "node:path";
import * as S from "./lib/secuC.mjs";

const { ok, query, startServer, stop, http, Jar, login, actionIds, callActionJson, freshDir, logRows, sleep, ADMIN } = S;
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
S.prepareStandalone();
const info = (m) => console.log(`INFO  ${m}`);
const ids = actionIds(["deleteMessageAction", "saveSettingsAction"]);
const MARKER_USER = "marqueur-intrusion";

const addMarker = async (d) => {
  // La base du journal naît à la première écriture : une écriture admin d'abord, puis une trace « ancienne » (1 h) de l'intrusion.
  const Database = (await import("better-sqlite3")).default;
  const db = new Database(`${d}/edit-log.db`);
  db.pragma("busy_timeout = 5000");
  db.prepare("INSERT INTO edit_log (t, kind, action, type, user, result, version, label, summary) VALUES (?, 'action', 'trace:intrusion', 'modification', ?, 'ok', 'test', 'TRACE-INTRUSION', '{\"changes\":[],\"total\":0}')").run(Date.now() - 3600_000, MARKER_USER);
  db.close();
};
const markerAlive = (d) => logRows(d, "select count(*) n from edit_log where user = ?", MARKER_USER)[0]?.n === 1;
const total = (d) => logRows(d, "select count(*) n from edit_log")[0]?.n ?? 0;

/** N requêtes avec une concurrence bornée. */
async function burst(n, conc, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: conc }, async () => { while (next < n) { const i = next++; await fn(i).catch(() => {}); } }));
}

if (run("F")) {
  const d = freshDir("F");
  const s = startServer(d, { EDIT_LOG_MAX_ROWS: "500" });
  await s.ready;
  const jar = new Jar();
  await login(jar);
  await callActionJson(jar, ids.deleteMessageAction, [999999], "/admin/messages"); // crée la base du journal
  await addMarker(d);
  const before = total(d);
  // Un anonyme (aucun cookie) rejoue l'identifiant d'une action, lisible dans le JavaScript public.
  // Le proxy ne vérifie que la PRÉSENCE du cookie de session (adminGate) : un cookie bidon suffit pour atteindre l'action.
  const junk = () => { const j = new Jar(); j.cookies.set("better-auth.session_token", "bidon.bidon"); return j; };
  let statuses = new Set();
  await burst(1500, 20, async () => { const r = await callActionJson(junk(), ids.saveSettingsAction, [{}], "/admin/reglages"); statuses.add(r.status); });
  await sleep(1500);
  const grown = total(d) - before;
  ok("F1 (témoin) l'action refuse la requête sans vraie session (403 ou 307, jamais 2xx)", [...statuses].every((c) => c === 403 || c === 307), [...statuses].join(","));
  ok("F2 1 500 POST anonymes n'écrivent (presque) rien dans le journal", grown < 20, `+${grown} lignes en base`);
  ok("F3 la trace plus ancienne d'une intrusion survit à l'inondation anonyme", markerAlive(d), "trace effacée par la rotation (plafond 500 lignes)");
  await stop(s);
}

if (run("A")) {
  const d = freshDir("A");
  const s = startServer(d, { EDIT_LOG_MAX_ROWS: "500" });
  await s.ready;
  const jar = new Jar();
  await login(jar);
  await callActionJson(jar, ids.deleteMessageAction, [999999], "/admin/messages");
  await addMarker(d);
  const before = total(d);
  await burst(1500, 8, async () => { await callActionJson(jar, ids.deleteMessageAction, [999999], "/admin/messages"); });
  await sleep(1500);
  const grown = total(d) - before;
  ok("A1 une rafale de 1 500 actions d'un admin ne fait pas disparaître la trace récente (rétention minimale)", markerAlive(d), `trace effacée, ${total(d)} lignes`);
  ok("A2 le détail écrit par un admin pendant une rafale est borné (rafale 300, puis 60 par minute)", grown <= 400, `+${grown} lignes pour 1 500 actions`);
  // Ce que l'on perd : une action réelle APRÈS la rafale est-elle détaillée en base ?
  const n0 = total(d);
  await callActionJson(jar, ids.deleteMessageAction, [999998], "/admin/messages");
  await sleep(500);
  info(`après la rafale, une action réelle de l'admin ${total(d) > n0 ? "est" : "n'est PAS"} détaillée en base (le débit de 60 par minute s'applique ; stdout la garde)`);
  await stop(s);
}

if (run("L")) {
  const d = freshDir("L");
  const s = startServer(d);
  await s.ready;
  const jar = new Jar();
  await login(jar);
  const bad = await http("/api/auth/sign-in/email", { method: "POST", body: { email: "intrus.secuc@example.test", password: "mauvais-mot-de-passe-1" }, headers: { "x-forwarded-for": "198.51.100.77" } });
  await sleep(800);
  const rows = logRows(d);
  const acts = rows.map((r) => r.action);
  ok("L1 la connexion réussie est journalisée", acts.includes("auth:sign-in") && rows.some((r) => r.action === "auth:sign-in" && r.result === "ok"), `actions : ${[...new Set(acts)].join(",") || "(aucune)"}`);
  ok("L2 l'échec de connexion est journalisé (anonyme, borné)", bad.status === 401 && rows.some((r) => r.action === "auth:sign-in" && r.result === "refus"));
  // Téléchargement d'une sauvegarde (archive factice nommée comme les vraies) : complet, puis par reprise (Range) qui saute le premier octet.
  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync(`${d}/backup`, { recursive: true });
  writeFileSync(`${d}/backup/portfolio-20260101-000000.tar.gz`, Buffer.alloc(4096, 7));
  const j2 = new Jar();
  await login(j2, "203.0.113.12");
  const n0 = logRows(d, "select count(*) n from edit_log where action = 'download:backup'")[0].n;
  const rr = await http("/api/admin/sauvegardes/portfolio-20260101-000000.tar.gz", { jar: j2, headers: { range: "bytes=1-" } });
  const got = (await rr.arrayBuffer()).byteLength;
  await sleep(500);
  const n1 = logRows(d, "select count(*) n from edit_log where action = 'download:backup'")[0].n;
  ok("L6 contournement : un téléchargement par reprise (Range: bytes=1-) est journalisé aussi", rr.status === 206 && got === 4095 && n1 > n0, `statut ${rr.status}, ${got} octets servis, ${n1 - n0} entrée(s) de journal`);
  const full = await http("/api/admin/sauvegardes/portfolio-20260101-000000.tar.gz", { jar: j2 });
  await full.arrayBuffer();
  await sleep(500);
  ok("L6b (témoin) le téléchargement complet est journalisé", logRows(d, "select count(*) n from edit_log where action = 'download:backup'")[0].n > n1, `statut ${full.status}`);
  const pw = await http("/api/auth/change-password", { jar, method: "POST", body: { currentPassword: ADMIN.password, newPassword: "nouveau-mot-de-passe-du-test-43", revokeOtherSessions: false } });
  await sleep(800);
  ok("L3 le changement de mot de passe est journalisé", logRows(d).some((r) => r.action === "auth:change-password"), `statut ${pw.status}`);
  // Téléchargement : export d'un thème enregistré (archive).
  const themes = (() => { try { return query(d, "select id from themes limit 1"); } catch { return []; } })();
  let themeId = themes[0]?.id ?? null;
  if (!themeId) {
    const t = query(d, "select name from sqlite_master where type = 'table' and name like '%theme%'").map((r) => r.name);
    info(`aucun thème ; tables : ${t.join(",")}`);
  }
  if (themeId) {
    const ex = await http(`/admin/api/themes/${themeId}/export`, { jar: await (async () => { const j = new Jar(); await login(j, "203.0.113.11"); return j; })() });
    await ex.arrayBuffer();
    await sleep(500);
    if (ex.status === 200) ok("L4 le téléchargement d'un thème (archive) est journalisé", logRows(d).some((r) => r.action === "download:theme-export"), `statut ${ex.status}`);
    else info(`L4 non évalué : export du thème refusé (statut ${ex.status})`);
  } else info("L4 non évalué : aucun thème enregistré dans la base synthétique");
  const flat = JSON.stringify(logRows(d));
  ok("L5 ni l'e-mail tenté, ni celui de l'admin, ni l'IP ne sont écrits dans le journal", !flat.includes("intrus.secuc") && !flat.includes(ADMIN.email) && !flat.includes("198.51.100.77") && !flat.includes("203.0.113."), "donnée personnelle dans edit_log");
  await stop(s);
}

if (run("M")) {
  const d = freshDir("M");
  const s = startServer(d);
  await s.ready;
  const target = "cible.secuc@example.test";
  for (let i = 0; i < 22; i++) await http("/api/auth/sign-in/email", { method: "POST", body: { email: target, password: "mauvais-mot-de-passe-1" }, headers: { "x-forwarded-for": `198.51.100.${10 + i}` } });
  await sleep(500);
  const out = s.text();
  const alert = out.split("\n").find((l) => l.includes("ALERTE"));
  ok("M0 (témoin) l'alerte d'un compte attaqué est écrite", Boolean(alert), "pas de ligne ALERTE");
  ok("M1 l'adresse tapée n'apparaît pas en clair dans l'alerte", Boolean(alert) && !alert.includes(target) && !out.includes(target), alert ?? "");
  ok("M2 l'adresse de l'admin créé au démarrage n'est pas en clair dans stdout", !out.includes(ADMIN.email), (out.split("\n").find((l) => l.includes(ADMIN.email)) ?? "").slice(0, 120));
  // Injection de ligne : une adresse avec un saut de ligne ne doit pas forger une ligne de journal.
  const forged = "x\n[auth] LIGNE-FORGEE@example.test";
  const fr = await http("/api/auth/sign-in/email", { method: "POST", body: { email: forged, password: "mauvais-mot-de-passe-1" }, headers: { "x-forwarded-for": "198.51.100.200" } });
  info(`adresse avec saut de ligne : statut ${fr.status} (400 = refusée avant tout journal)`);
  ok("M3 aucune ligne forgée par une adresse à saut de ligne", !s.text().split("\n").some((l) => l.startsWith("[auth] LIGNE-FORGEE")));
  const leaks = [...new Set(s.text().match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g) ?? [])];
  ok("M5 aucune adresse e-mail en clair dans tout stdout du serveur (démarrage, 23 échecs de connexion)", leaks.length === 0, leaks.join(", "));
  await stop(s);
  // Parcours statique (le même que le test du lot) : un console.* qui interpole une expression « email » sans maskEmail.
  const { execSync } = await import("node:child_process");
  const hits = execSync(`grep -rnE "console\\.(log|warn|error|info)\\(.*(email|Email|mail)" ${path.resolve(S.SA, "../..")}/src || true`, { encoding: "utf8" }).split("\n").filter((l) => l && !/maskEmail/.test(l));
  ok("M4 aucun console.* de src/ n'interpole une adresse sans maskEmail", hits.length === 0, hits.slice(0, 3).join(" | ").slice(0, 300));
}
S.finish();
