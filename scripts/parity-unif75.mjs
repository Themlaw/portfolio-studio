#!/usr/bin/env node
/**
 * Parité de rendu du lot 75 (unification R4 + R5 + dédoublonnage CSS) : AUCUN changement de rendu, au pixel.
 * Deux temps, sur la MÊME base :
 *   PAR_MODE=setup   (build d'AVANT, base neuve) : pose, en FORMES DE DONNÉES v0.30 (cinq cartes par place de carrousel, cadres à l'ancienne
 *                    forme, Planche libre), une page qui combine tout : papiers peints, carte, fond, fond emboîté, grille avec cadres et fonds
 *                    d'image, image seule, Planche libre habillée, planche de projet avec composants habillés et carrousel à places réglées
 *                    (cadre, fond, arrondi, panorama), portrait du profil et tuiles à format imposé. Publie, puis rend la main.
 *   PAR_MODE=capture (n'importe quel build, base copiée de l'étape setup) : pour chaque thème, photographie la page à 1440 / 1024 / 390 px
 *                    dans l'éditeur (toile), l'Aperçu et le site public. Le build d'APRÈS démarre sur la base d'avant : la migration 0030
 *                    est rejouée pour de vrai.
 * Comparer les deux séries : scripts/parity-surface66-diff.mjs <avant> <après> <sortie>.
 * Usage : PAR_MODE=… DATA_DIR=… ADMIN_EMAIL=… ADMIN_PASSWORD=… BASE=… SHOTS=<dossier> [PAR_THEMES=a,b] node scripts/parity-unif75.mjs
 * Images de test synthétiques seulement.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { installKitFrameTheme } from "./lib/cadres62.mjs";
import { draftBlocks, login, makeMedia, openEditor, pageIdOf, q1, setBoardDraft, setDraft, settled, sleep, sql, waitFor } from "./lib/grille31d.mjs";
import { installPaperTheme, PAPER_THEME_ID } from "./lib/paper-theme.mjs";
import { activateThemeUi } from "./lib/theme-live.mjs";

const BASE = process.env.BASE ?? "http://localhost:3001";
const MODE = process.env.PAR_MODE ?? "capture";
const SHOTS = process.env.SHOTS ?? path.join(tmpdir(), "parity-unif75");
const DATA_DIR = process.env.DATA_DIR;
mkdirSync(SHOTS, { recursive: true });
const WIDTHS = [1440, 1024, 390];
/** Quatre thèmes livrés + un thème à papier du kit (cartes) + un thème à cadre dessiné. */
const THEMES = (process.env.PAR_THEMES ?? "galerie-lumineuse,carnet-d-atelier,fanzine-riso,studio,papier-coeurs,cadre-kit").split(",").filter(Boolean);

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(90000);
page.setDefaultNavigationTimeout(180000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);

const T = (s) => ({ fr: s, en: s });
const PAGE = pageIdOf("decors");
const project = q1("select id, slug from projects order by id limit 1");

/* ============================================================================================================================
 * SETUP : le contenu v0.30
 * ========================================================================================================================== */
