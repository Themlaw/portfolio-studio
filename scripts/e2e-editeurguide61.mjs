#!/usr/bin/env node
/**
 * Éditeur de thème guidé (lot 61), UN chromium, serveur dev OU standalone, base NEUVE (seed), une connexion.
 *
 *  A. Cinq étapes, une ouverte à la fois, un seul « Enregistrer » dans l'en-tête collant, « Dessiner dans Photoshop » en haut,
 *     Précédent / Suivant, « Publier » à la dernière étape ; thème livré : étapes 2 à 5 en lecture seule.
 *  B. Couleurs : quatre couleurs de base, lisibilité en une ligne, « Affiner (avancé) » replié avec son compteur ; un seul bloc.
 *  C. Arrondi : un seul réglage ; un cran écrit rayons et forme des boutons ; Espacements en trois niveaux (largeur gardée).
 *  D. Papier et motifs : onglet « Mes papiers peints » (la bibliothèque), l'ancienne adresse redirige.
 *  E. Logo : image importée (garde ses couleurs par défaut), « Prendre la couleur du texte », rendu clair et foncé, rendu public.
 *  F. Rien ne bouge : pour les 8 thèmes livrés (copies) et un thème personnalisé aux valeurs précises, ouvrir toutes les étapes et tous les
 *     « Affiner » ne modifie rien (aucune modification en attente, données identiques, variables de l'aperçu = valeurs enregistrées) ; les
 *     anciennes valeurs précises sont lues (cran « le plus proche », jamais « exact ») et gardées tant qu'on ne touche pas au réglage simplifié.
 *  G. Publier (dernière étape) : un thème hors ligne est enregistré puis mis en ligne.
 *
 * Captures 1440 et 390 px : $SHOTS. Copies et thèmes de test supprimés à la fin.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… [BASE=http://localhost:3001] [SHOTS=…] [ONLY=A,B] node scripts/e2e-editeurguide61.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";
import sharp from "sharp";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const DATA = process.env.DATA_DIR ?? "data";
const DB = path.join(DATA, "portfolio.db");
const SHOTS = process.env.SHOTS ?? "screenshots/guide61";
const ONLY = process.env.ONLY ?? "";
const run = (k) => !ONLY || ONLY.split(",").includes(k);
mkdirSync(SHOTS, { recursive: true });
const TMP = path.join(tmpdir(), "e2e-guide61");
mkdirSync(TMP, { recursive: true });

let failures = 0;
function ok(label, cond, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (sql, ...args) => {
  const db = new Database(DB, { readonly: true });
  try {
    return db.prepare(sql).all(...args);
  } finally {
    db.close();
  }
};
const exec = (sql, ...args) => {
  const db = new Database(DB);
  try {
    return db.prepare(sql).run(...args);
  } finally {
    db.close();
  }
};
const setting = (key) => JSON.parse(q("select value from settings where key = ?", key)[0]?.value ?? "null");
const themeRow = (id) => q("select data, updated_at from themes where id = ?", id)[0];
const themeData = (id) => JSON.parse(themeRow(id)?.data ?? "null");
async function waitFor(fn, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(250);
  }
  return false;
}
const tsx = (code) => execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { encoding: "utf8", env: { ...process.env, DATA_DIR: DATA } });
const duplicate = (id) => JSON.parse(tsx(`import { duplicateTheme } from "./src/lib/edit/themes.ts"; console.log(JSON.stringify(duplicateTheme(${JSON.stringify(id)}).data.id));`).trim().split("\n").pop());
const PRESETS = q("select id from themes where preset = 1 order by id").map((r) => r.id);
tsx(`import "./scripts/seed-perso61.mjs";`);
const PERSO = "perso-61";
const created = [];

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
page.setDefaultNavigationTimeout(180000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(`${BASE}/admin/connexion`, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL);
await page.fill("#password", PASSWORD);
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/admin/connexion"), { timeout: 90000 }), page.click("button[type=submit]")]);

async function section(name, fn) {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 6).join(" "));
    await page.screenshot({ path: path.join(SHOTS, `erreur-${name}.png`) }).catch(() => {});
  }
}
const open = async (id, etape = "") => {
  await page.goto(`${BASE}/admin/themes/${encodeURIComponent(id)}${etape ? `?etape=${etape}` : ""}`, { waitUntil: "networkidle" });
  await page.locator(".a-guide-head").waitFor();
};
const stepTab = (id) => page.locator(`[data-testid="step-tab-${id}"]`);
const openBodies = () => page.locator(".a-step-body:not([hidden])");
const dirty = async () => (await page.locator(".a-savebar").getAttribute("data-dirty")) === "true";
const saveNow = async (label) => {
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  const done = await page.locator(".a-save-state", { hasText: /✓\s*Enregistré/ }).waitFor({ timeout: 90000 }).then(() => true, () => false);
  ok(label, done, await page.locator(".a-save-state").textContent().catch(() => ""));
};
const STEP_IDS = ["couleurs", "textes", "cartes", "papier", "logo"];

/* ---- A. Cinq étapes ------------------------------------------------------------------------------ */
let COPY = null;
if (run("A"))
  await section("A", async () => {
    COPY = duplicate("galerie-lumineuse");
    created.push(COPY);
    await open(COPY);
    ok("A1 cinq étapes nommées dans l'ordre", JSON.stringify(await page.locator(".a-step-title").allTextContents()) === JSON.stringify(["Couleurs", "Textes", "Cartes et cadres", "Papier et motifs", "Logo"]));
    ok("A2 une seule étape ouverte à la fois (la première à l'arrivée)", (await openBodies().count()) === 1 && (await stepTab("couleurs").getAttribute("aria-expanded")) === "true");
    for (const id of STEP_IDS) {
      await stepTab(id).click();
      ok(`A3 étape « ${id} » : seule ouverte, adresse mise à jour`, (await openBodies().count()) === 1 && (await stepTab(id).getAttribute("aria-expanded")) === "true" && new URL(page.url()).searchParams.get("etape") === id);
    }
    await open(COPY, "cartes");
    ok("A4 ?etape= ouvre l'étape demandée", (await stepTab("cartes").getAttribute("aria-expanded")) === "true" && (await openBodies().count()) === 1);
    await open(COPY);
    ok("A5 UN seul bouton Enregistrer (pas d'« Enregistrer les couleurs », pas d'« Enregistrer et publier… »)", (await page.getByRole("button", { name: /^Enregistrer/ }).count()) === 1 && (await page.getByRole("button", { name: /Enregistrer les couleurs|Enregistrer et publier…/ }).count()) === 0);
    ok("A6 aucune barre « ✓ Enregistré » trompeuse : bouton grisé tant que rien n'a changé", (await page.getByRole("button", { name: "Enregistrer", exact: true }).isDisabled()) && !(await dirty()));
    ok("A7 « Dessiner dans Photoshop » en haut (menu de l'en-tête)", (await page.locator('.a-guide-head [data-testid="kit-menu"] summary').textContent())?.includes("Dessiner dans Photoshop") === true);
    await page.locator('.a-guide-head [data-testid="kit-menu"] summary').click();
    ok("A7b … avec « Télécharger le kit Photoshop » et « Renvoyer le kit rempli… »", (await page.locator('.a-guide-head [data-testid="kit-download"]').count()) === 1 && (await page.locator(".a-guide-head").getByRole("link", { name: /Renvoyer le kit rempli/ }).count()) === 1);
    await page.locator('.a-guide-head [data-testid="kit-menu"] summary').click();
    ok("A8 en-tête : nom du thème, état « Brouillon · pas en ligne »", (await page.locator("#theme-name").inputValue()).includes("copie") && /Brouillon/.test((await page.locator('[data-testid="guide-status"]').textContent()) ?? ""));
    // En-tête collant : après défilement il reste en haut de la fenêtre.
    await stepTab("cartes").click();
    await page.mouse.wheel(0, 1400);
    await sleep(400);
    const top = await page.locator(".a-guide-head").evaluate((el) => Math.round(el.getBoundingClientRect().top));
    ok("A9 en-tête collant : toujours visible en bas de page", top >= 0 && top <= 60, String(top));
    // Précédent / Suivant, « Publier » à la dernière étape.
    await stepTab("couleurs").click();
    ok("A10 première étape : « Suivant : Textes », pas de « Précédent »", (await page.locator('.a-step[data-open] [data-testid="step-next"]').textContent())?.includes("Suivant : Textes") === true && (await page.locator('.a-step[data-open] [data-testid="step-prev"]').count()) === 0);
    for (const id of STEP_IDS.slice(1)) {
      await page.locator('.a-step[data-open] [data-testid="step-next"]').click();
      ok(`A11 Suivant → « ${id} »`, (await stepTab(id).getAttribute("aria-expanded")) === "true");
    }
    ok("A12 dernière étape : « Publier », plus de « Suivant »", (await page.locator('.a-step[data-open] [data-testid="step-publish"]').count()) === 1 && (await page.locator('.a-step[data-open] [data-testid="step-next"]').count()) === 0);
    await page.locator('.a-step[data-open] [data-testid="step-prev"]').click();
    ok("A13 Précédent → étape 4", (await stepTab("papier").getAttribute("aria-expanded")) === "true");
    // Thème livré : étapes 2 à 5 en lecture seule, copie proposée.
    await open("galerie-lumineuse");
    ok("A14 thème livré : pas de nom éditable, pas d'Enregistrer, état « Thème livré »", (await page.locator("#theme-name").count()) === 0 && (await page.locator('[data-testid="da-save"]').count()) === 0 && /Thème livré/.test((await page.locator('[data-testid="guide-status"]').textContent()) ?? ""));
    await stepTab("textes").click();
    ok("A15 thème livré : « Textes » en lecture seule avec une copie modifiable proposée", (await page.locator('.a-step[data-open] [data-testid="step-locked"]').count()) === 1 && (await page.locator('.a-step[data-open] [data-testid="step-locked-copy"]').count()) === 1);
    await page.screenshot({ path: `${SHOTS}/A-theme-livre-textes.png` });
    await open(COPY);
    await page.screenshot({ path: `${SHOTS}/A-etape1-1440.png` });
    await stepTab("textes").click();
    await page.screenshot({ path: `${SHOTS}/A-etape2-1440.png` });
    await stepTab("cartes").click();
    await page.screenshot({ path: `${SHOTS}/A-etape3-1440.png` });
    await stepTab("papier").click();
    await page.screenshot({ path: `${SHOTS}/A-etape4-1440.png` });
    await stepTab("logo").click();
    await page.screenshot({ path: `${SHOTS}/A-etape5-1440.png` });
    // Mobile : en-tête, étapes, onglets Réglages / Aperçu.
    const m = await ctx.newPage();
    await m.setViewportSize({ width: 390, height: 844 });
    await m.goto(`${BASE}/admin/themes/${COPY}`, { waitUntil: "networkidle" });
    await m.locator(".a-guide-head").waitFor();
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok("A16 téléphone : pas de défilement horizontal", overflow <= 1, String(overflow));
    await m.screenshot({ path: `${SHOTS}/A-mobile-390.png` });
    await m.getByRole("tab", { name: "Aperçu" }).click();
    ok("A17 téléphone : l'aperçu passe dans un onglet", await m.locator(".a-theme-preview").isVisible());
    await m.close();
  });

