#!/usr/bin/env node
/**
 * Contraste MESURÉ AU PIXEL, sur le rendu réel (serveur dev requis).
 *
 * check-contrast.mjs ne teste que des aplats de tokens : il ignore les
 * images, calques de hero, textures, ombres et voiles. Ici, pour chaque
 * élément textuel ciblé :
 *   1. on rend le remplissage de son texte transparent (le fond reste
 *      identique ; un halo text-shadow du thème est conservé : il fait partie
 *      du fond réel sur lequel se détache chaque lettre) ;
 *   2. on capture le fond sous la boîte serrée du texte (Range.getClientRects) ;
 *   3. pour chaque pixel, on compose la couleur calculée du texte (alpha
 *      compris) sur ce pixel et on calcule le ratio WCAG ;
 *   4. on rapporte la médiane, le 5e centile (p5) et le minimum par élément.
 * Un groupe passe si le p5 de chacun de ses éléments atteint le seuil
 * (4,5:1, ou 3:1 pour les très grands corps : titre du hero, note manuscrite).
 *
 * Pages : /fr (accueil), /fr/personnages, et la lightbox ouverte sur /fr/decors.
 * Trop lourd pour la CI (chromium) : étape obligatoire en local pour tout
 * changement de thème. Un seul chromium, serveur dev seul à côté.
 *
 * Usage : PORT=3001 npm run check:contrast:render [preset…]
 * Sortie : tableau + screenshots/contrast-render.json ; exit 1 si échec.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

import { loadPresets } from "./lib/presets.mjs";

const PORT = process.env.PORT ?? "3001";
const BASE = `http://localhost:${PORT}`;
const OUT = new URL("../screenshots/", import.meta.url).pathname;

/** Groupes mesurés : [libellé, sélecteur, seuil, portée]. portée "top" = mesuré
 *  sans défiler (hero, en-tête transparent) ; "scroll" = centré à l'écran. */
const PAGE_GROUPS = [
  ["nav", ".site-header .site-brand, .site-header .caption-text", 4.5, "top"],
  ["hero-titre", ".hero h1", 3, "top"],
  ["hero-note", ".hero .hero-note", 3, "top"],
  ["hero-eyebrow", ".hero .eyebrow:not(:has(+ .scroll-hint))", 4.5, "top"],
  ["hero-role", ".hero .caption-text", 4.5, "top"],
  ["hero-indice", ".hero .eyebrow:has(+ .scroll-hint)", 4.5, "top"],
  ["eyebrow", "main .eyebrow:not(.hero .eyebrow)", 4.5, "scroll"],
  ["legende", "main .strip-caption", 4.5, "scroll"],
  ["texte", "main p:not(.eyebrow):not(.caption-text):not(.hero p)", 4.5, "scroll"],
];
const LIGHTBOX_GROUPS = [
  ["lb-eyebrow", ".lightbox .eyebrow", 4.5, "fixed"],
  ["lb-titre", ".lightbox h2", 4.5, "fixed"],
  ["lb-texte", ".lightbox p:not(.eyebrow)", 4.5, "fixed"],
];

const MASK_CSS = `.__cr-mask, .__cr-mask * {
  color: transparent !important; -webkit-text-fill-color: transparent !important;
  text-decoration-color: transparent !important; transition: none !important; }
/* Indicateur du serveur de dev (badge « N ») : absent en production. */
nextjs-portal { display: none !important; }`;

/** Mode --admin : interface d'administration (tokens --admin-*), sans thème. */
const ADMIN_MODE = process.argv.includes("--admin");
const ADMIN_GROUPS = [
  ["marque", ".a-brand", 4.5, "scroll"],
  ["navigation", ".a-nav a", 4.5, "scroll"],
  ["titres", ".a-page-header h1, .a-card h2, .a-empty h2, .a-login-card h1", 4.5, "scroll"],
  ["texte-second", ".a-page-header p, .a-card-label, .a-empty p, .muted:not(.mono)", 4.5, "scroll"],
  ["mono", ".mono", 4.5, "scroll"],
  ["liens", ".a-main a:not(.a-btn), .a-login-foot a", 4.5, "scroll"],
  ["boutons", ".a-btn", 4.5, "scroll"],
  ["badge", ".a-badge", 4.5, "scroll"],
  ["tableaux", ".a-table th, .a-table td, .a-dl dt, .a-dl dd", 4.5, "scroll"],
  // Libellés (l'interrupteur est mesuré sur son texte : sa piste colorée
  // n'est pas un fond de texte), aides, erreurs, étiquettes d'état.
  ["formulaire", ".a-field label:not(.a-toggle), .a-toggle > span:last-child, .a-alert", 4.5, "scroll"],
  ["aides", ".a-help, .a-field-error, .a-save-state, .a-tag, .a-block-summary, .a-notice, .a-readonly", 4.5, "scroll"],
];

