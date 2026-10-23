#!/usr/bin/env node
/**
 * Lot 64 « MediaFrame : un seul porteur pour les photos et les vidéos » (chromium, serveur requis, base neuve, une connexion admin).
 * Un VRAI thème avec un cadre dessiné ASYMÉTRIQUE (bord bas plus épais) est mis en ligne, comme l'artiste ; de vraies vidéos (ffmpeg).
 * Suite écrite pour ÉCHOUER avant le lot (A5 : tests T3, T4, T6, T8 et les correctifs R0) et passer après.
 *
 *  G  Géométrie (T3, S1) : pour chaque conteneur (image seule paysage / portrait, grille « Automatique » à rangées justifiées, grille au format
 *     carré avec une vidéo, vidéo seule, Planche libre), la boîte du média a EXACTEMENT la même taille sans cadre, avec une bande Épais et avec le
 *     cadre du thème ; dans une rangée justifiée, toutes les hauteurs sont égales.
 *  K  Cadre du kit (D2) : les QUATRE épaisseurs réelles (haut, droite, bas, gauche) de la découpe, pour la photo, la vidéo, l'image libre ET la
 *     tuile de collection ; la boîte ne peint pas son fond sous le cadre (background-clip).
 *  H  Halo (T4, D3) : une photo opaque sous le cadre du thème : aucun pixel de sa couleur dominante dans la bordure, autour de l'image.
 *  P  Porteur : le cadre, le fond, le format et le repère de la visionneuse sont posés sur la boîte de la PHOTO (cadrage ancien, portrait),
 *     pas sur un bloc pleine largeur.
 *  C  Couleurs (D5, S11) : « Couleur de la carte » = la carte réellement dessous (carte colorée, carte sombre) ; la bande « Texte » = la bande
 *     par défaut (lisible sur une carte sombre).
 *  F  Fond d'une image libre (D4) : le fond choisi n'est pas masqué par la couleur de chargement de la photo opaque ; arrondi de l'image libre.
 *  U  Vidéo (R1) : plus de passe-partout propre, plus de 16:9 forcé : format natif (16:9, vertical plafonné à 85 % de l'écran), format de la grille.
 *  V  Visionneuse (T8) : un clic à côté de la photo n'ouvre rien ; un clic sur la photo ouvre LA bonne image (grille).
 *  A  Scènes de l'audit A2 : le cadre suit toujours la photo (ancien cadrage, image entière, petites images, kit + arrondi, Aperçu).
 *  S  Toile (T6, S2, S4, S9) : le contour de sélection d'une image libre = la boîte réelle (bande, cadre du thème, rotation) ; la barre média est
 *     calée sur la photo ; la barre du composant de planche reste au-dessus de dix images libres empilées.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=G,K,…] [SHOTS=dossier] node scripts/e2e-mediaframe64.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";
import sharp from "sharp";

import { installKitFrameTheme } from "./lib/cadres62.mjs";
import { boardDraft, login, makeMedia, openEditor, pageIdOf, q1, setBoardDraft, setDraft, settled, sleep, sql, waitFor } from "./lib/grille31d.mjs";
import { ensureVideos } from "./lib/video36.mjs";

const BASE = process.env.BASE ?? "http://localhost:3800";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(tmpdir(), "e2e-mediaframe64");
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const info = (label, v) => console.log(`INFO ${label} : ${typeof v === "string" ? v : JSON.stringify(v)}`);
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
const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});

/* ---- Médias de test ------------------------------------------------------------------------------------------------- */
const M = await makeMedia(page, BASE);
const V = await ensureVideos(page, BASE);
/** Une photo opaque d'UNE couleur (magenta : absente du dessin du kit) et une vidéo verticale (9:16). */
async function ensureExtra() {
  const row = (name) => q1("select id, status from media where original_name = ? order by id desc", name);
  const flat = "64-magenta.png";
  if (!row(flat)) {
    const buffer = await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 255, g: 0, b: 255 } } }).png().toBuffer();
    const res = await page.request.post(`${BASE}/admin/api/upload`, { headers: { origin: BASE }, multipart: { file: { name: flat, mimeType: "image/png", buffer } }, timeout: 180000 });
    if (res.status() >= 300) throw new Error(`envoi de ${flat} : ${res.status()}`);
  }
  const vert = "64-vertical.mp4";
  if (!row(vert)) {
    const file = path.join(tmpdir(), vert);
    execFileSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=360x640:rate=25", "-t", "3", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-an", file]);
    await page.goto(`${BASE}/admin/medias`, { waitUntil: "networkidle" });
    await page.locator("input[type=file]").first().setInputFiles(file);
    if (!(await waitFor(() => Boolean(row(vert)), 60000))) throw new Error("vidéo verticale non reçue");
  }
  for (const name of [flat, vert]) if (!(await waitFor(() => row(name)?.status === "ready", 240000))) throw new Error(`${name} : ${JSON.stringify(row(name))}`);
  const tall = "64-haut.png";
  if (!row(tall)) {
    const buffer = await sharp({ create: { width: 900, height: 5000, channels: 3, background: { r: 120, g: 160, b: 90 } } }).png().toBuffer();
    const res = await page.request.post(`${BASE}/admin/api/upload`, { headers: { origin: BASE }, multipart: { file: { name: tall, mimeType: "image/png", buffer } }, timeout: 180000 });
    if (res.status() >= 300) throw new Error(`envoi de ${tall} : ${res.status()}`);
    if (!(await waitFor(() => row(tall)?.status === "ready", 240000))) throw new Error(`${tall} : ${JSON.stringify(row(tall))}`);
  }
  return { magenta: row(flat).id, vertical: row(vert).id, tall: row(tall).id };
}
const X = await ensureExtra();

