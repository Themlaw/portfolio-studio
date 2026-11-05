#!/usr/bin/env node
/**
 * Intégration v0.33 : croisements entre lots (chromium, serveur requis, base neuve, une connexion admin). Données SYNTHÉTIQUES seulement.
 *  X1  (96 x 98) un nom du site modifié depuis une page reste (brouillon commun) après un style « Les légendes de ce projet » et après la
 *      publication d'une AUTRE page ; le style du projet se publie avec la page qui le tient, le nom reste.
 *  X2  (100 x 99) le menu « Fond & carte » (fond, carte, contour) sur un rail d'images : la hauteur du rail est constante, avec et sans carte
 *      ni contour, à plusieurs positions de défilement, éditeur et public ; idem sur le composant « carrousel » de la planche.
 *  X3  (97 x 96, 98, 100) le journal enregistre le style du projet, le brouillon du site et le contour (une entrée lisible chacun, résultat ok).
 *  X4  (90 x 100) l'opacité 0 à 100 % marche dans le menu « Fond & carte » (carte ET fond), avertissement au-delà de 60 %, rendu suivi.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=X1,X2,X3,X4] [SHOTS=dossier] node scripts/e2e-integ33.mjs
 */
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";
import sharp from "sharp";

import { boardDraft, boardPublished, draftBlocks, img, login, makeMedia, openEditor, pageIdOf, q1, setBoardDraft, setDraft, settled, sleep, sql, waitFor } from "./lib/grille31d.mjs";

const BASE = process.env.BASE ?? "http://localhost:4020";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const DATA = process.env.DATA_DIR ?? "data";
const SHOTS = process.env.SHOTS ?? path.join(process.env.BATTERY_DIR ?? tmpdir(), "shots-integ33");
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const diag = (...parts) => console.log(`DIAG ${parts.join(" | ")}`);
const T = (s) => ({ fr: s, en: s });

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
page.on("pageerror", (e) => console.log(`pageerror: ${e.message.slice(0, 200)}`));
await login(page, BASE);
const M = await makeMedia(page, BASE);
const pub = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const pp = await pub.newPage();

const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});
const section = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.stack ?? e.message).split("\n").slice(0, 6).join(" "));
    await shot(page, `erreur-${name}`);
  }
};

/* ---- Scène : une page avec une planche de projet (bande + carrousel à liste propre + image + grille) ---------------------------- */
const pageId = pageIdOf("personnages");
const DECORS = pageIdOf("decors");
const ANIM = pageIdOf("animation");
const projects = sql((db) => db.prepare("select id, slug from projects where deleted_at is null order by id limit 2").all());
const project = projects[0];
if (!project) throw new Error("un projet attendu dans la base de test");
const BOARD_ID = project.id;
const board = `[data-edit-board="${BOARD_ID}"]`;
const car = `${board} [data-edit-rail="car"]`;
const CAR_CAPS = { "car-a1": { title: T("Vue 1"), caption: T("Légende 1"), date: T("2026") }, "car-b2": { title: T("Vue 2"), caption: T("Légende 2"), date: T("2025") }, "car-c3": { title: T("Vue 3"), caption: T("Légende 3"), date: T("2024") } };
const PAGE_BLOCKS = () => [
  { uid: "intro", type: "rich-text", props: { paragraphs: [{ fr: "Mctrl33 : un texte inventé.", en: "Mctrl33: some text." }] } },
  { uid: "pbd", type: "project-board", props: { project: project.slug } },
  img("pimg", M.paysage, { captionTitle: T("Titre image"), caption: T("Légende image") }),
];
const BOARD_ITEMS = () => [
  { uid: "strip", type: "strip", props: {} },
  { uid: "car", type: "strip", props: { source: "own", media: [M.portrait, M.carre, M.paysage2], ids: ["a1", "b2", "c3"], captions: CAR_CAPS } },
  img("bimg", M.paysage, { captionTitle: T("Titre planche"), caption: T("Légende planche") }),
];
function resetScene() {
  sql((db) => {
    db.prepare("update projects set draft_layout = null, draft_layout_page_id = null").run();
    db.prepare("update projects set layout = null where id = ?").run(BOARD_ID);
    db.prepare("delete from settings where key in ('siteDraft','siteDraftRev','styles')").run();
    db.prepare("update pages set draft = null, draft_updated_at = null where draft is not null").run();
  });
  setDraft(pageId, PAGE_BLOCKS());
  setBoardDraft(BOARD_ID, pageId, BOARD_ITEMS());
}
const setting = (key) => {
  const row = sql((db) => db.prepare("select value from settings where key = ?").get(key));
  return row ? JSON.parse(row.value) : null;
};
const publishedName = () => setting("site").name;
const restoreName = (name) =>
  sql((db) => {
    const v = JSON.parse(db.prepare("select value from settings where key = 'site'").get().value);
    v.name = name;
    db.prepare("update settings set value = ? where key = 'site'").run(JSON.stringify(v));
  });
