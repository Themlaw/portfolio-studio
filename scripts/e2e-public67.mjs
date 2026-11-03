#!/usr/bin/env node
/**
 * Lot 67 « site public et petits parcours » (chromium, serveur requis, base neuve, une connexion admin). Mesures de géométrie
 * et de réponses réseau, pas de pixels. Images de test générées (aucune image réelle).
 *  M  Page en ligne mais dans aucun menu (CONC-02) : avertissement à la publication ET dans la liste des pages, avec « Ajouter au menu ».
 *  H  En-tête (PUB-01) : aucun défilement horizontal de 320 à 2560 px (dont 768, 800, 820, 830), « EN » entier, liens sur une ligne ;
 *     même chose dans la toile de l'éditeur en mode Tablette.
 *  C  Carrousel « Images qui défilent » à 390 px avec un panorama et une image très haute (PUB-03) : légendes lisibles, hauteur constante (lot 99).
 *  R  Image recadrée minuscule (PUB-04) : aucune réponse 404 sur la page, toutes les variantes recadrées se lisent.
 *  D  Définition des images à DPR 2 (PUB-09) : variante servie >= 2 fois la taille affichée, dans la limite de l'original (page et visionneuse).
 *  N  Noms des images d'un projet (CONC-13) : titre, sinon nom du fichier d'origine, + recherche par nom quand la liste est longue.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=M,H,C,R,D,N] [SHOTS=dossier] node scripts/e2e-public67.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { paint } from "./lib/crop-fixtures.mjs";
import { canvas, setDraft, sql } from "./lib/grille31d.mjs";
import { login, pageIdOf, q1, waitFor } from "./lib/medias-setup.mjs";

const BASE = process.env.BASE ?? "http://localhost:3820";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(process.env.BATTERY_DIR ?? tmpdir(), "shots-public67");
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const info = (label) => console.log(`INFO ${label}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);

/* ---- Images de test (synthétiques) ---------------------------------------------------------------------------------------- */
async function upload(name, buffer) {
  const res = await page.request.post(`${BASE}/admin/api/upload`, { headers: { origin: BASE }, multipart: { file: { name, mimeType: "image/png", buffer } }, timeout: 180000 });
  if (res.status() >= 300) throw new Error(`envoi de ${name} : ${res.status()}`);
}
const mediaOf = (name) => q1("select id, status, width, height from media where original_name = ? order by id desc", name);
async function ensure(name, w, h, seed) {
  if (!mediaOf(name)) await upload(name, await paint(w, h, seed));
  if (!(await waitFor(() => mediaOf(name)?.status === "ready", 240000))) throw new Error(`${name} : ${JSON.stringify(mediaOf(name))}`);
  return mediaOf(name).id;
}
const PANO = await ensure("67-panorama.png", 6000, 1200, 1);
const HAUT = await ensure("67-haut.png", 900, 5000, 2);
const CARRE = await ensure("67-carre.png", 1200, 1200, 3);
const MINI = await ensure("67-mini.png", 120, 80, 4);
const GRAND = await ensure("67-grand.png", 3000, 2000, 5);

const T = (s) => ({ fr: s, en: s });
const img = (uid, mediaId, props = {}, crop) => ({ uid, type: "image", props: { mediaId, width: "wide", ...props, ...(crop ? { look: { crop: { mediaId: crop } } } : {}) } });
const text = (uid, t) => ({ uid, type: "rich-text", props: { paragraphs: [T(t)] } });