/* ---- B. Couleurs ----------------------------------------------------------------------------------- */
if (run("B"))
  await section("B", async () => {
    COPY ??= duplicate("galerie-lumineuse");
    if (!created.includes(COPY)) created.push(COPY);
    await open(COPY);
    const da = page.locator('[data-testid="da-section"]');
    ok("B1 quatre couleurs de base : Fond de page, Texte, Boutons et liens, Accent", JSON.stringify(await da.locator(".lc-role strong").allTextContents()) === JSON.stringify(["Fond de page", "Texte", "Boutons et liens", "Accent"]));
    ok("B2 « Le reste se calcule tout seul » et lisibilité en une ligne", /le reste se calcule tout seul/i.test((await da.textContent()) ?? "") && /Lisible|Difficile à lire sur le fond/.test((await page.locator('[data-testid="readability"]').textContent()) ?? ""));
    ok("B3 « Affiner (avancé) » replié, avec son compteur", (await page.locator('[data-testid="adv-couleurs"]').getAttribute("open")) === null && /réglage/.test((await page.locator('[data-testid="adv-couleurs-count"]').textContent()) ?? ""));
    ok("B4 un seul bloc de couleurs : aucun second champ pour les quatre couleurs de base", (await page.locator('.a-color[data-token="bg"], .a-color[data-token="ink"], .a-color[data-token="primary"], .a-color[data-token="secondary"]').count()) === 0);
    ok("B5 vocabulaire : plus de « DA », « Filets », « Fond profond », « Voile »", !/\bDA\b|Filets|Fond profond|Voile de la visionneuse|Fond des rubriques alternées/.test(await page.locator("main").innerText()));
    await page.locator('[data-testid="adv-couleurs"] summary').click();
    const names = await page.locator('[data-testid="adv-couleurs"] .a-color-label').allTextContents();
    for (const n of ["Fond des blocs", "Traits fins", "Petits textes d'étiquette", "Fond des images agrandies"]) ok(`B6 nom « ${n} »`, names.includes(n), names.join(" | "));
    const before = await page.locator('[data-testid="adv-couleurs-count"]').getAttribute("data-count");
    const hover = page.locator('.a-color[data-token="primaryHover"]');
    if ((await hover.getAttribute("data-auto")) === "false") {
      await hover.getByRole("button", { name: /Revenir à auto/ }).click();
      ok("B7 « Revenir à auto » : le compteur baisse", Number(await page.locator('[data-testid="adv-couleurs-count"]').getAttribute("data-count")) < Number(before), `${before} → ${await page.locator('[data-testid="adv-couleurs-count"]').getAttribute("data-count")}`);
    } else ok("B7 (survol déjà en auto)", true);
    // Une couleur de base choisie : la nuance auto la suit, enregistrement unique.
    await page.locator('.a-da .lc-role-item[data-role="primary"] .lc-role').click();
    await page.locator('.a-da .lc-role-item[data-role="primary"] .cp-hex').fill("#1d6b4f");
    await page.locator('.a-da .lc-role-item[data-role="primary"] .cp-hex').press("Enter");
    await sleep(300);
    ok("B8 couleur de base changée : modifications en attente", await dirty());
    await saveNow("B9 un seul Enregistrer : enregistré");
    ok("B10 enregistré dans le thème", themeData(COPY).tokens.color.primary === "#1d6b4f");
    await page.screenshot({ path: `${SHOTS}/B-couleurs-affiner-1440.png`, fullPage: false });
  });

