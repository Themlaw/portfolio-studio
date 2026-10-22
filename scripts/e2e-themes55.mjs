#!/usr/bin/env node
/**
 * Lot 55 « préparer et appliquer un thème » (chromium, serveur de production, base neuve, une connexion admin).
 * (Lot 60 : « Mon thème », modèles et versions ; ce suite a été alignée sur ce modèle.)
 *  A  Écran Thèmes sans aperçu : pas de « Quitter l'aperçu », vocabulaire sans jargon, ordre des cartes.
 *  B  Aperçu d'un thème : pastille « En préparation » sur la bonne carte, bandeau, « Quitter l'aperçu » seulement alors, ordre inchangé.
 *  C  Éditeur de page : bandeau fixe « Tu prépares le thème X », panneau Couleurs = couleurs de CE thème.
 *  D  Couleurs personnalisées du site : nom, avertissement de lisibilité qui nomme la paire, publication.
 *  E  Écran Thèmes : encart « Couleurs personnalisées », pastilles qui montrent ce qui sera publié, confirmation à deux choix.
 *  F  Mise en ligne en revenant aux couleurs du thème, puis « Revenir au thème précédent ».
 *  G  « Revenir aux couleurs du thème » depuis l'écran Thèmes.
 *  H  Supprimer le thème en aperçu : la boîte le dit, l'aperçu s'arrête.
 *  I  Export : retour visuel.   J  Éditeur de thème : une seule sauvegarde, liste de codes repliée, aide juste.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=A,B,…] [SHOTS=dossier] node scripts/e2e-themes55.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { canvas, openEditor, pageIdOf, q1, settled, sleep, sql, waitFor } from "./lib/grille31d.mjs";
import { login } from "./lib/medias-setup.mjs";
import { gotoThemesPage } from "./lib/theme-live.mjs";

const BASE = process.env.BASE ?? "http://localhost:3680";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(tmpdir(), "e2e-themes55");
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
const themeRow = (id) => JSON.parse(q1("select data from themes where id = ?", id).data);
const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
page.setDefaultNavigationTimeout(120000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);

const LIVE = setting("activeThemeId") ?? "galerie-lumineuse";
const PREP = LIVE === "carnet-d-atelier" ? "studio" : "carnet-d-atelier";
const LIVE_NAME = themeRow(LIVE).name;
const PREP_NAME = themeRow(PREP).name;
const PAGE_ID = pageIdOf("personnages");
const CUSTOM_BG = "#dfeee8";
const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});

const gotoThemes = async () => {
  await gotoThemesPage(page, BASE);
  await page.locator(".a-theme-card").first().waitFor();
};
const cardNames = () => page.locator("section[data-model] h2").allTextContents();
const model = (id) => page.locator("section[data-model]", { has: page.locator(`h2#theme-${id}`) });
const card = (name) => page.locator(".a-theme-card", { has: page.locator("h2", { hasText: new RegExp(`^${name.replace(/[()]/g, "\\$&")}$`) }) });
const startPreview = (id) => page.request.post(`${BASE}/admin/apercu`, { form: { id, retour: "/admin/themes" }, headers: { origin: BASE }, maxRedirects: 0 });
const stopPreview = () => page.request.post(`${BASE}/admin/apercu/quitter`, { form: { retour: "/admin/themes" }, headers: { origin: BASE }, maxRedirects: 0 });
const role = (name) => page.locator(".lc-role-item", { has: page.locator(".lc-role strong", { hasText: name }) });
async function pickColor(name, hex) {
  const item = role(name);
  if ((await item.getAttribute("data-open")) === null) await item.locator(".lc-role").click();
  const field = item.locator(".cp-hex");
  await field.waitFor();
  await field.fill(hex);
  await field.press("Enter");
}

try {
  let order = [];

  /* ---- A. écran Thèmes sans aperçu ---- */
  await stopPreview();
  if (run("A") || true) {
    await gotoThemes();
    const text = (await page.locator("main").innerText()).replace(/\s+/g, " ");
    ok("A1 sans aperçu : pas de bouton « Quitter l'aperçu »", (await page.locator('[data-testid="quit-preview"]').count()) === 0 && !(await page.getByRole("button", { name: "Quitter l'aperçu" }).count()));
    ok("A2 aucune pastille « En préparation » ni bandeau", (await page.locator('[data-testid="theme-preparing"], [data-testid="theme-preparing-banner"]').count()) === 0);
    ok("A3 vocabulaire : plus de « Livré », « Hors ligne », « DA »", !/Livré|Hors ligne|\bDA\b/.test(text), text.slice(0, 200));
    ok("A4 « Modèle » sur les thèmes livrés", (await page.getByText("Modèle", { exact: true }).count()) >= 1);
    order = await cardNames();
    ok("A5 ordre : thèmes à toi d'abord, puis les fournis, par nom", JSON.stringify(order) === JSON.stringify([...order].sort((a, b) => 0)) && order.length >= 8, JSON.stringify(order));
    const live = card(LIVE_NAME);
    ok("A6 la carte en ligne porte « En ligne »", (await live.locator('[data-testid="theme-live"]').count()) === 1);
    await shot("A-themes");
  }

  /* ---- B. aperçu d'un thème ---- */
  if (run("B")) {
    const r = await startPreview(PREP);
    ok("B0 aperçu ouvert (303)", r.status() === 303, String(r.status()));
    await gotoThemes();
    const prep = card(PREP_NAME);
    ok("B1 pastille « En préparation » sur la bonne carte", (await prep.locator('[data-testid="theme-preparing"]').count()) === 1 && (await page.locator('[data-testid="theme-preparing"]').count()) === 1);
    ok("B2 bandeau « Tu prépares le thème X » avec Mettre en ligne et Arrêter l'aperçu", /Tu prépares le thème/.test((await page.locator('[data-testid="theme-preparing-banner"]').textContent()) ?? "") && (await page.locator('[data-testid="theme-preparing-banner"]').textContent())?.includes(PREP_NAME) && (await page.locator('[data-testid="theme-stop-preview"]').count()) === 1);
    ok("B3 « Quitter l'aperçu » présent pendant l'aperçu", (await page.locator('[data-testid="quit-preview"]').count()) === 1);
    ok("B4 aucune carte n'a bougé", JSON.stringify(await cardNames()) === JSON.stringify(order));
    ok("B5 le thème en ligne reste « En ligne »", (await card(LIVE_NAME).locator('[data-testid="theme-live"]').count()) === 1);
    await shot("B-preparation");
  }

  /* ---- C. éditeur de page ---- */
  if (run("C")) {
    await startPreview(PREP);
    const f = await openEditor(page, BASE, PAGE_ID);
    const banner = page.locator('[data-testid="preparing-banner"]');
    ok("C1 bandeau fixe de l'éditeur : « Tu prépares le thème X »", (await banner.count()) === 1 && /Tu prépares le thème/.test((await banner.textContent()) ?? "") && ((await banner.textContent()) ?? "").includes(PREP_NAME) && ((await banner.textContent()) ?? "").includes(LIVE_NAME));
    ok("C1b boutons « Utiliser ce modèle » (le thème préparé est un modèle) et Arrêter l'aperçu", (await banner.getByRole("button", { name: "Utiliser ce modèle" }).count()) === 1 && (await banner.getByRole("button", { name: "Arrêter l'aperçu" }).count()) === 1);
    await page.getByRole("tab", { name: "Réglages" }).click();
    await role("Fond de page").waitFor();
    const chip = await role("Fond de page").locator(".lc-role .lc-chip").evaluate((e) => getComputedStyle(e).backgroundColor);
    ok("C2 le panneau Couleurs montre les couleurs du thème en préparation", chip === rgb(themeRow(PREP).tokens.color.bg), `${chip} / ${themeRow(PREP).tokens.color.bg}`);
    const help = (await page.locator('[data-testid="colors-panel"] .lp-help').first().textContent()) ?? "";
    ok("C3 l'aide parle du thème en préparation", help.includes(PREP_NAME) && /pas encore en ligne/.test(help), help);
    await shot("C-editeur");
  }

  /* ---- D. couleurs personnalisées du site ---- */
  if (run("D")) {
    await startPreview(PREP);
    await openEditor(page, BASE, PAGE_ID);
    await page.getByRole("tab", { name: "Réglages" }).click();
    await role("Texte").waitFor();
    await pickColor("Texte", "#eee6d4");
    const warn = await waitFor(async () => /texte sur/i.test((await role("Texte").locator(".lc-warn, [data-testid=contrast-status]").first().textContent().catch(() => "")) ?? ""), 15000);
    ok("D1 l'avertissement de lisibilité nomme la paire (« Texte sur … »)", warn, await role("Texte").locator(".lc-warn, [data-testid=contrast-status]").first().textContent().catch(() => ""));
    ok("D1b l'avertissement du panneau parle du thème en préparation", /\(en préparation\)/.test((await page.getByTestId("palette-ignored").textContent().catch(() => "")) ?? ""));
    await page.getByRole("button", { name: "Revenir aux couleurs du thème" }).click();
    await pickColor("Fond de page", CUSTOM_BG);
    ok("D2 « Couleurs personnalisées du site » nommées dans le panneau", await waitFor(async () => /Couleurs personnalisées du site/.test((await page.getByTestId("custom-colors-title").textContent().catch(() => "")) ?? ""), 15000));
    ok("D3 le bouton « Revenir aux couleurs du thème » existe", (await page.getByRole("button", { name: "Revenir aux couleurs du thème" }).count()) === 1);
    await settled(page);
    await page.getByRole("button", { name: "Publier", exact: true }).click();
    ok("D4 publié", await waitFor(async () => /^En ligne/.test((await page.locator(".ve-status").textContent()) ?? ""), 120000));
    ok("D5 couleurs personnalisées en base", (setting("styles")?.palette?.bg ?? "").toLowerCase() === CUSTOM_BG);
  }

  /* ---- E / F. écran Thèmes avec couleurs personnalisées ---- */
  if (run("E") || run("F")) {
    if (!setting("styles")?.palette) {
      sql((db) => db.prepare("insert into settings (key, value) values ('styles', ?) on conflict(key) do update set value = excluded.value").run(JSON.stringify({ palette: { bg: CUSTOM_BG } })));
    }
    await startPreview(PREP);
    await gotoThemes();
    // Lot 60 : on ne met plus un modèle en ligne tel quel : « Utiliser ce modèle » crée Mon thème (version 1), qu'on publie ensuite.
    if (!q1("select id from themes where mine = 1")) {
      await model(PREP).getByTestId("use-model").click();
      await page.locator('[data-testid="mine-card"]').waitFor({ timeout: 60000 });
    }
    const MINE = q1("select id from themes where mine = 1").id;
    const notice = page.locator('[data-testid="custom-colors-notice"]');
    ok("E1 encart « Couleurs personnalisées du site » avec « Revenir aux couleurs du thème »", /Couleurs personnalisées du site/.test((await notice.textContent()) ?? "") && (await notice.getByRole("button", { name: "Revenir aux couleurs du thème" }).count()) === 1);
    const first = await card(LIVE_NAME).locator(".a-swatch").first().evaluate((e) => getComputedStyle(e).backgroundColor);
    const firstOther = await page.locator('[data-testid="mine-card"] .a-swatch').first().evaluate((e) => getComputedStyle(e).backgroundColor);
    ok("E2 les pastilles montrent ce qui sera publié (fond personnalisé)", first === rgb(CUSTOM_BG) && firstOther === rgb(CUSTOM_BG), `${first} ${firstOther}`);
    await page.getByTestId("mine-publish").click();
    const dlg = page.locator("dialog[open]");
    await dlg.waitFor();
    const dt = (await dlg.textContent()) ?? "";
    ok("E3 confirmation : couleurs personnalisées gardées par-dessus, deux choix", /restent appliquées par-dessus/.test(dt) && /Les garder/.test(dt) && /Revenir aux couleurs du nouveau thème/.test(dt), dt);
    await shot("E-confirmation");
    if (run("F")) {
      await dlg.getByLabel("Revenir aux couleurs du nouveau thème").check();
      await dlg.getByRole("button", { name: "Publier", exact: true }).click();
      ok("F1 Mon thème mis en ligne", await waitFor(() => setting("activeThemeId") === MINE, 60000));
      ok("F2 couleurs personnalisées retirées (choix « revenir aux couleurs du nouveau thème »)", !setting("styles")?.palette);
      ok("F3 le thème précédent est retenu", setting("previousThemeId") === LIVE, String(setting("previousThemeId")));
      ok("F4 toast avec « Revenir à … »", await page.getByRole("button", { name: new RegExp(`Revenir à « ${LIVE_NAME} »`) }).first().waitFor({ timeout: 15000 }).then(() => true, () => false));
      await page.reload({ waitUntil: "networkidle" });
      ok("F5 ordre inchangé après la mise en ligne", JSON.stringify(await cardNames()) === JSON.stringify(order));
      ok("F6 encart permanent « Revenir au thème précédent »", (await page.locator('[data-testid="theme-revert"]').count()) === 1 && /Thème précédent/.test((await page.locator('[data-testid="theme-previous"]').textContent()) ?? ""));
      await page.locator('[data-testid="theme-revert"]').click();
      ok("F7 retour au thème précédent", await waitFor(() => setting("activeThemeId") === LIVE, 60000));
    } else {
      await dlg.getByRole("button", { name: "Annuler" }).click();
    }
  }

  /* ---- G. revenir aux couleurs du thème depuis l'écran Thèmes ---- */
  if (run("G")) {
    sql((db) => db.prepare("insert into settings (key, value) values ('styles', ?) on conflict(key) do update set value = excluded.value").run(JSON.stringify({ palette: { bg: CUSTOM_BG } })));
    await gotoThemes();
    await page.locator('[data-testid="custom-colors-reset"]').click();
    ok("G1 couleurs personnalisées retirées", await waitFor(() => !setting("styles")?.palette, 30000));
    ok("G2 l'encart disparaît", await page.locator('[data-testid="custom-colors-notice"]').waitFor({ state: "detached", timeout: 15000 }).then(() => true, () => false));
  }

  /* ---- H / I / J. copie, suppression d'un thème en aperçu, export, éditeur de thème ---- */
  if (run("H") || run("I") || run("J")) {
    // Lot 60 : plus de « Dupliquer ». J et I travaillent sur Mon thème (créé ici s'il n'existe pas) ; H sur un thème à part (« second thème »).
    await gotoThemes();
    if (!q1("select id from themes where mine = 1")) {
      await model(PREP).getByTestId("use-model").click();
      await page.locator('[data-testid="mine-card"]').waitFor({ timeout: 60000 });
    }
    const copyId = q1("select id from themes where mine = 1").id;
    const copyName = themeRow(copyId).name;
    await page.goto(`${BASE}/admin/themes/${copyId}`, { waitUntil: "networkidle" });

    if (run("J")) {
      await page.locator('[data-testid="da-section"]').waitFor();
      ok("J1 étape « Couleurs » (plus de « DA »)", /^Couleurs$/.test(((await page.locator('[data-testid="da-section"] .a-step-title').textContent()) ?? "").trim()) && !/\bDA\b/.test(await page.locator("main").innerText()));
      ok("J2 un seul bouton Enregistrer, pas d'« Enregistrer les couleurs »", (await page.getByRole("button", { name: "Enregistrer les couleurs" }).count()) === 0 && (await page.getByRole("button", { name: /^Enregistrer/ }).count()) === 1);
      ok("J3 un seul bloc de couleurs : pas de seconde liste des couleurs de base, nuances sous « Affiner » replié", (await page.locator('[data-testid="adv-couleurs"]').getAttribute("open")) === null && (await page.locator('.a-color[data-token="primary"]').count()) === 0 && (await page.locator('.a-color[data-token="bgDeep"]').count()) === 1);
      await page.locator('[data-testid="adv-couleurs"] summary').click();
      const read = ((await page.locator('[data-testid="readability"]').innerText()) ?? "").replace(/\s+/g, " ");
      ok("J4 la lisibilité est dite simplement (« Lisible » ou « Difficile à lire sur le fond »)", /Lisible|Difficile à lire sur le fond/.test(read), read.slice(0, 200));
      const ratios = await page.locator(".a-ratio").evaluateAll((l) => l.every((e) => e.scrollWidth <= e.clientWidth + 1));
      ok("J5 pastilles de lisibilité non tronquées", ratios);
      ok("J6 cinq étapes dans la colonne de gauche", (await page.locator(".a-step-btn").count()) === 5);
      await shot("J-editeur-theme");
    }

    if (run("I")) {
      await gotoThemes();
      await card(copyName).getByRole("button", { name: /Plus d'actions/ }).click();
      const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }).catch(() => null), page.getByRole("menuitem", { name: /Exporter le thème/ }).click()]);
      ok("I1 export : retour visuel (toast « Archive en cours de téléchargement »)", await page.getByText(/Archive en cours de téléchargement/).first().waitFor({ timeout: 10000 }).then(() => true, () => false));
      void download;
    }

    if (run("H")) {
      // Un thème à part : « Utiliser ce modèle » puis « Créer un second thème » (Mon thème reste tel quel).
      await gotoThemes();
      await model(PREP).getByTestId("use-model").click();
      await page.locator("dialog[open]").getByRole("button", { name: "Créer un second thème" }).click();
      const oldId = (await waitFor(() => Boolean(q1("select id from themes where mine = 0 and preset = 0 and name = ?", PREP_NAME)), 30000)) ? q1("select id from themes where mine = 0 and preset = 0 and name = ?", PREP_NAME).id : null;
      ok("H0 un second thème est créé (rangé dans « Mes anciens thèmes »)", Boolean(oldId));
      await startPreview(oldId);
      await gotoThemes();
      const oldCard = page.locator("section[data-old]", { has: page.locator(`h2#theme-${oldId}`) });
      ok("H1 le thème à part est « En préparation »", (await oldCard.locator('[data-testid="theme-preparing"]').count()) === 1);
      await oldCard.getByTestId("old-delete").click();
      const dlg = page.locator("dialog[open]");
      await dlg.waitFor();
      ok("H2 la boîte de suppression dit que le thème est en aperçu", /prévisualiser/.test((await dlg.textContent()) ?? ""));
      await dlg.getByRole("button", { name: "Supprimer" }).click();
      ok("H3 thème supprimé", await waitFor(() => !q1("select id from themes where id = ?", oldId), 30000));
      await dlg.waitFor({ state: "hidden", timeout: 30000 }); // l'action a répondu (cookies d'aperçu effacés) avant de recharger
      await page.reload({ waitUntil: "networkidle" });
      ok("H4 l'aperçu s'arrête : ni bandeau, ni « Quitter l'aperçu »", (await page.locator('[data-testid="theme-preparing-banner"]').count()) === 0 && (await page.locator('[data-testid="quit-preview"]').count()) === 0);
    }
  }

  ok("Z aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await stopPreview().catch(() => {});
  await browser.close();
}
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
