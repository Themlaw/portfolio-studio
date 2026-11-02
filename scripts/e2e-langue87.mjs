#!/usr/bin/env node
/**
 * Lot 87 « la page garde sa place quand on change de langue » (chromium, serveur requis, base neuve, une connexion admin).
 * Données SYNTHÉTIQUES : une page de 14 blocs Texte dont les longueurs FR / EN sont très différentes (impair : FR court, EN long ;
 * pair : l'inverse), repérés par « BLOC-NN ». Mesures de géométrie, pas de pixels.
 *  A  Site public, 1440 px : un bloc précis en haut (sous l'en-tête) -> EN -> FR -> EN -> FR : le même bloc reste en haut, à +-40 px ;
 *     même chose à mi-bloc (proportion gardée) ; aucun passage par le haut de la page pendant le changement.
 *  B  Site public, 390 px : idem, menu mobile ouvert au moment du changement (il se referme ou non, le bloc reste en place).
 *  C  Inchangé : un lien normal (logo) ramène en haut, une ancre (#contenu) fonctionne, le bouton Retour revient où il revenait ;
 *     en haut de page on reste en haut ; la page 404 passe en EN comme avant (en haut).
 *  D  Éditeur visuel : la bascule FR / EN garde le bloc en haut de la toile, dans les deux sens, plusieurs fois.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=A,B,C,D] [SHOTS=dossier] node scripts/e2e-langue87.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { canvas, setDraft, sql } from "./lib/grille31d.mjs";
import { login, pageIdOf, waitFor } from "./lib/medias-setup.mjs";

const BASE = process.env.BASE ?? "http://localhost:3920";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(process.env.BATTERY_DIR ?? tmpdir(), "shots-langue87");
mkdirSync(SHOTS, { recursive: true });
const TOL = 40;

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const info = (label) => console.log(`INFO ${label}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);

/* ---- Page de test : 14 blocs Texte aux longueurs FR / EN opposées ----------------------------------------------------------- */
const SHORT = (n, l) => `BLOC-${String(n).padStart(2, "0")} ${l === "fr" ? "Un court texte." : "A short text."}`;
const LONG = (n, l) => {
  const s = l === "fr" ? "Une phrase assez longue pour remplir plusieurs lignes de la colonne de texte, répétée plusieurs fois." : "A fairly long sentence that fills several lines of the text column, repeated several times over.";
  return `BLOC-${String(n).padStart(2, "0")} ` + Array.from({ length: 9 }, () => s).join(" ");
};
const BLOCKS = Array.from({ length: 14 }, (_, i) => {
  const n = i + 1;
  const frShort = n % 2 === 1;
  return { uid: `l${n}`, type: "rich-text", props: { paragraphs: [{ fr: frShort ? SHORT(n, "fr") : LONG(n, "fr"), en: frShort ? LONG(n, "en") : SHORT(n, "en") }] } };
});
const pageId = pageIdOf("personnages");
const slugs = sql((db) => JSON.parse(db.prepare("select slug from pages where id = ?").get(pageId).slug));
const FR = `/fr/${slugs.fr}`;
const EN = `/en/${slugs.en}`;

async function publish(pg, id, blocks) {
  setDraft(id, blocks);
  await pg.goto(`${BASE}/admin/pages/${id}/editer`, { waitUntil: "domcontentloaded" });
  await canvas(pg);
  await sleep(2500);
  const btn = pg.getByRole("button", { name: "Publier", exact: true });
  await waitFor(async () => !(await btn.isDisabled()), 30000);
  await btn.click();
  const confirm = pg.locator("dialog[open]").getByRole("button", { name: "Mettre en ligne" });
  if (await confirm.waitFor({ timeout: 3000 }).then(() => true, () => false)) await confirm.click();
  const done = await waitFor(() => sql((db) => db.prepare("select draft from pages where id = ?").get(id)).draft === null, 120000);
  await sleep(1000);
  return done;
}
ok("P0 publication de la page de test", await publish(page, pageId, BLOCKS));
await sleep(1500);

