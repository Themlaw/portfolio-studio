#!/usr/bin/env node
/**
 * Kit Photoshop : parcours de l'illustratrice (lot 17a), UN chromium, UN onglet.
 * Serveur dev requis (redémarré puis pré-chauffé), une connexion.
 *
 *  B1. Kit de « Studio » exporté (archive de trois PSD, lot 17e) ; seul le fichier
 *      « logo et papier » est retouché (tuile de cœurs 1024 × 1024, logo
 *      2400 × 600) et envoyé : la revue dit les deux autres fichiers « pas envoyé :
 *      inchangé », le logo et le papier sont réduits à leur taille d'usage.
 *  B2. Le fichier est envoyé sur l'écran d'un AUTRE thème (« Pro » : mauvaise carte
 *      cliquée) : il est appliqué à son thème d'origine (Studio) par défaut, le
 *      thème visé est annoncé et modifiable, les variantes (strip « edge »)
 *      sont gardées, aucun scotch ajouté.
 *  B7. Le papier ne passe plus sous le bandeau du haut (aplat), sauf option.
 *  B5. Accueil de la copie : captures du bandeau (logo, papier) pour contrôle.
 * Captures : $SHOTS (défaut screenshots/lot17a). Les copies brouillon et imports
 * créés sont supprimés à la fin.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… node scripts/e2e-kit-theme.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { gotoThemesPage } from "./lib/theme-live.mjs";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const SHOTS = process.env.SHOTS ?? "screenshots/lot17a";
mkdirSync(SHOTS, { recursive: true });
const DIR = path.join(tmpdir(), "e2e-kit-theme");
mkdirSync(DIR, { recursive: true });
const DATA = process.env.DATA_DIR ?? "./data";
const OPAQUE_LOGO = process.env.OPAQUE_LOGO === "1";

let failures = 0;
function ok(label, cond, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tsx = (code) =>
  execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { env: { ...process.env, DATA_DIR: DATA }, encoding: "utf8" });
const themeData = (id) =>
  JSON.parse(
    tsx(`import { getDb, schema } from "./src/lib/db/index.ts"; import { eq } from "drizzle-orm";
     console.log(getDb().select().from(schema.themes).where(eq(schema.themes.id, ${JSON.stringify(id)})).get()?.data ?? "null");`),
  );

const mineId = () => tsx(`import { getDb, schema } from "./src/lib/db/index.ts"; import { eq } from "drizzle-orm";
     console.log(getDb().select().from(schema.themes).where(eq(schema.themes.mine, true)).get()?.id ?? "");`).trim().split("\n").pop();

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const created = [];

await page.goto(`${BASE}/admin/connexion`, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL);
await page.fill("#password", PASSWORD);
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/admin/connexion"), { timeout: 60000 }), page.click("button[type=submit]")]);

/* ---- Export du kit de Studio (archive de trois PSD), retouches « Photoshop » ------ */
const kitUrl = `${BASE}/admin/api/theme-kit/studio`;
let ready = false;
for (let i = 0; i < 90 && !ready; i++) {
  const res = await page.request.post(kitUrl, { headers: { origin: BASE } });
  ready = (await res.json()).ready === true;
  if (!ready) await sleep(2000);
}
ok("export du kit de Studio prêt", ready);
const kitFile = path.join(DIR, "kit-studio.zip");
const dl = await page.request.get(kitUrl);
writeFileSync(kitFile, await dl.body());
ok("kit téléchargé : archive .zip (pièce jointe kit-studio.zip)", dl.ok() && /application\/zip/.test(dl.headers()["content-type"] ?? "") && /kit-studio\.zip/.test(dl.headers()["content-disposition"] ?? "") && (await dl.body()).subarray(0, 2).toString("latin1") === "PK");
// Seul le fichier « logo et papier » est retouché (tuile de cœurs en 1024 × 1024, logo en 2400 × 600) ET c'est le seul envoyé.
const edited = path.join(DIR, "logo-papier-retouche.psd");
execFileSync(process.execPath, ["--import", "tsx", "scripts/kit-poc/simulate-multi.mts", "studio", kitFile, edited, ...(OPAQUE_LOGO ? ["--opaque-logo"] : [])], { stdio: "inherit" });

