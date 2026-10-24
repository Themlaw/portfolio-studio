#!/usr/bin/env node
/**
 * Lot 83 « icône du site » : UN chromium, serveur dev OU standalone, base NEUVE (seed), une connexion.
 *
 *  A. Sans réglage : un monogramme (jamais l'icône d'origine : empreinte comparée), balises icon / apple-touch-icon / manifest en fr et en en,
 *     /favicon.ico (ICO), PNG 16 à 512 et maskable, SVG du monogramme, manifeste valide, cache immuable à l'empreinte.
 *  B. Le thème en ligne change : l'icône change (empreinte, ICO).
 *  C. Un logo (importé à l'étape « Logo », thème mis en ligne) : l'icône vient du logo.
 *  D. Monogramme réglé (Réglages) : lettres, forme et couleurs appliquées ; aperçu clair / sombre à la taille réelle, écran d'accueil.
 *  E. Une de mes images, recadrée avec l'outil des photos (carré) : le recadrage est respecté ; image trop détaillée : avertissement.
 *  F. Les deux emplacements (Réglages, étape « Logo ») sont le MÊME réglage : synchronisés dans les deux sens.
 * Captures : $SHOTS. Thèmes et images de test retirés à la fin.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… [BASE=http://localhost:3001] [SHOTS=…] [ONLY=A,B] node scripts/e2e-favicon83.mjs
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
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
const SHOTS = process.env.SHOTS ?? "screenshots/favicon83";
const ONLY = process.env.ONLY ?? "";
const run = (k) => !ONLY || ONLY.split(",").includes(k);
mkdirSync(SHOTS, { recursive: true });
const TMP = path.join(tmpdir(), "e2e-favicon83");
mkdirSync(TMP, { recursive: true });
/** sha256 de l'ancien public/favicon.ico (l'icône d'origine, retirée au lot 83). */
const ORIGINAL_SHA = "2b8ad2d33455a8f736fc3a8ebf8f0bdea8848ad4c0db48a2833bd0f9cd775932";

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (sql, ...args) => {
  const db = new Database(DB, { readonly: true });
  try {
    return db.prepare(sql).all(...args);
  } finally {
    db.close();
  }
};
const exec = (sql, ...args) => {
  const db = new Database(DB);
  try {
    return db.prepare(sql).run(...args);
  } finally {
    db.close();
  }
};
const setting = (key) => JSON.parse(q("select value from settings where key = ?", key)[0]?.value ?? "null");
const themeData = (id) => JSON.parse(q("select data from themes where id = ?", id)[0]?.data ?? "null");
async function waitFor(fn, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(300);
  }
  return false;
}
const tsx = (code) => execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { encoding: "utf8", env: { ...process.env, DATA_DIR: DATA } });
const duplicate = (id) => JSON.parse(tsx(`import { duplicateTheme } from "./src/lib/edit/themes.ts"; console.log(JSON.stringify(duplicateTheme(${JSON.stringify(id)}).data.id));`).trim().split("\n").pop());

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

async function section(name, fn) {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 6).join(" "));
    await page.screenshot({ path: path.join(SHOTS, `erreur-${name}.png`) }).catch(() => {});
  }
}

const get = async (url) => {
  const res = await fetch(`${BASE}${url}`, { headers: { "user-agent": "e2e-favicon83" } });
  return { res, buf: Buffer.from(await res.arrayBuffer()) };
};
const html = async (url) => (await get(url)).buf.toString("utf8");
const links = (text) => [...text.matchAll(/<link\s[^>]*>/g)].map((m) => m[0]);
const attr = (tag, name) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
const decode = (s) => (s ?? "").replace(/&amp;/g, "&");
/** Empreinte des balises d'une page publique (v=…), ou null. */
const fingerprint = async (url = "/fr") => /site-icon\/32\.png\?v=([0-9a-f]{12})/.exec(await html(url))?.[1] ?? null;
const rgb = async (buf, x, y) => {
  const r = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return [...r.data.subarray((y * r.info.width + x) * 4, (y * r.info.width + x) * 4 + 4)];
};
const near = (c, h) => c.slice(0, 3).every((v, i) => Math.abs(v - parseInt(h.slice(i * 2, i * 2 + 2), 16)) <= 4);
const hex = (c) => c.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("");
const cssHex = (css) => {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css);
  return m ? [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("") : css;
};
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
const siteName = () => {
  const v = setting("site")?.name;
  return typeof v === "string" ? v : (v?.fr ?? "");
};
const created = [];
const liveBefore = setting("activeThemeId");
const seoBefore = q("select value from settings where key = 'seo'")[0]?.value ?? null;

