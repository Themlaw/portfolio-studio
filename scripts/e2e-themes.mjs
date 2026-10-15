#!/usr/bin/env node
/**
 * Thèmes livrés et import / export (v0.14), un seul chromium sobre.
 * Serveur dev requis (redémarré puis pré-chauffé), base de test.
 *
 *  A. Chaque thème livré (ou THEMES=a,b) appliqué par l'aperçu : accueil,
 *     collection, à propos, visionneuse ouverte — data-theme correct, AUCUNE
 *     erreur console ni erreur de page. SHOTS=<dossier> : captures 1440 × 900
 *     et 390 × 844 de ces quatre vues.
 *  B. Admin → Thèmes (connexion par le formulaire) : galerie avec vignettes,
 *     export d'un thème (ZIP valide), import par le bouton d'une archive
 *     valide (élément dessiné servi par /media avec CSP sandbox), puis import
 *     de chaque archive malveillante (scripts/lib/theme-packages.mjs) :
 *     refusée avec un message, aucun thème créé. Thème importé supprimé à la fin.
 * Usage : BASE=http://localhost:3001 ADMIN_EMAIL=… ADMIN_PASSWORD=… [SHOTS=/dossier] [ONLY=A|B] node scripts/e2e-themes.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { chromium } from "playwright";

import { loadPreset, presetSlugs } from "./lib/presets.mjs";
import { maliciousPackages, validPackage } from "./lib/theme-packages.mjs";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
const SHOTS = process.env.SHOTS;
const ONLY = process.env.ONLY ?? "AB";
const THEMES = process.env.THEMES ? process.env.THEMES.split(",") : presetSlugs();

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
let errors = [];
function watch(page) {
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
  page.on("console", (m) => m.type() === "error" && !/favicon/.test(m.text()) && errors.push(m.text().slice(0, 200)));
}
async function settle(page) {
  await page.waitForLoadState("networkidle");
  // Indicateur du serveur dev (Next) : hors des captures.
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
}
async function scrollThrough(page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(400);
}

/* ---- A. thèmes livrés ------------------------------------------------------ */
if (ONLY.includes("A")) {
  console.log("== A. thèmes livrés appliqués");
  for (const [vw, vh] of SHOTS ? [[1440, 900], [390, 844]] : [[1440, 900]]) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    watch(page);
    for (const id of THEMES) {
      errors = [];
      await page.goto(`${BASE}/api/theme-preview?id=${id}&redirect=/fr&banner=0`);
      await settle(page);
      const applied = await page.evaluate(() => document.documentElement.dataset.theme);
      const dir = SHOTS && path.join(SHOTS, id);
      if (dir) mkdirSync(dir, { recursive: true });
      const shot = async (name, full = false) => dir && page.screenshot({ path: path.join(dir, `${name}-${vw}.png`), fullPage: full, animations: "disabled" });
      await shot("accueil");
      for (const [name, url] of [["collection", "/fr/personnages"], ["a-propos", "/fr/a-propos"]]) {
        await page.goto(`${BASE}${url}`);
        await settle(page);
        await scrollThrough(page);
        await shot(name, true);
      }
      await page.goto(`${BASE}/fr/decors`);
      await settle(page);
      await page.locator("section:has(.strip-frame + .strip-frame) .strip-frame").first().click();
      const lightbox = page.locator(".lightbox");
      await lightbox.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(700);
      const lbOpen = await lightbox.isVisible();
      await shot("visionneuse");
      await page.keyboard.press("Escape");
      ok(`A ${id} (${vw}px) : appliqué, visionneuse ouverte, aucune erreur console`, applied === id && lbOpen && errors.length === 0, `thème=${applied} visionneuse=${lbOpen} erreurs=${errors.join(" | ")}`);
    }
    await ctx.close();
  }
}

