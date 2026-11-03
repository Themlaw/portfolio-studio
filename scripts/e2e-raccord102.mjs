#!/usr/bin/env node
/**
 * Lot 102 : raccord de deux fonds en papier peint collés dans une planche de projet, et fond qui englobe TOUT son contenu, cadres compris
 * (chromium, serveur requis, base neuve, une connexion admin). Données SYNTHÉTIQUES : motif de tartan et images générés ici, textes inventés.
 *
 * Cas de l'artiste (anonymisé) : bande, puis grille A (3 images, légendes, papier jaune, espace bas « Aucun »), puis grille B juste dessous
 * (« Sur mesure » 2 colonnes, cadres « bande » moyens, espace haut « Aucun », papier bleu nuit d'une autre opacité), puis grille C.
 *
 *  G  Géométrie : pour chaque fond de la planche, son bord haut / bas / gauche / droit englobe les cadres, les cases et les légendes de son contenu.
 *  J  Jonction : le bas du fond A touche le haut du fond B (aucun écart, aucun chevauchement) ; même couleur de fond qu'attendu.
 *  P  Pixels : sur une bande de quelques pixels autour de la jonction (gouttière, et au-dessus du premier cadre), aucune couleur étrangère
 *     (ni fond de page, ni papier de l'autre bloc).
 *  M  Motif : deux fonds collés qui montrent le même motif à la même taille poursuivent la trame (même ancrage), teintes et opacités gardées.
 *  I  Identité : la toile de l'éditeur et le site public ont la même géométrie (marges du fond autour du contenu, jonction) à 1440 et 1024 px.
 *  V  Variantes : cadres (thème, bande fine / moyenne / épaisse), ordre inversé, avec ou sans arrondi / légendes, papier « dessus », fond de couleur,
 *     espace bas « Aucun » sous des cadres. Parité : sans espace « Aucun », rien ne change (marge du fond autour du contenu inchangée).
 * Trois largeurs (1440, 1024, 390) et trois thèmes pour le cas de l'artiste.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=G,J,P,M,I,V] [KIT_THEMES=carnet] [SHOTS=dossier] node scripts/e2e-raccord102.mjs
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";
import sharp from "sharp";

import { paint } from "./lib/crop-fixtures.mjs";
import { activateThemeUi } from "./lib/theme-live.mjs";
import { installPaperTheme, PAPER_THEME_NAME } from "./lib/paper-theme.mjs";
import { autoOpenFine } from "./lib/zone66.mjs";
import { boardPublished, canvas, login, pageIdOf, q1, setBoardDraft, setDraft, sleep, waitFor } from "./lib/grille31d.mjs";

const BASE = process.env.BASE ?? "http://localhost:3560";
const DATA = process.env.DATA_DIR ?? "data";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? (process.env.DATA_DIR ? path.join(process.env.DATA_DIR, "..", "shots-raccord102") : path.join(tmpdir(), "e2e-raccord102"));
mkdirSync(SHOTS, { recursive: true });
sharp.cache(false);
sharp.concurrency(1);

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const TOL = 0.6;
const WIDTHS = [1440, 1024, 390];

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await autoOpenFine(ctx);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);

/* ---- Fixtures synthétiques --------------------------------------------------------------------------------------------------- */
const FIX = mkdtempSync(path.join(tmpdir(), "pf-raccord102-"));
const TARTAN = path.join(FIX, "Tartan test.png");
{
  // Tuile 96 px : bandes horizontales et verticales semi-transparentes (motif bien visible, coupure de trame visible).
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="none"/>' +
    '<rect x="0" y="0" width="96" height="14" fill="#000" fill-opacity="0.55"/><rect x="0" y="0" width="14" height="96" fill="#fff" fill-opacity="0.6"/>' +
    '<rect x="0" y="40" width="96" height="4" fill="#fff" fill-opacity="0.8"/><rect x="40" y="0" width="4" height="96" fill="#000" fill-opacity="0.8"/></svg>';
  await sharp(Buffer.from(svg)).png().toFile(TARTAN);
}
await page.goto(`${BASE}/admin/papiers-peints`, { waitUntil: "networkidle" });
await page.locator('[data-testid="wallpaper-input"]').setInputFiles([TARTAN]);
await waitFor(async () => (await page.locator('[data-testid="wallpaper"][data-status="ready"]').count()) === 1, 120000);
const WP = q1("select id from wallpapers order by id desc")?.id;
if (!WP) throw new Error("motif de test non importé");

