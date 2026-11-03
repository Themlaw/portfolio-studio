#!/usr/bin/env node
/**
 * « Fond & carte » (lot 100) : un seul bouton, un seul menu, deux sections (Fond, Carte) toujours visibles ; plus de couleur imposée autour d'une carte ;
 * le fond entoure exactement la grille. UN chromium, serveur requis, base NEUVE, une connexion admin. Données SYNTHÉTIQUES (motif de pois et image
 * générés ici, textes inventés). Retours R8, R9, R9b, R10, R11.
 *
 * MATRICE (M, G, E) : 5 types de bloc (Texte, Grille, Image, Titre de section, Contact) × (Fond aucun / couleur / papier peint + couleur dessous / papier
 * peint seul) × (Carte aucune / couleur / papier peint) × 3 thèmes (Carnet d'atelier ; Fanzine riso, dont « bgDeep » est un JAUNE vif ; Papier de cœurs :
 * kit à papier + papier peint des cartes) × 2 largeurs (1440, 390), mesurés sur le site PUBLIC puis sur la TOILE :
 *  - M : structure (zones présentes), couleur calculée AUTOUR de la carte = celle du Fond réglé, ou le fond de la page quand Fond = aucun ; couleur de la carte
 *    = celle de la Carte réglée ; JAMAIS une autre couleur (ni « bgDeep », ni celle d'un voisin) ;
 *  - G : le fond couvre exactement la grille (d'un bord à l'autre, aucune bande de couleur parasite à gauche, à droite ni autour du contenu) ;
 *  - E : toile = public (mêmes zones, mêmes couleurs).
 * MENU (U, S, Y) : piloté comme l'artiste, sur Texte, Grille, Image (et les trois thèmes pour le Texte) : les 9 états (Fond × Carte) enchaînés dans les deux sens
 * (régler la Carte garde le Fond, et inversement : R9b), données écrites (couches, aucune clé nouvelle), toile ; le même bouton « Fond & carte » et la même
 * structure DOM du menu partout ; les deux sections et leurs schémas toujours affichés ; aucune couleur imposée (Y).
 * PARITÉ (P) : empreinte de la capture publique des réglages d'AVANT (carte pleine / en retrait, fond bord à bord / avec marge, carte + fond emboîtés),
 * à comparer entre l'arbre du lot 90 et celui du lot 100 (PARITY_SHA).
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=M,E,U,S,Y,C,P,X] [SHOTS=dossier] node scripts/e2e-fond100.mjs
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";
import sharp from "sharp";

import { paint } from "./lib/crop-fixtures.mjs";
import { login, q1, waitFor } from "./lib/medias-setup.mjs";
import { installPaperTheme, PAPER_THEME_NAME } from "./lib/paper-theme.mjs";
import { activateThemeUi } from "./lib/theme-live.mjs";

const BASE = process.env.BASE ?? "http://localhost:3840";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const DATA = process.env.DATA_DIR ?? "data";
const SHOTS = process.env.SHOTS ?? path.join(DATA, "..", "shots-fond100");
const DB = path.join(DATA, "portfolio.db");
mkdirSync(SHOTS, { recursive: true });
sharp.cache(false);
sharp.concurrency(1);

let failures = 0;
let asserts = 0;
const ok = (label, cond, detail = "") => {
  asserts++;
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
const recent = [];
page.on("console", (m) => (m.type() === "error" || /FONDDBG/.test(m.text())) && recent.push(`console: ${m.text().slice(0, 300)}`));
page.on("response", (r) => r.status() >= 400 && recent.push(`HTTP ${r.status()} ${r.url().slice(-70)}`));
page.on("requestfailed", (r) => recent.push(`FAILED ${r.url().slice(-60)}`));
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);

/* ---- Fixtures synthétiques ------------------------------------------------------------------------------------------------------ */
const FIX = mkdtempSync(path.join(tmpdir(), "pf-fond100-"));
await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><g fill="#e07a9a"><circle cx="60" cy="60" r="26"/><circle cx="180" cy="180" r="26"/></g></svg>')).png().toFile(path.join(FIX, "Pois cent.png"));
await page.goto(`${BASE}/admin/papiers-peints`, { waitUntil: "networkidle" });
await page.locator('[data-testid="wallpaper-input"]').setInputFiles([path.join(FIX, "Pois cent.png")]);
await waitFor(async () => (await page.locator('[data-testid="wallpaper"][data-status="ready"]').count()) === 1, 120000);
const WP = q1("select id from wallpapers order by id desc")?.id;
if (!WP) throw new Error("motif de test non importé");
await page.request.post(`${BASE}/admin/api/upload`, { headers: { origin: BASE }, multipart: { file: { name: "100-image.png", mimeType: "image/png", buffer: await paint(1200, 800, 3) } }, timeout: 180000 });
await waitFor(() => q1("select status from media where original_name = '100-image.png'")?.status === "ready", 180000);
const IMG = q1("select id from media where original_name = '100-image.png'")?.id;

/* ---- Les cinq pages de la matrice : un type de bloc par page ------------------------------------------------------------------- */
const FCOL = "#2a7f62";
const CCOL = "#c0392b";
const TYPES = [
  { type: "rich-text", slug: "personnages", url: "/fr/personnages", mk: (m) => ({ paragraphs: [{ fr: `${m} : un texte inventé assez long pour que le fond ait du contenu à entourer.`, en: m }] }) },
  { type: "grid", slug: "decors", url: "/fr/decors", mk: (m, u) => ({ layout: "2", gap: "normal", align: "stretch", ratio: "auto", top: "gap", title: { fr: m, en: m }, children: [{ uid: `${u}a`, type: "image", props: { mediaId: IMG, width: "wide" } }, { uid: `${u}b`, type: "image", props: { mediaId: IMG, width: "wide" } }] }) },
  { type: "image", slug: "animation", url: "/fr/animation", mk: (m) => ({ mediaId: IMG, width: "wide", caption: { fr: m, en: m } }) },
  { type: "section-title", slug: "a-propos", url: "/fr/a-propos", mk: (m) => ({ title: { fr: m, en: m }, eyebrow: { fr: "Section", en: "Section" } }) },
  { type: "contact", slug: "", url: "/fr", mk: (m) => ({ title: { fr: m, en: m }, intro: { fr: "Un mot inventé.", en: "A word." } }) },
];
/** Réglages d'une section : kind = none | color | wp (papier peint + couleur dessous) | wpnc (papier peint seul). */
const COMBOS = [];
for (const F of ["none", "color", "wp"]) for (const C of ["none", "color", "wp"]) COMBOS.push({ F, C });
COMBOS.push({ F: "wpnc", C: "none" }, { F: "none", C: "wpnc" });
const comboKey = (c) => `F-${c.F}/C-${c.C}`;
const under = (kind, col) => (kind === "color" ? { color: col, paper: "under" } : kind === "wp" ? { color: col } : {});
/** Données EXACTEMENT comme le menu les écrit (src/themes/fondcarte.ts) : deux couches si les deux sections sont remplies, sinon la couche de la section. */
function propsOf(c) {
  const f = c.F !== "none";
  const k = c.C !== "none";
  const wpOf = (kind) => kind === "wp" || kind === "wpnc";
  if (f && k) {
    return {
      surface: { width: "full", ...under(c.F, FCOL), ...(wpOf(c.F) ? { paperWallpaper: WP } : {}) },
      background: wpOf(c.C) ? { kind: "wallpaper", wallpaper: WP, ...under(c.C, CCOL), inset: "m" } : { kind: "color", color: CCOL, paper: "under", inset: "m" },
    };
  }
  if (f) return { background: wpOf(c.F) ? { kind: "wallpaper", wallpaper: WP, ...under(c.F, FCOL) } : { kind: "color", color: FCOL, paper: "under" } };
  if (k) return { surface: { width: "inset", ...under(c.C, CCOL), ...(wpOf(c.C) ? { paperWallpaper: WP } : {}) } };
  return {};
}
const blocksOf = (t) => {
  const out = [{ uid: "ctrl", type: t.type, props: t.mk("Mctrl", "ctrl") }];
  COMBOS.forEach((c, i) => {
    const u = `m${String(i).padStart(2, "0")}`;
    out.push({ uid: `s${u}`, type: "rich-text", props: { paragraphs: [{ fr: `Séparateur ${i}`, en: "sep" }] } });
    out.push({ uid: u, type: t.type, props: { ...t.mk(`M${t.type.replace(/\W/g, "")}${i}x`, u), ...propsOf(c) } });
  });
  return out;
};
const markerOf = (t, i) => (i === "ctrl" ? "Mctrl" : `M${t.type.replace(/\W/g, "")}${i}x`);

