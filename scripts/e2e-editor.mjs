#!/usr/bin/env node
/**
 * Éditeur visuel (phase 7a), UN chromium. Serveur dev requis (redémarré,
 * pré-chauffé), une connexion. Travaille sur la page d'accueil et la remet
 * dans son état publié d'origine à la fin.
 *
 * Ouverture depuis Pages, le Tableau de bord et le site public (bouton
 * « Modifier cette page » : admin seulement, absent du HTML) ; glisser un
 * Texte entre deux blocs ; titre modifié en place en FR puis en EN ; monter,
 * dupliquer, supprimer (confirmation), Annuler ; clavier (Tab, Entrée, Suppr,
 * Échap) ; Aperçu sans aucun élément d'édition ; le visiteur voit la version
 * publiée, puis la nouvelle après « Publier » ; « Abandonner ». Captures
 * 1440 et 390 dans screenshots/phase7a.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… node scripts/e2e-editor.mjs
 */
import { mkdirSync } from "node:fs";

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const SHOTS = "screenshots/phase7a";
mkdirSync(SHOTS, { recursive: true });
const SHOTS2 = "screenshots/phase7a2";
mkdirSync(SHOTS2, { recursive: true });
const TITLE_FR = "Carnet d'atelier";
const TITLE_EN = "Studio notebook";

let failures = 0;
function ok(label, cond, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());

await page.goto(`${BASE}/admin/connexion`, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL);
await page.fill("#password", PASSWORD);
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/admin/connexion"), { timeout: 60000 }), page.click("button[type=submit]")]);

/* ---- Aides ---------------------------------------------------------------- */

async function canvas(p = page) {
  const handle = await p.waitForSelector("iframe.ve-frame", { timeout: 60000 });
  const f = await handle.contentFrame();
  await f.waitForSelector("html[data-edit-mode]", { timeout: 90000 });
  return f;
}
// Blocs de la page (les composants des conteneurs, v0.13, ne comptent pas ici).
const blocksOf = (f) => f.$$eval("[data-edit-block]:not([data-edit-parent])", (els) => els.map((e) => ({ uid: e.dataset.editBlock, type: e.dataset.editType, text: e.textContent ?? "" })));
const status = (p = page) => p.locator(".ve-status").innerText();
/** Enregistrement terminé (plus de « Enregistrement… »). */
async function settled(p = page) {
  await p.waitForFunction(() => !/Enregistrement/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, { timeout: 60000 });
}
/** Attend que la toile reflète une condition (rafraîchissement après enregistrement). */
async function until(f, fn, arg, timeout = 60000) {
  return f.waitForFunction(fn, arg, { timeout, polling: 200 }).then(
    () => true,
    () => false,
  );
}
const countIs = (f, n) => until(f, (n) => document.querySelectorAll("[data-edit-block]:not([data-edit-parent])").length === n, n);
/** Rectangle d'un bloc (réunion de ses enfants), coordonnées de la fenêtre de la toile. */
const blockRect = (f, i) =>
  f.evaluate((i) => {
    const el = document.querySelectorAll("[data-edit-block]:not([data-edit-parent])")[i];
    let top = Infinity;
    let bottom = -Infinity;
    for (const c of el.querySelectorAll("*")) {
      const r = c.getBoundingClientRect();
      if (!r.height) continue;
      top = Math.min(top, r.top);
      bottom = Math.max(bottom, r.bottom);
    }
    return { top, bottom };
  }, i);
/** « Abandonner les modifications » confirmé ; attend le rechargement de l'éditeur. */
async function discardAll(p = page) {
  // Écran étroit : le bouton est dans la feuille « ＋ Composants ».
  const fab = p.locator(".ve-fab");
  if (await fab.isVisible().catch(() => false)) await fab.click();
  await p.getByRole("button", { name: "Abandonner les modifications" }).click();
  await Promise.all([
    p.waitForEvent("framenavigated", { predicate: (fr) => fr === p.mainFrame(), timeout: 60000 }),
    p.getByRole("dialog").getByRole("button", { name: "Abandonner les modifications" }).click(),
  ]);
  await p.waitForLoadState("domcontentloaded");
  return canvas(p);
}
async function openFresh(p = page, url = `${BASE}/admin/pages/1/editer`) {
  await p.goto(url, { waitUntil: "domcontentloaded" });
  const f = await canvas(p);
  // Point de départ : la version publiée.
  if (await p.getByRole("button", { name: "Abandonner les modifications" }).count()) return discardAll(p);
  return f;
}

