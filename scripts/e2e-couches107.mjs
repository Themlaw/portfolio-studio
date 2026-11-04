#!/usr/bin/env node
/**
 * Couches (lot 107) : un Fond en retrait DANS une Carte reste modifiable sans rien perdre ; marge extérieure / espacement intérieur ; largeur du bloc.
 * UN chromium, serveur requis, base NEUVE, une connexion admin. Données SYNTHÉTIQUES. Aucune attente fixe : des conditions.
 *   A : le bloc réel (surface = carte verte à contour, background = papier peint avec retrait « l ») + variantes (retrait s / m, couleur) : chaque
 *       réglage du menu « Fond & carte » ne touche que SA couche (données ET rendu mesuré), sans réécriture à l'ouverture ;
 *   B : largeur du bloc (pleine / large / moyenne / étroite) × types de blocs, effet mesuré, éditeur = public ;
 *   C : marge extérieure (la page se voit) / espacement intérieur (le fond le couvre) × (Fond papier peint, Carte, aucun) × (haut, bas, côtés) ;
 *   D : les réglages de la barre (Marge, Espacement), rechargement, publication, journal.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=A,B,C,D] node scripts/e2e-couches107.mjs
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";
import sharp from "sharp";

import { paint } from "./lib/crop-fixtures.mjs";
import { login, q1, waitFor } from "./lib/medias-setup.mjs";
import { publishBlocks } from "./lib/page-draft.mjs";

const BASE = process.env.BASE ?? "http://localhost:4600";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const DATA = process.env.DATA_DIR ?? "data";
const SHOTS = process.env.SHOTS ?? path.join(DATA, "..", "shots-couches107");
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
const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log(`# pageerror ${e.message.slice(0, 200)}`));
await login(page, BASE);

const FIX = mkdtempSync(path.join(tmpdir(), "pf-couches107-"));
await page.request.post(`${BASE}/admin/api/upload`, { headers: { origin: BASE }, multipart: { file: { name: "107-image.png", mimeType: "image/png", buffer: await paint(1200, 800, 3) } }, timeout: 180000 });
await waitFor(() => q1("select status from media where original_name = '107-image.png'")?.status === "ready", 180000);
const IMG = q1("select id from media where original_name = '107-image.png'")?.id;
// Un motif inventé de la bibliothèque.
await page.goto(`${BASE}/admin/papiers-peints`, { waitUntil: "domcontentloaded" });
await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><g fill="#e07a9a"><circle cx="60" cy="60" r="26"/><circle cx="180" cy="180" r="26"/></g></svg>')).png().toFile(path.join(FIX, "pois107.png"));
await page.locator('[data-testid="wallpaper-input"]').setInputFiles([path.join(FIX, "pois107.png")]);
await waitFor(async () => (await page.locator('[data-testid="wallpaper"][data-status="ready"]').count()) >= 1, 120000);
const WP = q1("select id from wallpapers order by id desc limit 1")?.id ?? 1;

const idOf = (slug) => q1("select id from pages where json_extract(slug, '$.fr') = ?", slug)?.id;
const PAGES = { accueil: q1("select id from pages where json_extract(slug, '$.fr') = ''")?.id, personnages: idOf("personnages"), decors: idOf("decors"), animation: idOf("animation"), apropos: idOf("a-propos") };
const SLUG = { accueil: "", personnages: "personnages", decors: "decors", animation: "animation", apropos: "a-propos" };
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
const draftRow = (pageId) => q1("select draft from pages where id = ?", pageId)?.draft;
const draftOf = (pageId) => {
  const d = draftRow(pageId);
  return d ? JSON.parse(d).blocks : [];
};
const blockOf = (pageId, marker) => draftOf(pageId).find((b) => JSON.stringify(b.props).includes(marker));
const savedBlocks = (pageId) => sql((db) => db.prepare("select type, props from blocks where page_id = ? order by position").all(pageId)).map((b) => ({ type: b.type, props: JSON.parse(b.props) }));
const published = (pageId) => draftRow(pageId) === null;
async function publishWith(pageId, blocks) {
  await page.goto("about:blank");
  const ready = () => published(pageId) && savedBlocks(pageId).length === blocks.length;
  const end = Date.now() + 240000;
  while (Date.now() < end) {
    const done = await publishBlocks(page, BASE, pageId, () => blocks, ready, 60000).catch(() => false);
    if (done) return true;
    console.log(`# publishWith ${pageId} : nouvel essai`);
  }
  return false;
}
async function publishCurrentFromEditor(pid) {
  const btn = page.getByRole("button", { name: "Publier", exact: true });
  await btn.waitFor({ timeout: 60000 });
  await btn.click();
  const confirm = page.locator("dialog[open]").getByRole("button", { name: "Mettre en ligne" });
  if (await confirm.waitFor({ timeout: 3000 }).then(() => true, () => false)) await confirm.click();
  return until(() => published(pid), 120000);
}
const urlOf = (slug) => `${BASE}/fr${slug ? `/${slug}` : ""}`;
const until = async (fn, timeout = 60000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
};
const near = (a, b, tol = 2.5) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= tol;

/* ---------- Types de blocs et décors ---------- */
const TYPES = [
  { type: "rich-text", key: "texte", page: "personnages", mk: (m) => ({ paragraphs: [L(`${m} : un texte inventé assez long pour que le fond ait du contenu à entourer.`)] }) },
  { type: "grid", key: "grille", page: "decors", mk: (m) => ({ layout: "2", gap: "normal", align: "stretch", ratio: "auto", top: "gap", title: L(m), children: [{ uid: `${m.replace(/\W/g, "").toLowerCase()}a`, type: "image", props: { mediaId: IMG, width: "wide" } }, { uid: `${m.replace(/\W/g, "").toLowerCase()}b`, type: "image", props: { mediaId: IMG, width: "wide" } }] }) },
  { type: "image", key: "image", page: "animation", mk: (m) => ({ mediaId: IMG, width: "wide", caption: L(m) }) },
  { type: "section-title", key: "titre", page: "apropos", mk: (m) => ({ title: L(m), eyebrow: L("Section") }) },
  { type: "contact", key: "contact", page: "accueil", mk: (m) => ({ title: L(m), intro: L("Un mot inventé.") }) },
  { type: "collection-tiles", key: "entrees", page: "personnages", mk: (m) => ({ eyebrow: L("Entrées"), title: L(m), mode: "auto", size: "medium" }) },
];
const sepBlock = (n) => ({ uid: `sep${n}`, type: "rich-text", props: { paragraphs: [L(`SEP107x${n}x`)] } });
const REAL = {
  surface: { color: "#dbff91", corners: "m", border: { width: "medium", color: "#fd6593" }, paper: "under" },
  background: { kind: "wallpaper", wallpaper: WP, color: "primary12", inset: "l" },
};
const VARIANTS = [
  { id: "real", ...REAL },
  { id: "s-color", surface: REAL.surface, background: { kind: "color", color: "primary12", inset: "s" } },
  { id: "m-wall", surface: REAL.surface, background: { kind: "wallpaper", wallpaper: WP, inset: "m" } },
];
const ONLYT = process.env.ONLYT ?? "";
for (let i = TYPES.length - 1; i >= 0; i--) if (ONLYT && !ONLYT.split(",").includes(TYPES[i].key)) TYPES.splice(i, 1);
const mark = (t, v) => `M107${t.key}${v}x`;

