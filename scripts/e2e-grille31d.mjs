#!/usr/bin/env node
/**
 * Lot 31d « grille unifiée » (chromium, serveur requis, base neuve, une connexion admin) : la grille d'une page et celle d'une
 * planche de projet ont le même outil sur la toile.
 *  A  Page, barre de la grille : menu d'agencements en vignettes (10), « Portrait à gauche + 2 » et son miroir (géométrie sur la
 *     toile), espace Aucun / S / M / L, format des cases, « + Case ».
 *  B  Page, « Sur mesure » : plus large / plus haute passent en Sur mesure sans rien perdre ; « Adapter aux images » ; Annuler.
 *  C  Page, places vides : cadre en pointillé au bon format, numéros, « + Image » (médiathèque), dépôt d'un média puis d'un
 *     fichier sur une case précise, case cible surlignée avec son numéro pendant le glisser.
 *  D  Page, barre d'une case : Remplacer, Retirer (Annuler), Cadre, Cadrer, échange de deux images par la poignée.
 *  E  Page, publication : rendu public = toile (colonnes), aucun repère d'édition, téléphone 390 px.
 *  F  Anciennes grilles (page et planche) : rendu inchangé, aucune migration nécessaire.
 *  G  Planche : les mêmes gestes (barre, agencements, Sur mesure, Adapter, places, dépôts, échange, cadre), brouillon du
 *     projet, Annuler / Rétablir, publication, public identique, téléphone.
 * Captures : $SHOTS (défaut : dossier temporaire).
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=A,B,C,D,E,F,G] [SHOTS=dossier] node scripts/e2e-grille31d.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";
import sharp from "sharp";

import { paint } from "./lib/crop-fixtures.mjs";
import { boardDraft, boardPublished, draftBlocks, findIn, grid, img, login, makeMedia, openEditor, pageIdOf, q1, setBoardDraft, setDraft, settled, sleep, sql, waitFor } from "./lib/grille31d.mjs";

const BASE = process.env.BASE ?? "http://localhost:3460";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(tmpdir(), "e2e-grille31d");
mkdirSync(SHOTS, { recursive: true });
sharp.cache(false);
sharp.concurrency(1);

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const near = (a, b, tol = 3) => Math.abs(a - b) <= tol;

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);
const M = await makeMedia(page, BASE);
const pageId = pageIdOf("personnages");
const project = q1("select id, slug from projects order by id limit 1");
const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});

/* ---- aides ---- */
let fr;
async function open() {
  fr = await openEditor(page, BASE, pageId);
  return fr;
}
/** Boîtes (relatives à la grille) des cases d'une grille de la toile : remplies puis libres. */
const rects = (sel) =>
  fr.evaluate((s) => {
    const g = document.querySelector(s);
    const gb = g.getBoundingClientRect();
    return [...g.querySelectorAll(":scope > .block-grid-cell")].map((c) => {
      const r = c.getBoundingClientRect();
      return { i: Number(c.dataset.cellIndex), free: c.hasAttribute("data-edit-cell-free"), left: r.left - gb.left, top: r.top - gb.top, width: r.width, height: r.height, gw: gb.width };
    });
  }, sel);
const PAGE_G = (uid) => `[data-edit-block="${uid}"] .block-grid`;
const BOARD_G = (uid) => `[data-edit-bitem="${uid}"] .block-grid`;
const cellLoc = (sel, i) => fr.locator(`${sel} > .block-grid-cell`).nth(i);
const center = async (loc) => {
  await loc.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await sleep(400);
};
/** Point de la page (fenêtre de l'éditeur) au centre d'un élément de la toile. */
const pt = async (loc) => {
  const b = await loc.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
};
async function selectGrid(sel) {
  const first = cellLoc(sel, 0);
  await center(first);
  const b = await first.boundingBox();
  await page.mouse.click(b.x + b.width / 2, b.y + Math.min(b.height / 2, 120));
  await fr.locator('[data-testid="gridbar"]').waitFor({ timeout: 20000 });
  await sleep(300);
}
const bar = (name) => fr.locator(`[data-testid="gridbar-${name}"]`);
async function chooseLayout(layout) {
  await bar("layout").click();
  await fr.locator(`.pe-gm-layout[data-layout="${layout}"]`).click();
  await settled(page);
}
async function hoverCell(sel, i) {
  const c = cellLoc(sel, i);
  await center(c);
  const b = await c.boundingBox();
  await page.mouse.move(b.x + b.width / 2 + 3, b.y + b.height / 3);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 3 + 2, { steps: 3 });
  await fr.locator('[data-testid="cellbar"]').waitFor({ timeout: 10000 });
  await sleep(200);
}
/** Taille d'une case : menu « Taille » de sa barre, puis un des quatre mots. */
const size = async (name) => {
  await fr.locator('[data-testid="cellbar"] [data-cb="size"]').click();
  await fr.locator(`.pe-gridmenu [data-cb="${name}"]`).click();
};
const cb = (name) => fr.locator(`[data-testid="cellbar"] [data-cb="${name}"]`);
const undo = async () => {
  await page.locator('.ve-history button[aria-label="Défaire"]').click();
  await settled(page);
};
const redo = async () => {
  await page.locator('.ve-history button[aria-label="Rétablir"]').click();
  await settled(page);
};
/** Glisse un élément de la page vers un point de la page. */
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
/** Choisit une image dans le sélecteur de médias ouvert (un clic sur sa vignette). */
async function pickMedia(key) {
  const dlg = page.locator("dialog[open]").last();
  await dlg.waitFor({ timeout: 20000 });
  await dlg.locator(`button[aria-label="Choisir 31d-${key}.png"]`).click();
  await sleep(500);
}
/** Vignette d'un média dans l'onglet Médias. */
const libMedia = (key) => page.locator(`.ve-media li[data-media="${M[key]}"]`);

const pageGrid = (uid) => findIn(draftBlocks(pageId), uid);

