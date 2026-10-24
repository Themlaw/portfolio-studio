#!/usr/bin/env node
/**
 * Lot 65 « un seul Popover ancré au bouton + barres claires » (chromium, serveur requis, base neuve, une connexion admin).
 * Gestes à la souris réelle (`page.mouse`) sur la toile ; chaque fenêtre est mesurée par `getBoundingClientRect` (coordonnées de
 * la page, la toile est un cadre) :
 *  W  Pour CHAQUE bouton de barre qui ouvre une fenêtre (page : Cadre, Fond image, Taille, Espace, Carte, Fond ; case de grille :
 *     Cadre, Fond image, Taille ; composant de planche : Fond, Taille, Espace, Cadre, Fond image, + Ajouter ; image de carrousel :
 *     Cadre, Fond image ; Planche libre : Cadre, Fond image) : la fenêtre est à moins de 16 px du bouton (de l'autre côté s'il le
 *     faut), entièrement dans la fenêtre du navigateur, à 1440 / 1024 / 390 px ; elle le reste après un défilement de la toile ;
 *     Échap la ferme ; un clic ailleurs la ferme.
 *  B  Barres : jamais hors de l'écran (elles passent à la ligne), pour la barre d'une rubrique, des composants de planche et de la
 *     Planche libre (images à gauche ET à droite), à 1440 / 1024 / 390 ; aucun bouton de barre masqué par une pastille (390).
 *  K  Échap ferme la fenêtre ET RIEN D'AUTRE : le bloc reste choisi, sa barre reste là ; « Aa » : la barre de style s'ouvre au bouton, qui reste.
 *  D  Aucune barre sombre : la couleur de fond calculée de chaque barre / menu de la liste A5 §4.3 (sondes posées sur la toile,
 *     plus les barres réellement visibles) est claire, et le texte de ses boutons y reste lisible (contraste ≥ 4,5).
 *  R  Retour de l'artiste (R3) : « Aa » d'un texte en haut ou en bas de l'écran, puis « Police » : la liste des polices est entièrement dans
 *     l'écran (retournée ou réduite, elle défile en interne), la recherche visible et libre, la page n'a pas défilé (1440 / 1024 / 390).
 *  O  Recouvrement : aucune barre (réelle, ou sonde de chaque classe posée sur la fenêtre) au-dessus de la fenêtre Fond ouverte
 *     (page, image courte, composants de planche) ; vidéo : barre du composant Vidéo (MENU-02) et ses fenêtres.
 * Captures : $SHOTS. Mode « rapport » (REPORT=1) : n'échoue pas, écrit seulement les mesures (captures « avant »).
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=W,D] [WIDTHS=1440,1024,390] [SHOTS=dossier] node scripts/e2e-popover65.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { ensureVideos } from "./lib/video36.mjs";
import { grid, img, login, makeMedia, openEditor, pageIdOf, q1, setBoardDraft, setDraft, settled, sleep } from "./lib/grille31d.mjs";

const BASE = process.env.BASE ?? "http://localhost:3810";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const REPORT = process.env.REPORT === "1";
const WIDTHS = (process.env.WIDTHS ?? "1440,1024,390").split(",").map(Number);
const SHOTS = process.env.SHOTS ?? path.join(process.env.BATTERY_DIR ?? tmpdir(), "shots-popover65");
mkdirSync(SHOTS, { recursive: true });
const MAX_GAP = 16;

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond && !REPORT) failures++;
  console.log(`${cond ? "PASS" : REPORT ? "NOTE" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};

let browser;
let ctx;
let page;
const errors = [];
/** (Re)lance le navigateur : sur une machine chargée, un seul navigateur gardé pendant toute la suite finit par être tué (mémoire). */
async function launch(viewport = { width: 1440, height: 900 }) {
  await browser?.close().catch(() => {});
  browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
  ctx = await browser.newContext({ viewport });
  page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, BASE);
}
await launch();

/* ---- Fixtures ------------------------------------------------------------------------------------------------------------ */
const M = await makeMedia(page, BASE);
// Vraie vidéo (envoyée par la médiathèque) : le composant « Vidéo » de la planche (MENU-02 : sa barre est la plus large).
const VID = await ensureVideos(page, BASE);
const pageId = pageIdOf("personnages");
const project = q1("select id, slug from projects order by id limit 1");
if (!project) throw new Error("aucun projet dans la base de test");
const it = (id, media, x, y, w, rot, z) => ({ id, media, x, y, w, rot, z });
const FREE = (uid) => ({ uid, type: "free-board", props: { format: "3:2", phone: "scale", items: [it("a", M.carre, 8, 10, 30, 0, 1), it("b", M.paysage, 50, 20, 36, 0, 2)] } });
const BOARD = () => [
  { uid: "bs", type: "strip", props: {} },
  { uid: "bi", type: "image", props: { mediaId: M.paysage } },
  { uid: "bg", type: "grid", props: { layout: "2", gap: "normal", align: "stretch", ratio: "auto", top: "gap", children: [img("bga", M.paysage), img("bgb", M.carre)] } },
  { uid: "bc", type: "strip", props: { source: "own", media: [M.paysage, M.portrait, M.carre, M.panorama] } },
  FREE("bfb"),
  ...(process.env.NOVID ? [] : [{ uid: "bv", type: "video-single", props: { mediaId: VID.short, variant: "plain", mode: "loop" } }]),
];
const resetPage = () => {
  setDraft(pageId, [
    img("solo", M.paysage),
    grid("gridr", { ratio: "3:2" }, [img("ga", M.paysage), img("gb", M.carre)]),
    FREE("free"),
    { uid: "board1", type: "project-board", props: { project: project.slug } },
  ]);
  setBoardDraft(project.id, pageId, BOARD());
};

/* ---- Aides --------------------------------------------------------------------------------------------------------------- */
const section = async (name, fn) => {
  try {
    if (name !== "A") await launch();
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 8).join(" "));
    await page.screenshot({ path: path.join(SHOTS, `erreur-${name}.png`) }).catch(() => {});
  }
};
const iframeBox = () => page.locator("iframe.ve-frame").boundingBox();
/** Fenêtres ouvertes sur la toile (nouveau composant commun, ou anciennes enveloppes). */
const POP = ".pe-pop, .pe-gridmenu[role='menu'], .sm[role='dialog'], .pe-layouts[role='menu'], .pe-layouts[role='radiogroup'], .pe-popover";
const gapBetween = (a, b) => {
  const dx = Math.max(0, a.x - (b.x + b.width), b.x - (a.x + a.width));
  const dy = Math.max(0, a.y - (b.y + b.height), b.y - (a.y + a.height));
  return Math.hypot(dx, dy);
};
const inside = (r, v) => r.x >= v.x - 1 && r.y >= v.y - 1 && r.x + r.width <= v.x + v.width + 1 && r.y + r.height <= v.y + v.height + 1;
const lum = ([r, g, b]) => {
  const f = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const parse = (s) => (/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)(?:[, /]+([\d.]+))?/.exec(s) ?? []).slice(1, 5).map((v, i) => (v === undefined ? (i === 3 ? 1 : 0) : Number(v)));

