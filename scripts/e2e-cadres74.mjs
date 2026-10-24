#!/usr/bin/env node
/**
 * Lot 74 « Bibliothèque de cadres » (chromium, serveur requis, base neuve, une connexion admin). Cadres SYNTHÉTIQUES (jamais ceux d'un kit réel).
 *
 *  R  Avant : une page qui combine bande, cadre du thème, « Aucun » et photo sans choix est capturée (comparée à la fin, au pixel).
 *  L  Page /admin/cadres : entrée « Cadres » sous « Thèmes » ; « Cadre du thème » listé ; import de 2 cadres (PNG à bord transparent
 *     asymétrique, SVG) ; le bord est repéré (haut/droite/bas/gauche) ; renommer, épaisseur, persistance.
 *  A  Rendu : image seule, case de grille, vidéo, deux places d'un carrousel ; la taille ne change pas (la boîte extérieure, ou l'image
 *     elle-même, identique à « Aucun » à ±1 px) ; couleur aux coins ; le choix survit au rechargement et à la publication (public ET toile).
 *  M  Menu « Cadre » de la toile : Aucun · Cadre du thème · Bordure · Cadre perso ; vignettes ; « + Importer un cadre » ; données
 *     `look.frame = { kind: "custom", id }`.
 *  D  Supprimer un cadre utilisé : « utilisé par N images », elles repassent à « Aucun » (publié ET brouillon), rien de cassé.
 *  Z  Après : la page de départ est identique au pixel.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=R,L,…] [SHOTS=dossier] node scripts/e2e-cadres74.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";
import sharp from "sharp";

import { installKitFrameTheme } from "./lib/cadres62.mjs";
import { boardDraft, draftBlocks, login, makeMedia, pageIdOf, q1, setBoardDraft, setDraft, sleep, sql, waitFor } from "./lib/grille31d.mjs";
import { ensureVideos } from "./lib/video36.mjs";

const BASE = process.env.BASE ?? "http://localhost:3960";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(tmpdir(), "e2e-cadres74");
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const info = (label, v) => console.log(`INFO ${label} : ${typeof v === "string" ? v : JSON.stringify(v)}`);

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
page.setDefaultNavigationTimeout(180000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);

const section = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 8).join(" "));
    await page.screenshot({ path: path.join(SHOTS, `erreur-${name}.png`) }).catch(() => {});
  }
};
const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});

const M = await makeMedia(page, BASE);
const V = await ensureVideos(page, BASE);
const PHOTOS = pageIdOf("decors");
const project = q1("select id, slug from projects order by id limit 1");
if (!project) throw new Error("aucun projet dans la base de test");
const img = (uid, mediaId, props = {}) => ({ uid, type: "image", props: { mediaId, width: "wide", ...props } });
const vid = (uid, mediaId, props = {}) => ({ uid, type: "video-single", props: { mediaId, variant: "plain", mode: "loop", ...props } });
const grid = (uid, children, props = {}) => ({ uid, type: "grid", props: { layout: "2", gap: "normal", align: "stretch", ratio: "auto", top: "gap", ...props, children } });
const near = (a, b, d = 1) => Math.abs(a - b) <= d;

/* ---- Cadres synthétiques ------------------------------------------------------------------------------------------------ */
const RED = [200, 30, 30];
const BLUE = [30, 60, 200];
/** PNG 300 × 300, centre transparent, bord plein ASYMÉTRIQUE (haut 40, droite 40, bas 60, gauche 40), coins extérieurs échancrés de 4 px. */
async function framePng(color = RED, bottom = 60) {
  const W = 300;
  const data = Buffer.alloc(W * W * 4);
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++) {
      const edge = y < 40 || x < 40 || x >= W - 40 || y >= W - bottom;
      const notch = (x < 4 || x >= W - 4) && (y < 4 || y >= W - 4);
      if (edge && !notch) data.set([...color, 255], (y * W + x) * 4);
    }
  return sharp(data, { raw: { width: W, height: W, channels: 4 } }).png().toBuffer();
}
/** SVG 300 × 300 : cadre bleu de 30 de large, trou central (evenodd). */
const frameSvg = () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><path fill-rule="evenodd" fill="rgb(30,60,200)" d="M0 0H300V300H0Z M30 30V270H270V30Z"/></svg>');
const library = () => JSON.parse(q1("select value from settings where key = 'frameLibrary'")?.value ?? '{"frames":[]}').frames;