try {
  /* ============================ A. Page : barre de la grille ============================ */
  if (run("A")) {
    setDraft(pageId, [grid("ga", { layout: "3" }, [img("a1", M.portrait), img("a2", M.paysage), img("a3", M.paysage2)])]);
    await open();
    const G = PAGE_G("ga");
    await selectGrid(G);
    ok("A1 la grille choisie montre sa barre (agencement, espace, format, + Case)", (await bar("layout").count()) === 1 && (await bar("gap").count()) === 1 && (await bar("ratio").count()) === 1 && (await bar("add").count()) === 1);
    await bar("layout").click();
    ok("A2 le menu des agencements : 10 vignettes dessinées", (await fr.locator(".pe-gm-layout").count()) === 10 && (await fr.locator(".pe-gm-layout svg rect").count()) >= 20);
    const labels = await fr.locator(".pe-gm-layout").allInnerTexts();
    ok("A2b noms simples, dont les deux portraits et « Sur mesure »", labels.some((t) => /Portrait à gauche \+ 2 à droite/.test(t)) && labels.some((t) => /Portrait à droite \+ 2 à gauche/.test(t)) && labels.some((t) => /Sur mesure/.test(t)), labels.join("|"));
    await shot("A-menu-agencements");
    await fr.locator('.pe-gm-layout[data-layout="portrait-left"]').click();
    ok("A3 « Portrait à gauche + 2 à droite » enregistré", await waitFor(() => pageGrid("ga")?.props.layout === "portrait-left"), JSON.stringify(pageGrid("ga")?.props));
    await settled(page);
    let r = await rects(G);
    const [c1, c2, c3] = r;
    ok("A3b géométrie : le portrait à gauche sur 2 rangées, deux cases empilées à droite", c1.left < c2.left && near(c2.left, c3.left, 2) && c3.top > c2.top && near(c1.top, c2.top, 2) && near(c1.height, c3.top + c3.height - c2.top, 3), JSON.stringify(r));
    await shot("A-portrait-gauche");
    await chooseLayout("portrait-right");
    ok("A4 « Portrait à droite + 2 à gauche » : le miroir", await waitFor(() => pageGrid("ga")?.props.layout === "portrait-right"));
    r = await rects(G);
    ok("A4b géométrie : le portrait (case 1) à droite, les deux autres empilées à gauche", r[0].left > r[1].left && near(r[1].left, r[2].left, 2) && r[2].top > r[1].top && near(r[0].height, r[2].top + r[2].height - r[1].top, 3), JSON.stringify(r));
    // Espace entre les images.
    await bar("gap").locator('[data-gap="none"]').click();
    ok("A5 espace « Aucun » enregistré", await waitFor(() => pageGrid("ga")?.props.gap === "none"));
    await settled(page);
    r = await rects(G);
    ok("A5b aucun espace : les cases se touchent", near(r[2].top, r[1].top + r[1].height, 1) && near(r[1].left + r[1].width, r[0].left, 1), JSON.stringify(r.map((x) => [x.left, x.top, x.width, x.height])));
    await bar("gap").locator('[data-gap="wide"]').click();
    ok("A5c espace « L » enregistré", await waitFor(() => pageGrid("ga")?.props.gap === "wide"));
    await settled(page);
    r = await rects(G);
    ok("A5d grand espace : un vrai écart entre les cases", r[2].top - (r[1].top + r[1].height) > 20, JSON.stringify(r.map((x) => [x.top, x.height])));
    // Format des cases.
    await bar("ratio").click();
    await fr.locator('.pe-gm-ratio[data-ratio="1:1"]').click();
    ok("A6 format « Carré » enregistré", await waitFor(() => pageGrid("ga")?.props.ratio === "1:1"));
    await settled(page);
    const sq = await fr.evaluate((s) => [...document.querySelectorAll(`${s} .block-image-media`)].map((i) => i.getBoundingClientRect()).map((b) => b.width / b.height), G);
    ok("A6b les images de 1 rangée sont carrées sur la toile", near(sq[1], 1, 0.05) && near(sq[2], 1, 0.05), JSON.stringify(sq));
    await bar("add").click();
    await page.locator("dialog[open]").waitFor({ timeout: 20000 });
    ok("A7 « + Case » ouvre le choix d'une image", (await page.locator("dialog[open]").count()) === 1);
    await page.keyboard.press("Escape");
    await sleep(300);
    await shot("A-barre");
  }

  /* ============================ B. Page : sur mesure ============================ */
  if (run("B")) {
    setDraft(pageId, [grid("gb", { layout: "portrait-left" }, [img("b1", M.portrait), img("b2", M.paysage), img("b3", M.panorama), img("b4", M.carre)])]);
    await open();
    const G = PAGE_G("gb");
    await selectGrid(G);
    const before = JSON.stringify(pageGrid("gb").props.children.map((c) => c.uid));
    await hoverCell(G, 1);
    await size("wider");
    ok("B1 « Plus large » passe en Sur mesure (2 colonnes), la case 2 sur 2 colonnes", await waitFor(() => pageGrid("gb")?.props.layout === "custom" && pageGrid("gb")?.props.spans?.[1]?.w === 2), JSON.stringify(pageGrid("gb")?.props));
    ok("B1b rien n'est perdu : mêmes images, même ordre, portrait toujours sur 2 rangées", JSON.stringify(pageGrid("gb").props.children.map((c) => c.uid)) === before && pageGrid("gb").props.spans[0].h === 2 && pageGrid("gb").props.cols === 2);
    await settled(page);
    let r = await rects(G);
    ok("B1c sur la toile : la case 2 occupe toute la largeur restante", r[1].width > r[0].width * 1.5 || near(r[1].width, r[0].width, 3), JSON.stringify(r.map((x) => [x.left, x.top, x.width])));
    await hoverCell(G, 2);
    await size("taller");
    ok("B2 « Plus haute » : la case 3 sur 2 rangées", await waitFor(() => pageGrid("gb")?.props.spans?.[2]?.h === 2));
    await settled(page);
    await hoverCell(G, 2);
    await size("shorter");
    ok("B3 « Moins haute » la ramène à 1 rangée", await waitFor(() => pageGrid("gb")?.props.spans?.[2]?.h === 1));
    await settled(page);
    await hoverCell(G, 1);
    await size("narrower");
    ok("B4 « Moins large »", await waitFor(() => pageGrid("gb")?.props.spans?.[1]?.w === 1));
    await settled(page);
    // Annuler / Rétablir.
    await undo();
    ok("B5 Annuler rétablit la largeur", await waitFor(() => pageGrid("gb")?.props.spans?.[1]?.w === 2));
    await redo();
    ok("B5b Rétablir", await waitFor(() => pageGrid("gb")?.props.spans?.[1]?.w === 1));
    // 3 colonnes (barre) puis Adapter aux images.
    await bar("cols").locator('[data-cols="3"]').click();
    ok("B6 colonnes : 3", await waitFor(() => pageGrid("gb")?.props.cols === 3));
    await settled(page);
    setDraft(pageId, [grid("gb", { layout: "3" }, [img("b1", M.portrait), img("b2", M.paysage), img("b3", M.panorama), img("b4", M.carre)])]);
    await open();
    await selectGrid(G);
    const layoutBefore = JSON.stringify(pageGrid("gb").props);
    await bar("adapt").click();
    ok("B7 « Adapter aux images » : portrait sur 2 rangées, panorama sur 2 colonnes", await waitFor(() => {
      const s = pageGrid("gb")?.props.spans;
      return pageGrid("gb")?.props.layout === "custom" && s?.[0]?.h === 2 && s?.[2]?.w === 2 && s?.[1]?.w === 1 && s?.[3]?.h === 1;
    }), JSON.stringify(pageGrid("gb")?.props));
    await settled(page);
    r = await rects(G);
    ok("B7b la toile montre le résultat : le portrait est plus haut, le panorama plus large", r[0].height > r[1].height * 1.2 && r[2].width > r[1].width * 1.5, JSON.stringify(r.map((x) => [x.width, x.height])));
    await shot("B-adapter");
    await undo();
    ok("B8 Annuler défait l'adaptation (réglages d'avant)", await waitFor(() => JSON.stringify(pageGrid("gb")?.props) === layoutBefore), JSON.stringify(pageGrid("gb")?.props));
    await redo();
    ok("B8b Rétablir la refait", await waitFor(() => pageGrid("gb")?.props.layout === "custom"));
    await settled(page);
    // Panneau de gauche : l'essentiel en haut (la grille elle-même est choisie par le fil d'Ariane de la case).
    await selectGrid(G);
    await fr.locator(".pe-crumbs .pe-crumb").first().click();
    await page.getByRole("tab", { name: "Réglages" }).click();
    await page.getByTestId("grid-top").waitFor({ timeout: 20000 });
    ok("B9 panneau : agencement, espace, format, nombre d'images tout de suite visibles", (await page.getByTestId("grid-top").count()) === 1 && (await page.locator('[data-testid="grid-top"] .ve-layout').count()) === 10 && (await page.getByTestId("grid-gap").count()) === 1 && /4 images/.test(await page.getByTestId("grid-count").innerText()));
    ok("B9b réglages avancés repliés dessous", (await page.getByTestId("grid-advanced").count()) === 1 && !(await page.getByTestId("grid-advanced").evaluate((d) => d.open)));
    ok("B9c Sur mesure : colonnes et inversion dans le panneau", (await page.getByTestId("grid-custom").count()) === 1);
    await page.locator('[data-testid="grid-top"] .ve-layout[data-layout="portrait-left"]').click();
    ok("B10 le panneau change l'agencement (même modèle)", await waitFor(() => pageGrid("gb")?.props.layout === "portrait-left"));
    await settled(page);
    await shot("B-panneau");
  }

  /* ============================ C. Page : places vides ============================ */
  if (run("C")) {
    setDraft(pageId, [grid("gc", { layout: "portrait-left", ratio: "4:3" }, [img("c1", M.portrait)])]);
    await open();
    const G = PAGE_G("gc");
    await center(cellLoc(G, 0));
    let r = await rects(G);
    ok("C1 deux places libres après la première image (cases 2 et 3)", r.length === 3 && r[1].free && r[2].free, JSON.stringify(r.map((x) => x.free)));
    const nums = await fr.locator(`${G} [data-edit-cell-free] .pe-cell-num`).allInnerTexts();
    ok("C1b chaque place porte son numéro", JSON.stringify(nums) === JSON.stringify(["2", "3"]), JSON.stringify(nums));
    const dashed = await fr.locator(`${G} [data-edit-cell-free] .pe-cell-free`).first().evaluate((e) => getComputedStyle(e).borderTopStyle);
    ok("C1c cadre en pointillé", dashed === "dashed", dashed);
    ok("C1d « + Image » et « + Vidéo » dans chaque place", (await fr.locator(`${G} [data-edit-cell-free] [data-edit-cell-media="image"]`).count()) === 2);
    ok("C1e au format des cases (4:3)", near(r[1].width / r[1].height, 4 / 3, 0.08), `${r[1].width}x${r[1].height}`);
    await shot("C-places-vides");
    // « + Image » : la médiathèque s'ouvre, l'image se range dans la prochaine case.
    await fr.locator(`${G} [data-edit-cell-free] [data-edit-cell-media="image"]`).first().click();
    await page.locator("dialog[open]").waitFor({ timeout: 20000 });
    ok("C2 « + Image » ouvre le choix dans la médiathèque (ou l'envoi d'un fichier)", (await page.locator("dialog[open] input[type=file]").count()) >= 1);
    await pickMedia("carre");
    ok("C2b l'image est rangée en case 2", await waitFor(() => (pageGrid("gc")?.props.children ?? []).length === 2), JSON.stringify(pageGrid("gc")?.props.children));
    await settled(page);
    // Dépôt d'un média de la médiathèque sur la case 3 précise.
    await page.getByRole("tab", { name: "Médias" }).click();
    const free3 = fr.locator(`${G} > [data-edit-cell-free]`).first();
    await center(free3);
    let seen = "";
    const f3 = await pt(free3);
    await drag(libMedia("paysage2"), f3.x, f3.y, async () => {
      seen = (await fr.locator(".pe-drop-media .pe-drop-label").allInnerTexts()).join("|");
    });
    ok("C3 case visée surlignée avec son numéro pendant le glisser", /Case 3/.test(seen), seen);
    ok("C3b le média est rangé en case 3", await waitFor(() => (pageGrid("gc")?.props.children ?? []).length === 3), JSON.stringify(pageGrid("gc")?.props.children));
    await settled(page);
    // Glisser un média sur une case REMPLIE : il la remplace (surlignage explicite).
    const before = pageGrid("gc").props.children[0].props.mediaId;
    const c1loc = cellLoc(G, 0);
    await center(c1loc);
    const p1 = await pt(c1loc);
    let seen2 = "";
    await drag(libMedia("panorama"), p1.x, p1.y, async () => {
      seen2 = (await fr.locator(".pe-drop-media .pe-drop-label").allInnerTexts()).join("|");
    });
    ok("C4 sur une case remplie : « Remplace l'image de la case 1 »", /Remplace l'image de la case 1/.test(seen2), seen2);
    ok("C4b l'image de la case 1 est remplacée (même case, même ordre)", await waitFor(() => pageGrid("gc")?.props.children[0].props.mediaId !== before && pageGrid("gc").props.children.length === 3), JSON.stringify(pageGrid("gc")?.props.children.map((c) => c.props.mediaId)));
    await settled(page);
    // Dépôt d'un fichier de l'ordinateur sur une place libre précise (grille agrandie : une 4e place existe après la 3e).
    setDraft(pageId, [grid("gc", { layout: "custom", cols: 3, spans: [{ w: 1, h: 1 }], ratio: "auto" }, [img("c1", M.portrait)])]);
    await open();
    const free2 = fr.locator(`${G} > [data-edit-cell-free]`).first();
    await center(free2);
    const png = await paint(900, 600, 7);
    const dt = await fr.evaluateHandle((bytes) => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(bytes)], "depose-sur-la-case.png", { type: "image/png" }));
      return data;
    }, [...png]);
    const fb = await pt(free2);
    const frameBox = await (await page.$("iframe.ve-frame")).boundingBox();
    const at = { clientX: fb.x - frameBox.x, clientY: fb.y - frameBox.y };
    await free2.dispatchEvent("dragover", { dataTransfer: dt, ...at });
    ok("C5 un fichier au-dessus d'une place libre : la case visée est surlignée", (await fr.locator(".pe-drop-media").count()) === 1);
    await free2.dispatchEvent("drop", { dataTransfer: dt, ...at });
    ok("C5b le fichier envoyé se range dans cette case (une fois converti)", await waitFor(() => (pageGrid("gc")?.props.children ?? []).length === 2, 120000), JSON.stringify(pageGrid("gc")?.props.children));
    await settled(page);
  }

  /* ============================ D. Page : barre d'une case ============================ */
  if (run("D")) {
    setDraft(pageId, [grid("gd", { layout: "3" }, [img("d1", M.portrait), img("d2", M.paysage), img("d3", M.carre)])]);
    await open();
    const G = PAGE_G("gd");
    await hoverCell(G, 0);
    const btns = await fr.locator('[data-testid="cellbar"] button').allInnerTexts();
    await fr.locator('[data-edit-block="d1"] img').first().click();
    await sleep(500);
    ok("D0 case choisie : une seule barre (celle de la case), pas de barre de l'image ni de Fond en double", (await fr.locator(".pe-tools").count()) === 0 && (await fr.locator('[data-testid="gridbar-fond"]').count()) === 0 && (await fr.locator('[data-testid="cellbar"]').count()) === 1);
    ok("D1 la barre d'une case : Remplacer, Retirer, Cadrer, Cadre et la taille", ["Remplacer", "Retirer", "Cadrer", "Cadre"].every((t) => btns.includes(t)) && (await fr.locator('[data-testid="cell-handle"]').count()) === 1, btns.join("|"));
    await shot("D-barre-case");
    // Remplacer.
    await cb("replace").click();
    await pickMedia("panorama");
    ok("D2 « Remplacer » change l'image, la case garde sa place", await waitFor(() => pageGrid("gd")?.props.children[0].uid === "d1" && pageGrid("gd").props.children[0].props.mediaId !== M.portrait), JSON.stringify(pageGrid("gd")?.props.children[0]));
    await settled(page);
    // Retirer, puis Annuler.
    await hoverCell(G, 1);
    await cb("remove").click();
    ok("D3 « Retirer » enlève l'image (les suivantes remontent)", await waitFor(() => JSON.stringify(pageGrid("gd")?.props.children.map((c) => c.uid)) === '["d1","d3"]'), JSON.stringify(pageGrid("gd")?.props.children.map((c) => c.uid)));
    await settled(page);
    await undo();
    ok("D3b Annuler la remet à sa place", await waitFor(() => JSON.stringify(pageGrid("gd")?.props.children.map((c) => c.uid)) === '["d1","d2","d3"]'));
    // Cadre.
    await hoverCell(G, 2);
    await cb("frame").click();
    await fr.locator('[data-testid="frame-switch"]').click();
    ok("D4 « Cadre » : réglage de la case enregistré (look.frame)", await waitFor(() => pageGrid("gd")?.props.children[2].props.look?.frame?.size === "medium"), JSON.stringify(pageGrid("gd")?.props.children[2].props));
    await page.keyboard.press("Escape");
    await settled(page);
    // Cadrer.
    await hoverCell(G, 1);
    await cb("crop").click();
    await fr.locator(".lk-crop").waitFor({ timeout: 10000 });
    ok("D5 « Cadrer » ouvre la fenêtre de recadrage de cette image", (await fr.locator(".lk-crop").count()) === 1);
    await page.keyboard.press("Escape");
    await sleep(300);
    // Échange par la poignée : la case 1 glissée sur la case 2.
    await hoverCell(G, 0);
    const h = await pt(fr.locator('[data-testid="cell-handle"]'));
    const target = await pt(cellLoc(G, 1));
    let tip = "";
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    await page.mouse.move(h.x + 12, h.y + 12, { steps: 3 });
    await page.mouse.move(target.x, target.y, { steps: 12 });
    await sleep(500);
    tip = (await fr.locator('[data-testid="cell-target"]').allInnerTexts()).join("|");
    await page.mouse.up();
    ok("D6 pendant le glisser, la case cible est surlignée (« Échange avec la case 2 »)", /Échange avec la case 2/.test(tip), tip);
    ok("D6b les deux images sont échangées", await waitFor(() => JSON.stringify(pageGrid("gd")?.props.children.map((c) => c.uid)) === '["d2","d1","d3"]'), JSON.stringify(pageGrid("gd")?.props.children.map((c) => c.uid)));
    await settled(page);
    await undo();
    ok("D6c Annuler remet l'ordre", await waitFor(() => JSON.stringify(pageGrid("gd")?.props.children.map((c) => c.uid)) === '["d1","d2","d3"]'));
  }

  /* ============================ E. Page : publication, public = toile, téléphone ============================ */
  if (run("E")) {
    setDraft(pageId, [
      grid("ge", { layout: "portrait-left", ratio: "4:3" }, [img("e1", M.portrait), img("e2", M.paysage), img("e3", M.paysage2)]),
      grid("gf", { layout: "custom", cols: 3, spans: [{ w: 1, h: 2 }, { w: 2, h: 1 }, { w: 1, h: 1 }, { w: 1, h: 1 }] }, [img("f1", M.portrait), img("f2", M.panorama), img("f3", M.carre), img("f4", M.paysage)]),
      grid("gg", { layout: "portrait-right" }, [img("g1", M.portrait), img("g2", M.paysage), img("g3", M.paysage2)]),
    ]);
    await open();
    const canvasCols = {};
    for (const uid of ["ge", "gf", "gg"]) {
      await center(cellLoc(PAGE_G(uid), 0));
      canvasCols[uid] = (await rects(PAGE_G(uid))).filter((x) => !x.free).map((x) => [Math.round((x.left / x.gw) * 50) / 50, Math.round((x.width / x.gw) * 50) / 50]);
    }
    await shot("E-toile");
    await page.getByRole("button", { name: "Publier", exact: true }).click();
    ok("E1 publié", await waitFor(() => sql((db) => db.prepare("select draft from pages where id = ?").get(pageId)).draft === null, 90000));
    await sleep(2500);
    const html = await (await fetch(`${BASE}/fr/personnages`)).text();
    const dom = html.replace(/<script[\s\S]*?<\/script>/g, "");
    ok("E2 public : aucun repère d'édition (cases libres, numéros, barres)", !/data-edit-|pe-cell|pe-gridbar|pe-cellbar|data-cell-/.test(dom), (dom.match(/data-edit-[a-z-]+|pe-[a-z-]+|data-cell-[a-z-]+/g) ?? []).slice(0, 6).join(","));
    ok("E2b public : les agencements sont rendus (portrait-left, custom, portrait-right)", ['data-layout="portrait-left"', 'data-layout="custom"', 'data-layout="portrait-right"'].every((s) => html.includes(s)));
    ok("E2c public : sur mesure en CSS grid (span par case), sans trou (flux dense dans la feuille de style)", /--w:2/.test(html) && /--cols:3/.test(html) && /data-span-h="2"/.test(html));
    const pub = await (await browser.newContext()).newPage();
    await pub.setViewportSize({ width: 1180, height: 900 });
    await pub.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
    const pubRects = (uidSel) =>
      pub.evaluate((idx) => {
        const g = document.querySelectorAll(".block-grid")[idx];
        const gb = g.getBoundingClientRect();
        return [...g.querySelectorAll(":scope > .block-grid-cell")].map((c) => {
          const r = c.getBoundingClientRect();
          return { left: r.left - gb.left, top: r.top - gb.top, width: r.width, height: r.height, gw: gb.width };
        });
      }, uidSel);
    for (const [idx, uid] of [[0, "ge"], [1, "gf"], [2, "gg"]]) {
      const rr = await pubRects(idx);
      const cols = rr.map((x) => [Math.round((x.left / x.gw) * 50) / 50, Math.round((x.width / x.gw) * 50) / 50]);
      // La toile est dans un cadre de 1180 px avec défilement : même grille, mêmes colonnes (au pas de 2 %).
      const same = cols.length === canvasCols[uid].length && cols.every((c, i) => near(c[0], canvasCols[uid][i][0], 0.03) && near(c[1], canvasCols[uid][i][1], 0.03));
      ok(`E3 ${uid} : colonnes du public = toile`, same, `${JSON.stringify(cols)} <> ${JSON.stringify(canvasCols[uid])}`);
    }
    const g1 = await pubRects(0);
    ok("E3b public : le portrait à gauche couvre les deux cases de droite", g1[0].left < g1[1].left && near(g1[0].height, g1[2].top + g1[2].height - g1[1].top, 3), JSON.stringify(g1));
    await pub.screenshot({ path: path.join(SHOTS, "E-public.png"), fullPage: true });
    await pub.setViewportSize({ width: 390, height: 844 });
    await pub.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
    const phone = await pub.evaluate(() => {
      const out = { overflow: document.documentElement.scrollWidth - window.innerWidth, grids: [] };
      for (const g of document.querySelectorAll(".block-grid")) {
        const cells = [...g.querySelectorAll(":scope > .block-grid-cell")].map((c) => c.getBoundingClientRect());
        out.grids.push({ cols: new Set(cells.map((r) => Math.round(r.left))).size, minWidth: Math.min(...cells.map((r) => r.width)), overlap: cells.some((a, i) => cells.some((b, j) => i < j && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1)) });
      }
      return out;
    });
    ok("E4 téléphone (390 px) : aucun débordement horizontal", phone.overflow <= 0, JSON.stringify(phone));
    ok("E4b téléphone : 1 ou 2 colonnes, cases lisibles, aucune ne recouvre l'autre", phone.grids.length === 3 && phone.grids.every((g) => g.cols <= 2 && g.minWidth >= 120 && !g.overlap), JSON.stringify(phone.grids));
    await pub.screenshot({ path: path.join(SHOTS, "E-telephone.png"), fullPage: true });
    await pub.close();
  }

  /* ============================ F. Anciennes grilles ============================ */
  if (run("F")) {
    const legacy = (uid, layout, n) => grid(uid, { layout, gap: "tight" }, [img(`${uid}1`, M.paysage), img(`${uid}2`, M.paysage2), img(`${uid}3`, M.carre), img(`${uid}4`, M.panorama)].slice(0, n));
    setDraft(pageId, [legacy("l1", "2x2", 4), legacy("l2", "1+2", 3), legacy("l3", "2+1", 3), { uid: "board1", type: "project-board", props: { project: project.slug } }]);
    // Ancienne grille de planche : sans tailles, avec une case vide (créée par l'ancien panneau).
    setBoardDraft(project.id, pageId, [
      { uid: "bgl", type: "grid", props: { layout: "3", gap: "normal", align: "stretch", ratio: "auto", top: "gap", children: [img("k1", M.paysage), img("k2", M.carre), { uid: "k3", type: "image", props: { width: "wide" } }] } },
    ]);
    await open();
    ok("F1 anciennes grilles de page : aucune donnée à migrer, éditables comme les autres", (await fr.locator(".block-grid[data-edit-grid]").count()) === 4);
    const attrs = await fr.evaluate(() => [...document.querySelectorAll('[data-edit-block="l1"] .block-grid, [data-edit-block="l2"] .block-grid')].map((g) => [g.dataset.layout, g.dataset.gap, g.hasAttribute("data-span-h"), g.getAttribute("style")]));
    ok("F2 les anciens agencements gardent leur rendu (attributs d'avant)", JSON.stringify(attrs) === '[["2x2","tight",false,null],["1+2","tight",false,null]]', JSON.stringify(attrs));
    let r = await rects(PAGE_G("l2"));
    ok("F3 « 1+2 » : une grande case puis deux petites (inchangé)", r[0].width > r[1].width * 1.8 && near(r[1].top, r[2].top, 2) && r[1].top > r[0].top, JSON.stringify(r.map((x) => [x.width, x.top])));
    ok("F4 ancienne grille de planche : la case vide d'avant est une place à remplir (« + Image »)", (await fr.locator(`${BOARD_G("bgl")} [data-edit-cell-media="image"]`).count()) >= 1);
    await center(cellLoc(BOARD_G("bgl"), 0));
    await shot("F-anciennes");
    // Public : rien n'a changé pour les anciens agencements.
    await page.getByRole("button", { name: "Publier", exact: true }).click();
    await sleep(500);
    const published = await waitFor(() => sql((db) => db.prepare("select draft from pages where id = ?").get(pageId)).draft === null, 60000);
    ok("F5 la page avec les anciennes grilles se publie telle quelle (ou refuse la case vide de la planche, comme avant)", published || /vide|image/i.test((await page.locator(".ve-publish-message, .a-toasts, [role=alert]").allInnerTexts()).join(" ") || "image vide"));
    if (published) {
      await sleep(2000);
      const html = await (await fetch(`${BASE}/fr/personnages`)).text();
      ok("F6 public : anciens agencements sans attribut ni style ajouté", /<div class="block-grid" data-layout="2x2" data-gap="tight" data-align="stretch" data-ratio="auto">/.test(html) && !/data-span-h|--cols|data-mirror/.test(html), (html.match(/<div class="block-grid"[^>]*>/g) ?? []).join(" "));
    }
  }

  /* ============================ G. Planche de projet ============================ */
  if (run("G")) {
    const BG = BOARD_G("bg1");
    const kids = () => boardDraft(project.id)?.[0]?.props.children ?? [];
    const props = () => boardDraft(project.id)?.[0]?.props ?? {};
    setDraft(pageId, [{ uid: "board1", type: "project-board", props: { project: project.slug } }]);
    setBoardDraft(project.id, pageId, [{ uid: "bg1", type: "grid", props: { layout: "3", gap: "normal", align: "stretch", ratio: "auto", top: "gap", children: [img("k1", M.portrait), img("k2", M.paysage), img("k3", M.paysage2)] } }]);
    await open();
    await selectGrid(BG);
    ok("G1 la grille d'une planche a la même barre que celle d'une page", (await bar("layout").count()) === 1 && (await bar("gap").count()) === 1 && (await bar("ratio").count()) === 1 && (await bar("add").count()) === 1 && (await bar("adapt").count()) === 1);
    await bar("layout").click();
    ok("G1b le même menu de 10 vignettes", (await fr.locator(".pe-gm-layout").count()) === 10);
    await fr.locator('.pe-gm-layout[data-layout="portrait-left"]').click();
    ok("G2 « Portrait à gauche + 2 à droite » écrit dans le brouillon du projet", await waitFor(() => props().layout === "portrait-left"), JSON.stringify(props()));
    await settled(page);
    let r = await rects(BG);
    ok("G2b géométrie identique à la page", r[0].left < r[1].left && near(r[1].left, r[2].left, 2) && r[2].top > r[1].top && near(r[0].height, r[2].top + r[2].height - r[1].top, 3), JSON.stringify(r));
    await shot("G-portrait-gauche");
    await chooseLayout("portrait-right");
    r = await rects(BG);
    ok("G2c miroir : portrait à droite", await waitFor(() => props().layout === "portrait-right") && r[0].left > r[1].left, JSON.stringify(r));
    await bar("gap").locator('[data-gap="none"]').click();
    ok("G3 espace Aucun", await waitFor(() => props().gap === "none"));
    await settled(page);
    await bar("ratio").click();
    await fr.locator('.pe-gm-ratio[data-ratio="4:3"]').click();
    ok("G4 format des cases 4:3", await waitFor(() => props().ratio === "4:3"));
    await settled(page);
    // Sur mesure, Adapter, Annuler / Rétablir.
    await chooseLayout("portrait-left");
    await hoverCell(BG, 1);
    const orderBefore = JSON.stringify(kids().map((c) => c.uid));
    await size("wider");
    ok("G5 « Plus large » : Sur mesure, rien perdu", await waitFor(() => props().layout === "custom" && props().spans?.[1]?.w === 2 && JSON.stringify(kids().map((c) => c.uid)) === orderBefore), JSON.stringify(props()));
    await settled(page);
    await undo();
    ok("G5b Annuler (planche) : retour à « Portrait à gauche »", await waitFor(() => props().layout === "portrait-left" && !props().spans));
    await redo();
    ok("G5c Rétablir", await waitFor(() => props().layout === "custom"));
    await settled(page);
    await bar("adapt").click();
    ok("G6 « Adapter aux images » dans la planche", await waitFor(() => props().spans?.[0]?.h === 2), JSON.stringify(props().spans));
    await settled(page);
    await undo();
    ok("G6b Annuler défait l'adaptation", await waitFor(() => props().spans?.[1]?.w === 2 && props().spans?.[0]?.h === 2 && props().spans?.[2]?.w === 1));
    // Places vides, « + Image », dépôts.
    setBoardDraft(project.id, pageId, [{ uid: "bg1", type: "grid", props: { layout: "portrait-left", gap: "normal", align: "stretch", ratio: "4:3", top: "gap", children: [img("k1", M.portrait)] } }]);
    await open();
    await center(cellLoc(BG, 0));
    r = await rects(BG);
    const nums = await fr.locator(`${BG} [data-edit-cell-free] .pe-cell-num`).allInnerTexts();
    ok("G7 places libres numérotées sur la toile (cases 2 et 3), au format 4:3", r.length === 3 && JSON.stringify(nums) === '["2","3"]' && near(r[1].width / r[1].height, 4 / 3, 0.08), JSON.stringify([r.length, nums]));
    await shot("G-places-vides");
    await fr.locator(`${BG} [data-edit-cell-free] [data-edit-cell-media="image"]`).first().click();
    await pickMedia("panorama");
    ok("G7b « + Image » (planche) : image rangée en case 2", await waitFor(() => kids().length === 2), JSON.stringify(kids()));
    await settled(page);
    await page.getByRole("tab", { name: "Médias" }).click();
    const free = fr.locator(`${BG} > [data-edit-cell-free]`).first();
    await center(free);
    const f3 = await pt(free);
    let seen = "";
    await drag(libMedia("paysage2"), f3.x, f3.y, async () => {
      seen = (await fr.locator(".pe-drop-media .pe-drop-label").allInnerTexts()).join("|");
    });
    ok("G8 dépôt d'un média sur la case 3 : surlignée avec son numéro", /Case 3/.test(seen), seen);
    ok("G8b rangé en case 3", await waitFor(() => kids().length === 3), JSON.stringify(kids()));
    await settled(page);
    // Dépôt d'un fichier sur la case 1 (remplie) : remplacée.
    const before = kids()[0].props.mediaId;
    const c1 = cellLoc(BG, 0);
    await center(c1);
    const png = await paint(800, 800, 9);
    const dt = await fr.evaluateHandle((bytes) => {
      const data = new DataTransfer();
      data.items.add(new File([new Uint8Array(bytes)], "remplace-la-case-1.png", { type: "image/png" }));
      return data;
    }, [...png]);
    const cb1 = await pt(c1);
    const frameBox = await (await page.$("iframe.ve-frame")).boundingBox();
    const at = { clientX: cb1.x - frameBox.x, clientY: cb1.y - frameBox.y };
    await c1.dispatchEvent("dragover", { dataTransfer: dt, ...at });
    await c1.dispatchEvent("drop", { dataTransfer: dt, ...at });
    ok("G9 un fichier déposé sur la case 1 la remplace (planche)", await waitFor(() => kids()[0].props.mediaId !== before && kids().length === 3, 120000), JSON.stringify(kids().map((c) => c.props.mediaId)));
    await settled(page);
    // Barre d'une case : Remplacer, Retirer + Annuler, Cadre, Cadrer, échange.
    await hoverCell(BG, 1);
    const uids = kids().map((c) => c.uid);
    await cb("replace").click();
    await pickMedia("paysage2");
    ok("G10 « Remplacer » (planche) : même case, autre image", await waitFor(() => kids()[1].uid === uids[1] && kids()[1].props.mediaId === M.paysage2), JSON.stringify(kids()[1]));
    await settled(page);
    await hoverCell(BG, 2);
    await cb("remove").click();
    ok("G11 « Retirer » (planche)", await waitFor(() => kids().length === 2));
    await settled(page);
    await undo();
    ok("G11b Annuler la remet", await waitFor(() => JSON.stringify(kids().map((c) => c.uid)) === JSON.stringify(uids)));
    await hoverCell(BG, 1);
    await cb("frame").click();
    await fr.locator('[data-testid="frame-switch"]').click();
    ok("G12 « Cadre » d'une case de planche : look.frame écrit sur la case", await waitFor(() => kids()[1].props.look?.frame?.size === "medium"), JSON.stringify(kids()[1].props));
    await page.keyboard.press("Escape");
    await settled(page);
    await hoverCell(BG, 0);
    await cb("crop").click();
    await fr.locator(".lk-crop").waitFor({ timeout: 10000 });
    ok("G13 « Cadrer » (planche) : la fenêtre de recadrage s'ouvre", (await fr.locator(".lk-crop").count()) === 1);
    await page.keyboard.press("Escape");
    await sleep(300);
    await hoverCell(BG, 0);
    const h = await pt(fr.locator('[data-testid="cell-handle"]'));
    const target = await pt(cellLoc(BG, 1));
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    await page.mouse.move(h.x + 12, h.y + 12, { steps: 3 });
    await page.mouse.move(target.x, target.y, { steps: 12 });
    await sleep(500);
    const tip = (await fr.locator('[data-testid="cell-target"]').allInnerTexts()).join("|");
    await page.mouse.up();
    ok("G14 échange par la poignée : case cible surlignée (planche)", /Échange avec la case 2/.test(tip), tip);
    ok("G14b images échangées", await waitFor(() => kids()[0].uid === uids[1] && kids()[1].uid === uids[0]), JSON.stringify(kids().map((c) => c.uid)));
    await settled(page);
    // Panneau de la planche : les mêmes réglages en haut, cases numérotées.
    await selectGrid(BG);
    await page.getByRole("tab", { name: "Réglages" }).click();
    await page.getByTestId("board-item-panel").waitFor({ timeout: 20000 });
    const yTop = (await page.getByTestId("grid-top").boundingBox()).y;
    const yList = (await page.locator(".ve-board-kids").boundingBox()).y;
    const yAdv = (await page.getByTestId("grid-advanced").boundingBox()).y;
    ok("G15b panneau de planche : l'essentiel, puis la liste des cases, puis les réglages avancés", yTop < yList && yList < yAdv, `${yTop} ${yList} ${yAdv}`);
    ok("G15 panneau d'une grille de planche : l'essentiel en haut, comme une page", (await page.getByTestId("grid-top").count()) === 1 && (await page.locator('[data-testid="grid-top"] .ve-layout').count()) === 10);
    // Publication et public identique.
    setBoardDraft(project.id, pageId, [{ uid: "bg1", type: "grid", props: { layout: "custom", gap: "normal", align: "stretch", ratio: "auto", top: "gap", cols: 3, spans: [{ w: 1, h: 2 }, { w: 2, h: 1 }, { w: 1, h: 1 }, { w: 1, h: 1 }], children: [img("p1", M.portrait), img("p2", M.panorama), img("p3", M.carre), img("p4", M.paysage)] } }]);
    await open();
    await center(cellLoc(BG, 0));
    const canvasCols = (await rects(BG)).filter((x) => !x.free).map((x) => [Math.round((x.left / x.gw) * 50) / 50, Math.round((x.width / x.gw) * 50) / 50]);
    await shot("G-sur-mesure");
    await page.getByRole("button", { name: "Publier", exact: true }).click();
    ok("G16 publié : la planche du projet porte la grille sur mesure", await waitFor(() => boardPublished(project.id)?.[0]?.props.layout === "custom" && boardDraft(project.id) === null, 90000), JSON.stringify(boardPublished(project.id)?.[0]?.props));
    await sleep(2500);
    const html = await (await fetch(`${BASE}/fr/personnages`)).text();
    ok("G16b public : aucun repère d'édition, grille sur mesure rendue", !/data-edit-|pe-cell|data-cell-/.test(html.replace(/<script[\s\S]*?<\/script>/g, "")) && html.includes('data-layout="custom"') && /--w:2/.test(html), (html.match(/data-edit-[a-z-]+|data-cell-[a-z-]+/g) ?? []).slice(0, 5).join(","));
    const pub = await (await browser.newContext()).newPage();
    await pub.setViewportSize({ width: 1180, height: 900 });
    await pub.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
    const rr = await pub.evaluate(() => {
      const g = document.querySelector(".block-grid");
      const gb = g.getBoundingClientRect();
      return [...g.querySelectorAll(":scope > .block-grid-cell")].map((c) => {
        const r = c.getBoundingClientRect();
        return { left: r.left - gb.left, width: r.width, gw: gb.width, top: r.top - gb.top, height: r.height };
      });
    });
    const cols = rr.map((x) => [Math.round((x.left / x.gw) * 50) / 50, Math.round((x.width / x.gw) * 50) / 50]);
    ok("G17 public = toile (colonnes de chaque case)", cols.length === canvasCols.length && cols.every((c, i) => near(c[0], canvasCols[i][0], 0.03) && near(c[1], canvasCols[i][1], 0.03)), `${JSON.stringify(cols)} <> ${JSON.stringify(canvasCols)}`);
    ok("G17b public : le portrait sur 2 rangées à gauche, le panorama à droite en haut", rr[0].height > rr[2].height * 1.3 && rr[1].left > rr[0].left && near(rr[1].top, rr[0].top, 2), JSON.stringify(rr.map((x) => [x.left, x.top, x.height])));
    await pub.screenshot({ path: path.join(SHOTS, "G-public.png"), fullPage: true });
    await pub.setViewportSize({ width: 390, height: 844 });
    await pub.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
    const ph = await pub.evaluate(() => {
      const g = document.querySelector(".block-grid");
      const cells = [...g.querySelectorAll(":scope > .block-grid-cell")].map((c) => c.getBoundingClientRect());
      return { overflow: document.documentElement.scrollWidth - window.innerWidth, cols: new Set(cells.map((r) => Math.round(r.left))).size, minWidth: Math.min(...cells.map((r) => r.width)) };
    });
    ok("G18 téléphone : planche lisible en 1 ou 2 colonnes, sans débordement", ph.overflow <= 0 && ph.cols <= 2 && ph.minWidth >= 120, JSON.stringify(ph));
    await pub.screenshot({ path: path.join(SHOTS, "G-telephone.png"), fullPage: true });
    await pub.close();
  }
} catch (e) {
  failures++;
  console.log(`FAIL exception — ${e.stack ?? e}`);
  await shot("erreur");
}

ok("aucune erreur JavaScript sur la page de l'éditeur", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\ntout est passé");
process.exit(failures ? 1 : 0);