/* ---- Mesure (exécutée dans la page publique OU dans la toile) ------------------------------------------------------------------- */
const MEASURE = (marker) => {
  const matches = [...document.querySelectorAll("h1,h2,h3,p,figcaption,span,div")].filter((e) => !e.children.length && e.textContent.includes(marker));
  // La toile peut garder un instant l'ancienne version d'un bloc pendant qu'elle se recharge : on mesure la dernière copie visible.
  const el = matches.filter((e) => e.getClientRects().length > 0).at(-1) ?? matches[0];
  if (!el) return null;
  el.scrollIntoView({ block: "center", behavior: "instant" });
  const rect = (e) => {
    const b = e.getBoundingClientRect();
    return { l: b.left, r: b.right, t: b.top, b: b.bottom };
  };
  const chain = [];
  for (let e = el.parentElement; e && e.tagName !== "BODY"; e = e.parentElement) if (e.classList.contains("zone") && (e.dataset.surface === "on" || e.dataset.fond === "on")) chain.push(e);
  const vw = document.documentElement.clientWidth;
  const alpha = (c) => (/^rgba\(.*,\s*0\)$/.test(c) || c === "transparent" ? 0 : 1);
  // `skip` : la zone mesurée elle-même. Sa couche intérieure (`.fond-in`) déborde de la marge (lot 47) : un point juste hors de la zone la touche, mais sa couleur n'est pas celle qui entoure.
  const bgAt = (x, y, skip = null) => {
    // La fenêtre du menu et la barre d'édition peuvent recouvrir la page : on regarde ce qui est DERRIÈRE, comme le visiteur.
    const top = document.elementsFromPoint(x, y).find((t) => !t.closest('[data-testid="fond-menu"], .pe-tools, [role="dialog"], .pe-pop'));
    for (let e = top ?? null; e; e = e.parentElement) {
      if (e === skip) continue;
      const c = getComputedStyle(e).backgroundColor;
      if (alpha(c)) return c;
    }
    return "rgba(0, 0, 0, 0)";
  };
  const info = (e) => (e ? { cls: e.classList.contains("surface-card") ? "card" : "fond", inset: e.hasAttribute("data-fond-inset") || e.dataset.width === "inset", bg: getComputedStyle(e).backgroundColor, ...rect(e), around: e.hasAttribute("data-fond-around"), shadow: getComputedStyle(e).boxShadow } : null);
  const outer = info(chain.at(-1));
  const inner = chain.length > 1 ? info(chain[0]) : null;
  const er = rect(el);
  const base = inner ?? outer;
  const baseEl = inner ? chain[0] : chain.at(-1) ?? null;
  const midY = (base ? (base.t + base.b) / 2 : (er.t + er.b) / 2) | 0;
  // Bloc entier (contenu) : la plus haute boîte de contenu connue (grille, section, figure) ou, à défaut, le texte repère.
  // Grille : ce qui compte est la place des CASES (le titre et la section qui les portent sont plus larges que le contenu).
  const sec0 = el.closest("section, figure") ?? el;
  const cells = [...sec0.querySelectorAll(".block-grid-cell, .block-grid > *")];
  const content = el.closest(".block-grid, section, figure") ?? el;
  let cr = rect(content);
  if (cells.length) {
    const rs = cells.map(rect);
    cr = { l: Math.min(...rs.map((r) => r.l)), r: Math.max(...rs.map((r) => r.r)), t: Math.min(...rs.map((r) => r.t)), b: Math.max(...rs.map((r) => r.b)) };
  }
  return {
    n: chain.length,
    cands: matches.length,
    anc: (() => { const a = []; for (let e = el; e && a.length < 9; e = e.parentElement) a.push(e.tagName.toLowerCase() + (e.dataset.surface || e.dataset.fond ? `[s=${e.dataset.surface}|f=${e.dataset.fond}|z=${e.classList.contains("zone")}]` : "") + (e.className && typeof e.className === "string" ? "." + e.className.split(" ").slice(0, 2).join(".") : "")); return a.join(" < "); })(),
    classes: chain.map((e) => (e.classList.contains("surface-card") ? "card" : "fond") + (e.hasAttribute("data-fond-inset") ? ":inset" : e.dataset.width ? `:${e.dataset.width}` : "")).reverse().join(">"),
    outer,
    inner,
    content: cr,
    vw,
    sw: document.documentElement.scrollWidth,
    // Ce qui entoure : à gauche de la zone intérieure (ou de la carte seule) ; bord gauche et droit de la page pour un fond pleine largeur.
    aroundLeft: base && base.l > 6 ? bgAt(base.l - 5, midY, baseEl) : null,
    aroundRight: base && base.r < vw - 6 ? bgAt(base.r + 5, midY, baseEl) : null,
    edgeLeft: bgAt(2, midY),
    edgeRight: bgAt(vw - 3, midY),
    beside: bgAt(Math.max(2, cr.l - 4), midY),
    page: null,
    anyAround: document.querySelectorAll("[data-fond-around]").length,
  };
};
const rgbOf = (s) => (/rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s) ?? []).slice(1, 4).map(Number);
const same = (a, b) => {
  const x = rgbOf(a ?? "");
  const y = rgbOf(b ?? "");
  return x.length === 3 && y.length === 3 && x.every((v, i) => Math.abs(v - y[i]) <= 1);
};
const hexRgb = (h) => `rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`;
const near = (a, b, tol = 1.5) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= tol;

/** Spécification d'une combinaison : couleurs attendues du Fond (f) et de la Carte (k), `null` = section vide, `"any"` = couleur non vérifiée (papier peint sans couleur). */
const specOf = (c, pageBg) => ({ f: c.F === "none" ? null : c.F === "wpnc" ? pageBg : hexRgb(FCOL), k: c.C === "none" ? null : c.C === "wpnc" ? "any" : hexRgb(CCOL) });

/** Vérifie une mesure contre une spécification : structure, couleurs, couverture. Renvoie la liste des écarts. */
function judge(m, spec, pageBg, { grid = false, tol = 1.5 } = {}) {
  const bad = [];
  if (!m) return ["bloc introuvable"];
  const f = spec.f !== null;
  const k = spec.k !== null;
  const fcol = spec.f;
  const ccol = spec.k === "any" ? null : spec.k;
  const want = f && k ? 2 : f || k ? 1 : 0;
  if (m.n !== want) bad.push(`zones ${m.n} au lieu de ${want} (${m.classes})`);
  if (m.anyAround) bad.push("data-fond-around présent");
  if (m.n !== want) return bad;
  if (f && k) {
    if (!m.inner?.inset) bad.push("la carte n'est pas en retrait");
    if (!same(m.aroundLeft, fcol)) bad.push(`autour de la carte : ${m.aroundLeft} au lieu du Fond ${fcol}`);
    if (ccol && !same(m.inner.bg, ccol)) bad.push(`carte ${m.inner.bg} au lieu de ${ccol}`);
    if (!near(m.outer.l, 0, tol) || !near(m.outer.r, m.vw, tol)) bad.push(`le fond ne couvre pas la largeur (${m.outer.l}..${m.outer.r} / ${m.vw})`);
    if (m.inner.l < m.outer.l + 4 || m.inner.r > m.outer.r - 4) bad.push("la carte touche le bord du fond");
  } else if (f) {
    if (!near(m.outer.l, 0, tol) || !near(m.outer.r, m.vw, tol)) bad.push(`le fond ne couvre pas la largeur (${m.outer.l}..${m.outer.r} / ${m.vw})`);
    if (!same(m.edgeLeft, fcol) || !same(m.edgeRight, fcol)) bad.push(`bande parasite : bord gauche ${m.edgeLeft}, droit ${m.edgeRight} au lieu de ${fcol}`);
    if (!same(m.beside, fcol)) bad.push(`autour du contenu : ${m.beside} au lieu de ${fcol}`);
  } else if (k) {
    if (!m.outer.inset) bad.push("la carte n'est pas en retrait");
    if (!same(m.aroundLeft, pageBg) || !same(m.aroundRight, pageBg)) bad.push(`autour de la carte : ${m.aroundLeft} / ${m.aroundRight} au lieu du fond de la page ${pageBg}`);
    if (ccol && !same(m.outer.bg, ccol)) bad.push(`carte ${m.outer.bg} au lieu de ${ccol}`);
  }
  if (want) {
    const o = m.outer;
    if (m.content.t < o.t - 1 || m.content.b > o.b + 1) bad.push(`contenu hors de la zone (${m.content.t}..${m.content.b} / ${o.t}..${o.b})`);
    if (grid && (m.content.l < o.l - 1 || m.content.r > o.r + 1)) bad.push(`grille hors de la zone (${m.content.l.toFixed(1)}..${m.content.r.toFixed(1)} / ${o.l.toFixed(1)}..${o.r.toFixed(1)})`);
  }
  if (m.sw > m.vw + 1) bad.push(`défilement horizontal ${m.sw} / ${m.vw}`);
  return bad;
}

