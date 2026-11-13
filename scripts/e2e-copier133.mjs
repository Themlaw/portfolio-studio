#!/usr/bin/env node
/**
 * Lot 133 : copier / coller de blocs et de styles entre pages et onglets, apparitions au défilement (chromium, serveur requis, base neuve).
 * Données SYNTHÉTIQUES (images générées, titres de démonstration).
 *  A  Copier un bloc (bouton) : presse-papiers en localStorage.
 *  B  Autre page, rechargement complet : Coller -> bloc ajouté avec un uid neuf, même média (aucun média dupliqué), brouillon enregistré ; Ctrl+Z l'annule ; Ctrl+V colle.
 *  C  Presse-papiers hostile (média absent, type inconnu, version inconnue) : refusé avec un message, rien n'est collé.
 *  D  Style seulement : l'apparition d'un bloc se colle sur un autre sans toucher son contenu.
 *  E  Public : enveloppes `.rv` seulement sur les blocs réglés (jamais le premier), CSS pur (chronologie de vue), coupé en mouvement réduit, anciennes pages inchangées.
 *  F  Planche libre : effet par image en cascade, public seulement ; jamais sur la toile d'édition.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=A,B,…] [SHOTS=dossier] node scripts/e2e-copier133.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { canvas, draftBlocks, img, login, makeMedia, pageIdOf, settled, setDraft, sleep, sql, waitFor } from "./lib/grille31d.mjs";

const BASE = process.env.BASE ?? "http://localhost:3800";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(process.env.BATTERY_DIR ?? tmpdir(), "shots-copier133");
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const T = (fr, en = fr) => ({ fr, en });
const title = (uid, text, props = {}) => ({ uid, type: "section-title", props: { title: T(text), ...props } });
const CLIP = "portfolio:clipboard";
const mediaCount = () => sql((db) => db.prepare("select count(*) n from media").get()).n;

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
page.on("dialog", (d) => void d.accept());
const errors = [];
page.on("pageerror", (e) => errors.push(`admin ${page.url()} : ${e.message.slice(0, 80)}`));
await login(page, BASE);

const HOME = pageIdOf("");
const ABOUT = pageIdOf("a-propos");
const media = await makeMedia(page, BASE);
const M = media.paysage;

/** Publie comme l'artiste : brouillon écrit, éditeur ouvert, « Publier » (relancé si l'éditeur n'était pas encore hydraté), avertissement éventuel refermé. */
async function publishDraft(pageId, blocks, done) {
  setDraft(pageId, blocks);
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
    await canvas(page);
    await sleep(3000);
    await page.getByRole("button", { name: "Publier", exact: true }).click();
    const end = Date.now() + 20000;
    while (Date.now() < end) {
      if (done()) return true;
      const dlg = page.locator("dialog[open]");
      if (await dlg.count()) {
        const label = ((await dlg.innerText()).match(/Mettre en ligne/) ? "Mettre en ligne" : null);
        if (label) await dlg.getByRole("button", { name: label }).click();
      }
      await sleep(500);
    }
  }
  return false;
}
const open = async (pageId) => {
  await page.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
  const fr = await canvas(page);
  await sleep(1500);
  return fr;
};
const pick = async (fr, uid) => {
  // La barre de position du titre choisi peut recouvrir le bloc voisin : on désélectionne d'abord.
  if (await page.locator(".ve-settings-head").count()) await page.keyboard.press("Escape");
  await sleep(300);
  await fr.locator(`[data-edit-block="${uid}"] section`).first().click({ position: { x: 40, y: 10 } });
  await page.waitForSelector(".ve-settings-head", { timeout: 20000 });
  await sleep(300);
};
const toastText = async () => (await page.locator("[role=status], [role=alert], .a-toast").allTextContents()).join(" | ");
const clipOf = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null"), CLIP);

setDraft(HOME, [title("t1", "Titre un"), img("i1", M, { caption: T("Légende copiée") }), title("t2", "Titre deux")]);
setDraft(ABOUT, [title("a1", "Page deux, titre un"), title("a2", "Page deux, titre deux")]);

if (run("A")) {
  const fr = await open(HOME);
  await pick(fr, "i1");
  ok("A1 Coller est grisé tant que rien n'est copié", await page.locator('[data-testid="block-paste"]').isDisabled());
  await page.locator('[data-testid="block-copy"]').click();
  const clip = await clipOf();
  ok("A2 presse-papiers en localStorage : blocs, type image, même média", clip?.kind === "blocks" && clip.blocks[0].type === "image" && clip.blocks[0].props.mediaId === M, JSON.stringify(clip)?.slice(0, 200));
  ok("A3 Ctrl+C sur un bloc choisi copie aussi", await (async () => { await page.evaluate((k) => localStorage.removeItem(k), CLIP); await page.locator(".ve-settings-head").click(); await page.keyboard.press("Control+c"); await sleep(300); return (await clipOf())?.kind === "blocks"; })());
}

