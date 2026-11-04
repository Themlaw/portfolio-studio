#!/usr/bin/env node
/**
 * Lot 76 — écran Admin > Sauvegardes et retrait de l'onglet « Projets ». Vrai serveur, un chromium.
 * Le serveur de la suite est lancé avec WITH_BACKUP=1 BACKUP_QUIET_SEC=4 BACKUP_KEEP=3 (voir `admin76` dans test-all-local.sh).
 *  A. Liste : reflète les archives créées par le test (modification → quiétude → archive) ; version, contenu, raison lus dans le manifest.
 *  B. Réglages : l'origine de chaque valeur est dite ; un réglage de l'admin (en base) PRIME sur l'environnement ; « Revenir à la
 *     valeur d'origine » le retire ; valeur hors bornes refusée.
 *  C. « Sauvegarder maintenant » : une archive (raison « À ta demande ») apparaît, avec suivi de l'état.
 *  D. Téléchargement : même sha256 que le fichier du volume ; Range (206, 416) ; nom invalide 404 ; sans session 401.
 *  E. Onglet « Projets » : plus dans le menu ; /admin/projets et /admin/projets?vue=corbeille redirigent ; les fonctions
 *     (nouveau projet, ordre, suppression, corbeille) sont dans Pages ; l'écran d'un projet reste et revient vers Pages.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… node scripts/e2e-admin76.mjs
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";
import sharp from "sharp";

const BASE = process.env.BASE ?? "http://localhost:3860";
const DATA = process.env.DATA_DIR ?? "data";
const BACKUP_DIR = path.join(DATA, "backup");
const QUIET_S = Number(process.env.BACKUP_QUIET_SEC ?? 4);
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, timeout = 60000) => {
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(400)) if (await fn()) return true;
  return false;
};
let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const archives = () => (existsSync(BACKUP_DIR) ? readdirSync(BACKUP_DIR).filter((n) => /^portfolio-\d{8}-\d{6}(-\d+)?\.tar\.gz$/.test(n)).sort() : []);
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const dbq = (sql, ...a) => {
  const db = new Database(path.join(DATA, "portfolio.db"), { readonly: true });
  try {
    return db.prepare(sql).all(...a);
  } finally {
    db.close();
  }
};

let n = 0;
async function upload(cookie) {
  n++;
  const png = await sharp({ create: { width: 80, height: 60, channels: 3, background: { r: (n * 41) % 256, g: (Date.now() / 5) % 256, b: (n * 89) % 256 } } }).png().toBuffer();
  const form = new FormData();
  form.set("file", new Blob([png], { type: "image/png" }), `sauvegarde76-${Date.now()}-${n}.png`);
  const res = await fetch(`${BASE}/admin/api/upload`, { method: "POST", headers: { cookie, origin: BASE }, body: form });
  const body = await res.json();
  if (!body.ok) throw new Error(`envoi refusé : ${JSON.stringify(body)}`);
  return body.media.id;
}

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text().slice(0, 200)));
page.on("dialog", (d) => d.accept());
const shot = (name) => (SHOTS ? page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }).catch(() => {}) : Promise.resolve());
const goto = (p) => page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
const toastEl = (t) => page.locator(".a-toast", { hasText: t }).first();
const rows = () => page.locator('[data-testid="ligne-sauvegarde"]');
const source = (f) => page.locator(`[data-testid="source-${f}"]`).getAttribute("data-source");

try {
  await goto("/admin/connexion");
  await page.fill("#email", process.env.ADMIN_EMAIL);
  await page.fill("#password", process.env.ADMIN_PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}/admin`);
  let cookie = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");

  /* ---------------- A. liste ---------------- */
  ok("A0 première sauvegarde faite au démarrage", await waitFor(() => archives().length >= 1));
  await upload(cookie);
  const before = archives();
  ok("A1 une modification donne une archive après la quiétude", await waitFor(() => archives().length > before.length || archives().at(-1) !== before.at(-1), (QUIET_S + 50) * 1000));
  await sleep(1500);
  await goto("/admin/sauvegardes");
  await shot("a-sauvegardes");
  const names = await rows().evaluateAll((els) => els.map((e) => e.getAttribute("data-name")));
  ok("A2 la liste montre exactement les archives du volume (la plus récente d'abord)", JSON.stringify(names) === JSON.stringify([...archives()].reverse()), `${names} / ${archives()}`);
  const first = rows().first();
  const text = await first.innerText();
  ok("A3 ligne : taille, contenu « Base et médias », version, raison", /(Ko|Mo)/.test(text) && /Base et médias/.test(text) && /(Après une session de travail|Première sauvegarde)/.test(text), text);
  ok("A4 la version de l'application vient du manifest (pas « ? »)", !(await first.locator('[data-label="Version du site"]').innerText()).includes("?"));
  ok("A5 état : nombre = nombre d'archives", (await page.locator('[data-testid="etat-nombre"]').innerText()) === String(archives().length));
  ok("A6 état : espace libre affiché", /(Mo|Go) sur /.test(await page.locator('[data-testid="etat-espace"]').innerText()));
  ok("A7 état : prochaine sauvegarde dite (rien en attente ou une date)", /(Aucune modification en attente|Très bientôt|dans environ)/.test(await page.locator('[data-testid="etat-prochaine"]').innerText()));
  ok("A8 état : aucune erreur", /Aucune/.test(await page.locator('[data-testid="etat-erreur"]').innerText()));
  ok("A9 conseil « Garde une copie sur ton ordinateur de temps en temps »", /Garde une copie sur ton ordinateur de temps en temps/.test(await page.locator('[data-testid="conseil-copie"]').innerText()));
  ok("A10 entrée « Sauvegardes » dans le menu", (await page.locator('.a-nav a', { hasText: "Sauvegardes" }).count()) === 1);

  /* ---------------- B. réglages ---------------- */
  ok("B1 valeurs venant de l'environnement : source dite (garder, activé)", (await source("keep")) === "env" && (await source("enabled")) === "env", `${await source("keep")}`);
  ok("B2 valeur jamais réglée nulle part : « Valeur d'origine » (médias)", (await source("media")) === "defaut");
  ok("B3 l'environnement donne 3 gardées", (await page.locator('[data-testid="reglage-garder"]').inputValue()) === "3");
  await page.locator('[data-testid="reglage-garder"]').fill("0");
  await page.locator('[data-testid="enregistrer-reglages"]').click();
  await toastEl("Vérifie").waitFor({ timeout: 15000 });
  ok("B4 valeur hors bornes refusée, rien en base", dbq("select value from settings where key = 'backup'").length === 0);
  await page.locator('[data-testid="reglage-garder"]').fill("2");
  await page.locator('[data-testid="enregistrer-reglages"]').click();
  await toastEl("Réglages enregistrés").waitFor({ timeout: 15000 });
  const stored = dbq("select value from settings where key = 'backup'")[0]?.value;
  ok("B5 le réglage est en base, seul le champ modifié", stored && JSON.stringify(JSON.parse(stored)) === JSON.stringify({ keep: 2 }), stored);
  ok("B6 la source devient « Réglé ici », les autres restent à l'environnement", (await source("keep")) === "reglage" && (await source("enabled")) === "env");
  await page.reload({ waitUntil: "networkidle" });
  ok("B7 après rechargement : 2, réglé ici (la base prime sur l'environnement qui dit 3)", (await page.locator('[data-testid="reglage-garder"]').inputValue()) === "2" && (await source("keep")) === "reglage");
  // Le réglage s'applique vraiment : deux modifications, puis l'archive en trop disparaît à la sauvegarde suivante.
  for (let i = 0; i < 2; i++) {
    const last = archives().at(-1);
    await upload(cookie);
    await waitFor(() => archives().at(-1) !== last, (QUIET_S + 60) * 1000);
    await sleep(1200);
  }
  ok("B8 rotation à 2 (KEEP de l'admin, pas 3 de l'environnement)", archives().length === 2, archives().join(","));
  await page.locator("button", { hasText: "Revenir à la valeur d'origine" }).first().click();
  await page.locator('[data-testid="enregistrer-reglages"]').click();
  await toastEl("Réglages enregistrés").waitFor({ timeout: 15000 });
  ok("B9 « Revenir à la valeur d'origine » : réglage retiré de la base, retour à 3 (environnement)", dbq("select value from settings where key = 'backup'").length === 0 && (await source("keep")) === "env" && (await page.locator('[data-testid="reglage-garder"]').inputValue()) === "3");

  /* ---------------- C. sauvegarder maintenant ---------------- */
  await goto("/admin/sauvegardes");
  const c0 = archives();
  await page.locator('[data-testid="sauvegarder-maintenant"]').click();
  ok("C1 le bouton se désactive pendant la sauvegarde (état affiché)", await waitFor(async () => /en cours/.test(await page.locator('[data-testid="sauvegarder-maintenant"]').innerText()) || archives().length > c0.length || archives().at(-1) !== c0.at(-1), 15000));
  ok("C2 une archive de plus (ou la plus ancienne remplacée à KEEP)", await waitFor(() => archives().at(-1) !== c0.at(-1), 60000));
  ok("C3 la liste affiche « À ta demande » en tête", await waitFor(async () => /À ta demande/.test(await rows().first().innerText().catch(() => "")), 30000), await rows().first().innerText());
  ok("C4 le bouton redevient disponible", await waitFor(async () => (await page.locator('[data-testid="sauvegarder-maintenant"]').innerText()) === "Sauvegarder maintenant", 30000));
  await shot("c-apres-sauvegarde");

  /* ---------------- D. téléchargement ---------------- */
  const target = archives().at(-1);
  const url = `${BASE}/api/admin/sauvegardes/${target}`;
  const file = path.join(BACKUP_DIR, target);
  // Audit P2 : une session de plus de 10 min sans mot de passe retapé ne télécharge rien. On vieillit la session en base.
  {
    const db = new Database(path.join(DATA, "portfolio.db"));
    db.prepare("update session set created_at = ?").run(Date.now() - 3_600_000);
    db.close();
  }
  ok("D0 session de plus de 10 min, sans confirmation : 403", (await fetch(url, { headers: { cookie } })).status === 403);
  const dl = page.waitForEvent("download", { timeout: 20000 });
  await goto("/admin/sauvegardes");
  await rows().first().locator('[data-testid="telecharger"]').click();
  const pw = page.locator('[data-testid="mot-de-passe-telechargement"]');
  await pw.waitFor({ timeout: 15000 });
  await pw.fill("pas-le-bon-mot-de-passe");
  await page.keyboard.press("Enter");
  ok("D0b mauvais mot de passe : refusé, message affiché", await waitFor(async () => /incorrect/i.test(await page.locator('[data-testid="erreur-mot-de-passe"]').innerText().catch(() => "")), 15000));
  await pw.fill(process.env.ADMIN_PASSWORD);
  await page.keyboard.press("Enter");
  const download = await dl;
  ok("D9 le bouton « Télécharger » (mot de passe retapé) déclenche le téléchargement du bon fichier", download.suggestedFilename() === (await rows().first().getAttribute("data-name")));
  // Cookie de déverrouillage posé par la confirmation : les essais suivants le portent.
  const unlocked = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
  ok("D0c cookie de déverrouillage httpOnly, limité au chemin des téléchargements", (await ctx.cookies()).some((c) => c.name === "pf-backup-unlock" && c.httpOnly && c.path === "/api/admin/sauvegardes"));
  ok("D0d le cookie de déverrouillage seul (sans session) ne sert à rien : 401", (await fetch(url, { headers: { cookie: unlocked.split("; ").filter((c) => c.startsWith("pf-backup-unlock=")).join("; ") } })).status === 401);
  cookie = unlocked;
  const res = await fetch(url, { headers: { cookie } });
  const buf = Buffer.from(await res.arrayBuffer());
  ok("D1 téléchargement : 200, pièce jointe gzip", res.status === 200 && /attachment/.test(res.headers.get("content-disposition") ?? "") && res.headers.get("content-type") === "application/gzip", `${res.status}`);
  ok("D2 contenu identique (même sha256 que le fichier du volume)", createHash("sha256").update(buf).digest("hex") === sha(file));
  ok("D3 Content-Length exact, Accept-Ranges", Number(res.headers.get("content-length")) === buf.length && res.headers.get("accept-ranges") === "bytes");
  const r1 = await fetch(url, { headers: { cookie, range: "bytes=0-99" } });
  const b1 = Buffer.from(await r1.arrayBuffer());
  ok("D4 Range : 206, 100 octets, Content-Range", r1.status === 206 && b1.length === 100 && r1.headers.get("content-range") === `bytes 0-99/${buf.length}` && b1.equals(buf.subarray(0, 100)));
  const r2 = await fetch(url, { headers: { cookie, range: "bytes=-50" } });
  ok("D5 Range « derniers 50 octets »", r2.status === 206 && Buffer.from(await r2.arrayBuffer()).equals(buf.subarray(buf.length - 50)));
  const r3 = await fetch(url, { headers: { cookie, range: `bytes=${buf.length + 10}-` } });
  ok("D6 Range hors fichier : 416", r3.status === 416);
  ok("D7 sans session : 401, rien n'est servi", (await fetch(url)).status === 401 && (await fetch(url, { headers: { cookie: "better-auth.session_token=faux" } })).status === 401);
  ok("D8 nom invalide ou chemin : 404", (await fetch(`${BASE}/api/admin/sauvegardes/..%2Fportfolio.db`, { headers: { cookie } })).status === 404 && (await fetch(`${BASE}/api/admin/sauvegardes/portfolio-20200101-000000.tar.gz`, { headers: { cookie } })).status === 404);

  /* ---------------- E. onglet Projets ---------------- */
  await goto("/admin");
  ok("E1 le menu n'a plus d'entrée « Projets »", (await page.locator(".a-nav a", { hasText: /^Projets$/ }).count()) === 0);
  await goto("/admin/projets");
  ok("E2 /admin/projets redirige vers Pages, section Projets", page.url() === `${BASE}/admin/pages#projets`, page.url());
  await goto("/admin/projets?vue=corbeille");
  ok("E3 /admin/projets?vue=corbeille redirige vers la corbeille de Pages", page.url() === `${BASE}/admin/pages?vue=corbeille`, page.url());
  await goto("/admin/pages");
  ok("E4 Pages : section Projets avec « Nouveau projet »", (await page.locator("#projets").getByRole("button", { name: "Nouveau projet" }).count()) === 1);
  ok("E5 Pages : les projets existants sont listés (cartes)", (await page.locator("#projets .a-project-card").count()) >= 1);
  await shot("e-pages-projets");
  const pid = (await page.locator("#projets .a-project-card a.a-strong-link").first().getAttribute("href")).split("/").pop();
  await goto(`/admin/projets/${pid}`);
  ok("E6 l'écran d'un projet reste, avec retour vers Pages", (await page.getByRole("link", { name: /Pages et projets/ }).getAttribute("href")) === "/admin/pages#projets");
  await goto("/admin");
  ok("E7 tableau de bord : « Voir les projets » mène à Pages", (await page.getByRole("link", { name: "Voir les projets" }).getAttribute("href")) === "/admin/pages#projets");

  ok("Z aucune erreur JavaScript", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  failures++;
  console.log("FAIL exception :", e.message.split("\n")[0]);
  await page.screenshot({ path: path.join(SHOTS ?? ".", "e2e-admin76-echec.png"), fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}
console.log(failures ? `e2e-admin76 : ${failures} échec(s)` : "e2e-admin76 : OK");
process.exit(failures ? 1 : 0);
