#!/usr/bin/env node
/**
 * Lot 45 « panorama entier dans Images qui défilent » (chromium, serveur requis, base neuve, une connexion admin). Mesures de
 * géométrie (getBoundingClientRect), pas de pixels : un panorama 4:1 et deux images normales dans un carrousel.
 *  D  Défaut (toile, 1440 puis 1024) : le panorama tient dans la largeur visible du carrousel, ratio respecté (non recadré),
 *     centré dans la hauteur de la bande ; les images normales gardent leur taille de la v0.26 ; légende à la largeur de l'image.
 *  M  Menu de l'image : « Panorama : Entier / À faire défiler », enregistré dans `look.slotPano` (par emplacement), Entier = clé retirée.
 *  F  Flèches et visionneuse : ← → arrivent sur le panorama entier, un clic ouvre la visionneuse.
 *  P  Publication (1440, 1024) : mêmes mesures qu'en toile ; « À faire défiler » = largeur naturelle (comme avant) ; aucun repère.
 *  T  Téléphone 390 px : même règle avec la largeur visible du téléphone, sans débordement de la page.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=D,M,F,P,T] [SHOTS=dossier] node scripts/e2e-panorama45.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";
import sharp from "sharp";

import { paint } from "./lib/crop-fixtures.mjs";
import { login, pageIdOf, q1, waitFor } from "./lib/medias-setup.mjs";

const BASE = process.env.BASE ?? "http://localhost:3610";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(process.env.BATTERY_DIR ?? tmpdir(), "shots-panorama45");
const DB = path.join(process.env.DATA_DIR ?? "data", "portfolio.db");
mkdirSync(SHOTS, { recursive: true });
sharp.cache(false);
sharp.concurrency(1);

let failures = 0;
const ok = (label, cond, detail = "") => {
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
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);

/** Panorama 4:1 (2400 x 600) : quatre bandes de couleur, pour que tout recadrage se voie. */
async function pano(seed) {
  const cols = seed ? ["#c03030", "#30a050", "#3050c0", "#c0a030"] : ["#3050c0", "#c0a030", "#c03030", "#30a050"];
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="600">${cols.map((c, i) => `<rect x="${i * 600}" y="0" width="600" height="600" fill="${c}"/>`).join("")}</svg>`);
  return sharp(svg).png().toBuffer();
}
async function upload(name, buffer) {
  const res = await page.request.post(`${BASE}/admin/api/upload`, { headers: { origin: BASE }, multipart: { file: { name, mimeType: "image/png", buffer } }, timeout: 180000 });
  return res.status();
}
const mediaOf = (name) => q1("select id, status from media where original_name = ? order by id desc", name);
async function ensure(name, make) {
  if (!mediaOf(name)) await upload(name, await make());
  if (!(await waitFor(() => mediaOf(name)?.status === "ready", 180000))) throw new Error(`${name} : ${JSON.stringify(mediaOf(name))}`);
  return mediaOf(name).id;
}
const P1 = await ensure("45-pano-a.png", () => pano(true));
const P2 = await ensure("45-pano-b.png", () => pano(false));
const LAND = await ensure("45-paysage.png", () => paint(1500, 1000, 1));
const PORT = await ensure("45-portrait.png", () => paint(1000, 1500, 2));
const pageId = pageIdOf("personnages");
const PROJECT = q1("select id, slug from projects order by id limit 1");
if (!PROJECT) throw new Error("aucun projet dans la base de test");

// Carrousel à liste propre : panorama, paysage, portrait, panorama (celui-ci passera en « À faire défiler »).
sql((db) => {
  db.prepare("update projects set layout = ?, draft_layout = null, draft_layout_page_id = null where id = ?").run(
    JSON.stringify([{ uid: "kcar", type: "strip", props: { source: "own", media: [P1, LAND, PORT, P2] } }]),
    PROJECT.id,
  );
});
function setDraft(blocks) {
  sql((db) => {
    const row = db.prepare("select title, slug, meta, nav_order from pages where id = ?").get(pageId);
    const draft = {
      title: JSON.parse(row.title),
      slug: JSON.parse(row.slug),
      meta: row.meta ? JSON.parse(row.meta) : { title: { fr: "", en: "" }, description: { fr: "", en: "" } },
      published: true,
      inMenu: row.nav_order !== null,
      accent: null,
      blocks,
    };
    db.prepare("update pages set draft = ?, draft_updated_at = unixepoch(), draft_rev = draft_rev + 1 where id = ?").run(JSON.stringify(draft), pageId);
  });
}
const lookOfDraft = (uid) => JSON.parse(sql((db) => db.prepare("select draft from pages where id = ?").get(pageId)).draft).blocks.find((b) => b.uid === uid)?.props.look;
setDraft([{ uid: "board1", type: "project-board", props: { project: PROJECT.slug } }]);

async function canvas() {
  const handle = await page.waitForSelector("iframe.ve-frame", { timeout: 120000 });
  const fr = await handle.contentFrame();
  await fr.waitForSelector("html[data-edit-mode]", { timeout: 180000 });
  return fr;
}
async function settled() {
  await page.waitForFunction(() => !/Enregistrement/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, { timeout: 120000 });
  await sleep(500);
}
const section = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 8).join(" "));
    await page.screenshot({ path: path.join(SHOTS, `erreur-${name}.png`) }).catch(() => {});
  }
};

/** `locator.evaluate` sans délai attend indéfiniment : une borne de 40 s, pour qu'un problème soit un échec, pas un blocage. */
const bounded = (promise, what) => Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error(`délai dépassé : ${what}`)), 40000))]);

/** Mesures du carrousel dans un document (toile ou public) : largeur visible (contenu du rail), hauteur de la bande, une ligne par image. */
async function measure(doc, railSel) {
  const rail = doc.locator(railSel).first();
  await rail.scrollIntoViewIfNeeded();
  await doc.locator(`${railSel} .strip-frame img`).last().waitFor({ timeout: 30000 });
  // Images différées (loading=lazy) hors écran : on les charge pour connaître leur taille naturelle ; jamais d'attente sans borne.
  await bounded(rail.evaluate((r) =>
    Promise.race([
      Promise.all([...r.querySelectorAll("img")].map((i) => { i.loading = "eager"; return i.decode ? i.decode().catch(() => {}) : null; })),
      new Promise((res) => setTimeout(res, 15000)),
    ]),
  ), "chargement des images");
  await sleep(300);
  return bounded(rail.evaluate((r) => {
    const cs = getComputedStyle(r);
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;visibility:hidden;height:var(--strip-h);width:1px";
    r.parentElement.appendChild(probe);
    const stripH = probe.getBoundingClientRect().height;
    probe.remove();
    const visible = r.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const rr = r.getBoundingClientRect();
    const frames = [...r.querySelectorAll(".strip-frame")].map((f) => {
      const i = f.querySelector(".strip-media img");
      const b = i.getBoundingClientRect();
      const fb = f.getBoundingClientRect();
      const cap = f.querySelector(".media-caption");
      return { w: b.width, h: b.height, top: b.top - rr.top, frameLeft: fb.left - rr.left + r.scrollLeft, capW: cap ? cap.getBoundingClientRect().width : null, natW: i.naturalWidth, natH: i.naturalHeight, pano: f.getAttribute("data-pano") };
    });
    return { visible, stripH, scrollWidth: r.scrollWidth, clientWidth: r.clientWidth, padL: parseFloat(cs.paddingLeft), frames, docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  }), "mesures du carrousel");
}
const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;
/** Vérifie la règle par défaut sur une mesure ; `panos` = indices des panoramas réglés « Entier ». */
function checkFit(tag, m, panos) {
  const [p1, land, port, p2] = m.frames;
  ok(`${tag} le panorama tient dans la largeur visible (${p1.w.toFixed(0)} ≤ ${m.visible.toFixed(0)})`, p1.w <= m.visible + 1, JSON.stringify(p1));
  ok(`${tag} …il en prend toute la largeur (réduit, pas rétréci au hasard)`, near(p1.w, m.visible, 2), `${p1.w} / ${m.visible}`);
  ok(`${tag} …son ratio 4:1 est respecté (non recadré)`, near(p1.w / p1.h, 4, 0.03), `${p1.w}x${p1.h}`);
  ok(`${tag} …centré dans la hauteur de la bande`, near(p1.top, port.top + (m.stripH - p1.h) / 2, 2.5), `top ${p1.top}, bande ${m.stripH}, h ${p1.h}`);
  ok(`${tag} …sa légende ne dépasse pas la largeur de l'image`, p1.capW === null || p1.capW <= p1.w + 1, `${p1.capW} / ${p1.w}`);
  // Règle générale : une image ne dépasse jamais la largeur visible. Un paysage 3:2 la dépasse seulement sur téléphone (390 px) : il y est réduit aussi.
  const landH = Math.min(m.stripH, m.visible / 1.5);
  ok(`${tag} paysage 3:2 : ${landH === m.stripH ? "hauteur de la bande, comme en v0.26" : "réduit à la largeur visible (plus large que l'écran)"}`, near(land.h, landH) && near(land.w, landH * 1.5), JSON.stringify(land));
  ok(`${tag} portrait 2:3 : hauteur de la bande, comme en v0.26`, near(port.h, m.stripH) && near(port.w, (m.stripH * 2) / 3), JSON.stringify(port));
  if (panos.includes(3)) ok(`${tag} le second panorama (Entier) tient aussi`, p2.w <= m.visible + 1 && near(p2.w / p2.h, 4, 0.03), JSON.stringify(p2));
}