let fr;
let W = 1440;
async function open() {
  resetPage();
  fr = await openEditor(page, BASE, pageId);
  await settled(page);
}
const centerOf = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
async function scrollTo(loc) {
  await loc.evaluate((el) => el.scrollIntoView({ block: "center", inline: "nearest" }));
  await sleep(500);
}
/** Mouvement réel jusqu'au centre de `loc` (le survol fait apparaître les barres). */
async function moveOn(loc) {
  const b = await loc.boundingBox();
  if (!b) throw new Error("élément sans boîte");
  const c = centerOf(b);
  await page.mouse.move(c.x - 6, c.y - 4);
  await page.mouse.move(c.x, c.y, { steps: 3 });
  await sleep(250);
  return b;
}
/** Fenêtre ouverte, en coordonnées de la page (celles des boutons). */
async function popup() {
  const loc = fr.locator(POP).last();
  const b = await loc.boundingBox().catch(() => null);
  return b && b.width > 0 ? b : null;
}
const closeAll = async () => {
  await page.keyboard.press("Escape");
  await sleep(250);
};

/**
 * Un bouton : `prep` pose la barre (sélection / survol), `btn()` rend son locator. Clic réel, mesure, défilement, Échap.
 */
let checks = 0;
async function check(name, prep, btn, { scroll = 140, esc = true, pointerOutside = false, write = null, noCover = null, fresh = true } = {}) {
  const tag = `${W} ${name}`;
  if (process.env.CASE && !process.env.CASE.split(",").some((c) => name.includes(c))) return;
  try {
    if (fresh && ++checks % 10 === 0) {
      await launch({ width: W, height: W === 390 ? 844 : W === 1024 ? 768 : 900 });
      await open();
    }
    // Téléphone : choisir un composant ouvre le tiroir de réglages de l'éditeur, dont le voile recouvre la toile : on le referme.
    if (await page.locator(".ve-scrim").count()) {
      await page.locator(".ve-scrim").first().click({ position: { x: 370, y: 300 }, force: true }).catch(() => {});
      await sleep(400);
    }
    await prep();
    // L'éditeur a fini d'écrire / de redessiner la toile avant le clic (un bouton remplacé entre l'appui et le relâchement ne clique pas).
    await settled(page);
    const b = btn();
    const bb0 = await b.boundingBox();
    if (!bb0) return ok(`${tag} : bouton trouvé`, false, "sans boîte");
    const c = centerOf(bb0);
    await page.mouse.move(c.x - 3, c.y - 2);
    await page.mouse.move(c.x, c.y, { steps: 2 });
    await page.mouse.click(c.x, c.y);
    await sleep(500);
    const pop = await popup();
    if (!pop) {
      await page.screenshot({ path: path.join(SHOTS, `${W}-${name}-ERREUR.png`) }).catch(() => {});
      const ib = await iframeBox();
      const dbg = await fr
        .evaluate(([sel, x, y]) => [...document.querySelectorAll(sel)].map((e) => `${e.className} ${JSON.stringify(e.getBoundingClientRect())}`).concat([`au point : ${document.elementsFromPoint(x, y).slice(0, 4).map((e) => e.tagName + "." + e.className).join(" < ")}`]), [POP, c.x - ib.x, c.y - ib.y])
        .catch(() => []);
      return ok(`${tag} : la fenêtre s'ouvre`, false, `aucune fenêtre visible (éléments : ${JSON.stringify(dbg)})`);
    }
    const view = await iframeBox();
    const bb = (await btn().boundingBox().catch(() => null)) ?? bb0;
    const gap = gapBetween(pop, bb);
    ok(`${tag} : fenêtre à ≤ ${MAX_GAP} px du bouton`, gap <= MAX_GAP, `écart ${Math.round(gap)} px (bouton ${JSON.stringify(rd(bb))}, fenêtre ${JSON.stringify(rd(pop))})`);
    ok(`${tag} : fenêtre entièrement à l'écran`, inside(pop, view), `fenêtre ${JSON.stringify(rd(pop))} / vue ${JSON.stringify(rd(view))}`);
    await page.screenshot({ path: path.join(SHOTS, `${W}-${name}.png`) }).catch(() => {});
    // La fenêtre ne recouvre pas la barre qui l'a ouverte (ses autres boutons restent atteignables).
    if (noCover) {
      const barBox = await fr.locator(noCover).first().boundingBox().catch(() => null);
      if (barBox) ok(`${tag} : ne recouvre pas la barre`, gapBetween(pop, barBox) > 0 && !(pop.x < barBox.x + barBox.width && pop.x + pop.width > barBox.x && pop.y < barBox.y + barBox.height && pop.y + pop.height > barBox.y), `fenêtre ${JSON.stringify(rd(pop))} / barre ${JSON.stringify(rd(barBox))}`);
    }
    // Défilement de la toile : la fenêtre suit son bouton (s'il reste à l'écran).
    await fr.evaluate((d) => window.scrollBy(0, d), scroll);
    await sleep(600);
    const pop2 = await popup();
    const bb2 = await btn().boundingBox().catch(() => null);
    if (!pop2) ok(`${tag} : après défilement, la fenêtre est toujours là`, false, "fermée par le défilement");
    else if (bb2 && inside(bb2, view)) {
      const gap2 = gapBetween(pop2, bb2);
      ok(`${tag} : après défilement, ≤ ${MAX_GAP} px du bouton et à l'écran`, gap2 <= MAX_GAP && inside(pop2, view), `écart ${Math.round(gap2)} px (fenêtre ${JSON.stringify(rd(pop2))}, bouton ${JSON.stringify(rd(bb2))})`);
    }
    await fr.evaluate((d) => window.scrollBy(0, -d), scroll);
    await sleep(300);
    // Une écriture qui recharge la toile (planche) : la fenêtre se recale sur le bouton retrouvé.
    if (write) {
      const target = fr.locator(write).first();
      const tb = await target.boundingBox();
      if (tb) {
        const tc = centerOf(tb);
        await page.mouse.move(tc.x, tc.y);
        await page.mouse.click(tc.x, tc.y);
        await sleep(3500);
        const pop3 = await popup();
        const bb3 = await btn().boundingBox().catch(() => null);
        if (!pop3) ok(`${tag} : après une écriture (toile rechargée), la fenêtre est toujours là`, false, "fermée");
        else if (bb3) {
          const gap3 = gapBetween(pop3, bb3);
          ok(`${tag} : après une écriture (toile rechargée), ≤ ${MAX_GAP} px du bouton et à l'écran`, gap3 <= MAX_GAP && inside(pop3, view), `écart ${Math.round(gap3)} px (fenêtre ${JSON.stringify(rd(pop3))}, bouton ${JSON.stringify(rd(bb3))})`);
          await page.screenshot({ path: path.join(SHOTS, `${W}-${name}-apres-ecriture.png`) }).catch(() => {});
        }
      }
    }
    if (pointerOutside) {
      await page.mouse.click(view.x + 6, view.y + view.height - 6);
      await sleep(350);
      ok(`${tag} : un clic ailleurs la ferme`, (await popup()) === null);
    } else if (esc) {
      await closeAll();
      ok(`${tag} : Échap la ferme`, (await popup()) === null);
    }
    await closeAll();
  } catch (e) {
    ok(`${tag} : exception`, false, String(e.message).split("\n").slice(0, 4).join(" "));
    await page.screenshot({ path: path.join(SHOTS, `${W}-${name}-ERREUR.png`) }).catch(() => {});
    await closeAll();
  }
}
const rd = (r) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });

