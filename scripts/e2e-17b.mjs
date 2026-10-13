#!/usr/bin/env node
/**
 * Lot 17b, de bout en bout (chromium, serveur requis + une connexion admin) :
 *  B3  envoi réel d'images lourdes (décor 20000 × 4000, PNG de 60 Mo, PNG entrelacé trop
 *      lourd) : « prêtes » ou en « échec » lisible, jamais « en traitement » pour toujours ;
 *      le serveur ne dépasse pas MAX_ANON_MB (mémoire anonyme, pic échantillonné) ; l'éditeur rafraîchit sa grille.
 *  B4  case portrait d'une grille de 3 recevant un décor panoramique (cadré ou non) : la
 *      variante chargée a au moins la résolution affichée (naturalWidth ≥ pixels affichés ×
 *      DPR), ou c'est la plus grande variante.
 *  B6  bande « N œuvres » : le fondu des bords n'existe que contre une image réellement
 *      coupée, jamais sur une image entièrement visible.
 * BEFORE=1 émule l'ancien comportement (sizes d'origine, fondu fixe) pour mesurer « avant ».
 * (Conteneur réel : MALLOC_ARENA_MAX=2 MALLOC_MMAP_THRESHOLD_=131072 MALLOC_TRIM_THRESHOLD_=131072, voir Dockerfile : pic anonyme ≈ 590 Mo.)
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=B4,B6] node scripts/e2e-17b.mjs
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";
import sharp from "sharp";

import { login, pageIdOf, q1, waitFor } from "./lib/medias-setup.mjs";

const BASE = process.env.BASE ?? "http://localhost:3103";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.includes(s);
const BEFORE = process.env.BEFORE === "1";
const SHOTS = process.env.SHOTS ?? path.join(tmpdir(), "e2e-17b");
const DB = path.join(process.env.DATA_DIR ?? "data", "portfolio.db");
mkdirSync(SHOTS, { recursive: true });
sharp.cache(false);
sharp.concurrency(1);

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
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

/** Décor de test : dégradé et fines rayures verticales (un flou se voit). */
async function paint(name, w, h, seed) {
  const buf = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const stripe = x % 40 < 3 ? 60 : 0;
      buf[i] = ((x * 255) / w + seed * 40 + stripe) & 255;
      buf[i + 1] = ((y * 255) / h + stripe) & 255;
      buf[i + 2] = (seed * 90 + stripe + (x + y) / 40) & 255;
    }
  return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png({ compressionLevel: 6 }).toBuffer();
}

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);

async function upload(name, buffer, mimeType = "image/png") {
  const res = await page.request.post(`${BASE}/admin/api/upload`, { headers: { origin: BASE }, multipart: { file: { name, mimeType, buffer } }, timeout: 120000 });
  return { status: res.status(), json: await res.json().catch(() => null) };
}
const mediaOf = (name) => q1("select id, status, error, width, height from media where original_name = ? order by id desc", name);
const settle = async (name, ms = 120000) => (await waitFor(() => ["ready", "failed"].includes(mediaOf(name)?.status), ms)) && mediaOf(name);

const rss = () => {
  const pid = process.env.SERVER_PID;
  if (!pid) return null;
  try {
    return Number(/VmHWM:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, "utf8"))[1]) / 1024;
  } catch {
    return null;
  }
};
// Mémoire anonyme (RssAnon : celle qui compte pour le OOM-killer, contrairement aux fichiers mappés, récupérables) : pic échantillonné.
let peakAnon = 0;
if (process.env.SERVER_PID) {
  setInterval(() => {
    try {
      const m = /RssAnon:\s+(\d+)/.exec(readFileSync(`/proc/${process.env.SERVER_PID}/status`, "utf8"));
      if (m) peakAnon = Math.max(peakAnon, Number(m[1]) / 1024);
    } catch {}
  }, 100).unref();
}
const memLine = () => (rss() === null ? "" : `  serveur : VmHWM ${Math.round(rss())} Mo, mémoire anonyme (pic) ${Math.round(peakAnon)} Mo`);

