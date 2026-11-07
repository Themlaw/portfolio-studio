#!/usr/bin/env node
/**
 * Lot 121 « icônes des vidéos dessinées dans le kit Photoshop » (chromium, serveur requis, base neuve, une connexion admin).
 * Données SYNTHÉTIQUES : le kit est exporté par le serveur (thème livré), les dessins sont simulés (simulate-multi.mts, commande `video`) ;
 * vidéos de test générées par ffmpeg ; aucun fichier réel, jamais le PSD de l'artiste.
 *
 *  R0  Sans dessin : les 17 contextes du lot 116 (bloc, grille, rail, carrousel, planche de projet, planche libre ; Boucle et Lecteur) rendent
 *      chaque icône par son composant (`data-vicon`), AUCUNE n'est masquée ; empreinte du rendu (structure des SVG, pixels des badges) : écrite
 *      par `FP_MODE=record` sur la base, comparée sur le lot (`FP_FILE`) : identique à la base.
 *  K   Kit : le fichier « icônes » contient le groupe « 5 · Vidéo » (7 calques gabarit + fond du badge masqué), l'export donne l'icône actuelle ;
 *      envoi sans retouche : les 8 emplacements « inchangé » ; retouche partielle (lecture, son dessinés, muet vidé, pause supprimée) ;
 *      fond du badge seul ; les 7 icônes ; un ancien fichier « icônes » (sans le groupe) est toujours importé ; une seule partie envoyée.
 *  R1  Thème en ligne avec dessins partiels, puis fond du badge, puis les 7 icônes : CHAQUE icône dessinée remplace l'icône actuelle dans
 *      CHAQUE contexte (masque = le dessin du thème, forme teintée, SVG d'origine effacé), les autres restent ; fond du badge optionnel ;
 *      noms des boutons identiques ; tailles nettes à 1x, 2x, 3x.
 *  A   Aperçu de l'éditeur : mêmes icônes dessinées.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=R0,K,R1,A] [FP_FILE=… (absent : écrit ; présent : comparé) FP_MODE=record (écrit et ne fait que R0)] [SHOTS=dossier] node scripts/e2e-icones121.mjs
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { boardDraft, grid, login, makeMedia, openEditor, pageIdOf, q1, setBoardDraft, setDraft, settled, sleep, sql, waitFor } from "./lib/grille31d.mjs";
import { gotoThemesPage } from "./lib/theme-live.mjs";

const BASE = process.env.BASE ?? "http://localhost:3800";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const DATA = process.env.DATA_DIR ?? "./data";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const FP_FILE = process.env.BATT_FP_FILE ?? process.env.FP_FILE ?? "";
const FP_MODE = process.env.BATT_FP_MODE ?? process.env.FP_MODE ?? "";
const SHOTS = process.env.SHOTS ?? path.join(tmpdir(), "e2e-icones121");
const DIR = path.join(tmpdir(), "e2e-icones121-work");
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
const THEME = "galerie-lumineuse";

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const sec = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.stack ?? e).split("\n").slice(0, 4).join(" | "));
  }
};

/* ---- Vidéos synthétiques ---------------------------------------------------------------------------------------------------------- */
const ff = (...args) => execFileSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
const V = ["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=15", "-t", "4"];
const A = ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100"];
const X264 = ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"];
const VARIANTS = {
  mp4: { file: "v121-son.mp4", args: [...V, ...A, ...X264, "-c:a", "aac", "-ac", "2", "-shortest"] },
  muette: { file: "v121-sans-audio.mp4", args: [...V, ...X264, "-an"] },
};
const row = (name) => q1("select id, status, has_audio from media where original_name = ? order by id desc", name);

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);

const MEDIA = {};
for (const v of Object.values(VARIANTS)) {
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

/* ---- Contenu de test : les 17 contextes du lot 116 ---- */
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
// Contextes dans l'ordre du DOM : nom, mode, son.
const CONTEXTS = [
  ["vidéo seule · Boucle", "loop", true],
  ["vidéo seule · Lecteur", "player", true],
  ["vidéo seule · Boucle sans son", "loop", false],
  ["case de grille · Boucle", "loop", true],
  ["case de grille · Lecteur", "player", true],
  ["planche libre (page) · Boucle", "loop", true],
  ["planche libre (page) · Lecteur", "player", true],
  ["planche libre (page) · Boucle sans son", "loop", false],
  ["rail / carrousel (sans choix) · avec son", "player", true],
  ["rail / carrousel (sans choix) · sans son", "loop", false],
  ["rail / carrousel (Boucle) · avec son", "loop", true],
  ["rail / carrousel (Boucle) · sans son", "loop", false],
  ["planche de projet · vidéo seule Lecteur", "player", true],
  ["planche de projet · case de grille Boucle", "loop", true],
  ["planche de projet · case de grille Lecteur", "player", true],
  ["planche de projet · planche libre Boucle", "loop", true],
  ["planche de projet · planche libre Lecteur", "player", true],
];
const dlgSel = '[data-testid="video-viewer"]';

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
  await sleep(800);
  return p;
}