/* ---- Les cas ------------------------------------------------------------------------------------------------------------- */
async function cases() {
  const solo = () => fr.locator('[data-edit-block="solo"] img').first();
  const pickSolo = async () => {
    await scrollTo(solo());
    await solo().click();
    await sleep(500);
  };
  const tools = (sel) => fr.locator(`.pe-tools ${sel}`);
  await check("page-cadre", pickSolo, () => tools('[data-testid="frame-button"]'));
  await check("page-fond-image", pickSolo, () => tools('[data-testid="imgbg-button"]'), { pointerOutside: true });
  await check("page-taille", pickSolo, () => tools('[data-testid="size-button"]'));
  await check("page-espace", pickSolo, () => tools('[data-testid="space-button"]'));
  // Lot 66 : le bouton « Carte » n'existe plus (un seul « Fond » : page-fond ci-dessous).
  await check("page-fond", pickSolo, () => tools('[data-testid="fond-button"]'));

  const cell = '[data-edit-block="ga"] img';
  const pickCell = async () => {
    await scrollTo(fr.locator(cell).first());
    await moveOn(fr.locator(cell).first());
    await fr.locator(cell).first().click();
    await sleep(400);
  };
  const cb = (k) => fr.locator(`[data-testid="cellbar"] [data-cb="${k}"]`).first();
  await check("case-cadre", pickCell, () => cb("frame"));
  await check("case-fond-image", pickCell, () => cb("imgbg"));
  await check("case-taille", pickCell, () => cb("size"));

  const bitem = (uid) => fr.locator(`[data-edit-bitem="${uid}"]`).first();
  // La barre d'un composant est en haut de celui-ci : un composant plus haut que l'écran se survole par son haut.
  const hoverItem = (uid) => async () => {
    await bitem(uid).evaluate((el) => el.scrollIntoView({ block: "start" }));
    await fr.evaluate(() => window.scrollBy(0, -70));
    await sleep(400);
    const b = await bitem(uid).boundingBox();
    const y = Math.max(b.y + 30, (await iframeBox()).y + 60);
    await page.mouse.move(b.x + b.width / 2 - 8, y - 4);
    await page.mouse.move(b.x + b.width / 2, y, { steps: 3 });
    await sleep(300);
  };
  const op = (uid, name) => () => bitem(uid).locator(`:scope > .pe-bitem-bar [data-edit-bitem-op="${name}"]`);
  const WRITES = { fond: '[data-testid="fond-menu"] [data-kind="color"]', cadre: '[data-testid="frame-menu"] [data-frame-kind="band"]' };
  for (const [n, o] of [["fond", "fond"], ["taille", "size"], ["espace", "space"], ["cadre", "frame"], ["fond-image", "imgbg"]]) await check(`planche-${n}`, hoverItem("bi"), op("bi", o), { write: WRITES[n] ?? null });
  await check("planche-reglages-grille", hoverItem("bg"), () => bitem("bg").locator(':scope > .pe-bitem-bar [data-grid-settings-button]'));
  const addBtn = () => fr.locator('.pe-bitem-add button').nth(1);
  await check("planche-reglages-grille-bas", async () => {
    await bitem("bg").evaluate((el) => el.scrollIntoView({ block: "start" }));
    await fr.evaluate(() => window.scrollBy(0, -(window.innerHeight * 0.7)));
    await sleep(400);
    const b = await bitem("bg").boundingBox();
    await page.mouse.move(b.x + b.width / 2 - 8, b.y + 30);
    await page.mouse.move(b.x + b.width / 2, b.y + 34, { steps: 3 });
    await sleep(300);
  }, () => bitem("bg").locator(':scope > .pe-bitem-bar [data-grid-settings-button]'));
  await check("planche-ajouter", async () => {
    await scrollTo(addBtn());
    await moveOn(addBtn());
  }, addBtn);
  await check("planche-fond-bande", hoverItem("bs"), op("bs", "fond"));
  // MENU-02 : les boutons de la barre du composant Vidéo ouvrent leurs fenêtres près d'eux, même à 390 px.
  for (const [n, o] of [["fond", "fond"], ["cadre", "frame"]]) await check(`planche-${n}-video`, hoverItem("bv"), op("bv", o));

  const slot = '[data-edit-block="board1"] [data-edit-rail="bc"] > [data-edit-slot]';
  const hoverSlot = async () => {
    await scrollTo(fr.locator(slot).first());
    await moveOn(fr.locator(`${slot} .strip-media`).first());
  };
  await check("carrousel-cadre", hoverSlot, () => fr.locator('.pe-slot-tools [data-testid="slot-frame-button"]'), { noCover: ".pe-slot-tools" });
  await check("carrousel-fond-image", hoverSlot, () => fr.locator('.pe-slot-tools [data-testid="slot-imgbg-button"]'), { noCover: ".pe-slot-tools" });

  const freeItem = (host) => fr.locator(`[data-edit-block="${host}"] .free-item[data-free-item="b"]`).first();
  const pickFree = (host) => async () => {
    await scrollTo(freeItem(host));
    const b = await freeItem(host).boundingBox();
    const c = centerOf(b);
    await page.mouse.click(c.x, c.y);
    await sleep(500);
  };
  await check("libre-cadre", pickFree("free"), () => fr.locator('[data-testid="free-frame-button"]'));
  await check("libre-fond-image", pickFree("free"), () => fr.locator('[data-testid="free-imgbg-button"]'));

  // Collection d'entrées (accueil) : « Taille des images » de la barre du bloc.
  const homeId = q1("select page_id id from blocks where type = 'hero' limit 1")?.id;
  if (homeId) {
    fr = await openEditor(page, BASE, homeId);
    await settled(page);
    const title = () => fr.locator('[data-edit-type="collection-tiles"] h2').first();
    await check("tuiles-taille", async () => {
      await scrollTo(title());
      await title().click();
      await sleep(500);
    }, () => fr.locator('.pe-tools button:has-text("Taille des images")'), { fresh: false });
  }
}

