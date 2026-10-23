#!/usr/bin/env node
/**
 * Lot 62 « Cadres des photos et des vidéos, lecteur Boucle » (chromium, serveur requis, base neuve, une connexion admin).
 * Un VRAI thème avec un cadre dessiné (kit de Studio redessiné) est mis en ligne, comme l'artiste ; deux vraies vidéos (ffmpeg).
 *
 *  K  Défaut : sans réglage, aucune photo n'a le cadre du thème (public ET toile), même avec un thème qui en dessine un ; l'écran Thèmes
 *     montre « Cadre du thème sur toutes les photos », sur Non.
 *  E  Menu « Cadre » d'une photo : UN choix (Aucun · Cadre du thème · Bande de couleur), plus d'interrupteurs ; ce qui est coché est ce qui
 *     s'affiche (toile ET public) ; la bande montre Épaisseur et Couleur, pas les autres ; « Suivre le réglage du site » ; données `look.frame`.
 *  S  Réglage du site : Oui → les photos SANS choix ont le cadre du thème (toile, public) et le menu le coche ; un choix explicite passe avant ;
 *     Non → il disparaît partout.
 *  M  Anciennes données (interrupteurs : size / color) relues comme avant : même rendu pour un choix explicite.
 *  V  Vidéo : même menu, même rendu, mêmes données : vidéo seule, case de grille, composant de planche, carrousel, Planche libre.
 *  B  Lecteur « Boucle » : ne démarre jamais seule (chargement, arrivée à l'écran, défilement) ; poster ; clic = lecture, clic = pause ; boucle ;
 *     clavier ; repère ▶ ; plein écran « Lecteur » inchangé.
 *  T  Thème sans cadre dessiné : « Cadre du thème » n'est pas proposé, le réglage du site n'apparaît pas.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=K,E,…] [SHOTS=dossier] node scripts/e2e-cadres62.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { installKitFrameTheme } from "./lib/cadres62.mjs";
import { activateThemeUi, gotoThemesPage } from "./lib/theme-live.mjs";
import { boardDraft, draftBlocks, login, makeMedia, pageIdOf, q1, setBoardDraft, setDraft, sleep, sql, waitFor } from "./lib/grille31d.mjs";
import { ensureVideos } from "./lib/video36.mjs";

const BASE = process.env.BASE ?? "http://localhost:3760";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(tmpdir(), "e2e-cadres62");
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const info = (label, v) => console.log(`INFO ${label} : ${typeof v === "string" ? v : JSON.stringify(v)}`);

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256", "--autoplay-policy=no-user-gesture-required"] });
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
const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});

const M = await makeMedia(page, BASE);
const V = await ensureVideos(page, BASE);
const PHOTOS = pageIdOf("decors");
const VIDEOS = pageIdOf("personnages");
const project = q1("select id, slug from projects order by id limit 1");
if (!project) throw new Error("aucun projet dans la base de test");
const T = (s) => ({ fr: s, en: s });
const img = (uid, mediaId, props = {}) => ({ uid, type: "image", props: { mediaId, width: "wide", ...props } });
const vid = (uid, mediaId, props = {}) => ({ uid, type: "video-single", props: { mediaId, variant: "plain", mode: "player", ...props } });
const grid = (uid, children, props = {}) => ({ uid, type: "grid", props: { layout: "2", gap: "normal", align: "stretch", ratio: "auto", top: "gap", ...props, children } });

/* ---- Aides ---------------------------------------------------------------------------------------------------------- */
async function canvas() {
  const handle = await page.waitForSelector("iframe.ve-frame", { timeout: 120000 });
  const fr = await handle.contentFrame();
  await fr.waitForSelector("html[data-edit-mode]", { timeout: 180000 });
  return fr;
}
async function openEditor(pageId) {
  await page.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
  const fr = await canvas();
  await sleep(2500);
  return fr;
}
async function settled() {
  await page.waitForFunction(() => !/Enregistrement/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, { timeout: 120000 });
  await sleep(600);
}
/** Écrit le brouillon, l'ouvre dans l'éditeur, publie (la publication du produit) et attend la fin. */
async function publish(pageId, blocks, board) {
  setDraft(pageId, blocks);
  if (board) setBoardDraft(project.id, pageId, board);
  const fr = await openEditor(pageId);
  await settled();
  await page.getByRole("button", { name: "Publier", exact: true }).click();
  const confirm = page.locator("dialog[open]").getByRole("button", { name: "Mettre en ligne" });
  if (await confirm.waitFor({ timeout: 4000 }).then(() => true, () => false)) await confirm.click();
  const done = await waitFor(() => sql((db) => db.prepare("select draft from pages where id = ?").get(pageId)).draft === null && (!board || boardDraft(project.id) === null), 150000);
  await sleep(2500);
  // La publication renomme les composants : on reprend les mêmes identifiants dans un brouillon identique pour la toile.
  setDraft(pageId, blocks);
  if (board) setBoardDraft(project.id, pageId, board);
  void fr;
  return { done };
}
const lookOf = (pageId, uid) => {
  const find = (list) => {
    for (const b of list) {
      if (b.uid === uid) return b;
      const inner = find(b.props?.children ?? []);
      if (inner) return inner;
    }
    return null;
  };
  return find(draftBlocks(pageId))?.props.look;
};
const publicPage = async (urlPath, options = {}) => {
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  const p = await c.newPage();
  p.setDefaultTimeout(30000);
  p.on("pageerror", (e) => errors.push(`public : ${e.message}`));
  await p.goto(`${BASE}${urlPath}`, { waitUntil: "networkidle" });
  await sleep(800);
  return p;
};