/* ---- Lecture des icônes d'une boîte (page ou conteneur) ----------------------------------------------------------------------------- */
/** Pour chaque <svg data-vicon> : clé, masque calculé, enfants cachés ?, taille, aria-hidden, nom du bouton qui le porte. */
const iconsOf = (box) =>
  box.evaluate((root) =>
    [...root.querySelectorAll("svg[data-vicon]")].map((s) => {
      const cs = getComputedStyle(s);
      const btn = s.closest("button");
      const r = s.getBoundingClientRect();
      return {
        key: s.getAttribute("data-vicon"),
        mask: cs.maskImage && cs.maskImage !== "none" ? cs.maskImage : (cs.webkitMaskImage && cs.webkitMaskImage !== "none" ? cs.webkitMaskImage : ""),
        childrenHidden: [...s.children].length > 0 && [...s.children].every((c) => getComputedStyle(c).display === "none"),
        bg: cs.backgroundColor,
        w: Math.round(r.width * 10) / 10,
        h: Math.round(r.height * 10) / 10,
        ariaHidden: s.getAttribute("aria-hidden") === "true",
        label: btn?.getAttribute("aria-label") ?? null,
      };
    }),
  );
const badgeBg = (box) =>
  box.evaluate((root) => [...root.querySelectorAll(".vid-badge")].map((b) => { const cs = getComputedStyle(b); return { image: cs.backgroundImage, radius: cs.borderRadius, color: cs.backgroundColor, size: cs.backgroundSize }; }));
/** Structure normalisée d'un SVG (comme la base : sans data-vicon, style, ni data-icon ajouté par le lot). */
const normSvgs = (box, sel = "svg") =>
  box.evaluate(
    (root, s) =>
      [...root.querySelectorAll(s)].map((el) => {
        const c = el.cloneNode(true);
        c.removeAttribute("data-vicon");
        c.removeAttribute("style");
        if (!["play", "loop"].includes(c.getAttribute("data-icon") ?? "")) c.removeAttribute("data-icon");
        return c.outerHTML;
      }),
    sel,
  );
const sha = (b) => createHash("sha256").update(b).digest("hex").slice(0, 16);
const vstate = (el) => el.evaluate((e) => { const v = e.querySelector("video"); return { paused: v.paused, muted: v.muted, t: v.currentTime }; });
const playing = (el, timeout = 15000) => waitFor(async () => { const s = await vstate(el); return !s.paused && s.t > 0.15; }, timeout);

/** Ouvre le lecteur d'un contexte « Lecteur » et rend ses icônes (barre) ; ferme ensuite. */
async function viewerIcons(p, box) {
  const trigger = (await box.evaluate((e) => e.tagName === "BUTTON")) ? box : box.locator("button.video-play").first();
  await box.scrollIntoViewIfNeeded();
  await trigger.click();
  await p.locator(dlgSel).waitFor({ timeout: 20000 });
  await p.waitForFunction((s) => { const v = document.querySelector(`${s} video`); return v && !v.paused && v.currentTime > 0.15; }, dlgSel, { timeout: 20000 }).catch(() => {});
  const dlg = p.locator(dlgSel);
  const playingIcons = await iconsOf(dlg);
  const norm = { mute: await normSvgs(dlg, '[data-vp="mute"] svg'), fullscreen: await normSvgs(dlg, '[data-vp="fullscreen"] svg') };
  // Pause la lecture : le gros bouton ▶ et l'icône ▶ de la barre apparaissent.
  await dlg.locator('[data-vp="play"]').click();
  await sleep(500);
  const pausedIcons = await iconsOf(dlg);
  const mute = dlg.locator('[data-vp="mute"]');
  let toggled = [];
  if (await mute.count()) {
    await mute.click();
    await sleep(300);
    toggled = await iconsOf(mute);
    await mute.click();
  }
  await p.keyboard.press("Escape");
  await p.locator(dlgSel).waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
  return { playingIcons, pausedIcons, toggled, norm };
}

/** Relevé complet des 17 contextes : icônes au repos, boucle en lecture (pause), bouton son (muet → son), noms des boutons. */
async function survey(p) {
  const boxes = p.locator("[data-video-mode]");
  const out = [];
  for (const [i, [name, mode, sound]] of CONTEXTS.entries()) {
    const box = boxes.nth(i);
    await box.scrollIntoViewIfNeeded();
    const rec = { name, mode, sound, idle: await iconsOf(box), bg: await badgeBg(box), labels: await box.evaluate((e) => [...e.querySelectorAll("button, [role=button]")].map((b) => b.getAttribute("aria-label") ?? b.textContent.trim())) };
    if (mode === "loop") {
      await box.locator(".loop-click").first().click();
      rec.running = (await playing(box)) ? await iconsOf(box) : [];
      const snd = box.locator('[data-testid="loop-sound"]');
      if (await snd.count()) {
        rec.soundBefore = await iconsOf(snd);
        await snd.first().click();
        await sleep(300);
        rec.soundAfter = await iconsOf(snd);
        await snd.first().click();
      }
      await box.locator(".loop-click").first().click().catch(() => {});
    } else rec.viewer = await viewerIcons(p, box);
    out.push(rec);
  }
  return out;
}
const hasKit = (icons, key) => icons.filter((x) => x.key === key);
const maskUrl = (u) => {
  const m = u ? /url\("?([^")]+)"?\)/.exec(u)?.[1] : "";
  if (!m) return "";
  try {
    return new URL(m, BASE).pathname;
  } catch {
    return m;
  }
};

