#!/usr/bin/env node
/**
 * Lot 31f « un seul carrousel » (chromium, serveur requis, base neuve, une connexion admin). Clics et glissés à la souris
 * réelle (`page.mouse`, coordonnées de la fenêtre), jamais de clic programmatique sur la toile.
 *  N  Un seul nom : « Images qui défilent » dans la palette, sur la barre de chaque bande, nulle part « Images du projet ».
 *  C  Carrousel ajouté depuis le menu « + Ajouter » : mêmes outils par image que la bande du projet (Remplacer, Supprimer,
 *     Retirer la place, Arrondi, Cadre), glisser pour réordonner, place vide qui reçoit un média, fichier de l'ordinateur.
 *  P  La bande d'origine (images du projet) : mêmes outils, mêmes boutons.
 *  M  Plusieurs carrousels dans une planche : réglages indépendants (même média dans deux carrousels).
 *  U  Publication : parité éditeur / public, compteur « N œuvres » juste, emplacements du projet intacts par les gestes
 *     des carrousels, téléphone à 390 px sans débordement.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=N,C,P,M,U] [SHOTS=dossier] node scripts/e2e-carrousel31f.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";
import sharp from "sharp";

import { paint } from "./lib/crop-fixtures.mjs";
import { login, pageIdOf, q1, waitFor } from "./lib/medias-setup.mjs";

const BASE = process.env.BASE ?? "http://localhost:3490";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(process.env.BATTERY_DIR ?? tmpdir(), "shots-carrousel31f");
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
const A = await ensure("31f-a.png", () => paint(1500, 1000, 1));
const B = await ensure("31f-b.png", () => paint(1000, 1500, 2));
const C = await ensure("31f-c.png", () => paint(1200, 1200, 3));
const pageId = pageIdOf("personnages");
const project = q1("select id, slug from projects order by id limit 1");
if (!project) throw new Error("aucun projet dans la base de test");

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
const lookOfDraft = (uid) => draftBlocks().find((b) => b.uid === uid)?.props.look;
/** Suite de la planche telle que le brouillon la montre (surcouche de la page, sinon la publiée). */
const layout = () => {
  const r = sql((db) => db.prepare("select layout, draft_layout from projects where id = ?").get(project.id));
  return JSON.parse(r.draft_layout ?? r.layout ?? "[]");
};
const carousels = () => layout().filter((i) => i.type === "strip" && i.props.source === "own");
const slotRows = () => JSON.stringify(sql((db) => db.prepare("select id, media_id, position, draft_state, draft_media_id from slots where project_id = ? order by id").all(project.id)));

setDraft([{ uid: "board1", type: "project-board", props: { project: project.slug } }]);

async function canvas() {
  const handle = await page.waitForSelector("iframe.ve-frame", { timeout: 120000 });
  const fr = await handle.contentFrame();
  await fr.waitForSelector("html[data-edit-mode]", { timeout: 180000 });
  return fr;
}
async function settled() {
  await page.waitForFunction(() => !/Enregistrement/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, { timeout: 120000 });
  await sleep(600);
}
const section = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 8).join(" "));
    await page.screenshot({ path: path.join(SHOTS, `erreur-${name}.png`) }).catch(() => {});
  }
};

/* ---- Souris réelle : coordonnées de la fenêtre (le cadre de la toile est dans la page de l'éditeur) ----------------------- */
const center = async (loc) => {
  const b = await loc.boundingBox();
  if (!b) throw new Error("élément sans boîte");
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
};
const mHover = async (loc) => {
  const { x, y } = await center(loc);
  await page.mouse.move(x - 3, y - 3);
  await page.mouse.move(x, y, { steps: 5 });
  await sleep(250);
};
const mClick = async (loc) => {
  let { x, y } = await center(loc);
  await page.mouse.move(x, y, { steps: 5 });
  // Lot 54 : la légende vide du média survolé apparaît et décale la barre d'outils ; on remesure avant de cliquer.
  await sleep(300);
  ({ x, y } = await center(loc));
  await page.mouse.move(x, y, { steps: 2 });
  await page.mouse.click(x, y);
};

