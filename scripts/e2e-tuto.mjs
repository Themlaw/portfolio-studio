#!/usr/bin/env node
/**
 * Tuto du kit Photoshop (admin), UN chromium. Serveur dev requis (redémarré,
 * pré-chauffé), une connexion.
 * Thèmes → « Tuto du kit » : focus sur le titre, toutes les slides au clavier
 * (→) jusqu'à la fin sans image cassée, focus piégé (Tab), Échap → fermé,
 * focus rendu au bouton ; écran du kit → reprise à la dernière slide vue,
 * « Renvoyer le kit » (slide 14) mène à l'envoi ; slide 2 : « Télécharger le
 * kit » ; 390 px : balayage tactile, aucune animation en mouvement réduit ;
 * étiquettes jamais sur leur cadre (toutes les slides) ; image ≥ 55 % de la
 * largeur en 1440 ; 390 px : légende, image agrandie au toucher (Échap),
 * barre de progression ; contraste au pixel ; captures screenshots/tuto2.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… node scripts/e2e-tuto.mjs
 */
import { mkdirSync } from "node:fs";

import { chromium } from "playwright";
import sharp from "sharp";
import { gotoThemesPage } from "./lib/theme-live.mjs";
import { gotoIdle } from "./lib/idle.mjs";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const SHOTS = "screenshots/tuto2";
mkdirSync(SHOTS, { recursive: true });

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
/** Contraste au pixel : couleur de fond dominante de la boîte, puis la couleur la plus contrastée. */
async function pixelContrast(page, locator) {
  const b = await locator.boundingBox();
  const png = await page.screenshot({ clip: { x: b.x, y: b.y, width: Math.max(4, b.width), height: Math.max(4, b.height) } });
  const { data } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const counts = new Map();
  for (let i = 0; i < data.length; i += 3) {
    const k = `${data[i] >> 2},${data[i + 1] >> 2},${data[i + 2] >> 2}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const bg = [...counts.entries()].sort((x, y) => y[1] - x[1])[0][0].split(",").map((v) => Number(v) * 4 + 2);
  let best = 1;
  for (let i = 0; i < data.length; i += 3) best = Math.max(best, ratio([data[i], data[i + 1], data[i + 2]], bg));
  return Math.round(best * 100) / 100;
}

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(`${BASE}/admin/connexion`, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL);
await page.fill("#password", PASSWORD);
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/admin/connexion"), { timeout: 60000 }), page.click("button[type=submit]")]);

const dialog = page.getByRole("dialog");
const counter = () => page.locator(".a-tuto-count").textContent();
const imageOk = () => page.$eval("[data-tuto-image]", (i) => i.complete && i.naturalWidth > 0).catch(() => false);
const waitImage = () => page.waitForFunction(() => {
  const i = document.querySelector("[data-tuto-image]");
  return i && i.complete && i.naturalWidth > 0;
}, null, { timeout: 15000 }).catch(() => null);

/* ---- Depuis Thèmes : du début à la fin au clavier ------------------------ */
await gotoThemesPage(page, BASE);
await page.evaluate(() => localStorage.removeItem("portfolio-tuto-kit"));
await page.getByTestId("tuto-open").click();
await dialog.waitFor();
ok("dialogue modal accessible (aria-modal, titre)", (await dialog.getAttribute("aria-modal")) === "true" && Boolean(await dialog.getAttribute("aria-labelledby")));
ok("focus sur le titre de la slide à l'ouverture", await page.evaluate(() => document.activeElement?.hasAttribute("data-tuto-title")));
ok("slide 1 / 16", (await counter())?.trim() === "1 / 16", await counter());
const total = 16;
const broken = [];
const titles = [];
const overlaps = [];
for (let i = 0; i < total; i++) {
  await waitImage();
  if (!(await imageOk())) broken.push(i + 1);
  // Chaque étiquette hors de son cadre (le cadre SVG est le rect de même rang).
  const bad = await page.evaluate(() => {
    const fig = document.querySelector(".a-tuto-figure");
    const svg = fig?.querySelector("svg");
    if (!fig || !svg) return [];
    const rects = [...svg.querySelectorAll("rect.a-tuto-box")].map((r) => r.getBoundingClientRect());
    const tags = [...fig.querySelectorAll(".a-tuto-tag")].map((t) => t.getBoundingClientRect());
    return tags.map((t, k) => {
      const r = rects[k];
      const inter = r && t.left < r.right - 1 && t.right > r.left + 1 && t.top < r.bottom - 1 && t.bottom > r.top + 1;
      return inter ? k : -1;
    }).filter((k) => k >= 0);
  });
  if (bad.length) overlaps.push(`${i + 1}:${bad.join("+")}`);
  if (i === 0) {
    const w = await page.$eval(".a-tuto-figure", (f) => f.getBoundingClientRect().width);
    ok(`1440 : l'image occupe ${Math.round((w / 1440) * 100)} % de la largeur (≥ 55 %)`, w / 1440 >= 0.55);
  }
  titles.push(await page.locator("[data-tuto-title]").textContent());
  if (i === 1) ok("slide 2 : bouton « Télécharger le kit Photoshop »", (await dialog.getByRole("button", { name: "Télécharger le kit Photoshop", exact: true }).count()) === 1);
  if (i < total - 1) await page.keyboard.press("ArrowRight");
}
ok("navigation au clavier jusqu'à la fin : 16 / 16", (await counter())?.trim() === "16 / 16", await counter());
ok("aucune image cassée sur les 16 slides", broken.length === 0, broken.join(","));
ok("étiquettes d'annotation jamais sur le cadre qu'elles désignent (16 slides)", overlaps.length === 0, overlaps.join(" "));
console.log(`      slides : ${titles.map((t, i) => `${i + 1}. ${t}`).join(" | ")}`);
for (let i = 0; i < 25; i++) await page.keyboard.press("Tab");
ok("focus piégé dans le dialogue (25 × Tab)", await page.evaluate(() => Boolean(document.querySelector(".a-tuto")?.contains(document.activeElement))));
await page.keyboard.press("Escape");
await sleep(200);
ok("Échap ferme le tuto", (await dialog.count()) === 0);
ok("focus rendu au bouton « Tuto du kit »", await page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "tuto-open"));