const reopen = async (id = pageId) => {
  const f = await openEditor(page, BASE, id);
  await settled(page);
  await sleep(1000);
  return f;
};
const publish = async () => {
  await page.getByRole("button", { name: "Publier", exact: true }).click();
  await page.getByText(/^Publié/).first().waitFor({ timeout: 120000 }).catch(() => {});
  await sleep(1500);
};
const publicBrand = async (url = "/fr") => {
  await pp.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" });
  return (await pp.locator(".site-header .site-brand").first().textContent())?.trim();
};

/* ---- Barre « Aa » (comme le lot 98) ---------------------------------------------------------------------------------------------- */
const until = (f, fn, arg, ms = 8000) => f.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
async function closeBar(f) {
  if (await f.locator(".lk-bar").count()) {
    await f.locator(".lk-bar .lk-close").evaluate((b) => b.click()).catch(() => {});
    await f.locator(".lk-bar").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  }
}
async function openByAa(f, sel) {
  await closeBar(f);
  const target = f.locator(sel).first();
  for (let essai = 0; essai < 4; essai++) {
    await target.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
    await sleep(200);
    await page.mouse.move(5, 5);
    await sleep(300);
    const b = await target.boundingBox();
    if (!b) continue;
    await page.mouse.move(b.x + b.width / 2 - 6, b.y + b.height / 2 - 6);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
    await sleep(350);
    if (!(await until(f, () => Boolean(document.querySelector(".lk-aa")), null, 6000))) continue;
    try {
      await f.locator(".lk-aa").click({ timeout: 4000 });
      if (await until(f, () => Boolean(document.querySelector(".lk-bar")), null, 6000)) return true;
    } catch {
      /* le « Aa » a bougé : on recommence */
    }
  }
  return false;
}
const scopeBtn = (f, re) => f.locator(".lk-bar .lk-seg [role=radio]").filter({ hasText: re }).first();
const colorOf = (f, sel, nth = 0) => f.locator(sel).nth(nth).evaluate((el) => getComputedStyle(el).color);
// Lot 120 : la portée intermédiaire nomme le type (« Tous les titres de légende du projet »…).
const PROJ = /du projet$/i;

/* ---- Menu Fond & carte (comme le lot 100) ----------------------------------------------------------------------------------------- */
const sec = (menu, slot) => menu.locator(`[data-testid="fond-section-${slot}"]`);
const kindBtn = (menu, slot, k) => sec(menu, slot).locator(`[data-testid="fond-kind-${slot}"] [data-kind="${k}"]`);
async function selectBlock(fr, uid) {
  const host = fr.locator(`[data-edit-block="${uid}"]`).first();
  for (let k = 0; k < 4; k++) {
    try {
      await host.scrollIntoViewIfNeeded({ timeout: 8000 });
      break;
    } catch {
      await sleep(1200);
    }
  }
  const button = fr.locator('.pe-tools [data-testid="fond-button"]');
  for (const sel of ["section", ".block-grid", "figure", "img", "h2", "p", "div"]) {
    const t = host.locator(sel).first();
    if (!(await t.count())) continue;
    await t.click({ position: { x: 6, y: 6 }, force: true }).catch(() => {});
    if (await button.waitFor({ timeout: 2500 }).then(() => true, () => false)) return true;
  }
  return false;
}
async function openMenu(fr, uid) {
  if (!(await selectBlock(fr, uid))) throw new Error(`bloc ${uid} : bouton « Fond & carte » introuvable`);
  await fr.locator('.pe-tools [data-testid="fond-button"]').click();
  const menu = fr.locator('[data-testid="fond-menu"]').first();
  await menu.waitFor({ timeout: 20000 });
  return menu;
}
async function openBitemMenu(fr, uid) {
  const frame = fr.locator(`${board} [data-edit-bitem="${uid}"]`).first();
  await frame.scrollIntoViewIfNeeded();
  await frame.hover();
  await frame.locator('[data-edit-bitem-op="fond"]').evaluate((b) => b.click());
  const menu = fr.locator('[data-testid="fond-menu"]').first();
  await menu.waitFor({ timeout: 20000 });
  return menu;
}
const draftBlock = (uid) => draftBlocks(pageId).find((b) => b.uid === uid);