/** Contrôle d'un relevé : chaque icône de clé drawn est masquée par SON dessin, les autres jamais. `want` : clé → URL du masque. */
function checkSurvey(tag, rec, want) {
  const all = [];
  const push = (list, where) => list?.forEach((x) => all.push({ ...x, where }));
  for (const r of rec) {
    push(r.idle, `${r.name} · repos`);
    push(r.running, `${r.name} · en lecture`);
    push(r.soundBefore, `${r.name} · son (avant)`);
    push(r.soundAfter, `${r.name} · son (après)`);
    if (r.viewer) {
      push(r.viewer.playingIcons, `${r.name} · lecteur (lecture)`);
      push(r.viewer.pausedIcons, `${r.name} · lecteur (pause)`);
      push(r.viewer.toggled, `${r.name} · lecteur (son)`);
    }
  }
  const byKey = {};
  for (const x of all) (byKey[x.key] ??= []).push(x);
  const wrong = (key) => (byKey[key] ?? []).filter((x) => (want[key] ? !(maskUrl(x.mask) === want[key] && x.childrenHidden) : x.mask !== "" || x.childrenHidden));
  const keys = ["play", "pause", "loop", "sound", "muted", "fullscreen", "exitFullscreen"];
  for (const key of keys) {
    const seen = byKey[key]?.length ?? 0;
    // Intégration v0.34b (121 + 127) : le bouton plein écran des boucles et des lecteurs existe (lot 127) : « plein écran » est donc exigée partout ;
    // « quitter le plein écran » ne se voit que pendant un plein écran (le bouton des boucles est alors hors de l'élément plein écran) : seules les occurrences présentes sont contrôlées.
    if (key === "fullscreen") ok(`${tag} fullscreen : présente (${seen} occurrence(s), tous contextes)`, seen > 0);
    if (key === "fullscreen" || key === "exitFullscreen") {
      ok(`${tag} ${key} : ${want[key] ? "dessin du thème sur chaque occurrence" : "icône d'origine"} (${seen} vue(s))`, wrong(key).length === 0, JSON.stringify(wrong(key).slice(0, 2)));
      continue;
    }
    ok(`${tag} ${key} : présente (${seen} occurrence(s), tous contextes)`, seen > 0);
    ok(`${tag} ${key} : ${want[key] ? "le dessin du thème remplace l'icône (masque = dessin, SVG d'origine effacé) partout" : "icône d'origine partout (aucun masque)"}`, wrong(key).length === 0, JSON.stringify(wrong(key).slice(0, 2)));
  }
  // Par contexte : chaque contexte montre les icônes attendues (▶ puis boucle / durée…).
  for (const r of rec) {
    const k = new Set(r.idle.map((x) => x.key));
    // Intégration v0.34b : depuis le lot 127 une boucle AVEC son démarre avec le son (réglage « Son au départ » = Activé par défaut ; le test autorise la lecture automatique avec son) : l'icône du repos est « son », plus « muet » ; et la boucle montre le bouton plein écran.
    const need = r.mode === "loop" ? ["play", "loop", "fullscreen", ...(r.sound ? ["sound"] : [])] : ["play"];
    ok(`${tag} contexte « ${r.name} » : icônes ${need.join(", ")}`, need.every((n) => k.has(n)), [...k].join());
    if (r.mode === "loop") ok(`${tag} contexte « ${r.name} » : en lecture, pause + boucle`, ["pause", "loop"].every((n) => r.running.some((x) => x.key === n)), r.running.map((x) => x.key).join());
    if (r.mode === "loop" && r.sound) ok(`${tag} contexte « ${r.name} » : bouton son = son (défaut du lot 127) puis muet`, r.soundBefore?.[0]?.key === "sound" && r.soundAfter?.[0]?.key === "muted", JSON.stringify([r.soundBefore?.map((x) => x.key), r.soundAfter?.map((x) => x.key)]));
    if (r.mode === "player") ok(`${tag} contexte « ${r.name} » : lecteur ouvert = pause, muet/son, plein écran ; en pause = ▶ (gros bouton et barre)`, ["pause", "sound", "fullscreen"].every((n) => r.viewer.playingIcons.some((x) => x.key === n)) && r.viewer.pausedIcons.filter((x) => x.key === "play").length >= 2 && r.viewer.toggled.some((x) => x.key === "muted"), JSON.stringify([r.viewer.playingIcons.map((x) => x.key), r.viewer.pausedIcons.map((x) => x.key), r.viewer.toggled.map((x) => x.key)]));
  }
  ok(`${tag} toutes les icônes restent aria-hidden (le nom est sur le bouton)`, all.every((x) => x.ariaHidden));
  return all;
}

