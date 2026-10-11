#!/usr/bin/env node
/**
 * État de l'éditeur (lot 6), UN chromium sobre. Serveur dev requis, base NEUVE
 * (seed), une connexion.
 *
 *  A. Persistance de l'état local pendant l'enregistrement : la toile ne montre
 *     JAMAIS une valeur plus ancienne que celle qu'on vient de poser, même quand
 *     la réponse du serveur est lente et que les modifications se suivent (échantillonnage
 *     du DOM à chaque image et à chaque mutation, réponses du serveur retardées).
 *     Texte en place, espacements, typographie, réordonnancement, en-tête, conflit.
 *  B. Poignée d'espacement du bas : sur le bord extérieur, comme celle du haut
 *     (vers le contenu = réduire, vers l'extérieur = agrandir).
 *  C. Menus flottants : un clic à l'extérieur (ou Échap) les ferme, la
 *     modification faite est conservée (toile ET panneau).
 *
 * Usage : DATA_DIR=… ADMIN_EMAIL=… ADMIN_PASSWORD=… BASE=http://localhost:3101 \
 *         SHOTS=/root/shots-lot6 [ONLY=A,B,C] node scripts/e2e-state.mjs
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const DATA = process.env.DATA_DIR ?? "data";
const DB = path.join(DATA, "portfolio.db");
const SHOTS = process.env.SHOTS ?? "screenshots/state";
const ONLY = process.env.ONLY ?? "";
// Lenteur imposée au serveur : la fenêtre où une réponse en retard peut écraser l'état local.
const SAVE_DELAY = Number(process.env.SAVE_DELAY ?? 300);
const REFRESH_DELAY = Number(process.env.REFRESH_DELAY ?? 900);
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
const draftOf = (id) => JSON.parse(q("select draft from pages where id = ?", id)[0]?.draft ?? "null");
const setting = (key) => JSON.parse(q("select value from settings where key = ?", key)[0]?.value ?? "null");
const run = (k) => !ONLY || ONLY.split(",").includes(k);

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// Réponses lentes : enregistrements (server actions) et rafraîchissements de la toile (RSC).
// Le serveur répond tout de suite ; c'est la RÉPONSE qui arrive en retard (l'état qu'elle
// porte est celui du moment de la requête : une modification faite entre-temps lui manque).
let slow = false;
const refreshes = [];
// Réponse retenue : la première réponse de rafraîchissement armée est gardée jusqu'à `release()`,
// donc rendue avant les modifications suivantes (l'ordre des événements ne dépend plus du hasard).
let holdArmed = false;
let held = false;
let release = () => {};
let gate = Promise.resolve();
const arm = () => {
  holdArmed = true;
  held = false;
  gate = new Promise((r) => (release = r));
};
await ctx.route("**/*", async (route) => {
  const req = route.request();
  const h = req.headers();
  const save = slow && req.method() === "POST" && h["next-action"];
  const refresh = slow && req.method() === "GET" && h["rsc"] === "1" && !h["next-router-prefetch"];
  if (!save && !refresh) return route.continue().catch(() => {});
  if (refresh) refreshes.push(Date.now());
  try {
    const hold = refresh && holdArmed;
    if (hold) {
      holdArmed = false;
      held = true;
    }
    const response = await route.fetch();
    if (hold) await gate;
    else await sleep(save ? SAVE_DELAY : REFRESH_DELAY);
    await route.fulfill({ response });
  } catch {
    await route.abort().catch(() => {});
  }
});

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
let curPage = 2;
const revOf = (id) => q("select draft_rev from pages where id = ?", id)[0]?.draft_rev;
/** Enregistré ET rendu : la page de la toile porte la révision écrite en base. */
async function settled() {
  await page.waitForFunction(() => !/Enregistrement/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, { timeout: 120000 });
  await sleep(500);
  const rev = revOf(curPage);
  await waitFor(async () => (await f.evaluate(() => document.querySelector("[data-edit-rev]")?.getAttribute("data-edit-rev") ?? null).catch(() => null)) === String(rev), 20000);
}
const until = (f, fn, arg, timeout = 60000) =>
  f.waitForFunction(fn, arg, { timeout, polling: 100 }).then(
    () => true,
    () => false,
  );
