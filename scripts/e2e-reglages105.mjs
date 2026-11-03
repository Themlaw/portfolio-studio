#!/usr/bin/env node
/**
 * Réglages (lot 105) : régressions de « Fond & carte », sélecteur de position de l'ouverture, entrées des collections.
 * UN chromium, serveur requis, base NEUVE, une connexion admin. Données SYNTHÉTIQUES (motif, image et textes inventés). Aucune attente fixe : des conditions.
 *   H : ouverture, 6 positions (gauche / centre / droite, haut / milieu / bas), 3 variantes (parallax, projecteur, texte seul), éditeur ET public ;
 *   M : matrice type de bloc × (Fond seul, Carte seule, les deux) : coins, contour, marge présents et sans effet nul, jamais verrouillés, éditeur = public, rechargement ;
 *   K : la Carte partout : cellule de grille, composant imbriqué, composant de planche (couleur, papier, coins, contour, marge), compat. v0.33 ;
 *   T : entrées des collections : chaque réglage présent, effectif, durable (rechargement, publication) ;
 *   P : parité des anciennes données (empreinte).
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=H,M,K,T,P] node scripts/e2e-reglages105.mjs
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

import Database from "better-sqlite3";
import { chromium } from "playwright";
import sharp from "sharp";

import { paint } from "./lib/crop-fixtures.mjs";
import { login, q1, waitFor } from "./lib/medias-setup.mjs";
import { publishBlocks } from "./lib/page-draft.mjs";
import { activateThemeUi } from "./lib/theme-live.mjs";

const BASE = process.env.BASE ?? "http://localhost:4400";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const DATA = process.env.DATA_DIR ?? "data";
const SHOTS = process.env.SHOTS ?? path.join(DATA, "..", "shots-reglages105");
const DB = path.join(DATA, "portfolio.db");
mkdirSync(SHOTS, { recursive: true });
sharp.cache(false);
sharp.concurrency(1);

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const sql = (fn) => {
  const db = new Database(DB);
  db.pragma("busy_timeout = 5000");
  try {
    return fn(db);
  } finally {
    db.close();
  }
};
const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log(`# pageerror ${e.message.slice(0, 200)}`));
await login(page, BASE);

const FIX = mkdtempSync(path.join(tmpdir(), "pf-reglages105-"));
await page.request.post(`${BASE}/admin/api/upload`, { headers: { origin: BASE }, multipart: { file: { name: "105-image.png", mimeType: "image/png", buffer: await paint(1200, 800, 3) } }, timeout: 180000 });
await waitFor(() => q1("select status from media where original_name = '105-image.png'")?.status === "ready", 180000);
const IMG = q1("select id from media where original_name = '105-image.png'")?.id;

const PAGES = { accueil: q1("select id from pages where json_extract(slug, '$.fr') = ''")?.id, personnages: q1("select id from pages where json_extract(slug, '$.fr') = 'personnages'")?.id, decors: q1("select id from pages where json_extract(slug, '$.fr') = 'decors'")?.id, animation: q1("select id from pages where json_extract(slug, '$.fr') = 'animation'")?.id, apropos: q1("select id from pages where json_extract(slug, '$.fr') = 'a-propos'")?.id };
const L = (t) => ({ fr: t, en: t });
async function section(name, fn) {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 6).join(" "));
    await page.screenshot({ path: path.join(SHOTS, `erreur-${name}.png`) }).catch(() => {});
  }
}
async function canvas() {
  const handle = await page.waitForSelector("iframe.ve-frame", { timeout: 120000 });
  const fr = await handle.contentFrame();
  await fr.waitForSelector("html[data-edit-mode]", { timeout: 180000 });
  return fr;
}
async function openEditor(pageId) {
  await page.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
  let fr = await canvas();
  if (await page.getByRole("button", { name: "Abandonner les modifications" }).count()) {
    await page.getByRole("button", { name: "Abandonner les modifications" }).click();
    await Promise.all([page.waitForEvent("framenavigated", { predicate: (x) => x === page.mainFrame(), timeout: 60000 }), page.getByRole("dialog").getByRole("button", { name: "Abandonner les modifications" }).click()]);
    fr = await canvas();
  }
  await fr.waitForFunction(() => document.querySelector("[data-edit-block]") !== null, null, { timeout: 60000 });
  return fr;
}
const draftOf = (pageId) => {
  const row = q1("select draft from pages where id = ?", pageId);
  return row?.draft ? JSON.parse(row.draft).blocks : [];
};
const savedBlocks = (pageId) => sql((db) => db.prepare("select type, props from blocks where page_id = ? order by position").all(pageId)).map((b) => ({ type: b.type, props: JSON.parse(b.props) }));
const published = (pageId) => q1("select draft from pages where id = ?", pageId)?.draft === null;
/** Pose des blocs (brouillon écrit comme l'éditeur le lit) puis « Publier » : la publication est celle du produit. */
async function publishWith(pageId, blocks) {
  await page.goto("about:blank");
  const ready = () => published(pageId) && savedBlocks(pageId).length === blocks.length && q1("select draft from pages where id = ?", pageId)?.draft === null;
  const end = Date.now() + 240000;
  while (Date.now() < end) {
    // On réécrit le brouillon à chaque tour : l'éditeur peut en avoir effacé un entre-temps.
    const done = await publishBlocks(page, BASE, pageId, () => blocks, ready, 60000).catch(() => false);
    if (done) return true;
    await page.screenshot({ path: path.join(SHOTS, `publish-${pageId}.png`) }).catch(() => {});
    console.log(`# publishWith ${pageId} : nouvel essai (${await page.locator(".ve-status").first().textContent().catch(() => "?")} / ${await page.getByRole("button", { name: "Publier", exact: true }).isEnabled().catch(() => "?")})`);
  }
  return false;
}
const urlOf = (slug) => `${BASE}/fr${slug ? `/${slug}` : ""}`;

// Un motif de la bibliothèque (papier peint des cas « Papier peint »).
if (run("M") || run("K") || run("P")) {
  await page.goto(`${BASE}/admin/papiers-peints`, { waitUntil: "domcontentloaded" });
  await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><g fill="#e07a9a"><circle cx="60" cy="60" r="26"/><circle cx="180" cy="180" r="26"/></g></svg>')).png().toFile(path.join(FIX, "pois105.png"));
  await page.locator('[data-testid="wallpaper-input"]').setInputFiles([path.join(FIX, "pois105.png")]);
  await waitFor(async () => (await page.locator('[data-testid="wallpaper"][data-status="ready"]').count()) >= 1, 120000);
}