/* ---- Entrées ---------------------------------------------------------------- */

await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
ok("Tableau de bord : « Modifier la page d'accueil » mène à l'éditeur", (await page.getByRole("link", { name: "Modifier la page d'accueil" }).getAttribute("href")) === "/admin/pages/1/editer");
await page.goto(`${BASE}/admin/pages`, { waitUntil: "networkidle" });
await page.locator("td[data-label=Page] a").first().click();
await page.waitForURL(/\/admin\/pages\/1\/editer/, { timeout: 60000 });
ok("Pages : un clic sur la page ouvre l'éditeur", page.url().includes("/admin/pages/1/editer"));
let f = await openFresh();
const published = await blocksOf(f);
ok("toile en vue brouillon avec ses blocs repérés", published.length >= 3, String(published.length));
ok("état « Publié » sans brouillon", /Publié/.test(await status()), await status());
await sleep(800);
await page.screenshot({ path: `${SHOTS}/1440-normal.png` });

/* ---- Clavier : Tab, Entrée, Échap ------------------------------------------ */

// Focus au début du document de la toile, puis Tab.
await f.evaluate(() => {
  window.focus();
  document.body.tabIndex = -1;
  document.body.focus();
  document.body.removeAttribute("tabindex");
});
await page.keyboard.press("Tab");
const focused = await f.evaluate(() => document.activeElement?.className ?? "");
ok("Tab dans la toile : le premier arrêt est un bloc", focused.includes("pe-focus"), focused);
await page.keyboard.press("Enter");
ok("Entrée sélectionne le bloc", await until(f, () => Boolean(document.querySelector(".pe-selected"))));
await page.keyboard.press("Escape");
ok("Échap désélectionne", await until(f, () => !document.querySelector(".pe-selected")));

/* ---- Glisser un Texte entre deux blocs ------------------------------------- */

// Repère entre les blocs 2 et 3 (index 1 et 2), amené au milieu de la toile.
await f.evaluate(() => {
  const el = document.querySelectorAll("[data-edit-block]:not([data-edit-parent])")[2];
  const c = [...el.querySelectorAll("*")].find((x) => x.getBoundingClientRect().height);
  // Défilement immédiat (le site peut demander un défilement doux).
  window.scrollTo({ top: window.scrollY + c.getBoundingClientRect().top - window.innerHeight / 2, behavior: "instant" });
});
await sleep(300);
const a = await blockRect(f, 1);
const b = await blockRect(f, 2);
const frameBox = await page.locator("iframe.ve-frame").boundingBox();
const targetY = frameBox.y + (a.bottom + b.top) / 2;
const targetX = frameBox.x + frameBox.width / 2;
const card = page.locator('.ve-card[data-type="rich-text"]');
// Palette plus longue en v0.13 : la carte est amenée à l'écran.
await card.scrollIntoViewIfNeeded();
const cb = await card.boundingBox();
await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
await page.mouse.down();
await page.mouse.move(cb.x + cb.width / 2 + 12, cb.y + cb.height / 2 + 8, { steps: 3 });
await page.mouse.move(targetX, targetY, { steps: 18 });
await sleep(250);
ok("repère d'insertion « Déposer ici » pendant le glisser", (await f.locator(".pe-marker").count()) === 1, `fantôme ${await page.locator(".ve-ghost").count()}, cible ${Math.round(targetX)},${Math.round(targetY)}`);
await page.screenshot({ path: `${SHOTS}/1440-glisser.png` });
await page.mouse.up();
ok("Texte inséré entre les blocs 2 et 3", await until(f, (n) => {
  const els = document.querySelectorAll("[data-edit-block]:not([data-edit-parent])");
  return els.length === n && els[2]?.dataset.editType === "rich-text";
}, published.length + 1), JSON.stringify((await blocksOf(f)).map((x) => x.type)));
await settled();
ok("état « Brouillon enregistré »", /Brouillon enregistré/.test(await status()), await status());
let blocks = await blocksOf(f);
const textUid = blocks[2].uid;
ok("le nouveau bloc est sélectionné", await until(f, (uid) => Boolean(document.querySelector(".pe-selected")) && document.querySelectorAll("[data-edit-block]:not([data-edit-parent])")[2]?.dataset.editBlock === uid, textUid));

