#!/usr/bin/env node
/**
 * Visuels du tutoriel du kit Photoshop (admin, « Tuto du kit »), générés à
 * partir du VRAI produit : kit v2 rendu par buildKit (cartes, LISEZ-MOI,
 * arborescence des calques), captures playwright de l'admin (Thèmes, écran du
 * kit, revue du fichier réel de l'artiste) et du site (galerie-lumineuse
 * « avant », thème de test kit-a « après »).
 *
 * Sortie : public/admin/tuto/<nom>.avif + .webp (≤ 1600 px de large) et
 * src/app/admin/(espace)/themes/tuto/shots.json (taille de chaque image et
 * boîtes nommées, en px de l'image) : les annotations (cadres, flèches,
 * étiquettes) sont dessinées en SVG PAR-DESSUS l'image par le diaporama,
 * jamais dans l'image ; slides.ts les place par nom de boîte.
 *
 * Prérequis : serveur dev sur :3001 (redémarré, pré-chauffé), thème kit-a
 * (scripts/kit-poc/apply-kit.mts), un compte admin.
 * Usage : DATA_DIR=./data ADMIN_EMAIL=… ADMIN_PASSWORD=… node --import tsx scripts/tuto-shots.mjs
 * À relancer quand le kit, l'admin ou l'écran de revue évoluent.
 * ONLY=kit : seulement les visuels tirés du kit et du site, sans l'admin ni le
 * thème kit-a (vue d'ensemble, LISEZ-MOI, « 8 · Palette », « 9 · Curseur ») ;
 * les autres entrées de shots.json sont gardées. Thème de démonstration
 * temporaire (action repeinte, curseurs dessinés), supprimé à la fin.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { readPsd } from "ag-psd";
import { chromium } from "playwright";
import sharp from "sharp";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const { buildKit } = await import(new URL("../src/lib/kit/build.ts", import.meta.url));
const { ensureAgPsd } = await import(new URL("../src/lib/kit/ag-psd-node.ts", import.meta.url));
const { BOARD, DOC, element, frameOf, README_FRAME, SLOTS, zonesWidth } = await import(new URL("../src/lib/kit/spec.ts", import.meta.url));
const { kitSiteName } = await import(new URL("../src/lib/kit/export-job.ts", import.meta.url));
const { PRESETS } = await import(new URL("../src/themes/presets/index.ts", import.meta.url));

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
const ONLY_KIT = process.env.ONLY === "kit";
if (!ONLY_KIT && (!EMAIL || !PASSWORD)) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const OUT = path.join(root, "public/admin/tuto");
const MANIFEST = path.join(root, "src/app/admin/(espace)/themes/tuto/shots.json");
const TMP = path.join(tmpdir(), "tuto-shots");
const MAX_W = 1600;
mkdirSync(OUT, { recursive: true });
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

/** Boîte [x, y, l, h] en px d'image. */
const box = (x, y, w, h) => [Math.round(x), Math.round(y), Math.round(w), Math.round(h)];
const shots = {};

/** Enregistre une image (Buffer PNG ou sharp) : ≤ 1600 px, AVIF + WebP ; boîtes mises à l'échelle. */
async function save(name, input, boxes = {}) {
  const meta = await sharp(input).metadata();
  const scale = Math.min(1, MAX_W / meta.width);
  const w = Math.round(meta.width * scale);
  const h = Math.round(meta.height * scale);
  const img = sharp(input).resize(w, h).flatten({ background: "#ffffff" });
  await img.clone().avif({ quality: 52, effort: 6 }).toFile(path.join(OUT, `${name}.avif`));
  await img.clone().webp({ quality: 74, effort: 5 }).toFile(path.join(OUT, `${name}.webp`));
  shots[name] = { w, h, boxes: Object.fromEntries(Object.entries(boxes).map(([k, b]) => [k, b.map((v) => Math.round(v * scale))])) };
  console.log(`${name} : ${w} × ${h}, AVIF ${Math.round(statSync(path.join(OUT, `${name}.avif`)).size / 1024)} Ko`);
}