const rail = (f, uid) => f.locator(`[data-edit-board="${project.id}"] [data-edit-rail="${uid}"]`);
const slots = (f, uid) => rail(f, uid).locator(":scope > [data-edit-slot]");
const bar = (f) => f.locator(".pe-slot-tools").first();
const barButtons = async (f) => (await bar(f).locator("button, select").evaluateAll((l) => l.map((e) => (e.tagName === "SELECT" ? `select:${e.getAttribute("aria-label")}` : (e.textContent ?? "").trim()))));
/** Survole la place n° `i` du carrousel : sa barre apparaît dedans. */
async function hoverSlot(f, uid, i) {
  // `i` négatif : la première place remplie (la bande du projet commence parfois par une place vide).
  if (i < 0) i = await rail(f, uid).evaluate((r) => [...r.querySelectorAll(":scope > [data-edit-slot]")].findIndex((e) => !e.hasAttribute("data-empty")));
  const s = slots(f, uid).nth(i);
  // La toile se redessine juste après un réglage (la place peut être remplacée sous nos yeux) : un seul nouvel essai.
  for (let attempt = 0; ; attempt++) {
    try {
      await s.scrollIntoViewIfNeeded();
      await mHover(s.locator(".strip-media, .pe-empty-box").first());
      break;
    } catch (e) {
      if (attempt >= 2) throw e;
      await sleep(600);
    }
  }
  await bar(f).waitFor({ timeout: 15000 });
  return s;
}
const toolBtn = (f, name) => bar(f).locator("button", { hasText: name });
/** Choisit un média dans le sélecteur ouvert : par son nom (sélecteur d'une place) ou par son rang (sélecteur du panneau). */
const pickMedia = async (n, letter) => {
  const grid = page.locator(".ve-picker-grid");
  if (letter) {
    const b = page.getByRole("button", { name: new RegExp(`Choisir 31f-${letter}`) }).first();
    await b.waitFor({ timeout: 20000 });
    await b.click();
    return;
  }
  void grid;
  const dlg = page.locator(".a-picker-scroll button");
  await dlg.nth(n).waitFor({ timeout: 20000 });
  await dlg.nth(n).click();
  const confirm = page.getByRole("button", { name: /^Utiliser cette (image|vidéo)$/ });
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
};
const LETTER = { [A]: "a", [B]: "b", [C]: "c" };
const listOf = (uid) => (carousels().find((c) => c.uid === uid)?.props.media ?? []);

const NAME = "Images qui défilent";

await page.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
const f = await canvas();
await sleep(2000);
const board = f.locator(`[data-edit-board="${project.id}"]`).first();
await board.scrollIntoViewIfNeeded();
const slotsBefore = slotRows();

