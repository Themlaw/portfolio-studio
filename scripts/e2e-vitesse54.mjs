#!/usr/bin/env node
/**
 * Lot 54 « visionneuse et vitesse » (chromium, serveur de production conseillé, base neuve, une connexion admin).
 *  P  Publication d'une page riche (image seule, grille de 5, grille de 3, planche) ; site en ligne.
 *  V  Visionneuse : l'image agrandie occupe l'écran (>= 85 % de 88 vh ou >= 90 % de 92 vw selon son format) en ordinateur et en téléphone,
 *     variante adaptée (srcset + sizes), indicateur puis image nette, images voisines préchargées, rien ne déborde.
 *  L  Premier visuel : les deux premières images de la page sont `eager` + `fetchpriority=high`, les suivantes restent `lazy`.
 *  W  Script : la visionneuse n'est chargée qu'à la première ouverture.
 *  C  Parité toile / public (Tablette 820, Téléphone 390) : hauteur de chaque grille à 5 % près, largeur des images identique
 *     (une case vide ou une ligne de légende vide ne change rien).
 *  S  Mesure Slow 3G (390 px, 2x) : LCP de l'accueil, d'une page de projet et d'une page riche ; l'élément du LCP n'est jamais `lazy`.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=P,V,…] [SHOTS=dossier] node scripts/e2e-vitesse54.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { boardDraft, grid, img, login, makeMedia, openEditor, pageIdOf, q1, setBoardDraft, setDraft, settled, sleep, sql, waitFor } from "./lib/grille31d.mjs";

const BASE = process.env.BASE ?? "http://localhost:3670";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(process.env.DATA_DIR ?? tmpdir(), "shots", "vitesse54");
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const info = (label) => console.log(`INFO ${label}`);

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);
const M = await makeMedia(page, BASE);
const pageId = pageIdOf("personnages");
const project = q1("select id, slug from projects order by id limit 1");

const T = (s) => ({ fr: s, en: s });
const cap = (n) => ({ captionTitle: T(`Titre ${n}`), caption: T(`Légende ${n}`) });
const text = (uid, t) => ({ uid, type: "rich-text", props: { paragraphs: [T(t)] } });
const PAGE = () => [
  img("solo", M.portrait),
  grid("ga", { layout: "auto" }, [img("a1", M.paysage, cap(1)), img("a2", M.portrait), img("a3", M.carre, cap(3)), img("a4", M.paysage2), img("a5", M.portrait)]),
  text("t1", "Un texte entre deux grilles."),
  grid("gb", { layout: "2" }, [img("b1", M.paysage), img("b2", M.carre, cap(2)), img("b3", M.paysage2)]),
  { uid: "pbd", type: "project-board", props: { project: project.slug } },
];
const BOARD = () => [{ uid: "bg", type: "grid", props: { layout: "2", gap: "normal", align: "stretch", ratio: "auto", top: "gap", children: [img("bk1", M.portrait), img("bk2", M.paysage), img("bk3", M.carre)] } }];
const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});

async function publishAll() {
  setDraft(pageId, PAGE());
  setBoardDraft(project.id, pageId, BOARD());
  await openEditor(page, BASE, pageId);
  await settled(page);
  await page.getByRole("button", { name: "Publier", exact: true }).click();
  const done = await waitFor(() => sql((db) => db.prepare("select draft from pages where id = ?").get(pageId)).draft === null && boardDraft(project.id) === null, 120000);
  await sleep(3000);
  return done;
}
async function publicPage(options = {}, url = "/fr/personnages") {
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  const p = await c.newPage();
  p.setDefaultTimeout(45000);
  p.on("pageerror", (e) => errors.push(`public : ${e.message}`));
  await p.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
  return p;
}
const lb = (p) => p.locator(".lightbox");
const mainImg = (p) => lb(p).locator(".lightbox-stage figure img:not(.lb-preview)").first();
const loaded = (p) => waitFor(() => mainImg(p).evaluate((i) => i.complete && i.naturalWidth > 0 && getComputedStyle(i).opacity === "1").catch(() => false), 45000);

try {
  ok("P publication : page riche publiée", await publishAll());

  /* ---- V. Visionneuse ---- */
  if (run("V")) {
    const p = await publicPage();
    const solo = p.locator("section:not(.block-grid-section) [data-viewer-item]").first();
    await solo.scrollIntoViewIfNeeded();
    await solo.click();
    await lb(p).waitFor();
    ok("V1 image chargée (indicateur puis image nette)", await loaded(p));
    const r = await mainImg(p).evaluate((i) => {
      const b = i.getBoundingClientRect();
      return { w: b.width, h: b.height, nw: i.naturalWidth, src: i.currentSrc, sizes: i.parentElement?.querySelector("source")?.getAttribute("sizes") ?? "" };
    });
    const vw = 1440, vh = 900;
    ok(`V2 ordinateur : l'image occupe l'écran (${Math.round(r.w)}x${Math.round(r.h)} px)`, r.h >= 0.85 * (0.88 * vh) && r.h <= 0.88 * vh + 2 && r.w <= 0.92 * vw + 1, JSON.stringify(r));
    ok("V3 proportions gardées (portrait 2/3)", Math.abs(r.w / r.h - 1000 / 1500) < 0.01, `${r.w / r.h}`);
    ok("V4 variante adaptée à l'écran (sizes précis, pas la plus grande par défaut)", /vh|vw/.test(r.sizes), r.sizes);
    ok("V5 plus d'indicateur une fois chargée", (await lb(p).locator(".lb-spinner").count()) === 0 && (await lb(p).locator(".lb-preview").count()) === 0);
    await shot(p, "V-ordinateur-solo");
    await p.keyboard.press("Escape");

    // Grille de 5 : deux voisines préchargées, taille avec légende et vignettes.
    const g = p.locator("section.block-grid-section").first();
    await g.locator("[data-viewer-item]").nth(1).scrollIntoViewIfNeeded();
    await g.locator("[data-viewer-item]").nth(1).click();
    await lb(p).waitFor();
    await loaded(p);
    const pre = await lb(p).locator("div[hidden] img").evaluateAll((l) => l.map((i) => ({ eager: i.loading === "eager", done: i.complete && i.naturalWidth > 0 })));
    ok("V6 image suivante et précédente préchargées", pre.length === 2 && pre.every((x) => x.eager), JSON.stringify(pre));
    ok("V6b voisines effectivement chargées", await waitFor(async () => (await lb(p).locator("div[hidden] img").evaluateAll((l) => l.every((i) => i.complete && i.naturalWidth > 0))), 30000));
    const box = await lb(p).evaluate((d) => {
      const i = d.querySelector(".lightbox-stage figure img:not(.lb-preview)").getBoundingClientRect();
      const head = d.querySelector(".lightbox-head").getBoundingClientRect();
      const thumbs = d.querySelector(".lb-thumbs")?.getBoundingClientRect();
      return { top: i.top, bottom: i.bottom, headBottom: head.bottom, thumbsTop: thumbs?.top ?? innerHeight, left: i.left, right: i.right };
    });
    ok("V7 avec vignettes : l'image ne recouvre ni l'en-tête ni les vignettes", box.top >= box.headBottom - 1 && box.bottom <= box.thumbsTop + 1 && box.left >= 0 && box.right <= 1440, JSON.stringify(box));
    await shot(p, "V-ordinateur-grille");
    await p.keyboard.press("ArrowRight");
    ok("V8 flèche : l'image suivante s'affiche", await loaded(p));
    await p.context().close();

    const ph = await publicPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const s2 = ph.locator("section:not(.block-grid-section) [data-viewer-item]").first();
    await s2.scrollIntoViewIfNeeded();
    await s2.tap();
    await lb(ph).waitFor();
    await loaded(ph);
    const pr = await mainImg(ph).evaluate((i) => {
      const b = i.getBoundingClientRect();
      return { w: b.width, h: b.height };
    });
    ok(`V9 téléphone : l'image prend la largeur de l'écran (${Math.round(pr.w)}x${Math.round(pr.h)} px)`, pr.w >= 0.9 * 0.92 * 390 && pr.w <= 0.92 * 390 + 1 && pr.h <= 0.88 * 844 + 2, JSON.stringify(pr));
    ok("V10 téléphone : pas de débordement horizontal", await ph.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await shot(ph, "V-telephone-solo");
    await ph.context().close();
  }

  /* ---- L. Premier visuel ---- */
  if (run("L")) {
    for (const [label, opts] of [["ordinateur", {}], ["téléphone", { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true }]]) {
      const p = await publicPage(opts);
      const imgs = await p.evaluate(() =>
        [...document.querySelectorAll("main img, section img")]
          .filter((i) => !i.closest("header") && !i.closest(".lightbox"))
          .map((i) => ({ loading: i.loading, prio: i.getAttribute("fetchpriority") })),
      );
      ok(`L1 ${label} : la première image de la page n'est pas « lazy » et passe en priorité`, imgs.length > 3 && imgs[0].loading === "eager" && imgs[0].prio === "high", JSON.stringify(imgs.slice(0, 3)));
      ok(`L2 ${label} : les images du bas de page restent « lazy »`, imgs.at(-1).loading === "lazy", JSON.stringify(imgs.at(-1)));
      await p.context().close();
    }
  }

  /* ---- W. Poids des scripts ---- */
  if (run("W")) {
    const p = await publicPage();
    const scripts = () => p.evaluate(() => performance.getEntriesByType("resource").filter((r) => r.initiatorType === "script" || r.name.endsWith(".js")).map((r) => ({ n: r.name, kb: r.encodedBodySize / 1024 })));
    const before = await scripts();
    const total = before.reduce((a, b) => a + b.kb, 0);
    info(`W0 scripts chargés à l'ouverture : ${before.length} fichiers, ${Math.round(total)} Ko`);
    const solo = p.locator("section:not(.block-grid-section) [data-viewer-item]").first();
    await solo.scrollIntoViewIfNeeded();
    await solo.click();
    await lb(p).waitFor();
    const after = await scripts();
    ok("W1 la visionneuse n'est chargée qu'au premier clic (un script de plus après l'ouverture)", after.length > before.length, `${before.length} -> ${after.length}`);
    await p.context().close();
  }

  /* ---- C. Parité toile / public ---- */
  if (run("C")) {
    const grids = (doc) =>
      doc.evaluate(() =>
        [...document.querySelectorAll("section.block-grid-section")].slice(0, 2).map((s) => ({
          // Les places libres (« + Image », absentes du public) ont leur propre rangée : on les retire de la hauteur.
          h: s.getBoundingClientRect().height - [...s.querySelectorAll(".block-grid > [data-edit-cell-free]")].reduce((a, c) => a + c.getBoundingClientRect().height + parseFloat(getComputedStyle(c.parentElement).rowGap || "0"), 0),
          w: [...s.querySelectorAll(":scope .block-grid > .block-grid-cell:not([data-edit-cell-free]) .block-image-media")].map((m) => m.getBoundingClientRect().width),
        })),
      );
    setDraft(pageId, PAGE());
    for (const [label, width, btn] of [["Tablette", 820, "Tablette"], ["Téléphone", 390, "Téléphone"]]) {
      const fr = await openEditor(page, BASE, pageId);
      await settled(page);
      await page.locator(`button[aria-pressed]`, { hasText: btn }).first().click();
      await sleep(2500);
      await fr.locator("section.block-grid-section").first().scrollIntoViewIfNeeded();
      const edit = await grids(fr);
      await shot(page, `C-${label}-toile`);
      const p = await publicPage({ viewport: { width, height: 900 }, ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) });
      const pub = await grids(p);
      await shot(p, `C-${label}-public`);
      await p.context().close();
      edit.forEach((e, i) => {
        ok(`C${label === "Tablette" ? 1 : 2}.${i + 1} ${label} : hauteur de la grille ${i + 1}, toile ${Math.round(e.h)} px / public ${Math.round(pub[i].h)} px (5 %)`, Math.abs(e.h - pub[i].h) / pub[i].h <= 0.05);
        ok(`C${label === "Tablette" ? 1 : 2}.${i + 1}w ${label} : largeur des images de la grille ${i + 1} identique (toile ${e.w.map(Math.round)} / public ${pub[i].w.map(Math.round)})`, e.w.length === pub[i].w.length && e.w.every((x, k) => Math.abs(x - pub[i].w[k]) <= Math.max(3, pub[i].w[k] * 0.04)));
      });
    }
  }

  /* ---- S. Slow 3G ---- */
  if (run("S")) {
    for (const [label, url] of [["accueil", "/fr"], ["page de projet / riche", "/fr/personnages"]]) {
      const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      const p = await c.newPage();
      p.setDefaultTimeout(120000);
      await p.addInitScript(() => {
        window.__lcp = null;
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) window.__lcp = { t: e.startTime, tag: e.element?.tagName ?? "", loading: e.element?.getAttribute?.("loading") ?? "", url: e.url ?? "" };
        }).observe({ type: "largest-contentful-paint", buffered: true });
      });
      const cdp = await c.newCDPSession(p);
      await cdp.send("Network.enable");
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 400, downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8 });
      const t0 = Date.now();
      await p.goto(`${BASE}${url}`, { waitUntil: "load", timeout: 180000 });
      const loadMs = Date.now() - t0;
      await sleep(1500);
      const lcp = await p.evaluate(() => window.__lcp);
      info(`S ${label} : Slow 3G, LCP ${lcp ? Math.round(lcp.t) : "?"} ms, chargé en ${loadMs} ms, élément ${lcp?.tag}${lcp?.loading ? ` loading=${lcp.loading}` : ""} ${lcp?.url?.replace(BASE, "").slice(0, 60) ?? ""}`);
      ok(`S ${label} : l'élément du LCP n'est jamais « lazy »`, Boolean(lcp) && lcp.loading !== "lazy", JSON.stringify(lcp));
      await c.close();
    }
  }
} finally {
  ok("aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
}
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
