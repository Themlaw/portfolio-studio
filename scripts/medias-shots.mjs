#!/usr/bin/env node
/**
 * Captures du lot « médias » (bande de planche, visionneuse, lecteur vidéo,
 * bloc CV), avant / après : mêmes pages, mêmes gestes, même fenêtre.
 * Serveur dev requis (base de test) et un compte admin (la vidéo du lecteur
 * est envoyée puis posée dans un bloc « Vidéo » de la page Personnages si
 * elle n'y est pas déjà).
 * Usage : LABEL=avant BASE=http://localhost:3103 DATA_DIR=/root/pf-lot3 \
 *         ADMIN_EMAIL=… ADMIN_PASSWORD=… node scripts/medias-shots.mjs
 */
import { mkdirSync } from "node:fs";

import { chromium } from "playwright";

import { ensureLongStrip, ensureVideoBlock, login, VIDEO_TITLE } from "./lib/medias-setup.mjs";

const BASE = process.env.BASE ?? "http://localhost:3103";
const LABEL = process.env.LABEL ?? "apres";
const OUT = `${process.env.SHOTS_DIR ?? "/root/shots-lot3"}/${LABEL}`;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const shot = async (name, opts = {}) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, ...opts });
  console.log(`capture ${OUT}/${name}.png`);
};

try {
  await login(page, BASE);
  const slug = await ensureLongStrip(page, BASE);
  if (process.env.SKIP_VIDEO !== "1") await ensureVideoBlock(page, BASE);

  // ---- Bande d'une planche ----------------------------------------------------------
  await page.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
  const strip = page.locator(`section[aria-labelledby="project-${slug}"]`).first();
  await strip.scrollIntoViewIfNeeded();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);
  await shot("bande-repos", { clip: await strip.boundingBox().then((b) => ({ x: 0, y: b.y, width: 1440, height: Math.min(b.height, 900) })) });
  const rail = strip.locator(".strip-rail");
  const rb = await rail.boundingBox();
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
  await page.waitForTimeout(400);
  await shot("bande-survol", { clip: { x: 0, y: rb.y - 40, width: 1440, height: rb.height + 120 } });
  await rail.evaluate((el) => el.scrollTo({ left: 700, behavior: "instant" }));
  await page.waitForTimeout(600);
  await shot("bande-defilee", { clip: { x: 0, y: rb.y - 40, width: 1440, height: rb.height + 120 } });
  await rail.evaluate((el) => el.scrollTo({ left: 0, behavior: "instant" }));

  // ---- Visionneuse ------------------------------------------------------------------
  await strip.locator(".strip-frame").first().click();
  await page.locator(".lightbox").waitFor();
  await page.waitForTimeout(800);
  await shot("visionneuse");
  await page.keyboard.press("Escape");

  // Mobile : bande et visionneuse.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(`section[aria-labelledby="project-${slug}"]`).first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot("bande-mobile");
  await page.setViewportSize({ width: 1440, height: 900 });

  // ---- Lecteur vidéo ----------------------------------------------------------------
  if (process.env.SKIP_VIDEO !== "1") {
    await page.reload({ waitUntil: "networkidle" });
    const card = page.locator('.group:has([data-kind="video"])', { hasText: VIDEO_TITLE }).first();
    await card.scrollIntoViewIfNeeded();
    await card.getByRole("button", { name: `Lire ${VIDEO_TITLE}` }).click();
    const player = card.locator(".media-frame").first();
    await page.waitForTimeout(1500);
    const box = await player.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(300);
    await shot("lecteur", { clip: { x: 0, y: Math.max(0, box.y - 20), width: 1440, height: Math.min(900, box.height + 140) } });
  }

  // ---- Bloc CV (après seulement) ------------------------------------------------------
  const cv = page.locator(".cv-block").first();
  if (await cv.count()) {
    // Le haut du bloc sous l'en-tête collant (≈ 61 px).
    await cv.evaluate((el) => window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 90, behavior: "instant" }));
    await page.waitForTimeout(800);
    const b = await cv.boundingBox();
    await shot("bloc-cv", { clip: { x: 0, y: Math.max(0, b.y - 24), width: 1440, height: Math.min(900 - Math.max(0, b.y - 24), b.height + 48) } });
    await cv.locator(".cv-page").first().click();
    await page.locator(".lightbox").waitFor();
    await page.waitForTimeout(800);
    await shot("cv-visionneuse");
    await page.keyboard.press("Escape");
  }
} finally {
  await browser.close();
}
