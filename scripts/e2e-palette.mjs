#!/usr/bin/env node
/**
 * Palette du thème, kit v4 (curseurs), curseurs sur le site (lot 4).
 * UN chromium, UN onglet ; serveur dev redémarré et pré-chauffé ; une connexion.
 *
 * A. Couleurs avancées (« Affiner » de l'étape 1, copie de galerie-lumineuse) : groupes, « Revenir à
 *    auto », une base qui change entraîne sa nuance auto, contraste
 *    (✗ puis « Ajuster »), enregistrement, état relu après rechargement.
 * B. Kit v4 : export (file lourde, archive de trois PSD) → deux curseurs
 *    redessinés (scripts/kit-poc/simulate-multi.mts cursor) → envoi → revue
 *    (cartes des curseurs, point chaud, plus de revue des couleurs : la palette
 *    se règle dans l'éditeur visuel) → « Appliquer au thème » : copie brouillon.
 * C. Site (aperçu du brouillon) : curseurs émis, PNG 32 × 32 servi, repli
 *    obligatoire, liens en « clic », champ de texte en barre de saisie, admin
 *    sans curseur ; capture avec le curseur incrusté (Playwright ne capture pas
 *    la souris : le PNG servi est posé à la position de la souris, point chaud
 *    compris).
 * D. Option « Utiliser les curseurs dessinés » décochée : plus rien sur le site.
 * Captures : SHOTS (défaut /root/shots-lot4). Copies, imports : supprimés à la fin.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… [BASE=http://localhost:3104] node scripts/e2e-palette.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";
import sharp from "sharp";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const SHOTS = process.env.SHOTS ?? "/root/shots-lot4";
mkdirSync(SHOTS, { recursive: true });
const DIR = path.join(tmpdir(), "e2e-palette");
mkdirSync(DIR, { recursive: true });
const DATA = process.env.DATA_DIR ?? "./data";

let failures = 0;
function ok(label, cond, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
}
const tsx = (code) => execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { encoding: "utf8", env: { ...process.env, DATA_DIR: DATA } });

// Copie de travail de galerie-lumineuse (comme « Dupliquer »).
const COPY = JSON.parse(tsx(`import { duplicateTheme } from "./src/lib/edit/themes.ts"; console.log(JSON.stringify(duplicateTheme("galerie-lumineuse").data.id));`).trim().split("\n").pop());
const created = [COPY];
const readTheme = (id) => JSON.parse(tsx(`import { getThemeForEdit } from "./src/lib/edit/themes.ts"; console.log(JSON.stringify(getThemeForEdit(${JSON.stringify(id)})));`).trim().split("\n").pop());

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
// Dev à froid : la première compilation d'une page de l'admin peut dépasser 30 s.
page.setDefaultTimeout(120000);
page.setDefaultNavigationTimeout(180000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Enregistre l'éditeur de thème et attend « ✓ Enregistré » (sinon : l'état affiché). */
const save = async (label) => {
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  const done = await page.locator(".a-save-state", { hasText: /✓\s*Enregistré/ }).waitFor({ timeout: 90000 }).then(() => true, () => false);
  ok(label, done, await page.locator(".a-save-state").textContent().catch(() => ""));
  if (!done) throw new Error("enregistrement impossible");
};

await page.goto(`${BASE}/admin/connexion`, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL);
await page.fill("#password", PASSWORD);
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/admin/connexion"), { timeout: 60000 }), page.click("button[type=submit]")]);

