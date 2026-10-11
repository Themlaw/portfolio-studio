#!/usr/bin/env node
/**
 * Mesure de fluidité de la barre de défilement d'une planche (avant / après).
 * Sur /fr/personnages, première planche qui déborde :
 *  1. glisser le curseur de la barre de gauche à droite (souris, 90 pas, ~1,5 s) ;
 *  2. molette au-dessus de la barre (20 crans) ;
 *  3. flèche droite maintenue sur la barre (12 répétitions rapides).
 * Relevés par le navigateur pendant chaque geste : images (rAF), images
 * longues (> 25 ms entre deux rAF), plus grand écart, et « retours en
 * arrière » de scrollLeft pendant un geste qui ne va que vers la droite
 * (l'accrochage qui se bat avec le glisser). Chromium : en plus, les
 * long-animation-frames (> 50 ms) et, par le protocole DevTools, le travail
 * du fil principal pendant le geste (mises en page, recalculs de style,
 * temps de script, en ms), avec un processeur ralenti ×THROTTLE (4 par
 * défaut : un téléphone moyen) pour faire apparaître les à-coups.
 * Usage : BROWSER=chromium|firefox BASE=http://localhost:3103 node scripts/rail-perf.mjs
 */
import { chromium, firefox } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3103";
const which = process.env.BROWSER === "firefox" ? firefox : chromium;
const browser = await which.launch(which === chromium ? { args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions"] } : {});
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const cdp = which === chromium ? await page.context().newCDPSession(page) : null;
const THROTTLE = Number(process.env.THROTTLE ?? 4);
if (cdp) {
  await cdp.send("Performance.enable");
}
const metrics = async () => {
  if (!cdp) return null;
  const { metrics: m } = await cdp.send("Performance.getMetrics");
  const get = (n) => m.find((x) => x.name === n)?.value ?? 0;
  return { layouts: get("LayoutCount"), styles: get("RecalcStyleCount"), script: get("ScriptDuration") * 1000, layoutMs: get("LayoutDuration") * 1000, styleMs: get("RecalcStyleDuration") * 1000, task: get("TaskDuration") * 1000 };
};
let m0 = null;

await page.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
// Diagnostic : VARIANT=nomask retire le fondu (masque), VARIANT=notransition
// garde le masque sans animer ses bords : coût de chacun.
if (process.env.VARIANT === "notransition") await page.addStyleTag({ content: ".strip-rail{transition:none!important}" });
if (process.env.VARIANT === "nomask") await page.addStyleTag({ content: ".strip-rail{-webkit-mask-image:none!important;mask-image:none!important;transition:none!important}" });
// La planche qui déborde le plus (celle de « Bande lot 3 » si elle est posée).
const barIndex = await page.evaluate(() => {
  const bars = [...document.querySelectorAll(".rail-bar")];
  const slack = (b) => {
    const r = document.getElementById(b.getAttribute("aria-controls"));
    return r ? r.scrollWidth - r.clientWidth : 0;
  };
  let best = 0;
  bars.forEach((b, i) => slack(b) > slack(bars[best]) && (best = i));
  bars.forEach((b, i) => b.toggleAttribute("data-perf", i === best));
  return best;
});
const bar = page.locator(".rail-bar").nth(barIndex);
await bar.scrollIntoViewIfNeeded();
await page.waitForTimeout(800);

/** Démarre l'enregistrement dans la page. */
const start = async () => {
  if (cdp) await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  m0 = await metrics();
  return page.evaluate(() => {
    const rail = document.getElementById(document.querySelector(".rail-bar[data-perf]").getAttribute("aria-controls"));
    const w = window;
    w.__perf = { frames: [], back: 0, last: rail.scrollLeft, loaf: 0, run: true };
    rail.addEventListener("scroll", (w.__onScroll = () => {
      if (rail.scrollLeft < w.__perf.last - 0.5) w.__perf.back++;
      w.__perf.last = rail.scrollLeft;
    }));
    try {
      w.__po = new PerformanceObserver((l) => (w.__perf.loaf += l.getEntries().length));
      w.__po.observe({ type: "long-animation-frame" });
    } catch {
      // Firefox : pas de LoAF
    }
    const tick = (t) => {
      if (!w.__perf.run) return;
      w.__perf.frames.push(t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
};
const stop = async () => {
  const m1 = await metrics();
  if (cdp) await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  const main = m1 && m0 ? Object.fromEntries(Object.entries(m1).map(([k, v]) => [k, Math.round(v - m0[k])])) : undefined;
  const res = await page.evaluate(() => {
    const w = window;
    w.__perf.run = false;
    w.__po?.disconnect();
    const rail = document.getElementById(document.querySelector(".rail-bar[data-perf]").getAttribute("aria-controls"));
    rail.removeEventListener("scroll", w.__onScroll);
    const f = w.__perf.frames;
    const gaps = f.slice(1).map((t, i) => t - f[i]);
    return { frames: f.length, long: gaps.filter((g) => g > 25).length, maxGap: Math.round(Math.max(0, ...gaps)), back: w.__perf.back, loaf: w.__perf.loaf, end: Math.round(rail.scrollLeft) };
  });
  return main ? { ...res, main } : res;
};
const reset = () => page.evaluate(() => document.getElementById(document.querySelector(".rail-bar[data-perf]").getAttribute("aria-controls")).scrollTo({ left: 0, behavior: "instant" }));

const results = {};
// 1. Glisser.
await reset();
await page.waitForTimeout(400);
let b = await bar.boundingBox();
await start();
await page.mouse.move(b.x + 6, b.y + b.height / 2);
await page.mouse.down();
for (let i = 1; i <= 90; i++) {
  await page.mouse.move(b.x + 6 + ((b.width - 12) * i) / 90, b.y + b.height / 2);
  await page.waitForTimeout(16);
}
await page.mouse.up();
await page.waitForTimeout(500);
results.glisser = await stop();

// 2. Molette au-dessus de la barre.
await reset();
await page.waitForTimeout(400);
b = await bar.boundingBox();
await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
await start();
for (let i = 0; i < 20; i++) {
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(40);
}
await page.waitForTimeout(700);
results.molette = await stop();

// 3. Flèche droite répétée (clavier, focus sur la barre).
await reset();
await page.waitForTimeout(400);
await bar.focus();
await start();
for (let i = 0; i < 12; i++) {
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(60);
}
await page.waitForTimeout(900);
results.clavier = await stop();

console.log(JSON.stringify({ browser: process.env.BROWSER ?? "chromium", throttle: cdp ? THROTTLE : 1, label: process.env.LABEL ?? "", variant: process.env.VARIANT ?? "", ...results }));
await browser.close();