/* ---------- Mesures (document de la toile ou du public) ---------- */
const ZONES = ({ target }) => {
  const el = typeof target === "string" ? document.querySelector(target) : null;
  if (!el) return null;
  const chain = [];
  for (let e = el; e && e.tagName !== "BODY"; e = e.parentElement) if (e.classList.contains("zone") && (e.dataset.surface === "on" || e.dataset.fond === "on")) chain.push(e);
  const zones = chain.reverse().map((e) => {
    const b = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return { cls: e.classList.contains("surface-card") ? "card" : e.hasAttribute("data-fond-panel") ? "panel" : "fond", l: b.left, r: b.right, t: b.top, b: b.bottom, bw: parseFloat(cs.borderTopWidth) || 0, radius: parseFloat(cs.borderTopLeftRadius) || 0, bg: cs.backgroundColor, bc: cs.borderTopColor, wp: e.hasAttribute("data-wallpaper") };
  });
  return { zones, vw: document.documentElement.clientWidth };
};
/** Marque l'élément portant `marker` et rend un sélecteur. */
const MARKER = (marker) => {
  const e = [...document.querySelectorAll("h1,h2,h3,p,figcaption,span,div")].filter((x) => !x.children.length && x.textContent.includes(marker)).at(-1);
  if (!e) return null;
  e.setAttribute("data-m107", marker);
  return `[data-m107="${marker}"]`;
};
/** Distances d'un bloc entre deux séparateurs : marge (dehors) / espacement (dedans), largeur. */
const METRICS = ({ mk, prev, next }) => {
  const f = (t) => [...document.querySelectorAll("h1,h2,h3,p,figcaption,span,div")].filter((x) => !x.children.length && x.textContent.includes(t)).at(-1);
  const m = f(mk), sp = f(prev), sn = f(next);
  if (!m || !sp || !sn) return null;
  let top = m;
  while (top.parentElement && !(top.parentElement.contains(sp) && top.parentElement.contains(sn))) top = top.parentElement;
  const zone = top.matches('.zone[data-surface="on"], .zone[data-fond="on"]') ? top : top.querySelector('.zone[data-surface="on"], .zone[data-fond="on"]');
  const shell = top.matches(".shell") ? top : top.querySelector(".shell");
  const r = (e) => e.getBoundingClientRect();
  const mr = r(m), spr = r(sp), snr = r(sn);
  const zr = zone ? r(zone) : null;
  const sr = shell ? r(shell) : null;
  return { dTop: mr.top - spr.bottom, dBottom: snr.top - mr.bottom, gapTop: zr ? zr.top - spr.bottom : null, gapBottom: zr ? snr.top - zr.bottom : null, H: zr?.height ?? null, W: zr?.width ?? null, zl: zr?.left ?? null, zr: zr?.right ?? null, sl: sr?.left ?? null, sw: sr?.width ?? null, pl: shell ? parseFloat(getComputedStyle(shell).paddingLeft) : null, ml: mr.left, xl: (() => { const q = document.createElement("i"); q.style.cssText = "position:absolute;visibility:hidden;height:var(--t-space-xl)"; document.body.append(q); const h = q.getBoundingClientRect().height; q.remove(); return h; })(), wp: zone ? zone.hasAttribute("data-wallpaper") || Boolean(zone.querySelector("[data-wallpaper]")) : false, vw: document.documentElement.clientWidth, sx: document.documentElement.scrollWidth };
};