/* ---- Thème avec un cadre dessiné ASYMÉTRIQUE ------------------------------------------------------------------------- */
let slice = null;
{
  const active = q1("select value from settings where key = 'activeThemeId'")?.value;
  const data = active ? q1("select data from themes where id = ?", JSON.parse(active))?.data : null;
  if (data && JSON.parse(data).assets?.kit?.frame) slice = JSON.parse(data).assets.kit.frame.slice;
  else {
    await installKitFrameTheme(page, BASE, (themeId) => {
      sql((db) => {
        const t = JSON.parse(db.prepare("select data from themes where id = ?").get(themeId).data);
        const f = t.assets.kit.frame;
        const [a, b, c, d] = f.slice;
        // Bord bas plus épais (un cadre « polaroid ») ; la découpe tient dans l'image du cadre.
        f.slice = [a, b, Math.min(c * 2, Math.max(c, f.image.h - a - 4)), d];
        slice = f.slice;
        db.prepare("update themes set data = ? where id = ?").run(JSON.stringify(t), themeId);
      });
    });
    const active2 = q1("select value from settings where key = 'activeThemeId'")?.value;
    slice = JSON.parse(q1("select data from themes where id = ?", JSON.parse(active2)).data).assets.kit.frame.slice;
  }
}
info("découpe du cadre dessiné (haut, droite, bas, gauche)", slice);
const WANT = slice.map((n) => Math.round(n / 2));

/* ---- Aides ---------------------------------------------------------------------------------------------------------- */
const PHOTOS = pageIdOf("decors");
const project = q1("select id, slug from projects order by id limit 1");
const T = (s) => ({ fr: s, en: s });
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
  setDraft(pageId, blocks);
  if (board) setBoardDraft(project.id, pageId, board);
  return done;
}
const publicPage = async (urlPath, options = {}) => {
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  const p = await c.newPage();
  p.setDefaultTimeout(30000);
  p.on("pageerror", (e) => errors.push(`public : ${e.message}`));
  await p.goto(`${BASE}${urlPath}`, { waitUntil: "networkidle" });
  await p.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 80));
    }
    window.scrollTo(0, 0);
  });
  await sleep(900);
  return p;
};
/** Boîtes (`.media-frame`) du document : rectangle, bordure (4 côtés), fond, arrondi, repères. */
const frames = (doc, sel = ".media-frame") =>
  doc.evaluate((s) => {
    return [...document.querySelectorAll(s)].map((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height,
        bt: parseFloat(cs.borderTopWidth), br: parseFloat(cs.borderRightWidth), bb: parseFloat(cs.borderBottomWidth), bl: parseFloat(cs.borderLeftWidth),
        drawn: cs.borderImageSource !== "none", color: cs.borderTopColor, bg: cs.backgroundColor, clip: cs.backgroundClip, radius: cs.borderTopLeftRadius, overflow: cs.overflow,
        kind: el.dataset.kind, frame: el.dataset.frame ?? null, viewer: el.hasAttribute("data-viewer-item"),
      };
    });
  }, sel);

const BAND = { kind: "band", width: "epais", color: "primary" };
const KIT = { kind: "theme" };
const withFrame = (frame) => (frame ? { look: { frame } } : {});

/* ============================================================================================================================
 * G. Géométrie : le cadre ne change jamais la taille
 * ========================================================================================================================== */
