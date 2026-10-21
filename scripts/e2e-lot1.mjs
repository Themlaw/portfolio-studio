#!/usr/bin/env node
/**
 * Corrections v0.13.1 (lot 1), UN chromium, clics RÉELS (souris : déplacement,
 * appui, relâche — jamais seulement l'API). Serveur dev requis, base NEUVE.
 *
 *  A. Formulaire de contact : « + Ajouter un champ » près du bas de la toile ;
 *     le menu s'ouvre DANS la fenêtre, « Texte court » ajoute le champ.
 *  B. Aperçu d'un thème ouvert depuis Thèmes : « Quitter l'aperçu » (bouton,
 *     puis Échap) ramène à Admin → Thèmes ; depuis Pages, ramène à Pages.
 *  C. Grille : espace sous la grille, le bloc suivant ne colle pas.
 *  D. Pied de page en bas de l'écran sur une page courte (et la toile intacte).
 *  E. Ordre des images : réordonné sur une page, la même planche posée sur une
 *     autre page montre le même ordre (brouillon), signalé ; puis l'ordre publié.
 *  F. E-mail jamais coupé au milieu, police du texte, plusieurs largeurs.
 *  G. Réglages : « + Réseau » (même composant que la toile), lien à compléter
 *     signalé, adresse invalide refusée ; icônes des réseaux dans l'en-tête
 *     (case), avec aria-label, dans le menu sur téléphone.
 *  H. Éditeur : case « Icônes des réseaux dans l'en-tête » du panneau En-tête.
 *  I. Palette : « Entrées des collections ».
 *
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… SHOTS=/root/shots-lot1/e2e node scripts/e2e-lot1.mjs
 *         ONLY=A,B (sections choisies)
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const DB = path.join(process.env.DATA_DIR ?? "data", "portfolio.db");
const SHOTS = process.env.SHOTS ?? "screenshots/lot1-e2e";
const ONLY = process.env.ONLY ?? "";
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
function ok(label, cond, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Interrupteur « Icônes des réseaux dans l'en-tête » : clic sur son libellé (comme l'artiste). */
async function setHeaderSwitch(p, on) {
  const sw = p.getByRole("switch", { name: "Icônes des réseaux dans l'en-tête" });
  if ((await sw.isChecked()) !== on) await p.locator("label.a-toggle", { hasText: "Icônes des réseaux dans l'en-tête" }).click();
  return (await sw.isChecked()) === on;
}

const q = (sql, ...args) => {
  const db = new Database(DB, { readonly: true });
  try {
    return db.prepare(sql).all(...args);
  } finally {
    db.close();
  }
};
const draftOf = (id) => JSON.parse(q("select draft from pages where id = ?", id)[0]?.draft ?? "null");
const pageId = (slug) => q("select id from pages where json_extract(slug,'$.fr') = ?", slug)[0].id;
const run = (k) => !ONLY || ONLY.split(",").includes(k);

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
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

const until = (f, fn, arg, timeout = 60000) =>
  f.waitForFunction(fn, arg, { timeout, polling: 200 }).then(
    () => true,
    () => false,
  );