/** Assemble des morceaux (PNG) sur une toile blanche ; renvoie le PNG et la position de chacun. */
async function compose(width, height, parts, background = "#ffffff") {
  const { data, info } = await sharp({ create: { width, height, channels: 3, background } })
    .composite(parts.map((p) => ({ input: p.input, left: Math.round(p.left), top: Math.round(p.top) })))
    .png()
    .toBuffer({ resolveWithObject: true });
  void info;
  return data;
}
const fit = async (input, w, h) => {
  const out = await sharp(input).resize({ width: w, height: h, fit: "inside" }).png().toBuffer({ resolveWithObject: true });
  return { input: out.data, w: out.info.width, h: out.info.height };
};

/* ==== 1. Le kit v2 (rendu par buildKit, comme l'export) ================== */
ensureAgPsd();
const siteName = kitSiteName();
const compositeFile = path.join(TMP, "composite.png");
const { psd } = await buildKit(PRESETS["galerie-lumineuse"], path.join(root, "public"), { exportId: "k2-000000000000", themeVersion: "tuto", siteName, compositeFile });
const composite = readFileSync(compositeFile);

// Arborescence des calques (telle que Photoshop l'affiche), ligne par ligne.
const back = readPsd(psd, { useImageData: true, skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true });
const lines = [];
const walk = (list, depth) => {
  for (const l of [...(list ?? [])].reverse()) {
    lines.push({ depth, text: `${l.children ? "▾ " : ""}${l.name}${l.protected?.position ? "  🔒" : ""}`, group: Boolean(l.children), name: l.name });
    if (l.children && depth === 0 && l.name !== "_guides") walk(l.children, depth + 1);
  }
};
walk(back.children, 0);
const font = path.join(root, "public/kit/Figtree.ttf");
const LINE = 44;
const treeW = 760;
const treeParts = [];
const textW = [];
for (const [i, l] of lines.entries()) {
  const t = await sharp({ text: { text: `<span foreground="${l.depth ? "#4b5059" : "#1f2226"}">${l.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace("🔒", "(verrouillé)")}</span>`, fontfile: font, font: `Figtree ${l.depth ? 24 : 27}`, rgba: true, dpi: 72 } })
    .png()
    .toBuffer();
  treeParts.push({ input: t, left: 28 + l.depth * 34, top: 26 + i * LINE });
  textW.push(28 + l.depth * 34 + (await sharp(t).metadata()).width + 12);
}
const treeH = 26 * 2 + lines.length * LINE;
const tree = await compose(treeW, treeH, treeParts, "#f4f5f7");
const lineBox = (pred) => {
  const i = lines.findIndex(pred);
  // Boîte au ras du texte : l'étiquette se pose à droite, dans le vide.
  return box(10, 26 + i * LINE - 6, textW[i] - 10, LINE);
};

// Slide 3 : vue d'ensemble + arborescence.
{
  const ov = await fit(composite, 1000, 1000);
  const tr = await fit(tree, 600, 1000);
  const s = ov.w / DOC.width;
  const gap = 40;
  const ty = Math.round((ov.h - tr.h) / 2);
  const ts = tr.h / treeH;
  const img = await compose(ov.w + gap + tr.w, ov.h, [
    { input: ov.input, left: 0, top: 0 },
    { input: tr.input, left: ov.w + gap, top: ty },
  ]);
  const inTree = (b) => box(ov.w + gap + b[0] * ts, ty + b[1] * ts, b[2] * ts, b[3] * ts);
  const groups = lines.filter((l) => l.depth === 0 && /^\d/.test(l.name));
  const firstG = lines.indexOf(groups[0]);
  const lastG = lines.indexOf(groups.at(-1));
  await save("kit-ensemble", img, {
    lisezmoi: box(README_FRAME.x * s, README_FRAME.y * s, README_FRAME.w * s, README_FRAME.h * s),
    paysage: box(0, element("paysage").board.y * s - 16, ov.w, element("paysage").board.h * s + 16),
    arbreLisez: inTree(lineBox((l) => l.name === "LISEZ-MOI")),
    arbreGuides: inTree(lineBox((l) => l.name === "_guides")),
    arbreGroupes: inTree(box(10, 26 + firstG * LINE - 6, Math.max(...textW.slice(firstG, lastG + 1)) - 10, (lastG - firstG + 1) * LINE + 6)),
  });
}

