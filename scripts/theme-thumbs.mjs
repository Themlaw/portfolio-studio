#!/usr/bin/env node
/**
 * Vignettes d'aperçu des thèmes livrés (galerie d'Admin → Thèmes) : capture de
 * l'accueil à 1440 × 900 via la route d'aperçu, réduite en WebP 480 × 300 →
 * public/themes/<slug>/thumb.webp, + thumb.json (empreinte des données du
 * thème : `theme:check` signale une vignette périmée). Échoue si la page
 * produit une erreur console ou si la police de titre n'est pas chargée.
 * Serveur dev requis (PORT, défaut 3001), un seul chromium.
 * Usage : PORT=3001 node scripts/theme-thumbs.mjs [slug…]
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { loadPresets, PUBLIC_THEMES_DIR, thumbPath, thumbStampPath } from "./lib/presets.mjs";

export const THUMB = { width: 480, height: 300 };

/** Empreinte des données VALIDÉES d'un thème (même calcul que theme:check). */
export async function themeStamp(raw) {
  const { ThemeSchema } = await import(new URL("../src/themes/schema.ts", import.meta.url));
  return createHash("sha256").update(JSON.stringify(ThemeSchema.parse(raw))).digest("hex").slice(0, 16);
}

export async function renderThumbs(slugs, { port = process.env.PORT ?? "3001" } = {}) {
  const { chromium } = await import("playwright");
  const sharp = (await import("sharp")).default;
  const { FONT_STACKS } = await import(new URL("../src/themes/font-stacks.ts", import.meta.url));
  const base = `http://localhost:${port}`;
  const presets = await loadPresets(slugs);
  const failures = [];
  const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2"] });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    let errors = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));
    for (const theme of presets) {
      errors = [];
      await page.goto(`${base}/api/theme-preview?id=${theme.id}&redirect=/fr&banner=0`);
      await page.waitForLoadState("networkidle");
      await page.evaluate(() => document.fonts.ready);
      // Indicateur du serveur dev (Next) : hors de la vignette.
      await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
      await page.waitForTimeout(800);
      const applied = await page.evaluate(() => document.documentElement.dataset.theme);
      const family = FONT_STACKS[theme.tokens.font.display].label;
      const fontOk = await page.evaluate((f) => [...document.fonts].some((x) => x.family.replace(/["']/g, "").startsWith(f) && x.status === "loaded"), family);
      const png = await page.screenshot({ animations: "disabled" });
      const webp = await sharp(png).resize(THUMB.width, THUMB.height, { fit: "cover", position: "top" }).webp({ quality: 78 }).toBuffer();
      mkdirSync(path.join(PUBLIC_THEMES_DIR, theme.id), { recursive: true });
      writeFileSync(thumbPath(theme.id), webp);
      writeFileSync(thumbStampPath(theme.id), JSON.stringify({ theme: await themeStamp(theme) }) + "\n");
      const problems = [
        applied !== theme.id && `thème appliqué « ${applied} » (le thème est-il en base ? redémarre le serveur dev)`,
        !fontOk && `police de titre ${family} non chargée`,
        ...errors.map((e) => `console : ${e.slice(0, 200)}`),
      ].filter(Boolean);
      console.log(`${problems.length ? "FAIL" : "PASS"}  vignette ${theme.id} (${Math.round(webp.length / 1024)} Ko)${problems.length ? " — " + problems.join(" ; ") : ""}`);
      if (problems.length) failures.push(theme.id);
    }
    await context.close();
  } finally {
    await browser.close();
  }
  return failures;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname;
if (isMain) {
  const failures = await renderThumbs(process.argv.slice(2));
  // Le registre liste les vignettes présentes.
  const { spawnSync } = await import("node:child_process");
  spawnSync(process.execPath, [new URL("./theme-registry.mjs", import.meta.url).pathname], { stdio: "inherit" });
  process.exit(failures.length ? 1 : 0);
}