/* ---- Envoi sur l'écran d'un AUTRE thème (Pro) ------------------------------ */
await page.goto(`${BASE}/admin/themes/pro/kit`, { waitUntil: "networkidle" });
await page.setInputFiles('[data-testid="kit-file"]', edited);
await page.waitForURL(/\/kit\?import=/, { timeout: 120000 });
await page.locator(".a-kit-card").nth(2).waitFor({ timeout: 240000 });
await page.waitForLoadState("networkidle");
await page.waitForFunction(() => [...document.querySelectorAll(".a-kit-card img")].every((i) => i.complete), null, { timeout: 30000 });
await page.screenshot({ path: `${SHOTS}/revue-1440.png`, fullPage: true });

const cards = await page.$$eval(".a-kit-card", (els) => els.map((e) => ({ slot: e.dataset.slot, change: e.dataset.change, status: e.dataset.status, msgs: [...e.querySelectorAll("li")].map((l) => l.textContent) })));
const changed = cards.filter((c) => c.change !== "unchanged").map((c) => c.slot);
console.log("éléments changés :", changed.join(", "));
const sig = cards.find((c) => c.slot === "signature");
console.log("signature :", JSON.stringify(sig));

// Lot 17e : la revue est groupée par fichier ; les fichiers non envoyés sont dits « pas envoyé : inchangé ».
const files = await page.$$eval(".a-kit-file", (els) => els.map((e) => ({ file: e.dataset.file, received: e.dataset.received, title: e.querySelector("h3")?.textContent ?? "" })));
ok("B1 revue : trois fichiers listés, seul « logo et papier » reçu", files.map((f) => `${f.file}:${f.received}`).join(",") === "decor:false,logo:true,icones:false", JSON.stringify(files));
ok("B1 revue : les fichiers manquants disent « pas envoyé : inchangé »", files.filter((f) => f.received === "false").every((f) => /pas envoyé : inchangé/.test(f.title)), JSON.stringify(files));
ok("B1 revue : logo et papier redessinés (le trait, intact, est reconnu inchangé)", changed.includes("signature") && changed.includes("papier") && cards.find((c) => c.slot === "trait")?.change === "unchanged", changed.join(","));
ok("B1 revue : plus de section « Couleurs de la palette » (la palette sort du kit)", (await page.locator("[data-testid=kit-colors-review]").count()) === 0);

// B2 : thème visé annoncé, Studio par défaut (thème d'origine du kit), pas Pro.
const baseSel = page.locator('[data-testid="kit-base-select"]');
ok("B2 revue : la cible est annoncée (lot 60 : Mon thème, créé à partir de Studio, thème d'origine du kit)", (await page.locator('[data-testid="kit-base"]').count()) === 1 && /Studio/.test((await page.locator('[data-testid="kit-base"]').textContent()) ?? ""), (await page.locator('[data-testid="kit-base"]').textContent().catch(() => "")) ?? "");
ok("B2 revue : kit d'origine reconnu malgré l'écran de Pro (élément inchangé)", cards.filter((c) => c.change === "unchanged").length >= 1, JSON.stringify(cards.map((c) => c.change)));

await Promise.all([page.waitForURL(/\/admin\/themes\?nouvelle=\d+&via=kit/, { timeout: 60000 }), page.getByRole("button", { name: /^Appliquer à mon thème/ }).click()]);
const draftId = mineId();
created.push(draftId);
const data = themeData(draftId);
ok("B2 Mon thème : parti de Studio (variantes gardées, pas de scotch)", data.variants.strip === "edge" && !data.assets?.kit?.tape, JSON.stringify({ name: data?.name, v: data?.variants }));
const studio = themeData("studio");
ok("B1 copie : couleurs de Studio inchangées (le kit ne porte plus de palette)", JSON.stringify(data?.tokens?.color) === JSON.stringify(studio?.tokens?.color), JSON.stringify(data?.tokens?.color));
ok("B1 copie : logo redessiné rangé (réduit de moitié : 1200 px de large au plus)", Boolean(data?.assets?.kit?.signature) && data.assets.kit.signature.w <= 1200 && data.assets.kit.signature.h <= 300, JSON.stringify(data?.assets?.kit?.signature));
ok("B5 copie : décor d'ouverture (calques du hero) = celui de Studio, aucun plan converti (fichier décor non envoyé)", JSON.stringify(data?.assets?.heroLayers) === JSON.stringify(studio?.assets?.heroLayers) && !data?.assets?.kit?.plans, JSON.stringify(data?.assets?.kit?.plans)?.slice(0, 120));
ok("B7 copie : papier présent (tuile réduite à 512 × 512), pas sous le bandeau (défaut)", Boolean(data?.assets?.kit?.paper) && !data.assets.kit.paper.underHeader && data.assets.kit.paper.image.w === 512, JSON.stringify(data?.assets?.kit?.paper));

