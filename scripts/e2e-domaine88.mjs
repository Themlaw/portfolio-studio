#!/usr/bin/env node
/**
 * Lot 88 « redirection de l'ancien domaine » (suite domaine88). Sur le build standalone en production (après `npm run build:local`,
 * serveur dev ARRÊTÉ). Aucun navigateur : les hôtes sont simulés par les en-têtes Host et X-Forwarded-Host (node:http).
 * Lance plusieurs serveurs avec des REDIRECT_FROM différents et une base neuve (aucune donnée réelle).
 *  A  Sans variable (absente, vide, espaces) : aucune redirection, réponses identiques quel que soit l'hôte ; parité avec la v0.31.1
 *     (PARITY_OUT=fichier enregistre les réponses, PARITY_BEFORE=fichier les compare à celles d'un build v0.31.1 ; seul robots.txt
 *     diffère à dessein : en v0.31.1 il était figé au build avec l'adresse par défaut, il suit maintenant PUBLIC_BASE_URL, voir E7).
 *  B  Avec REDIRECT_FROM : 301 (GET, HEAD) / 308 (autres méthodes) vers le nouveau domaine, même chemin et même requête, sur toutes
 *     les routes ; Host et X-Forwarded-Host (celui-ci l'emporte) ; majuscules, port ; hôtes principal, localhost et IP servis normalement.
 *  C  Saisie négligente (schéma, barre finale, port, espaces, majuscules, entrée invalide) : corrigée avec avertissement dans le journal.
 *  D  Entrée identique au domaine principal : ignorée avec une erreur claire, jamais de boucle. PUBLIC_BASE_URL absent : rien n'est redirigé.
 *  E  canonical, hreflang, og:url, plan du site, robots.txt sur le nouveau domaine ; liens /media passés par la redirection.
 *  F  Connexion admin sur le nouveau domaine (simulée) ; Diagnostic ; ancien domaine : 308 sans connexion.
 * Usage : node scripts/e2e-domaine88.mjs   (exit 1 si un test échoue). Ports 3940 à 3944.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const SA = path.join(ROOT, ".next/standalone");
const TMP = process.env.DOMAINE88_TMP ?? "/tmp/portfolio-domaine88";
const PORT0 = Number(process.env.DOMAINE88_PORT ?? 3940);
const SECRET = "test-secret-0123456789abcdef-0123456789abcdef";
const ADMIN = { email: "artiste@example.test", password: "mot-de-passe-du-test-42" };
const NEW = "https://nouveau.example.test";
const NEW_HOST = "nouveau.example.test";
const OLD = "portfolio.ancien.example.test";

let failures = 0;
const ok = (label, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${!pass && detail ? " — " + detail : ""}`);
  if (!pass) failures++;
};
const info = (label, value) => console.log(`INFO  ${label} : ${typeof value === "string" ? value : JSON.stringify(value)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const servers = new Set();
process.on("exit", () => {
  for (const c of servers) if (c.exitCode === null) c.kill("SIGKILL");
});

function prepareStandalone() {
  if (!existsSync(path.join(SA, "server.js"))) throw new Error("Build absent : lancer `npm run build:local` d'abord.");
  for (const dir of ["drizzle", "seed", "public"]) cpSync(path.join(ROOT, dir), path.join(SA, dir), { recursive: true });
  cpSync(path.join(ROOT, ".next/static"), path.join(SA, ".next/static"), { recursive: true });
}

/** Serveur de production sur une base neuve. `env` : variables du test (REDIRECT_FROM, PUBLIC_BASE_URL…). */
function startServer(name, port, env) {
  const dataDir = path.join(TMP, name);
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
  const logs = [];
  const child = spawn(process.execPath, ["server.js"], {
    cwd: SA,
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "production",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      DATA_DIR: dataDir,
      BETTER_AUTH_SECRET: SECRET,
      ADMIN_EMAIL: ADMIN.email,
      ADMIN_PASSWORD: ADMIN.password,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  servers.add(child);
  child.stdout.on("data", (d) => logs.push(String(d)));
  child.stderr.on("data", (d) => logs.push(String(d)));
  const exited = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
  const server = { child, port, exited, text: () => logs.join("") };
  server.ready = (async () => {
    for (let i = 0; i < 120; i++) {
      if (child.exitCode !== null) return false;
      try {
        if ((await get(server, "/fr", { host: `127.0.0.1:${port}` })).status === 200) return true;
      } catch {}
      await sleep(250);
    }
    return false;
  })();
  return server;
}
async function stop(server) {
  if (server.child.exitCode === null) server.child.kill("SIGTERM");
  await server.exited;
}

/** Requête avec l'en-tête Host voulu (fetch ne permet pas de le choisir). `forwarded` = X-Forwarded-Host. */
function get(server, urlPath, { method = "GET", host, forwarded, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const h = { host: host ?? `127.0.0.1:${server.port}`, ...headers };
    if (forwarded !== undefined) h["x-forwarded-host"] = forwarded;
    if (body !== undefined && !h["content-length"]) h["content-length"] = Buffer.byteLength(body);
    const req = http.request({ host: "127.0.0.1", port: server.port, path: urlPath, method, headers: h }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, buffer: Buffer.concat(chunks), body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.setTimeout(30000, () => req.destroy(new Error("délai dépassé")));
    req.on("error", reject);
    req.end(body);
  });
}
const location = (r) => r.headers.location ?? null;
const sha = (b) => createHash("sha256").update(b).digest("hex").slice(0, 16);

/* Chemins sondés : pages fr et en, admin, API, médias, fichiers à extension. */
const PROBES = [
  "/",
  "/fr",
  "/en",
  "/fr/une-page?x=1",
  "/fr/personnages",
  "/en/characters",
  "/admin",
  "/admin/connexion",
  "/api/auth/get-session",
  "/media/aaaa/bbbb.webp?name=x",
  "/favicon.ico",
  "/manifest.webmanifest",
  "/sitemap.xml",
  "/robots.txt",
];

prepareStandalone();
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

/* ===================== A. Sans variable ===================== */
{
  const s = startServer("a-absente", PORT0, { PUBLIC_BASE_URL: NEW });
  const blank = startServer("a-vide", PORT0 + 1, { PUBLIC_BASE_URL: NEW, REDIRECT_FROM: "  ,  " });
  ok("A0 serveurs sans REDIRECT_FROM prêts", (await s.ready) && (await blank.ready), s.text().slice(-400) + blank.text().slice(-400));
  const snapshot = {};
  for (const probe of PROBES) {
    const ref = await get(s, probe, { host: NEW_HOST });
    const variants = [
      ["ancien hôte", { host: OLD }],
      ["ancien hôte en X-Forwarded-Host", { host: `127.0.0.1:${PORT0}`, forwarded: OLD }],
      ["localhost", { host: `localhost:${PORT0}` }],
      ["IP", { host: "192.0.2.7" }],
    ];
    const keyHeaders = (r) => [r.status, location(r), r.headers["content-type"] ?? null].join("|");
    let same = true;
    let detail = "";
    for (const [name, opts] of variants) {
      const r = await get(s, probe, opts);
      // Une redirection interne (/ → /fr, admin → connexion) peut citer l'hôte demandé : on compare le chemin, pas l'hôte.
      const norm = (x) => (x ? x.replace(/^https?:\/\/[^/]+/, "") : x);
      if (r.status !== ref.status || norm(location(r)) !== norm(location(ref)) || (r.headers["content-type"] ?? null) !== (ref.headers["content-type"] ?? null)) {
        same = false;
        detail += `${name}: ${keyHeaders(r)} ≠ ${keyHeaders(ref)}; `;
      }
    }
    ok(`A1 sans variable ${probe} : même réponse quel que soit l'hôte (${ref.status})`, same, detail);
    const redirectedAway = (ref.status === 301 || ref.status === 308) && /^https?:\/\//.test(location(ref) ?? "") && new URL(location(ref)).hostname !== NEW_HOST;
    ok(`A2 sans variable ${probe} : pas de redirection vers un autre domaine`, !redirectedAway, location(ref) ?? "");
    snapshot[probe] = { status: ref.status, location: (location(ref) ?? "").replace(/^https?:\/\/[^/]+/, ""), type: ref.headers["content-type"] ?? null, cache: ref.headers["cache-control"] ?? null, body: /sitemap|manifest/.test(probe) ? sha(ref.buffer) : null };
    const b = await get(blank, probe, { host: OLD });
    ok(`A3 REDIRECT_FROM vide ${probe} : même statut que sans variable`, b.status === ref.status, `${b.status} ≠ ${ref.status}`);
  }
  for (const method of ["POST", "PUT", "DELETE"]) {
    const a = await get(s, "/api/contact", { method, host: OLD, body: "{}", headers: { "content-type": "application/json" } });
    const b = await get(s, "/api/contact", { method, host: NEW_HOST, body: "{}", headers: { "content-type": "application/json" } });
    ok(`A4 sans variable ${method} /api/contact : même statut quel que soit l'hôte (${b.status})`, a.status === b.status && ![301, 308].includes(a.status), `${a.status} / ${b.status}`);
  }
  ok("A5 sans variable : aucune ligne [domaine] dans le journal", !/\[domaine\]/.test(s.text()), s.text().slice(-300));
  ok("A6 REDIRECT_FROM vide : aucune ligne [domaine] dans le journal", !/\[domaine\]/.test(blank.text()), blank.text().slice(-300));
  if (process.env.PARITY_OUT) writeFileSync(process.env.PARITY_OUT, JSON.stringify(snapshot, null, 1));
  if (process.env.PARITY_BEFORE) {
    const before = JSON.parse(readFileSync(process.env.PARITY_BEFORE, "utf8"));
    for (const probe of PROBES) {
      const a = before[probe];
      const b = snapshot[probe];
      const same = a && a.status === b.status && a.location === b.location && a.type === b.type && a.cache === b.cache && a.body === b.body;
      ok(`A7 parité v0.31.1 ${probe} (${b.status})`, Boolean(same), JSON.stringify({ avant: a, apres: b }));
    }
  }
  await stop(blank);
  await stop(s);
}

/* ===================== B, C, E, F. Avec REDIRECT_FROM ===================== */
{
  const messy = `  ${OLD.toUpperCase()} , https://www.ancien.example.test/ ,autre.example.test:8080/chemin, ,mauvais hôte!,`;
  const s = startServer("b-redirection", PORT0 + 2, { PUBLIC_BASE_URL: NEW, REDIRECT_FROM: messy });
  ok("B0 serveur avec REDIRECT_FROM prêt", await s.ready, s.text().slice(-600));
  const p = s.port;
  const direct = { host: `127.0.0.1:${p}` };

  // C. journal
  const log = s.text();
  ok("C1 schéma et barre finale retirés, avec avertissement", /\[domaine\].*« https:\/\/www\.ancien\.example\.test\/ » corrigé en « www\.ancien\.example\.test » \(schéma retiré, barre finale retirée\)/.test(log), log);
  ok("C2 port et chemin retirés, avec avertissement", /« autre\.example\.test:8080\/chemin » corrigé en « autre\.example\.test » \(chemin retiré, port retiré\)/.test(log), log);
  ok("C3 entrée invalide ignorée avec une erreur", /« mauvais hôte! » n'est pas un nom de domaine valide/.test(log), log);
  ok("C4 les majuscules et espaces sont tolérés (aucun avertissement pour l'entrée en majuscules)", !new RegExp(`« ${OLD.toUpperCase()} »`, "i").test(log.split("\n").filter((l) => /corrigé|invalide/.test(l)).join("\n")), log);
  ok("C5 le journal annonce la redirection", log.includes(`[domaine] redirection de ${OLD}, www.ancien.example.test, autre.example.test vers ${NEW}`), log);

  // B. redirections
  const cases = [
    ["/fr/une-page?x=1", "/fr/une-page?x=1"],
    ["/en", "/en"],
    ["/admin", "/admin"],
    ["/admin/connexion", "/admin/connexion"],
    ["/media/12/abc/photo.webp?w=640&sig=a1b2", "/media/12/abc/photo.webp?w=640&sig=a1b2"],
    ["/favicon.ico", "/favicon.ico"],
    ["/manifest.webmanifest", "/manifest.webmanifest"],
    ["/sitemap.xml", "/sitemap.xml"],
    ["/robots.txt", "/robots.txt"],
    ["/api/auth/get-session", "/api/auth/get-session"],
    ["/site-icon/192.png?v=ab", "/site-icon/192.png?v=ab"],
    ["/", "/"],
    ["/fr/%C3%A9t%C3%A9?a=b&q=x%2By&s=a%2Fb&e=", "/fr/%C3%A9t%C3%A9?a=b&q=x%2By&s=a%2Fb&e="],
    ["/media/3/ab.webp?sig=Zm9v-_YQ%3D%3D&u=%C3%A9", "/media/3/ab.webp?sig=Zm9v-_YQ%3D%3D&u=%C3%A9"],
    ["/fr/une-page?", "/fr/une-page"], // le « ? » vide disparaît (URL normalisée par Next)
  ];
  for (const [probe, expected] of cases) {
    const r = await get(s, probe, { host: OLD });
    const loc = location(r);
    const good = r.status === 301 && loc === `${NEW}${expected}`;
    ok(`B1 ancien hôte ${probe} → 301 ${NEW}${expected}`, good, `${r.status} ${loc}`);
  }
  // Un « %20 » dans la requête peut revenir en « + » (Next réécrit la requête avant le proxy) : même sens, on le vérifie.
  const spaced = await get(s, "/fr/x?a=b&c=%20d", { host: OLD });
  ok("B1c espace dans la requête : même sens après redirection", spaced.status === 301 && new URL(location(spaced)).searchParams.get("c") === " d" && new URL(location(spaced)).searchParams.get("a") === "b", `${spaced.status} ${location(spaced)}`);
  // Chemin en « // » : Next le ramène à « / » lui-même (comme avant le lot 88) ; la redirection suivante ne sort pas du nouveau domaine.
  const slashes = await get(s, "//autre.example.test/piege", { host: OLD });
  const slashesNext = location(slashes) ?? "";
  const slashesEnd = /^\//.test(slashesNext) ? await get(s, slashesNext, { host: OLD }) : slashes;
  ok("B1d chemin en « // » : jamais de sortie du nouveau domaine", [301, 308].includes(slashes.status) && /^https:\/\/nouveau\.example\.test\//.test(location(slashesEnd) ?? ""), `${slashes.status} ${slashesNext} puis ${slashesEnd.status} ${location(slashesEnd)}`);
  const head = await get(s, "/fr", { method: "HEAD", host: OLD });
  ok("B2 HEAD sur l'ancien hôte : 301", head.status === 301 && location(head) === `${NEW}/fr`, `${head.status} ${location(head)}`);
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    const r = await get(s, "/fr/formulaire?a=1", { method, host: OLD, body: method === "OPTIONS" ? undefined : '{"x":1}', headers: { "content-type": "application/json" } });
    ok(`B3 ${method} sur l'ancien hôte : 308 (corps conservé) vers le même chemin`, r.status === 308 && location(r) === `${NEW}/fr/formulaire?a=1`, `${r.status} ${location(r)}`);
  }
  for (const [path_, expected] of [["/api/auth/sign-in/email", "/api/auth/sign-in/email"], ["/api/contact", "/api/contact"], ["/media/1/x.webp", "/media/1/x.webp"]]) {
    const r = await get(s, path_, { method: "POST", host: OLD, body: "{}", headers: { "content-type": "application/json" } });
    ok(`B3b POST ${path_} sur l'ancien hôte : 308`, r.status === 308 && location(r) === `${NEW}${expected}`, `${r.status} ${location(r)}`);
  }
  const redirect = await get(s, "/fr", { host: OLD });
  ok("B4 la redirection se garde une heure au plus (revenir en arrière reste possible)", /^public, max-age=3600$/.test(redirect.headers["cache-control"] ?? ""), `cache-control ${redirect.headers["cache-control"]}`);
  const withCookie = await get(s, "/admin", { host: OLD, headers: { cookie: "better-auth.session_token=x" } });
  ok("B5 un cookie de session ne change rien à la redirection", withCookie.status === 301 && location(withCookie) === `${NEW}/admin`, `${withCookie.status} ${location(withCookie)}`);

  // X-Forwarded-Host
  const xf = await get(s, "/fr/une-page?x=1", { ...direct, forwarded: OLD });
  ok("B6 X-Forwarded-Host = ancien hôte (Host interne) : 301", xf.status === 301 && location(xf) === `${NEW}/fr/une-page?x=1`, `${xf.status} ${location(xf)}`);
  const xfWins = await get(s, "/fr", { host: OLD, forwarded: NEW_HOST });
  ok("B7 X-Forwarded-Host (nouveau) l'emporte sur Host (ancien) : servi normalement", xfWins.status === 200, `${xfWins.status} ${location(xfWins)}`);
  const xfList = await get(s, "/fr", { ...direct, forwarded: `${OLD}, proxy.interne` });
  ok("B8 X-Forwarded-Host en liste : le premier compte", xfList.status === 301, `${xfList.status}`);
  const upper = await get(s, "/fr", { host: `${OLD.toUpperCase()}:443` });
  ok("B9 majuscules et port dans l'hôte reçu : 301", upper.status === 301 && location(upper) === `${NEW}/fr`, `${upper.status} ${location(upper)}`);
  const dotted = await get(s, "/fr", { host: `${OLD}.` });
  ok("B9b point final dans l'hôte reçu : 301", dotted.status === 301, `${dotted.status}`);
  for (const alt of ["www.ancien.example.test", "autre.example.test"]) {
    const r = await get(s, "/fr", { host: alt });
    ok(`B10 autre entrée de la liste (${alt}) : 301`, r.status === 301 && location(r) === `${NEW}/fr`, `${r.status} ${location(r)}`);
  }

  // Hôtes non listés
  for (const [name, opts] of [["hôte principal", { host: NEW_HOST }], ["hôte principal + X-Forwarded-Host", { ...direct, forwarded: NEW_HOST }], ["localhost", { host: `localhost:${p}` }], ["127.0.0.1", direct], ["IP", { host: "192.0.2.7" }], ["hôte inconnu", { host: "inconnu.example.test" }], ["sans port, voisin du nom", { host: `x${OLD}` }]]) {
    const r = await get(s, "/fr", opts);
    ok(`B11 ${name} : servi normalement (200)`, r.status === 200, `${r.status} ${location(r)}`);
  }
  const apiLocal = await get(s, "/api/auth/get-session", { host: `localhost:${p}` });
  ok("B12 contrôle interne /api sur localhost : pas de redirection", ![301, 308].includes(apiLocal.status), String(apiLocal.status));
  const mediaLocal = await get(s, "/media/zzz/absent.webp", direct);
  ok("B13 /media d'un hôte non listé : traité comme avant (404, pas de redirection)", mediaLocal.status === 404, String(mediaLocal.status));

  // Pas de boucle : on suit les redirections en changeant d'hôte comme le ferait le navigateur.
  let host = OLD;
  let hops = 0;
  let last;
  for (; hops < 6; hops++) {
    last = await get(s, "/fr/personnages?x=1", { host });
    if (![301, 308].includes(last.status)) break;
    if (!location(last)) break;
    host = new URL(location(last)).hostname;
  }
  ok("B14 en suivant les redirections on arrive en une étape sur le nouveau domaine (pas de boucle)", hops === 1 && host === NEW_HOST && last.status === 200, `sauts ${hops}, hôte ${host}, statut ${last.status}`);

  // E. adresses absolues sur le nouveau domaine
  const absoluteOf = (html, re) => [...html.matchAll(re)].map((m) => m[1]);
  for (const [pagePath, alternates] of [["/fr", ["/fr", "/en"]], ["/fr/personnages", ["/fr/personnages", "/en/characters"]], ["/en/characters", ["/fr/personnages", "/en/characters"]]]) {
    const page = await get(s, pagePath, { host: NEW_HOST });
    ok(`E0 ${pagePath} servi sur le nouveau domaine`, page.status === 200, String(page.status));
    const canonical = absoluteOf(page.body, /<link rel="canonical" href="([^"]+)"/g);
    ok(`E1 canonical de ${pagePath} sur le nouveau domaine`, canonical.length === 1 && canonical[0] === `${NEW}${pagePath}`, JSON.stringify(canonical));
    const hreflang = absoluteOf(page.body, /<link rel="alternate" hrefLang="[a-z-]+" href="([^"]+)"/gi);
    ok(`E2 hreflang de ${pagePath} sur le nouveau domaine`, hreflang.length >= 2 && hreflang.every((u) => u.startsWith(`${NEW}/`)) && alternates.every((a) => hreflang.includes(`${NEW}${a}`)), JSON.stringify(hreflang));
    const ogUrl = absoluteOf(page.body, /<meta property="og:url" content="([^"]+)"/g);
    ok(`E3 og:url de ${pagePath} sur le nouveau domaine`, ogUrl.length === 1 && ogUrl[0] === `${NEW}${pagePath}`, JSON.stringify(ogUrl));
    const stray = page.body.match(new RegExp(`${OLD.replace(/\./g, "\\.")}|127\\.0\\.0\\.1:${p}|localhost`, "g"));
    ok(`E4 ${pagePath} ne cite ni l'ancien domaine ni l'adresse interne`, !stray, JSON.stringify(stray));
    const ogImages = absoluteOf(page.body, /<meta property="og:image" content="([^"]+)"/g);
    ok(`E5 og:image de ${pagePath} (s'il y en a une) sur le nouveau domaine`, ogImages.every((u) => u.startsWith(`${NEW}/`)), JSON.stringify(ogImages));
  }
  const sitemap = await get(s, "/sitemap.xml", { host: NEW_HOST });
  const locs = absoluteOf(sitemap.body, /<loc>([^<]+)<\/loc>/g);
  const hrefs = absoluteOf(sitemap.body, /href="([^"]+)"/g);
  ok("E6 sitemap.xml : toutes les adresses sur le nouveau domaine", sitemap.status === 200 && locs.length > 0 && [...locs, ...hrefs].every((u) => u.startsWith(`${NEW}/`)), JSON.stringify([...locs, ...hrefs].slice(0, 6)));
  info("E6 adresses du plan du site", locs.length);
  const sitemapOld = await get(s, "/sitemap.xml", { host: OLD });
  ok("E6b le plan du site de l'ancien domaine est une redirection (Google suit vers le nouveau)", sitemapOld.status === 301 && location(sitemapOld) === `${NEW}/sitemap.xml`, `${sitemapOld.status}`);
  const robots = await get(s, "/robots.txt", { host: NEW_HOST });
  ok("E7 robots.txt : Sitemap et Host sur le nouveau domaine", robots.body.includes(`Sitemap: ${NEW}/sitemap.xml`) && robots.body.includes(`Host: ${NEW}`) && !robots.body.includes(OLD), robots.body);
  const manifest = await get(s, "/manifest.webmanifest", { host: NEW_HOST });
  ok("E8 manifeste : adresses relatives ou du nouveau domaine, jamais l'ancien", manifest.status === 200 && !manifest.body.includes(OLD) && !/127\.0\.0\.1/.test(manifest.body), manifest.body.slice(0, 200));

  // Liens de partage / recadrage : un lien /media déjà diffusé arrive au même contenu par la redirection.
  const home = await get(s, "/fr", { host: NEW_HOST });
  const media = absoluteOf(home.body, /(?:src|href|content)="((?:https:\/\/nouveau\.example\.test)?\/(?:media|site-icon)\/[^"]+)"/g)[0] ?? "/site-icon/192.png";
  const mediaPath = media.replace(NEW, "").replace(/&amp;/g, "&");
  const viaOld = await get(s, mediaPath, { host: OLD });
  const target = location(viaOld) ?? "";
  ok(`E9 un lien de partage ou de recadrage déjà diffusé (${mediaPath.slice(0, 60)}) est redirigé`, viaOld.status === 301 && target === `${NEW}${mediaPath}`, `${viaOld.status} ${target}`);
  const final = await get(s, target.replace(NEW, ""), { host: NEW_HOST });
  const original = await get(s, mediaPath, { host: NEW_HOST });
  ok("E10 …et mène au même contenu qu'une visite directe", final.status === original.status && sha(final.buffer) === sha(original.buffer), `${final.status} / ${original.status}`);

  // F. connexion admin sur le nouveau domaine (simulée) et Diagnostic
  const signIn = (opts) => get(s, "/api/auth/sign-in/email", { method: "POST", body: JSON.stringify(ADMIN), headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.20", "x-forwarded-proto": "https", ...opts.headers }, host: opts.host, forwarded: opts.forwarded });
  const oldLogin = await signIn({ host: OLD, headers: { origin: `https://${OLD}` } });
  ok("F1 connexion tentée sur l'ancien domaine : 308 vers le nouveau (aucun cookie posé)", oldLogin.status === 308 && location(oldLogin) === `${NEW}/api/auth/sign-in/email` && !oldLogin.headers["set-cookie"], `${oldLogin.status} ${location(oldLogin)}`);
  const login = await signIn({ host: direct.host, forwarded: NEW_HOST, headers: { origin: NEW } });
  const cookies = (login.headers["set-cookie"] ?? []).map((c) => c.split(";")[0]);
  ok("F2 connexion sur le nouveau domaine (X-Forwarded-Host + Origin du nouveau domaine) : 200 et cookie de session", login.status === 200 && cookies.some((c) => /session_token=/.test(c)), `${login.status} ${login.body.slice(0, 200)}`);
  const secure = (login.headers["set-cookie"] ?? []).every((c) => /;\s*secure/i.test(c));
  info("F2b cookies Secure, sans attribut Domain (propres au nouveau domaine)", secure && !(login.headers["set-cookie"] ?? []).some((c) => /;\s*domain=/i.test(c)));
  const cookie = cookies.join("; ");
  const admin = await get(s, "/admin", { host: NEW_HOST, headers: { cookie, "x-forwarded-proto": "https" } });
  ok("F3 /admin avec la session sur le nouveau domaine : 200", admin.status === 200, `${admin.status} ${location(admin)}`);
  const anon = await get(s, "/admin", { host: NEW_HOST, forwarded: NEW_HOST });
  info("F3b /admin sans session redirige vers", location(anon) ?? "(rien)");
  ok("F3c /admin sans session : redirection vers la connexion", [302, 303, 307, 308].includes(anon.status) && /\/admin\/connexion$/.test(location(anon) ?? ""), `${anon.status} ${location(anon)}`);
  const settings = await get(s, "/admin/reglages", { host: NEW_HOST, headers: { cookie } });
  ok("F4 Diagnostic : liste les domaines redirigés vers l'adresse principale", settings.status === 200 && settings.body.includes("Domaines redirigés") && settings.body.includes(OLD) && settings.body.includes("www.ancien.example.test"), `${settings.status}`);
  ok("F5 Diagnostic : montre l'entrée corrigée et l'entrée invalide", /mauvais hôte!/.test(settings.body) && /corrigé en/.test(settings.body), "");
  ok("F6 Diagnostic : l'adresse principale reste celle du nouveau domaine", settings.body.includes(NEW), "");
  const outOrigin = await get(s, "/api/auth/sign-in/email", { method: "POST", body: JSON.stringify(ADMIN), host: NEW_HOST, headers: { "content-type": "application/json", origin: `https://${OLD}`, "x-forwarded-for": "203.0.113.21" } });
  ok("F7 une connexion venue d'une page de l'ancien domaine (Origin ancien, hôte nouveau) est refusée (403)", outOrigin.status === 403, String(outOrigin.status));
  await stop(s);
}

/* ===================== D. Garde-fous ===================== */
{
  const same = startServer("d-boucle", PORT0 + 3, { PUBLIC_BASE_URL: "https://meme.example.test", REDIRECT_FROM: `Meme.Example.Test, ${OLD}` });
  ok("D0 serveur (entrée identique au domaine principal) prêt", await same.ready, same.text().slice(-400));
  const a = await get(same, "/fr/personnages?x=1", { host: "meme.example.test" });
  ok("D1 l'hôte principal est servi normalement (pas de boucle)", a.status === 200, `${a.status} ${location(a)}`);
  const b = await get(same, "/fr/personnages?x=1", { host: OLD });
  ok("D2 l'autre entrée de la liste redirige toujours", b.status === 301 && location(b) === "https://meme.example.test/fr/personnages?x=1", `${b.status} ${location(b)}`);
  const c = await get(same, "/fr", { host: "MEME.example.test:443", forwarded: "meme.example.test" });
  ok("D3 l'hôte principal en majuscules ou avec X-Forwarded-Host : servi normalement", c.status === 200, String(c.status));
  ok("D4 erreur claire dans le journal", /\[domaine\].*« Meme\.Example\.Test » est le domaine principal \(PUBLIC_BASE_URL\), entrée ignorée pour ne jamais créer de boucle/.test(same.text()), same.text());
  const diag = await (async () => {
    const login = await get(same, "/api/auth/sign-in/email", { method: "POST", body: JSON.stringify(ADMIN), host: "meme.example.test", headers: { "content-type": "application/json", origin: "https://meme.example.test", "x-forwarded-for": "203.0.113.30" } });
    const cookie = (login.headers["set-cookie"] ?? []).map((x) => x.split(";")[0]).join("; ");
    return get(same, "/admin/reglages", { host: "meme.example.test", headers: { cookie } });
  })();
  ok("D5 Diagnostic : l'entrée ignorée est signalée", diag.status === 200 && /est le domaine principal/.test(diag.body.replace(/&#x27;|&#39;|&apos;/g, "'")), String(diag.status));
  await stop(same);

  const alone = startServer("d-sans-base", PORT0 + 4, { REDIRECT_FROM: OLD, PUBLIC_BASE_URL: "" });
  ok("D6 serveur sans PUBLIC_BASE_URL prêt", await alone.ready, alone.text().slice(-400));
  const r = await get(alone, "/fr", { host: OLD });
  ok("D7 REDIRECT_FROM sans PUBLIC_BASE_URL : rien n'est redirigé", r.status === 200, `${r.status} ${location(r)}`);
  ok("D8 …et le journal explique pourquoi", /\[domaine\] PUBLIC_BASE_URL n'est pas défini/.test(alone.text()), alone.text());
  await stop(alone);
}

console.log(failures ? `\n${failures} test(s) en échec` : "\nTous les tests passent");
process.exit(failures ? 1 : 0);
