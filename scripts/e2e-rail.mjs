#!/usr/bin/env node
/**
 * Barre de glissement des planches (hotfix v0.10.1) : retour de l'artiste
 * sur Décors (« ce n'est pas la barre bleue qui bouge, mais une barre grise
 * qui apparaît ») : curseur large de 83 % qui ne bougeait que de 17 %, piste
 * grise découverte lue comme une seconde barre.
 * Pour les 4 thèmes livrés, en 1440 et en 390, sur /fr/decors :
 *  - largeur du curseur ≤ 34 % de la piste ;
 *  - déplacement visible du curseur ≥ 60 % de la piste du début à la fin
 *    (1440) ;
 *  - glisser le curseur du début à la fin de la piste parcourt toute la bande ;
 *  - clavier (Fin, Début, →) inchangé ;
 *  - piste lisible (contraste au pixel ≥ 1,5:1) ; au survol, piste et curseur
 *    s'épaississent ensemble, la piste garde sa couleur.
 * Captures : screenshots/hotfix-rail/<étiquette>/.
 * Usage : node scripts/e2e-rail.mjs [étiquette]   (serveur dev sur :3001)
 */
import { mkdirSync } from "node:fs";

import { chromium } from "playwright";
import sharp from "sharp";

const BASE = process.env.BASE ?? "http://localhost:3001";
const LABEL = process.argv[2] ?? "apres";
const SHOTS = `screenshots/hotfix-rail/${LABEL}`;
mkdirSync(SHOTS, { recursive: true });
// RAIL_THEMES=kit-a : même contrôle avec un trait dessiné ([data-kit-stroke]).
const THEMES = process.env.RAIL_THEMES ? process.env.RAIL_THEMES.split(",") : ["galerie-lumineuse", "pro", "carnet-d-atelier", "salle-de-projection"];

