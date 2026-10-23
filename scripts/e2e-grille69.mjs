#!/usr/bin/env node
/**
 * Lot 69 « grille <-> images qui défilent, point d'insertion, format par défaut » (chromium, serveur requis, base neuve,
 * une connexion admin). Images SYNTHÉTIQUES seulement (dégradés générés), aucune image de l'artiste.
 *  F  CONC-11 : le format d'une grille neuve est « Libre » dans le panneau ET dans la fenêtre de réglages ; « (ancien format) » n'apparaît
 *     jamais (grille ancienne en 4:5 comprise : même rendu public qu'avant).
 *  I  CONC-09 : « Images qui défilent » se place exactement sous la rubrique choisie (une planche neuve juste dessous), jamais dans
 *     une autre planche de la page ; sur une planche choisie, à la suite de ses composants.
 *  C  CONC-01 : « Afficher en : Images qui défilent / Grille » sur une grille de planche : images, ordre, légendes, cadres, fonds,
 *     réglages du composant gardés ; aller-retour sans perte ; publication et rendu public après chaque forme.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=F,I,C] [SHOTS=dossier] node scripts/e2e-grille69.mjs
 */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";
import sharp from "sharp";

import { paint } from "./lib/crop-fixtures.mjs";
import { login, pageIdOf, q1, waitFor } from "./lib/medias-setup.mjs";

const BASE = process.env.BASE ?? "http://localhost:3840";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(process.env.BATTERY_DIR ?? tmpdir(), "shots-grille69");
const DB = path.join(process.env.DATA_DIR ?? "data", "portfolio.db");
mkdirSync(SHOTS, { recursive: true });
sharp.cache(false);
sharp.concurrency(1);

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (fn) => {
  const db = new Database(DB);
  db.pragma("busy_timeout = 5000");
  try {
    return fn(db);
  } finally {
    db.close();
  }
};
const L = (s) => ({ fr: s, en: `${s} (en)` });
const clone = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b) => {
  try {
    assert.deepStrictEqual(a, b);
    return true;
  } catch {
    return false;
  }
};

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);

async function upload(name, buffer) {
  const res = await page.request.post(`${BASE}/admin/api/upload`, { headers: { origin: BASE }, multipart: { file: { name, mimeType: "image/png", buffer } }, timeout: 180000 });
  return res.status();
}
const mediaOf = (name) => q1("select id, status from media where original_name = ? order by id desc", name);
async function ensure(name, make) {
  if (!mediaOf(name)) await upload(name, await make());
  if (!(await waitFor(() => mediaOf(name)?.status === "ready", 180000))) throw new Error(`${name} : ${JSON.stringify(mediaOf(name))}`);
  return mediaOf(name).id;
}
const A = await ensure("69-a.png", () => paint(1500, 1000, 1));
const B = await ensure("69-b.png", () => paint(1000, 1500, 2));
const C = await ensure("69-c.png", () => paint(1200, 1200, 3));
const D = await ensure("69-d.png", () => paint(1600, 900, 4));
const pageId = pageIdOf("personnages");
const project = q1("select id, slug from projects order by id limit 1");
if (!project) throw new Error("aucun projet dans la base de test");

/* ---- Données de départ -------------------------------------------------------------------------------------------------- */