/* ---- M. Page en ligne mais dans aucun menu (CONC-02) ------------------------------------------------------------------------ */
async function createPage(title, slug) {
  const have = pageIdOf(slug);
  if (have) return have;
  await page.goto(`${BASE}/admin/pages`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Créer une page" }).click();
  const d = page.locator("dialog[open]");
  await d.getByLabel("Titre en français").fill(title);
  await d.getByLabel("Titre en anglais").fill(title);
  await d.getByLabel("Adresse en français").fill(slug);
  await d.getByLabel("Adresse en anglais").fill(`${slug}-en`);
  await d.getByRole("button", { name: "Créer la page" }).click();
  await page.waitForURL(/\/admin\/pages\/\d+\/editer$/, { timeout: 90000 });
  return Number(page.url().split("/").at(-2));
}
/** Écrit le brouillon, ouvre l'éditeur, attend la toile puis clique « Publier » (confirmation éventuelle). */
async function publishBlocks(pg, base, id, mutate, done, timeout = 120000) {
  setDraft(id, mutate());
  await pg.goto(`${base}/admin/pages/${id}/editer`, { waitUntil: "domcontentloaded" });
  await canvas(pg);
  await sleep(2500);
  const publish = pg.getByRole("button", { name: "Publier", exact: true });
  await waitFor(async () => !(await publish.isDisabled()), 30000);
  await publish.click();
  const confirm = pg.locator("dialog[open]").getByRole("button", { name: "Mettre en ligne" });
  if (await confirm.waitFor({ timeout: 3000 }).then(() => true, () => false)) await confirm.click();
  const ok = await waitFor(done, timeout);
  await sleep(1000);
  return ok;
}
const published = (id) => () => sql((db) => db.prepare("select draft, published from pages where id = ?").get(id)).draft === null;
const inNav = (id) => sql((db) => db.prepare("select nav_order from pages where id = ?").get(id)).nav_order !== null;

const PA = await createPage("Carrousels 67", "carrousels-67");
const PB = await createPage("Planche libre 67", "planche-libre-67");
{
  ok("M0 une page neuve n'est pas dans le menu", !inNav(PA) && !inNav(PB));
  const done = await publishBlocks(page, BASE, PA, () => [text("m1", "Une page de plus.")], published(PA), 120000);
  ok("M1 la page est publiée", done);
  const warn = page.getByTestId("publish-warnings");
  const shown = await warn.waitFor({ timeout: 20000 }).then(() => true, () => false);
  const body = shown ? await warn.innerText() : "";
  ok("M2 à la publication : « Cette page est en ligne mais n'apparaît dans aucun menu »", /Cette page est en ligne mais n.apparaît dans aucun menu/.test(body), body || "avertissement absent");
  await page.screenshot({ path: path.join(SHOTS, "M2-publication.png") });
  const add = warn.getByRole("button", { name: "Ajouter au menu" });
  ok("M3 l'avertissement propose « Ajouter au menu »", (await add.count()) === 1);
  if (await add.count()) {
    await add.click();
    ok("M4 « Ajouter au menu » : la page entre au menu", await waitFor(() => inNav(PA), 20000));
    ok("M5 l'avertissement disparaît", await waitFor(async () => (await page.getByTestId("publish-warnings").getByText("n'apparaît dans aucun menu").count()) === 0, 10000));
    // Republier sans rien changer d'autre ne doit pas la ressortir du menu (le brouillon suit).
    await publishBlocks(page, BASE, PA, () => [text("m1", "Une page de plus, republiée.")], published(PA), 120000);
    ok("M6 la republication garde la page dans le menu", inNav(PA));
  }
  await publishBlocks(page, BASE, PB, () => [text("m2", "Encore une page.")], published(PB), 120000);
  await page.goto(`${BASE}/admin/pages`, { waitUntil: "networkidle" });
  const row = page.locator("tr", { hasText: "Planche libre 67" });
  const rowText = await row.innerText();
  ok("M7 liste des pages : l'avertissement est écrit dans la ligne", /Cette page est en ligne mais n.apparaît dans aucun menu/.test(rowText), rowText);
  ok("M8 liste des pages : bouton « Ajouter au menu »", (await row.getByRole("button", { name: "Ajouter au menu" }).count()) === 1);
  await page.screenshot({ path: path.join(SHOTS, "M7-liste.png") });
  ok("M9 la page d'accueil n'est jamais signalée", !/n.apparaît dans aucun menu/.test(await page.locator("tr", { hasText: "Accueil" }).first().innerText().catch(() => "")));
  await row.getByRole("button", { name: "Ajouter au menu" }).click();
  ok("M10 liste : « Ajouter au menu » met la page au menu et retire l'avertissement", await waitFor(async () => inNav(PB) && !/n.apparaît dans aucun menu/.test(await page.locator("tr", { hasText: "Planche libre 67" }).innerText()), 20000));
}
// Les pages doivent figurer au menu public pour la suite (en-tête chargé : 6 entrées comme chez l'artiste).
await waitFor(async () => (await (await fetch(`${BASE}/fr`)).text()).includes("carrousels-67"), 30000);

/* ---- Contenu de la page de test ------------------------------------------------------------------------------------------- */
const pageId = pageIdOf("personnages");
const PROJECT = q1("select id, slug from projects order by id limit 1");
sql((db) => {
  const slots = db.prepare("select id from slots where project_id = ? order by position").all(PROJECT.id);
  const media = [PANO, HAUT, CARRE];
  const titles = [T("Panorama d'essai"), T("Grande tour"), T("")];
  const descs = [T("Une longue vue d'ensemble"), T("Une légende un peu plus longue pour la tour très haute"), T("")];
  slots.slice(0, 3).forEach((s, i) => db.prepare("update slots set media_id = ?, title = ?, description = ?, aspect = null where id = ?").run(media[i], JSON.stringify(titles[i]), JSON.stringify(descs[i]), s.id));
  db.prepare("update projects set layout = null, draft_layout = null, draft_layout_page_id = null where id = ?").run(PROJECT.id);
});
const crop = { x: 50, y: 50, zoom: 1, rect: { x: 0.1667, y: 0, w: 0.6667, h: 1 } };
const PAGE = [
  { uid: "pbd", type: "project-board", props: { project: PROJECT.slug } },
  img("mini", MINI, {}, crop),
  img("grand", GRAND),
  text("t1", "Texte de fin."),
];
const done = await publishBlocks(page, BASE, pageId, () => PAGE, published(pageId), 180000);
ok("P publication de la page de test", done);
await sleep(1500);

async function publicPage(options = {}, url = "/fr/personnages") {
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  const p = await c.newPage();
  p.setDefaultTimeout(45000);
  p.on("pageerror", (e) => errors.push(`public : ${e.message}`));
  await p.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
  return p;
}
const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});