let failures = 0;
function ok(label, cond, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lum = ([r, g, b]) => {
  const c = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
};
const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
for (const [w, h] of [
  [1440, 900],
  [390, 844],
]) {
  for (const theme of THEMES) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, reducedMotion: "reduce" });
    await page.goto(`${BASE}/api/theme-preview?id=${theme}&redirect=/fr/decors&banner=0`, { waitUntil: "networkidle" });
    await sleep(600);
    const bar = page.locator(".rail-bar").first();
    if (!(await bar.count())) {
      ok(`${theme} ${w} : barre présente sur Décors`, false);
      await page.close();
      continue;
    }
    await bar.scrollIntoViewIfNeeded();
    const tag = `${theme} ${w}`;
    const geo = () =>
      bar.evaluate((b) => {
        const t = b.querySelector(".rail-bar-track").getBoundingClientRect();
        const th = b.querySelector(".rail-bar-thumb").getBoundingClientRect();
        const rail = document.getElementById(b.getAttribute("aria-controls"));
        // Fin de la bande atteinte : la dernière image entièrement visible
        // (l'aimantation des planches, scroll-snap « proximity », peut caler
        // la fin sur le début de la dernière image).
        const frames = rail.querySelectorAll(".strip-frame");
        const last = frames[frames.length - 1]?.getBoundingClientRect();
        const atEnd = Boolean(last) && last.right <= rail.getBoundingClientRect().right + 1;
        return { trackX: t.x, trackW: t.width, trackH: t.height, thumbX: th.x, thumbW: th.width, thumbH: th.height, scroll: rail.scrollLeft, slack: rail.scrollWidth - rail.clientWidth, now: Number(b.getAttribute("aria-valuenow")), atEnd };
      });
    const railTo = (x) => bar.evaluate((b, v) => (document.getElementById(b.getAttribute("aria-controls")).scrollLeft = v), x);

    await railTo(0);
    await sleep(200);
    const start = await geo();
    const share = start.thumbW / start.trackW;
    ok(`${tag} : curseur ≤ 34 % de la piste (${Math.round(share * 100)} %)`, share <= 0.34 + 1e-6);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `${SHOTS}/decors-${theme}-${w}-debut.png`, clip: { x: 0, y: Math.max(0, start.trackX ? (await bar.boundingBox()).y - 260 : 0), width: w, height: 320 } });
    await railTo(start.slack);
    await sleep(200);
    const end = await geo();
    const travel = (end.thumbX - start.thumbX) / start.trackW;
    if (w === 1440) ok(`${tag} : déplacement visible du curseur ≥ 60 % de la piste (${Math.round(travel * 100)} %)`, travel >= 0.6);
    await page.screenshot({ path: `${SHOTS}/decors-${theme}-${w}-fin.png`, clip: { x: 0, y: Math.max(0, (await bar.boundingBox()).y - 260), width: w, height: 320 } });

    // Glisser : du début à la fin de la piste.
    await railTo(0);
    await sleep(200);
    const g0 = await geo();
    const bb = await bar.boundingBox();
    const y = bb.y + bb.height / 2;
    await page.mouse.move(g0.thumbX + g0.thumbW / 2, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(g0.thumbX + g0.thumbW / 2 + ((g0.trackX + g0.trackW - g0.thumbX) * i) / 10 + 40, y);
    await sleep(100);
    const gEnd = await geo();
    await page.mouse.move(g0.trackX - 40, y, { steps: 10 });
    await sleep(100);
    const gBack = await geo();
    await page.mouse.up();
    ok(`${tag} : glisser jusqu'au bout parcourt toute la bande, et revient au début`, gEnd.atEnd && gBack.scroll <= 2, `${gEnd.scroll}/${gEnd.slack} puis ${gBack.scroll}`);

    // Clavier : Fin, Début, →.
    await bar.focus();
    await page.keyboard.press("End");
    await sleep(400);
    const kEnd = await geo();
    await page.keyboard.press("Home");
    await sleep(400);
    const kHome = await geo();
    await page.keyboard.press("ArrowRight");
    await sleep(400);
    const kRight = await geo();
    ok(`${tag} : clavier (Fin, Début, →)`, kEnd.atEnd && kHome.scroll <= 2 && kRight.scroll > 2 && kHome.now === 0, `${kEnd.scroll}/${kEnd.slack} ${kHome.scroll} ${kRight.scroll}`);
    await railTo(0);
    await page.mouse.move(0, 0);
    await bar.evaluate((b) => b.blur());
    await sleep(300);

    // Piste : contraste au pixel (hors curseur), puis survol.
    const rest = await geo();
    const shot = await page.screenshot({ clip: { x: rest.trackX + rest.trackW * 0.6, y: (await bar.boundingBox()).y - 6, width: rest.trackW * 0.35, height: (await bar.boundingBox()).height + 12 } });
    const { data } = await sharp(shot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const counts = new Map();
    for (let i = 0; i < data.length; i += 3) {
      const k = `${data[i]},${data[i + 1]},${data[i + 2]}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const bg = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0].split(",").map(Number);
    let best = 1;
    for (let i = 0; i < data.length; i += 3) best = Math.max(best, ratio([data[i], data[i + 1], data[i + 2]], bg));
    ok(`${tag} : piste lisible, contraste ${best.toFixed(2)}:1 (≥ 1,5:1)`, best >= 1.5);
    const colorRest = await bar.evaluate((b) => getComputedStyle(b.querySelector(".rail-bar-track")).backgroundColor + getComputedStyle(b.querySelector(".rail-bar-track"), "::before").backgroundColor);
    await bar.hover();
    await sleep(400);
    const hov = await geo();
    const colorHover = await bar.evaluate((b) => getComputedStyle(b.querySelector(".rail-bar-track")).backgroundColor + getComputedStyle(b.querySelector(".rail-bar-track"), "::before").backgroundColor);
    ok(`${tag} : au survol, piste et curseur s'épaississent ensemble (${rest.trackH}→${hov.trackH} px, ${rest.thumbH}→${hov.thumbH} px), piste de même couleur`, hov.trackH > rest.trackH && hov.thumbH > rest.thumbH && colorRest === colorHover);
    await page.screenshot({ path: `${SHOTS}/decors-${theme}-${w}-survol.png`, clip: { x: 0, y: Math.max(0, (await bar.boundingBox()).y - 260), width: w, height: 320 } });
    await page.close();
  }
}
await browser.close();
console.log(failures ? `e2e-rail : ${failures} échec(s)` : "e2e-rail : OK");
process.exit(failures ? 1 : 0);