/** Carte d'un élément (titre compris) découpée dans la toile du kit. */
const TITLE_H = 62;
async function cardOf(id) {
  const b = element(id).board;
  const top = b.y - TITLE_H;
  return { input: await sharp(composite).extract({ left: b.x, top, width: b.w, height: b.h + TITLE_H }).png().toBuffer(), board: b, top };
}

// Slide 4 : lire une carte (Signature), zones mesurées sur la mise en page du kit.
{
  const c = await cardOf("signature");
  const el = element("signature");
  const z = frameOf(SLOTS.find((s) => s.id === "signature"), "v2");
  const px = BOARD.pad + zonesWidth(el) + BOARD.gap;
  const py = TITLE_H + BOARD.pad;
  await save("carte-signature", c.input, {
    titre: box(0, 4, 700, TITLE_H - 8),
    zone: box(z.x - c.board.x - 6, z.y - c.top - 6, z.w + 12, z.h + 12),
    phrase: box(px - 10, py - 8, BOARD.panel + 20, 104),
    vignette: box(px - 8, py + 112, 416, 266),
    consignes: box(px + 430, py + 112, BOARD.panel - 430, 300),
  });
}

/* ==== 2. Le site : avant (galerie-lumineuse) et après (kit-a) ============ */
// Mode ONLY=kit : le LISEZ-MOI et les slides « 8 · Palette » / « 9 · Curseur » (voir plus bas).
if (ONLY_KIT) await save("lisezmoi", await sharp(composite).extract({ left: README_FRAME.x - 10, top: README_FRAME.y - 6, width: README_FRAME.w + 20, height: README_FRAME.h + 12 }).png().toBuffer());
const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
const page = await ctx.newPage();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function site(theme, url) {
  await page.goto(`${BASE}/api/theme-preview?id=${theme}&redirect=${encodeURIComponent(url)}&banner=0`, { waitUntil: "networkidle" });
  await sleep(700);
}
const clipOf = async (selector, pad = 24, extra = {}) => {
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  await sleep(300);
  const b = await el.boundingBox();
  return { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.width + 2 * pad, height: b.height + 2 * pad, ...extra };
};
/** Capture d'une zone du site pour les deux thèmes (même cadrage). */
async function beforeAfter(url, clip, zoom = 1, prepare, themes = ["galerie-lumineuse", "kit-a"]) {
  const out = [];
  for (const theme of themes) {
    await site(theme, url);
    if (prepare) await prepare();
    const c = typeof clip === "function" ? await clip() : clip;
    const png = await page.screenshot({ clip: c });
    out.push(zoom === 1 ? png : await sharp(png).resize({ width: Math.round(c.width * zoom), kernel: "lanczos3" }).png().toBuffer());
  }
  return out;
}

/** Slide d'un élément : la carte du kit en haut, le site avant / après dessous. */
async function elementSlide(name, id, pair) {
  const card = await fit((await cardOf(id)).input, 1600, 640);
  const half = 780;
  const a = await fit(pair[0], half, 520);
  const b = await fit(pair[1], half, 520);
  const rowH = Math.max(a.h, b.h);
  const gap = 64;
  const H = card.h + gap + rowH;
  const cardLeft = Math.round((1600 - card.w) / 2);
  const img = await compose(1600, H, [
    { input: card.input, left: cardLeft, top: 0 },
    { input: a.input, left: (half - a.w) / 2, top: card.h + gap },
    { input: b.input, left: 1600 - half + (half - b.w) / 2, top: card.h + gap },
  ]);
  await save(name, img, {
    carte: box(cardLeft, 0, card.w, card.h),
    avant: box((half - a.w) / 2, card.h + gap, a.w, a.h),
    apres: box(1600 - half + (half - b.w) / 2, card.h + gap, b.w, b.h),
  });
}

