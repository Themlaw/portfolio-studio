#!/usr/bin/env node
/**
 * Lot 75 « unification, suite » (chromium, serveur requis, base neuve, une connexion admin) : une seule écriture `media-look`, tables CSS générées.
 *  W  Écriture : pour chaque conteneur (rubrique image, case de grille de la page, composant de planche, place de carrousel, image de la Planche
 *     libre), les fenêtres Cadre / Fond image / Arrondi écrivent par l'intention `media-look` ; les données sont à la nouvelle forme (`slotLook`) ;
 *     UNE action de l'artiste = UN pas d'historique (Défaire la retire d'un coup, Rétablir la remet).
 *  L  Lecture de l'ancien format : une planche v0.30 (cinq cartes par place) s'affiche comme avant ; le premier réglage la réécrit en `slotLook`
 *     sans rien perdre des autres places.
 *  G  Géométrie (T3) : le cadre ne change jamais la taille d'une place de carrousel ni d'un composant de planche (bande Épais, cadre du thème).
 *  R  Tables CSS générées (R5) : le portrait du profil et les tuiles prennent leur format de `--box-r` posé par le composant ; les crans d'arrondi
 *     d'un bloc lisent `--t-radius-*`.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=W,L,G,R] [SHOTS=dossier] node scripts/e2e-unif75.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { boardDraft, draftBlocks, findIn, login, makeMedia, openEditor, pageIdOf, q1, setBoardDraft, setDraft, settled, sleep, sql, waitFor } from "./lib/grille31d.mjs";

const BASE = process.env.BASE ?? "http://localhost:3900";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(tmpdir(), "e2e-unif75");
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const near = (a, b, tol = 0.6) => Math.abs(a - b) <= tol;

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

const M = await makeMedia(page, BASE);
const PAGE = pageIdOf("personnages");
const project = q1("select id, slug from projects order by id limit 1");
const T = (s) => ({ fr: s, en: s });
const img = (uid, mediaId, props = {}) => ({ uid, type: "image", props: { mediaId, width: "wide", ...props } });
const grid = (uid, children, props = {}) => ({ uid, type: "grid", props: { layout: "2", gap: "normal", align: "stretch", ratio: "1:1", top: "gap", ...props, children } });
const free = (uid, items) => ({ uid, type: "free-board", props: { format: "3:2", phone: "scale", items } });
const fitem = (id, media, x, y, w, extra = {}) => ({ id, media, x, y, w, rot: 0, z: 0, ...extra });
const LEGACY_KEYS = /^slot(Frame|Bg|Radius|Pano|Video)$/;
const noLegacy = (look) => !look || !Object.keys(look).some((k) => LEGACY_KEYS.test(k));

const lookOf = (uid) => findIn(draftBlocks(PAGE), uid)?.props.look;
const boardItem = (uid) => (boardDraft(project.id) ?? []).find((i) => i.uid === uid);
const undo = async () => {
  await settled(page);
  await page.locator('button[aria-label="Défaire"]').click();
  await sleep(800);
};
const redo = async () => {
  await settled(page);
  await page.locator('button[aria-label="Rétablir"]').click();
  await sleep(800);
};
/** Style calculé de la boîte du média (la bordure vit sur `.media-frame`). */
const boxOf = (fr, sel) =>
  fr.evaluate((s) => {
    const el0 = document.querySelector(s);
    const el = el0?.closest(".media-frame") ?? el0;
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = (el.closest(".media-box") ?? el).getBoundingClientRect();
    return { bt: parseFloat(cs.borderTopWidth), bg: cs.backgroundColor, radius: cs.getPropertyValue("--media-radius"), w: r.width, h: r.height, pano: el.closest("[data-pano]")?.getAttribute("data-pano") ?? null, frame: el.dataset.frame ?? null };
  }, sel);

const BLOCKS = () => [
  img("solo", M.paysage),
  grid("grid1", [img("gc1", M.paysage), img("gc2", M.portrait)]),
  free("fb1", [fitem("a1", M.paysage, 8, 8, 40), fitem("a2", M.portrait, 55, 8, 25)]),
  { uid: "pb1", type: "project-board", props: { project: project.slug } },
];
const BOARD = () => [
  { uid: "c1", type: "strip", props: { source: "own", media: [M.paysage, M.portrait, M.panorama], ids: ["p0", "p1", "p2"] } },
  img("bi1", M.paysage, { variant: "plain" }),
];