/* ---- C. Carrousel ajouté depuis le menu ---------------------------------------------------------------------------------- */
let U1 = "";
let U2 = "";
await section("C", async () => {
  await board.hover();
  await board.locator("[data-edit-bitem-add]").last().click();
  await f.locator(".pe-bitem-menu").waitFor({ timeout: 20000 });
  ok("C0 le menu « + Ajouter » propose « Images qui défilent » (et pas « Images du projet »)", ((await f.locator('.pe-bitem-menu [data-bitem-type="strip"] strong').first().textContent()) ?? "").trim() === NAME);
  await f.locator('.pe-bitem-menu [data-bitem-type="strip"]').first().click();
  ok("C1 carrousel ajouté (brouillon)", await waitFor(() => carousels().length === 1, 30000), JSON.stringify(layout()));
  U1 = carousels()[0].uid;
  await page.getByTestId("board-item-panel").waitFor({ timeout: 30000 });
  // Trois images choisies dans la médiathèque (panneau Réglages).
  for (let i = 0; i < 3; i++) {
    await page.getByTestId("board-rail-add-image").click();
    await pickMedia(i);
    await settled();
  }
  ok("C2 trois images dans le carrousel", await waitFor(() => listOf(U1).filter((x) => x).length === 3, 30000), JSON.stringify(listOf(U1)));
  // Retour sur la toile : le panneau se referme, la barre de la planche reste.
  await page.keyboard.press("Escape");
  await sleep(500);
  await rail(f, U1).scrollIntoViewIfNeeded();
  ok("C3 les images du carrousel ont les repères d'emplacement (comme la bande du projet)", (await slots(f, U1).count()) === 3);
  await page.screenshot({ path: path.join(SHOTS, "c1-carrousel.png") });

  // La barre de l'image : les cinq mêmes outils que sur la bande du projet.
  await hoverSlot(f, U1, 0);
  const names = await barButtons(f);
  ok("C4 barre de l'image : Remplacer, Supprimer, Retirer la place, Arrondi, Cadre", ["Remplacer", "Supprimer", "Retirer la place", "select:Arrondi de cette image", "Cadre"].every((n) => names.includes(n)), JSON.stringify(names));
  await page.screenshot({ path: path.join(SHOTS, "c2-menu-image.png") });

  // Arrondi.
  const select = bar(f).locator('select[aria-label="Arrondi de cette image"]');
  const val = await select.locator("option").nth(2).getAttribute("value");
  await select.selectOption(val);
  const slug = await slots(f, U1).nth(0).getAttribute("data-slot-slug");
  ok("C5 Arrondi : enregistré dans look.slotRadius du bloc, au nom de ce carrousel", await waitFor(() => lookOfDraft("board1")?.slotRadius?.[slug] === val, 30000), `${slug} ${JSON.stringify(lookOfDraft("board1"))}`);
  ok("C5b le slug est propre au carrousel", slug.startsWith(`${U1}-`), slug);
  // Cadre.
  await hoverSlot(f, U1, 0);
  await mClick(toolBtn(f, "Cadre"));
  const dlg = f.getByRole("dialog", { name: "Cadre de la photo" });
  await dlg.waitFor({ timeout: 15000 });
  await mClick(dlg.locator('[data-frame-kind="band"]'));
  ok("C6 Cadre : enregistré dans look.slotFrame", await waitFor(() => Boolean(lookOfDraft("board1")?.slotFrame?.[slug]), 30000), JSON.stringify(lookOfDraft("board1")));
  await page.screenshot({ path: path.join(SHOTS, "c3-cadre.png") });
  await page.keyboard.press("Escape");
  await sleep(300);

  // Réordonner : glisser la première image après la deuxième (souris réelle).
  const before = listOf(U1).slice();
  const first = slots(f, U1).nth(0);
  const second = slots(f, U1).nth(1);
  const p0 = await center(first.locator(".strip-media"));
  const p1 = await center(second.locator(".strip-media"));
  await page.mouse.move(p0.x, p0.y, { steps: 4 });
  await page.mouse.down();
  await page.mouse.move(p0.x + 30, p0.y, { steps: 6 });
  await page.mouse.move(p1.x + p1.b.width / 2 - 10, p1.y, { steps: 14 });
  await page.mouse.up();
  ok("C7 glisser pour réordonner : la première passe en deuxième", await waitFor(() => JSON.stringify(listOf(U1)) === JSON.stringify([before[1], before[0], before[2]]), 30000), `${JSON.stringify(before)} → ${JSON.stringify(listOf(U1))}`);
  await settled();
  ok("C7b l'arrondi et le cadre suivent l'image déplacée (même slug, deuxième place)", await waitFor(async () => (await slots(f, U1).nth(1).getAttribute("data-slot-slug")) === slug && (await slots(f, U1).nth(1).evaluate((e) => e.style.getPropertyValue("--media-radius"))) !== "" && (await slots(f, U1).nth(1).getAttribute("data-frame")) !== null, 30000), `${await slots(f, U1).nth(1).getAttribute("data-slot-slug")} / ${slug}`);

  // Supprimer : la place reste, vide.
  await hoverSlot(f, U1, 2);
  await mClick(toolBtn(f, "Supprimer"));
  ok("C8 Supprimer : la place reste, vide (null dans la liste, place en pointillés)", await waitFor(async () => listOf(U1)[2] === null && (await slots(f, U1).nth(2).getAttribute("data-empty")) !== null, 30000), JSON.stringify(listOf(U1)));
  ok("C8b la place vide propose « Choisir une image » et « Retirer la place »", await (async () => {
    await hoverSlot(f, U1, 2);
    const n = await barButtons(f);
    return n.includes("Choisir une image") && n.includes("Retirer la place");
  })());
  // Remplacer sur la place vide : le sélecteur de médias, puis l'image revient à sa place.
  await mClick(toolBtn(f, "Choisir une image"));
  await pickMedia(0, "c");
  ok("C9 Remplacer / Choisir une image : la place reçoit un média", await waitFor(() => typeof listOf(U1)[2] === "number", 30000), JSON.stringify(listOf(U1)));
  await settled();
  // Remplacer une image remplie : change le média de CETTE place seulement.
  const prev = listOf(U1).slice();
  const slug1 = await slots(f, U1).nth(1).getAttribute("data-slot-slug");
  await hoverSlot(f, U1, 1);
  await mClick(toolBtn(f, "Remplacer"));
  await pickMedia(0, ["a", "b", "c"].find((l) => ({ a: A, b: B, c: C })[l] !== prev[1]));
  ok("C10 Remplacer une image remplie : seule cette place change", await waitFor(() => listOf(U1)[1] !== prev[1] && listOf(U1)[0] === prev[0] && listOf(U1)[2] === prev[2], 30000), `${JSON.stringify(prev)} → ${JSON.stringify(listOf(U1))}`);
  await settled();
  ok("C10b …et la place garde son arrondi et son cadre (même slug)", await waitFor(async () => (await slots(f, U1).nth(1).getAttribute("data-slot-slug")) === slug1 && (await slots(f, U1).nth(1).evaluate((e) => e.style.getPropertyValue("--media-radius"))) !== "", 30000));
  // Retirer la place.
  const len = listOf(U1).length;
  await hoverSlot(f, U1, 1);
  await mClick(toolBtn(f, "Retirer la place"));
  ok("C11 Retirer la place : la liste raccourcit d'une place", await waitFor(() => listOf(U1).length === len - 1, 30000), JSON.stringify(listOf(U1)));
  await settled();

  // Fichier de l'ordinateur : « Ajouter des images » de la barre du carrousel (sélecteur de fichiers réel).
  await sleep(1500);
  const addBtn = f.locator(`[data-edit-bitem="${U1}"] [data-edit-bitem-op="add-images"]`);
  await addBtn.scrollIntoViewIfNeeded({ timeout: 60000 });
  const n0 = listOf(U1).length;
  await page.screenshot({ path: path.join(SHOTS, "c4-avant-ajout.png") });
  await mHover(f.locator(`[data-edit-bitem="${U1}"] .pe-bitem-bar`));
  console.log("diag add-images :", JSON.stringify(await addBtn.boundingBox()), "visible:", await addBtn.isVisible(), "file input:", await f.locator("[data-edit-board-file]").count());
  const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 20000 }), mClick(addBtn)]);
  await chooser.setFiles({ name: "31f-d.png", mimeType: "image/png", buffer: await paint(900, 600, 4) });
  ok("C12 « Ajouter des images » : le fichier se range à la fin du carrousel", await waitFor(() => listOf(U1).length === n0 + 1 && typeof listOf(U1).at(-1) === "number", 120000), JSON.stringify(listOf(U1)));
  await settled();
  U2 = "";
});

