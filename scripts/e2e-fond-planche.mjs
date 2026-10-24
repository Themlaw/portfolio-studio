#!/usr/bin/env node
/**
 * Fond de couleur des composants d'une planche composée (v0.24, lots 31 × 32), UN chromium. Serveur requis, base NEUVE (seed).
 *
 *  A. Barre de chaque composant (bande des images du projet comprise) : bouton « Fond » ; la fenêtre pose `props.background`
 *     sur le composant (écriture de planche `item-fond`, brouillon du projet, publié intact).
 *  B. Deux composants (et la bande) de même couleur : enveloppes bord à bord de la planche, fusionnées (data-join-*).
 *  C. Publication : même rendu en public, aucun repère d'édition ; « Aucun » retire le fond ; Annuler le rétablit.
 * Captures : $SHOTS (défaut screenshots/fond-planche).
 * Usage : DATA_DIR=… ADMIN_EMAIL=… ADMIN_PASSWORD=… BASE=http://localhost:3410 node scripts/e2e-fond-planche.mjs
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";

import { pageIdOf, placeBoard } from "./lib/page-board.mjs";
import { autoOpenFine } from "./lib/zone66.mjs";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const DATA = process.env.DATA_DIR ?? "data";
const DB = path.join(DATA, "portfolio.db");
const SHOTS = process.env.SHOTS ?? "screenshots/fond-planche";
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
const PROJECT = q("select id, slug from projects order by position limit 1")[0];
const project = () => q("select layout, draft_layout, draft_layout_page_id from projects where id = ?", PROJECT.id)[0];
const json = (s) => (s ? JSON.parse(s) : null);
const draft = () => json(project().draft_layout) ?? [];
const published = () => json(project().layout) ?? [];
const bgOf = (items, i) => items[i]?.props?.background;
const publicHtml = async (p) => (await fetch(`${BASE}${p}`)).text();
const boardHtml = (html) => {
  const i = html.indexOf(`aria-labelledby="project-${PROJECT.slug}"`);
  if (i < 0) return "";
  const next = html.indexOf('<section class="strip', i + 10);
  return html.slice(i, next < 0 ? i + 60000 : next);
};

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await autoOpenFine(ctx);
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
  const placed = await placeBoard(page, BASE, HOME, PROJECT.slug);
  ok("0 planche posée sur l'accueil", placed);

  await page.goto(`${BASE}/admin/pages/${HOME}/editer`, { waitUntil: "domcontentloaded" });
  let f = await canvas();
  await sleep(1500);
  const board = f.locator(`[data-edit-board="${PROJECT.id}"]`).first();
  await board.scrollIntoViewIfNeeded();
  // Deux images dans la planche, sous la bande : strip, image, image.
  for (const index of [1, 2]) {
    await board.locator(`[data-edit-bitem-add="${index}"]`).click({ force: true });
    // Le menu s'ancre au bouton (Popover, lot 65) : on lui laisse le temps de se poser avant de viser un choix.
    await sleep(800);
    await f.locator('.pe-bitem-menu [data-bitem-type="image"]').click();
    ok(`0 image ajoutée au rang ${index + 1}`, await waitFor(() => draft().length === index + 1 && draft()[index]?.type === "image"), JSON.stringify(draft().map((i) => i.type)));
    await page.getByRole("button", { name: "Choisir une image" }).first().click();
    await page.locator(".a-picker-scroll button").nth(index).click();
    await waitFor(() => draft()[index]?.props?.mediaId > 0);
    await settled();
  }
  const frames = board.locator("[data-edit-bitem]");
  ok("A0 trois composants : bande, image, image", (await frames.count()) === 3);

  /** Ouvre la fenêtre « Fond » d'un composant (barre) et choisit la nature « Couleur » (couleur de départ du thème). */
  async function setFond(i) {
    const fr = frames.nth(i);
    await fr.scrollIntoViewIfNeeded();
    await fr.hover();
    const btn = fr.locator('[data-edit-bitem-op="fond"]');
    ok(`A1 composant ${i + 1} : bouton « Fond » dans sa barre`, (await btn.count()) === 1);
    await btn.click();
    const menu = f.locator('[data-testid="fond-menu"]');
    await menu.waitFor({ timeout: 20000 });
    return menu;
  }
  for (const i of [1, 2, 0]) {
    const menu = await setFond(i);
    await menu.locator('[data-kind="color"]').click();
    ok(`A2 composant ${i + 1} : fond enregistré dans le brouillon du projet`, await waitFor(() => bgOf(draft(), i)?.kind === "color" && bgOf(draft(), i)?.color === "bgDeep"), JSON.stringify(draft()[i]?.props));
    await page.keyboard.press("Escape");
    await settled();
  }
  ok("A3 publié intact (aucun fond)", published().every((i) => !i.props?.background));
  ok("A4 la bande des images du projet reste la bande du projet (props sans `source`)", draft()[0].type === "strip" && draft()[0].props.source === undefined);

  /* ---- B. Enveloppes et fusion sur la toile ---- */
  const geo = () =>
    f.evaluate((id) => {
      const sect = document.querySelector(`[data-edit-board="${id}"]`);
      const s = sect.getBoundingClientRect();
      return [...sect.querySelectorAll("[data-edit-bitem]")].map((fr) => {
        const w = fr.querySelector(".fond-bloc");
        const r = w?.getBoundingClientRect();
        return {
          wrap: Boolean(w),
          on: w?.getAttribute("data-fond"),
          prev: w?.hasAttribute("data-join-prev"),
          next: w?.hasAttribute("data-join-next"),
          bg: w ? getComputedStyle(w).backgroundColor : null,
          left: r ? Math.abs(r.left - s.left) : null,
          right: r ? Math.abs(r.right - s.right) : null,
          pb: w ? parseFloat(getComputedStyle(w).paddingBottom) : null,
        };
      });
    }, PROJECT.id);
  const ready = await waitFor(async () => (await geo()).every((g) => g.on === "on"));
  const g = await geo();
  ok("B1 les trois composants ont leur fond (enveloppe `.fond-bloc`)", ready && g.length === 3, JSON.stringify(g));
  ok("B2 fond bord à bord de la planche (aucune marge latérale)", g.every((x) => x.left < 1.5 && x.right < 1.5), JSON.stringify(g.map((x) => [x.left, x.right])));
  ok("B3 même couleur : fusion de proche en proche (premier : suivant ; milieu : les deux ; dernier : précédent)", !g[0].prev && g[0].next && g[1].prev && g[1].next && g[2].prev && !g[2].next, JSON.stringify(g.map((x) => [x.prev, x.next])));
  ok("B4 composants fusionnés : pas d'espace de fond sous les deux premiers", g[0].pb === 0 && g[1].pb === 0 && g[2].pb > 0, JSON.stringify(g.map((x) => x.pb)));
  ok("B5 même couleur de fond sur les trois", g[0].bg === g[1].bg && g[1].bg === g[2].bg && g[0].bg !== "rgba(0, 0, 0, 0)", JSON.stringify(g.map((x) => x.bg)));
  await board.scrollIntoViewIfNeeded();
  await shot("1-toile-fond-planche");

  /* ---- C. Publication, retrait, Annuler ---- */
  await page.getByRole("button", { name: "Publier", exact: true }).click();
  ok("C1 publié : fonds dans la suite du projet", await waitFor(() => [0, 1, 2].every((i) => bgOf(published(), i)?.color === "bgDeep") && project().draft_layout === null), JSON.stringify(project()));
  await sleep(1500);
  const html = boardHtml(await publicHtml("/fr"));
  ok("C2 public : trois enveloppes de fond dans la planche, fusionnées, sans repère d'édition", (html.match(/class="zone fond-bloc"/g) ?? []).length === 3 && (html.match(/data-join-next/g) ?? []).length === 2 && (html.match(/data-join-prev/g) ?? []).length === 2 && !html.includes("data-edit-") && !html.includes("pe-bitem"), `${(html.match(/class="zone fond-bloc"/g) ?? []).length} enveloppes`);
  const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ap = await anon.newPage();
  await ap.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  const pg = await ap.evaluate((slug) => {
    const sect = document.querySelector(`[aria-labelledby="project-${slug}"]`);
    const s = sect.getBoundingClientRect();
    return [...sect.querySelectorAll(".fond-bloc")].map((w) => {
      const r = w.getBoundingClientRect();
      return { l: Math.abs(r.left - s.left), r: Math.abs(r.right - s.right), bg: getComputedStyle(w).backgroundColor, h: r.height };
    });
  }, PROJECT.slug);
  ok("C3 public : bord à bord, couleur appliquée, hauteur non nulle", pg.length === 3 && pg.every((x) => x.l < 1.5 && x.r < 1.5 && x.bg !== "rgba(0, 0, 0, 0)" && x.h > 40), JSON.stringify(pg));
  await ap.locator(`[aria-labelledby="project-${PROJECT.slug}"]`).screenshot({ path: path.join(SHOTS, "2-public-fond-planche.png") }).catch(() => {});
  await anon.close();

  // « Aucun » sur le composant du milieu : plus de fond, ses voisins ne fusionnent plus avec lui.
  f = await canvas();
  const board3 = f.locator(`[data-edit-board="${PROJECT.id}"]`).first();
  const fr1 = board3.locator("[data-edit-bitem]").nth(1);
  await fr1.scrollIntoViewIfNeeded();
  await fr1.hover();
  await fr1.locator('[data-edit-bitem-op="fond"]').click();
  const menu = f.locator('[data-testid="fond-menu"]');
  await menu.waitFor({ timeout: 20000 });
  ok("C4 la fenêtre montre la couleur actuelle (nature « Couleur » cochée)", (await menu.locator('[data-kind="color"]').getAttribute("aria-checked")) === "true");
  await menu.locator('[data-kind="none"]').click();
  ok("C5 « Aucun » : `background` retiré du brouillon", await waitFor(() => draft().length === 3 && bgOf(draft(), 1) === undefined && bgOf(draft(), 0) !== undefined), JSON.stringify(draft().map((i) => i.props?.background)));
  await page.keyboard.press("Escape");
  await settled();
  const g2 = await geo();
  ok("C6 plus de fusion autour du composant sans fond", g2[0].on === "on" && !g2[0].next && g2[2].on === "on" && !g2[2].prev, JSON.stringify(g2.map((x) => [x.on, x.prev, x.next])));
  await page.keyboard.press("Control+z");
  // Revenu à la suite publiée, le brouillon du projet n'a plus de raison d'être (surcouche vidée) : on lit la suite effective.
  const effective = () => json(project().draft_layout) ?? published();
  ok("C7 Annuler : le fond revient (Annuler / Rétablir de la planche)", await waitFor(() => bgOf(effective(), 1)?.color === "bgDeep"), JSON.stringify(effective().map((i) => i.props?.background)));
  await settled();
  // Capture : une couleur bien visible sur la bande et le premier composant (fusionnés), le troisième garde le fond du thème.
  for (const i of [0, 1]) {
    const fr = board3.locator("[data-edit-bitem]").nth(i);
    await fr.scrollIntoViewIfNeeded();
    await fr.hover();
    await fr.locator('[data-edit-bitem-op="fond"]').click();
    await f.locator('[data-testid="fond-menu"]').waitFor({ timeout: 20000 });
    await f.locator('[data-testid="fond-menu"] [aria-label="Couleur du fond"] [data-token="primary"]').first().click();
    ok(`E1 composant ${i + 1} : couleur forte enregistrée`, await waitFor(() => bgOf(effective(), i)?.color === "primary"), JSON.stringify(effective()[i]?.props?.background));
    await page.keyboard.press("Escape");
    await settled();
  }
  await board3.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await sleep(600);
  await shot("3-couleur-forte-toile");
  /* ---- F. Cadre autour de la photo d'un composant Image de la planche (lot 34), sur un fond de couleur ---- */
  const lookFrame = (i) => effective()[i]?.props?.look?.frame;
  const fr0 = board3.locator("[data-edit-bitem]").nth(0);
  ok("F0 la bande n'a pas de bouton « Cadre » (seules les images en ont un)", (await fr0.locator('[data-edit-bitem-op="frame"]').count()) === 0);
  const imgFrame = board3.locator("[data-edit-bitem]").nth(1);
  await imgFrame.scrollIntoViewIfNeeded();
  await imgFrame.hover();
  await imgFrame.locator('[data-edit-bitem-op="frame"]').click();
  const fmenu = f.locator('[data-testid="frame-menu"]');
  await fmenu.waitFor({ timeout: 20000 });
  await fmenu.locator('[data-frame-kind="band"]').click();
  ok("F1 cadre posé : `props.look.frame = { kind: band, width: moyen }` dans la suite du projet", await waitFor(() => lookFrame(1)?.kind === "band" && lookFrame(1)?.width === "moyen"), JSON.stringify(effective()[1]?.props));
  await fmenu.locator('[data-frame-width="epais"]').click();
  ok("F2 Épais enregistré", await waitFor(() => lookFrame(1)?.width === "epais"), JSON.stringify(lookFrame(1)));
  await page.keyboard.press("Escape");
  await settled();
  const fm = () =>
    f.evaluate((id) => {
      const fr = document.querySelectorAll(`[data-edit-board="${id}"] [data-edit-bitem]`)[1];
      // Lot 64 : le cadre est posé sur la boîte du média (MediaFrame).
      const fig = fr?.querySelector("figure .media-frame[data-frame]");
      const media = fig;
      const wrap = fr?.querySelector(".fond-bloc");
      if (!fig || !media || !wrap) return null;
      const cs = getComputedStyle(media);
      const mr = media.getBoundingClientRect();
      const wr = wrap.getBoundingClientRect();
      return { bw: parseFloat(cs.borderTopWidth), color: cs.borderTopColor, ink: getComputedStyle(wrap).color, mw: mr.width, ww: wr.width };
    }, PROJECT.id);
  let m = null;
  ok("F3 toile : bordure Épais autour de l'image, couleur par défaut = encre lisible du fond (pas celle du thème, illisible sur fond fort)", await waitFor(async () => { m = await fm(); return m && m.bw >= 5 && m.color === m.ink; }), JSON.stringify(m));
  // Largeur réduite (préréglage « Petite », 33 %) : le cadre reste autour de l'IMAGE (la colonne), jamais autour du fond ni de la planche.
  await imgFrame.locator('[data-edit-bitem-op="settings"]').click();
  await page.locator('[data-testid="board-item-panel"] [data-preset="small"]').click();
  ok("F4a largeur Petite enregistrée (33 %)", await waitFor(() => effective()[1]?.box?.width === 33), JSON.stringify(effective()[1]?.box));
  await settled();
  ok("F4 le cadre entoure l'image réduite, pas la colonne ni le fond : image plus étroite que le fond, bordure toujours là", await waitFor(async () => { m = await fm(); return m && m.bw >= 5 && m.mw < m.ww * 0.5; }), JSON.stringify(m));
  await shot("4-cadre-image-planche");
  // Historique de la planche : largeur Petite, Épais, Moyen (cadre posé) : trois Annuler remettent l'image comme au départ.
  await page.keyboard.press("Control+z");
  ok("F5 Annuler : la largeur Petite disparaît, le cadre Épais reste", await waitFor(() => effective()[1]?.box === undefined && lookFrame(1)?.width === "epais"), JSON.stringify([effective()[1]?.box, lookFrame(1)]));
  await page.keyboard.press("Control+z");
  ok("F5b Annuler : cadre Moyen", await waitFor(() => lookFrame(1)?.width === "moyen"), JSON.stringify(lookFrame(1)));
  await page.keyboard.press("Control+z");
  ok("F5c Annuler : plus de cadre (Annuler / Rétablir de la planche)", await waitFor(() => lookFrame(1) === undefined), JSON.stringify(lookFrame(1)));
  await settled();
  /* ---- G. Flèches de la bande dans une planche composée, sur la toile (lot 33) : elles font défiler, sans rien sélectionner ---- */
  const rail0 = board3.locator("[data-edit-bitem]").nth(0).locator(".strip-rail").first();
  await rail0.scrollIntoViewIfNeeded();
  const before = await rail0.evaluate((r) => r.scrollLeft);
  const next = board3.locator("[data-edit-bitem]").nth(0).locator(".strip-nav-next").first();
  await next.waitFor({ timeout: 20000 });
  await next.hover();
  await next.click();
  ok("G1 la flèche « suivante » de la bande fait défiler sur la toile", await waitFor(async () => (await rail0.evaluate((r) => r.scrollLeft)) > before + 20, 15000), `${before} → ${await rail0.evaluate((r) => r.scrollLeft)}`);
  ok("G2 le clic sur la flèche ne choisit aucun composant (pas de panneau de réglages ouvert pour la bande)", (await board3.locator("[data-edit-bitem][data-selected]").count()) <= 1);
  await shot("5-fleches-planche-composee");
  ok("D aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
}
if (failures) {
  console.log(`${failures} échec(s)`);
  process.exit(1);
}
