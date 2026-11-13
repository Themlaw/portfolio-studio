#!/usr/bin/env node
/**
 * Intégration v0.34b : tests d'INTERACTION entre les lots 121, 127, 128 et 129 et les lots d'avant (chromium, serveur requis, base neuve ;
 * W : webkit, seulement si le navigateur est lançable, voir plus bas). Souris et clavier réels ; données SYNTHÉTIQUES (images et vidéos générées
 * ici, kit simulé par kit-poc/simulate-multi.mts) ; aucun fichier réel, jamais le PSD de l'artiste.
 *
 *  S  127 × lecteur : trois boucles « Son au départ : Activé » (défaut) et un Lecteur ; une seule vidéo SONORE à la fois, aussi en cliquant vite
 *     d'une boucle à l'autre et en ouvrant le Lecteur ; la dernière choisie est audible (niveau RMS réel).
 *  T  128 × 129 : titre de composant dans une carte / un fond avec « Intérieur haut / bas » réglé : le titre reste DANS la zone, l'espacement mesuré
 *     est la valeur réglée (haut et bas ; titre dessus et dessous), public = éditeur.
 *  B  129 × 113 : planche libre RECADRÉE dans une carte, légende vide : 0 px réservé en public (aucune ligne de légende), réglage haut / bas exact quel
 *     que soit le recadrage, la zone vaut haut + cadre + bas, légende remplie dans le flux, éditeur = public, 1440 / 1024 / 390.
 *  P  128 × 119 / 120 / 124 : portée du titre de composant (Ce titre / Tout le projet / Tout le site), gestes réels dans la barre « Aa » ; le menu
 *     d'en-tête et le pied de page ne bougent pas.
 *  K  121 × 127 : kit synthétique avec les 8 dessins vidéo ; ils s'affichent sur le bouton plein écran et le bouton son du lot 127 dans les contextes
 *     du lot 116 (bloc, case de grille, rail, planche de projet, planche libre ; Boucle et Lecteur ; Aperçu) ; sans dessin : rendu identique au 127 seul ;
 *     le réglage « Son au départ » ne change pas le dessin d'une icône ; fond du badge sur le bouton plein écran ; noms accessibles inchangés.
 *  W  Plein écran WebKit : repli iPhone (`webkitEnterFullscreen`) quand l'API standard est absente (WebKit réel si lançable ; sinon noté, et le même
 *     repli est vérifié dans chromium, API retirée).
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=S,T,B,P,W,K] [SHOTS=dossier] node scripts/e2e-interaction034b.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium, webkit } from "playwright";

import { boardDraft, grid, img, login, makeMedia, openEditor, pageIdOf, q1, setBoardDraft, setDraft, settled, sleep, sql, waitFor } from "./lib/grille31d.mjs";
import { publishBlocks } from "./lib/page-draft.mjs";
import { gotoThemesPage } from "./lib/theme-live.mjs";

const BASE = process.env.BASE ?? "http://localhost:4200";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const DATA = process.env.DATA_DIR ?? "./data";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(process.env.BATTERY_DIR ?? tmpdir(), "shots-interaction034b");
const DIR = path.join(tmpdir(), `e2e-interaction034b-${process.pid}`);
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
const THEME = "galerie-lumineuse";

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${String(detail).slice(0, 700)}` : ""}`);
};
const info = (label) => console.log(`INFO ${label}`);
const near = (a, b, tol = 1.5) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= tol;
const sec = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.stack ?? e).split("\n").slice(0, 6).join(" | "));
    await page.screenshot({ path: path.join(SHOTS, `erreur-${name}.png`) }).catch(() => {});
  }
};
const T$ = (s) => ({ fr: s, en: s });

/* ---- Navigateur, connexion, médias synthétiques ------------------------------------------------------------------------------------ */
// ATTENTION : pas de --autoplay-policy=no-user-gesture-required (la règle réelle du navigateur s'applique : un clic est un geste).
const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);

const ff = (...args) => execFileSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
const V = ["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=15", "-t", "4"];
const A = ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100"];
const X264 = ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"];
const FILES = {
  avec: { file: "i34b-avec-son.mp4", args: [...V, ...A, ...X264, "-c:a", "aac", "-ac", "2", "-shortest"] },
  sans: { file: "i34b-sans-son.mp4", args: [...V, ...X264, "-an"] },
};
const row = (name) => q1("select id, status, has_audio from media where original_name = ? order by id desc", name);
const MEDIA = {};
for (const v of Object.values(FILES)) {
  if (!row(v.file)) {
    ff(...v.args, path.join(DIR, v.file));
    await page.goto(`${BASE}/admin/medias`, { waitUntil: "networkidle" });
    await page.locator("input[type=file]").first().setInputFiles(path.join(DIR, v.file));
    if (!(await waitFor(() => Boolean(row(v.file)), 60000))) throw new Error(`${v.file} : envoi non reçu`);
  }
}
for (const [k, v] of Object.entries(FILES)) {
  if (!(await waitFor(() => row(v.file)?.status === "ready", 300000))) throw new Error(`${v.file} : ${JSON.stringify(row(v.file))}`);
  MEDIA[k] = row(v.file).id;
}
const IMG = await makeMedia(page, BASE);
const PAGES = { k: pageIdOf("personnages"), s: pageIdOf("animation"), t: pageIdOf("decors") };
const SLUG = { k: "personnages", s: "animation", t: "decors" };
const project = q1("select id, slug from projects order by id limit 1");
const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});

/** Publie `blocks` sur la page (brouillon écrit comme l'éditeur, puis « Publier »). */
async function publish(pageId, blocks) {
  await page.goto("about:blank");
  const countOf = () => sql((db) => db.prepare("select count(*) as n from blocks where page_id = ?").get(pageId)).n;
  const ready = () => sql((db) => db.prepare("select draft from pages where id = ?").get(pageId)).draft === null && countOf() === blocks.length;
  const end = Date.now() + 240000;
  while (Date.now() < end) {
    if (await publishBlocks(page, BASE, pageId, () => JSON.parse(JSON.stringify(blocks)), ready, 60000).catch(() => false)) {
      await sleep(2500);
      return true;
    }
  }
  return false;
}
async function publicPage(slug, width = 1440, height = 1000, options = {}) {
  const c = await browser.newContext({ viewport: { width, height }, ...options });
  const p = await c.newPage();
  p.setDefaultTimeout(30000);
  p.on("pageerror", (e) => errors.push(`public : ${e.message}`));
  await p.goto(`${BASE}/fr/${slug}`, { waitUntil: "networkidle" });
  await p.waitForFunction(() => [...document.querySelectorAll("img")].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 30000 }).catch(() => {});
  await sleep(500);
  return p;
}
let f;
async function openEd(pageId, blocks, width = 1440) {
  if (blocks) setDraft(pageId, blocks);
  await page.setViewportSize({ width, height: 1000 });
  f = await openEditor(page, BASE, pageId);
  await settled(page);
  await f.waitForFunction(() => [...document.querySelectorAll("img")].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 60000 }).catch(() => {});
  await sleep(600);
  return f;
}

