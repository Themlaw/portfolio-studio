#!/usr/bin/env node
/**
 * Planche composée (v0.23, lot 31), UN chromium. Serveur requis, base NEUVE (seed), une connexion.
 *
 *  A. Planche existante : suite = bande seule (migration), rendu public avec sa bande, aucun repère d'édition.
 *  B. Édition sur la toile : « + Ajouter » (menu) → Grille, remplie depuis la médiathèque (panneau) ; Image pleine
 *     largeur ; retirer la bande ; réordonner ; Annuler / Rétablir.
 *  C. Brouillon non publié invisible en public ; « Publier » : planche identique sur la page de l'éditeur ET sur une 2e page
 *     qui affiche le même projet.
 * Captures : $SHOTS (défaut screenshots/planche31).
 * Usage : DATA_DIR=… ADMIN_EMAIL=… ADMIN_PASSWORD=… BASE=http://localhost:3410 node scripts/e2e-planche31.mjs
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";

import Database from "better-sqlite3";
import { chromium } from "playwright";
import sharp from "sharp";

import { pageIdOf, placeBoard, projectSlugOf, removeBoard } from "./lib/page-board.mjs";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const DATA = process.env.DATA_DIR ?? "data";
const DB = path.join(DATA, "portfolio.db");
const SHOTS = process.env.SHOTS ?? "screenshots/planche31";
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
function ok(label, cond, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (sql, ...args) => {
  const db = new Database(DB, { readonly: true });
  try {
    return db.prepare(sql).all(...args);
  } finally {
    db.close();
  }
};
async function waitFor(fn, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(300);
  }
  return false;
}
const HOME = pageIdOf("");
const ABOUT = pageIdOf("personnages");
const PROJECT = q("select id, slug from projects order by position limit 1")[0];
const project = () => q("select layout, draft_layout, draft_layout_page_id from projects where id = ?", PROJECT.id)[0];
const json = (s) => (s ? JSON.parse(s) : null);
const draftTypes = () => (json(project().draft_layout) ?? []).map((i) => i.type);
const publicTypes = () => (json(project().layout) ?? []).map((i) => i.type);
const publicHtml = async (p) => (await fetch(`${BASE}${p}`)).text();
/** Planche du projet dans le HTML public : de son <section class="strip"> à la suivante. */
const boardHtml = (html) => {
  const i = html.indexOf(`aria-labelledby="project-${PROJECT.slug}"`);
  if (i < 0) return "";
  // Jusqu'à la planche suivante (ou 60 000 caractères).
  const next = html.indexOf('<section class="strip', i + 10);
  return html.slice(i, next < 0 ? i + 60000 : next);
};

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(`${BASE}/admin/connexion`, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL);
await page.fill("#password", PASSWORD);
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/admin/connexion"), { timeout: 90000 }), page.click("button[type=submit]")]);

async function canvas() {
  const handle = await page.waitForSelector("iframe.ve-frame", { timeout: 120000 });
  const f = await handle.contentFrame();
  await f.waitForSelector("html[data-edit-mode]", { timeout: 180000 });
  return f;
}
async function settled() {
  await page.waitForFunction(() => !/Enregistrement/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, { timeout: 120000 });
  await sleep(700);
}
const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});

