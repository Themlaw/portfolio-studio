#!/usr/bin/env node
/**
 * Lot 36 « Lecteur vidéo » (chromium, serveur requis, base neuve, une connexion admin). Deux VRAIES vidéos générées par ffmpeg
 * (16 s avec son, 3 s sans son), envoyées par la médiathèque et converties par le serveur.
 *
 *  A  Boucle (page) : muette, en boucle, jouée ; un clic la met en pause, un autre la relance ; Espace et Entrée au clavier ;
 *     repère pause / lecture discret ; « réduire les animations » : elle démarre en pause.
 *  B  Lecteur (page) : image d'attente + bouton ; un clic ouvre la visionneuse (fond sombre) ; lecture / pause, ± 10 s (boutons,
 *     bornes), barre cliquable et glissable, temps écoulé et durée, son (muet, volume), plein écran ; fermeture par ×, Échap ou clic
 *     hors de la vidéo ; focus piégé puis rendu au déclencheur ; clavier (Espace, ← →, M, F, Échap).
 *  C  Téléphone (390 px, tactile) : Boucle au toucher, Lecteur ouvert au toucher, commandes assez grandes, barre pleine largeur.
 *  D  Cases de grille de la page : Boucle et Lecteur.
 *  E  Planche : carrousels (Boucle, Lecteur, selon la vidéo), composant Vidéo, grille.
 *  F  Éditeur : le choix Boucle / Lecteur dans la barre du composant, de la case de grille, du composant de planche et de la bande,
 *     et dans le panneau ; sur la toile la vidéo ne s'ouvre pas en grand.
 *  G  Parité toile / site en ligne, publication (modes écrits dans le publié).
 *  H  Migration 0027 : jouée par le serveur (journal), puis sur une copie de la base de l'instance avec d'anciennes données.
 * Captures : $SHOTS.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=A,B,…] [SHOTS=dossier] node scripts/e2e-video36.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";

import { boardDraft, boardPublished, draftBlocks, findIn, grid, login, openEditor, pageIdOf, q1, setBoardDraft, setDraft, settled, sleep, sql, waitFor } from "./lib/grille31d.mjs";
import { ensureVideos } from "./lib/video36.mjs";

const BASE = process.env.BASE ?? "http://localhost:3470";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(tmpdir(), "e2e-video36");
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);
const V = await ensureVideos(page, BASE);
const pageId = pageIdOf("personnages");
const project = q1("select id, slug from projects order by id limit 1");

const vid = (uid, mediaId, props = {}) => ({ uid, type: "video-single", props: { mediaId, variant: "card", ...props } });
const T = (s) => ({ fr: s, en: s });
const own = (uid, props = {}) => ({ uid, type: "strip", props: { source: "own", media: [V.short, V.long], ...props } });
const PAGE_BLOCKS = () => [
  vid("vloop", V.short, { mode: "loop", title: T("Boucle essai") }),
  vid("vplay", V.long, { mode: "player", title: T("Lecteur essai") }),
  grid("gp", { layout: "2" }, [vid("gk1", V.long, { variant: "plain", mode: "loop" }), vid("gk2", V.short, { variant: "plain", mode: "player" })]),
  { uid: "pbd", type: "project-board", props: { project: project.slug } },
];
const BOARD = () => [
  own("c1", { videoMode: "loop" }),
  own("c2", { videoMode: "player" }),
  own("c3"),
  vid("bv", V.long, { variant: "plain", mode: "player" }),
  { uid: "bg", type: "grid", props: { layout: "2", gap: "normal", align: "stretch", ratio: "auto", top: "gap", children: [vid("bk1", V.short, { variant: "plain", mode: "loop" }), vid("bk2", V.long, { variant: "plain", mode: "player" })] } },
];
const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});

/** Brouillons écrits, puis publiés par l'éditeur (la publication du produit). */
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

/** Page publique dans un contexte propre. */
async function publicPage(options = {}) {
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  const p = await c.newPage();
  p.setDefaultTimeout(30000);
  p.on("pageerror", (e) => errors.push(`public : ${e.message}`));
  await p.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
  return p;
}
const section = (p) => p.locator(`section[aria-labelledby="project-${project.slug}"]`);
const modeEl = (p, mode, n = 0) => p.locator(`[data-video-mode="${mode}"]`).nth(n);
const vstate = (el) => el.evaluate((e) => { const v = e.querySelector("video"); return { paused: v.paused, muted: v.muted, loop: v.loop, t: v.currentTime, ready: v.readyState }; });
const playing = async (el, timeout = 15000) => waitFor(async () => { const s = await vstate(el); return !s.paused && s.t > 0.2; }, timeout);
const isPaused = async (el, timeout = 8000) => waitFor(async () => (await vstate(el)).paused, timeout);

const dlgSel = '[data-testid="video-viewer"]';
const dlg = (p) => p.locator(dlgSel);
const dv = (p) => p.locator(`${dlgSel} video`);
const dt = (p) => dv(p).evaluate((v) => v.currentTime);
const dctl = (p, name) => p.locator(`${dlgSel} [data-vp="${name}"]`);
const dPaused = (p) => dv(p).evaluate((v) => v.paused);
const dPlaying = (p) => p.waitForFunction((s) => { const v = document.querySelector(`${s} video`); return Boolean(v) && !v.paused && v.currentTime > 0.2; }, dlgSel, { timeout: 20000 }).then(() => true, () => false);
const seekTo = (p, t) => dv(p).evaluate((v, x) => new Promise((res) => { v.addEventListener("seeked", () => res(true), { once: true }); v.currentTime = x; setTimeout(() => res(false), 4000); }), t);