/* Lot 107 : P est jouée AVANT H, M, K, T. Ces sections changent le thème et la largeur de page du site ; l'empreinte de parité se relève sur le site tel qu'il est
   à la création de la base (c'est ce que mesurait ONLY=P), donc la suite complète et la suite isolée donnent la même empreinte (aucune assertion changée). */
/* ============================== P : parité — le rendu PUBLIC des anciennes données ne bouge pas ============================== */
if (run("P")) {
  await section("P", async () => {
    const wp = q1("select id from wallpapers order by id limit 1")?.id;
    const para = (m) => ({ paragraphs: [{ fr: `${m} : un texte inventé, assez long pour que les cartes et les fonds aient du contenu à entourer et à habiller.`, en: m }] });
    const grid = (m) => ({ layout: "2", gap: "normal", align: "stretch", ratio: "auto", top: "gap", title: L(m), children: [{ uid: `${m}a`, type: "image", props: { mediaId: IMG, width: "wide" } }, { uid: `${m}b`, type: "image", props: { mediaId: IMG, width: "wide" } }] });
    // Réglages possibles en v0.33.0 : carte pleine / en retrait (+ coins, bordure, papier), fond bord à bord / à marge (+ coins), papier peint, les deux emboîtés.
    const OLD = [
      ["carte-retrait", { surface: { color: "primary12", width: "inset" } }],
      ["carte-pleine", { surface: { color: "ink", width: "full" } }],
      ["carte-coins", { surface: { color: "surface", width: "inset", corners: "l" } }],
      ["carte-bordure", { surface: { color: "surface", width: "inset", border: { width: "medium" } } }],
      ["fond-plein", { background: { kind: "color", color: "primary" } }],
      ["fond-marge", { background: { kind: "color", color: "primary", inset: "m", round: "m" } }],
      ["fond-papier", { background: { kind: "wallpaper", wallpaper: wp, inset: "l", round: "l" } }],
      ["fond-papier-plein", { background: { kind: "wallpaper", wallpaper: wp } }],
      ["pair", { surface: { color: "surface", width: "full" }, background: { kind: "color", color: "bgDeep", inset: "m", round: "s" } }],
      ["echo", { surface: { color: "surface", width: "inset", corners: "m" }, background: { kind: "color", color: "bgDeep" } }],
      ["rien", {}],
    ];
    const blocks = OLD.flatMap(([name, look], i) => [
      { uid: `p${i}t`, type: "rich-text", props: { ...para(`P${name}`), ...look } },
      ...(i % 3 === 0 ? [{ uid: `p${i}g`, type: "grid", props: { ...grid(`pg${i}`), ...look } }] : []),
    ]);
    const pid = PAGES.animation;
    ok("P0 page d'anciennes données posée", await publishWith(pid, blocks));
    const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const ap = await anon.newPage();
    for (const w of [1440, 768, 390]) {
      await ap.setViewportSize({ width: w, height: 900 });
      await ap.goto(urlOf("animation"), { waitUntil: "domcontentloaded" });
      await ap.waitForFunction((n) => document.querySelectorAll("main p").length >= n, OLD.length, { timeout: 60000 });
      await ap.evaluate(() => document.fonts.ready);
      const fp = await ap.evaluate(() => {
        const out = [];
        for (const e of document.querySelectorAll("main .zone, main [data-fond], main [data-surface], main h1, main h2, main p")) {
          const b = e.getBoundingClientRect();
          const cs = getComputedStyle(e);
          out.push([e.tagName, e.className.toString().slice(0, 60), Math.round(b.left), Math.round(b.top + scrollY), Math.round(b.width), Math.round(b.height), cs.backgroundColor, cs.borderTopWidth, cs.borderTopLeftRadius, cs.paddingTop, cs.paddingLeft, cs.marginTop, cs.marginLeft]);
        }
        return out;
      });
      const sha = createHash("sha256").update(JSON.stringify(fp)).digest("hex");
      console.log(`PARITY105 ${w}px ${fp.length} éléments ${sha}`);
      await ap.screenshot({ path: path.join(SHOTS, `parite-${w}.png`), fullPage: true }).catch(() => {});
      ok(`P1 [${w}px] empreinte géométrique relevée (${fp.length} éléments)`, fp.length > 20);
      // Empreintes relevées sur v0.33.0 (f569ecf) avec ces mêmes données : le rendu public des anciennes données ne bouge pas, au pixel.
      const V033 = { 1440: "1839af06398d3dc0107ad6a5755464970404487041b8a2db67b4aebefdcf6bd0", 768: "ae0ed43402e902baddaa135e928b4bfbae03cac3d887a7adbe5211daf23cfe1c", 390: "41dd64364f10da50fdeb8b1642d982c4c8a388c23dd97d69065a9b50a9b5428e" };
      ok(`P2 [${w}px] identique à v0.33.0 (11 formes de données anciennes : carte pleine / en retrait, coins, bordure, fond, marge, papier peint, les deux emboîtés)`, sha === V033[w], `${sha} ≠ ${V033[w]}`);
    }
    await anon.close();
  });
}

