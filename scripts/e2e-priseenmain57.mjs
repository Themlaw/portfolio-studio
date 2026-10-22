#!/usr/bin/env node
/**
 * Lot 57 « Prise en main et éditeur sur petits écrans » (chromium, serveur requis, base neuve, une connexion admin).
 *  P  « Premiers pas » du tableau de bord : cinq étapes qui se cochent d'après l'état réel, liens directs, masquable (et durable).
 *  U  Envoi depuis un projet : les images vont DANS le projet (emplacements), pas seulement dans la médiathèque ; le projet
 *     qu'aucune page n'affiche le dit.
 *  K  Poser une image, toujours le même geste : un clic choisit (onglet Médias sur un projet sélectionné, Planche libre, Images
 *     qui défilent) ; la petite loupe agrandit sans choisir.
 *  C  « Images qui défilent » : hors d'un projet (message clair, ou ajout dans l'unique projet de la page), dans la fenêtre
 *     « Ajouter », vide dans un projet (visible et sélectionnable sur la toile).
 *  G  Mode « Grand écran » : rendu à 1440 px, zoom qui fait tenir la toile ; parité de largeur avec le site en ligne.
 *  S  Petits écrans : modes d'appareil visibles à 1024 px ; bouton pour rouvrir le panneau à 768 et 390 px.
 * Captures : $SHOTS.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=P,U,K,C,G,S] [SHOTS=dossier] node scripts/e2e-priseenmain57.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";
import sharp from "sharp";

import { paint } from "./lib/crop-fixtures.mjs";
import { boardDraft, draftBlocks, login, openEditor, pageIdOf, q1, setBoardDraft, setDraft, settled, sleep, sql, waitFor } from "./lib/grille31d.mjs";
import { activateThemeUi, gotoThemesPage } from "./lib/theme-live.mjs";

const BASE = process.env.BASE ?? "http://localhost:3700";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(process.env.BATTERY_DIR ?? tmpdir(), "shots-priseenmain57");
mkdirSync(SHOTS, { recursive: true });
sharp.cache(false);
sharp.concurrency(1);

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const info = (label, v) => console.log(`INFO ${label} : ${typeof v === "string" ? v : JSON.stringify(v)}`);

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);
const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});
const section = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 8).join(" "));
    await shot(`erreur-${name}`);
  }
};

/* ---- Images de test ---------------------------------------------------------------------------------------------------- */
const mediaOf = (name) => q1("select id, status from media where original_name = ? order by id desc", name);
async function ensure(name, make) {
  if (!mediaOf(name)) {
    const res = await page.request.post(`${BASE}/admin/api/upload`, { headers: { origin: BASE }, multipart: { file: { name, mimeType: "image/png", buffer: await make() } }, timeout: 180000 });
    if (res.status() >= 300) throw new Error(`envoi de ${name} : ${res.status()}`);
  }
  if (!(await waitFor(() => mediaOf(name)?.status === "ready", 180000))) throw new Error(`${name} : ${JSON.stringify(mediaOf(name))}`);
  return mediaOf(name).id;
}
const A = await ensure("57-a.png", () => paint(1500, 1000, 1));
const B = await ensure("57-b.png", () => paint(1000, 1500, 2));
const pageId = pageIdOf("personnages");
const firstProject = q1("select id, slug from projects where deleted_at is null and draft_page_id is null order by id limit 1");
if (!firstProject) throw new Error("aucun projet dans la base de test");

const slotCount = (projectId) => q1("select count(*) n from slots where project_id = ? and media_id is not null and (draft_state is null or draft_state != 'added')", projectId).n;
const slotAll = (projectId) => q1("select count(*) n from slots where project_id = ?", projectId).n;

