#!/usr/bin/env node
/**
 * Parcours d'import d'un kit Photoshop (phase 6d), UN chromium, UN onglet.
 * Serveur dev requis (redémarré puis pré-chauffé), une connexion.
 *
 * A. Aller-retour : export v2 de galerie-lumineuse (file lourde) → modification
 *    simulée (flèche droite redessinée, recadrée comme par Photoshop) → refus
 *    d'un fichier qui n'est pas un PSD (PNG légitime généré par ffmpeg) →
 *    envoi → revue (flèche « redessinée », le reste « inchangé », avant /
 *    après) → « Appliquer au thème » : copie brouillon, éditeur et aperçu.
 * B. Fichier réel de l'artiste (tests/fixtures/kit-synthetique.psd, kit
 *    v1) : revue, application, puis la flèche de l'artiste rendue dans le
 *    rail des planches et dans la visionneuse (aperçu du brouillon).
 * Captures : screenshots/phase6d. Les copies brouillon et les imports créés
 * sont supprimés à la fin.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… node scripts/e2e-kit.mjs
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";
import sharp from "sharp";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const SHOTS = "screenshots/phase6d";
mkdirSync(SHOTS, { recursive: true });
const DIR = path.join(tmpdir(), "e2e-kit");
mkdirSync(DIR, { recursive: true });
const DATA = process.env.DATA_DIR ?? "./data";

let failures = 0;
function ok(label, cond, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
}

// Manifeste du kit v1 d'origine (empreintes) : le fichier de l'artiste y est reconnu.
const manifests = path.join(DATA, "cache/kits/manifests");
mkdirSync(manifests, { recursive: true });
if (!existsSync(path.join(manifests, "legacy-galerie-lumineuse-v1.json"))) copyFileSync("tests/fixtures/kit-galerie-lumineuse-v1.manifest.json", path.join(manifests, "legacy-galerie-lumineuse-v1.json"));

// Refus : un fichier légitime qui n'est pas un PSD (PNG ffmpeg) nommé .psd.
const NOT_PSD = path.join(DIR, "pas-un-kit.psd");
execFileSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=1", "-frames:v", "1", "-f", "image2", "-c:v", "png", NOT_PSD]);

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const created = [];

await page.goto(`${BASE}/admin/connexion`, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL);
await page.fill("#password", PASSWORD);
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/admin/connexion"), { timeout: 60000 }), page.click("button[type=submit]")]);

/** Envoi d'un PSD sur l'écran du kit, puis revue complète (14 cartes). */
async function sendAndReview(file) {
  await page.goto(`${BASE}/admin/themes/galerie-lumineuse/kit`, { waitUntil: "networkidle" });
  await page.setInputFiles('[data-testid="kit-file"]', file);
  await page.waitForURL(/\/kit\?import=/, { timeout: 120000 });
  await page.locator(".a-kit-card").nth(13).waitFor({ timeout: 180000 });
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => [...document.querySelectorAll(".a-kit-card img")].every((i) => i.complete), null, { timeout: 30000 });
  const cards = await page.$$eval(".a-kit-card", (els) => els.map((e) => ({ slot: e.dataset.slot, change: e.dataset.change, status: e.dataset.status, title: e.querySelector("h3")?.textContent ?? "" })));
  const imgs = await page.$$eval('.a-kit-card[data-slot="icones/fleche-droite"] img', (els) => els.map((i) => ({ alt: i.alt, w: i.naturalWidth })));
  return { cards, imgs };
}

async function apply() {
  const mirror = page.locator('[data-testid="kit-mirror"]');
  ok("revue : miroir de la flèche proposé, coché par défaut", (await mirror.count()) === 1 && (await mirror.isChecked()));
  await Promise.all([page.waitForURL(/\/admin\/themes\/galerie-lumineuse-kit[a-z0-9-]*$/, { timeout: 60000 }), page.getByRole("button", { name: "Appliquer au thème" }).click()]);
  const id = page.url().split("/").pop();
  created.push(id);
  return id;
}