/* ============================== H : l'ouverture ============================== */
const HERO_THEMES = [
  { key: "texte-seul", name: "Carnet d'atelier", variant: "type-only" },
  { key: "projecteur", name: "Salle de projection", variant: "spotlight" },
  { key: "parallax", name: "Fanzine riso", variant: "parallax-layers" },
];
/** Où est le TEXTE de l'ouverture (boîte du texte du titre, pas du conteneur) dans la fenêtre du document. */
const HERO_MEASURE = () => {
  const h = document.querySelector(".hero h1");
  if (!h) return null;
  const r = document.createRange();
  r.selectNodeContents(h);
  const b = r.getBoundingClientRect();
  const hero = document.querySelector(".hero").getBoundingClientRect();
  const shell = document.querySelector(".hero .hero-text, .hero .shell");
  const sr = shell.getBoundingClientRect();
  const cs = getComputedStyle(shell);
  return { rx: ((b.left + b.right) / 2 - sr.left) / sr.width, ry: ((b.top + b.bottom) / 2 - hero.top) / hero.height, shellL: sr.left + parseFloat(cs.paddingLeft), shellR: sr.right - parseFloat(cs.paddingRight), cx: (b.left + b.right) / 2, cy: (b.top + b.bottom) / 2, l: b.left, r: b.right, t: b.top, b: b.bottom, heroT: hero.top, heroB: hero.bottom, vw: document.documentElement.clientWidth };
};
const POS = [["left", "Texte à gauche"], ["center", "Texte centré"], ["right", "Texte à droite"], ["top", "Texte en haut"], ["middle", "Texte au milieu"], ["bottom", "Texte en bas"]];
if (run("H")) {
  await section("H", async () => {
    for (const T of HERO_THEMES) {
      await activateThemeUi(page, BASE, T.name);
      const heroBlock = (look) => ({ uid: "hero1", type: "hero", props: { eyebrow: L("Étiquette inventée"), statement: L("Un énoncé inventé pour l'ouverture"), ...(look ? { look } : {}) } });
      ok(`H0 [${T.key}] ouverture posée`, await publishWith(PAGES.accueil, [heroBlock()]));
      const fr = await openEditor(PAGES.accueil);
      const host = fr.locator('[data-edit-type="hero"]').first();
      await host.waitFor({ timeout: 60000 }).catch(() => console.log("# pas de bloc hero1 ; blocs : " + draftOf(PAGES.accueil).length));
      if (process.env.DEBUG105) console.log("# DOM", (await host.innerHTML().catch(() => "?")).slice(0, 600));
      await host.locator(".hero").first().click({ position: { x: 30, y: 200 }, force: true });
      const bar = fr.locator('.lk-pos[aria-label="Position du texte"]');
      ok(`H1 [${T.key}] la barre de position est là, et dit sur quoi elle agit`, await bar.waitFor({ timeout: 20000 }).then(() => true, () => false));
      // État attendu après chaque clic : on attend que la toile ait rendu la donnée (attributs de l'enveloppe) ET que le bouton soit coché.
      const state = { h: T.variant === "spotlight" ? "center" : "left", v: T.variant === "spotlight" ? "middle" : "bottom" };
      const DEF = { h: state.h, v: state.v };
      const press = async (k) => {
        const label = POS.find((p) => p[0] === k)[1];
        if (["left", "center", "right"].includes(k)) state.h = k;
        else state.v = k;
        const exp = { th: state.h === DEF.h ? null : state.h, tv: state.v === DEF.v ? null : state.v };
        await bar.locator(`button[aria-label="${label}"]`).click();
        await fr.waitForFunction(({ exp, label }) => {
          const e = document.querySelector('[data-edit-type="hero"] .blk');
          const pressed = document.querySelector(`.lk-pos button[aria-label="${label}"]`)?.getAttribute("aria-pressed") === "true";
          return pressed && (e?.dataset.th ?? null) === exp.th && (e?.dataset.tv ?? null) === exp.tv;
        }, { exp, label }, { timeout: 60000 }).catch(() => {});
        const pressedNow = (await bar.locator(`button[aria-label="${label}"]`).getAttribute("aria-pressed")) === "true";
        ok(`H3 [${T.key}] éditeur : « ${label} » est coché après le clic`, pressedNow);
        return fr.evaluate(HERO_MEASURE);
      };
      await press(DEF.h);
      const hx = { left: await press("left"), center: await press("center"), right: await press("right") };
      ok(`H4 [${T.key}] éditeur : gauche < centre < droite (le texte se déplace vraiment)`, hx.left.rx + 0.02 < hx.center.rx && hx.center.rx + 0.02 < hx.right.rx, JSON.stringify([hx.left.rx, hx.center.rx, hx.right.rx].map((v) => +v.toFixed(2))));
      ok(`H5 [${T.key}] éditeur : « gauche » colle au bord gauche du contenu, « droite » au bord droit`, hx.left.l - hx.left.shellL < 60 && hx.right.shellR - hx.right.r < 60, JSON.stringify([hx.left.l, hx.left.shellL, hx.right.r, hx.right.shellR].map(Math.round)));
      await press("center");
      const vy = { top: await press("top"), middle: await press("middle"), bottom: await press("bottom") };
      ok(`H6 [${T.key}] éditeur : haut < milieu < bas (le texte se déplace vraiment)`, vy.top.ry + 0.05 < vy.middle.ry && vy.middle.ry + 0.05 < vy.bottom.ry, JSON.stringify([vy.top.ry, vy.middle.ry, vy.bottom.ry].map((v) => +v.toFixed(2))));
      await press("right");
      const top = await press("top");
      // Public : chaque position écrite se voit sur le site.
      const look = { titleH: "right", titleV: "top" };
      ok(`H7 [${T.key}] position écrite et publiée`, await publishWith(PAGES.accueil, [heroBlock(look)]));
      await page.goto(urlOf(""), { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".hero h1");
      const pubRight = await page.evaluate(HERO_MEASURE);
      ok(`H8 [${T.key}] public : droite + haut se voient (même place que dans l'éditeur)`, pubRight.shellR - pubRight.r < 60 && Math.abs(pubRight.ry - top.ry) < 0.1 && Math.abs(pubRight.rx - top.rx) < 0.1, JSON.stringify([pubRight.ry, top.ry, pubRight.rx, top.rx].map((v) => +v.toFixed(2))));
      ok(`H9 [${T.key}] le bouton coché au rechargement est celui de la donnée`, await (async () => {
        const fr2 = await openEditor(PAGES.accueil);
        await fr2.locator('[data-edit-type="hero"] .hero').first().click({ position: { x: 30, y: 200 }, force: true });
        const b2 = fr2.locator('.lk-pos[aria-label="Position du texte"]');
        await b2.waitFor({ timeout: 20000 });
        return (await b2.locator('button[aria-label="Texte à droite"]').getAttribute("aria-pressed")) === "true" && (await b2.locator('button[aria-label="Texte en haut"]').getAttribute("aria-pressed")) === "true";
      })());
    }
  });
}


/* ============================== Aides : menu « Fond & carte » ============================== */
const until = async (fn, timeout = 60000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
};
const sec = (menu, slot) => menu.locator(`[data-testid="fond-section-${slot}"]`);
const rgb = (hex) => `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`;
/** Zones (carte / fond allumés) qui enveloppent l'élément `target` (sélecteur dans le document), du dehors au dedans, avec leurs mesures. */
const ZONES = ({ target, mode }) => {
  const el = typeof target === "string" ? document.querySelector(target) : null;
  if (!el) return null;
  const vw = document.documentElement.clientWidth;
  const chain = [];
  for (let e = el; e && e.tagName !== "BODY"; e = e.parentElement) if (e.classList.contains("zone") && (e.dataset.surface === "on" || e.dataset.fond === "on")) chain.push(e);
  const zones = chain.reverse().map((e) => {
    const b = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return { cls: e.classList.contains("surface-card") ? "card" : e.hasAttribute("data-fond-panel") ? "panel" : "fond", l: b.left, r: b.right, t: b.top, b: b.bottom, bw: parseFloat(cs.borderTopWidth) || 0, bwL: parseFloat(cs.borderLeftWidth) || 0, radius: parseFloat(cs.borderTopLeftRadius) || 0, bg: cs.backgroundColor, bc: cs.borderTopColor, full: b.left <= 1 && b.right >= vw - 1 };
  });
  return { vw, zones, sw: document.documentElement.scrollWidth };
};
const near = (a, b, tol = 1.5) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= tol;
const MARK = (t) => `M105${t}`;
async function selectByMarker(fr, marker, clickSel = ["section", ".block-grid", "figure", "img", "h2", "p"]) {
  const host = fr.locator("[data-edit-block]").filter({ hasText: marker }).last();
  await host.scrollIntoViewIfNeeded({ timeout: 20000 });
  const button = fr.locator('.pe-tools [data-testid="fond-button"]');
  for (const sel of clickSel) {
    const t = host.locator(sel).first();
    if (!(await t.count())) continue;
    await t.click({ position: { x: 6, y: 6 }, force: true }).catch(() => {});
    if (await button.waitFor({ timeout: 2500 }).then(() => true, () => false)) return host;
  }
  throw new Error(`bloc « ${marker} » : bouton « Fond & carte » introuvable`);
}
async function openMenuOn(fr, locatorOrMarker) {
  if (typeof locatorOrMarker === "string") await selectByMarker(fr, locatorOrMarker);
  await fr.locator('.pe-tools [data-testid="fond-button"]').click();
  const menu = fr.locator('[data-testid="fond-menu"]').first();
  await menu.waitFor({ timeout: 20000 });
  return menu;
}
/** Une section pilotée comme l'artiste. `spec` : kind (none | color | wallpaper), token, corners (none | s | m | l), contour (none | thin | medium | thick), marge (s | m | l). */
async function drive(menu, slot, spec) {
  const box = sec(menu, slot);
  const radio = (testid, attr, v) => box.locator(`[data-testid="${testid}"] [${attr}="${v}"]`);
  if (spec.kind && spec.kind !== "none") {
    if ((await box.getAttribute("data-kind-now")) !== spec.kind) await box.locator(`[data-testid="fond-kind-${slot}"] [data-kind="${spec.kind}"]`).click();
    if (spec.kind === "wallpaper") await box.locator(".wp-item").first().click();
    const tok = box.locator(`[data-testid="card-da-color"][data-token="${spec.token ?? (slot === "fond" ? "primary" : "secondary")}"]`);
    await tok.waitFor({ timeout: 20000 });
    await tok.click();
  }
  // Un réglage absent ou désactivé est une régression : on le dit (et on continue), au lieu d'attendre un délai.
  for (const [testid, attr, v, what] of [["fond-round", "data-step", spec.corners, "Coins"], ["fond-inset", "data-step", spec.margin, "Marge"], ["fond-contour", "data-contour", spec.contour, "Contour"]]) {
    if (!v) continue;
    const b = radio(testid, attr, v);
    if (!(await b.count()) || !(await b.isEnabled())) {
      ok(`D [${slot}] ${what} « ${v} » disponible et actif`, false, "absent ou désactivé");
      continue;
    }
    await b.click();
  }
}
const BW = { thin: 2, medium: 6, thick: 12 };
const RAD = { s: 10, m: 20, l: 36 };

/* ============================== M : la matrice type de bloc × (Fond, Carte, les deux) ============================== */
const TYPES = [
  { type: "rich-text", key: "texte", mk: (m) => ({ paragraphs: [{ fr: `${m} : un texte inventé assez long pour que le fond ait du contenu à entourer.`, en: m }] }) },
  { type: "grid", key: "grille", mk: (m) => ({ layout: "2", gap: "normal", align: "stretch", ratio: "auto", top: "gap", title: L(m), children: [{ uid: `${m.toLowerCase()}a`, type: "image", props: { mediaId: IMG, width: "wide" } }, { uid: `${m.toLowerCase()}b`, type: "image", props: { mediaId: IMG, width: "wide" } }] }) },
  { type: "image", key: "image", mk: (m) => ({ mediaId: IMG, width: "wide", caption: L(m) }) },
  { type: "section-title", key: "titre", mk: (m) => ({ title: L(m), eyebrow: L("Section") }) },
  { type: "contact", key: "contact", mk: (m) => ({ title: L(m), intro: L("Un mot inventé.") }) },
  { type: "collection-tiles", key: "entrees", mk: (m) => ({ eyebrow: L("Entrées"), title: L(m), mode: "auto", size: "medium" }) },
];
const CASES = [
  { id: "fond", F: { kind: "color", corners: "l", contour: "thick" }, C: null },
  { id: "carte", F: null, C: { kind: "color", corners: "l", contour: "medium" } },
  { id: "deux", F: { kind: "color", corners: "m", contour: "thin" }, C: { kind: "color", corners: "l", contour: "thick", margin: "l" } },
];
/** Attendu pour un cas : les zones (du dehors au dedans) avec leur largeur, coins et contour. */
const expectOf = (c) => {
  const z = [];
  if (c.F) z.push({ role: "fond", radius: RAD[c.F.corners], bw: BW[c.F.contour], full: true });
  if (c.C) z.push({ role: "carte", radius: RAD[c.C.corners], bw: BW[c.C.contour], full: false });
  return z;
};
function judgeZones(label, m, c, bad = []) {
  const want = expectOf(c);
  if (!m) return [`${label} : introuvable`];
  if (m.zones.length !== want.length) return [`${label} : ${m.zones.length} zones au lieu de ${want.length} (${m.zones.map((z) => z.cls).join(">")})`];
  want.forEach((w, i) => {
    const z = m.zones[i];
    if (w.full && !z.full) bad.push(`${w.role} : pas pleine largeur (${z.l}..${z.r}/${m.vw})`);
    if (!w.full && z.full) bad.push(`${w.role} : pleine largeur au lieu d'un retrait`);
    if (!near(z.radius, w.radius, 2.5) && !near(z.radius, w.radius * (14 / 20), 2.5) && !near(z.radius, w.radius * (24 / 36), 2.5)) bad.push(`${w.role} : coins ${z.radius}px au lieu de ${w.radius}px`);
    if (!near(z.bw, w.bw, 2.5) && !near(z.bw, w.bw * 0.66, 2.5)) bad.push(`${w.role} : contour ${z.bw}px au lieu de ${w.bw}px`);
  });
  if (want.length === 2 && m.zones[1].l < m.zones[0].l + 8) bad.push("la carte touche le bord du fond");
  if (m.sw > m.vw + 1) bad.push(`défilement horizontal ${m.sw}/${m.vw}`);
  return bad;
}
if (run("M")) {
  await section("M", async () => {
    for (const T of TYPES) {
      const pid = { "rich-text": PAGES.personnages, grid: PAGES.decors, image: PAGES.animation, "section-title": PAGES.apropos, contact: PAGES.accueil, "collection-tiles": PAGES.personnages }[T.type];
      const blocks = CASES.map((c) => ({ uid: `m${c.id}`, type: T.type, props: T.mk(MARK(`${T.key}${c.id}`)) }));
      if (T.type === "collection-tiles") blocks.unshift({ uid: "txt", type: "rich-text", props: { paragraphs: [L("Page de départ inventée.")] } });
      ok(`M0 [${T.key}] page posée`, await publishWith(pid, blocks));
      const fr = await openEditor(pid);
      const seen = {};
      for (const c of CASES) {
        const marker = MARK(`${T.key}${c.id}`);
        const menu = await openMenuOn(fr, marker);
        // Pas de contour verrouillé, jamais : les deux sections ont coins et contour, actifs.
        ok(`M1 [${T.key}/${c.id}] aucun état verrouillé ni message de verrou`, (await menu.locator('[data-testid="fond-border-locked"], [data-state="locked"], [data-state="board"], [data-testid="fond-exclusive"]').count()) === 0);
        for (const slot of ["fond", "carte"]) {
          const contour = sec(menu, slot).locator('[data-testid="fond-contour"] [role="radio"]');
          ok(`M2 [${T.key}/${c.id}] section ${slot} : Aucun / Fin / Moyen / Épais présents et actifs`, (await contour.count()) === 4 && (await contour.evaluateAll((bs) => bs.every((b) => !b.disabled))));
        }
        if (c.F) await drive(menu, "fond", c.F);
        if (c.C) await drive(menu, "carte", c.C);
        // Coins : présents et actifs dans chaque section réglée.
        for (const [slot, spec] of [["fond", c.F], ["carte", c.C]]) {
          if (!spec) continue;
          ok(`M3 [${T.key}/${c.id}] section ${slot} : Coins présents`, (await sec(menu, slot).locator('[data-testid="fond-round"] [role="radio"]').count()) === 4);
        }
        if (c.C?.margin) ok(`M4 [${T.key}/${c.id}] la Carte a sa Marge`, (await sec(menu, "carte").locator('[data-testid="fond-inset"] [role="radio"]').count()) === 3);
        await page.keyboard.press("Escape");
        // Mesure sur la toile : on attend que le rendu soit celui du cas.
        const sel = await fr.evaluate((marker) => {
          const els = [...document.querySelectorAll("h1,h2,h3,p,figcaption,span,div")].filter((e) => !e.children.length && e.textContent.includes(marker));
          const e = els.at(-1);
          if (!e) return null;
          e.setAttribute("data-m105", marker);
          return `[data-m105="${marker}"]`;
        }, marker);
        let m = null;
        await until(async () => {
          m = await fr.evaluate(ZONES, { target: sel });
          return m && judgeZones("", m, c).length === 0;
        }, 90000);
        const bad = judgeZones(`${T.key}/${c.id}`, m, c);
        ok(`M5 [${T.key}/${c.id}] éditeur : coins, contour, retrait et largeur ont leur effet`, bad.length === 0, bad.join(" ; "));
        seen[c.id] = m;
      }
      // Publication, puis public = éditeur.
      ok(`M6 [${T.key}] publication`, await publishCurrentFromEditor(pid));
      const slug = { "rich-text": "personnages", grid: "decors", image: "animation", "section-title": "a-propos", contact: "", "collection-tiles": "personnages" }[T.type];
      await page.goto(urlOf(slug), { waitUntil: "domcontentloaded" });
      for (const c of CASES) {
        const marker = MARK(`${T.key}${c.id}`);
        await page.waitForFunction((mk) => document.body.textContent.includes(mk), marker, { timeout: 60000 });
        const sel = await page.evaluate((mk) => {
          const e = [...document.querySelectorAll("h1,h2,h3,p,figcaption,span,div")].filter((x) => !x.children.length && x.textContent.includes(mk)).at(-1);
          e?.setAttribute("data-m105", mk);
          return e ? `[data-m105="${mk}"]` : null;
        }, marker);
        const pm = await page.evaluate(ZONES, { target: sel });
        const bad = judgeZones(`${T.key}/${c.id}`, pm, c);
        ok(`M7 [${T.key}/${c.id}] public : mêmes coins, contour, retrait`, bad.length === 0, bad.join(" ; "));
        const em = seen[c.id];
        ok(`M8 [${T.key}/${c.id}] parité éditeur / public (rayon, contour)`, em && pm && em.zones.length === pm.zones.length && em.zones.every((z, i) => near(z.radius, pm.zones[i].radius, 1.5) && near(z.bw, pm.zones[i].bw, 1.5)), JSON.stringify([em?.zones.map((z) => [z.radius, z.bw]), pm?.zones.map((z) => [z.radius, z.bw])]));
      }
      // Rechargement de l'éditeur : le menu relit ce qui est écrit.
      const fr2 = await openEditor(pid);
      for (const c of CASES) {
        const menu = await openMenuOn(fr2, MARK(`${T.key}${c.id}`));
        const checked = async (slot, testid, attr) => sec(menu, slot).locator(`[data-testid="${testid}"] [aria-checked="true"]`).first().getAttribute(attr).catch(() => null);
        let good = true;
        for (const [slot, spec] of [["fond", c.F], ["carte", c.C]]) {
          if (!spec) continue;
          if ((await checked(slot, "fond-contour", "data-contour")) !== spec.contour) good = false;
          if ((await checked(slot, "fond-round", "data-step")) !== spec.corners) good = false;
        }
        ok(`M9 [${T.key}/${c.id}] après rechargement, le menu rend coins et contour de chaque section`, good);
        await page.keyboard.press("Escape");
      }
    }
  });
}


/* ============================== K : la Carte PARTOUT (cellule de grille, composant imbriqué, composant de planche) ============================== */
const KSTEPS = {
  carte: { C: { kind: "wallpaper", corners: "l", contour: "thick", margin: "l" } },
  deux: { F: { kind: "color", corners: "m", contour: "thin" } },
};
const labelOf = (fr) => fr.locator('.pe-tag [aria-current="true"]').first().textContent();
async function waitMenuState(fr, spec) {
  const menu = fr.locator('[data-testid="fond-menu"]').first();
  for (const [slot, sp] of Object.entries(spec)) {
    const got = await until(async () => {
      const box = sec(menu, slot);
      const c = await box.locator('[data-testid="fond-contour"] [aria-checked="true"]').first().getAttribute("data-contour").catch(() => null);
      const r = await box.locator('[data-testid="fond-round"] [aria-checked="true"]').first().getAttribute("data-step").catch(() => null);
      return c === sp.contour && r === sp.corners;
    }, 30000);
    ok(`K-menu la section « ${slot} » relit coins ${sp.corners} et contour ${sp.contour}`, got);
  }
}
/** Cible dans le document (toile ou public) : un sélecteur CSS donné par l'hôte. */
async function zonesAt(where, targetSel) {
  return where.evaluate(ZONES, { target: targetSel });
}
async function hostCase({ name, pid, url, selectOnCanvas, targetIn, boardSave, openBtn }) {
  await section(`K-${name}`, async () => {
    const fr = await openEditor(pid);
    const menuOf = async () => {
      await selectOnCanvas(fr);
      await (openBtn ? openBtn(fr) : fr.locator('.pe-tools [data-testid="fond-button"], [data-testid="cellbar"] [data-testid="fond-button"]').first().click());
      const menu = fr.locator('[data-testid="fond-menu"]').first();
      await menu.waitFor({ timeout: 20000 });
      return menu;
    };
    let menu = await menuOf();
    ok(`K0 [${name}] les deux sections Fond et Carte sont là, chacune avec Coins et Contour (la Carte n'est jamais cachée)`, (await menu.locator('[data-testid="fond-section-fond"] [data-testid="fond-contour"], [data-testid="fond-section-carte"] [data-testid="fond-contour"]').count()) === 2 && (await sec(menu, "carte").isVisible()));
    // 1. La Carte seule : papier peint, coins, contour, marge.
    await drive(menu, "carte", KSTEPS.carte.C);
    let m = null;
    await until(async () => {
      m = await zonesAt(fr, await targetIn(fr));
      return m && m.zones.length === 1 && m.zones[0].radius > 20 && m.zones[0].bw >= 6;
    }, 90000);
    ok(`K1 [${name}] Carte seule : papier, coins Grand, contour Épais, retrait vus sur la toile`, m?.zones.length === 1 && m.zones[0].radius > 20 && m.zones[0].bw >= 6 && !m.zones[0].full, JSON.stringify(m?.zones.map((z) => [z.cls, z.radius, z.bw])));
    ok(`K1b [${name}] la Carte porte un papier peint`, await fr.evaluate((t) => document.querySelector(t)?.closest("[data-wallpaper]") !== null, await targetIn(fr)));
    // 2. Le Fond s'ajoute : deux zones, chacune avec ses coins et son contour.
    await drive(menu, "fond", KSTEPS.deux.F);
    await until(async () => {
      m = await zonesAt(fr, await targetIn(fr));
      return m && m.zones.length === 2 && near(m.zones[0].bw, 2, 1.2) && m.zones[1].bw >= 6;
    }, 90000);
    const two = m && m.zones.length === 2 && near(m.zones[0].radius, 20, 2.5) && near(m.zones[1].radius, 36, 2.5) && near(m.zones[0].bw, 2, 1.2) && near(m.zones[1].bw, 12, 1.5) && m.zones[1].l >= m.zones[0].l + 8;
    ok(`K2 [${name}] Fond + Carte : Fond (coins Moyen, contour Fin) autour, Carte (coins Grand, contour Épais, marge Grande) dedans`, two, JSON.stringify(m?.zones.map((z) => [z.cls, Math.round(z.l), z.radius, z.bw])));
    ok(`K2b [${name}] le Fond garde son contour et ses coins quand la Carte est réglée (indépendants)`, await (async () => {
      await page.keyboard.press("Escape");
      menu = await menuOf();
      await waitMenuState(fr, { fond: { contour: "thin", corners: "m" }, carte: { contour: "thick", corners: "l" } });
      return true;
    })());
    ok(`K3 [${name}] aucun défilement horizontal`, m && m.sw <= m.vw + 1);
    const canvasM = m;
    await page.keyboard.press("Escape");
    // 3. Enregistrer et publier.
    ok(`K4 [${name}] publication`, await boardSave(fr));
    // 4. Public.
    await page.goto(url, { waitUntil: "domcontentloaded" });
    let pm = null;
    await until(async () => {
      const sel = await targetIn(page);
      pm = sel ? await zonesAt(page, sel) : null;
      return pm && pm.zones.length === 2;
    }, 60000);
    ok(`K5 [${name}] public : deux zones, mêmes coins et contours que la toile`, pm && pm.zones.length === 2 && pm.zones.every((z, i) => near(z.radius, canvasM.zones[i].radius, 1.5) && near(z.bw, canvasM.zones[i].bw, 1.5)), JSON.stringify([pm?.zones.map((z) => [z.radius, z.bw]), canvasM.zones.map((z) => [z.radius, z.bw])]));
    // 5. Rechargement de l'éditeur : tout est relu.
    const fr2 = await openEditor(pid);
    await selectOnCanvas(fr2);
    await (openBtn ? openBtn(fr2) : fr2.locator('.pe-tools [data-testid="fond-button"], [data-testid="cellbar"] [data-testid="fond-button"]').first().click());
    await fr2.locator('[data-testid="fond-menu"]').first().waitFor({ timeout: 20000 });
    await waitMenuState(fr2, { fond: { contour: "thin", corners: "m" }, carte: { contour: "thick", corners: "l" } });
    await page.keyboard.press("Escape");
  });
}
if (run("K")) {
  // K-a : une cellule de grille.
  const gid = PAGES.decors;
  ok("K-a0 grille de deux cases posée", await publishWith(gid, [{ uid: "g1", type: "grid", props: { layout: "2", gap: "normal", align: "stretch", ratio: "auto", top: "gap", title: L("M105kgrille"), children: [{ uid: "c1", type: "image", props: { mediaId: IMG, width: "wide" } }, { uid: "c2", type: "image", props: { mediaId: IMG, width: "wide" } }] } }]));
  const cellTarget = async (where) => where.evaluate(() => {
    const img = document.querySelectorAll(".block-grid-cell")[0]?.querySelector("img");
    img?.setAttribute("data-k105", "1");
    return img ? '[data-k105="1"]' : null;
  });
  await hostCase({
    name: "cellule",
    pid: gid,
    url: urlOf("decors"),
    selectOnCanvas: async (fr) => {
      const cell = fr.locator(".block-grid-cell[data-edit-cell]").first();
      await cell.scrollIntoViewIfNeeded();
      for (let i = 0; i < 4; i++) {
        await cell.hover();
        if (await fr.locator('[data-testid="cellbar"] [data-testid="fond-button"]').count()) return;
        await cell.locator("img").first().click({ position: { x: 8, y: 8 }, force: true }).catch(() => {});
      }
    },
    targetIn: cellTarget,
    boardSave: (fr) => publishCurrentFromEditor(gid),
  });
  // K-b : « Projet mis en avant » est un conteneur ANCIEN (refusé à la publication) : les composants imbriqués vivants sont les cases de grille (K-a) et les composants de planche (K-c).
}
if (run("K")) {
  // K-c : un composant de planche de projet (texte posé dans la planche d'un projet).
  const bid = PAGES.animation;
  const PROJ = q1("select id, slug from projects order by position limit 1");
  sql((db) => db.prepare("update projects set layout = ?, draft_layout = null where id = ?").run(JSON.stringify([{ uid: "strip", type: "strip", props: {} }, { uid: "k1", type: "rich-text", props: { paragraphs: [L("M105kplanche : un texte inventé dans la planche.")] } }, { uid: "k2", type: "rich-text", props: { paragraphs: [L("M105kplanche2 : un autre texte inventé.")] } }]), PROJ.id));
  ok("K-c0 planche posée sur la page", await publishWith(bid, [{ uid: "b1", type: "project-board", props: { project: PROJ.slug } }]));
  const boardTarget = async (where) => where.evaluate(() => {
    const p = [...document.querySelectorAll("p")].find((e) => e.textContent.includes("M105kplanche :"));
    p?.setAttribute("data-k105", "1");
    return p ? '[data-k105="1"]' : null;
  });
  await hostCase({
    name: "planche",
    pid: bid,
    url: urlOf("animation"),
    selectOnCanvas: async (fr) => {
      const frame = fr.locator("[data-edit-bitem]").filter({ hasText: "M105kplanche :" }).first();
      await frame.scrollIntoViewIfNeeded();
      await frame.hover();
      await frame.locator('[data-edit-bitem-op="fond"]').first().waitFor({ timeout: 20000 });
    },
    targetIn: boardTarget,
    openBtn: async (fr) => {
      const frame = fr.locator("[data-edit-bitem]").filter({ hasText: "M105kplanche :" }).first();
      await frame.hover();
      await frame.locator('[data-edit-bitem-op="fond"]').first().click();
    },
    boardSave: async () => {
      const btn = page.getByRole("button", { name: "Publier", exact: true });
      const end = Date.now() + 240000;
      while (Date.now() < end) {
        if (await btn.isEnabled().catch(() => false)) {
          await btn.click({ timeout: 5000 }).catch(() => {});
          const confirm = page.locator("dialog[open]").getByRole("button", { name: "Mettre en ligne" });
          if (await confirm.waitFor({ timeout: 2500 }).then(() => true, () => false)) await confirm.click();
        }
        if (await until(() => published(bid) && q1("select draft_layout from projects where id = ?", PROJ.id)?.draft_layout === null, 12000)) return true;
      }
      return false;
    },
  });
}
async function publishCurrentFromEditor(pid) {
  const btn = page.getByRole("button", { name: "Publier", exact: true });
  const end = Date.now() + 240000;
  while (Date.now() < end) {
    if (await btn.isEnabled().catch(() => false)) {
      await btn.click({ timeout: 5000 }).catch(() => {});
      const confirm = page.locator("dialog[open]").getByRole("button", { name: "Mettre en ligne" });
      if (await confirm.waitFor({ timeout: 2500 }).then(() => true, () => false)) await confirm.click();
    }
    if (await until(() => published(pid), 12000)) return true;
  }
  return false;
}


/* ============================== T : « Entrées des collections » ============================== */
if (run("T")) {
  await section("T", async () => {
    const pid = PAGES.personnages;
    const tilesProps = (extra = {}) => ({ eyebrow: L("Entrées"), title: L("M105tbloc"), mode: "auto", size: "medium", ...extra });
    ok("T0 bloc posé", await publishWith(pid, [{ uid: "t1", type: "collection-tiles", props: tilesProps() }]));
    let fr = await openEditor(pid);
    const tilesBlock = () => fr.locator('[data-edit-type="collection-tiles"]').first();
    const nTiles = () => tilesBlock().locator(".tile").count();
    ok("T0b des entrées sont montrées sur la toile (une par page de collection)", await until(async () => (await nTiles()) >= 1, 60000), String(await nTiles()));
    const n0 = await nTiles();
    const propsNow = () => draftOf(pid)[0]?.props ?? {};
    const sel = async () => {
      await page.keyboard.press("Escape");
      await tilesBlock().locator("h2").first().click();
      await fr.locator('.pe-tag [aria-current="true"]').first().waitFor({ timeout: 20000 });
    };
    // T1 : les trois textes d'une entrée, en place (mode automatique : modifications de tuile, attachées à la page).
    const FIELDS = [["eyebrow", "tileEyebrow", "M105 étiquette de l'entrée"], ["title", "tileTitle", "M105 titre de l'entrée"], ["intro", "tileIntro", "M105 présentation de l'entrée"]];
    for (const [field, key, text] of FIELDS) {
      const el = tilesBlock().locator(`.tile [data-look-key="${key}"]`).first();
      ok(`T1 [${field}] le texte de l'entrée est modifiable en place (data-inline) et garde son « Aa » (data-look-key)`, (await el.getAttribute("data-inline")) !== null && (await el.getAttribute("data-look-key")) === key);
      for (let k = 0; k < 4; k++) {
        if (await el.dblclick({ timeout: 8000 }).then(() => true, () => false)) break;
      }
      await page.keyboard.press("Control+A");
      await page.keyboard.type(text);
      await page.keyboard.press("Enter");
      ok(`T1b [${field}] enregistré dans les modifications de tuile du bloc`, await until(() => (propsNow().edits ?? []).some((e) => e[field]?.fr === text), 60000), JSON.stringify(propsNow().edits));
      ok(`T1c [${field}] la toile montre le texte`, await until(async () => ((await tilesBlock().locator(`.tile [data-look-key="${key}"]`).first().textContent()) ?? "").includes(text), 60000));
    }
    // T2 : couverture par entrée (choix, repli automatique).
    await sel();
    const img0 = () => tilesBlock().locator(".tile img").first().getAttribute("src");
    const src0 = await img0();
    await tilesBlock().locator('.tile [data-edit-tile-op="cover"]').first().click({ force: true });
    await until(async () => (await page.locator("dialog[open] li button").count()) > 0, 60000);
    console.log(`# sélecteur de couverture : ${await page.locator("dialog[open] li button").count()} images, ${await page.locator("dialog[open]").count()} dialogue(s)`);
    await page.locator("dialog[open] li button").first().waitFor({ state: "attached", timeout: 30000 });
    await page.locator("dialog[open] li button").first().click();
    ok("T2 couverture choisie : l'entrée porte son image (modification de tuile)", await until(() => (propsNow().edits ?? []).some((e) => typeof e.mediaId === "number"), 60000), JSON.stringify(propsNow().edits));
    await tilesBlock().locator('.tile [data-edit-tile-op="cover-clear"]').first().waitFor({ timeout: 60000 });
    await tilesBlock().locator('.tile [data-edit-tile-op="cover-clear"]').first().click({ force: true });
    ok("T2b « Couverture automatique » : repli sur l'image de la collection", await until(() => !(propsNow().edits ?? []).some((e) => e.mediaId !== undefined), 60000) && (await until(async () => (await img0()) === src0, 60000)));
    // T3 : taille des images (colonne image) : effet mesuré.
    await sel();
    const w = () => tilesBlock().locator(".tile .tile-img").first().evaluate((e) => e.getBoundingClientRect().width);
    const w0 = await w();
    await fr.locator('.pe-tools button:has-text("Taille des images")').click();
    await fr.getByRole("radio", { name: "Grande" }).click();
    ok("T3 « Taille des images » Grande : la colonne image s'élargit", await until(async () => (await w()) > w0 + 20, 60000) && (await until(() => propsNow().size === "large", 60000)), `${w0} → ${await w()} / ${propsNow().size}`);
    await page.keyboard.press("Escape");
    // T4 : espacement au-dessus (comme les autres blocs).
    await sel();
    const top0 = await tilesBlock().evaluate((e) => e.getBoundingClientRect().top + window.scrollY);
    await fr.locator('.pe-tools [data-testid="space-button"]').click();
    await fr.locator('[data-testid="space-menu"] [data-space-top="none"]').click();
    ok("T4 « Espacement » : le réglage du bloc est écrit", await until(() => propsNow().look?.spaceTop === "none", 60000));
    void top0;
    await page.keyboard.press("Escape");
    // T5 : entrées à la main : passer en manuel depuis la barre, éditer, monter, descendre, retirer.
    await sel();
    await fr.locator('.pe-tools [data-testid="tiles-mode-button"]').click();
    ok("T5 passage « à la main » depuis la barre : la liste reprend ce que la toile montrait", await until(() => propsNow().mode === "manual" && (propsNow().items ?? []).length === n0, 60000), JSON.stringify(propsNow()).slice(0, 200));
    ok("T5b les textes modifiés ne sont pas perdus en passant en manuel", (propsNow().items ?? []).some((it) => it.title?.fr === "M105 titre de l'entrée"));
    const manualTitle = "M105 titre à la main";
    const tEl = tilesBlock().locator('.tile [data-look-key="tileTitle"]').first();
    await until(async () => (await tEl.getAttribute("data-inline")) === "items.0.title", 60000);
    for (let k = 0; k < 4; k++) if (await tEl.dblclick({ timeout: 8000 }).then(() => true, () => false)) break;
    await page.keyboard.press("Control+A");
    await page.keyboard.type(manualTitle);
    await page.keyboard.press("Enter");
    ok("T5c titre édité en place dans la liste manuelle (items.0.title)", await until(() => propsNow().items?.[0]?.title?.fr === manualTitle, 60000));
    if (n0 >= 2) {
      const before = (propsNow().items ?? []).map((i) => i.pageId);
      await tilesBlock().locator('.tile [data-edit-tile-op="down"]').first().click({ force: true });
      ok("T5d « ↓ » change l'ordre", await until(() => (propsNow().items ?? []).map((i) => i.pageId).join() === [before[1], before[0], ...before.slice(2)].join(), 60000));
      await tilesBlock().locator('.tile [data-edit-tile-op="remove"]').first().click({ force: true });
      ok("T5e « ✕ » retire l'entrée", await until(() => (propsNow().items ?? []).length === n0 - 1, 60000));
    }
    // T6 : publication, puis public et rechargement.
    ok("T6 publication", await publishCurrentFromEditor(pid));
    const saved = savedBlocks(pid)[0].props;
    ok("T6b publié : mode, taille, espacement, textes, couverture automatique", saved.mode === "manual" && saved.size === "large" && saved.look?.spaceTop === "none" && saved.items?.[0]?.title?.fr === manualTitle && (saved.items ?? []).every((i) => i.mediaId === undefined));
    await page.goto(urlOf("personnages"), { waitUntil: "domcontentloaded" });
    ok("T6c public : le titre de la première entrée, la taille Grande", await until(async () => (await page.locator(".tiles .tile h3").first().textContent().catch(() => "")) === manualTitle && (await page.locator(".tiles").getAttribute("data-size")) === "large", 60000));
    const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const ap = await anon.newPage();
    await ap.goto(urlOf("personnages"), { waitUntil: "domcontentloaded" });
    await ap.locator(".tiles .tile").first().waitFor({ timeout: 60000 });
    ok("T6d public (visiteur) : aucune commande d'édition sur les entrées", (await ap.locator(".tiles [data-inline], .tiles [data-edit-tile-op], .tiles [data-tiles-mode], .tiles [data-placeholder]").count()) === 0);
    await anon.close();
    fr = await openEditor(pid);
    ok("T7 rechargement de l'éditeur : liste, texte et taille relus", (await tilesBlock().locator('.tile [data-look-key="tileTitle"]').first().textContent()) === manualTitle && (await tilesBlock().locator(".tiles").getAttribute("data-size")) === "large");
    // T8 : format imposé et style de texte (Aa) : effets mesurés sur la toile et en public.
    ok("T8 format 1:1 et style du titre posés", await publishWith(pid, [{ uid: "t1", type: "collection-tiles", props: tilesProps({ ratio: "1:1", look: { text: { tileTitle: { color: "#c0392b" } } } }) }]));
    await page.goto(urlOf("personnages"), { waitUntil: "domcontentloaded" });
    await page.locator(".tiles .tile").first().waitFor({ timeout: 60000 });
    const sq = await page.locator(".tiles .tile-frame").first().evaluate((e) => { const b = e.getBoundingClientRect(); return b.width / b.height; }).catch(() => 0);
    ok("T8b format imposé : l'image est carrée", near(sq, 1, 0.08), String(sq));
    ok("T8c « Aa » du titre : la couleur choisie s'applique", (await page.locator('.tiles .tile h3').first().evaluate((e) => getComputedStyle(e).color)) === rgb("#c0392b"));
  });
}


console.log(failures ? `ÉCHECS : ${failures}` : "TOUT VERT");
await browser.close();
process.exit(failures ? 1 : 0);