/* ---- Depuis l'écran du kit : reprise, « Renvoyer le kit » ---------------- */
await gotoIdle(page, `${BASE}/admin/themes/galerie-lumineuse/kit`);
await page.getByTestId("tuto-open").click();
await dialog.waitFor();
ok("reprise à la dernière slide vue (16 / 16)", (await counter())?.trim() === "16 / 16", await counter());
await page.locator(".a-tuto-dot").nth(13).click();
const send = dialog.getByRole("button", { name: "Renvoyer le kit", exact: true });
ok("slide 14 depuis un thème : bouton « Renvoyer le kit »", (await send.count()) === 1);
await send.click();
await sleep(400);
ok("« Renvoyer le kit » ferme le tuto et mène à l'envoi", (await dialog.count()) === 0 && (await page.locator("#kit-send").isVisible()));

/* ---- Contraste au pixel et captures 1440 -------------------------------- */
await page.getByTestId("tuto-open").click();
await dialog.waitFor();
const measures = [];
for (const [name, n] of [["principe", 0], ["carte", 3], ["paysage", 4], ["icones", 8], ["curseur", 9], ["revue", 14]]) {
  await page.locator(".a-tuto-dot").nth(n).click();
  await waitImage();
  await sleep(300);
  await page.screenshot({ path: `${SHOTS}/tuto-${String(n + 1).padStart(2, "0")}-${name}-1440.png` });
  if (n === 3) {
    measures.push(["titre", await pixelContrast(page, page.locator("[data-tuto-title]")), 4.5]);
    measures.push(["puce", await pixelContrast(page, page.locator(".a-tuto-text li").first()), 4.5]);
    measures.push(["compteur", await pixelContrast(page, page.locator(".a-tuto-count")), 4.5]);
    measures.push(["Suivant", await pixelContrast(page, dialog.getByRole("button", { name: "Suivant →" })), 4.5]);
    measures.push(["Précédent", await pixelContrast(page, dialog.getByRole("button", { name: "← Précédent" })), 4.5]);
    measures.push(["étiquette d'annotation", await pixelContrast(page, page.locator(".a-tuto-tag").first()), 4.5]);
    measures.push(["point de progression courant", await pixelContrast(page, page.locator('.a-tuto-dot[aria-current="step"]')), 3]);
  }
}
for (const [name, r, min] of measures) ok(`contraste au pixel : ${name} ${r}:1 (≥ ${min}:1)`, r >= min);
await page.keyboard.press("Escape");