/* ---- H. En-tête ------------------------------------------------------------------------------------------------------------ */
/** Mesures de l'en-tête dans un document (public ou toile de l'éditeur). */
const headerProbe = () => {
  const de = document.documentElement;
  const header = document.querySelector("header.site-header");
  const links = [...document.querySelectorAll("header.site-header a")].filter((a) => a.getClientRects().length > 0);
  const en = links.find((a) => a.textContent?.trim() === "EN");
  const wrapped = links.filter((a) => !a.classList.contains("site-brand") && a.getBoundingClientRect().height > 30 && a.textContent && a.textContent.trim().length > 0 && !a.querySelector("img, svg, picture")).map((a) => a.textContent.trim());
  const rights = links.map((a) => a.getBoundingClientRect().right);
  return {
    sw: de.scrollWidth,
    cw: de.clientWidth,
    iw: innerWidth,
    enRight: en ? en.getBoundingClientRect().right : null,
    maxRight: Math.max(0, ...rights),
    wrapped,
    headerH: header ? Math.round(header.getBoundingClientRect().height) : 0,
  };
};
if (run("H")) {
  const widths = [320, 360, 390, 600, 767, 768, 800, 820, 830, 840, 900, 1000, 1023, 1024, 1100, 1280, 1440, 1920, 2560];
  const bad = [];
  for (const w of widths) {
    const c = await browser.newContext({ viewport: { width: w, height: 900 } });
    const p = await c.newPage();
    for (const url of ["/fr/personnages", "/en"]) {
      await p.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
      const r = await p.evaluate(headerProbe);
      const problems = [];
      if (r.sw > r.cw) problems.push(`défile de côté (${r.sw} > ${r.cw})`);
      if (r.maxRight > r.iw + 0.5) problems.push(`un lien sort de l'écran (${Math.round(r.maxRight)} > ${r.iw})`);
      if (r.enRight !== null && r.enRight > r.iw + 0.5) problems.push(`« EN » coupé (${Math.round(r.enRight)})`);
      if (r.wrapped.length) problems.push(`liens sur deux lignes : ${r.wrapped.join(", ")}`);
      if (problems.length) bad.push(`${w} px ${url} : ${problems.join(" ; ")}`);
      if ([768, 820, 1024].includes(w) && url === "/fr/personnages") await shot(p, `H-public-${w}`);
    }
    await c.close();
  }
  ok(`H1 public : aucun défilement horizontal, « EN » entier, liens sur une ligne (${widths.length} largeurs)`, bad.length === 0, bad.join(" | "));
  for (const w of [768, 800, 830]) {
    const c = await browser.newContext({ viewport: { width: w, height: 900 } });
    const p = await c.newPage();
    await p.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
    const r = await p.evaluate(headerProbe);
    ok(`H2 ${w} px : la page ne défile pas de côté`, r.sw <= r.cw, `${r.sw} > ${r.cw}`);
    await c.close();
  }

  // Éditeur, mode Tablette : la toile (820 px) ne défile pas de côté non plus.
  await page.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
  const handle = await page.waitForSelector("iframe.ve-frame", { timeout: 120000 });
  let fr = await handle.contentFrame();
  await fr.waitForSelector("html[data-edit-mode]", { timeout: 180000 });
  await sleep(1500);
  await page.getByRole("group", { name: "Largeur d'aperçu" }).getByRole("button", { name: "Tablette" }).click();
  await sleep(2500);
  fr = await (await page.waitForSelector("iframe.ve-frame")).contentFrame();
  await fr.waitForSelector("header.site-header", { timeout: 60000 });
  const e = await fr.evaluate(headerProbe);
  ok("H3 éditeur, mode Tablette (820 px) : pas de défilement de côté, « EN » entier", e.sw <= e.cw && (e.enRight === null || e.enRight <= e.iw + 0.5) && e.maxRight <= e.iw + 0.5, JSON.stringify(e));
  await page.screenshot({ path: path.join(SHOTS, "H3-editeur-tablette.png") });
}