/* ---- P. Premiers pas --------------------------------------------------------------------------------------------------- */
await section("P", async () => {
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  const box = page.getByTestId("first-steps");
  ok("P1 le tableau de bord montre « Premiers pas »", await box.isVisible().catch(() => false));
  if (!(await box.isVisible().catch(() => false))) return;
  const steps = await box.locator("li[data-step]").evaluateAll((l) => l.map((e) => ({ key: e.getAttribute("data-step"), done: e.hasAttribute("data-done"), href: e.querySelector("a")?.getAttribute("href"), text: (e.querySelector("p")?.textContent ?? "").trim() })));
  ok("P2 cinq étapes, chacune avec une phrase et un lien direct", steps.length === 5 && steps.every((s) => s.text.length > 20 && s.href?.startsWith("/admin/")), JSON.stringify(steps));
  ok("P3 liens : thèmes, projets, pages, pages, réglages", JSON.stringify(steps.map((s) => s.href)) === JSON.stringify(["/admin/themes", "/admin/projets", "/admin/pages", "/admin/pages", "/admin/reglages"]), JSON.stringify(steps.map((s) => s.href)));
  ok("P4 l'explication d'un projet dit qu'il faut une page", /visible que si une page l.affiche/.test(steps[2].text), steps[2].text);
  const state = () => box.locator("li[data-step]").evaluateAll((l) => l.map((e) => e.hasAttribute("data-done")));
  const before = await state();
  info("P5 état initial (thème, projet, page, publier, à propos)", before);
  ok("P5 thème et « À propos » ne sont pas cochés d'office", before[0] === false && before[4] === false);
  await shot("p1-premiers-pas");

  // Le thème : se coche quand on en met un en ligne.
  await gotoThemesPage(page, BASE);
  await activateThemeUi(page, BASE, "Carnet d'atelier"); // lot 60 : Utiliser ce modèle, puis Publier
  await sleep(800);
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  ok("P6 mettre un thème en ligne coche « Choisir un thème »", (await state())[0] === true, JSON.stringify(await state()));

  // « À propos » et contact : se coche à l'enregistrement des informations.
  await page.goto(`${BASE}/admin/reglages`, { waitUntil: "networkidle" });
  const first = page.locator("form input[type=text], form input:not([type])").first();
  const v = await first.inputValue();
  await first.fill(`${v} `.trimStart() + (v.endsWith("!") ? "" : "!"));
  await page.getByRole("button", { name: /^Enregistrer/ }).first().click();
  await sleep(1500);
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  ok("P7 enregistrer ses informations coche « À propos et contact »", (await state())[4] === true, JSON.stringify(await state()));

  // Publier : suit l'état réel (aucune page publiée n'affiche de projet → décoché, puis recoché).
  const was = sql((db) => db.prepare("select id, published from pages").all());
  sql((db) => db.prepare("update pages set published = 0").run());
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  const off = await state();
  sql((db) => was.forEach((p) => db.prepare("update pages set published = ? where id = ?").run(p.published, p.id)));
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  const on = await state();
  ok("P8 « Publier » se décoche sans page publiée et se recoche avec", off[3] === false && on[3] === before[3], `${JSON.stringify(off)} → ${JSON.stringify(on)}`);

  // Masquer, et que ce soit durable.
  await page.getByRole("button", { name: "Masquer" }).click();
  await page.getByTestId("first-steps-show").waitFor({ timeout: 15000 });
  ok("P9 « Masquer » cache la liste", !(await page.getByTestId("first-steps").isVisible().catch(() => false)));
  await sleep(600);
  await page.reload({ waitUntil: "networkidle" });
  ok("P10 la liste reste masquée après rechargement", !(await page.getByTestId("first-steps").isVisible().catch(() => false)) && (await page.getByTestId("first-steps-show").isVisible()));
  await page.getByRole("button", { name: "Afficher les premiers pas" }).click();
  await page.getByTestId("first-steps").waitFor({ timeout: 15000 });
  ok("P11 « Afficher les premiers pas » la ramène", true);
  await sleep(600);
});