/* ---- Titre modifié en place, FR puis EN ------------------------------------ */

const titleSel = (uid) => `[data-edit-block="${uid}"] [data-inline="title"]`;
// Le Texte de la palette est un paragraphe seul (lot 19a) : son titre s'ajoute au survol, puis se saisit d'une frappe sur le texte d'aide.
await f.locator(`[data-edit-block="${textUid}"] [data-inline="paragraphs.0"]`).hover();
await f.locator(`[data-edit-block="${textUid}"] [data-edit-field-op="add-title"]`).click();
await f.locator(`${titleSel(textUid)}[contenteditable]`).waitFor({ timeout: 30000 });
ok("« + Ajouter un titre » : le titre devient modifiable", (await f.locator(titleSel(textUid)).getAttribute("contenteditable")) !== null);
await page.keyboard.type(TITLE_FR);
await page.keyboard.press("Enter");
await settled();
ok("titre FR enregistré et rendu", await until(f, ([uid, t]) => document.querySelector(`[data-edit-block="${uid}"] [data-inline="title"]`)?.textContent === t && !document.querySelector("[data-editing]"), [textUid, TITLE_FR]));
await page.getByRole("tab", { name: "Réglages" }).click();
ok("Réglages : le formulaire du bloc sélectionné", await page.locator(".ve-settings h2", { hasText: "Texte" }).isVisible());
await sleep(600);
await page.screenshot({ path: `${SHOTS}/1440-selection.png` });
await page.getByRole("tab", { name: "Ajouter" }).click();

await page.getByRole("group", { name: "Langue" }).getByRole("button", { name: "EN" }).click();
f = await canvas();
ok("toile en anglais", (await f.evaluate(() => document.documentElement.lang)) === "en");
await f.locator(titleSel(textUid)).scrollIntoViewIfNeeded();
await f.locator(titleSel(textUid)).dblclick();
await page.keyboard.type(TITLE_EN);
await page.keyboard.press("Enter");
await settled();
ok("titre EN enregistré, sans toucher au FR", await until(f, ([uid, t]) => document.querySelector(`[data-edit-block="${uid}"] [data-inline="title"]`)?.textContent === t, [textUid, TITLE_EN]));
await page.getByRole("group", { name: "Langue" }).getByRole("button", { name: "FR" }).click();
f = await canvas();
ok("retour en FR : titre FR intact", await until(f, ([uid, t]) => document.querySelector(`[data-edit-block="${uid}"] [data-inline="title"]`)?.textContent === t, [textUid, TITLE_FR]));

/* ---- Monter, dupliquer, supprimer, Annuler --------------------------------- */

