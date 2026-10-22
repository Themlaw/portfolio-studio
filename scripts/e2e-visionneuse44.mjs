#!/usr/bin/env node
/**
 * Lot 44 « cliquer pour agrandir : images seules et grilles » (chromium, serveur requis, base neuve, une connexion admin).
 *  P  Publication de brouillons de test (page et planche), puis site en ligne.
 *  S  Image seule : clic -> visionneuse avec cette seule image (ni compteur, ni flèches), légende Titre / Légende / Date, Échap
 *     ferme et le focus revient à l'image ; Entrée au clavier ; curseur loupe.
 *  G  Grille de 4 : clic sur la case 2 -> « 2 / 4 », -> jusqu'à 4 puis -> revient à 1, <- depuis 1 va à 4 ; légende de la case ;
 *     les cases texte ne comptent pas.
 *  O  Option « Agrandir au clic » coupée (image seule, grille) : aucun repère, aucun clic ; une image coupée dans une grille
 *     sort du défilement.
 *  B  Planche : image de planche (comme une image seule) et grille de planche (défilement).
 *  C  Toile de l'éditeur : pas de repère, pas de visionneuse au clic ; l'option est en haut du panneau.
 *  M  Téléphone 390 px : balayage au doigt.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=P,S,…] [SHOTS=dossier] node scripts/e2e-visionneuse44.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { boardDraft, draftBlocks, grid, img, login, makeMedia, openEditor, pageIdOf, q1, setBoardDraft, setDraft, settled, sleep, sql, waitFor } from "./lib/grille31d.mjs";

const BASE = process.env.BASE ?? "http://localhost:3600";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(tmpdir(), "e2e-visionneuse44");
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);
const M = await makeMedia(page, BASE);
const pageId = pageIdOf("personnages");
const project = q1("select id, slug from projects order by id limit 1");

const T = (s) => ({ fr: s, en: s });
const cap = (n) => ({ captionTitle: T(`Titre ${n}`), caption: T(`Légende ${n}`), captionDate: T(`Date ${n}`) });
const text = (uid, t) => ({ uid, type: "rich-text", props: { paragraphs: [T(t)] } });
const PAGE = () => [
  text("t1", "Un texte avant les images."),
  img("solo", M.portrait, cap("solo")),
  img("solo-off", M.paysage, { zoom: false }),
  grid("g4", { layout: "2" }, [img("a1", M.portrait, cap(1)), img("a2", M.paysage, cap(2)), text("a-t", "Une case de texte"), img("a3", M.carre, cap(3)), img("a4", M.paysage2, cap(4))]),
  grid("goff", { layout: "2", zoom: false }, [img("b1", M.portrait), img("b2", M.paysage)]),
  grid("gmix", { layout: "2" }, [img("c1", M.portrait, cap("c1")), img("c2", M.paysage, { ...cap("c2"), zoom: false }), img("c3", M.carre, cap("c3"))]),
  { uid: "pbd", type: "project-board", props: { project: project.slug } },
];
const BOARD = () => [
  { uid: "bimg", type: "image", props: { mediaId: M.portrait, width: "wide", ...cap("planche") } },
  { uid: "bg", type: "grid", props: { layout: "2", gap: "normal", align: "stretch", ratio: "auto", top: "gap", children: [img("bk1", M.portrait, cap("p1")), img("bk2", M.paysage, cap("p2")), img("bk3", M.carre, cap("p3"))] } },
];
const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});

async function publishAll() {
  setDraft(pageId, PAGE());
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
const items = (scope) => scope.locator("[data-viewer-item]");
const lb = (p) => p.locator(".lightbox");
const pos = (p) => lb(p).locator(".eyebrow").first().innerText();
const sectionOf = (p, uidText) => p.locator("section.block-grid-section").filter({ has: p.getByText(uidText) });

try {
  ok("P publication : brouillons de test publiés", await publishAll());
  const html = await (await fetch(`${BASE}/fr/personnages`)).text();
  ok("P2 site en ligne : repères de la visionneuse présents, aucun repère d'édition", html.includes("data-viewer-item") && !/data-edit-/.test(html.replace(/<script[\s\S]*?<\/script>/g, "")));

  /* ---- S. Image seule ---- */
  if (run("S")) {
    const p = await publicPage();
    const solo = p.locator("section:not(.block-grid-section) [data-viewer-item]").first();
    await solo.scrollIntoViewIfNeeded();
    ok("S1 curseur loupe au survol", (await solo.evaluate((e) => getComputedStyle(e).cursor)) === "zoom-in");
    ok("S2 accessible : rôle bouton, libellé, focusable", (await solo.getAttribute("role")) === "button" && Boolean(await solo.getAttribute("aria-label")) && (await solo.getAttribute("tabindex")) === "0");
    await solo.click();
    await lb(p).waitFor();
    ok("S3 clic : visionneuse ouverte sur l'image", (await lb(p).locator("img.lightbox-image").count()) === 1);
    ok("S4 image seule : ni flèches, ni compteur, ni vignettes", (await lb(p).locator('[data-icon="arrow-right"]').count()) === 0 && (await lb(p).locator(".lb-thumbs").count()) === 0 && !/\d \/ \d/.test(await lb(p).innerText()));
    const txt = (await lb(p).textContent()) ?? "";
    ok("S5 légende : Titre, Légende et Date sous l'image", txt.includes("Titre solo") && txt.includes("Légende solo") && txt.includes("Date solo"), txt);
    await shot(p, "solo-ouverte");
    await p.keyboard.press("Escape");
    ok("S6 Échap ferme, le focus revient à l'image", (await lb(p).count()) === 0 && (await p.evaluate(() => document.activeElement?.hasAttribute("data-viewer-item"))));
    // Lot 59 : une carte ou un fond actif est un conteneur (`container-type`), donc le bloc contenant d'un `position: fixed` ;
    // la visionneuse doit rester plein écran, sans être rognée ni décalée, même ouverte depuis l'intérieur d'une zone.
    await solo.evaluate((e) => {
      const z = e.closest("section");
      z.style.containerType = "inline-size";
      z.style.margin = "0 60px";
    });
    await solo.click();
    await lb(p).waitFor();
    const full = await lb(p).evaluate((e) => {
      const b = e.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height, vw: innerWidth, vh: innerHeight };
    });
    ok("S6b visionneuse ouverte depuis un conteneur (carte, fond) : plein écran, ni rognée ni décalée", full.x === 0 && full.y === 0 && Math.abs(full.w - full.vw) < 1 && Math.abs(full.h - full.vh) < 1, JSON.stringify(full));
    await p.keyboard.press("Escape");
    await lb(p).waitFor({ state: "detached" });
    await p.keyboard.press("Enter");
    ok("S7 Entrée sur l'image (focus) : ouvre", await lb(p).waitFor({ timeout: 5000 }).then(() => true, () => false));
    await p.keyboard.press("Escape");
    await solo.click();
    await lb(p).waitFor();
    await lb(p).getByRole("button", { name: "Fermer" }).click();
    ok("S8 bouton Fermer : ferme, focus rendu", (await lb(p).count()) === 0 && (await waitFor(() => p.evaluate(() => document.activeElement?.hasAttribute("data-viewer-item")), 5000)));
    await p.context().close();
  }

  /* ---- G. Grille ---- */
  if (run("G")) {
    const p = await publicPage();
    const g = p.locator("section.block-grid-section").filter({ hasText: "Une case de texte" });
    ok("G1 la grille de 4 images + 1 texte : 4 éléments cliquables (le texte est ignoré)", (await items(g).count()) === 4);
    await items(g).nth(1).scrollIntoViewIfNeeded();
    await shot(p, "grille-avant");
    await items(g).nth(1).click();
    await lb(p).waitFor();
    ok("G2 clic sur la case 2 : « 2 / 4 »", (await pos(p)) === "2 / 4", await pos(p));
    const t2 = (await lb(p).textContent()) ?? "";
    ok("G3 légende de la case 2", t2.includes("Titre 2") && t2.includes("Légende 2") && t2.includes("Date 2"), t2);
    const box = await lb(p).locator("[data-lightbox-date]").boundingBox();
    ok("G3b la date reste dans l'écran", Boolean(box) && box.y + box.height <= 900, JSON.stringify(box));
    await shot(p, "grille-ouverte");
    await p.keyboard.press("ArrowRight");
    await p.keyboard.press("ArrowRight");
    ok("G4 → → : « 4 / 4 »", (await pos(p)) === "4 / 4", await pos(p));
    await p.keyboard.press("ArrowRight");
    ok("G5 → depuis 4 : revient à « 1 / 4 »", (await pos(p)) === "1 / 4", await pos(p));
    await p.keyboard.press("ArrowLeft");
    ok("G6 ← depuis 1 : va à « 4 / 4 »", (await pos(p)) === "4 / 4", await pos(p));
    await lb(p).getByRole("button", { name: "Œuvre suivante" }).click();
    ok("G7 la flèche à l'écran suit aussi", (await pos(p)) === "1 / 4");
    await p.keyboard.press("Escape");
    ok("G8 Échap : fermée, focus rendu à la case 2", (await lb(p).count()) === 0);
    await p.context().close();
  }

  /* ---- O. Option coupée ---- */
  if (run("O")) {
    const p = await publicPage();
    const soloOff = p.locator("figure.block-image").filter({ hasNot: p.locator("[data-viewer-item]") });
    ok("O1 image seule « Agrandir au clic » coupée : aucun repère, pas de curseur loupe", (await soloOff.count()) >= 1 && (await soloOff.first().locator("img").evaluate((i) => getComputedStyle(i).cursor)) !== "zoom-in");
    await soloOff.first().scrollIntoViewIfNeeded();
    await soloOff.first().locator("img").click();
    ok("O2 clic : pas de visionneuse", (await lb(p).count()) === 0);
    const goff = p.locator("section.block-grid-section").nth(1);
    ok("O3 grille coupée : aucun repère", (await items(goff).count()) === 0);
    await goff.locator("img").first().click();
    ok("O4 grille coupée : pas de visionneuse", (await lb(p).count()) === 0);
    const mix = p.locator("section.block-grid-section").nth(2);
    ok("O5 image coupée dans une grille : 2 éléments sur 3", (await items(mix).count()) === 2);
    await items(mix).nth(0).scrollIntoViewIfNeeded();
    await items(mix).nth(0).click();
    await lb(p).waitFor();
    ok("O6 le défilement ne contient que les deux autres : « 1 / 2 »", (await pos(p)) === "1 / 2", await pos(p));
    await p.context().close();
  }

  /* ---- B. Planche ---- */
  if (run("B")) {
    const p = await publicPage();
    const sec = p.locator(`section[aria-labelledby="project-${project.slug}"]`);
    const bimg = sec.locator("section:not(.block-grid-section) [data-viewer-item]").first();
    await bimg.scrollIntoViewIfNeeded();
    await bimg.click();
    await lb(p).waitFor();
    ok("B1 image de planche : visionneuse sur cette seule image, légende", !/\d \/ \d/.test(await lb(p).innerText()) && (await lb(p).innerText()).includes("Titre planche"));
    await p.keyboard.press("Escape");
    const bg = sec.locator("section.block-grid-section");
    ok("B2 grille de planche : 3 éléments", (await items(bg).count()) === 3);
    await items(bg).nth(2).scrollIntoViewIfNeeded();
    await items(bg).nth(2).click();
    await lb(p).waitFor();
    ok("B3 grille de planche : « 3 / 3 », puis → revient à « 1 / 3 »", (await pos(p)) === "3 / 3" && (await (async () => { await p.keyboard.press("ArrowRight"); return pos(p); })()) === "1 / 3");
    await shot(p, "planche-ouverte");
    await p.context().close();
  }

  /* ---- M. Téléphone ---- */
  if (run("M")) {
    const p = await publicPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const g = p.locator("section.block-grid-section").filter({ hasText: "Une case de texte" });
    await items(g).nth(0).scrollIntoViewIfNeeded();
    await items(g).nth(0).tap();
    await lb(p).waitFor();
    ok("M1 toucher : visionneuse ouverte « 1 / 4 »", (await pos(p)) === "1 / 4", await pos(p));
    const swipe = (id, from, to) =>
      lb(p).locator(".lightbox-stage").evaluate(
        (el, a) => {
          const ev = (type, x) => new PointerEvent(type, { bubbles: true, pointerId: a.id, pointerType: "touch", clientX: x, clientY: 400, isPrimary: true });
          el.dispatchEvent(ev("pointerdown", a.from));
          el.dispatchEvent(ev("pointerup", a.to));
        },
        { id, from, to },
      );
    await swipe(7, 300, 80);
    ok("M2 balayage vers la gauche : « 2 / 4 »", (await pos(p)) === "2 / 4", await pos(p));
    await swipe(8, 80, 300);
    await swipe(9, 80, 300);
    ok("M3 balayage vers la droite deux fois : « 4 / 4 » (boucle)", (await pos(p)) === "4 / 4", await pos(p));
    ok("M4 pas de débordement horizontal", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await shot(p, "telephone-ouverte");
    await p.context().close();
  }

  /* ---- C. Toile ---- */
  if (run("C")) {
    setDraft(pageId, PAGE());
    const fr = await openEditor(page, BASE, pageId);
    await settled(page);
    ok("C1 toile : aucun repère de visionneuse", (await fr.locator("[data-viewer-item]").count()) === 0);
    const image = fr.locator('figure.block-image [data-edit-media="mediaId"]').first();
    await image.scrollIntoViewIfNeeded();
    await image.click();
    await sleep(600);
    ok("C2 toile : un clic sur l'image ne l'ouvre pas en grand", (await fr.locator(".lightbox").count()) === 0 && (await page.locator(".lightbox").count()) === 0);
    const toggle = page.getByLabel("Agrandir au clic").first();
    ok("C3 panneau : l'option « Agrandir au clic » est présente et cochée", (await toggle.count()) === 1 && (await toggle.isChecked()));
    await page.locator("label.a-toggle", { hasText: "Agrandir au clic" }).first().click();
    await settled(page);
    ok("C4 décocher l'écrit dans le brouillon (zoom: false)", draftBlocks(pageId).find((b) => b.uid === "solo")?.props.zoom === false);
    await shot(page, "editeur-option");
  }
} catch (e) {
  failures++;
  console.log(`FAIL exception — ${e.stack ?? e}`);
}

ok("Z aucune erreur JavaScript de page", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(failures === 0 ? "\nTOUT PASSE" : `\n${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);
