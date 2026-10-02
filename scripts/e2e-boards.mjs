#!/usr/bin/env node
/**
 * Planches sur la toile (phase 7b), UN chromium. Serveur dev requis
 * (redémarré, pré-chauffé), une connexion. Travaille sur la page d'accueil et
 * la remet dans son état publié d'origine à la fin (projet créé supprimé).
 *
 * Planche neuve nommée sur la toile ; 2 médias déposés, puis un fichier de
 * l'ordinateur ENTRE les deux (fantôme en progression) ; réordonner par
 * glisser ; clavier (Maj+→) ; barre au survol : Supprimer (la place reste),
 * remplir la place, Retirer la place ; Annuler ; Aperçu ; un anonyme ne voit
 * rien avant Publier (ni le projet ailleurs), tout après ; Abandonner sur un
 * second essai efface emplacements et projet créé. Captures 1440 + 390 dans
 * screenshots/phase7b.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… node scripts/e2e-boards.mjs
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";
import sharp from "sharp";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const DB = path.join(process.env.DATA_DIR ?? "data", "portfolio.db");
const SHOTS = "screenshots/phase7b";
mkdirSync(SHOTS, { recursive: true });
const SHOTS2 = "screenshots/phase7b2";
mkdirSync(SHOTS2, { recursive: true });
const PROJECT = "Carnet de croquis";
const THROWAWAY = "Projet jetable";

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

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());

await page.goto(`${BASE}/admin/connexion`, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL);
await page.fill("#password", PASSWORD);
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/admin/connexion"), { timeout: 60000 }), page.click("button[type=submit]")]);

/* ---- Aides ------------------------------------------------------------------ */

async function canvas(p = page) {
  const handle = await p.waitForSelector("iframe.ve-frame", { timeout: 60000 });
  const f = await handle.contentFrame();
  await f.waitForSelector("html[data-edit-mode]", { timeout: 90000 });
  return f;
}
async function settled(p = page) {
  await p.waitForFunction(() => !/Enregistrement/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, { timeout: 90000 });
}
const until = (f, fn, arg, timeout = 60000) =>
  f.waitForFunction(fn, arg, { timeout, polling: 200 }).then(
    () => true,
    () => false,
  );
async function discardAll(p = page) {
  const fab = p.locator(".ve-fab");
  if (await fab.isVisible().catch(() => false)) await fab.click();
  await p.getByRole("button", { name: "Abandonner les modifications" }).click();
  await Promise.all([
    p.waitForEvent("framenavigated", { predicate: (fr) => fr === p.mainFrame(), timeout: 60000 }),
    p.getByRole("dialog").getByRole("button", { name: "Abandonner les modifications" }).click(),
  ]);
  await p.waitForLoadState("domcontentloaded");
  return canvas(p);
}
async function openFresh(p = page) {
  await p.goto(`${BASE}/admin/pages/1/editer`, { waitUntil: "domcontentloaded" });
  const f = await canvas(p);
  if (await p.getByRole("button", { name: "Abandonner les modifications" }).count()) return discardAll(p);
  return f;
}
/** Planche du projet nommé, dans la toile. */
const boardSel = (title) => `[data-edit-board][data-edit-board-label="${title}"]`;
/** Sources des images de la planche, dans l'ordre (null = place vide). */
const boardImages = (f, title) =>
  f.$$eval(`${boardSel(title)} [data-edit-rail] > [data-edit-slot]`, (els) => els.map((el) => (el.hasAttribute("data-empty") ? null : (el.querySelector("img")?.getAttribute("src") ?? "?"))));
const slotCount = (f, title, n) => until(f, ([sel, n]) => document.querySelectorAll(`${sel} [data-edit-rail] > [data-edit-slot]`).length === n, [boardSel(title), n]);
/** Glisser (souris) d'un point à un autre, avec capture pendant le geste. */
async function dragTo(p, from, to, shot) {
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  await p.mouse.move(from.x + 10, from.y + 6, { steps: 3 });
  await p.mouse.move(to.x, to.y, { steps: 16 });
  await sleep(300);
  if (shot) await shot();
  await p.mouse.up();
}
/** Point d'un élément de la toile, en coordonnées de la page. */
async function framePoint(f, selector, where = "center") {
  const box = await f.locator(selector).first().boundingBox();
  if (!box) throw new Error(`introuvable : ${selector}`);
  const x = where === "left" ? box.x + 4 : where === "right" ? box.x + box.width - 4 : box.x + box.width / 2;
  return { x, y: box.y + Math.min(box.height / 2, 120) };
}
/** Glisse un média de l'onglet Médias vers un point de la toile. */
async function dragMedia(p, mediaId, to, shot) {
  const thumb = p.locator(`.ve-media li[data-media="${mediaId}"]`);
  await thumb.scrollIntoViewIfNeeded();
  const b = await thumb.boundingBox();
  await dragTo(p, { x: b.x + b.width / 2, y: b.y + b.height / 2 }, to, shot);
}