/* ---- Mesures (exécutées dans la page ou dans la toile) ---------------------------------------------------------------------- */
/** Bloc sous l'en-tête collant : numéro, haut du bloc rapporté à la ligne sous l'en-tête, hauteur. */
const probe = () => {
  const header = document.querySelector("header.site-header");
  const ref = header && getComputedStyle(header).position === "sticky" ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
  const rows = [...document.querySelectorAll("#contenu section")]
    .filter((s) => /BLOC-\d+/.test(s.textContent ?? ""))
    .map((s) => {
      const r = s.getBoundingClientRect();
      return { n: Number(/BLOC-(\d+)/.exec(s.textContent)[1]), top: Math.round(r.top - ref), h: Math.round(r.height) };
    });
  const cur = rows.find((r) => r.top + r.h > 1) ?? null;
  return { y: Math.round(scrollY), max: document.documentElement.scrollHeight - innerHeight, cur, hs: rows.map((r) => r.h) };
};
/** Place le bloc `n` pour que sa ligne de référence le traverse à la proportion `ratio` de sa hauteur. */
const placeBlock = ({ n, ratio }) => {
  const header = document.querySelector("header.site-header");
  const ref = header && getComputedStyle(header).position === "sticky" ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
  const s = [...document.querySelectorAll("#contenu section")].find((x) => x.textContent?.includes(`BLOC-${String(n).padStart(2, "0")} `));
  const r = s.getBoundingClientRect();
  window.scrollTo({ top: scrollY + r.top - ref + ratio * r.height, left: 0, behavior: "instant" });
};
const describe = (a) => (a.cur ? `bloc ${a.cur.n} à ${a.cur.top} px (hauteur ${a.cur.h}), y=${a.y}` : `aucun bloc, y=${a.y}`);

/** Lien de langue visible (en-tête de bureau, ou de téléphone). */
const langLink = (p, code) => p.locator(`header.site-header a[hreflang="${code}"]:visible`).first();
/** Garde la plus petite position de défilement vue pendant le changement (aucun passage par le haut). */
const spy = (p) => p.evaluate(() => {
  window.__ys = [];
  const tick = () => {
    window.__ys.push(Math.round(scrollY));
    window.__raf = requestAnimationFrame(tick);
  };
  tick();
});
const spied = (p) => p.evaluate(() => {
  cancelAnimationFrame(window.__raf);
  return window.__ys;
});

async function switchTo(p, code) {
  await spy(p);
  await langLink(p, code).click();
  await p.waitForURL(code === "en" ? /\/en\// : /\/fr\//, { timeout: 30000 });
  await sleep(1500);
  return spied(p);
}

/* ---- A. Site public, 1440 px -------------------------------------------------------------------------------------------------- */
async function publicPage(viewport, url) {
  const c = await browser.newContext({ viewport });
  const p = await c.newPage();
  p.setDefaultTimeout(45000);
  p.on("pageerror", (e) => errors.push(`public : ${e.message}`));
  await p.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
  return p;
}
const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});

async function roundTrips(p, tag, cases, before) {
  let lang = "fr";
  for (const c of cases) {
    await p.evaluate(placeBlock, c);
    await sleep(400);
    const start = await p.evaluate(probe);
    if (!(start.cur?.n === c.n)) {
      ok(`${tag} ${c.n}@${c.ratio} départ`, false, describe(start));
      continue;
    }
    for (let i = 0; i < 4; i++) {
      const to = lang === "fr" ? "en" : "fr";
      if (before) await before(p);
      const ys = await switchTo(p, to);
      lang = to;
      const a = await p.evaluate(probe);
      const sameBlock = a.cur?.n === c.n;
      // Au sommet de l'écran : début du bloc à +-40 px, ou (mi-bloc) la ligne le traverse encore à peu près à la même proportion.
      const where = a.cur ? (c.ratio === 0 ? Math.abs(a.cur.top) <= TOL : Math.abs(-a.cur.top / a.cur.h - c.ratio) <= 0.12) : false;
      ok(`${tag} bloc ${c.n} (${c.ratio}) -> ${to.toUpperCase()} : même bloc en haut`, sameBlock && where, describe(a));
      ok(`${tag} bloc ${c.n} -> ${to.toUpperCase()} : pas de passage par le haut`, Math.min(...ys) > 100, `plus bas y=${Math.min(...ys)}`);
      if (i === 0) await shot(p, `${tag}-${c.n}-${to}`);
    }
    // Retour dans la langue de départ pour le cas suivant.
    if (lang !== "fr") {
      await switchTo(p, "fr");
      lang = "fr";
    }
  }
}

if (run("A")) {
  const p = await publicPage({ width: 1440, height: 900 }, FR);
  const hs = await p.evaluate(probe);
  info(`hauteurs des blocs FR : ${hs.hs.join(" ")}`);
  await roundTrips(p, "A", [{ n: 7, ratio: 0 }, { n: 11, ratio: 0 }, { n: 4, ratio: 0.4 }, { n: 9, ratio: 0.5 }]);
  await p.context().close();
}