/* ---- Mesures communes (T et B) : zone colorée (carte ou fond), titre, contenu ----------------------------------------------------------- */
const MEASURE = ({ edit }) => {
  const ZONE = '.surface-card[data-surface="on"], .fond-bloc[data-fond="on"]';
  const hosts = edit ? [...document.querySelectorAll("[data-edit-block]:not([data-edit-parent])")] : [...document.querySelectorAll("main > *")];
  const px = (host, css) => {
    const q = document.createElement("i");
    q.style.cssText = `position:absolute;visibility:hidden;display:block;height:${css}`;
    host.append(q);
    const h = q.getBoundingClientRect().height;
    q.remove();
    return h;
  };
  return hosts.map((h, i) => {
    const zone = h.matches(ZONE) ? h : h.querySelector(ZONE);
    const title = h.querySelector(".comp-head-title");
    const content = h.querySelector("figure, .free-board");
    // Légende REMPLIE seulement : sur la toile, les champs vides existent dans le DOM (saisie en place) sans rien occuper.
    const capAll = [...h.querySelectorAll(".media-caption")];
    const cap = capAll.find((x) => x.textContent.trim() !== "");
    const z = zone?.getBoundingClientRect();
    const t = title?.getBoundingClientRect();
    const c = content?.getBoundingClientRect();
    const k = cap?.getBoundingClientRect();
    const below = h.querySelector('.comp-head[data-at="below"]') !== null;
    const cs = zone ? getComputedStyle(zone) : null;
    return {
      i,
      zone: Boolean(zone),
      title: Boolean(title),
      inZone: Boolean(z && t && t.top >= z.top - 0.5 && t.bottom <= z.bottom + 0.5 && t.left >= z.left - 0.5 && t.right <= z.right + 0.5),
      below,
      zH: z?.height ?? null,
      // Distance du bord haut de la zone au premier élément (titre dessus, sinon contenu) ; du dernier élément (titre dessous, sinon légende ou contenu) au bord bas.
      top: z && c ? (title && !below ? t.top : c.top) - z.top : null,
      bottom: z && c ? z.bottom - (title && below ? t.bottom : k ? k.bottom : c.bottom) : null,
      cBottom: z && c ? z.bottom - c.bottom : null,
      cH: c?.height ?? null,
      capH: k?.height ?? 0,
      hasCap: Boolean(cap),
      capInDom: capAll.length,
      cMT: content ? parseFloat(getComputedStyle(content).marginTop) : 0,
      padT: cs ? parseFloat(cs.paddingTop) : null,
      padB: cs ? parseFloat(cs.paddingBottom) : null,
      m: zone ? px(zone, "var(--t-space-m)") : null,
      s: zone ? px(zone, "var(--t-space-s)") : null,
      xl: zone ? px(zone, "var(--t-space-xl)") : null,
    };
  });
};
const r1 = (n) => (typeof n === "number" ? Math.round(n * 10) / 10 : n);
const show = (rows) => JSON.stringify(rows.map((r) => ({ i: r.i, top: r1(r.top), bottom: r1(r.bottom), zH: r1(r.zH), inZone: r.inZone })));

