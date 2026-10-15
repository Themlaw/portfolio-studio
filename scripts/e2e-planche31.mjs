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
  ok("B2 menu court : 5 composants, bande grisée (déjà là)", (await f.locator(".pe-bitem-menu button").count()) === 5 && (await f.locator('.pe-bitem-menu [data-bitem-type="strip"]').isDisabled()));
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
  await board.locator('[data-edit-bitem-type="strip"]').hover();
  await board.locator('[data-edit-bitem-type="strip"] [data-edit-bitem-op="remove"]').click();
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
  ok("D aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
}
if (failures) {
  console.log(`${failures} échec(s)`);
  process.exit(1);
}
