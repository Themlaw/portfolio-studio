#!/usr/bin/env node
/**
 * Le Fond ne rétrécit plus le contenu (lot 47, ticket 32), UN chromium. Serveur requis, base NEUVE (seed), une connexion.
 * Page « personnages » : cinq grilles de trois images (sans fond / fond bord à bord / marge M / marge M + coins M / marge L + coins L),
 * puis une grille avec une carte (reglage « Carte ») ; la planche d'un projet porte les cinq mêmes grilles.
 *
 *  A. Public, 1440 px : la largeur et la position horizontale de chaque image sont celles de la grille sans fond (1 px près) ;
 *     même chose à 1024 px et à 390 px (marge reduite) ; pas de défilement horizontal.
 *  B. Toile (éditeur) : mêmes mesures que le public, page et planche ; aperçu immédiat : poser « Avec marge » depuis la fenêtre ne change
 *     ni la largeur ni la place des images.
 *  C. La fenêtre « Fond » d'une grille de page et celle d'une grille de planche sont la même (mêmes libellés, mêmes pictogrammes).
 * Captures : $SHOTS. Mode DIAG=1 : affiche les mesures sans compter d'échec.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import { chromium } from "playwright";

import { boardDraft, boardPublished, draftBlocks, grid, img, login, makeMedia, openEditor, pageIdOf, q1, settled, setBoardDraft, sql, waitFor } from "./lib/grille31d.mjs";
import { publishBlocks } from "./lib/page-draft.mjs";

const BASE = process.env.BASE ?? "http://localhost:3600";
const SHOTS = process.env.SHOTS ?? "screenshots/fond-contenu47";
const DIAG = process.env.DIAG === "1";
mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond && !DIAG) failures++;
  console.log(`${cond ? "PASS" : DIAG ? "DIAG-FAIL" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);
const M = await makeMedia(page, BASE);
const pageId = pageIdOf("personnages");
const project = q1("select id, slug from projects order by id limit 1");

const VARIANTS = [
  ["sans", undefined],
  ["fond", { kind: "color", color: "ink" }],
  ["marge", { kind: "color", color: "ink", inset: "m" }],
  ["marge-coins", { kind: "color", color: "ink", inset: "m", round: "m" }],
  ["grand", { kind: "color", color: "ink", inset: "l", round: "l" }],
];
const kids = (p) => [img(`${p}1`, M.portrait), img(`${p}2`, M.paysage), img(`${p}3`, M.carre)];
const pageGrids = VARIANTS.map(([n, bg], i) => grid(`pg${i}`, { layout: "3", ...(bg ? { background: bg } : {}) }, kids(`p${i}`)));
// Les grilles de planche (composants du projet) portent le fond dans `props.background`.
const boardItems = VARIANTS.map(([, bg], i) => ({ uid: `bg${i}`, type: "grid", props: { layout: "3", gap: "normal", align: "stretch", ratio: "auto", top: "gap", ...(bg ? { background: bg } : {}), children: kids(`b${i}`) } }));
// Planche libre (lot 42) : sans fond / marge L + coins, en page puis en planche.
const free = (bg) => ({ format: "3:2", phone: "scale", ...(bg ? { background: bg } : {}), items: [{ id: "a1", media: M.carre, x: 10, y: 10, w: 30 }, { id: "a2", media: M.paysage, x: 50, y: 30, w: 40 }] });
const FREE_BG = { kind: "color", color: "ink", inset: "l", round: "l" };
// Cartes (lot 47b) : une ancienne carte « En retrait + arrondi » (réglages par défaut), Moyen, coins droits, et une carte portant un fond (avec marge).
const CARDS = [
  ["carte", {}],
  ["carte-moyen", { surface: { width: "inset", corners: "m" } }],
  ["carte-droite", { surface: { width: "inset", corners: "square" } }],
  ["carte-bordure", { surface: { width: "inset", corners: "l", border: { width: "thick" } } }],
  ["carte+fond", { surface: { color: "surface" }, background: { kind: "color", color: "ink", inset: "m", round: "s" } }],
];
const cardGrids = CARDS.map(([n, extra], i) => grid(`pgc${i}`, { layout: "3", ...(n === "carte" ? { surface: {} } : extra) }, kids(`pc${i}`)));

boardItems.push({ uid: "bf0", type: "free-board", props: free() }, { uid: "bf1", type: "free-board", props: free(FREE_BG) });
sql((db) => { db.prepare("update pages set draft = NULL, draft_rev = 0 where id = ?").run(pageId); db.prepare("update projects set draft_layout = NULL, draft_layout_page_id = NULL where id = ?").run(project.id); });
setBoardDraft(project.id, pageId, boardItems);
const published = () => q1("select count(*) n from blocks where page_id = ? and props like '%\"corners\":\"m\"%'", pageId).n === 1 && boardPublished(project.id)?.length === boardItems.length && q1("select count(*) n from blocks where page_id = ?", pageId).n === pageGrids.length + cardGrids.length + 3 && boardPublished(project.id)?.[1]?.props?.background?.color === VARIANTS[1][1].color;
let done = await publishBlocks(page, BASE, pageId, () => [...pageGrids, ...cardGrids, { uid: "pf0", type: "free-board", props: free() }, { uid: "pf1", type: "free-board", props: free(FREE_BG) }, { uid: "board1", type: "project-board", props: { project: project.slug } }], published);
// Un clic trop tôt (éditeur encore en chargement) est sans effet : on recommence.
for (let t = 0; !done && t < 4; t++) {
  await page.getByRole("button", { name: "Publier", exact: true }).click().catch(() => {});
  done = await waitFor(published, 20000);
}
ok("0 page et planche publiées", done);

/** Pour chaque grille (page : 6 premières ; planche : les 5 suivantes) : boîtes des images + de la grille. */
const MEASURE = (slug) => {
  const all = [...document.querySelectorAll(".block-grid")];
  const sect = document.querySelector(`[aria-labelledby="project-${slug}"]`);
  const inBoard = (g) => sect?.contains(g);
  const box = (e) => {
    const b = e.getBoundingClientRect();
    return { l: b.left, w: b.width, t: b.top + window.scrollY, h: b.height };
  };
  // Zone colorée qui porte le composant (le fond, sinon la carte) : le contenu y reste à 16 px au moins du bord (lot 48).
  const zoneOf = (e) => {
    const z = e.closest('.fond-bloc[data-fond="on"]') ?? e.closest('.surface-card[data-surface="on"]');
    return z ? box(z) : null;
  };
  const one = (g) => ({ imgs: [...g.querySelectorAll("img")].filter((i) => i.getBoundingClientRect().width > 20).map(box), grid: box(g), zone: zoneOf(g) });
  const probe = (css) => {
    const i = document.createElement("i");
    i.style.cssText = `position:absolute;visibility:hidden;${css}`;
    document.body.append(i);
    const out = { w: i.getBoundingClientRect().width, br: parseFloat(getComputedStyle(i).borderTopLeftRadius) || 0 };
    i.remove();
    return out;
  };
  const gutter = probe("width:var(--gutter)").w;
  const pageMax = probe("width:var(--t-space-page-max)").w;
  const legacyR = probe("border-radius:max(var(--t-radius-lg),12px);width:10px;height:10px").br;
  const cards = [...document.querySelectorAll('.surface-card[data-surface="on"]')].map((e) => {
    const b = e.getBoundingClientRect();
    return { l: b.left, w: b.width, r: parseFloat(getComputedStyle(e).borderTopLeftRadius) || 0 };
  });
  const frees = [...document.querySelectorAll(".free-board")].map((e) => ({ ...box(e), board: Boolean(sect?.contains(e)), zone: zoneOf(e) }));
  return {
    gutter,
    pageMax,
    legacyR,
    cards,
    frees,
    page: all.filter((g) => !inBoard(g)).map(one),
    board: all.filter(inBoard).map(one),
    vw: document.documentElement.clientWidth,
    sw: document.documentElement.scrollWidth,
  };
};
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;
/**
 * Le contenu ne rétrécit pas : mêmes images (1 px près) avec et sans fond. Lot 48 : sauf quand, sans fond, il ne tient pas dans la zone
 * colorée avec 16 px de marge (écran étroit, marge L) : il rentre alors dans la zone, sans jamais s'élargir.
 */