/* ---- Aides de la toile ----------------------------------------------------------------------------------------------------- */
async function canvas() {
  const handle = await page.waitForSelector("iframe.ve-frame", { timeout: 120000 });
  const fr = await handle.contentFrame();
  await fr.waitForSelector("html[data-edit-mode]", { timeout: 180000 });
  return fr;
}
async function openEditor(pageId) {
  await page.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
  const fr = await canvas();
  await sleep(2500);
  return fr;
}
async function settled() {
  await page.waitForFunction(() => !/Enregistrement/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, { timeout: 120000 });
  await sleep(600);
}
async function publish(pageId, blocks, board) {
  setDraft(pageId, blocks);
  if (board) setBoardDraft(project.id, pageId, board);
  await openEditor(pageId);
  await settled();
  await page.getByRole("button", { name: "Publier", exact: true }).click();
  const confirm = page.locator("dialog[open]").getByRole("button", { name: "Mettre en ligne" });
  if (await confirm.waitFor({ timeout: 4000 }).then(() => true, () => false)) await confirm.click();
  const done = await waitFor(() => sql((db) => db.prepare("select draft from pages where id = ?").get(pageId)).draft === null && (!board || boardDraft(project.id) === null), 150000);
  await sleep(2500);
  return { done };
}
const publicPage = async (urlPath, width = 1440) => {
  const c = await browser.newContext({ viewport: { width, height: 900 } });
  const p = await c.newPage();
  p.setDefaultTimeout(30000);
  p.on("pageerror", (e) => errors.push(`public : ${e.message}`));
  await p.goto(`${BASE}${urlPath}`, { waitUntil: "networkidle" });
  await sleep(800);
  return p;
};
/** Boîtes (extérieure et média) de chaque `.media-frame` du document, dans l'ordre. */
const boxes = (doc) =>
  doc.evaluate(() =>
    [...document.querySelectorAll("main .media-frame")].map((el) => {
      const r = el.getBoundingClientRect();
      const m = el.querySelector("img, video")?.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height, img: m ? { w: m.width, h: m.height } : null, drawn: cs.borderImageSource !== "none", frame: el.getAttribute("data-frame"), id: el.getAttribute("data-frame-id") };
    }),
  );
/** Pixel (r, v, b) à (dx, dy) du coin haut-gauche de l'élément `idx`, capture à l'échelle 1. */
async function pixelAt(p, idx, dx, dy) {
  const el = p.locator("main .media-frame").nth(idx);
  await el.scrollIntoViewIfNeeded();
  await sleep(300);
  const b = await el.boundingBox();
  const buf = await p.screenshot({ clip: { x: b.x, y: b.y, width: Math.min(40, b.width), height: Math.min(40, b.height) } });
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (dy * info.width + dx) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
}
const close = (c, ref, tol = 40) => c.every((v, i) => Math.abs(v - ref[i]) <= tol);
const shotsOf = async (p, n) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const el = p.locator("main .media-frame").nth(i);
    await el.scrollIntoViewIfNeeded();
    await sleep(250);
    out.push(await sharp(await el.screenshot()).removeAlpha().raw().toBuffer({ resolveWithObject: true }));
  }
  return out;
};

/* ---- Page de départ (R) : bande, cadre du thème, Aucun, sans choix ------------------------------------------------------- */
const regBlocks = () => [
  img("r1", M.paysage),
  img("r2", M.carre, { look: { frame: { kind: "none" } } }),
  img("r3", M.paysage, { look: { frame: { kind: "theme" } } }),
  img("r4", M.carre, { look: { frame: { kind: "band", width: "epais", color: "primary" } } }),
  img("r5", M.paysage, { look: { frame: { kind: "band", width: "fin" } } }),
  grid("rg", [img("rg1", M.carre, { look: { frame: { kind: "theme" } } }), img("rg2", M.carre, { look: { frame: { kind: "band", width: "moyen" } } })]),
];
let before = null;