/* ---- C. Arrondi et espacements ----------------------------------------------------------------------- */
if (run("C"))
  await section("C", async () => {
    const id = duplicate("pro");
    created.push(id);
    await open(id, "cartes");
    const before = themeData(id);
    const r0 = before.tokens.radius;
    ok("C1 un seul réglage « Arrondi » (cinq crans de Carré à Très rond)", JSON.stringify(await page.locator('[data-testid="round-level"] button').allTextContents()) === JSON.stringify(["Carré", "Léger", "Moyen", "Rond", "Très rond"]));
    ok("C1b les anciens curseurs d'arrondi sont sous « Affiner » (replié)", (await page.locator('[data-testid="adv-cartes"]').getAttribute("open")) === null);
    ok("C2 thème aux arrondis précis : cran le plus proche annoncé, aucun cran « enfoncé », rien de modifié", (await page.locator('[data-testid="round-block"]').getAttribute("data-exact")) === "false" && (await page.locator('[data-testid="round-level"] [aria-pressed="true"]').count()) === 0 && !(await dirty()) && JSON.stringify(themeData(id).tokens.radius) === JSON.stringify(r0));
    await page.locator('[data-testid="round-level"] [data-level="carre"]').click();
    ok("C3 « Carré » : écrit 0 px partout et des boutons droits (en attente)", await dirty());
    await saveNow("C3b enregistré");
    const sq = themeData(id);
    ok("C3c rayons à 0 px, boutons « square »", ["sm", "md", "lg", "strip"].every((k) => sq.tokens.radius[k] === "0px") && sq.variants.button === "square", JSON.stringify(sq.tokens.radius));
    await page.locator('[data-testid="round-level"] [data-level="tres-rond"]').click();
    await saveNow("C4 « Très rond » enregistré");
    const tr = themeData(id);
    ok("C4b rayons 10 / 20 / 32 / 8 px, boutons en pastille", tr.tokens.radius.sm === "10px" && tr.tokens.radius.md === "20px" && tr.tokens.radius.lg === "32px" && tr.tokens.radius.strip === "8px" && tr.tokens.radius.btn === "999px" && tr.variants.button === "pill", JSON.stringify(tr.tokens.radius));
    ok("C4c cran « Très rond » marqué, annoncé « exact »", (await page.locator('[data-testid="round-block"]').getAttribute("data-exact")) === "true" && (await page.locator('[data-testid="round-level"] [aria-pressed="true"]').textContent()) === "Très rond");
    await page.screenshot({ path: `${SHOTS}/C-arrondi-1440.png` });
    // Espacements.
    await stepTab("papier").click();
    const maxBefore = themeData(id).tokens.space.pageMax;
    ok("C5 espacements en trois niveaux : Serré, Normal, Aéré", JSON.stringify(await page.locator('[data-testid="space-level"] button').allTextContents()) === JSON.stringify(["Serré", "Normal", "Aéré"]));
    await page.locator('[data-testid="space-level"] [data-level="serre"]').click();
    await saveNow("C6 « Serré » enregistré");
    const s1 = themeData(id).tokens.space;
    ok("C6b « Serré » : valeurs du cran, largeur maximale gardée", s1.sectionGap === "clamp(2.5rem, 5vw, 4.5rem)" && s1.gutter === "clamp(1rem, 3vw, 2rem)" && s1.pageMax === maxBefore, JSON.stringify(s1));
    await page.locator('[data-testid="space-level"] [data-level="aere"]').click();
    await saveNow("C7 « Aéré » enregistré");
    const s2 = themeData(id).tokens.space;
    ok("C7b « Aéré » : valeurs du cran", s2.sectionGap === "clamp(4.5rem, 10vw, 9rem)" && s2.gutter === "clamp(1.25rem, 5vw, 3.5rem)" && s2.pageMax === maxBefore, JSON.stringify(s2));
    ok("C8 aperçu en direct : les variables suivent (--t-space-section-gap)", (await page.frameLocator("iframe.a-preview-frame").locator("html").evaluate((el) => getComputedStyle(el).getPropertyValue("--t-space-section-gap").trim())) === s2.sectionGap);
    await page.screenshot({ path: `${SHOTS}/C-espacements-1440.png` });
    // Cartes : largeur, coins, bordure (réglages d'avant, étape 3).
    await stepTab("cartes").click();
    ok("C9 étape 3 : cartes (largeur, coins, bordure) toujours là", (await page.locator('[data-testid="card-default-border"]').count()) === 1 && (await page.getByRole("button", { name: "Pleine largeur" }).count()) === 1);
  });