if (run("B")) {
  if (!(await clipOf())) await page.evaluate(([k, v]) => localStorage.setItem(k, v), [CLIP, JSON.stringify({ v: 1, kind: "blocks", blocks: [img("i1", M, { caption: T("Légende copiée") })] })]);
  const before = mediaCount();
  const fr = await open(ABOUT);
  await pick(fr, "a1");
  ok("B1 autre page : Coller disponible (presse-papiers partagé entre pages)", await page.locator('[data-testid="block-paste"]').isEnabled());
  await page.locator('[data-testid="block-paste"]').click();
  ok("B2 bloc ajouté après le bloc choisi (brouillon enregistré)", await waitFor(() => { try { return draftBlocks(ABOUT).length === 3; } catch { return false; } }, 30000));
  await settled(page);
  const blocks = draftBlocks(ABOUT);
  const pasted = blocks[1];
  ok("B3 position : juste après a1 ; type image ; média et légende repris", blocks[0].uid === "a1" && pasted?.type === "image" && pasted.props.mediaId === M && pasted.props.caption?.fr === "Légende copiée", JSON.stringify(blocks.map((b) => b.uid)));
  ok("B4 uid neuf (≠ celui de la page d'origine)", pasted.uid !== "i1" && /^[a-z0-9-]{1,32}$/.test(pasted.uid));
  ok("B5 média référencé, jamais dupliqué (même nombre de médias)", mediaCount() === before);
  await page.keyboard.press("Control+z");
  ok("B6 Ctrl+Z annule le collage (un seul pas)", await waitFor(() => { try { return draftBlocks(ABOUT).length === 2; } catch { return false; } }, 30000));
  await settled(page);
  await pick(fr, "a1");
  await page.locator(".ve-settings-head").click();
  await page.keyboard.press("Control+v");
  ok("B7 Ctrl+V colle", await waitFor(() => { try { return draftBlocks(ABOUT).length === 3; } catch { return false; } }, 30000));
  await settled(page);
}

if (run("C")) {
  setDraft(ABOUT, [title("a1", "Page deux, titre un"), title("a2", "Page deux, titre deux")]);
  const fr = await open(ABOUT);
  await pick(fr, "a1");
  const hostile = [
    ["média absent", { v: 1, kind: "blocks", blocks: [{ uid: "x1", type: "image", props: { mediaId: 999999, width: "wide" } }] }],
    ["type inconnu", { v: 1, kind: "blocks", blocks: [{ uid: "x1", type: "pirate", props: {} }] }],
    ["props invalides", { v: 1, kind: "blocks", blocks: [{ uid: "x1", type: "image", props: { width: "énorme", mediaId: M } }] }],
  ];
  for (const [name, clip] of hostile) {
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [CLIP, JSON.stringify(clip)]);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await sleep(300);
    await page.locator('[data-testid="block-paste"]').click();
    await sleep(1500);
    ok(`C ${name} : refusé, rien de collé`, draftBlocks(ABOUT).length === 2);
  }
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [CLIP, JSON.stringify({ v: 99, kind: "blocks", blocks: [] })]);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await sleep(300);
  ok("C4 version inconnue : Coller grisé", await page.locator('[data-testid="block-paste"]').isDisabled());
  await page.evaluate((k) => localStorage.removeItem(k), CLIP);
}

if (run("D")) {
  setDraft(ABOUT, [title("a1", "Page deux, titre un"), title("a2", "Page deux, titre deux", { look: { spaceTop: "lg" } })]);
  const fr = await open(ABOUT);
  await pick(fr, "a1");
  await page.locator('[data-reveal-kind="fade"]').click();
  ok("D1 réglage d'apparition écrit dans le brouillon (reveal.fade)", await waitFor(() => draftBlocks(ABOUT)[0].props.reveal?.kind === "fade", 30000));
  await page.locator('[data-testid="style-copy"]').click();
  ok("D2 style copié : genre style, sans contenu", await (async () => { const c = await clipOf(); return c?.kind === "style" && c.style.reveal?.kind === "fade" && !("title" in c.style); })());
  await pick(fr, "a2");
  await page.locator('[data-testid="style-paste"]').click();
  ok("D3 style collé : l'apparition passe sur a2", await waitFor(() => draftBlocks(ABOUT)[1].props.reveal?.kind === "fade", 30000));
  await settled(page);
  const b = draftBlocks(ABOUT)[1];
  ok("D4 contenu de a2 intact", b.props.title?.fr === "Page deux, titre deux");
  ok("D5 les autres réglages de la source (absents) sont retirés de la cible", !b.props.look);
  await page.keyboard.press("Control+z");
  ok("D6 Ctrl+Z annule le collage de style", await waitFor(() => !draftBlocks(ABOUT)[1].props.reveal, 30000));
  await settled(page);
}