/* ---- P. La bande d'origine : mêmes outils -------------------------------------------------------------------------------- */
await section("P", async () => {
  const strips = layout().filter((i) => i.type === "strip" && i.props.source !== "own");
  ok("P0 la bande des images du projet est toujours là", strips.length === 1);
  const rows = slotRows();
  await hoverSlot(f, "", -1);
  const names = await barButtons(f);
  ok("P1 mêmes outils sur la bande du projet : Remplacer, Supprimer, Retirer la place, Arrondi, Cadre", ["Remplacer", "Supprimer", "Retirer la place", "select:Arrondi de cette image", "Cadre"].every((n) => names.includes(n)), JSON.stringify(names));
  await page.screenshot({ path: path.join(SHOTS, "p1-bande-projet.png") });
  const firstFilled = await rail(f, "").evaluate((r) => [...r.querySelectorAll(":scope > [data-edit-slot]")].findIndex((e) => !e.hasAttribute("data-empty")));
  const slug = await slots(f, "").nth(firstFilled).getAttribute("data-slot-slug");
  const select = bar(f).locator('select[aria-label="Arrondi de cette image"]');
  const val = await select.locator("option").nth(1).getAttribute("value");
  await select.selectOption(val);
  ok("P2 Arrondi sur la bande du projet : look.slotRadius", await waitFor(() => lookOfDraft("board1")?.slotRadius?.[slug] === val, 30000), `${slug} ${val} ${JSON.stringify(lookOfDraft("board1"))} ${await page.locator(".a-toasts").innerText().catch(() => "?")}`);
  const empties = () => rail(f, "").locator(":scope > [data-edit-slot][data-empty]").count();
  const e0 = await empties();
  await hoverSlot(f, "", -1);
  await mClick(toolBtn(f, "Supprimer"));
  ok("P3 Supprimer sur la bande du projet : la place reste, vide", await waitFor(async () => (await empties()) === e0 + 1, 30000), `${await page.locator(".a-toasts").innerText().catch(() => "?")} / ${slotRows()}`);
  await hoverSlot(f, "", await rail(f, "").evaluate((r) => [...r.querySelectorAll(":scope > [data-edit-slot]")].findIndex((e) => e.hasAttribute("data-empty"))));
  await mClick(toolBtn(f, "Retirer la place"));
  ok("P4 Retirer la place sur la bande du projet", await waitFor(async () => (await empties()) === e0, 30000));
  ok("P5 les gestes de la bande du projet ont changé ses emplacements (et eux seuls)", slotRows() !== rows);
  await settled();
});

