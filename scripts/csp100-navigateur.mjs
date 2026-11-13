#!/usr/bin/env node
/**
 * Intégration v1.0 : la CSP / HSTS / COOP ne casse rien dans un NAVIGATEUR (outil, pas une suite de la batterie).
 * Serveur standalone de production (CSP active) sur une COPIE d'une base SYNTHÉTIQUE qui a des vidéos (avec et sans son) : site public FR/EN,
 * vidéos (clic sur le son et le plein écran), éditeur visuel, Aperçu (draft mode), écran Thèmes et kit Photoshop (état + téléchargement),
 * polices. Compte : violations de CSP (événement securitypolicyviolation + console) et ressources en échec, séparées public / admin.
 * Usage : BATT_CSP_SA=<standalone> BATT_CSP_DATA=<dossier de données à copier> BATT_CSP_PORT=39xx node scripts/csp100-navigateur.mjs
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { chromium } from "playwright";

const SA = process.env.BATT_CSP_SA;
const SRC = process.env.BATT_CSP_DATA;
const PORT = Number(process.env.BATT_CSP_PORT ?? 3930);
const BASE = `http://127.0.0.1:${PORT}`;
const TMP = `${SRC}-csp-${PORT}`;
const ADMIN = { email: "ci-admin@example.test", password: "ci-mot-de-passe-de-test-42" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
import { spawn } from "node:child_process";
rmSync(TMP, { recursive: true, force: true });
cpSync(SRC, TMP, { recursive: true });
const child = spawn(process.execPath, ["server.js"], { cwd: SA, env: { PATH: process.env.PATH, NODE_ENV: "production", PORT: String(PORT), HOSTNAME: "127.0.0.1", DATA_DIR: TMP, PUBLIC_BASE_URL: BASE, BETTER_AUTH_SECRET: "ci-secret-0123456789abcdef-0123456789abcdef", ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password }, stdio: ["ignore", "ignore", "ignore"] });
process.on("exit", () => { try { child.kill("SIGKILL"); } catch {} });
for (let i = 0; i < 120; i++) { try { if ((await fetch(`${BASE}/fr`)).status === 200) break; } catch {} await sleep(250); }

const db = new Database(path.join(TMP, "portfolio.db"), { readonly: true });
const pages = db.prepare("select id, json_extract(slug,'$.fr') fr, json_extract(slug,'$.en') en from pages where published = 1 and deleted_at is null").all();
const videos = db.prepare("select count(*) n from media where kind = 'video'").get().n;
const themes = (() => { try { return db.prepare("select id from themes limit 1").all(); } catch { return []; } })();
db.close();

const out = { public: new Set(), admin: new Set(), failed: new Set() };
let area = "public";
const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => { window.__csp = []; document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`.slice(0, 160))); });
const page = await ctx.newPage();
const note = (m) => out[area].add(m);
page.on("console", (m) => { if (/Content Security Policy|Refused to|violat/i.test(m.text())) note(`${page.url().replace(BASE, "")} : ${m.text().slice(0, 190)}`); });
page.on("requestfailed", (r) => { const u = r.url().replace(BASE, ""); if (!/favicon|ERR_ABORTED/.test(`${u} ${r.failure()?.errorText}`)) out.failed.add(`${u.slice(0, 90)} ${r.failure()?.errorText}`); });
page.on("response", (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) out.failed.add(`${r.status()} ${r.url().replace(BASE, "").slice(0, 90)}`); });
const harvest = async () => { for (const v of await page.evaluate(() => window.__csp ?? []).catch(() => [])) note(`${page.url().replace(BASE, "")} : [événement] ${v}`); await page.evaluate(() => (window.__csp = [])).catch(() => {}); };

const login = await page.request.post(`${BASE}/api/auth/sign-in/email`, { data: ADMIN, headers: { origin: BASE } });
console.log(`INFO  connexion admin : ${login.status()} ; ${pages.length} pages publiées ; ${videos} vidéo(s) en base`);

/* site public : toutes les pages, FR et EN ; sur chaque vidéo : son, plein écran */
let clicks = 0, videoEls = 0, fonts = 0;
for (const p of pages) {
  for (const [lang, slug] of [["fr", p.fr], ["en", p.en]]) {
    await page.goto(`${BASE}/${lang}${slug ? `/${slug}` : ""}`, { waitUntil: "networkidle" }).catch(() => {});
    videoEls += await page.locator("video").count();
    const buttons = page.locator("button, [role=button]").filter({ hasText: /^$/ }).or(page.locator("button[aria-label]"));
    const n = await buttons.count();
    for (let i = 0; i < Math.min(n, 40); i++) {
      const b = buttons.nth(i);
      const label = ((await b.getAttribute("aria-label").catch(() => "")) ?? "").toLowerCase();
      if (!/son|sound|mute|audio|plein|full|lecteur|player|play|lire/.test(label)) continue;
      await b.click({ timeout: 1500, force: true }).catch(() => {});
      clicks++;
      await sleep(250);
      if (await page.locator("[role=dialog] video, dialog video").count()) { await page.keyboard.press("Escape").catch(() => {}); await sleep(200); }
    }
    fonts += await page.evaluate(() => [...document.fonts].filter((f) => f.status === "loaded").length);
    await harvest();
  }
}
console.log(`INFO  site public : ${videoEls} élément(s) vidéo vus, ${clicks} clic(s) sur son / plein écran / lecteur, ${fonts} police(s) chargée(s) au total`);

