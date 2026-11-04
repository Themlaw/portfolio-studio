#!/usr/bin/env node
/**
 * Tests d'intégration de l'authentification, sur le build standalone en
 * production (après `npm run build:local`, serveur dev ARRÊTÉ : RAM).
 *
 * Lance le serveur avec différents environnements et un faux fournisseur OIDC
 * local (oauth2-mock-server) :
 *  A. mot de passe : amorçage, redirections, échec/succès, cookies, 403 d'une
 *     server action, en-têtes de sécurité, erreurs de connexion sans reflet,
 *     aperçu de thème (server actions, CSRF, cookie sans session ignoré,
 *     fin à la déconnexion), limitation de débit par IP (XFF, sauts de
 *     confiance, rotation, seau partagé) et délai par compte ;
 *     + scénario I2b de l'audit (attaquant sur une IP, admin sur une autre) ;
 *  B. amorçage idempotent + avertissement ADMIN_PASSWORD ;
 *  C. AUTH_PASSWORD_DISABLED sans OIDC → ignoré + avertissement ;
 *  D. OIDC de bout en bout : sub, groupe, e-mail vérifié / non vérifié,
 *     e-mail de l'admin sur un autre sub (aucune liaison), endpoints mot de
 *     passe fermés, sessions révoquées quand l'accès est retiré ;
 *  E. secret absent / trop court en production → arrêt explicite.
 *  TH. thèmes : export / import d'archive (garde, origine, archives piégées, tailles).
 * Usage : npm run test:auth   (exit 1 si un test échoue)
 */
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import sharp from "sharp";
import { createDeflate } from "node:zlib";
import { request as httpRequest } from "node:http";
import { utimesSync, writeFileSync } from "node:fs";
import { OAuth2Server } from "oauth2-mock-server";
import { initializeCanvas, readPsd, writePsdBuffer } from "ag-psd";

const ROOT = new URL("..", import.meta.url).pathname;
const SA = path.join(ROOT, ".next/standalone");
// Données de test : sur disque si TEST_AUTH_TMP le dit (le /tmp de la VM est un tmpfs : les
// mesures vidéo y manquent de place, ENOSPC → 500 sur la 4K).
const TMP = process.env.TEST_AUTH_TMP ?? "/tmp/portfolio-test-auth";
// Ports réglables (BATT_AUTH_PORT) : plusieurs batteries peuvent lancer la suite sur la même machine (défaut 3200 et 3290).
const PORT = Number(process.env.BATT_AUTH_PORT ?? 3200);
const MOCK_PORT = PORT + 90;
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = "test-secret-0123456789abcdef-0123456789abcdef";
const ADMIN = { email: "artiste@example.test", password: "mot-de-passe-du-test-42" };

let failures = 0;
const ok = (label, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!pass) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- outils -- */

function prepareStandalone() {
  if (!existsSync(path.join(SA, "server.js"))) throw new Error("Build absent : lancer `npm run build:local` d'abord.");
  for (const dir of ["drizzle", "seed", "public"]) cpSync(path.join(ROOT, dir), path.join(SA, dir), { recursive: true });
  cpSync(path.join(ROOT, ".next/static"), path.join(SA, ".next/static"), { recursive: true });
}

/** Démarre le serveur ; `ready` résout quand /fr répond, ou quand le processus sort. */
/* Serveurs lancés : arrêtés à la sortie, même sur une exception (port libre au run suivant). */
const servers = new Set();
process.on("exit", () => {
  for (const c of servers) if (c.exitCode === null) c.kill("SIGKILL");
  spawnSync("pkill", ["-KILL", "-x", "ffmpeg"]);
});

/** `probe` : chemin interrogé pour savoir le serveur prêt (« /fr » le met en cache). */
function startServer(dataDir, env, probe = "/fr") {
  mkdirSync(dataDir, { recursive: true });
  const logs = [];
  const child = spawn(process.execPath, ["server.js"], {
    cwd: SA,
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "production",
      PORT: String(PORT),
      HOSTNAME: "127.0.0.1",
      DATA_DIR: dataDir,
      PUBLIC_BASE_URL: BASE,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  servers.add(child);
  child.stdout.on("data", (d) => logs.push(String(d)));
  child.stderr.on("data", (d) => logs.push(String(d)));
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  const ready = (async () => {
    for (let i = 0; i < 60; i++) {
      if (child.exitCode !== null) return false;
      try {
        if ((await fetch(`${BASE}${probe}`)).status === 200) return true;
      } catch {}
      await sleep(250);
    }
    return false;
  })();
  return { child, logs, exited, ready, text: () => logs.join("") };
}

async function stop(server) {
  if (server.child.exitCode === null) server.child.kill("SIGTERM");
  await server.exited;
}

/** Pot à cookies minimal (ignore l'attribut Secure : test en http local). */
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
  copy(filter = () => true) {
    const j = new Jar();
    for (const [k, v] of this.cookies) if (filter(k)) j.cookies.set(k, v);
    return j;
  }
}

async function http(url, { jar, method = "GET", body, raw, form, headers = {} } = {}) {
  const res = await fetch(url.startsWith("http") ? url : `${BASE}${url}`, {
    method,
    redirect: "manual",
    headers: {
      ...(jar && jar.cookies.size ? { cookie: jar.header() } : {}),
      ...(body ? { "content-type": "application/json", origin: BASE } : {}),
      ...headers,
    },
    body: form ?? raw ?? (body ? JSON.stringify(body) : undefined),
  });
  jar?.store(res);
  return res;
}

/** Connexion par mot de passe ; `xff` = X-Forwarded-For tel que l'app le reçoit. */
function signIn(jar, email, password, xff = "203.0.113.10") {
  return http("/api/auth/sign-in/email", { jar, method: "POST", body: { email, password }, headers: { "x-forwarded-for": xff } });
}

function query(dataDir, sql, ...params) {
  const db = new Database(path.join(dataDir, "portfolio.db"), { readonly: true });
  const row = db.prepare(sql).get(...params);
  db.close();
  return row;
}
const userCount = (dataDir) => query(dataDir, "select count(*) n from user").n;
/** Lignes du journal d'édition (base à part, edit-log.db). */
function logRows(dataDir, where = "1 = 1", ...params) {
  const file = path.join(dataDir, "edit-log.db");
  if (!existsSync(file)) return [];
  const db = new Database(file, { readonly: true });
  db.pragma("busy_timeout = 2000");
  const rows = db.prepare(`select action, type, user, result, label, target from edit_log where ${where} order by id`).all(...params);
  db.close();
  return rows;
}

/** Server actions de l'admin (même liste que scripts/test-admin-guard.mjs). */
const ADMIN_ACTIONS = [
  "signOutAction",
  "applyKitImportAction",
  "duplicateThemeAction",
  "saveThemeAction",
  "activateThemeAction",
  "deleteThemeAction",
  "resetSiteColorsAction",
  "applyModelAction",
  "revertVersionAction",
  "keepVersionCopyAction",
  "pinVersionAction",
  "adoptOldThemeAction",
  "closeEditSessionAction",
  "importThemeLogoAction",
  "saveSettingsAction",
  "saveSeoAction",
  "markMessagesSeenAction",
  "setOnboardingHiddenAction",
  "createPageAction",
  "savePageInfoAction",
  "saveDraftAction",
  "publishDraftAction",
  "discardDraftAction",
  "boardAction",
  "restoreBoardAction",
  "siteDraftAction",
  "discardSiteDraftAction",
  "installFontAction",
  "deleteFontAction",
  "deleteMessageAction",
  "deleteAllMessagesAction",
  "createDraftProjectAction",
  "setPublishedAction",
  "setInMenuAction",
  "addToMenuFromEditorAction",
  "reorderMenuAction",
  "deletePageAction",
  "restorePageAction",
  "purgeTrashItemAction",
  "emptyTrashAction",
  "createProjectAction",
  "saveProjectAction",
  "reorderProjectsAction",
  "deleteProjectAction",
  "restoreProjectAction",
  "addSlotsAction",
  "saveSlotAction",
  "setSlotMediaAction",
  "deleteSlotAction",
  "reorderSlotsAction",
  "saveMediaAltAction",
  "deleteMediaAction",
  "restoreMediaAction",
  "mediaStatusAction",
  "mediaUsesAction",
  "retryMediaAction",
  "pendingUploadsAction",
  "listTagsAction",
  "setMediaTagsAction",
  "addMediaTagsAction",
  "removeMediaTagsAction",
  "renameTagAction",
  "mergeTagsAction",
  "deleteTagAction",
  "deleteUnusedTagsAction",
  "createWallpaperAction",
  "renameWallpaperAction",
  "saveWallpaperPaintAction",
  "wallpaperUsesAction",
  "trashWallpaperAction",
  "restoreWallpaperAction",
  "saveCardWallpaperAction",
  "saveThemeFrameAllAction",
  "listWallpapersAction",
];

/** Identifiants des server actions, lus dans le manifeste du build. */
function actionIds() {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, ".next/server/server-reference-manifest.json"), "utf8"));
  const ids = {};
  for (const [id, entry] of Object.entries(manifest.node ?? {})) {
    const text = JSON.stringify(entry);
    for (const name of ADMIN_ACTIONS) {
      if (entry.exportedName === name || text.includes(`"${name}"`)) ids[name] ??= id;
    }
  }
  return ids;
}

/** Formulaire natif POST (multipart), comme un navigateur sans JavaScript. */
function postForm(jar, page, fields = {}, headers = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return http(page, { jar, method: "POST", form, headers: { origin: BASE, ...headers } });
}

function writeDb(dataDir, sql, ...params) {
  const db = new Database(path.join(dataDir, "portfolio.db"));
  db.pragma("busy_timeout = 5000");
  db.prepare(sql).run(...params);
  db.close();
}

/** Appel d'une server action comme un formulaire sans JavaScript (multipart). */
function callAction(jar, id, fields = {}, origin = BASE, page = "/admin/themes") {
  const form = new FormData();
  form.append(`$ACTION_ID_${id}`, "");
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return http(page, { jar, method: "POST", form, headers: { origin } });
}

/**
 * Ancien « formulaire de page » (savePageAction, retiré au lot 51 : un seul Publier) : enregistre le contenu en brouillon puis
 * le publie. `rev` : version supposée (défaut : la courante) ; une version périmée ou un brouillon illisible sont refusés
 * dès l'enregistrement, comme avant.
 */
async function savePageForm(jar, id, payload, rev = query(dirA, "select draft_rev r from pages where id = ?", id)?.r, page = "/admin") {
  // Les actions du brouillon se résolvent depuis l'écran de l'éditeur ; les rubriques du brouillon portent un `uid`.
  const editor = `/admin/pages/${id}/editer`;
  const draft = Array.isArray(payload?.blocks) ? { ...payload, blocks: payload.blocks.map((b, i) => (b.uid ? b : { ...b, uid: `f${i}` })) } : payload;
  const saved = await callActionJson(jar, ids.saveDraftAction, [id, draft, rev], editor);
  if (!saved.text.includes('"ok":true')) return saved;
  const next = Number(/"rev":(\d+)/.exec(saved.text)?.[1]);
  return callActionJson(jar, ids.publishDraftAction, [id, next], editor);
}
function callSavePage(jar, [id, payload], page) {
  return savePageForm(jar, id, payload, undefined, page);
}

/** Appel direct d'une server action (arguments JSON), comme le ferait un client forgé. */
async function callActionJson(jar, id, args, page = "/admin") {
  const r = await http(page, {
    jar,
    method: "POST",
    raw: JSON.stringify(args),
    headers: { "next-action": id, "content-type": "text/plain;charset=UTF-8", origin: BASE },
  });
  return { status: r.status, text: await r.text() };
}


/* ---------------------------------------------------- envois (phase 4b) -- */

/** Corps multipart d'un fichier (Buffer). */
function multipart(filename, contentType, data) {
  const boundary = `----portfolio${Date.now()}${Math.random().toString(16).slice(2)}`;
  // Nom non ASCII ou avec caractères de contrôle : encodage RFC 5987 (filename*).
  const plain = /^[\x20-\x7e]*$/.test(filename) && !filename.includes('"');
  const disposition = plain ? `filename="${filename}"` : `filename="upload"; filename*=UTF-8''${encodeURIComponent(filename)}`;
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; ${disposition}\r\nContent-Type: ${contentType}\r\n\r\n`);
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, data, tail]), type: `multipart/form-data; boundary=${boundary}` };
}

async function upload(jar, filename, contentType, data, { origin = BASE } = {}) {
  const { body, type } = multipart(filename, contentType, data);
  const res = await http("/admin/api/upload", { jar, method: "POST", raw: body, headers: { "content-type": type, origin } });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // réponse non JSON (redirection du proxy…)
  }
  return { status: res.status, json, text };
}

/** Pic de mémoire résidente d'un processus (VmHWM, Mo) et mémoire actuelle (VmRSS). */
function procMem(pid) {
  const status = readFileSync(`/proc/${pid}/status`, "utf8");
  const kb = (k) => Number(new RegExp(`${k}:\\s+(\\d+)`).exec(status)?.[1] ?? 0);
  return { hwm: Math.round(kb("VmHWM") / 1024), rss: Math.round(kb("VmRSS") / 1024) };
}

/** Attend la fin du traitement d'un média (base de test). */
async function waitMedia(dataDir, id, timeoutMs = 60000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const row = query(dataDir, "select status, error, variants from media where id = ?", id);
    if (row && row.status !== "processing") return row;
    if (Date.now() > end) return row;
    await sleep(300);
  }
}

/** Requête brute (en-têtes choisis, corps partiel) : statut et durée de la réponse. */
function rawPost(pathname, headers, body) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const req = httpRequest({ host: "127.0.0.1", port: PORT, path: pathname, method: "POST", headers }, (res) => {
      let text = "";
      res.on("data", (d) => (text += d));
      res.on("end", () => resolve({ status: res.statusCode, text, ms: Date.now() - t0 }));
    });
    req.on("error", (e) => resolve({ status: -1, text: String(e), ms: Date.now() - t0 }));
    req.write(body);
    // Corps volontairement incomplet : la connexion reste ouverte jusqu'à la réponse.
    setTimeout(() => req.destroy(), 8000);
  });
}

/** Corps multipart à plusieurs parties : [{ name, filename?, type?, data }]. */
function multipartParts(parts) {
  const boundary = `----parts${Date.now()}`;
  const chunks = [];
  for (const p of parts) {
    const disp = p.filename !== undefined ? `form-data; name="${p.name}"; filename="${p.filename}"` : `form-data; name="${p.name}"`;
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: ${disp}\r\n${p.type ? `Content-Type: ${p.type}\r\n` : ""}\r\n`), p.data, Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), type: `multipart/form-data; boundary=${boundary}` };
}

/** PNG valide de 50 000 × 50 000 (1 bit, ~300 Ko compressé) : une « bombe » de pixels. */
function pixelBomb() {
  return pngOf(50000, 50000, 1, 0);
}

/**
 * PNG valide très compressible (pixels nuls), généré en flux : largeur,
 * hauteur, profondeur (1, 8, 16), type de couleur (0 gris, 2 RVB).
 */
async function pngOf(W, H, depth, colorType, orientation = 0) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = depth;
  ihdr[9] = colorType;
  const channels = colorType === 2 ? 3 : 1;
  const row = Buffer.alloc(1 + Math.ceil((W * channels * depth) / 8)); // filtre 0 + pixels noirs
  const deflate = createDeflate({ level: 9 });
  const parts = [];
  deflate.on("data", (d) => parts.push(d));
  const done = new Promise((r) => deflate.on("end", r));
  for (let y = 0; y < H; y++) {
    if (!deflate.write(row)) await new Promise((r) => deflate.once("drain", r));
  }
  deflate.end();
  await done;
  // Orientation EXIF (chunk eXIf : TIFF minimal, une seule entrée 0x0112).
  const exif = orientation
    ? [chunk("eXIf", Buffer.from([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0, 0, 0, orientation, 0, 0, 0, 0, 0, 0, 0]))]
    : [];
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), ...exif, chunk("IDAT", Buffer.concat(parts)), chunk("IEND", Buffer.alloc(0))]);
}

/* ----------------------------------------------------------------- tests -- */

prepareStandalone();
rmSync(TMP, { recursive: true, force: true });
const baseEnv = { BETTER_AUTH_SECRET: SECRET, ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password };
const ids = actionIds();

console.log("\n== A. mot de passe");
const dirA = `${TMP}/a`;
let s = startServer(dirA, baseEnv);
ok("A0 démarrage", await s.ready);
ok("A1 premier admin amorcé", s.text().includes(`premier administrateur créé : ${ADMIN.email}`));
ok("A1b mot de passe absent des journaux", !s.text().includes(ADMIN.password));
ok("A1c avertissement : PUBLIC_BASE_URL en http en production", s.text().includes("PUBLIC_BASE_URL est en http"));

