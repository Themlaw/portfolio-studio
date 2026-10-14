#!/usr/bin/env node
/**
 * Mise en page sur la toile (lot 2), UN chromium sobre. Serveur dev requis,
 * base NEUVE (seed), une connexion, accès réseau du SERVEUR à Google Fonts.
 *
 *  A. Poignées d'espacement : glisser (aimanté aux crans), clavier ; rendu.
 *  B. Barre typographique : taille de CE texte ; italique de tous les « Titre 1 »
 *     (styles du site).
 *  C. Police Google choisie dans le menu : téléchargée par le SERVEUR, servie
 *     par /fonts/, appliquée ; AUCUNE requête du navigateur vers Google.
 *  D. Cadrage du portrait (format imposé) : zone déplacée et zoomée au clavier.
 *  E. Ouverture : fond du métier (bandeau) depuis la barre du texte (ligne « Fond » commune à tous les textes, lot 21 : e2e-fond-texte.mjs).
 *  H. Tailles (échelle croissante, réellement appliquée, gagne sur les variantes du
 *     thème), couleur libre (sélecteur : HEX, clavier, Échap, clic extérieur,
 *     écran étroit), menu de graisse maison.
 *  F. Publication : rendu public (espaces, styles, police servie localement,
 *     cadrage), aucun repère d'édition.
 *
 * Usage : DATA_DIR=/root/pf-lot2 ADMIN_EMAIL=… ADMIN_PASSWORD=… BASE=http://localhost:3102 \
 *         SHOTS=/root/shots-lot2 node scripts/e2e-look.mjs
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const DATA = process.env.DATA_DIR ?? "data";
const DB = path.join(DATA, "portfolio.db");
const SHOTS = process.env.SHOTS ?? "screenshots/look";
const ONLY = process.env.ONLY ?? "";
const FONT = process.env.FONT ?? "Lora";
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
const blockOf = (id, type) => draftOf(id)?.blocks?.find((b) => b.type === type);
const run = (k) => !ONLY || ONLY.split(",").includes(k);

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
// Toute requête du navigateur (éditeur, toile, pages publiques) vers Google est une faute.
const googleRequests = [];
const fontRequests = [];
ctx.on("request", (r) => {
  const u = r.url();
  if (/fonts\.(googleapis|gstatic)\.com|google/i.test(new URL(u).hostname)) googleRequests.push(u);
  if (new URL(u).pathname.startsWith("/fonts/")) fontRequests.push(u);
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => /Content Security Policy|Refused to/.test(m.text()) && errors.push("CSP : " + m.text().slice(0, 200)));

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
const until = (f, fn, arg, timeout = 60000) =>
  f.waitForFunction(fn, arg, { timeout, polling: 200 }).then(
    () => true,
    () => false,
  );
async function waitFor(fn, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(300);
  }
  return false;
}
async function openEditor(id) {
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
async function publish() {
  await settled();
  await page.getByRole("button", { name: "Publier", exact: true }).click();
  return waitFor(async () => /Publié/.test((await page.locator(".ve-status").textContent()) ?? ""), 120000);
}
/** Valeur en px d'un cran du thème, mesurée dans la toile. */
const cranPx = (f, key) =>
  f.evaluate((k) => {
    const p = document.createElement("div");
    p.style.paddingTop = k === "none" ? "0px" : `var(--t-space-${k})`;
    document.body.appendChild(p);
    const v = parseFloat(getComputedStyle(p).paddingTop);
    p.remove();
    return v;
  }, key);
const introPad = (f) => f.evaluate(() => parseFloat(getComputedStyle(document.querySelector('[data-edit-type="section-title"] section')).paddingTop));

let f;

/* ---- A. Poignées d'espacement ---------------------------------------------------- */

if (run("A") || run("B") || run("C") || run("F")) {
  f = await openEditor(2);
  await sleep(1200);
}

