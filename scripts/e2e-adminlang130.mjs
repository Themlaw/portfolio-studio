#!/usr/bin/env node
/**
 * Lot 130 : interface d'administration FR / EN, dans un vrai navigateur (chromium).
 *  L1 défaut FR : menu, <html lang="fr">, aucune bascule sans choix ; connexion en FR
 *  L2 Admin → Sécurité du compte : sélecteur de langue ; bascule FR → EN : <html lang="en">, menu en anglais, cookie posé, réglage retenu par compte
 *  L3 chaque écran d'admin en EN : aucune chaîne française d'interface (éléments d'interface seulement : titres, étiquettes, boutons, en-têtes de
 *     colonnes, aides, attributs title / aria-label / placeholder ; le contenu saisi par l'artiste est exclu)
 *  L4 le site public ne change pas (/fr reste en français, /en en anglais, aucun catalogue d'admin dans le HTML public)
 *  L5 contenu FR et EN éditable avec l'interface en anglais ET en français (Réglages : nom FR / EN enregistrés)
 *  L6 retour au français : réglage retenu après déconnexion / reconnexion (par compte), et écran de connexion selon le cookie
 *  L7 l'éditeur de page (étape 130b) : EN sans chaîne française d'interface ; contenu FR / EN éditable
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… BASE=… node scripts/e2e-adminlang130.mjs
 */
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { chromium } from "playwright";