/* ============================== Menu « Fond & carte » ============================== */
const sec = (menu, slot) => menu.locator(`[data-testid="fond-section-${slot}"]`);
async function selectByMarker(fr, marker, clickSel = ["section", ".block-grid", "figure", "img", "h2", "p"]) {
  const host = fr.locator("[data-edit-block]").filter({ hasText: marker }).last();
  await host.scrollIntoViewIfNeeded({ timeout: 20000 }).catch(() => {});
  const button = fr.locator('.pe-tools [data-testid="fond-button"]');
  for (const sel of clickSel) {
    const t = host.locator(sel).first();
    if (!(await t.count())) continue;
    await t.click({ position: { x: 6, y: 6 }, force: true }).catch(() => {});
    if (await button.waitFor({ timeout: 2500 }).then(() => true, () => false)) return host;
  }
  throw new Error(`bloc « ${marker} » : bouton « Fond & carte » introuvable`);
}
async function openMenuOn(fr, marker) {
  await selectByMarker(fr, marker);
  await fr.locator('.pe-tools [data-testid="fond-button"]').click();
  const menu = fr.locator('[data-testid="fond-menu"]').first();
  await menu.waitFor({ timeout: 20000 });
  return menu;
}
/** Un menu de la barre (« Marge » : width-button ; « Espacement » : space-button). */
async function openBarMenu(fr, marker, kind) {
  await selectByMarker(fr, marker);
  await fr.locator(`.pe-tools [data-testid="${kind}-button"]`).click();
  const menu = fr.locator(`[data-testid="${kind}-menu"]`).first();
  await menu.waitFor({ timeout: 20000 });
  return menu;
}
const flat = (o, p = "", out = {}) => {
  for (const [k, v] of Object.entries(o ?? {})) {
    if (v && typeof v === "object" && !Array.isArray(v)) flat(v, `${p}${k}.`, out);
    else out[`${p}${k}`] = JSON.stringify(v);
  }
  return out;
};
const changedPaths = (a, b) => {
  const fa = flat(a), fb = flat(b);
  return [...new Set([...Object.keys(fa), ...Object.keys(fb)])].filter((k) => fa[k] !== fb[k]);
};
const ALLOWED = {
  color: [/^(surface|background)\.color$/],
  corners: [/^surface\.corners$/, /^background\.round$/],
  contour: [/^surface\.border(\.|$)/, /^background\.border(\.|$)/],
  margin: [/^background\.inset$/],
};
const measureLayers = async (fr, marker) => {
  // La toile remonte le bloc à chaque écriture : le repère est reposé à chaque mesure.
  const sel = await fr.evaluate(MARKER, marker);
  const m = sel ? await fr.evaluate(ZONES, { target: sel }) : null;
  const card = m?.zones.find((z) => z.cls === "card");
  const fond = m?.zones.find((z) => z.cls === "fond");
  return { card, fond };
};
const sameBox = (a, b, withGeom) => a && b && near(a.radius, b.radius, 1) && near(a.bw, b.bw, 1) && a.bg === b.bg && a.bc === b.bc && (!withGeom || (near(a.l, b.l, 1.5) && near(a.r, b.r, 1.5)));