/** Boutons visibles d'une barre : tous dans la fenêtre de la toile, aucun masqué par un autre élément. */
async function barFits(name, sel) {
  const view = await iframeBox();
  const bars = fr.locator(sel);
  const n = await bars.count();
  if (!n) {
    console.log("DBG", await fr.evaluate(() => JSON.stringify({ sel: document.querySelectorAll("[data-free-sel]").length, active: document.activeElement?.tagName, at: [...document.querySelectorAll(".free-item")].map((e) => JSON.stringify(e.getBoundingClientRect())) })));
    await page.screenshot({ path: path.join(SHOTS, `${W}-absente.png`) }).catch(() => {});
    return ok(`${W} ${name} : barre trouvée`, false, "absente");
  }
  const bar = bars.first();
  const bb = await bar.boundingBox();
  ok(`${W} ${name} : barre entièrement à l'écran`, inside(bb, view), `barre ${JSON.stringify(rd(bb))} / vue ${JSON.stringify(rd(view))}`);
  const btns = bar.locator("button");
  const bad = [];
  for (let i = 0; i < (await btns.count()); i++) {
    const b = btns.nth(i);
    const r = await b.boundingBox();
    if (!r || r.width === 0) continue;
    if (!inside(r, view)) bad.push(`${(await b.innerText().catch(() => "")).trim() || i} hors écran`);
    else {
      const top = await b.evaluate((el, [x, y]) => {
        const t = el.ownerDocument.elementsFromPoint(x, y)[0];
        return t === el || el.contains(t) || t?.closest("button") === el;
      }, [r.x + r.width / 2 - view.x, r.y + r.height / 2 - view.y]);
      if (!top) bad.push(`${(await b.innerText().catch(() => "")).trim() || i} masqué`);
    }
  }
  ok(`${W} ${name} : aucun bouton hors écran ni masqué`, bad.length === 0, bad.join(", "));
}
async function bars() {
  const solo = fr.locator('[data-edit-block="solo"] img').first();
  await scrollTo(solo);
  await solo.click();
  await sleep(500);
  await barFits("barre de rubrique", ".pe-tools");
  for (const uid of ["bi", "bg", "bs", "bc", "bfb", "bv"]) {
    const it = fr.locator(`[data-edit-bitem="${uid}"]`).first();
    await it.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await fr.evaluate(() => window.scrollBy(0, -70));
    await sleep(400);
    const b = await it.boundingBox();
    const y = Math.max(b.y + 30, (await iframeBox()).y + 60);
    await page.mouse.move(b.x + b.width / 2 - 8, y - 4);
    await page.mouse.move(b.x + b.width / 2, y, { steps: 3 });
    await sleep(300);
    await barFits(`barre du composant ${uid}`, `[data-edit-bitem="${uid}"] > .pe-bitem-bar`);
  }
  // Planche libre de la page : image de gauche et image de droite.
  for (const id of ["b", "a"]) {
    if (await page.locator(".ve-scrim").count()) {
      await page.locator(".ve-scrim").first().click({ position: { x: 370, y: 300 }, force: true }).catch(() => {});
      await sleep(400);
    }
    const item = fr.locator(`[data-edit-block="free"] .free-item[data-free-item="${id}"]`).first();
    await scrollTo(item);
    const b = await item.boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await sleep(500);
    for (let t = 0; t < 3 && !(await fr.locator('[data-testid="free-bar"]').count()); t++) {
      await sleep(1000);
      await scrollTo(item);
      const b2 = await item.boundingBox();
      await page.mouse.move(b2.x + b2.width / 2 + 5, b2.y + b2.height / 2 + 5);
      await page.mouse.click(b2.x + b2.width / 2, b2.y + b2.height / 2);
      await sleep(600);
    }
    await barFits(`barre de l'image libre ${id}`, '[data-testid="free-bar"]');
  }
  // Téléphone : choisir un composant ouvre le tiroir de l'éditeur : sa feuille fermée n'a rien de focalisable hors écran.
  const sheetClosed = await page.evaluate(() => {
    const btn = [...document.querySelectorAll(".ve-sheet-head button")].find((b) => /Fermer/.test(b.textContent ?? ""));
    return !btn || Boolean(btn.closest("[inert]")) || getComputedStyle(btn).visibility === "hidden";
  });
  ok(`${W} feuille « Composants » fermée : « Fermer » hors écran n'est pas focalisable`, sheetClosed || (await page.locator(".ve-scrim").count()) > 0);
}
if (run("B"))
  for (const w of WIDTHS) {
    W = w;
    await section(`B${w}`, async () => {
      await page.setViewportSize({ width: w, height: w === 390 ? 844 : w === 1024 ? 768 : 900 });
      await open();
      await bars();
    });
  }