let r = await http("/admin");
ok("A2 /admin sans session → /admin/connexion", r.status === 307 && r.headers.get("location")?.endsWith("/admin/connexion"), `${r.status} ${r.headers.get("location")}`);
r = await http("/admin/themes");
ok("A2b /admin/themes sans session → redirection", r.status === 307, String(r.status));
// docs/SECURITE.md §2.2 / §5.1 : un cookie de session INVENTÉ + une requête RSC (navigation simulée, layout supposé déjà affiché)
// lisait toute l'admin (messages, réglages, journal, brouillons). Le proxy vérifie maintenant la session en base : 307, aucun contenu.
{
  const fakeCookie = "__Secure-better-auth.session_token=totally.made.up.AAAA; better-auth.session_token=totally.made.up.AAAA";
  const tree = encodeURIComponent(JSON.stringify(["", { children: ["admin", { children: ["(espace)", { children: ["pages", { children: ["__PAGE__", {}] }] }] }] }, null, null, true]));
  const ADMIN_PAGES = [
    "/admin", "/admin/messages", "/admin/reglages", "/admin/journal", "/admin/sauvegardes", "/admin/pages", "/admin/pages/1",
    "/admin/pages/1/editer", "/admin/projets", "/admin/projets/1", "/admin/medias", "/admin/themes", "/admin/themes/galerie-lumineuse",
    "/admin/themes/galerie-lumineuse/kit", "/admin/themes/galerie-lumineuse/versions", "/admin/cadres", "/admin/papiers-peints",
  ];
  const leaks = [];
  for (const page of ADMIN_PAGES) {
    for (const url of [`${page}?_rsc`, page]) {
      const rscHeaders = { cookie: fakeCookie, RSC: "1", "Next-Router-State-Tree": tree, "Next-Url": "/admin/pages" };
      let res = await http(url, { headers: rscHeaders });
      // Next renvoie d'abord vers l'empreinte `_rsc` attendue : on la suit, comme un vrai client.
      const loc = res.headers.get("location");
      if (res.status === 307 && loc?.includes("_rsc=")) res = await http(loc, { headers: rscHeaders });
      const body = await res.text();
      if (res.status !== 307 || !res.headers.get("location")?.endsWith("/admin/connexion") || body.length > 200) leaks.push(`${url} ${res.status} ${body.length} o`);
    }
  }
  ok("A2i faux cookie + RSC: 1 (+ ?_rsc) sur chaque page de l'admin → 307 vers la connexion, aucun contenu", leaks.length === 0, leaks.join(" ; ").slice(0, 300));
}
// docs/SECURITE.md N5 : un chemin à point ne sort plus du proxy (liste fermée), et /admin passe AVANT : /admin/x.y est gardé,
// /fr/a.b est un vrai 404 jamais mis en cache ; les fichiers de la racine et de public/ restent servis tels quels.
{
  r = await http("/admin/x.y");
  ok("A2j /admin/x.y sans session → redirigé par la garde de l'admin", r.status === 307 && r.headers.get("location")?.endsWith("/admin/connexion"), `${r.status} ${r.headers.get("location")}`);
  const dotted = [];
  for (const u of ["/fr/a.b", "/fr/x.1", "/en/a.b", "/wp-login.php"]) {
    let res = await http(u);
    if (res.status === 307 || res.status === 308) res = await http(res.headers.get("location") ?? "/");
    await res.text();
    if (res.status !== 404 || !/no-store/.test(res.headers.get("cache-control") ?? "") || res.headers.get("x-nextjs-cache")) dotted.push(`${u} ${res.status} ${res.headers.get("cache-control")} ${res.headers.get("x-nextjs-cache")}`);
  }
  ok("A2k chemins à point (/fr/a.b, /wp-login.php…) → 404 no-store, jamais en cache ISR", dotted.length === 0, dotted.join(" ; "));
  const files = [];
  for (const u of ["/favicon.ico", "/robots.txt", "/sitemap.xml", "/manifest.webmanifest", "/kit/Figtree.ttf"]) {
    const res = await http(u);
    await res.arrayBuffer();
    if (res.status !== 200) files.push(`${u} ${res.status}`);
  }
  ok("A2l fichiers de la racine et de public/ toujours servis (favicon, robots, sitemap, manifeste, /kit)", files.length === 0, files.join(" ; "));
}
// docs/SECURITE.md N1 : le proxy mettait en mémoire jusqu'à 10 Mo de chaque POST (même refusé), et la route d'auth lisait tout le
// corps sans borne avant la limite par IP. Corps du proxy borné à 1 Mo ; route d'auth : lecture en flux bornée à 16 Ko → 413.
{
  const big = Buffer.alloc(5 * 1024 * 1024, 0x61);
  const before = procMem(s.child.pid).rss;
  const sized = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      http("/api/auth/sign-in/email", { method: "POST", raw: big, headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": `203.0.113.${200 + i}` } }).then(async (res) => (await res.text(), res.status)),
    ),
  );
  const grown = procMem(s.child.pid).rss - before;
  ok("A2m 10 POST de 5 Mo vers /api/auth/sign-in/email → 413, mémoire du serveur contenue", sized.every((x) => x === 413) && grown < 60, `${sized.join(",")} ; +${grown} Mo`);
  // Sans Content-Length (flux découpé) : la route s'arrête à 16 Ko.
  const chunks = (async function* () {
    for (let i = 0; i < 64; i++) yield new Uint8Array(32 * 1024).fill(0x61);
  })();
  const res = await fetch(`${BASE}/api/auth/sign-in/email`, { method: "POST", body: chunks, duplex: "half", headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": "203.0.113.230" } });
  ok("A2n corps de 2 Mo sans Content-Length → 413", res.status === 413, String(res.status));
  // Limite du proxy lui-même : Next le dit dans son journal (« Request body exceeded 1MB »).
  await http("/api/contact", { method: "POST", raw: Buffer.alloc(2 * 1024 * 1024, 0x61), headers: { "content-type": "application/json", origin: BASE } }).then((x) => x.text());
  await sleep(200);
  ok("A2o corps lu par le proxy plafonné à 1 Mo (proxyClientMaxBodySize)", /Request body exceeded 1MB/.test(s.text()) && !/Request body exceeded 10MB/.test(s.text()), (/Request body exceeded [^.]*/.exec(s.text()) ?? [""])[0]);
}
// docs/SECURITE.md §2.12, P7, N20 : page 404 servie par une requête interne (port fixé, en-têtes en liste blanche, secret comparé en
// temps constant) : ni `Expect: 100-continue`, ni un port dans `Host`, ni un faux en-tête interne ne la détournent.
{
  const notFoundOk = async (headers) => {
    const res = await new Promise((resolve) => {
      const req = httpRequest({ host: "127.0.0.1", port: PORT, path: "/fr/page-qui-n-existe-pas", method: "GET", headers }, (out) => {
        let text = "";
        out.on("data", (d) => (text += d));
        out.on("end", () => resolve({ status: out.statusCode, text, cache: out.headers["cache-control"] }));
      });
      req.on("error", (e) => resolve({ status: -1, text: String(e) }));
      req.end();
    });
    return { pass: res.status === 404 && res.text.length > 500 && /no-store/.test(res.cache ?? ""), detail: `${res.status} ${res.text.length} o` };
  };
  let res = await notFoundOk({ expect: "100-continue" });
  ok("A2p page inconnue avec « Expect: 100-continue » → vraie page 404 (requête interne saine)", res.pass, res.detail);
  res = await notFoundOk({ host: "127.0.0.1:9" });
  ok("A2q port de l'en-tête Host ignoré pour la requête interne → vraie page 404", res.pass, res.detail);
  res = await notFoundOk({ "x-portfolio-internal": "00000000-0000-4000-8000-000000000000" });
  ok("A2r faux en-tête interne → traité comme une requête publique (404)", res.pass, res.detail);
}
r = await http("/admin/connexion");
const loginHtml = await r.text();
ok("A2c connexion : formulaire, noindex, pas d'Authentik", r.status === 200 && loginHtml.includes("Adresse e-mail") && loginHtml.includes("noindex") && !loginHtml.includes("Authentik"));

// En-têtes de sécurité (I4)
const csp = r.headers.get("content-security-policy") ?? "";
ok(
  "A2d CSP complète sur l'admin (nonce, sans unsafe-eval en prod)",
  /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/.test(csp) && !csp.includes("unsafe-eval") && csp.includes("frame-ancestors 'none'"),
  csp.slice(0, 90),
);
r = await http("/fr");
ok(
  "A2e en-têtes publics (XFO, frame-ancestors, Referrer, nosniff, Permissions, sans X-Powered-By)",
  r.headers.get("x-frame-options") === "DENY" &&
    r.headers.get("content-security-policy") === "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" &&
    r.headers.get("referrer-policy") === "strict-origin-when-cross-origin" &&
    r.headers.get("x-content-type-options") === "nosniff" &&
    (r.headers.get("permissions-policy") ?? "").includes("camera=()") &&
    !r.headers.get("x-powered-by"),
);
const mediaKey = (await (await http("/fr/personnages")).text()).match(/\/media\/[a-z0-9-]+\.svg/)?.[0];
r = await http(mediaKey);
ok("A2f /media garde sa CSP (sandbox) et XFO", (r.headers.get("content-security-policy") ?? "").includes("sandbox") && r.headers.get("x-frame-options") === "DENY");
// docs/SECURITE.md §2.8, §2.12 : HSTS partout, CSP minimale du site public (compatible ISR), icône de l'onglet en CSP sandbox.
{
  const pub = await http("/fr/personnages");
  await pub.text();
  const adm = await http("/admin/connexion");
  await adm.text();
  ok(
    "A2s HSTS (un an, sous-domaines) sur le site public et l'admin",
    [pub, adm].every((x) => x.headers.get("strict-transport-security") === "max-age=31536000; includeSubDomains"),
    `${pub.headers.get("strict-transport-security")} / ${adm.headers.get("strict-transport-security")}`,
  );
  ok("A2t page publique toujours en cache malgré la CSP (ISR)", /s-maxage/.test(pub.headers.get("cache-control") ?? ""), pub.headers.get("cache-control") ?? "");
  const icons = [];
  for (const u of ["/site-icon/icon.svg", "/site-icon/32.png", "/site-icon/192.png", "/favicon.ico"]) {
    const res = await http(u);
    await res.arrayBuffer();
    if (res.status === 200) icons.push([u, res.headers.get("content-security-policy") ?? ""]);
  }
  ok(
    "A2u icône de l'onglet (/site-icon, /favicon.ico) : CSP sandbox, sans la CSP du site",
    icons.length > 0 && icons.every(([, c]) => c === "default-src 'none'; style-src 'unsafe-inline'; sandbox"),
    icons.map(([u, c]) => `${u} « ${c} »`).join(" ; ") || "aucune icône servie",
  );
}

// Erreurs de connexion : table de codes, aucun texte venu de l'URL (M4)
r = await http("/admin/connexion?error=%3Cscript%3Ealert(1)%3C%2Fscript%3E&error_description=PIRATE");
// Rendu seulement : l'URL figure aussi (échappée) dans l'état du routeur de Next.
const rendered = (await r.text()).replace(/<script\b[\s\S]*?<\/script>/g, "");
ok(
  "A2g code d'erreur inconnu → message générique, aucun reflet dans le rendu",
  /<p class="a-alert">La connexion a échoué\. Réessaie, ou utilise l(&#x27;|')autre méthode\.<\/p>/.test(rendered) &&
    !rendered.includes("PIRATE") &&
    !rendered.includes("alert(1)"),
);
r = await http("/admin/connexion?error=admin_not_allowed");
ok("A2h code connu → message précis", /Ce compte Authentik n(&#x27;|')est pas autorisé/.test(await r.text()));

const jar = new Jar();
r = await signIn(jar, ADMIN.email, "mauvais-mot-de-passe", "203.0.113.11");
const bad = await r.json().catch(() => ({}));
ok("A3 mauvais mot de passe → 401 INVALID_EMAIL_OR_PASSWORD", r.status === 401 && bad.code === "INVALID_EMAIL_OR_PASSWORD", `${r.status} ${bad.code}`);
r = await signIn(jar, ADMIN.email, ADMIN.password);
ok("A4 bon mot de passe → 200 + cookie de session", r.status === 200 && [...jar.cookies.keys()].some((k) => k.includes("session_token")));
const cookieAttrs = r.headers.getSetCookie().find((c) => c.includes("session_token")) ?? "";
ok("A4b cookie Secure, HttpOnly, SameSite=Lax", /Secure/i.test(cookieAttrs) && /HttpOnly/i.test(cookieAttrs) && /SameSite=Lax/i.test(cookieAttrs));
r = await http("/admin", { jar });
ok("A5 tableau de bord avec session", r.status === 200 && (await r.text()).includes("Tableau de bord"), String(r.status));
ok("A5b admin non mise en cache", !r.headers.get("x-nextjs-cache") && /no-store|private/i.test(r.headers.get("cache-control") ?? ""));
// docs/SECURITE.md N6 : l'admin s'isole des fenêtres ouvertes par un autre site (COOP), et une URL profonde ouverte depuis un autre
// site (lien, window.open) revient à l'accueil de l'admin sans rendu ni effet (messages marqués lus, aperçu de thème…).
ok("A5c Cross-Origin-Opener-Policy: same-origin sur l'admin", r.headers.get("cross-origin-opener-policy") === "same-origin", r.headers.get("cross-origin-opener-policy") ?? "absent");
{
  const deep = [];
  for (const [site, expect] of [["cross-site", 307], ["same-site", 307], ["same-origin", 200], ["none", 200], [null, 200]]) {
    const headers = site ? { "sec-fetch-site": site, "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" } : {};
    const res = await http("/admin/messages", { jar, headers });
    await res.text();
    const good = res.status === expect && (expect !== 307 || (res.headers.get("location")?.endsWith("/admin") && res.headers.get("cross-origin-opener-policy") === "same-origin"));
    if (!good) deep.push(`${site} → ${res.status} ${res.headers.get("location") ?? ""}`);
  }
  const fromOutside = await http("/admin", { jar, headers: { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" } });
  if (fromOutside.status !== 200) deep.push(`/admin cross-site → ${fromOutside.status}`);
  await fromOutside.text();
  ok("A5d URL profonde de l'admin ouverte depuis un autre site → /admin (même site, barre d'adresse, accueil de l'admin : servis)", deep.length === 0, deep.join(" ; "));
}
// docs/SECURITE.md P5 : connexion réussie et échec journalisés (compte interne pour la réussite ; ni e-mail, ni IP, ni mot de passe).
{
  const auth = logRows(dirA, "action = 'auth:sign-in'");
  const dump = JSON.stringify(auth);
  ok(
    "A5e journal : connexion réussie (compte interne) et échec (anonyme), sans e-mail ni IP",
    auth.some((x) => x.result === "ok" && x.user && x.type === "compte") && auth.some((x) => x.result === "refus" && x.user === null) && !dump.includes(ADMIN.email) && !dump.includes("203.0.113") && !dump.includes(ADMIN.password),
    dump.slice(0, 300),
  );
}

ok("A6a identifiant de la server action de déconnexion trouvé", Boolean(ids.signOutAction), Object.keys(ids).join(","));
const forged = new Jar();
forged.cookies.set("__Secure-better-auth.session_token", "jeton-forge.signature");
const actionHeaders = { "next-action": ids.signOutAction, "content-type": "text/plain;charset=UTF-8", origin: BASE };
r = await http("/admin", { jar: forged, method: "POST", headers: actionHeaders, raw: "[]" });
// Depuis docs/SECURITE.md §2.2 le proxy vérifie la session EN BASE : un cookie forgé ne le franchit plus (assertAdmin() en tête de
// chaque action reste vérifié statiquement par test-admin-guard).
ok("A6 server action avec un cookie forgé → redirigée par le proxy (session vérifiée en base)", r.status === 307, String(r.status));
r = await http("/admin", { method: "POST", headers: actionHeaders, raw: "[]" });
ok("A6b server action sans cookie → redirigée par le proxy", r.status === 307, String(r.status));

// Aperçu de thème (M1)
r = await http("/api/theme-preview?id=pro&redirect=/fr", { jar });
ok("A7 GET /api/theme-preview en production → 404, même pour un admin", r.status === 404, String(r.status));
const evil = jar.copy();
r = await postForm(evil, "/admin/apercu", { id: "pro" }, { origin: "https://site-malveillant.example" });
ok("A7a aperçu depuis une autre origine (CSRF) → 403, aucun draft mode", r.status === 403 && !evil.cookies.has("__prerender_bypass"), String(r.status));
r = await postForm(new Jar(), "/admin/apercu", { id: "pro" });
ok("A7a2 aperçu sans session → redirigé par le proxy", r.status === 307, String(r.status));
r = await postForm(jar, "/admin/apercu", { id: "pro" }, { referer: `${BASE}/admin/themes` });
ok("A7b aperçu (formulaire natif) → 303 /fr + draft mode", r.status === 303 && r.headers.get("location") === "/fr" && jar.cookies.has("__prerender_bypass") && jar.cookies.get("theme-preview") === "pro", `${r.status} ${r.headers.get("location")}`);
r = await http("/fr", { jar });
const previewHtml = await r.text();
ok("A7c l'admin voit l'aperçu (pro) et le bandeau", previewHtml.includes('data-theme="pro"') && /class="preview-banner"[\s\S]*Aperçu du thème : <strong>Pro<\/strong>/.test(previewHtml));
const noSession = jar.copy((k) => !k.includes("session_token"));
r = await http("/fr", { jar: noSession });
const noSessionHtml = await r.text();
ok("A7d cookies d'aperçu sans session admin → ignorés, pas de bandeau", noSessionHtml.includes('data-theme="galerie-lumineuse"') && !noSessionHtml.includes("preview-banner"));
await http("/fr");
r = await http("/fr");
const cachedHtml = await r.text();
ok(
  "A8 visiteur anonyme : page en cache (HIT), thème en ligne, jamais de bandeau",
  r.headers.get("x-nextjs-cache") === "HIT" && cachedHtml.includes('data-theme="galerie-lumineuse"') && !cachedHtml.includes("preview-banner"),
);
r = await postForm(jar, "/admin/apercu/quitter", {}, { referer: `${BASE}/fr/personnages` });
ok(
  "A8b quitter l'aperçu depuis le bandeau → retour à l'écran d'origine (Thèmes), draft mode coupé",
  r.status === 303 && r.headers.get("location") === "/admin/themes" && !jar.cookies.has("__prerender_bypass") && !jar.cookies.has("theme-preview") && !jar.cookies.has("preview-from"),
  `${r.status} ${r.headers.get("location")}`,
);
// Origine retenue à l'ouverture (champ `retour`), jamais hors de l'admin ni vers un autre site.
await postForm(jar, "/admin/apercu", { page: "1", retour: "/admin/pages" });
r = await postForm(jar, "/admin/apercu/quitter", {}, { referer: `${BASE}/fr` });
ok("A8c aperçu ouvert depuis Pages → retour à Pages", r.status === 303 && r.headers.get("location") === "/admin/pages", `${r.status} ${r.headers.get("location")}`);
await postForm(jar, "/admin/apercu", { id: "pro", retour: "https://site-malveillant.example/admin/x" }, { referer: "https://site-malveillant.example/admin/y" });
r = await postForm(jar, "/admin/apercu/quitter", {}, { referer: `${BASE}/fr` });
ok("A8d origine d'un autre site ignorée → Admin → Thèmes", r.status === 303 && r.headers.get("location") === "/admin/themes", `${r.status} ${r.headers.get("location")}`);
await postForm(jar, "/admin/apercu", { id: "pro", retour: "/fr/personnages" });
r = await postForm(jar, "/admin/apercu/quitter", { retour: "//site-malveillant.example/admin" });
ok("A8e retour hors de l'admin (site public, //autre-site) → Admin → Thèmes", r.status === 303 && r.headers.get("location") === "/admin/themes", `${r.status} ${r.headers.get("location")}`);
// Server actions des éditeurs (phase 4a) : refus sans session, puis
// validation serveur des charges invalides (client contourné).
for (const name of ADMIN_ACTIONS.filter((n) => n !== "signOutAction")) {
  ok(`A10 ${name} : identifiant trouvé`, Boolean(ids[name]));
  if (!ids[name]) continue;
  // Une action se résout depuis une page qui l'importe : on vise son écran.
  const screen =
    name === "applyKitImportAction" ? "/admin/themes/galerie-lumineuse/kit"
    : name === "saveThemeAction" || name === "importThemeLogoAction" ? "/admin/themes/galerie-lumineuse"
    : name === "savePageInfoAction" ? "/admin/pages/1"
    : name === "deleteFontAction" ? "/admin/reglages"
    : name === "resetSiteColorsAction" ? "/admin/themes"
    : name === "closeEditSessionAction" || name === "duplicateThemeAction" ? "/admin/themes/galerie-lumineuse"
    : /[vV]ersion/.test(name) ? "/admin/themes/mon-theme/versions"
    : /Model|OldTheme/.test(name) ? "/admin/themes"
    : /Onboarding/.test(name) ? "/admin"
    : /Draft|[bB]oard|Font|FromEditor/.test(name) ? "/admin/pages/1/editer"
    : /Theme/.test(name) ? "/admin/themes"
    : /Settings|Seo/.test(name) ? "/admin/reglages"
    : /Message/.test(name) ? "/admin/messages"
    // Lot 61 : la bibliothèque des papiers peints est un onglet de l'éditeur de thème (l'ancienne adresse redirige).
    : /[wW]allpaper/.test(name) ? "/admin/themes/galerie-lumineuse"
    : /^(create|delete|reorder|restore)Projects?Action$/.test(name) ? "/admin/pages"
    : /Project|Slot/.test(name) ? "/admin/projets/1"
    : /^media|Media|Uploads|Tag/.test(name) ? "/admin/medias"
    : "/admin/pages";
  const res = await callActionJson(forged, ids[name], ["x", {}], screen);
  // Cookie forgé : arrêté par le proxy (session vérifiée en base, §2.2) avant même l'action ; rien n'est exécuté ni rendu.
  ok(`A10 ${name} avec un cookie forgé → refusée (307 du proxy)`, res.status === 307 && !res.text.includes('"ok":'), `${res.status} ${res.text.slice(0, 120)}`);
}
// docs/SECURITE.md §2.7 : ces dizaines de refus SANS session n'ont rien écrit dans le journal (stdout seulement, agrégé).
await sleep(500);
{
  const anon = logRows(dirA, "user is null and result = 'refus' and action not like 'auth:%'");
  ok("A10b refus sans session : aucune ligne dans le journal d'édition (stdout agrégé « edit-anon »)", anon.length === 0 && /"t":"edit-anon"/.test(s.text()), `${anon.length} lignes`);
}
// Brouillons de l'éditeur visuel (phase 7a) — série ED : jamais publics ni en
// cache (vérifié sur cache FROID : serveur redémarré, le cache ISR est en
// mémoire), vue brouillon réservée à l'admin, contrôle de version, brouillon
// illisible, surcouche des emplacements portée par la page.
{
  const pageRev = (id) => query(dirA, "select draft_rev r from pages where id = ?", id)?.r;
  const draftOf = (id) => query(dirA, "select draft from pages where id = ?", id)?.draft;
  const restartA = async (label) => {
    await stop(s);
    // Sonde hors des pages : le cache ISR reste vraiment froid.
    s = startServer(dirA, baseEnv, "/robots.txt");
    ok(`${label} : serveur redémarré (cache ISR vide)`, await s.ready);
  };
  const homeId = query(dirA, `select id from pages where json_extract(slug,'$.fr')=''`).id;
  const row = query(dirA, "select title, slug, meta, published, nav_order from pages where id = ?", homeId);
  const published = JSON.parse(query(dirA, "select json_group_array(json_object('type', type, 'props', json(props))) b from (select * from blocks where page_id = ? order by position)", homeId).b);
  const SECRET_TITLE = "Titre de brouillon 7a, jamais public";
  const SECRET_META = "Méta de brouillon ED";
  const ADDED_TITLE = "Emplacement de brouillon ED";
  const meta = row.meta ? JSON.parse(row.meta) : { title: { fr: "", en: "" }, description: { fr: "", en: "" } };
  const base = { title: JSON.parse(row.title), slug: JSON.parse(row.slug), meta, published: Boolean(row.published), inMenu: row.nav_order !== null, accent: null };
  const withBlocks = (extra, over = {}) => ({ ...base, ...over, blocks: [...published.map((b, i) => ({ uid: `b${i}`, ...b })), ...extra] });
  const secretBlock = { uid: "n1", type: "rich-text", props: { title: { fr: SECRET_TITLE, en: "Draft title" }, paragraphs: [{ fr: "Paragraphe", en: "Paragraph" }] } };
  const draft = withBlocks([secretBlock], { meta: { ...meta, title: { fr: SECRET_META, en: SECRET_META } } });
  const editor = `/admin/pages/${homeId}/editer`;
  const save = (d, rev, id = homeId) => callActionJson(jar, ids.saveDraftAction, [id, d, rev], editor);
  const publish = (rev, id = homeId) => callActionJson(jar, ids.publishDraftAction, [id, rev], editor);
  const discard = (rev, id = homeId) => callActionJson(jar, ids.discardDraftAction, [id, rev], editor);
  const isOk = (res) => res.text.includes('"ok":true');
  // Ligne de résultat de l'action (le reste de la réponse est l'arbre RSC rendu).
  const line = (res) => res.text.split("\n").filter((l) => l.includes('"ok":')).join(" ").slice(0, 300) || res.text.slice(0, 200);
  const code = (res) => /"code":"(\w+)"/.exec(res.text)?.[1];

  let res = await save(draft, pageRev(homeId));
  ok("ED1 brouillon enregistré (session admin)", isOk(res), line(res));
  ok("ED1b brouillon en base, page publiée inchangée, version incrémentée", Boolean(draftOf(homeId)) && pageRev(homeId) === 1 && query(dirA, "select count(*) n from blocks where page_id = ?", homeId).n === published.length);

  // Surcouche des emplacements de la page d'accueil : média retiré, emplacement ajouté.
  const slot = query(dirA, "select s.id, s.media_id mediaId, s.project_id projectId, m.key from slots s join media m on m.id = s.media_id join projects p on p.id = s.project_id where p.featured = 1 and m.status = 'ready' order by p.position, s.position limit 1");
  writeDb(dirA, "update slots set draft_state = 'removed', draft_page_id = ? where id = ?", homeId, slot.id);
  const added = (() => {
    const db = new Database(path.join(dirA, "portfolio.db"));
    db.pragma("busy_timeout = 5000");
    const other = db.prepare("select * from slots where project_id = ? and id != ? and media_id is not null order by position limit 1").get(slot.projectId, slot.id);
    delete other.id;
    Object.assign(other, { slug: `${other.slug}-ed`, title: JSON.stringify({ fr: ADDED_TITLE, en: ADDED_TITLE }), position: 999, draft_state: "added", draft_page_id: homeId, draft_position: null, draft_media_id: null });
    const cols = Object.keys(other);
    const id = Number(db.prepare(`insert into slots (${cols.join(",")}) values (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => other[c])).lastInsertRowid);
    db.close();
    return id;
  })();

  // Cache FROID : un brouillon et une surcouche existent, aucun rendu en cache.
  await restartA("ED2");
  r = await http("/fr");
  let html = await r.text();
  ok("ED2 visiteur anonyme, cache froid : MISS propre (ni brouillon ni surcouche)", r.headers.get("x-nextjs-cache") === "MISS" && !html.includes(SECRET_TITLE) && !html.includes(SECRET_META) && html.includes(slot.key) && !html.includes(ADDED_TITLE), r.headers.get("x-nextjs-cache") ?? "");
  r = await http("/fr");
  html = await r.text();
  ok("ED2b … puis HIT, toujours propre", r.headers.get("x-nextjs-cache") === "HIT" && !html.includes(SECRET_TITLE) && html.includes(slot.key));
  ok("ED2c HTML public sans couche d'édition ni bouton « Modifier cette page »", !/data-edit-block|pe-layer|Modifier cette page|data-inline/.test(html));
  const cssHrefs = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) => m[1]);
  const css = (await Promise.all(cssHrefs.map(async (h) => (await http(h)).text()))).join("\n");
  ok("ED2d CSS public sans styles de l'éditeur (edit-layer.css chargé à part)", cssHrefs.length > 0 && !/\.pe-layer|\.pe-host|\.ve-/.test(css), `${cssHrefs.length} feuille(s)`);
  r = await http("/fr", { headers: { RSC: "1" } });
  ok("ED2e charge RSC anonyme : jamais le brouillon", !(await r.text()).includes(SECRET_TITLE));

  await restartA("ED3");
  r = await http("/fr", { jar });
  html = await r.text();
  ok("ED3 admin connecté hors vue brouillon, cache froid : version publiée", !html.includes(SECRET_TITLE) && !html.includes("data-edit-block") && html.includes(slot.key));
  r = await http("/fr");
  html = await r.text();
  ok("ED3b … puis le visiteur : propre", !html.includes(SECRET_TITLE) && html.includes(slot.key));

  // Route de la toile : admin, même origine.
  const toile = `/admin/api/editeur/toile?page=${homeId}&langue=fr`;
  r = await http(toile, { headers: { "sec-fetch-site": "same-origin" } });
  ok("ED4 toile sans session → 403", r.status === 403, String(r.status));
  const cross = jar.copy();
  r = await http(toile, { jar: cross, headers: { "sec-fetch-site": "cross-site" } });
  ok("ED4b toile depuis un autre site → 403, aucune vue brouillon", r.status === 403 && !cross.cookies.has("page-draft"), String(r.status));
  const bare = jar.copy();
  r = await http(toile, { jar: bare });
  ok("ED4c toile sans Sec-Fetch-Site ni Origin → 403", r.status === 403 && !bare.cookies.has("page-draft"), String(r.status));

  // Polices (lot 2) : aperçu du menu réservé à l'admin ; /fonts/ ne sert qu'un nom d'empreinte.
  r = await http("/admin/api/fonts/preview?famille=Inter");
  ok("FT1 aperçu de police sans session → 403", r.status === 403, String(r.status));
  r = await http("/fonts/..%2Fportfolio.db");
  ok("FT2 /fonts/<hors empreinte> → 404", r.status === 404, String(r.status));
  r = await http("/fonts/0123456789abcdef.woff2");
  ok("FT2b /fonts/<empreinte inconnue> → 404", r.status === 404, String(r.status));
  // Suppression d'une police (Réglages) : famille absente ou charge invalide → refus propre, rien d'écrit.
  for (const arg of ["Inexistante", { constructor: 1 }, "x".repeat(500)]) {
    const del = await callActionJson(jar, ids.deleteFontAction, [arg], "/admin/reglages");
    ok(`FT3 deleteFontAction(${JSON.stringify(arg).slice(0, 20)}) → refus, pas d'erreur 500`, del.status === 200 && del.text.includes('"ok":false'), `${del.status} ${del.text.slice(0, 120)}`);
  }

  await restartA("ED5");
  const drafty = jar.copy();
  r = await http(toile, { jar: drafty, headers: { "sec-fetch-site": "same-origin" } });
  const draftCookie = r.headers.getSetCookie().find((c) => c.startsWith("page-draft=")) ?? "";
  ok("ED4d toile (admin, même origine) → 303 /fr + draft mode + vue brouillon", r.status === 303 && r.headers.get("location") === "/fr" && drafty.cookies.has("__prerender_bypass") && drafty.cookies.get("page-draft") === "1", `${r.status} ${r.headers.get("location")}`);
  ok("ED4e cookie page-draft de session (sans durée), HttpOnly", Boolean(draftCookie) && !/max-age|expires/i.test(draftCookie) && /httponly/i.test(draftCookie), draftCookie);
  r = await http("/fr", { jar: drafty });
  html = await r.text();
  ok("ED5 vue brouillon d'abord, cache froid : le brouillon et ses repères d'édition", html.includes(SECRET_TITLE) && html.includes('data-edit-block="n1"') && html.includes('data-inline="title"'));
  ok("ED5a vue brouillon : méta-titre du brouillon, surcouche appliquée", html.includes(`<title>${SECRET_META}`) && !html.includes(slot.key) && html.includes(ADDED_TITLE), (/<title>[^<]*/.exec(html) ?? [""])[0]);
  ok("ED5b vue brouillon : frame-ancestors 'self', jamais mise en cache (no-store)", (r.headers.get("content-security-policy") ?? "").includes("frame-ancestors 'self'") && /(^|[ ,])no-store([ ,]|$)/.test(r.headers.get("cache-control") ?? ""), `${r.headers.get("content-security-policy")} · ${r.headers.get("cache-control")}`);
  ok("ED5c vue brouillon (toile) : même CSP minimale que le site public", (r.headers.get("content-security-policy") ?? "") === "frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'", r.headers.get("content-security-policy") ?? "");
  r = await http("/fr");
  html = await r.text();
  ok("ED5c … puis le visiteur : MISS propre (la vue brouillon n'a rien mis en cache)", r.headers.get("x-nextjs-cache") === "MISS" && !html.includes(SECRET_TITLE) && !html.includes(ADDED_TITLE) && html.includes(slot.key), r.headers.get("x-nextjs-cache") ?? "");
  const stolen = drafty.copy((k) => !k.includes("session_token"));
  r = await http("/fr", { jar: stolen });
  html = await r.text();
  ok("ED6 cookies de vue brouillon sans session → version publiée", !html.includes(SECRET_TITLE) && !html.includes("data-edit-block"));
  r = await http("/fr", { jar: stolen, headers: { RSC: "1" } });
  ok("ED6b charge RSC avec cookies volés : jamais le brouillon", !(await r.text()).includes(SECRET_TITLE));
  r = await http("/fr");
  html = await r.text();
  ok("ED7 après la vue brouillon, le cache public reste propre (HIT)", r.headers.get("x-nextjs-cache") === "HIT" && !html.includes(SECRET_TITLE));

  // Écrans de l'admin : les emplacements « added » n'existent pas encore.
  r = await http(`/admin/projets/${slot.projectId}`, { jar });
  html = await r.text();
  ok("ED8 écran Projets : emplacement ajouté en brouillon absent, écart signalé", !html.includes(ADDED_TITLE) && html.includes("en brouillon"));
  const publishedSlots = (() => {
    const db = new Database(path.join(dirA, "portfolio.db"), { readonly: true });
    const rows = db.prepare("select id from slots where project_id = ? and draft_state is not 'added' order by position").all(slot.projectId).map((x) => x.id);
    db.close();
    return rows;
  })();
  res = await callActionJson(jar, ids.reorderSlotsAction, [slot.projectId, [...publishedSlots, added]], `/admin/projets/${slot.projectId}`);
  ok("ED8b reorderSlots avec l'emplacement « added » → refusé", res.text.includes('"ok":false'), line(res));
  res = await callActionJson(jar, ids.reorderSlotsAction, [slot.projectId, publishedSlots], `/admin/projets/${slot.projectId}`);
  ok("ED8c reorderSlots des seuls emplacements publiés → accepté", isOk(res), line(res));

  // Suppressions refusées : un brouillon utilise la page, le projet, le média.
  res = await callActionJson(jar, ids.createPageAction, [{ title: { fr: "Cible ED", en: "Target ED" }, slug: { fr: "cible-ed", en: "target-ed" } }], "/admin/pages");
  const targetPage = Number(/"ok":true,"data":\{"id":(\d+)\}/.exec(res.text)?.[1]);
  res = await callActionJson(jar, ids.createProjectAction, [{ title: { fr: "Projet ED", en: "" } }], "/admin/pages");
  const targetProject = Number(/"ok":true,"data":\{"id":(\d+)\}/.exec(res.text)?.[1]);
  const projectSlug = query(dirA, "select slug from projects where id = ?", targetProject).slug;
  const png = await sharp({ create: { width: 32, height: 24, channels: 3, background: "#2e4e9e" } }).png().toBuffer();
  const up = await upload(jar, "brouillon-ed.png", "image/png", png);
  const targetMedia = up.json?.media?.id;
  if (targetMedia) await waitMedia(dirA, targetMedia);
  res = await save(
    withBlocks([
      secretBlock,
      { uid: "n2", type: "hero", props: { eyebrow: { fr: "", en: "" }, statement: { fr: "", en: "" }, reelPageId: targetPage } },
      // Planche d'un projet à projet en dur (le conteneur « Projet mis en avant » n'est plus créable depuis la v0.19).
      { uid: "n3", type: "project-board", props: { project: projectSlug } },
      { uid: "n4", type: "profile", props: { portraitMediaId: targetMedia } },
    ]),
    pageRev(homeId),
  );
  ok("ED9 brouillon qui cite une page, un projet et un média neufs", isOk(res) && Boolean(targetPage && targetProject && targetMedia), line(res));
  res = await callActionJson(jar, ids.deletePageAction, [targetPage], "/admin/pages");
  ok("ED9b supprimer une page utilisée seulement par un brouillon → refusé", res.text.includes("references") && res.text.includes('"ok":false'), line(res));
  res = await callActionJson(jar, ids.deleteProjectAction, [targetProject], "/admin/pages");
  ok("ED9c supprimer un projet utilisé seulement par un brouillon → refusé", res.text.includes("references") && res.text.includes('"ok":false'), line(res));
  res = await callActionJson(jar, ids.deleteMediaAction, [targetMedia], "/admin/medias");
  ok("ED9d supprimer un média utilisé seulement par un brouillon → refusé", res.text.includes("references") && res.text.includes('"ok":false'), line(res));

  // Enregistrement automatique : contrôle de forme.
  let rev = pageRev(homeId);
  const many = withBlocks(Array.from({ length: 41 - published.length }, (_, i) => ({ uid: `m${i}`, type: "rich-text", props: { paragraphs: [{ fr: "", en: "" }] } })));
  const deep = withBlocks([{ uid: "n9", type: "rich-text", props: JSON.parse("{".repeat(1) + '"a":' + '{"a":'.repeat(40) + "1" + "}".repeat(41)) }]);
  const shapes = [
    ["plus de 40 blocs", many],
    ["type inconnu", withBlocks([{ uid: "n9", type: "inconnu", props: {} }])],
    ["uid en double", withBlocks([secretBlock, { ...secretBlock }])],
    ["plus de 256 Ko", withBlocks([{ uid: "n9", type: "rich-text", props: { pad: "x".repeat(300 * 1024) } }])],
    ["imbrication profonde", deep],
  ];
  for (const [label, payload] of shapes) {
    res = await save(payload, rev);
    ok(`ED10 saveDraftAction : ${label} → refusé sans erreur 500, rien d'écrit`, res.status === 200 && res.text.includes('"ok":false') && pageRev(homeId) === rev, `${res.status} ${line(res)}`);
  }
  res = await callActionJson(jar, ids.saveDraftAction, [homeId, draft], editor);
  ok("ED10b saveDraftAction sans version → refusé", res.text.includes('"ok":false') && pageRev(homeId) === rev);

  // Contrôle de version (deux onglets, formulaire, publication).
  res = await save(draft, rev);
  ok("ED11 onglet A enregistre (version lue) → accepté", isOk(res) && pageRev(homeId) === rev + 1);
  const stale = rev;
  rev = pageRev(homeId);
  res = await save(withBlocks([]), stale);
  ok("ED11b onglet B en retard → refusé (conflit), brouillon intact", code(res) === "conflict" && JSON.stringify(draftOf(homeId)).includes(SECRET_TITLE), line(res));
  res = await publish(stale);
  ok("ED11c publier avec une version périmée → refusé (conflit)", code(res) === "conflict" && Boolean(draftOf(homeId)));
  res = await savePageForm(jar, homeId, { ...base, blocks: published }, stale, `/admin/pages/${homeId}`);
  ok("ED11d formulaire avec une version périmée → refusé (conflit), rien d'écrasé", code(res) === "conflict" && Boolean(draftOf(homeId)));
  res = await discard(stale);
  ok("ED11e abandonner avec une version périmée → refusé", code(res) === "conflict" && Boolean(draftOf(homeId)));

  // Publication refusée : validation complète de savePage.
  res = await save(withBlocks([{ uid: "n2", type: "hero", props: { eyebrow: { fr: "", en: "" }, statement: { fr: "", en: "" }, reelPageId: 99999 } }]), rev);
  ok("ED12 brouillon incomplet accepté (c'est un brouillon)", isOk(res), line(res));
  rev = pageRev(homeId);
  res = await publish(rev);
  ok("ED12b publication refusée, erreur rattachée au bloc", res.text.includes('"ok":false') && res.text.includes(`blocks.${published.length}`), line(res));
  ok("ED12c rien n'est publié, brouillon, version et surcouche gardés", query(dirA, "select count(*) n from blocks where page_id = ?", homeId).n === published.length && Boolean(draftOf(homeId)) && pageRev(homeId) === rev && query(dirA, "select draft_state s from slots where id = ?", slot.id).s === "removed");

  // Abandonner : brouillon et surcouche de la page effacés, « added » supprimé.
  res = await discard(rev);
  ok("ED13 abandonner → brouillon et surcouche effacés", isOk(res) && !draftOf(homeId) && query(dirA, "select draft_state s, draft_page_id p from slots where id = ?", slot.id).s === null, line(res));
  ok("ED13b abandonner supprime l'emplacement « added »", !query(dirA, "select id from slots where id = ?", added));
  res = await publish(pageRev(homeId));
  ok("ED13c publier sans brouillon → refus immédiat", res.text.includes('"ok":false') && res.text.includes("Aucune modification"), line(res));

  // Surcouche portée par la page : publier B n'applique pas celle de A.
  const aboutId = query(dirA, `select id from pages where json_extract(slug,'$.fr')='a-propos'`).id;
  writeDb(dirA, "update slots set draft_state = 'removed', draft_page_id = ? where id = ?", homeId, slot.id);
  const aboutRow = query(dirA, "select title, slug, meta, published, nav_order from pages where id = ?", aboutId);
  const aboutBlocks = JSON.parse(query(dirA, "select json_group_array(json_object('type', type, 'props', json(props))) b from (select * from blocks where page_id = ? order by position)", aboutId).b);
  const aboutDraft = {
    title: JSON.parse(aboutRow.title), slug: JSON.parse(aboutRow.slug), meta: aboutRow.meta ? JSON.parse(aboutRow.meta) : meta, published: Boolean(aboutRow.published), inMenu: aboutRow.nav_order !== null, accent: null,
    // v0.13 : la planche du projet partagé posée sur « À propos » (l'ancien bloc n'est plus créable).
    blocks: [
      ...aboutBlocks.map((b, i) => ({ uid: `b${i}`, ...b })),
      { uid: "n1", type: "project-board", props: { project: query(dirA, "select p.slug s from projects p join slots s on s.project_id = p.id where s.id = ?", slot.id).s } },
    ],
  };
  res = await save(aboutDraft, pageRev(aboutId), aboutId);
  res = await publish(pageRev(aboutId), aboutId);
  ok("ED14 publier une autre page qui partage le projet → surcouche de l'accueil intacte", isOk(res) && query(dirA, "select media_id m, draft_state s from slots where id = ?", slot.id).m === slot.mediaId && query(dirA, "select draft_state s from slots where id = ?", slot.id).s === "removed", line(res));
  // Remise en état de « À propos ».
  await savePageForm(jar, aboutId, { ...aboutDraft, blocks: aboutBlocks }, pageRev(aboutId), `/admin/pages/${aboutId}`);

  // Publier : appliqué, revalidé.
  res = await save(draft, pageRev(homeId));
  rev = pageRev(homeId);
  res = await publish(rev);
  ok("ED15 publier → appliqué en une fois, brouillon vidé, version incrémentée", isOk(res) && !draftOf(homeId) && pageRev(homeId) === rev + 1 && query(dirA, "select count(*) n from blocks where page_id = ?", homeId).n === published.length + 1, line(res));
  ok("ED15b surcouche de la page appliquée (média retiré, place gardée)", query(dirA, "select media_id m, draft_page_id p from slots where id = ?", slot.id).m === null);
  r = await http("/fr");
  html = await r.text();
  ok("ED15c visiteur anonyme : la nouvelle version (cache revalidé)", html.includes(SECRET_TITLE) && !html.includes(slot.key) && !html.includes("data-edit-block"));
  res = await save(withBlocks([]), rev);
  ok("ED15d onglet en retard après la publication → refusé, aucun brouillon recréé", code(res) === "conflict" && !draftOf(homeId));

  // Liste des pages : publication et menu reportés dans le brouillon.
  res = await save({ ...base, slug: { fr: "cible-ed", en: "target-ed" }, title: { fr: "Cible ED", en: "Target ED" }, published: true, inMenu: false, blocks: [] }, pageRev(targetPage), targetPage);
  const targetRev = pageRev(targetPage);
  await callActionJson(jar, ids.setPublishedAction, [targetPage, false], "/admin/pages");
  await callActionJson(jar, ids.setInMenuAction, [targetPage, true], "/admin/pages");
  const synced = draftOf(targetPage) ? JSON.parse(draftOf(targetPage)) : {};
  ok("ED16 Publier/Dépublier et menu depuis la liste → reportés dans le brouillon (version augmentée)", isOk(res) && synced.published === false && synced.inMenu === true && pageRev(targetPage) === targetRev + 2, JSON.stringify({ p: synced.published, m: synced.inMenu, rev: pageRev(targetPage) }));

  // Brouillon illisible : rien n'est écrasé sans choix explicite.
  writeDb(dirA, "update pages set draft = ? where id = ?", JSON.stringify({ ...draft, blocks: [{ uid: "b0", type: "type-disparu", props: {} }] }), homeId);
  rev = pageRev(homeId);
  res = await save(draft, rev);
  ok("ED17 brouillon illisible : l'enregistrement automatique refuse de l'écraser", code(res) === "corrupt" && JSON.stringify(draftOf(homeId)).includes("type-disparu"), line(res));
  res = await publish(rev);
  ok("ED17b … la publication aussi", code(res) === "corrupt");
  res = await savePageForm(jar, homeId, { ...base, blocks: published }, rev, `/admin/pages/${homeId}`);
  ok("ED17c … et le formulaire", code(res) === "corrupt" && JSON.stringify(draftOf(homeId)).includes("type-disparu"));
  r = await http(editor, { jar });
  ok("ED17d l'éditeur le signale avec « Repartir de la version publiée »", (await r.text()).includes("Repartir de la version publiée"));
  res = await discard(rev);
  ok("ED17e « Repartir de la version publiée » (abandon explicite) → effacé", isOk(res) && !draftOf(homeId));

  // Page supprimée pendant qu'un brouillon existait.
  const goneRev = pageRev(targetPage);
  // Le brouillon de l'accueil ne cite plus la page : sa suppression est permise.
  res = await callActionJson(jar, ids.deletePageAction, [targetPage], "/admin/pages");
  ok("ED18 page supprimée (son brouillon part avec elle)", isOk(res), line(res));
  res = await publish(goneRev, targetPage);
  ok("ED18b publier le brouillon d'une page supprimée → refus propre", res.status === 200 && res.text.includes('"ok":false') && res.text.includes("n'existe plus"), `${res.status} ${line(res)}`);
  await callActionJson(jar, ids.deleteProjectAction, [targetProject], "/admin/pages");

  // Quitter l'aperçu arrête la vue brouillon.
  await save(draft, pageRev(homeId));
  r = await http(toile, { jar: drafty, headers: { "sec-fetch-site": "same-origin" } });
  r = await http("/fr", { jar: drafty });
  ok("ED19 vue brouillon active", (await r.text()).includes(SECRET_TITLE));
  r = await postForm(drafty, "/admin/apercu/quitter", {}, { referer: `${BASE}/fr` });
  ok("ED19b quitter l'aperçu efface la vue brouillon", !drafty.cookies.has("page-draft") && !drafty.cookies.has("__prerender_bypass"));
  r = await http("/fr", { jar: drafty });
  html = await r.text();
  ok("ED19c … et la page redevient la version publiée", !html.includes("data-edit-block") && !html.includes('data-edit-block="n1"'));
  await discard(pageRev(homeId));

  // Bouton « Modifier cette page » : indicateur posé par l'admin, session vérifiée.
  const fresh = jar.copy((k) => k !== "portfolio-admin");
  r = await http("/admin", { jar: fresh });
  ok("ED20 l'admin pose le cookie indicateur portfolio-admin", fresh.cookies.get("portfolio-admin") === "1");
  r = await http("/admin/api/editeur/session?chemin=/fr");
  ok("ED20b session (anonyme) → admin:false", (await r.json()).admin === false);
  r = await http("/admin/api/editeur/session?chemin=/fr", { jar });
  const who = await r.json();
  ok("ED20c session (admin) → lien vers l'éditeur de la page", who.admin === true && who.editUrl === `/admin/pages/${homeId}/editer?langue=fr` && (r.headers.get("cache-control") ?? "").includes("no-store"), JSON.stringify(who));

  // Remise en état : accueil d'origine, média remis, projet ED supprimé.
  res = await savePageForm(jar, homeId, { ...base, blocks: published }, pageRev(homeId), `/admin/pages/${homeId}`);
  ok("ED21 formulaire : accueil d'origine republié", isOk(res) && !draftOf(homeId), line(res));
  res = await callActionJson(jar, ids.setSlotMediaAction, [slot.id, slot.mediaId], `/admin/projets/${slot.projectId}`);
  ok("ED21b média remis en place", isOk(res) && query(dirA, "select media_id m from slots where id = ?", slot.id).m === slot.mediaId, line(res));
  r = await http("/fr");
  html = await r.text();
  ok("ED21c visiteur : accueil d'origine", !html.includes(SECRET_TITLE) && html.includes(slot.key));
}
// Planches sur la toile (phase 7b) — série BD : surcouche par page, projet
// créé en brouillon (invisible partout avant publication), gardes et IDOR,
// bornes, version, médias, cache froid (serveur redémarré).
{
  const pageRev = (id) => query(dirA, "select draft_rev r from pages where id = ?", id)?.r;
  const isOk = (res) => res.text.includes('"ok":true');
  const line = (res) => res.text.split("\n").filter((l) => l.includes('"ok":')).join(" ").slice(0, 300) || res.text.slice(0, 200);
  const code = (res) => /"code":"(\w+)"/.exec(res.text)?.[1];
  const dataOf = (res) => JSON.parse(/"ok":true,"data":(\{[^}]*\})/.exec(res.text)?.[1] ?? "{}");
  const homeId = query(dirA, `select id from pages where json_extract(slug,'$.fr')=''`).id;
  const aboutId = query(dirA, `select id from pages where json_extract(slug,'$.fr')='a-propos'`).id;
  const editor = `/admin/pages/${homeId}/editer`;
  const board = (page, project, op, rev = pageRev(page)) => callActionJson(jar, ids.boardAction, [page, project, op, rev], editor);
  const restore = (page, snap) => callActionJson(jar, ids.restoreBoardAction, [page, snap, pageRev(page)], editor);
  const blocksOf = (id) => JSON.parse(query(dirA, "select json_group_array(json_object('type', type, 'props', json(props))) b from (select * from blocks where page_id = ? order by position)", id).b);
  const draftFrom = (id, extra = []) => {
    const row = query(dirA, "select title, slug, meta, published, nav_order from pages where id = ?", id);
    return {
      title: JSON.parse(row.title),
      slug: JSON.parse(row.slug),
      meta: row.meta ? JSON.parse(row.meta) : { title: { fr: "", en: "" }, description: { fr: "", en: "" } },
      published: Boolean(row.published),
      inMenu: row.nav_order !== null,
      accent: null,
      blocks: [...blocksOf(id).map((b, i) => ({ uid: `b${i}`, ...b })), ...extra],
    };
  };
  const saveDraftOf = (id, d) => callActionJson(jar, ids.saveDraftAction, [id, d, pageRev(id)], `/admin/pages/${id}/editer`);
  const cold = async (label) => {
    await stop(s);
    s = startServer(dirA, baseEnv, "/robots.txt");
    ok(`${label} : serveur redémarré (cache ISR vide)`, await s.ready);
  };
  const png = async (name, hex) => {
    const up = await upload(jar, name, "image/png", await sharp({ create: { width: 64 + name.length, height: 48, channels: 3, background: hex } }).png().toBuffer());
    const id = up.json?.media?.id;
    if (id) await waitMedia(dirA, id);
    return id;
  };
  const variant = (mediaId) => `img/${query(dirA, "select sha256 from media where id = ?", mediaId).sha256.slice(0, 16)}`;
  const countOf = (html) => /(\d+)\s*(?:œuvres|œuvre)/.exec(html)?.[1];
  const keyOfSlot = (id) => `s${id}`;
  const TITLE = "Projet de planche BD";
  const RENAMED = "Titre de brouillon BD";
  const homeBlocks = blocksOf(homeId);
  const countBefore = countOf(await (await http("/fr/personnages")).text());

  // Projets : P (mis en avant, affiché par l'accueil), Q (cité par une planche), Z (non cité).
  const P = query(dirA, "select id, slug from projects where slug = 'les-hauts-chemins'");
  const Q = query(dirA, "select id, slug from projects where slug = 'herbier-des-nuits'");
  const Z = query(dirA, "select id, slug from projects where slug = 'sel-et-silence'");
  const slotsOf = (pid) => query(dirA, "select json_group_array(json_object('id', s.id, 'key', m.key)) j from (select s.id, s.media_id from slots s where s.project_id = ? order by s.position) s left join media m on m.id = s.media_id", pid);
  const pSlots = JSON.parse(slotsOf(P.id).j);

  let res = await callActionJson(jar, ids.createDraftProjectAction, [homeId, TITLE], editor);
  const created = dataOf(res);
  ok("BD1 projet créé depuis la toile : en brouillon de la page", isOk(res) && query(dirA, "select draft_page_id p from projects where id = ?", created.id)?.p === homeId, line(res));
  const [mB, mC, mX, mD] = [await png("bd-b.png", "#123456"), await png("bd-c.png", "#654321"), await png("bd-x.png", "#a0a0a0"), await png("bd-d.png", "#0a0a0a")];
  res = await board(homeId, created.id, { op: "add", mediaId: mX, index: 0 });
  ok("BD1b planche que la page n'affiche pas → refusée (I1)", res.text.includes('"ok":false') && res.text.includes("n'affiche pas"), line(res));
  const board1 = { uid: "pb1", type: "project-board", props: { project: created.slug } };
  const boardQ = { uid: "pq", type: "project-board", props: { project: Q.slug } };
  res = await saveDraftOf(homeId, draftFrom(homeId, [board1, boardQ]));
  ok("BD2 brouillon de l'accueil : planches du projet neuf et de Q", isOk(res), line(res));
  res = await board(homeId, created.id, { op: "add", mediaId: mX, index: 0 });
  ok("BD2b image ajoutée à la planche citée : emplacement « added »", isOk(res) && query(dirA, "select count(*) n from slots where project_id = ? and draft_state = 'added' and draft_page_id = ?", created.id, homeId).n === 1, line(res));

  // Surcouche d'un projet PUBLIÉ (P) : renommage, place retirée, ajout.
  res = await board(homeId, P.id, { op: "text", key: keyOfSlot(pSlots[0].id), field: "title", locale: "fr", value: RENAMED });
  const pBefore = JSON.parse(/"before":(\{.*?\}),"after"/.exec(res.text)?.[1] ?? "null");
  await board(homeId, P.id, { op: "retire", key: keyOfSlot(pSlots[1].id) });
  res = await board(homeId, P.id, { op: "add", mediaId: mC, index: 0 });
  ok("BD2c surcouche de P : renommage, place retirée, ajout", isOk(res) && query(dirA, "select draft_state s from slots where id = ?", pSlots[1].id).s === "retired", line(res));

  // Trois protections, chacune seule en cause : A = projet en brouillon mis
  // en avant (projectIds) ; B = emplacement NON « added » d'un projet en
  // brouillon (published.has) ; C = emplacement « added » d'un projet publié (filtre added).
  res = await callActionJson(jar, ids.createDraftProjectAction, [homeId, "Projet A BD"], editor);
  const projA = dataOf(res);
  writeDb(dirA, "update projects set featured = 1, position = -1 where id = ?", projA.id);
  {
    const db = new Database(path.join(dirA, "portfolio.db"));
    const row = db.prepare("select * from slots where project_id = ? order by position limit 1").get(P.id);
    delete row.id;
    Object.assign(row, { project_id: projA.id, slug: "bd-b-slot", media_id: mB, collection: "characters", draft_state: null, draft_page_id: null, draft_position: null, draft_media_id: null, draft_key: null, draft_title: null, draft_description: null });
    const cols = Object.keys(row);
    db.prepare(`insert into slots (${cols.join(",")}) values (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => row[c]));
    db.close();
  }

  await cold("BD3");
  const urls = ["/fr", "/fr/personnages", "/fr/decors", "/fr/animation", "/en"];
  r = await http("/fr");
  const first = r.headers.get("x-nextjs-cache");
  const texts = [await r.text(), ...(await Promise.all(urls.slice(1).map(async (u) => (await http(u)).text())))];
  ok("BD3a anonyme, cache froid : MISS", first === "MISS", first ?? "");
  ok("BD3b anonyme, cache froid : ni projet en brouillon (A), ni son emplacement (B), ni ajout sur un projet publié (C)", texts.every((t) => !t.includes(TITLE) && !t.includes("Projet A BD") && !t.includes(variant(mB)) && !t.includes(variant(mC)) && !t.includes(variant(mX))));
  ok("BD3c compteur de la collection inchangé (B et C ne comptent pas)", countOf(texts[1]) === countBefore, `${countOf(texts[1])} / ${countBefore}`);
  ok("BD3d surcouche de P invisible : titre d'origine, place retirée encore là", texts.every((t) => !t.includes(RENAMED)) && texts[0].includes(pSlots[1].key));
  ok("BD3e HTML public sans repères d'édition (Titre / Légende, emplacements)", texts.every((t) => !/data-placeholder|pe-slot-legend|data-slot-inline|data-edit-/.test(t)));
  // Arbre de routeur minimal que Next accepte (un arbre mal formé donne une 500 en draft mode, sans fuite).
  const tree = encodeURIComponent(JSON.stringify(["", {}]));
  const rscHeaders = { RSC: "1", "Next-Router-State-Tree": tree, "Next-Url": "/fr", "Next-Router-Prefetch": "1" };
  // Next exige le paramètre _rsc (empreinte des en-têtes) : on suit sa redirection.
  const rscGet = async (jarOpt) => {
    let res2 = await http("/fr", { jar: jarOpt, headers: rscHeaders });
    const loc = res2.headers.get("location");
    if (res2.status === 307 && loc?.includes("_rsc=")) res2 = await http(loc, { jar: jarOpt, headers: rscHeaders });
    return res2;
  };
  r = await rscGet();
  const rsc = await r.text();
  ok("BD3f charge RSC anonyme (en-têtes de routeur complets, _rsc suivi) : rien du brouillon", r.status === 200 && (r.headers.get("content-type") ?? "").includes("text/x-component") && !rsc.includes(TITLE) && !rsc.includes(RENAMED) && !rsc.includes(variant(mC)), `${r.status} ${r.headers.get("content-type")}`);
  r = await http("/admin/pages", { jar });
  ok("BD3g écran Projets : projets en brouillon absents", !/Projet de planche BD|Projet A BD/.test(await r.text()));

  await cold("BD4");
  const drafty = jar.copy();
  await http(`/admin/api/editeur/toile?page=${homeId}&langue=fr`, { jar: drafty, headers: { "sec-fetch-site": "same-origin" } });
  r = await http("/fr", { jar: drafty });
  let html = await r.text();
  ok("BD4a vue brouillon d'abord : planche neuve, renommage, ajout, repères", html.includes(TITLE) && html.includes(RENAMED) && html.includes(variant(mC)) && html.includes(`data-edit-board="${created.id}"`) && /data-edit-slot="k[0-9a-f]+"/.test(html));
  r = await http("/fr");
  html = await r.text();
  ok("BD4b … puis l'anonyme : MISS propre", r.headers.get("x-nextjs-cache") === "MISS" && !html.includes(TITLE) && !html.includes(RENAMED) && !html.includes(variant(mC)), r.headers.get("x-nextjs-cache") ?? "");
  r = await rscGet(drafty.copy((k) => !k.includes("session_token")));
  ok("BD4c charge RSC avec cookies de vue brouillon volés : rien", r.status === 200 && !(await r.text()).includes(TITLE), String(r.status));

  // IDOR, gardes, page nommée.
  const qSlots = JSON.parse(slotsOf(Q.id).j);
  res = await board(homeId, created.id, { op: "remove", key: keyOfSlot(qSlots[0].id) });
  ok("BD5 emplacement d'un autre projet → refusé", res.text.includes('"ok":false') && !query(dirA, "select draft_state s from slots where id = ?", qSlots[0].id).s, line(res));
  res = await restore(homeId, { projectId: created.id, project: null, slots: [{ key: keyOfSlot(qSlots[0].id), mediaId: null, title: { fr: "", en: "" }, description: { fr: "", en: "" } }] });
  ok("BD5b instantané citant l'emplacement d'un autre projet → refusé", res.text.includes('"ok":false') && query(dirA, "select project_id p from slots where id = ?", qSlots[0].id).p === Q.id, line(res));
  res = await callActionJson(jar, ids.createDraftProjectAction, [aboutId, "Projet d'une autre page"], editor);
  const otherDraft = dataOf(res);
  res = await board(homeId, otherDraft.id, { op: "add", mediaId: mX, index: 0 });
  ok("BD5c projet en brouillon d'une autre page → refusé, la page est nommée", res.text.includes('"ok":false') && res.text.includes("sur la page À propos"), line(res));
  res = await saveDraftOf(aboutId, draftFrom(aboutId, [boardQ]));
  res = await board(aboutId, Q.id, { op: "add", mediaId: mX, index: 0 });
  ok("BD5d « À propos » modifie Q (qu'elle affiche)", isOk(res), line(res));
  res = await board(homeId, Q.id, { op: "remove", key: keyOfSlot(qSlots[0].id) });
  ok("BD5e même projet depuis l'accueil → refusé : « en cours de modification sur la page À propos »", res.text.includes('"ok":false') && res.text.includes("en cours de modification sur la page À propos"), line(res));
  const aboutKey = query(dirA, "select draft_key k from slots where draft_page_id = ? and draft_state = 'added'", aboutId).k;
  res = await restore(homeId, { projectId: Q.id, project: null, slots: [{ key: aboutKey, mediaId: null, title: { fr: "", en: "" }, description: { fr: "", en: "" } }] });
  const aboutRow = query(dirA, "select project_id p, draft_page_id g, media_id m from slots where draft_key = ?", aboutKey);
  ok("BD5f clé k… forgée visant l'emplacement ajouté d'une autre page → refusé, intact", res.text.includes('"ok":false') && aboutRow.p === Q.id && aboutRow.g === aboutId && aboutRow.m === mX, line(res));
  res = await callActionJson(jar, ids.saveProjectAction, [created.id, { title: { fr: "X", en: "" }, context: { fr: "", en: "" }, description: { fr: "", en: "" }, year: "2026", featured: true }], `/admin/projets/${Q.id}`);
  ok("BD5g écran Projets : modifier un projet en brouillon → refusé", res.text.includes('"ok":false') && query(dirA, "select featured f from projects where id = ?", created.id).f === 0, line(res));
  res = await callActionJson(jar, ids.addSlotsAction, [created.id, [mX]], `/admin/projets/${Q.id}`);
  ok("BD5h écran Projets : ajouter à un projet en brouillon → refusé", res.text.includes('"ok":false'), line(res));
  res = await callActionJson(jar, ids.deleteProjectAction, [created.id], "/admin/pages");
  ok("BD5i écran Projets : supprimer un projet en brouillon → refusé", res.text.includes('"ok":false') && Boolean(query(dirA, "select id from projects where id = ?", created.id)), line(res));

  // Bornes, formes, médias pas prêts, version.
  const bad = [
    ["position au-delà de la planche", { op: "add", mediaId: mX, index: 50 }],
    ["média inexistant", { op: "add", mediaId: 999999, index: 0 }],
    ["opération inconnue", { op: "drop", key: "s1" }],
    ["clé mal formée", { op: "remove", key: "../1" }],
    ["texte trop long", { op: "text", key: "s1", field: "title", locale: "fr", value: "x".repeat(2001) }],
    ["champ inconnu", { op: "project", field: "featured", locale: "fr", value: "1" }],
  ];
  for (const [label, op] of bad) {
    const before = pageRev(homeId);
    res = await board(homeId, created.id, op);
    ok(`BD6 ${label} → refusé, rien d'écrit`, res.status === 200 && res.text.includes('"ok":false') && pageRev(homeId) === before, `${res.status} ${line(res)}`);
  }
  for (const [status, label] of [["processing", "en conversion"], ["failed", "en échec"]]) {
    writeDb(dirA, "update media set status = ? where id = ?", status, mB);
    res = await board(homeId, created.id, { op: "add", mediaId: mB, index: 0 });
    ok(`BD6b média ${label} → refusé`, res.text.includes('"ok":false') && /conversion|échec/.test(res.text), line(res));
  }
  writeDb(dirA, "update media set status = 'ready' where id = ?", mB);
  const snapX = { projectId: created.id, project: null, slots: [{ key: "s999999", mediaId: null, title: { fr: "", en: "" }, description: { fr: "", en: "" } }] };
  res = await restore(homeId, snapX);
  ok("BD6c instantané : emplacement s<id> qui n'existe plus → refusé", res.text.includes('"ok":false'), line(res));
  res = await restore(homeId, { projectId: created.id, project: null, slots: Array.from({ length: 201 }, (_, i) => ({ key: `k${String(i).padStart(10, "0")}`, mediaId: null, title: { fr: "", en: "" }, description: { fr: "", en: "" } })) });
  ok("BD6d instantané de plus de 200 emplacements → refusé", res.text.includes('"ok":false') && query(dirA, "select count(*) n from slots where project_id = ?", created.id).n === 1, line(res));
  // v0.15 : le titre d'un projet publié se change depuis une page qui l'affiche, mais EN SURCOUCHE de cette page ; jamais en ligne.
  res = await board(homeId, P.id, { op: "project", field: "title", locale: "fr", value: "Piratage" });
  const overlay = query(dirA, "select draft_text_page_id g from projects where id = ?", P.id);
  ok("BD6e renommer un projet publié depuis la toile → le titre publié ne bouge pas (surcouche de la page seulement)", !JSON.stringify(query(dirA, "select title from projects where id = ?", P.id)).includes("Piratage") && (overlay.g === null || overlay.g === homeId), line(res));
  writeDb(dirA, "update projects set draft_text = null, draft_text_page_id = null where id = ?", P.id);
  res = await board(homeId, created.id, { op: "add", mediaId: mX, index: 0 }, pageRev(homeId) - 1);
  ok("BD6f version périmée → refusé (conflit)", code(res) === "conflict", line(res));
  res = await callActionJson(jar, ids.boardAction, [homeId, created.id, { op: "add", mediaId: mX, index: 0 }], editor);
  ok("BD6g sans version → refusé", res.text.includes('"ok":false'), line(res));


  // Médias : remplacement en brouillon protégé ; supprimé quand même → Annuler refusé, publication saine.
  res = await board(homeId, created.id, { op: "add", mediaId: mD, index: 1 });
  const withD = JSON.parse(/"after":(\{.*\}),"rev"/.exec(res.text)?.[1] ?? "null");
  const delD = await callActionJson(jar, ids.deleteMediaAction, [mD], "/admin/medias");
  ok("BD7 supprimer un média utilisé par une planche en brouillon → bloqué, la page citée", delD.text.includes('"ok":false') && delD.text.includes("references") && delD.text.includes("Accueil"), line(delD));
  const dKey = withD.slots[1].key;
  await board(homeId, created.id, { op: "remove", key: dKey });
  writeDb(dirA, "delete from media where id = ?", mD);
  res = await restore(homeId, withD);
  ok("BD7b Annuler qui rétablirait l'image supprimée → refusé", res.text.includes('"ok":false') && res.text.includes("n'existe plus"), line(res));

  // Planche d'un projet en brouillon sans image : publication refusée.
  res = await callActionJson(jar, ids.createDraftProjectAction, [homeId, "Planche vide BD"], editor);
  const emptyP = dataOf(res);
  const withEmpty = draftFrom(homeId, [board1, boardQ, { uid: "pe", type: "project-board", props: { project: emptyP.slug } }]);
  await saveDraftOf(homeId, withEmpty);
  res = await callActionJson(jar, ids.publishDraftAction, [homeId, pageRev(homeId)], editor);
  ok("BD8 planche sans image : publication refusée, message clair", res.text.includes('"ok":false') && res.text.includes("Planche vide BD") && res.text.includes("aucune image"), line(res));
  // Projet en brouillon d'une autre page cité : savePage refuse.
  await saveDraftOf(homeId, draftFrom(homeId, [board1, boardQ, { uid: "po", type: "project-board", props: { project: otherDraft.slug } }]));
  res = await callActionJson(jar, ids.publishDraftAction, [homeId, pageRev(homeId)], editor);
  ok("BD8b bloc citant le projet en brouillon d'une autre page → publication refusée", res.text.includes('"ok":false') && res.text.includes("autre page"), line(res));

  // Surcouche de P remise à l'identique (instantané d'avant) ; surcouche sur Z, que la page n'affiche pas.
  await saveDraftOf(homeId, draftFrom(homeId, [board1, boardQ]));
  res = await restore(homeId, pBefore);
  ok("BD9 instantané d'avant de P rétabli (place, titre, ajout)", isOk(res) && query(dirA, "select draft_state s from slots where id = ?", pSlots[1].id).s === null, line(res));
  const zSlot = JSON.parse(slotsOf(Z.id).j)[0];
  writeDb(dirA, "update slots set draft_state = 'retired', draft_page_id = ? where id = ?", homeId, zSlot.id);

  // Publier l'accueil.
  res = await callActionJson(jar, ids.publishDraftAction, [homeId, pageRev(homeId)], editor);
  ok("BD10 publier → projet neuf public", isOk(res) && query(dirA, "select draft_page_id p from projects where id = ?", created.id).p === null, line(res));
  ok("BD10b surcouche d'un projet non affiché (Z) : rien d'appliqué, effacée", Boolean(query(dirA, "select id from slots where id = ?", zSlot.id)) && query(dirA, "select draft_state s, draft_page_id p from slots where id = ?", zSlot.id).p === null);
  ok("BD10c projets en brouillon non cités (A, planche vide) supprimés", !query(dirA, "select id from projects where id = ?", projA.id) && !query(dirA, "select id from projects where id = ?", emptyP.id));
  ok("BD10d surcouche de Q (tenue par « À propos ») intacte", query(dirA, "select draft_page_id g from slots where draft_key = ?", aboutKey)?.g === aboutId);
  r = await http("/fr");
  html = await r.text();
  ok("BD10e anonyme : la planche neuve (cache revalidé), sans repère d'édition", html.includes(TITLE) && html.includes(variant(mX)) && !/data-edit-|data-placeholder|pe-slot-legend/.test(html));
  r = await http("/fr/personnages");
  // v0.13 : les planches se posent une à une ; un projet n'apparaît plus tout seul sur une page de collection.
  ok("BD10f le projet n'apparaît pas tout seul sur la page Personnages (planches posées une à une)", !(await r.text()).includes(TITLE));

  // Abandonner (« À propos ») : surcouche et projet créé effacés.
  res = await callActionJson(jar, ids.discardDraftAction, [aboutId, pageRev(aboutId)], `/admin/pages/${aboutId}/editer`);
  ok("BD11 abandonner → projet créé en brouillon supprimé, emplacement ajouté supprimé", isOk(res) && !query(dirA, "select id from projects where id = ?", otherDraft.id) && !query(dirA, "select id from slots where draft_key = ?", aboutKey), line(res));

  // En-tête, pied, réseaux (v0.13) : brouillon COMMUN du site (lot 96), versionné par `siteDraftRev` (pas par une page), validé.
  {
    const siteRow = () => query(dirA, "select value from settings where key = 'siteDraft'")?.value ?? null;
    const siteRev = () => Number(query(dirA, "select value from settings where key = 'siteDraftRev'")?.value ?? 0);
    const publishedSite = query(dirA, "select value from settings where key = 'site'").value;
    const publishedSocials = query(dirA, "select value from settings where key = 'socials'")?.value ?? "[]";
    const snap = (over = {}) => ({
      identity: { name: { fr: "Nom de brouillon SD", en: "" }, role: { fr: "", en: "" }, email: "", credit: { fr: "", en: "" } },
      nav: [],
      socials: [],
      ...over,
    });
    const siteDraft = (page, value, rev = siteRev(), prev = pageRev(page)) => callActionJson(jar, ids.siteDraftAction, [page, value, rev, prev], editor);
    res = await siteDraft(aboutId, snap({ socials: [{ label: "X", href: "javascript:alert(1)" }] }));
    ok("SD1 réseau javascript: → refusé, rien d'écrit", res.text.includes('"ok":false') && siteRow() === null, line(res));
    res = await siteDraft(aboutId, snap({ nav: [{ kind: "link", href: "//evil.example", label: { fr: "x", en: "x" } }] }));
    ok("SD1b lien de menu « //hôte » → refusé", res.text.includes('"ok":false') && siteRow() === null, line(res));
    res = await siteDraft(aboutId, { ...snap(), admin: true });
    ok("SD1c champ arbitraire → refusé", res.text.includes('"ok":false') && siteRow() === null, line(res));
    res = await siteDraft(aboutId, snap(), siteRev() + 5);
    ok("SD2 version du brouillon du site périmée → conflit", code(res) === "conflict" && siteRow() === null, line(res));
    res = await callActionJson(jar, ids.siteDraftAction, [aboutId, snap()], editor);
    ok("SD3 sans version → refusé", res.text.includes('"ok":false') && siteRow() === null, line(res));
    res = await callActionJson(jar, ids.siteDraftAction, [aboutId, snap(), siteRev()], editor);
    ok("SD3b sans version de la page → refusé", res.text.includes('"ok":false') && siteRow() === null, line(res));
    res = await siteDraft(aboutId, snap(), siteRev(), pageRev(aboutId) + 3);
    ok("SD3c version de la page périmée → conflit, rien d'écrit", code(res) === "conflict" && siteRow() === null, line(res));
    const revBefore = siteRev();
    const pageRevBefore = pageRev(aboutId);
    res = await siteDraft(aboutId, snap({ socials: [{ label: "Behance", href: "https://www.behance.net/x", kind: "behance" }] }));
    ok("SD4 instantané valide → brouillon du site écrit (page = la dernière qui l'a modifié), version du SITE incrémentée, celle de la page aussi (rendu de la toile), sans brouillon de page créé", res.text.includes('"ok":true') && JSON.parse(siteRow()).pageId === aboutId && siteRev() === revBefore + 1 && pageRev(aboutId) === pageRevBefore + 1 && query(dirA, "select draft from pages where id = ?", aboutId)?.draft === null, line(res));
    ok("SD4b rien de public : réglages publiés inchangés", query(dirA, "select value from settings where key = 'site'").value === publishedSite);
    res = await siteDraft(homeId, snap({ socials: [{ label: "Behance", href: "https://www.behance.net/y", kind: "behance" }] }));
    ok("SD5 une AUTRE page le modifie aussi (plus de verrou), pageId suit", res.text.includes('"ok":true') && JSON.parse(siteRow()).pageId === homeId && JSON.parse(siteRow()).snap.socials[0].href.endsWith("/y"), line(res));
    res = await siteDraft(aboutId, snap(), revBefore + 1);
    ok("SD5b l'ancienne version (avant l'écriture de l'autre page) → conflit, rien d'écrasé", code(res) === "conflict" && JSON.parse(siteRow()).pageId === homeId, line(res));
    const settingsInput = { site: JSON.parse(publishedSite), socials: JSON.parse(publishedSocials) };
    const revSettings = siteRev();
    res = await callActionJson(jar, ids.saveSettingsAction, [{ ...settingsInput, site: { ...settingsInput.site, email: "sd6@example.test" } }], "/admin/reglages");
    ok("SD6 écran Réglages : enregistre malgré le brouillon (publie), le reporte dans le brouillon, la version change", res.text.includes('"ok":true') && JSON.parse(query(dirA, "select value from settings where key = 'site'").value).email === "sd6@example.test" && JSON.parse(siteRow()).snap.identity.email === "sd6@example.test" && siteRev() > revSettings, line(res));
    res = await callActionJson(jar, ids.discardDraftAction, [aboutId, pageRev(aboutId)], editor);
    ok("SD7 abandonner la page n'efface PAS le brouillon du site", res.text.includes('"ok":true') && siteRow() !== null, line(res));
    res = await callActionJson(jar, ids.discardSiteDraftAction, [siteRev() - 1], editor);
    ok("SD7b « Annuler ces changements du site » avec une version périmée → conflit", code(res) === "conflict" && siteRow() !== null, line(res));
    res = await callActionJson(jar, ids.discardSiteDraftAction, [siteRev()], editor);
    ok("SD7c « Annuler ces changements du site » → brouillon effacé, version incrémentée", res.text.includes('"ok":true') && siteRow() === null, line(res));
    // Audit I-3 : une page disparue dans le menu est retirée en silence (jamais un éditeur bloqué).
    res = await siteDraft(aboutId, snap({ nav: [{ kind: "page", pageId: 99999 }] }));
    ok("SD8 page inexistante dans le menu → retirée (autonettoyage), enregistré", res.text.includes('"ok":true') && !siteRow()?.includes("99999"), line(res));
    await callActionJson(jar, ids.discardSiteDraftAction, [siteRev()], editor);
    // Remise en état des réglages publiés (SD6).
    await callActionJson(jar, ids.saveSettingsAction, [settingsInput], "/admin/reglages");
  }

  // Remise en état : planches retirées de l'accueil, projet supprimé.
  const homeRow = query(dirA, "select title, slug, meta, published, nav_order from pages where id = ?", homeId);
  res = await savePageForm(jar, homeId, { title: JSON.parse(homeRow.title), slug: JSON.parse(homeRow.slug), meta: homeRow.meta ? JSON.parse(homeRow.meta) : { title: { fr: "", en: "" }, description: { fr: "", en: "" } }, published: true, inMenu: homeRow.nav_order !== null, accent: null, blocks: homeBlocks }, pageRev(homeId), `/admin/pages/${homeId}`);
  const del = await callActionJson(jar, ids.deleteProjectAction, [created.id], "/admin/pages");
  ok("BD12 remise en état (planches retirées, projet supprimé → corbeille)", isOk(res) && isOk(del) && Boolean(query(dirA, "select deleted_at d from projects where id = ?", created.id)?.d), `${line(res)} ${line(del)}`);
}
{
  let res = await callActionJson(jar, ids.duplicateThemeAction, ["galerie-lumineuse"], "/admin/themes");
  const copyId = /"id":"(galerie-lumineuse-copie[a-z0-9-]*)"/.exec(res.text)?.[1];
  ok("A11 dupliquer un preset (session admin)", res.status === 200 && Boolean(copyId), res.text.slice(0, 200));
  // Thème complet tiré de la base de test, avec une couleur de texte illisible.
  const theme = JSON.parse(query(dirA, "select data from themes where id = ?", copyId).data);
  theme.tokens.color.inkSoft = "#d0d0d0";
  res = await callActionJson(jar, ids.saveThemeAction, [copyId, theme], `/admin/themes/${copyId}`);
  // Depuis la v0.21.1 le contraste n'est jamais bloquant : l'éditeur de thème avertit, le serveur enregistre.
  ok("A12 contraste insuffisant (texte secondaire #d0d0d0) → accepté par le serveur, sans refus pour contraste", res.status === 200 && res.text.includes('"ok":true') && !res.text.includes("Contraste insuffisant"), res.text.slice(0, 300));
  const stored = JSON.parse(query(dirA, "select data from themes where id = ?", copyId).data);
  ok("A12b la couleur est enregistrée telle quelle", stored.tokens.color.inkSoft === "#d0d0d0", stored.tokens.color.inkSoft);
  res = await callActionJson(jar, ids.saveThemeAction, ["galerie-lumineuse", theme], "/admin/themes");
  ok("A12c un preset ne se modifie pas", /Un modèle ne se modifie pas/.test(res.text), res.text.slice(0, 200));
  theme.tokens.color.inkSoft = "#5f636a";
  theme.tokens.color.bg = "#fff;}body{display:none";
  res = await callActionJson(jar, ids.saveThemeAction, [copyId, theme], `/admin/themes/${copyId}`);
  ok("A12d valeur CSS injectée → refusée par le schéma", res.text.includes('"ok":false'), res.text.slice(0, 200));
  // v0.18.1 : le thème en ligne ne s'enregistre que confirmé (champ `confirmLive`, vérifié côté serveur).
  {
    const live = JSON.parse(query(dirA, "select data from themes where id = ?", copyId).data);
    await callActionJson(jar, ids.activateThemeAction, [copyId], "/admin/themes");
    live.name = "Copie en ligne renommée";
    res = await callActionJson(jar, ids.saveThemeAction, [copyId, live], `/admin/themes/${copyId}`);
    ok("A12e thème en ligne sans confirmLive → refusé avec un message clair", res.text.includes('"ok":false') && res.text.includes("Confirme la mise en ligne") && JSON.parse(query(dirA, "select data from themes where id = ?", copyId).data).name !== live.name, res.text.slice(0, 200));
    res = await callActionJson(jar, ids.saveThemeAction, [copyId, live, "oui"], `/admin/themes/${copyId}`);
    ok("A12e confirmLive doit valoir exactement true", res.text.includes('"ok":false'), res.text.slice(0, 200));
    res = await callActionJson(jar, ids.saveThemeAction, [copyId, live, true], `/admin/themes/${copyId}`);
    ok("A12e thème en ligne avec confirmLive: true → enregistré", res.text.includes('"ok":true') && JSON.parse(query(dirA, "select data from themes where id = ?", copyId).data).name === live.name, res.text.slice(0, 200));
    await callActionJson(jar, ids.activateThemeAction, ["galerie-lumineuse"], "/admin/themes");
    res = await callActionJson(jar, ids.saveThemeAction, [copyId, { ...live, name: "Hors ligne" }], `/admin/themes/${copyId}`);
    ok("A12e thème hors ligne : aucune confirmation demandée", res.text.includes('"ok":true'), res.text.slice(0, 200));
  }
  res = await callActionJson(jar, ids.createPageAction, [{ title: { fr: "Admin", en: "Admin" }, slug: { fr: "admin", en: "admin-en" } }], "/admin/pages");
  ok("A13 slug réservé → refusé", res.text.includes("réservé") && res.text.includes('"ok":false'), res.text.slice(0, 300));
  res = await callActionJson(jar, ids.createPageAction, [{ title: { fr: "X", en: "X" }, slug: { fr: "_cache", en: "Majuscules" } }], "/admin/pages");
  ok("A13b « _ » en tête et majuscules → refusés", res.text.includes("commencer par « _ »") || res.text.includes('"ok":false'), res.text.slice(0, 300));
  res = await callActionJson(jar, ids.createPageAction, [{ title: { fr: "Doublon", en: "Duplicate" }, slug: { fr: "personnages", en: "duplicate" } }], "/admin/pages");
  ok("A13c slug déjà pris dans la langue → refusé", res.text.includes("déjà prise"), res.text.slice(0, 300));
  const site = { name: { fr: "Test", en: "" }, role: { fr: "", en: "" }, email: "test@example.test", credit: { fr: "", en: "" } };
  // v0.16 : nom du site fr / en. Le français est obligatoire, les noms trop longs et les champs inconnus sont refusés.
  for (const [label, name] of [["fr vide", { fr: "", en: "x" }], ["trop long", { fr: "x".repeat(81), en: "" }], ["champ inconnu", { fr: "a", en: "", de: "b" }]]) {
    res = await callActionJson(jar, ids.saveSettingsAction, [{ site: { ...site, name }, socials: [] }], "/admin/reglages");
    ok(`A13d nom du site refusé (${label})`, res.text.includes('"ok":false'), res.text.slice(0, 200));
  }
  res = await callActionJson(jar, ids.saveSettingsAction, [{ site: { ...site, name: "Ancien format" }, socials: [{ label: "X", href: "javascript:alert(1)" }] }], "/admin/reglages");
  ok("A13e nom du site : l'ancienne chaîne reste lisible (refus dû aux réseaux seulement)", res.text.includes('"ok":false') && !res.text.includes("nom du site"), res.text.slice(0, 200));
  res = await callActionJson(jar, ids.saveSettingsAction, [{ site, socials: [{ label: "X", href: "javascript:alert(1)" }] }], "/admin/reglages");
  ok("A14 URL javascript: dans les réseaux → refusée", res.text.includes("https://") && res.text.includes('"ok":false'), res.text.slice(0, 300));
  res = await callActionJson(jar, ids.saveSettingsAction, [{ site, socials: [{ label: "X", href: "data:text/html,<script>alert(1)</script>" }] }], "/admin/reglages");
  ok("A14b URL data: → refusée (v0.13 : http(s) et mailto: seulement)", res.text.includes('"ok":false'));
  const persoId = query(dirA, `select id from pages where json_extract(slug,'$.fr')='personnages'`).id;
  res = await callActionJson(jar, ids.deletePageAction, [persoId], "/admin/pages");
  ok("A15 supprimer une page référencée → bloqué avec la liste (entrées automatiques : seul le lien « voir plus » la retient)", res.text.includes("references") && /Entrées des collections|Projet mis en avant|Lien vers une page/.test(res.text), res.text.slice(0, 300));
  const homeId = query(dirA, `select id from pages where json_extract(slug,'$.fr')=''`).id;
  res = await callActionJson(jar, ids.deletePageAction, [homeId], "/admin/pages");
  ok("A15b l'accueil ne se supprime pas", res.text.includes("accueil ne se supprime pas"));
  // Corbeille (lot 23) : supprimer = mettre à la corbeille, restaurer ; identifiants invalides refusés (client forgé).
  for (const [name, screen] of [["restorePageAction", "/admin/pages"], ["restoreProjectAction", "/admin/pages"], ["restoreMediaAction", "/admin/medias"], ["deletePageAction", "/admin/pages"], ["deleteProjectAction", "/admin/pages"], ["deleteMediaAction", "/admin/medias"]]) {
    const bad = [];
    for (const arg of ["x", -1, 0, 1.5, null, {}, [1], 1e21, 999999]) {
      const r = await callActionJson(jar, ids[name], [arg], screen);
      if (!r.text.includes('"ok":false')) bad.push(JSON.stringify(arg));
    }
    ok(`A15c ${name} : identifiant invalide ou inconnu → refusé`, bad.length === 0, bad.join(" "));
  }
  {
    const bad = [];
    for (const arg of ["x", null, {}, [1], { kind: "page" }, { kind: "page", id: -1 }, { kind: "page", id: 1.5 }, { kind: "autre", id: 1 }, { kind: "page", id: 1, extra: true }, { kind: "page", id: 999999 }]) {
      const r = await callActionJson(jar, ids.purgeTrashItemAction, [arg], "/admin/pages");
      if (!r.text.includes('"ok":false')) bad.push(JSON.stringify(arg));
    }
    ok("A15c2 purgeTrashItemAction : charge invalide ou inconnue → refusée", bad.length === 0, bad.join(" "));
    const homeRow = query(dirA, "select id from pages where json_extract(slug,'$.fr')=''").id;
    res = await callActionJson(jar, ids.purgeTrashItemAction, [{ kind: "page", id: homeRow }], "/admin/pages");
    ok("A15c3 supprimer définitivement une page EN LIGNE → refusé, page intacte", res.text.includes('"ok":false') && res.text.includes("corbeille") && Boolean(query(dirA, "select id from pages where id = ?", homeRow)), res.text.slice(0, 160));
  }
  res = await callActionJson(jar, ids.restorePageAction, [persoId], "/admin/pages");
  ok("A15d restaurer une page qui n'est pas à la corbeille → refusé", res.text.includes('"ok":false') && res.text.includes("corbeille"), res.text.slice(0, 200));
  {
    const mk = await callActionJson(jar, ids.createPageAction, [{ title: { fr: "Corbeille A15", en: "" }, slug: { fr: "corbeille-a15", en: "" } }], "/admin/pages");
    const pid = Number(/"ok":true,"data":\{"id":(\d+)\}/.exec(mk.text)?.[1]);
    ok("A15e création sans titre anglais ni adresse anglaise → acceptée, repli sur le français", Boolean(pid) && JSON.parse(query(dirA, "select title t from pages where id = ?", pid).t).en === "Corbeille A15" && JSON.parse(query(dirA, "select slug s from pages where id = ?", pid).s).en === "corbeille-a15", mk.text.slice(0, 200));
    await callActionJson(jar, ids.setPublishedAction, [pid, true], "/admin/pages");
    const live = await http("/fr/corbeille-a15");
    ok("A15e2 page publiée → 200 en public", live.status === 200, String(live.status));
    res = await callActionJson(jar, ids.deletePageAction, [pid], "/admin/pages");
    const row = query(dirA, "select deleted_at d from pages where id = ?", pid);
    ok("A15f supprimer une page → corbeille (ligne gardée, date posée), jamais effacée", res.text.includes('"ok":true') && Boolean(row?.d), `${res.text.slice(0, 160)} ${JSON.stringify(row)}`);
    const pub = await http("/fr/corbeille-a15");
    ok("A15g une page à la corbeille répond 404 en public", pub.status === 404, String(pub.status));
    res = await callActionJson(jar, ids.restorePageAction, [pid], "/admin/pages");
    ok("A15h restaurer → de retour (date effacée)", res.text.includes('"ok":true') && query(dirA, "select deleted_at d from pages where id = ?", pid)?.d === null, res.text.slice(0, 160));
    await callActionJson(jar, ids.deletePageAction, [pid], "/admin/pages");
  }
  res = await callSavePage(jar, [homeId, { title: { fr: "A", en: "A" }, slug: { fr: "", en: "" }, meta: { title: { fr: "", en: "" }, description: { fr: "", en: "" } }, published: true, inMenu: false, accent: null, blocks: [{ type: "hero", props: { eyebrow: { fr: "", en: "" }, statement: { fr: "", en: "" }, reelPageId: 99999 } }] }], `/admin/pages/${homeId}`);
  ok("A16 bloc pointant vers une page inexistante → refusé", res.text.includes("page qui n") && res.text.includes('"ok":false'), res.text.slice(0, 300));
  // Accent de page peu contrasté (#fafafa sur le fond du thème) : accepté et enregistré (avertissement dans l'éditeur seulement).
  // Page de passage : l'accueil garde son contenu pour la suite.
  res = await callActionJson(jar, ids.createPageAction, [{ title: { fr: "Accent A16b", en: "Accent A16b" }, slug: { fr: "accent-a16b", en: "accent-a16b" } }], "/admin/pages");
  const lowId = Number(/"data":\{"id":(\d+)\}/.exec(res.text)?.[1]);
  res = await callSavePage(jar, [lowId, { title: { fr: "Accent A16b", en: "Accent A16b" }, slug: { fr: "accent-a16b", en: "accent-a16b" }, meta: { title: { fr: "", en: "" }, description: { fr: "", en: "" } }, published: true, inMenu: false, accent: "#fafafa", blocks: [] }], `/admin/pages/${lowId}`);
  ok("A16b accent de page sous AA → accepté et enregistré (jamais refusé pour contraste)", res.text.includes('"ok":true') && !res.text.includes("Contraste insuffisant") && /#fafafa/i.test(query(dirA, "select theme_overrides o from pages where id = ?", lowId)?.o ?? ""), res.text.slice(0, 300));
  await callActionJson(jar, ids.deletePageAction, [lowId], "/admin/pages");
  res = await callActionJson(jar, ids.deleteThemeAction, ["galerie-lumineuse"], "/admin/themes");
  ok("A17 thème en ligne ou livré : suppression refusée", res.text.includes('"ok":false'));
  res = await callActionJson(jar, ids.deleteThemeAction, [copyId], "/admin/themes");
  ok("A17b thème personnel hors ligne : supprimé", res.text.includes('"ok":true'));

  // m1 : clés héritées d'Object.prototype comme type de bloc ou id de thème.
  for (const type of ["constructor", "__proto__", "hasOwnProperty"]) {
    res = await callSavePage(jar, [homeId, { title: { fr: "A", en: "A" }, slug: { fr: "", en: "" }, meta: { title: { fr: "", en: "" }, description: { fr: "", en: "" } }, published: true, inMenu: false, accent: null, blocks: [{ type, props: {} }] }], `/admin/pages/${homeId}`);
    ok(`A18 type de bloc « ${type} » → refusé proprement (pas de 500)`, res.status === 200 && res.text.includes('"ok":false'), `${res.status} ${res.text.slice(0, 160)}`);
  }
  for (const id of ["constructor", "__proto__"]) {
    const r2 = await postForm(jar, "/admin/apercu", { id });
    ok(`A18b aperçu du thème « ${id} » → 400`, r2.status === 400, String(r2.status));
  }
  // m2 : l'ordre du menu doit être une permutation exacte.
  const menuIds = JSON.parse(query(dirA, "select json_group_array(id) ids from (select id from pages where nav_order is not null order by nav_order)").ids);
  res = await callActionJson(jar, ids.reorderMenuAction, [menuIds.map(() => menuIds[0])], "/admin/pages");
  ok("A19 ordre du menu avec doublons → refusé", res.text.includes('"ok":false'), res.text.slice(0, 160));
  res = await callActionJson(jar, ids.reorderMenuAction, [[...menuIds].reverse()], "/admin/pages");
  ok("A19b permutation exacte → acceptée", res.text.includes('"ok":true'));
  await callActionJson(jar, ids.reorderMenuAction, [menuIds], "/admin/pages");
  // m3, m4 : valeurs CSS, chemins d'assets, longueurs.
  res = await callActionJson(jar, ids.duplicateThemeAction, ["galerie-lumineuse"], "/admin/themes");
  const copy2 = /"id":"(galerie-lumineuse-copie[a-z0-9-]*)"/.exec(res.text)?.[1];
  const base = JSON.parse(query(dirA, "select data from themes where id = ?", copy2).data);
  const variants = [
    ["A20 cssValue avec url(", (t) => (t.tokens.radius.md = "url(https://evil.example/x)")],
    ["A20b cssValue avec commentaire", (t) => (t.tokens.space.gutter = "1rem /* x */")],
    ["A20c heroLayers hors /themes/", (t) => (t.assets.heroLayers = ["/media/x.svg"])],
    ["A20d heroLayers avec ..", (t) => (t.assets.heroLayers = ["/themes/a/../../etc.svg"])],
    ["A20e heroLayers avec //", (t) => (t.assets.heroLayers = ["/themes/a//b.svg"])],
    ["A21 nom de thème de 81 caractères", (t) => (t.name = "x".repeat(81))],
  ];
  for (const [label, mutate] of variants) {
    const t = structuredClone(base);
    mutate(t);
    res = await callActionJson(jar, ids.saveThemeAction, [copy2, t], `/admin/themes/${copy2}`);
    ok(`${label} → refusé`, res.text.includes('"ok":false'), res.text.slice(0, 160));
  }
  await callActionJson(jar, ids.deleteThemeAction, [copy2], "/admin/themes");
  res = await callActionJson(jar, ids.createPageAction, [{ title: { fr: "x".repeat(81), en: "x" }, slug: { fr: "long", en: "long" } }], "/admin/pages");
  ok("A21b titre de page de 81 caractères → refusé", res.text.includes('"ok":false'));
  res = await callActionJson(jar, ids.saveSettingsAction, [{ site: { name: "Test", role: { fr: "x".repeat(161), en: "" }, email: "a@b.fr", credit: { fr: "", en: "" } }, socials: [] }], "/admin/reglages");
  ok("A21c réglage de 161 caractères → refusé", res.text.includes('"ok":false'));

  // m5 : une page non publiée n'existe que pour un aperçu admin vérifié.
  res = await callActionJson(jar, ids.createPageAction, [{ title: { fr: "Brouillon secret", en: "Secret draft" }, slug: { fr: "brouillon-secret", en: "secret-draft" } }], "/admin/pages");
  const draftId = Number(/"data":\{"id":(\d+)\}/.exec(res.text)?.[1]);
  ok("A22 page non publiée créée", draftId > 0, res.text.slice(0, 120));
  let r3 = await http("/fr/brouillon-secret");
  ok("A22a visiteur → vrai 404", r3.status === 404, String(r3.status));
  const fake = new Jar();
  fake.cookies.set("__Secure-better-auth.session_token", "jeton-forge.signature");
  fake.cookies.set("__prerender_bypass", "0123456789abcdef0123456789abcdef");
  r3 = await http("/fr/brouillon-secret", { jar: fake });
  ok("A22b cookies factices (session + draft) → 404", r3.status === 404, String(r3.status));
  const noDraft = jar.copy((k) => k !== "__prerender_bypass" && k !== "theme-preview");
  r3 = await http("/fr/brouillon-secret", { jar: noDraft });
  ok("A22c session admin sans draft mode → 404", r3.status === 404, String(r3.status));
  const fakeDraft = noDraft.copy();
  fakeDraft.cookies.set("__prerender_bypass", "0123456789abcdef0123456789abcdef");
  r3 = await http("/fr/brouillon-secret", { jar: fakeDraft });
  ok("A22d session admin + cookie de draft forgé → 404", r3.status === 404, String(r3.status));
  const previewJar = noDraft.copy();
  r3 = await postForm(previewJar, "/admin/apercu", { page: String(draftId) });
  ok("A22e aperçu de la page (POST) → 303 vers son adresse", r3.status === 303 && r3.headers.get("location") === "/fr/brouillon-secret", `${r3.status} ${r3.headers.get("location")}`);
  r3 = await http("/fr/brouillon-secret", { jar: previewJar });
  const draftHtml = await r3.text();
  ok("A22f admin en aperçu → 200, page rendue, bandeau d'aperçu", r3.status === 200 && draftHtml.includes("Brouillon secret") && draftHtml.includes("pages non publiées visibles"), String(r3.status));
  r3 = await http("/fr/nexiste-pas", { jar: previewJar });
  ok("A22g admin en aperçu, adresse inconnue → 404", r3.status === 404, String(r3.status));
  await callActionJson(jar, ids.deletePageAction, [draftId], "/admin/pages");

  // m6 : accent contrôlé contre le thème en ligne, ignoré au rendu s'il ne passe plus.
  res = await callActionJson(jar, ids.createPageAction, [{ title: { fr: "Accent", en: "Accent" }, slug: { fr: "accent-test", en: "accent-test" } }], "/admin/pages");
  const accentId = Number(/"data":\{"id":(\d+)\}/.exec(res.text)?.[1]);
  const pagePayload = { title: { fr: "Accent", en: "Accent" }, slug: { fr: "accent-test", en: "accent-test" }, meta: { title: { fr: "", en: "" }, description: { fr: "", en: "" } }, published: true, inMenu: false, accent: "#2e4e9e", blocks: [{ type: "contact", props: { eyebrow: { fr: "E", en: "E" }, title: { fr: "T", en: "T" }, intro: { fr: "I", en: "I" }, cta: { fr: "C", en: "C" } } }] };
  res = await callSavePage(jar, [accentId, pagePayload], `/admin/pages/${accentId}`);
  ok("A23 accent lisible avec le thème en ligne → enregistré", res.text.includes('"ok":true'), res.text.slice(0, 200));
  r3 = await http("/fr/accent-test");
  ok("A23a accent appliqué au rendu", (await r3.text()).includes("--color-primary:#2e4e9e"));
  await callActionJson(jar, ids.activateThemeAction, ["salle-de-projection"], "/admin/themes");
  r3 = await http("/fr/accent-test");
  ok("A23b thème sombre en ligne : l'accent peu lisible est quand même appliqué au rendu (avertissement seulement)", (await r3.text()).includes("--color-primary:#2e4e9e"));
  ok("A23c le serveur ne l'écarte plus (aucun journal « accent … de la page » ignoré)", !s.text().includes("accent #2e4e9e de la page"));
  await callActionJson(jar, ids.activateThemeAction, ["galerie-lumineuse"], "/admin/themes");
  await callActionJson(jar, ids.deletePageAction, [accentId], "/admin/pages");

  // ---- Envois d'images (phase 4b) ----------------------------------------------
  const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#2e4e9e" } }).png().toBuffer();
  const jpeg = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#c0503a" } }).jpeg().toBuffer();
  const mediaBefore = query(dirA, "select count(*) n from media").n;
  let up = await upload(new Jar(), "a.png", "image/png", png);
  const tmpU1 = existsSync(path.join(dirA, "tmp")) ? readdirSync(path.join(dirA, "tmp")).length : 0;
  ok("U1/T10 envoi sans session → 403, aucune ligne, tmp/ vide", up.status === 403 && query(dirA, "select count(*) n from media").n === mediaBefore && tmpU1 === 0, `${up.status} tmp=${tmpU1}`);
  up = await upload(forged, "a.png", "image/png", png);
  ok("U1b envoi avec un cookie forgé → 403", up.status === 403, String(up.status));
  up = await upload(jar, "a.png", "image/png", png, { origin: "https://site-malveillant.example" });
  ok("U2 envoi depuis une autre origine → 403", up.status === 403 && /Origine refusée/.test(up.text), `${up.status} ${up.text.slice(0, 80)}`);
  up = await upload(jar, "photo.png", "image/png", jpeg);
  ok("U3 JPEG renommé en .png → accepté comme JPEG (type lu dans le fichier)", up.status === 200 && query(dirA, "select mime from media where id = ?", up.json?.media?.id)?.mime === "image/jpeg", up.text.slice(0, 160));
  up = await upload(jar, "image.jpg", "image/jpeg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>'));
  ok("U4 SVG déguisé en .jpg → refusé (415, message clair)", up.status === 415 && /Formats possibles : JPEG, PNG, WebP, AVIF, GIF/.test(up.json?.message ?? ""), `${up.status} ${up.text.slice(0, 120)}`);
  up = await upload(jar, "page.jpg", "image/jpeg", Buffer.from("<!doctype html><html><script>alert(document.cookie)</script></html>"));
  ok("U4b HTML déguisé en .jpg → refusé", up.status === 415);
  // Polyglotte GIF/JS : en-tête GIF valide, puis du JavaScript.
  const gif = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#000000" } }).gif().toBuffer();
  const polyglot = Buffer.concat([gif, Buffer.from("\n*/=1;alert(document.domain);/*")]);
  up = await upload(jar, "poly.gif", "image/gif", polyglot);
  const polyId = up.json?.media?.id;
  const polyRow = polyId ? await waitMedia(dirA, polyId) : null;
  const polyFiles = polyRow?.variants ? JSON.parse(polyRow.variants).files : [];
  // Le GIF est valide : il doit être accepté, traité, et servi ré-encodé seulement.
  let polyOk = false;
  if (up.status === 200 && polyRow?.status === "ready" && polyFiles.length) {
    const v = await http(`/media/${polyFiles[0].key}`);
    const bytes = Buffer.from(await v.arrayBuffer());
    const orig = query(dirA, "select key from media where id = ?", polyId).key;
    polyOk =
      /image\/(avif|webp)/.test(v.headers.get("content-type") ?? "") &&
      !bytes.includes(Buffer.from("alert(")) &&
      /sandbox/.test(v.headers.get("content-security-policy") ?? "") &&
      (await http(`/media/${orig}`)).status === 404;
  }
  ok("U5 polyglotte GIF/JS : accepté, servi ré-encodé seulement (sans le JavaScript), original introuvable", polyOk, `${up.status} ${polyRow?.status}`);

  // Fichier de 300 Mo coupé pendant le flux (sans Content-Length).
  const pid = s.child.pid;
  const before = procMem(pid);
  const boundary = "----coupe300";
  let sent = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (sent === 0) controller.enqueue(new TextEncoder().encode(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="enorme.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`));
      if (sent >= 300 * 1024 * 1024) {
        controller.enqueue(new TextEncoder().encode(`\r\n--${boundary}--\r\n`));
        controller.close();
        return;
      }
      const chunk = new Uint8Array(1024 * 1024);
      chunk[0] = 0xff;
      controller.enqueue(chunk);
      sent += chunk.length;
    },
  });
  let bigStatus = 0;
  let bigMessage = "";
  try {
    const res = await fetch(`${BASE}/admin/api/upload`, {
      method: "POST",
      body: stream,
      duplex: "half",
      headers: { cookie: jar.header(), origin: BASE, "content-type": `multipart/form-data; boundary=${boundary}` },
    });
    bigStatus = res.status;
    bigMessage = (await res.json().catch(() => ({}))).message ?? "";
  } catch (e) {
    bigStatus = -1; // connexion coupée par le serveur : acceptable
    bigMessage = String(e);
  }
  const after = procMem(pid);
  const tmpLeft = existsSync(path.join(dirA, "tmp")) ? readdirSync(path.join(dirA, "tmp")).length : 0;
  ok(
    `U6 300 Mo coupés en flux (envoyé ${Math.round(sent / 1024 / 1024)} Mo) : refus 413, pic mémoire du serveur ${before.hwm} → ${after.hwm} Mo, aucun fichier temporaire`,
    // Discriminant : sans coupure en flux, les 300 Mo partiraient en entier.
    (bigStatus === 413 || bigStatus === -1) && sent < 250 * 1024 * 1024 && after.hwm - before.hwm < 150 && tmpLeft === 0,
    `${bigStatus} ${bigMessage.slice(0, 80)} tmp=${tmpLeft}`,
  );
  console.log(`      (mémoire du serveur : VmRSS ${before.rss} → ${after.rss} Mo, VmHWM ${before.hwm} → ${after.hwm} Mo)`);

  const bomb = await pixelBomb();
  const beforeBomb = procMem(pid);
  up = await upload(jar, "bombe.png", "image/png", bomb);
  const afterBomb = procMem(pid);
  ok(
    `U7 bombe de pixels 50 000 × 50 000 (${Math.round(bomb.length / 1024)} Ko) → refusée sans décodage (VmHWM ${beforeBomb.hwm} → ${afterBomb.hwm} Mo)`,
    up.status === 422 && /mégapixels|px au plus/.test(up.json?.message ?? "") && afterBomb.hwm - beforeBomb.hwm < 100,
    `${up.status} ${up.text.slice(0, 120)}`,
  );

  up = await upload(jar, "../../etc/pass\u0001wd‮.png", "image/png", await sharp({ create: { width: 10, height: 10, channels: 3, background: "#123456" } }).png().toBuffer());
  const named = query(dirA, "select key, original_name from media where id = ?", up.json?.media?.id);
  ok(
    "U8 nom avec ../ et caractères de contrôle : nettoyé, rangé sous originals/",
    up.status === 200 && named?.original_name === "passwd.png" && /^originals\/[0-9a-f]{64}\.png$/.test(named?.key ?? "") && !existsSync(path.join(dirA, "etc")),
    `${up.status} ${up.text.slice(0, 120)} ${JSON.stringify(named)}`,
  );

  const many = await Promise.all(
    Array.from({ length: 10 }, async (_, i) =>
      upload(jar, `lot-${i}.png`, "image/png", await sharp({ create: { width: 40 + i, height: 30, channels: 3, background: `#${(i * 20).toString(16).padStart(2, "0")}8040` } }).png().toBuffer()),
    ),
  );
  const manyIds = many.map((m) => m.json?.media?.id).filter(Boolean);
  const manyRows = await Promise.all(manyIds.map((id) => waitMedia(dirA, id, 90000)));
  ok("U9 10 envois simultanés : tous acceptés puis traités", many.every((m) => m.status === 200) && manyRows.every((r) => r?.status === "ready"), many.map((m) => m.status).join(","));

  const gps = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#556677" } })
    .jpeg()
    .withExif({ IFD0: { Make: "TestCam", Model: "Secret-1" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "48/1 51/1 2400/100", GPSLongitudeRef: "E", GPSLongitude: "2/1 21/1 300/100" } })
    .withMetadata({ orientation: 6 })
    .toBuffer();
  up = await upload(jar, "gps.jpg", "image/jpeg", gps);
  const gpsRow = await waitMedia(dirA, up.json?.media?.id);
  const gpsFiles = gpsRow?.variants ? JSON.parse(gpsRow.variants).files : [];
  let clean = gpsFiles.length > 0;
  for (const f of gpsFiles) {
    const res = await http(`/media/${f.key}`);
    const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    if (res.status !== 200 || meta.exif || meta.xmp || meta.width > meta.height) clean = false;
  }
  ok(`U10 variantes sans EXIF ni GPS, orientation appliquée (${gpsFiles.length} fichiers vérifiés)`, clean);
  const original = query(dirA, "select key from media where id = ?", up.json?.media?.id)?.key;
  const r10 = await http(`/media/${original}`);
  const r10b = await http(`/media/${original.replace("originals/", "")}`);
  ok("U11 l'original n'est jamais servi publiquement", r10.status === 404 && r10b.status === 404, `${r10.status} ${r10b.status}`);
  const anyVariant = gpsFiles[0]?.key ?? "";
  const r11 = await http(`/media/${anyVariant.replace(/\d+\.(avif|webp)$/, "99999.$1")}`);
  ok("U11b clé de variante inventée → 404", r11.status === 404);

  // Course : 5 envois simultanés du même fichier → un seul média.
  const same = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#7a2e8e" } }).png().toBuffer();
  const five = await Promise.all(Array.from({ length: 5 }, () => upload(jar, "meme.png", "image/png", same)));
  const fiveIds = new Set(five.map((x) => x.json?.media?.id));
  const rows = query(dirA, "select count(*) n from media where original_name = 'meme.png'").n;
  ok("U12 5 envois simultanés du même fichier : 5 réponses OK, un seul média", five.every((x) => x.status === 200) && fiveIds.size === 1 && rows === 1, `${five.map((x) => x.status).join(",")} ids=${[...fiveIds].join(",")} lignes=${rows}`);

  up = await upload(jar, "tres-haute.png", "image/png", await pngOf(100, 20000, 8, 0));
  // ---- Passe 4b3 ---------------------------------------------------------------
  up = await upload(jar, "geante.png", "image/png", await pngOf(12000, 12000, 8, 0));
  ok("T1 144 mégapixels (côtés sous 16 384) → 422 « mégapixels »", up.status === 422 && /mégapixels/.test(up.json?.message ?? "") && !/px au plus/.test(up.json?.message ?? ""), `${up.status} ${up.text.slice(0, 120)}`);

  const twin = await sharp({ create: { width: 320, height: 200, channels: 3, background: "#123c69" } }).png().toBuffer();
  const [ta, tb] = await Promise.all([upload(jar, "nom-a.png", "image/png", twin), upload(jar, "nom-b.png", "image/png", twin)]);
  const twinRows = query(dirA, "select count(*) n, min(key) k from media where sha256 = (select sha256 from media where id = ?)", ta.json?.media?.id);
  const originals = readdirSync(path.join(dirA, "media", "originals")).filter((f) => f.startsWith(twinRows.k?.slice(10, 26) ?? "x"));
  ok(
    "T2 même contenu sous deux noms, en même temps : une ligne, un original sans nom de fichier",
    ta.status === 200 && tb.status === 200 && ta.json.media.id === tb.json.media.id && twinRows.n === 1 && /^originals\/[0-9a-f]{64}\.png$/.test(twinRows.k) && originals.length === 1,
    `${ta.status}/${tb.status} ids=${ta.json?.media?.id},${tb.json?.media?.id} lignes=${twinRows.n} clé=${twinRows.k} fichiers=${originals.length}`,
  );

  const jpegFull = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#aa5533" } }).jpeg().toBuffer();
  const truncated = jpegFull.subarray(0, Math.floor(jpegFull.length / 2));
  up = await upload(jar, "tronquee.jpg", "image/jpeg", truncated);
  const truncId = up.json?.media?.id;
  const truncRow = truncId ? await waitMedia(dirA, truncId) : null;
  await sleep(500);
  const truncJob = query(dirA, "select status, attempts from jobs where media_id = ?", truncId);
  ok("T8 image tronquée → échec au premier essai, sans nouvel essai", truncRow?.status === "failed" && truncJob?.status === "failed" && truncJob?.attempts === 1, JSON.stringify({ truncRow: truncRow?.status, truncJob }));
  up = await upload(jar, "autre-nom.jpg", "image/jpeg", truncated);
  const again = up.json?.media?.id;
  const relaunched = query(dirA, "select status, attempts from jobs where media_id = ?", truncId);
  ok(
    "T3a renvoi d'un contenu en échec (autre nom) → même ligne, traitement relancé",
    up.status === 200 && again === truncId && query(dirA, "select count(*) n from media where sha256 = (select sha256 from media where id = ?)", truncId).n === 1 && relaunched && relaunched.attempts <= 1,
    `${up.status} ${again}/${truncId} ${JSON.stringify(relaunched)}`,
  );
  await waitMedia(dirA, truncId);
  const keep = await sharp({ create: { width: 240, height: 160, channels: 3, background: "#3c6912" } }).png().toBuffer();
  up = await upload(jar, "garde.png", "image/png", keep);
  const keepId = up.json?.media?.id;
  const keepRow = await waitMedia(dirA, keepId);
  const keepKey = JSON.parse(keepRow.variants).files[0].key;
  const del = await callActionJson(jar, ids.deleteMediaAction, [keepId], "/admin/medias");
  const goneAfter = (await http(`/media/${keepKey}`)).status;
  up = await upload(jar, "garde-encore.png", "image/png", keep);
  const back = await waitMedia(dirA, up.json?.media?.id);
  const servedAgain = (await http(`/media/${JSON.parse(back.variants).files[0].key}`)).status;
  ok("T3b suppression : fichiers effacés, le même contenu renvoyé ensuite est de nouveau servi", del.text.includes('"ok":true') && goneAfter === 404 && back.status === "ready" && servedAgain === 200, `${goneAfter} ${back.status} ${servedAgain}`);

  const r4 = await rawPost("/admin/api/upload", { cookie: jar.header(), origin: BASE, "content-type": "multipart/form-data; boundary=x", "content-length": String(500 * 1024 * 1024) }, Buffer.from("--x\r\n"));
  ok(`T4 Content-Length de 500 Mo annoncé → 413 sans lire le corps (${r4.ms} ms)`, r4.status === 413 && r4.ms < 3000, `${r4.status} ${r4.text.slice(0, 80)}`);

  const two = multipartParts([
    { name: "file", filename: "a.png", type: "image/png", data: png },
    { name: "file", filename: "b.png", type: "image/png", data: png },
  ]);
  const t5a = await http("/admin/api/upload", { jar, method: "POST", raw: two.body, headers: { "content-type": two.type, origin: BASE } });
  const empty = multipartParts([{ name: "file", filename: "vide.png", type: "image/png", data: Buffer.alloc(0) }]);
  const t5b = await http("/admin/api/upload", { jar, method: "POST", raw: empty.body, headers: { "content-type": empty.type, origin: BASE } });
  const nofile = multipartParts([{ name: "note", data: Buffer.from("rien") }]);
  const t5c = await http("/admin/api/upload", { jar, method: "POST", raw: nofile.body, headers: { "content-type": nofile.type, origin: BASE } });
  const t5d = await http("/admin/api/upload", { jar, method: "POST", raw: png, headers: { "content-type": "image/png", origin: BASE } });
  ok("T5 deux fichiers, fichier vide, aucune partie fichier, corps non multipart → 400", [t5a, t5b, t5c, t5d].every((x) => x.status === 400), [t5a, t5b, t5c, t5d].map((x) => x.status).join(","));

  const anim = await sharp(Buffer.concat([Buffer.alloc(16 * 16 * 3, 0).map((_, i) => (i % 3 === 0 ? 255 : 0)), Buffer.alloc(16 * 16 * 3, 0).map((_, i) => (i % 3 === 2 ? 255 : 0))]), { raw: { width: 16, height: 32, channels: 3, pageHeight: 16 } })
    .gif()
    .toBuffer();
  up = await upload(jar, "anime.gif", "image/gif", anim);
  const animRow = await waitMedia(dirA, up.json?.media?.id);
  const animFile = animRow?.variants ? JSON.parse(animRow.variants).files.find((f) => f.format === "webp") : null;
  let animOk = false;
  if (animFile) {
    const img = Buffer.from(await (await http(`/media/${animFile.key}`)).arrayBuffer());
    const { data: px, info } = await sharp(img).raw().toBuffer({ resolveWithObject: true });
    animOk = info.width === 16 && info.height === 16 && px[0] > 200 && px[2] < 60;
  }
  ok("T9 GIF animé → première image seulement (16 × 16, rouge)", animOk, JSON.stringify(animFile));

  const projA = query(dirA, "select id from projects order by id limit 1").id;
  const projB = query(dirA, "select id from projects order by id limit 1 offset 1").id;
  const slotsA = JSON.parse(query(dirA, "select json_group_array(id) ids from (select id from slots where project_id = ? order by position)", projA).ids);
  const foreign = query(dirA, "select id from slots where project_id = ? limit 1", projB).id;
  const t11a = await callActionJson(jar, ids.reorderSlotsAction, [projA, [...slotsA.slice(0, -1), foreign]], `/admin/projets/${projA}`);
  const r11b = await callActionJson(jar, ids.addSlotsAction, [projA, [999999]], `/admin/projets/${projA}`);
  const r11c = await callActionJson(jar, ids.saveSlotAction, [slotsA[0], { title: { fr: "x", en: "x" }, description: { fr: "", en: "" }, collection: "characters", year: 2024, featured: false, intrus: 1 }], `/admin/projets/${projA}`);
  ok(
    "T11 emplacement d'un autre projet dans l'ordre, média inexistant, clé inconnue → refusés",
    t11a.text.includes('"ok":false') && r11b.text.includes('"ok":false') && r11c.text.includes('"ok":false'),
    `${t11a.text.slice(0, 60)} | ${r11b.text.slice(0, 60)} | ${r11c.text.slice(0, 60)}`,
  );

  up = await upload(jar, "tres-haute.png", "image/png", await pngOf(100, 40000, 8, 0));
  ok("U13 côté de plus de 32 768 px → refusé dès l'en-tête", up.status === 422 && /32\u202f?768|32 768|32768/.test(up.json?.message ?? ""), `${up.status} ${up.text.slice(0, 140)}`);
}
await postForm(jar, "/admin/apercu", { id: "pro" }); // pour vérifier la fin d'aperçu à la déconnexion
// Cookies de l'app posés pendant la séance (vue brouillon, écran de retour de l'aperçu) : la déconnexion doit tous les effacer (N19).
jar.cookies.set("page-draft", "1");
jar.cookies.set("preview-from", "/admin/themes");
const hintBefore = jar.cookies.has("portfolio-admin");

// Déconnexion par la server action : fin de session ET d'aperçu
const sessionCookies = jar.copy();
r = await callAction(jar, ids.signOutAction, {}, BASE, "/admin");
ok(
  "A9 déconnexion → /admin/connexion, draft mode et cookie d'aperçu effacés",
  r.status === 303 && r.headers.get("location")?.endsWith("/admin/connexion") && !jar.cookies.has("__prerender_bypass") && !jar.cookies.has("theme-preview"),
  `${r.status} ${r.headers.get("location")}`,
);
ok(
  "A9c déconnexion : portfolio-admin, page-draft et preview-from effacés aussi",
  hintBefore && !jar.cookies.has("portfolio-admin") && !jar.cookies.has("page-draft") && !jar.cookies.has("preview-from"),
  [...jar.cookies.keys()].join(","),
);
r = await http("/admin", { jar: sessionCookies });
ok("A9b ancien cookie révoqué : /admin redirige de nouveau", r.status === 307, String(r.status));

// Limitation par IP (I2), AUTH_TRUSTED_PROXY_HOPS=1 par défaut : le proxy AJOUTE
// l'IP réelle à droite de X-Forwarded-For ; la partie gauche est inventée.
let codes = [];
for (let i = 0; i < 7; i++) codes.push((await signIn(new Jar(), "inconnu@example.test", "faux", `10.9.${i}.1, 198.51.100.7`)).status);
ok("A10 rotation de la partie gauche de XFF : même IP réelle → 429", codes.slice(0, 5).every((c) => c === 401) && codes.at(-1) === 429, codes.join(","));
r = await signIn(new Jar(), "autre@example.test", "faux", "10.9.9.9, 198.51.100.8");
ok("A10b seau non partagé : un autre client n'est pas bloqué", r.status === 401, String(r.status));
r = await signIn(new Jar(), ADMIN.email, ADMIN.password, "198.51.100.9");
ok("A10c l'admin légitime (autre IP) se connecte pendant l'attaque", r.status === 200, String(r.status));

// Formulaire de contact (v0.13) : route publique POST /api/contact. Même calcul
// d'IP que l'auth (N proxys de confiance) : faire tourner la partie gauche de
// X-Forwarded-For ne contourne pas la limite. Formulaire posé en base sur l'accueil.
{
  const L = (s) => ({ fr: s, en: s });
  const field = (id, type, required) => ({ id, type, label: L(id), required });
  const form = { form: true, formId: "ftestauth01", title: L("T"), fields: [field("fname", "text", false), field("femail", "email", true), field("fmessage", "textarea", true)], submit: L("Envoyer"), success: L("Merci"), error: L("Erreur"), subject: L("Sujet") };
  const home = query(dirA, `select id from pages where json_extract(slug,'$.fr')=''`).id;
  writeDb(dirA, "insert into blocks (page_id, position, type, props) values (?, 99, 'contact', ?)", home, JSON.stringify(form));
  const values = { femail: "a@b.fr", fmessage: "bonjour" };
  // Jeton signé (GET /api/contact/token, no-store) et délai minimal avant l'envoi (docs/SECURITE.md §2.3) :
  // les jetons sont demandés d'avance, puis on attend une seule fois la fin du délai.
  const tokenRes = await http("/api/contact/token?form=ftestauth01");
  ok("C0 jeton du formulaire : 200 no-store", tokenRes.status === 200 && tokenRes.headers.get("cache-control") === "no-store", `${tokenRes.status} ${tokenRes.headers.get("cache-control")}`);
  const tokens = [(await tokenRes.json()).token];
  for (let i = 0; i < 12; i++) tokens.push((await (await http("/api/contact/token?form=ftestauth01")).json()).token);
  const fresh = (await (await http("/api/contact/token?form=ftestauth01")).json()).token;
  r = await http("/api/contact", { method: "POST", body: { form: "ftestauth01", locale: "fr", values, token: fresh }, headers: { "sec-fetch-site": "same-origin", "x-forwarded-for": "198.51.100.45" } });
  const early = await r.json().catch(() => ({}));
  ok("C6 envoi juste après l'affichage (jeton tout neuf) → 429 code early", r.status === 429 && early.code === "early", `${r.status} ${early.code}`);
  await sleep(3300);
  const post = (body, xff, headers = {}) => http("/api/contact", { method: "POST", body: body.token === null ? { ...body, token: undefined } : { token: tokens.shift(), ...body }, headers: { "sec-fetch-site": "same-origin", "x-forwarded-for": xff, ...headers } });
  r = await post({ form: "ftestauth01", locale: "fr", values, token: null }, "198.51.100.46");
  ok("C7 envoi sans jeton → 403", r.status === 403, String(r.status));
  const codesC = [];
  for (let i = 0; i < 7; i++) codesC.push((await post({ form: "ftestauth01", locale: "fr", values }, `10.8.${i}.1, 198.51.100.40`)).status);
  ok("C1 contact : partie gauche de XFF tournée, même client réel → 429 au 6e", codesC.slice(0, 5).every((c) => c === 200) && codesC[5] === 429, codesC.join(","));
  r = await post({ form: "ftestauth01", locale: "fr", values }, "10.8.9.9, 198.51.100.41");
  ok("C1b un autre client n'est pas bloqué", r.status === 200, String(r.status));
  r = await post({ form: "ftestauth01", locale: "fr", values, token: fresh }, "198.51.100.47");
  const reuse = await post({ form: "ftestauth01", locale: "fr", values, token: fresh }, "198.51.100.48");
  ok("C8 jeton refusé trop tôt puis valable une seule fois (200, puis 403)", r.status === 200 && reuse.status === 403, `${r.status} ${reuse.status}`);
  r = await post({ form: "ftestauth01", locale: "fr", values: { ...values, admin: "1" } }, "198.51.100.42");
  ok("C2 champ inconnu → 400", r.status === 400, String(r.status));
  r = await post({ form: "ftestauth01", locale: "fr", values }, "198.51.100.43", { "sec-fetch-site": "cross-site" });
  ok("C3 envoi depuis un autre site → 403", r.status === 403, String(r.status));
  r = await http("/api/contact", { method: "POST", raw: "x".repeat(40 * 1024), headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", "x-forwarded-for": "198.51.100.44" } });
  ok("C4 corps > 32 Ko → 413", r.status === 413, String(r.status));
  r = await http("/admin/messages");
  ok("C5 /admin/messages sans session → /admin/connexion", r.status === 307 && r.headers.get("location")?.endsWith("/admin/connexion"), `${r.status} ${r.headers.get("location")}`);
  writeDb(dirA, "delete from blocks where page_id = ? and type = 'contact'  and position = 99", home);
  writeDb(dirA, "delete from messages");
}

// Délai progressif par couple (e-mail, IP) : 5 échecs mémorisés pour
// (admin, 198.51.100.30) — posés en base, la limite par IP (5/min) empêchant
// de les produire en moins d'une minute.
writeDb(dirA, "insert or replace into auth_throttle (email, failures, first_at, last_at) values (?, 5, ?, ?)", `${ADMIN.email}|198.51.100.30`, Date.now(), Date.now());
r = await signIn(new Jar(), ADMIN.email, ADMIN.password, "198.51.100.30");
const throttled = await r.json().catch(() => ({}));
ok("A11 5 échecs (e-mail, IP) → délai sur CETTE IP (429 ACCOUNT_THROTTLED)", r.status === 429 && throttled.code === "ACCOUNT_THROTTLED" && throttled.retryAfter <= 2, `${r.status} ${throttled.code} ${throttled.retryAfter}s`);
r = await signIn(new Jar(), ADMIN.email, ADMIN.password, "198.51.100.31");
ok("A11b le même compte depuis une autre IP n'est pas ralenti", r.status === 200, String(r.status));
await sleep(2200);
r = await signIn(new Jar(), ADMIN.email, ADMIN.password, "198.51.100.30");
ok("A11c après le délai, le bon mot de passe passe (compteur remis à zéro)", r.status === 200, String(r.status));

// I2b — scénario de l'auditeur : compteur de l'admin à 10 échecs sur l'IP de
// l'attaquant, qui martèle toutes les 100 ms un mauvais mot de passe pendant
// 75 s ; l'admin, depuis une autre IP, se connecte à un rythme humain.
const ATTACKER = "198.51.100.66";
const LEGIT = "198.51.100.77";
writeDb(dirA, "insert or replace into auth_throttle (email, failures, first_at, last_at) values (?, 10, ?, ?)", `${ADMIN.email}|${ATTACKER}`, Date.now(), Date.now());
const attack = { sent: 0, byCode: {} };
let attacking = true;
const attacker = (async () => {
  while (attacking) {
    const res = await signIn(new Jar(), ADMIN.email, "mauvais", ATTACKER);
    const code = res.status === 429 ? (await res.json().catch(() => ({}))).code : String(res.status);
    attack.sent++;
    attack.byCode[code] = (attack.byCode[code] ?? 0) + 1;
    await sleep(100);
  }
})();
const legit = [];
const started = Date.now();
while (Date.now() - started < 75_000) {
  legit.push((await signIn(new Jar(), ADMIN.email, ADMIN.password, LEGIT)).status);
  await sleep(12_500);
}
attacking = false;
await attacker;
const successRate = legit.filter((c) => c === 200).length / legit.length;
ok(
  "A12 I2b : l'admin (autre IP) réussit pendant l'attaque (≥ 95 %)",
  successRate >= 0.95,
  `admin ${legit.filter((c) => c === 200).length}/${legit.length} (${legit.join(",")}) · attaquant : ${attack.sent} requêtes ${JSON.stringify(attack.byCode)}`,
);
ok(
  "A12b l'attaquant est tenu par la limite par IP (ses 429 comptent)",
  (attack.byCode.IP_RATE_LIMITED ?? 0) > attack.sent * 0.9 && (attack.byCode["401"] ?? 0) <= 10,
  JSON.stringify(attack.byCode),
);

// docs/SECURITE.md §2.4, P4 : IPv6 par /64, frein de /change-password, délai par compte (toutes IP, borné), 12 caractères.
{
  // Compteurs en mémoire remis à zéro (redémarrage) : les échecs de l'attaque I2b ne comptent pas ici.
  await stop(s);
  s = startServer(dirA, baseEnv);
  ok("A13a redémarrage (compteurs en mémoire vides)", await s.ready);
  const v6 = [];
  for (let i = 1; i <= 6; i++) {
    const res = await signIn(new Jar(), ADMIN.email, "mauvais", `2001:db8:77:1::${i.toString(16)}`);
    v6.push(res.status === 429 ? (await res.json().catch(() => ({}))).code : String(res.status));
  }
  ok("A13 IPv6 : 6 adresses du même /64 → 429 au 6e essai (compté par /64)", v6.slice(0, 5).every((c) => c === "401") && v6[5] === "IP_RATE_LIMITED", v6.join(","));
  r = await signIn(new Jar(), ADMIN.email, ADMIN.password, "2001:db8:77:2::1");
  ok("A13b un autre /64 n'est pas bloqué", r.status === 200, String(r.status));

  const cpJar = new Jar();
  await signIn(cpJar, ADMIN.email, ADMIN.password, "203.0.113.10");
  const changePassword = (currentPassword, newPassword, xff) =>
    http("/api/auth/change-password", { jar: cpJar, method: "POST", body: { currentPassword, newPassword }, headers: { "x-forwarded-for": xff } });
  const cp = [];
  for (let i = 0; i < 6; i++) cp.push((await changePassword(`essai-${i}`, "nouveau-mot-de-passe-solide", "198.51.100.150")).status);
  ok("A14 /change-password avec un mauvais mot de passe actuel → 429 au 6e essai (même frein que la connexion)", cp.slice(0, 5).every((c) => c === 400) && cp[5] === 429, cp.join(","));
  ok("A14b échecs de /change-password comptés pour le compte (délai par couple en base)", query(dirA, "select failures n from auth_throttle where email = ?", `${ADMIN.email}|198.51.100.150`)?.n === 5);
  r = await changePassword(ADMIN.password, "court-11car", "203.0.113.10");
  const short = await r.json().catch(() => ({}));
  ok("A14c nouveau mot de passe de 11 caractères → refusé (12 au moins)", r.status === 400 && short.code === "PASSWORD_TOO_SHORT", `${r.status} ${short.code}`);

  // Botnet : un échec par IP, aucune limite par IP ni par couple ne joue ; le compte, lui, est freiné (borne 30 s).
  for (let i = 0; i < 12; i++) await signIn(new Jar(), ADMIN.email, "mauvais", `198.51.100.${160 + i}`);
  r = await signIn(new Jar(), ADMIN.email, ADMIN.password, "198.51.100.190");
  const acc = await r.json().catch(() => ({}));
  ok("A15 échecs depuis 12 IP différentes → une IP inconnue attend (429 ACCOUNT_THROTTLED, ≤ 30 s)", r.status === 429 && acc.code === "ACCOUNT_THROTTLED" && acc.retryAfter <= 30, `${r.status} ${acc.code} ${acc.retryAfter}`);
  r = await signIn(new Jar(), ADMIN.email, ADMIN.password, "203.0.113.10");
  ok("A15b pendant ce temps, l'IP habituelle de l'artiste se connecte (jamais enfermée dehors)", r.status === 200, String(r.status));

  // Compte existant au mot de passe court (créé avant la règle des 12 caractères) : la connexion marche toujours.
  const { hashPassword } = await import("better-auth/crypto");
  const userId = query(dirA, "select id from user where email = ?", ADMIN.email).id;
  const previous = query(dirA, "select password from account where user_id = ? and provider_id = 'credential'", userId).password;
  writeDb(dirA, "update account set password = ? where user_id = ? and provider_id = 'credential'", await hashPassword("court-8c"), userId);
  r = await signIn(new Jar(), ADMIN.email, "court-8c", "203.0.113.10");
  ok("A16 compte existant au mot de passe de 8 caractères : connexion toujours acceptée", r.status === 200, String(r.status));
  writeDb(dirA, "update account set password = ? where user_id = ? and provider_id = 'credential'", previous, userId);
}

await stop(s);

console.log("\n== B. amorçage idempotent");
s = startServer(dirA, baseEnv);
ok("B0 redémarrage", await s.ready);
ok("B1 aucun nouvel admin créé", !s.text().includes("premier administrateur créé") && userCount(dirA) === 1, `utilisateurs : ${userCount(dirA)}`);
ok("B2 avertissement ADMIN_PASSWORD ignoré, sans la valeur", s.text().includes("ADMIN_PASSWORD ignoré") && !s.text().includes(ADMIN.password));
await stop(s);

console.log("\n== C. AUTH_PASSWORD_DISABLED sans OIDC");
s = startServer(`${TMP}/c`, { ...baseEnv, AUTH_PASSWORD_DISABLED: "true" });
ok("C0 démarrage", await s.ready);
ok("C1 avertissement explicite", s.text().includes("AUTH_PASSWORD_DISABLED=true ignoré"));
r = await signIn(new Jar(), ADMIN.email, ADMIN.password, "203.0.113.20");
ok("C2 le mot de passe reste actif", r.status === 200, String(r.status));
await stop(s);

console.log("\n== D. OIDC de bout en bout (faux fournisseur)");
const mock = new OAuth2Server();
await mock.issuer.keys.generate("RS256");
await mock.start(MOCK_PORT, "127.0.0.1");
const issuer = `http://127.0.0.1:${MOCK_PORT}`;
let identity = { sub: "u1", email: "x@example.test", email_verified: true, groups: [] };
const claims = () => ({ sub: identity.sub, email: identity.email, email_verified: identity.email_verified, name: identity.email, groups: identity.groups });
mock.service.on("beforeTokenSigning", (token) => Object.assign(token.payload, claims()));
mock.service.on("beforeUserinfo", (userInfo) => {
  userInfo.body = claims();
});
const oidcEnv = {
  ...baseEnv,
  AUTH_PASSWORD_DISABLED: "true",
  AUTH_OIDC_ISSUER: issuer,
  AUTH_OIDC_CLIENT_ID: "portfolio",
  AUTH_OIDC_CLIENT_SECRET: "secret-du-client",
  ADMIN_EMAILS: "autorise@example.test,nouveau@example.test,kate@example.test",
  AUTH_ADMIN_GROUP: "admins-portfolio",
  AUTH_ADMIN_SUBS: "u-sub-autorise",
};
const dirD = `${TMP}/d`;
s = startServer(dirD, oidcEnv);
ok("D0 démarrage", await s.ready);
r = await http("/admin/connexion");
const oidcLogin = await r.text();
ok("D1 connexion : bouton Authentik, pas de formulaire mot de passe", oidcLogin.includes("Se connecter avec Authentik") && !oidcLogin.includes("Adresse e-mail"));
r = await signIn(new Jar(), ADMIN.email, ADMIN.password, "203.0.113.30");
ok("D2 endpoint mot de passe refusé", r.status >= 400 && r.status < 500, String(r.status));

let flowIp = 50;
async function oidcFlow(who) {
  identity = { email_verified: true, groups: [], ...who };
  const flowJar = new Jar();
  let res = await http("/api/auth/sign-in/social", {
    jar: flowJar,
    method: "POST",
    body: { provider: "authentik", callbackURL: "/admin", errorCallbackURL: "/admin/connexion" },
    headers: { "x-forwarded-for": `203.0.113.${flowIp++}` },
  });
  const { url } = await res.json();
  const authorize = new URL(url);
  res = await http(url); // le faux fournisseur approuve et renvoie vers le callback
  const callback = res.headers.get("location");
  res = await http(callback, { jar: flowJar });
  return { jar: flowJar, authorize, final: res.headers.get("location") ?? "", status: res.status };
}

const byEmail = await oidcFlow({ sub: "u-email", email: "autorise@example.test", email_verified: true });
ok("D3 URL de retour OIDC", byEmail.authorize.searchParams.get("redirect_uri") === `${BASE}/api/auth/callback/authentik`, byEmail.authorize.searchParams.get("redirect_uri") ?? "");
ok("D3b PKCE (S256) et nonce envoyés", byEmail.authorize.searchParams.get("code_challenge_method") === "S256" && Boolean(byEmail.authorize.searchParams.get("nonce")));
ok("D4 e-mail listé ET vérifié → session admin", byEmail.final.endsWith("/admin"), byEmail.final);

let before = userCount(dirD);
// Adresse listée, jamais vue : seule la règle « e-mail vérifié » peut refuser.
const unverified = await oidcFlow({ sub: "u-non-verifie", email: "NOUVEAU@example.test", email_verified: false });
ok("D5 e-mail listé mais NON vérifié → refusé, aucun compte", unverified.final.includes("error=admin_not_allowed") && userCount(dirD) === before, unverified.final.split("?")[1]?.slice(0, 40));

// Scénario de l'audit : sub inconnu, e-mail de l'admin en casse différente, non vérifié.
const takeover = await oidcFlow({ sub: "attacker-2", email: "ARTISTE@Example.TEST", email_verified: false });
ok(
  "D6 e-mail de l'admin, non vérifié, autre sub → refusé",
  !takeover.final.endsWith("/admin") && /error=(admin_not_allowed|account_not_linked)/.test(takeover.final),
  takeover.final.split("?")[1]?.slice(0, 40),
);
const takeoverGroup = await oidcFlow({ sub: "attacker-3", email: "ARTISTE@Example.TEST", email_verified: true, groups: ["admins-portfolio"] });
const adminUser = query(dirD, "select id from user where email = ?", ADMIN.email);
const linked = query(dirD, "select count(*) n from account where user_id = ? and provider_id = 'authentik'", adminUser.id).n;
ok(
  "D6b e-mail de l'admin sur un autre sub (même autorisé) → aucune liaison au compte mot de passe",
  !takeoverGroup.final.endsWith("/admin") && linked === 0,
  `${takeoverGroup.final.split("?")[1]?.slice(0, 30)} · comptes Authentik liés à l'admin : ${linked}`,
);
r = await http(takeoverGroup.final.replace(BASE, ""));
const takeoverHtml = (await r.text()).replace(/<script\b[\s\S]*?<\/script>/g, "");
ok(
  "D6c même message que admin_not_allowed (aucune énumération du compte admin)",
  /Ce compte Authentik n(&#x27;|')est pas autorisé à administrer le site/.test(takeoverHtml) && !takeoverHtml.includes("mot de passe :"),
);

// N15 (docs/SECURITE.md) : « \u212Aate@… » (signe Kelvin U+212A, pas un K) devient « kate@… » après toLowerCase().
// Une identité distincte, e-mail « vérifié » par le fournisseur, ne doit pas passer pour l'adresse listée.
before = userCount(dirD);
const kelvin = await oidcFlow({ sub: "u-kelvin", email: "\u212Aate@example.test", email_verified: true });
ok("D6d e-mail non ASCII (« K » Kelvin pour « kate@ » listée), vérifié → refusé, aucun compte", kelvin.final.includes("error=admin_not_allowed") && userCount(dirD) === before, kelvin.final.split("?")[1]?.slice(0, 40));
const homoglyph = await oidcFlow({ sub: "u-cyrillique", email: "\u0430utorise@example.test", email_verified: true });
ok("D6e e-mail avec un homoglyphe cyrillique (« а ») → refusé", homoglyph.final.includes("error=admin_not_allowed") && userCount(dirD) === before, homoglyph.final.split("?")[1]?.slice(0, 40));
const kate = await oidcFlow({ sub: "u-kate", email: "Kate@Example.test", email_verified: true });
ok("D6f la vraie adresse listée (ASCII, casse différente) → session admin", kate.final.endsWith("/admin"), kate.final);

const byGroup = await oidcFlow({ sub: "u-groupe", email: "membre@example.test", email_verified: false, groups: ["admins-portfolio"] });
ok("D7 groupe autorisé → session admin", byGroup.final.endsWith("/admin"), byGroup.final);
const bySub = await oidcFlow({ sub: "u-sub-autorise", email: "sub@example.test", email_verified: false });
ok("D8 sub autorisé → session admin", bySub.final.endsWith("/admin"), bySub.final);
before = userCount(dirD);
const denied = await oidcFlow({ sub: "u-intrus", email: "intrus@example.test", groups: ["autre-groupe"] });
ok("D9 rien d'autorisé → refus explicite, aucun compte", denied.final.includes("error=admin_not_allowed") && userCount(dirD) === before);

// M6 : retiré du groupe DANS Authentik → la reconnexion refusée coupe aussi
// les sessions en cours de ce sub.
const g1 = await oidcFlow({ sub: "g1", email: "g1@example.test", email_verified: false, groups: ["admins-portfolio"] });
r = await http("/admin", { jar: g1.jar });
ok("D9b g1 connecté par le groupe", g1.final.endsWith("/admin") && r.status === 200, String(r.status));
const g1Again = await oidcFlow({ sub: "g1", email: "g1@example.test", email_verified: false, groups: [] });
r = await http("/admin", { jar: g1.jar });
ok("D9c reconnexion sans le groupe refusée → l'ancienne session renvoie 307", g1Again.final.includes("error=admin_not_allowed") && r.status === 307, `${r.status}`);
ok("D9d identité oubliée", !query(dirD, "select 1 as x from oidc_identity where sub = 'g1'"));

// Mot de passe désactivé : endpoints de (re)définition fermés (M2)
r = await http("/api/auth/change-password", { jar: byGroup.jar, method: "POST", body: { currentPassword: "x", newPassword: "nouveau-mot-de-passe" } });
const cp = await r.json().catch(() => ({}));
ok("D10 /change-password fermé quand le mot de passe est désactivé", r.status === 403 && cp.code === "PASSWORD_DISABLED", `${r.status} ${cp.code}`);
r = await http("/api/auth/set-password", { jar: byGroup.jar, method: "POST", body: { newPassword: "nouveau-mot-de-passe" } });
ok("D10b /set-password fermé (403) ou inexistant (404)", r.status === 403 || r.status === 404, String(r.status));

// Sessions : l'accès est revérifié à chaque requête (I3)
for (const [label, flow] of [["groupe", byGroup], ["e-mail", byEmail], ["sub", bySub], ["e-mail ASCII (N15)", kate]]) {
  r = await http("/admin", { jar: flow.jar });
  ok(`D11 session ${label} valide avant le retrait`, r.status === 200, String(r.status));
}
await stop(s);
s = startServer(dirD, { ...oidcEnv, AUTH_ADMIN_GROUP: "autre-groupe", ADMIN_EMAILS: "quelquun@example.test", AUTH_ADMIN_SUBS: "" });
await s.ready;
for (const [label, flow] of [["groupe", byGroup], ["e-mail", byEmail], ["sub", bySub], ["e-mail ASCII (N15)", kate]]) {
  r = await http("/admin", { jar: flow.jar });
  ok(`D12 accès ${label} retiré + redémarrage → ancienne session refusée`, r.status === 307, String(r.status));
}
ok("D12b sessions révoquées en base", query(dirD, "select count(*) n from session").n === 0, `sessions restantes : ${query(dirD, "select count(*) n from session").n}`);
const revoked = await oidcFlow({ sub: "u-groupe", email: "membre@example.test", groups: ["admins-portfolio"] });
ok("D13 et nouvelle connexion refusée", revoked.final.includes("error=admin_not_allowed"), revoked.final.split("?")[1]?.slice(0, 40));
await stop(s);
await mock.stop();

console.log("\n== E. secret en production");
s = startServer(`${TMP}/e1`, { ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password });
ok("E1 sans BETTER_AUTH_SECRET → arrêt (code 1)", (await s.exited) === 1 && s.text().includes("BETTER_AUTH_SECRET est absent"), s.text().match(/\[auth\] ÉCHEC[^\n]*/)?.[0]?.slice(0, 80) ?? "");
s = startServer(`${TMP}/e2`, { BETTER_AUTH_SECRET: "trop-court" });
ok("E2 secret trop court → arrêt (code 1)", (await s.exited) === 1 && s.text().includes("trop court"));
// docs/SECURITE.md §2.5 : les facilités du développement ne dépendent plus de NODE_ENV seul, mais de PORTFOLIO_DEV=1 (hors production).
s = startServer(`${TMP}/e3`, { NODE_ENV: "development", ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password });
ok("E3 NODE_ENV ≠ production SANS PORTFOLIO_DEV, sans secret → arrêt (aucun secret de dev)", (await s.exited) === 1 && s.text().includes("BETTER_AUTH_SECRET est absent"), s.text().match(/\[auth\][^\n]*/)?.[0]?.slice(0, 100) ?? "");
s = startServer(`${TMP}/e4`, { PORTFOLIO_DEV: "1", ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password });
ok("E4 PORTFOLIO_DEV=1 mais NODE_ENV=production, sans secret → arrêt (le drapeau seul ne suffit pas)", (await s.exited) === 1 && s.text().includes("BETTER_AUTH_SECRET est absent"));
s = startServer(`${TMP}/e5`, { ...baseEnv, NODE_ENV: "development" });
if (await s.ready) {
  r = await http("/api/theme-preview?id=pro&redirect=/fr");
  ok("E5 NODE_ENV ≠ production sans PORTFOLIO_DEV : aperçu de thème fermé aux anonymes (404)", r.status === 404, String(r.status));
  r = await http("/admin/connexion");
  ok("E5b … et CSP de l'admin sans unsafe-eval ni ws:", !/unsafe-eval|ws:/.test(r.headers.get("content-security-policy") ?? ""), r.headers.get("content-security-policy")?.slice(0, 80));
} else ok("E5 serveur NODE_ENV=development démarré", false, s.text().slice(-300));
await stop(s);

console.log("\n== F. mémoire du traitement d'images (VmHWM du serveur, un serveur neuf par image)");
const baseEnvF = { ...baseEnv, AUTH_TRUSTED_PROXY_HOPS: "1" };
let ipSeq = 20;
async function freshAdmin(dir, env = {}) {
  const server = startServer(dir, { ...baseEnvF, ...env });
  if (!(await server.ready)) return { server, jar: null };
  const j = new Jar();
  await signIn(j, ADMIN.email, ADMIN.password, `198.51.100.${ipSeq++}`);
  return { server, jar: j };
}
const bigJpeg = await sharp({ create: { width: 6000, height: 4000, channels: 3, background: "#c0503a" } })
  .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="6000" height="4000"><rect x="300" y="300" width="2000" height="1200" fill="#f2d16b"/></svg>') }])
  .jpeg({ quality: 88 })
  .toBuffer();
// [libellé, nom, type, contenu, attendu ("ready" ou motif du message de refus), env]
const cases = [
  ["JPEG 6000 × 4000", "grand.jpg", "image/jpeg", bigJpeg, "ready", {}],
  ["PNG 2400 × 16 000", "haute.png", "image/png", await pngOf(2400, 16000, 8, 2), "ready", {}],
  ["PNG 16 384 × 16 384 (268 Mpx, côtés acceptés)", "carre.png", "image/png", await pngOf(16384, 16384, 8, 0), /mégapixels/, {}],
  ["PNG 16 bits 6300 × 6300 (39,7 Mpx)", "seize-40.png", "image/png", await pngOf(6300, 6300, 16, 2), "ready", {}],
  ["PNG 16 bits 10 000 × 9 900 (99 Mpx)", "seize-99.png", "image/png", await pngOf(10000, 9900, 16, 2), "ready", {}],
  ["PNG 16 bits 10 000 × 9 900, plafond 16 bits abaissé à 40 Mpx (MAX_MEGAPIXELS_16BIT)", "seize-99b.png", "image/png", await pngOf(10000, 9900, 16, 2), /16 bits/, { MAX_MEGAPIXELS_16BIT: "40" }],
  ["PNG 9000 × 6000 avec orientation EXIF 6", "tourne.png", "image/png", await pngOf(9000, 6000, 8, 2, 6), "ready", {}],
];
for (const [label, name, mime, data, expected, env] of cases) {
  const dir = `${TMP}/f-${name}`;
  const { server, jar: j } = await freshAdmin(dir, env);
  if (!j) {
    ok(`F ${label} : démarrage`, false);
    continue;
  }
  await http("/fr");
  await sleep(500);
  const before = procMem(server.child.pid);
  const t0 = Date.now();
  const res = await upload(j, name, mime, data);
  const id = res.json?.media?.id;
  const row = id ? await waitMedia(dir, id, 120000) : null;
  const after = procMem(server.child.pid);
  const outcome = res.status !== 200 ? `refusée à l'envoi (${res.status})` : row?.status === "ready" ? `traitée en ${((Date.now() - t0) / 1000).toFixed(1)} s` : `état ${row?.status}`;
  console.log(`      ${label} (${Math.round(data.length / 1024)} Ko envoyés) : ${outcome} — VmHWM ${before.hwm} → ${after.hwm} Mo (+${after.hwm - before.hwm})`);
  let shape = true;
  if (name === "tourne.png" && row?.variants) {
    const top = JSON.parse(row.variants).files.find((f) => f.format === "webp" && f.w + f.h > 0 && Math.max(f.w, f.h) === 2400);
    shape = Boolean(top && top.h > top.w); // 9000 × 6000 tourné d'un quart : portrait
  }
  const asExpected = expected === "ready" ? res.status === 200 && row?.status === "ready" : res.status === 422 && expected.test(res.json?.message ?? "");
  // Seuil 560 Mo : le pic d’un PNG 16 bits varie de 453 à 523 Mo d’un run à l’autre (mesures de la batterie v0.18, code d’image
  // inchangé), donc 500 Mo échouait au hasard sans régression.
  const limitMb = expected === "ready" ? 560 : after.hwm; // refus : seul l'absence de décodage compte (+20 Mo au plus)
  ok(
    `F ${label} : ${expected === "ready" ? "traitée" : "refusée"}, pic du serveur ${after.hwm} Mo (+${after.hwm - before.hwm})${name === "tourne.png" ? ", orientation appliquée" : ""}`,
    asExpected && shape && after.hwm <= limitMb && (expected === "ready" || after.hwm - before.hwm <= 20),
    `${res.status} ${row?.status} ${res.text.slice(0, 100)}`,
  );
  await stop(server);
}

console.log("\n== G. traitement interrompu (kill -9) et envoi qui s'arrête");
const dirG = `${TMP}/g`;
let g = await freshAdmin(dirG, { UPLOAD_IDLE_TIMEOUT_S: "2" });
const jarG = g.jar;
const killed = await upload(jarG, "interrompue.jpg", "image/jpeg", bigJpeg);
const killedId = killed.json?.media?.id;
for (let k = 1; k <= 4; k++) {
  // Attente d'un traitement en cours (ou constat qu'il n'y en a plus), puis kill -9.
  const end = Date.now() + 15000;
  while (Date.now() < end && query(dirG, "select status from jobs where media_id = ?", killedId)?.status !== "running") await sleep(40);
  g.server.child.kill("SIGKILL");
  await g.server.exited;
  g = { server: startServer(dirG, { ...baseEnvF, UPLOAD_IDLE_TIMEOUT_S: "2" }) };
  await g.server.ready;
  await sleep(1500);
}
const job = query(dirG, "select status, attempts, error from jobs where media_id = ?", killedId);
const med = query(dirG, "select status, error from media where id = ?", killedId);
ok(
  `G1 4 × kill -9 pendant le traitement : job et média en échec dès le 2e arrêt d'une image (lot 17b), message clair (essais : ${job?.attempts})`,
  job?.status === "failed" && job?.attempts === 2 && med?.status === "failed" && /s'est arrêté pendant le traitement de cette image.*Réduis-la/.test(med?.error ?? ""),
  JSON.stringify({ job, med }),
);
const delG = await callActionJson(jarG, ids.deleteMediaAction, [killedId], "/admin/medias");
ok("G2 un média en échec reste supprimable (corbeille)", delG.text.includes('"ok":true') && Boolean(query(dirG, "select deleted_at d from media where id = ?", killedId)?.d), delG.text.slice(0, 160));
// Le préchauffage des recadrages (crop-warm, lot 17d) se remet en file au démarrage pour chaque page publiée : ce n'est pas un traitement de média.
const stuckG = { jobs: query(dirG, "select count(*) n from jobs where kind != 'crop-warm' and status in ('queued','running')").n, media: query(dirG, "select count(*) n from media where status = 'processing'").n };
ok("G3 aucun job ni média resté en cours", stuckG.jobs === 0 && stuckG.media === 0, JSON.stringify(stuckG));

// T6 : purge des fichiers abandonnés (au démarrage, puis toutes les 15 min).
mkdirSync(path.join(dirG, "tmp"), { recursive: true });
const oldTmp = path.join(dirG, "tmp", "upload-vieux");
const newTmp = path.join(dirG, "tmp", "upload-recent");
const oldStore = path.join(dirG, "media", "img", "abandon.webp.123.456.tmp");
mkdirSync(path.dirname(oldStore), { recursive: true });
for (const f of [oldTmp, newTmp, oldStore]) writeFileSync(f, "x");
const twoHoursAgo = new Date(Date.now() - 2 * 3600_000);
utimesSync(oldTmp, twoHoursAgo, twoHoursAgo);
utimesSync(oldStore, twoHoursAgo, twoHoursAgo);
await stop(g.server);
g = { server: startServer(dirG, { ...baseEnvF, UPLOAD_IDLE_TIMEOUT_S: "2" }) };
await g.server.ready;
await sleep(800);
ok("T6 purge : vieux fichiers d'envoi et *.tmp du stockage supprimés, fichier récent gardé", !existsSync(oldTmp) && !existsSync(oldStore) && existsSync(newTmp));
rmSync(newTmp, { force: true });

// Envoi qui s'arrête en cours de route : abandon et nettoyage.
const stall = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode(`--coupe\r\nContent-Disposition: form-data; name="file"; filename="lent.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`));
    controller.enqueue(new Uint8Array(64 * 1024).fill(0xff));
    // … puis plus rien.
  },
});
const t1 = Date.now();
let stallStatus = 0;
try {
  const res = await fetch(`${BASE}/admin/api/upload`, { method: "POST", body: stall, duplex: "half", headers: { cookie: jarG.header(), origin: BASE, "content-type": "multipart/form-data; boundary=coupe" }, signal: AbortSignal.timeout(15000) });
  stallStatus = res.status;
} catch {
  stallStatus = -1;
}
const waited = (Date.now() - t1) / 1000;
await sleep(500);
const tmpG = existsSync(path.join(dirG, "tmp")) ? readdirSync(path.join(dirG, "tmp")).length : 0;
ok(`G4 envoi muet pendant 2 s (UPLOAD_IDLE_TIMEOUT_S) : abandon en ${waited.toFixed(1)} s, fichier temporaire supprimé`, stallStatus === 408 && waited < 6 && tmpG === 0, `${stallStatus} tmp=${tmpG}`);
await stop(g.server);

console.log("\n== H. quota de stockage (MEDIA_MAX_TOTAL_GB)");
const dirH = `${TMP}/h`;
const h = await freshAdmin(dirH, { MEDIA_MAX_TOTAL_GB: "0.00001" });
const full = await upload(h.jar, "encore.png", "image/png", await sharp({ create: { width: 64, height: 48, channels: 3, background: "#2e4e9e" } }).png().toBuffer());
ok("H1 quota atteint → refus explicite (507)", full.status === 507 && /espace de stockage est plein/.test(full.json?.message ?? ""), `${full.status} ${full.text.slice(0, 120)}`);
const lib = await (await http("/admin/medias", { jar: h.jar })).text();
await stop(h.server);
// T7 : quota encore libre, mais dépassé par l'envoi lui-même (contrôle après lecture).
const used = query(dirH, "select sum(size) n from media").n;
const h2 = { server: startServer(dirH, { ...baseEnvF, MEDIA_MAX_TOTAL_GB: String((used + 20 * 1024) / 1024 ** 3) }) };
await h2.server.ready;
const bigger = await sharp({ create: { width: 900, height: 900, channels: 3, background: "#000000" } }).composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><circle cx="450" cy="450" r="400" fill="#d0a020"/></svg>') }]).png({ compressionLevel: 0 }).toBuffer();
const rowsBefore = query(dirH, "select count(*) n from media").n;
const t7 = await upload(h.jar, "trop.png", "image/png", bigger);
const originalsH = existsSync(path.join(dirH, "media", "originals")) ? readdirSync(path.join(dirH, "media", "originals")).length : 0;
ok(
  `T7 quota dépassé par l'envoi lui-même (${Math.round(bigger.length / 1024)} Ko) → 507 après lecture, sans original ni ligne`,
  t7.status === 507 && /espace de stockage est plein/.test(t7.json?.message ?? "") && query(dirH, "select count(*) n from media").n === rowsBefore && originalsH === 0,
  `${t7.status} originaux=${originalsH}`,
);
h.server = h2.server;
ok("H2 occupation affichée dans la médiathèque", /Espace utilisé/.test(lib) && /sur/.test(lib));
await stop(h.server);


console.log("\n== V. vidéo : envoi par morceaux, conversion, limites");
/* Sources légitimes générées par ffmpeg (testsrc2, sine) : aucun fichier piégé. */
const VID = `${TMP}/sources`;
mkdirSync(VID, { recursive: true });
function ff(args) {
  const r = spawnSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg : ${r.stderr}`);
}
function probe(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", file], { encoding: "utf8" });
  return JSON.parse(r.stdout);
}
const src = (n) => path.join(VID, n);
ff(["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "6", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-metadata", "title=Titre privé", "-metadata", "location=+48.8566+002.3522/", "-metadata", "creation_time=2024-01-01T00:00:00Z", src("base.mp4")]);
ff(["-display_rotation", "90", "-i", src("base.mp4"), "-c", "copy", src("tourne.mp4")]);
ff(["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25", "-t", "6", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "45", "-pix_fmt", "yuv420p", src("petite.mp4")]);
ff(["-f", "lavfi", "-i", "sine=frequency=440", "-t", "3", src("son.wav")]);
ff(["-f", "lavfi", "-i", "sine=frequency=440", "-t", "3", "-c:a", "aac", "-f", "mp4", src("son-seul.mp4")]);
ff(["-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30", "-t", "4", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", src("boucle-720.mp4")]);
ff(["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25", "-t", "4", "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "300k", src("clip.webm")]);

/** Envoi par morceaux complet (init → morceaux → complete). */
async function chunked(j, file, name, type = "video/mp4", { chunk = 1024 * 1024, origin = BASE } = {}) {
  const data = readFileSync(file);
  const head = { cookie: j.header(), origin };
  const init = await fetch(`${BASE}/admin/api/upload/init`, { method: "POST", headers: { ...head, "content-type": "application/json" }, body: JSON.stringify({ name, size: data.length, type }) });
  const ib = await init.json().catch(() => ({}));
  if (init.status !== 200) return { stage: "init", status: init.status, body: ib };
  const id = ib.upload.id;
  for (let offset = 0; offset < data.length; ) {
    const part = data.subarray(offset, offset + chunk);
    const r = await fetch(`${BASE}/admin/api/upload/${id}/chunk?offset=${offset}`, { method: "PUT", headers: { ...head, "content-length": String(part.length) }, body: part });
    const b = await r.json().catch(() => ({}));
    if (r.status !== 200) return { stage: "chunk", status: r.status, body: b, id };
    offset = b.upload.offset;
  }
  const done = await fetch(`${BASE}/admin/api/upload/${id}/complete`, { method: "POST", headers: head });
  return { stage: "complete", status: done.status, body: await done.json().catch(() => ({})), id };
}
const statSize = (f) => statSync(f).size;
const initP2 = (j, size) =>
  fetch(`${BASE}/admin/api/upload/init`, { method: "POST", headers: { cookie: j.header(), origin: BASE, "content-type": "application/json" }, body: JSON.stringify({ name: "r.mp4", size, type: "video/mp4" }) });
const serverLog = (srv, re) => [...srv.text().matchAll(re)].map((m) => m[0]);

// ---- V1 : serveur par défaut --------------------------------------------------------
const dirV = `${TMP}/v1`;
let v = await freshAdmin(dirV);
const jarV = v.jar;
const sample = readFileSync(src("base.mp4"));
// Garde des 5 routes : sans session et depuis une autre origine.
const okInit = await fetch(`${BASE}/admin/api/upload/init`, { method: "POST", headers: { cookie: jarV.header(), origin: BASE, "content-type": "application/json" }, body: JSON.stringify({ name: "garde.mp4", size: sample.length, type: "video/mp4" }) });
const gid = (await okInit.json()).upload?.id;
const routes = [
  ["POST", "/admin/api/upload/init", JSON.stringify({ name: "x.mp4", size: 10, type: "video/mp4" })],
  ["PUT", `/admin/api/upload/${gid}/chunk?offset=0`, "x"],
  ["GET", `/admin/api/upload/${gid}/status`, undefined],
  ["POST", `/admin/api/upload/${gid}/complete`, undefined],
  ["DELETE", `/admin/api/upload/${gid}`, undefined],
];
const guardRes = [];
for (const [method, url, body] of routes) {
  const anon = await fetch(`${BASE}${url}`, { method, headers: { origin: BASE }, body });
  const cross = await fetch(`${BASE}${url}`, { method, headers: { cookie: jarV.header(), origin: "https://site-malveillant.example" }, body });
  guardRes.push(`${method} ${url.split("/").slice(4).join("/") || "init"} : ${anon.status}/${cross.status}`);
  ok(`V1 ${method} ${url.replace(gid, "<id>")} : sans session → 403, autre origine → 403`, anon.status === 403 && cross.status === 403, `${anon.status}/${cross.status}`);
}
// Offset décalé, coupure, reprise.
const H = { cookie: jarV.header(), origin: BASE };
const half = Math.floor(sample.length / 2);
let rv = await fetch(`${BASE}/admin/api/upload/${gid}/chunk?offset=1000`, { method: "PUT", headers: { ...H, "content-length": "10" }, body: Buffer.alloc(10) });
ok("V2 morceau à un offset décalé → 409 (offset attendu dans le message)", rv.status === 409 && /octet 0/.test((await rv.json()).message ?? ""));
rv = await fetch(`${BASE}/admin/api/upload/${gid}/chunk?offset=0`, { method: "PUT", headers: { ...H, "content-length": String(half) }, body: sample.subarray(0, half) });
// Coupure réseau en plein morceau : la moitié du second morceau, puis la connexion tombe.
await new Promise((resolve) => {
  const req = httpRequest({ host: "127.0.0.1", port: PORT, path: `/admin/api/upload/${gid}/chunk?offset=${half}`, method: "PUT", headers: { ...H, "content-length": String(sample.length - half) } }, () => resolve());
  req.on("error", () => resolve());
  req.write(sample.subarray(half, half + 100_000));
  setTimeout(() => {
    req.destroy();
    resolve();
  }, 500);
});
await sleep(800);
let st = await (await fetch(`${BASE}/admin/api/upload/${gid}/status`, { headers: H })).json();
ok(`V3 coupure en plein morceau : le serveur reste à l'offset confirmé (${st.upload?.offset})`, st.upload?.offset === half, JSON.stringify(st).slice(0, 120));
rv = await fetch(`${BASE}/admin/api/upload/${gid}/chunk?offset=${half}`, { method: "PUT", headers: { ...H, "content-length": String(sample.length - half) }, body: sample.subarray(half) });
const resumed = await fetch(`${BASE}/admin/api/upload/${gid}/complete`, { method: "POST", headers: H });
const rb = await resumed.json();
const baseRow = rb.media?.id ? await waitMedia(dirV, rb.media.id, 120000) : null;
ok("V4 reprise après coupure : envoi terminé, vidéo convertie", rv.status === 200 && resumed.status === 200 && baseRow?.status === "ready", `${rv.status} ${resumed.status} ${baseRow?.status} ${baseRow?.error ?? ""}`);
// Aucune métadonnée, original supprimé (KEEP_VIDEO_ORIGINALS=false par défaut).
const baseFiles = baseRow?.variants ? JSON.parse(baseRow.variants).files : [];
const mp4s = baseFiles.filter((f) => f.format === "mp4");
let clean = mp4s.length > 0;
for (const f of mp4s) {
  const out = path.join(dirV, "media", f.key);
  const p = probe(out);
  const ftags = Object.keys(p.format.tags ?? {});
  const all = [p.format.tags ?? {}, ...p.streams.map((x) => x.tags ?? {})].flatMap((t) => Object.entries(t));
  const leaks = all.filter(([k, val]) => /title|location|creation_time|comment|artist|com\.apple/i.test(k) || /Titre privé|48\.85/.test(String(val)));
  if (leaks.length || ftags.some((k) => !["major_brand", "minor_version", "compatible_brands"].includes(k))) clean = false;
}
ok("V5 sorties sans métadonnées (titre, lieu, date retirés ; balises de format limitées à la structure MP4)", clean, JSON.stringify(mp4s.map((f) => f.key)));
const origKey = query(dirV, "select key from media where id = ?", rb.media?.id)?.key;
ok("V6 original supprimé après conversion (KEEP_VIDEO_ORIGINALS=false)", origKey && !existsSync(path.join(dirV, "media", origKey)) && serverLog(v.server, /original supprimé/g).length > 0);
// Rotation appliquée.
const rot = await chunked(jarV, src("tourne.mp4"), "tourne.mp4");
const rotRow = rot.body.media?.id ? await waitMedia(dirV, rot.body.media.id, 120000) : null;
const rotOut = rotRow?.variants ? JSON.parse(rotRow.variants).files.find((f) => f.format === "mp4") : null;
const rotProbe = rotOut ? probe(path.join(dirV, "media", rotOut.key)) : null;
const rotStream = rotProbe?.streams.find((x) => x.codec_type === "video");
ok(
  "V7 rotation appliquée : 640 × 360 tourné d'un quart → sortie 360 × 640, sans matrice d'affichage",
  rotStream?.width === 360 && rotStream?.height === 640 && !(rotStream?.side_data_list ?? []).some((d) => d.side_data_type === "Display Matrix"),
  JSON.stringify({ w: rotStream?.width, h: rotStream?.height, sd: rotStream?.side_data_list }),
);
// WebM accepté, faux types refusés.
const webm = await chunked(jarV, src("clip.webm"), "clip.webm", "video/webm");
const webmRow = webm.body.media?.id ? await waitMedia(dirV, webm.body.media.id, 120000) : null;
ok("V8 WebM (VP9) accepté et converti en MP4", webmRow?.status === "ready", `${webm.status} ${webmRow?.status}`);
const wav = await chunked(jarV, src("son.wav"), "musique.mp4");
ok("V9 fichier audio WAV nommé .mp4 → refusé par la signature (415)", wav.stage === "complete" && wav.status === 415 && /pas accepté/.test(wav.body.message ?? ""), `${wav.stage} ${wav.status}`);
const audioOnly = await chunked(jarV, src("son-seul.mp4"), "clip.mp4");
ok("V10 MP4 sans piste vidéo (son seul) → refusé par ffprobe (422)", audioOnly.status === 422 && /piste vidéo/.test(audioOnly.body.message ?? ""), `${audioOnly.status} ${audioOnly.body.message}`);
// Envoi abandonné purgé (24 h).
const stale = await fetch(`${BASE}/admin/api/upload/init`, { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ name: "oubli.mp4", size: 5000, type: "video/mp4" }) });
const staleId = (await stale.json()).upload.id;
await stop(v.server);
{
  const db = new Database(path.join(dirV, "portfolio.db"));
  db.prepare("update uploads set updated_at = ? where id = ?").run(Math.floor(Date.now() / 1000) - 25 * 3600, staleId);
  db.close();
}
v = { server: startServer(dirV, baseEnvF) };
await v.server.ready;
await sleep(800);
ok("V11 envoi abandonné depuis plus de 24 h : purgé au démarrage (ligne et fichier partiel)", !query(dirV, "select id from uploads where id = ?", staleId) && !existsSync(path.join(dirV, "tmp", "uploads", `${staleId}.part`)));
await stop(v.server);

// ---- Limites : durée, dimensions, poids ----------------------------------------------
for (const [label, env, file, expect] of [
  ["V12 vidéo trop longue (6 s pour MAX_VIDEO_DURATION_S=3)", { MAX_VIDEO_DURATION_S: "3" }, "petite.mp4", { status: 422, re: /dure .* au plus/ }],
  ["V13 vidéo trop grande (640 px pour MAX_VIDEO_DIMENSION=320)", { MAX_VIDEO_DIMENSION: "320" }, "petite.mp4", { status: 422, re: /trop grande .* 320 px/ }],
  ["V14 vidéo trop lourde (1,4 Mo pour MAX_VIDEO_MB=1) : refus dès l'annonce", { MAX_VIDEO_MB: "1" }, "base.mp4", { status: 413, re: /dépasse 1 Mo/, stage: "init" }],
]) {
  const dir = `${TMP}/vl-${file}-${Object.keys(env)[0]}`;
  const l = await freshAdmin(dir, env);
  // La base de départ contient déjà la vidéo de test du seed (lot 38) : on compare à ce nombre, pas à zéro.
  const videos0 = query(dir, "select count(*) n from media where kind = 'video'").n;
  const res = await chunked(l.jar, src(file), file);
  ok(`${label} → ${expect.status}, message clair`, res.status === expect.status && expect.re.test(res.body.message ?? "") && (!expect.stage || res.stage === expect.stage) && query(dir, "select count(*) n from media where kind = 'video'").n === videos0, `${res.stage} ${res.status} ${res.body.message}`);
  await stop(l.server);
}

// ---- Quota dépassé en cours d'envoi ---------------------------------------------------
const dirQ = `${TMP}/vq`;
let q = await freshAdmin(dirQ);
const usedQ = query(dirQ, "select sum(size) n from media").n;
await stop(q.server);
q = await freshAdmin(dirQ, { MEDIA_MAX_TOTAL_GB: String((usedQ + 3 * 1024 * 1024) / 1024 ** 3) });
const big = readFileSync(src("base.mp4"));
const qi = await fetch(`${BASE}/admin/api/upload/init`, { method: "POST", headers: { cookie: q.jar.header(), origin: BASE, "content-type": "application/json" }, body: JSON.stringify({ name: "q.mp4", size: big.length, type: "video/mp4" }) });
const qid = (await qi.json()).upload?.id;
await stop(q.server);
// L'espace se réduit pendant l'envoi (quota abaissé, ou autre contenu ajouté).
q = { server: startServer(dirQ, { ...baseEnvF, MEDIA_MAX_TOTAL_GB: String((usedQ + 512 * 1024) / 1024 ** 3) }), jar: q.jar };
await q.server.ready;
const qc = await fetch(`${BASE}/admin/api/upload/${qid}/chunk?offset=0`, { method: "PUT", headers: { cookie: q.jar.header(), origin: BASE, "content-length": String(1024 * 1024) }, body: big.subarray(0, 1024 * 1024) });
const qcb = await qc.json();
ok("V15 quota dépassé en cours d'envoi → morceau refusé (507), rien d'écrit", qi.status === 200 && qc.status === 507 && /espace de stockage est plein/.test(qcb.message ?? "") && query(dirQ, "select offset from uploads where id = ?", qid)?.offset === 0, `${qi.status} ${qc.status}`);
await stop(q.server);

{
  // ---- Quota réservé sans course, envois ouverts bornés, disque presque plein (docs/SECURITE.md §2.9, N14) -------------
  // Occupation telle que la compte storageUsage (quota.ts) : originaux, variantes, envois ouverts.
  const usageOf = (dir) =>
    query(
      dir,
      `select coalesce((select sum(case when json_valid(variants) and json_extract(variants, '$.originalRemoved') = 1 then 0 else size end) from media), 0)
        + coalesce((select sum(json_extract(f.value, '$.size')) from media m, json_each(m.variants, '$.files') f where json_valid(m.variants)), 0)
        + coalesce((select sum(size) from uploads), 0) n`,
    ).n;
  const dirR = `${TMP}/v-quota-n14`; // dossier propre (vr sert à P20)
  let rq = await freshAdmin(dirR);
  await stop(rq.server);
  const MB = 1024 * 1024;
  const usedR = usageOf(dirR);
  rq = await freshAdmin(dirR, { MEDIA_MAX_TOTAL_GB: String((usedR + 5.5 * MB) / 1024 ** 3) });
  const initR = (size, name, jar = rq.jar) =>
    fetch(`${BASE}/admin/api/upload/init`, { method: "POST", headers: { cookie: jar.header(), origin: BASE, "content-type": "application/json" }, body: JSON.stringify({ name, size, type: "video/mp4" }) });
  const parallel = await Promise.all(Array.from({ length: 10 }, (_, i) => initR(MB, `course-${i}.mp4`)));
  const accepted = parallel.filter((r) => r.status === 200).length;
  const openR = query(dirR, "select count(*) n from uploads").n;
  ok(
    "V16 10 init simultanés de 1 Mo pour 5,5 Mo de place → 5 acceptés, les autres 507 (contrôle et réservation dans la même transaction)",
    accepted === 5 && openR === 5 && parallel.every((r) => r.status === 200 || r.status === 507),
    `${parallel.map((r) => r.status).join(",")} ; ${openR} envois ouverts`,
  );
  await stop(rq.server);
  // Envois ouverts : 10 au plus par administrateur (sans quota).
  rq = { server: startServer(dirR, baseEnvF), jar: rq.jar };
  await rq.server.ready;
  const more = [];
  for (let i = 0; i < 6; i++) more.push((await initR(1000, `ouvert-${i}.mp4`)).status);
  const over = await initR(1000, "de-trop.mp4");
  const overBody = await over.json();
  ok("V17 11ᵉ envoi ouvert du même administrateur → 429, message clair, rien de réservé", more.slice(0, 5).every((s) => s === 200) && more[5] === 429 && over.status === 429 && /envois en cours ou interrompus/.test(overBody.message ?? "") && query(dirR, "select count(*) n from uploads").n === 10, `${more.join(",")} ${over.status} ${overBody.message}`);
  const oneId = query(dirR, "select id from uploads order by created_at limit 1").id;
  const cancelled = await fetch(`${BASE}/admin/api/upload/${oneId}`, { method: "DELETE", headers: { cookie: rq.jar.header(), origin: BASE } });
  const after = await initR(1000, "apres-annulation.mp4");
  ok("V18 un envoi annulé libère sa place", cancelled.status === 200 && after.status === 200, `${cancelled.status} ${after.status}`);
  const lastId = (await after.json()).upload?.id;
  await stop(rq.server);
  // Disque presque plein (statfs) : marge libre demandée plus grande que le disque → init, morceau et envoi direct refusés.
  rq = { server: startServer(dirR, { ...baseEnvF, UPLOAD_MIN_FREE_MB: String(1024 * 1024 * 1024) }), jar: rq.jar };
  await rq.server.ready;
  const openBefore = query(dirR, "select count(*) n from uploads").n;
  const diskInit = await initR(1000, "disque.mp4");
  const diskInitBody = await diskInit.json();
  const diskChunk = await fetch(`${BASE}/admin/api/upload/${lastId}/chunk?offset=0`, { method: "PUT", headers: { cookie: rq.jar.header(), origin: BASE, "content-length": "1000" }, body: Buffer.alloc(1000) });
  const fdDisk = new FormData();
  fdDisk.append("file", new Blob([await pngOf(64, 64, 8, 2)], { type: "image/png" }), "petit.png");
  const diskDirect = await fetch(`${BASE}/admin/api/upload`, { method: "POST", headers: { cookie: rq.jar.header(), origin: BASE }, body: fdDisk });
  ok(
    "V19 disque presque plein (UPLOAD_MIN_FREE_MB) → init, morceau et envoi direct refusés (507, « disque »), rien d'écrit",
    diskInit.status === 507 && /disque du serveur est presque plein/.test(diskInitBody.message ?? "") && diskChunk.status === 507 && diskDirect.status === 507 && query(dirR, "select count(*) n from uploads").n === openBefore && query(dirR, "select offset from uploads where id = ?", lastId)?.offset === 0,
    `${diskInit.status} ${diskChunk.status} ${diskDirect.status}`,
  );
  await stop(rq.server);
}

// ---- Passe 5b : protocole d'envoi, propriété, codecs, conversion -------------------------
ff(["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25", "-t", "3", "-c:v", "mjpeg", "-f", "mov", src("mjpeg.mov")]);
ff(["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25", "-t", "3", "-c:v", "ffv1", src("ffv1.mkv")]);
ff(["-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30", "-f", "lavfi", "-i", "sine=frequency=220", "-t", "20", "-c:v", "libx264", "-preset", "ultrafast", "-threads", "2", "-x264-params", "rc-lookahead=10:sync-lookahead=0", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", src("hd-20s.mp4")]);
const dirP = `${TMP}/vp`;
let pv = await freshAdmin(dirP);
const HP = { cookie: pv.jar.header(), origin: BASE };
const videosP0 = query(dirP, "select count(*) n from media where kind = 'video'").n; // vidéo de test du seed comprise
const initP = async (size, name = "p.mp4", j = pv.jar) =>
  fetch(`${BASE}/admin/api/upload/init`, { method: "POST", headers: { cookie: j.header(), origin: BASE, "content-type": "application/json" }, body: JSON.stringify({ name, size, type: "video/mp4" }) });
const putP = (id, offset, body, headers = {}) => fetch(`${BASE}/admin/api/upload/${id}/chunk${offset === undefined ? "" : `?offset=${offset}`}`, { method: "PUT", headers: { ...HP, ...headers }, body });
const two = readFileSync(src("base.mp4"));
let pid1 = (await (await initP(two.length)).json()).upload.id;
// Deux PUT simultanés au même offset : un seul passe.
const [pa, pb] = await Promise.all([putP(pid1, 0, two.subarray(0, 600_000), { "content-length": "600000" }), putP(pid1, 0, two.subarray(0, 600_000), { "content-length": "600000" })]);
const partSize = statSize(path.join(dirP, "tmp", "uploads", `${pid1}.part`));
ok("P1 deux PUT simultanés : 200 + 409, fichier partiel de la bonne taille", [pa.status, pb.status].sort().join(",") === "200,409" && partSize === 600_000, `${pa.status},${pb.status} ${partSize}`);
let r5 = await fetch(`${BASE}/admin/api/upload/${pid1}/complete`, { method: "POST", headers: HP });
ok("P2 complete avant la fin de l'envoi → 409", r5.status === 409, String(r5.status));
const noLen = await new Promise((resolve) => {
  const req = httpRequest({ host: "127.0.0.1", port: PORT, path: `/admin/api/upload/${pid1}/chunk?offset=600000`, method: "PUT", headers: { ...HP, "transfer-encoding": "chunked" } }, (res) => resolve(res.statusCode));
  req.on("error", () => resolve(-1));
  req.end(Buffer.alloc(10));
});
// Longueur annoncée ≠ corps envoyé : requête brute (fetch refuse de l'émettre). Le serveur répond sans attendre le corps.
const rawPut = (pathname, length) =>
  new Promise((resolve) => {
    const req = httpRequest({ host: "127.0.0.1", port: PORT, path: pathname, method: "PUT", headers: { ...HP, "content-length": String(length) } }, (res) => {
      res.resume();
      resolve({ status: res.statusCode });
      req.destroy();
    });
    req.on("error", () => resolve({ status: -1 }));
    req.write(Buffer.alloc(10));
  });
const tooLong = await rawPut(`/admin/api/upload/${pid1}/chunk?offset=600000`, 9 * 1024 * 1024);
const beyond = await rawPut(`/admin/api/upload/${pid1}/chunk?offset=600000`, two.length);
ok("P3 Content-Length absent, > 8 Mo ou au-delà de la taille annoncée → 400", noLen === 400 && tooLong.status === 400 && beyond.status === 400, `${noLen} ${tooLong.status} ${beyond.status}`);
const noOff = await putP(pid1, undefined, Buffer.alloc(10), { "content-length": "10" });
const badOff = await fetch(`${BASE}/admin/api/upload/${pid1}/chunk?offset=abc`, { method: "PUT", headers: { ...HP, "content-length": "10" }, body: Buffer.alloc(10) });
const emptyOff = await fetch(`${BASE}/admin/api/upload/${pid1}/chunk?offset=`, { method: "PUT", headers: { ...HP, "content-length": "10" }, body: Buffer.alloc(10) });
ok("P4 offset absent, vide ou non numérique → 400", noOff.status === 400 && badOff.status === 400 && emptyOff.status === 400, `${noOff.status} ${badOff.status} ${emptyOff.status}`);
await putP(pid1, 600000, two.subarray(600000), { "content-length": String(two.length - 600000) });
r5 = await fetch(`${BASE}/admin/api/upload/${pid1}/complete`, { method: "POST", headers: HP });
const firstId = (await r5.json()).media?.id;
const r6 = await fetch(`${BASE}/admin/api/upload/${pid1}/complete`, { method: "POST", headers: HP });
ok("P5 complete appelé deux fois : 404 la seconde fois, aucun doublon", r5.status === 200 && r6.status === 404 && query(dirP, "select count(*) n from media where kind = 'video'").n === videosP0 + 1, `${r5.status} ${r6.status}`);
const dup = await chunked(pv.jar, src("base.mp4"), "copie.mp4");
ok("P6 même vidéo renvoyée sous un autre nom → même média", dup.status === 200 && dup.body.media?.id === firstId && query(dirP, "select count(*) n from media where kind = 'video'").n === videosP0 + 1, `${dup.status} ${dup.body.media?.id}/${firstId}`);
for (const [label, id] of [["non UUID", "pas-un-uuid"], ["inconnu", "00000000-0000-4000-8000-000000000000"]]) {
  const st5 = await fetch(`${BASE}/admin/api/upload/${id}/status`, { headers: HP });
  ok(`P7 identifiant ${label} → 404`, st5.status === 404, String(st5.status));
}
// Un autre administrateur ne voit pas l'envoi.
{
  const { hashPassword } = await import("better-auth/crypto");
  const db = new Database(path.join(dirP, "portfolio.db"));
  const uid = "second-admin";
  const now = Date.now();
  db.prepare("insert into user (id, name, email, email_verified, created_at, updated_at) values (?, ?, ?, 1, ?, ?)").run(uid, "second", "second@example.test", now, now);
  db.prepare("insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at) values (?, ?, 'credential', ?, ?, ?, ?)").run("acc-second", uid, uid, await hashPassword("second-mot-de-passe-42"), now, now);
  db.close();
}
const other = new Jar();
await signIn(other, "second@example.test", "second-mot-de-passe-42", "198.51.100.200");
const mine = (await (await initP(1000)).json()).upload.id;
const theirs = [
  await fetch(`${BASE}/admin/api/upload/${mine}/status`, { headers: { cookie: other.header(), origin: BASE } }),
  await fetch(`${BASE}/admin/api/upload/${mine}/chunk?offset=0`, { method: "PUT", headers: { cookie: other.header(), origin: BASE, "content-length": "10" }, body: Buffer.alloc(10) }),
  await fetch(`${BASE}/admin/api/upload/${mine}/complete`, { method: "POST", headers: { cookie: other.header(), origin: BASE } }),
  await fetch(`${BASE}/admin/api/upload/${mine}`, { method: "DELETE", headers: { cookie: other.header(), origin: BASE } }),
];
ok("P8 envoi d'un autre administrateur : statut, morceau, fin et annulation refusés (404)", theirs.every((x) => x.status === 404) && Boolean(query(dirP, "select id from uploads where id = ?", mine)), theirs.map((x) => x.status).join(","));
await fetch(`${BASE}/admin/api/upload/${mine}`, { method: "DELETE", headers: HP });
// Codecs hors liste blanche.
const mj = await chunked(pv.jar, src("mjpeg.mov"), "mjpeg.mov", "video/quicktime");
const fv = await chunked(pv.jar, src("ffv1.mkv"), "ffv1.mkv", "video/x-matroska");
ok("P9 codec vidéo hors liste blanche (MJPEG, FFV1) → 422 « Exporte en H.264 ou ProRes »", mj.status === 422 && /codec vidéo .*\(mjpeg\).*H\.264 ou ProRes/.test(mj.body.message ?? "") && fv.status === 422 && /\(ffv1\)/.test(fv.body.message ?? ""), `${mj.status} ${mj.body.message} | ${fv.status} ${fv.body.message}`);
// Range sur la sortie 720 et sur le poster.
await waitMedia(dirP, firstId, 120000);
const outs = JSON.parse(query(dirP, "select variants from media where id = ?", firstId).variants).files;
for (const f of [outs.find((x) => x.key.endsWith("/720.mp4")), outs.find((x) => x.format === "webp")]) {
  const rr = await fetch(`${BASE}/media/${f.key}`, { headers: { range: "bytes=100-1099" } });
  const len = (await rr.arrayBuffer()).byteLength;
  ok(`P10 Range sur ${f.key.split("/").pop()} → 206, Content-Range et Accept-Ranges`, rr.status === 206 && rr.headers.get("content-range") === `bytes 100-1099/${f.size}` && rr.headers.get("accept-ranges") === "bytes" && len === 1000, `${rr.status} ${rr.headers.get("content-range")}`);
}
// Classement en boucle.
const loopUp = await chunked(pv.jar, src("boucle-720.mp4"), "boucle.mp4");
await waitMedia(dirP, loopUp.body.media?.id, 120000);
const loopRow = query(dirP, "select has_audio a, duration d from media where id = ?", loopUp.body.media?.id);
const longRow = query(dirP, "select has_audio a, duration d from media where id = ?", firstId);
ok("P11 classement : muette et < 20 s = boucle ; avec son = vidéo", loopRow.a === 0 && loopRow.d < 20 && longRow.a === 1, JSON.stringify({ loopRow, longRow }));
// Une image envoyée pendant une longue conversion est prête avant elle ; nice 10 sur tous les fils.
const hd = await chunked(pv.jar, src("hd-20s.mp4"), "hd.mp4", "video/mp4", { chunk: 8 * 1024 * 1024 });
// Échantillonne jusqu'à voir l'encodeur avec ses fils (décodage -threads 1, encodage -threads 2).
let nices = [];
for (let i = 0; i < 150 && nices.length < 3; i++) {
  const seen = [];
  const ps = spawnSync("pgrep", ["-x", "ffmpeg"], { encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean);
  for (const pid of ps) {
    try {
      for (const t of readdirSync(`/proc/${pid}/task`)) seen.push(Number(readFileSync(`/proc/${pid}/task/${t}/stat`, "utf8").split(") ")[1].split(" ")[16]));
    } catch {
      // processus terminé entre-temps
    }
  }
  if (seen.length > nices.length) nices = seen;
  if (nices.length < 3) await sleep(100);
}
ok(`P12 ffmpeg lancé sous nice 10 : ${nices.length} fils, tous à 10`, nices.length >= 3 && nices.every((n) => n === 10), nices.join(","));
const img = await upload(pv.jar, "pendant.png", "image/png", await sharp({ create: { width: 300, height: 200, channels: 3, background: "#a03c78" } }).png().toBuffer());
const imgRow = await waitMedia(dirP, img.json?.media?.id, 60000);
const hdState = query(dirP, "select status from media where id = ?", hd.body.media?.id)?.status;
ok("P13 image envoyée pendant une longue conversion : prête avant la vidéo (files séparées)", imgRow?.status === "ready" && hdState === "processing", `${imgRow?.status} / vidéo ${hdState}`);
const hdOut = query(dirP, "select variants from media where id = ?", hd.body.media?.id);
const hdVid = await fetch(`${BASE}/media/vid/${(query(dirP, "select sha256 from media where id = ?", hd.body.media?.id)?.sha256 ?? "").slice(0, 16)}/720.mp4`);
ok("P14 vid/ d'un média en traitement → 404", !hdOut.variants && hdVid.status === 404, String(hdVid.status));
// Redémarrage brutal pendant la conversion : reprise, aucun dossier de travail laissé.
// kill -9 du serveur ; dans le conteneur, ses enfants (ffmpeg) partent avec lui.
pv.server.child.kill("SIGKILL");
await pv.server.exited;
spawnSync("pkill", ["-KILL", "-x", "ffmpeg"]);
const leftovers = existsSync(path.join(dirP, "tmp")) ? readdirSync(path.join(dirP, "tmp")).filter((n) => n.startsWith("video-")) : [];
pv = { server: startServer(dirP, baseEnvF), jar: pv.jar };
await pv.server.ready;
await sleep(800);
// La reprise crée son propre dossier : seuls les anciens doivent avoir disparu.
const cleaned = leftovers.filter((n) => existsSync(path.join(dirP, "tmp", n)));
const hdAfter = await waitMedia(dirP, hd.body.media?.id, 300000);
ok(`P15 redémarrage pendant une conversion : dossiers de travail laissés supprimés (${leftovers.length} → ${cleaned.length}), conversion reprise et terminée`, leftovers.length > 0 && cleaned.length === 0 && hdAfter?.status === "ready", `${hdAfter?.status} ${hdAfter?.error ?? ""}`);
await stop(pv.server);

// Délai dur : VIDEO_JOB_MAX_DURATION_S=1.
const dirT = `${TMP}/vt`;
const tv = await freshAdmin(dirT, { VIDEO_JOB_MAX_DURATION_S: "1" });
const slow = await chunked(tv.jar, src("hd-20s.mp4"), "lente.mp4", "video/mp4", { chunk: 8 * 1024 * 1024 });
const slowRow = await waitMedia(dirT, slow.body.media?.id, 60000);
await sleep(500);
const ffLeft = spawnSync("pgrep", ["-x", "ffmpeg"], { encoding: "utf8" }).stdout.trim();
const tmpT = readdirSync(path.join(dirT, "tmp")).filter((n) => n !== "uploads");
ok("P16 VIDEO_JOB_MAX_DURATION_S=1 : échec « trop de temps », plus aucun ffmpeg, tmp/ vide", slowRow?.status === "failed" && /trop de temps/.test(slowRow?.error ?? "") && !ffLeft && tmpT.length === 0, `${slowRow?.status} ${slowRow?.error} ffmpeg=${ffLeft} tmp=${tmpT.join(",")}`);
const failedVid = await fetch(`${BASE}/media/vid/${(query(dirT, "select sha256 from media where id = ?", slow.body.media?.id)?.sha256 ?? "").slice(0, 16)}/720.mp4`);
ok("P17 vid/ d'un média en échec → 404", failedVid.status === 404);
const retry = await callActionJson(tv.jar, ids.retryMediaAction, [slow.body.media?.id], "/admin/medias");
const retried = query(dirT, "select status from media where id = ?", slow.body.media?.id)?.status;
await waitMedia(dirT, slow.body.media?.id, 60000);
const delFailed = await callActionJson(tv.jar, ids.deleteMediaAction, [slow.body.media?.id], "/admin/medias");
ok("P18 vidéo en échec : « Réessayer » relance la conversion, puis suppression possible", retry.text.includes('"ok":true') && retried === "processing" && delFailed.text.includes('"ok":true') && Boolean(query(dirT, "select deleted_at d from media where id = ?", slow.body.media?.id)?.d), `${retry.text.slice(0, 80)} ${retried} ${delFailed.text.slice(0, 80)}`);
await stop(tv.server);

// KEEP_VIDEO_ORIGINALS=true : l'original reste sur disque, jamais servi.
const dirK = `${TMP}/vk`;
const kv = await freshAdmin(dirK, { KEEP_VIDEO_ORIGINALS: "true" });
const kept = await chunked(kv.jar, src("base.mp4"), "garde.mp4");
await waitMedia(dirK, kept.body.media?.id, 120000);
const keptKey = query(dirK, "select key from media where id = ?", kept.body.media?.id).key;
const keptGet = await fetch(`${BASE}/media/${keptKey}`);
ok("P19 KEEP_VIDEO_ORIGINALS=true : original conservé sur disque, /media/originals/… → 404", existsSync(path.join(dirK, "media", keptKey)) && keptGet.status === 404, String(keptGet.status));
await stop(kv.server);

// Quota : deux annonces dont la somme dépasse ; DELETE rend la réservation.
const dirR = `${TMP}/vr`;
let rv2 = await freshAdmin(dirR);
// Espace compté par le serveur : originaux + sorties de tous les médias.
const usedR = (() => {
  const db = new Database(path.join(dirR, "portfolio.db"), { readonly: true });
  let n = 0;
  for (const m of db.prepare("select size, variants from media").all()) {
    const v = m.variants ? JSON.parse(m.variants) : null;
    if (!v?.originalRemoved) n += m.size;
    for (const f of v?.files ?? []) n += f.size;
  }
  db.close();
  return n;
})();
await stop(rv2.server);
rv2 = await freshAdmin(dirR, { MEDIA_MAX_TOTAL_GB: String((usedR + 3 * 1024 * 1024) / 1024 ** 3) });
const a1 = await (await initP2(rv2.jar, 2 * 1024 * 1024)).json();
const a2r = await initP2(rv2.jar, 2 * 1024 * 1024);
ok("P20 deux annonces dont la somme dépasse le quota : la seconde est refusée (507)", a1.ok && a2r.status === 507, String(a2r.status));
await fetch(`${BASE}/admin/api/upload/${a1.upload.id}`, { method: "DELETE", headers: { cookie: rv2.jar.header(), origin: BASE } });
const a3r = await initP2(rv2.jar, 2 * 1024 * 1024);
ok("P21 DELETE rend la réservation : une nouvelle annonce passe", a3r.status === 200, String(a3r.status));
await stop(rv2.server);

// ---- Phase 6a : tags (bornes, Unicode, envoi, dédoublonnage, fusion, suppression, XSS) -----
{
console.log("\n== TAG. tags de la bibliothèque");
const dirT = `${TMP}/vt6`;
const tv = await freshAdmin(dirT);
const HT = { cookie: tv.jar.header(), origin: BASE };
const dbT = (fn) => {
  const db = new Database(path.join(dirT, "portfolio.db"));
  db.pragma("foreign_keys = ON");
  try {
    return fn(db);
  } finally {
    db.close();
  }
};
const tagsOf = (id) => dbT((db) => db.prepare("select t.label from media_tags mt join tags t on t.id = mt.tag_id where mt.media_id = ? order by t.key").all(id).map((r) => r.label));
const tagCount = () => query(dirT, "select count(*) n from tags").n;
const act = (name, args, page = "/admin/medias") => callActionJson(tv.jar, ids[name], args, page);
const good = (r) => r.text.includes('"ok":true');
const mediaIds = dbT((db) => db.prepare("select id from media where kind = 'image' order by id").all().map((r) => r.id));
const [mA, mB, mC] = mediaIds;
const ch = (...codes) => String.fromCodePoint(...codes);
let r;

// Bornes.
r = await act("setMediaTagsAction", [mA, ["x".repeat(41)]]);
ok("TAG1 libellé de 41 caractères refusé (40 au plus)", !good(r) && /40 caractères/.test(r.text), r.text.slice(0, 160));
r = await act("setMediaTagsAction", [mA, Array.from({ length: 21 }, (_, i) => `tag ${i}`)]);
ok("TAG2 21 tags sur un média refusés (20 au plus)", !good(r) && /20 tags au plus/.test(r.text), r.text.slice(0, 160));
r = await act("setMediaTagsAction", [mA, Array.from({ length: 20 }, (_, i) => `tag ${i}`)]);
ok("TAG2b 20 tags acceptés", good(r) && tagsOf(mA).length === 20);
// Équivalences Unicode : un seul tag ; clé vide refusée.
r = await act("setMediaTagsAction", [mB, ["  Décor   Nuit ", "décor nuit", `${ch(0xff24)}É${ch(0xff23, 0xff2f, 0xff32)} NUIT`, `De${ch(0x200b)}cor nuit`]]);
ok("TAG3 équivalences (espaces, accents, casse, pleine chasse, zéro-largeur) : un seul tag", good(r) && JSON.stringify(tagsOf(mB)) === JSON.stringify(["Décor Nuit"]), JSON.stringify(tagsOf(mB)));
r = await act("setMediaTagsAction", [mB, ["Straße", "STRASSE", `${ch(0xfb01)}lm`, "FILM"]]);
ok("TAG3b ß = ss, ligature ﬁ = fi", good(r) && tagsOf(mB).length === 2, JSON.stringify(tagsOf(mB)));
const before3c = tagCount();
const empties = [];
for (const label of [ch(0x3164, 0x3164), ch(0x2800), ch(0x200b, 0x200d, 0xfeff), ch(0x301, 0x308), ch(0x115f, 0x1160)]) {
  const x = await act("addMediaTagsAction", [[mB], [label]]);
  empties.push(good(x));
}
ok("TAG3c clé vide refusée (remplissages hangul, blanc braille, invisibles, signes combinants seuls)", empties.every((e) => !e) && tagCount() === before3c, JSON.stringify(empties));

// Plafond de 500 : seuls les tags utilisés comptent.
dbT((db) => {
  const ins = db.prepare("insert into tags (label, key) values (?, ?)");
  db.transaction(() => {
    for (let i = 0; i < 600; i++) ins.run(`vide ${i}`, `vide ${i}`);
  })();
});
r = await act("addMediaTagsAction", [[mC], ["malgré 600 vides"]]);
ok("TAG4 600 tags inutilisés ne bloquent pas la création (plafond = tags utilisés)", good(r), r.text.slice(0, 120));
dbT((db) => {
  const used = db.prepare("select count(distinct tag_id) n from media_tags").get().n;
  const ins = db.prepare("insert into tags (label, key) values (?, ?)");
  const link = db.prepare("insert into media_tags (media_id, tag_id) values (?, ?)");
  db.transaction(() => {
    for (let i = used; i < 499; i++) link.run(mediaIds[3 + (i % 10)], ins.run(`rempli ${i}`, `rempli ${i}`).lastInsertRowid);
  })();
});
const fresh = mediaIds[15];
r = await act("addMediaTagsAction", [[fresh], ["le cinq centième"]]);
const r501 = await act("addMediaTagsAction", [[fresh], ["un de trop"]]);
const reuse = await act("addMediaTagsAction", [[fresh], ["REMPLI 100"]]);
ok("TAG5 500e tag utilisé accepté, 501e refusé ; un tag existant (même clé) reste utilisable", good(r) && !good(r501) && /500 au plus/.test(r501.text) && good(reuse), `${r.text.slice(0, 60)} | ${r501.text.slice(0, 100)}`);
// Envoi simple au plafond : 422 ; champ tags invalide : 400 ; rien de créé.
const pngT = (color) => sharp({ create: { width: 40, height: 30, channels: 3, background: color } }).png().toBuffer();
const simple = async (tagsField, data, name = "t.png") => {
  const { body, type } = multipartParts([
    ...(tagsField === undefined ? [] : [{ name: "tags", data: Buffer.from(tagsField) }]),
    { name: "file", filename: name, type: "image/png", data },
  ]);
  const res = await http("/admin/api/upload", { jar: tv.jar, method: "POST", raw: body, headers: { "content-type": type, origin: BASE } });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const mediaBefore = query(dirT, "select count(*) n from media").n;
const s422 = await simple(JSON.stringify(["tout nouveau"]), await pngT("#123456"));
const s400 = await simple("pas du json", await pngT("#123457"));
const s400b = await simple(JSON.stringify(["y".repeat(41)]), await pngT("#123458"));
ok("TAG6 envoi simple : 501e tag → 422, champ « tags » invalide → 400, aucun média ni tag créé", s422.status === 422 && s400.status === 400 && s400b.status === 400 && query(dirT, "select count(*) n from media").n === mediaBefore && !query(dirT, "select id from tags where key = 'tout nouveau'"), `${s422.status} ${s400.status} ${s400b.status}`);
dbT((db) => db.prepare("delete from tags where key like 'rempli %' or key like 'vide %'").run());

// Tags transmis avec init ; dédoublonnage = union ; refus = rien de créé.
const initTagged = async (file, name, tags, completeTags) => {
  const data = readFileSync(file);
  const init = await fetch(`${BASE}/admin/api/upload/init`, { method: "POST", headers: { ...HT, "content-type": "application/json" }, body: JSON.stringify({ name, size: data.length, type: "video/mp4", tags }) });
  const ib = await init.json();
  if (init.status !== 200) return { status: init.status, body: ib };
  const id = ib.upload.id;
  const put = await fetch(`${BASE}/admin/api/upload/${id}/chunk?offset=0`, { method: "PUT", headers: { ...HT, "content-length": String(data.length) }, body: data });
  if (put.status !== 200) return { status: put.status };
  const done = await fetch(`${BASE}/admin/api/upload/${id}/complete`, {
    method: "POST",
    headers: completeTags ? { ...HT, "content-type": "application/json" } : HT,
    body: completeTags ? JSON.stringify({ tags: completeTags }) : undefined,
  });
  return { status: done.status, body: await done.json() };
};
const v1 = await initTagged(src("petite.mp4"), "decor.mp4", ["Décor", "nuit"]);
ok("TAG7 tags envoyés à init : attachés au média créé", v1.status === 200 && JSON.stringify(tagsOf(v1.body.media.id)) === JSON.stringify(["Décor", "nuit"]), JSON.stringify(v1.body).slice(0, 160));
const v2 = await initTagged(src("petite.mp4"), "copie.mp4", ["NUIT", "Lune"]);
ok("TAG8 même contenu renvoyé avec d'autres tags : même média, tags fusionnés", v2.status === 200 && v2.body.media.id === v1.body.media.id && JSON.stringify(tagsOf(v1.body.media.id)) === JSON.stringify(["Décor", "Lune", "nuit"]), JSON.stringify(tagsOf(v1.body.media.id)));
const tagsBefore = tagCount();
const uploadsBefore = query(dirT, "select count(*) n from uploads").n;
const bad = await initTagged(src("petite.mp4"), "x.mp4", ["y".repeat(41)]);
ok("TAG9 init refusé (tag invalide) → 400 : aucun tag ni envoi créé", bad.status === 400 && /40 caractères/.test(bad.body.message ?? "") && tagCount() === tagsBefore && query(dirT, "select count(*) n from uploads").n === uploadsBefore, JSON.stringify(bad).slice(0, 140));
// Reprise : les tags courants envoyés à complete l'emportent sur ceux d'init.
const v3 = await initTagged(src("boucle-720.mp4"), "reprise.mp4", ["ancien"], ["courant", "Lune"]);
ok("TAG10 complete avec les tags courants : ceux-ci sont attachés (pas ceux d'init)", v3.status === 200 && JSON.stringify(tagsOf(v3.body.media.id)) === JSON.stringify(["courant", "Lune"]) && !query(dirT, "select id from tags where key = 'ancien'"), JSON.stringify(tagsOf(v3.body.media?.id)));
// Ingestion refusée (son seul nommé .mp4) : aucun tag créé.
const wavT = await initTagged(src("son.wav"), "musique.mp4", ["e2e-jamais-cree"]);
ok("TAG11 ingestion refusée (415) : le tag demandé n'est pas créé", wavT.status === 415 && !query(dirT, "select id from tags where key = 'e2e-jamais-cree'"), String(wavT.status));
// tagWarning au dédoublonnage : média déjà à 20 tags.
{
  const img = await pngT("#a0a0a0");
  const first = await simple(JSON.stringify(Array.from({ length: 20 }, (_, i) => `plein ${i}`)), img, "plein.png");
  const again = await simple(JSON.stringify(["vingt et unième"]), img, "plein-bis.png");
  ok("TAG12 dédoublonnage vers un média à 20 tags : envoi accepté, tagWarning, tags inchangés", first.status === 200 && again.status === 200 && again.body.media.id === first.body.media.id && /20 tags au plus/.test(again.body.media.tagWarning ?? "") && tagsOf(first.body.media.id).length === 20, JSON.stringify(again.body).slice(0, 160));
}
// Ajout / retrait : ids inexistants, mélangés, au-delà de 1000 ; lot sur plusieurs médias.
{
  const unknown = await act("addMediaTagsAction", [[999999], ["x"]]);
  const mixed = await act("addMediaTagsAction", [[mC, 999999], ["mélange"]]);
  const mixedRemove = await act("removeMediaTagsAction", [[mC, 999999], ["Lune"]]);
  const tooMany = await act("addMediaTagsAction", [Array.from({ length: 1001 }, (_, i) => i + 1), ["x"]]);
  ok("TAG13 ajout / retrait : id inexistant, ids mélangés, plus de 1000 ids → refusés, rien d'écrit", [unknown, mixed, mixedRemove, tooMany].every((x) => !good(x)) && !query(dirT, "select id from tags where key = 'melange'"), [unknown, mixed, mixedRemove, tooMany].map((x) => x.text.slice(0, 40)).join(" | "));
  // Lot : A a 20 tags, C en a peu → refus global (rollback), C intact.
  const cBefore = tagsOf(mC);
  const batch = await act("addMediaTagsAction", [[mC, mA], ["lot 1", "lot 2"]]);
  ok("TAG14 ajout par lot dépassant 20 sur un média : refus global, aucun média modifié", !good(batch) && /20 tags au plus/.test(batch.text) && JSON.stringify(tagsOf(mC)) === JSON.stringify(cBefore) && !query(dirT, "select id from tags where key = 'lot 1'"), batch.text.slice(0, 120));
}
// Fusion, suppression, renommage : intégrité.
{
  const idOf = (key) => query(dirT, "select id from tags where key = ?", key)?.id;
  const decor = idOf("decor");
  const nuit = idOf("nuit");
  const before = query(dirT, "select count(*) n from media_tags where tag_id = ?", nuit).n;
  r = await act("mergeTagsAction", [decor, nuit]);
  const fk = dbT((db) => db.prepare("pragma foreign_key_check").all());
  ok("TAG15 fusion « Décor » → « nuit » : pas de doublon, « Décor » disparu, clés étrangères intactes", good(r) && query(dirT, "select count(*) n from media_tags where tag_id = ?", nuit).n === before && !idOf("decor") && fk.length === 0, r.text.slice(0, 100));
  r = await act("mergeTagsAction", [nuit, decor]);
  ok("TAG16 fusion vers un tag supprimé : refusée", !good(r) && /n'existe plus/.test(r.text), r.text.slice(0, 120));
  r = await act("renameTagAction", [999999, "fantôme"]);
  const self = await act("mergeTagsAction", [nuit, nuit]);
  ok("TAG17 renommer un id inexistant, fusionner un tag dans lui-même : refusés", !good(r) && !good(self), r.text.slice(0, 100));
  const lune = idOf("lune");
  r = await act("deleteTagAction", [lune]);
  ok("TAG18 suppression d'un tag : retiré des médias, médias intacts", good(r) && query(dirT, "select count(*) n from media_tags where tag_id = ?", lune).n === 0 && Boolean(query(dirT, "select id from media where id = ?", v1.body.media.id)), r.text.slice(0, 120));
  r = await act("renameTagAction", [nuit, "COURANT"]);
  ok("TAG19 renommer vers un tag existant (même clé) : refusé, fusion proposée", !good(r) && /existe déjà/.test(r.text), r.text.slice(0, 140));
  dbT((db) => db.prepare("insert into tags (label, key) values ('orphelin a', 'orphelin a'), ('orphelin b', 'orphelin b')").run());
  const usedBefore = query(dirT, "select count(distinct tag_id) n from media_tags").n;
  r = await act("deleteUnusedTagsAction", []);
  ok("TAG20 « Supprimer les tags inutilisés » : les orphelins seulement", good(r) && !idOf("orphelin a") && query(dirT, "select count(*) n from tags").n === usedBefore, r.text.slice(0, 100));
}
// Planche : position d'insertion bornée, contiguë ; média en échec non placé.
{
  const pid = query(dirT, "select id from projects order by id limit 1").id;
  const positions = () => dbT((db) => db.prepare("select position from slots where project_id = ? order by position").all(pid).map((x) => x.position));
  dbT((db) => db.prepare("update slots set position = position + 5 where project_id = ?").run(pid)); // trou en tête
  const n0 = positions().length;
  const m1 = await act("addSlotsAction", [pid, [mC], -1], `/admin/projets/${pid}`);
  const m2 = await act("addSlotsAction", [pid, [mC], 10001], `/admin/projets/${pid}`);
  const m3 = await act("addSlotsAction", [pid, [mC], 1], `/admin/projets/${pid}`);
  const afterInsert = positions();
  const m4 = await act("addSlotsAction", [pid, [mB], 500], `/admin/projets/${pid}`);
  const last = dbT((db) => db.prepare("select media_id from slots where project_id = ? order by position desc limit 1").get(pid).media_id);
  ok("TAG21 at = −1 ou 10 001 refusé ; at = 1 : positions contiguës 0…n (trou en tête résorbé)", !good(m1) && !good(m2) && good(m3) && JSON.stringify(afterInsert) === JSON.stringify([...Array(n0 + 1).keys()]), `${afterInsert.join(",")}`);
  ok("TAG22 at au-delà de la longueur : ajouté à la fin", good(m4) && last === mB && JSON.stringify(positions()) === JSON.stringify([...Array(n0 + 2).keys()]));
  writeDb(dirT, "update media set status = 'failed', error = 'test' where id = ?", mC);
  const m5 = await act("addSlotsAction", [pid, [mC]], `/admin/projets/${pid}`);
  const slotId = query(dirT, "select id from slots where project_id = ? order by position limit 1", pid).id;
  const m6 = await act("setSlotMediaAction", [slotId, mC], `/admin/projets/${pid}`);
  ok("TAG23 média en échec : ni ajouté (addSlots) ni placé (setSlotMedia)", !good(m5) && !good(m6) && /en échec/.test(m5.text + m6.text), `${m5.text.slice(0, 60)} | ${m6.text.slice(0, 60)}`);
  writeDb(dirT, "update media set status = 'ready', error = null where id = ?", mC);
}
// XSS : libellés balisés, guillemets et bidi ; jamais dans le public.
{
  const evil = [`<img src=x onerror=alert(1)>`, `"><svg onload=alert(2)>`, `a${ch(0x202e)}gpj.exe`];
  r = await act("setMediaTagsAction", [mA, evil]);
  const pages = await Promise.all(["/admin/medias", "/admin/projets/1"].map(async (u) => (await http(u, { jar: tv.jar })).text()));
  const raw = pages.some((h) => h.includes("<img src=x onerror") || h.includes("<svg onload"));
  ok("TAG24 XSS dans un libellé : enregistré, jamais interprété côté admin (HTML et payload)", good(r) && !raw && pages[0].includes("&lt;img src=x onerror=alert(1)&gt;"), raw ? "balise brute" : "");
  ok("TAG25 bidi U+202E retiré du libellé enregistré", tagsOf(mA).includes("agpj.exe"), JSON.stringify(tagsOf(mA)));
  r = await act("setMediaTagsAction", [mediaIds[1], ["tag-prive-xq7"]]);
  const publicHtml = (await Promise.all(["/fr", "/fr/personnages", "/fr/decors", "/en/characters"].map(async (u) => (await fetch(`${BASE}${u}`)).text()))).join("");
  const rsc = await (await fetch(`${BASE}/fr/personnages`, { headers: { RSC: "1" } })).text();
  ok("TAG26 tags absents des pages publiques et du payload RSC public", good(r) && !publicHtml.includes("tag-prive-xq7") && !rsc.includes("tag-prive-xq7") && !publicHtml.includes("onerror=alert"), "");
}
await stop(tv.server);
}

// ---- check-standalone : le build réel passe ; un standalone pollué échoue -----------------
{
  const real = spawnSync(process.execPath, ["scripts/check-standalone.mjs", "--require"], { encoding: "utf8" });
  const fake = `${TMP}/fake-standalone`;
  mkdirSync(path.join(fake, "src", "lib"), { recursive: true });
  mkdirSync(path.join(fake, "data"), { recursive: true });
  writeFileSync(path.join(fake, "server.js"), "");
  writeFileSync(path.join(fake, "data", "portfolio.db"), "");
  writeFileSync(path.join(fake, "next.config.ts"), "");
  const polluted = spawnSync(process.execPath, ["scripts/check-standalone.mjs", "--require"], { encoding: "utf8", env: { ...process.env, STANDALONE_DIR: fake } });
  ok("TAG27 check-standalone : le build réel passe, un standalone avec src/, data/*.db et next.config échoue", real.status === 0 && polluted.status === 1 && /src\//.test(polluted.stderr) && /portfolio\.db/.test(polluted.stderr) && /next\.config/.test(polluted.stderr), `${real.stdout}${real.stderr} | ${polluted.stderr.slice(0, 200)}`);
}

// ---- Phase 6c : kit Photoshop d'un thème (route gardée, cache, file lourde exclusive) ------
{
console.log("\n== TK. kit Photoshop (export)");
const dirK = `${TMP}/vkit`;
const kv = await freshAdmin(dirK);
const HK = { cookie: kv.jar.header(), origin: BASE };
const kitUrl = (id) => `${BASE}/admin/api/theme-kit/${id}`;
const post = (id, headers = HK) => fetch(kitUrl(id), { method: "POST", headers });
const waitReady = async (id, ms = 90000) => {
  const end = Date.now() + ms;
  for (;;) {
    const b = await (await post(id)).json().catch(() => ({}));
    if (b.ready || Date.now() > end) return b;
    await sleep(500);
  }
};
const kitJobs = () => new Database(path.join(dirK, "portfolio.db"), { readonly: true }).prepare("select id, status, payload, error from jobs where kind = 'kit' order by id").all();

// Garde.
const anon = await fetch(kitUrl("galerie-lumineuse"), { method: "POST", redirect: "manual" });
const anonGet = await fetch(kitUrl("galerie-lumineuse"), { redirect: "manual" });
const foreign = await post("galerie-lumineuse", { cookie: kv.jar.header(), origin: "https://evil.example" });
ok("TK1 sans session : export et téléchargement refusés ; autre origine : 403", anon.status >= 300 && anon.status !== 200 && anonGet.status >= 300 && anonGet.status !== 200 && foreign.status === 403, `${anon.status} ${anonGet.status} ${foreign.status}`);
const bad = await Promise.all(["inconnu", "..%2F..%2Fetc", "A_MAJ"].map(async (id) => (await post(id)).status));
ok("TK2 identifiant inconnu ou invalide → 404", bad.every((s) => s === 404), bad.join(","));

// Export, téléchargement, cache.
const t0 = Date.now();
const first = await waitReady("galerie-lumineuse");
const firstMs = Date.now() - t0;
const dl = await fetch(kitUrl("galerie-lumineuse"), { headers: { cookie: kv.jar.header() } });
const zipKit = Buffer.from(await dl.arrayBuffer());
/** Archive « stockée » du kit (lot 17e, zip-archive.ts) : nom → octets. */
function unzipStored(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let i = 0; i < n; i++) {
    const size = buf.readUInt32LE(p + 24);
    const nl = buf.readUInt16LE(p + 28);
    const el = buf.readUInt16LE(p + 30);
    const cl = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    out[buf.toString("utf8", p + 46, p + 46 + nl)] = buf.subarray(start, start + size);
    p += 46 + nl + el + cl;
  }
  return out;
}
const kitFiles = first.ready ? unzipStored(zipKit) : {};
ok(
  `TK3 export de galerie-lumineuse prêt en ${firstMs} ms, téléchargé (archive ${Math.round(zipKit.length / 1024)} Ko, pièce jointe) : trois PSD et le LISEZ-MOI.txt`,
  first.ready && dl.status === 200 && zipKit.subarray(0, 2).toString("latin1") === "PK" && /attachment; filename="kit-galerie-lumineuse\.zip"/.test(dl.headers.get("content-disposition") ?? "") && ["1-decor-accueil.psd", "2-logo-papier.psd", "3-icones-curseurs.psd"].every((n) => kitFiles[n]?.subarray(0, 4).toString("latin1") === "8BPS") && Boolean(kitFiles["LISEZ-MOI.txt"]),
  JSON.stringify(first),
);
ok("TK3c téléchargement du kit journalisé (cible, compte interne)", !first.ready || logRows(dirK, "action = 'download:kit' and target = 'galerie-lumineuse' and user is not null").length >= 1);
const line = serverLog(kv.server, /\[kit\] thème galerie-lumineuse : kit [^\n]+/g).pop() ?? "";
console.log(`      processus enfant (bundle kit-child.cjs) : ${line}`);
ok("TK3b processus enfant (kit v4, décor 5760 × 3200) : pic mémoire sous 600 Mo, priorité OOM maximale (1000)", Number(/pic (\d+) Mo/.exec(line)?.[1] ?? 9999) < 600 && /oom 1000/.test(line), line);
const jobsBefore = kitJobs().length;
const again = await (await post("galerie-lumineuse")).json();
ok("TK4 second export : servi depuis le cache, aucun nouveau job", again.ready && kitJobs().length === jobsBefore, `${JSON.stringify(again)} ${kitJobs().length}/${jobsBefore}`);

// Thème modifié : nouvelle version, ancien kit purgé.
const dup = await callActionJson(kv.jar, ids.duplicateThemeAction, ["galerie-lumineuse"], "/admin/themes");
const copyId = /"id":"(galerie-lumineuse-copie[a-z0-9-]*)"/.exec(dup.text)?.[1];
const v1 = (await waitReady(copyId)).version;
const files1 = readdirSync(path.join(dirK, "cache", "kits"));
const themeRow = JSON.parse(query(dirK, "select data from themes where id = ?", copyId).data);
const saved = await callActionJson(kv.jar, ids.saveThemeAction, [copyId, { ...themeRow, name: "Copie renommée" }], `/admin/themes/${copyId}`);
const files2 = readdirSync(path.join(dirK, "cache", "kits"));
const v2 = (await waitReady(copyId)).version;
ok(
  "TK5 thème enregistré : kit en cache purgé, nouvelle version générée",
  saved.text.includes('"ok":true') && files1.some((f) => f.startsWith(`${copyId}-${v1}`)) && !files2.some((f) => f.startsWith(`${copyId}-`)) && v2 && v2 !== v1,
  `${v1} → ${v2} ; ${files2.join(",")}`,
);
// Chemin de kit forgé dans un thème : refusé par le schéma.
const forged = await callActionJson(kv.jar, ids.saveThemeAction, [copyId, { ...themeRow, assets: { ...themeRow.assets, kit: { signature: { svg: '/media/kit/0123456789abcdef.svg");background:url("//evil', w: 10, h: 10 } } } }], `/admin/themes/${copyId}`);
ok("TK6 chemin de kit forgé (injection CSS) refusé à l'enregistrement", !forged.text.includes('"ok":true'), forged.text.slice(0, 120));
// Logo importé depuis une image (lot 61) : identifiant invalide ou image absente refusés, jamais d'élément de kit inventé.
for (const [label, arg] of [["texte", "x"], ["négatif", -1], ["inexistant", 99999999]]) {
  const r = await callActionJson(kv.jar, ids.importThemeLogoAction, [arg], `/admin/themes/${copyId}`);
  ok(`TK7 logo importé (${label}) : refusé avec un message, rien de créé`, !r.text.includes('"ok":true') && /"ok":false/.test(r.text), r.text.slice(0, 160));
}

// ---- Phase 6d : import du kit rempli (envoi PSD, revue, copie brouillon) -------------------
console.log("\n== TI. kit Photoshop (import)");
const kitInit = (body, headers = HK) => fetch(`${BASE}/admin/api/upload/init`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
/** Envoi par morceaux d'un PSD de kit (purpose kit) : init → morceaux → complete. */
async function kitUpload(data, name = "kit.psd", themeId = "galerie-lumineuse", jarH = HK) {
  const init = await kitInit({ name, size: data.length, type: "image/vnd.adobe.photoshop", purpose: { kind: "kit", themeId } }, jarH);
  const ib = await init.json().catch(() => ({}));
  if (init.status !== 200) return { stage: "init", status: init.status, body: ib };
  const id = ib.upload.id;
  for (let offset = 0; offset < data.length; ) {
    const part = data.subarray(offset, offset + 8 * 1024 * 1024);
    const r = await fetch(`${BASE}/admin/api/upload/${id}/chunk?offset=${offset}`, { method: "PUT", headers: { ...jarH, "content-length": String(part.length) }, body: part });
    const b = await r.json().catch(() => ({}));
    if (r.status !== 200) return { stage: "chunk", status: r.status, body: b };
    offset = b.upload.offset;
  }
  const done = await fetch(`${BASE}/admin/api/upload/${id}/complete`, { method: "POST", headers: jarH });
  return { stage: "complete", status: done.status, body: await done.json().catch(() => ({})) };
}
const importJobs = (dir = dirK) => new Database(path.join(dir, "portfolio.db"), { readonly: true }).prepare("select id, status, error, payload from jobs where kind = 'kit-import' order by id").all();
const statusUrl = (themeId, id) => `${BASE}/admin/api/theme-kit/${themeId}/import/${id}`;
async function waitImport(themeId, id, jarH = HK, ms = 180000) {
  const end = Date.now() + ms;
  let st = {};
  while (Date.now() < end && id) {
    st = await (await fetch(statusUrl(themeId, id), { headers: { cookie: jarH.cookie } })).json().catch(() => ({}));
    if (st.status === "done" || st.status === "failed") break;
    await sleep(500);
  }
  return st;
}
const rapportOf = (dir, id) => JSON.parse(readFileSync(path.join(dir, "kit-imports", id, "out", "rapport.json"), "utf8"));
const fixturePsd = readFileSync(path.join(ROOT, "tests/fixtures/kit-synthetique.psd"));
const themeData = (id) => query(dirK, "select data from themes where id = ?", id)?.data ?? null;

// Refus AVANT l'envoi : extension, taille annoncée, thème inconnu ; autre origine.
const badExt = await kitInit({ name: "kit.png", size: 1000, type: "image/png", purpose: { kind: "kit", themeId: "galerie-lumineuse" } });
const tooBig = await kitInit({ name: "kit.psd", size: 400 * 1024 * 1024, type: "image/vnd.adobe.photoshop", purpose: { kind: "kit", themeId: "galerie-lumineuse" } });
const noTheme = await kitInit({ name: "kit.psd", size: 1000, type: "image/vnd.adobe.photoshop", purpose: { kind: "kit", themeId: "inconnu" } });
const anonInit = await kitInit({ name: "kit.psd", size: 100, type: "x", purpose: { kind: "kit", themeId: "galerie-lumineuse" } }, { origin: BASE });
const crossInit = await kitInit({ name: "kit.psd", size: 100, type: "x", purpose: { kind: "kit", themeId: "galerie-lumineuse" } }, { cookie: kv.jar.header(), origin: "https://evil.example" });
ok(
  "TI2 refus avant tout octet : pas un .psd (415), 400 Mo (413), thème inconnu (404) ; sans session refusé, autre origine 403",
  badExt.status === 415 && tooBig.status === 413 && noTheme.status === 404 && anonInit.status !== 200 && crossInit.status === 403,
  `${badExt.status} ${tooBig.status} ${noTheme.status} ${anonInit.status} ${crossInit.status}`,
);

// Signature invalide : un PNG légitime (ffmpeg) nommé .psd → refusé à la fin, sans job.
await sharp({ create: { width: 640, height: 360, channels: 3, background: "#6c8ebf" } }).png().toFile(src("pas-un-kit.png"));
const jobs0 = importJobs().length;
const notPsd = await kitUpload(readFileSync(src("pas-un-kit.png")), "pas-un-kit.psd");
ok("TI3 signature invalide (PNG nommé .psd) : 415, message clair, aucun job", notPsd.status === 415 && /pas un fichier Photoshop/.test(notPsd.body.message ?? "") && importJobs().length === jobs0, `${notPsd.status} ${notPsd.body.message}`);

// PSD légitime mais trop grand (ag-psd, 6000 × 6000) : refusé sur l'en-tête, avant décodage.
const bigPsd = Buffer.from(writePsdBuffer({ width: 6000, height: 6000, children: [{ name: "calque", left: 0, top: 0, right: 2, bottom: 2, imageData: { width: 2, height: 2, data: new Uint8ClampedArray(16).fill(255) } }] }, { noBackground: true }));
const big = await kitUpload(bigPsd, "trop-grand.psd");
ok("TI4 PSD de 6000 × 6000 : refusé avant décodage (422, dimensions), aucun job", big.status === 422 && /6000 × 6000/.test(big.body.message ?? "") && importJobs().length === jobs0, `${big.status} ${big.body.message}`);

// Fichier réel de l'artiste : import dans le processus enfant (bundle), manifeste du kit v1 d'origine.
mkdirSync(path.join(dirK, "cache", "kits", "manifests"), { recursive: true });
cpSync(path.join(ROOT, "tests/fixtures/kit-galerie-lumineuse-v1.manifest.json"), path.join(dirK, "cache", "kits", "manifests", "legacy-galerie-lumineuse-v1.json"));
const real = await kitUpload(fixturePsd, "kit-synthetique.psd");
const importId = real.body.kitImport?.id;
const st = await waitImport("galerie-lumineuse", importId);
const rapport = st.status === "done" ? rapportOf(dirK, importId) : null;
const redrawn = rapport?.slots.filter((x) => x.change === "redrawn").map((x) => x.id) ?? [];
const importLine = serverLog(kv.server, /\[kit\] import [^\n]+/g).pop() ?? "";
console.log(`      processus enfant (bundle kit-child.cjs) : ${importLine}`);
ok(
  "TI5 fichier réel de l'artiste : importé (file lourde, enfant), seule la flèche droite redessinée, PSD supprimé",
  real.status === 200 && st.status === "done" && redrawn.length === 1 && redrawn[0] === "icones/fleche-droite" && !readdirSync(path.join(dirK, "kit-imports", importId)).some((n) => /^source.*\.psd$/.test(n)),
  `${real.status} ${JSON.stringify(st)} ${redrawn.join(",")}`,
);
ok("TI5b processus enfant de l'import : pic mémoire sous 400 Mo, priorité OOM maximale (1000)", Number(/pic (\d+) Mo/.exec(importLine)?.[1] ?? 9999) < 400 && /oom 1000/.test(importLine), importLine);

// Gardes sur un import RÉEL : la ressource existe (200 avec session), refusée sans session.
const guarded = [`/admin/themes/galerie-lumineuse/kit?import=${importId}`, `/admin/api/theme-kit/galerie-lumineuse/import/${importId}`, `/admin/api/theme-kit/galerie-lumineuse/import/${importId}/preview/icones--fleche-droite/apres`];
const withSession = await Promise.all(guarded.map(async (u) => (await fetch(`${BASE}${u}`, { headers: { cookie: kv.jar.header() } })).status));
const anonymous = await Promise.all(guarded.map(async (u) => (await fetch(`${BASE}${u}`, { redirect: "manual" })).status));
// Cookie de session INVALIDE : franchit le proxy (cookie présent) ; seule la garde des routes refuse.
const badSession = new Jar();
badSession.cookies.set("__Secure-better-auth.session_token", "jeton-forge.signature");
badSession.cookies.set("better-auth.session_token", "jeton-forge.signature");
const withBadCookie = await Promise.all(guarded.map(async (u) => (await fetch(`${BASE}${u}`, { headers: { cookie: badSession.header() }, redirect: "manual" })).status));
ok("TI1b cookie de session invalide (proxy franchi) : écran, état et aperçu refusés par la garde des routes", withBadCookie.every((x) => x !== 200 && x < 500), withBadCookie.join(","));
const themesBefore = query(dirK, "select count(*) n from themes").n;
const forgedApply = await callActionJson(new Jar(), ids.applyKitImportAction, ["galerie-lumineuse", importId, { mirror: true }], "/admin/themes/galerie-lumineuse/kit");
ok(
  "TI1 import réel : écran, état et aperçu servis avec session, refusés sans ; application sans session refusée, aucun thème créé",
  withSession.every((x) => x === 200) && anonymous.every((x) => x === 307 || x === 403) && !forgedApply.text.includes('"ok":true') && query(dirK, "select count(*) n from themes").n === themesBefore,
  `${withSession.join(",")} / ${anonymous.join(",")} / ${forgedApply.status}`,
);

// Revue et aperçus (chemins calculés côté serveur).
const reviewHtml = await (await fetch(`${BASE}${guarded[0]}`, { headers: { cookie: kv.jar.header() } })).text();
const traversal = await Promise.all(
  [
    `/admin/api/theme-kit/galerie-lumineuse/import/${importId}/preview/..%2F..%2Fportfolio.db/apres`,
    `/admin/api/theme-kit/galerie-lumineuse/import/${importId}/preview/signature/..%2Fmeta`,
    `/admin/api/theme-kit/galerie-lumineuse/import/..%2F..%2Fetc/preview/signature/apres`,
  ].map(async (u) => (await fetch(`${BASE}${u}`, { headers: { cookie: kv.jar.header() } })).status),
);
ok(
  "TI6 revue : « Flèche droite : redessinée », « Plan 3 : inchangé », miroir proposé ; chemins forgés → 404",
  reviewHtml.includes("Flèche droite : redessinée") && reviewHtml.includes("Plan 3 : inchangé") && /Utiliser le miroir de ta (<!-- -->)?flèche droite/.test(reviewHtml) && traversal.every((x) => x === 404),
  traversal.join(","),
);

// IDOR entre thèmes : l'import de galerie-lumineuse n'existe pas pour « pro ».
const cross = await Promise.all(
  [`/admin/themes/pro/kit?import=${importId}`, `/admin/api/theme-kit/pro/import/${importId}`, `/admin/api/theme-kit/pro/import/${importId}/preview/icones--fleche-droite/apres`].map(
    async (u) => (await fetch(`${BASE}${u}`, { headers: { cookie: kv.jar.header() } })).status,
  ),
);
const crossApply = await callActionJson(kv.jar, ids.applyKitImportAction, ["pro", importId, { mirror: true }], "/admin/themes/pro/kit");
ok("TI8 import d'un autre thème : écran, état, aperçu 404 ; application refusée, aucun thème créé", cross.every((x) => x === 404) && !crossApply.text.includes('"ok":true') && query(dirK, "select count(*) n from themes").n === themesBefore, `${cross.join(",")} ${crossApply.text.slice(0, 80)}`);

// « Appliquer » : copie brouillon ; thème source et thème en ligne inchangés ; miroir.
const activeBefore = query(dirK, "select value from settings where key = 'activeThemeId'")?.value;
const sourceBefore = themeData("galerie-lumineuse");
const applied = await callActionJson(kv.jar, ids.applyKitImportAction, ["galerie-lumineuse", importId, { mirror: true }], `/admin/themes/galerie-lumineuse/kit`);
const draftId = /"id":"(mon-theme[a-z0-9-]*)"/.exec(applied.text)?.[1];
const draft = draftId ? JSON.parse(themeData(draftId)) : null;
const arrowUrl = draft?.assets?.kit?.icons?.arrowRight?.svg;
const served = arrowUrl ? await fetch(`${BASE}${arrowUrl}`) : null;
const leftUrl = draft?.assets?.kit?.icons?.arrowLeft?.svg;
const leftSvg = leftUrl ? await (await fetch(`${BASE}${leftUrl}`)).text() : "";
ok(
  "TI7 application : nouvelle version de Mon thème (brouillon, non active) avec la flèche de l'artiste et son miroir ; données du thème source et thème en ligne inchangés",
  Boolean(draftId) && draft.preset === false && served?.status === 200 && /svg/.test(served.headers.get("content-type") ?? "") && leftUrl !== arrowUrl && /matrix\(-1 0 0 1 128 0\)/.test(leftSvg) && themeData("galerie-lumineuse") === sourceBefore && query(dirK, "select value from settings where key = 'activeThemeId'")?.value === activeBefore,
  `${applied.text.slice(0, 120)} ${arrowUrl}`,
);

// Aller-retour sans fin : le kit de la copie contient la flèche de l'artiste ; réimporté tel quel → tout inchangé.
initializeCanvas(() => { throw new Error("canvas"); }, (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }));
/** Masque (128 × 128) du calque `name` d'une case ; `box` = coin de la case, `k` = taille de la case / 128. */
const caseMask = (psdBuf, name, box, k = 1) => {
  const doc = readPsd(psdBuf, { useImageData: true, skipCompositeImageData: true, skipThumbnail: true });
  const find = (list) => { for (const l of list ?? []) { if (l.name === name) return l; const f = find(l.children); if (f) return f; } return null; };
  const l = find(doc.children);
  const m = new Uint8Array(128 * 128);
  const d = l?.imageData;
  if (!d) return m;
  // Réduction par blocs : un pixel du masque est « plein » si le centre de son bloc l'est.
  for (let y = 0; y < d.height; y++) for (let x = 0; x < d.width; x++) {
    const cx = l.left + x - box.x;
    const cy = l.top + y - box.y;
    if (cx < 0 || cy < 0 || cx >= 128 * k || cy >= 128 * k || cx % k !== k >> 1 || cy % k !== k >> 1) continue;
    if (d.data[(y * d.width + x) * 4 + 3] > 127) m[Math.floor(cy / k) * 128 + Math.floor(cx / k)] = 1;
  }
  return m;
};
let draftReady = {};
for (let i = 0; i < 180 && !draftReady.ready; i++) {
  draftReady = await (await post(draftId)).json().catch(() => ({}));
  if (!draftReady.ready) await sleep(500);
}
const draftZip = Buffer.from(await (await fetch(kitUrl(draftId), { headers: { cookie: kv.jar.header() } })).arrayBuffer());
const draftIcons = unzipStored(draftZip)["3-icones-curseurs.psd"];
const theirs = caseMask(fixturePsd, "fleche-droite", { x: 2560, y: 1720 });
// Kit v4 : la flèche droite est dans une case de 512 × 512 en (620, 752).
const ours = caseMask(draftIcons, "Flèche droite", { x: 620, y: 752 }, 4);
let inter = 0;
let union = 0;
for (let i = 0; i < theirs.length; i++) {
  inter += theirs[i] & ours[i];
  union += theirs[i] | ours[i];
}
const iou = union ? inter / union : 0;
const again2 = await kitUpload(draftZip, `kit-${draftId}.zip`, draftId);
const st2 = await waitImport(draftId, again2.body.kitImport?.id);
const rap2 = st2.status === "done" ? rapportOf(dirK, again2.body.kitImport.id) : null;
ok(
  `TI9 kit (v4) de la copie : case « Flèche droite » = flèche de l'artiste dessinée en 512 × 512 (IoU ${iou.toFixed(3)}) ; archive réimportée telle quelle → ${rap2?.slots.length} éléments inchangés dans ${rap2?.files?.length} fichiers`,
  draftReady.ready && iou > 0.85 && rap2?.reference?.how === "identifiant" && rap2.slots.length === 17 && rap2.slots.every((x) => x.change === "unchanged") && rap2.files?.every((f) => f.received),
  `${JSON.stringify(draftReady)} ${rap2 && rap2.slots.filter((x) => x.change !== "unchanged").map((x) => x.id)}`,
);

// Kit v4 : un seul fichier de l'archive, puis deux fichiers d'un envoi groupé ; fichiers manquants dits.
const iconsOnly = await kitUpload(kitFiles["3-icones-curseurs.psd"], "peu-importe.psd");
const stIcons = await waitImport("galerie-lumineuse", iconsOnly.body.kitImport?.id);
const rapIcons = stIcons.status === "done" ? rapportOf(dirK, iconsOnly.body.kitImport.id) : null;
ok("TI12 un seul fichier du kit (nom quelconque) : reconnu par son contenu, les deux autres « pas envoyés »", rapIcons?.files?.map((f) => `${f.id}:${f.received}`).join(",") === "decor:false,logo:false,icones:true" && rapIcons.slots.length === 8, JSON.stringify(rapIcons?.files));
const bid = "0d3a7f10-2b6c-4a41-9c55-7e1f0a8d6b21";
const bInit = (name, size, last) => kitInit({ name, size, type: "image/vnd.adobe.photoshop", purpose: { kind: "kit", themeId: "galerie-lumineuse", batch: { id: bid, last } } });
const sendBatch = async (data, name, last) => {
  const init = await (await bInit(name, data.length, last)).json();
  for (let offset = 0; offset < data.length; ) {
    const part = data.subarray(offset, offset + 8 * 1024 * 1024);
    offset = (await (await fetch(`${BASE}/admin/api/upload/${init.upload.id}/chunk?offset=${offset}`, { method: "PUT", headers: { ...HK, "content-length": String(part.length) }, body: part })).json()).upload.offset;
  }
  const done = await fetch(`${BASE}/admin/api/upload/${init.upload.id}/complete`, { method: "POST", headers: HK });
  return { status: done.status, body: await done.json().catch(() => ({})) };
};
const jobsBeforeBatch = importJobs().length;
const bOne = await sendBatch(kitFiles["1-decor-accueil.psd"], "decor.psd", false);
const noJobYet = importJobs().length === jobsBeforeBatch;
const bTwo = await sendBatch(kitFiles["2-logo-papier.psd"], "logo.psd", true);
const stBatch = await waitImport("galerie-lumineuse", bid);
const rapBatch = stBatch.status === "done" ? rapportOf(dirK, bid) : null;
ok(
  "TI13 envoi groupé de deux PSD : le premier ne lance rien, le dernier lance UN import (décor et logo reçus, icônes « pas envoyé »)",
  bOne.status === 200 && noJobYet && bTwo.status === 200 && rapBatch?.files?.map((f) => `${f.id}:${f.received}`).join(",") === "decor:true,logo:true,icones:false" && rapBatch.slots.length === 9 && importJobs().length === jobsBeforeBatch + 1,
  `${bOne.status} ${bTwo.status} ${JSON.stringify(rapBatch?.files)}`,
);
const closed = await sendBatch(kitFiles["3-icones-curseurs.psd"], "icones.psd", true);
ok("TI14 lot refermé : un fichier de plus est refusé (409)", closed.status === 409, `${closed.status} ${closed.body.message}`);

// Kit d'un autre thème : le fichier de galerie-lumineuse envoyé pour « pro ».
const foreignUp = await kitUpload(fixturePsd, "kit-synthetique.psd", "pro");
const st3 = await waitImport("pro", foreignUp.body.kitImport?.id);
const rap3 = st3.status === "done" ? rapportOf(dirK, foreignUp.body.kitImport.id) : null;
const foreignHtml = rap3 ? await (await fetch(`${BASE}/admin/themes/pro/kit?import=${foreignUp.body.kitImport.id}`, { headers: { cookie: kv.jar.header() } })).text() : "";
ok(
  "TI10 kit d'un autre thème : signalé (« Ce kit vient du thème … »), reconnu, appliqué à Mon thème (phrase « Le kit s'applique à : … » affichée, plus de choix du thème visé)",
  rap3?.reference?.themeId === "galerie-lumineuse" && rap3?.foreign?.themeId === "galerie-lumineuse" && rap3.slots.filter((x) => x.change === "redrawn").length === 1 && /Ce kit vient du thème/.test(foreignHtml) && /data-testid="kit-base"/.test(foreignHtml) && !/data-testid="kit-base-select"/.test(foreignHtml),
  JSON.stringify({ st3, ref: rap3?.reference, foreign: rap3?.foreign }),
);

// File lourde exclusive : un import demandé pendant une conversion vidéo attend sa fin.
// Vidéo distincte (contenu différent) : celle de TK7 ne doit pas être reconnue comme déjà convertie.
ff(["-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30", "-f", "lavfi", "-i", "sine=frequency=330", "-t", "20", "-c:v", "libx264", "-preset", "ultrafast", "-threads", "2", "-x264-params", "rc-lookahead=10:sync-lookahead=0", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", src("hd-20s-import.mp4")]);
const hdI = await chunked(kv.jar, src("hd-20s-import.mp4"), "exclusive-import.mp4", "video/mp4", { chunk: 8 * 1024 * 1024 });
const videoJobI = () => query(dirK, "select status from jobs where kind = 'video' and media_id = ?", hdI.body.media?.id)?.status;
for (let i = 0; i < 100 && videoJobI() !== "running"; i++) await sleep(100);
const exclUp = await kitUpload(fixturePsd, "kit-pendant-video.psd");
const exclId = exclUp.body.kitImport?.id;
const seenI = [];
for (let i = 0; i < 600; i++) {
  const j = importJobs().find((x) => x.payload?.includes(exclId ?? "§"));
  seenI.push(`${videoJobI()}/${j?.status}`);
  if (j?.status === "done" || j?.status === "failed") break;
  await sleep(250);
}
ok(
  "TI11 file lourde : l'import demandé pendant une conversion vidéo attend sa fin (jamais les deux à la fois)",
  exclUp.status === 200 && seenI.some((x) => x === "running/queued") && !seenI.some((x) => x === "running/running") && seenI.at(-1)?.endsWith("/done"),
  `${seenI[0]} … ${seenI.at(-1)} (${seenI.length})`,
);

// File lourde exclusive : un export demandé pendant une conversion vidéo attend sa fin.
const hdK = await chunked(kv.jar, src("hd-20s.mp4"), "exclusive.mp4", "video/mp4", { chunk: 8 * 1024 * 1024 });
const videoJob = () => query(dirK, "select status from jobs where kind = 'video' and media_id = ?", hdK.body.media?.id)?.status;
for (let i = 0; i < 100 && videoJob() !== "running"; i++) await sleep(100);
const asked = await (await post("pro")).json();
const seen = [];
for (let i = 0; i < 400; i++) {
  const kitStatus = kitJobs().filter((j) => j.payload?.includes('"pro"')).pop()?.status;
  seen.push(`${videoJob()}/${kitStatus}`);
  if (kitStatus === "done") break;
  await sleep(250);
}
const overlap = seen.some((s) => s === "running/running");
const waited = seen.some((s) => s === "running/queued");
// Le kit démarre (ou finit, entre deux relevés) après la fin de la vidéo.
const videoDone = seen.findIndex((s) => !s.startsWith("running/"));
const kitStarted = seen.findIndex((s) => /\/(running|done)$/.test(s));
const order = videoDone >= 0 && kitStarted >= videoDone;
ok(
  "TK7 file lourde : l'export demandé pendant une conversion vidéo attend sa fin (jamais les deux à la fois)",
  asked.ok && !asked.ready && hdK.status === 200 && waited && !overlap && order && seen.at(-1)?.endsWith("/done"),
  `${seen[0]} … ${seen.at(-1)} (${seen.length} relevés)`,
);

// Purge : motif exact (thèmes au préfixe commun), manifestes et aperçus du thème supprimé.
const cacheDir = path.join(dirK, "cache", "kits");
const mine = `${copyId}-aaaaaaaaaaaa-v2.psd`;
const neighbour = `${copyId}-2-bbbbbbbbbbbb-v2.psd`;
writeFileSync(path.join(cacheDir, mine), "x");
writeFileSync(path.join(cacheDir, neighbour), "x");
writeFileSync(path.join(cacheDir, "manifests", "k2-0123456789ab.json"), JSON.stringify({ exportId: "k2-0123456789ab", themeId: copyId, themeVersion: "x", kitVersion: 2, slots: {} }));
writeFileSync(path.join(cacheDir, "manifests", "k2-0123456789ab--signature.png"), "x");
const del = await callActionJson(kv.jar, ids.deleteThemeAction, [copyId], "/admin/themes");
ok(
  "TK8 suppression d'un thème : ses kits, manifestes et aperçus purgés ; un thème au préfixe commun intact",
  del.text.includes('"ok":true') && !existsSync(path.join(cacheDir, mine)) && existsSync(path.join(cacheDir, neighbour)) && !existsSync(path.join(cacheDir, "manifests", "k2-0123456789ab.json")) && !existsSync(path.join(cacheDir, "manifests", "k2-0123456789ab--signature.png")),
  del.text.slice(0, 100),
);

await stop(kv.server);
}

// ---- Phase 6d : plafond mémoire de l'enfant, reprise au redémarrage ---------------------
{
console.log("\n== TM. kit : plafond mémoire, redémarrage");
const dirM = `${TMP}/vkitmem`;
// Plafond abaissé à 60 Mo : l'import du fichier réel (≈ 150 Mo) le dépasse.
const km = await freshAdmin(dirM, { KIT_CHILD_MAX_RSS_MB: "60" });
const HM = { cookie: km.jar.header(), origin: BASE };
const data = readFileSync(path.join(ROOT, "tests/fixtures/kit-synthetique.psd"));
const init = await (await fetch(`${BASE}/admin/api/upload/init`, { method: "POST", headers: { ...HM, "content-type": "application/json" }, body: JSON.stringify({ name: "kit.psd", size: data.length, type: "x", purpose: { kind: "kit", themeId: "galerie-lumineuse" } }) })).json();
for (let offset = 0; offset < data.length; ) {
  const part = data.subarray(offset, offset + 8 * 1024 * 1024);
  offset = (await (await fetch(`${BASE}/admin/api/upload/${init.upload.id}/chunk?offset=${offset}`, { method: "PUT", headers: { ...HM, "content-length": String(part.length) }, body: part })).json()).upload.offset;
}
const comp = await (await fetch(`${BASE}/admin/api/upload/${init.upload.id}/complete`, { method: "POST", headers: HM })).json();
const mid = comp.kitImport?.id;
let job = null;
for (let i = 0; i < 240; i++) {
  job = new Database(path.join(dirM, "portfolio.db"), { readonly: true }).prepare("select status, error, attempts from jobs where kind = 'kit-import'").get();
  if (job?.status === "failed" || job?.status === "done") break;
  await sleep(250);
}
await sleep(500);
const children = spawnSync("pgrep", ["-f", "kit-child.cjs"], { encoding: "utf8" }).stdout.trim();
ok(
  "TM1 plafond mémoire de l'enfant dépassé : job en échec, message lisible, plus aucun processus, PSD supprimé",
  job?.status === "failed" && /trop de mémoire|trop lourd à analyser/.test(job.error ?? "") && children === "" && !existsSync(path.join(dirM, "kit-imports", mid, "source.psd")),
  `${JSON.stringify(job)} pids=[${children}] ${serverLog(km.server, /\[kit\] import [^\n]+/g).pop() ?? ""}`,
);
// Reprise : un import et un export restés « running » (serveur tombé) → en échec, sans nouvel essai, PSD supprimé.
await stop(km.server);
const rid = "11111111-2222-4333-8444-555555555555";
mkdirSync(path.join(dirM, "kit-imports", rid), { recursive: true });
writeFileSync(path.join(dirM, "kit-imports", rid, "meta.json"), JSON.stringify({ id: rid, themeId: "galerie-lumineuse", userId: "x", fileName: "kit.psd", size: data.length, createdAt: new Date().toISOString() }));
cpSync(path.join(ROOT, "tests/fixtures/kit-synthetique.psd"), path.join(dirM, "kit-imports", rid, "source.psd"));
writeDb(dirM, "insert into jobs (kind, payload, status, attempts) values ('kit-import', ?, 'running', 1)", JSON.stringify({ importId: rid, themeId: "galerie-lumineuse" }));
writeDb(dirM, "insert into jobs (kind, payload, status, attempts) values ('kit', ?, 'running', 1)", JSON.stringify({ themeId: "pro", version: "000000000000" }));
const km2 = await freshAdmin(dirM, {});
await sleep(3000);
const after = new Database(path.join(dirM, "portfolio.db"), { readonly: true }).prepare("select kind, status, error from jobs where status in ('running','queued','failed') and kind in ('kit','kit-import') order by id desc limit 2").all();
ok(
  "TM2 redémarrage : import et export de kit restés « running » → en échec lisible, sans nouvel essai, PSD supprimé",
  after.length === 2 && after.every((j) => j.status === "failed" && /interrompu/.test(j.error ?? "")) && !existsSync(path.join(dirM, "kit-imports", rid, "source.psd")),
  JSON.stringify(after),
);
await stop(km2.server);
}

// ---- v0.14 : export / import de thème (route mutante gardée, archive bornée) ---------------
{
console.log("\n== TH. thèmes : export et import d'archive");
const { lowContrastPackage, lowContrastScrimPackage, maliciousPackages, maliciousRichPackages, richPackage, validPackage } = await import("./lib/theme-packages.mjs");
const { loadPreset, presetSlugs } = await import("./lib/presets.mjs");
const dirT = `${TMP}/vtheme`;
const tv = await freshAdmin(dirT);
const HT = { cookie: tv.jar.header(), origin: BASE };
const importZip = (zip, headers = HT) => {
  const form = new FormData();
  form.append("file", new Blob([zip], { type: "application/zip" }), "theme.zip");
  return fetch(`${BASE}/admin/api/themes/import`, { method: "POST", body: form, headers, redirect: "manual" });
};
const themeCount = () => query(dirT, "select count(*) n from themes").n;
const base = await loadPreset("galerie-lumineuse");
const valid = validPackage(base, "Thème importé (test-auth)");

// Garde : sans session, autre origine, export sans session.
const anonImport = await importZip(valid.zip, {});
const foreignImport = await importZip(valid.zip, { cookie: tv.jar.header(), origin: "https://evil.example" });
const anonExport = await fetch(`${BASE}/admin/api/themes/galerie-lumineuse/export`, { redirect: "manual" });
ok(
  "TH1 sans session : import et export refusés ; autre origine : 403 ; aucun thème créé",
  anonImport.status >= 300 && anonImport.status !== 200 && foreignImport.status === 403 && anonExport.status >= 300 && anonExport.status !== 200 && themeCount() === presetSlugs().length,
  `${anonImport.status} ${foreignImport.status} ${anonExport.status} (${themeCount()} thèmes)`,
);
const before = themeCount();

// Export : ZIP en pièce jointe, identifiant invalide → 404.
const exp = await fetch(`${BASE}/admin/api/themes/galerie-lumineuse/export`, { headers: { cookie: tv.jar.header() } });
const expBody = Buffer.from(await exp.arrayBuffer());
const badIds = await Promise.all(["inconnu", "..%2F..%2Fetc", "A_MAJ"].map(async (id) => (await fetch(`${BASE}/admin/api/themes/${id}/export`, { headers: { cookie: tv.jar.header() } })).status));
ok("TH2b export de thème journalisé (téléchargement, cible)", logRows(dirT, "action = 'download:theme-export' and target = 'galerie-lumineuse' and user is not null").length >= 1);
ok("TH2 export : ZIP (theme.json) en pièce jointe ; identifiant inconnu ou invalide → 404", exp.status === 200 && expBody.subarray(0, 4).toString("hex") === "504b0304" && expBody.includes("theme.json") && /attachment; filename="theme-galerie-lumineuse\.zip"/.test(exp.headers.get("content-disposition") ?? "") && badIds.every((s) => s === 404), `${exp.status} ${badIds}`);

// Ré-import de l'export brut : copie « (importé) », non livrée, non active.
const reimport = await importZip(expBody);
const reBody = await reimport.json().catch(() => ({}));
const reRow = reBody.theme && query(dirT, "select preset, name from themes where id = ?", reBody.theme.id);
const active = JSON.parse(query(dirT, "select value from settings where key = 'activeThemeId'").value);
ok("TH3 ré-import d'un export : nouveau thème non livré, renommé, jamais mis en ligne", reimport.status === 200 && reRow?.preset === 0 && /\(importé\)/.test(reRow?.name ?? "") && active !== reBody.theme?.id, JSON.stringify(reBody));

// Import avec élément dessiné : rangé sous /media/kit, servi avec la CSP sandbox.
const imp = await importZip(valid.zip);
const kit = await fetch(BASE + valid.kitPath);
ok("TH4 import avec élément dessiné (SVG) : thème créé, asset servi (image/svg+xml, CSP sandbox)", imp.status === 200 && kit.status === 200 && kit.headers.get("content-type") === "image/svg+xml" && /sandbox/.test(kit.headers.get("content-security-policy") ?? ""), `${imp.status} ${kit.status}`);

// Lots 2 et 4 transportés : curseurs PNG, palette (auto recalculée), mise en page, typographie.
const rich = await richPackage(base, "Thème riche (test-auth)");
const richImp = await importZip(rich.zip);
const richBody = await richImp.json().catch(() => ({}));
const richRow = richBody.theme && JSON.parse(query(dirT, "select data from themes where id = ?", richBody.theme.id).data);
const cur = await fetch(BASE + rich.cursorPath);
ok(
  "TH4b import : curseurs PNG rangés et servis (image/png), nuance auto recalculée (jamais la valeur de l'archive), layout et typographie gardés",
  richImp.status === 200 && cur.status === 200 && cur.headers.get("content-type") === "image/png" && richRow?.tokens.color.primaryHover !== "#00ff00" && richRow?.tokens.palette?.auto?.[0] === "primaryHover" && richRow?.tokens.layout?.heroRoleBackdrop === "band" && richRow?.tokens.type?.caption?.case === "upper" && richRow?.assets.kit?.cursors?.default?.x === 2,
  `${richImp.status} ${cur.status} ${richRow?.tokens.color.primaryHover}`,
);
const richExp = richBody.theme && (await fetch(`${BASE}/admin/api/themes/${richBody.theme.id}/export`, { headers: { cookie: tv.jar.header() } }));
const richZip = richExp ? Buffer.from(await richExp.arrayBuffer()) : Buffer.alloc(0);
ok("TH4c export d'un thème à curseurs : les deux PNG sont dans l'archive", richExp?.status === 200 && richZip.includes(`assets/${path.basename(rich.cursorPath)}`) && (richZip.toString("latin1").match(/assets\/[0-9a-f]{16}\.png/g) ?? []).length >= 2, `${richExp?.status}`);

// Contraste insuffisant (texte secondaire = fond) : l'import est accepté (v0.21.1), la couleur est gardée telle quelle.
const low = await importZip(lowContrastPackage(base));
const lowBody = await low.json().catch(() => ({}));
const lowRow = lowBody.theme && JSON.parse(query(dirT, "select data from themes where id = ?", lowBody.theme.id).data);
ok("TH4d import d'un thème au contraste insuffisant : accepté (pas de refus pour contraste), couleur gardée", low.status === 200 && lowBody.ok !== false && lowRow?.tokens.color.inkSoft === base.tokens.color.bg, `${low.status} ${JSON.stringify(lowBody).slice(0, 200)}`);

const lowScrim = await importZip(lowContrastScrimPackage(base));
const lowScrimBody = await lowScrim.json().catch(() => ({}));
ok("TH4e import d'un thème au voile illisible (palette) : accepté, pas de refus pour contraste", lowScrim.status === 200 && lowScrimBody.ok !== false && Boolean(lowScrimBody.theme), `${lowScrim.status} ${JSON.stringify(lowScrimBody).slice(0, 200)}`);

// Archives malveillantes : toutes refusées, avec le bon message, sans rien créer ni écrire.
const mid = themeCount();
const kitDirBefore = existsSync(path.join(dirT, "media", "kit")) ? readdirSync(path.join(dirT, "media", "kit")).length : 0;
for (const [label, zip, pattern] of [...maliciousPackages(base), ...(await maliciousRichPackages(base))]) {
  const r = await importZip(zip);
  const b = await r.json().catch(() => ({}));
  ok(`TH5 refusé : ${label}`, r.status >= 400 && r.status < 500 && b.ok === false && pattern.test(b.message ?? ""), `${r.status} ${b.message}`);
}
const kitDirAfter = existsSync(path.join(dirT, "media", "kit")) ? readdirSync(path.join(dirT, "media", "kit")).length : 0;
ok("TH6 aucune archive malveillante n'a créé de thème ni écrit d'asset ; aucun fichier hors du dossier de données", themeCount() === mid && kitDirAfter === kitDirBefore && !existsSync("/tmp/pwn.txt"), `${themeCount()}/${mid} ${kitDirAfter}/${kitDirBefore}`);

// Taille : refus avant lecture (Content-Length) et pendant le flux.
const huge = await rawPost("/admin/api/themes/import", { cookie: tv.jar.header(), origin: BASE, "content-type": "multipart/form-data; boundary=x", "content-length": String(200 * 1024 * 1024) }, Buffer.from("--x\r\n"));
const big = Buffer.alloc(13 * 1024 * 1024, 1);
const streamed = await importZip(big);
const tmpLeft = existsSync(path.join(dirT, "tmp")) ? readdirSync(path.join(dirT, "tmp")).filter((f) => f.startsWith("upload-")).length : 0;
ok("TH7 archive de plus de 12 Mo refusée (413), annoncée ou en flux ; fichier temporaire supprimé", huge.status === 413 && streamed.status === 413 && tmpLeft === 0, `${huge.status} ${streamed.status} tmp=${tmpLeft}`);
ok("TH8 thèmes créés : exactement les cinq imports acceptés (export ré-importé, SVG, riche, contraste faible, voile faible)", themeCount() === before + 5, `${themeCount()} vs ${before + 5}`);
await stop(tv.server);
}

// ---- Lot médias : PDF du bloc CV (envoi, aperçu, téléchargement en pièce jointe) ----------
{
console.log("\n== PDF. CV : envoi gardé, signature, pages, aperçu isolé, téléchargement");
const { textPdf, scriptedPdf, imageBombPdf } = await import("./lib/pdf-fixtures.mjs");
const dirP = `${TMP}/pdf`;
const p = await freshAdmin(dirP);
const jp = p.jar;
const tmpCount = () => (existsSync(path.join(dirP, "tmp")) ? readdirSync(path.join(dirP, "tmp")).filter((n) => !n.startsWith("uploads")).length : 0);
const cv = textPdf(2);
let r = await upload(new Jar(), "cv.pdf", "application/pdf", cv);
ok("PDF1 envoi d'un PDF sans session → 403, aucune ligne", r.status === 403 && query(dirP, "select count(*) n from media where kind = 'pdf'").n === 0, String(r.status));
r = await upload(jp, "cv.pdf", "application/pdf", cv, { origin: "https://site-malveillant.example" });
ok("PDF2 envoi depuis une autre origine → 403", r.status === 403, String(r.status));
r = await upload(jp, "Mon CV privé.pdf", "application/pdf", cv);
const pdfId = r.json?.media?.id;
const row = pdfId ? await waitMedia(dirP, pdfId, 120000) : null;
const files = row?.variants ? JSON.parse(row.variants).files : [];
const docKey = files.find((f) => f.format === "pdf")?.key;
const pages = [...new Set(files.filter((f) => f.page).map((f) => f.page))];
ok("PDF3 PDF de 2 pages : accepté (type lu dans le fichier), traité, 2 pages en AVIF + WebP, copie téléchargeable", r.status === 200 && r.json.media.kind === "pdf" && row?.status === "ready" && pages.length === 2 && files.filter((f) => f.format === "avif").length === 4 && Boolean(docKey), `${r.status} ${row?.status} ${row?.error ?? ""} ${files.length}`);
const orig = query(dirP, "select key from media where id = ?", pdfId)?.key;
ok("PDF4 original (originals/…pdf) jamais servi", orig?.startsWith("originals/") && (await http(`/media/${orig}`)).status === 404, orig);
const dl = await http(`/media/${docKey}?name=cv-camille`);
const dlBytes = Buffer.from(await dl.arrayBuffer());
const h = (n) => dl.headers.get(n) ?? "";
ok(
  "PDF5 téléchargement : 200, application/pdf, Content-Disposition attachment (nom propre), nosniff, CSP sandbox, X-Frame-Options DENY, octets d'origine",
  dl.status === 200 && h("content-type") === "application/pdf" && h("content-disposition") === 'attachment; filename="cv-camille.pdf"' && h("x-content-type-options") === "nosniff" && /sandbox/.test(h("content-security-policy")) && h("x-frame-options") === "DENY" && dlBytes.equals(cv),
  `${dl.status} ${h("content-type")} | ${h("content-disposition")} | ${h("x-frame-options")}`,
);
const evil = await http(`/media/${docKey}?name=${encodeURIComponent('../../x"\r\nSet-Cookie: a=1')}`);
ok("PDF6 nom piégé (chemin, guillemet, CRLF) → réduit à [a-z0-9-], pas d'en-tête injecté", evil.status === 200 && evil.headers.get("content-disposition") === 'attachment; filename="x-set-cookie-a-1.pdf"' && !evil.headers.get("set-cookie"), evil.headers.get("content-disposition") ?? "");
const plain = await http(`/media/${docKey}`);
ok("PDF7 sans nom → « cv.pdf », toujours en pièce jointe (jamais affiché sur l'origine du site)", plain.headers.get("content-disposition") === 'attachment; filename="cv.pdf"');
const pageKey = files.find((f) => f.page === 2 && f.format === "webp")?.key;
const pg = await http(`/media/${pageKey}`);
ok("PDF8 image de page : servie en image/webp, sans pièce jointe", pg.status === 200 && pg.headers.get("content-type") === "image/webp" && !pg.headers.get("content-disposition"), `${pg.status} ${pg.headers.get("content-type")}`);
ok("PDF9 clés voisines inventées → 404", (await http(`/media/${docKey.replace("document.pdf", "autre.pdf")}`)).status === 404 && (await http(`/media/${docKey.replace("document.pdf", "p3-1600.webp")}`)).status === 404);
const html = await (await http("/fr")).text();
ok("PDF10 le nom du fichier envoyé n'atteint pas le site", !html.includes("Mon CV privé"));

const before = query(dirP, "select count(*) n from media").n;
r = await upload(jp, "long.pdf", "application/pdf", textPdf(11));
ok("PDF11 11 pages → refusé (422, nombre de pages), aucune ligne, aucun fichier temporaire", r.status === 422 && /11 pages/.test(r.json?.message ?? "") && query(dirP, "select count(*) n from media").n === before && tmpCount() === 0, `${r.status} ${r.json?.message ?? ""} tmp=${tmpCount()}`);
r = await upload(jp, "poly.pdf", "application/pdf", Buffer.concat([Buffer.from("<html><script>alert(1)</script>\n"), cv]));
ok("PDF12 en-tête %PDF- précédé d'octets (polyglotte HTML/PDF) → refusé (415)", r.status === 415, `${r.status} ${r.json?.message ?? ""}`);
r = await upload(jp, "faux.pdf", "application/pdf", Buffer.from("%PDF-1.7\nceci n'est pas un pdf\n"));
ok("PDF13 PDF illisible → refusé à l'envoi (422, message clair)", r.status === 422 && /pas pu être lu/.test(r.json?.message ?? ""), `${r.status} ${r.json?.message ?? ""}`);
const big = Buffer.concat([cv, Buffer.from(`%${"x".repeat(1024 * 1024 - 2)}\n`.repeat(16))]);
r = await upload(jp, "lourd.pdf", "application/pdf", big);
ok("PDF14 PDF de 17 Mo (envoi simple) → 413 (15 Mo au plus)", r.status === 413 && /15 Mo/.test(r.json?.message ?? ""), `${r.status} ${r.json?.message ?? ""}`);
const init = await fetch(`${BASE}/admin/api/upload/init`, { method: "POST", headers: { cookie: jp.header(), origin: BASE, "content-type": "application/json" }, body: JSON.stringify({ name: "lourd.pdf", size: big.length, type: "application/pdf" }) });
ok("PDF15 PDF de 17 Mo annoncé (envoi par morceaux) → 413 dès l'annonce", init.status === 413, String(init.status));
const midPdf = Buffer.concat([textPdf(1), Buffer.from(`%${"y".repeat(1024 * 1024 - 2)}\n`.repeat(9))]);
writeFileSync(`${TMP}/morceaux.pdf`, midPdf);
const ch = await chunked(jp, `${TMP}/morceaux.pdf`, "morceaux.pdf", "application/pdf", { chunk: 8 * 1024 * 1024 });
const chRow = ch.body.media?.id ? await waitMedia(dirP, ch.body.media.id, 120000) : null;
ok("PDF16 PDF de 9 Mo par morceaux → reconnu à la fin (signature), traité", ch.status === 200 && ch.body.media?.kind === "pdf" && chRow?.status === "ready", `${ch.stage} ${ch.status} ${chRow?.status} ${chRow?.error ?? ""}`);
r = await upload(jp, "script.pdf", "application/pdf", scriptedPdf());
const jsRow = r.json?.media?.id ? await waitMedia(dirP, r.json.media.id, 120000) : null;
ok("PDF17 PDF avec JavaScript (OpenAction) → accepté et rendu en images, rien d'exécuté (poppler n'a pas de moteur JS)", r.status === 200 && jsRow?.status === "ready", `${r.status} ${jsRow?.status} ${jsRow?.error ?? ""}`);
const bombBuf = await imageBombPdf(30000);
const memBefore = procMem(p.server.child.pid);
const t0 = Date.now();
r = await upload(jp, "bombe.pdf", "application/pdf", bombBuf);
const bombRow = r.json?.media?.id ? await waitMedia(dirP, r.json.media.id, 180000) : null;
const memAfter = procMem(p.server.child.pid);
const left = spawnSync("pgrep", ["-x", "pdftoppm"], { encoding: "utf8" }).stdout.trim();
const bombLog = serverLog(p.server, /\[jobs\] PDF \d+[^\n]+/g).pop() ?? "";
ok(
  `PDF18 bombe de décompression (${(bombBuf.length / 1024 / 1024).toFixed(1)} Mo → 900 Mo décodés) : rendu borné (prêt sous le plafond, ou échec lisible), serveur VmHWM ${memBefore.hwm} → ${memAfter.hwm} Mo, plus aucun pdftoppm`,
  r.status === 200 && (bombRow?.status === "ready" || /trop lourd|n'a pas pu/.test(bombRow?.error ?? "")) && memAfter.hwm - memBefore.hwm < 150 && left === "" && Date.now() - t0 < 150000,
  `${r.status} ${bombRow?.status} ${bombRow?.error ?? ""} | ${bombLog} | ${Math.round((Date.now() - t0) / 1000)} s`,
);
console.log(`      bombe : ${bombRow?.status} en ${Math.round((Date.now() - t0) / 1000)} s — ${bombLog || bombRow?.error}`);
await stop(p.server);
}

// ---- Mesures : durée de conversion, VmHWM du serveur, pic et CPU de ffmpeg ---------------
console.log("      (génération des sources de mesure : 1080p 60 s avec son, 4K 20 s, boucle 720p 4 s)");
ff(["-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30", "-f", "lavfi", "-i", "sine=frequency=330", "-t", "60", "-c:v", "libx264", "-preset", "ultrafast", "-threads", "2", "-x264-params", "rc-lookahead=10:sync-lookahead=0", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", src("m-1080p-60s.mp4")]);
ff(["-f", "lavfi", "-i", "testsrc2=size=3840x2160:rate=30", "-t", "20", "-c:v", "libx264", "-preset", "ultrafast", "-threads", "2", "-x264-params", "rc-lookahead=10:sync-lookahead=0", "-crf", "22", "-pix_fmt", "yuv420p", src("m-4k-20s.mp4")]);
for (const [label, file] of [
  ["1080p, 60 s, avec son", "m-1080p-60s.mp4"],
  ["4K, 20 s", "m-4k-20s.mp4"],
  ["boucle 720p, 4 s, sans son", "boucle-720.mp4"],
]) {
  const dir = `${TMP}/vm-${file}`;
  const m = await freshAdmin(dir);
  await http("/fr");
  const before = procMem(m.server.child.pid);
  const t0 = Date.now();
  const res = await chunked(m.jar, src(file), file, "video/mp4", { chunk: 8 * 1024 * 1024 });
  const row = res.body.media?.id ? await waitMedia(dir, res.body.media.id, 900000) : null;
  const after = procMem(m.server.child.pid);
  // Le statut « ready » est écrit avant la ligne de journal : on l'attend (3 s au plus).
  let line = "";
  for (let i = 0; i < 30 && !/ffmpeg pic/.test(line); i++) {
    line = serverLog(m.server, /vidéo \d+ convertie en [^\n]+/g).pop() ?? "";
    if (!/ffmpeg pic/.test(line)) await sleep(100);
  }
  const loopFlag = row && query(dir, "select has_audio a, duration d from media where id = ?", res.body.media.id);
  console.log(`      ${label} (${(statSize(src(file)) / 1024 / 1024).toFixed(1)} Mo, envoi + conversion ${((Date.now() - t0) / 1000).toFixed(0)} s) : ${line}`);
  console.log(`        VmHWM du serveur ${before.hwm} → ${after.hwm} Mo (+${after.hwm - before.hwm}) ; son : ${loopFlag?.a ? "oui" : "non"}, durée ${loopFlag?.d?.toFixed(1)} s`);
  const ffPeak = Number(/ffmpeg pic (\d+) Mo/.exec(line)?.[1] ?? 9999);
  ok(`VM ${label} : convertie, pic du serveur ${after.hwm} Mo et de ffmpeg ${ffPeak} Mo, tous deux sous 600 Mo`, row?.status === "ready" && after.hwm < 600 && ffPeak < 600, `${res.status} ${row?.status} ${row?.error ?? ""}`);
  await stop(m.server);
}

rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\nECHECS : ${failures}` : "\nTOUT PASSE");
process.exit(failures ? 1 : 0);