/* ---- Planche neuve ------------------------------------------------------------ */

let f = await openFresh();
// Palette : la planche d'un projet en tête, l'autre nommée sans ambiguïté.
await page.getByRole("tab", { name: "Ajouter" }).click();
ok("palette : « Planche d'un projet » en premier", (await page.locator(".ve-card").first().getAttribute("data-type")) === "project-board");
// v0.13 : les planches se posent une à une ; l'ancien bloc automatique n'est plus proposé.
ok("palette : plus de « Planches d'une collection »", (await page.locator('.ve-card[data-type="collection-projects"]').count()) === 0);
await page.locator(".ve-pane").evaluate((el) => el.scrollTo(0, 0));
await sleep(300);
await page.screenshot({ path: `${SHOTS2}/1440-palette.png` });
const publishedProjects = q("select count(*) n from projects where draft_page_id is null")[0].n;
// Composant glissé entre les blocs 2 et 3.
await f.evaluate(() => {
  const el = document.querySelectorAll("[data-edit-block]:not([data-edit-parent])")[2];
  const c = [...el.querySelectorAll("*")].find((x) => x.getBoundingClientRect().height);
  window.scrollTo({ top: window.scrollY + c.getBoundingClientRect().top - window.innerHeight / 2, behavior: "instant" });
});
await sleep(300);
const between = await f.evaluate(() => {
  const els = document.querySelectorAll("[data-edit-block]:not([data-edit-parent])");
  const box = (el) => {
    const r = [...el.querySelectorAll("*")].map((c) => c.getBoundingClientRect()).filter((r) => r.height);
    return { top: Math.min(...r.map((x) => x.top)), bottom: Math.max(...r.map((x) => x.bottom)) };
  };
  return (box(els[1]).bottom + box(els[2]).top) / 2;
});
const frameBox = await page.locator("iframe.ve-frame").boundingBox();
const card = page.locator('.ve-card[data-type="project-board"]');
await card.scrollIntoViewIfNeeded();
const cb = await card.boundingBox();
await dragTo(page, { x: cb.x + cb.width / 2, y: cb.y + cb.height / 2 }, { x: frameBox.x + frameBox.width / 2, y: frameBox.y + between });
ok("planche neuve déposée sur la toile : nom, projet existant, zone de dépôt", await until(f, () => Boolean(document.querySelector(".pe-board-new input[role=combobox]")) && /Dépose tes images ici/.test(document.querySelector(".pe-board-new")?.textContent ?? "")));
await settled();
await f.locator(".pe-board-new").scrollIntoViewIfNeeded();
await sleep(500);
await page.screenshot({ path: `${SHOTS}/1440-planche-neuve.png` });
await f.locator(".pe-board-new input").fill(PROJECT);
await f.locator(".pe-board-new input").press("Enter");
ok("Entrée crée le projet : la planche apparaît", await until(f, (sel) => Boolean(document.querySelector(sel)), boardSel(PROJECT)));
await settled();
const created = q("select id, slug, draft_page_id p from projects where json_extract(title,'$.fr') = ?", PROJECT)[0];
ok("projet créé en brouillon de la page", created?.p === 1, JSON.stringify(created));
const board = created.id;

/* ---- Deux médias, puis un fichier entre les deux ------------------------------ */