/**
 * Ce que montre chaque photo / vidéo du document : « theme » (le cadre dessiné : border-image), « band » (bordure de couleur), « none ».
 * `sel` vise l'élément qui porte la bordure.
 */
const shown = (doc, sel) =>
  doc.evaluate((s) => {
    return [...document.querySelectorAll(s)].map((el) => {
      const cs = getComputedStyle(el);
      const w = parseFloat(cs.borderTopWidth);
      const drawn = cs.borderImageSource !== "none";
      return { kind: drawn && w > 0 ? "theme" : w > 0 && cs.borderTopStyle === "solid" ? "band" : "none", w, color: cs.borderTopColor };
    });
  }, sel);
const PHOTO = "figure.block-image .media-frame";

/* ---- Photos de départ ------------------------------------------------------------------------------------------------ */
const photoBlocks = () => [
  img("p1", M.paysage),
  img("p2", M.carre, { look: { frame: { kind: "none" } } }),
  img("p3", M.paysage, { look: { frame: { kind: "theme" } } }),
  img("p4", M.carre, { look: { frame: { kind: "band", width: "epais", color: "primary" } } }),
  img("p5", M.paysage, { look: { frame: { kind: "band", width: "fin" } } }),
];

/* ============================================================================================================================
 * K. Défaut : pas de cadre du thème sans choix
 * ========================================================================================================================== */
let kitOk = false;
if (run("K") || run("E") || run("S") || run("M") || run("V")) {
  await section("K0", async () => {
    // Base déjà préparée (relance de la suite) : le thème en ligne dessine déjà un cadre, rien à refaire.
    const active = q1("select value from settings where key = 'activeThemeId'")?.value;
    const data = active ? q1("select data from themes where id = ?", JSON.parse(active))?.data : null;
    if (data && JSON.parse(data).assets?.kit?.frame) {
      kitOk = true;
      return info("thème avec cadre dessiné déjà en ligne", JSON.parse(active));
    }
    const id = await installKitFrameTheme(page, BASE);
    info("thème avec cadre dessiné mis en ligne", id);
    kitOk = true;
  });
}

if (run("K"))
  await section("K", async () => {
    const { done } = await publish(PHOTOS, photoBlocks());
    ok("K0 page de photos publiée", done);
    const pub = await publicPage("/fr/decors");
    ok("K1 le thème en ligne dessine un cadre (le site le porte)", await pub.evaluate(() => document.documentElement.hasAttribute("data-kit-frame")));
    const s = await shown(pub, PHOTO);
    info("K public", s.map((x) => x.kind));
    ok("K2 public : la photo SANS choix n'a PAS le cadre du thème (même avec un thème qui en dessine un)", s[0]?.kind === "none", JSON.stringify(s[0]));
    ok("K3 public : chaque choix explicite est exactement ce qu'il dit (Aucun, Cadre du thème, Bande épaisse, Bande fine)", [s[1]?.kind, s[2]?.kind, s[3]?.kind, s[4]?.kind].join() === "none,theme,band,band", JSON.stringify(s));
    ok("K3b la bande Épais est plus épaisse que la Fine, et prend la couleur choisie", s[3].w > s[4].w && s[4].w === 2, JSON.stringify([s[3], s[4]]));
    await shot(pub, "k-public");
    await pub.context().close();
    // Toile.
    const fr = await openEditor(PHOTOS);
    const c = await shown(fr, PHOTO);
    ok("K4 toile : même rendu que le public (parité)", c.map((x) => x.kind).join() === s.map((x) => x.kind).join(), JSON.stringify(c.map((x) => x.kind)));
    // Écran Thèmes : le réglage, sur Non.
    await gotoThemesPage(page, BASE);
    const panel = page.locator('[data-testid="frame-all-setting"]');
    ok("K5 écran Thèmes : « Cadre du thème sur toutes les photos » est proposé (le thème en ligne dessine un cadre)", await panel.isVisible() && /Cadre du thème sur toutes les photos/.test((await panel.textContent()) ?? ""));
    ok("K5b … sur « Non » (non par défaut, y compris pour un site existant)", (await panel.locator('[data-testid="frame-all-off"]').getAttribute("aria-checked")) === "true" && (await panel.locator('[data-testid="frame-all-on"]').getAttribute("aria-checked")) === "false");
    ok("K5c … avec une phrase simple", /photo par photo/.test((await panel.textContent()) ?? "") && /Cadre/.test((await panel.textContent()) ?? ""));
    await shot(page, "k-ecran-themes");
  });

/* ============================================================================================================================
 * E. Le menu « Cadre » : un seul choix
 * ========================================================================================================================== */
const frameBtn = (fr) => fr.locator('.pe-tools [data-testid="frame-button"]');
async function openMenu(fr, uid, what = "photo") {
  const el = fr.locator(`[data-edit-block="${uid}"] .media-frame, [data-edit-block="${uid}"] .media-frame[data-kind="video"]`).first();
  await el.scrollIntoViewIfNeeded();
  await el.click();
  await sleep(500);
  const dlg = fr.getByRole("dialog", { name: `Cadre de la ${what}` });
  if (!(await dlg.isVisible().catch(() => false))) {
    if (await frameBtn(fr).count()) await frameBtn(fr).click();
    else await fr.locator('[data-testid="cellbar"] [data-cb="frame"]').click();
  }
  await dlg.waitFor({ timeout: 15000 });
  return dlg;
}
const kindBtn = (dlg, k) => dlg.locator(`[data-frame-kind="${k}"]`);
const widthBtn = (dlg, w) => dlg.locator(`[data-frame-width="${w}"]`);
const checked = async (loc) => (await loc.getAttribute("aria-checked")) === "true";

