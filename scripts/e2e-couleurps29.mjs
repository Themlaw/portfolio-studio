#!/usr/bin/env node
/**
 * Lot 29 (v0.22) : sélecteur de couleur « à la Photoshop » (carré saturation × luminosité + bande de teinte), avertissements
 * de lisibilité jamais bloquants, nuances (survol, petits textes, voile…) choisissables. UN chromium sobre, base NEUVE (seed).
 *
 *  P. Sélecteur : clic dans le carré, glisser la bande, clavier (flèches, Maj), retour à la précédente, rôles ARIA, taille,
 *     aperçu en direct sur la toile, valeur stockée en hex.
 *  Q. Les autres endroits : carte d'une rubrique, panneau « Couleurs » de l'éditeur, couleurs de la DA (page du thème),
 *     palette du thème (administration), couleur des boutons et liens de la page.
 *  C. Contraste : une couleur peu contrastée est acceptée, enregistrée, publiée et APPLIQUÉE (avertissement seulement) :
 *     boutons et liens d'une page, palette du site, couleurs d'un thème.
 *  N. Nuances : survol, petits textes, voile de l'image agrandie choisis dans le panneau « Couleurs », visibles en public ;
 *     « Revenir… » efface le choix (lot 30 : valeur du thème si elle en fixe une, sinon calcul).
 *
 * Usage : BASE=http://localhost:3380 DATA_DIR=~/pf/data-29 ADMIN_EMAIL=… ADMIN_PASSWORD=… SHOTS=/dossier [ONLY=P,Q,C,N] node scripts/e2e-couleurps29.mjs
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const DB = path.join(process.env.DATA_DIR ?? "data", "portfolio.db");
const SHOTS = process.env.SHOTS ?? "screenshots/couleurps29";
const ONLY = process.env.ONLY ?? "";
const run = (k) => !ONLY || ONLY.split(",").includes(k);
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
function ok(label, cond, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (sql, ...args) => {
  const db = new Database(DB, { readonly: true });
  try {
    return db.prepare(sql).all(...args);
  } finally {
    db.close();
  }
};
const homeId = q("select page_id id from blocks where type = 'hero' limit 1")[0].id;
const draftOf = (id) => JSON.parse(q("select draft from pages where id = ?", id)[0]?.draft ?? "null");
const setting = (key) => JSON.parse(q("select value from settings where key = ?", key)[0]?.value ?? "null");
const sitePalette = () => setting("siteDraft")?.snap?.styles?.palette ?? {};
const themeData = (id) => JSON.parse(q("select data from themes where id = ?", id)[0]?.data ?? "null");
async function waitFor(fn, timeout = 60000) {
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(300)) if (await fn()) return true;
  return false;
}
const until = (f, fn, arg, timeout = 60000) => f.waitForFunction(fn, arg, { timeout, polling: 200 }).then(() => true, () => false);

/* ---- Couleurs : conversions de contrôle (indépendantes du code testé) ---- */
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgbStr = (h) => `rgb(${hexRgb(h).join(", ")})`;
const parseRgb = (s) => (/rgba?\(([^)]+)\)/.exec(s)?.[1] ?? "").split(",").slice(0, 3).map((v) => Math.round(Number(v)));
const near = (a, b, tol = 2) => a.length === 3 && b.length === 3 && a.every((v, i) => Math.abs(v - b[i]) <= tol);
const hsvToHex = (h, s, v) => {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255);
  };
  return `#${[f(5), f(3), f(1)].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
};
const hexHsv = (hex) => {
  const [r, g, b] = hexRgb(hex).map((x) => x / 255);
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  const h = d === 0 ? 0 : max === r ? (((g - b) / d + 6) % 6) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
  return { h, s: max === 0 ? 0 : d / max, v: max };
};

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());

await page.goto(`${BASE}/admin/connexion`, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL);
await page.fill("#password", PASSWORD);
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/admin/connexion"), { timeout: 90000 }), page.click("button[type=submit]")]);

async function canvas() {
  const handle = await page.waitForSelector("iframe.ve-frame", { timeout: 120000 });
  const f = await handle.contentFrame();
  await f.waitForSelector("html[data-edit-mode]", { timeout: 180000 });
  return f;
}
async function settled() {
  await page.waitForFunction(() => !/Enregistrement/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, { timeout: 120000 });
  await sleep(500);
}
async function openEditor(id) {
  await page.goto(`${BASE}/admin/pages/${id}/editer`, { waitUntil: "domcontentloaded" });
  let f = await canvas();
  if (await page.getByRole("button", { name: "Abandonner les modifications" }).count()) {
    await page.getByRole("button", { name: "Abandonner les modifications" }).click();
    await Promise.all([
      page.waitForEvent("framenavigated", { predicate: (fr) => fr === page.mainFrame(), timeout: 60000 }),
      page.getByRole("dialog").getByRole("button", { name: "Abandonner les modifications" }).click(),
    ]);
    f = await canvas();
  }
  await sleep(1500);
  return f;
}
async function publish() {
  await settled();
  await page.getByRole("button", { name: "Publier", exact: true }).click();
  return waitFor(async () => /En ligne/.test((await page.locator(".ve-status").textContent()) ?? ""), 120000);
}
async function anon(p) {
  const r = await fetch(BASE + p, { redirect: "manual" });
  return { status: r.status, html: await r.text() };
}
const paletteSheet = (html) => /<style id="site-palette"[^>]*>([^<]*)<\/style>/.exec(html)?.[1] ?? "";
async function openBar(f, sel) {
  if (await f.locator(".lk-bar").count()) {
    await f.locator(".lk-bar .lk-close").click().catch(() => {});
    await f.locator(".lk-bar").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  }
  const target = f.locator(sel).first();
  await target.scrollIntoViewIfNeeded();
  for (let essai = 0; essai < 4; essai++) {
    await page.mouse.move(700, 8);
    await sleep(150);
    await target.hover();
    if (!(await until(f, () => Boolean(document.querySelector(".lk-aa")), null, 8000))) continue;
    try {
      await f.locator(".lk-aa").click({ timeout: 4000 });
      if (await until(f, () => Boolean(document.querySelector(".lk-bar")), null, 8000)) return true;
    } catch {
      /* le « Aa » suit le survol : on recommence */
    }
  }
  return false;
}
const titleColor = (f) => f.evaluate(() => getComputedStyle(document.querySelector('h2[data-inline="title"]')).color);
async function setPageColor(on) {
  const sw = page.getByRole("switch", { name: "Boutons et liens de cette page" });
  if ((await sw.isChecked()) !== on) await page.locator("label.a-toggle", { hasText: "Boutons et liens de cette page" }).click();
  await page.waitForFunction(([want]) => document.querySelector('[data-testid="page-buttons-color"] input[role="switch"]')?.checked === want, [on], { timeout: 10000 });
}
/** Propriété personnalisée d'un document (valeur brute). */
const rootVar = (f, name) => f.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim().toLowerCase(), name);
/** Variable de couleur résolue (rgb). */
const colorVar = (f, name) =>
  f.evaluate((n) => {
    const p = document.createElement("span");
    p.style.color = `var(${n})`;
    document.body.appendChild(p);
    const v = getComputedStyle(p).color;
    p.remove();
    return v;
  }, name);

/** Copie modifiable du thème livré (créée une fois), ouverte sur sa page. */
async function ensureCopy() {
  if (!themeData("galerie-lumineuse-copie")) {
    await page.goto(`${BASE}/admin/themes/galerie-lumineuse`, { waitUntil: "networkidle" });
    const ink = page.locator('.a-da .lc-role-item[data-role="ink"]');
    await ink.locator(".lc-role").click();
    await ink.locator(".cp-hex").fill("#eeeeee");
    await ink.locator(".cp-hex").press("Enter");
    await page.locator('[data-testid="da-copy"]').click();
    await page.waitForURL(/\/admin\/themes\/galerie-lumineuse-copie$/, { timeout: 60000 });
  } else await page.goto(`${BASE}/admin/themes/galerie-lumineuse-copie`, { waitUntil: "networkidle" });
  await page.locator('[data-testid="da-section"]').waitFor();
}

/* ======================================== P. Sélecteur ======================================== */
if (run("P")) {
  console.log("== P. Sélecteur « à la Photoshop »");
  const f = await openEditor(homeId);
  const H2 = 'h2[data-inline="title"]';
  ok("P0 barre du texte ouverte", await openBar(f, H2));
  if (await f.locator('.lk-bar [role=radio]', { hasText: "Ce texte" }).count()) await f.locator('.lk-bar [role=radio]', { hasText: "Ce texte" }).click();
  const initial = parseRgb(await titleColor(f));
  await f.locator(".lk-bar .tc-wheel").click();
  const cp = f.locator(".cp");
  await cp.waitFor();
  ok("P1 structure : carré, bande de teinte, aperçu actuelle / précédente, plus de roue ni de curseur de luminosité", (await cp.locator(".cp-sv").count()) === 1 && (await cp.locator(".cp-hue").count()) === 1 && (await cp.locator(".cp-prev").count()) === 1 && (await cp.locator(".cp-now").count()) === 1 && (await cp.locator('[aria-label^="Luminosité"], .cp-wheel').count()) === 0);
  ok("P1b « Code couleur » conservé, curseur d'opacité conservé", (await cp.locator('input[aria-label="Code couleur"]').count()) === 1 && (await cp.locator(".cp-slider [role=slider]").count()) === 1);
  let sv = await cp.locator(".cp-sv").boundingBox();
  let hue = await cp.locator(".cp-hue").boundingBox();
  ok("P1c taille : carré ≈ 200-240 px de côté, bande ≈ 20 px", sv.width >= 190 && sv.width <= 240 && Math.abs(sv.width - sv.height) <= 2 && hue.width >= 18 && hue.width <= 22, JSON.stringify({ sv: [sv.width, sv.height], hue: hue.width }));
  ok("P1d disposition : bande à droite du carré, à la même hauteur", hue.x > sv.x + sv.width && Math.abs(hue.y - sv.y) <= 2 && Math.abs(hue.height - sv.height) <= 2);
  ok("P1e aucun défilement en largeur, fenêtre entièrement visible", await f.evaluate(() => { const c = document.querySelector(".cp"); const r = c.getBoundingClientRect(); return c.scrollWidth <= c.clientWidth + 1 && r.left >= 0 && r.right <= window.innerWidth + 1; }));
  const css = await f.evaluate(() => ({ sv: getComputedStyle(document.querySelector(".cp-sv")).touchAction, hue: getComputedStyle(document.querySelector(".cp-hue")).touchAction }));
  ok("P1f tactile : touch-action none (la page ne défile pas pendant le glisser)", css.sv === "none" && css.hue === "none", JSON.stringify(css));
  const aria = await f.evaluate(() => ({ sv: [document.querySelector(".cp-sv").getAttribute("role"), document.querySelector(".cp-sv").tabIndex], hue: [document.querySelector(".cp-hue").getAttribute("role"), document.querySelector(".cp-hue").getAttribute("aria-orientation")] }));
  ok("P1g rôles : deux « slider » au clavier, la bande verticale", aria.sv[0] === "slider" && aria.sv[1] === 0 && aria.hue[0] === "slider" && aria.hue[1] === "vertical", JSON.stringify(aria));
  ok("P1h le carré a le focus à l'ouverture", await f.evaluate(() => document.activeElement?.classList.contains("cp-sv")));
  const prevHex = ((await cp.locator(".cp-prev").getAttribute("aria-label")) ?? "").match(/#[0-9a-f]{6}/)?.[0] ?? "";
  ok("P1i la couleur précédente est celle du texte à l'ouverture", near(hexRgb(prevHex), initial, 1), `${prevHex} / ${initial}`);
  await page.screenshot({ path: `${SHOTS}/P1-selecteur-ouvert.png` });

  // Départ connu : #336699 (teinte 210°).
  const hex = cp.locator('input[aria-label="Code couleur"]');
  await hex.fill("#336699");
  await hex.press("Enter");
  await sleep(500);
  // La fenêtre (posée à côté de la barre, lot 30) se recale quand elle grandit (couleurs récentes) : on remesure.
  sv = await cp.locator(".cp-sv").boundingBox();
  hue = await cp.locator(".cp-hue").boundingBox();
  // Clic dans le carré : saturation 90 %, luminosité 90 % (à 10 % du haut et à 90 % de la gauche).
  await page.mouse.click(sv.x + sv.width * 0.9, sv.y + sv.height * 0.1);
  await sleep(600);
  const h1 = (await hex.inputValue()).toLowerCase();
  const hs1 = hexHsv(h1);
  ok("P2 clic dans le carré : saturation et luminosité ≈ 90 %, teinte inchangée (210°)", Math.abs(hs1.s - 0.9) < 0.04 && Math.abs(hs1.v - 0.9) < 0.04 && Math.abs(hs1.h - 210) < 3, `${h1} ${JSON.stringify(hs1)}`);
  ok("P2b l'aperçu de la toile suit (couleur du titre = valeur stockée)", await until(f, (c) => getComputedStyle(document.querySelector('h2[data-inline="title"]')).color === c, rgbStr(h1), 8000), `${await titleColor(f)} / ${h1}`);
  ok("P2c brouillon : la valeur est un hex #rrggbb", await waitFor(() => JSON.stringify(draftOf(homeId)).includes(`"color":"${h1}"`)), "absent du brouillon");
  ok("P2d aperçu actuelle / précédente : la pastille actuelle prend la couleur", near(parseRgb(await cp.locator(".cp-now").evaluate((e) => getComputedStyle(e).backgroundColor)), hexRgb(h1), 1));
  ok("P2e valeur lisible pour un lecteur d'écran : « Saturation 90 %, luminosité 90 % »", /^Saturation (89|90|91) %, luminosité (89|90|91) %$/.test((await cp.locator(".cp-sv").getAttribute("aria-valuetext")) ?? ""), await cp.locator(".cp-sv").getAttribute("aria-valuetext"));
  await page.screenshot({ path: `${SHOTS}/P2-clic-carre.png` });

  // Glisser la bande : du milieu (cyan) vers le tiers du haut (bleu, 240°). Rouge en haut, bas = rouge.
  await page.mouse.move(hue.x + hue.width / 2, hue.y + hue.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(hue.x + hue.width / 2, hue.y + hue.height * 0.4, { steps: 5 });
  await page.mouse.move(hue.x + hue.width / 2, hue.y + hue.height * (2 / 6), { steps: 5 });
  await page.mouse.up();
  await sleep(600);
  const h2 = (await hex.inputValue()).toLowerCase();
  const hs2 = hexHsv(h2);
  ok("P3 glisser la bande : teinte ≈ 240° (bleu), saturation et luminosité inchangées", Math.abs(hs2.h - 240) < 3 && Math.abs(hs2.s - hs1.s) < 0.04 && Math.abs(hs2.v - hs1.v) < 0.04, `${h2} ${JSON.stringify(hs2)}`);
  ok("P3b l'aperçu de la toile suit la teinte", await until(f, (c) => getComputedStyle(document.querySelector('h2[data-inline="title"]')).color === c, rgbStr(h2), 8000), `${await titleColor(f)} / ${h2}`);
  ok("P3c le carré change de teinte avec la bande (fond = teinte pure)", near(parseRgb(await cp.locator(".cp-sv").evaluate((e) => getComputedStyle(e).backgroundColor)), hexRgb(hsvToHex(hs2.h, 1, 1)), 3));
  const strip = [0.001, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 0.999];
  ok("P3d la bande va du rouge (haut) au rouge (bas) par magenta, bleu, cyan, vert, jaune", await cp.locator(".cp-hue").evaluate((e) => /^linear-gradient\(/.test(getComputedStyle(e).backgroundImage) && getComputedStyle(e).backgroundImage.includes("rgb(255, 0, 255)") && getComputedStyle(e).backgroundImage.includes("rgb(0, 255, 255)")) && strip.length === 7);
  const hand = await cp.locator(".cp-hue-arrow").boundingBox();
  ok("P3e la flèche de la bande est sur la teinte courante (≈ 1/3 depuis le haut)", Math.abs((hand.y + hand.height / 2 - hue.y) / hue.height - 1 / 3) < 0.03);
  await page.screenshot({ path: `${SHOTS}/P3-glisser-bande.png` });

  // Clavier.
  await cp.locator(".cp-sv").focus();
  const val = async () => /Saturation (\d+) %, luminosité (\d+) %/.exec((await cp.locator(".cp-sv").getAttribute("aria-valuetext")) ?? "")?.slice(1).map(Number) ?? [];
  const [s0, v0] = await val();
  await page.keyboard.press("ArrowLeft");
  let [s1, v1] = await val();
  ok("P4 flèche gauche : saturation −1", s1 === s0 - 1 && v1 === v0, `${s0}→${s1}`);
  await page.keyboard.press("Shift+ArrowLeft");
  [s1, v1] = await val();
  ok("P4b Maj + flèche gauche : saturation −10", s1 === s0 - 11, `${s0}→${s1}`);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  [s1, v1] = await val();
  ok("P4c flèches bas : luminosité −1 puis −10", v1 === v0 - 11, `${v0}→${v1}`);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowRight");
  [s1, v1] = await val();
  ok("P4d flèche haut : luminosité +1 ; flèche droite : saturation +1", v1 === v0 - 10 && s1 === s0 - 10, `${s0},${v0}→${s1},${v1}`);
  await sleep(500);
  ok("P4e le clavier change vraiment la couleur affichée sur la toile", await until(f, (c) => getComputedStyle(document.querySelector('h2[data-inline="title"]')).color === c, rgbStr((await hex.inputValue()).toLowerCase()), 8000));
  const outline = await f.evaluate(() => { const e = document.querySelector(".cp-sv"); const s = getComputedStyle(e); return { focus: e.matches(":focus-visible"), style: s.outlineStyle, width: parseFloat(s.outlineWidth) }; });
  ok("P4f focus visible sur le carré (contour)", outline.focus && outline.style !== "none" && outline.width >= 2, JSON.stringify(outline));
  await cp.locator(".cp-hue").focus();
  const hueNow = async () => Number(await cp.locator(".cp-hue").getAttribute("aria-valuenow"));
  const t0 = await hueNow();
  await page.keyboard.press("ArrowUp");
  const t1 = await hueNow();
  await page.keyboard.press("Shift+ArrowUp");
  const t2 = await hueNow();
  await page.keyboard.press("ArrowDown");
  const t3 = await hueNow();
  ok("P4g bande : flèche haut +1°, Maj + haut +10°, bas −1°", t1 === t0 + 1 && t2 === t1 + 10 && t3 === t2 - 1, `${t0} ${t1} ${t2} ${t3}`);
  ok("P4h « Teinte N° » lisible", /^Teinte \d+°$/.test((await cp.locator(".cp-hue").getAttribute("aria-valuetext")) ?? ""), await cp.locator(".cp-hue").getAttribute("aria-valuetext"));
  const outH = await f.evaluate(() => { const e = document.querySelector(".cp-hue"); return { focus: e.matches(":focus-visible"), style: getComputedStyle(e).outlineStyle }; });
  ok("P4i focus visible sur la bande", outH.focus && outH.style !== "none", JSON.stringify(outH));

  // Retour à la précédente.
  await cp.locator(".cp-prev").click();
  await sleep(600);
  ok("P5 clic sur la précédente : retour à la couleur d'avant (code couleur)", near(hexRgb((await hex.inputValue()).toLowerCase()), hexRgb(prevHex), 1), `${await hex.inputValue()} / ${prevHex}`);
  ok("P5b … sur la toile", await until(f, (c) => getComputedStyle(document.querySelector('h2[data-inline="title"]')).color === c, rgbStr(prevHex), 8000), await titleColor(f));
  ok("P5c … et dans le brouillon", await waitFor(() => JSON.stringify(draftOf(homeId)).includes(`"color":"${prevHex.toLowerCase()}"`)));

  // Écrans plus étroits : 1280 px et panneau étroit.
  await page.keyboard.press("Escape");
  for (const w of [1280, 420]) {
    await page.setViewportSize({ width: w, height: 900 });
    await sleep(1200);
    const ff = await canvas();
    if (!(await ff.locator(".lk-bar .tc-wheel").count())) await openBar(ff, H2);
    await ff.locator(".lk-bar .tc-wheel").click();
    await ff.locator(".cp .cp-sv").waitFor();
    await sleep(300);
    const m = await ff.evaluate(() => { const c = document.querySelector(".cp"); const r = c.getBoundingClientRect(); const s = document.querySelector(".cp-sv").getBoundingClientRect(); return { left: r.left, right: r.right, vw: document.documentElement.clientWidth, over: c.scrollWidth - c.clientWidth, sv: s.width }; });
    ok(`P6 ${w} px : sélecteur dans la fenêtre, sans défilement horizontal, carré encore confortable`, m.left >= 0 && m.right <= m.vw + 1 && m.over <= 1 && m.sv >= 120, JSON.stringify(m));
    await page.screenshot({ path: `${SHOTS}/P6-${w}.png` });
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  ok("P9 aucune erreur de page", errors.length === 0, errors.join(" | "));
}

/* ======================================== Q. Autres endroits ======================================== */
if (run("Q")) {
  console.log("== Q. Même sélecteur partout");
  const f = await openEditor(homeId);
  // Carte d'une rubrique.
  await f.locator('[data-edit-type="collection-tiles"] h2').first().click();
  const button = f.locator(".pe-tools button[title^=\"Carte de la rubrique\"]");
  await button.waitFor({ timeout: 20000 });
  await button.click();
  const menu = f.locator(".sm");
  await menu.getByRole("switch", { name: "Une carte sous la rubrique" }).click();
  await menu.getByRole("button", { name: "Couleur personnalisée" }).click();
  ok("Q1 carte de rubrique : carré + bande de teinte", await f.locator(".cp .cp-sv").waitFor({ timeout: 20000 }).then(() => true, () => false) && (await f.locator(".cp .cp-hue").count()) === 1);
  const csv = await f.locator(".cp .cp-sv").boundingBox();
  const before = await f.locator('.cp input[aria-label="Code couleur"]').inputValue();
  await page.mouse.click(csv.x + csv.width * 0.3, csv.y + csv.height * 0.4);
  await sleep(600);
  ok("Q1b carte : un clic dans le carré change la couleur de la carte", (await f.locator('.cp input[aria-label="Code couleur"]').inputValue()) !== before);
  await page.screenshot({ path: `${SHOTS}/Q1-carte.png` });
  await page.keyboard.press("Escape");
  await menu.getByRole("switch", { name: "Une carte sous la rubrique" }).click().catch(() => {});
  await settled();

  // Panneau « Couleurs » de l'éditeur (éditeur rouvert : aucune rubrique sélectionnée).
  const f2 = await openEditor(homeId);
  await page.getByRole("tab", { name: "Réglages" }).click();
  const bgItem = page.locator('.lc-role-item[data-role="bg"]');
  await bgItem.locator(".lc-role").click();
  ok("Q2 panneau « Couleurs » : carré + bande de teinte", (await bgItem.locator(".cp-sv").count()) === 1 && (await bgItem.locator(".cp-hue").count()) === 1);
  ok("Q2b panneau : code couleur conservé", (await bgItem.locator(".cp-hex").count()) === 1);
  const psv = await bgItem.locator(".cp-sv").boundingBox();
  await page.mouse.click(psv.x + psv.width * 0.1, psv.y + psv.height * 0.05);
  ok("Q2c panneau : un clic dans le carré (clair, peu saturé) change le fond de page dans le brouillon du site et sur la toile", await waitFor(() => typeof sitePalette().bg === "string") && (await waitFor(async () => (await rootVar(f2, "--t-color-bg")) === sitePalette().bg, 20000)), JSON.stringify(sitePalette()));
  await page.screenshot({ path: `${SHOTS}/Q2-panneau-couleurs.png` });
  await bgItem.locator(".cp-foot button", { hasText: "Revenir à la couleur du thème" }).click();
  await settled();

  // Couleurs de la DA (page d'un thème) et palette du thème (administration).
  await page.goto(`${BASE}/admin/themes/galerie-lumineuse`, { waitUntil: "networkidle" });
  const inkItem = page.locator('.a-da .lc-role-item[data-role="ink"]');
  await inkItem.locator(".lc-role").click();
  ok("Q3 couleurs de la DA (page du thème) : carré + bande de teinte", (await inkItem.locator(".cp-sv").count()) === 1 && (await inkItem.locator(".cp-hue").count()) === 1);
  await page.screenshot({ path: `${SHOTS}/Q3-da.png` });
  await inkItem.locator(".lc-role").click();
  await ensureCopy();
  if ((await page.locator('[data-testid="palette-details"]').getAttribute("open")) === null) await page.locator('[data-testid="palette-details"] summary').click();
  const pal = page.locator('.a-color[data-token="primary"]');
  await pal.scrollIntoViewIfNeeded();
  ok("Q4 palette du thème : plus de sélecteur natif du navigateur", (await pal.locator('input[type="color"]').count()) === 0 && (await pal.getByRole("button", { name: "Boutons et liens : sélecteur" }).count()) === 1);
  await pal.getByRole("button", { name: "Boutons et liens : sélecteur" }).click();
  ok("Q4b palette du thème : carré + bande de teinte, code couleur", (await pal.locator(".cp-sv").count()) === 1 && (await pal.locator(".cp-hue").count()) === 1 && (await pal.locator(".cp-hex").count()) === 1);
  await pal.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/Q4-palette-admin.png` });
  await page.keyboard.press("Escape");
  ok("Q4c Échap : fermé, focus rendu à la pastille", (await pal.locator(".cp").count()) === 0 && (await page.evaluate(() => document.activeElement?.classList.contains("cpw-chip"))));
  // Cartes par défaut (thème) et couleur des boutons et liens d'une page.
  const card = page.locator("#t-cartes").locator("..");
  ok("Q5 cartes des rubriques (thème) : plus de sélecteur natif", (await card.locator('input[type="color"]').count()) === 0 && (await card.getByRole("button", { name: "Autre couleur : sélecteur" }).count()) === 1);
  await page.goto(`${BASE}/admin/pages/${homeId}`, { waitUntil: "networkidle" });
  await setPageColor(true);
  ok("Q6 couleur des boutons et liens de la page : même sélecteur", (await page.locator('[data-testid="page-buttons-color"] input[type="color"]').count()) === 0 && (await page.getByRole("button", { name: "Couleur des boutons et liens de la page : sélecteur" }).count()) === 1);
  await page.getByRole("button", { name: "Couleur des boutons et liens de la page : sélecteur" }).click();
  ok("Q6b … ouvre le carré et la bande", (await page.locator('[data-testid="page-buttons-color"] .cp-sv').count()) === 1);
  await page.screenshot({ path: `${SHOTS}/Q6-formulaire-page.png` });
  await page.keyboard.press("Escape");
  await setPageColor(false);
}

