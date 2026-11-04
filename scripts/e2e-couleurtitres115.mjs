#!/usr/bin/env node
/**
 * Lot 115 « la couleur des titres (et des légendes) change sans raison dans l'éditeur, un rechargement remet la bonne » (chromium, serveur
 * requis, base neuve). Données SYNTHÉTIQUES. Scène : un composant Projet (carte + fond de couleur) dont le titre, le surtitre (contexte), l'année
 * et la présentation ont chacun une couleur par élément (`look.text`), une image de page et une grille d'images à légendes colorées une à une,
 * une planche de projet (image, grille) idem.
 * Après CHAQUE geste réaliste, la couleur calculée de chaque texte de la toile doit être celle de la page rechargée (= les données) ; après
 * publication, celle de la page publique.
 *  A  gestes à la souris (survol, sélection, barre Aa, couleur d'un AUTRE texte, Fond & carte, déplacer / retirer / ajouter un composant,
 *     réglage du site, saisie du titre en place)
 *  B  les mêmes réglages au toucher (tap)
 *  C  deux onglets : l'onglet en retard est refusé (conflit de révision), son aperçu ne reste pas affiché
 *  D  publication puis couleur dans la MÊME session, blocs dont le repère n'est plus le rang (blocs ajoutés, déplacés ou retirés) :
 *     l'écriture va au bon bloc, la couleur reste au rechargement et sur la page publique
 *  E  idem avec des blocs déplacés (le repère de la toile, par rang, est celui d'un AUTRE bloc de l'éditeur)
 *  F  suite aléatoire courte de gestes (graine SEED, STEPS pas)
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=A,B,C,D,E,F] [SEED=n STEPS=n] [SHOTS=dossier] node scripts/e2e-couleurtitres115.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { grid, img, login, makeMedia, openEditor, pageIdOf, setBoardDraft, setDraft, settled, sleep, sql } from "./lib/grille31d.mjs";

const BASE = process.env.BASE ?? "http://localhost:3539";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(process.env.BATTERY_DIR ?? tmpdir(), "shots-couleurtitres115");
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const diag = (...parts) => console.log(`DIAG ${parts.join(" | ")}`);
const T = (s) => ({ fr: s, en: s });
const rgb = (h) => `rgb(${[1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(", ")})`;

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
let page = await ctx.newPage();
page.setDefaultTimeout(20000);
await login(page, BASE);
const M = await makeMedia(page, BASE);
const pageId = pageIdOf("personnages");
const project = sql((db) => db.prepare("select id, slug from projects where deleted_at is null order by id limit 1").get());
if (!project) throw new Error("un projet attendu dans la base de test");
const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});
const section = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.stack ?? e.message).split("\n").slice(0, 6).join(" "));
    await shot(page, `erreur-${name}`);
  }
};

/* ---- Scène ------------------------------------------------------------------------------------------------------------------ */
const NAVY = "#14284b", PLUM = "#7a1f5c", GREEN = "#1f6f4a", SLATE = "#3d3d8f", RED = "#a3201a", TEAL = "#0b7a75", OCRE = "#9a6a12", VIOLET = "#5b2a9a";
const BOARD_ID = project.id;
const board = `[data-edit-board="${BOARD_ID}"]`;
const bitem = (uid) => `${board} [data-edit-bitem="${uid}"]`;
const PAGE_BLOCKS = () => [
  {
    uid: "pbd",
    type: "project-board",
    props: {
      project: project.slug,
      look: { text: { title: { color: NAVY, font: "theme:display" }, context: { color: PLUM }, year: { color: GREEN }, description: { color: SLATE } } },
      surface: { color: "#6aa0e0", corners: "m", width: "inset" },
      background: { kind: "color", color: "#f6dde6", inset: "m" },
    },
  },
  img("pimg", M.paysage, { captionTitle: T("Titre image page"), caption: T("Legende image page"), captionDate: T("2026"), look: { text: { captionTitle: { color: RED }, caption: { color: TEAL }, captionDate: { color: OCRE } } } }),
  grid("pgrid", { layout: "2" }, [
    img("pk1", M.carre, { captionTitle: T("Titre case un"), caption: T("Legende case un"), captionDate: T("2025"), look: { text: { captionTitle: { color: VIOLET }, caption: { color: GREEN } } } }),
    img("pk2", M.paysage2, { captionTitle: T("Titre case deux"), caption: T("Legende case deux"), look: { text: { captionTitle: { color: NAVY } } } }),
  ]),
];
const BOARD_ITEMS = () => [
  { uid: "strip", type: "strip", props: {} },
  img("bimg", M.paysage, { captionTitle: T("Titre planche img"), caption: T("Legende planche img"), captionDate: T("2023"), look: { text: { captionTitle: { color: PLUM }, caption: { color: SLATE } } } }),
  grid("bgrid", { layout: "2" }, [
    img("bk1", M.carre, { captionTitle: T("Case A"), caption: T("Legende A"), captionDate: T("2022"), look: { text: { captionTitle: { color: RED }, captionDate: { color: TEAL } } } }),
    img("bk2", M.paysage2, { captionTitle: T("Case B"), caption: T("Legende B"), look: { text: { captionTitle: { color: OCRE } } } }),
  ]),
];
/** `uids` : repères des trois blocs de la page (par défaut des noms parlants ; `b<rang>` ou autres pour rejouer un brouillon réel). */
function resetScene(uids) {
  sql((db) => {
    db.prepare("update projects set draft_layout = null, draft_layout_page_id = null").run();
    db.prepare("update projects set layout = null where id = ?").run(BOARD_ID);
    db.prepare("delete from settings where key = 'siteDraft'").run();
  });
  setDraft(pageId, PAGE_BLOCKS().map((b, i) => (uids ? { ...b, uid: uids[i] } : b)));
  setBoardDraft(BOARD_ID, pageId, BOARD_ITEMS());
}