/* ---- M. Plusieurs carrousels --------------------------------------------------------------------------------------------- */
await section("M", async () => {
  await board.hover();
  await board.locator("[data-edit-bitem-add]").last().click();
  await f.locator(".pe-bitem-menu").waitFor({ timeout: 20000 });
  await f.locator('.pe-bitem-menu [data-bitem-type="strip"]').first().click();
  ok("M1 deuxième carrousel", await waitFor(() => carousels().length === 2, 30000));
  U2 = carousels().find((c) => c.uid !== U1).uid;
  await page.getByTestId("board-item-panel").waitFor({ timeout: 30000 });
  // Même média que la première image du premier carrousel.
  const shared = listOf(U1).find((x) => typeof x === "number");
  const prevCount = listOf(U1).length;
  await page.getByTestId("board-rail-add-image").click();
  await pickMedia(0);
  await settled();
  await page.keyboard.press("Escape");
  await sleep(500);
  ok("M2 deuxième carrousel garni", await waitFor(() => listOf(U2).length === 1, 30000), JSON.stringify(listOf(U2)));
  // Réglage sur le 2e uniquement.
  await hoverSlot(f, U2, 0);
  const select = bar(f).locator('select[aria-label="Arrondi de cette image"]');
  const val = await select.locator("option").nth(3).getAttribute("value");
  await select.selectOption(val);
  const slug2 = await slots(f, U2).nth(0).getAttribute("data-slot-slug");
  ok("M3 le réglage du 2e carrousel porte son propre slug", await waitFor(() => lookOfDraft("board1")?.slotRadius?.[slug2] === val, 30000) && slug2.startsWith(`${U2}-`), `${slug2} ${JSON.stringify(lookOfDraft("board1"))}`);
  const radiusOf = (uid) => slots(f, uid).nth(0).evaluate((e) => e.style.getPropertyValue("--media-radius"));
  ok("M4 l'arrondi du 2e carrousel est posé sur la toile", await waitFor(async () => (await radiusOf(U2)) !== "", 30000));
  const r1 = await radiusOf(U1);
  const r2 = await radiusOf(U2);
  ok("M4b la première image du premier carrousel n'a pas pris l'arrondi du second", r1 !== r2, `${r1} / ${r2}`);
  ok("M5 chaque carrousel garde sa liste", listOf(U1).length === prevCount && shared !== undefined);
  // Flèches ← → : une bande qui déborde les montre (public), sur la toile elles marchent comme en ligne.
  await page.screenshot({ path: path.join(SHOTS, "m1-deux-carrousels.png") });
  // Noms : un seul nom sur toutes les barres.
  const labels = await f.locator('[data-edit-bitem-type="strip"] .pe-bitem-name').allTextContents();
  ok("M6 chaque bande porte le même nom sur sa barre", labels.length === 3 && labels.every((l) => l.trim() === NAME), JSON.stringify(labels));
});