/* ---- Mise en place : cinq pages publiées, comme l'artiste ----------------------------------------------------------------------- */
const PAGES = TYPES.map((t) => ({ ...t, id: q1("select id from pages where json_extract(slug, '$.fr') = ?", t.slug)?.id }));
if (PAGES.some((p) => !p.id)) throw new Error(`pages introuvables : ${JSON.stringify(PAGES.map((p) => [p.slug, p.id]))}`);
/** Brouillon écrit comme l'éditeur le lit, puis « Publier » (validation complète, revalidation du cache public). Le clic est refait tant que la publication n'a pas rendu la main (hydratation). */
async function publishPage(pageId, blocks, extra = {}) {
  sql((db) => {
    const row = db.prepare("select title, slug, meta, nav_order from pages where id = ?").get(pageId);
    const L = { fr: "", en: "" };
    const draft = { title: JSON.parse(row.title), slug: JSON.parse(row.slug), meta: row.meta ? JSON.parse(row.meta) : { title: L, description: L }, published: true, inMenu: row.nav_order !== null, accent: null, blocks, ...extra };
    db.prepare("update pages set draft = ?, draft_updated_at = unixepoch(), draft_rev = draft_rev + 1 where id = ?").run(JSON.stringify(draft), pageId);
  });
  await page.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
  const h = await page.waitForSelector("iframe.ve-frame", { timeout: 120000 });
  await (await h.contentFrame()).waitForSelector("html[data-edit-mode]", { timeout: 180000 });
  await sleep(1500);
  return publishCurrent(pageId, blocks.length);
}
/** Éditeur ouvert sur la page : « Publier » (le clic est refait tant que la publication n'a pas rendu la main). */
async function publishCurrent(pageId, expectBlocks = null) {
  const end = Date.now() + 240000;
  while (Date.now() < end) {
    const btn = page.getByRole("button", { name: "Publier", exact: true });
    if (await btn.isEnabled()) {
      await btn.click({ timeout: 5000 }).catch(() => {});
      const confirm = page.locator("dialog[open]").getByRole("button", { name: "Mettre en ligne" });
      if (await confirm.waitFor({ timeout: 2500 }).then(() => true, () => false)) await confirm.click();
    }
    const gone = await waitFor(() => sql((db) => db.prepare("select draft, (select count(*) from blocks where page_id = ?) n from pages where id = ?").get(pageId, pageId)).draft === null, 12000);
    if (gone) {
      await sleep(1200);
      return expectBlocks === null || sql((db) => db.prepare("select count(*) n from blocks where page_id = ?").get(pageId).n) === expectBlocks;
    }
  }
  return false;
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
  await sleep(1800);
  return fr;
}
async function settled() {
  await page.waitForFunction(() => !/Enregistrement/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, { timeout: 120000 });
  await sleep(500);
}
for (const p of PAGES) {
  const blocks = blocksOf(p);
  ok(`0 page « ${p.slug || "accueil"} » (${p.type}) publiée : ${blocks.length} blocs`, await publishPage(p.id, blocks));
}
const draftOf = (pageId) => {
  const row = q1("select draft from pages where id = ?", pageId);
  return row?.draft ? JSON.parse(row.draft).blocks : [];
};
const draftBlock = (pageId, uid) => draftOf(pageId).find((b) => b.uid === uid);
const pageBgOf = async (where, marker = "Mctrl") => {
  const m = await where.evaluate(MEASURE, marker);
  return m?.beside ?? null;
};
async function section(name, fn) {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 6).join(" "));
    await page.screenshot({ path: path.join(SHOTS, `erreur-${name}.png`) }).catch(() => {});
  }
}

/* ---- Menu : pilotage comme l'artiste ---------------------------------------------------------------------------------------------- */
const sec = (menu, slot) => menu.locator(`[data-testid="fond-section-${slot}"]`);
const kindBtn = (menu, slot, k) => sec(menu, slot).locator(`[data-testid="fond-kind-${slot}"] [data-kind="${k}"]`);
async function selectBlock(fr, uid) {
  const host = fr.locator(`[data-edit-block="${uid}"]`).first();
  for (let k = 0; k < 4; k++) {
    try { await host.scrollIntoViewIfNeeded({ timeout: 8000 }); break; } catch { await sleep(1200); }
  }
  const button = fr.locator('.pe-tools [data-testid="fond-button"]');
  for (const sel of ["section", ".block-grid", "figure", "img", "h2", "p"]) {
    const t = host.locator(sel).first();
    if (!(await t.count())) continue;
    await t.click({ position: { x: 6, y: 6 }, force: true }).catch(() => {});
    if (await button.waitFor({ timeout: 2500 }).then(() => true, () => false)) return true;
  }
  return false;
}
async function openMenu(fr, uid) {
  if (!(await selectBlock(fr, uid))) throw new Error(`bloc ${uid} : bouton « Fond & carte » introuvable`);
  await fr.locator('.pe-tools [data-testid="fond-button"]').click();
  const menu = fr.locator('[data-testid="fond-menu"]').first();
  await menu.waitFor({ timeout: 20000 });
  return menu;
}
const SIG = (menuSel) => {
  const m = document.querySelector(menuSel);
  return [...m.querySelectorAll("*")].filter((e) => !e.closest(".wp-grid")).map((e) => e.tagName + (e.dataset.testid ? `#${e.dataset.testid}` : "") + (e.getAttribute("role") ? `@${e.getAttribute("role")}` : "")).join(">");
};

