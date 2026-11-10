#!/usr/bin/env node
/**
 * Lot 131 « Étapes » (chromium, serveur requis, base neuve). Souris et clavier réels ; données SYNTHÉTIQUES.
 *  A  Public : les trois blocs publiés existent (comparer, étapes, tourner) ; repli SANS JavaScript lisible (étiquettes, panneaux, images).
 *  B  Comparer : curseur au clavier (flèches, Début, Fin), au glisser de la souris ; variable --pos et clip-path suivent ; valeur annoncée.
 *  C  Étapes : onglets (clic, flèches), un seul panneau visible, légende ; frise et défilement : toutes les étapes visibles.
 *  D  Tourner : glisser change de vue, flèches du clavier, boutons ; AUCUNE rotation automatique (reduced-motion ou non).
 *  E  Téléphone 390 px : aucun débordement horizontal ; cibles de 44 px.
 *  F  Éditeur : le bloc se pose sur la toile, titres d'étape modifiables en place (persistés dans le brouillon).
 *  R  Anciennes données : HTML public sans le bloc identique (écrit dans $DUMP) et aucune clé `steps` dans les données publiées.
 * Captures : $SHOTS. Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=A,B,…] [SHOTS=dossier] [DUMP=fichier] node scripts/e2e-etapes131.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { draftBlocks, findIn, img, login, makeMedia, openEditor, pageIdOf, q1, setDraft, settled, sleep, sql, waitFor } from "./lib/grille31d.mjs";
import { publishBlocks } from "./lib/page-draft.mjs";

const BASE = process.env.BASE ?? "http://localhost:3900";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.BATT_SHOTS ?? process.env.SHOTS ?? path.join(process.env.BATTERY_DIR ?? tmpdir(), "shots-etapes131");
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
const anon = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);
const M = await makeMedia(page, BASE);
const pageId = pageIdOf("personnages");
const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});
const section = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.stack ?? e.message).split("\n").slice(0, 12).join(" "));
  }
};

const it = (m, n) => ({ media: m, label: T$(`Étape ${n}`), caption: T$(`Légende ${n}`) });
const four = [it(M.paysage, 1), it(M.carre, 2), it(M.portrait, 3), it(M.paysage2, 4)];
const SCENE = [
  { uid: "e-cmp", type: "steps", props: { mode: "compare", ratio: "3:2", items: [it(M.paysage, 1), it(M.paysage2, 2)] } },
  { uid: "e-tab", type: "steps", props: { mode: "steps", view: "tabs", ratio: "3:2", items: four } },
  { uid: "e-str", type: "steps", props: { mode: "steps", view: "strip", ratio: "3:2", items: four } },
  { uid: "e-scr", type: "steps", props: { mode: "steps", view: "scroll", ratio: "3:2", items: four.slice(0, 3) } },
  { uid: "e-trn", type: "steps", props: { mode: "turn", ratio: "3:2", items: four } },
];
const pub = async (p, w = 1440) => {
  await p.setViewportSize({ width: w, height: 1000 });
  await p.goto(`${BASE}/fr/personnages`, { waitUntil: "load" });
  await sleep(1500);
};
// En public l identifiant d un bloc publié n est pas celui du brouillon : on les retrouve dans l ordre de la page.
const ORDER = ["e-cmp", "e-tab", "e-str", "e-scr", "e-trn"];
const blk = (p, uid) => p.locator("[data-steps-mode]").nth(ORDER.indexOf(uid));

if (run("A") || run("B") || run("C") || run("D") || run("E")) {
  const done = await publishBlocks(page, BASE, pageId, () => JSON.parse(JSON.stringify(SCENE)), () => Boolean(q1("select 1 as x from blocks where page_id = ? and props like '%\"mode\":\"turn\"%'", pageId)));
  ok("A0 publication des cinq blocs Étapes", done);
}
const p = await anon.newPage();
p.setDefaultTimeout(15000);
const perr = [];
p.on("pageerror", (e) => perr.push(e.message));

if (run("A"))
  await section("A", async () => {
    await pub(p);
    ok("A1 les cinq blocs sont rendus", (await p.locator("[data-steps-mode]").count()) === 5);
    ok("A2 modes comparer / étapes / tourner présents", (await p.locator('[data-steps-mode="compare"]').count()) === 1 && (await p.locator('[data-steps-mode="steps"]').count()) === 3 && (await p.locator('[data-steps-mode="turn"]').count()) === 1);
    for (const el of await p.locator("[data-steps-mode]").all()) await el.scrollIntoViewIfNeeded();
    await sleep(1500);
    ok("A3 images visibles chargées (naturalWidth > 0)", await p.evaluate(() => [...document.querySelectorAll("[data-steps-mode] img")].filter((i) => i.getBoundingClientRect().width > 0 && i.getBoundingClientRect().height > 0).every((i) => i.complete && i.naturalWidth > 0)));
    ok("A4 aucun script ni gestionnaire en ligne ajouté par le bloc", await p.evaluate(() => ![...document.querySelectorAll("[data-steps-mode] *")].some((e) => e.tagName === "SCRIPT" || e.getAttributeNames().some((a) => a.startsWith("on")))));
    ok("A5 prêt côté client (data-ready) après chargement", await p.locator("[data-steps-mode][data-ready]").count() === 5);
    shot(p, "A-public");
    const nojs = await browser.newContext({ viewport: { width: 1440, height: 1000 }, javaScriptEnabled: false });
    const q = await nojs.newPage();
    await q.goto(`${BASE}/fr/personnages`, { waitUntil: "load" });
    await sleep(800);
    const cmp = q.locator('[data-steps-mode="compare"]');
    ok("A6 sans JS, comparer : deux images et les mots Avant / Après visibles", (await cmp.locator("img").count()) === 2 && (await cmp.innerText()).includes("Avant") && (await cmp.innerText()).includes("Après"));
    ok("A7 sans JS, le curseur n'est pas proposé (il ne ferait rien)", !(await cmp.locator("input[type=range]").first().isVisible().catch(() => false)));
    const tab = q.locator("[data-steps-mode]").nth(1);
    ok("A8 sans JS, étapes : les 4 légendes sont lisibles", (await tab.innerText()).includes("Légende 1") && (await tab.innerText()).includes("Légende 4"));
    ok("A9 sans JS, tourner : toutes les vues listées", (await q.locator("[data-steps-mode]").nth(4).locator("img").count()) === 4);
    await nojs.close();
  });

if (run("B"))
  await section("B", async () => {
    await pub(p);
    const b = blk(p, "e-cmp");
    await b.scrollIntoViewIfNeeded();
    const range = b.locator("input[type=range]");
    ok("B1 curseur : rôle slider, étiqueté, 0–100, départ 50", (await range.getAttribute("aria-label"))?.length > 3 && (await range.inputValue()) === "50" && (await range.getAttribute("max")) === "100");
    const pos = () => b.evaluate((e) => parseFloat(getComputedStyle(e.querySelector("[data-steps-stage]") ?? e).getPropertyValue("--pos")));
    ok("B2 --pos = 50 au départ", Math.abs((await pos()) - 50) < 0.6, String(await pos()));
    await range.focus();
    await p.keyboard.press("ArrowRight");
    ok("B3 flèche droite : +1", (await range.inputValue()) === "51" && Math.abs((await pos()) - 51) < 0.6);
    await p.keyboard.press("Home");
    ok("B4 Début : 0 ; --pos 0", (await range.inputValue()) === "0" && (await pos()) < 0.6);
    await p.keyboard.press("End");
    ok("B5 Fin : 100", (await range.inputValue()) === "100" && (await pos()) > 99.4);
    const stage = await b.locator("[data-steps-stage]").boundingBox();
    await p.mouse.move(stage.x + stage.width * 0.5, stage.y + stage.height / 2);
    await p.mouse.down();
    await p.mouse.move(stage.x + stage.width * 0.25, stage.y + stage.height / 2, { steps: 6 });
    await p.mouse.up();
    const after = Number(await range.inputValue());
    ok("B6 glisser à 25 % : valeur proche de 25", Math.abs(after - 25) <= 4, String(after));
    ok("B7 le clip-path de la couche « après » suit le curseur", await b.evaluate((e) => /inset/.test(getComputedStyle(e.querySelector("[data-steps-after]")).clipPath)));
    ok("B8 valeur annoncée (aria-valuetext) en pourcentage", /\d/.test((await range.getAttribute("aria-valuetext")) ?? ""));
    shot(p, "B-comparer");
  });

if (run("C"))
  await section("C", async () => {
    await pub(p);
    const b = blk(p, "e-tab");
    await b.scrollIntoViewIfNeeded();
    const tabs = b.locator('[role="tab"]');
    const shown = () => b.locator('[role="tabpanel"]:not([hidden])').count();
    ok("C1 quatre onglets, un seul panneau visible, le premier", (await tabs.count()) === 4 && (await shown()) === 1 && (await tabs.nth(0).getAttribute("aria-selected")) === "true");
    await tabs.nth(2).click();
    ok("C2 clic : le troisième onglet est choisi, sa légende est visible", (await tabs.nth(2).getAttribute("aria-selected")) === "true" && (await b.locator('[role="tabpanel"]:not([hidden])').innerText()).includes("Légende 3") && (await shown()) === 1);
    await p.keyboard.press("ArrowRight");
    ok("C3 flèche droite : onglet 4, focus dessus", (await tabs.nth(3).getAttribute("aria-selected")) === "true" && (await tabs.nth(3).evaluate((e) => e === document.activeElement)));
    await p.keyboard.press("Home");
    ok("C4 Début : retour au premier", (await tabs.nth(0).getAttribute("aria-selected")) === "true");
    for (const uid of ["e-str", "e-scr"]) {
      const s = blk(p, uid);
      const n = uid === "e-str" ? 4 : 3;
      ok(`C5 ${uid} : toutes les étapes visibles avec leur légende`, (await s.locator("figure:visible").count()) === n && (await s.innerText()).includes("Légende 1"));
    }
    shot(p, "C-etapes");
  });

if (run("D"))
  await section("D", async () => {
    await pub(p);
    const b = blk(p, "e-trn");
    await b.scrollIntoViewIfNeeded();
    const cur = () => b.locator("[data-steps-frame]:not([hidden])").evaluateAll((els) => els.map((e) => e.getAttribute("data-steps-frame")));
    ok("D1 une seule vue visible, la première", JSON.stringify(await cur()) === '["0"]', JSON.stringify(await cur()));
    const box = await b.locator("[data-steps-stage]").boundingBox();
    await p.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
    await p.mouse.down();
    await p.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2, { steps: 8 });
    await p.mouse.up();
    const g = (await cur())[0];
    ok("D2 glisser vers la gauche : une autre vue", g !== "0", g);
    await b.locator("[data-steps-stage]").focus();
    const before = (await cur())[0];
    await p.keyboard.press("ArrowRight");
    ok("D3 flèche droite : vue suivante (boucle)", (await cur())[0] === String((Number(before) + 1) % 4));
    await b.getByRole("button", { name: /précédente/i }).click();
    ok("D4 bouton « précédente » : retour", (await cur())[0] === before);
    ok("D5 compteur « n / 4 » à jour", /\d \/ 4/.test(await b.innerText()));
    // Aucune rotation automatique, avec ou sans préférence de mouvement réduit.
    for (const rm of ["no-preference", "reduce"]) {
      await p.emulateMedia({ reducedMotion: rm });
      await pub(p);
      const t0 = JSON.stringify(await cur());
      await sleep(3500);
      ok(`D6 aucune rotation automatique (${rm})`, JSON.stringify(await cur()) === t0);
    }
    await p.emulateMedia({ reducedMotion: "reduce" });
    await pub(p);
    ok("D7 mouvement réduit : aucune transition CSS sur les vues", await blk(p, "e-trn").evaluate((e) => [...e.querySelectorAll("[data-steps-frame], [data-steps-after]")].every((x) => (([v]) => (v.endsWith("ms") ? parseFloat(v) / 1000 : parseFloat(v)) <= 0.001)(getComputedStyle(x).transitionDuration.split(",")))));
    await p.emulateMedia({ reducedMotion: "no-preference" });
    shot(p, "D-tourner");
  });

if (run("E"))
  await section("E", async () => {
    await pub(p, 390);
    ok("E1 390 px : aucun débordement horizontal", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    ok("E2 390 px : onglets et boutons d'au moins 44 px de haut", await p.evaluate(() => [...document.querySelectorAll('[data-steps-mode] [role="tab"], [data-steps-mode] button')].filter((e) => e.getBoundingClientRect().width > 0).every((e) => e.getBoundingClientRect().height >= 43.5)));
    ok("E3 390 px : poignée du curseur d'au moins 44 px", await blk(p, "e-cmp").evaluate((e) => e.querySelector("input[type=range]").getBoundingClientRect().height >= 43.5));
    shot(p, "E-telephone");
  });

if (run("F"))
  await section("F", async () => {
    setDraft(pageId, JSON.parse(JSON.stringify(SCENE.slice(1, 2))));
    const f = await openEditor(page, BASE, pageId);
    await settled(page);
    await sleep(900);
    ok("F1 le bloc Étapes est sur la toile", (await f.locator('[data-edit-block="e-tab"]').count()) === 1);
    const label = f.locator('[data-edit-block="e-tab"] [data-inline="items.0.label"]').first();
    ok("F2 le titre de la première étape est modifiable en place", (await label.count()) === 1);
    await label.scrollIntoViewIfNeeded();
    await label.dblclick({ position: { x: 12, y: 6 } });
    await sleep(400);
    await page.keyboard.press("Control+a");
    await page.keyboard.type("Croquis");
    await page.keyboard.press("Enter");
    await sleep(600);
    await settled(page);
    const saved = await waitFor(() => findIn(draftBlocks(pageId), "e-tab")?.props?.items?.[0]?.label?.fr === "Croquis", 12000);
    ok("F3 la saisie est écrite dans le brouillon", saved, `éditing=${await f.locator("[data-editing]").count()} label=${JSON.stringify(findIn(draftBlocks(pageId), "e-tab")?.props?.items?.[0]?.label)} dom=${await f.locator('[data-edit-block="e-tab"] [data-inline="items.0.label"]').first().innerText().catch(() => "?")}`);
    ok("F4 les autres étapes et les images sont intactes", findIn(draftBlocks(pageId), "e-tab")?.props?.items?.length === 4 && findIn(draftBlocks(pageId), "e-tab")?.props?.items?.[1]?.media === M.carre);
    shot(page, "F-editeur");
  });

if (run("R"))
  await section("R", async () => {
    const legacy = [img("r1", M.paysage), img("r2", M.carre, { caption: T$("Légende") })];
    ok("R0 publication de l'ancienne scène", await publishBlocks(page, BASE, pageId, () => JSON.parse(JSON.stringify(legacy)), () => Boolean(q1("select 1 as x from blocks where page_id = ? and props like '%Légende%'", pageId))));
    const stored = sql((db) => db.prepare("select props, type from blocks where page_id = ?").all(pageId));
    ok("R1 aucun bloc `steps` ni clé de réglage dans les données publiées", stored.every((r) => r.type !== "steps" && !r.props.includes('"steps"')));
    await pub(p);
    const html = await p.evaluate(() => document.querySelector("#contenu")?.outerHTML ?? "");
    ok("R2 HTML public sans repère Étapes", !/data-steps|steps-/.test(html) && html.length > 1000, `${html.length}`);
    const norm = html.replace(/\/media\/[^"')\s]+/g, "/media/X").replace(/media-\d+/g, "media-N").replace(/\b[a-f0-9]{8,}\b/g, "H").replace(/(srcset|sizes|src|href|style)="[^"]*"/g, '$1=""');
    if (process.env.DUMP) writeFileSync(process.env.DUMP, norm);
    ok("R3 dump normalisé écrit", norm.length > 1000);
  });

ok("Z aucune erreur JavaScript du navigateur", errors.length === 0 && perr.length === 0, [...errors, ...perr].slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
