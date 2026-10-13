#!/usr/bin/env node
/**
 * Éditeur visuel v0.13, UN navigateur (chromium par défaut, BROWSER=firefox
 * pour le contrôle de sélection). Serveur dev requis, sur une base NEUVE
 * (seed : la migration 0014 y est jouée), une connexion.
 *
 *  A. En-tête non collant dans la toile (mode édition) ; collant en aperçu et en public.
 *  B. « Projet mis en avant » glissé depuis la palette : choix du projet sur la
 *     toile (combobox, « Créer »), titre lié + planche par défaut.
 *  C. Images déposées DANS sa planche, à une position précise (média, puis
 *     fichier entre deux).
 *  D. Glisser un composant DANS le conteneur (repère intérieur), refus pour un
 *     bloc non accepté, sortir un composant, le faire rentrer par la poignée.
 *  E. Grille de vidéos : agencement changé sans perte, vidéo déposée dans une
 *     cellule précise, place libre « + ».
 *  F. Suppression du conteneur : confirmation qui compte les composants.
 *  G. En-tête et pied (communs) : lien ajouté, renommé ; réseaux classique et « Autre lien ».
 *  H. Ouverture : texte en place, fond remplacé par un média.
 *  I. Publication et rendu public ; correction I1 (planche retirée avec son
 *     conteneur : images en ligne intactes).
 *  J. Aucune sélection de texte native après les glisser.
 *  K. Compteur « N œuvres · M projets » calculé depuis la page.
 *
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… SHOTS=/root/shots-v013 node scripts/e2e-v013.mjs
 *         BROWSER=firefox ONLY=J node scripts/e2e-v013.mjs   (sélection seulement)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium, firefox } from "playwright";
import sharp from "sharp";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const DB = path.join(process.env.DATA_DIR ?? "data", "portfolio.db");
const SHOTS = process.env.SHOTS ?? "screenshots/v013";
const ONLY = process.env.ONLY ?? "";
const ENGINE = process.env.BROWSER === "firefox" ? firefox : chromium;
mkdirSync(SHOTS, { recursive: true });
const PROJECT = "Atelier des brumes";

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
const draftOf = (id = 1) => JSON.parse(q("select draft from pages where id = ?", id)[0]?.draft ?? "null");
const findIn = (blocks, pred) => {
  for (const b of blocks ?? []) {
    if (pred(b)) return b;
    const c = findIn(b.props?.children, pred);
    if (c) return c;
  }
  return null;
};

const launchArgs = ENGINE === chromium ? { args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] } : {};
const browser = await ENGINE.launch(launchArgs);
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());

await page.goto(`${BASE}/admin/connexion`, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL);
await page.fill("#password", PASSWORD);
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/admin/connexion"), { timeout: 90000 }), page.click("button[type=submit]")]);

/* ---- Aides ------------------------------------------------------------------ */

async function canvas(p = page) {
  const handle = await p.waitForSelector("iframe.ve-frame", { timeout: 90000 });
  const f = await handle.contentFrame();
  await f.waitForSelector("html[data-edit-mode]", { timeout: 120000 });
  return f;
}
async function settled(p = page) {
  await p.waitForFunction(() => !/Enregistrement/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, { timeout: 90000 });
  await sleep(400);
}
const until = (f, fn, arg, timeout = 60000) =>
  f.waitForFunction(fn, arg, { timeout, polling: 200 }).then(
    () => true,
    () => false,
  );
async function openEditor(id = 1) {
  await page.goto(`${BASE}/admin/pages/${id}/editer`, { waitUntil: "domcontentloaded" });
  const f = await canvas();
  // KEEP=1 : reprend le brouillon laissé par un essai précédent (sections enchaînées en plusieurs fois).
  if (process.env.KEEP !== "1" && (await page.getByRole("button", { name: "Abandonner les modifications" }).count())) {
    await page.getByRole("button", { name: "Abandonner les modifications" }).click();
    await Promise.all([
      page.waitForEvent("framenavigated", { predicate: (fr) => fr === page.mainFrame(), timeout: 60000 }),
      page.getByRole("dialog").getByRole("button", { name: "Abandonner les modifications" }).click(),
    ]);
    return canvas();
  }
  return f;
}
async function frameBox() {
  return page.locator("iframe.ve-frame").boundingBox();
}
/** Point d'un élément de la toile, en coordonnées de la page. */
async function framePoint(f, selector, where = "center") {
  // La toile se rafraîchit après un enregistrement : l'élément peut être
  // momentanément absent ou sans boîte (rendu en cours) ; on l'attend.
  let box = null;
  for (let i = 0; i < 60 && !box; i++) {
    box = await f.locator(selector).first().boundingBox({ timeout: 2000 }).catch(() => null);
    if (!box) await sleep(500);
  }
  if (!box) throw new Error(`introuvable : ${selector}`);
  const x = where === "left" ? box.x + 6 : where === "right" ? box.x + box.width - 6 : box.x + box.width / 2;
  const y = where === "top" ? box.y + 20 : where === "bottom" ? box.y + box.height - 20 : box.y + Math.min(box.height / 2, 140);
  return { x, y };
}
async function dragTo(from, to, shot) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y + 6, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 18 });
  await sleep(350);
  if (shot) await shot();
  await page.mouse.up();
}
async function dragPalette(key, to, shot) {
  await page.getByRole("tab", { name: "Ajouter" }).click();
  const card = page.locator(`.ve-card[data-key="${key}"]`);
  await card.scrollIntoViewIfNeeded();
  const b = await card.boundingBox();
  await dragTo({ x: b.x + b.width / 2, y: b.y + b.height / 2 }, to, shot);
}
async function dragMedia(mediaId, to, shot) {
  await page.getByRole("tab", { name: "Médias" }).click();
  const thumb = page.locator(`.ve-media li[data-media="${mediaId}"]`);
  await thumb.scrollIntoViewIfNeeded();
  const b = await thumb.boundingBox();
  await dragTo({ x: b.x + b.width / 2, y: b.y + b.height / 2 }, to, shot);
}
/** Fait défiler la toile pour que l'élément soit au milieu. */
async function center(f, selector) {
  await f.evaluate((sel) => {
    const el = document.querySelector(sel);
    const target = el?.getBoundingClientRect().height ? el : [...(el?.querySelectorAll("*") ?? [])].find((x) => x.getBoundingClientRect().height);
    if (target) window.scrollTo({ top: window.scrollY + target.getBoundingClientRect().top - 160, behavior: "instant" });
  }, selector);
  await sleep(350);
}
/** Plus aucune sélection de texte native, dans l'éditeur et dans la toile. */
async function noSelection(f) {
  const outer = await page.evaluate(() => (window.getSelection()?.toString() ?? "").trim());
  const inner = await f.evaluate(() => (window.getSelection()?.toString() ?? "").trim());
  return { outer, inner, ok: !outer && !inner };
}
const sel = {
  container: '[data-edit-block][data-edit-type="featured-project"]',
  board: `[data-edit-board][data-edit-board-label="${PROJECT}"]`,
};
const run = (k) => !ONLY || ONLY.split(",").includes(k);

let f = await openEditor(1);
await sleep(1500);
const images = q("select id from media where status = 'ready' and mime like 'image/%' order by id limit 3").map((r) => r.id);