/* ---- C. Carrousel avec un panorama et une image très haute, 390 px ------------------------------------------------------------ */
const railProbe = () => {
  const rail = document.querySelector(".strip-rail");
  const viewport = document.querySelector(".strip-viewport");
  if (!rail || !viewport) return null;
  const r = rail.getBoundingClientRect();
  const cs = getComputedStyle(rail);
  const padBottom = parseFloat(cs.paddingBottom) || 0;
  const frames = [...rail.querySelectorAll(":scope > .strip-frame")];
  const vis = frames.filter((f) => {
    const b = f.getBoundingClientRect();
    return Math.min(b.right, innerWidth) - Math.max(b.left, 0) >= 24;
  });
  const contentBottom = Math.max(0, ...vis.map((f) => f.getBoundingClientRect().bottom));
  const caps = [...rail.querySelectorAll(".media-caption")].map((c) => {
    const b = c.getBoundingClientRect();
    return { w: Math.round(b.width), h: Math.round(b.height), t: (c.textContent ?? "").trim().slice(0, 30) };
  });
  return { railH: Math.round(r.height), gap: Math.round(r.bottom - padBottom - contentBottom), visible: vis.length, frames: frames.length, caps: caps.filter((c) => c.t) };
};
if (run("C")) {
  const p = await publicPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await p.locator(".strip-rail").first().scrollIntoViewIfNeeded();
  await sleep(800);
  const a = await p.evaluate(railProbe);
  info(`carrousel au départ : ${JSON.stringify(a)}`);
  await shot(p, "C-390-depart");
  // Lot 99 : la hauteur du rail est CONSTANTE (le vide sous un panorama est voulu, il est centré dans la hauteur de la bande).
  ok("C1 panorama visible dans le rail", a !== null && a.visible >= 1 && a.frames >= 2, JSON.stringify(a));
  ok("C2 légendes lisibles : ni en colonne étroite ni démesurées", a !== null && a.caps.length >= 2 && a.caps.every((c) => c.w >= 80 && c.h <= 110), JSON.stringify(a?.caps));
  // Amener l'image très haute : même exigence.
  await p.evaluate(() => {
    const rail = document.querySelector(".strip-rail");
    const f = rail.querySelectorAll(":scope > .strip-frame")[1];
    rail.scrollTo({ left: f.offsetLeft - 16, behavior: "instant" });
  });
  await sleep(900);
  const b = await p.evaluate(railProbe);
  info(`carrousel sur l'image haute : ${JSON.stringify(b)}`);
  await shot(p, "C-390-haute");
  ok("C3 image très haute visible : légendes lisibles, et le rail a la même hauteur que sur le panorama (lot 99)", b !== null && b.railH === a.railH && b.caps.every((c) => c.w >= 80 && c.h <= 110), JSON.stringify(b));
  const pageW = await p.evaluate(() => [document.documentElement.scrollWidth, innerWidth]);
  ok("C4 la page ne défile pas de côté", pageW[0] <= pageW[1], pageW.join(" > "));
  await p.context().close();
}