const CAR = '[data-edit-block="board1"] [data-edit-rail="kcar"]';

/* ---- D. Défaut sur la toile ---------------------------------------------------------------------------------------- */
await page.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
let f = await canvas();
await sleep(2500);
if (run("D"))
  await section("D", async () => {
    await settled();
    const m = await measure(f, CAR);
    ok("D0 quatre images dans le carrousel, panoramas en « Entier » par défaut", m.frames.length === 4 && m.frames[0].pano === "fit" && m.frames[3].pano === "fit", JSON.stringify(m.frames.map((x) => x.pano)));
    checkFit("D1 toile", m, [3]);
    ok("D2 aucun réglage dans le brouillon (aucune migration)", !lookOfDraft("board1")?.slotPano);
    await page.screenshot({ path: path.join(SHOTS, "apres-toile-1440.png") });
    // Avant : le comportement de la v0.26 (hauteur de la bande, largeur naturelle) posé par CSS.
    await f.addStyleTag({ content: '.strip-frame[data-pano] { --fit-h: var(--strip-h) !important; margin-top: 0 !important; }' }).then((h) => h.evaluate((s) => (s.id = "avant45")));
    await sleep(500);
    const old = await measure(f, CAR);
    ok("D3 sans la règle, le panorama dépasse la largeur visible (c'était le défaut signalé)", old.frames[0].w > old.visible + 50, JSON.stringify(old.frames[0]));
    await page.screenshot({ path: path.join(SHOTS, "avant-toile-1440.png") });
    await f.evaluate(() => document.getElementById("avant45")?.remove());
    await sleep(300);
    await page.setViewportSize({ width: 1024, height: 800 });
    await sleep(1800);
    const m2 = await measure(await canvas(), CAR);
    checkFit("D4 toile 1024", m2, [3]);
    await page.screenshot({ path: path.join(SHOTS, "apres-toile-1024.png") });
    await page.setViewportSize({ width: 1440, height: 900 });
    await sleep(1800);
    f = await canvas();
  });

