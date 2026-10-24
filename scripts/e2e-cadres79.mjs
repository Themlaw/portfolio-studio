#!/usr/bin/env node
/**
 * Lot 79 « Cadres : l'IMAGE ne bouge pas, le cadre colle à son bord » (chromium, serveur requis, base neuve, une connexion admin).
 * Hotfix de la v0.30.0 : avec « Cadre du thème », une bande vide séparait l'image du cadre (bord rose festonné), et l'image rétrécissait quand
 * on passait de « Cadre du thème » à « Bordure ». Les suites 62/64 passaient : leur cadre synthétique était régulier (épaisseurs
 * égales, aucun feston) et elles mesuraient la boîte extérieure, pas l'image.
 *
 * Le cadre ici est REALISTE (simulate-multi cadre79, généré par ce lot, jamais le kit réel) : bord extérieur festonné avec du transparent
 * entre les festons, épaisseur pleine différente sur chaque côté (haut 36, droite 28, bas 60 donc coupé à la découpe de 48, gauche 20).
 *
 *  R  Taille et place de l'IMAGE (ou de la vidéo) : pour chaque conteneur (image seule paysage et portrait, case de grille justifiée et carrée
 *     avec vidéos, vidéo seule, Planche libre, carrousel, image et grille d'une planche), le rectangle de l'<img> / <video> est le même, à 1 px
 *     près, avec Aucun, Bande fine, Bande épaisse et Cadre du thème festonné asymétrique ; aux largeurs 1440 et 390.
 *  P  Aucun vide : au milieu des 4 côtés, le pixel juste à l'extérieur de l'image est celui du cadre (rose du dessin, couleur de la bande), pas
 *     celui du fond (papier) ; aux largeurs 1440 et 390.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=R,P] [SHOTS=dossier] node scripts/e2e-cadres79.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";
import sharp from "sharp";

import { installKitFrameTheme } from "./lib/cadres62.mjs";
import { boardDraft, login, makeMedia, openEditor, pageIdOf, q1, setBoardDraft, setDraft, settled, sleep, sql, waitFor } from "./lib/grille31d.mjs";
import { ensureVideos } from "./lib/video36.mjs";

const BASE = process.env.BASE ?? "http://localhost:3980";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(tmpdir(), "e2e-cadres79");
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const info = (label, v) => console.log(`INFO ${label} : ${typeof v === "string" ? v : JSON.stringify(v)}`);

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
page.setDefaultNavigationTimeout(180000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);

const section = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 8).join(" "));
    await page.screenshot({ path: path.join(SHOTS, `erreur-${name}.png`) }).catch(() => {});
  }
};

/* ---- Médias et thème (cadre festonné asymétrique) -------------------------------------------------------------------- */
const M = await makeMedia(page, BASE);
const V = await ensureVideos(page, BASE);
await installKitFrameTheme(page, BASE, undefined, "cadre79");
const kitSlice = (() => {
  const active = JSON.parse(q1("select value from settings where key = 'activeThemeId'").value);
  return JSON.parse(q1("select data from themes where id = ?", active).data).assets?.kit?.frame?.slice;
})();
info("découpe du cadre dessiné (haut, droite, bas, gauche)", kitSlice);
const PINK = [232, 120, 154];
// Lot 74 : un cadre de la bibliotheque (PNG synthetique, bord plein asymetrique : haut 40, droite 40, bas 60, gauche 40) suit la meme regle.
const CUSTOM_RGB = [200, 30, 30];
const customFrameId = await (async () => {
  const W = 300;
  const raw = Buffer.alloc(W * W * 4);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) if (y < 40 || x < 40 || x >= W - 40 || y >= W - 60) raw.set([...CUSTOM_RGB, 255], (y * W + x) * 4);
  const buffer = await sharp(raw, { raw: { width: W, height: W, channels: 4 } }).png().toBuffer();
  const res = await page.request.post(`${BASE}/admin/api/cadres`, { headers: { origin: BASE }, multipart: { file: { name: "cadre79.png", mimeType: "image/png", buffer } } });
  const json = await res.json();
  if (!json.ok) throw new Error(`import du cadre perso : ${json.message}`);
  return json.entry.id;
})();

const PHOTOS = pageIdOf("decors");
const project = q1("select id, slug from projects order by id limit 1");
const img = (uid, mediaId, props = {}) => ({ uid, type: "image", props: { mediaId, width: "wide", ...props } });
const vid = (uid, mediaId, props = {}) => ({ uid, type: "video-single", props: { mediaId, variant: "plain", mode: "loop", ...props } });
const grid = (uid, children, props = {}) => ({ uid, type: "grid", props: { layout: "2", gap: "normal", align: "stretch", ratio: "auto", top: "gap", ...props, children } });
const free = (uid, items, props = {}) => ({ uid, type: "free-board", props: { format: "3:2", phone: "scale", items, ...props } });
const fitem = (id, media, x, y, w, extra = {}) => ({ id, media, x, y, w, rot: 0, z: 0, ...extra });

