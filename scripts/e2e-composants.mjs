#!/usr/bin/env node
/**
 * Composants regroupés, conteneur « Projet mis en avant » retiré (v0.19), UN chromium, UN onglet. Serveur requis,
 * base NEUVE (seed), une connexion, page « Accueil » (id 1).
 *
 *  A. Panneau « Ajouter » : aucun « Projet mis en avant » ; groupes à en-tête dans l'ordre (Texte, Projets, Images et
 *     vidéos, Grilles, Autres), contenu de chaque groupe ; les trois raccourcis Texte en tête ; recherche (nom et
 *     description, sans accents ni casse) ; un composant trouvé par la recherche s'ajoute.
 *  B. Fenêtre « Ajouter un bloc » : mêmes groupes, mêmes en-têtes, rien en double, pas de « Projet mis en avant » ;
 *     formulaire de la page (plus de liste de rubriques depuis le lot 23) : rien à proposer.
 *  C. Page v0.18 avec trois conteneurs (publiée + brouillon), migrée (fonction du démarrage) puis rouverte dans
 *     l'éditeur : blocs séparés (aucun parent), Titre lié au bon nom de projet, lien « voir plus » en bloc, carte de
 *     couleur applicable à un ancien composant, publication acceptée, rendu public.
 * Captures : $SHOTS (défaut screenshots/composants20).
 * Usage : DATA_DIR=… ADMIN_EMAIL=… ADMIN_PASSWORD=… BASE=http://localhost:3102 node scripts/e2e-composants.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";
import { autoOpenFine } from "./lib/zone66.mjs";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const DATA = process.env.DATA_DIR ?? "data";
const DB = path.join(DATA, "portfolio.db");
const SHOTS = process.env.SHOTS ?? "screenshots/composants20";
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
const draftOf = (id) => JSON.parse(q("select draft from pages where id = ?", id)[0]?.draft || "null");
async function waitFor(fn, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(300);
  }
  return false;
}

const GROUPS = ["Texte", "Projets", "Images et vidéos", "Grilles", "Autres"];
/** Contenu attendu de chaque groupe, dans l'ordre (libellés du registre). */
const CONTENT = {
  Texte: ["Texte", "Titre", "Titre + texte"],
  Projets: ["Projet"],
  "Images et vidéos": ["Image", "Vidéo", "Planche libre", "Images qui défilent"] /* + la carte du carrousel de planche (lot 31c) ; Planche libre : lot 42 */,
  // Lot 27 : Grille et Contact proposent leurs modèles sous leur carte ; plus de « Formulaire de contact » à part.
  Grilles: ["Grille"],
  Autres: ["CV", "Profil", "Contact", "Lien vers une page", "Ouverture", "Entrées des collections"],
};

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await autoOpenFine(ctx);
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

/** Groupes visibles du panneau : [{ titre, libellés }] dans l'ordre du DOM. */
const panelGroups = () =>
  page.locator(".ve-pane .ve-group").evaluateAll((els) =>
    els.map((g) => ({
      title: g.querySelector(".ve-group-title")?.textContent?.trim(),
      labels: [...g.querySelectorAll(".ve-starter strong, .ve-card strong")].map((e) => e.textContent?.trim()),
    })),
  );

let f = null;

/* ---- A. Panneau « Ajouter » ----------------------------------------------------------------------------- */

if (run("A") || run("B"))
  f = await openEditor(1);

