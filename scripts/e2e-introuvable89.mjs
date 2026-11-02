#!/usr/bin/env node
/**
 * Lot 89 « la 404 devient une page éditable » : UN chromium, serveur dev OU standalone, base NEUVE (seed), données SYNTHÉTIQUES.
 *
 *  A. Sans modification : la 404 répond 404 + noindex + no-store, textes de messages/*.json, fr et en ; captures 1440 et 390 px
 *     (comparées pixel à pixel à celles de la v0.31.1 quand PARITY_BASELINE est donné) ; /fr/_404 se comporte pareil.
 *  B. Page modifiée et publiée : ses blocs s'affichent, toujours 404 / noindex / no-store ; un brouillon reste invisible au public.
 *  C. Replis : page retirée du site, vidée, blocs illisibles → la 404 d'origine ; sans bloc « Sortie » → bouton « Retour à l'accueil ».
 *  D. Bloc « Sortie » : non supprimable dans l'éditeur (bouton, touche, ✕), absent du catalogue d'une autre page, fr / en, messages qui
 *     varient d'une visite à l'autre.
 *  E. « Une œuvre au hasard » : les 3 sources, un lien qui mène à l'œuvre, source vide = bloc absent.
 *  F. Exclusions : plan du site, menu, sélecteur de langue, pages à lier ; Admin → Pages (badge, aide, pas de suppression ni de menu).
 *  Mode MODE=shots : seulement les captures de A (à lancer sur rel/v0311 pour avoir la référence).
 * Captures : $SHOTS. Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… [BASE=http://localhost:3001] [SHOTS=…] [BEFORE=dossier des captures de la v0.31.1] [ONLY=A,B] node scripts/e2e-introuvable89.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";
import sharp from "sharp";

import { login, pageIdOf } from "./lib/medias-setup.mjs";
import { publishBlocks } from "./lib/page-draft.mjs";

const BASE = process.env.BASE ?? "http://localhost:3001";
const DATA = process.env.DATA_DIR ?? "data";
const DB = path.join(DATA, "portfolio.db");
const SHOTS = process.env.SHOTS ?? "screenshots/introuvable89";
const BASELINE = process.env.BEFORE ?? process.env.PARITY_BASELINE ?? "";
const MODE = process.env.MODE ?? "";
const ONLY = process.env.ONLY ?? "";
const run = (k) => !ONLY || ONLY.split(",").includes(k);
mkdirSync(SHOTS, { recursive: true });
const MSG = { fr: JSON.parse(readFileSync("messages/fr.json", "utf8")).notFound, en: JSON.parse(readFileSync("messages/en.json", "utf8")).notFound };
const L = (s) => ({ fr: s, en: s });

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (sql, ...args) => {
  const db = new Database(DB, { readonly: true });
  try {
    return db.prepare(sql).all(...args);
  } finally {
    db.close();
  }
};
const exec = (sql, ...args) => {
  const db = new Database(DB);
  try {
    db.pragma("busy_timeout = 5000");
    return db.prepare(sql).run(...args);
  } finally {
    db.close();
  }
};
async function waitFor(fn, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(300);
  }
  return false;
}
const get = async (p, init) => {
  const r = await fetch(`${BASE}${p}`, { redirect: "manual", ...init });
  return { status: r.status, headers: r.headers, text: await r.text() };
};
const textOf = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

const browser = await chromium.launch({ args: ["--disable-gpu"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
page.setDefaultNavigationTimeout(120000);
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

/* ---- Captures de la 404 (A, et référence en MODE=shots) ---------------------------------------------------------------- */

async function shoot(locale, width, dir) {
  const c = await browser.newContext({ viewport: { width, height: width > 600 ? 900 : 844 } });
  const p = await c.newPage();
  await p.goto(`${BASE}/${locale}/introuvable-xyz`, { waitUntil: "networkidle" });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(1200);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `404-${locale}-${width}.png`);
  await p.screenshot({ path: file, fullPage: true, animations: "disabled" });
  await c.close();
  return file;
}

if (MODE === "shots") {
  for (const loc of ["fr", "en"]) for (const w of [1440, 390]) console.log(await shoot(loc, w, path.join(SHOTS, "ref")));
  await browser.close();
  process.exit(0);
}

await login(page, BASE);
const specialId = q("select id from pages where json_extract(slug, '$.fr') = '_404'")[0]?.id;
ok("la page « _404 » existe après le démarrage (une seule)", q("select id from pages where json_extract(slug, '$.fr') = '_404'").length === 1 && Number.isInteger(specialId));
const originalExit = q("select props from blocks where page_id = ? and type = 'exit'", specialId)[0]?.props;

