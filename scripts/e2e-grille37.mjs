#!/usr/bin/env node
/**
 * Lot 37 « grille justifiée » (chromium, serveur requis, base neuve, une connexion admin) : en « Automatique » (format Libre),
 * les images d'une même rangée ont la même hauteur et ne sont pas recadrées.
 *  A  Toile, page : carré + 2/3 (même hauteur, largeur affichée / hauteur = format), portrait + paysage, 3 images mélangées.
 *  B  Toile, planche de projet : la même chose ; préréglage « 2 côte à côte » inchangé (cases égales).
 *  C  Publication : public = toile, page ET planche, aucun repère d'édition, aucune image perdue, ordre gardé.
 *  D  Téléphone 390 px : deux paysages côte à côte ; carré + 2/3 trop étroit, une image par ligne ; pas de débordement.
 * Captures : $SHOTS. Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=A,B,C,D] [SHOTS=dossier] node scripts/e2e-grille37.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";
import sharp from "sharp";

import { boardPublished, grid, img, login, makeMedia, openEditor, pageIdOf, q1, setBoardDraft, setDraft, sleep, sql, waitFor } from "./lib/grille31d.mjs";

const BASE = process.env.BASE ?? "http://localhost:3510";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(process.env.DATA_DIR ?? tmpdir(), "shots", "grille37");
mkdirSync(SHOTS, { recursive: true });
sharp.cache(false);
sharp.concurrency(1);

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);
const M = await makeMedia(page, BASE);
const pageId = pageIdOf("personnages");
const project = q1("select id, slug from projects order by id limit 1");
const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});

/** Boîtes des cases et de leur image (relatives à la grille) dans un document (toile ou public). */
const measure = (doc, sel) =>
  doc.evaluate((s) => {
    const g = document.querySelectorAll(s)[0];
    const gb = g.getBoundingClientRect();
    return [...g.querySelectorAll(":scope > .block-grid-cell")].map((c) => {
      const r = c.getBoundingClientRect();
      const m = c.querySelector(".block-image-media")?.getBoundingClientRect();
      return { free: c.hasAttribute("data-edit-cell-free"), idx: c.dataset.cellIndex, left: r.left - gb.left, top: r.top - gb.top, width: r.width, height: r.height, gw: gb.width, iw: m?.width ?? 0, ih: m?.height ?? 0 };
    });
  }, sel);
const rowsOf = (cells) => {
  const by = new Map();
  for (const c of cells.filter((x) => !x.free)) by.set(Math.round(c.top), [...(by.get(Math.round(c.top)) ?? []), c]);
  return [...by.values()];
};
/** Chaque rangée : même hauteur d'image (+-2 px) et image non recadrée (largeur / hauteur affichées = format). */
const justified = (cells, ratios, label) => {
  const rows = rowsOf(cells).filter((r) => r.length > 1);
  ok(`${label} : au moins une rangée de deux images`, rows.length > 0);
  for (const r of rows) ok(`${label} : même hauteur dans la rangée (${r.map((c) => Math.round(c.ih)).join(" / ")} px)`, r.every((c) => near(c.ih, r[0].ih, 2)));
  cells.filter((c) => !c.free).forEach((c, i) => ok(`${label} : image ${i + 1} non recadrée (${(c.iw / c.ih).toFixed(3)} pour ${ratios[i].toFixed(3)})`, c.ih > 0 && Math.abs(c.iw / c.ih - ratios[i]) / ratios[i] < 0.02));
};
const withCanvas = async (blocks, board) => {
  if (board) {
    setDraft(pageId, [{ uid: "board1", type: "project-board", props: { project: project.slug } }]);
    setBoardDraft(project.id, pageId, board);
  } else setDraft(pageId, blocks);
  const fr = await openEditor(page, BASE, pageId);
  return fr;
};
const center = async (fr, sel) => {
  await fr.locator(sel).first().evaluate((el) => el.scrollIntoView({ block: "center" }));
  await sleep(1200);
};