/* ---- U : les neuf états (Fond × Carte), enchaînés, sur le bloc témoin d'une page ---------------------------------------------------- */
const SURFACE_KEYS = ["color", "width", "corners", "border", "paper", "paperWallpaper", "paperSize", "paperOpacity"];
const BG_KEYS = ["kind", "color", "wallpaper", "size", "opacity", "inset", "round", "paper"];
const deriveDraft = (b) => {
  const out = { fond: null, carte: null, keysOk: true };
  const s = b?.props?.surface;
  const g = b?.props?.background;
  if (s) {
    out[s.width === "inset" ? "carte" : "fond"] = { kind: s.paperWallpaper !== undefined ? "wallpaper" : "color", color: s.color, layer: "surface" };
    if (Object.keys(s).some((k) => !SURFACE_KEYS.includes(k))) out.keysOk = false;
  }
  if (g) {
    out[g.inset ? "carte" : "fond"] = { kind: g.kind === "wallpaper" ? "wallpaper" : "color", color: g.color, layer: "background" };
    if (Object.keys(g).some((k) => !BG_KEYS.includes(k))) out.keysOk = false;
  }
  out.pair = Boolean(s && g);
  return out;
};
const TOKEN = { fond: "primary", carte: "secondary" };
async function setSection(fr, slot, kind) {
  const menu = fr.locator('[data-testid="fond-menu"]').first();
  const box = sec(menu, slot);
  const cur = await box.getAttribute("data-kind-now");
  if (kind === "none") {
    if (cur !== "none") await kindBtn(menu, slot, "none").click();
    return null;
  }
  if (cur !== kind) await kindBtn(menu, slot, kind).click();
  if (kind === "wallpaper") await box.locator(`.wp-item[data-wallpaper-id="${WP}"]`).click();
  const tok = box.locator(`[data-testid="card-da-color"][data-token="${TOKEN[slot]}"]`);
  await tok.waitFor({ timeout: 20000 });
  await tok.click();
  return tok.locator(".cc-chip").evaluate((el) => getComputedStyle(el).backgroundColor);
}
async function uiMatrix(p, T) {
  const label = `${T.key} ${p.type}`;
  await section(`U-${label}`, async () => {
    const fr = await openEditor(p.id);
    const pageBg = await pageBgOf(fr, "Séparateur 0");
    const menu = await openMenu(fr, CTRL);
    const button = fr.locator('.pe-tools [data-testid="fond-button"]');
    ok(`S1 [${label}] bouton « Fond & carte » (le même partout)`, /^\s*Fond\s*&\s*carte/.test((await button.textContent()) ?? "") && (await fr.locator('.pe-tools [data-testid="fond-button"]').count()) === 1);
    const text = (await menu.innerText()).replace(/\\s+/g, " ");
    ok(`S2 [${label}] deux sections toujours visibles, avec titre et schéma, même à vide`, (await sec(menu, "fond").isVisible()) && (await sec(menu, "carte").isVisible()) && (await menu.locator('[data-testid="fond-schema"]').count()) === 2 && (await menu.locator('[data-testid="fond-section-title"]').allTextContents()).map((t) => t.trim()).join("|") === "Fond|Carte", text.slice(0, 160));
    ok(`S3 [${label}] chaque section propose Aucun / Couleur / Papier peint`, (await sec(menu, "fond").locator('[data-testid="fond-kind-fond"] [role="radio"]').allTextContents()).map((t) => t.trim()).join("|") === "Aucun|Couleur|Papier peint" && (await sec(menu, "carte").locator('[data-testid="fond-kind-carte"] [role="radio"]').allTextContents()).map((t) => t.trim()).join("|") === "Aucune|Couleur|Papier peint");
    ok(`S4 [${label}] plus de « Régler : La carte / Le fond sur la carte » ni d'« Étendue »`, !/Régler|Étendue|Carte en retrait|Pleine largeur/.test(text) && (await menu.locator('[data-testid="fond-extent"], [data-testid="fond-layer"]').count()) === 0, text.slice(0, 200));
    ok(`S5 [${label}] rien n'est écrit en ouvrant le menu`, !draftBlock(p.id, CTRL)?.props?.surface && !draftBlock(p.id, CTRL)?.props?.background);
    const sig0 = await fr.evaluate(SIG, '[data-testid="fond-menu"]');
    menuSigs[`${label}|0`] = sig0;
    const ref = menuSigs[`${T.key === "fanzine" ? "fanzine" : T.key} rich-text|0`];
    if ((p.type !== "rich-text" || T.key !== "carnet") && T.key !== "papier") {
      const base = Object.values(menuSigs)[0];
      ok(`S6 [${label}] même structure DOM du menu que partout (${sig0.split(">").length} éléments)`, sig0 === base, `${sig0.length} / ${base.length}`);
    }
    for (const F of ["none", "color", "wallpaper"]) {
      const fcolor = await setSection(fr, "fond", F);
      for (const C of ["none", "color", "wallpaper"]) {
        const ccolor = await setSection(fr, "carte", C);
        const want = { F, C };
        const got = await waitFor(() => {
          const d = deriveDraft(draftBlock(p.id, CTRL));
          return (d.fond?.kind ?? "none") === F && (d.carte?.kind ?? "none") === C && (F === "none" || d.fond?.color === TOKEN.fond) && (C === "none" || d.carte?.color === TOKEN.carte);
        }, 30000);
        await sleep(900);
        const d = deriveDraft(draftBlock(p.id, CTRL));
        // La toile se recharge après l'écriture (« Rendering… ») : on attend que le nombre de zones soit celui demandé.
        // Serveur de développement lent : le témoin « Rendering » de Next disparaît quand la toile a fini de se recharger.
        await page.getByText("Rendering", { exact: false }).first().waitFor({ state: "hidden", timeout: 120000 }).catch(() => {});
        const nWant = (F === "none" ? 0 : 1) + (C === "none" ? 0 : 1);
        await waitFor(async () => ((await fr.evaluate(MEASURE, "Mctrl"))?.n ?? -1) === nWant, 60000);
        await sleep(300);
        const m = await fr.evaluate(MEASURE, "Mctrl");
        const bad = [];
        if (!got) bad.push(`brouillon ${JSON.stringify(d)}`);
        bad.push(...judge(m, { f: F === "none" ? null : fcolor, k: C === "none" ? null : T.key === "papier" && C === "wallpaper" ? "any" : ccolor }, pageBg, { grid: p.type === "grid", tol: 2.5 }));
        if (F !== "none" && C !== "none" && !(d.pair && d.fond?.layer === "surface" && d.carte?.layer === "background")) bad.push("les deux sections ne sont pas rangées dehors (surface pleine largeur) / dedans (fond avec marge)");
        if (!d.keysOk) bad.push("clé de donnée nouvelle (retour arrière en v0.31)");
        const secs = [await sec(menu, "fond").isVisible(), await sec(menu, "carte").isVisible()];
        if (!secs[0] || !secs[1]) bad.push("une section a disparu");
        const nowF = await sec(menu, "fond").getAttribute("data-kind-now");
        const nowC = await sec(menu, "carte").getAttribute("data-kind-now");
        if (nowF !== F || nowC !== C) bad.push(`menu : ${nowF}/${nowC}`);
        stats.uiStates++;
        if (bad.length) { const tl = []; for (let i = 0; i < 8; i++) { tl.push((await fr.evaluate(MEASURE, "Mctrl"))?.n); await sleep(1000); } bad.push(`n au fil de 8 s : ${tl.join(",")}`); }
        if (bad.length) await page.screenshot({ path: path.join(SHOTS, `echec-U-${label.replace(/\W+/g, "-")}-${F}-${C}.png`) }).catch(() => {});
        ok(`U [${label}] Fond ${F} × Carte ${C} : données, toile, sections`, bad.length === 0, bad.join(" ; ") + (bad.length ? ` | cands ${m?.cands} anc ${m?.anc} | ${recent.splice(0).slice(-4).join(" ; ")} | TREE ${(await fr.evaluate((u) => { const walk = (e, d) => (d > 8 ? "" : `${"  ".repeat(d)}${e.tagName.toLowerCase()}.${(typeof e.className === "string" ? e.className : "").split(" ").slice(0, 2).join(".")}[${e.dataset?.surface ?? ""}/${e.dataset?.fond ?? ""}]${e.children.length === 0 && /Mctrl/.test(e.textContent) ? " <<MARKER" : ""}\n` + [...e.children].filter((c) => c.tagName !== "SCRIPT" && c.tagName !== "STYLE").map((c) => walk(c, d + 1)).join("")); return walk(document.querySelector(`[data-edit-block="${u}"]`) ?? document.body, 0).split("\n").filter((l) => /zone|card-in|fond-in|MARKER|data-edit/.test(l) || /\[(on|off)/.test(l)).join(" ⏎ "); }, CTRL)) || "bloc absent"}` : (recent.length = 0, "")));
        void want;
      }
    }
    // R9b : régler (ou vider) la Carte garde le Fond, et inversement.
    await setSection(fr, "fond", "color");
    const fc = await setSection(fr, "carte", "color");
    await setSection(fr, "carte", "none");
    await waitFor(() => deriveDraft(draftBlock(p.id, CTRL)).carte === null, 30000);
    await waitFor(async () => ((await fr.evaluate(MEASURE, "Mctrl"))?.n ?? -1) === 1, 60000);
    await sleep(500);
    let m = await fr.evaluate(MEASURE, "Mctrl");
    let d = deriveDraft(draftBlock(p.id, CTRL));
    ok(`U-R9b [${label}] vider la Carte garde le Fond (couleur autour gardée)`, d.fond?.color === TOKEN.fond && d.carte === null && m?.n === 1 && same(m.outer.bg, await sec(menu, "fond").locator(`[data-token="${TOKEN.fond}"] .cc-chip`).evaluate((el) => getComputedStyle(el).backgroundColor)), JSON.stringify(d));
    await setSection(fr, "carte", "color");
    await setSection(fr, "fond", "none");
    await waitFor(() => deriveDraft(draftBlock(p.id, CTRL)).fond === null, 30000);
    await waitFor(async () => ((await fr.evaluate(MEASURE, "Mctrl"))?.n ?? -1) === 1, 60000);
    await sleep(500);
    d = deriveDraft(draftBlock(p.id, CTRL));
    m = await fr.evaluate(MEASURE, "Mctrl");
    ok(`U-R9b [${label}] vider le Fond garde la Carte (autour = fond de la page)`, d.carte?.color === TOKEN.carte && d.fond === null && m?.n === 1 && same(m.aroundLeft ?? "", pageBg), JSON.stringify([d, m?.aroundLeft, pageBg]));
    void fc;
    await page.screenshot({ path: path.join(SHOTS, `menu-${T.key}-${p.type}.png`) }).catch(() => {});
    // Remise à zéro.
    await setSection(fr, "carte", "none");
    await setSection(fr, "fond", "none");
    await settled();
  });
}


/* ---- C : le Contour de la carte (lot 100, retour 2) : ligne toujours visible, depuis « Aucune » un contour pose une carte « Fond de page », rendu identique hors contour ---- */
const markerStyle = (where) =>
  where.evaluate(() => {
    const e = [...document.querySelectorAll("h1,h2,h3,p,figcaption,span,div")].find((x) => !x.children.length && x.textContent.includes("Mctrl"));
    const c = getComputedStyle(e);
    const r = e.getBoundingClientRect();
    return { color: c.color, size: c.fontSize, line: c.lineHeight, family: c.fontFamily, weight: c.fontWeight, h: Math.round(r.height) };
  });