if (run("E")) {
  const blocks = [title("p0", "Premier"), title("p1", "Deuxième", { reveal: { kind: "slide", delay: 2 } }), img("p2", M, { reveal: { kind: "fade" } }), title("p3", "Dernier")];
  const done = await publishDraft(ABOUT, blocks, () => sql((db) => db.prepare("select count(*) n from blocks where page_id = ?").get(ABOUT)).n === 4);
  ok("E0 page publiée avec trois blocs animés ou non", done);
  if (!done) {
    await page.screenshot({ path: path.join(SHOTS, "e0-echec.png") });
    console.log("INFO lignes", JSON.stringify(sql((db) => db.prepare("select type, substr(props,1,60) p from blocks where page_id = ? order by position").all(ABOUT))), "brouillon", JSON.stringify(sql((db) => db.prepare("select substr(draft,1,120) d, draft_rev from pages where id = ?").get(ABOUT))));
    console.log("INFO", (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(-900));
    await page.getByRole("button", { name: "Publier", exact: true }).click();
    await sleep(1500);
    console.log("INFO apres-clic", (await page.locator("body").innerText()).replace(/\s+/g, " ").match(/.{0,200}(incomplet|Corrige|Choisis|erreur|impossible|Nomme|obligatoire).{0,200}/i)?.[0] ?? "rien", "|", (await page.locator("[role=status],[role=alert],dialog").allInnerTexts()).join(" | ").slice(0, 400));
    console.log("INFO bouton Publier", await page.getByRole("button", { name: "Publier", exact: true }).isDisabled().catch((e) => String(e).slice(0, 80)));
  }
  const visitor = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pub = await visitor.newPage();
  pub.setDefaultTimeout(60000);
  await pub.goto(`${BASE}/fr/a-propos`, { waitUntil: "networkidle" });
  const rv = await pub.evaluate(() => [...document.querySelectorAll(".rv")].map((e) => ({ k: e.dataset.reveal, d: e.dataset.rvD, text: e.textContent.slice(0, 20) })));
  ok("E1 deux enveloppes .rv (slide cran 2, fade), pas le premier bloc", rv.length === 2 && rv[0].k === "slide" && rv[0].d === "2" && rv[1].k === "fade" && !rv.some((r) => /Premier/.test(r.text)), JSON.stringify(rv));
  const css = await pub.evaluate(() => { const e = document.querySelector('.rv[data-reveal="slide"]'); const c = getComputedStyle(e); return { name: c.animationName, tl: c.animationTimeline }; });
  ok("E2 CSS pur : animation rv-slide sur chronologie de vue", css.name === "rv-slide" && /view/.test(css.tl), JSON.stringify(css));
  const html = await (await pub.request.get(`${BASE}/fr/a-propos`)).text();
  ok("E3 contenu dans le HTML sans script (texte présent)", /Deuxième/.test(html) && /Dernier/.test(html));
  const reduced = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const rp = await reduced.newPage();
  await rp.goto(`${BASE}/fr/a-propos`, { waitUntil: "networkidle" });
  ok("E4 mouvement réduit : aucune animation", (await rp.evaluate(() => getComputedStyle(document.querySelector(".rv")).animationName)) === "none");
  const nojs = await browser.newContext({ javaScriptEnabled: false });
  const np = await nojs.newPage();
  await np.goto(`${BASE}/fr/a-propos`, { waitUntil: "domcontentloaded" });
  ok("E5 sans JavaScript : contenu présent", (await np.locator("text=Deuxième").count()) > 0);
  await pub.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  ok("E6 page sans réglage : aucune enveloppe .rv (DOM d'avant)", (await pub.locator(".rv").count()) === 0);
  await pub.screenshot({ path: path.join(SHOTS, "e-public-accueil.png") });
  const fr = await open(ABOUT);
  ok("E7 toile d'édition : jamais d'enveloppe .rv", (await fr.locator(".rv").count()) === 0);
  await visitor.close();
  await reduced.close();
  await nojs.close();
}

if (run("F")) {
  const items = [0, 1, 2].map((i) => ({ id: `it${i}`, media: M, x: 5 + i * 30, y: 10, w: 28, rot: i * 5, z: i, reveal: { kind: "scale", ...(i ? { delay: i } : {}) } }));
  const blocks = [title("q0", "Ouverture"), { uid: "fb1", type: "free-board", props: { format: "3:2", phone: "scale", items } }];
  const done = await publishDraft(HOME, blocks, () => sql((db) => db.prepare("select count(*) n from blocks where page_id = ? and type = 'free-board'").get(HOME)).n === 1);
  ok("F0 planche libre publiée", done);
  const visitor = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pub = await visitor.newPage();
  await pub.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  const rv = await pub.evaluate(() => [...document.querySelectorAll(".free-item.rv")].map((e) => ({ d: e.dataset.rvD, k: e.dataset.reveal, rot: getComputedStyle(e).transform })));
  ok("F1 trois images animées en cascade (crans 0, 1, 2)", rv.length === 3 && rv.map((r) => r.d).join() === "0,1,2" && rv.every((r) => r.k === "scale"), JSON.stringify(rv));
  const fr = await open(HOME);
  ok("F2 toile d'édition : images sans effet", (await fr.locator(".free-item.rv").count()) === 0);
  await visitor.close();
}

ok("Z aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
if (failures) {
  console.log(`\n${failures} échec(s)`);
  process.exit(1);
}
console.log("\ne2e-copier133 : OK");
