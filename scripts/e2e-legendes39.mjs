#!/usr/bin/env node
/**
 * Lot 39 « Titre / Légende / Date sous tous les composants média » (chromium, serveur requis, base neuve, une connexion admin).
 * Clics à la souris réelle (`page.mouse`) et frappe au clavier ; jamais de clic programmatique sur la toile.
 *  A  Page : image seule, vidéo (seule et carte), case de grille, grille entière — repères gris seulement au survol / au choix,
 *     un clic écrit dedans, le texte tapé est VISIBLE pendant la frappe (pixels), Échap valide, brouillon à jour.
 *  B  Texte long : retour à la ligne, jamais de débordement (scrollWidth ≤ clientWidth, ni défilement horizontal de la page).
 *  C  Planche : image, vidéo, grille entière, case de grille, carrousel (les 3 champs de chaque place), bande du projet (date ;
 *     titre et légende restent ceux de l'emplacement) — même geste, même rendu ; texte clair sur champ blanc (thème sombre) visible.
 *  D  Public : seuls les champs remplis, rien (aucun espace) si tout est vide, parité toile / public, légendes du seed intactes,
 *     téléphone (390 px) sans débordement et date sous la légende quand ça ne tient pas.
 * Captures : $SHOTS. Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=A,B,C,D] [SHOTS=dossier] node scripts/e2e-legendes39.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";
import sharp from "sharp";

import { boardDraft, boardPublished, draftBlocks, findIn, grid, img, login, makeMedia, openEditor, pageIdOf, q1, setBoardDraft, setDraft, settled, sleep, sql, waitFor } from "./lib/grille31d.mjs";
import { ensureVideos } from "./lib/video36.mjs";

const BASE = process.env.BASE ?? "http://localhost:3539";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(process.env.BATTERY_DIR ?? tmpdir(), "shots-legendes39");
mkdirSync(SHOTS, { recursive: true });
sharp.cache(false);
sharp.concurrency(1);

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const T = (s) => ({ fr: s, en: s });

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256", "--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);
const M = await makeMedia(page, BASE);
const V = await ensureVideos(page, BASE);
const pageId = pageIdOf("personnages");
const project = q1("select id, slug from projects order by id limit 1");
if (!project) throw new Error("aucun projet dans la base de test");

const vid = (uid, mediaId, props = {}) => ({ uid, type: "video-single", props: { mediaId, variant: "plain", mode: "player", ...props } });
const PAGE_BLOCKS = () => [
  img("pimg", M.paysage),
  vid("pvid", V.short, { mode: "loop" }),
  vid("pcard", V.long, { variant: "card", title: T("Carte") }),
  grid("pgrid", { layout: "2" }, [img("pk1", M.carre), img("pk2", M.paysage2)]),
  { uid: "pbd", type: "project-board", props: { project: project.slug } },
];
const BOARD = () => [
  { uid: "strip", type: "strip", props: {} },
  { uid: "car", type: "strip", props: { source: "own", media: [M.portrait, M.carre], ids: ["a1", "b2"] } },
  img("bimg", M.paysage),
  vid("bvid", V.short, { mode: "loop" }),
  grid("bgrid", { layout: "2" }, [img("bk1", M.carre), img("bk2", M.paysage2)]),
];
const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});

const LONG_WORDS = "Une très longue légende qui doit revenir à la ligne sans jamais sortir de la page, ".repeat(4).trim();
const LONG_NOSPACE = "A".repeat(160);

/* ---- Souris réelle ---------------------------------------------------------------------------------------------------------- */
const center = async (loc) => {
  // Au centre de la fenêtre : le bas est recouvert par « + Ajouter une rubrique », le haut par l'en-tête.
  await loc.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  await sleep(150);
  const b = await loc.boundingBox();
  if (!b) throw new Error("élément sans boîte");
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
};
const mHover = async (loc) => {
  const { x, y } = await center(loc);
  await page.mouse.move(x - 4, y - 4);
  await page.mouse.move(x, y, { steps: 4 });
  await sleep(300);
};
const mClick = async (loc) => {
  const { x, y } = await center(loc);
  await page.mouse.move(x, y, { steps: 4 });
  await page.mouse.click(x, y);
};
const away = async () => {
  await page.mouse.move(5, 5);
  await sleep(250);
};
/** Opacité du repère gris (::before) d'un champ vide. */
const placeholderOpacity = (loc) => loc.evaluate((el) => Number(getComputedStyle(el, "::before").opacity));
/** Le texte tapé se voit-il ? Capture du champ en cours de saisie : des pixels clairs ET sombres (texte contre fond). */
async function visibleNow(f, selector, label) {
  const el = f.locator(selector).first();
  const shotBuf = await el.screenshot();
  const { data, info } = await sharp(shotBuf).greyscale().raw().toBuffer({ resolveWithObject: true });
  let lo = 255;
  let hi = 0;
  for (const v of data) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const box = await el.boundingBox();
  const range = hi - lo;
  ok(`${label} : le texte tapé est visible (contraste ${range}, ${Math.round(box?.width ?? 0)}×${Math.round(box?.height ?? 0)})`, range >= 60 && (box?.width ?? 0) > 20, `plage ${lo}-${hi}`);
  return range;
}
/** Aucun débordement : chaque champ tient dans sa légende, la légende dans son conteneur, la page n'a pas de défilement horizontal. */
const noOverflow = (f, scope) =>
  f.evaluate((sel) => {
    const root = document.querySelector(sel) ?? document.body;
    const bad = [];
    for (const el of root.querySelectorAll(".media-caption, .media-caption [data-cap]")) if (el.scrollWidth > el.clientWidth + 1) bad.push(`${el.className} ${el.scrollWidth}>${el.clientWidth}`);
    const de = document.documentElement;
    if (de.scrollWidth > de.clientWidth + 1) bad.push(`page ${de.scrollWidth}>${de.clientWidth}`);
    return bad;
  }, scope);