/* admin : éditeur visuel, Aperçu, Thèmes, kit */
area = "admin";
for (const p of pages.slice(0, 3)) { await page.goto(`${BASE}/admin/pages/${p.id}/editer`, { waitUntil: "networkidle" }).catch(() => {}); await sleep(2500); await harvest(); }
const frames = await page.evaluate(() => document.querySelectorAll("iframe").length);
console.log(`INFO  éditeur visuel : ${frames} cadre(s)`);
await page.goto(`${BASE}/admin/themes`, { waitUntil: "networkidle" }).catch(() => {});
await sleep(2000);
await harvest();
const themeId = themes[0]?.id ?? "galerie-lumineuse";
let kitStatus = "";
{
  await page.goto(`${BASE}/admin/themes/${themeId}/kit`, { waitUntil: "networkidle" }).catch(() => {});
  await sleep(2000);
  await harvest();
  const kitBtn = page.getByRole("button", { name: /kit|préparer|télécharger/i }).first();
  const hadBtn = (await kitBtn.count()) > 0;
  if (hadBtn) await kitBtn.click({ timeout: 3000 }).catch(() => {});
  let state = null;
  for (let i = 0; i < 60 && !(state && state.ready); i++) {
    state = await page.evaluate(async ([base, id]) => { const x = await fetch(`${base}/admin/api/theme-kit/${id}`, { method: "POST", headers: { origin: base } }); return { status: x.status, ...(await x.json().catch(() => ({}))) }; }, [BASE, themeId]);
    if (!state.ready) await sleep(2000);
  }
  let dl = "non prêt";
  if (state?.ready) {
    dl = await page.evaluate(async ([base, id]) => { const x = await fetch(`${base}/admin/api/theme-kit/${id}`); const b = await x.arrayBuffer(); const y = await fetch(`${base}/admin/api/theme-kit/${id}?part=decor`); const c = await y.arrayBuffer(); return `archive ${x.status} ${b.byteLength} octets, partie decor ${y.status} ${c.byteLength} octets`; }, [BASE, themeId]);
  }
  await page.goto(`${BASE}/admin/themes/${themeId}/kit`, { waitUntil: "networkidle" }).catch(() => {});
  await sleep(1500);
  await harvest();
  kitStatus = `thème ${themeId}, bouton ${hadBtn ? "cliqué" : "absent"}, kit ${state?.ready ? "prêt" : "non prêt (" + (state?.status ?? "?") + ")"}, ${dl}`;
}
console.log(`INFO  écran Thèmes / kit : ${kitStatus}`);
area = "public";
await page.evaluate(async (base) => { const f = new FormData(); f.append("id", "pro"); await fetch(`${base}/admin/apercu`, { method: "POST", body: f, redirect: "manual" }); }, BASE);
await page.goto(`${BASE}/fr`, { waitUntil: "networkidle" }).catch(() => {});
await sleep(1500);
await harvest();
console.log(`INFO  Aperçu (draft mode) ouvert`);

const nonAdminCsp = [...out.public];
const adminCsp = [...out.admin];
console.log(`RESULT public_csp=${nonAdminCsp.length} admin_csp=${adminCsp.length} failed=${out.failed.size}`);
for (const m of nonAdminCsp.slice(0, 6)) console.log(`PUBLIC ${m}`);
for (const m of adminCsp.slice(0, 6)) console.log(`ADMIN  ${m}`);
for (const m of [...out.failed].slice(0, 8)) console.log(`FAILED ${m}`);
await browser.close();
child.kill("SIGTERM");
process.exit(0);