/* ---- B. Téléphone, 390 px, menu ouvert --------------------------------------------------------------------------------------- */
if (run("B")) {
  const p = await publicPage({ width: 390, height: 844 }, FR);
  await roundTrips(p, "B", [{ n: 7, ratio: 0 }, { n: 12, ratio: 0 }, { n: 5, ratio: 0.5 }]);
  // Menu ouvert au moment du changement de langue.
  const menu = p.locator("header.site-header button[aria-controls=nav-mobile]");
  await p.evaluate(placeBlock, { n: 8, ratio: 0 });
  await sleep(300);
  await menu.click();
  await sleep(500);
  const ys = await switchTo(p, "en");
  const a = await p.evaluate(probe);
  ok("B menu ouvert -> EN : même bloc en haut", a.cur?.n === 8 && Math.abs(a.cur.top) <= TOL, describe(a));
  ok("B menu ouvert : pas de passage par le haut", Math.min(...ys) > 100, `plus bas y=${Math.min(...ys)}`);
  const open = await p.locator("#nav-mobile").isVisible();
  info(`menu mobile après le changement : ${open ? "ouvert" : "refermé"}`);
  if (open) await menu.click();
  await sleep(500);
  const b = await p.evaluate(probe);
  ok("B menu refermé : le bloc reste en haut", b.cur?.n === 8 && Math.abs(b.cur.top) <= TOL, describe(b));
  await shot(p, "B-menu");
  await p.context().close();
}