/* ---- Aperçu de l'accueil : bandeau, papier, logo -------------------------- */
await gotoThemesPage(page, BASE);
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
}, draftId);
await page.waitForURL(/\/fr$/, { timeout: 60000 });
await page.waitForLoadState("networkidle");
await sleep(1500);
await page.screenshot({ path: `${SHOTS}/accueil-haut-1440.png` });
const header = async () => page.$eval(".site-header", (h) => ({ image: getComputedStyle(h).backgroundImage, color: getComputedStyle(h).backgroundColor }));
await page.mouse.wheel(0, 700);
await sleep(900);
const hdr = await header();
await page.screenshot({ path: `${SHOTS}/accueil-defile-1440.png` });
ok("B7 accueil : bandeau collant en aplat OPAQUE (la tuile du fond ne passe pas dessous)", /^rgb\(/.test(hdr.color) && hdr.image === "none", JSON.stringify(hdr));
const bodyImg = await page.$eval("body", (b) => getComputedStyle(b).backgroundImage);
ok("B7 accueil : le papier couvre toujours le fond de la page", /url|image-set/.test(bodyImg), bodyImg);

// Option « Papier sous le bandeau » (éditeur de thème) : la tuile revient.
await page.goto(`${BASE}/admin/themes/${draftId}?etape=papier`, { waitUntil: "networkidle" });
const toggle = page.locator('[data-testid="paper-under-header"]');
ok("B7 éditeur : option « Papier sous le bandeau du haut », décochée par défaut", (await toggle.count()) === 1 && !(await toggle.isChecked()));
if (await toggle.count()) {
  await toggle.check();
  await page.getByRole("button", { name: /Enregistrer/ }).first().click();
  await sleep(2000);
  ok("B7 option cochée : enregistrée dans le thème", themeData(draftId)?.assets?.kit?.paper?.underHeader === true);
  await page.goto(`${BASE}/api/theme-preview?id=${draftId}`, { waitUntil: "networkidle" }).catch(() => {});
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
  }, draftId);
  await page.waitForURL(/\/fr$/, { timeout: 60000 });
  await page.waitForLoadState("networkidle");
  await sleep(1500);
  await page.mouse.wheel(0, 700);
  await sleep(900);
  const hdr2 = await header();
  // La tuile est celle du <body> : sous le bandeau elle n'est cachée que par un aplat OPAQUE.
  ok("B7 option cochée : le bandeau n'est plus un aplat opaque (la tuile repasse dessous)", !/^rgb\(/.test(hdr2.color), JSON.stringify(hdr2));
  await page.screenshot({ path: `${SHOTS}/accueil-defile-papier-sous-bandeau-1440.png` });
}

// Liste des thèmes : lequel est en ligne saute aux yeux.
await gotoThemesPage(page, BASE);
await page.screenshot({ path: `${SHOTS}/liste-themes-1440.png`, fullPage: true });
ok("B2 liste : un seul thème « En ligne » (badge) et une phrase qui le nomme", (await page.locator('[data-testid="theme-live"]').count()) === 1 && /Thème en ligne : /.test((await page.locator('[data-testid="theme-live-banner"]').textContent().catch(() => "")) ?? ""));

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
  console.error(`e2e-kit-theme : ${failures} échec(s)`);
  process.exit(1);
}
console.log("e2e-kit-theme : OK");
