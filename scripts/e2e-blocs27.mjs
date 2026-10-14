#!/usr/bin/env node
/**
 * Blocs (v0.20, lot 27), UN chromium, UN onglet. Serveur requis, base NEUVE (seed), une connexion.
 *
 *  A. Panneau « Ajouter » : « Grille » porte ses modèles (images, vidéos) et « Contact » son modèle « Avec un formulaire »
 *     (plus de cartes à part) ; Ouverture grisée avec explication quand la page en a déjà une ; chaque modèle s'ajoute.
 *  B. Champs facultatifs sur la toile : Contact (étiquette, titre, présentation, bouton), Grille (étiquette, titre),
 *     Profil (nom, étiquettes, légende, bouton), CV : aucun texte fantôme, « + Ajouter … » / « Retirer … » au survol,
 *     le champ ajouté s'édite aussitôt.
 *  C. États vides : un Contact sans rien dit quoi faire et propose les boutons ; CV, Image, Vidéo : « Choisir dans la
 *     médiathèque » ; rien côté public.
 *  D. Ouverture une seule fois (panneau et fenêtre « Ajouter une rubrique ») ; un Profil posé sur une page qui a une
 *     Ouverture ne répète pas le nom.
 *  E. Migration 0023 : page v0.19 avec « Formulaire de contact » (publié + brouillon) migrée, rouverte, publiée ; le
 *     formulaire public répond toujours (même identifiant) ; aucun repère d'édition en public.
 * Captures : $SHOTS (défaut screenshots/blocs27).
 * Usage : DATA_DIR=… ADMIN_EMAIL=… ADMIN_PASSWORD=… BASE=http://localhost:3350 node scripts/e2e-blocs27.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const DATA = process.env.DATA_DIR ?? "data";
const DB = path.join(DATA, "portfolio.db");
const SHOTS = process.env.SHOTS ?? "screenshots/blocs27";
const ONLY = process.env.ONLY ?? "";
mkdirSync(SHOTS, { recursive: true });
const run = (k) => !ONLY || ONLY.split(",").includes(k);

let failures = 0;
function ok(label, cond, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (sql, ...args) => {
  const db = new Database(DB, { readonly: true });
  try {
    return db.prepare(sql).all(...args);
  } finally {
    db.close();
  }
};
const pageId = (slug) => q("select id from pages where json_extract(slug,'$.fr') = ?", slug)[0]?.id;
const HOME = pageId("");
const ABOUT = pageId("a-propos");
const draftOf = (id) => JSON.parse(q("select draft from pages where id = ?", id)[0]?.draft || "null");
const blocksOf = (id) => draftOf(id)?.blocks ?? [];
const lastOf = (id) => blocksOf(id).at(-1);
/** Tous les blocs du brouillon, composants des grilles compris. */
const flat = (list) => list.flatMap((b) => [b, ...flat(Array.isArray(b.props?.children) ? b.props.children : [])]);
const allOf = (id) => flat(blocksOf(id));
async function waitFor(fn, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(300);
  }
  return false;
}

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
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
async function openEditor(id) {
  await page.goto(`${BASE}/admin/pages/${id}/editer`, { waitUntil: "domcontentloaded" });
  const fr = await canvas();
  await sleep(1500);
  return fr;
}
async function section(name, fn) {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 2).join(" "));
    await page.screenshot({ path: path.join(SHOTS, `erreur-${name}.png`) }).catch(() => {});
  }
}
const palette = async () => {
  await page.getByRole("tab", { name: "Ajouter" }).click();
  await page.locator(".ve-pane .ve-group").first().waitFor({ timeout: 30000 });
};
/** Ajoute un bloc depuis le panneau (clic) et renvoie son uid (dernier du brouillon). */
async function addFromPalette(id, selector) {
  await palette();
  const known = new Set(allOf(id).map((b) => b.uid));
  const el = page.locator(selector).first();
  await el.scrollIntoViewIfNeeded();
  await el.click();
  await waitFor(() => allOf(id).length > known.size);
  await settled();
  // Le bloc ajouté se place après le bloc choisi, pas forcément en fin de page : on le reconnaît à son uid neuf.
  return allOf(id).find((b) => !known.has(b.uid));
}
/** Boutons de champ d'un bloc (opérations « + Ajouter … » / « Retirer … »). */
const ops = (f, uid) => f.locator(`[data-edit-block="${uid}"] [data-edit-field-op]`);
const opNames = async (f, uid) => (await ops(f, uid).evaluateAll((els) => els.map((e) => e.dataset.editFieldOp))).sort();
/** Clic sur un bouton de champ (le bouton n'apparaît qu'au survol : événement envoyé directement). */
async function fieldOp(f, uid, op) {
  const btn = f.locator(`[data-edit-block="${uid}"] [data-edit-field-op="${op}"]`);
  await btn.waitFor({ state: "attached", timeout: 30000 });
  await btn.dispatchEvent("click");
}
const propsOf = (id, uid) => allOf(id).find((b) => b.uid === uid)?.props;

