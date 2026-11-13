#!/usr/bin/env node
/**
 * Éditeur visuel v0.13, UN navigateur (chromium par défaut, BROWSER=firefox
 * pour le contrôle de sélection). Serveur dev requis, sur une base NEUVE
 * (seed : la migration 0014 y est jouée), une connexion.
 *
 *  A. En-tête non collant dans la toile (mode édition) ; collant en aperçu et en public.
 *  B. « Planche d'un projet » glissée depuis la palette : nom du projet saisi sur la
 *     toile (combobox, « Créer »), puis un Titre lié à ce projet (raccourci « Titre »
 *     glissé, projet choisi dans le panneau). v0.19 : le conteneur « Projet mis en
 *     avant » n'existe plus, ce couple le remplace.
 *  C. Images déposées DANS sa planche, à une position précise (média, puis
 *     fichier entre deux).
 *  D. Glisser un composant DANS une grille (repère intérieur), refus pour un
 *     bloc non accepté, sortir un composant, le faire rentrer par la poignée.
 *  E. Grille de vidéos : agencement changé sans perte, vidéo déposée dans une
 *     cellule précise, place libre « + ».
 *  F. Suppression de la grille : confirmation qui compte les composants.
 *  G. En-tête et pied (communs) : lien ajouté, renommé ; réseaux classique et « Autre lien ».
 *  H. Ouverture : texte en place, fond remplacé par un média.
 *  I. Publication et rendu public ; correction I1 (planche retirée de la
 *     page : images en ligne intactes).
 *  J. Aucune sélection de texte native après les glisser.
 *  K. Compteur « N œuvres · M projets » calculé depuis la page.
 *  N. Grille vide : places « + » sur la toile, aucune boîte fantôme en aperçu.
 *
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… SHOTS=/root/shots-v013 node scripts/e2e-v013.mjs
 *         BROWSER=firefox ONLY=J node scripts/e2e-v013.mjs   (sélection seulement)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium, firefox } from "playwright";
import sharp from "sharp";
import { createOnCanvas } from "./lib/projet111.mjs";

import { sharedOk } from "./lib/parts.mjs";

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
  if (process.env.TRACE) console.log("TRACE", Date.now() % 1000000, "--- step");
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
// Compteur de rafraîchissements demandés à la toile (message `refresh`) : une modification n'en doit pas multiplier.
await page.addInitScript(() => {
  if (window.top === window) return;
  window.__refreshes = 0;
  window.addEventListener("message", (e) => {
    if (e.data?.type === "portfolio:edit" && e.data.kind === "refresh") window.__refreshes++;
  });
});
// Réponses RSC (rafraîchissement de la toile) retardées : RSC_DELAY en diagnostic, `rscDelay` dans la section R.
let rscDelay = Number(process.env.RSC_DELAY ?? 0);
await ctx.route(/[?&]_rsc=/, async (route) => {
  if (rscDelay > 0) await sleep(rscDelay);
  await route.continue().catch(() => {});
});
if (process.env.TRACE) {
  // Diagnostic : messages éditeur→toile, retraits de nœuds (barre de surlignage, champ), rechargements de la toile.
  await page.addInitScript(() => {
    if (window.top === window) return;
    const log = (...a) => console.log("TRACE", Date.now() % 1000000, ...a);
    window.addEventListener("message", (e) => e.data?.type === "portfolio:edit" && log("msg", e.data.kind, e.data.rev ?? "", e.data.upTo ?? ""));
    log("frame-load", location.pathname);
    const mo = new MutationObserver((recs) => {
      for (const r of recs)
        for (const n of r.removedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.matches?.(".pe-markbar") || n.querySelector?.(".pe-markbar")) log("removed markbar");
          if (n.matches?.("[data-marked-edit]") || n.querySelector?.("[data-marked-edit]")) log("removed marked-edit via", n.tagName, n.className, n.getAttribute("data-edit-type") ?? "", n.getAttribute("data-edit-block") ?? "", n.children.length);
          if (n.matches?.("[data-marked-body]") || n.querySelector?.("[data-marked-body]")) log("removed marked-body");
        }
    });
    mo.observe(document, { childList: true, subtree: true });
    document.addEventListener("focusout", (e) => e.target?.matches?.("[data-marked-edit]") && log("blur marked-edit"), true);
  });
  page.on("console", (m) => m.text().startsWith("TRACE") && console.log(m.text()));
}

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
/**
 * Éditeur au repos : pas d'enregistrement en cours, la toile a rendu la révision écrite (`[data-edit-rev]` >=
 * `draft_rev`), et plus rien n'est écrit depuis 900 ms (brouillon de la page et du site inchangés). Le rendu du
 * serveur arrive parfois des secondes après l'écriture (VM de 2 Go) et remplace le DOM sous le test ; et une
 * action de la toile (déplacer, sortir un bloc) met un temps à atteindre l'éditeur puis le serveur sans que le
 * statut ne passe par « Enregistrement… » : seul un silence durable de la base dit que c'est fini.
 */