/* ---- K. Échap, « Aa » --------------------------------------------------------------------------------------------------- */
if (run("K"))
  await section("K", async () => {
    W = 1440;
    await page.setViewportSize({ width: 1440, height: 900 });
    await open();
    const solo = fr.locator('[data-edit-block="solo"] img').first();
    await scrollTo(solo);
    await solo.click();
    await sleep(500);
    for (const [name, sel] of [["Cadre", '.pe-tools [data-testid="frame-button"]'], ["Fond", '.pe-tools [data-testid="fond-button"]']]) {
      const b = await fr.locator(sel).first().boundingBox();
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      await sleep(500);
      const opened = (await popup()) !== null;
      await page.keyboard.press("Escape");
      await sleep(400);
      ok(`K ${name} : Échap ferme la fenêtre`, opened && (await popup()) === null);
      ok(`K ${name} : …et le bloc reste choisi (sa barre est toujours là)`, (await fr.locator(".pe-tools").count()) === 1 && (await fr.locator(".pe-selected").count()) >= 1);
    }
    // « Aa » : barre de style au bouton, le bouton reste, Échap ne désélectionne pas.
    const homeId = q1("select page_id id from blocks where type = 'hero' limit 1")?.id;
    fr = await openEditor(page, BASE, homeId);
    await settled(page);
    const title = fr.locator('[data-edit-type="collection-tiles"] h2').first();
    await scrollTo(title);
    await title.click();
    await sleep(500);
    const tb = await title.boundingBox();
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 3 });
    await sleep(500);
    const aa = fr.locator(".lk-aa").first();
    if (!(await aa.count())) return ok("K Aa : le bouton apparaît au survol du texte", false, "absent");
    const ab = await aa.boundingBox();
    await page.mouse.click(ab.x + ab.width / 2, ab.y + ab.height / 2);
    await sleep(600);
    const bar = fr.locator(".lk-bar").first();
    const bb = await bar.boundingBox().catch(() => null);
    const ab2 = await aa.boundingBox().catch(() => null);
    const view = await iframeBox();
    ok("K Aa : la barre de style s'ouvre", Boolean(bb));
    if (bb && ab2) {
      // Au bouton ; quand la barre d'outils du bloc occupe ce côté, de l'autre côté du texte (jamais sur la barre d'outils).
      const nearText = gapBetween(bb, tb) <= 40;
      ok("K Aa : à ≤ 16 px du bouton « Aa » (ou à ≤ 40 px du texte, côté libre)", gapBetween(bb, ab2) <= MAX_GAP || nearText, `écart ${Math.round(gapBetween(bb, ab2))} px du bouton, ${Math.round(gapBetween(bb, tb))} px du texte`);
      const tools = await fr.locator(".pe-tools").first().boundingBox().catch(() => null);
      if (tools) ok("K Aa : ne recouvre pas la barre d'outils du bloc", !(bb.x < tools.x + tools.width && bb.x + bb.width > tools.x && bb.y < tools.y + tools.height && bb.y + bb.height > tools.y));
      ok("K Aa : entièrement à l'écran", inside(bb, view), JSON.stringify(rd(bb)));
      ok("K Aa : ne cache pas le texte réglé", gapBetween(bb, tb) > 0 || bb.y + bb.height <= tb.y + 2 || bb.y >= tb.y + tb.height - 2);
    } else ok("K Aa : le bouton « Aa » reste visible quand sa barre est ouverte", false);
    await page.screenshot({ path: path.join(SHOTS, "aa-ouvert.png") }).catch(() => {});
    await page.keyboard.press("Escape");
    await sleep(400);
    ok("K Aa : Échap ferme la barre", (await fr.locator(".lk-bar").count()) === 0);
    ok("K Aa : …et le bloc reste choisi", (await fr.locator(".pe-tools").count()) === 1);
  });

if (run("W")) {
  for (const w of WIDTHS) {
    W = w;
    await section(`W${w}`, async () => {
      await page.setViewportSize({ width: w, height: w === 390 ? 844 : w === 1024 ? 768 : 900 });
      await open();
      await cases();
    });
  }
}

/* ---- R. Police en bas d'écran (R3 de l'artiste), O. barre d'image et fenêtre Fond (recouvrement) ------------------------------ */
if (run("R"))
  for (const w of WIDTHS) {
    W = w;
    await section(`R${w}`, async () => {
      await page.setViewportSize({ width: w, height: w === 390 ? 844 : w === 1024 ? 768 : 900 });
      const homeId = q1("select page_id id from blocks where type = 'hero' limit 1")?.id;
      fr = await openEditor(page, BASE, homeId);
      await settled(page);
      for (const place of ["bas", "haut"]) {
        if (await page.locator(".ve-scrim").count()) {
          await page.locator(".ve-scrim").first().click({ position: { x: 370, y: 300 }, force: true }).catch(() => {});
          await sleep(400);
        }
        const title = fr.locator('[data-edit-type="collection-tiles"] h2').first();
        await title.evaluate((el, pl) => {
          const r = el.getBoundingClientRect();
          window.scrollBy(0, pl === "bas" ? r.top - (window.innerHeight - 70) : r.top - 90);
        }, place);
        await sleep(500);
        await title.click();
        await sleep(500);
        const tb = await title.boundingBox();
        await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 3 });
        await sleep(500);
        const aa = fr.locator(".lk-aa").first();
        if (!(await aa.count())) {
          ok(`R${w} police ${place} : le bouton « Aa » apparaît`, false, "absent");
          continue;
        }
        const ab = await aa.boundingBox();
        await page.mouse.click(ab.x + ab.width / 2, ab.y + ab.height / 2);
        await sleep(600);
        const sy0 = await fr.evaluate(() => window.scrollY);
        await fr.locator(".lk-bar .tc-font").first().click();
        await sleep(700);
        const view = await iframeBox();
        const fm = await fr.locator(".fm").first().boundingBox().catch(() => null);
        const si = await fr.locator(".fm-search").first().boundingBox().catch(() => null);
        if (!fm || !si) {
          ok(`R${w} police ${place} : la liste des polices s'ouvre`, false, "absente");
          await page.screenshot({ path: path.join(SHOTS, `${w}-police-${place}-ERREUR.png`) }).catch(() => {});
          continue;
        }
        ok(`R${w} police ${place} : la fenêtre des polices est entièrement à l'écran`, inside(fm, view), `fenêtre ${JSON.stringify(rd(fm))} / vue ${JSON.stringify(rd(view))}`);
        ok(`R${w} police ${place} : la recherche est visible et libre (rien dessus)`, inside(si, view) && (await fr.evaluate(([x, y]) => document.elementFromPoint(x, y)?.classList.contains("fm-search"), [si.x + si.width / 2 - view.x, si.y + si.height / 2 - view.y])), `recherche ${JSON.stringify(rd(si))}`);
        const sy1 = await fr.evaluate(() => window.scrollY);
        ok(`R${w} police ${place} : la liste a de la hauteur (≥ 120 px) et la page n'a pas défilé`, fm.height >= 120 && sy1 === sy0, `hauteur ${Math.round(fm.height)}, défilement ${sy0} → ${sy1}`);
        await page.screenshot({ path: path.join(SHOTS, `${w}-police-${place}.png`) }).catch(() => {});
        // Elle reste utilisable : on tape dans la recherche (le focus y est) sans que la fenêtre sorte de l'écran.
        await page.keyboard.type("lora", { delay: 20 });
        await sleep(400);
        const fm2 = await fr.locator(".fm").first().boundingBox().catch(() => null);
        ok(`R${w} police ${place} : après une recherche, toujours à l'écran`, Boolean(fm2) && inside(fm2, view));
        await page.keyboard.press("Escape");
        await sleep(300);
        await page.keyboard.press("Escape");
        await sleep(300);
      }
    });
  }