/* ====================================================================================================================================== */
/*  S. 127 × lecteur : une seule vidéo sonore à la fois                                                                                    */
/* ====================================================================================================================================== */
const THRESHOLD = 0.004;
/** Niveau RMS du son réellement joué par UN élément <video> (AudioContext + captureStream). */
const rmsOf = (video) =>
  video.evaluate(async (v) => {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    await ac.resume().catch(() => {});
    let tracks = [];
    for (let i = 0; i < 20; i++) {
      const st = v.captureStream ? v.captureStream() : null;
      tracks = st ? st.getAudioTracks() : [];
      if (tracks.length) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const base = { muted: v.muted, paused: v.paused };
    if (!tracks.length) return { ...base, tracks: 0, rms: 0 };
    const src = ac.createMediaStreamSource(new MediaStream(tracks));
    const an = ac.createAnalyser();
    an.fftSize = 2048;
    src.connect(an);
    const buf = new Float32Array(an.fftSize);
    let acc = 0;
    let n = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 1000) {
      an.getFloatTimeDomainData(buf);
      for (const x of buf) {
        acc += x * x;
        n++;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    await ac.close().catch(() => {});
    return { ...base, tracks: tracks.length, rms: Math.sqrt(acc / n) };
  });
const audible = (r) => r.rms > THRESHOLD && !r.muted && !r.paused;
const vstate = (el) => el.evaluate((e) => { const v = e.querySelector("video"); return { paused: v.paused, muted: v.muted, t: v.currentTime }; });
const playing = (el, timeout = 15000) => waitFor(async () => { const s = await vstate(el); return !s.paused && s.t > 0.15; }, timeout);
const nPlaying = (p) => p.evaluate(() => [...document.querySelectorAll("video")].filter((v) => !v.paused).length);
const nSounding = (p) => p.evaluate(() => [...document.querySelectorAll("video")].filter((v) => !v.paused && !v.muted).length);
const dlgSel = '[data-testid="video-viewer"]';
const vid = (uid, mediaId, props = {}) => ({ uid, type: "video-single", props: { mediaId, variant: "plain", ...props } });

if (run("S"))
  await sec("S", async () => {
    ok("S0 publication : 3 boucles « son au départ : activé » (défaut) et un Lecteur", await publish(PAGES.s, [vid("l1", MEDIA.avec, { mode: "loop" }), vid("l2", MEDIA.avec, { mode: "loop" }), vid("l3", MEDIA.avec, { mode: "loop" }), vid("pl", MEDIA.avec, { mode: "player", title: T$("Lecteur") })]));
    const p = await publicPage(SLUG.s);
    const boxes = p.locator("[data-video-mode]");
    const sounds = await boxes.evaluateAll((els) => els.map((e) => [e.getAttribute("data-video-mode"), e.getAttribute("data-video-sound")]));
    ok("S1 trois boucles et un lecteur, tous « son au départ : activé » (défaut, rien d'écrit)", JSON.stringify(sounds) === JSON.stringify([["loop", "on"], ["loop", "on"], ["loop", "on"], ["player", "on"]]), JSON.stringify(sounds));
    const [L1, L2, L3, PL] = [0, 1, 2, 3].map((i) => boxes.nth(i));
    const start = async (b) => {
      await b.scrollIntoViewIfNeeded();
      await b.locator(".loop-click").first().click();
      return playing(b);
    };
    // S2 : chaque boucle, à son tour : elle seule joue, avec le son.
    for (const [k, b] of [["1", L1], ["2", L2], ["3", L3]]) {
      ok(`S2.${k} boucle ${k} lancée : elle joue, avec le son`, (await start(b)) && !(await vstate(b)).muted);
      ok(`S2.${k}b une SEULE vidéo sonore sur la page`, (await nSounding(p)) === 1, `${await nPlaying(p)} en lecture / ${await nSounding(p)} sonores`);
    }
    const r3 = await rmsOf(L3.locator("video"));
    const s1 = await vstate(L1);
    const s2 = await vstate(L2);
    ok("S3 la dernière boucle est réellement audible (niveau RMS) ; les deux autres sont muettes ou à l'arrêt", audible(r3) && (s1.paused || s1.muted) && (s2.paused || s2.muted), JSON.stringify([r3, s1, s2]));
    // S4 : clics rapprochés (80 ms) 1, 3, 2 : à la fin, une seule vidéo sonore, la dernière.
    await L1.scrollIntoViewIfNeeded();
    await L1.locator(".loop-click").first().click();
    await sleep(80);
    await L3.locator(".loop-click").first().click({ force: true }).catch(() => {});
    await sleep(80);
    await L2.locator(".loop-click").first().click({ force: true }).catch(() => {});
    await sleep(1800);
    const sounding = await p.evaluate(() => [...document.querySelectorAll("[data-video-mode='loop']")].map((b) => { const v = b.querySelector("video"); return !v.paused && !v.muted; }));
    ok("S4 clics rapprochés 1, 3, 2 : une seule boucle sonore à la fin", sounding.filter(Boolean).length <= 1 && (await nSounding(p)) <= 1, JSON.stringify(sounding));
    ok("S4b … et la page n'est jamais restée avec deux sonores", (await nSounding(p)) <= 1);
    // S5 : le Lecteur s'ouvre pendant qu'une boucle joue : le seul son est celui du lecteur.
    await start(L1);
    const trigger = (await PL.evaluate((e) => e.tagName === "BUTTON")) ? PL : PL.locator("button.video-play").first();
    await PL.scrollIntoViewIfNeeded();
    await trigger.click();
    await p.locator(dlgSel).waitFor({ timeout: 20000 });
    await p.waitForFunction((s) => { const v = document.querySelector(`${s} video`); return v && !v.paused && v.currentTime > 0.15; }, dlgSel, { timeout: 20000 }).catch(() => {});
    ok("S5 Lecteur ouvert : sa vidéo joue avec le son", await p.locator(`${dlgSel} video`).evaluate((v) => !v.paused && !v.muted));
    ok("S5b … et c'est la SEULE vidéo sonore (les boucles de la page sont muettes ou arrêtées)", (await nSounding(p)) === 1, `${await nPlaying(p)} en lecture / ${await nSounding(p)} sonores`);
    ok("S5c … le son du lecteur est audible", audible(await rmsOf(p.locator(`${dlgSel} video`))));
    await p.keyboard.press("Escape");
    await p.locator(dlgSel).waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
    // S6 : après fermeture, relancer une boucle : toujours une seule sonore.
    ok("S6 après le Lecteur, la boucle 3 se relance avec le son, seule sonore", (await start(L3)) && (await nSounding(p)) === 1 && !(await vstate(L3)).muted, `${await nSounding(p)}`);
    // S7 : le visiteur coupe le son (bouton) : il prime sur le réglage « activé » pour les AUTRES boucles, y compris le prochain lancement.
    await L3.locator('[data-testid="loop-sound"]').first().click();
    ok("S7 le visiteur coupe le son : la boucle devient muette", (await vstate(L3)).muted === true);
    await start(L2);
    ok("S7b le choix du visiteur prime : la boucle suivante démarre muette malgré « activé »", (await vstate(L2)).muted === true && (await nSounding(p)) === 0, `${await nSounding(p)}`);
    await p.context().close();
  });

/* ====================================================================================================================================== */
/*  T. 128 × 129 : titre de composant dans une carte / un fond avec « Intérieur haut / bas »                                               */
/* ====================================================================================================================================== */
const CARD = { color: "surface", corners: "m", width: "inset" };
const FOND = { kind: "color", color: "ink", inset: "m", round: "s" };
const head = (title, at) => ({ title: T$(title), ...(at ? { at } : {}) });
const image = (uid, extra = {}) => ({ uid, type: "image", props: { mediaId: IMG.paysage, width: "wide", ...extra } });
const T_BLOCKS = () => [
  image("t1", { surface: CARD, head: head("Titre T1"), look: { padTop: 40, padBottom: 40 } }),
  image("t2", { surface: CARD, head: head("Titre T2", "below"), look: { padTop: 40, padBottom: 40 } }),
  image("t3", { surface: CARD, head: head("Titre T3"), look: { padTop: "none", padBottom: "none" } }),
  image("t4", { surface: CARD, head: head("Titre T4") }),
  image("t5", { background: FOND, head: head("Titre T5"), look: { padTop: 40, padBottom: 40 } }),
  image("t6", { background: FOND, head: head("Titre T6"), look: { padTop: "none", padBottom: "none" } }),
];
if (run("T"))
  await sec("T", async () => {
    ok("T0 publication des 6 blocs (carte / fond, titre dessus / dessous, haut et bas réglés)", await publish(PAGES.t, T_BLOCKS()));
    const check = (tag, rows) => {
      ok(`${tag} les 6 blocs ont une zone et un titre, et le titre est DANS la zone (carte ou fond)`, rows.length === 6 && rows.every((r) => r.zone && r.title && r.inZone), show(rows));
      const [t1, t2, t3, t4, t5, t6] = rows;
      ok(`${tag} bas réglé à 40 px : le dernier élément est à 40 px du bord bas (carte, titre dessus)`, near(t1.bottom, 40), show([t1]));
      ok(`${tag} bas réglé à 40 px, titre DESSOUS : le titre est à 40 px du bord bas, le contenu à 40 px du bord haut`, near(t2.bottom, 40) && near(t2.top, 40), show([t2]));
      ok(`${tag} haut / bas « Aucun » : contenu collé au bas de la carte (0 px)`, near(t3.bottom, 0), show([t3]));
      ok(`${tag} haut réglé à 40 px : le titre descend de 40 px de plus que « Aucun » (le titre suit le réglage, il ne le contourne pas)`, near(t1.top - t3.top, 40), `${r1(t1.top)} − ${r1(t3.top)}`);
      ok(`${tag} sans réglage : rembourrage d'avant (cran M du thème) en bas et en haut`, near(t4.bottom, t4.m) && near(t4.top - t3.top, t4.m), `${show([t4])} m=${r1(t4.m)}`);
      ok(`${tag} fond seul : bas à 40 px, puis 0 px avec « Aucun »`, near(t5.bottom, 40) && near(t6.bottom, 0), show([t5, t6]));
      ok(`${tag} fond seul : le titre suit le réglage du haut (40 px de plus que « Aucun »)`, near(t5.top - t6.top, 40), `${r1(t5.top)} − ${r1(t6.top)}`);
    };
    const p = await publicPage(SLUG.t);
    const pub = await p.evaluate(MEASURE, { edit: false });
    check("T1 public", pub);
    await shot(p, "T-public");
    await p.context().close();
    const fr = await openEd(PAGES.t);
    const ed = await fr.evaluate(MEASURE, { edit: true });
    check("T2 éditeur", ed);
    // Public = éditeur sur les réglages en px fixes (le cran M du thème et la largeur de l'image changent avec la largeur du cadre de l'éditeur : t4 et les hauteurs ne se comparent pas).
    ok("T3 public = éditeur : mêmes distances haut / bas (réglages en px, blocs t1, t2, t3, t5, t6)", pub.length === ed.length && [0, 1, 2, 4, 5].every((i) => near(pub[i].top, ed[i].top) && near(pub[i].bottom, ed[i].bottom)), `${show(pub)} / ${show(ed)}`);
    await shot(page, "T-editeur");
  });

/* ====================================================================================================================================== */
/*  B. 129 × 113 : planche libre recadrée dans une carte, légende vide                                                                     */
/* ====================================================================================================================================== */
const fitem = (id, media, x, y, w, z = 0) => ({ id, media, x, y, w, rot: 0, z });
const fbBlock = (uid, crop, extra = {}) => ({ uid, type: "free-board", props: { format: "3:2", phone: "scale", crop, items: [fitem("a", IMG.portrait, 8, 6, 26), fitem("b", IMG.carre, 40, 10, 30, 1)], surface: CARD, ...extra } });
const CAP = { captionTitle: T$("Titre de légende"), caption: T$("Texte de légende") };
const B_BLOCKS = () => [
  fbBlock("b0", { t: 0, r: 0, b: 30, l: 0 }),
  fbBlock("b1", { t: 0, r: 0, b: 30, l: 0 }, { look: { padBottom: "none" } }),
  fbBlock("b2", { t: 20, r: 0, b: 30, l: 0 }, { look: { padTop: 40, padBottom: 40 } }),
  fbBlock("b3", { t: 0, r: 0, b: 0, l: 0 }, { look: { padBottom: 40 } }),
  fbBlock("b4", { t: 0, r: 0, b: 30, l: 0 }, { look: { padBottom: "none" }, ...CAP }),
];
if (run("B"))
  await sec("B", async () => {
    ok("B0 publication des 5 planches libres dans une carte (recadrées ou non, légende vide ou remplie)", await publish(PAGES.t, B_BLOCKS()));
    const check = (tag, rows) => {
      const [b0, b1, b2, b3, b4] = rows;
      ok(`${tag} 5 planches en carte`, rows.length === 5 && rows.every((r) => r.zone), show(rows));
      ok(`${tag} légende VIDE : aucune légende remplie, 0 px réservé sur les 4 planches sans texte${tag.includes("public") ? " (aucun élément de légende dans le HTML)" : ""}`, [b0, b1, b2, b3].every((r) => !r.hasCap && r.capH === 0 && (!tag.includes("public") || r.capInDom === 0)), JSON.stringify([b0, b1, b2, b3].map((r) => [r.hasCap, r.capH, r.capInDom])));
      ok(`${tag} recadrée, sans réglage : bande sous la planche = rembourrage d'avant (cran M), rien de plus`, near(b0.cBottom, b0.padB) && near(b0.cBottom, b0.m), `bande ${r1(b0.cBottom)} padding ${r1(b0.padB)} m ${r1(b0.m)}`);
      ok(`${tag} recadrée, « Bas : Aucun » : 0 px sous la planche`, near(b1.cBottom, 0), `${r1(b1.cBottom)}`);
      ok(`${tag} recadrée en haut ET en bas (le recadrage du haut laisse sa marge, lot 113), haut / bas à 40 px : 40 px au-dessus de la marge et 40 px au-dessous du cadre`, near(b2.top - b2.cMT, 40) && near(b2.cBottom, 40) && b2.cMT > 20, `${show([b2])} marge du cadre ${r1(b2.cMT)}`);
      ok(`${tag} non recadrée, bas à 40 px : 40 px`, near(b3.cBottom, 40), `${r1(b3.cBottom)}`);
      ok(`${tag} la zone vaut haut + marge du recadrage + cadre recadré + bas (b2) : ${r1(b2.zH)}`, near(b2.zH, 40 + b2.cMT + b2.cH + 40, 2), `${r1(b2.zH)} vs ${r1(40 + b2.cMT + b2.cH + 40)}`);
      ok(`${tag} le recadrage raccourcit le cadre : b0 (bas 30 %) plus bas que b3 (non recadrée)`, b0.cH < b3.cH - 20, `${r1(b0.cH)} / ${r1(b3.cH)}`);
      ok(`${tag} légende REMPLIE : dans le flux, sous le cadre, et « Bas : Aucun » colle la légende au bord de la carte`, b4.hasCap && b4.capH > 10 && b4.cBottom > b4.capH - 1 && near(b4.bottom, 0), `${JSON.stringify({ cap: b4.hasCap, h: r1(b4.capH), cBottom: r1(b4.cBottom), bottom: r1(b4.bottom) })}`);
    };
    const pubs = {};
    for (const w of [1440, 1024, 390]) {
      const p = await publicPage(SLUG.t, w, 900);
      pubs[w] = await p.evaluate(MEASURE, { edit: false });
      check(`B1 public ${w}`, pubs[w]);
      await p.context().close();
    }
    const fr = await openEd(PAGES.t);
    const ed = await fr.evaluate(MEASURE, { edit: true });
    check("B2 éditeur (repos)", ed);
    // Survol et sélection : les champs vides de la légende n'ouvrent aucune hauteur (la zone ne bouge pas), la bande reste celle du public.
    const hosts = fr.locator("[data-edit-block]:not([data-edit-parent])");
    const hover = [];
    for (const i of [0, 1, 2, 3]) {
      const h = hosts.nth(i);
      await h.scrollIntoViewIfNeeded();
      const box = await h.locator(".free-board").first().boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
      await sleep(500);
      hover.push((await fr.evaluate(MEASURE, { edit: true }))[i]);
    }
    ok("B3 éditeur, survol de chaque planche à légende vide : la zone ne bouge pas (hauteur et bande identiques au repos, ±1 px)", hover.every((r, k) => near(r.zH, ed[k].zH, 1) && near(r.cBottom, ed[k].cBottom, 1)), JSON.stringify(hover.map((r, k) => [r1(r.zH), r1(ed[k].zH), r1(r.cBottom), r1(ed[k].cBottom)])));
    await hosts.nth(2).locator(".free-board").first().click({ position: { x: 5, y: 5 } });
    await sleep(500);
    const picked = (await fr.evaluate(MEASURE, { edit: true }))[2];
    ok("B4 éditeur, planche choisie : la zone ne bouge pas non plus", near(picked.zH, ed[2].zH, 1) && near(picked.cBottom, ed[2].cBottom, 1), JSON.stringify([r1(picked.zH), r1(ed[2].zH)]));
    ok("B5 public = éditeur (bande sous le cadre en px réglés : b1 0 px, b2 et b3 40 px)", [1, 2, 3].every((i) => near(pubs[1440][i].cBottom, ed[i].cBottom)), `${show(pubs[1440])} / ${show(ed)}`);
    await shot(page, "B-editeur");
  });

/* ====================================================================================================================================== */
/*  P. 128 × 119 / 120 / 124 : portée du titre de composant                                                                                 */
/* ====================================================================================================================================== */
const until = (fn, arg, ms = 8000) => f.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
const away = async () => {
  await page.mouse.move(3, 3);
  await sleep(350);
};
async function openByAa(sel) {
  const target = f.locator(sel).first();
  for (let essai = 0; essai < 4; essai++) {
    await away();
    await target.scrollIntoViewIfNeeded();
    const b = await target.boundingBox();
    await page.mouse.move(b.x + 6, b.y + b.height / 2, { steps: 3 });
    await sleep(500);
    if (!(await until(() => Boolean(document.querySelector(".lk-aa")), null, 5000))) continue;
    try {
      await f.locator(".lk-aa").click({ timeout: 4000 });
      if (await until(() => Boolean(document.querySelector(".lk-bar")), null, 5000)) return true;
    } catch {
      /* le « Aa » a bougé avec le survol : on recommence */
    }
  }
  return false;
}
const scopes = () => f.locator(".lk-bar .lk-seg [role=radio]").evaluateAll((els) => els.map((e) => e.textContent.trim().replace(/\s+/g, " ")));
const closeBar = async () => {
  if (await f.locator(".lk-bar").count()) await f.locator(".lk-bar .lk-close").evaluate((b) => b.click()).catch(() => {});
  await sleep(300);
};
const draftOf = (pageId) => JSON.parse(sql((db) => db.prepare("select draft from pages where id = ?").get(pageId)).draft).blocks;
const lookOf = (pageId, uid) => draftOf(pageId).find((b) => b.uid === uid)?.props?.look;
const P_BLOCKS = () => [
  image("pa", { head: head("Titre A") }),
  image("pb", { head: head("Titre B"), surface: CARD }),
  { uid: "pr", type: "rich-text", props: { title: T$("Titre du texte"), paragraphs: [T$("Un paragraphe de texte inventé.")] } },
  { uid: "pp", type: "project-board", props: { project: project.slug, head: head("Titre du projet") } },
];
if (run("P"))
  await sec("P", async () => {
    await openEd(PAGES.t, P_BLOCKS());
    const sel = {
      pa: '[data-edit-block="pa"] h2[data-inline="head.title"]',
      pb: '[data-edit-block="pb"] h2[data-inline="head.title"]',
      pp: '[data-edit-block="pp"] h2[data-inline="head.title"]',
      pr: '[data-edit-block="pr"] h2[data-inline="title"], [data-edit-block="pr"] h2',
    };
    const chrome = () =>
      f.evaluate(() => {
        const st = (e) => (e ? (({ fontStyle, textTransform, color, fontWeight, fontFamily }) => ({ fontStyle, textTransform, color, fontWeight, fontFamily }))(getComputedStyle(e)) : null);
        const nav = document.querySelector(".site-header nav:not(#nav-mobile) a");
        const brand = document.querySelector(".site-header a[href='/'], .site-header [data-site-text='brand']");
        const foot = [...document.querySelectorAll("footer a, footer p, footer span")].slice(0, 4);
        return JSON.stringify({ nav: st(nav), brand: st(brand), foot: foot.map(st) });
      });
    const italic = (uid) => f.evaluate((s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).fontStyle === "italic" : null; }, sel[uid]);
    const all = async () => ({ pa: await italic("pa"), pb: await italic("pb"), pp: await italic("pp"), pr: await italic("pr") });
    const base = await chrome();
    const b0 = await all();
    ok("P0 les 4 titres existent (titre de composant ×3, titre d'un texte) et rien n'est en italique au départ", Object.values(b0).every((v) => v === false), JSON.stringify(b0));
    // 1. « Ce titre » : seulement le titre A.
    ok("P1 « Aa » s'ouvre sur le titre A", await openByAa(sel.pa));
    const sc = await scopes();
    ok("P1b portées : « Ce titre » d'abord, puis une portée large", sc[0] === "Ce titre" && sc.length >= 2, sc.join(" | "));
    await f.locator(".lk-bar .tc-italic").click();
    await settled(page);
    await waitFor(() => lookOf(PAGES.t, "pa")?.text?.["head.title"]?.italic === true, 12000);
    await closeBar();
    const a1 = await all();
    ok("P1c « Ce titre » : seul le titre A passe en italique (B, projet, texte inchangés)", a1.pa === true && a1.pb === false && a1.pp === false && a1.pr === false, JSON.stringify(a1));
    ok("P1d … rangé dans look.text[\"head.title\"] du bloc A, rien dans les autres blocs", lookOf(PAGES.t, "pa")?.text?.["head.title"]?.italic === true && !lookOf(PAGES.t, "pb")?.text && !lookOf(PAGES.t, "pp")?.projectText);
    ok("P1e menu d'en-tête et pied de page inchangés", (await chrome()) === base);
    // 2. « Tout le projet » sur le titre du bloc Projet.
    ok("P2 « Aa » s'ouvre sur le titre du bloc Projet", await openByAa(sel.pp));
    const sp = await scopes();
    ok("P2b portées : Ce titre · Tous les titres du projet · Tout le site", sp[0] === "Ce titre" && sp.some((s) => /Tous les titres du projet/.test(s)) && sp.some((s) => /Tout le site/.test(s)), sp.join(" | "));
    await f.locator(".lk-bar .lk-seg [role=radio]").filter({ hasText: /Tous les titres du projet/ }).first().click();
    await f.locator(".lk-bar .tc-italic").click();
    await settled(page);
    await waitFor(() => lookOf(PAGES.t, "pp")?.projectText?.h2?.italic === true, 12000);
    await closeBar();
    const a2 = await all();
    ok("P2c « Tout le projet » : le titre du projet suit (look.projectText.h2) ; B et le titre du texte restent inchangés", a2.pp === true && a2.pb === false && a2.pr === false, JSON.stringify(a2));
    ok("P2d … sans toucher le menu ni le pied", (await chrome()) === base);
    // 3. « Tout le site » sur le titre B : B, titre du texte (même type), A, projet.
    ok("P3 « Aa » s'ouvre sur le titre B (carte)", await openByAa(sel.pb));
    await f.locator(".lk-bar .lk-seg [role=radio]").filter({ hasText: /Tout le site|Tous les/ }).last().click();
    await f.locator(".lk-bar .tc-italic").click();
    await settled(page);
    await waitFor(async () => (await italic("pb")) === true && (await italic("pr")) === true, 12000);
    await closeBar();
    const a3 = await all();
    ok("P3b « Tout le site » : tous les titres de ce type passent en italique, B et le titre du texte compris", a3.pb === true && a3.pr === true && a3.pa === true && a3.pp === true, JSON.stringify(a3));
    ok("P3c … sans réglage écrit dans le bloc B (le réglage est celui du site)", !lookOf(PAGES.t, "pb")?.text?.["head.title"]?.italic, JSON.stringify(lookOf(PAGES.t, "pb")));
    ok("P3d menu d'en-tête et pied de page toujours inchangés (aucun texte de l'en-tête ni du pied n'est un titre de ce type)", (await chrome()) === base, `${base} / ${await chrome()}`);
    await shot(page, "P-portees");
  });

/* ====================================================================================================================================== */
/*  W. Plein écran : repli iPhone (webkitEnterFullscreen)                                                                                   */
/* ====================================================================================================================================== */
const noStandardFullscreen = () => {
  // Safari iPhone : pas d'API plein écran sur un élément quelconque, seulement `webkitEnterFullscreen` sur la vidéo. Le test retire l'API standard et note les appels.
  window.__fs = [];
  for (const proto of [Element.prototype, HTMLElement.prototype]) {
    try { delete proto.requestFullscreen; } catch {}
    try { delete proto.webkitRequestFullscreen; } catch {}
    try { Object.defineProperty(proto, "requestFullscreen", { value: undefined, configurable: true }); } catch {}
    try { Object.defineProperty(proto, "webkitRequestFullscreen", { value: undefined, configurable: true }); } catch {}
  }
  Object.defineProperty(HTMLVideoElement.prototype, "webkitEnterFullscreen", { configurable: true, value() { window.__fs.push({ tag: this.tagName, src: Boolean(this.currentSrc || this.querySelector("source")) }); } });
};
async function fsFallback(label, launcher) {
  let b;
  try {
    b = await launcher();
  } catch (e) {
    return { skipped: String(e.message).split("\n")[0].slice(0, 160) };
  }
  try {
    const c = await b.newContext({ viewport: { width: 1000, height: 800 } });
    await c.addInitScript(noStandardFullscreen);
    const p = await c.newPage();
    p.setDefaultTimeout(30000);
    await p.goto(`${BASE}/fr/${SLUG.s}`, { waitUntil: "load" });
    await sleep(1500);
    const box = p.locator("[data-video-mode='loop']").first();
    await box.scrollIntoViewIfNeeded();
    const btn = box.locator('[data-testid="video-fullscreen"]');
    const n = await btn.count();
    const hasApi = await p.evaluate(() => typeof document.createElement("div").requestFullscreen);
    if (n) await btn.first().click();
    await sleep(800);
    const calls = await p.evaluate(() => window.__fs);
    const clicked = await p.evaluate(() => document.querySelectorAll("video").length);
    await c.close();
    return { n, hasApi, calls, videos: clicked, label };
  } finally {
    await b.close().catch(() => {});
  }
}
if (run("W"))
  await sec("W", async () => {
    // La page « animation » doit porter les boucles de S (publiée par S ; sinon on la publie ici).
    if (!run("S")) await publish(PAGES.s, [vid("l1", MEDIA.avec, { mode: "loop" }), vid("pl", MEDIA.avec, { mode: "player", title: T$("Lecteur") })]);
    const rc = await fsFallback("chromium", () => chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2"] }));
    ok("W1 chromium, API standard retirée : le bouton plein écran de la boucle est là et son clic appelle `webkitEnterFullscreen` sur la vidéo", rc.n === 1 && rc.hasApi === "undefined" && rc.calls?.length === 1 && rc.calls[0].tag === "VIDEO", JSON.stringify(rc));
    const rw = await fsFallback("webkit", () => webkit.launch());
    if (rw.skipped) info(`W2 WebKit non lançable ici (${rw.skipped}) : repli vérifié seulement dans chromium (W1). WebKit réel : image pf-pw (machine de test), ONLY=W.`);
    else ok("W2 WebKit RÉEL, API standard retirée : le clic sur le bouton plein écran appelle `webkitEnterFullscreen` sur la vidéo", rw.n === 1 && rw.hasApi === "undefined" && rw.calls?.length === 1 && rw.calls[0].tag === "VIDEO", JSON.stringify(rw));
  });

/* ====================================================================================================================================== */
/*  K. 121 × 127 : dessins du kit sur les boutons du lot 127                                                                                */
/* ====================================================================================================================================== */
const login2 = await fetch(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
const cookie = login2.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
if (!login2.ok || !cookie) throw new Error(`connexion refusée (${login2.status})`);
const H = { cookie, origin: BASE };
const get = (u) => fetch(`${BASE}${u}`, { headers: { cookie } });
async function upload(data, name) {
  const init = await fetch(`${BASE}/admin/api/upload/init`, { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ name, size: data.length, type: "application/octet-stream", purpose: { kind: "kit", themeId: THEME } }) });
  const ib = await init.json().catch(() => ({}));
  if (init.status !== 200) return { stage: "init", status: init.status, body: ib };
  const id = ib.upload.id;
  for (let offset = 0; offset < data.length; ) {
    const part = data.subarray(offset, offset + 8 * 1024 * 1024);
    const r = await fetch(`${BASE}/admin/api/upload/${id}/chunk?offset=${offset}`, { method: "PUT", headers: { ...H, "content-length": String(part.length) }, body: part });
    const b = await r.json().catch(() => ({}));
    if (r.status !== 200) return { stage: "chunk", status: r.status, body: b };
    offset = b.upload.offset;
  }
  const done = await fetch(`${BASE}/admin/api/upload/${id}/complete`, { method: "POST", headers: H });
  return { stage: "complete", status: done.status, body: await done.json().catch(() => ({})) };
}
async function waitImport(id, ms = 240000) {
  const end = Date.now() + ms;
  let st = {};
  while (Date.now() < end && id) {
    st = await (await get(`/admin/api/theme-kit/${THEME}/import/${id}`)).json().catch(() => ({}));
    if (st.status === "done" || st.status === "failed") break;
    await sleep(1000);
  }
  return st;
}
const tsx = (code) => execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { env: { ...process.env, DATA_DIR: DATA }, encoding: "utf8" });
const mineData = () => JSON.parse(tsx(`import { getDb, schema } from "./src/lib/db/index.ts"; import { eq } from "drizzle-orm"; console.log(getDb().select().from(schema.themes).where(eq(schema.themes.mine, true)).get()?.data ?? "null");`).trim().split("\n").pop());
const sim = (...args) => execFileSync(process.execPath, ["--import", "tsx", "scripts/kit-poc/simulate-multi.mts", ...args], { stdio: "ignore" });
const readyKit = async () => {
  let body = {};
  for (let i = 0; i < 120 && !body.ready; i++) {
    body = await (await fetch(`${BASE}/admin/api/theme-kit/${THEME}`, { method: "POST", headers: H })).json().catch(() => ({}));
    if (!body.ready) await sleep(2000);
  }
  return body;
};
const applyImport = (id) => JSON.parse(tsx(`import { applyKitImport } from "./src/lib/kit/apply.ts"; console.log(JSON.stringify(await applyKitImport(${JSON.stringify(THEME)}, ${JSON.stringify(id)}, { mirror: false })));`).trim().split("\n").pop());
async function publishMine() {
  await gotoThemesPage(page, BASE);
  const publishBtn = page.getByTestId("mine-publish");
  if (await publishBtn.count()) {
    await publishBtn.click();
    const dialog = page.locator("dialog[open]");
    await dialog.getByRole("button", { name: "Publier", exact: true }).click();
    await dialog.waitFor({ state: "detached", timeout: 30000 });
  }
  await sleep(1500);
}
const urlOf = (i) => (i ? (i.svg ?? i.webp) : undefined);
const maskUrl = (u) => {
  const m = u ? /url\("?([^")]+)"?\)/.exec(u)?.[1] : "";
  if (!m) return "";
  try {
    return new URL(m, BASE).pathname;
  } catch {
    return m;
  }
};