/** Ouvre le Lecteur d'un élément `[data-video-mode=player]` : retourne son déclencheur. */
async function openViewer(p, trigger) {
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  await dlg(p).waitFor({ timeout: 20000 });
  return trigger;
}

try {
  ok("0 publication : brouillons de test publiés", await publishAll());
  const html = await (await fetch(`${BASE}/fr/personnages`)).text();
  ok("0b site en ligne : repères des deux modes présents, aucun repère d'édition", html.includes('data-video-mode="loop"') && html.includes('data-video-mode="player"') && !/data-edit-/.test(html.replace(/<script[\s\S]*?<\/script>/g, "")));

  /* ---- A. Boucle ---- */
  if (run("A")) {
    const p = await publicPage();
    const box = modeEl(p, "loop", 0);
    await box.scrollIntoViewIfNeeded();
    ok("A1 Boucle : la vidéo joue (muette, en boucle)", (await playing(box)) && (await vstate(box)).muted && (await vstate(box)).loop);
    const click = box.locator(".loop-click");
    ok("A1b le repère pause est affiché, discret (petit, translucide)", await click.locator('.loop-mark[data-mark="pause"]').isVisible() && (await click.locator(".loop-mark").evaluate((m) => ({ w: m.getBoundingClientRect().width, o: Number(getComputedStyle(m).opacity) }))).w <= 40);
    ok("A1c le cadre est un bouton : nom lisible, focusable", /Mettre la vidéo en pause/.test((await click.getAttribute("aria-label")) ?? "") && (await click.getAttribute("role")) === "button" && (await click.getAttribute("tabindex")) === "0");
    await shot(p, "A-boucle-lecture");
    await click.click();
    ok("A2 un clic met la boucle en pause", await isPaused(box));
    ok("A2b état et repère à jour (pause → lecture)", (await click.getAttribute("data-loop")) === "paused" && (await click.locator('.loop-mark[data-mark="play"]').count()) === 1 && /Relancer/.test((await click.getAttribute("aria-label")) ?? ""));
    await shot(p, "A-boucle-pause");
    await click.click();
    ok("A3 un second clic la relance", await playing(box));
    await click.focus();
    await p.keyboard.press("Space");
    ok("A4 Espace : pause", await isPaused(box));
    await p.keyboard.press("Enter");
    ok("A5 Entrée : lecture", await playing(box));
    ok("A6 une boucle n'ouvre jamais de visionneuse", (await dlg(p).count()) === 0);
    await p.context().close();

    const rp = await publicPage({ reducedMotion: "reduce" });
    const rbox = modeEl(rp, "loop", 0);
    await rbox.scrollIntoViewIfNeeded();
    await sleep(2500);
    const rs = await vstate(rbox);
    ok("A7 « réduire les animations » : la Boucle démarre en pause (image d'attente, repère ▶)", rs.paused && rs.t === 0 && (await rbox.locator('.loop-mark[data-mark="play"]').count()) === 1, JSON.stringify(rs));
    await rbox.locator(".loop-click").click();
    ok("A8 … et un clic la lance", await playing(rbox));
    await rp.context().close();
  }

  /* ---- B. Lecteur ---- */
  if (run("B")) {
    const p = await publicPage();
    const box = modeEl(p, "player", 0);
    await box.scrollIntoViewIfNeeded();
    ok("B1 Lecteur : image d'attente et bouton lecture, pas de <video> dans la page", (await box.locator("video").count()) === 0 && (await box.getByRole("button", { name: /Lire/ }).count()) === 1);
    await shot(p, "B-lecteur-attente");
    const trigger = box.getByRole("button", { name: /Lire/ });
    await openViewer(p, trigger);
    ok("B2 un clic ouvre la visionneuse plein cadre sur fond sombre", await dlg(p).evaluate((d) => { const r = d.getBoundingClientRect(); return r.width >= innerWidth - 20 && r.height >= innerHeight - 2 && getComputedStyle(d).backgroundColor !== "rgba(0, 0, 0, 0)" && d.getAttribute("aria-modal") === "true"; }));
    ok("B3 la vidéo démarre (lecteur maison, aucune commande native)", (await dPlaying(p)) && !(await dv(p).evaluate((v) => v.controls)));
    await shot(p, "B-lecteur-ouvert");
    // Lecture / pause.
    await dctl(p, "play").click();
    ok("B4 bouton pause", await dPaused(p));
    await dctl(p, "play").click();
    ok("B5 bouton lecture", await dPlaying(p));
    await dctl(p, "play").click();
    // ± 10 s et bornes.
    await seekTo(p, 3);
    await dctl(p, "forward").click();
    await sleep(500);
    ok("B6 avancer de 10 s : 3 s → 13 s", near(await dt(p), 13, 0.7), String(await dt(p)));
    await dctl(p, "forward").click();
    await sleep(500);
    ok("B6b … borné à la fin de la vidéo", (await dt(p)) >= 15.5, String(await dt(p)));
    await seekTo(p, 4);
    await dctl(p, "back").click();
    await sleep(500);
    ok("B7 reculer de 10 s : borné au début", near(await dt(p), 0, 0.5), String(await dt(p)));
    await seekTo(p, 14);
    await dctl(p, "back").click();
    await sleep(500);
    ok("B7b reculer de 10 s : 14 s → 4 s", near(await dt(p), 4, 0.7), String(await dt(p)));
    ok("B7c boutons nommés en français", (await dctl(p, "back").getAttribute("aria-label")) === "Reculer de 10 secondes" && (await dctl(p, "forward").getAttribute("aria-label")) === "Avancer de 10 secondes");
    // Barre de progression : clic et glisser.
    const seek = p.locator(`${dlgSel} .vp-seek`);
    const sb = await seek.boundingBox();
    const d = await dv(p).evaluate((v) => v.duration);
    await p.mouse.click(sb.x + sb.width * 0.5, sb.y + sb.height / 2);
    await sleep(500);
    ok("B8 clic sur la barre (50 %) : position au milieu", near(await dt(p), d / 2, 1.3), `${await dt(p)} / ${d}`);
    await p.mouse.move(sb.x + sb.width * 0.8, sb.y + sb.height / 2);
    await p.mouse.down();
    await p.mouse.move(sb.x + sb.width * 0.5, sb.y + sb.height / 2, { steps: 6 });
    await p.mouse.move(sb.x + sb.width * 0.2, sb.y + sb.height / 2, { steps: 6 });
    await p.mouse.up();
    await sleep(500);
    ok("B9 glisser la barre en arrière (80 % → 20 %)", near(await dt(p), d * 0.2, 1.3), String(await dt(p)));
    await seek.focus();
    const label = await p.locator(`${dlgSel} .vp-time`).innerText();
    ok("B10 temps écoulé et durée affichés (m:ss / m:ss), barre accessible", /^\d+:\d{2}\s*\/\s*0:16$/.test(label.replace(/\s+/g, " ").trim()) && (await seek.getAttribute("role")) === "slider" && /sur/.test((await seek.getAttribute("aria-valuetext")) ?? ""), label);
    // Son.
    await dctl(p, "mute").click();
    await sleep(400);
    ok("B11 couper le son", (await dv(p).evaluate((v) => v.muted)) && (await dctl(p, "mute").getAttribute("aria-pressed")) === "true");
    await dctl(p, "mute").click();
    ok("B12 remettre le son", !(await dv(p).evaluate((v) => v.muted)));
    await dctl(p, "volume").evaluate((el) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "0.3");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await sleep(300);
    ok("B13 volume : le curseur règle le volume", near(await dv(p).evaluate((v) => v.volume), 0.3, 0.01) && !(await dv(p).evaluate((v) => v.muted)), String(await dv(p).evaluate((v) => v.volume)));
    await dctl(p, "volume").evaluate((el) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "0");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await sleep(300);
    ok("B13b volume à zéro : muet", await dv(p).evaluate((v) => v.muted));
    await dv(p).evaluate((v) => { v.muted = false; v.volume = 1; });
    // Plein écran.
    await dctl(p, "fullscreen").click();
    await sleep(700);
    ok("B14 plein écran : entrée par le bouton", await p.evaluate(() => document.fullscreenElement?.classList.contains("vp") ?? false));
    await p.evaluate(() => document.exitFullscreen());
    await sleep(500);
    // Clic sur la vidéo : pause / lecture, la visionneuse reste ouverte.
    const vb = await dv(p).boundingBox();
    const was = await dPaused(p);
    await p.mouse.click(vb.x + vb.width / 2, vb.y + vb.height / 3);
    await sleep(400);
    ok("B15 un clic sur la vidéo la met en pause ou la relance, sans fermer", (await dPaused(p)) !== was && (await dlg(p).count()) === 1);
    // Fermer par ×.
    await p.locator('[data-testid="video-viewer-close"]').click();
    await dlg(p).waitFor({ state: "detached", timeout: 8000 });
    ok("B16 × ferme la visionneuse ; le focus revient au bouton de départ", await trigger.evaluate((el) => el === document.activeElement), await p.evaluate(() => document.activeElement?.outerHTML.slice(0, 80)));
    ok("B16b la page redevient défilable", (await p.evaluate(() => document.body.style.overflow)) !== "hidden");
    // Échap.
    await openViewer(p, trigger);
    await p.keyboard.press("Escape");
    await dlg(p).waitFor({ state: "detached", timeout: 8000 });
    ok("B17 Échap ferme, focus rendu", await trigger.evaluate((el) => el === document.activeElement));
    // Clic hors de la vidéo.
    await openViewer(p, trigger);
    await p.mouse.click(4, 450);
    await dlg(p).waitFor({ state: "detached", timeout: 8000 });
    ok("B18 un clic hors de la vidéo ferme", true);
    // Focus piégé.
    await openViewer(p, trigger);
    await p.waitForFunction((s) => document.querySelector(s)?.contains(document.activeElement), dlgSel);
    let inside = true;
    for (let i = 0; i < 18; i++) {
      await p.keyboard.press("Tab");
      inside &&= await dlg(p).evaluate((dd) => dd.contains(document.activeElement));
    }
    for (let i = 0; i < 18; i++) {
      await p.keyboard.press("Shift+Tab");
      inside &&= await dlg(p).evaluate((dd) => dd.contains(document.activeElement));
    }
    ok("B19 le focus reste dans la visionneuse (Tab et Maj+Tab bouclent)", inside);
    await p.keyboard.press("Escape");
    await dlg(p).waitFor({ state: "detached" });
    // Clavier.
    await openViewer(p, trigger);
    ok("B20 à l'ouverture le focus est sur le lecteur", await dlg(p).evaluate((dd) => document.activeElement?.classList.contains("vp") && dd.contains(document.activeElement)));
    await dPlaying(p);
    await p.keyboard.press("Space");
    await sleep(300);
    const pausedByKey = await dPaused(p);
    await p.keyboard.press("Space");
    await sleep(300);
    ok("B21 Espace : pause puis lecture", pausedByKey && !(await dPaused(p)));
    await p.keyboard.press("Space");
    await seekTo(p, 2);
    await p.keyboard.press("ArrowRight");
    await sleep(400);
    const right = await dt(p);
    await p.keyboard.press("ArrowLeft");
    await sleep(400);
    const left = await dt(p);
    ok("B22 → : + 10 s ; ← : − 10 s", near(right, 12, 0.8) && near(left, 2, 0.8), `${right} ${left}`);
    await p.keyboard.press("m");
    await sleep(300);
    const muted1 = await dv(p).evaluate((v) => v.muted);
    await p.keyboard.press("m");
    await sleep(300);
    ok("B23 M : coupe puis remet le son", muted1 && !(await dv(p).evaluate((v) => v.muted)));
    await p.keyboard.press("f");
    await sleep(700);
    const fsIn = await p.evaluate(() => document.fullscreenElement?.classList.contains("vp") ?? false);
    await p.keyboard.press("f");
    await sleep(700);
    ok("B24 F : plein écran, puis sortie", fsIn && (await p.evaluate(() => document.fullscreenElement === null)));
    await p.keyboard.press("Escape");
    await dlg(p).waitFor({ state: "detached", timeout: 8000 });
    ok("B25 Échap ferme (clavier)", true);
    await p.context().close();
  }

  /* ---- C. Téléphone ---- */
  if (run("C")) {
    const p = await publicPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const loop = modeEl(p, "loop", 0);
    await loop.scrollIntoViewIfNeeded();
    await playing(loop);
    await shot(p, "C-telephone-boucle");
    await loop.locator(".loop-click").tap();
    ok("C1 toucher la Boucle : pause", await isPaused(loop));
    await loop.locator(".loop-click").tap();
    ok("C2 un second toucher : lecture", await playing(loop));
    const box = modeEl(p, "player", 0);
    await box.scrollIntoViewIfNeeded();
    await box.getByRole("button", { name: /Lire/ }).tap();
    await dlg(p).waitFor();
    ok("C3 toucher le Lecteur : la visionneuse s'ouvre", await dPlaying(p));
    const geo = await p.evaluate((s) => {
      const d = document.querySelector(s).getBoundingClientRect();
      const vp = document.querySelector(`${s} .vp`).getBoundingClientRect();
      const seek = document.querySelector(`${s} .vp-seek`).getBoundingClientRect();
      const btns = ["play", "back", "forward", "mute", "fullscreen"].map((n) => { const r = document.querySelector(`${s} [data-vp="${n}"]`).getBoundingClientRect(); return [n, Math.round(r.width), Math.round(r.height), Math.round(r.left), Math.round(r.right)]; });
      const vol = getComputedStyle(document.querySelector(`${s} .vp-volume`)).display;
      return { dw: d.width, dh: d.height, overflow: document.documentElement.scrollWidth - innerWidth, vpLeft: vp.left, vpRight: vp.right, seekW: seek.width, btns, vol };
    }, dlgSel);
    ok("C4 téléphone : visionneuse plein écran, vidéo dans l'écran, aucun débordement", geo.dw === 390 && geo.vpLeft >= 0 && geo.vpRight <= 390 && geo.overflow <= 0, JSON.stringify(geo));
    ok("C5 barre de progression sur toute la largeur, boutons tactiles (≥ 36 px), tous visibles", geo.seekW >= 340 && geo.btns.every(([, w, h, l, r]) => w >= 36 && h >= 36 && l >= 0 && r <= 390), JSON.stringify(geo.btns));
    ok("C5b le curseur de volume est masqué (volume de l'appareil)", geo.vol === "none");
    await shot(p, "C-telephone-lecteur");
    await dctl(p, "play").tap();
    ok("C6 toucher pause", await dPaused(p));
    await dctl(p, "forward").tap();
    await sleep(500);
    ok("C7 toucher « avancer de 10 s »", (await dt(p)) >= 9.5, String(await dt(p)));
    const sb = await p.locator(`${dlgSel} .vp-seek`).boundingBox();
    await p.touchscreen.tap(sb.x + sb.width * 0.25, sb.y + sb.height / 2);
    await sleep(600);
    ok("C8 toucher la barre (25 %)", near(await dt(p), 4, 1.5), String(await dt(p)));
    await dctl(p, "mute").tap();
    ok("C9 toucher « couper le son »", await dv(p).evaluate((v) => v.muted));
    await p.locator('[data-testid="video-viewer-close"]').tap();
    await dlg(p).waitFor({ state: "detached", timeout: 8000 });
    ok("C10 toucher × : fermé", true);
    await p.context().close();
  }

  /* ---- D. Cases de grille (page) ---- */
  if (run("D")) {
    const p = await publicPage();
    const g = p.locator(".block-grid").first();
    const loopCell = g.locator('[data-video-mode="loop"]');
    const playCell = g.locator('[data-video-mode="player"]');
    await g.scrollIntoViewIfNeeded();
    ok("D1 grille : une case Boucle et une case Lecteur", (await loopCell.count()) === 1 && (await playCell.count()) === 1);
    ok("D2 case Boucle : joue, un clic la met en pause", (await playing(loopCell)) && (await loopCell.locator(".loop-click").click(), await isPaused(loopCell)));
    await playCell.getByRole("button", { name: /Lire/ }).click();
    await dlg(p).waitFor();
    ok("D3 case Lecteur : s'ouvre en grand", await dPlaying(p));
    await p.keyboard.press("Escape");
    await dlg(p).waitFor({ state: "detached" });
    await shot(p, "D-grille");
    await p.context().close();
  }

  /* ---- E. Planche (public) ---- */
  if (run("E")) {
    const p = await publicPage();
    const s = section(p);
    await s.scrollIntoViewIfNeeded();
    const rails = s.locator(".strip-rail");
    ok("E0 trois carrousels et leurs vidéos", (await rails.count()) === 3);
    const r1 = rails.nth(0);
    ok("E1 carrousel « Boucle » : les deux vidéos sont des boucles (même la longue)", (await r1.locator('[data-video-mode="loop"]').count()) === 2 && (await r1.locator("button.strip-frame[data-video-mode=player]").count()) === 0);
    const first = r1.locator('[data-video-mode="loop"]').first();
    await first.scrollIntoViewIfNeeded();
    ok("E2 … elle joue, un clic la met en pause, un autre la relance", (await playing(first)) && (await first.locator(".loop-click").click(), await isPaused(first)) && (await first.locator(".loop-click").click(), await playing(first)));
    ok("E2b … sans ouvrir de visionneuse", (await dlg(p).count()) === 0);
    const r2 = rails.nth(1);
    ok("E3 carrousel « Lecteur » : deux vignettes à ouvrir, aucune boucle", (await r2.locator("button.strip-frame[data-video-mode=player]").count()) === 2 && (await r2.locator("[data-loop]").count()) === 0);
    const t2 = r2.locator("button.strip-frame[data-video-mode=player]").first();
    await openViewer(p, t2);
    ok("E4 … un clic ouvre la vidéo en grand avec son lecteur", (await dPlaying(p)) && (await dctl(p, "forward").count()) === 1);
    await p.keyboard.press("Escape");
    await dlg(p).waitFor({ state: "detached" });
    ok("E4b … Échap : focus rendu à la vignette", await t2.evaluate((el) => el === document.activeElement));
    const r3 = rails.nth(2);
    ok("E5 carrousel sans choix : l'animation courte et muette est une boucle, la vidéo longue un lecteur", (await r3.locator('[data-video-mode="loop"]').count()) === 1 && (await r3.locator("button.strip-frame[data-video-mode=player]").count()) === 1);
    const bv = s.locator('[data-video-mode="player"]:not(button)').first();
    await bv.scrollIntoViewIfNeeded();
    await openViewer(p, bv.getByRole("button", { name: /Lire/ }));
    ok("E6 composant Vidéo de la planche : s'ouvre en grand", await dPlaying(p));
    await p.keyboard.press("Escape");
    await dlg(p).waitFor({ state: "detached" });
    const bgrid = s.locator(".block-grid");
    const bl = bgrid.locator('[data-video-mode="loop"]');
    await bgrid.scrollIntoViewIfNeeded();
    ok("E7 grille de planche : Boucle qui joue et se met en pause", (await playing(bl)) && (await bl.locator(".loop-click").click(), await isPaused(bl)));
    await openViewer(p, bgrid.locator('[data-video-mode="player"]').getByRole("button", { name: /Lire/ }));
    ok("E8 grille de planche : Lecteur ouvert en grand", await dPlaying(p));
    await p.keyboard.press("Escape");
    await dlg(p).waitFor({ state: "detached" });
    await rails.nth(0).evaluate((el) => el.scrollIntoView({ block: "center" }));
    await sleep(600);
    await shot(p, "E-planche");
    await rails.nth(2).evaluate((el) => el.scrollIntoView({ block: "center" }));
    await sleep(600);
    await shot(p, "E-planche-auto");
    const ph = await publicPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    ok("E9 téléphone : aucune barre de défilement horizontale de la page", (await ph.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
    await ph.context().close();
    await p.context().close();
  }

  /* ---- F. Éditeur ---- */
  let fr;
  const hoverAt = async (loc) => {
    await loc.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await sleep(400);
    const b = await loc.boundingBox();
    await page.mouse.move(b.x + b.width / 2 + 4, b.y + b.height / 3);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 3 + 3, { steps: 3 });
    await sleep(300);
  };
  const edModes = () => fr.evaluate(() => [...document.querySelectorAll("[data-video-mode]")].map((e) => e.getAttribute("data-video-mode")));
  if (run("F") || run("G")) {
    setDraft(pageId, PAGE_BLOCKS());
    setBoardDraft(project.id, pageId, BOARD());
    fr = await openEditor(page, BASE, pageId);
    await settled(page);
  }
  if (run("F")) {
    ok("F0 toile : tous les composants Vidéo portent leur mode", (await edModes()).length === 13, JSON.stringify(await edModes()));
    // Composant Vidéo de la page : barre au survol.
    const vl = fr.locator('[data-edit-block="vloop"] [data-edit-media="mediaId"]');
    await hoverAt(vl);
    const seg = fr.locator('[data-testid="media-video-mode"]');
    await seg.waitFor({ timeout: 15000 });
    ok("F1 barre de la vidéo : « Lecture » Boucle / Lecteur, le mode actuel est pressé", (await seg.locator('button[aria-pressed="true"]').innerText()) === "Boucle" && (await seg.locator("button").count()) === 2);
    await shot(page, "F-barre-video");
    await seg.locator('[data-video-mode-set="player"]').click();
    ok("F2 « Lecteur » dans la barre : écrit dans le brouillon", await waitFor(() => findIn(draftBlocks(pageId), "vloop")?.props.mode === "player"), JSON.stringify(findIn(draftBlocks(pageId), "vloop")?.props));
    await settled(page);
    ok("F2b … la toile montre le Lecteur (bouton lecture, plus de boucle)", await fr.locator('[data-edit-block="vloop"] [data-video-mode="player"]').count() === 1 && (await fr.locator('[data-edit-block="vloop"] .loop-click').count()) === 0);
    // Sur la toile la vidéo ne s'ouvre pas en grand.
    const play = fr.locator('[data-edit-block="vloop"] button.video-play');
    await play.scrollIntoViewIfNeeded();
    const pb = await play.boundingBox();
    await page.mouse.click(pb.x + pb.width / 2, pb.y + pb.height / 2);
    await sleep(1200);
    ok("F3 toile : un clic sur le bouton lecture n'ouvre pas la vidéo en grand", (await fr.locator(dlgSel).count()) === 0);
    // Panneau : le composant est choisi d'un clic dans sa marge.
    const wb = await fr.locator('[data-edit-block="vloop"] [data-edit-media]').boundingBox();
    await page.mouse.click(wb.x + 20, wb.y + 20);
    await page.getByRole("tab", { name: "Réglages" }).click();
    await sleep(600);
    const sel = page.getByLabel("Lecture", { exact: true }).first();
    await sel.waitFor({ timeout: 15000 });
    ok("F4 panneau : liste « Lecture » (Boucle / Lecteur), valeur actuelle", (await sel.inputValue()) === "player" && (await sel.locator("option").allInnerTexts()).join("|").includes("Boucle") && (await sel.locator("option").allInnerTexts()).join("|").includes("Lecteur"));
    await sel.selectOption("loop");
    ok("F5 panneau : « Boucle » écrit dans le brouillon", await waitFor(() => findIn(draftBlocks(pageId), "vloop")?.props.mode === "loop"));
    await settled(page);
    ok("F5b … la toile repasse en Boucle (même rendu que le site)", await waitFor(async () => (await fr.locator('[data-edit-block="vloop"] [data-video-mode="loop"] .loop-click').count()) === 1));
    // Case de grille de la page.
    const cell = fr.locator('[data-edit-block="gp"] .block-grid > .block-grid-cell').nth(0);
    await hoverAt(cell);
    const cseg = fr.locator('[data-testid="cell-video-mode"]');
    await cseg.waitFor({ timeout: 15000 });
    ok("F6 barre de la case : Lecture, mode actuel (Boucle) pressé", (await cseg.locator('button[aria-pressed="true"]').innerText()) === "Boucle");
    await shot(page, "F-barre-case");
    await cseg.locator('[data-cb="video-player"]').click();
    ok("F7 barre de la case : « Lecteur » écrit dans la case", await waitFor(() => findIn(draftBlocks(pageId), "gk1")?.props.mode === "player"), JSON.stringify(findIn(draftBlocks(pageId), "gk1")?.props));
    await settled(page);
    // Composant Vidéo de la planche (barre du composant).
    const bar = (uid) => fr.locator(`[data-edit-bitem="${uid}"] > .pe-bitem-bar`);
    const bvItem = fr.locator('[data-edit-bitem="bv"]');
    await hoverAt(bvItem);
    ok("F8 barre du composant Vidéo de la planche : Lecture (Lecteur pressé)", (await bar("bv").locator('[data-testid="bitem-video-mode"] button[aria-pressed="true"]').innerText()) === "Lecteur");
    await shot(page, "F-barre-planche-video");
    await bar("bv").locator('[data-edit-bitem-op="video-loop"]').click();
    ok("F9 … « Boucle » écrit dans la planche (brouillon du projet)", await waitFor(() => boardDraft(project.id)?.find((i) => i.uid === "bv")?.props.mode === "loop"), JSON.stringify(boardDraft(project.id)?.find((i) => i.uid === "bv")?.props));
    await settled(page);
    ok("F9b … la toile montre la Boucle", await waitFor(async () => (await fr.locator('[data-edit-bitem="bv"] [data-video-mode="loop"] .loop-click').count()) === 1));
    // Bande (lot 38) : plus de « Lecture » ni de « Réglages » sur la barre ; le réglage ancien `videoMode` reste lu au rendu.
    await hoverAt(fr.locator('[data-edit-bitem="c3"]'));
    ok("F10 barre d'un carrousel : plus de « Lecture » (ni Boucle / Lecteur) ni de bouton « Réglages »", (await bar("c3").locator('[data-testid="bitem-video-mode"]').count()) === 0 && !/Réglages|Lecture/.test(await bar("c3").innerText()));
    await shot(page, "F-barre-carrousel");
    const withLegacy = boardDraft(project.id).map((i) => (i.uid === "c3" ? { ...i, props: { ...i.props, videoMode: "player" } } : i));
    setBoardDraft(project.id, pageId, withLegacy);
    fr = await openEditor(page, BASE, pageId);
    await settled(page);
    ok("F11 carrousel d'avant avec `videoMode` « Lecteur » : la toile le lit toujours (les deux vidéos s'ouvrent en grand, plus de boucle)", await waitFor(async () => (await fr.locator('[data-edit-bitem="c3"] button.strip-frame[data-video-mode="player"]').count()) === 2 && (await fr.locator('[data-edit-bitem="c3"] [data-loop]').count()) === 0));
    // Panneau du carrousel : le nom de la barre choisit le composant, plus de réglage de lecture pour toute la bande.
    await hoverAt(fr.locator('[data-edit-bitem="c3"]'));
    await bar("c3").locator('[data-edit-bitem-op="settings"]').click();
    await page.getByRole("tab", { name: "Réglages" }).click();
    await page.locator('[aria-label="Contenu du carrousel"]').waitFor({ timeout: 15000 });
    ok("F12 panneau du carrousel : plus de liste « Lecture des vidéos »", (await page.getByLabel("Lecture des vidéos", { exact: true }).count()) === 0);
    ok("F13 … le réglage ancien n'est pas touché dans le brouillon", boardDraft(project.id)?.find((i) => i.uid === "c3")?.props.videoMode === "player");
    setBoardDraft(project.id, pageId, boardDraft(project.id).map((i) => (i.uid === "c3" ? { ...i, props: Object.fromEntries(Object.entries(i.props).filter(([k]) => k !== "videoMode")) } : i)));
    fr = await openEditor(page, BASE, pageId);
    await settled(page);
    // Case de grille de la planche.
    const bcell = fr.locator('[data-edit-bitem="bg"] .block-grid > .block-grid-cell').nth(1);
    await hoverAt(bcell);
    await fr.locator('[data-testid="cell-video-mode"] [data-cb="video-loop"]').click();
    ok("F14 case de grille de planche : « Boucle » écrit dans la case", await waitFor(() => boardDraft(project.id)?.find((i) => i.uid === "bg")?.props.children.find((k) => k.uid === "bk2")?.props.mode === "loop"));
    await settled(page);
    // Bande des images du projet : le mode est accepté.
    const cur = boardDraft(project.id);
    setBoardDraft(project.id, pageId, [{ uid: "ps", type: "strip", props: {} }, ...cur]);
    fr = await openEditor(page, BASE, pageId);
    await hoverAt(fr.locator('[data-edit-bitem="ps"]'));
    ok("F15 bande des images du projet : plus de « Lecture » ni de « Réglages » sur sa barre", (await fr.locator('[data-edit-bitem="ps"] > .pe-bitem-bar [data-edit-bitem-op^="video-"]').count()) === 0 && !/Réglages|Lecture/.test(await fr.locator('[data-edit-bitem="ps"] > .pe-bitem-bar').innerText()));
    await settled(page);
  }

  /* ---- G. Parité et publication ---- */
  if (run("G")) {
    if (!run("F")) await sleep(0);
    const canvasModes = await edModes();
    const canvasLoops = await fr.evaluate(() => document.querySelectorAll("[data-loop]").length);
    await page.getByRole("button", { name: "Publier", exact: true }).click();
    ok("G1 publication des brouillons (page et planche)", await waitFor(() => sql((db) => db.prepare("select draft from pages where id = ?").get(pageId)).draft === null && boardDraft(project.id) === null, 120000));
    await sleep(3000);
    const p = await publicPage();
    const pubModes = await p.evaluate(() => [...document.querySelectorAll("[data-video-mode]")].map((e) => e.getAttribute("data-video-mode")));
    const pubLoops = await p.evaluate(() => document.querySelectorAll("[data-loop]").length);
    ok("G2 parité : la liste des modes du site en ligne est celle de la toile", JSON.stringify(canvasModes) === JSON.stringify(pubModes) && canvasLoops === pubLoops, `${JSON.stringify(canvasModes)} <> ${JSON.stringify(pubModes)} (${canvasLoops}/${pubLoops})`);
    await p.context().close();
    const published = sql((db) => db.prepare("select props from blocks where page_id = ? order by position").all(pageId)).map((r) => JSON.parse(r.props));
    const vids = [];
    const walk = (n) => {
      if (n?.type === "video-single") vids.push(n);
      for (const k of n?.props?.children ?? []) walk(k);
    };
    for (const [i, props] of published.entries()) walk({ type: sql((db) => db.prepare("select type from blocks where page_id = ? order by position").all(pageId))[i].type, props });
    ok("G3 publié (page) : chaque vidéo a un mode explicite", vids.length >= 4 && vids.every((v) => v.props.mode === "loop" || v.props.mode === "player"), JSON.stringify(vids.map((v) => v.props.mode)));
    const lay = boardPublished(project.id) ?? [];
    const bvs = [];
    for (const it of lay) {
      if (it.type === "video-single") bvs.push(it);
      for (const k of it.props.children ?? []) if (k.type === "video-single") bvs.push(k);
    }
    ok("G4 publié (planche) : modes explicites des composants Vidéo ; réglage ancien des bandes (`videoMode`) publié tel quel", bvs.length === 3 && bvs.every((v) => ["loop", "player"].includes(v.props.mode)) && lay.find((i) => i.uid === "c1")?.props.videoMode === "loop" && lay.find((i) => i.uid === "c2")?.props.videoMode === "player", JSON.stringify(lay.map((i) => [i.uid, i.props.mode ?? i.props.videoMode])));
  }

  /* ---- H. Migration ---- */
  if (run("H")) {
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")).entries;
    const applied = sql((db) => db.prepare("select count(*) n from __drizzle_migrations").get()).n;
    ok("H1 le serveur a joué la migration 0027 au démarrage (journal complet appliqué)", journal.at(-1).tag === "0027_video_mode" && applied === journal.length, `${applied} / ${journal.length}`);
    // Copie de la base de l'instance + anciennes données (sans mode), migration réelle sur la copie.
    const dir = path.join(tmpdir(), "e2e-video36-mig");
    mkdirSync(dir, { recursive: true });
    const copy = path.join(dir, "copie.db");
    sql((db) => db.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`));
    const cdb = new Database(copy);
    const old = { uid: "ancien", type: "video-single", props: { variant: "card", mediaId: V.long } };
    cdb.prepare("insert into blocks (page_id, position, type, props) values (?, 90, 'video-single', ?)").run(pageId, JSON.stringify(old.props));
    cdb.prepare("insert into blocks (page_id, position, type, props) values (?, 91, 'video-single', ?)").run(pageId, JSON.stringify({ variant: "plain", mediaId: V.short, mode: "loop" }));
    cdb.prepare("update pages set draft = ?, draft_rev = 7 where id = ?").run(JSON.stringify({ title: T("x"), blocks: [old, { uid: "g", type: "grid", props: { layout: "2", children: [{ uid: "gc", type: "video-single", props: { mediaId: V.short } }] } }] }), pageId);
    cdb.prepare("update projects set layout = ?, draft_layout = ?, draft_layout_page_id = ? where id = ?").run(JSON.stringify([{ uid: "o", type: "video-single", props: { mediaId: V.long } }]), JSON.stringify([{ uid: "o2", type: "video-single", props: { mediaId: V.long } }]), pageId, project.id);
    cdb.close();
    const script = `import Database from "better-sqlite3"; import { seedVideoModes } from ${JSON.stringify(`file://${process.cwd()}/src/lib/db/video-mode.ts`)}; const db = new Database(${JSON.stringify(copy)}); console.log(JSON.stringify(seedVideoModes(db))); db.close();`;
    const out = execFileSync("node", ["--import", "tsx", "--input-type=module", "-e", script], { cwd: process.cwd(), encoding: "utf8" });
    const rep = JSON.parse(out.trim().split("\n").at(-1));
    ok("H2 migration sur la copie de la base : publié, brouillon, planche et brouillon de planche réécrits", rep.published === 1 && rep.drafts === 1 && rep.layouts === 1 && rep.draftLayouts === 1, out);
    const mdb = new Database(copy, { readonly: true });
    const modes = mdb.prepare("select position, props from blocks where position >= 90 order by position").all().map((r) => JSON.parse(r.props).mode);
    const pr = mdb.prepare("select draft, draft_rev from pages where id = ?").get(pageId);
    const lay2 = JSON.parse(mdb.prepare("select layout from projects where id = ?").get(project.id).layout);
    mdb.close();
    ok("H3 ancien lecteur → Lecteur, boucle déjà réglée → Boucle", modes[0] === "player" && modes[1] === "loop", JSON.stringify(modes));
    ok("H4 brouillon : modes posés, version + 1 ; planche : mode posé", JSON.parse(pr.draft).blocks[0].props.mode === "player" && JSON.parse(pr.draft).blocks[1].props.children[0].props.mode === "player" && pr.draft_rev >= 8 && lay2[0].props.mode === "player", JSON.stringify([pr.draft_rev, lay2]));
    const again = JSON.parse(execFileSync("node", ["--import", "tsx", "--input-type=module", "-e", script], { cwd: process.cwd(), encoding: "utf8" }).trim().split("\n").at(-1));
    ok("H5 idempotente : un second passage ne réécrit rien", again.published + again.drafts + again.layouts + again.draftLayouts === 0, JSON.stringify(again));
  }
} catch (e) {
  failures++;
  console.log(`FAIL exception — ${e.stack ?? e}`);
  await shot(page, "erreur");
}

ok("aucune erreur JavaScript", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\ntout est passé");
process.exit(failures ? 1 : 0);
