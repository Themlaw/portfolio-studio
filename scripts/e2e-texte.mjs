#!/usr/bin/env node
/**
 * Insertion de texte, trois choix nets (lot 19a), UN chromium, UN onglet. Serveur dev requis, base NEUVE (seed),
 * une connexion, page « À propos », thème du seed.
 *
 *  A. Choix d'insertion : « Texte » (un paragraphe seul), « Titre » (un titre seul), « Titre + texte » ; dans la
 *     fenêtre « Ajouter une rubrique », le panneau « Ajouter » et la case vide d'une grille. Un champ absent n'existe
 *     pas : ni clé dans le brouillon, ni place, ni texte gris sur la toile.
 *  B. Hauteurs et rythme : un Texte seul n'a que l'espace de section au-dessus de son paragraphe (le rythme des autres
 *     rubriques), sur la toile ET en public ; un titre ajouté puis retiré rend exactement la hauteur d'origine.
 *  C. « + Ajouter un titre » / « Retirer le titre » au survol de la toile.
 *  F. En carte (Texte, Titre) : boutons de champ atteignables à la souris, « Retirer le titre » sans l'étiquette, toile = public.
 *  D. Publication : un texte d'aide resté tel quel (Texte, Titre, titre ajouté) est refusé, le brouillon est enregistré.
 * Captures : $SHOTS (défaut screenshots/texte19a).
 * Usage : DATA_DIR=… ADMIN_EMAIL=… ADMIN_PASSWORD=… BASE=http://localhost:3102 node scripts/e2e-texte.mjs
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const DATA = process.env.DATA_DIR ?? "data";
const DB = path.join(DATA, "portfolio.db");
const SHOTS = process.env.SHOTS ?? "screenshots/texte19a";
const ONLY = process.env.ONLY ?? "";
mkdirSync(SHOTS, { recursive: true });
const PAGE_ID = 5;
const run = (k) => !ONLY || ONLY.split(",").includes(k);

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
const draftBlocks = () => JSON.parse(q("select draft from pages where id = ?", PAGE_ID)[0]?.draft || "null")?.blocks ?? [];
const publishedBlocks = () => q("select type, props from blocks where page_id = ? order by position", PAGE_ID).map((b) => ({ type: b.type, props: JSON.parse(b.props) }));
async function waitFor(fn, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(300);
  }
  return false;
}

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
  await sleep(600);
}
async function openEditor() {
  await page.goto(`${BASE}/admin/pages/${PAGE_ID}/editer`, { waitUntil: "domcontentloaded" });
  let fr = await canvas();
  if (await page.getByRole("button", { name: "Abandonner les modifications" }).count()) {
    await page.getByRole("button", { name: "Abandonner les modifications" }).click();
    await Promise.all([
      page.waitForEvent("framenavigated", { predicate: (x) => x === page.mainFrame(), timeout: 60000 }),
      page.getByRole("dialog").getByRole("button", { name: "Abandonner les modifications" }).click(),
    ]);
    fr = await canvas();
  }
  await sleep(1500);
  return fr;
}
async function tryPublish() {
  await settled();
  await page.getByRole("button", { name: "Publier", exact: true }).click();
}
async function publish() {
  await tryPublish();
  return waitFor(async () => /Publié/.test((await page.locator(".ve-status").textContent()) ?? ""), 120000);
}
const selectedText = (fr) => fr.evaluate(() => window.getSelection()?.toString() ?? "");
async function stableScroll(fr) {
  let last = -1;
  for (let i = 0; i < 60; i++) {
    const y = await fr.evaluate(() => window.scrollY);
    if (y === last) return;
    last = y;
    await sleep(200);
  }
}
async function section(name, fn) {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 2).join(" "));
    await page.screenshot({ path: path.join(SHOTS, `erreur-${name}.png`) }).catch(() => {});
  }
}

/** Mesures d'une section (toile ou public) : hauteur, espace de section, et place prise avant le premier paragraphe. */
const MEASURE = (root) => {
  const sec = root.closest("section") ?? root;
  const cs = getComputedStyle(sec);
  const r = sec.getBoundingClientRect();
  const para = sec.querySelector("p:not(.eyebrow)");
  const pt = parseFloat(cs.paddingTop);
  const probe = document.createElement("i");
  probe.style.cssText = "position:absolute;visibility:hidden;height:var(--section-gap)";
  document.body.append(probe);
  const gap = probe.getBoundingClientRect().height;
  probe.remove();
  return {
    height: Math.round(r.height * 10) / 10,
    pt,
    gap,
    // Distance entre le haut de la section et son premier paragraphe, moins l'espace de section : 0 pour un paragraphe seul.
    extra: para ? Math.round((para.getBoundingClientRect().top - r.top - pt) * 10) / 10 : null,
    hasTitle: Boolean(sec.querySelector("h2")),
    hasEyebrow: Boolean(sec.querySelector(".eyebrow")),
    placeholders: [...sec.querySelectorAll("[data-placeholder]")].map((e) => e.getAttribute("data-placeholder")),
    inlines: [...sec.querySelectorAll("[data-inline]")].map((e) => e.getAttribute("data-inline")),
    text: (sec.textContent ?? "").trim().slice(0, 80),
  };
};
const measureCanvas = (fr, uid) => fr.locator(`[data-edit-block="${uid}"] section`).first().evaluate(MEASURE);