async function upload(name, buffer) {
  const res = await ctx.request.post(`${BASE}/admin/api/upload`, { multipart: { file: { name, mimeType: "image/png", buffer } }, headers: { origin: BASE } });
  const body = await res.json();
  if (!body.ok) throw new Error(`envoi refusé : ${JSON.stringify(body)}`);
  return body.media.id;
}
const mediaReady = async (id) => waitFor(() => q("select status from media where id = ?", id)[0]?.status === "ready", 120000);
async function pickImage(zone, nth, mediaName) {
  await zone.getByRole("button", { name: /Choisir une image|Changer d'image/ }).nth(nth).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator(`.a-media-tile[title="${mediaName}"]`).click();
  await dialog.waitFor({ state: "hidden" });
}
const settingZone = (scope) => page.locator(`[data-testid=favicon-setting][data-scope=${scope}]`);
const saveFavicon = async (zone) => {
  await zone.getByTestId("fav-save").click();
  await zone.getByText("Enregistrement…").first().waitFor({ timeout: 5000 }).catch(() => {});
  await zone.getByText("✓ Enregistré").waitFor({ timeout: 60000 });
  await sleep(1500);
};
const openReglages = async () => {
  await page.goto(`${BASE}/admin/reglages`, { waitUntil: "networkidle" });
  await settingZone("reglages").waitFor();
};
const openGuide = async (id) => {
  await page.goto(`${BASE}/admin/themes/${encodeURIComponent(id)}?etape=logo`, { waitUntil: "networkidle" });
  await page.locator(".a-guide-head").waitFor();
  await settingZone("guide").waitFor();
};
const previewReady = async (zone) => zone.getByTestId("fav-tab-light").waitFor({ timeout: 60000 });

/* ---- A. Sans réglage : monogramme --------------------------------------------------------------------------------------- */
let fp0 = null;
if (run("A"))
  await section("A", async () => {
    const fr = await html("/fr");
    const en = await html("/en");
    fp0 = await fingerprint("/fr");
    for (const [lang, text] of [["fr", fr], ["en", en]]) {
      const l = links(text);
      const rels = (r) => l.filter((t) => attr(t, "rel") === r);
      ok(`A1 ${lang} : <link rel="icon"> ico, svg, png 32 / 48 / 192 / 512 à l'empreinte`, rels("icon").length >= 5 && rels("icon").some((t) => /\/favicon\.ico\?v=/.test(attr(t, "href") ?? "")) && rels("icon").some((t) => /icon\.svg\?v=/.test(attr(t, "href") ?? "")) && [32, 48, 192, 512].every((s) => rels("icon").some((t) => new RegExp(`site-icon/${s}\\.png\\?v=[0-9a-f]{12}`).test(attr(t, "href") ?? ""))), l.filter((t) => /icon/.test(t)).join(" "));
      ok(`A2 ${lang} : apple-touch-icon 180 px`, rels("apple-touch-icon").length === 1 && /site-icon\/180\.png\?v=/.test(attr(rels("apple-touch-icon")[0], "href") ?? ""), l.join(" "));
      ok(`A3 ${lang} : manifest.webmanifest`, rels("manifest").length === 1 && /^\/manifest\.webmanifest\?v=[0-9a-f]{12}$/.test(decode(attr(rels("manifest")[0], "href"))), rels("manifest").join(" "));
    }
    ok("A4 le même jeu de balises en fr et en en (mêmes empreintes)", (await fingerprint("/en")) === fp0 && Boolean(fp0));

    const ico = await get("/favicon.ico");
    ok("A5 /favicon.ico : un ICO généré, plus l'icône d'origine (empreinte)", ico.res.status === 200 && /image\/x-icon/.test(ico.res.headers.get("content-type") ?? "") && ico.buf.readUInt16LE(2) === 1 && ico.buf.readUInt16LE(4) === 3 && sha(ico.buf) !== ORIGINAL_SHA, `${ico.res.status} ${sha(ico.buf)}`);
    const icoSizes = [0, 1, 2].map((i) => ico.buf[6 + i * 16]);
    ok("A5b ICO multi-tailles : 16, 32, 48", icoSizes.join() === "16,32,48", icoSizes.join());
    for (const size of [16, 32, 48, 180, 192, 512]) {
      const r = await get(`/site-icon/${size}.png?v=${fp0}`);
      const m = r.res.status === 200 ? await sharp(r.buf).metadata() : null;
      ok(`A6 /site-icon/${size}.png : PNG ${size} × ${size}, cache immuable (empreinte)`, m?.width === size && m?.height === size && /immutable/.test(r.res.headers.get("cache-control") ?? ""), `${r.res.status} ${m?.width}x${m?.height} ${r.res.headers.get("cache-control")}`);
    }
    const mask = await get(`/site-icon/maskable-512.png?v=${fp0}`);
    ok("A7 icône maskable 512 px, fond plein jusqu'aux coins", mask.res.status === 200 && (await rgb(mask.buf, 1, 1))[3] === 255 && (await rgb(mask.buf, 510, 510))[3] === 255);
    const svg = await get(`/site-icon/icon.svg?v=${fp0}`);
    ok("A8 icon.svg du monogramme : variante sombre (prefers-color-scheme)", svg.res.status === 200 && /image\/svg\+xml/.test(svg.res.headers.get("content-type") ?? "") && /prefers-color-scheme:dark/.test(svg.buf.toString("utf8")));
    ok("A9 sans empreinte : cache court (l'icône peut changer)", !/immutable/.test((await get("/site-icon/32.png")).res.headers.get("cache-control") ?? ""));
    ok("A10 taille inconnue et chemin piégé : 404", (await get("/site-icon/64.png")).res.status === 404 && (await get("/site-icon/..%2f32.png")).res.status === 404 && (await get("/site-icon/icon.png")).res.status === 404);

    const man = await get(`/manifest.webmanifest?v=${fp0}`);
    const manifest = JSON.parse(man.buf.toString("utf8"));
    ok("A11 manifeste : JSON valide, nom du site, démarrage, affichage", man.res.status === 200 && /manifest\+json/.test(man.res.headers.get("content-type") ?? "") && manifest.name === siteName() && manifest.start_url === "/" && ["browser", "standalone", "minimal-ui", "fullscreen"].includes(manifest.display), JSON.stringify(manifest).slice(0, 200));
    ok("A12 manifeste : couleurs du thème en ligne (#rrggbb)", /^#[0-9a-f]{6}$/i.test(manifest.theme_color) && /^#[0-9a-f]{6}$/i.test(manifest.background_color));
    let iconsOk = manifest.icons?.length === 3;
    for (const i of manifest.icons ?? []) {
      const r = await get(i.src);
      const m = r.res.status === 200 ? await sharp(r.buf).metadata() : null;
      iconsOk &&= `${m?.width}x${m?.height}` === i.sizes && i.type === "image/png" && ["any", "maskable"].includes(i.purpose);
    }
    ok("A13 manifeste : icônes 192 et 512 « any » et 512 « maskable », toutes servies à la bonne taille", iconsOk && manifest.icons.some((i) => i.purpose === "maskable"));
    ok("A14 monogramme : les initiales du nom du site sont proposées par défaut (champ Lettres)", await (async () => {
      await openReglages();
      return (await settingZone("reglages").getByTestId("fav-letters").getAttribute("placeholder")) === siteName().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
    })());
  });

/* ---- B. Le thème en ligne change ---------------------------------------------------------------------------------------- */
const publishTheme = async (id, name) => {
  await page.goto(`${BASE}/admin/themes/${encodeURIComponent(id)}?etape=logo`, { waitUntil: "networkidle" });
  await page.locator(".a-guide-head").waitFor();
  await page.locator("#theme-name").fill(name);
  await page.locator('[data-testid="step-publish"]').click();
  const dlg = page.locator("dialog[open]");
  await dlg.getByRole("button", { name: "Publier", exact: true }).click();
  return waitFor(() => setting("activeThemeId") === id, 90000);
};
if (run("B"))
  await section("B", async () => {
    const before = await fingerprint("/fr");
    const icoBefore = sha((await get("/favicon.ico")).buf);
    const id = duplicate("studio");
    created.push(id);
    ok("B1 thème copié mis en ligne", await publishTheme(id, "Thème d'essai icône"));
    ok("B2 l'empreinte des balises change avec le thème en ligne", await waitFor(async () => (await fingerprint("/fr")) !== before, 60000), String(await fingerprint("/fr")));
    const after = await fingerprint("/fr");
    ok("B3 /favicon.ico change aussi (autres couleurs, autre police) et l'ancienne adresse garde l'ancienne icône", sha((await get("/favicon.ico")).buf) !== icoBefore, sha((await get("/favicon.ico")).buf));
    const iconNow = await get(`/site-icon/512.png?v=${after}`);
    ok("B4 l'icône du thème d'essai est un PNG de 512 px", (await sharp(iconNow.buf).metadata()).width === 512);
    const man = JSON.parse((await get(`/manifest.webmanifest?v=${after}`)).buf.toString("utf8"));
    ok("B5 le manifeste suit le thème (couleurs, adresses des icônes à la nouvelle empreinte)", man.icons.every((i) => i.src.includes(`v=${after}`)));
  });

/* ---- C. Un logo ---------------------------------------------------------------------------------------------------------- */
if (run("C"))
  await section("C", async () => {
    const id = duplicate("pro");
    created.push(id);
    await openGuide(id);
    const file = path.join(TMP, "logo-vert.png");
    await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#12ab34"/></svg>')).png().toFile(file);
    await page.setInputFiles('[data-testid="logo-file"]', file);
    await page.locator('[data-testid="logo-sample-light"]').waitFor({ timeout: 120000 });
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await page.locator(".a-save-state", { hasText: /✓\s*Enregistré/ }).waitFor({ timeout: 90000 });
    ok("C1 logo importé et enregistré (carré, couleurs gardées)", themeData(id).assets.kit?.signature?.colors === true);
    ok("C2 thème avec logo mis en ligne", await publishTheme(id, "Thème avec logo"));
    const before = fp0;
    ok("C3 l'empreinte change (logo)", await waitFor(async () => { const f = await fingerprint("/fr"); return f && f !== before; }, 60000));
    const f = await fingerprint("/fr");
    const links0 = links(await html("/fr")).filter((t) => attr(t, "rel") === "icon");
    ok("C4 un logo : pas de SVG de monogramme dans les balises", !links0.some((t) => /icon\.svg/.test(attr(t, "href") ?? "")));
    const png = (await get(`/site-icon/512.png?v=${f}`)).buf;
    ok("C5 l'icône vient du logo : le centre est la couleur du logo (#12ab34)", near(await rgb(png, 256, 256), "12ab34"), hex(await rgb(png, 256, 256)));
    ok("C6 /favicon.ico suit le logo (ni l'icône d'origine, ni le monogramme précédent)", sha((await get("/favicon.ico")).buf) !== ORIGINAL_SHA);
    await openReglages();
    await previewReady(settingZone("reglages"));
    await page.screenshot({ path: path.join(SHOTS, "logo-reglages.png"), fullPage: true });
  });

/* ---- D. Monogramme réglé ------------------------------------------------------------------------------------------------ */
if (run("D"))
  await section("D", async () => {
    // Un thème sans logo : la copie de « Studio » mise en ligne.
    const id = duplicate("studio");
    created.push(id);
    await publishTheme(id, "Thème sans logo");
    await openReglages();
    const zone = settingZone("reglages");
    await previewReady(zone);
    const fBeforeD = await fingerprint("/fr");
    ok("D1 aperçu : onglet clair ET sombre, à 16 px réels et agrandi, écran d'accueil", (await zone.getByTestId("fav-16-light").evaluate((i) => [i.getBoundingClientRect().width, i.naturalWidth])).join() === "16,16" && (await zone.getByTestId("fav-16-dark").evaluate((i) => [i.getBoundingClientRect().width, i.naturalWidth])).join() === "16,16" && (await zone.getByTestId("fav-zoom-light").evaluate((i) => i.getBoundingClientRect().width)) >= 90 && (await zone.getByTestId("fav-phone").count()) === 1);
    await zone.getByTestId("fav-letters").fill("zq");
    await zone.getByTestId("fav-shape-squircle").check();
    const bgSwatch = zone.getByTestId("fav-bg").locator('[data-color="tertiary"]');
    const inkSwatch = zone.getByTestId("fav-ink").locator('[data-color="ink"]');
    await bgSwatch.click();
    await inkSwatch.click();
    const bgHex = cssHex(await bgSwatch.evaluate((el) => getComputedStyle(el).backgroundColor));
    await saveFavicon(zone);
    const stored = setting("seo");
    ok("D2 réglage enregistré : lettres, forme, couleurs du thème (par nom)", stored.faviconMode?.mode === "auto" && stored.faviconMode.mono.letters === "ZQ" && stored.faviconMode.mono.shape === "squircle" && stored.faviconMode.mono.bg === "tertiary" && stored.faviconMode.mono.ink === "ink", JSON.stringify(stored.faviconMode));
    ok("D3 l'empreinte des balises change (nouveau réglage, même thème)", await waitFor(async () => { const f = await fingerprint("/fr"); return f && f !== fBeforeD; }, 60000));
    const f = await fingerprint("/fr");
    const png = (await get(`/site-icon/512.png?v=${f}`)).buf;
    ok("D4 carré arrondi, fond = couleur « Détails » du thème : coin transparent, bord haut de la couleur choisie", (await rgb(png, 1, 1))[3] === 0 && hex(await rgb(png, 256, 6)) === bgHex, `${hex(await rgb(png, 256, 6))} attendu ${bgHex}`);
    const svg = (await get(`/site-icon/icon.svg?v=${f}`)).buf.toString("utf8");
    ok("D5 SVG : fond de la couleur choisie (variante claire)", svg.toLowerCase().includes(`#${bgHex}`), svg.slice(0, 300));
    ok("D6 la page anglaise porte la même empreinte", (await fingerprint("/en")) === f);
    await page.screenshot({ path: path.join(SHOTS, "apercu-onglet-reglages.png"), fullPage: true });
    // Sans fond : des lettres lisibles malgré la couleur « sur l'action » par défaut.
    await zone.getByTestId("fav-shape-none").check();
    await zone.getByTestId("fav-ink").locator('[data-color="onPrimary"]').click();
    await previewReady(zone);
    await sleep(1500);
    ok("D7 sans fond : l'aperçu reste affiché (lettres lisibles choisies par le serveur)", (await zone.getByTestId("fav-16-light").count()) === 1);
  });

/* ---- E. Une de mes images, recadrée -------------------------------------------------------------------------------------- */
const IMG_NAME = `icone83-${Date.now()}.png`;
let imgId = 0;
if (run("E"))
  await section("E", async () => {
    const half = await sharp({ create: { width: 800, height: 400, channels: 3, background: "#d02020" } })
      .composite([{ input: await sharp({ create: { width: 400, height: 400, channels: 3, background: "#20a030" } }).png().toBuffer(), left: 400, top: 0 }])
      .png()
      .toBuffer();
    imgId = await upload(IMG_NAME, half);
    ok("E0 image de test prête", await mediaReady(imgId));
    await openReglages();
    const zone = settingZone("reglages");
    await zone.getByTestId("fav-mode-image").check();
    await pickImage(zone, 0, IMG_NAME);
    await previewReady(zone);
    const fBeforeE = await fingerprint("/fr");
    await zone.getByTestId("fav-crop").click();
    const dlg = page.getByRole("dialog", { name: "Cadrer l'icône" });
    ok("E1 l'outil de cadrage des photos s'ouvre, verrouillé sur un carré (seul « Carré 1:1 » proposé)", (await dlg.getByRole("button", { name: /Carré 1:1/ }).count()) === 1 && (await dlg.locator(".lk-crop-formats button").count()) === 1);
    const win = dlg.getByTestId("crop-window");
    const rect0 = (await win.getAttribute("data-rect")).split(",").map(Number);
    ok("E2 cadre carré, centré au départ (400 × 400 px sur 800 × 400)", Math.abs(rect0[2] * 800 - rect0[3] * 400) < 2 && Math.abs(rect0[0] - 0.25) < 0.01, String(rect0));
    await dlg.focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowRight");
    const rect1 = (await win.getAttribute("data-rect")).split(",").map(Number);
    ok("E3 déplacé tout à droite (la moitié verte)", rect1[0] > 0.49, String(rect1));
    await page.screenshot({ path: path.join(SHOTS, "recadrage-icone.png") });
    await dlg.getByRole("button", { name: "Enregistrer le cadrage" }).click();
    await saveFavicon(zone);
    const stored = setting("seo");
    ok("E4 enregistré : image, recadrage carré", stored.faviconMode.mode === "image" && stored.favicon?.mediaId === imgId && stored.faviconMode.crop?.x > 0.49 && /^icons\/\d+-[0-9a-f]{8}-c[0-9a-f]{6}$/.test(stored.favicon.dir), JSON.stringify(stored.favicon) + JSON.stringify(stored.faviconMode.crop));
    ok("E5 empreinte des balises changée", await waitFor(async () => { const f = await fingerprint("/fr"); return f && f !== fBeforeE; }, 60000));
    const f = await fingerprint("/fr");
    const png = (await get(`/site-icon/512.png?v=${f}`)).buf;
    ok("E6 le recadrage est respecté : l'icône est la moitié verte (centre ET bord gauche)", near(await rgb(png, 256, 256), "20a030") && near(await rgb(png, 8, 256), "20a030"), `${hex(await rgb(png, 256, 256))} ${hex(await rgb(png, 8, 256))}`);
    ok("E7 pas de SVG de monogramme pour une image", !links(await html("/fr")).some((t) => /icon\.svg/.test(t)));
    const ico = await get(`/favicon.ico?v=${f}`);
    ok("E8 /favicon.ico : ICO de l'image", ico.buf.readUInt16LE(4) === 3 && sha(ico.buf) !== ORIGINAL_SHA);
    // Sans recadrage : le centre de l'image (coupure rouge / vert).
    await zone.getByTestId("fav-crop").click();
    await dlg.getByRole("button", { name: "Recentrer" }).click();
    await dlg.getByRole("button", { name: "Enregistrer le cadrage" }).click();
    await saveFavicon(zone);
    const f2 = await waitFor(async () => { const x = await fingerprint("/fr"); return x && x !== f; }, 60000).then(() => fingerprint("/fr"));
    const png2 = (await get(`/site-icon/512.png?v=${f2}`)).buf;
    ok("E9 cadre recentré : moitié rouge à gauche, verte à droite", near(await rgb(png2, 40, 256), "d02020") && near(await rgb(png2, 470, 256), "20a030"), `${hex(await rgb(png2, 40, 256))} ${hex(await rgb(png2, 470, 256))}`);

    // Image très détaillée : avertissement.
    const busy = Buffer.alloc(512 * 512 * 3);
    for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) busy.fill(((x >> 5) + (y >> 5)) % 2 ? 235 : 20, (y * 512 + x) * 3, (y * 512 + x) * 3 + 3);
    const busyName = `detail83-${Date.now()}.png`;
    const busyId = await upload(busyName, await sharp(busy, { raw: { width: 512, height: 512, channels: 3 } }).png().toBuffer());
    ok("E10 image détaillée prête", await mediaReady(busyId));
    await openReglages();
    await zone.getByTestId("fav-mode-image").check();
    await pickImage(zone, 0, busyName);
    ok("E11 image trop détaillée : avertissement « trop détaillée » sous l'aperçu", await zone.getByTestId("fav-warning").filter({ hasText: "détaillée" }).waitFor({ timeout: 60000 }).then(() => true, () => false));
    await page.screenshot({ path: path.join(SHOTS, "avertissement-detail.png"), fullPage: true });
    await zone.getByTestId("fav-mode-auto").check();
    await sleep(800);
    const gone = await zone.getByTestId("fav-warning").filter({ hasText: "détaillée" }).waitFor({ state: "detached", timeout: 30000 }).then(() => true, () => false);
    ok("E12 retour à « Automatique » : plus d'avertissement « détaillée »", gone, (await zone.getByTestId("fav-warning").allTextContents()).join(" | ") + " / " + (await zone.getByTestId("fav-preview").textContent()));
  });

/* ---- F. Deux emplacements, un seul réglage ------------------------------------------------------------------------------ */
if (run("F"))
  await section("F", async () => {
    const id = duplicate("studio");
    created.push(id);
    // Réglages : un monogramme « RS », enregistré.
    await openReglages();
    const r = settingZone("reglages");
    await r.getByTestId("fav-mode-auto").check();
    await r.getByTestId("fav-letters").fill("rs");
    await r.getByTestId("fav-shape-round").check();
    await saveFavicon(r);
    // Étape « Logo » : le MÊME réglage y est lu.
    await openGuide(id);
    const g = settingZone("guide");
    ok("F1 étape « Logo » : le réglage fait dans Réglages y apparaît (mode, lettres, forme)", (await g.getByTestId("fav-mode-auto").isChecked()) && (await g.getByTestId("fav-letters").inputValue()) === "RS" && (await g.getByTestId("fav-shape-round").isChecked()));
    const guideModes = await g.locator("[data-testid^=fav-mode-]").count();
    ok("F2 un seul composant : trois modes dans l'étape « Logo »", guideModes === 3);
    await previewReady(g);
    await page.screenshot({ path: path.join(SHOTS, "etape-logo-icone.png"), fullPage: true });
    // Modifié dans l'étape « Logo », enregistré là : relu dans Réglages.
    await g.getByTestId("fav-letters").fill("tv");
    await g.getByTestId("fav-shape-squircle").check();
    await saveFavicon(g);
    const stored = setting("seo");
    ok("F3 enregistré depuis l'étape « Logo » : le même réglage de site (seo.faviconMode)", stored.faviconMode.mono.letters === "TV" && stored.faviconMode.mono.shape === "squircle", JSON.stringify(stored.faviconMode));
    await openReglages();
    ok("F4b mêmes trois modes dans Réglages", (await settingZone("reglages").locator("[data-testid^=fav-mode-]").count()) === 3);
    ok("F4 Réglages relit le réglage fait dans l'étape « Logo »", (await settingZone("reglages").getByTestId("fav-letters").inputValue()) === "TV" && (await settingZone("reglages").getByTestId("fav-shape-squircle").isChecked()));
    ok("F5 le réglage de la description du site (même fiche) n'efface pas l'icône", await (async () => {
      const form = page.getByTestId("seo-form");
      await form.getByRole("textbox", { name: "Description du site" }).fill("Une description pour tester l'indépendance des enregistrements.");
      await form.getByRole("button", { name: "Enregistrer" }).click();
      await sleep(2500);
      const s = setting("seo");
      return s.faviconMode.mono.letters === "TV" && /indépendance/.test(s.description.fr);
    })());
    // Mode « Kit Photoshop » : le lien vers le kit est proposé dans l'étape « Logo ».
    await openGuide(id);
    await settingZone("guide").getByTestId("fav-mode-kit").check();
    ok("F6 mode « Kit Photoshop » : lien vers le kit du thème", (await settingZone("guide").getByTestId("fav-kit-link").getAttribute("href"))?.endsWith("/kit") === true);
  });

/* ---- Remise en état ------------------------------------------------------------------------------------------------------- */
exec("update settings set value = ? where key = 'activeThemeId'", JSON.stringify(liveBefore));
if (seoBefore !== null) exec("update settings set value = ? where key = 'seo'", seoBefore);
else exec("delete from settings where key = 'seo'");
ok("aucune erreur de page JavaScript", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout est vert");
process.exit(failures ? 1 : 0);