const MARGIN = 16;
const fitsIn = (boxes, zone) => !zone || boxes.every((x) => x.l >= zone.l + MARGIN - 1 && x.l + x.w <= zone.l + zone.w - MARGIN + 1);
const sameBoxes = (a, b, zone, tol = 1) => a.length === b.length && a.length > 0 && (a.every((x, i) => Math.abs(x.l - b[i].l) <= tol && Math.abs(x.w - b[i].w) <= tol) || (!fitsIn(a, zone) && fitsIn(b, zone) && b.every((x, i) => x.w <= a[i].w + tol)));
const same = (a, b, tol = 1) => sameBoxes(a.imgs, b.imgs, b.zone, tol);
const fmt = (g) => g.imgs.map((x) => `${x.l.toFixed(0)}+${x.w.toFixed(0)}`).join(" ");

const names = [...VARIANTS.map(([n]) => n), ...CARDS.map(([n]) => n)];
const LAST = {};
for (const width of [1440, 1024, 390]) {
  const c = await browser.newContext({ viewport: { width, height: 900 }, ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) });
  const p = await c.newPage();
  await p.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
  await sleep(1000);
  const m = await p.evaluate(MEASURE, project.slug);
  LAST[width] = m;
  ok(`A${width} ${m.page.length} grilles de page, ${m.board.length} de planche mesurées`, m.page.length === 5 + CARDS.length && m.board.length === 5, `${m.page.length}/${m.board.length}`);
  for (const [where, list] of [["page", m.page], ["planche", m.board]]) {
    console.log(`  [${width}] ${where} : ` + list.map((g, i) => `${names[i]}=${fmt(g)}`).join(" | "));
    for (let i = 1; i < list.length; i++) ok(`A${width} ${where} : « ${names[i]} » garde les images de « sans »`, same(list[0], list[i]), `${fmt(list[0])} / ${fmt(list[i])}`);
  }
  {
    const phone = width < 768;
    const [c0, c1, c2] = m.cards;
    const mx = Math.min(m.gutter, m.gutter / 2 + Math.max(0, (m.vw - m.pageMax) / 2));
    ok(`A${width} ancienne carte « En retrait + arrondi » relue sans changement : marge = gouttière du thème (${m.gutter.toFixed(0)} px, rapprochée du bord si l'écran est étroit), rayon = celui du thème (${m.legacyR.toFixed(0)} px)`, m.cards.length === CARDS.length && near(c0.l, mx, 9) && near(c0.l + c0.w, m.vw - mx, 9) && near(c0.r, m.legacyR, 1), JSON.stringify([m.cards[0], m.gutter, m.legacyR]));
    ok(`A${width} carte Moyen : ${phone ? 14 : 20} px ; coins droits : 0 ; même marge`, near(c1.r, phone ? 14 : 20, 1) && c2.r === 0 && near(c1.l, mx, 9) && near(c2.l, mx, 9), JSON.stringify([c1, c2]));
  }
  const fp = m.frees.filter((x) => !x.board);
  const fb = m.frees.filter((x) => x.board);
  console.log(`  [${width}] planche libre : page ${fp.map((x) => `${x.l.toFixed(0)}+${x.w.toFixed(0)}`).join(" | ")} ; planche ${fb.map((x) => `${x.l.toFixed(0)}+${x.w.toFixed(0)}`).join(" | ")}`);
  ok(`A${width} planche libre : le fond (marge L + coins) garde la place de « sans » tant qu\'elle tient dans la zone, en page et en planche`, fp.length === 2 && fb.length === 2 && [fp, fb].every(([a, b]) => sameBoxes([a], [b], b.zone)), JSON.stringify(m.frees.map((x) => [x.l, x.w])));
  ok(`A${width} pas de défilement horizontal`, m.sw <= m.vw + 1, `${m.sw}/${m.vw}`);
  if (width === 1024 && process.env.SHOT_TAG) {
    // Captures avant / après (SHOT_TAG=avant : la règle de la couche intérieure est neutralisée = ancien rendu).
    await sleep(500);
    for (const [i, name] of [[0, "carte-retrait"], [2, "carte-droite"]]) {
      const c = p.locator('.surface-card[data-surface="on"]').nth(i);
      await c.scrollIntoViewIfNeeded();
      const b = await c.boundingBox();
      await p.screenshot({ path: path.join(SHOTS, `${process.env.SHOT_TAG}-${name}.png`), fullPage: true, clip: { x: 0, y: b.y + (await p.evaluate(() => scrollY)) - 50, width: 1024, height: b.height + 100 } });
    }
    for (const [i, name] of [[0, "sans-fond"], [1, "fond"], [2, "marge"]]) {
      const g = p.locator(`[aria-labelledby="project-${project.slug}"] .block-grid`).nth(i);
      await g.scrollIntoViewIfNeeded();
      const b = await g.boundingBox();
      await p.screenshot({ path: path.join(SHOTS, `${process.env.SHOT_TAG}-planche-${name}.png`), fullPage: true, clip: { x: 0, y: b.y + (await p.evaluate(() => scrollY)) - 70, width: 1024, height: b.height + 140 } });
    }
  }
  if (width === 1440) {
    await p.locator(".block-grid").nth(2).scrollIntoViewIfNeeded();
    await p.screenshot({ path: path.join(SHOTS, "public-page-marge.png") });
    await p.locator(`[aria-labelledby="project-${project.slug}"] .block-grid`).nth(2).scrollIntoViewIfNeeded();
    await p.screenshot({ path: path.join(SHOTS, "public-planche-marge.png") });
  }
  await c.close();
}