async function setup() {
  const M = await makeMedia(page, BASE);
  const FIX = mkdtempSync(path.join(tmpdir(), "pf-par75-"));
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
  // Le thème à papier du kit sur les cartes (lot 28), posé directement en base comme l'e2e papier28.
  installPaperTheme(DATA_DIR, { paper: { onCards: true, onCardsOpacity: 0.4 } });

  const text = (uid, word, extra = {}) => ({ uid, type: "rich-text", props: { paragraphs: [{ fr: `${word} : un texte assez long pour que la zone ait du contenu à entourer, sur une ligne ou deux.`, en: word }], ...extra } });
  const cell = (uid, mediaId, extra = {}) => ({ uid, type: "image", props: { mediaId, ...extra } });
  const band = (width, color) => ({ kind: "band", width, ...(color ? { color } : {}) });
  const fitem = (id, media, x, y, w, extra = {}) => ({ id, media, x, y, w, rot: 0, z: 0, ...extra });
  const blocks = [
    text("p1", "Alpha"),
    text("p2", "Bravo carte", { surface: { color: "primary12", width: "inset", corners: "m", border: { width: "thin" } } }),
    text("p3", "Charlie fond", { background: { kind: "color", color: "bgDeep" } }),
    text("p4", "Delta fond papier marge", { background: { kind: "wallpaper", wallpaper: WP[1], color: "surface", inset: "s", round: "m" } }),
    text("p5", "Echo carte et fond", { surface: { color: "surface", width: "inset" }, background: { kind: "color", color: "bgDeep" } }),
    text("p6", "Foxtrot carte papier", { surface: { color: "surface", width: "inset", paperWallpaper: WP[0], paperOpacity: 0.4 } }),
    text("p7", "Golf carte pleine largeur", { surface: { color: "secondary", width: "full", corners: "square" } }),
    text("p7b", "Golf bis carte arrondie L", { surface: { color: "tertiary12", width: "inset", corners: "l", border: { width: "thick" } }, background: { kind: "color", color: "surface", inset: "m", round: "l" } }),
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
          cell("c1", M.paysage, { caption: T("Légende un"), look: { frame: { kind: "theme" }, imageBg: "card", radius: "medium" } }),
          cell("c2", M.portrait, { look: { frame: { size: "thick", color: "primary" }, imageBg: "surface", radius: "strong" } }),
          cell("c3", M.carre, { caption: T("Légende trois"), look: { radius: "soft" } }),
        ],
      },
    },
    { uid: "p9", type: "image", props: { mediaId: M.panorama, width: "wide", caption: T("Panorama dans une carte"), surface: { color: "primary12", width: "inset" }, look: { frame: { kind: "band", width: "moyen" }, radius: "soft" } } },
    { uid: "p9b", type: "image", props: { mediaId: M.portrait, width: "wide", ratio: "3:4", look: { frame: { kind: "theme" }, imageBg: "#ffcc00", radius: "none" } } },
    {
      uid: "p10",
      type: "free-board",
      props: {
        format: "3:2",
        phone: "scale",
        items: [
          fitem("a1", M.paysage, 6, 8, 38, { frame: { kind: "theme" }, bg: "card", radius: "soft" }),
          fitem("a2", M.portrait, 52, 6, 26, { frame: { size: "thin", color: "tertiary" }, bg: "#ffffff", rot: 6 }),
          fitem("a3", M.carre, 34, 55, 24, { radius: "strong", z: 1 }),
        ],
      },
    },
    // La planche d'un projet : TOUT l'habillage des places de carrousel à l'ancienne forme (cinq cartes), cadres compris.
    {
      uid: "pb1",
      type: "project-board",
      props: {
        project: project.slug,
        look: {
          spaceTop: "m",
          radius: "soft",
          slotRadius: { "c1-p0": "strong", "c1-p2": "none" },
          slotFrame: { "c1-p0": band("epais", "primary"), "c1-p1": { kind: "theme" }, "c1-p2": { size: "thin" }, "c1-p3": { kind: "none" } },
          slotBg: { "c1-p0": "card", "c1-p1": "#ffffff", "c1-p3": "secondary" },
          slotPano: { "c1-p2": "scroll" },
        },
      },
    },
    text("p11", "Hotel clôture"),
  ];
  const board = [
    { uid: "c1", type: "strip", props: { source: "own", media: [M.paysage, M.portrait, M.panorama, M.carre], ids: ["p0", "p1", "p2", "p3"] } },
    { uid: "bi1", type: "image", props: { mediaId: M.paysage, width: "wide", look: { frame: { kind: "theme" }, imageBg: "card", radius: "medium" } } },
    { uid: "bi2", type: "image", props: { mediaId: M.carre, width: "wide", look: { frame: { size: "thick", color: "secondary" } } } },
    { uid: "bg1", type: "grid", props: { layout: "2", gap: "normal", align: "stretch", ratio: "auto", top: "gap", children: [cell("bc1", M.carre, { look: { frame: band("fin"), imageBg: "primary" } }), cell("bc2", M.paysage, { look: { radius: "strong" } })] } },
  ];
  sql((db) => db.prepare("update pages set theme_overrides = ? where id = ?").run(JSON.stringify({ wallpaper: { mode: "wallpaper", wallpaper: WP[1], size: 160, opacity: 0.5 } }), PAGE));
  setDraft(PAGE, blocks);
  setBoardDraft(project.id, PAGE, board);
  await openEditor(page, BASE, PAGE);
  await settled(page);
  await page.getByRole("button", { name: "Publier", exact: true }).click();
  const confirm = page.locator("dialog[open]").getByRole("button", { name: "Mettre en ligne" });
  if (await confirm.waitFor({ timeout: 4000 }).then(() => true, () => false)) await confirm.click();
  const done = await waitFor(() => sql((db) => db.prepare("select draft from pages where id = ?").get(PAGE)).draft === null, 150000);
  console.log(done ? "PASS page publiée" : "FAIL page non publiée");
  await sleep(2500);
  // Le brouillon est rejoué (même contenu) : l'éditeur et l'Aperçu le montrent aussi.
  setDraft(PAGE, blocks);
  setBoardDraft(project.id, PAGE, board);
  // R5 : le portrait du profil et les tuiles de l'accueil ont un format imposé (le composant pose `--box-r`).
  sql((db) => {
    for (const r of db.prepare("select id, type, props from blocks where type in ('profile', 'collection-tiles')").all()) {
      const props = JSON.parse(r.props);
      if (r.type === "profile") props.portraitRatio = "3:4";
      else props.ratio = "3:2";
      db.prepare("update blocks set props = ? where id = ?").run(JSON.stringify(props), r.id);
    }
  });
  console.log(`INFO blocs v0.30 posés : ${draftBlocks(PAGE).length} rubriques, ${board.length} composants de planche`);
}