const upload = async (name, buffer) => (await page.request.post(`${BASE}/admin/api/upload`, { headers: { origin: BASE }, multipart: { file: { name, mimeType: "image/png", buffer } }, timeout: 180000 })).status();
const mediaOf = (name) => q1("select id, status from media where original_name = ? order by id desc", name);
const IMGS = {};
for (const [name, w, h, seed] of [["102-paysage.png", 1500, 1000, 1], ["102-portrait.png", 1000, 1500, 2], ["102-carre.png", 1200, 1200, 3]]) {
  if (!mediaOf(name)) await upload(name, await paint(w, h, seed));
  await waitFor(() => mediaOf(name)?.status === "ready", 180000);
  IMGS[name] = mediaOf(name).id;
}
const [M1, M2, M3] = [IMGS["102-paysage.png"], IMGS["102-portrait.png"], IMGS["102-carre.png"]];
const PROJECT = q1("select id, slug from projects order by position limit 1");
const PAGE = pageIdOf("personnages");
const PUBLIC = `${BASE}/fr/personnages`;

/* ---- Données du cas (anonymisé) ---------------------------------------------------------------------------------------------- */
const TITLES = ["Etude de lumiere sur la dune au petit matin", "Croquis de la jetee sous une pluie fine, vue", "Portrait d'un phare entre deux averses d'ete"];
const loc = (t) => ({ fr: t, en: t });
const kid = (uid, mediaId, i, look, captions = true) => ({
  uid,
  type: "image",
  props: { mediaId, width: "wide", ...(captions ? { captionTitle: loc(TITLES[i % 3]), captionDate: loc(`0${i + 1}/2026`) } : {}), look },
});
const THEME_FRAME = { kind: "theme" };
const band = (width = "moyen", color = "#670049") => ({ kind: "band", color, width });
const wp = (color, opacity, extra = {}) => ({ kind: "wallpaper", wallpaper: WP, color, opacity, paper: "under", ...extra });
const wpNoPaper = (color, opacity) => ({ kind: "wallpaper", wallpaper: WP, color, opacity });

/** Grille A du cas : 3 images, légendes, papier jaune arrondi, espace bas « Aucun ». */
const gridA = (o = {}) => ({
  uid: "ga",
  type: "grid",
  props: {
    layout: "3", gap: "normal", align: "stretch", ratio: "auto", top: "gap",
    look: { spaceBottom: "none", ...(o.look ?? {}) },
    background: o.background ?? wp("#ebeb00", 0.72, { round: "m" }),
    children: [0, 1, 2].map((i) => kid(`ga${i}`, [M1, M2, M3][i], i, { frame: o.frame ?? THEME_FRAME, imageBg: "#f5fbcd" }, o.captions !== false)),
  },
});
/** Grille B du cas : « Sur mesure » 2 colonnes (1 case sur 2 rangées), miroir, cadres bande, espace haut « Aucun », papier bleu nuit. */
const gridB = (o = {}) => ({
  uid: "gb",
  type: "grid",
  props: {
    layout: "custom", cols: 2, spans: [{ w: 1, h: 2 }, { w: 1, h: 1 }, { w: 1, h: 1 }], mirror: true, gap: o.gap ?? "tight", align: "stretch", ratio: "auto", top: "gap",
    look: { ...(o.spaceTop === null ? {} : { spaceTop: o.spaceTop ?? "none" }), ...(o.spaceBottom ? { spaceBottom: o.spaceBottom } : {}), text: { "children.0.props.captionTitle": { color: "#ff005d" }, "children.0.props.captionDate": { color: "#ff005d" } } },
    background: o.background ?? wp("#003f57", 0.21),
    children: [0, 1, 2].map((i) => kid(`gb${i}`, [M2, M1, M3][i], i, { frame: o.frame ?? band() }, o.captions !== false)),
  },
});
const gridC = () => ({
  uid: "gc",
  type: "grid",
  props: { layout: "custom", cols: 2, gap: "normal", align: "stretch", ratio: "auto", top: "gap", children: [0, 1].map((i) => kid(`gc${i}`, [M3, M1][i], i, { frame: band() }, false)) },
});
const STRIP = { uid: "st", type: "strip", props: {} };