async function canvas() {
  const handle = await page.waitForSelector("iframe.ve-frame", { timeout: 90000 });
  const f = await handle.contentFrame();
  await f.waitForSelector("html[data-edit-mode]", { timeout: 120000 });
  await sleep(1200);
  return f;
}
async function settled() {
  await page.waitForFunction(() => !/Enregistrement/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, { timeout: 90000 });
  await sleep(600);
}
async function openEditor(id) {
  // Depuis l'éditeur : on attend que tout soit enregistré avant de partir
  // (sinon le garde de sortie retient légitimement la navigation).
  if (/\/editer/.test(page.url())) await settled().catch(() => {});
  await page.goto(`${BASE}/admin/pages/${id}/editer`, { waitUntil: "domcontentloaded" });
  const f = await canvas();
  if (await page.getByRole("button", { name: "Abandonner les modifications" }).count()) {
    await page.getByRole("button", { name: "Abandonner les modifications" }).click();
    await Promise.all([
      page.waitForEvent("framenavigated", { predicate: (fr) => fr === page.mainFrame(), timeout: 60000 }),
      page.getByRole("dialog").getByRole("button", { name: "Abandonner les modifications" }).click(),
    ]);
    return canvas();
  }
  return f;
}
const frameBox = () => page.locator("iframe.ve-frame").boundingBox();
/** Clic réel : la souris se déplace jusqu'au centre de l'élément (coordonnées de la page), appuie, relâche. */
async function realClick(locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("élément invisible");
  await page.mouse.move(b.x + b.width / 2 - 120, b.y + b.height / 2 - 60);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await sleep(120);
  await page.mouse.down();
  await sleep(60);
  await page.mouse.up();
}
async function dragTo(from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y + 6, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 18 });
  await sleep(350);
  await page.mouse.up();
}
async function dragPalette(key, to) {
  await page.getByRole("tab", { name: "Ajouter" }).click();
  const card = page.locator(`.ve-card[data-key="${key}"], .ve-model[data-key="${key}"]`).first();
  await card.scrollIntoViewIfNeeded();
  const b = await card.boundingBox();
  await dragTo({ x: b.x + b.width / 2, y: b.y + b.height / 2 }, to);
}
/** Milieu entre les blocs i et i+1 de la page (coordonnées de la toile), après défilement. */
async function between(f, i) {
  return f.evaluate((i) => {
    const els = [...document.querySelectorAll("[data-edit-block]:not([data-edit-parent])")];
    const box = (el) => {
      const r = [...el.querySelectorAll("*")].map((c) => c.getBoundingClientRect()).filter((x) => x.height);
      return { top: Math.min(...r.map((x) => x.top)), bottom: Math.max(...r.map((x) => x.bottom)) };
    };
    const first = els[i];
    window.scrollTo({ top: window.scrollY + box(first).bottom - window.innerHeight / 2, behavior: "instant" });
    return (box(els[i]).bottom + box(els[i + 1]).top) / 2;
  }, i);
}
const published = () => until(page, () => /^(Publié|En ligne)/.test(document.querySelector(".ve-status")?.textContent?.trim() ?? "") && !document.querySelector(".ve-alert[role=alert]"), null, 90000);

/* ---- A. Formulaire : « + Ajouter un champ » au clic réel --------------------------- */

if (run("A")) {
  const about = pageId("a-propos");
  let f = await openEditor(about);
  await f.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
  await sleep(400);
  const fb = await frameBox();
  const prof = await f.locator('[data-edit-type="profile"] section').first().boundingBox();
  await dragPalette("contact-with-form", { x: fb.x + fb.width / 2, y: Math.min(prof.y + prof.height + 40, fb.y + fb.height - 30) });
  await settled();
  const block = () => draftOf(about)?.blocks.find((b) => b.type === "contact" && b.props.form === true);
  ok("A1 formulaire posé (3 champs)", block()?.props.fields.length === 3);
  await f.waitForSelector("form[data-form-edit]", { timeout: 30000 });
  // Puce tout en bas de la toile : là où le menu s'ouvrait hors de la fenêtre.
  await f.evaluate(() => {
    const chip = document.querySelector('[data-testid="field-add"]');
    const r = chip.getBoundingClientRect();
    window.scrollTo({ top: window.scrollY + r.bottom - window.innerHeight + 30, behavior: "instant" });
  });
  await sleep(500);
  const chip = f.locator('[data-testid="field-add"]');
  await realClick(chip);
  const menu = f.locator('.pe-popover[aria-label="Ajouter un champ"]');
  ok("A2 clic réel : le menu « Ajouter un champ » s'ouvre", await menu.isVisible().catch(() => false));
  const mb = await menu.boundingBox();
  const fb2 = await frameBox();
  ok("A3 le menu est entièrement dans la fenêtre de la toile", Boolean(mb) && mb.y >= fb2.y && mb.y + mb.height <= fb2.y + fb2.height, JSON.stringify({ mb, fb2 }));
  ok("A3b le focus est dans le menu (clavier)", await f.evaluate(() => Boolean(document.activeElement?.closest(".pe-popover"))));
  await page.screenshot({ path: `${SHOTS}/A-menu-ajouter-un-champ.png` });
  await realClick(f.getByRole("menuitem", { name: "Texte court" }));
  await settled();
  ok("A4 clic réel sur « Texte court » : champ ajouté", block()?.props.fields.length === 4 && block().props.fields[3].type === "text", JSON.stringify(block()?.props.fields.map((x) => x.type)));
  ok("A5 champ visible sur la toile", await until(f, () => document.querySelectorAll("form[data-form-edit] [data-form-field]").length === 4, null, 30000));
  // Au clavier aussi : Entrée sur la puce, flèche, Entrée.
  await f.locator('[data-testid="field-add"]').focus();
  await page.keyboard.press("Enter");
  await sleep(300);
  await f.getByRole("menuitem", { name: "Texte long" }).focus();
  await page.keyboard.press("Enter");
  await settled();
  ok("A6 au clavier : champ « Texte long » ajouté", block()?.props.fields.length === 5 && block().props.fields[4].type === "textarea");
  f = await openEditor(about); // abandon
}