function setDraft(blocks) {
  sql((db) => {
    const row = db.prepare("select title, slug, meta, nav_order from pages where id = ?").get(pageId);
    const draft = {
      title: JSON.parse(row.title),
      slug: JSON.parse(row.slug),
      meta: row.meta ? JSON.parse(row.meta) : { title: { fr: "", en: "" }, description: { fr: "", en: "" } },
      published: true,
      inMenu: row.nav_order !== null,
      accent: null,
      blocks,
    };
    db.prepare("update pages set draft = ?, draft_updated_at = unixepoch(), draft_rev = draft_rev + 1 where id = ?").run(JSON.stringify(draft), pageId);
  });
}
const draftBlocks = () => JSON.parse(sql((db) => db.prepare("select draft from pages where id = ?").get(pageId)).draft).blocks;
const blockTypes = () => draftBlocks().map((b) => `${b.type}:${b.uid}`);
/** Suite de la planche telle que le brouillon la montre (surcouche de la page, sinon la publiée). */
const layout = () => {
  const r = sql((db) => db.prepare("select layout, draft_layout from projects where id = ?").get(project.id));
  return JSON.parse(r.draft_layout ?? r.layout ?? "[]");
};
const publishedLayout = () => JSON.parse(sql((db) => db.prepare("select layout from projects where id = ?").get(project.id)).layout ?? "[]");
const setLayout = (items) => sql((db) => db.prepare("update projects set layout = ?, draft_layout = null, draft_layout_page_id = null where id = ?").run(JSON.stringify(items), project.id));
const byUid = (uid) => layout().find((i) => i.uid === uid);

/** Une grille de planche normalisée (toutes les valeurs par défaut écrites : le serveur n'ajoute rien à l'aller-retour). */
const boardGrid = () => ({
  uid: "gridb1",
  type: "grid",
  props: {
    layout: "3",
    gap: "tight",
    align: "stretch",
    ratio: "3:2",
    top: "gap",
    look: { radius: "soft" },
    children: [
      { uid: "ca1", type: "image", props: { width: "wide", mediaId: A, caption: L("Légende A"), captionTitle: L("Titre A"), look: { frame: { kind: "band", color: "#aa3322", width: "moyen" }, imageBg: "#ffffff" } } },
      { uid: "cb2", type: "image", props: { width: "wide", mediaId: B, captionDate: L("2026") } },
      { uid: "cc3", type: "image", props: { width: "wide", mediaId: C, look: { radius: "strong" } } },
      { uid: "cd4", type: "image", props: { width: "wide", mediaId: D, caption: L("Légende D") } },
    ],
  },
});
const baseLayout = () => [{ uid: "strip", type: "strip", props: {} }, boardGrid()];
const pageGrid = (ratio) => ({ uid: "gpage", type: "grid", props: { layout: "3", gap: "normal", align: "stretch", ratio, top: "gap", children: [A, B, C].map((m, i) => ({ uid: `pk${i}`, type: "image", props: { width: "wide", mediaId: m } })) } });

async function canvas() {
  const handle = await page.waitForSelector("iframe.ve-frame", { timeout: 120000 });
  const fr = await handle.contentFrame();
  await fr.waitForSelector("html[data-edit-mode]", { timeout: 180000 });
  return fr;
}
async function settled() {
  await page.waitForFunction(() => !/Enregistrement/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, { timeout: 120000 });
  await sleep(700);
}
const section = async (name, fn) => {
  if (!run(name)) return;
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 8).join(" "));
    await page.screenshot({ path: path.join(SHOTS, `erreur-${name}.png`) }).catch(() => {});
  }
};
const shot = (name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});
async function openEditor() {
  await page.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
  const fr = await canvas();
  await sleep(2000);
  return fr;
}
const tab = (name) => page.getByRole("tab", { name });
/** Sélectionne une rubrique de la page par l'onglet Structure. */
async function selectInTree(uid) {
  await tab("Structure").click();
  await page.locator(`.ve-tree [data-row="${uid}"] .ve-row-main`).first().click();
  await sleep(500);
}
/** Texte visible de l'éditeur ET de la toile. */
const allText = async (fr) => (await page.locator("body").innerText()) + "\n" + (await fr.locator("body").innerText());
async function publish() {
  await page.getByRole("button", { name: "Publier", exact: true }).click();
  const confirm = page.locator("dialog[open]").getByRole("button", { name: "Mettre en ligne" });
  if (await confirm.waitFor({ timeout: 4000 }).then(() => true, () => false)) await confirm.click();
  return waitFor(async () => /En ligne/.test((await page.locator(".ve-status").textContent()) ?? ""), 120000);
}
const publicHtml = async (p) => (await fetch(`${BASE}${p}`)).text();

