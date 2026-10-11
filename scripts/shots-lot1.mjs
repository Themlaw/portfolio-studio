#!/usr/bin/env node
/**
 * Captures avant / après du lot 1 (v0.13.1) : espacement sous une Grille,
 * pied de page sur une page courte, adresse e-mail (profil, pied, contact),
 * icônes des réseaux dans l'en-tête. Serveur dev requis.
 *
 * Usage : LABEL=avant|apres SHOTS=/root/shots-lot1 BASE=http://localhost:3101 node scripts/shots-lot1.mjs
 */
import { mkdirSync } from "node:fs";

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3001";
const OUT = `${process.env.SHOTS ?? "screenshots/lot1"}/${process.env.LABEL ?? "apres"}`;
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Interrupteur « Icônes des réseaux dans l'en-tête » : clic sur son libellé (comme l'artiste). */
async function setHeaderSwitch(p, on) {
  const sw = p.getByRole("switch", { name: "Icônes des réseaux dans l'en-tête" });
  if ((await sw.isChecked()) !== on) await p.locator("label.a-toggle", { hasText: "Icônes des réseaux dans l'en-tête" }).click();
  return (await sw.isChecked()) === on;
}


const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const metrics = {};

async function go(path, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await sleep(400);
}

// 3. Grille : espace entre la grille et le bloc suivant (page Animation).
await go("/fr/animation");
metrics.grid = await page.evaluate(() => {
  const grids = [...document.querySelectorAll(".block-grid")];
  return grids.map((g) => {
    const section = g.closest("section");
    let next = section?.nextElementSibling;
    while (next && !next.getBoundingClientRect().height) next = next.nextElementSibling;
    const content = (el) => [...el.querySelectorAll("img, video, h2, p, a, .strip-rail, iframe")].map((x) => x.getBoundingClientRect()).filter((r) => r.height);
    const nextTop = next ? Math.min(...content(next).map((r) => r.top)) : null;
    const nextBox = next?.getBoundingClientRect().top ?? null;
    return { gridBottom: Math.round(g.getBoundingClientRect().bottom), nextBox: nextBox && Math.round(nextBox), nextContent: nextTop && Math.round(nextTop), next: next?.tagName + "." + (next?.className ?? "").toString().slice(0, 40) };
  });
});
const gridBox = await page.locator(".block-grid").last().boundingBox();
await page.screenshot({ path: `${OUT}/3-grille-bas.png`, clip: { x: 0, y: Math.max(0, gridBox.y + gridBox.height - 450), width: 1440, height: 800 }, fullPage: true });

// 4. Pied de page sur une page courte (404) et sur une page vide de contenu.
for (const [w, h] of [
  [1440, 1500],
  [390, 1400],
]) {
  await go("/fr/page-qui-nexiste-pas", w, h);
  metrics[`footer404-${w}`] = await page.evaluate(() => {
    const f = document.querySelector("footer");
    return f ? { footerBottom: Math.round(f.getBoundingClientRect().bottom + window.scrollY), docHeight: document.documentElement.scrollHeight, viewport: window.innerHeight } : null;
  });
  await page.screenshot({ path: `${OUT}/4-pied-page-courte-${w}.png` });
}

// 6. E-mail : profil (À propos) et pied de page, plusieurs largeurs.
for (const w of [1440, 1280, 1024, 820, 768, 390, 360]) {
  await go("/fr/a-propos", w, 900);
  const m = await page.evaluate(() => {
    const out = {};
    for (const [k, sel] of [
      ["profil", 'main a[href^="mailto:"]:not(.btn)'],
      ["pied", 'footer a[href^="mailto:"]'],
    ]) {
      const a = document.querySelector(sel);
      if (!a) continue;
      const rects = [...a.getClientRects()];
      const lh = parseFloat(getComputedStyle(a).lineHeight) || parseFloat(getComputedStyle(a).fontSize) * 1.2;
      out[k] = { lignes: Math.round(a.getBoundingClientRect().height / lh), fontSize: getComputedStyle(a).fontSize, font: getComputedStyle(a).fontFamily.split(",")[0], deborde: a.scrollWidth > a.clientWidth + 1 || a.getBoundingClientRect().right > document.documentElement.clientWidth, rects: rects.length };
    }
    return out;
  });
  metrics[`email-${w}`] = m;
  const prof = page.locator('main a[href^="mailto:"]:not(.btn)').first();
  await prof.scrollIntoViewIfNeeded();
  const b = await prof.boundingBox();
  if (b) await page.screenshot({ path: `${OUT}/6-email-profil-${w}.png`, clip: { x: 0, y: Math.max(0, b.y - 120), width: w, height: 300 } });
  const foot = page.locator('footer a[href^="mailto:"]').first();
  await foot.scrollIntoViewIfNeeded();
  const fb = await foot.boundingBox();
  if (fb) await page.screenshot({ path: `${OUT}/6-email-pied-${w}.png`, clip: { x: 0, y: Math.max(0, fb.y - 80), width: w, height: 260 } });
}

// 8. En-tête : ordinateur, puis téléphone menu ouvert. HEADER_ON=1 : option cochée
// dans Réglages le temps des captures (admin ADMIN_EMAIL / ADMIN_PASSWORD), puis décochée.
async function headerOption(on) {
  const admin = await ctx.newPage();
  await admin.setViewportSize({ width: 1440, height: 900 });
  await admin.goto(`${BASE}/admin/reglages`, { waitUntil: "networkidle" });
  if (admin.url().includes("/admin/connexion")) {
    await admin.fill("#email", process.env.ADMIN_EMAIL);
    await admin.fill("#password", process.env.ADMIN_PASSWORD);
    await Promise.all([admin.waitForURL((u) => !u.pathname.startsWith("/admin/connexion"), { timeout: 90000 }), admin.click("button[type=submit]")]);
    await admin.goto(`${BASE}/admin/reglages`, { waitUntil: "networkidle" });
  }
  await setHeaderSwitch(admin, on);
  await admin.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await sleep(2500);
  await admin.close();
}
if (process.env.HEADER_ON === "1") await headerOption(true);
await go("/fr", 1440, 900);
await page.screenshot({ path: `${OUT}/8-entete-1440.png`, clip: { x: 0, y: 0, width: 1440, height: 120 } });
metrics.headerSocials = await page.evaluate(() => [...document.querySelectorAll(".site-header-socials a")].map((a) => a.getAttribute("aria-label")));
await go("/fr", 390, 844);
await page.locator('button[aria-controls="nav-mobile"]').click();
await sleep(400);
await page.screenshot({ path: `${OUT}/8-entete-menu-390.png` });

if (process.env.HEADER_ON === "1") await headerOption(false);
// Pages longues : hauteur du document (le cadre pleine hauteur ne doit rien changer).
for (const p of ["/fr", "/fr/personnages", "/fr/a-propos", "/fr/animation"]) {
  await go(p, 1440, 900);
  metrics[`hauteur ${p}`] = await page.evaluate(() => document.documentElement.scrollHeight);
}
console.log(JSON.stringify(metrics, null, 1));
await browser.close();