/** Ouvre la fenêtre (Popover) dont le bouton est `button`, dans le cadre `fr`. */
async function openWindow(fr, button, name) {
  await button.click();
  const dlg = fr.getByRole("dialog", { name });
  await dlg.waitFor({ timeout: 15000 });
  return dlg;
}

/* ============================================================================================================================
 * W. Une seule écriture, une action = un pas
 * ========================================================================================================================== */
if (run("W"))
  await section("W", async () => {
    setDraft(PAGE, BLOCKS());
    setBoardDraft(project.id, PAGE, BOARD());
    let fr = await openEditor(page, BASE, PAGE);
    await settled(page);

    // 1. Rubrique image : Cadre (barre de la rubrique) puis Fond image.
    await fr.locator('[data-edit-block="solo"] img').first().click();
    let dlg = await openWindow(fr, fr.locator('.pe-tools [data-testid="frame-button"]'), "Cadre de la photo");
    await dlg.locator('[data-frame-kind="band"]').click();
    ok("W1 rubrique image : le cadre est écrit dans look.frame", await waitFor(() => lookOf("solo")?.frame?.kind === "band", 30000), JSON.stringify(lookOf("solo")));
    await page.keyboard.press("Escape");
    await undo();
    ok("W1 …UN seul Défaire retire le cadre (une action = un pas)", await waitFor(() => !lookOf("solo")?.frame, 30000), JSON.stringify(lookOf("solo")));
    await redo();
    ok("W1 …Rétablir le remet", await waitFor(() => lookOf("solo")?.frame?.kind === "band", 30000));
    fr = await openEditor(page, BASE, PAGE);

    // 2. Case de grille de la page : le fond derrière l'image.
    await fr.locator('[data-edit-block="gc1"] img').first().click();
    await sleep(500);
    await fr.locator('[data-testid="cellbar"] [data-cb="imgbg"]').click();
    dlg = fr.getByRole("dialog", { name: "Fond de l'image" });
    await dlg.waitFor({ timeout: 15000 });
    await dlg.locator('[data-imgbg="white"]').click();
    ok("W2 case de grille : le fond est écrit dans look.imageBg de la case", await waitFor(() => lookOf("gc1")?.imageBg === "#ffffff", 30000), JSON.stringify(lookOf("gc1")));
    await page.keyboard.press("Escape");
    await undo();
    ok("W2 …un Défaire", await waitFor(() => !lookOf("gc1")?.imageBg, 30000), JSON.stringify(lookOf("gc1")));
    fr = await openEditor(page, BASE, PAGE);

    // 3. Composant de planche : Cadre et Fond image par `item-media-look`, écrits dans le projet.
    const bi = fr.locator('[data-edit-block="pb1"] [data-edit-bitem][data-edit-bitem-type="image"]').first();
    await bi.scrollIntoViewIfNeeded();
    await bi.hover();
    await bi.click({ position: { x: 20, y: 20 } }).catch(() => {});
    dlg = await openWindow(fr, fr.locator('[data-testid="bitem-frame-button"]').first(), "Cadre de la photo");
    await dlg.locator('[data-frame-kind="band"]').click();
    ok("W3 composant de planche : le cadre est écrit dans le projet (props.look.frame)", await waitFor(() => boardItem("bi1")?.props.look?.frame?.kind === "band", 30000), JSON.stringify(boardItem("bi1")));
    await dlg.locator('[data-frame-width="epais"]').click();
    ok("W3 …et l'épaisseur est fusionnée dans le même réglage", await waitFor(() => boardItem("bi1")?.props.look?.frame?.width === "epais", 30000));
    await page.keyboard.press("Escape");
    await undo();
    ok("W3 …Défaire revient en arrière sur le projet", await waitFor(() => !boardItem("bi1")?.props.look?.frame || boardItem("bi1").props.look.frame.width !== "epais", 30000), JSON.stringify(boardItem("bi1")));
    fr = await openEditor(page, BASE, PAGE);

    // 4. Place de carrousel : Cadre, Fond image, Arrondi, Panorama : UNE carte `slotLook[slug]`.
    const slot = fr.locator('[data-edit-block="pb1"] [data-edit-rail="c1"] [data-edit-slot]').nth(2);
    await slot.scrollIntoViewIfNeeded();
    const slug = await slot.getAttribute("data-slot-slug");
    await slot.hover();
    let bar = fr.locator(".pe-slot-tools");
    await bar.waitFor({ timeout: 15000 });
    await bar.getByTestId("slot-radius").selectOption("medium");
    ok("W4 place de carrousel : l'arrondi est écrit dans look.slotLook[slug].radius", await waitFor(() => lookOf("pb1")?.slotLook?.[slug]?.radius === "medium", 30000), JSON.stringify(lookOf("pb1")));
    await bar.locator('[data-slot-pano-set="scroll"]').click();
    ok("W4 …le panorama dans la MÊME carte", await waitFor(() => lookOf("pb1")?.slotLook?.[slug]?.pano === "scroll" && lookOf("pb1").slotLook[slug].radius === "medium", 30000), JSON.stringify(lookOf("pb1")));
    await bar.getByTestId("slot-frame-button").click();
    dlg = fr.getByRole("dialog", { name: "Cadre de la photo" });
    await dlg.waitFor({ timeout: 15000 });
    await dlg.locator('[data-frame-kind="band"]').click();
    ok("W4 …le cadre aussi", await waitFor(() => lookOf("pb1")?.slotLook?.[slug]?.frame?.kind === "band", 30000), JSON.stringify(lookOf("pb1")));
    ok("W4 aucune ancienne carte (slotFrame, slotBg, slotRadius, slotPano, slotVideo)", noLegacy(lookOf("pb1")), JSON.stringify(lookOf("pb1")));
    await page.keyboard.press("Escape");
    await undo();
    ok("W4 …un Défaire retire le cadre (et lui seul)", await waitFor(() => !lookOf("pb1")?.slotLook?.[slug]?.frame && lookOf("pb1")?.slotLook?.[slug]?.pano === "scroll", 30000), JSON.stringify(lookOf("pb1")));
    fr = await openEditor(page, BASE, PAGE);

    // 5. Image de la Planche libre : arrondi, cadre, fond sur sa ligne, par la même intention.
    const item = fr.locator('[data-edit-block="fb1"] .free-item').first();
    await item.scrollIntoViewIfNeeded();
    await item.click();
    bar = fr.locator(".pe-slot-tools").first();
    await bar.waitFor({ timeout: 15000 });
    await bar.getByTestId("free-radius").selectOption("strong");
    const freeOf = () => (findIn(draftBlocks(PAGE), "fb1")?.props.items ?? []).find((i) => i.id === "a1");
    ok("W5 Planche libre : l'arrondi est écrit sur la ligne de l'image", await waitFor(() => freeOf()?.radius === "strong", 30000), JSON.stringify(freeOf()));
    dlg = await openWindow(fr, bar.getByTestId("free-frame-button"), "Cadre de la photo");
    await dlg.locator('[data-frame-kind="band"]').click();
    ok("W5 …le cadre aussi", await waitFor(() => freeOf()?.frame?.kind === "band", 30000), JSON.stringify(freeOf()));
    await page.keyboard.press("Escape");
    await undo();
    ok("W5 …un Défaire retire le cadre, pas l'arrondi", await waitFor(() => !freeOf()?.frame && freeOf()?.radius === "strong", 30000), JSON.stringify(freeOf()));
    await page.screenshot({ path: path.join(SHOTS, "w-final.png") });
  });