async function waitFor(fn, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(200);
  }
  return false;
}
async function openEditor(id) {
  curPage = id;
  await page.goto(`${BASE}/admin/pages/${id}/editer`, { waitUntil: "domcontentloaded" });
  const f = await canvas();
  if (await page.getByRole("button", { name: "Abandonner les modifications" }).count()) {
    await page.getByRole("button", { name: "Abandonner les modifications" }).click();
    await Promise.all([
      page.waitForEvent("framenavigated", { predicate: (fr) => fr === page.mainFrame(), timeout: 60000 }),
      page.getByRole("dialog").getByRole("button", { name: "Abandonner les modifications" }).click(),
    ]);
    return canvas();
  }
  return f;
}

/* ---- Échantillonneur : tout ce que la toile MONTRE, image par image ----------------- */

const H1 = '[data-edit-type="collection-intro"] h1[data-inline="title"]';
const SECTION = '[data-edit-type="collection-intro"] section';
async function startSampler(f) {
  await f.evaluate(
    ([h1, section]) => {
      const log = [];
      window.__log = log;
      window.__sampling = true;
      const read = () => {
        const t = document.querySelector(h1);
        const s = document.querySelector(section);
        const cs = s ? getComputedStyle(s) : null;
        return {
          title: t?.textContent ?? null,
          padTop: cs ? Math.round(parseFloat(cs.paddingTop)) : null,
          padBottom: cs ? Math.round(parseFloat(cs.paddingBottom)) : null,
          fontSize: t ? getComputedStyle(t).fontSize : null,
          order: [...document.querySelectorAll("[data-edit-block]:not([data-edit-parent])")].map((e) => e.dataset.editBlock).join(","),
          brand: document.querySelector('[data-site-inline="name"]')?.textContent ?? null,
        };
      };
      let last = "";
      const push = () => {
        const v = read();
        const j = JSON.stringify(v);
        if (j !== last) {
          last = j;
          log.push({ t: Math.round(performance.now()), ...v });
        }
      };
      new MutationObserver(push).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
      const loop = () => {
        push();
        if (window.__sampling) requestAnimationFrame(loop);
      };
      loop();
    },
    [H1, SECTION],
  );
}
async function stopSampler(f) {
  return f.evaluate(() => {
    window.__sampling = false;
    return window.__log;
  });
}
/** Valeurs successives d'un champ (doublons consécutifs retirés). */
const series = (log, key) => log.map((e) => e[key]).filter((v, i, a) => i === 0 || v !== a[i - 1]);
/** Une valeur déjà quittée qui revient = retour en arrière visible. */
function revisited(values) {
  const seen = new Set();
  for (const v of values) {
    if (seen.has(v)) return v;
    seen.add(v);
  }
  return null;
}
const noRollback = (label, log, key, expectedLast, only) => {
  // `only` : valeurs de référence (les états intermédiaires d'une frappe ne comptent pas).
  const s = series(log, key).filter((v) => !only || only.includes(v));
  const back = revisited(s);
  ok(`${label} : jamais d'ancienne valeur ré-affichée`, back === null, `suite observée : ${JSON.stringify(s)}`);
  if (expectedLast !== undefined) ok(`${label} : valeur finale`, s.at(-1) === expectedLast, `suite observée : ${JSON.stringify(s)}`);
};
/** Attend qu'un rafraîchissement de la toile soit parti et retenu (sa réponse, ancienne, arrivera après la modification suivante). */
const refreshHeld = () => waitFor(() => held, 20000);
/** La modification suivante est faite et enregistrée : la réponse ancienne peut arriver. */
async function releaseStale() {
  await sleep(SAVE_DELAY * 3 + 800);
  release();
}