if (run("E"))
  await section("E", async () => {
    setDraft(PHOTOS, [img("e1", M.paysage), img("e2", M.carre)]);
    const fr = await openEditor(PHOTOS);
    const E1 = '[data-edit-block="e1"] .media-frame';
    const dlg = await openMenu(fr, "e1");
    await shot(page, "e-menu-aucun");
    ok("E1 le menu : trois boutons radio « Aucun · Cadre du thème · Bande de couleur » (le thème dessine un cadre)", (await dlg.locator("[data-frame-kind]").allTextContents()).map((t) => t.trim()).join(" · ") === "Aucun · Cadre du thème · Bande de couleur");
    ok("E2 plus d'interrupteurs « Cadre » / « Sans cadre »", (await dlg.getByRole("switch").count()) === 0 && (await dlg.locator('[data-testid="frame-switch"], [data-testid="frame-none"]').count()) === 0 && !/Sans cadre/.test((await dlg.textContent()) ?? ""));
    ok("E3 sans choix et sans réglage du site : « Aucun » est coché, aucune épaisseur ni couleur", (await checked(kindBtn(dlg, "none"))) && !(await checked(kindBtn(dlg, "theme"))) && !(await checked(kindBtn(dlg, "band"))) && (await dlg.locator("[data-frame-width]").count()) === 0 && (await dlg.locator("[data-frame-color]").count()) === 0);
    ok("E3b … et la photo n'a aucun cadre", (await shown(fr, E1))[0].kind === "none");

    // Cadre du thème : le cadre dessiné, pas un filet.
    await kindBtn(dlg, "theme").click();
    ok("E4 « Cadre du thème » : coché, la toile montre le cadre dessiné (border-image), pas de bordure de couleur", await waitFor(async () => (await shown(fr, E1))[0].kind === "theme", 30000) && (await checked(kindBtn(dlg, "theme"))) && !(await checked(kindBtn(dlg, "none"))));
    ok("E4b enregistré : look.frame = { kind: theme }", await waitFor(() => JSON.stringify(lookOf(PHOTOS, "e1")?.frame) === '{"kind":"theme"}', 30000), JSON.stringify(lookOf(PHOTOS, "e1")));
    ok("E4c épaisseur et couleur n'apparaissent pas pour le cadre du thème", (await dlg.locator("[data-frame-width], [data-frame-color]").count()) === 0);
    await shot(page, "e-menu-theme");

    // Bande de couleur : REMPLACE le cadre du thème (un seul à la fois).
    await kindBtn(dlg, "band").click();
    let s;
    ok("E5 « Bande de couleur » : coché ; le cadre du thème a DISPARU et un filet de couleur le remplace", await waitFor(async () => { s = (await shown(fr, E1))[0]; return s.kind === "band" && s.w > 2; }, 30000) && (await checked(kindBtn(dlg, "band"))) && !(await checked(kindBtn(dlg, "theme"))), JSON.stringify(s));
    ok("E5b Épaisseur (Fin / Moyen / Épais, Moyen coché) et Couleur apparaissent", (await dlg.locator("[data-frame-width]").allTextContents()).join() === "Fin,Moyen,Épais" && (await checked(widthBtn(dlg, "moyen"))) && (await dlg.locator("[data-frame-color]").count()) >= 5);
    ok("E5c enregistré : look.frame = { kind: band, width: moyen }", await waitFor(() => JSON.stringify(lookOf(PHOTOS, "e1")?.frame) === '{"kind":"band","width":"moyen"}', 30000), JSON.stringify(lookOf(PHOTOS, "e1")));
    await shot(page, "e-menu-bande");
    await widthBtn(dlg, "epais").click();
    ok("E6 Épais : bordure plus épaisse", await waitFor(async () => (await shown(fr, E1))[0].w > s.w, 30000));
    await widthBtn(dlg, "fin").click();
    ok("E6b Fin : 2 px", await waitFor(async () => (await shown(fr, E1))[0].w === 2, 30000));
    await dlg.locator('[data-frame-color="tertiary"]').click();
    ok("E7 couleur « Ornements » : enregistrée comme référence du thème (pas un code)", await waitFor(() => lookOf(PHOTOS, "e1")?.frame?.color === "tertiary" && lookOf(PHOTOS, "e1")?.frame?.width === "fin", 30000), JSON.stringify(lookOf(PHOTOS, "e1")));

    // Aucun : ni cadre du thème, ni bande — et la bande se retrouve quand on revient.
    await kindBtn(dlg, "none").click();
    ok("E8 « Aucun » : plus aucun cadre, ni filet ni cadre du thème", await waitFor(async () => (await shown(fr, E1))[0].kind === "none", 30000) && (await checked(kindBtn(dlg, "none"))));
    ok("E8b enregistré : look.frame = { kind: none }", await waitFor(() => JSON.stringify(lookOf(PHOTOS, "e1")?.frame) === '{"kind":"none"}', 30000), JSON.stringify(lookOf(PHOTOS, "e1")));
    await kindBtn(dlg, "band").click();
    ok("E9 revenir à la bande retrouve l'épaisseur et la couleur d'avant (Fin, Ornements)", await waitFor(() => lookOf(PHOTOS, "e1")?.frame?.width === "fin" && lookOf(PHOTOS, "e1")?.frame?.color === "tertiary", 30000), JSON.stringify(lookOf(PHOTOS, "e1")));

    // Suivre le réglage du site.
    const follow = dlg.locator('[data-testid="frame-follow-site"]');
    ok("E10 « Suivre le réglage du site » est proposé quand un choix est posé", await follow.isVisible());
    await follow.click();
    ok("E10b … il retire le choix (look vide) et la photo suit le site (Non : aucun cadre)", await waitFor(async () => !lookOf(PHOTOS, "e1")?.frame && (await shown(fr, E1))[0].kind === "none" && (await dlg.locator('[data-testid="frame-follow-site"]').count()) === 0, 30000));
    await page.keyboard.press("Escape");

    // Annuler / Rétablir.
    await settled();
    const d2 = await openMenu(fr, "e2");
    await kindBtn(d2, "theme").click();
    ok("E11 deuxième photo : cadre du thème posé", await waitFor(async () => (await shown(fr, '[data-edit-block="e2"] .media-frame'))[0].kind === "theme", 30000));
    await page.keyboard.press("Escape");
    await settled();
    await page.locator('button[aria-label="Défaire"]').click();
    ok("E11b Annuler : le cadre disparaît", await waitFor(async () => (await shown(fr, '[data-edit-block="e2"] .media-frame'))[0].kind === "none" && !lookOf(PHOTOS, "e2")?.frame, 30000), JSON.stringify(lookOf(PHOTOS, "e2")));
  });