/* ---- U. Envoi depuis un projet -------------------------------------------------------------------------------------------- */
let proj = null;
await section("U", async () => {
  await page.goto(`${BASE}/admin/projets`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Nouveau projet" }).click();
  await page.getByLabel("Titre en français").fill("Projet 57");
  await page.getByRole("button", { name: "Créer le projet" }).click();
  await page.waitForURL(/\/admin\/projets\/\d+$/, { timeout: 60000 });
  const id = Number(page.url().split("/").pop());
  proj = { id, slug: q1("select slug from projects where id = ?", id).slug };
  ok("U0 projet créé, sans emplacement", slotAll(id) === 0);
  ok("U1 un projet qu'aucune page n'affiche le dit, avec un lien vers les pages", (await page.getByTestId("project-not-shown").isVisible().catch(() => false)) && (await page.getByTestId("project-not-shown").locator("a").getAttribute("href").catch(() => null)) === "/admin/pages");
  const files = await Promise.all([["57-u1.png", 900, 600, 11], ["57-u2.png", 600, 900, 12]].map(async ([name, w, h, s]) => ({ name, mimeType: "image/png", buffer: await paint(w, h, s) })));
  await page.locator(".a-planche-panel .a-uploader input[type=file]").first().setInputFiles(files);
  ok("U2 les deux images envoyées depuis le projet sont DANS le projet (emplacements)", await waitFor(() => slotCount(id) === 2, 90000), `emplacements remplis : ${slotCount(id)}`);
  await sleep(1500);
  const bilan = (await page.locator(".a-planche-panel .a-uploader").first().textContent()) ?? "";
  ok("U3 le bilan dit « ajoutées à ce projet »", /2 images ajoutées à ce projet/.test(bilan), bilan.trim().slice(0, 160));
  await shot("u1-envoi-projet");
});

/* ---- K. Poser une image, toujours le même geste ------------------------------------------------------------------------- */
/** Clic qui peut ne pas être possible (fonction absente) : faux plutôt qu'une exception. */
const tryClick = (loc) => loc.click({ timeout: 8000 }).then(() => true, () => false);
const mediaTab = () => page.getByRole("tab", { name: "Médias" }).click();
const thumb = (id) => page.locator(`ul.ve-media li[data-media="${id}"]`);
const previewOpen = () => page.getByTestId("media-preview").isVisible().catch(() => false);
await section("K", async () => {
  const p = proj ?? firstProject;
  setDraft(pageId, [
    { uid: "board1", type: "project-board", props: { project: p.slug } },
    { uid: "fb1", type: "free-board", props: { format: "3:2", phone: "scale", items: [] } },
  ]);
  setBoardDraft(p.id, pageId, [{ uid: "own1", type: "strip", props: { source: "own", media: [] } }]);
  const f = await openEditor(page, BASE, pageId);
  // Médias : projet sélectionné (Structure), un clic sur une vignette l'ajoute à sa bande.
  await page.getByRole("tab", { name: "Structure" }).click();
  await page.locator(".ve-tree .ve-row-main", { hasText: "Planche d" }).first().click();
  await mediaTab();
  const n0 = slotAll(p.id) + 0;
  const drafted = () => q1("select count(*) n from slots where project_id = ?", p.id).n;
  await thumb(A).locator(".ve-media-thumb").click();
  ok("K1 clic sur une vignette avec un projet sélectionné : l'image est ajoutée au projet", await waitFor(() => drafted() === n0 + 1, 30000), `emplacements ${n0} → ${drafted()}`);
  ok("K2 … et l'aperçu ne s'ouvre pas", !(await previewOpen()));
  if (await previewOpen()) {
    await page.keyboard.press("Escape");
    await sleep(400);
  }
  await settled(page);
  // La loupe agrandit sans poser.
  await tryClick(thumb(B).locator("[data-testid=media-zoom]"));
  await page.getByTestId("media-preview").waitFor({ timeout: 8000 }).catch(() => {});
  ok("K3 la petite loupe agrandit l'image", await previewOpen());
  ok("K4 … sans la poser", drafted() === n0 + 1);
  await shot("k1-loupe");
  await page.keyboard.press("Escape");
  await sleep(400);

  // Planche libre : « + Ajouter une image » puis un clic.
  await page.getByRole("tab", { name: "Structure" }).click();
  await page.locator(".ve-tree .ve-row-main", { hasText: "Planche libre" }).first().click();
  await page.getByRole("tab", { name: "Réglages" }).click();
  await page.getByTestId("free-add-image").click();
  const dlg = page.locator("dialog[open]");
  await dlg.locator(".a-picker-scroll .a-media-tile").first().waitFor({ timeout: 30000 });
  const items = () => draftBlocks(pageId).find((b) => b.uid === "fb1")?.props.items ?? [];
  // Loupe d'abord : rien n'est choisi.
  await tryClick(dlg.locator("[data-testid=media-zoom]").first());
  await page.getByTestId("media-preview").waitFor({ timeout: 15000 }).catch(() => {});
  ok("K5 sélecteur de la Planche libre : la loupe agrandit sans choisir", (await previewOpen()) && items().length === 0);
  await page.keyboard.press("Escape");
  await sleep(300);
  // (Sans loupe, Échap a fermé le sélecteur lui-même : on le rouvre.)
  if (!(await page.locator("dialog[open]").count())) {
    await page.getByTestId("free-add-image").click();
    await dlg.locator(".a-picker-scroll .a-media-tile").first().waitFor({ timeout: 30000 });
  }
  await dlg.locator(".a-picker-scroll .a-media-tile").first().click();
  ok("K6 Planche libre : un clic sur l'image la pose (sans « Utiliser cette image »)", await waitFor(() => items().length === 1, 30000), JSON.stringify(items()));
  ok("K7 … et le sélecteur se referme", await waitFor(async () => !(await page.locator("dialog[open]").count()), 15000));
  await settled(page);

  // Images qui défilent (liste propre) : un clic suffit aussi.
  await f.locator('[data-edit-bitem-type="strip"] [data-testid="bitem-name"]').first().click({ timeout: 30000 }).catch(() => {});
  await page.getByTestId("board-item-panel").waitFor({ timeout: 30000 }).catch(() => {});
  const own = () => (boardDraft(p.id) ?? []).find((i) => i.uid === "own1")?.props.media ?? [];
  await page.getByTestId("board-rail-add-image").click().catch(() => {});
  await page.locator("dialog[open] .a-picker-scroll .a-media-tile").first().click().catch(() => {});
  ok("K8 Images qui défilent : un clic sur l'image l'ajoute au carrousel", await waitFor(() => own().filter((x) => x).length === 1, 30000), JSON.stringify(own()));
  await shot("k2-defilent");
});

/* ---- C. Images qui défilent ----------------------------------------------------------------------------------------------- */
await section("C", async () => {
  const p = proj ?? firstProject;
  // Page sans projet : un clic explique clairement ce qu'il faut faire.
  setDraft(pageId, [{ uid: "t1", type: "rich-text", props: { paragraphs: [{ fr: "Texte", en: "Text" }] } }]);
  let f = await openEditor(page, BASE, pageId);
  await page.getByRole("tab", { name: "Ajouter" }).click();
  await page.locator('.ve-card[data-key="board-strip"]').click();
  await sleep(600);
  const toast1 = (await page.locator(".a-toasts").textContent()) ?? "";
  ok("C1 hors d'un projet : le message dit quoi faire avec le mot « Projet »", /Images qui défilent/.test(toast1) && /bloc « Projet »/.test(toast1) && !/planche/i.test(toast1), toast1.slice(0, 250));
  // La fenêtre « Ajouter » (bas de page) propose aussi « Images qui défilent ».
  await f.locator("[data-edit-add]").first().scrollIntoViewIfNeeded().catch(() => {});
  await f.locator("[data-edit-add]").first().click();
  await page.locator("dialog.ve-add").waitFor({ timeout: 30000 });
  ok("C2 la fenêtre « Ajouter » propose « Images qui défilent »", (await page.locator('dialog.ve-add [data-type="board-strip"]').count()) === 1);
  await shot("c1-fenetre-ajouter");
  await page.locator("dialog.ve-add").getByRole("button", { name: "Fermer" }).click();

  // Page avec UN projet : le clic ajoute le carrousel dans ce projet.
  setBoardDraft(p.id, pageId, []);
  sql((db) => db.prepare("update projects set draft_layout = null, draft_layout_page_id = null where id = ?").run(p.id));
  setDraft(pageId, [{ uid: "board1", type: "project-board", props: { project: p.slug } }]);
  f = await openEditor(page, BASE, pageId);
  await page.getByRole("tab", { name: "Ajouter" }).click();
  await page.locator('.ve-card[data-key="board-strip"]').click();
  const strips = () => (boardDraft(p.id) ?? []).filter((i) => i.type === "strip" && i.props.source === "own");
  ok("C3 une seule planche de projet sur la page : le carrousel y est ajouté", await waitFor(() => strips().length === 1, 30000), JSON.stringify(boardDraft(p.id)));
  await settled(page);
  // Vide : visible et sélectionnable sur la toile (carrousel vide posé directement si l'ajout par la palette n'a pas pu se faire).
  if (!strips().length) {
    setBoardDraft(p.id, pageId, [{ uid: "own2", type: "strip", props: { source: "own", media: [] } }]);
    f = await openEditor(page, BASE, pageId);
  }
  await page.keyboard.press("Escape");
  const frame = f.locator('[data-edit-bitem-type="strip"]:not([data-edit-bitem-project])').first();
  await frame.scrollIntoViewIfNeeded().catch(() => {});
  const box = await frame.boundingBox().catch(() => null);
  ok("C4 le carrousel vide est visible sur la toile (zone d'au moins 60 px de haut)", Boolean(box && box.height >= 60 && box.width >= 200), JSON.stringify(box));
  await shot("c2-carrousel-vide");
  if (box) {
    await page.getByRole("tab", { name: "Ajouter" }).click();
    // Clic sur la zone « rien à montrer » (hors de son bouton) : le carrousel se choisit, ses réglages s'ouvrent.
    const zone = await f.locator(".pe-bitem-empty").first().boundingBox();
    if (zone) {
      const fr = await page.locator("iframe.ve-frame").boundingBox();
      const hitInfo = await f.locator("html").evaluate((_, [x, y]) => { const el = document.elementFromPoint(x, y); return `${el?.tagName}.${el?.className} pick=${Boolean(el?.closest("[data-edit-bitem-pick]"))} frame=${Boolean(el?.closest("[data-edit-bitem]"))}`; }, [zone.x + 24 - fr.x, zone.y + 24 - fr.y]);
      info("C5 élément sous le clic", hitInfo);
      await page.mouse.click(zone.x + 24, zone.y + 24);
      await sleep(1500);
      info("C5 onglet actif après le clic", ((await page.locator('[role=tab][aria-selected=true]').textContent()) ?? "").trim());
      await shot("c3-apres-clic-zone");
    }
    ok("C5 … et se choisit d'un clic sur la zone (ses réglages s'ouvrent)", Boolean(zone) && (await page.getByTestId("board-item-panel").waitFor({ timeout: 15000 }).then(() => true, () => false)));
  }
});

/* ---- G. Grand écran ---------------------------------------------------------------------------------------------------------- */
await section("G", async () => {
  setDraft(pageId, []);
  sql((db) => db.prepare("update pages set draft = null, draft_updated_at = null where id = ?").run(pageId));
  const f = await openEditor(page, BASE, pageId);
  const group = page.getByRole("group", { name: "Largeur d'aperçu" });
  const wide = group.getByRole("button", { name: "Grand écran" });
  ok("G1 le sélecteur d'appareil propose « Grand écran »", await wide.isVisible().catch(() => false));
  if (!(await wide.isVisible().catch(() => false))) return;
  await wide.click();
  await sleep(1200);
  const inner = await f.locator("html").evaluate(() => window.innerWidth);
  ok("G2 la toile se rend à 1440 px", inner === 1440, `innerWidth ${inner}`);
  const rect = await page.locator("iframe.ve-frame").boundingBox();
  const area = await page.locator("main.ve-canvas").boundingBox();
  ok("G3 le zoom fait tenir la toile dans la fenêtre", Boolean(rect && area && rect.x >= area.x - 1 && rect.x + rect.width <= area.x + area.width + 1 && rect.width < 1440), JSON.stringify({ rect, area }));
  const shell = await f.locator(".shell").first().evaluate((e) => e.getBoundingClientRect().width);
  const pub = await ctx.newPage();
  await pub.setViewportSize({ width: 1440, height: 900 });
  await pub.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  const pubShell = await pub.locator(".shell").first().evaluate((e) => e.getBoundingClientRect().width);
  await pub.close();
  ok("G4 parité : largeur du contenu identique au site en ligne à 1440 px (±20 px)", Math.abs(shell - pubShell) <= 20, `${shell} / ${pubShell}`);
  const note = (await page.locator(".ve-canvas").textContent()) ?? "";
  ok("G5 la largeur simulée et le zoom sont dits (« 1440 px »)", /1440 px/.test(note) && /%/.test(note), note.slice(0, 120));
  await shot("g1-grand-ecran");
  await group.getByRole("button", { name: "Ordinateur" }).click();
  await sleep(800);
  ok("G6 retour à « Ordinateur » : toile à 1180 px au plus", (await f.locator("html").evaluate(() => window.innerWidth)) <= 1180);
});

/* ---- S. Petits écrans ---------------------------------------------------------------------------------------------------------- */
await section("S", async () => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openEditor(page, BASE, pageId);
  const group = page.getByRole("group", { name: "Largeur d'aperçu" });
  const picker = page.locator("select[aria-label=\"Largeur d'aperçu\"]");
  const options = await picker.locator("option").allTextContents().catch(() => []);
  ok("S1 à 1024 px, Ordinateur / Grand écran / Tablette / Téléphone sont dans la barre (pas derrière « … »)", ((await picker.isVisible().catch(() => false)) && options.length === 4) || (await group.getByRole("button", { name: "Tablette" }).isVisible().catch(() => false)), JSON.stringify(options));
  await shot("s1-1024");
  const pub = await page.locator("button.a-btn-primary", { hasText: "Publier" }).isVisible();
  ok("S2 « Publier » reste visible à 1024 px", pub);
  for (const [w, h] of [[768, 1024], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await openEditor(page, BASE, pageId);
    const fab = page.locator("button.ve-fab");
    const visible = await fab.isVisible().catch(() => false);
    const fb = visible ? await fab.boundingBox() : null;
    ok(`S3 à ${w} px, un bouton visible rouvre le panneau`, Boolean(visible && fb && fb.y >= 0 && fb.y + fb.height <= h && fb.x >= 0 && fb.x + fb.width <= w), JSON.stringify(fb));
    if (visible) {
      info(`S3 texte du bouton à ${w} px`, ((await fab.textContent()) ?? "").trim());
      await fab.click();
      await sleep(500);
      ok(`S4 à ${w} px, le panneau s'ouvre (onglets Ajouter, Médias, Structure, Réglages)`, (await page.getByRole("tab", { name: "Réglages" }).isVisible().catch(() => false)) && (await page.getByRole("tab", { name: "Ajouter" }).isVisible().catch(() => false)));
      await shot(`s2-panneau-${w}`);
      await page.getByRole("button", { name: "Fermer" }).first().click().catch(() => {});
      await sleep(400);
      ok(`S5 à ${w} px, le panneau se referme et le bouton revient`, await fab.isVisible().catch(() => false));
    }
    await shot(`s3-editeur-${w}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
});

ok("aucune exception de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\ntout est passé");
process.exit(failures ? 1 : 0);
