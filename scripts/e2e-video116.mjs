#!/usr/bin/env node
/**
 * Lot 116 « son des vidéos, badges, une vidéo à la fois, planche libre » (chromium, serveur requis, base neuve, une connexion admin).
 * Vidéos SYNTHÉTIQUES générées par ffmpeg (sinus 440 Hz + mire, 320 × 180, 4 s) et envoyées par la médiathèque : le serveur les convertit.
 *
 *  U  Médiathèque : `has_audio` juste pour chaque variante (mp4, mov, webm opus, mkv, deux pistes dont la 1re muette, mono, sans audio, piste muette).
 *  P  Site en ligne, CHAQUE contexte (vidéo seule, case de grille, rail / carrousel, planche de projet, planche libre ; Boucle et Lecteur) :
 *     son détecté, son AUDIBLE (niveau RMS par AudioContext + captureStream après un clic), bouton son (présent seulement si la vidéo a du son),
 *     lecture muette au départ, badge unique (même coin, même style, ▶ + durée / icône boucle). Tableau : lignes `TABLE116 {…}`.
 *  S  Une seule vidéo à la fois (boucles, lecteur), pause de la précédente.
 *  A  Éditeur : Aperçu = comme un visiteur (le Lecteur s'ouvre, le son s'entend, la Boucle joue) ; mode édition : le clic choisit, pas de bouton son.
 *  E  Planche libre dans l'éditeur : parité image / vidéo (barre), réglages de la vidéo (Lecture, Affiche, état du son), panneau, éditeur = public.
 *  L  Anciennes planches : aucune réécriture à l'ouverture, rendu en Boucle comme avant ; journal d'édition.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=U,P,S,A,E,L] [SHOTS=dossier] node scripts/e2e-video116.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";

import { boardDraft, boardPublished, draftBlocks, findIn, grid, login, makeMedia, openEditor, pageIdOf, q1, setBoardDraft, setDraft, settled, sleep, sql, waitFor } from "./lib/grille31d.mjs";

const BASE = process.env.BASE ?? "http://localhost:3470";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(tmpdir(), "e2e-video116");
const DIR = path.join(tmpdir(), "e2e-video116-src");
mkdirSync(SHOTS, { recursive: true });
mkdirSync(DIR, { recursive: true });

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};

/* ---- Vidéos synthétiques ---------------------------------------------------------------------------------------------------------- */
const ff = (...args) => execFileSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
const V = ["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=15", "-t", "4"];
const A = ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100"];
const SILENT = ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"];
const X264 = ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"];
const VARIANTS = {
  mp4: { file: "v116-mp4.mp4", audio: true, args: [...V, ...A, ...X264, "-c:a", "aac", "-ac", "2", "-shortest"] },
  mov: { file: "v116-mov.mov", audio: true, args: [...V, ...A, ...X264, "-c:a", "aac", "-ac", "2", "-shortest"] },
  webm: { file: "v116-webm.webm", audio: true, args: [...V, ...A, "-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "300k", "-c:a", "libopus", "-ac", "2", "-shortest"] },
  mkv: { file: "v116-mkv.mkv", audio: true, args: [...V, ...A, ...X264, "-c:a", "aac", "-ac", "2", "-shortest"] },
  deux: { file: "v116-deux.mkv", audio: true, args: [...V, ...SILENT, ...A, ...X264, "-c:a", "aac", "-map", "0:v", "-map", "1:a", "-map", "2:a", "-shortest"] },
  mono: { file: "v116-mono.mp4", audio: true, args: [...V, ...A, ...X264, "-c:a", "aac", "-ac", "1", "-shortest"] },
  muette: { file: "v116-sans-audio.mp4", audio: false, args: [...V, ...X264, "-an"] },
  silence: { file: "v116-piste-muette.mp4", audio: false, args: [...V, ...SILENT, ...X264, "-c:a", "aac", "-shortest"] },
};
const row = (name) => q1("select id, status, has_audio, duration from media where original_name = ? order by id desc", name);

const THRESHOLD = 0.004; // niveau RMS minimal d'un son audible (sinus à 1/8 d'amplitude : ~0,09)
const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);

const MEDIA = {};
for (const [k, v] of Object.entries(VARIANTS)) {
  if (!row(v.file)) {
    ff(...v.args, path.join(DIR, v.file));
    await page.goto(`${BASE}/admin/medias`, { waitUntil: "networkidle" });
    await page.locator("input[type=file]").first().setInputFiles(path.join(DIR, v.file));
    if (!(await waitFor(() => Boolean(row(v.file)), 60000))) throw new Error(`${v.file} : envoi non reçu`);
  }
}
for (const [k, v] of Object.entries(VARIANTS)) {
  if (!(await waitFor(() => row(v.file)?.status === "ready", 300000))) throw new Error(`${v.file} : ${JSON.stringify(row(v.file))}`);
  MEDIA[k] = row(v.file).id;
}
const IMG = await makeMedia(page, BASE);
const pageId = pageIdOf("personnages");
const project = q1("select id, slug from projects order by id limit 1");


/* ---- Contenu de test ---- */
const T = (s) => ({ fr: s, en: s });
const vid = (uid, mediaId, props = {}) => ({ uid, type: "video-single", props: { mediaId, variant: "card", ...props } });
const fit = (id, media, x, y, w, extra = {}) => ({ id, media, x, y, w, rot: 0, z: 0, ...extra });
const own = (uid, props = {}) => ({ uid, type: "strip", props: { source: "own", media: [MEDIA.mp4, MEDIA.muette], ...props } });
const FB_PAGE = () => ({ uid: "fb", type: "free-board", props: { format: "3:2", phone: "scale", zoom: false, items: [fit("fa", MEDIA.mp4, 5, 5, 25), fit("fp", MEDIA.mp4, 40, 5, 25, { video: "player" }), fit("fs", MEDIA.muette, 5, 50, 25), fit("fi", IMG.paysage, 40, 50, 25)] } });
const PAGE_BLOCKS = () => [
  vid("vloop", MEDIA.mp4, { mode: "loop", title: T("Boucle avec son"), captionDate: T("05/2026") }),
  vid("vplay", MEDIA.mp4, { mode: "player", title: T("Lecteur avec son"), captionDate: T("05/2026") }),
  vid("vloopsans", MEDIA.muette, { mode: "loop", title: T("Boucle sans son") }),
  grid("gp", { layout: "2" }, [vid("gk1", MEDIA.mp4, { variant: "plain", mode: "loop" }), vid("gk2", MEDIA.mp4, { variant: "plain", mode: "player" })]),
  FB_PAGE(),
  { uid: "pbd", type: "project-board", props: { project: project.slug } },
];
const BOARD = () => [
  own("c1"),
  own("c2", { videoMode: "loop" }),
  vid("bv", MEDIA.mp4, { variant: "plain", mode: "player" }),
  { uid: "bg", type: "grid", props: { layout: "2", gap: "normal", align: "stretch", ratio: "auto", top: "gap", children: [vid("bk1", MEDIA.mp4, { variant: "plain", mode: "loop" }), vid("bk2", MEDIA.mp4, { variant: "plain", mode: "player" })] } },
  { uid: "bfb", type: "free-board", props: { format: "3:2", phone: "scale", zoom: false, items: [fit("ba", MEDIA.mp4, 5, 5, 25), fit("bp", MEDIA.mp4, 40, 5, 25, { video: "player" })] } },
];
// Contextes dans l'ordre du DOM : nom, mode attendu, son attendu.
const CONTEXTS = [
  ["vidéo seule · Boucle", "loop", true],
  ["vidéo seule · Lecteur", "player", true],
  ["vidéo seule · Boucle sans son", "loop", false],
  ["case de grille · Boucle", "loop", true],
  ["case de grille · Lecteur", "player", true],
  ["planche libre (page) · Boucle (par défaut)", "loop", true],
  ["planche libre (page) · Lecteur", "player", true],
  ["planche libre (page) · Boucle sans son", "loop", false],
  ["rail / carrousel (sans choix) · vidéo avec son", "player", true],
  ["rail / carrousel (sans choix) · vidéo sans son", "loop", false],
  ["rail / carrousel (Boucle) · vidéo avec son", "loop", true],
  ["rail / carrousel (Boucle) · vidéo sans son", "loop", false],
  ["planche de projet · vidéo seule Lecteur", "player", true],
  ["planche de projet · case de grille Boucle", "loop", true],
  ["planche de projet · case de grille Lecteur", "player", true],
  ["planche de projet · planche libre Boucle", "loop", true],
  ["planche de projet · planche libre Lecteur", "player", true],
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
async function publicPage(options = {}) {
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  const p = await c.newPage();
  p.setDefaultTimeout(30000);
  p.on("pageerror", (e) => errors.push(`public : ${e.message}`));
  await p.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
  return p;
}
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
    const base = { muted: v.muted, paused: v.paused, decoded: v.webkitAudioDecodedByteCount ?? -1 };
    if (!tracks.length) return { ...base, tracks: 0, rms: 0 };
    const src = ac.createMediaStreamSource(new MediaStream(tracks));
    const an = ac.createAnalyser();
    an.fftSize = 2048;
    src.connect(an);
    const buf = new Float32Array(an.fftSize);
    let acc = 0;
    let n = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 1500) {
      an.getFloatTimeDomainData(buf);
      for (const x of buf) {
        acc += x * x;
        n++;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    await ac.close().catch(() => {});
    return { ...base, tracks: tracks.length, rms: Math.sqrt(acc / n), decoded: v.webkitAudioDecodedByteCount ?? -1 };
  });
const vstate = (el) => el.evaluate((e) => { const v = e.querySelector("video"); return { paused: v.paused, muted: v.muted, t: v.currentTime }; });
const playing = (el, timeout = 15000) => waitFor(async () => { const s = await vstate(el); return !s.paused && s.t > 0.15; }, timeout);
const dlgSel = '[data-testid="video-viewer"]';

/** Joue la vidéo d'un contexte comme un visiteur et mesure : { detected, audible, button, startedMuted, rms, mode }. */
async function probeContext(p, box, mode) {
  const out = { mode, button: false, audible: false, startedMuted: null, rms: 0 };
  if (mode === "loop") {
    const click = box.locator(".loop-click").first();
    await box.scrollIntoViewIfNeeded();
    await click.click();
    const started = await playing(box);
    out.startedMuted = started ? (await vstate(box)).muted : null;
    const sound = box.locator('[data-testid="loop-sound"]');
    out.button = (await sound.count()) > 0;
    if (out.button) {
      await sound.first().click();
      await sleep(300);
    }
    const r = await rmsOf(box.locator("video").first());
    out.rms = r.rms;
    out.audible = r.rms > THRESHOLD && !r.muted;
    out.tracks = r.tracks;
    await click.click().catch(() => {});
  } else {
    const trigger = (await box.evaluate((e) => e.tagName === "BUTTON")) ? box : box.locator("button.video-play").first();
    await box.scrollIntoViewIfNeeded();
    await trigger.click();
    await p.locator(dlgSel).waitFor({ timeout: 20000 });
    await p.waitForFunction((s) => { const v = document.querySelector(`${s} video`); return v && !v.paused && v.currentTime > 0.15; }, dlgSel, { timeout: 20000 }).catch(() => {});
    out.button = (await p.locator(`${dlgSel} [data-vp="mute"]`).count()) > 0;
    out.startedMuted = await p.locator(`${dlgSel} video`).evaluate((v) => v.muted);
    const r = await rmsOf(p.locator(`${dlgSel} video`));
    out.rms = r.rms;
    out.audible = r.rms > THRESHOLD && !r.muted;
    out.tracks = r.tracks;
    await p.keyboard.press("Escape");
    await p.locator(dlgSel).waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
  }
  return out;
}

const badgeInfo = (box) =>
  box.evaluate((e) => {
    const b = e.querySelector(".vid-badge:not(.vid-sound)");
    if (!b) return null;
    const cs = getComputedStyle(b);
    return { kind: b.getAttribute("data-badge"), text: b.textContent.trim(), pos: cs.position, right: cs.right, bottom: cs.bottom, bg: cs.backgroundColor, color: cs.color, radius: cs.borderRadius, h: Math.round(b.getBoundingClientRect().height), loopIcon: Boolean(b.querySelector('svg[data-icon="loop"]')) };
  });

/* ---- U. has_audio, et son réellement audible dans le navigateur pour CHAQUE variante produite ---- */
if (run("U")) {
  await page.goto(`${BASE}/admin/medias`, { waitUntil: "networkidle" });
  for (const [k, v] of Object.entries(VARIANTS)) {
    const r = row(v.file);
    ok(`U ${k} : has_audio = ${v.audio ? 1 : 0}`, r.has_audio === (v.audio ? 1 : 0), JSON.stringify(r));
    const variants = JSON.parse(sql((db) => db.prepare("select variants from media where id = ?").get(r.id)).variants);
    const files = (Array.isArray(variants) ? variants : (variants.files ?? [])).filter((f) => f.format === "mp4");
    ok(`U ${k} : sorties mp4 produites`, files.length >= 1, JSON.stringify(variants).slice(0, 200));
    for (const f of files) {
      await page.evaluate((src) => { document.getElementById("t116v")?.remove(); const v = document.createElement("video"); v.id = "t116v"; v.src = src; v.loop = true; v.playsInline = true; document.body.appendChild(v); }, `/media/${f.key}`);
      await page.evaluate(() => document.getElementById("t116v").play());
      const out = await rmsOf(page.locator("#t116v"));
      ok(`U ${k} : ${f.key.split("/").pop()} ${v.audio ? "audible dans le navigateur" : "sans son"}`, v.audio ? out.rms > THRESHOLD : out.rms <= THRESHOLD, JSON.stringify(out));
    }
  }
}

/** Une section qui échoue (exception) ne coupe pas les suivantes. */
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

  /* ---- P. Site en ligne ---- */
  if (run("P")) await sec("P", async () => {
    const p = await publicPage();
    const boxes = p.locator("[data-video-mode]");
    const modes = await boxes.evaluateAll((els) => els.map((e) => e.getAttribute("data-video-mode")));
    ok("P0 les 17 contextes sont rendus, dans l'ordre et avec le bon mode", JSON.stringify(modes) === JSON.stringify(CONTEXTS.map((c) => c[1])), JSON.stringify(modes));
    const badges = [];
    for (const [i, [name, mode, sound]] of CONTEXTS.entries()) {
      const box = boxes.nth(i);
      let r;
      try {
        r = await probeContext(p, box, mode);
      } catch (e) {
        ok(`P ${name} : lecture et mesure`, false, String(e.message).split("\n")[0].slice(0, 160));
        console.log(`TABLE116 ${JSON.stringify({ contexte: name, mode, sonDetecte: sound, erreur: true })}`);
        badges.push(null);
        continue;
      }
      const b = await badgeInfo(box);
      badges.push(b);
      console.log(`TABLE116 ${JSON.stringify({ contexte: name, mode, sonDetecte: sound, sonAudible: r.audible, boutonSon: r.button, muetAuDepart: mode === "loop" ? r.startedMuted : null, rms: Number(r.rms.toFixed(4)), badge: b ? b.text : null })}`);
      ok(`P ${name} : son ${sound ? "audible" : "absent"}`, sound ? r.audible : !r.audible, JSON.stringify(r));
      ok(`P ${name} : bouton son ${sound ? "présent" : "absent"}`, r.button === sound, JSON.stringify(r));
      if (mode === "loop") ok(`P ${name} : la boucle démarre MUETTE`, r.startedMuted === true, JSON.stringify(r));
      ok(`P ${name} : badge unique (${mode === "loop" ? "icône boucle" : "▶ + durée"})`, Boolean(b) && (mode === "loop" ? b.kind === "loop" && b.loopIcon && !/\d/.test(b.text) : b.kind === "player" && /\d:\d\d/.test(b.text)), JSON.stringify(b));
    }
    const same = (k) => new Set(badges.filter(Boolean).map((b) => b[k])).size === 1;
    ok("P badges : même coin (bas droit, 0,6 rem), même style (fond, couleur, arrondi, hauteur) dans les 17 contextes", badges.every(Boolean) && ["pos", "right", "bottom", "bg", "color", "radius", "h"].every(same), JSON.stringify(badges.map((b) => b && [b.pos, b.right, b.bottom, b.h])));
    // Légende : la durée n'est plus collée à la date.
    const caps = await p.locator("section, div").filter({ hasText: "Lecteur avec son" }).last().innerText();
    ok("P légende : la date « 05/2026 » n'est pas suivie de la durée (« · 0:04 »)", !/05\/2026\s*·\s*\d:\d\d/.test(caps), caps.slice(0, 200));
    await shot(p, "P-public");
  });

  /* ---- S. Une seule vidéo à la fois ---- */
  if (run("S")) await sec("S", async () => {
    const p = await publicPage();
    const boxes = p.locator("[data-video-mode]");
    const count = () => p.evaluate(() => [...document.querySelectorAll("video")].filter((v) => !v.paused).length);
    const first = boxes.nth(0);
    const second = boxes.nth(3);
    await first.scrollIntoViewIfNeeded();
    await first.locator(".loop-click").click();
    ok("S1 une boucle lancée joue", await playing(first));
    await second.scrollIntoViewIfNeeded();
    await second.locator(".loop-click").click();
    ok("S2 lancer une autre boucle met la première en pause (une seule joue)", (await playing(second)) && (await vstate(first)).paused && (await count()) === 1, String(await count()));
    await sleep(1500);
    ok("S2b la première ne repart pas toute seule", (await vstate(first)).paused);
    await boxes.nth(1).scrollIntoViewIfNeeded();
    await boxes.nth(1).locator("button.video-play").click();
    await p.locator(dlgSel).waitFor();
    await p.waitForFunction((s) => { const v = document.querySelector(`${s} video`); return v && !v.paused && v.currentTime > 0.15; }, dlgSel, { timeout: 20000 });
    ok("S3 ouvrir un lecteur met la boucle en pause (une seule joue)", (await vstate(second)).paused && (await count()) === 1, String(await count()));
    await p.keyboard.press("Escape");
    await p.locator(dlgSel).waitFor({ state: "detached" });
    // Depuis une planche libre et le rail : une seule à la fois dans toute la page.
    const fb = boxes.nth(5);
    const rail = boxes.nth(10);
    await fb.scrollIntoViewIfNeeded();
    await fb.locator(".loop-click").click();
    await playing(fb);
    await rail.scrollIntoViewIfNeeded();
    await rail.locator(".loop-click").click();
    ok("S4 planche libre puis rail : une seule vidéo joue", (await playing(rail)) && (await vstate(fb)).paused && (await count()) === 1, String(await count()));
    await rail.scrollIntoViewIfNeeded();
    await fb.scrollIntoViewIfNeeded();
    await sleep(1200);
    ok("S4b la boucle mise en pause ne reprend pas en revenant à l'écran", (await vstate(fb)).paused);
    // Aucune boucle ne démarre toute seule (règle du site : à l'arrêt jusqu'au clic).
    const q = await publicPage();
    await sleep(2500);
    ok("S5 aucune vidéo ne démarre seule à l'ouverture de la page", (await q.evaluate(() => [...document.querySelectorAll("video")].filter((v) => !v.paused).length)) === 0);
  });

  /* ---- A. Aperçu de l'éditeur ---- */
  if (run("A")) await sec("A", async () => {
    setDraft(pageId, PAGE_BLOCKS());
    setBoardDraft(project.id, pageId, BOARD());
    fr = await openEditor(page, BASE, pageId);
    await settled(page);
    const boxes = fr.locator("[data-video-mode]");
    // Mode édition : le clic choisit le composant.
    const loopE = boxes.nth(0);
    await loopE.scrollIntoViewIfNeeded();
    await loopE.locator(".loop-click").click();
    await sleep(1000);
    ok("A0 mode édition : un clic sur la Boucle ne la lance pas (il choisit le composant)", (await vstate(loopE)).paused);
    ok("A0b mode édition : pas de bouton son sur la toile", (await loopE.locator('[data-testid="loop-sound"]').count()) === 0);
    const playE = boxes.nth(1).locator("button.video-play");
    await playE.scrollIntoViewIfNeeded();
    await playE.click();
    await sleep(1000);
    ok("A0c mode édition : le Lecteur ne s'ouvre pas", (await fr.locator(dlgSel).count()) === 0);
    // Aperçu.
    await page.getByRole("button", { name: "Aperçu", exact: false }).first().click();
    await fr.waitForFunction(() => !document.documentElement.hasAttribute("data-edit-canvas"), null, { timeout: 30000 });
    await sleep(1500);
    const pb = boxes.nth(1).locator("button.video-play");
    await pb.scrollIntoViewIfNeeded();
    await pb.click();
    const opened = await fr.locator(dlgSel).waitFor({ timeout: 15000 }).then(() => true, () => false);
    ok("A1 Aperçu : le Lecteur s'ouvre (comme pour un visiteur)", opened);
    if (opened) {
      await fr.waitForFunction((s) => { const v = document.querySelector(`${s} video`); return v && !v.paused && v.currentTime > 0.15; }, dlgSel, { timeout: 20000 }).catch(() => {});
      const r = await rmsOf(fr.locator(`${dlgSel} video`));
      ok("A2 Aperçu : le son du Lecteur est audible", r.rms > THRESHOLD && !r.muted, JSON.stringify(r));
      ok("A2b Aperçu : bouton son dans le Lecteur", (await fr.locator(`${dlgSel} [data-vp="mute"]`).count()) === 1);
      await page.keyboard.press("Escape");
      const closed = await fr.locator(dlgSel).waitFor({ state: "detached", timeout: 10000 }).then(() => true, () => false);
      await sleep(600);
      ok("A2c Aperçu : Échap ferme le Lecteur SANS quitter l'Aperçu", closed && (await fr.evaluate(() => !document.documentElement.hasAttribute("data-edit-canvas"))));
      if (!(await fr.evaluate(() => !document.documentElement.hasAttribute("data-edit-canvas")))) {
        await page.getByRole("button", { name: "Aperçu", exact: false }).first().click();
        await fr.waitForFunction(() => !document.documentElement.hasAttribute("data-edit-canvas"), null, { timeout: 30000 });
      }
    }
    const lp = boxes.nth(0);
    await lp.scrollIntoViewIfNeeded();
    await lp.locator(".loop-click").click();
    ok("A3 Aperçu : la Boucle se lance au clic", await playing(lp));
    const sound = lp.locator('[data-testid="loop-sound"]');
    ok("A3b Aperçu : bouton son sur la Boucle qui a du son", (await sound.count()) === 1);
    if ((await sound.count()) === 1) {
      await sound.click();
      await sleep(300);
      const r = await rmsOf(lp.locator("video").first());
      ok("A3c Aperçu : le son de la Boucle est audible après le bouton", r.rms > THRESHOLD && !r.muted, JSON.stringify(r));
    }
    ok("A3d Aperçu : pas de bouton son sur la Boucle sans son", (await boxes.nth(2).locator('[data-testid="loop-sound"]').count()) === 0);
    // Rail et planche libre dans l'Aperçu.
    const rl = boxes.nth(8);
    await rl.scrollIntoViewIfNeeded();
    await rl.click();
    ok("A4 Aperçu : le Lecteur du rail s'ouvre", await fr.locator(dlgSel).waitFor({ timeout: 15000 }).then(() => true, () => false));
    await fr.locator(`${dlgSel} [data-testid="video-viewer-close"]`).click();
    await fr.locator(dlgSel).waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
    const fp = boxes.nth(6).locator("button.video-play");
    await fp.scrollIntoViewIfNeeded();
    await fp.click();
    ok("A5 Aperçu : le Lecteur de la planche libre s'ouvre", await fr.locator(dlgSel).waitFor({ timeout: 15000 }).then(() => true, () => false));
    await fr.locator(`${dlgSel} [data-testid="video-viewer-close"]`).click();
    await fr.locator(dlgSel).waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
    await shot(page, "A-apercu");
    await page.keyboard.press("Escape");
    await sleep(800);
  });

  /* ---- E. Planche libre dans l'éditeur : parité image / vidéo ---- */
  if (run("E")) await sec("E", async () => {
    setDraft(pageId, [FB_PAGE()]);
    setBoardDraft(project.id, pageId, []);
    fr = await openEditor(page, BASE, pageId);
    await settled(page);
    const items = () => draftBlocks(pageId).find((b) => b.uid === "fb")?.props.items ?? [];
    const item = (id) => items().find((i) => i.id === id);
    const bar = () => fr.locator('[data-testid="free-bar"]');
    const select = async (id) => {
      const el = fr.locator(`.free-item[data-free-item="${id}"]`);
      await el.scrollIntoViewIfNeeded();
      await el.click({ position: { x: 8, y: 8 } });
      await bar().waitFor();
      await sleep(300);
    };
    const common = ["free-replace", "free-remove", "free-front", "free-back", "free-radius", "free-frame-button"];
    const ids = async () => bar().evaluate((b) => [...b.querySelectorAll("[data-testid]")].map((e) => e.getAttribute("data-testid")));
    await select("fi");
    const imageBar = await ids();
    await select("fa");
    const videoBar = await ids();
    ok("E1 barre image : réglages communs (remplacer, supprimer, plan, arrondi, cadre)", common.every((c) => imageBar.includes(c)), JSON.stringify(imageBar));
    ok("E2 barre vidéo : les MÊMES réglages communs (cadre, arrondi, plan, rotation…)", common.every((c) => videoBar.includes(c)), JSON.stringify(videoBar));
    ok("E3 barre vidéo : réglages propres (Lecture Boucle / Lecteur, Affiche, état du son)", ["free-lecture-mode", "free-poster", "free-sound-state"].every((c) => videoBar.includes(c)), JSON.stringify(videoBar));
    ok("E3b barre image : aucun réglage de vidéo", !imageBar.some((c) => /video|poster|sound/.test(c)));
    ok("E3c l'état du son : « Avec son » / « Sans son » détecté", (await bar().getByTestId("free-sound-state").innerText()) === "Avec son");
    await select("fs");
    ok("E3d … vidéo muette : « Sans son »", (await bar().getByTestId("free-sound-state").innerText()) === "Sans son");
    await select("fa");
    ok("E4 Lecture : « Boucle » pressé par défaut (ancienne planche)", (await bar().locator('[data-testid="free-lecture-mode"] button[aria-pressed="true"]').innerText()) === "Boucle");
    await bar().locator('[data-free-lecture-set="player"]').click();
    ok("E5 « Lecteur » : écrit dans la ligne de l'élément (planche libre de la page)", await waitFor(() => item("fa")?.video === "player"), JSON.stringify(item("fa")));
    await settled(page);
    ok("E5b … la toile montre le Lecteur (même rendu que le site)", await waitFor(async () => (await fr.locator('.free-item[data-free-item="fa"] [data-video-mode="player"]').count()) === 1));
    await select("fa");
    await bar().locator('[data-free-lecture-set="loop"]').click();
    ok("E6 « Boucle » : écrit dans la ligne", await waitFor(() => item("fa")?.video === "loop"), JSON.stringify(item("fa")));
    await settled(page);
    // Affiche : posée par les données, rendue partout ; retirée depuis la barre.
    const draft = draftBlocks(pageId);
    const fb = findIn(draft, "fb");
    fb.props.items = fb.props.items.map((i) => (i.id === "fa" ? { ...i, poster: IMG.carre } : i));
    setDraft(pageId, draft);
    fr = await openEditor(page, BASE, pageId);
    await settled(page);
    const posterAttr = await fr.locator('.free-item[data-free-item="fa"] video').getAttribute("poster");
    ok("E7 affiche choisie : la Boucle l'utilise comme image d'attente", Boolean(posterAttr) && /\/media\//.test(posterAttr) && posterAttr !== (await fr.locator('.free-item[data-free-item="fs"] video').getAttribute("poster")), String(posterAttr));
    await select("fa");
    await bar().getByTestId("free-poster-clear").click();
    ok("E8 « Sans affiche » retire l'affiche de la ligne", await waitFor(() => item("fa") && !("poster" in item("fa"))), JSON.stringify(item("fa")));
    await settled(page);
    // Panneau de gauche.
    await select("fa");
    await page.getByRole("tab", { name: "Réglages" }).click();
    await page.getByTestId("free-list").waitFor({ timeout: 15000 });
    const lis = page.getByTestId("free-list").locator("li");
    const videoLi = lis.filter({ has: page.locator('[data-testid^="free-poster-"]') });
    ok("E9 panneau : les vidéos ont Lecture + Affiche + état du son, pas les images", (await videoLi.count()) === 3 && (await videoLi.first().getByLabel("Lecture", { exact: true }).count()) === 1 && (await lis.count()) === 4, String(await videoLi.count()));
    await videoLi.first().getByLabel("Lecture", { exact: true }).selectOption("player");
    ok("E10 panneau : « Lecteur » écrit dans la ligne", await waitFor(() => items().filter((i) => i.video === "player").length >= 2), JSON.stringify(items().map((i) => [i.id, i.video])));
    await settled(page);
    await shot(page, "E-planche-libre");
    // Dans la planche d'un projet (même composant).
    setDraft(pageId, [{ uid: "pbd", type: "project-board", props: { project: project.slug } }]);
    setBoardDraft(project.id, pageId, [{ uid: "bfb", type: "free-board", props: { format: "3:2", phone: "scale", zoom: false, items: [fit("ba", MEDIA.mp4, 5, 5, 25)] } }]);
    fr = await openEditor(page, BASE, pageId);
    await settled(page);
    const el = fr.locator('.free-item[data-free-item="ba"]');
    await el.scrollIntoViewIfNeeded();
    await el.click({ position: { x: 8, y: 8 } });
    await bar().waitFor();
    ok("E11 planche libre d'une planche de projet : mêmes réglages de vidéo", (await bar().getByTestId("free-lecture-mode").count()) === 1 && (await bar().getByTestId("free-poster").count()) === 1);
    await bar().locator('[data-free-lecture-set="player"]').click();
    ok("E12 … « Lecteur » écrit dans la planche du projet", await waitFor(() => boardDraft(project.id)?.find((i) => i.uid === "bfb")?.props.items.find((i) => i.id === "ba")?.video === "player"), JSON.stringify(boardDraft(project.id)));
    await settled(page);
  });

  /* ---- L. Anciennes planches, journal ---- */
  if (run("L")) await sec("L", async () => {
    const legacy = { uid: "fb", type: "free-board", props: { format: "4:3", phone: "stack", items: [{ id: "old1", media: MEDIA.mp4, x: 10, y: 10, w: 30, rot: 5, z: 0 }, { id: "old2", media: IMG.paysage, x: 50, y: 20, w: 30, rot: 0, z: 1 }] } };
    setDraft(pageId, [legacy]);
    setBoardDraft(project.id, pageId, []);
    const before = JSON.stringify(draftBlocks(pageId));
    fr = await openEditor(page, BASE, pageId);
    await settled(page);
    await sleep(1500);
    ok("L1 ouverture de l'éditeur : l'ancienne planche n'est pas réécrite (aucune migration)", JSON.stringify(draftBlocks(pageId)) === before);
    ok("L2 sa vidéo est une Boucle (comme avant), clic = choisir", (await fr.locator('.free-item[data-free-item="old1"] [data-video-mode="loop"]').count()) === 1 && (await fr.locator('.free-item[data-free-item="old1"] .loop-click').count()) === 1);
    await page.getByRole("button", { name: "Publier", exact: true }).click();
    await waitFor(() => sql((db) => db.prepare("select draft from pages where id = ?").get(pageId)).draft === null, 120000);
    await sleep(2500);
    const rows = sql((db) => db.prepare("select props from blocks where page_id = ? and type = 'free-board'").all(pageId));
    const published = JSON.stringify(rows.map((r) => JSON.parse(r.props).items ?? []));
    ok("L3 publication : les données de l'ancienne planche sont inchangées (pas de champ de vidéo ajouté)", !/"video"|"poster"/.test(published), published);
    const p = await publicPage();
    const m = await p.locator(".free-item [data-video-mode]").evaluateAll((els) => els.map((e) => e.getAttribute("data-video-mode")));
    ok("L4 public : la vidéo de l'ancienne planche est en Boucle, avec bouton son", JSON.stringify(m) === JSON.stringify(["loop"]) && (await p.locator('.free-item [data-testid="loop-sound"]').count()) === 1, JSON.stringify(m));
    // Journal.
    const log = new Database(path.join(process.env.DATA_DIR ?? "data", "edit-log.db"), { readonly: true });
    const labels = log.prepare("select label from edit_log order by id desc limit 200").all().map((r) => r.label);
    log.close();
    ok("L5 journal : les enregistrements de l'éditeur (planche libre comprise) sont journalisés", (!run("E") || labels.some((l) => /Planche libre|Brouillon modifié/.test(l))) && labels.some((l) => /publiée/.test(l)), JSON.stringify([...new Set(labels)].slice(0, 6)));
  });
} catch (e) {
  ok("exception inattendue", false, String(e.stack ?? e).split("\n").slice(0, 8).join(" | "));
  await page.screenshot({ path: path.join(SHOTS, "erreur.png") }).catch(() => {});
}

ok("aucune erreur de page (pageerror)", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `video116 : ${failures} échec(s)` : "video116 : OK");
process.exit(failures ? 1 : 0);
