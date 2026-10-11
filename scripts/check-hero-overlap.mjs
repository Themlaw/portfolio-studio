#!/usr/bin/env node
/**
 * Ouverture (hero) : le texte et le décor ne doivent jamais se recouvrir.
 * Pour chaque thème et chaque taille d'écran (1280, 1440, 1920, 390) :
 *  - hero à calques : on mesure, sous les boîtes serrées du texte (titre,
 *    étiquette, métier, indice de défilement, marge de 6 px), la part de
 *    pixels qui change quand on masque les calques 2 à 5 (le calque 1 est le
 *    fond : papier, kraft). Au-delà de 0,2 % : un dessin passe sous le texte ;
 *  - note en marge (hero typographique) : sa boîte ne doit croiser ni le
 *    titre ni l'étiquette.
 * Serveur dev requis. Usage : PORT=3001 node scripts/check-hero-overlap.mjs [slug…]
 * (défaut : tous les thèmes livrés). SHOTS=<dossier> : captures de l'ouverture.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import { chromium } from "playwright";
import sharp from "sharp";

import { presetSlugs } from "./lib/presets.mjs";

const BASE = `http://localhost:${process.env.PORT ?? "3001"}`;
const SIZES = [[1280, 800], [1440, 900], [1920, 1080], [390, 844]];
const MAX_RATIO = 0.002;
const wanted = process.argv.slice(2);
const themes = wanted.length ? wanted : presetSlugs();
const SHOTS = process.env.SHOTS;

const TEXT = ".hero h1, .hero .eyebrow, .hero .caption-text, .hero .scroll-hint";
const HIDE_TEXT = `${TEXT}, ${TEXT.split(", ").map((s) => `${s} *`).join(", ")} { color: transparent !important; text-shadow: none !important; filter: none !important; }
.hero .scroll-hint svg { visibility: hidden !important; }
nextjs-portal { display: none !important; }`;
const HIDE_LAYERS = ".hero-parallax > div:first-child > div.will-change-transform:not(:first-child) { visibility: hidden !important; }";

let failures = 0;
const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2"] });
for (const [w, h] of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  for (const id of themes) {
    await page.goto(`${BASE}/api/theme-preview?id=${id}&redirect=/fr&banner=0`);
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await page.waitForTimeout(400);
    if (SHOTS) {
      mkdirSync(path.join(SHOTS, id), { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, id, `ouverture-${w}.png`) });
    }
    const info = await page.evaluate((sel) => {
      const boxes = [];
      for (const el of document.querySelectorAll(sel)) {
        const r = document.createRange();
        r.selectNodeContents(el);
        for (const b of r.getClientRects()) if (b.width > 1 && b.height > 1) boxes.push({ x: b.x, y: b.y, w: b.width, h: b.height, tag: el.tagName });
        const svg = el.querySelector("svg");
        if (svg) {
          const b = svg.getBoundingClientRect();
          boxes.push({ x: b.x, y: b.y, w: b.width, h: b.height, tag: "svg" });
        }
      }
      const note = document.querySelector(".hero .hero-note")?.getBoundingClientRect();
      const parallax = Boolean(document.querySelector(".hero-parallax"));
      return { boxes, note: note && { x: note.x, y: note.y, w: note.width, h: note.height }, parallax };
    }, TEXT);

    const problems = [];
    const notes = [];
    if (info.note) {
      const hit = info.boxes.filter((b) => (b.tag === "H1" || b.tag === "P" || b.tag === "SPAN") && b.x < info.note.x + info.note.w && info.note.x < b.x + b.w && b.y < info.note.y + info.note.h && info.note.y < b.y + b.h);
      if (hit.length) problems.push(`note en marge sur le texte (${hit.length} boîte(s))`);
    }
    if (info.parallax) {
      const style = await page.addStyleTag({ content: HIDE_TEXT });
      await page.waitForTimeout(150);
      const a = await page.screenshot();
      const layers = await page.addStyleTag({ content: HIDE_LAYERS });
      await page.waitForTimeout(150);
      const b = await page.screenshot();
      await page.evaluate(([s, l]) => (s.remove(), l.remove()), [style, layers]);
      const A = await sharp(a).raw().toBuffer({ resolveWithObject: true });
      const B = await sharp(b).raw().toBuffer();
      const ch = A.info.channels;
      let total = 0;
      let hits = 0;
      const seen = new Set();
      for (const box of info.boxes) {
        const x0 = Math.max(0, Math.floor(box.x - 6));
        const y0 = Math.max(0, Math.floor(box.y - 6));
        const x1 = Math.min(A.info.width, Math.ceil(box.x + box.w + 6));
        const y1 = Math.min(A.info.height, Math.ceil(box.y + box.h + 6));
        for (let y = y0; y < y1; y++)
          for (let x = x0; x < x1; x++) {
            const k = y * A.info.width + x;
            if (seen.has(k)) continue;
            seen.add(k);
            total++;
            const o = k * ch;
            if (Math.max(Math.abs(A.data[o] - B[o]), Math.abs(A.data[o + 1] - B[o + 1]), Math.abs(A.data[o + 2] - B[o + 2])) > 30) hits++;
          }
      }
      const ratio = total ? hits / total : 0;
      if (ratio > MAX_RATIO) problems.push(`décor sous le texte : ${(ratio * 100).toFixed(2)} % des pixels (${hits}/${total})`);
      else notes.push(`décor sous le texte ${(ratio * 100).toFixed(3)} %`);
    }
    if (problems.length) failures++;
    const detail = [...problems, ...notes];
    console.log(`${problems.length ? "FAIL" : "PASS"}  ${id} ${w}×${h} — ${detail.length ? detail.join(" ; ") : "hero typographique, note hors du texte"}`);
  }
  await ctx.close();
}
await browser.close();
console.log(failures ? `\ncheck-hero-overlap : ${failures} échec(s)` : "\ncheck-hero-overlap : OK");
process.exit(failures ? 1 : 0);