await page.getByRole("tab", { name: "Médias" }).click();
const ready = q("select id from media where status = 'ready' and mime like 'image/%' order by id limit 2").map((r) => r.id);
await f.locator(boardSel(PROJECT)).scrollIntoViewIfNeeded();
await dragMedia(page, ready[0], await framePoint(f, `${boardSel(PROJECT)} header`));
ok("1er média déposé sur la planche", await slotCount(f, PROJECT, 1));
await settled();
const first = await framePoint(f, `${boardSel(PROJECT)} [data-edit-slot]`, "right");
await dragMedia(page, ready[1], { x: first.x + 40, y: first.y }, async () => {
  ok("curseur d'insertion vertical pendant le glisser", (await f.locator(".pe-drop-cursor").count()) === 1);
  await page.screenshot({ path: `${SHOTS}/1440-curseur.png` });
});
ok("2e média déposé après le premier", await slotCount(f, PROJECT, 2));
await settled();
const [a, b] = await boardImages(f, PROJECT);

// Fichier de l'ordinateur déposé entre les deux (envoi ralenti : fantôme visible).
const png = await sharp({ create: { width: 320, height: 240, channels: 3, background: "#c0503a" } }).png().toBuffer();
const slow = async (route) => {
  await sleep(2500);
  await route.continue();
};
await page.route("**/admin/api/upload**", slow);
const gap = await f.evaluate((sel) => {
  const els = [...document.querySelectorAll(`${sel} [data-edit-rail] > [data-edit-slot]`)];
  const r0 = els[0].getBoundingClientRect();
  const r1 = els[1].getBoundingClientRect();
  return { x: (r0.right + r1.left) / 2, y: r0.top + Math.min(r0.height / 2, 120) };
}, boardSel(PROJECT));
const dt = await f.evaluateHandle((bytes) => {
  const data = new DataTransfer();
  data.items.add(new File([new Uint8Array(bytes)], "entre-les-deux.png", { type: "image/png" }));
  return data;
}, [...png]);
const rail = f.locator(`${boardSel(PROJECT)} [data-edit-rail]`);
await rail.dispatchEvent("dragover", { dataTransfer: dt, clientX: gap.x, clientY: gap.y });
await rail.dispatchEvent("drop", { dataTransfer: dt, clientX: gap.x, clientY: gap.y });
ok("fantôme en progression à la position même", await until(f, (sel) => {
  const kids = [...document.querySelector(`${sel} [data-edit-rail]`).children];
  const i = kids.findIndex((k) => k.hasAttribute("data-ghost"));
  return i === 1 && /Envoi|Conversion/.test(kids[i].textContent);
}, boardSel(PROJECT), 10000));
await sleep(400);
await page.screenshot({ path: `${SHOTS}/1440-fantome.png` });
ok("le fichier devient un emplacement entre les deux médias", await slotCount(f, PROJECT, 3));
await page.unroute("**/admin/api/upload**", slow);
await settled();
await until(f, () => !document.querySelector("[data-ghost]"), null, 15000);
let order = await boardImages(f, PROJECT);
ok("ordre : média 1, fichier, média 2", order.length === 3 && order[0] === a && order[2] === b && order[1] !== a && order[1] !== b, JSON.stringify(order));
const x = order[1];
ok("la médiathèque du panneau montre le fichier envoyé, sans rechargement", await until(page.mainFrame(), () => [...document.querySelectorAll(".ve-media li")].some((li) => /entre-les-deux/.test(li.getAttribute("title") ?? "")), null, 20000));

/* ---- Réordonner : glisser, puis clavier ---------------------------------------- */

/** Attend un ordre précis des images de la planche. */
const orderIs = (want) =>
  until(f, ([sel, want]) => {
    const src = [...document.querySelectorAll(`${sel} [data-edit-rail] > [data-edit-slot]`)].map((el) => el.querySelector("img")?.getAttribute("src") ?? null);
    return src.join("|") === want.join("|");
  }, [boardSel(PROJECT), want], 20000);
const lastSlot = `${boardSel(PROJECT)} [data-edit-rail] > [data-edit-slot]:nth-child(3)`;
const firstSlot = `${boardSel(PROJECT)} [data-edit-rail] > [data-edit-slot]:nth-child(1)`;
await dragTo(page, await framePoint(f, lastSlot), await framePoint(f, firstSlot, "left"));
await settled();
ok("glisser : la 3e image passe en tête", await orderIs([b, a, x]), JSON.stringify(await boardImages(f, PROJECT)));
await f.locator(firstSlot).focus();
await page.keyboard.press("Shift+ArrowRight");
ok("Maj+→ : l'image avance d'un cran", await orderIs([a, b, x]), JSON.stringify(await boardImages(f, PROJECT)));
ok("annonce aria-live du déplacement", /position 2 sur 3/.test(await f.locator(".pe-live").textContent()));