/* ---- A. En-tête non collant dans la toile -------------------------------------- */

if (run("A")) {
  await f.evaluate(() => window.scrollTo({ top: 1400, behavior: "instant" }));
  await sleep(500);
  const a = await f.evaluate(() => ({ pos: getComputedStyle(document.querySelector(".site-header")).position, top: document.querySelector(".site-header").getBoundingClientRect().top }));
  ok("A1 toile (édition) : en-tête statique, sorti de l'écran après défilement", a.pos === "static" && a.top < -40, JSON.stringify(a));
  await page.screenshot({ path: `${SHOTS}/A-entete-non-collant-apres-defilement.png` });
  await page.getByRole("button", { name: "Aperçu", exact: true }).click();
  await sleep(800);
  const p = await f.evaluate(() => ({ pos: getComputedStyle(document.querySelector(".site-header")).position, canvas: document.documentElement.hasAttribute("data-edit-canvas") }));
  ok("A2 aperçu exact : comportement du thème (collant)", p.pos === "sticky" && !p.canvas, JSON.stringify(p));
  await page.keyboard.press("Escape");
  await sleep(600);
  const pub = await ctx.browser().newContext({ viewport: { width: 1440, height: 900 } });
  const pp = await pub.newPage();
  await pp.goto(`${BASE}/fr`, { waitUntil: "domcontentloaded" });
  ok("A3 site public : en-tête collant inchangé", (await pp.evaluate(() => getComputedStyle(document.querySelector(".site-header")).position)) === "sticky");
  await pub.close();
  await f.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
}

/* ---- B. Conteneur « Projet mis en avant » --------------------------------------- */

if (run("B")) {
  // Déposé entre l'ouverture et les tuiles.
  const between = await f.evaluate(() => {
    const els = [...document.querySelectorAll("[data-edit-block]:not([data-edit-parent])")];
    const box = (el) => {
      const r = [...el.querySelectorAll("*")].map((c) => c.getBoundingClientRect()).filter((r) => r.height);
      return { top: Math.min(...r.map((x) => x.top)), bottom: Math.max(...r.map((x) => x.bottom)) };
    };
    return (box(els[0]).bottom + box(els[1]).top) / 2;
  });
  const fb = await frameBox();
  await dragPalette("featured-project", { x: fb.x + fb.width / 2, y: fb.y + Math.min(between, fb.height - 40) });
  ok("B1 conteneur posé : choix du projet sur la toile (combobox)", await until(f, () => Boolean(document.querySelector(".pe-container-picker input[role=combobox]"))));
  await settled();
  const d = draftOf();
  const cont = findIn(d.blocks, (b) => b.type === "featured-project" && !b.props.project);
  ok("B2 composants par défaut : titre lié au projet + planche", cont?.props.children?.map((c) => c.type).join(",") === "section-title,project-board" && cont.props.children[0].props.linked === true, JSON.stringify(cont?.props.children));
  const input = f.locator(".pe-container-picker input[role=combobox]");
  await input.fill(PROJECT);
  await sleep(300);
  ok("B3 la liste propose « Créer « … » »", (await f.locator(".pe-combo-opt[data-kind=create]").textContent())?.includes(PROJECT));
  await page.screenshot({ path: `${SHOTS}/B-choix-du-projet.png` });
  await input.press("Enter");
  ok("B4 projet créé : la planche du conteneur apparaît", await until(f, (s) => Boolean(document.querySelector(s)), sel.board));
  await settled();
  const created = q("select id, slug, draft_page_id p from projects where json_extract(title,'$.fr') = ?", PROJECT)[0];
  ok("B5 projet en brouillon de la page, cité par le conteneur", created?.p === 1 && findIn(draftOf().blocks, (b) => b.type === "featured-project")?.props.project === created.slug, JSON.stringify(created));
  // Sélection du conteneur par son fil d'Ariane depuis un composant.
  await center(f, sel.board);
  await f.locator(`${sel.container} [data-edit-block][data-edit-type="section-title"] h2`).first().click();
  ok("B6 clic sur un composant : il est choisi, fil d'Ariane « Projet mis en avant › Titre »", await until(f, () => /Projet mis en avant\s*›\s*Titre/.test(document.querySelector(".pe-crumbs")?.textContent ?? "")));
  await f.locator(".pe-crumbs .pe-crumb").first().click();
  ok("B7 le fil d'Ariane remonte au conteneur", await until(f, () => (document.querySelector(".pe-crumbs")?.textContent ?? "").trim() === "Projet mis en avant"));
  await sleep(300);
  await page.screenshot({ path: `${SHOTS}/B-conteneur-selectionne-avec-composants.png` });
  await page.getByRole("tab", { name: "Structure" }).click();
  await sleep(300);
  ok("B8 structure : arbre indenté (composants au niveau 2)", (await page.locator('.ve-tree [role=treeitem][aria-level="2"]').count()) >= 2);
  await page.screenshot({ path: `${SHOTS}/B-arbre-du-panneau.png` });
}

/* ---- C. Images dans la planche du conteneur, à une position ---------------------- */

if (run("C")) {
  await center(f, sel.board);
  await dragMedia(images[0], await framePoint(f, `${sel.board} [data-edit-rail]`, "left"));
  ok("C1 1er média déposé dans la planche du conteneur", await until(f, (s) => document.querySelectorAll(`${s} [data-edit-slot]`).length === 1, sel.board));
  await settled();
  // Le 2e AVANT le premier (bord gauche).
  await dragMedia(images[1], await framePoint(f, `${sel.board} [data-edit-slot]`, "left"), async () => {
    ok("C2 curseur d'insertion pendant le glisser", (await f.locator(".pe-drop-cursor").count()) === 1);
  });
  ok("C3 2e média placé en première position", await until(f, (s) => document.querySelectorAll(`${s} [data-edit-slot]`).length === 2, sel.board));
  await settled();
  const png = await sharp({ create: { width: 300, height: 220, channels: 3, background: "#3a6fc0" } }).png().toBuffer();
  const gap = await f.evaluate((s) => {
    const els = [...document.querySelectorAll(`${s} [data-edit-rail] > [data-edit-slot]`)];
    const r0 = els[0].getBoundingClientRect();
    const r1 = els[1].getBoundingClientRect();
    return { x: (r0.right + r1.left) / 2, y: r0.top + Math.min(r0.height / 2, 120) };
  }, sel.board);
  const dt = await f.evaluateHandle((bytes) => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array(bytes)], "au-milieu.png", { type: "image/png" }));
    return data;
  }, [...png]);
  const rail = f.locator(`${sel.board} [data-edit-rail]`);
  await rail.dispatchEvent("dragover", { dataTransfer: dt, clientX: gap.x, clientY: gap.y });
  await rail.dispatchEvent("drop", { dataTransfer: dt, clientX: gap.x, clientY: gap.y });
  ok("C4 fichier déposé ENTRE les deux : 3 images, le fichier au milieu", await until(f, (s) => document.querySelectorAll(`${s} [data-edit-slot]`).length === 3, sel.board, 120000));
  await settled();
  const project = q("select id from projects where json_extract(title,'$.fr') = ?", PROJECT)[0];
  const order = q("select media_id m, draft_state s from slots where project_id = ? order by draft_position", project.id).map((r) => r.m);
  ok("C5 ordre en brouillon : média 2, fichier, média 1", order[0] === images[1] && order[2] === images[0] && order[1] !== images[0] && order[1] !== images[1], JSON.stringify(order));
  const s = await noSelection(f);
  ok("J1 aucune sélection de texte après les glisser de médias", s.ok, JSON.stringify(s));
}

