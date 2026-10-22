#!/usr/bin/env node
/**
 * Lot 63 « modifier ses pages avec un autre thème » (chromium, base neuve, une connexion admin).
 *  A  Éditeur : menu « Thème : <nom> ▾ » (en ligne d'abord), recherche, choix d'un autre thème = préparation sans quitter la page ni perdre le brouillon.
 *  B  Dernier usage : le menu classe par dernier usage (en ligne, puis les derniers préparés) ; valeur gardée côté serveur.
 *  C  Revenir au thème en ligne depuis le menu = fin de l'aperçu.
 *  D  Écran Thèmes : « Travailler au brouillon dessus » sur les cartes non en ligne, ouvre l'éditeur (dernière page éditée, sinon l'accueil) sur ce thème.
 *  F  Barre du haut en préparation avec brouillon : « Publier » visible, pas de débordement (1440, 1280, 1024 px).
 *  E  Pastille « En travail » (orange, lisible) et encadré orange sur la carte en préparation ; le bouton « éditer » de l'aperçu reste.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=A,B,…] [SHOTS=dossier] node scripts/e2e-essayer63.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { canvas, draftBlocks, pageIdOf, q1, setDraft, sleep, sql, waitFor } from "./lib/grille31d.mjs";
import { login } from "./lib/medias-setup.mjs";

const BASE = process.env.BASE ?? "http://localhost:3770";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(tmpdir(), "e2e-essayer63");
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const setting = (key) => {
  const v = q1("select value from settings where key = ?", key)?.value;
  return v === undefined ? null : JSON.parse(v);
};
const themeName = (id) => JSON.parse(q1("select data from themes where id = ?", id).data).name;

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
page.setDefaultNavigationTimeout(120000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);

const LIVE = setting("activeThemeId") ?? "galerie-lumineuse";
const OTHERS = ["carnet-d-atelier", "studio", "galerie-nocturne"].filter((id) => id !== LIVE && q1("select id from themes where id = ?", id));
const T1 = OTHERS[0];
const T2 = OTHERS[1];
const LIVE_NAME = themeName(LIVE);
const PAGE_ID = pageIdOf("personnages");
const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});
const stopPreview = () => page.request.post(`${BASE}/admin/apercu/quitter`, { form: { retour: "/admin/themes" }, headers: { origin: BASE }, maxRedirects: 0 });
const picker = () => page.locator('[data-testid="theme-picker"]');
const openMenu = async () => {
  await picker().click();
  await page.locator(".ve-theme-list").waitFor();
};
const items = () => page.locator(".ve-theme-item .ve-theme-name").allTextContents();
const editor = async (id) => {
  await page.goto(`${BASE}/admin/pages/${id}/editer`, { waitUntil: "domcontentloaded" });
  const fr = await canvas(page);
  await sleep(1500);
  return fr;
};
const choose = async (id) => {
  await openMenu();
  await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 120000 }), page.locator(`[data-testid="theme-choice-${id}"]`).click()]);
  await canvas(page);
  await sleep(1000);
};
const banner = () => page.locator('[data-testid="preparing-banner"]');

try {
  ok("0 il y a au moins deux autres thèmes pour tester", Boolean(T1 && T2), JSON.stringify(OTHERS));
  await stopPreview();

  /* ---- A ---- */
  if (run("A")) {
    const blocks = [{ uid: "essayer63a", type: "section-title", props: { title: { fr: "Brouillon du lot 63", en: "Lot 63 draft" } } }];
    const before = JSON.stringify(sql((db) => db.prepare("select draft from pages where id = ?").get(PAGE_ID)).draft ?? null);
    await editor(PAGE_ID);
    ok("A1 menu « Thème : <nom> » dans la barre du haut", (await picker().count()) === 1 && ((await picker().textContent()) ?? "").includes(LIVE_NAME) && /^Thème/.test(((await picker().textContent()) ?? "").trim()), await picker().textContent().catch(() => ""));
    ok("A2 pas de bandeau quand on est sur le thème en ligne", (await banner().count()) === 0);
    await openMenu();
    const names = await items();
    ok("A3 le thème en ligne est en tête de liste, avec « En ligne »", names[0] === LIVE_NAME && (await page.locator(".ve-theme-item").first().textContent())?.includes("En ligne"), JSON.stringify(names.slice(0, 3)));
    ok("A4 tous les thèmes sont listés", names.length >= 4, String(names.length));
    await shot("A-menu");
    await page.locator('[data-testid="theme-picker-search"]').fill(themeName(T1).slice(0, 4).toLowerCase());
    const filtered = await items();
    ok("A5 la recherche filtre (sans casse)", filtered.length >= 1 && filtered.length < names.length && filtered.includes(themeName(T1)), JSON.stringify(filtered));
    await page.locator('[data-testid="theme-picker-search"]').fill("zzzzqq");
    ok("A6 aucun résultat : message simple", /Aucun thème/.test((await page.locator(".ve-theme-list").textContent()) ?? ""));
    await page.keyboard.press("Escape");
    await page.waitForSelector(".ve-theme-list", { state: "detached" }).catch(() => {});

    setDraft(PAGE_ID, blocks);
    await editor(PAGE_ID);
    await choose(T1);
    ok("A7 on reste sur la même page de l'éditeur", new URL(page.url()).pathname === `/admin/pages/${PAGE_ID}/editer`, page.url());
    ok("A8 bandeau « Tu prépares le thème X » (mécanisme du lot 55)", (await banner().count()) === 1 && ((await banner().textContent()) ?? "").includes(themeName(T1)));
    ok("A9 le menu affiche le thème préparé", ((await picker().textContent()) ?? "").includes(themeName(T1)));
    ok("A10 le brouillon n'a pas bougé", JSON.stringify(draftBlocks(PAGE_ID)) === JSON.stringify(blocks));
    ok("A11 le thème en ligne n'a pas changé", setting("activeThemeId") === LIVE);
    const frame = await canvas(page);
    const bg = await frame.evaluate(() => getComputedStyle(document.body).backgroundColor);
    ok("A12 la toile montre le thème préparé (fond différent du thème en ligne)", Boolean(bg));
    await shot("A-prepare");
    sql((db) => db.prepare("update pages set draft = null where id = ?").run(PAGE_ID));
    void before;
  }

  /* ---- B ---- */
  if (run("B")) {
    await stopPreview();
    await editor(PAGE_ID);
    await choose(T2);
    await choose(T1);
    const usage = setting("themeUsage") ?? {};
    ok("B1 dernier usage gardé côté serveur", typeof usage[T1] === "number" && typeof usage[T2] === "number" && usage[T1] >= usage[T2], JSON.stringify(usage));
    await openMenu();
    const names = await items();
    ok("B2 ordre : en ligne, puis le dernier préparé, puis l'avant-dernier", names[0] === LIVE_NAME && names[1] === themeName(T1) && names[2] === themeName(T2), JSON.stringify(names.slice(0, 4)));
    ok("B3 le thème courant est coché", /✓/.test((await page.locator(".ve-theme-item[data-current]").textContent()) ?? ""));
    await shot("B-ordre");
    await page.keyboard.press("Escape");
  }

  /* ---- C ---- */
  if (run("C")) {
    await stopPreview();
    await editor(PAGE_ID);
    await choose(T1);
    ok("C0 préparation en cours", (await banner().count()) === 1);
    await choose(LIVE);
    ok("C1 revenir au thème en ligne arrête l'aperçu (plus de bandeau)", (await banner().count()) === 0 && ((await picker().textContent()) ?? "").includes(LIVE_NAME));
    ok("C2 même page", new URL(page.url()).pathname === `/admin/pages/${PAGE_ID}/editer`);
  }

  /* ---- D ---- */
  if (run("D")) {
    await stopPreview();
    sql((db) => db.prepare("update pages set draft = null, draft_updated_at = null").run());
    const home = q1("select id from pages where json_extract(slug, '$.fr') = ''")?.id;
    await page.goto(`${BASE}/admin/themes`, { waitUntil: "networkidle" });
    await page.locator(".a-theme-card").first().waitFor();
    const cards = page.locator(".a-theme-card");
    const n = await cards.count();
    const works = await page.locator('[data-testid="theme-work"]').count();
    ok("D1 « Travailler au brouillon dessus » sur chaque carte non en ligne, pas sur celle en ligne", works === n - 1 && (await page.locator('.a-theme-card[data-active="true"] [data-testid="theme-work"]').count()) === 0, `${works}/${n}`);
    ok("D2 libellé exact", ((await page.locator('[data-testid="theme-work"]').first().textContent()) ?? "").trim() === "Travailler au brouillon dessus");
    await shot("D-themes");
    const card1 = page.locator(".a-theme-card", { has: page.locator("h2", { hasText: new RegExp(`^${themeName(T1)}$`) }) });
    await Promise.all([page.waitForURL(/\/editer/, { timeout: 120000 }), card1.locator('[data-testid="theme-work"]').click()]);
    await canvas(page);
    ok("D3 sans page modifiée : ouvre l'accueil", new URL(page.url()).pathname === `/admin/pages/${home}/editer`, page.url());
    ok("D4 avec ce thème en préparation", (await banner().count()) === 1 && ((await banner().textContent()) ?? "").includes(themeName(T1)));
    await stopPreview();
    setDraft(PAGE_ID, [{ uid: "essayer63d", type: "section-title", props: { title: { fr: "Dernière page", en: "Last page" } } }]);
    await page.goto(`${BASE}/admin/themes`, { waitUntil: "networkidle" });
    const card2 = page.locator(".a-theme-card", { has: page.locator("h2", { hasText: new RegExp(`^${themeName(T2)}$`) }) });
    await Promise.all([page.waitForURL(/\/editer/, { timeout: 120000 }), card2.locator('[data-testid="theme-work"]').click()]);
    await canvas(page);
    ok("D5 avec une page modifiée : ouvre la dernière page éditée", new URL(page.url()).pathname === `/admin/pages/${PAGE_ID}/editer`, page.url());
    ok("D6 le brouillon est conservé", draftBlocks(PAGE_ID)[0]?.uid === "essayer63d");
    ok("D7 le thème en ligne est inchangé", setting("activeThemeId") === LIVE);
    sql((db) => db.prepare("update pages set draft = null, draft_updated_at = null where id = ?").run(PAGE_ID));
  }

  /* ---- F ---- */
  if (run("F")) {
    await stopPreview();
    setDraft(PAGE_ID, [{ uid: "essayer63f", type: "section-title", props: { title: { fr: "Barre", en: "Bar" } } }]);
    await page.request.post(`${BASE}/admin/apercu`, { form: { id: T1, retour: "/admin/themes" }, headers: { origin: BASE }, maxRedirects: 0 });
    await editor(PAGE_ID);
    for (const w of [1440, 1280, 1024]) {
      await page.setViewportSize({ width: w, height: 900 });
      await sleep(600);
      const box = await page.getByRole("button", { name: "Publier", exact: true }).boundingBox();
      const over = await page.evaluate(() => { const el = document.querySelector(".ve-top"); return el ? el.scrollWidth - el.clientWidth : -1; });
      ok(`F1 ${w} px : « Publier » visible et menu Thème dans la barre, sans débordement`, Boolean(box && box.x >= 0 && box.x + box.width <= w) && over <= 0 && (await picker().isVisible()), `${JSON.stringify(box)} ${over}`);
      await page.screenshot({ path: path.join(SHOTS, `F-barre-${w}.png`), clip: { x: 0, y: 0, width: w, height: 130 } });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    sql((db) => db.prepare("update pages set draft = null, draft_updated_at = null where id = ?").run(PAGE_ID));
    await stopPreview();
  }

  /* ---- E ---- */
  if (run("E")) {
    await stopPreview();
    await page.request.post(`${BASE}/admin/apercu`, { form: { id: T1, retour: "/admin/themes" }, headers: { origin: BASE }, maxRedirects: 0 });
    await page.goto(`${BASE}/admin/themes`, { waitUntil: "networkidle" });
    const badge = page.locator('[data-testid="theme-preparing"]');
    ok("E1 pastille « En travail » sur la carte en préparation", (await badge.count()) === 1 && /En travail/.test((await badge.textContent()) ?? ""));
    const live = page.locator('[data-testid="theme-live"]');
    const shape = (l) => l.evaluate((e) => { const s = getComputedStyle(e); return [s.borderRadius, s.fontSize, s.fontWeight, s.minHeight].join("|"); });
    ok("E2 même forme que la pastille « En ligne »", (await shape(badge)) === (await shape(live)), `${await shape(badge)} / ${await shape(live)}`);
    const colors = await badge.evaluate((e) => { const s = getComputedStyle(e); return [s.color, s.backgroundColor]; });
    const lum = (c) => { const m = c.match(/\d+(\.\d+)?/g).map(Number).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
    const [l1, l2] = [lum(colors[0]), lum(colors[1])].sort((a, b) => b - a);
    ok("E3 texte de la pastille lisible (contraste ≥ 4,5)", (l1 + 0.05) / (l2 + 0.05) >= 4.5, colors.join(" / "));
    const border = await page.locator('.a-theme-card[data-preparing="true"]').evaluate((e) => getComputedStyle(e).borderTopColor);
    const liveBorder = await page.locator('.a-theme-card[data-active="true"]').evaluate((e) => getComputedStyle(e).borderTopColor);
    ok("E4 encadré orange sur la carte en travail, différent du vert de la carte en ligne", border !== liveBorder && Number(border.match(/\d+/g)[0]) > Number(border.match(/\d+/g)[2]) + 40, `${border} / ${liveBorder}`);
    await shot("E-badges");
    await stopPreview();
  }

  ok("Z aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await stopPreview().catch(() => {});
  await browser.close();
}
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
