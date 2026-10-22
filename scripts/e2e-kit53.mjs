#!/usr/bin/env node
/**
 * Lot 53 « Kit PSD » (ticket 39). Chromium, serveur requis, une connexion.
 *  K1  Fichier tronqué : « Le fichier semble abîmé ou incomplet » (plus « vérifie l'espace disque »).
 *  K2  Un nouvel envoi efface l'ancienne revue AVANT d'afficher son erreur (aucune carte, aucun titre « Revue de » sous l'erreur).
 *  K3  Fichier vide : « est vide » (plus « Requête invalide »).
 *  K4  Export : bouton désactivé pendant la génération, indicateur visible, un seul export à la fois (une seule demande partie).
 *  K5  « Appliquer à mon thème » (lot 60) : bouton bloqué avec indicateur dès le clic, un seul clic envoyé ; version de Mon thème créée.
 *  K6  Tuto : plus de « logo d'une seule couleur » ; la consigne dit « couleurs gardées, ou une seule couleur teintée ».
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [SHOTS=dossier] node scripts/e2e-kit53.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { login, waitFor } from "./lib/medias-setup.mjs";

const BASE = process.env.BASE ?? "http://localhost:3001";
const SHOTS = process.env.SHOTS ?? path.join(tmpdir(), "e2e-kit53");
const DIR = path.join(tmpdir(), "e2e-kit53-work");
mkdirSync(SHOTS, { recursive: true });
mkdirSync(DIR, { recursive: true });
const THEME = "galerie-lumineuse";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await login(page, BASE);

// Kit exporté (file lourde), puis les PSD extraits.
const kitUrl = `${BASE}/admin/api/theme-kit/${THEME}`;
let ready = false;
for (let i = 0; i < 90 && !ready; i++) {
  const res = await page.request.post(kitUrl, { headers: { origin: BASE } });
  ready = (await res.json()).ready === true;
  if (!ready) await sleep(2000);
}
ok("export du kit prêt", ready);
const zip = path.join(DIR, "kit.zip");
writeFileSync(zip, await (await page.request.get(kitUrl)).body());
const parts = path.join(DIR, "parts");
execFileSync(process.execPath, ["--import", "tsx", "scripts/kit-poc/simulate-multi.mts", "extract", zip, parts], { stdio: "ignore" });
const iconsPsd = path.join(DIR, "icones-modifie.psd");
execFileSync(process.execPath, ["--import", "tsx", "scripts/kit-poc/simulate-multi.mts", "icone", zip, iconsPsd], { stdio: "ignore" });
const truncated = path.join(DIR, "tronque.psd");
const whole = readFileSync(path.join(parts, "3-icones-curseurs.psd"));
writeFileSync(truncated, whole.subarray(0, Math.floor(whole.length * 0.4)));
const empty = path.join(DIR, "vide.psd");
writeFileSync(empty, Buffer.alloc(0));

const kitPage = `${BASE}/admin/themes/${THEME}/kit`;
const dropError = () => page.locator(".a-kit-drop [role=alert]").textContent({ timeout: 60000 });

/* ---- K2 / K1 : revue valide, puis envoi tronqué ------------------------------------------------------------------------ */
await page.goto(kitPage, { waitUntil: "networkidle" });
await page.setInputFiles('[data-testid="kit-file"]', iconsPsd);
await page.waitForURL(/\/kit\?import=/, { timeout: 180000 });
await page.locator(".a-kit-card").first().waitFor({ timeout: 240000 });
ok("K2a revue du premier envoi affichée", (await page.locator(".a-kit-card").count()) > 0);
const importUrl = page.url();

await page.setInputFiles('[data-testid="kit-file"]', truncated);
const msg = await dropError();
ok("K1 fichier tronqué : « Le fichier semble abîmé ou incomplet »", /Le fichier semble abîmé ou incomplet/.test(msg ?? "") && !/espace disque/.test(msg ?? ""), msg ?? "");
await sleep(1500);
ok("K2b l'ancienne revue a disparu (aucune carte, pas de titre « Revue de »)", (await page.locator(".a-kit-card").count()) === 0 && (await page.locator("#kit-review").count()) === 0, page.url());
await page.screenshot({ path: path.join(SHOTS, "K2-erreur-sans-revue.png"), fullPage: true });