let f;
/** Clic dans le pied de page : ferme la barre de style du texte (qui recouvre le titre). */
async function closeBar() {
  const footer = f.locator('[data-edit-global="footer"]').first();
  await footer.scrollIntoViewIfNeeded();
  await footer.click({ position: { x: 6, y: 6 }, force: true });
  await sleep(300);
  // Repli (code d'avant le lot 6, où seule la croix la ferme).
  if (await f.locator(".lk-close").count()) await f.locator(".lk-close").click();
}

/** Ouvre la barre de style du titre (« Aa » au survol) ; recommence si la page se re-rend sous la souris. */
async function openTextBar() {
  for (let attempt = 0; attempt < 4; attempt++) {
    await f.locator(H1).scrollIntoViewIfNeeded();
    await page.mouse.move(5, 5);
    await sleep(150);
    await f.locator(H1).hover();
    if (!(await until(f, () => Boolean(document.querySelector(".lk-aa")), null, 15000))) continue;
    if (await f.locator(".lk-aa").click({ timeout: 4000 }).then(() => true, () => false)) return until(f, () => Boolean(document.querySelector(".lk-bar")), null, 15000);
  }
  return false;
}

/* ---- A. Persistance de l'état local ---------------------------------------------------- */

if (run("A")) {
  f = await openEditor(2);
  await sleep(1500);
  slow = true;

  /* A1. Texte en place, deux modifications qui se suivent pendant que la réponse est en retard. */
  const original = await f.locator(H1).textContent();
  await startSampler(f);
  arm();
  await f.locator(H1).dblclick();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Alpha");
  await page.keyboard.press("Enter");
  ok("A1 première modification : un rafraîchissement lent est en vol", await refreshHeld());
  await f.locator(H1).dblclick();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Beta");
  await page.keyboard.press("Enter");
  await releaseStale();
  await settled();
  await sleep(2500);
  let log = await stopSampler(f);
  noRollback("A1 texte en place (deux modifications rapprochées)", log, "title", "Beta", [original, "Alpha", "Beta"]);
  ok("A1 brouillon : « Beta »", draftOf(2)?.blocks?.[0]?.props?.title?.fr === "Beta", JSON.stringify(draftOf(2)?.blocks?.[0]?.props?.title));

  /* A2. Espacement du haut tiré à la souris, puis une seconde fois, réponse en retard. */
  await f.locator(H1).click();
  await until(f, () => document.querySelectorAll(".lk-space-handle").length === 2);
  await startSampler(f);
  const drag = async (side, dy) => {
    const hb = await f.locator(`.lk-space-handle[data-side="${side}"]`).boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + dy / 2, { steps: 4 });
    await page.mouse.move(hb.x + hb.width / 2, hb.y + dy, { steps: 6 });
    await sleep(150);
    await page.mouse.up();
  };
  arm();
  await drag("top", 60);
  ok("A2 espacement : un rafraîchissement lent est en vol", await refreshHeld());
  await drag("top", 140);
  await releaseStale();
  await settled();
  await sleep(2500);
  log = await stopSampler(f);
  noRollback("A2 espacement du haut (deux tirages rapprochés)", log, "padTop");
  const spaceTop = draftOf(2)?.blocks?.[0]?.props?.look?.spaceTop;
  ok("A2 brouillon : espace haut enregistré", Boolean(spaceTop), String(spaceTop));
  const padFinal = series(log, "padTop").at(-1);
  const stored = await f.evaluate((s) => parseFloat(getComputedStyle(document.querySelector(s)).paddingTop), SECTION);
  ok("A2 rendu final = valeur enregistrée", Math.abs(stored - padFinal) < 1);

  /* A3. Typographie de CE texte : deux tailles de suite. */
  ok("A3 « Aa » au survol du titre, barre de style ouverte", await openTextBar());
  await startSampler(f);
  arm();
  await f.locator(".lk-bar select").first().selectOption("4xl");
  ok("A3 typographie : un rafraîchissement lent est en vol", await refreshHeld());
  await f.locator(".lk-bar select").first().selectOption("2xl");
  await releaseStale();
  await settled();
  await sleep(2500);
  log = await stopSampler(f);
  noRollback("A3 taille du texte (deux choix rapprochés)", log, "fontSize");
  ok("A3 brouillon : taille « 2xl »", draftOf(2)?.blocks?.[0]?.props?.look?.text?.title?.size === "2xl", JSON.stringify(draftOf(2)?.blocks?.[0]?.props?.look));
  await page.screenshot({ path: `${SHOTS}/A3-typographie.png` });

  /* A4. Réordonnancement : monter le même bloc deux fois de suite. */
  await f.locator('[data-edit-type="project-board"]').nth(2).locator("h2, h3, [data-inline]").first().click({ force: true });
  await until(f, () => Boolean(document.querySelector(".pe-tools")));
  const orderBefore = await f.evaluate(() => [...document.querySelectorAll("[data-edit-block]:not([data-edit-parent])")].map((e) => e.dataset.editBlock));
  await startSampler(f);
  arm();
  await f.locator(".pe-tools").getByRole("button", { name: "Monter" }).click();
  ok("A4 ordre : un rafraîchissement lent est en vol", await refreshHeld());
  await f.locator(".pe-tools").getByRole("button", { name: "Monter" }).click();
  await releaseStale();
  await settled();
  await sleep(2500);
  log = await stopSampler(f);
  noRollback("A4 ordre des blocs (monté deux fois)", log, "order");
  const expectedOrder = [orderBefore[0], orderBefore[3], orderBefore[1], orderBefore[2], ...orderBefore.slice(4)].join(",");
  ok("A4 ordre final : le bloc est monté de deux rangs", series(log, "order").at(-1) === expectedOrder, `${series(log, "order").at(-1)} / ${expectedOrder}`);
  ok("A4 brouillon : même ordre", draftOf(2)?.blocks?.map((b) => b.uid).join(",") === expectedOrder, draftOf(2)?.blocks?.map((b) => b.uid).join(","));

  /* A5. En-tête (brouillon du site) : le nom du site, deux modifications de suite. */
  await closeBar();
  await f.locator('[data-site-inline="name"]').first().scrollIntoViewIfNeeded();
  const brandBefore = await f.locator('[data-site-inline="name"]').first().textContent();
  await startSampler(f);
  arm();
  await f.locator('[data-site-inline="name"]').first().dblclick();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Nom Un");
  await page.keyboard.press("Enter");
  ok("A5 en-tête : un rafraîchissement lent est en vol", await refreshHeld());
  await f.locator('[data-site-inline="name"]').first().dblclick();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Nom Deux");
  await page.keyboard.press("Enter");
  await releaseStale();
  await settled();
  await sleep(2500);
  log = await stopSampler(f);
  noRollback("A5 nom du site (en-tête, deux modifications)", log, "brand", "Nom Deux", [brandBefore, "Nom Un", "Nom Deux"]);
  ok("A5 brouillon du site : « Nom Deux »", JSON.stringify(setting("siteDraft")?.snap ?? {}).includes("Nom Deux"));

  /* A6. Conflit de version : la modification locale reste affichée. */
  q("select 1");
  {
    const db = new Database(DB);
    db.prepare("update pages set draft_rev = draft_rev + 5 where id = 2").run();
    db.close();
  }
  await closeBar();
  await startSampler(f);
  await f.locator(H1).dblclick();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("Gamma");
  await page.keyboard.press("Enter");
  await waitFor(async () => /ailleurs/i.test((await page.locator("body").textContent()) ?? ""), 20000);
  await sleep(2500);
  log = await stopSampler(f);
  ok("A6 conflit : l'éditeur signale « Modifié ailleurs »", /ailleurs/i.test((await page.locator("body").textContent()) ?? ""));
  noRollback("A6 conflit de version (texte local conservé)", log, "title", "Gamma");
  slow = false;
}

