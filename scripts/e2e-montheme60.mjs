#!/usr/bin/env node
/**
 * Lot 60 « Mon thème, modèles et versions » (chromium, serveur de production ou dev, base neuve, une connexion admin).
 *  A  Premier usage : « Choisis un modèle pour commencer », « Utiliser ce modèle » crée Mon thème (version 1, brouillon), vignette réelle de l'accueil.
 *  B  Kit ×3 : versions 2, 3, 4 de Mon thème, AUCUN nouveau thème, « Appliquer à mon thème (crée la version N) », le site public ne bouge pas.
 *  C  Historique : une ligne par version (vignette réelle, date, résumé), aperçu d'une version, « Revenir à cette version » (nouvelle version identique),
 *     « Garder une copie à part », marquage.
 *  D  Changer de modèle : fenêtre « Remplacer mon thème (version N) par X ? », « Créer un second thème », « Remplacer ».
 *  E  Publier : fenêtre avant → après, version publiée / brouillon (« En ligne : v6 · brouillon : v7 »), le site public suit la version publiée seulement.
 *  F  Éditeur : « Enregistrer » crée une version (une par séance), sans publier.
 *  G  Mes anciens thèmes (repliée) : « (kit) », « (copie) », « (importé) » gardés ; « En faire mon thème (nouvelle version) », « Supprimer ».
 *  H  Import .zip : « comme nouvelle version de mon thème » ou « comme thème à part ».
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=A,B,…] [SHOTS=dossier] node scripts/e2e-montheme60.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { sleep, sql } from "./lib/grille31d.mjs";
import { login, q1, waitFor } from "./lib/medias-setup.mjs";

const BASE = process.env.BASE ?? "http://localhost:3740";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(tmpdir(), "e2e-montheme60");
const DIR = path.join(tmpdir(), "e2e-montheme60-files");
mkdirSync(SHOTS, { recursive: true });
mkdirSync(DIR, { recursive: true });

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};

const setting = (key) => {
  const v = q1("select value from settings where key = ?", key)?.value;
  return v === undefined ? null : JSON.parse(v);
};
const row = (id) => q1("select * from themes where id = ?", id);
const mine = () => q1("select * from themes where mine = 1");
const count = (table) => q1(`select count(*) c from ${table}`).c;
const versions = (id) => sql((db) => db.prepare("select n, source, summary, pinned, data from theme_versions where theme_id = ? order by n").all(id));
const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }).catch(() => {});

/** Couleur de fond du site public, vue par un visiteur anonyme (feuille « theme » de la page d'accueil). */
async function publicBg() {
  const html = await (await fetch(`${BASE}/fr`, { cache: "no-store" })).text();
  const m = /--t-color-bg:\s*(#[0-9a-fA-F]{6})/.exec(html);
  return m ? m[1].toLowerCase() : null;
}

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
page.setDefaultNavigationTimeout(180000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);

const LIVE0 = setting("activeThemeId");
const LIVE0_BG = JSON.parse(row(LIVE0).data).tokens.color.bg.toLowerCase();
const modelNames = Object.fromEntries(sql((db) => db.prepare("select id, name from themes where preset = 1").all()).map((r) => [r.id, r.name]));
// Modèle de départ : un décor à plans (le kit « décor » n'existe que pour lui) ; modèle de remplacement : un fond bien différent.
const FIRST_ID = "fanzine-riso";
const SECOND_ID = "planche-de-story";
const FIRST = JSON.parse(row(FIRST_ID).data);
const SECOND = JSON.parse(row(SECOND_ID).data);

const gotoThemes = async (query = "") => {
  await page.goto(`${BASE}/admin/themes${query}`, { waitUntil: "networkidle" });
  await page.locator('[data-testid="mine-section"]').waitFor();
};
const model = (id) => page.locator("section[data-model]", { has: page.locator(`h2#theme-${id}`) });
const state = async () => ((await page.locator('[data-testid="mine-state"]').textContent()) ?? "").replace(/\s+/g, " ").trim();
const dialog = () => page.locator("dialog[open]");

/** Cadre de la vignette d'une carte, une fois chargé. */
async function thumbFrame(locator) {
  await locator.scrollIntoViewIfNeeded();
  const handle = await locator.elementHandle();
  const fr = await handle.contentFrame();
  await fr.waitForLoadState("load", { timeout: 120000 }).catch(() => {});
  await fr.waitForSelector("body", { timeout: 60000 });
  await sleep(700);
  return fr;
}
const frameVar = (fr, name) =>
  fr.evaluate((n) => {
    const p = document.createElement("span");
    p.style.color = `var(${n})`;
    document.body.appendChild(p);
    const v = getComputedStyle(p).color;
    p.remove();
    return v;
  }, name);

const tsxRun = (file, ...args) => execFileSync(process.execPath, ["--import", "tsx", file, ...args], { stdio: "ignore" });
const sim = (...args) => tsxRun("scripts/kit-poc/simulate-multi.mts", ...args);

try {
  /* ---- A. premier usage ---- */
  if (run("A")) {
    await gotoThemes();
    const text = (await page.locator("main").innerText()).replace(/\s+/g, " ");
    ok("A1 pas de Mon thème : « Choisis un modèle pour commencer »", (await page.locator('[data-testid="mine-empty"]').count()) === 1 && /Choisis un modèle pour commencer/.test(text) && (await page.locator('[data-testid="mine-card"]').count()) === 0);
    const models = page.locator("section[data-model]");
    ok("A2 les 8 modèles, chacun avec [Prévisualiser] et [Utiliser ce modèle]", (await models.count()) === 8 && (await page.getByTestId("use-model").count()) === 8 && (await models.first().getByRole("button", { name: /Prévisualiser/ }).count()) === 1);
    ok("A3 plus de « Mettre en ligne » ni « Dupliquer » sur les modèles", (await page.getByRole("button", { name: "Mettre en ligne" }).count()) === 0 && !/Dupliquer/.test(text));
    ok("A4 aucune section « Mes anciens thèmes » sans ancien thème", (await page.locator('[data-testid="olds-section"]').count()) === 0);
    ok("A4b le thème en ligne est le modèle d'avant (« En ligne » sur sa carte), rien n'a bougé", (await model(LIVE0).locator('[data-testid="theme-live"]').count()) === 1);
    await shot(page, "A-premier-usage");

    const themesBefore = count("themes");
    await model(FIRST_ID).getByTestId("use-model").click();
    await page.locator('[data-testid="mine-card"]').waitFor({ timeout: 60000 });
    const m = mine();
    ok("A5 « Utiliser ce modèle » crée Mon thème, version 1, un seul thème de plus", Boolean(m) && m.version === 1 && count("themes") === themesBefore + 1 && count("theme_versions") === 1, JSON.stringify(m && { id: m.id, version: m.version }));
    ok("A5b basé sur le modèle de départ, nommé « Mon thème »", m.based_on === modelNames[FIRST_ID] && m.name === "Mon thème" && (await page.locator('[data-testid="mine-based-on"]').textContent())?.includes(`« ${modelNames[FIRST_ID]} »`));
    ok("A5c carte : « Version 1 · modifiée le … », état « Brouillon », pas en ligne", /^Version 1 · modifiée le /.test(((await page.locator('[data-testid="mine-version"]').textContent()) ?? "").trim()) && (await page.locator('[data-testid="mine-draft-badge"]').count()) === 1 && /Pas encore en ligne · brouillon : v1/.test(await state()), await state());
    ok("A5d le site en ligne n'a pas changé (même thème actif, même fond pour les visiteurs)", setting("activeThemeId") === LIVE0 && (await publicBg()) === LIVE0_BG, `${setting("activeThemeId")} ${await publicBg()}`);
    ok("A5e le modèle Studio reste intact", row(FIRST_ID).mine === 0 && row(FIRST_ID).preset === 1 && JSON.stringify(JSON.parse(row(FIRST_ID).data)) === JSON.stringify(FIRST));
    ok("A5f la carte porte [Modifier] [Prévisualiser] [Kit Photoshop ▾] [Historique des versions]", ["mine-edit", "mine-preview", "mine-kit-menu", "mine-history"].every((t) => true) && (await page.getByTestId("mine-edit").count()) === 1 && (await page.getByTestId("mine-preview").count()) === 1 && (await page.getByTestId("mine-kit-menu").count()) === 1 && (await page.getByTestId("mine-history").count()) === 1);
    ok("A5g « Mettre en ligne cette version » proposé (Mon thème n'est pas en ligne)", (await page.getByTestId("mine-publish").count()) === 1);
    ok("A6 la carte « Mon thème » est au-dessus des modèles (« Repartir d'un modèle »)", (await page.locator("main h2.a-themes-title").allTextContents()).join("|") === "Mon thème|Repartir d'un modèle");

    // Vignette réelle : la vraie page d'accueil, avec le thème de Mon thème (modèle de départ), pas celui qui est en ligne.
    const fr = await thumbFrame(page.locator('[data-testid="mine-card"] iframe'));
    const bg = await frameVar(fr, "--t-color-bg");
    ok("A7 vignette réelle de l'accueil : rendue avec les couleurs de Mon thème (modèle de départ), pas du thème en ligne", bg === rgb(FIRST.tokens.color.bg) && FIRST.tokens.color.bg.toLowerCase() !== LIVE0_BG, `${bg} / ${FIRST.tokens.color.bg} / ${LIVE0_BG}`);
    ok("A7b dans la vignette : ni bandeau d'aperçu ni bouton d'édition", (await fr.locator(".preview-banner:visible, .pe-edit-this:visible").count()) === 0 && (await fr.locator("html[data-preview-framed]").count()) === 1);
    ok("A7c la vignette montre bien la page d'accueil du site (en-tête, contenu)", (await fr.locator("header, main").count()) >= 1 && (await fr.locator("body").innerText()).length > 20);
    await shot(page, "A-mon-theme-cree");
  }

  /* ---- B. kit ×3 : versions 2, 3, 4 ---- */
  if (run("B")) {
    const M = mine();
    ok("B0 Mon thème existe (A requis)", Boolean(M));
    const themesBefore = count("themes");
    const kitUrl = `${BASE}/admin/api/theme-kit/${M.id}`;
    let ready = false;
    for (let i = 0; i < 90 && !ready; i++) {
      const res = await page.request.post(kitUrl, { headers: { origin: BASE } });
      ready = (await res.json()).ready === true;
      if (!ready) await sleep(2000);
    }
    ok("B1 le kit de Mon thème se télécharge (menu « Kit Photoshop »)", ready);
    const kitFile = path.join(DIR, "kit.zip");
    writeFileSync(kitFile, await (await page.request.get(kitUrl)).body());
    const iconPsd = path.join(DIR, "icones.psd");
    const decorPsd = path.join(DIR, "decor.psd");
    sim("icone", kitFile, iconPsd);
    sim("decor", kitFile, decorPsd);

    await gotoThemes();
    await page.getByTestId("mine-kit-menu").click();
    ok("B1b menu « Kit Photoshop ▾ » : télécharger, renvoyer le kit rempli", (await page.getByRole("menuitem", { name: /Télécharger le kit Photoshop/ }).count()) === 1 && (await page.getByRole("menuitem", { name: /Renvoyer le kit rempli/ }).count()) === 1);
    await page.keyboard.press("Escape");

    const apply = async (files, cards, expectVersion) => {
      await page.goto(`${BASE}/admin/themes/${M.id}/kit`, { waitUntil: "networkidle" });
      await page.setInputFiles('[data-testid="kit-file"]', files);
      await page.waitForURL(/\/kit\?import=/, { timeout: 180000 });
      await page.locator(".a-kit-card").nth(cards - 1).waitFor({ timeout: 240000 });
      await page.waitForLoadState("networkidle");
      const base = ((await page.locator('[data-testid="kit-base"]').textContent()) ?? "").replace(/\s+/g, " ");
      ok(`B${expectVersion} revue : « Le kit s'applique à : Mon thème (version ${expectVersion - 1}) », plus de liste « Kit appliqué sur le thème »`, base.includes(`Le kit s'applique à : Mon thème (version ${expectVersion - 1})`) && (await page.locator('[data-testid="kit-base-select"]').count()) === 0, base);
      const button = page.getByRole("button", { name: `Appliquer à mon thème (crée la version ${expectVersion})` });
      ok(`B${expectVersion}b bouton « Appliquer à mon thème (crée la version ${expectVersion}) »`, (await button.count()) === 1 && (await page.getByRole("button", { name: "Appliquer au thème" }).count()) === 0);
      await Promise.all([page.waitForURL(/\/admin\/themes\?nouvelle=\d+&via=kit/, { timeout: 90000 }), button.click()]);
      await page.locator('[data-testid="new-version-notice"]').waitFor();
    };
    await apply(iconPsd, 8, 2);
    ok("B2c version 2 créée, aucun nouveau thème, encart « Version 2 de Mon thème créée »", mine().version === 2 && count("themes") === themesBefore && /Version 2 de Mon thème créée/.test((await page.locator('[data-testid="new-version-notice"]').textContent()) ?? ""));
    await apply([decorPsd, iconPsd], 12, 3);
    ok("B3c version 3 créée, aucun nouveau thème", mine().version === 3 && count("themes") === themesBefore);
    await apply(iconPsd, 8, 4);
    ok("B4c version 4 créée, aucun nouveau thème, plus de « (kit) » nulle part", mine().version === 4 && count("themes") === themesBefore && count("themes") === 9 && !sql((db) => db.prepare("select id from themes where name like '%(kit%' or id like '%-kit%'").all()).length, String(count("themes")));
    const v = versions(M.id);
    ok("B5 quatre versions, résumés générés (« kit : flèches et icônes », « kit : décor »)", v.length === 4 && /kit : flèches et icônes/.test(v[1].summary) && /kit : décor/.test(v[2].summary) && v[1].source === "kit", JSON.stringify(v.map((x) => x.summary)));
    ok("B6 le thème actuel reste intact : site public et thème en ligne inchangés (rien n'est publié)", setting("activeThemeId") === LIVE0 && (await publicBg()) === LIVE0_BG && mine().published_version === null);
    ok("B7 les ressources du kit ne sont pas dupliquées (mêmes chemins /media/kit d'une version à l'autre)", (() => {
      const paths = (n) => [...(v[n].data.match(/\/media\/kit\/[0-9a-f]{16}\.\w+/g) ?? [])];
      return paths(2).length >= paths(1).length && paths(1).every((p) => paths(2).includes(p)) && paths(3).every((p) => paths(2).includes(p));
    })());
    await shot(page, "B-kit-version-4");
  }

  /* ---- C. historique ---- */
  if (run("C")) {
    const M = mine();
    await gotoThemes();
    await page.getByTestId("mine-history").click();
    await page.waitForURL(/\/versions$/);
    await page.locator('[data-testid="versions-list"] li').first().waitFor();
    const items = page.locator('[data-testid="versions-list"] li');
    ok("C1 historique : une ligne par version, la plus récente d'abord", (await items.count()) === 4 && (await items.first().getAttribute("data-version")) === "4" && (await items.last().getAttribute("data-version")) === "1");
    ok("C1b chaque ligne : vignette réelle, date, résumé d'une ligne, 3 actions", (await page.locator('[data-testid="versions-list"] [data-testid="live-thumb"]').count()) === 4 && (await items.first().locator('[data-testid="version-summary"]').textContent())?.length > 0 && (await items.first().getByTestId("version-preview").count()) === 1 && (await items.nth(1).getByTestId("version-revert").count()) === 1 && (await items.first().getByTestId("version-copy").count()) === 1);
    ok("C1c la version en cours (4) n'a pas de « Revenir à cette version »", (await items.first().getByTestId("version-revert").count()) === 0 && (await items.first().getByTestId("version-current").count()) === 1);
    ok("C1d état « Pas encore en ligne · brouillon : v4 »", /Pas encore en ligne · brouillon : v4/.test((await page.locator('[data-testid="versions-state"]').textContent()) ?? ""));
    await shot(page, "C-historique");

    // vignettes de versions différentes = rendus différents (la v1 n'a pas la flèche dessinée, la v2 oui)
    const f1 = await thumbFrame(items.nth(3).locator("iframe"));
    const f2 = await thumbFrame(items.nth(2).locator("iframe"));
    const arrow = (fr) => fr.evaluate(() => document.documentElement.hasAttribute("data-kit-icon-arrow-right"));
    ok("C2 les vignettes des versions montrent chacune leur version (v1 sans flèche dessinée, v2 avec)", !(await arrow(f1)) && (await arrow(f2)), `${await arrow(f1)} ${await arrow(f2)}`);

    // aperçu d'une version précise
    const r = await page.request.post(`${BASE}/admin/apercu`, { form: { id: `${M.id}@2`, retour: "/admin/themes" }, headers: { origin: BASE }, maxRedirects: 0 });
    ok("C3 aperçu de la version 2 (303)", r.status() === 303, String(r.status()));
    await page.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
    ok("C3b l'aperçu montre la version 2 (flèche dessinée) avec son nom dans le bandeau", (await page.evaluate(() => document.documentElement.hasAttribute("data-kit-icon-arrow-right"))) && /version 2/.test((await page.locator(".preview-banner").textContent().catch(() => "")) ?? ""), (await page.locator(".preview-banner").textContent().catch(() => "")) ?? "");
    await page.request.post(`${BASE}/admin/apercu/quitter`, { form: { retour: "/admin/themes" }, headers: { origin: BASE }, maxRedirects: 0 });

    // revenir à la version 2
    await page.goto(`${BASE}/admin/themes/${M.id}/versions`, { waitUntil: "networkidle" });
    const nThemes = count("themes");
    const v2 = versions(M.id).find((x) => x.n === 2);
    await page.locator('[data-testid="versions-list"] li[data-version="2"]').getByTestId("version-revert").click();
    ok("C4 « Revenir à cette version » : nouvelle version 5 identique à la 2 (rien de perdu), aucun nouveau thème", await waitFor(() => mine().version === 5, 30000));
    const v = versions(M.id);
    ok("C4b la version 5 est identique à la 2, l'historique garde les 4 autres, résumé « Retour à la version 2 »", v.length === 5 && v[4].data === v2.data && v[4].summary === "Retour à la version 2" && count("themes") === nThemes && JSON.parse(mine().data).assets.kit?.icons !== undefined);
    await page.reload({ waitUntil: "networkidle" });
    ok("C4c version 5 marquée « en cours », état « brouillon : v5 »", (await page.locator('li[data-version="5"] [data-testid="version-current"]').count()) === 1 && /brouillon : v5/.test((await page.locator('[data-testid="versions-state"]').textContent()) ?? ""));

    // garder une copie à part
    await page.locator('li[data-version="3"]').getByTestId("version-copy").click();
    ok("C5 « Garder une copie à part » : un thème à part « Mon thème (version 3) », Mon thème inchangé", await waitFor(() => Boolean(q1("select id from themes where name = 'Mon thème (version 3)' and mine = 0 and preset = 0")) && mine().version === 5, 30000));
    // marquer
    await page.locator('li[data-version="1"]').getByTestId("version-pin").click();
    ok("C6 version marquée (jamais supprimée)", await waitFor(() => versions(M.id)[0].pinned === 1, 30000));
  }

  /* ---- D. changer de modèle ---- */
  if (run("D")) {
    const M = mine();
    await gotoThemes();
    const before = mine().version;
    await model(SECOND_ID).getByTestId("use-model").click();
    await dialog().waitFor();
    const dt = ((await dialog().textContent()) ?? "").replace(/\s+/g, " ");
    ok("D1 fenêtre « Remplacer mon thème (version N) par X ? Tu pourras revenir à la version N. »", dt.includes(`Remplacer mon thème (version ${before}) par ${modelNames[SECOND_ID]} ?`) && dt.includes(`Tu pourras revenir à la version ${before}.`), dt.slice(0, 200));
    ok("D1b trois boutons : Remplacer, Créer un second thème, Annuler", (await dialog().getByRole("button", { name: "Remplacer", exact: true }).count()) === 1 && (await dialog().getByRole("button", { name: "Créer un second thème" }).count()) === 1 && (await dialog().getByRole("button", { name: "Annuler" }).count()) === 1);
    await shot(page, "D-remplacer");
    await dialog().getByRole("button", { name: "Annuler" }).click();
    ok("D2 « Annuler » : rien ne change", mine().version === before);
    await model(SECOND_ID).getByTestId("use-model").click();
    await dialog().getByRole("button", { name: "Créer un second thème" }).click();
    ok("D3 « Créer un second thème » : un thème à part (« Mes anciens thèmes »), Mon thème inchangé", await waitFor(() => Boolean(q1("select id from themes where name = ? and mine = 0 and preset = 0", modelNames[SECOND_ID])), 30000) && mine().version === before);
    await gotoThemes();
    await model(SECOND_ID).getByTestId("use-model").click();
    await dialog().getByRole("button", { name: "Remplacer", exact: true }).click();
    await page.waitForURL(/nouvelle=\d+&via=model/, { timeout: 60000 });
    const m = mine();
    ok("D4 « Remplacer » : nouvelle version de Mon thème à partir du modèle, basé sur le nouveau modèle", m.version === before + 1 && m.based_on === modelNames[SECOND_ID] && m.id === M.id && JSON.parse(m.data).tokens.color.bg === SECOND.tokens.color.bg, JSON.stringify({ v: m.version, b: m.based_on }));
    ok("D4b résumé « Modèle « … » » et Mon thème n'a pas été remplacé par un nouveau thème", versions(M.id).at(-1).summary === `Modèle « ${modelNames[SECOND_ID]} »` && versions(M.id).at(-1).source === "model");
    ok("D4c l'encart « Version N de Mon thème créée » rappelle que rien n'est en ligne", /Elle n'est pas encore en ligne/.test((await page.locator('[data-testid="new-version-notice"]').textContent()) ?? ""));
    await shot(page, "D-apres-remplacer");
  }

  /* ---- E. publier ---- */
  if (run("E")) {
    const M = mine();
    await gotoThemes();
    const n = M.version;
    ok("E1 « Mettre en ligne cette version » (pas encore en ligne)", (await page.getByTestId("mine-publish").count()) === 1);
    await page.getByTestId("mine-publish").click();
    await dialog().waitFor();
    const dt = ((await dialog().textContent()) ?? "").replace(/\s+/g, " ");
    ok("E2 fenêtre « Publier la version N de Mon thème ? » avec « avant → après »", dt.includes(`Publier la version ${n} de « Mon thème » ?`) && (await dialog().getByTestId("activate-swap").count()) === 1 && /→/.test(dt) && (await dialog().getByRole("button", { name: "Prévisualiser d'abord" }).count()) === 1, dt.slice(0, 250));
    await shot(page, "E-publier");
    await dialog().getByRole("button", { name: "Publier", exact: true }).click();
    ok("E3 publié : Mon thème est le thème en ligne, version publiée = version en cours", await waitFor(() => setting("activeThemeId") === M.id && mine().published_version === n && mine().live_data === null, 60000));
    ok("E3b le site public montre la version publiée (fond du modèle choisi)", (await waitFor(async () => (await publicBg()) === SECOND.tokens.color.bg.toLowerCase(), 30000)), String(await publicBg()));
    await gotoThemes();
    ok("E4 état « En ligne : vN », badge En ligne, plus de bouton Publier", (await state()) === `En ligne : v${n}` && (await page.locator('[data-testid="mine-card"] [data-testid="theme-live"]').count()) === 1 && (await page.getByTestId("mine-publish").count()) === 0);
    ok("E4b bandeau « Thème en ligne : Mon thème (version N) »", /Mon thème \(version \d+\)/.test((await page.locator('[data-testid="theme-live-banner"]').textContent()) ?? ""));
    await shot(page, "E-en-ligne");
  }

  /* ---- F. éditeur : Enregistrer = une version par séance, sans publier ---- */
  if (run("F")) {
    const M = mine();
    const publishedBefore = M.published_version;
    const bgBefore = await publicBg();
    await page.goto(`${BASE}/admin/themes/${M.id}`, { waitUntil: "networkidle" });
    await page.locator('[data-testid="mine-bar"]').waitFor();
    ok("F1 bandeau de Mon thème : version, état, « Historique des versions »", /version \d+/.test((await page.locator('[data-testid="mine-bar-state"]').textContent()) ?? "") && (await page.getByRole("link", { name: "Historique des versions" }).count()) === 1);
    const saveBtn = page.locator('[data-testid="da-save"]');
    ok("F1b un seul « Enregistrer » (pas « Enregistrer et publier… » : Mon thème s'enregistre en brouillon)", (await saveBtn.count()) === 1 && /^Enregistrer$/.test(((await saveBtn.textContent()) ?? "").trim()), (await saveBtn.textContent()) ?? "");
    // couleur d'accent changée, enregistrée
    const item = page.locator('.a-da .lc-role-item[data-role="secondary"]');
    await item.locator(".lc-role").click();
    await item.locator(".cp-hex").fill("#7a2e4d");
    await item.locator(".cp-hex").press("Enter");
    await saveBtn.click();
    ok("F2 « Enregistrer » : version suivante créée (brouillon), sans fenêtre « Publier »", (await waitFor(() => mine().version === M.version + 1, 60000)) && (await dialog().count()) === 0);
    ok("F2b rien n'est publié : version publiée et site public inchangés", mine().published_version === publishedBefore && (await publicBg()) === bgBefore && mine().live_data !== null, `${mine().published_version} ${mine().live_data === null}`);
    const afterFirst = mine().version;
    const vsAfterFirst = versions(M.id).length;
    // deuxième enregistrement de la même séance (rien de plus à enregistrer côté couleurs : on change le nom)
    await page.locator("#theme-name").fill("Mon portfolio");
    await saveBtn.click();
    ok("F3 deuxième enregistrement de la même séance : regroupé dans la même version", (await waitFor(() => JSON.parse(mine().data).name === "Mon portfolio", 60000)) && mine().version === afterFirst && versions(M.id).length === vsAfterFirst, `${mine().version}/${afterFirst}`);
    ok("F3b résumé de la version regroupée : couleurs changées, renommé", /couleurs changées/.test(versions(M.id).at(-1).summary) && /renommé/.test(versions(M.id).at(-1).summary), versions(M.id).at(-1).summary);
    await page.getByRole("link", { name: "Historique des versions" }).click();
    await page.waitForURL(/\/versions$/);
    // La sortie de l'éditeur a clos la séance : l'enregistrement suivant crée une nouvelle version.
    ok("F4 sortie de l'éditeur : séance close en base", await waitFor(() => sql((db) => db.prepare("select sealed from theme_versions where theme_id = ? and n = ?").get(M.id, afterFirst))?.sealed === 1, 30000));
    await gotoThemes();
    ok("F5 écran Thèmes : « En ligne : v… · brouillon : v… » et [Publier cette version]", /^En ligne : v\d+ · brouillon : v\d+$/.test(await state()) && (await page.getByTestId("mine-publish").count()) === 1, await state());
    await page.getByTestId("mine-publish").click();
    await dialog().waitFor();
    ok("F6 fenêtre de publication : la couleur changée apparaît « avant → après »", (await dialog().getByTestId("activate-changes").locator("li").count()) >= 1 && /Accent/.test((await dialog().getByTestId("activate-changes").textContent()) ?? ""), (await dialog().textContent()) ?? "");
    await shot(page, "F-publier-brouillon");
    await dialog().getByRole("button", { name: "Publier", exact: true }).click();
    ok("F7 publié : la version publiée devient le brouillon, le site public suit", await waitFor(() => mine().published_version === afterFirst && mine().live_data === null, 60000));
    ok("F8 « Revenir à cette version » sur un thème en ligne demande confirmation (publier ou non)", await (async () => {
      await page.goto(`${BASE}/admin/themes/${M.id}/versions`, { waitUntil: "networkidle" });
      await page.locator('li[data-version="1"]').getByTestId("version-revert").click();
      await dialog().waitFor();
      const t = ((await dialog().textContent()) ?? "").replace(/\s+/g, " ");
      const both = (await dialog().getByTestId("revert-publish").count()) === 1 && /Revenir \(sans publier\)/.test(t) && /Mon thème est en ligne/.test(t);
      await dialog().getByRole("button", { name: "Annuler" }).click();
      return both && mine().version === afterFirst;
    })());
  }

  /* ---- G. anciens thèmes ---- */
  if (run("G")) {
    const M = mine();
    const keep = JSON.stringify(sql((db) => db.prepare("select id, name, data from themes where mine = 0 and preset = 0 order by id").all()));
    const legacy = (id, name, t) => sql((db) => db.prepare("insert or replace into themes (id, name, preset, data) values (?, ?, 0, ?)").run(id, name, JSON.stringify({ ...t, id, name, preset: false })));
    legacy("studio-kit", "Studio (kit)", FIRST);
    legacy("studio-copie", "Studio (copie)", { ...FIRST, tokens: { ...FIRST.tokens, color: { ...FIRST.tokens.color, bg: "#f1e9ff" } } });
    legacy("studio-importe", "Studio (importé)", FIRST);
    await gotoThemes();
    const olds = page.locator('[data-testid="olds-section"]');
    ok("G1 « Mes anciens thèmes » : section repliée par défaut, avec le nombre", (await olds.count()) === 1 && (await olds.getAttribute("open")) === null && /Mes anciens thèmes \(\d+\)/.test((await olds.locator("summary").textContent()) ?? ""));
    await olds.locator("summary").click();
    ok("G2 ouverte : les « (kit) », « (copie) », « (importé) » et les thèmes à part sont là, rien n'a été supprimé", (await olds.locator("section[data-old]").count()) >= 6 && ["Studio (kit)", "Studio (copie)", "Studio (importé)"].every((n) => q1("select id from themes where name = ?", n)), String(await olds.locator("section[data-old]").count()));
    const oldCard = olds.locator("section[data-old]", { has: page.locator("h2#theme-studio-copie") });
    ok("G3 chaque ancien thème : [Prévisualiser] [En faire mon thème (nouvelle version)] [Supprimer], vignette réelle", (await oldCard.getByRole("button", { name: /Prévisualiser/ }).count()) === 1 && (await oldCard.getByTestId("old-adopt").count()) === 1 && (await oldCard.getByTestId("old-delete").count()) === 1 && (await oldCard.getByTestId("live-thumb").count()) === 1);
    await shot(page, "G-anciens");
    const fr = await thumbFrame(oldCard.locator("iframe"));
    ok("G3b la vignette d'un ancien thème montre SON thème (fond violet pâle de « Studio (copie) »)", (await frameVar(fr, "--t-color-bg")) === rgb("#f1e9ff"), await frameVar(fr, "--t-color-bg"));
    const vBefore = mine().version;
    await oldCard.getByTestId("old-adopt").click();
    await page.waitForURL(/nouvelle=\d+&via=adopt/, { timeout: 60000 });
    ok("G4 « En faire mon thème » : nouvelle version de Mon thème avec ses couleurs, l'ancien thème est toujours là", mine().version === vBefore + 1 && JSON.parse(mine().data).tokens.color.bg === "#f1e9ff" && Boolean(row("studio-copie")) && versions(M.id).at(-1).source === "adopt", JSON.stringify(versions(M.id).at(-1)));
    await page.locator('[data-testid="olds-section"] summary').click();
    const delCard = page.locator('[data-testid="olds-section"] section[data-old]', { has: page.locator("h2#theme-studio-importe") });
    await delCard.getByTestId("old-delete").click();
    await dialog().waitFor();
    ok("G5 « Supprimer » demande confirmation, puis supprime l'ancien thème (et lui seul)", /Supprimer le thème « Studio \(importé\) » \?/.test((await dialog().textContent()) ?? ""));
    await dialog().getByRole("button", { name: "Supprimer", exact: true }).click();
    ok("G5b ancien thème supprimé, les autres intacts", (await waitFor(() => !row("studio-importe"), 30000)) && Boolean(row("studio-kit")) && Boolean(row("studio-copie")));
    void keep;
  }

  /* ---- H. import .zip ---- */
  if (run("H")) {
    const M = mine();
    const res = await page.request.get(`${BASE}/admin/api/themes/${M.id}/export`);
    const zip = await res.body();
    ok("H0 export de Mon thème (.zip)", res.ok() && zip.length > 100);
    writeFileSync(path.join(DIR, "theme.zip"), zip);
    const before = { n: mine().version, themes: count("themes") };
    const viaApi = async (mode) => (await page.request.post(`${BASE}/admin/api/themes/import${mode ? `?mode=${mode}` : ""}`, { headers: { origin: BASE }, multipart: { file: { name: "theme.zip", mimeType: "application/zip", buffer: zip } } })).json();
    const a = await viaApi("version");
    ok("H1 « comme nouvelle version de mon thème » : version suivante, aucun nouveau thème", a.ok === true && a.theme.mode === "version" && a.theme.version === before.n + 1 && mine().version === before.n + 1 && count("themes") === before.themes, JSON.stringify(a));
    ok("H1b résumé « Importé (theme.zip) »", /^Importé \(theme\.zip\)/.test(versions(M.id).at(-1).summary), versions(M.id).at(-1).summary);
    const b = await viaApi("apart");
    ok("H2 « comme thème à part » : un thème de plus (« … (importé) »), Mon thème inchangé", b.ok === true && b.theme.mode === "apart" && /\(importé/.test(b.theme.name) && count("themes") === before.themes + 1 && mine().version === before.n + 1, JSON.stringify(b));
    const c = await viaApi(undefined);
    ok("H3 sans choix explicite : comme avant (thème à part)", c.ok === true && c.theme.mode === "apart");

    // même chose par l'écran : fenêtre avec les deux choix
    await gotoThemes();
    await page.getByTestId("theme-import-open").click();
    await dialog().waitFor();
    ok("H4 « Importer un thème… » : choix « Comme nouvelle version de mon thème » (par défaut) / « Comme thème à part »", (await dialog().getByTestId("import-mode-version").isChecked()) && (await dialog().getByTestId("import-mode-apart").count()) === 1 && /Comme nouvelle version de mon thème/.test((await dialog().textContent()) ?? ""));
    await shot(page, "H-importer");
    await dialog().getByRole("button", { name: "Annuler" }).click();
    await page.setInputFiles('[data-testid="theme-import-input"]', path.join(DIR, "theme.zip"));
    await page.waitForURL(/nouvelle=\d+&via=import/, { timeout: 60000 });
    ok("H5 import par l'écran avec le choix par défaut : nouvelle version de Mon thème + encart", mine().version === before.n + 2 && (await page.locator('[data-testid="new-version-notice"]').count()) === 1);
  }

  ok("Z aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await page.request.post(`${BASE}/admin/apercu/quitter`, { form: { retour: "/admin/themes" }, headers: { origin: BASE }, maxRedirects: 0 }).catch(() => {});
  await browser.close();
}
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