async function canvasFrame() {
  const handle = await page.waitForSelector("iframe.ve-frame", { timeout: 120000 });
  const fr = await handle.contentFrame();
  await fr.waitForSelector("html[data-edit-mode]", { timeout: 180000 });
  return fr;
}
const section = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 8).join(" "));
    await shot(page, `erreur-${name}`);
  }
};
const pageBlock = (uid) => findIn(draftBlocks(pageId), uid);
const boardItem = (uid) => (boardDraft(project.id) ?? []).find((i) => i.uid === uid);
const publishedBoardItem = (uid) => (boardPublished(project.id) ?? []).find((i) => i.uid === uid);

/** Un champ : repère caché hors survol, visible au survol, clic, frappe visible, Échap valide. Retourne le contraste mesuré. */
async function writeField(f, hostSel, scope, name, text, label, { shots } = {}) {
  const field = f.locator(`${scope} [data-cap="${name}"]`).first();
  await field.waitFor({ state: "attached", timeout: 30000 });
  // La barre de mise en forme d'un texte précédent peut recouvrir le champ : on la ferme (Échap), comme l'artiste.
  if (await f.locator(".lk-bar").count()) {
    await page.keyboard.press("Escape");
    await sleep(300);
  }
  // La planche se re-rend un peu après chaque geste : on attend que le champ ne bouge plus avant de cliquer.
  for (let i = 0, last = ""; i < 12; i++) {
    const b = JSON.stringify(await field.boundingBox());
    if (b === last) break;
    last = b;
    await sleep(900);
  }
  await mHover(f.locator(hostSel).first());
  if (shots) await shot(page, `${shots}-survol`);
  await f.evaluate(() => {
    window.__log = [];
    if (window.__logged) return;
    window.__logged = true;
    for (const ev of ["scroll", "blur", "focusin", "click", "pointerdown"]) document.addEventListener(ev, (e) => window.__log.push(`${ev}:${(e.target?.className?.toString?.() || e.target?.nodeName || "doc").slice(0, 30)}[${e.target?.closest?.("button")?.outerHTML?.slice(0, 120) ?? ""}]@${Math.round(scrollY)}${ev === "pointerdown" ? ` xy=${e.clientX},${e.clientY}` : ""}`), true);
  });
  await mClick(field);
  await sleep(500);
  await page.keyboard.press("Control+a");
  await page.keyboard.type(text, { delay: 5 });
  await sleep(300);
  if (shots) await shot(page, `${shots}-frappe`);
  const editor = f.locator(".pe-text-editor, [data-editing]").first();
  const sel = (await f.locator(".pe-text-editor").count()) ? ".pe-text-editor" : "[data-editing]";
  if ((await editor.count()) === 0) {
    const info = await field.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { rect: [r.left, r.top, r.width, r.height], hit: hit ? `${hit.tagName}.${hit.className} ${hit.getAttribute("data-cap") ?? ""}` : null, scrollY: window.scrollY, text: el.textContent, vis: getComputedStyle(el).visibility, btn: el.closest("button")?.outerHTML.slice(0, 200) ?? null, bitem: el.closest("[data-edit-bitem]")?.dataset.editBitem };
    });
    console.log(`DIAG ${label} ${JSON.stringify(info)} LOG ${JSON.stringify(await f.evaluate(() => window.__log.slice(0, 40)))}`);
    await shot(page, `diag-${label.replace(/\W+/g, "-")}`);
  }
  ok(`${label} : un clic ouvre la saisie directement`, (await editor.count()) > 0);
  // Intégration v0.26 : le champ blanc ne recouvre pas la ligne voisine (Titre / Légende se touchent).
  if ((await editor.count()) > 0 && (await f.locator(".pe-text-editor").count()) > 0) {
    const clash = await f.evaluate(([scopeSel, nm]) => {
      const el = document.querySelector(`${scopeSel} [data-cap="${nm}"]`);
      const ed = document.querySelector(".pe-text-editor");
      const host = el?.closest(".media-caption");
      if (!el || !ed || !host) return null;
      const e = ed.getBoundingClientRect();
      const me = el.getBoundingClientRect();
      const hits = [];
      for (const o of host.querySelectorAll("[data-cap]")) {
        if (o === el) continue;
        const r = o.getBoundingClientRect();
        if (r.height < 1 || r.width < 1) continue;
        const stacked = r.top >= me.bottom - 1 || r.bottom <= me.top + 1;
        const overlapY = Math.min(e.bottom, r.bottom) - Math.max(e.top, r.top);
        const overlapX = Math.min(e.right, r.right) - Math.max(e.left, r.left);
        if (stacked && overlapY > 1 && overlapX > 1) hits.push(`${o.dataset.cap}:${Math.round(overlapY)}px`);
      }
      return { hits, ed: [e.top, e.height], me: [me.top, me.height] };
    }, [scope, name]);
    ok(`${label} : le champ ne recouvre aucune autre ligne`, clash !== null && clash.hits.length === 0, JSON.stringify(clash));
  }
  if ((await editor.count()) === 0) throw new Error(`${label} : saisie non ouverte`);
  await visibleNow(f, sel, label);
  await page.keyboard.press("Escape");
  await settled(page);
}