/* ---- B. Toile ------------------------------------------------------------------------------------------------------------------ */
const fr = await openEditor(page, BASE, pageId);
await fr.locator(".block-grid").nth(10).waitFor({ timeout: 60000 });
{
  const m = await fr.evaluate(MEASURE, project.slug);
  ok("B0 toile : grilles de page et de planche", m.page.length === 5 + CARDS.length && m.board.length === 5, `${m.page.length}/${m.board.length}`);
  for (const [where, list] of [["page", m.page], ["planche", m.board]]) {
    console.log(`  [toile ${m.vw}] ${where} : ` + list.map((g, i) => `${names[i]}=${fmt(g)}`).join(" | "));
    for (let i = 1; i < list.length; i++) ok(`B1 toile, ${where} : « ${names[i]} » garde les images de « sans »`, same(list[0], list[i]), `${fmt(list[0])} / ${fmt(list[i])}`);
  }
}

// Les blocs publiés reçoivent leurs identifiants à l'ouverture de l'éditeur : on lit ceux des grilles de la page.
const GU = await fr.evaluate(() => [...document.querySelectorAll('[data-edit-block][data-edit-type="grid"]')].map((e) => e.dataset.editBlock));
ok("B0b grilles de page repérées sur la toile", GU.length === 5 + CARDS.length, JSON.stringify(GU));