const wanted = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const presets = [];
presets.push(...(await loadPresets(wanted)));

/** Calcul dans la page (canvas) : médiane / p5 des ratios pixel par pixel. */
async function ratios(page, b64, color) {
  return page.evaluate(
    async ({ b64, color }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, c.width, c.height).data;

      const one = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
      one.canvas.width = one.canvas.height = 1;
      one.clearRect(0, 0, 1, 1);
      one.fillStyle = color;
      one.fillRect(0, 0, 1, 1);
      const [fr, fg, fb, fa] = one.getImageData(0, 0, 1, 1).data;
      const a = fa / 255;

      const lin = (v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

      const out = [];
      for (let i = 0; i < px.length; i += 4) {
        const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
        const tr = a * fr + (1 - a) * r;
        const tg = a * fg + (1 - a) * g;
        const tb = a * fb + (1 - a) * b;
        const l1 = lum(tr, tg, tb);
        const l2 = lum(r, g, b);
        out.push((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05));
      }
      out.sort((x, y) => x - y);
      const q = (p) => out[Math.min(out.length - 1, Math.floor(p * out.length))];
      return { median: q(0.5), p5: q(0.05), min: out[0], n: out.length };
    },
    { b64, color },
  );
}

async function measureGroup(page, [label, selector, threshold, scope]) {
  const count = await page.locator(selector).count();
  const results = [];
  for (let i = 0; i < count; i++) {
    const el = page.locator(selector).nth(i);
    if (!(await el.isVisible())) continue;
    // Lien-image sans texte (vignette) : rien à lire, pas de contraste de texte.
    if (!(await el.evaluate((e) => (e.textContent ?? "").trim().length > 0))) continue;

    if (scope === "top") {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await page.waitForTimeout(250);
    } else if (scope === "scroll") {
      await el.evaluate((e) => e.scrollIntoView({ block: "center", behavior: "instant" }));
      await page.waitForTimeout(200);
    }

    const box = await el.evaluate((e) => {
      const range = document.createRange();
      range.selectNodeContents(e);
      const rects = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
      if (!rects.length) return null;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const x0 = Math.max(0, Math.min(...rects.map((r) => r.left)));
      const y0 = Math.max(0, Math.min(...rects.map((r) => r.top)));
      const x1 = Math.min(vw, Math.max(...rects.map((r) => r.right)));
      const y1 = Math.min(vh, Math.max(...rects.map((r) => r.bottom)));
      if (x1 - x0 < 4 || y1 - y0 < 4) return null;
      return {
        clip: { x: Math.floor(x0), y: Math.floor(y0), width: Math.ceil(x1 - x0), height: Math.ceil(y1 - y0) },
        color: getComputedStyle(e).color,
        text: e.textContent.trim().replace(/\s+/g, " ").slice(0, 40),
      };
    });
    if (!box) continue;

    await el.evaluate((e) => e.classList.add("__cr-mask"));
    const shot = await page.screenshot({ clip: box.clip, animations: "disabled" });
    await el.evaluate((e) => e.classList.remove("__cr-mask"));

    const r = await ratios(page, shot.toString("base64"), box.color);
    results.push({ text: box.text, color: box.color, ...r });
  }
  if (!results.length) return null;
  const worstMedian = results.reduce((w, r) => (r.median < w.median ? r : w));
  const worstP5 = results.reduce((w, r) => (r.p5 < w.p5 ? r : w));
  const worstMin = Math.min(...results.map((r) => r.min));
  return { label, threshold, count: results.length, worstMedian, worstP5, worstMin, pass: worstP5.p5 >= threshold, results };
}

async function prepare(page, url) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: MASK_CSS });
  // Défilement complet : images paresseuses chargées avant la mesure.
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo({ top: y, behavior: "instant" });
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  await page.waitForTimeout(800);
}