/* ---- R. Image recadrée minuscule : aucune 404 ------------------------------------------------------------------------------- */
if (run("R")) {
  for (const [w, h] of [
    [1440, 900],
    [390, 844],
  ]) {
    const c = await browser.newContext({ viewport: { width: w, height: h } });
    const p = await c.newPage();
    const bad = [];
    p.on("response", (r) => {
      if (r.status() >= 400) bad.push(`${r.status()} ${new URL(r.url()).pathname}`);
    });
    await p.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
    for (let y = 0; y < 14; y++) {
      await p.mouse.wheel(0, 700);
      await sleep(250);
    }
    await p.waitForLoadState("networkidle");
    ok(`R1 ${w} px : aucune réponse en erreur (404) sur la page`, bad.length === 0, bad.join(" | "));
    const urls = await p.evaluate(() => {
      const out = new Set();
      for (const el of document.querySelectorAll("img[data-cropped], img[data-cropped] ~ *, picture:has(img[data-cropped]) source")) {
        for (const s of [el.getAttribute("srcset"), el.getAttribute("src")]) for (const part of (s ?? "").split(",")) if (part.trim()) out.add(part.trim().split(/\s+/)[0]);
      }
      return [...out];
    });
    ok(`R2 ${w} px : l'image recadrée a des variantes recadrées`, urls.some((u) => u.includes("/media/crop/")), urls.join(" "));
    const codes = [];
    for (const u of urls) codes.push(`${(await p.request.get(new URL(u, BASE).toString())).status()} ${u.split("/").slice(-1)[0]}`);
    ok(`R3 ${w} px : chaque variante recadrée se lit (200)`, codes.length > 0 && codes.every((x) => x.startsWith("200")), codes.join(" | "));
    await c.close();
  }
}

/* ---- D. Définition à DPR 2 ----------------------------------------------------------------------------------------------------- */
if (run("D")) {
  const originals = new Map();
  for (const m of sql((db) => db.prepare("select original_name, width, height, variants from media where original_name like '67-%'").all())) {
    for (const f of JSON.parse(m.variants ?? "{\"files\":[]}").files ?? []) originals.set(f.key.split("/")[1], { name: m.original_name, w: m.width, h: m.height });
  }
  const measure = async (p, rootSel) =>
    p.evaluate(async (sel) => {
      const out = [];
      for (const el of document.querySelectorAll(`${sel} img`)) {
        if (!el.currentSrc || !el.currentSrc.includes("/img/")) continue;
        const b = el.getBoundingClientRect();
        if (b.width < 40) continue;
        const probe = new Image();
        probe.src = el.currentSrc;
        await probe.decode().catch(() => {});
        out.push({ src: el.currentSrc, css: Math.round(b.width), px: probe.naturalWidth });
      }
      return out;
    }, rootSel);
  const verdict = (rows) =>
    rows.map((r) => {
      const o = originals.get(r.src.split("/img/")[1]?.split("/")[0]);
      if (!o) return null;
      const want = Math.min(2 * r.css, o.w);
      return { name: o.name, css: r.css, px: r.px, want, good: r.px >= want - 1 };
    }).filter(Boolean);
  for (const [w, h] of [
    [1440, 900],
    [390, 844],
  ]) {
    const p = await publicPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
    for (let y = 0; y < 14; y++) {
      await p.mouse.wheel(0, 700);
      await sleep(250);
    }
    await p.waitForLoadState("networkidle");
    await sleep(800);
    const rows = verdict(await measure(p, "#contenu"));
    info(`DPR 2, ${w} px : ${JSON.stringify(rows)}`);
    const grand = rows.filter((r) => r.name === "67-grand.png");
    ok(`D1 ${w} px, DPR 2 : la grande image est servie à >= 2 fois sa taille affichée (dans la limite de l'original)`, grand.length > 0 && grand.every((r) => r.good), JSON.stringify(grand));
    ok(`D2 ${w} px, DPR 2 : toutes les images de la page respectent la règle`, rows.length >= 3 && rows.every((r) => r.good), JSON.stringify(rows.filter((r) => !r.good)));
    // Visionneuse sur la grande image.
    const trigger = p.locator("[data-viewer-item]").filter({ has: p.locator("img") });
    const n = await trigger.count();
    let opened = false;
    for (let i = 0; i < n && !opened; i++) {
      const t = trigger.nth(i);
      const alt = await t.locator("img").first().evaluate((e) => e.currentSrc).catch(() => "");
      if (originals.get(alt.split("/img/")[1]?.split("/")[0])?.name === "67-grand.png") {
        await t.scrollIntoViewIfNeeded();
        await t.click();
        opened = true;
      }
    }
    if (opened) {
      await p.locator(".lightbox").waitFor();
      await waitFor(() => p.locator(".lightbox-stage figure img:not(.lb-preview)").first().evaluate((i) => i.complete && i.naturalWidth > 0 && getComputedStyle(i).opacity === "1").catch(() => false), 45000);
      const lrows = verdict(await measure(p, ".lightbox-stage figure"));
      info(`visionneuse DPR 2, ${w} px : ${JSON.stringify(lrows)}`);
      ok(`D3 ${w} px, DPR 2 : la visionneuse sert une variante >= 2 fois la taille affichée (dans la limite de l'original)`, lrows.length > 0 && lrows.every((r) => r.good), JSON.stringify(lrows));
    } else ok(`D3 ${w} px : image à ouvrir dans la visionneuse trouvée`, false, "aucun déclencheur");
    await p.context().close();
  }
}

