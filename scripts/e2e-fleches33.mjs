#!/usr/bin/env node
/**
 * Lot 33 (v0.23) : flèches de défilement en mode modification + « Ce texte uniquement » sur tous les titres et textes.
 * UN chromium sobre, base NEUVE (seed), une connexion, page d'accueil (id 1) remplacée par un brouillon de test.
 *
 *  A. Flèches ← → d'une planche, sur la toile : un clic fait défiler comme en ligne, sans sélectionner la planche ni
 *     ouvrir de barre d'outils ; un clic ailleurs dans la planche la sélectionne toujours ; clavier (Entrée sur la flèche
 *     focalisée) ; la barre de défilement répond au pointeur. Le clic sur une image ne ouvre pas la visionneuse.
 *  B. Pour chaque champ texte de la liste FIELDS : la barre du texte propose « Ce texte » ; choisir une police change CE
 *     texte seulement (les autres, du même rôle ou non, gardent la leur), la clé est écrite dans `look.text` du bloc, le
 *     style global du rôle n'est pas touché ; « Revenir au style global » enlève la clé.
 *  C. Publication : chaque style local est rendu à l'identique dans le site en ligne (anonyme).
 *
 * Usage : BASE=http://localhost:3430 DATA_DIR=~/pf/data-33 ADMIN_EMAIL=… ADMIN_PASSWORD=… SHOTS=/dossier [ONLY=A,B,C] node scripts/e2e-fleches33.mjs
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const DB = path.join(process.env.DATA_DIR ?? "data", "portfolio.db");
const SHOTS = process.env.SHOTS ?? "screenshots/fleches33";
const ONLY = process.env.ONLY ?? "";
const run = (k) => !ONLY || ONLY.split(",").includes(k);
mkdirSync(SHOTS, { recursive: true });

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
const exec = (sql, ...args) => {
  const db = new Database(DB);
  try {
    return db.prepare(sql).run(...args);
  } finally {
    db.close();
  }
};
const draftOf = (id) => JSON.parse(q("select draft from pages where id = ?", id)[0]?.draft ?? "null");
const setting = (key) => JSON.parse(q("select value from settings where key = ?", key)[0]?.value ?? "null");
const localText = (uid, key) => draftOf(1)?.blocks?.find((b) => b.uid === uid)?.props?.look?.text?.[key];
async function waitFor(fn, timeout = 60000) {
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(300)) if (await fn()) return true;
  return false;
}
const until = (f, fn, arg, timeout = 60000) => f.waitForFunction(fn, arg, { timeout, polling: 200 }).then(() => true, () => false);

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
page.setDefaultNavigationTimeout(180000);
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
  await sleep(500);
}
async function publish() {
  await settled();
  await page.getByRole("button", { name: "Publier", exact: true }).click();
  return waitFor(async () => /Publié/.test((await page.locator(".ve-status").textContent()) ?? ""), 120000);
}
/** Ouvre la barre typographique d'un texte (« Aa » au survol). */
async function openBar(f, sel, nth = 0) {
  if (await f.locator(".lk-bar").count()) {
    await f.locator(".lk-bar .lk-close").click().catch(() => {});
    await f.locator(".lk-bar").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  }
  const target = f.locator(sel).nth(nth);
  await target.scrollIntoViewIfNeeded();
  for (let essai = 0; essai < 4; essai++) {
    await page.mouse.move(700, 8);
    await sleep(150);
    await target.hover();
    if (!(await until(f, () => Boolean(document.querySelector(".lk-aa")), null, 8000))) continue;
    try {
      await f.locator(".lk-aa").click({ timeout: 4000 });
      if (await until(f, () => Boolean(document.querySelector(".lk-bar")), null, 8000)) return true;
    } catch {
      /* le « Aa » suit le survol : on recommence */
    }
  }
  return false;
}
const scopeButton = (f, name) => f.locator(".lk-bar [role=radio]", { hasText: name }).first();
/** Première famille d'une valeur font-family calculée, sans guillemets. */
const firstFamily = (v) => (v ?? "").split(",")[0].trim().replace(/^["']|["']$/g, "");
const familyOf = (fr, sel) => fr.locator(sel).first().evaluate((el) => getComputedStyle(el).fontFamily).catch(() => null);

/* ---- Page de test ------------------------------------------------------------------------------------------------ */

const projectRow = (slug) => q("select title, description, context, year from projects where slug = ?", slug)[0];
const fr = (json) => JSON.parse(json).fr;
const BOARD = projectRow("les-hauts-chemins");
const LINKED = projectRow("la-petite-fabrique");
const L = (t) => ({ fr: t, en: t });
const otherPage = q("select id from pages where id <> 1 limit 1")[0].id;
const videoSlot = q("select slug from slots where collection = 'animation' limit 1")[0]?.slug;

const BLOCKS = [
  { uid: "t1", type: "section-title", props: { eyebrow: L("Etiq A"), title: L("Titre A"), intro: L("Intro A"), counts: true } },
  { uid: "t2", type: "section-title", props: { linked: true, project: "la-petite-fabrique" } },
  { uid: "bd", type: "project-board", props: { project: "les-hauts-chemins" } },
  { uid: "rt", type: "rich-text", props: { eyebrow: L("Etiq B"), title: L("Titre B"), paragraphs: [L("Paragraphe B")] } },
  { uid: "ci", type: "collection-intro", props: { collection: "characters", eyebrow: L("Etiq C"), title: L("Titre C"), intro: L("Intro C"), showCounts: false } },
  { uid: "ct", type: "collection-tiles", props: { mode: "auto", eyebrow: L("Etiq D"), title: L("Titre D") } },
  { uid: "co", type: "contact", props: { eyebrow: L("Etiq E"), title: L("Titre E"), intro: L("Intro E"), cta: L("Bouton E") } },
  { uid: "pr", type: "profile", props: { eyebrow: L("Etiq F"), paragraphs: [L("Presentation F")], contactEyebrow: L("Etiq G"), contactLabel: L("Bouton G"), socialEyebrow: L("Etiq H") } },
  { uid: "pl", type: "page-link", props: { label: L("Lien I"), pageId: otherPage } },
  ...(videoSlot ? [{ uid: "vs", type: "video-single", props: { slot: videoSlot, variant: "feature", mode: "player", eyebrow: L("Etiq V"), title: L("Titre V"), description: L("Desc V") } }] : []),
];

/**
 * Champs : bloc, clé de `look.text`, sélecteur valable sur la toile ET en ligne, libellé, rôle global attendu.
 * `what` : « avant » = déjà possible en v0.22 (inline()), « nouveau » = ajouté par ce lot.
 */
const FIELDS = [
  ["t1", "eyebrow", 'p.eyebrow:text-is("Etiq A")', "Titre (section) · étiquette", "avant"],
  ["t1", "title", 'h2:text-is("Titre A")', "Titre (section) · titre", "avant"],
  ["t1", "intro", 'p:text-is("Intro A")', "Titre (section) · présentation", "avant"],
  ["t1", "counts", 'p.eyebrow:text-matches("œuvres? · \\\\d+ projets?")', "Titre (section) · compteurs", "nouveau"],
  ["t2", "title", `h2:text-is(${JSON.stringify(fr(LINKED.title))})`, "Titre lié · nom du projet", "avant"],
  ["t2", "intro", `p:text-is(${JSON.stringify(fr(LINKED.description))})`, "Titre lié · présentation", "avant"],
  ["bd", "title", `section.strip h2:text-is(${JSON.stringify(fr(BOARD.title))})`, "Planche · nom du projet", "nouveau"],
  ["bd", "context", `section.strip span:text-is(${JSON.stringify(fr(BOARD.context))})`, "Planche · contexte", "nouveau"],
  ["bd", "year", `section.strip span:text-is(${JSON.stringify(BOARD.year)})`, "Planche · année", "nouveau"],
  ["bd", "description", `section.strip p:text-is(${JSON.stringify(fr(BOARD.description))})`, "Planche · présentation", "nouveau"],
  ["rt", "eyebrow", 'p.eyebrow:text-is("Etiq B")', "Texte · étiquette", "avant"],
  ["rt", "title", 'h2:text-is("Titre B")', "Texte · titre", "avant"],
  ["rt", "paragraphs.0", 'p:text-is("Paragraphe B")', "Texte · paragraphe", "avant"],
  ["ci", "eyebrow", 'p.eyebrow:text-is("Etiq C")', "En-tête de collection · étiquette", "avant"],
  ["ci", "title", 'h1:text-is("Titre C")', "En-tête de collection · titre", "avant"],
  ["ci", "intro", 'p:text-is("Intro C")', "En-tête de collection · présentation", "avant"],
  ["ct", "eyebrow", 'p.eyebrow:text-is("Etiq D")', "Entrées de collections · étiquette", "avant"],
  ["ct", "title", 'h2:text-is("Titre D")', "Entrées de collections · titre", "avant"],
  ["ct", "tileEyebrow", ".tile-txt > p.eyebrow:first-child", "Entrées · étiquette d'une entrée", "nouveau"],
  ["ct", "tileTitle", ".tile-txt > h3", "Entrées · titre d'une entrée", "nouveau"],
  ["ct", "tileIntro", ".tile-txt > p.text-sm", "Entrées · texte d'une entrée", "nouveau"],
  ["ct", "tileCta", ".tile-txt > p.eyebrow.mt-6", "Entrées · « Voir »", "nouveau"],
  ["ct", "tileCount", ".tile-txt > p.eyebrow.mt-2", "Entrées · nombre d'œuvres", "nouveau"],
  ["co", "eyebrow", 'p.eyebrow:text-is("Etiq E")', "Contact · étiquette", "avant"],
  ["co", "title", 'h2:text-is("Titre E")', "Contact · titre", "avant"],
  ["co", "intro", 'p:text-is("Intro E")', "Contact · présentation", "avant"],
  ["co", "cta", 'a.btn span:text-is("Bouton E")', "Contact · bouton (rendu en ligne corrigé)", "nouveau"],
  ["pr", "eyebrow", 'p.eyebrow:text-is("Etiq F")', "Profil · étiquette", "avant"],
  ["pr", "paragraphs.0", 'p:text-is("Presentation F")', "Profil · présentation", "avant"],
  ["pr", "contactEyebrow", 'p.eyebrow:text-is("Etiq G")', "Profil · étiquette contact", "avant"],
  ["pr", "contactLabel", 'a.btn span:text-is("Bouton G")', "Profil · bouton (rendu en ligne corrigé)", "nouveau"],
  ["pr", "socialEyebrow", 'p.eyebrow:text-is("Etiq H")', "Profil · étiquette réseaux", "avant"],
  ["pl", "label", 'a span:text-is("Lien I")', "Lien vers une page · texte (rendu en ligne corrigé)", "nouveau"],
  ...(videoSlot
    ? [
        ["vs", "eyebrow", 'p.eyebrow:text-is("Etiq V")', "Vidéo · étiquette", "nouveau"],
        ["vs", "title", 'h2:text-is("Titre V")', "Vidéo · titre", "nouveau"],
        ["vs", "description", 'p:text-is("Desc V")', "Vidéo · légende", "avant"],
      ]
    : []),
].map(([uid, key, sel, label, what]) => ({ uid, key, sel, label, what }));

let f;
// Brouillon de test sur l'accueil (écrit comme les autres suites : même effet que des modifications faites sur la toile).
const row = q("select title, slug, meta, nav_order from pages where id = 1")[0];
const draft = {
  title: JSON.parse(row.title),
  slug: JSON.parse(row.slug),
  meta: row.meta ? JSON.parse(row.meta) : { title: L(""), description: L("") },
  published: true,
  inMenu: row.nav_order !== null,
  accent: null,
  blocks: BLOCKS,
};
exec("update pages set draft = ?, draft_updated_at = unixepoch(), draft_rev = draft_rev + 1 where id = 1", JSON.stringify(draft));
await page.goto(`${BASE}/admin/pages/1/editer`, { waitUntil: "domcontentloaded" });
f = await canvas();
await sleep(2500);
ok("page de test : tous les blocs sont sur la toile", (await f.locator("[data-edit-block]").count()) >= BLOCKS.length, String(await f.locator("[data-edit-block]").count()));

/* ---- A. Flèches ---------------------------------------------------------------------------------------------------- */

if (run("A")) {
  const rail = f.locator('[data-edit-block="bd"] .strip-rail');
  await rail.scrollIntoViewIfNeeded();
  const next = f.locator('[data-edit-block="bd"] .strip-nav-next');
  const prev = f.locator('[data-edit-block="bd"] .strip-nav-prev');
  ok("A0 la planche déborde : flèches présentes", (await next.count()) === 1 && (await prev.count()) === 1);
  const left = () => rail.evaluate((el) => Math.round(el.scrollLeft));
  const selected = () => f.locator(".pe-box.pe-selected").count();
  const tools = () => f.locator(".pe-tools").count();
  await page.keyboard.press("Escape");
  const before = await left();
  const sel0 = await selected();
  await next.click();
  ok("A1 clic sur → : la bande avance d'une image", await until(f, ([r, l]) => Math.round(document.querySelector(r).scrollLeft) > l + 40, ['[data-edit-block="bd"] .strip-rail', before]), `scrollLeft ${await left()}`);
  await sleep(700);
  ok("A2 le clic sur la flèche ne sélectionne pas la planche et n'ouvre pas de barre d'outils", (await selected()) === sel0 && (await tools()) === 0, `sélections ${await selected()}, barres ${await tools()}`);
  ok("A3 aucun texte n'est passé en modification", (await f.locator("[data-editing]").count()) === 0);
  ok("A3b la visionneuse n'est pas ouverte", (await f.locator(".lightbox").count()) === 0);
  const mid = await left();
  await prev.click();
  ok("A4 clic sur ← : la bande recule", await until(f, ([r, l]) => Math.round(document.querySelector(r).scrollLeft) < l - 40, ['[data-edit-block="bd"] .strip-rail', mid]), `scrollLeft ${await left()}`);
  await sleep(700);
  // Clavier : focus sur la flèche, Entrée.
  const k0 = await left();
  await next.focus();
  await page.keyboard.press("Enter");
  ok("A5 clavier : Entrée sur → fait avancer la bande (sans modifier le texte du bloc)", (await until(f, ([r, l]) => Math.round(document.querySelector(r).scrollLeft) > l + 40, ['[data-edit-block="bd"] .strip-rail', k0])) && (await f.locator("[data-editing]").count()) === 0);
  await sleep(700);
  await page.screenshot({ path: path.join(SHOTS, "A-fleches-apres.png") });
  // Clic ailleurs dans la planche : elle se sélectionne toujours.
  await f.locator('[data-edit-block="bd"] .strip-count').click();
  ok("A6 un clic ailleurs dans la planche la sélectionne", await until(f, () => document.querySelectorAll(".pe-box.pe-selected").length > 0, null, 10000));
  await page.keyboard.press("Escape");
  // Clic sur une image : sélection de l'image, pas de visionneuse.
  const slot = f.locator('[data-edit-block="bd"] [data-edit-slot]').nth(1);
  await slot.scrollIntoViewIfNeeded();
  await slot.click();
  await sleep(500);
  ok("A7 clic sur une image : pas de visionneuse (le clic sert à sélectionner)", (await f.locator(".lightbox").count()) === 0);
  // Barre de défilement : un clic sur la piste déplace la bande.
  const bar = f.locator('[data-edit-block="bd"] .rail-bar-track');
  const b0 = await left();
  const box = await bar.boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2);
    ok("A8 la barre de défilement répond au clic sur la toile", await until(f, ([r, l]) => Math.abs(document.querySelector(r).scrollLeft - l) > 40, ['[data-edit-block="bd"] .strip-rail', b0]));
  } else ok("A8 barre de défilement présente", false);
}

