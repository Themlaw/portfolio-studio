#!/usr/bin/env node
/**
 * Parcours d'import d'un kit Photoshop (phase 6d), UN chromium, UN onglet.
 * Serveur dev requis (redémarré puis pré-chauffé), une connexion.
 *
 * A. Aller-retour du kit v4 (lot 17e) : export de galerie-lumineuse (file lourde,
 *    archive .zip de trois PSD) → retouches simulées (flèche droite redessinée en
 *    grand, décor à calques libres) → refus d'un fichier qui n'est pas un PSD
 *    (PNG légitime généré par ffmpeg) → envoi de l'archive entière, d'un seul PSD
 *    (les autres fichiers « pas envoyé : inchangé »), puis de deux PSD choisis
 *    ensemble → revue groupée par fichier → « Appliquer au thème » : copie
 *    brouillon (décor libre de 4 plans), éditeur et aperçu.
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
const SHOTS = process.env.SHOTS ?? "screenshots/phase6d";
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

// Refus : un fichier légitime qui n'est pas un PSD (PNG généré par sharp) nommé .psd.
const NOT_PSD = path.join(DIR, "pas-un-kit.psd");
await sharp({ create: { width: 640, height: 360, channels: 3, background: "#6c8ebf" } }).png().toFile(NOT_PSD);

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

/** Envoi de fichiers (PSD, archive ou plusieurs PSD choisis ensemble) sur l'écran du kit, puis revue complète (`count` cartes). */
async function sendAndReview(files, count) {
  await page.goto(`${BASE}/admin/themes/galerie-lumineuse/kit`, { waitUntil: "networkidle" });
  await page.setInputFiles('[data-testid="kit-file"]', files);
  await page.waitForURL(/\/kit\?import=/, { timeout: 180000 });
  await page.locator(".a-kit-card").nth(count - 1).waitFor({ timeout: 240000 });
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => [...document.querySelectorAll(".a-kit-card img")].every((i) => i.complete), null, { timeout: 30000 });
  const cards = await page.$$eval(".a-kit-card", (els) => els.map((e) => ({ slot: e.dataset.slot, change: e.dataset.change, status: e.dataset.status, title: e.querySelector("h3")?.textContent ?? "" })));
  const imgs = await page.$$eval('.a-kit-card[data-slot="icones/fleche-droite"] img', (els) => els.map((i) => ({ alt: i.alt, w: i.naturalWidth })));
  const sections = await page.$$eval(".a-kit-file", (els) => els.map((e) => ({ file: e.dataset.file, received: e.dataset.received, title: e.querySelector("h3")?.textContent ?? "", cards: e.querySelectorAll(".a-kit-card").length })));
  return { cards, imgs, sections };
}

async function apply() {
  const mirror = page.locator('[data-testid="kit-mirror"]');
  ok("revue : miroir de la flèche proposé, coché par défaut", (await mirror.count()) === 1 && (await mirror.isChecked()));
  await Promise.all([page.waitForURL(/\/admin\/themes\/galerie-lumineuse-kit[a-z0-9-]*$/, { timeout: 60000 }), page.getByRole("button", { name: "Appliquer au thème" }).click()]);
  const id = page.url().split("/").pop();
  created.push(id);
  return id;
}
const tsx = (code) => execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { env: { ...process.env, DATA_DIR: DATA }, encoding: "utf8" });
const themeData = (id) =>
  JSON.parse(
    tsx(`import { getDb, schema } from "./src/lib/db/index.ts"; import { eq } from "drizzle-orm";
     console.log(getDb().select().from(schema.themes).where(eq(schema.themes.id, ${JSON.stringify(id)})).get()?.data ?? "null");`),
  );
const sim = (...args) => execFileSync(process.execPath, ["--import", "tsx", "scripts/kit-poc/simulate-multi.mts", ...args], { stdio: "ignore" });