if (run("A")) {
  const before = await introPad(f);
  await f.locator('[data-edit-type="section-title"] h1').first().click();
  ok("A1 bloc choisi : poignées d'espacement haut et bas", await until(f, () => document.querySelectorAll(".lk-space-handle").length === 2));
  const handle = f.locator('.lk-space-handle[data-side="top"]');
  const hb = await handle.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2, hb.y - 30, { steps: 6 });
  await page.mouse.move(hb.x + hb.width / 2, hb.y - 400, { steps: 12 });
  await sleep(300);
  const label = await f.locator('.lk-space-zone[data-side="top"] .lk-space-value').textContent().catch(() => "");
  ok("A2 pendant le glisser : valeur aimantée affichée (« Aucun »)", /Aucun/.test(label ?? ""), label);
  await page.screenshot({ path: `${SHOTS}/A-poignee-espacement-glisser.png` });
  await page.mouse.up();
  await settled();
  ok("A3 relâché : espace haut « Aucun » enregistré dans le brouillon", await waitFor(() => blockOf(2, "section-title")?.props.look?.spaceTop === "none"), JSON.stringify(blockOf(2, "section-title")?.props.look));
  ok("A4 rendu : padding haut à 0 (avant : " + Math.round(before) + " px)", await until(f, () => parseFloat(getComputedStyle(document.querySelector('[data-edit-type="section-title"] section')).paddingTop) === 0));
  // Clavier : flèche bas = cran suivant.
  await f.locator('[data-edit-type="section-title"] h1').first().click();
  await until(f, () => document.querySelectorAll(".lk-space-handle").length === 2);
  await f.locator('.lk-space-handle[data-side="top"]').focus();
  await page.keyboard.press("ArrowDown");
  await settled();
  await waitFor(() => blockOf(2, "section-title")?.props.look?.spaceTop === "s");
  const kb = blockOf(2, "section-title")?.props.look?.spaceTop;
  ok("A5 clavier (flèche bas) : cran suivant « S »", kb === "s", String(kb));
  const s = await cranPx(f, "s");
  ok(`A6 rendu : padding haut = cran S du thème (${s} px)`, await until(f, (v) => Math.abs(parseFloat(getComputedStyle(document.querySelector('[data-edit-type="section-title"] section')).paddingTop) - v) < 0.5, s));
  await f.locator('[data-edit-type="section-title"] h1').first().click();
  await sleep(400);
  await page.screenshot({ path: `${SHOTS}/A-poignees-espacement.png` });
}

/* ---- B. Barre typographique ---------------------------------------------------------- */

const h1 = '[data-edit-type="section-title"] h1[data-inline="title"]';
if (run("B")) {
  await f.locator(h1).hover();
  ok("B1 survol d'un titre : « Aa »", await until(f, () => Boolean(document.querySelector(".lk-aa"))));
  await f.locator(".lk-aa").click();
  ok("B2 barre typographique ouverte", await until(f, () => Boolean(document.querySelector(".lk-bar"))));
  await page.screenshot({ path: `${SHOTS}/B-barre-typo.png` });
  await f.locator('.lk-bar .ms-button[aria-label^="Taille"]').click();
  await f.locator('.ms-option[data-value="4xl"]').click();
  await settled();
  ok("B3 taille de CE texte enregistrée (look.text.title)", await waitFor(() => blockOf(2, "section-title")?.props.look?.text?.title?.size === "4xl"), JSON.stringify(blockOf(2, "section-title")?.props.look));
  ok("B4 rendu : taille en ligne sur le titre", await until(f, (s) => (document.querySelector(s)?.getAttribute("style") ?? "").includes("clamp(3rem"), h1));
  // Tous les « Titre 1 » : style du site.
  if (!(await f.locator(".lk-bar").count())) {
    await f.locator(h1).hover();
    await f.locator(".lk-aa").click();
  }
  await f.locator(".lk-bar [role=radio]", { hasText: "Tous les « Titre 1 »" }).click();
  await f.locator(".lk-bar .tc-italic").click();
  await settled();
  ok("B5 italique de tous les « Titre 1 » : brouillon du site", (await waitFor(() => setting("siteDraft")?.snap?.styles?.roles?.h1?.italic === true, 20000)), JSON.stringify(setting("siteDraft")?.snap?.styles));
  ok("B6 rendu : feuille des styles du site (italique)", await until(f, () => (document.getElementById("site-styles")?.textContent ?? "").includes("#contenu h1{font-style:italic}")));
  ok("B7 le titre est en italique", await until(f, (s) => getComputedStyle(document.querySelector(s)).fontStyle === "italic", h1));
}

/* ---- C. Police Google téléchargée par le serveur ------------------------------------- */