/* ---- B. Poignée d'espacement du bas ------------------------------------------------------ */

if (run("B")) {
  f = await openEditor(2);
  await sleep(1500);
  slow = false;
  await f.locator(H1).click();
  await until(f, () => document.querySelectorAll(".lk-space-handle").length === 2);
  const geom = () =>
    f.evaluate(() => {
      const r = (el) => {
        const b = el.getBoundingClientRect();
        return { top: b.top, bottom: b.bottom, cy: b.top + b.height / 2 };
      };
      const zone = (s) => document.querySelector(`.lk-space-zone[data-side="${s}"]`);
      const handle = (s) => document.querySelector(`.lk-space-handle[data-side="${s}"]`);
      return { zt: r(zone("top")), zb: r(zone("bottom")), ht: r(handle("top")), hb: r(handle("bottom")) };
    });
  const g0 = await geom();
  ok("B1 haut : la poignée suit le bord de la zone côté contenu", Math.abs(g0.ht.cy - g0.zt.bottom) <= 6, JSON.stringify(g0));
  ok("B2 bas : la poignée est sur le bord extérieur (bas) de la zone hachurée", Math.abs(g0.hb.cy - g0.zb.bottom) <= 6, JSON.stringify(g0));
  await page.screenshot({ path: `${SHOTS}/B-bas-repos.png` });
  const padBottom = () => f.evaluate((sel) => Math.round(parseFloat(getComputedStyle(document.querySelector(sel)).paddingBottom)), SECTION);
  const p0 = await padBottom();
  const hb = await f.locator('.lk-space-handle[data-side="bottom"]').boundingBox();
  const cx = hb.x + hb.width / 2;
  const cy = hb.y + hb.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy + 30, { steps: 5 });
  await page.mouse.move(cx, cy + 90, { steps: 8 });
  await sleep(300);
  const gDown = await geom();
  const label = await f.locator('.lk-space-zone[data-side="bottom"] .lk-space-value').textContent().catch(() => "");
  await page.screenshot({ path: `${SHOTS}/B-bas-tire-vers-le-bas.png` });
  ok("B3 tirer vers l'extérieur (bas) : l'espace grandit et la poignée suit vers le bas", (await padBottom()) > p0 && gDown.hb.cy > g0.hb.cy + 5, `${p0} → ${await padBottom()}, poignée ${Math.round(g0.hb.cy)} → ${Math.round(gDown.hb.cy)} (${label})`);
  await page.mouse.move(cx, cy - 400, { steps: 14 });
  await sleep(300);
  const gUp = await geom();
  await page.screenshot({ path: `${SHOTS}/B-bas-tire-vers-le-contenu.png` });
  ok("B4 tirer vers le contenu (haut) : l'espace se réduit jusqu'à « Aucun »", (await padBottom()) === 0 && gUp.hb.cy < gDown.hb.cy, `${await padBottom()} (${await f.locator('.lk-space-zone[data-side="bottom"] .lk-space-value').textContent().catch(() => "")})`);
  await page.mouse.up();
  await settled();
  ok("B5 enregistré : espace du bas « Aucun »", await waitFor(() => draftOf(2)?.blocks?.[0]?.props?.look?.spaceBottom === "none"), JSON.stringify(draftOf(2)?.blocks?.[0]?.props?.look));
  // Vers l'extérieur jusqu'à la borne haute (XL) : même borne que la poignée du haut.
  await f.locator(H1).click();
  await until(f, () => document.querySelectorAll(".lk-space-handle").length === 2);
  const hb2 = await f.locator('.lk-space-handle[data-side="bottom"]').boundingBox();
  await page.mouse.move(hb2.x + hb2.width / 2, hb2.y + hb2.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb2.x + hb2.width / 2, hb2.y + 600, { steps: 14 });
  await sleep(300);
  const label2 = await f.locator('.lk-space-zone[data-side="bottom"] .lk-space-value').textContent().catch(() => "");
  await page.mouse.up();
  await settled();
  ok("B6 tirer très loin vers le bas : borne « XL »", /XL/.test(label2 ?? "") && (await waitFor(() => draftOf(2)?.blocks?.[0]?.props?.look?.spaceBottom === "xl")), `${label2} / ${JSON.stringify(draftOf(2)?.blocks?.[0]?.props?.look)}`);
  const xl = await f.evaluate(() => {
    const p = document.createElement("div");
    p.style.paddingTop = "var(--t-space-xl)";
    document.body.appendChild(p);
    const v = parseFloat(getComputedStyle(p).paddingTop);
    p.remove();
    return v;
  });
  ok("B7 rendu : espace du bas = cran XL du thème", Math.abs((await padBottom()) - xl) < 1, `${await padBottom()} / ${xl}`);
}