async function settled(p = page) {
  const pageId = Number(/\/admin\/pages\/(\d+)\/editer/.exec(p.url())?.[1]);
  const written = () => `${Number.isFinite(pageId) ? q("select draft_rev as r from pages where id = ?", pageId)[0]?.r : ""}|${q("select value from settings where key = 'siteDraft'")[0]?.value ?? ""}`;
  const t0 = Date.now();
  let last = written();
  let since = Date.now();
  while (Date.now() - since < 900) {
    if (Date.now() - t0 > 90000) break;
    await sleep(100);
    const now = written();
    const busy = await p.evaluate(() => /Enregistrement/.test(document.querySelector(".ve-status")?.textContent ?? ""));
    const rev = Number.isFinite(pageId) ? q("select draft_rev as r from pages where id = ?", pageId)[0]?.r : undefined;
    const frame = p.frames().find((fr) => fr !== p.mainFrame());
    const canvasRev = frame && rev ? await frame.evaluate(() => Number(document.querySelector("[data-edit-rev]")?.getAttribute("data-edit-rev") ?? Infinity)).catch(() => Infinity) : Infinity;
    if (busy || now !== last || canvasRev < rev) {
      last = now;
      since = Date.now();
    }
  }
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
  // Carte du catalogue, ou raccourci Texte (« text », « title », « title-text »).
  const card = page.locator(`.ve-card[data-key="${key}"], .ve-model[data-key="${key}"], .ve-starter[data-starter="${key}"]`).first();
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
  // Grille d'images posée en D (3 images à choisir, puis un Texte) : seul conteneur de la page à cet endroit.
  grid: '[data-edit-block][data-edit-type="grid"]',
  board: `[data-edit-board][data-edit-board-label="${PROJECT}"]`,
};
/** Grille de vidéos de la section E (la première composante est une vidéo). */
const videoGrid = () => findIn(draftOf().blocks, (b) => b.type === "grid" && b.props.children?.[0]?.type === "video-single");
/** Grille d'images de la section D. */
const imageGrid = () => findIn(draftOf().blocks, (b) => b.type === "grid" && b.props.children?.[0]?.type !== "video-single");
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

/* ---- B. Planche neuve et Titre lié à son projet --------------------------------- */

if (run("B")) {
  // Déposée entre l'ouverture et la rubrique suivante.
  const between = await f.evaluate(() => {
    const els = [...document.querySelectorAll("[data-edit-block]:not([data-edit-parent])")];
    const box = (el) => {
      const r = [...el.querySelectorAll("*")].map((c) => c.getBoundingClientRect()).filter((r) => r.height);
      return { top: Math.min(...r.map((x) => x.top)), bottom: Math.max(...r.map((x) => x.bottom)) };
    };
    return (box(els[0]).bottom + box(els[1]).top) / 2;
  });
  const fb = await frameBox();
  await dragPalette("project-board", { x: fb.x + fb.width / 2, y: fb.y + Math.min(between, fb.height - 40) });
  ok("B1 planche posée : nom du projet à saisir sur la toile (combobox)", await until(f, () => Boolean(document.querySelector(".pe-board-new input[role=combobox]"))));
  await settled();
  const input = f.locator(".pe-board-new input[role=combobox]");
  await input.click();
  ok("B2 la liste propose « Nouveau projet » (sans nom)", (await f.locator(".pe-combo-opt[data-kind=create]").textContent())?.includes("Nouveau projet"));
  await page.screenshot({ path: `${SHOTS}/B-choix-du-projet.png` });
  await createOnCanvas(f, PROJECT, input);
  ok("B3 projet créé : la planche apparaît", await until(f, (s) => Boolean(document.querySelector(s)), sel.board));
  await settled();
  const created = q("select id, slug, draft_page_id p from projects where json_extract(title,'$.fr') = ?", PROJECT)[0];
  ok("B4 projet en brouillon de la page, cité par la planche", created?.p === 1 && findIn(draftOf().blocks, (b) => b.type === "project-board")?.props.project === created.slug, JSON.stringify(created));
  // Titre (raccourci glissé) juste au-dessus de la planche, puis lié à ce projet depuis le panneau « Réglages ».
  await center(f, sel.board);
  const above = await framePoint(f, sel.board, "top");
  await dragPalette("title", { x: above.x, y: above.y - 14 });
  await f.locator("[data-editing]").first().waitFor({ timeout: 60000 }).catch(() => {});
  await page.keyboard.type("Titre de test");
  await page.keyboard.press("Enter");
  await settled();
  const top = draftOf().blocks;
  const bi = top.findIndex((b) => b.type === "project-board");
  ok("B5 Titre posé juste avant la planche, sur la page (pas dans un conteneur)", top[bi - 1]?.type === "section-title", JSON.stringify(top.map((b) => b.type)));
  const titleUid = top[bi - 1].uid;
  await f.locator(`[data-edit-block="${titleUid}"] h2`).first().click();
  await page.getByRole("tab", { name: "Réglages" }).click();
  await page.locator("label.a-toggle", { hasText: "Reprendre le nom et la présentation d'un projet" }).click();
  const pick = page.getByRole("combobox", { name: /Projet repris par ce titre/ });
  // Lot 111 : le projet est nommé en base APRÈS sa création (createOnCanvas) ; la liste de l éditeur, chargée avant, le connaît encore sous son titre par défaut.
  await pick.fill("Projet sans titre");
  await pick.press("ArrowDown");
  await pick.press("Enter");
  await settled();
  const linked = findIn(draftOf().blocks, (b) => b.uid === titleUid);
  ok("B6 Titre lié : projet porté par le Titre lui-même", linked?.props.linked === true && (linked.props.project === created.slug || q("select json_extract(title,'$.fr') t from projects where slug = ?", linked.props.project)[0]?.t === PROJECT), JSON.stringify([linked?.props, q("select slug, draft_page_id from projects where json_extract(title,'$.fr') = ?", PROJECT)]));
  ok("B7 la toile montre le nom du projet dans le Titre", await until(f, (n) => [...document.querySelectorAll('[data-edit-type="section-title"] h2')].some((h) => h.textContent?.includes(n)), PROJECT));
  await page.screenshot({ path: `${SHOTS}/B-titre-lie-et-planche.png` });
}