/* ---- B. Quitter l'aperçu ---------------------------------------------------------- */

if (run("B")) {
  await page.goto(`${BASE}/admin/themes`, { waitUntil: "networkidle" });
  const card = page.locator("form[action='/admin/apercu'][target=_blank]").nth(1);
  const [tab] = await Promise.all([ctx.waitForEvent("page"), card.getByRole("button").click()]);
  await tab.waitForLoadState("domcontentloaded");
  await tab.locator(".preview-banner").waitFor({ timeout: 60000 });
  ok("B1 l'aperçu s'ouvre sur le site (nouvel onglet)", /\/fr$/.test(new URL(tab.url()).pathname), tab.url());
  await tab.screenshot({ path: `${SHOTS}/B-apercu-bandeau.png` });
  await Promise.all([tab.waitForURL((u) => u.pathname.startsWith("/admin"), { timeout: 60000 }), tab.getByRole("button", { name: "Quitter l'aperçu" }).click()]);
  ok("B2 « Quitter l'aperçu » ramène à Admin → Thèmes", new URL(tab.url()).pathname === "/admin/themes", tab.url());
  await tab.close();
  const [tab2] = await Promise.all([ctx.waitForEvent("page"), card.getByRole("button").click()]);
  await tab2.locator(".preview-banner").waitFor({ timeout: 60000 });
  await tab2.waitForLoadState("networkidle");
  await Promise.all([tab2.waitForURL((u) => u.pathname.startsWith("/admin"), { timeout: 60000 }), tab2.keyboard.press("Escape")]);
  ok("B3 Échap quitte l'aperçu, retour à Admin → Thèmes", new URL(tab2.url()).pathname === "/admin/themes", tab2.url());
  ok("B4 plus d'aperçu ensuite (pas de bandeau sur le site)", !(await (await tab2.request.get(`${BASE}/fr`)).text()).includes("preview-banner"));
  await tab2.close();
  // Depuis la liste des pages : retour à la liste des pages.
  await page.goto(`${BASE}/admin/pages`, { waitUntil: "networkidle" });
  const [tab3] = await Promise.all([ctx.waitForEvent("page"), page.locator("form[action='/admin/apercu'][target=_blank] button").first().click()]);
  await tab3.locator(".preview-banner").waitFor({ timeout: 60000 });
  await Promise.all([tab3.waitForURL((u) => u.pathname.startsWith("/admin"), { timeout: 60000 }), tab3.getByRole("button", { name: "Quitter l'aperçu" }).click()]);
  ok("B5 aperçu ouvert depuis Pages : retour à Pages", new URL(tab3.url()).pathname === "/admin/pages", tab3.url());
  await tab3.close();
}

/* ---- C. Grille : espace en bas ------------------------------------------------------- */

