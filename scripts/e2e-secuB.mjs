#!/usr/bin/env node
/**
 * Sécurité v1.0 : attaques HTTP contre un serveur LOCAL de test (build standalone, 127.0.0.1, données synthétiques).
 *   Q  #60 quota d'envois : init parallèles, envois ouverts, disque presque plein, envois directs parallèles
 *   K  #58 sauvegardes sans secrets, téléchargement après confirmation récente, ancienne sauvegarde restaurée
 *   W  #55 nom d'un papier peint dans le HTML public / flux RSC
 *   V  #32 ffmpeg / ffprobe : environnement transmis (espions dans le PATH), vidéo toujours convertie
 * PASS = attaque bloquée. Sur v0.34.0 sans correctif : échecs.
 * Usage (conteneur Playwright, build fait) : ONLY=Q,K,W,V node scripts/e2e-secuB.mjs      (ports : SECUB_PORT, défaut 3910)
 */
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statfsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

import Database from "better-sqlite3";
import sharp from "sharp";

const ROOT = new URL("..", import.meta.url).pathname;
const SA = process.env.SECUB_SA ?? path.join(ROOT, ".next/standalone");
const TMP = mkdtempSync(path.join(process.env.SECUB_TMP ?? tmpdir(), "secub-e2e-"));
const PORT = Number(process.env.SECUB_PORT ?? process.env.PORT ?? 3910);
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = "test-secret-0123456789abcdef-0123456789abcdef";
const ADMIN = { email: "artiste@example.test", password: "mot-de-passe-du-test-42" };
const ONLY = (process.env.ONLY ?? "").split(",").filter(Boolean);
const run = (s) => !ONLY.length || ONLY.includes(s);
const baseEnv = { BETTER_AUTH_SECRET: SECRET, ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, AUTH_TRUSTED_PROXY_HOPS: "1" };

