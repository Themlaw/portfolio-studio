#!/usr/bin/env node
/**
 * Parcours de bout en bout de la phase 6a (envoi unifié + tags), UN chromium,
 * UN onglet. Serveur dev requis (redémarré puis pré-chauffé), une connexion.
 *
 * Tags de départ posés dans la médiathèque (panneau de détail, au clavier),
 * puis planche : 3 fichiers déposés dans l'Uploader (aperçus locaux avant la
 * fin de l'envoi), suggestions classées pour « pers » avec « Créer « pers » »
 * en tête, tag créé au clavier puis retiré par Retour arrière ; 2 vignettes
 * du bandeau Bibliothèque glissées à des positions précises (ordre vérifié
 * sur le site public) ; envoi qui continue pendant un changement d'écran ;
 * échec simulé (coupure réseau) puis « Réessayer » ; médiathèque : filtre par
 * 2 tags, fusion, sélection multiple + ajout de tags. Captures phase6a en
 * 1440 et 390. L'état initial est restauré.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… node scripts/e2e-tags.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const SHOTS = "screenshots/phase6a";
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
function ok(label, cond, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
}

/* Fichiers légitimes générés par ffmpeg (testsrc2) : contenus distincts. */
const DIR = path.join(tmpdir(), "e2e-tags");
mkdirSync(DIR, { recursive: true });
const png = (name, size, seconds) => {
  const file = path.join(DIR, name);
  execFileSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i", `testsrc2=size=${size}:rate=25`, "-ss", String(seconds), "-frames:v", "1", file]);
  return file;
};
const LOT = [png("e2e-tag-1.png", "1600x1000", 1), png("e2e-tag-2.png", "1200x1200", 2), png("e2e-tag-3.png", "1000x1500", 3)];
const ALONE = png("e2e-tag-4.png", "1400x900", 4);
const FLAKY = png("e2e-tag-5.png", "1300x900", 5);
const SEED_TAGS = { "portrait.svg": ["personnage", "perso secondaire"], "herboriste.svg": ["personnage", "aspersion"], "chasseur-brume.svg": ["Personnes âgées"] };
const XSS = `"><img src=x onerror=window.__xss=1>`;
const CREATED_TAGS = ["personnage", "perso secondaire", "aspersion", "Personnes âgées", "e2e-lot", "e2e-groupe", XSS];
const PLAFOND = png("e2e-tag-7.png", "800x600", 7);

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());
const toast = (text) => page.locator(".a-toast", { hasText: text }).first().waitFor({ timeout: 30000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Envois ralentis (aperçus visibles pendant l'envoi). */
const slowUploads = (ms) =>
  page.route(/\/admin\/api\/upload(\/|$)/, async (route) => {
    await sleep(ms);
    // Route retirée pendant l'attente : la requête est déjà partie.
    await route.continue().catch(() => {});
  });

let projectId = null;

// ---- Restauration (aussi au départ : reste d'un parcours interrompu) ----------------------
async function restore() {
  await page.unroute(/\/admin\/api\/upload/).catch(() => {});
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${BASE}/admin/projets`, { waitUntil: "networkidle" });
  while (await page.locator(".a-project-card", { hasText: "Tags e2e" }).count()) {
    await page.locator(".a-project-card", { hasText: "Tags e2e" }).first().getByRole("button", { name: "Supprimer" }).click();
    await page.locator("dialog[open]").getByRole("button", { name: "Supprimer le projet" }).click();
    await toast("supprimé");
    await page.reload({ waitUntil: "networkidle" });
  }
  await page.goto(`${BASE}/admin/medias`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("Rechercher par nom ou tag…").fill("e2e-tag-");
  while (await page.locator(".a-media-tile").count()) {
    await page.locator(".a-media-tile").first().click();
    await page.locator(".a-sidepanel .a-refs, .a-sidepanel p.muted:text('Nulle part pour l\\'instant.')").first().waitFor();
    await page.locator(".a-sidepanel").getByRole("button", { name: /^Supprimer (l'image|la vidéo)$/ }).click();
    await page.locator("dialog[open]").getByRole("button", { name: "Supprimer" }).click();
    await toast("supprimée");
    await page.waitForTimeout(600);
  }
  await page.getByRole("tab", { name: /Tags/ }).click();
  for (const label of CREATED_TAGS) {
    const r = page.locator(".a-tags-table tr", { hasText: label });
    if (!(await r.count())) continue;
    await r.first().getByRole("button", { name: `Supprimer ${label}` }).click();
    await page.locator("dialog[open]").getByRole("button", { name: "Supprimer le tag" }).click();
    await toast("supprimé");
    await page.waitForTimeout(400);
  }
  const purge = page.getByRole("button", { name: /Supprimer les tags inutilisés/ });
  if (await purge.count()) {
    await purge.click();
    await page.locator("dialog[open]").getByRole("button", { name: "Supprimer", exact: true }).click();
    await toast("inutilisé");
    await page.waitForTimeout(400);
  }
  return page.locator(".a-tags-table tbody tr").count();
}


async function openMedia(name) {
  await page.getByPlaceholder("Rechercher par nom ou tag…").fill(name);
  await page.locator(".a-media-tile", { hasText: name }).first().click();
  await page.locator(".a-sidepanel h2", { hasText: name }).waitFor();
}
/** Tape un tag dans un champ et le valide au clavier (Entrée). */
async function typeTag(combo, label) {
  await combo.click();
  await combo.fill(label);
  await page.waitForTimeout(150);
  await combo.press("Enter");
  await page.waitForTimeout(250);
}
/** Glisse une vignette du bandeau sur la moitié gauche d'un emplacement (insertion avant). */
async function dragThumb(mediaId, slotIndex) {
  const thumb = page.locator(`.a-libthumb-drag[data-media="${mediaId}"]`);
  await thumb.scrollIntoViewIfNeeded();
  const from = await thumb.boundingBox();
  const slot = page.locator(".a-strip > .a-sortable-item").nth(slotIndex);
  await slot.scrollIntoViewIfNeeded();
  const to = await slot.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 8, from.y + from.height / 2 - 8, { steps: 3 });
  const tx = to.x + Math.min(20, to.width / 4);
  const ty = to.y + 60;
  await page.mouse.move(tx, ty, { steps: 15 });
  await page.waitForTimeout(150);
  const hint = await page.locator('.a-strip [data-drop="before"]').count();
  await page.mouse.up();
  return hint;
}

try {
  await page.goto(`${BASE}/admin/connexion`, { waitUntil: "networkidle" });
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}/admin`);
  await restore();

  // ---- Tags de départ (médiathèque, panneau de détail, au clavier) -------------------
  await page.goto(`${BASE}/admin/medias`, { waitUntil: "networkidle" });
  for (const [name, labels] of Object.entries(SEED_TAGS)) {
    await openMedia(name);
    const combo = page.locator(".a-sidepanel").getByRole("combobox", { name: "Tags" });
    for (const l of labels) await typeTag(combo, l);
    await page.locator(".a-sidepanel .a-tagpill", { hasText: labels.at(-1) }).waitFor();
    // Liste ouverte : React Aria masque le reste de la page aux technologies d'assistance.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
    await page.locator(".a-sidepanel").getByRole("button", { name: "Fermer le détail" }).click();
  }
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("tab", { name: /Tags/ }).click();
  const tagRows = await page.locator(".a-tags-table tbody tr").allInnerTexts();
  ok("T0 tags créés depuis le détail d'un média (Entrée), usages comptés", tagRows.some((t) => /personnage\s+2/.test(t)) && tagRows.length >= 4, tagRows.join(" | "));

  // ---- Planche ------------------------------------------------------------------------
  await page.goto(`${BASE}/admin/projets`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Nouveau projet" }).click();
  await page.locator("dialog[open]").getByLabel("Titre en français").fill("Tags e2e");
  await page.locator("dialog[open]").getByRole("button", { name: "Créer le projet" }).click();
  await page.waitForURL(/\/admin\/projets\/\d+$/);
  projectId = Number(page.url().split("/").pop());
  // Deux emplacements de départ, placés depuis le bandeau (« + »).
  const libSearch = page.locator(".a-libstrip").getByPlaceholder("Rechercher…");
  for (const name of ["portrait", "vallee-suspendue"]) {
    await libSearch.fill(name);
    await page.locator(".a-libthumb").first().hover();
    await page.locator(".a-libthumb-add").first().click();
    await toast("placé");
    await page.waitForTimeout(400);
  }
  await libSearch.fill("");
  await page.waitForFunction(() => document.querySelectorAll(".a-strip .a-slot").length === 2);
  ok("T1 « + » du bandeau : 2 emplacements ajoutés à la fin", (await page.locator(".a-strip .a-slot").count()) === 2);
  await page.screenshot({ path: `${SHOTS}/planche-uploader-compact-1440.png`, fullPage: true });

  // 3 fichiers dans l'Uploader : aperçus locaux avant la fin de l'envoi.
  await slowUploads(2500);
  await page.locator(".a-uploader input[type=file]").setInputFiles(LOT);
  await page.locator(".a-up-card").nth(2).waitFor();
  const blobs = await page.locator('.a-up-card img[src^="blob:"]').count();
  const pendingStates = await page.locator(".a-up-state").allInnerTexts();
  ok("T2 3 fichiers : aperçus locaux (blob:) affichés avant la fin de l'envoi", blobs === 3 && pendingStates.some((s) => /En attente|Envoi/.test(s)), `${blobs} ${pendingStates.join(",")}`);

  // Suggestions classées pour « pers », « Créer « pers » » en tête.
  const batchCombo = page.getByRole("combobox", { name: "Tags pour ces 3 fichiers" });
  await batchCombo.click();
  await batchCombo.fill("pers");
  await page.locator(".a-taginput-listbox [role=option]").first().waitFor();
  await page.waitForTimeout(500);
  const options = (await page.locator(".a-taginput-listbox [role=option]").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  ok(
    "T3 « pers » : Créer « pers » en premier, puis début (le plus utilisé d'abord), puis contient",
    /^Créer « pers »$/.test(options[0]) && /^personnage/.test(options[1]) && options.slice(2, 4).every((o) => /^perso|^Personnes/.test(o)) && /^aspersion/.test(options[4] ?? ""),
    options.join(" | "),
  );
  await page.screenshot({ path: `${SHOTS}/suggestions-1440.png` });
  // Annonce du champ du lot (enfant direct de l'Uploader ; chaque carte a le sien).
  const live = await page.locator(".a-uploader > .a-taginput [aria-live]").innerText();
  ok("T3b annonce « 4 suggestions » (aria-live)", /4 suggestions/.test(live), live);
  // Créer au clavier, puis Retour arrière (focus sur la pastille) et Retour arrière (retrait).
  await batchCombo.fill("e2e-lot");
  await page.waitForTimeout(200);
  const first = (await page.locator(".a-taginput-listbox [role=option]").first().innerText()).replace(/\s+/g, " ");
  await batchCombo.press("ArrowDown");
  await batchCombo.press("Enter");
  await page.locator(".a-uploader .a-tagpill", { hasText: "e2e-lot" }).waitFor();
  ok("T4 tag créé au clavier (« Créer « e2e-lot » » puis Entrée) → pastille", /Créer « e2e-lot »/.test(first), first);
  await batchCombo.press("Backspace");
  const focused = await page.evaluate(() => document.activeElement?.textContent ?? "");
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(250);
  ok("T4b Retour arrière : focus sur la dernière pastille, puis retrait", /e2e-lot/.test(focused) && (await page.locator(".a-uploader .a-tagpill").count()) === 0, focused);
  await typeTag(batchCombo, "e2e-lot");
  await page.keyboard.press("Escape");
  await page.screenshot({ path: `${SHOTS}/planche-uploader-ouvert-1440.png`, fullPage: true });
  await page.unroute(/\/admin\/api\/upload(\/|$)/);

  // Fin des envois : bilan replié.
  await page.locator(".a-planche-panel h2").click();
  await page.locator(".a-uploader[data-state=done]").waitFor({ timeout: 60000 });
  const summary = await page.locator(".a-uploader[data-state=done]").innerText();
  ok("T5 fin des envois : « 3 fichiers ajoutés à ta bibliothèque »", /3 fichiers ajoutés à ta bibliothèque/.test(summary), summary);

  // ---- Glisser 2 vignettes dans la bande -------------------------------------------
  await page.reload({ waitUntil: "networkidle" });
  const ids = {};
  for (const n of [1, 2]) {
    await libSearch.fill(`e2e-tag-${n}`);
    ids[n] = Number(await page.locator(".a-libthumb-drag").first().getAttribute("data-media"));
  }
  await libSearch.fill("e2e-tag");
  await page.waitForTimeout(300);
  // Bande : [portrait, vallée] → e2e-tag-1 avant vallée → [portrait, 1, vallée] → e2e-tag-2 avant portrait.
  const hint1 = await dragThumb(ids[1], 1);
  await toast("position 2");
  await page.waitForFunction(() => document.querySelectorAll(".a-strip .a-slot").length === 3);
  const hint2 = await dragThumb(ids[2], 0);
  await toast("position 1");
  await page.waitForFunction(() => document.querySelectorAll(".a-strip .a-slot").length === 4);
  ok("T6 glisser depuis le bandeau : marque d'insertion visible pendant le glisser", hint1 > 0 && hint2 > 0, `${hint1} ${hint2}`);
  await page.waitForFunction(() => !document.querySelector('.a-strip .a-slot[data-status="processing"]'), null, { timeout: 60000 });
  // Ordre sur le site public : hash des images dans l'ordre attendu.
  const hashOf = async (name) => {
    await libSearch.fill(name);
    const src = await page.locator(".a-libthumb-drag img").first().getAttribute("src");
    // Variantes (/media/img/<hash>/…) ou fichier du seed (/media/<hash>-nom.svg).
    return /\/media\/(?:img\/)?([0-9a-f]{16})[/-]/.exec(src)?.[1];
  };
  const expected = [await hashOf("e2e-tag-2"), await hashOf("portrait"), await hashOf("e2e-tag-1"), await hashOf("vallee-suspendue")];
  await libSearch.fill("");
  const html = await (await fetch(`${BASE}/fr/personnages`)).text();
  const start = html.indexOf("Tags e2e");
  const section = html.slice(start, html.indexOf("<section", start + 1) > 0 ? html.indexOf("<section", start + 1) : undefined);
  const order = [...section.matchAll(/\/media\/(?:img\/)?([0-9a-f]{16})[/-]/g)].map((m) => m[1]).filter((h, i, a) => a.indexOf(h) === i).slice(0, 4);
  ok("T7 ordre vérifié sur le site public : [e2e-tag-2, portrait, e2e-tag-1, vallée]", JSON.stringify(order) === JSON.stringify(expected), `${order.join(",")} ≠ ${expected.join(",")}`);

  // ---- Changer d'écran pendant un envoi -------------------------------------------
  await slowUploads(4000);
  await page.locator(".a-uploader input[type=file]").setInputFiles([ALONE]);
  await page.locator(".a-up-card").first().waitFor();
  await page.locator(".a-sidebar").getByRole("link", { name: "Médiathèque" }).click();
  await page.waitForURL(`${BASE}/admin/medias`);
  const indicator = await page.locator(".a-sidebar .a-queue-toggle").innerText({ timeout: 5000 }).catch(() => "");
  await page.unroute(/\/admin\/api\/upload(\/|$)/);
  await page.getByPlaceholder("Rechercher par nom ou tag…").fill("e2e-tag-4");
  const arrived = await page
    .locator(".a-media-tile", { hasText: "e2e-tag-4" })
    .waitFor({ timeout: 60000 })
    .then(() => true, () => false);
  ok("T8 changement d'écran pendant l'envoi : « 1 envoi en cours » dans la barre latérale, puis le média arrive", /1 envoi en cours/.test(indicator) && arrived, indicator);

  // ---- Échec simulé (coupure réseau) puis « Réessayer » ----------------------------
  await page.getByPlaceholder("Rechercher par nom ou tag…").fill("");
  await page.route(/\/admin\/api\/upload$/, (route) => route.abort("internetdisconnected"));
  await page.locator(".a-uploader input[type=file]").setInputFiles([FLAKY]);
  const failedShown = await page
    .locator(".a-up-card[data-phase=failed]")
    .waitFor({ timeout: 30000 })
    .then(() => true, () => false);
  const failedSide = await page.locator(".a-sidebar .a-queue-toggle").innerText().catch(() => "");
  await page.unroute(/\/admin\/api\/upload$/);
  await page.locator(".a-up-card[data-phase=failed]").getByRole("button", { name: "Réessayer" }).click();
  await page.getByPlaceholder("Rechercher par nom ou tag…").fill("e2e-tag-5");
  const recovered = await page
    .locator(".a-media-tile", { hasText: "e2e-tag-5" })
    .waitFor({ timeout: 60000 })
    .then(() => true, () => false);
  ok("T9 coupure réseau : échec (« 1 envoi en échec »), « Réessayer » → succès", failedShown && /échec/.test(failedSide) && recovered, `${failedShown} ${failedSide} ${recovered}`);

  // ---- Médiathèque : filtre 2 tags, sélection multiple, fusion -----------------------
  await page.reload({ waitUntil: "networkidle" });
  const filter = page.getByRole("combobox", { name: "Filtrer par tags (tous)" });
  for (const [typed, name] of [
    ["personnage", /^personnage/],
    ["perso", /^perso secondaire/],
  ]) {
    await filter.click();
    await filter.fill(typed);
    await page.getByRole("option", { name }).click();
    await page.waitForTimeout(250);
  }
  await page.keyboard.press("Escape");
  const filtered = await page.locator(".a-media-tile .a-media-name").allInnerTexts();
  ok("T10 filtre par 2 tags (ET) : seul portrait.svg", filtered.length === 1 && filtered[0] === "portrait.svg", filtered.join(","));
  await page.screenshot({ path: `${SHOTS}/medias-filtre-tags-1440.png` });
  for (let i = 0; i < 2; i++) await page.locator(".a-media-tagfilter .a-tagpill").last().getByRole("button").click({ force: true });

  await page.getByPlaceholder("Rechercher par nom ou tag…").fill("e2e-tag-");
  await page.getByRole("button", { name: "Sélectionner" }).click();
  await page.locator(".a-media-tile", { hasText: "e2e-tag-4" }).click();
  await page.locator(".a-media-tile", { hasText: "e2e-tag-5" }).click();
  await page.getByRole("button", { name: "Ajouter des tags" }).click();
  const bulk = page.getByRole("combobox", { name: "Tags à ajouter" });
  await typeTag(bulk, "e2e-groupe");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Ajouter à 2 médias" }).click();
  await toast("1 tag ajouté · 2 médias");
  await page.waitForTimeout(800);
  const tagged = await page.locator(".a-media-tile", { has: page.locator(".a-tagpill", { hasText: "e2e-groupe" }) }).count();
  ok("T11 sélection multiple → « Ajouter des tags » : 2 médias tagués", tagged === 2, String(tagged));
  await page.getByRole("button", { name: "Terminer la sélection" }).click();

  await page.getByRole("tab", { name: /Tags/ }).click();
  const row = page.locator(".a-tags-table tr", { hasText: "aspersion" });
  await row.getByRole("button", { name: "Fusionner aspersion" }).click();
  await row.locator("select").selectOption({ label: "personnage" });
  await row.getByRole("button", { name: "Fusionner", exact: true }).click();
  await toast("fusionné");
  await page.waitForTimeout(500);
  const afterMerge = await page.locator(".a-tags-table tbody tr").allInnerTexts();
  ok("T12 fusion « aspersion » → « personnage » : un tag de moins, usages conservés", !afterMerge.some((t) => /aspersion/.test(t)) && afterMerge.some((t) => /personnage\s+2/.test(t)), afterMerge.join(" | "));
  await page.screenshot({ path: `${SHOTS}/medias-gestion-tags-1440.png` });

  // ---- Refus de synchronisation : un seul appel, pas de boucle -------------------------
  await page.getByRole("tab", { name: /Médias/ }).click();
  // Envoi ralenti : le panneau reste ouvert le temps de saisir (puis le focus y reste).
  await slowUploads(4000);
  await page.locator(".a-uploader input[type=file]").setInputFiles([PLAFOND]);
  const one = page.getByRole("combobox", { name: "Tags pour ce fichier" });
  await one.waitFor();
  for (let i = 1; i <= 20; i++) await typeTag(one, `e2e-p${i}`);
  await page.unroute(/\/admin\/api\/upload(\/|$)/);
  await page.waitForFunction(() => document.querySelectorAll(".a-uploader > .a-taginput .a-tagpill").length === 20);
  await page.locator(".a-up-card[data-phase=ready], .a-up-card[data-phase=processing]").waitFor({ timeout: 30000 });
  await page.waitForTimeout(2500); // envoi terminé, 20 tags synchronisés
  // Même fichier renvoyé (dédoublonné vers ce média à 20 tags) avec un tag de plus.
  await page.keyboard.press("Escape");
  await page.locator(".a-uploader").getByRole("button", { name: "Terminé" }).click();
  await page.locator(".a-uploader").getByRole("button", { name: "Fermer le bilan" }).click();
  const calls = [];
  const watch = (req) => req.method() === "POST" && (req.postData() ?? "").includes("e2e-plafond") && calls.push(req.url());
  page.on("request", watch);
  // Messages comptés à leur apparition (un toast disparaît seul au bout de quelques secondes).
  await page.evaluate(() => {
    window.__refusals = 0;
    new MutationObserver((list) => {
      for (const m of list) {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1) continue;
          // Nouveau toast, ou compteur « ×2 » d'un toast répété : chacun compte.
          const toastEl = n.closest?.(".a-toast");
          if (toastEl && /20 tags au plus/.test(toastEl.textContent ?? "") && (n.matches(".a-toast") || n.matches(".a-toast-count"))) window.__refusals++;
        }
        if (m.type === "characterData" && m.target.parentElement?.closest(".a-toast-count")) window.__refusals++;
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await slowUploads(3000);
  await page.locator(".a-uploader input[type=file]").setInputFiles([PLAFOND]);
  const again = page.getByRole("combobox", { name: "Tags pour ce fichier" });
  await again.waitFor();
  await typeTag(again, "e2e-plafond");
  await page.keyboard.press("Escape");
  await page.unroute(/\/admin\/api\/upload(\/|$)/);
  await page.locator(".a-toast", { hasText: "20 tags au plus" }).first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(4000);
  page.off("request", watch);
  const refusals = await page.evaluate(() => window.__refusals);
  ok("T13b ajout refusé (21e tag) : un seul appel, un seul message, pas de boucle", calls.length === 1 && refusals === 1, `${calls.length} appel(s), ${refusals} message(s)`);
  await page.locator(".a-uploader").getByRole("button", { name: /Retirer e2e-plafond/ }).click().catch(() => {});

  // ---- XSS dans les rendus client (menu, filtre, onglet Tags, annonce) -----------------
  await openMedia("herboriste.svg");
  const detail = page.locator(".a-sidepanel").getByRole("combobox", { name: "Tags" });
  await typeTag(detail, XSS);
  const announced = await page.locator(".a-sidepanel .a-taginput > span[aria-live]").innerText();
  await page.keyboard.press("Escape");
  await page.locator(".a-sidepanel").getByRole("button", { name: "Fermer le détail" }).click();
  const filterX = page.getByRole("combobox", { name: "Filtrer par tags (tous)" });
  await filterX.click();
  await filterX.fill('"><');
  const menuText = await page.locator(".a-taginput-listbox [role=option]").first().innerText();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: /Tags/ }).click();
  const tabText = await page.locator(".a-tags-table").innerText();
  const xss = await page.evaluate(() => window.__xss);
  ok(
    "T13c XSS (guillemets, balise) : texte littéral dans l'annonce, le menu, l'onglet Tags ; jamais exécuté",
    xss === undefined && announced.includes(XSS) && menuText.includes(XSS) && tabText.includes(XSS) && (await page.locator(".a-tags-table img").count()) === 0,
    `${xss} | ${announced} | ${menuText}`,
  );

  // ---- Captures 390 ---------------------------------------------------------------
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle" });
  await page.screenshot({ path: `${SHOTS}/medias-gestion-tags-390.png`, fullPage: true });
  await page.getByRole("tab", { name: /Médias/ }).click();
  const filter390 = page.getByRole("combobox", { name: "Filtrer par tags (tous)" });
  await filter390.click();
  await filter390.fill("e2e");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/medias-filtre-tags-390.png` });
  await page.keyboard.press("Escape");
  await page.goto(`${BASE}/admin/projets/${projectId}`, { waitUntil: "networkidle" });
  await page.screenshot({ path: `${SHOTS}/planche-uploader-compact-390.png`, fullPage: true });
  await slowUploads(3000);
  const extra = png("e2e-tag-6.png", "900x900", 6);
  await page.locator(".a-uploader input[type=file]").setInputFiles([extra]);
  await page.locator(".a-up-card").first().waitFor();
  const c390 = page.getByRole("combobox", { name: "Tags pour ce fichier" });
  await c390.click();
  await c390.fill("pers");
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/planche-uploader-ouvert-390.png`, fullPage: true });
  await page.keyboard.press("Escape");
  await page.unroute(/\/admin\/api\/upload(\/|$)/);
  await page.locator(".a-planche-panel h2").click();
  await page.locator(".a-uploader[data-state=done]").waitFor({ timeout: 60000 });
  await page.setViewportSize({ width: 1440, height: 900 });
} catch (e) {
  failures++;
  console.log("FAIL parcours :", e.message.split("\n")[0]);
  await page.screenshot({ path: `${SHOTS}/echec.png`, fullPage: true }).catch(() => {});
}

// ---- Restauration -------------------------------------------------------------------
try {
  const left = await restore();
  ok("T13 état initial restauré (projet, médias e2e et tags supprimés)", left === 0, `${left} tag(s) restant(s)`);
} catch (e) {
  failures++;
  console.log("FAIL restauration :", e.message.split("\n")[0]);
}

ok("Z aucune erreur JavaScript", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `e2e-tags : ${failures} échec(s)` : "e2e-tags : OK");
process.exit(failures ? 1 : 0);