/* ---- Mesure ------------------------------------------------------------------------------------------------------------------ */
/** Dans la page (toile ou public) : chaque fond de premier niveau de la planche, son contenu (cadres, cases, légendes) et l'ancrage de son motif. */
const MEASURE = () => {
  const root = document.querySelector('section.strip[aria-labelledby^="project-"]');
  if (!root) return null;
  const y0 = window.scrollY;
  const blocs = [...root.querySelectorAll('.fond-bloc[data-fond="on"]')].filter((e) => !e.parentElement?.closest('.fond-bloc[data-fond="on"]'));
  const box = (r) => ({ top: r.top + y0, bottom: r.bottom + y0, left: r.left, right: r.right });
  const union = (rs) => (rs.length ? { top: Math.min(...rs.map((r) => r.top)), bottom: Math.max(...rs.map((r) => r.bottom)), left: Math.min(...rs.map((r) => r.left)), right: Math.max(...rs.map((r) => r.right)) } : null);
  const visible = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  return blocs.map((el) => {
    const cs = getComputedStyle(el);
    const after = getComputedStyle(el, "::after");
    const frames = [...el.querySelectorAll(".media-frame")].filter(visible).map((e) => box(e.getBoundingClientRect()));
    const cells = [...el.querySelectorAll(".block-grid-cell")].filter(visible).map((e) => box(e.getBoundingClientRect()));
    const caps = [...el.querySelectorAll(".media-caption")].filter((e) => visible(e) && (e.textContent ?? "").trim()).map((e) => box(e.getBoundingClientRect()));
    const tile = Number.parseFloat(cs.getPropertyValue(window.matchMedia("(max-width: 767px)").matches ? "--wp-size-m" : "--wp-size")) * Number.parseFloat(cs.getPropertyValue("--wp-ratio") || "1");
    return {
      uid: `#${blocs.indexOf(el)}`,
      fond: box(el.getBoundingClientRect()),
      frames: union(frames),
      firstFrame: frames[0] ?? null,
      cells: union(cells),
      caps: union(caps),
      wpImg: cs.getPropertyValue("--wp-img").trim().slice(-40),
      wpSize: cs.getPropertyValue("--wp-size").trim(),
      wpY: Number.parseFloat(after.backgroundPositionY) || 0,
      tile: Number.isFinite(tile) ? tile : 0,
      bg: cs.backgroundColor,
      hasWp: el.hasAttribute("data-wallpaper"),
      kids: el.querySelectorAll(".block-grid-cell").length,
    };
  });
};
const r2 = (n) => Math.round(n * 100) / 100;

/** Marges du fond autour de son contenu (négatif = le contenu sort du fond). */
function margins(m) {
  const c = m.frames;
  const out = {};
  if (c) Object.assign(out, { top: r2(c.top - m.fond.top), bottom: r2(m.fond.bottom - c.bottom), left: r2(c.left - m.fond.left), right: r2(m.fond.right - c.right) });
  if (m.caps) out.capBottom = r2(m.fond.bottom - m.caps.bottom);
  return out;
}
function judgeGeometry(ms, label, expectTouch) {
  const bad = [];
  ms.forEach((m, i) => {
    const mg = margins(m);
    for (const k of ["top", "bottom", "left", "right", "capBottom"]) if (mg[k] !== undefined && mg[k] < -TOL) bad.push(`fond ${i} (${m.uid}) : ${k} ${mg[k]} px (le contenu sort du fond)`);
  });
  if (expectTouch) {
    for (let i = 0; i + 1 < ms.length; i++) {
      const gap = r2(ms[i + 1].fond.top - ms[i].fond.bottom);
      if (Math.abs(gap) > TOL) bad.push(`jonction ${i}/${i + 1} : écart ${gap} px`);
    }
  }
  return bad;
}

async function readCanvas(f) {
  const out = {};
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 1000 });
    await sleep(1500);
    out[w] = await f.evaluate(MEASURE);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  return out;
}

const anon = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const pub = await anon.newPage();
pub.on("pageerror", (e) => errors.push(e.message));

async function readPublic(widths = WIDTHS) {
  const out = {};
  await pub.goto(PUBLIC, { waitUntil: "networkidle" });
  for (const w of widths) {
    await pub.setViewportSize({ width: w, height: 1000 });
    await sleep(1200);
    out[w] = await pub.evaluate(MEASURE);
  }
  return out;
}