/* ---- A. Aller-retour du kit v4 : archive de trois PSD ------------------- */
const kitUrl = `${BASE}/admin/api/theme-kit/galerie-lumineuse`;
let ready = false;
for (let i = 0; i < 90 && !ready; i++) {
  const res = await page.request.post(kitUrl, { headers: { origin: BASE } });
  ready = (await res.json()).ready === true;
  if (!ready) await sleep(2000);
}
ok("export du kit v4 (file lourde) prêt", ready);
const kitFile = path.join(DIR, "kit-v4.zip");
const dl = await page.request.get(kitUrl);
const kitBytes = await dl.body();
writeFileSync(kitFile, kitBytes);
ok("kit téléchargé : archive .zip (pièce jointe kit-galerie-lumineuse.zip)", dl.ok() && /application\/zip/.test(dl.headers()["content-type"] ?? "") && /kit-galerie-lumineuse\.zip/.test(dl.headers()["content-disposition"] ?? "") && kitBytes.subarray(0, 2).toString("latin1") === "PK");
const iconPsd = path.join(DIR, "icones-modifie.psd");
const decorPsd = path.join(DIR, "decor-libre.psd");
const zipEdited = path.join(DIR, "kit-v4-modifie.zip");
const parts = path.join(DIR, "parts");
sim("extract", kitFile, parts);
sim("icone", kitFile, iconPsd);
sim("decor", kitFile, decorPsd);
sim("zip", kitFile, zipEdited, iconPsd);
ok("trois PSD dans l'archive, sous leurs noms d'export", ["1-decor-accueil.psd", "2-logo-papier.psd", "3-icones-curseurs.psd"].every((n) => existsSync(path.join(parts, n))));

await page.goto(`${BASE}/admin/themes/galerie-lumineuse/kit`, { waitUntil: "networkidle" });
await page.setInputFiles('[data-testid="kit-file"]', NOT_PSD);
const refusal = await page.locator(".a-kit-drop [role=alert]").textContent({ timeout: 30000 });
ok("fichier qui n'est pas un PSD : refusé, message clair", /pas un fichier Photoshop/.test(refusal ?? ""), refusal ?? "");

// A1. L'archive entière (icônes retouchées dedans) : 16 éléments, un seul redessiné.
const a = await sendAndReview(zipEdited, 16);
const changedA = a.cards.filter((c) => c.change !== "unchanged");
ok("archive : seule « Flèche droite » redessinée (dessin en grand, réduit par le site)", changedA.length === 1 && changedA[0].slot === "icones/fleche-droite" && /Flèche droite : redessinée/.test(changedA[0].title), JSON.stringify(changedA));
ok("archive : 15 inchangés sur 16 (reconnus par l'identifiant d'export), curseurs compris", a.cards.length === 16 && a.cards.filter((c) => c.change === "unchanged").length === 15 && /identifiant du fichier/.test(await page.locator(".a-kit-summary").textContent()));
ok("archive : revue groupée par fichier (décor 5, logo 3, icônes 8), tous reçus", a.sections.map((s) => `${s.file}:${s.received}:${s.cards}`).join(",") === "decor:true:5,logo:true:3,icones:true:8", JSON.stringify(a.sections));
ok("avant / après affichés pour la flèche", a.imgs.length === 2 && a.imgs.every((i) => i.w > 0), JSON.stringify(a.imgs));
await page.screenshot({ path: `${SHOTS}/revue-archive-1440.png`, fullPage: true });

// A2. Un seul PSD envoyé : les deux autres fichiers sont « pas envoyé : inchangé ».
const a2 = await sendAndReview(iconPsd, 8);
ok("un seul PSD : les fichiers décor et logo « pas envoyé : inchangé »", a2.sections.map((s) => `${s.file}:${s.received}`).join(",") === "decor:false,logo:false,icones:true" && a2.sections.filter((s) => s.received === "false").every((s) => /pas envoyé : inchangé/.test(s.title)), JSON.stringify(a2.sections));
ok("un seul PSD : fichier reconnu par son contenu (pas par son nom), flèche seule redessinée", a2.cards.filter((c) => c.change !== "unchanged").map((c) => c.slot).join() === "icones/fleche-droite", JSON.stringify(a2.cards.map((c) => `${c.slot}:${c.change}`)));
await page.screenshot({ path: `${SHOTS}/revue-un-fichier-1440.png`, fullPage: true });