// Contextes du lot 127 (22), dans l'ordre du DOM : nom, mode, son au départ (null = vidéo sans son).
const fit = (id, media, x, y, w, extra = {}) => ({ id, media, x, y, w, rot: 0, z: 0, ...extra });
const FB = (uid, items) => ({ uid, type: "free-board", props: { format: "3:2", phone: "scale", zoom: false, items } });
const own = (uid, media, ids) => ({ uid, type: "strip", props: { source: "own", media, ids } });
const K_PAGE = () => [
  vid("vl-on", MEDIA.avec, { mode: "loop", title: T$("Boucle") }),
  vid("vl-off", MEDIA.avec, { mode: "loop", sound: "off", title: T$("Boucle coupée") }),
  vid("vl-none", MEDIA.sans, { mode: "loop", title: T$("Boucle sans son") }),
  vid("vp-on", MEDIA.avec, { mode: "player", title: T$("Lecteur") }),
  vid("vp-off", MEDIA.avec, { mode: "player", sound: "off", title: T$("Lecteur coupé") }),
  grid("gp", { layout: "3" }, [vid("gk1", MEDIA.avec, { mode: "loop" }), vid("gk2", MEDIA.avec, { mode: "loop", sound: "off" }), vid("gk3", MEDIA.avec, { mode: "player", sound: "off" })]),
  FB("fb", [fit("fa", MEDIA.avec, 5, 5, 20), fit("fb", MEDIA.avec, 28, 5, 20, { sound: "off" }), fit("fp", MEDIA.avec, 51, 5, 20, { video: "player", sound: "off" }), fit("fq", MEDIA.avec, 74, 5, 20, { video: "player" }), fit("fs", MEDIA.sans, 5, 50, 20)]),
  { uid: "pbd", type: "project-board", props: { project: project.slug, look: { slotLook: { "c1-aa1": { video: "loop", sound: "off" }, "c1-bb2": { video: "loop" }, "c2-aa1": { video: "loop" }, "c3-aa1": { video: "player", sound: "off" } } } } },
];
const K_BOARD = () => [
  own("c1", [MEDIA.avec, MEDIA.sans], ["aa1", "bb2"]),
  own("c2", [MEDIA.avec], ["aa1"]),
  own("c3", [MEDIA.avec], ["aa1"]),
  vid("bv", MEDIA.avec, { mode: "player", sound: "off" }),
  { uid: "bg", type: "grid", props: { layout: "2", gap: "normal", align: "stretch", ratio: "auto", top: "gap", children: [vid("bk1", MEDIA.avec, { mode: "loop" }), vid("bk2", MEDIA.avec, { mode: "player", sound: "off" })] } },
  FB("bfb", [fit("ba", MEDIA.avec, 5, 5, 25, { sound: "off" }), fit("bp", MEDIA.avec, 40, 5, 25, { video: "player" })]),
];
const K_CONTEXTS = [
  ["vidéo seule · Boucle", "loop", "on"], ["vidéo seule · Boucle · son coupé", "loop", "off"], ["vidéo seule · Boucle sans son", "loop", null], ["vidéo seule · Lecteur", "player", "on"], ["vidéo seule · Lecteur · son coupé", "player", "off"],
  ["case de grille · Boucle", "loop", "on"], ["case de grille · Boucle · son coupé", "loop", "off"], ["case de grille · Lecteur · son coupé", "player", "off"],
  ["planche libre · Boucle", "loop", "on"], ["planche libre · Boucle · son coupé", "loop", "off"], ["planche libre · Lecteur · son coupé", "player", "off"], ["planche libre · Lecteur", "player", "on"], ["planche libre · Boucle sans son", "loop", null],
  ["rail · Boucle · son coupé", "loop", "off"], ["rail · Boucle sans son", "loop", null], ["rail · Boucle", "loop", "on"], ["rail · Lecteur · son coupé", "player", "off"],
  ["planche de projet · vidéo seule Lecteur · son coupé", "player", "off"], ["planche de projet · case de grille Boucle", "loop", "on"], ["planche de projet · case de grille Lecteur · son coupé", "player", "off"],
  ["planche de projet · planche libre Boucle · son coupé", "loop", "off"], ["planche de projet · planche libre Lecteur", "player", "on"],
];