/* ============================== A : le bloc réel, réglage par réglage ============================== */
if (run("A")) {
  await section("A", async () => {
    for (const T of TYPES) {
      const pid = PAGES[T.page];
      const uidOf = (v) => `a${v.id.replace(/\W/g, "")}`;
      const blocks = VARIANTS.map((v) => ({ uid: uidOf(v), type: T.type, props: { ...T.mk(mark(T, v.id)), surface: v.surface, background: v.background } }));
      if (T.type === "collection-tiles") blocks.unshift({ uid: "txt", type: "rich-text", props: { paragraphs: [L("Page de départ inventée.")] } });
      ok(`A0 [${T.key}] page posée`, await publishWith(pid, blocks));
      const before = savedBlocks(pid);
      const fr = await openEditor(pid);
      const propsNow = (v) => blockOf(pid, mark(T, v.id))?.props ?? blocks.find((b) => b.uid === uidOf(v)).props;
      for (const v of VARIANTS) {
        const marker = mark(T, v.id);
        const menu = await openMenuOn(fr, marker);
        // Ouvrir le menu n'écrit rien (aucune donnée réécrite à l'ouverture).
        ok(`A1 [${T.key}/${v.id}] ouvrir le menu n'écrit aucun brouillon`, draftRow(pid) === null || JSON.stringify(propsNow(v)?.surface) === JSON.stringify(v.surface));
        const start = { surface: v.surface, background: v.background };
        for (const slot of ["fond", "carte"]) {
          const box = sec(menu, slot);
          const kindNow = await box.getAttribute("data-kind-now");
          if (kindNow === "none") continue;
          const acts = [
            ["color", async () => { const t = box.locator('[data-testid="card-da-color"][data-token="secondary"]').first(); await t.waitFor({ timeout: 8000 }); await t.click(); }],
            ["corners", async () => { const b = box.locator('[data-testid="fond-round"] [data-step="l"]'); await b.click(); }],
            ["contour", async () => { await box.locator('[data-testid="fond-contour"] [data-contour="thick"]').click(); }],
            ["margin", async () => { const g = box.locator('[data-testid="fond-inset"]'); if (!(await g.count())) return false; const cur = await g.locator('[aria-checked="true"]').first().getAttribute("data-step"); await g.locator(`[data-step="${cur === "s" ? "m" : "s"}"]`).click(); }],
          ];
          for (const [name, act] of acts) {
            const prev = JSON.parse(JSON.stringify({ surface: propsNow(v)?.surface, background: propsNow(v)?.background }));
            let mBefore = {};
            await until(async () => { mBefore = await measureLayers(fr, marker); return Boolean(mBefore.card && mBefore.fond); }, 15000);
            const res = await act();
            if (res === false) continue;
            const moved = await until(() => JSON.stringify({ surface: propsNow(v)?.surface, background: propsNow(v)?.background }) !== JSON.stringify(prev), 15000);
            const now = { surface: propsNow(v)?.surface, background: propsNow(v)?.background };
            const paths = moved ? changedPaths(prev, now) : [];
            const layers = new Set(paths.map((p) => p.split(".")[0]));
            const allowed = paths.every((p) => ALLOWED[name].some((re) => re.test(p)));
            ok(`A2 [${T.key}/${v.id}] ${slot}/${name} : le réglage écrit, dans UNE couche, et seulement sa clé`, moved && layers.size === 1 && allowed, `${moved ? "" : "rien écrit ; "}${paths.join(",")}`);
            ok(`A3 [${T.key}/${v.id}] ${slot}/${name} : les deux couches existent encore, retrait du fond gardé`, Boolean(now.surface) && Boolean(now.background) && now.background.inset !== undefined && (name === "margin" || now.background.inset === prev.background.inset), JSON.stringify(now.background));
            // Rendu : la couche NON touchée est mesurée identique.
            if (moved && layers.size === 1) {
              const touched = [...layers][0];
              let mAfter;
              await until(async () => { mAfter = await measureLayers(fr, marker); return mAfter.card && mAfter.fond; }, 20000);
              const keep = touched === "surface" ? sameBox(mBefore.fond, mAfter.fond, false) : sameBox(mBefore.card, mAfter.card, false);
              ok(`A4 [${T.key}/${v.id}] ${slot}/${name} : le rendu de l'autre couche ne bouge pas`, keep, JSON.stringify([mBefore, mAfter]).slice(0, 400));
            }
          }
        }
        // « Aucun » sur chaque section, sur une copie : l'autre couche est intacte.
        await page.keyboard.press("Escape");
      }
      // Publication de l'état modifié : les données publiées sont celles du brouillon, public = éditeur (rayon, contour, retrait de chaque couche).
      const finalDraft = draftOf(pid).map((b) => b.props);
      const edZones = {};
      for (const v of VARIANTS) {
        const sel = await fr.evaluate(MARKER, mark(T, v.id));
        edZones[v.id] = await fr.evaluate(ZONES, { target: sel });
      }
      ok(`A6 [${T.key}] publication`, await publishCurrentFromEditor(pid));
      ok(`A7 [${T.key}] les données publiées sont celles du brouillon (rien perdu à la publication)`, JSON.stringify(savedBlocks(pid).map((b) => ({ surface: b.props.surface, background: b.props.background }))) === JSON.stringify(finalDraft.map((p) => ({ surface: p.surface, background: p.background }))));
      await page.goto(urlOf(SLUG[T.page]), { waitUntil: "domcontentloaded" });
      for (const v of VARIANTS) {
        await page.waitForFunction((t) => document.body.textContent.includes(t), mark(T, v.id), { timeout: 60000 });
        const sel = await page.evaluate(MARKER, mark(T, v.id));
        const pz = await page.evaluate(ZONES, { target: sel });
        const ez = edZones[v.id];
        ok(`A8 [${T.key}/${v.id}] public : mêmes couches que l'éditeur (carte, fond, rayons, contours, retrait du fond dans la carte)`, pz && ez && pz.zones.length === ez.zones.length && pz.zones.every((z, k) => z.cls === ez.zones[k].cls && [1, 0.667, 1.5].some((f) => near(z.radius * f, ez.zones[k].radius, 1.5) || near(z.radius, ez.zones[k].radius * f, 1.5)) && [1, 0.667, 1.5].some((f) => near(z.bw * f, ez.zones[k].bw, 1.5) || near(z.bw, ez.zones[k].bw * f, 1.5))) && (() => { const c = pz.zones.find((z) => z.cls === "card"), f = pz.zones.find((z) => z.cls === "fond"); return Boolean(c && f && f.l > c.l + 8); })(), JSON.stringify([pz?.zones.map((z) => [z.cls, z.radius, z.bw]), ez?.zones.map((z) => [z.cls, z.radius, z.bw])]));
      }
      // Rechargement : le menu relit l'état publié sans rien écrire.
      const fr2 = await openEditor(pid);
      await openMenuOn(fr2, mark(T, VARIANTS[1].id));
      ok(`A9 [${T.key}] rechargement : ouvrir le menu n'écrit rien`, draftRow(pid) === null);
      await page.keyboard.press("Escape");
      // « Aucun » sur la couche de chaque section, sur le bloc réel remis à neuf : l'autre couche est intacte.
      for (const slot of ["fond", "carte"]) {
        ok(`A10 [${T.key}] remise à neuf (${slot})`, await publishWith(pid, blocks));
        const frN = await openEditor(pid);
        const v = VARIANTS[0];
        const menu = await openMenuOn(frN, mark(T, v.id));
        const cur = JSON.parse(JSON.stringify(propsNow(v) ?? blocks.find((b) => b.uid === uidOf(v)).props));
        const box = sec(menu, slot);
        const layerOfSlot = await box.getAttribute("data-layer");
        await box.locator(`[data-testid="fond-kind-${slot}"] [data-kind="none"]`).click();
        await until(() => { const n = propsNow(v); return n && (JSON.stringify(n.surface) !== JSON.stringify(cur.surface) || JSON.stringify(n.background) !== JSON.stringify(cur.background)); }, 15000);
        const now = propsNow(v) ?? {};
        const gone = layerOfSlot === "card" ? "surface" : "background";
        const kept = gone === "surface" ? "background" : "surface";
        ok(`A11 [${T.key}] « Aucun » sur ${slot} (couche ${gone}) : l'autre couche est intacte`, now[gone] === undefined && JSON.stringify(now[kept]) === JSON.stringify(cur[kept]), JSON.stringify([layerOfSlot, now[kept], cur[kept]]));
        await page.keyboard.press("Escape");
      }
    }
  });
}