async function publish(pageId, blocks, board) {
  setDraft(pageId, blocks);
  if (board) setBoardDraft(project.id, pageId, board);
  await openEditor(page, BASE, pageId);
  await settled(page);
  await page.getByRole("button", { name: "Publier", exact: true }).click();
  const confirm = page.locator("dialog[open]").getByRole("button", { name: "Mettre en ligne" });
  if (await confirm.waitFor({ timeout: 4000 }).then(() => true, () => false)) await confirm.click();
  const done = await waitFor(() => sql((db) => db.prepare("select draft from pages where id = ?").get(pageId)).draft === null && (!board || boardDraft(project.id) === null), 150000);
  await sleep(2500);
  return done;
}
const publicPage = async (urlPath, viewport) => {
  const c = await browser.newContext({ viewport, ...(viewport.width < 600 ? { isMobile: true } : {}) });
  const p = await c.newPage();
  p.setDefaultTimeout(30000);
  p.on("pageerror", (e) => errors.push(`public : ${e.message}`));
  await p.goto(`${BASE}${urlPath}`, { waitUntil: "networkidle" });
  await p.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 80));
    }
    window.scrollTo(0, 0);
  });
  await sleep(900);
  return p;
};

/* ---- Les quatre choix et la page d'essai ------------------------------------------------------------------------------------ */
const CHOICES = [
  ["aucun", { kind: "none" }],
  ["bande fine", { kind: "band", width: "fin", color: "primary" }],
  ["bande épaisse", { kind: "band", width: "epais", color: "primary" }],
  ["cadre du thème", { kind: "theme" }],
  ["cadre perso", { kind: "custom", id: customFrameId }],
];
const look = (frame) => ({ look: { frame } });
/** Une copie de chaque conteneur ; `frame` = le choix de l'artiste, appliqué partout (page ET planche). */
function pageFor(frame) {
  const slots = {};
  for (const s of ["c1-p0", "c1-p1"]) slots[s] = frame;
  const blocks = [
    img("i1", M.paysage, look(frame)),
    img("i2", M.portrait, look(frame)),
    grid("g1", [img("g11", M.paysage, look(frame)), img("g12", M.portrait, look(frame)), img("g13", M.carre, look(frame)), img("g14", M.panorama, look(frame)), img("g15", M.paysage2, look(frame))], { layout: "auto" }),
    grid("g2", [img("g21", M.carre, look(frame)), vid("g22", V.short, look(frame)), vid("g23", V.long, { mode: "player", ...look(frame) })], { layout: "3", ratio: "1:1" }),
    vid("v1", V.short, look(frame)),
    free("f1", [fitem("a1", M.paysage, 8, 8, 40, { frame }), fitem("a2", M.portrait, 55, 6, 25, { frame })]),
    { uid: "pbd", type: "project-board", props: { project: project.slug, look: { slotFrame: slots } } },
  ];
  const board = [
    { uid: "c1", type: "strip", props: { source: "own", media: [M.paysage, M.portrait] } },
    img("bi1", M.carre, look(frame)),
    grid("bg1", [img("bg11", M.paysage, look(frame)), img("bg12", M.carre, look(frame))], {}),
  ];
  return { blocks, board };
}

/** Pour chaque boîte de média du document : rectangle de l'<img> / <video> (page), conteneur, couleur de bande. */
const measure = (pub) =>
  pub.evaluate(() =>
    [...document.querySelectorAll("main .media-frame")].map((f, i) => {
      const m = f.querySelector("img, video");
      const r = m.getBoundingClientRect();
      const where = f.closest(".free-item") ? "libre" : f.closest(".strip-frame") ? "carrousel" : f.closest(".block-grid") ? "grille" : f.closest("figure.block-image") ? "image seule" : "autre";
      return { i, where, tag: m.tagName.toLowerCase(), x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height, band: getComputedStyle(f).borderTopColor };
    }),
  );