/* ============================================================================================================================
 * CAPTURE
 * ========================================================================================================================== */
/** Attend (au plus 40 s) que toutes les images du document soient chargées : sinon la capture montre l'aplat de chargement, pas le rendu. */
const imagesLoaded = (doc) =>
  doc
    .evaluate(async () => {
      for (let i = 0; i < 80; i++) {
        document.querySelectorAll("img[loading=lazy]").forEach((im) => (im.loading = "eager"));
        if ([...document.images].every((im) => im.complete && im.naturalWidth > 0)) return true;
        await new Promise((r) => setTimeout(r, 500));
      }
      return false;
    })
    .catch(() => false);
const hideUi = (fr) => fr.evaluate(() => document.querySelectorAll(".pe-host, [data-pe-ui]").forEach((e) => e.setAttribute("hidden", "")));

async function themeShots(theme) {
  const dir = path.join(SHOTS, theme);
  mkdirSync(dir, { recursive: true });
  for (const w of WIDTHS) {
    // Éditeur (la toile seule) et Aperçu : un onglet par largeur, dans la session déjà ouverte (pas de nouvelle connexion).
    const ep = await ctx.newPage();
    ep.setDefaultTimeout(90000);
    ep.on("pageerror", (e) => errors.push(`${theme} ${w} : ${e.message}`));
    await ep.setViewportSize({ width: w + 330, height: 900 });
    await ep.goto(`${BASE}/admin/pages/${PAGE}/editer`, { waitUntil: "domcontentloaded" });
    const handle = await ep.waitForSelector("iframe.ve-frame", { timeout: 120000 });
    const fr = await handle.contentFrame();
    await fr.waitForSelector("html[data-edit-mode]", { timeout: 180000 });
    await sleep(3000);
    await imagesLoaded(fr);
    await hideUi(fr);
    const height = await fr.evaluate(() => document.documentElement.scrollHeight);
    await ep.setViewportSize({ width: w + 330, height: Math.min(height + 120, 9000) });
    await sleep(1500);
    await imagesLoaded(fr);
    await handle.screenshot({ path: path.join(dir, `editeur-${w}.png`) });
    await ep.getByRole("button", { name: "Aperçu", exact: true }).click();
    await sleep(2500);
    await handle.screenshot({ path: path.join(dir, `apercu-${w}.png`) });
    await ep.close();
    // Site public : la page de test, l'accueil (tuiles à format imposé) et À propos (portrait à format imposé).
    const pc = await browser.newContext({ viewport: { width: w, height: 900 } });
    const pp = await pc.newPage();
    for (const [name, url] of [["public", "/fr/decors"], ["accueil", "/fr"], ["apropos", "/fr/a-propos"]]) {
      await pp.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
      await pp.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 500) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 80));
        }
        window.scrollTo(0, 0);
      });
      await imagesLoaded(pp);
      await sleep(1200);
      await pp.screenshot({ path: path.join(dir, `${name}-${w}.png`), fullPage: true, animations: "disabled" });
    }
    await pc.close();
  }
}

async function capture() {
  for (const theme of THEMES) {
    console.log(`INFO thème ${theme}`);
    if (theme === "cadre-kit") await installKitFrameTheme(page, BASE);
    else await activateThemeUi(page, BASE, theme === PAPER_THEME_ID ? PAPER_THEME_ID : theme);
    await sleep(1500);
    await themeShots(theme);
  }
  // Les réglages d'habillage de la base, tels que le serveur les a : de quoi vérifier que la migration n'a rien changé (comparés à part).
  const looks = [];
  const visit = (node, where) => {
    if (Array.isArray(node)) node.forEach((c, i) => visit(c, `${where}[${i}]`));
    else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) (k === "look" ? looks.push([`${where}.look`, v]) : null, visit(v, `${where}.${k}`));
  };
  visit(draftBlocks(PAGE), "draft");
  console.log(`INFO ${looks.length} look dans le brouillon ; ${looks.filter(([, v]) => v && Object.keys(v).some((k) => /^slot(Frame|Bg|Radius|Pano|Video)$/.test(k))).length} à l'ancienne forme`);
}

if (MODE === "setup") await setup();
else await capture();
console.log(errors.length ? `erreurs de page : ${errors.slice(0, 5).join(" | ")}` : "ok");
await browser.close();