/* ---- N. Un seul nom ------------------------------------------------------------------------------------------------------ */
await section("N", async () => {
  const body = (await page.locator("body").innerText()) + (await f.locator("body").innerText());
  ok("N1 « Images du projet » n'apparaît nulle part dans l'éditeur", !/Images du projet/.test(body));
  await page.getByRole("tab", { name: "Ajouter" }).click();
  await sleep(500);
  ok("N2 « Images qui défilent » est dans la palette", (await page.locator("#ve-pane-ajouter").getByText(NAME, { exact: true }).count()) >= 1);
  await page.screenshot({ path: path.join(SHOTS, "n1-palette-et-nom.png") });
  // Menu « + Ajouter » après retrait de la bande du projet : l'entrée de remplacement porte le même nom.
  const stripFrame = f.locator('[data-edit-bitem-project]').first();
  await stripFrame.scrollIntoViewIfNeeded();
  await mHover(stripFrame.locator(".pe-bitem-bar").first());
  await mClick(stripFrame.locator('[data-edit-bitem-op="remove"]'));
  await sleep(1200);
  await board.hover();
  await board.locator("[data-edit-bitem-add]").last().click();
  await f.locator(".pe-bitem-menu").waitFor({ timeout: 20000 });
  const entries = await f.locator('.pe-bitem-menu [data-bitem-type="strip"] strong').allTextContents();
  ok("N3 menu sans bande du projet : les entrées « strip » portent le nom unique", entries.length === 2 && entries.every((e) => e.trim() === NAME), JSON.stringify(entries));
  await page.screenshot({ path: path.join(SHOTS, "n2-menu-ajouter.png") });
  // On remet la bande du projet (entrée « project »).
  await f.locator('.pe-bitem-menu [data-bitem-source="project"]').click();
  ok("N4 la bande du projet revient", await waitFor(() => layout().some((i) => i.type === "strip" && i.props.source !== "own"), 30000));
  await settled();
});