/* ---- B3 : images lourdes ------------------------------------------------------------ */
if (run("B3")) {
  const big = process.env.FIXTURES ?? "/root/fx17b";
  const cases = [
    ["deco-20000x4000-rgba.png", "ready", "décor 20000 × 4000 RGBA (182 Mo)"],
    ["gros-60mo.png", "ready", "PNG de 60 Mo"],
    ["entrelace-20000x4000-rgba.png", "ready", "PNG entrelacé 20000 × 4000 (320 Mo décodés)"],
    ["poison-12500x8000-16bit-entrelace.png", "failed-upload", "PNG 16 bits entrelacé 12500 × 8000 (3 Mo sur disque, 800 Mo à décoder) : refusé avec la marche à suivre"],
    ["entrelace-20000x5000-rgba.png", "failed-upload", "PNG entrelacé 20000 × 5000 (400 Mo décodés) : refusé avec la marche à suivre"],
  ];
  for (const [file, expected, label] of cases) {
    const p = path.join(big, file);
    if (!existsSync(p)) {
      console.log(`SKIP ${label} (fichier absent : ${p})`);
      continue;
    }
    const t0 = Date.now();
    const up = await upload(file, readFileSync(p));
    if (expected === "failed-upload") {
      ok(`B3 ${label}`, up.status === 422 && /entrelacé|trop lourde/.test(up.json?.message ?? ""), `${up.status} ${up.json?.message ?? ""}`);
      continue;
    }
    if (up.status >= 300) {
      ok(`B3 ${label} : envoi accepté`, false, `${up.status} ${JSON.stringify(up.json).slice(0, 160)}`);
      continue;
    }
    const m = await settle(file);
    ok(`B3 ${label} : prêt en ${Math.round((Date.now() - t0) / 1000)} s (jamais bloqué)`, m?.status === expected, JSON.stringify(m));
    if (rss() !== null) console.log(memLine());
  }
  const limit = Number(process.env.MAX_ANON_MB ?? 950);
  if (rss() !== null) ok(`B3 pic de mémoire anonyme du serveur ${Math.round(peakAnon)} Mo ≤ ${limit} Mo (VmHWM ${Math.round(rss())} Mo, fichiers mappés compris)`, peakAnon <= limit);
}

/* ---- B3 (éditeur) : la grille des médias suit le traitement ---------------------------------- */
if (run("B3U")) {
  {
    // Décor de 72 Mpx (≈ 25 Mo en PNG, accepté partout) : le traitement dure assez pour finir après le premier rafraîchissement.
    const buffer = await paint("grand", 12000, 6000, 5);
    const pageId = pageIdOf("personnages");
    const name = `17b-editeur-${Date.now()}.png`;
    await page.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: /Médias/ }).waitFor({ timeout: 120000 });
    await page.getByRole("tab", { name: /Médias/ }).click();
    await page.locator(".ve-panel input[type=file]").first().setInputFiles({ name, mimeType: "image/png", buffer });
    const appeared = await waitFor(() => mediaOf(name)?.id, 120000);
    const done = await waitFor(() => mediaOf(name)?.status === "ready", 120000);
    if (rss() !== null) console.log(memLine());
    ok("B3 envoi depuis l'éditeur : média créé puis prêt", Boolean(appeared && done), JSON.stringify(mediaOf(name)));
    if (done) {
      const li = page.locator(`ul.ve-media li[data-media="${mediaOf(name).id}"]`);
      // Sans rechargement : la vignette apparaît et l'étiquette « Traitement… » disparaît.
      const settled = await waitFor(async () => (await li.count()) === 1 && (await li.locator("img").count()) === 1 && (await li.locator(".ve-media-state").count()) === 0, 15000);
      const text = (await li.count()) ? (await li.textContent())?.trim() : "(absent)";
      ok("B3 grille de l'onglet Médias : l'image prête s'affiche sans recharger (plus de « Conversion… » éternel)", settled, `état affiché : « ${text} »`);
      await page.screenshot({ path: `${SHOTS}/B3-editeur-${BEFORE ? "avant" : "apres"}.png`, clip: { x: 0, y: 0, width: 1440, height: 1000 } });
    }
  }
}