if (run("A"))
  await section("A", async () => {
    await page.getByRole("tab", { name: "Ajouter" }).click();
    await page.locator(".ve-pane .ve-group").first().waitFor({ timeout: 30000 });
    await page.screenshot({ path: path.join(SHOTS, "a-panneau-groupes.png") });
    const text = (await page.locator(".ve-pane").textContent()) ?? "";
    ok("A1 aucun « Projet mis en avant » dans le panneau", !/mis en avant/i.test(text) && (await page.locator('.ve-card[data-type="featured-project"], .ve-card[data-key="featured-project"]').count()) === 0);
    const groups = await panelGroups();
    ok("A2 en-têtes de groupe dans l'ordre : Texte, Projets, Images et vidéos, Grilles, Autres", groups.map((g) => g.title).join("|") === GROUPS.join("|"), JSON.stringify(groups.map((g) => g.title)));
    for (const g of groups) ok(`A3 groupe « ${g.title} » : ${CONTENT[g.title]?.join(", ")}`, JSON.stringify(g.labels) === JSON.stringify(CONTENT[g.title]), JSON.stringify(g.labels));
    const flat = groups.flatMap((g) => g.labels);
    ok("A4 aucun composant en double dans le panneau", new Set(flat).size === flat.length, flat.join(", "));
    const firstButtons = await page.locator(".ve-pane .ve-group").first().locator("button").evaluateAll((els) => els.map((e) => e.getAttribute("data-starter")));
    ok("A5 les trois raccourcis Texte sont en tête du panneau", firstButtons.join() === "text,title,title-text", firstButtons.join());
    ok("A5 la première carte du catalogue est la Planche d'un projet", (await page.locator(".ve-card").first().getAttribute("data-type")) === "project-board");

    const search = page.getByRole("searchbox", { name: "Chercher un bloc" });
    ok("A6 champ « Chercher un bloc » en tête du panneau", (await search.count()) === 1 && (await page.locator(".ve-pane > *").evaluateAll((els) => els.findIndex((e) => e.matches("input[type=search]")))) <= 1);
    const found = async (query) => {
      await search.fill(query);
      await sleep(200);
      return (await panelGroups()).flatMap((g) => g.labels);
    };
    const v1 = await found("vidéo");
    const v2 = await found("VIDEO");
    ok("A7 « vidéo » = « VIDEO » (sans accents ni casse)", JSON.stringify(v1) === JSON.stringify(v2) && v1.includes("Vidéo") && v1.includes("Grille"), `${v1} / ${v2}`);
    await page.screenshot({ path: path.join(SHOTS, "a-recherche-video.png") });
    ok("A8 la recherche couvre la description (« ecrire » trouve Contact)", (await found("ecrire")).includes("Contact"));
    ok("A9 les groupes sans résultat disparaissent (« grille image » : seulement Grilles)", JSON.stringify((await panelGroups()).map((g) => g.title)) === JSON.stringify(["Grilles"]) || (await found("grille image")).length > 0 && (await panelGroups()).length === 1);
    ok("A10 aucun résultat : message", (await found("zzzzz"), (await page.locator(".ve-pane .ve-empty").textContent())?.includes("Aucun bloc")));
    ok("A11 recherche effacée : les cinq groupes reviennent", ((await found("")), (await panelGroups()).length === 5));
    // Un résultat de recherche s'ajoute comme une carte ordinaire.
    await found("projet");
    const before = draftOf(1)?.blocks?.length ?? q("select count(*) n from blocks where page_id = 1")[0].n;
    await page.locator('.ve-card[data-type="project-board"]').click();
    ok("A12 composant trouvé par la recherche, ajouté à la page", await waitFor(() => (draftOf(1)?.blocks?.length ?? 0) === before + 1 && draftOf(1).blocks.some((b) => b.type === "project-board" && !b.props.project)));
    await settled();
    await search.fill("");
  });

/* ---- B. Fenêtre « Ajouter un bloc » et éditeur classique ----------------------------------------------- */

if (run("B"))
  await section("B", async () => {
    const addEnd = f.locator('[data-edit-add="end"]');
    await addEnd.scrollIntoViewIfNeeded();
    await addEnd.click();
    const dlg = page.locator("dialog.ve-add");
    await dlg.waitFor({ timeout: 30000 });
    await page.screenshot({ path: path.join(SHOTS, "b-fenetre-groupes.png") });
    const groups = await dlg.locator(".ve-group").evaluateAll((els) => els.map((g) => ({ title: g.querySelector(".ve-group-title")?.textContent?.trim(), labels: [...g.querySelectorAll(".ve-card strong")].map((e) => e.textContent?.trim()) })));
    ok("B1 fenêtre : mêmes en-têtes, dans le même ordre", groups.map((g) => g.title).join("|") === GROUPS.join("|"), JSON.stringify(groups.map((g) => g.title)));
    ok("B2 fenêtre : même contenu par groupe que le panneau", groups.every((g) => JSON.stringify(g.labels) === JSON.stringify(CONTENT[g.title])), JSON.stringify(groups)); // lot 57 : la fenêtre reprend aussi la carte « Images qui défilent » du panneau (elle crée un bloc Projet)
    ok("B3 fenêtre : aucun « Projet mis en avant »", !/mis en avant/i.test((await dlg.textContent()) ?? "") && (await dlg.locator('[data-type="featured-project"]').count()) === 0);
    await page.keyboard.press("Escape");
    await dlg.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
    // Formulaire de la page (lot 23) : plus de liste de rubriques ni de « + Ajouter un bloc » ; la fenêtre de l'éditeur visuel (B1 à B3) est la seule.
    await page.goto(`${BASE}/admin/pages/1`, { waitUntil: "domcontentloaded" });
    const toEditor = page.getByRole("link", { name: "Modifier le contenu dans l'éditeur" });
    await toEditor.waitFor({ timeout: 60000 });
    ok("B4 formulaire de la page : lien vers l'éditeur visuel, plus de « + Ajouter un bloc »", (await page.getByRole("button", { name: /^\+ Ajouter une? (rubrique|bloc)$/ }).count()) === 0);
  });