/** Remplace d'une frappe le texte sélectionné (texte d'aide) puis valide. */
async function typeOver(fr, path, text, expectHelp) {
  const editing = fr.locator(`[data-editing][data-inline="${path}"]`);
  await editing.waitFor({ timeout: 60000 });
  const sel = await selectedText(fr);
  if (expectHelp !== undefined) ok(`édition en place sur « ${path} », texte d'aide sélectionné`, sel === expectHelp, sel);
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await sleep(300);
}

/** Rien d'édité ni de sélectionné : ni barre de texte ni cadre ne couvrent le bloc survolé. */
async function idle() {
  await page.keyboard.press("Escape");
  await f.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
  await sleep(400);
  await f.evaluate((u) => document.querySelector(`.pe-focus[data-uid="${u}"]`)?.scrollIntoView({ block: "center" }), uids.text);
  await stableScroll(f);
}

let f = await openEditor();
const baseCount = await f.locator("[data-edit-block]:not([data-edit-parent])").count();
const dlg = page.locator("dialog.ve-add");
async function openChoice() {
  const addEnd = f.locator('[data-edit-add="end"]');
  await addEnd.scrollIntoViewIfNeeded();
  await addEnd.click();
  await dlg.waitFor({ timeout: 20000 });
}

const SAME = "Une même phrase pour comparer les hauteurs des trois rubriques, posée telle quelle.";
const uids = {};

/* ---- A. Les trois choix ------------------------------------------------------------------------------------------ */