/* ---- 390 px : balayage tactile, mouvement réduit, captures --------------- */
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await ctx.storageState(), reducedMotion: "reduce", hasTouch: true });
const m = await mobile.newPage();
m.on("pageerror", (e) => errors.push(e.message));
await gotoThemesPage(m, BASE);
await m.evaluate(() => localStorage.setItem("portfolio-tuto-kit", "0"));
await m.getByTestId("tuto-open").click();
await m.getByRole("dialog").waitFor();
const slide = m.locator(".a-tuto-slide");
const sb = await slide.boundingBox();
await slide.dispatchEvent("pointerdown", { pointerType: "touch", clientX: sb.x + 300, clientY: sb.y + 200 });
await slide.dispatchEvent("pointerup", { pointerType: "touch", clientX: sb.x + 80, clientY: sb.y + 200 });
await sleep(200);
ok("390 px : balayage vers la gauche → slide suivante", (await m.locator(".a-tuto-count").textContent())?.trim() === "2 / 16", await m.locator(".a-tuto-count").textContent());
ok("mouvement réduit : aucune animation de slide", (await m.$eval(".a-tuto-slide", (e) => getComputedStyle(e).animationName)) === "none");
const stacked = await m.evaluate(() => {
  const a = document.querySelector(".a-tuto-media").getBoundingClientRect();
  const t = document.querySelector(".a-tuto-text").getBoundingClientRect();
  return t.top >= a.bottom - 1;
});
ok("390 px : image au-dessus, texte dessous", stacked);
ok("390 px : barre de progression au lieu des points", (await m.locator(".a-tuto-progress").isVisible()) && !(await m.locator(".a-tuto-dots").isVisible()));
await m.locator(".a-tuto-dot").first().evaluate((b) => b.click());
await m.waitForFunction(() => document.querySelector(".a-tuto-count")?.textContent.trim() === "1 / 16");
ok("390 px : étiquettes remplacées par des numéros hors cadre et une légende", (await m.locator(".a-tuto-legend").isVisible()) && !(await m.locator(".a-tuto-tag").first().isVisible()) && (await m.locator(".a-tuto-hint").isVisible()));
await m.locator(".a-tuto-zoomable").click();
await m.locator(".a-tuto-zoom").waitFor();
const zoomOk = await m.$eval("[data-tuto-zoom]", (i) => i.complete && i.naturalWidth > 0);
await m.keyboard.press("Escape");
await sleep(200);
ok("390 px : toucher l'image l'agrandit ; Échap ferme l'image, pas le tuto", zoomOk && (await m.locator(".a-tuto-zoom").count()) === 0 && (await m.getByRole("dialog").count()) === 1);
for (const [name, n] of [["principe", 0], ["carte", 3], ["paysage", 4], ["icones", 8], ["curseur", 9], ["revue", 14]]) {
  await m.locator(".a-tuto-dot").nth(n).evaluate((b) => b.click());
  await m.waitForFunction(() => {
    const i = document.querySelector("[data-tuto-image]");
    return i && i.complete && i.naturalWidth > 0;
  });
  await sleep(250);
  await m.screenshot({ path: `${SHOTS}/tuto-${String(n + 1).padStart(2, "0")}-${name}-390.png` });
}
ok("aucune erreur JS", errors.length === 0, errors.join(" | "));
await browser.close();
if (failures) {
  console.error(`e2e-tuto : ${failures} échec(s)`);
  process.exit(1);
}
console.log("e2e-tuto : OK");