{
  const m = await fr.evaluate(MEASURE, project.slug);
  ok("B1b toile : ancienne carte relue sans changement (marge = gouttière, rayon du thème)", m.cards.length === CARDS.length && near(m.cards[0].l - m.cards[3].l, 0, 3) === true && near(m.cards[0].r, m.legacyR, 1), JSON.stringify([m.cards, m.legacyR]));
}

/** Boîtes des images d'une grille de la toile (page : `[data-edit-block]`, planche : `[data-edit-bitem]`). */
const imgsOf = (sel) =>
  fr.evaluate((s) => {
    const g = document.querySelector(`${s} .block-grid`); if (!g) throw new Error("grille introuvable : " + s);
    const z = g.closest('.fond-bloc[data-fond="on"]') ?? g.closest('.surface-card[data-surface="on"]');
    const zb = z?.getBoundingClientRect();
    return { imgs: [...g.querySelectorAll("img")].filter((i) => i.getBoundingClientRect().width > 20).map((i) => { const b = i.getBoundingClientRect(); return { l: b.left, w: b.width }; }), zone: zb ? { l: zb.left, w: zb.width } : null };
  }, sel);
const openPageFond = async (uid) => {
  const host = fr.locator(`[data-edit-block="${uid}"]`).first();
  await host.scrollIntoViewIfNeeded();
  for (let attempt = 0; ; attempt++) {
    try {
      await host.locator(".fond-in > *").first().click({ position: { x: 3, y: 3 }, force: true });
      await fr.locator('.pe-tools [data-testid="fond-button"]').click({ timeout: 4000 });
      break;
    } catch (e) {
      if (attempt >= 3) throw e;
      await sleep(800);
    }
  }
  const menu = fr.locator('[data-testid="fond-menu"]');
  await menu.waitFor({ timeout: 20000 });
  return menu;
};
const openBoardFond = async (uid) => {
  const frame = fr.locator(`[data-edit-bitem="${uid}"]`).first();
  await frame.scrollIntoViewIfNeeded();
  await frame.hover();
  await frame.locator('[data-edit-bitem-op="fond"]').click();
  const menu = fr.locator('[data-testid="fond-menu"]');
  await menu.waitFor({ timeout: 20000 });
  return menu;
};
const windowShape = (menu) =>
  menu.evaluate((el) => ({
    text: el.innerText.replace(/\s+/g, " ").trim(),
    minis: el.querySelectorAll(".fond-mini").length,
    rows: [...el.querySelectorAll(".sm-label")].map((l) => l.textContent.trim()).filter(Boolean),
    buttons: [...el.querySelectorAll("button")].map((b) => b.textContent.trim()).filter(Boolean),
    label: el.getAttribute("aria-label"),
  }));