if (run("O"))
  await section("O", async () => {
    W = 1440;
    await page.setViewportSize({ width: 1440, height: 900 });
    await open();
    const solo = fr.locator('[data-edit-block="solo"] img').first();
    // Le bloc est placé à 4 hauteurs de l'écran : la fenêtre Fond (dessous, ou retournée dessus) croise la barre de l'image.
    for (const at of [0.1, 0.35, 0.6, 0.85]) {
      await closeAll();
      await scrollTo(solo);
      await fr.evaluate((frac) => {
        const el = document.querySelector('[data-edit-block="solo"] img');
        const r = el.getBoundingClientRect();
        window.scrollBy(0, r.top - window.innerHeight * frac);
      }, at);
      await sleep(500);
      const ib = await solo.boundingBox();
      const view = await iframeBox();
      const sx = ib.x + ib.width / 2;
      const sy = Math.min(Math.max(ib.y + ib.height / 2, view.y + 40), view.y + view.height - 40);
      await page.mouse.click(sx, sy);
      await sleep(500);
      const fbtn = fr.locator('.pe-tools [data-testid="fond-button"]').first();
      const fb = await fbtn.boundingBox();
      if (!fb) {
        ok(`O ${at} : bouton Fond trouvé`, false, "absent");
        continue;
      }
      await page.mouse.click(fb.x + fb.width / 2, fb.y + fb.height / 2);
      await sleep(600);
      // « Papier peint » : le panneau Fond devient long et descend sur la barre de l'image (retour de l'artiste, vidéo 2).
      const wpb = fr.locator('.pe-pop [data-kind="wallpaper"]').first();
      if (await wpb.count()) {
        await wpb.click();
        await sleep(2500);
      }
      const pop = await popup();
      if (!pop) {
        ok(`O ${at} : fenêtre Fond ouverte`, false, "absente");
        continue;
      }
      // La souris revient sur l'image (hors de la fenêtre) : la barre d'image se montre pendant que la fenêtre Fond reste ouverte.
      for (const [fx, fy] of [[0.15, 0.3], [0.85, 0.3], [0.5, 0.85], [0.15, 0.85], [0.5, 0.5]]) {
        const x = ib.x + ib.width * fx;
        const y = ib.y + ib.height * fy;
        if (x > pop.x - 2 && x < pop.x + pop.width + 2 && y > pop.y - 2 && y < pop.y + pop.height + 2) continue;
        if (y < view.y + 4 || y > view.y + view.height - 4) continue;
        await page.mouse.move(x - 5, y - 3);
        await page.mouse.move(x, y, { steps: 3 });
        await sleep(250);
      }
      ok(`O ${at} : la fenêtre Fond reste ouverte quand la souris passe sur l'image`, (await popup()) !== null);
      const res = await fr.evaluate(() => {
        const pop = document.querySelector(".pe-pop");
        if (!pop) return null;
        const pr = pop.getBoundingClientRect();
        const out = [];
        for (const bar of document.querySelectorAll(".pe-tools, .pe-slot-tools, .pe-media-tools, .pe-bitem-bar, .pe-cellbar, .pe-item-tools, .pe-tile-tools, .pe-markbar, .lk-pos, .lk-aa, .lk-crop-btn, .pe-pending")) {
          if (pop.contains(bar)) continue;
          const kids = [bar, ...bar.querySelectorAll("button")];
          for (const k of kids) {
            const b = k.getBoundingClientRect();
            const x0 = Math.max(b.left, pr.left);
            const x1 = Math.min(b.right, pr.right);
            const y0 = Math.max(b.top, pr.top);
            const y1 = Math.min(b.bottom, pr.bottom);
            if (x1 - x0 < 4 || y1 - y0 < 4) continue;
            const t = document.elementFromPoint((x0 + x1) / 2, (y0 + y1) / 2);
            if (t && !pop.contains(t)) out.push(`${String(bar.className).slice(0, 30)}>${k === bar ? "barre" : (k.textContent ?? "").trim().slice(0, 14)}`);
          }
        }
        return out;
      });
      console.log(`INFO O ${at} : recouvrements de la fenêtre Fond par une barre :`, JSON.stringify(res));
      ok(`O ${at} : aucune barre ne passe PAR-DESSUS la fenêtre Fond`, res !== null && res.length === 0, JSON.stringify(res));
      await page.screenshot({ path: path.join(SHOTS, `fond-et-barre-image-${at}.png`) }).catch(() => {});
    }
    // Sondes d'empilement : une barre de CHAQUE classe posée exactement au centre de la fenêtre Fond ouverte (comme les vraies barres,
    // dans leur couche) ne doit jamais être au-dessus d'elle. Le cas des barres d'image réelles dépend de la taille de l'image.
    const stack = await fr.evaluate((classes) => {
      const pop = document.querySelector(".pe-pop");
      if (!pop) return null;
      const pr = pop.getBoundingClientRect();
      const host = document.querySelector(".pe-host") ?? document.body;
      const out = [];
      for (const cls of classes) {
        const layer = document.createElement("div");
        layer.className = "pe-layer";
        const el = document.createElement("div");
        el.className = cls.split(".").filter(Boolean).join(" ");
        el.style.cssText = `position:absolute;left:${pr.left + window.scrollX + 20}px;top:${pr.top + window.scrollY + 20}px;width:60px;height:30px;pointer-events:auto;visibility:visible`;
        el.append(document.createElement("button"));
        layer.append(el);
        host.append(layer);
        const t = document.elementFromPoint(pr.left + 30, pr.top + 30);
        out.push({ cls, over: Boolean(t && !pop.contains(t)) });
        layer.remove();
      }
      // Barre de composant : dans le contenu de la planche (z-index propre à la rubrique).
      const item = document.querySelector("[data-edit-bitem]");
      if (item) {
        const el = document.createElement("div");
        el.className = "pe-bitem-bar";
        el.style.cssText = `position:fixed;left:${pr.left + 20}px;top:${pr.top + 20}px;width:60px;height:30px;pointer-events:auto`;
        item.append(el);
        const t = document.elementFromPoint(pr.left + 30, pr.top + 30);
        out.push({ cls: ".pe-bitem-bar (contenu)", over: Boolean(t && !pop.contains(t)) });
        el.remove();
      }
      return out;
    }, [".pe-tools", ".pe-slot-tools", ".pe-slot-tools.pe-media-tools", ".pe-cellbar", ".pe-item-tools", ".pe-tile-tools", ".pe-markbar", ".lk-pos", ".lk-aa", ".lk-crop-btn", ".pe-cell-badge", ".pe-pending"]);
    ok("O sondes : aucune barre posée sur la fenêtre Fond ne passe au-dessus d'elle", stack !== null && stack.every((r) => !r.over), JSON.stringify(stack?.filter((r) => r.over)));
    await closeAll();
  });