await section("K0", async () => {
  const active = q1("select value from settings where key = 'activeThemeId'")?.value;
  const data = active ? q1("select data from themes where id = ?", JSON.parse(active))?.data : null;
  if (data && JSON.parse(data).assets?.kit?.frame) return info("thème avec cadre dessiné déjà en ligne", JSON.parse(active));
  info("thème avec cadre dessiné mis en ligne", await installKitFrameTheme(page, BASE));
});

if (run("R"))
  await section("R", async () => {
    const { done } = await publish(PHOTOS, regBlocks());
    ok("R0 page de départ publiée", done);
    const pub = await publicPage("/fr/decors");
    before = await shotsOf(pub, 7);
    ok("R1 sept boîtes de média capturées avant tout import", before.length === 7);
    await pub.context().close();
  });

/* ============================================================================================================================
 * L. La page « Cadres »
 * ========================================================================================================================== */
let A = null;
let B = null;
if (run("L") || run("A") || run("M") || run("D") || run("Z"))
  await section("L", async () => {
    await page.goto(`${BASE}/admin/cadres`, { waitUntil: "networkidle" });
    const links = await page.locator(".a-nav a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    ok("L1 l'entrée « Cadres » est dans le menu, sous « Thèmes » (après Papiers peints, lot 78)", links.indexOf("/admin/cadres") === links.indexOf("/admin/papiers-peints") + 1 && links.indexOf("/admin/papiers-peints") === links.indexOf("/admin/themes") + 1, JSON.stringify(links));
    ok("L2 la page « Cadres » s'affiche, bibliothèque vide d'import", (await page.getByRole("heading", { name: "Cadres", exact: true }).count()) === 1 && (await page.locator('[data-testid="frame"]').count()) === library().length);
    ok("L3 le cadre du kit apparaît comme « Cadre du thème »", await page.locator('[data-testid="frame-theme"]').isVisible() && /Cadre du thème/.test((await page.locator('[data-testid="frame-theme"]').textContent()) ?? ""));
    if (library().length < 2) {
      await page.setInputFiles('[data-testid="frame-input"]', [
        { name: "Cadre rouge.png", mimeType: "image/png", buffer: await framePng() },
        { name: "Cadre bleu.svg", mimeType: "image/svg+xml", buffer: frameSvg() },
      ]);
      ok("L4 deux cadres importés (PNG et SVG)", await waitFor(() => library().length === 2, 60000) && (await waitFor(async () => (await page.locator('[data-testid="frame"]').count()) === 2, 30000)));
    }
    const lib = library();
    A = lib.find((f) => /rouge/i.test(f.name));
    B = lib.find((f) => /bleu/i.test(f.name));
    ok("L5 les noms viennent des fichiers", Boolean(A && B), JSON.stringify(lib.map((f) => f.name)));
    ok("L6 le bord du PNG est repéré sur les 4 côtés (haut 40, droite 40, bas 60, gauche 40)", JSON.stringify(A?.slice) === "[40,40,60,40]" && A?.detected === true, JSON.stringify(A));
    ok("L7 le bord du SVG est repéré (30 partout)", B?.slice.every((s) => near(s, 30, 2)) && B?.detected === true, JSON.stringify(B));
    ok("L8 mêmes conversions au plus léger : PNG → AVIF + WebP, SVG optimisé", Boolean(A?.image.avif && A?.image.webp && !A?.image.svg && B?.image.svg && !B?.image.webp));
    const cardA = page.locator(`[data-testid="frame"][data-frame-id="${A?.id}"]`);
    await shot(page, "l-bibliotheque");
    // Renommer et épaisseur.
    await cardA.locator('[data-testid="frame-name"]').fill("Cadre rouge asymétrique");
    await cardA.locator('[data-testid="frame-name"]').press("Enter");
    ok("L9 renommer", await waitFor(() => library().find((f) => f.id === A.id)?.name === "Cadre rouge asymétrique", 15000));
    await cardA.locator('[data-testid="frame-thickness"]').fill("30");
    ok("L10 l'épaisseur se règle au curseur et persiste", await waitFor(() => library().find((f) => f.id === A.id)?.thickness === 30, 15000));
    A = library().find((f) => f.id === A.id);
    await page.reload({ waitUntil: "networkidle" });
    ok("L11 rechargement : nom et épaisseur gardés", (await page.locator(`[data-frame-id="${A.id}"] [data-testid="frame-thickness"]`).inputValue()) === "30");
    // Refus lisibles.
    await page.setInputFiles('[data-testid="frame-input"]', [{ name: "piege.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script></svg>') }]);
    await sleep(2500);
    ok("L12 un SVG avec script est refusé, rien n'est ajouté", library().length === 2);
    await page.setInputFiles('[data-testid="frame-input"]', [{ name: "double.png", mimeType: "image/png", buffer: await framePng() }]);
    await sleep(2500);
    ok("L13 le même fichier deux fois n'ajoute rien", library().length === 2);
  });

/* ============================================================================================================================
 * A. Rendu dans tous les conteneurs
 * ========================================================================================================================== */
const FA = () => ({ kind: "custom", id: A.id });
const FB = () => ({ kind: "custom", id: B.id });
const rendBlocks = () => [
  img("a0", M.paysage),
  img("a1", M.paysage, { look: { frame: FA() } }),
  img("a2", M.paysage, { look: { frame: FB() } }),
  grid("ag", [img("ag1", M.carre, { look: { frame: FA() } }), img("ag2", M.carre)]),
  vid("av", V.short, { look: { frame: FA() } }),
  { uid: "apb", type: "project-board", props: { project: project.slug, look: { slotFrame: { "c1-p0": FA(), "c1-p1": FB() } } } },
];
const rendBoard = () => [{ uid: "c1", type: "strip", props: { source: "own", media: [M.paysage, M.carre] } }];

if (run("A"))
  await section("A", async () => {
    const { done } = await publish(PHOTOS, rendBlocks(), rendBoard());
    ok("A0 page publiée avec des cadres perso", done);
    for (const w of [1440, 390]) {
      const pub = await publicPage("/fr/decors", w);
      const b = await boxes(pub);
      info(`A boîtes ${w}`, b.map((x) => [x.frame, Math.round(x.w), Math.round(x.h), x.img && Math.round(x.img.w)]));
      const sizeSame = (x, ref) => near(x.w, ref.w) && near(x.h, ref.h) || (x.img && ref.img && near(x.img.w, ref.img.w) && near(x.img.h, ref.img.h));
      ok(`A1 (${w}) image seule : la taille ne change pas avec un cadre perso (PNG et SVG)`, sizeSame(b[1], b[0]) && sizeSame(b[2], b[0]), JSON.stringify(b.slice(0, 3)));
      ok(`A2 (${w}) case de grille : même taille avec et sans cadre`, sizeSame(b[3], b[4]), JSON.stringify(b.slice(3, 5)));
      ok(`A3 (${w}) tous les cadres perso dessinent une bordure d'image`, [1, 2, 3, 5, 6, 7].every((i) => b[i]?.drawn && b[i].frame === "custom"), JSON.stringify(b.map((x) => [x.frame, x.drawn])));
      ok(`A4 (${w}) carrousel : les deux places sont encadrées `, b[6]?.drawn && b[7]?.drawn, JSON.stringify(b.slice(6)));
      if (w === 1440) {
        // Aux coins : la couleur du cadre à 6 px du coin (épaisseur 30 px pour le rouge, 15 px pour le bleu).
        // Le dessin se décode après le défilement : on relit quelques fois avant de conclure.
        const settle = async (idx, ref) => {
          let c = await pixelAt(pub, idx, 4, 20);
          for (let k = 0; k < 8 && !close(c, ref); k++) {
            await sleep(600);
            c = await pixelAt(pub, idx, 4, 20);
          }
          return c;
        };
        const c1 = await settle(1, RED);
        const c2 = await settle(2, BLUE);
        ok("A5 bord gauche du PNG : la couleur du cadre (rouge)", close(c1, RED), JSON.stringify(c1));
        ok("A6 bord gauche du SVG : la couleur du cadre (bleu)", close(c2, BLUE), JSON.stringify(c2));
        const mid = await pixelAt(pub, 1, 36, 36);
        ok("A7 le PNG n'est pas peint sous la photo : à 36 px du coin (épaisseur 30) on est dans la photo (pas rouge)", !close(mid, RED, 30), JSON.stringify(mid));
        await shot(pub, "a-public-1440");
      }
      if (w === 390) await shot(pub, "a-public-390");
      await pub.context().close();
    }
    // Rechargement de la toile : le choix survit.
    setDraft(PHOTOS, rendBlocks());
    setBoardDraft(project.id, PHOTOS, rendBoard());
    const fr = await openEditor(PHOTOS);
    const c = await boxes(fr);
    ok("A8 toile : mêmes cadres que le public (parité)", [1, 2, 3, 5].every((i) => c[i]?.drawn && c[i].frame === "custom"), JSON.stringify(c.map((x) => [x.frame, x.drawn])));
    ok("A9 le choix est enregistré tel quel (look.frame = { kind: custom, id })", JSON.stringify(draftBlocks(PHOTOS).find((x) => x.uid === "a1").props.look.frame) === JSON.stringify(FA()));
    await page.reload({ waitUntil: "domcontentloaded" });
    const fr2 = await canvas();
    await sleep(2500);
    ok("A10 après rechargement de la toile, le cadre est toujours là", (await boxes(fr2))[1]?.frame === "custom");
    await shot(page, "a-toile");
  });

/* ============================================================================================================================
 * M. Le menu « Cadre » de la toile
 * ========================================================================================================================== */
if (run("M"))
  await section("M", async () => {
    setDraft(PHOTOS, [img("m1", M.paysage), img("m2", M.carre)]);
    const fr = await openEditor(PHOTOS);
    const el = fr.locator('[data-edit-block="m1"] .media-frame').first();
    await el.scrollIntoViewIfNeeded();
    await el.click();
    await sleep(500);
    const dlg = fr.getByRole("dialog", { name: "Cadre de la photo" });
    if (!(await dlg.isVisible().catch(() => false))) await fr.locator('.pe-tools [data-testid="frame-button"]').click();
    await dlg.waitFor({ timeout: 15000 });
    const labels = (await dlg.locator("[data-frame-kind]").allTextContents()).map((t) => t.trim()).join(" · ");
    ok("M1 le menu : Aucun · Cadre du thème · Bordure · Cadre perso", labels === "Aucun · Cadre du thème · Bordure · Cadre perso", labels);
    await dlg.locator('[data-frame-kind="custom"]').click();
    const thumbs = dlg.locator(".fr-thumb");
    await thumbs.first().waitFor({ timeout: 15000 });
    ok("M2 « Cadre perso » montre la bibliothèque en vignettes (les 2 cadres importés)", (await thumbs.count()) === 2, String(await thumbs.count()));
    ok("M3 … avec le bouton « + Importer un cadre »", (await dlg.locator('[data-testid="frame-import"]').textContent())?.includes("+ Importer un cadre") === true);
    ok("M4 choisir « Cadre perso » pose aussitôt le premier cadre", await waitFor(() => draftBlocks(PHOTOS).find((x) => x.uid === "m1")?.props.look?.frame?.kind === "custom", 30000));
    await dlg.locator(`.fr-thumb[data-frame-id="${B.id}"]`).click();
    ok("M5 cliquer une vignette l'applique (look.frame.id)", await waitFor(() => draftBlocks(PHOTOS).find((x) => x.uid === "m1")?.props.look?.frame?.id === B.id, 30000));
    await sleep(800);
    ok("M6 la photo de la toile porte le cadre choisi", (await boxes(fr))[0]?.id === B.id && (await boxes(fr))[0]?.drawn);
    // Import depuis le menu.
    await fr.locator('[data-testid="frame-file"]').setInputFiles({ name: "Cadre vert.png", mimeType: "image/png", buffer: await framePng([30, 160, 60], 40) });
    ok("M7 « + Importer un cadre » : le cadre entre dans la bibliothèque et est appliqué", await waitFor(() => library().length === 3 && draftBlocks(PHOTOS).find((x) => x.uid === "m1")?.props.look?.frame?.id === library()[2]?.id, 60000), JSON.stringify(library().map((f) => f.id)));
    await sleep(800);
    ok("M8 … et la photo le montre aussitôt, sans recharger", (await boxes(fr))[0]?.drawn === true && (await fr.locator(".fr-thumb").count()) === 3);
    await shot(page, "m-menu");
    await dlg.locator('[data-frame-kind="none"]').click();
    ok("M9 « Aucun » retire le cadre", await waitFor(() => draftBlocks(PHOTOS).find((x) => x.uid === "m1")?.props.look?.frame?.kind === "none", 30000));
  });

/* ============================================================================================================================
 * D. Supprimer un cadre utilisé
 * ========================================================================================================================== */
if (run("D"))
  await section("D", async () => {
    const { done } = await publish(PHOTOS, rendBlocks(), rendBoard());
    ok("D0 page publiée avec le cadre rouge utilisé 3 fois (image, case de grille, vidéo) + 1 place de carrousel", done);
    await page.goto(`${BASE}/admin/cadres`, { waitUntil: "networkidle" });
    const card = page.locator(`[data-testid="frame"][data-frame-id="${A.id}"]`);
    const uses = (await card.locator('[data-testid="frame-uses"]').textContent()) ?? "";
    ok("D1 la carte dit « Utilisé par N images »", /Utilisé par [1-9]\d* images?/.test(uses), uses);
    await card.locator('[data-testid="frame-delete"]').click();
    const dlg = page.locator("dialog[open]");
    const text = (await dlg.locator('[data-testid="frame-delete-uses"]').textContent()) ?? "";
    ok("D2 la boîte annonce « utilisé par N images » et « Aucun »", /utilisé par [1-9]\d* images?/.test(text) && /Aucun/.test(text), text);
    await shot(page, "d-confirmation");
    await dlg.getByRole("button", { name: "Supprimer", exact: true }).click();
    ok("D3 le cadre quitte la bibliothèque", await waitFor(() => !library().some((f) => f.id === A.id), 30000));
    const published = sql((db) => db.prepare("select props from blocks where props like '%\"custom\"%' or props like '%\"frame\"%'").all()).map((r) => r.props).join("\n");
    ok("D4 plus aucune image publiée ne pointe vers lui (elles sont à « Aucun »)", !published.includes(A.id));
    const board = JSON.stringify(boardDraft(project.id) ?? "") + JSON.stringify(sql((db) => db.prepare("select layout from projects").all()));
    ok("D5 ni les planches", !board.includes(A.id));
    const pub = await publicPage("/fr/decors");
    const b = await boxes(pub);
    ok("D6 la page publique s'affiche toujours, sans cadre perso rouge ; le cadre bleu reste", b.length >= 7 && b[1].frame === "none" && b[2].frame === "custom" && b[2].drawn, JSON.stringify(b.map((x) => [x.frame])));
    ok("D7 les images sans cadre ont la même taille qu'avant", near(b[1].w, b[0].w) && near(b[1].h, b[0].h), JSON.stringify([b[0], b[1]]));
    await pub.context().close();
    // Le bleu : la même chose, mais sur un brouillon seulement (brouillon de page non publié).
    setDraft(PHOTOS, [img("d1", M.paysage, { look: { frame: FB() } })]);
    await page.goto(`${BASE}/admin/cadres`, { waitUntil: "networkidle" });
    await page.locator(`[data-testid="frame"][data-frame-id="${B.id}"] [data-testid="frame-delete"]`).click();
    await page.locator("dialog[open]").getByRole("button", { name: "Supprimer", exact: true }).click();
    ok("D8 un cadre utilisé seulement par un BROUILLON repasse aussi à « Aucun » (version de brouillon augmentée)", await waitFor(() => draftBlocks(PHOTOS).find((x) => x.uid === "d1")?.props.look?.frame?.kind === "none", 30000));
  });

/* ============================================================================================================================
 * Z. Après : la page de départ est identique au pixel
 * ========================================================================================================================== */
if (run("Z") && run("R"))
  await section("Z", async () => {
    const { done } = await publish(PHOTOS, regBlocks());
    ok("Z0 page de départ republiée", done);
    const pub = await publicPage("/fr/decors");
    const after = await shotsOf(pub, 7);
    ok("Z1 les mêmes boîtes", after.length === before.length);
    for (let i = 0; i < before.length; i++) {
      const same = before[i].info.width === after[i].info.width && before[i].info.height === after[i].info.height && Buffer.compare(before[i].data, after[i].data) === 0;
      ok(`Z2 (${i}) pixel pour pixel identique à avant la bibliothèque (bande, cadre du thème, Aucun, sans choix)`, same);
    }
    await pub.context().close();
  });

ok("aucune erreur JS de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} ÉCHEC(S)` : "\nTOUT PASSE");
process.exit(failures ? 1 : 0);