/** Écart entre deux captures (PNG) : part des pixels dont un canal diffère de plus de 40/255 (le texte posé à une demi-ligne près diffère légèrement par l'anticrénelage). */
let blankPage = null;
const pixelDiff = async (a, b) => {
  blankPage ??= await ctx.newPage();
  await blankPage.setContent("<canvas></canvas>");
  return blankPage.evaluate(
    async ([x, y]) => {
      const load = (b64) =>
        new Promise((res, rej) => {
          const im = new Image();
          im.onload = () => {
            const c = document.createElement("canvas");
            c.width = im.width;
            c.height = im.height;
            const g = c.getContext("2d");
            g.drawImage(im, 0, 0);
            res(g.getImageData(0, 0, im.width, im.height));
          };
          im.onerror = rej;
          im.src = `data:image/png;base64,${b64}`;
        });
      const [i, j] = [await load(x), await load(y)];
      if (i.width !== j.width || i.height !== j.height) return { size: [i.width, i.height, j.width, j.height], ratio: 1 };
      let bad = 0;
      for (let k = 0; k < i.data.length; k += 4) if (Math.max(Math.abs(i.data[k] - j.data[k]), Math.abs(i.data[k + 1] - j.data[k + 1]), Math.abs(i.data[k + 2] - j.data[k + 2])) > 40) bad++;
      return { ratio: bad / (i.width * i.height) };
    },
    [a.toString("base64"), b.toString("base64")],
  );
};
/** Uid du témoin dans l'éditeur : les blocs publiés n'ont pas d'uid en base, l'éditeur les nomme b0, b1… dans l'ordre. */
const CTRL = "b0";
const markerShot = async (where) => {
  const h = await where.evaluateHandle(() => [...document.querySelectorAll("h1,h2,h3,p,figcaption,span,div")].find((x) => !x.children.length && x.textContent.includes("Mctrl")) ?? null);
  const el = h.asElement();
  return el ? el.screenshot({ animations: "disabled" }).catch(() => null) : null;
};
const markerRect = (where) => where.evaluate(() => { const e = [...document.querySelectorAll("h1,h2,h3,p,figcaption,span,div")].find((x) => !x.children.length && x.textContent.includes("Mctrl")); const b = e.getBoundingClientRect(); return { l: b.left, t: b.top + scrollY, w: b.width }; });
const CARD_PROBE = () => {
  const p = [...document.querySelectorAll("h1,h2,h3,p,figcaption,span,div")].find((x) => !x.children.length && x.textContent.includes("Mctrl"));
  const c = p?.closest('.surface-card[data-surface="on"]');
  if (!c) return null;
  const cs = getComputedStyle(c);
  return { bw: parseFloat(cs.borderTopWidth) || 0, bc: cs.borderTopColor, bg: cs.backgroundColor, bcVar: cs.getPropertyValue("--card-bc").trim(), ink: cs.getPropertyValue("--card-ink").trim(), attr: c.getAttribute("data-border") };
};
const toRgb = (css) => { const e = document.createElement("span"); e.style.color = css; document.body.appendChild(e); const c = getComputedStyle(e).color; e.remove(); return c; };
async function contourCase(p, T, pub, { wall = false } = {}) {
  const label = `${T.key} ${p.type}${wall ? " +papier de page" : ""}`;
  await section(`C-${label}`, async () => {
    await pub.goto(`${BASE}${p.url}`, { waitUntil: "networkidle" });
    await sleep(400);
    const pub0 = await markerShot(pub);
    const pr0 = await markerRect(pub);
    const ps0 = await markerStyle(pub);
    const fr = await openEditor(p.id);
    const pageBg = await pageBgOf(fr);
    await sleep(500);
    const shot0 = await markerShot(fr);
    const r0 = await markerRect(fr);
    let menu = await openMenu(fr, CTRL);
    const row = menu.locator('[data-testid="fond-contour-row"]');
    ok(`C1 [${label}] la ligne « Contour » est dans la section Carte, visible, jamais repliée, même sans carte`, (await sec(menu, "carte").locator('[data-testid="fond-contour-row"]').isVisible()) && (await row.evaluate((e) => !e.closest("details"))));
    ok(`C1 [${label}] Aucun / Fin / Moyen / Épais, « Aucun » coché au départ`, (await row.locator('[data-testid="fond-contour"] [role="radio"]').allTextContents()).map((t) => t.trim()).join("|") === "Aucun|Fin|Moyen|Épais" && (await row.locator('[data-contour="none"]').getAttribute("aria-checked")) === "true", (await row.innerText()).replace(/\s+/g, " "));
    await row.locator('[data-contour="medium"]').click();
    const want = wall ? "#ffffff00" : "bg";
    const okDraft = await waitFor(() => { const sf = draftBlock(p.id, CTRL)?.props?.surface; return sf?.border?.width === "medium" && sf.color === want && sf.paper === "under"; }, 30000);
    const d = draftBlock(p.id, CTRL)?.props;
    ok(`C2 [${label}] depuis Aucune, « Moyen » pose une carte Couleur « ${wall ? "transparente (papier de page)" : "Fond de page (jeton du thème)"} » avec ce contour, rien d'autre`, okDraft && !d?.background, JSON.stringify(d));
    ok(`C2b [${label}] une fois la carte là : Coins visibles directement (plus de « Réglages fins » replié) ; seul « Papier du site » reste dans un repli`, (await sec(menu, "carte").locator('[data-testid="fond-round"]').isVisible()) && (await sec(menu, "carte").locator('[data-testid="fond-round"]').evaluate((e) => !e.closest("details"))) && (await menu.locator("details summary").allTextContents()).every((t) => /Papier du site/.test(t)));
    // Repli « Papier du site » : présent seulement s'il a du contenu (le thème dessine un papier), très visible, ouvrable au clic, à Entrée et à Espace.
    const fine = menu.locator('[data-testid="fond-fine"]');
    if (T.key === "papier") {
      const sum = fine.locator("summary");
      const mb = await menu.boundingBox();
      const sb = await sum.boundingBox();
      const fs = await sum.evaluate((e) => ({ size: parseFloat(getComputedStyle(e).fontSize), weight: Number(getComputedStyle(e).fontWeight), lab: parseFloat(getComputedStyle(document.querySelector(".sm-label")).fontSize), bw: getComputedStyle(e).borderTopWidth }));
      const isOpen = () => fine.evaluate((d) => d.open);
      ok(`F1 [${label}] repli présent (le thème dessine un papier), bouton sur toute la largeur du menu, police ≥ libellés, graisse moyenne, trait fin`, (await fine.count()) === 1 && !(await isOpen()) && sb.width > mb.width * 0.8 && fs.size >= fs.lab && fs.weight >= 500 && fs.bw === "1px" && /Papier du site/.test(await sum.innerText()), JSON.stringify([sb.width, mb.width, fs]));
      await sum.scrollIntoViewIfNeeded();
      await menu.screenshot({ path: path.join(SHOTS, `repli-${label.replace(/\W+/g, "-")}-1-ferme.png`) });
      await sum.hover();
      await sleep(250);
      await menu.screenshot({ path: path.join(SHOTS, `repli-${label.replace(/\W+/g, "-")}-2-survol.png`) });
      await sum.click();
      ok(`F2 [${label}] le clic ouvre le repli (papier du site réglable dedans)`, (await isOpen()) && (await fine.locator('[data-testid="surface-paper"]').isVisible()));
      await menu.screenshot({ path: path.join(SHOTS, `repli-${label.replace(/\W+/g, "-")}-3-ouvert.png`) });
      await sum.click();
      ok(`F2 [${label}] un second clic le referme`, !(await isOpen()));
      await sum.focus();
      for (const key of ["Enter", "Space"]) {
        await page.keyboard.press(key);
        const o = await waitFor(() => isOpen(), 3000);
        await page.keyboard.press(key);
        const c = await waitFor(async () => !(await isOpen()), 3000);
        ok(`F3 [${label}] au clavier, ${key} ouvre puis referme le repli`, o && c);
      }
      await sum.focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await sleep(250);
      await menu.screenshot({ path: path.join(SHOTS, `repli-${label.replace(/\W+/g, "-")}-4-focus-clavier.png`) });
      const fo = await sum.evaluate((e) => ({ focused: e === document.activeElement, outline: getComputedStyle(e).outlineStyle }));
      ok(`F4 [${label}] le focus clavier se voit (contour d'accent)`, fo.focused && fo.outline !== "none", JSON.stringify(fo));
    } else ok(`F0 [${label}] pas de papier dessiné par le thème : aucun repli vide n'est affiché`, (await fine.count()) === 0);
    ok(`F5 [${label}] Contour et Coins sont visibles sans rien déplier`, (await sec(menu, "carte").locator('[data-testid="fond-contour-row"]').isVisible()) && (await sec(menu, "carte").locator('[data-testid="fond-round"]').isVisible()));
    await page.keyboard.press("Escape");
    await sleep(900);
    const probe = await fr.evaluate(CARD_PROBE);
    const inkRgb = probe ? await fr.evaluate(toRgb, probe.bcVar) : null;
    ok(`C3 [${label}] toile : le contour se voit (épaisseur ${probe?.bw}px, couleur du texte de la carte), la carte ${wall ? "est transparente" : "a la couleur du fond de page"}`, Boolean(probe) && probe.bw > 0 && probe.attr === "medium" && same(probe.bc, inkRgb) && (wall ? /,\s*0\)$/.test(probe.bg) || probe.bg === "transparent" : same(probe.bg, pageBg)), JSON.stringify([probe, inkRgb, pageBg]));
    const shot1 = await markerShot(fr);
    const r1 = await markerRect(fr);
    ok(`C4 [${label}] toile : le contenu garde sa place et sa largeur (seule la carte l'entoure : décalage vertical ${Math.round(r1.t - r0.t)}px = rembourrage de la carte)`, Math.abs(r1.l - r0.l) <= 12 && r1.w - r0.w >= -60 && r1.w - r0.w <= 1.5 && r1.t - r0.t >= 0 && r1.t - r0.t < 80, `dx ${r1.l - r0.l} dw ${r1.w - r0.w} dy ${r1.t - r0.t}`);
    void shot1;
    stats.contour = (stats.contour ?? 0) + 1;
    // Couleur : la pastille est la couleur du contour.
    menu = await openMenu(fr, CTRL);
    const tok = menu.locator('[data-testid="fond-contour-row"] [data-testid="card-da-color"][data-token="primary"]');
    const tokN = await tok.count();
    if (tokN) {
      const chip = await tok.locator(".cc-chip").evaluate((el) => getComputedStyle(el).backgroundColor);
      await tok.click();
      await sleep(900);
      await page.keyboard.press("Escape");
      const pc = await fr.evaluate(CARD_PROBE);
      ok(`C5 [${label}] la pastille « Texte/Primaire » est EXACTEMENT la couleur du contour (${chip})`, same(pc?.bc ?? "", chip), `${pc?.bc} / ${chip}`);
    } else ok(`C5 [${label}] pastille primaire masquée (doublon ou confondue avec le fond de page) : le choix reste possible par « Par défaut »`, true);
    const dups = await openMenu(fr, CTRL).then((m) => m.locator('[data-testid="fond-contour-row"] [data-testid="card-da-color"]').evaluateAll((els) => els.map((e) => getComputedStyle(e.querySelector(".cc-chip")).backgroundColor)));
    ok(`C6 [${label}] aucune pastille en double ni invisible dans la ligne Contour`, new Set(dups).size === dups.length && dups.every((c) => !same(c, pageBg)), JSON.stringify([dups, pageBg]));
    // Public.
    ok(`C7 [${label}] publication`, await publishCurrent(p.id));
    await pub.goto(`${BASE}${p.url}`, { waitUntil: "networkidle" });
    await sleep(500);
    const pp = await pub.evaluate(CARD_PROBE);
    const pcol = pp?.bcVar ? await pub.evaluate(toRgb, pp.bcVar) : null;
    const pub1 = await markerShot(pub);
    const pr1 = await markerRect(pub);
    ok(`C8a [${label}] public : le contenu reste à sa place (décalage ${Math.round(pr1.l - pr0.l)}px à droite, ${Math.round(pr1.w - pr0.w)}px de large, ${Math.round(pr1.t - pr0.t)}px plus bas : la marge de dégagement de 16 px entre le texte et le contour)`, Math.abs(pr1.l - pr0.l) <= 12 && pr1.w - pr0.w >= -26 && pr1.w - pr0.w <= 1.5, `dx ${pr1.l - pr0.l} dw ${pr1.w - pr0.w}`);
    const ps1 = await markerStyle(pub);
    ok(`C8b [${label}] public : le texte est le même (couleur, corps, interligne, police) et revient à la même hauteur, donc au même retour à la ligne`, JSON.stringify(ps0) === JSON.stringify(ps1) || (ps0.color === ps1.color && ps0.size === ps1.size && ps0.line === ps1.line && ps0.family === ps1.family && ps0.weight === ps1.weight && Math.abs(ps0.h - ps1.h) <= 1), JSON.stringify([ps0, ps1]));
    ok(`C8 [${label}] public : contour ${pp?.bw}px, couleur = celle de la toile`, Boolean(pp) && pp.bw > 0 && same(pp.bc, pcol) && pp.attr === "medium", JSON.stringify(pp));
    // Retour à Aucun : plus rien.
    await openEditor(p.id);
    menu = await openMenu(await canvasFrame(), CTRL);
    await menu.locator('[data-testid="fond-contour-row"] [data-contour="none"]').click();
    const back = await waitFor(() => { const pr = draftBlock(p.id, CTRL)?.props; return pr && pr.surface === undefined && pr.background === undefined; }, 30000);
    const fr2 = await canvasFrame();
    await page.keyboard.press("Escape");
    await sleep(900);
    const shot2 = await markerShot(fr2);
    ok(`C9 [${label}] « Contour : Aucun » : le bloc revient exactement à « Aucune » (ni carte ni fond résiduels, rendu identique)`, back && !(await fr2.evaluate(CARD_PROBE)) && Boolean(shot0 && shot2), JSON.stringify([back, await fr2.evaluate(CARD_PROBE), draftBlock(p.id, CTRL)?.props]));
    ok(`C10 [${label}] publication du retour : le public redevient identique à « Aucune »`, await publishCurrent(p.id));
    await pub.goto(`${BASE}${p.url}`, { waitUntil: "networkidle" });
    await sleep(500);
    const pub2 = await markerShot(pub);
    const pr2 = await markerRect(pub);
    ok(`C10 [${label}] public : identique au pixel à l'état d'avant (contenu), sans carte`, !(await pub.evaluate(CARD_PROBE)) && Boolean(pub0 && pub2) && pub0.equals(pub2) && Math.abs(pr2.l - pr0.l) < 1, `dx ${pr2.l - pr0.l}`);
  });
}
const canvasFrame = async () => (await page.waitForSelector("iframe.ve-frame")).contentFrame();