let f = null;
let homeBlocks = {};

/* ---- A. Panneau « Ajouter » ----------------------------------------------------------------------------- */

if (run("A"))
  await section("A", async () => {
    f = await openEditor(HOME);
    await palette();
    ok("A1 « Grille » : une seule carte, plus de « Grille d'images » ni « Grille de vidéos » à part", (await page.locator('.ve-card[data-type="grid"]').count()) === 1 && (await page.locator('.ve-card[data-key="grid-images"], .ve-card[data-key="grid-videos"]').count()) === 0);
    const chips = await page.locator('.ve-models[aria-label*="Grille"] .ve-model').allTextContents();
    ok("A2 la carte Grille propose ses modèles de départ", chips.join("|") === "Avec 3 images|Avec des vidéos", chips.join("|"));
    const contactChips = await page.locator('.ve-models[aria-label*="Contact"] .ve-model').allTextContents();
    ok("A3 la carte Contact propose « Avec un formulaire » ; plus de « Formulaire de contact » dans le panneau", contactChips.join("|") === "Avec un formulaire" && !/Formulaire de contact/.test((await page.locator(".ve-pane").textContent()) ?? ""), contactChips.join("|"));
    await page.locator(".ve-pane").scrollIntoViewIfNeeded();
    await page.locator('.ve-group[data-group="grids"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, "a-panneau-modeles.png") });

    const hero = page.locator('.ve-card[data-type="hero"]');
    ok("A4 Ouverture : grisée quand la page en a déjà une", await hero.isDisabled());
    ok("A5 … avec l'explication sous la carte", /déjà une Ouverture/.test((await page.getByTestId("palette-single-note").textContent()) ?? ""));
    await hero.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, "a-ouverture-grisee.png") });
    const heroCount = () => blocksOf(HOME).filter((b) => b.type === "hero").length;
    await hero.click({ force: true }).catch(() => {});
    await sleep(500);
    ok("A6 un clic sur la carte grisée n'ajoute rien", heroCount() <= 1);

    // Les modèles s'ajoutent.
    await page.locator('.ve-model[data-key="grid-images"]').scrollIntoViewIfNeeded();
    await page.locator('.ve-model[data-key="grid-images"]').click();
    ok("A7 modèle « Avec 3 images » : grille 3 colonnes, 3 images à choisir", await waitFor(() => lastOf(HOME)?.type === "grid" && lastOf(HOME).props.layout === "3" && lastOf(HOME).props.children?.length === 3 && lastOf(HOME).props.children.every((c) => c.type === "image")), JSON.stringify(lastOf(HOME)?.props));
    homeBlocks.imageGrid = lastOf(HOME).uid;
    await settled();
    await page.locator('.ve-model[data-key="grid-videos"]').click();
    ok("A8 modèle « Avec des vidéos » : 1 grande + 2 petites", await waitFor(() => lastOf(HOME)?.props.layout === "1+2" && lastOf(HOME).props.children?.length === 3 && lastOf(HOME).props.children.every((c) => c.type === "video-single")), JSON.stringify(lastOf(HOME)?.props));
    await settled();
    await page.locator('.ve-model[data-key="contact-with-form"]').click();
    ok("A9 modèle « Avec un formulaire » : Contact avec formulaire, identifiant et 3 champs", await waitFor(() => lastOf(HOME)?.type === "contact" && lastOf(HOME).props.form === true && /^f[a-z0-9]{6,31}$/.test(lastOf(HOME).props.formId ?? "") && lastOf(HOME).props.fields?.length === 3), JSON.stringify(lastOf(HOME)?.props).slice(0, 200));
    homeBlocks.form = lastOf(HOME).uid;
    ok("A9b pas de présentation vide dans le formulaire neuf (champ absent)", !("intro" in lastOf(HOME).props) && !("eyebrow" in lastOf(HOME).props));
    await settled();
    await page.locator('.ve-card[data-type="contact"]').click();
    ok("A10 carte « Contact » : un titre et un bouton, aucun autre champ (pas de clé vide)", await waitFor(() => lastOf(HOME)?.type === "contact" && lastOf(HOME).props.form === undefined), JSON.stringify(lastOf(HOME)?.props));
    const c = lastOf(HOME);
    ok("A10b … réglages : { title, cta } seulement", Object.keys(c.props).sort().join() === "cta,title", Object.keys(c.props).join());
    homeBlocks.contact = c.uid;
    await settled();

    // Fenêtre « Ajouter une rubrique » : mêmes règles.
    const addEnd = f.locator('[data-edit-add="end"]');
    await addEnd.scrollIntoViewIfNeeded();
    await addEnd.click();
    const dlg = page.locator("dialog.ve-add");
    await dlg.waitFor({ timeout: 30000 });
    ok("A11 fenêtre : Ouverture grisée + explication", (await dlg.locator('.ve-add-card[data-type="hero"]').isDisabled()) && /déjà une Ouverture/.test((await dlg.locator(".ve-card-note").textContent()) ?? ""));
    ok("A12 fenêtre : Grille avec ses modèles, pas de cartes en double", (await dlg.locator('.ve-model[data-key^="grid-"]').count()) === 2 && (await dlg.locator('.ve-add-card[data-key^="grid-"]').count()) === 0);
    await page.screenshot({ path: path.join(SHOTS, "a-fenetre-modeles.png") });
    await page.keyboard.press("Escape");
    await dlg.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
  });