if (run("C")) {
  const pub = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pp = await pub.newPage();
  await pp.goto(`${BASE}/fr/animation`, { waitUntil: "networkidle" });
  const m = await pp.evaluate(() =>
    [...document.querySelectorAll(".block-grid")].map((g) => {
      const section = g.closest("section");
      const cells = [...g.querySelectorAll("*")].map((x) => x.getBoundingClientRect()).filter((r) => r.height);
      const contentBottom = Math.max(...cells.map((r) => r.bottom));
      const next = section.nextElementSibling ?? document.querySelector("footer");
      return { pad: parseFloat(getComputedStyle(section).paddingBottom), room: Math.round(next.getBoundingClientRect().top - contentBottom) };
    }),
  );
  ok("C1 chaque grille a un espace en bas (≥ 24 px)", m.length > 0 && m.every((x) => x.pad >= 24), JSON.stringify(m));
  ok("C2 le bloc suivant ne colle pas au contenu de la grille", m.every((x) => x.room >= 24), JSON.stringify(m));
  await pub.close();
}

/* ---- D. Pied de page en bas de l'écran ----------------------------------------------- */

if (run("D")) {
  const pub = await browser.newContext({ viewport: { width: 1440, height: 1500 } });
  const pp = await pub.newPage();
  for (const [w, h] of [
    [1440, 1500],
    [390, 1400],
  ]) {
    await pp.setViewportSize({ width: w, height: h });
    await pp.goto(`${BASE}/fr/page-qui-nexiste-pas`, { waitUntil: "networkidle" });
    const r = await pp.evaluate(() => ({ bottom: Math.round(document.querySelector("footer").getBoundingClientRect().bottom + window.scrollY), vh: window.innerHeight, doc: document.documentElement.scrollHeight }));
    ok(`D1 page courte ${w}×${h} : pied collé au bas de l'écran`, Math.abs(r.bottom - r.vh) <= 1 && r.doc <= r.vh + 1, JSON.stringify(r));
    await pp.screenshot({ path: `${SHOTS}/D-pied-page-courte-${w}.png` });
  }
  await pp.setViewportSize({ width: 1440, height: 900 });
  await pp.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  const sticky = await pp.evaluate(async () => {
    window.scrollTo({ top: 1500, behavior: "instant" });
    await new Promise((r) => setTimeout(r, 300));
    return Math.round(document.querySelector(".site-header").getBoundingClientRect().top);
  });
  ok("D2 page longue : l'en-tête reste collant", sticky === 0, String(sticky));
  await pub.close();
  const f = await openEditor(1);
  const r = await f.evaluate(() => ({ header: getComputedStyle(document.querySelector(".site-header")).position, footer: Boolean(document.querySelector("[data-edit-global='footer']")), frame: Boolean(document.querySelector(".site-frame")) }));
  ok("D3 toile : en-tête dans le flux, pied repéré, cadre présent", r.header !== "sticky" && r.footer && r.frame, JSON.stringify(r));
}

/* ---- E. Ordre des images d'une planche ------------------------------------------------- */

