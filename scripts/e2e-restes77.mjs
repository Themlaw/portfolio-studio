#!/usr/bin/env node
/**
 * Lot 77 « restes de la v0.30 » (chromium, serveur requis, base neuve, une connexion admin). Images de test générées.
 *  M  MENU-11 : « Cadrer l'image » est modale : un voile couvre le panneau et la barre de l'éditeur (page parente) tant que la fenêtre
 *     de la toile est ouverte ; Échap et Annuler la ferment et lèvent le voile.
 *  C  Carrousel : en défilant vers une image plus haute, ce qui suit la bande ne saute pas (mouvement étalé dans le temps) et la hauteur
 *     finale suit toujours les images vues (règle du lot 67).
 *  K  Export du kit PSD (modèle fanzine-riso, le plus lent) : durée mesurée, sous 60 s.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=M,C,K] [SHOTS=dossier] node scripts/e2e-restes77.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { chromium } from "playwright";

import { paint } from "./lib/crop-fixtures.mjs";
import { canvas, setDraft, sql } from "./lib/grille31d.mjs";
import { login, pageIdOf, q1, waitFor } from "./lib/medias-setup.mjs";

const BASE = process.env.BASE ?? "http://localhost:3880";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(process.env.BATTERY_DIR ?? tmpdir(), "shots-restes77");
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


/* ---- Contenu de la page de test --------------------------------------------------------------------------------------------- */
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
const PAGE = [{ uid: "pbd", type: "project-board", props: { project: PROJECT.slug } }, img("grand", GRAND), text("t1", "Texte de fin.")];
const done = await publishBlocks(page, BASE, pageId, () => PAGE, published(pageId), 180000);
ok("P publication de la page de test", done);
await sleep(1500);

/* ---- M. Cadrer l'image est modale (MENU-11) --------------------------------------------------------------------------------- */
if (run("M")) {
  setDraft(pageId, [img("e-grand", GRAND), text("t1", "Texte.")]);
  await page.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
  const f = await canvas(page);
  await sleep(2000);
  const target = f.locator('[data-edit-block="e-grand"] img.block-image-media').first();
  await target.scrollIntoViewIfNeeded();
  await target.hover();
  await f.locator(".lk-crop-btn").waitFor();
  ok("M0 sans fenêtre ouverte : aucun voile, panneau actif", (await page.getByTestId("ve-veil").count()) === 0 && (await page.locator("aside.ve-panel[inert]").count()) === 0);
  await f.locator(".lk-crop-btn").click();
  await f.locator(".lk-crop").waitFor();
  ok("M1 fenêtre ouverte : un voile couvre l'éditeur", await waitFor(async () => (await page.getByTestId("ve-veil").count()) === 1, 10000));
  const hit = await page.evaluate(() => {
    const out = {};
    for (const [name, sel] of [["panneau", "aside.ve-panel"], ["barre", "header.ve-top"]]) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const b = el.getBoundingClientRect();
      const top = document.elementFromPoint(b.left + b.width / 2, b.top + Math.min(40, b.height / 2));
      out[name] = { covered: top?.getAttribute("data-testid") === "ve-veil", inert: el.hasAttribute("inert") };
    }
    return out;
  });
  ok("M2 le panneau est voilé et inerte (clic et clavier)", hit.panneau?.covered === true && hit.panneau?.inert === true, JSON.stringify(hit));
  ok("M3 la barre du haut est voilée et inerte", hit.barre?.covered === true && hit.barre?.inert === true, JSON.stringify(hit));
  await page.screenshot({ path: path.join(SHOTS, "M-modale.png") });
  const onFrame = await page.evaluate(() => {
    const fr = document.querySelector("iframe.ve-frame").getBoundingClientRect();
    return document.elementFromPoint(fr.left + fr.width / 2, fr.top + fr.height / 2)?.tagName;
  });
  ok("M4 la toile reste au-dessus du voile (la fenêtre se manipule)", onFrame === "IFRAME", String(onFrame));
  await f.locator(".lk-crop").focus();
  await page.keyboard.press("Escape");
  ok("M5 Échap ferme la fenêtre ET lève le voile", (await waitFor(async () => (await f.locator(".lk-crop").count()) === 0, 10000)) && (await waitFor(async () => (await page.getByTestId("ve-veil").count()) === 0, 10000)));
  await target.hover();
  await f.locator(".lk-crop-btn").click();
  await f.locator(".lk-crop").waitFor();
  ok("M6 réouverte : voile de nouveau", await waitFor(async () => (await page.getByTestId("ve-veil").count()) === 1, 10000));
  await f.locator(".lk-crop").getByRole("button", { name: "Fermer sans enregistrer" }).click();
  ok("M7 « Fermer sans enregistrer » ferme la fenêtre ET lève le voile", (await waitFor(async () => (await f.locator(".lk-crop").count()) === 0, 10000)) && (await waitFor(async () => (await page.getByTestId("ve-veil").count()) === 0, 10000)));
  ok("M8 panneau de nouveau actif", (await page.locator("aside.ve-panel[inert]").count()) === 0);
}