try {
  // Page : la grille « marge M » (pg2) ouvre la fenêtre Fond ; planche : la grille « marge M » (bg2).
  console.log("  uids toile : " + (await fr.evaluate(() => [...document.querySelectorAll('[data-edit-block]')].map((e) => e.dataset.editBlock + '/' + e.dataset.editType).join(' '))));
  const before = await imgsOf(`[data-edit-block="${GU[0]}"]`);
  let menu = await openPageFond(GU[2]);
  const winPage = await windowShape(menu);
  await page.screenshot({ path: path.join(SHOTS, "toile-fenetre-fond-page.png") });
  await page.keyboard.press("Escape");
  menu = await openBoardFond("bg2");
  const winBoard = await windowShape(menu);
  await page.screenshot({ path: path.join(SHOTS, "toile-fenetre-fond-planche.png") });
  await page.keyboard.press("Escape");
  console.log("  fenêtre page   : " + winPage.text);
  console.log("  fenêtre planche: " + winBoard.text);
  ok("C1 même fenêtre en page et en planche : mêmes libellés, mêmes boutons, mêmes lignes", winPage.text === winBoard.text && JSON.stringify(winPage.buttons) === JSON.stringify(winBoard.buttons) && JSON.stringify(winPage.rows) === JSON.stringify(winBoard.rows) && winPage.label === winBoard.label, `${winPage.text} || ${winBoard.text}`);
  ok("C2 Étendue « Bord à bord / Avec marge », Coins « Droits / Petit / Moyen / Grand », avec pictogrammes (6)", winPage.minis === 6 && ["Bord à bord", "Avec marge", "Droits", "Petit", "Moyen", "Grand"].every((t) => winPage.buttons.includes(t)) && !winPage.buttons.some((t) => /En retrait|Coins arrondis|Pleine largeur|Coins droits/.test(t)), JSON.stringify(winPage));

  // Aperçu immédiat : pose une couleur puis « Avec marge » + coins sur la grille sans fond (page, puis planche) ; les images ne bougent pas.
  for (const [where, open, sel, uid] of [["page", openPageFond, `[data-edit-block="${GU[0]}"]`, GU[0]], ["planche", openBoardFond, '[data-edit-bitem="bg0"]', "bg0"]]) {
    const b0 = await imgsOf(sel);
    const mn = await open(uid);
    await mn.locator('[data-kind="color"]').click();
    await sleep(500);
    const b1 = await imgsOf(sel);
    await mn.locator('[data-extent="margin"]').click();
    await sleep(500);
    const b2 = await imgsOf(sel);
    await mn.locator('[data-testid="fond-inset"] [data-step="l"]').click();
    await mn.locator('[data-testid="fond-round"] [data-step="m"]').click();
    await sleep(500);
    const b3 = await imgsOf(sel);
    await page.screenshot({ path: path.join(SHOTS, `toile-apercu-${where}.png`) });
    ok(`B2 aperçu (${where}) : couleur, puis marge, puis marge L + coins : les images gardent largeur et place`, same(b0, b1) && same(b0, b2) && same(b0, b3), [fmt(b0), fmt(b1), fmt(b2), fmt(b3)].join(" / "));
    await page.keyboard.press("Escape");
    await settled(page);
    const b4 = await imgsOf(sel);
    ok(`B3 enregistré (${where}) : toujours les mêmes images après le rechargement de la toile`, same(b0, b4), `${fmt(b0)} / ${fmt(b4)}`);
    const saved = where === "page" ? draftBlocks(pageId).find((b) => b.uid === uid)?.props.background : boardDraft(project.id)?.find((i) => i.uid === uid)?.props.background;
    ok(`B4 enregistré (${where}) : { couleur, inset l, round m }`, saved?.kind === "color" && saved.inset === "l" && saved.round === "m", JSON.stringify(saved));
  }
  /* ---- D. Fenêtre « Carte » : mêmes boutons que « Fond », contenu intact ---- */
  const rowsOf = (menu) =>
    menu.evaluate((el) =>
      [...el.querySelectorAll(".tc-row")]
        .filter((r) => ["Étendue", "Coins"].includes(r.querySelector(".sm-label")?.textContent.trim() ?? ""))
        .map((r) => ({ label: r.querySelector(".sm-label").textContent.trim(), role: r.querySelector(".tc-seg")?.getAttribute("role"), buttons: [...r.querySelectorAll("button")].map((b) => ({ t: b.textContent.trim(), svg: b.querySelector("svg")?.outerHTML ?? null, cls: b.className })) })),
    );
  const openCard = async (uid) => {
    const host = fr.locator(`[data-edit-block="${uid}"]`).first();
    await host.scrollIntoViewIfNeeded();
    for (let attempt = 0; ; attempt++) {
      try {
        await host.locator(".surface-card").first().click({ position: { x: 60, y: 6 }, force: true });
        await fr.locator('.pe-tools button[title^="Carte de la rubrique"]').click({ timeout: 4000 });
        break;
      } catch (e) {
        if (attempt >= 3) throw e;
        await sleep(800);
      }
    }
    const m = fr.locator('[role="dialog"][aria-label="Carte de la rubrique"]');
    await m.waitFor({ timeout: 20000 });
    return m;
  };
  const surfaceOf = (uid) => draftBlocks(pageId).find((b) => b.uid === uid)?.props.surface;
  const fondMenu = await openPageFond(GU[2]);
  const fondRows = await rowsOf(fondMenu);
  await page.keyboard.press("Escape");
  const CARD = GU[5];
  const cardImgs0 = await imgsOf(`[data-edit-block="${CARD}"]`);
  const cardL0 = (await fr.evaluate(MEASURE, project.slug)).cards[0].l;
  const cm = await openCard(CARD);
  const cardRows = await rowsOf(cm);
  await page.screenshot({ path: path.join(SHOTS, "toile-fenetre-carte.png") });
  console.log("  fenêtre carte : " + (await cm.evaluate((el) => el.innerText.replace(/\s+/g, " ").slice(0, 260))));
  ok("D1 fenêtre Carte : mêmes lignes « Étendue » et « Coins », mêmes boutons, mêmes pictogrammes et mêmes classes que la fenêtre Fond", fondRows.length === 2 && cardRows.length === 2 && JSON.stringify(fondRows) === JSON.stringify(cardRows), JSON.stringify([fondRows.map((r) => r.buttons.map((b) => b.t)), cardRows.map((r) => r.buttons.map((b) => b.t))]));
  ok("D2 plus de « Pleine largeur / En retrait / Coins droits / Coins arrondis » dans la fenêtre Carte", !/Pleine largeur|En retrait|Coins droits|Coins arrondis/.test(await cm.innerText()));
  const legacyStep = await fr.evaluate(() => {
    const i = document.createElement("i");
    i.style.cssText = "position:absolute;visibility:hidden;border-radius:max(var(--t-radius-lg),12px);width:10px;height:10px";
    document.body.append(i);
    const r = parseFloat(getComputedStyle(i).borderTopLeftRadius);
    i.remove();
    return [["s", 10], ["m", 20], ["l", 36]].sort((a, b) => Math.abs(a[1] - r) - Math.abs(b[1] - r))[0][0];
  });
  ok("D3 ancienne carte : « Avec marge » coché, et la taille de coins la plus proche de son rayon cochée", (await cm.locator('[data-width="inset"]').getAttribute("aria-checked")) === "true" && (await cm.locator(`[data-testid="surface-round"] [data-step="${legacyStep}"]`).getAttribute("aria-checked")) === "true", legacyStep);
  await cm.locator(`[data-testid="surface-round"] [data-step="${legacyStep}"]`).click();
  await sleep(600);
  ok("D4 cliquer la taille déjà cochée ne change rien (réglages de la carte inchangés, rendu d'avant gardé)", JSON.stringify(surfaceOf(CARD) ?? {}) === "{}", JSON.stringify(surfaceOf(CARD)));
  const clickAndMeasure = async (sel) => {
    await cm.locator(sel).click();
    await sleep(500);
    return { imgs: await imgsOf(`[data-edit-block="${CARD}"]`), card: (await fr.evaluate(MEASURE, project.slug)).cards[0] };
  };
  const other = legacyStep === "l" ? "s" : "l";
  let r = await clickAndMeasure(`[data-testid="surface-round"] [data-step="${other}"]`);
  ok(`D5 coins « ${other === "l" ? "Grand" : "Petit"} » : rayon ${other === "l" ? 36 : 10} px, images intactes`, near(r.card.r, other === "l" ? 36 : 10, 1) && same(cardImgs0, r.imgs), JSON.stringify([r.card, fmt(cardImgs0), fmt(r.imgs)]));
  r = await clickAndMeasure('[data-testid="surface-round"] [data-step="none"]');
  ok("D6 coins « Droits » : rayon nul, images intactes", r.card.r === 0 && same(cardImgs0, r.imgs), JSON.stringify([r.card, fmt(cardImgs0), fmt(r.imgs)]));
  r = await clickAndMeasure('[data-extent="full"]');
  ok("D7 « Bord à bord » : la carte occupe toute la largeur, images intactes", near(r.card.l, 0, 1.5) && same(cardImgs0, r.imgs), JSON.stringify([r.card, fmt(cardImgs0), fmt(r.imgs)]));
  await page.screenshot({ path: path.join(SHOTS, "toile-carte-bord-a-bord.png") });
  r = await clickAndMeasure('[data-extent="margin"]');
  ok("D8 « Avec marge » : la carte revient à sa marge d'avant, images intactes", near(r.card.l, cardL0, 1.5) && same(cardImgs0, r.imgs), JSON.stringify([r.card, fmt(cardImgs0), fmt(r.imgs)]));
  ok("D9 enregistré : { width: inset, corners: square } (coins droits choisis avant)", await waitFor(() => surfaceOf(CARD)?.width === "inset" && surfaceOf(CARD)?.corners === "square"), JSON.stringify(surfaceOf(CARD)));
  await page.keyboard.press("Escape");
} catch (e) {
  failures++;
  console.log(`FAIL toile : ${e.message}`);
  await page.screenshot({ path: path.join(SHOTS, "echec.png") }).catch(() => {});
}

console.log(`erreurs de page : ${errors.length}`);
await browser.close();
process.exit(failures ? 1 : 0);