if (run("O"))
  await section("O-panorama", async () => {
    W = 1440;
    await page.setViewportSize({ width: 1440, height: 900 });
    // Image courte (panorama) : la fenêtre sous la barre du bloc croise la barre de l'image (Remplacer, Retirer, Cadrer).
    resetPage();
    setDraft(pageId, [img("solo", M.panorama), img("solo2", M.paysage), FREE("free")]);
    fr = await openEditor(page, BASE, pageId);
    await settled(page);
    const solo = fr.locator('[data-edit-block="solo"] img').first();
    // Le bloc est placé à 4 hauteurs de l'écran : la fenêtre Fond (dessous, ou retournée dessus) croise la barre de l'image.
    for (const at of [0.1, 0.35, 0.6, 0.85]) {
      await closeAll();
      await scrollTo(solo);
      await fr.evaluate((frac) => {
        const el = document.querySelector('[data-edit-block="solo"] img');
        const r = el.getBoundingClientRect();
        window.scrollBy(0, r.top - window.innerHeight * frac);
      }, at);
      await sleep(500);
      const ib = await solo.boundingBox();
      const view = await iframeBox();
      const sx = ib.x + ib.width / 2;
      const sy = Math.min(Math.max(ib.y + ib.height / 2, view.y + 40), view.y + view.height - 40);
      await page.mouse.click(sx, sy);
      await sleep(500);
      const fbtn = fr.locator('.pe-tools [data-testid="fond-button"]').first();
      const fb = await fbtn.boundingBox();
      if (!fb) {
        ok(`O panorama ${at} : bouton Fond trouvé`, false, "absent");
        continue;
      }
      await page.mouse.click(fb.x + fb.width / 2, fb.y + fb.height / 2);
      await sleep(600);
      // « Papier peint » : le panneau Fond devient long et descend sur la barre de l'image (retour de l'artiste, vidéo 2).
      const wpb = fr.locator('.pe-pop [data-kind="wallpaper"]').first();
      if (await wpb.count()) {
        await wpb.click();
        await sleep(2500);
      }
      const pop = await popup();
      if (!pop) {
        ok(`O panorama ${at} : fenêtre Fond ouverte`, false, "absente");
        continue;
      }
      // La souris revient sur l'image (hors de la fenêtre) : la barre d'image se montre pendant que la fenêtre Fond reste ouverte.
      for (const [fx, fy] of [[0.15, 0.3], [0.85, 0.3], [0.5, 0.85], [0.15, 0.85], [0.5, 0.5]]) {
        const x = ib.x + ib.width * fx;
        const y = ib.y + ib.height * fy;
        if (x > pop.x - 2 && x < pop.x + pop.width + 2 && y > pop.y - 2 && y < pop.y + pop.height + 2) continue;
        if (y < view.y + 4 || y > view.y + view.height - 4) continue;
        await page.mouse.move(x - 5, y - 3);
        await page.mouse.move(x, y, { steps: 3 });
        await sleep(250);
      }
      ok(`O panorama ${at} : la fenêtre Fond reste ouverte quand la souris passe sur l'image`, (await popup()) !== null);
      const res = await fr.evaluate(() => {
        const pop = document.querySelector(".pe-pop");
        if (!pop) return null;
        const pr = pop.getBoundingClientRect();
        const out = [];
        for (const bar of document.querySelectorAll(".pe-tools, .pe-slot-tools, .pe-media-tools, .pe-bitem-bar, .pe-cellbar, .pe-item-tools, .pe-tile-tools, .pe-markbar, .lk-pos, .lk-aa, .lk-crop-btn, .pe-pending")) {
          if (pop.contains(bar)) continue;
          const kids = [bar, ...bar.querySelectorAll("button")];
          for (const k of kids) {
            const b = k.getBoundingClientRect();
            const x0 = Math.max(b.left, pr.left);
            const x1 = Math.min(b.right, pr.right);
            const y0 = Math.max(b.top, pr.top);
            const y1 = Math.min(b.bottom, pr.bottom);
            if (x1 - x0 < 4 || y1 - y0 < 4) continue;
            const t = document.elementFromPoint((x0 + x1) / 2, (y0 + y1) / 2);
            if (t && !pop.contains(t)) out.push(`${String(bar.className).slice(0, 30)}>${k === bar ? "barre" : (k.textContent ?? "").trim().slice(0, 14)}`);
          }
        }
        return out;
      });
      console.log(`INFO O panorama ${at} : recouvrements de la fenêtre Fond par une barre :`, JSON.stringify(res));
      ok(`O panorama ${at} : aucune barre ne passe PAR-DESSUS la fenêtre Fond`, res !== null && res.length === 0, JSON.stringify(res));
      await page.screenshot({ path: path.join(SHOTS, `fond-et-barre-image-${at}.png`) }).catch(() => {});
    }
    await closeAll();
  });

if (run("O"))
  await section("O-planche", async () => {
    W = 1440;
    await page.setViewportSize({ width: 1440, height: 900 });
    await open();
    const bitem = (uid) => fr.locator(`[data-edit-bitem="${uid}"]`).first();
    // Composant de planche : la fenêtre Fond (ouverte par la barre du composant) croise la barre de son image (Remplacer, Cadrer…).
    for (const [uid, op, pick] of [["bi", "fond", false], ["bi", "fond", true], ["bi", "size", true], ["bi", "frame", true]]) {
      await closeAll();
      await bitem(uid).evaluate((el) => el.scrollIntoView({ block: "start" }));
      await fr.evaluate(() => window.scrollBy(0, -70));
      await sleep(400);
      const b = await bitem(uid).boundingBox();
      const view = await iframeBox();
      const y = Math.max(b.y + 30, view.y + 60);
      await page.mouse.move(b.x + b.width / 2 - 8, y - 4);
      await page.mouse.move(b.x + b.width / 2, y, { steps: 3 });
      await sleep(300);
      // L'image est d'abord choisie : sa barre (Remplacer, Cadrer…) est montrée quand la fenêtre s'ouvre.
      if (pick) {
        const im = await bitem(uid).locator("img").first().boundingBox();
        await page.mouse.click(im.x + im.width / 2, Math.min(im.y + im.height / 2, view.y + view.height - 60));
        await sleep(500);
        const y2 = Math.max(b.y + 30, view.y + 60);
        await page.mouse.move(b.x + b.width / 2 - 8, y2 - 4);
        await page.mouse.move(b.x + b.width / 2, y2, { steps: 3 });
        await sleep(300);
      }
      const btn = bitem(uid).locator(`:scope > .pe-bitem-bar [data-edit-bitem-op="${op}"]`);
      const bb = await btn.boundingBox();
      if (!bb) {
        ok(`O planche ${uid} ${op}${pick ? " (image choisie)" : ""} : bouton trouvé`, false, "absent");
        continue;
      }
      await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await sleep(600);
      const pop = await popup();
      if (!pop) {
        ok(`O planche ${uid} ${op}${pick ? " (image choisie)" : ""} : fenêtre ouverte`, false, "absente");
        continue;
      }
      const ib = await bitem(uid).locator("img").first().boundingBox();
      for (const [fx, fy] of [[0.15, 0.3], [0.85, 0.3], [0.5, 0.85], [0.15, 0.85], [0.5, 0.5], [0.1, 0.1], [0.9, 0.9]]) {
        const x = ib.x + ib.width * fx;
        const yy = ib.y + ib.height * fy;
        if (x > pop.x - 2 && x < pop.x + pop.width + 2 && yy > pop.y - 2 && yy < pop.y + pop.height + 2) continue;
        if (yy < view.y + 4 || yy > view.y + view.height - 4) continue;
        await page.mouse.move(x - 5, yy - 3);
        await page.mouse.move(x, yy, { steps: 3 });
        await sleep(250);
      }
      ok(`O planche ${uid} ${op}${pick ? " (image choisie)" : ""} : la fenêtre reste ouverte quand la souris passe sur l'image`, (await popup()) !== null);
      const res = await fr.evaluate(() => {
        const pop = document.querySelector(".pe-pop");
        if (!pop) return null;
        const pr = pop.getBoundingClientRect();
        const out = [];
        for (const bar of document.querySelectorAll(".pe-tools, .pe-slot-tools, .pe-media-tools, .pe-bitem-bar, .pe-cellbar, .pe-item-tools, .pe-tile-tools, .pe-markbar, .lk-pos, .lk-aa, .lk-crop-btn, .pe-pending")) {
          if (pop.contains(bar)) continue;
          for (const k of [bar, ...bar.querySelectorAll("button")]) {
            const r = k.getBoundingClientRect();
            const x0 = Math.max(r.left, pr.left);
            const x1 = Math.min(r.right, pr.right);
            const y0 = Math.max(r.top, pr.top);
            const y1 = Math.min(r.bottom, pr.bottom);
            if (x1 - x0 < 4 || y1 - y0 < 4) continue;
            const t = document.elementFromPoint((x0 + x1) / 2, (y0 + y1) / 2);
            if (t && !pop.contains(t)) out.push(`${String(bar.className).slice(0, 30)}>${k === bar ? "barre" : (k.textContent ?? "").trim().slice(0, 14)}`);
          }
        }
        return out;
      });
      console.log(`INFO O planche ${uid} ${op}${pick ? " (image choisie)" : ""} : recouvrements :`, JSON.stringify(res));
      ok(`O planche ${uid} ${op}${pick ? " (image choisie)" : ""} : aucune barre ne passe PAR-DESSUS la fenêtre`, res !== null && res.length === 0, JSON.stringify(res));
      await page.screenshot({ path: path.join(SHOTS, `planche-${uid}-${op}${pick ? "-choisie" : ""}-barre-image.png`) }).catch(() => {});
    }
    await closeAll();
  });

