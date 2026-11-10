#!/usr/bin/env node
/**
 * Lot 132 « Animations dessinées image par image + boiling line » (chromium, serveur requis, base neuve). ÉCRIT AVANT le code.
 * Données SYNTHÉTIQUES (images de couleurs unies générées ici).
 *  A  Envoi (/admin/api/animation) : PNG multiples, zip, feuille de sprites (cols × rangées) → un média « feuille WebP » (variants.anim) ;
 *     même contenu = même média ; bornes (1 image, 49 images, démesurée, mauvais type) refusées ; sans session / autre origine refusé ;
 *     la feuille est servie (WebP), l'original ne l'est jamais ; journal : libellé de la route.
 *  B  Public : image seule, case de grille, planche libre (cadence propre à l'élément), image dans la planche d'un projet ; HTML de
 *     l'animation (role=img, alt, durée = images ÷ cadence, pas de visionneuse) ; une page SANS animation : aucun `anim-sheet`.
 *  C  Navigateur : la feuille défile (animation CSS « anim-steps », steps), pause hors écran / reprise à l'écran, image fixe en
 *     prefers-reduced-motion, une seule lecture avec loop=false.
 *  D  Restauration : variantes perdues + média remis en file → la feuille est refaite, la définition (anim) est gardée.
 *  K  Boiling line : le CSS de `kit.boil` dans un vrai navigateur alterne les dessins (8 i/s) et s'arrête en prefers-reduced-motion.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=A,B,C,D,K] node --import tsx scripts/e2e-animation132.mjs
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { chromium } from "playwright";
import sharp from "sharp";

import { writeZip } from "../src/lib/themes/zip.ts";
import { boilCss } from "../src/lib/animation/boil.ts";
import { img, login, pageIdOf, q1, sleep, sql, waitFor } from "./lib/grille31d.mjs";
import { publishBlocks } from "./lib/page-draft.mjs";

const BASE = process.env.BASE ?? "http://localhost:4000";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const DATA = process.env.DATA_DIR ?? "data";
sharp.cache(false);
sharp.concurrency(1);

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${String(detail).slice(0, 600)}` : ""}`);
};

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
await login(page, BASE);

const COLORS = ["#e53935", "#43a047", "#1e88e5", "#fdd835", "#00acc1", "#8e24aa"];
const frame = (i, w = 200, h = 120) => sharp({ create: { width: w, height: h, channels: 4, background: COLORS[i % 6] } }).png().toBuffer();
const frames = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => frame(i)));
const post = (parts, fields = {}, opts = {}) =>
  (opts.request ?? page.request).post(`${BASE}/admin/api/animation`, { headers: { origin: opts.origin ?? BASE }, multipart: { ...fields, ...parts }, timeout: 180000, failOnStatusCode: false });
const pngs = (list, prefix = "dessin") => Object.fromEntries(list.map((buffer, i) => [`file${i}`, { name: `${prefix}-${String(i + 1).padStart(2, "0")}.png`, mimeType: "image/png", buffer }]));
// Plusieurs parties « file » : Playwright n'accepte qu'une clé par partie ; la route lit toutes les parties de fichier, quel que soit leur nom.

let A = null;
if (run("A") || run("B") || run("C") || run("D")) {
  const res = await post(pngs(frames), { name: "cycle" });
  const body = await res.json().catch(() => ({}));
  ok("A1 six PNG → un média", res.status() === 200 && body.ok && body.media?.id > 0, JSON.stringify(body));
  A = body.media;
  ok("A2 le média devient prêt", await waitFor(() => q1("select status from media where id = ?", A.id)?.status === "ready", 120000));
  const row = q1("select width, height, variants, kind, mime from media where id = ?", A.id);
  const v = JSON.parse(row.variants);
  ok("A3 variants.anim = 6 images de 200 × 120", v.anim?.frames === 6 && v.anim.fw === 200 && v.anim.fh === 120, row.variants);
  ok("A4 la feuille fait 1200 × 120 (une bande WebP)", row.width === 1200 && row.height === 120 && row.kind === "image" && v.files.every((f) => f.format === "webp"), JSON.stringify(row));
  const file = v.files[0]?.key;
  const served = await page.request.get(`${BASE}/media/${file}`);
  ok("A5 la feuille est servie en WebP", served.status() === 200 && /image\/webp/.test(served.headers()["content-type"] ?? ""));
  const orig = q1("select key from media where id = ?", A.id).key;
  ok("A6 l'original n'est jamais servi", (await page.request.get(`${BASE}/media/${orig}`, { failOnStatusCode: false })).status() === 404);
  const again = await (await post(pngs(frames), { name: "cycle" })).json();
  ok("A7 même contenu = même média", again.ok && again.media.id === A.id && again.media.reused === true, JSON.stringify(again));
}
if (run("A")) {
  // zip
  const zip = writeZip(frames.slice(0, 3).map((b, i) => ({ name: `anim/f${i + 1}.png`, data: b })));
  const rz = await (await post({ file: { name: "anim.zip", mimeType: "application/zip", buffer: zip } })).json();
  ok("A8 un zip de PNG", rz.ok && rz.media?.id > 0, JSON.stringify(rz));
  await waitFor(() => q1("select status from media where id = ?", rz.media.id)?.status === "ready", 120000);
  ok("A9 zip : 3 images", JSON.parse(q1("select variants from media where id = ?", rz.media.id).variants).anim?.frames === 3);
  // feuille de sprites 3 × 2
  const sheet = await sharp({ create: { width: 300, height: 200, channels: 4, background: "#fff" } })
    .composite(await Promise.all(Array.from({ length: 6 }, async (_, i) => ({ input: await frame(i, 100, 100), left: (i % 3) * 100, top: Math.floor(i / 3) * 100 }))))
    .png()
    .toBuffer();
  const rs = await (await post({ file: { name: "sprites.png", mimeType: "image/png", buffer: sheet } }, { cols: "3", rows: "2" })).json();
  ok("A10 feuille de sprites 3 × 2", rs.ok && rs.media?.id > 0, JSON.stringify(rs));
  await waitFor(() => q1("select status from media where id = ?", rs.media.id)?.status === "ready", 120000);
  ok("A11 sprites : 6 images de 100 × 100", (() => { const a = JSON.parse(q1("select variants from media where id = ?", rs.media.id).variants).anim; return a?.frames === 6 && a.fw === 100 && a.fh === 100; })());
  // refus
  const one = await post({ file: { name: "seule.png", mimeType: "image/png", buffer: frames[0] } });
  ok("A12 une seule image sans cols × rangées : refusée", one.status() === 422, one.status());
  const many = await post(pngs(await Promise.all(Array.from({ length: 49 }, (_, i) => frame(i, 8, 8)))));
  ok("A13 49 images : refusées", many.status() === 422, many.status());
  const bad = await post({ a: { name: "a.png", mimeType: "image/png", buffer: Buffer.from("pas une image") }, b: { name: "b.png", mimeType: "image/png", buffer: Buffer.from("non plus") } });
  ok("A14 fichiers qui ne sont pas des images : refusés", bad.status() === 415 || bad.status() === 422, bad.status());
  const huge = await sharp({ create: { width: 9000, height: 5000, channels: 3, background: "#fff" } }).png({ compressionLevel: 9 }).toBuffer();
  const hr = await post({ a: { name: "a.png", mimeType: "image/png", buffer: huge }, b: { name: "b.png", mimeType: "image/png", buffer: huge } });
  ok("A15 image de plus de 40 Mpx : refusée", hr.status() === 422, hr.status());
  const anon = await ctx.browser().newContext();
  const noSession = await post(pngs(frames), {}, { request: anon.request });
  ok("A16 sans session : refusé", noSession.status() !== 200, noSession.status());
  await anon.close();
  const cross = await post(pngs(frames), {}, { origin: "https://autre.example" });
  ok("A17 autre origine : refusée", cross.status() === 403, cross.status());
  const count = sql((db) => db.prepare("select count(*) n from media where original_name like 'seule%' or original_name like 'dessin-%' and id > ?").get(A.id)).n;
  ok("A18 les refus n'ont rien enregistré", count === 0, count);
}

const PAGE = pageIdOf("animation");
const alt = "Cycle de test";
if (A) sql((db) => db.prepare("update media set alt = ? where id = ?").run(JSON.stringify({ fr: alt, en: alt }), A.id));
const B_BLOCKS = () => [
  img("an1", A.id, { fps: 12 }),
  { uid: "an2", type: "grid", props: { layout: "2", gap: "normal", align: "stretch", ratio: "auto", top: "gap", children: [img("an2a", A.id, { fps: 6 }), img("an2b", A.id, { fps: 24, loop: false })] } },
  { uid: "an3", type: "free-board", props: { format: "3:2", phone: "scale", items: [{ id: "a", media: A.id, x: 10, y: 10, w: 30, rot: 0, z: 0, fps: 8 }, { id: "b", media: A.id, x: 50, y: 10, w: 30, rot: 0, z: 1 }] } },
];
const SLUG = "animation";
if (A && (run("B") || run("C"))) {
  const published = await publishBlocks(page, BASE, PAGE, () => B_BLOCKS(), () => sql((db) => db.prepare("select count(*) n from blocks where page_id = ?").get(PAGE)).n === 3);
  await sleep(1500);
  ok("B0 publié", published);
}
let html = "";
if (A && (run("B") || run("C"))) {
  html = await (await page.request.get(`${BASE}/fr/${SLUG}`)).text();
  const tags = html.match(/<[a-z]+[^>]*class="[^"]*\banim-sheet\b[^"]*"[^>]*>/g) ?? [];
  ok("B1 cinq animations dans le HTML (image, 2 cases, 2 de la planche)", tags.length === 5, tags.length);
  const by = (n) => tags.filter((t) => t.includes(`--af-n:${n}`) || t.includes(`--af-n: ${n}`));
  ok("B2 durée = images ÷ cadence (6/12 = 0,5 s ; 6/6 = 1 s ; 6/24 = 0,25 s ; 6/8 = 0,75 s)", ["0.5s", "1s", "0.25s", "0.75s"].every((d) => tags.some((t) => t.includes(`--af-d:${d}`))), tags.join("\n"));
  ok("B3 role=img et texte alternatif", tags.every((t) => /role="img"/.test(t) && t.includes(`aria-label="${alt}"`)), tags[0]);
  ok("B4 sans cadence choisie : 8 i/s (planche libre)", tags.some((t) => t.includes("--af-d:0.75s")));
  ok("B5 pas de visionneuse sur une animation", !/data-viewer-item[^>]*anim-sheet|anim-sheet[^>]*data-viewer-item/.test(html));
  ok("B6 pas de `loop` = boucle ; loop=false = une fois", tags.filter((t) => t.includes('data-loop="once"')).length === 1);
  const legacy = await (await page.request.get(`${BASE}/fr`)).text();
  ok("B7 une page sans animation : aucun anim-sheet, aucun data-kit-boil", !/anim-sheet|data-kit-boil/.test(legacy));
}
if (A && run("C")) {
  await page.goto(`${BASE}/fr/${SLUG}`, { waitUntil: "networkidle" });
  const first = page.locator(".anim-sheet").first();
  await first.scrollIntoViewIfNeeded();
  await sleep(600);
  const css = await first.evaluate((el) => { const s = getComputedStyle(el); return { name: s.animationName, fn: s.animationTimingFunction, state: s.animationPlayState, size: s.backgroundSize, dur: s.animationDuration }; });
  ok("C1 animation CSS steps, en cours à l'écran", css.name === "anim-steps" && /steps/.test(css.fn) && css.state === "running" && css.dur === "0.5s", JSON.stringify(css));
  ok("C2 la feuille est 6 fois plus large que la case", /^600%|^\d+(\.\d+)?px/.test(css.size), css.size);
  const xs = new Set();
  for (let i = 0; i < 12; i++) { xs.add(await first.evaluate((el) => getComputedStyle(el).backgroundPositionX)); await sleep(70); }
  ok("C3 la position avance par paliers (au moins 4 images vues)", xs.size >= 4, [...xs].join(" | "));
  await page.evaluate(() => window.scrollTo(0, 0));
  const last = page.locator(".anim-sheet").last();
  await page.evaluate(() => { document.querySelector(".free-board-section").style.marginTop = "3000px"; });
  await sleep(500);
  ok("C4 hors écran : en pause", (await last.evaluate((el) => getComputedStyle(el).animationPlayState)) === "paused");
  await last.scrollIntoViewIfNeeded();
  await sleep(500);
  ok("C5 de retour à l'écran : en cours", (await last.evaluate((el) => getComputedStyle(el).animationPlayState)) === "running");
  const reduced = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  const rp = await reduced.newPage();
  await rp.goto(`${BASE}/fr/${SLUG}`, { waitUntil: "networkidle" });
  const rm = await rp.locator(".anim-sheet").first().evaluate((el) => { const s = getComputedStyle(el); return { name: s.animationName, x: s.backgroundPositionX }; });
  ok("C6 prefers-reduced-motion : image fixe (la première)", rm.name === "none" && /^0(%|px)/.test(rm.x), JSON.stringify(rm));
  await reduced.close();
  const once = page.locator('.anim-sheet[data-loop="once"]');
  await once.scrollIntoViewIfNeeded();
  await sleep(1800);
  const end = await once.evaluate((el) => getComputedStyle(el).backgroundPositionX);
  ok("C7 loop=false : s'arrête sur la dernière image", /^100%|^-?\d+(\.\d+)?px/.test(end) && end !== "0%", end);
}
if (A && run("D")) {
  const v = JSON.parse(q1("select variants from media where id = ?", A.id).variants);
  const key = v.files[0].key;
  const abs = path.join(DATA, "media", key);
  sql((db) => {
    db.prepare("update media set status = 'processing', error = null where id = ?").run(A.id);
    db.prepare("delete from jobs where media_id = ?").run(A.id);
    db.prepare("insert into jobs (kind, media_id) values ('image', ?)").run(A.id);
  });
  try { (await import("node:fs")).unlinkSync(abs); } catch { /* stockage non local */ }
  ok("D1 remis en file, la feuille est refaite", await waitFor(() => q1("select status from media where id = ?", A.id)?.status === "ready", 120000));
  const v2 = JSON.parse(q1("select variants from media where id = ?", A.id).variants);
  ok("D2 la définition de l'animation est gardée", v2.anim?.frames === 6 && v2.anim.fw === 200);
  ok("D3 la feuille est de nouveau servie", (await page.request.get(`${BASE}/media/${v2.files[0].key}`, { failOnStatusCode: false })).status() === 200);
  ok("D4 le fichier existe sur le disque", !existsSync(path.join(DATA, "media")) || existsSync(path.join(DATA, "media", v2.files[0].key)));
}
if (run("K")) {
  const kit = (n) => ({ svg: `/media/kit/${n.toString(16).padStart(16, "0")}.svg`, w: 1200, h: 80 });
  const css = boilCss({ stroke: kit(1), boil: { stroke: [kit(2), kit(3)] } });
  const mk = async (opts) => {
    const c = await browser.newContext(opts);
    const p = await c.newPage();
    await p.setContent(`<html data-kit-stroke data-kit-boil="stroke"><head><style>:root{--t-kit-stroke:url(a);--t-kit-boil-stroke-1:url(b);--t-kit-boil-stroke-2:url(c)}${css}</style></head><body><hr class="rule" style="height:6px"></body></html>`);
    return { c, p };
  };
  const { c, p } = await mk({});
  const seen = new Set();
  for (let i = 0; i < 20; i++) { seen.add(await p.locator("hr.rule").evaluate((el) => getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage)); await sleep(60); }
  ok("K1 trois dessins alternés (trait de base + 2)", seen.size === 3, [...seen].join(" | "));
  const dur = await p.locator("hr.rule").evaluate((el) => getComputedStyle(el).animationDuration);
  ok("K2 8 images par seconde (3 dessins = 0,375 s)", dur === "0.375s", dur);
  await c.close();
  const r = await mk({ reducedMotion: "reduce" });
  ok("K3 prefers-reduced-motion : pas d'animation", (await r.p.locator("hr.rule").evaluate((el) => getComputedStyle(el).animationName)) === "none");
  await r.c.close();
}

await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