/* ---- K3 : fichier vide ---------------------------------------------------------------------------------------------- */
await page.setInputFiles('[data-testid="kit-file"]', empty);
const msgEmpty = await dropError();
ok("K3 fichier vide : « est vide » (pas « Requête invalide »)", /est vide/.test(msgEmpty ?? "") && !/Requête invalide/.test(msgEmpty ?? ""), msgEmpty ?? "");

/* ---- K4 : export, bouton bloqué + indicateur --------------------------------------------------------------------------- */
await page.goto(kitPage, { waitUntil: "networkidle" });
let posts = 0;
await page.route(`**/admin/api/theme-kit/${THEME}`, async (route) => {
  if (route.request().method() === "POST") {
    posts++;
    await sleep(2500);
  }
  await route.continue();
});
const dlBtn = page.locator('[data-testid="kit-download"]');
await dlBtn.click();
await sleep(300);
ok("K4a bouton « Télécharger » désactivé pendant la génération", await dlBtn.isDisabled());
ok("K4b indicateur de progression visible", await page.locator('[data-testid="kit-download-progress"]').isVisible());
await dlBtn.click({ force: true, timeout: 2000 }).catch(() => {});
await sleep(2800);
await waitFor(async () => !(await dlBtn.isDisabled()), 60000);
ok("K4c un seul export à la fois (une seule demande partie)", posts === 1, `posts=${posts}`);
await page.unroute(`**/admin/api/theme-kit/${THEME}`);

/* ---- K5 : Appliquer au thème ------------------------------------------------------------------------------------------ */
await page.goto(importUrl, { waitUntil: "networkidle" });
await page.locator(".a-kit-card").first().waitFor({ timeout: 60000 });
let applies = 0;
await page.route("**/admin/themes/**", async (route) => {
  const req = route.request();
  if (req.method() === "POST" && req.headers()["next-action"]) {
    applies++;
    await sleep(2500);
  }
  await route.continue();
});
const apply = page.getByRole("button", { name: /Appliquer à mon thème|Création de la version/ });
if (await apply.isEnabled()) {
  await apply.click();
  await sleep(500);
  ok("K5a bouton bloqué dès le clic", await page.locator(".a-kit-apply button.a-btn-primary").isDisabled());
  ok("K5b indicateur « Création de la version »", /Création de la version/.test((await page.locator('[data-testid="kit-apply-status"]').textContent({ timeout: 3000 }).catch(() => "")) ?? ""));
  await page.locator(".a-kit-apply button.a-btn-primary").click({ force: true, timeout: 1500 }).catch(() => {});
  await page.waitForURL((u) => u.pathname === "/admin/themes" && /nouvelle=\d+&via=kit/.test(u.search), { timeout: 90000 });
  ok("K5c un seul clic envoyé, retour à l'écran Thèmes avec l'encart « Version N de Mon thème créée »", applies === 1 && (await page.locator('[data-testid="new-version-notice"]').count()) === 1, `applies=${applies}`);
  await page.unroute("**/admin/themes/**");
  await page.screenshot({ path: path.join(SHOTS, "K5-version.png") });
  // Nettoyage : Mon thème créé par ce parcours (et ses versions).
  execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `import { getDb, schema } from "./src/lib/db/index.ts"; import { eq } from "drizzle-orm"; const db = getDb(); for (const t of db.select().from(schema.themes).where(eq(schema.themes.mine, true)).all()) { db.delete(schema.themeVersions).where(eq(schema.themeVersions.themeId, t.id)).run(); db.delete(schema.themes).where(eq(schema.themes.id, t.id)).run(); }`], { env: { ...process.env }, stdio: "ignore" });
} else {
  ok("K5 « Appliquer à mon thème » disponible (une flèche redessinée)", false, "bouton désactivé");
}

/* ---- K6 : texte du tuto ------------------------------------------------------------------------------------------------ */
const slides = readFileSync("src/app/admin/(espace)/themes/tuto/slides.ts", "utf8");
ok("K6 tuto : plus de « logo d'une seule couleur »", !/logo d'une seule couleur/.test(slides) && /une seule couleur teintée par le Nom du site/.test(slides));

await browser.close();
console.log(failures ? `kit53 : ${failures} échec(s)` : "kit53 : tout est bon");
process.exit(failures ? 1 : 0);