/* ============================== B : largeur du bloc ============================== */
const MODES = {
  fond: { background: { kind: "wallpaper", wallpaper: WP, color: "primary12" } },
  carte: { surface: { color: "#dbff91", width: "inset", corners: "m" } },
  aucun: {},
};
async function measureBoth(T, pid, slug, ids) {
  const fr = await openEditor(pid);
  if (process.env.DEBUG107 && ids.some((i) => i.endsWith("iside") || i.endsWith("iSide"))) {
    const mk = mark(T, ids.find((i) => /iside$/i.test(i)));
    await fr.locator("[data-edit-block]").filter({ hasText: mk }).last().scrollIntoViewIfNeeded().catch(() => {});
    console.log("# CHAIN", JSON.stringify(await fr.evaluate((m) => { const e = [...document.querySelectorAll("h1,h2,h3,p,figcaption,span,div")].filter((x) => !x.children.length && x.textContent.includes(m)).at(-1); const out = []; for (let n = e; n && out.length < 14; n = n.parentElement) out.push(`${n.tagName}.${n.className}${[...n.attributes].filter((a) => /^data-(ps|w|fond|surface|edit-block)$/.test(a.name)).map((a) => `[${a.name}=${a.value}]`).join("")}|${getComputedStyle(n).display}|${getComputedStyle(n).marginLeft}`); return out; }, mk)));
  }
  const ed = {};
  for (const id of ids) {
    const mk = mark(T, id);
    await fr.locator("[data-edit-block]").filter({ hasText: mk }).last().scrollIntoViewIfNeeded().catch(() => {});
    let m = null;
    await until(async () => (m = await fr.evaluate(METRICS, { mk, prev: `SEP107x${id}px`, next: `SEP107x${id}nx` })) !== null, 30000);
    ed[id] = m;
  }
  await page.goto(urlOf(slug), { waitUntil: "domcontentloaded" });
  const pub = {};
  /* La page publique se met en page en plusieurs temps (polices web, images) : mesurer le premier bloc des que son texte
     apparait donnait une hauteur de repli (une ligne de plus) que les blocs suivants, mesures plus tard, n'avaient plus.
     On attend donc polices et images, puis deux mesures identiques de suite (valeurs stabilisees, seuils inchanges). */
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; setTimeout(r, 15000); })))); }).catch(() => {});
  for (const id of ids) {
    const mk = mark(T, id);
    await page.waitForFunction((t) => document.body.textContent.includes(t), mk, { timeout: 60000 });
    let last = null, cur = null;
    await until(async () => { cur = await page.evaluate(METRICS, { mk, prev: `SEP107x${id}px`, next: `SEP107x${id}nx` }); const same = last !== null && cur !== null && JSON.stringify(cur) === JSON.stringify(last); last = cur; if (!same) await new Promise((r) => setTimeout(r, 250)); return same; }, 15000);
    pub[id] = cur;
  }
  return { ed, pub };
}
const caseBlocks = (T, cases) =>
  cases.flatMap((c) => [
    { uid: `p${c.id.replace(/\W/g, "").toLowerCase()}`, type: "rich-text", props: { paragraphs: [L(`SEP107x${c.id}px`)] } },
    { uid: `x${c.id.replace(/\W/g, "").toLowerCase()}`, type: T.type, props: { ...T.mk(mark(T, c.id)), ...MODES[c.mode], ...(c.look ? { look: c.look } : {}) } },
    { uid: `n${c.id.replace(/\W/g, "").toLowerCase()}`, type: "rich-text", props: { paragraphs: [L(`SEP107x${c.id}nx`)] } },
  ]);
