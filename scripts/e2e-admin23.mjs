#!/usr/bin/env node
/**
 * Lot 23 — admin hors éditeur visuel : suppressions réversibles, création de page, thèmes, libellés, usages.
 * UN seul chromium. Serveur dev ou start requis, connexion par le vrai formulaire (1 essai : limite 5/min).
 *
 *  A. Pages : « Créer » sans titre anglais (repli sur le français) ouvre l'éditeur visuel de la nouvelle page ;
 *     le formulaire n'a plus de liste de blocs, un lien vers l'éditeur ; supprimer → toast « Supprimé · Annuler »
 *     affiché 10 s, la page quitte le site (404) ; Annuler la rend ; vue Corbeille + Restaurer ; purge simulée
 *     (31 jours) ; une page montrée par un bloc : refus annoncé d'avance (bouton inactif, liste).
 *  B. Projets : même cycle (Annuler, Corbeille, Restaurer, purge simulée) ; projet cité : refus annoncé d'avance.
 *  C. Médias : un média utilisé ne se supprime pas (bouton inactif, endroits cliquables, jamais de dialogue qui
 *     propose « Supprimer » puis refuse) ; compteur « Utilisée N fois » = détail (même avec un brouillon qui
 *     double le bloc) ; média libre : Supprimer → Annuler, Corbeille → Restaurer, purge simulée ; pastille
 *     « texte alternatif manquant » (icône, infobulle).
 *  D. Thèmes : carte = Prévisualiser / Mettre en ligne / Modifier + « … » ; « Exporter le thème (.zip) » distinct de
 *     « Télécharger le kit Photoshop » ; « Renvoyer le kit Photoshop » ; une seule phrase d'explication en tête.
 *  E. Réglages : « Avancé » replié (diagnostic) ; avis « Modifications en attente dans l'éditeur de la page X ».
 *  F. Libellés : adresse en petit et en gris sous le titre (Pages) ; projet : plus d'interrupteur « Mis en avant »
 *     sans ancien bloc ; image : « Couverture de « Personnages » » suit la collection.
 * L'état initial est restauré (pages, projets, médias de l'essai purgés, brouillon du site retiré).
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… [BASE=http://localhost:3001] node scripts/e2e-admin23.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";
import sharp from "sharp";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const DATA = process.env.DATA_DIR ?? "data";
const DB_FILE = path.join(DATA, "portfolio.db");
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let failures = 0;
function ok(label, cond, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
}

/** Base de l'essai : lecture, ou écriture ponctuelle. */
function dbq(sql, ...args) {
  const d = new Database(DB_FILE, { readonly: true });
  try {
    return d.prepare(sql).all(...args);
  } finally {
    d.close();
  }
}
function dbrun(sql, ...args) {
  const d = new Database(DB_FILE);
  try {
    d.pragma("busy_timeout = 5000");
    return d.prepare(sql).run(...args);
  } finally {
    d.close();
  }
}
const tsx = (code) => execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { env: { ...process.env, DATA_DIR: DATA }, encoding: "utf8" });
/** Purge simulée : tout ce qui est à la corbeille a « 31 jours », puis le job de purge passe (comme le worker). */
function purgeNow() {
  const old = Math.floor(Date.now() / 1000) - 31 * 86400;
  for (const t of ["pages", "projects", "media"]) dbrun(`update ${t} set deleted_at = ? where deleted_at is not null`, old);
  return tsx(`import { purgeTrash } from "./src/lib/edit/trash.ts"; console.log(JSON.stringify(await purgeTrash()));`).trim().split("\n").at(-1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, timeout = 30000) => {
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(300)) if (await fn()) return true;
  return false;
};
async function anon(p) {
  const r = await fetch(BASE + p, { redirect: "manual" });
  return { status: r.status, html: await r.text() };
}

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text().slice(0, 200)));
page.on("dialog", (d) => d.accept());
const shot = (name) => (SHOTS ? page.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {}) : Promise.resolve());

const toastEl = (text) => page.locator(".a-toast", { hasText: text }).first();
const toast = async (text) => {
  await toastEl(text).waitFor({ timeout: 20000 });
  return true;
};
const goto = (p, opts = { waitUntil: "networkidle" }) => page.goto(`${BASE}${p}`, opts);
/** Supprime depuis une ligne / carte : bouton « Supprimer » puis confirmation du dialogue. */
async function confirmDelete(row, confirmName = "Supprimer") {
  await row.getByRole("button", { name: "Supprimer" }).click();
  await page.locator("dialog[open]").getByRole("button", { name: confirmName, exact: true }).click();
}

const created = { pages: [], projects: [], media: [] };
let siteDraftWritten = false;