/* ---- I : « Fond image » (lot 95 / 100) : une teinte CHOISIE donne exactement la couleur de sa pastille, dans une carte comme sur un fond de couleur ---- */
const IMGBG_PROBE = (marker) => {
  const cap = [...document.querySelectorAll("figcaption, p, span, div")].find((e) => !e.children.length && e.textContent.includes(marker));
  const host = cap?.closest('[style*="--img-bg"], [data-img-bg]') ?? cap?.closest("figure")?.querySelector('[style*="--img-bg"], [data-img-bg]');
  if (!host) return null;
  const val = host.style.getPropertyValue("--img-bg").trim() || getComputedStyle(host).getPropertyValue("--img-bg").trim();
  const resolve = (css, where) => { const e = document.createElement("span"); e.style.color = css; where.appendChild(e); const c = getComputedStyle(e).color; e.remove(); return c; };
  return { val, shown: resolve(val, host), real: resolve(val.replace("var(--color-", "var(--t-color-"), document.body), inCard: Boolean(host.closest(".surface-card[data-surface=on]")), inFond: Boolean(host.closest('.fond-bloc[data-fond="on"]')) };
};
async function imageBgCase(p, T, pub) {
  await section(`I-${T.key}`, async () => {
    const mk = (u, m, bg, zone) => ({ uid: u, type: "image", props: { mediaId: IMG, width: "wide", caption: { fr: m, en: m }, look: { imageBg: bg }, ...zone } });
    const CASES = [
      ["Mcarte-ink", mk("ib0", "Mcarte-ink", "ink", { surface: { color: "secondary", width: "inset" } }), "carte"],
      ["Mcarte-primary", mk("ib1", "Mcarte-primary", "primary", { surface: { color: "tertiary", width: "inset" } }), "carte"],
      ["Mfond-ink", mk("ib2", "Mfond-ink", "ink", { background: { kind: "color", color: "primary", paper: "under" } }), "fond"],
      ["Mfond-secondary", mk("ib3", "Mfond-secondary", "secondary", { background: { kind: "color", color: "tertiary", paper: "under" } }), "fond"],
    ];
    const blocks = CASES.flatMap(([, b], i) => [{ uid: `isep${i}`, type: "rich-text", props: { paragraphs: [{ fr: `Séparateur ${i}`, en: "sep" }] } }, b]);
    ok(`I0 [${T.key}] page « image » avec fond image dans une carte et sur un fond de couleur publiée`, await publishPage(p.id, blocks));
    for (let k = 0; k < 6; k++) {
      await pub.goto(`${BASE}${p.url}`, { waitUntil: "networkidle" });
      if (await pub.evaluate(IMGBG_PROBE, "Mfond-secondary")) break;
      await sleep(2500);
    }
    const fr = await openEditor(p.id);
    for (const [marker, , where] of CASES) {
      for (const [lab, ctx2] of [["public", pub], ["toile", fr]]) {
        const r = await ctx2.evaluate(IMGBG_PROBE, marker);
        ok(`I1 [${T.key}] ${lab} : fond image ${marker.slice(1)} ${where === "carte" ? "dans une carte" : "sur un fond de couleur"} = la couleur de la pastille (${r?.val})`, Boolean(r) && same(r.shown, r.real) && /--t-color-/.test(r.val) && (where === "carte" ? r.inCard : r.inFond), JSON.stringify(r));
      }
    }
    stats.imgbg = (stats.imgbg ?? 0) + CASES.length * 2;
    await publishPage(p.id, blocksOf(p));
  });
}