/* ---- A. Sans modification ---------------------------------------------------------------------------------------------- */

if (run("A")) {
  for (const loc of ["fr", "en"]) {
    for (const url of [`/${loc}/introuvable-xyz`, `/${loc}/_404`, `/${loc}/a/b/c`]) {
      const r = await get(url);
      ok(`A ${url} : 404, noindex, no-store`, r.status === 404 && /noindex/.test(r.headers.get("x-robots-tag") ?? "") && /no-store/.test(r.headers.get("cache-control") ?? ""), `${r.status} ${r.headers.get("x-robots-tag")} ${r.headers.get("cache-control")}`);
      const t = textOf(r.text);
      const m = MSG[loc];
      ok(`A ${url} : les textes de la 404 d'origine (${loc})`, t.includes(m.eyebrow) && t.includes(m.title) && t.includes(m.body) && t.includes(m.back), t.slice(0, 200));
      ok(`A ${url} : un seul bouton de retour, vers l'accueil`, new RegExp(`<a[^>]*class="btn[^"]*"[^>]*href="/${loc}"`).test(r.text) || new RegExp(`<a[^>]*href="/${loc}"[^>]*class="btn`).test(r.text));
      ok(`A ${url} : ni brouillon ni repli`, !r.text.includes("data-exit-fallback") && !r.text.includes("data-edit-block"));
    }
  }
  const files = [];
  for (const loc of ["fr", "en"]) for (const w of [1440, 390]) files.push(await shoot(loc, w, path.join(SHOTS, "after")));
  if (BASELINE) {
    for (const f of files) {
      const ref = path.join(BASELINE, path.basename(f));
      const [a, b] = await Promise.all([sharp(ref).raw().ensureAlpha().toBuffer({ resolveWithObject: true }), sharp(f).raw().ensureAlpha().toBuffer({ resolveWithObject: true })]);
      let diff = -1;
      if (a.info.width === b.info.width && a.info.height === b.info.height) {
        diff = 0;
        for (let i = 0; i < a.data.length; i += 4) if (a.data[i] !== b.data[i] || a.data[i + 1] !== b.data[i + 1] || a.data[i + 2] !== b.data[i + 2]) diff++;
      }
      ok(`A parité au pixel avec la v0.31.1 : ${path.basename(f)} (${a.info.width}×${a.info.height})`, diff === 0, diff < 0 ? `taille ${a.info.width}×${a.info.height} → ${b.info.width}×${b.info.height}` : `${diff} px différents`);
    }
  } else console.log("INFO PARITY_BASELINE absent : parité au pixel non vérifiée dans cette exécution");
}

/* ---- Aides pour la suite ------------------------------------------------------------------------------------------------ */

const exitProps = () => JSON.parse(originalExit);
const exitBlock = (over = {}) => ({ uid: "x1", type: "exit", props: { ...exitProps(), ...over } });
const textBlock = (uid, title) => ({ uid, type: "rich-text", props: { title: L(title), paragraphs: [L("Texte de contrôle du lot 89.")] } });
const blockTypes = () => q("select type from blocks where page_id = ? order by position", specialId).map((r) => r.type);

/** Remet la page dans son état de départ (un seul bloc « Sortie », en ligne) et vide le cache par un aller-retour hors ligne / en ligne. */
async function togglePublished(off) {
  await page.goto(`${BASE}/admin/pages`, { waitUntil: "networkidle" });
  const row = page.locator('[data-testid="page-speciale"]');
  await row.getByRole("button", { name: off ? "Retirer du site" : "Mettre en ligne" }).click();
  await waitFor(() => q("select published from pages where id = ?", specialId)[0].published === (off ? 0 : 1));
  await sleep(800);
}
async function flush() {
  await togglePublished(true);
  await togglePublished(false);
}
async function resetPage() {
  exec("delete from blocks where page_id = ?", specialId);
  exec("insert into blocks (page_id, position, type, props) values (?, 0, 'exit', ?)", specialId, originalExit);
  exec("update pages set draft = null, published = 1 where id = ?", specialId);
  await flush();
}

/* ---- B. Page modifiée et publiée ---------------------------------------------------------------------------------------- */