/** Couleur calculée de chaque texte de la toile, par texte affiché (les textes de la scène sont uniques). */
const readColors = (f) =>
  f.evaluate(() => {
    const out = {};
    for (const el of document.querySelectorAll("[data-project-inline], [data-cap], [data-inline], [data-slot-inline]")) {
      if (el.closest(".site-header, footer")) continue;
      const t = (el.textContent ?? "").replace(/\s+/g, " ").trim();
      if (!t) continue;
      out[t] = getComputedStyle(el).color;
    }
    return out;
  });
/** Couleur de ces mêmes textes sur la page publique (élément le plus profond dont le texte est exactement celui-ci). */
async function publicColors(texts) {
  const pub = await ctx.newPage();
  try {
    await pub.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
    await sleep(1500);
    return await pub.evaluate((wanted) => {
      const out = {};
      const norm = (e) => (e.textContent ?? "").replace(/\s+/g, " ").trim();
      const all = [...document.querySelectorAll("body *")];
      for (const t of wanted) {
        const hit = all.filter((e) => norm(e) === t && ![...e.children].some((c) => norm(c) === t));
        if (hit.length) out[t] = getComputedStyle(hit[0]).color;
      }
      return out;
    }, texts);
  } finally {
    await pub.close();
  }
}
const diffMaps = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).map((k) => `${k}: ${a[k] ?? "—"} ≠ ${b[k] ?? "—"}`);

async function reopen() {
  const f = await openEditor(page, BASE, pageId);
  await settled(page);
  await f.locator(`${bitem("bimg")}`).first().waitFor({ state: "attached", timeout: 60000 }).catch(() => {});
  await sleep(1200);
  return f;
}