/* ---- C. Images dans la planche, à une position ---------------------- */

if (run("C")) {
  await center(f, sel.board);
  await dragMedia(images[0], await framePoint(f, `${sel.board} [data-edit-rail]`, "left"));
  ok("C1 1er média déposé dans la planche", await until(f, (s) => document.querySelectorAll(`${s} [data-edit-slot]`).length === 1, sel.board));
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

/* ---- D. Glisser dans / hors d'une grille --------------------------------------- */

if (run("D")) {
  // Grille d'images (3 images à choisir) sous la planche.
  await center(f, sel.board);
  const below = await framePoint(f, sel.board, "bottom");
  await dragPalette("grid-images", below);
  await settled();
  let grid = imageGrid();
  ok("D0 grille d'images posée : 3 images à choisir", grid?.props.children?.length === 3 && grid.props.children.every((c) => c.type === "image"), JSON.stringify(grid?.props));
  const gridSel = `[data-edit-block="${grid.uid}"]`;
  await page.getByRole("tab", { name: "Structure" }).click();
  await sleep(300);
  ok("D0 structure : arbre indenté (composants de la grille au niveau 2)", (await page.locator('.ve-tree [role=treeitem][aria-level="2"]').count()) >= 3);
  await page.screenshot({ path: `${SHOTS}/D-arbre-du-panneau.png` });
  await center(f, gridSel);
  // « Texte » du panneau DANS la grille, sur la première image.
  const cell = await framePoint(f, `${gridSel} .pe-media-empty`, "bottom");
  await dragPalette("text", cell, async () => {
    ok("D1 repère intérieur + cadre de la grille pendant le glisser", (await f.locator(".pe-marker-inner, .pe-marker-inner-v").count()) === 1 && (await f.locator(".pe-drop-container:not([data-refused])").count()) === 1);
    await page.screenshot({ path: `${SHOTS}/D-depot-a-l-interieur-de-la-grille.png` });
  });
  await f.locator("[data-editing]").first().waitFor({ timeout: 60000 }).catch(() => {});
  await page.keyboard.type("Texte dans la grille");
  await page.keyboard.press("Enter");
  await settled();
  grid = imageGrid();
  ok("D2 « Texte » ajouté DANS la grille (4 composants)", grid?.props.children?.length === 4 && grid.props.children.some((c) => c.type === "rich-text"), JSON.stringify(grid?.props.children?.map((c) => c.type)));
  const textUid = grid.props.children.find((c) => c.type === "rich-text").uid;
  // Composant non accepté (Contact) glissé sur la grille : refusé, rien n'est ajouté.
  const blocksBefore = draftOf().blocks.length;
  const inside = await framePoint(f, `${gridSel} [data-edit-type="rich-text"] section`);
  await dragPalette("contact", inside, async () => {
    ok("D3 bloc non accepté : repère « refusé » sur la grille", (await f.locator(".pe-drop-container[data-refused]").count()) === 1);
    await page.screenshot({ path: `${SHOTS}/D-depot-refuse.png` });
  });
  await settled();
  const after = draftOf().blocks;
  ok("D4 refus : rien d'ajouté (ni dans la grille, ni sur la page)", after.length === blocksBefore && !findIn(imageGrid().props.children, (b) => b.type === "contact"));
  // Sortir le Texte de la grille (barre : ⇱), puis le refaire entrer par la poignée.
  await center(f, gridSel);
  // Cellule étroite : la barre d'outils du bloc (déjà choisi) couvre le paragraphe, le clic est forcé.
  await f.locator(`[data-edit-block="${textUid}"] p`).first().click({ force: true });
  await f.locator('.pe-tools button[aria-label="Sortir du bloc"]').click();
  await settled();
  const top = draftOf().blocks;
  const gi = top.findIndex((b) => b.uid === grid.uid);
  ok("D5 « Sortir du bloc » : le Texte est sur la page, juste après la grille", top[gi + 1]?.uid === textUid, JSON.stringify(top.map((b) => b.type)));
  await center(f, `[data-edit-block="${textUid}"]`);
  await f.locator(`[data-edit-block="${textUid}"] p`).first().click({ force: true });
  await sleep(300);
  const g2 = await f.locator(".pe-selected .pe-grip").boundingBox();
  const intoCell = await framePoint(f, `${gridSel} .pe-media-empty`, "bottom");
  await dragTo({ x: g2.x + g2.width / 2, y: g2.y + g2.height / 2 }, { x: intoCell.x, y: intoCell.y });
  await settled();
  ok("D6 poignée : le Texte rentre dans la grille", imageGrid().props.children.some((c) => c.uid === textUid), JSON.stringify(imageGrid().props.children.map((c) => c.type)));
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
  let grid = videoGrid();
  ok("E1 grille de vidéos : 3 vidéos à choisir, agencement 1 grand + 2", grid?.props.layout === "1+2" && grid.props.children.length === 3 && grid.props.children.every((c) => c.type === "video-single"), JSON.stringify(grid?.props));
  const gridSel = `[data-edit-block="${grid.uid}"]`;
  await center(f, gridSel);
  // Les repères « Choisir une vidéo » se posent après le rendu de la grille : on attend (course constatée en CI).
  await until(f, (s) => document.querySelectorAll(s).length === 3, `${gridSel} .pe-media-video`, 15000);
  ok("E2 « Choisir une vidéo » sur la toile", (await f.locator(`${gridSel} .pe-media-video`).count()) === 3);
  await page.screenshot({ path: `${SHOTS}/E-video-a-choisir.png` });
  await f.locator(`${gridSel} .pe-media-video`).first().click({ position: { x: 6, y: 6 } });
  await f.locator(".pe-crumbs .pe-crumb").first().click();
  // Lot 31e : l'agencement se choisit dans la fenêtre « Réglages » de la grille (mêmes vignettes que pour une planche).
  await f.locator('[data-testid="grid-settings-button"]').click();
  await sleep(300);
  await page.screenshot({ path: `${SHOTS}/E-selecteur-d-agencement.png` });
  await f.locator('.pe-gm-layout[aria-label="4 petits (2 × 2)"]').click();
  await settled();
  grid = videoGrid();
  ok("E3 agencement changé (2 × 2) sans perdre de composant", grid.props.layout === "2x2" && grid.props.children.length === 3);
  ok("E4 cellule libre « + » sur la toile", await until(f, (s) => document.querySelectorAll(`${s} [data-edit-cell-free]`).length === 1, gridSel));
  await center(f, gridSel);
  await page.screenshot({ path: `${SHOTS}/E-grille-avec-cellule-vide.png` });
  // Vidéo (fichier) déposée sur la 2e cellule précisément.
  // Vidéo de test dans un dossier au nom imprévisible (mkdtemp), supprimé aussitôt lue : pas de chemin /tmp fixe.
  const mp4Dir = mkdtempSync(path.join(tmpdir(), "e2e-v013-"));
  const mp4 = path.join(mp4Dir, "plan.mp4");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=12:duration=2", "-pix_fmt", "yuv420p", "-c:v", "libx264", mp4]);
  const bytes = [...readFileSync(mp4)];
  rmSync(mp4Dir, { recursive: true, force: true });
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
    const g = videoGrid();
    ok2 = Boolean(g?.props.children[1]?.props.mediaId) && !g.props.children[0].props.mediaId && !g.props.children[2].props.mediaId;
  }
  ok("E5 vidéo déposée dans la 2e cellule précisément (envoi + conversion)", ok2);
  await settled();
}