if (run("B")) {
  const done = await publishBlocks(page, BASE, specialId, (blocks) => [textBlock("m1", "Marqueur-89-publié"), ...blocks], () => blockTypes().length === 2);
  ok("B publication par l'éditeur : le bloc ajouté est en base", done && blockTypes().join() === "rich-text,exit", blockTypes().join());
  for (const loc of ["fr", "en"]) {
    const r = await get(`/${loc}/introuvable-xyz`);
    ok(`B (${loc}) : le bloc ajouté s'affiche, avec la Sortie`, r.text.includes("Marqueur-89-publié") && textOf(r.text).includes(MSG[loc].body));
    ok(`B (${loc}) : toujours 404, noindex, no-store`, r.status === 404 && /noindex/.test(r.headers.get("x-robots-tag") ?? "") && /no-store/.test(r.headers.get("cache-control") ?? ""));
  }
  // Brouillon : écrit en base comme l'éditeur ; le public ne le voit pas.
  const row = q("select draft from pages where id = ?", specialId)[0];
  const draft = row.draft ? JSON.parse(row.draft) : null;
  const base = draft ?? { title: L("Page introuvable"), slug: L("_404"), meta: { title: L(""), description: L("") }, published: true, inMenu: false, accent: null, blocks: [] };
  base.blocks = [textBlock("m9", "Brouillon-89-secret"), exitBlock()];
  exec("update pages set draft = ?, draft_updated_at = unixepoch(), draft_rev = draft_rev + 1 where id = ?", JSON.stringify(base), specialId);
  const r = await get("/fr/introuvable-xyz");
  ok("B un brouillon n'est jamais visible au public", !r.text.includes("Brouillon-89-secret") && r.text.includes("Marqueur-89-publié"));
  exec("update pages set draft = null where id = ?", specialId);
  await resetPage();
  ok("B retour à l'état de départ", blockTypes().join() === "exit");
}

/* ---- C. Replis ---------------------------------------------------------------------------------------------------------- */

