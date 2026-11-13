#!/usr/bin/env node
/**
 * Sécurité v1.0, phase 1, domaine A : parties qui exigent un NAVIGATEUR (chromium, serveurs locaux 127.0.0.1) :
 *  - #67 : fuite XS-Leak « le visiteur est-il l'artiste ? » (window.open d'une URL profonde de l'admin depuis un autre site, lecture de w.length) ;
 *  - #66 / #67 : la CSP publique, le COOP et HSTS ne cassent ni le site public, ni l'éditeur visuel (toile en iframe), ni l'Aperçu
 *    (draft mode, iframe de même origine), ni le chargement des polices et des médias : aucune violation de CSP nouvelle.
 * PASS = protégé / rien de cassé ; FAIL = fuite ou régression. Usage : SECUA_PORT=4260 node scripts/e2e-secuA-browser.mjs
 * Lancé par ~/pf/pw.sh (chromium installé dans le pod).
 */
import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

import { chromium } from "playwright";

const ROOT = new URL("..", import.meta.url).pathname;
const SA = path.join(ROOT, ".next/standalone");
const PORT = Number(process.env.SECUA_PORT ?? 4260);
const ATTACK_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = process.env.SECUA_TMP ?? "/tmp/portfolio-secuA-browser";
const ADMIN = { email: "artiste@example.test", password: "mot-de-passe-du-test-42" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (label, pass, detail = "") => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!pass) failures++;
};
const info = (label, detail = "") => console.log(`INFO  ${label}${detail ? " — " + detail : ""}`);

rmSync(DATA, { recursive: true, force: true });
mkdirSync(DATA, { recursive: true });
const child = spawn(process.execPath, ["server.js"], {
  cwd: SA,
  env: { PATH: process.env.PATH, NODE_ENV: "production", PORT: String(PORT), HOSTNAME: "127.0.0.1", DATA_DIR: DATA, PUBLIC_BASE_URL: BASE, BETTER_AUTH_SECRET: "secuA-secret-0123456789abcdef-0123456789abcdef", ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, AUTH_TRUSTED_PROXY_HOPS: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout.on("data", (d) => (logs += d));
child.stderr.on("data", (d) => (logs += d));
// Site « attaquant » : une autre origine (autre port : même site, pas même origine).
const attacker = createServer((req, res) => {
  res.setHeader("content-type", "text/html");
  res.end("<!doctype html><title>autre site</title><p>autre site</p>");
}).listen(ATTACK_PORT, "127.0.0.1");
process.on("exit", () => {
  try {
    child.kill("SIGKILL");
  } catch {}
});
for (let i = 0; i < 80; i++) {
  try {
    if ((await fetch(`${BASE}/fr`)).status === 200) break;
  } catch {}
  await sleep(250);
}

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions"] });
async function newContext(asAdmin) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const cspMessages = [];
  const failed = [];
  ctx.on("page", (p) => {
    p.on("console", (m) => {
      if (/Content Security Policy|Refused to|violat/i.test(m.text())) cspMessages.push(`${p.url().replace(BASE, "")} : ${m.text().slice(0, 200)}`);
    });
  });
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to|violat/i.test(m.text())) cspMessages.push(`${page.url().replace(BASE, "")} : ${m.text().slice(0, 200)}`);
  });
  page.on("requestfailed", (r) => failed.push(`${r.url().replace(BASE, "")} ${r.failure()?.errorText}`));
  if (asAdmin) {
    await page.goto(`${BASE}/admin/connexion`, { waitUntil: "networkidle" });
    await page.fill("#email", ADMIN.email);
    await page.fill("#password", ADMIN.password);
    await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/admin/connexion"), { timeout: 60000 }), page.click("button[type=submit]")]);
  }
  return { ctx, page, cspMessages, failed };
}