/** Icônes d'une boîte : clé du kit, signature de forme (data-icon + chemins), masque calculé, SVG effacé ?, fond du bouton qui la porte. */
const iconsOf = async (box) => ((await box.count()) === 0 ? [] : iconsOf1(box));
const iconsOf1 = (box) =>
  box.evaluate((root) =>
    [...root.querySelectorAll("svg[data-vicon]")].map((s) => {
      const cs = getComputedStyle(s);
      const btn = s.closest("button");
      const bcs = btn ? getComputedStyle(btn) : null;
      const r = s.getBoundingClientRect();
      return {
        key: s.getAttribute("data-vicon"),
        icon: s.getAttribute("data-icon"),
        viewBox: s.getAttribute("viewBox"),
        paths: [...s.children].map((c) => c.getAttribute("d") ?? c.tagName),
        square: Math.abs(r.width - r.height) < 0.6,
        mask: cs.maskImage && cs.maskImage !== "none" ? cs.maskImage : cs.webkitMaskImage && cs.webkitMaskImage !== "none" ? cs.webkitMaskImage : "",
        hidden: [...s.children].length > 0 && [...s.children].every((c) => getComputedStyle(c).display === "none"),
        ariaHidden: s.getAttribute("aria-hidden") === "true",
        btn: btn ? { cls: btn.className, label: btn.getAttribute("aria-label"), bg: bcs.backgroundImage, radius: bcs.borderRadius, muted: btn.getAttribute("data-muted") } : null,
      };
    }),
  );
