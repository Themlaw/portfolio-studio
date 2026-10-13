#!/usr/bin/env node
/**
 * Kit Photoshop : parcours de l'illustratrice (lot 17a), UN chromium, UN onglet.
 * Serveur dev requis (redémarré puis pré-chauffé), une connexion.
 *
 *  B1. Kit de « Studio » exporté, palette repeinte par cinq gestes naturels de
 *      Photoshop (pot de peinture, calque ajouté, pinceau partiel, incrustation
 *      couleur, calque de forme), tuile de cœurs, logo : TOUTES les couleurs
 *      sont lues et appliquées à la copie.
 *  B2. Le kit est envoyé sur l'écran d'un AUTRE thème (« Pro » : mauvaise carte
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

/* ---- Export du kit de Studio, retouches « Photoshop » ----------------------- */
const kitUrl = `${BASE}/admin/api/theme-kit/studio`;
let ready = false;
for (let i = 0; i < 90 && !ready; i++) {
  const res = await page.request.post(kitUrl, { headers: { origin: BASE } });
  ready = (await res.json()).ready === true;
  if (!ready) await sleep(2000);
}
ok("export du kit de Studio prêt", ready);
const kitFile = path.join(DIR, "kit-studio.psd");
writeFileSync(kitFile, await (await page.request.get(kitUrl)).body());
const edited = path.join(DIR, "kit-studio-retouche.psd");
execFileSync(process.execPath, ["--import", "tsx", "scripts/kit-poc/simulate-17a.mts", kitFile, edited, ...(OPAQUE_LOGO ? ["--opaque-logo"] : [])], { stdio: "inherit" });

/* ---- Envoi sur l'écran d'un AUTRE thème (Pro) ------------------------------ */
await page.goto(`${BASE}/admin/themes/pro/kit`, { waitUntil: "networkidle" });
await page.setInputFiles('[data-testid="kit-file"]', edited);
await page.waitForURL(/\/kit\?import=/, { timeout: 120000 });
await page.locator(".a-kit-card").nth(10).waitFor({ timeout: 240000 });
await page.waitForLoadState("networkidle");
await page.waitForFunction(() => [...document.querySelectorAll(".a-kit-card img")].every((i) => i.complete), null, { timeout: 30000 });
await page.screenshot({ path: `${SHOTS}/revue-1440.png`, fullPage: true });

const cards = await page.$$eval(".a-kit-card", (els) => els.map((e) => ({ slot: e.dataset.slot, change: e.dataset.change, status: e.dataset.status, msgs: [...e.querySelectorAll("li")].map((l) => l.textContent) })));
const changed = cards.filter((c) => c.change !== "unchanged").map((c) => c.slot);
console.log("éléments changés :", changed.join(", "));
const sig = cards.find((c) => c.slot === "signature");
console.log("signature :", JSON.stringify(sig));

// B1 : les cinq couleurs repeintes sont lues, dites, et appliquées.
const colorKeys = await page.$$eval("[data-testid=kit-colors-review] [data-color]", (els) => els.map((e) => e.dataset.color));
ok("B1 revue : bg, surface, ink, primary, secondary lues comme repeintes", ["bg", "surface", "ink", "primary", "secondary"].every((k) => colorKeys.includes(k)), colorKeys.join(","));
const countTxt = await page.locator("[data-testid=kit-colors-count]").textContent().catch(() => "");
ok("B1 revue : un décompte des pastilles lues / repeintes est affiché", /repeinte/.test(countTxt ?? ""), countTxt ?? "");
ok("B1 revue : la case « appliquer les couleurs » est cochée", await page.locator('[data-testid="kit-colors"]').isChecked().catch(() => false));

// B2 : thème visé annoncé, Studio par défaut (thème d'origine du kit), pas Pro.
const baseSel = page.locator('[data-testid="kit-base-select"]');
ok("B2 revue : le thème visé est affiché et vaut Studio (thème d'origine du kit)", (await baseSel.count()) === 1 && (await baseSel.inputValue()) === "studio", `${await baseSel.count()}`);
ok("B2 revue : kit d'origine reconnu malgré l'écran de Pro (éléments inchangés)", cards.filter((c) => c.change === "unchanged").length >= 8, JSON.stringify(cards.map((c) => c.change)));
ok("B2 revue : le scotch n'est pas importé (gabarit inchangé)", cards.find((c) => c.slot === "accessoires/scotch")?.change === "unchanged");

await Promise.all([page.waitForURL(/\/admin\/themes\/[a-z0-9-]*-kit[a-z0-9-]*$/, { timeout: 60000 }), page.getByRole("button", { name: "Appliquer au thème" }).click()]);
const draftId = page.url().split("/").pop();
created.push(draftId);
const data = themeData(draftId);
ok("B2 copie : partie de Studio (nom, variantes gardées, pas de scotch)", /^Studio/.test(data?.name ?? "") && data.variants.strip === "edge" && !data.assets?.kit?.tape, JSON.stringify({ name: data?.name, v: data?.variants }));
const c = data?.tokens?.color ?? {};
ok("B1 copie : fond, surface, texte, action, accent secondaire repeints", c.bg === "#fde8ee" && c.surface === "#fff6f8" && c.ink === "#3a1224" && c.primary === "#c21e56" && c.secondary === "#8a1c4a", JSON.stringify(c));
const studio = themeData("studio");
ok("B5 copie : décor d'ouverture (calques du hero) = celui de Studio, aucun plan converti (la rangée de vignettes grises et le carré bleu sont le décor de Studio)", JSON.stringify(data?.assets?.heroLayers) === JSON.stringify(studio?.assets?.heroLayers) && !data?.assets?.kit?.plans, JSON.stringify(data?.assets?.kit?.plans)?.slice(0, 120));
ok("B7 copie : papier présent, pas sous le bandeau (défaut)", Boolean(data?.assets?.kit?.paper) && !data.assets.kit.paper.underHeader, JSON.stringify(data?.assets?.kit?.paper));

/* ---- Aperçu de l'accueil : bandeau, papier, logo -------------------------- */
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
await page.goto(`${BASE}/admin/themes/${draftId}`, { waitUntil: "networkidle" });
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
  await page.mouse.wheel(0, 700);
  await sleep(900);
  const hdr2 = await header();
  // La tuile est celle du <body> : sous le bandeau elle n'est cachée que par un aplat OPAQUE.
  ok("B7 option cochée : le bandeau n'est plus un aplat opaque (la tuile repasse dessous)", !/^rgb\(/.test(hdr2.color), JSON.stringify(hdr2));
  await page.screenshot({ path: `${SHOTS}/accueil-defile-papier-sous-bandeau-1440.png` });
}

// Liste des thèmes : lequel est en ligne saute aux yeux.
await page.goto(`${BASE}/admin/themes`, { waitUntil: "networkidle" });
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
