#!/usr/bin/env node
/**
 * Parcours de bout en bout des éditeurs de l'admin (phase 4a), avec UN seul
 * chromium. Serveur dev requis (redémarré puis pré-chauffé : voir README),
 * connexion par le vrai formulaire (1 essai : attention à la limite 5/min).
 *
 *  A. Thème : dupliquer un preset, couleur refusée sous AA puis « Ajuster »,
 *     aperçu en direct dans le cadre, enregistrer, prévisualiser, mettre en
 *     ligne → un visiteur anonyme voit le nouveau thème sans redémarrage.
 *  B. Pages : créer (slug réservé refusé), ajouter des blocs, réordonner au
 *     clavier, publier → menu public + 200 en fr/en ; dépublier → 404 ;
 *     supprimer une page référencée → bloqué avec la liste ; ordre du menu.
 *  C. Réglages : URL javascript: refusée, mention de pied modifiée → le pied
 *     de page public change.
 *  D. Polices téléchargées (Réglages) : bibliothèque semée en base + fichiers
 *     factices (aucun accès à Google) ; liste, styles, quota, police utilisée
 *     sans bouton « Supprimer », suppression d'une police inutilisée.
 * L'état initial est restauré à la fin (thème en ligne, page supprimée,
 * mention et ordre du menu d'origine).
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… node scripts/e2e-admin.mjs
 */
import Database from "better-sqlite3";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

import { publishBlocks } from "./lib/page-draft.mjs";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");

const DB_FILE = path.join(process.env.DATA_DIR ?? "data", "portfolio.db");
/** Lecture directe de la base de l'essai (lecture seule). */
function dbq(sql, ...args) {
  const d = new Database(DB_FILE, { readonly: true });
  try {
    return d.prepare(sql).all(...args);
  } finally {
    d.close();
  }
}
const sdbBlocks = (id) => dbq("select type from blocks where page_id = ? order by position", id).map((r) => r.type);
const sdbCount = (id) => sdbBlocks(id).length;

let failures = 0;
function ok(label, cond, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
}

/** Requête anonyme (aucun cookie) : ce que voit un visiteur. */
async function anon(path) {
  const r = await fetch(BASE + path, { redirect: "manual" });
  return { status: r.status, html: await r.text() };
}

// Chromium sobre (VM de dev à 2 Go + swap) : pas de GPU, peu de processus de rendu.
const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && !/favicon/.test(m.text()) && errors.push(m.text().slice(0, 200)));
page.on("dialog", (d) => d.accept()); // garde « modifications non enregistrées »

/** Déplacement au clavier (dnd-kit) : Espace, flèches, Espace. */
async function moveWithKeyboard(handleName, key, times) {
  await page.getByRole("button", { name: handleName }).focus();
  await page.keyboard.press("Space");
  await page.waitForTimeout(200);
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(key);
    await page.waitForTimeout(200);
  }
  await page.keyboard.press("Space");
  await page.waitForTimeout(400);
}