/* ---- U. Publication, public, téléphone ----------------------------------------------------------------------------------- */
await section("U", async () => {
  await settled();
  const lay = layout();
  const own = lay.filter((i) => i.type === "strip" && i.props.source === "own");
  const filled = (c) => c.props.media.filter((x) => typeof x === "number").length;
  // Parité : la toile avant publication.
  const edit = await f.evaluate(() => [...document.querySelectorAll("[data-edit-rail]")].map((r) => ({ rail: r.getAttribute("data-edit-rail"), n: r.querySelectorAll(":scope > [data-edit-slot]:not([data-empty])").length, radii: [...r.querySelectorAll(":scope > [data-edit-slot]:not([data-empty])")].map((e) => e.style.getPropertyValue("--media-radius")) })));
  await page.getByRole("button", { name: "Publier", exact: true }).click();
  ok("U0 page publiée", await waitFor(async () => /En ligne/.test((await page.locator(".ve-status").textContent()) ?? ""), 120000));
  const visitor = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pp = await visitor.newPage();
  pp.on("pageerror", (e) => errors.push(e.message));
  await pp.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
  const pub = await pp.evaluate(() => [...document.querySelectorAll(".strip-rail")].map((r) => ({ n: r.querySelectorAll(":scope > .strip-frame, :scope > [style*='contents']").length, radii: [...r.querySelectorAll(":scope > .strip-frame")].map((e) => e.style.getPropertyValue("--media-radius")), edit: r.outerHTML.includes("data-edit-") })));
  ok("U1 public : autant de bandes que sur la toile (images du projet + deux carrousels)", pub.length === edit.length && pub.length === 3, JSON.stringify([pub.length, edit.length]));
  ok("U2 public : même nombre d'images dans chaque carrousel que sur la toile, places vides masquées", own.every((c) => pub.some((p) => p.n === filled(c))) && JSON.stringify(pub.map((p) => p.n)) === JSON.stringify(edit.map((e) => e.n)), JSON.stringify({ pub: pub.map((p) => p.n), edit: edit.map((e) => e.n) }));
  ok("U3 public : mêmes arrondis par image que sur la toile", JSON.stringify(pub.map((p) => p.radii)) === JSON.stringify(edit.map((e) => e.radii)), JSON.stringify({ pub: pub.map((p) => p.radii), edit: edit.map((e) => e.radii) }));
  ok("U4 public : aucun repère d'édition dans les bandes", pub.every((p) => !p.edit));
  const count = await pp.locator(".strip-count").first().innerText();
  const n = Number(count.match(/\d+/)?.[0]);
  const ids = new Set(own.flatMap((c) => c.props.media.filter((x) => typeof x === "number")));
  const projectIds = new Set(JSON.parse(JSON.stringify(sql((db) => db.prepare("select media_id from slots where project_id = ? and media_id is not null").all(project.id)))).map((r) => r.media_id));
  const expected = pub[0].n + [...ids].filter((id) => !projectIds.has(id)).length;
  ok("U5 compteur « N œuvres » : images du projet + médias distincts des carrousels", n === expected, `${count} / attendu ${expected}`);
  ok("U6 les gestes des carrousels n'ont touché aucun emplacement du projet (le public montre ceux de la bande)", pub[0].n === projectIds.size, `${pub[0].n} / ${projectIds.size}`);
  await pp.locator(".strip-rail").nth(1).scrollIntoViewIfNeeded();
  await pp.screenshot({ path: path.join(SHOTS, "u1-public.png") });
  await visitor.close();

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await phone.newPage();
  mp.on("pageerror", (e) => errors.push(e.message));
  await mp.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
  const over = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const frames = await mp.locator(".strip-rail").nth(1).locator(".strip-frame").count();
  ok("U7 téléphone 390 px : aucun débordement horizontal, le carrousel est là", over <= 0 && frames > 0, `${over} / ${frames}`);
  await mp.locator(".strip-rail").nth(1).scrollIntoViewIfNeeded();
  await mp.screenshot({ path: path.join(SHOTS, "u2-telephone.png") });
  await phone.close();
});

ok("aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
void slotsBefore;
await browser.close();
console.log(failures ? `e2e-carrousel31f : ${failures} échec(s)` : "e2e-carrousel31f : OK");
process.exit(failures ? 1 : 0);
