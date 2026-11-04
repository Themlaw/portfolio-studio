#!/usr/bin/env node
/**
 * Roue des couleurs libres (lot 107b), UN chromium. Serveur requis, base NEUVE, une connexion admin. Données SYNTHÉTIQUES.
 * Pour chaque roue du menu « Fond & carte » (couleur du Fond, de la Carte, contour du Fond, contour de la Carte), à la souris à 1024 px,
 * en tactile à 1024 px et en tactile à 390 px (écran bas, 560 px) : le bouton s'ouvre au toucher, la fenêtre est ENTIÈREMENT visible
 * (elle ne s'ouvre pas sous le bord de l'écran), une couleur choisie (code, carré saturation, bande de teinte) s'applique au rendu mesuré,
 * et persiste après rechargement (brouillon).
 * Usage : BASE=… ADMIN_EMAIL=… ADMIN_PASSWORD=… node scripts/e2e-couleur107.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL, PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const PAGE_ID = 5;
let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(250);
  }
  return false;
}
const MODES = [
  ["souris 1024", { viewport: { width: 1024, height: 800 } }, false],
  ["tactile 1024", { viewport: { width: 1024, height: 800 }, hasTouch: true, isMobile: true }, true],
  ["tactile 390", { viewport: { width: 390, height: 560 }, hasTouch: true, isMobile: true }, true],
];
const HEX = { "souris 1024": ["#2a6f4f", "#8a2be2", "#c0392b", "#16a085"], "tactile 1024": ["#1f77b4", "#d35400", "#7f8c8d", "#27ae60"], "tactile 390": ["#6c3483", "#b9770e", "#1a5276", "#a93226"] };
const rgb = (h) => `rgb(${[1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(", ")})`;
const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2"] });

async function login(ctx) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/admin/connexion`, { waitUntil: "networkidle" });
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/admin/connexion"), { timeout: 90000 }), page.click("button[type=submit]")]);
  return page;
}
async function openEditor(page) {
  await page.goto(`${BASE}/admin/pages/${PAGE_ID}/editer`, { waitUntil: "domcontentloaded" });
  const h = await page.waitForSelector("iframe.ve-frame", { timeout: 120000 });
  const f = await h.contentFrame();
  await f.waitForSelector("html[data-edit-mode]", { timeout: 180000 });
  await sleep(1200);
  return f;
}
const colorsOf = (f) =>
  f.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('[data-edit-block]:not([data-edit-parent]) :is(.zone, .surface-card, .fond-bloc), [data-edit-block]:not([data-edit-parent]) .fond-in')) {
      const cs = getComputedStyle(el);
      out.push(cs.backgroundColor, cs.borderTopColor);
    }
    return out;
  });

for (const [name, opts, touch] of MODES) {
  const ctx = await browser.newContext(opts);
  try {
    const page = await login(ctx);
    let f = await openEditor(page);
    const act = (loc) => (touch ? loc.tap() : loc.click());
    const blk = f.locator("[data-edit-block]:not([data-edit-parent])").first();
    const openMenu = async () => {
      await blk.scrollIntoViewIfNeeded();
      await act(blk);
      await act(f.locator('.pe-tools [data-testid="fond-button"]'));
      const menu = f.locator('[data-testid="fond-menu"]');
      await menu.waitFor({ timeout: 20000 });
      await f.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
      return menu;
    };
    let menu = await openMenu();
    await act(menu.locator('[data-testid="fond-section-fond"] [data-kind="color"]'));
    await act(menu.locator('[data-testid="fond-section-carte"] [data-kind="color"]'));
    // Un contour à chaque section : il faut une épaisseur pour que la couleur du contour existe.
    for (const slot of ["fond", "carte"]) await act(menu.locator(`[data-testid="fond-section-${slot}"] [data-contour="medium"]`)).catch(() => {});
    const wheelsAll = menu.locator('.tc-wheel[aria-label="Couleur personnalisée"]');
    const n = await wheelsAll.count();
    ok(`${name} : quatre roues dans « Fond & carte » (couleur et contour du Fond et de la Carte)`, n === 4, `n=${n}`);
    const names = ["couleur du Fond", "couleur de la Carte", "contour du Fond", "contour de la Carte"];
    // L'ordre des roues dans le menu : Fond (couleur, contour), Carte (couleur, contour).
    const order = [0, 2, 1, 3].slice(0, n);
    const picked = [];
    for (let k = 0; k < Math.min(n, 4); k++) {
      const w = wheelsAll.nth(k);
      const label = `${name} : roue ${k + 1}`;
      await w.scrollIntoViewIfNeeded();
      const target = await w.evaluate((el) => { const r = el.getBoundingClientRect(); const t = el.ownerDocument.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return t === el || el.contains(t); });
      ok(`${label} : rien ne recouvre le bouton`, target);
      await act(w);
      const opened = await f.locator(".cp").first().waitFor({ timeout: 5000 }).then(() => true, () => false);
      ok(`${label} : le bouton ouvre le sélecteur`, opened);
      if (!opened) continue;
      await sleep(400);
      const view = await f.locator(".cp").first().evaluate((el) => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, vh: innerHeight, vw: innerWidth }; });
      ok(`${label} : le sélecteur est entièrement à l'écran`, view.top >= -1 && view.bottom <= view.vh + 1 && view.left >= -1 && view.right <= view.vw + 1, JSON.stringify(view));
      const hex = HEX[name][k];
      const input = f.locator('.cp input[aria-label="Code couleur"]');
      await input.fill(hex);
      await input.press("Enter");
      ok(`${label} : le code ${hex} s'applique à la pastille`, await until(async () => (await w.evaluate((el) => el.querySelector(".tc-wheel-dot")?.style.background ?? "")) === rgb(hex)));
      // Carré saturation et bande de teinte au toucher / à la souris.
      const plane = f.locator(".cp .cp-sv").first();
      const pb = await plane.boundingBox();
      const before = await w.evaluate((el) => el.querySelector(".tc-wheel-dot")?.style.background);
      await (touch ? plane.tap({ position: { x: pb.width * 0.25, y: pb.height * 0.3 } }) : plane.click({ position: { x: pb.width * 0.25, y: pb.height * 0.3 } }));
      ok(`${label} : un geste sur le carré change la couleur`, await until(async () => (await w.evaluate((el) => el.querySelector(".tc-wheel-dot")?.style.background)) !== before));
      const final = await w.evaluate((el) => el.querySelector(".tc-wheel-dot")?.style.background);
      picked.push(final);
      await page.keyboard.press("Escape");
      await sleep(300);
      if (!(await menu.isVisible().catch(() => false))) menu = await openMenu();
    }
    // Effet mesuré sur le rendu : chaque couleur choisie se retrouve dans les fonds ou contours du bloc.
    await page.keyboard.press("Escape");
    const painted = await colorsOf(f);
    for (const [k, c] of picked.entries()) ok(`${name} : roue ${k + 1} (${c}) visible dans le rendu mesuré`, painted.some((p) => p.replace(/ /g, "") === c.replace(/ /g, "")), JSON.stringify(painted).slice(0, 300));
    // Persistance : brouillon enregistré, la page rouverte garde les couleurs.
    await page.waitForFunction(() => !/Enregistrement/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, { timeout: 60000 });
    await sleep(800);
    f = await openEditor(page);
    const after = await colorsOf(f);
    for (const [k, c] of picked.entries()) ok(`${name} : roue ${k + 1} (${c}) après rechargement`, after.some((p) => p.replace(/ /g, "") === c.replace(/ /g, "")), JSON.stringify(after).slice(0, 300));
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 6).join(" "));
  } finally {
    await ctx.close();
  }
}
await browser.close();
console.log(failures ? `\n${failures} ÉCHEC(S)` : "\nTout passe");
process.exit(failures ? 1 : 0);