/* ---- C. Menus flottants : clic à l'extérieur, Échap, autre cadre ------------------------------- */

if (run("C")) {
  f = await openEditor(2);
  await sleep(1500);
  slow = false;
  const exists = (sel) => f.evaluate((x) => Boolean(document.querySelector(x)), sel);
  const gone = (sel) => until(f, (x) => !document.querySelector(x), sel, 8000);
  const shown = (sel) => until(f, (x) => Boolean(document.querySelector(x)), sel, 15000);
  /** Clic « ailleurs » dans la toile : le pied de page (rien d'ouvert ne s'y trouve). */
  const clickElsewhere = async () => {
    const footer = f.locator('[data-edit-global="footer"]').first();
    await footer.scrollIntoViewIfNeeded();
    await footer.click({ position: { x: 6, y: 6 }, force: true });
  };
  const openBar = openTextBar;

  /* C1. Barre de style du texte : clic ailleurs = fermée, réglage conservé. */
  ok("C1 barre de style ouverte", await openBar());
  await f.locator(".lk-bar select").first().selectOption("3xl");
  await clickElsewhere();
  ok("C1 clic ailleurs dans la toile : la barre se ferme", await gone(".lk-bar"));
  await settled();
  ok("C1 le réglage fait avant la fermeture est conservé (taille 3xl)", await waitFor(() => draftOf(2)?.blocks?.[0]?.props?.look?.text?.title?.size === "3xl"), JSON.stringify(draftOf(2)?.blocks?.[0]?.props?.look));

  /* C2. Menu des polices : fermé sans fermer la barre, puis Échap, puis clic ailleurs. */
  ok("C2 barre rouverte", await openBar());
  await f.locator(".lk-bar .tc-font").click();
  ok("C2 menu des polices ouvert", await shown(".fm"));
  await f.locator(".lk-bar-head").click({ position: { x: 4, y: 4 }, force: true });
  ok("C2 clic dans la barre, hors du menu : le menu des polices se ferme, la barre reste", (await gone(".fm")) && (await exists(".lk-bar")));
  await f.locator(".lk-bar .tc-font").click();
  await shown(".fm");
  await page.keyboard.press("Escape");
  ok("C2 Échap ferme le menu des polices (la barre reste)", (await gone(".fm")) && (await exists(".lk-bar")));
  await f.locator(".lk-bar .tc-font").click();
  await shown(".fm");
  await clickElsewhere();
  ok("C2 clic ailleurs : menu des polices ET barre fermés", (await gone(".fm")) && (await gone(".lk-bar")));
  // Le bouton « Police » rouvre / referme le menu (un clic dessus n'est pas « à l'extérieur »).
  ok("C2 barre rouverte (bis)", await openBar());
  await f.locator(".lk-bar .tc-font").click();
  await shown(".fm");
  await f.locator(".lk-bar .tc-font").click();
  ok("C2 le bouton « Police » referme son menu (sans le rouvrir)", await gone(".fm"));

  /* C3. Clic dans le panneau (autre cadre) : la barre de la toile se ferme. */
  await page.getByRole("tab", { name: "Réglages" }).click();
  ok("C3 clic dans le panneau : la barre de la toile se ferme", await gone(".lk-bar"));

  /* C4. Saisie d'un texte : la barre reste ouverte quand on clique dans le texte. */
  await f.locator(H1).scrollIntoViewIfNeeded();
  await f.locator(H1).dblclick();
  ok("C4 saisie : la barre s'ouvre toute seule", await shown(".lk-bar"));
  const hbox = await f.locator(H1).boundingBox();
  const fbox = await (await page.waitForSelector("iframe.ve-frame")).boundingBox();
  await page.mouse.click(fbox.x + hbox.x + 12, fbox.y + hbox.y + hbox.height / 2);
  await sleep(300);
  ok("C4 clic dans le texte en cours de saisie : la barre reste", await exists(".lk-bar"));
  await page.keyboard.press("Escape");
  await clickElsewhere();
  await gone(".lk-bar");

  /* C5. En-tête : « + Ajouter un lien » (page du site / lien libre), fermé de partout. */
  await f.locator('[data-edit-global="header"]').first().scrollIntoViewIfNeeded();
  await f.locator('[data-edit-global="header"]').first().click({ position: { x: 6, y: 6 }, force: true });
  ok("C5 en-tête choisi : « + Ajouter un lien »", await shown('[data-testid="nav-add"]'));
  await f.locator('[data-testid="nav-add"]').click();
  ok("C5 fenêtre d'ajout de lien ouverte", await shown(".pe-popover"));
  await f.locator(".pe-popover input[type=search]").fill("Déc");
  await clickElsewhere();
  ok("C5 clic ailleurs dans la toile : la fenêtre se ferme", await gone(".pe-popover"));
  await f.locator('[data-edit-global="header"]').first().click({ position: { x: 6, y: 6 }, force: true });
  await f.locator('[data-testid="nav-add"]').click();
  await shown(".pe-popover");
  await page.getByRole("tab", { name: "Ajouter" }).click();
  ok("C5 clic dans le panneau : la fenêtre de la toile se ferme", await gone(".pe-popover"));
  await f.locator('[data-edit-global="header"]').first().click({ position: { x: 6, y: 6 }, force: true });
  await f.locator('[data-testid="nav-add"]').click();
  await shown(".pe-popover");
  await f.locator(".pe-popover input[type=search]").focus();
  await page.keyboard.press("Escape");
  ok("C5 Échap ferme la fenêtre", await gone(".pe-popover"));

  /* C6. Réseaux : « + Réseau » (menu des réseaux). */
  const hasSocial = await f.locator('[data-testid="social-add"]').count();
  if (hasSocial) {
    await f.locator('[data-testid="social-add"]').first().scrollIntoViewIfNeeded();
    await f.locator('[data-testid="social-add"]').first().click();
    ok("C6 menu des réseaux ouvert", await shown(".pe-popover"));
    await clickElsewhere();
    ok("C6 clic ailleurs : le menu des réseaux se ferme", await gone(".pe-popover"));
  }

  /* C7. Page d'accueil : choix du projet mis en avant, agencement d'une grille, champs du formulaire. */
  f = await openEditor(1);
  await sleep(1500);
  const featured = '[data-edit-type="featured-project"]';
  if (await f.locator(featured).count()) {
    await f.locator(featured).first().scrollIntoViewIfNeeded();
    await f.locator(`${featured} h2, ${featured} h3, ${featured} [data-inline]`).first().click({ force: true });
    // Le clic choisit le composant le plus profond : remonter au conteneur par le fil d'Ariane.
    const crumb = f.locator(".pe-crumbs .pe-crumb", { hasText: "Projet mis en avant" });
    if (await crumb.count()) await crumb.first().click();
    await f.locator(".pe-tools").getByRole("button", { name: "Changer de projet" }).click();
    ok("C7 choix du projet ouvert", await shown(".pe-container-picker input"));
    await f.locator(".pe-container-picker input").fill("a");
    ok("C7 liste des projets affichée", await shown(".pe-combo-list"));
    await clickElsewhere();
    ok("C7 clic ailleurs : liste ET choix de projet fermés", (await gone(".pe-combo-list")) && (await gone(".pe-container-picker")));
  }
  await page.getByRole("tab", { name: "Ajouter" }).click();
  const gridCard = page.locator('.ve-card[data-type="grid"]').first();
  if (await gridCard.count()) {
    await gridCard.scrollIntoViewIfNeeded();
    await gridCard.click();
    await shown('[data-edit-type="grid"]');
    await f.locator('.pe-tools').getByRole("button", { name: "Agencement" }).click();
    ok("C7 agencement de la grille ouvert", await shown(".pe-layouts"));
    await f.locator(".pe-layouts [role=radio]").nth(2).click();
    await clickElsewhere();
    ok("C7 clic ailleurs : l'agencement se ferme", await gone(".pe-layouts"));
    await settled();
    ok("C7 le choix d'agencement fait avant la fermeture est conservé", await waitFor(() => JSON.stringify(draftOf(1)).includes('"layout":"2"')), "");
  }
  if (await f.locator('[data-testid="field-add"]').count()) {
    await f.locator('[data-testid="field-add"]').first().scrollIntoViewIfNeeded();
    await f.locator('[data-testid="field-add"]').first().click();
    ok("C7 menu « Ajouter un champ » ouvert", await shown(".pe-popover"));
    await clickElsewhere();
    ok("C7 clic ailleurs : le menu des champs se ferme", await gone(".pe-popover"));
  }

  /* C8. Image de fond : fenêtre de choix, fermée d'un clic sur le fond. */
  const bg = '[data-edit-media="backgroundMediaId"]';
  if (await f.locator(bg).count()) {
    await f.locator(bg).first().scrollIntoViewIfNeeded();
    await f.locator(bg).first().hover();
    const tool = f.locator(".pe-media-tools button").first();
    if (await tool.count()) {
      await tool.click();
      ok("C8 choix d'une image ouvert", await waitFor(async () => (await page.locator("dialog.ve-picker[open]").count()) === 1, 15000));
      await sleep(300);
      await page.mouse.click(8, 8);
      ok("C8 clic sur le fond : la fenêtre se ferme", await waitFor(async () => (await page.locator("dialog.ve-picker[open]").count()) === 0, 5000));
    }
  }

  /* C9. Panneau : styles du site (menu des polices du panneau). */
  await page.getByRole("tab", { name: "Réglages" }).click();
  // Rien de choisi : le panneau montre les styles du site.
  await f.locator("html").press("Escape").catch(() => {});
  await f.locator("html").press("Escape").catch(() => {});
  const role = page.locator(".lp-role").first();
  ok("C9 panneau : « Styles du site » affichés", await waitFor(async () => (await page.locator(".lp-role").count()) > 0, 10000));
  if (await role.count()) {
    await role.scrollIntoViewIfNeeded();
    await role.click();
    await page.locator(".lp-role-body select").first().selectOption("2xl");
    await page.locator(".lp-role-body .tc-font").click();
    ok("C9 panneau : menu des polices ouvert", await page.locator(".fm").count().then((n) => n === 1));
    await page.locator("h2, h3").first().click({ force: true });
    ok("C9 panneau : clic ailleurs, le menu des polices se ferme", await waitFor(async () => (await page.locator(".fm").count()) === 0, 5000));
    await settled();
    ok("C9 panneau : le réglage fait avant la fermeture est conservé", await waitFor(() => JSON.stringify(setting("siteDraft") ?? {}).includes('"size":"2xl"')), "");
    await page.locator(".lp-role-body .tc-font").click();
    await page.locator(".fm").waitFor({ timeout: 5000 });
    await f.locator("body").click({ position: { x: 2, y: 2 }, force: true });
    ok("C9 panneau : clic dans la toile, le menu des polices se ferme", await waitFor(async () => (await page.locator(".fm").count()) === 0, 5000));
  }

  /* C10. Admin en largeur de téléphone : menu repliable. */
  const mobile = await ctx.newPage();
  await mobile.setViewportSize({ width: 390, height: 800 });
  await mobile.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
  await mobile.getByRole("button", { name: "Menu" }).click();
  ok("C10 menu mobile ouvert", (await mobile.locator("#a-sidebar").getAttribute("data-open")) === "true");
  await mobile.locator("#contenu").click({ position: { x: 10, y: 400 }, force: true });
  ok("C10 clic à l'extérieur : le menu mobile se ferme", await waitFor(async () => (await mobile.locator("#a-sidebar").getAttribute("data-open")) === "false", 5000));
  await mobile.close();
}

console.log(errors.length ? `Erreurs de page : ${errors.slice(0, 5).join(" | ")}` : "Aucune erreur de page");
await browser.close();
console.log(failures ? `${failures} échec(s)` : "Tout est vert");
process.exit(failures ? 1 : 0);