/* ---- N. Noms des images d'un projet ---------------------------------------------------------------------------------------------- */
if (run("N")) {
  // Huit images au total pour que la liste soit « longue » (la recherche apparaît).
  sql((db) => {
    const base = db.prepare("select max(position) as p from slots where project_id = ?").get(PROJECT.id).p ?? 0;
    const media = [MINI, GRAND, PANO, HAUT, CARRE];
    media.forEach((m, i) => {
      const slug = `essai-67-${i}`;
      if (db.prepare("select 1 from slots where slug = ?").get(slug)) return;
      db.prepare(
        "insert into slots (project_id, position, media_id, slug, collection, title, description, year, featured, reel) values (?, ?, ?, ?, 'characters', ?, ?, 2024, 0, 0)",
      ).run(PROJECT.id, base + 1 + i, m, slug, JSON.stringify(T("")), JSON.stringify(T("")));
    });
  });
  await page.goto(`${BASE}/admin/projets/${PROJECT.id}`, { waitUntil: "networkidle" });
  await page.locator(".a-slot").first().waitFor();
  const labels = await page.locator(".a-slot .a-slot-title").allTextContents();
  info(`noms affichés : ${JSON.stringify(labels)}`);
  ok("N1 plus aucun « Emplacement N » sur les images du projet", labels.length >= 6 && labels.every((l) => !/^Emplacement \d+$/.test(l.trim())), JSON.stringify(labels));
  ok("N2 une image sans titre porte le nom de son fichier", labels.some((l) => l.trim() === "67-carre.png") && labels.some((l) => l.trim() === "67-mini.png"), JSON.stringify(labels));
  ok("N3 une image avec un titre garde son titre", labels.some((l) => l.trim() === "Panorama d'essai"), JSON.stringify(labels));
  await page.screenshot({ path: path.join(SHOTS, "N-projet.png") });
  const search = page.getByRole("searchbox", { name: /Chercher une image du projet/ });
  ok("N4 liste longue : un champ « Chercher une image du projet »", (await search.count()) === 1);
  if (await search.count()) {
    await search.fill("mini");
    await sleep(500);
    const found = await page.locator(".a-slot[data-found]").count();
    const hidden = await page.locator(".a-slot[data-dim]").count();
    ok("N5 la recherche par nom repère les images trouvées et estompe les autres", found === 1 && hidden >= 4, `trouvées ${found}, estompées ${hidden}`);
    await search.fill("zzzz");
    await sleep(300);
    ok("N6 aucune image trouvée : message clair", (await page.getByText("Aucune image ne porte ce nom").count()) >= 1);
    await search.fill("");
  }
  const tile = page.locator(".a-slot", { has: page.locator(".a-slot-title", { hasText: "67-carre.png" }) }).first();
  await tile.locator(".a-slot-image").click();
  const panelTitle = (await page.locator("#sp-title").first().innerText()).trim();
  ok("N7 le volet de modification porte le nom de l'image", panelTitle === "67-carre.png", panelTitle);
}

ok("aucune erreur JavaScript dans les pages", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout est bon.");
process.exit(failures ? 1 : 0);