/* ---- D. Glisser dans / hors du conteneur ---------------------------------------- */

if (run("D")) {
  await center(f, sel.container);
  // « Texte » de la palette DANS le conteneur, entre le titre et la planche.
  const title = await framePoint(f, `${sel.container} [data-edit-type="section-title"] h2`, "bottom");
  await dragPalette("rich-text", { x: title.x, y: title.y + 40 }, async () => {
    ok("D1 repère intérieur + cadre du conteneur pendant le glisser", (await f.locator(".pe-marker-inner").count()) === 1 && (await f.locator(".pe-drop-container:not([data-refused])").count()) === 1);
    await page.screenshot({ path: `${SHOTS}/D-depot-a-l-interieur-du-conteneur.png` });
  });
  await settled();
  let cont = findIn(draftOf().blocks, (b) => b.type === "featured-project");
  ok("D2 « Texte » ajouté DANS le conteneur, en 2e position", cont?.props.children?.map((c) => c.type).join(",") === "section-title,rich-text,project-board", JSON.stringify(cont?.props.children?.map((c) => c.type)));
  const textUid = cont.props.children[1].uid;
  // Composant non accepté (Contact) glissé sur le conteneur : refusé, rien n'est ajouté.
  const blocksBefore = draftOf().blocks.length;
  const inside = await framePoint(f, `${sel.container} [data-edit-type="rich-text"] section`);
  await dragPalette("contact", inside, async () => {
    ok("D3 bloc non accepté : repère « refusé » sur le conteneur", (await f.locator(".pe-drop-container[data-refused]").count()) === 1);
    await page.screenshot({ path: `${SHOTS}/D-depot-refuse.png` });
  });
  await settled();
  const after = draftOf().blocks;
  ok("D4 refus : rien d'ajouté (ni dans le conteneur, ni sur la page)", after.length === blocksBefore && !findIn(findIn(after, (b) => b.type === "featured-project").props.children, (b) => b.type === "contact"));
  // Sortir le Texte du conteneur (barre : ⇱), puis le refaire entrer par la poignée.
  await center(f, sel.container);
  await f.locator(`[data-edit-block="${textUid}"] p`).first().click();
  await f.locator('.pe-tools button[aria-label="Sortir du conteneur"]').click();
  await settled();
  let top = draftOf().blocks;
  const ci = top.findIndex((b) => b.type === "featured-project");
  ok("D5 « Sortir du conteneur » : le Texte est sur la page, juste après lui", top[ci + 1]?.uid === textUid, JSON.stringify(top.map((b) => b.type)));
  await center(f, `[data-edit-block="${textUid}"]`);
  await f.locator(`[data-edit-block="${textUid}"] p`).first().click();
  await sleep(300);
  const g2 = await f.locator(".pe-selected .pe-grip").boundingBox();
  const intoTitle = await framePoint(f, `${sel.container} [data-edit-type="section-title"] h2`, "bottom");
  await dragTo({ x: g2.x + g2.width / 2, y: g2.y + g2.height / 2 }, { x: intoTitle.x, y: intoTitle.y + 30 });
  await settled();
  cont = findIn(draftOf().blocks, (b) => b.type === "featured-project");
  ok("D6 poignée : le Texte rentre dans le conteneur", cont.props.children.some((c) => c.uid === textUid), JSON.stringify(cont.props.children.map((c) => c.type)));
  const s = await noSelection(f);
  ok("J2 aucune sélection de texte après les glisser de blocs", s.ok, JSON.stringify(s));
}

/* ---- E. Grille de vidéos ---------------------------------------------------------- */

if (run("E")) {
  const fb = await frameBox();
  // Déposée en fin de page (au-dessus du pied).
  await f.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
  await sleep(400);
  const contactTop = await framePoint(f, '[data-edit-block][data-edit-type="contact"]:not([data-edit-parent]) h2', "bottom");
  await dragPalette("grid-videos", { x: fb.x + fb.width / 2, y: Math.min(contactTop.y + 160, fb.y + fb.height - 30) });
  await settled();
  let grid = findIn(draftOf().blocks, (b) => b.type === "grid");
  ok("E1 grille de vidéos : 3 vidéos à choisir, agencement 1 grand + 2", grid?.props.layout === "1+2" && grid.props.children.length === 3 && grid.props.children.every((c) => c.type === "video-single"), JSON.stringify(grid?.props));
  const gridSel = `[data-edit-block="${grid.uid}"]`;
  await center(f, gridSel);
  // Les repères « Choisir une vidéo » se posent après le rendu de la grille : on attend (course constatée en CI).
  await until(f, (s) => document.querySelectorAll(s).length === 3, `${gridSel} .pe-media-video`, 15000);
  ok("E2 « Choisir une vidéo » sur la toile", (await f.locator(`${gridSel} .pe-media-video`).count()) === 3);
  await page.screenshot({ path: `${SHOTS}/E-video-a-choisir.png` });
  await f.locator(`${gridSel} .pe-media-video`).first().click();
  await f.locator(".pe-crumbs .pe-crumb").first().click();
  await f.locator(".pe-tools .pe-tool-text", { hasText: "Agencement" }).click();
  await sleep(300);
  await page.screenshot({ path: `${SHOTS}/E-selecteur-d-agencement.png` });
  await f.locator('.pe-layouts button[aria-label="4 petits (2 × 2)"]').click();
  await settled();
  grid = findIn(draftOf().blocks, (b) => b.type === "grid");
  ok("E3 agencement changé (2 × 2) sans perdre de composant", grid.props.layout === "2x2" && grid.props.children.length === 3);
  ok("E4 cellule libre « + » sur la toile", await until(f, (s) => document.querySelectorAll(`${s} [data-edit-cell-free]`).length === 1, gridSel));
  await center(f, gridSel);
  await page.screenshot({ path: `${SHOTS}/E-grille-avec-cellule-vide.png` });
  // Vidéo (fichier) déposée sur la 2e cellule précisément.
  const mp4 = "/tmp/e2e-v013.mp4";
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=12:duration=2", "-pix_fmt", "yuv420p", "-c:v", "libx264", mp4]);
  const bytes = [...readFileSync(mp4)];
  const second = f.locator(`${gridSel} .pe-media-video`).nth(1);
  const sb = await second.boundingBox();
  const vdt = await f.evaluateHandle((b) => {
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array(b)], "plan.mp4", { type: "video/mp4" }));
    return data;
  }, bytes);
  const fb2 = await frameBox();
  await second.dispatchEvent("dragover", { dataTransfer: vdt, clientX: sb.x - fb2.x + sb.width / 2, clientY: sb.y - fb2.y + sb.height / 2 });
  await second.dispatchEvent("drop", { dataTransfer: vdt, clientX: sb.x - fb2.x + sb.width / 2, clientY: sb.y - fb2.y + sb.height / 2 });
  let ok2 = false;
  for (let i = 0; i < 150 && !ok2; i++) {
    await sleep(1000);
    const g = findIn(draftOf().blocks, (b) => b.type === "grid");
    ok2 = Boolean(g?.props.children[1]?.props.mediaId) && !g.props.children[0].props.mediaId && !g.props.children[2].props.mediaId;
  }
  ok("E5 vidéo déposée dans la 2e cellule précisément (envoi + conversion)", ok2);
  await settled();
}