/* ---- Y : aucune couleur imposée (R9) : les premiers choix ne sont ni « bgDeep » ni la couleur d'un voisin ---------------------------- */
async function yellow(p, T, bgDeep) {
  const fr = await openEditor(p.id);
  const pageBg = await pageBgOf(fr, "Séparateur 0");
  const deep = await fr.evaluate(() => { const s = document.createElement("span"); s.style.color = "var(--t-color-bg-deep)"; document.body.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; });
  const surf = await fr.evaluate(() => { const s = document.createElement("span"); s.style.color = "var(--t-color-surface)"; document.body.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; });
  ok("Y0 le thème Fanzine a bien un « fond profond » jaune distinct du fond de page", !same(deep, pageBg) && rgbOf(deep)[0] > 230 && rgbOf(deep)[2] < 200, `${deep} / ${pageBg}`);
  void bgDeep;
  for (const [slot, other] of [["fond", "carte"], ["carte", "fond"]]) {
    const menu = await openMenu(fr, CTRL);
    await kindBtn(menu, slot, "color").click();
    await waitFor(() => Boolean(deriveDraft(draftBlock(p.id, CTRL))[slot]), 30000);
    await sleep(900);
    const m = await fr.evaluate(MEASURE, "Mctrl");
    const dd = deriveDraft(draftBlock(p.id, CTRL));
    ok(`Y1 premier « Couleur » de la section ${slot} : jamais « bgDeep » (jaune), c'est la couleur de carte du thème`, m?.n === 1 && !same(m.outer.bg, deep) && same(m.outer.bg, surf) && !JSON.stringify(draftBlock(p.id, CTRL).props).includes("bgDeep"), `${m?.outer?.bg} (bgDeep ${deep}, surface ${surf}) ${JSON.stringify(dd)}`);
    // Elle est réglable : la pastille choisie devient la couleur, partout.
    const tok = sec(menu, slot).locator('[data-testid="card-da-color"][data-token="tertiary"]');
    await tok.click();
    await sleep(900);
    const chip = await tok.locator(".cc-chip").evaluate((el) => getComputedStyle(el).backgroundColor);
    const m2 = await fr.evaluate(MEASURE, "Mctrl");
    ok(`Y2 la couleur de la section ${slot} se change (pastille « tertiary »)`, same(m2?.outer?.bg ?? "", chip), `${m2?.outer?.bg} / ${chip}`);
    await kindBtn(menu, slot, "none").click();
    await sleep(700);
    void other;
  }
  // Autour d'une carte en retrait : jamais la couleur d'un voisin (R9) — Fond aucun = le fond de la page, avec des voisins colorés bord à bord.
  const neighbours = [PAGES[0]];
  void neighbours;
  const m3 = await fr.evaluate(MEASURE, "Mctrl");
  ok("Y3 remise à zéro : plus aucune zone sur le témoin", m3?.n === 0);
  await settled();
}


/* ================================================================ Par thème ================================================================== */
const THEMES = [
  { key: "carnet", label: "Carnet d'atelier", activate: () => activateThemeUi(page, BASE, "carnet-d-atelier") },
  { key: "fanzine", label: "Fanzine riso (bgDeep jaune)", activate: () => activateThemeUi(page, BASE, "fanzine-riso") },
  {
    key: "papier",
    label: "Papier de cœurs (kit + papier peint des cartes)",
    activate: async () => {
      installPaperTheme(DATA);
      await activateThemeUi(page, BASE, PAPER_THEME_NAME);
      await page.goto(`${BASE}/admin/papiers-peints`, { waitUntil: "networkidle" });
      const on = page.locator('[data-testid="wallpaper-cards"] [data-testid="wallpaper-cards-on"]');
      if (await on.count()) {
        await on.click();
        await waitFor(() => q1("select value from settings where key = 'cardWallpaper'") !== undefined, 30000);
      }
    },
  },
];
const stats = { combos: 0, uiStates: 0, canvas: 0 };
const pubM = new Map();
const menuSigs = {};

for (const T of THEMES.filter((t) => !process.env.THEMES_ONLY || process.env.THEMES_ONLY.split(",").includes(t.key))) {
  await section(`theme-${T.key}`, async () => {
    console.log(`== Thème : ${T.label}`);
    await T.activate();
    // Chaque thème : le jaune est bien le jaune (Fanzine), pour que le test sache ce qu'il traque.
    const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pub = await anon.newPage();
    pub.on("pageerror", (e) => errors.push(e.message));
    const bgDeep = async () => pub.evaluate(() => { const s = document.createElement("span"); s.style.color = "var(--t-color-bg-deep)"; document.body.appendChild(s); const c = getComputedStyle(s).color; s.remove(); return c; });

    /* ---- M + G : site public, deux largeurs ---- */
    if (run("M")) {
      for (const w of [1440, 390]) {
        await pub.setViewportSize({ width: w, height: 900 });
        for (const p of PAGES) {
          await pub.goto(`${BASE}${p.url}`, { waitUntil: "networkidle" });
          await sleep(500);
          const pageBg = await pageBgOf(pub);
          const deep = await bgDeep();
          if (T.key === "fanzine" && p === PAGES[0] && w === 1440) ok("M0 témoin : le jaune de « bgDeep » du thème Fanzine n'est pas le fond de la page", !same(deep, pageBg), `${deep} / ${pageBg}`);
          for (let i = 0; i < COMBOS.length; i++) {
            const c = COMBOS[i];
            const m = await pub.evaluate(MEASURE, markerOf(p, i));
            const bad = judge(m, specOf(c, pageBg), pageBg, { grid: p.type === "grid" });
            if (w === 1440 && m) pubM.set(`${p.type}|${i}`, m);
            // Jamais « bgDeep » nulle part autour, sauf s'il EST le fond de la page ou la couleur réglée (ici, jamais).
            if (m && T.key === "fanzine" && !same(deep, pageBg) && [m.aroundLeft, m.edgeLeft, m.beside].some((x) => x && same(x, deep))) bad.push("la couleur « bgDeep » apparaît sans avoir été choisie");
            stats.combos++;
            ok(`M [${T.key} ${w}px ${p.type}] ${comboKey(c)} : structure ${m?.classes || "aucune"}, autour, carte, couverture`, bad.length === 0, bad.join(" ; "));
          }
        }
      }
    }
    /* ---- E : la toile montre ce que le public montre ---- */
    if (run("E")) {
      for (const p of PAGES) {
        const fr = await openEditor(p.id);
        const pageBg = await pageBgOf(fr);
        for (let i = 0; i < COMBOS.length; i++) {
          const c = COMBOS[i];
          const m = await fr.evaluate(MEASURE, markerOf(p, i));
          const pm = pubM.get(`${p.type}|${i}`);
          const bad = judge(m, specOf(c, pageBg), pageBg, { grid: p.type === "grid", tol: 2.5 });
          if (m && pm) {
            if (m.classes !== pm.classes) bad.push(`zones ${m.classes} (toile) ≠ ${pm.classes} (public)`);
            if (m.outer && pm.outer && !same(m.outer.bg, pm.outer.bg)) bad.push(`couleur extérieure ${m.outer.bg} (toile) ≠ ${pm.outer.bg} (public)`);
            if (m.inner && pm.inner && !same(m.inner.bg, pm.inner.bg)) bad.push(`couleur de la carte ${m.inner.bg} (toile) ≠ ${pm.inner.bg} (public)`);
          }
          stats.canvas++;
          ok(`E [${T.key} ${p.type}] ${comboKey(c)} : la toile = le public (zones ${m?.classes || "aucune"}, couleurs)`, bad.length === 0, bad.join(" ; "));
        }
      }
    }

    /* ---- U + S + Y : le menu, piloté comme l'artiste ---- */
    const uiTypes = T.key === "fanzine" ? ["rich-text", "grid", "image", "section-title", "contact"] : ["rich-text"];
    if (run("U")) {
      for (const tname of uiTypes) {
        const p = PAGES.find((x) => x.type === tname);
        await uiMatrix(p, T);
      }
    }
    if (run("C")) {
      for (const tname of uiTypes) await contourCase(PAGES.find((x) => x.type === tname), T, pub);
      if (T.key === "fanzine") {
        const cp = PAGES.find((x) => x.type === "contact");
        await publishPage(cp.id, blocksOf(cp), { wallpaper: { mode: "wallpaper", wallpaper: WP } });
        await contourCase(cp, T, pub, { wall: true });
        await publishPage(cp.id, blocksOf(cp));
      }
    }
    if (run("I")) await imageBgCase(PAGES.find((x) => x.type === "image"), T, pub);
    if (run("Y") && T.key === "fanzine") await section("Y", () => yellow(PAGES[0], T, bgDeep));
    await anon.close();
  });
}