/* ---- B. Champs facultatifs sur la toile -------------------------------------------------------------------- */

if (run("B"))
  await section("B", async () => {
    if (!homeBlocks.contact) {
      f = await openEditor(HOME);
      homeBlocks.contact = (await addFromPalette(HOME, '.ve-card[data-type="contact"]')).uid;
    }
    const uid = homeBlocks.contact;
    const sel = `[data-edit-block="${uid}"]`;
    await f.locator(sel).scrollIntoViewIfNeeded();
    await f.locator(`${sel} h2`).hover();
    const add = f.locator(`${sel} [data-edit-field-op="add-eyebrow"]`);
    ok("B1 Contact : au survol, « + Ajouter une étiquette » apparaît", await waitFor(async () => (await add.evaluate((e) => getComputedStyle(e).opacity).catch(() => "0")) === "1", 15000) && /Ajouter une étiquette/.test((await add.textContent()) ?? ""));
    await page.screenshot({ path: path.join(SHOTS, "b-contact-ajouter.png") });
    ok("B2 Contact neuf : boutons attendus (étiquette, présentation à ajouter ; titre, bouton à retirer)", (await opNames(f, uid)).join() === "add-eyebrow,add-intro,remove-cta,remove-title", (await opNames(f, uid)).join());
    ok("B3 aucun texte fantôme : seuls les champs présents sont dans la page", (await f.locator(`${sel} [data-inline]`).count()) === 2 && (await f.locator(`${sel} [data-placeholder]:not([data-inline])`).count()) === 0);
    await fieldOp(f, uid, "add-eyebrow");
    ok("B4 « + Ajouter une étiquette » : clé créée dans le brouillon", await waitFor(() => propsOf(HOME, uid)?.eyebrow?.fr === ""), JSON.stringify(propsOf(HOME, uid)));
    ok("B5 … et éditée aussitôt", await f.locator('[data-editing][data-inline="eyebrow"]').waitFor({ timeout: 60000 }).then(() => true, () => false));
    await page.keyboard.type("Parlons");
    await page.keyboard.press("Enter");
    ok("B6 étiquette saisie", await waitFor(() => propsOf(HOME, uid)?.eyebrow?.fr === "Parlons"));
    await settled();
    await fieldOp(f, uid, "remove-eyebrow");
    ok("B7 « Retirer l'étiquette » : la clé disparaît", await waitFor(() => propsOf(HOME, uid) && !("eyebrow" in propsOf(HOME, uid))), JSON.stringify(propsOf(HOME, uid)));
    await settled();
    await fieldOp(f, uid, "add-intro");
    ok("B8 présentation ajoutée puis éditable", (await waitFor(() => propsOf(HOME, uid)?.intro?.fr === "")) && (await f.locator('[data-editing][data-inline="intro"]').waitFor({ timeout: 60000 }).then(() => true, () => false)));
    await page.keyboard.press("Escape");
    await settled();
    await fieldOp(f, uid, "remove-intro");
    await waitFor(() => !("intro" in (propsOf(HOME, uid) ?? { intro: 1 })));
    await settled();

    // Grille : étiquette et titre facultatifs.
    const g = homeBlocks.imageGrid;
    const gsel = `[data-edit-block="${g}"]`;
    await f.locator(gsel).scrollIntoViewIfNeeded();
    ok("B9 Grille neuve : ni étiquette ni titre sur la toile (aucune place, aucun texte d'aide)", (await f.locator(`${gsel} > section > h2, ${gsel} section.block-grid-section > h2, ${gsel} .eyebrow`).count()) === 0 && (await opNames(f, g)).join() === "add-eyebrow,add-title", (await opNames(f, g)).join());
    await fieldOp(f, g, "add-title");
    ok("B10 Grille : « + Ajouter un titre » crée le titre, édité aussitôt", (await waitFor(() => propsOf(HOME, g)?.title?.fr === "")) && (await f.locator('[data-editing][data-inline="title"]').waitFor({ timeout: 60000 }).then(() => true, () => false)));
    await page.keyboard.type("Mes images");
    await page.keyboard.press("Enter");
    await waitFor(() => propsOf(HOME, g)?.title?.fr === "Mes images");
    await settled();
    ok("B11 Grille : le titre est sur la toile et « Retirer le titre » est proposé", (await f.locator(`${gsel} h2`).first().textContent())?.trim() === "Mes images" && (await opNames(f, g)).includes("remove-title"));
    await page.screenshot({ path: path.join(SHOTS, "b-grille-titre.png") });
    await fieldOp(f, g, "remove-title");
    ok("B12 Grille : titre retiré, clé supprimée", await waitFor(() => !("title" in (propsOf(HOME, g) ?? { title: 1 }))));
    await settled();

    // CV : étiquette et titre de départ, présentation à ajouter.
    const cv = await addFromPalette(HOME, '.ve-card[data-type="cv"]');
    const csel = `[data-edit-block="${cv.uid}"]`;
    await f.locator(csel).scrollIntoViewIfNeeded();
    ok("B13 CV : boutons de champ (étiquette, titre, présentation)", (await opNames(f, cv.uid)).join() === "add-intro,remove-eyebrow,remove-title", (await opNames(f, cv.uid)).join());
    await fieldOp(f, cv.uid, "remove-eyebrow");
    await fieldOp(f, cv.uid, "remove-title");
    ok("B14 CV : champs retirés (clés supprimées, plus de texte à l'écran)", (await waitFor(() => !("eyebrow" in (propsOf(HOME, cv.uid) ?? { eyebrow: 1 })) && !("title" in (propsOf(HOME, cv.uid) ?? { title: 1 })))) && (await f.locator(`${csel} [data-inline]`).count()) === 0);
    await settled();
    homeBlocks.cv = cv.uid;

    // Profil (page À propos) : nom, étiquettes, légende, bouton.
    f = await openEditor(ABOUT);
    const prof = await f.locator('[data-edit-type="profile"]').first().getAttribute("data-edit-block");
    const psel = `[data-edit-block="${prof}"]`;
    await f.locator(psel).scrollIntoViewIfNeeded();
    ok("B15 Profil : le nom est affiché, « Retirer ton nom » proposé", (await f.locator(`${psel} h1`).count()) === 1 && (await opNames(f, prof)).includes("remove-name"), (await opNames(f, prof)).join());
    await page.screenshot({ path: path.join(SHOTS, "b-profil-avant.png") });
    await fieldOp(f, prof, "remove-name");
    ok("B16 « Retirer ton nom » : showName false dans le brouillon, plus de h1 sur la toile", (await waitFor(() => propsOf(ABOUT, prof)?.showName === false)) && (await waitFor(async () => (await f.locator(`${psel} h1`).count()) === 0)), JSON.stringify(propsOf(ABOUT, prof)));
    await settled();
    await fieldOp(f, prof, "add-name");
    ok("B17 « + Ajouter ton nom » le rétablit (clé showName supprimée)", (await waitFor(() => !("showName" in (propsOf(ABOUT, prof) ?? { showName: 1 })))) && (await waitFor(async () => (await f.locator(`${psel} h1`).count()) === 1)));
    await settled();
    await fieldOp(f, prof, "remove-contact-label");
    ok("B18 Profil : « Retirer le bouton e-mail » supprime le bouton (clé retirée, adresse gardée)", (await waitFor(() => !("contactLabel" in (propsOf(ABOUT, prof) ?? { contactLabel: 1 })))) && (await f.locator(`${psel} a.btn`).count()) === 0 && (await f.locator(`${psel} .email-link`).count()) === 1);
    await settled();
    await fieldOp(f, prof, "remove-caption");
    ok("B18b Profil : « Retirer la légende » supprime la clé et le texte à l'écran", (await waitFor(() => !("portraitCaption" in (propsOf(ABOUT, prof) ?? { portraitCaption: 1 })))) && (await f.locator(`${psel} [data-inline="portraitCaption"]`).count()) === 0);
    await settled();
    await fieldOp(f, prof, "add-caption");
    ok("B19 Profil : « + Ajouter une légende » crée la légende, éditée aussitôt", (await waitFor(() => propsOf(ABOUT, prof)?.portraitCaption?.fr === "")) && (await f.locator('[data-editing][data-inline="portraitCaption"]').waitFor({ timeout: 60000 }).then(() => true, () => false)));
    await page.keyboard.press("Escape");
    await settled();
    await page.screenshot({ path: path.join(SHOTS, "b-profil-apres.png") });
  });