/* ---- Barre au survol : Supprimer, remplir, Retirer la place, Annuler ---------- */

await page.mouse.move(0, 0);
await f.locator(`${boardSel(PROJECT)} [data-edit-rail] > [data-edit-slot]:nth-child(2)`).hover();
ok("barre au survol d'une image : Remplacer, Supprimer, Retirer la place", await until(f, () => {
  const t = document.querySelector(".pe-slot-tools")?.textContent ?? "";
  return /Remplacer/.test(t) && /Supprimer/.test(t) && /Retirer la place/.test(t);
}));
await sleep(300);
await page.screenshot({ path: `${SHOTS}/1440-barre-survol.png` });
await f.locator(".pe-slot-tools").getByRole("button", { name: "Supprimer" }).click();
ok("Supprimer : la place reste, vide", await until(f, (sel) => document.querySelectorAll(`${sel} [data-edit-slot][data-empty]`).length === 1 && document.querySelectorAll(`${sel} [data-edit-rail] > [data-edit-slot]`).length === 3, boardSel(PROJECT)));
ok("toast avec « Annuler »", await page.locator(".a-toast-action", { hasText: "Annuler" }).first().isVisible());
await settled();
await page.mouse.move(0, 0);
await f.locator(`${boardSel(PROJECT)} [data-edit-slot][data-empty]`).scrollIntoViewIfNeeded();
await sleep(300);
await page.screenshot({ path: `${SHOTS}/1440-place-gardee.png` });
await dragMedia(page, ready[1], await framePoint(f, `${boardSel(PROJECT)} [data-edit-slot][data-empty]`));
ok("place remplie par un média glissé", await until(f, (sel) => document.querySelectorAll(`${sel} [data-edit-slot][data-empty]`).length === 0, boardSel(PROJECT)));
await settled();
await f.locator(`${boardSel(PROJECT)} [data-edit-rail] > [data-edit-slot]:nth-child(3)`).hover();
await until(f, () => Boolean(document.querySelector(".pe-slot-tools")));
await f.locator(".pe-slot-tools").getByRole("button", { name: "Retirer la place" }).click();
ok("Retirer la place : un emplacement de moins", await slotCount(f, PROJECT, 2));
await settled();
await page.mouse.move(0, 0);
await page.keyboard.press("Control+z");
ok("Annuler (Ctrl+Z) : la place revient", await slotCount(f, PROJECT, 3));
await settled();

/* ---- Titre d'une image en place --------------------------------------------- */

await f.locator(`${boardSel(PROJECT)} [data-edit-rail] > [data-edit-slot]:nth-child(1) [data-slot-inline="title"]`).dblclick();
await page.keyboard.type("Étude au fusain");
await page.keyboard.press("Enter");
await settled();
ok("titre d'image modifié en place", await until(f, (sel) => document.querySelector(`${sel} [data-edit-rail] > [data-edit-slot]:nth-child(1) [data-slot-inline="title"]`)?.textContent === "Étude au fusain", boardSel(PROJECT)));

/* ---- Aperçu ----------------------------------------------------------------- */

await page.getByRole("button", { name: "Aperçu", exact: true }).click();
ok("Aperçu : aucun repère « Titre » / « Légende » sous les images", await until(f, (sel) => !/Légende|Titre/.test(document.querySelector(sel)?.innerText ?? "Titre"), boardSel(PROJECT)));
ok("Aperçu : ni barre d'image, ni place vide, ni fantôme", await until(f, () => !document.querySelector(".pe-slot-tools") && !document.querySelector(".pe-layer") && [...document.querySelectorAll(".pe-empty-slot, [data-ghost]")].every((el) => getComputedStyle(el).display === "none")));
await page.keyboard.press("Escape");
f = await canvas();

/* ---- Anonyme : rien avant Publier, tout après --------------------------------- */