let failures = 0;
const ok = (label, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failures++;
};
const info = (label, detail = "") => console.log(`INFO  ${label}${detail ? ` — ${detail}` : ""}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- outils -- */
const servers = new Set();
function prepare() {
  if (!existsSync(path.join(SA, "server.js"))) throw new Error("build absent");
  if (!["drizzle", "seed", "public", ".next/static"].every((d) => existsSync(path.join(SA, d)))) {
    for (const d of ["drizzle", "seed", "public"]) cpSync(path.join(ROOT, d), path.join(SA, d), { recursive: true });
    cpSync(path.join(ROOT, ".next/static"), path.join(SA, ".next/static"), { recursive: true });
  }
}
function startServer(dataDir, env = {}, extraPath = "") {
  mkdirSync(dataDir, { recursive: true });
  const logs = [];
  const child = spawn(process.execPath, ["server.js"], {
    cwd: SA,
    env: { PATH: `${extraPath}${extraPath ? ":" : ""}${process.env.PATH}`, NODE_ENV: "production", PORT: String(PORT), HOSTNAME: "127.0.0.1", DATA_DIR: dataDir, PUBLIC_BASE_URL: BASE, ...baseEnv, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  servers.add(child);
  child.stdout.on("data", (d) => logs.push(String(d)));
  child.stderr.on("data", (d) => logs.push(String(d)));
  const exited = new Promise((r) => child.on("exit", (c) => r(c)));
  const ready = (async () => {
    for (let i = 0; i < 80; i++) {
      if (child.exitCode !== null) return false;
      try {
        if ((await fetch(`${BASE}/fr`)).status === 200) return true;
      } catch {}
      await sleep(250);
    }
    return false;
  })();
  return { child, logs, exited, ready, text: () => logs.join("") };
}
async function stop(s) {
  if (s.child.exitCode === null) s.child.kill("SIGTERM");
  await Promise.race([s.exited, sleep(8000)]);
  if (s.child.exitCode === null) s.child.kill("SIGKILL");
  await s.exited;
  servers.delete(s.child);
}
process.on("exit", () => {
  for (const c of servers) if (c.exitCode === null) c.kill("SIGKILL");
});
class Jar {
  cookies = new Map();
  store(res) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      if (attrs.some((a) => /max-age=0\b/i.test(a)) || value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}
async function http(url, { jar, method = "GET", body, raw, headers = {} } = {}) {
  const res = await fetch(url.startsWith("http") ? url : `${BASE}${url}`, {
    method,
    redirect: "manual",
    headers: { ...(jar && jar.cookies.size ? { cookie: jar.header() } : {}), ...(body ? { "content-type": "application/json", origin: BASE } : {}), ...headers },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  jar?.store(res);
  return res;
}
let ipSeq = 30;
const signIn = (jar, password = ADMIN.password, xff = `198.51.100.${ipSeq++}`) =>
  http("/api/auth/sign-in/email", { jar, method: "POST", body: { email: ADMIN.email, password }, headers: { "x-forwarded-for": xff } });
const query = (dir, sql, ...p) => {
  const db = new Database(path.join(dir, "portfolio.db"), { readonly: true });
  const r = db.prepare(sql).get(...p);
  db.close();
  return r;
};
const writeDb = (dir, sql, ...p) => {
  const db = new Database(path.join(dir, "portfolio.db"));
  db.pragma("busy_timeout = 5000");
  db.prepare(sql).run(...p);
  db.close();
};
async function freshAdmin(dir, env = {}, extraPath = "") {
  const server = startServer(dir, env, extraPath);
  if (!(await server.ready)) throw new Error(`serveur non prêt : ${server.text().slice(-400)}`);
  const jar = new Jar();
  await signIn(jar);
  return { server, jar };
}
function actionId(name) {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, ".next/server/server-reference-manifest.json"), "utf8"));
  for (const [id, entry] of Object.entries(manifest.node ?? {})) if (entry.exportedName === name || JSON.stringify(entry).includes(`"${name}"`)) return id;
  return null;
}
async function action(jar, name, args, page, headers = {}) {
  const id = actionId(name);
  if (!id) return { status: 0, text: `action ${name} absente du build` };
  const r = await http(page, { jar, method: "POST", raw: JSON.stringify(args), headers: { "next-action": id, "content-type": "text/plain;charset=UTF-8", origin: BASE, ...headers } });
  return { status: r.status, text: await r.text() };
}
const noise = (w, h) => sharp(randomBytes(w * h * 3), { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
const MB = 1024 * 1024;
const usageOf = (dir) =>
  query(
    dir,
    `select coalesce((select sum(case when json_valid(variants) and json_extract(variants, '$.originalRemoved') = 1 then 0 else size end) from media), 0)
      + coalesce((select sum(json_extract(f.value, '$.size')) from media m, json_each(m.variants, '$.files') f where json_valid(m.variants)), 0)
      + coalesce((select sum(size) from uploads), 0) n`,
  ).n;
const initUp = (jar, size, name, type = "video/mp4") => http("/admin/api/upload/init", { jar, method: "POST", body: { name, size, type } });

try {
  prepare();

  /* ====================================================================== Q */
  if (run("Q")) {
    console.log("\n== Q. #60 quota d'envois : course, envois ouverts, disque");
    const dir = `${TMP}/q`;
    let a = await freshAdmin(dir);
    await stop(a.server);
    const used = usageOf(dir);
    a = await freshAdmin(dir, { MEDIA_MAX_TOTAL_GB: String((used + 5.5 * MB) / 1024 ** 3) });
    const par = await Promise.all(Array.from({ length: 10 }, (_, i) => initUp(a.jar, MB, `course-${i}.mp4`)));
    const accepted = par.filter((r) => r.status === 200).length;
    ok("SB60 Q1 10 init simultanés de 1 Mo pour 5,5 Mo de place : au plus 5 acceptés (quota respecté)", accepted <= 5, `${par.map((r) => r.status).join(",")} → ${accepted} acceptés, ${query(dir, "select count(*) n from uploads").n} envois réservés`);
    await stop(a.server);

    // envois ouverts bornés (sans quota), séquentiel puis parallèle
    const dir2 = `${TMP}/q2`;
    a = await freshAdmin(dir2);
    const seq = [];
    for (let i = 0; i < 12; i++) seq.push((await initUp(a.jar, 1000, `ouvert-${i}.mp4`)).status);
    ok("SB60 Q2 au plus 10 envois ouverts par administrateur (le 11e est refusé en 429)", seq.slice(0, 10).every((s) => s === 200) && seq[10] === 429 && seq[11] === 429, seq.join(","));
    await stop(a.server);
    const dir3 = `${TMP}/q3`;
    a = await freshAdmin(dir3);
    const par2 = await Promise.all(Array.from({ length: 25 }, (_, i) => initUp(a.jar, 1000, `p-${i}.mp4`)));
    const open3 = query(dir3, "select count(*) n from uploads").n;
    ok("SB60 Q3 25 init simultanés : exactement 10 envois ouverts (pas de course sur le plafond)", open3 === 10, `${open3} ouverts ; statuts ${[...new Set(par2.map((r) => r.status))]}`);
    // le chemin « kit » (purpose) passe par la même réservation
    await stop(a.server);

    // disque presque plein
    const dir4 = `${TMP}/q4`;
    a = await freshAdmin(dir4, { UPLOAD_MIN_FREE_MB: String(1024 * 1024 * 1024) });
    const di = await initUp(a.jar, 1000, "disque.mp4");
    const fd = new FormData();
    fd.append("file", new Blob([await noise(64, 64)], { type: "image/png" }), "petit.png");
    const dd = await http("/admin/api/upload", { jar: a.jar, method: "POST", raw: fd, headers: { origin: BASE } });
    ok("SB60 Q4 disque presque plein (UPLOAD_MIN_FREE_MB) : init et envoi direct refusés (507)", di.status === 507 && dd.status === 507, `${di.status} ${dd.status}`);
    await stop(a.server);

    // envois directs parallèles à quota presque plein (la réservation ne couvre que init)
    const dir5 = `${TMP}/q5`;
    a = await freshAdmin(dir5);
    await stop(a.server);
    const used5 = usageOf(dir5);
    a = await freshAdmin(dir5, { MEDIA_MAX_TOTAL_GB: String((used5 + 2.5 * MB) / 1024 ** 3) });
    const pngs = await Promise.all(Array.from({ length: 8 }, () => noise(600, 600)));
    const sizeEach = pngs[0].length;
    const direct = await Promise.all(
      pngs.map((p, i) => {
        const f = new FormData();
        f.append("file", new Blob([p], { type: "image/png" }), `d${i}.png`);
        return http("/admin/api/upload", { jar: a.jar, method: "POST", raw: f, headers: { origin: BASE } });
      }),
    );
    await sleep(1500);
    const okCount = direct.filter((r) => r.status === 200).length;
    const quota = 2.5 * MB;
    const allowed = Math.floor(quota / sizeEach);
    info("envois directs parallèles", `${direct.map((r) => r.status).join(",")} ; taille ${(sizeEach / MB).toFixed(2)} Mo ; place pour ${allowed} originaux (variantes en plus)`);
    ok("SB60 Q5 8 envois DIRECTS simultanés à quota presque plein : pas plus que la place (résiduel : la réservation ne couvre que /init)", okCount <= allowed + 0, `${okCount} acceptés pour ${allowed} de place`);
    await stop(a.server);
  }

  /* ====================================================================== K */
  if (run("K")) {
    console.log("\n== K. #58 sauvegardes sans secrets, téléchargement confirmé, ancienne sauvegarde");
    const dir = `${TMP}/k`;
    const { server, jar } = await freshAdmin(dir, { WITH_BACKUP: "1", BACKUP_QUIET_SEC: "3600" });
    // jeton OAuth synthétique dans la base du site (comme après une connexion Authentik)
    const user = query(dir, "select id from user limit 1");
    writeDb(dir, "insert or replace into account (id, account_id, provider_id, user_id, access_token, refresh_token, id_token, created_at, updated_at) values ('acc-synth', 'sub-synth', 'authentik', ?, 'ACCESSTOKEN-SYNTH-123', 'REFRESHTOKEN-SYNTH-456', 'IDTOKEN-SYNTH-789', 1, 1)", user.id);
    const sessionToken = query(dir, "select token from session limit 1")?.token;
    const sessionCookie = jar.header();
    const bk = await action(jar, "backupNowAction", [], "/admin/sauvegardes");
    let archive = null;
    for (let i = 0; i < 80 && !archive; i++) {
      await sleep(500);
      archive = existsSync(`${dir}/backup`) ? readdirSync(`${dir}/backup`).find((n) => /^portfolio-.*\.tar\.gz$/.test(n)) : null;
    }
    ok("SB58 K0 une sauvegarde est produite (« Sauvegarder maintenant »)", Boolean(archive), `${bk.status} ${bk.text.slice(0, 100)}`);
    const arch = archive ? path.join(dir, "backup", archive) : null;
    const extractedDb = path.join(TMP, "k-extracted.db");
    if (arch) {
      const t = spawnSync("sh", ["-c", `tar -xzOf '${arch}' portfolio.db > '${extractedDb}'`]);
      const copy = new Database(extractedDb, { readonly: true });
      const sessions = copy.prepare("select count(*) n from session").get().n;
      const tok = copy.prepare("select access_token a, refresh_token r, id_token i from account where id = 'acc-synth'").get();
      const pw = copy.prepare("select count(*) n from account where password is not null").get().n;
      copy.close();
      const bytes = readFileSync(extractedDb);
      ok("SB58 K1 la sauvegarde ne contient aucune session", sessions === 0, `${sessions} session(s) dans l'archive`);
      ok("SB58 K2 la sauvegarde ne contient aucun jeton OAuth", tok && !tok.a && !tok.r && !tok.i, JSON.stringify(tok));
      ok("SB58 K3 aucun octet du jeton de session ni des jetons OAuth dans le fichier (pages libres comprises)", !(sessionToken && bytes.includes(sessionToken)) && !bytes.includes("ACCESSTOKEN-SYNTH") && !bytes.includes("REFRESHTOKEN-SYNTH") && !bytes.includes("IDTOKEN-SYNTH"));
      ok("SB58 K4 l'empreinte du mot de passe est conservée (la restauration ne verrouille pas l'admin)", pw >= 1, String(pw));
      const live = query(dir, "select count(*) n from session").n;
      ok("SB58 K5 la base du site garde sa session (le nettoyage ne touche que la copie)", live >= 1, String(live));
    }
    // téléchargement : session fraîche → 200 ; session « volée » ancienne → 403
    if (archive) {
      const url = `/api/admin/sauvegardes/${archive}`;
      const fresh = await http(url, { jar });
      await fresh.arrayBuffer();
      ok("SB58 K6 session fraîche (< 10 min) : téléchargement possible", fresh.status === 200, String(fresh.status));
      const row = query(dir, "select created_at c from session limit 1");
      const ms = row.c > 1e12;
      writeDb(dir, "update session set created_at = ?", ms ? Date.now() - 3600_000 : Math.floor(Date.now() / 1000) - 3600);
      const stolen = await http(url, { jar });
      await stolen.arrayBuffer();
      ok("SB58 K7 cookie de session ANCIEN (volé) : téléchargement refusé (403)", stolen.status === 403, String(stolen.status));
      const head = await http(url, { jar, method: "HEAD" });
      ok("SB58 K8 idem en HEAD, et en Range", head.status === 403 && (await http(url, { jar, headers: { range: "bytes=0-99" } })).status === 403);
      // déverrouillage : mauvais mot de passe, puis bon
      const wrong = await action(jar, "unlockBackupDownloadAction", [{ password: "mauvais" }], "/admin/sauvegardes", { "x-forwarded-for": "203.0.113.50" });
      ok("SB58 K9 mauvais mot de passe : pas de cookie de déverrouillage", !jar.cookies.has("pf-backup-unlock") && /wrong|incorrect/i.test(wrong.text), wrong.text.slice(0, 120));
      const good = await action(jar, "unlockBackupDownloadAction", [{ password: ADMIN.password }], "/admin/sauvegardes", { "x-forwarded-for": "203.0.113.51" });
      const cookieOk = jar.cookies.has("pf-backup-unlock");
      const after = await http(url, { jar });
      await after.arrayBuffer();
      ok("SB58 K10 bon mot de passe : cookie posé et téléchargement 200 pendant 10 min", cookieOk && after.status === 200, `${good.status} cookie=${cookieOk} ${after.status}`);
      // cookie de déverrouillage rejoué avec un AUTRE cookie de session (même secret) → refusé
      const other = new Jar();
      await signIn(other);
      writeDb(dir, "update session set created_at = ?", ms ? Date.now() - 7200_000 : Math.floor(Date.now() / 1000) - 7200);
      other.cookies.set("pf-backup-unlock", jar.cookies.get("pf-backup-unlock"));
      const cross = await http(url, { jar: other });
      await cross.arrayBuffer();
      ok("SB58 K11 cookie de déverrouillage d'une autre session : refusé", cross.status === 403, String(cross.status));
      const forged = new Jar();
      forged.cookies = new Map([...other.cookies].filter(([k]) => k !== "pf-backup-unlock"));
      forged.cookies.set("pf-backup-unlock", `${Date.now() + 5 * 60_000}.${"A".repeat(43)}`);
      const f = await http(url, { jar: forged });
      await f.arrayBuffer();
      ok("SB58 K12 cookie de déverrouillage forgé : refusé", f.status === 403, String(f.status));
      const noCookie = await http(url);
      ok("SB58 K13 sans aucune session : 401", noCookie.status === 401, String(noCookie.status));
      // session neuve mais ancienne, sans cookie de déverrouillage : celle d'un voleur qui devine le mot de passe
      const bf = new Jar();
      await signIn(bf);
      writeDb(dir, "update session set created_at = ?", ms ? Date.now() - 7200_000 : Math.floor(Date.now() / 1000) - 7200);
      // frein : 30 essais parallèles de mauvais mots de passe → seuls IP_MAX (5) sont jugés, le reste est ralenti
      const burst = await Promise.all(Array.from({ length: 30 }, () => action(bf, "unlockBackupDownloadAction", [{ password: "essai-brute-force" }], "/admin/sauvegardes", { "x-forwarded-for": "203.0.113.77" })));
      const judged = burst.filter((r) => /"reauth":"wrong"/.test(r.text)).length;
      const throttled = burst.filter((r) => /"reauth":"throttled"/.test(r.text)).length;
      info("exemple de réponse du frein", `${burst[0].status} ${burst[0].text.replace(/\s+/g, " ").slice(0, 220)} | dernière : ${burst[29].text.replace(/\s+/g, " ").slice(0, 200)}`);
      info("30 mauvais mots de passe en parallèle, même IP", `${judged} jugés, ${throttled} freinés`);
      ok("SB58 K14 frein de la confirmation : au plus 6 essais jugés sur 30 en parallèle (IP_MAX = 5)", judged <= 6 && judged + throttled >= 25, `${judged} jugés / ${throttled} freinés`);
      // contournement : X-Forwarded-For falsifié (préfixe tournant ; AUTH_TRUSTED_PROXY_HOPS=1 : seule la DERNIÈRE entrée, posée par le proxy, compte)
      const rot = [];
      for (let i = 0; i < 12; i++) rot.push(await action(bf, "unlockBackupDownloadAction", [{ password: `essai-${i}` }], "/admin/sauvegardes", { "x-forwarded-for": `203.0.113.${100 + i}, 198.51.100.200` }));
      const rotJudged = rot.filter((r) => /"reauth":"wrong"/.test(r.text)).length;
      ok("SB58 K15 X-Forwarded-For falsifié en préfixe (le proxy ajoute la vraie IP) : le frein par IP tient (au plus 6 essais jugés sur 12)", rotJudged > 0 && rotJudged <= 6, `${rotJudged} jugés sur 12`);
    }
    await stop(server);

    // ancienne sauvegarde (avec secrets) restaurée sur un site neuf : que se passe-t-il ?
    console.log("-- K16 restauration d'une sauvegarde ANCIENNE qui contient des sessions");
    const oldDir = `${TMP}/k-old`;
    const o = await freshAdmin(oldDir);
    const oldCookie = o.jar.header();
    // archive « ancienne » : fabriquée comme avant #58 (base entière, sessions comprises)
    await stop(o.server);
    const staging = `${TMP}/k-stage`;
    mkdirSync(staging, { recursive: true });
    const snap = new Database(path.join(oldDir, "portfolio.db"), { readonly: true });
    await snap.backup(path.join(staging, "portfolio.db"));
    snap.close();
    writeFileSync(path.join(staging, "manifest.json"), JSON.stringify({ version: "0.34.0", createdAt: new Date().toISOString(), reason: "manuel", mediaCount: 0, includesMedia: false, storage: {} }));
    spawnSync("tar", ["-czf", `${TMP}/ancienne.tar.gz`, "-C", staging, "manifest.json", "portfolio.db"]);
    const target = `${TMP}/k-restored`;
    mkdirSync(target, { recursive: true });
    const rr = spawnSync(process.execPath, [path.join(ROOT, "scripts/restore-backup.mjs"), "--force", `${TMP}/ancienne.tar.gz`, target], { encoding: "utf8" });
    const r2 = startServer(target);
    const up = await r2.ready;
    const reuse = await http("/admin", { jar: Object.assign(new Jar(), { header: () => oldCookie, cookies: new Map([["x", "y"]]) }) });
    info("ancienne sauvegarde restaurée : l'ancien cookie de session est-il accepté ?", `restauration code ${rr.status}, serveur ${up ? "démarré" : "KO"}, GET /admin avec l'ancien cookie → ${reuse.status}`);
    ok("SB58 K16 une sauvegarde d'avant #58 restaurée NE ressuscite PAS les sessions d'avant (cookie volé refusé)", reuse.status !== 200, `GET /admin → ${reuse.status} (200 = session rouverte par la restauration)`);
    await stop(r2);
  }

  /* ====================================================================== W */
  if (run("W")) {
    console.log("\n== W. #55 nom d'un papier peint dans le site public");
    const dir = `${TMP}/w`;
    const a = await freshAdmin(dir);
    await stop(a.server);
    const SECRETNAME = "client x confidentiel";
    const db = new Database(path.join(dir, "portfolio.db"));
    db.pragma("busy_timeout = 5000");
    const mediaId = db
      .prepare("insert into media (key, sha256, kind, mime, original_name, size, status, width, height, variants, alt) values (?,?,?,?,?,?,?,?,?,?,?)")
      .run("originals/wp1.png", "ab".repeat(32), "image", "image/png", "client-x-confidentiel.png", 10, "ready", 200, 200, JSON.stringify({ v: 1, files: [{ key: "img/abababababababab/200.webp", size: 5, format: "webp", w: 200, width: 200 }] }), JSON.stringify({ fr: "", en: "" })).lastInsertRowid;
    const wid = db.prepare("insert into wallpapers (name, media_id, size, opacity) values (?,?,?,?)").run(SECRETNAME, mediaId, 300, 1).lastInsertRowid;
    // un papier de carte sur tout le site, et un fond « papier peint » dans la planche d'un projet publié
    const proj = db.prepare("select id, slug, layout from projects where deleted_at is null and layout is not null limit 1").get();
    const layout = JSON.parse(proj.layout);
    const items = Array.isArray(layout) ? layout : layout.items ?? layout.layout ?? [];
    if (items[0]) items[0].props = { ...(items[0].props ?? {}), background: { kind: "wallpaper", wallpaper: Number(wid), size: 300, opacity: 1 } };
    db.prepare("update projects set layout = ? where id = ?").run(JSON.stringify(Array.isArray(layout) ? items : layout), proj.id);
    const settings = db.prepare("select key, value from settings where key = 'styles'").get();
    const styles = settings ? JSON.parse(settings.value) : {};
    styles.cardWallpaper = { wallpaper: Number(wid), size: 300, opacity: 1 };
    db.prepare("insert or replace into settings (key, value) values ('styles', ?)").run(JSON.stringify(styles));
    const pages = db.prepare("select slug from pages where deleted_at is null limit 20").all().map((p) => p.slug);
    db.close();
    const s = startServer(dir);
    await s.ready;
    const urls = new Set(["/fr", "/en", ...pages.flatMap((p) => [`/fr/${p}`, `/fr/${p}/${proj.slug}`, `/fr/projets/${proj.slug}`, `/en/${p}`]), `/fr/${proj.slug}`]);
    let found = 0;
    let fetched = 0;
    let withWallpaperPayload = 0;
    for (const u of urls) {
      for (const rsc of [false, true]) {
        const r = await http(u, { headers: rsc ? { rsc: "1" } : {} });
        if (r.status !== 200) continue;
        fetched++;
        const text = await r.text();
        if (/wallpaper/i.test(text) && /"w":200|--wp|wp-/i.test(text)) withWallpaperPayload++;
        const at = text.toLowerCase().indexOf(SECRETNAME);
        if (at >= 0 || text.toLowerCase().includes("client-x-confidentiel")) {
          found++;
          if (found === 1) info("première occurrence", `${u}${rsc ? " (RSC)" : ""} : …${text.slice(Math.max(0, at - 60), at + 40).replace(/\s+/g, " ")}…`);
        }
      }
    }
    info("pages publiques interrogées (HTML + flux RSC)", `${fetched} réponses, dont ${withWallpaperPayload} portant des données de papier peint`);
    ok("SB55 W0 la mise en place expose bien un papier peint au rendu public (sinon le test ne prouve rien)", withWallpaperPayload > 0);
    ok("SB55 W1 le nom du papier peint (nom du fichier envoyé) n'apparaît dans aucune page publique ni dans le flux RSC", found === 0, `${found} réponse(s) contiennent le nom`);
    await stop(s);
  }

  /* ====================================================================== V */
  if (run("V")) {
    console.log("\n== V. #32 ffmpeg / ffprobe : environnement transmis (serveur réel, espions dans le PATH)");
    const shims = `${TMP}/vshims`;
    const dumps = `${TMP}/vdumps`;
    mkdirSync(shims, { recursive: true });
    mkdirSync(dumps, { recursive: true });
    const real = (n) => spawnSync("sh", ["-c", `command -v ${n}`], { encoding: "utf8" }).stdout.trim();
    for (const n of ["ffmpeg", "ffprobe"]) {
      writeFileSync(path.join(shims, n), `#!/bin/sh\n{ echo "ARGS=$*"; env; } > "${dumps}/${n}.$$.env"\nexec ${real(n)} "$@"\n`);
      chmodSync(path.join(shims, n), 0o755);
    }
    const video = `${TMP}/v.mp4`;
    spawnSync(real("ffmpeg"), ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", video]);
    const data = readFileSync(video);
    const dir = `${TMP}/v`;
    const extra = { OIDC_CLIENT_SECRET: "SYNTH-oidc-client-secret", SYNTH_API_TOKEN: "SYNTH-api-token-xyz" };
    const { server, jar } = await freshAdmin(dir, extra, shims);
    const H = { cookie: jar.header(), origin: BASE };
    async function sendVideo(name) {
      const init = await fetch(`${BASE}/admin/api/upload/init`, { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ name, size: data.length, type: "video/mp4" }) });
      const id = (await init.json()).upload?.id;
      await fetch(`${BASE}/admin/api/upload/${id}/chunk?offset=0`, { method: "PUT", headers: { ...H, "content-length": String(data.length) }, body: data });
      const done = await fetch(`${BASE}/admin/api/upload/${id}/complete`, { method: "POST", headers: H });
      const j = await done.json().catch(() => ({}));
      return j.media?.id ?? j.mediaId ?? query(dir, "select max(id) m from media").m;
    }
    const m1 = await sendVideo("synth1.mp4");
    let row;
    for (let i = 0; i < 180; i++) {
      row = query(dir, "select status, error from media where id = ?", m1);
      if (row && row.status !== "processing") break;
      await sleep(500);
    }
    // Le jeton interne naît au premier appel de la route de revalidation (ou de la notification du worker) : on le force ici.
    await fetch(`${BASE}/api/internal/revalidate`, { method: "POST", headers: { "x-portfolio-internal-token": "faux", "content-type": "application/json" }, body: "{}" });
    const m2 = await sendVideo("synth2.mp4"); // jeton interne maintenant dans process.env (avant #32)
    for (let i = 0; i < 180; i++) {
      const r2 = query(dir, "select status from media where id = ?", m2);
      if (r2 && r2.status !== "processing") break;
      await sleep(500);
    }
    ok("SB32 V0 la vidéo est convertie par le serveur réel avec l'environnement minimal (statut ready)", row?.status === "ready", JSON.stringify(row));
    const files = readdirSync(dumps).map((f) => ({ f, text: readFileSync(path.join(dumps, f), "utf8") }));
    const sites = {
      "ffprobe (probe.ts)": files.filter((x) => x.f.startsWith("ffprobe")),
      "ffmpeg de conversion (transcode.ts)": files.filter((x) => x.f.startsWith("ffmpeg") && !/volumedetect/.test(x.text)),
      "ffmpeg « volumedetect » (audio.ts, lot 116)": files.filter((x) => x.f.startsWith("ffmpeg") && /volumedetect/.test(x.text)),
    };
    const leaks = (list) => {
      const s = new Set();
      for (const x of list)
        for (const line of x.text.split("\n")) {
          const k = line.split("=")[0];
          if (/SECRET|PASSWORD|TOKEN|PASSWD/i.test(k) && !/^ARGS$/.test(k)) s.add(k);
          if (line.includes("SYNTH-") || line.includes(SECRET) || line.includes(ADMIN.password)) s.add(k);
        }
      return [...s];
    };
    for (const [label, list] of Object.entries(sites)) {
      const l = leaks(list);
      ok(`SB32 V1 ${label} : aucun secret dans l'environnement de l'enfant (${list.length} lancement(s))`, list.length > 0 && l.length === 0, l.length ? `FUITE : ${l.join(", ")}` : "aucun lancement observé");
    }
    ok("SB32 V2 le jeton interne PORTFOLIO_INTERNAL_TOKEN n'apparaît dans aucun processus enfant", !files.some((x) => /PORTFOLIO_INTERNAL_TOKEN=/.test(x.text)), "présent");
    await stop(server);
  }
} finally {
  for (const c of servers) if (c.exitCode === null) c.kill("SIGKILL");
}
console.log(failures ? `\n${failures} échec(s) : l'attaque réussit` : "\nattaques bloquées");
process.exit(failures ? 1 : 0);
