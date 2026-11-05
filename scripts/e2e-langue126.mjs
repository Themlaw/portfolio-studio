#!/usr/bin/env node
/**
 * Lot 126 « français par défaut + sélecteur FR / EN entièrement cliquable » (chromium, serveur requis, base neuve, données SYNTHÉTIQUES
 * du seed ; une connexion admin pour E). Cause du constat « je me retrouve toujours en anglais » : next-intl choisissait la langue de
 * « / » d'après Accept-Language (et son cookie NEXT_LOCALE, posé d'après le même en-tête).
 *  A  Navigateur en Accept-Language: en-US, sans cookie : « / », « /personnages » (sans langue) arrivent en /fr ; /en/… reste en anglais ;
 *     aucun cookie NEXT_LOCALE ; visiter /en/… ne change pas ce que « / » donne ensuite (une adresse n'est pas un choix) ; ancien cookie
 *     NEXT_LOCALE=en ignoré.
 *  B  Choix explicite (clic sur le sélecteur) : « / » arrive ensuite en /en, retour en FR : « / » arrive en /fr ; cookie illisible ignoré ;
 *     un lien /fr/… reste en français même avec le choix EN.
 *  C  Clic AU BORD de la case (pas sur une lettre) : bascule, même page, même position (+- 150 px) ; un seul contrôle visible, un seul lien ;
 *     nom accessible « English version » / « Version française » ; la langue courante reste mise en avant.
 *  D  Clavier : Tab jusqu'au contrôle (un seul arrêt), anneau de focus visible, Entrée bascule.
 *  E  390 px tactile : zone de clic >= 44 px de haut (et de large), clic au bord, menu burger ouvert ; la case reste dans l'en-tête.
 *  F  hreflang : x-default -> français (page et plan du site) ; /robots.txt cite le plan du site.
 *  G  Éditeur visuel : sa bascule FR / EN fonctionne toujours (aria-pressed) et ne pose pas le cookie du site public.
 *  H  aucune erreur JavaScript de page.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=A,B,…] node scripts/e2e-langue126.mjs
 */
import { chromium } from "playwright";

import { canvas } from "./lib/grille31d.mjs";
import { login, pageIdOf } from "./lib/medias-setup.mjs";

