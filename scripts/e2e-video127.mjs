#!/usr/bin/env node
/**
 * Lot 127 « son activé par défaut (réglable par vidéo), boucles comprises, et bouton plein écran » (chromium, serveur requis, base neuve,
 * une connexion admin). Vidéos SYNTHÉTIQUES générées par ffmpeg (sinus 440 Hz + mire, 320 × 180, 4 s) ; AUCUN réglage de lecture
 * automatique n'est forcé dans le navigateur : la règle réelle (pas de son avant un geste du visiteur) s'applique.
 *
 *  P  Site en ligne, CHAQUE contexte (vidéo seule, case de grille, planche libre, rail / carrousel, planche de projet ; Boucle et Lecteur ;
 *     réglage par défaut et « coupé ») : après un clic, le son est audible (RMS par AudioContext + captureStream) ou muet selon le réglage,
 *     l'icône son dit la vérité, le bouton son manque sur une vidéo sans son.
 *  V  Le choix du visiteur prime ; une seule vidéo sonore à la fois (3 boucles) ; repli muet quand le navigateur refuse le son, son au
 *     premier geste.
 *  F  Plein écran : bouton bas gauche (même style que le badge), cible >= 44 px au doigt, Fullscreen API, sortie, état conservé, pas de
 *     pause au clic, repli iOS (webkitEnterFullscreen), 390 tactile et 1440, Aperçu, absent sur la toile en mode édition.
 *  E  Éditeur : le réglage « Son au départ » dans chaque contexte (bloc, case de grille, rail, planche de projet, planche libre, panneau),
 *     rechargement, publication, public = éditeur = Aperçu ; absent pour une vidéo sans son.
 *  L  Anciennes données : aucune réécriture à l'ouverture, rendu identique (hors son par défaut), journal.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=P,V,F,E,L] [SHOTS=dossier] node scripts/e2e-video127.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";

import { boardDraft, draftBlocks, findIn, grid, login, openEditor, pageIdOf, q1, setBoardDraft, setDraft, settled, sleep, sql, waitFor } from "./lib/grille31d.mjs";

const BASE = process.env.BASE ?? "http://localhost:3470";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(tmpdir(), "e2e-video127");
const DIR = path.join(tmpdir(), "e2e-video127-src");
mkdirSync(SHOTS, { recursive: true });
mkdirSync(DIR, { recursive: true });

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};

/* ---- Vidéos synthétiques ---- */
const ff = (...args) => execFileSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
const V = ["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=15", "-t", "4"];
const A = ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100"];
const X264 = ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"];
const FILES = {
  avec: { file: "v127-avec-son.mp4", args: [...V, ...A, ...X264, "-c:a", "aac", "-ac", "2", "-shortest"] },
  sans: { file: "v127-sans-son.mp4", args: [...V, ...X264, "-an"] },
};
const row = (name) => q1("select id, status, has_audio from media where original_name = ? order by id desc", name);
const THRESHOLD = 0.004;

const CHROME_ARGS = ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"];
// ATTENTION : pas de --autoplay-policy=no-user-gesture-required (c'est la règle réelle du navigateur qui est testée).
const browser = await chromium.launch({ args: CHROME_ARGS });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);

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
ok("0 médias : la vidéo avec son a du son, l'autre non", row(FILES.avec.file).has_audio === 1 && row(FILES.sans.file).has_audio === 0);
const pageId = pageIdOf("personnages");
const project = q1("select id, slug from projects order by id limit 1");