/* ============================================================================================================================
 * L. Ancien format relu
 * ========================================================================================================================== */
if (run("L"))
  await section("L", async () => {
    const BAND = { kind: "band", width: "epais", color: "primary" };
    const legacy = {
      spaceTop: "m",
      slotRadius: { "c1-p0": "strong" },
      slotFrame: { "c1-p1": { size: "thick" }, "c1-p2": { kind: "theme" } },
      slotBg: { "c1-p0": "#ffffff" },
      slotPano: { "c1-p2": "scroll" },
    };
    setDraft(PAGE, [{ uid: "pb1", type: "project-board", props: { project: project.slug, look: legacy } }]);
    setBoardDraft(project.id, PAGE, BOARD());
    let fr = await openEditor(page, BASE, PAGE);
    await settled(page);
    const S = (i) => `[data-edit-block="pb1"] [data-edit-rail="c1"] [data-edit-slot]:nth-child(${i + 1}) .strip-media img`;
    await fr.locator(S(0)).first().scrollIntoViewIfNeeded();
    const p0 = await boxOf(fr, S(0));
    const p1 = await boxOf(fr, S(1));
    const p2 = await boxOf(fr, S(2));
    ok("L1 la planche v0.30 s'affiche comme avant : arrondi 20 px et fond blanc (place 1)", p0 && p0.radius.trim() === "20px" && p0.bg === "rgb(255, 255, 255)", JSON.stringify(p0));
    ok("L2 …bande Épais (ancienne forme { size: thick }) sur la place 2", p1 && p1.bt > 6 && p1.frame === "band", JSON.stringify(p1));
    ok("L3 …cadre du thème et panorama « à faire défiler » sur la place 3", p2 && p2.frame === "theme" && p2.pano === "scroll", JSON.stringify(p2));
    ok("L4 le brouillon n'est PAS réécrit par la simple lecture", Object.keys(findIn(draftBlocks(PAGE), "pb1").props.look).includes("slotFrame"));

    // Le premier réglage réécrit tout à la nouvelle forme, sans perdre les autres places.
    const slot = fr.locator('[data-edit-block="pb1"] [data-edit-rail="c1"] [data-edit-slot]').nth(1);
    await slot.hover();
    const bar = fr.locator(".pe-slot-tools");
    await bar.waitFor({ timeout: 15000 });
    await bar.getByTestId("slot-radius").selectOption("soft");
    const slug1 = await slot.getAttribute("data-slot-slug");
    ok("L5 un réglage : look réécrit à la nouvelle forme", await waitFor(() => lookOf("pb1")?.slotLook?.[slug1]?.radius === "soft", 30000) && noLegacy(lookOf("pb1")), JSON.stringify(lookOf("pb1")));
    const look = lookOf("pb1");
    ok("L6 …les autres places gardent leurs réglages (arrondi + fond, cadre du thème + panorama), l'espace du bloc aussi", look.slotLook["c1-p0"]?.radius === "strong" && look.slotLook["c1-p0"]?.bg === "#ffffff" && look.slotLook["c1-p2"]?.frame?.kind === "theme" && look.slotLook["c1-p2"]?.pano === "scroll" && look.spaceTop === "m", JSON.stringify(look));
    ok("L7 …l'ancien cadre { size: thick } de la place 2 est conservé (relu en bande Épais)", look.slotLook[slug1]?.frame?.size === "thick" || look.slotLook[slug1]?.frame?.width === "epais", JSON.stringify(look.slotLook[slug1]));
    void BAND;
    await sleep(500);
    fr = await openEditor(page, BASE, PAGE);
    const q1b = await boxOf(fr, S(1));
    ok("L8 après rechargement, la place 2 a l'arrondi doux ET la bande Épais", q1b && q1b.bt > 6 && q1b.radius.trim() === "4px", JSON.stringify(q1b));
  });