/* ---- C. États vides --------------------------------------------------------------------------------------- */

if (run("C"))
  await section("C", async () => {
    f = await openEditor(HOME);
    if (!homeBlocks.contact || !allOf(HOME).some((b) => b.uid === homeBlocks.contact)) homeBlocks.contact = (await addFromPalette(HOME, '.ve-card[data-type="contact"]')).uid;
    const uid = homeBlocks.contact;
    const sel = `[data-edit-block="${uid}"]`;
    await f.locator(sel).scrollIntoViewIfNeeded();
    await fieldOp(f, uid, "remove-title");
    await fieldOp(f, uid, "remove-cta");
    ok("C1 Contact sans aucun champ : réglages vides dans le brouillon", await waitFor(() => Object.keys(propsOf(HOME, uid) ?? { x: 1 }).length === 0), JSON.stringify(propsOf(HOME, uid)));
    await settled();
    const empty = f.locator(`${sel} .pe-empty-block`);
    ok("C2 un message dit quoi faire (pas un cadre muet)", await empty.waitFor({ timeout: 30000 }).then(() => true, () => false));
    ok("C3 … avec des boutons d'action (titre, présentation, bouton e-mail)", (await empty.locator(".pe-empty-action").allTextContents()).join("|") === "+ Ajouter un titre|+ Ajouter une présentation|+ Ajouter un bouton e-mail", (await empty.locator(".pe-empty-action").allTextContents()).join("|"));
    await empty.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, "c-contact-vide.png") });
    ok("C3b rien d'autre dans le bloc (ni a.btn, ni titre, ni texte d'aide)", (await f.locator(`${sel} a.btn, ${sel} h2, ${sel} [data-placeholder]`).count()) === 0);
    await empty.locator('[data-edit-field-op="add-title"]').click();
    ok("C4 le bouton « + Ajouter un titre » de l'état vide crée le titre", await waitFor(() => propsOf(HOME, uid)?.title?.fr === ""));
    await page.keyboard.type("Écris-moi");
    await page.keyboard.press("Enter");
    await settled();
    ok("C5 l'état vide disparaît dès qu'un champ existe", await waitFor(async () => (await f.locator(`${sel} .pe-empty-block`).count()) === 0));

    // Médias vides : message + bouton.
    const cvUid = homeBlocks.cv && allOf(HOME).some((b) => b.uid === homeBlocks.cv) ? homeBlocks.cv : (await addFromPalette(HOME, '.ve-card[data-type="cv"]')).uid;
    const cvEmpty = f.locator(`[data-edit-block="${cvUid}"] .pe-media-pdf`);
    await cvEmpty.scrollIntoViewIfNeeded();
    ok("C6 CV sans PDF : « Dépose ton CV » + bouton « Choisir dans la médiathèque »", /Dépose ton CV/.test((await cvEmpty.textContent()) ?? "") && (await cvEmpty.locator(".pe-empty-action").count()) === 1);
    await page.screenshot({ path: path.join(SHOTS, "c-cv-vide.png") });
    await cvEmpty.locator(".pe-empty-action").click();
    ok("C7 le bouton ouvre le choix de la médiathèque", await page.locator("dialog[open]").first().waitFor({ timeout: 30000 }).then(() => true, () => false));
    await page.keyboard.press("Escape");
    await sleep(500);
    const img = await addFromPalette(HOME, '.ve-card[data-type="image"]');
    const imgEmpty = f.locator(`[data-edit-block="${img.uid}"] .pe-media-empty`);
    await imgEmpty.scrollIntoViewIfNeeded();
    ok("C8 Image sans fichier : bouton « Choisir dans la médiathèque »", (await imgEmpty.locator(".pe-empty-action").count()) === 1);
    const vid = await addFromPalette(HOME, '.ve-card[data-type="video-single"]');
    ok("C9 Vidéo sans fichier : bouton « Choisir dans la médiathèque »", (await f.locator(`[data-edit-block="${vid.uid}"] .pe-media-video .pe-empty-action`).count()) === 1);
  });