// Slide 1 : le principe (Thèmes → kit → site).
const themesShot = async () => {
  await page.goto(`${BASE}/admin/themes`, { waitUntil: "networkidle" });
  await sleep(500);
};

/* ==== Lot 4 : « 8 · Palette » et « 9 · Curseur » ========================= */
/**
 * Thème de démonstration (copie de galerie-lumineuse) : action repeinte (son
 * survol, auto, suit), curseurs dessinés (crayon, main ronde : ceux de
 * scripts/kit-poc/simulate-v3-edit.mts) rangés comme par l'import. Le site
 * « avant » est galerie-lumineuse. Playwright ne capture pas la souris : le
 * curseur (PNG servi, ou la flèche du système) est incrusté à la position de
 * la souris, point chaud compris.
 */
async function lot4Slides() {
  const { getDb, schema } = await import(new URL("../src/lib/db/index.ts", import.meta.url));
  const { getStorage } = await import(new URL("../src/lib/storage/index.ts", import.meta.url));
  const P = await import(new URL("../src/themes/palette.ts", import.meta.url));
  const { eq } = await import("drizzle-orm");
  const { createHash } = await import("node:crypto");
  const { Readable } = await import("node:stream");
  const DEMO = "tuto-lot4-demo";
  const svg64 = (inner) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">${inner}</svg>`);
  const PENCIL = `<path d="M6 6 L20 44 L28 36 L52 60 L60 52 L36 28 L44 20 Z" fill="#2b1d3a" stroke="#ffffff" stroke-width="3" stroke-linejoin="round" paint-order="stroke"/>`;
  const HAND = `<circle cx="32" cy="34" r="20" fill="#2b1d3a" stroke="#ffffff" stroke-width="3"/><path d="M28 4 L36 4 L36 30 L28 30 Z" fill="#2b1d3a" stroke="#ffffff" stroke-width="3" stroke-linejoin="round" paint-order="stroke"/>`;
  // Représentation du curseur du système (comme pré-rempli dans le kit).
  const ARROW = `<path d="M4 4 L4 50 L15 39 L22 55 L29 52 L22 36 L37 36 Z" fill="#000000" stroke="#ffffff" stroke-width="3" stroke-linejoin="round" paint-order="stroke"/>`;
  const SYS_HAND = `<path d="M22 8 Q22 3 26.5 3 Q31 3 31 8 L31 26 Q31 22 35.5 22 Q40 22 40 26.5 L40 28 Q40 24 44.5 24 Q49 24 49 28.5 L49 31 Q49 27 52.5 27 Q56 27 56 31 L56 46 Q56 60 42 60 L30 60 Q22 60 17 52 L9 40 Q7 36 10.5 34.5 Q14 33 17 37 L22 43 Z" fill="#000000" stroke="#ffffff" stroke-width="3" stroke-linejoin="round" paint-order="stroke"/>`;
  const storage = getStorage();
  const store = async (buf) => {
    const key = `kit/${createHash("sha256").update(buf).digest("hex").slice(0, 16)}.png`;
    if (!(await storage.stat(key))) await storage.put(key, Readable.from(buf));
    return `/media/${key}`;
  };
  const cursor = async (inner, x, y) => {
    const png2x = await sharp(svg64(inner)).png().toBuffer();
    return { png: await store(await sharp(png2x).resize(32, 32, { kernel: "lanczos3" }).png().toBuffer()), png2x: await store(png2x), x, y };
  };
  const g = PRESETS["galerie-lumineuse"];
  const auto = P.setNuance(g.tokens.color, undefined, "primaryHover", null);
  const color = P.setBase(auto.color, auto.palette, "primary", "#6b2d5c");
  const demo = { ...g, id: DEMO, name: "Démo palette (tuto)", preset: false, tokens: { ...g.tokens, color, palette: auto.palette }, assets: { ...g.assets, kit: { cursors: { default: await cursor(PENCIL, 3, 3), pointer: await cursor(HAND, 16, 3) } } } };
  const db = getDb();
  db.delete(schema.themes).where(eq(schema.themes.id, DEMO)).run();
  db.insert(schema.themes).values({ id: DEMO, name: demo.name, preset: false, data: JSON.stringify(demo) }).run();
  try {
    // 8 · Palette : le bouton du contact et son survol, avant / après.
    const contact = async () => {
      const btn = page.locator("a.btn").last();
      await btn.scrollIntoViewIfNeeded();
      await btn.hover();
      await sleep(400);
      const b = await btn.boundingBox();
      return { x: Math.max(0, b.x - 260), y: Math.max(0, b.y - 230), width: b.width + 520, height: b.height + 290 };
    };
    await elementSlide("el-palette", "palette", await beforeAfter("/fr", contact, 1, undefined, ["galerie-lumineuse", DEMO]));
    // 9 · Curseur : la souris sur une image cliquable d'une planche (« clic ») et sur le fond (normal).
    const overlay = async (png, inner, hx, hy, x, y) => sharp(png).composite([{ input: await sharp(svg64(inner)).resize(32, 32).png().toBuffer(), left: Math.round(x - hx), top: Math.round(y - hy) }]).png().toBuffer();
    const pair = [];
    for (const [theme, normal, click] of [
      ["galerie-lumineuse", [ARROW, 2, 2], [SYS_HAND, 13, 2]],
      [DEMO, [PENCIL, 3, 3], [HAND, 16, 3]],
    ]) {
      await site(theme, "/fr/personnages");
      const frame = page.locator(".strip-frame").first();
      await frame.scrollIntoViewIfNeeded();
      await sleep(300);
      const f = await frame.boundingBox();
      const clip = { x: Math.max(0, f.x - 40), y: Math.max(0, f.y - 60), width: Math.min(f.width + 200, 640), height: Math.min(f.height + 120, 420) };
      const at = { x: f.x + Math.min(f.width, 200) / 2 - clip.x, y: f.y + Math.min(f.height, 200) / 2 - clip.y };
      let png = await page.screenshot({ clip });
      png = await overlay(png, click[0], click[1], click[2], at.x, at.y);
      png = await overlay(png, normal[0], normal[1], normal[2], clip.width - 60, 30);
      pair.push(await sharp(png).resize({ width: clip.width * 2, kernel: "nearest" }).png().toBuffer());
    }
    await elementSlide("el-curseur", "curseur", pair);
  } finally {
    db.delete(schema.themes).where(eq(schema.themes.id, DEMO)).run();
  }
}