/** Pose la planche (suite de composants), brouillon puis « Publier » ; rend la toile ouverte. */
async function scene(layout, { editor = true } = {}) {
  setBoardDraft(PROJECT.id, PAGE, layout);
  setDraft(PAGE, [{ uid: "pb1", type: "project-board", props: { project: PROJECT.slug } }]);
  await page.goto(`${BASE}/admin/pages/${PAGE}/editer`, { waitUntil: "domcontentloaded" });
  const f = await canvas(page);
  await sleep(2500);
  const publish = page.getByRole("button", { name: "Publier", exact: true });
  const ed = editor ? await readCanvas(f) : null;
  await publish.waitFor({ timeout: 60000 });
  await publish.click();
  const confirm = page.locator("dialog[open]").getByRole("button", { name: "Mettre en ligne" });
  if (await confirm.waitFor({ timeout: 3000 }).then(() => true, () => false)) await confirm.click();
  const end = Date.now() + 90000;
  while (Date.now() < end && JSON.stringify(boardPublished(PROJECT.id)) !== JSON.stringify(layout)) await sleep(400);
  await sleep(1500);
  return { ed, f };
}

/** Pixels autour de la jonction (site public, 1440 ou 390) : couleurs de la gouttière et au-dessus du premier cadre du bloc du bas. */
async function pixelsAtJunction(ms, tag, w) {
  const [a, b] = ms;
  const J = b.fond.top;
  const x0 = Math.round(Math.max(a.fond.left, b.fond.left)) + 3;
  const grab = async (x, y0, h) => {
    const buf = await pub.screenshot({ clip: { x, y: y0, width: 1, height: h }, fullPage: true });
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    const px = [];
    for (let y = 0; y < info.height; y++) px.push([data[y * info.channels], data[y * info.channels + 1], data[y * info.channels + 2]]);
    return px;
  };
  const dist = (p, q) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);
  const inSet = (p, set) => set.some((q) => dist(p, q) <= 14);
  const bad = [];
  // Gouttière : A au-dessus de J, B au-dessous ; la bande de 6 px autour de J n'a que des couleurs de l'un ou de l'autre selon le côté.
  const col = await grab(x0, Math.round(J) - 160, 320);
  const at = (y) => col[Math.round(y - (Math.round(J) - 160))];
  const setA = [];
  const setB = [];
  for (let y = J - 150; y < J - 8; y++) if (at(y)) setA.push(at(y));
  for (let y = J + 8; y < J + 150; y++) if (at(y)) setB.push(at(y));
  for (let y = Math.floor(J) - 4; y < Math.ceil(J) + 4; y++) {
    if (y + 1 > J && y < J + 1) continue; // ligne à cheval sur la jonction : mélange des deux fonds, légitime
    const p = at(y);
    if (!p) continue;
    if (y < J && !inSet(p, setA)) bad.push(`gouttière y=${y - J} : couleur étrangère ${p.join(",")} au-dessus de la jonction`);
    if (y >= J && !inSet(p, setB)) bad.push(`gouttière y=${y - J} : couleur étrangère ${p.join(",")} sous la jonction`);
  }
  ok(`P [${tag} ${w}px] aucune couleur étrangère autour de la jonction`, bad.length === 0, bad.slice(0, 4).join(" ; "));
}

/** Motif : deux fonds collés, même motif et même taille → la trame se poursuit. */
function judgePattern(ms) {
  const bad = [];
  for (let i = 0; i + 1 < ms.length; i++) {
    const a = ms[i];
    const b = ms[i + 1];
    if (!a.hasWp || !b.hasWp || a.wpImg !== b.wpImg || a.wpSize !== b.wpSize || !a.tile) continue;
    if (Math.abs(b.fond.top - a.fond.bottom) > TOL) continue;
    const oa = a.fond.top + a.wpY;
    const ob = b.fond.top + b.wpY;
    const d = (((ob - oa) % a.tile) + a.tile) % a.tile;
    const gap = Math.min(d, a.tile - d);
    if (gap > TOL) bad.push(`motif ${i}/${i + 1} : trame décalée de ${r2(gap)} px (tuile ${r2(a.tile)} px)`);
  }
  return bad;
}

const shots = async (tag) => {
  await pub.setViewportSize({ width: 1440, height: 1000 });
  await sleep(500);
  const m = await pub.evaluate(MEASURE);
  if (!m?.length) return;
  const top = Math.round(m[0].fond.top) - 30;
  const bottom = Math.round(m.at(-1).fond.bottom) + 30;
  await pub.screenshot({ path: path.join(SHOTS, `${tag}.png`), fullPage: true, clip: { x: 0, y: Math.max(0, top), width: 1440, height: bottom - top } }).catch(() => {});
};

