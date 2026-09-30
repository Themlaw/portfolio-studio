#!/usr/bin/env node
/**
 * Captures de l'admin : connexion (et erreur), tableau de bord, Thèmes,
 * Réglages (diagnostic), menu mobile, en 1440 et 390 → screenshots/<SHOTS_DIR>/. Serveur dev requis ; connexion
 * par le vrai formulaire avec ADMIN_EMAIL / ADMIN_PASSWORD. Attention à la
 * limitation de débit (5 essais / minute) si on relance en boucle.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run shots:admin
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
const BASE = process.env.BASE ?? "http://localhost:3001";
const OUT = `screenshots/${process.env.SHOTS_DIR ?? "phase3"}`;
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/admin/connexion`, { waitUntil: "networkidle" });
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: `${OUT}/connexion-${w}.png`, fullPage: true });
  // Erreur affichée (mauvais mot de passe), puis connexion réelle par le formulaire.
  await p.fill("#email", EMAIL);
  await p.fill("#password", "pas-le-bon");
  await p.click("button[type=submit]");
  await p.waitForSelector(".a-alert");
  console.log(w, "erreur :", await p.textContent(".a-alert"));
  await p.screenshot({ path: `${OUT}/connexion-erreur-${w}.png`, fullPage: true });
  await p.fill("#password", PASSWORD);
  await p.click("button[type=submit]");
  await p.waitForURL(`${BASE}/admin`);
  await p.waitForLoadState("networkidle");
  await p.screenshot({ path: `${OUT}/tableau-de-bord-${w}.png`, fullPage: true });
  await p.goto(`${BASE}/admin/themes`, { waitUntil: "networkidle" });
  await p.screenshot({ path: `${OUT}/themes-${w}.png`, fullPage: true });
  await p.goto(`${BASE}/admin/reglages`, { waitUntil: "networkidle" });
  await p.locator("#diagnostic").scrollIntoViewIfNeeded();
  await p.screenshot({ path: `${OUT}/reglages-diagnostic-${w}.png`, fullPage: true });
  if (w === 390) {
    await p.click("button[aria-controls=a-sidebar]");
    await p.waitForTimeout(200);
    await p.screenshot({ path: `${OUT}/menu-ouvert-390.png` });
  }
  await ctx.close();
}
await b.close();
console.log("captures :", OUT);