const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const visitor = await anon.newPage();
const seen = async (url) => (await (await anon.request.get(`${BASE}${url}`)).text()).includes(PROJECT);
ok("anonyme, avant Publier : la planche n'est pas sur l'accueil", !(await seen("/fr")));
ok("anonyme, avant Publier : le projet neuf n'est sur aucune autre page", !(await seen("/fr/personnages")) && !(await seen("/fr/decors")) && !(await seen("/fr/animation")));
await page.getByRole("button", { name: "Publier" }).click();
ok("Publier : en ligne", await until(page.mainFrame(), () => /Publié : la page est en ligne/.test(document.body.innerText), null, 60000));
await visitor.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
{
  const text = await visitor.locator("body").innerText();
  const imgs = await visitor.locator(`section[aria-labelledby="project-${created.slug}"] .strip-rail img`).count();
  ok("anonyme, après Publier : la planche, ses 3 images et le titre", text.includes(PROJECT) && imgs === 3 && text.includes("Étude au fusain"), `projet ${text.includes(PROJECT)} · ${imgs} images · titre ${text.includes("Étude au fusain")}`);
}
ok("projet public après publication", q("select draft_page_id p from projects where id = ?", board)[0]?.p === null);

/* ---- 390 px -------------------------------------------------------------------- */

const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await ctx.storageState() });
const m = await mctx.newPage();
m.on("pageerror", (e) => errors.push(e.message));
let mf = await openFresh(m);
await mf.locator(boardSel(PROJECT)).scrollIntoViewIfNeeded();
await sleep(500);
// Premier toucher (clic) sur une image : la barre apparaît.
await mf.locator(`${boardSel(PROJECT)} [data-edit-rail] > [data-edit-slot]:nth-child(1)`).click();
ok("390 : un toucher sur une image montre sa barre", await until(mf, () => Boolean(document.querySelector(".pe-slot-tools"))));
await sleep(300);
await m.screenshot({ path: `${SHOTS}/390-barre.png` });
await mf.locator(".pe-slot-tools").getByRole("button", { name: "Supprimer" }).click();
await until(mf, (sel) => document.querySelectorAll(`${sel} [data-edit-slot][data-empty]`).length === 1, boardSel(PROJECT));
await settled(m);
await m.mouse.move(0, 0);
await sleep(400);
await m.screenshot({ path: `${SHOTS}/390-place-gardee.png` });
// Fantôme à 390 (envoi ralenti).
await m.route("**/admin/api/upload**", slow);
const mdt = await mf.evaluateHandle((bytes) => {
  const data = new DataTransfer();
  data.items.add(new File([new Uint8Array(bytes)], "mobile.png", { type: "image/png" }));
  return data;
}, [...png]);
const mrail = mf.locator(`${boardSel(PROJECT)} [data-edit-rail]`);
// Entre la 2e et la 3e image (la 1re est la place vide).
await mf.evaluate((sel) => document.querySelector(`${sel} [data-edit-rail] > [data-edit-slot]:nth-child(2)`).scrollIntoView({ inline: "center", block: "nearest", behavior: "instant" }), boardSel(PROJECT));
await sleep(300);
const mgap = await mf.evaluate((sel) => {
  const el = document.querySelector(`${sel} [data-edit-rail] > [data-edit-slot]:nth-child(2)`).getBoundingClientRect();
  return { x: el.right + 4, y: el.top + 60 };
}, boardSel(PROJECT));
await mrail.dispatchEvent("dragover", { dataTransfer: mdt, clientX: mgap.x, clientY: mgap.y });
await m.screenshot({ path: `${SHOTS}/390-curseur.png` });
await mrail.dispatchEvent("drop", { dataTransfer: mdt, clientX: mgap.x, clientY: mgap.y });
await until(mf, () => Boolean(document.querySelector("[data-ghost]")), null, 10000);
await sleep(300);
await m.screenshot({ path: `${SHOTS}/390-fantome.png` });
await slotCount(mf, PROJECT, 4);
await m.unroute("**/admin/api/upload**", slow);
await settled(m);
// Planche neuve à 390.
await m.locator(".ve-fab").click();
await m.locator('.ve-card[data-type="project-board"]').click();
ok("390 : planche neuve ajoutée au toucher", await until(mf, () => Boolean(document.querySelector(".pe-board-new input")), null, 30000));
await settled(m);
await mf.locator(".pe-board-new").scrollIntoViewIfNeeded();
await sleep(400);
await m.screenshot({ path: `${SHOTS}/390-planche-neuve.png` });
mf = await discardAll(m);
ok("390 : abandon, la planche publiée est intacte", (await boardImages(mf, PROJECT)).length === 3);
await mctx.close();

/* ---- Second essai : Abandonner efface tout --------------------------------------- */