// Forme des icônes du 127 SEUL (contrat contrat-icones-video-121-127.md) : data-icon + chemins, viewBox.
const REF = {
  sound: { icon: "sound-on", viewBox: "0 0 24 24", paths: ["M4 9h4l5-4v14l-5-4H4Z", "M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"] },
  muted: { icon: "sound-off", viewBox: "0 0 24 24", paths: ["M4 9h4l5-4v14l-5-4H4Z", "m16 9 5 6m0-6-5 6"] },
  fullscreen: { icon: "fullscreen", viewBox: "0 0 24 24", paths: ["M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"] },
  exitFullscreen: { icon: "fullscreen-exit", viewBox: "0 0 24 24", paths: ["M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"] },
};
const sameAsRef = (x) => !REF[x.key] || (x.icon === REF[x.key].icon && x.viewBox === REF[x.key].viewBox && JSON.stringify(x.paths) === JSON.stringify(REF[x.key].paths));
const kitAttrs = (p) => p.evaluate(() => [...document.documentElement.attributes].map((a) => a.name).filter((n) => n.startsWith("data-kit-vicon")).sort());

/** Relevé des boutons du 127 dans chaque contexte : plein écran (repos), son (en lecture : état puis bascule), lecteur ouvert (barre : plein écran, son ; plein écran réel : « quitter »). */
async function surveyK() {
  const out = [];
  let fsDone = false;
  for (const [i, [name, mode, setting]] of K_CONTEXTS.entries()) {
    // Une page NEUVE par contexte : le choix du visiteur (bouton son) vaut pour toute la page et primerait sur le réglage « son au départ » des contextes suivants.
    const c0 = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const p = await c0.newPage();
    p.setDefaultTimeout(30000);
    p.on("pageerror", (e) => errors.push(`public : ${e.message}`));
    await p.goto(`${BASE}/fr/${SLUG.k}`, { waitUntil: "load" });
    await p.locator("[data-video-mode]").nth(K_CONTEXTS.length - 1).waitFor({ timeout: 30000 });
    await sleep(400);
    const box = p.locator("[data-video-mode]").nth(i);
    await box.scrollIntoViewIfNeeded();
    // Le bouton plein écran du rail est posé sur la case entière (hors de la boîte du média) : on le cherche dans la plus grande cellule qui ne contient QUE cette vidéo.
    const cell = box.locator("xpath=ancestor-or-self::*[count(descendant-or-self::*[@data-video-mode])=1][last()]");
    const rec = { name, mode, setting, fs: await iconsOf(cell.locator(".vid-fs")), labels: await box.evaluate((e) => [...e.querySelectorAll("button, [role=button]")].map((b) => b.getAttribute("aria-label") ?? b.textContent.trim())) };
    if (mode === "loop") {
      await box.locator(".loop-click").first().click();
      await playing(box);
      const snd = box.locator('[data-testid="loop-sound"]');
      if (await snd.count()) {
        rec.sound1 = await iconsOf(snd);
        await snd.first().click();
        await sleep(250);
        rec.sound2 = await iconsOf(snd);
        await snd.first().click();
      }
      await box.locator(".loop-click").first().click().catch(() => {});
    } else {
      const trigger = (await box.evaluate((e) => e.tagName === "BUTTON")) ? box : box.locator("button.video-play").first();
      await trigger.click();
      await p.locator(dlgSel).waitFor({ timeout: 20000 });
      await p.waitForFunction((s) => { const v = document.querySelector(`${s} video`); return v && !v.paused && v.currentTime > 0.15; }, dlgSel, { timeout: 20000 }).catch(() => {});
      const dlg = p.locator(dlgSel);
      rec.bar = await iconsOf(dlg);
      const mute = dlg.locator('[data-vp="mute"]');
      if (await mute.count()) {
        await mute.click();
        await sleep(250);
        rec.sound2 = await iconsOf(mute);
        await mute.click();
        rec.sound1 = await iconsOf(mute);
      }
      if (!fsDone) {
        // Plein écran réel du lecteur : le bouton passe à « quitter le plein écran ».
        fsDone = true;
        await dlg.locator('[data-vp="fullscreen"]').click();
        await sleep(900);
        rec.isFs = await p.evaluate(() => Boolean(document.fullscreenElement));
        rec.exit = await iconsOf(dlg.locator('[data-vp="fullscreen"]'));
        await p.evaluate(() => document.exitFullscreen?.().catch(() => {}));
        await sleep(500);
      }
      await p.keyboard.press("Escape");
      await p.locator(dlgSel).waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
    }
    rec.kit = await kitAttrs(p);
    await p.context().close();
    out.push(rec);
  }
  return out;
}
const flat = (rec, fn) => rec.flatMap((r) => fn(r) ?? []);
const soundIcons = (rec) => flat(rec, (r) => [...(r.sound1 ?? []), ...(r.sound2 ?? [])]);
const fsIcons = (rec) => flat(rec, (r) => [...r.fs, ...(r.bar ?? []).filter((x) => x.key === "fullscreen")]);

