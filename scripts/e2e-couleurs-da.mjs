#!/usr/bin/env node
/**
 * Couleurs de la DA éditables en direct, au niveau du thème, et teintes de fond de carte (lot 19b), UN chromium.
 * Serveur dev requis, base NEUVE (seed, thème livré « Galerie lumineuse » en ligne), une connexion.
 *
 *  A. Thème livré (en lecture seule) : section « Couleurs de la DA » (six rôles nommés, une phrase chacun), aperçu
 *     vivant ; survol et focus d'un rôle = éléments surlignés dans l'aperçu (+ légende « utilisé par ») ; clic =
 *     sélecteur, changement visible dans l'aperçu en moins de 200 ms sans rechargement ; contraste AA en direct et
 *     « Ajuster automatiquement » ; à la première modification : « Créer une copie modifiable de ce thème » (rien
 *     d'écrit sur le thème livré), la copie reprend les couleurs, hors ligne, sans les enregistrer.
 *  B. Copie : les couleurs s'enregistrent directement dans le thème (pas de confirmation, pas en ligne).
 *  C. Thème en ligne : « Enregistrer » demande une confirmation claire ; le site public ne change qu'après elle.
 *  D. Surcharge du site (17f) : avertissement « Le site remplace N de ces couleurs » avec lien, sans fusion silencieuse.
 *  E. Fonds de cartes : « Cartes des rubriques » (six couleurs de la DA nommées, huit teintes douces, jetons) et
 *     popover « Carte » de l'éditeur visuel ; la teinte suit un changement de palette (aperçu et rendu public).
 *
 * Captures 1440 px : $SHOTS (défaut screenshots/couleurs19b).
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… [BASE=http://localhost:3250] [SHOTS=…] [ONLY=A,B] node scripts/e2e-couleurs-da.mjs
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";
import { activateThemeUi, gotoThemesPage } from "./lib/theme-live.mjs";
import { autoOpenFine } from "./lib/zone66.mjs";
import { gotoIdle, reloadIdle } from "./lib/idle.mjs";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const DATA = process.env.DATA_DIR ?? "data";
const DB = path.join(DATA, "portfolio.db");
const SHOTS = process.env.SHOTS ?? "screenshots/couleurs19b";
const ONLY = process.env.ONLY ?? "";
const run = (k) => !ONLY || ONLY.split(",").includes(k);
mkdirSync(SHOTS, { recursive: true });

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
const themeData = (id) => JSON.parse(q("select data from themes where id = ?", id)[0]?.data ?? "null");
const colorsOf = (id) => themeData(id)?.tokens.color ?? {};
async function waitFor(fn, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(250);
  }
  return false;
}

/* ---- Couleurs ------------------------------------------------------------------------------------ */
const rgbOf = (css) => {
  const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(css);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};
const hexRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const same = (a, b, tol = 2) => Boolean(a && b) && a.every((v, i) => Math.abs(v - b[i]) <= tol);
const lum = ([r, g, b]) => {
  const f = (v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const MINE = () => q("select id from themes where mine = 1")[0]?.id;
const PRESET = "galerie-lumineuse";
const COPY = "galerie-lumineuse-copie";
const NEW_ACCENT = "#7a2e4d";
const NEW_PRIMARY = "#7a1f10";
const BAD_INK = "#eeeeee";

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await autoOpenFine(ctx);
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
page.setDefaultNavigationTimeout(180000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(`${BASE}/admin/connexion`, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL);
await page.fill("#password", PASSWORD);
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/admin/connexion"), { timeout: 90000 }), page.click("button[type=submit]")]);

/** Une section qui échoue ne coupe pas les suivantes. */
async function section(name, fn) {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 6).join(" "));
    await page.screenshot({ path: path.join(SHOTS, `erreur-${name}.png`) }).catch(() => {});
  }
}

const role = (key) => page.locator(`.a-da .lc-role-item[data-role="${key}"]`);
/** Cadre d'aperçu de l'éditeur de thème, une fois le pont chargé. */
async function previewFrame() {
  const handle = await page.waitForSelector("iframe.a-preview-frame", { timeout: 120000 });
  const fr = await handle.contentFrame();
  await fr.waitForSelector("html[data-preview-framed]", { timeout: 180000 });
  await sleep(800);
  return fr;
}
/** Variable de couleur du thème, telle que l'aperçu l'affiche (notation rvb). */
const frameVar = (fr, name) =>
  fr.evaluate((n) => {
    const p = document.createElement("span");
    p.style.color = `var(${n})`;
    document.body.appendChild(p);
    const v = getComputedStyle(p).color;
    p.remove();
    return v;
  }, name);