if (run("E")) {
  const p2 = pageId("personnages");
  const p3 = pageId("decors");
  let f = await openEditor(p2);
  const boards = () => f.evaluate(() => [...document.querySelectorAll("[data-edit-board]")].map((b) => ({ label: b.getAttribute("data-edit-board-label"), imgs: [...b.querySelectorAll("[data-edit-rail] > [data-edit-slot] img")].map((i) => i.getAttribute("src")) })));
  const list = await boards();
  const target = [...list].sort((a, b) => b.imgs.length - a.imgs.length)[0];
  ok("E0 planche de plusieurs images trouvée", target.imgs.length >= 2, JSON.stringify(list.map((x) => [x.label, x.imgs.length])));
  const first = `[data-edit-board][data-edit-board-label="${target.label}"] [data-edit-rail] > [data-edit-slot]:nth-child(1)`;
  await f.locator(first).scrollIntoViewIfNeeded();
  await f.locator(first).focus();
  await page.keyboard.press("Shift+ArrowRight");
  await settled();
  await sleep(1500);
  const reordered = (await boards()).find((x) => x.label === target.label).imgs;
  ok("E1 image avancée d'un cran (brouillon)", reordered[0] === target.imgs[1] && reordered[1] === target.imgs[0], JSON.stringify(reordered));
  // Autre page, page 1 NON publiée : la planche reposée montre le brouillon.
  f = await openEditor(p3);
  const y = await between(f, 0);
  const fb = await frameBox();
  await dragPalette("project-board", { x: fb.x + fb.width / 2, y: fb.y + Math.min(y, fb.height - 40) });
  await f.waitForSelector(".pe-board-new input[role=combobox]", { timeout: 30000 });
  await settled();
  await f.locator(".pe-board-new input").fill(target.label);
  await sleep(500);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  ok("E2 planche du même projet posée sur une autre page", await until(f, (l) => document.querySelectorAll(`[data-edit-board][data-edit-board-label="${l}"]`).length > 0, target.label, 30000));
  await settled();
  await sleep(1500);
  const other = (await boards()).filter((x) => x.label === target.label);
  const full = other.find((x) => x.imgs.length === target.imgs.length) ?? other[0];
  /** a avant b dans la liste ? */
  const before = (list, a, b) => list.indexOf(a) > -1 && list.indexOf(a) < list.indexOf(b);
  ok("E3 même ordre que le brouillon de l'autre page (pas l'ordre publié)", before(full.imgs, reordered[0], reordered[1]), JSON.stringify({ full: full.imgs, reordered }));
  ok("E4 signalé : « en cours de modification sur la page … »", await f.locator("[data-edit-board-held]").first().isVisible().catch(() => false));
  await f.locator("[data-edit-board-held]").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/E-planche-tenue-ailleurs.png` });
  // Publier la première page : l'ordre devient celui du projet ; la planche le garde.
  f = await page.goto(`${BASE}/admin/pages/${p2}/editer`, { waitUntil: "domcontentloaded" }).then(() => canvas());
  await page.getByRole("button", { name: "Publier" }).click();
  ok("E5 publication de la première page", await published());
  const pub = await browser.newContext();
  const pp = await pub.newPage();
  await pp.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
  const media = (src) => (src ?? "").replace(/^.*\/media\//, "").split(/[-_.]/)[0];
  const publicOrder = await pp.evaluate(() => [...document.querySelectorAll("section.strip")].map((s) => ({ t: s.textContent, imgs: [...s.querySelectorAll(".strip-rail img")].map((i) => i.getAttribute("src")) })));
  ok("E6 ordre publié = ordre réordonné", publicOrder.some((s) => before(s.imgs.map(media), media(reordered[0]), media(reordered[1]))), JSON.stringify(publicOrder.map((s) => s.imgs.map(media))));
  await pub.close();
  f = await page.goto(`${BASE}/admin/pages/${p3}/editer`, { waitUntil: "domcontentloaded" }).then(() => canvas());
  const after = (await boards()).filter((x) => x.label === target.label);
  ok("E7 l'autre page montre l'ordre publié, sans signal", after.some((x) => before(x.imgs, reordered[0], reordered[1])) && !(await f.locator("[data-edit-board-held]").count()), JSON.stringify(after));
  await openEditor(p3); // abandon de la planche posée
}

/* ---- F. Adresse e-mail -------------------------------------------------------------- */

if (run("F")) {
  const pub = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pp = await pub.newPage();
  for (const w of [1440, 1280, 1024, 820, 768, 390, 360]) {
    await pp.setViewportSize({ width: w, height: 900 });
    await pp.goto(`${BASE}/fr/a-propos`, { waitUntil: "networkidle" });
    await pp.evaluate(() => document.fonts.ready);
    const r = await pp.evaluate(() =>
      [...document.querySelectorAll(".email-link")].map((a) => {
        const parts = [...a.querySelectorAll(".email-part")];
        const text = a.querySelector(".email-text");
        const lines = new Set(parts.map((p) => Math.round(p.getBoundingClientRect().top))).size;
        return {
          where: a.closest("footer") ? "pied" : "profil",
          brokenPart: parts.some((p) => p.getClientRects().length > 1),
          lines,
          splitAfterAt: lines === 1 || parts[0]?.textContent.endsWith("@"),
          overflow: Math.round(text.getBoundingClientRect().right) > document.documentElement.clientWidth,
          font: getComputedStyle(text).fontFamily === getComputedStyle(document.body).fontFamily,
          display: getComputedStyle(text).fontFamily.includes(getComputedStyle(document.documentElement).getPropertyValue("--font-display").trim().split(",")[0]),
          size: getComputedStyle(text).fontSize,
        };
      }),
    );
    ok(`F1 ${w}px : jamais coupé au milieu, coupure seulement après l'@, police du texte`, r.length === 2 && r.every((x) => !x.brokenPart && x.splitAfterAt && !x.overflow && x.font), JSON.stringify(r));
    if (w >= 1024) ok(`F2 ${w}px : profil et pied sur une seule ligne`, r.every((x) => x.lines === 1), JSON.stringify(r));
  }
  await pub.close();
}