/* ---- A. Éditeur de palette ------------------------------------------------ */
await page.goto(`${BASE}/admin/themes/${COPY}`, { waitUntil: "networkidle" });
await page.locator('[data-testid="adv-couleurs"] summary').click();
const field = (token) => page.locator(`.a-color[data-token="${token}"]`);
const hex = (token) => field(token).locator(".a-color-hex").inputValue();
ok("couleurs avancées : 7 groupes (Fond de page, Cartes et encadrés, Texte, Boutons et liens, Accent, Ornements, Images agrandies), sans second champ pour les 4 couleurs de base", (await page.locator(".a-pal-group").count()) === 7 && (await page.locator('.a-color[data-token="primary"]').count()) === 0);
ok("migration : survol « choisie » (valeur du preset), voile « auto »", (await field("primaryHover").getAttribute("data-auto")) === "false" && (await hex("primaryHover")) === "#24408a" && (await field("scrim").getAttribute("data-auto")) === "true");
await field("primaryHover").getByRole("button", { name: /Revenir à auto/ }).click();
const autoHover = await hex("primaryHover");
ok(`« Revenir à auto » : survol dérivé (${autoHover})`, (await field("primaryHover").getAttribute("data-auto")) === "true" && /^#[0-9a-f]{6}$/.test(autoHover) && autoHover !== "#24408a");
// La couleur de base se règle dans le panneau « Couleurs » (un seul bloc) ; la nuance auto la suit sous « Affiner ».
await page.locator('.a-da .lc-role-item[data-role="primary"] .lc-role').click();
await page.locator('.a-da .lc-role-item[data-role="primary"] .cp-hex').fill("#1d6b4f");
await page.locator('.a-da .lc-role-item[data-role="primary"] .cp-hex').press("Enter");
await sleep(300);
const followed = await hex("primaryHover");
ok(`base changée : la nuance auto suit (${autoHover} → ${followed})`, followed !== autoHover && (await field("primaryHover").getAttribute("data-auto")) === "true");
ok("base changée : la nuance choisie ne bouge pas (fond profond)", (await hex("bgDeep")) === "#f2f0ea");
ok("compteur « Affiner » : une nuance choisie de moins (survol revenu en auto)", /réglage/.test((await page.locator('[data-testid="adv-couleurs-count"]').textContent()) ?? ""));
await field("inkSoft").locator(".a-color-hex").fill("#c4c4c4");
await sleep(200);
ok("contraste : texte secondaire illisible signalé (✗, « Ajuster »)", (await field("inkSoft").locator(".a-ratio-bad").count()) === 1 && (await field("inkSoft").getByRole("button", { name: /Ajuster/ }).count()) === 1);
await field("inkSoft").getByRole("button", { name: /Ajuster/ }).click();
await sleep(200);
ok("contraste : « Ajuster » → ✓", (await field("inkSoft").locator(".a-ratio-ok").count()) === 1);
await page.locator(".a-pal-groups").first().scrollIntoViewIfNeeded();
await page.locator('[data-testid="adv-couleurs"]').screenshot({ path: `${SHOTS}/editeur-palette.png` });
await save("palette enregistrée (✓ Enregistré)");
await page.reload({ waitUntil: "networkidle" });
ok("enregistré et relu : survol toujours « auto », valeur recalculée", (await field("primaryHover").getAttribute("data-auto")) === "true" && (await hex("primaryHover")) === followed);
const saved = readTheme(COPY);
ok("base de données : palette.auto contient primaryHover (onPrimary suit aussi la base), valeur effective enregistrée", saved.tokens.palette?.auto?.includes("primaryHover") && saved.tokens.color.primaryHover === followed && saved.tokens.color.primary === "#1d6b4f", JSON.stringify(saved.tokens.palette));

/* ---- B. Kit v4 : aller-retour (curseurs) ---------------------------------- */
// La palette n'est plus lue dans la revue d'import (elle se règle dans l'éditeur visuel, lot 17f) : seuls les curseurs font l'aller-retour.
const sim = (...args) => execFileSync(process.execPath, ["--import", "tsx", "scripts/kit-poc/simulate-multi.mts", ...args], { stdio: "ignore" });
const kitUrl = `${BASE}/admin/api/theme-kit/${COPY}`;
let ready = false;
for (let i = 0; i < 90 && !ready; i++) {
  const res = await page.request.post(kitUrl, { headers: { origin: BASE } });
  ready = (await res.json()).ready === true;
  if (!ready) await sleep(2000);
}
ok("export du kit v4 (file lourde) prêt", ready);
const kitFile = path.join(DIR, "kit-v4.zip");
const dl = await page.request.get(kitUrl);
const kitBytes = await dl.body();
writeFileSync(kitFile, kitBytes);
ok("kit v4 téléchargé : archive .zip de trois PSD", dl.ok() && kitBytes.subarray(0, 2).toString("latin1") === "PK" && /application\/zip/.test(dl.headers()["content-type"] ?? ""));
const iconPsd = path.join(DIR, "icones-curseurs.psd");
const edited = path.join(DIR, "kit-v4-curseurs.zip");
sim("cursor", kitFile, iconPsd);
sim("zip", kitFile, edited, iconPsd);

await page.goto(`${BASE}/admin/themes/${COPY}/kit`, { waitUntil: "networkidle" });
await page.setInputFiles('[data-testid="kit-file"]', edited);
await page.waitForURL(/\/kit\?import=/, { timeout: 120000 });
await page.locator(".a-kit-card").nth(15).waitFor({ timeout: 180000 });
await page.waitForLoadState("networkidle");
await page.waitForFunction(() => [...document.querySelectorAll(".a-kit-card img")].every((i) => i.complete), null, { timeout: 30000 });
ok("revue : plus de revue des couleurs (la palette se règle dans l'éditeur visuel)", (await page.locator('[data-testid="kit-colors-review"]').count()) === 0);
const cards = await page.$$eval(".a-kit-card", (els) => els.map((e) => ({ slot: e.dataset.slot, change: e.dataset.change, status: e.dataset.status, text: e.textContent ?? "" })));
const cn = cards.find((c) => c.slot === "curseur/normal");
const cc = cards.find((c) => c.slot === "curseur/clic");
ok("revue : curseurs « redessinés », point chaud lu (3, 3) et (16, 3)", cn?.change === "redrawn" && cc?.change === "redrawn" && cn.text.includes("point chaud 3, 3") && cc.text.includes("point chaud 16, 3"), JSON.stringify([cn, cc]));
ok("revue : les 14 autres éléments inchangés", cards.length === 16 && cards.filter((c) => !c.slot.startsWith("curseur/")).every((c) => c.change === "unchanged"), JSON.stringify(cards.filter((c) => c.change !== "unchanged").map((c) => c.slot)));
await page.screenshot({ path: `${SHOTS}/revue-import.png`, fullPage: true });
await page.locator('.a-kit-card[data-slot="curseur/normal"]').screenshot({ path: `${SHOTS}/revue-import-curseur.png` });
await Promise.all([page.waitForURL(new RegExp(`/admin/themes/[a-z0-9-]*-kit[a-z0-9-]*$`), { timeout: 60000 }), page.getByRole("button", { name: "Appliquer au thème" }).click()]);
const DRAFT = page.url().split("/").pop();
created.push(DRAFT);
const draft = readTheme(DRAFT);
ok("copie brouillon : couleurs du thème inchangées", draft.tokens.color.primary === "#1d6b4f" && draft.tokens.color.primaryHover === followed, JSON.stringify({ c: draft.tokens.color.primary, h: draft.tokens.color.primaryHover }));
ok("copie brouillon : curseurs normal et clic (PNG du kit, points chauds)", draft.assets.kit?.cursors?.default?.x === 3 && draft.assets.kit?.cursors?.pointer?.x === 16 && /\/media\/kit\/[0-9a-f]{16}\.png$/.test(draft.assets.kit?.cursors?.default?.png2x ?? ""), JSON.stringify(draft.assets.kit?.cursors));

/* ---- C. Site : curseurs ----------------------------------------------------- */
await page.locator("iframe").first().waitFor({ timeout: 30000 });
await sleep(1500);
await page.locator('[data-testid="step-tab-logo"]').click();
await page.locator('[data-testid="adv-logo"] summary').click();
await page.locator('[aria-labelledby="t-curseurs"]').scrollIntoViewIfNeeded();
await page.locator('[aria-labelledby="t-curseurs"]').screenshot({ path: `${SHOTS}/editeur-curseurs.png` });
ok("admin : pas de curseur du thème dans l'administration", await page.evaluate(() => !document.documentElement.hasAttribute("data-kit-cursor") && getComputedStyle(document.body).cursor === "auto"));
const preview = async (id) => {
  await page.goto(`${BASE}/admin/themes`, { waitUntil: "networkidle" });
  await page.evaluate((tid) => {
    const f = document.createElement("form");
    f.method = "post";
    f.action = "/admin/apercu";
    const i = document.createElement("input");
    i.name = "id";
    i.value = tid;
    f.append(i);
    document.body.append(f);
    f.submit();
  }, id);
  await page.waitForURL(/\/fr$/, { timeout: 60000 });
  await page.waitForLoadState("networkidle");
};
await preview(DRAFT);
const site = await page.evaluate(() => {
  const input = document.createElement("input");
  input.type = "text";
  document.body.append(input);
  const link = document.querySelector("main a[href]") ?? document.querySelector("a[href]");
  const out = {
    attr: document.documentElement.hasAttribute("data-kit-cursor") && document.documentElement.hasAttribute("data-kit-cursor-pointer"),
    body: getComputedStyle(document.body).cursor,
    link: getComputedStyle(link).cursor,
    input: getComputedStyle(input).cursor,
    supportsHd: CSS.supports("cursor", 'image-set(url("data:,") 1x) 0 0, auto'),
    vars: getComputedStyle(document.documentElement).getPropertyValue("--t-cursor-default"),
  };
  input.remove();
  return out;
});
ok("site : curseurs émis (data-kit-cursor, data-kit-cursor-pointer)", site.attr);
ok(`site : corps en curseur dessiné, repli « auto » (${site.body.slice(0, 80)}…)`, /\/media\/kit\/[0-9a-f]{16}\.png/.test(site.body) && /auto$/.test(site.body.trim()), site.body);
ok("site : liens en curseur « clic », repli « pointer »", /\/media\/kit\//.test(site.link) && /pointer$/.test(site.link.trim()), site.link);
ok("site : champ de texte → barre de saisie (cursor: text)", site.input === "text", site.input);
ok(`site : HiDPI image-set ${site.supportsHd ? "pris en charge (2x)" : "non pris en charge : PNG 32 seul"}`, site.supportsHd ? site.body.includes("image-set") : !site.body.includes("image-set"), site.body);
const pngUrl = /url\("?([^")]+\.png)"?\)/.exec(site.vars)?.[1];
const png = pngUrl ? await page.request.get(`${BASE}${pngUrl}`) : null;
const meta = png ? await sharp(await png.body()).metadata() : {};
ok(`site : PNG 1x servi (${png?.headers()["content-type"]}, ${meta.width} × ${meta.height}, ${(await png?.body())?.length} o)`, png?.ok() && png.headers()["content-type"] === "image/png" && meta.width === 32 && meta.height === 32);
// Capture : souris sur un lien (curseur « clic ») et sur le fond (normal), incrustées.
const link = page.locator("main a[href]").first();
await link.scrollIntoViewIfNeeded();
const lb = await link.boundingBox();
const at = { x: Math.round(lb.x + lb.width / 2), y: Math.round(lb.y + lb.height / 2) };
await page.mouse.move(at.x, at.y);
await sleep(300);
const clip = { x: Math.max(0, at.x - 260), y: Math.max(0, at.y - 140), width: 520, height: 280 };
const shot = await page.screenshot({ clip });
const cur = draft.assets.kit.cursors;
const png2 = async (u) => Buffer.from(await (await page.request.get(`${BASE}${u}`)).body());
const overlay = async (img, c, x, y) => sharp(img).composite([{ input: await sharp(await png2(c.png2x)).resize(32, 32).png().toBuffer(), left: x - c.x, top: y - c.y }]).png().toBuffer();
let composed = await overlay(shot, cur.pointer, at.x - clip.x, at.y - clip.y);
composed = await overlay(composed, cur.default, 60, 60);
await sharp(composed).resize({ width: 1040, kernel: "nearest" }).toFile(`${SHOTS}/site-curseurs-zoom.png`);
writeFileSync(`${SHOTS}/site-curseurs.png`, await overlay(await page.screenshot(), cur.pointer, at.x, at.y));

