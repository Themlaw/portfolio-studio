#!/usr/bin/env node
/**
 * Captures de la phase 5 → screenshots/<SHOTS_DIR>/ : planche avec une boucle
 * et une vidéo longue (admin et site), médiathèque filtrée sur les vidéos avec
 * une conversion en cours, bloc vidéo de la page Animation dans deux thèmes.
 * Crée un projet et des vidéos de démonstration (ffmpeg), puis les supprime.
 * Serveur dev requis (redémarré, pré-chauffé) ; une connexion.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… node scripts/video-shots.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3001";
const OUT = `screenshots/${process.env.SHOTS_DIR ?? "phase5"}`;
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
mkdirSync(OUT, { recursive: true });

const DIR = path.join(tmpdir(), "video-shots");
mkdirSync(DIR, { recursive: true });
const f = (n) => path.join(DIR, n);
const ff = (args) => execFileSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", ...args]);
// Sources de démonstration (mire animée, son sinusoïdal).
ff(["-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30", "-t", "4", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", f("demo-boucle.mp4")]);
ff(["-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=25", "-f", "lavfi", "-i", "sine=frequency=330", "-t", "45", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", f("demo-reel.mp4")]);
if (!existsSync(f("demo-4k.mp4"))) ff(["-f", "lavfi", "-i", "testsrc2=size=3840x2160:rate=30", "-t", "20", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "24", "-pix_fmt", "yuv420p", f("demo-4k.mp4")]);

const b = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
p.on("dialog", (d) => d.accept());
const shot = async (name, full = false) => {
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
  console.log("  ", name);
};
const toast = (t) => p.locator(".a-toast", { hasText: t }).first().waitFor({ timeout: 30000 });

await p.goto(`${BASE}/admin/connexion`, { waitUntil: "networkidle" });
await p.fill("#email", EMAIL);
await p.fill("#password", PASSWORD);
await p.click("button[type=submit]");
await p.waitForURL(`${BASE}/admin`);

// Planche : une boucle et une vidéo longue.
await p.goto(`${BASE}/admin/projets`, { waitUntil: "networkidle" });
await p.getByRole("button", { name: "Nouveau projet" }).click();
await p.locator("dialog[open]").getByLabel("Titre en français").fill("Essais d'animation");
await p.locator("dialog[open]").getByRole("button", { name: "Créer le projet" }).click();
await p.waitForURL(/\/admin\/projets\/\d+$/);

await p.locator(".a-strip-end input[type=file]").setInputFiles([f("demo-boucle.mp4"), f("demo-reel.mp4")]);
await p.waitForFunction(() => document.querySelectorAll(".a-strip .a-slot").length === 2 && !document.querySelector('.a-strip .a-slot[data-status="processing"]'), null, { timeout: 300000 });
await p.locator("#pr-planche").evaluate((el) => el.scrollIntoView({ block: "start" }));
await shot("planche-videos-admin-1440");

await p.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
const strip = p.locator("section", { has: p.getByRole("heading", { name: "Essais d'animation" }) }).first();
await strip.evaluate((el) => el.scrollIntoView({ block: "start" }));
// La bande défile un peu : la vidéo longue et son badge de durée sont visibles.
await strip.locator(".strip-rail").evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
await p.waitForTimeout(1500);
await shot("planche-videos-site-1440");

// Médiathèque : filtre Vidéos, une conversion en cours (4K, 20 s).
await p.goto(`${BASE}/admin/medias`, { waitUntil: "networkidle" });
await p.locator(".a-uploader input[type=file]").setInputFiles([f("demo-4k.mp4")]);
await p.locator(".a-uploader", { hasText: /conversion/ }).waitFor({ timeout: 120000 });
await p.reload({ waitUntil: "networkidle" });
await p.getByRole("button", { name: "Vidéos", exact: true }).click();
await p.locator(".a-media-tile", { hasText: /Conversion/ }).first().waitFor({ timeout: 60000 });
await p.waitForTimeout(2500);
await shot("medias-videos-conversion-1440");
await p.waitForFunction(() => !document.querySelector(".a-media-tile .a-progress"), null, { timeout: 300000 });

// Bloc vidéo de la page Animation : demoreel hébergée, dans deux thèmes.
await p.locator(".a-media-tile", { hasText: "demo-reel.mp4" }).click();
await p.locator(".a-sidepanel").getByLabel("Texte alternatif", { exact: true }).fill("Demoreel 2026");
await p.locator(".a-sidepanel").getByRole("button", { name: "Enregistrer", exact: true }).click();
await toast("Texte alternatif enregistré");
await p.goto(`${BASE}/admin/pages`, { waitUntil: "networkidle" });
await p.locator("tr", { hasText: "Animation" }).getByRole("link", { name: "Modifier" }).click();
await p.waitForURL(/\/admin\/pages\/\d+$/);
const animationPage = new URL(p.url()).pathname;
await p.locator(".a-block-toggle", { hasText: "Vidéos" }).click();
await p.getByRole("button", { name: "Choisir une vidéo" }).click();
await p.locator("dialog[open] .a-media-tile", { hasText: "demo-reel.mp4" }).click();
await p.getByRole("button", { name: "Enregistrer", exact: true }).click();
await toast("Enregistré");
for (const theme of ["galerie-lumineuse", "salle-de-projection"]) {
  await p.goto(`${BASE}/api/theme-preview?id=${theme}&redirect=/fr/animation&banner=0`, { waitUntil: "networkidle" });
  await p.locator("#reel-title").evaluate((el) => el.scrollIntoView({ block: "start" }));
  await shot(`bloc-video-${theme}-1440`);
}
await p.goto(`${BASE}/api/theme-preview?id=&redirect=/fr`, { waitUntil: "networkidle" });

// Nettoyage : demoreel retirée du bloc, projet et vidéos de démonstration supprimés.
await p.goto(`${BASE}${animationPage}`, { waitUntil: "networkidle" });
await p.locator(".a-block-toggle", { hasText: "Vidéos" }).click();
await p.locator(".a-block-body").getByRole("button", { name: "Retirer", exact: true }).click();
await p.getByRole("button", { name: "Enregistrer", exact: true }).click();
await toast("Enregistré");
await p.goto(`${BASE}/admin/projets`, { waitUntil: "networkidle" });
await p.locator(".a-project-card", { hasText: "Essais d'animation" }).getByRole("button", { name: "Supprimer" }).click();
await p.locator("dialog[open]").getByRole("button", { name: "Supprimer le projet" }).click();
await toast("supprimé");
await p.goto(`${BASE}/admin/medias`, { waitUntil: "networkidle" });
await p.getByPlaceholder("Rechercher par nom ou tag…").fill("demo-");
while (await p.locator(".a-media-tile").count()) {
  await p.locator(".a-media-tile").first().click();
  await p.locator(".a-sidepanel .a-refs, .a-sidepanel p.muted:text('Nulle part pour l\\'instant.')").first().waitFor();
  await p.locator(".a-sidepanel").getByRole("button", { name: /^Supprimer (l'image|la vidéo)$/ }).click();
  await p.locator("dialog[open]").getByRole("button", { name: "Supprimer" }).click();
  await toast("supprimée");
  await p.waitForTimeout(500);
}
await b.close();
console.log("captures :", OUT);