// A3. Deux PSD choisis ensemble (décor à calques libres + icônes) : un seul import, décor libre appliqué.
const a3 = await sendAndReview([decorPsd, iconPsd], 12);
ok("deux PSD choisis ensemble : un import, logo « pas envoyé », décor 4 plans + icônes 8", a3.sections.map((s) => `${s.file}:${s.received}:${s.cards}`).join(",") === "decor:true:4,logo:false:0,icones:true:8", JSON.stringify(a3.sections));
const decorCards = a3.cards.filter((c) => c.slot.startsWith("decor/"));
ok("décor libre : 4 plans (3 inchangés d'un plan exporté, « mes nuages » redessiné)", decorCards.length === 4 && decorCards.filter((c) => c.change === "unchanged").length === 3 && decorCards.filter((c) => c.change === "redrawn").length === 1 && /mes nuages/.test(decorCards[1].title), JSON.stringify(decorCards));
ok("décor libre : résumé « composition changée »", /composition changée/.test((await page.locator('[data-testid="kit-decor-summary"]').textContent()) ?? ""));
await page.screenshot({ path: `${SHOTS}/revue-decor-libre-1440.png`, fullPage: true });
const draftA = await apply();
ok("« Appliquer » : copie brouillon créée, éditeur ouvert", /galerie-lumineuse-kit/.test(draftA) && (await page.locator("h1").first().textContent()).includes("(kit)"));
const dataA = themeData(draftA);
ok("copie : décor libre = 4 plans, ils remplacent tout le décor (plansOnly)", dataA?.assets?.kit?.plansOnly === true && dataA.assets.kit.plans?.length === 4 && dataA.assets.kit.plans.every(Boolean), JSON.stringify(dataA?.assets?.kit?.plans?.map((p) => Object.keys(p).join("+"))));
await page.locator("iframe").first().waitFor({ timeout: 30000 });
await sleep(2500);
await page.screenshot({ path: `${SHOTS}/copie-brouillon-apercu-1440.png` });
// Aperçu public du brouillon : le hero n'a que les 4 plans.
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
}, draftA);
await page.waitForURL(/\/fr$/, { timeout: 60000 });
await page.waitForLoadState("networkidle");
await sleep(1500);
const planCount = await page.locator(".hero-parallax .hero-layer-kit").count();
const svgLayers = await page.locator(".hero-parallax .absolute > img").count();
ok("accueil du brouillon : exactement 4 plans dans le hero (les calques SVG du thème ne s'y ajoutent pas)", planCount === 4 && svgLayers === 0, `${planCount} plans, ${svgLayers} calques SVG`);
await page.screenshot({ path: `${SHOTS}/accueil-decor-libre-1440.png` });
await page.request.post(`${BASE}/admin/apercu/quitter`, { headers: { origin: BASE } }).catch(() => {});

/* ---- B. Fichier réel de l'artiste -------------------------------------- */
const b = await sendAndReview(path.resolve("tests/fixtures/kit-synthetique.psd"), 14);
ok("ancien kit v1 (un seul fichier) : lu comme avant, 14 cartes, sans titre de fichier", b.cards.length === 14 && b.sections.length === 0, JSON.stringify(b.sections));
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
// Flèches de la bande (lot médias) : posées sur ses bords, visibles au survol.
const stripVp = page.locator(".strip-viewport:has(.strip-nav)").last();
const rail = stripVp.locator(".strip-nav-next");
await rail.scrollIntoViewIfNeeded();
await stripVp.hover();
await sleep(400);
const rb = await rail.boundingBox();
const prev = await stripVp.locator(".strip-nav-prev").boundingBox();
const clipX = Math.max(0, prev.x - 40);
const railClip = { x: clipX, y: rb.y - 30, width: Math.min(page.viewportSize().width - clipX, rb.x + rb.width - clipX + 40), height: rb.height + 60 };
await page.screenshot({ path: `${SHOTS}/fleche-artiste-rail-1440.png`, clip: railClip });
// Agrandi × 4 (gauche : flèche du thème ; droite : celle de l'artiste).
await sharp(await page.screenshot({ clip: railClip })).resize({ width: Math.round(railClip.width * 4), kernel: "lanczos3" }).toFile(`${SHOTS}/fleche-artiste-rail-zoom.png`);
const maskOk = await page.$eval('.strip-nav [data-icon="arrow-right"]', (e) => getComputedStyle(e).maskImage.includes("/media/kit/"));
ok("rail : la flèche droite est le dessin de l'artiste (masque /media/kit)", maskOk);
const leftMask = await page.$eval('.strip-nav [data-icon="arrow-left"]', (e) => getComputedStyle(e).maskImage);
ok("rail : la flèche gauche est son miroir (paire cohérente, case cochée par défaut)", leftMask.includes("/media/kit/") && !leftMask.includes(await page.$eval('.strip-nav [data-icon="arrow-right"]', (e) => getComputedStyle(e).maskImage)));
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
