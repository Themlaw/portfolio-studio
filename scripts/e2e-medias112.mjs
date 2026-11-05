#!/usr/bin/env node
/**
 * Onglet Médias (lot 112) : tris, mémorisation, ré-import retrouvable, défilement complet. UN chromium (plus un second pour le tactile),
 * serveur requis, base NEUVE, une connexion admin. Données SYNTHÉTIQUES (aplats, dates EXIF inventées). Aucune attente fixe : des conditions.
 *   S : préparation : 6 images « tri-… » aux dates inventées + 200 images de masse ; dates lues À L'IMPORT (base) ;
 *   A : chaque tri dans les deux sens (ordre mesuré dans l'onglet Médias de l'éditeur) ; sans date : à la fin et signalé ;
 *   D : filtres (tag, recherche) + tri combinés ;
 *   E : médias anciens (dates effacées de la base) : lecture paresseuse sans bloquer l'éditeur, originaux inchangés ;
 *   G : colonne « dernier envoi » vide = même ordre qu'avant (anciens médias) ;
 *   B : choix mémorisé (rechargement), partagé avec le bandeau Bibliothèque de la planche ;
 *   C : ré-import d'un doublon (éditeur et bandeau) : message, en tête, mis en évidence, visible, sans doublon en base ;
 *   F : les 200+ médias atteignables : molette, clavier, tactile (390 et 1024) ; bandeau : molette verticale, clavier, tactile.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=S,A,…] node scripts/e2e-medias112.mjs
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";

import { login, q1, waitFor } from "./lib/medias-setup.mjs";
import { exifMs, jpegDated, pngDated } from "./lib/medias112.mjs";

const BASE = process.env.BASE ?? "http://localhost:4600";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const DATA = process.env.DATA_DIR ?? "data";
const SHOTS = process.env.SHOTS ?? path.join(DATA, "..", "shots-medias112");
const DB = path.join(DATA, "portfolio.db");
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const sql = (fn) => {
  const db = new Database(DB);
  db.pragma("busy_timeout = 5000");
  try {
    return fn(db);
  } finally {
    db.close();
  }
};
const BULK = 200;
const D = { mangue: "2020:05:01 10:00:00", abricot: "2022:01:15 08:30:00", banane: "2019:03:03 12:00:00", dattes: "2023:02:02 18:45:00" };
const CITRON_PNG = "Tue, 20 Jul 2021 09:00:00 +0000";
// Nom → octets : l'ordre de ce tableau est l'ordre d'import (le plus ancien d'abord, hors masse).
const TRI = [
  ["tri-mangue.jpg", "image/jpeg", async () => jpegDated(48, 36, 11, { original: D.mangue }), ["fruit"]],
  ["__bulk__"],
  ["tri-abricot.jpg", "image/jpeg", async () => jpegDated(48, 36, 12, { original: D.abricot, digitized: "2000:01:01 00:00:00" }), []],
  ["tri-citron.png", "image/png", async () => pngDated(48, 36, 13, { text: { "Creation Time": CITRON_PNG } }), ["fruit"]],
  ["tri-banane.jpg", "image/jpeg", async () => jpegDated(48, 36, 14, { digitized: D.banane }), ["fruit"]],
  ["tri-sans-date.jpg", "image/jpeg", async () => jpegDated(48, 36, 15), []],
  ["tri-dattes.png", "image/png", async () => pngDated(48, 36, 16, { exif: { original: D.dattes } }), []],
];
const EXPECT_TAKEN = { "tri-mangue.jpg": exifMs(D.mangue), "tri-abricot.jpg": exifMs(D.abricot), "tri-citron.png": Date.UTC(2021, 6, 20, 9, 0, 0), "tri-banane.jpg": exifMs(D.banane), "tri-sans-date.jpg": null, "tri-dattes.png": exifMs(D.dattes) };
const BYTES = new Map();

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)));
await login(page, BASE);

async function send(name, mime, buffer, tags = []) {
  const r = await page.request.post(`${BASE}/admin/api/upload`, { headers: { origin: BASE }, multipart: { file: { name, mimeType: mime, buffer }, tags: JSON.stringify(tags) }, timeout: 180000 });
  return r.json();
}
const SEED = q1("select count(*) n from media").n;
async function section(name, fn) {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 6).join(" "));
    await page.screenshot({ path: path.join(SHOTS, `erreur-${name}.png`) }).catch(() => {});
  }
}
const idOf = (name) => q1("select id from media where original_name = ?", name)?.id;
const totalMedia = () => q1("select count(*) n from media where deleted_at is null and id not in (select media_id from wallpapers)").n;
const homeId = q1("select id from pages where json_extract(slug, '$.fr') = ''")?.id;

async function canvas(p = page) {
  const handle = await p.waitForSelector("iframe.ve-frame", { timeout: 120000 });
  const fr = await handle.contentFrame();
  await fr.waitForSelector("html[data-edit-mode]", { timeout: 180000 });
  return fr;
}
/** Éditeur de la page d'accueil, onglet Médias ouvert (feuille ouverte à 390). */
async function openMedias(p = page) {
  await p.goto(`${BASE}/admin/pages/${homeId}/editer`, { waitUntil: "domcontentloaded" });
  await canvas(p);
  if (await p.getByRole("button", { name: "Abandonner les modifications" }).count().catch(() => 0)) {
    /* brouillon éventuel : sans effet sur les médias */
  }
  const fab = p.locator(".ve-fab");
  if (await fab.isVisible().catch(() => false)) await fab.click();
  await p.getByRole("tab", { name: /Médias/ }).click();
  await p.locator(".ve-pane .ve-media li").first().waitFor({ timeout: 60000 });
}
const names = (p = page) => p.$$eval(".ve-pane .ve-media li .ve-media-name", (ns) => ns.map((n) => n.textContent));
const tri = async (p = page) => (await names(p)).filter((n) => n.startsWith("tri-"));
async function search(text, p = page) {
  await p.locator(".ve-media-search input").fill(text);
}
async function sortBy(value, p = page) {
  await p.locator('.ve-pane [data-testid="media-sort"]').selectOption(value);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const NAMES = TRI.filter((t) => t.length > 1).map((t) => t[0]);
const byDate = (dir) => {
  const dated = NAMES.filter((n) => EXPECT_TAKEN[n] !== null).sort((a, b) => (EXPECT_TAKEN[a] - EXPECT_TAKEN[b]) * dir);
  return [...dated, "tri-sans-date.jpg"];
};
const ADDED_DESC = ["tri-dattes.png", "tri-sans-date.jpg", "tri-banane.jpg", "tri-citron.png", "tri-abricot.jpg", "tri-mangue.jpg"];

// ---------------------------------------------------------------------------------------------------------------------------------
await section("S", async () => {
  for (const t of TRI) {
    if (t[0] === "__bulk__") {
      // Masse : 200 aplats distincts, envoyés 8 par 8.
      const jobs = Array.from({ length: BULK }, (_, i) => i);
      const worker = async () => {
        for (let i = jobs.shift(); i !== undefined; i = jobs.shift()) {
          const name = `masse-${String(i).padStart(3, "0")}.jpg`;
          const r = await send(name, "image/jpeg", await jpegDated(32, 24, 1000 + i));
          if (!r.ok) throw new Error(`envoi ${name} : ${JSON.stringify(r).slice(0, 120)}`);
        }
      };
      await Promise.all(Array.from({ length: 8 }, worker));
      continue;
    }
    const [name, mime, make, tags] = t;
    const buffer = await make();
    BYTES.set(name, { mime, buffer });
    const r = await send(name, mime, buffer, tags);
    if (!r.ok) throw new Error(`envoi ${name} : ${JSON.stringify(r).slice(0, 120)}`);
    await new Promise((r2) => setTimeout(r2, 30));
  }
  ok("S : 6 images « tri » et 200 images de masse importées (en plus du jeu de départ)", totalMedia() === SEED + BULK + NAMES.length, `${totalMedia()} dont ${SEED} de départ`);
  ok("S : tout est traité", await waitFor(() => q1("select count(*) n from media where status != 'ready'").n === 0, 300000));
  const rows = sql((db) => db.prepare("select original_name n, taken_at t, taken_checked c, last_import_at l from media where original_name like 'tri-%'").all());
  ok("S : date de création lue à l'import (EXIF DateTimeOriginal, CreateDate, PNG texte, PNG eXIf ; absente = vide)", rows.length === 6 && rows.every((r) => r.t === EXPECT_TAKEN[r.n] && r.c === 1), JSON.stringify(rows));
  ok("S : dernier envoi noté à l'import", rows.every((r) => r.l > 0));
});

await section("A", async () => {
  await openMedias();
  await search("tri-");
  await page.locator('.ve-pane .ve-media li[data-media]').nth(5).waitFor();
  ok("A : défaut = Ajouté récemment ↓ (menu sur cette valeur)", (await page.locator('.ve-pane [data-testid="media-sort"]').inputValue()) === "added-desc");
  ok("A : Ajouté récemment ↓ (plus récent d'abord)", same(await tri(), ADDED_DESC), (await tri()).join());
  await sortBy("added-asc");
  ok("A : Ajouté récemment ↑", same(await tri(), [...ADDED_DESC].reverse()), (await tri()).join());
  const asc = [...NAMES].sort((a, b) => a.localeCompare(b, "fr"));
  await sortBy("name-asc");
  ok("A : Nom A → Z", same(await tri(), asc), (await tri()).join());
  await sortBy("name-desc");
  ok("A : Nom Z → A", same(await tri(), [...asc].reverse()), (await tri()).join());
  await sortBy("taken-desc");
  ok("A : Date de création ↓ (sans date à la fin)", same(await tri(), byDate(-1)), (await tri()).join());
  await sortBy("taken-asc");
  ok("A : Date de création ↑ (sans date toujours à la fin)", same(await tri(), byDate(1)), (await tri()).join());
  ok("A : le média sans date est signalé (« Date inconnue »), les autres non", (await page.locator('.ve-pane [data-testid="media-nodate"]').count()) === 1 && (await page.locator('.ve-pane .ve-media li', { hasText: "tri-sans-date" }).locator('[data-testid="media-nodate"]').count()) === 1);
  await sortBy("added-desc");
  ok("A : pas de signalement hors tri par date de création", (await page.locator('.ve-pane [data-testid="media-nodate"]').count()) === 0);
  await page.screenshot({ path: path.join(SHOTS, "A-tri.png") });
});

await section("D", async () => {
  await openMedias();
  // Tag « fruit » (mangue, citron, banane) × recherche × tri.
  await page.locator(".ve-chips").getByRole("button", { name: "fruit", exact: true }).click();
  await sortBy("name-asc");
  const f = async () => (await names()).filter((n) => n.startsWith("tri-"));
  ok("D : tag + Nom A → Z", same(await f(), ["tri-banane.jpg", "tri-citron.png", "tri-mangue.jpg"]), (await f()).join());
  ok("D : le filtre ne laisse que les fruits", (await names()).length === 3, String((await names()).length));
  await sortBy("taken-desc");
  ok("D : tag + Date de création ↓", same(await f(), ["tri-citron.png", "tri-mangue.jpg", "tri-banane.jpg"]), (await f()).join());
  await search("an");
  await sortBy("added-asc");
  ok("D : tag + recherche « an » + Ajouté ↑", same(await f(), ["tri-mangue.jpg", "tri-banane.jpg"]), (await f()).join());
  await page.locator(".ve-chips").getByRole("button", { name: "fruit", exact: true }).click();
  await search("");
  await sortBy("added-desc");
});

await section("E", async () => {
  // Médias « anciens » : toutes les dates effacées de la base (comme avant le lot) ; les originaux ne doivent pas bouger.
  const originals = sql((db) => db.prepare("select key from media where original_name like 'tri-%'").all()).map((r) => path.join(DATA, "media", r.key));
  const snap = () => originals.map((f) => `${createHash("sha256").update(readFileSync(f)).digest("hex")}:${statSync(f).mtimeMs}`);
  const before = snap();
  sql((db) => db.prepare("update media set taken_at = null, taken_checked = null").run());
  const t0 = Date.now();
  await openMedias();
  ok("E : l'éditeur s'ouvre sans attendre la lecture des dates", Date.now() - t0 < 60000 && (await page.locator(".ve-pane .ve-media li").count()) > 0);
  await search("tri-");
  await sortBy("taken-desc");
  ok("E : les dates anciennes sont lues en tâche de fond, le tri se rétablit", await waitFor(async () => same(await tri(), byDate(-1)), 120000), (await tri()).join());
  ok("E : tous les médias lus (base) : même dates qu'à l'import, rien d'inconnu relu", await waitFor(() => q1("select count(*) n from media where taken_checked is null").n === 0, 120000));
  const rows = sql((db) => db.prepare("select original_name n, taken_at t from media where original_name like 'tri-%'").all());
  ok("E : dates lues = dates attendues", rows.every((r) => r.t === EXPECT_TAKEN[r.n]), JSON.stringify(rows));
  ok("E : « Date inconnue » sur le média sans date", (await page.locator('.ve-pane .ve-media li', { hasText: "tri-sans-date" }).locator('[data-testid="media-nodate"]').count()) === 1);
  ok("E : originaux intacts (contenu et date de modification)", same(before, snap()));
  await sortBy("added-desc");
});

await section("G", async () => {
  // Anciens médias : « dernier envoi » vide. L'ordre « Ajouté récemment » ne change pas (date d'ajout, puis identifiant).
  sql((db) => db.prepare("update media set last_import_at = null").run());
  await openMedias();
  await search("tri-");
  await page.locator('.ve-pane .ve-media li[data-media]').nth(5).waitFor();
  ok("G : sans date de dernier envoi, même ordre qu'avant", same(await tri(), ADDED_DESC), (await tri()).join());
});

await section("B", async () => {
  await openMedias();
  await sortBy("name-desc");
  await page.reload({ waitUntil: "domcontentloaded" });
  await canvas();
  await page.getByRole("tab", { name: /Médias/ }).click();
  await page.locator('.ve-pane [data-testid="media-sort"]').waitFor();
  ok("B : le tri choisi est retrouvé après rechargement", await waitFor(async () => (await page.locator('.ve-pane [data-testid="media-sort"]').inputValue()) === "name-desc", 10000));
  await search("tri-");
  ok("B : et il s'applique", same(await tri(), [...NAMES].sort((a, b) => b.localeCompare(a, "fr"))), (await tri()).join());
  // Bandeau Bibliothèque de la planche : même menu, même préférence.
  await page.goto(`${BASE}/admin/pages#projets`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Nouveau projet" }).click();
  // Lot 111 : le projet se crée sans nom (plus de champ « Titre ») et l écran propose aussitôt le choix d images : on le referme.
  await page.locator("dialog[open]").getByRole("button", { name: "Créer le projet" }).click();
  await page.waitForURL(/\/admin\/projets\/\d+$/);
  await page.locator("dialog[open]").first().waitFor({ timeout: 5000 }).then(() => page.keyboard.press("Escape"), () => {});
  const strip = page.locator(".a-libstrip");
  await strip.locator('[data-testid="media-sort"]').waitFor();
  ok("B : le bandeau de la planche reprend le choix (Nom Z → A)", await waitFor(async () => (await strip.locator('[data-testid="media-sort"]').inputValue()) === "name-desc", 10000));
  await strip.getByPlaceholder("Rechercher…").fill("tri-");
  const stripNames = () => strip.locator(".a-libthumb-add").evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label").replace(/^Ajouter /, "").replace(/ à la fin du projet$/, "")));
  ok("B : bandeau, Nom Z → A", same(await stripNames(), [...NAMES].sort((a, b) => b.localeCompare(a, "fr"))), (await stripNames()).join());
  for (const [v, exp, label] of [["added-desc", ADDED_DESC, "Ajouté ↓"], ["added-asc", [...ADDED_DESC].reverse(), "Ajouté ↑"], ["name-asc", [...NAMES].sort((a, b) => a.localeCompare(b, "fr")), "Nom A → Z"], ["taken-desc", byDate(-1), "Création ↓"], ["taken-asc", byDate(1), "Création ↑"]]) {
    await strip.locator('[data-testid="media-sort"]').selectOption(v);
    ok(`B : bandeau, ${label}`, same(await stripNames(), exp), (await stripNames()).join());
  }
  ok("B : bandeau, date inconnue signalée (tri par création)", (await strip.locator('[data-testid="media-nodate"]').count()) === 1);
  await strip.locator('[data-testid="media-sort"]').selectOption("added-desc");
  ok("B : le choix du bandeau est la préférence de l'éditeur aussi", await (async () => {
    await openMedias();
    return waitFor(async () => (await page.locator('.ve-pane [data-testid="media-sort"]').inputValue()) === "added-desc", 10000);
  })());
});

await section("C", async () => {
  sql((db) => db.prepare("update media set last_import_at = created_at * 1000").run());
  const mangue = idOf("tri-mangue.jpg");
  const count0 = q1("select count(*) n from media").n;
  const before = q1("select last_import_at l from media where id = ?", mangue).l;
  // ---- Éditeur : onglet Médias, liste défilée tout en bas.
  await openMedias();
  const pane = page.locator("#ve-pane-medias");
  await page.locator(".ve-pane .ve-media li").first().waitFor();
  for (let i = 0; i < 6; i++) {
    await pane.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await page.waitForTimeout(250);
  }
  ok("C : avant, le fichier est tout en bas (ancien, hors de vue)", await pane.evaluate((el, id) => {
    const li = el.querySelector(`[data-media="${id}"]`);
    if (!li) return true;
    const r = li.getBoundingClientRect();
    const p = el.getBoundingClientRect();
    return r.bottom < p.top || r.top > p.bottom;
  }, mangue));
  const { mime, buffer } = BYTES.get("tri-mangue.jpg");
  await page.locator(".ve-pane input[type=file]").setInputFiles({ name: "tri-mangue.jpg", mimeType: mime, buffer });
  ok("C : message « Déjà dans la médiathèque »", await page.locator(".a-toast", { hasText: "Déjà dans la médiathèque" }).first().waitFor({ timeout: 60000 }).then(() => true, () => false));
  ok("C : il remonte en tête de « Ajouté récemment » (éditeur)", await waitFor(async () => (await names())[0] === "tri-mangue.jpg", 60000), (await names()).slice(0, 3).join());
  ok("C : il est mis en évidence", await waitFor(() => page.locator(`.ve-pane .ve-media li[data-media="${mangue}"][data-flash]`).count().then((n) => n === 1), 10000));
  ok("C : la liste a défilé jusqu'à lui (visible dans le panneau)", await pane.evaluate((el, id) => {
    const r = el.querySelector(`[data-media="${id}"]`)?.getBoundingClientRect();
    const p = el.getBoundingClientRect();
    return Boolean(r) && r.top >= p.top - 1 && r.bottom <= p.bottom + 1;
  }, mangue));
  ok("C : base : même média (pas de doublon), dernier envoi mis à jour", q1("select count(*) n from media").n === count0 && q1("select last_import_at l from media where id = ?", mangue).l > before);
  await page.screenshot({ path: path.join(SHOTS, "C-editeur.png") });
  // Tri actif différent : le fichier renvoyé reste retrouvé (filtres levés).
  await openMedias();
  await search("zzz-rien");
  const abricot = idOf("tri-abricot.jpg");
  await sortBy("name-desc");
  const ab = BYTES.get("tri-abricot.jpg");
  await page.locator(".ve-pane input[type=file]").setInputFiles({ name: "tri-abricot.jpg", mimeType: ab.mime, buffer: ab.buffer });
  ok("C : avec un filtre qui le cachait et un autre tri : filtre levé, fichier en vue et mis en évidence", await waitFor(() => pane.evaluate((el, id) => {
    const li = el.querySelector(`[data-media="${id}"][data-flash]`);
    if (!li) return false;
    const r = li.getBoundingClientRect();
    const p = el.getBoundingClientRect();
    return r.top >= p.top - 1 && r.bottom <= p.bottom + 1;
  }, abricot), 60000));
  await sortBy("added-desc");
  // ---- Bandeau de la planche.
  const proj = q1("select id from projects order by id desc limit 1").id;
  await page.goto(`${BASE}/admin/projets/${proj}`, { waitUntil: "networkidle" });
  const strip = page.locator(".a-libstrip");
  const row = strip.locator(".a-libstrip-row");
  await row.waitFor();
  const citron = idOf("tri-citron.png");
  for (let i = 0; i < 8; i++) {
    await row.evaluate((el) => (el.scrollLeft = el.scrollWidth));
    await page.waitForTimeout(250);
  }
  ok("C : bandeau, avant : le fichier est loin à droite (hors de vue)", await row.evaluate((el, id) => {
    const t = el.querySelector(`[data-media="${id}"]`);
    if (!t) return true;
    const r = t.getBoundingClientRect();
    const p = el.getBoundingClientRect();
    return r.right < p.left || r.left > p.right;
  }, citron));
  const ci = BYTES.get("tri-citron.png");
  await page.locator('input[type=file]').first().setInputFiles({ name: "tri-citron.png", mimeType: ci.mime, buffer: ci.buffer });
  ok("C : bandeau, message « Déjà dans la médiathèque »", await page.locator(".a-toast", { hasText: "Déjà dans la médiathèque" }).first().waitFor({ timeout: 60000 }).then(() => true, () => false));
  ok("C : bandeau, il remonte en tête, mis en évidence et visible", await waitFor(() => row.evaluate((el, id) => {
    const first = el.querySelector(".a-libthumb-drag")?.getAttribute("data-media");
    const t = el.querySelector(`.a-libthumb[data-flash] [data-media="${id}"]`);
    if (!t || first !== String(id)) return false;
    const r = t.getBoundingClientRect();
    const p = el.getBoundingClientRect();
    return r.left >= p.left - 1 && r.right <= p.right + 1;
  }, citron), 60000));
  await page.screenshot({ path: path.join(SHOTS, "C-bandeau.png") });
});

/** Fait défiler jusqu'à ce que `count()` atteigne `total` (ou 90 tours). */
async function until(total, step, count) {
  for (let i = 0; i < 90; i++) {
    if ((await count()) >= total) return true;
    await step(i);
    await page.waitForTimeout(150);
  }
  return (await count()) >= total;
}

await section("F", async () => {
  const total = totalMedia();
  sql((db) => db.prepare("update media set taken_at = null where taken_at is null").run());
  const ids = sql((db) => db.prepare("select id from media where deleted_at is null and id not in (select media_id from wallpapers)").all()).map((r) => r.id);
  const seen = async (p = page) => new Set(await p.$$eval(".ve-pane .ve-media li[data-media]", (ls) => ls.map((l) => Number(l.dataset.media))));
  const allSeen = async (p = page) => {
    const s = await seen(p);
    return ids.every((i) => s.has(i));
  };
  // ---- Souris : molette sur la liste.
  await openMedias();
  const box = await page.locator("#ve-pane-medias").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await until(total, () => page.mouse.wheel(0, 1600), async () => (await seen()).size);
  ok(`F : molette, les ${total} médias sont atteignables`, await allSeen(), `${(await seen()).size} sur ${total}`);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 3000);
  ok("F : molette, jusqu'au bout de la liste (le plus ancien visible en bas)", await waitFor(() => page.locator("#ve-pane-medias").evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 4), 5000));
  // ---- Clavier : une vignette prend le focus, Fin charge la suite.
  await openMedias();
  await page.locator(".ve-pane .ve-media li[data-media]").first().focus();
  await until(total, () => page.keyboard.press("End"), async () => (await seen()).size);
  ok(`F : clavier (Fin), les ${total} médias sont atteignables`, await allSeen(), `${(await seen()).size} sur ${total}`);
  await openMedias();
  await page.locator(".ve-pane .ve-media li[data-media]").first().focus();
  // Tab enchaînés sans pause : la suite doit être chargée avant que le focus ne quitte la liste.
  for (let i = 0; i < 600 && (await seen()).size < total; i++) await page.keyboard.press("Tab");
  ok("F : clavier (Tab de vignette en vignette), la suite se charge sans fin", (await seen()).size === total, String((await seen()).size));
  // ---- Bandeau : molette verticale sur la rangée horizontale, clavier.
  const proj = q1("select id from projects order by id desc limit 1").id;
  await page.goto(`${BASE}/admin/projets/${proj}`, { waitUntil: "networkidle" });
  const row = page.locator(".a-libstrip-row");
  await row.waitFor();
  const stripSeen = async (p = page) => new Set(await p.$$eval(".a-libstrip-row .a-libthumb-drag[data-media]", (ls) => ls.map((l) => Number(l.dataset.media))));
  const stripAll = async (p = page) => {
    const s = await stripSeen(p);
    return ids.every((i) => s.has(i));
  };
  await row.scrollIntoViewIfNeeded();
  const rb = await row.boundingBox();
  await page.mouse.move(rb.x + rb.width / 2, rb.y + 36);
  const left0 = await row.evaluate((el) => el.scrollLeft);
  await page.mouse.wheel(0, 500);
  ok("F : bandeau, la molette VERTICALE fait défiler la rangée horizontale", await waitFor(() => row.evaluate((el, l0) => el.scrollLeft > l0 + 100, left0), 5000));
  await until(total, () => page.mouse.wheel(0, 3000), async () => (await stripSeen()).size);
  ok(`F : bandeau, molette, les ${total} médias sont atteignables`, await stripAll(), `${(await stripSeen()).size} sur ${total}`);
  await page.reload({ waitUntil: "networkidle" });
  await row.waitFor();
  await row.focus();
  const sl0 = await row.evaluate((el) => el.scrollLeft);
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
  ok("F : bandeau, la flèche droite fait défiler la rangée (focus sur la rangée)", await waitFor(() => row.evaluate((el, l0) => el.scrollLeft > l0 + 40, sl0), 5000));
  // Tab de « + » en « + » : la suite est chargée avant que le focus ne quitte la rangée.
  await page.locator(".a-libstrip-row .a-libthumb-add").first().focus();
  for (let i = 0; i < 500 && (await stripSeen()).size < total; i++) await page.keyboard.press("Tab");
  ok(`F : bandeau, clavier (Tab), les ${total} médias sont atteignables`, await stripAll(), `${(await stripSeen()).size} sur ${total}`);

  // ---- Tactile : 390 (feuille) et 1024.
  for (const [w, h] of [[390, 844], [1024, 768]]) {
    const tctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: w < 500 });
    const tp = await tctx.newPage();
    tp.on("pageerror", (e) => errors.push(`tactile ${w} : ${e.message.slice(0, 160)}`));
    await login(tp, BASE);
    const cdp = await tctx.newCDPSession(tp);
    // Vrai doigt : touchStart, une douzaine de touchMove, touchEnd (le navigateur en fait un défilement, ou non selon touch-action).
    const swipe = async (x, y, dx, dy) => {
      const at = (type, k) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: x + dx * k, y: y + dy * k, id: 1 }] });
      await at("touchStart", 0);
      for (let k = 1; k <= 12; k++) {
        await at("touchMove", k / 12);
        await tp.waitForTimeout(16);
      }
      await at("touchEnd", 1);
    };
    await openMedias(tp);
    const pb = await tp.locator("#ve-pane-medias").boundingBox();
    const tseen = async () => (await seen(tp)).size;
    const fits = async () => tp.locator("#ve-pane-medias").evaluate((el) => el.scrollHeight > el.clientHeight);
    ok(`F : tactile ${w}, la liste dépasse l'écran`, await fits());
    const top0 = await tp.locator("#ve-pane-medias").evaluate((el) => el.scrollTop);
    // Le doigt se pose SUR une vignette (le cas qui bloquait).
    const th = await tp.locator(".ve-pane .ve-media li[data-media]").nth(4).boundingBox();
    await swipe(th.x + th.width / 2, Math.min(th.y + th.height / 2, pb.y + pb.height - 40), 0, -300);
    ok(`F : tactile ${w}, un balayage parti d'une vignette fait défiler la liste`, await waitFor(() => tp.locator("#ve-pane-medias").evaluate((el, t0) => el.scrollTop > t0 + 50, top0), 8000));
    await until(total, async () => {
      const r = await tp.locator("#ve-pane-medias").boundingBox();
      await swipe(r.x + r.width / 2, r.y + r.height - 60, 0, -(r.height - 120));
    }, tseen);
    ok(`F : tactile ${w}, les ${total} médias sont atteignables`, await allSeen(tp), `${await tseen()} sur ${total}`);
    // Bandeau (page projet) : balayage horizontal parti d'une vignette.
    await tp.goto(`${BASE}/admin/projets/${proj}`, { waitUntil: "networkidle" });
    const trow = tp.locator(".a-libstrip-row");
    await trow.waitFor();
    await trow.scrollIntoViewIfNeeded();
    const sc0 = await trow.evaluate((el) => el.scrollLeft);
    const tb = await tp.locator(".a-libthumb-drag[data-media]").nth(1).boundingBox();
    await swipe(tb.x + tb.width / 2, tb.y + tb.height / 2, -250, 0);
    ok(`F : tactile ${w}, bandeau : un balayage horizontal parti d'une vignette fait défiler la rangée`, await waitFor(() => trow.evaluate((el, s0) => el.scrollLeft > s0 + 50, sc0), 8000));
    await until(total, async () => {
      const r = await trow.boundingBox();
      await swipe(r.x + r.width - 40, r.y + 36, -(r.width - 80), 0);
    }, async () => (await stripSeen(tp)).size);
    ok(`F : tactile ${w}, bandeau : les ${total} médias sont atteignables`, await stripAll(tp), `${(await stripSeen(tp)).size} sur ${total}`);
    await tctx.close();
  }
});

ok("aucune erreur JavaScript", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout est passé.");
process.exit(failures ? 1 : 0);