if (ONLY_KIT) {
  await lot4Slides();
  await browser.close();
  const previous = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
  writeFileSync(MANIFEST, `${JSON.stringify({ ...previous, ...shots }, null, 1)}\n`);
  console.log(`tuto-shots (ONLY=kit) : ${Object.keys(shots).join(", ")}`);
  rmSync(TMP, { recursive: true, force: true });
  process.exit(0);
}

/* ==== 3. L'admin ========================================================= */
await page.goto(`${BASE}/admin/connexion`, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL);
await page.fill("#password", PASSWORD);
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/admin/connexion"), { timeout: 60000 }), page.click("button[type=submit]")]);
// Le site reprend le thème en ligne (pas d'aperçu en cours).
await page.request.post(`${BASE}/admin/apercu/quitter`, { headers: { origin: BASE } }).catch(() => {});

await themesShot();
const dl = await page.getByRole("button", { name: "Télécharger le kit Photoshop" }).first().boundingBox();
const themesPng = await page.screenshot();
await save("themes", themesPng, { telecharger: box(dl.x - 8, dl.y - 8, dl.width + 16, dl.height + 16) });

{
  const left = await fit(await sharp(themesPng).extract({ left: Math.max(0, Math.round(dl.x - 300)), top: Math.max(0, Math.round(dl.y - 220)), width: 620, height: 400 }).png().toBuffer(), 470, 360);
  const mid = await fit(composite, 470, 360);
  await site("kit-a", "/fr");
  const right = await fit(await page.screenshot(), 470, 360);
  const W = 1600;
  const gap = (W - 3 * 470) / 2;
  const top = 30;
  const img = await compose(W, 420, [
    { input: left.input, left: 0, top },
    { input: mid.input, left: 470 + gap + (470 - mid.w) / 2, top },
    { input: right.input, left: 2 * (470 + gap), top },
  ]);
  await save("principe", img, {
    etape1: box(0, top, 470, left.h),
    etape2: box(470 + gap + (470 - mid.w) / 2, top, mid.w, mid.h),
    etape3: box(2 * (470 + gap), top, 470, right.h),
  });
}