if (run("G"))
  await section("G", async () => {
    // Trois copies identiques d'une même suite de blocs : sans cadre, bande Épais, cadre du thème.
    const copy = (n, frame) => [
      img(`${n}-p`, M.paysage, withFrame(frame)),
      img(`${n}-v`, M.portrait, withFrame(frame)),
      grid(`${n}-j`, [img(`${n}-j1`, M.paysage, withFrame(frame)), img(`${n}-j2`, M.portrait, withFrame(frame)), img(`${n}-j3`, M.carre, withFrame(frame)), img(`${n}-j4`, M.panorama, withFrame(frame)), img(`${n}-j5`, M.paysage2, withFrame(frame))], { layout: "auto" }),
      grid(`${n}-c`, [img(`${n}-c1`, M.carre, withFrame(frame)), vid(`${n}-c2`, V.short, withFrame(frame)), vid(`${n}-c3`, V.long, { mode: "player", ...withFrame(frame) })], { layout: "3", ratio: "1:1" }),
      vid(`${n}-vs`, V.short, withFrame(frame)),
      free(`${n}-f`, [fitem("a1", M.paysage, 8, 8, 40, frame ? { frame } : {}), fitem("a2", M.portrait, 55, 6, 25, frame ? { frame, rot: 6 } : { rot: 6 })]),
    ];
    const blocks = [...copy("n", undefined), ...copy("b", BAND), ...copy("k", KIT)];
    ok("G0 page publiée", await publish(PHOTOS, blocks));
    const pub = await publicPage("/fr/decors");
    const all = await frames(pub, "main .media-frame");
    const per = all.length / 3;
    info("G boîtes de média par copie", per);
    ok("G1 chaque copie a le même nombre de boîtes (photos ET vidéos : un seul porteur)", Number.isInteger(per) && per === 2 + 5 + 3 + 1 + 2, String(all.length));
    const names = ["image paysage", "image portrait", ...Array.from({ length: 5 }, (_, i) => `grille justifiée ${i + 1}`), "carré photo", "carré vidéo boucle", "carré vidéo lecteur", "vidéo seule", "libre paysage", "libre portrait"];
    for (const [label, off] of [["bande Épais", per], ["cadre du thème", 2 * per]]) {
      const bad = [];
      for (let i = 0; i < per; i++) {
        const a = all[i];
        const b = all[off + i];
        if (!near(a.w, b.w, 0.6) || !near(a.h, b.h, 0.6)) bad.push(`${names[i] ?? i} : ${a.w.toFixed(1)}×${a.h.toFixed(1)} → ${b.w.toFixed(1)}×${b.h.toFixed(1)}`);
      }
      ok(`G2 ${label} : la taille extérieure de chaque boîte est celle d'une boîte SANS cadre`, bad.length === 0, bad.join(" | "));
    }
    // Rangées justifiées (grille « Automatique ») : toutes les cases d'une rangée ont la même hauteur, avec ou sans cadre.
    for (const [label, off] of [["sans cadre", 0], ["bande Épais", per], ["cadre du thème", 2 * per]]) {
      const cells = all.slice(off + 2, off + 7);
      const rows = new Map();
      for (const c of cells) rows.set(Math.round(c.y / 4), [...(rows.get(Math.round(c.y / 4)) ?? []), c.h]);
      const spread = [...rows.values()].map((hs) => Math.max(...hs) - Math.min(...hs));
      ok(`G3 grille « Automatique » ${label} : hauteurs égales dans chaque rangée`, spread.every((d) => d <= 1.2), JSON.stringify([...rows.values()]));
    }
    // Planche libre : la hauteur d'une image libre est celle de son format (largeur ÷ format), cadre compris.
    const fb = await pub.evaluate(() => [...document.querySelectorAll(".free-item")].map((it) => ({ w: it.offsetWidth, h: it.offsetHeight, hf: it.querySelector(".media-frame").offsetHeight })));
    ok("G4 Planche libre : la boîte remplit sa figure (même hauteur)", fb.every((x) => near(x.h, x.hf, 1.2)), JSON.stringify(fb));
    await shot(pub, "g-public");
    await pub.context().close();
  });

/* ============================================================================================================================
 * K. Les quatre épaisseurs du cadre dessiné
 * ========================================================================================================================== */