/* ---- F. Supprimer le conteneur : confirmation qui compte --------------------------- */

if (run("F")) {
  await center(f, sel.container);
  await f.locator(`${sel.container} [data-edit-type="section-title"] h2`).first().click();
  await f.locator(".pe-crumbs .pe-crumb").first().click();
  await f.locator('.pe-tools button[aria-label="Supprimer"]').click();
  const dialog = page.getByRole("dialog");
  ok("F1 confirmation : nombre de composants retirés", /3 composants seront retirés/.test((await dialog.textContent()) ?? ""), (await dialog.textContent())?.slice(0, 200));
  ok("F2 avertissement : les changements d'images de la planche ne seront pas publiés", /ne seront pas publiés/.test((await dialog.textContent()) ?? ""));
  await page.screenshot({ path: `${SHOTS}/F-suppression-du-conteneur.png` });
  await dialog.getByRole("button", { name: "Annuler" }).click();
}

/* ---- G. En-tête et pied (communs) -------------------------------------------------- */

if (run("G")) {
  await f.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await sleep(300);
  await page.getByRole("tab", { name: "Réglages" }).click();
  await f.locator(".site-header .site-header-bar").click({ position: { x: 600, y: 20 } });
  ok("G1 en-tête sélectionné : « commun à toutes les pages », réglages dans le panneau", await until(f, () => /commun à toutes les pages/.test(document.querySelector(".pe-selected.pe-global .pe-tag")?.textContent ?? "")) && (await page.locator('[data-testid="site-editor"]').count()) === 1);
  await page.screenshot({ path: `${SHOTS}/G-entete-selectionne.png` });
  await f.locator('[data-testid="nav-add"]').click();
  await f.getByLabel("Texte du lien").fill("Boutique");
  await f.getByLabel("Adresse").fill("https://boutique.example.org/");
  await sleep(200);
  await page.screenshot({ path: `${SHOTS}/G-ajout-d-un-lien.png` });
  await f.getByRole("button", { name: "Ajouter ce lien" }).click();
  ok("G2 lien libre ajouté au menu (brouillon du site)", await until(f, () => [...document.querySelectorAll(".site-header nav [data-nav-item]")].some((a) => a.textContent.includes("Boutique"))));
  await settled();
  const decors = f.locator('.site-header nav [data-site-inline="nav"]', { hasText: "Décors" });
  await decors.dblclick();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Paysages");
  await page.keyboard.press("Enter");
  ok("G3 lien du menu renommé en place", await until(f, () => [...document.querySelectorAll(".site-header nav [data-site-inline=nav]")].some((a) => a.textContent === "Paysages")));
  await settled();
  // Réseaux (pied de page) : classique, puis « Autre lien ».
  await f.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
  await sleep(400);
  await f.locator('[data-testid="social-add"]').first().click();
  await sleep(200);
  await page.screenshot({ path: `${SHOTS}/G-menu-plus-reseau.png` });
  await f.getByRole("menuitem", { name: "Behance" }).click();
  await f.getByLabel("Adresse du profil").fill("https://www.behance.net/camille");
  await f.getByRole("button", { name: "Ajouter", exact: true }).click();
  await settled();
  await f.locator('[data-testid="social-add"]').first().click();
  await f.getByRole("menuitem", { name: "Autre lien" }).click();
  await f.getByLabel("Adresse du profil").fill("https://carnet.example.net/");
  await f.getByLabel(/Nom affiché/).fill("Mon carnet");
  await f.getByRole("button", { name: "Ajouter", exact: true }).click();
  await settled();
  const site = JSON.parse(q("select value from settings where key = 'siteDraft'")[0]?.value ?? "null");
  ok("G4 réseaux ajoutés au brouillon du site (Behance reconnu, Autre lien)", site?.snap.socials.some((s) => s.kind === "behance") && site.snap.socials.some((s) => s.label === "Mon carnet" && s.kind === "website"), JSON.stringify(site?.snap.socials));
  ok("G5 rien de public avant Publier", !JSON.parse(q("select value from settings where key = 'nav'")[0].value).some((i) => i.kind === "link"));
  ok("G6 bandeau : « En-tête modifié … sur toutes les pages »", /toutes les pages/.test((await page.locator(".ve-site-chip").textContent()) ?? ""));
}

/* ---- H. Ouverture ----------------------------------------------------------------- */

if (run("H")) {
  await f.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await sleep(300);
  await page.evaluate(() => {
    window.__texts = [];
    window.addEventListener("message", (e) => e.data?.kind === "text" && window.__texts.push(JSON.stringify(e.data)));
  });
  // Sur le texte lui-même (à gauche) : la boîte de l'étiquette est large, le titre géant la chevauche au centre.
  await f.locator('[data-edit-type="hero"] [data-inline="eyebrow"]').dblclick({ position: { x: 30, y: 8 } });
  await sleep(300);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Portfolio — 2026");
  await page.keyboard.press("Enter");
  await settled();
  const hero = draftOf().blocks.find((b) => b.type === "hero");
  ok("H1 ouverture : étiquette modifiée en place", hero?.props.eyebrow.fr === "Portfolio — 2026", JSON.stringify(hero?.props.eyebrow));
  const center0 = await framePoint(f, '[data-edit-type="hero"] section.hero');
  await dragMedia(images[2], { x: center0.x, y: center0.y + 120 });
  await settled();
  ok("H2 fond de l'ouverture remplacé par un média de la médiathèque", draftOf().blocks.find((b) => b.type === "hero")?.props.backgroundMediaId === images[2]);
  await f.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await f.locator('[data-edit-type="hero"] h1').click();
  await sleep(500);
  await page.screenshot({ path: `${SHOTS}/H-ouverture-selectionnee.png` });
}

/* ---- I. Publication, rendu public, correction I1 ----------------------------------- */

const published = () => until(page, () => /^Publié/.test(document.querySelector(".ve-status")?.textContent?.trim() ?? "") && !document.querySelector(".ve-alert[role=alert]"), null, 90000);