// Slide 12 : le LISEZ-MOI (les règles d'or, dans le kit).
await save("lisezmoi", await sharp(composite).extract({ left: README_FRAME.x - 10, top: README_FRAME.y - 6, width: README_FRAME.w + 20, height: README_FRAME.h + 12 }).png().toBuffer());

/** Boîte d'un élément en coordonnées de la PAGE (capture pleine page). */
const pageBox = (locator) => locator.evaluate((e) => {
  const r = e.getBoundingClientRect();
  return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height };
});

// Slide 13 : renvoyer le kit (écran du kit).
await page.goto(`${BASE}/admin/themes/galerie-lumineuse/kit`, { waitUntil: "networkidle" });
await sleep(500);
const send = await page.locator(".a-kit-drop label").boundingBox();
await save("renvoyer", await page.screenshot({ clip: { x: 0, y: 0, width: 1440, height: Math.min(900, send.y + send.height + 60) } }), { renvoyer: box(send.x - 6, send.y - 6, send.width + 12, send.height + 12) });

// Slides 14–15 : revue du fichier réel de l'artiste (import par l'admin, comme elle le fera).
const manifests = path.join(process.env.DATA_DIR ?? "./data", "cache/kits/manifests");
mkdirSync(manifests, { recursive: true });
if (!existsSync(path.join(manifests, "legacy-galerie-lumineuse-v1.json"))) copyFileSync(path.join(root, "tests/fixtures/kit-galerie-lumineuse-v1.manifest.json"), path.join(manifests, "legacy-galerie-lumineuse-v1.json"));
await page.setInputFiles('[data-testid="kit-file"]', path.join(root, "tests/fixtures/kit-synthetique.psd"));
await page.waitForURL(/\/kit\?import=/, { timeout: 120000 });
await page.locator(".a-kit-card").nth(13).waitFor({ timeout: 180000 });
await page.waitForFunction(() => [...document.querySelectorAll(".a-kit-card img")].every((i) => i.complete));
await sleep(500);
let draftId = "";
{
  const summary = await pageBox(page.locator(".a-kit-summary"));
  const arrow = await pageBox(page.locator('.a-kit-card[data-slot="icones/fleche-droite"]'));
  // Boîtes au ras du contenu désigné (la ligne du résumé, le titre des cartes) : étiquettes à droite, dans le vide.
  const sumText = await page.locator(".a-kit-summary").evaluate((e) => {
    const rs = [...e.children].map((c) => c.getBoundingClientRect());
    const x = Math.min(...rs.map((r) => r.x));
    return { x: x + scrollX, y: Math.min(...rs.map((r) => r.y)) + scrollY, width: Math.max(...rs.map((r) => r.right)) - x, height: Math.max(...rs.map((r) => r.bottom)) - Math.min(...rs.map((r) => r.y)) };
  });
  const arrowTitle = await pageBox(page.locator('.a-kit-card[data-slot="icones/fleche-droite"] h3 span').last());
  const planTitle = await pageBox(page.locator('.a-kit-card[data-slot="hero/plan-3"] h3 span').last());
  const top = summary.y - 40;
  const full = await page.screenshot({ fullPage: true });
  const height = arrow.y + arrow.height + 24 - top;
  const crop = await sharp(full).extract({ left: Math.round(summary.x - 20), top: Math.round(top), width: Math.round(Math.min(1440 - summary.x + 20, 1240)), height: Math.round(height) }).png().toBuffer();
  const ox = summary.x - 20;
  await save("revue", crop, {
    resume: box(sumText.x - ox - 6, sumText.y - top - 4, sumText.width + 12, sumText.height + 8),
    redessinee: box(arrowTitle.x - ox - 30, arrowTitle.y - top - 6, arrowTitle.width + 36, arrowTitle.height + 12),
    inchange: box(planTitle.x - ox - 30, planTitle.y - top - 6, planTitle.width + 36, planTitle.height + 12),
  });
  const panel = await pageBox(page.locator(".a-kit-apply"));
  const apply = await pageBox(page.getByRole("button", { name: "Appliquer au thème" }));
  const mirror = await pageBox(page.locator(".a-kit-mirror-check"));
  const clip = { x: panel.x - 20, y: panel.y - 20, width: panel.width + 40, height: panel.height + 40 };
  await save("appliquer", await page.screenshot({ clip, fullPage: true }), {
    miroir: box(mirror.x - clip.x - 6, mirror.y - clip.y - 6, mirror.width + 12, mirror.height + 12),
    appliquer: box(apply.x - clip.x - 6, apply.y - clip.y - 6, apply.width + 12, apply.height + 12),
  });
  // Application (miroir coché par défaut) : copie brouillon, dont la flèche servira à la slide « Icônes ».
  await Promise.all([page.waitForURL(/\/admin\/themes\/galerie-lumineuse-kit[a-z0-9-]*$/, { timeout: 60000 }), page.getByRole("button", { name: "Appliquer au thème" }).click()]);
  draftId = page.url().split("/").pop();
}

