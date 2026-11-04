#!/usr/bin/env node
/**
 * Lot 123 « changer de page remet en haut, sauf la bascule FR / EN » (chromium, serveur requis, base neuve, données SYNTHÉTIQUES du seed,
 * aucune connexion). Cause : `html { scroll-behavior: smooth }` sans `data-scroll-behavior="smooth"` sur <html> : Next ne coupe pas le
 * défilement doux pendant sa remise en haut ; la nouvelle page GLISSE (vers le premier bloc, 60 px = l en-tête) au lieu d arriver en haut.
 *  A  1440 px : page défilée loin, lien du menu / logo / tuile d une entrée / lien du pied -> scrollY === 0, sans glissade (aucune position
 *     intermédiaire entre l ancienne et 0)
 *  B  lien avec ancre (router.push vers /fr/decors#contenu) : arrivée sur l ancre, ancre visible
 *  C  bascule FR -> EN de la même page : position gardée (+- 150 px) ; EN -> FR de même
 *  D  Précédent / Suivant du navigateur : position restaurée (+- 80 px)
 *  E  390 px : menu burger ouvert, clic sur un lien : le menu se ferme, scrollY === 0
 *  F  aucune erreur JavaScript de page
 * Usage : BASE=… node scripts/e2e-scroll123.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:5400";
let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ["--disable-gpu", "--disable-extensions"] });
const errors = [];
const FAR = 2000;

async function open(viewport, url) {
  const p = await (await browser.newContext({ viewport })).newPage();
  p.setDefaultTimeout(45000);
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
  return p;
}
const farDown = async (p, y = FAR) => {
  await p.evaluate((t) => scrollTo({ top: t, behavior: "instant" }), y);
  await sleep(300);
  return p.evaluate(() => Math.round(scrollY));
};
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
const y = (p) => p.evaluate(() => Math.round(scrollY));

/** Clique, attend l arrivée sur `re`, laisse la page se poser ; renvoie les positions vues. */
async function go(p, click, re) {
  await spy(p);
  await click();
  await p.waitForURL(re, { timeout: 30000 });
  await sleep(1800);
  return spied(p);
}
const smooth = (ys, start) => ys.filter((v) => v > 1 && v < start - 1);

/* ---- A ------------------------------------------------------------------------------------------------------------------------------- */
{
  const p = await open({ width: 1440, height: 900 }, "/fr/personnages");
  ok("A0 <html> porte data-scroll-behavior=smooth", (await p.evaluate(() => document.documentElement.dataset.scrollBehavior)) === "smooth");
  const cases = [
    ["lien du menu", "/fr/personnages", () => p.locator("header.site-header a[href=\"/fr/decors\"]:visible").first().click(), /\/fr\/decors/],
    ["logo", "/fr/decors", () => p.locator("header.site-header a[href=\"/fr\"]:visible").first().click(), /\/fr$/],
    ["tuile d une entrée", "/fr", () => p.locator("#contenu a[href=\"/fr/animation\"]").first().click(), /\/fr\/animation/],
    ["lien du pied", "/fr/animation", () => p.locator("footer a[href=\"/fr/personnages\"]").first().click(), /\/fr\/personnages/],
  ];
  for (const [name, from, click, re] of cases) {
    await p.goto(`${BASE}${from}`, { waitUntil: "networkidle" });
    const start = await farDown(p, from === "/fr" ? 2500 : FAR);
    if (name === "tuile d une entrée" || name === "lien du pied") await p.locator(name === "lien du pied" ? "footer a[href=\"/fr/personnages\"]" : "#contenu a[href=\"/fr/animation\"]").first().scrollIntoViewIfNeeded();
    const from0 = await y(p);
    const ys = await go(p, click, re);
    const end = await y(p);
    ok(`A ${name} : arrivée en haut (scrollY === 0)`, end === 0, `départ ${from0}, arrivée ${end}`);
    ok(`A ${name} : sans glissade`, smooth(ys, from0).length === 0, `positions intermédiaires : ${smooth(ys, from0).slice(0, 6).join(",")}`);
    if (start < 500) ok(`A ${name} : le test était bien défilé`, false, `départ ${start}`);
  }
  /* ---- B ----------------------------------------------------------------------------------------------------------------------------- */
  await p.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
  await farDown(p);
  await p.evaluate(() => window.next.router.push("/fr/decors#contenu"));
  await p.waitForURL(/\/fr\/decors#contenu/, { timeout: 30000 });
  await sleep(2000);
  const anc = await p.evaluate(() => {
    const r = document.getElementById("contenu").getBoundingClientRect();
    return { top: Math.round(r.top), vh: innerHeight, y: Math.round(scrollY) };
  });
  ok("B lien avec ancre : #contenu visible en haut de la fenêtre", anc.top >= -2 && anc.top < anc.vh / 2, JSON.stringify(anc));
  await p.context().close();
}

/* ---- C / D --------------------------------------------------------------------------------------------------------------------------- */
{
  const p = await open({ width: 1440, height: 900 }, "/fr/personnages");
  const start = await farDown(p);
  const lang = (code) => p.locator(`header.site-header a[hreflang="${code}"]:visible`).first();
  await go(p, () => lang("en").click(), /\/en\//);
  let now = await y(p);
  ok("C FR -> EN : position gardée", Math.abs(now - start) <= 150 && now > 1000, `avant ${start}, après ${now}`);
  const mid = now;
  await go(p, () => lang("fr").click(), /\/fr\//);
  now = await y(p);
  ok("C EN -> FR : position gardée", Math.abs(now - mid) <= 150 && now > 1000, `avant ${mid}, après ${now}`);

  // D : page A défilée -> page B (en haut) -> Précédent -> A restaurée -> Suivant -> B
  await p.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
  const a0 = await farDown(p, 1500);
  await go(p, () => p.locator("header.site-header a[href=\"/fr/decors\"]:visible").first().click(), /\/fr\/decors/);
  ok("D page suivante en haut", (await y(p)) === 0);
  await p.goBack({ waitUntil: "commit" });
  await p.waitForURL(/\/fr\/personnages/);
  await sleep(2000);
  const back = await y(p);
  ok("D Précédent : position restaurée", Math.abs(back - a0) <= 80, `avant ${a0}, restaurée ${back}`);
  await p.goForward({ waitUntil: "commit" });
  await p.waitForURL(/\/fr\/decors/);
  await sleep(1500);
  ok("D Suivant : page de destination en haut", (await y(p)) <= 80, `y=${await y(p)}`);
  await p.context().close();
}

/* ---- E ------------------------------------------------------------------------------------------------------------------------------- */
{
  const p = await open({ width: 390, height: 800 }, "/fr/personnages");
  await farDown(p);
  const burger = p.locator("header.site-header button[aria-controls=\"nav-mobile\"]");
  await burger.click();
  await sleep(300);
  const from0 = await y(p);
  const ys = await go(p, () => p.locator("#nav-mobile a[href=\"/fr/decors\"]").click(), /\/fr\/decors/);
  ok("E 390 px : menu fermé après le clic", (await burger.getAttribute("aria-expanded")) === "false");
  ok("E 390 px : arrivée en haut (scrollY === 0)", (await y(p)) === 0, `départ ${from0}, arrivée ${await y(p)}`);
  ok("E 390 px : sans glissade", smooth(ys, from0).length === 0, `intermédiaires : ${smooth(ys, from0).slice(0, 6).join(",")}`);
  await p.context().close();
}

ok("F aucune erreur JavaScript de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
