#!/usr/bin/env node
/**
 * Parité de rendu du lot 66 (Surface commune) : pose, sur une base NEUVE, UNE page qui combine tout (papier peint de la page, papier peint des
 * cartes du site, carte, fond de couleur, fond à papier peint avec marge et coins, carte + fond emboîté, carte à papier peint, grille dans un fond
 * avec cadre du kit, fond derrière la photo et légende, image seule dans une carte avec bande de couleur), en FORMES DE DONNÉES D'AVANT le lot 66,
 * puis photographie cette page à 1440 / 1024 / 390 px : éditeur (toile), Aperçu (toile en mode aperçu) et site public.
 * Lancé une fois sur le build d'avant et une fois sur le build d'après (mêmes images de test synthétiques, même page) ; scripts/parity-surface66-diff.mjs
 * compare les deux séries au pixel. Aucune image de l'artiste.
 * Usage : DATA_DIR=… ADMIN_EMAIL=… ADMIN_PASSWORD=… BASE=… SHOTS=<dossier> node scripts/parity-surface66.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { installKitFrameTheme } from "./lib/cadres62.mjs";
import { draftBlocks, login, makeMedia, pageIdOf, q1, setDraft, sleep, sql, waitFor } from "./lib/grille31d.mjs";

const BASE = process.env.BASE ?? "http://localhost:3001";
const SHOTS = process.env.SHOTS ?? path.join(tmpdir(), "parity-surface66");
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
page.setDefaultNavigationTimeout(180000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);

const M = await makeMedia(page, BASE);
await installKitFrameTheme(page, BASE);

// Deux papiers peints (PNG transparents), papier des cartes du site, papier peint de la page.
const FIX = mkdtempSync(path.join(tmpdir(), "pf-par66-"));
execFileSync(
  process.execPath,
  [
    "-e",
    `const sharp=require("sharp");const d=process.argv[1];
const dots='<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><g fill="#e07a9a"><circle cx="60" cy="60" r="26"/><circle cx="180" cy="180" r="26"/></g></svg>';
const stars='<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><g fill="#e0b84a"><path d="M80 30l14 30 33 4-24 23 6 33-29-16-29 16 6-33-24-23 33-4z"/></g></svg>';
(async()=>{await sharp(Buffer.from(dots)).png().toFile(d+"/Pois roses.png");await sharp(Buffer.from(stars)).png().toFile(d+"/Etoiles dorees.png");})();`,
    FIX,
  ],
  { stdio: "inherit" },
);
await page.goto(`${BASE}/admin/papiers-peints`, { waitUntil: "networkidle" });
await page.locator('[data-testid="wallpaper-input"]').setInputFiles([path.join(FIX, "Pois roses.png"), path.join(FIX, "Etoiles dorees.png")]);
await waitFor(() => sql((db) => db.prepare("select count(*) n from wallpapers").get()).n >= 2, 120000);
await sleep(1500);
const WP = sql((db) => db.prepare("select id from wallpapers order by id").all()).map((r) => r.id);
await page.reload({ waitUntil: "networkidle" });
await page.locator('[data-testid="wallpaper-cards"] [data-testid="wallpaper-cards-on"]').click();
await waitFor(() => sql((db) => db.prepare("select count(*) n from settings where key = 'cardWallpaper'").get()).n === 1);

const PAGE = pageIdOf("decors");
const T = (s) => ({ fr: s, en: s });
const text = (uid, word, extra = {}) => ({ uid, type: "rich-text", props: { paragraphs: [{ fr: `${word} : un texte assez long pour que la zone ait du contenu à entourer, sur une ligne ou deux.`, en: word }], ...extra } });
const cell = (uid, mediaId, extra = {}) => ({ uid, type: "image", props: { mediaId, ...extra } });
const blocks = [
  text("p1", "Alpha"),
  text("p2", "Bravo carte", { surface: { color: "primary12", width: "inset", corners: "m", border: { width: "thin" } } }),
  text("p3", "Charlie fond", { background: { kind: "color", color: "bgDeep" } }),
  text("p4", "Delta fond papier marge", { background: { kind: "wallpaper", wallpaper: WP[1], color: "surface", inset: "s", round: "m" } }),
  text("p5", "Echo carte et fond", { surface: { color: "surface", width: "inset" }, background: { kind: "color", color: "bgDeep" } }),
  text("p6", "Foxtrot carte papier", { surface: { color: "surface", width: "inset", paperWallpaper: WP[0], paperOpacity: 0.4 } }),
  text("p7", "Golf carte pleine largeur", { surface: { color: "secondary", width: "full", corners: "square" } }),
  {
    uid: "p8",
    type: "grid",
    props: {
      layout: "3",
      gap: "normal",
      align: "stretch",
      ratio: "auto",
      top: "gap",
      background: { kind: "color", color: "tertiary12" },
      surface: { color: "bg", width: "inset", corners: "l" },
      children: [
        cell("c1", M.paysage, { caption: T("Légende un"), look: { frame: { kind: "theme" }, imageBg: "card" } }),
        cell("c2", M.portrait, { look: { frame: { kind: "band", width: "thick", color: "primary" }, imageBg: "surface" } }),
        cell("c3", M.carre, { caption: T("Légende trois") }),
      ],
    },
  },
  { uid: "p9", type: "image", props: { mediaId: M.panorama, width: "wide", caption: T("Panorama dans une carte"), surface: { color: "primary12", width: "inset" }, look: { frame: { kind: "band", width: "medium" } } } },
  text("p10", "Hotel clôture"),
];
sql((db) => db.prepare("update pages set theme_overrides = ? where id = ?").run(JSON.stringify({ wallpaper: { mode: "wallpaper", wallpaper: WP[1], size: 160, opacity: 0.5 } }), PAGE));
setDraft(PAGE, blocks);

/** Publie le brouillon par le bouton de l'éditeur. */
async function openEditorPage() {
  await page.goto(`${BASE}/admin/pages/${PAGE}/editer`, { waitUntil: "domcontentloaded" });
  const h = await page.waitForSelector("iframe.ve-frame", { timeout: 120000 });
  const fr = await h.contentFrame();
  await fr.waitForSelector("html[data-edit-mode]", { timeout: 180000 });
  await sleep(2500);
  return fr;
}
await openEditorPage();
await page.getByRole("button", { name: "Publier", exact: true }).click();
await waitFor(async () => /En ligne/.test((await page.locator(".ve-status").textContent()) ?? ""), 120000);
void draftBlocks;
void q1;