/* ---- D. Papier et motifs ------------------------------------------------------------------------------ */
if (run("D"))
  await section("D", async () => {
    COPY ??= duplicate("galerie-lumineuse");
    if (!created.includes(COPY)) created.push(COPY);
    await open(COPY, "papier");
    ok("D1 fond : « Fond uni » et « Papier pointillé » (vignettes) + « Mon papier peint »", JSON.stringify(await page.locator('input[name="variant-texture"] ~ span').allTextContents()) === JSON.stringify(["Fond uni", "Papier pointillé"]) && (await page.locator('[data-testid="wallpaper-hint"]').count()) === 1);
    await page.locator('input[name="variant-texture"][type="radio"]').nth(1).check({ force: true });
    ok("D2 « Papier pointillé » choisi : aperçu en direct", await waitFor(async () => (await page.frameLocator("iframe.a-preview-frame").locator("html").getAttribute("data-texture")) === "paper-dots", 10000));
    await page.locator('[data-testid="paper-tab-wallpapers"]').click();
    ok("D3 onglet « Mes papiers peints » : la bibliothèque est là", await page.locator('[data-testid="wallpaper-library"]').waitFor({ timeout: 20000 }).then(() => true, () => false) && new URL(page.url()).searchParams.get("onglet") === "papiers-peints");
    await page.screenshot({ path: `${SHOTS}/D-papiers-peints-1440.png` });
    await page.goto(`${BASE}/admin/papiers-peints`, { waitUntil: "networkidle" });
    ok("D4 l'adresse /admin/papiers-peints est une vraie page (lot 78) avec la bibliothèque", new URL(page.url()).pathname === "/admin/papiers-peints" && (await page.locator('[data-testid="wallpaper-library"]').isVisible()), page.url());
    ok("D5 « Papiers peints » est une entrée du menu (lot 78)", (await page.locator('.a-nav a[href="/admin/papiers-peints"]').count()) === 1);
  });

