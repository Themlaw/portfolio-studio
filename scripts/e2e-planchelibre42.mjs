#!/usr/bin/env node
/**
 * Lot 42 « Planche libre » (chromium, serveur requis, base neuve, une connexion admin). Gestes à la souris réelle (`page.mouse`,
 * coordonnées de la fenêtre : la toile est un cadre de la page de l'éditeur), jamais de clic programmatique sur la toile. Images :
 * quatre PNG détourés (fond transparent) générés ici, envoyés par la médiathèque.
 *
 *  P  Palette : « Planche libre » dans Images et vidéos ; ajout d'une rubrique ; zone vide avec « + Image ».
 *  G  Page, gestes : « + Image » (sélecteur), glisser trois images de la médiathèque sur la zone (posées là), déplacer (repères
 *     magnétiques, Alt les coupe), redimensionner par un coin (coin opposé fixe), pivoter (poignée, champ en degrés), devant /
 *     derrière, Annuler / Rétablir de chaque geste, clavier (flèches 1 %, Maj 5 %, Suppr).
 *  S  Barre de l'image : arrondi, cadre, remplacer, supprimer ; hauteur libre (poignée du bas) ; panneau Réglages.
 *  Q  Publication d'une composition de 4 images qui se chevauchent : parité des positions toile / site en ligne (±1 %) à
 *     1440 px et à 1024 px ; ordre du DOM = ordre de lecture ; alt ; variantes srcset ; rien d'édition dans le HTML public ;
 *     téléphone (390 px) en deux modes (à l'échelle / empilées), sans débordement.
 *  B  Même chose dans la planche d'un projet : ajout par le menu « + Ajouter », glisser, gestes, Annuler, publication, parité.
 *  F  Option « Fond » (carte dans la carte) : la composition reste identique, avec et sans fond.
 * Captures : $SHOTS.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=P,G,S,Q,B,F] [SHOTS=dossier] node scripts/e2e-planchelibre42.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";
import sharp from "sharp";

import { boardDraft, boardPublished, draftBlocks, login, openEditor, pageIdOf, q1, setBoardDraft, setDraft, settled, sleep, sql, waitFor } from "./lib/grille31d.mjs";

const BASE = process.env.BASE ?? "http://localhost:3560";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(process.env.BATTERY_DIR ?? tmpdir(), "shots-planchelibre42");
mkdirSync(SHOTS, { recursive: true });
sharp.cache(false);
sharp.concurrency(1);

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);

/* ---- Images : quatre PNG détourés (fond transparent) --------------------------------------------------------------------- */
const svg = (w, h, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`);
const SPECS = {
  "42-fleur.png": svg(900, 1200, '<g><rect x="430" y="520" width="40" height="640" fill="#2f7d32"/><circle cx="450" cy="300" r="120" fill="#e0407a"/><circle cx="450" cy="170" r="110" fill="#f06292"/><circle cx="330" cy="260" r="110" fill="#f06292"/><circle cx="570" cy="260" r="110" fill="#f06292"/><circle cx="450" cy="300" r="70" fill="#ffd54f"/></g>'),
  "42-vase.png": svg(700, 1100, '<path d="M250 40 H450 L430 260 C700 420 640 1000 520 1060 H180 C60 1000 0 420 270 260 Z" fill="#3b6fb6"/><ellipse cx="350" cy="40" rx="100" ry="26" fill="#25497c"/>'),
  "42-etoile.png": svg(1000, 1000, '<polygon points="500,40 620,380 980,380 690,590 800,940 500,730 200,940 310,590 20,380 380,380" fill="#f2b600"/>'),
  "42-feuille.png": svg(1400, 900, '<path d="M60 840 C80 300 600 40 1340 60 C1320 700 800 900 60 840 Z" fill="#43a047"/><path d="M60 840 C400 560 800 340 1260 120" stroke="#1b5e20" stroke-width="14" fill="none"/>'),
};
const mediaOf = (name) => q1("select id, status from media where original_name = ? order by id desc", name);
const ids = {};
for (const [name, body] of Object.entries(SPECS)) {
  if (!mediaOf(name)) {
    const buffer = await sharp(body).png().toBuffer();
    const res = await page.request.post(`${BASE}/admin/api/upload`, { headers: { origin: BASE }, multipart: { file: { name, mimeType: "image/png", buffer } }, timeout: 180000 });
    if (res.status() >= 300) throw new Error(`envoi de ${name} : ${res.status()}`);
  }
  if (!(await waitFor(() => mediaOf(name)?.status === "ready", 180000))) throw new Error(`${name} : ${JSON.stringify(mediaOf(name))}`);
  ids[name.replace(/^42-|\.png$/g, "")] = mediaOf(name).id;
}
const RATIO = { fleur: 900 / 1200, vase: 700 / 1100, etoile: 1, feuille: 1400 / 900 };
const pageId = pageIdOf("personnages");
const project = q1("select id, slug from projects order by id limit 1");
if (!project) throw new Error("aucun projet dans la base de test");

/* ---- Aides ---------------------------------------------------------------------------------------------------------------- */
const section = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 8).join(" "));
    await page.screenshot({ path: path.join(SHOTS, `erreur-${name}.png`) }).catch(() => {});
  }
};
const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});
async function canvasFrame() {
  const handle = await page.waitForSelector("iframe.ve-frame", { timeout: 120000 });
  const fr = await handle.contentFrame();
  await fr.waitForSelector("html[data-edit-mode]", { timeout: 180000 });
  return fr;
}
let f;
async function open() {
  f = await openEditor(page, BASE, pageId);
  await settled(page);
}
const FB = (items = [], extra = {}) => ({ uid: "fb1", type: "free-board", props: { format: "3:2", phone: "scale", items, ...extra } });
const it = (id, media, x, y, w, rot, z, extra = {}) => ({ id, media, x, y, w, rot, z, ...extra });
/** Images de la planche libre `uid` telles que le brouillon les porte (page, ou planche de projet). */
const pageItems = () => draftBlocks(pageId).find((b) => b.uid === "fb1")?.props.items ?? [];
const pageProps = () => draftBlocks(pageId).find((b) => b.uid === "fb1")?.props ?? {};
const boardItems = () => (boardDraft(project.id) ?? []).find((i) => i.uid === "bfb")?.props.items ?? [];
let items = pageItems;
const zone = () => f.locator(".free-board[data-edit-free]").first();
const itemEl = (id) => zone().locator(`:scope > .free-item[data-free-item="${id}"]`);
const zoneBox = () => zone().boundingBox();
const center = async (loc) => {
  const b = await loc.boundingBox();
  if (!b) throw new Error("élément sans boîte");
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
};
const byId = (id) => items().find((i) => i.id === id);
const scrollToZone = async () => {
  await zone().evaluate((el) => el.scrollIntoView({ block: "center" }));
  await sleep(500);
};
/** Glisse l'image `id` de (dx, dy) pixels ; `alt` coupe les repères magnétiques. */
async function dragItem(id, dx, dy, { alt = false, hold = false, fy = 0.5 } = {}) {
  const c0 = await center(itemEl(id));
  const x = c0.x;
  const y = c0.b.y + c0.b.height * fy;
  if (alt) await page.keyboard.down("Alt");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + Math.sign(dx) * 5, y + Math.sign(dy) * 5, { steps: 2 });
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await sleep(150);
  if (hold) return;
  await page.mouse.up();
  if (alt) await page.keyboard.up("Alt");
}
async function dragHandle(testid, dx, dy) {
  const { x, y } = await center(f.getByTestId(testid));
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await sleep(150);
  await page.mouse.up();
}
const click = async (loc) => {
  const { x, y } = await center(loc);
  await page.mouse.move(x, y, { steps: 3 });
  await page.mouse.click(x, y);
};
/** Glisse une vignette de l'onglet Médias jusqu'au point (x, y) de la fenêtre. */
async function dragMedia(mediaId, x, y) {
  await page.getByRole("tab", { name: "Médias" }).click();
  const li = page.locator(`.ve-media li[data-media="${mediaId}"]`);
  const b = await li.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 12, b.y + b.height / 2 + 12, { steps: 3 });
  await page.mouse.move(x, y, { steps: 14 });
  await sleep(400);
  await page.mouse.up();
}
const undo = async () => {
  await page.locator('button[aria-label="Défaire"]').evaluate((b) => b.click());
  await settled(page);
};
const redo = async () => {
  await page.locator('button[aria-label="Rétablir"]').evaluate((b) => b.click());
  await settled(page);
};
/** Point de la fenêtre qui correspond à (px, py) % de la zone. */
const atZone = async (px, py) => {
  const b = await zoneBox();
  return { x: b.x + (b.width * px) / 100, y: b.y + (b.height * py) / 100 };
};
/** Géométrie normalisée des images d'une page (toile ou site en ligne), dans l'ordre du DOM. */
const measure = (root) =>
  root.evaluate(() => {
    const z = document.querySelector(".free-board");
    const zr = z.getBoundingClientRect();
    return {
      zone: { w: zr.width, h: zr.height, r: zr.width / zr.height },
      items: [...z.querySelectorAll(":scope > .free-item")].map((el) => {
        const r = el.getBoundingClientRect();
        return { x: ((r.left - zr.left) / zr.width) * 100, y: ((r.top - zr.top) / zr.height) * 100, w: (r.width / zr.width) * 100, h: (r.height / zr.height) * 100, z: getComputedStyle(el).zIndex, alt: el.querySelector("img")?.getAttribute("alt") };
      }),
    };
  });
async function publicPage(width, height, options = {}) {
  const c = await browser.newContext({ viewport: { width, height }, ...options });
  const p = await c.newPage();
  p.setDefaultTimeout(30000);
  p.on("pageerror", (e) => errors.push(`public : ${e.message}`));
  await p.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
  return p;
}
async function publish() {
  await page.getByRole("button", { name: "Publier", exact: true }).click();
  const done = await waitFor(() => sql((db) => db.prepare("select draft from pages where id = ?").get(pageId)).draft === null && boardDraft(project.id) === null, 120000);
  await sleep(2500);
  return done;
}

try {
  /* ---- P. Palette ---------------------------------------------------------------------------------------------------------- */
  if (run("P")) {
    await section("P", async () => {
      setDraft(pageId, [{ uid: "t0", type: "rich-text", props: { paragraphs: [{ fr: "Un texte avant.", en: "A text before." }] } }]);
      await open();
      await page.getByRole("tab", { name: "Ajouter" }).click();
      const card = page.locator('.ve-card[data-key="free-board"]');
      ok("P1 « Planche libre » est proposée dans la palette", (await card.count()) === 1 && /Planche libre/.test(await card.innerText()));
      const group = card.locator("xpath=ancestor::*[self::section or self::div][.//h3 or .//h2][1]");
      const groupText = (await page.locator("body").innerText()).replace(/\s+/g, " ").toLowerCase();
      const iMedia = groupText.indexOf("images et vidéos");
      const iGrid = groupText.indexOf("grilles", iMedia);
      const iCard = groupText.indexOf("planche libre", iMedia);
      ok("P2 elle est rangée dans la section « Images et vidéos »", iMedia >= 0 && iCard > iMedia && (iGrid < 0 || iCard < iGrid), `${iMedia} ${iCard} ${iGrid}`);
      void group;
      await shot(page, "P-palette");
      await card.click();
      ok("P3 un clic sur la carte ajoute la rubrique, vide, au format 3:2", await waitFor(() => draftBlocks(pageId).some((b) => b.type === "free-board" && b.props.items?.length === 0 && b.props.format === "3:2")), JSON.stringify(draftBlocks(pageId)));
      await settled(page);
      ok("P4 sur la toile : une zone vide avec « + Image » et l'invitation à glisser", (await zone().count()) === 1 && (await f.locator("[data-edit-free-add]").count()) === 1 && /glisse des images/.test(await zone().innerText()));
    });
  }

  /* ---- G. Gestes sur une page ---------------------------------------------------------------------------------------------- */
  if (run("G")) {
    await section("G", async () => {
      items = pageItems;
      setDraft(pageId, [FB()]);
      await open();
      await scrollToZone();
      // « + Image » au centre d'une zone vide : le sélecteur de la médiathèque.
      await click(f.locator("[data-edit-free-add]"));
      const dlg = page.locator("dialog.ve-picker[open]");
      await dlg.waitFor();
      await dlg.getByRole("button", { name: `Choisir 42-etoile.png` }).click();
      ok("G1 « + Image » : l'image est posée au centre de la zone", await waitFor(() => items().length === 1 && items()[0].media === ids.etoile), JSON.stringify(items()));
      await settled(page);
      const first = items()[0];
      const hGuess = (first.w * 1.5) / RATIO.etoile;
      ok("G1b centre de l'image ≈ centre de la zone (±6 %)", near(first.x + first.w / 2, 50, 6) && near(first.y + hGuess / 2, 50, 12), JSON.stringify(first));
      // Trois images glissées depuis la médiathèque, chacune posée là où on la lâche.
      const targets = [
        ["fleur", 18, 52],
        ["vase", 80, 45],
        ["feuille", 55, 78],
      ];
      for (const [name, px, py] of targets) {
        await scrollToZone();
        const p = await atZone(px, py);
        const before = items().length;
        await dragMedia(ids[name], p.x, p.y);
        ok(`G2 ${name} glissée sur la zone : une image de plus`, await waitFor(() => items().length === before + 1 && items().some((i) => i.media === ids[name])), JSON.stringify(items()));
        await settled(page);
        const added = items().find((i) => i.media === ids[name]);
        const zb = await zoneBox();
        const aw = added.w;
        const ah = (aw * 1.5) / RATIO[name];
        ok(`G2b ${name} : son centre est au point lâché (±3 %)`, near(added.x + aw / 2, px, 3) && near(added.y + ah / 2, py, 3), `${JSON.stringify(added)} visé ${px},${py} zone ${zb.width}x${zb.height}`);
      }
      ok("G2c quatre images, rangs d'empilement 0 à 3", items().length === 4 && JSON.stringify(items().map((i) => i.z).sort()) === "[0,1,2,3]", JSON.stringify(items()));
      const [E, FL, VA, FE] = [ids.etoile, ids.fleur, ids.vase, ids.feuille].map((m) => items().find((i) => i.media === m).id);
      await shot(page, "G-quatre-images");
      // Les gestes suivants visent le centre de chaque image : on les range en colonnes qui ne se recouvrent pas.
      setDraft(pageId, [FB([it(E, ids.etoile, 2, 30, 20, 0, 0), it(FL, ids.fleur, 27, 30, 20, 0, 1), it(VA, ids.vase, 52, 30, 20, 0, 2), it(FE, ids.feuille, 77, 30, 20, 0, 3)])]);
      await open();

      // Déplacer (Alt : sans repères) de (+110 px, +50 px).
      await scrollToZone();
      const zb = await zoneBox();
      const b0 = { ...byId(FL) };
      await dragItem(FL, 110, 50, { alt: true });
      ok("G3 déplacer : la position suit la souris (±0,8 %)", await waitFor(() => !near(byId(FL).x, b0.x, 0.2)), JSON.stringify(byId(FL)));
      await settled(page);
      const m1 = byId(FL);
      ok("G3b dx ≈ 110 px, dy ≈ 50 px (en % de la zone)", near(m1.x - b0.x, (110 / zb.width) * 100, 0.9) && near(m1.y - b0.y, (50 / zb.height) * 100, 0.9), `${m1.x - b0.x} / ${(110 / zb.width) * 100} ; ${m1.y - b0.y} / ${(50 / zb.height) * 100}`);
      ok("G3c l'image déplacée est choisie : cadre, quatre poignées de coin, poignée de rotation, barre", (await f.getByTestId("free-sel").count()) === 1 && (await f.locator("[data-testid^=free-handle-]").count()) === 5 && (await f.getByTestId("free-bar").count()) === 1);
      await shot(page, "G-poignees");
      // Annuler / Rétablir : un geste = un pas.
      await undo();
      ok("G4 Annuler défait le déplacement (un seul pas)", await waitFor(() => near(byId(FL).x, b0.x, 0.05) && near(byId(FL).y, b0.y, 0.05)), JSON.stringify(byId(FL)));
      await redo();
      ok("G4b Rétablir le refait", await waitFor(() => near(byId(FL).x, m1.x, 0.05) && near(byId(FL).y, m1.y, 0.05)), JSON.stringify(byId(FL)));

      // Repères magnétiques : l'étoile (centrée) tirée près du centre de la zone se colle ; un repère s'affiche pendant le geste.
      await scrollToZone();
      const se = byId(E);
      const seH = (se.w * 1.5) / RATIO.etoile;
      const wantDx = (50 - (se.x + se.w / 2) + 0.4) / 100 * zb.width; // centre à 0,4 % (4 px) du centre de la zone
      await dragItem(E, wantDx, 0, { hold: true });
      const guideSeen = (await f.getByTestId("free-guide").count()) > 0;
      await page.mouse.up();
      await settled(page);
      ok("G5 repères : un repère s'affiche pendant le geste", guideSeen);
      ok("G5b … et l'image se colle au centre de la zone (±0,1 %)", await waitFor(() => near(byId(E).x + byId(E).w / 2, 50, 0.15)), JSON.stringify(byId(E)));
      void seH;
      // Alt coupe les repères.
      const e1 = { ...byId(E) };
      const dxAlt = (1 / 100) * zb.width;
      await dragItem(E, dxAlt, 0, { alt: true, fy: 0.04 });
      await settled(page);
      ok("G5c Alt : pas de collage (déplacement libre de 1 %, sans repère)", await waitFor(() => !near(byId(E).x, e1.x, 0.05)) && near(byId(E).x - e1.x, 1, 0.3), `${JSON.stringify(e1)} -> ${JSON.stringify(byId(E))} dx=${dxAlt}`);

      // Redimensionner par le coin sud-est : le coin nord-ouest ne bouge pas, le ratio est conservé.
      await scrollToZone();
      await click(itemEl(VA));
      await f.getByTestId("free-handle-se").waitFor();
      const v0 = { ...byId(VA) };
      const zb2 = await zoneBox();
      const pw = (v0.w / 100) * zb2.width;
      const ph = pw / RATIO.vase;
      const dxr = 70;
      const s = 1 + (dxr * pw) / (pw * pw + ph * ph);
      await dragHandle("free-handle-se", dxr, 0);
      ok("G6 redimensionner : la largeur grandit comme prévu (±0,8 %)", await waitFor(() => !near(byId(VA).w, v0.w, 0.1)), JSON.stringify(byId(VA)));
      await settled(page);
      const v1 = byId(VA);
      ok("G6b largeur ≈ ancienne × s", near(v1.w, v0.w * s, 0.9), `${v1.w} vs ${v0.w * s}`);
      ok("G6c le coin nord-ouest reste en place (±0,3 %)", near(v1.x, v0.x, 0.3) && near(v1.y, v0.y, 0.3), `${JSON.stringify(v0)} → ${JSON.stringify(v1)}`);
      // Poignée nord-ouest : le coin sud-est reste.
      const v1h = (v1.w * 1.5) / RATIO.vase;
      const se0 = { x: v1.x + v1.w, y: v1.y + v1h };
      await dragHandle("free-handle-nw", 20, 20);
      await waitFor(() => !near(byId(VA).w, v1.w, 0.1));
      await settled(page);
      const v2 = byId(VA);
      const v2h = (v2.w * 1.5) / RATIO.vase;
      ok("G6d poignée nord-ouest : le coin sud-est reste en place (±0,4 %)", !near(v2.w, v1.w, 0.1) && near(v2.x + v2.w, se0.x, 0.4) && near(v2.y + v2h, se0.y, 0.4), `${JSON.stringify(v1)} → ${JSON.stringify(v2)}`);

      // Pivoter : poignée tirée à droite du centre = +90° ; maj : pas de 15°.
      await scrollToZone();
      await click(itemEl(FE));
      const feC = await center(itemEl(FE));
      const rotH = await center(f.getByTestId("free-handle-rot"));
      await page.mouse.move(rotH.x, rotH.y);
      await page.mouse.down();
      await page.mouse.move((rotH.x + feC.x - 200) / 2, (rotH.y + feC.y) / 2, { steps: 5 });
      await page.mouse.move(feC.x - 200, feC.y, { steps: 6 });
      await page.mouse.up();
      ok("G7 pivoter : poignée amenée à gauche du centre → −90° (±2°)", await waitFor(() => near(byId(FE).rot, -90, 2)), JSON.stringify(byId(FE)));
      await settled(page);
      // Champ « Rotation » : pas de 1°.
      const rot = f.getByTestId("free-rotation");
      await rot.fill("-37");
      await rot.press("Enter");
      ok("G7b champ Rotation : −37° exactement", await waitFor(() => byId(FE).rot === -37), JSON.stringify(byId(FE)));
      await settled(page);
      await rot.fill("500");
      await rot.press("Enter");
      ok("G7c champ Rotation : borné à 180°", await waitFor(() => byId(FE).rot === 180), JSON.stringify(byId(FE)));
      await settled(page);
      await rot.fill("12");
      await rot.press("Enter");
      await settled(page);

      // Devant / derrière.
      await click(itemEl(FE));
      const zOf = (id) => byId(id).z;
      await f.getByTestId("free-front").click();
      ok("G8 « Devant » : l'image passe au dernier rang", await waitFor(() => zOf(FE) === 3), JSON.stringify(items().map((i) => [i.id, i.z])));
      await settled(page);
      await f.getByTestId("free-back").click();
      ok("G8b « Derrière » : elle passe au premier rang, les autres montent d'un cran, sans trou", await waitFor(() => zOf(FE) === 0 && JSON.stringify(items().map((i) => i.z).sort()) === "[0,1,2,3]"), JSON.stringify(items().map((i) => [i.id, i.z])));
      await settled(page);
      ok("G8c l'ordre se voit : z-index CSS de l'image derrière < celui des autres", await itemEl(FE).evaluate((el) => Number(getComputedStyle(el).zIndex)) < (await itemEl(FL).evaluate((el) => Number(getComputedStyle(el).zIndex))));

      // Clavier : flèches 1 %, Maj 5 %, Suppr.
      await click(itemEl(FL));
      const k0 = { ...byId(FL) };
      await page.keyboard.press("ArrowRight");
      ok("G9 flèche droite : +1 % (x)", await waitFor(() => near(byId(FL).x, k0.x + 1, 0.02)), JSON.stringify(byId(FL)));
      await settled(page);
      await page.keyboard.press("Shift+ArrowDown");
      ok("G9b Maj + flèche bas : +5 % (y)", await waitFor(() => near(byId(FL).y, k0.y + 5, 0.02)), JSON.stringify(byId(FL)));
      await settled(page);
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("ArrowLeft");
      ok("G9c deux flèches gauche rapprochées : −2 % au total", await waitFor(() => near(byId(FL).x, k0.x - 1, 0.02)), JSON.stringify(byId(FL)));
      await settled(page);
      await page.keyboard.press("Delete");
      ok("G9d Suppr : l'image est retirée, les rangs restent compacts", await waitFor(() => items().length === 3 && !byId(FL) && JSON.stringify(items().map((i) => i.z).sort()) === "[0,1,2]"), JSON.stringify(items()));
      await settled(page);
      await undo();
      ok("G9e Annuler rend l'image retirée", await waitFor(() => items().length === 4 && Boolean(byId(FL))));
    });
  }

  /* ---- S. Barre de l'image, hauteur, réglages ------------------------------------------------------------------------------ */
  if (run("S")) {
    await section("S", async () => {
      items = pageItems;
      setDraft(pageId, [FB([it("a1", ids.fleur, 12, 18, 24, 0, 0), it("a2", ids.vase, 60, 10, 22, 0, 1)])]);
      await open();
      await scrollToZone();
      await click(itemEl("a1"));
      const bar = f.getByTestId("free-bar");
      ok("S1 la barre de l'image : Remplacer, Supprimer, Devant, Derrière, Arrondi, Cadre, Rotation", (await Promise.all(["free-replace", "free-remove", "free-front", "free-back", "free-radius", "free-frame-button", "free-rotation"].map((t) => bar.getByTestId(t).count()))).every((n) => n === 1));
      ok("S1b c'est la barre des images de carrousel (même présentation)", await bar.evaluate((el) => el.classList.contains("pe-slot-tools")));
      await bar.getByTestId("free-radius").selectOption("medium");
      ok("S2 Arrondi « Moyen » : écrit sur cette image seulement", await waitFor(() => byId("a1").radius === "medium" && !byId("a2").radius), JSON.stringify(items()));
      await settled(page);
      ok("S2b … et visible (coins arrondis sur l'image)", (await itemEl("a1").locator(".media-frame").evaluate((i) => getComputedStyle(i).borderRadius)) !== "0px");
      await bar.getByTestId("free-frame-button").click();
      const win = f.getByTestId("free-frame");
      await win.waitFor();
      await win.locator('[data-frame-kind="band"]').click();
      ok("S3 Cadre : activé sur cette image", await waitFor(() => Boolean(byId("a1").frame)), JSON.stringify(byId("a1")));
      await settled(page);
      ok("S3b … la bordure est visible", await itemEl("a1").locator(".media-frame").evaluate((i) => parseFloat(getComputedStyle(i).borderTopWidth) >= 2));
      await page.keyboard.press("Escape");
      await sleep(300);
      // Remplacer : même place, autre média.
      await click(itemEl("a1"));
      const a1 = { ...byId("a1") };
      await f.getByTestId("free-replace").click();
      const dlg = page.locator("dialog.ve-picker[open]");
      await dlg.waitFor();
      await dlg.getByRole("button", { name: "Choisir 42-feuille.png" }).click();
      ok("S4 Remplacer : le média change, la place et la taille restent", await waitFor(() => byId("a1").media === ids.feuille && byId("a1").x === a1.x && byId("a1").w === a1.w), JSON.stringify(byId("a1")));
      await settled(page);
      // Supprimer par la barre.
      await click(itemEl("a2"));
      await f.getByTestId("free-remove").click();
      ok("S5 Supprimer : l'image est retirée", await waitFor(() => items().length === 1 && !byId("a2")), JSON.stringify(items()));
      await settled(page);

      // Hauteur : le bord bas du cadre (lot 113 : recadrage, les images ne bougent pas ; avant, poignée « hauteur libre »).
      const h0 = await zoneBox();
      await click(itemEl("a1"));
      const hh = await center(f.getByTestId("free-crop-s"));
      await page.keyboard.down("Alt"); // sans magnétisme : 120 px exacts (le 16:9 est tout près)
      await page.mouse.move(hh.x, hh.y);
      await page.mouse.down();
      await page.mouse.move(hh.x, hh.y - 50, { steps: 5 });
      await page.mouse.move(hh.x, hh.y - 120, { steps: 5 });
      await page.mouse.up();
      await page.keyboard.up("Alt");
      ok("S6 poignée du bas : le cadre est recadré par le bas (lot 113), le rapport du cadre est le rapport mesuré", await waitFor(() => pageProps().format === "3:2" && pageProps().crop?.b > 5 && near(h0.width / (h0.height * (1 - pageProps().crop.b / 100)), h0.width / (h0.height - 120), 0.03)), JSON.stringify(pageProps()));
      await settled(page);
      const h1 = await zoneBox();
      ok("S6b la zone est plus basse de 120 px (±3)", near(h0.height - h1.height, 120, 3), `${h0.height} → ${h1.height}`);
      await undo();
      ok("S6c Annuler rend le format d'avant", await waitFor(() => pageProps().format === "3:2" && pageProps().aspect === undefined && pageProps().crop === undefined), JSON.stringify(pageProps()));

      // Panneau Réglages : format et téléphone.
      await scrollToZone();
      const side = page;
      for (let attempt = 0; attempt < 3 && !(await side.getByLabel("Format de la zone").count()); attempt++) {
        await click(itemEl("a1"));
        await page.getByRole("tab", { name: "Réglages" }).click();
        await sleep(1200);
      }
      await side.getByLabel("Format de la zone").selectOption("1:1");
      ok("S7 panneau : format Carré", await waitFor(() => pageProps().format === "1:1"), JSON.stringify(pageProps()));
      await side.getByLabel(/Sur téléphone/).selectOption("stack");
      ok("S7b panneau : téléphone « Empilées »", await waitFor(() => pageProps().phone === "stack"), JSON.stringify(pageProps()));
      ok("S7c panneau : la liste des images de la planche", (await side.getByTestId("free-list").locator("li").count()) === 1);
      await side.getByTestId("free-w-0").fill("40");
      ok("S7d panneau : largeur 40 %", await waitFor(() => byId("a1").w === 40), JSON.stringify(byId("a1")));
      await settled(page);
    });
  }

  /* ---- Q. Publication, parité, téléphone ----------------------------------------------------------------------------------- */
  const COMPOSITION = () => [
    it("c1", ids.feuille, 4, 30, 58, -8, 0),
    it("c2", ids.vase, 50, 4, 20, 12, 3),
    it("c3", ids.fleur, 22, 8, 26, 0, 2, { radius: "medium" }),
    it("c4", ids.etoile, 66, 52, 30, 25, 1),
  ];
  if (run("Q")) {
    await section("Q", async () => {
      items = pageItems;
      setDraft(pageId, [{ ...FB(COMPOSITION()), props: { ...FB(COMPOSITION()).props } }]);
      await open();
      await scrollToZone();
      await shot(page, "Q-toile-composition");
      const onCanvas = await measure(f);
      ok("Q0 composition sur la toile : 4 images", onCanvas.items.length === 4);
      ok("Q1 publication", await publish());
      const html = await (await fetch(`${BASE}/fr/personnages`)).text();
      const body = html.replace(/<script[\s\S]*?<\/script>/g, "");
      ok("Q2 site en ligne : zone et images présentes, aucun repère d'édition", body.includes('class="free-board"') && (body.match(/class="free-item"/g) ?? []).length === 4 && !/data-edit-|data-free-item|data-free-ratio|pe-free/.test(body));
      ok("Q2b images servies en variantes (srcset, plusieurs largeurs) avec sizes", /<picture[\s\S]*?srcSet="[^"]+ \d+w, [^"]+ \d+w/i.test(body) || /srcset="[^"]+ \d+w, [^"]+ \d+w/i.test(body), "pas de srcset");
      ok("Q2c position en % posée par variables CSS", /--x:4;--y:30;--w:58;--rot:-8/.test(body.replace(/\s/g, "")) || /--x:4/.test(body));
      for (const [width, height] of [
        [1440, 900],
        [1024, 768],
      ]) {
        const p = await publicPage(width, height);
        const pub = await measure(p);
        ok(`Q3 ${width} px : 4 images`, pub.items.length === 4);
        const good = pub.items.every((m, i) => ["x", "y", "w", "h"].every((k) => near(m[k], onCanvas.items[i][k], 1)));
        ok(`Q3b ${width} px : parité des positions toile / public (±1 %)`, good, JSON.stringify({ pub: pub.items.map((m) => [m.x, m.y, m.w, m.h].map(Math.round)), toile: onCanvas.items.map((m) => [m.x, m.y, m.w, m.h].map(Math.round)) }));
        ok(`Q3c ${width} px : ordre d'empilement identique`, pub.items.every((m, i) => m.z === onCanvas.items[i].z));
        ok(`Q3d ${width} px : rapport de la zone 3:2`, near(pub.zone.r, 1.5, 0.01));
        await shot(p, `Q-public-${width}`);
        if (width === 1440) {
          const alts = await p.evaluate(() => [...document.querySelectorAll(".free-board .free-item img")].map((i) => i.getAttribute("alt")));
          ok("Q4 chaque image a un attribut alt", alts.length === 4 && alts.every((a) => a !== null), JSON.stringify(alts));
          const order = await p.evaluate(() => [...document.querySelectorAll(".free-board .free-item")].map((el) => [el.style.getPropertyValue("--y"), el.style.getPropertyValue("--x")].map(Number)));
          const sorted = order.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
          ok("Q4b ordre du DOM = ordre de lecture (haut → bas, puis gauche → droite)", JSON.stringify(order) === JSON.stringify(sorted), JSON.stringify(order));
        }
        await p.context().close();
      }
      // Téléphone, mode « à l'échelle » (par défaut).
      const ph = await publicPage(390, 844, { hasTouch: true, isMobile: true });
      const scaled = await measure(ph);
      const overflow = await ph.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok("Q5 téléphone, à l'échelle : même composition (±1 %), sans défilement horizontal", scaled.items.every((m, i) => ["x", "y", "w", "h"].every((k) => near(m[k], onCanvas.items[i][k], 1))) && overflow <= 1, `${overflow}`);
      const smallest = Math.min(...(await ph.evaluate(() => [...document.querySelectorAll(".free-board .free-item")].map((el) => el.getBoundingClientRect().width))));
      ok("Q5b … les images restent lisibles (la plus petite ≥ 60 px de large)", smallest >= 60, String(smallest));
      await shot(ph, "Q-tel-echelle");
      await ph.context().close();
      // Téléphone, mode « empilées ».
      setDraft(pageId, [{ ...FB(COMPOSITION(), { phone: "stack" }) }]);
      await open();
      ok("Q6 publication (empilées)", await publish());
      const st = await publicPage(390, 844, { hasTouch: true, isMobile: true });
      const stacked = await st.evaluate(() => {
        const z = document.querySelector(".free-board");
        const zr = z.getBoundingClientRect();
        const els = [...z.querySelectorAll(":scope > .free-item")];
        return {
          position: els.map((e) => getComputedStyle(e).position),
          rects: els.map((e) => { const r = e.getBoundingClientRect(); return { top: r.top, left: r.left, w: r.width, h: r.height }; }),
          zone: { left: zr.left, w: zr.width },
          rot: els.map((e) => getComputedStyle(e).transform),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          order: els.map((e) => [e.style.getPropertyValue("--y"), e.style.getPropertyValue("--x")].map(Number)),
        };
      });
      const tops = stacked.rects.map((r) => r.top);
      ok("Q7 téléphone, empilées : en colonne (statiques, du haut vers le bas), sans rotation", stacked.position.every((p) => p === "relative") && tops.every((t, i) => i === 0 || t > tops[i - 1]) && stacked.rot.every((t) => t === "none"), JSON.stringify(stacked.position) + JSON.stringify(tops));
      ok("Q7b … dans l'ordre de lecture (haut → bas puis gauche → droite)", JSON.stringify(stacked.order) === JSON.stringify(stacked.order.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])), JSON.stringify(stacked.order));
      ok("Q7c … toutes dans la largeur de l'écran, sans défilement horizontal", stacked.rects.every((r) => r.left >= -0.5 && r.left + r.w <= 390.5) && stacked.overflow <= 1, JSON.stringify(stacked.rects));
      await shot(st, "Q-tel-empilees");
      await st.context().close();
      // La toile, elle, ne s'empile jamais (on y compose).
      await settled(page);
      await page.getByRole("button", { name: "Téléphone" }).click().catch(() => {});
      await sleep(1200);
      const phoneCanvas = await measure(await canvasFrame());
      ok("Q8 toile en largeur téléphone : la composition reste à l'échelle (pas d'empilement)", phoneCanvas.items.every((m, i) => near(m.x, onCanvas.items[i].x, 1.5) && near(m.y, onCanvas.items[i].y, 1.5)));
      await shot(page, "Q-toile-telephone");
      await page.getByRole("button", { name: "Ordinateur" }).click().catch(() => {});
    });
  }

  /* ---- B. Dans la planche d'un projet -------------------------------------------------------------------------------------- */
  if (run("B")) {
    await section("B", async () => {
      items = boardItems;
      setDraft(pageId, [{ uid: "pb1", type: "project-board", props: { project: project.slug } }]);
      setBoardDraft(project.id, pageId, []);
      await open();
      // Ajout par le menu « + Ajouter » de la planche.
      const board = f.locator(`[data-edit-board="${project.id}"]`).first();
      await board.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await sleep(400);
      await board.locator("[data-edit-bitem-add]").last().click();
      const entry = f.locator('.pe-bitem-menu [data-bitem-type="free-board"]');
      ok("B1 le menu « + Ajouter » de la planche propose « Planche libre »", (await entry.count()) === 1 && /Planche libre/.test(await entry.innerText()));
      await entry.click();
      ok("B2 la planche libre est ajoutée à la planche du projet", await waitFor(() => (boardDraft(project.id) ?? []).some((i) => i.type === "free-board")), JSON.stringify(boardDraft(project.id)));
      await settled(page);
      // On donne l'uid prévisible au composant pour la suite.
      const layout = boardDraft(project.id);
      const added = layout.find((i) => i.type === "free-board");
      setBoardDraft(project.id, pageId, layout.map((i) => (i === added ? { ...i, uid: "bfb" } : i)));
      await open();
      await zone().evaluate((el) => el.scrollIntoView({ block: "center" }));
      await sleep(500);
      ok("B3 sur la toile : zone vide, « + Image », barre du composant avec « Fond »", (await f.locator("[data-edit-free-add]").count()) === 1 && (await f.locator('[data-edit-bitem="bfb"] [data-edit-bitem-op="fond"]').count()) === 1);
      // Glisser deux images depuis la médiathèque.
      for (const [name, px, py] of [["fleur", 25, 50], ["feuille", 68, 55]]) {
        const p = await atZone(px, py);
        const before = items().length;
        await dragMedia(ids[name], p.x, p.y);
        ok(`B4 ${name} glissée dans la planche libre de la planche`, await waitFor(() => items().length === before + 1 && items().some((i) => i.media === ids[name])), JSON.stringify(items()));
        await settled(page);
        const a = items().find((i) => i.media === ids[name]);
        const ah = (a.w * 1.5) / RATIO[name];
        ok(`B4b ${name} : centre au point lâché (±3 %)`, near(a.x + a.w / 2, px, 3) && near(a.y + ah / 2, py, 3), JSON.stringify(a));
      }
      // Gestes : déplacer, redimensionner, pivoter, devant, annuler.
      const [aId, bId] = [items().find((i) => i.media === ids.fleur).id, items().find((i) => i.media === ids.feuille).id];
      const zb = await zoneBox();
      const b0 = { ...byId(aId) };
      await dragItem(aId, 90, 40, { alt: true });
      ok("B5 déplacer dans une planche", await waitFor(() => near(byId(aId).x - b0.x, (90 / zb.width) * 100, 1) && near(byId(aId).y - b0.y, (40 / zb.height) * 100, 1)), JSON.stringify(byId(aId)));
      await settled(page);
      await undo();
      ok("B5b Annuler (planche) rend la position", await waitFor(() => near(byId(aId).x, b0.x, 0.05)), JSON.stringify(byId(aId)));
      await redo();
      await waitFor(() => !near(byId(aId).x, b0.x, 0.05));
      const w0 = byId(aId).w;
      await click(itemEl(aId));
      await dragHandle("free-handle-se", 60, 0);
      ok("B6 redimensionner dans une planche", await waitFor(() => byId(aId).w > w0 + 1), JSON.stringify(byId(aId)));
      await settled(page);
      await f.getByTestId("free-rotation").fill("20");
      await f.getByTestId("free-rotation").press("Enter");
      ok("B7 pivoter (champ) dans une planche", await waitFor(() => byId(aId).rot === 20), JSON.stringify(byId(aId)));
      await settled(page);
      await click(itemEl(bId));
      await f.getByTestId("free-front").click();
      ok("B8 devant dans une planche", await waitFor(() => byId(bId).z === 1 && byId(aId).z === 0), JSON.stringify(items()));
      await settled(page);
      await shot(page, "B-toile-planche");
      // Publication et parité.
      await waitFor(() => true);
      const onCanvas = await measure(f);
      ok("B9 publication de la planche", await publish());
      ok("B9b suite publiée : la planche libre et ses deux images", (boardPublished(project.id) ?? []).some((i) => i.type === "free-board" && i.props.items.length === 2));
      for (const [width, height] of [
        [1440, 900],
        [1024, 768],
      ]) {
        const p = await publicPage(width, height);
        const pub = await measure(p);
        ok(`B10 ${width} px : parité toile / public dans la planche (±1 %)`, pub.items.length === 2 && pub.items.every((m, i) => ["x", "y", "w", "h"].every((k) => near(m[k], onCanvas.items[i][k], 1))), JSON.stringify({ pub: pub.items.map((m) => [m.x, m.y, m.w, m.h].map(Math.round)), toile: onCanvas.items.map((m) => [m.x, m.y, m.w, m.h].map(Math.round)) }));
        await shot(p, `B-public-${width}`);
        await p.context().close();
      }
      const ph = await publicPage(390, 844, { hasTouch: true, isMobile: true });
      const pm = await measure(ph);
      ok("B11 téléphone (planche, à l'échelle) : même composition, sans débordement", pm.items.every((m, i) => near(m.x, onCanvas.items[i].x, 1) && near(m.y, onCanvas.items[i].y, 1)) && (await ph.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 1);
      await shot(ph, "B-tel");
      await ph.context().close();
    });
  }

  /* ---- F. Fond : carte dans la carte --------------------------------------------------------------------------------------- */
  if (run("F")) {
    await section("F", async () => {
      items = pageItems;
      const withFond = (bg) => ({ ...FB(COMPOSITION()), props: { ...FB(COMPOSITION()).props, surface: { color: "primary12", width: "inset" }, ...(bg ? { background: bg } : {}) } });
      setDraft(pageId, [withFond(null)]);
      setBoardDraft(project.id, pageId, null);
      await open();
      await scrollToZone();
      const sans = await measure(f);
      const fondOf = () => zone().evaluate((z) => getComputedStyle(z.closest(".fond-bloc") ?? z).backgroundColor);
      await shot(page, "F-sans-fond");
      setDraft(pageId, [withFond({ kind: "color", color: "#f3e3c3" })]);
      await open();
      await scrollToZone();
      const avec = await measure(f);
      ok("F1 avec « Fond » : la composition ne bouge pas (±0,5 %)", avec.items.every((m, i) => ["x", "y", "w", "h"].every((k) => near(m[k], sans.items[i][k], 0.5))));
      ok("F2 avec « Fond » : la zone est sur un aplat de couleur", (await fondOf()) !== "rgba(0, 0, 0, 0)");
      await shot(page, "F-avec-fond");
      ok("F3 publication avec fond", await publish());
      const p = await publicPage(1440, 900);
      const pub = await measure(p);
      ok("F4 site en ligne avec fond : parité (±1 %)", pub.items.every((m, i) => ["x", "y", "w", "h"].every((k) => near(m[k], avec.items[i][k], 1))));
      await shot(p, "F-public-fond");
      await p.context().close();
    });
    /* Intégration v0.27 : visionneuse (lot 44), Fond image (lot 41), Titre / Légende / Date (lot 39) sur la planche libre. */
  if (run("I")) {
    await section("I", async () => {
      items = pageItems;
      const L = (t) => ({ fr: t, en: t });
      setDraft(pageId, [FB([it("a1", ids.fleur, 12, 18, 24, 0, 0), it("a2", ids.vase, 60, 10, 22, 0, 1)], { captionTitle: L("Titre de la planche"), caption: L("Légende de la planche"), captionDate: L("2026") })]);
      setBoardDraft(project.id, pageId, null);
      await open();
      await scrollToZone();
      await click(itemEl("a1"));
      const bar = f.getByTestId("free-bar");
      ok("I1 la barre de l'image propose « Fond image »", (await bar.getByTestId("free-imgbg-button").count()) === 1);
      await bar.getByTestId("free-imgbg-button").click();
      const win = f.getByTestId("free-imgbg");
      await win.waitFor();
      await win.getByText("Blanc", { exact: true }).click();
      ok("I2 Fond image « Blanc » : écrit sur cette image seulement", await waitFor(() => byId("a1").bg === "#ffffff" && !byId("a2").bg), JSON.stringify(items()));
      await settled(page);
      ok("I2b … et visible derrière l'image", (await itemEl("a1").locator(".media-frame").evaluate((i) => getComputedStyle(i).backgroundColor)) === "rgb(255, 255, 255)");
      await shot(page, "I-toile-fond-image");
      await page.keyboard.press("Escape");
      ok("I3 Titre / Légende / Date présents sous la planche sur la toile", (await f.locator('.free-board-section [data-cap="title"], .free-board-section [data-cap="legend"], .free-board-section [data-cap="date"]').count()) === 3);
      ok("I4 publication", await publish());
      const p = await publicPage(1440, 900);
      await p.locator(".free-board").evaluate((el) => el.scrollIntoView({ block: "center" }));
      const body = await p.locator(".free-board-section").innerText();
      ok("I5 public : Titre, Légende et Date sous la planche", body.includes("Titre de la planche") && body.includes("Légende de la planche") && body.includes("2026"), body);
      ok("I5b public : une image a son fond (data-img-bg), l'autre non", (await p.locator(".free-item .media-frame[data-img-bg]").count()) === 1);
      ok("I6 public : chaque image est cliquable (visionneuse), aucune vidéo ici", (await p.locator(".free-item[data-viewer-item]").count()) === 2);
      await p.locator(".free-item[data-viewer-item]").first().click();
      await p.locator(".lightbox").waitFor();
      ok("I7 public : un clic ouvre la visionneuse sur l'image", (await p.locator(".lightbox img.lightbox-image").count()) === 1);
      await sleep(600);
      await shot(p, "I-public-visionneuse");
      await p.keyboard.press("ArrowRight");
      await sleep(400);
      ok("I8 flèche : passe à l'autre image de la planche", (await p.locator(".lightbox img.lightbox-image").count()) === 1);
      await p.keyboard.press("Escape");
      ok("I9 Échap ferme la visionneuse", await waitFor(async () => (await p.locator(".lightbox").count()) === 0, 5000));
      await p.context().close();
    });
  }
}
} finally {
  ok("aucune erreur JavaScript dans la page de l'éditeur", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
}
console.log(failures ? `\n${failures} échec(s).` : "\nTout passe.");
process.exit(failures ? 1 : 0);