/* ---- C. Page v0.18 avec conteneurs, migrée, rouverte dans l'éditeur ---------------------------------------- */

if (run("C"))
  await section("C", async () => {
    const lib = (action) => JSON.parse(execFileSync("node", ["--import", "tsx", "scripts/lib/legacy-containers.mjs", DATA, action], { encoding: "utf8", env: process.env }).trim().split("\n").pop());
    const legacy = lib("seed");
    const pageId = legacy.id;
    const countOf = (type, json) => (json.match(new RegExp(`"type":"${type}"`, "g")) ?? []).length;
    ok("C0 base v0.18 simulée : 3 conteneurs publiés et 3 dans le brouillon", q("select count(*) n from blocks where page_id = ? and type = 'featured-project'", pageId)[0].n === 3 && countOf("featured-project", JSON.stringify(draftOf(pageId))) === 3);
    const report = lib("migrate");
    ok("C1 migration : 6 conteneurs déballés (3 publiés + 3 du brouillon)", report.unwrapped === 6 && report.published === 1 && report.drafts === 1, JSON.stringify(report));
    ok("C1 migration : plus aucun conteneur, publié ni brouillon", q("select count(*) n from blocks where page_id = ? and type = 'featured-project'", pageId)[0].n === 0 && countOf("featured-project", JSON.stringify(draftOf(pageId))) === 0);
    const again = lib("migrate");
    ok("C2 migration idempotente : second passage sans effet", again.unwrapped === 0);

    f = await openEditor(pageId);
    const tops = await f.locator("[data-edit-block]:not([data-edit-parent])").evaluateAll((els) => els.map((e) => ({ type: e.dataset.editType, uid: e.dataset.editBlock })));
    ok("C3 éditeur : blocs séparés, dans l'ordre", tops.map((t) => t.type).join() === "rich-text,section-title,project-board,page-link,rich-text,rich-text,image,rich-text,grid,section-title,project-board", tops.map((t) => t.type).join());
    ok("C3 éditeur : aucun conteneur « Projet mis en avant »", (await f.locator('[data-edit-type="featured-project"]').count()) === 0);
    await page.screenshot({ path: path.join(SHOTS, "c-page-migree-editeur.png") });
    const projectTitle = q("select title from projects order by id limit 1")[0].title;
    const titleFr = JSON.parse(projectTitle).fr;
    ok("C4 Titre lié : montre le nom du projet", (await f.locator(`[data-edit-block="${tops[1].uid}"] h2`).first().textContent())?.trim() === titleFr, await f.locator(`[data-edit-block="${tops[1].uid}"] h2`).first().textContent());
    ok("C4 lien « voir plus » : bloc « Lien vers une page » avec son texte", ((await f.locator(`[data-edit-block="${tops[3].uid}"]`).textContent()) ?? "").includes("Voir tous les projets"));
    // Un ancien composant est un bloc à part entière : choisi seul (aucun parent), carte de couleur applicable.
    const target = tops.find((t, i) => i >= 5 && t.type === "rich-text");
    await f.locator(`[data-edit-block="${target.uid}"] section`).first().scrollIntoViewIfNeeded();
    await f.locator(`[data-edit-block="${target.uid}"] section`).first().click({ position: { x: 40, y: 30 } });
    ok("C5 un ancien composant se choisit seul (pas de conteneur parent dans le fil d'Ariane)", await waitFor(async () => ((await f.locator(".pe-crumbs").textContent().catch(() => "")) ?? "").trim() === "Texte"), await f.locator(".pe-crumbs").textContent().catch(() => ""));
    const fond = f.locator(".pe-tools [data-testid=\"fond-button\"]");
    ok("C5 bouton « Carte » disponible sur cet ancien composant", await fond.waitFor({ timeout: 30000 }).then(() => true, () => false));
    await fond.click();
    const menu = f.locator('[data-testid="fond-menu"]');
    await menu.locator('[data-testid="fond-extent"] [data-extent="margin"]').click();
    await menu.locator('[data-token="primary"]').click();
    ok("C6 carte de couleur appliquée : brouillon et toile", (await waitFor(() => draftOf(pageId).blocks.find((b) => b.uid === target.uid)?.props.surface?.color === "primary")) && (await f.locator(`[data-edit-block="${target.uid}"] .surface-card[data-surface="on"]`).count()) === 1, JSON.stringify(draftOf(pageId).blocks.find((b) => b.uid === target.uid)?.props.surface));
    await f.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.screenshot({ path: path.join(SHOTS, "c-carte-sur-ancien-composant.png") });
    await settled();
    // Surcouche « textes de projet » (v0.15) : le Titre lié (ancien composant du conteneur) reste modifiable en place,
    // le texte va au PROJET (draft_text), pas au bloc, et la planche du même projet le montre aussi.
    const NEW_TITLE = "Titre modifié depuis le Titre lié";
    const linkedH2 = f.locator(`[data-edit-block="${tops[1].uid}"] h2[data-project-inline="title"]`);
    ok("C10 le Titre lié migré est modifiable en place (texte du projet)", (await linkedH2.count()) === 1);
    await linkedH2.scrollIntoViewIfNeeded();
    await linkedH2.dblclick({ position: { x: 12, y: 6 } });
    await sleep(300);
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(NEW_TITLE);
    await page.keyboard.press("Enter");
    await sleep(700);
    await settled();
    const proj = () => q("select title, draft_text, draft_text_page_id from projects order by id limit 1")[0];
    ok("C10 surcouche enregistrée : texte au projet (draft_text, page courante), ligne du projet inchangée, rien copié dans le bloc", await waitFor(() => {
      const r = proj();
      return JSON.parse(r.draft_text ?? "null")?.title?.fr === NEW_TITLE && r.draft_text_page_id === pageId && JSON.parse(r.title).fr === titleFr;
    }) && !JSON.stringify(draftOf(pageId)).includes(NEW_TITLE));
    ok("C10 la planche du même projet montre aussi le nouveau titre", await waitFor(async () => (await f.locator(`[data-edit-board] h2[data-project-inline="title"]`).filter({ hasText: NEW_TITLE }).count()) >= 1));
    await page.getByRole("button", { name: "Publier", exact: true }).click();
    ok("C7 publication acceptée", await waitFor(async () => /En ligne/.test((await page.locator(".ve-status").textContent()) ?? ""), 120000), await page.locator(".ve-status").textContent());
    const pub = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await pub.goto(`${BASE}/fr/${legacy.slug}`, { waitUntil: "networkidle" });
    const html = await pub.content();
    ok("C8 public : nom du projet, lien « voir plus », textes, carte de couleur", html.includes(NEW_TITLE) && html.includes("Voir tous les projets") && html.includes("Texte entre deux conteneurs") && html.includes("Paragraphe ajouté dans le brouillon") && /surface-card[^>]*data-surface="on"/.test(html));
    // (`data-edit-media` : repère inerte de VideoCard, présent en public depuis la v0.13.)
    ok("C8 public : aucun repère d'édition", !/data-edit-(?!media)/.test(html), [...new Set(html.match(/data-edit-[a-z-]*/g) ?? [])].join(", "));
    await pub.screenshot({ path: path.join(SHOTS, "c-public-apres-publication.png"), fullPage: true });
    await pub.context().close();
    const pubTypes = q("select type from blocks where page_id = ? order by position", pageId).map((r) => r.type);
    ok("C9b publication : le projet a reçu le nouveau titre, surcouche vidée", JSON.parse(proj().title).fr === NEW_TITLE && proj().draft_text === null && proj().draft_text_page_id === null);
    ok("C9 version publiée : blocs à plat, sans conteneur", pubTypes.length === 11 && !pubTypes.includes("featured-project"), pubTypes.join());
  });

ok("aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