/* ============================================================================================================================
 * S. Réglage du site
 * ========================================================================================================================== */
async function setFrameAll(on) {
  await gotoThemesPage(page, BASE);
  const panel = page.locator('[data-testid="frame-all-setting"]');
  await panel.locator(`[data-testid="frame-all-${on ? "on" : "off"}"]`).click();
  await waitFor(() => Boolean(q1("select value from settings where key = 'themeFrameAll'")) === on, 20000);
  await sleep(1200);
}

if (run("S"))
  await section("S", async () => {
    const { done } = await publish(PHOTOS, photoBlocks());
    ok("S0 page de photos publiée", done);
    await setFrameAll(true);
    try {
    ok("S1 réglage enregistré (settings.themeFrameAll = true)", q1("select value from settings where key = 'themeFrameAll'")?.value === "true");
    const pub = await publicPage("/fr/decors");
    const s = await shown(pub, PHOTO);
    info("S public (Oui)", s.map((x) => x.kind));
    ok("S2 « Oui » : la photo SANS choix a le cadre du thème (public)", s[0]?.kind === "theme", JSON.stringify(s[0]));
    ok("S3 … un choix explicite passe avant : Aucun reste sans cadre, la bande reste une bande, le cadre du thème reste", [s[1]?.kind, s[2]?.kind, s[3]?.kind, s[4]?.kind].join() === "none,theme,band,band", JSON.stringify(s.map((x) => x.kind)));
    await shot(pub, "s-public-oui");
    await pub.context().close();
    const fr = await openEditor(PHOTOS);
    const c = await shown(fr, PHOTO);
    ok("S4 toile : même rendu (parité)", c.map((x) => x.kind).join() === s.map((x) => x.kind).join(), JSON.stringify(c.map((x) => x.kind)));
    const dlg = await openMenu(fr, "p1");
    ok("S5 le menu d'une photo sans choix COCHE « Cadre du thème » (ce qui s'affiche)", (await checked(kindBtn(dlg, "theme"))) && !(await checked(kindBtn(dlg, "none"))));
    await kindBtn(dlg, "none").click();
    ok("S6 « Aucun » sur cette photo : elle perd le cadre, malgré le réglage du site", await waitFor(async () => (await shown(fr, '[data-edit-block="p1"] .media-frame'))[0].kind === "none" && lookOf(PHOTOS, "p1")?.frame?.kind === "none", 30000), JSON.stringify(lookOf(PHOTOS, "p1")));
    await dlg.locator('[data-testid="frame-follow-site"]').click();
    ok("S7 « Suivre le réglage du site » : elle retrouve le cadre du thème", await waitFor(async () => (await shown(fr, '[data-edit-block="p1"] .media-frame'))[0].kind === "theme" && !lookOf(PHOTOS, "p1")?.frame, 30000));
    await page.keyboard.press("Escape");
    await shot(page, "s-menu-oui");
    } finally {
      await setFrameAll(false);
    }
    const pub2 = await publicPage("/fr/decors");
    const s2 = await shown(pub2, PHOTO);
    ok("S8 « Non » : le cadre disparaît des photos sans choix, rien d'autre ne bouge", s2.map((x) => x.kind).join() === "none,none,theme,band,band", JSON.stringify(s2.map((x) => x.kind)));
    await pub2.context().close();
  });

/* ============================================================================================================================
 * M. Anciennes données
 * ========================================================================================================================== */