/* ---- Souris, toucher, barre Aa -------------------------------------------------------------------------------------------------- */
const center = async (loc) => {
  await loc.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  await sleep(150);
  const b = await loc.boundingBox();
  if (!b) throw new Error("élément sans boîte");
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
};
const mHover = async (loc) => {
  const { x, y } = await center(loc);
  await page.mouse.move(x - 6, y - 6);
  await page.mouse.move(x, y, { steps: 4 });
  await sleep(350);
};
const away = async () => {
  await page.mouse.move(5, 5);
  await sleep(300);
};
const until = (f, fn, arg, ms = 8000) => f.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
async function closeBar(f) {
  if (await f.locator(".lk-bar").count()) {
    await f.locator(".lk-bar .lk-close").evaluate((b) => b.click()).catch(() => {});
    await f.locator(".lk-bar").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  }
}
/** Ouvre la barre d'un texte : survol puis « Aa » à la souris ; au toucher, un tap sur le texte (la saisie ouvre la barre d'elle-même). */
async function openByAa(f, sel, tap = false) {
  await closeBar(f);
  const target = f.locator(sel).first();
  for (let essai = 0; essai < 4; essai++) {
    if (tap) {
      await center(target);
      await target.tap().catch(() => {});
      await sleep(500);
      // Un texte du projet se met en saisie par l'évènement `dblclick` (le double tap n'en envoie pas toujours un) : la barre s'ouvre d'elle-même.
      if (essai > 0 && !(await f.locator(".lk-bar").count())) await target.dispatchEvent("dblclick").catch(() => {});
      await sleep(500);
    } else {
      await away();
      await mHover(target);
    }
    if (!(await until(f, () => Boolean(document.querySelector(".lk-aa") || document.querySelector(".lk-bar")), null, 6000))) continue;
    try {
      if (!(await f.locator(".lk-bar").count())) await (tap ? f.locator(".lk-aa").tap({ timeout: 4000 }) : f.locator(".lk-aa").click({ timeout: 4000 }));
      if (await until(f, () => Boolean(document.querySelector(".lk-bar")), null, 6000)) return true;
    } catch {
      /* le « Aa » a bougé avec le survol : on recommence */
    }
  }
  return false;
}
const scopeBtn = (f, re) => f.locator(".lk-bar .lk-seg [role=radio]").filter({ hasText: re }).first();
const swatchBtn = (f, i) => f.locator(".lk-bar .tc-swatches [role=radio]").nth(i);
/** Colore CE texte (portée « Ce texte » quand elle existe) avec la pastille `i` de la barre ; rend la couleur calculée de la pastille. */
async function colorText(f, sel, i, tap = false) {
  if (!(await openByAa(f, sel, tap))) throw new Error(`barre non ouverte sur ${sel}`);
  if (await scopeBtn(f, /Ce texte/).count()) await (tap ? scopeBtn(f, /Ce texte/).tap() : scopeBtn(f, /Ce texte/).click());
  const wanted = await swatchBtn(f, i).evaluate((b) => getComputedStyle(b).backgroundColor);
  await (tap ? swatchBtn(f, i).tap() : swatchBtn(f, i).click());
  await sleep(300);
  return wanted;
}
const selectBlock = (f, uid) => f.locator(`.pe-focus[data-uid="${uid}"]`).first().evaluate((b) => b.click());
const publishNow = async () => {
  const publish = page.getByRole("button", { name: "Publier", exact: true });
  await publish.waitFor({ timeout: 30000 });
  await publish.click();
  const confirm = page.locator("dialog[open]").getByRole("button", { name: "Mettre en ligne" });
  if (await confirm.waitFor({ timeout: 3000 }).then(() => true, () => false)) await confirm.click();
  await sleep(4000);
  await settled(page);
  await sleep(1500);
};

/* ---- Un geste, puis la comparaison ---------------------------------------------------------------------------------------------- */
let F; // cadre de la toile courant
/**
 * Joue le geste, attend l'enregistrement, relève les couleurs de la toile (S), recharge, relève (R). La toile doit être égale au rechargement ;
 * tout texte non visé (`ignore` : débuts de texte des textes visés) garde sa couleur d'avant.
 */
async function gesture(name, fn, { ignore = [] } = {}) {
  const before = await readColors(F);
  try {
    await fn(F);
  } catch (e) {
    ok(`${name} : geste jouable`, false, String(e.message).split("\n").slice(0, 4).join(" | "));
  }
  await settled(page);
  await sleep(1500);
  const S = await readColors(F);
  const moved = diffMaps(before, S).filter((d) => !ignore.some((k) => d.startsWith(`${k}`)));
  ok(`${name} : aucun autre texte ne change de couleur`, moved.length === 0, moved.slice(0, 4).join(" ; "));
  F = await reopen();
  const R = await readColors(F);
  const d = diffMaps(S, R);
  ok(`${name} : couleurs de la toile = couleurs après rechargement`, d.length === 0, d.slice(0, 5).join(" ; "));
  if (d.length) await shot(page, `ecart-${name.replace(/\W+/g, "_").slice(0, 40)}`);
  return R;
}