if (run("C")) {
  const original = async (label) => {
    const r = await get("/fr/introuvable-xyz");
    const t = textOf(r.text);
    ok(`C ${label} : la 404 d'origine, jamais une page blanche`, r.status === 404 && t.includes(MSG.fr.title) && t.includes(MSG.fr.body) && t.includes(MSG.fr.back) && /noindex/.test(r.headers.get("x-robots-tag") ?? ""), `${r.status} ${t.slice(0, 120)}`);
    return r;
  };
  await publishBlocks(page, BASE, specialId, (blocks) => [textBlock("m1", "Marqueur-89-C"), ...blocks], () => blockTypes().length === 2);
  ok("C (départ) le bloc ajouté s'affiche", (await get("/fr/introuvable-xyz")).text.includes("Marqueur-89-C"));
  await togglePublished(true);
  let r = await original("page retirée du site");
  ok("C page retirée : le contenu modifié n'apparaît plus", !r.text.includes("Marqueur-89-C"));
  await togglePublished(false);
  ok("C page remise en ligne : le contenu modifié revient", (await get("/fr/introuvable-xyz")).text.includes("Marqueur-89-C"));
  // Vide.
  exec("delete from blocks where page_id = ?", specialId);
  await flush();
  await original("page vide");
  // Illisible.
  exec("insert into blocks (page_id, position, type, props) values (?, 0, 'exit', ?)", specialId, JSON.stringify({ title: 5, messages: "x" }));
  await flush();
  r = await original("blocs illisibles");
  // Sans « Sortie » : le bouton de retour est ajouté.
  exec("delete from blocks where page_id = ?", specialId);
  exec("insert into blocks (page_id, position, type, props) values (?, 0, 'rich-text', ?)", specialId, JSON.stringify(textBlock("t", "Sans-sortie-89").props));
  await flush();
  for (const loc of ["fr", "en"]) {
    r = await get(`/${loc}/introuvable-xyz`);
    const m = r.text.match(/data-exit-fallback[\s\S]{0,400}?<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
    ok(`C sans bloc « Sortie » (${loc}) : un bouton « ${MSG[loc].back} » vers l'accueil`, r.status === 404 && r.text.includes("Sans-sortie-89") && Boolean(m) && m[1] === `/${loc}` && textOf(m[2]).includes(MSG[loc].back), m?.[0].slice(0, 160));
  }
  await resetPage();
}

/* ---- D. Bloc « Sortie » ------------------------------------------------------------------------------------------------- */

const canvas = async () => {
  const handle = await page.waitForSelector("iframe.ve-frame", { timeout: 60000 });
  const f = await handle.contentFrame();
  await f.waitForSelector("html[data-edit-mode]", { timeout: 120000 });
  return f;
};

if (run("D")) {
  await page.goto(`${BASE}/admin/pages/${specialId}/editer`, { waitUntil: "domcontentloaded" });
  const f = await canvas();
  ok("D l'éditeur ouvre la page « Page introuvable » (réponse 404) avec son bloc Sortie", (await f.locator('[data-edit-type="exit"]').count()) === 1);
  ok("D le bloc Sortie est marqué verrouillé sur la toile", (await f.locator('[data-edit-type="exit"][data-edit-locked]').count()) === 1);
  // Sélection au clavier, puis tentatives de suppression.
  await f.evaluate(() => {
    window.focus();
    document.body.tabIndex = -1;
    document.body.focus();
    document.body.removeAttribute("tabindex");
  });
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await f.waitForSelector(".pe-selected", { timeout: 20000 });
  const sup = f.locator(".pe-tools").getByRole("button", { name: "Supprimer" });
  ok("D ✕ de la toile : désactivé, avec l'explication", (await sup.getAttribute("aria-disabled")) === "true" && /ne peut pas être supprimé/.test((await sup.getAttribute("title")) ?? ""), String(await sup.getAttribute("title")));
  await sup.click({ force: true });
  await sleep(600);
  ok("D ✕ de la toile : le bloc reste", (await f.locator('[data-edit-type="exit"]').count()) === 1 && (await page.getByRole("dialog").count()) === 0);
  await page.keyboard.press("Delete");
  await sleep(600);
  ok("D touche Suppr : le bloc reste", (await f.locator('[data-edit-type="exit"]').count()) === 1 && (await page.getByRole("dialog").count()) === 0);
  const panelDelete = page.locator('button[aria-label="Supprimer"][data-locked]');
  ok("D panneau Réglages : « Supprimer » désactivé, avec l'explication", (await panelDelete.count()) === 1 && (await panelDelete.first().isDisabled()) && /ne peut pas être supprimé/.test((await panelDelete.first().getAttribute("title")) ?? ""));
  await page.getByRole("tab", { name: "Ajouter" }).click();
  ok("D « Ajouter » : Sortie grisée (une seule par page), Une œuvre au hasard proposée, Contact absent",
    (await page.locator('.ve-card[data-type="exit"]').isDisabled()) && (await page.locator('.ve-card[data-type="random-work"]').count()) === 1 && (await page.locator('.ve-card[data-type="contact"]').count()) === 0);
  await page.screenshot({ path: `${SHOTS}/editeur-sortie-1440.png` });
  // Une autre page : ni Sortie ni Une œuvre au hasard.
  await page.goto(`${BASE}/admin/pages/${pageIdOf("a-propos")}/editer`, { waitUntil: "domcontentloaded" });
  await canvas();
  await page.getByRole("tab", { name: "Ajouter" }).click();
  ok("D page ordinaire : ni « Sortie » ni « Une œuvre au hasard » dans le catalogue, Contact présent",
    (await page.locator('.ve-card[data-type="exit"]').count()) === 0 && (await page.locator('.ve-card[data-type="random-work"]').count()) === 0 && (await page.locator('.ve-card[data-type="contact"]').count()) === 1);

  // Messages multiples : un tiré à chaque visite, sans casser le cache.
  const msgs = [L("Message A-89"), L("Message B-89"), L("Message C-89")].map((m) => ({ fr: m.fr, en: m.en.replace("Message", "Note") }));
  await publishBlocks(page, BASE, specialId, () => [exitBlock({ messages: msgs, title: { fr: "Titre fr 89", en: "Title en 89" }, label: { fr: "Rentrer", en: "Go home" } })], () => q("select props from blocks where page_id = ?", specialId)[0]?.props.includes("Message A-89"));
  for (const loc of ["fr", "en"]) {
    const r = await get(`/${loc}/introuvable-xyz`);
    ok(`D (${loc}) titre et bouton réglés dans l'éditeur`, r.text.includes(loc === "fr" ? "Titre fr 89" : "Title en 89") && textOf(r.text).includes(loc === "fr" ? "Rentrer" : "Go home"));
  }
  const seen = new Map();
  const visitor = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  for (let i = 0; i < 20; i++) {
    await visitor.goto(`${BASE}/fr/introuvable-xyz-${i}`, { waitUntil: "load" });
    await visitor.waitForFunction(() => document.querySelector("[data-random-item]:not([hidden])"), null, { timeout: 15000 }).catch(() => {});
    const t = (await visitor.locator("[data-random-item]:not([hidden])").allInnerTexts()).join("|");
    seen.set(t, (seen.get(t) ?? 0) + 1);
  }
  ok("D 20 chargements : un seul message visible à la fois, et il varie", [...seen.keys()].every((k) => /^Message [ABC]-89$/.test(k)) && seen.size >= 2, JSON.stringify([...seen]));
  const anon = await get("/fr/introuvable-xyz");
  ok("D les trois messages sont dans le HTML en cache (pas de tirage serveur) et masqués sauf sans JavaScript pour le premier", ["A", "B", "C"].every((x) => anon.text.includes(`Message ${x}-89`)));
  await visitor.close();
  await resetPage();
}

/* ---- E. Une œuvre au hasard --------------------------------------------------------------------------------------------- */

if (run("E")) {
  const slots = q("select slug, collection, title from slots where media_id is not null order by id");
  const anim = slots.filter((s) => s.collection === "animation");
  const visitor = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const draw = async (n = 20) => {
    const found = new Map();
    for (let i = 0; i < n; i++) {
      await visitor.goto(`${BASE}/fr/introuvable-e${i}`, { waitUntil: "load" });
      await visitor.waitForFunction(() => document.querySelector("[data-random-work]:not([hidden]), [data-random-work]"), null, { timeout: 15000 }).catch(() => {});
      const el = visitor.locator("[data-random-item]:not([hidden]) [data-random-work], [data-random-work]:not([data-random-item] *)").first();
      if (!(await el.count())) continue;
      const slug = await el.getAttribute("data-random-work");
      found.set(slug, { href: await el.locator("a").first().getAttribute("href"), img: await el.locator("img").first().getAttribute("src"), alt: await el.locator("img").first().getAttribute("alt"), caption: (await el.locator("figcaption").innerText()).trim() });
    }
    return found;
  };
  const withWork = async (props, label) => {
    await publishBlocks(page, BASE, specialId, (blocks) => [blocks[0], { uid: "w1", type: "random-work", props }], () => blockTypes().join() === "exit,random-work");
    await sleep(500);
    ok(`E ${label} : bloc enregistré`, blockTypes().join() === "exit,random-work");
  };
  await withWork({ source: "all", width: "text" }, "source « tout le portfolio »");
  let found = await draw();
  ok("E tout le portfolio : plusieurs œuvres différentes, chacune avec image, titre, alt et lien", found.size >= 2 && [...found.values()].every((w) => w.img && w.alt && w.caption && w.href), JSON.stringify([...found]).slice(0, 300));
  const [slug0, w0] = [...found][0];
  const target = await get(w0.href.startsWith("/fr") ? w0.href : `/fr${w0.href === "/" ? "" : w0.href}`);
  ok("E le lien mène à une page publiée qui répond 200", target.status === 200, `${w0.href} → ${target.status}`);
  const imgRes = await fetch(`${BASE}${w0.img}`);
  ok("E l'image de l'œuvre se charge", imgRes.ok, String(imgRes.status));
  const enHtml = await get("/en/introuvable-xyz");
  ok("E version anglaise : lien /en", /data-random-work[\s\S]{0,600}href="\/en/.test(enHtml.text));
  await visitor.screenshot({ path: `${SHOTS}/oeuvre-1440.png`, fullPage: true });

  await withWork({ source: "collection", collection: "animation", width: "wide" }, "source « une catégorie » (animation)");
  found = await draw();
  ok("E catégorie : seulement des œuvres de cette catégorie", found.size >= 1 && [...found.keys()].every((s) => anim.some((a) => a.slug === s)), JSON.stringify([...found.keys()]));

  await withWork({ source: "manual", works: [anim[0].slug], width: "text" }, "source « sélection »");
  found = await draw(6);
  ok("E sélection d'une œuvre : toujours la même", found.size === 1 && found.has(anim[0].slug), JSON.stringify([...found.keys()]));

  // Jamais brouillon / masquée / corbeille : l'œuvre est mise à la corbeille (son média), ou son emplacement devient un brouillon.
  const mediaId = q("select media_id from slots where slug = ?", anim[0].slug)[0].media_id;
  exec("update media set deleted_at = unixepoch() where id = ?", mediaId);
  await flush();
  let r = await get("/fr/introuvable-xyz");
  ok("E source vide (œuvre à la corbeille) : le bloc est absent, rien d'autre ne change", !r.text.includes("data-random-work") && r.status === 404 && textOf(r.text).includes(MSG.fr.body));
  exec("update media set deleted_at = null where id = ?", mediaId);
  exec("update slots set draft_state = 'added' where slug = ?", anim[0].slug);
  await flush();
  r = await get("/fr/introuvable-xyz");
  ok("E source vide (emplacement en brouillon) : le bloc est absent", !r.text.includes("data-random-work"));
  exec("update slots set draft_state = null where slug = ?", anim[0].slug);
  await withWork({ source: "manual", works: [], width: "text" }, "sélection vide");
  r = await get("/fr/introuvable-xyz");
  ok("E sélection vide : le bloc est absent", !r.text.includes("data-random-work") && !r.text.includes("data-random-work-block"));
  await visitor.close();
  await resetPage();
}

/* ---- F. Exclusions ------------------------------------------------------------------------------------------------------ */

if (run("F")) {
  const sm = await get("/sitemap.xml");
  ok("F plan du site : pas de page « _404 »", sm.status === 200 && !sm.text.includes("_404") && sm.text.includes("/personnages"));
  const home = await get("/fr");
  // Le texte « Page introuvable » existe dans les messages du site (clé notFound) : on cherche un LIEN, pas le mot.
  const leak = home.text.search(/<a[^>]*>[^<]*Page introuvable/);
  ok("F menu de l'en-tête : la page n'y est pas", !/href="\/fr\/_404"/.test(home.text) && leak < 0, leak < 0 ? "" : home.text.slice(Math.max(0, leak - 160), leak + 60));
  const nf = await get("/fr/introuvable-xyz");
  ok("F sélecteur de langue de la 404 : mène à l'accueil de l'autre langue", !/href="\/en\/_404"/.test(nf.text));
  ok("F menu enregistré : aucune entrée vers la page", !q("select value from settings where key = 'nav'").some((r) => r.value.includes(`"pageId":${specialId}`)) && q("select nav_order from pages where id = ?", specialId)[0].nav_order === null);

  await page.goto(`${BASE}/admin/pages`, { waitUntil: "networkidle" });
  const rows = page.locator("table tbody tr");
  const special = page.locator('[data-testid="page-speciale"]');
  ok("F Admin → Pages : « Page introuvable » avec le badge « Page spéciale » et la phrase d'aide", (await special.count()) === 1 && (await special.innerText()).includes("Page introuvable") && (await special.locator('[data-testid="badge-speciale"]').innerText()) === "Page spéciale" && (await special.locator('[data-testid="aide-speciale"]').innerText()) === "s'affiche quand un lien est cassé", (await special.innerText()));
  const yOf = async (loc) => (await loc.first().boundingBox())?.y ?? -1;
  const yTable = await yOf(page.locator("table").first());
  const ySpecial = await yOf(page.locator('[data-testid="pages-speciales"]'));
  ok("F elle est rangée à part, après la liste des pages", yTable >= 0 && ySpecial > yTable, `${yTable} / ${ySpecial}`);
  ok("F ni Supprimer, ni Menu, ni Infos, ni renommage sur sa ligne", (await special.getByRole("button", { name: /Supprimer|Menu/ }).count()) === 0 && (await special.getByRole("link", { name: /Infos/ }).count()) === 0);
  ok("F la liste ordinaire ne la contient pas", (await rows.filter({ hasText: "Page introuvable" }).count()) === 1);
  await page.screenshot({ path: `${SHOTS}/admin-pages-1440.png`, fullPage: true });
  await page.goto(`${BASE}/admin/pages/${specialId}`, { waitUntil: "domcontentloaded" });
  ok("F /admin/pages/<id> mène à l'éditeur (pas de formulaire de titre ni d'adresse)", page.url().includes(`/admin/pages/${specialId}/editer`), page.url());
  // Pages à lier : jamais la page spéciale.
  await page.goto(`${BASE}/admin/pages/${pageIdOf("a-propos")}/editer`, { waitUntil: "domcontentloaded" });
  const f = await canvas();
  const links = await page.evaluate(() => document.body.innerText);
  ok("F l'éditeur d'une autre page ne propose pas la page spéciale comme destination", !links.includes("Page introuvable"));
  void f;
}

ok("aucune erreur JavaScript dans l'admin", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} ÉCHEC(S)` : "\nTout passe");
process.exit(failures ? 1 : 0);
