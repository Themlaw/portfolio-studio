#!/usr/bin/env node
/**
 * Lot 37 « grille justifiée » (chromium, serveur requis, base neuve, une connexion admin) : en « Automatique » (format Libre),
 * les images d'une même rangée ont la même hauteur et ne sont pas recadrées.
 *  A  Toile, page : carré + 2/3 (même hauteur, largeur affichée / hauteur = format), portrait + paysage, 3 images mélangées.
 *  B  Toile, planche de projet : la même chose ; préréglage « 2 » + Carré inchangé (cases égales).
 *  C  Publication : public = toile, page ET planche, aucun repère d'édition, aucune image perdue, ordre gardé.
 *  E  (lot 37b) Préréglage « 3 » + Libre justifié (toile + public) ; « 3 » + Carré et « Portrait à gauche + 2 » inchangés ;
 *     menu Taille : « Seule sur sa ligne » puis « Avec les autres » (vrais clics) ; téléphone 390 px.
 *  F  (lot 46) « Sur mesure » + Libre justifié (toile + public + téléphone) ; case pleine largeur = seule sur sa ligne ; « Sur mesure » + Carré
 *     inchangé ; « Portrait à gauche + 2 » + Libre justifié avec son aide, + Carré inchangé ; menu Taille (vrais clics) : « Seule sur sa ligne » puis « Avec les autres ».
 *  D  Téléphone 390 px : deux paysages côte à côte ; carré + 2/3 trop étroit, une image par ligne ; pas de débordement.
 * Captures : $SHOTS. Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=A,B,C,D] [SHOTS=dossier] node scripts/e2e-grille37.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";
import sharp from "sharp";

import { boardPublished, draftBlocks, grid, img, login, makeMedia, openEditor, pageIdOf, q1, setBoardDraft, setDraft, sleep, sql, waitFor } from "./lib/grille31d.mjs";

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
      grid("b2", { layout: "2", ratio: "1:1" }, [img("b2a", M.carre), img("b2b", M.portrait)]),
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
    ok("B2 préréglage « 2 » + Carré inchangé : deux colonnes égales", near(pr[0].width, pr[1].width, 2) && !(await fr.locator(`${G2}[data-justify]`).count()), JSON.stringify(pr.map((c) => c.width)));
  }

  if (run("C")) {
    setDraft(pageId, [
      grid("c1", { layout: "auto" }, [img("c1a", M.carre), img("c1b", M.portrait), img("c1c", M.paysage)]),
      grid("c2", { layout: "2", ratio: "1:1" }, [img("c2a", M.carre), img("c2b", M.portrait)]),
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
  if (run("E")) {
    // E1 « 3 côte à côte » + Libre : justifié sur la toile (3 images de formats différents sur une rangée).
    const fr = await withCanvas([grid("e1", { layout: "3" }, [img("e1a", M.carre), img("e1b", M.portrait), img("e1c", M.paysage), img("e1d", M.carre)])]);
    const G = '[data-edit-block="e1"] .block-grid';
    await center(fr, G);
    let r = await measure(fr, G);
    justified(r, [1, 2 / 3, 3 / 2, 1], "E1 « 3 » + Libre (toile)");
    const real = r.filter((c) => !c.free);
    ok("E1b trois images sur la première rangée, la quatrième dessous", near(real[0].top, real[1].top, 1) && near(real[1].top, real[2].top, 1) && real[3].top > real[0].top, JSON.stringify(real.map((c) => c.top)));
    ok("E1c ordre gardé, quatre images, une place libre", real.length === 4 && real.every((c, i) => Number(c.idx) === i) && r.filter((c) => c.free).length === 1);
    await shot("E-3-libre-toile");

    // E2 « 3 » + Carré : cases égales recadrées (inchangé) ; E3 « Portrait à gauche + 2 » + Libre : inchangé.
    setDraft(pageId, [
      grid("e2", { layout: "3", ratio: "1:1" }, [img("e2a", M.carre), img("e2b", M.portrait), img("e2c", M.paysage)]),
      grid("e3", { layout: "portrait-left" }, [img("e3a", M.portrait), img("e3b", M.carre), img("e3c", M.paysage)]),
    ]);
    const f2 = await openEditor(page, BASE, pageId);
    await center(f2, '[data-edit-block="e2"] .block-grid');
    r = (await measure(f2, '[data-edit-block="e2"] .block-grid')).filter((c) => !c.free);
    ok("E2 « 3 » + Carré inchangé : trois cases égales, images carrées", r.every((c) => near(c.width, r[0].width, 2) && near(c.iw, c.ih, 2)) && !(await f2.locator('[data-edit-block="e2"] .block-grid[data-justify]').count()), JSON.stringify(r.map((c) => [c.width, c.iw, c.ih])));
    await center(f2, '[data-edit-block="e3"] .block-grid');
    r = (await measure(f2, '[data-edit-block="e3"] .block-grid')).filter((c) => !c.free);
    ok("E3 « Portrait à gauche + 2 » + Libre : justifié aussi (lot 46)", !!(await f2.locator('[data-edit-block="e3"] .block-grid[data-justify]').count()) && r.every((c, i) => i === 0 || near(c.ih, r[0].ih, 2) || c.top > r[0].top), JSON.stringify(r.map((c) => [c.left, c.top, c.height])));
    await shot("E-inchanges");

    // E4 Taille : « Seule sur sa ligne » puis « Avec les autres », vrais clics sur la toile.
    setDraft(pageId, [grid("e4", { layout: "3" }, [img("e4a", M.carre), img("e4b", M.portrait), img("e4c", M.paysage), img("e4d", M.carre)])]);
    const f4 = await openEditor(page, BASE, pageId);
    const G4 = '[data-edit-block="e4"] .block-grid';
    await center(f4, G4);
    const hoverCell = async (i) => {
      const c = f4.locator(`${G4} > .block-grid-cell[data-cell-index="${i}"]`);
      await c.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await sleep(600);
      const b = await c.boundingBox();
      await page.mouse.move(b.x + b.width / 2 + 3, b.y + b.height / 3);
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 3 + 2, { steps: 3 });
      await f4.locator('[data-testid="cellbar"]').waitFor({ timeout: 10000 });
      await sleep(300);
    };
    const click = async (loc) => {
      const b = await loc.boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 3 });
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    };
    const sizeChoose = async (name) => {
      await click(f4.locator('[data-testid="cellbar"] [data-cb="size"]'));
      const item = f4.locator(`.pe-gridmenu [data-cb="${name}"]`);
      await item.waitFor({ timeout: 5000 });
      ok(`E4 menu Taille justifié : « ${(await item.innerText()).trim()} »`, true);
      await click(item);
      await sleep(1800);
    };
    await hoverCell(1);
    await click(f4.locator('[data-testid="cellbar"] [data-cb="size"]'));
    const labels = await f4.locator(".pe-gridmenu [data-cb]").allInnerTexts();
    ok("E4a le menu Taille ne propose que deux choix (plus de Plus large / Plus haute)", labels.map((s) => s.trim()).join("|") === "Seule sur sa ligne|Avec les autres", labels.join("|"));
    await page.keyboard.press("Escape");
    await hoverCell(1);
    await sizeChoose("alone");
    r = await measure(f4, G4);
    const al = r.filter((c) => !c.free);
    ok("E4b « Seule sur sa ligne » : l'image n° 2 occupe toute la largeur sur sa propre rangée", near(al[1].width, al[1].gw, 2) && al[1].top > al[0].top && al[2].top > al[1].top, JSON.stringify(al.map((c) => [c.top, c.width])));
    ok("E4c elle reste non recadrée et la grille est restée en préréglage (pas de Sur mesure)", near(al[1].iw / al[1].ih, 2 / 3, 0.02) && (await f4.locator(`${G4}[data-layout="3"]`).count()) === 1);
    ok("E4d draft : seul le drapeau change", JSON.stringify(draftBlocks(pageId)[0].props.alone) === "[false,true,false,false]" && draftBlocks(pageId)[0].props.layout === "3" && !draftBlocks(pageId)[0].props.spans);
    await shot("E-seule");
    await hoverCell(1);
    await sizeChoose("with-others");
    r = (await measure(f4, G4)).filter((c) => !c.free);
    ok("E4e « Avec les autres » : retour à trois images sur la rangée", near(r[0].top, r[1].top, 1) && near(r[1].top, r[2].top, 1) && !draftBlocks(pageId)[0].props.alone, JSON.stringify(r.map((c) => c.top)));

    // E5 public et téléphone : « 3 » + Libre justifié, une image seule sur sa ligne, aucune image perdue.
    setDraft(pageId, [
      grid("e5", { layout: "3", alone: [false, false, true, false] }, [img("e5a", M.carre), img("e5b", M.paysage), img("e5c", M.portrait), img("e5d", M.carre)]),
      grid("e6", { layout: "3", ratio: "1:1" }, [img("e6a", M.carre), img("e6b", M.portrait), img("e6c", M.paysage)]),
    ]);
    await openEditor(page, BASE, pageId);
    await page.getByRole("button", { name: "Publier", exact: true }).click();
    ok("E5 publié", await waitFor(() => sql((db) => db.prepare("select draft from pages where id = ?").get(pageId)).draft === null, 90000));
    await sleep(2500);
    const html = await (await fetch(`${BASE}/fr/personnages`)).text();
    ok("E5b public : justifié, une image seule, aucun repère d'édition", /data-justify/.test(html) && /data-jalone/.test(html) && !/data-edit-|pe-cell|data-cell-/.test(html.replace(/<script[\s\S]*?<\/script>/g, "")));
    const pub = await (await browser.newContext()).newPage();
    await pub.setViewportSize({ width: 1180, height: 900 });
    await pub.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
    const pm = (n) => pub.evaluate((k) => {
      const g = document.querySelectorAll(".block-grid")[k];
      const gb = g.getBoundingClientRect();
      return [...g.querySelectorAll(":scope > .block-grid-cell")].map((c) => {
        const rc = c.getBoundingClientRect();
        const m = c.querySelector(".block-image-media")?.getBoundingClientRect();
        return { free: false, idx: c.dataset.cellIndex, left: rc.left - gb.left, top: rc.top - gb.top, width: rc.width, height: rc.height, gw: gb.width, iw: m?.width ?? 0, ih: m?.height ?? 0 };
      });
    }, n);
    const p5 = await pm(0);
    ok("E5c public : quatre images, la troisième (portrait) seule pleine largeur", p5.length === 4 && near(p5[2].width, p5[2].gw, 2) && p5[2].top > p5[0].top && p5[3].top > p5[2].top && near(p5[0].top, p5[1].top, 1), JSON.stringify(p5.map((c) => [c.top, c.width])));
    justified(p5.slice(0, 2), [1, 3 / 2], "E5d public « 3 » + Libre, rangée de deux");
    const p6 = await pm(1);
    ok("E5e public « 3 » + Carré inchangé", p6.length === 3 && p6.every((c) => near(c.width, p6[0].width, 2) && near(c.iw, c.ih, 2)));
    await pub.screenshot({ path: path.join(SHOTS, "E-public.png"), fullPage: true });
    await pub.setViewportSize({ width: 390, height: 844 });
    await pub.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
    const ph = await pub.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const t5 = await pm(0);
    ok("E6 téléphone : pas de débordement, quatre images, la seule sur sa ligne pleine largeur", ph <= 0 && t5.length === 4 && near(t5[2].width, t5[2].gw, 2), JSON.stringify([ph, t5.map((c) => [c.top, c.width])]));
    ok("E6b téléphone : aucune image sous 138 px de large", t5.every((c) => c.width >= 138));
    await pub.screenshot({ path: path.join(SHOTS, "E-telephone.png"), fullPage: true });
    await pub.close();
  }
  if (run("F")) {
    // F1 Sur mesure 2 colonnes + Libre (cas de la capture 20) : carré + 2/3 de même hauteur, sans recadrage ; la hauteur « 2 rangées » est ignorée.
    const cust = (uid, extra, kids) => grid(uid, { layout: "custom", cols: 2, ...extra }, kids);
    const fr = await withCanvas([
      cust("f1", { spans: [{ w: 1, h: 1 }, { w: 1, h: 2 }, { w: 1, h: 1 }] }, [img("f1a", M.carre), img("f1b", M.portrait), img("f1c", M.paysage)]),
    ]);
    const G = '[data-edit-block="f1"] .block-grid';
    await center(fr, G);
    let r = await measure(fr, G);
    justified(r, [1, 2 / 3, 3 / 2], "F1 Sur mesure + Libre (toile)");
    const real = r.filter((c) => !c.free);
    ok("F1b deux images sur la première rangée, la troisième dessous, ordre gardé, une place libre", near(real[0].top, real[1].top, 1) && real[2].top > real[0].top && real.every((c, i) => Number(c.idx) === i) && r.filter((c) => c.free).length === 1, JSON.stringify(real.map((c) => [c.idx, c.top])));
    ok("F1c la grille reste « Sur mesure » dans le brouillon (données intactes)", draftBlocks(pageId)[0].props.layout === "custom" && draftBlocks(pageId)[0].props.spans.length === 3);
    await shot("F-sur-mesure-libre-toile");

    // F2 une case pleine largeur (w >= colonnes) est seule sur sa ligne ; F3 Sur mesure + Carré inchangé ; F4 Portrait à gauche + 2 + Libre inchangé.
    setDraft(pageId, [
      cust("f2", { spans: [{ w: 1, h: 1 }, { w: 2, h: 1 }, { w: 1, h: 1 }, { w: 1, h: 1 }] }, [img("f2a", M.carre), img("f2b", M.portrait), img("f2c", M.paysage), img("f2d", M.carre)]),
      cust("f3", { ratio: "1:1", spans: [{ w: 1, h: 1 }, { w: 2, h: 1 }, { w: 1, h: 1 }] }, [img("f3a", M.carre), img("f3b", M.portrait), img("f3c", M.paysage)]),
      grid("f4", { layout: "portrait-left" }, [img("f4a", M.portrait), img("f4b", M.carre), img("f4c", M.paysage)]),
      grid("f8", { layout: "portrait-left", ratio: "1:1" }, [img("f8a", M.portrait), img("f8b", M.carre), img("f8c", M.paysage)]),
    ]);
    const f2 = await openEditor(page, BASE, pageId);
    await center(f2, '[data-edit-block="f2"] .block-grid');
    r = (await measure(f2, '[data-edit-block="f2"] .block-grid')).filter((c) => !c.free);
    ok("F2 case pleine largeur : seule sur sa ligne, avant et après rangées complétées", near(r[1].width, r[1].gw, 2) && r[1].top > r[0].top && r[2].top > r[1].top && near(r[2].top, r[3].top, 1) && near(r[1].iw / r[1].ih, 2 / 3, 0.02), JSON.stringify(r.map((c) => [c.top, c.width])));
    await shot("F-pleine-largeur");
    await center(f2, '[data-edit-block="f3"] .block-grid');
    r = (await measure(f2, '[data-edit-block="f3"] .block-grid')).filter((c) => !c.free);
    ok("F3 Sur mesure + Carré inchangé : pas justifié, case large sur 2 colonnes, images carrées", !(await f2.locator('[data-edit-block="f3"] .block-grid[data-justify]').count()) && near(r[1].width, r[1].gw, 2) && r[0].width < r[1].width && near(r[0].iw / r[0].ih, 1, 0.02), JSON.stringify(r.map((c) => [c.top, c.width, c.iw, c.ih])));
    await center(f2, '[data-edit-block="f4"] .block-grid');
    r = (await measure(f2, '[data-edit-block="f4"] .block-grid')).filter((c) => !c.free);
    ok("F4 « Portrait à gauche + 2 » + Libre justifié : rangées de même hauteur, non recadrées", !!(await f2.locator('[data-edit-block="f4"] .block-grid[data-justify]').count()), "");
    justified(r, [2 / 3, 1, 3 / 2], "F4 portrait à gauche + 2 + Libre (toile)");
    await center(f2, '[data-edit-block="f8"] .block-grid');
    r = (await measure(f2, '[data-edit-block="f8"] .block-grid')).filter((c) => !c.free);
    ok("F4e « Portrait à gauche + 2 » + Carré : grandes cases inchangées (portrait sur deux rangées)", !(await f2.locator('[data-edit-block="f8"] .block-grid[data-justify]').count()) && r[0].height > r[1].height * 1.5 && near(r[1].left, r[2].left, 2), JSON.stringify(r.map((c) => [c.left, c.top, c.height])));
    await shot("F-portrait-libre-et-carre");

    // F4b l'aide « les cases gardent leur forme » : fenêtre Réglages ET panneau (et absente en Sur mesure).
    const HINT = /Pour garder les grandes cases/;
    const first = f2.locator('[data-edit-block="f4"] .block-grid > .block-grid-cell[data-cell-index="0"]');
    await first.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await sleep(600);
    const fb = await first.boundingBox();
    await page.mouse.click(fb.x + fb.width / 2, fb.y + Math.min(fb.height * 0.8, 240));
    await f2.locator(".pe-crumbs .pe-crumb").first().click();
    await f2.locator('[data-testid="grid-settings-button"]').waitFor({ timeout: 20000 });
    await f2.locator('[data-testid="grid-settings-button"]').click();
    await f2.locator('[data-testid="gridsettings"]').waitFor({ timeout: 10000 });
    ok("F4b aide dans la fenêtre Réglages", HINT.test(await f2.locator('[data-testid="gridsettings-keep-hint"]').innerText()));
    await shot("F-aide-reglages");
    await f2.locator('[data-testid="gridsettings-more"]').click();
    await page.getByTestId("grid-top").waitFor({ timeout: 20000 });
    ok("F4c aide dans le panneau", HINT.test(await page.getByTestId("grid-keep-hint").innerText()));

    // F5 menu Taille au vrai clic en Sur mesure : « Seule sur sa ligne » puis « Avec les autres ».
    setDraft(pageId, [cust("f5", { spans: [{ w: 1, h: 2 }, { w: 1, h: 1 }, { w: 1, h: 1 }, { w: 1, h: 1 }] }, [img("f5a", M.carre), img("f5b", M.portrait), img("f5c", M.paysage), img("f5d", M.carre)])]);
    const f5 = await openEditor(page, BASE, pageId);
    const G5 = '[data-edit-block="f5"] .block-grid';
    await center(f5, G5);
    const hoverCell = async (i) => {
      const c = f5.locator(`${G5} > .block-grid-cell[data-cell-index="${i}"]`);
      await c.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await sleep(600);
      const b = await c.boundingBox();
      await page.mouse.move(b.x + b.width / 2 + 3, b.y + b.height / 3);
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 3 + 2, { steps: 3 });
      await f5.locator('[data-testid="cellbar"]').waitFor({ timeout: 10000 });
      await sleep(300);
    };
    const click = async (loc) => {
      const b = await loc.boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 3 });
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    };
    const choose = async (name) => {
      await click(f5.locator('[data-testid="cellbar"] [data-cb="size"]'));
      const item = f5.locator(`.pe-gridmenu [data-cb="${name}"]`);
      await item.waitFor({ timeout: 5000 });
      await click(item);
      await sleep(1800);
    };
    await hoverCell(1);
    await click(f5.locator('[data-testid="cellbar"] [data-cb="size"]'));
    const labels = await f5.locator(".pe-gridmenu [data-cb]").allInnerTexts();
    ok("F5a Sur mesure + Libre : le menu Taille ne propose que « Seule sur sa ligne » et « Avec les autres »", labels.map((x) => x.trim()).join("|") === "Seule sur sa ligne|Avec les autres", labels.join("|"));
    await page.keyboard.press("Escape");
    await hoverCell(1);
    await choose("alone");
    r = (await measure(f5, G5)).filter((c) => !c.free);
    ok("F5b « Seule sur sa ligne » : pleine largeur sur sa rangée, non recadrée", near(r[1].width, r[1].gw, 2) && r[1].top > r[0].top && r[2].top > r[1].top && near(r[1].iw / r[1].ih, 2 / 3, 0.02), JSON.stringify(r.map((c) => [c.top, c.width])));
    ok("F5c brouillon : la case n° 2 couvre les 2 colonnes, rien d'autre ne change", JSON.stringify(draftBlocks(pageId)[0].props.spans) === JSON.stringify([{ w: 1, h: 2 }, { w: 2, h: 1 }, { w: 1, h: 1 }, { w: 1, h: 1 }]) && draftBlocks(pageId)[0].props.layout === "custom");
    await shot("F-seule");
    await hoverCell(1);
    await choose("with-others");
    r = (await measure(f5, G5)).filter((c) => !c.free);
    ok("F5d « Avec les autres » : retour à deux images par rangée", near(r[0].top, r[1].top, 1) && near(r[2].top, r[3].top, 1), JSON.stringify(r.map((c) => c.top)));
    ok("F5e annuler (Ctrl+Z) rétablit la case seule, rétablir (Ctrl+Maj+Z) la remet avec les autres", await (async () => {
      await page.mouse.click(2, 2);
      await page.keyboard.press("Control+z");
      await sleep(1800);
      const a = (await measure(f5, G5)).filter((c) => !c.free);
      const undone = near(a[1].width, a[1].gw, 2);
      await page.keyboard.press("Control+Shift+z");
      await sleep(1800);
      const b = (await measure(f5, G5)).filter((c) => !c.free);
      return undone && near(b[0].top, b[1].top, 1);
    })());

    // F6 public et téléphone : Sur mesure + Libre justifié, case pleine largeur seule, Sur mesure + Carré inchangé, aucune image perdue.
    setDraft(pageId, [
      cust("f6", { spans: [{ w: 1, h: 1 }, { w: 1, h: 2 }, { w: 2, h: 1 }, { w: 1, h: 1 }] }, [img("f6a", M.carre), img("f6b", M.portrait), img("f6c", M.paysage), img("f6d", M.carre)]),
      cust("f7", { ratio: "1:1", spans: [{ w: 1, h: 1 }, { w: 2, h: 1 }, { w: 1, h: 1 }] }, [img("f7a", M.carre), img("f7b", M.portrait), img("f7c", M.paysage)]),
    ]);
    await openEditor(page, BASE, pageId);
    await page.getByRole("button", { name: "Publier", exact: true }).click();
    ok("F6 publié", await waitFor(() => sql((db) => db.prepare("select draft from pages where id = ?").get(pageId)).draft === null, 90000));
    await sleep(2500);
    const html = await (await fetch(`${BASE}/fr/personnages`)).text();
    ok("F6b public : justifié, une case seule, aucun repère d'édition", /data-justify/.test(html) && /data-jalone/.test(html) && !/data-edit-|pe-cell|data-cell-/.test(html.replace(/<script[\s\S]*?<\/script>/g, "")));
    const pub = await (await browser.newContext()).newPage();
    await pub.setViewportSize({ width: 1180, height: 900 });
    await pub.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
    const pm = (n) => pub.evaluate((k) => {
      const g = document.querySelectorAll(".block-grid")[k];
      const gb = g.getBoundingClientRect();
      return [...g.querySelectorAll(":scope > .block-grid-cell")].map((c) => {
        const rc = c.getBoundingClientRect();
        const m = c.querySelector(".block-image-media")?.getBoundingClientRect();
        return { free: false, idx: c.dataset.cellIndex, left: rc.left - gb.left, top: rc.top - gb.top, width: rc.width, height: rc.height, gw: gb.width, iw: m?.width ?? 0, ih: m?.height ?? 0 };
      });
    }, n);
    const p6 = await pm(0);
    ok("F6c public : quatre images, ordre gardé, la troisième (paysage, pleine largeur) seule", p6.length === 4 && near(p6[2].width, p6[2].gw, 2) && p6[2].top > p6[0].top && near(p6[0].top, p6[1].top, 1) && p6[3].top > p6[2].top, JSON.stringify(p6.map((c) => [c.top, c.width])));
    justified(p6.slice(0, 2), [1, 2 / 3], "F6d public Sur mesure + Libre, rangée de deux");
    const p7 = await pm(1);
    ok("F6e public Sur mesure + Carré inchangé (case large, images carrées)", p7.length === 3 && near(p7[1].width, p7[1].gw, 2) && p7[0].width < p7[1].width && near(p7[0].iw / p7[0].ih, 1, 0.02), JSON.stringify(p7.map((c) => [c.width, c.iw, c.ih])));
    await pub.screenshot({ path: path.join(SHOTS, "F-public.png"), fullPage: true });
    await pub.setViewportSize({ width: 390, height: 844 });
    await pub.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
    const ph = await pub.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const t6 = await pm(0);
    ok("F7 téléphone : pas de débordement, quatre images, aucune sous 138 px, la pleine largeur seule", ph <= 0 && t6.length === 4 && t6.every((c) => c.width >= 138) && near(t6[2].width, t6[2].gw, 2), JSON.stringify([ph, t6.map((c) => [c.top, c.width])]));
    await pub.screenshot({ path: path.join(SHOTS, "F-telephone.png"), fullPage: true });
    await pub.close();
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