/* ---- Contenu de test ---- */
const T = (s) => ({ fr: s, en: s });
const vid = (uid, mediaId, props = {}) => ({ uid, type: "video-single", props: { mediaId, variant: "plain", ...props } });
const fit = (id, media, x, y, w, extra = {}) => ({ id, media, x, y, w, rot: 0, z: 0, ...extra });
const FB = (uid, items) => ({ uid, type: "free-board", props: { format: "3:2", phone: "scale", zoom: false, items } });
const own = (uid, media, ids) => ({ uid, type: "strip", props: { source: "own", media, ids } });
const PAGE_BLOCKS = () => [
  vid("vl-on", MEDIA.avec, { mode: "loop", title: T("Boucle") }),
  vid("vl-off", MEDIA.avec, { mode: "loop", sound: "off", title: T("Boucle coupée") }),
  vid("vl-none", MEDIA.sans, { mode: "loop", title: T("Boucle sans son") }),
  vid("vp-on", MEDIA.avec, { mode: "player", title: T("Lecteur") }),
  vid("vp-off", MEDIA.avec, { mode: "player", sound: "off", title: T("Lecteur coupé") }),
  grid("gp", { layout: "3" }, [vid("gk1", MEDIA.avec, { mode: "loop" }), vid("gk2", MEDIA.avec, { mode: "loop", sound: "off" }), vid("gk3", MEDIA.avec, { mode: "player", sound: "off" })]),
  FB("fb", [fit("fa", MEDIA.avec, 5, 5, 20), fit("fb", MEDIA.avec, 28, 5, 20, { sound: "off" }), fit("fp", MEDIA.avec, 51, 5, 20, { video: "player", sound: "off" }), fit("fq", MEDIA.avec, 74, 5, 20, { video: "player" }), fit("fs", MEDIA.sans, 5, 50, 20)]),
  {
    uid: "pbd",
    type: "project-board",
    props: { project: project.slug, look: { slotLook: { "c1-aa1": { video: "loop", sound: "off" }, "c1-bb2": { video: "loop" }, "c2-aa1": { video: "loop" }, "c3-aa1": { video: "player", sound: "off" } } } },
  },
];
const BOARD = () => [
  own("c1", [MEDIA.avec, MEDIA.sans], ["aa1", "bb2"]),
  own("c2", [MEDIA.avec], ["aa1"]),
  own("c3", [MEDIA.avec], ["aa1"]),
  vid("bv", MEDIA.avec, { mode: "player", sound: "off" }),
  { uid: "bg", type: "grid", props: { layout: "2", gap: "normal", align: "stretch", ratio: "auto", top: "gap", children: [vid("bk1", MEDIA.avec, { mode: "loop" }), vid("bk2", MEDIA.avec, { mode: "player", sound: "off" })] } },
  FB("bfb", [fit("ba", MEDIA.avec, 5, 5, 25, { sound: "off" }), fit("bp", MEDIA.avec, 40, 5, 25, { video: "player" })]),
];
// Contextes dans l'ordre du DOM : nom, mode, son au départ (null = vidéo sans son).
const CONTEXTS = [
  ["vidéo seule · Boucle", "loop", "on"],
  ["vidéo seule · Boucle · son coupé", "loop", "off"],
  ["vidéo seule · Boucle sans son", "loop", null],
  ["vidéo seule · Lecteur", "player", "on"],
  ["vidéo seule · Lecteur · son coupé", "player", "off"],
  ["case de grille · Boucle", "loop", "on"],
  ["case de grille · Boucle · son coupé", "loop", "off"],
  ["case de grille · Lecteur · son coupé", "player", "off"],
  ["planche libre · Boucle", "loop", "on"],
  ["planche libre · Boucle · son coupé", "loop", "off"],
  ["planche libre · Lecteur · son coupé", "player", "off"],
  ["planche libre · Lecteur", "player", "on"],
  ["planche libre · Boucle sans son", "loop", null],
  ["rail · Boucle · son coupé", "loop", "off"],
  ["rail · Boucle sans son", "loop", null],
  ["rail · Boucle", "loop", "on"],
  ["rail · Lecteur · son coupé", "player", "off"],
  ["planche de projet · vidéo seule Lecteur · son coupé", "player", "off"],
  ["planche de projet · case de grille Boucle", "loop", "on"],
  ["planche de projet · case de grille Lecteur · son coupé", "player", "off"],
  ["planche de projet · planche libre Boucle · son coupé", "loop", "off"],
  ["planche de projet · planche libre Lecteur", "player", "on"],
];

async function publishAll() {
  setDraft(pageId, PAGE_BLOCKS());
  setBoardDraft(project.id, pageId, BOARD());
  await openEditor(page, BASE, pageId);
  await settled(page);
  await page.getByRole("button", { name: "Publier", exact: true }).click();
  const done = await waitFor(() => sql((db) => db.prepare("select draft from pages where id = ?").get(pageId)).draft === null && boardDraft(project.id) === null, 120000);
  await sleep(3000);
  return done;
}
const newPage = async (options = {}, init = null) => {
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  if (init) await c.addInitScript(init);
  const p = await c.newPage();
  p.setDefaultTimeout(30000);
  p.on("pageerror", (e) => errors.push(`public : ${e.message}`));
  await p.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
  return p;
};
const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});

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
    while (performance.now() - t0 < 1200) {
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
/** Audible = niveau mesuré ET élément non muet (captureStream ignore `muted`). */
const audible = (r) => r.rms > THRESHOLD && !r.muted && !r.paused;
const vstate = (el) => el.evaluate((e) => { const v = e.querySelector("video"); return { paused: v.paused, muted: v.muted, t: v.currentTime }; });
const playing = (el, timeout = 15000) => waitFor(async () => { const s = await vstate(el); return !s.paused && s.t > 0.15; }, timeout);
const dlgSel = '[data-testid="video-viewer"]';
const nPlaying = (p) => p.evaluate(() => [...document.querySelectorAll("video")].filter((v) => !v.paused).length);
const nSounding = (p) => p.evaluate(() => [...document.querySelectorAll("video")].filter((v) => !v.paused && !v.muted).length);

/** Joue UN contexte comme un visiteur (page neuve : aucun choix du visiteur retenu) : { button, buttonMuted, startMuted, audible, rms }. */
async function probe(p, box, mode) {
  const out = { button: false, buttonMuted: null, startMuted: null, audible: false, rms: 0 };
  await box.scrollIntoViewIfNeeded();
  if (mode === "loop") {
    await box.locator(".loop-click").first().click();
    if (!(await playing(box))) return out;
    out.startMuted = (await vstate(box)).muted;
    const sound = box.locator('[data-testid="loop-sound"]');
    out.button = (await sound.count()) > 0;
    if (out.button) out.buttonMuted = (await sound.first().getAttribute("data-muted")) === "true";
    const r = await rmsOf(box.locator("video").first());
    out.rms = r.rms;
    out.audible = audible(r);
    out.sound = sound;
  } else {
    const trigger = (await box.evaluate((e) => e.tagName === "BUTTON")) ? box : box.locator("button.video-play").first();
    await trigger.click();
    await p.locator(dlgSel).waitFor({ timeout: 20000 });
    await p.waitForFunction((s) => { const v = document.querySelector(`${s} video`); return v && !v.paused && v.currentTime > 0.15; }, dlgSel, { timeout: 20000 }).catch(() => {});
    out.startMuted = await p.locator(`${dlgSel} video`).evaluate((v) => v.muted);
    const mute = p.locator(`${dlgSel} [data-vp="mute"]`);
    out.button = (await mute.count()) > 0;
    if (out.button) out.buttonMuted = (await mute.getAttribute("aria-pressed")) === "true";
    const r = await rmsOf(p.locator(`${dlgSel} video`));
    out.rms = r.rms;
    out.audible = audible(r);
    out.sound = mute;
  }
  return out;
}

let fr;
const sec = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.stack ?? e).split("\n").slice(0, 4).join(" | "));
    await page.screenshot({ path: path.join(SHOTS, `erreur-${name}.png`) }).catch(() => {});
  }
};

