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

import Database from "better-sqlite3";
import { chromium } from "playwright";

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
  ok("B2 menu court : 5 composants, carrousels à volonté (pas de « Images du projet » : la bande est là)", (await f.locator(".pe-bitem-menu button").count()) === 5 && (await f.locator('.pe-bitem-menu [data-bitem-type="strip"]').isEnabled()));
  await shot("2-menu");
  await f.locator('.pe-bitem-menu [data-bitem-type="grid"]').click();
  await sleep(2500);
  console.log("TOASTS:", JSON.stringify(await page.locator(".a-toasts").innerText().catch(() => "?")), "status:", await page.locator(".ve-status").innerText().catch(() => "?"));
  await shot("2b-apres-grille");
  ok("B3 grille ajoutée sous la bande (brouillon)", await waitFor(() => JSON.stringify(draftTypes()) === '["strip","grid"]'), JSON.stringify(draftTypes()));
  ok("B3b publié intact", JSON.stringify(publicTypes()) === '["strip"]');
  await page.getByTestId("board-item-panel").waitFor({ timeout: 30000 });
  // Image dans la grille, depuis la médiathèque.
  await page.getByTestId("board-grid-add-image").click();
  await page.getByRole("button", { name: "Choisir une image" }).first().click();
  await page.locator(".a-picker-scroll button").first().click();
  await page.getByRole("button", { name: "Utiliser cette image" }).click();
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
  await page.getByRole("button", { name: "Utiliser cette image" }).click();
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
  async function drag(from, x, y, during) {
    const b = await from.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 12, b.y + b.height / 2 + 12, { steps: 3 });
    await page.mouse.move(x, y, { steps: 14 });
    await sleep(500);
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
  });
  ok("E1 glisser une Grille entre deux composants de la planche", await waitFor(() => JSON.stringify(typesOf()) === '["grid","grid","image"]'), JSON.stringify(typesOf()));
  ok("E1b repère « Déposer ici » dans la planche pendant le glisser", markerSeen);
  await settled();
  await page.getByRole("tab", { name: "Ajouter" }).click();
  await center(frame(2));
  const f2 = await frame(2).boundingBox();
  await drag(page.locator('.ve-card[data-key="board-strip"]'), f2.x + f2.width / 2, f2.y + f2.height - 4);
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
  await drag(li(1), fr.x + fr.width / 2, fr.y + fr.height / 2);
  ok("F1 un média glissé sur une Image la remplace", await waitFor(() => byUid(imUid)?.props?.mediaId === B), JSON.stringify(byUid(imUid)?.props));
  await settled();
  const rail1 = layout()[3].uid;
  await page.getByRole("tab", { name: "Médias" }).click();
  await center(frame(3));
  fr = await frame(3).boundingBox();
  await drag(li(0), fr.x + fr.width / 2, fr.y + fr.height / 2);
  ok("F2 un média glissé sur un carrousel l'ajoute", await waitFor(() => JSON.stringify(byUid(rail1)?.props?.media) === JSON.stringify([A])), JSON.stringify(byUid(rail1)?.props));
  await settled();
  const g2 = layout()[1].uid;
  await page.getByRole("tab", { name: "Médias" }).click();
  await center(frame(1));
  fr = await frame(1).boundingBox();
  await drag(li(2), fr.x + fr.width / 2, fr.y + fr.height / 2);
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
  await drag(li(1), fr.x + fr.width / 2, fr.y + fr.height / 2);
  await settled();
  await center(frame(4));
  fr = await frame(4).boundingBox();
  await drag(li(2), fr.x + fr.width / 2, fr.y + fr.height / 2);
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
  ok("D aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
}
if (failures) {
  console.log(`${failures} échec(s)`);
  process.exit(1);
}