/* ---- Cas de l'artiste, trois thèmes, trois largeurs ---------------------------------------------------------------------------- */
const THEMES = [
  { key: "carnet", label: "Carnet d'atelier", activate: () => activateThemeUi(page, BASE, "carnet-d-atelier") },
  { key: "fanzine", label: "Fanzine riso", activate: () => activateThemeUi(page, BASE, "fanzine-riso") },
  {
    key: "papier",
    label: "Papier de cœurs (papier du site)",
    activate: async () => {
      installPaperTheme(DATA);
      await activateThemeUi(page, BASE, PAPER_THEME_NAME);
    },
  },
];
const KIT = process.env.KIT_THEMES ? THEMES.filter((t) => process.env.KIT_THEMES.split(",").includes(t.key)) : THEMES;
const MAIN = [STRIP, gridA(), gridB(), gridC()];
const measuresByTheme = {};

for (const T of KIT) {
  console.log(`== Thème : ${T.label}`);
  await T.activate();
  const { ed } = await scene(MAIN);
  const pubM = await readPublic();
  measuresByTheme[T.key] = { ed, pubM };
  for (const w of WIDTHS) {
    const ms = pubM[w];
    ok(`G0 [${T.key} ${w}px public] trois fonds en planche (A, B)`, Array.isArray(ms) && ms.length === 2, JSON.stringify(ms?.map((m) => m.uid)));
    if (!ms || ms.length < 2) continue;
    if (run("G")) ok(`G [${T.key} ${w}px public] chaque fond englobe cadres, cases et légendes`, judgeGeometry(ms, T.key, false).length === 0, judgeGeometry(ms, T.key, false).join(" ; "));
    if (run("J")) ok(`J [${T.key} ${w}px public] le fond B touche le fond A (aucun écart)`, judgeGeometry(ms, T.key, true).filter((x) => x.startsWith("jonction")).length === 0, judgeGeometry(ms, T.key, true).filter((x) => x.startsWith("jonction")).join(" ; "));
    if (run("M")) {
      const bad = judgePattern(ms);
      ok(`M [${T.key} ${w}px public] la trame du papier se poursuit d'un fond à l'autre`, bad.length === 0, bad.join(" ; "));
    }
    if (run("P") && w !== 1024) await pixelsAtJunction(ms, `${T.key} public`, w);
    // Intentions gardées : deux teintes, deux opacités, A arrondi (sans marge : coins droits), B sans arrondi.
    if (w === 1440) ok(`K [${T.key}] les deux fonds gardent leur teinte (jaune, bleu nuit)`, ms[0].bg !== ms[1].bg && /235,\s*235,\s*0/.test(ms[0].bg) && /0,\s*63,\s*87/.test(ms[1].bg), `${ms[0].bg} / ${ms[1].bg}`);
  }
  for (const w of WIDTHS) {
    const ms = ed?.[w];
    if (!ms || ms.length < 2) {
      ok(`G0 [${T.key} ${w}px toile] deux fonds`, false, JSON.stringify(ms?.length));
      continue;
    }
    if (run("G")) ok(`G [${T.key} ${w}px toile] chaque fond englobe cadres, cases et légendes`, judgeGeometry(ms, T.key, false).length === 0, judgeGeometry(ms, T.key, false).join(" ; "));
    if (run("J")) ok(`J [${T.key} ${w}px toile] le fond B touche le fond A`, judgeGeometry(ms, T.key, true).filter((x) => x.startsWith("jonction")).length === 0, judgeGeometry(ms, T.key, true).filter((x) => x.startsWith("jonction")).join(" ; "));
    if (run("M")) {
      const bad = judgePattern(ms);
      ok(`M [${T.key} ${w}px toile] la trame se poursuit d'un fond à l'autre`, bad.length === 0, bad.join(" ; "));
    }
  }
  if (run("I"))
    for (const w of [1440, 1024]) {
      const e = ed?.[w];
      const p = pubM[w];
      if (!e || !p || e.length !== p.length) {
        ok(`I [${T.key} ${w}px] toile et public ont les mêmes fonds`, false, `${e?.length} / ${p?.length}`);
        continue;
      }
      const bad = [];
      // Le haut du fond B (espace haut « Aucun » + cadres) et la jonction se lisent pareil sur la toile et en public ; les autres marges dépendent de la
      // largeur de la fenêtre (la toile est plus étroite que l'écran à cause du volet d'édition).
      const eb = margins(e[1]);
      const pb = margins(p[1]);
      if (Math.abs(eb.top - pb.top) > 1.5) bad.push(`haut du fond B : ${eb.top} (toile) ≠ ${pb.top} (public)`);
      const ge = r2(e[1].fond.top - e[0].fond.bottom);
      const gp = r2(p[1].fond.top - p[0].fond.bottom);
      if (Math.abs(ge - gp) > 1.5) bad.push(`jonction ${ge} (toile) ≠ ${gp} (public)`);
      ok(`I [${T.key} ${w}px] la toile et le public ont le même haut de fond B autour de ses cadres et la même jonction`, bad.length === 0, bad.join(" ; "));
    }
  if (T.key === KIT[0].key) await shots(`cas-${T.key}`);
}