/* ==== 4. Le site, éléments par éléments : avant / après ================== */

await elementSlide("el-paysage", "paysage", await beforeAfter("/fr", { x: 0, y: 0, width: 1440, height: 900 }));
await elementSlide("el-signature", "signature", await beforeAfter("/fr/personnages", () => clipOf(".site-brand", 28), 2));
await elementSlide("el-papier", "papier", await beforeAfter("/fr/personnages", { x: 0, y: 70, width: 1440, height: 520 }));
// Cadre : entrées des collections de l'accueil (lot médias : plus sur la visionneuse).
await elementSlide("el-cadre", "cadre", await beforeAfter("/fr", () => clipOf(".tile-media", 40)));
await elementSlide(
  "el-trait",
  "trait",
  await beforeAfter(
    "/fr/personnages",
    async () => {
      // La barre sous la planche (début de piste et poignée), agrandie : pas les légendes.
      const c = await clipOf(".rail-bar", 0);
      return { x: c.x - 16, y: c.y - 18, width: 640, height: c.height + 36 };
    },
    2,
  ),
);
// « Après » des icônes : la VRAIE flèche de l'artiste (fichier réel), appliquée avec son miroir.
await elementSlide(
  "el-icones",
  "icones",
  await beforeAfter(
    "/fr/personnages",
    async () => {
      // Lot médias : flèches sur les bords de la bande (.strip-nav), montrées au
      // survol ; la flèche « suivante » d'une bande qui déborde.
      const vp = page.locator(".strip-viewport[data-overflows='true']").first();
      await vp.scrollIntoViewIfNeeded();
      await vp.hover();
      await sleep(700);
      const b = await vp.locator(".strip-nav-next").boundingBox();
      return { x: b.x - 30, y: b.y - 24, width: b.width + 60, height: b.height + 48 };
    },
    4,
    undefined,
    ["galerie-lumineuse", draftId],
  ),
);
await elementSlide("el-scotch", "scotch", await beforeAfter("/fr/personnages", () => clipOf(".strip-frame", 30, {}), 1));
await lot4Slides();



await browser.close();
// La copie brouillon n'a servi qu'aux captures : supprimée.
{
  const { getDb, schema } = await import(new URL("../src/lib/db/index.ts", import.meta.url));
  const { eq } = await import("drizzle-orm");
  getDb().delete(schema.themes).where(eq(schema.themes.id, draftId)).run();
}
writeFileSync(MANIFEST, `${JSON.stringify(shots, null, 1)}\n`);
let total = 0;
for (const n of Object.keys(shots)) total += statSync(path.join(OUT, `${n}.avif`)).size;
console.log(`tuto-shots : ${Object.keys(shots).length} images, AVIF ${Math.round(total / 1024)} Ko au total`);
rmSync(TMP, { recursive: true, force: true });