/* ---- D. Barres claires --------------------------------------------------------------------------------------------------- */
const BARS = [
  [".pe-tools", ""],
  [".pe-slot-tools", ""],
  [".pe-slot-tools.pe-media-tools", ""],
  [".pe-cellbar", ""],
  [".pe-layouts", ""],
  [".pe-item-tools", ""],
  [".pe-tile-tools", ""],
  [".pe-tile-cover", ""],
  [".pe-markbar", ""],
  [".pe-project-hint", ""],
  [".pe-bitem-bar", ""],
  [".lk-pos", ""],
  [".lk-aa", ""],
  [".lk-crop-btn", ""],
  [".lk-bar", ""],
  [".pe-pending", ""],
  [".pe-ghost", ""],
  [".pe-cell-badge", ""],
  [".pe-cell-ghost", ""],
];
if (run("D"))
  await section("D", async () => {
    await page.setViewportSize({ width: 1440, height: 900 });
    W = 1440;
    await open();
    // Sondes : un élément de chaque classe, posé comme sur la toile (barre + un bouton), couleur de fond calculée.
    const res = await fr.evaluate((bars) => {
      const out = [];
      const host = document.querySelector(".pe-host") ?? document.body;
      for (const [sel] of bars) {
        const classes = sel.split(".").filter(Boolean);
        const el = document.createElement("div");
        el.className = classes.join(" ");
        el.style.cssText = "position:fixed;left:0;top:0;opacity:1;pointer-events:none;visibility:hidden";
        const holder = sel === ".pe-bitem-bar" ? document.body : host;
        const btn = document.createElement("button");
        btn.textContent = "x";
        btn.type = "button";
        el.append(btn);
        holder.append(el);
        const cs = getComputedStyle(el);
        const bs = getComputedStyle(btn);
        out.push({ sel, bg: cs.backgroundColor, color: bs.color, bbg: bs.backgroundColor });
        el.remove();
      }
      return out;
    }, BARS);
    for (const r of res) {
      const bg = parse(r.bg);
      const color = parse(r.color);
      const light = bg[3] >= 0.9 && lum(bg) > 0.6;
      ok(`D ${r.sel} : fond clair (${r.bg})`, light, r.bg);
      if (light) ok(`D ${r.sel} : texte des boutons lisible (${r.color} sur ${r.bg})`, ratio(color, bg) >= 4.5, `${ratio(color, bg).toFixed(1)}`);
    }
    // Barres réellement visibles.
    const probe = async (sel) => {
      const info = await fr.locator(sel).first().evaluate((el) => {
        const cs = getComputedStyle(el);
        const b = el.querySelector("button");
        return { bg: cs.backgroundColor, color: b ? getComputedStyle(b).color : cs.color };
      }).catch(() => null);
      if (!info) return ok(`D ${sel} visible : trouvée`, false, "absente");
      const bg = parse(info.bg);
      ok(`D ${sel} visible : fond clair`, bg[3] >= 0.9 && lum(bg) > 0.6, info.bg);
      ok(`D ${sel} visible : texte lisible`, ratio(parse(info.color), bg) >= 4.5, `${info.color} sur ${info.bg}`);
    };
    const solo = fr.locator('[data-edit-block="solo"] img').first();
    await scrollTo(solo);
    await solo.click();
    await sleep(500);
    await probe(".pe-tools");
    const slotSel = '[data-edit-block="board1"] [data-edit-rail="bc"] > [data-edit-slot]';
    await scrollTo(fr.locator(slotSel).first());
    await moveOn(fr.locator(`${slotSel} .strip-media`).first());
    await probe(".pe-slot-tools");
    await page.screenshot({ path: path.join(SHOTS, "barre-carrousel.png") }).catch(() => {});
    const bi = fr.locator('[data-edit-bitem="bi"]').first();
    await scrollTo(bi);
    await moveOn(bi);
    await probe(".pe-bitem-bar");
    await page.screenshot({ path: path.join(SHOTS, "barre-planche.png") }).catch(() => {});
    const cell = fr.locator('[data-edit-block="ga"] img').first();
    await scrollTo(cell);
    await moveOn(cell);
    await probe(".pe-cellbar");
    const fi = fr.locator('[data-edit-block="free"] .free-item[data-free-item="b"]').first();
    await scrollTo(fi);
    const b = await fi.boundingBox();
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await sleep(500);
    await probe(".pe-slot-tools");
    await page.screenshot({ path: path.join(SHOTS, "barre-libre.png") }).catch(() => {});
  });

ok("aucune erreur JavaScript dans la page de l'éditeur", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\nOK");
process.exit(failures ? 1 : 0);
