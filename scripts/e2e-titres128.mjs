#!/usr/bin/env node
/**
 * Lot 128 « titres dans les composants », étape 1 (chromium, serveur requis, base neuve). Souris et clavier réels ; données SYNTHÉTIQUES.
 *  A  Pastille « + Titre » : invisible hors survol, visible au survol d'une image, d'une vidéo, d'une planche libre, d'un projet.
 *  B  Clic : `head.title` créé et mis en saisie, saisie en place persistée dans le brouillon, barre « Aa » (portées Ce titre / Tout le site, puis
 *     Tout le projet sur un bloc Projet), style rangé dans `look.text["head.title"]`, sous-titre.
 *  C  Dans une carte et un fond propres : le titre est DANS `.card-in` et `.fond-in` du bloc, aucune bande de fond de plus.
 *  D  Alignement gauche / centre / droite, « Mettre dessous », « Sur l'image » (position sur l'image).
 *  E  Sous-titre <p>, titre <h2> au premier niveau puis <h3> dans une grille qui a un titre, plan de page sans saut, jamais de <h1> de plus.
 *  F  Case de grille : justifiée = captionTitle (géométrie des cases inchangée), non justifiée = `head` dans la case (h3).
 *  G  Bloc Projet : ajout, saisie, persistance, portée « Tout le projet ».
 *  H  Public après publication : titre présent, cartes et fonds identiques, aucun repère d'édition ; titre vide = aucune marge.
 *  I  Téléphone (390 px) : aucun débordement horizontal, titre long retourné à la ligne.
 *  J  Annuler / Rétablir, dupliquer le bloc (le titre suit), langues FR / EN (deux textes).
 *  R  Anciennes données : aucune clé `head`, HTML public sans repère de titre de composant (écrit dans $DUMP pour comparaison avec la base).
 * Captures : $SHOTS. Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=A,B,…] [SHOTS=dossier] [DUMP=fichier] node scripts/e2e-titres128.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { draftBlocks, findIn, grid, img, login, makeMedia, openEditor, pageIdOf, q1, setDraft, settled, sleep, sql, waitFor } from "./lib/grille31d.mjs";
import { publishBlocks } from "./lib/page-draft.mjs";

const BASE = process.env.BASE ?? "http://localhost:4400";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(process.env.BATTERY_DIR ?? tmpdir(), "shots-titres128");
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const T$ = (s) => ({ fr: s, en: s });

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.setDefaultTimeout(20000);
/** Visiteur anonyme : le site public tel que le voit le public (la session admin montre les repères d'édition). */
const anon = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const pubPage = () => anon.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);
const M = await makeMedia(page, BASE);
const pageId = pageIdOf("personnages");
const project = q1("select id, slug from projects order by id limit 1");
const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});
const section = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.stack ?? e.message).split("\n").slice(0, 14).join(" "));
    await shot(`erreur-${name}`);
  }
};

const CARD = { color: "surface" };
const FOND = { kind: "color", color: "ink", inset: "m", round: "s" };
const free = (uid, props = {}) => ({ uid, type: "free-board", props: { format: "3:2", phone: "scale", items: [{ id: "fi1", media: M.carre, x: 10, y: 10, w: 35, rot: 0, z: 0 }], ...props } });
const vid = (uid, props = {}) => ({ uid, type: "video-single", props: { variant: "card", mode: "player", ...props } });
const board = (uid, props = {}) => ({ uid, type: "project-board", props: { project: project.slug, ...props } });
const blockOf = (uid) => findIn(draftBlocks(pageId), uid);