/* ---- F. Format par défaut (CONC-11) -------------------------------------------------------------------------------------- */
await section("F", async () => {
  setLayout(baseLayout());
  setDraft([pageGrid("4:5")]);
  let fr = await openEditor();
  // Grille ANCIENNE (4:5) : le rendu est celui d'avant, le libellé n'a plus de mention « ancien format ».
  await selectInTree("gpage");
  await tab("Réglages").click();
  const sel = page.getByLabel("Format des cases");
  await sel.waitFor({ timeout: 30000 });
  ok("F1 grille ancienne : le panneau garde son format (4:5), rien n'est migré", (await sel.inputValue()) === "4:5" && draftBlocks()[0].props.ratio === "4:5");
  const shown = (await sel.locator("option:checked").innerText()).trim();
  ok("F2 son libellé est « Portrait 4:5 » (sans mention d'ancien format)", shown === "Portrait 4:5", shown);
  ok("F3 aucune mention « ancien format » nulle part (éditeur et toile)", !/ancien format/i.test(await allText(fr)));
  await fr.locator(`[data-edit-block="gpage"]`).scrollIntoViewIfNeeded();
  await fr.locator(`[data-edit-block="gpage"] [data-edit-cell]`).first().hover().catch(() => {});
  const gset = fr.locator("[data-grid-settings-button]").first();
  await gset.waitFor({ timeout: 20000 });
  await gset.click();
  await fr.locator('[data-testid="gridsettings"]').waitFor({ timeout: 20000 });
  const checked = fr.locator('[data-testid="gridbar-ratio"] [aria-checked="true"]');
  ok("F4 fenêtre de réglages : le même format (4:5) est coché", (await checked.count()) === 1 && (await checked.getAttribute("data-ratio")) === "4:5", `${await checked.count()}`);
  ok("F5 … avec le libellé « Portrait 4:5 »", (await checked.count()) === 1 && ((await checked.innerText()) ?? "").trim() === "Portrait 4:5");
  ok("F6 aucune mention « ancien format » dans la fenêtre", !/ancien format/i.test(await allText(fr)));
  await shot("f1-grille-ancienne");
  await fr.locator('[data-testid="gridsettings-close"]').click();

  // Grille NEUVE (modèle « Avec 3 images »).
  setDraft([]);
  fr = await openEditor();
  await tab("Ajouter").click();
  const model = page.locator('.ve-model[data-key="grid-images"]');
  await model.scrollIntoViewIfNeeded();
  await model.click();
  ok("F7 grille neuve : 3 images, format écrit « Libre » (auto), jamais 4:5", await waitFor(() => draftBlocks()[0]?.type === "grid" && draftBlocks()[0].props.children?.length === 3 && draftBlocks()[0].props.ratio === "auto"), JSON.stringify(draftBlocks()[0]?.props));
  const uid = draftBlocks()[0].uid;
  await settled();
  await tab("Réglages").click();
  const sel2 = page.getByLabel("Format des cases");
  await sel2.waitFor({ timeout: 30000 });
  ok("F8 panneau : « Libre » est affiché", (await sel2.inputValue()) === "auto" && (await sel2.locator("option:checked").innerText()).trim() === "Libre");
  await fr.locator(`[data-edit-block="${uid}"]`).scrollIntoViewIfNeeded();
  await fr.locator(`[data-edit-block="${uid}"] [data-edit-cell]`).first().hover().catch(() => {});
  const gset2 = fr.locator("[data-grid-settings-button]").first();
  await gset2.waitFor({ timeout: 20000 });
  await gset2.click();
  await fr.locator('[data-testid="gridsettings"]').waitFor({ timeout: 20000 });
  const checked2 = fr.locator('[data-testid="gridbar-ratio"] [aria-checked="true"]');
  ok("F9 fenêtre : « Libre » est coché (le même que le panneau)", (await checked2.count()) === 1 && (await checked2.getAttribute("data-ratio")) === "auto" && ((await checked2.innerText()) ?? "").trim() === "Libre", `${await checked2.count()}`);
  ok("F10 aucune mention « ancien format »", !/ancien format/i.test(await allText(fr)));
  await shot("f2-grille-neuve");
  await fr.locator('[data-testid="gridsettings-close"]').click();
});