/* ---- G. Réglages : réseaux et icônes de l'en-tête ------------------------------------ */

if (run("G")) {
  await page.goto(`${BASE}/admin/reglages`, { waitUntil: "networkidle" });
  const before = await page.locator(".a-socials-row").count();
  const kindsBefore = JSON.parse(q("select value from settings where key = 'socials'")[0].value).map((s) => s.kind ?? null);
  // Au centre de la fenêtre : en bas d'écran, la barre d'enregistrement collante recouvre le bouton (le clic souris tomberait dessus).
  await page.getByRole("button", { name: "+ Réseau" }).evaluate((el) => el.scrollIntoView({ block: "center" }));
  await realClick(page.getByRole("button", { name: "+ Réseau" }));
  ok("G1 « + Réseau » : menu des réseaux classiques + Autre lien", (await page.getByRole("menuitem", { name: "Behance" }).count()) === 1 && (await page.getByRole("menuitem", { name: "Autre lien" }).count()) === 1);
  await page.screenshot({ path: `${SHOTS}/G-reglages-plus-reseau.png` });
  await page.getByRole("menuitem", { name: "Autre lien" }).click();
  await page.getByLabel("Adresse du profil").fill("https://www.behance.net/camille");
  ok("G2 adresse reconnue (Behance)", await page.getByText("Reconnu : Behance").isVisible());
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  ok("G3 réseau ajouté à la liste", (await page.locator(".a-socials-row").count()) === before + 1);
  // Adresse invalide refusée par le même composant.
  await page.getByRole("button", { name: /^Modifier Behance/ }).last().click();
  await page.getByLabel("Adresse du profil").fill("javascript:alert(1)");
  ok("G4 adresse javascript: refusée (message, bouton désactivé)", (await page.getByText(/Adresse invalide/).isVisible()) && (await page.getByRole("button", { name: "Enregistrer le lien" }).isDisabled()));
  await page.getByLabel("Adresse du profil").fill("https://www.behance.net/camille-roussel");
  await page.getByRole("button", { name: "Enregistrer le lien" }).click();
  // Icônes dans l'en-tête.
  ok("G4b case cochée", await setHeaderSwitch(page, true));
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  ok("G5 enregistré", await until(page, () => /Enregistré/.test(document.body.textContent ?? ""), null, 30000));
  const socials = JSON.parse(q("select value from settings where key = 'socials'")[0].value);
  const site = JSON.parse(q("select value from settings where key = 'site'")[0].value);
  ok("G6 réglages : réseau rangé avec son type, option de l'en-tête", socials.some((s) => s.kind === "behance" && s.href.endsWith("camille-roussel")) && site.headerSocials === true, JSON.stringify({ socials, site }));
  ok("G6b les types des réseaux existants sont gardés", kindsBefore.every((k, i) => (socials[i].kind ?? null) === k), JSON.stringify({ kindsBefore, socials }));
  const pub = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pp = await pub.newPage();
  await pp.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  const head = await pp.evaluate(() => {
    const nav = document.querySelector(".site-header nav");
    const icons = [...nav.querySelectorAll(".site-header-socials a")];
    const locale = [...nav.children].findIndex((c) => /FR|EN/.test(c.textContent ?? "") && !c.matches(".site-header-socials"));
    const list = [...nav.children].findIndex((c) => c.matches(".site-header-socials"));
    return { labels: icons.map((a) => a.getAttribute("aria-label")), text: icons.map((a) => a.textContent.trim()).join(""), before: list > -1 && list < locale && locale === list + 1 };
  });
  const published = JSON.parse(q("select value from settings where key = 'socials'")[0].value).filter((s) => /^(https?:|mailto:)/.test(s.href));
  ok("G7 en-tête : une icône par réseau, aria-label, juste avant FR/EN", head.labels.length === published.length && head.labels.every(Boolean) && head.text === "" && head.before, JSON.stringify(head));
  await pp.screenshot({ path: `${SHOTS}/G-entete-icones-1440.png`, clip: { x: 0, y: 0, width: 1440, height: 110 } });
  await pp.setViewportSize({ width: 390, height: 844 });
  await pp.reload({ waitUntil: "networkidle" });
  ok("G8 téléphone : icônes absentes de la barre, présentes dans le menu", !(await pp.locator(".site-header-bar .site-header-socials").isVisible().catch(() => false)));
  await pp.locator('button[aria-controls="nav-mobile"]').click();
  ok("G9 menu mobile : icônes des réseaux (aria-label)", (await pp.locator("#nav-mobile .site-header-socials a[aria-label]").count()) === published.length);
  await pp.screenshot({ path: `${SHOTS}/G-menu-mobile-icones.png` });
  await pub.close();
  // Remise en état : option décochée, réseau ajouté retiré.
  await page.reload({ waitUntil: "networkidle" });
  await setHeaderSwitch(page, false);
  await page.getByRole("button", { name: /^Retirer Behance/ }).last().click();
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await sleep(1500);
}