if (run("M"))
  await section("M", async () => {
    if (q1("select value from settings where key = 'themeFrameAll'")) await setFrameAll(false);
    // Les anciens réglages (interrupteurs : size / color) dans un brouillon : lus comme avant sur la toile, puis publiés et rendus comme avant.
    // (La réécriture des données existantes au démarrage du serveur est couverte par test-cadres62 et par le journal du serveur.)
    const legacy = [
      img("m1", M.paysage, { look: { frame: { size: "none" } } }),
      img("m2", M.paysage, { look: { frame: { size: "thick", color: "primary" } } }),
      img("m3", M.carre, { look: { frame: { size: "thin" } } }),
      img("m4", M.carre, { look: { frame: { size: "medium", color: "#12ab34" } } }),
      img("m5", M.paysage),
    ];
    setDraft(PHOTOS, legacy);
    const fr = await openEditor(PHOTOS);
    const c = await shown(fr, PHOTO);
    info("M toile", c);
    ok("M1 toile : « Sans cadre » ancien = aucun cadre ; Épais + couleur du thème = bande épaisse ; Fin = 2 px ; Moyen + couleur libre = rgb(18, 171, 52) ; sans réglage = aucun", c[0]?.kind === "none" && c[1]?.kind === "band" && c[1].w > 6 && c[2]?.kind === "band" && c[2].w === 2 && c[3]?.kind === "band" && c[3].color === "rgb(18, 171, 52)" && c[3].w > 2 && c[3].w < c[1].w && c[4]?.kind === "none", JSON.stringify(c));
    const dlg = await openMenu(fr, "m2");
    ok("M2 le menu relit un ancien choix : « Bande de couleur », Épais, couleur « Boutons et liens »", (await checked(kindBtn(dlg, "band"))) && (await checked(widthBtn(dlg, "epais"))) && (await checked(dlg.locator('[data-frame-color="primary"]'))));
    await page.keyboard.press("Escape");
    await settled();
    await page.getByRole("button", { name: "Publier", exact: true }).click();
    const confirm = page.locator("dialog[open]").getByRole("button", { name: "Mettre en ligne" });
    if (await confirm.waitFor({ timeout: 4000 }).then(() => true, () => false)) await confirm.click();
    ok("M3 publication", await waitFor(() => sql((db) => db.prepare("select draft from pages where id = ?").get(PHOTOS)).draft === null, 150000));
    await sleep(2500);
    const stored = sql((db) => db.prepare("select props from blocks where page_id = ? order by position").all(PHOTOS)).map((r) => JSON.parse(r.props).look?.frame);
    info("M publié", stored);
    const pub = await publicPage("/fr/decors");
    const s = await shown(pub, PHOTO);
    ok("M4 public : même rendu que la toile", s.map((x) => `${x.kind}:${x.w}:${x.color}`).join() === c.map((x) => `${x.kind}:${x.w}:${x.color}`).join(), JSON.stringify(s));
    await pub.context().close();
  });

/* ============================================================================================================================
 * V. La vidéo a le même menu, le même rendu, les mêmes données
 * ========================================================================================================================== */
const FREE_VIDEO = (frame) => ({ uid: "fv", type: "free-board", props: { format: "3:2", phone: "scale", items: [{ id: "v1", media: V.short, x: 10, y: 10, w: 40, rot: 0, z: 0, ...(frame ? { frame } : {}) }, { id: "i1", media: M.paysage, x: 55, y: 10, w: 35, rot: 0, z: 1, ...(frame ? { frame } : {}) }] } });
const VID = ".media-frame[data-kind=\"video\"]";
const STRIPVID = ".strip-rail .strip-frame[data-video-mode] .strip-media .media-frame";