if (run("B4") || run("B6")) {
  /* ---- mise en place : médias, projets, brouillon de la page Personnages ------------------ */
  const files = [
    ["17b-pano.png", await paint("pano", 8000, 1600, 1)],
    ["17b-paysage-a.png", await paint("a", 1450, 1000, 2)],
    ["17b-paysage-b.png", await paint("b", 1450, 1000, 3)],
    ["17b-portrait.png", await paint("p", 1000, 1500, 4)],
  ];
  for (const [name, buffer] of files) if (!mediaOf(name)) await upload(name, buffer);
  for (const [name] of files) {
    const m = await settle(name);
    if (m?.status !== "ready") throw new Error(`${name} : ${JSON.stringify(m)}`);
  }
  const id = Object.fromEntries(files.map(([name]) => [name.replace(/^17b-|\.png$/g, ""), mediaOf(name).id]));
  const pageId = pageIdOf("personnages");
  sql((db) => {
    const project = (slug, medias) => {
      const row = db.prepare("select id from projects where slug = ?").get(slug);
      if (row) return;
      const pid = db.prepare("insert into projects (slug, title, context, description, year, featured, position) values (?, ?, ?, ?, ?, 0, 900)").run(slug, JSON.stringify({ fr: slug, en: slug }), JSON.stringify({ fr: "Test", en: "Test" }), JSON.stringify({ fr: "", en: "" }), "2026").lastInsertRowid;
      medias.forEach((m, i) => db.prepare("insert into slots (project_id, position, media_id, aspect, slug, collection, title, description, year) values (?, ?, ?, ?, ?, 'characters', ?, ?, 2026)").run(pid, i, m, null, `${slug}-${i}`, JSON.stringify({ fr: `Image ${i + 1}`, en: `Image ${i + 1}` }), JSON.stringify({ fr: "", en: "" })));
    };
    project("p17b-seul", [id["paysage-a"]]);
    project("p17b-deux", [id["paysage-a"], id["paysage-b"]]);
    project("p17b-pano", [id.pano, id["paysage-a"]]);
    const row = db.prepare("select title, slug, meta, nav_order, draft_rev from pages where id = ?").get(pageId);
    const cell = (uid, mediaId, zoom) => ({ uid, type: "image", props: { mediaId, width: "wide", ...(zoom ? { look: { crop: { mediaId: { x: 50, y: 50, zoom } } } } : {}) } });
    const draft = {
      title: JSON.parse(row.title),
      slug: JSON.parse(row.slug),
      meta: row.meta ? JSON.parse(row.meta) : { title: { fr: "", en: "" }, description: { fr: "", en: "" } },
      published: true,
      inMenu: row.nav_order !== null,
      accent: null,
      blocks: [
        { uid: "g17b", type: "grid", props: { layout: "3", gap: "normal", align: "stretch", ratio: "4:5", top: "gap", children: [cell("c1", id.pano, 1.5), cell("c2", id.pano), cell("c3", id.portrait)] } },
        { uid: "s1", type: "project-board", props: { project: "p17b-seul" } },
        { uid: "s2", type: "project-board", props: { project: "p17b-deux" } },
        { uid: "s3", type: "project-board", props: { project: "p17b-pano" } },
      ],
    };
    db.prepare("update pages set draft = ?, draft_updated_at = unixepoch(), draft_rev = draft_rev + 1 where id = ?").run(JSON.stringify(draft), pageId);
  });
  // Vue brouillon (la toile de l'éditeur) : la route pose les cookies (mode brouillon) et redirige ; elle exige l'origine.
  const toile = await ctx.request.get(`${BASE}/admin/api/editeur/toile?page=${pageId}&langue=fr`, { headers: { origin: BASE }, maxRedirects: 0 });
  await page.goto(BASE + (toile.headers().location ?? "/fr"), { waitUntil: "networkidle" });
  console.log(`  toile : ${page.url()} — ${await page.locator("[data-edit-block]").count()} blocs, ${await page.locator(".block-grid").count()} grille(s)`);
  if (BEFORE) {
    // Ancien comportement : fondu fixe dès que la bande déborde ; sizes d'origine pour les cases de grille.
    await page.addStyleTag({
      content: `.strip-viewport[data-overflows="true"]:not([data-at-end="true"]) .strip-rail{--strip-fade-r:var(--strip-fade)!important}
.strip-viewport[data-overflows="true"]:not([data-at-start="true"]) .strip-rail{--strip-fade-l:var(--strip-fade)!important}`,
    });
    await page.evaluate(() => document.querySelectorAll(".block-grid picture source").forEach((s) => s.setAttribute("sizes", "(min-width: 768px) 50vw, 100vw")));
  }

  /* ---- B4 : variante servie pour une image rognée par sa case --------------------------------- */
  if (run("B4")) {
    const grid = page.locator(".block-grid[data-layout='3']");
    await grid.scrollIntoViewIfNeeded();
    const imgs = grid.locator("img.block-image-media");
    await imgs.first().evaluate((i) => i.scrollIntoView({ block: "center" }));
    await sleep(500);
    const measure = async (n) => {
      const img = imgs.nth(n);
      await img.evaluate((i) => (i.loading = "eager"));
      await page.waitForFunction((el) => el.complete && el.naturalWidth > 0, await img.elementHandle(), { timeout: 30000 });
      await sleep(300);
      return img.evaluate((i) => {
        const box = i.getBoundingClientRect();
        const scale = Math.max(box.width / i.naturalWidth, box.height / i.naturalHeight);
        const m = /matrix\(([^,]+),/.exec(getComputedStyle(i).transform);
        const zoom = m ? Number(m[1]) : 1;
        const shown = i.naturalWidth * scale * zoom; // largeur affichée de l'image entière, en px CSS
        const options = [...i.parentElement.querySelectorAll("source[type='image/webp']")].flatMap((s) => (s.srcset || "").split(",").map((x) => Number(/(\d+)w/.exec(x)?.[1] ?? 0)));
        // Largeur RÉELLE de la variante chargée en pixels (le nom du fichier est sa boîte, soit sa largeur pour un panorama) :
        // `naturalWidth` d'une image à srcset est rapportée à la densité choisie, pas aux pixels.
        const px = Number(/\/(\d+)\.(?:avif|webp)$/.exec(i.currentSrc)?.[1] ?? 0);
        return { current: i.currentSrc.split("/").slice(-2).join("/"), natural: px, shown: Math.round(shown), needed: Math.round(shown * devicePixelRatio), best: Math.max(...options), box: [Math.round(box.width), Math.round(box.height)], zoom };
      });
    };
    const cases = [
      ["cadré (zoom 150 %)", 0],
      ["non cadré", 1],
    ];
    for (const [label, n] of cases) {
      const m = await measure(n);
      const sharpness = m.natural / m.needed;
      console.log(`  ${label} : case ${m.box.join("×")}, image affichée ${m.shown} px CSS × DPR ${2} = ${m.needed} px ; variante ${m.current} (${m.natural} px réels, plus grande disponible ${m.best}) → netteté ${sharpness.toFixed(2)}`);
      ok(`B4 ${label} : variante ≥ pixels affichés (ou la plus grande disponible)`, m.natural >= Math.min(m.needed, m.best) * 0.99, `${m.natural} px réels / ${m.needed} nécessaires (max ${m.best})`);
    }
    await page.screenshot({ path: `${SHOTS}/B4-${BEFORE ? "avant" : "apres"}.png`, clip: await grid.evaluate((g) => { const r = g.getBoundingClientRect(); return { x: 0, y: Math.max(0, r.y - 20), width: 1440, height: Math.min(900, r.height + 40) }; }) });
  }

  /* ---- B6 : fondu des bords de la bande -------------------------------------------------------- */
  if (run("B6")) {
    const stripOf = (slug) => page.locator(`section[aria-labelledby="project-${slug}"] .strip-rail`);
    const state = (rail) =>
      rail.evaluate((r) => {
        const view = r.getBoundingClientRect();
        // Largeur réelle (px) de chaque fondu, lue dans les arrêts du dégradé du masque (valeurs déjà résolues) :
        // une sonde absolue reçoit l'expression de l'arrêt et se mesure comme le masque (pourcentages de la bande).
        const mask = getComputedStyle(r).maskImage || getComputedStyle(r).webkitMaskImage;
        const inner = mask.slice(mask.indexOf("(") + 1, mask.lastIndexOf(")"));
        const args = [];
        let depth = 0;
        let cur = "";
        for (const ch of inner) {
          if (ch === "(") depth++;
          if (ch === ")") depth--;
          if (ch === "," && depth === 0) {
            args.push(cur.trim());
            cur = "";
          } else cur += ch;
        }
        args.push(cur.trim());
        const stop = (arg) => arg.slice(arg.indexOf(")") + 1).trim();
        const width = (expr) => {
          const probe = document.createElement("div");
          probe.style.cssText = `position:absolute;left:0;top:0;height:1px;visibility:hidden;width:${expr}`;
          r.appendChild(probe);
          const w = probe.getBoundingClientRect().width;
          probe.remove();
          return w;
        };
        const fadeL = width(stop(args[2]));
        const fadeR = r.clientWidth - width(stop(args[3]));
        const frames = [...r.querySelectorAll(".strip-frame, .pe-empty-slot")].map((f) => {
          const b = f.getBoundingClientRect();
          return { left: b.left - view.left, right: b.right - view.left };
        });
        return { l: Math.round(fadeL * 10) / 10, r: Math.round(fadeR * 10) / 10, view: view.width, frames, overflow: r.scrollWidth - r.clientWidth, scroll: r.scrollLeft };
      });
    const fullyVisible = (s) => s.frames.filter((f) => f.left >= 0 && f.right <= s.view);
    // Aucune image entièrement visible ne doit tomber dans une zone de fondu.
    const clean = (s) => fullyVisible(s).every((f) => f.right <= s.view - s.r + 0.5 && f.left >= s.l - 0.5);

    let rail = stripOf("p17b-seul");
    await rail.scrollIntoViewIfNeeded();
    let s = await state(rail);
    ok("B6 une seule image, entièrement visible : aucun fondu", s.l === 0 && s.r === 0, JSON.stringify({ l: s.l, r: s.r }));
    await page.screenshot({ path: `${SHOTS}/B6-une-${BEFORE ? "avant" : "apres"}.png`, clip: { ...(await rail.boundingBox()), x: 0, width: 1440 } });

    rail = stripOf("p17b-deux");
    await rail.scrollIntoViewIfNeeded();
    s = await state(rail);
    console.log(`  deux images : débordement ${Math.round(s.overflow)} px (marge de fin comprise), images ${s.frames.map((f) => `${Math.round(f.left)}–${Math.round(f.right)}`).join(" | ")}, fondu g ${s.l} d ${s.r}`);
    ok("B6 deux images, la seconde entièrement visible (le débordement n'est que la marge de fin) : aucun fondu dessus", fullyVisible(s).length === 2 && clean(s) && s.r === 0, JSON.stringify({ l: s.l, r: s.r, frames: s.frames }));
    await page.screenshot({ path: `${SHOTS}/B6-deux-${BEFORE ? "avant" : "apres"}.png`, clip: { ...(await rail.boundingBox()), x: 0, width: 1440 } });

    rail = stripOf("p17b-pano");
    await rail.scrollIntoViewIfNeeded();
    s = await state(rail);
    const cut = s.frames.find((f) => f.left < s.view && f.right > s.view);
    ok("B6 panorama coupé à droite : fondu à droite seulement (rien à gauche au départ), borné à la partie visible", s.l === 0 && s.r > 0 && s.r <= s.view - cut.left + 0.5, JSON.stringify({ l: s.l, r: s.r, cut }));
    await page.screenshot({ path: `${SHOTS}/B6-pano-debut-${BEFORE ? "avant" : "apres"}.png`, clip: { ...(await rail.boundingBox()), x: 0, width: 1440 } });
    await rail.evaluate((r) => r.scrollTo({ left: r.scrollWidth, behavior: "auto" }));
    await sleep(400);
    s = await state(rail);
    ok("B6 panorama, fin de bande : plus de fondu à droite, fondu à gauche sur l'image coupée", s.r === 0 && s.l > 0 && clean(s), JSON.stringify({ l: s.l, r: s.r }));
    await rail.evaluate((r) => r.scrollTo({ left: 0, behavior: "auto" }));
    await sleep(300);
    s = await state(rail);
    ok("B6 retour au début : fondu gauche retiré", s.l === 0);
  }
}

ok("aucune erreur JavaScript de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