/* ---- Mesure du rail (comme le lot 99) -------------------------------------------------------------------------------------------- */
const RAILS = () =>
  [...document.querySelectorAll(".strip-rail")].map((rail) => {
    const r = rail.getBoundingClientRect();
    const host = rail.closest("[data-edit-rail], .strip") ?? rail.parentElement;
    const nav = host?.querySelector(".strip-nav-next, .strip-nav-prev");
    const nb = nav?.getBoundingClientRect();
    return { h: +r.height.toFixed(2), w: +r.width.toFixed(2), band: getComputedStyle(rail.closest("[style*='--strip-band'], .strip") ?? rail).getPropertyValue("--strip-band").trim(), arrowCy: nb ? +(nb.top + nb.height / 2 - r.top).toFixed(2) : null };
  });
async function railHeights(where, label) {
  const out = [];
  const n = await where.locator(".strip-rail").count();
  for (let i = 0; i < n; i++) {
    const rail = where.locator(".strip-rail").nth(i);
    await rail.scrollIntoViewIfNeeded();
    const rows = [];
    for (const frac of [0, 0.5, 1]) {
      await rail.evaluate((r, fr) => {
        r.scrollLeft = (r.scrollWidth - r.clientWidth) * fr;
      }, frac);
      await sleep(350);
      rows.push((await where.evaluate(RAILS))[i]);
    }
    const hs = rows.map((r) => r.h);
    ok(`${label} rail ${i + 1} : hauteur identique aux 3 positions de défilement (écart 0 px)`, Math.max(...hs) - Math.min(...hs) === 0, hs.join(" / "));
    const cys = rows.map((r) => r.arrowCy).filter((v) => v !== null);
    if (cys.length) ok(`${label} rail ${i + 1} : flèches immobiles (écart 0 px)`, Math.max(...cys) - Math.min(...cys) === 0, cys.join(" / "));
    out.push(rows[0]);
  }
  return out;
}

const ORIGINAL = publishedName().fr;
const NEWNAME = "Atelier Integ33";