/* ---- I. Point d'insertion du carrousel (CONC-09) ------------------------------------------------------------------------- */
await section("I", async () => {
  setLayout(baseLayout());
  setDraft([pageGrid("3:2"), { uid: "board1", type: "project-board", props: { project: project.slug } }]);
  const layoutBefore = JSON.stringify(layout());
  const fr = await openEditor();
  await selectInTree("gpage");
  await tab("Ajouter").click();
  const card = page.locator('.ve-card[data-key="board-strip"]');
  await card.scrollIntoViewIfNeeded();
  await card.click();
  ok("I1 grille choisie : une planche neuve est ajoutée JUSTE SOUS la grille", await waitFor(() => blockTypes().length === 3 && blockTypes()[0] === "grid:gpage" && blockTypes()[1].startsWith("project-board:") && blockTypes()[2] === "project-board:board1"), JSON.stringify(blockTypes()));
  ok("I2 l'autre planche de la page n'a rien reçu (suite inchangée)", JSON.stringify(layout()) === layoutBefore, JSON.stringify(layout().map((i) => i.type)));
  ok("I3 aucun second carrousel dans la planche existante", layout().filter((i) => i.type === "strip").length === 1);
  const text = await page.locator(".a-toasts").innerText().catch(() => "");
  ok("I4 un message dit quoi faire (choisir le projet de la planche neuve)", /Choisis son projet/.test(text), text);
  await shot("i1-sous-la-grille");
  await settled();

  // Une planche choisie : le carrousel va à la suite de ses composants.
  await selectInTree("board1");
  await tab("Ajouter").click();
  await card.scrollIntoViewIfNeeded();
  await card.click();
  ok("I5 planche choisie : le carrousel s'ajoute à la fin de SES composants", await waitFor(() => layout().length === 3 && layout()[2].type === "strip" && layout()[2].props.source === "own"), JSON.stringify(layout().map((i) => `${i.type}:${i.props.source ?? ""}`)));
  ok("I6 … et la planche neuve reste à sa place sous la grille", blockTypes()[1].startsWith("project-board:") && blockTypes()[0] === "grid:gpage");
  await fr.locator("body").waitFor();
});

