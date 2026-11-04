#!/usr/bin/env node
/**
 * Lot 109 « renommer un lien du menu, à la souris ET au toucher » (chromium, serveur requis, base neuve, données SYNTHÉTIQUES).
 * Pour chaque profil (souris 1024, toucher 1024, souris 390, toucher 390 ; `hasTouch` + `isMobile` pour le toucher) :
 *  B  le bouton « Renommer » de la barre du lien (survol, ou appui) ouvre la saisie ; Entrée valide : libellé visible dans l'en-tête de
 *     l'éditeur, écrit dans le brouillon du site (site-op via le chemin existant), survit au rechargement
 *  E  Échap annule (libellé inchangé, rien d'écrit)
 *  D  double-clic (souris) / double-tap (toucher) sur le libellé ouvre la saisie
 *  T  un simple appui ne lance pas la saisie ; un glisser non plus
 *  P  (souris 1024) publié : le libellé est dans l'en-tête public
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=P1,P2…] [SHOTS=dossier] node scripts/e2e-menu109.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { login, openEditor, pageIdOf, settled, sleep, sql, waitFor } from "./lib/grille31d.mjs";

const BASE = process.env.BASE ?? "http://localhost:3960";
const ONLY = process.env.ONLY || process.env.BATT_MENU109 || "";
const SHOTS = process.env.SHOTS ?? path.join(process.env.BATTERY_DIR ?? tmpdir(), "shots-menu109");
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${String(detail).slice(0, 500)}` : ""}`);
};
const T = (s) => ({ fr: s, en: s });
const setting = (key) => {
  const row = sql((db) => db.prepare("select value from settings where key = ?").get(key));
  return row ? JSON.parse(row.value) : null;
};
const siteDraft = () => setting("siteDraft");
const reset = () =>
  sql((db) => {
    db.prepare("delete from settings where key in ('siteDraft','siteDraftRev')").run();
    db.prepare("update pages set draft = null, draft_updated_at = null where draft is not null").run();
    const row = db.prepare("select value from settings where key = 'nav'").get();
    const nav = (row ? JSON.parse(row.value) : []).filter((i) => !(i.kind === "link" && String(i.href).includes("menu109")));
    nav.push({ kind: "link", href: "https://example.test/menu109", label: T("Lien Test109") });
    db.prepare("insert into settings (key, value) values ('nav', ?) on conflict(key) do update set value = excluded.value").run(JSON.stringify(nav));
  });
const draftLabels = () => (siteDraft()?.snap?.nav ?? []).map((i) => i.label?.fr);

const PROFILES = [
  { id: "m1024", touch: false, w: 1024, h: 800 },
  { id: "t1024", touch: true, w: 1024, h: 800 },
  { id: "m390", touch: false, w: 390, h: 800 },
  { id: "t390", touch: true, w: 390, h: 800 },
];

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const A = pageIdOf("personnages");
const ITEM = '[data-edit-global="header"] [data-nav-item]';
const FIELD = '[data-edit-global="header"] [data-nav-item] [data-site-inline="nav"]';

for (const P of PROFILES) {
  if (ONLY && !ONLY.split(",").includes(P.id)) continue;
  const ctx = await browser.newContext({ viewport: { width: P.w, height: P.h }, ...(P.touch ? { hasTouch: true, isMobile: true } : {}) });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const tag = (s) => `${P.id} ${s}`;
  const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${P.id}-${name}.png`) }).catch(() => {});
  try {
    reset();
    await login(page, BASE);
    let f = await openEditor(page, BASE, A);
    await settled(page);
    const field = () => f.locator(FIELD).filter({ hasText: /Test109|Nouveau109|Annule109/ }).first();
    const item = () => f.locator(ITEM).filter({ hasText: /Test109|Nouveau109|Annule109/ }).first();
    const visible = await item().isVisible().catch(() => false);
    ok(tag("0 le lien du menu est visible et atteignable dans l'en-tête de l'éditeur"), visible);
    await shot("depart");
    if (!visible) {
      console.log("debug", JSON.stringify(await f.evaluate(() => ({ w: innerWidth, items: [...document.querySelectorAll("[data-nav-item]")].map((e) => [e.textContent, e.getBoundingClientRect().width, getComputedStyle(e).display]), header: document.querySelector("[data-edit-global=header]")?.outerHTML.slice(0, 600) }))));
      continue;
    }
    const editing = () => f.locator('[data-site-inline="nav"][data-editing]').count();
    const open = async () => (P.touch ? item().tap() : item().hover());
    const R = () => f.locator('[data-testid="nav-rename"]');
    /* B : bouton Renommer */
    await open();
    await R().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    ok(tag("B1 le bouton « Renommer » (infobulle) est sur la barre du lien"), (await R().count()) === 1 && /Renommer/.test((await R().getAttribute("title")) ?? ""));
    await shot("barre");
    if (P.touch) await R().tap();
    else await R().click();
    await waitFor(async () => (await editing()) === 1, 8000);
    ok(tag("B2 …ouvre la saisie en place du libellé"), (await editing()) === 1);
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Nouveau109");
    await page.keyboard.press("Enter");
    await settled(page);
    ok(tag("B3 Entrée valide : le nouveau libellé est dans l'en-tête de l'éditeur"), (await field().textContent())?.trim() === "Nouveau109", await field().textContent());
    ok(tag("B4 …et dans le brouillon du site"), draftLabels().includes("Nouveau109"), JSON.stringify(draftLabels()));
    f = await openEditor(page, BASE, A);
    await settled(page);
    ok(tag("B5 …il survit au rechargement"), (await field().textContent())?.trim() === "Nouveau109");
    ok(tag("B6 …l'éditeur n'a pas de saisie restée ouverte"), (await editing()) === 0);
    /* E : Échap annule */
    await open();
    await R().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    if (P.touch) await R().tap();
    else await R().click();
    await waitFor(async () => (await editing()) === 1, 8000);
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Annule109");
    await page.keyboard.press("Escape");
    await sleep(900);
    await settled(page);
    ok(tag("E1 Échap annule : libellé inchangé"), (await field().textContent())?.trim() === "Nouveau109", await field().textContent());
    ok(tag("E2 …rien d'écrit"), !draftLabels().includes("Annule109"), JSON.stringify(draftLabels()));
    ok(tag("E3 …saisie fermée"), (await editing()) === 0);
    /* T : un simple appui ne lance pas la saisie */
    if (P.touch) {
      await item().tap();
      await sleep(600);
      ok(tag("T1 un simple appui ne lance pas la saisie"), (await editing()) === 0);
      const box = await field().boundingBox();
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      // Deux appuis espacés de plus de 350 ms : pas un double-tap.
      await page.touchscreen.tap(cx, cy);
      await sleep(700);
      await page.touchscreen.tap(cx, cy);
      await sleep(500);
      ok(tag("T2 deux appuis espacés ne lancent pas la saisie"), (await editing()) === 0);
      // Glisser (doigt qui bouge) entre deux appuis.
      const cdp = await ctx.newCDPSession(page);
      const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
      await touch("touchStart", cx, cy);
      await touch("touchEnd", cx, cy);
      await touch("touchStart", cx, cy);
      await touch("touchMove", cx + 40, cy + 40);
      await touch("touchEnd", cx + 40, cy + 40);
      await sleep(500);
      ok(tag("T3 un appui puis un glisser ne lancent pas la saisie"), (await editing()) === 0);
    } else {
      await item().click();
      await sleep(400);
      ok(tag("T1 un simple clic ne lance pas la saisie"), (await editing()) === 0);
    }
    /* D : double-clic / double-tap */
    if (P.touch) {
      const box = await field().boundingBox();
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await page.touchscreen.tap(cx, cy);
      await sleep(80);
      await page.touchscreen.tap(cx, cy);
    } else await field().dblclick();
    await waitFor(async () => (await editing()) === 1, 8000);
    ok(tag(`D1 ${P.touch ? "double-tap" : "double-clic"} sur le libellé : la saisie s'ouvre`), (await editing()) === 1);
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("Nouveau109 bis");
    await page.keyboard.press("Enter");
    await settled(page);
    ok(tag("D2 …Entrée valide le libellé"), (await field().textContent())?.trim() === "Nouveau109 bis" && draftLabels().includes("Nouveau109 bis"), `${await field().textContent()} ${JSON.stringify(draftLabels())}`);
    await shot("fin");
    /* P : publié */
    if (P.id === "m1024") {
      await page.getByRole("button", { name: "Publier", exact: true }).click();
      await page.getByText(/^Publié/).first().waitFor({ timeout: 120000 }).catch(() => {});
      await sleep(1500);
      const nav = setting("nav") ?? [];
      ok(tag("P1 publié : le menu public porte le libellé"), nav.some((i) => i.label?.fr === "Nouveau109 bis"), JSON.stringify(nav.map((i) => i.label?.fr)));
      const pub = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const pp = await pub.newPage();
      await pp.goto(`${BASE}/fr`, { waitUntil: "domcontentloaded" });
      ok(tag("P2 …et l'en-tête public le montre"), ((await pp.locator(".site-header").first().textContent()) ?? "").includes("Nouveau109 bis"));
      await pub.close();
    }
    ok(tag("Z aucune erreur JS"), errors.length === 0, errors.join(" | "));
  } catch (e) {
    ok(tag("exception inattendue"), false, String(e.message).split("\n").slice(0, 6).join(" "));
    await shot("erreur");
  }
  await ctx.close();
}
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