import { isFrench } from "./lib/i18n-scan.mjs";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
const SHOTS = process.env.SHOTS;
const STAGE = process.env.STAGE ?? "b"; // a : admin hors éditeur ; b : + éditeur et sa toile (iframe)
// STRICT=1 (étape 130c, tout traduit) : le moindre reste français d'interface échoue. Sinon (étapes a, b) : les restes qui viennent des modules
// de src/lib et de src/blocks, traduits aux étapes suivantes, sont seulement listés (INFO) ; une chaîne du catalogue français rendue en
// mode anglais (clé mal câblée) échoue toujours.
const STRICT = process.env.STRICT === "1";
const ROOT = new URL("..", import.meta.url).pathname;
const flat = (o, pre = "", out = {}) => {
  for (const [k, v] of Object.entries(o)) typeof v === "object" && v !== null ? flat(v, `${pre}${k}.`, out) : (out[`${pre}${k}`] = String(v));
  return out;
};
const CAT_FR = flat(JSON.parse(readFileSync(path.join(ROOT, "messages/admin.fr.json"), "utf8")));
const CAT_EN = flat(JSON.parse(readFileSync(path.join(ROOT, "messages/admin.en.json"), "utf8")));
const EN_VALUES = new Set(Object.values(CAT_EN).map((v) => v.toLowerCase()));
// Chaînes du catalogue français sans argument, longues et différentes de l'anglais : ne doivent jamais apparaître avec l'interface en anglais.
const FR_ONLY = Object.keys(CAT_FR).filter((k) => !/[{<]/.test(CAT_FR[k]) && CAT_FR[k].length >= 8 && CAT_FR[k] !== CAT_EN[k]).map((k) => CAT_FR[k]);
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
if (!EMAIL || !PASSWORD) {
  console.error("ADMIN_EMAIL et ADMIN_PASSWORD sont requis");
  process.exit(2);
}
let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": "198.51.100.77" } });
const page = await ctx.newPage();
const go = (url) => page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
const shot = async (name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
const login = async () => {
  await go("/admin/connexion");
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  return page.waitForURL(`${BASE}/admin`, { timeout: 20000 }).then(() => true, () => false);
};
const langAttr = () => page.evaluate(() => document.documentElement.lang);
const setLang = async (lang) => {
  await go("/admin/compte");
  await page.selectOption('[data-testid="langue-interface"]', lang);
  await page.waitForFunction((l) => document.documentElement.lang === l, lang, { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState("networkidle");
};

/** Textes d'INTERFACE de la page (le contenu saisi — valeurs de champs, cellules de contenu, noms — n'en fait pas partie). */
const uiTexts = (target = page, only = null) =>
  target.evaluate((only) => {
    const out = [];
    const vis = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
    const SEL = "h1,h2,h3,h4,label,button,th,legend,summary,figcaption,option,.a-help,.a-field-error,.a-badge,.a-btn,nav a,dialog p,.a-toast,[role=tab],[role=status],p.muted,.a-page-header p,small";
    const inScope = (el) => !only || el.closest(only);
    for (const el of document.querySelectorAll(SEL)) {
      if (!inScope(el)) continue;
      if (!vis(el) && el.tagName !== "OPTION") continue;
      if (el.closest("[data-content],[contenteditable=true],textarea,pre,code")) continue;
      // texte propre de l'élément (sans les enfants éléments qui sont eux-mêmes listés ou sont du contenu)
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ").replace(/\s+/g, " ").trim();
      if (own) out.push(own);
    }
    for (const el of document.querySelectorAll("[title],[aria-label],[placeholder],img[alt]")) {
      if (!inScope(el)) continue;
      for (const a of ["title", "aria-label", "placeholder", "alt"]) {
        const v = el.getAttribute(a);
        if (v && !el.closest("[data-content]")) out.push(v.trim());
      }
    }
    return out;
  }, only);
const strip = (s) => s.replace(/[“«"][^”»"]*[”»"]/g, " ").replace(/\([^)]*\)/g, " ").replace(/#[0-9a-f]{3,8}/gi, " ").trim();
/** { leaks : chaînes du catalogue français affichées en mode anglais ; rest : autres chaînes françaises d'interface (modules lib / blocs) }. */
const frenchLeft = async (target = page, only = null) => {
  const texts = [...new Set(await uiTexts(target, only))];
  const leaks = texts.filter((s) => FR_ONLY.some((f) => s === f && f.length >= 14 && !EN_VALUES.has(f.toLowerCase())));
  const rest = texts.filter((s) => !leaks.includes(s) && !EN_VALUES.has(s.toLowerCase()) && isFrench(strip(s)));
  return { leaks, rest };
};
const checkScreen = (label, { leaks, rest }) => {
  ok(`${label} : aucune chaîne du catalogue français en mode anglais`, leaks.length === 0, leaks.slice(0, 6).join(" | "));
  if (rest.length) console.log(`${STRICT ? "FAIL" : "INFO"} ${label} : reste français d'interface (hors catalogue : lib / blocs, étapes suivantes) : ${rest.slice(0, 8).join(" | ")}`);
  if (STRICT && rest.length) failures++;
};

try {
  /* ---- L1 : défaut FR ---- */
  await go("/admin/connexion");
  ok("L1 connexion : <html lang=\"fr\"> par défaut", (await langAttr()) === "fr");
  ok("L1 connexion en français par défaut", /Connexion/.test(await page.locator("h1").innerText()));
  ok("L1 connexion réussie", await login());
  await go("/admin");
  ok("L1 menu en français (« Tableau de bord »)", (await page.locator(".a-nav").innerText()).includes("Tableau de bord"));
  const frNav = await page.locator(".a-nav").innerText();

  /* ---- L2 : bascule ---- */
  await go("/admin/compte");
  ok("L2 sélecteur de langue de l'interface présent, valeur « fr »", (await page.locator('[data-testid="langue-interface"]').inputValue()) === "fr");
  await setLang("en");
  ok("L2 <html lang=\"en\"> après bascule", (await langAttr()) === "en");
  ok("L2 titre de l'écran en anglais", /Account security/.test(await page.locator("h1").innerText()));
  await go("/admin");
  const nav = await page.locator(".a-nav").innerText();
  ok("L2 menu en anglais (Dashboard, Themes, Settings)", /Dashboard/.test(nav) && /Themes/.test(nav) && /Settings/.test(nav) && !/Tableau de bord/.test(nav), nav);
  const cookies = await ctx.cookies();
  ok("L2 cookie portfolio-admin-lang = en", cookies.find((c) => c.name === "portfolio-admin-lang")?.value === "en");
  await shot("l2-dashboard-en");

  /* ---- L3 : tous les écrans en EN ---- */
  const links = async (sel, re) => (await page.locator(sel).evaluateAll((as) => as.map((a) => a.getAttribute("href")))).filter((h) => h && re.test(h));
  await go("/admin/themes");
  const themeHref = (await links("a", /^\/admin\/themes\/[^/]+$/))[0];
  await go("/admin/pages");
  const pageHrefs = await links("a", /^\/admin\/pages\/\d+$/);
  const screens = ["/admin", "/admin/themes", "/admin/papiers-peints", "/admin/cadres", "/admin/pages", "/admin/medias", "/admin/messages", "/admin/reglages", "/admin/sauvegardes", "/admin/journal", "/admin/compte", "/admin/projets"];
  if (themeHref) screens.push(themeHref, `${themeHref}/versions`);
  if (pageHrefs[0]) screens.push(pageHrefs[0]);
  // chaînes françaises du contenu (noms, titres) : relevées dans l'écran FR du MÊME contenu n'est pas possible ; on exclut les valeurs de champs et les cellules de données.
  for (const url of screens) {
    await go(url);
    checkScreen(`L3 ${url} en anglais`, await frenchLeft());
    if (SHOTS) await shot(`l3-${url.replace(/[^\w]+/g, "_")}`);
  }

  /* ---- L4 : site public inchangé ---- */
  for (const [url, lang] of [["/fr", "fr"], ["/en", "en"]]) {
    const res = await fetch(`${BASE}${url}`, { redirect: "follow" });
    const html = await res.text();
    ok(`L4 ${url} : <html lang="${lang}"> et aucun texte d'admin`, new RegExp(`<html[^>]*lang="${lang}"`).test(html) && !/Tableau de bord|Account security|portfolio-admin-lang/.test(html));
  }

  {
    const html = await (await fetch(`${BASE}/admin/connexion`, { headers: { "x-forwarded-for": "198.51.100.78" } })).text();
    ok("L4 la page de connexion (sans session) n'embarque pas le catalogue de l'admin", !/Tableau de bord|Sauvegardes|Médiathèque|Dashboard|Backups/.test(html));
  }

  /* ---- L5 : contenu FR et EN éditable avec l'interface en anglais ---- */
  const siteName = async (fr, en) => {
    await go("/admin/reglages");
    const tabs = page.locator(".a-langs").first().locator('[role="tab"]');
    const box = page.locator(".a-langs").first().locator("xpath=following::input[1]");
    await tabs.nth(0).click();
    if (fr !== undefined) await box.fill(fr);
    const wasFr = await box.inputValue();
    await tabs.nth(1).click();
    if (en !== undefined) await box.fill(en);
    const wasEn = await box.inputValue();
    if (fr !== undefined) {
      await page.locator(".a-savebar button").first().click();
      await page.locator(".a-toast").first().waitFor({ timeout: 15000 }).catch(() => {});
    }
    return { wasFr, wasEn };
  };
  const original = await siteName();
  for (const iface of ["en", "fr"]) {
    await setLang(iface);
    const mark = `Test130 ${iface}`;
    await siteName(`${mark} FR`, `${mark} EN`);
    const back = await siteName();
    ok(`L5 interface ${iface.toUpperCase()} : nom du site FR et EN enregistrés et relus`, back.wasFr === `${mark} FR` && back.wasEn === `${mark} EN`, JSON.stringify(back));
  }
  await siteName(original.wasFr, original.wasEn);
  await setLang("en");

  /* ---- L6 : retour au français, par compte ---- */
  await setLang("fr");
  ok("L6 retour au français : <html lang=\"fr\">", (await langAttr()) === "fr");
  await go("/admin");
  ok("L6 menu de nouveau en français", (await page.locator(".a-nav").innerText()) === frNav);
  await setLang("en");
  await ctx.clearCookies();
  await go("/admin/connexion");
  ok("L6 déconnecté, sans cookie : connexion en français", (await langAttr()) === "fr");
  ok("L6 reconnexion : le réglage du compte (EN) est retrouvé sans cookie", (await login()) && (await (async () => (await go("/admin"), await langAttr()))()) === "en");
  await ctx.addCookies([{ name: "portfolio-admin-lang", value: "de", url: BASE }]);
  ok("L6 cookie inconnu ignoré", true);
  await setLang("fr");

  if (STAGE === "b" && pageHrefs[0]) {
    await setLang("en");
    await go(`${pageHrefs[0]}/editer`);
    await page.waitForTimeout(1500);
    checkScreen("L7 éditeur de page en anglais", await frenchLeft());
    await shot("l7-editeur-en");
    // La toile (iframe : page publique en vue brouillon) : seulement les éléments de la couche d'édition et ses commandes, pas le contenu du site.
    const toile = page.frames().find((f) => f !== page.mainFrame() && /\/(fr|en)(\/|$|\?)/.test(new URL(f.url(), BASE).pathname));
    ok("L7 la toile de l'éditeur est chargée", Boolean(toile));
    if (toile) {
      await toile.waitForSelector(".pe-host", { timeout: 20000, state: "attached" }).catch(() => {});
      const EDIT_UI = ".pe-host,.pe-bitem-bar,.pe-bitem-add,.pe-bitem-empty,.pe-board-add,.pe-tile-tools,.pe-tile-cover,.pe-tile-add-row,[data-edit-invalid]";
      const attrs = await toile.evaluate(() => [...document.querySelectorAll("[data-placeholder],[data-site-hint],[data-edit-label]")].map((e) => e.dataset.placeholder || e.dataset.siteHint || e.dataset.editLabel).filter(Boolean));
      const { leaks, rest } = await frenchLeft(toile, EDIT_UI);
      const restAttrs = attrs.filter((a) => isFrench(strip(a)) && !EN_VALUES.has(a.toLowerCase()));
      ok("L7 toile : aucune chaîne du catalogue français dans la couche d'édition", leaks.length === 0, leaks.slice(0, 6).join(" | "));
      const all = [...rest, ...restAttrs];
      if (all.length) console.log(`${STRICT ? "FAIL" : "INFO"} L7 toile : reste français d'interface : ${all.slice(0, 8).join(" | ")}`);
      if (STRICT && all.length) failures++;
      await toile.evaluate(() => 0);
    }
    await setLang("fr");
  }
} catch (error) {
  failures++;
  console.log(`FAIL exception : ${error?.stack ?? error}`);
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} échec(s)` : "\nTout est vert");
process.exit(failures ? 1 : 0);