/* ============================================================================================================================
 * G. Géométrie : le cadre ne change jamais la taille
 * ========================================================================================================================== */
if (run("G"))
  await section("G", async () => {
    const copy = (n, frame) => ({
      blocks: [{ uid: `${n}pb`, type: "project-board", props: { project: project.slug, ...(frame ? { look: { slotLook: { [`${n}c-p0`]: { frame }, [`${n}c-p1`]: { frame }, [`${n}c-p2`]: { frame } } } } : {}) } }],
      board: [
        { uid: `${n}c`, type: "strip", props: { source: "own", media: [M.paysage, M.portrait, M.panorama], ids: ["p0", "p1", "p2"] } },
        img(`${n}i`, M.paysage, { variant: "plain", ...(frame ? { look: { frame } } : {}) }),
      ],
    });
    // Trois suites de planche identiques à la forme près : sans cadre, bande Épais, cadre du thème. La taille de chaque case doit être la même.
    const sizes = {};
    for (const [n, frame] of [["n", undefined], ["b", { kind: "band", width: "epais", color: "primary" }], ["k", { kind: "theme" }]]) {
      const c = copy(n, frame);
      setDraft(PAGE, c.blocks);
      setBoardDraft(project.id, PAGE, c.board);
      const fr = await openEditor(page, BASE, PAGE);
      await settled(page);
      sizes[n] = await fr.evaluate(() =>
        [...document.querySelectorAll("[data-edit-rail] [data-edit-slot]")].map((e) => {
          const r = (e.closest(".media-box") ?? e).getBoundingClientRect();
          return [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10];
        }),
      );
      const imgs = await fr.evaluate(() =>
        [...document.querySelectorAll("[data-edit-bitem] .media-frame")].map((e) => {
          const box = e.closest(".media-box") ?? e;
          const r = box.getBoundingClientRect();
          const m = e.querySelector("img");
          return { w: r.width, h: r.height, cr: m.clientWidth / m.clientHeight };
        }),
      );
      sizes[`${n}img`] = imgs;
    }
    ok("G1 la bande a des places à mesurer", sizes.n.length >= 3, JSON.stringify(sizes.n));
    const same = (a, b) => a.length === b.length && a.every((v, i) => near(v[0], b[i][0], 0.6) && near(v[1], b[i][1], 0.6));
    ok("G2 places de carrousel : bande Épais = mêmes tailles que sans cadre", same(sizes.n, sizes.b), JSON.stringify([sizes.n, sizes.b]));
    ok("G3 places de carrousel : cadre du thème = mêmes tailles que sans cadre", same(sizes.n, sizes.k), JSON.stringify([sizes.n, sizes.k]));
    const sameImg = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v.cr - b[i].cr) < 0.004);
    ok("G4 composant Image de la planche : la zone intérieure garde son format avec une bande Épais", sameImg(sizes.nimg, sizes.bimg), JSON.stringify([sizes.nimg, sizes.bimg]));
    ok("G5 …et avec le cadre du thème", sameImg(sizes.nimg, sizes.kimg), JSON.stringify([sizes.nimg, sizes.kimg]));
  });