try {
  if (run("A")) {
    const fr = await withCanvas([grid("a1", { layout: "auto" }, [img("a1a", M.carre), img("a1b", M.portrait)])]);
    const G = '[data-edit-block="a1"] .block-grid';
    await center(fr, G);
    let r = await measure(fr, G);
    justified(r, [1, 2 / 3], "A1 carré + 2/3 (toile)");
    const real = r.filter((c) => !c.free);
    ok("A1b séparation ≈ 60 / 40", near(real[0].width / (real[0].width + real[1].width), 0.6, 0.015), JSON.stringify(real.map((c) => c.width)));
    ok("A1c l'image n'est pas centrée dans une case plus large : l'image remplit sa case", real.every((c) => near(c.iw, c.width, 2)), JSON.stringify(real.map((c) => [c.width, c.iw])));
    await shot("A-carre-23");

    setDraft(pageId, [grid("a2", { layout: "auto" }, [img("a2a", M.portrait), img("a2b", M.paysage)])]);
    await openEditor(page, BASE, pageId).then(async (f) => { await center(f, '[data-edit-block="a2"] .block-grid'); r = await measure(f, '[data-edit-block="a2"] .block-grid'); });
    justified(r, [2 / 3, 3 / 2], "A2 portrait + paysage (toile)");
    await shot("A-portrait-paysage");

    setDraft(pageId, [grid("a3", { layout: "auto", cols: 3 }, [img("a3a", M.portrait), img("a3b", M.paysage), img("a3c", M.carre), img("a3d", M.panorama), img("a3e", M.paysage2)])]);
    await openEditor(page, BASE, pageId).then(async (f) => { await center(f, '[data-edit-block="a3"] .block-grid'); r = await measure(f, '[data-edit-block="a3"] .block-grid'); });
    justified(r, [2 / 3, 3 / 2, 1, 3, 3 / 2], "A3 trois mélangées + panorama (toile)");
    const rr = r.filter((c) => !c.free);
    ok("A3b panorama pleine largeur sur sa rangée", near(rr[3].width, rr[3].gw, 2));
    ok("A3c ordre gardé et aucune image perdue", rr.length === 5 && rr.every((c, i) => Number(c.idx) === i));
    ok("A3d la case vide ne casse pas la mise en page (nombre de places libres = 1)", r.filter((c) => c.free).length === 1);
    await shot("A-trois-melangees");
  }

  if (run("B")) {
    const fr = await withCanvas(null, [
      grid("b1", { layout: "auto" }, [img("b1a", M.carre), img("b1b", M.portrait)]),
      grid("b2", { layout: "2" }, [img("b2a", M.carre), img("b2b", M.portrait)]),
    ]);
    const G1 = '[data-edit-bitem="b1"] .block-grid';
    const G2 = '[data-edit-bitem="b2"] .block-grid';
    await center(fr, G1);
    const r = await measure(fr, G1);
    justified(r, [1, 2 / 3], "B1 carré + 2/3 (planche, toile)");
    await shot("B-planche");
    await center(fr, G2);
    const p = await measure(fr, G2);
    const pr = p.filter((c) => !c.free);
    ok("B2 préréglage « 2 côte à côte » inchangé : deux colonnes égales", near(pr[0].width, pr[1].width, 2) && !(await fr.locator(`${G2}[data-justify]`).count()), JSON.stringify(pr.map((c) => c.width)));
  }

  if (run("C")) {
    setDraft(pageId, [
      grid("c1", { layout: "auto" }, [img("c1a", M.carre), img("c1b", M.portrait), img("c1c", M.paysage)]),
      grid("c2", { layout: "2" }, [img("c2a", M.carre), img("c2b", M.portrait)]),
      { uid: "board1", type: "project-board", props: { project: project.slug } },
    ]);
    setBoardDraft(project.id, pageId, [grid("c3", { layout: "auto" }, [img("c3a", M.carre), img("c3b", M.portrait)])]);
    await openEditor(page, BASE, pageId);
    await page.getByRole("button", { name: "Publier", exact: true }).click();
    ok("C1 publié", await waitFor(() => sql((db) => db.prepare("select draft from pages where id = ?").get(pageId)).draft === null && boardPublished(project.id)?.[0]?.uid === "c3", 90000));
    await sleep(2500);
    const html = await (await fetch(`${BASE}/fr/personnages`)).text();
    ok("C2 public : rangées justifiées, aucun repère d'édition", /data-justify/.test(html) && !/data-edit-|pe-cell|data-cell-/.test(html.replace(/<script[\s\S]*?<\/script>/g, "")));
    const pub = await (await browser.newContext()).newPage();
    await pub.setViewportSize({ width: 1180, height: 900 });
    await pub.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
    const grids = [".block-grid >> nth=0"];
    void grids;
    const pm = (i) => pub.evaluate((n) => {
      const g = document.querySelectorAll(".block-grid")[n];
      const gb = g.getBoundingClientRect();
      return [...g.querySelectorAll(":scope > .block-grid-cell")].map((c) => {
        const r = c.getBoundingClientRect();
        const m = c.querySelector(".block-image-media")?.getBoundingClientRect();
        return { free: false, idx: c.dataset.cellIndex, left: r.left - gb.left, top: r.top - gb.top, width: r.width, height: r.height, gw: gb.width, iw: m?.width ?? 0, ih: m?.height ?? 0 };
      });
    }, i);
    const a = await pm(0);
    justified(a, [1, 2 / 3, 3 / 2], "C3 page (public)");
    ok("C3b page : 3 images, ordre gardé (carré, 2/3, paysage)", a.length === 3 && a[0].left < a[1].left && a[2].top > a[0].top);
    const pre = await pm(1);
    ok("C4 préréglage inchangé en public", near(pre[0].width, pre[1].width, 2));
    const b = await pm(2);
    justified(b, [1, 2 / 3], "C5 planche (public)");
    await pub.screenshot({ path: path.join(SHOTS, "C-public.png"), fullPage: true });

    await pub.setViewportSize({ width: 390, height: 844 });
    await pub.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
    const ph = await pub.evaluate(() => ({ overflow: document.documentElement.scrollWidth - window.innerWidth }));
    const p0 = await pm(0);
    ok("D1 téléphone : pas de débordement horizontal", ph.overflow <= 0, JSON.stringify(ph));
    ok("D2 téléphone : carré + 2/3 trop étroit (< 140 px) donc une image par ligne", near(p0[0].left, p0[1].left, 1) && p0[1].top > p0[0].top, JSON.stringify(p0.map((c) => [c.left, c.top, c.width])));
    ok("D3 téléphone : aucune image sous 140 px sur les grilles justifiées", p0.every((c) => c.width >= 138) && (await pm(2)).every((c) => c.width >= 138));
    await pub.screenshot({ path: path.join(SHOTS, "D-telephone.png"), fullPage: true });

    // Deux paysages tiennent côte à côte sur téléphone.
    await pub.close();
    setDraft(pageId, [grid("d1", { layout: "auto" }, [img("d1a", M.paysage), img("d1b", M.paysage2)])]);
    await openEditor(page, BASE, pageId);
    await page.getByRole("button", { name: "Publier", exact: true }).click();
    await waitFor(() => sql((db) => db.prepare("select draft from pages where id = ?").get(pageId)).draft === null, 90000);
    await sleep(2500);
    const pub2 = await (await browser.newContext()).newPage();
    await pub2.setViewportSize({ width: 390, height: 844 });
    await pub2.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
    const d = await pub2.evaluate(() => [...document.querySelectorAll(".block-grid > .block-grid-cell")].map((c) => { const r = c.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width }; }));
    ok("D4 téléphone : deux paysages côte à côte (≥ 140 px)", d.length === 2 && near(d[0].top, d[1].top, 1) && d.every((c) => c.width >= 140), JSON.stringify(d));
    await pub2.screenshot({ path: path.join(SHOTS, "D-telephone-paysages.png"), fullPage: true });
    await pub2.close();
  }
} catch (e) {
  failures++;
  console.log(`FAIL exception — ${e.stack ?? e}`);
  await shot("erreur");
}

ok("aucune erreur JavaScript sur la page de l'éditeur", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\ntout est passé");
process.exit(failures ? 1 : 0);