/* ---- API du kit ---------------------------------------------------------------------------------------------------------------------- */
const login2 = await fetch(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
const cookie = login2.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
if (!login2.ok || !cookie) throw new Error(`connexion refusée (${login2.status})`);
const H = { cookie, origin: BASE };
const get = (u) => fetch(`${BASE}${u}`, { headers: { cookie } });
async function upload(data, name, type = "application/octet-stream") {
  const init = await fetch(`${BASE}/admin/api/upload/init`, { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ name, size: data.length, type, purpose: { kind: "kit", themeId: THEME } }) });
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
const rapportOf = (id) => JSON.parse(readFileSync(path.join(DATA, "kit-imports", id, "out", "rapport.json"), "utf8"));
const tsx = (code) => execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { env: { ...process.env, DATA_DIR: DATA }, encoding: "utf8" });
const mineData = () => JSON.parse(tsx(`import { getDb, schema } from "./src/lib/db/index.ts"; import { eq } from "drizzle-orm"; console.log(getDb().select().from(schema.themes).where(eq(schema.themes.mine, true)).get()?.data ?? "null");`).trim().split("\n").pop());
const sim = (...args) => execFileSync(process.execPath, ["--import", "tsx", "scripts/kit-poc/simulate-multi.mts", ...args], { stdio: "ignore" });
const tree = (file) => JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "scripts/kit-poc/psd-tree.mts", file], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim().split("\n").pop());
const readyKit = async () => {
  let body = {};
  for (let i = 0; i < 120 && !body.ready; i++) {
    body = await (await fetch(`${BASE}/admin/api/theme-kit/${THEME}`, { method: "POST", headers: H })).json().catch(() => ({}));
    if (!body.ready) await sleep(2000);
  }
  return body;
};
const applyImport = (id) => {
  const out = tsx(`import { applyKitImport } from "./src/lib/kit/apply.ts"; console.log(JSON.stringify(await applyKitImport(${JSON.stringify(THEME)}, ${JSON.stringify(id)}, { mirror: false })));`);
  return JSON.parse(out.trim().split("\n").pop());
};
/** Met « Mon thème » en ligne par l'interface (Publier). */
async function publishMine() {
  await gotoThemesPage(page, BASE);
  const publish = page.getByTestId("mine-publish");
  if (await publish.count()) {
    await publish.click();
    const dialog = page.locator("dialog[open]");
    await dialog.getByRole("button", { name: "Publier", exact: true }).click();
    await dialog.waitFor({ state: "detached", timeout: 30000 });
  }
  await sleep(1500);
}
/** Envoie un fichier retouché, attend la revue, rend { rapport, id }. */
async function sendPsd(file, name) {
  const up = await upload(readFileSync(file), name);
  const id = up.body.kitImport?.id;
  const st = await waitImport(id);
  return { status: up.status, id, state: st.status, r: st.status === "done" ? rapportOf(id) : null };
}
const VIDEO_IDS = ["video/lecture", "video/pause", "video/boucle", "video/son", "video/muet", "video/plein-ecran", "video/quitter-plein-ecran", "video/fond-badge"];
const KEYS = { "video/lecture": "play", "video/pause": "pause", "video/boucle": "loop", "video/son": "sound", "video/muet": "muted", "video/plein-ecran": "fullscreen", "video/quitter-plein-ecran": "exitFullscreen", "video/fond-badge": "badge" };
const urlOf = (img) => (img ? (img.svg ?? img.webp) : undefined);
const wantMasks = (vicons) => Object.fromEntries(Object.entries(vicons ?? {}).filter(([k]) => k !== "badge").map(([k, v]) => [k, urlOf(v)]));