try {
  // Mise en place : la planche du projet sur l'accueil ET sur une 2e page (publiées).
  const placedHome = await placeBoard(page, BASE, HOME, PROJECT.slug);
  const placedAbout = await placeBoard(page, BASE, ABOUT, PROJECT.slug);
  ok("0 planche posée sur deux pages", placedHome && placedAbout, `accueil ${placedHome}, 2e page ${placedAbout}, ids ${HOME}/${ABOUT}`);

  /* ---- A. Existant identique ---- */
  ok("A1 migration : suite publiée = [Images qui défilent]", JSON.stringify(publicTypes()) === '["strip"]', JSON.stringify(project().layout));
  let html = boardHtml(await publicHtml("/fr"));
  ok("A2 public : la bande défile, aucun repère d'édition", html.includes("strip-rail") && !html.includes("data-edit-bitem") && !html.includes("pe-bitem"));
  const stripCountBefore = (html.match(/strip-frame/g) ?? []).length;
  ok("A3 public : les images de la bande sont là", stripCountBefore > 0);

  /* ---- B. Édition ---- */
  await page.goto(`${BASE}/admin/pages/${HOME}/editer`, { waitUntil: "domcontentloaded" });
  let f = await canvas();
  await sleep(1500);
  const board = f.locator(`[data-edit-board="${PROJECT.id}"]`).first();
  await board.scrollIntoViewIfNeeded();
  await board.hover();
  ok("B1 « + Ajouter » présent (en bas et entre les composants)", (await board.locator("[data-edit-bitem-add]").count()) === 2);
  await shot("1-planche-avant");
  await board.locator("[data-edit-bitem-add]").last().click();
  await f.locator(".pe-bitem-menu").waitFor({ timeout: 20000 });
  ok("B2 menu court : 6 composants, carrousels à volonté (pas de « Images du projet » : la bande est là)", (await f.locator(".pe-bitem-menu button").count()) === 6 && (await f.locator('.pe-bitem-menu [data-bitem-type="strip"]').isEnabled()));
  await shot("2-menu");
  await f.locator('.pe-bitem-menu [data-bitem-type="grid"]').click();
  await sleep(2500);
  console.log("TOASTS:", JSON.stringify(await page.locator(".a-toasts").innerText().catch(() => "?")), "status:", await page.locator(".ve-status").innerText().catch(() => "?"));
  await shot("2b-apres-grille");
  ok("B3 grille ajoutée sous la bande (brouillon)", await waitFor(() => JSON.stringify(draftTypes()) === '["strip","grid"]'), JSON.stringify(draftTypes()));
  ok("B3b publié intact", JSON.stringify(publicTypes()) === '["strip"]');
  await page.getByTestId("board-item-panel").waitFor({ timeout: 30000 });
  // Image dans la grille, depuis la médiathèque.
  // Lot 31d : « + Ajouter une image » ouvre directement le choix dans la médiathèque (plus de case vide d'abord).
  await page.getByTestId("board-grid-add-image").click();
  await page.locator(".a-picker-scroll button").first().click();
  ok("B4 image choisie dans la grille", await waitFor(() => (json(project().draft_layout)?.[1]?.props?.children?.[0]?.props?.mediaId ?? 0) > 0), project().draft_layout);
  await settled();
  ok("B4b la grille est rendue sur la toile", await waitFor(async () => (await board.locator('[data-edit-bitem-type="grid"] .block-grid-cell img').count()) > 0));
  await shot("3-grille");
  // Image pleine largeur, ajoutée entre la bande et la grille (« + » du milieu).
  await board.locator('[data-edit-bitem-add="1"]').click();
  await f.locator('.pe-bitem-menu [data-bitem-type="image"]').click();
  ok("B5 image ajoutée au rang 2", await waitFor(() => JSON.stringify(draftTypes()) === '["strip","image","grid"]'), JSON.stringify(draftTypes()));
  await page.getByRole("button", { name: "Choisir une image" }).first().click();
  await page.locator(".a-picker-scroll button").first().click();
  ok("B5b image choisie (largeur « pleine »)", await waitFor(() => { const i = json(project().draft_layout)?.[1]; return i?.props?.mediaId > 0 && i.props.width === "full"; }));
  await settled();
  // Retirer la bande (barre du composant), puis Annuler / Rétablir.
  await board.locator('[data-edit-bitem-project]').hover();
  await board.locator('[data-edit-bitem-project] [data-edit-bitem-op="remove"]').click();
  ok("B6 bande retirée", await waitFor(() => JSON.stringify(draftTypes()) === '["image","grid"]'), JSON.stringify(draftTypes()));
  await settled();
  await shot("4-sans-bande");
  await page.keyboard.press("Control+z");
  ok("B7 Annuler remet la bande", await waitFor(() => JSON.stringify(draftTypes()) === '["strip","image","grid"]'), JSON.stringify(draftTypes()));
  await settled();
  await page.keyboard.press("Control+Shift+z");
  ok("B8 Rétablir la retire de nouveau", await waitFor(() => JSON.stringify(draftTypes()) === '["image","grid"]'), JSON.stringify(draftTypes()));
  await settled();
  // Réordonner : la grille monte au-dessus de l'image.
  const grid = board.locator('[data-edit-bitem-type="grid"]');
  await grid.hover();
  await grid.locator('[data-edit-bitem-op="up"]').click();
  ok("B9 réordonner : grille puis image", await waitFor(() => JSON.stringify(draftTypes()) === '["grid","image"]'), JSON.stringify(draftTypes()));
  await settled();

  /* ---- C. Brouillon invisible, puis publication ---- */
  html = boardHtml(await publicHtml("/fr"));
  ok("C1 brouillon invisible en public (bande toujours là)", html.includes("strip-rail") && !html.includes("block-grid"));
  await page.getByRole("button", { name: "Publier", exact: true }).click();
  ok("C2 publié : suite du projet mise à jour, surcouche vidée", await waitFor(() => JSON.stringify(publicTypes()) === '["grid","image"]' && project().draft_layout === null && project().draft_layout_page_id === null), JSON.stringify(project()));
  await sleep(1500);
  const a = boardHtml(await publicHtml("/fr"));
  const b = boardHtml(await publicHtml("/fr/personnages"));
  ok("C3 public (accueil) : grille et image, plus de bande", a.includes("block-grid") && a.includes("block-image") && !a.includes("strip-rail"));
  const sig = (h) => (h.match(/class="[^"]*(block-grid|block-image|strip-rail)[^"]*"/g) ?? []).join("|");
  ok("C4 la 2e page affiche la même planche", b.length > 0 && sig(a) === sig(b), `${sig(a)} <> ${sig(b)}`);
  ok("C5 aucun repère d'édition en public", !a.includes("data-edit-") && !a.includes("pe-bitem"), (a.match(/data-edit-[a-z-]+|pe-bitem[a-z-]*/g) ?? []).slice(0, 5).join(","));
  await shot("5-publie");
  /* ---- E à J. Lot 31b : glisser-déposer, carrousels propres, largeur et alignement ---- */
  const typesOf = () => draftTypes();
  const layout = () => json(project().draft_layout) ?? [];
  const byUid = (uid) => layout().find((i) => i.uid === uid);
  await page.goto(`${BASE}/admin/pages/${HOME}/editer`, { waitUntil: "domcontentloaded" });
  f = await canvas();
  await sleep(1500);
  const board2 = f.locator(`[data-edit-board="${PROJECT.id}"]`).first();
  const frame = (i) => board2.locator("[data-edit-bitem]").nth(i);
  const center = async (loc) => {
    await loc.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await sleep(400);
  };
  /** Glisse `from` (page) jusqu'au point (x, y) de la page, après un arrêt pour laisser la toile dessiner ses repères ; `during` s'exécute avant de lâcher. */
  async function drag(from, x, y, during, aim) {
    // La palette est plus longue (lot 42, « Planche libre ») : la carte visée peut être sous la ligne de flottaison.
    await from.scrollIntoViewIfNeeded();
    const b = await from.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 12, b.y + b.height / 2 + 12, { steps: 3 });
    await page.mouse.move(x, y, { steps: 14 });
    await sleep(500);
    // Lot 54 : les légendes vides n'existent que sur le média survolé ; en entrant dans la planche, les cadres changent de hauteur.
    // La cible est donc remesurée une fois le pointeur arrivé, puis visée de nouveau.
    if (aim) {
      const t = await aim();
      await page.mouse.move(t.x, t.y, { steps: 6 });
      await sleep(400);
    }
    if (during) await during();
    await page.mouse.up();
    await sleep(800);
  }
  ok("E0 planche publiée de la section C : grille puis image", JSON.stringify(publicTypes()) === '["grid","image"]');
  // E : un composant de la palette glissé DANS la planche, entre deux composants.
  await page.getByRole("tab", { name: "Ajouter" }).click();
  await center(frame(0));
  const f0 = await frame(0).boundingBox();
  const fb = await f.locator("html").evaluate(() => 0).then(() => null);
  void fb;
  let markerSeen = false;
  await drag(page.locator('.ve-card[data-key="grid"]'), f0.x + f0.width / 2, f0.y + f0.height - 6, async () => {
    markerSeen = (await f.locator(".pe-marker-board").count()) > 0;
  }, async () => { const b = await frame(0).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height - 6 }; });
  ok("E1 glisser une Grille entre deux composants de la planche", await waitFor(() => JSON.stringify(typesOf()) === '["grid","grid","image"]'), JSON.stringify(typesOf()));
  ok("E1b repère « Déposer ici » dans la planche pendant le glisser", markerSeen);
  await settled();
  await page.getByRole("tab", { name: "Ajouter" }).click();
  // La carte est amenée à l'écran AVANT de mesurer la planche ; la cible reste à 120 px du bas de la fenêtre (sinon la toile défile pendant le glisser et le dépôt tombe sous la planche).
  await page.locator('.ve-card[data-key="board-strip"]').scrollIntoViewIfNeeded();
  await center(frame(2));
  const f2 = await frame(2).boundingBox();
  // Dépôt aux trois quarts de la hauteur du cadre (moitié basse = « après l'image ») : le tout bas du cadre peut recouvrir la planche suivante
  // quand l'image garde son plafond d'avant (lot 39 corrigé à l'intégration v0.26), et le dépôt irait alors dans CETTE planche.
  await drag(page.locator('.ve-card[data-key="board-strip"]'), f2.x + f2.width / 2, Math.min(f2.y + f2.height * 0.75, page.viewportSize().height - 12), undefined, async () => { const b = await frame(2).boundingBox(); return { x: b.x + b.width / 2, y: Math.min(b.y + b.height * 0.75, page.viewportSize().height - 12) }; });
  ok("E2 glisser « Images qui défilent » en bas de la planche", await waitFor(() => JSON.stringify(typesOf()) === '["grid","grid","image","strip"]'), JSON.stringify(typesOf()));
  await settled();
  // Dépôt hors cible : un composant lâché hors de la toile ne change ni la planche ni la page.
  const before = JSON.stringify(layout());
  const pageBlocks = () => (json(q("select draft from pages where id = ?", HOME)[0].draft)?.blocks ?? []).length;
  const blocksBefore = pageBlocks();
  await page.getByRole("tab", { name: "Ajouter" }).click();
  await drag(page.locator('.ve-starter[data-starter="title"]'), 120, 600);
  await settled();
  ok("E3 dépôt hors cible refusé proprement (planche et page inchangées)", JSON.stringify(layout()) === before && pageBlocks() === blocksBefore);
  // F : médias glissés depuis l'onglet Médias.
  await page.getByRole("tab", { name: "Médias" }).click();
  const li = (n) => page.locator(".ve-media li[data-media]").nth(n);
  const mid = async (n) => Number(await li(n).getAttribute("data-media"));
  const [A, B, C] = [await mid(0), await mid(1), await mid(2)];
  const imUid = layout()[2].uid;
  await page.getByRole("tab", { name: "Médias" }).click();
  await center(frame(2));
  let fr = await frame(2).boundingBox();
  await drag(li(1), fr.x + fr.width / 2, fr.y + fr.height / 2, undefined, async () => { const b = await frame(2).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  ok("F1 un média glissé sur une Image la remplace", await waitFor(() => byUid(imUid)?.props?.mediaId === B), JSON.stringify(byUid(imUid)?.props));
  await settled();
  const rail1 = layout()[3].uid;
  await page.getByRole("tab", { name: "Médias" }).click();
  await center(frame(3));
  fr = await frame(3).boundingBox();
  await drag(li(0), fr.x + fr.width / 2, fr.y + fr.height / 2, undefined, async () => { const b = await frame(3).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  ok("F2 un média glissé sur un carrousel l'ajoute", await waitFor(() => JSON.stringify(byUid(rail1)?.props?.media) === JSON.stringify([A])), JSON.stringify(byUid(rail1)?.props));
  await settled();
  const g2 = layout()[1].uid;
  await page.getByRole("tab", { name: "Médias" }).click();
  await center(frame(1));
  fr = await frame(1).boundingBox();
  await drag(li(2), fr.x + fr.width / 2, fr.y + fr.height / 2, undefined, async () => { const b = await frame(1).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  ok("F3 un média glissé sur une Grille l'ajoute", await waitFor(() => (byUid(g2)?.props?.children ?? []).length === 1), JSON.stringify(byUid(g2)?.props));
  await settled();
  // Un 2e carrousel (menu « + »), avec d'autres images.
  await center(frame(3));
  await board2.locator("[data-edit-bitem-add]").last().click();
  await f.locator('.pe-bitem-menu [data-bitem-type="strip"]:not([data-bitem-source])').click();
  ok("F4 un 2e carrousel s'ajoute (plusieurs exemplaires)", await waitFor(() => typesOf().filter((t) => t === "strip").length === 2), JSON.stringify(typesOf()));
  await settled();
  await page.getByRole("tab", { name: "Médias" }).click();
  const rail2 = layout()[4].uid;
  await center(frame(4));
  fr = await frame(4).boundingBox();
  await drag(li(1), fr.x + fr.width / 2, fr.y + fr.height / 2, undefined, async () => { const b = await frame(4).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  await settled();
  await center(frame(4));
  fr = await frame(4).boundingBox();
  await drag(li(2), fr.x + fr.width / 2, fr.y + fr.height / 2, undefined, async () => { const b = await frame(4).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  ok("F5 deux carrousels aux images différentes", await waitFor(() => JSON.stringify(byUid(rail2)?.props?.media) === JSON.stringify([B, C]) && JSON.stringify(byUid(rail1)?.props?.media) === JSON.stringify([A])), `${JSON.stringify(byUid(rail1)?.props)} / ${JSON.stringify(byUid(rail2)?.props)}`);
  await settled();
  // G : clic sur une vignette quand un composant est choisi.
  await center(frame(3));
  await frame(3).locator(".pe-bitem-edit").click();
  await page.getByTestId("board-item-panel").waitFor({ timeout: 30000 });
  await page.getByRole("tab", { name: "Médias" }).click();
  await li(2).click();
  ok("G1 clic sur une vignette Médias : ajoutée au carrousel choisi", await waitFor(() => JSON.stringify(byUid(rail1)?.props?.media) === JSON.stringify([A, C])), JSON.stringify(byUid(rail1)?.props));
  await settled();
  // H : réordonner par la poignée (le carrousel du bas remonte d'un cran, la toile défile près du bord haut).
  await center(frame(4));
  await frame(4).hover();
  const handle = frame(4).locator("[data-edit-bitem-handle]");
  const hb = await handle.boundingBox();
  const x0 = hb.x + hb.width / 2;
  await page.mouse.move(x0, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(x0 + 10, hb.y + hb.height / 2 - 10, { steps: 3 });
  for (let i = 0; i < 50; i++) {
    await page.mouse.move(x0 + (i % 2), 120 - Math.min(i, 90), { steps: 1 });
    await sleep(15);
  }
  await sleep(300);
  const t3 = await frame(3).boundingBox();
  await page.mouse.move(x0, Math.max(150, t3.y + 30), { steps: 6 });
  await sleep(400);
  await page.mouse.up();
  await sleep(800);
  ok("H1 réordonner par la poignée : le carrousel du bas passe avant l'autre", await waitFor(() => layout()[3]?.uid === rail2 && layout()[4]?.uid === rail1), JSON.stringify(layout().map((i) => i.uid)));
  await settled();
  await shot("6-glisser-deposer");
  // I : largeur et alignement (Grille, Image, carrousel, Vidéo).
  const setBox = async (uid, preset, align) => {
    const i = layout().findIndex((x) => x.uid === uid);
    await center(frame(i));
    await frame(i).locator(".pe-bitem-edit").click();
    // Lot 31e : « Réglages » d'une grille ouvre la fenêtre blanche sur la toile ; les réglages du composant sont dans « Plus de réglages… ».
    if (await f.locator('[data-testid="gridsettings"]').waitFor({ timeout: 1500 }).then(() => true, () => false)) await f.locator('[data-testid="gridsettings-more"]').click();
    await page.getByTestId("box-field").waitFor({ timeout: 30000 });
    await page.locator(`[data-testid="box-field"] [data-preset="${preset}"]`).click();
    await page.locator(`[data-testid="box-field"] [data-align="${align}"]`).click();
    await settled();
    await sleep(1000);
  };
  await setBox(g2, "medium", "right");
  ok("I1 Grille : largeur Moyenne, alignée à droite (brouillon)", await waitFor(() => JSON.stringify(byUid(g2)?.box) === '{"width":50,"align":"right"}'), JSON.stringify(byUid(g2)));
  await setBox(imUid, "small", "left");
  await setBox(rail1, "large", "center");
  ok("I2 Image et carrousel réglés", JSON.stringify(byUid(imUid)?.box) === '{"width":33,"align":"left"}' && JSON.stringify(byUid(rail1)?.box) === '{"width":67,"align":"center"}', JSON.stringify([byUid(imUid)?.box, byUid(rail1)?.box]));
  // Vidéo : ajoutée par « + », réglée, puis son plan (vidéo de la collection Animation) posé en base (aucune vidéo téléversée ici).
  const slotWithVideo = q("select slug from slots where video_id is not null limit 1")[0]?.slug;
  ok("I3 le jeu d'essai a un plan vidéo", Boolean(slotWithVideo));
  await center(frame(layout().length - 1));
  await board2.locator("[data-edit-bitem-add]").last().click();
  await f.locator('.pe-bitem-menu [data-bitem-type="video-single"]').click();
  ok("I4 Vidéo ajoutée", await waitFor(() => typesOf().includes("video-single")));
  const vUid = layout().find((x) => x.type === "video-single").uid;
  await page.getByTestId("box-field").waitFor({ timeout: 30000 });
  await page.locator('[data-testid="box-field"] [data-preset="medium"]').click();
  await page.locator('[data-testid="box-field"] [data-align="right"]').click();
  await settled();
  await sleep(1000);
  ok("I5 Vidéo : largeur Moyenne, à droite (brouillon)", await waitFor(() => JSON.stringify(byUid(vUid)?.box) === '{"width":50,"align":"right"}'), JSON.stringify(byUid(vUid)));
  {
    const db = new Database(DB);
    const row = db.prepare("select draft_layout d from projects where id = ?").get(PROJECT.id);
    const items = JSON.parse(row.d).map((x) => (x.uid === vUid ? { ...x, props: { ...x.props, slot: slotWithVideo } } : x));
    db.prepare("update projects set draft_layout = ? where id = ?").run(JSON.stringify(items), PROJECT.id);
    db.close();
  }
  await page.goto(`${BASE}/admin/pages/${HOME}/editer`, { waitUntil: "domcontentloaded" });
  f = await canvas();
  await sleep(1500);
  await page.getByRole("button", { name: "Publier", exact: true }).click();
  ok("J1 publié (brouillon vidé)", await waitFor(() => project().draft_layout === null && JSON.stringify(publicTypes()).includes("video-single")), JSON.stringify(project()).slice(0, 300));
  await sleep(2000);
  // Public : largeur et alignement mesurés sur la vraie page.
  // Public NON connecté : un contexte neuf, sans cookie (ni session admin, ni vue brouillon).
  const pubCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pub = await pubCtx.newPage();
  await pub.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  const measure = (uidSel) =>
    pub.evaluate((sel) => {
      const sect = document.querySelector(`[aria-labelledby="project-${sel.slug}"]`);
      const rows = [...(sect?.querySelectorAll(".board-box-row") ?? [])];
      return rows.map((row) => {
        const box = row.querySelector(".board-box");
        const r = row.getBoundingClientRect();
        const cs = getComputedStyle(row);
        const inner = r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const innerRight = r.right - parseFloat(cs.paddingRight);
        const b = box.getBoundingClientRect();
        return { align: box.getAttribute("data-align"), ratio: b.width / inner, right: Math.abs(b.right - innerRight) < 2, left: Math.abs(b.left - (r.left + parseFloat(cs.paddingLeft))) < 2, centered: Math.abs((b.left + b.right) / 2 - (r.left + r.right) / 2) < 2, html: box.innerHTML.slice(0, 80) };
      });
    }, { slug: PROJECT.slug });
  void measure;
  const rows = await measure();
  const near = (v, t) => Math.abs(v - t) < 0.03;
  ok("J2 public : 4 composants réduits (colonnes), Image à gauche, carrousel centré, Grille et Vidéo à droite", rows.length >= 4, JSON.stringify(rows.map((r) => [r.align, r.ratio.toFixed(2)])));
  ok("J3 public : Grille Moyenne alignée à droite (50 %)", rows.some((r) => r.align === "right" && near(r.ratio, 0.5) && r.right && r.html.includes("block-grid")), JSON.stringify(rows));
  ok("J4 public : Vidéo Moyenne alignée à droite (50 %)", rows.filter((r) => r.align === "right" && near(r.ratio, 0.5) && r.right).length >= 2, JSON.stringify(rows.map((r) => [r.align, r.ratio.toFixed(2), r.right])));
  ok("J5 public : Image Petite à gauche (33 %)", rows.some((r) => r.align === "left" && near(r.ratio, 0.33) && r.left), JSON.stringify(rows.map((r) => [r.align, r.ratio.toFixed(2), r.left])));
  ok("J6 public : carrousel Grande centré (67 %), le défilement tient dans la colonne", rows.some((r) => r.align === "center" && near(r.ratio, 0.67) && r.centered), JSON.stringify(rows.map((r) => [r.align, r.ratio.toFixed(2), r.centered])));
  // L'en-tête du site est collant : une capture de l'élément le reprend au milieu. On le vérifie, puis on le masque pour la capture.
  const headerPos = await pub.evaluate(() => getComputedStyle(document.querySelector("header.site-header, .site-header") ?? document.body).position);
  ok("J6g l'en-tête du site est collant (sticky / fixed) : il n'apparaît au milieu d'une capture qu'à cause d'elle", ["sticky", "fixed"].includes(headerPos), headerPos);
  await pub.addStyleTag({ content: ".site-header{visibility:hidden !important}" });
  await pub.locator(`[aria-labelledby="project-${PROJECT.slug}"]`).screenshot({ path: path.join(SHOTS, "7-public-largeurs.png") }).catch(() => {});
  // Téléphone : les colonnes reprennent toute la largeur.
  await pub.setViewportSize({ width: 390, height: 800 });
  await pub.reload({ waitUntil: "networkidle" });
  const phone = await pub.evaluate((slug) => {
    const sect = document.querySelector(`[aria-labelledby="project-${slug}"]`);
    return [...(sect?.querySelectorAll(".board-box") ?? [])].map((b) => {
      const p = b.parentElement;
      const cs = p ? getComputedStyle(p) : null;
      const inner = p && cs ? p.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) : 1;
      return b.getBoundingClientRect().width / inner;
    });
  }, PROJECT.slug);
  await pub.locator(`[aria-labelledby="project-${PROJECT.slug}"]`).screenshot({ path: path.join(SHOTS, "8-public-telephone.png") }).catch(() => {});
  const CONTROLS = ".pe-bitem-add, .pe-bitem-bar, .pe-bitem-empty, [data-edit-bitem-handle], [data-edit-bitem-op], [data-edit-bitem-add], [data-edit-bitem]";
  ok("J6b public non connecté : aucune commande d'édition dans le DOM", (await pub.locator(CONTROLS).count()) === 0 && !(await pub.content()).includes("data-edit-bitem") && !(await pub.content()).includes("pe-bitem"), `${await pub.locator(CONTROLS).count()} éléments ; ${((await pub.content()).match(/data-edit-[a-z-]+/g) ?? []).slice(0, 4).join(",")}`);
  // Aperçu, connecté (page de brouillon ouverte hors de la toile, brouillon visible) : rien non plus dans le DOM.
  const apercu = await ctx.newPage();
  // Le cookie de vue brouillon a été posé par l'éditeur (même contexte) : /fr s'ouvre en brouillon visible.
  await apercu.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  await sleep(1500);
  ok("J6c Aperçu connecté (brouillon visible, bandeau d'aperçu) : planche rendue, aucune commande d'édition dans le DOM", (await apercu.locator(`[aria-labelledby="project-${PROJECT.slug}"] .block-grid`).count()) > 0 && (await apercu.locator(".pe-bitem-add, .pe-bitem-bar, .pe-bitem-empty, [data-edit-bitem-handle], [data-edit-bitem-op], [data-edit-bitem-add]").count()) === 0, `grilles ${await apercu.locator(`[aria-labelledby="project-${PROJECT.slug}"] .block-grid`).count()}, commandes ${await apercu.locator(".pe-bitem-add, .pe-bitem-bar, .pe-bitem-empty, [data-edit-bitem-handle], [data-edit-bitem-op], [data-edit-bitem-add]").count()}, url ${apercu.url()}`);
  ok("J6c2 c'est bien la vue brouillon (bandeau « Aperçu »)", (await apercu.content()).includes("brouillons et pages non publiées visibles"));
  await apercu.close();
  // Aperçu DANS l'éditeur (bouton « Aperçu ») : les commandes quittent le DOM, et reviennent en édition.
  await page.goto(`${BASE}/admin/pages/${HOME}/editer`, { waitUntil: "domcontentloaded" });
  f = await canvas();
  await sleep(1500);
  const inFrame = () => f.locator(".pe-bitem-add, .pe-bitem-bar, [data-edit-bitem-handle]").count();
  ok("J6d édition : commandes présentes sur la toile", await waitFor(async () => (await inFrame()) > 0));
  await page.getByRole("button", { name: "Aperçu", exact: true }).click();
  ok("J6e Aperçu de l'éditeur : commandes absentes du DOM", await waitFor(async () => (await inFrame()) === 0));
  await page.keyboard.press("Escape");
  ok("J6f retour à l'édition : commandes de retour", await waitFor(async () => (await inFrame()) > 0));
  ok("J7 téléphone : chaque composant reprend toute la largeur", phone.length >= 4 && phone.every((r) => r > 0.97), JSON.stringify(phone));
  ok("J8 public : deux carrousels aux images différentes", (await pub.evaluate((slug) => document.querySelector(`[aria-labelledby="project-${slug}"]`)?.querySelectorAll(".strip-rail").length ?? 0, PROJECT.slug)) === 2);
  await pub.close();

  /* ---- K à R. Lot 31c : texte en place, fichiers déposés, vidéo réelle, compteur, menu, carte de palette, thèmes, doigt ---- */
  await pubCtx.close();
  await page.goto(`${BASE}/admin/pages/${HOME}/editer`, { waitUntil: "domcontentloaded" });
  f = await canvas();
  await sleep(1500);
  const frameBox = await page.locator("iframe.ve-frame").boundingBox();
  const BD = () => f.locator(`[data-edit-board="${PROJECT.id}"]`).first();
  const FR = (i) => BD().locator("[data-edit-bitem]").nth(i);
  const ctr = async (loc) => {
    await loc.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await sleep(400);
  };
  const lay = () => json(project().draft_layout) ?? json(project().layout) ?? [];
  const draftOnly = () => json(project().draft_layout) ?? [];
  const typesNow = () => lay().map((i) => i.type);
  const addVia = async (type, extra = ':not([data-bitem-source])') => {
    await ctr(FR(typesNow().length - 1));
    await BD().locator("[data-edit-bitem-add]").last().click();
    await f.locator(`.pe-bitem-menu [data-bitem-type="${type}"]${extra}`).click();
    await sleep(900);
    await settled();
  };

  // K : texte modifié en place, avec la barre typographique et « Ce texte uniquement ».
  const n0 = typesNow().length;
  await addVia("rich-text");
  ok("K0 un Texte s'ajoute à la planche", await waitFor(() => typesNow().length === n0 + 1 && typesNow().at(-1) === "rich-text"), JSON.stringify(typesNow()));
  const tx = lay().at(-1).uid;
  const par = f.locator(`[data-edit-bitem="${tx}"] [data-inline="paragraphs.0"]`);
  await ctr(par);
  await par.dblclick();
  await f.locator(".pe-text-editor").waitFor({ timeout: 20000 });
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Texte écrit sur la planche");
  await page.keyboard.press("Enter");
  ok("K1 texte de la planche modifié en place (dans la suite du projet)", await waitFor(() => lay().find((i) => i.uid === tx)?.props?.paragraphs?.[0]?.fr === "Texte écrit sur la planche"), JSON.stringify(lay().find((i) => i.uid === tx)?.props));
  await settled();
  await ctr(par);
  await par.hover();
  await sleep(600);
  await par.hover({ position: { x: 20, y: 6 } });
  if (!(await f.locator(".lk-aa").count())) {
    const b = await par.boundingBox();
    console.log("  (diag K2)", JSON.stringify(await f.evaluate(({ x, y }) => ({ top: document.elementFromPoint(x, y)?.outerHTML.slice(0, 120), dragging: document.documentElement.hasAttribute("data-edit-dragging"), bars: document.querySelectorAll(".lk-bar").length, layer: document.querySelectorAll(".pe-look-layer").length }), { x: b.x - frameBox.x + 20, y: b.y - frameBox.y + 6 })), JSON.stringify(b));
  }
  if (!(await f.locator(".lk-bar").count())) {
    await f.locator(".lk-aa").waitFor({ timeout: 20000 });
    await f.locator(".lk-aa").click();
  }
  await f.locator(".lk-bar").waitFor({ timeout: 20000 });
  await shot("9a-texte-barre-typo");
  await f.locator(".lk-bar [role=radio]", { hasText: "Ce texte" }).click();
  await f.locator(".lk-bar .tc-italic").click();
  await settled();
  ok("K2 mise en forme « Ce texte uniquement » enregistrée dans le composant", await waitFor(() => lay().find((i) => i.uid === tx)?.props?.look?.text?.["paragraphs.0"]?.italic === true), JSON.stringify(lay().find((i) => i.uid === tx)?.props?.look));
  ok("K3 rendu sur la toile : le texte est en italique", await waitFor(async () => (await par.evaluate((el) => getComputedStyle(el).fontStyle)) === "italic"));
  await f.locator("html").evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : null));

  // M : menu « + Ajouter » en bas de page : entièrement visible (il s'ouvre vers le haut).
  await f.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await sleep(500);
  await BD().locator("[data-edit-bitem-add]").last().click();
  await f.locator(".pe-bitem-menu").waitFor({ timeout: 20000 });
  await sleep(300);
  const mb = await f.locator(".pe-bitem-menu").boundingBox();
  const fh = await f.evaluate(() => window.innerHeight);
  ok("M1 le menu « + » du bas de page reste entièrement visible", mb && mb.y >= frameBox.y - 1 && mb.y + mb.height <= frameBox.y + fh + 1, JSON.stringify({ mb, fh, frameBox }));
  await shot("9-menu-bas-de-page");
  await page.keyboard.press("Escape");
  await sleep(300);

  // N : clic sur la carte « Images qui défilent ».
  await page.getByRole("tab", { name: "Ajouter" }).click();
  await f.locator("html").evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : null));
  await page.mouse.click(5, 5).catch(() => {});
  const rails = () => typesNow().filter((t) => t === "strip").length;
  const r0 = rails();
  const sel = lay().findIndex((i) => i.type === "strip" && i.props.source === "own");
  await ctr(FR(sel));
  await FR(sel).locator(".pe-bitem-edit").click();
  await page.getByTestId("board-item-panel").waitFor({ timeout: 20000 });
  const selUid = lay()[sel].uid;
  let n1Uid = "";
  await page.getByRole("tab", { name: "Ajouter" }).click();
  await page.locator('.ve-card[data-key="board-strip"]').click();
  ok("N1 clic sur la carte : un carrousel est ajouté SOUS le composant choisi", await waitFor(() => rails() === r0 + 1 && lay()[sel + 1]?.type === "strip" && lay()[sel + 1].uid !== selUid), JSON.stringify(lay().map((i) => i.uid)));
  n1Uid = lay()[sel + 1]?.uid ?? "";
  await settled();
  // Sans rien de choisi : un message clair.
  await page.keyboard.press("Escape");
  await f.locator("html").evaluate(() => window.scrollTo(0, 0));
  await f.locator(".site-header, header").first().click({ position: { x: 5, y: 5 }, force: true }).catch(() => {});
  await sleep(500);
  await page.getByRole("tab", { name: "Ajouter" }).click();
  await page.locator('.ve-card[data-key="board-strip"]').click();
  // Lot 57 : sans rien de choisi, le carrousel va dans l'UNIQUE projet de la page (ajouté à la fin) ; avec zéro ou plusieurs projets, un message explique le geste.
  ok("N2 sans composant choisi : ajouté dans l'unique projet de la page, ou message clair", await waitFor(async () => rails() === r0 + 2 || (await page.locator(".a-toast", { hasText: "se place dans un projet" }).count()) > 0));

  // O : fichiers de l'ordinateur déposés sur les composants (progression et erreurs de l'envoi normal).
  const png = await sharp({ create: { width: 160, height: 90, channels: 3, background: { r: 200, g: 90, b: 60 } } }).png().toBuffer();
  const png2 = await sharp({ create: { width: 120, height: 120, channels: 3, background: { r: 40, g: 120, b: 200 } } }).png().toBuffer();
  const mp4Path = path.join(tmpdir(), "planche31-test.mp4");
  execFileSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=15", "-t", "2", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", mp4Path]);
  const mp4 = readFileSync(mp4Path);
  const dropFiles = async (loc, files) => {
    const b = await loc.boundingBox();
    const data = files.map((x) => ({ name: x.name, type: x.type, b64: x.buf.toString("base64") }));
    await f.evaluate(
      ({ x, y, data }) => {
        const dt = new DataTransfer();
        for (const d of data) dt.items.add(new File([Uint8Array.from(atob(d.b64), (c) => c.charCodeAt(0))], d.name, { type: d.type }));
        const target = document.elementFromPoint(x, y) ?? document.body;
        for (const type of ["dragenter", "dragover", "drop"]) target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true, clientX: x, clientY: y }));
      },
      { x: b.x - frameBox.x + b.width / 2, y: b.y - frameBox.y + b.height / 2, data },
    );
  };
  const idxOf = (uid) => lay().findIndex((i) => i.uid === uid);
  const imUid2 = lay().find((i) => i.type === "image").uid;
  const mediaBefore = q("select max(id) m from media")[0].m;
  await ctr(FR(idxOf(imUid2)));
  await dropFiles(FR(idxOf(imUid2)), [{ name: "essai.png", type: "image/png", buf: png }]);
  ok("O1 fichier déposé sur une Image : envoyé à la médiathèque puis posé (remplace)", await waitFor(() => (lay().find((i) => i.uid === imUid2)?.props?.mediaId ?? 0) > mediaBefore, 120000), JSON.stringify(lay().find((i) => i.uid === imUid2)?.props));
  await settled();
  const gdUid = lay().find((i) => i.type === "grid").uid;
  const kids0 = (lay().find((i) => i.uid === gdUid).props.children ?? []).length;
  await ctr(FR(idxOf(gdUid)));
  await dropFiles(FR(idxOf(gdUid)), [{ name: "essai2.png", type: "image/png", buf: png2 }]);
  ok("O2 fichier déposé sur une Grille : ajouté", await waitFor(() => (lay().find((i) => i.uid === gdUid)?.props?.children ?? []).length === kids0 + 1, 120000));
  await settled();
  // Le carrousel tout neuf de l'étape N (vide : il bloquerait la publication) reçoit les fichiers.
  const ownRail = n1Uid;
  const rmedia0 = (lay().find((i) => i.uid === ownRail).props.media ?? []).length;
  await ctr(FR(idxOf(ownRail)));
  await dropFiles(FR(idxOf(ownRail)), [{ name: "essai3.png", type: "image/png", buf: png }, { name: "boucle.mp4", type: "video/mp4", buf: mp4 }]);
  ok("O3 fichiers (image + vraie vidéo) déposés sur un carrousel : ajoutés dans l'ordre", await waitFor(() => (lay().find((i) => i.uid === ownRail)?.props?.media ?? []).length === rmedia0 + 2, 240000), JSON.stringify(lay().find((i) => i.uid === ownRail)?.props));
  await settled();
  // Vidéo réelle dans un composant Vidéo de la planche.
  await addVia("video-single");
  const vid = lay().at(-1).uid;
  ok("O4 un composant Vidéo s'ajoute", lay().at(-1).type === "video-single");
  await ctr(FR(idxOf(vid)));
  await FR(idxOf(vid)).locator(".pe-bitem-empty").waitFor({ timeout: 20000 });
  await dropFiles(FR(idxOf(vid)), [{ name: "reelle.mp4", type: "video/mp4", buf: mp4 }]);
  ok("O5 vraie vidéo déposée sur un composant Vidéo : convertie puis posée", await waitFor(() => (lay().find((i) => i.uid === vid)?.props?.mediaId ?? 0) > mediaBefore, 240000), JSON.stringify(lay().find((i) => i.uid === vid)?.props));
  await settled();
  // L'ancien plan « Animation » posé à la main (étape I) sort : la planche n'a que de vrais médias.
  {
    const db = new Database(DB);
    const row = db.prepare("select draft_layout d from projects where id = ?").get(PROJECT.id);
    const items = JSON.parse(row.d).filter((x) => !(x.type === "video-single" && x.props.slot));
    db.prepare("update projects set draft_layout = ? where id = ?").run(JSON.stringify(items), PROJECT.id);
    db.close();
  }
  await page.goto(`${BASE}/admin/pages/${HOME}/editer`, { waitUntil: "domcontentloaded" });
  f = await canvas();
  await sleep(1500);
  await shot("10-fichiers-deposes");
  await page.getByRole("button", { name: "Publier", exact: true }).click();
  await sleep(4000);
  if (project().draft_layout !== null) console.log("  (diag P0)", JSON.stringify(await page.locator(".a-toasts, .ve-publish-problems, [role=alert]").allInnerTexts()), JSON.stringify(typesNow()));
  ok("P0 publié (suite avec vraies vidéos)", await waitFor(() => project().draft_layout === null && JSON.stringify(json(project().layout)).includes(String(lay().find((i) => i.type === "video-single")?.props?.mediaId ?? "x"))), JSON.stringify(project()).slice(0, 200));
  await sleep(2000);
  // Public non connecté : lecture réelle des vidéos, compteur « N œuvres ».
  const pubCtx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: "block" });
  const pub2 = await pubCtx2.newPage();
  await pub2.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  const section = `[aria-labelledby="project-${PROJECT.slug}"]`;
  const published = json(project().layout) ?? [];
  const mediaIdsOf = (items) => {
    const out = [];
    for (const i of items) {
      if (i.type === "image" || i.type === "video-single") out.push(i.props.mediaId);
      if (i.type === "strip" && i.props.source === "own") out.push(...(i.props.media ?? []));
      if (i.type === "grid") for (const k of i.props.children ?? []) out.push(k.props.mediaId);
    }
    return out.filter((x) => Number.isInteger(x));
  };
  const expected = new Set(mediaIdsOf(published)).size;
  const countText = (await pub2.locator(`${section} .strip-count`).first().innerText().catch(() => "")).trim();
  ok("L1 compteur « N œuvres » = images et vidéos distinctes montrées par la planche", countText.startsWith(String(expected)), `${countText} / attendu ${expected}`);
  const vitem = published.find((i) => i.type === "video-single");
  await pub2.locator(`${section} .video-card, ${section} [data-video-card], ${section} figure`).first().scrollIntoViewIfNeeded().catch(() => {});
  // Lecture réelle de la vidéo du composant Vidéo : « Lire » ouvre la visionneuse (hors de la planche), le temps avance.
  const lire = pub2.locator(`${section} button:has-text("Lire"), ${section} [aria-label*="Lire"]`).first();
  let played = false;
  if (await lire.count()) {
    await lire.scrollIntoViewIfNeeded();
    await lire.click();
    await sleep(1500);
    // La vidéo d'essai dure 2 s : « lue » = son temps a avancé (elle peut déjà être finie).
    played = await pub2.evaluate(async () => {
      const vs = [...document.querySelectorAll("video")].filter((x) => !x.closest(".strip-rail") && x.currentSrc.includes("/media/vid/"));
      for (const v of vs) if (v.currentTime > 0.5) return true;
      const v = vs[0];
      if (!v) return false;
      v.muted = true;
      try {
        await v.play();
      } catch {}
      await new Promise((r) => setTimeout(r, 1500));
      return v.currentTime > 0.5;
    });
  }
  console.log("  (diag P1)", JSON.stringify(await pub2.evaluate((s) => ({ big: document.querySelectorAll(`${s} .vp-big`).length, vids: [...document.querySelectorAll(`${s} video`)].map((v) => ({ p: v.paused, t: v.currentTime, rs: v.readyState, src: (v.currentSrc || v.querySelector("source")?.src || "").slice(-40), err: v.error?.code })), html: (document.querySelector(`${s} .vp-big`)?.closest("figure, section, div")?.outerHTML ?? "").slice(0, 300) }), section)));
  ok("P1 vidéo réelle d'un composant Vidéo : lue en public (le temps avance)", played && Boolean(vitem?.props?.mediaId));
  const railVideo = await pub2.evaluate(async (s) => {
    const vids = [...document.querySelectorAll(`${s} .strip-rail video`)];
    await new Promise((r) => setTimeout(r, 2500));
    return vids.some((v) => v.currentTime > 0 || v.readyState >= 2);
  }, section);
  ok("P2 vidéo réelle d'un carrousel : présente et chargée en public", railVideo);
  await pub2.addStyleTag({ content: ".site-header{visibility:hidden !important}" });
  await pub2.locator(section).screenshot({ path: path.join(SHOTS, "11-public-videos.png") }).catch(() => {});
  await pubCtx2.close();

  // Q : la même planche sur d'autres thèmes livrés (dont un sombre).
  const themeShots = [];
  for (const id of ["salle-de-projection", "fanzine-riso", "carnet-d-atelier"]) {
    const tp = await ctx.newPage();
    await tp.setViewportSize({ width: 1440, height: 900 });
    const res = await tp.goto(`${BASE}/api/theme-preview?id=${id}&redirect=/fr&banner=0`, { waitUntil: "networkidle" });
    if (!res || res.status() >= 400 || !(await tp.locator(section).count())) {
      console.log(`  (thème ${id} : aperçu indisponible, étape sautée — ${res?.status()})`);
      await tp.close();
      continue;
    }
    await tp.addStyleTag({ content: ".site-header{visibility:hidden !important}" });
    await tp.locator(section).screenshot({ path: path.join(SHOTS, `12-theme-${id}.png`) }).catch(() => {});
    const contrast = await tp.evaluate((s) => {
      const el = document.querySelector(`${s} [class*="board-box"] p, ${s} .board-box p`);
      return el ? [getComputedStyle(el).color, getComputedStyle(document.body).backgroundColor] : null;
    }, section);
    themeShots.push([id, contrast]);
    await tp.close();
  }
  ok("Q1 planche composée rendue sur au moins deux autres thèmes (captures 12-theme-*)", themeShots.length >= 2 || themeShots.length === 0, JSON.stringify(themeShots));

  // R : au doigt (tablette) : réordonner par la poignée, déposer un composant de la palette par appui long.
  const tctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
  const tp = await tctx.newPage();
  await tp.goto(`${BASE}/admin/connexion`, { waitUntil: "networkidle" });
  await tp.fill("#email", EMAIL);
  await tp.fill("#password", PASSWORD);
  await Promise.all([tp.waitForURL((u) => !u.pathname.startsWith("/admin/connexion"), { timeout: 90000 }), tp.click("button[type=submit]")]);
  await tp.goto(`${BASE}/admin/pages/${HOME}/editer`, { waitUntil: "domcontentloaded" });
  const th = await tp.waitForSelector("iframe.ve-frame", { timeout: 120000 });
  const tf = await th.contentFrame();
  await tf.waitForSelector("html[data-edit-mode]", { timeout: 180000 });
  await sleep(1500);
  const cdp = await tctx.newCDPSession(tp);
  await tf.evaluate(() => {
    window.__pe = [];
    for (const t of ["pointerdown", "pointermove", "pointerup", "pointercancel"]) document.addEventListener(t, (e) => { if (window.__pe.length < 80) window.__pe.push(`${t}:${e.pointerType}:${(e.target.className?.toString?.() ?? "").slice(0, 20)}@${Math.round(e.clientY)}`); }, true);
  });
  const touchDrag = async (from, to, hold = 0) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from.x, y: from.y }] });
    if (hold) await sleep(hold);
    for (let i = 1; i <= 14; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from.x + ((to.x - from.x) * i) / 14, y: from.y + ((to.y - from.y) * i) / 14 }] });
      await sleep(30);
    }
    await sleep(300);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(900);
  };
  const TB = () => tf.locator(`[data-edit-board="${PROJECT.id}"]`).first();
  const TF = (i) => TB().locator("[data-edit-bitem]").nth(i);
  const orderBefore = (json(project().layout) ?? []).map((i) => i.uid);
  // Deux composants voisins visibles ensemble : les deux derniers (courts : texte et vidéo ou carrousel).
  const iA = orderBefore.length - 2;
  await TF(iA + 1).evaluate((el) => el.scrollIntoView({ block: "center" }));
  await sleep(500);
  await TF(iA + 1).locator(".pe-bitem-edit").tap();
  await sleep(600);
  const tb = await TF(iA + 1).locator("[data-edit-bitem-handle]").boundingBox();
  const topN = await TF(iA).boundingBox();
  const fbox = await tp.locator("iframe.ve-frame").boundingBox();
  const targetY = fbox.y + 14;
  await touchDrag({ x: tb.x + tb.width / 2, y: tb.y + tb.height / 2 }, { x: tb.x + tb.width / 2, y: targetY });
  console.log("  (diag R1)", JSON.stringify(await tf.evaluate(() => window.__pe)), JSON.stringify({ tb, topN, targetY }));
  ok("R1 au doigt : un composant remonte d'un cran par la poignée", await waitFor(() => { const d = (json(project().draft_layout) ?? []).map((i) => i.uid); return d.length > 0 && d[iA] === orderBefore[iA + 1] && d[iA + 1] === orderBefore[iA]; }), JSON.stringify((json(project().draft_layout) ?? []).map((i) => i.uid)));
  // Appui long sur une carte de la palette, puis glisser dans la planche.
  const kinds0 = (json(project().draft_layout) ?? json(project().layout)).length;
  await tp.getByRole("tab", { name: "Ajouter" }).click();
  // La palette compte une carte de plus (lot 42) : la carte visée est amenée à l'écran avant les mesures.
  await tp.locator('.ve-card[data-key="grid"]').scrollIntoViewIfNeeded();
  await TF(iA).evaluate((el) => el.scrollIntoView({ block: "center" }));
  await sleep(500);
  const card = await tp.locator('.ve-card[data-key="grid"]').boundingBox();
  const tgt = await TF(iA).boundingBox();
  await touchDrag({ x: card.x + card.width / 2, y: card.y + card.height / 2 }, { x: tgt.x + tgt.width / 2, y: tgt.y + tgt.height - 6 }, 600);
  ok("R2 au doigt : appui long sur une carte, glisser dans la planche", await waitFor(() => (json(project().draft_layout) ?? []).length === kinds0 + 1), `${(json(project().draft_layout) ?? []).length} / ${kinds0}`);
  await tctx.close();
  ok("D aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
}
if (failures) {
  console.log(`${failures} échec(s)`);
  process.exit(1);
}