const WIDTHS = [1440, 1024, 390];
const slug = "decors";
for (const w of WIDTHS) {
  // Éditeur : la toile seule (iframe), au pixel : captures de l'élément iframe à largeur de fenêtre égale à celle du site simulé.
  const ed = await browser.newContext({ viewport: { width: w + 330, height: 900 } });
  const ep = await ed.newPage();
  await ep.goto(`${BASE}/admin/connexion`, { waitUntil: "networkidle" });
  await ep.fill("#email", process.env.ADMIN_EMAIL);
  await ep.fill("#password", process.env.ADMIN_PASSWORD);
  await Promise.all([ep.waitForURL((u) => !u.pathname.startsWith("/admin/connexion"), { timeout: 90000 }), ep.click("button[type=submit]")]);
  await ep.goto(`${BASE}/admin/pages/${PAGE}/editer`, { waitUntil: "domcontentloaded" });
  const handle = await ep.waitForSelector("iframe.ve-frame", { timeout: 120000 });
  const fr = await handle.contentFrame();
  await fr.waitForSelector("html[data-edit-mode]", { timeout: 180000 });
  await sleep(3000);
  await fr.evaluate(() => document.querySelectorAll(".pe-host, [data-pe-ui]").forEach((e) => e.setAttribute("hidden", "")));
  const height = await fr.evaluate(() => document.documentElement.scrollHeight);
  await ep.setViewportSize({ width: w + 330, height: Math.min(height + 120, 9000) });
  await sleep(1500);
  await handle.screenshot({ path: path.join(SHOTS, `editeur-${w}.png`) });
  // Aperçu : bouton « Aperçu » de l'éditeur.
  await ep.getByRole("button", { name: "Aperçu", exact: true }).click();
  await sleep(2500);
  await handle.screenshot({ path: path.join(SHOTS, `apercu-${w}.png`) });
  await ed.close();
  // Public.
  const pc = await browser.newContext({ viewport: { width: w, height: 900 } });
  const pp = await pc.newPage();
  await pp.goto(`${BASE}/fr/${slug}`, { waitUntil: "networkidle" });
  await sleep(1500);
  await pp.screenshot({ path: path.join(SHOTS, `public-${w}.png`), fullPage: true });
  await pc.close();
}
console.log(errors.length ? `erreurs de page : ${errors.slice(0, 3).join(" | ")}` : "ok");
await browser.close();