let published = false;
try {
  published = await publishAll();
  ok("0 publication : brouillons de test publiés (17 contextes)", published);

  /* ---- R0. Sans dessin : icônes d'origine, rendu identique à la base ---- */
  let fpNow = null;
  if (run("R0")) await sec("R0", async () => {
    const p = await publicPage();
    const boxes = p.locator("[data-video-mode]");
    const modes = await boxes.evaluateAll((els) => els.map((e) => e.getAttribute("data-video-mode")));
    ok("R0 les 17 contextes sont rendus, dans l'ordre et avec le bon mode", JSON.stringify(modes) === JSON.stringify(CONTEXTS.map((c) => c[1])), JSON.stringify(modes));
    // Empreinte du rendu (structure des SVG normalisée, pixels des badges au repos), avant tout dessin.
    const fp = [];
    for (const [i, [name]] of CONTEXTS.entries()) {
      const box = boxes.nth(i);
      await box.scrollIntoViewIfNeeded();
      await p.mouse.move(2, 2);
      const svgs = await normSvgs(box);
      const px = [];
      for (const b of await box.locator(".vid-badge").all()) px.push(sha(await b.screenshot({ animations: "disabled" })));
      fp.push({ name, svgs, px });
    }
    fpNow = fp;
    if (FP_FILE && (FP_MODE === "record" || !existsSync(FP_FILE))) {
      writeFileSync(FP_FILE, JSON.stringify(fp, null, 1));
      console.log(`INFO empreinte écrite : ${FP_FILE}`);
    } else if (FP_FILE && existsSync(FP_FILE)) {
      const ref = JSON.parse(readFileSync(FP_FILE, "utf8"));
      const diffs = fp.filter((x, i) => JSON.stringify(x.svgs) !== JSON.stringify(ref[i]?.svgs)).map((x) => x.name);
      ok("R0 structure des SVG de chaque contexte identique à la base", diffs.length === 0 && fp.length === ref.length, diffs.join(" | "));
      const pdiffs = fp.filter((x, i) => JSON.stringify(x.px) !== JSON.stringify(ref[i]?.px)).map((x) => x.name);
      ok("R0 pixels des badges de chaque contexte identiques à la base (empreintes)", pdiffs.length === 0, pdiffs.join(" | "));
    } else console.log("INFO pas de FP_FILE : comparaison à la base non faite");
    if (FP_MODE !== "record") {
      const rec = await survey(p);
      const all = checkSurvey("R0", rec, {});
      ok("R0 sans dessin : aucune icône masquée, aucune variable de kit vidéo sur <html>", all.every((x) => x.mask === "") && (await p.evaluate(() => [...document.documentElement.attributes].filter((a) => a.name.startsWith("data-kit-vicon")).length)) === 0);
      const bg = rec.flatMap((r) => r.bg);
      ok("R0 sans dessin : le carré du badge est celui du thème (aucune image de fond)", bg.length > 0 && bg.every((b) => b.image === "none"), JSON.stringify(bg[0]));
      globalThis.R0LABELS = rec.map((r) => r.labels);
      globalThis.R0SIZES = rec.map((r) => r.idle.map((x) => [x.key, x.w, x.h]));
    }
    await p.context().close();
  });

  /* ---- K. Kit ---- */
  const drawn = {};
  if (run("K") && FP_MODE !== "record") await sec("K", async () => {
    const state = await readyKit();
    ok("K1 export du kit prêt", state.ready === true);
    const icoPart = state.parts?.find((p) => p.role === "icones");
    ok("K1 la partie « icônes » annonce les icônes vidéo (huit emplacements de plus)", icoPart?.elements?.filter((e) => /^(Lecture vidéo|Pause vidéo|Boucle|Son activé|Muet|Plein écran|Quitter le plein écran|Fond du badge)$/.test(e)).length === 8, JSON.stringify(icoPart?.elements));
    const dl = await get(`/admin/api/theme-kit/${THEME}`);
    const zipBytes = Buffer.from(await dl.arrayBuffer());
    const kitZip = path.join(DIR, "kit.zip");
    writeFileSync(kitZip, zipBytes);
    const part = await get(`/admin/api/theme-kit/${THEME}?part=icones`);
    const icoFile = path.join(DIR, "icones.psd");
    writeFileSync(icoFile, Buffer.from(await part.arrayBuffer()));
    const t = tree(icoFile);
    const names = t.children.map((c) => c.name);
    const group = t.children.find((c) => c.name === "5 · Vidéo");
    console.log(`  icônes : ${t.width} × ${t.height}, groupes : ${names.join(" | ")}`);
    ok("K2 le fichier « icônes » a un groupe « 5 · Vidéo » (après le scotch, avant le cadre dans la pile)", Boolean(group) && t.height > 5770 && t.width === 3400, `${t.width}×${t.height} ${names}`);
    const layers = group?.children?.filter((c) => c.locked === false) ?? [];
    ok("K2 le groupe contient les 8 calques gabarit (noms français explicites) et l'aperçu verrouillé", ["Lecture vidéo", "Pause vidéo", "Boucle", "Son activé", "Muet", "Plein écran", "Quitter le plein écran", "Fond du badge (option)"].every((n) => layers.some((l) => l.name === n)) && group.children.some((c) => c.locked && /Aperçu/.test(c.name)), JSON.stringify(group?.children?.map((c) => c.name)));
    const icons = layers.filter((l) => l.name !== "Fond du badge (option)");
    ok("K2 chaque icône est un gabarit à la bonne case : 512 × 512 (dessin actuel visible, centré dans la zone utile)", icons.length === 7 && icons.every((l) => { const [a, b, c, d] = l.box; return c - a > 150 && c - a <= 512 && d - b > 150 && d - b <= 512; }), JSON.stringify(icons.map((l) => l.box)));
    const badge = layers.find((l) => l.name === "Fond du badge (option)");
    ok("K2 le fond du badge (option) est masqué par défaut", badge?.hidden === true, JSON.stringify(badge));
    ok("K2 le reste du kit est intact (groupes Icônes, Curseurs, Cadre, Scotch, _guides, LISEZ-MOI)", ["1 · Icônes", "2 · Curseurs", "3 · Cadre des entrées de collection", "4 · Scotch", "_guides", "LISEZ-MOI"].every((n) => names.includes(n)), names.join());

    // K3 : envoi sans retouche.
    const raw = await sendPsd(icoFile, "icones-tel-quel.psd");
    const vr = raw.r?.slots.filter((s) => VIDEO_IDS.includes(s.id)) ?? [];
    ok("K3 sans retouche : les 8 emplacements vidéo sont lus et « inchangé » (sans avertissement)", raw.state === "done" && vr.length === 8 && vr.every((s) => s.change === "unchanged" && s.status === "ok"), JSON.stringify(vr.map((s) => [s.id, s.change, s.status, s.messages])));
    ok("K3 sans retouche : toute la partie « icônes » est inchangée (16 emplacements) et seule elle est lue", raw.r?.slots.length === 16 && raw.r.slots.every((s) => s.change === "unchanged") && raw.r.files.filter((f) => f.received).map((f) => f.id).join() === "icones", JSON.stringify(raw.r?.slots.filter((s) => s.change !== "unchanged").map((s) => s.id)));

    // K4 : retouche partielle (lecture, son dessinés ; muet vidé ; pause supprimée ; le reste intact).
    const part1 = path.join(DIR, "icones-partiel.psd");
    sim("video", kitZip, part1, "--only=lecture,son", "--empty=muet", "--delete=pause");
    const p1 = await sendPsd(part1, "icones-partiel.psd");
    const slot = (r, id) => r?.slots.find((s) => s.id === id);
    ok("K4 partiel : lecture et son redessinés (formes tracées en masque, une seule couleur)", ["video/lecture", "video/son"].every((id) => slot(p1.r, id)?.change === "redrawn" && slot(p1.r, id)?.chosen && slot(p1.r, id)?.files?.length > 0), JSON.stringify(["video/lecture", "video/son"].map((id) => slot(p1.r, id))).slice(0, 400));
    ok("K4 partiel : calque vide (muet) = icône actuelle gardée, calque supprimé (pause) = icône actuelle gardée", slot(p1.r, "video/muet")?.change === "missing" && /vide/i.test(slot(p1.r, "video/muet")?.messages.join(" ") ?? "") && slot(p1.r, "video/pause")?.change === "missing" && /introuvable/i.test(slot(p1.r, "video/pause")?.messages.join(" ") ?? ""), JSON.stringify([slot(p1.r, "video/muet"), slot(p1.r, "video/pause")]).slice(0, 400));
    ok("K4 partiel : les autres icônes vidéo et le fond du badge restent « inchangé »", ["video/boucle", "video/plein-ecran", "video/quitter-plein-ecran", "video/fond-badge"].every((id) => slot(p1.r, id)?.change === "unchanged"));
    const a1 = applyImport(p1.id);
    ok("K4 partiel : application réussie (Mon thème)", a1.ok === true, JSON.stringify(a1).slice(0, 200));
    const m1 = mineData();
    ok("K4 partiel : le thème ne porte que lecture et son (kit.vicons) ; flèches, fermer, lecture classique intacts", JSON.stringify(Object.keys(m1.assets.kit.vicons ?? {}).sort()) === JSON.stringify(["play", "sound"]) && !m1.assets.kit.icons, JSON.stringify(m1.assets.kit));
    drawn.partial = m1.assets.kit.vicons;
    await publishMine();
    // Site en ligne avec les deux seuls dessins : lecture et son remplacés partout, les cinq autres icônes d'origine, carré du thème.
    const pp = await publicPage();
    const recP = await survey(pp);
    checkSurvey("R1p", recP, wantMasks(drawn.partial));
    ok("R1p fond du badge non dessiné (option) : le carré du thème reste sur tous les badges", recP.flatMap((r) => r.bg).every((b) => b.image === "none"));
    ok("R1p noms des boutons identiques à ceux sans dessin", JSON.stringify(recP.map((r) => r.labels)) === JSON.stringify(globalThis.R0LABELS));
    await pp.context().close();

    // K5 : fond du badge seul (par-dessus).
    await readyKit();
    const dl2 = await get(`/admin/api/theme-kit/${THEME}`);
    const kitZip2 = path.join(DIR, "kit2.zip");
    writeFileSync(kitZip2, Buffer.from(await dl2.arrayBuffer()));
    const exp2 = await get(`/admin/api/theme-kit/${THEME}?part=icones`);
    const ico2 = path.join(DIR, "icones2.psd");
    writeFileSync(ico2, Buffer.from(await exp2.arrayBuffer()));
    const t2 = tree(ico2);
    const g2 = t2.children.find((c) => c.name === "5 · Vidéo");
    ok("K5 le kit réexporté depuis Mon thème montre les icônes dessinées (lecture, son) dans leurs cases", Boolean(g2) && g2.children.filter((c) => !c.locked).length === 8);
    const bgOnly = path.join(DIR, "icones-fond.psd");
    sim("video", kitZip2, bgOnly, "--only=fond-badge");
    const p2 = await sendPsd(bgOnly, "icones-fond.psd");
    ok("K5 fond du badge seul : redessiné (bitmap, en couleurs), les 7 icônes inchangées, y compris lecture et son déjà dessinés", slot(p2.r, "video/fond-badge")?.change === "redrawn" && (slot(p2.r, "video/fond-badge")?.files ?? []).every((f) => /\.(avif|webp)$/.test(f)) && VIDEO_IDS.filter((id) => id !== "video/fond-badge").every((id) => slot(p2.r, id)?.change === "unchanged"), JSON.stringify(p2.r?.slots.filter((s) => s.change !== "unchanged").map((s) => [s.id, s.change, s.chosen])));
    const a2 = applyImport(p2.id);
    const m2 = mineData();
    ok("K5 fond du badge seul : appliqué (kit.vicons : play, sound conservés + badge)", a2.ok === true && JSON.stringify(Object.keys(m2.assets.kit.vicons).sort()) === JSON.stringify(["badge", "play", "sound"]) && JSON.stringify(m2.assets.kit.vicons.play) === JSON.stringify(drawn.partial.play), JSON.stringify(m2.assets.kit.vicons).slice(0, 300));
    drawn.bg = m2.assets.kit.vicons;
    await publishMine();

    // K6 : les sept icônes.
    await readyKit();
    const dl3 = await get(`/admin/api/theme-kit/${THEME}`);
    const kitZip3 = path.join(DIR, "kit3.zip");
    writeFileSync(kitZip3, Buffer.from(await dl3.arrayBuffer()));
    const all7 = path.join(DIR, "icones-sept.psd");
    sim("video", kitZip3, all7, "--only=lecture,pause,boucle,son,muet,plein-ecran,quitter-plein-ecran");
    const p3 = await sendPsd(all7, "icones-sept.psd");
    ok("K6 les 7 icônes redessinées, formes en masque SVG (nettes à toute taille)", ["video/lecture", "video/pause", "video/boucle", "video/son", "video/muet", "video/plein-ecran", "video/quitter-plein-ecran"].every((id) => slot(p3.r, id)?.change === "redrawn" && slot(p3.r, id)?.chosen === "svg-mask"), JSON.stringify(p3.r?.slots.filter((s) => VIDEO_IDS.includes(s.id)).map((s) => [s.id, s.change, s.chosen])));
    ok("K6 le fond du badge, déjà dessiné, reste inchangé (le kit réexporté le contient)", slot(p3.r, "video/fond-badge")?.change === "unchanged");
    const a3 = applyImport(p3.id);
    const m3 = mineData();
    ok("K6 appliqué : 8 entrées kit.vicons, le reste du kit du thème inchangé", a3.ok === true && Object.keys(m3.assets.kit.vicons ?? {}).length === 8 && JSON.stringify(m3.assets.kit.vicons.badge) === JSON.stringify(drawn.bg.badge), JSON.stringify(Object.keys(m3.assets.kit.vicons ?? {})));
    drawn.full = m3.assets.kit.vicons;
    ok("K6 les chemins rangés sont ceux du kit (/media/kit/<empreinte>.svg|avif|webp)", Object.values(m3.assets.kit.vicons).every((i) => /^\/media\/kit\/[0-9a-f]{16}\.(svg|webp|avif)$/.test(i.svg ?? i.webp)));
    await publishMine();

    // K7 : un ancien fichier « icônes » (sans le groupe vidéo) est toujours importé.
    sim("legacy-icones", kitZip3, path.join(DIR, "icones-ancien.psd"));
    const old = await sendPsd(path.join(DIR, "icones-ancien.psd"), "icones-ancien.psd");
    ok("K7 ancien fichier « icônes » (3400 × 5770, sans groupe vidéo) : importé, 8 emplacements d'avant, aucun emplacement vidéo, rien d'erroné", old.state === "done" && old.r.ok === true && old.r.slots.length === 8 && !old.r.slots.some((s) => s.id.startsWith("video/")) && old.r.files.find((f) => f.id === "icones")?.received === true, JSON.stringify({ n: old.r?.slots.length, ok: old.r?.ok, files: old.r?.files, problem: old.r?.problem }));
    // K8 : seule la partie icônes est lue dans tous les envois ci-dessus (réimport par partie, lot 122).
    ok("K8 réimport par partie : chaque envoi n'a lu que la partie « icônes » (décor et logo : pas envoyés, inchangés)", [raw, p1, p2, p3, old].every((x) => x.r?.files.filter((f) => f.received).map((f) => f.id).join() === "icones" && x.r.files.length === 3));
  });

  /* ---- R1. Site en ligne avec les dessins ---- */
  if (run("R1") && FP_MODE !== "record") await sec("R1", async () => {
    const live = mineData();
    const vic = live?.assets?.kit?.vicons;
    ok("R1 le thème en ligne porte les 8 dessins vidéo", Object.keys(vic ?? {}).length === 8, JSON.stringify(Object.keys(vic ?? {})));
    const p = await publicPage();
    const attrs = await p.evaluate(() => [...document.documentElement.attributes].map((a) => a.name).filter((n) => n.startsWith("data-kit-vicon")).sort());
    ok("R1 <html> porte les 8 attributs data-kit-vicon-*", attrs.join() === ["data-kit-vicon-badge", "data-kit-vicon-exit-fullscreen", "data-kit-vicon-fullscreen", "data-kit-vicon-loop", "data-kit-vicon-muted", "data-kit-vicon-pause", "data-kit-vicon-play", "data-kit-vicon-sound"].join(), attrs.join());
    const rec = await survey(p);
    checkSurvey("R1", rec, wantMasks(vic));
    const bg = rec.flatMap((r) => r.bg);
    ok("R1 fond du badge dessiné : remplace le carré sur TOUS les badges (repère, ▶ + durée, bouton son), sans arrondi du thème par-dessus", bg.length > 0 && bg.every((b) => /url\(/.test(b.image) && b.radius === "0px"), JSON.stringify(bg.slice(0, 2)));
    ok("R1 noms des boutons identiques à ceux sans dessin (l'accessibilité ne dépend pas du dessin)", JSON.stringify(rec.map((r) => r.labels)) === JSON.stringify(globalThis.R0LABELS), JSON.stringify(rec.map((r) => r.labels)).slice(0, 200));
    ok("R1 tailles des icônes : le dessin tient dans un carré du plus grand côté de l'icône d'origine (▶ 12 × 14 → 14 × 14), les autres inchangées", rec.every((r, i) => r.idle.every((x, j) => { const o = globalThis.R0SIZES?.[i]?.[j]; const side = o ? Math.max(o[1], o[2]) : 0; return !o || (Math.abs(x.w - side) <= 1.5 && Math.abs(x.h - side) <= 1.5); })), JSON.stringify(rec.slice(0, 2).map((r) => r.idle.map((x) => [x.key, x.w, x.h]))) + " / " + JSON.stringify(globalThis.R0SIZES?.slice(0, 2)));
    await p.screenshot({ path: path.join(SHOTS, "R1-public-1440.png") }).catch(() => {});
    await p.context().close();
    // Tailles 1x, 2x, 3x : le masque est un SVG (net), la boîte garde sa taille, la capture a la bonne définition.
    for (const dsf of [1, 2, 3]) {
      const q = await publicPage({ deviceScaleFactor: dsf });
      const box = q.locator("[data-video-mode]").first();
      await box.scrollIntoViewIfNeeded();
      const icon = box.locator('svg[data-vicon="loop"]').first();
      const info = (await iconsOf(box)).find((x) => x.key === "loop");
      const png = await icon.screenshot({ animations: "disabled" });
      const w = png.readUInt32BE(16);
      ok(`R1 ${dsf}x : l'icône boucle est servie en SVG (net), sa boîte ${info.w} × ${info.h} px, capture de ${w} px de large`, /\.svg$/.test(maskUrl(info.mask)) && Math.abs(w - info.w * dsf) <= 3, JSON.stringify(info));
      await q.context().close();
    }
  });

  /* ---- A. Aperçu de l'éditeur ---- */
  if (run("A") && FP_MODE !== "record") await sec("A", async () => {
    setDraft(pageId, PAGE_BLOCKS());
    setBoardDraft(project.id, pageId, BOARD());
    const fr = await openEditor(page, BASE, pageId);
    await settled(page);
    await page.getByRole("button", { name: "Aperçu", exact: false }).first().click();
    await fr.waitForFunction(() => !document.documentElement.hasAttribute("data-edit-canvas"), null, { timeout: 30000 });
    await sleep(1500);
    const vic = mineData()?.assets?.kit?.vicons ?? {};
    const box = fr.locator("[data-video-mode]").first();
    await box.scrollIntoViewIfNeeded();
    const icons = await iconsOf(box);
    const play = icons.find((x) => x.key === "play");
    const loop = icons.find((x) => x.key === "loop");
    ok("A1 Aperçu : la boucle montre le ▶ et l'icône boucle DESSINÉS", maskUrl(play?.mask) === urlOf(vic.play) && maskUrl(loop?.mask) === urlOf(vic.loop), JSON.stringify([play, loop]));
    ok("A1 Aperçu : le fond du badge dessiné est posé", (await badgeBg(box)).every((b) => /url\(/.test(b.image)));
    await page.screenshot({ path: path.join(SHOTS, "A-apercu.png") }).catch(() => {});
  });
} finally {
  ok("aucune erreur JS", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
  console.log(failures === 0 ? "RESULT PASS" : `RESULT FAIL (${failures})`);
  process.exitCode = failures === 0 ? 0 : 1;
}
