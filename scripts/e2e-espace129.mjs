#!/usr/bin/env node
/**
 * Lot 129 « Espace sous une planche libre dans une carte ; Espacement intérieur haut / bas » (chromium, serveur requis, base neuve).
 * ÉCRIT AVANT le code produit. Données SYNTHÉTIQUES (PNG générés ici). Public 1440 / 1024 / 390, éditeur 1440 (et 1024 / 390 pour S et M).
 *  N  Pages existantes inchangées : 23 blocs (planche libre, texte, image, grille ; sans zone, en carte, en fond, en carte + fond ; avec Haut / Bas et Côtés d'avant)
 *     mesurés (hauteur de la zone, distance contenu ↔ bord de la zone, distance au bloc d'avant) et comparés à tests/golden/espace129-empreintes.json
 *     (enregistré sur la base a274a77 : absent = enregistrement).
 *  M  Cause de la bande : une planche libre recadrée, légende vide, dans une carte / un fond / les deux. Public : légende vide = 0 px réservé ;
 *     éditeur : au survol et au choix, les champs vides n'ouvrent AUCUNE hauteur (la carte ne bouge pas) ; légende remplie = dans le flux.
 *  S  « Espacement intérieur haut / bas » (padTop, padBottom) : 4 composants × (carte, fond, carte + fond) × crans et nombres : la zone gagne / perd
 *     exactement (valeur − rembourrage d'avant) ; sans zone : sans effet ; public = éditeur.
 *  U  Gestes de l'éditeur : barre « Espacement », curseurs « Intérieur haut / bas », enregistrement du brouillon, rechargement, publication, public ;
 *     journal d'édition ; aucune autre clé écrite.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=N,M,S,U] node scripts/e2e-espace129.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";
import sharp from "sharp";

import { draftBlocks, grid, img, login, openEditor, pageIdOf, q1, settled, sleep, sql, waitFor } from "./lib/grille31d.mjs";
import { publishBlocks } from "./lib/page-draft.mjs";

const BASE = process.env.BASE ?? "http://localhost:4000";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const GOLDEN = path.join(import.meta.dirname, "..", "tests", "golden", "espace129-empreintes.json");
const SHOTS = process.env.SHOTS ?? path.join(process.env.BATTERY_DIR ?? tmpdir(), "shots-espace129");
mkdirSync(SHOTS, { recursive: true });
sharp.cache(false);
sharp.concurrency(1);

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${String(detail).slice(0, 600)}` : ""}`);
};
const info = (label) => console.log(`INFO ${label}`);
const near = (a, b, tol) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= tol;

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);

/* ---- Images synthétiques ---------------------------------------------------------------------------------------------------- */
const svg = (w, h, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`);
const SPECS = {
  "129-fleur.png": svg(900, 1200, '<circle cx="450" cy="300" r="240" fill="#e0407a"/><rect x="430" y="520" width="40" height="640" fill="#2f7d32"/>'),
  "129-etoile.png": svg(1000, 1000, '<polygon points="500,40 620,380 980,380 690,590 800,940 500,730 200,940 310,590 20,380 380,380" fill="#f2b600"/>'),
};
const mediaOf = (name) => q1("select id, status from media where original_name = ? order by id desc", name);
const ids = {};
for (const [name, body] of Object.entries(SPECS)) {
  if (!mediaOf(name)) {
    const buffer = await sharp(body).png().toBuffer();
    const res = await page.request.post(`${BASE}/admin/api/upload`, { headers: { origin: BASE }, multipart: { file: { name, mimeType: "image/png", buffer } }, timeout: 180000 });
    if (res.status() >= 300) throw new Error(`envoi de ${name} : ${res.status()}`);
  }
  if (!(await waitFor(() => mediaOf(name)?.status === "ready", 180000))) throw new Error(`${name} : ${JSON.stringify(mediaOf(name))}`);
  ids[name.replace(/^129-|\.png$/g, "")] = mediaOf(name).id;
}
const PAGES = { n: pageIdOf("personnages"), s: pageIdOf("decors"), m: pageIdOf("animation") };
const SLUG = { n: "personnages", s: "decors", m: "animation" };

/* ---- Données --------------------------------------------------------------------------------------------------------------- */
const L = (t) => ({ fr: t, en: t });
const COLORS = ["secondary", "primary"];
const CARD = (i) => ({ color: COLORS[i % 2], corners: "m", width: "inset" });
const FOND = (i) => ({ kind: "color", color: COLORS[(i + 1) % 2] });
const ZONES = { n: () => ({}), c: (i) => ({ surface: CARD(i) }), f: (i) => ({ background: FOND(i) }), cf: (i) => ({ surface: CARD(i), background: FOND(i + 1) }) };
const crop = { t: 0, r: 0, b: 30, l: 0 };
const BODY = {
  fb: (uid, extra) => ({ uid, type: "free-board", props: { format: "3:2", phone: "scale", crop, items: [{ id: "a", media: ids.fleur, x: 8, y: 6, w: 26, rot: 0, z: 0 }, { id: "b", media: ids.etoile, x: 40, y: 10, w: 30, rot: 0, z: 1 }], ...extra } }),
  rt: (uid, extra) => ({ uid, type: "rich-text", props: { paragraphs: [L(`S129 ${uid} un paragraphe de texte inventé pour la mesure`)], ...extra } }),
  im: (uid, extra) => ({ uid, type: "image", props: { mediaId: ids.fleur, width: "wide", ...extra } }),
  gr: (uid, extra) => {
    const g = grid(uid, {}, [img(`${uid}a`, ids.fleur), img(`${uid}b`, ids.etoile)]);
    return { ...g, props: { ...g.props, ...extra } };
  },
};
const LOOKS = { d: undefined, n0: { padTop: "none", padBottom: "none" }, n40: { padTop: 40, padBottom: 40 }, xs: { padTop: "xl", padBottom: "s" }, sp: { spaceTop: "m", spaceBottom: "l" }, sd: { spaceSides: "m" } };
let seq = 0;
const make = (z, t, v) => {
  const uid = `${z}${t}${v}`;
  const extra = { ...ZONES[z](seq++), ...(LOOKS[v] ? { look: LOOKS[v] } : {}) };
  return BODY[t](uid, extra);
};
const ALLT = ["fb", "rt", "im", "gr"];
const BLOCKS_N = () => {
  seq = 0;
  const out = [];
  for (const z of ["n", "c", "f", "cf"]) for (const t of ALLT) out.push(make(z, t, "d"));
  for (const z of ["c", "f", "cf"]) for (const t of ["fb", "rt"]) out.push(make(z, t, "sp"));
  out.push(make("c", "rt", "sd"));
  return out;
};
const BLOCKS_S = () => {
  seq = 0;
  const out = [make("n", "fb", "d")];
  for (const z of ["c", "f", "cf"]) for (const t of ALLT) { out.push(make(z, t, "d")); out.push(make(z, t, "n0")); }
  for (const z of ["c", "f", "cf"]) for (const t of ["fb", "rt"]) { out.push(make(z, t, "n40")); out.push(make(z, t, "xs")); }
  out.push(make("n", "fb", "n40"));
  return out;
};
const BLOCKS_M = () => {
  seq = 0;
  const cap = { captionTitle: L("S129 titre de légende"), caption: L("S129 texte de légende"), captionDate: L("2026") };
  return [BODY.fb("m0", { surface: CARD(seq++) }), BODY.fb("m1", { surface: CARD(seq++), ...cap }), BODY.fb("m2", { background: FOND(seq++) }), BODY.fb("m3", { surface: CARD(seq), background: FOND(seq + 1) })];
};

/* ---- Aides ------------------------------------------------------------------------------------------------------------------ */
const section = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 8).join(" "));
    await page.screenshot({ path: path.join(SHOTS, `erreur-${name}.png`) }).catch(() => {});
  }
};
const countOf = (pageId) => sql((db) => db.prepare("select count(*) as n from blocks where page_id = ?").get(pageId)).n;
/** Publie `blocks` par l'éditeur (brouillon écrit comme le ferait l'éditeur, puis « Publier »). */
async function publish(pageId, blocks) {
  await page.goto("about:blank");
  const ready = () => sql((db) => db.prepare("select draft from pages where id = ?").get(pageId)).draft === null && countOf(pageId) === blocks.length;
  const end = Date.now() + 240000;
  while (Date.now() < end) {
    if (await publishBlocks(page, BASE, pageId, () => blocks, ready, 60000).catch(() => false)) {
      await sleep(3000);
      return true;
    }
  }
  return false;
}
async function publicPage(slug, width, height = 900) {
  const c = await browser.newContext({ viewport: { width, height } });
  const p = await c.newPage();
  p.setDefaultTimeout(30000);
  p.on("pageerror", (e) => errors.push(`public : ${e.message}`));
  await p.goto(`${BASE}/fr/${slug}`, { waitUntil: "networkidle" });
  await p.waitForFunction(() => [...document.querySelectorAll("img")].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 30000 }).catch(() => {});
  return p;
}
let f;
async function open(pageId, width = 1440) {
  await page.setViewportSize({ width, height: 900 });
  f = await openEditor(page, BASE, pageId);
  await settled(page);
  await f.waitForFunction(() => [...document.querySelectorAll("img")].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 60000 }).catch(() => {});
}

/**
 * Mesure, dans un document, de chaque bloc : hauteur de la zone colorée (carte, sinon fond), distances entre le contenu et le bord de la zone, distance au bloc d'avant,
 * rembourrage de zone d'avant (`--zb-t` / `--zb-b`, lu seulement si la feuille les connaît), et valeurs en px des crans du thème. Public : les blocs sont les enfants de `main`
 * (même nombre que les blocs de la page) ; éditeur : `[data-edit-block]`.
 */
const MEASURE = ({ edit, only, count }) => {
  const ZONE = '.surface-card[data-surface="on"], .fond-bloc[data-fond="on"]';
  // Éditeur : les blocs de premier niveau (leur identifiant n'est pas celui des données : il est refait à l'ouverture), dans l'ordre.
  let hosts = edit ? [...document.querySelectorAll("[data-edit-block]:not([data-edit-parent])")] : [...document.querySelectorAll("main > *")];
  if (count && hosts.length !== count) return { error: `${hosts.length} blocs lus pour ${count}` };
  if (only !== undefined) hosts = [hosts[only]];
  const px = (host, css) => {
    const q = document.createElement("i");
    q.style.cssText = `position:absolute;visibility:hidden;display:block;height:${css}`;
    host.append(q);
    const h = q.getBoundingClientRect().height;
    q.remove();
    return h;
  };
  let prevBottom = null;
  return hosts.map((h, i) => {
    if (!h) return null;
    const zone = h.matches(ZONE) ? h : h.querySelector(ZONE);
    const content = h.querySelector(".free-board, p, img, .block-grid");
    if (!content) return { i, error: "pas de contenu" };
    const c = content.getBoundingClientRect();
    const z = zone ? zone.getBoundingClientRect() : null;
    const top = z ? z.top : c.top;
    const out = { i, zone: Boolean(zone), zH: z ? z.height : c.height, cTop: z ? c.top - z.top : 0, cBot: z ? z.bottom - c.bottom : 0, dPrev: prevBottom === null ? null : top - prevBottom };
    prevBottom = z ? z.bottom : c.bottom;
    if (zone) {
      for (const k of ["s", "m", "l", "xl"]) out[k] = px(zone, `var(--t-space-${k})`);
      out.sg = px(zone, "var(--section-gap)");
      // Rembourrage que la zone donne d'elle-même (avant le lot) : carte (et carte + fond) = « M » du thème ; fond seul = l'espace de section.
      out.bt = out.bb = zone.classList.contains("surface-card") ? out.m : out.sg;
    }
    return out;
  });
};
const r1 = (n) => (typeof n === "number" ? Math.round(n * 10) / 10 : n);
const snapshot = (rows) => rows.map((r) => (r ? { zone: r.zone, zH: r1(r.zH), cTop: r1(r.cTop), cBot: r1(r.cBot), dPrev: r1(r.dPrev) } : null));

/** Un document de chaque sorte, sur un jeu de blocs (liste des uid, dans l'ordre). */
async function docs(slug, pageId, blocks, kinds) {
  const out = {};
  for (const w of kinds.pub ?? []) {
    const p = await publicPage(slug, w);
    out[`public ${w}`] = await p.evaluate(MEASURE, { count: blocks.length });
    await p.context().close();
  }
  for (const w of kinds.edit ?? []) {
    await open(pageId, w);
    await page.mouse.move(3, 3);
    await sleep(500);
    out[`éditeur ${w}`] = await f.evaluate(MEASURE, { edit: true, count: blocks.length });
  }
  return out;
}

/* ============================== N : pages existantes inchangées ============================== */
if (run("N")) {
  await section("N", async () => {
    const blocks = BLOCKS_N();
    ok("N0 page posée (23 blocs d'avant, aucune clé nouvelle)", await publish(PAGES.n, blocks) && !JSON.stringify(blocks).includes("padTop"));
    const got = await docs(SLUG.n, PAGES.n, blocks, { pub: [1440, 1024, 390], edit: [1440] });
    const snap = Object.fromEntries(Object.entries(got).map(([k, rows]) => [k, rows.error ? rows : snapshot(rows)]));
    const bad = Object.entries(got).filter(([, rows]) => rows.error || rows.some((r) => !r || r.error));
    ok("N1 chaque bloc est mesuré (public 1440 / 1024 / 390, éditeur 1440)", bad.length === 0, JSON.stringify(bad).slice(0, 400));
    if (!existsSync(GOLDEN)) {
      mkdirSync(path.dirname(GOLDEN), { recursive: true });
      writeFileSync(GOLDEN, `${JSON.stringify(snap, null, 1)}\n`);
      info("N2 empreintes ENREGISTRÉES (première exécution : la base d'avant le lot)");
    } else {
      const gold = JSON.parse(readFileSync(GOLDEN, "utf8"));
      for (const [k, rows] of Object.entries(snap)) {
        const g = gold[k];
        const diffs = [];
        rows.forEach((r, i) => {
          for (const key of ["zone", "zH", "cTop", "cBot", "dPrev"]) {
            const a = r?.[key], b = g?.[i]?.[key];
            if (key === "zone" ? a !== b : !(a === b || near(a, b, 0.6))) diffs.push(`${blocks[i].uid}.${key} ${b}→${a}`);
          }
        });
        ok(`N2 empreintes identiques à la base — ${k} (${rows.length} blocs)`, diffs.length === 0, diffs.slice(0, 6).join(" ; "));
      }
    }
  });
}

/* ============================== M : cause de la bande et légende vide ============================== */
if (run("M")) {
  await section("M", async () => {
    const blocks = BLOCKS_M();
    ok("M0 page posée (planche libre recadrée : carte, carte + légende, fond, carte + fond)", await publish(PAGES.m, blocks));
    const rest = (rows, i) => rows[i];
    // Public.
    for (const w of [1440, 1024, 390]) {
      const p = await publicPage(SLUG.m, w);
      const rows = await p.evaluate(MEASURE, { count: blocks.length });
      const caps = await p.evaluate(() => [...document.querySelectorAll(".free-board-section")].map((s) => { const c = s.querySelector(":scope > .media-caption"); return c ? { h: c.getBoundingClientRect().height, show: getComputedStyle(c).display !== "none" } : null; }));
      await p.context().close();
      const m = rows.map((r) => r && (r.error ? r : { below: r.cBot, base: r.bb }));
      info(`M public ${w} : bande sous le cadre ${m.map((x) => `${r1(x.below)} (rembourrage ${r1(x.base)})`).join(" / ")} ; légendes ${JSON.stringify(caps)}`);
      ok(`M1 public ${w} : légende vide = 0 px réservé (aucune légende rendue, bande = rembourrage de la zone)`, !caps[0]?.show && !caps[2]?.show && !caps[3]?.show && near(rows[0].cBot, rows[0].bb, 1.5) && near(rows[2].cBot, rows[2].bb, 1.5) && near(rows[3].cBot, rows[3].bb, 1.5), JSON.stringify([caps, rows.map((r) => [r.cBot, r.bb])]));
      ok(`M2 public ${w} : légende remplie = dans le flux, la carte la contient`, caps[1]?.show && caps[1].h > 10 && rows[1].cBot > rows[1].bb + caps[1].h - 1.5, JSON.stringify([caps[1], rows[1].cBot, rows[1].bb]));
    }
    // Éditeur : repos, survol, choix.
    for (const w of [1440, 390]) {
      await open(PAGES.m, w);
      for (const k of [0, 2, 3]) {
        const uid = `m${k}`;
        const host = f.locator("[data-edit-block]:not([data-edit-parent])").nth(k);
        const fb = host.locator(".free-board");
        await fb.evaluate((el) => el.scrollIntoView({ block: "center" }));
        await page.mouse.move(3, 3);
        await sleep(500);
        const at = () => f.evaluate(MEASURE, { edit: true, only: k }).then((r) => r[0]);
        const cap = () => host.evaluate((h) => { const c = h.querySelector(".media-caption"); const fbb = h.querySelector(".free-board").getBoundingClientRect(); if (!c) return null; const b = c.getBoundingClientRect(); return { show: getComputedStyle(c).display !== "none", h: b.height, top: b.top - fbb.bottom, pos: getComputedStyle(c).position }; });
        const r0 = await at();
        const box = await fb.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
        await sleep(600);
        const r1h = await at();
        const c1 = await cap();
        await page.mouse.click(box.x + 4, box.y + box.height - 4);
        await sleep(700);
        const r2 = await at();
        const c2 = await cap();
        const sel = await host.evaluate((h) => Boolean(h.closest("[data-edit-selected]") || h.querySelector("[data-edit-selected]") || document.querySelector("[data-edit-selected]")));
        info(`M éditeur ${w} ${uid} : bande repos ${r1(r0.cBot)} / survol ${r1(r1h.cBot)} / choix ${r1(r2.cBot)} ; hauteur zone ${r1(r0.zH)} / ${r1(r1h.zH)} / ${r1(r2.zH)} ; légende ${JSON.stringify(c1)} / ${JSON.stringify(c2)} ; choisi=${sel}`);
        ok(`M3 éditeur ${w} ${uid} : repos = rembourrage de la zone`, near(r0.cBot, r0.bb, 1.5), `${r0.cBot} / ${r0.bb}`);
        ok(`M4 éditeur ${w} ${uid} : au survol les champs vides ne réservent AUCUNE hauteur (la zone ne bouge pas)`, near(r1h.zH, r0.zH, 1), `${r0.zH} → ${r1h.zH}`);
        ok(`M5 éditeur ${w} ${uid} : au choix, idem`, near(r2.zH, r0.zH, 1), `${r0.zH} → ${r2.zH}`);
        ok(`M6 éditeur ${w} ${uid} : les champs vides restent VISIBLES (et utilisables) au survol, sous le cadre`, c1?.show && c1.h > 10 && c1.top >= -1, JSON.stringify(c1));
        await page.keyboard.press("Escape");
      }
      // Légende remplie : dans le flux (comme en public).
      const rows = await f.evaluate(MEASURE, { edit: true, only: 1 });
      ok(`M7 éditeur ${w} : légende remplie = dans le flux (la carte la contient)`, rows[0].cBot > rows[0].bb + 10, `${rows[0].cBot} / ${rows[0].bb}`);
    }
  });
}

/* ============================== S : espacement intérieur haut / bas ============================== */
if (run("S")) {
  await section("S", async () => {
    const blocks = BLOCKS_S();
    ok(`S0 page posée (${blocks.length} blocs : 4 composants × carte / fond / carte + fond × crans et nombres, et sans zone)`, await publish(PAGES.s, blocks));
    const saved = sql((db) => db.prepare("select type, props from blocks where page_id = ? order by position").all(PAGES.s)).map((b) => JSON.parse(b.props));
    ok("S1 la base garde padTop / padBottom tels quels (crans nommés ou nombres, rien d'autre)", saved.filter((p) => p.look?.padTop === "none" && p.look?.padBottom === "none").length === 12 && saved.filter((p) => p.look?.padTop === 40 && p.look?.padBottom === 40).length === 7 && saved.filter((p) => p.look?.padTop === "xl" && p.look?.padBottom === "s").length === 6);
    const got = await docs(SLUG.s, PAGES.s, blocks, { pub: [1440, 1024, 390], edit: [1440, 1024, 390] });
    const idx = Object.fromEntries(blocks.map((b, i) => [b.uid, i]));
    for (const [doc, rows] of Object.entries(got)) {
      if (rows.error || rows.some((r) => !r || r.error)) {
        ok(`S2 ${doc} : tous les blocs mesurés`, false, JSON.stringify(rows.error ?? rows.filter((r) => !r || r.error)).slice(0, 300));
        continue;
      }
      const val = (v, r) => (typeof v === "number" ? v : v === "none" ? 0 : r[v]);
      const fails = [];
      let checked = 0;
      for (const b of blocks) {
        const m = /^(n|c|f|cf)(fb|rt|im|gr)(d|n0|n40|xs)$/.exec(b.uid);
        if (!m || m[3] === "d") continue;
        const [, z, t, v] = m;
        const base = rows[idx[`${z}${t}d`]];
        const cur = rows[idx[b.uid]];
        const lk = b.props.look;
        checked++;
        if (z === "n") {
          // Sans zone colorée : sans effet.
          if (!(near(cur.zH, base.zH, 1) && near(cur.cTop, base.cTop, 1) && near(cur.cBot, base.cBot, 1))) fails.push(`${b.uid} sans zone : ${r1(base.zH)}→${r1(cur.zH)}`);
          continue;
        }
        const nT = val(lk.padTop, cur), nB = val(lk.padBottom, cur);
        const dT = nT - cur.bt, dB = nB - cur.bb;
        if (!near(cur.cTop - base.cTop, dT, 1.5)) fails.push(`${b.uid} haut ${r1(cur.cTop - base.cTop)} (attendu ${r1(dT)})`);
        if (!near(cur.cBot - base.cBot, dB, 1.5)) fails.push(`${b.uid} bas ${r1(cur.cBot - base.cBot)} (attendu ${r1(dB)})`);
        if (!near(cur.zH - base.zH, dT + dB, 2)) fails.push(`${b.uid} zone ${r1(cur.zH - base.zH)} (attendu ${r1(dT + dB)})`);
        // La planche libre en carte n'a aucune marge propre : la bande EST la valeur choisie.
        if (t === "fb" && (z === "c" || z === "cf") && !(near(cur.cBot, nB, 1.5) && near(cur.cTop, nT, 1.5))) fails.push(`${b.uid} bande ${r1(cur.cTop)}/${r1(cur.cBot)} (attendu ${r1(nT)}/${r1(nB)})`);
      }
      ok(`S2 ${doc} : ${checked} blocs, la zone gagne / perd exactement (valeur − rembourrage d'avant), haut et bas`, fails.length === 0 && checked === 25, fails.slice(0, 6).join(" ; "));
      // Les blocs sans réglage restent ceux d'avant (rembourrage de zone = celui qu'on lit).
      // Sans réglage : le bas de la planche libre, seul composant sans marge propre, est EXACTEMENT le rembourrage d'avant.
      const fbs = blocks.filter((b) => /^(c|cf|f)fbd$/.test(b.uid));
      ok(`S3 ${doc} : sans réglage, la planche libre garde le rembourrage d'avant (carte : M ; fond seul : espace de section)`, fbs.every((b) => { const r = rows[idx[b.uid]]; return near(r.cBot, r.bb, 1.5); }), JSON.stringify(fbs.map((b) => [b.uid, r1(rows[idx[b.uid]].cBot), r1(rows[idx[b.uid]].bb)])));
    }
    // L'un des cas de la page, en public 1440, en images.
    const p = await publicPage(SLUG.s, 1440);
    await p.screenshot({ path: path.join(SHOTS, "s-public-1440.png") });
    await p.context().close();
  });
}