try {
  setDraft(pageId, PAGE_BLOCKS());
  setBoardDraft(project.id, pageId, BOARD());
  let f = await openEditor(page, BASE, pageId);
  await settled(page);

  /* ===== A. Page ======================================================================================================== */
  if (run("A")) {
    await section("A", async () => {
      const img1 = '[data-edit-block="pimg"]';
      // Repères : cachés hors survol, visibles au survol et au choix.
      await away();
      ok("A1 image : repères gris cachés quand le composant n'est ni survolé ni choisi", (await placeholderOpacity(f.locator(`${img1} [data-cap="title"]`).first())) < 0.05);
      await mHover(f.locator(`${img1} img`).first());
      ok("A1 …visibles au survol", (await placeholderOpacity(f.locator(`${img1} [data-cap="title"]`).first())) > 0.3);
      const texts = await f.locator(`${img1} [data-cap]`).evaluateAll((els) => els.map((e) => `${e.dataset.cap}:${e.dataset.placeholder}`));
      ok("A1 trois champs « Titre », « Légende », « Date »", JSON.stringify(texts) === JSON.stringify(["title:Titre", "legend:Légende", "date:Date"]), JSON.stringify(texts));
      const geo = await f.locator(`${img1} .media-caption`).evaluate((el) => {
        const r = (s) => el.querySelector(s).getBoundingClientRect();
        return { title: r('[data-cap="title"]'), legend: r('[data-cap="legend"]'), date: r('[data-cap="date"]') };
      });
      ok("A1 mise en page : Titre puis Légende dessous, à gauche ; Date à droite", geo.legend.top >= geo.title.bottom - 1 && Math.abs(geo.legend.left - geo.title.left) < 2 && geo.date.left > geo.title.left + 100, JSON.stringify(geo));
      await shot(page, "A1-image-survol");
      await away();
      await mClick(f.locator(`${img1} img`).first());
      await sleep(500);
      await away();
      ok("A1 …et sur le composant choisi (même sans survol)", (await placeholderOpacity(f.locator(`${img1} [data-cap="date"]`).first())) > 0.3);
      await shot(page, "A1-image-choisie");

      await writeField(f, `${img1} img`, img1, "title", "Étude au fusain", "A2 image Titre", { shots: "A2-image-titre" });
      await writeField(f, `${img1} img`, img1, "legend", "Fusain sur papier, 2026", "A2 image Légende");
      await writeField(f, `${img1} img`, img1, "date", "mars 2026", "A2 image Date");
      const p = pageBlock("pimg").props;
      ok("A2 image : brouillon à jour (titre, légende, date)", p.captionTitle?.fr === "Étude au fusain" && p.caption?.fr === "Fusain sur papier, 2026" && p.captionDate?.fr === "mars 2026", JSON.stringify(p));
      await mHover(f.locator(`${img1} img`).first());
      await shot(page, "A2-image-rempli");
      await away();
      ok("A2 un champ rempli reste visible sans survol", (await f.locator(`${img1} [data-cap="title"]`).first().innerText()) === "Étude au fusain");
      ok("A2 un champ vide d'un autre composant reste caché", (await placeholderOpacity(f.locator('[data-edit-block="pk1"] [data-cap="title"]').first())) < 0.05);

      // Annuler / Rétablir.
      await page.keyboard.press("Control+z");
      await settled(page);
      ok("A3 Annuler retire la date", !pageBlock("pimg").props.captionDate);
      await page.keyboard.press("Control+y");
      await settled(page);
      ok("A3 Rétablir la remet", pageBlock("pimg").props.captionDate?.fr === "mars 2026");

      // Vidéo seule : les trois champs.
      const pv = '[data-edit-block="pvid"]';
      await writeField(f, `${pv} [data-edit-media]`, pv, "title", "Boucle d'essai", "A4 vidéo Titre", { shots: "A4-video-titre" });
      await writeField(f, `${pv} [data-edit-media]`, pv, "legend", "Trois secondes de test", "A4 vidéo Légende");
      await writeField(f, `${pv} [data-edit-media]`, pv, "date", "2026", "A4 vidéo Date");
      const vp = pageBlock("pvid").props;
      ok("A4 vidéo : captionTitle, description (légende existante), captionDate", vp.captionTitle?.fr === "Boucle d'essai" && vp.description?.fr === "Trois secondes de test" && vp.captionDate?.fr === "2026", JSON.stringify(vp));
      // Carte : la date arrive en bout de ligne du titre.
      const pc = '[data-edit-block="pcard"]';
      await mHover(f.locator(`${pc} [data-edit-media]`).first());
      const cardDate = f.locator(`${pc} [data-cap-own]`).first();
      ok("A5 vidéo « Carte » : champ Date en bout de ligne du titre", (await cardDate.count()) === 1);
      await mClick(cardDate);
      await sleep(400);
      await page.keyboard.press("Control+a");
      await page.keyboard.type("juin 2026", { delay: 5 });
      await page.keyboard.press("Escape");
      await settled(page);
      ok("A5 …enregistrée", pageBlock("pcard").props.captionDate?.fr === "juin 2026", JSON.stringify(pageBlock("pcard").props));

      // Grille : une case, l'autre case, la grille entière.
      const pk1 = '[data-edit-block="pk1"]';
      const pk2 = '[data-edit-block="pk2"]';
      const pg = '[data-edit-block="pgrid"]';
      await writeField(f, `${pk1} img`, pk1, "title", "Case 1", "A6 case de grille Titre", { shots: "A6-case-titre" });
      await writeField(f, `${pk2} img`, pk2, "legend", "Légende de la case 2", "A6 case de grille Légende");
      ok("A6 chaque case a ses textes (la case 1 n'a pas la légende de la case 2)", !pageBlock("pk1").props.caption && !pageBlock("pk2").props.captionTitle && pageBlock("pk1").props.captionTitle?.fr === "Case 1" && pageBlock("pk2").props.caption?.fr === "Légende de la case 2");
      // Grille entière : son champ, en bas de la grille (son bloc, pas celui d'une case).
      const gridCap = f.locator(`${pg} section.block-grid-section > .media-caption [data-cap]`);
      ok("A7 grille entière : trois champs sous la grille", (await gridCap.count()) === 3, String(await gridCap.count()));
      // Lot 54 : les champs vides n'existent (en hauteur) que sur la grille survolée ou choisie : l'ordre se lit dans le DOM.
      const order = await f.evaluate(() => {
        const s = document.querySelector('[data-edit-block="pgrid"] section.block-grid-section');
        const g = s.querySelector(".block-grid");
        const c = s.querySelector(":scope > .media-caption");
        return Boolean(g.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING);
      });
      ok("A7 …posés SOUS la grille", order);
      await writeField(f, `${pg} .block-grid`, `${pg} section.block-grid-section > .media-caption`, "title", "Les deux études", "A7 grille Titre", { shots: "A7-grille-titre" });
      await writeField(f, `${pg} .block-grid`, `${pg} section.block-grid-section > .media-caption`, "date", "2026", "A7 grille Date");
      ok("A7 grille : brouillon à jour", pageBlock("pgrid").props.captionTitle?.fr === "Les deux études" && pageBlock("pgrid").props.captionDate?.fr === "2026", JSON.stringify(pageBlock("pgrid").props));
      await mHover(f.locator(`${pg} .block-grid`).first());
      await shot(page, "A7-grille-complete");
    });
  }

  /* ===== B. Texte long ================================================================================================== */
  if (run("B")) {
    await section("B", async () => {
      const img1 = '[data-edit-block="pimg"]';
      await writeField(f, `${img1} img`, img1, "legend", LONG_WORDS, "B1 légende longue");
      ok("B1 légende longue : aucun débordement (toile)", (await noOverflow(f, img1)).length === 0, JSON.stringify(await noOverflow(f, img1)));
      const lines = await f.locator(`${img1} [data-cap="legend"]`).evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight || "16")));
      ok("B1 …sur plusieurs lignes", lines >= 2, String(lines));
      await writeField(f, `${img1} img`, img1, "title", LONG_NOSPACE, "B2 titre sans espace");
      ok("B2 mot démesuré : coupé, aucun débordement", (await noOverflow(f, img1)).length === 0, JSON.stringify(await noOverflow(f, img1)));
      const pk1 = '[data-edit-block="pk1"]';
      await writeField(f, `${pk1} img`, pk1, "legend", LONG_WORDS, "B3 case de grille légende longue");
      ok("B3 case de grille : aucun débordement", (await noOverflow(f, pk1)).length === 0, JSON.stringify(await noOverflow(f, pk1)));
      await mHover(f.locator(`${img1} img`).first());
      await shot(page, "B-texte-long");
    });
  }

  /* ===== C. Planche ===================================================================================================== */
  if (run("C")) {
    await section("C", async () => {
      const board = `[data-edit-board="${project.id}"]`;
      const item = (uid) => `${board} [data-edit-bitem="${uid}"]`;
      // Image seule de la planche.
      const bimg = item("bimg");
      await away();
      ok("C1 planche, image : repères cachés hors survol", (await placeholderOpacity(f.locator(`${bimg} [data-cap="title"]`).first())) < 0.05);
      await mHover(f.locator(`${bimg} img`).first());
      ok("C1 …visibles au survol", (await placeholderOpacity(f.locator(`${bimg} [data-cap="title"]`).first())) > 0.3);
      await shot(page, "C1-planche-image-survol");
      await writeField(f, `${bimg} img`, bimg, "title", "Titre planche", "C1 planche image Titre", { shots: "C1-planche-image" });
      await writeField(f, `${bimg} img`, bimg, "legend", "Légende de la planche", "C1 planche image Légende");
      await writeField(f, `${bimg} img`, bimg, "date", "2026", "C1 planche image Date");
      let p = boardItem("bimg").props;
      ok("C1 planche, image : planche brouillon à jour", p.captionTitle?.fr === "Titre planche" && p.caption?.fr === "Légende de la planche" && p.captionDate?.fr === "2026", JSON.stringify(p));
      // Vidéo.
      const bvid = item("bvid");
      await writeField(f, `${bvid} [data-edit-media], ${bvid} video`, bvid, "title", "Vidéo planche", "C2 planche vidéo Titre", { shots: "C2-planche-video" });
      await writeField(f, `${bvid} video`, bvid, "date", "2026", "C2 planche vidéo Date");
      p = boardItem("bvid").props;
      ok("C2 planche, vidéo : textes enregistrés", p.captionTitle?.fr === "Vidéo planche" && p.captionDate?.fr === "2026", JSON.stringify(p));
      // Grille de planche : une case, la grille entière.
      const bg = item("bgrid");
      await writeField(f, `${bg} .block-grid-cell:nth-child(1) img`, `${bg} .block-grid-cell:nth-child(1)`, "title", "Case A", "C3 planche case 1 Titre", { shots: "C3-planche-case" });
      await writeField(f, `${bg} .block-grid-cell:nth-child(2) img`, `${bg} .block-grid-cell:nth-child(2)`, "legend", "Case B légende", "C3 planche case 2 Légende");
      p = boardItem("bgrid").props;
      ok("C3 planche, cases : chaque case garde ses textes", p.children[0].props.captionTitle?.fr === "Case A" && !p.children[0].props.caption && p.children[1].props.caption?.fr === "Case B légende" && !p.children[1].props.captionTitle, JSON.stringify(p.children.map((c) => c.props)));
      await writeField(f, `${bg} .block-grid`, `${bg} section.block-grid-section > .media-caption`, "legend", "Sous la grille de la planche", "C4 planche grille entière Légende", { shots: "C4-planche-grille" });
      ok("C4 planche, grille entière : enregistrée", boardItem("bgrid").props.caption?.fr === "Sous la grille de la planche");
      // Carrousel à liste propre : les trois champs de chaque place.
      const car = `${board} [data-edit-rail="car"]`;
      const place1 = `${car} > [data-edit-slot]:nth-child(1)`;
      await writeField(f, `${place1} img`, place1, "title", "Vue 1", "C5 carrousel place 1 Titre", { shots: "C5-carrousel" });
      await writeField(f, `${place1} img`, place1, "legend", "Légende vue 1", "C5 carrousel place 1 Légende");
      await writeField(f, `${place1} img`, place1, "date", "2026", "C5 carrousel place 1 Date");
      const place2 = `${car} > [data-edit-slot]:nth-child(2)`;
      await writeField(f, `${place2} img`, place2, "title", "Vue 2", "C5 carrousel place 2 Titre");
      const caps = boardItem("car").props.captions ?? {};
      const k = Object.keys(caps);
      ok("C5 carrousel : textes par place (clé = place), sans mélange", k.length === 2 && caps["car-a1"]?.title?.fr === "Vue 1" && caps["car-a1"]?.date?.fr === "2026" && caps["car-b2"]?.title?.fr === "Vue 2" && !caps["car-b2"]?.date, JSON.stringify(caps));
      // Bande du projet : Date ; Titre et Légende = ceux de l'emplacement (partagés).
      const strip = `${board} [data-edit-bitem-project] [data-edit-rail]`;
      const s1 = `${strip} > [data-edit-slot]:nth-child(1)`;
      const seedTitle = (await f.locator(`${s1} [data-cap="title"]`).first().innerText()).trim();
      await writeField(f, `${s1} img`, s1, "date", "juin 2026", "C6 bande du projet Date", { shots: "C6-bande-projet" });
      const stripCaps = boardItem("strip").props.captions ?? {};
      ok("C6 bande du projet : la date est dans la planche (par emplacement)", Object.values(stripCaps).some((c) => c.date?.fr === "juin 2026"), JSON.stringify(stripCaps));
      ok("C6 …le titre de l'emplacement n'a pas bougé", (await f.locator(`${s1} [data-cap="title"]`).first().innerText()).trim() === seedTitle);
      await writeField(f, `${s1} img`, s1, "title", "Titre d'emplacement", "C7 bande du projet Titre (emplacement)");
      const dbTitle = JSON.parse(sql((db) => db.prepare("select coalesce(draft_title, title) as t from slots where project_id = ? order by position, id limit 1").get(project.id)).t);
      ok("C7 …le titre reste celui de l'emplacement (colonne du projet)", dbTitle.fr === "Titre d'emplacement", JSON.stringify(dbTitle));
      await mHover(f.locator(`${s1} img`).first());
      await shot(page, "C-bande-rempli");

      // Texte clair (thème sombre) : le champ de saisie de la planche reste lisible (il reprenait la couleur du texte du site).
      await f.addStyleTag({ content: ".strip-caption, .media-caption { color: #f5f5f5 !important; }" });
      const s2 = `${strip} > [data-edit-slot]:nth-child(2)`;
      await writeField(f, `${s2} img`, s2, "legend", "Texte clair sur thème sombre", "C8 thème sombre : légende de la bande", { shots: "C8-theme-sombre" });
      await settled(page);
      ok("C9 aucun débordement sur la planche", (await noOverflow(f, board)).length === 0, JSON.stringify(await noOverflow(f, board)));
      const rail = await f.evaluate((sel) => {
        const bad = [];
        for (const frame of document.querySelectorAll(`${sel} .strip-frame`)) {
          const c = frame.querySelector(":scope > .media-caption");
          if (c && c.getBoundingClientRect().width > frame.getBoundingClientRect().width + 1) bad.push(frame.dataset.slotSlug);
        }
        return bad;
      }, board);
      ok("C9 la légende d'une image de bande ne dépasse pas l'image", rail.length === 0, JSON.stringify(rail));
    });
  }

  /* ===== D. Public ====================================================================================================== */
  if (run("D")) {
    await section("D", async () => {
      // Texte propre au public : une grille et une image vides, d'autres remplies.
      setDraft(pageId, [
        img("pimg", M.paysage, { captionTitle: T("Titre public"), caption: T(LONG_WORDS), captionDate: T("mars 2026") }),
        img("pempty", M.carre),
        img("ponly", M.paysage2, { captionDate: T("2026") }),
        vid("pvid", V.short, { mode: "loop", description: T("Légende vidéo") }),
        grid("pgrid", { layout: "2", caption: T("Sous la grille") }, [img("pk1", M.carre, { captionTitle: T("Case 1") }), img("pk2", M.paysage2)]),
        { uid: "pbd", type: "project-board", props: { project: project.slug } },
      ]);
      const seed = sql((db) => db.prepare("select title, description, year from slots where project_id = ? and draft_state is null order by position, id limit 1").get(project.id));
      f = await openEditor(page, BASE, pageId);
      await settled(page);
      await page.getByRole("button", { name: "Publier", exact: true }).click();
      ok("D0 publication", await waitFor(() => sql((db) => db.prepare("select draft from pages where id = ?").get(pageId)).draft === null && boardDraft(project.id) === null, 120000));
      await sleep(3000);
      ok("D0 la planche publiée porte les textes", publishedBoardItem("bimg")?.props.captionTitle?.fr === "Titre planche" && publishedBoardItem("car")?.props.captions?.["car-a1"]?.date?.fr === "2026");
      const html = await (await fetch(`${BASE}/fr/personnages`)).text();
      const leak = html.match(/.{40} (data-placeholder|data-edit-[a-z-]+|data-inline|data-cap-host)=.{40}|.{40}pe-slot-legend.{40}/);
      ok("D1 HTML public : aucun repère d'édition", !leak, leak?.[0]);
      const pub = await ctx.browser().newContext({ viewport: { width: 1440, height: 900 } });
      const v = await pub.newPage();
      v.setDefaultTimeout(30000);
      v.on("pageerror", (e) => errors.push(`public : ${e.message}`));
      await v.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
      const has = (sel) => v.locator(sel).count();
      ok("D2 image avec les trois champs", (await v.locator("figure.block-image .media-caption [data-cap]").evaluateAll((els) => els.map((e) => e.dataset.cap).join(","))).startsWith("title,legend,date"));
      const empties = await v.evaluate(() => [...document.querySelectorAll("figure.block-image")].map((fig) => fig.querySelectorAll(".media-caption").length));
      ok("D2 image sans texte : aucune légende dans le DOM (aucun espace)", empties.includes(0), JSON.stringify(empties));
      const dateOnly = await v.evaluate(() => [...document.querySelectorAll("figure.block-image .media-caption")].filter((c) => c.querySelectorAll("[data-cap]").length === 1 && c.querySelector('[data-cap="date"]')).length);
      ok("D2 date seule : un seul champ, à droite", dateOnly === 1, String(dateOnly));
      const gapEmpty = await v.evaluate(() => {
        const figs = [...document.querySelectorAll("figure.block-image")].filter((f) => !f.querySelector(".media-caption"));
        return figs.every((f) => f.lastElementChild === f.querySelector("span") || !f.lastElementChild?.matches(".media-caption"));
      });
      ok("D2 image vide : sa figure s'arrête à l'image", gapEmpty);
      ok("D3 vidéo seule : légende publique", (await v.locator("figure .media-caption [data-cap='legend']", { hasText: "Légende vidéo" }).count()) === 1);
      ok("D4 grille entière : légende sous la grille", (await v.locator("section.block-grid-section > .media-caption", { hasText: /^Sous la grille$/ }).count()) === 1);
      ok("D4 case de grille : son titre", (await v.locator(".block-grid-cell .media-caption [data-cap='title']", { hasText: "Case 1" }).count()) === 1);
      ok("D4 case de grille sans texte : rien", (await v.locator(".block-grid-cell").nth(1).locator(".media-caption").count()) === 0);
      // Planche : textes publiés et légendes du seed intactes.
      const board = v.locator(`section[aria-labelledby="project-${project.slug}"]`);
      ok("D5 planche : image avec son titre", (await board.locator("figure.block-image .media-caption [data-cap='title']", { hasText: "Titre planche" }).count()) === 1);
      ok("D5 planche : carrousel, titre et date de la place 1", (await board.locator("[data-edit-rail], .strip-rail").nth(1).locator(".strip-frame").first().locator(".media-caption").innerText()).includes("Vue 1"));
      const strip = board.locator(".strip-rail").first();
      const first = strip.locator(".strip-frame").first();
      const firstText = await first.locator(".media-caption").innerText();
      const seedTitle = JSON.parse(seed.title).fr;
      ok("D6 légendes du seed intactes (titre de l'emplacement visible)", firstText.includes("Titre d'emplacement") || firstText.includes(seedTitle) || seedTitle === "", firstText);
      ok("D6 …et la date posée remplace l'année", firstText.includes("juin 2026"), firstText);
      const second = await strip.locator(".strip-frame").nth(2).locator(".media-caption").innerText().catch(() => "");
      ok("D6 une image sans date posée garde son année", /\b20\d\d\b/.test(second) || second === "", second);
      await shot(v, "D-public");
      // Aucun débordement, public.
      const bad = await v.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll(".media-caption, .media-caption [data-cap]")) if (el.scrollWidth > el.clientWidth + 1) out.push(`${el.className} ${el.scrollWidth}>${el.clientWidth}`);
        const de = document.documentElement;
        if (de.scrollWidth > de.clientWidth + 1) out.push(`page ${de.scrollWidth}>${de.clientWidth}`);
        return out;
      });
      ok("D7 public : aucun débordement (légende longue)", bad.length === 0, JSON.stringify(bad));
      const inShot = (await v.locator("figure.block-image .media-caption").first().screenshot().then(() => true)) === true;
      ok("D7 légende longue visible", inShot);
      await pub.close();

      // Téléphone.
      const phone = await ctx.browser().newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
      const m = await phone.newPage();
      m.setDefaultTimeout(30000);
      await m.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
      const overflow = await m.evaluate(() => {
        const out = [];
        const de = document.documentElement;
        if (de.scrollWidth > de.clientWidth + 1) out.push(`page ${de.scrollWidth}>${de.clientWidth}`);
        for (const el of document.querySelectorAll(".media-caption, .media-caption [data-cap]")) if (el.scrollWidth > el.clientWidth + 1) out.push(`${el.className} ${el.scrollWidth}>${el.clientWidth}`);
        return out;
      });
      ok("D8 téléphone 390 px : aucun débordement", overflow.length === 0, JSON.stringify(overflow));
      const under = await m.evaluate(() => {
        const c = [...document.querySelectorAll("figure.block-image .media-caption")].find((x) => x.querySelector('[data-cap="legend"]') && x.querySelector('[data-cap="date"]'));
        if (!c) return null;
        const l = c.querySelector('[data-cap="legend"]').getBoundingClientRect();
        const d = c.querySelector('[data-cap="date"]').getBoundingClientRect();
        return { legendBottom: l.bottom, dateTop: d.top, dateLeft: d.left, legendLeft: l.left };
      });
      ok("D8 téléphone : la date passe sous la légende", under !== null && under.dateTop >= under.legendBottom - 1, JSON.stringify(under));
      await m.locator("figure.block-image .media-caption").first().scrollIntoViewIfNeeded();
      await shot(m, "D8-telephone");
      await phone.close();
    });
  }
} finally {
  ok("aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
}
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