/* ---- Variantes (thème du premier de la liste), 1440 et 390 ---------------------------------------------------------------------- */
if (run("V")) {
  await KIT[0].activate();
  const VARIANTS = [
    ["cadre thème", [STRIP, gridA(), gridB({ frame: THEME_FRAME }), gridC()], { touch: true }],
    ["cadre bande fin", [STRIP, gridA(), gridB({ frame: band("fin") }), gridC()], { touch: true }],
    ["cadre bande épais", [STRIP, gridA(), gridB({ frame: band("epais") }), gridC()], { touch: true }],
    ["espace haut automatique (témoin)", [STRIP, gridA(), gridB({ spaceTop: null }), gridC()], { touch: false, parity: true }],
    ["espace haut « Aucun », écart large", [STRIP, gridA(), gridB({ gap: "wide" }), gridC()], { touch: true }],
    ["espace haut « Aucun », sans légendes", [STRIP, gridA({ captions: false }), gridB({ captions: false }), gridC()], { touch: true }],
    ["ordre inversé (B puis A, cadres épais sous A)", [STRIP, gridB({ spaceTop: null, spaceBottom: "none" }), gridA({ look: { spaceTop: "none" }, frame: band("epais") }), gridC()], { touch: true }],
    ["sans arrondi, papier par défaut (sans « sous »)", [STRIP, gridA({ background: wpNoPaper("#ebeb00", 0.72) }), gridB({ background: wpNoPaper("#003f57", 0.21) }), gridC()], { touch: true }],
    ["fond de couleur, sans papier peint", [STRIP, gridA({ background: { kind: "color", color: "#ebeb00" } }), gridB({ background: { kind: "color", color: "#003f57" } }), gridC()], { touch: true }],
    ["B espace bas « Aucun » sous cadres épais, puis C fondée", [STRIP, gridA(), gridB({ frame: band("epais"), spaceBottom: "none" }), { ...gridC(), props: { ...gridC().props, look: { spaceTop: "none" }, background: wp("#7a0030", 0.4) } }], { touch: true }],
  ];
  for (const [name, layout, o] of VARIANTS) {
    console.log(`== Variante : ${name}`);
    const { ed } = await scene(layout);
    const pubM = await readPublic();
    for (const w of WIDTHS) {
      for (const [src, ms] of [["public", pubM[w]], ["toile", ed?.[w]]]) {
        if (!ms || ms.length < 2) {
          ok(`V [${name} ${w}px ${src}] fonds présents`, false, String(ms?.length));
          continue;
        }
        const bad = judgeGeometry(ms, name, o.touch);
        ok(`V [${name} ${w}px ${src}] fonds englobent leur contenu${o.touch ? " et se touchent" : ""}`, bad.length === 0, bad.join(" ; "));
        if (o.touch && src === "public") {
          const pb = judgePattern(ms);
          ok(`V [${name} ${w}px ${src}] trame continue`, pb.length === 0, pb.join(" ; "));
        }
      }
    }
    if (o.parity) {
      // Témoin : espace haut automatique = l'espace du thème au-dessus du cadre, jamais d'écart ni de recouvrement entre les fonds.
      const mg = margins(pubM[1440][1]);
      ok(`V [${name}] parité : le fond B garde son espace du haut (≥ le cadre)`, mg.top >= 6 - TOL, JSON.stringify(mg));
    }
    if (o.touch && pubM[1440]?.length >= 2) await pixelsAtJunction(pubM[1440], name, 1440);
  }
}

ok("Z aucune erreur JavaScript de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures === 0 ? "OK" : `${failures} échec(s)`);
process.exit(failures === 0 ? 0 : 1);