/* ============================== U : gestes de l'éditeur ============================== */
if (run("U")) {
  await section("U", async () => {
    const blocks = BLOCKS_M();
    ok("U0 page posée", await publish(PAGES.m, blocks));
    const draftRow = () => sql((db) => db.prepare("select draft from pages where id = ?").get(PAGES.m)).draft;
    const lookNow = () => (draftRow() ? JSON.parse(draftRow()).blocks[0]?.props?.look : JSON.parse(sql((db) => db.prepare("select props from blocks where page_id = ? order by position limit 1").get(PAGES.m)).props).look) ?? {};
    const journalCount = () => {
      const file = path.join(process.env.DATA_DIR ?? "data", "edit-log.db");
      if (!existsSync(file)) return { n: 0, last: [] };
      const db = new Database(file, { readonly: true });
      try {
        return { n: db.prepare("select count(*) as n from edit_log").get().n, last: db.prepare("select * from edit_log order by id desc limit 4").all() };
      } finally {
        db.close();
      }
    };
    const j0 = journalCount();
    await open(PAGES.m, 1440);
    const host = f.locator("[data-edit-block]:not([data-edit-parent])").first();
    await host.scrollIntoViewIfNeeded();
    const button = f.locator('.pe-tools [data-testid="space-button"]');
    let selected = false;
    for (const [sel, pos] of [[".surface-card", { x: 6, y: 6 }], [".free-board-section", { x: 6, y: 6 }], [".free-board", { x: 6, y: 6 }]]) {
      await host.locator(sel).first().click({ position: pos, force: true }).catch(() => {});
      if (await button.waitFor({ timeout: 2500 }).then(() => true, () => false)) { selected = true; break; }
    }
    ok("U1 le bloc est choisi, la barre propose « Espacement »", selected);
    await button.click();
    const menu = f.locator('[data-testid="space-menu"]').first();
    await menu.waitFor({ timeout: 20000 });
    ok("U2 le menu a « Intérieur haut » et « Intérieur bas » à côté de « Côtés » (mêmes curseurs à crans)", (await menu.locator('[data-testid="slider-padTop"] [data-snap]').count()) >= 6 && (await menu.locator('[data-testid="slider-padBottom"] [data-snap]').count()) >= 6 && (await menu.locator('[data-testid="slider-spaceSides"]').count()) === 1);
    await menu.locator('[data-testid="slider-padBottom"] [data-snap="none"]').click();
    ok("U3 « Intérieur bas : Aucun » écrit padBottom = « none » dans le brouillon, et rien d'autre", await waitFor(() => lookNow().padBottom === "none", 20000) && JSON.stringify(Object.keys(lookNow()).sort()) === '["padBottom"]', JSON.stringify(lookNow()));
    await menu.locator('[data-testid="slider-padTop"] input[type=range]').fill("40");
    ok("U4 « Intérieur haut » à 40 px : nombre libre", await waitFor(() => lookNow().padTop === 40, 20000), JSON.stringify(lookNow()));
    await page.keyboard.press("Escape");
    await settled(page);
    const j1 = journalCount();
    info(`U journal : ${j0.n} → ${j1.n} lignes ; dernière : ${JSON.stringify(j1.last[0]).slice(0, 300)}`);
    ok("U5 le journal d'édition garde la trace des deux réglages (lisible)", j1.n >= j0.n + 2 && /look|espac|mise en forme/i.test(JSON.stringify(j1.last.slice(0, 2))), JSON.stringify(j1.last.slice(0, 2)).slice(0, 400));
    // Rechargé.
    await open(PAGES.m, 1440);
    const r = await f.evaluate(MEASURE, { edit: true, only: 0 }).then((x) => x[0]);
    ok("U6 rechargé : l'éditeur montre la planche à 40 px du haut de la carte et au ras du bas", near(r.cTop, 40, 1.5) && near(r.cBot, 0, 1.5), `${r.cTop} / ${r.cBot}`);
    const first = f.locator("[data-edit-block]:not([data-edit-parent])").first();
    await first.scrollIntoViewIfNeeded();
    await first.locator(".surface-card").first().click({ position: { x: 6, y: 6 }, force: true });
    await f.locator('.pe-tools [data-testid="space-button"]').click();
    const menu2 = f.locator('[data-testid="space-menu"]').first();
    await menu2.waitFor({ timeout: 20000 });
    ok("U7 rechargé : les curseurs montrent « Aucun » et « 40 px »", /Aucun/.test(await menu2.locator('[data-testid="slider-padBottom"] output').innerText()) && /40/.test(await menu2.locator('[data-testid="slider-padTop"] output').innerText()));
    await page.keyboard.press("Escape");
    // Publié : public = éditeur.
    ok("U8 publication", await publish(PAGES.m, JSON.parse(draftRow()).blocks));
    const pub = sql((db) => db.prepare("select props from blocks where page_id = ? order by position").all(PAGES.m)).map((b) => JSON.parse(b.props));
    ok("U9 la publication garde le réglage (et pas d'autre clé de mise en forme)", pub[0].look?.padBottom === "none" && pub[0].look?.padTop === 40 && Object.keys(pub[0].look).length === 2, JSON.stringify(pub[0].look));
    for (const w of [1440, 1024, 390]) {
      const p = await publicPage(SLUG.m, w);
      const rows = await p.evaluate(MEASURE, { count: 4 });
      await p.context().close();
      ok(`U10 public ${w} : même résultat que l'éditeur (haut 40 px, bas au ras)`, near(rows[0].cTop, 40, 1.5) && near(rows[0].cBot, 0, 1.5) && near(rows[2].cBot, rows[2].bb, 1.5), JSON.stringify(rows[0]));
    }
  });
}

ok("aucune erreur JS de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
process.exit(failures ? 1 : 0);