/* ---- M. Menu de l'image -------------------------------------------------------------------------------------------- */
async function slotTools(fr, n) {
  const slot = fr.locator(`${CAR} > [data-edit-slot]`).nth(n);
  await slot.scrollIntoViewIfNeeded();
  await slot.hover();
  const bar = fr.locator(".pe-slot-tools");
  await bar.waitFor({ timeout: 15000 });
  return { bar, slug: await slot.getAttribute("data-slot-slug") };
}
if (run("M"))
  await section("M", async () => {
    await settled();
    f = await canvas();
    const first = await slotTools(f, 3);
    const seg = first.bar.locator('[data-testid="slot-pano"]');
    ok("M1 la barre de l'image propose « Panorama : Entier / À faire défiler », « Entier » choisi", (await seg.count()) === 1 && (await seg.locator('[data-slot-pano-set="fit"]').getAttribute("aria-pressed")) === "true" && (await seg.locator("button").allTextContents()).join("|") === "Entier|À faire défiler");
    await seg.locator('[data-slot-pano-set="scroll"]').click();
    ok("M2 « À faire défiler » : look.slotPano[slug] = scroll (cette image seulement)", await waitFor(() => { const s = lookOfDraft("board1")?.slotPano; return s?.[first.slug] === "scroll" && Object.keys(s).length === 1; }, 30000), JSON.stringify(lookOfDraft("board1")));
    const m = await measure(f, CAR);
    const p2 = m.frames[3];
    ok("M3 …la toile rend l'ancien comportement : hauteur de la bande, largeur naturelle (dépasse)", near(p2.h, m.stripH) && near(p2.w, m.stripH * 4, 2) && p2.w > m.visible + 50 && p2.pano === "scroll", JSON.stringify(p2));
    ok("M4 …le premier panorama reste entier", m.frames[0].w <= m.visible + 1, JSON.stringify(m.frames[0]));
    await page.screenshot({ path: path.join(SHOTS, "menu-panorama-toile.png") });
    // Annuler / Rétablir par l'historique.
    await settled();
    await page.locator('button[aria-label="Défaire"]').click();
    ok("M5 Annuler : le réglage disparaît", await waitFor(() => !lookOfDraft("board1")?.slotPano?.[first.slug], 30000), JSON.stringify(lookOfDraft("board1")));
    await page.locator('button[aria-label="Rétablir"]').click();
    ok("M5 Rétablir : « À faire défiler » revient", await waitFor(() => lookOfDraft("board1")?.slotPano?.[first.slug] === "scroll", 30000));
    // Entier (retour) retire la clé ; on le refait sur la 1re image pour vérifier qu'« Entier » seul ne laisse rien.
    const again = await slotTools(f, 0);
    await page.screenshot({ path: path.join(SHOTS, "barre-image-panorama.png") });
    await again.bar.locator('[data-slot-pano-set="scroll"]').click();
    await waitFor(() => Object.keys(lookOfDraft("board1")?.slotPano ?? {}).length === 2, 30000);
    await again.bar.locator('[data-slot-pano-set="fit"]').click();
    ok("M6 « Entier » retire la clé : une seule image reste réglée", await waitFor(() => Object.keys(lookOfDraft("board1")?.slotPano ?? {}).length === 1, 30000), JSON.stringify(lookOfDraft("board1")));
    await settled();
  });