if (run("A") || run("B") || run("C") || run("D"))
  await section("A", async () => {
    await openChoice();
    const starters = await dlg.locator(".ve-add-card[data-starter]").evaluateAll((els) => els.map((e) => [e.getAttribute("data-starter"), e.textContent]));
    ok("A1 fenêtre : « Texte », « Titre », « Titre + texte » en premier", starters.map((s) => s[0]).join() === "text,title,title-text" && /^Texte/.test(starters[0][1]) && /^Titre/.test(starters[1][1]) && /^Titre \+ texte/.test(starters[2][1]), JSON.stringify(starters));
    ok("A1 le « Titre » du catalogue n'est pas proposé en double", (await dlg.locator('.ve-add-card[data-type="section-title"]').count()) === 0 && (await dlg.locator('.ve-add-card[data-type="rich-text"]').count()) === 0);
    await page.screenshot({ path: path.join(SHOTS, "a1-choix.png") });

    // « Titre » : un titre seul. Ni présentation, ni texte d'aide pour elle.
    await dlg.locator('[data-starter="title"]').click();
    ok("A2 « Titre » : bloc Titre avec son seul texte d'aide, sans présentation", await waitFor(() => { const b = draftBlocks().at(-1); return draftBlocks().length === baseCount + 1 && b.type === "section-title" && b.props.title?.fr === "Titre de la rubrique" && b.props.intro === undefined && !b.props.linked; }), JSON.stringify(draftBlocks().at(-1)?.props));
    uids.title = draftBlocks().at(-1).uid;
    ok("A2 aucun texte d'aide « Présentation » sur la toile", (await f.locator(`[data-edit-block="${uids.title}"] [data-inline="intro"]`).count()) === 0);
    await page.screenshot({ path: path.join(SHOTS, "a2-titre-edition.png") });
    // Un texte d'aide resté tel quel est refusé à la publication (D1) ; il est remplacé ensuite.
    await page.keyboard.press("Escape");
    await settled();
    await tryPublish();
    ok("D1 « Titre » resté tel quel : publication refusée (message clair)", await page.getByText(/Remplace le texte d'exemple de ce titre/).first().waitFor({ timeout: 60000 }).then(() => true, () => false));
    ok("D1 le brouillon reste enregistré", /enregistré/i.test((await page.locator(".ve-status").textContent()) ?? ""));
    await f.locator(`[data-edit-block="${uids.title}"] [data-inline="title"]`).dblclick();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("Mes carnets");
    await page.keyboard.press("Enter");
    ok("A2 titre saisi en place", await waitFor(() => draftBlocks().at(-1)?.props.title?.fr === "Mes carnets"));
    await settled();

    // « Texte » : un paragraphe seul.
    await openChoice();
    await dlg.locator('[data-starter="text"]').click();
    ok("A3 « Texte » : un paragraphe, aucune clé title ni eyebrow dans le brouillon", await waitFor(() => { const b = draftBlocks().at(-1); return draftBlocks().length === baseCount + 2 && b.type === "rich-text" && !("title" in b.props) && !("eyebrow" in b.props) && b.props.paragraphs?.[0]?.fr === "Écris ton texte ici."; }), JSON.stringify(draftBlocks().at(-1)?.props));
    uids.text = draftBlocks().at(-1).uid;
    await f.locator(`[data-edit-block="${uids.text}"] [data-inline="paragraphs.0"]`).waitFor({ timeout: 60000 });
    const m0 = await measureCanvas(f, uids.text);
    ok("A3 sur la toile : ni titre, ni étiquette, aucun texte gris de titre", !m0.hasTitle && !m0.hasEyebrow && m0.placeholders.join() === "Paragraphe" && m0.inlines.join() === "paragraphs.0", JSON.stringify(m0));
    await page.screenshot({ path: path.join(SHOTS, "a3-texte-edition.png") });
    await page.keyboard.press("Escape");
    await settled();
    await tryPublish();
    ok("D2 « Texte » resté tel quel : publication refusée", await page.getByText(/Remplace le texte d'exemple de cette rubrique Texte/).first().waitFor({ timeout: 60000 }).then(() => true, () => false));
    await f.locator(`[data-edit-block="${uids.text}"] [data-inline="paragraphs.0"]`).dblclick();
    await page.keyboard.press("Control+a");
    await page.keyboard.type(SAME);
    await page.keyboard.press("Enter");
    ok("A3 paragraphe saisi en place", await waitFor(() => draftBlocks().at(-1)?.props.paragraphs?.[0]?.fr === SAME));
    await settled();

    // « Titre + texte ».
    await openChoice();
    await dlg.locator('[data-starter="title-text"]').click();
    ok("A4 « Titre + texte » : titre et paragraphe d'aide", await waitFor(() => { const b = draftBlocks().at(-1); return draftBlocks().length === baseCount + 3 && b.type === "rich-text" && b.props.title?.fr === "Titre de la rubrique" && b.props.paragraphs?.[0]?.fr === "Écris ton texte ici."; }), JSON.stringify(draftBlocks().at(-1)?.props));
    uids.both = draftBlocks().at(-1).uid;
    await typeOver(f, "title", "Un titre et son texte", "Titre de la rubrique");
    ok("A4 titre saisi", await waitFor(() => draftBlocks().at(-1)?.props.title?.fr === "Un titre et son texte"));
    await f.locator(`[data-edit-block="${uids.both}"] [data-inline="paragraphs.0"]`).dblclick();
    await page.keyboard.press("Control+a");
    await page.keyboard.type(SAME);
    await page.keyboard.press("Enter");
    ok("A4 paragraphe saisi", await waitFor(() => draftBlocks().at(-1)?.props.paragraphs?.[0]?.fr === SAME));
    await settled();

    // Panneau « Ajouter » : les trois choix en tête.
    await page.getByRole("tab", { name: "Ajouter" }).click();
    const panel = await page.locator(".ve-starters .ve-starter").evaluateAll((els) => els.map((e) => e.getAttribute("data-starter")));
    ok("A5 panneau « Ajouter » : Texte, Titre, Titre + texte en tête", panel.join() === "text,title,title-text", panel.join());
    await page.screenshot({ path: path.join(SHOTS, "a5-panneau-ajouter.png") });
    // Un clic dans le panneau insère le même Texte seul.
    await page.locator('.ve-starter[data-starter="text"]').click();
    ok("A5 « Texte » du panneau : paragraphe seul", await waitFor(() => { const b = draftBlocks().at(-1); return draftBlocks().length === baseCount + 4 && b.type === "rich-text" && !("title" in b.props); }));
    await page.keyboard.press("Escape");
    await settled();
    // Retire l'essai du panneau.
    const extra = draftBlocks().at(-1).uid;
    // Saisie en place : la barre typographique s'ouvre ; elle ne recouvre jamais la barre d'outils du bloc, dont le bouton
    // « Supprimer » se clique directement, sans fermer la barre (v0.19).
    await f.locator(`[data-edit-block="${extra}"] [data-inline="paragraphs.0"]`).dblclick();
    await page.keyboard.press("Control+a");
    await page.keyboard.type("Essai");
    ok("A5 saisie en place : la barre typographique est ouverte", await waitFor(async () => (await f.locator(".lk-bar").count()) === 1));
    ok("A5 la barre d'outils du bloc est là", await waitFor(async () => (await f.locator('.pe-tools [aria-label="Supprimer"]').count()) === 1));
    await sleep(500);
    const overlap = await f.evaluate(() => {
      const [bar, tools] = [document.querySelector(".lk-bar"), document.querySelector(".pe-tools")].map((e) => e?.getBoundingClientRect());
      if (!bar || !tools) return "absent";
      const hit = bar.left < tools.right && bar.right > tools.left && bar.top < tools.bottom && bar.bottom > tools.top;
      return hit ? JSON.stringify([bar, tools]) : "";
    });
    ok("A5 la barre typographique ne recouvre pas la barre d'outils du bloc", overlap === "", overlap);
    await page.screenshot({ path: path.join(SHOTS, "a5-barre-et-supprimer.png") });
    ok("A5 le centre du bouton « Supprimer » reçoit le clic (rien dessus)", await f.evaluate(() => {
      const b = document.querySelector('.pe-tools [aria-label="Supprimer"]');
      const r = b.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return top === b || b.contains(top);
    }));
    await f.locator('.pe-tools [aria-label="Supprimer"]').click();
    await page.locator("dialog[open]").getByRole("button", { name: /Supprimer/ }).click();
    ok("A5 essai du panneau retiré", await waitFor(() => draftBlocks().length === baseCount + 3));
    await settled();

    // Case vide d'une grille : les trois choix.
    await openChoice();
    await dlg.locator('.ve-add-card[data-key="grid"]').click();
    ok("A6 grille ajoutée", await waitFor(() => draftBlocks().at(-1)?.type === "grid"));
    const cells = f.locator("[data-edit-cell-text]");
    await cells.first().waitFor({ timeout: 60000 });
    const kinds = await cells.evaluateAll((els) => els.slice(0, 3).map((e) => e.getAttribute("data-edit-cell-text")));
    ok("A6 la case vide propose Texte, Titre, Titre + texte", kinds.join() === "text,title,title-text", kinds.join());
    await cells.first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, "a6-case-vide.png") });
    await f.locator('[data-edit-cell-text="title"]').first().click();
    ok("A6 « Titre » ajouté DANS la grille", await waitFor(() => draftBlocks().at(-1)?.props.children?.[0]?.type === "section-title"));
    await page.keyboard.press("Escape");
    await settled();
    const cellBtn = f.locator('[data-edit-cell-text="text"]').first();
    await cellBtn.scrollIntoViewIfNeeded();
    await cellBtn.click();
    ok("A6 « Texte » ajouté DANS la grille, paragraphe seul", await waitFor(() => { const c = draftBlocks().at(-1)?.props.children?.[1]; return c?.type === "rich-text" && !("title" in c.props); }), JSON.stringify(draftBlocks().at(-1)?.props.children));
    await page.keyboard.press("Escape");
    await settled();
    const gridUid = draftBlocks().at(-1).uid;
    await f.evaluate((u) => document.querySelector(`.pe-focus[data-uid="${u}"]`)?.click(), gridUid);
    await f.locator('.pe-tools [aria-label="Supprimer"]').click();
    await page.locator("dialog[open]").getByRole("button", { name: /Supprimer/ }).click();
    ok("A6 grille de l'essai retirée", await waitFor(() => draftBlocks().every((b) => b.type !== "grid")));
    await settled();
  });

/* ---- B. Hauteurs et rythme (toile) ------------------------------------------------------------------------------- */

let heightText = 0;
let heightTextPt = 0;
if (run("B") || run("C"))
  await section("B", async () => {
    const mt = await measureCanvas(f, uids.text);
    const mb = await measureCanvas(f, uids.both);
    const mh = await measureCanvas(f, uids.title);
    heightText = mt.height;
    heightTextPt = mt.pt;
    ok("B1 toile : « Texte » seul = l'espace de section, puis le paragraphe (rien entre les deux)", Math.abs(mt.extra) <= 0.5 && Math.abs(mt.pt - mt.gap) <= 0.5, JSON.stringify(mt));
    ok("B1 toile : « Titre + texte » garde son titre et sa marge (rendu inchangé)", mb.hasTitle && mb.extra > 60, JSON.stringify(mb));
    ok("B1 toile : « Titre + texte » plus haut que « Texte » seul du titre et de sa marge", mb.height - mt.height > 60, `${mb.height} - ${mt.height}`);
    ok("B1 toile : « Titre » seul : ni paragraphe, ni présentation, ni étiquette (aucun texte gris pour un champ absent)", mh.hasTitle && mh.inlines.join() === "title" && mh.placeholders.join() === "Titre" && !mh.hasEyebrow, JSON.stringify(mh));
    console.log(`INFO hauteurs sur la toile (px) : Texte ${mt.height}, Titre ${mh.height}, Titre + texte ${mb.height} ; espace de section ${mt.gap}`);
    await f.locator(`[data-edit-block="${uids.text}"]`).scrollIntoViewIfNeeded().catch(() => {});
    await f.evaluate((u) => document.querySelector(`.pe-focus[data-uid="${u}"]`)?.scrollIntoView({ block: "center" }), uids.text);
    await stableScroll(f);
    await page.screenshot({ path: path.join(SHOTS, "b1-trois-blocs.png") });
  });

/* ---- C. Ajouter puis retirer un titre ------------------------------------------------------------------------------ */

if (run("C"))
  await section("C", async () => {
    await f.evaluate((u) => document.querySelector(`.pe-focus[data-uid="${u}"]`)?.scrollIntoView({ block: "center" }), uids.text);
    await stableScroll(f);
    await idle();
    const before = await measureCanvas(f, uids.text);
    const para = f.locator(`[data-edit-block="${uids.text}"] [data-inline="paragraphs.0"]`);
    const pb = await para.boundingBox();
    await page.mouse.move(pb.x + 40, pb.y + pb.height / 2, { steps: 4 });
    const add = f.locator(`[data-edit-block="${uids.text}"] [data-edit-field-op="add-title"]`);
    ok("C1 au survol, « + Ajouter un titre » apparaît sur le Texte seul", await waitFor(async () => (await add.evaluate((e) => getComputedStyle(e).opacity).catch(() => "0")) === "1", 15000) && /Ajouter un titre/.test((await add.textContent()) ?? ""));
    await page.screenshot({ path: path.join(SHOTS, "c1-ajouter-un-titre.png") });
    ok("C1 aucun bouton « Retirer le titre » tant qu'il n'y a pas de titre", (await f.locator(`[data-edit-block="${uids.text}"] [data-edit-field-op="remove-title"]`).count()) === 0);
    await add.click();
    ok("C2 le titre est créé (texte d'aide) dans le brouillon", await waitFor(() => draftBlocks().find((b) => b.uid === uids.text)?.props.title?.fr === "Titre de la rubrique"), JSON.stringify(draftBlocks().find((b) => b.uid === uids.text)?.props));
    ok("C2 édition en place ouverte sur le titre, texte d'aide sélectionné", (await f.locator('[data-editing][data-inline="title"]').waitFor({ timeout: 60000 }).then(() => true, () => false)) && (await selectedText(f)) === "Titre de la rubrique", await selectedText(f));
    await page.keyboard.type("Titre ajouté");
    await page.keyboard.press("Enter");
    ok("C2 titre saisi", await waitFor(() => draftBlocks().find((b) => b.uid === uids.text)?.props.title?.fr === "Titre ajouté"));
    await settled();
    await waitFor(async () => (await measureCanvas(f, uids.text)).hasTitle, 15000);
    const withTitle = await measureCanvas(f, uids.text);
    ok("C2 le bloc a pris la place d'un titre (hauteur et marge sous le titre)", withTitle.hasTitle && withTitle.height - before.height > 60 && withTitle.extra > 60, `${before.height} → ${withTitle.height}`);
    // Retrait.
    await idle();
    const pb2 = await para.boundingBox();
    await page.mouse.move(pb2.x + 40, pb2.y + pb2.height / 2, { steps: 4 });
    const remove = f.locator(`[data-edit-block="${uids.text}"] [data-edit-field-op="remove-title"]`);
    ok("C3 au survol, « Retirer le titre » remplace « + Ajouter un titre »", await waitFor(async () => (await remove.evaluate((e) => getComputedStyle(e).opacity).catch(() => "0")) === "1", 15000) && /Retirer le titre/.test((await remove.textContent()) ?? ""));
    await page.screenshot({ path: path.join(SHOTS, "c3-retirer-le-titre.png") });
    await remove.click();
    ok("C3 la clé title est retirée du brouillon (le bloc redevient un paragraphe seul)", await waitFor(() => { const b = draftBlocks().find((x) => x.uid === uids.text); return b && !("title" in b.props) && !("eyebrow" in b.props) && b.props.paragraphs?.[0]?.fr === SAME; }), JSON.stringify(draftBlocks().find((b) => b.uid === uids.text)?.props));
    await settled();
    await waitFor(async () => !(await measureCanvas(f, uids.text)).hasTitle, 15000);
    const after = await measureCanvas(f, uids.text);
    ok("C3 la hauteur redevient exactement celle d'un Texte seul", Math.abs(after.height - before.height) <= 0.5 && !after.hasTitle, `${before.height} → ${after.height}`);
    // Un titre ajouté puis laissé tel quel est refusé à la publication.
    await idle();
    await para.hover();
    await page.mouse.move((await para.boundingBox()).x + 40, (await para.boundingBox()).y + 10, { steps: 3 });
    await f.locator(`[data-edit-block="${uids.text}"] [data-edit-field-op="add-title"]`).click();
    await f.locator('[data-editing][data-inline="title"]').waitFor({ timeout: 60000 });
    await page.keyboard.press("Escape");
    await settled();
    await tryPublish();
    ok("D3 titre ajouté laissé tel quel : publication refusée", await page.getByText(/Remplace le texte d'exemple/).first().waitFor({ timeout: 60000 }).then(() => true, () => false));
    // Retire de nouveau (annule l'ajout) : le bloc redevient publiable.
    await idle();
    const pb3 = await para.boundingBox();
    await page.mouse.move(pb3.x + 40, pb3.y + pb3.height / 2, { steps: 4 });
    await f.locator(`[data-edit-block="${uids.text}"] [data-edit-field-op="remove-title"]`).click();
    ok("C4 titre retiré de nouveau", await waitFor(() => !("title" in (draftBlocks().find((b) => b.uid === uids.text)?.props ?? { title: 1 }))));
    await settled();

    // Bloc « Titre » : étiquette facultative, ajoutée puis retirée de la même façon.
    await idle();
    await f.evaluate((u) => document.querySelector(`.pe-focus[data-uid="${u}"]`)?.scrollIntoView({ block: "center" }), uids.title);
    await stableScroll(f);
    const h2 = f.locator(`[data-edit-block="${uids.title}"] [data-inline="title"]`);
    const tb = await h2.boundingBox();
    const tBefore = await measureCanvas(f, uids.title);
    await page.mouse.move(tb.x + 40, tb.y + tb.height / 2, { steps: 4 });
    const addE = f.locator(`[data-edit-block="${uids.title}"] [data-edit-field-op="add-eyebrow"]`);
    ok("C5 « Titre » : au survol, « + Ajouter une étiquette »", await waitFor(async () => (await addE.evaluate((e) => getComputedStyle(e).opacity).catch(() => "0")) === "1", 15000));
    await page.screenshot({ path: path.join(SHOTS, "c5-ajouter-une-etiquette.png") });
    await addE.click();
    ok("C5 l'étiquette est créée (vide) et s'édite aussitôt", (await waitFor(() => JSON.stringify(draftBlocks().find((b) => b.uid === uids.title)?.props.eyebrow) === JSON.stringify({ fr: "", en: "" }))) && (await f.locator('[data-editing][data-inline="eyebrow"]').waitFor({ timeout: 60000 }).then(() => true, () => false)));
    await page.keyboard.type("Carnet");
    await page.keyboard.press("Enter");
    ok("C5 étiquette saisie", await waitFor(() => draftBlocks().find((b) => b.uid === uids.title)?.props.eyebrow?.fr === "Carnet"));
    await settled();
    await idle();
    await f.evaluate((u) => document.querySelector(`.pe-focus[data-uid="${u}"]`)?.scrollIntoView({ block: "center" }), uids.title);
    await stableScroll(f);
    const tb2 = await h2.boundingBox();
    await page.mouse.move(tb2.x + 40, tb2.y + tb2.height / 2, { steps: 4 });
    const remE = f.locator(`[data-edit-block="${uids.title}"] [data-edit-field-op="remove-eyebrow"]`);
    await waitFor(async () => (await remE.evaluate((e) => getComputedStyle(e).opacity).catch(() => "0")) === "1", 15000);
    await remE.click();
    ok("C5 « Retirer l'étiquette » : la clé eyebrow disparaît, la hauteur d'origine revient", (await waitFor(() => !("eyebrow" in (draftBlocks().find((b) => b.uid === uids.title)?.props ?? { eyebrow: 1 })))) && (await waitFor(async () => Math.abs((await measureCanvas(f, uids.title)).height - tBefore.height) <= 0.5, 15000)), `${tBefore.height} → ${(await measureCanvas(f, uids.title)).height} ${JSON.stringify(draftBlocks().find((b) => b.uid === uids.title)?.props)}`);
    await settled();
  });

/* ---- E. Public --------------------------------------------------------------------------------------------------- */

if (run("E"))
  await section("E", async () => {
    ok("E0 publication (les textes d'aide sont remplacés)", await publish(), `${await page.locator(".ve-status").textContent()}`);
    const pub = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await pub.goto(`${BASE}/fr/a-propos`, { waitUntil: "networkidle" });
    const leaks = await pub.evaluate(() => [...document.querySelectorAll("[data-placeholder], [data-edit-block], [data-inline], .pe-field-op")].length);
    ok("E1 public : aucun repère d'édition, aucun bouton de titre, aucun texte d'aide dans le DOM", leaks === 0 && !/Écris ton texte|Titre de la rubrique/.test(await pub.evaluate(() => document.body.innerText)), String(leaks));
    const measure = (needle) => pub.evaluate(
      ({ needle, src }) => {
        const m = new Function("root", `return (${src})(root)`);
        const el = [...document.querySelectorAll("p, h2")].find((e) => (e.textContent ?? "").includes(needle));
        return el ? m(el) : null;
      },
      { needle, src: MEASURE.toString() },
    );
    const pt = await measure(SAME);
    // Plusieurs sections portent SAME : la première est « Texte » (ordre du brouillon : Titre, Texte, Titre + texte).
    const secs = await pub.evaluate((src) => {
      const m = new Function("root", `return (${src})(root)`);
      return [...document.querySelectorAll("section")].filter((s) => (s.textContent ?? "").includes("Une même phrase")).map((s) => m(s));
    }, MEASURE.toString());
    const [pText, pBoth] = secs;
    ok("E2 public : deux sections de texte trouvées", secs.length === 2 && Boolean(pt), String(secs.length));
    ok("E2 public : « Texte » seul = l'espace de section puis le paragraphe (rien entre les deux)", Math.abs(pText.extra) <= 0.5 && Math.abs(pText.pt - pText.gap) <= 0.5 && !pText.hasTitle && !pText.hasEyebrow, JSON.stringify(pText));
    ok("E2 public : « Titre + texte » garde son titre", pBoth.hasTitle && pBoth.extra > 60 && pBoth.height - pText.height > 60, JSON.stringify(pBoth));
    ok("E2 public : la hauteur de « Texte » seul (hors espace de section) = celle de la toile", Math.abs(pText.height - pText.pt - (heightText - heightTextPt)) <= 2, `${pText.height - pText.pt} vs toile ${heightText - heightTextPt}`);
    const titleOnly = await pub.evaluate(() => {
      const h = [...document.querySelectorAll("section h2")].find((e) => e.textContent === "Mes carnets");
      const sec = h?.closest("section");
      return sec ? { paragraphs: sec.querySelectorAll("p:not(.eyebrow)").length, eyebrows: sec.querySelectorAll(".eyebrow").length } : null;
    });
    ok("E3 public : « Titre » seul, sans paragraphe de présentation ni étiquette", titleOnly && titleOnly.paragraphs === 0 && titleOnly.eyebrows === 0, JSON.stringify(titleOnly));
    const pubPublished = publishedBlocks().slice(-3);
    ok("E4 base publiée : les trois blocs avec les seuls champs voulus", pubPublished.map((b) => `${b.type}:${"title" in b.props ? "T" : "-"}${b.props.paragraphs ? "P" : "-"}${"intro" in b.props ? "I" : "-"}`).join() === "section-title:T--,rich-text:-P-,rich-text:TP-", JSON.stringify(pubPublished.map((b) => b.props)));
    await pub.screenshot({ path: path.join(SHOTS, "e1-public-trois.png"), fullPage: true });
    await pub.evaluate(() => document.querySelectorAll("section").forEach((s) => (s.textContent ?? "").includes("Mes carnets") && s.scrollIntoView({ block: "start" })));
    await sleep(500);
    await pub.screenshot({ path: path.join(SHOTS, "e2-public-zoom.png") });
  });

/* ---- F. En carte : boutons de champ atteignables à la souris, rendu toile = public, étiquette (v0.18.1) -------------- */

if (run("F"))
  await section("F", async () => {
    const P = (t) => ({ fr: t, en: t });
    const para = (t) => ({ paragraphs: [P(t)] });
    const BLOCKS = [
      { uid: "f-text", type: "rich-text", props: { ...para("Un texte en carte, sans titre, dont le bouton doit rester atteignable."), surface: {} } },
      { uid: "f-title", type: "section-title", props: { title: P("Un titre en carte"), surface: {} } },
      { uid: "f-both", type: "rich-text", props: { title: P("Titre et texte en carte"), ...para("Le paragraphe qui suit le titre, dans la carte."), surface: {} } },
      { uid: "f-grid", type: "grid", props: { layout: "2", gap: "normal", align: "stretch", ratio: "auto", top: "gap", children: [{ uid: "f-gc1", type: "rich-text", props: para("Cellule de la grille après la carte.") }, { uid: "f-gc2", type: "rich-text", props: para("Seconde cellule de la grille.") }] } },
      { uid: "f-eb", type: "rich-text", props: { eyebrow: P("Étiquette du texte"), title: P("Titre à retirer seul"), ...para("Paragraphe d'un Texte qui porte une étiquette.") } },
    ];
    {
      const db = new Database(DB);
      db.pragma("busy_timeout = 5000");
      const row = db.prepare("select title, slug, meta, nav_order from pages where id = ?").get(PAGE_ID);
      const draft = { title: JSON.parse(row.title), slug: JSON.parse(row.slug), meta: row.meta ? JSON.parse(row.meta) : { title: { fr: "", en: "" }, description: { fr: "", en: "" } }, published: true, inMenu: row.nav_order !== null, accent: null, blocks: BLOCKS };
      db.prepare("update pages set draft = ?, draft_updated_at = unixepoch(), draft_rev = draft_rev + 1 where id = ?").run(JSON.stringify(draft), PAGE_ID);
      db.close();
    }
    await page.goto(`${BASE}/admin/pages/${PAGE_ID}/editer`, { waitUntil: "domcontentloaded" });
    f = await canvas();
    await sleep(1500);

    /** Survole le contenu de l'hôte, puis rejoint le bouton en 25 pas et clique : comme une main. */
    async function clickOp(uid, op, anchor) {
      // La barre typographique de la saisie précédente peut se poser sur le bloc voisin : on la referme (un clic ailleurs la ferme aussi).
      if (await f.locator(".lk-bar").count()) await f.locator(".lk-bar .lk-close").click();
      await f.evaluate((u) => document.querySelector(`.pe-focus[data-uid="${u}"]`)?.scrollIntoView({ block: "center" }), uid);
      await stableScroll(f);
      const a = await f.locator(`[data-edit-block="${uid}"] ${anchor}`).first().boundingBox();
      const btn = f.locator(`[data-edit-block="${uid}"] [data-edit-field-op="${op}"]`);
      await page.mouse.move(a.x + 40, a.y + a.height / 2, { steps: 4 });
      await btn.waitFor({ state: "attached", timeout: 30000 });
      const b = await btn.boundingBox();
      await page.mouse.move(a.x + 40, a.y + a.height / 2);
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 25 });
      const hit = await btn.evaluate((e) => { const r = e.getBoundingClientRect(); const t = e.ownerDocument.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return t === e || e.contains(t) ? "" : `${t?.tagName}.${t?.className} ${JSON.stringify(r)}`; });
      await page.mouse.down();
      await page.mouse.up();
      if (hit) console.log("clickOp", op, "bouton recouvert par", hit);
      return !hit;
    }
    const prop = (uid) => draftBlocks().find((b) => b.uid === uid)?.props;
    const inCard = await f.evaluate(() => document.querySelectorAll('[data-edit-block="f-text"] > .surface-card[data-surface="on"], [data-edit-block="f-title"] > .surface-card[data-surface="on"]').length);
    ok("F0 deux blocs en carte sur la toile", inCard === 2, String(inCard));

    ok("F1 Texte en carte : le bouton « + Ajouter un titre » est atteignable à la souris (25 pas) et le clic l'active", (await clickOp("f-text", "add-title", '[data-inline="paragraphs.0"]')) && (await waitFor(() => prop("f-text")?.title !== undefined, 15000)), JSON.stringify(prop("f-text")));
    await typeOver(f, "title", "Titre ajouté en carte");
    await settled();
    ok("F2 Titre en carte : « + Ajouter une étiquette » atteignable à la souris et actif", (await clickOp("f-title", "add-eyebrow", '[data-inline="title"]')) && (await waitFor(() => prop("f-title")?.eyebrow !== undefined, 15000)), JSON.stringify(prop("f-title")));
    await typeOver(f, "eyebrow", "Carnet");
    await settled();

    // Lot 19a.1 : « Retirer le titre » ne retire que le titre ; l'étiquette a son propre bouton.
    ok("F3 « Retirer le titre » : le titre part, l'étiquette reste", (await clickOp("f-eb", "remove-title", '[data-inline="paragraphs.0"]')) && (await waitFor(() => prop("f-eb") && !("title" in prop("f-eb")), 15000)) && prop("f-eb").eyebrow?.fr === "Étiquette du texte", JSON.stringify(prop("f-eb")));
    await settled();
    ok("F3 « Retirer l'étiquette » existe sur le Texte et retire l'étiquette", (await clickOp("f-eb", "remove-eyebrow", '[data-inline="paragraphs.0"]')) && (await waitFor(() => prop("f-eb") && !("eyebrow" in prop("f-eb")), 15000)) && prop("f-eb").paragraphs?.[0]?.fr.startsWith("Paragraphe"), JSON.stringify(prop("f-eb")));
    await settled();

    // Rendu toile = public : décalage du titre dans sa carte, espace entre une carte et la grille qui suit.
    const MEAS = (root) => {
      const cards = [...root.querySelectorAll(".surface-card[data-surface=on]")];
      // Début du contenu de la grille (après son espace de section) ; la toile y ajoute ses places « Étiquette » / « Titre », absentes en public.
      const grid = root.querySelector(".block-grid-section");
      const out = {};
      for (const c of cards) {
        const key = ["Titre et texte en carte", "Titre ajouté en carte", "Un titre en carte"].find((k) => (c.textContent ?? "").includes(k));
        if (!key) continue;
        const r = c.getBoundingClientRect();
        const h2 = [...c.querySelectorAll("h2")].find((h) => (h.textContent ?? "").includes(key));
        out[key] = { h2Top: h2 ? Math.round((h2.getBoundingClientRect().top - r.top) * 10) / 10 : null, h2Margin: h2 ? parseFloat(getComputedStyle(h2).marginTop) : null, h: Math.round(r.height * 10) / 10 };
        if (key === "Titre et texte en carte" && grid) out.gapToGrid = Math.round((grid.getBoundingClientRect().top + parseFloat(getComputedStyle(grid).paddingTop) - r.bottom) * 10) / 10;
      }
      return out;
    };
    const onCanvas = await f.evaluate(`(${MEAS.toString()})(document)`);
    ok("F4 publication de la page de l'essai", await publish(), `${await page.locator(".ve-status").textContent()}`);
    // Même largeur que la toile : l'espace de section et le retrait des cartes suivent la largeur de la fenêtre.
    const canvasW = await f.evaluate(() => document.documentElement.clientWidth);
    const pub = await (await browser.newContext({ viewport: { width: canvasW, height: 900 } })).newPage();
    await pub.goto(`${BASE}/fr/a-propos`, { waitUntil: "networkidle" });
    const onPublic = await pub.evaluate(`(${MEAS.toString()})(document)`);
    console.log(`INFO toile ${JSON.stringify(onCanvas)} ; public ${JSON.stringify(onPublic)}`);
    const keys = ["Titre et texte en carte", "Titre ajouté en carte", "Un titre en carte"];
    for (const k of keys) {
      const a = onCanvas[k];
      const b = onPublic[k];
      ok(`F5 « ${k} » : titre à la même hauteur dans sa carte, toile et public (≤ 4 px)`, Boolean(a && b) && Math.abs(a.h2Top - b.h2Top) <= 4, `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
      // Un titre sous une étiquette garde sa marge (16 px) ; sans étiquette, rien ne s'ajoute au padding de la carte.
      if (k !== "Un titre en carte") ok(`F5 « ${k} » : le titre n'ajoute pas de marge haute dans la carte (toile)`, Boolean(a) && a.h2Margin === 0, JSON.stringify(a));
    }
    ok("F6 espace entre la carte et la grille qui suit : toile = public (≤ 4 px)", onCanvas.gapToGrid !== undefined && onPublic.gapToGrid !== undefined && Math.abs(onCanvas.gapToGrid - onPublic.gapToGrid) <= 4, `${onCanvas.gapToGrid} vs ${onPublic.gapToGrid}`);
    await pub.context().close();
  });

ok("aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