/* ---- F. Supprimer la grille : confirmation qui compte ------------------------------ */

if (run("F")) {
  const grid = imageGrid();
  await center(f, `[data-edit-block="${grid.uid}"]`);
  await f.locator(`[data-edit-block="${grid.uid}"] [data-edit-block]`).first().click();
  await f.locator(".pe-crumbs .pe-crumb").first().click();
  await f.locator('.pe-tools button[aria-label="Supprimer"]').click();
  const dialog = page.getByRole("dialog");
  ok("F1 confirmation : nombre de composants retirés", new RegExp(`${grid.props.children.length} (composants|blocs) seront retirés`).test((await dialog.textContent()) ?? ""), (await dialog.textContent())?.slice(0, 200));
  await page.screenshot({ path: `${SHOTS}/F-suppression-de-la-grille.png` });
  // Confirmée : la grille (et ses composants) disparaît du brouillon, le reste de la page est intact.
  await dialog.getByRole("button", { name: /Supprimer/ }).click();
  await settled();
  ok("F2 grille d'images supprimée du brouillon", !imageGrid() && Boolean(videoGrid()) && Boolean(findIn(draftOf().blocks, (b) => b.type === "project-board")));
}

/* ---- G. En-tête et pied (communs) -------------------------------------------------- */

if (run("G")) {
  await f.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await sleep(300);
  await page.getByRole("tab", { name: "Réglages" }).click();
  await settled();
  // La sélection de l'en-tête peut se perdre si un rendu du serveur remplace le DOM entre le clic et son traitement : on reclique.
  let g1 = false;
  for (let i = 0; i < 3 && !g1; i++) {
    await f.locator(".site-header .site-header-bar").click({ position: { x: 600, y: 20 } });
    g1 = await until(f, () => /commun à toutes les pages/.test(document.querySelector(".pe-selected.pe-global .pe-tag")?.textContent ?? ""), undefined, 10000);
  }
  const siteEditors = await page
    .locator('[data-testid="site-editor"]')
    .waitFor({ timeout: 10000 })
    .then(() => 1, () => 0);
  ok("G1 en-tête sélectionné : « commun à toutes les pages », réglages dans le panneau", g1 && siteEditors === 1, `étiquette=${g1} panneaux=${siteEditors}`);
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

const published = () => until(page, () => /^(Publié|En ligne)/.test(document.querySelector(".ve-status")?.textContent?.trim() ?? "") && !document.querySelector(".ve-alert[role=alert]"), null, 90000);

if (run("I")) {
  // Les vidéos encore à choisir bloquent la publication : on y glisse la vidéo envoyée en E.
  const grid = videoGrid();
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
    ok("I0b vidéos placées dans les cellules restantes", videoGrid().props.children.every((c) => c.props.mediaId));
  }
  await page.getByRole("button", { name: "Publier" }).click();
  ok("I1 publication acceptée", await published());
  const pub = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pp = await pub.newPage();
  await pp.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  const html = await pp.content();
  ok("I2 public : le projet (Titre lié) et sa planche (3 images)", html.includes(PROJECT) && (await pp.locator(`section[aria-labelledby^="project-"] .strip-rail img`).count()) >= 3);
  ok("I3 public : aucun repère d'édition", !/data-edit-|pe-media-empty|data-edit-cell-free/.test(html));
  ok("I4 public : menu publié (Boutique, Paysages)", (await pp.locator(".site-header nav").first().textContent()).includes("Boutique") && (await pp.locator(".site-header nav").first().textContent()).includes("Paysages"));
  const behance = pp.locator('footer a[href="https://www.behance.net/camille"]');
  ok("I5 public : réseau avec rel noopener noreferrer me et target _blank", (await behance.getAttribute("rel")) === "noopener noreferrer me" && (await behance.getAttribute("target")) === "_blank");
  ok("I6 public : fond de l'ouverture = média choisi", (await pp.locator(".hero .hero-backdrop img").count()) === 1);
  await pp.screenshot({ path: `${SHOTS}/I-rendu-public-apres-publication.png`, fullPage: false });
  await pub.close();

  // I1 : une planche retirée de la page n'efface pas les images en ligne.
  f = await openEditor(1);
  const project = q("select id from projects where json_extract(title,'$.fr') = ?", PROJECT)[0];
  const before = q("select id, media_id m, position p from slots where project_id = ? order by position", project.id);
  await center(f, sel.board);
  const slot = f.locator(`${sel.board} [data-edit-slot]`).first();
  await slot.hover();
  await f.locator(".pe-slot-tools button", { hasText: "Retirer la place" }).click();
  await settled();
  ok("I7 brouillon : place retirée dans la planche", q("select count(*) n from slots where project_id = ? and draft_state = 'retired'", project.id)[0].n === 1);
  await f.locator(`${sel.board} header`).first().click();
  await f.locator('.pe-tools button[aria-label="Supprimer"]').click();
  await page.getByRole("dialog").getByRole("button", { name: /Supprimer/ }).click();
  await settled();
  await page.getByRole("button", { name: "Publier" }).click();
  ok("I8 publication sans la planche", await published());
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
  await dragPalette("contact-with-form", { x: fb.x + fb.width / 2, y: Math.min(prof.y + 60, fb.y + fb.height - 30) });
  await settled();
  let block = draftOf(about).blocks.find((b) => b.type === "contact" && b.props.form === true);
  ok("L1 formulaire posé : 3 champs par défaut (nom, e-mail de réponse, message)", block?.props.fields.length === 3 && block.props.fields[1].reply === true);
  const formSel = `[data-edit-block="${block.uid}"]`;
  await center(f, `${formSel} form`);
  await f.locator(`${formSel} [data-testid="field-add"]`).click().catch(async () => f.locator('[data-testid="field-add"]').click());
  await f.getByRole("menuitem", { name: "Texte court" }).click();
  await settled();
  block = draftOf(about).blocks.find((b) => b.type === "contact" && b.props.form === true);
  ok("L2 champ ajouté (texte court)", block.props.fields.length === 4 && block.props.fields[3].type === "text");
  await center(f, `${formSel} [data-form-field="3"]`);
  await f.locator(`${formSel} [data-form-field="3"] [data-inline="fields.3.label"]`).dblclick({ position: { x: 10, y: 6 } });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Ton studio");
  await page.keyboard.press("Enter");
  await settled();
  block = draftOf(about).blocks.find((b) => b.type === "contact" && b.props.form === true);
  ok("L3 champ renommé en place", block.props.fields[3].label.fr === "Ton studio");
  // Retirer le champ e-mail de réponse : refusé (averti).
  await f.locator(`${formSel} [data-form-field="1"]`).hover();
  await f.locator('.pe-item-tools[data-kind="field"] button[aria-label="Retirer ce champ"]').click();
  await sleep(500);
  ok("L4 le champ e-mail de réponse n'est pas retiré (avertissement)", draftOf(about).blocks.find((b) => b.type === "contact" && b.props.form === true).props.fields.length === 4);
  // Formulaire choisi, message de confirmation montré depuis le panneau.
  await f.locator(`${formSel} h2`).click();
  await page.getByRole("tab", { name: "Réglages" }).click();
  await page.getByRole("button", { name: "Voir le message de confirmation" }).click();
  ok("L5 « Voir le message de confirmation » le montre sur la toile", await until(f, (q) => Boolean(document.querySelector(q)?.checkVisibility()), `${formSel} [data-form-pane="success"]`, 20000));
  await center(f, `${formSel} form`);
  await page.screenshot({ path: `${SHOTS}/L-formulaire-selectionne.png` });
  await page.getByRole("button", { name: "Publier" }).click();
  ok("L6 publication", await published());
  const formId = JSON.parse(q("select props from blocks where page_id = ? and type = 'contact'", about)[0]?.props ?? "{}").formId;
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
  // Jeton signé + délai minimal avant l'envoi (docs/SECURITE.md §2.3) : comme le formulaire, demandé puis attendu.
  const post = (data) =>
    pp.evaluate(async (d) => {
      const { token } = await (await fetch(`/api/contact/token?form=${d.form}`, { cache: "no-store" })).json();
      await new Promise((r) => setTimeout(r, 3200));
      return (await fetch("/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...d, token }) })).status;
    }, data);
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

/* ---- N. Grille vide ---------------------------------------------------------------- */

if (run("N")) {
  f = await openEditor(1);
  const between = await f.evaluate(() => {
    const els = [...document.querySelectorAll("[data-edit-block]:not([data-edit-parent])")];
    const r = (el) => [...el.querySelectorAll("*")].map((c) => c.getBoundingClientRect()).filter((x) => x.height);
    return (Math.max(...r(els[0]).map((x) => x.bottom)) + Math.min(...r(els[1]).map((x) => x.top))) / 2;
  });
  const fb = await frameBox();
  await dragPalette("grid", { x: fb.x + fb.width / 2, y: fb.y + Math.min(between, fb.height - 40) });
  await settled();
  const grid = findIn(draftOf()?.blocks ?? [], (b) => b.type === "grid" && b.props.children.length === 0);
  ok("N1 « Grille » du panneau : grille vide posée", Boolean(grid), JSON.stringify(draftOf()?.blocks?.map((b) => b.type)));
  const gridSel = `[data-edit-block="${grid.uid}"]`;
  ok("N2 grille vide : places libres « + » sur la toile", await until(f, (s) => document.querySelectorAll(`${s} [data-edit-cell-free]`).length >= 2, gridSel));
  await center(f, gridSel);
  await page.screenshot({ path: `${SHOTS}/N-grille-vide.png` });
  await page.getByRole("button", { name: "Aperçu", exact: true }).click();
  await sleep(600);
  const shown = await f.locator(`${gridSel} [data-edit-cell-free]`).evaluateAll((els) => els.filter((el) => getComputedStyle(el).display !== "none").length);
  ok("N3 aperçu : aucune place « + » (boîte fantôme) pour la grille vide", shown === 0, `${shown} place(s) visible(s)`);
  await page.keyboard.press("Escape");
}

/* ---- P. Accroche de l'ouverture : texte à passage surligné, en place (v0.16) ----------------- */

if (run("P")) {
  // Le thème « Carnet d'atelier » a l'ouverture typographique (l'accroche s'y affiche).
  await page.goto(`${BASE}/api/theme-preview?id=carnet-d-atelier&redirect=/admin`, { waitUntil: "domcontentloaded" });
  f = await openEditor(1);
  await sleep(1000);
  const H = '[data-edit-type="hero"] h1[data-inline="statement"]';
  const statementUntil = async (pred, ms = 20000) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) if (draftOf()?.blocks && pred(statement())) return;
  };
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
  await statementUntil((v) => v === "Je dessine des personnages et des <mark>mondes</mark>");
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
  await statementUntil((v) => v === "Je dessine des personnages et des mondes");
  ok("P8 surlignage retiré : plus de balisage", statement() === "Je dessine des personnages et des mondes", statement());
  // Un mot sans sélection : le mot sous le curseur est surligné.
  const refreshes0 = await f.evaluate(() => window.__refreshes);
  await f.locator(H).dblclick({ position: { x: 20, y: 20 } });
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("ArrowRight");
  await f.locator(".pe-markbar button").click();
  await page.keyboard.press("Enter");
  await settled();
  await statementUntil((v) => v?.startsWith("<mark>Je</mark> dessine"));
  ok("P9 curseur dans un mot (sans sélection) : le mot est surligné", statement()?.startsWith("<mark>Je</mark> dessine"), statement());
  const refreshes = (await f.evaluate(() => window.__refreshes)) - refreshes0;
  ok("P9b une modification d'accroche = 1 ou 2 rafraîchissements de la toile (pas de rafale)", refreshes >= 1 && refreshes <= 2, `${refreshes} rafraîchissements`);
  // Aucun HTML : ce qui ressemble à une balise est retiré à la saisie (« < » suivi d'une lettre ou de « / »), rien n'est interprété.
  await f.locator(H).dblclick({ position: { x: 20, y: 20 } });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("Salut <img src=x onerror=alert(1)> <b>gras</b>");
  await page.keyboard.press("Enter");
  await settled();
  await statementUntil((v) => v?.startsWith("Salut"));
  ok("P10 balises retirées à la saisie : aucun HTML dans le brouillon", !/<\/?[a-z]/i.test(statement().replace(/<\/?mark>/g, "")) && !statement().includes("<img"), statement());
  ok("P10b rien d'interprété sur la toile", (await f.locator(`${H} img, ${H} b`).count()) === 0);
  // Un chevron isolé reste du texte (accroche de la v0.15 : « I <3 … ») : enregistré, publiable, rendu en texte.
  await f.locator(H).dblclick({ position: { x: 20, y: 20 } });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("I <3 dessiner");
  await page.keyboard.press("Enter");
  await settled();
  await statementUntil((v) => v === "I <3 dessiner");
  ok("P10c « < » isolé conservé comme texte dans le brouillon", statement() === "I <3 dessiner", statement());
  ok("P10d rendu en texte, sans nœud HTML", await until(f, (sel) => document.querySelector(sel + " [data-marked-body]")?.textContent === "I <3 dessiner" && document.querySelectorAll(sel + " [data-marked-body] *").length === 0, H, 20000));
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
  await page.locator('button[aria-label="Défaire"]').click();
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
  const tabs = rp.getByRole("tablist", { name: /Nom affiché/ });
  const field = tabs.locator("xpath=..").locator("input");
  const frValue = await field.inputValue();
  // Page chargée à « domcontentloaded » : le clic peut précéder l'hydratation, on le rejoue jusqu'à ce que l'onglet réponde.
  let enValue = frValue;
  for (let essai = 0; essai < 8 && enValue === frValue; essai++) {
    await tabs.getByRole("tab", { name: /EN|Anglais/ }).click();
    await sleep(600);
    enValue = await field.inputValue();
  }
  ok("Q14 écran Réglages : nom affiché en français et en anglais (onglets FR / EN)", frValue === "Atelier Camille" && enValue === "Camille Studio", `${frValue} / ${enValue}`);
  await rp.close();
  await pub.close();
}

/* ---- J. Sélection (seul, pour Firefox) -------------------------------------------- */

/* ---- R. Rendu tardif du serveur pendant une édition en place ------------------------- */

// Le rendu d'une modification arrive 1,5 s puis 3 s après son enregistrement, pendant qu'on retape dans le champ :
// texte intact (écran et base), aucune frappe perdue, curseur en fin de texte, barre « Surligner » utilisable.
if (run("R")) {
  await page.goto(`${BASE}/api/theme-preview?id=carnet-d-atelier&redirect=/admin`, { waitUntil: "domcontentloaded" });
  f = await openEditor(1);
  await sleep(1000);
  const H = '[data-edit-type="hero"] h1[data-inline="statement"]';
  const BRAND = '[data-edit-global="header"] [data-site-inline="name"]';
  const statement = () => draftOf().blocks.find((b) => b.type === "hero")?.props.statement?.fr;
  const siteName = () => JSON.parse(q("select value from settings where key = 'siteDraft'")[0]?.value ?? "null")?.snap.identity.name?.fr;
  const rev = () => f.evaluate(() => Number(document.querySelector("[data-edit-rev]")?.getAttribute("data-edit-rev") ?? -1));
  // Tape touche par touche (80 ms) jusqu'à ce que le rendu du serveur soit arrivé, puis encore 10 touches.
  const typeSlowly = async (first, alphabet) => {
    const rev0 = await rev();
    let typed = first;
    await page.keyboard.type(first, { delay: 80 });
    let after = 0;
    for (let k = 0; k < 160 && after < 10; k++) {
      const c = alphabet[k % alphabet.length];
      await page.keyboard.type(c, { delay: 80 });
      typed += c;
      if ((await rev()) > rev0) after++;
    }
    return { typed, landed: (await rev()) > rev0, rev0, rev1: await rev() };
  };
  for (const [i, delay] of [1500, 3000].entries()) {
    const tag = `R${i + 1}`;
    rscDelay = delay;
    // 1. Une modification : enregistrée, rendue par le serveur dans `delay` ms.
    await f.locator(H).dblclick({ position: { x: 20, y: 20 } });
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(` m${i}`);
    await page.keyboard.press("Enter");
    // 2. Tout de suite, retour dans le champ et frappe lente pendant que le rendu arrive.
    await f.locator(H).dblclick({ position: { x: 20, y: 20 } });
    await page.keyboard.press("ControlOrMeta+End");
    const r = await typeSlowly(" ", "ABCDEFGHIJKLMNOPQRSTUVWXYZ".slice(i * 3) + "ABCDEFGHIJKLMNOPQRSTUVWXYZ".slice(0, i * 3));
    const typed = r.typed;
    ok(`${tag}0 (${delay} ms) le rendu du serveur est arrivé PENDANT la frappe`, r.landed, `révision ${r.rev0} → ${r.rev1}`);
    const shown = await f.locator("[data-marked-edit]").textContent().catch(() => null);
    const caretAtEnd = await f.evaluate(() => {
      const ed = document.querySelector("[data-marked-edit]");
      const sel = getSelection();
      if (!ed || !sel?.rangeCount) return false;
      const r = document.createRange();
      r.selectNodeContents(ed);
      r.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
      return sel.isCollapsed && r.toString().length === (ed.textContent ?? "").length;
    });
    ok(`${tag}a champ resté ouvert, texte tapé intact à l'écran, aucune frappe perdue`, (await f.locator("[data-marked-edit]").count()) === 1 && Boolean(shown?.endsWith(` m${i}${typed}`)), JSON.stringify(shown));
    ok(`${tag}b curseur en fin de texte, sans sélection`, caretAtEnd);
    // 3. La barre reste utilisable : les 3 dernières lettres sont surlignées.
    for (let k = 0; k < 3; k++) await page.keyboard.press("Shift+ArrowLeft");
    const last3 = typed.slice(-3);
    ok(`${tag}c barre « Surligner » active sur la sélection`, await until(f, () => {
      const b = document.querySelector(".pe-markbar button");
      return Boolean(b) && !b.disabled && b.getAttribute("aria-pressed") === "false";
    }));
    await f.locator(".pe-markbar button").click();
    ok(`${tag}d surlignage posé dans le champ`, await until(f, (t) => [...document.querySelectorAll("[data-marked-edit] .hero-mark")].at(-1)?.textContent === t, last3));
    await page.keyboard.press("Enter");
    await settled();
    const want = (s) => s.endsWith(`m${i}${typed.slice(0, -3)}<mark>${last3}</mark>`);
    for (const end = Date.now() + 20000; Date.now() < end && !want(statement() ?? ""); ) await sleep(200);
    ok(`${tag}e brouillon : texte tapé et surlignage intacts`, want(statement() ?? ""), statement());
    ok(`${tag}f écran après rendu : même texte`, await until(f, (a) => document.querySelector(a.sel + " [data-marked-body]")?.textContent.endsWith(a.t), { sel: H, t: `m${i}${typed}` }, 20000));
    // Nom du site (texte commun, brouillon du site).
    const base = `Nom ${i}`;
    await f.locator(BRAND).dblclick();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(base);
    await page.keyboard.press("Enter");
    // Le rendu du serveur peut redessiner le nom juste après « Entrée » : le double-clic est rejoué tant que le champ ne s'est pas ouvert
    // (sinon la frappe part dans le vide et le texte tapé « disparaît » : même flake sur la base v0.19).
    for (let essai = 0; essai < 6; essai++) {
      await f.locator(BRAND).dblclick();
      if (await f.locator("[data-editing]").first().waitFor({ timeout: 3000 }).then(() => true, () => false)) break;
    }
    await page.keyboard.press("ControlOrMeta+End");
    const rn = await typeSlowly("-", "abcdefghijklmnopqrstuvwxyz".slice(i * 4) + "abcdefghijklmnopqrstuvwxyz".slice(0, i * 4));
    const typedName = rn.typed;
    ok(`${tag}g (${delay} ms) nom du site : le rendu est arrivé PENDANT la frappe`, rn.landed, `révision ${rn.rev0} → ${rn.rev1}`);
    const shownName = (await f.locator(BRAND).textContent())?.trim();
    ok(`${tag}h nom du site : texte tapé intact à l'écran`, shownName === base + typedName, JSON.stringify(shownName));
    await page.keyboard.press("Enter");
    await settled();
    for (const end = Date.now() + 20000; Date.now() < end && siteName() !== base + typedName; ) await sleep(200);
    ok(`${tag}i nom du site : texte tapé intact en base`, siteName() === base + typedName, JSON.stringify(siteName()));
    ok(`${tag}j nom du site après rendu : même texte`, await until(f, (a) => document.querySelector(a.sel)?.textContent.trim() === a.t, { sel: BRAND, t: base + typedName }, 20000));
    // Remise à plat de l'accroche (un texte tapé à la suite d'un passage surligné y reste), sans délai.
    rscDelay = 0;
    await f.locator(H).dblclick({ position: { x: 20, y: 20 } });
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(`Accroche R${i}`);
    await page.keyboard.press("Enter");
    await settled();
  }
  // IME / touche morte : une composition en cours pendant que le rendu tardif arrive ne doit être ni rétablie ni dupliquée.
  if (ENGINE === chromium) {
    const cdp = await page.context().newCDPSession(page);
    // Élément de la toile (document d'iframe) pour DOMDebugger : par le DOM du protocole, qui traverse l'iframe.
    await cdp.send("DOM.enable");
    const frameEl = async (sel) => {
      const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
      const { nodeId: iframeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: "iframe.ve-frame" });
      const { node } = await cdp.send("DOM.describeNode", { nodeId: iframeId, pierce: true });
      const { nodeIds } = await cdp.send("DOM.pushNodesByBackendIdsToFrontend", { backendNodeIds: [node.contentDocument.backendNodeId] });
      const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: nodeIds[0], selector: sel });
      return (await cdp.send("DOM.resolveNode", { nodeId })).object.objectId;
    };
    rscDelay = 1500;
    const base = "Ime";
    await f.locator(BRAND).dblclick();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(base);
    await page.keyboard.press("Enter");
    await f.locator(BRAND).dblclick();
    await page.keyboard.press("ControlOrMeta+End");
    const rev0 = await rev();
    await cdp.send("Input.imeSetComposition", { text: "é", selectionStart: 1, selectionEnd: 1 });
    // Le rendu du serveur arrive PENDANT la composition.
    for (const end = Date.now() + 15000; Date.now() < end && (await rev()) <= rev0; ) await sleep(100);
    ok("R-ime0 le rendu du serveur est arrivé PENDANT la composition", (await rev()) > rev0);
    await sleep(300);
    await cdp.send("Input.insertText", { text: "é" });
    await sleep(500);
    const shownIme = (await f.locator(BRAND).textContent())?.trim();
    ok("R-ime1 texte validé exactement une fois à l'écran", shownIme === `${base}é`, JSON.stringify(shownIme));
    await page.keyboard.press("Enter");
    await settled();
    for (const end = Date.now() + 20000; Date.now() < end && siteName() !== `${base}é`; ) await sleep(200);
    ok("R-ime2 texte validé exactement une fois en base", siteName() === `${base}é`, JSON.stringify(siteName()));
    rscDelay = 0;
    // Écouteurs : cinq ouvertures du même champ, plus aucun écouteur de saisie une fois fermé.
    await sleep(2500);
    const tagged = await f.evaluate((sel) => { document.querySelector(sel).setAttribute("data-probe", "1"); return true; }, BRAND);
    for (let k = 0; k < 5; k++) {
      await f.locator(BRAND).dblclick();
      await page.keyboard.press("Enter");
      await sleep(150);
    }
    ok("R-ev0 le même élément a servi aux cinq ouvertures", tagged && (await f.locator(BRAND).getAttribute("data-probe")) === "1");
    const { listeners } = await cdp.send("DOMDebugger.getEventListeners", { objectId: await frameEl(BRAND) });
        const left = listeners.filter((l) => ["input", "beforeinput", "compositionstart", "compositionend", "blur"].includes(l.type)).map((l) => l.type);
    ok("R-ev1 après 5 ouvertures, plus aucun écouteur de saisie sur le champ", left.length === 0, left.join(","));
    await cdp.detach();
  }
  rscDelay = Number(process.env.RSC_DELAY ?? 0);
}

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

// Vérification de fin de suite, rejouée par chaque partie (ONLY=…) : comptée PASS une seule fois (PREP_QUIET=1 dans les autres, lib/parts.mjs).
sharedOk(ok)("aucune erreur JavaScript", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `${failures} échec(s)` : "tout est passé");
process.exit(failures ? 1 : 0);