/* ---- F. Flèches et visionneuse ------------------------------------------------------------------------------------- */
if (run("F"))
  await section("F", async () => {
    // Les flèches ← → sont des commandes de la bande sur le site public ; sur la toile le clic sert aux outils : essai en public (section P).
  });

/* ---- P. Publication ------------------------------------------------------------------------------------------------ */
async function publicMeasure(width, height, tag) {
  const pc = await browser.newContext({ viewport: { width, height }, ...(width < 500 ? { hasTouch: true, isMobile: true } : {}) });
  const pp = await pc.newPage();
  pp.on("pageerror", (e) => errors.push(e.message));
  await pp.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
  const m = await measure(pp, ".strip-rail");
  return { pc, pp, m };
}
if (run("P") || run("F") || run("T"))
  await section("P", async () => {
    await settled();
    await page.getByRole("button", { name: "Publier", exact: true }).click();
    ok("P0 page publiée", await waitFor(async () => /En ligne/.test((await page.locator(".ve-status").textContent()) ?? ""), 120000));
    if (run("P")) {
      for (const [w, h] of [[1440, 900], [1024, 800]]) {
        const { pc, pp, m } = await publicMeasure(w, h, "");
        const [p1, land, port, p2] = m.frames;
        checkFit(`P1 public ${w}`, m, []);
        ok(`P2 public ${w} : « À faire défiler » = largeur naturelle, hauteur de la bande (comme avant)`, p2.pano === "scroll" && near(p2.h, m.stripH) && near(p2.w, m.stripH * 4, 2), JSON.stringify(p2));
        ok(`P3 public ${w} : la page ne déborde pas`, m.docOverflow <= 1, String(m.docOverflow));
        ok(`P4 public ${w} : aucun repère d'édition`, (await pp.locator("[data-edit-block], [data-edit-slot]").count()) === 0);
        await pp.screenshot({ path: path.join(SHOTS, `apres-public-${w}.png`) });
        await pp.addStyleTag({ content: '.strip-frame[data-pano] { --fit-h: var(--strip-h) !important; margin-top: 0 !important; }' });
        await sleep(400);
        await pp.screenshot({ path: path.join(SHOTS, `avant-public-${w}.png`) });
        await pc.close();
      }
    }
    if (run("F")) {
      const { pc, pp } = await publicMeasure(1440, 900, "");
      const rail = pp.locator(".strip-rail").first();
      const next = pp.locator(".strip-nav-next").first();
      await rail.scrollIntoViewIfNeeded();
      const frameLeft = (n) => rail.evaluate((r, i) => { const f = r.querySelectorAll(".strip-frame")[i]; return Math.round(f.getBoundingClientRect().left - r.getBoundingClientRect().left); }, n);
      const pad = await rail.evaluate((r) => Math.round(parseFloat(getComputedStyle(r).paddingLeft)));
      ok("F1 au départ, le panorama est entier et à sa place (bord gauche = marge de page)", Math.abs((await frameLeft(0)) - pad) <= 2);
      await next.click();
      await waitFor(async () => Math.abs((await frameLeft(1)) - pad) <= 3, 8000);
      ok("F2 flèche →: la bande avance d'une image (le paysage arrive à la marge)", Math.abs((await frameLeft(1)) - pad) <= 3, String(await frameLeft(1)));
      await pp.locator(".strip-nav-prev").first().click();
      ok("F3 flèche ← : retour sur le panorama entier", await waitFor(async () => Math.abs((await frameLeft(0)) - pad) <= 3, 8000), String(await frameLeft(0)));
      await pp.locator(".strip-frame").first().click();
      // Lot 54 : la visionneuse est chargée à la première ouverture ; on l'attend.
      ok("F4 un clic sur le panorama ouvre la visionneuse", await pp.locator(".lightbox").first().waitFor({ timeout: 15000 }).then(() => true, () => false));
      await pp.screenshot({ path: path.join(SHOTS, "visionneuse-public.png") });
      await pc.close();
    }
    if (run("T")) {
      const { pc, pp, m } = await publicMeasure(390, 844, "");
      checkFit("T1 téléphone 390", m, []);
      ok("T2 téléphone : la page ne déborde pas", m.docOverflow <= 1, String(m.docOverflow));
      await pp.screenshot({ path: path.join(SHOTS, "apres-telephone.png") });
      await pp.addStyleTag({ content: '.strip-frame[data-pano] { --fit-h: var(--strip-h) !important; margin-top: 0 !important; }' });
      await sleep(400);
      await pp.screenshot({ path: path.join(SHOTS, "avant-telephone.png") });
      await pc.close();
    }
  });

ok("aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `e2e-panorama45 : ${failures} échec(s)` : "e2e-panorama45 : OK");
process.exit(failures ? 1 : 0);