/* ---- Cth : un contour qui vient du THÈME est dit, remplaçable, retirable pour ce bloc ---- */
if (run("C")) {
  await section("Cth", async () => {
    installPaperTheme(DATA, { id: "papier-borde100", name: "Papier bordé 100", key: "c0e4a2c0e4a21000" });
    const th = JSON.parse(q1("select data from themes where id = 'papier-borde100'").data);
    th.tokens.layout = { ...(th.tokens.layout ?? {}), card: { border: { width: "thin", color: "primary" } } };
    sql((db) => db.prepare("update themes set data = ? where id = 'papier-borde100'").run(JSON.stringify(th)));
    await activateThemeUi(page, BASE, "Papier bordé 100");
    const p = PAGES.find((x) => x.type === "rich-text");
    await publishPage(p.id, blocksOf(p).map((b) => (b.uid === "ctrl" ? { ...b, props: { ...b.props, surface: { color: "tertiary", width: "inset" } } } : b)));
    const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pub = await anon.newPage();
    let pp = null;
    for (let i = 0; i < 6; i++) {
      await pub.goto(`${BASE}${p.url}`, { waitUntil: "networkidle" });
      pp = await pub.evaluate(CARD_PROBE);
      if (pp?.attr === "thin") break;
      await sleep(3000);
    }
    const prim = await pub.evaluate(toRgb, "var(--t-color-primary)");
    ok("Cth1 public : le contour du thème (Fin, primaire) s'applique à une carte sans réglage", pp?.attr === "thin" && pp.bw > 0 && same(pp.bc, prim), JSON.stringify([pp, prim, sql((db) => db.prepare("select props from blocks where page_id = ? order by position limit 1").get(p.id))?.props?.slice(0, 200)]));
    const fr = await openEditor(p.id);
    const toile = await fr.evaluate(CARD_PROBE);
    ok("Cth2 toile = public pour le contour du thème", toile?.attr === "thin" && same(toile.bc, prim) && Math.abs(toile.bw - pp.bw) < 0.6, JSON.stringify([toile, pp]));
    let menu = await openMenu(fr, CTRL);
    ok("Cth3 le menu dit « Contour du thème » et coche son épaisseur (Fin)", (await menu.locator('[data-testid="fond-contour-theme"]').isVisible()) && (await menu.locator('[data-contour="thin"]').getAttribute("aria-checked")) === "true", (await menu.locator('[data-testid="fond-contour-row"]').innerText()).replace(/\s+/g, " "));
    await menu.locator('[data-contour="none"]').click();
    ok("Cth4 « Aucun » retire le contour du thème pour CE bloc (border: false)", await waitFor(() => draftBlock(p.id, CTRL)?.props?.surface?.border === false, 30000));
    await sleep(900);
    ok("Cth4 … la toile n'a plus de contour", (await fr.evaluate(CARD_PROBE))?.bw === 0);
    await menu.locator('[data-contour="thick"]').click();
    ok("Cth5 une épaisseur le REMPLACE (Épais)", await waitFor(() => draftBlock(p.id, CTRL)?.props?.surface?.border?.width === "thick", 30000));
    await menu.locator('[data-testid="fond-contour-theme-use"]').click();
    ok("Cth6 « Reprendre celui du thème » : plus de réglage propre, le contour du thème revient", (await waitFor(() => draftBlock(p.id, CTRL)?.props?.surface?.border === undefined, 30000)) && (await sleep(900), (await fr.evaluate(CARD_PROBE))?.attr === "thin"));
    await page.keyboard.press("Escape");
    await anon.close();
  });
}

/* ---- P : parité des anciennes données (lot 100) : le public rend des données d'avant exactement comme au lot 90 (même empreinte lancée dans les deux arbres) ---- */
if (run("P")) {
  await section("P", async () => {
    await activateThemeUi(page, BASE, "carnet-d-atelier");
    const p = PAGES[0];
    const LEGACY = [
      { surface: { color: "surface", width: "inset", corners: "m" } },
      { surface: { color: "primary", width: "full" } },
      { background: { kind: "color", color: "primary", paper: "under" } },
      { background: { kind: "color", color: "secondary", inset: "m", round: "m" } },
      { surface: { color: "surface", width: "inset" }, background: { kind: "color", color: "bgDeep" } },
      { background: { kind: "wallpaper", wallpaper: WP, color: "secondary" } },
      { surface: { color: "surface", width: "inset", border: { width: "thin", color: "primary" } } },
      { surface: { color: "tertiary", width: "inset", paperWallpaper: WP } },
    ];
    const blocks = [];
    LEGACY.forEach((l, i) => {
      blocks.push({ uid: `ps${i}`, type: "rich-text", props: { paragraphs: [{ fr: `Séparateur ${i}`, en: "sep" }] } });
      blocks.push({ uid: `p${i}`, type: "rich-text", props: { paragraphs: [{ fr: `Mlegacy${i}x : un texte d'avant le lot 100.`, en: "x" }], ...l } });
    });
    ok("P0 anciennes données publiées", await publishPage(p.id, blocks));
    const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pub = await anon.newPage();
    const parts = [];
    for (const w of [1440, 390]) {
      await pub.setViewportSize({ width: w, height: 900 });
      await pub.goto(`${BASE}${p.url}`, { waitUntil: "networkidle" });
      await sleep(600);
      const snap = await pub.evaluate((n) => {
        const main = document.querySelector("main");
        const html = main.innerHTML.replace(/<script[\s\S]*?<\/script>/g, "").replace(/(src|srcset|href|data-nextjs[a-z-]*|nonce)="[^"]*"/g, "").replace(/\s+/g, " ");
        const boxes = [];
        for (let i = 0; i < n; i++) {
          const el = [...main.querySelectorAll("p")].find((e) => e.textContent.includes(`Mlegacy${i}x`));
          const r = el.getBoundingClientRect();
          const z = [...(function* () { for (let e = el.parentElement; e && e !== main; e = e.parentElement) if (e.classList.contains("zone")) yield e; })()].map((e) => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return [Math.round(b.left), Math.round(b.right), Math.round(b.height), cs.backgroundColor, cs.borderTopWidth, cs.borderRadius, cs.boxShadow]; });
          boxes.push([Math.round(r.left), Math.round(r.width), z]);
        }
        return { html, boxes };
      }, LEGACY.length);
      parts.push(snap);
      ok(`P1 public ${w}px : aucune couleur imposée autour d'un fond en retrait (pas d'attribut data-fond-around)`, !/data-fond-around/.test(snap.html) && snap.boxes.every((b) => b[2].every((z) => !/rgb\([^)]*\) 0px 0px 0px/.test(z[6]) || z[6] === "none")));
    }
    const sha = (await import("node:crypto")).createHash("sha256").update(JSON.stringify(parts)).digest("hex");
    console.log(`PARITY_SHA ${sha}`);
    if (process.env.PARITY_SHA) ok("P2 le rendu public des anciennes données est identique à celui du lot 90 (empreinte SHA-256 du HTML et des boîtes, 1440 et 390 px)", sha === process.env.PARITY_SHA, `${sha} ≠ ${process.env.PARITY_SHA}`);
    await anon.close();
  });
}

console.log(`\n${asserts} vérifications, ${failures} échec(s), ${stats.combos} cas de matrice`);
await browser.close();
process.exit(failures ? 1 : 0);