/* ============================================================================================================================
 * R. Tables CSS générées
 * ========================================================================================================================== */
if (run("R"))
  await section("R", async () => {
    // Un bloc par cran d'arrondi : `--media-radius` vient de `--t-radius-*` (0, 4, 10, 20 px).
    const radii = { none: "0px", soft: "4px", medium: "10px", strong: "20px" };
    setDraft(PAGE, Object.keys(radii).map((r) => img(`r-${r}`, M.paysage, { look: { radius: r } })));
    const fr = await openEditor(page, BASE, PAGE);
    await settled(page);
    const got = await fr.evaluate(() => Object.fromEntries(["none", "soft", "medium", "strong"].map((r) => [r, getComputedStyle(document.querySelector(`.blk[data-radius="${r}"]`)).getPropertyValue("--media-radius").trim()])));
    ok("R1 crans d'arrondi d'un bloc : 0 / 4 / 10 / 20 px, lus de --t-radius-*", JSON.stringify(got) === JSON.stringify(radii), JSON.stringify(got));
    const vars = await fr.evaluate(() => Object.fromEntries(["none", "soft", "medium", "strong"].map((r) => [r, getComputedStyle(document.documentElement).getPropertyValue(`--t-radius-${r}`).trim()])));
    ok("R2 …émis avec le thème", JSON.stringify(vars) === JSON.stringify(radii), JSON.stringify(vars));
    // Format imposé du portrait du profil et des tuiles : `--box-r` posé par le composant.
    sql((db) => {
      for (const r of db.prepare("select id, type, props from blocks where type in ('profile', 'collection-tiles')").all()) {
        const props = JSON.parse(r.props);
        if (r.type === "profile") props.portraitRatio = "3:4";
        else props.ratio = "3:2";
        db.prepare("update blocks set props = ? where id = ?").run(JSON.stringify(props), r.id);
      }
    });
    const pub = await ctx.newPage();
    for (const [urlPath, sel, want] of [["/fr/a-propos", ".profile-portrait img", 3 / 4], ["/fr", ".tiles .tile-frame img", 3 / 2]]) {
      await pub.goto(`${BASE}${urlPath}`, { waitUntil: "networkidle" });
      const m = await pub.evaluate((s) => {
        const el = document.querySelector(s);
        const host = el?.closest("[data-ratio]");
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { ratio: r.width / r.height, boxR: host ? getComputedStyle(host).getPropertyValue("--box-r").trim() : null };
      }, sel);
      ok(`R3 ${urlPath} : le format imposé (${want.toFixed(3)}) vient de --box-r du composant`, m && Math.abs(m.ratio - want) < 0.01 && Boolean(m.boxR), JSON.stringify(m));
    }
    await pub.close();
  });

console.log(errors.length ? `INFO erreurs de page : ${errors.slice(0, 4).join(" | ")}` : "INFO aucune erreur de page");
console.log(failures ? `ECHEC : ${failures} échec(s)` : "TOUT PASSE");
await browser.close();
process.exit(failures ? 1 : 0);