try {
  ok("0 publication : brouillons de test publiés", await publishAll());

  /* ---- P. Site en ligne, chaque contexte ---- */
  if (run("P")) await sec("P", async () => {
    const p0 = await newPage();
    const modes = await p0.locator("[data-video-mode]").evaluateAll((els) => els.map((e) => [e.getAttribute("data-video-mode"), e.getAttribute("data-video-audio") === null ? null : e.getAttribute("data-video-sound")]));
    ok("P0 les 22 contextes sont rendus, dans l'ordre, avec leur mode et leur son au départ (null = vidéo sans son)", JSON.stringify(modes) === JSON.stringify(CONTEXTS.map((c) => [c[1], c[2]])), JSON.stringify(modes));
    await p0.context().close();
    for (const [i, [name, mode, sound]] of CONTEXTS.entries()) {
      const p = await newPage();
      const box = p.locator("[data-video-mode]").nth(i);
      let r;
      try {
        r = await probe(p, box, mode);
      } catch (e) {
        ok(`P ${name} : lecture et mesure`, false, String(e.message).split("\n")[0].slice(0, 160));
        console.log(`TABLE127 ${JSON.stringify({ contexte: name, mode, reglage: sound, erreur: true })}`);
        await p.context().close();
        continue;
      }
      console.log(`TABLE127 ${JSON.stringify({ contexte: name, mode, reglage: sound, muetAuDepart: r.startMuted, audible: r.audible, boutonSon: r.button, iconeMuet: r.buttonMuted, rms: Number(r.rms.toFixed(4)) })}`);
      if (sound === "on") {
        ok(`P ${name} : son ACTIVÉ au départ (audible après le clic)`, r.audible && r.startMuted === false, JSON.stringify({ ...r, sound: undefined }));
        ok(`P ${name} : l'icône son dit « son actif »`, r.button && r.buttonMuted === false);
      } else if (sound === "off") {
        ok(`P ${name} : réglage « coupé » : muet au départ`, !r.audible && r.startMuted === true && r.rms >= 0, JSON.stringify({ ...r, sound: undefined }));
        ok(`P ${name} : l'icône son dit « muet » et un clic remet le son`, r.button && r.buttonMuted === true);
        if (r.button) {
          await r.sound.first().click();
          await sleep(300);
          const again = await rmsOf(mode === "loop" ? box.locator("video").first() : p.locator(`${dlgSel} video`));
          ok(`P ${name} : après le bouton son, le son est audible`, audible(again), JSON.stringify(again));
        }
      } else {
        ok(`P ${name} : vidéo sans son : muette, aucun bouton son`, !r.button && !r.audible);
      }
      await p.context().close();
    }
    const q = await newPage();
    await sleep(2500);
    ok("P-S5 aucune vidéo ne démarre seule à l'ouverture de la page", (await nPlaying(q)) === 0);
    await q.context().close();
  });

  /* ---- V. Choix du visiteur, une seule vidéo sonore, repli du navigateur ---- */
  if (run("V")) await sec("V", async () => {
    const p = await newPage();
    const boxes = p.locator("[data-video-mode='loop']");
    const A1 = p.locator("[data-video-mode]").nth(0);
    const A2 = p.locator("[data-video-mode]").nth(5);
    const A3 = p.locator("[data-video-mode]").nth(8);
    for (const [k, b] of [["A", A1], ["B", A2], ["C", A3]]) {
      await b.scrollIntoViewIfNeeded();
      await b.locator(".loop-click").click();
      ok(`V1${k} boucle ${k} lancée : elle joue avec le son`, (await playing(b)) && !(await vstate(b)).muted);
      ok(`V1${k}b … et c'est la SEULE vidéo qui joue, la seule sonore`, (await nPlaying(p)) === 1 && (await nSounding(p)) === 1, `${await nPlaying(p)}/${await nSounding(p)}`);
    }
    ok("V2 les boucles mises de côté sont muettes (jamais deux boucles sonores)", (await vstate(A1)).muted && (await vstate(A2)).muted);
    const rA3 = await rmsOf(A3.locator("video"));
    ok("V2b la boucle active est bien audible", audible(rA3), JSON.stringify(rA3));
    // Le visiteur coupe : sa décision prime sur les réglages « activé » des autres vidéos pendant la visite.
    await A3.locator('[data-testid="loop-sound"]').click();
    ok("V3 le visiteur coupe le son : la boucle devient muette, l'icône suit", (await vstate(A3)).muted && (await A3.locator('[data-testid="loop-sound"]').getAttribute("data-muted")) === "true");
    await A1.scrollIntoViewIfNeeded();
    await A1.locator(".loop-click").click();
    await playing(A1);
    ok("V4 le choix du visiteur prime : une autre boucle « activé » démarre muette", (await vstate(A1)).muted === true);
    await A1.locator('[data-testid="loop-sound"]').click();
    ok("V5 le visiteur remet le son : la boucle parle", !(await vstate(A1)).muted && audible(await rmsOf(A1.locator("video"))));
    const OFF = p.locator("[data-video-mode]").nth(1);
    await OFF.scrollIntoViewIfNeeded();
    await OFF.locator(".loop-click").click();
    await playing(OFF);
    ok("V6 le choix du visiteur (son) prime aussi sur un réglage « coupé »", (await vstate(OFF)).muted === false);
    await p.context().close();

    // Navigateur qui refuse le son avant un geste : repli muet, puis le son au premier geste.
    const deny = () => {
      const orig = HTMLMediaElement.prototype.play;
      window.__deny = true;
      HTMLMediaElement.prototype.play = function () {
        if (window.__deny && !this.muted) return Promise.reject(new DOMException("Autoplay avec son refusé", "NotAllowedError"));
        return orig.call(this);
      };
    };
    const q = await newPage({}, deny);
    const B = q.locator("[data-video-mode]").nth(0);
    await B.scrollIntoViewIfNeeded();
    await B.locator(".loop-click").click();
    ok("V7 son refusé par le navigateur : la boucle démarre quand même, MUETTE", await playing(B));
    ok("V7b … l'icône dit « muet »", (await vstate(B)).muted && (await B.locator('[data-testid="loop-sound"]').getAttribute("data-muted")) === "true");
    await q.evaluate(() => { window.__deny = false; });
    await q.mouse.click(5, 450);
    ok("V8 au premier geste du visiteur, la boucle visible passe avec le son", await waitFor(async () => !(await vstate(B)).muted, 8000));
    ok("V8b … l'icône est mise à jour et le son est audible", (await B.locator('[data-testid="loop-sound"]').getAttribute("data-muted")) === "false" && audible(await rmsOf(B.locator("video"))));
    ok("V8c … toujours une seule vidéo sonore", (await nSounding(q)) === 1);
    await q.context().close();
    void boxes;
  });

  /* ---- F. Plein écran ---- */
  if (run("F")) await sec("F", async () => {
    const p = await newPage();
    const boxes = p.locator("[data-video-mode]");
    const n = await boxes.count();
    ok("F0 chaque vidéo (22 contextes) a son bouton plein écran", n === 22 && (await p.locator('[data-testid="video-fullscreen"]').count()) === 22, `${n} / ${await p.locator('[data-testid="video-fullscreen"]').count()}`);
    // Position et style : bas gauche, comme le badge (bas droit) ; le bouton son reste en haut à droite.
    const bad = [];
    const styles = [];
    for (let i = 0; i < n; i++) {
      const box = boxes.nth(i);
      await box.scrollIntoViewIfNeeded();
      const g = await box.evaluate((el) => {
        // Vidéo de carrousel en Lecteur : le bouton plein écran est le frère du bouton qui ouvre la vidéo (enveloppe `.strip-fs-wrap`).
        const e = el.closest(".strip-fs-wrap") ?? el;
        const fs = e.querySelector('[data-testid="video-fullscreen"]');
        const badge = e.querySelector(".vid-badge:not(.vid-sound):not([data-testid='video-fullscreen'])");
        const media = e.querySelector("video, img");
        const sound = e.querySelector('[data-testid="loop-sound"]');
        if (!fs || !badge || !media) return null;
        const f = fs.getBoundingClientRect();
        const b = badge.getBoundingClientRect();
        const m = media.getBoundingClientRect();
        const cs = getComputedStyle(fs);
        const cb = getComputedStyle(badge);
        return { left: f.left - m.left, bottomGap: Math.abs(f.bottom - b.bottom), leftOfBadge: f.right <= b.left + 1, belowSound: sound ? f.top > sound.getBoundingClientRect().bottom : true, h: f.height, w: f.width, style: [cs.backgroundColor, cs.color, cs.borderRadius].join("|"), badgeStyle: [cb.backgroundColor, cb.color, cb.borderRadius].join("|") };
      });
      if (!g || g.left < 0 || g.left > 16 || g.bottomGap > 3 || !g.leftOfBadge || !g.belowSound) bad.push([i, g]);
      else styles.push(g.style === g.badgeStyle);
    }
    ok("F1 le bouton est en BAS GAUCHE (même ligne que le badge, à sa gauche, sous le bouton son) dans les 22 contextes", bad.length === 0, JSON.stringify(bad.slice(0, 3)));
    ok("F1b … même fond, couleur et arrondi que les badges `.vid-badge`", styles.length === n && styles.every(Boolean), JSON.stringify(styles));
    const a11y = await p.locator('[data-testid="video-fullscreen"]').evaluateAll((els) => els.map((e) => [e.tagName, e.getAttribute("aria-label")]));
    ok("F2 accessible : un <button> avec nom « Plein écran »", a11y.every(([tag, label]) => tag === "BUTTON" && /^Plein écran/.test(label ?? "")), JSON.stringify(a11y.slice(0, 3)));
    // Boucle : lecture, son, clic sur l'icône.
    const L = boxes.nth(0);
    await L.scrollIntoViewIfNeeded();
    await L.locator(".loop-click").click();
    await playing(L);
    const fsBtn = L.locator('[data-testid="video-fullscreen"]');
    await fsBtn.click();
    ok("F3 clic : document.fullscreenElement est posé", await waitFor(() => p.evaluate(() => Boolean(document.fullscreenElement)), 8000));
    ok("F3b … c'est la vidéo (ou son cadre) de CETTE boucle", await p.evaluate(() => { const e = document.fullscreenElement; return Boolean(e) && (e.tagName === "VIDEO" || Boolean(e.querySelector("video"))); }));
    await sleep(800);
    const inFs = await vstate(L);
    ok("F4 le clic sur l'icône n'a pas mis la boucle en pause, le son est gardé", !inFs.paused && !inFs.muted, JSON.stringify(inFs));
    await shot(p, "F-plein-ecran");
    await p.keyboard.press("Escape");
    let left = await waitFor(() => p.evaluate(() => !document.fullscreenElement), 5000);
    if (!left) {
      await p.evaluate(() => document.exitFullscreen());
      left = await waitFor(() => p.evaluate(() => !document.fullscreenElement), 5000);
      console.log("NOTE F5 : Échap n'a pas quitté le plein écran dans ce chromium sans écran (sortie par exitFullscreen)");
    }
    ok("F5 sortie du plein écran", left);
    await sleep(500);
    const back = await vstate(L);
    ok("F6 au retour, l'état est conservé (lecture continue, son gardé)", !back.paused && !back.muted && audible(await rmsOf(L.locator("video"))), JSON.stringify(back));
    ok("F6b … le bouton redevient « Plein écran »", /^Plein écran/.test((await fsBtn.getAttribute("aria-label")) ?? ""));
    // Boucle en pause : le plein écran ne la lance pas.
    await L.locator(".loop-click").click();
    await sleep(500);
    const paused0 = (await vstate(L)).paused;
    await fsBtn.click();
    await waitFor(() => p.evaluate(() => Boolean(document.fullscreenElement)), 8000);
    await sleep(500);
    ok("F7 boucle en pause : l'entrée en plein écran ne change pas son état", paused0 && (await vstate(L)).paused);
    await p.evaluate(() => document.exitFullscreen()).catch(() => {});
    await waitFor(() => p.evaluate(() => !document.fullscreenElement), 5000);
    // Lecteur : le bouton ouvre le lecteur en plein écran.
    const P = boxes.nth(3);
    await P.scrollIntoViewIfNeeded();
    await P.locator('[data-testid="video-fullscreen"]').click();
    const opened = await p.locator(dlgSel).waitFor({ timeout: 15000 }).then(() => true, () => false);
    ok("F8 Lecteur : le bouton plein écran ouvre la vidéo (lecteur)", opened);
    ok("F8b … en plein écran (le lecteur lui-même)", await waitFor(() => p.evaluate((s) => { const e = document.fullscreenElement; return Boolean(e) && document.querySelector(s)?.contains(e); }, dlgSel), 8000));
    await p.waitForFunction((s) => { const v = document.querySelector(`${s} video`); return v && !v.paused && v.currentTime > 0.15; }, dlgSel, { timeout: 20000 }).catch(() => {});
    ok("F8c … la lecture continue, avec le son", audible(await rmsOf(p.locator(`${dlgSel} video`))));
    await p.evaluate(() => document.exitFullscreen()).catch(() => {});
    await waitFor(() => p.evaluate(() => !document.fullscreenElement), 5000);
    await sleep(400);
    ok("F8d … après la sortie du plein écran, le lecteur est toujours ouvert et la lecture continue", (await p.locator(dlgSel).count()) === 1 && (await p.locator(`${dlgSel} video`).evaluate((v) => !v.paused && !v.muted)));
    await p.keyboard.press("Escape");
    await p.context().close();

    // iPhone : pas d'API Fullscreen sur les éléments, seulement webkitEnterFullscreen sur la vidéo.
    const ios = () => {
      for (const proto of [Element.prototype, HTMLElement.prototype, HTMLVideoElement.prototype]) {
        try { delete proto.requestFullscreen; } catch {}
        try { delete proto.webkitRequestFullscreen; } catch {}
        try { Object.defineProperty(proto, "requestFullscreen", { value: undefined, configurable: true }); } catch {}
      }
      window.__ios = 0;
      HTMLVideoElement.prototype.webkitEnterFullscreen = function () { window.__ios++; };
    };
    const q = await newPage({}, ios);
    const IL = q.locator("[data-video-mode]").nth(0);
    await IL.scrollIntoViewIfNeeded();
    await IL.locator('[data-testid="video-fullscreen"]').click();
    ok("F9 iOS Safari : repli sur webkitEnterFullscreen de la vidéo", await waitFor(() => q.evaluate(() => window.__ios === 1), 5000), String(await q.evaluate(() => window.__ios)));
    await q.context().close();

    // 390 px, tactile : cible >= 44 px, un toucher fonctionne.
    const m = await newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const sizes = await m.locator('[data-testid="video-fullscreen"]').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
    ok("F10 390 px tactile : cible du bouton plein écran >= 44 × 44 px (22 vidéos)", sizes.length === 22 && sizes.every(([w, h]) => w >= 44 && h >= 44), JSON.stringify(sizes.slice(0, 4)));
    const MB = m.locator("[data-video-mode]").nth(0);
    await MB.scrollIntoViewIfNeeded();
    await MB.locator('[data-testid="video-fullscreen"]').tap();
    ok("F11 un toucher passe en plein écran", await waitFor(() => m.evaluate(() => Boolean(document.fullscreenElement)), 8000));
    ok("F11b … sans lancer ni arrêter la boucle (toucher sur l'icône seule)", (await vstate(MB)).paused);
    await shot(m, "F-390");
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    ok("F12 390 px : pas de défilement horizontal", overflow <= 0, String(overflow));
    await m.context().close();
  });

  /* ---- E. Éditeur : « Son au départ » dans chaque contexte ---- */
  if (run("E")) await sec("E", async () => {
    const hoverAt = async (loc) => {
      await loc.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await sleep(400);
      const b = await loc.boundingBox();
      await page.mouse.move(b.x + b.width / 2 + 4, b.y + b.height / 3);
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 3 + 3, { steps: 3 });
      await sleep(300);
    };
    setDraft(pageId, PAGE_BLOCKS().map((b) => (b.type === "project-board" ? { ...b, props: { ...b.props, look: { slotLook: { "c1-aa1": { video: "loop" }, "c1-bb2": { video: "loop" }, "c2-aa1": { video: "loop" }, "c3-aa1": { video: "player" } } } } } : b)));
    setBoardDraft(project.id, pageId, BOARD());
    fr = await openEditor(page, BASE, pageId);
    await settled(page);
    const props = (uid) => findIn(draftBlocks(pageId), uid)?.props;
    const pb = () => findIn(draftBlocks(pageId), "pbd")?.props;
    const items = (uid) => findIn(draftBlocks(pageId), uid)?.props.items ?? [];
    // Bloc Vidéo : barre au survol.
    const vl = fr.locator('[data-edit-block="vl-on"] [data-edit-media="mediaId"]');
    await hoverAt(vl);
    const seg = fr.locator('[data-testid="media-video-sound"]');
    await seg.waitFor({ timeout: 15000 });
    ok("E1 barre du bloc Vidéo : « Son au départ » Activé / Coupé, « Activé » pressé par défaut", (await seg.locator("button").count()) === 2 && (await seg.locator('button[aria-pressed="true"]').innerText()) === "Activé");
    await shot(page, "E-barre-bloc");
    await seg.locator('[data-video-sound-set="off"]').click();
    ok("E2 « Coupé » écrit `sound: off` dans le bloc", await waitFor(() => props("vl-on")?.sound === "off"), JSON.stringify(props("vl-on")));
    await settled(page);
    ok("E2b … la toile le sait (data-video-sound = off)", await waitFor(async () => (await fr.locator('[data-edit-block="vl-on"] [data-video-sound="off"]').count()) === 1));
    await hoverAt(vl);
    await fr.locator('[data-testid="media-video-sound"] [data-video-sound-set="on"]').click();
    ok("E3 « Activé » (le défaut) retire le champ", await waitFor(() => props("vl-on") && !("sound" in props("vl-on"))), JSON.stringify(props("vl-on")));
    await settled(page);
    await hoverAt(fr.locator('[data-edit-block="vl-none"] [data-edit-media="mediaId"]'));
    await sleep(500);
    ok("E4 vidéo SANS son : aucun réglage de son", (await fr.locator('[data-testid="media-video-sound"]').count()) === 0);
    // Panneau.
    await vl.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await sleep(400);
    const wb = await vl.boundingBox();
    await page.mouse.click(wb.x + 20, wb.y + 20);
    await page.getByRole("tab", { name: "Réglages" }).click();
    const sel = page.getByLabel("Son au départ", { exact: true }).first();
    await sel.waitFor({ timeout: 15000 });
    ok("E5 panneau : liste « Son au départ » (Activé / Coupé), valeur Activé", (await sel.inputValue()) === "on");
    await sel.selectOption("off");
    ok("E5b … « Coupé » écrit dans le bloc", await waitFor(() => props("vl-on")?.sound === "off"));
    await sel.selectOption("on");
    ok("E5c … « Activé » retire le champ", await waitFor(() => props("vl-on") && !("sound" in props("vl-on"))));
    await settled(page);
    // Case de grille.
    const cell = fr.locator('[data-edit-block="gp"] .block-grid > .block-grid-cell').nth(0);
    await hoverAt(cell);
    const cseg = fr.locator('[data-testid="cell-video-sound"]');
    await cseg.waitFor({ timeout: 15000 });
    ok("E6 barre de la case de grille : « Son au départ », Activé pressé", (await cseg.locator('button[aria-pressed="true"]').innerText()) === "Activé");
    await cseg.locator('[data-cb="sound-off"]').click();
    ok("E7 « Coupé » écrit dans la case", await waitFor(() => findIn(draftBlocks(pageId), "gk1")?.props.sound === "off"), JSON.stringify(findIn(draftBlocks(pageId), "gk1")?.props));
    await settled(page);
    // Planche libre de la page.
    const bar = () => fr.locator('[data-testid="free-bar"]');
    const select = async (id) => {
      const el = fr.locator(`.free-item[data-free-item="${id}"]`);
      await el.scrollIntoViewIfNeeded();
      await el.click({ position: { x: 8, y: 8 } });
      await bar().waitFor();
      await sleep(300);
    };
    await select("fa");
    ok("E8 barre de la planche libre : « Son au départ » (Activé pressé)", (await bar().locator('[data-testid="free-sound-choice"] button[aria-pressed="true"]').innerText()) === "Activé");
    await bar().locator('[data-free-sound-set="off"]').click();
    ok("E9 « Coupé » écrit dans la ligne de l'élément", await waitFor(() => items("fb").find((i) => i.id === "fa")?.sound === "off"), JSON.stringify(items("fb")[0]));
    await settled(page);
    await select("fs");
    ok("E10 planche libre, vidéo sans son : pas de réglage de son", (await bar().locator('[data-testid="free-sound-choice"]').count()) === 0);
    await select("fb");
    ok("E10b … réglage « coupé » déjà posé : « Coupé » pressé", (await bar().locator('[data-testid="free-sound-choice"] button[aria-pressed="true"]').innerText()) === "Coupé");
    // Panneau de la planche libre.
    await page.getByRole("tab", { name: "Réglages" }).click();
    await page.getByTestId("free-list").waitFor({ timeout: 15000 });
    const soundSelects = page.getByTestId("free-list").getByLabel("Son au départ", { exact: true });
    ok("E11 panneau de la planche libre : « Son au départ » pour chaque vidéo avec son (4), pas pour la vidéo sans son", (await soundSelects.count()) === 4, String(await soundSelects.count()));
    await soundSelects.nth(1).selectOption("on");
    ok("E11b … « Activé » dans le panneau retire le champ de l'élément fb", await waitFor(() => items("fb").find((i) => i.id === "fb") && !("sound" in items("fb").find((i) => i.id === "fb"))));
    await settled(page);
    // Planche de projet : composant Vidéo, rail (par vidéo), case de grille, planche libre.
    const barOf = (uid) => fr.locator(`[data-edit-bitem="${uid}"] > .pe-bitem-bar`);
    await hoverAt(fr.locator('[data-edit-bitem="bv"]'));
    ok("E12 barre du composant Vidéo de la planche : « Son au départ » (Coupé pressé)", (await barOf("bv").locator('[data-testid="bitem-video-sound"] button[aria-pressed="true"]').innerText()) === "Coupé");
    await barOf("bv").locator('[data-edit-bitem-op="sound-on"]').click();
    ok("E13 « Activé » : champ retiré dans la planche du projet", await waitFor(() => { const it = boardDraft(project.id)?.find((i) => i.uid === "bv"); return it && !("sound" in it.props); }), JSON.stringify(boardDraft(project.id)?.find((i) => i.uid === "bv")?.props));
    await settled(page);
    // Les places en Boucle sont enveloppées dans un `display: contents` : on survole la case (`.strip-frame`).
    const slots = fr.locator('[data-edit-bitem="c1"] .strip-frame');
    await hoverAt(slots.nth(0));
    const sseg = fr.locator('[data-testid="slot-video-sound"]');
    await sseg.waitFor({ timeout: 15000 });
    ok("E14 rail : « Son au départ » sur la barre de CETTE vidéo (Activé pressé)", (await sseg.locator('button[aria-pressed="true"]').innerText()) === "Activé");
    await sseg.locator('[data-slot-sound-set="off"]').click();
    ok("E15 « Coupé » écrit dans look.slotLook[slug].sound du bloc planche, au nom de CETTE vidéo", await waitFor(() => pb()?.look?.slotLook?.["c1-aa1"]?.sound === "off" && pb()?.look?.slotLook?.["c2-aa1"]?.sound === undefined), JSON.stringify(pb()?.look));
    await settled(page);
    await hoverAt(fr.locator('[data-edit-bitem="c1"] .strip-frame').nth(1));
    await sleep(500);
    ok("E16 rail : la vidéo sans son n'a pas de réglage de son", (await fr.locator('[data-testid="slot-video-sound"]').count()) === 0);
    const bcell = fr.locator('[data-edit-bitem="bg"] .block-grid > .block-grid-cell').nth(0);
    await hoverAt(bcell);
    await fr.locator('[data-testid="cell-video-sound"] [data-cb="sound-off"]').click();
    ok("E17 case de grille de planche : « Coupé » écrit dans la case", await waitFor(() => boardDraft(project.id)?.find((i) => i.uid === "bg")?.props.children.find((k) => k.uid === "bk1")?.props.sound === "off"));
    await settled(page);
    const bel = fr.locator('.free-item[data-free-item="bp"]');
    await bel.scrollIntoViewIfNeeded();
    await bel.click({ position: { x: 8, y: 8 } });
    await bar().waitFor();
    await bar().locator('[data-free-sound-set="off"]').click();
    ok("E18 planche libre de planche : « Coupé » écrit dans la ligne", await waitFor(() => boardDraft(project.id)?.find((i) => i.uid === "bfb")?.props.items.find((i) => i.id === "bp")?.sound === "off"));
    await settled(page);
    // Rechargement : les réglages sont relus.
    const snap = JSON.stringify([draftBlocks(pageId), boardDraft(project.id)]);
    fr = await openEditor(page, BASE, pageId);
    await settled(page);
    ok("E19 rechargement de l'éditeur : brouillons inchangés", JSON.stringify([draftBlocks(pageId), boardDraft(project.id)]) === snap);
    const states = await fr.locator("[data-video-mode]").evaluateAll((els) => els.map((e) => [e.getAttribute("data-video-mode"), e.getAttribute("data-video-audio") === null ? null : e.getAttribute("data-video-sound")]));
    ok("E20 la toile relit chaque réglage (22 vidéos)", states.length === 22 && states[5][1] === "off" && states[0][1] === "on" && states[8][1] === "off" && states[2][1] === null, JSON.stringify(states));
    // Aperçu = public : la boucle « coupé » démarre muette, la boucle par défaut parle.
    await page.getByRole("button", { name: "Aperçu", exact: false }).first().click();
    await fr.waitForFunction(() => !document.documentElement.hasAttribute("data-edit-canvas"), null, { timeout: 30000 });
    await sleep(1500);
    const pv = fr.locator("[data-video-mode]");
    await pv.nth(0).scrollIntoViewIfNeeded();
    await pv.nth(0).locator(".loop-click").click();
    ok("E21 Aperçu : la boucle par défaut parle (son activé)", (await playing(pv.nth(0))) && !(await vstate(pv.nth(0))).muted);
    await pv.nth(1).scrollIntoViewIfNeeded();
    await pv.nth(1).locator(".loop-click").click();
    await playing(pv.nth(1));
    ok("E22 Aperçu : une boucle réglée « coupé » démarre muette (le visiteur n'a pas touché au bouton son : le réglage vaut)", (await vstate(pv.nth(1))).muted === true);
    ok("E23 Aperçu : bouton plein écran présent sur la boucle", (await pv.nth(0).locator('[data-testid="video-fullscreen"]').count()) === 1);
    await shot(page, "E-apercu");
    await page.keyboard.press("Escape");
    await sleep(800);
    // Publication : le site publié = l'éditeur.
    await page.getByRole("button", { name: "Publier", exact: true }).click();
    ok("E24 publication faite", await waitFor(() => sql((db) => db.prepare("select draft from pages where id = ?").get(pageId)).draft === null && boardDraft(project.id) === null, 120000));
    await sleep(3000);
    const pub = await newPage();
    const pubStates = await pub.locator("[data-video-mode]").evaluateAll((els) => els.map((e) => [e.getAttribute("data-video-mode"), e.getAttribute("data-video-audio") === null ? null : e.getAttribute("data-video-sound")]));
    ok("E25 site publié : chaque vidéo a le même réglage que sur la toile", JSON.stringify(pubStates) === JSON.stringify(states), JSON.stringify(pubStates));
    const first = pub.locator("[data-video-mode]").nth(5);
    await first.scrollIntoViewIfNeeded();
    await first.locator(".loop-click").click();
    await playing(first);
    ok("E26 site publié : la case de grille réglée « coupé » démarre muette", (await vstate(first)).muted === true);
    await pub.context().close();
    // Journal.
    const log = new Database(path.join(process.env.DATA_DIR ?? "data", "edit-log.db"), { readonly: true });
    const labels = log.prepare("select label from edit_log order by id desc limit 300").all().map((r) => r.label);
    log.close();
    ok("E27 journal : les réglages de son sont journalisés (entrées d'édition de bloc / planche, publication)", labels.some((l) => /Bloc .* modifié|Brouillon modifié|Planche/.test(l)) && labels.some((l) => /publiée/.test(l)), JSON.stringify([...new Set(labels)].slice(0, 6)));
  });

  /* ---- L. Anciennes données, toile en mode édition ---- */
  if (run("L")) await sec("L", async () => {
    const legacy = [vid("old1", MEDIA.avec, { mode: "loop", title: T("Ancienne boucle") }), FB("ofb", [fit("o1", MEDIA.avec, 10, 10, 30), fit("o2", MEDIA.avec, 50, 10, 30, { video: "player" })])];
    setDraft(pageId, legacy);
    setBoardDraft(project.id, pageId, []);
    const before = JSON.stringify(draftBlocks(pageId));
    fr = await openEditor(page, BASE, pageId);
    await settled(page);
    await sleep(1500);
    ok("L1 ouverture de l'éditeur : anciennes données non réécrites (aucune migration)", JSON.stringify(draftBlocks(pageId)) === before);
    ok("L2 toile en mode édition : aucun bouton plein écran ni bouton son (le clic choisit l'élément)", (await fr.locator('[data-testid="video-fullscreen"], [data-testid="loop-sound"]').count()) === 0);
    ok("L3 … l'ancienne vidéo est « son activé » (défaut) sur la toile", (await fr.locator('[data-video-mode][data-video-sound="on"]').count()) === 3);
    await page.getByRole("button", { name: "Publier", exact: true }).click();
    await waitFor(() => sql((db) => db.prepare("select draft from pages where id = ?").get(pageId)).draft === null, 120000);
    await sleep(2500);
    const rows = sql((db) => db.prepare("select props from blocks where page_id = ? order by id").all(pageId));
    ok("L4 publication : aucune donnée `sound` ajoutée", !/"sound"/.test(JSON.stringify(rows)), JSON.stringify(rows).slice(0, 300));
    const p = await newPage();
    const b0 = p.locator("[data-video-mode]").nth(0);
    await b0.scrollIntoViewIfNeeded();
    await b0.locator(".loop-click").click();
    await playing(b0);
    ok("L5 public : l'ancienne boucle parle maintenant (seule différence avec avant : le son par défaut)", !(await vstate(b0)).muted && audible(await rmsOf(b0.locator("video"))));
    await p.context().close();
  });
} catch (e) {
  ok("exception inattendue", false, String(e.stack ?? e).split("\n").slice(0, 8).join(" | "));
  await page.screenshot({ path: path.join(SHOTS, "erreur.png") }).catch(() => {});
}

ok("aucune erreur de page (pageerror)", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `video127 : ${failures} échec(s)` : "video127 : OK");
process.exit(failures ? 1 : 0);