await f.locator(titleSel(textUid)).click();
await until(f, () => Boolean(document.querySelector(".pe-tools")));
await f.locator(".pe-tools").getByRole("button", { name: "Monter" }).click();
ok("monter : le Texte passe en 2ᵉ position", await until(f, (uid) => document.querySelectorAll("[data-edit-block]:not([data-edit-parent])")[1]?.dataset.editBlock === uid, textUid));
await settled();
await f.locator(".pe-tools").getByRole("button", { name: "Dupliquer" }).click();
ok("dupliquer : un bloc de plus, copie juste après", await until(f, (n) => {
  const els = document.querySelectorAll("[data-edit-block]:not([data-edit-parent])");
  return els.length === n && els[2]?.dataset.editType === "rich-text" && els[2].textContent.includes("Carnet");
}, published.length + 2));
await settled();
blocks = await blocksOf(f);
const copyUid = blocks[2].uid;
await f.locator(".pe-tools").getByRole("button", { name: "Supprimer" }).click();
const confirm = page.getByRole("dialog");
const shown = () => confirm.waitFor({ state: "visible", timeout: 10000 }).then(() => true, () => false);
ok("supprimer demande confirmation", await shown());
await confirm.getByRole("button", { name: "Supprimer le bloc" }).click();
ok("supprimé", await countIs(f, published.length + 1));
await settled();
await page.keyboard.press("Control+z");
ok("Annuler (Ctrl+Z) le récupère", await until(f, (uid) => Boolean(document.querySelector(`[data-edit-block="${uid}"]`)), copyUid));
await settled();
// Suppr au clavier : confirmation, Échap l'abandonne.
await f.locator(titleSel(copyUid)).click();
await until(f, () => Boolean(document.querySelector(".pe-selected")));
await page.keyboard.press("Delete");
ok("Suppr sur le bloc choisi : confirmation", await shown());
await page.keyboard.press("Escape");
ok("Échap ferme la confirmation sans supprimer", (await confirm.waitFor({ state: "hidden", timeout: 10000 }).then(() => true, () => false)) && (await blocksOf(f)).length === published.length + 2);

/* ---- Aperçu ------------------------------------------------------------------ */

await page.getByRole("button", { name: "Aperçu", exact: true }).click();
ok("Aperçu : ni barre ni panneau", await until(page.mainFrame(), () => !document.querySelector(".ve-top") && !document.querySelector(".ve-panel")));
ok("Aperçu : aucun élément d'édition dans la page", await until(f, () => !document.documentElement.hasAttribute("data-edit-mode") && !document.querySelector(".pe-layer")));
ok("Aperçu : la page du brouillon", (await f.locator("body").innerText()).includes(TITLE_FR));
await sleep(500);
await page.screenshot({ path: `${SHOTS}/1440-apercu.png` });
await page.keyboard.press("Escape");
ok("Échap quitte l'aperçu", await until(page.mainFrame(), () => Boolean(document.querySelector(".ve-top"))));
await canvas();

/* ---- Visiteur : version publiée, puis la nouvelle --------------------------- */

const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const visitor = await anon.newPage();
await visitor.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
ok("visiteur : la version publiée (pas le brouillon)", !(await visitor.locator("body").innerText()).includes(TITLE_FR));
await sleep(1200);
ok("visiteur : pas de bouton « Modifier cette page »", (await visitor.getByText("Modifier cette page").count()) === 0);
const rawHtml = await (await anon.request.get(`${BASE}/fr`)).text();
ok("HTML public sans bouton ni repère d'édition", !/Modifier cette page|data-edit-block|data-inline|pe-layer/.test(rawHtml));
await page.getByRole("button", { name: "Publier" }).click();
ok("Publier : toast « Publié »", await until(page.mainFrame(), () => /Publié : la page est en ligne/.test(document.body.innerText), null, 60000));
ok("état « Publié à l'instant »", /Publié/.test(await status()), await status());
await visitor.reload({ waitUntil: "networkidle" });
ok("visiteur : la nouvelle version après Publier", (await visitor.locator("body").innerText()).includes(TITLE_FR));

/* ---- Depuis le site public ------------------------------------------------------ */

const site = await ctx.newPage();
await site.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
const editThis = site.getByRole("link", { name: "Modifier cette page" });
// `isVisible` n'attend pas : le bouton apparaît après la lecture de la session (client), parfois > 1 s en CI.
ok("admin : bouton « Modifier cette page » sur le site", await editThis.waitFor({ state: "visible", timeout: 15000 }).then(() => true, () => false));
await editThis.click();
await site.waitForURL(/\/admin\/pages\/1\/editer\?langue=fr/, { timeout: 60000 });
ok("le bouton ouvre l'éditeur de la page, dans sa langue", site.url().includes("/admin/pages/1/editer?langue=fr"));
await site.close();

/* ---- Abandonner -------------------------------------------------------------------- */