let lastCrop = null;
/** Couleur du pixel à `off` px à l'extérieur du bord (le bord intérieur d'un dessin est adouci : 2 px pour le cadre du thème), au milieu de chacun des 4 côtés de l'image `i` (null : hors de la fenêtre). */
async function outsidePixels(pub, i, off = 1) {
  const rect = await pub.evaluate((idx) => {
    const m = document.querySelectorAll("main .media-frame")[idx].querySelector("img, video");
    m.scrollIntoView({ block: "center", inline: "center" });
    return null;
  }, i);
  void rect;
  // Le défilement peut être animé (scroll-behavior) : on attend que la page ne bouge plus avant de mesurer et de capturer.
  let prev = -1;
  for (let k = 0; k < 40; k++) {
    const y = await pub.evaluate(() => scrollY + scrollX);
    if (y === prev) break;
    prev = y;
    await sleep(150);
  }
  await sleep(150);
  const r = await pub.evaluate((idx) => {
    const m = document.querySelectorAll("main .media-frame")[idx].querySelector("img, video");
    const b = m.getBoundingClientRect();
    return { l: b.left, t: b.top, w: b.width, h: b.height, vw: innerWidth, vh: innerHeight };
  }, i);
  const x0 = Math.floor(r.l) - 3;
  const y0 = Math.floor(r.t) - 3;
  const w = Math.ceil(r.w) + 8;
  const h = Math.ceil(r.h) + 8;
  if (x0 < 0 || y0 < 0 || x0 + w > r.vw || y0 + h > r.vh) return null;
  const buf = await pub.screenshot({ clip: { x: x0, y: y0, width: w, height: h } });
  const { data, info: inf } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (x, y) => {
    const o = (y * inf.width + x) * 3;
    return [data[o], data[o + 1], data[o + 2]];
  };
  lastCrop = { buf, rect: r };
  const midX = Math.round(r.l + r.w / 2) - x0;
  const midY = Math.round(r.t + r.h / 2) - y0;
  return {
    crop: buf,
    rect: r,
    haut: at(midX, Math.floor(r.t) - off - y0),
    bas: at(midX, Math.ceil(r.t + r.h) + off - 1 - y0),
    gauche: at(Math.floor(r.l) - off - x0, midY),
    droite: at(Math.ceil(r.l + r.w) + off - 1 - x0, midY),
  };
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const parse = (c) => c.match(/\d+/g).slice(0, 3).map(Number);

const RESULTS = {};
if (run("R") || run("P")) {
  for (const [name, frame] of CHOICES) {
    const { blocks, board } = pageFor(frame);
    ok(`page publiée (${name})`, await publish(PHOTOS, blocks, board));
    for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const pub = await publicPage("/fr/decors", vp);
      const rects = await measure(pub);
      const px = [];
      if (name !== "aucun" && run("P")) for (const f of rects) px.push(await outsidePixels(pub, f.i, name === "cadre du thème" ? 2 : 1));
      const shotTarget = pub.locator("figure.block-image .media-frame").first();
      await shotTarget.scrollIntoViewIfNeeded();
      await sleep(300);
      await pub.screenshot({ path: path.join(SHOTS, `${vp.width}-${name.replace(/ /g, "-")}.png`) }).catch(() => {});
      RESULTS[`${vp.width}|${name}`] = { rects, px };
      await pub.context().close();
    }
  }
  const NONE = (w) => RESULTS[`${w}|aucun`].rects;
  for (const w of [1440, 390]) {
    info(`conteneurs à ${w}`, NONE(w).map((f) => `${f.where}/${f.tag}`).join(" "));
    for (const [name] of CHOICES.slice(1)) {
      const a = NONE(w);
      const b = RESULTS[`${w}|${name}`].rects;
      if (run("R")) {
        const bad = [];
        if (a.length !== b.length) bad.push(`nombre de médias ${a.length} → ${b.length}`);
        else
          for (let i = 0; i < a.length; i++) {
            const d = ["x", "y", "w", "h"].map((k) => b[i][k] - a[i][k]);
            if (d.some((v) => Math.abs(v) > 1)) bad.push(`#${i} ${a[i].where}/${a[i].tag} ${a[i].w.toFixed(0)}×${a[i].h.toFixed(0)} → décalage x/y/l/h ${d.map((v) => v.toFixed(1)).join("/")}`);
          }
        ok(`R ${w} px, ${name} : l'image (ou la vidéo) garde la taille et la place de « Aucun » (±1 px), ${a.length} médias`, bad.length === 0, bad.slice(0, 8).join(" | "));
      }
      if (run("P")) {
        const bad = [];
        let checked = 0;
        const px = RESULTS[`${w}|${name}`].px;
        for (let i = 0; i < px.length; i++) {
          if (!px[i]) continue;
          checked++;
          const want = name === "cadre du thème" ? PINK : name === "cadre perso" ? CUSTOM_RGB : parse(b[i].band);
          for (const side of ["haut", "bas", "gauche", "droite"])
            if (dist(px[i][side], want) > 70) {
              bad.push(`#${i} ${b[i].where} ${side} ${px[i][side].join(",")} (y ${px[i].rect.t.toFixed(2)} h ${px[i].rect.h.toFixed(2)} x ${px[i].rect.l.toFixed(2)})`);
              if (bad.length <= 3) await sharp(px[i].crop).resize({ width: Math.min(1400, px[i].rect.w * 4 + 32), kernel: "nearest" }).toFile(path.join(SHOTS, `echec-${w}-${name.replace(/ /g, "-")}-${i}-${side}.png`));
            }
        }
        info(`P ${w} px, ${name} : médias échantillonnés`, `${checked} / ${px.length}`);
        ok(`P ${w} px, ${name} : au milieu des 4 côtés, le pixel contre l'image est celui du cadre (aucun vide de fond)`, checked >= 8 && bad.length === 0, `${bad.length} côtés : ${bad.slice(0, 8).join(" | ")}`);
      }
    }
  }
}

ok("aucune erreur JavaScript dans la page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures === 0 ? "\nTOUT PASSE" : `\n${failures} ECHEC(S)`);
process.exit(failures === 0 ? 0 : 1);