f = await openFresh();
await page.getByRole("tab", { name: "Ajouter" }).click();
await page.locator('.ve-card[data-type="project-board"]').click();
await until(f, () => Boolean(document.querySelector(".pe-board-new input")), null, 30000);
await settled();
await f.locator(".pe-board-new input").fill(THROWAWAY);
await f.locator(".pe-board-new input").press("Enter");
await until(f, (sel) => Boolean(document.querySelector(sel)), boardSel(THROWAWAY));
await settled();
await page.getByRole("tab", { name: "Médias" }).click();
await f.locator(boardSel(THROWAWAY)).scrollIntoViewIfNeeded();
await dragMedia(page, ready[0], await framePoint(f, `${boardSel(THROWAWAY)} header`));
await slotCount(f, THROWAWAY, 1);
// Une image ajoutée aussi à la planche publiée.
await f.locator(boardSel(PROJECT)).scrollIntoViewIfNeeded();
await dragMedia(page, ready[0], await framePoint(f, `${boardSel(PROJECT)} [data-edit-slot]`, "left"));
await slotCount(f, PROJECT, 4);
await settled();
// Supprimer le bloc d'une planche dont les images ont changé : le toast le dit, Annuler la retrouve.
const pUid = await f.$eval(boardSel(PROJECT), (el) => el.closest("[data-edit-block]")?.dataset.editBlock);
await f.locator(`[data-edit-block="${pUid}"] header h2`).click();
await until(f, () => Boolean(document.querySelector(".pe-tools")));
await f.locator(".pe-tools").getByRole("button", { name: "Supprimer" }).click();
await page.getByRole("dialog").getByRole("button", { name: "Supprimer le bloc" }).click();
const i1 = page.locator(".a-toast", { hasText: "ne seront pas publiés" });
ok("bloc planche supprimé : « Les changements d'images de cette planche ne seront pas publiés »", await i1.waitFor({ state: "visible", timeout: 15000 }).then(() => true, () => false));
await sleep(300);
await page.screenshot({ path: `${SHOTS2}/1440-toast-planche.png` });
await settled();
await i1.getByRole("button", { name: "Annuler" }).click();
ok("Annuler retrouve la planche et ses changements", await slotCount(f, PROJECT, 4));
await settled();
const throwaway = q("select id from projects where json_extract(title,'$.fr') = ?", THROWAWAY)[0]?.id;
f = await discardAll();
ok("Abandonner : projet créé en brouillon supprimé", throwaway && !q("select id from projects where id = ?", throwaway).length);
ok("Abandonner : emplacements ajoutés supprimés, planche publiée intacte", (await boardImages(f, PROJECT)).length === 3 && !q("select id from slots where draft_page_id is not null or draft_state is not null").length);
ok("anonyme : rien du second essai", !(await (await anon.request.get(`${BASE}/fr`)).text()).includes(THROWAWAY));

/* ---- Remise en état : retirer la planche, supprimer le projet ----------------- */

const blockUid = await f.$eval(boardSel(PROJECT), (el) => el.closest("[data-edit-block]")?.dataset.editBlock);
await f.locator(`[data-edit-block="${blockUid}"] header h2`).click();
await until(f, () => Boolean(document.querySelector(".pe-tools")));
await f.locator(".pe-tools").getByRole("button", { name: "Supprimer" }).click();
await page.getByRole("dialog").getByRole("button", { name: "Supprimer le bloc" }).click();
await settled();
await page.getByRole("button", { name: "Publier" }).click();
await until(page.mainFrame(), () => /Publié : la page est en ligne/.test(document.body.innerText), null, 60000);
await page.goto(`${BASE}/admin/projets`, { waitUntil: "networkidle" });
const row = page.locator("tr, li, article").filter({ hasText: PROJECT }).first();
await row.getByRole("button", { name: "Supprimer" }).click();
await page.getByRole("dialog").getByRole("button", { name: "Supprimer le projet" }).click();
await sleep(1500);
ok("remise en état : projet supprimé, accueil d'origine", !q("select id from projects where id = ?", board).length && q("select count(*) n from projects where draft_page_id is null")[0].n === publishedProjects && !(await (await anon.request.get(`${BASE}/fr`)).text()).includes(PROJECT));

ok("aucune erreur JavaScript", errors.length === 0, errors.slice(0, 3).join(" | "));
await anon.close();
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout est passé.");
process.exit(failures ? 1 : 0);
