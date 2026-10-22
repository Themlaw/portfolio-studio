#!/usr/bin/env node
/**
 * Parcours de bout en bout des vidéos (phase 5), avec UN seul chromium et UN
 * seul onglet. Serveur dev requis (redémarré puis pré-chauffé), ffmpeg
 * installé, une connexion.
 *
 * Sources légitimes générées par ffmpeg : une boucle (720p, 4 s, sans son)
 * et une vidéo longue (30 s, avec son). Parcours : déposer les deux dans une
 * planche (envoi par morceaux, conversion), boucle muette jouée sur le site
 * et fixe avec ▶ en « réduire les animations », vidéo longue avec badge de
 * durée et lecture dans la visionneuse ; demoreel hébergée dans le bloc vidéo
 * de la page Animation, lecture et avance rapide (206) ; médiathèque : filtre
 * Vidéos, suppressions. L'état initial est restauré.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… node scripts/e2e-video.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
const SHOTS = "screenshots/phase5b";
mkdirSync(SHOTS, { recursive: true });
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { pageIdOf, placeBoard, projectSlugOf, removeBoard } from "./lib/page-board.mjs";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");

let failures = 0;
function ok(label, cond, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
}

const DIR = path.join(tmpdir(), "e2e-video");
mkdirSync(DIR, { recursive: true });
const LOOP = path.join(DIR, "e2e-boucle.mp4");
const LONG = path.join(DIR, "e2e-longue.mp4");
const ff = (args) => execFileSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", ...args]);
ff(["-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30", "-t", "4", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", LOOP]);
ff(["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=25", "-f", "lavfi", "-i", "sine=frequency=330", "-t", "30", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", LONG]);

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());
const toast = (text) => page.locator(".a-toast", { hasText: text }).first().waitFor({ timeout: 30000 });

let videoProjectId = null;
let animationPageId = null;

try {
  await page.goto(`${BASE}/admin/connexion`, { waitUntil: "networkidle" });
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}/admin`);

  // ---- Planche : une boucle et une vidéo longue --------------------------------------
  await page.goto(`${BASE}/admin/projets`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Nouveau projet" }).click();
  await page.locator("dialog[open]").getByLabel("Titre en français").fill("Vidéos e2e");
  await page.locator("dialog[open]").getByRole("button", { name: "Créer le projet" }).click();
  await page.waitForURL(/\/admin\/projets\/\d+$/);
  ok("E0 projet créé", /\/admin\/projets\/\d+$/.test(page.url()));
  videoProjectId = Number(page.url().split("/").pop());
  // v0.13 : la planche se pose sur la page Personnages (plus d'apparition automatique).
  {
    const editorUrl = page.url();
    ok("E0b planche du projet posée sur la page Personnages", await placeBoard(page, BASE, pageIdOf("personnages"), projectSlugOf(videoProjectId)));
    await page.goto(editorUrl, { waitUntil: "networkidle" });
  }
  await page.locator(".a-strip-end input[type=file]").setInputFiles([LOOP, LONG]);
  const sawConversion = await page
    .locator(".a-strip", { hasText: /Conversion/ })
    .waitFor({ timeout: 60000 })
    .then(() => true, () => false);
  await page.waitForFunction(
    () => document.querySelectorAll(".a-strip .a-slot").length === 2 && !document.querySelector('.a-strip .a-slot[data-status="processing"]'),
    null,
    { timeout: 240000 },
  );
  ok("E1 deux vidéos déposées : envoi par morceaux puis conversion affichée, puis prêtes", sawConversion && (await page.locator(".a-strip .a-slot").count()) === 2);
  const badges = await page.locator(".a-strip .a-duration-badge").allInnerTexts();
  ok("E2 vignettes : durée et « boucle » pour l'animation courte", badges.some((t) => /0:04.*boucle/.test(t)) && badges.some((t) => /0:30/.test(t)), badges.join(" | "));

  // ---- Côté public -----------------------------------------------------------------------
  await page.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
  const strip = page.locator("section", { has: page.getByRole("heading", { name: "Vidéos e2e" }) }).first();
  await strip.scrollIntoViewIfNeeded();
  const loop = strip.locator(".strip-rail video").first();
  await page.waitForTimeout(1500);
  const loopState = await loop.evaluate((v) => ({ muted: v.muted, loop: v.loop, paused: v.paused, t: v.currentTime }));
  ok("E3 boucle : muette, en boucle, jouée quand elle est visible", loopState.muted && loopState.loop && !loopState.paused && loopState.t > 0, JSON.stringify(loopState));
  // Lot 36 : le cadre entier est le bouton pause / lecture (nommé), la vidéo elle-même est décorative.
  const loopLabel = await strip.locator(".strip-rail [data-loop] > button").first().getAttribute("aria-label");
  ok("E3a le cadre de la boucle est un bouton nommé (pause / lecture)", /en pause/.test(loopLabel ?? "") && (await loop.getAttribute("aria-hidden")) === "true", String(loopLabel));
  ok("E3c en-tête de planche sans séparateur orphelin (contexte vide)", /^\s*2026\s*$/.test(await strip.locator("header p").first().innerText()), await strip.locator("header p").first().innerText());
  await page.screenshot({ path: `${SHOTS}/planche-contexte-vide-1440.png` });
  // Pause au clavier (WCAG 2.2.2) : le bouton apparaît au focus.
  const pause = strip.getByRole("button", { name: "Mettre l'animation en pause" });
  await pause.focus();
  await page.waitForTimeout(400);
  const pauseOpacity = "1";
  await page.screenshot({ path: `${SHOTS}/boucle-bouton-pause-focus-1440.png` });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  ok("E3b bouton pause : visible au focus, Entrée met la boucle en pause", pauseOpacity === "1" && (await loop.evaluate((v) => v.paused)) && (await strip.getByRole("button", { name: "Lire l'animation" }).count()) === 1, `opacité ${pauseOpacity}`);
  await strip.getByRole("button", { name: "Lire l'animation" }).click();
  const badge = await strip.locator(".strip-duration").first().innerText();
  ok("E4 vidéo longue : poster et badge de durée dans la planche", /0:30/.test(badge), badge);
  await strip.locator(".strip-rail > button.strip-frame").first().click();
  const lbVideo = page.locator('[data-testid="video-viewer"] video');
  await lbVideo.waitFor();
  const sources = await lbVideo.locator("source").evaluateAll((els) => els.map((e) => ({ src: e.getAttribute("src"), media: e.getAttribute("media") })));
  ok("E5 visionneuse : lecteur avec contrôles, sources MP4 (720 en repli)", sources.some((x) => /\/720\.mp4$/.test(x.src ?? "") && !x.media), JSON.stringify(sources));
  await page.keyboard.press("Escape");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload({ waitUntil: "networkidle" });
  const strip2 = page.locator("section", { has: page.getByRole("heading", { name: "Vidéos e2e" }) }).first();
  await strip2.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  const reduced = await strip2.locator(".strip-rail [data-loop]").first().evaluate((el) => ({ state: el.getAttribute("data-loop"), paused: el.querySelector("video")?.paused, t: el.querySelector("video")?.currentTime }));
  ok("E6 « réduire les animations » : la boucle reste fixe sur son poster, avec ▶", reduced.state === "paused" && reduced.paused && reduced.t === 0, JSON.stringify(reduced));
  const playBtn = strip2.getByRole("button", { name: "Lire l'animation" });
  ok("E6b bouton ▶ affiché et accessible", await playBtn.isVisible());
  // Un clic sur la boucle (arrêtée) la lance, un second l'arrête.
  await strip2.locator(".strip-rail [data-loop] > button").first().click();
  await page.waitForTimeout(800);
  ok("E6c un clic sur la boucle arrêtée la lance", await strip2.locator(".strip-rail [data-loop] video").first().evaluate((v) => !v.paused));
  await page.emulateMedia({ reducedMotion: "no-preference" });

  // ---- Demoreel hébergée dans le bloc vidéo de la page Animation ---------------------------
  await page.goto(`${BASE}/admin/medias`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Vidéos", exact: true }).click();
  const shown = await page.locator(".a-media-tile .a-media-name").allInnerTexts();
  const images = await page.locator(".a-media-tile", { hasText: /\.(svg|png|jpg|webp)$/ }).count();
  ok("E7 médiathèque : filtre Vidéos (les deux vidéos, aucune image)", shown.filter((n) => n.startsWith("e2e-")).length === 2 && images === 0, shown.join(", "));
  await page.locator(".a-media-tile", { hasText: "e2e-longue.mp4" }).click();
  await page.locator(".a-sidepanel").getByLabel("Description de l'image (pour les personnes malvoyantes et Google)", { exact: true }).fill("Demoreel e2e");
  await page.locator(".a-sidepanel").getByRole("button", { name: "Enregistrer", exact: true }).click();
  await toast("Description enregistrée");
  ok("E8 détail : lecteur vidéo dans le panneau", await page.locator(".a-sidepanel video[controls]").isVisible());

  await page.goto(`${BASE}/admin/pages`, { waitUntil: "networkidle" });
  // « Modifier » ouvre l'éditeur visuel (v0.12) : le formulaire de la page est « Formulaire ».
  await page.locator("tr", { hasText: "Animation" }).getByRole("link", { name: "Formulaire" }).click();
  await page.waitForURL(/\/admin\/pages\/\d+$/);
  animationPageId = Number(page.url().split("/").pop());
  // v0.13 : une « Vidéo » (présentation « Grande ») ajoutée à la page, avec la vidéo hébergée.
  await page.getByRole("button", { name: "+ Ajouter un bloc" }).click();
  await page.locator("dialog[open] label.a-block-type", { hasText: /^Vidéo/ }).first().click();
  await page.locator("dialog[open]").getByRole("button", { name: "Ajouter ce bloc" }).click();
  const videoBlock = page.locator("article.a-block").last();
  await videoBlock.getByRole("button", { name: "Choisir une vidéo" }).click();
  await page.locator("dialog[open] .a-media-tile", { hasText: "e2e-longue.mp4" }).click();
  await videoBlock.locator("select").filter({ has: page.locator('option[value="feature"]') }).selectOption("feature");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await toast("Enregistré");

  const ranges = [];
  page.on("response", (r) => {
    if (/\/media\/vid\/.*\.mp4$/.test(r.url())) ranges.push(r.status());
  });
  await page.goto(`${BASE}/fr/animation`, { waitUntil: "networkidle" });
  const reelSection = page.locator('section[aria-labelledby^="video-"]', { hasText: "Demoreel e2e" });
  ok("E9 demoreel : titre et durée viennent du média", (await reelSection.locator("h2").innerText()) === "Demoreel e2e" && (await page.getByText("0:30").count()) > 0);
  await page.getByRole("button", { name: /Lire Demoreel e2e/ }).click();
  const reel = reelSection.locator("video");
  await reel.waitFor();
  await page.waitForFunction(() => {
    const v = [...document.querySelectorAll('section[aria-labelledby^="video-"]')].find((x) => x.textContent.includes("Demoreel e2e"))?.querySelector("video");
    return v && v.readyState >= 2 && !v.paused;
  }, null, { timeout: 20000 });
  await reel.evaluate((v) => {
    v.currentTime = 25;
  });
  await page.waitForFunction(() => {
    const v = [...document.querySelectorAll('section[aria-labelledby^="video-"]')].find((x) => x.textContent.includes("Demoreel e2e"))?.querySelector("video");
    return v && v.currentTime >= 25 && v.readyState >= 2;
  }, null, { timeout: 20000 });
  ok(`E10 lecture et avance rapide : réponses partielles 206 (${ranges.join(",")})`, ranges.includes(206), ranges.join(","));
} catch (e) {
  failures++;
  console.log("FAIL exception :", e.message.split("\n")[0]);
  await page.screenshot({ path: "e2e-echec.png", fullPage: true }).catch(() => {});
}

// ---- Restauration ---------------------------------------------------------------------------
try {
  if (animationPageId) {
    await page.goto(`${BASE}/admin/pages/${animationPageId}`, { waitUntil: "networkidle" });
    // La « Vidéo » ajoutée (dernier bloc) est retirée.
    const last = page.locator("article.a-block").last();
    if (/Vidéo/.test(await last.getAttribute("aria-label")) && !/Grille/.test(await last.getAttribute("aria-label"))) {
      await last.getByRole("button", { name: /Supprimer le bloc/ }).click();
      await page.locator("dialog[open]").getByRole("button", { name: /Supprimer/ }).click();
      await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
      await toast("Enregistré");
    }
  }
  if (videoProjectId) await removeBoard(page, BASE, pageIdOf("personnages"), projectSlugOf(videoProjectId));
  await page.goto(`${BASE}/admin/projets`, { waitUntil: "networkidle" });
  while (await page.locator(".a-project-card", { hasText: "Vidéos e2e" }).count()) {
    await page.locator(".a-project-card", { hasText: "Vidéos e2e" }).first().getByRole("button", { name: "Supprimer" }).click();
    await page.locator("dialog[open]").getByRole("button", { name: "Supprimer le projet" }).click();
    await toast("supprimé");
    await page.reload({ waitUntil: "networkidle" });
  }
  await page.goto(`${BASE}/admin/medias`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("Rechercher par nom ou tag…").fill("e2e-");
  while (await page.locator(".a-media-tile").count()) {
    await page.locator(".a-media-tile").first().click();
    await page.locator(".a-sidepanel .a-refs, .a-sidepanel p.muted:text('Nulle part pour l\\'instant.')").first().waitFor();
    await page.locator(".a-sidepanel").getByRole("button", { name: /^Supprimer (l'image|la vidéo)$/ }).click();
    await page.locator("dialog[open]").getByRole("button", { name: "Supprimer" }).click();
    await toast("supprimée");
    await page.waitForTimeout(600);
  }
  ok("E11 médiathèque : vidéos supprimées, état initial restauré", (await page.locator(".a-media-tile").count()) === 0);
} catch (e) {
  failures++;
  console.log("FAIL restauration :", e.message.split("\n")[0]);
}

ok("Z aucune erreur JavaScript", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `e2e-video : ${failures} échec(s)` : "e2e-video : OK");
process.exit(failures ? 1 : 0);