if (run("B")) {
  await section("B", async () => {
    for (const T of TYPES) {
      const pid = PAGES[T.page];
      for (const mode of ["fond", "carte", "aucun"]) {
        const cases = ["full", "wide", "medium", "narrow"].map((w) => ({ id: `${mode}${w}`, mode, ...(w === "full" ? {} : { look: { width: w } }), w }));
        ok(`B0 [${T.key}/${mode}] page posée`, await publishWith(pid, caseBlocks(T, cases)));
        const { ed, pub } = await measureBoth(T, pid, SLUG[T.page], cases.map((c) => c.id));
        if (process.env.DEBUG107) console.log("# DBG", await page.evaluate(() => { const e = document.querySelector(".blk-out"); const c = getComputedStyle(e); return JSON.stringify([e.outerHTML.slice(0, 100), e.getBoundingClientRect().width, c.display, c.maxWidth, c.width, e.parentElement.tagName, e.parentElement.className, e.parentElement.getBoundingClientRect().width, location.href]); }));
        const base = pub[`${mode}full`];
        const ratio = { wide: 0.88, medium: 0.72, narrow: 0.56 };
        const W = (m) => (mode === "aucun" ? m.sw : m.W);
        for (const w of ["wide", "medium", "narrow"]) {
          const m = pub[`${mode}${w}`];
          const e = ed[`${mode}${w}`];
          ok(`B1 [${T.key}/${mode}/${w}] public : le bloc est plus étroit (≈ ${Math.round(ratio[w] * 100)} %) et centré`, m && base && near(W(m) / W(base), ratio[w], 0.04) && m.sx <= m.vw + 1 && near((mode === "aucun" ? m.sl : m.zl) - (mode === "aucun" ? base.sl : base.zl), (W(base) - W(m)) / 2, 14), JSON.stringify([m && W(m), base && W(base), m?.zl, m?.sl]));
          ok(`B2 [${T.key}/${mode}/${w}] éditeur = public (largeur relative à la fenêtre)`, e && m && near(W(e) / e.vw, W(m) / m.vw, 0.03) , JSON.stringify([e && W(e) / e.vw, m && W(m) / m.vw]));
        }
        ok(`B3 [${T.key}/${mode}] pleine largeur : comme avant (carte en retrait de la gouttière, fond bord à bord)`, base && (mode === "aucun" ? true : mode === "carte" ? base.W < base.vw - 2 : near(base.W, base.vw, 2)));
      }
    }
  });
}

/* ============================== C : marge extérieure / espacement intérieur ============================== */
if (run("C")) {
  await section("C", async () => {
    for (const T of TYPES) {
      const pid = PAGES[T.page];
      const defs = [["base", {}], ["oTop", { marginTop: "xl" }], ["oBot", { marginBottom: "xl" }], ["oSide", { width: "medium" }], ["iTop", { spaceTop: "xl" }], ["iBot", { spaceBottom: "xl" }], ["iSide", { spaceSides: "l" }]];
      for (const mode of ["fond", "carte", "aucun"]) {
        const cases = defs.map(([k, look]) => ({ id: `${mode}${k}`, mode, ...(k === "base" ? {} : { look }), k }));
        ok(`C0 [${T.key}/${mode}] page posée`, await publishWith(pid, caseBlocks(T, cases)));
        const { ed, pub } = await measureBoth(T, pid, SLUG[T.page], cases.map((c) => c.id));
        for (const [where, M] of [["public", pub], ["éditeur", ed]]) {
          const b = M[`${mode}base`];
          const g = (k) => M[`${mode}${k}`];
          if (!b || defs.some(([k]) => !g(k))) { ok(`C [${T.key}/${mode}] ${where} : mesures présentes`, false); continue; }
          const dT = (m) => m.dTop - b.dTop, dB = (m) => m.dBottom - b.dBottom;
          const oT = g("oTop"), iT = g("iTop"), oB = g("oBot"), iB = g("iBot"), oS = g("oSide"), iS = g("iSide");
          ok(`C1 [${T.key}/${mode}] ${where} haut : dehors et dedans éloignent le contenu du voisin (≥ 8 px)`, dT(oT) >= 8 && dT(iT) >= 8, JSON.stringify([dT(oT), dT(iT)]));
          ok(`C2 [${T.key}/${mode}] ${where} bas : dehors et dedans éloignent le contenu du voisin (≥ 8 px)`, dB(oB) >= 8 && dB(iB) >= 8, JSON.stringify([dB(oB), dB(iB)]));
          if (mode === "aucun") {
            ok(`C3 [${T.key}/aucun] ${where} sans fond ni carte : dehors et dedans donnent la même distance en haut ; en bas les deux éloignent (l'espacement intérieur REMPLACE l'espace propre du bloc)`, near(dT(oT), dT(iT), 3) && dB(oB) >= 8 && dB(iB) >= 8, JSON.stringify([dT(oT), dT(iT), dB(oB), dB(iB)]));
            ok(`C8 [${T.key}/aucun] ${where} côtés : le contenu se resserre dehors comme dedans`, oS.sw < b.sw - 8 && (iS.sw < b.sw - 8 || iS.sl > b.sl + 8 || iS.pl > b.pl + 8), JSON.stringify([b.sw, oS.sw, iS.sw, b.sl, iS.sl, b.pl, iS.pl]));
          } else {
            ok(`C4 [${T.key}/${mode}] ${where} haut : dehors, la zone (donc le papier) ne grandit pas et la page se voit au-dessus ; dedans, elle grandit`, near(oT.H, b.H, 3) && oT.gapTop - b.gapTop >= 16 && iT.H - b.H >= 8 && near(iT.gapTop, b.gapTop, 3), JSON.stringify([b.H, oT.H, iT.H, oT.gapTop - b.gapTop, iT.gapTop - b.gapTop]));
            ok(`C5 [${T.key}/${mode}] ${where} bas : dehors, la zone ne grandit pas ; dedans, elle grandit`, near(oB.H, b.H, 3) && oB.gapBottom - b.gapBottom >= 16 && iB.H - b.H >= 8 && near(iB.gapBottom, b.gapBottom, 3), JSON.stringify([b.H, oB.H, iB.H, oB.gapBottom - b.gapBottom, iB.gapBottom - b.gapBottom]));
            ok(`C6 [${T.key}/${mode}] ${where} côtés : dehors (largeur) la zone rétrécit ; dedans (espacement) la zone garde sa largeur et le contenu entre`, oS.W < b.W - 20 && near(iS.W, b.W, 3) && (iS.sw < b.sw - 8 || iS.sl > b.sl + 8 || iS.pl > b.pl + 8), JSON.stringify([b.W, oS.W, iS.W, b.sw, iS.sw, b.pl, iS.pl]));
            ok(`C7 [${T.key}/${mode}] ${where} le papier peint ou la couleur couvre la distance intérieure et non l'extérieure`, (mode !== "fond" || (b.wp && iT.wp && oT.wp)) && iT.H > oT.H + 8 && iB.H > oB.H + 8);
          }
        }
        for (const [k] of defs.slice(1)) {
          const a = ed[`${mode}${k}`], p = pub[`${mode}${k}`], ea = ed[`${mode}base`], pa = pub[`${mode}base`];
          const rel = (m, base, key) => (m[key] - base[key]) / m.xl;
          ok(`C9 [${T.key}/${mode}/${k}] éditeur = public (écarts de distance en unités de l'espace XL du thème, largeur relative)`, a && p && ea && pa && (k === "oSide" || k === "iSide" || (near(rel(a, ea, "dTop"), rel(p, pa, "dTop"), 0.3) && near(rel(a, ea, "dBottom"), rel(p, pa, "dBottom"), 0.3))) && near((a.W ?? a.sw) / a.vw, (p.W ?? p.sw) / p.vw, 0.03), JSON.stringify([rel(a ?? {}, ea ?? {}, "dTop"), rel(p ?? {}, pa ?? {}, "dTop"), rel(a ?? {}, ea ?? {}, "dBottom"), rel(p ?? {}, pa ?? {}, "dBottom")]));
        }
      }
    }
  });
}

