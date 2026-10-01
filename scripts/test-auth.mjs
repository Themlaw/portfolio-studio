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
 * Usage : npm run test:auth   (exit 1 si un test échoue)
 */
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import sharp from "sharp";
import { createDeflate } from "node:zlib";
import { request as httpRequest } from "node:http";
import { utimesSync, writeFileSync } from "node:fs";
import { OAuth2Server } from "oauth2-mock-server";

const ROOT = new URL("..", import.meta.url).pathname;
const SA = path.join(ROOT, ".next/standalone");
const TMP = "/tmp/portfolio-test-auth";
const PORT = 3200;
const MOCK_PORT = 3290;
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
function startServer(dataDir, env) {
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
  child.stdout.on("data", (d) => logs.push(String(d)));
  child.stderr.on("data", (d) => logs.push(String(d)));
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  const ready = (async () => {
    for (let i = 0; i < 60; i++) {
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

/** Server actions de l'admin (même liste que scripts/test-admin-guard.mjs). */
const ADMIN_ACTIONS = [
  "signOutAction",
  "duplicateThemeAction",
  "saveThemeAction",
  "activateThemeAction",
  "deleteThemeAction",
  "saveSettingsAction",
  "createPageAction",
  "savePageAction",
  "setPublishedAction",
  "setInMenuAction",
  "reorderMenuAction",
  "deletePageAction",
  "createProjectAction",
  "saveProjectAction",
  "reorderProjectsAction",
  "deleteProjectAction",
  "addSlotsAction",
  "saveSlotAction",
  "setSlotMediaAction",
  "deleteSlotAction",
  "reorderSlotsAction",
  "saveMediaAltAction",
  "deleteMediaAction",
  "mediaStatusAction",
  "mediaUsesAction",
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
    r.headers.get("content-security-policy") === "frame-ancestors 'none'" &&
    r.headers.get("referrer-policy") === "strict-origin-when-cross-origin" &&
    r.headers.get("x-content-type-options") === "nosniff" &&
    (r.headers.get("permissions-policy") ?? "").includes("camera=()") &&
    !r.headers.get("x-powered-by"),
);
const mediaKey = (await (await http("/fr/personnages")).text()).match(/\/media\/[a-z0-9-]+\.svg/)?.[0];
r = await http(mediaKey);
ok("A2f /media garde sa CSP (sandbox) et XFO", (r.headers.get("content-security-policy") ?? "").includes("sandbox") && r.headers.get("x-frame-options") === "DENY");

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

ok("A6a identifiant de la server action de déconnexion trouvé", Boolean(ids.signOutAction), Object.keys(ids).join(","));
const forged = new Jar();
forged.cookies.set("__Secure-better-auth.session_token", "jeton-forge.signature");
const actionHeaders = { "next-action": ids.signOutAction, "content-type": "text/plain;charset=UTF-8", origin: BASE };
r = await http("/admin", { jar: forged, method: "POST", headers: actionHeaders, raw: "[]" });
ok("A6 server action avec un cookie forgé (proxy franchi) → 403", r.status === 403, String(r.status));
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
r = await postForm(jar, "/admin/apercu", { id: "pro" });
ok("A7b aperçu (formulaire natif) → 303 /fr + draft mode", r.status === 303 && r.headers.get("location") === "/fr" && jar.cookies.has("__prerender_bypass") && jar.cookies.get("theme-preview") === "pro", `${r.status} ${r.headers.get("location")}`);
r = await http("/fr", { jar });
const previewHtml = await r.text();
ok("A7c l'admin voit l'aperçu (pro) et le bandeau", previewHtml.includes('data-theme="pro"') && /class="preview-banner"[\s\S]*Aperçu : <strong>Pro<\/strong>/.test(previewHtml));
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
  "A8b quitter l'aperçu depuis le bandeau → retour sur la page, draft mode coupé",
  r.status === 303 && r.headers.get("location") === "/fr/personnages" && !jar.cookies.has("__prerender_bypass") && !jar.cookies.has("theme-preview"),
  `${r.status} ${r.headers.get("location")}`,
);
// Server actions des éditeurs (phase 4a) : refus sans session, puis
// validation serveur des charges invalides (client contourné).
for (const name of ADMIN_ACTIONS.filter((n) => n !== "signOutAction")) {
  ok(`A10 ${name} : identifiant trouvé`, Boolean(ids[name]));
  if (!ids[name]) continue;
  // Une action se résout depuis une page qui l'importe : on vise son écran.
  const screen =
    name === "saveThemeAction" ? "/admin/themes/galerie-lumineuse"
    : name === "savePageAction" ? "/admin/pages/1"
    : /Theme/.test(name) ? "/admin/themes"
    : /Settings/.test(name) ? "/admin/reglages"
    : /^(create|delete|reorder)Projects?Action$/.test(name) ? "/admin/projets"
    : /Project|Slot/.test(name) ? "/admin/projets/1"
    : /^media|Media/.test(name) ? "/admin/medias"
    : "/admin/pages";
  const res = await callActionJson(forged, ids[name], ["x", {}], screen);
  ok(`A10 ${name} avec un cookie forgé → 403`, res.status === 403, `${res.status} ${res.text.slice(0, 120)}`);
}
{
  let res = await callActionJson(jar, ids.duplicateThemeAction, ["galerie-lumineuse"], "/admin/themes");
  const copyId = /"id":"(galerie-lumineuse-copie[a-z0-9-]*)"/.exec(res.text)?.[1];
  ok("A11 dupliquer un preset (session admin)", res.status === 200 && Boolean(copyId), res.text.slice(0, 200));
  // Thème complet tiré de la base de test, avec une couleur de texte illisible.
  const theme = JSON.parse(query(dirA, "select data from themes where id = ?", copyId).data);
  theme.tokens.color.inkSoft = "#d0d0d0";
  res = await callActionJson(jar, ids.saveThemeAction, [copyId, theme], `/admin/themes/${copyId}`);
  ok("A12 contraste insuffisant forcé côté client → refusé par le serveur", res.status === 200 && res.text.includes("Contraste insuffisant") && res.text.includes('"ok":false'), res.text.slice(0, 300));
  const stored = JSON.parse(query(dirA, "select data from themes where id = ?", copyId).data);
  ok("A12b rien n'est enregistré", stored.tokens.color.inkSoft !== "#d0d0d0");
  res = await callActionJson(jar, ids.saveThemeAction, ["galerie-lumineuse", theme], "/admin/themes");
  ok("A12c un preset ne se modifie pas", res.text.includes("duplique-le"), res.text.slice(0, 200));
  theme.tokens.color.inkSoft = "#5f636a";
  theme.tokens.color.bg = "#fff;}body{display:none";
  res = await callActionJson(jar, ids.saveThemeAction, [copyId, theme], `/admin/themes/${copyId}`);
  ok("A12d valeur CSS injectée → refusée par le schéma", res.text.includes('"ok":false'), res.text.slice(0, 200));
  res = await callActionJson(jar, ids.createPageAction, [{ title: { fr: "Admin", en: "Admin" }, slug: { fr: "admin", en: "admin-en" } }], "/admin/pages");
  ok("A13 slug réservé → refusé", res.text.includes("réservé") && res.text.includes('"ok":false'), res.text.slice(0, 300));
  res = await callActionJson(jar, ids.createPageAction, [{ title: { fr: "X", en: "X" }, slug: { fr: "_cache", en: "Majuscules" } }], "/admin/pages");
  ok("A13b « _ » en tête et majuscules → refusés", res.text.includes("commencer par « _ »") || res.text.includes('"ok":false'), res.text.slice(0, 300));
  res = await callActionJson(jar, ids.createPageAction, [{ title: { fr: "Doublon", en: "Duplicate" }, slug: { fr: "personnages", en: "duplicate" } }], "/admin/pages");
  ok("A13c slug déjà pris dans la langue → refusé", res.text.includes("déjà prise"), res.text.slice(0, 300));
  const site = { name: "Test", role: { fr: "", en: "" }, email: "test@example.test", credit: { fr: "", en: "" } };
  res = await callActionJson(jar, ids.saveSettingsAction, [{ site, socials: [{ label: "X", href: "javascript:alert(1)" }] }], "/admin/reglages");
  ok("A14 URL javascript: dans les réseaux → refusée", res.text.includes("https://") && res.text.includes('"ok":false'), res.text.slice(0, 300));
  res = await callActionJson(jar, ids.saveSettingsAction, [{ site, socials: [{ label: "X", href: "http://exemple.fr" }] }], "/admin/reglages");
  ok("A14b URL http (non https) → refusée", res.text.includes('"ok":false'));
  const persoId = query(dirA, `select id from pages where json_extract(slug,'$.fr')='personnages'`).id;
  res = await callActionJson(jar, ids.deletePageAction, [persoId], "/admin/pages");
  ok("A15 supprimer une page référencée → bloqué avec la liste", res.text.includes("references") && res.text.includes("Tuiles de collections"), res.text.slice(0, 300));
  const homeId = query(dirA, `select id from pages where json_extract(slug,'$.fr')=''`).id;
  res = await callActionJson(jar, ids.deletePageAction, [homeId], "/admin/pages");
  ok("A15b l'accueil ne se supprime pas", res.text.includes("accueil ne se supprime pas"));
  res = await callActionJson(jar, ids.savePageAction, [homeId, { title: { fr: "A", en: "A" }, slug: { fr: "", en: "" }, meta: { title: { fr: "", en: "" }, description: { fr: "", en: "" } }, published: true, inMenu: false, accent: null, blocks: [{ type: "hero", props: { eyebrow: { fr: "", en: "" }, statement: { fr: "", en: "" }, reelPageId: 99999 } }] }], `/admin/pages/${homeId}`);
  ok("A16 bloc pointant vers une page inexistante → refusé", res.text.includes("page qui n") && res.text.includes('"ok":false'), res.text.slice(0, 300));
  res = await callActionJson(jar, ids.savePageAction, [homeId, { title: { fr: "A", en: "A" }, slug: { fr: "", en: "" }, meta: { title: { fr: "", en: "" }, description: { fr: "", en: "" } }, published: true, inMenu: false, accent: "#fafafa", blocks: [] }], `/admin/pages/${homeId}`);
  ok("A16b accent de page sous AA → refusé", res.text.includes("Contraste insuffisant") && res.text.includes('"ok":false'), res.text.slice(0, 300));
  res = await callActionJson(jar, ids.deleteThemeAction, ["galerie-lumineuse"], "/admin/themes");
  ok("A17 thème en ligne ou livré : suppression refusée", res.text.includes('"ok":false'));
  res = await callActionJson(jar, ids.deleteThemeAction, [copyId], "/admin/themes");
  ok("A17b thème personnel hors ligne : supprimé", res.text.includes('"ok":true'));

  // m1 : clés héritées d'Object.prototype comme type de bloc ou id de thème.
  for (const type of ["constructor", "__proto__", "hasOwnProperty"]) {
    res = await callActionJson(jar, ids.savePageAction, [homeId, { title: { fr: "A", en: "A" }, slug: { fr: "", en: "" }, meta: { title: { fr: "", en: "" }, description: { fr: "", en: "" } }, published: true, inMenu: false, accent: null, blocks: [{ type, props: {} }] }], `/admin/pages/${homeId}`);
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
  res = await callActionJson(jar, ids.savePageAction, [accentId, pagePayload], `/admin/pages/${accentId}`);
  ok("A23 accent lisible avec le thème en ligne → enregistré", res.text.includes('"ok":true'), res.text.slice(0, 200));
  r3 = await http("/fr/accent-test");
  ok("A23a accent appliqué au rendu", (await r3.text()).includes("--color-primary:#2e4e9e"));
  await callActionJson(jar, ids.activateThemeAction, ["salle-de-projection"], "/admin/themes");
  r3 = await http("/fr/accent-test");
  ok("A23b thème sombre en ligne : accent illisible ignoré au rendu", !(await r3.text()).includes("--color-primary:#2e4e9e"));
  ok("A23c le serveur le signale dans ses journaux", s.text().includes("accent #2e4e9e de la page"));
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
    (bigStatus === 413 || bigStatus === -1) && sent < 120 * 1024 * 1024 && after.hwm - before.hwm < 150 && tmpLeft === 0,
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

  up = await upload(jar, "tres-haute.png", "image/png", await pngOf(100, 20000, 8, 0));
  ok("U13 côté de plus de 16 384 px → refusé dès l'en-tête", up.status === 422 && /16\u202f?384|16 384|16384/.test(up.json?.message ?? ""), `${up.status} ${up.text.slice(0, 140)}`);
}
await postForm(jar, "/admin/apercu", { id: "pro" }); // pour vérifier la fin d'aperçu à la déconnexion

// Déconnexion par la server action : fin de session ET d'aperçu
const sessionCookies = jar.copy();
r = await callAction(jar, ids.signOutAction, {}, BASE, "/admin");
ok(
  "A9 déconnexion → /admin/connexion, draft mode et cookie d'aperçu effacés",
  r.status === 303 && r.headers.get("location")?.endsWith("/admin/connexion") && !jar.cookies.has("__prerender_bypass") && !jar.cookies.has("theme-preview"),
  `${r.status} ${r.headers.get("location")}`,
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
  ADMIN_EMAILS: "autorise@example.test,nouveau@example.test",
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
for (const [label, flow] of [["groupe", byGroup], ["e-mail", byEmail], ["sub", bySub]]) {
  r = await http("/admin", { jar: flow.jar });
  ok(`D11 session ${label} valide avant le retrait`, r.status === 200, String(r.status));
}
await stop(s);
s = startServer(dirD, { ...oidcEnv, AUTH_ADMIN_GROUP: "autre-groupe", ADMIN_EMAILS: "quelquun@example.test", AUTH_ADMIN_SUBS: "" });
await s.ready;
for (const [label, flow] of [["groupe", byGroup], ["e-mail", byEmail], ["sub", bySub]]) {
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
  const limitMb = expected === "ready" ? 500 : after.hwm; // refus : seul l'absence de décodage compte (+20 Mo au plus)
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
  `G1 4 × kill -9 pendant le traitement : job et média en échec, message clair (essais : ${job?.attempts})`,
  job?.status === "failed" && med?.status === "failed" && /échoué plusieurs fois/.test(med?.error ?? ""),
  JSON.stringify({ job, med }),
);
const delG = await callActionJson(jarG, ids.deleteMediaAction, [killedId], "/admin/medias");
ok("G2 un média en échec reste supprimable", delG.text.includes('"ok":true') && !query(dirG, "select id from media where id = ?", killedId), delG.text.slice(0, 160));
ok("G3 aucun job ni média resté en cours", query(dirG, "select count(*) n from jobs where status in ('queued','running')").n === 0 && query(dirG, "select count(*) n from media where status = 'processing'").n === 0);

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

rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\nECHECS : ${failures}` : "\nTOUT PASSE");
process.exit(failures ? 1 : 0);