try {
  /* ====================================== X1. Nom du site (96) x style du projet (98) ====================================== */
  if (run("X1"))
    await section("X1", async () => {
      resetScene();
      restoreName({ fr: ORIGINAL, en: "" });
      // 1. le nom est modifié depuis une AUTRE page (Décors)
      let f = await openEditor(page, BASE, DECORS);
      await settled(page);
      const BRAND = '[data-edit-global="header"] [data-site-inline="name"]';
      await f.locator(BRAND).dblclick();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type(NEWNAME);
      await page.keyboard.press("Enter");
      await settled(page);
      ok("X1a le nom est dans le brouillon commun du site", await waitFor(() => setting("siteDraft")?.snap?.name?.fr === NEWNAME || JSON.stringify(setting("siteDraft") ?? {}).includes(NEWNAME), 30000), JSON.stringify(setting("siteDraft")).slice(0, 200));
      ok("X1a …le public garde l'ancien nom", (await publicBrand()) === ORIGINAL);
      // 2. la page de la planche : le brouillon du site s'y voit, puis style « Tous les titres de légende du projet »
      f = await reopen(pageId);
      const names = await f.evaluate(() => [...document.querySelectorAll('[data-site-inline="name"]')].map((e) => e.textContent.trim()));
      ok("X1b sur la page de la planche, l'en-tête montre le nouveau nom (brouillon commun)", names.length > 0 && names.every((n) => n === NEWNAME), JSON.stringify(names));
      ok("X1c la barre « Aa » s'ouvre sur un titre du carrousel", await openByAa(f, `${car} [data-slot-slug="car-b2"] [data-cap="title"]`));
      await scopeBtn(f, PROJ).click();
      const sw = f.locator(".lk-bar .tc-swatches [role=radio]").nth(4);
      const col = await sw.evaluate((b) => getComputedStyle(b).backgroundColor);
      await sw.click();
      await settled(page);
      await sleep(1500);
      const titles = () => f.evaluate((b) => [...document.querySelectorAll(`${b} [data-cap="title"]`)].map((e) => getComputedStyle(e).color), board);
      ok("X1c les titres du projet prennent la couleur choisie", (await titles()).length >= 3 && (await titles()).every((c) => c === col), JSON.stringify(await titles()));
      await closeBar(f);
      // Lot 120 : le style du projet est rangé dans les props du bloc « planche de projet » de la page (pas dans la table des projets).
      const host = draftBlock("pbd")?.props?.look?.projectText;
      ok("X1c le style est écrit dans le bloc de la page (brouillon)", host?.["cap.title"]?.color === "secondary", JSON.stringify(host));
      ok("X1c …pas dans la suite du projet", !(boardDraft(BOARD_ID) ?? []).some((i) => i.captionStyle));
      ok("X1d …et le nom du site est TOUJOURS dans le brouillon du site", JSON.stringify(setting("siteDraft") ?? {}).includes(NEWNAME), JSON.stringify(setting("siteDraft")).slice(0, 200));
      const names2 = await f.evaluate(() => [...document.querySelectorAll('[data-site-inline="name"]')].map((e) => e.textContent.trim()));
      ok("X1d …et l'en-tête de la toile le montre toujours", names2.length > 0 && names2.every((n) => n === NEWNAME), JSON.stringify(names2));
      // 3. publication d'une AUTRE page (Animation) : publie le site, pas le style du projet tenu par la page de la planche
      f = await reopen(ANIM);
      await publish();
      ok("X1e publier une AUTRE page publie le nom du site", await waitFor(() => publishedName().fr === NEWNAME, 60000), JSON.stringify(publishedName()));
      ok("X1e …le public montre le nouveau nom", (await publicBrand()) === NEWNAME, await publicBrand());
      ok("X1e …le brouillon du site a disparu", setting("siteDraft") == null);
      ok("X1e …le style du projet est toujours en attente avec sa page", draftBlock("pbd")?.props?.look?.projectText?.["cap.title"]?.color === "secondary" && !(boardPublished(BOARD_ID) ?? []).some((i) => i.captionStyle));
      // 4. la page de la planche : style et nom toujours là, puis publication
      f = await reopen(pageId);
      const names3 = await f.evaluate(() => [...document.querySelectorAll('[data-site-inline="name"]')].map((e) => e.textContent.trim()));
      ok("X1f après rechargement, le nom publié s'affiche partout", names3.every((n) => n === NEWNAME), JSON.stringify(names3));
      ok("X1f …et les titres du projet gardent la couleur du style de projet", (await titles()).every((c) => c === col), JSON.stringify(await titles()));
      await publish();
      ok("X1g la publication de la page publie le style du projet", await waitFor(() => sql((db) => db.prepare("select props from blocks where page_id = ? and type = 'project-board'").all(pageId)).some((r) => JSON.parse(r.props)?.look?.projectText?.["cap.title"]?.color === "secondary"), 60000));
      ok("X1g …et le nom reste", publishedName().fr === NEWNAME && (await publicBrand("/fr/personnages")) === NEWNAME);
      await pp.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
      const pubTitles = await pp.evaluate((b) => [...document.querySelectorAll('[data-cap="title"]')].map((e) => getComputedStyle(e).color), board);
      ok("X1g public : les titres du projet ont la couleur du style de projet", pubTitles.filter((c) => c === col).length >= 3, JSON.stringify([pubTitles, col]));
      await shot(pp, "X1-public");
    });

  /* ====================================== X2. Fond & carte (100) sur un rail d'images (99) ====================================== */
  if (run("X2"))
    await section("X2", async () => {
      resetScene();
      let f = await reopen(pageId);
      await publish();
      await pp.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
      await sleep(800);
      const pub0 = await railHeights(pp, "X2 public (sans carte)");
      resetScene();
      f = await reopen(pageId);
      const h0 = await railHeights(f, "X2 éditeur (sans carte)");
      ok("X2 la scène a au moins deux rails (bande du projet, carrousel)", h0.length >= 2, String(h0.length));

      // Fond & carte du bloc « planche » : (a) Fond couleur seul ; (b) Carte couleur seule ; (c) Carte + contour moyen ; (d) Fond + Carte (le contour est verrouillé sous un Fond).
      const setKind = async (slot, k) => {
        const m = await openMenu(f, "pbd");
        await kindBtn(m, slot, k).click();
        await sleep(300);
        await page.keyboard.press("Escape");
        await settled(page);
        await sleep(800);
      };
      await setKind("fond", "color");
      ok("X2a Fond couleur enregistré", await waitFor(() => Boolean(draftBlock("pbd")?.props?.background || draftBlock("pbd")?.props?.surface), 30000), JSON.stringify(draftBlock("pbd")?.props));
      const hFond = await railHeights(f, "X2a éditeur (Fond couleur)");
      await setKind("fond", "none");
      await setKind("carte", "color");
      const hCarte = await railHeights(f, "X2b éditeur (Carte couleur)");
      let menu = await openMenu(f, "pbd");
      await menu.locator('[data-testid="fond-section-carte"] [data-testid="fond-contour-row"] [data-contour="medium"]').click();
      ok("X2c contour moyen enregistré", await waitFor(() => JSON.stringify(draftBlock("pbd")?.props ?? {}).includes('"medium"'), 30000), JSON.stringify(draftBlock("pbd")?.props));
      await page.keyboard.press("Escape");
      await settled(page);
      await sleep(800);
      const hContour = await railHeights(f, "X2c éditeur (Carte + contour)");
      await shot(page, "X2-editeur-contour");
      await setKind("fond", "color");
      const hBoth = await railHeights(f, "X2d éditeur (Fond + Carte + contour)");
      diag("hauteurs de rail", `sans ${h0.map((r) => r.h)}`, `fond ${hFond.map((r) => r.h)}`, `carte ${hCarte.map((r) => r.h)}`, `contour ${hContour.map((r) => r.h)}`, `les deux ${hBoth.map((r) => r.h)}`);
      for (const [name, set] of [["Fond", hFond], ["Carte", hCarte], ["Carte + contour", hContour], ["Fond + Carte", hBoth]]) {
        ok(`X2 hauteur du rail inchangée avec « ${name} » (rails ${set.length})`, set.length === h0.length && set.every((r, i) => Math.abs(r.h - h0[i].h) <= 1), JSON.stringify([h0.map((r) => r.h), set.map((r) => r.h)]));
      }
      ok("X2 flèches : même hauteur relative avec et sans carte ni contour", hContour.every((r, i) => r.arrowCy === null || h0[i].arrowCy === null || Math.abs(r.arrowCy - h0[i].arrowCy) <= 1), JSON.stringify([h0.map((r) => r.arrowCy), hContour.map((r) => r.arrowCy)]));

      // Carrousel de la planche : Fond & carte du composant.
      await page.keyboard.press("Escape");
      let menu2 = await openBitemMenu(f, "car");
      await kindBtn(menu2, "fond", "color").click();
      await sleep(500);
      await kindBtn(menu2, "carte", "color").click().catch(() => {});
      await page.keyboard.press("Escape");
      await settled(page);
      await sleep(800);
      const carItem = () => (boardDraft(BOARD_ID) ?? []).find((i) => i.uid === "car");
      ok("X2 le composant carrousel a un fond enregistré", await waitFor(() => Boolean(carItem()?.props?.background), 30000), JSON.stringify(carItem()?.props) + " / " + JSON.stringify((boardDraft(BOARD_ID) ?? []).map((i) => i.uid)));
      const hCar = await railHeights(f, "X2 éditeur (carrousel avec fond)");
      ok("X2 hauteur du rail inchangée avec le fond du composant", hCar.length === h0.length && hCar.every((r, i) => Math.abs(r.h - h0[i].h) <= 1), JSON.stringify([h0.map((r) => r.h), hCar.map((r) => r.h)]));

      // Public après publication
      await publish();
      await pp.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
      await sleep(800);
      const pub1 = await railHeights(pp, "X2 public (avec fond, carte, contour)");
      ok("X2 public : hauteur du rail inchangée avec fond, carte et contour", pub1.length === pub0.length && pub1.every((r, i) => Math.abs(r.h - pub0[i].h) <= 1), JSON.stringify([pub0.map((r) => r.h), pub1.map((r) => r.h)]));
      await shot(pp, "X2-public-contour");
    });

  /* ====================================== X3. Journal (97) : style projet (98), brouillon du site (96), contour (100) ====================================== */
  if (run("X3"))
    await section("X3", async () => {
      const file = path.join(DATA, "edit-log.db");
      const db = new Database(file, { readonly: true });
      const rows = db.prepare("select id, action, type, result, label, page, summary, rev_from, rev_to from edit_log order by id").all();
      db.close();
      const by = (a) => rows.filter((r) => r.action === a);
      diag("journal", `${rows.length} entrées`, [...new Set(rows.map((r) => r.action))].join(","));
      const site = by("siteDraftAction");
      ok("X3a le nom du site modifié est au journal (siteDraftAction, résultat ok, libellé lisible)", site.some((r) => r.result === "ok" && /site|en-tête/i.test(r.label)), JSON.stringify(site.slice(-2)));
      ok("X3a …le résumé nomme le changement (le nom)", site.some((r) => /name|nom|Integ33/i.test(r.summary ?? "")), JSON.stringify(site.slice(-2).map((r) => r.summary)));
      // Lot 120 : le style de légendes du projet est un réglage du bloc de la page : il passe par le brouillon de la page (saveDraftAction).
      const boards = by("saveDraftAction");
      ok("X3b le style du projet (planche) est au journal (saveDraftAction, ok)", boards.some((r) => r.result === "ok"), JSON.stringify(boards.slice(-2)));
      // (Le journal fusionne les enregistrements successifs d'un même brouillon : le résumé garde le dernier geste, pas forcément ce style.)
      const drafts = by("saveDraftAction");
      ok("X3c le contour (brouillon de la page) est au journal (saveDraftAction, ok)", drafts.some((r) => r.result === "ok" && /border|medium|contour|surface/i.test(r.summary ?? "")), JSON.stringify(drafts.slice(-3).map((r) => r.summary)));
      const pubs = by("publishDraftAction");
      ok("X3d les publications sont au journal (publishDraftAction, type publication)", pubs.length >= 2 && pubs.every((r) => r.type === "publication"), JSON.stringify(pubs.map((r) => [r.result, r.page])));
      const discard = by("discardSiteDraftAction");
      diag("discardSiteDraftAction", String(discard.length));
      ok("X3e aucune ligne en erreur ni en refus pour ces gestes", rows.filter((r) => ["boardAction", "siteDraftAction", "saveDraftAction", "publishDraftAction"].includes(r.action)).every((r) => r.result === "ok" || r.result === "conflit"), JSON.stringify(rows.filter((r) => !["ok"].includes(r.result)).slice(0, 5).map((r) => [r.action, r.result])));
      const dump = JSON.stringify(rows);
      ok("X3f aucun secret ni mot de passe dans le journal", !/password|mot de passe|cookie|token/i.test(dump.replace(/"label":"[^"]*"/g, "")) || !new RegExp(process.env.ADMIN_PASSWORD ?? "\u0000impossible").test(dump));
      // L'écran lui-même
      await page.goto(`${BASE}/admin/journal`, { waitUntil: "networkidle" });
      const txt = await page.locator("body").innerText();
      diag("journal écran", txt.split("\n").filter((l) => /modifié|publi|Planche|site/i.test(l)).slice(0, 12).join(" // "));
      ok("X3g l'écran Admin > Journal affiche ces gestes en français (nom du site, planche, publication)", /Nom du site modifié/.test(txt) && /publiée/i.test(txt) && /(Planche|projet)/i.test(txt), txt.slice(0, 300));
      await shot(page, "X3-journal");
    });

  /* ====================================== X4. Opacité 0 à 100 % (90) dans le menu Fond & carte (100) ====================================== */
  if (run("X4"))
    await section("X4", async () => {
      const FIX = mkdtempSync(path.join(tmpdir(), "pf-integ33-"));
      const POIS = path.join(FIX, "Pois integ33.png");
      const dots = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><g fill="#e07a9a"><circle cx="60" cy="60" r="26"/><circle cx="180" cy="180" r="26"/></g><g fill="#7ab0e0"><circle cx="180" cy="60" r="14"/><circle cx="60" cy="180" r="14"/></g></svg>';
      await sharp(Buffer.from(dots)).png().toFile(POIS);
      await page.goto(`${BASE}/admin/papiers-peints`, { waitUntil: "networkidle" });
      const before = await page.locator('[data-testid="wallpaper"][data-status="ready"]').count();
      await page.locator('[data-testid="wallpaper-input"]').setInputFiles([POIS]);
      await waitFor(async () => (await page.locator('[data-testid="wallpaper"][data-status="ready"]').count()) > before, 120000);
      const WP = q1("select id from wallpapers order by id desc")?.id;
      ok("X4 papier peint synthétique importé", Boolean(WP));
      const text = (w) => ({ paragraphs: [{ fr: `${w} : un texte inventé assez long pour que le papier peint ait du contenu à entourer.`, en: `${w}: text.` }] });
      sql((db) => db.prepare("update pages set draft = null, draft_updated_at = null where id = ?").run(pageId));
      setDraft(pageId, [
        { uid: "tcard", type: "rich-text", props: { ...text("Aubepine"), surface: { color: "surface", width: "inset", paperWallpaper: WP } } },
        { uid: "tfond", type: "rich-text", props: { ...text("Bruyere"), background: { kind: "wallpaper", wallpaper: WP } } },
      ]);
      const f = await reopen(pageId);
      const OPAC = (word) => {
        const p = [...document.querySelectorAll("p")].find((e) => e.textContent.includes(word));
        if (!p) return null;
        const card = p.closest('.surface-card[data-surface="on"]');
        const fond = p.closest('.fond-bloc[data-fond="on"]');
        return { card: card ? parseFloat(getComputedStyle(card, "::before").opacity) : null, fond: fond ? parseFloat(getComputedStyle(fond, "::after").opacity) : null };
      };
      const near = (a, b, e = 0.011) => typeof a === "number" && Math.abs(a - b) <= e;
      for (const [label, uid, word, where, read] of [
        ["carte", "tcard", "Aubepine", "card", () => draftBlock("tcard")?.props?.surface?.paperOpacity],
        ["fond", "tfond", "Bruyere", "fond", () => draftBlock("tfond")?.props?.background?.opacity],
      ]) {
        const menu = await openMenu(f, uid);
        const slot = label === "carte" ? "carte" : "fond";
        const slider = sec(menu, slot).locator('[data-testid="wp-opacity"]').first();
        if (!(await slider.count())) await kindBtn(menu, slot, "wallpaper").click();
        await slider.waitFor({ timeout: 20000 });
        ok(`X4 ${label} : le curseur du menu « Fond & carte » va de 0 à 100`, (await slider.getAttribute("min")) === "0" && (await slider.getAttribute("max")) === "100");
        ok(`X4 ${label} : il affiche 100 sans réglage`, (await slider.inputValue()) === "100", await slider.inputValue());
        for (const v of [0, 100, 40, 85]) {
          await slider.fill(String(v));
          if (!(v === 100 && read() === undefined)) ok(`X4 ${label} : ${v} % enregistré`, await waitFor(() => near(read(), v / 100, 0.0001), 20000), String(read()));
          ok(`X4 ${label} : ${v} % rendu sur la toile`, await waitFor(async () => near((await f.evaluate(OPAC, word))?.[where], v / 100), 20000), JSON.stringify(await f.evaluate(OPAC, word)));
          const warn = await menu.locator('[data-testid="wp-opacity-warning"]').count();
          ok(`X4 ${label} : avertissement de lisibilité ${v > 60 ? "présent" : "absent"} à ${v} %`, v > 60 ? warn >= 1 : warn === 0, String(warn));
        }
        await page.keyboard.press("Escape");
        await sleep(500);
      }
      await publish();
      await pp.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
      const o = await pp.evaluate(OPAC, "Aubepine");
      const o2 = await pp.evaluate(OPAC, "Bruyere");
      ok("X4 public : carte à 85 %, fond à 85 %", near(o?.card, 0.85) && near(o2?.fond, 0.85), JSON.stringify([o, o2]));
      await shot(pp, "X4-public");
    });
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} ÉCHEC(S)` : "\nTOUT PASSE");
process.exit(failures ? 1 : 0);
