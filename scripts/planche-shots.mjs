#!/usr/bin/env node
/**
 * Captures de la phase 4b (1440 et 390) → screenshots/<SHOTS_DIR>/ : liste
 * des projets, éditeur de planche avec un emplacement vide, une image en
 * traitement et le panneau ouvert, médiathèque avec le détail ouvert. Crée un
 * projet et des images de démonstration, puis les supprime.
 * Serveur dev requis (redémarré, pré-chauffé) ; une connexion.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run shots:planche
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3001";
const OUT = `screenshots/${process.env.SHOTS_DIR ?? "phase4b"}`;
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
mkdirSync(OUT, { recursive: true });

const DIR = path.join(tmpdir(), "planche-shots");
mkdirSync(DIR, { recursive: true });
const f = (n) => path.join(DIR, n);
// Images de démonstration (processus à part : mémoire de sharp rendue).
execFileSync(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    `import sharp from "sharp";
const scene = (w, h, a, b, sun) => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + a + '"/><stop offset="1" stop-color="' + b + '"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="' + w * 0.7 + '" cy="' + h * 0.35 + '" r="' + h * 0.12 + '" fill="' + sun + '"/><path d="M0 ' + h * 0.75 + ' Q ' + w * 0.3 + ' ' + h * 0.55 + ' ' + w * 0.6 + ' ' + h * 0.72 + ' T ' + w + ' ' + h * 0.68 + ' V ' + h + ' H 0 Z" fill="#2d3a4a" opacity="0.8"/></svg>');
await sharp(scene(1600, 1000, "#f3d9b1", "#c0503a", "#fff3d6")).jpeg().toFile(${JSON.stringify(f("demo-crepuscule.jpg"))});
await sharp(scene(900, 1200, "#cfe0e8", "#5d7f95", "#f2d16b")).png().toFile(${JSON.stringify(f("demo-portrait.png"))});
await sharp(scene(1600, 900, "#e6e2d3", "#8a9a6b", "#c0503a")).webp().toFile(${JSON.stringify(f("demo-lande.webp"))});
await sharp(scene(6000, 4000, "#1f2a44", "#2e4e9e", "#f2d16b")).jpeg().toFile(${JSON.stringify(f("demo-grand-a.jpg"))});
await sharp(scene(6000, 4000, "#2a1f44", "#7a2e8e", "#f6f5f2")).jpeg().toFile(${JSON.stringify(f("demo-grand-b.jpg"))});`,
  ],
  { stdio: "inherit" },
);

const b = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
p.on("dialog", (d) => d.accept());
const shot = async (name, full = false) => {
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  console.log("  ", name);
};
const toast = (t) => p.locator(".a-toast", { hasText: t }).first().waitFor({ timeout: 30000 });
const ready = (n) =>
  p.waitForFunction((n) => document.querySelectorAll(".a-strip .a-slot").length >= n && !document.querySelector('.a-strip .a-slot[data-status="processing"]'), n, { timeout: 120000 });

await p.goto(`${BASE}/admin/connexion`, { waitUntil: "networkidle" });
await p.fill("#email", EMAIL);
await p.fill("#password", PASSWORD);
await p.click("button[type=submit]");
await p.waitForURL(`${BASE}/admin`);

await p.goto(`${BASE}/admin/projets`, { waitUntil: "networkidle" });
await p.getByRole("button", { name: "Nouveau projet" }).click();
await p.locator("dialog[open]").getByLabel("Titre en français").fill("Carnet de lumière");
await p.locator("dialog[open]").getByRole("button", { name: "Créer le projet" }).click();
await p.waitForURL(/\/admin\/projets\/\d+$/);
const editor = new URL(p.url()).pathname;
await p.locator(".a-strip-end input[type=file]").setInputFiles([f("demo-crepuscule.jpg"), f("demo-portrait.png"), f("demo-lande.webp")]);
await ready(3);
// Titres : la suggestion tirée du nom de fichier, appliquée d'un clic.
for (const i of [1, 2, 3]) {
  await p.locator(".a-strip .a-slot-image").nth(i - 1).click();
  await p.locator(".a-slot-panel").getByRole("button", { name: /^Titre suggéré/ }).click();
  await p.locator(".a-slot-panel").getByRole("button", { name: "Enregistrer", exact: true }).click();
  await toast("Emplacement enregistré");
  await p.waitForTimeout(400);
}
// Un emplacement vide : image retirée du portrait, la place garde son ratio.
await p.locator(".a-strip .a-slot-image").nth(1).click();
await p.locator(".a-slot-panel").getByRole("button", { name: "Retirer l'image" }).click();
await p.locator("dialog[open]").getByRole("button", { name: "Retirer l'image" }).click();
await toast("Image retirée");
// Toasts fusionnés (« … ×3 »), rangés à gauche du panneau ouvert.
await p.locator("#pr-planche").evaluate((el) => el.scrollIntoView({ block: "center" }));
await shot("planche-toasts-1440");
await p.locator(".a-slot-panel").getByRole("button", { name: "Fermer le panneau" }).click();
await p.locator("#pr-planche").evaluate((el) => el.scrollIntoView({ block: "start" }));
await p.locator(".a-planche").evaluate((el) => (el.scrollLeft = 0));
await shot("planche-vide-ratio-1440");

for (const [w, h, big] of [
  [1440, 900, "demo-grand-a.jpg"],
  [390, 844, "demo-grand-b.jpg"],
]) {
  await p.setViewportSize({ width: w, height: h });
  await p.goto(`${BASE}/admin/projets`, { waitUntil: "networkidle" });
  await shot(`projets-${w}`, true);
  await p.goto(`${BASE}${editor}`, { waitUntil: "networkidle" });
  // Une image en cours de traitement (6000 × 4000) au moment de la capture.
  await p.locator(".a-strip-end input[type=file]").setInputFiles([f(big)]);
  await p.locator('.a-strip .a-slot[data-status="processing"]').first().waitFor({ timeout: 60000 });
  await p.locator("#pr-planche").evaluate((el) => el.scrollIntoView({ block: "start" }));
  if (w === 390) {
    await p.locator(".a-planche").evaluate((el) => (el.scrollLeft = el.scrollWidth));
    await shot("planche-390");
    await p.locator(".a-strip .a-slot-image").first().click();
    await p.locator(".a-slot-panel").waitFor();
    await p.waitForTimeout(700);
    await shot("planche-panneau-390");
  } else {
    // Panneau ouvert : la mise en page se resserre, l'emplacement choisi reste visible.
    await p.locator(".a-strip .a-slot-image").nth(1).click();
    await p.locator(".a-slot-panel").waitFor();
    await p.waitForTimeout(700);
    await shot("planche-1440");
  }
  await ready(4 + (w === 390 ? 1 : 0));
}

await p.setViewportSize({ width: 1440, height: 900 });
await p.goto(`${BASE}/admin/medias`, { waitUntil: "networkidle" });
await shot("medias-1440");
await p.locator(".a-media-tile", { hasText: "demo-crepuscule.jpg" }).click();
await p.locator(".a-sidepanel .a-refs li").first().waitFor();
await shot("medias-detail-1440");
await p.setViewportSize({ width: 390, height: 844 });
await shot("medias-detail-390");

// Nettoyage : projet et images de démonstration.
await p.setViewportSize({ width: 1440, height: 900 });
await p.goto(`${BASE}/admin/projets`, { waitUntil: "networkidle" });
await p.locator(".a-project-card", { hasText: "Carnet de lumière" }).getByRole("button", { name: "Supprimer" }).click();
await p.locator("dialog[open]").getByRole("button", { name: "Supprimer le projet" }).click();
await toast("supprimé");
await p.goto(`${BASE}/admin/medias`, { waitUntil: "networkidle" });
await p.getByPlaceholder("Rechercher par nom…").fill("demo-");
while (await p.locator(".a-media-tile").count()) {
  await p.locator(".a-media-tile").first().click();
  await p.locator(".a-sidepanel .a-refs, .a-sidepanel p.muted:text('Nulle part pour l\\'instant.')").first().waitFor();
  await p.locator(".a-sidepanel").getByRole("button", { name: "Supprimer l'image" }).click();
  await p.locator("dialog[open]").getByRole("button", { name: "Supprimer" }).click();
  await toast("Image supprimée");
  await p.waitForTimeout(500);
}
await b.close();
console.log("captures :", OUT);