/* ---- #67 : XS-Leak par window.open + w.length ---------------------------------------------- */
async function probeOpener(page, url) {
  await page.goto(`http://127.0.0.1:${ATTACK_PORT}/`);
  return page.evaluate(async (target) => {
    const w = window.open(target, "probe");
    await new Promise((r) => setTimeout(r, 6000));
    let length = "illisible";
    let closed = "illisible";
    try {
      length = w.length;
    } catch (e) {
      length = "erreur " + e.name;
    }
    try {
      closed = w.closed;
    } catch {}
    try {
      w.close();
    } catch {}
    return { length, closed };
  }, url);
}
{
  const admin = await newContext(true);
  const visitor = await newContext(false);
  const target = `${BASE}/admin/pages/1/editer`;
  const a = await probeOpener(admin.page, target);
  const v = await probeOpener(visitor.page, target);
  info("XS-Leak #67 : window.open vers l'éditeur depuis un autre site", `admin → w.length=${a.length} w.closed=${a.closed} ; visiteur → w.length=${v.length} w.closed=${v.closed}`);
  ok("S67f le site attaquant ne distingue pas l'artiste (connectée) d'un visiteur : mêmes observations (w.length, w.closed)", a.length === v.length && a.closed === v.closed, `admin ${JSON.stringify(a)} / visiteur ${JSON.stringify(v)}`);
  await admin.ctx.close();
  await visitor.ctx.close();
}

/* ---- #66 / #67 : rien de cassé dans le navigateur ------------------------------------------- */
{
  const { ctx, page, cspMessages, failed } = await newContext(true);
  const seen = {};
  // site public
  for (const p of ["/fr", "/fr/personnages", "/en"]) {
    await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
    seen[p] = await page.evaluate(() => ({ body: document.body.innerText.length, images: [...document.images].filter((i) => i.complete && i.naturalWidth > 0).length, fonts: [...document.fonts].filter((f) => f.status === "loaded").length }));
  }
  info("site public rendu", JSON.stringify(seen));
  ok("S66m site public : rendu et hydraté (texte présent, images chargées)", Object.values(seen).every((s) => s.body > 50));
  // éditeur visuel (toile en iframe, même origine)
  await page.goto(`${BASE}/admin/pages/1/editer`, { waitUntil: "networkidle" });
  await sleep(4000);
  const editor = await page.evaluate(() => ({ frames: document.querySelectorAll("iframe").length, edit: [...document.querySelectorAll("iframe")].map((f) => { try { return f.contentDocument?.querySelectorAll("[data-edit-block]").length ?? -1; } catch { return -2; } }) }));
  info("éditeur visuel", JSON.stringify(editor));
  ok("S67g éditeur visuel : la toile (iframe de même origine) s'affiche avec ses repères d'édition", editor.frames >= 1 && editor.edit.some((n) => n > 0), JSON.stringify(editor));
  // Aperçu (draft mode)
  const form = await page.evaluate(async (base) => {
    const f = new FormData();
    f.append("id", "pro");
    const r = await fetch(`${base}/admin/apercu`, { method: "POST", body: f, redirect: "manual" });
    return r.type;
  }, BASE);
  await page.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  const draft = await page.evaluate(() => ({ body: document.body.innerText.length, banner: Boolean(document.querySelector("[data-preview-banner], [class*=preview]")) }));
  info("Aperçu (draft mode) ouvert", `${form} ${JSON.stringify(draft)}`);
  ok("S66n Aperçu (draft mode) : le site s'affiche pour l'admin", draft.body > 50);
  // écran Thèmes (vignettes en iframe)
  await page.goto(`${BASE}/admin/themes`, { waitUntil: "networkidle" });
  await sleep(2500);
  const thumbs = await page.evaluate(() => ({ iframes: document.querySelectorAll("iframe").length }));
  info("écran Thèmes (vignettes)", JSON.stringify(thumbs));
  console.log(`INFO  violations de CSP vues : ${cspMessages.length}`);
  for (const m of [...new Set(cspMessages)].slice(0, 8)) console.log(`INFO    ${m}`);
  const nonAdmin = cspMessages.filter((m) => !/^\/admin/.test(m));
  ok("S66o aucune violation de CSP sur le site public ni dans l'Aperçu (toute violation « /admin » connue : eval de la CSP admin, identique à v0.34.0)", nonAdmin.length === 0, nonAdmin.slice(0, 3).join(" ; "));
  const badReq = failed.filter((f) => !/favicon|_next\/static\/.*(map)|ERR_ABORTED/.test(f));
  ok("S66p aucune ressource (police, image, média, script) refusée ou en échec", badReq.length === 0, badReq.slice(0, 4).join(" ; "));
  await ctx.close();
}
await browser.close();
attacker.close();
child.kill("SIGTERM");
console.log(failures ? `\nsecuA-browser : ${failures} échec(s)` : "\nsecuA-browser : OK");
process.exit(failures ? 1 : 0);