if (run("K"))
  await section("K", async () => {
    const blocks = [
      img("k1", M.paysage, withFrame(KIT)),
      vid("k2", V.short, withFrame(KIT)),
      grid("k3", [img("k31", M.carre, withFrame(KIT)), vid("k32", V.short, withFrame(KIT))], { layout: "2", ratio: "1:1" }),
      free("k4", [fitem("a1", M.paysage, 10, 10, 40, { frame: KIT })]),
    ];
    ok("K0 page publiée", await publish(PHOTOS, blocks));
    const pub = await publicPage("/fr/decors");
    const fs = await frames(pub, "main .media-frame");
    const bad = fs.filter((f) => ![f.bt, f.br, f.bb, f.bl].every((v, i) => near(v, WANT[i], 0.6)));
    ok("K1 photo, vidéo, case de grille, image libre : bordure = la découpe réelle (haut, droite, bas, gauche)", fs.length === 5 && bad.length === 0, JSON.stringify({ want: WANT, got: fs.map((f) => [f.bt, f.br, f.bb, f.bl]) }));
    ok("K2 le bord bas est plus épais que le haut (cadre asymétrique respecté)", WANT[2] > WANT[0] && fs.every((f) => f.bb > f.bt));
    ok("K3 la boîte ne peint pas son fond sous le dessin (background-clip: padding-box)", fs.every((f) => f.clip === "padding-box"), JSON.stringify(fs.map((f) => f.clip)));
    // Tuile de collection (accueil) : mêmes épaisseurs, même règle.
    const home = await publicPage("/fr");
    const tile = await home.evaluate(() => [...document.querySelectorAll(".tile-media")].map((t) => { const cs = getComputedStyle(t); return [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map(parseFloat); }));
    ok("K4 tuile de collection : les mêmes quatre épaisseurs", tile.length > 0 && tile.every((t) => t.every((v, i) => near(v, WANT[i], 0.6))), JSON.stringify(tile));
    await home.context().close();
    // Petit écran : épaisseur réduite PROPORTIONNELLEMENT (le bord bas reste plus épais que le haut).
    const ph = await publicPage("/fr/decors", { viewport: { width: 390, height: 844 }, isMobile: true });
    const pf = await frames(ph, "main .media-frame");
    ok("K5 téléphone : l'épaisseur diminue, les proportions restent (bas > haut)", pf.length === 5 && pf.every((f) => f.bt < WANT[0] && f.bb > f.bt && near(f.bb / f.bt, WANT[2] / WANT[0], 0.35)), JSON.stringify(pf.map((f) => [f.bt, f.bb])));
    await pub.context().close();
    await ph.context().close();
  });

/* ============================================================================================================================
 * H. Halo : aucun pixel de la couleur dominante autour d'une photo sous le cadre dessiné
 * ========================================================================================================================== */
if (run("H"))
  await section("H", async () => {
    ok("H0 page publiée", await publish(PHOTOS, [img("h1", X.magenta, { width: "wide", look: { frame: KIT } })]));
    const pub = await publicPage("/fr/decors");
    const box = pub.locator("figure.block-image .media-frame").first();
    await box.scrollIntoViewIfNeeded();
    await sleep(800);
    // Couleur de chargement de la photo (dominante, posée en ligne sur l'<img>) : c'est celle qui ne doit JAMAIS déborder sous le cadre.
    const dom = (await box.locator("img").evaluate((i) => getComputedStyle(i).backgroundColor)).match(/\d+/g).slice(0, 3).map(Number);
    const buf = await box.screenshot();
    const { data, info: inf } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const [t, r, b, l] = WANT;
    // Le CSS donne des px CSS ; la capture est à l'échelle 1 (deviceScaleFactor 1).
    let ring = 0;
    let magenta = 0;
    for (let y = 0; y < inf.height; y++)
      for (let x = 0; x < inf.width; x++) {
        const inner = x >= l && x < inf.width - r && y >= t && y < inf.height - b;
        if (inner) continue;
        ring++;
        const i = (y * inf.width + x) * 3;
        if (Math.abs(data[i] - dom[0]) < 14 && Math.abs(data[i + 1] - dom[1]) < 14 && Math.abs(data[i + 2] - dom[2]) < 14) magenta++;
      }
    info("H bordure", { ring, magenta, dominante: dom, box: `${inf.width}×${inf.height}` });
    ok("H1 aucun pixel de la couleur dominante de la photo dans la bordure (zones transparentes du dessin comprises)", ring > 1000 && magenta === 0, `${magenta} / ${ring}`);
    await shot(pub, "h-public");
    await pub.context().close();
  });

/* ============================================================================================================================
 * P. Le porteur est la photo
 * ========================================================================================================================== */
if (run("P"))
  await section("P", async () => {
    const blocks = [
      img("p1", M.portrait, { look: { frame: BAND, imageBg: "#ffcc00" } }),
      img("p2", M.portrait, { ratio: "3:4", look: { frame: BAND, imageBg: "#ffcc00", crop: { mediaId: { x: 30, y: 60, zoom: 1.4 } } } }),
    ];
    ok("P0 page publiée", await publish(PHOTOS, blocks));
    const pub = await publicPage("/fr/decors");
    const figs = await pub.evaluate(() =>
      [...document.querySelectorAll("figure.block-image[data-solo]")].map((f) => {
        const fr = f.querySelector(".media-frame");
        const im = f.querySelector("img");
        const a = fr.getBoundingClientRect();
        const b = im.getBoundingClientRect();
        return { fig: f.getBoundingClientRect().width, frame: { x: a.left, w: a.width, h: a.height }, img: { x: b.left, w: b.width, h: b.height }, bt: parseFloat(getComputedStyle(fr).borderTopWidth), bg: getComputedStyle(fr).backgroundColor, viewer: fr.hasAttribute("data-viewer-item") };
      }),
    );
    ok("P1 portrait seul : la boîte (cadre, fond, repère de la visionneuse) n'est PAS pleine largeur : elle entoure la photo", figs[0] && figs[0].frame.w < figs[0].fig * 0.6 && near(figs[0].frame.w, figs[0].img.w + 2 * figs[0].bt, 1) && figs[0].viewer, JSON.stringify(figs[0]));
    ok("P2 cadrage ancien : la bande et le fond entourent la photo (pas le bloc pleine largeur)", figs[1] && figs[1].frame.w < figs[1].fig * 0.8 && near(figs[1].frame.w, figs[1].img.w + 2 * figs[1].bt, 1) && figs[1].bg === "rgb(255, 204, 0)", JSON.stringify(figs[1]));
    await shot(pub, "p-public");
    await pub.context().close();
  });

/* ============================================================================================================================
 * C. Couleurs : la carte réellement dessous, « Texte » = la bande par défaut
 * ========================================================================================================================== */
if (run("C"))
  await section("C", async () => {
    const blocks = [
      grid("c1", [img("c11", M.carre, { look: { imageBg: "card" } }), img("c12", M.paysage, { look: { imageBg: "card" } })], { layout: "2", surface: { color: "primary12", corners: "round" } }),
      grid("c2", [img("c21", M.carre, { look: { frame: { kind: "band", width: "epais" } } }), img("c22", M.paysage, { look: { frame: { kind: "band", width: "epais", color: "ink" } } })], { layout: "2", ratio: "1:1", surface: { color: "ink", corners: "round" } }),
    ];
    ok("C0 page publiée", await publish(PHOTOS, blocks));
    const pub = await publicPage("/fr/decors");
    const r = await pub.evaluate(() => {
      const cards = [...document.querySelectorAll(".surface-card[data-surface=on]")];
      return cards.map((c) => ({ card: getComputedStyle(c).backgroundColor, frames: [...c.querySelectorAll(".media-frame")].map((f) => { const cs = getComputedStyle(f); return { bg: cs.backgroundColor, border: cs.borderTopColor, bw: parseFloat(cs.borderTopWidth) }; }) }));
    });
    ok("C1 carte colorée : « Couleur de la carte » = la couleur de la carte (pas celle du thème)", r[0] && r[0].frames.length === 2 && r[0].frames.every((f) => f.bg === r[0].card), JSON.stringify(r[0]));
    ok("C2 carte sombre : la bande « Texte » est la même que la bande par défaut (lisible), et ≠ de la carte", r[1] && r[1].frames[0].border === r[1].frames[1].border && r[1].frames[0].border !== r[1].card, JSON.stringify(r[1]));
    await shot(pub, "c-public");
    await pub.context().close();
  });

/* ============================================================================================================================
 * F. Image libre : fond choisi, arrondi
 * ========================================================================================================================== */
if (run("F"))
  await section("F", async () => {
    const blocks = [free("f1", [fitem("a1", M.paysage, 5, 5, 40, { bg: "#ff0000" }), fitem("a2", M.carre, 55, 5, 25, { radius: "strong", frame: BAND })])];
    ok("F0 page publiée", await publish(PHOTOS, blocks));
    const pub = await publicPage("/fr/decors");
    const r = await pub.evaluate(() => [...document.querySelectorAll(".free-item .media-frame")].map((f) => ({ bg: getComputedStyle(f).backgroundColor, img: getComputedStyle(f.querySelector("img")).backgroundColor, radius: getComputedStyle(f).borderTopLeftRadius, overflow: getComputedStyle(f).overflow })));
    ok("F1 le fond choisi est celui de la boîte (la couleur de chargement de la photo opaque ne le remplace pas)", r[0].bg === "rgb(255, 0, 0)" && r[0].img === "rgba(0, 0, 0, 0)", JSON.stringify(r[0]));
    ok("F2 l'arrondi de l'image libre est respecté, la bande le suit (rognée à la boîte)", r[1].radius === "20px" && /^(hidden|clip)$/.test(r[1].overflow), JSON.stringify(r[1]));
    await pub.context().close();
    // Toile : même rendu.
    const fr = await openEditor(page, BASE, PHOTOS);
    const c = await fr.evaluate(() => [...document.querySelectorAll(".free-item .media-frame")].map((f) => getComputedStyle(f).backgroundColor));
    ok("F3 toile : même fond que le public", c[0] === "rgb(255, 0, 0)", JSON.stringify(c));
  });

/* ============================================================================================================================
 * U. Vidéo : le format de la photo, pas de passe-partout, pas de 16:9 forcé
 * ========================================================================================================================== */
if (run("U"))
  await section("U", async () => {
    const blocks = [
      vid("u1", V.short, { variant: "plain" }),
      vid("u2", X.vertical, { variant: "plain" }),
      vid("u3", V.long, { variant: "card", mode: "player", title: T("Carte") }),
      grid("u4", [img("u41", M.carre), vid("u42", X.vertical)], { layout: "2", ratio: "1:1" }),
      grid("u5", [img("u51", M.paysage), vid("u52", X.vertical)], { layout: "2", ratio: "4:3" }),
    ];
    ok("U0 page publiée", await publish(PHOTOS, blocks));
    const pub = await publicPage("/fr/decors");
    const fs = await frames(pub, "main .media-frame");
    const [v169, vvert, vcard, gs1, gs2, gp1, gp2] = fs;
    ok("U1 vidéo 16:9 seule : format natif (16:9)", near(v169.w / v169.h, 16 / 9, 0.02), `${v169.w}×${v169.h}`);
    ok("U2 vidéo verticale seule : format natif (9:16), plafonnée à 85 % de la hauteur de l'écran comme une image seule", near(vvert.w / vvert.h, 9 / 16, 0.02) && vvert.h <= 0.85 * 900 + 1, `${vvert.w}×${vvert.h}`);
    ok("U3 présentation « carte » : même boîte, même format", near(vcard.w / vcard.h, 16 / 9, 0.02));
    ok("U4 grille au format carré : la vidéo verticale a le MÊME carré que la photo voisine", near(gs1.w, gs2.w, 1) && near(gs1.h, gs2.h, 1) && near(gs2.w / gs2.h, 1, 0.01), JSON.stringify([gs1, gs2].map((f) => [f.w, f.h])));
    ok("U5 grille 4:3 : la vidéo suit le format imposé comme la photo", near(gp1.w / gp1.h, 4 / 3, 0.02) && near(gp2.w / gp2.h, 4 / 3, 0.02), JSON.stringify([gp1, gp2].map((f) => [f.w, f.h])));
    ok("U6 plus de passe-partout propre à la vidéo (.mat) ni de 16:9 forcé (aspect-video)", (await pub.locator("main .mat, main .video-frame, main .aspect-video").count()) === 0);
    ok("U7 la vidéo et la photo ont la même boîte (même classe, même arrondi)", gs1.radius === gs2.radius && gs1.kind === "image" && gs2.kind === "video");
    await shot(pub, "u-public");
    await pub.context().close();
  });

/* ============================================================================================================================
 * V. Visionneuse : un clic sur la photo, et seulement sur la photo, ouvre la bonne image
 * ========================================================================================================================== */
if (run("V"))
  await section("V", async () => {
    const blocks = [
      img("v1", M.portrait, { look: { frame: BAND } }),
      grid("v2", [img("v21", M.paysage), img("v22", M.carre), img("v23", M.portrait)], { layout: "3", ratio: "1:1" }),
    ];
    ok("V0 page publiée", await publish(PHOTOS, blocks));
    const p = await publicPage("/fr/decors");
    const dialog = p.locator('[role="dialog"]');
    const fig = p.locator("figure.block-image[data-solo]").first();
    await fig.scrollIntoViewIfNeeded();
    const f = await fig.locator(".media-frame").boundingBox();
    const s = await fig.boundingBox();
    // Dans la marge vide, à gauche de la photo mais dans la colonne.
    await p.mouse.click(Math.max(s.x + 10, f.x - 120), f.y + 100);
    await sleep(900);
    ok("V1 un clic à côté de la photo n'ouvre rien", (await dialog.count()) === 0);
    await p.mouse.click(f.x + f.width / 2, f.y + 100);
    ok("V2 un clic sur la photo ouvre la visionneuse", await waitFor(async () => (await dialog.count()) > 0, 10000));
    await p.keyboard.press("Escape");
    await sleep(600);
    // Grille : la 2e image ouvre la 2e image.
    const cells = p.locator("main .block-grid").first().locator(".media-frame");
    const items = await p.evaluate(() => [...document.querySelectorAll("main .block-grid")[0].querySelectorAll("[data-viewer-item]")].map((e) => JSON.parse(e.dataset.viewerItem).image));
    ok("V3 la grille propose ses 3 images à la visionneuse", items.length === 3, JSON.stringify(items));
    for (const i of [1, 2, 0]) {
      await cells.nth(i).scrollIntoViewIfNeeded();
      const b = await cells.nth(i).boundingBox();
      await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      await dialog.first().waitFor({ timeout: 10000 });
      await sleep(900);
      const shown = await dialog.locator("img").first().getAttribute("src");
      const stem = (u) => (u ?? "").split("/").slice(0, 4).join("/");
      ok(`V4 la case ${i + 1} ouvre la bonne image`, stem(shown) === stem(items[i]) || (shown ?? "").includes(stem(items[i]).split("/").pop() ?? "§"), `${shown} vs ${items[i]}`);
      await p.keyboard.press("Escape");
      await sleep(600);
    }
    await shot(p, "v-public");
    await p.context().close();
  });

/* ============================================================================================================================
 * S. Toile : contour de sélection, barre média, barre du composant de planche
 * ========================================================================================================================== */
if (run("S"))
  await section("S", async () => {
    const blocks = [
      img("s1", M.portrait, { look: { frame: BAND } }),
      free("s2", [fitem("a1", M.paysage, 8, 8, 34, { frame: BAND }), fitem("a2", M.carre, 50, 8, 26, { frame: KIT, rot: 7, z: 1 }), fitem("a3", M.portrait, 12, 52, 20, { frame: BAND, rot: -9, z: 2 }), fitem("a4", V.short, 55, 55, 30, { frame: BAND, z: 3 })]),
    ];
    setDraft(PHOTOS, blocks);
    const fr = await openEditor(page, BASE, PHOTOS);
    await settled(page);
    // Barre média : calée sur la PHOTO (portrait étroit dans une colonne large).
    const figEl = fr.locator('[data-edit-block="s1"] figure.block-image');
    await figEl.scrollIntoViewIfNeeded();
    const photo = await figEl.locator(".media-frame").boundingBox();
    await page.mouse.move(photo.x + photo.width / 2, photo.y + 80);
    await sleep(200);
    await page.mouse.move(photo.x + photo.width / 2 + 3, photo.y + 100);
    const tools = fr.locator(".pe-media-tools").first();
    await tools.waitFor({ timeout: 15000 });
    const tb = await tools.boundingBox();
    ok("S1 la barre Remplacer / Retirer s'accroche à la photo (son bord gauche + 8 px), pas au bloc pleine largeur", tb && near(tb.x, photo.x + 8, 3), JSON.stringify({ tools: tb, photo }));
    await shot(page, "s-barre-media");
    // Contour de sélection de la Planche libre.
    const zone = fr.locator('[data-edit-block="s2"] .free-board');
    await zone.scrollIntoViewIfNeeded();
    await sleep(600);
    const items = zone.locator(".free-item");
    const n = await items.count();
    ok("S2 quatre images libres sur la toile", n === 4, String(n));
    const bad = [];
    for (let i = 0; i < n; i++) {
      const it = items.nth(i);
      const b = await it.boundingBox();
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      await sleep(900);
      const sel = fr.locator('[data-testid="free-sel"]');
      const dims = await it.evaluate((el) => ({ w: parseFloat(getComputedStyle(el).width), h: parseFloat(getComputedStyle(el).height) }));
      const sd = await sel.evaluate((el) => ({ w: parseFloat(el.style.width), h: parseFloat(el.style.height) })).catch(() => null);
      if (!sd || !near(sd.w, dims.w, 1.2) || !near(sd.h, dims.h, 1.2)) bad.push(`#${i} image ${dims.w.toFixed(1)}×${dims.h.toFixed(1)} contour ${sd ? `${sd.w.toFixed(1)}×${sd.h.toFixed(1)}` : "absent"}`);
    }
    ok("S3 le contour de sélection est exactement la boîte de l'image (bande, cadre du thème, rotation, vidéo)", bad.length === 0, bad.join(" | "));
    await shot(page, "s-contour");
    // Barre du composant de planche : dix images libres empilées (z jusqu'à 10) qui débordent au-dessus ne la recouvrent pas.
    const board = [free("sb", Array.from({ length: 10 }, (_, i) => fitem(`s${i}`, M.carre, 70 + (i % 5) * 5, -12 + (i % 3) * 2, 18, { z: i })), { format: "3:2" })];
    const pageBlocks = [{ uid: "pbz", type: "project-board", props: { project: project.slug } }];
    setDraft(PHOTOS, pageBlocks);
    setBoardDraft(project.id, PHOTOS, board);
    const fr2 = await openEditor(page, BASE, PHOTOS);
    await settled(page);
    const bitem = fr2.locator("[data-edit-bitem]:has(.free-board)").first();
    await bitem.scrollIntoViewIfNeeded();
    const bb = await bitem.boundingBox();
    await page.mouse.move(bb.x + 50, bb.y + 50);
    await sleep(150);
    await page.mouse.move(bb.x + 60, bb.y + 60);
    await sleep(900);
    const hit = await fr2.locator(".pe-bitem-bar").first().evaluate((bar) => {
      const r = bar.getBoundingClientRect();
      return [0.15, 0.5, 0.85].map((f) => !!document.elementFromPoint(r.left + r.width * f, r.top + r.height / 2)?.closest(".pe-bitem-bar"));
    });
    ok("S4 la barre du composant reste au-dessus des images libres empilées (jamais recouverte)", hit.every(Boolean), JSON.stringify(hit));
    await shot(page, "s-barre-planche");
  });


/* ============================================================================================================================
 * A. Scènes de l'audit A2 (cas absents de la banque) : le cadre suit TOUJOURS la photo
 *    Rejoue les cas de ~/pf/audit2/a2/page-a2.mjs avec les médias de cette suite (CADRE-01 à 09, VID-01, IMG-01 à 03, VIS-02).
 * ========================================================================================================================== */
if (run("A"))
  await section("A", async () => {
    const legacy = (x, y, zoom) => ({ mediaId: { x, y, zoom } });
    const blocks = [
      img("a1", X.tall, { look: { frame: KIT } }),
      img("a3", X.tall, { look: { frame: KIT, crop: legacy(50, 30, 1.5) } }),
      img("a4", M.portrait, { ratio: "1:1", look: { frame: KIT, crop: legacy(50, 20, 1) } }),
      img("a10", M.panorama, { width: "full", ratio: "1:1", look: { frame: KIT } }),
      img("a11", M.portrait, { ratio: "16:9", fit: "contain", look: { frame: BAND, imageBg: "#ffe0e0" } }),
      img("a12", M.carre, { look: { frame: KIT, imageBg: "card", radius: "strong" } }),
      grid("b1", [img("b11", M.paysage, withFrame(KIT)), img("b12", M.portrait), img("b13", M.carre, withFrame(BAND))], { layout: "3" }),
      grid("b3", [vid("b31", V.short, withFrame(KIT)), img("b32", M.paysage, withFrame(KIT))], { layout: "2" }),
      grid("b4", [vid("b41", X.vertical, { mode: "player", ...withFrame(KIT) }), img("b42", M.portrait, withFrame(KIT))], { layout: "2", ratio: "1:1" }),
      free("c1", [fitem("a1", M.paysage, 2, 4, 30, { frame: KIT }), fitem("a2", M.portrait, 36, 4, 18, { frame: BAND }), fitem("a3", X.tall, 80, 30, 6, { frame: KIT }), fitem("a4", M.carre, 36, 55, 18, { frame: KIT, radius: "strong" })]),
      vid("d1", X.vertical, withFrame(KIT)),
    ];
    ok("A0 page publiée", await publish(PHOTOS, blocks));
    for (const [label, opts] of [["1440", {}], ["390", { viewport: { width: 390, height: 844 }, isMobile: true }]]) {
      const p = await publicPage("/fr/decors", opts);
      const r = await p.evaluate(() =>
        [...document.querySelectorAll("main .media-frame")].map((f) => {
          const m = f.querySelector("img, video");
          const cs = getComputedStyle(f);
          return { kind: f.dataset.kind, w: f.offsetWidth, h: f.offsetHeight, iw: m.offsetWidth, ih: m.offsetHeight, bl: parseFloat(cs.borderLeftWidth), bt: parseFloat(cs.borderTopWidth), bb: parseFloat(cs.borderBottomWidth), free: Boolean(f.closest(".free-item")), clip: cs.clipPath, radius: cs.borderTopLeftRadius, viewer: f.hasAttribute("data-viewer-item") };
        }),
      );
      const gap = r.filter((x) => Math.abs(x.w - 2 * x.bl - x.iw) > 1.5 || Math.abs(x.h - x.bt - x.bb - x.ih) > 1.5);
      ok(`A1 ${label} : le cadre entoure exactement la photo ou la vidéo (aucun vide entre le cadre et le média : ancien cadrage, image entière, hauteur très grande, grilles, vidéos)`, r.length >= 14 && gap.length === 0, JSON.stringify(gap.slice(0, 4)));
      const small = r.filter((x) => x.free && x.iw < x.w * 0.5);
      ok(`A2 ${label} : Planche libre, le cadre ne mange jamais une petite image (média ≥ moitié de la boîte)`, r.some((x) => x.free) && small.length === 0, JSON.stringify(small));
      if (label === "1440") {
        const rounded = r.filter((x) => x.radius === "20px" && x.kind === "image");
        ok("A3 cadre du kit + arrondi fort : les coins du dessin suivent l'arrondi (clip-path)", rounded.length >= 2 && rounded.some((x) => /round/.test(x.clip)), JSON.stringify(rounded.map((x) => x.clip)));
        const box = await p.evaluate(() => { const b = [...document.querySelectorAll("main .media-box")].at(-1); const f = b?.querySelector(".media-frame"); return b && f ? { bw: b.offsetWidth, bh: b.offsetHeight, fw: f.offsetWidth, fh: f.offsetHeight, bg: getComputedStyle(b).backgroundColor } : null; });
        ok("A4 image entière au format 16:9 : la case garde son format et son fond, le cadre a le format de la PHOTO (3:4)", box && near(box.bw / box.bh, 16 / 9, 0.02) && near(box.fw / box.fh, 0.667, 0.03) && box.fh <= box.bh + 1 && box.bg === "rgb(255, 224, 224)", JSON.stringify(box));
      }
      await p.context().close();
    }
    // Aperçu du site (VIS-02) : la visionneuse s'ouvre sur la photo.
    const fr = await openEditor(page, BASE, PHOTOS);
    await settled(page);
    await page.getByRole("button", { name: "Aperçu", exact: true }).click();
    await sleep(3500);
    const frame2 = await (await page.waitForSelector("iframe.ve-frame")).contentFrame();
    const ph = frame2.locator("figure.block-image .media-frame").nth(2);
    await ph.scrollIntoViewIfNeeded();
    const bb = await ph.boundingBox();
    await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
    ok("A5 mode Aperçu du site : un clic sur la photo ouvre la visionneuse", await waitFor(async () => (await frame2.locator('[role="dialog"]').count()) > 0, 10000));
    void fr;
  });
console.log(errors.length ? `ERREURS PAGE : ${errors.slice(0, 5).join(" | ")}` : "aucune erreur de page");
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout est vert");
process.exit(failures ? 1 : 0);