const BASE = process.env.BASE ?? "http://localhost:3800";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const COOKIE = "portfolio-lang";
let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const info = (label) => console.log(`INFO ${label}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ args: ["--disable-gpu", "--disable-extensions"] });
const errors = [];

async function open(opts = {}, url = null) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US", extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" }, ...opts });
  const p = await ctx.newPage();
  p.setDefaultTimeout(45000);
  p.on("pageerror", (e) => errors.push(e.message));
  if (url) await p.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
  return p;
}
const path = (p) => new URL(p.url()).pathname;
const cookies = async (p) => Object.fromEntries((await p.context().cookies()).map((c) => [c.name, c.value]));
/** Redirection de « url » sans la suivre : { status, location }. */
async function hop(url, headers = {}) {
  const r = await fetch(`${BASE}${url}`, { redirect: "manual", headers });
  return { status: r.status, location: r.headers.get("location") ? new URL(r.headers.get("location"), BASE).pathname : null };
}
const SW = "header.site-header [data-locale-switcher]:visible";
const farDown = async (p, y = 1200) => {
  await p.evaluate((t) => scrollTo({ top: t, behavior: "instant" }), y);
  await sleep(400);
  return p.evaluate(() => Math.round(scrollY));
};
/** Boîte du contrôle visible, et un point à son bord gauche / droit (hors de toute lettre). */
const boxOf = async (p) => (await p.locator(SW).first().boundingBox());
/** x des lettres FR et EN (pour s'assurer que le clic de bord n'est pas sur une lettre). */
const letters = (p) => p.evaluate(() => [...document.querySelectorAll("header.site-header [data-locale-switcher]")].filter((a) => a.getClientRects().length).flatMap((a) => [...a.querySelectorAll("span[data-active], span.text-ink-soft")].map((s) => { const r = s.getBoundingClientRect(); return [r.left, r.right]; })));

/* ---- A. Premier passage : français, quel que soit le navigateur -------------------------------------------------------------- */
if (run("A")) {
  const p = await open();
  await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
  ok("A1 Accept-Language en-US, sans cookie : « / » arrive en /fr", path(p) === "/fr", path(p));
  ok("A1b la page est en français (<html lang>)", (await p.evaluate(() => document.documentElement.lang)) === "fr");
  await p.goto(`${BASE}/personnages`, { waitUntil: "domcontentloaded" });
  ok("A2 adresse sans langue : /fr/…", path(p).startsWith("/fr"), path(p));
  await p.goto(`${BASE}/en`, { waitUntil: "networkidle" });
  ok("A3 /en reste en anglais (adresse explicite)", path(p) === "/en" && (await p.evaluate(() => document.documentElement.lang)) === "en", path(p));
  await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
  ok("A4 après avoir VU /en, « / » donne encore /fr (une adresse n'est pas un choix)", path(p) === "/fr", path(p));
  const c = await cookies(p);
  ok("A5 aucun cookie de langue posé par la simple navigation", !("NEXT_LOCALE" in c) && !(COOKIE in c), JSON.stringify(Object.keys(c)));
  const old = await hop("/", { "Accept-Language": "en-US,en;q=0.9", Cookie: "NEXT_LOCALE=en" });
  ok("A6 ancien cookie NEXT_LOCALE=en ignoré : « / » -> /fr", old.location === "/fr", JSON.stringify(old));
  const fr = await hop("/", { "Accept-Language": "de-DE,de;q=0.9,en;q=0.8" });
  ok("A7 autre langue de navigateur : /fr", fr.location === "/fr", JSON.stringify(fr));
  await p.context().close();
}

/* ---- B. Choix explicite : retenu pour « / » seulement ------------------------------------------------------------------------- */
if (run("B")) {
  const en = await hop("/", { Cookie: `${COOKIE}=en`, "Accept-Language": "fr-FR" });
  ok("B1 cookie portfolio-lang=en : « / » -> /en", en.location === "/en", JSON.stringify(en));
  const enPath = await hop("/personnages", { Cookie: `${COOKIE}=en` });
  ok("B2 adresse sans langue avec choix EN : /en/…", enPath.location === "/en/personnages", JSON.stringify(enPath));
  for (const v of ["fr", "xx", "EN", "en%00", ""]) {
    const r = await hop("/", { Cookie: `${COOKIE}=${v}`, "Accept-Language": "en-US" });
    ok(`B3 cookie « ${v} » : « / » -> /fr`, r.location === "/fr", JSON.stringify(r));
  }
  const explicit = await fetch(`${BASE}/fr/personnages`, { redirect: "manual", headers: { Cookie: `${COOKIE}=en` } });
  ok("B4 /fr/… reste en français malgré le choix EN (200, pas de redirection)", explicit.status === 200, String(explicit.status));
  const vary = await fetch(`${BASE}/`, { redirect: "manual", headers: { Cookie: `${COOKIE}=en` } });
  ok("B5 la redirection dépendant du cookie n'est pas mise en cache partagée", /cookie/i.test(vary.headers.get("vary") ?? "") && /no-store|private/.test(vary.headers.get("cache-control") ?? ""), `${vary.headers.get("vary")} / ${vary.headers.get("cache-control")}`);

  // Parcours réel : clic sur le sélecteur, puis retour sur « / ».
  const p = await open({}, "/fr/personnages");
  await p.locator(SW).first().click();
  await p.waitForURL(/\/en\//, { timeout: 30000 });
  ok("B6 clic sur le sélecteur : cookie de choix = en", (await cookies(p))[COOKIE] === "en", JSON.stringify(await cookies(p)));
  await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
  ok("B7 retour sur « / » après avoir choisi EN : /en", path(p) === "/en", path(p));
  await p.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  ok("B8 une adresse /fr explicite reste en français", path(p) === "/fr");
  await p.locator(SW).first().click();
  await p.waitForURL((u) => u.pathname.startsWith("/en"), { timeout: 30000 });
  await p.locator(SW).first().click();
  await p.waitForURL((u) => u.pathname.startsWith("/fr"), { timeout: 30000 });
  ok("B9 retour au français par le sélecteur : cookie = fr", (await cookies(p))[COOKIE] === "fr");
  await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
  ok("B10 puis « / » -> /fr", path(p) === "/fr", path(p));
  await p.context().close();
}

/* ---- C. Toute la case est la zone de clic ------------------------------------------------------------------------------------- */
if (run("C")) {
  const p = await open({}, "/fr/personnages");
  const n = await p.locator("[data-locale-switcher]").count();
  const visible = await p.locator("[data-locale-switcher]:visible").count();
  ok("C1 un seul contrôle de langue visible à 1440 px (lien unique, pas deux liens)", visible === 1, `${visible} visibles sur ${n}`);
  ok("C2 nom accessible en français : « English version »", (await p.getByRole("link", { name: "English version" }).count()) >= 1);
  ok("C2b langue de la cible déclarée (lang=en, hreflang=en)", (await p.locator(`${SW}[lang=en][hreflang=en]`).count()) === 1);
  const active = await p.evaluate(() => [...document.querySelectorAll("header.site-header [data-locale-switcher]")].filter((a) => a.getClientRects().length).map((a) => a.querySelector("[data-active]")?.textContent));
  ok("C3 la langue courante (FR) reste mise en avant", active[0] === "FR", JSON.stringify(active));
  const box = await boxOf(p);
  const ls = await letters(p);
  info(`case ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)} ; lettres ${JSON.stringify(ls.map((l) => l.map(Math.round)))}`);
  const y0 = await farDown(p);
  // Bord gauche : avant la première lettre ; on clique 3 px dans la case.
  const edgeX = box.x + 3;
  ok("C4 le point de clic de bord n'est sur aucune lettre", !ls.some(([a, b]) => edgeX >= a && edgeX <= b), `x=${edgeX}`);
  await p.mouse.click(edgeX, box.y + box.height / 2);
  await p.waitForURL(/\/en\//, { timeout: 30000 });
  await sleep(1500);
  const y1 = await p.evaluate(() => Math.round(scrollY));
  ok("C5 clic au bord : bascule en EN, même page (slug anglais)", path(p) === "/en/characters", path(p));
  ok("C6 même position (+- 150 px)", Math.abs(y1 - y0) <= 150 && y1 > 600, `avant ${y0}, après ${y1}`);
  ok("C7 nom accessible en anglais : « Version française »", (await p.getByRole("link", { name: "Version française" }).count()) >= 1);
  const active2 = await p.evaluate(() => document.querySelector("header.site-header [data-locale-switcher]:not([hidden])")?.querySelector("[data-active]")?.textContent);
  ok("C8 en EN, la langue courante (EN) est en avant", active2 === "EN" || (await p.locator(`${SW} [data-active]`).first().textContent()) === "EN");
  // Entre les lettres (la barre oblique) et bord droit, dans l'autre sens.
  const b2 = await boxOf(p);
  const l2 = await letters(p);
  const gapX = l2.length >= 2 ? (l2[0][1] + l2[1][0]) / 2 : b2.x + b2.width / 2;
  await p.mouse.click(gapX, b2.y + b2.height / 2);
  await p.waitForURL(/\/fr\//, { timeout: 30000 });
  ok("C9 clic sur la barre oblique entre les lettres : retour en FR, même page", path(p) === "/fr/personnages", path(p));
  const b3 = await boxOf(p);
  await p.mouse.click(b3.x + b3.width - 3, b3.y + b3.height / 2);
  await p.waitForURL(/\/en\//, { timeout: 30000 });
  ok("C10 clic au bord droit : bascule", path(p) === "/en/characters", path(p));
  // Zone de clic dépassant la case en hauteur (sans changer la mise en page).
  const b4 = await boxOf(p);
  const hit = await p.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest("[data-locale-switcher]"), { x: b4.x + b4.width / 2, y: b4.y + b4.height / 2 - 20 });
  ok("C11 zone de clic : 20 px au-dessus du centre porte encore le contrôle", hit);
  await p.context().close();
  // Page sans équivalent : la bascule garde son comportement (navigation normale).
  const q = await open({}, "/fr/page-qui-n-existe-pas");
  await q.locator(SW).first().click();
  await q.waitForURL((u) => u.pathname.startsWith("/en"), { timeout: 30000 });
  ok("C12 page introuvable : la bascule fonctionne", path(q).startsWith("/en"), path(q));
  await q.context().close();
}

/* ---- D. Clavier --------------------------------------------------------------------------------------------------------------- */
if (run("D")) {
  const p = await open({}, "/fr/personnages");
  let reached = 0;
  let stops = 0;
  for (let i = 0; i < 40 && !reached; i++) {
    await p.keyboard.press("Tab");
    const on = await p.evaluate(() => document.activeElement?.hasAttribute("data-locale-switcher") ?? false);
    if (on) reached = i + 1;
  }
  ok("D1 Tab atteint le sélecteur", reached > 0, `après ${reached} Tab`);
  const ring = await p.evaluate(() => {
    const el = document.activeElement;
    const cs = getComputedStyle(el);
    return { matches: el.matches(":focus-visible"), style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
  });
  ok("D2 anneau de focus visible au clavier", ring.matches && ring.style !== "none" && ring.width >= 1, JSON.stringify(ring));
  // Un seul arrêt : le Tab suivant quitte le contrôle et ne retombe pas dessus.
  await p.keyboard.press("Tab");
  stops = await p.evaluate(() => document.activeElement?.hasAttribute("data-locale-switcher") ? 1 : 0);
  ok("D3 un seul arrêt de tabulation pour FR / EN", stops === 0);
  await p.keyboard.press("Shift+Tab");
  await p.keyboard.press("Enter");
  await p.waitForURL(/\/en\//, { timeout: 30000 });
  ok("D4 Entrée bascule vers l'anglais", path(p) === "/en/characters", path(p));
  ok("D5 le choix au clavier est retenu aussi", (await cookies(p))[COOKIE] === "en");
  await p.context().close();
}

/* ---- E. Téléphone ------------------------------------------------------------------------------------------------------------- */
if (run("E")) {
  const p = await open({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, "/fr/personnages");
  const visible = await p.locator("[data-locale-switcher]:visible").count();
  ok("E1 un seul contrôle visible à 390 px", visible === 1, String(visible));
  const box = await boxOf(p);
  const reach = await p.evaluate(({ x, y }) => {
    const inside = (yy) => !!document.elementFromPoint(x, yy)?.closest("[data-locale-switcher]");
    let up = 0;
    while (up < 60 && inside(y - up - 1)) up++;
    let down = 0;
    while (down < 60 && inside(y + down + 1)) down++;
    return up + down + 1;
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  ok("E2 hauteur de la zone de clic >= 44 px", reach >= 44, `${reach} px (case ${Math.round(box.height)})`);
  ok("E3 largeur de la zone de clic >= 44 px", box.width >= 44, `${Math.round(box.width)} px`);
  const inHeader = await p.evaluate(() => { const h = document.querySelector("header.site-header").getBoundingClientRect(); return h.height; });
  info(`hauteur de l'en-tête à 390 px : ${Math.round(inHeader)} px`);
  const noScroll = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  ok("E4 pas de défilement horizontal", noScroll);
  const ys = await farDown(p, 900);
  await p.tap(SW);
  await p.waitForURL(/\/en\//, { timeout: 30000 });
  await sleep(1500);
  const y1 = await p.evaluate(() => Math.round(scrollY));
  ok("E5 appui tactile : bascule, même page, même position (+- 150 px)", path(p) === "/en/characters" && Math.abs(y1 - ys) <= 150, `${path(p)} avant ${ys}, après ${y1}`);
  // Menu burger ouvert : le sélecteur reste utilisable.
  await p.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
  await p.locator("header.site-header button[aria-controls=nav-mobile]").click();
  await sleep(500);
  const b = await boxOf(p);
  await p.mouse.click(b.x + 3, b.y + b.height / 2);
  await p.waitForURL(/\/fr\//, { timeout: 30000 });
  ok("E6 burger ouvert, clic au bord : retour en FR", path(p) === "/fr/personnages", path(p));
  await p.context().close();
}

/* ---- F. hreflang et plan du site ---------------------------------------------------------------------------------------------- */
if (run("F")) {
  const html = await (await fetch(`${BASE}/fr/personnages`)).text();
  const links = [...html.matchAll(/<link rel="alternate" hrefLang="([a-zA-Z-]+)" href="([^"]+)"/g)].map((m) => [m[1], new URL(m[2], BASE).pathname]);
  const map = Object.fromEntries(links);
  ok("F1 hreflang fr, en et x-default sur la page", map.fr && map.en && map["x-default"], JSON.stringify(links));
  ok("F2 x-default -> la version française", map["x-default"] === map.fr && map["x-default"] === "/fr/personnages", JSON.stringify(map));
  const enHtml = await (await fetch(`${BASE}/en/characters`)).text();
  const enMap = Object.fromEntries([...enHtml.matchAll(/<link rel="alternate" hrefLang="([a-zA-Z-]+)" href="([^"]+)"/g)].map((m) => [m[1], new URL(m[2], BASE).pathname]));
  ok("F3 sur la page anglaise aussi : x-default -> /fr/personnages", enMap["x-default"] === "/fr/personnages", JSON.stringify(enMap));
  const sm = await (await fetch(`${BASE}/sitemap.xml`)).text();
  ok("F4 plan du site : x-default présent et français", /hreflang="x-default" href="[^"]*\/fr\/personnages"/.test(sm) || /xhtml:link[^>]*hreflang="x-default"[^>]*href="[^"]*\/fr\//.test(sm), sm.slice(0, 300));
  const robots = await (await fetch(`${BASE}/robots.txt`)).text();
  ok("F5 robots.txt cite le plan du site", /sitemap:/i.test(robots));
}

/* ---- G. Éditeur --------------------------------------------------------------------------------------------------------------- */
if (run("G")) {
  const p = await open({ locale: "fr-FR", extraHTTPHeaders: {} });
  await login(p, BASE);
  const id = pageIdOf("personnages");
  await p.goto(`${BASE}/admin/pages/${id}/editer`, { waitUntil: "domcontentloaded" });
  await canvas(p);
  const group = p.getByRole("group", { name: "Langue" });
  const en = group.getByRole("button", { name: "EN", exact: true });
  const fr = group.getByRole("button", { name: "FR", exact: true });
  ok("G1 éditeur : FR actif au départ", (await fr.getAttribute("aria-pressed")) === "true");
  await en.click();
  await sleep(2500);
  ok("G2 bascule EN de l'éditeur", (await en.getAttribute("aria-pressed")) === "true" && (await fr.getAttribute("aria-pressed")) === "false");
  await fr.click();
  await sleep(2500);
  ok("G3 retour FR dans l'éditeur", (await fr.getAttribute("aria-pressed")) === "true");
  ok("G4 la bascule de l'éditeur ne pose pas le cookie du site public", !((COOKIE) in (await cookies(p))), JSON.stringify(await cookies(p)));
  await p.context().close();
}

/* ---- H ------------------------------------------------------------------------------------------------------------------------ */
ok("H aucune erreur JavaScript de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