if (run("K"))
  await sec("K", async () => {
    ok("K0 publication : 22 contextes du lot 127 (page + planche de projet)", await (async () => {
      setDraft(PAGES.k, K_PAGE());
      setBoardDraft(project.id, PAGES.k, K_BOARD());
      await openEd(PAGES.k);
      await page.getByRole("button", { name: "Publier", exact: true }).click();
      const done = await waitFor(() => sql((db) => db.prepare("select draft from pages where id = ?").get(PAGES.k)).draft === null && boardDraft(project.id) === null, 120000);
      await sleep(3000);
      return done;
    })());
    /* ---- K1. Sans dessin : rendu du 127 seul ---- */
    const p0 = await publicPage(SLUG.k);
    const modes = await p0.locator("[data-video-mode]").evaluateAll((els) => els.map((e) => e.getAttribute("data-video-mode")));
    ok("K1 les 22 contextes sont rendus, dans l'ordre", JSON.stringify(modes) === JSON.stringify(K_CONTEXTS.map((c) => c[1])), JSON.stringify(modes));
    await p0.context().close();
    const rec0 = await surveyK();
    ok("K1 chaque contexte a son bouton plein écran (boucles, lecteurs, rail, planche de projet)", rec0.every((r) => r.fs.length >= 1), JSON.stringify(rec0.filter((r) => r.fs.length < 1).map((r) => r.name)));
    ok("K1 sans dessin : plein écran, son, muet = les formes du 127 seul (contrat), aucune icône masquée", [...fsIcons(rec0), ...soundIcons(rec0)].every((x) => sameAsRef(x) && x.mask === "" && !x.hidden), JSON.stringify([...fsIcons(rec0), ...soundIcons(rec0)].filter((x) => !sameAsRef(x) || x.mask || x.hidden).slice(0, 2)));
    ok("K1 sans dessin : aucun attribut data-kit-vicon-* sur <html>, boutons au fond du thème (pas d'image)", rec0.every((r) => r.kit.length === 0) && flat(rec0, (r) => [...r.fs, ...(r.sound1 ?? [])]).every((x) => x.btn?.bg === "none"));
    ok("K1 sans dessin : le bouton plein écran porte l'icône « plein écran » (jamais « quitter » au repos)", fsIcons(rec0).every((x) => x.key === "fullscreen"));
    const lp = rec0.filter((r) => r.mode === "loop" && r.setting);
    ok("K1 le réglage « son au départ » ne change pas la forme d'une icône : les boucles « activé » montrent l'icône son, puis muet après le clic ; les « coupé » l'inverse", lp.filter((r) => r.setting === "on").every((r) => r.sound1?.[0]?.key === "sound" && r.sound2?.[0]?.key === "muted") && lp.filter((r) => r.setting === "off").every((r) => r.sound1?.[0]?.key === "muted" && r.sound2?.[0]?.key === "sound"), JSON.stringify(lp.map((r) => [r.setting, r.sound1?.[0]?.key, r.sound2?.[0]?.key])));
    const labels0 = rec0.map((r) => r.labels);

    /* ---- K2. Kit : 8 dessins ---- */
    const state = await readyKit();
    ok("K2 export du kit prêt", state.ready === true);
    const dl = await get(`/admin/api/theme-kit/${THEME}`);
    const kitZip = path.join(DIR, "kit.zip");
    writeFileSync(kitZip, Buffer.from(await dl.arrayBuffer()));
    const draw = path.join(DIR, "icones-huit.psd");
    sim("video", kitZip, draw);
    const up = await upload(readFileSync(draw), "icones-huit.psd");
    const impId = up.body.kitImport?.id;
    const st = await waitImport(impId);
    ok("K2 envoi des 8 dessins : lus (7 icônes en masque SVG + fond du badge)", st.status === "done", JSON.stringify(st).slice(0, 200));
    const ap = applyImport(impId);
    ok("K2 application (Mon thème)", ap.ok === true, JSON.stringify(ap).slice(0, 200));
    const vic = mineData()?.assets?.kit?.vicons ?? {};
    ok("K2 le thème porte les 8 dessins vidéo (kit.vicons)", Object.keys(vic).length === 8, JSON.stringify(Object.keys(vic)));
    await publishMine();

    /* ---- K3. Public : dessins sur les boutons du 127 ---- */
    const rec1 = await surveyK();
    ok("K3 <html> porte les 8 attributs data-kit-vicon-*", rec1.every((r) => r.kit.length === 8), JSON.stringify(rec1[0]?.kit));
    const want = (key) => urlOf(vic[key === "exitFullscreen" ? "exitFullscreen" : key]);
    const wrongMask = (list, key) => list.filter((x) => x.key === key && !(maskUrl(x.mask) === want(key) && x.hidden));
    const fs1 = fsIcons(rec1);
    ok(`K3 bouton plein écran : le dessin du kit sur CHAQUE contexte (${fs1.length} occurrences : bloc, grille, rail, planche de projet, planche libre ; Boucle et Lecteur, barre du lecteur)`, fs1.length >= K_CONTEXTS.length && wrongMask(fs1, "fullscreen").length === 0 && fs1.every((x) => x.key === "fullscreen"), JSON.stringify(wrongMask(fs1, "fullscreen").slice(0, 2)));
    const sn1 = soundIcons(rec1);
    ok(`K3 bouton son : dessin « son » et dessin « muet » du kit partout (${sn1.length} occurrences, boucles et lecteurs)`, sn1.length > 0 && wrongMask(sn1, "sound").length === 0 && wrongMask(sn1, "muted").length === 0 && new Set(sn1.map((x) => x.key)).size === 2, JSON.stringify([...wrongMask(sn1, "sound"), ...wrongMask(sn1, "muted")].slice(0, 2)));
    const masksOf = (list, key) => new Set(list.filter((x) => x.key === key).map((x) => maskUrl(x.mask)));
    ok("K3 le réglage « son au départ » ne change pas le dessin : UN seul masque par icône (son, muet, plein écran), qu'une vidéo démarre avec ou sans son", [masksOf(sn1, "sound"), masksOf(sn1, "muted"), masksOf(fs1, "fullscreen")].every((s) => s.size === 1), JSON.stringify([...masksOf(sn1, "sound"), ...masksOf(sn1, "muted"), ...masksOf(fs1, "fullscreen")]));
    const lp1 = rec1.filter((r) => r.mode === "loop" && r.setting);
    ok("K3 boucles : « activé » → son puis muet, « coupé » → muet puis son, chacun avec SON dessin", lp1.every((r) => r.sound1?.[0]?.key === (r.setting === "on" ? "sound" : "muted") && r.sound2?.[0]?.key === (r.setting === "on" ? "muted" : "sound") && maskUrl(r.sound1?.[0]?.mask) === want(r.sound1?.[0]?.key) && maskUrl(r.sound2?.[0]?.mask) === want(r.sound2?.[0]?.key)));
    const exitRec = rec1.find((r) => r.exit);
    ok("K3 lecteur en plein écran réel : le bouton passe à « quitter le plein écran » et c'est le dessin du kit", exitRec?.isFs === true && exitRec?.exit?.some((x) => x.key === "exitFullscreen" && maskUrl(x.mask) === want("exitFullscreen") && x.hidden), JSON.stringify(exitRec?.exit ?? null));
    const badge = urlOf(vic.badge);
    const btns = flat(rec1, (r) => [...r.fs, ...(r.sound1 ?? [])]).map((x) => x.btn);
    ok("K3 fond du badge dessiné : posé aussi sur le bouton plein écran et le bouton son du 127 (les `.vid-badge`), sans l'arrondi du thème", btns.filter((b) => /vid-badge/.test(b.cls)).length > 0 && btns.filter((b) => /vid-badge/.test(b.cls)).every((b) => b.bg.includes(badge) && b.radius === "0px"), JSON.stringify(btns.slice(0, 2)));
    ok("K3 les noms accessibles des boutons sont ceux d'avant les dessins (l'accessibilité ne dépend pas du dessin)", JSON.stringify(rec1.map((r) => r.labels)) === JSON.stringify(labels0), JSON.stringify(rec1.map((r) => r.labels)).slice(0, 200));
    ok("K3 toutes les icônes restent aria-hidden et carrées", [...fs1, ...sn1].every((x) => x.ariaHidden && x.square));

    /* ---- K4. Aperçu de l'éditeur ---- */
    setDraft(PAGES.k, K_PAGE());
    setBoardDraft(project.id, PAGES.k, K_BOARD());
    const fr = await openEd(PAGES.k);
    await page.getByRole("button", { name: "Aperçu", exact: false }).first().click();
    await fr.waitForFunction(() => !document.documentElement.hasAttribute("data-edit-canvas"), null, { timeout: 30000 });
    await sleep(1500);
    const box = fr.locator("[data-video-mode='loop']").first();
    await box.scrollIntoViewIfNeeded();
    await box.locator(".loop-click").first().click();
    await sleep(800);
    const fsA = await iconsOf(box.locator(".vid-fs"));
    const sdA = await iconsOf(box.locator('[data-testid="loop-sound"]'));
    ok("K4 Aperçu : le bouton plein écran et le bouton son de la boucle montrent les dessins du kit", fsA.length === 1 && maskUrl(fsA[0].mask) === want("fullscreen") && sdA.length === 1 && maskUrl(sdA[0].mask) === want(sdA[0].key) && fsA[0].btn.bg !== "none", JSON.stringify([fsA, sdA]).slice(0, 400));
    await shot(page, "K-apercu");
  });

ok("aucune erreur JS", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures === 0 ? "RESULT PASS" : `RESULT FAIL (${failures})`);
process.exitCode = failures === 0 ? 0 : 1;