let f;
async function open(blocks) {
  if (blocks) setDraft(pageId, blocks);
  f = await openEditor(page, BASE, pageId);
  await settled(page);
  await sleep(800);
  return f;
}
/** Premier élément ayant une boîte dans un bloc de la toile (l'enveloppe du bloc est `display: contents`). */
const inner = (uid) => f.locator(`[data-edit-block="${uid}"] :is(figure, .free-board, .strip, .video-card, section):visible`).first();
const pastille = (uid, op) => f.locator(`[data-edit-block="${uid}"] [data-head-for="${uid}"] [data-edit-field-op="${op}"]`).first();
const opacity = (loc) => loc.evaluate((e) => Number(getComputedStyle(e).opacity));
const away = async () => {
  await page.mouse.move(3, 3);
  await sleep(350);
};
async function hover(uid) {
  const el = inner(uid);
  await el.evaluate((e) => e.scrollIntoView({ block: "center", behavior: "instant" }));
  await sleep(200);
  const b = await el.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 80), { steps: 4 });
  await sleep(450);
}
async function clickOp(uid, op) {
  await hover(uid);
  await pastille(uid, op).click();
  await settled(page);
}
const until = (fn, arg, ms = 8000) => f.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
const headOf = (uid) => blockOf(uid)?.props?.head;
/** Réglage `look.<clé>` d'un bloc, attendu (l'écriture du brouillon arrive un peu après l'acquittement affiché). */
const lookIs = (uid, key, val) => waitFor(() => blockOf(uid)?.props?.look?.[key] === val, 12000);
const levels = (p) => p.evaluate(() => [...document.querySelectorAll("#contenu h1, #contenu h2, #contenu h3, #contenu h4, h1, h2, h3, h4")].filter((h, i, a) => a.indexOf(h) === i && !h.closest(".site-header, footer, .pe-layer")).map((h) => `${h.tagName.toLowerCase()}:${h.textContent.trim().slice(0, 24)}`));
async function type(text) {
  await page.keyboard.press("Control+a");
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await settled(page);
}
async function openByAa(sel) {
  const target = f.locator(sel).first();
  for (let essai = 0; essai < 4; essai++) {
    await away();
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

const SCENE = () => [
  img("ia", M.paysage),
  vid("va"),
  free("fa"),
  board("pa"),
  { ...img("ib", M.carre), props: { mediaId: M.carre, width: "wide", surface: CARD, background: FOND } },
  grid("ga", { layout: "2", ratio: "4:3", title: T$("Escales") }, [img("ga1", M.paysage), img("ga2", M.portrait)]),
];

/* ---- A. pastille --------------------------------------------------------------------------------------------------------- */
if (run("A"))
  await section("A", async () => {
    await open(SCENE());
    for (const [uid, nom] of [["ia", "image"], ["va", "vidéo"], ["fa", "planche libre"], ["pa", "projet"]]) {
      await away();
      const btn = pastille(uid, "add-head");
      ok(`A1 ${nom} : la pastille « + Titre » existe`, (await btn.count()) === 1);
      ok(`A2 ${nom} : invisible hors survol`, (await btn.count()) === 1 && (await opacity(btn)) === 0);
      await hover(uid);
      ok(`A3 ${nom} : visible au survol du bloc`, (await btn.count()) === 1 && (await opacity(btn)) === 1 && /\+ Titre/.test((await btn.textContent()) ?? ""), `opacité ${await opacity(btn).catch(() => "?")}`);
    }
    await away();
    ok("A4 la grille garde ses propres boutons (étiquette, titre) : pas de pastille de composant en plus", (await f.locator('[data-edit-block="ga"] > * [data-head-for="ga"], [data-edit-block="ga"] [data-head-for="ga"]').count()) === 0);
    ok("A5 sans titre : aucun titre de composant dans le DOM de la toile", (await f.locator(".comp-head").count()) === 0);
    await shot("a-pastille");
  });

/* ---- B. création, saisie, Aa ---------------------------------------------------------------------------------------------------- */
if (run("B"))
  await section("B", async () => {
    await open(SCENE());
    await clickOp("ia", "add-head");
    ok("B1 clic : `head.title` créé (vide, deux langues)", JSON.stringify(headOf("ia")?.title) === JSON.stringify({ fr: "", en: "" }), JSON.stringify(headOf("ia")));
    ok("B2 le champ est en saisie aussitôt (focus dans le titre)", await until(() => Boolean(document.activeElement?.closest?.('[data-inline="head.title"]')) || Boolean(document.querySelector('[data-inline="head.title"][contenteditable], [data-inline="head.title"][data-editing]')), null, 8000));
    await type("Carnet de mer");
    ok("B3 saisie en place persistée dans le brouillon", headOf("ia")?.title?.fr === "Carnet de mer", JSON.stringify(headOf("ia")));
    ok("B4 le titre est un <h2> dans le bloc, avant l'image", await f.evaluate(() => { const h = document.querySelector('[data-edit-block="ia"] h2[data-inline="head.title"]'); const fig = document.querySelector('[data-edit-block="ia"] figure'); return Boolean(h && fig && h.compareDocumentPosition(fig) & Node.DOCUMENT_POSITION_FOLLOWING); }));
    await clickOp("ia", "add-head-eyebrow");
    await type("Printemps 2026");
    ok("B5 sous-titre ajouté et saisi", headOf("ia")?.eyebrow?.fr === "Printemps 2026" && headOf("ia")?.title?.fr === "Carnet de mer", JSON.stringify(headOf("ia")));
    ok("B6 le sous-titre est un <p class=eyebrow> placé avant le titre", await f.evaluate(() => { const e = document.querySelector('[data-edit-block="ia"] p.eyebrow[data-inline="head.eyebrow"]'); const h = document.querySelector('[data-edit-block="ia"] h2[data-inline="head.title"]'); return Boolean(e && h && e.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING); }));
    // Aa : type de texte « titre » (Ce titre / Tous les titres), style local rangé dans look.text["head.title"]
    ok("B7 la barre « Aa » s'ouvre sur le titre", await openByAa('[data-edit-block="ia"] h2[data-inline="head.title"]'));
    const sc = await scopes();
    ok("B8 portées du titre de composant : Ce titre · Tous les titres · (page sans projet) pas de portée projet", sc[0] === "Ce titre" && sc.some((s) => /Tout le site|Tous les/.test(s)) && !sc.some((s) => /du projet/.test(s)), sc.join(" | "));
    await f.locator(".lk-bar .tc-italic").click();
    await settled(page);
    await waitFor(() => blockOf("ia")?.props?.look?.text?.["head.title"]?.italic === true, 12000);
    const look = blockOf("ia")?.props?.look;
    ok("B9 style rangé dans look.text[\"head.title\"] (cet élément)", look?.text?.["head.title"]?.italic === true, JSON.stringify(look));
    ok("B10 le style s'applique au titre, pas à l'image ni au sous-titre", await f.evaluate(() => getComputedStyle(document.querySelector('[data-edit-block="ia"] h2[data-inline="head.title"]')).fontStyle === "italic" && getComputedStyle(document.querySelector('[data-edit-block="ia"] p.eyebrow[data-inline="head.eyebrow"]')).fontStyle !== "italic"));
    await closeBar();
    await shot("b-titre-image");
    // Sous-titre : retrait
    await clickOp("ia", "remove-head-eyebrow");
    ok("B11 « Retirer le sous-titre » : seul le sous-titre part", headOf("ia")?.eyebrow === undefined && headOf("ia")?.title?.fr === "Carnet de mer", JSON.stringify(headOf("ia")));
    // Retrait du titre : plus aucune clé
    await clickOp("ia", "remove-head");
    ok("B12 « Retirer le titre » : aucune clé `head` résiduelle", !("head" in (blockOf("ia")?.props ?? {})), JSON.stringify(blockOf("ia")?.props));
    ok("B13 plus de titre dans la toile", (await f.locator('[data-edit-block="ia"] .comp-head').count()) === 0);
  });

/* ---- C. carte et fond ---------------------------------------------------------------------------------------------------------- */
if (run("C"))
  await section("C", async () => {
    await open(SCENE());
    const before = await f.evaluate(() => document.querySelectorAll(".fond-bloc").length);
    await clickOp("ib", "add-head");
    await type("Dans la carte");
    const info = await f.evaluate(() => {
      const h = document.querySelector('[data-edit-block="ib"] h2[data-inline="head.title"]');
      return { inCard: Boolean(h?.closest(".card-in")), inFond: Boolean(h?.closest(".fond-in")), after: document.querySelectorAll(".fond-bloc").length, cards: document.querySelectorAll('[data-edit-block="ib"] .surface-card').length, fonds: document.querySelectorAll('[data-edit-block="ib"] .fond-bloc').length, own: Boolean(h?.closest(".fond-bloc, .surface-card")?.closest("[data-edit-block]")?.dataset.editBlock === "ib") };
    });
    ok("C1 le titre est dans la carte du bloc (.card-in)", info.inCard, JSON.stringify(info));
    ok("C2 le titre est dans le fond du bloc (.fond-in)", info.inFond, JSON.stringify(info));
    ok("C3 aucune bande de fond de plus (même nombre de .fond-bloc avant et après)", info.after === before, `${before} -> ${info.after}`);
    ok("C4 une seule carte et un seul fond pour ce bloc", info.cards === 1 && info.fonds >= 1 && info.fonds <= 2, JSON.stringify(info));
    const contrast = await f.evaluate(() => { const h = document.querySelector('[data-edit-block="ib"] h2[data-inline="head.title"]'); const r = h.getBoundingClientRect(); const card = h.closest(".card-in").getBoundingClientRect(); return { inside: r.top >= card.top && r.bottom <= card.bottom && r.left >= card.left && r.right <= card.right }; });
    ok("C5 la boîte du titre est entièrement dans la boîte de la carte", contrast.inside, JSON.stringify(contrast));
    await shot("c-carte-fond");
    // fusion avec un voisin de même fond : un second bloc de même fond directement après garde la fusion
    setDraft(pageId, [{ ...img("c1", M.carre), props: { mediaId: M.carre, width: "wide", background: FOND } }, { ...img("c2", M.carre), props: { mediaId: M.carre, width: "wide", background: FOND } }]);
    await open();
    const joined0 = await f.evaluate(() => document.querySelectorAll(".fond-bloc[data-join]").length);
    await clickOp("c1", "add-head");
    await type("Premier");
    const joined1 = await f.evaluate(() => ({ n: document.querySelectorAll(".fond-bloc[data-join]").length, bands: document.querySelectorAll(".fond-bloc").length }));
    ok("C6 la fusion avec le voisin de même fond reste (titre ajouté)", joined1.n === joined0, `${joined0} -> ${joined1.n}`);
  });

/* ---- D. alignement, dessous, sur l'image ---------------------------------------------------------------------------------------------- */
if (run("D"))
  await section("D", async () => {
    await open([img("ia", M.paysage), free("fa")]);
    await clickOp("ia", "add-head");
    await type("Détail du manteau");
    const rect = (sel) => f.evaluate((s) => { const e = document.querySelector(s); const r = e.getBoundingClientRect(); return { top: r.top + scrollY, bottom: r.bottom + scrollY, left: r.left, right: r.right, w: r.width }; }, sel);
    const T = '[data-edit-block="ia"] h2[data-inline="head.title"]';
    const IMG = '[data-edit-block="ia"] figure';
    const t0 = await rect(T);
    const i0 = await rect(IMG);
    ok("D1 par défaut : titre au-dessus de l'image, aligné à gauche", t0.bottom <= i0.top + 1, JSON.stringify([t0, i0]));
    // alignement : boutons de position du titre
    const sel = async () => { await inner("ia").click({ position: { x: 20, y: 20 } }).catch(() => {}); await sleep(500); };
    await sel();
    ok("D2 sélection : la barre « Position du titre » est proposée", await until(() => Boolean(document.querySelector('[data-testid="title-position"]')), null, 8000));
    const pos = (aria) => f.locator(`[data-testid="title-position"] button[aria-label="${aria}"]`).click();
    await pos("Titre centré");
    await settled(page);
    const alignIs = (v) => until(([s, v]) => document.querySelector(s) && getComputedStyle(document.querySelector(s)).textAlign === v, [T, v], 10000);
    ok("D3 centré : le titre se centre (data-th=center posé, texte centré)", (await lookIs("ia", "titleH", "center")) && (await alignIs("center")));
    await pos("Titre à droite");
    await settled(page);
    const d4 = (await lookIs("ia", "titleH", "right")) && (await alignIs("right"));
    if (!d4) console.log("DIAG D4", JSON.stringify(blockOf("ia")?.props?.look), await f.evaluate((s) => { const h = document.querySelector(s); const blk = h?.closest(".blk"); return JSON.stringify({ ta: h && getComputedStyle(h).textAlign, th: blk?.dataset.th, cls: blk?.className, wrap: h?.closest("[data-edit-block]")?.dataset.editLook }); }, T));
    ok("D4 à droite : texte aligné à droite", d4);
    await pos("Titre à gauche");
    await settled(page);
    ok("D5 à gauche : retour au départ (réglage retiré)", await lookIs("ia", "titleH", undefined));
    // dessous
    await clickOp("ia", "add-head-below");
    const t1 = await rect(T);
    const i1 = await rect(IMG);
    ok("D6 « Mettre dessous » : le titre passe sous l'image, `head.at` = below", headOf("ia")?.at === "below" && t1.top >= i1.bottom - 1, JSON.stringify([headOf("ia"), t1, i1]));
    ok("D7 le bouton devient « Mettre dessus »", /dessus/.test((await pastille("ia", "remove-head-below").textContent().catch(() => "")) ?? ""));
    await clickOp("ia", "remove-head-below");
    ok("D8 « Mettre dessus » : retour au-dessus, clé `at` retirée", headOf("ia")?.at === undefined && (await rect(T)).bottom <= (await rect(IMG)).top + 1);
    // sur l'image
    await clickOp("ia", "add-head-over");
    const t2 = await rect(T);
    const i2 = await rect(IMG);
    ok("D9 « Sur l'image » : `head.at` = over, le titre est DANS la boîte de l'image", headOf("ia")?.at === "over" && t2.top >= i2.top - 1 && t2.bottom <= i2.bottom + 1 && t2.left >= i2.left - 1, JSON.stringify([headOf("ia")?.at, t2, i2]));
    ok("D10 sur l'image : le titre est dans le <figure> de la photo, hauteur de l'image inchangée", await f.evaluate(() => Boolean(document.querySelector('[data-edit-block="ia"] figure h2[data-inline="head.title"]'))) && Math.abs((i2.bottom - i2.top) - (i0.bottom - i0.top)) < 3, `${i0.bottom - i0.top} -> ${i2.bottom - i2.top}`);
    await sel();
    await f.locator('[data-testid="title-position"] button[aria-label="Titre en haut"]').click();
    await settled(page);
    await until(([s, y]) => document.querySelector(s) && document.querySelector(s).getBoundingClientRect().top + scrollY < y - 20, [T, t2.top], 10000);
    const t3 = await rect(T);
    ok("D11 position verticale « en haut » : le titre monte dans l'image", (await lookIs("ia", "titleV", "top")) && t3.top < t2.top, JSON.stringify([t2.top, t3.top]));
    await shot("d-sur-image");
    // planche libre : mêmes gestes, surimpression comprise
    await clickOp("fa", "add-head");
    await type("Coquillages");
    await clickOp("fa", "add-head-over");
    ok("D12 planche libre : titre sur la zone", headOf("fa")?.at === "over" && (await f.evaluate(() => Boolean(document.querySelector('[data-edit-block="fa"] .free-board h2[data-inline="head.title"]')))));
    await clickOp("fa", "remove-head-over");
    await clickOp("fa", "add-head-below");
    ok("D13 planche libre : dessous", headOf("fa")?.at === "below" && (await f.evaluate(() => { const h = document.querySelector('[data-edit-block="fa"] h2[data-inline="head.title"]'); const z = document.querySelector('[data-edit-block="fa"] .free-board'); return Boolean(h && z && z.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING); })));
  });

/* ---- E. niveaux de titre ------------------------------------------------------------------------------------------------------------ */
if (run("E"))
  await section("E", async () => {
    await open([img("ia", M.paysage), grid("ga", { layout: "2", ratio: "4:3", title: T$("Escales") }, [img("ga1", M.paysage), img("ga2", M.portrait)]), img("ib", M.carre)]);
    await clickOp("ia", "add-head");
    await type("Premier niveau");
    await clickOp("ia", "add-head-eyebrow");
    await type("Surtitre");
    await clickOp("ga1", "add-head");
    await type("Dans la grille");
    await clickOp("ib", "add-head");
    await type("Second bloc");
    const h = await f.evaluate(() => ({ ia: document.querySelector('[data-edit-block="ia"] [data-inline="head.title"]')?.tagName, ga1: document.querySelector('[data-edit-block="ga1"] [data-inline="head.title"]')?.tagName, ib: document.querySelector('[data-edit-block="ib"] [data-inline="head.title"]')?.tagName, sub: document.querySelector('[data-edit-block="ia"] [data-inline="head.eyebrow"]')?.tagName, h1: document.querySelectorAll("#contenu h1, main h1").length }));
    ok("E1 titre de bloc de page : <h2>", h.ia === "H2" && h.ib === "H2", JSON.stringify(h));
    ok("E2 titre d'un composant dans une grille qui a un titre : <h3>", h.ga1 === "H3", JSON.stringify(h));
    ok("E3 le sous-titre est un <p>, pas un titre", h.sub === "P");
    ok("E4 aucun <h1> créé par un titre de composant", h.h1 === 0, JSON.stringify(h));
    // grille sans titre : le composant reste h2
    const g = blockOf("ga");
    ok("E5 la grille garde son propre titre (pas de `head` sur la grille)", g?.props?.title?.fr === "Escales" && !("head" in g.props), JSON.stringify(g?.props));
    // plan de page publié : pas de saut de niveau
    ok("E6 publication", await publishBlocks(page, BASE, pageId, (b) => b, () => q1("select 1 as x from blocks where page_id = ? and props like '%Premier niveau%'", pageId) !== undefined));
    const pub = await pubPage();
    await pub.goto(`${BASE}/fr/personnages`, { waitUntil: "domcontentloaded" });
    const lv = await levels(pub);
    const nums = lv.map((s) => Number(s[1]));
    ok("E7 plan de page public : aucun saut de niveau (h2, h2 puis h3 sous le titre de la grille)", nums.every((n, i) => i === 0 || n <= nums[i - 1] + 1), lv.join(" > "));
    ok("E8 le titre de composant de la grille est un <h3> après le <h2> de la grille", lv.findIndex((s) => s.startsWith("h2:Escales")) >= 0 && lv.findIndex((s) => s.startsWith("h3:Dans la grille")) > lv.findIndex((s) => s.startsWith("h2:Escales")), lv.join(" > "));
    await pub.close();
  });

/* ---- F. cases de grille ------------------------------------------------------------------------------------------------------------------ */
if (run("F"))
  await section("F", async () => {
    const photoBoxes = () => f.evaluate(() => [...document.querySelectorAll('[data-edit-block="gj"] .block-grid-cell')].map((c) => { const m = c.querySelector(".media-frame, [data-edit-media]"); const r = (m ?? c).getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
    await open([grid("gj", { layout: "3", ratio: "auto" }, [img("j1", M.paysage), img("j2", M.portrait), img("j3", M.carre)]), grid("gn", { layout: "3", ratio: "4:3" }, [img("n1", M.paysage), img("n2", M.paysage), img("n3", M.paysage)])]);
    const before = await photoBoxes();
    ok("F0 la grille justifiée est bien justifiée (marque data-justify)", await f.evaluate(() => Boolean(document.querySelector('[data-edit-block="gj"] .block-grid[data-justify]'))));
    const op = pastille("j1", "add-cap-title");
    ok("F1 case justifiée : la pastille propose « + Titre » (captionTitle)", (await op.count()) === 1 && /\+ Titre/.test((await op.textContent()) ?? ""));
    ok("F2 case justifiée : jamais d'opération `head`", (await pastille("j1", "add-head").count()) === 0);
    await clickOp("j1", "add-cap-title");
    ok("F3 case justifiée : « + Titre » écrit captionTitle (pas `head`)", blockOf("j1")?.props?.captionTitle !== undefined && !("head" in blockOf("j1").props), JSON.stringify(blockOf("j1")?.props));
    await type("Le phare");
    ok("F4 case justifiée : le titre saisi est la légende (captionTitle)", blockOf("j1")?.props?.captionTitle?.fr === "Le phare");
    const after = await photoBoxes();
    ok("F5 la géométrie des photos de la rangée justifiée ne change pas", JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    // case non justifiée
    const op2 = pastille("n1", "add-head");
    ok("F6 case non justifiée : « + Titre » crée un `head` dans la case", (await op2.count()) === 1);
    await clickOp("n1", "add-head");
    await type("Marée");
    ok("F7 le `head` est porté par la case (composant de la grille)", blockOf("n1")?.props?.head?.title?.fr === "Marée", JSON.stringify(blockOf("n1")?.props));
    ok("F8 le titre de la case est un <h2> (la grille n'a pas de titre) placé DANS la case", await f.evaluate(() => { const h = document.querySelector('[data-edit-block="n1"] [data-inline="head.title"]'); return h?.tagName === "H2" && Boolean(h.closest(".block-grid-cell")); }));
    await shot("f-cases");
  });

/* ---- G. bloc Projet ----------------------------------------------------------------------------------------------------------------------- */
if (run("G"))
  await section("G", async () => {
    await open([board("pa")]);
    await clickOp("pa", "add-head");
    await type("À la une");
    ok("G1 bloc Projet : `head.title` écrit dans les réglages du BLOC (propre à la page)", headOf("pa")?.title?.fr === "À la une", JSON.stringify(blockOf("pa")?.props));
    ok("G2 le titre est avant l'en-tête du projet, dans le bloc", await f.evaluate(() => { const h = document.querySelector('[data-edit-block="pa"] h2[data-inline="head.title"]'); const b = document.querySelector('[data-edit-block="pa"] [data-edit-board]'); return Boolean(h && b && h.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); }));
    ok("G3 « Sur l'image » n'est pas proposé pour un projet", (await pastille("pa", "add-head-over").count()) === 0);
    ok("G4 la barre « Aa » s'ouvre sur ce titre", await openByAa('[data-edit-block="pa"] h2[data-inline="head.title"]'));
    const sc = await scopes();
    ok("G5 portées : Ce titre · Tous les titres du projet · Tout le site", sc[0] === "Ce titre" && sc.some((s) => /Tous les titres du projet/.test(s)) && sc.some((s) => /Tout le site/.test(s)), sc.join(" | "));
    const projet = f.locator(".lk-bar .lk-seg [role=radio]").filter({ hasText: /Tous les titres du projet/ }).first();
    await projet.click();
    await f.locator(".lk-bar .tc-italic").click();
    await settled(page);
    await waitFor(() => blockOf("pa")?.props?.look?.projectText?.h2?.italic === true, 12000);
    const look = blockOf("pa")?.props?.look;
    if (false) console.log("DIAG G6", JSON.stringify(look), JSON.stringify(blockOf("pa")?.props), await f.locator(".lk-bar .tc-italic").getAttribute("aria-pressed"), await f.locator(".lk-bar .lk-seg [role=radio][aria-checked=true]").allTextContents(), JSON.stringify(errors.slice(-3)));
    ok("G6 « Tout le projet » : réglage rangé dans look.projectText.h2 du bloc", look?.projectText?.h2?.italic === true, JSON.stringify(look));
    ok("G7 le titre de la page prend le style du projet", await f.evaluate(() => getComputedStyle(document.querySelector('[data-edit-block="pa"] h2[data-inline="head.title"]')).fontStyle === "italic"));
    await closeBar();
    await shot("g-projet");
    await clickOp("pa", "remove-head");
    ok("G8 retrait : plus de clé `head`", !("head" in (blockOf("pa")?.props ?? {})));
  });

/* ---- H. public --------------------------------------------------------------------------------------------------------------------------------- */
if (run("H"))
  await section("H", async () => {
    const sceneH = [{ ...img("hc", M.carre), props: { mediaId: M.carre, width: "wide", surface: CARD, background: FOND, head: { eyebrow: T$("Hiver"), title: T$("Titre de carte"), at: undefined } } }, img("hv", M.paysage, { head: { title: { fr: "", en: "" } } }), img("hn", M.paysage), img("ho", M.paysage, { head: { title: T$("Sur la photo"), at: "over" } }), img("hb", M.paysage, { head: { title: T$("Dessous"), at: "below" } })];
    ok("H0 publication", await publishBlocks(page, BASE, pageId, () => sceneH.map((b) => ({ ...b, props: JSON.parse(JSON.stringify(b.props)) })), () => q1("select 1 as x from blocks where page_id = ? and props like '%Titre de carte%'", pageId) !== undefined));
    const pub = await pubPage();
    await pub.goto(`${BASE}/fr/personnages`, { waitUntil: "domcontentloaded" });
    const info = await pub.evaluate(() => {
      const t = [...document.querySelectorAll(".comp-head")].map((e) => ({ at: e.dataset.at, text: e.textContent.trim(), tag: e.querySelector("h2,h3,h4")?.tagName ?? null, inCard: Boolean(e.closest(".card-in")), inFond: Boolean(e.closest(".fond-in")) }));
      return { t, markers: [...document.querySelectorAll("[data-inline], [data-placeholder], [data-edit-field-op], .pe-head-anchor, .pe-field-op, [data-head-for]")].length, cards: document.querySelectorAll(".surface-card").length, fonds: document.querySelectorAll(".fond-bloc").length };
    });
    const card = info.t.find((x) => /Titre de carte/.test(x.text));
    ok("H1 titre de carte présent, dans la carte et le fond", Boolean(card) && card.inCard && card.inFond && card.tag === "H2", JSON.stringify(info.t));
    ok("H2 sous-titre présent avec le titre", /Hiver/.test(card?.text ?? ""));
    ok("H3 aucun repère d'édition en public", info.markers === 0, String(info.markers));
    ok("H4 titre vide : aucun bloc de titre, donc aucune marge", info.t.length === 3 && !info.t.some((x) => x.text === ""), JSON.stringify(info.t));
    ok("H5 surimpression publiée : position « over » ; dessous publié : « below »", info.t.some((x) => x.at === "over" && /Sur la photo/.test(x.text)) && info.t.some((x) => x.at === "below" && /Dessous/.test(x.text)), JSON.stringify(info.t));
    ok("H6 une seule carte et un seul fond (titre dedans, pas de bande de plus)", info.cards === 1 && info.fonds === 1, JSON.stringify(info));
    const over = await pub.evaluate(() => { const h = document.querySelector('.comp-head[data-at="over"]'); const fig = h?.closest("figure"); if (!h || !fig) return null; const a = h.getBoundingClientRect(); const b = fig.querySelector("img")?.getBoundingClientRect(); return b ? { inside: a.top >= b.top - 1 && a.bottom <= b.bottom + 1 } : null; });
    ok("H7 surimpression publique : le titre est posé sur la photo", over?.inside === true, JSON.stringify(over));
    await shot("h-public");
    await pub.close();
  });

/* ---- I. téléphone ---------------------------------------------------------------------------------------------------------------------------------- */
if (run("I"))
  await section("I", async () => {
    const long = "Un titre de composant très long qui doit absolument retourner à la ligne sur un écran de téléphone sans jamais déborder";
    const sceneI = [img("ia", M.paysage, { head: { eyebrow: T$("Un sous-titre assez long lui aussi pour vérifier le retour"), title: T$(long) } }), free("fa", { head: { title: T$(long), at: "over" } }), img("ib", M.paysage, { head: { title: T$(long), at: "over" } })];
    ok("I0 publication", await publishBlocks(page, BASE, pageId, () => JSON.parse(JSON.stringify(sceneI)), () => q1("select 1 as x from blocks where page_id = ? and props like '%très long%'", pageId) !== undefined));
    const ph = await browser.newContext({ viewport: { width: 390, height: 800 }, isMobile: true, hasTouch: true });
    const pp = await ph.newPage();
    await pp.goto(`${BASE}/fr/personnages`, { waitUntil: "domcontentloaded" });
    await sleep(800);
    const m = await pp.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, heads: [...document.querySelectorAll(".comp-head h2, .comp-head h3")].map((h) => { const r = h.getBoundingClientRect(); return { right: r.right, lines: Math.round(r.height / (parseFloat(getComputedStyle(h).fontSize) * 1.1)) }; }) }));
    ok("I1 aucun débordement horizontal à 390 px", m.sw <= m.cw + 1, JSON.stringify(m));
    ok("I2 le titre long est retourné à la ligne (plusieurs lignes, reste dans l'écran)", m.heads.length >= 1 && m.heads.every((h) => h.right <= m.cw + 1) && m.heads.some((h) => h.lines >= 2), JSON.stringify(m.heads));
    await pp.screenshot({ path: path.join(SHOTS, "i-telephone.png") }).catch(() => {});
    await ph.close();
    // aperçu téléphone de l'éditeur
    await open(sceneI.map((b) => JSON.parse(JSON.stringify(b))));
    const ov = await f.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    ok("I3 toile 1440 px : pas de débordement horizontal", ov.sw <= ov.cw + 1, JSON.stringify(ov));
  });

/* ---- J. annuler, dupliquer, langues ---------------------------------------------------------------------------------------------------------------- */
if (run("J"))
  await section("J", async () => {
    await open([img("ia", M.paysage), img("ib", M.carre)]);
    await clickOp("ia", "add-head");
    await type("Titre FR");
    ok("J1 titre posé", headOf("ia")?.title?.fr === "Titre FR");
    await page.keyboard.press("Control+z");
    await settled(page);
    ok("J2 Annuler : le texte revient (vide)", headOf("ia")?.title?.fr === "" || headOf("ia") === undefined, JSON.stringify(headOf("ia")));
    await page.keyboard.press("Control+z");
    await settled(page);
    ok("J3 Annuler encore : le titre disparaît (aucune clé)", !("head" in (blockOf("ia")?.props ?? {})), JSON.stringify(blockOf("ia")?.props));
    await page.keyboard.press("Control+Shift+z");
    await settled(page);
    ok("J4 Rétablir : le titre revient", blockOf("ia")?.props?.head !== undefined, JSON.stringify(blockOf("ia")?.props));
    // un titre complet, dupliqué
    await open([{ ...img("ia", M.paysage), props: { mediaId: M.paysage, width: "wide", head: { eyebrow: T$("Sous"), title: { fr: "Titre FR", en: "Title EN" } } } }]);
    await inner("ia").click({ position: { x: 30, y: 30 } });
    await sleep(500);
    await f.locator('button[aria-label="Dupliquer"]').click().catch(async () => { await page.locator('button[aria-label="Dupliquer"]').click(); });
    await settled(page);
    const copies = draftBlocks(pageId).filter((b) => b.type === "image");
    ok("J5 dupliquer : le titre suit (copie indépendante)", copies.length === 2 && copies.every((b) => b.props.head?.title?.fr === "Titre FR" && b.props.head?.eyebrow?.fr === "Sous") && copies[0].uid !== copies[1].uid, JSON.stringify(copies.map((c) => c.props.head)));
    // langues : le texte anglais est un autre texte
    await page.getByRole("group", { name: "Langue" }).getByRole("button", { name: "EN" }).click();
    await sleep(2500);
    f = await (async () => { const handle = await page.waitForSelector("iframe.ve-frame"); return handle.contentFrame(); })();
    await f.waitForSelector("html[data-edit-mode]");
    await sleep(1500);
    const en = await f.evaluate(() => document.querySelector('h2[data-inline="head.title"]')?.textContent);
    ok("J6 langue EN : le titre anglais s'affiche", en === "Title EN", String(en));
    const uid = copies[0].uid;
    await f.locator(`[data-edit-block="${uid}"] h2[data-inline="head.title"]`).dblclick({ position: { x: 8, y: 6 } });
    await sleep(300);
    await type("English only");
    const after = findIn(draftBlocks(pageId), uid)?.props?.head?.title;
    ok("J7 saisie en EN : seul le texte anglais change", after?.en === "English only" && after?.fr === "Titre FR", JSON.stringify(after));
    await page.getByRole("group", { name: "Langue" }).getByRole("button", { name: "FR" }).click();
    await sleep(1500);
  });

/* ---- R. anciennes données ----------------------------------------------------------------------------------------------------------------------------- */
if (run("R"))
  await section("R", async () => {
    const legacy = [
      img("r1", M.paysage),
      { ...img("r2", M.carre), props: { mediaId: M.carre, width: "wide", surface: CARD, background: FOND, caption: T$("Légende"), captionTitle: T$("Titre de légende") } },
      free("r3"),
      board("r4"),
      grid("r5", { layout: "2", ratio: "auto", title: T$("Grille") }, [img("r5a", M.paysage), img("r5b", M.portrait)]),
      grid("r6", { layout: "3", ratio: "4:3" }, [img("r6a", M.paysage), img("r6b", M.paysage), img("r6c", M.paysage)]),
    ];
    ok("R0 publication de l'ancienne scène", await publishBlocks(page, BASE, pageId, () => JSON.parse(JSON.stringify(legacy)), () => q1("select 1 as x from blocks where page_id = ? and props like '%Titre de légende%'", pageId) !== undefined));
    const stored = sql((db) => db.prepare("select props from blocks where page_id = ?").all(pageId)).map((r) => r.props);
    ok("R1 aucune clé `head` n'apparaît dans les données publiées", stored.every((p) => !p.includes('"head"')));
    const pub = await pubPage();
    await pub.goto(`${BASE}/fr/personnages`, { waitUntil: "domcontentloaded" });
    await sleep(1200);
    const html = await pub.evaluate(() => document.querySelector("#contenu")?.outerHTML ?? "");
    ok("R2 HTML public : aucun titre de composant, aucun repère", !/comp-head|data-head|pe-head|head-over/.test(html) && html.length > 2000, `${html.length} caractères`);
    // normalisation : identifiants de médias et suffixes générés (comparaison base / lot)
    const norm = html.replace(/\/media\/[^"')\s]+/g, "/media/X").replace(/media-\d+/g, "media-N").replace(/\b[a-f0-9]{8,}\b/g, "H").replace(/(srcset|sizes|src|href|style)="[^"]*"/g, '$1=""');
    if (process.env.DUMP) writeFileSync(process.env.DUMP, norm);
    ok("R3 dump normalisé écrit pour comparaison avec la base", norm.length > 2000);
    const lv = await levels(pub);
    ok("R4 plan de titres inchangé (grille titrée = h2)", lv.some((s) => s.startsWith("h2:Grille")), lv.join(" > "));
    await pub.close();
  });

ok("aucune erreur JavaScript dans la page de l'éditeur", errors.filter((e) => !/ResizeObserver|Hydration|hydrat/i.test(e)).length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `${failures} ÉCHEC(S)` : "TOUT PASSE");
process.exit(failures ? 1 : 0);