/* ============================== D : la barre (Marge, Espacement), rechargement, publication ============================== */
if (run("D")) {
  await section("D", async () => {
    const T = TYPES[0];
    const pid = PAGES[T.page];
    const mk0 = mark(T, "d");
    const blocks = [{ uid: "dd", type: T.type, props: { ...T.mk(mk0), background: MODES.fond.background } }];
    ok("D0 page posée", await publishWith(pid, blocks));
    const fr = await openEditor(pid);
    const lookNow = () => blockOf(pid, mk0)?.props?.look ?? {};
    const pressIn = async (kind, sel) => {
      const menu = await openBarMenu(fr, mk0, kind);
      await menu.locator(sel).click();
      await page.keyboard.press("Escape");
    };
    await pressIn("width", '[data-block-width="medium"]');
    ok("D1 la barre « Marge » écrit la largeur dans look", await until(() => lookNow().width === "medium", 20000), JSON.stringify(lookNow()));
    await pressIn("width", '[data-margin="top-l"]');
    ok("D2 marge extérieure haut écrite", await until(() => lookNow().marginTop === "l", 20000), JSON.stringify(lookNow()));
    await pressIn("space", '[data-space-sides="m"]');
    ok("D3 espacement intérieur (côtés) écrit", await until(() => lookNow().spaceSides === "m", 20000), JSON.stringify(lookNow()));
    ok("D4 rien d'autre n'a bougé (fond intact)", JSON.stringify(blockOf(pid, mk0)?.props.background) === JSON.stringify(MODES.fond.background));
    const journal = sql((db) => { try { return db.prepare("select count(*) as n from edit_journal").get().n; } catch { return -1; } });
    ok("D5 le journal d'édition existe et enregistre", journal !== 0);
    const fr2 = await openEditor(pid);
    const menu = await openBarMenu(fr2, mk0, "width");
    ok("D6 rechargement : la barre relit largeur et marge", (await menu.locator('[data-block-width="medium"][aria-checked="true"]').count()) === 1 && (await menu.locator('[data-margin="top-l"][aria-checked="true"]').count()) === 1);
    await page.keyboard.press("Escape");
    ok("D7 publication", await publishCurrentFromEditor(pid));
    const saved = savedBlocks(pid)[0]?.props?.look;
    ok("D8 la publication garde largeur, marge et espacement", saved?.width === "medium" && saved?.marginTop === "l" && saved?.spaceSides === "m", JSON.stringify(saved));
    await page.goto(urlOf(SLUG[T.page]), { waitUntil: "domcontentloaded" });
    await page.waitForFunction((t) => document.body.textContent.includes(t), mk0, { timeout: 60000 });
    const pubOut = await page.evaluate(() => { const e = document.querySelector(".blk-out"); return e ? { w: e.dataset.w, mt: e.dataset.mt, width: e.getBoundingClientRect().width, vw: document.documentElement.clientWidth } : null; });
    ok("D9 public : enveloppe de marge extérieure, 72 % de la largeur", pubOut && pubOut.w === "medium" && pubOut.mt === "l" && near(pubOut.width / pubOut.vw, 0.72, 0.03), JSON.stringify(pubOut));

    /* ---- Lot 108 : curseurs aimantés (valeurs nommées relues, nombres libres, clavier, Auto), puis publication ---- */
    const fr3 = await openEditor(pid);
    const sl = async (kind, id) => {
      const m = await openBarMenu(fr3, mk0, kind);
      return m.locator(`[data-testid="${id}"] input[type=range]`);
    };
    let range = await sl("width", "slider-width");
    ok("D10 largeur « moyenne » écrite avant : le curseur se place sur 72 et le cran est coché", (await range.inputValue()) === "72" && (await fr3.locator('[data-block-width="medium"][aria-checked="true"]').count()) === 1);
    await range.fill("64");
    ok("D11 un nombre libre (64 %) est écrit tel quel", await until(() => lookNow().width === 64, 20000), JSON.stringify(lookNow()));
    await page.keyboard.press("Escape");
    range = await sl("width", "slider-width");
    ok("D11b relu : le curseur est sur 64, aucun cran coché", (await range.inputValue()) === "64" && (await fr3.locator('[data-testid="slider-width"] [aria-checked="true"]').count()) === 0);
    await range.fill("73");
    ok("D12 près d'un cran (73), la valeur colle au cran nommé « moyenne »", await until(() => lookNow().width === "medium", 20000), JSON.stringify(lookNow()));
    await page.keyboard.press("Escape");
    range = await sl("width", "slider-width");
    await range.focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    ok("D13 clavier : trois flèches depuis 72 donnent 69", await until(() => lookNow().width === 69, 20000), JSON.stringify(lookNow()));
    await page.keyboard.press("Escape");
    await (await openBarMenu(fr3, mk0, "width")).locator('[data-block-width="full"]').click();
    ok("D14 « Pleine » retire la largeur", await until(() => lookNow().width === undefined, 20000), JSON.stringify(lookNow()));
    await page.keyboard.press("Escape");
    await (await sl("width", "slider-width")).fill("64");
    await until(() => lookNow().width === 64, 20000);
    await page.keyboard.press("Escape");
    await (await sl("width", "slider-marginTop")).fill("41");
    ok("D15 marge extérieure du haut : nombre libre", await until(() => lookNow().marginTop === 41, 20000), JSON.stringify(lookNow()));
    await page.keyboard.press("Escape");
    await (await sl("space", "slider-spaceTop")).fill("45");
    ok("D16 espacement intérieur du haut : nombre libre", await until(() => lookNow().spaceTop === 45, 20000), JSON.stringify(lookNow()));
    await page.keyboard.press("Escape");
    await (await sl("space", "slider-spaceBottom")).waitFor({ timeout: 15000 });
    await fr3.locator('[data-testid="slider-spaceBottom"] [data-snap="none"]').click();
    ok("D17 espacement du bas « Aucun » (0 px) : un réglage nommé (pas « absent »)", await until(() => lookNow().spaceBottom === "none", 20000), JSON.stringify(lookNow()));
    await page.keyboard.press("Escape");
    ok("D18 publication des nombres", await publishCurrentFromEditor(pid));
    const saved2 = savedBlocks(pid)[0]?.props?.look;
    ok("D19 la publication garde les nombres", saved2?.width === 64 && saved2?.marginTop === 41 && saved2?.spaceTop === 45 && saved2?.spaceBottom === "none", JSON.stringify(saved2));
    await page.goto(urlOf(SLUG[T.page]), { waitUntil: "domcontentloaded" });
    await page.waitForFunction((t) => document.body.textContent.includes(t), mk0, { timeout: 60000 });
    const pub2 = await page.evaluate(() => {
      const e = document.querySelector(".blk-out");
      const z = e?.querySelector(".zone");
      const blk = e?.querySelector(".blk");
      const first = blk?.firstElementChild;
      return e ? { w: e.dataset.w, ratio: e.getBoundingClientRect().width / document.documentElement.clientWidth, mt: parseFloat(getComputedStyle(e).paddingTop), pt: first ? parseFloat(getComputedStyle(first).paddingTop) : null, pb: first ? parseFloat(getComputedStyle(blk.lastElementChild).paddingBottom) : null, hasZone: Boolean(z) } : null;
    });
    ok("D20 public : largeur 64 %, marge extérieure 41 px, espacement intérieur 45 px haut et 0 bas", pub2 && pub2.w === "n" && near(pub2.ratio, 0.64, 0.03) && near(pub2.mt, 41, 1.5) && near(pub2.pt, 45, 1.5) && near(pub2.pb, 0, 1.5), JSON.stringify(pub2));
  });
}

await browser.close();
console.log(failures ? `\n${failures} ÉCHEC(S)` : "\nTout passe");
process.exit(failures ? 1 : 0);