/* ---- H. Panneau En-tête de l'éditeur ------------------------------------------------- */

if (run("H")) {
  const f = await openEditor(1);
  await f.locator(".site-header .site-brand").click();
  await page.getByRole("tab", { name: "Réglages" }).click().catch(() => {});
  const toggle = page.getByRole("switch", { name: "Icônes des réseaux dans l'en-tête" });
  ok("H1 panneau En-tête : case « Icônes des réseaux dans l'en-tête »", await toggle.isVisible().catch(() => false));
  await setHeaderSwitch(page, true);
  await settled();
  // Un réseau à l'adresse complète (ceux de la base de test sont « à compléter », jamais montrés).
  await page.locator('[data-testid="socials-editor"] [data-testid="social-add"]').click();
  await page.getByRole("menuitem", { name: "Instagram" }).click();
  await page.getByLabel("Adresse du profil").fill("https://www.instagram.com/camille");
  await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await settled();
  ok("H2 toile : icônes dans l'en-tête (brouillon du site)", await until(f, () => document.querySelectorAll(".site-header .site-header-socials a[aria-label]").length > 0, null, 30000));
  ok("H3 rien de public avant Publier", JSON.parse(q("select value from settings where key = 'site'")[0].value).headerSocials !== true);
  await page.screenshot({ path: `${SHOTS}/H-panneau-entete.png` });
  ok("H4 panneau : « + Réseau » partagé", (await page.locator('[data-testid="socials-editor"] [data-testid="social-add"]').count()) === 1);
  await openEditor(1); // abandon
}

/* ---- I. Palette --------------------------------------------------------------------- */

if (run("I")) {
  await openEditor(1);
  await page.getByRole("tab", { name: "Ajouter" }).click();
  const card = page.locator('.ve-card[data-type="collection-tiles"]').first();
  const text = (await card.textContent()) ?? "";
  ok("I1 palette : « Entrées des collections » et sa description", text.includes("Entrées des collections") && text.includes("Une grande image par collection (Personnages, Décors…), qui mène à sa page."), text);
}

ok("aucune erreur JavaScript", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `${failures} échec(s)` : "tout est passé");
process.exit(failures ? 1 : 0);