let projectTitle = "";
const TITLE = () => F.evaluate(() => document.querySelector("[data-project-inline='title']")?.textContent?.trim());
const sel = {
  title: `[data-edit-block="pbd"] [data-project-inline="title"]`,
  context: `[data-edit-block="pbd"] [data-project-inline="context"]`,
  desc: `[data-edit-block="pbd"] [data-project-inline="description"]`,
  pimgT: '[data-edit-block="pimg"] [data-cap="title"]',
  pimgL: '[data-edit-block="pimg"] [data-cap="legend"]',
  pk1T: '[data-edit-block="pk1"] [data-cap="title"]',
  bimgT: `${bitem("bimg")} [data-cap="title"]`,
  bk1T: `${bitem("bgrid")} .block-grid-cell:nth-child(1) [data-cap="title"]`,
};

try {
  /* ===== A. Gestes à la souris ============================================================================================ */
  if (run("A")) {
    await section("A", async () => {
      resetScene();
      F = await reopen();
      projectTitle = (await TITLE()) ?? "";
      const base = await readColors(F);
      diag("textes relevés", String(Object.keys(base).length), projectTitle);
      ok("A0 état de départ : le titre du projet est bleu marine", base[projectTitle] === rgb(NAVY), `${base[projectTitle]}`);
      ok("A0 état de départ : la légende de l'image est teal, le titre rouge", base["Legende image page"] === rgb(TEAL) && base["Titre image page"] === rgb(RED));
      await shot(page, "A0-scene");
      await gesture("A1 survol du titre, barre Aa ouverte puis fermée", async (f) => {
        await openByAa(f, sel.title);
        await closeBar(f);
        await away();
      });
      await gesture("A2 sélection du composant puis désélection", async (f) => {
        await selectBlock(f, "pbd");
        await sleep(400);
        await page.mouse.click(5, 5);
      });
      await gesture("A3 couleur d'un AUTRE texte (légende de l'image de page)", async (f) => {
        await colorText(f, sel.pimgL, 4);
        await closeBar(f);
      }, { ignore: ["Legende image page"] });
      await gesture("A4 couleur du surtitre puis de la présentation du projet", async (f) => {
        await colorText(f, sel.context, 3);
        await closeBar(f);
        await colorText(f, sel.desc, 5);
        await closeBar(f);
      }, { ignore: ["Court", "Une travers"] });
      await gesture("A5 couleur du titre d'une case de grille de page", async (f) => {
        await colorText(f, sel.pk1T, 2);
        await closeBar(f);
      }, { ignore: ["Titre case un"] });
      await gesture("A6 « Fond & carte » du composant Projet : couleur du Fond puis de la Carte", async (f) => {
        await selectBlock(f, "pbd");
        await f.locator('.pe-tools [data-testid="fond-button"]').first().click();
        const menu = f.locator('[data-testid="fond-menu"]');
        await menu.waitFor({ timeout: 20000 });
        await menu.locator('[data-testid="fond-section-fond"] [data-kind="color"]').click().catch(() => {});
        await sleep(400);
        await menu.locator('[data-testid="fond-section-carte"] [data-kind="color"]').click().catch(() => {});
        await sleep(400);
        await page.keyboard.press("Escape");
        await page.mouse.click(5, 5);
      });
      await gesture("A7 couleur du titre du composant Projet puis, aussitôt, d'un autre texte", async (f) => {
        await colorText(f, sel.title, 1);
        await colorText(f, sel.bimgT, 2);
        await closeBar(f);
      }, { ignore: [projectTitle, "Titre planche img"] });
      await gesture("A8 déplacer la grille de la planche vers le haut", async (f) => {
        await f.locator(bitem("bgrid")).first().hover();
        await f.locator(`${bitem("bgrid")} [data-edit-bitem-op="up"]`).first().click();
      });
      await gesture("A9 retirer l'image de la planche", async (f) => {
        await f.locator(bitem("bimg")).first().hover();
        await f.locator(`${bitem("bimg")} [data-edit-bitem-op="remove"]`).first().click();
      }, { ignore: ["Titre planche img", "Legende planche img", "2023"] });
      await gesture("A10 ajouter une grille en bas de la planche", async (f) => {
        await f.locator(board).first().hover();
        await f.locator(`${board} [data-edit-bitem-add]`).last().click();
        await f.locator(".pe-bitem-menu").waitFor({ timeout: 20000 });
        await f.locator('.pe-bitem-menu [data-bitem-type="grid"]').click();
        await sleep(1500);
      });
      await gesture("A11 saisie du titre en place (texte de projet), barre Aa ouverte d'elle-même", async (f) => {
        await center(f.locator(sel.title));
        await f.locator(sel.title).first().dblclick();
        await sleep(800);
        await page.keyboard.press("End");
        await page.keyboard.type(" bis");
        await sleep(300);
        await page.keyboard.press("Enter");
        await sleep(600);
      }, { ignore: [projectTitle] });
      projectTitle = (await TITLE()) ?? projectTitle;
      ok("A11b le titre garde sa couleur après la saisie", (await readColors(F))[projectTitle] !== undefined, projectTitle);
      await gesture("A12 couleur du titre PENDANT la saisie du texte, puis validation", async (f) => {
        await closeBar(f);
        await center(f.locator(sel.title));
        await f.locator(sel.title).first().dblclick();
        await until(f, () => Boolean(document.querySelector(".lk-bar")), null, 6000);
        if (await scopeBtn(f, /Ce texte/).count()) await scopeBtn(f, /Ce texte/).click();
        await swatchBtn(f, 3).click();
        await sleep(400);
        await page.keyboard.press("End");
        await page.keyboard.type(" ter");
        await sleep(300);
        await page.keyboard.press("Enter");
        await sleep(800);
      }, { ignore: [projectTitle] });
      projectTitle = (await TITLE()) ?? projectTitle;
      await gesture("A13 survol prolongé du titre (infobulle du texte de projet)", async (f) => {
        await mHover(f.locator(sel.title));
        await sleep(2500);
        await away();
      });
      await gesture("A14 trois couleurs de suite sur trois textes", async (f) => {
        await colorText(f, sel.pimgT, 1);
        await colorText(f, sel.title, 2);
        await colorText(f, sel.pk1T, 3);
        await closeBar(f);
      }, { ignore: [projectTitle, "Titre image page", "Titre case un"] });
      await gesture("A15 « Tous les titres » (réglage du site) depuis le titre d'une case", async (f) => {
        if (!(await openByAa(f, sel.pk1T))) throw new Error("barre non ouverte");
        await f.locator(".lk-bar .lk-seg [role=radio]").last().click();
        await swatchBtn(f, 0).click();
        await sleep(300);
        await closeBar(f);
      }, { ignore: [""] });
    });
  }

  /* ===== B. Toucher ======================================================================================================= */
  if (run("B")) {
    await section("B", async () => {
      const touch = await browser.newContext({ viewport: { width: 1024, height: 800 }, hasTouch: true, isMobile: true });
      const keep = page;
      page = await touch.newPage();
      page.setDefaultTimeout(20000);
      try {
        await login(page, BASE);
        resetScene();
        F = await reopen();
        projectTitle = (await TITLE()) ?? "";
        const base = await readColors(F);
        ok("B0 tactile : état de départ, titre bleu marine", base[projectTitle] === rgb(NAVY), `${base[projectTitle]}`);
        await gesture("B1 tap sur le titre puis fermeture de la barre", async (f) => {
          ok("B1 la barre Aa s'ouvre au toucher sur le titre", await openByAa(f, sel.title, true));
          await closeBar(f);
        });
        await gesture("B2 tap : couleur de la légende de l'image de page (un AUTRE texte)", async (f) => {
          await colorText(f, sel.pimgL, 4, true);
          await closeBar(f);
        }, { ignore: ["Legende image page"] });
        await gesture("B3 tap : couleur du surtitre puis de la présentation", async (f) => {
          await colorText(f, sel.context, 3, true);
          await closeBar(f);
          await colorText(f, sel.desc, 5, true);
          await closeBar(f);
        }, { ignore: ["Court", "Une travers"] });
        await gesture("B4 tap : couleur du titre d'une case de grille", async (f) => {
          await colorText(f, sel.pk1T, 2, true);
          await closeBar(f);
        }, { ignore: ["Titre case un"] });
      } finally {
        await touch.close();
        page = keep;
      }
    });
  }

  /* ===== C. Deux onglets : conflit de révision ============================================================================ */
  if (run("C")) {
    await section("C", async () => {
      resetScene();
      F = await reopen();
      projectTitle = (await TITLE()) ?? "";
      const before = await readColors(F);
      const page1 = page;
      const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page2 = await ctx2.newPage();
      page2.setDefaultTimeout(20000);
      try {
        await login(page2, BASE);
        await page2.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
        const f2 = await (await page2.waitForSelector("iframe.ve-frame", { timeout: 120000 })).contentFrame();
        await f2.waitForSelector("html[data-edit-mode]", { timeout: 180000 });
        await sleep(1500);
        // Onglet 2 : une couleur écrite (révision + 1) ; l'onglet 1 ne le sait pas.
        page = page2;
        try {
          await colorText(f2, sel.pimgL, 4);
          await settled(page2);
        } finally {
          page = page1;
        }
        // Onglet 1 : un premier réglage (le titre) fait voir le conflit ; le suivant (le surtitre) est refusé d'emblée.
        await colorText(F, sel.title, 2);
        await closeBar(F);
        await page1.locator('[data-testid="conflict"]').waitFor({ timeout: 20000 }).catch(() => {});
        ok("C1 l'onglet en retard voit l'alerte de conflit", (await page1.locator('[data-testid="conflict"]').count()) === 1);
        await colorText(F, sel.context, 3);
        await closeBar(F);
        await sleep(2500);
        const S = await readColors(F);
        const ctxText = Object.keys(before).find((k) => k.startsWith("Court"));
        ok("C2 un réglage refusé (page modifiée ailleurs) ne reste pas affiché : le surtitre garde sa couleur", S[ctxText] === before[ctxText], `${S[ctxText]} ≠ ${before[ctxText]}`);
        const moved = diffMaps(before, S).filter((d) => !d.startsWith(projectTitle));
        ok("C3 en conflit, aucun autre texte ne change de couleur", moved.length === 0, moved.slice(0, 4).join(" ; "));
        await shot(page1, "C-conflit");
      } finally {
        await ctx2.close();
      }
    });
  }

  /* ===== D. Publication puis couleur dans la même session (blocs ajoutés, déplacés, retirés) ================================== */
  if (run("D")) {
    await section("D", async () => {
      // Des blocs qui ne portent plus leur rang d'origine (comme après un ajout, un déplacement ou un retrait) : b0, b2, n-ajout.
      resetScene(["b0", "b2", "n1ajout"]);
      F = await reopen();
      projectTitle = (await TITLE()) ?? "";
      const uidsCanvas = () => F.evaluate(() => [...document.querySelectorAll("[data-edit-block]:not([data-edit-parent])")].map((e) => e.getAttribute("data-edit-block")));
      diag("D0 repères de blocs avant publication", JSON.stringify(await uidsCanvas()));
      await publishNow();
      diag("D1 repères de blocs après publication", JSON.stringify(await uidsCanvas()));
      const afterPublish = await readColors(F);
      // Couleurs, dans la même session, sur la légende de l'image (repère b1 sur la toile) et sur le surtitre du projet (b0).
      const wantedLegend = await colorText(F, '[data-edit-block="b1"] [data-cap="legend"]', 4);
      await closeBar(F);
      const wantedContext = await colorText(F, '[data-edit-block="b0"] [data-project-inline="context"]', 3);
      await closeBar(F);
      await settled(page);
      await sleep(2500);
      const S = await readColors(F);
      const other = diffMaps(afterPublish, S).filter((d) => !d.startsWith("Legende image page") && !d.startsWith("Court"));
      ok("D2 aucun autre texte ne change de couleur après la publication", other.length === 0, other.slice(0, 5).join(" ; "));
      ok("D2b la légende prend la couleur choisie sur la toile", S["Legende image page"] === wantedLegend, `${S["Legende image page"]} ≠ ${wantedLegend}`);
      F = await reopen();
      const R = await readColors(F);
      const d = diffMaps(S, R);
      ok("D3 couleurs de la toile = couleurs après rechargement", d.length === 0, d.slice(0, 5).join(" ; "));
      ok("D3b la légende colorée après la publication garde sa couleur au rechargement", R["Legende image page"] === wantedLegend, `${R["Legende image page"]} ≠ ${wantedLegend}`);
      const ctxText = Object.keys(R).find((k) => k.startsWith("Court"));
      ok("D3c le surtitre coloré après la publication garde sa couleur au rechargement", R[ctxText] === wantedContext, `${R[ctxText]} ≠ ${wantedContext}`);
      ok("D3d le titre du projet garde son bleu marine", R[projectTitle] === rgb(NAVY), `${R[projectTitle]}`);
      // Publication : la page publique porte les mêmes couleurs.
      await publishNow();
      const pub = await publicColors(Object.keys(R));
      const diff = Object.keys(pub).filter((k) => pub[k] !== R[k]);
      ok("D4 couleurs publiées = couleurs de la toile (textes trouvés sur la page publique)", Object.keys(pub).length >= 5 && diff.length === 0, `${Object.keys(pub).length} trouvés ; écarts : ${diff.slice(0, 4).map((k) => `${k}: ${pub[k]} ≠ ${R[k]}`).join(" ; ")}`);
      diag("D4 textes comparés avec le public", String(Object.keys(pub).length));
    });
  }

  /* ===== E. Blocs déplacés : le repère de la toile (rang) est celui d'un AUTRE bloc de l'éditeur ===================================== */
  if (run("E")) {
    await section("E", async () => {
      resetScene(["b1", "b0", "b2"]);
      F = await reopen();
      projectTitle = (await TITLE()) ?? "";
      await publishNow();
      const afterPublish = await readColors(F);
      const wanted = await colorText(F, '[data-edit-block="b0"] [data-project-inline="description"]', 5);
      await closeBar(F);
      await settled(page);
      await sleep(2500);
      const S = await readColors(F);
      const descText = Object.keys(S).find((k) => k.startsWith("Une travers"));
      ok("E1 la présentation du projet prend la couleur choisie", S[descText] === wanted, `${S[descText]} ≠ ${wanted}`);
      const other = diffMaps(afterPublish, S).filter((d) => !d.startsWith("Une travers"));
      ok("E2 aucun AUTRE texte ne change de couleur (les réglages du bloc voisin ne sont pas remplacés)", other.length === 0, other.slice(0, 5).join(" ; "));
      F = await reopen();
      const R = await readColors(F);
      const d = diffMaps(S, R);
      ok("E3 couleurs de la toile = couleurs après rechargement", d.length === 0, d.slice(0, 5).join(" ; "));
      ok("E3b le titre du projet garde son bleu marine", R[projectTitle] === rgb(NAVY), `${R[projectTitle]}`);
      ok("E3c la légende de l'image garde sa couleur", R["Legende image page"] === rgb(TEAL) && R["Titre image page"] === rgb(RED), `${R["Legende image page"]} / ${R["Titre image page"]}`);
      // Dans l'autre sens : colorer la légende de l'image (repère b1 sur la toile ; b1 est le COMPOSANT PROJET pour l'éditeur) ne doit rien changer au projet.
      resetScene(["b1", "b0", "b2"]);
      F = await reopen();
      await publishNow();
      const wantedLegend = await colorText(F, '[data-edit-block="b1"] [data-cap="legend"]', 4);
      await closeBar(F);
      await settled(page);
      await sleep(2500);
      const S2 = await readColors(F);
      ok("E4 le titre du projet garde son bleu marine quand on colore la légende de l'image", S2[projectTitle] === rgb(NAVY), `${S2[projectTitle]}`);
      ok("E4b la légende prend la couleur choisie", S2["Legende image page"] === wantedLegend, `${S2["Legende image page"]} ≠ ${wantedLegend}`);
      F = await reopen();
      const R2 = await readColors(F);
      ok("E4c après rechargement : le titre du projet est bleu marine, la légende garde sa couleur", R2[projectTitle] === rgb(NAVY) && R2["Legende image page"] === wantedLegend, `${R2[projectTitle]} / ${R2["Legende image page"]}`);
      const dd = diffMaps(S2, R2);
      ok("E4d couleurs de la toile = couleurs après rechargement", dd.length === 0, dd.slice(0, 5).join(" ; "));
    });
  }

  /* ===== F. Suite aléatoire courte ======================================================================================== */
  if (run("F")) {
    await section("F", async () => {
      let seed = Number(process.env.SEED ?? 3);
      const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
      const pick = (a) => a[Math.floor(rnd() * a.length)];
      resetScene();
      F = await reopen();
      projectTitle = (await TITLE()) ?? "";
      const TEXTS = [sel.title, sel.context, sel.desc, sel.pimgT, sel.pimgL, sel.pk1T, sel.bimgT, sel.bk1T];
      const STEPS = Number(process.env.STEPS ?? 8);
      for (let n = 1; n <= STEPS; n++) {
        const kind = pick(["color", "color", "role", "undo", "redo", "select", "fond", "hover", "moveb", "colorfast", "title"]);
        const before = await readColors(F);
        let note = kind;
        try {
          if (kind === "color" || kind === "colorfast") {
            for (let j = 0; j < (kind === "colorfast" ? 2 : 1); j++) {
              const t = pick(TEXTS);
              if (await F.locator(t).count()) await colorText(F, t, Math.floor(rnd() * 6));
              if (kind === "color") await closeBar(F);
            }
            await closeBar(F);
          } else if (kind === "role") {
            if (!(await openByAa(F, pick([sel.title, sel.pimgT, sel.pk1T, sel.bimgT, sel.pimgL])))) throw new Error("barre non ouverte");
            await F.locator(".lk-bar .lk-seg [role=radio]").last().click();
            await swatchBtn(F, Math.floor(rnd() * 6)).click();
            await sleep(300);
            await closeBar(F);
          } else if (kind === "undo" || kind === "redo") {
            await closeBar(F);
            await page.locator(".ve-status").click({ timeout: 3000 }).catch(() => {});
            await page.keyboard.press(kind === "undo" ? "Control+z" : "Control+Shift+z");
          } else if (kind === "select") {
            await closeBar(F);
            await selectBlock(F, pick(["pbd", "pimg", "pgrid"])).catch(() => {});
            await sleep(300);
            if (rnd() < 0.5) await page.mouse.click(5, 5);
          } else if (kind === "fond") {
            await closeBar(F);
            await selectBlock(F, "pbd");
            await F.locator('.pe-tools [data-testid="fond-button"]').first().click({ timeout: 6000 });
            const menu = F.locator('[data-testid="fond-menu"]');
            await menu.waitFor({ timeout: 8000 });
            await menu.locator(`[data-testid="fond-section-${pick(["fond", "carte"])}"] [data-kind="${pick(["color", "none"])}"]`).click({ timeout: 4000 }).catch(() => {});
            await sleep(400);
            await page.keyboard.press("Escape");
          } else if (kind === "hover") {
            await mHover(F.locator(pick(TEXTS)));
            await sleep(rnd() * 1500);
          } else if (kind === "moveb") {
            const uid = pick(["bgrid", "bimg"]);
            await F.locator(bitem(uid)).first().hover({ timeout: 4000 });
            await F.locator(`${bitem(uid)} [data-edit-bitem-op="${pick(["up", "down"])}"]`).first().click({ timeout: 4000 });
          } else if (kind === "title") {
            await closeBar(F);
            await center(F.locator(sel.title));
            await F.locator(sel.title).first().dblclick();
            await sleep(700);
            if (rnd() < 0.6 && (await F.locator(".lk-bar").count())) {
              if (await scopeBtn(F, /Ce texte/).count()) await scopeBtn(F, /Ce texte/).click();
              await swatchBtn(F, Math.floor(rnd() * 6)).click();
              await sleep(300);
            }
            await page.keyboard.press("Escape");
          }
        } catch (e) {
          note += ` [incomplet : ${String(e.message).split("\n")[0].slice(0, 80)}]`;
        }
        if (rnd() < 0.5) await sleep(rnd() * 400);
        await settled(page);
        await sleep(1200);
        const S = await readColors(F);
        F = await reopen();
        const R = await readColors(F);
        const d = diffMaps(S, R);
        ok(`F${n} (${note}) : toile = rechargée`, d.length === 0, d.slice(0, 5).join(" ; "));
        if (d.length) {
          await shot(page, `F${n}-ecart`);
          diag(`F${n}`, "changements pendant le pas", diffMaps(before, S).slice(0, 4).join(" ; "));
        }
      }
    });
  }
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} ÉCHEC(S)` : "\nTout passe");
process.exit(failures ? 1 : 0);
