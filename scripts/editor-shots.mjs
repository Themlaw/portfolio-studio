#!/usr/bin/env node
/**
 * Captures des éditeurs de l'admin (phase 4a) en 1440 et 390 →
 * screenshots/<SHOTS_DIR>/ : liste et éditeur de thème (avec un contraste
 * refusé), liste des pages, éditeur de page avec un bloc ouvert, sélecteur
 * de blocs, réglages. Crée une copie de thème le temps des captures puis la
 * supprime. Serveur dev requis, redémarré et pré-chauffé ; une connexion.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run shots:editors
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3001";
const OUT = `screenshots/${process.env.SHOTS_DIR ?? "phase4a"}`;
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
p.on("dialog", (d) => d.accept());
const shot = async (name, full = true) => {
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(250);
  await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  console.log("  ", name);
};
const go = async (path) => p.goto(BASE + path, { waitUntil: "networkidle" });

await go("/admin/connexion");
await p.fill("#email", EMAIL);
await p.fill("#password", PASSWORD);
await p.click("button[type=submit]");
await p.waitForURL(`${BASE}/admin`);

// Copie de thème pour l'éditeur.
await go("/admin/themes");
await p.locator(".a-theme-card:has(#theme-galerie-lumineuse)").getByRole("button", { name: "Dupliquer" }).click();
await p.waitForURL(/\/admin\/themes\/[a-z0-9-]+$/);
const themePath = new URL(p.url()).pathname;
const themeId = themePath.split("/").pop();

for (const w of [1440, 390]) {
  await p.setViewportSize({ width: w, height: w === 1440 ? 900 : 844 });
  await go("/admin/themes");
  await shot(`themes-${w}`);
  await go(themePath);
  await p.frameLocator("iframe.a-preview-frame").locator("html[data-theme]").waitFor({ timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(1200);
  if (w === 1440) {
    await shot("theme-editeur-1440", false);
    const field = p.locator('.a-color[data-token="inkSoft"]');
    await field.getByLabel("Texte secondaire", { exact: true }).fill("#c4c4c4");
    await field.scrollIntoViewIfNeeded();
    await p.waitForTimeout(400);
    await shot("theme-editeur-contraste-1440", false);
    await p.locator(".a-variant-choice").first().scrollIntoViewIfNeeded();
    await shot("theme-editeur-formes-1440", false);
    await p.reload({ waitUntil: "networkidle" });
  } else {
    await shot("theme-editeur-reglages-390");
    await p.getByRole("tab", { name: "Aperçu" }).click();
    await p.waitForTimeout(1500);
    await shot("theme-editeur-apercu-390", false);
  }
  await go("/admin/pages");
  await shot(`pages-${w}`);
  await go("/admin/pages/1");
  await p.locator(".a-block-toggle", { hasText: "Entrées des collections" }).click();
  await p.waitForTimeout(300);
  await shot(`page-editeur-bloc-ouvert-${w}`);
  // Haut de page (en-tête et ses actions) et bas de page : la barre
  // d'enregistrement ne recouvre pas le dernier contenu.
  await p.evaluate(() => window.scrollTo(0, 0));
  await shot(`page-editeur-haut-${w}`, false);
  await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await shot(`page-editeur-bas-${w}`, false);
  if (w === 1440) {
    await p.getByRole("button", { name: "+ Ajouter un bloc" }).click();
    await shot("page-ajout-bloc-1440", false);
    await p.keyboard.press("Escape");
  }
  await go("/admin/reglages");
  await shot(`reglages-${w}`);
}

// Suppression de la copie.
await p.setViewportSize({ width: 1440, height: 900 });
await go("/admin/themes");
await p.locator(`.a-theme-card:has(#theme-${themeId})`).getByRole("button", { name: "Supprimer" }).click();
await shot("theme-suppression-1440", false);
await p.locator("dialog[open]").getByRole("button", { name: "Supprimer" }).click();
await p.locator(".a-toast", { hasText: "supprimé" }).first().waitFor();
await b.close();
console.log("captures :", OUT);