try {
  // ---- Connexion -----------------------------------------------------------
  await goto("/admin/connexion");
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}/admin`);

  /* ======================= A. Pages ======================= */
  await goto("/admin/pages");
  await page.getByRole("button", { name: "Créer une page" }).click();
  let d = page.locator("dialog[open]");
  await d.getByLabel("Titre en français").fill("Carnets 23");
  ok("A1 sans titre anglais : l'adresse anglaise suit le titre français", (await d.getByLabel("Adresse en anglais").inputValue()) === "carnets-23");
  ok("A1b le champ « Titre en anglais » est annoncé facultatif", /Facultatif/.test(await d.innerText()));
  await d.getByRole("button", { name: "Créer la page" }).click();
  await page.waitForURL(/\/admin\/pages\/\d+\/editer$/, { timeout: 90000 });
  const pageId = Number(page.url().split("/").at(-2));
  created.pages.push(pageId);
  ok("A2 « Créer » ouvre directement l'éditeur visuel de la nouvelle page", pageId > 0);
  const row0 = dbq("select title, slug, published from pages where id = ?", pageId)[0];
  ok("A3 sans titre anglais : repli sur le français (titre et adresse)", JSON.parse(row0.title).en === "Carnets 23" && JSON.parse(row0.slug).en === "carnets-23" && row0.published === 0, JSON.stringify(row0));

  await goto(`/admin/pages/${pageId}`);
  ok("A4 le formulaire n'a plus de liste de rubriques ni de bouton « + Ajouter une rubrique »", (await page.getByRole("button", { name: /^\+ Ajouter une? (rubrique|bloc)$/ }).count()) === 0 && (await page.locator(".a-block").count()) === 0);
  const link = page.getByRole("link", { name: "Modifier le contenu dans l'éditeur" });
  ok("A5 lien « Modifier le contenu dans l'éditeur » vers l'éditeur de la page", (await link.getAttribute("href")) === `/admin/pages/${pageId}/editer`);
  // Rien n'est perdu : tout ce que la liste des blocs offrait (ajouter, déplacer, supprimer, régler) est dans l'éditeur.
  await shot("a5-formulaire");

  // Publiée depuis la liste, pour voir la page quitter le site.
  await goto("/admin/pages");
  const row = () => page.locator("tr", { hasText: "Carnets 23" });
  await row().getByRole("button", { name: "Mettre en ligne", exact: true }).click();
  await toast("en ligne");
  ok("A6 page publiée : 200 en public", (await anon("/fr/carnets-23")).status === 200);

  // F1 : l'adresse est en petit et en gris sous le titre.
  const sub = row().locator(".a-sub");
  const subStyle = await sub.evaluate((el) => {
    const s = getComputedStyle(el);
    const t = getComputedStyle(el.closest("td").querySelector("a"));
    return { size: parseFloat(s.fontSize), color: s.color, titleColor: t.color, titleSize: parseFloat(t.fontSize), text: el.textContent };
  });
  ok("F1 Pages : le titre d'abord, l'adresse en petit et en gris dessous", subStyle.size < subStyle.titleSize && subStyle.color !== subStyle.titleColor && /\/fr\/carnets-23/.test(subStyle.text), JSON.stringify(subStyle));
  ok("F1b plus de colonne « Adresses »", (await page.locator("th", { hasText: "Adresses" }).count()) === 0);

  // Supprimer → toast « Supprimé · Annuler » pendant 10 s.
  await confirmDelete(row());
  const t0 = Date.now();
  await toast("Supprimé");
  const undo = page.locator(".a-toast-action", { hasText: "Annuler" });
  ok("B1 toast « Supprimé · Annuler » affiché", (await undo.count()) === 1);
  await shot("a-toast-supprime");
  ok("A7 la page quitte le site (404), liste et menu public", (await anon("/fr/carnets-23")).status === 404 && (await row().count()) === 0);
  ok("A8 la ligne est gardée à la corbeille (date posée), pas effacée", Boolean(dbq("select deleted_at d from pages where id = ?", pageId)[0]?.d));
  await sleep(8000);
  ok("A9 le toast est toujours là après 8 s", await undo.isVisible());
  await toastEl("Supprimé").waitFor({ state: "detached", timeout: 8000 });
  const shown = Date.now() - t0;
  ok("A9b il disparaît vers 10 s (9–12 s)", shown >= 9000 && shown <= 12500, `${shown} ms`);

  // Annuler (rechargement pour repartir proprement) : supprime encore, puis clique Annuler.
  await page.reload({ waitUntil: "networkidle" });
  ok("A10 après rechargement, la page supprimée n'est pas dans la liste", (await row().count()) === 0);
  await goto("/admin/pages?vue=corbeille");
  ok("A11 vue Corbeille : la page y est, avec le délai", (await page.locator('[data-testid="corbeille-ligne"]', { hasText: "Carnets 23" }).count()) === 1 && /effacée dans 30 jours?/.test(await page.locator('[data-testid="corbeille-ligne"]').first().innerText()));
  await shot("a11-corbeille-pages");
  await page.locator('[data-testid="corbeille-ligne"]', { hasText: "Carnets 23" }).getByRole("button", { name: "Restaurer" }).click();
  await toast("restaurée");
  ok("A12 Restaurer : de retour sur le site (200)", await waitFor(async () => (await anon("/fr/carnets-23")).status === 200));
  await goto("/admin/pages");
  ok("A12b et dans la liste des pages", (await row().count()) === 1);
  await confirmDelete(row());
  await toast("Supprimé");
  await undo.click();
  ok("A13 « Annuler » du toast rend la page (200)", await waitFor(async () => (await anon("/fr/carnets-23")).status === 200));
  ok("A13b date de corbeille effacée", dbq("select deleted_at d from pages where id = ?", pageId)[0]?.d === null);

  // Purge simulée.
  await goto("/admin/pages");
  await confirmDelete(row());
  await toast("Supprimé");
  ok("A14 avant 30 jours, la purge ne touche pas la page", (JSON.parse(tsx(`import { purgeTrash } from "./src/lib/edit/trash.ts"; console.log(JSON.stringify(await purgeTrash()));`).trim().split("\n").at(-1)).pages === 0) && dbq("select id from pages where id = ?", pageId).length === 1);
  const rep = purgeNow();
  ok("A15 31 jours plus tard, le job de purge supprime la page", dbq("select id from pages where id = ?", pageId).length === 0, rep);
  await goto("/admin/pages?vue=corbeille");
  ok("A15b la corbeille ne la montre plus", (await page.locator('[data-testid="corbeille-ligne"]', { hasText: "Carnets 23" }).count()) === 0);
  created.pages.length = 0;

  // Page montrée par un bloc : refus annoncé d'avance.
  await goto("/admin/pages");
  await page.locator("tr", { hasText: "Personnages" }).getByRole("button", { name: "Supprimer" }).click();
  d = page.locator("dialog[open]");
  const refs = await d.locator(".a-refs").innerText();
  ok("A16 page citée : les rubriques sont listées dès l'ouverture du dialogue", /Entrées des collections|Projet mis en avant|Lien vers une page/.test(refs) && /Accueil/.test(refs), refs);
  ok("A16b le bouton « Supprimer » est inactif (jamais proposé pour un refus annoncé)", await d.getByRole("button", { name: "Supprimer", exact: true }).isDisabled());
  ok("A16c chaque bloc cité est un lien vers l'éditeur de sa page", (await d.locator(".a-refs a").first().getAttribute("href"))?.endsWith("/editer") === true);
  await shot("a16-page-citee");
  await d.getByRole("button", { name: "Annuler" }).click();

  /* ======================= B. Projets ======================= */
  await goto("/admin/projets");
  await page.getByRole("button", { name: "Nouveau projet" }).click();
  d = page.locator("dialog[open]");
  await d.getByLabel("Titre en français").fill("Projet 23");
  await d.getByRole("button", { name: "Créer le projet" }).click();
  await page.waitForURL(/\/admin\/projets\/\d+$/);
  const projectId = Number(page.url().split("/").pop());
  created.projects.push(projectId);
  await goto("/admin/projets");
  const card = () => page.locator(".a-project-card", { hasText: "Projet 23" });
  await confirmDelete(card(), "Supprimer le projet");
  await toast("Supprimé");
  ok("B2 projet supprimé : hors de la liste, gardé à la corbeille", (await waitFor(async () => (await card().count()) === 0)) && Boolean(dbq("select deleted_at d from projects where id = ?", projectId)[0]?.d));
  await undo.click();
  ok("B3 « Annuler » du toast rend le projet", await waitFor(async () => dbq("select deleted_at d from projects where id = ?", projectId)[0]?.d === null));
  await page.reload({ waitUntil: "networkidle" });
  ok("B3b il est de retour dans la liste", (await card().count()) === 1);
  await confirmDelete(card(), "Supprimer le projet");
  await toast("Supprimé");
  await goto("/admin/projets?vue=corbeille");
  ok("B4 vue Corbeille des projets", (await page.locator('[data-testid="corbeille-ligne"]', { hasText: "Projet 23" }).count()) === 1);
  await page.locator('[data-testid="corbeille-ligne"]', { hasText: "Projet 23" }).getByRole("button", { name: "Restaurer" }).click();
  await toast("restauré");
  await goto("/admin/projets");
  ok("B5 Restaurer : de retour dans la liste", (await card().count()) === 1);
  await confirmDelete(card(), "Supprimer le projet");
  await toast("Supprimé");
  purgeNow();
  ok("B6 purge simulée : le projet est supprimé pour de bon", dbq("select id from projects where id = ?", projectId).length === 0);
  created.projects.length = 0;

  // Projet cité : refus annoncé d'avance.
  const cited = dbq("select p.id, json_extract(p.title,'$.fr') t from projects p where exists (select 1 from blocks b where b.props like '%\"project\":\"' || p.slug || '\"%') limit 1")[0];
  await goto("/admin/projets");
  await page.locator(".a-project-card", { hasText: cited.t }).first().getByRole("button", { name: "Supprimer" }).click();
  d = page.locator("dialog[open]");
  ok("B7 projet cité : blocs listés, bouton « Supprimer le projet » inactif", (await d.locator(".a-refs li").count()) > 0 && (await d.getByRole("button", { name: "Supprimer le projet" }).isDisabled()));
  await d.getByRole("button", { name: "Annuler" }).click();

  /* ======================= C. Médias ======================= */
  await goto("/admin/medias");
  const used = dbq("select m.id, m.original_name n from media m where m.original_name = 'portrait.svg'")[0];
  await page.locator(".a-media-tile", { hasText: used.n }).first().click();
  const panel = page.locator(".a-sidepanel");
  await panel.locator('[data-testid="media-usages"] li').first().waitFor();
  const del = panel.getByRole("button", { name: "Supprimer l'image" });
  ok("C1 média utilisé : bouton « Supprimer l'image » inactif", await del.isDisabled());
  ok("C2 les endroits où il sert sont listés, cliquables", (await panel.locator('[data-testid="media-usages"] a').count()) > 0 && /\/admin\/pages\/\d+\/editer/.test((await panel.locator('[data-testid="media-usages"] a').first().getAttribute("href")) ?? ""));
  ok("C2b une phrase explique le blocage", /remplace-la ou retire-la/.test(await panel.innerText()));
  await shot("c1-media-utilise");
  await del.click({ force: true, timeout: 1500 }).catch(() => {});
  ok("C3 aucun dialogue « Supprimer » n'est ouvert pour un média utilisé", (await page.locator("dialog[open]").count()) === 0);

  // Compteur = détail, même avec un brouillon qui double le bloc de la page À propos.
  const about = dbq("select id from pages where json_extract(slug,'$.fr') = 'a-propos'")[0].id;
  const aboutRow = dbq("select title, slug, meta, published, nav_order from pages where id = ?", about)[0];
  const aboutBlocks = dbq("select type, props from blocks where page_id = ? order by position", about).map((b, i) => ({ uid: `b${i}`, type: b.type, props: JSON.parse(b.props) }));
  const L0 = { fr: "", en: "" };
  const meta = aboutRow.meta ? JSON.parse(aboutRow.meta) : { title: L0, description: L0 };
  dbrun("update pages set draft = ?, draft_updated_at = unixepoch(), draft_rev = draft_rev + 1 where id = ?", JSON.stringify({ title: JSON.parse(aboutRow.title), slug: JSON.parse(aboutRow.slug), meta, published: Boolean(aboutRow.published), inMenu: aboutRow.nav_order !== null, accent: null, blocks: aboutBlocks }), about);
  await page.reload({ waitUntil: "networkidle" });
  let mismatches = [];
  const tiles = page.locator(".a-media-tile");
  const names = await tiles.evaluateAll((els) => els.slice(0, 6).map((e) => e.getAttribute("title")));
  for (const name of [used.n, ...names.filter((n) => n && n !== used.n).slice(0, 3)]) {
    const tile = page.locator(".a-media-tile", { has: page.locator(`.a-media-name`, { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }) }).first();
    const counter = await tile.locator(".a-media-meta").innerText();
    const n = /(\d+) fois/.exec(counter)?.[1] ?? (/Non utilisée/.test(counter) ? "0" : "?");
    await tile.click();
    await page.locator(".a-sidepanel h3", { hasText: "Utilisée dans" }).waitFor();
    await page.waitForFunction(() => !document.querySelector(".a-sidepanel")?.textContent?.includes("Recherche…"));
    const listed = await page.locator('.a-sidepanel [data-testid="media-usages"] li').count();
    if (String(listed) !== n) mismatches.push(`${name} : compteur ${n}, détail ${listed}`);
  }
  ok("C4 le compteur « Utilisée N fois » = le détail (brouillon du bloc compris, une seule place)", mismatches.length === 0, mismatches.join(" ; "));
  dbrun("update pages set draft = null, draft_updated_at = null, draft_rev = draft_rev + 1 where id = ?", about);

  // Média libre : envoi, Supprimer → Annuler, Corbeille → Restaurer, purge simulée.
  const png = await sharp({ create: { width: 48, height: 32, channels: 3, background: "#7a2e8e" } }).png().toBuffer();
  const res = await page.request.post(`${BASE}/admin/api/upload`, { headers: { origin: BASE }, multipart: { file: { name: "libre-23.png", mimeType: "image/png", buffer: png } } });
  ok("C5 envoi d'un média de test", res.ok(), String(res.status()));
  ok("C5b traité (prêt)", await waitFor(() => dbq("select status s from media where original_name = 'libre-23.png'")[0]?.s === "ready", 60000));
  const mid = dbq("select id from media where original_name = 'libre-23.png'")[0].id;
  created.media.push(mid);
  await goto("/admin/medias");
  const libre = () => page.locator(".a-media-tile", { hasText: "libre-23.png" });
  const alt = libre().locator(".a-alt-badge");
  ok("C6 pastille « description manquante » : icône avec infobulle, plus le sigle « alt »", (await alt.getAttribute("title")) === "Description manquante" && (await alt.locator("svg").count()) === 1 && !/^alt$/i.test((await alt.innerText()).trim().split(/\s+/)[0] ?? ""));
  await libre().click();
  await panel.locator("h3", { hasText: "Utilisée dans" }).waitFor();
  await page.waitForFunction(() => !document.querySelector(".a-sidepanel")?.textContent?.includes("Recherche…"));
  const delFree = panel.getByRole("button", { name: "Supprimer l'image" });
  ok("C7 média libre : « Supprimer l'image » actif", await delFree.isEnabled());
  await delFree.click();
  d = page.locator("dialog[open]");
  ok("C7b le dialogue annonce la corbeille, sans annoncer de refus", /corbeille/.test(await d.innerText()) && !/refusée/.test(await d.innerText()));
  await d.getByRole("button", { name: "Supprimer", exact: true }).click();
  await toast("Supprimé");
  ok("C8 supprimé : hors médiathèque, gardé à la corbeille", (await waitFor(async () => (await libre().count()) === 0)) && Boolean(dbq("select deleted_at d from media where id = ?", mid)[0]?.d));
  await undo.click();
  ok("C9 « Annuler » du toast restaure le média", await waitFor(() => dbq("select deleted_at d from media where id = ?", mid)[0]?.d === null));
  await page.reload({ waitUntil: "networkidle" });
  ok("C9b il est de retour dans la médiathèque", (await libre().count()) === 1);
  await libre().click();
  await panel.locator("h3", { hasText: "Utilisée dans" }).waitFor();
  await page.waitForFunction(() => !document.querySelector(".a-sidepanel")?.textContent?.includes("Recherche…"));
  await panel.getByRole("button", { name: "Supprimer l'image" }).click();
  await page.locator("dialog[open]").getByRole("button", { name: "Supprimer", exact: true }).click();
  await toast("Supprimé");
  await page.getByRole("tab", { name: /Corbeille/ }).click();
  ok("C10 onglet Corbeille de la médiathèque : le média y est", (await libre().count()) === 1);
  await shot("c10-medias-corbeille");
  await libre().click();
  await page.getByRole("button", { name: "Restaurer", exact: true }).click();
  await toast("restaurée");
  ok("C11 Restaurer : de retour dans la médiathèque", await waitFor(() => dbq("select deleted_at d from media where id = ?", mid)[0]?.d === null));
  // Renvoyer le même fichier d'un média à la corbeille le ressort.
  await goto("/admin/medias");
  await libre().click();
  await panel.locator("h3", { hasText: "Utilisée dans" }).waitFor();
  await page.waitForFunction(() => !document.querySelector(".a-sidepanel")?.textContent?.includes("Recherche…"));
  await panel.getByRole("button", { name: "Supprimer l'image" }).click();
  await page.locator("dialog[open]").getByRole("button", { name: "Supprimer", exact: true }).click();
  await toast("Supprimé");
  const again = await page.request.post(`${BASE}/admin/api/upload`, { headers: { origin: BASE }, multipart: { file: { name: "libre-23.png", mimeType: "image/png", buffer: png } } });
  ok("C12 renvoyer le même fichier : le média sort de la corbeille", again.ok() && (await waitFor(() => dbq("select deleted_at d from media where id = ?", mid)[0]?.d === null)));
  await goto("/admin/medias");
  await libre().click();
  await panel.locator("h3", { hasText: "Utilisée dans" }).waitFor();
  await page.waitForFunction(() => !document.querySelector(".a-sidepanel")?.textContent?.includes("Recherche…"));
  await panel.getByRole("button", { name: "Supprimer l'image" }).click();
  await page.locator("dialog[open]").getByRole("button", { name: "Supprimer", exact: true }).click();
  await toast("Supprimé");
  const stored = dbq("select variants v from media where id = ?", mid)[0].v;
  const keys = (JSON.parse(stored)?.files ?? []).map((f) => path.join(DATA, "media", f.key));
  purgeNow();
  ok("C13 purge simulée : ligne et fichiers supprimés", dbq("select id from media where id = ?", mid).length === 0 && keys.length > 0 && keys.every((k) => !existsSync(k)), `${keys.length} fichiers`);
  created.media.length = 0;

  /* ======================= D. Thèmes ======================= */
  await goto("/admin/themes");
  const tcard = page.locator(".a-theme-card", { hasText: "Carnet d'atelier" }).first();
  const visible = await tcard.locator(".a-card-actions").locator("a, button").evaluateAll((els) => els.map((e) => (e.getAttribute("aria-label") ?? e.textContent ?? "").replace(/↗/, "").trim()));
  ok("D1 carte d'un thème livré hors ligne : Mettre en ligne, Prévisualiser et « … » seulement", visible.length === 3 && visible[0] === "Mettre en ligne" && visible[1] === "Prévisualiser" && /Plus d'actions/.test(visible[2]), JSON.stringify(visible));
  const live = page.locator('.a-theme-card[data-active="true"]');
  const liveVisible = await live.locator(".a-card-actions").locator("a, button").evaluateAll((els) => els.map((e) => (e.getAttribute("aria-label") ?? e.textContent ?? "").replace(/↗/, "").trim()));
  ok("D1b thème en ligne : Prévisualiser et « … »", liveVisible.length === 2 && liveVisible[0] === "Prévisualiser", JSON.stringify(liveVisible));
  ok("D2 plus d'explication répétée sur chaque carte", (await page.locator(".a-theme-card > .a-help").count()) === 0);
  ok("D2b une seule phrase d'explication en tête de page", (await page.locator(".a-page-header p").count()) === 1 && /archive \.zip/.test(await page.locator(".a-page-header p").innerText()) && /kit Photoshop/.test(await page.locator(".a-page-header p").innerText()));
  await tcard.getByRole("button", { name: /Plus d'actions/ }).click();
  const items = await page.getByRole("menuitem").evaluateAll((els) => els.map((e) => e.querySelector('[slot="label"]')?.textContent?.trim() ?? ""));
  ok("D3 le menu propose copie, export du thème, kit à télécharger, kit à renvoyer", ["Dupliquer", "Exporter le thème (.zip)", "Télécharger le kit Photoshop", "Renvoyer le kit Photoshop"].every((n) => items.includes(n)), JSON.stringify(items));
  ok("D3b « Kit rempli… » n'existe plus", !items.some((n) => /Kit rempli/.test(n)) && (await page.getByText("Kit rempli").count()) === 0);
  const descs = await page.getByRole("menuitem").evaluateAll((els) => Object.fromEntries(els.map((e) => [e.querySelector('[slot="label"]')?.textContent?.trim(), e.querySelector('[slot="description"]')?.textContent?.trim()])));
  ok("D4 export du thème (.zip) et kit Photoshop sont expliqués différemment", /réimporter/.test(descs["Exporter le thème (.zip)"] ?? "") && /Photoshop/.test(descs["Télécharger le kit Photoshop"] ?? "") && descs["Exporter le thème (.zip)"] !== descs["Télécharger le kit Photoshop"], JSON.stringify(descs));
  ok("D4b l'export est un téléchargement .zip, le kit renvoyé mène à l'écran du kit", (await page.getByRole("menuitem", { name: /Exporter le thème/ }).getAttribute("href"))?.endsWith("/export") === true && (await page.getByRole("menuitem", { name: /Renvoyer le kit/ }).getAttribute("href"))?.endsWith("/kit") === true);
  await shot("d3-themes-menu");
  await page.keyboard.press("Escape");
  ok("D5 Échap referme le menu", (await page.getByRole("menuitem").count()) === 0);
  await tcard.getByRole("button", { name: /Plus d'actions/ }).click();
  await page.getByRole("menuitem", { name: /Renvoyer le kit/ }).click();
  await page.waitForURL(/\/admin\/themes\/carnet-d-atelier\/kit/);
  ok("D6 « Renvoyer le kit Photoshop » ouvre l'écran du kit", true);

  /* ======================= E. Réglages ======================= */
  await goto("/admin/reglages");
  const adv = page.locator("details.a-advanced");
  ok("E1 « Avancé » est replié par défaut, le diagnostic réseau y est caché", (await adv.count()) === 1 && (await adv.getAttribute("open")) === null && !(await page.locator("#diagnostic").isVisible()));
  await adv.locator("summary").click();
  ok("E1b ouvert : le diagnostic apparaît", await page.locator("#diagnostic").isVisible());
  ok("E2 sans brouillon du site : aucun avis", (await page.locator('[data-testid="site-draft-notice"]').count()) === 0);
  // Brouillon du site porté par la page d'accueil (écrit comme le fait l'éditeur) : nom changé, en attente.
  const home = dbq("select id from pages where json_extract(slug,'$.fr') = ''")[0].id;
  const snap = JSON.parse(tsx(`import { readPublishedSite } from "./src/lib/edit/site.ts"; console.log(JSON.stringify(readPublishedSite()));`).trim().split("\n").at(-1));
  snap.identity.name = { fr: "Nom en attente", en: "" };
  dbrun("insert into settings (key, value) values ('siteDraft', ?) on conflict(key) do update set value = excluded.value", JSON.stringify({ pageId: home, snap }));
  siteDraftWritten = true;
  await page.reload({ waitUntil: "networkidle" });
  const notice = page.locator('[data-testid="site-draft-notice"]');
  ok("E3 brouillon du site : « Modifications en attente dans l'éditeur de la page « Accueil » »", /Modifications en attente dans l'éditeur de la page « Accueil »/.test(await notice.innerText()));
  ok("E3b avec un lien vers l'éditeur de cette page", (await notice.getByRole("link").getAttribute("href")) === `/admin/pages/${home}/editer`);
  ok("E3c l'écran dit que les deux mécanismes sont distincts (en ligne ici, publié avec la page dans l'éditeur)", /publiés avec la page/.test(await page.locator(".a-page-header p").innerText()));
  await shot("e3-reglages-brouillon");
  dbrun("delete from settings where key = 'siteDraft'");
  siteDraftWritten = false;
  await page.reload({ waitUntil: "networkidle" });
  ok("E4 brouillon retiré : l'avis disparaît", (await page.locator('[data-testid="site-draft-notice"]').count()) === 0);

  /* ======================= F. Libellés ======================= */
  const firstProject = dbq("select id from projects where deleted_at is null order by position limit 1")[0].id;
  await goto(`/admin/projets/${firstProject}`);
  ok("F2 projet : plus d'interrupteur « Mis en avant » (aucun ancien bloc ne le lit)", (await page.getByText("Mis en avant", { exact: false }).count()) === 0);
  await page.locator(".a-strip .a-slot, .a-strip button").first().click();
  const sp = page.locator(".a-slot-panel");
  await sp.waitFor();
  const coverLabel = await sp.locator("label.a-toggle").first().innerText();
  ok("F3 image : « Couverture de « Personnages » » (selon la collection), avec une aide", /Couverture de « Personnages »/.test(coverLabel) && /tuile « Personnages »/.test(await sp.innerText()), coverLabel);
  await sp.getByLabel("Collection").selectOption("backgrounds");
  ok("F3b le libellé suit la collection choisie", /Couverture de « Décors »/.test(await sp.locator("label.a-toggle").first().innerText()));
  ok("F4 le champ « Collection » est expliqué", /Le rayon où cette image est rangée/.test(await sp.innerText()));
  await shot("f3-projet-couverture");
  /* ======================= G. Supprimer définitivement, vider la corbeille ======================= */
  const png2 = await sharp({ create: { width: 40, height: 40, channels: 3, background: "#2e9e4e" } }).png().toBuffer();
  await page.request.post(`${BASE}/admin/api/upload`, { headers: { origin: BASE }, multipart: { file: { name: "bloque-23.png", mimeType: "image/png", buffer: png2 } } });
  ok("G0 média de test traité", await waitFor(() => dbq("select status s from media where original_name = 'bloque-23.png'")[0]?.s === "ready", 60000));
  const bmid = dbq("select id from media where original_name = 'bloque-23.png'")[0].id;
  created.media.push(bmid);
  await goto("/admin/projets");
  await page.getByRole("button", { name: "Nouveau projet" }).click();
  await page.locator("dialog[open]").getByLabel("Titre en français").fill("Bloqueur 23");
  await page.locator("dialog[open]").getByRole("button", { name: "Créer le projet" }).click();
  await page.waitForURL(/\/admin\/projets\/\d+$/);
  const bpid = Number(page.url().split("/").pop());
  created.projects.push(bpid);
  dbrun("insert into slots (project_id, position, media_id, slug, collection, title, description, year) values (?, 0, ?, 'bloqueur-23-1', 'characters', '{\"fr\":\"\",\"en\":\"\"}', '{\"fr\":\"\",\"en\":\"\"}', 2026)", bpid, bmid);
  const openMedia = async () => {
    await goto("/admin/medias");
    await page.locator(".a-media-tile", { hasText: "bloque-23.png" }).click();
    await panel.locator("h3", { hasText: "Utilisée dans" }).waitFor();
    await page.waitForFunction(() => !document.querySelector(".a-sidepanel")?.textContent?.includes("Recherche…"));
  };
  await openMedia();
  ok("G1 média utilisé par un projet : suppression bloquée", await panel.getByRole("button", { name: "Supprimer l'image" }).isDisabled());
  await goto("/admin/projets");
  await confirmDelete(page.locator(".a-project-card", { hasText: "Bloqueur 23" }), "Supprimer le projet");
  await toast("Supprimé");
  await openMedia();
  ok("G2 projet à la corbeille : le média reste bloqué, et le dit", (await panel.getByRole("button", { name: "Supprimer l'image" }).isDisabled()) && /projet à la corbeille/.test(await panel.innerText()));
  await goto("/admin/projets?vue=corbeille");
  const prow = page.locator('[data-testid="corbeille-ligne"]', { hasText: "Bloqueur 23" });
  await prow.getByRole("button", { name: "Supprimer définitivement" }).click();
  const conf = page.locator('[data-testid="confirmation-definitive"]');
  ok("G3 confirmation intégrée à la page (pas de boîte), elle nomme ce qui sera perdu", (await page.locator("dialog[open]").count()) === 0 && /Bloqueur 23/.test(await conf.innerText()) && /son emplacement|1 emplacement/.test(await conf.innerText()) && /ne s'annule pas/.test(await conf.innerText()), await conf.innerText());
  await shot("g3-confirmation-definitive");
  await conf.getByRole("button", { name: "Annuler" }).click();
  ok("G3b Annuler : rien n'est supprimé", dbq("select id from projects where id = ?", bpid).length === 1 && (await conf.count()) === 0);
  await prow.getByRole("button", { name: "Supprimer définitivement" }).click();
  await conf.getByRole("button", { name: "Supprimer définitivement" }).click();
  await toast("supprimé définitivement");
  ok("G4 le projet est supprimé tout de suite (pas 30 jours)", await waitFor(() => dbq("select id from projects where id = ?", bpid).length === 0));
  created.projects.length = 0;
  await openMedia();
  ok("G5 le média n'était bloqué que par lui : il est supprimable", await panel.getByRole("button", { name: "Supprimer l'image" }).isEnabled());
  await panel.getByRole("button", { name: "Supprimer l'image" }).click();
  await page.locator("dialog[open]").getByRole("button", { name: "Supprimer", exact: true }).click();
  await toast("Supprimé");
  await page.getByRole("tab", { name: /Corbeille/ }).click();
  await page.locator(".a-media-tile", { hasText: "bloque-23.png" }).click();
  await page.getByRole("button", { name: "Supprimer définitivement" }).click();
  await page.locator('[data-testid="confirmation-definitive"]').getByRole("button", { name: "Supprimer définitivement" }).click();
  ok("G6 média supprimé définitivement (ligne effacée)", await waitFor(() => dbq("select id from media where id = ?", bmid).length === 0));
  created.media.length = 0;

  // Vider la corbeille.
  await goto("/admin/pages");
  await page.getByRole("button", { name: "Créer une page" }).click();
  await page.locator("dialog[open]").getByLabel("Titre en français").fill("Vidable 23");
  await page.locator("dialog[open]").getByRole("button", { name: "Créer la page" }).click();
  await page.waitForURL(/\/admin\/pages\/\d+\/editer$/, { timeout: 90000 });
  const vid = Number(page.url().split("/").at(-2));
  created.pages.push(vid);
  await goto("/admin/pages");
  await confirmDelete(page.locator("tr", { hasText: "Vidable 23" }));
  await toast("Supprimé");
  await goto("/admin/pages?vue=corbeille");
  await page.getByRole("button", { name: "Vider la corbeille" }).click();
  const conf2 = page.locator('[data-testid="confirmation-definitive"]');
  ok("G7 « Vider la corbeille » : confirmation intégrée, éléments comptés", /1 élément/.test(await conf2.innerText()) && /1 page/.test(await conf2.innerText()), await conf2.innerText());
  await conf2.getByRole("button", { name: "Annuler" }).click();
  ok("G7b Annuler : la page est toujours à la corbeille", dbq("select id from pages where id = ?", vid).length === 1);
  await page.getByRole("button", { name: "Vider la corbeille" }).click();
  await page.locator('[data-testid="confirmation-definitive"]').getByRole("button", { name: "Vider la corbeille" }).click();
  await toast("Corbeille vidée");
  ok("G8 corbeille vidée : plus rien, ni en base ni à l'écran", (await waitFor(async () => (await page.locator('[data-testid="corbeille-vide"]').count()) === 1)) && dbq("select id from pages where id = ?", vid).length === 0);
  created.pages.length = 0;

  ok("Z aucune erreur JavaScript dans l'admin", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  failures++;
  console.log("FAIL exception :", e.message.split("\n")[0]);
  await page.screenshot({ path: path.join(SHOTS ?? ".", "e2e-admin23-echec.png"), fullPage: true }).catch(() => {});
} finally {
  // Remise en état : brouillon du site retiré, éléments de l'essai (corbeille comprise) purgés.
  try {
    if (siteDraftWritten) dbrun("delete from settings where key = 'siteDraft'");
    for (const id of created.pages) dbrun("update pages set deleted_at = ?, draft = null where id = ?", Math.floor(Date.now() / 1000) - 31 * 86400, id);
    for (const id of created.projects) dbrun("update projects set deleted_at = ? where id = ?", Math.floor(Date.now() / 1000) - 31 * 86400, id);
    for (const id of created.media) dbrun("update media set deleted_at = ? where id = ?", Math.floor(Date.now() / 1000) - 31 * 86400, id);
    purgeNow();
  } catch (e) {
    console.log("remise en état incomplète :", e.message.split("\n")[0]);
  }
  await browser.close();
}
console.log(failures ? `e2e-admin23 : ${failures} échec(s)` : "e2e-admin23 : OK");
process.exit(failures ? 1 : 0);