/* ---- D. Ouverture une seule fois, Profil sans nom répété --------------------------------------------------- */

if (run("D"))
  await section("D", async () => {
    // Page À propos : pas d'Ouverture au départ.
    f = await openEditor(ABOUT);
    await palette();
    const hero = page.locator('.ve-card[data-type="hero"]');
    ok("D1 sans Ouverture sur la page : la carte est active, sans note", !(await hero.isDisabled()) && (await page.getByTestId("palette-single-note").count()) === 0);
    await hero.click();
    ok("D2 Ouverture ajoutée", await waitFor(() => blocksOf(ABOUT).filter((b) => b.type === "hero").length === 1));
    await settled();
    ok("D3 elle est aussitôt grisée, avec l'explication", (await hero.isDisabled()) && /déjà une Ouverture/.test((await page.getByTestId("palette-single-note").textContent()) ?? ""));
    const n = blocksOf(ABOUT).length;
    await page.locator('.ve-card[data-type="profile"]').click();
    ok("D4 Profil posé sur une page qui a une Ouverture : le nom n'est pas répété (showName false)", await waitFor(() => blocksOf(ABOUT).length === n + 1 && lastOf(ABOUT).type === "profile" && lastOf(ABOUT).props.showName === false), JSON.stringify(lastOf(ABOUT)?.props));
    await settled();
    const last = lastOf(ABOUT).uid;
    ok("D5 … et son bouton « + Ajouter ton nom » le rétablit", (await opNames(f, last)).includes("add-name"));
    await page.screenshot({ path: path.join(SHOTS, "d-profil-sans-nom.png") });
  });