/* ---- B. import / export ------------------------------------------------------ */
if (ONLY.includes("B")) {
  if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
  console.log("== B. Admin → Thèmes : galerie, export, import");
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  watch(page);
  page.on("dialog", (d) => d.accept());
  errors = [];
  await page.goto(`${BASE}/admin/connexion`, { waitUntil: "networkidle" });
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}/admin`, { timeout: 60000 });
  await page.goto(`${BASE}/admin/themes`, { waitUntil: "networkidle" });
  const cards = () => page.locator(".a-theme-card").count();
  const thumbs = await page.locator(".a-theme-card img.a-theme-thumb").count();
  const before = await cards();
  ok(`B1 galerie : ${before} thèmes, ${thumbs} vignettes générées`, before >= presetSlugs().length && thumbs >= presetSlugs().length, `${before} cartes, ${thumbs} vignettes`);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, "admin-themes.png"), fullPage: true });
  }

  // Export (requête de la page : cookie de session).
  const exported = await page.evaluate(async () => {
    const r = await fetch("/admin/api/themes/galerie-lumineuse/export");
    const b = new Uint8Array(await r.arrayBuffer());
    return { status: r.status, type: r.headers.get("content-type"), disp: r.headers.get("content-disposition"), head: [...b.slice(0, 4)], size: b.length };
  });
  ok("B2 export : ZIP en pièce jointe", exported.status === 200 && exported.type === "application/zip" && /theme-galerie-lumineuse\.zip/.test(exported.disp ?? "") && exported.head.join() === "80,75,3,4", JSON.stringify(exported));

  // Import valide par le bouton.
  const base = await loadPreset("galerie-lumineuse");
  const valid = validPackage(base);
  const tmp = path.join(process.env.TMPDIR ?? "/tmp", "theme-e2e-valide.zip");
  writeFileSync(tmp, valid.zip);
  await page.getByTestId("theme-import-input").setInputFiles(tmp);
  await page.locator(".a-toast", { hasText: "importé" }).first().waitFor({ timeout: 20000 }).catch(() => {});
  await page.waitForLoadState("networkidle");
  const importedCard = page.locator(".a-theme-card", { hasText: "Thème importé e2e" });
  // La galerie se rafraîchit APRÈS le toast : attendre la carte avant de compter.
  await importedCard.first().waitFor({ timeout: 30000 }).catch(() => {});
  const after = await cards();
  ok("B3 import valide (bouton) : un thème de plus, non livré, non en ligne", after === before + 1 && (await importedCard.count()) === 1 && (await importedCard.locator(".a-badge").count()) === 0, `${before} → ${after}`);
  const kit = await fetch(BASE + valid.kitPath);
  ok("B4 élément dessiné importé servi par /media (SVG, CSP sandbox)", kit.status === 200 && kit.headers.get("content-type") === "image/svg+xml" && /sandbox/.test(kit.headers.get("content-security-policy") ?? ""), `${kit.status}`);
  ok("B4b vignette dessinée pour le thème importé (pas de capture)", (await importedCard.locator(".a-theme-mini").count()) === 1);

  // Archives malveillantes : une par le bouton (message visible), les autres par requête.
  const evil = maliciousPackages(base);
  const first = path.join(process.env.TMPDIR ?? "/tmp", "theme-e2e-piege.zip");
  writeFileSync(first, evil[0][1]);
  await page.getByTestId("theme-import-input").setInputFiles(first);
  const toast = page.locator(".a-toast", { hasText: "Import refusé" }).first();
  await toast.waitFor({ timeout: 20000 }).catch(() => {});
  ok(`B5 « ${evil[0][0]} » par le bouton : message d'erreur affiché`, await toast.isVisible(), await page.locator(".a-toast").allInnerTexts().then((t) => t.join(" | ")));
  for (const [label, zip, pattern] of evil) {
    const res = await page.evaluate(async (bytes) => {
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(bytes)], { type: "application/zip" }), "theme.zip");
      const r = await fetch("/admin/api/themes/import", { method: "POST", body: form });
      return { status: r.status, body: await r.json().catch(() => null) };
    }, [...zip]);
    ok(`B6 refusé : ${label}`, res.status >= 400 && res.status < 500 && res.body?.ok === false && pattern.test(res.body?.message ?? ""), `${res.status} ${res.body?.message}`);
  }
  await page.reload({ waitUntil: "networkidle" });
  ok("B7 aucune archive malveillante n'a créé de thème", (await cards()) === before + 1, `${await cards()} cartes`);

  // Nettoyage : suppression du thème importé.
  if (await importedCard.count()) {
    await importedCard.getByRole("button", { name: /Plus d'actions/ }).click();
    await page.getByRole("menuitem", { name: "Supprimer" }).click();
    await page.locator("dialog[open]").getByRole("button", { name: "Supprimer" }).click();
    await page.locator("dialog[open]").waitFor({ state: "detached" });
    await page.reload({ waitUntil: "networkidle" });
  }
  ok("B8 thème importé supprimé, galerie revenue à l'état initial", (await cards()) === before);
  ok("B9 aucune erreur console dans l'admin", errors.filter((e) => !/422|Failed to load resource/.test(e)).length === 0, errors.join(" | "));
  await ctx.close();
}

await browser.close();
console.log(failures ? `\nECHECS : ${failures}` : "\nTOUT PASSE");
process.exit(failures ? 1 : 0);