/* ---- C. Carrousel : pas de saut du bloc suivant ----------------------------------------------------------------------------- */
async function publicPage(options = {}, url = "/fr/personnages") {
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  const p = await c.newPage();
  p.setDefaultTimeout(45000);
  p.on("pageerror", (e) => errors.push(`public : ${e.message}`));
  await p.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
  return p;
}
if (run("C")) {
  for (const [w, h] of [[390, 844], [1440, 900]]) {
    const p = await publicPage({ viewport: { width: w, height: h } });
    await p.locator(".strip-rail").first().scrollIntoViewIfNeeded();
    await sleep(900);
    const res = await p.evaluate(async () => {
      const rail = document.querySelector(".strip-rail");
      // Bloc qui suit la bande : premier frère suivant (en remontant) qui a une hauteur.
      let el = rail.closest(".strip-viewport") ?? rail;
      let next = null;
      while (el && !next) {
        let s = el.nextElementSibling;
        while (s && !s.getBoundingClientRect().height) s = s.nextElementSibling;
        if (s) next = s;
        else el = el.parentElement;
      }
      const pos = () => next.getBoundingClientRect().top + scrollY;
      const frames = [...rail.querySelectorAll(":scope > .strip-frame")];
      const tall = frames[1];
      const before = pos();
      rail.scrollTo({ left: tall.offsetLeft - 16, behavior: "smooth" });
      const samples = [pos()];
      const t0 = performance.now();
      await new Promise((resolve) => {
        const tick = () => {
          samples.push(pos());
          if (performance.now() - t0 < 2200) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
      let maxStep = 0;
      for (let i = 1; i < samples.length; i++) maxStep = Math.max(maxStep, Math.abs(samples[i] - samples[i - 1]));
      const after = samples.at(-1);
      const cs = getComputedStyle(rail);
      const visible = frames.filter((f) => {
        const b = f.getBoundingClientRect();
        return Math.min(b.right, innerWidth) - Math.max(b.left, 0) >= 24;
      });
      const gap = rail.getBoundingClientRect().bottom - (parseFloat(cs.paddingBottom) || 0) - Math.max(0, ...visible.map((f) => f.getBoundingClientRect().bottom));
      return { before, after, total: Math.abs(after - before), maxStep, frames: samples.length, gap: Math.round(gap) };
    });
    info(`carrousel ${w} px : ${JSON.stringify(res)}`);
    // Un saut franc fait tout le déplacement en un pas ; étalé dans le temps, le pas reste une petite fraction du total.
    ok(`C1 ${w} px : le bloc suivant ne saute pas (pas max ${res.maxStep.toFixed(1)} px pour ${res.total.toFixed(0)} px au total)`, res.total < 4 || res.maxStep <= Math.max(2, res.total * 0.15), JSON.stringify(res));
    ok(`C2 ${w} px : la hauteur finale suit les images vues (pas de vide de plus de 24 px)`, res.gap <= 24, JSON.stringify(res));
    await p.context().close();
  }
}

/* ---- K. Export du kit : durée ------------------------------------------------------------------------------------------------ */
if (run("K")) {
  const out = path.join(tmpdir(), `restes77-kit-${process.pid}`);
  const t0 = Date.now();
  const stdout = execFileSync("node", ["--expose-gc", "--max-old-space-size=256", "--import", "tsx", "scripts/kit-poc/export-kit-multi.mts", out, "fanzine-riso"], { encoding: "utf8", timeout: 240000, maxBuffer: 1 << 24 });
  const wall = Date.now() - t0;
  const line = stdout.split("\n").find((l) => l.startsWith("{"));
  const stats = line ? JSON.parse(line) : null;
  info(`export du kit fanzine-riso : ${stats?.ms} ms (total ${wall} ms), pic ${stats?.peakMb} Mo`);
  ok(`K1 export du kit fanzine-riso en moins de 60 s (${Math.round((stats?.ms ?? 0) / 1000)} s)`, Boolean(stats) && stats.ms < 60000);
  // Le plafond de mémoire de l'enfant (650 Mo) est vérifié par montheme60 (B1) : l'export y passe par le vrai processus enfant.
}

ok("aucune erreur JavaScript dans les pages", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout est bon.");
process.exit(failures ? 1 : 0);