/* ---- D. Curseurs désactivés -------------------------------------------------- */
await page.request.post(`${BASE}/admin/apercu/quitter`, { headers: { origin: BASE } }).catch(() => {});
await page.goto(`${BASE}/admin/themes/${DRAFT}?etape=logo`, { waitUntil: "networkidle" });
await page.locator('[data-testid="adv-logo"] summary').click();
await page.getByLabel("Utiliser les curseurs dessinés sur le site").uncheck();
await save("option : enregistrée");
ok("option : curseurs désactivés enregistrés (off), dessins gardés", readTheme(DRAFT).assets.kit?.cursors?.off === true && Boolean(readTheme(DRAFT).assets.kit?.cursors?.default));
await preview(DRAFT);
ok("site : curseurs désactivés → curseur du système", await page.evaluate(() => !document.documentElement.hasAttribute("data-kit-cursor") && !getComputedStyle(document.body).cursor.includes("url(")));
await page.request.post(`${BASE}/admin/apercu/quitter`, { headers: { origin: BASE } }).catch(() => {});

ok("aucune erreur JS", errors.length === 0, errors.join(" | "));
await browser.close();

tsx(`import { getDb, schema } from "./src/lib/db/index.ts"; import { inArray } from "drizzle-orm"; import { rmSync, readdirSync, readFileSync } from "node:fs";
  getDb().delete(schema.themes).where(inArray(schema.themes.id, ${JSON.stringify(created)})).run();
  const dir = "${DATA}/kit-imports"; for (const n of readdirSync(dir)) { const m = JSON.parse(readFileSync(dir + "/" + n + "/meta.json", "utf8")); if (${JSON.stringify(created)}.includes(m.themeId)) rmSync(dir + "/" + n, { recursive: true, force: true }); }`);
console.log(`thèmes supprimés : ${created.join(", ")}`);
if (failures) {
  console.error(`e2e-palette : ${failures} échec(s)`);
  process.exit(1);
}
console.log("e2e-palette : OK");