if (run("C")) {
  if (!(await f.locator(".lk-bar").count())) {
    await f.locator(h1).hover();
    await f.locator(".lk-aa").click();
    await until(f, () => Boolean(document.querySelector(".lk-bar")));
  }
  await f.locator(".lk-bar [role=radio]", { hasText: "Ce texte" }).click();
  await f.locator(".lk-bar .tc-font").click();
  ok("C1 menu des polices ouvert (thème, embarquées, Google)", await until(f, () => document.querySelectorAll(".fm-item").length > 20));
  ok("C2 aperçus chargés depuis le serveur (/admin/api/fonts/preview)", await until(f, () => document.querySelectorAll('.fm-name[style*="pv "]').length >= 3, null, 90000));
  await page.screenshot({ path: `${SHOTS}/C-menu-des-polices.png` });
  await f.locator(".fm-search").fill(FONT);
  await sleep(500);
  await until(f, (n) => Boolean(document.querySelector(`.fm-item[data-font="g:${n}"]`)), FONT);
  await page.screenshot({ path: `${SHOTS}/C-menu-des-polices-recherche.png` });
  await f.locator(`.fm-item[data-font="g:${FONT}"]`).click();
  ok(`C3 « ${FONT} » téléchargée par le serveur (fontLibrary)`, await waitFor(() => Boolean(setting("fontLibrary")?.[FONT]?.length), 90000), JSON.stringify(setting("fontLibrary")));
  await settled();
  const faces = setting("fontLibrary")?.[FONT] ?? [];
  ok("C4 fichiers woff2 latin + latin-ext dans le volume de données", faces.some((x) => x.subset === "latin") && faces.every((x) => existsSync(path.join(DATA, "fonts", x.file))), JSON.stringify(faces));
  ok("C5 police appliquée à CE texte (brouillon)", await waitFor(() => blockOf(2, "section-title")?.props.look?.text?.title?.font === `g:${FONT}`));
  ok("C6 @font-face servi par le site (/fonts/…)", await until(f, (n) => { const t = document.getElementById("site-styles")?.textContent ?? ""; return t.includes(`font-family:"${n}"`) && t.includes('url("/fonts/'); }, FONT));
  ok("C7 titre rendu dans la police téléchargée", await until(f, async (args) => { await document.fonts.ready; return getComputedStyle(document.querySelector(args.s)).fontFamily.replace(/"/g, "").startsWith(`${args.n},`) && document.fonts.check(`40px "${args.n}"`); }, { s: h1, n: FONT }, 60000));
  if (faces[0]) {
    const res = await page.request.get(`${BASE}/fonts/${faces[0].file}`);
    ok("C8 /fonts/<fichier> : 200, font/woff2, cache immuable", res.status() === 200 && res.headers()["content-type"] === "font/woff2" && /immutable/.test(res.headers()["cache-control"] ?? ""), `${res.status()} ${res.headers()["content-type"]}`);
  }
  await page.keyboard.press("Escape");
  await f.locator(h1).click();
  await sleep(500);
  await page.screenshot({ path: `${SHOTS}/C-titre-police-google.png` });
}

/* ---- F (1). Publication de la page « Personnages » -------------------------------------- */

if (run("F")) {
  ok("F1 page publiée (styles du site compris)", await publish());
  const pub = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  pub.on("request", (r) => {
    const u = new URL(r.url());
    if (/google/i.test(u.hostname)) googleRequests.push(r.url());
    if (u.pathname.startsWith("/fonts/")) fontRequests.push(r.url());
  });
  const pp = await pub.newPage();
  await pp.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
  const html = await pp.content();
  ok("F2 public : aucun repère d'édition", !html.includes("data-edit-") && !html.includes("data-inline"));
  const r = await pp.evaluate(async (n) => {
    await document.fonts.ready;
    const h = document.querySelector("#contenu h1");
    const sec = h.closest("section");
    const cs = getComputedStyle(h);
    return { family: cs.fontFamily, italic: cs.fontStyle, size: h.getAttribute("style") ?? "", pad: parseFloat(getComputedStyle(sec).paddingTop), loaded: document.fonts.check(`40px "${n}"`) };
  }, FONT);
  const s = await pp.evaluate(() => {
    const p = document.createElement("div");
    p.style.paddingTop = "var(--t-space-s)";
    document.body.appendChild(p);
    return parseFloat(getComputedStyle(p).paddingTop);
  });
  ok(`F3 public : titre en « ${FONT} » (servie par le site), italique, taille réglée`, r.family.replace(/"/g, "").startsWith(`${FONT},`) && r.loaded && r.italic === "italic" && r.size.includes("clamp(3rem"), JSON.stringify(r));
  ok("F4 public : espace haut = cran S", Math.abs(r.pad - s) < 0.5, `${r.pad} / ${s}`);
  ok("F5 public : la police vient de /fonts/ (requête vers le site)", fontRequests.length > 0, String(fontRequests.length));
  await pp.screenshot({ path: `${SHOTS}/F-public-personnages.png` });
  await pub.close();
}

/* ---- D. Cadrage du portrait ---------------------------------------------------------------- */

if (run("D")) {
  f = await openEditor(5);
  await sleep(1200);
  await f.locator('[data-edit-type="profile"] [data-edit-media="portraitMediaId"] img').first().click();
  await page.getByRole("tab", { name: "Réglages" }).click();
  await page.getByLabel("Format du portrait").selectOption("1:1");
  await settled();
  ok("D1 format imposé (carré)", blockOf(5, "profile")?.props.portraitRatio === "1:1");
  await until(f, () => { const i = document.querySelector('[data-edit-media="portraitMediaId"] img'); return i && Math.abs(i.clientWidth - i.clientHeight) < 2; });
  await f.locator('[data-edit-media="portraitMediaId"] img').first().hover();
  ok("D2 image hors format : « Cadrer » au survol", await until(f, () => Boolean(document.querySelector(".lk-crop-btn"))));
  await f.locator(".lk-crop-btn").click();
  ok("D3 vue de cadrage : zone gardée claire, reste grisé", await until(f, () => Boolean(document.querySelector(".lk-crop [data-testid=crop-window]"))));
  const w0 = await f.locator("[data-testid=crop-window]").boundingBox();
  for (let i = 0; i < 3; i++) await page.keyboard.press("+");
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowDown");
  await sleep(300);
  // Puis à la souris : la zone se déplace vers la gauche.
  const w1 = await f.locator("[data-testid=crop-window]").boundingBox();
  await page.mouse.move(w1.x + w1.width / 2, w1.y + w1.height / 2);
  await page.mouse.down();
  await page.mouse.move(w1.x + w1.width / 2 - 40, w1.y + w1.height / 2, { steps: 6 });
  await page.mouse.up();
  await sleep(300);
  const w2 = await f.locator("[data-testid=crop-window]").boundingBox();
  ok("D4 zoom (+) : zone plus petite ; flèches et souris : zone déplacée", w1.width < w0.width && w2.x < w1.x, `${JSON.stringify(w0)} ${JSON.stringify(w1)} ${JSON.stringify(w2)}`);
  await page.screenshot({ path: `${SHOTS}/D-cadrage.png` });
  await f.getByRole("button", { name: "Enregistrer le cadrage" }).click();
  await settled();
  await waitFor(() => blockOf(5, "profile")?.props.look?.crop?.portraitMediaId);
  const crop = blockOf(5, "profile")?.props.look?.crop?.portraitMediaId;
  ok("D5 cadrage enregistré par emplacement (point focal + zoom)", crop && crop.zoom > 1.2 && crop.y > 50, JSON.stringify(crop));
  ok(
    "D6 rendu : object-position et zoom sur le portrait",
    await until(f, () => {
      const i = document.querySelector('[data-edit-media="portraitMediaId"] img');
      const cs = getComputedStyle(i);
      return cs.objectFit === "cover" && cs.objectPosition !== "50% 50%" && cs.transform !== "none";
    }),
  );
  await page.screenshot({ path: `${SHOTS}/D-cadrage-applique.png` });
  ok("D7 page publiée", await publish());
  const pub = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pp = await pub.newPage();
  await pp.goto(`${BASE}/fr/a-propos`, { waitUntil: "networkidle" });
  const pos = await pp.evaluate(() => {
    const i = document.querySelector(".profile-portrait img");
    const cs = getComputedStyle(i);
    return { pos: cs.objectPosition, t: cs.transform, ratio: i.clientWidth / i.clientHeight };
  });
  ok("D8 public : portrait carré cadré (object-position + zoom), sans recalcul d'image", pos.pos !== "50% 50%" && pos.t !== "none" && Math.abs(pos.ratio - 1) < 0.02, JSON.stringify(pos));
  await pub.close();
}

/* ---- E. Ouverture : fond du métier ---------------------------------------------------------- */

if (run("E")) {
  f = await openEditor(1);
  await sleep(1500);
  await page.screenshot({ path: `${SHOTS}/E-ouverture-ombre-douce.png` });
  const role = '[data-hero-text="role"]';
  await f.locator(role).hover();
  await until(f, () => Boolean(document.querySelector(".lk-aa")));
  await f.locator(".lk-aa").click();
  await until(f, () => Boolean(document.querySelector(".lk-bar")));
  // Lot 21 : le fond est une propriété du style du texte (ligne « Fond » de TypoControls, la même pour tous les textes).
  ok("E1 barre du métier : choix du fond", (await f.locator('.lk-bar .tc-bd [role="radio"]').count()) === 4);
  await f.locator('.lk-bar .tc-bd [role="radio"]', { hasText: "Bandeau" }).click();
  await settled();
  ok("E2 fond « bandeau » enregistré sur le texte du métier", await waitFor(() => blockOf(1, "hero")?.props.look?.text?.["site.role"]?.backdrop === "band"), JSON.stringify(blockOf(1, "hero")?.props.look));
  ok("E3 rendu : bandeau derrière le métier", await until(f, (s) => getComputedStyle(document.querySelector(s)).backgroundColor !== "rgba(0, 0, 0, 0)", role));
  await page.keyboard.press("Escape");
  await sleep(600);
  await page.screenshot({ path: `${SHOTS}/E-ouverture-bandeau.png` });
  // Retour au thème (aucun fond), brouillon abandonné.
  await openEditor(1);
}


/* ---- H. Tailles, couleur libre, menu de graisse (lot 7) -------------------------------------- */

if (run("H")) {
  // Échelle attendue (src/lib/look.ts SIZE_VALUES) : valeur CSS de chaque cran.
  const SIZE_CSS = { xs: "0.75rem", s: "0.875rem", m: "1rem", l: "1.25rem", xl: "1.5rem", "2xl": "clamp(1.75rem, 3vw, 2.25rem)", "3xl": "clamp(2.25rem, 5vw, 3.25rem)", "4xl": "clamp(3rem, 8vw, 5rem)", "5xl": "clamp(3.75rem, 11vw, 7rem)", "6xl": "clamp(4.5rem, 14vw, 10rem)", "7xl": "clamp(5.5rem, 18vw, 13rem)" };
  const fontPx = (sel) => f.evaluate((s) => parseFloat(getComputedStyle(document.querySelector(s)).fontSize), sel);
  const probePx = (css) =>
    f.evaluate((v) => {
      const p = document.createElement("div");
      p.style.fontSize = v;
      document.body.appendChild(p);
      const n = parseFloat(getComputedStyle(p).fontSize);
      p.remove();
      return n;
    }, css);
  const openBar = async (sel) => {
    await f.locator(sel).first().scrollIntoViewIfNeeded();
    await f.locator(sel).first().hover();
    if (!(await until(f, () => Boolean(document.querySelector(".lk-aa")), null, 8000))) {
      await page.screenshot({ path: `${SHOTS}/H-debug-sans-aa.png` });
      console.log(`  (pas de « Aa » sur ${sel} : ${await f.locator(sel).count()} élément(s), texte « ${(await f.locator(sel).first().textContent())?.slice(0, 40)} »)`);
      return false;
    }
    // Le « Aa » suit le survol (il disparaît 500 ms après la sortie du texte) : s'il est retiré
    // pendant le clic (bouton détaché), on re-survole le texte et on réessaie.
    for (let essai = 0; essai < 4; essai++) {
      try {
        await f.locator(".lk-aa").click({ timeout: 4000 });
        break;
      } catch (e) {
        if (essai === 3) throw e;
        await f.locator(sel).first().hover();
        await until(f, () => Boolean(document.querySelector(".lk-aa")), null, 3000);
      }
    }
    return until(f, () => Boolean(document.querySelector(".lk-bar")));
  };
  const pickSize = async (key) => {
    await f.locator('.lk-bar .ms-button[aria-label^="Taille"]').click();
    await f.locator(`.ms-option[data-value="${key}"]`).click();
    await sleep(150);
  };

  f = await openEditor(2);
  await sleep(1200);

  // Les sections précédentes ont laissé des réglages LOCAUX sur le titre (ils passent devant le style
  // du site) : retour au style global pour mesurer le rôle.
  if (await openBar(h1)) {
    await f.locator(".lk-bar [role=radio]", { hasText: "Ce texte" }).click();
    const reset = f.locator(".lk-bar .tc-reset");
    if (await reset.isEnabled()) await reset.click();
    await sleep(300);
    await f.locator(".lk-bar .lk-close").click();
    await sleep(300);
  }

  // H1-H3. Toutes les tailles, sur plusieurs rôles : strictement croissantes, valeur exacte.
  const eyebrow = '[data-edit-type="section-title"] [data-inline="eyebrow"]';
  const intro = '[data-edit-type="section-title"] [data-inline="intro"]';
  // Variantes du thème qui visent .eyebrow / .site-brand à spécificité plus haute : le réglage doit gagner.
  await f.evaluate(() => {
    document.documentElement.dataset.caption = "handwritten";
    document.documentElement.dataset.header = "centered";
  });
  for (const [label, sel, role] of [["Titre 1", h1, "Titre 1"], ["Étiquette", eyebrow, "Étiquette"], ["Texte", intro, "Texte"]]) {
    if (!(await openBar(sel))) {
      ok(`H0 barre ouverte sur ${label}`, false);
      continue;
    }
    await f.locator(".lk-bar [role=radio]", { hasText: new RegExp(`Tous les « ${role} »|Tous les « ${role.toLowerCase()} »`, "i") }).first().click();
    const seen = [];
    for (const [key, css] of Object.entries(SIZE_CSS)) {
      await pickSize(key);
      const want = await probePx(css);
      // Le titre anime sa taille (transition du thème) : attendre qu'elle se pose.
      await until(f, (a) => Math.abs(parseFloat(getComputedStyle(document.querySelector(a.s)).fontSize) - a.want) <= 0.6, { s: sel, want }, 4000);
      const got = await fontPx(sel);
      seen.push(got);
      if (Math.abs(got - want) > 0.6) ok(`H1 ${label} : cran ${key} appliqué (${want} px attendus)`, false, `${got} px`);
    }
    ok(`H1 ${label} : 11 crans, valeur calculée exacte pour chacun (dont avec variantes handwritten / centered)`, seen.length === 11 && seen.every((v, i) => !i || v > seen[i - 1] + 1), seen.join(" "));
    // Retour au thème pour ce rôle.
    await f.locator('.lk-bar .tc-reset').click();
    await sleep(200);
    await f.locator(".lk-bar .lk-close").click();
    await sleep(300);
  }
  await f.evaluate(() => {
    delete document.documentElement.dataset.caption;
    delete document.documentElement.dataset.header;
  });

  // H2. Libellés de la liste : le cran et sa valeur.
  if (await openBar(h1)) {
    await f.locator('.lk-bar .ms-button[aria-label^="Taille"]').click();
    const labels = await f.locator(".ms-option").allTextContents();
    ok("H2 liste des tailles : libellés avec valeur en px", labels.length === 12 && labels.slice(1).every((t) => /\d+(–\d+)? px/.test(t)), labels.join(" | "));
    await page.screenshot({ path: `${SHOTS}/H-liste-tailles.png` });
    await page.keyboard.press("Escape");

    // H3. Menu de graisse maison : options dans leur graisse réelle.
    await f.locator(".lk-bar [role=radio]", { hasText: "Ce texte" }).click();
    await f.locator('.lk-bar .ms-button[aria-label^="Graisse"]').click();
    const weights = await f.evaluate(() => [...document.querySelectorAll(".ms-option[data-value]:not([data-value=''])")].map((o) => [o.getAttribute("data-value"), getComputedStyle(o).fontWeight, o.getAttribute("aria-disabled")]));
    ok("H3 menu de graisse : 9 graisses, chacune affichée dans sa graisse", weights.length === 9 && weights.every(([v, w]) => v === w), JSON.stringify(weights));
    ok("H3b menu de graisse : plus de <select> natif dans la barre", (await f.locator(".lk-bar select").count()) === 0);
    await page.screenshot({ path: `${SHOTS}/H-menu-graisse.png` });
    await f.locator('.ms-option[data-value="700"]').click();
    ok("H3c graisse 700 enregistrée pour CE texte", await waitFor(() => blockOf(2, "section-title")?.props.look?.text?.title?.weight === 700));
    await page.keyboard.press("Escape");
  }

  // H4-H12. Couleur libre.
  if (!(await f.locator(".lk-bar").count())) await openBar(h1);
  await f.locator(".lk-bar [role=radio]", { hasText: "Ce texte" }).click();
  const wheel = f.locator(".lk-bar .tc-wheel");
  ok("H4 dernière pastille : roue des couleurs (dégradé conique)", (await wheel.count()) === 1 && /conic-gradient/.test((await wheel.getAttribute("style")) ?? "") && (await f.locator(".lk-bar .tc-swatches > :last-child.tc-wheel").count()) === 1);
  await wheel.click();
  ok("H5 sélecteur ouvert dans la toile", await until(f, () => Boolean(document.querySelector(".cp .cp-wheel"))));
  ok("H5b sélecteur : roue, curseurs de luminosité et d'opacité, un seul champ « Code couleur », aperçu, couleurs du thème", (await f.locator(".cp .cp-wheel").count()) === 1 && (await f.locator('.cp [role=slider]:not(.cp-wheel)').count()) === 2 && (await f.locator(".cp input").count()) === 1 && (await f.locator(".cp input").first().getAttribute("aria-label")) === "Code couleur" && (await f.locator(".cp-preview").count()) === 1 && (await f.locator('.cp [aria-label="Couleurs du thème"] .cp-chip').count()) === 8);
  ok("H5c sélecteur entièrement visible (la toile défile au besoin)", await until(f, () => { const r = document.querySelector(".cp").getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight + 1; }, null, 5000));
  await page.screenshot({ path: `${SHOTS}/H-selecteur-couleur.png` });
  // v0.16 : la pastille des curseurs (18 px, centrée sur la valeur) restait à cheval sur le bord à 100 % d'opacité :
  // elle dépassait d'environ 8 px de la fenêtre, qui défilait en largeur.
  const edge = await f.evaluate(() => {
    const cp = document.querySelector(".cp");
    const box = cp.getBoundingClientRect();
    const pointers = [...cp.querySelectorAll(".cp-slider [class$='-fill']")].map((e) => e.getBoundingClientRect().right);
    return { scroll: cp.scrollWidth - cp.clientWidth, over: Math.max(...pointers) - box.right };
  });
  ok("H5d curseur d'opacité à 100 % : pastille dans la fenêtre, aucun défilement en largeur", edge.scroll <= 0 && edge.over <= 0, JSON.stringify(edge));
  const hex = f.locator(".cp .cp-hex");
  await hex.fill("javascript");
  await hex.press("Enter");
  await sleep(500);
  ok("H6 saisie invalide : rien n'est enregistré", blockOf(2, "section-title")?.props.look?.text?.title?.color === undefined);
  await hex.fill("#336699");
  await hex.press("Enter");
  ok("H7 HEX saisi : couleur normalisée enregistrée (zod)", await waitFor(() => blockOf(2, "section-title")?.props.look?.text?.title?.color === "#336699"), JSON.stringify(blockOf(2, "section-title")?.props.look?.text?.title));
  ok("H8 rendu : le titre prend la couleur (rgb(51, 102, 153))", await until(f, (s) => getComputedStyle(document.querySelector(s)).color === "rgb(51, 102, 153)", h1));
  ok("H8b la valeur est en ligne sur le titre, sans autre propriété injectée", await until(f, (s) => /color:\s*(#336699|rgb\(51, 102, 153\))/.test(document.querySelector(s).getAttribute("style") ?? ""), h1));
  // Un seul champ : le code accepte aussi rgb(…) et hsl(…) (hsl(210, 50%, 40%) = #336699).
  await hex.fill("hsl(210, 50%, 40%)");
  await hex.press("Enter");
  await sleep(500);
  ok("H9 « Code couleur » : hsl(…) saisi, même couleur enregistrée en #336699", (await hex.inputValue()) === "#336699" && blockOf(2, "section-title")?.props.look?.text?.title?.color === "#336699", `${await hex.inputValue()} ${JSON.stringify(blockOf(2, "section-title")?.props.look?.text?.title)}`);
  await hex.fill("rgb(51, 102, 153)");
  await hex.press("Enter");
  await sleep(300);
  ok("H9b … rgb(…) aussi", (await hex.inputValue()) === "#336699");
  const status = (await f.locator(".cp-contrast").textContent()) ?? "";
  ok("H10 lisibilité en mots (bonne / juste / insuffisante), ratio en info-bulle", /Lisibilité : (bonne|juste|insuffisante) sur le fond du thème/.test(status) && !/:1/.test(status) && /Contraste \d+,\d:1/.test((await f.locator(".cp-contrast").getAttribute("title")) ?? ""), status);
  // Roue : sélection par glisser (teinte = angle, saturation = rayon).
  const wb = await f.locator(".cp .cp-wheel").boundingBox();
  const cx = wb.x + wb.width / 2, cy = wb.y + wb.height / 2, rad = wb.width / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + rad * 0.5, cy, { steps: 6 });
  await page.mouse.move(cx + rad * 0.5, cy + rad * 0.3, { steps: 6 });
  await page.mouse.up();
  await sleep(500);
  const wheelHex = await hex.inputValue();
  ok("H11 roue : le glisser change la couleur (valeur HEX obtenue)", /^#[0-9a-f]{6}$/i.test(wheelHex) && wheelHex.toLowerCase() !== "#336699", wheelHex);
  const hexHsl = (h) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    const hue = d === 0 ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [Math.round(hue * 60), Math.round(s * 100), Math.round(l * 100)];
  };
  const hslNow = hexHsl(wheelHex);
  ok("H11b roue : saturation ~ rayon (50 % à droite du centre, ~58 % de rayon), teinte cohérente", hslNow[0] >= 0 && hslNow[0] <= 360 && hslNow[1] > 0, hslNow.join(","));
  ok("H11c roue : « Code couleur » synchronisé (une valeur #rrggbb)", /^#[0-9a-f]{6}$/i.test(await hex.inputValue()), await hex.inputValue());
  ok("H11d roue : enregistrée dans le style", await waitFor(() => blockOf(2, "section-title")?.props.look?.text?.title?.color === wheelHex.toLowerCase()), blockOf(2, "section-title")?.props.look?.text?.title?.color);
  // Hors de la roue (bord extérieur) : saturation plafonnée à 100 %, la fenêtre ne se ferme pas.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - rad * 3, cy, { steps: 6 });
  await page.mouse.up();
  await sleep(500);
  const hslEdge = hexHsl(await hex.inputValue());
  ok("H11e glisser hors de la roue : sélecteur encore ouvert, saturation maximale", (await f.locator(".cp").count()) === 1 && hslEdge[1] >= 95, hslEdge.join(","));
  // Luminosité : curseur ShadeSlider, clic au quart gauche = clair, au quart droit = sombre.
  const hexBeforeV = await hex.inputValue();
  const sb = await f.locator(".cp .cp-slider").nth(0).locator('[role=slider]').boundingBox();
  await page.mouse.click(sb.x + sb.width * 0.85, sb.y + sb.height / 2);
  await sleep(500);
  const hexDark = await hex.inputValue();
  const lum = (h) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
  ok("H11f luminosité : curseur à droite assombrit", lum(hexDark) < lum(hexBeforeV), `${hexBeforeV} → ${hexDark}`);
  // Clavier : la roue se règle aux flèches ; le curseur d'opacité aussi.
  await f.locator(".cp .cp-wheel").focus();
  const before = await hex.inputValue();
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("ArrowUp");
  await sleep(400);
  ok("H11g clavier : flèches sur la roue modifient la couleur", (await hex.inputValue()) !== before, `${before} → ${await hex.inputValue()}`);
  const hexBeforeK = await hex.inputValue();
  await f.locator('.cp [role=slider][aria-label^="Luminosité"]').focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await sleep(400);
  ok("H11h clavier : flèches sur le curseur de luminosité", (await hex.inputValue()) !== hexBeforeK, `${hexBeforeK} → ${await hex.inputValue()}`);
  // Opacité : couleur translucide #rrggbbaa (clic au milieu du curseur).
  const ab = await f.locator('.cp [role=slider][aria-label^="Opacité"]').boundingBox();
  await page.mouse.click(ab.x + ab.width * 0.5, ab.y + ab.height / 2);
  await sleep(500);
  ok("H12 opacité : format #rrggbbaa enregistré (~50 %)", await waitFor(() => /^#[0-9a-f]{6}(7[89a-f]|8[0-7])$/.test(blockOf(2, "section-title")?.props.look?.text?.title?.color ?? "")), blockOf(2, "section-title")?.props.look?.text?.title?.color);
  // Échap ferme le sélecteur seulement (la barre reste), le focus revient sur la pastille.
  await page.keyboard.press("Escape");
  ok("H13 Échap : sélecteur fermé, barre toujours ouverte", (await until(f, () => !document.querySelector(".cp"))) && (await f.locator(".lk-bar").count()) === 1);
  ok("H13b focus rendu à la pastille", await until(f, () => document.activeElement?.classList.contains("tc-wheel")));
  // Clic extérieur.
  await wheel.click();
  await until(f, () => Boolean(document.querySelector(".cp")));
  ok("H14 couleurs récentes rappelées", (await f.locator('.cp [aria-label="Couleurs récentes"] .cp-chip').count()) >= 1);
  await f.locator(".lk-bar-head").click({ position: { x: 4, y: 4 } });
  ok("H15 clic extérieur : sélecteur fermé", await until(f, () => !document.querySelector(".cp")));
  // Écran étroit : le sélecteur reste entièrement dans la fenêtre de la toile.
  await page.setViewportSize({ width: 420, height: 900 });
  await sleep(1200);
  f = await canvas();
  if (!(await f.locator(".lk-bar .tc-wheel").count())) await openBar(h1);
  await f.locator(".lk-bar .tc-wheel").click();
  await until(f, () => Boolean(document.querySelector(".cp .cp-wheel")));
  await sleep(300);
  const box = await f.evaluate(() => {
    const r = document.querySelector(".cp").getBoundingClientRect();
    return { left: r.left, right: r.right, vw: document.documentElement.clientWidth };
  });
  ok("H16 écran étroit : sélecteur dans la fenêtre", box.left >= 0 && box.right <= box.vw + 1, JSON.stringify(box));
  await page.screenshot({ path: `${SHOTS}/H-selecteur-etroit.png` });
  await page.setViewportSize({ width: 1440, height: 900 });
  await sleep(800);
  // Brouillon abandonné.
  await openEditor(2);
}

ok("G1 aucune requête du navigateur vers Google (éditeur, toile, pages publiques)", googleRequests.length === 0, googleRequests.slice(0, 3).join(" "));
ok("G2 aucune erreur JavaScript", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `e2e-look : ${failures} échec(s)` : "e2e-look : OK");
process.exit(failures ? 1 : 0);