/* ======================================== C. Contraste : jamais bloquant ======================================== */
if (run("C")) {
  console.log("== C. Manque de contraste : avertissement, jamais de blocage");
  // 1. Couleur des boutons et liens d'une page (éditeur visuel, publication, public).
  let f = await openEditor(homeId);
  await page.getByRole("tab", { name: "Réglages" }).click();
  await page.locator('[data-testid="page-buttons-color"]').waitFor({ timeout: 20000 });
  await setPageColor(true);
  await page.locator("#pe-accent-hex").fill("#eeeeee");
  ok("C1 boutons et liens de la page : avertissement « Lisibilité : insuffisante » (pas une erreur)", await page.locator('[data-testid="page-buttons-warning"]').waitFor({ timeout: 10000 }).then(() => true, () => false) && /Lisibilité : insuffisante/.test((await page.locator('[data-testid="page-buttons-warning"]').textContent()) ?? "") && /Contraste \d+,\d:1/.test((await page.locator('[data-testid="page-buttons-warning"]').getAttribute("title")) ?? ""));
  await settled();
  ok("C1b … enregistrée dans le brouillon", await waitFor(() => draftOf(homeId)?.accent === "#eeeeee"));
  await page.screenshot({ path: `${SHOTS}/C1-boutons-page.png` });
  ok("C1c … publication ACCEPTÉE", await publish());
  const pubHtml = (await anon("/fr")).html;
  ok("C1d … et APPLIQUÉE en public (--t-color-primary de la page)", /--t-color-primary:#eeeeee/.test(pubHtml), pubHtml.match(/--t-color-primary:[^;"]*/)?.[0]);
  // Formulaire de la page : enregistrer avec une couleur peu contrastée.
  await page.goto(`${BASE}/admin/pages/${homeId}`, { waitUntil: "networkidle" });
  ok("C1e formulaire : la couleur enregistrée n'est plus déclarée « ignorée »", (await page.getByText(/elle est ignorée/).count()) === 0);
  await page.locator("#pe-accent-hex").fill("#efefef");
  ok("C1f formulaire : avertissement visible, aucun blocage", await page.locator('[data-testid="page-buttons-warning"]').isVisible());
  await page.getByRole("button", { name: /^Enregistrer/ }).click();
  ok("C1g formulaire : enregistrement accepté (✓ Enregistré)", await page.locator(".a-save-state", { hasText: /✓\s*Enregistré/ }).waitFor({ timeout: 60000 }).then(() => true, () => false), await page.locator(".a-save-state").textContent());
  ok("C1h formulaire : couleur publiée telle quelle, appliquée en public", await waitFor(async () => /--t-color-primary:#efefef/.test((await anon("/fr")).html)));
  await setPageColor(false);
  await page.getByRole("button", { name: /^Enregistrer/ }).click();
  await page.locator(".a-save-state", { hasText: /✓\s*Enregistré/ }).waitFor({ timeout: 60000 });

  // 2. Palette du site : texte presque de la couleur du fond.
  f = await openEditor(homeId);
  await page.getByRole("tab", { name: "Réglages" }).click();
  const inkItem = page.locator('.lc-role-item[data-role="ink"]');
  await inkItem.locator(".lc-role").click();
  const hexField = inkItem.locator(".cp-hex");
  await hexField.fill("#f4f1ea");
  await hexField.press("Enter");
  ok("C2 palette du site : avertissement non bloquant (« lisibilité insuffisante », color appliquée quand même)", await page.getByTestId("palette-ignored").waitFor({ timeout: 10000 }).then(() => true, () => false) && /appliquées quand même/.test((await page.getByTestId("palette-ignored").textContent()) ?? "") && (await page.getByTestId("palette-ignored").getAttribute("role")) === "status");
  ok("C2b … la toile applique la couleur choisie (pas de retour au thème)", await until(f, (c) => getComputedStyle(document.documentElement).getPropertyValue("--t-color-ink").trim().toLowerCase() === c, "#f4f1ea", 10000), await rootVar(f, "--t-color-ink"));
  await settled();
  ok("C2c … brouillon du site : texte enregistré", await waitFor(() => sitePalette().ink === "#f4f1ea"), JSON.stringify(sitePalette()));
  await page.screenshot({ path: `${SHOTS}/C2-palette-site.png` });
  ok("C2d … publication ACCEPTÉE", await publish());
  const sheet = paletteSheet((await anon("/fr")).html);
  ok("C2e … couleur du texte publiée et appliquée en public", sheet.includes("--t-color-ink:#f4f1ea"), sheet.slice(0, 160));
  ok("C2f … le panneau reste un simple avertissement après publication", (await page.getByTestId("palette-ignored").count()) <= 1);
  // Retour (nettoyage) : revenir aux couleurs du thème et publier.
  await page.getByRole("button", { name: "Revenir aux couleurs du thème" }).click();
  ok("C2g nettoyage : publication", await publish());

  // 3. Thème : enregistrement d'une copie dont le texte est peu contrasté (#eeeeee sur fond clair).
  await ensureCopy();
  const ink3 = page.locator('.a-da .lc-role-item[data-role="ink"]');
  await ink3.locator(".lc-role").click();
  await ink3.locator(".cp-hex").fill("#eeeeee");
  await ink3.locator(".cp-hex").press("Enter");
  await page.locator('[data-testid="da-save"]').click();
  ok("C3 thème : « Enregistrer » accepté malgré un texte peu contrasté (✓ Enregistré)", await page.locator(".a-save-state", { hasText: /✓\s*Enregistré/ }).waitFor({ timeout: 90000 }).then(() => true, () => false), await page.locator(".a-save-state").textContent());
  ok("C3b … la couleur est enregistrée dans le thème", themeData("galerie-lumineuse-copie")?.tokens?.color?.ink === "#eeeeee", String(themeData("galerie-lumineuse-copie")?.tokens?.color?.ink));
  ok("C3c … l'avertissement de lisibilité est affiché (rôle « Texte »)", await waitFor(async () => /Lisibilité[^.]*insuffisante/.test((await page.locator('.a-da .lc-role-item[data-role="ink"]').textContent()) ?? ""), 10000));
  await page.screenshot({ path: `${SHOTS}/C3-theme.png`, fullPage: true });
  // Mise en ligne du thème peu contrasté : acceptée.
  await page.goto(`${BASE}/admin/themes`, { waitUntil: "networkidle" });
  const row = page.locator(".a-theme-card, li", { hasText: "Galerie lumineuse (copie)" }).first();
  await row.getByRole("button", { name: /Mettre en ligne/ }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: /Mettre en ligne/ }).last().click();
  ok("C3d mise en ligne d'un thème peu contrasté : acceptée", await waitFor(() => setting("activeThemeId") === "galerie-lumineuse-copie", 60000), String(setting("activeThemeId")));
  ok("C3e … le public applique ses couleurs", /--t-color-ink:#eeeeee/.test((await anon("/fr")).html));
  // Retour au thème livré.
  await page.reload({ waitUntil: "networkidle" });
  const preset = page.locator(".a-theme-card, li", { hasText: "Galerie lumineuse" }).filter({ hasNotText: "(copie)" }).first();
  await preset.getByRole("button", { name: /Mettre en ligne/ }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: /Mettre en ligne/ }).last().click();
  ok("C3f nettoyage : thème livré remis en ligne", await waitFor(() => setting("activeThemeId") === "galerie-lumineuse", 60000));
}

/* ======================================== N. Nuances ======================================== */
if (run("N")) {
  console.log("== N. Nuances choisissables");
  const f = await openEditor(homeId);
  await page.getByRole("tab", { name: "Réglages" }).click();
  const NAMES = {
    bg: ["Fond des rubriques alternées", "Traits de séparation"],
    ink: ["Texte secondaire (présentations, légendes)", "Petits textes au-dessus des titres", "Ombres"],
    primary: ["Au survol", "Texte sur les boutons"],
  };
  for (const [role, names] of Object.entries(NAMES)) {
    const got = (await page.locator(`.lc-role-item[data-role="${role}"] .lc-nuance-item .lc-text strong`).allTextContents()).map((t) => t.trim());
    ok(`N1 « ${role} » : ses nuances sont rangées dessous, dans l'ordre, avec des noms clairs`, JSON.stringify(got) === JSON.stringify(names), JSON.stringify(got));
  }
  for (const role of ["surface", "secondary", "tertiary"]) ok(`N1b « ${role} » : aucune nuance`, (await page.locator(`.lc-role-item[data-role="${role}"] .lc-nuance-item`).count()) === 0);
  const lb = (await page.locator('[data-testid="lightbox-colors"] .lc-text strong').allTextContents()).map((t) => t.trim());
  ok("N1c groupe « Image agrandie » : voile derrière l'image, texte et boutons sur le voile", JSON.stringify(lb) === JSON.stringify(["Voile derrière l'image", "Texte et boutons sur le voile"]) && (await page.getByRole("heading", { name: "Image agrandie" }).count()) === 1, JSON.stringify(lb));
  ok("N1d chaque nuance dit où elle se voit (phrase)", (await page.locator(".lc-nuance-item .lc-text small").count()) >= 9);
  const item = (k) => page.locator(`.lc-nuance-item[data-nuance="${k}"]`);
  ok("N2 voile : « Automatique (calculée : … ) » avec sa pastille calculée visible", (await item("scrim").getAttribute("data-origin")) === "auto" && /Automatique \(calculée/.test((await item("scrim").textContent()) ?? "") && (await item("scrim").locator(".lc-chip").evaluate((e) => getComputedStyle(e).backgroundColor)) !== "rgba(0, 0, 0, 0)");
  await page.screenshot({ path: `${SHOTS}/N2-panneau-couleurs-complet.png`, fullPage: true });
  const startHover = await colorVar(f, "--t-color-primary-hover");
  const startScrim = await rootVar(f, "--t-color-viewer");
  const pick = async (k, hex) => {
    if ((await item(k).getAttribute("data-open")) === null) await item(k).locator(".lc-nuance").click();
    const field = item(k).locator(".cp-hex");
    await field.waitFor();
    await field.fill(hex);
    await field.press("Enter");
  };
  await pick("primaryHover", "#aa0000");
  ok("N3 survol choisi : aperçu immédiat sur la toile", await until(f, (c) => { const p = document.createElement("span"); p.style.color = "var(--t-color-primary-hover)"; document.body.appendChild(p); const v = getComputedStyle(p).color; p.remove(); return v === c; }, "rgb(170, 0, 0)", 8000), await colorVar(f, "--t-color-primary-hover"));
  await pick("eyebrow", "#00aa00");
  await pick("scrim", "#102030");
  await pick("onScrim", "#fefefe");
  await settled();
  ok("N3b brouillon du site : les quatre nuances choisies", await waitFor(() => { const p = sitePalette(); return p.primaryHover === "#aa0000" && p.eyebrow === "#00aa00" && p.scrim === "#102030" && p.onScrim === "#fefefe"; }), JSON.stringify(sitePalette()));
  ok("N3c les rôles ne sont pas touchés", !sitePalette().bg && !sitePalette().primary && !sitePalette().ink);
  ok("N3d état « choisie » affiché", (await item("primaryHover").getAttribute("data-origin")) === "site" && /choisie/.test((await item("primaryHover").locator(".lc-nstate").textContent()) ?? ""));
  ok("N3e la toile : voile de la visionneuse = la couleur choisie telle quelle", (await rootVar(f, "--t-color-viewer")) === "#102030" && (await rootVar(f, "--t-color-eyebrow")) === "#00aa00");
  await page.screenshot({ path: `${SHOTS}/N3-nuances-choisies.png`, fullPage: true });
  ok("N4 publication", await publish());
  const sheet = paletteSheet((await anon("/fr")).html);
  ok("N4b public : feuille de la palette du site avec survol, étiquettes, voile et texte du voile", ["--t-color-primary-hover:#aa0000", "--t-color-eyebrow:#00aa00", "--t-color-scrim:#102030", "--t-color-on-scrim:#fefefe", "--t-color-viewer:#102030"].every((s) => sheet.includes(s)), sheet.slice(0, 300));
  // Rendu réel en public : étiquette, survol d'un bouton, visionneuse ouverte.
  const pubCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pp = await pubCtx.newPage();
  await pp.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  const eyebrows = await pp.locator(".eyebrow").evaluateAll((els) => els.map((e) => getComputedStyle(e).color));
  const eyeVar = await pp.evaluate(() => { const p = document.createElement("span"); p.style.color = "var(--color-eyebrow)"; document.body.appendChild(p); const v = getComputedStyle(p).color; p.remove(); return v; });
  ok("N5 public : petits textes au-dessus des titres dans la couleur choisie (variable du site, et l'étiquette de la page qui la suit)", eyeVar === "rgb(0, 170, 0)" && (eyebrows.length === 0 || eyebrows.includes("rgb(0, 170, 0)")), JSON.stringify({ eyeVar, eyebrows }));
  const btn = pp.locator("a.btn, button.btn").first();
  ok("N5b public : la page a un bouton", (await btn.count()) > 0);
  await btn.scrollIntoViewIfNeeded();
  await btn.hover();
  await sleep(900);
  ok("N5c public : bouton au survol = couleur choisie", (await btn.evaluate((e) => getComputedStyle(e).backgroundColor)) === "rgb(170, 0, 0)" || (await btn.evaluate((e) => getComputedStyle(e).color)) === "rgb(170, 0, 0)", await btn.evaluate((e) => `${getComputedStyle(e).backgroundColor} / ${getComputedStyle(e).color}`));
  await pp.mouse.move(5, 5);
  await pp.goto(`${BASE}/fr/decors`, { waitUntil: "networkidle" });
  await pp.locator("section:has(.strip-frame + .strip-frame) .strip-frame").first().click();
  const light = pp.locator(".lightbox");
  await light.waitFor({ state: "visible", timeout: 15000 });
  await sleep(800);
  const lbStyle = await light.evaluate((e) => ({ bg: getComputedStyle(e).backgroundColor, fg: getComputedStyle(e).color }));
  ok("N6 public : visionneuse ouverte, voile = couleur choisie, texte dessus = couleur choisie", lbStyle.bg === "rgb(16, 32, 48)" && lbStyle.fg === "rgb(254, 254, 254)", JSON.stringify(lbStyle));
  await pp.screenshot({ path: `${SHOTS}/N6-visionneuse-voile-choisi.png` });
  await pp.keyboard.press("Escape");
  await pubCtx.close();

  // Retour à l'automatique.
  await item("primaryHover").locator(".lc-nuance").click();
  await item("primaryHover").locator(".cp-foot button", { hasText: "Revenir à la couleur du thème" }).click();
  await item("scrim").locator(".lc-nuance").click();
  await item("scrim").locator(".cp-foot button", { hasText: "Revenir à l'automatique" }).click();
  await settled();
  ok("N7 « Revenir à l'automatique » : survol et voile ne sont plus choisis", await waitFor(() => { const p = sitePalette(); return p.primaryHover !== "#aa0000" && p.scrim !== "#102030"; }), JSON.stringify(sitePalette()));
  ok("N7b … les autres nuances choisies restent", sitePalette().eyebrow === "#00aa00" && sitePalette().onScrim === "#fefefe");
  ok("N7c … l'état redevient « automatique » (calculé) pour le voile", (await item("scrim").getAttribute("data-origin")) === "auto");
  ok("N7d la toile retrouve le calcul : voile de la visionneuse = gris neutre d'avant, survol = valeur du thème (le thème le fixe)", (await rootVar(f, "--t-color-viewer")) === startScrim && (await colorVar(f, "--t-color-primary-hover")) === startHover && (await item("primaryHover").getAttribute("data-origin")) === "theme", `${await rootVar(f, "--t-color-viewer")} / ${startScrim} ; ${await colorVar(f, "--t-color-primary-hover")} / ${startHover}`);
  ok("N8 publication du retour", await publish());
  const sheet2 = paletteSheet((await anon("/fr")).html);
  ok("N8b public : plus de survol ni de voile choisis, étiquettes toujours choisies", !sheet2.includes("#aa0000") && !sheet2.includes("--t-color-scrim:#102030") && sheet2.includes("--t-color-eyebrow:#00aa00"), sheet2.slice(0, 300));
  // Nettoyage complet.
  await page.getByRole("button", { name: "Revenir aux couleurs du thème" }).click();
  ok("N9 nettoyage : publication", await publish());
  ok("N9b public : plus aucune surcharge", paletteSheet((await anon("/fr")).html) === "");
  ok("N10 aucune erreur de page", errors.length === 0, errors.join(" | "));
}

await browser.close();
console.log(failures === 0 ? "\nTOUT PASSE" : `\n${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);