/* ---- E. Migration 0023, page v0.19 rouverte, publiée -------------------------------------------------------- */

if (run("E"))
  await section("E", async () => {
    const lib = (action) => JSON.parse(execFileSync("node", ["--import", "tsx", "scripts/lib/legacy-blocs.mjs", DATA, action], { encoding: "utf8", env: process.env }).trim().split("\n").pop());
    const legacy = lib("seed");
    const FORM = "fe2eblocs01";
    ok("E0 base v0.19 simulée : un « Formulaire de contact » publié et deux dans le brouillon", q("select count(*) n from blocks where page_id = ? and type = 'contact-form'", legacy.id)[0].n === 1 && JSON.stringify(draftOf(legacy.id)).match(/"type":"contact-form"/g).length === 2);
    const rev0 = q("select draft_rev r from pages where id = ?", legacy.id)[0].r;
    const report = lib("migrate");
    ok("E1 migration : 3 formulaires convertis (1 publié + 2 brouillon), au moins 1 ligne publiée et 1 brouillon réécrits", report.forms === 3 && report.published >= 1 && report.drafts >= 1, JSON.stringify(report));
    ok("E2 plus aucun « Formulaire de contact » : publié ni brouillon", q("select count(*) n from blocks where page_id = ? and type = 'contact-form'", legacy.id)[0].n === 0 && !JSON.stringify(draftOf(legacy.id)).includes('"contact-form"'));
    const pub = q("select type, props from blocks where page_id = ? order by position", legacy.id).map((b) => ({ type: b.type, props: JSON.parse(b.props) }));
    ok("E3 publié : Contact avec formulaire, même identifiant et mêmes champs ; champs vides retirés", pub[1].type === "contact" && pub[1].props.form === true && pub[1].props.formId === FORM && pub[1].props.fields.length === 3 && !("intro" in pub[1].props) && !("eyebrow" in pub[2].props) && !("intro" in pub[2].props) && !("eyebrow" in pub[3].props), JSON.stringify(pub.map((b) => Object.keys(b.props))));
    ok("E4 brouillon : version augmentée (onglet ouvert = conflit)", q("select draft_rev r from pages where id = ?", legacy.id)[0].r === rev0 + 1);
    const again = lib("migrate");
    ok("E5 migration idempotente : second passage sans effet", again.published === 0 && again.drafts === 0 && again.forms === 0, JSON.stringify(again));

    f = await openEditor(legacy.id);
    const tops = await f.locator("[data-edit-block]:not([data-edit-parent])").evaluateAll((els) => els.map((e) => ({ type: e.dataset.editType, uid: e.dataset.editBlock })));
    ok("E6 éditeur : Contact (formulaire), Contact, Grille… dans l'ordre", tops.map((t) => t.type).join() === "rich-text,contact,contact,grid,contact,contact", tops.map((t) => t.type).join());
    ok("E7 le formulaire migré est modifiable sur la toile", (await f.locator(`[data-edit-block="${tops[1].uid}"] form[data-form-edit]`).count()) === 1);
    const emptyContact = tops[4];
    ok("E8 le Contact entièrement vide du brouillon affiche l'état vide utile", await f.locator(`[data-edit-block="${emptyContact.uid}"] .pe-empty-block`).count() === 1);
    await f.locator(`[data-edit-block="${tops[1].uid}"]`).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOTS, "e-formulaire-migre-editeur.png") });
    // Le brouillon garde un Contact vide (travail en cours) : le retirer avant de publier.
    await f.locator(`[data-edit-block="${emptyContact.uid}"] .pe-empty-block`).click({ position: { x: 4, y: 4 } });
    await page.keyboard.press("Delete");
    await sleep(500);
    if (await page.getByRole("button", { name: /Supprimer le bloc/ }).count()) await page.getByRole("button", { name: /Supprimer le bloc/ }).click();
    await settled();
    await page.getByRole("button", { name: "Publier", exact: true }).click();
    ok("E9 publication acceptée", await waitFor(async () => /Publié/.test((await page.locator(".ve-status").textContent()) ?? ""), 120000), await page.locator(".ve-status").textContent());
    const pubPage = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await pubPage.goto(`${BASE}/fr/${legacy.slug}`, { waitUntil: "networkidle" });
    const html = await pubPage.content();
    ok("E10 public : formulaire de contact rendu (champs, bouton Envoyer)", /name="femail"|id="femail"|femail/.test(html) && /Envoyer/.test(html) && /<form/.test(html));
    const leak = await pubPage.evaluate(() => [...document.querySelectorAll("[data-placeholder], [data-edit-block], [data-inline], [class*='pe-empty'], .pe-field-op, [data-edit-field-op]")].map((e) => e.outerHTML.slice(0, 120)));
    ok("E11 public : aucun repère d'édition, aucun texte d'aide, aucun état vide", leak.length === 0 && !/data-edit-(?!media)/.test(html.replace(/self\.__next_f[\s\S]*?<\/script>/g, "")), leak.slice(0, 2).join(" ⟂ "));
    await pubPage.screenshot({ path: path.join(SHOTS, "e-public-contact-migre.png"), fullPage: true });
    const res = await fetch(`${BASE}/api/contact`, { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", "x-forwarded-for": "198.51.100.77" }, body: JSON.stringify({ form: FORM, locale: "fr", values: { femail: "lou@example.test", fmessage: "Bonjour depuis le test" } }) });
    ok("E12 le formulaire migré répond toujours (même identifiant, POST /api/contact)", res.status === 200, String(res.status));
    ok("E13 le message est rangé avec l'objet du formulaire", q("select count(*) n from messages where subject = 'Message du test'")[0].n >= 1);
    const voidSections = await pubPage.evaluate(() => [...document.querySelectorAll("h2:empty, .eyebrow:empty, p:empty")].length);
    ok("E14 public : aucun titre, étiquette ou paragraphe vide", voidSections === 0, String(voidSections));
    await pubPage.context().close();
  });

ok("aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