/** Menu « … » d'une carte de thème (lot 23) : l'ouvre, puis choisit l'entrée. */
const menuItem = async (card, name) => {
  await card.getByRole("button", { name: /Plus d'actions/ }).click();
  await page.getByRole("menuitem", { name }).click();
};

/** Nettoyage de secours (essai interrompu) : page et copies de thème du test. */
async function cleanup() {
  try {
    await page.goto(`${BASE}/admin/themes`, { waitUntil: "networkidle" });
    const active = page.locator(".a-theme-card:has(#theme-galerie-lumineuse)").getByRole("button", { name: "Mettre en ligne" });
    if (await active.count()) {
      await active.click();
      await page.locator("dialog[open]").getByRole("button", { name: "Mettre en ligne" }).click();
      await page.locator(".a-toast", { hasText: "mis en ligne" }).first().waitFor();
      await page.reload({ waitUntil: "networkidle" });
    }
    while (await page.locator(".a-theme-card", { hasText: "(copie" }).count()) {
      await menuItem(page.locator(".a-theme-card", { hasText: "(copie" }).first(), "Supprimer");
      await page.locator("dialog[open]").getByRole("button", { name: "Supprimer" }).click();
      await page.locator("dialog[open]").waitFor({ state: "detached" });
      await page.reload({ waitUntil: "networkidle" });
    }
    await page.goto(`${BASE}/admin/pages`, { waitUntil: "networkidle" });
    while (await page.locator("tr", { hasText: "Carnets d'été" }).count()) {
      await page.locator("tr", { hasText: "Carnets d'été" }).getByRole("button", { name: "Supprimer" }).click();
      await page.locator("dialog[open]").getByRole("button", { name: "Supprimer" }).click();
      await page.locator("dialog[open]").waitFor({ state: "detached" });
      await page.reload({ waitUntil: "networkidle" });
    }
    console.log("nettoyage de secours effectué");
  } catch (e) {
    console.log("nettoyage de secours incomplet :", e.message.split("\n")[0]);
  }
}

const toast = async (text) => {
  const t = page.locator(".a-toast", { hasText: text });
  await t.first().waitFor({ timeout: 15000 });
  return true;
};

try {
  // ---- Connexion -----------------------------------------------------------
  await page.goto(`${BASE}/admin/connexion`, { waitUntil: "networkidle" });
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}/admin`);

  // ---- A. Thème ------------------------------------------------------------
  await page.goto(`${BASE}/admin/themes`, { waitUntil: "networkidle" });
  const source = page.locator(".a-theme-card:has(#theme-galerie-lumineuse)");
  // Le toast est affiché dès le clic et s'efface en quelques secondes : on l'attend en même temps que la navigation
  // (sur une machine lente, l'éditeur de la copie arrive après sa disparition).
  const duplicated = toast("dupliqué");
  duplicated.catch(() => {}); // rejet traité au await plus bas (pas de rejet non géré entre-temps)
  await menuItem(source, "Dupliquer");
  await page.waitForURL(/\/admin\/themes\/[a-z0-9-]+$/);
  const themeId = page.url().split("/").pop();
  ok("A1 preset dupliqué → éditeur de la copie", /copie/.test(themeId), themeId);
  await duplicated;

  const frame = page.frameLocator("iframe.a-preview-frame");
  await frame.locator("html[data-theme]").waitFor({ timeout: 30000 });
  ok("A2 aperçu en direct chargé (accueil en draft mode)", (await frame.locator("html").getAttribute("data-theme")) === themeId);

  const inkSoft = page.locator('.a-color[data-token="inkSoft"]');
  await inkSoft.getByLabel("Texte secondaire", { exact: true }).fill("#c4c4c4");
  ok("A3 couleur sous AA signalée", await inkSoft.locator(".a-ratio-bad").isVisible());
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  // Depuis la v0.21.1 le contraste n'est jamais bloquant : le thème est enregistré, l'avertissement (A3) reste affiché.
  await toast("Enregistré");
  ok(
    "A4 contraste insuffisant : thème enregistré quand même (aucun refus pour contraste)",
    (await page.locator(".a-save-state", { hasText: /✓\s*Enregistré/ }).waitFor({ timeout: 10000 }).then(() => true, () => false)) &&
      (await page.locator(".a-save-state", { hasText: "Contraste insuffisant" }).count()) === 0,
  );
  ok("A4b l'avertissement de lisibilité reste affiché après l'enregistrement", await inkSoft.locator(".a-ratio-bad").isVisible());
  await inkSoft.getByRole("button", { name: /Ajuster à la teinte la plus proche/ }).click();
  const adjusted = await inkSoft.getByLabel("Texte secondaire", { exact: true }).inputValue();
  ok("A5 « Ajuster » propose une teinte qui passe AA", await inkSoft.locator(".a-ratio-ok").isVisible(), adjusted);

  const NEW_PRIMARY = "#7a2e8e";
  await page.locator('.a-color[data-token="primary"]').getByLabel("Boutons et liens", { exact: true }).fill(NEW_PRIMARY);
  await page.waitForTimeout(400);
  const live = await frame.locator("html").evaluate((el) => getComputedStyle(el).getPropertyValue("--t-color-primary").trim());
  ok("A6 l'aperçu suit les réglages sans rechargement", live === NEW_PRIMARY, live);
  await page.locator(".a-variant-choice", { hasText: "Droits" }).click();
  await page.waitForTimeout(300);
  ok("A6b forme changée en direct (boutons droits)", (await frame.locator("html").getAttribute("data-button")) === "square");

  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await toast("Enregistré");
  ok("A7 thème enregistré, état « Enregistré »", await page.locator(".a-save-state", { hasText: /✓\s*Enregistré/ }).waitFor({ timeout: 10000 }).then(() => true, () => false));

  // Prévisualiser (nouvel onglet), depuis la liste.
  await page.goto(`${BASE}/admin/themes`, { waitUntil: "networkidle" });
  const card = page.locator(`.a-theme-card:has(#theme-${themeId})`);
  const [preview] = await Promise.all([ctx.waitForEvent("page"), card.getByRole("button", { name: /Prévisualiser/ }).click()]);
  await preview.waitForLoadState("domcontentloaded");
  ok("A8 « Prévisualiser ↗ » ouvre le site avec la copie", (await preview.locator("html").getAttribute("data-theme")) === themeId);
  await preview.close();

  // Mettre en ligne, avec confirmation « actuel → nouveau ».
  await card.getByRole("button", { name: "Mettre en ligne" }).click();
  const dlg = page.locator("dialog[open]");
  ok("A9 confirmation nomme le thème actuel et le nouveau", /Galerie lumineuse\s*→\s*Galerie lumineuse \(copie/.test(await dlg.locator(".a-swap").innerText()));
  ok("A9b la confirmation propose « Prévisualiser d'abord »", await dlg.getByRole("button", { name: /Prévisualiser d'abord/ }).isVisible());
  await dlg.getByRole("button", { name: "Mettre en ligne" }).click();
  await toast("mis en ligne");
  let r = await anon("/fr");
  ok(
    "A10 visiteur anonyme : nouveau thème sans redémarrage",
    r.html.includes(`data-theme="${themeId}"`) && r.html.includes(NEW_PRIMARY) && !r.html.includes("preview-banner"),
  );

  // Retour au thème d'origine, puis suppression de la copie.
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".a-theme-card:has(#theme-galerie-lumineuse)").getByRole("button", { name: "Mettre en ligne" }).click();
  await page.locator("dialog[open]").getByRole("button", { name: "Mettre en ligne" }).click();
  await toast("mis en ligne");
  await page.reload({ waitUntil: "networkidle" });
  await menuItem(page.locator(`.a-theme-card:has(#theme-${themeId})`), "Supprimer");
  ok("A11 suppression confirmée en nommant le thème", /Supprimer le thème « Galerie lumineuse \(copie[^»]*\) » \?/.test(await page.locator("dialog[open] h2").innerText()));
  await page.locator("dialog[open]").getByRole("button", { name: "Supprimer" }).click();
  await toast("supprimé");
  r = await anon("/fr");
  ok("A12 thème d'origine de nouveau en ligne", r.html.includes('data-theme="galerie-lumineuse"'));

  // ---- B. Pages ------------------------------------------------------------
  await page.goto(`${BASE}/admin/pages`, { waitUntil: "networkidle" });
  if (await page.locator("tr", { hasText: "Carnets d'été" }).count()) {
    throw new Error("une page « Carnets d'été » existe déjà (essai précédent interrompu) : supprime-la d'abord");
  }
  await page.getByRole("button", { name: "Créer une page" }).click();
  let d = page.locator("dialog[open]");
  await d.getByLabel("Titre en français").fill("Carnets d'été");
  await d.getByLabel("Titre en anglais").fill("Summer sketchbooks");
  ok("B1 adresses proposées depuis les titres", (await d.getByLabel("Adresse en français").inputValue()) === "carnets-d-ete" && (await d.getByLabel("Adresse en anglais").inputValue()) === "summer-sketchbooks");
  await d.getByLabel("Adresse en français").fill("admin");
  await d.getByRole("button", { name: "Créer la page" }).click();
  await d.locator(".a-field-error", { hasText: "réservé" }).waitFor();
  ok("B2 slug réservé refusé, erreur sous le champ", true);
  await d.getByLabel("Adresse en français").fill("carnets");
  await d.getByRole("button", { name: "Créer la page" }).click();
  // Le toast ne vit que 3 s et part avant la navigation : on le guette d'autant plus tôt que
  // la compilation de l'éditeur (serveur de dev) peut dépasser ce délai.
  await toast("Page créée");
  // Lot 23 : après « Créer », on arrive directement dans l'éditeur visuel de la nouvelle page.
  await page.waitForURL(/\/admin\/pages\/\d+\/editer$/, { timeout: 90000 });
  const pageId = Number(page.url().split("/").at(-2));
  ok("B3 page créée → éditeur visuel de la nouvelle page", pageId > 0);

  // Le contenu se compose dans l'éditeur : brouillon écrit, puis « Publier » (le formulaire ne porte plus les blocs).
  const published = await publishBlocks(
    page,
    BASE,
    pageId,
    () => [
      { uid: "bcontact", type: "contact", props: { eyebrow: { fr: "Contact", en: "Contact" }, title: { fr: "Écris-moi", en: "Write to me" }, intro: { fr: "Une commande ?", en: "A commission?" }, cta: { fr: "M'écrire", en: "Write" } } },
      { uid: "btexte", type: "rich-text", props: { title: { fr: "Carnets", en: "Sketchbooks" }, paragraphs: [{ fr: "Croquis d'observation, été 2026.", en: "Observation sketches, summer 2026." }] } },
    ],
    () => sdbCount(pageId) === 2,
  );
  ok("B4 contenu posé par l'éditeur (deux rubriques, dans l'ordre)", published && sdbBlocks(pageId).join(",") === "contact,rich-text", sdbBlocks(pageId).join(","));

  // Le formulaire : informations seulement, et un lien vers l'éditeur à la place de la liste des rubriques.
  await page.goto(`${BASE}/admin/pages/${pageId}`, { waitUntil: "networkidle" });
  ok("B4a le formulaire n'a plus de liste de rubriques ni de « + Ajouter une rubrique »", (await page.getByRole("button", { name: "+ Ajouter une rubrique" }).count()) === 0 && (await page.locator(".a-block").count()) === 0);
  const toEditor = page.getByRole("link", { name: "Modifier le contenu dans l'éditeur" });
  ok("B4b lien « Modifier le contenu dans l'éditeur » vers l'éditeur de la page", (await toEditor.getAttribute("href")) === `/admin/pages/${pageId}/editer` && /2 rubriques/.test(await page.locator("#pe-contenu").locator("..").innerText()));
  await page.locator("label.a-toggle", { hasText: "Publiée" }).click();
  await page.locator("label.a-toggle", { hasText: "Dans le menu" }).click();
  ok("B4c interrupteurs activés", (await page.getByRole("switch", { name: "Publiée" }).isChecked()) && (await page.getByRole("switch", { name: "Dans le menu" }).isChecked()));
  ok("B5 état « non enregistré » visible", await page.locator(".a-save-state", { hasText: "non enregistrées" }).isVisible());
  // Prévisualiser avant d'enregistrer : le formulaire prévient que l'aperçu montre la version enregistrée.
  ok("B5b l'aperçu signale qu'il montre la version enregistrée", await page.getByText("L'aperçu montre la version enregistrée").isVisible());
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await toast("Enregistré");
  ok("B5c enregistrer par le formulaire ne change pas les blocs", sdbBlocks(pageId).join(",") === "contact,rich-text");

  r = await anon("/fr/carnets");
  const posContact = r.html.indexOf("Écris-moi");
  const posText = r.html.indexOf("Croquis d&#x27;observation");
  ok("B6 page publiée : 200 en français, blocs dans l'ordre", r.status === 200 && posContact > 0 && posText > posContact, `${r.status} ${posContact} ${posText}`);
  r = await anon("/en/summer-sketchbooks");
  ok("B7 200 en anglais", r.status === 200 && r.html.includes("Observation sketches"), String(r.status));
  r = await anon("/fr");
  ok("B8 la page apparaît dans le menu public", r.html.includes('href="/fr/carnets"') && r.html.includes("Carnets d&#x27;été"));

  // Aperçu de la page (nouvel onglet) depuis le formulaire.
  const [pv] = await Promise.all([ctx.waitForEvent("page"), page.getByRole("button", { name: /Prévisualiser la page/ }).click()]);
  await pv.waitForLoadState("domcontentloaded");
  ok("B9 « Prévisualiser la page ↗ » ouvre la page enregistrée", pv.url().endsWith("/fr/carnets") && (await pv.content()).includes("Écris-moi"));
  await pv.close();

  // Dépublier depuis la liste → 404, mais l'aperçu admin la montre encore.
  await page.goto(`${BASE}/admin/pages`, { waitUntil: "networkidle" });
  const row = page.locator("tr", { hasText: "Carnets d'été" });
  await row.getByRole("button", { name: "Dépublier" }).click();
  await toast("dépubliée");
  r = await anon("/fr/carnets");
  ok("B10 page dépubliée → 404 pour les visiteurs", r.status === 404, String(r.status));
  r = await anon("/fr");
  ok("B10b retirée du menu public", !r.html.includes('href="/fr/carnets"'));
  const [pv2] = await Promise.all([ctx.waitForEvent("page"), row.getByRole("button", { name: /Prévisualiser/ }).click()]);
  await pv2.waitForLoadState("domcontentloaded");
  ok("B10c l'aperçu admin montre la page non publiée", (await pv2.content()).includes("Écris-moi") && (await pv2.content()).includes("pages non publiées visibles"));
  await pv2.close();

  // Supprimer une page référencée → bloqué avec la liste.
  await page.locator("tr", { hasText: "Personnages" }).getByRole("button", { name: "Supprimer" }).click();
  d = page.locator("dialog[open]");
  ok("B11 confirmation nomme la page", /Supprimer la page « Personnages » \?/.test(await d.locator("h2").innerText()));
  // Lot 23 : le refus est annoncé AVANT, le bouton « Supprimer » n'est jamais proposé pour une suppression refusée.
  await d.locator(".a-refs li").first().waitFor();
  const refs = await d.locator(".a-refs").innerText();
  ok("B12 suppression bloquée d'avance : rubriques référentes listés, bouton « Supprimer » inactif", /Entrées des collections|Projet mis en avant|Lien vers une page/.test(refs) && /Accueil/.test(refs) && (await d.getByRole("button", { name: "Supprimer", exact: true }).isDisabled()), refs);
  await d.getByRole("button", { name: "Annuler" }).click();
  r = await anon("/fr/personnages");
  ok("B12b la page référencée existe toujours", r.status === 200);

  // Ordre du menu : « Décors » monte en tête, enregistré, puis ordre d'origine.
  const menuBefore = await page.locator(".a-sortable-title").allInnerTexts();
  await moveWithKeyboard("Déplacer Décors", "ArrowUp", 1);
  ok("B13 nouvel ordre signalé non enregistré", await page.locator(".a-save-state", { hasText: "Nouvel ordre non enregistré" }).isVisible());
  await page.getByRole("button", { name: "Enregistrer l'ordre" }).click();
  await toast("Ordre du menu enregistré");
  r = await anon("/fr");
  ok("B14 menu public réordonné", r.html.indexOf('href="/fr/decors"') < r.html.indexOf('href="/fr/personnages"'));
  // Restauration : remettre l'ordre d'origine.
  await page.reload({ waitUntil: "networkidle" });
  const idx = menuBefore.indexOf("Décors");
  await moveWithKeyboard("Déplacer Décors", "ArrowDown", idx);
  await page.getByRole("button", { name: "Enregistrer l'ordre" }).click();
  await toast("Ordre du menu enregistré");
  ok("B15 ordre d'origine restauré", (await page.locator(".a-sortable-title").allInnerTexts()).join(",") === menuBefore.join(","));

  // Suppression de la page créée.
  await page.locator("tr", { hasText: "Carnets d'été" }).getByRole("button", { name: "Supprimer" }).click();
  await page.locator("dialog[open]").getByRole("button", { name: "Supprimer" }).click();
  await toast("Supprimé");
  r = await anon("/fr/carnets");
  ok("B16 page supprimée (corbeille) → 404", r.status === 404);

  // ---- C. Réglages ---------------------------------------------------------
  await page.goto(`${BASE}/admin/reglages`, { waitUntil: "networkidle" });
  const credit = page.locator(".a-field", { hasText: "Mention en pied de page" });
  const originalCredit = await credit.locator("input").inputValue();
  await credit.locator("input").fill("Mention modifiée par le test");
  // Réseaux (v0.13.1) : même choix de réseau que la toile (SocialPicker), adresse contrôlée à la saisie.
  const rows = page.locator(".a-socials-row");
  await rows.first().getByRole("button", { name: /^Modifier/ }).click();
  await page.getByLabel("Adresse du profil").fill("javascript:alert(1)");
  ok("C1 URL javascript: refusée à la saisie (message, bouton désactivé)", (await page.getByText(/Adresse invalide/).isVisible()) && (await page.getByRole("button", { name: "Enregistrer le lien" }).isDisabled()));
  for (let i = 0; i < (await rows.count()); i++) {
    if (i > 0) await rows.nth(i).getByRole("button", { name: /^Modifier/ }).click();
    await page.getByLabel("Adresse du profil").fill(`https://example.com/reseau-${i + 1}`);
    await page.getByRole("button", { name: "Enregistrer le lien" }).click();
  }
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await toast("Enregistré");
  r = await anon("/fr/decors");
  ok("C2 le pied de page public change", r.html.includes("Mention modifiée par le test") && r.html.includes("https://example.com/reseau-1"));
  await credit.locator("input").fill(originalCredit);
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await toast("Enregistré");
  r = await anon("/fr/decors");
  ok("C3 mention d'origine restaurée", r.html.includes(originalCredit));

  // ---- D. Polices téléchargées ---------------------------------------------
  // Pas de téléchargement réel : la bibliothèque (réglage fontLibrary) et ses fichiers sont semés dans le volume.
  const DATA = process.env.DATA_DIR ?? "data";
  const fontDir = path.join(DATA, "fonts");
  const faceOf = (file, weight, subset) => ({ weight, italic: false, subset, file, range: "U+0000-00FF", bytes: 1200 });
  const lib = {
    Lora: [faceOf("aaaaaaaaaaaaaaa1.woff2", 400, "latin"), faceOf("aaaaaaaaaaaaaaa2.woff2", 400, "latin-ext"), faceOf("aaaaaaaaaaaaaaa3.woff2", 700, "latin")],
    Merriweather: [faceOf("bbbbbbbbbbbbbbb1.woff2", 400, "latin")],
  };
  const sdb = new Database(path.join(DATA, "portfolio.db"));
  const getSet = (k) => sdb.prepare("select value from settings where key = ?").get(k)?.value ?? null;
  const putSet = (k, v) => (v === null ? sdb.prepare("delete from settings where key = ?").run(k) : sdb.prepare("insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value").run(k, v));
  const saved = { fontLibrary: getSet("fontLibrary"), styles: getSet("styles"), fontLeases: getSet("fontLeases") };
  mkdirSync(fontDir, { recursive: true });
  for (const f of Object.values(lib).flat()) writeFileSync(path.join(fontDir, f.file), Buffer.concat([Buffer.from("wOF2"), Buffer.alloc(60)]));
  putSet("fontLibrary", JSON.stringify(lib));
  putSet("fontLeases", null);
  putSet("styles", JSON.stringify({ roles: { h1: { font: "g:Lora" } } }));
  try {
    await page.goto(`${BASE}/admin/reglages`, { waitUntil: "networkidle" });
    const panel = page.getByTestId("font-library");
    const lora = panel.locator('li[data-font="Lora"]');
    const merri = panel.locator('li[data-font="Merriweather"]');
    ok("D1 liste : les deux polices semées", (await lora.count()) === 1 && (await merri.count()) === 1);
    ok("D2 poids : Lora 2 styles (400 et 700), Merriweather 1 style", /2 styles/.test(await lora.innerText()) && /1 style(?!s)/.test(await merri.innerText()));
    ok("D3 quota affiché (2 / 12 polices)", /2 \/ 12 polices/.test(await panel.locator(".a-help").first().innerText()));
    ok("D4 police utilisée : usage affiché, aucun bouton Supprimer", /Utilisée : styles du site/.test(await lora.innerText()) && (await lora.getByRole("button", { name: "Supprimer" }).count()) === 0);
    ok("D5 police inutilisée : « Inutilisée » et bouton Supprimer", /Inutilisée/.test(await merri.innerText()) && (await merri.getByRole("button", { name: "Supprimer" }).count()) === 1);
    await merri.getByRole("button", { name: "Supprimer" }).click();
    await page.locator("dialog[open]").getByRole("button", { name: "Supprimer" }).click();
    await toast("supprimée");
    await panel.locator('li[data-font="Merriweather"]').waitFor({ state: "detached", timeout: 15000 });
    ok("D6 suppression : ligne retirée, fichier effacé du volume, bibliothèque à jour", !existsSync(path.join(fontDir, "bbbbbbbbbbbbbbb1.woff2")) && existsSync(path.join(fontDir, "aaaaaaaaaaaaaaa1.woff2")) && Object.keys(JSON.parse(getSet("fontLibrary"))).join() === "Lora");
    ok("D7 quota mis à jour (1 / 12 polices)", /1 \/ 12 polices/.test(await panel.locator(".a-help").first().innerText()));
    // Côté serveur, la police utilisée est aussi protégée (action appelée sans passer par l'interface : voir test-integ-units).
  } finally {
    putSet("fontLibrary", saved.fontLibrary);
    putSet("styles", saved.styles);
    putSet("fontLeases", saved.fontLeases);
    sdb.close();
    for (const f of Object.values(lib).flat()) rmSync(path.join(fontDir, f.file), { force: true });
  }
} catch (e) {
  failures++;
  console.log("FAIL exception :", e.message.split("\n")[0]);
  await page.screenshot({ path: "e2e-echec.png", fullPage: true }).catch(() => {});
  await cleanup();
}

ok("Z aucune erreur JavaScript dans l'admin", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `e2e-admin : ${failures} échec(s)` : "e2e-admin : OK");
process.exit(failures ? 1 : 0);