/* ---- A. Aller-retour v2 ------------------------------------------------- */
const kitUrl = `${BASE}/admin/api/theme-kit/galerie-lumineuse`;
let ready = false;
for (let i = 0; i < 90 && !ready; i++) {
  const res = await page.request.post(kitUrl, { headers: { origin: BASE } });
  ready = (await res.json()).ready === true;
  if (!ready) await sleep(2000);
}
ok("export du kit v2 (file lourde) prêt", ready);
const kitFile = path.join(DIR, "kit-v2.psd");
const dl = await page.request.get(kitUrl);
writeFileSync(kitFile, await dl.body());
ok("kit v2 téléchargé (PSD)", dl.ok() && (await dl.body()).subarray(0, 4).toString("latin1") === "8BPS");
const edited = path.join(DIR, "kit-v2-modifie.psd");
execFileSync(process.execPath, ["--import", "tsx", "scripts/kit-poc/simulate-edit.mts", kitFile, edited], { stdio: "ignore" });

await page.goto(`${BASE}/admin/themes/galerie-lumineuse/kit`, { waitUntil: "networkidle" });
await page.setInputFiles('[data-testid="kit-file"]', NOT_PSD);
const refusal = await page.locator(".a-kit-drop [role=alert]").textContent({ timeout: 30000 });
ok("fichier qui n'est pas un PSD : refusé, message clair", /pas un fichier Photoshop/.test(refusal ?? ""), refusal ?? "");

const a = await sendAndReview(edited);
const changedA = a.cards.filter((c) => c.change !== "unchanged");
ok("aller-retour : seule « Flèche droite » redessinée", changedA.length === 1 && changedA[0].slot === "icones/fleche-droite" && /Flèche droite : redessinée/.test(changedA[0].title), JSON.stringify(changedA));
ok("aller-retour : 13 inchangés (reconnus par l'identifiant d'export)", a.cards.filter((c) => c.change === "unchanged").length === 13 && /identifiant du fichier/.test(await page.locator(".a-kit-summary").textContent()));
ok("avant / après affichés pour la flèche", a.imgs.length === 2 && a.imgs.every((i) => i.w > 0), JSON.stringify(a.imgs));
await page.screenshot({ path: `${SHOTS}/revue-aller-retour-1440.png`, fullPage: true });
const draftA = await apply();
ok("« Appliquer » : copie brouillon créée, éditeur ouvert", /galerie-lumineuse-kit/.test(draftA) && (await page.locator("h1").first().textContent()).includes("(kit)"));
await page.locator("iframe").first().waitFor({ timeout: 30000 });
await sleep(2500);
await page.screenshot({ path: `${SHOTS}/copie-brouillon-apercu-1440.png` });

/* ---- B. Fichier réel de l'artiste -------------------------------------- */
const b = await sendAndReview(path.resolve("tests/fixtures/kit-synthetique.psd"));
const changedB = b.cards.filter((c) => c.change !== "unchanged");
ok("fichier de l'artiste : seule « Flèche droite » redessinée", changedB.length === 1 && changedB[0].slot === "icones/fleche-droite", JSON.stringify(changedB));
ok("fichier de l'artiste : « Plan 3 : inchangé »", b.cards.some((c) => c.slot === "hero/plan-3" && /Plan 3 : inchangé/.test(c.title)));
await page.screenshot({ path: `${SHOTS}/revue-fichier-artiste-1440.png`, fullPage: true });
const draftB = await apply();