if (run("V"))
  await section("V", async () => {
    // 1. Rendu public et toile : vidéo seule (Boucle et Lecteur), case de grille, planche, carrousel, Planche libre.
    const FR_BAND = { kind: "band", width: "epais", color: "primary" };
    const blocks = [
      vid("v1", V.short, { mode: "loop", look: { frame: FR_BAND } }),
      vid("v2", V.long, { mode: "player", look: { frame: { kind: "theme" } } }),
      vid("v3", V.long, { mode: "player" }),
      vid("v4", V.short, { mode: "loop", look: { frame: { kind: "none" } } }),
      grid("g1", [vid("gv1", V.short, { mode: "loop", look: { frame: FR_BAND } }), img("gi1", M.carre, { look: { frame: FR_BAND } })]),
      FREE_VIDEO(FR_BAND),
      { uid: "pbd", type: "project-board", props: { project: project.slug, look: { slotFrame: { "c1-p0": FR_BAND, "c1-p1": { kind: "theme" } } } } },
    ];
    const board = [
      { uid: "c1", type: "strip", props: { source: "own", media: [V.short, V.long] } },
      vid("bv1", V.long, { variant: "plain", mode: "player", look: { frame: { kind: "theme" } } }),
      vid("bv2", V.short, { variant: "plain", mode: "loop", look: { frame: FR_BAND } }),
    ];
    const { done } = await publish(VIDEOS, blocks, board);
    ok("V0 page de vidéos publiée", done);
    const pub = await publicPage("/fr/personnages");
    const kinds = (a) => a.map((x) => x.kind).join();
    const vs = await shown(pub, VID);
    info("V public vidéos", vs.map((x) => x.kind));
    ok("V1 vidéo seule : Bande épaisse (Boucle), Cadre du thème (Lecteur), sans choix = aucun, Aucun = aucun", kinds(vs.slice(0, 4)) === "band,theme,none,none" && vs[0].w > 6, JSON.stringify(vs.slice(0, 4)));
    ok("V2 la bande de la vidéo est la même que celle d'une photo (épaisseur et couleur)", vs[0].color === (await shown(pub, 'figure.block-image .media-frame')).find((x) => x.kind === "band")?.color);
    ok("V3 case de grille : la vidéo a sa bande", vs[4]?.kind === "band" && vs[4].w === vs[0].w, JSON.stringify(vs[4]));
    const free = await shown(pub, ".free-item .media-frame");
    ok("V4 Planche libre : la vidéo ET la photo ont le même cadre", free.length === 2 && kinds(free) === "band,band" && free[0].w === free[1].w, JSON.stringify(free));
    const strip = await shown(pub, STRIPVID);
    info("V public carrousel", strip.map((x) => x.kind));
    ok("V5 carrousel : la vidéo en Boucle a sa bande, la vidéo en Lecteur (image d'attente) le cadre du thème", strip.length >= 2 && strip[0].kind === "band" && strip.some((x) => x.kind === "theme"), JSON.stringify(strip));
    ok("V6 composants Vidéo de la planche : Cadre du thème (Lecteur) puis bande (Boucle), comme sur une page", kinds(vs.slice(-2)) === "theme,band", kinds(vs));
    await shot(pub, "v-public");
    await pub.context().close();
    const fr = await openEditor(VIDEOS);
    const cv = await shown(fr, VID);
    ok("V7 toile : mêmes cadres que le public (parité)", kinds(cv.slice(0, 5)) === kinds(vs.slice(0, 5)), kinds(cv));

    // 2. Le menu de la vidéo seule : mêmes choix que la photo.
    const dlg = await openMenu(fr, "v3", "vidéo");
    ok("V8 menu de la vidéo seule : « Aucun · Cadre du thème · Bande de couleur », Aucun coché", (await dlg.locator("[data-frame-kind]").allTextContents()).map((t) => t.trim()).join(" · ") === "Aucun · Cadre du thème · Bande de couleur" && (await checked(kindBtn(dlg, "none"))));
    await kindBtn(dlg, "band").click();
    ok("V9 Bande de couleur sur la vidéo : enregistrée comme pour une photo { kind: band, width: moyen }, visible sur la toile", await waitFor(async () => JSON.stringify(lookOf(VIDEOS, "v3")?.frame) === '{"kind":"band","width":"moyen"}' && (await shown(fr, '[data-edit-block="v3"] .media-frame[data-kind="video"]'))[0].kind === "band", 30000), JSON.stringify(lookOf(VIDEOS, "v3")));
    await widthBtn(dlg, "epais").click();
    await kindBtn(dlg, "theme").click();
    ok("V10 Cadre du thème sur la vidéo : le cadre dessiné remplace la bande", await waitFor(async () => (await shown(fr, '[data-edit-block="v3"] .media-frame[data-kind="video"]'))[0].kind === "theme" && lookOf(VIDEOS, "v3")?.frame?.kind === "theme", 30000));
    await shot(page, "v-menu-video");
    await page.keyboard.press("Escape");

    // 3. Case de grille.
    const gd = await openMenu(fr, "gv1", "vidéo");
    ok("V11 case de grille : la barre de la vidéo a le même menu", (await gd.locator("[data-frame-kind]").count()) === 3);
    await kindBtn(gd, "none").click();
    ok("V11b … « Aucun » : enregistré sur la case, la vidéo perd sa bande", await waitFor(async () => lookOf(VIDEOS, "gv1")?.frame?.kind === "none" && (await shown(fr, '[data-edit-block="gv1"] .media-frame[data-kind="video"]'))[0].kind === "none", 30000), JSON.stringify(lookOf(VIDEOS, "gv1")));
    await page.keyboard.press("Escape");

    // 4. Planche libre : la barre de la vidéo.
    const fvVideo = fr.locator('[data-edit-block="fv"] [data-free-item="v1"]');
    await fvVideo.scrollIntoViewIfNeeded();
    await fvVideo.click();
    const fbar = fr.getByTestId("free-bar");
    await fbar.waitFor({ timeout: 15000 });
    ok("V12 Planche libre : la barre de la vidéo a le bouton « Cadre »", (await fbar.getByTestId("free-frame-button").count()) === 1);
    await fbar.getByTestId("free-frame-button").click();
    const fdlg = fr.getByTestId("free-frame");
    await fdlg.waitFor();
    ok("V12b … même menu (trois choix)", (await fdlg.locator("[data-frame-kind]").count()) === 3 && (await checked(kindBtn(fdlg, "band"))));
    await kindBtn(fdlg, "none").click();
    ok("V12c … le choix est écrit sur CETTE vidéo seulement", await waitFor(() => {
      const items2 = draftBlocks(VIDEOS).find((b) => b.uid === "fv")?.props.items ?? [];
      return items2.find((i) => i.id === "v1")?.frame?.kind === "none" && items2.find((i) => i.id === "i1")?.frame?.kind === "band";
    }, 30000));
    await page.keyboard.press("Escape");
    await settled();

    // 5. Carrousel : la barre de la vidéo.
    const slot = fr.locator('[data-edit-block="pbd"] [data-edit-slot][data-slot-slug="c1-p0"]').first();
    await slot.scrollIntoViewIfNeeded();
    await slot.hover();
    const bar = fr.locator('.pe-slot-tools[aria-label="Image de la planche"]');
    await bar.waitFor({ timeout: 15000 });
    const sbtn = bar.locator('[data-testid="slot-frame-button"]');
    ok("V13 carrousel : la barre d'une VIDÉO a le bouton « Cadre »", (await sbtn.count()) === 1 && /vidéo/.test((await sbtn.getAttribute("title")) ?? ""));
    await sbtn.click();
    const sdlg = fr.getByRole("dialog", { name: "Cadre de la vidéo" });
    await sdlg.waitFor({ timeout: 15000 });
    ok("V13b … même menu, la bande déjà posée est cochée", (await sdlg.locator("[data-frame-kind]").count()) === 3 && (await checked(kindBtn(sdlg, "band"))));
    await kindBtn(sdlg, "theme").click();
    ok("V13c … enregistré dans look.slotFrame[slug] du bloc planche", await waitFor(() => lookOf(VIDEOS, "pbd")?.slotFrame?.["c1-p0"]?.kind === "theme", 30000), JSON.stringify(lookOf(VIDEOS, "pbd")));
    await page.keyboard.press("Escape");

    // 6. Composant de planche (suite du projet).
    await settled();
    await sleep(1500);
    const bi = fr.locator('[data-edit-block="pbd"] [data-edit-bitem][data-edit-bitem-type="video-single"]').first();
    // La toile se redessine juste après un réglage : un nouvel essai si l'élément a été remplacé sous nos yeux.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await bi.scrollIntoViewIfNeeded();
        await bi.hover();
        await bi.click({ position: { x: 20, y: 20 } }).catch(() => {});
        break;
      } catch {
        await sleep(1500);
      }
    }
    const bbtn = fr.locator('[data-testid="bitem-frame-button"]').first();
    ok("V14 composant Vidéo de la planche : la barre a le bouton « Cadre »", await waitFor(async () => (await bbtn.count()) >= 1, 20000));
    await bbtn.click();
    const bdlg = fr.getByRole("dialog", { name: "Cadre de la vidéo" });
    await bdlg.waitFor({ timeout: 15000 });
    ok("V14b … même menu", (await bdlg.locator("[data-frame-kind]").count()) === 3);
    await kindBtn(bdlg, "none").click();
    ok("V14c … écrit dans le composant de la planche (look.frame) et visible", await waitFor(() => {
      const b = boardDraft(project.id) ?? [];
      return b.some((x) => x.type === "video-single" && x.props.look?.frame?.kind === "none");
    }, 30000), JSON.stringify(boardDraft(project.id)));
    await page.keyboard.press("Escape");
  });