/* ---- E. Logo -------------------------------------------------------------------------------------------- */
if (run("E"))
  await section("E", async () => {
    const id = duplicate("pro");
    created.push(id);
    await open(id, "logo");
    ok("E1 pas de logo : une phrase qui dit quoi faire, import et kit proposés", (await page.locator('[data-testid="logo-none"]').count()) === 1 && (await page.locator('[data-testid="logo-import"]').count()) === 1 && (await page.locator('[data-testid="logo-kit"]').count()) === 1);
    const file = path.join(TMP, "logo-rouge.png");
    // Un logo d'UNE seule couleur (rouge), sur fond transparent.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="240"><rect x="10" y="10" width="880" height="220" rx="40" fill="#cc2222"/><circle cx="120" cy="120" r="60" fill="#cc2222" stroke="#ffffff" stroke-width="12"/></svg>`;
    await sharp(Buffer.from(svg)).png().toFile(file);
    await page.setInputFiles('[data-testid="logo-file"]', file);
    ok("E2 image importée : le logo apparaît sur fond clair ET sur fond foncé", await page.locator('[data-testid="logo-sample-light"]').waitFor({ timeout: 120000 }).then(() => true, () => false) && (await page.locator('[data-testid="logo-sample-dark"]').count()) === 1);
    ok("E3 « Garder mes couleurs » est le choix par défaut, même pour un logo d'une seule couleur", await page.locator('[data-testid="logo-keep"]').isChecked() && (await page.locator('[data-testid="logo-sample-light"]').getAttribute("data-tinted")) === "false");
    const bg = await page.locator('[data-testid="logo-sample-light"]').evaluate((el) => getComputedStyle(el).backgroundImage);
    ok("E3b rendu avec ses couleurs (image de fond, pas un masque)", /url\(/.test(bg), bg);
    await saveNow("E4 logo enregistré");
    const sig = themeData(id).assets.kit?.signature;
    ok("E4b assets.kit.signature : fichiers du kit, colors: true", Boolean(sig?.colors === true && /^\/media\/kit\/[0-9a-f]{16}\.avif$/.test(sig.avif ?? "") && /^\/media\/kit\/[0-9a-f]{16}\.webp$/.test(sig.webp ?? "")), JSON.stringify(sig));
    const served = await page.request.get(`${BASE}${sig.webp}`);
    ok("E4c fichier servi (/media/kit/…)", served.ok() && /image\/webp/.test(served.headers()["content-type"] ?? ""));
    await page.screenshot({ path: `${SHOTS}/E-logo-garder-1440.png` });
    // Rendu public (aperçu du thème) : logo en couleurs.
    const publicAttr = async () => {
      await page.request.post(`${BASE}/admin/apercu`, { form: { id }, headers: { origin: BASE } });
      const pub = await ctx.newPage();
      await pub.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
      const out = await pub.evaluate(() => {
        const el = document.querySelector(".site-header .site-signature");
        const cs = el ? getComputedStyle(el) : null;
        return { attr: document.documentElement.getAttribute("data-kit-signature"), image: cs?.backgroundImage ?? "", mask: cs?.maskImage ?? cs?.webkitMaskImage ?? "" };
      });
      await pub.screenshot({ path: `${SHOTS}/E-public-${out.attr === "colors" ? "couleurs" : "teinte"}.png`, clip: { x: 0, y: 0, width: 1440, height: 160 } });
      await pub.close();
      await page.request.post(`${BASE}/admin/apercu/quitter`, { headers: { origin: BASE } }).catch(() => {});
      return out;
    };
    const keep = await publicAttr();
    ok("E5 site : logo en couleurs (data-kit-signature=\"colors\", image de fond, pas de masque)", keep.attr === "colors" && /url\(/.test(keep.image) && !/url\(/.test(keep.mask), JSON.stringify(keep));
    // « Prendre la couleur du texte ».
    await open(id, "logo");
    await page.locator('[data-testid="logo-tint"]').check();
    ok("E6 « Prendre la couleur du texte » : les deux fonds montrent la forme teintée", (await page.locator('[data-testid="logo-sample-light"]').getAttribute("data-tinted")) === "true" && (await page.locator('[data-testid="logo-sample-dark"]').getAttribute("data-tinted")) === "true");
    await saveNow("E7 enregistré");
    ok("E7b la clé colors disparaît, les fichiers restent", themeData(id).assets.kit.signature.colors === undefined && themeData(id).assets.kit.signature.webp === sig.webp);
    const tint = await publicAttr();
    ok("E8 site : logo teinté (masque, pas d'image de fond)", tint.attr === "" && /url\(/.test(tint.mask) && !/url\(/.test(tint.image), JSON.stringify(tint));
    await page.screenshot({ path: `${SHOTS}/E-logo-teinte-1440.png` });
    // Retrouver ses couleurs.
    await page.locator('[data-testid="logo-keep"]').check();
    await saveNow("E9 « Garder mes couleurs » de nouveau enregistré");
    ok("E9b colors: true revient", themeData(id).assets.kit.signature.colors === true);
    // Retirer le logo.
    await page.locator('[data-testid="logo-remove"]').click();
    await saveNow("E10 logo retiré enregistré");
    ok("E10b plus de signature : le nom écrit revient", themeData(id).assets.kit?.signature === undefined);
  });

/* ---- F. Rien ne bouge -------------------------------------------------------------------------------------- */
if (run("F"))
  await section("F", async () => {
    // Les 8 thèmes livrés (copies, éditables) puis le thème personnalisé aux valeurs précises.
    const targets = PRESETS.map((p) => ({ label: p, id: duplicate(p), preset: p }));
    for (const t of targets) created.push(t.id);
    targets.push({ label: "personnalisé (valeurs précises)", id: PERSO, preset: null });
    const exactRound = { studio: true, "planche-de-story": true, "carnet-d-atelier": true, "galerie-lumineuse": true };
    const exactSpace = { studio: true, "fanzine-riso": true, "carnet-d-atelier": true, pro: true, "salle-de-projection": true };
    for (const t of targets) {
      const before = themeRow(t.id);
      await open(t.id);
      for (const id of STEP_IDS) {
        await stepTab(id).click();
        for (const d of await page.locator(".a-step[data-open] details.a-adv").all()) await d.locator("summary").click();
      }
      await stepTab("papier").click();
      await page.locator('[data-testid="paper-tab-wallpapers"]').click();
      await page.locator('[data-testid="paper-tab-fond"]').click();
      await sleep(600);
      const after = themeRow(t.id);
      const data = JSON.parse(before.data);
      ok(`F1 ${t.label} : toutes les étapes et tous les « Affiner » ouverts, rien en attente, données identiques`, !(await dirty()) && before.data === after.data && before.updated_at === after.updated_at);
      // Variables de l'aperçu = valeurs enregistrées (rien n'est normalisé à l'ouverture).
      const vars = await page.frameLocator("iframe.a-preview-frame").locator("html").evaluate((el) => Object.fromEntries(["--t-radius-sm", "--t-radius-md", "--t-radius-lg", "--t-radius-btn", "--t-radius-strip", "--t-space-section-gap", "--t-space-gutter", "--t-space-page-max"].map((k) => [k, getComputedStyle(el).getPropertyValue(k).trim()])));
      const want = { "--t-radius-sm": data.tokens.radius.sm, "--t-radius-md": data.tokens.radius.md, "--t-radius-lg": data.tokens.radius.lg, "--t-radius-btn": data.tokens.radius.btn, "--t-radius-strip": data.tokens.radius.strip, "--t-space-section-gap": data.tokens.space.sectionGap, "--t-space-gutter": data.tokens.space.gutter, "--t-space-page-max": data.tokens.space.pageMax };
      ok(`F2 ${t.label} : l'aperçu garde les valeurs précises (arrondis, espacements)`, JSON.stringify(vars) === JSON.stringify(want), JSON.stringify({ vars, want }));
      const rExact = (await page.locator('[data-testid="round-block"]').getAttribute("data-exact")) === "true";
      const sExact = (await page.locator('[data-testid="space-block"]').getAttribute("data-exact")) === "true";
      if (t.preset) {
        ok(`F3 ${t.label} : arrondi ${exactRound[t.preset] ? "exact" : "précis conservé (cran le plus proche)"}, espacement ${exactSpace[t.preset] ? "exact" : "précis conservé"}`, rExact === Boolean(exactRound[t.preset]) && sExact === Boolean(exactSpace[t.preset]), `${rExact} ${sExact}`);
      } else {
        ok("F3 thème personnalisé (5 / 9 / 17 px, espacements et largeur précis) : valeurs précises annoncées conservées", !rExact && !sExact && /gardés tels quels/.test((await page.locator('[data-testid="round-note"]').textContent()) ?? ""));
      }
    }
    // Toucher le réglage simplifié remplace la valeur précise : le thème personnalisé passe à « Rond », puis on le remet comme avant.
    const perso0 = themeRow(PERSO).data;
    await open(PERSO, "cartes");
    await page.locator('[data-testid="round-level"] [data-level="rond"]').click();
    await saveNow("F4 thème personnalisé : « Rond » enregistré");
    ok("F4b … les anciennes valeurs précises sont remplacées (6 / 12 / 20 px)", themeData(PERSO).tokens.radius.md === "12px" && themeData(PERSO).tokens.radius.sm === "6px");
    exec("update themes set data = ? where id = ?", perso0, PERSO);
  });

/* ---- G. Publier ----------------------------------------------------------------------------------------- */
if (run("G"))
  await section("G", async () => {
    const id = duplicate("studio");
    created.push(id);
    const live = setting("activeThemeId");
    await open(id, "logo");
    await page.locator("#theme-name").fill("Mon thème à publier");
    await page.locator('[data-testid="step-publish"]').click();
    const dlg = page.locator("dialog[open]");
    ok("G1 « Publier » (thème hors ligne) : fenêtre qui nomme le thème", await dlg.waitFor({ timeout: 10000 }).then(() => true, () => false) && /Mon thème à publier/.test((await dlg.textContent()) ?? ""));
    await dlg.getByRole("button", { name: "Annuler" }).click();
    ok("G2 annuler : rien n'est publié ni enregistré", setting("activeThemeId") === live && themeData(id).name !== "Mon thème à publier");
    await page.locator('[data-testid="step-publish"]').click();
    await dlg.getByRole("button", { name: "Publier", exact: true }).click();
    ok("G3 confirmer : thème enregistré ET en ligne", await waitFor(() => setting("activeThemeId") === id && themeData(id).name === "Mon thème à publier", 60000), String(setting("activeThemeId")));
    ok("G4 en ligne : « Publié » grisé, état « En ligne »", await waitFor(async () => /En ligne/.test((await page.locator('[data-testid="guide-status"]').textContent()) ?? ""), 30000) && (await page.locator('[data-testid="step-publish"]').isDisabled()));
    await page.screenshot({ path: `${SHOTS}/G-en-ligne-1440.png` });
    // Remise en état du thème en ligne.
    exec("update settings set value = ? where key = 'activeThemeId'", JSON.stringify(live));
  });


/* ---- H. Aération du fond de texte : défaut du site, étape « Textes » (lot 68) ------------------------------------ */
if (run("H"))
  await section("H", async () => {
    const id = duplicate("galerie-lumineuse");
    created.push(id);
    await open(id, "textes");
    const seg = page.locator('[data-testid="text-air"] [role=radio]');
    ok("H1 étape Textes : « Aération du fond de texte » Serré · Normal · Aéré", (await seg.allTextContents()).join("|") === "Serré|Normal|Aéré");
    ok("H2 rien d'enregistré : « Normal » (le nouveau défaut)", (await page.locator('[data-testid="text-air"] [data-air="normal"]').getAttribute("aria-checked")) === "true" && !themeData(id).tokens.layout?.textAir);
    await page.locator('[data-testid="text-air"] [data-air="airy"]').click();
    ok("H3 « Aéré » : coché, thème modifié (bouton Enregistrer actif)", (await page.locator('[data-testid="text-air"] [data-air="airy"]').getAttribute("aria-checked")) === "true" && (await dirty()));
    await saveNow("H4 enregistré");
    ok("H5 le thème porte tokens.layout.textAir = airy", themeData(id).tokens.layout?.textAir === "airy", JSON.stringify(themeData(id).tokens.layout));
    await page.screenshot({ path: `${SHOTS}/H-aeration-textes.png` });
  });

ok("aucune exception JavaScript", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();

// Nettoyage : copies, thème personnalisé de test.
if (created.length) exec(`delete from themes where id in (${created.map(() => "?").join(",")})`, ...created);
exec("delete from themes where id = ?", PERSO);
console.log(`thèmes supprimés : ${[...created, PERSO].join(", ")}`);
console.log(failures ? `e2e-editeurguide61 : ${failures} échec(s)` : "e2e-editeurguide61 : OK");
process.exit(failures ? 1 : 0);