const browser = await chromium.launch();
const report = [];
let failures = 0;

function printRows(title, rows) {
  console.log(`\n== ${title}`);
  console.log("   page         groupe        n  pire médiane             pire p5                  min");
  for (const r of rows) {
    if (!r.pass) failures++;
    const m = `${r.worstMedian.median.toFixed(2)} « ${r.worstMedian.text.slice(0, 14)} »`;
    const p = `${r.worstP5.p5.toFixed(2)} « ${r.worstP5.text.slice(0, 14)} »`;
    console.log(
      `${r.pass ? " ✓" : " ✗"} ${r.page.padEnd(12)} ${r.label.padEnd(13)} ${String(r.count).padStart(2)}  ${m.padEnd(24)} ${p.padEnd(24)} ${r.worstMin.toFixed(2)}${r.pass ? "" : `  (< ${r.threshold})`}`,
    );
  }
}

if (ADMIN_MODE) {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error("--admin : définir ADMIN_EMAIL et ADMIN_PASSWORD");
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const rows = [];
  await prepare(page, `${BASE}/admin/connexion`);
  for (const g of ADMIN_GROUPS) {
    const r = await measureGroup(page, g);
    if (r) rows.push({ page: "connexion", ...r });
  }
  const login = await page.request.post(`${BASE}/api/auth/sign-in/email`, { data: { email, password }, headers: { origin: BASE } });
  if (!login.ok()) throw new Error(`connexion admin refusée (${login.status()})`);
  for (const [label, path] of [["tableau", "/admin"], ["themes", "/admin/themes"], ["pages", "/admin/pages"], ["page-edit", "/admin/pages/1"], ["reglages", "/admin/reglages"], ["projets", "/admin/projets"], ["projet", "/admin/projets/1"], ["medias", "/admin/medias"]]) {
    await prepare(page, `${BASE}${path}`);
    for (const g of ADMIN_GROUPS) {
      const r = await measureGroup(page, g);
      if (r) rows.push({ page: label, ...r });
    }
  }
  await context.close();
  printRows("admin", rows);
  report.push({ preset: "admin", rows });
  presets.length = 0; // pas de thèmes publics en mode admin
}

for (const preset of presets) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  // Aperçu = draft mode + cookie d'id, posés par la route (dev uniquement).
  await page.goto(`${BASE}/api/theme-preview?id=${preset.id}&redirect=/fr&banner=0`);
  const rows = [];

  for (const [pageLabel, path] of [["accueil", "/fr"], ["personnages", "/fr/personnages"]]) {
    await prepare(page, `${BASE}${path}`);
    for (const g of PAGE_GROUPS) {
      const r = await measureGroup(page, g);
      if (r) rows.push({ page: pageLabel, ...r });
    }
  }

  await prepare(page, `${BASE}/fr/decors`);
  await page.locator("section:has(.strip-frame + .strip-frame) .strip-frame").first().click();
  await page.waitForTimeout(900);
  for (const g of LIGHTBOX_GROUPS) {
    const r = await measureGroup(page, g);
    if (r) rows.push({ page: "lightbox", ...r });
  }
  await context.close();

  console.log(`\n== ${preset.id}`);
  console.log("   page         groupe        n  pire médiane             pire p5                  min");
  for (const r of rows) {
    if (!r.pass) failures++;
    const m = `${r.worstMedian.median.toFixed(2)} « ${r.worstMedian.text.slice(0, 14)} »`;
    const p = `${r.worstP5.p5.toFixed(2)} « ${r.worstP5.text.slice(0, 14)} »`;
    console.log(
      `${r.pass ? " ✓" : " ✗"} ${r.page.padEnd(12)} ${r.label.padEnd(13)} ${String(r.count).padStart(2)}  ${m.padEnd(24)} ${p.padEnd(24)} ${r.worstMin.toFixed(2)}${r.pass ? "" : `  (< ${r.threshold})`}`,
    );
  }
  report.push({ preset: preset.id, rows });
}

await browser.close();
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}contrast-render.json`, JSON.stringify(report, null, 2));
console.log(failures ? `\ncheck-contrast-render : ${failures} groupe(s) sous le seuil` : "\ncheck-contrast-render : OK");
process.exit(failures ? 1 : 0);