/* ---- B. Ce texte uniquement, champ par champ ---------------------------------------------------------------------- */

const expected = new Map(); // champ -> première famille attendue
let globalRoles0;
if (run("B") || run("C")) {
  globalRoles0 = JSON.stringify(setting("siteDraft")?.snap?.styles?.roles ?? {});
  for (const fl of FIELDS) expected.set(fl, firstFamily(await familyOf(f, fl.sel)));
  // Tous les champs doivent exister sur la toile.
  for (const fl of FIELDS) ok(`B0 présent sur la toile : ${fl.label}`, (await f.locator(fl.sel).count()) > 0);
  for (const [i, fl] of FIELDS.entries()) {
    const opened = await openBar(f, fl.sel);
    ok(`B1 ${fl.label} : barre ouverte`, opened);
    if (!opened) continue;
    const hasLocal = (await scopeButton(f, "Ce texte").count()) > 0;
    const hasRole = (await f.locator(".lk-bar [role=radio]", { hasText: "Tous les" }).count()) > 0;
    ok(`B2 ${fl.label} : onglets « Ce texte » et « Tous les … »`, hasLocal && hasRole);
    if (!hasLocal) continue;
    await scopeButton(f, "Ce texte").click();
    await f.locator(".lk-bar .tc-font").click();
    await f.locator(".fm-item[data-font^='embed:']").first().waitFor();
    // Une police embarquée différente de celle du texte.
    const current = expected.get(fl);
    const choices = await f.locator(".fm-item[data-font^='embed:']").evaluateAll((els) => els.map((e) => ({ ref: e.getAttribute("data-font"), family: e.querySelector(".fm-name")?.style.fontFamily ?? "" })));
    const pick = choices.find((c) => firstFamily(c.family) && firstFamily(c.family) !== current) ?? choices[i % choices.length];
    await f.locator(`.fm-item[data-font="${pick.ref}"]`).click();
    await settled();
    const saved = await waitFor(() => localText(fl.uid, fl.key)?.font === pick.ref, 30000);
    ok(`B3 ${fl.label} : police enregistrée dans look.text["${fl.key}"] du bloc`, saved, JSON.stringify(localText(fl.uid, fl.key)));
    expected.set(fl, firstFamily(pick.family));
    const now = firstFamily(await familyOf(f, fl.sel));
    ok(`B4 ${fl.label} : police appliquée sur la toile`, now === expected.get(fl), `${now} ≠ ${expected.get(fl)}`);
    // Les autres champs n'ont pas bougé (ceux déjà réglés gardent le leur).
    const moved = [];
    for (const other of FIELDS) {
      if (other === fl) continue;
      const fam = firstFamily(await familyOf(f, other.sel));
      if (fam !== expected.get(other)) moved.push(`${other.label} (${fam} ≠ ${expected.get(other)})`);
    }
    ok(`B5 ${fl.label} : aucun autre texte n'a changé`, moved.length === 0, moved.slice(0, 3).join(" ; "));
    await f.locator(".lk-bar .lk-close").click().catch(() => {});
  }
  ok("B6 le style global des rôles n'a pas été modifié", JSON.stringify(setting("siteDraft")?.snap?.styles?.roles ?? {}) === globalRoles0);
  await page.screenshot({ path: path.join(SHOTS, "B-textes-regles.png") });
  const board = FIELDS.find((x) => x.uid === "bd" && x.key === "title");
  await f.locator(board.sel).first().scrollIntoViewIfNeeded();
  await f.locator('[data-edit-block="bd"]').first().screenshot({ path: path.join(SHOTS, "B-planche-police.png") }).catch(() => {});
  // « Revenir au style global » sur deux champs (planche, entrée de collection).
  for (const key of [FIELDS.find((x) => x.uid === "bd" && x.key === "description"), FIELDS.find((x) => x.uid === "ct" && x.key === "tileTitle")]) {
    const before = firstFamily(await familyOf(f, key.sel));
    await openBar(f, key.sel);
    await scopeButton(f, "Ce texte").click();
    await f.locator(".lk-bar .tc-reset").click();
    await settled();
    ok(`B7 ${key.label} : « Revenir au style global » retire la clé`, await waitFor(() => localText(key.uid, key.key) === undefined, 30000), JSON.stringify(localText(key.uid, key.key)));
    const after = firstFamily(await familyOf(f, key.sel));
    ok(`B8 ${key.label} : la police du style global revient sur la toile`, after !== before, `${after}`);
    expected.set(key, after);
    await f.locator(".lk-bar .lk-close").click().catch(() => {});
  }
}

/* ---- C. Rendu en ligne ----------------------------------------------------------------------------------------------- */

if (run("C")) {
  ok("C0 publication", await publish());
  const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pub = await anon.newPage();
  pub.setDefaultTimeout(60000);
  await pub.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  ok("C1 aucun repère d'édition en ligne", (await pub.locator("[data-inline], [data-look-key], [data-edit-native]").count()) === 0);
  for (const fl of FIELDS) {
    const fam = firstFamily(await pub.locator(fl.sel).first().evaluate((el) => getComputedStyle(el).fontFamily).catch(() => null));
    ok(`C2 ${fl.label} : même police qu'en modification`, fam === expected.get(fl), `${fam} ≠ ${expected.get(fl)}`);
  }
  await pub.screenshot({ path: path.join(SHOTS, "C-public.png"), fullPage: false });
  await anon.close();
}

ok("aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
if (failures) {
  console.error(`e2e-fleches33 : ÉCHEC (${failures})`);
  process.exit(1);
}
console.log("e2e-fleches33 : OK");