f = await canvas();
const before = (await blocksOf(f)).length;
await page.locator('.ve-card[data-type="contact"]').click();
ok("clic sur un composant : ajouté", await countIs(f, before + 1));
await settled();
ok("« Abandonner les modifications » proposé", await page.getByRole("button", { name: "Abandonner les modifications" }).isVisible());
f = await discardAll();
ok("abandon : retour à la version publiée", (await blocksOf(f)).length === before && /Publié/.test(await status()), `${(await blocksOf(f)).length} / ${before}`);

/* ---- Barre d'état : les états explicites, et « modifié ailleurs » ---------- */

const bar = async (name) => {
  await sleep(150);
  await page.screenshot({ path: `${SHOTS2}/etat-${name}.png`, clip: { x: 0, y: 0, width: 1440, height: 56 } });
};
ok("état « Publié » (point vert)", /^Publié/.test((await status()).trim()) && (await page.locator(".ve-status").getAttribute("data-tone")) === "ok", await status());
await bar("publie");
// Enregistrement ralenti : l'état « Enregistrement… » reste visible.
const slow = async (route) => {
  if (route.request().method() === "POST") await sleep(2500);
  await route.continue();
};
await page.route("**/admin/pages/1/editer**", slow);
await page.locator('.ve-card[data-type="rich-text"]').click();
ok("état « Enregistrement… »", await until(page.mainFrame(), () => /Enregistrement…/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, 5000));
await bar("enregistrement");
await settled();
await page.unroute("**/admin/pages/1/editer**", slow);
ok("état « Brouillon enregistré » (point orange)", /Brouillon enregistré/.test(await status()) && (await page.locator(".ve-status").getAttribute("data-tone")) === "draft", await status());
await bar("brouillon-enregistre");
// Connexion coupée : « Erreur d'enregistrement », avec la raison et « Réessayer ».
const cut = (route) => (route.request().method() === "POST" ? route.abort() : route.continue());
await page.route("**/admin/pages/1/editer**", cut);
await page.locator('.ve-card[data-type="contact"]').click();
ok("état « Erreur d'enregistrement » avec la raison", await until(page.mainFrame(), () => /Erreur d'enregistrement\s*· \S.+/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, 15000), await status());
await bar("erreur");
await page.unroute("**/admin/pages/1/editer**", cut);
await page.locator(".ve-status").getByRole("button", { name: "Réessayer" }).click();
await settled();
ok("Réessayer : brouillon enregistré", /Brouillon enregistré/.test(await status()), await status());
// Deux onglets : le second enregistre, le premier est arrêté sans rien écraser.
const other = await ctx.newPage();
other.on("pageerror", (e) => errors.push(e.message));
await other.goto(`${BASE}/admin/pages/1/editer`, { waitUntil: "domcontentloaded" });
const of = await canvas(other);
const otherBefore = (await blocksOf(of)).length;
await other.locator('.ve-card[data-type="rich-text"]').click();
await countIs(of, otherBefore + 1);
await settled(other);
await page.locator('.ve-card[data-type="contact"]').click();
const conflictBanner = page.getByTestId("conflict");
ok("onglet en retard : bandeau « Cette page a été modifiée ailleurs »", await conflictBanner.waitFor({ state: "visible", timeout: 30000 }).then(() => true, () => false));
ok("état « Modifié ailleurs » (rouge)", /Modifié ailleurs/.test(await status()) && (await page.locator(".ve-status").getAttribute("data-tone")) === "error", await status());
await bar("modifie-ailleurs");
await conflictBanner.locator("summary").click();
{
  const texts = await conflictBanner.locator("textarea").inputValue();
  ok("les textes en cours restent consultables (à copier), sans balise interne", texts.includes("FR : ") && !texts.includes("<mark>") && /« [^»]+ »/.test(texts), texts.slice(0, 160));
}
await sleep(300);
await page.screenshot({ path: `${SHOTS2}/modifie-ailleurs.png` });
await other.close();
await Promise.all([page.waitForEvent("framenavigated", { predicate: (fr) => fr === page.mainFrame(), timeout: 60000 }), conflictBanner.getByRole("button", { name: "Recharger" }).click()]);
f = await canvas();
ok("Recharger : la version de l'autre onglet, sans conflit", (await blocksOf(f)).length === otherBefore + 1 && /Brouillon enregistré/.test(await status()), `${(await blocksOf(f)).length} · ${await status()}`);
f = await discardAll();

/* ---- 390 px ------------------------------------------------------------------------- */

const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await ctx.storageState(), hasTouch: false });
const m = await mctx.newPage();
m.on("pageerror", (e) => errors.push(e.message));
let mf = await openFresh(m);
await sleep(600);
await m.screenshot({ path: `${SHOTS}/390-normal.png` });
ok("390 : bouton « ＋ Composants », panneau replié", (await m.getByRole("button", { name: "＋ Composants" }).isVisible()) && (await m.locator(".ve-panel[data-open]").count()) === 0);
await m.getByRole("button", { name: "＋ Composants" }).click();
await sleep(400);
await m.screenshot({ path: `${SHOTS}/390-composants.png` });
const mBefore = (await blocksOf(mf)).length;
await m.locator('.ve-card[data-type="rich-text"]').click();
ok("390 : toucher un composant l'ajoute, la feuille se referme", (await countIs(mf, mBefore + 1)) && (await m.locator(".ve-panel[data-open]").count()) === 0);
await settled(m);
ok("390 : le bloc ajouté est sélectionné, avec ses boutons", await until(mf, () => Boolean(document.querySelector(".pe-tools"))));
await sleep(600);
await m.screenshot({ path: `${SHOTS}/390-selection.png` });
// Glisser par la poignée (souris) : capture pendant le glisser. Attend la
// fin du défilement doux vers le bloc ajouté.
await mf.waitForFunction(() => new Promise((res) => {
  const y = window.scrollY;
  setTimeout(() => res(window.scrollY === y), 400);
}), null, { timeout: 15000 });
const grip = mf.locator(".pe-grip");
const gb = await grip.boundingBox();
const mFrame = await m.locator("iframe.ve-frame").boundingBox();
// boundingBox d'un élément de la toile : déjà en coordonnées de la page.
await m.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
await m.mouse.down();
await m.mouse.move(Math.max(20, gb.x - 60), Math.min(mFrame.y + mFrame.height - 80, gb.y + 160), { steps: 12 });
await sleep(250);
ok("390 : repère d'insertion pendant le glisser", (await mf.locator(".pe-marker").count()) === 1);
await m.screenshot({ path: `${SHOTS}/390-glisser.png` });
await m.keyboard.press("Escape");
await m.mouse.up();
await m.getByRole("button", { name: "Aperçu", exact: true }).click();
ok("390 : aperçu sans élément d'édition", await until(mf, () => !document.querySelector(".pe-layer")));
await sleep(500);
await m.screenshot({ path: `${SHOTS}/390-apercu.png` });
await m.getByRole("button", { name: /Quitter l'aperçu/ }).click();
mf = await canvas(m);
await discardAll(m);
await mctx.close();

/* ---- Remise en état : la page d'accueil d'origine ------------------------------- */

f = await openFresh();
for (;;) {
  const list = await blocksOf(f);
  const extra = list.find((x) => x.type === "rich-text" && x.text.includes("Carnet"));
  if (!extra) break;
  await f.locator(titleSel(extra.uid)).click();
  await until(f, () => Boolean(document.querySelector(".pe-tools")));
  await f.locator(".pe-tools").getByRole("button", { name: "Supprimer" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Supprimer le bloc" }).click();
  await countIs(f, list.length - 1);
  await settled();
}
await page.getByRole("button", { name: "Publier" }).click();
await until(page.mainFrame(), () => /Publié : la page est en ligne/.test(document.body.innerText), null, 60000);
await visitor.reload({ waitUntil: "networkidle" });
ok("remise en état : accueil d'origine publié", !(await visitor.locator("body").innerText()).includes("Carnet") && (await blocksOf(f)).length === published.length);

ok("aucune erreur JavaScript", errors.length === 0, errors.slice(0, 3).join(" | "));
await anon.close();
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout est passé.");
process.exit(failures ? 1 : 0);