if (run("I")) {
  // Les vidéos encore à choisir bloquent la publication : on y glisse la vidéo envoyée en E.
  const grid = findIn(draftOf().blocks, (b) => b.type === "grid");
  const video = grid?.props.children.find((c) => c.props.mediaId)?.props.mediaId;
  if (grid && video) {
    await page.getByRole("button", { name: "Publier" }).click();
    ok("I0 publication refusée tant qu'une vidéo est à choisir (bloc signalé)", await until(page, () => /Publication impossible|corrige/.test(document.querySelector(".ve-alert")?.textContent ?? ""), null, 30000));
    for (let n = 0; n < 2; n++) {
      if (!(await f.locator(`[data-edit-block="${grid.uid}"] .pe-media-video`).count())) break;
      await center(f, `[data-edit-block="${grid.uid}"] .pe-media-video`);
      const target = await framePoint(f, `[data-edit-block="${grid.uid}"] .pe-media-video`);
      await dragMedia(video, target);
      await settled();
    }
    ok("I0b vidéos placées dans les cellules restantes", findIn(draftOf().blocks, (b) => b.type === "grid").props.children.every((c) => c.props.mediaId));
  }
  await page.getByRole("button", { name: "Publier" }).click();
  ok("I1 publication acceptée", await published());
  const pub = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pp = await pub.newPage();
  await pp.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  const html = await pp.content();
  ok("I2 public : le projet du conteneur et sa planche (3 images)", html.includes(PROJECT) && (await pp.locator(`section[aria-labelledby^="project-"] .strip-rail img`).count()) >= 3);
  ok("I3 public : aucun repère d'édition", !/data-edit-|pe-media-empty|data-edit-cell-free/.test(html));
  ok("I4 public : menu publié (Boutique, Paysages)", (await pp.locator(".site-header nav").first().textContent()).includes("Boutique") && (await pp.locator(".site-header nav").first().textContent()).includes("Paysages"));
  const behance = pp.locator('footer a[href="https://www.behance.net/camille"]');
  ok("I5 public : réseau avec rel noopener noreferrer me et target _blank", (await behance.getAttribute("rel")) === "noopener noreferrer me" && (await behance.getAttribute("target")) === "_blank");
  ok("I6 public : fond de l'ouverture = média choisi", (await pp.locator(".hero .hero-backdrop img").count()) === 1);
  await pp.screenshot({ path: `${SHOTS}/I-rendu-public-apres-publication.png`, fullPage: false });
  await pub.close();

  // I1 : une planche retirée (avec son conteneur) n'efface pas les images en ligne.
  f = await openEditor(1);
  const project = q("select id from projects where json_extract(title,'$.fr') = ?", PROJECT)[0];
  const before = q("select id, media_id m, position p from slots where project_id = ? order by position", project.id);
  await center(f, sel.board);
  const slot = f.locator(`${sel.board} [data-edit-slot]`).first();
  await slot.hover();
  await f.locator(".pe-slot-tools button", { hasText: "Retirer la place" }).click();
  await settled();
  ok("I7 brouillon : place retirée dans la planche du conteneur", q("select count(*) n from slots where project_id = ? and draft_state = 'retired'", project.id)[0].n === 1);
  await f.locator(`${sel.container} [data-edit-type="section-title"] h2`).first().click();
  await f.locator(".pe-crumbs .pe-crumb").first().click();
  await f.locator('.pe-tools button[aria-label="Supprimer"]').click();
  await page.getByRole("dialog").getByRole("button", { name: /Supprimer/ }).click();
  await settled();
  await page.getByRole("button", { name: "Publier" }).click();
  ok("I8 publication sans le conteneur", await published());
  const after = q("select id, media_id m, position p from slots where project_id = ? order by position", project.id);
  ok("I9 correction I1 : images du projet en ligne intactes (surcouche non appliquée)", JSON.stringify(after) === JSON.stringify(before), `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  ok("I10 surcouche effacée", q("select count(*) n from slots where project_id = ? and draft_page_id is not null", project.id)[0].n === 0);
}

/* ---- K. Compteur de la page Personnages ------------------------------------------- */

if (run("K")) {
  const pub = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pp = await pub.newPage();
  await pp.goto(`${BASE}/fr/personnages`, { waitUntil: "domcontentloaded" });
  const counter = (await pp.locator("header .eyebrow.mt-6").textContent())?.trim();
  const boards = await pp.locator("section.strip").count();
  const works = await pp.locator("section.strip .strip-rail > *").count();
  ok("K1 compteur = planches et œuvres réellement sur la page", counter?.includes(String(boards)) && counter.includes(String(works)), `${counter} / ${boards} planches, ${works} œuvres`);
  await pub.close();
  f = await openEditor(2);
  ok("K2 toile : info-bulle « Compté automatiquement… »", (await f.locator("[data-edit-counter]").getAttribute("title"))?.startsWith("Compté automatiquement"));
}

/* ---- L. Formulaire de contact (page À propos) ------------------------------------- */

if (run("L")) {
  const about = q("select id from pages where json_extract(slug,'$.fr') = 'a-propos'")[0].id;
  f = await openEditor(about);
  await f.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
  await sleep(400);
  const fb = await frameBox();
  const prof = await framePoint(f, '[data-edit-type="profile"] section', "bottom");
  await dragPalette("contact-form", { x: fb.x + fb.width / 2, y: Math.min(prof.y + 60, fb.y + fb.height - 30) });
  await settled();
  let block = draftOf(about).blocks.find((b) => b.type === "contact-form");
  ok("L1 formulaire posé : 3 champs par défaut (nom, e-mail de réponse, message)", block?.props.fields.length === 3 && block.props.fields[1].reply === true);
  const formSel = `[data-edit-block="${block.uid}"]`;
  await center(f, `${formSel} form`);
  await f.locator(`${formSel} [data-testid="field-add"]`).click().catch(async () => f.locator('[data-testid="field-add"]').click());
  await f.getByRole("menuitem", { name: "Texte court" }).click();
  await settled();
  block = draftOf(about).blocks.find((b) => b.type === "contact-form");
  ok("L2 champ ajouté (texte court)", block.props.fields.length === 4 && block.props.fields[3].type === "text");
  await center(f, `${formSel} [data-form-field="3"]`);
  await f.locator(`${formSel} [data-form-field="3"] [data-inline="fields.3.label"]`).dblclick({ position: { x: 10, y: 6 } });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Ton studio");
  await page.keyboard.press("Enter");
  await settled();
  block = draftOf(about).blocks.find((b) => b.type === "contact-form");
  ok("L3 champ renommé en place", block.props.fields[3].label.fr === "Ton studio");
  // Retirer le champ e-mail de réponse : refusé (averti).
  await f.locator(`${formSel} [data-form-field="1"]`).hover();
  await f.locator('.pe-item-tools[data-kind="field"] button[aria-label="Retirer ce champ"]').click();
  await sleep(500);
  ok("L4 le champ e-mail de réponse n'est pas retiré (avertissement)", draftOf(about).blocks.find((b) => b.type === "contact-form").props.fields.length === 4);
  // Formulaire choisi, message de confirmation montré depuis le panneau.
  await f.locator(`${formSel} h2`).click();
  await page.getByRole("tab", { name: "Réglages" }).click();
  await page.getByRole("button", { name: "Voir le message de confirmation" }).click();
  await sleep(600);
  ok("L5 « Voir le message de confirmation » le montre sur la toile", await f.locator(`${formSel} [data-form-pane="success"]`).isVisible());
  await center(f, `${formSel} form`);
  await page.screenshot({ path: `${SHOTS}/L-formulaire-selectionne.png` });
  await page.getByRole("button", { name: "Publier" }).click();
  ok("L6 publication", await published());
  const formId = JSON.parse(q("select props from blocks where page_id = ? and type = 'contact-form'", about)[0]?.props ?? "{}").formId;
  const pub = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pp = await pub.newPage();
  await pp.goto(`${BASE}/fr/a-propos`, { waitUntil: "networkidle" });
  ok("L7 public : ni repère d'édition, ni objet ni réglage d'envoi dans la page", !/data-form-field|data-inline|Message depuis le site/.test(await pp.content()));
  const fields = block.props.fields;
  await pp.fill(`#cf-${fields[0].id}`, "Lou");
  await pp.fill(`#cf-${fields[1].id}`, "lou@exemple.fr");
  await pp.fill(`#cf-${fields[2].id}`, "Bonjour !");
  await pp.fill(`#cf-${fields[3].id}`, "Studio Brume");
  await pp.getByRole("button", { name: /Envoyer/ }).click();
  ok("L8 envoi public validé : message de confirmation", await until(pp, () => /Merci/.test(document.querySelector("[role=status]")?.textContent ?? ""), null, 30000));
  const msg = q("select fields, reply_to r from messages order by id desc limit 1")[0];
  ok("L9 message rangé avec le nouveau champ et l'adresse de réponse", msg && JSON.parse(msg.fields).some((x) => x.label === "Ton studio" && x.value === "Studio Brume") && msg.r === "lou@exemple.fr", JSON.stringify(msg));
  const post = (data) => pp.evaluate(async (d) => (await fetch("/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(d) })).status, data);
  const values = { [fields[1].id]: "a@b.fr", [fields[2].id]: "x" };
  ok("L10 champ inconnu rejeté (400)", (await post({ form: formId, locale: "fr", values: { ...values, admin: "1" } })) === 400);
  ok("L11 formulaire inconnu rejeté (404)", (await post({ form: "fpasunformulaire", locale: "fr", values })) === 404);
  const before = q("select count(*) n from messages")[0].n;
  ok("L12 champ piège rempli : « reçu », rien d'enregistré", (await post({ form: formId, locale: "fr", values, website: "spam" })) === 200 && q("select count(*) n from messages")[0].n === before);
  const statuses = [];
  for (let i = 0; i < 5; i++) statuses.push(await post({ form: formId, locale: "fr", values }));
  ok("L13 limite : 5 envois par 10 min et par IP, puis 429", statuses.slice(0, 4).every((s) => s === 200) && statuses[4] === 429, statuses.join(","));
  await pub.close();
}

/* ---- M. Profil : portrait et réseaux sur la toile ---------------------------------- */

if (run("M")) {
  const about = q("select id from pages where json_extract(slug,'$.fr') = 'a-propos'")[0].id;
  f = await openEditor(about);
  await f.locator('[data-edit-type="profile"] [data-edit-media="portraitMediaId"]').hover();
  ok("M1 portrait : « Remplacer » au survol", await until(f, () => [...document.querySelectorAll(".pe-media-tools button")].some((b) => b.textContent === "Remplacer"), null, 10000));
  await f.locator('[data-edit-type="profile"] [data-site-inline="name"]').hover();
  ok("M2 nom du profil : texte commun au site, modifiable en place", (await f.locator('[data-edit-type="profile"] [data-site-inline="name"]').getAttribute("data-site-hint")) === "commun au site");
  await center(f, '[data-edit-type="profile"] [data-edit-socials]');
  const add = f.locator('[data-testid="social-add"]').first();
  ok("M3 profil : « + Réseau » sous la liste des réseaux", (await add.count()) === 1);
  await add.click();
  await sleep(300);
  await page.screenshot({ path: `${SHOTS}/M-profil-menu-plus-reseau.png` });
  await page.keyboard.press("Escape");
}

/* ---- N. Conteneur vide ------------------------------------------------------------ */

if (run("N")) {
  f = await openEditor(1);
  const between = await f.evaluate(() => {
    const els = [...document.querySelectorAll("[data-edit-block]:not([data-edit-parent])")];
    const r = (el) => [...el.querySelectorAll("*")].map((c) => c.getBoundingClientRect()).filter((x) => x.height);
    return (Math.max(...r(els[0]).map((x) => x.bottom)) + Math.min(...r(els[1]).map((x) => x.top))) / 2;
  });
  const fb = await frameBox();
  await dragPalette("featured-project", { x: fb.x + fb.width / 2, y: fb.y + Math.min(between, fb.height - 40) });
  await settled();
  // Projet existant choisi dans la liste (↓ puis Entrée).
  const input = f.locator(".pe-container-picker input[role=combobox]");
  await input.click();
  await page.keyboard.press("ArrowDown");
  await sleep(200);
  const active = await f.locator(".pe-combo-opt[aria-selected=true]").textContent().catch(() => null);
  await page.keyboard.press("Enter");
  let cont = null;
  for (let i = 0; i < 40 && !cont?.props.project; i++) {
    await sleep(300);
    cont = findIn(draftOf()?.blocks ?? [], (b) => b.type === "featured-project");
  }
  await settled();
  ok("N1 projet existant choisi dans la liste (↓ Entrée)", Boolean(cont?.props.project), `option active : ${active}`);
  for (const child of cont.props.children) {
    await center(f, `[data-edit-block="${child.uid}"]`);
    await f.locator(`[data-edit-block="${child.uid}"] *`).filter({ visible: true }).first().click();
    await f.locator('.pe-tools button[aria-label="Supprimer"]').click();
    await page.getByRole("dialog").getByRole("button", { name: /Supprimer/ }).click();
    await settled();
  }
  ok("N2 conteneur vide : zone « Glisse un composant ici »", await until(f, () => /Glisse un composant ici/.test(document.querySelector(".pe-container-dropzone")?.textContent ?? "")));
  await center(f, '[data-edit-block][data-edit-type="featured-project"] .pe-container-empty');
  await page.screenshot({ path: `${SHOTS}/N-conteneur-vide.png` });
  await page.getByRole("button", { name: "Aperçu", exact: true }).click();
  await sleep(600);
  ok("N3 aperçu : aucune boîte fantôme pour le conteneur vide", !(await f.locator(".pe-container-dropzone").count()) && (await f.locator(".pe-container-empty").evaluate((el) => getComputedStyle(el).display)) === "none");
  await page.keyboard.press("Escape");
}

/* ---- P. Accroche de l'ouverture : texte à passage surligné, en place (v0.16) ----------------- */

if (run("P")) {
  // Le thème « Carnet d'atelier » a l'ouverture typographique (l'accroche s'y affiche).
  await page.goto(`${BASE}/api/theme-preview?id=carnet-d-atelier&redirect=/admin`, { waitUntil: "domcontentloaded" });
  f = await openEditor(1);
  await sleep(1000);
  const H = '[data-edit-type="hero"] h1[data-inline="statement"]';
  const statement = (lang = "fr") => draftOf().blocks.find((b) => b.type === "hero")?.props.statement?.[lang];
  ok("P1 accroche repérée sur la toile (ouverture typographique)", (await f.locator(H).count()) === 1, "thème sans accroche affichée ?");
  const before = await f.locator(H).evaluate((el) => el.innerHTML);
  await f.locator(H).scrollIntoViewIfNeeded();
  await f.locator(H).dblclick({ position: { x: 20, y: 20 } });
  ok("P2 double-clic : champ à part, barre « Surligner »", (await until(f, () => Boolean(document.querySelector("[data-marked-edit]")))) && (await until(f, () => Boolean(document.querySelector(".pe-markbar button")))));
  ok("P2b l'enveloppe de React est cachée, pas détruite", await f.locator(`${H} > [data-marked-body]`).evaluate((el) => el.style.display === "none" && el.childNodes.length > 0));
  await page.screenshot({ path: `${SHOTS}/P-accroche-edition.png` });
  // Saisie, puis un mot sélectionné au clavier et surligné par le bouton.
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Je dessine des personnages et des mondes");
  await page.keyboard.press("End");
  for (let i = 0; i < 6; i++) await page.keyboard.press("Shift+ArrowLeft");
  ok("P3 mot sélectionné : bouton « Surligner » actif", await until(f, () => {
    const b = document.querySelector(".pe-markbar button");
    return Boolean(b) && !b.disabled && b.getAttribute("aria-pressed") === "false";
  }));
  await f.locator(".pe-markbar button").click();
  ok("P4 « Surligner » : le mot devient un passage surligné dans le champ", await until(f, () => [...document.querySelectorAll("[data-marked-edit] .hero-mark")].map((e) => e.textContent).join("|") === "mondes"));
  ok("P4b le champ est resté ouvert (le focus n'a pas quitté le texte)", (await f.locator("[data-marked-edit]").count()) === 1);
  await page.keyboard.press("Enter");
  ok("P5 Entrée : aperçu immédiat avec le mot surligné", await until(f, (sel) => document.querySelector(sel + " [data-marked-over] .hero-mark")?.textContent === "mondes", H, 5000));
  await settled();
  ok("P6 stocké balisé <mark> dans le brouillon (fr)", statement() === "Je dessine des personnages et des <mark>mondes</mark>", statement());
  ok("P6b l'autre langue n'a pas bougé", statement("en") !== statement("fr"));
  ok("P6c rendu du serveur : aperçu remplacé par le rendu de React", await until(f, (sel) => !document.querySelector(sel + " [data-marked-over]") && document.querySelector(sel + " [data-marked-body] .hero-mark")?.textContent === "mondes", H, 20000));
  // Retirer le surlignage : le bouton passe à « Retirer le surlignage ».
  await f.locator(H).dblclick({ position: { x: 20, y: 20 } });
  await f.locator("[data-marked-edit] .hero-mark").dblclick();
  ok("P7 curseur sur un mot surligné : le bouton propose de le retirer", await until(f, () => document.querySelector(".pe-markbar button")?.getAttribute("aria-pressed") === "true"));
  await f.locator(".pe-markbar button").click();
  await page.keyboard.press("Enter");
  await settled();
  ok("P8 surlignage retiré : plus de balisage", statement() === "Je dessine des personnages et des mondes", statement());
  // Un mot sans sélection : le mot sous le curseur est surligné.
  await f.locator(H).dblclick({ position: { x: 20, y: 20 } });
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("ArrowRight");
  await f.locator(".pe-markbar button").click();
  await page.keyboard.press("Enter");
  await settled();
  ok("P9 curseur dans un mot (sans sélection) : le mot est surligné", statement()?.startsWith("<mark>Je</mark> dessine"), statement());
  // Aucun HTML : les chevrons saisis sont retirés, rien n'est interprété.
  await f.locator(H).dblclick({ position: { x: 20, y: 20 } });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Salut <img src=x onerror=alert(1)> <b>gras</b>");
  await page.keyboard.press("Enter");
  await settled();
  ok("P10 chevrons retirés à la saisie : aucun HTML dans le brouillon", !/[<>]/.test(statement().replace(/<\/?mark>/g, "")) && !statement().includes("<img"), statement());
  ok("P10b rien d'interprété sur la toile", (await f.locator(`${H} img, ${H} b`).count()) === 0);
  // Balisage forgé : un message de la toile avec du HTML est refusé par l'éditeur ; l'aperçu n'existe pas, le brouillon reste.
  const good = statement();
  const uid = await f.locator('[data-edit-type="hero"]').first().getAttribute("data-edit-block");
  await f.evaluate((u) => window.parent.postMessage({ type: "portfolio:edit", kind: "text", uid: u, path: "statement", locale: "fr", value: "<img src=x onerror=alert(1)>", seq: 90001 }, location.origin), uid);
  await sleep(700);
  ok("P11 balisage étranger forgé : refusé, le brouillon est inchangé", statement() === good, statement());
  ok("P11b message d'erreur affiché", /balisage <mark>/.test((await page.locator("body").textContent()) ?? ""));
  await f.evaluate((u) => window.parent.postMessage({ type: "portfolio:edit", kind: "text", uid: u, path: "statement", locale: "fr", value: "a <mark>b<mark>c</mark></mark>", seq: 90002 }, location.origin), uid);
  await sleep(500);
  ok("P11c imbrication refusée", statement() === good, statement());
  // Anglais : édition dans la langue affichée, l'autre langue intacte.
  const frBefore = statement();
  await page.getByRole("group", { name: "Langue" }).getByRole("button", { name: "EN" }).click();
  f = await canvas();
  await sleep(800);
  await f.locator(H).dblclick({ position: { x: 20, y: 20 } });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("I draw characters");
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("Shift+ArrowRight");
  await f.locator(".pe-markbar button").click();
  await page.keyboard.press("Enter");
  await settled();
  ok("P12 anglais : phrase modifiée et surlignée dans la langue affichée", statement("en") === "<mark>I</mark> draw characters", statement("en"));
  ok("P12b français inchangé", statement("fr") === frBefore, statement("fr"));
  await page.screenshot({ path: `${SHOTS}/P-accroche-en.png` });
  // Annuler (Ctrl+Z) : l'ancienne accroche revient sur la toile.
  await page.locator('button[aria-label="Annuler"]').click();
  ok("P13 Annuler : la toile retrouve l'ancienne accroche", await until(f, (sel) => document.querySelector(sel)?.textContent !== "I draw characters", H, 20000));
  void before;

  // Refus (éditeur arrêté : la page a été modifiée ailleurs) : l'aperçu de l'accroche, qui a plusieurs
  // nœuds, est retiré et l'accroche d'origine revient (rétablissement des textes multi-nœuds).
  await page.getByRole("group", { name: "Langue" }).getByRole("button", { name: "FR" }).click();
  f = await canvas();
  await sleep(800);
  const keep = await f.locator(H).evaluate((el) => el.textContent);
  const bump = new Database(DB);
  bump.prepare("update pages set draft_rev = draft_rev + 1 where id = 1").run();
  bump.close();
  await f.locator(H).dblclick({ position: { x: 20, y: 20 } });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Déclencheur");
  await page.keyboard.press("Enter");
  ok("P14 page modifiée ailleurs : l'éditeur s'arrête", await until(page, () => /modifiée ailleurs/i.test(document.body.textContent ?? ""), null, 30000));
  await f.locator(H).dblclick({ position: { x: 20, y: 20 } });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Accroche refusée");
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("Shift+ArrowRight");
  await f.locator(".pe-markbar button").click();
  await page.keyboard.press("Enter");
  ok("P14b accroche refusée : l'accroche d'origine revient, aucun aperçu ne reste", await until(f, ([sel, t]) => document.querySelector(sel)?.textContent === t && !document.querySelector(sel + " [data-marked-over]") && getComputedStyle(document.querySelector(sel + " [data-marked-body]")).display !== "none", [H, keep], 10000), await f.locator(H).evaluate((el) => el.textContent));
  const unbump = new Database(DB);
  unbump.prepare("update pages set draft_rev = draft_rev - 1 where id = 1").run();
  unbump.close();
}

/* ---- Q. Nom du site en français et en anglais (v0.16) ------------------------------------------ */

if (run("Q")) {
  f = await openEditor(1);
  await sleep(1000);
  const BRAND = '[data-edit-global="header"] [data-site-inline="name"]';
  const siteDraft = () => JSON.parse(q("select value from settings where key = 'siteDraft'")[0]?.value ?? "null")?.snap.identity.name;
  const lang = (l) => page.getByRole("group", { name: "Langue" }).getByRole("button", { name: l });
  const originalName = (await f.locator(BRAND).textContent())?.trim();
  ok("Q1 réglage migré : le nom du site est { fr, en } (en vide)", JSON.parse(q("select value from settings where key = 'site'")[0].value).name?.fr === originalName);
  await f.locator(BRAND).dblclick();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Atelier Camille");
  await page.keyboard.press("Enter");
  await settled();
  ok("Q2 nom modifié en place dans la langue affichée (fr)", siteDraft()?.fr === "Atelier Camille" && siteDraft()?.en === "", JSON.stringify(siteDraft()));
  await lang("EN").click();
  f = await canvas();
  await sleep(800);
  ok("Q3 anglais vide : le nom français est repris", (await f.locator(BRAND).textContent())?.trim() === "Atelier Camille");
  await f.locator(BRAND).dblclick();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Camille's Studio");
  await page.keyboard.press("Enter");
  await settled();
  ok("Q4 nom modifié en place dans la langue affichée (en), le français est intact", siteDraft()?.en === "Camille's Studio" && siteDraft()?.fr === "Atelier Camille", JSON.stringify(siteDraft()));
  ok("Q5 la toile anglaise montre le nom anglais, partout (en-tête, ouverture)", await until(f, () => [...document.querySelectorAll('[data-site-inline="name"]')].every((e) => e.textContent.trim() === "Camille's Studio"), null, 20000));
  // Vider l'anglais : retour au français. Vider le français : refusé.
  await f.locator(BRAND).dblclick();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
  await page.keyboard.press("Enter");
  await settled();
  ok("Q6 anglais vidé : le nom français est repris", siteDraft()?.en === "" && (await until(f, () => document.querySelector('[data-edit-global="header"] [data-site-inline="name"]')?.textContent.trim() === "Atelier Camille", null, 20000)));
  // Panneau : champs FR et EN.
  await f.locator('[data-edit-global="header"]').click({ position: { x: 4, y: 4 }, force: true });
  await page.getByRole("tab", { name: "Réglages" }).click();
  ok("Q7 panneau de l'en-tête : « Nom du site (FR) » et « (EN) »", (await page.getByLabel("Nom du site (FR)").count()) === 1 && (await page.getByLabel("Nom du site (EN)").count()) === 1);
  await page.getByLabel("Nom du site (EN)").fill("Camille Studio");
  await page.getByLabel("Nom du site (EN)").blur();
  await settled();
  ok("Q8 panneau : nom anglais enregistré", siteDraft()?.en === "Camille Studio", JSON.stringify(siteDraft()));
  // Publication : public en français, en anglais, et titre de la page 404.
  await page.getByRole("button", { name: "Publier" }).click();
  ok("Q9 publication acceptée", await published());
  const pub = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pp = await pub.newPage();
  await pp.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  ok("Q10 public fr : « Atelier Camille » en en-tête et au pied de page", (await pp.locator(".site-header .site-brand").first().textContent())?.trim() === "Atelier Camille" && (await pp.locator("footer").textContent())?.includes("Atelier Camille"));
  await pp.goto(`${BASE}/en`, { waitUntil: "networkidle" });
  ok("Q11 public en : « Camille Studio » en en-tête et au pied de page", (await pp.locator(".site-header .site-brand").first().textContent())?.trim() === "Camille Studio" && (await pp.locator("footer").textContent())?.includes("Camille Studio"));
  await pp.goto(`${BASE}/en/page-qui-n-existe-pas`, { waitUntil: "domcontentloaded" });
  ok("Q12 titre de la page 404 anglaise : nom anglais", (await pp.title()).includes("Camille Studio"), await pp.title());
  await pp.goto(`${BASE}/fr/page-qui-n-existe-pas`, { waitUntil: "domcontentloaded" });
  ok("Q12b titre de la page 404 française : nom français", (await pp.title()).includes("Atelier Camille"), await pp.title());
  ok("Q13 réglage publié : { fr, en }", JSON.stringify(JSON.parse(q("select value from settings where key = 'site'")[0].value).name) === JSON.stringify({ fr: "Atelier Camille", en: "Camille Studio" }));
  // Écran Réglages : le nom est fr / en.
  await pp.close();
  const rp = await ctx.newPage();
  await rp.goto(`${BASE}/admin/reglages`, { waitUntil: "domcontentloaded" });
  await rp.getByText("Nom affiché").first().waitFor({ timeout: 60000 });
  const values = await rp.evaluate(() => [...document.querySelectorAll("input")].map((i) => i.value));
  ok("Q14 écran Réglages : nom affiché en français et en anglais", values.includes("Atelier Camille") && values.includes("Camille Studio"), JSON.stringify(values));
  await rp.close();
  await pub.close();
}

/* ---- J. Sélection (seul, pour Firefox) -------------------------------------------- */

if (ONLY === "J") {
  const engine = process.env.BROWSER ?? "chromium";
  f = await openEditor(1);
  const boardSel = "[data-edit-board]";
  await center(f, boardSel);
  const during = [];
  const pt = await framePoint(f, `${boardSel} [data-edit-slot]`, "left");
  await dragMedia(images[0], { x: pt.x, y: pt.y }, async () => {
    during.push(await noSelection(f));
    await page.screenshot({ path: `${SHOTS}/J-pendant-un-glisser-${engine}.png` });
  });
  await settled();
  const fb = await frameBox();
  await dragPalette("rich-text", { x: fb.x + fb.width / 2, y: fb.y + 300 }, async () => during.push(await noSelection(f)));
  await settled();
  await center(f, boardSel);
  const slotBox = await f.locator(`${boardSel} [data-edit-slot]`).nth(1).boundingBox();
  await dragTo({ x: slotBox.x + 30, y: slotBox.y + 40 }, { x: slotBox.x - 60, y: slotBox.y + 40 }, async () => during.push(await noSelection(f)));
  await settled();
  ok(`J3 ${engine} : aucune sélection de texte PENDANT les glisser (média, palette, image de planche)`, during.every((x) => x.ok), JSON.stringify(during));
  const s = await noSelection(f);
  ok(`J4 ${engine} : aucune sélection de texte après`, s.ok, JSON.stringify(s));
  // Le double-clic garde la sélection de texte dans un champ en cours d'édition.
  await f.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await f.locator('[data-edit-type="hero"] [data-inline="eyebrow"]').dblclick({ position: { x: 30, y: 8 } });
  await page.keyboard.press("ControlOrMeta+a");
  const inField = await f.evaluate(() => window.getSelection()?.toString() ?? "");
  ok(`J5 ${engine} : texte sélectionnable dans un champ en cours d'édition`, inField.length > 3, inField);
  await page.keyboard.press("Escape");
}

ok("aucune erreur JavaScript", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `${failures} échec(s)` : "tout est passé");
process.exit(failures ? 1 : 0);