/* ============================================================================================================================
 * B. Lecteur « Boucle »
 * ========================================================================================================================== */
const vstate = (el) => el.evaluate((e) => { const v = e.querySelector("video"); return { paused: v.paused, muted: v.muted, loop: v.loop, t: v.currentTime, poster: v.getAttribute("poster") ?? "", played: v.played.length, ready: v.readyState }; });
const playing = (el, timeout = 15000) => waitFor(async () => { const s = await vstate(el); return !s.paused && s.t > 0.2; }, timeout);
const isPaused = (el, timeout = 8000) => waitFor(async () => (await vstate(el)).paused, timeout);

if (run("B"))
  await section("B", async () => {
    const blocks = [
      vid("l1", V.short, { mode: "loop", title: T("Boucle essai") }),
      grid("lg", [vid("lg1", V.short, { mode: "loop" }), vid("lg2", V.long, { mode: "player" })]),
      { uid: "lfb", type: "free-board", props: { format: "3:2", phone: "scale", items: [{ id: "v1", media: V.short, x: 10, y: 10, w: 40, rot: 0, z: 0 }] } },
      vid("lp", V.long, { mode: "player" }),
      { uid: "pbd", type: "project-board", props: { project: project.slug } },
    ];
    const board = [{ uid: "c1", type: "strip", props: { source: "own", media: [V.short], videoMode: "loop" } }, vid("bl", V.short, { variant: "plain", mode: "loop" })];
    const { done } = await publish(VIDEOS, blocks, board);
    ok("B0 page publiée", done);
    const p = await publicPage("/fr/personnages");
    // Les Boucles : vidéo seule, case de grille, carrousel, composant de planche (repère data-video-mode) et Planche libre (boîte vidéo de l'image libre).
    const loops = p.locator('[data-video-mode="loop"], .free-item .media-frame[data-kind="video"]');
    const n = await loops.count();
    ok("B1 la page a plusieurs Boucles (vidéo seule, case de grille, Planche libre, carrousel, composant de planche)", n >= 5, String(n));
    // Rien ne démarre : ni au chargement, ni en arrivant à l'écran, ni en défilant.
    await sleep(2500);
    let states = await Promise.all(Array.from({ length: n }, (_, i) => vstate(loops.nth(i))));
    ok("B2 au chargement : TOUTES les Boucles sont à l'arrêt, sur leur image d'attente (aucune lecture commencée)", states.every((s) => s.paused && s.t === 0 && s.played === 0), JSON.stringify(states));
    for (let i = 0; i < n; i++) {
      await loops.nth(i).scrollIntoViewIfNeeded();
      await sleep(1200);
    }
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(1500);
    await p.evaluate(() => window.scrollTo(0, 0));
    await sleep(1200);
    states = await Promise.all(Array.from({ length: n }, (_, i) => vstate(loops.nth(i))));
    ok("B3 après être arrivées à l'écran et avoir défilé : aucune n'a démarré", states.every((s) => s.paused && s.t === 0 && s.played === 0), JSON.stringify(states));
    ok("B4 chaque Boucle montre une image d'attente (poster)", states.every((s) => s.poster.length > 4), JSON.stringify(states.map((s) => s.poster)));
    const first = loops.first();
    await first.scrollIntoViewIfNeeded();
    const click = first.locator(".loop-click");
    ok("B5 un indice de lecture (▶) discret est visible à l'arrêt", (await click.locator('.loop-mark[data-mark="play"]').count()) === 1 && (await click.locator(".loop-mark").isVisible()));
    ok("B5b le cadre est un bouton nommé et focusable", /Relancer|Lire/.test((await click.getAttribute("aria-label")) ?? "") && (await click.getAttribute("role")) === "button" && (await click.getAttribute("tabindex")) === "0");
    await shot(p, "b-arret");
    // Un clic lance, un clic met en pause, elle boucle.
    await click.click();
    ok("B6 un clic LANCE la lecture (muette, en boucle)", (await playing(first)) && (await vstate(first)).muted && (await vstate(first)).loop);
    ok("B6b … le repère passe à « pause »", (await click.locator('.loop-mark[data-mark="pause"]').count()) === 1 && (await click.getAttribute("data-loop")) === "playing");
    const dur = await first.evaluate((e) => e.querySelector("video").duration);
    const wrapped = await waitFor(async () => (await vstate(first)).t < 1.5 && (await first.evaluate((e) => e.querySelector("video").currentTime)) >= 0 && (await first.evaluate((e) => e.querySelector("video").played.length)) >= 1, 20000);
    ok("B7 elle tourne tant qu'elle joue (boucle de " + dur.toFixed(1) + " s)", wrapped && (await vstate(first)).paused === false);
    await sleep((dur + 1.5) * 1000);
    ok("B7b … et reste en lecture après la fin d'un tour (elle reboucle)", !(await vstate(first)).paused);
    await shot(p, "b-lecture");
    await click.click();
    ok("B8 un second clic met en PAUSE", await isPaused(first));
    const t0 = (await vstate(first)).t;
    await sleep(1500);
    ok("B8b … elle reste arrêtée", (await vstate(first)).t === t0 && (await vstate(first)).paused);
    // Clavier.
    await click.focus();
    await p.keyboard.press("Enter");
    ok("B9 Entrée : lecture", await playing(first));
    await p.keyboard.press("Space");
    ok("B9b Espace : pause", await isPaused(first));
    await p.keyboard.press("Space");
    ok("B9c Espace : lecture", await playing(first));
    await p.keyboard.press("Enter");
    ok("B9d Entrée : pause", await isPaused(first));
    // Hors champ, une Boucle lancée se met en pause (elle ne tourne pas hors de l'écran), les autres restent à l'arrêt.
    await click.click();
    await playing(first);
    await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    ok("B10 une Boucle lancée se met en pause hors de l'écran", await isPaused(first, 8000));
    states = await Promise.all(Array.from({ length: n }, (_, i) => vstate(loops.nth(i))));
    ok("B10b … et les autres Boucles de la page n'ont jamais démarré", states.slice(1).every((s) => s.played === 0), JSON.stringify(states.slice(1)));
    // Chaque type de Boucle se lance au clic : grille, planche libre, carrousel, planche.
    for (let i = 1; i < n; i++) {
      const box = loops.nth(i);
      await box.scrollIntoViewIfNeeded();
      await box.locator('.loop-click, button.loop-click').first().click();
      ok(`B11 Boucle n°${i + 1} : un clic la lance`, await playing(box));
      await box.locator('.loop-click, button.loop-click').first().click();
      ok(`B11b Boucle n°${i + 1} : un clic la met en pause`, await isPaused(box));
    }
    await p.context().close();

    // Le mode « Lecteur » (plein écran) ne change pas.
    const pp = await publicPage("/fr/personnages");
    const player = pp.locator('[data-video-mode="player"]').first();
    await player.scrollIntoViewIfNeeded();
    ok("B12 Lecteur inchangé : image d'attente, pas de <video> dans la page", (await player.locator("video").count()) === 0);
    await player.getByRole("button", { name: /Lire/ }).first().click();
    const dlg = pp.locator('[data-testid="video-viewer"]');
    ok("B12b … un clic ouvre la visionneuse et la vidéo démarre", await dlg.waitFor({ timeout: 20000 }).then(() => true, () => false) && (await waitFor(() => pp.evaluate(() => { const v = document.querySelector('[data-testid="video-viewer"] video'); return Boolean(v) && !v.paused && v.currentTime > 0.2; }), 20000)));
    await pp.context().close();

    // « réduire les animations » : même comportement (à l'arrêt).
    const rp = await publicPage("/fr/personnages", { reducedMotion: "reduce" });
    const rl = rp.locator('[data-video-mode="loop"]').first();
    await rl.scrollIntoViewIfNeeded();
    await sleep(2000);
    ok("B13 « réduire les animations » : à l'arrêt, un clic la lance", (await vstate(rl)).paused && (await vstate(rl)).t === 0);
    await rl.locator(".loop-click").click();
    ok("B13b … elle se lance", await playing(rl));
    await rp.context().close();

    // Toile de l'éditeur : la Boucle ne démarre pas non plus (le clic sert à choisir le composant).
    const fr = await openEditor(VIDEOS);
    await sleep(3000);
    const cs = await fr.evaluate(() => [...document.querySelectorAll('[data-video-mode="loop"] video')].map((v) => ({ paused: v.paused, t: v.currentTime })));
    ok("B14 toile : les Boucles ne démarrent pas seules non plus", cs.length >= 3 && cs.every((s) => s.paused && s.t === 0), JSON.stringify(cs));
  });