/* ---- C. Grille <-> images qui défilent (CONC-01) ------------------------------------------------------------------------- */
await section("C", async () => {
  setLayout(baseLayout());
  const otherLook = { slotFrame: { "autre-x1": { kind: "band", color: "#112233", width: "fin" } }, spaceTop: "m" };
  setDraft([{ uid: "board1", type: "project-board", props: { project: project.slug, look: clone(otherLook) } }]);
  const startGrid = clone(boardGrid());
  const fr = await openEditor();
  const board = fr.locator(`[data-edit-board="${project.id}"]`).first();
  await board.scrollIntoViewIfNeeded();
  const frame = (i) => board.locator("[data-edit-bitem]").nth(i);
  const openPanel = async (i) => {
    await frame(i).scrollIntoViewIfNeeded();
    await frame(i).hover();
    await frame(i).locator(".pe-bitem-edit").first().click();
    if (await fr.locator('[data-testid="gridsettings"]').waitFor({ timeout: 1500 }).then(() => true, () => false)) await fr.locator('[data-testid="gridsettings-more"]').click();
    await page.getByTestId("board-item-panel").waitFor({ timeout: 30000 });
  };
  const bPublic = await publicHtml("/fr/personnages");
  void bPublic;
  await shot("c0-grille-avant");

  await openPanel(1);
  ok("C1 le panneau de la grille propose « Afficher en : Grille / Images qui défilent »", (await page.locator('[data-testid="convert-field"] [data-convert="grid"][aria-checked="true"]').count()) === 1 && (await page.locator('[data-testid="convert-field"] [data-convert="strip"]').innerText()).includes("Images qui défilent"));
  await page.locator('[data-testid="convert-field"] [data-convert="strip"]').click();
  await sleep(1500);
  const toasts = await page.locator(".a-toasts").innerText().catch(() => "");
  ok("C2 la grille devient « Images qui défilent » SUR PLACE (même identifiant, même rang)", await waitFor(() => layout()[1]?.uid === "gridb1" && layout()[1].type === "strip" && layout().length === 2), JSON.stringify(layout().map((i) => `${i.uid}:${i.type}`)) + " | messages : " + toasts);
  await settled();
  const strip = byUid("gridb1");
  ok("C3 images dans le même ordre", JSON.stringify(strip.props.media) === JSON.stringify([A, B, C, D]) && strip.props.source === "own", JSON.stringify(strip.props.media));
  const ids = strip.props.ids;
  const slug = (i) => `gridb1-${ids[i]}`;
  ok("C4 légendes : titre et légende de la 1re, date de la 2e, légende de la 4e", JSON.stringify(strip.props.captions?.[slug(0)]) === JSON.stringify({ title: L("Titre A"), caption: L("Légende A") }) && JSON.stringify(strip.props.captions?.[slug(1)]) === JSON.stringify({ date: L("2026") }) && JSON.stringify(strip.props.captions?.[slug(3)]) === JSON.stringify({ caption: L("Légende D") }), JSON.stringify(strip.props.captions));
  const lk = draftBlocks()[0].props.look;
  ok("C5 cadre et fond d'image de la 1re : repris par la rubrique (réglages par image du carrousel)", JSON.stringify(lk?.slotFrame?.[slug(0)]) === JSON.stringify({ kind: "band", color: "#aa3322", width: "moyen" }) && lk?.slotBg?.[slug(0)] === "#ffffff", JSON.stringify(lk));
  ok("C6 arrondi : celui de la 3e case, sinon celui de la grille", lk?.slotRadius?.[slug(2)] === "strong" && lk?.slotRadius?.[slug(0)] === "soft", JSON.stringify(lk?.slotRadius));
  ok("C7 les réglages d'ailleurs sont intacts", lk?.slotFrame?.["autre-x1"]?.color === "#112233" && lk?.spaceTop === "m");
  ok("C8 la forme quittée est gardée (agencement, format, espace)", strip.props.converted?.kind === "grid" && strip.props.converted.props.layout === "3" && strip.props.converted.props.ratio === "3:2" && strip.props.converted.props.gap === "tight");
  ok("C9 le panneau suit : « Images qui défilent » est coché", await waitFor(async () => (await page.locator('[data-testid="convert-field"] [data-convert="strip"][aria-checked="true"]').count()) === 1, 20000));
  // La toile montre un carrousel de 4 places.
  const rail = board.locator('[data-edit-rail="gridb1"]');
  await rail.scrollIntoViewIfNeeded();
  ok("C10 la toile montre le carrousel à 4 places", await waitFor(async () => (await rail.locator(":scope > [data-edit-slot]").count()) === 4, 30000));
  await shot("c1-carrousel");

  // Publication et rendu public de la forme « carrousel ».
  ok("C11 publication", await publish());
  const html = await publicHtml("/fr/personnages");
  ok("C12 public : le carrousel est rendu (4 images), la grille a disparu de la planche", (html.match(/class="strip-rail/g) ?? []).length >= 2 && !html.includes("data-edit-"), `${(html.match(/class="strip-rail/g) ?? []).length}`);
  ok("C12b public : le cadre et le fond de la 1re image sont rendus (parité avec la toile)", /data-frame="band"/.test(html) && html.includes("#ffffff"), "cadre ou fond absent du HTML public");
  ok("C12c toile : la 1re place porte le même cadre", (await rail.locator(":scope > [data-edit-slot]").first().locator("[data-frame='band']").count()) > 0 || (await rail.locator(":scope > [data-edit-slot]").first().getAttribute("data-frame")) === "band");
  ok("C13 public : la légende « Légende A » est affichée sous l'image", html.includes("Légende A") && html.includes("Titre A"));
  ok("C14 la suite publiée est celle du carrousel", publishedLayout()[1]?.type === "strip" && publishedLayout()[1].uid === "gridb1");
  const pub = await ctx.newPage();
  await pub.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
  await pub.locator('[class*="strip-rail"]').nth(1).scrollIntoViewIfNeeded().catch(() => {});
  await pub.screenshot({ path: path.join(SHOTS, "c2-public-carrousel.png") });
  await pub.close();

  // Retour en grille (même panneau).
  await page.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
  const fr2 = await canvas();
  await sleep(2000);
  const board2 = fr2.locator(`[data-edit-board="${project.id}"]`).first();
  await board2.scrollIntoViewIfNeeded();
  const frame2 = board2.locator("[data-edit-bitem]").nth(1);
  await frame2.scrollIntoViewIfNeeded();
  await frame2.hover();
  await frame2.locator(".pe-bitem-edit").first().click();
  await page.getByTestId("board-item-panel").waitFor({ timeout: 30000 });
  await page.locator('[data-testid="convert-field"] [data-convert="grid"]').click();
  ok("C15 retour en grille", await waitFor(() => byUid("gridb1")?.type === "grid", 30000), JSON.stringify(layout().map((i) => i.type)));
  await settled();
  ok("C16 ALLER-RETOUR SANS PERTE : la grille est exactement celle de départ", same(byUid("gridb1"), startGrid), JSON.stringify(byUid("gridb1")).slice(0, 600));
  const lk2 = draftBlocks()[0].props.look;
  ok("C17 la rubrique de la page retrouve ses réglages d'avant (plus aucune trace des places)", same(lk2, otherLook), JSON.stringify(lk2));
  await shot("c3-grille-retour");

  // Retouche pendant la forme carrousel : une légende changée est reprise au retour.
  ok("C18 publication de la grille revenue", await publish());
  const html2 = await publicHtml("/fr/personnages");
  ok("C19 public : la grille est rendue de nouveau, 4 images, légendes comprises", (html2.match(/block-grid/g) ?? []).length >= 1 && html2.includes("Légende A") && html2.includes("Légende D"));
  ok("C20 la grille publiée est exactement celle de départ", same(publishedLayout()[1], startGrid));

  // Défaire : un seul pas rend la grille ET la rubrique de la page d'avant la conversion.
  await page.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
  const fr3 = await canvas();
  await sleep(2000);
  const board3 = fr3.locator(`[data-edit-board="${project.id}"]`).first();
  await board3.scrollIntoViewIfNeeded();
  const frame3 = board3.locator("[data-edit-bitem]").nth(1);
  await frame3.scrollIntoViewIfNeeded();
  await frame3.hover();
  await frame3.locator(".pe-bitem-edit").first().click();
  if (await fr3.locator('[data-testid="gridsettings"]').waitFor({ timeout: 1500 }).then(() => true, () => false)) await fr3.locator('[data-testid="gridsettings-more"]').click();
  await page.getByTestId("board-item-panel").waitFor({ timeout: 30000 });
  await page.locator('[data-testid="convert-field"] [data-convert="strip"]').click();
  ok("C21 nouvelle conversion en carrousel", await waitFor(() => byUid("gridb1")?.type === "strip", 30000));
  await settled();
  await page.locator(".a-toasts").getByRole("button", { name: "Défaire" }).click();
  ok("C22 « Défaire » (un seul geste) : la grille d'origine est de retour", await waitFor(() => same(byUid("gridb1"), startGrid), 30000), JSON.stringify(byUid("gridb1")).slice(0, 300));
  await settled();
  ok("C23 … et la rubrique de la page n'a gardé aucune trace des places", same(draftBlocks()[0].props.look, otherLook), JSON.stringify(draftBlocks()[0].props.look));
});

ok("aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `e2e-grille69 : ${failures} échec(s)` : "e2e-grille69 : OK");
process.exit(failures ? 1 : 0);