/** Premier lien du menu de bureau qui mène ailleurs que sur la page courante. */
async function otherPageLink(p) {
  return p.evaluate(() => {
    const links = [...document.querySelectorAll("header.site-header nav a[href^='/fr/']")].filter((a) => a.getClientRects().length > 0 && !a.hasAttribute("hreflang"));
    const a = links.find((x) => new URL(x.href).pathname !== location.pathname);
    return a ? new URL(a.href).pathname : null;
  });
}
/* ---- C. Ce qui ne change pas -------------------------------------------------------------------------------------------------- */
if (run("C")) {
  const p = await publicPage({ width: 1440, height: 900 }, FR);
  // Lien normal : en haut.
  await p.evaluate(placeBlock, { n: 9, ratio: 0 });
  await sleep(300);
  const before = await p.evaluate(probe);
  const other = await otherPageLink(p);
  await p.locator(`header.site-header nav a[href="${other}"]`).first().click();
  await p.waitForURL((u) => u.pathname === other, { timeout: 30000 });
  await sleep(1200);
  const home = await p.evaluate(() => Math.round(scrollY));
  // Comme avant le lot : Next remet le haut du contenu (sous l'en-tête collant), pas la position d'avant.
  ok("C1 un lien normal ramène en haut", before.y > 500 && home <= 150, `avant y=${before.y}, après y=${home} (${other})`);

  // Ancre : le lien d'évitement pointe sur #contenu.
  await p.goto(`${BASE}${FR}`, { waitUntil: "networkidle" });
  await p.evaluate(placeBlock, { n: 9, ratio: 0 });
  await sleep(300);
  await p.evaluate(() => document.querySelector('a[href="#contenu"]').click());
  await sleep(1500);
  const anchor = await p.evaluate(() => ({ hash: location.hash, y: Math.round(scrollY), top: Math.round(document.getElementById("contenu").getBoundingClientRect().top) }));
  ok("C2 une ancre (#contenu) fonctionne : adresse et position", anchor.hash === "#contenu" && anchor.y < 500 && Math.abs(anchor.top) <= 120, JSON.stringify(anchor));

  // Retour : revient à la page précédente comme avant (même chemin que sans ce lot : la position n'est pas inventée).
  await p.goto(`${BASE}${FR}`, { waitUntil: "networkidle" });
  await p.evaluate(placeBlock, { n: 7, ratio: 0 });
  await sleep(400);
  const y0 = (await p.evaluate(probe)).y;
  await switchTo(p, "en");
  await p.goBack();
  await p.waitForURL(/\/fr\//, { timeout: 30000 });
  await sleep(1500);
  const back = await p.evaluate(probe);
  info(`Retour après FR->EN : y avant=${y0}, après=${back.y}, ${describe(back)}`);
  ok("C3 Retour : revient sur la page française", /\/fr\//.test(p.url()));
  ok("C3b Retour : la page française est bien affichée (pas de saut vers autre chose)", back.cur !== null && back.y >= 0);
  // Et il ne reste pas de position en attente : un lien suivi ensuite part du haut.
  await p.evaluate(placeBlock, { n: 9, ratio: 0 });
  await sleep(300);
  await p.locator(`header.site-header nav a[href="${other}"]`).first().click();
  await p.waitForURL((u) => u.pathname === other, { timeout: 30000 });
  await sleep(1000);
  const y4 = await p.evaluate(() => Math.round(scrollY));
  info(`C4 lien normal après Retour : y=${y4}`);
  ok("C4 rien en attente après Retour : un lien normal part du haut", y4 <= 150, `y=${y4}`);

  // En haut de page : on reste en haut dans l'autre langue.
  await p.goto(`${BASE}${FR}`, { waitUntil: "networkidle" });
  await switchTo(p, "en");
  ok("C5 en haut de page : reste en haut", (await p.evaluate(() => Math.round(scrollY))) <= 150);

  // 404 : le changement de langue se fait comme avant, en haut.
  await p.goto(`${BASE}/fr/page-qui-nexiste-pas-87`, { waitUntil: "networkidle" });
  await langLink(p, "en").click();
  await p.waitForURL(/\/en(\/|$)/, { timeout: 30000 });
  await sleep(1000);
  ok("C6 page 404 : bascule en EN, en haut", /\/en\/?$/.test(new URL(p.url()).pathname) && (await p.evaluate(() => Math.round(scrollY))) <= 150, p.url());

  // Clic avec Ctrl : ouvre à part, la page d'origine ne bouge pas.
  await p.goto(`${BASE}${FR}`, { waitUntil: "networkidle" });
  await p.evaluate(placeBlock, { n: 6, ratio: 0 });
  await sleep(300);
  const y1 = await p.evaluate(() => Math.round(scrollY));
  const popup = p.context().waitForEvent("page", { timeout: 15000 }).catch(() => null);
  await langLink(p, "en").click({ modifiers: ["Control"] });
  const popped = await popup;
  ok("C7 Ctrl + clic : la page d'origine reste en place et en français", /\/fr\//.test(p.url()) && Math.abs((await p.evaluate(() => Math.round(scrollY))) - y1) <= 2);
  if (popped) await popped.close();
  await p.context().close();
}

/* ---- D. Éditeur visuel -------------------------------------------------------------------------------------------------------- */
if (run("D")) {
  await page.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
  let fr = await canvas(page);
  await sleep(2500);
  const seg = page.locator(".ve-seg button");
  const hs = await fr.evaluate(probe);
  info(`éditeur : hauteurs des blocs FR : ${hs.hs.join(" ")}`);
  let lang = "fr";
  for (const c of [{ n: 7, ratio: 0 }, { n: 10, ratio: 0 }, { n: 4, ratio: 0.5 }]) {
    fr = await canvas(page);
    await fr.evaluate(placeBlock, c);
    await sleep(500);
    const s0 = await fr.evaluate(probe);
    if (s0.cur?.n !== c.n) ok(`D bloc ${c.n} départ`, false, describe(s0));
    for (let i = 0; i < 4; i++) {
      const to = lang === "fr" ? "en" : "fr";
      await seg.filter({ hasText: to.toUpperCase() }).click();
      await sleep(300);
      // La nouvelle toile : attendre qu'elle soit prête dans la bonne langue.
      await waitFor(async () => {
        const h = await page.locator("iframe.ve-frame").elementHandle();
        const f = await h?.contentFrame();
        return f ? await f.evaluate((l) => document.documentElement.lang === l && document.documentElement.hasAttribute("data-edit-mode"), to).catch(() => false) : false;
      }, 60000);
      lang = to;
      fr = await canvas(page);
      await sleep(2800);
      const a = await fr.evaluate(probe);
      const where = a.cur ? (c.ratio === 0 ? Math.abs(a.cur.top) <= TOL : Math.abs(-a.cur.top / a.cur.h - c.ratio) <= 0.12) : false;
      ok(`D éditeur bloc ${c.n} (${c.ratio}) -> ${to.toUpperCase()} : même bloc en haut de la toile`, a.cur?.n === c.n && where, describe(a));
      if (i === 0) await shot(page, `D-${c.n}-${to}`);
    }
    if (lang !== "fr") {
      await seg.filter({ hasText: "FR" }).click();
      await sleep(4000);
      lang = "fr";
    }
  }
}

ok("E aucune erreur JavaScript de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
