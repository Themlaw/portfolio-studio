/**
 * Lot 106 « logo de l'en-tête : cadrage vertical » : UN chromium, base NEUVE (seed), une connexion. Logos SYNTHÉTIQUES de 4 formats
 * (très large, carré, très haut, transparent en bas), générés ici.
 *  A. Par défaut (éditeur, 1440 px) : le logo est entier dans la barre, centré (±1 px), proportions gardées, rien coupé ; taille maximale
 *     (160 px) : plafonné à la barre, toujours entier et centré. Même chose à 390 px dans l'éditeur (aperçu téléphone).
 *  B. Public (après publication), 4 formats × 1440 et 390 px : mêmes garanties.
 *  C. Options, chacune mesurée, gardée au rechargement de l'éditeur et publiée : alignement haut / bas, marges aucune / normale,
 *     ajustement « Remplir la hauteur », « La barre s'agrandit », mobile « Même logo ».
 *  D. Anciennes données (fichier v0.33 : taille + comportement + image sans aucun champ du lot 106) : logo centré, entier, mêmes tailles.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… [BASE=http://localhost:3001] [SHOTS=…] [ONLY=A,B] node scripts/e2e-logo106.mjs
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";
import sharp from "sharp";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const DATA = process.env.DATA_DIR ?? "data";
const DB = path.join(DATA, "portfolio.db");
const SHOTS = process.env.SHOTS ?? "screenshots/logo106";
const ONLY = process.env.ONLY ?? "";
const run = (k) => !ONLY || ONLY.split(",").includes(k);
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const info = (label, v) => console.log(`   (${label}: ${typeof v === "string" ? v : JSON.stringify(v)})`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (sql, ...args) => {
  const db = new Database(DB, { readonly: true });
  try {
    return db.prepare(sql).all(...args);
  } finally {
    db.close();
  }
};
const setting = (key) => JSON.parse(q("select value from settings where key = ?", key)[0]?.value ?? "null");
const siteDraftLogo = () => setting("siteDraft")?.snap?.styles?.logo;
const publishedLogo = () => setting("styles")?.logo;
async function waitFor(fn, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(250);
  }
  return false;
}
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

/* ---- Logos synthétiques : très large, carré, très haut, dessin seulement dans la moitié haute (bas transparent) ---- */
const svg = (w, h, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`);
const FORMATS = {
  large: { name: "logo106-large.png", w: 600, h: 120, svg: svg(600, 120, `<rect width="600" height="120" rx="12" fill="#2e4e9e"/><circle cx="60" cy="60" r="48" fill="#f2b705"/><rect x="130" y="20" width="440" height="24" fill="#e8553d"/>`) },
  carre: { name: "logo106-carre.png", w: 200, h: 200, svg: svg(200, 200, `<rect width="200" height="200" rx="16" fill="#2e4e9e"/><circle cx="100" cy="100" r="80" fill="#f2b705"/>`) },
  haut: { name: "logo106-haut.png", w: 80, h: 300, svg: svg(80, 300, `<rect width="80" height="300" rx="8" fill="#2e4e9e"/><circle cx="40" cy="60" r="30" fill="#f2b705"/><rect x="20" y="120" width="40" height="150" fill="#e8553d"/>`) },
  transp: { name: "logo106-transparent.png", w: 300, h: 200, svg: svg(300, 200, `<rect width="300" height="100" rx="12" fill="#2e4e9e"/><circle cx="60" cy="50" r="38" fill="#f2b705"/>`) },
};
const ids = {};

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
page.setDefaultNavigationTimeout(180000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
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
  await sleep(700);
}
async function openEditor(id, { abandon = true } = {}) {
  await page.goto(`${BASE}/admin/pages/${id}/editer`, { waitUntil: "domcontentloaded" });
  const f = await canvas();
  if (abandon && (await page.getByRole("button", { name: "Abandonner les modifications" }).count())) {
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
  const goLive = page.locator("dialog[open]").getByRole("button", { name: "Mettre en ligne" });
  if (await goLive.waitFor({ timeout: 3000 }).then(() => true, () => false)) await goLive.click();
  return waitFor(async () => /En ligne/.test((await page.locator(".ve-status").textContent()) ?? ""), 120000);
}
async function section(name, fn) {
  if (!run(name)) return;
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 6).join(" "));
    await page.screenshot({ path: path.join(SHOTS, `erreur-${name}.png`) }).catch(() => {});
  }
}
const draftHas = (pred) => waitFor(() => pred(siteDraftLogo() ?? {}), 20000);

/** Mesures de l'en-tête (rectangles dans la fenêtre) d'un document (page ou cadre de l'éditeur), une fois les transitions finies. */
const readGeo = (fr) =>
  fr.evaluate(() => {
    const r = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height, cy: (b.top + b.bottom) / 2 };
    };
    const img = document.querySelector(".site-header .site-logo-img");
    const brand = document.querySelector(".site-header .site-brand");
    const main = document.querySelector("#contenu").getBoundingClientRect();
    return {
      img: r(img),
      brand: r(brand),
      bar: r(document.querySelector(".site-header-bar")),
      mainTop: main.top + window.scrollY,
      iw: window.innerWidth,
      fit: img ? getComputedStyle(img).objectFit : null,
      clip: brand ? getComputedStyle(brand).clipPath : null,
      nat: img ? [img.naturalWidth, img.naturalHeight] : null,
    };
  });
async function geo(fr) {
  let prev = null;
  for (let i = 0; i < 30; i++) {
    const g = await readGeo(fr);
    if (prev && JSON.stringify(prev) === JSON.stringify(g)) return g;
    prev = g;
    await sleep(200);
  }
  return prev;
}
/** Le logo est ENTIER dans la barre (aucune coupe, aucun débordement), proportions gardées. */
const whole = (g, fmt) =>
  g.img && g.img.t >= g.bar.t - 0.5 && g.img.b <= g.bar.b + 0.5 && g.brand.t >= g.bar.t - 0.5 && g.brand.b <= g.bar.b + 0.5 && g.clip === "none" && g.fit === "contain" && near(g.img.w / g.img.h, fmt.w / fmt.h, 0.03 * (fmt.w / fmt.h));
const centered = (g) => near(g.img.cy, g.bar.cy, 1);
const det = (g) => JSON.stringify({ img: g.img && [g.img.t, g.img.b, g.img.h, g.img.w], brand: g.brand && [g.brand.t, g.brand.b], mainTop: g.mainTop, bar: [g.bar.t, g.bar.b, g.bar.h], fit: g.fit, clip: g.clip });
const shot = async (name, target = page) => target.screenshot({ path: path.join(SHOTS, `${name}.png`) });

/** Page publique à une largeur donnée. */
async function pub(w) {
  const c = await browser.newContext({ viewport: { width: w, height: 900 } });
  const pg = await c.newPage();
  await pg.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  await sleep(1200);
  const g = await geo(pg);
  return { c, pg, g };
}

/* ---- Envoi des 4 logos ---------------------------------------------------------------------------------- */
for (const [k, fm] of Object.entries(FORMATS)) {
  const png = await sharp(fm.svg).png().toBuffer();
  const up = await ctx.request.post(`${BASE}/admin/api/upload`, { multipart: { file: { name: fm.name, mimeType: "image/png", buffer: png } }, headers: { origin: BASE } });
  const body = await up.json();
  if (!body.ok) throw new Error(`envoi refusé : ${JSON.stringify(body)}`);
  ids[k] = body.media.id;
}
ok("S0 quatre logos synthétiques envoyés et prêts", await waitFor(() => Object.values(ids).every((id) => q("select status from media where id = ?", id)[0]?.status === "ready"), 180000));

let f;
async function chooseLogo(k) {
  await page.getByTestId("logo-choose").click();
  await page.getByRole("button", { name: `Choisir ${FORMATS[k].name}` }).click();
  await settled();
  await draftHas((l) => l.mediaId === ids[k]);
}
async function device(label) {
  const word = label.split(" ")[0];
  const grp = page.getByRole("group", { name: "Largeur d'aperçu" });
  if (await grp.count()) await grp.getByRole("button", { name: new RegExp(word) }).click();
  else await page.getByLabel("Largeur d'aperçu").selectOption({ label });
  await sleep(1200);
}

/* ======================================== A. Par défaut, dans l'éditeur ======================================== */
await section("A", async () => {
  f = await openEditor(2);
  await sleep(1500);
  await page.getByRole("tab", { name: "Réglages" }).click();
  for (const k of Object.keys(FORMATS)) {
    await chooseLogo(k);
    const g = await geo(f);
    info(`A ${k} 1440`, { bar: g.bar, img: g.img });
    ok(`A1 ${k} (éditeur, 1440) : logo entier dans la barre, proportions gardées, rien de coupé`, whole(g, FORMATS[k]), det(g));
    ok(`A2 ${k} (éditeur, 1440) : centré verticalement (±1 px)`, centered(g), `${g.img.cy} / ${g.bar.cy}`);
    ok(`A3 ${k} (éditeur, 1440) : aucune marge parasite : même écart en haut et en bas (±1 px)`, near(g.img.t - g.bar.t, g.bar.b - g.img.b, 1), `${g.img.t - g.bar.t} / ${g.bar.b - g.img.b}`);
    if (k === "large") await shot("A-large-1440");
  }
  // Taille maximale : plafonnée à la barre, toujours entière et centrée.
  await chooseLogo("haut");
  await page.locator("#lp-logo-size").fill("160");
  await settled();
  let g = await geo(f);
  ok("A4 taille 160 px : logo plafonné à la barre, entier, centré, rien ne déborde sur le contenu", whole(g, FORMATS.haut) && centered(g) && g.img.h < 160 && g.brand.b <= g.mainTop, det(g));
  ok("A5 la barre garde sa hauteur naturelle et le contenu ne bouge pas", near(g.bar.h, 60, 1), String(g.bar.h));
  await shot("A-haut-160-1440");
  // Téléphone (aperçu 390 px de l'éditeur).
  await device("Téléphone (390 px)");
  g = await geo(f);
  ok("A6 aperçu téléphone : largeur de la toile = 390 px", near(g.iw, 390, 2), String(g.iw));
  ok("A7 aperçu téléphone, taille 160 px : plafonné à la barre, entier, centré", whole(g, FORMATS.haut) && centered(g), det(g));
  await page.locator("#lp-logo-size").fill("40");
  await settled();
  for (const k of Object.keys(FORMATS)) {
    await chooseLogo(k);
    g = await geo(f);
    ok(`A8 ${k} (éditeur, 390) : entier, centré (±1 px), rien de coupé`, whole(g, FORMATS[k]) && centered(g), det(g));
  }
  await shot("A-transp-390");
  await device("Ordinateur").catch(() => {});
});

/* ======================================== B. Public : 4 formats × 1440 et 390 ======================================== */
await section("B", async () => {
  f = await openEditor(2);
  await sleep(1200);
  await page.getByRole("tab", { name: "Réglages" }).click();
  for (const k of Object.keys(FORMATS)) {
    await chooseLogo(k);
    ok(`B0 ${k} : publication`, await publish());
    for (const w of [1440, 390]) {
      const { c, pg, g } = await pub(w);
      ok(`B1 ${k} public ${w} px : entier, proportions gardées, rien de coupé`, whole(g, FORMATS[k]), det(g));
      ok(`B2 ${k} public ${w} px : centré verticalement (±1 px)`, centered(g), `${g.img.cy} / ${g.bar.cy}`);
      if (k === "transp") await pg.screenshot({ path: path.join(SHOTS, `B-transp-${w}.png`), clip: { x: 0, y: 0, width: w, height: 160 } });
      await c.close();
    }
  }
  ok("B3 public : aucun repère d'édition", !(await (await fetch(`${BASE}/fr`)).text()).match(/data-edit|pe-host|sl-logo-handle|sl-logo-xhandle/));
});

/* ======================================== C. Options : effet mesuré, rechargement, publication ======================================== */
const panelState = (testid) => page.getByTestId(testid).getAttribute("aria-pressed");
async function reloadEditor() {
  f = await openEditor(2, { abandon: false });
  await sleep(1200);
  await page.getByRole("tab", { name: "Réglages" }).click();
  return geo(f);
}
await section("C", async () => {
  f = await openEditor(2);
  await sleep(1200);
  await page.getByRole("tab", { name: "Réglages" }).click();
  await chooseLogo("carre");
  await page.locator("#lp-logo-size").fill("40");
  await settled();
  const base = await geo(f);
  ok("C0 départ : carré 40 px centré, marges égales (10 px de chaque côté)", centered(base) && near(base.img.h, 40, 0.6) && near(base.img.t - base.bar.t, 10, 1), det(base));
  ok("C0b panneau : libellés des options", JSON.stringify((await page.locator("[data-testid=logo-align] strong").allTextContents()).map((s) => s.trim())) === JSON.stringify(["Centré dans la barre", "En haut de la barre", "En bas de la barre", "La barre s'agrandit"]) && (await page.getByTestId("logo-fit-contain").textContent())?.trim() === "Logo entier" && (await page.getByTestId("logo-fit-cover").textContent())?.trim() === "Remplir la hauteur" && (await page.getByTestId("logo-margin-none").textContent())?.trim() === "Aucune" && (await page.getByTestId("logo-mobile-same").textContent())?.trim() === "Même logo");
  ok("C0c panneau : défauts cochés (Centré, Logo entier, Petites, Logo réduit)", (await page.getByTestId("logo-align-center").isChecked()) && (await panelState("logo-fit-contain")) === "true" && (await panelState("logo-margin-small")) === "true" && (await panelState("logo-mobile-reduced")) === "true");

  // Alignement haut / bas.
  await page.getByTestId("logo-align-top").check();
  await settled();
  ok("C1 haut : brouillon align = top", await draftHas((l) => l.align === "top"), JSON.stringify(siteDraftLogo()));
  let g = await geo(f);
  ok("C2 haut : le logo est collé en haut de la barre (4 px de marge), entier, la barre ne bouge pas", whole(g, FORMATS.carre) && near(g.img.t - g.bar.t, 4, 1) && near(g.bar.h, base.bar.h, 0.1) && near(g.mainTop, base.mainTop, 0.1), det(g));
  await shot("C-haut-1440");
  await page.getByTestId("logo-align-bottom").check();
  await settled();
  g = await geo(f);
  ok("C3 bas : le logo est collé en bas de la barre (4 px de marge), entier", whole(g, FORMATS.carre) && near(g.bar.b - g.img.b, 4, 1) && near(g.img.h, 40, 0.6), det(g));
  ok("C3b bas : brouillon align = bottom", await draftHas((l) => l.align === "bottom"), JSON.stringify(siteDraftLogo()));
  // Marges (avec le logo en bas).
  await page.locator("#lp-logo-size").fill("160");
  await page.getByTestId("logo-margin-none").click();
  await settled();
  g = await geo(f);
  ok("C4 marges « Aucune » (taille max) : le logo prend toute la hauteur de la barre (60 px), collé aux deux bords", near(g.img.h, g.bar.h, 0.6) && near(g.img.t, g.bar.t, 0.6) && whole(g, FORMATS.carre), det(g));
  ok("C4b brouillon : margin = none", await draftHas((l) => l.margin === "none"), JSON.stringify(siteDraftLogo()));
  await page.getByTestId("logo-margin-normal").click();
  await settled();
  g = await geo(f);
  ok("C5 marges « Normales » (taille max) : 60 − 2 × 12 = 36 px, bas : 12 px sous le logo", near(g.img.h, 36, 0.8) && near(g.bar.b - g.img.b, 12, 1) && whole(g, FORMATS.carre), det(g));
  await page.getByTestId("logo-margin-small").click();
  await settled();
  g = await geo(f);
  ok("C6 marges « Petites » (défaut) : 60 − 2 × 4 = 52 px ; margin retiré des données", near(g.img.h, 52, 0.8) && (await draftHas((l) => l.margin === undefined)), det(g));
  await page.getByTestId("logo-align-center").check();
  await page.locator("#lp-logo-size").fill("40");
  await settled();
  // Ajustement.
  await chooseLogo("large");
  g = await geo(f);
  ok("C7 « Logo entier » : object-fit contain, 40 px de haut", g.fit === "contain" && near(g.img.h, 40, 0.6), det(g));
  await page.getByTestId("logo-fit-cover").click();
  await settled();
  ok("C8 brouillon : fit = cover", await draftHas((l) => l.fit === "cover"), JSON.stringify(siteDraftLogo()));
  g = await geo(f);
  ok("C9 « Remplir la hauteur » : object-fit cover, toute la hauteur de la barre (60 px), rien ne sort de la barre", g.fit === "cover" && near(g.img.h, g.bar.h, 0.6) && g.img.t >= g.bar.t - 0.5 && g.img.b <= g.bar.b + 0.5 && centered(g), det(g));
  await shot("C-cover-1440");
  // Rechargement : les options survivent.
  await settled();
  g = await reloadEditor();
  ok("C10 rechargement de l'éditeur : « Remplir la hauteur » toujours là (panneau et rendu)", (await panelState("logo-fit-cover")) === "true" && g.fit === "cover" && near(g.img.h, g.bar.h, 0.6), det(g));
  ok("C10b rechargement : alignement Centré, marges Petites", (await page.getByTestId("logo-align-center").isChecked()) && (await panelState("logo-margin-small")) === "true");
  // Publication des options.
  await page.getByTestId("logo-align-bottom").check();
  await page.getByTestId("logo-margin-none").click();
  await settled();
  ok("C11 publication", await publish());
  ok("C11b publié : align bottom, fit cover, margin none", publishedLogo()?.align === "bottom" && publishedLogo()?.fit === "cover" && publishedLogo()?.margin === "none", JSON.stringify(publishedLogo()));
  for (const w of [1440, 390]) {
    const { c, g: pg } = await pub(w);
    ok(`C12 public ${w} px : « Remplir » + « Aucune » : toute la hauteur de la barre, cover`, pg.fit === "cover" && near(pg.img.h, pg.bar.h, 0.6) && near(pg.img.t, pg.bar.t, 0.6), det(pg));
    await c.close();
  }
  // Retour aux valeurs par défaut : rien d'écrit en trop.
  await page.getByTestId("logo-fit-contain").click();
  await page.getByTestId("logo-margin-small").click();
  await page.getByTestId("logo-align-center").check();
  await settled();
  ok("C13 retour aux défauts : plus aucun champ du lot 106 dans les données", await draftHas((l) => !("align" in l) && !("fit" in l) && !("margin" in l) && !("mobile" in l)), JSON.stringify(siteDraftLogo()));
  // La barre s'agrandit.
  await page.locator("#lp-logo-size").fill("120");
  await page.getByTestId("logo-align-grow").check();
  await settled();
  g = await geo(f);
  ok("C14 « La barre s'agrandit » : barre = 120 + 2 × 20 px, logo entier et centré, la bande sous la barre descend", near(g.bar.h, 160, 1) && near(g.img.h, 120, 1) && centered(g) && g.img.b <= g.bar.b + 0.5 && g.mainTop > base.mainTop + 50, det(g));
  await page.getByTestId("logo-margin-none").click();
  await settled();
  g = await geo(f);
  ok("C15 « La barre s'agrandit » + marges « Aucune » : la barre = le logo (120 px)", near(g.bar.h, 120, 1) && near(g.img.h, 120, 1), det(g));
  await page.getByTestId("logo-margin-small").click();
  await page.getByTestId("logo-align-center").check();
  await page.locator("#lp-logo-size").fill("40");
  await settled();
  // Mobile : même logo ou réduit.
  await device("Téléphone (390 px)");
  g = await geo(f);
  ok("C16 téléphone, « Logo réduit » (défaut) : 40 px → 30 px", near(g.img.h, 30, 0.6) && centered(g), det(g));
  await page.getByTestId("logo-mobile-same").click();
  await settled();
  ok("C17 brouillon : mobile = same", await draftHas((l) => l.mobile === "same"), JSON.stringify(siteDraftLogo()));
  g = await geo(f);
  ok("C18 téléphone, « Même logo » : 40 px comme sur grand écran, centré, entier", near(g.img.h, 40, 0.6) && centered(g) && g.img.b <= g.bar.b, det(g));
  await settled();
  ok("C19 publication", await publish());
  const pm = await pub(390);
  ok("C20 public 390 px, « Même logo » : 40 px", near(pm.g.img.h, 40, 0.6) && centered(pm.g), det(pm.g));
  await pm.c.close();
  const pd = await pub(1440);
  ok("C21 public 1440 px, « Même logo » : inchangé (40 px)", near(pd.g.img.h, 40, 0.6), det(pd.g));
  await pd.c.close();
  await device("Ordinateur").catch(() => {});
  g = await reloadEditor();
  ok("C22 rechargement : « Même logo » toujours coché", (await panelState("logo-mobile-same")) === "true");
});

/* ======================================== D. Anciennes données (v0.33) ======================================== */
await section("D", async () => {
  // Réglages tels que la v0.33 les écrivait : taille, comportement, image ; aucun champ du lot 106.
  f = await openEditor(2);
  await sleep(1200);
  await page.getByRole("tab", { name: "Réglages" }).click();
  await device("Ordinateur").catch(() => {});
  await chooseLogo("transp");
  await page.getByTestId("logo-align-center").check();
  await page.getByTestId("logo-fit-contain").click();
  await page.getByTestId("logo-margin-small").click();
  await page.getByTestId("logo-mobile-reduced").click();
  await page.locator("#lp-logo-size").fill("96");
  await page.getByRole("radio", { name: "Fixe" }).check();
  await settled();
  ok("D0 données d'avant : taille et image seules", await draftHas((l) => l.size === 96 && l.mediaId === ids.transp && !("align" in l) && !("fit" in l) && !("margin" in l) && !("mobile" in l)), JSON.stringify(siteDraftLogo()));
  ok("D1 publication", await publish());
  ok("D1b publié : taille et image seules", JSON.stringify(publishedLogo()) === JSON.stringify({ size: 96, mediaId: ids.transp }), JSON.stringify(publishedLogo()));
  for (const w of [1440, 390]) {
    const { c, g } = await pub(w);
    ok(`D2 public ${w} px, ancienne donnée (96 px, plus grand que la barre) : logo entier, centré, rien ne déborde sur le contenu`, whole(g, FORMATS.transp) && centered(g) && g.brand.b <= g.mainTop + 0.5, det(g));
    await c.close();
  }
});

ok("aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
if (failures) {
  console.error(`e2e-logo106 : ÉCHEC (${failures})`);
  process.exit(1);
}
console.log("e2e-logo106 : tout passe");