async function openRole(key) {
  const item = role(key);
  // Un autre sélecteur ouvert : le fermer d'abord (sa fermeture raccourcit la page et ferait manquer le clic).
  if ((await page.locator(".a-da .lc-role-item[data-open]").count()) > 0 && (await item.getAttribute("data-open")) === null) {
    await page.keyboard.press("Escape");
    await page.locator(".a-da .lc-role-item[data-open]").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
    await sleep(200);
  }
  if ((await item.getAttribute("data-open")) === null) await item.locator(".lc-role").click();
  await item.locator(".cp-hex").waitFor();
  return item;
}
/** Saisit une couleur dans le sélecteur ouvert. */
async function typeHex(key, hex) {
  const item = await openRole(key);
  const field = item.locator(".cp-hex");
  await field.fill(hex);
  await field.press("Enter");
}
/**
 * Délai entre la saisie d'une couleur et son apparition dans le cadre d'aperçu (sans rechargement). Mesuré dans la
 * page de l'éditeur : évènement de saisie, puis lecture de la couleur calculée du cadre à chaque image.
 */
async function latencyOf(key, hex, variable) {
  const item = await openRole(key);
  const marker = await page.evaluate(() => {
    const w = window.frames[0];
    return (w.__marker = Math.random().toString(36).slice(2));
  });
  const ms = await item.locator(".cp-hex").evaluate(
    (input, { hex, variable }) =>
      new Promise((resolve) => {
        const doc = document.querySelector("iframe.a-preview-frame").contentDocument;
        const probe = doc.createElement("span");
        doc.body.appendChild(probe);
        const read = () => {
          probe.style.color = `var(${variable})`;
          return getComputedStyle(probe).color;
        };
        const want = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
        const matches = (c) => {
          const m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(c);
          return m && want.every((v, i) => Math.abs(v - Number(m[i + 1])) <= 2);
        };
        const t0 = performance.now();
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, hex);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        const tick = () => {
          if (matches(read())) {
            probe.remove();
            resolve(performance.now() - t0);
          } else if (performance.now() - t0 > 5000) {
            probe.remove();
            resolve(-1);
          } else requestAnimationFrame(tick);
        };
        tick();
      }),
    { hex, variable },
  );
  const sameDoc = await page.evaluate((m) => window.frames[0].__marker === m, marker);
  return { ms, sameDoc };
}
const sectionShot = (name) => page.screenshot({ path: path.join(SHOTS, name) });
async function activateTheme(name) {
  // Lot 60 : « Utiliser ce modèle » / « En faire mon thème », puis « Publier » (scripts/lib/theme-live.mjs).
  await activateThemeUi(page, BASE, name);
}
/** HTML public de l'accueil (rendu mis en cache : on attend la revalidation). */
const publicVar = async (url, name) => {
  const html = await (await fetch(`${BASE}${url}`, { cache: "no-store" })).text();
  return new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})`).exec(html)?.[1]?.toLowerCase() ?? null;
};

const original = colorsOf(PRESET);

/* ======================================== A. Thème livré ======================================== */

if (run("A"))
  await section("A", async () => {
    // Le lien depuis la liste des thèmes.
    await gotoThemesPage(page, BASE);
    const card = page.locator(".a-theme-card", { hasText: "Galerie lumineuse" }).first();
    // Lot 23 : le lien est dans le menu « … » de la carte.
    await card.getByRole("button", { name: /Plus d'actions/ }).click();
    ok("A0 le menu de la carte du thème a un lien « Voir les couleurs » (thème livré compris)", (await page.locator('[data-testid="theme-da-link"]').count()) === 1);
    await page.locator('[data-testid="theme-da-link"]').click();
    await page.waitForURL(/\/admin\/themes\/galerie-lumineuse/);
    const da = page.locator('[data-testid="da-section"]');
    await da.waitFor();
    ok("A1 étape « Couleurs » sur la page du thème livré", /^Couleurs$/.test(((await da.locator(".a-step-title").textContent()) ?? "").trim()));
    for (const n of ["Fond de page", "Texte", "Boutons et liens", "Accent"]) ok(`A1 couleur de base « ${n} »`, (await da.locator(".lc-role strong", { hasText: n }).count()) === 1);
    ok("A1b quatre couleurs de base seulement (les autres sous « Affiner »), chacune avec une phrase", (await da.locator(".lc-role small").allTextContents()).length === 4 && (await da.locator(".lc-role small").allTextContents()).every((t) => t.trim().length > 12));
    ok("A1c thème livré : lecture seule annoncée, ni nom ni enregistrement", (await page.locator('[data-testid="da-preset-note"]').count()) === 1 && (await page.locator("#theme-name").count()) === 0 && (await page.locator('[data-testid="da-save"]').count()) === 0);
    ok("A1d aucune invitation à créer une copie tant que rien n'est modifié", (await page.locator('[data-testid="da-copy-prompt"]').count()) === 0);

    const fr = await previewFrame();
    const frameMarker = await page.evaluate(() => (window.frames[0].__keep = "vivant"));
    ok("A2 aperçu vivant : l'accueil du site dans un cadre", (await fr.locator("header.site-header").count()) === 1);
    ok("A2b sélecteur de page de l'aperçu (accueil + pages)", (await page.getByLabel("Page montrée dans l'aperçu").locator("option").count()) >= 5);

    // Survol d'un rôle : les éléments qui l'utilisent sont surlignés dans l'aperçu.
    await role("ink").locator(".lc-role").hover();
    ok("A3 survol « Texte » : éléments surlignés dans l'aperçu", await fr.waitForFunction(() => document.querySelectorAll('[data-testid="hl-box"]').length > 0, null, { timeout: 30000 }).then(() => true, () => false));
    ok("A3b légende « utilisé par » avec le nombre d'éléments", await waitFor(async () => /Utilisé par : .*(titres|paragraphes|menu)/.test((await page.locator('[data-testid="hl-legend"]').textContent().catch(() => "")) ?? "") && /\d+ éléments? sur cette page/.test((await page.locator('[data-testid="hl-legend"]').textContent().catch(() => "")) ?? "")));
    await sectionShot("1-da-survol-1440.png");
    await role("ink").locator(".lc-role").blur();
    await page.mouse.move(5, 5);
    ok("A3c plus de survol : plus de surlignage", await fr.waitForFunction(() => document.querySelectorAll('[data-testid="hl-box"], [data-testid="hl-frame"]').length === 0, null, { timeout: 15000 }).then(() => true, () => false));
    // Focus clavier d'un autre rôle.
    await role("secondary").locator(".lc-role").focus();
    ok("A3d focus clavier « Accent » : surlignage aussi", await fr.waitForFunction(() => document.querySelectorAll('[data-testid="hl-box"]').length > 0, null, { timeout: 30000 }).then(() => true, () => false));
    await role("bg").locator(".lc-role").hover();
    ok("A3e « Fond de page » : liseré autour de la fenêtre", await fr.waitForFunction(() => document.querySelectorAll('[data-testid="hl-frame"]').length > 0, null, { timeout: 30000 }).then(() => true, () => false));
    await page.mouse.move(5, 5);

    // Changement de couleur : visible en moins de 200 ms, sans rechargement.
    const before = await frameVar(fr, "--t-color-secondary");
    ok("A4 « Accent » : couleur d'origine du thème dans l'aperçu", same(rgbOf(before), hexRgb(original.secondary)), before);
    await page.mouse.move(5, 5);
    const { ms, sameDoc } = await latencyOf("secondary", NEW_ACCENT, "--t-color-secondary");
    ok("A4b changement visible dans l'aperçu en moins de 200 ms", ms >= 0 && ms < 200, `${ms.toFixed(0)} ms`);
    ok("A4c sans rechargement du cadre", sameDoc && (await page.evaluate(() => window.frames[0].__keep)) === frameMarker);
    console.log(`      (délai mesuré : ${ms.toFixed(0)} ms)`);
    await sectionShot("2-da-selecteur-ouvert-1440.png");
    ok("A5 thème livré : première modification = invitation à créer une copie modifiable", await page.locator('[data-testid="da-copy-prompt"]').waitFor({ timeout: 10000 }).then(() => true, () => false) && /Créer une copie modifiable de ce thème/.test((await page.locator('[data-testid="da-copy"]').textContent()) ?? ""));
    ok("A5b le rôle modifié est marqué « modifiée »", /modifiée/.test((await role("secondary").locator(".lc-state").textContent()) ?? ""));
    ok("A5c rien n'est écrit sur le thème livré", JSON.stringify(colorsOf(PRESET)) === JSON.stringify(original));

    // Contraste en direct + « Ajuster automatiquement ».
    await typeHex("ink", BAD_INK);
    ok("A6 texte presque blanc : contraste insuffisant annoncé en direct", await role("ink").locator('[data-testid="contrast-status"]').filter({ hasText: /Lisibilité insuffisante/ }).waitFor({ timeout: 10000 }).then(() => true, () => false));
    await role("ink").locator('[data-testid="contrast-fix"]').click();
    ok("A6b « Ajuster automatiquement » : contraste suffisant", await role("ink").locator('[data-testid="contrast-status"]').filter({ hasText: /Lisibilité : (bonne|juste)/ }).waitFor({ timeout: 10000 }).then(() => true, () => false));
    // L'aperçu reçoit la teinte ajustée un instant après le bouton : on attend qu'elle change (flake constaté en mode rapide).
    let inkNow = await frameVar(fr, "--t-color-ink");
    for (let i = 0; i < 20 && (same(rgbOf(inkNow), hexRgb(BAD_INK)) || ratio(rgbOf(inkNow), rgbOf(await frameVar(fr, "--t-color-bg"))) < 4.5); i++) {
      await new Promise((r) => setTimeout(r, 300));
      inkNow = await frameVar(fr, "--t-color-ink");
    }
    ok("A6c l'aperçu montre la teinte ajustée", !same(rgbOf(inkNow), hexRgb(BAD_INK)) && ratio(rgbOf(inkNow), rgbOf(await frameVar(fr, "--t-color-bg"))) >= 4.5, inkNow);
    // Retour de « Texte » à l'enregistré : seule la couleur d'accent reste modifiée.
    await role("ink").getByRole("button", { name: "Revenir à la couleur enregistrée" }).click();
    ok("A6d « Revenir à la couleur enregistrée » : Texte comme avant", await waitFor(async () => same(rgbOf(await frameVar(fr, "--t-color-ink")), hexRgb(original.ink))));
    await role("ink").locator(".lc-role").click();

    // Création de la copie.
    await page.locator('[data-testid="da-copy"]').click();
    await page.waitForURL(new RegExp(`/admin/themes/${COPY}$`), { timeout: 60000 });
    ok("A7 copie créée : brouillon nommé, non en ligne", themeData(COPY)?.name === "Galerie lumineuse (copie)" && themeData(COPY)?.preset === false && setting("activeThemeId") === PRESET);
    await page.locator('[data-testid="da-section"]').waitFor();
    ok("A7b la copie ouvre l'édition avec les couleurs essayées, non enregistrées", await waitFor(async () => /modifiée/.test((await role("secondary").locator(".lc-state").textContent()) ?? "")));
    ok("A7c copie : couleurs enregistrées inchangées pour l'instant", JSON.stringify(colorsOf(COPY)) === JSON.stringify(original));
    ok("A7d copie : édition complète disponible (nom, enregistrer)", (await page.locator("#theme-name").count()) === 1 && (await page.locator('[data-testid="da-save"]').count()) === 1);
    ok("A7e plus d'invitation à créer une copie", (await page.locator('[data-testid="da-copy-prompt"]').count()) === 0);
    ok("A8 thème livré toujours intact", JSON.stringify(colorsOf(PRESET)) === JSON.stringify(original));
  });

/* ======================================== B. Copie ======================================== */

if (run("B"))
  await section("B", async () => {
    await gotoIdle(page, `${BASE}/admin/themes/${COPY}`);
    await page.locator('[data-testid="da-section"]').waitFor();
    const fr = await previewFrame();
    // La copie ouverte à neuf (sans brouillon repris) : couleur d'origine.
    ok("B0 copie rouverte : couleurs enregistrées", same(rgbOf(await frameVar(fr, "--t-color-secondary")), hexRgb(colorsOf(COPY).secondary)));
    const { ms } = await latencyOf("secondary", NEW_ACCENT, "--t-color-secondary");
    ok("B1 copie : changement visible dans l'aperçu en moins de 200 ms", ms >= 0 && ms < 200, `${ms.toFixed(0)} ms`);
    ok("B2 modifié, pas encore enregistré : l'état le dit", /pas encore enregistrées/.test((await page.locator('[data-testid="da-state"]').textContent()) ?? "") && JSON.stringify(colorsOf(COPY)) === JSON.stringify(original));
    await page.locator('[data-testid="da-save"]').click();
    ok("B3 copie hors ligne : enregistrement direct, sans confirmation", (await page.locator("dialog[open]").count()) === 0 && (await waitFor(() => colorsOf(COPY).secondary === NEW_ACCENT)), JSON.stringify(colorsOf(COPY).secondary));
    ok("B3c le site public n'a pas changé (copie hors ligne)", setting("activeThemeId") === PRESET && (await publicVar("/fr", "--t-color-secondary")) === original.secondary.toLowerCase());
    ok("B4 état « enregistrées » et rôle plus « modifiée »", await waitFor(async () => /celles du thème enregistré/.test((await page.locator('[data-testid="da-state"]').textContent()) ?? "")));
    await reloadIdle(page);
    ok("B5 rechargement : la couleur est celle de la copie", same(rgbOf(await frameVar(await previewFrame(), "--t-color-secondary")), hexRgb(NEW_ACCENT)));
    // Une autre page au choix dans l'aperçu, avec CE thème.
    await page.getByLabel("Page montrée dans l'aperçu").selectOption({ label: "Personnages" }).catch(async () => page.getByLabel("Page montrée dans l'aperçu").selectOption({ index: 1 }));
    const fr2 = await previewFrame();
    await sleep(1200);
    ok("B6 page au choix dans l'aperçu : même thème (copie) appliqué", same(rgbOf(await frameVar(fr2, "--t-color-secondary")), hexRgb(NEW_ACCENT)) && /\/fr\/[a-z-]+/.test(fr2.url()));
    await page.getByLabel("Page montrée dans l'aperçu").selectOption({ value: "0" });
  });

/* ======================================== D. Surcharge du site ======================================== */

if (run("D"))
  await section("D", async () => {
    await activateTheme("Galerie lumineuse (copie)");
    await gotoIdle(page, `${BASE}/admin/themes/${MINE()}`);
    ok("D0 sans surcharge du site : pas d'avertissement", (await page.locator('[data-testid="da-site-override"]').count()) === 0);
    // Deux couleurs remplacées par le site depuis l'éditeur de page (17f) : écrites comme le fait la publication.
    const prev = q("select value from settings where key = 'styles'")[0]?.value;
    exec("insert into settings (key, value) values ('styles', ?) on conflict(key) do update set value = excluded.value", JSON.stringify({ palette: { primary: "#1d4d7a", secondary: "#8a3b12" } }));
    await reloadIdle(page);
    const note = page.locator('[data-testid="da-site-override"]');
    ok("D1 surcharge active : « Couleurs personnalisées du site : 2 de ces couleurs sont remplacées »", await note.waitFor({ timeout: 20000 }).then(() => true, () => false) && /Couleurs personnalisées du site : 2 de ces couleurs sont remplacées depuis l'éditeur de page/.test((await note.textContent()) ?? ""), (await note.textContent().catch(() => "")) ?? "");
    ok("D2 l'avertissement nomme les couleurs remplacées", /boutons et liens/.test((await note.textContent()) ?? "") && /accent/.test((await note.textContent()) ?? ""));
    const link = page.locator('[data-testid="da-site-override-link"]');
    ok("D3 lien vers l'éditeur de page", /\/admin\/pages\/1\/editer$/.test((await link.getAttribute("href")) ?? ""));
    const fr = await previewFrame();
    ok("D4 pas de fusion silencieuse : l'aperçu montre les couleurs du THÈME, pas celles du site", same(rgbOf(await frameVar(fr, "--t-color-primary")), hexRgb(colorsOf(MINE()).primary)) && same(rgbOf(await frameVar(fr, "--t-color-secondary")), hexRgb(colorsOf(MINE()).secondary)));
    ok("D5 le panneau des couleurs du thème garde celles du thème", same(rgbOf(await role("primary").locator(".lc-role .lc-chip").evaluate((el) => getComputedStyle(el).backgroundColor)), hexRgb(colorsOf(MINE()).primary)));
    await sectionShot("5-da-surcharge-site-1440.png");
    if (prev) exec("update settings set value = ? where key = 'styles'", prev);
    else exec("delete from settings where key = 'styles'");
    await reloadIdle(page);
    ok("D6 surcharge retirée : l'avertissement disparaît", (await page.locator('[data-testid="da-site-override"]').count()) === 0);
  });

/* ======================================== C. Thème en ligne ======================================== */

if (run("C"))
  await section("C", async () => {
    await activateTheme("Galerie lumineuse (copie)");
    ok("C0 Mon thème (fait depuis la copie) est en ligne", setting("activeThemeId") === MINE());
    await gotoIdle(page, `${BASE}/admin/themes/${MINE()}`);
    await page.locator('[data-testid="da-section"]').waitFor();
    await previewFrame();
    ok("C1 état annoncé : « En ligne : v… » (en-tête de l'éditeur)", /En ligne : v\d+/.test((await page.locator('[data-testid="guide-status"]').textContent()) ?? ""));
    const liveBefore = await publicVar("/fr", "--t-color-primary");
    await latencyOf("primary", NEW_PRIMARY, "--t-color-primary");
    ok("C2 l'aperçu change tout de suite, pas le site public", (await publicVar("/fr", "--t-color-primary")) === liveBefore);
    ok("C2b « Enregistrer » ne promet plus de publier (une version brouillon)", /^Enregistrer$/.test(((await page.locator('[data-testid="da-save"]').textContent()) ?? "").trim()));
    await page.locator('[data-testid="da-save"]').click();
    ok("C3 enregistrer : une version brouillon, aucune fenêtre, le site public ne change pas", (await waitFor(() => colorsOf(MINE()).primary === NEW_PRIMARY)) && (await page.locator("dialog[open]").count()) === 0 && (await publicVar("/fr", "--t-color-primary")) === liveBefore);
    await page.locator('[data-testid="mine-bar-publish"]').click();
    const dlg = page.locator("dialog[open]");
    ok("C3b la fenêtre de publication liste le changement (avant → après)", await dlg.waitFor({ timeout: 10000 }).then(() => true, () => false) && /Boutons et liens/.test((await dlg.textContent()) ?? "") && (await dlg.textContent())?.toLowerCase().includes(NEW_PRIMARY));
    await sectionShot("4-da-confirmation-en-ligne-1440.png");
    await dlg.getByRole("button", { name: "Annuler" }).click();
    await sleep(800);
    ok("C4 annuler : le site public ne change pas", (await publicVar("/fr", "--t-color-primary")) === liveBefore);
    await page.locator('[data-testid="mine-bar-publish"]').click();
    await dlg.getByRole("button", { name: "Publier", exact: true }).click();
    ok("C5 confirmer : la version est publiée", await waitFor(() => q("select published_version p, version v from themes where mine = 1")[0].p === q("select version v from themes where mine = 1")[0].v));
    ok("C6 le site public montre les nouvelles couleurs", await waitFor(async () => (await publicVar("/fr", "--t-color-primary")) === NEW_PRIMARY, 60000), String(await publicVar("/fr", "--t-color-primary")));
    const pub = await ctx.newPage();
    await pub.setViewportSize({ width: 1440, height: 900 });
    await pub.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
    ok("C7 rendu public : aucun repère d'édition ni d'aperçu", (await pub.locator("[data-edit-mode], [data-preview-framed], .pe-host").count()) === 0);
    await pub.screenshot({ path: path.join(SHOTS, "6-public-apres-enregistrement-1440.png") });
    await pub.close();
  });

/* ======================================== E. Fonds de cartes ======================================== */

if (run("E"))
  await section("E", async () => {
    if (setting("activeThemeId") !== MINE()) await activateTheme("Galerie lumineuse (copie)");
    await gotoIdle(page, `${BASE}/admin/themes/${MINE()}`);
    await page.locator('[data-testid="step-tab-cartes"]').click();
    const cartes = page.locator("section.a-panel", { has: page.locator("#t-cartes") });
    await cartes.waitFor();
    await cartes.scrollIntoViewIfNeeded();
    const names = await cartes.locator('[data-testid="card-da-color"] .cc-name').allTextContents();
    ok("E1 « Cartes des rubriques » : les six couleurs de la DA en premier, avec leur nom", JSON.stringify(names) === JSON.stringify(["Fond de page", "Cartes et encadrés", "Texte", "Boutons et liens", "Accent", "Ornements"]), names.join(" | "));
    ok("E2 huit teintes douces (4 couleurs × 12 % et 25 %), nommées", (await cartes.locator('[data-testid="card-tint"]').count()) === 8 && (await cartes.locator('[data-token="primary12"]').getAttribute("title")) === "Boutons et liens, teinte 12 %");
    const swatch = (token) => cartes.locator(`[data-token="${token}"]`).evaluate((el) => getComputedStyle(el.querySelector(".cc-chip") ?? el).backgroundColor);
    const base = rgbOf(await swatch("primary"));
    const soft = rgbOf(await swatch("primary12"));
    const tint = rgbOf(await swatch("primary25"));
    const page_bg = rgbOf(await swatch("bg"));
    ok("E3 les teintes sont entre le fond de page et la couleur (12 % puis 25 %)", lum(soft) > lum(base) && lum(tint) < lum(soft) === (lum(base) < lum(page_bg)) && !same(soft, page_bg, 1) && !same(tint, base, 1), `${soft} ${tint}`);
    await page.screenshot({ path: path.join(SHOTS, "3-cartes-rubriques-teintes-1440.png"), fullPage: false });

    // Suivre un changement de palette : la même teinte change quand la couleur change (les couleurs de base sont à l'étape 1, la carte à l'étape 3).
    await page.locator('[data-testid="step-tab-couleurs"]').click();
    await typeHex("secondary", "#2f6b4f");
    const tintFollow = rgbOf(await swatch("secondary25"));
    ok("E4 la teinte suit la palette (même jeton, autre couleur, aperçu immédiat)", !same(tintFollow, hexRgb("#2f6b4f"), 1) && (await waitFor(async () => same(rgbOf(await swatch("secondary")), hexRgb("#2f6b4f")))));
    const followed = rgbOf(await swatch("secondary25"));
    await role("secondary").getByRole("button", { name: "Revenir à la couleur enregistrée" }).click();
    ok("E4b retour à l'enregistré : la teinte revient", await waitFor(async () => !same(rgbOf(await swatch("secondary25")), followed, 1)));
    await page.locator('[data-testid="step-tab-cartes"]').click();

    // Choisir une teinte : stockée en jeton.
    await cartes.locator('[data-token="tertiary25"]').click();
    ok("E5 teinte choisie : aria-checked et nom affiché", (await cartes.locator('[data-token="tertiary25"]').getAttribute("aria-checked")) === "true" && /Ornements, teinte 25 %/.test((await cartes.locator('[data-testid="card-color-name"]').textContent()) ?? ""));
    await page.locator(".a-savebar").getByRole("button", { name: "Enregistrer" }).click();
    ok("E6 enregistrée comme JETON (`tertiary25`), jamais un hex figé", await waitFor(() => themeData(MINE())?.tokens.layout?.card?.color === "tertiary25"), JSON.stringify(themeData(MINE())?.tokens.layout));
  });

/* ---- Éditeur visuel : popover « Carte » ---------------------------------------------------------- */

if (run("F"))
  await section("F", async () => {
    if (setting("activeThemeId") !== MINE()) await activateTheme("Galerie lumineuse (copie)");
    const PAGE_ID = 5;
    const draft = () => JSON.parse(q("select draft from pages where id = ?", PAGE_ID)[0]?.draft || "null");
    const draftBlocks = () => draft()?.blocks ?? [];
    await page.goto(`${BASE}/admin/pages/${PAGE_ID}/editer`, { waitUntil: "domcontentloaded" });
    const handle = await page.waitForSelector("iframe.ve-frame", { timeout: 120000 });
    const f = await handle.contentFrame();
    await f.waitForSelector("html[data-edit-mode]", { timeout: 180000 });
    await sleep(1500);
    const settled = async () => {
      await page.waitForFunction(() => !/Enregistrement/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, { timeout: 120000 });
      await sleep(600);
    };
    // Une rubrique « Texte » avec un vrai texte.
    const addEnd = f.locator('[data-edit-add="end"]');
    await addEnd.scrollIntoViewIfNeeded();
    await addEnd.click();
    await page.locator("dialog.ve-add .ve-add-card").first().click();
    await f.locator("[data-editing]").waitFor({ timeout: 60000 });
    await page.keyboard.press("Escape");
    await settled();
    await f.locator('[data-edit-type="rich-text"] [data-inline="paragraphs.0"]').last().dblclick();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("Mes couleurs du jour, en carte douce.");
    await page.keyboard.press("Enter");
    await settled();
    const uid = (await f.locator('[data-edit-block][data-edit-type="rich-text"]:not([data-edit-parent])').evaluateAll((els) => els.map((e) => e.getAttribute("data-edit-block"))))[0];
    ok("F0 rubrique Texte ajoutée", Boolean(uid));
    await f.locator(`.pe-focus[data-uid="${uid}"]`).scrollIntoViewIfNeeded();
    await f.locator(`[data-edit-block="${uid}"] section`).first().click({ position: { x: 4, y: 30 } });
    const fond = f.locator(".pe-tools [data-testid=\"fond-button\"]");
    await fond.waitFor({ timeout: 30000 });
    await fond.click();
    const menu = f.locator('[data-testid="fond-menu"]');
    await menu.locator('[data-testid="fond-section-carte"] [data-kind="color"]').click();
    const cc = menu.locator('[data-testid="card-colors"]');
    ok("F1 popover « Carte » : les six couleurs de la DA, nommées, en premier", JSON.stringify(await cc.locator('[data-testid="card-da-color"] .cc-name').allTextContents()) === JSON.stringify(["Fond de page", "Cartes et encadrés", "Texte", "Boutons et liens", "Accent", "Ornements"]));
    ok("F1b suivies d'une rangée de huit teintes douces", (await cc.locator('[data-testid="card-tint"]').count()) === 8);
    await page.screenshot({ path: path.join(SHOTS, "3b-popover-fond-teintes-1440.png") });
    const cardBg = () => f.evaluate((u) => getComputedStyle(document.querySelector(`[data-edit-block="${u}"] > .surface-card`)).backgroundColor, uid);
    await menu.locator('[data-token="secondary12"]').click();
    const chip = await menu.locator('[data-token="secondary12"]').evaluate((el) => getComputedStyle(el).backgroundColor);
    ok("F2 teinte choisie : la carte prend exactement la couleur de la pastille, à l'instant", same(rgbOf(await cardBg()), rgbOf(chip), 1), `${await cardBg()} vs ${chip}`);
    ok("F2b brouillon : jeton `secondary12` (pas un hex)", await waitFor(() => draftBlocks().find((b) => b.type === "rich-text")?.props.surface?.color === "secondary12"), JSON.stringify(draftBlocks().find((b) => b.type === "rich-text")?.props.surface));
    const ink = await f.evaluate((u) => getComputedStyle(document.querySelector(`[data-edit-block="${u}"] .surface-card p, [data-edit-block="${u}"] .surface-card [data-inline]`)).color, uid);
    ok("F3 texte lisible dans la carte teintée (≥ 4,5:1)", ratio(rgbOf(ink), rgbOf(await cardBg())) >= 4.5, `${ink} / ${await cardBg()}`);
    ok("F3b nom de la couleur choisie affiché", /Accent, teinte 12 %/.test((await cc.locator('[data-testid="card-color-name"]').textContent()) ?? ""));
    await page.keyboard.press("Escape");
    await settled();
    await page.getByRole("button", { name: "Publier", exact: true }).click();
    ok("F4 page publiée", await waitFor(async () => /En ligne/.test((await page.locator(".ve-status").textContent()) ?? ""), 120000));
    const cardVar = async () => {
      const html = await (await fetch(`${BASE}/fr/a-propos`, { cache: "no-store" })).text();
      return /--card-bg:\s*(#[0-9a-fA-F]{6})/.exec(html)?.[1]?.toLowerCase() ?? null;
    };
    ok("F5 rendu public : la carte a la teinte (calculée sur la palette)", await waitFor(async () => (await cardVar()) !== null, 60000));
    const publicBefore = await cardVar();
    ok("F5b public = aperçu de l'éditeur", same(hexRgb(publicBefore), rgbOf(chip), 2), `${publicBefore} vs ${chip}`);

    // Changement de palette du thème en ligne : la carte suit.
    await gotoIdle(page, `${BASE}/admin/themes/${MINE()}`);
    await page.locator('[data-testid="da-section"]').waitFor();
    await previewFrame();
    await typeHex("secondary", "#2f6b4f");
    await page.locator('[data-testid="da-save"]').click();
    await waitFor(() => colorsOf(MINE()).secondary === "#2f6b4f");
    await page.locator('[data-testid="mine-bar-publish"]').click();
    await page.locator("dialog[open]").getByRole("button", { name: "Publier", exact: true }).click();
    ok("F6 palette du thème modifiée et publiée", await waitFor(() => colorsOf(MINE()).secondary === "#2f6b4f"));
    ok("F7 la teinte de la carte publique suit le changement de palette (jeton, pas hex figé)", await waitFor(async () => {
      const now = await cardVar();
      return now !== null && now !== publicBefore;
    }, 60000), `${publicBefore} -> ${await cardVar()}`);
    const after = await cardVar();
    ok("F7b la nouvelle teinte vient de la nouvelle couleur (plus verte)", after !== null && hexRgb(after)[1] >= hexRgb(publicBefore)[1] - 1, `${publicBefore} -> ${after}`);
    const pub = await ctx.newPage();
    await pub.setViewportSize({ width: 1440, height: 900 });
    await pub.goto(`${BASE}/fr/a-propos`, { waitUntil: "networkidle" });
    await pub.screenshot({ path: path.join(SHOTS, "7-public-carte-teinte-1440.png") });
    await pub.close();
  });

ok("aucune exception JavaScript sur les pages testées", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `e2e-couleurs-da : ${failures} échec(s)` : "e2e-couleurs-da : OK");
process.exit(failures ? 1 : 0);