/* ============================================================================================================================
 * T. Thème sans cadre dessiné
 * ========================================================================================================================== */
if (run("T"))
  await section("T", async () => {
    // Un modèle (sans kit) en ligne (lot 60 : « Utiliser ce modèle » puis « Publier » : Mon thème).
    await activateThemeUi(page, BASE, "studio");
    await sleep(2000);
    await gotoThemesPage(page, BASE);
    ok("T1 thème sans cadre dessiné en ligne : le réglage « Cadre du thème sur toutes les photos » n'est pas proposé", (await page.locator('[data-testid="frame-all-setting"]').count()) === 0);
    const { done } = await publish(PHOTOS, photoBlocks());
    ok("T0 page publiée", done);
    const fr = await openEditor(PHOTOS);
    const dlg = await openMenu(fr, "p1");
    ok("T2 le menu ne propose que « Aucun · Bande de couleur »", (await dlg.locator("[data-frame-kind]").allTextContents()).map((t) => t.trim()).join(" · ") === "Aucun · Bande de couleur");
    await page.keyboard.press("Escape");
    const d3 = await openMenu(fr, "p3");
    ok("T3 une photo qui avait choisi « Cadre du thème » le montre (coché, avec la phrase qui dit que le thème n'en dessine pas)", (await checked(kindBtn(d3, "theme"))) && /ne dessine pas de cadre/.test((await d3.textContent()) ?? ""));
    await page.keyboard.press("Escape");
    const pub = await publicPage("/fr/decors");
    const s = await shown(pub, PHOTO);
    ok("T4 public : « Cadre du thème » ne dessine rien sans kit, la bande reste une bande", s[2]?.kind === "none" && s[3]?.kind === "band", JSON.stringify(s.map((x) => x.kind)));
    await pub.context().close();
  });

console.log(errors.length ? `ERREURS PAGE : ${errors.slice(0, 5).join(" | ")}` : "aucune erreur de page");
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout est vert");
process.exit(failures ? 1 : 0);