// Aperçu du brouillon sur le site (formulaire natif, comme « Prévisualiser »).
await page.goto(`${BASE}/admin/themes`, { waitUntil: "networkidle" });
await page.evaluate((id) => {
  const f = document.createElement("form");
  f.method = "post";
  f.action = "/admin/apercu";
  const i = document.createElement("input");
  i.name = "id";
  i.value = id;
  f.append(i);
  document.body.append(f);
  f.submit();
}, draftB);
await page.waitForURL(/\/fr$/, { timeout: 60000 });
await page.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
const kitAttr = await page.evaluate(() => document.documentElement.hasAttribute("data-kit-icon-arrow-right"));
ok("brouillon en aperçu : flèche droite du kit active", kitAttr);
const rail = page.locator(".rail-arrow").last();
await rail.scrollIntoViewIfNeeded();
const rb = await rail.boundingBox();
const prev = await page.locator(".rail-arrow").first().boundingBox();
const railClip = { x: prev.x - 40, y: rb.y - 30, width: rb.x + rb.width - prev.x + 80, height: rb.height + 60 };
await page.screenshot({ path: `${SHOTS}/fleche-artiste-rail-1440.png`, clip: railClip });
// Agrandi × 4 (gauche : flèche du thème ; droite : celle de l'artiste).
await sharp(await page.screenshot({ clip: railClip })).resize({ width: Math.round(railClip.width * 4), kernel: "lanczos3" }).toFile(`${SHOTS}/fleche-artiste-rail-zoom.png`);
const maskOk = await page.$eval('.rail-arrow [data-icon="arrow-right"]', (e) => getComputedStyle(e).maskImage.includes("/media/kit/"));
ok("rail : la flèche droite est le dessin de l'artiste (masque /media/kit)", maskOk);
const leftMask = await page.$eval('.rail-arrow [data-icon="arrow-left"]', (e) => getComputedStyle(e).maskImage);
ok("rail : la flèche gauche est son miroir (paire cohérente, case cochée par défaut)", leftMask.includes("/media/kit/") && !leftMask.includes(await page.$eval('.rail-arrow [data-icon="arrow-right"]', (e) => getComputedStyle(e).maskImage)));
// Une planche d'au moins deux images : la visionneuse montre alors ses flèches.
await page.locator(".strip").filter({ has: page.locator(".strip-frame:nth-child(2)") }).first().locator(".strip-frame").first().click();
await page.locator(".lightbox-frame").waitFor({ timeout: 15000 });
await sleep(800);
await page.screenshot({ path: `${SHOTS}/fleche-artiste-visionneuse-1440.png` });
const next = await page.locator('.lightbox [data-icon="arrow-right"]').boundingBox();
await sharp(await page.screenshot({ clip: { x: next.x - 24, y: next.y - 24, width: next.width + 48, height: next.height + 48 } }))
  .resize({ width: Math.round((next.width + 48) * 4), kernel: "lanczos3" })
  .toFile(`${SHOTS}/fleche-artiste-visionneuse-zoom.png`);
const lbOk = await page.$eval('.lightbox [data-icon="arrow-right"]', (e) => getComputedStyle(e).maskImage.includes("/media/kit/"));
ok("visionneuse : la flèche droite est le dessin de l'artiste", lbOk);
await page.keyboard.press("Escape");
// Quitter l'aperçu (POST même origine, comme le bandeau).
await page.request.post(`${BASE}/admin/apercu/quitter`, { headers: { origin: BASE } }).catch(() => {});

ok("aucune erreur JS", errors.length === 0, errors.join(" | "));
await browser.close();

// Ménage : copies brouillon et imports créés par ce parcours.
execFileSync(
  process.execPath,
  [
    "--import",
    "tsx",
    "--input-type=module",
    "-e",
    `import { getDb, schema } from "./src/lib/db/index.ts"; import { inArray } from "drizzle-orm"; import { rmSync, readdirSync, readFileSync } from "node:fs";
     getDb().delete(schema.themes).where(inArray(schema.themes.id, ${JSON.stringify(created)})).run();
     const dir = "${DATA}/kit-imports"; for (const n of readdirSync(dir)) { const m = JSON.parse(readFileSync(dir + "/" + n + "/meta.json", "utf8")); if (${JSON.stringify(created)}.includes(m.appliedThemeId)) rmSync(dir + "/" + n, { recursive: true, force: true }); }`,
  ],
  { stdio: "inherit", env: { ...process.env, DATA_DIR: DATA } },
);
console.log(`brouillons supprimés : ${created.join(", ")}`);
if (failures) {
  console.error(`e2e-kit : ${failures} échec(s)`);
  process.exit(1);
}
console.log("e2e-kit : OK");
