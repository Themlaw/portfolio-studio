#!/usr/bin/env node
/**
 * Lot 38 « barres allégées + vraie vidéo de test » (chromium, serveur requis, base NEUVE : la vidéo de test vient du seed, une
 * connexion admin). Clics à la souris réelle sur la toile.
 *  M  Médiathèque : `video-de-test.mp4` (seed) est prête, listée, et se lit vraiment (durée, avance, image).
 *  B  Barres : plus de « Réglages » sur la barre du carrousel ni du composant Vidéo (le nom du composant choisit le composant et
 *     ouvre ses réglages à gauche) ; « Réglages » reste sur la grille et ouvre la fenêtre blanche ; plus de « Lecture » sur la
 *     barre du carrousel.
 *  V  Lecture par vidéo : barre de CHAQUE vidéo du carrousel (Boucle / Lecteur, état = ce que la page fait), enregistré dans
 *     `look.slotVideo` du bloc planche, la toile suit, et la page publiée fait pareil (parité).
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=M,B,V] [SHOTS=dossier] node scripts/e2e-barres38.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { boardDraft, draftBlocks, grid, login, openEditor, pageIdOf, q1, setBoardDraft, setDraft, settled, sleep, sql, waitFor } from "./lib/grille31d.mjs";
import { ensureVideos } from "./lib/video36.mjs";

const BASE = process.env.BASE ?? "http://localhost:3520";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(tmpdir(), "e2e-barres38");
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);
const shot = (name, clip) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), ...(clip ? { clip } : {}) }).catch(() => {});

const SEED_NAME = "video-de-test.mp4";
const seedRow = () => q1("select id, kind, status, duration, has_audio, variants, sha256 from media where original_name = ? order by id desc", SEED_NAME);

try {
  /* ---- M. Médiathèque ---- */
  const seed = seedRow();
  if (run("M")) {
    ok("M1 la vidéo de test du seed est dans la base : vidéo prête, 5 s, avec son", Boolean(seed) && seed.kind === "video" && seed.status === "ready" && Math.abs(seed.duration - 5) < 0.5 && seed.has_audio === 1, JSON.stringify(seed));
    await page.goto(`${BASE}/admin/medias`, { waitUntil: "networkidle" });
    ok("M2 elle est listée dans la médiathèque", (await page.getByText(SEED_NAME).count()) > 0 || (await page.getByRole("img", { name: /mire animée/i }).count()) > 0);
    await shot("M-mediatheque");
    const variants = JSON.parse(seed.variants);
    const mp4 = variants.files.find((f) => f.format === "mp4");
    const info = await page.evaluate(
      (src) =>
        new Promise((resolve) => {
          const v = document.createElement("video");
          v.muted = true;
          v.playsInline = true;
          v.preload = "auto";
          v.style.cssText = "position:fixed;left:20px;top:20px;width:640px;height:360px;z-index:99999;background:#000";
          v.addEventListener("error", () => resolve({ error: String(v.error?.message ?? v.error?.code) }));
          v.addEventListener("loadedmetadata", () => {
            const meta = { duration: v.duration, w: v.videoWidth, h: v.videoHeight };
            v.play().then(
              () => setTimeout(() => resolve({ ...meta, t: v.currentTime, ready: v.readyState, paused: v.paused }), 1500),
              (e) => resolve({ ...meta, playError: String(e) }),
            );
          });
          document.body.append(v);
          v.src = src;
          setTimeout(() => resolve({ timeout: true }), 30000);
        }),
      `/media/${mp4.key}`,
    );
    ok("M3 le MP4 est servi et lisible : durée > 0 (≈ 5 s), 1280 × 720, readyState ≥ 2", !info.error && !info.timeout && info.duration > 4 && info.duration < 6 && info.w === 1280 && info.h === 720 && info.ready >= 2, JSON.stringify(info));
    ok("M4 … et la lecture avance (image qui bouge)", info.t > 0.5 && info.paused === false, JSON.stringify(info));
    await shot("M-lecture-mp4");
    const poster = variants.files.find((f) => f.format === "webp");
    const pr = await page.request.get(`${BASE}/media/${poster.key}`);
    ok("M5 l'image d'attente (poster) est servie", pr.status() === 200 && /image\/webp/.test(pr.headers()["content-type"] ?? ""), String(pr.status()));
    const mr = await page.request.get(`${BASE}/media/${mp4.key}`, { headers: { range: "bytes=0-99" } });
    ok("M6 le MP4 se lit par morceaux (Range : 206)", mr.status() === 206, String(mr.status()));
  }

  const V = await ensureVideos(page, BASE);
  const pageId = pageIdOf("personnages");
  const project = q1("select id, slug from projects order by id limit 1");
  const vid = (uid, mediaId, props = {}) => ({ uid, type: "video-single", props: { mediaId, variant: "plain", ...props } });
  const own = (uid, media) => ({ uid, type: "strip", props: { source: "own", media } });
  const BOARD = () => [
    own("c1", [seed.id, V.short]),
    vid("bv", V.long, { mode: "player" }),
    { uid: "bg", type: "grid", props: { layout: "2", gap: "normal", align: "stretch", ratio: "auto", top: "gap", children: [vid("bk1", V.short, { mode: "loop" }), vid("bk2", V.long, { mode: "player" })] } },
  ];
  const reset = async () => {
    setDraft(pageId, [{ uid: "pbd", type: "project-board", props: { project: project.slug } }]);
    setBoardDraft(project.id, pageId, BOARD());
    const fr = await openEditor(page, BASE, pageId);
    await settled(page);
    return fr;
  };
  const hoverAt = async (loc) => {
    await loc.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await sleep(400);
    const b = await loc.boundingBox();
    await page.mouse.move(b.x + b.width / 2 + 4, b.y + b.height / 3);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 3 + 3, { steps: 3 });
    await sleep(300);
  };
  const barOf = (fr, uid) => fr.locator(`[data-edit-bitem="${uid}"] > .pe-bitem-bar`);
  const barShot = async (fr, uid, name) => {
    const b = await barOf(fr, uid).boundingBox();
    // Les coordonnées d'un élément de la toile sont déjà celles de la fenêtre.
    if (b) await shot(name, { x: Math.max(0, b.x - 40), y: Math.max(0, b.y - 12), width: Math.min(1400 - Math.max(0, b.x - 40), b.width + 80), height: b.height + 24 });
  };
  const lookOf = () => draftBlocks(pageId).find((b) => b.uid === "pbd")?.props.look;

  let fr;
  /* ---- B. Barres ---- */
  if (run("B")) {
    fr = await reset();
    await hoverAt(fr.locator('[data-edit-bitem="c1"]'));
    const t1 = await barOf(fr, "c1").innerText();
    ok("B1 barre du carrousel : plus de « Réglages » ni de « Lecture » (Boucle / Lecteur)", !/Réglages|Lecture|Boucle|Lecteur/.test(t1) && (await barOf(fr, "c1").locator('[data-testid="bitem-video-mode"]').count()) === 0, t1);
    ok("B2 … elle garde son nom, « Ajouter des images » et « Fond »", /Images qui défilent/.test(t1) && /Ajouter des images/.test(t1) && /Fond/.test(t1), t1);
    await barShot(fr, "c1", "B-barre-carrousel-apres");
    await hoverAt(fr.locator('[data-edit-bitem="bv"]'));
    const t2 = await barOf(fr, "bv").innerText();
    ok("B3 barre du composant Vidéo : plus de « Réglages » (sa Lecture reste, c'est sa propre vidéo)", !/Réglages/.test(t2) && /Lecture/.test(t2), t2);
    await barShot(fr, "bv", "B-barre-composant-video");
    await hoverAt(fr.locator('[data-edit-bitem="bg"]'));
    const gset = barOf(fr, "bg").locator('[data-grid-settings-button]');
    ok("B4 barre de la grille : « Réglages » reste (il ouvre la fenêtre sur la toile)", (await gset.count()) === 1 && /Réglages/.test(await gset.innerText()));
    await gset.click();
    ok("B5 … et ouvre la fenêtre blanche sur la toile", await waitFor(async () => (await fr.locator('[data-testid="gridsettings"]').count()) === 1, 10000));
    await barShot(fr, "bg", "B-barre-grille");
    await page.keyboard.press("Escape");
    // Le nom du composant choisit le composant : ses réglages s'affichent à gauche.
    await hoverAt(fr.locator('[data-edit-bitem="c1"]'));
    await barOf(fr, "c1").locator('[data-testid="bitem-name"]').click();
    ok("B6 clic sur le nom du carrousel : le panneau de gauche affiche ses réglages", await waitFor(async () => (await page.locator('[aria-label="Contenu du carrousel"]').count()) === 1, 15000) && (await page.getByRole("tab", { name: "Réglages" }).getAttribute("aria-selected")) === "true");
    ok("B7 … sans réglage de lecture pour toute la bande", (await page.getByLabel("Lecture des vidéos", { exact: true }).count()) === 0);
    await shot("B-panneau-carrousel");
    // Sélection = panneau, sans bouton : un clic dans la marge du composant Vidéo l'affiche aussi.
    await hoverAt(fr.locator('[data-edit-bitem="bv"]'));
    await barOf(fr, "bv").locator('[data-testid="bitem-name"]').click();
    ok("B8 clic sur le nom du composant Vidéo : son panneau s'affiche", await waitFor(async () => (await page.getByLabel("Lecture", { exact: true }).count()) >= 1, 15000));
  }

  /* ---- V. Lecture par vidéo ---- */
  if (run("V")) {
    fr = await reset();
    const slots = fr.locator('[data-edit-bitem="c1"] [data-edit-slot]');
    ok("V0 le carrousel montre ses deux vidéos (vidéo de test : lecteur ; animation courte : boucle)", (await slots.count()) === 2 && (await fr.locator('[data-edit-bitem="c1"] [data-video-mode="player"]').count()) === 1 && (await fr.locator('[data-edit-bitem="c1"] [data-video-mode="loop"]').count()) >= 1);
    const slugSeed = await slots.nth(0).getAttribute("data-slot-slug");
    const slugShort = await slots.nth(1).getAttribute("data-slot-slug");
    await hoverAt(slots.nth(0));
    const seg = fr.locator('[data-testid="slot-video-mode"]');
    await seg.waitFor({ timeout: 15000 });
    ok("V1 barre de la vidéo de test : « Lecture » Boucle / Lecteur, « Lecteur » pressé (ce que fait la page)", (await seg.locator("button").count()) === 2 && (await seg.locator('button[aria-pressed="true"]').innerText()) === "Lecteur");
    await shot("V-barre-image-video");
    await seg.locator('[data-slot-video-set="loop"]').click();
    ok("V2 « Boucle » : écrit dans look.slotVideo du bloc planche, au nom de CETTE vidéo", await waitFor(() => lookOf()?.slotVideo?.[slugSeed] === "loop", 30000), JSON.stringify(lookOf()));
    await settled(page);
    ok("V3 … la toile la montre en boucle, l'autre vidéo n'a pas bougé", await waitFor(async () => (await fr.locator('[data-edit-bitem="c1"] [data-edit-slot][data-video-mode="loop"], [data-edit-bitem="c1"] [data-video-mode="loop"]').count()) >= 2, 20000) && (lookOf()?.slotVideo?.[slugShort] === undefined));
    await hoverAt(fr.locator('[data-edit-bitem="c1"] [data-edit-slot]').nth(1).locator("video, .strip-frame").first());
    await fr.locator('[data-testid="slot-video-mode"]').waitFor({ timeout: 15000 });
    ok("V4 barre de l'animation courte : « Boucle » pressé", (await fr.locator('[data-testid="slot-video-mode"] button[aria-pressed="true"]').innerText()) === "Boucle");
    await fr.locator('[data-testid="slot-video-mode"] [data-slot-video-set="player"]').click();
    ok("V5 « Lecteur » sur la courte : écrit à part", await waitFor(() => lookOf()?.slotVideo?.[slugShort] === "player" && lookOf()?.slotVideo?.[slugSeed] === "loop", 30000), JSON.stringify(lookOf()));
    await settled(page);
    ok("V6 le brouillon du projet n'a pas reçu de `videoMode` (pas de réglage de bande)", boardDraft(project.id)?.find((i) => i.uid === "c1")?.props.videoMode === undefined);
    await shot("V-carrousel-apres-reglage");
    // Parité : la page publiée fait comme la toile.
    await page.getByRole("button", { name: "Publier", exact: true }).click();
    const done = await waitFor(() => sql((db) => db.prepare("select draft from pages where id = ?").get(pageId)).draft === null && boardDraft(project.id) === null, 120000);
    ok("V7 publication faite", done);
    await sleep(3000);
    const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const pub = await c.newPage();
    pub.setDefaultTimeout(30000);
    pub.on("pageerror", (e) => errors.push(`public : ${e.message}`));
    await pub.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
    const sec = pub.locator(`section[aria-labelledby="project-${project.slug}"]`);
    ok("V8 page publiée : la vidéo de test tourne en boucle, l'animation courte s'ouvre en lecteur (comme la toile)", (await sec.locator('[data-loop][data-video-mode="loop"], [data-video-mode="loop"]').count()) >= 1 && (await sec.locator('button.strip-frame[data-video-mode="player"]').count()) === 1);
    const playing = await waitFor(async () => sec.locator("video").first().evaluate((v) => !v.paused && v.currentTime > 0.2), 20000);
    ok("V9 … la boucle de la vidéo de test joue vraiment", playing);
    await sec.scrollIntoViewIfNeeded();
    await pub.screenshot({ path: path.join(SHOTS, "V-page-publiee.png") }).catch(() => {});
    await c.close();
  }
} catch (e) {
  failures++;
  console.log(`FAIL exception — ${e.stack ?? e}`);
  await shot("erreur");
}

ok("aucune erreur JavaScript", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\ntout est passé");
process.exit(failures ? 1 : 0);
