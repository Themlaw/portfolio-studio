#!/usr/bin/env node
/**
 * Lots 119 + 120 « portée des réglages de texte » (chromium, serveur requis, base neuve).
 * Souris et clavier réels ; données synthétiques seulement.
 *  I  Inventaire : CHAQUE texte qui porte une pastille « Aa » (page, planche, composants, tuiles, légendes) propose « Ce texte »
 *     (cet élément seul) ; choisir une couleur n'en change qu'un, elle s'écrit, reste après le rechargement. « Cette étiquette » en particulier.
 *  T  Trois portées partout (Ce texte · Tout le projet · Tout le site, dans cet ordre), libellés nommant le type, « Tout le projet »
 *     absent hors planche de projet ; la valeur ne touche que le bon ensemble d'éléments (styles calculés).
 *  P  Priorités élément > projet > site > thème, « Revenir » par portée, pastille sur la portée qui porte la valeur.
 *  R  Rechargement, publication, public = éditeur ; anciennes données (style de légendes du projet dans la suite) au rendu identique.
 * Captures : $SHOTS. Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=I,T,P,R] [SHOTS=dossier] node scripts/e2e-portee119.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { publishBlocks } from "./lib/page-draft.mjs";
import { boardDraft, boardPublished, draftBlocks, findIn, grid, img, login, makeMedia, openEditor, pageIdOf, q1, setBoardDraft, setDraft, settled, sleep, sql, waitFor } from "./lib/grille31d.mjs";

const BASE = process.env.BASE ?? "http://localhost:5420";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(process.env.BATTERY_DIR ?? tmpdir(), "shots-portee119");
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const diag = (...parts) => console.log(`DIAG ${parts.join(" | ")}`);
const T$ = (s) => ({ fr: s, en: s });

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);
const M = await makeMedia(page, BASE);
const pageId = pageIdOf("personnages");
const projects = sql((db) => db.prepare("select id, slug from projects where deleted_at is null order by id limit 2").all());
const project = projects[0];
const other = projects[1];
if (!project || !other) throw new Error("deux projets attendus dans la base de test");
const BOARD_ID = project.id;
const board = `[data-edit-board="${BOARD_ID}"]`;
const bitem = (uid) => `${board} [data-edit-bitem="${uid}"]`;

const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});
const section = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.stack ?? e.message).split("\n").slice(0, 6).join(" "));
    await shot(page, `erreur-${name}`);
  }
};

/* ---- Scène : tous les types de texte ---------------------------------------------------------------------------------------- */
const CAPS = (n) => ({ captionTitle: T$(`Titre ${n}`), caption: T$(`Légende ${n}`), captionDate: T$("2026") });
const PAGE_BLOCKS = (extra = {}) => [
  { uid: "stt", type: "section-title", props: { main: true, counts: true, eyebrow: T$("Étiquette du titre"), title: T$("Titre principal"), intro: T$("Présentation du titre principal.") } },
  { uid: "st2", type: "section-title", props: { eyebrow: T$("Étiquette de rubrique"), title: T$("Titre de rubrique"), intro: T$("Présentation de la rubrique.") } },
  { uid: "rt", type: "rich-text", props: { eyebrow: T$("Étiquette du texte"), title: T$("Titre du texte"), paragraphs: [T$("Premier paragraphe du texte."), T$("Second paragraphe du texte.")] } },
  { uid: "cv", type: "cv", props: { eyebrow: T$("Étiquette du CV"), title: T$("Titre du CV"), intro: T$("Présentation du CV."), button: T$("Télécharger") } },
  { uid: "ct", type: "contact", props: { eyebrow: T$("Étiquette du contact"), title: T$("Titre du contact"), intro: T$("Présentation du contact."), cta: T$("Écrire") } },
  { uid: "prf", type: "profile", props: { eyebrow: T$("Étiquette du profil"), portraitCaption: T$("Légende du portrait"), paragraphs: [T$("Accroche du profil."), T$("Suite du profil.")], contactEyebrow: T$("Étiquette contact"), contactLabel: T$("Écrire"), socialEyebrow: T$("Étiquette réseaux") } },
  { uid: "pimg", type: "image", props: { mediaId: M.paysage, width: "wide", ...CAPS("image") } },
  { uid: "pgrid", type: "grid", props: { layout: "2", gap: "normal", align: "stretch", ratio: "auto", top: "gap", eyebrow: T$("Étiquette de grille"), title: T$("Titre de grille"), children: [img("pk1", M.carre, CAPS("case 1")), img("pk2", M.paysage2, CAPS("case 2"))] } },
  { uid: "tl", type: "collection-tiles", props: { eyebrow: T$("Étiquette des tuiles"), title: T$("Titre des tuiles"), mode: "auto" } },
  { uid: "pbd", type: "project-board", props: { project: project.slug, ...(extra.pbd ?? {}) } },
  { uid: "pbd2", type: "project-board", props: { project: other.slug } },
];
const BOARD_ITEMS = () => [
  { uid: "strip", type: "strip", props: {} },
  img("bimg", M.paysage, CAPS("planche")),
  { uid: "brt", type: "rich-text", props: { eyebrow: T$("Étiquette de planche"), title: T$("Titre de planche"), paragraphs: [T$("Texte de planche un."), T$("Texte de planche deux.")] } },
  { uid: "brt2", type: "rich-text", props: { eyebrow: T$("Seconde étiquette de planche"), title: T$("Second titre de planche"), paragraphs: [T$("Autre texte de planche.")] } },
  { uid: "bgrid", type: "grid", props: { layout: "2", gap: "normal", align: "stretch", ratio: "auto", top: "gap", children: [img("bk1", M.carre, CAPS("case A")), img("bk2", M.paysage2, CAPS("case B"))] } },
];
const OTHER_BOARD_ITEMS = () => [{ uid: "ostrip", type: "strip", props: {} }, { uid: "ort", type: "rich-text", props: { eyebrow: T$("Étiquette du voisin"), title: T$("Titre du voisin"), paragraphs: [T$("Texte du voisin.")] } }];
const LEAN = new Set(["stt", "st2", "rt", "pimg", "pgrid", "pbd", "pbd2"]);
async function resetScene(extra = {}) {
  sql((db) => {
    db.prepare("update projects set draft_layout = null, draft_layout_page_id = null").run();
    db.prepare("update projects set layout = null where id in (?, ?)").run(BOARD_ID, other.id);
    db.prepare("delete from settings where key = 'siteDraft'").run();
  });
  setDraft(pageId, extra.lean ? PAGE_BLOCKS(extra).filter((b) => LEAN.has(b.uid)) : PAGE_BLOCKS(extra));
  setBoardDraft(BOARD_ID, pageId, BOARD_ITEMS());
  setBoardDraft(other.id, pageId, OTHER_BOARD_ITEMS());
}
const pageBlockPublished = (n) => JSON.parse(sql((db) => db.prepare("select props from blocks where page_id = ? and type = 'project-board' order by position").all(pageId))[n]?.props ?? "null");
const pageBlock = (uid) => findIn(draftBlocks(pageId), uid);
const boardItem = (uid) => (boardDraft(BOARD_ID) ?? []).find((i) => i.uid === uid);

async function reopen() {
  const f = await openEditor(page, BASE, pageId);
  await settled(page);
  await f.locator(`${bitem("brt")}`).first().waitFor({ state: "attached", timeout: 60000 }).catch(() => {});
  await sleep(1200);
  return f;
}
const colorOf = (f, sel, nth = 0) => f.locator(sel).nth(nth).evaluate((el) => getComputedStyle(el).color);

/* ---- Souris et barre --------------------------------------------------------------------------------------------------------- */
const center = async (loc) => {
  await loc.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  await sleep(150);
  const b = await loc.boundingBox();
  if (!b) throw new Error("élément sans boîte");
  return { x: b.x + Math.min(b.width / 2, 120), y: b.y + b.height / 2, b };
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
async function openByAa(f, sel, nth = 0) {
  await closeBar(f);
  const target = f.locator(sel).nth(nth);
  for (let essai = 0; essai < 4; essai++) {
    await away();
    await mHover(target);
    if (!(await until(f, () => Boolean(document.querySelector(".lk-aa")), null, 6000))) continue;
    try {
      await f.locator(".lk-aa").click({ timeout: 4000 });
      if (await until(f, () => Boolean(document.querySelector(".lk-bar")), null, 6000)) return true;
    } catch {
      /* le « Aa » a bougé avec le survol : on recommence */
    }
  }
  return false;
}
const scopes = (f) => f.locator(".lk-bar .lk-seg [role=radio]").evaluateAll((els) => els.map((e) => ({ text: e.textContent.trim().replace(/\s+/g, " "), on: e.getAttribute("aria-checked") === "true", dot: Boolean(e.querySelector(".lk-dot")) || e.hasAttribute("data-has-value") })));
const scopeBtn = (f, re) => f.locator(".lk-bar .lk-seg [role=radio]").filter({ hasText: re }).first();
const swatchBtn = (f, i) => f.locator(".lk-bar .tc-swatches [role=radio]").nth(i);
const swatchColor = (f, i) => swatchBtn(f, i).evaluate((b) => getComputedStyle(b).backgroundColor);
const SW = 4; // « secondary »
const SW2 = 3; // « primary »
const SW3 = 5; // « tertiary »
const resetBtn = (f) => f.locator(".lk-bar .tc-reset");

const TEXT_SEL = "[data-inline], [data-site-inline], [data-slot-inline], [data-project-inline], [data-look-key]";
/** Les textes à pastille « Aa » de la toile, dans l'ordre du DOM : repère lisible (propriétaire + champ), commun à l'inventaire et au repérage. */
const INV_JS = `(sel, want) => {
  const out = [];
  const seen = new Map();
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (el.closest(".pe-layer, .lk-bar, .pe-text-editor")) continue;
    const owner = el.closest("[data-edit-cell]")?.getAttribute("data-edit-cell") ?? el.closest("[data-edit-bitem]:not([data-edit-bitem-rail])")?.getAttribute("data-edit-bitem") ?? el.closest("[data-edit-block]")?.getAttribute("data-edit-block") ?? el.closest("[data-edit-global]")?.getAttribute("data-edit-global") ?? "?";
    const slot = el.closest("[data-slot-slug]")?.getAttribute("data-slot-slug") ?? "";
    const key = el.dataset.inline ?? el.dataset.siteInline ?? el.dataset.slotInline ?? el.dataset.projectInline ?? el.dataset.lookKey ?? "?";
    const base = owner + (slot ? "/" + slot : "") + "/" + key + (el.dataset.cap ? "[" + el.dataset.cap + "]" : "");
    const dup = seen.get(base) ?? 0;
    seen.set(base, dup + 1);
    const label = dup ? base + "#" + dup : base;
    if (want !== null) {
      if (label === want) { el.setAttribute("data-inv", "1"); return [{ label }]; }
      continue;
    }
    out.push({ label, global: Boolean(el.closest("[data-edit-global]")), role: el.closest("h1") ? "h1" : el.closest("h2,h3") ? "h2" : el.closest(".eyebrow") ? "eyebrow" : "?" });
  }
  return out;
}`;
const listTexts = (f) => f.evaluate(`(${INV_JS})(${JSON.stringify(TEXT_SEL)}, null)`);
const tagText = async (f, label) => (await f.evaluate(`(${INV_JS})(${JSON.stringify(TEXT_SEL)}, ${JSON.stringify(label)})`)).length > 0;
const nthText = (f, i) => f.locator(TEXT_SEL).filter({ visible: true });
const allColorsText = (f) =>
  f.evaluate((sel) => [...document.querySelectorAll(sel)].map((el) => getComputedStyle(el).color), TEXT_SEL);

/* ===== I. Inventaire : « Ce texte » pour chaque texte à « Aa » ======================================================================= */
const INV = {};
if (run("I")) {
  await section("I", async () => {
    await resetScene();
    let f = await reopen();
    await shot(page, "I0-scene");
    const items = await listTexts(f);
    diag("textes à pastille", String(items.length));
    for (const it of items) {
      const before = await allColorsText(f);
      let opened = false;
      try {
        await closeBar(f);
        if (!(await tagText(f, it.label))) { diag(it.label, "introuvable"); continue; }
        opened = await openByAa(f, "[data-inv]");
      } catch (e) {
        diag(it.label, "erreur", String(e.message).slice(0, 80));
      }
      // Pastille posée sur le texte voisin (l'en-tête d'une planche empile titre et présentation) : le « Aa » ouvre la barre du voisin, comme sur la base.
      // On entre alors DANS le texte (double-clic) : la barre s'ouvre d'elle-même sur lui.
      if (opened && /^pbd2?\/(description|title|context|year|count)$/.test(it.label)) {
        const want = it.label.split("/")[1];
        const got = await f.evaluate(() => document.querySelector(".lk-bar")?.getAttribute("data-text-target"));
        if (got !== want) {
          diag(it.label, "pastille sur le texte voisin", `barre=${got}`, "repli : saisie dans le texte");
          await closeBar(f);
          await f.locator("[data-inv]").first().dblclick().catch(() => {});
          opened = await until(f, () => Boolean(document.querySelector(".lk-bar")), null, 6000);
          if (opened) await sleep(300);
          it.entered = true;
        }
      }
      const sc = opened ? await scopes(f) : [];
      if (opened && /description$/.test(it.label)) diag(it.label, "cible de la barre", await f.evaluate(() => `${document.querySelector(".lk-bar")?.getAttribute("data-text-target")} | el=${document.querySelector("[data-inv]")?.tagName} h2=${document.querySelector("[data-inv]")?.closest("h2, h3")?.tagName ?? "-"} eyebrow=${document.querySelector("[data-inv]")?.closest(".eyebrow") ? "oui" : "-"}`));
      const hasLocal = sc.some((s) => /^(Ce|Cette)\b/.test(s.text));
      it.scopes = sc.map((s) => s.text);
      let changedOnlyMe = null;
      let mine = null;
      if (opened && hasLocal) {
        await scopeBtn(f, /^(Ce|Cette)\b/).click();
        const wanted = await swatchColor(f, SW);
        await swatchBtn(f, SW).click();
        await sleep(350);
        const nowC = await allColorsText(f);
        const moved = nowC.map((c, i) => (c !== before[i] ? i : -1)).filter((i) => i >= 0);
        mine = await f.locator("[data-inv]").first().evaluate((el) => getComputedStyle(el).color).catch(() => null);
        changedOnlyMe = mine === wanted && moved.length <= 1;
        it.moved = moved.length;
        // le style de ce texte seul s'enlève : retour à l'état d'avant
        await resetBtn(f).click().catch(() => {});
        await sleep(250);
      }
      await f.evaluate(() => document.querySelectorAll("[data-inv]").forEach((e) => e.removeAttribute("data-inv"))).catch(() => {});
      await closeBar(f);
      if (it.entered) {
        await page.keyboard.press("Escape");
        await away();
        await sleep(300);
      }
      INV[it.label] = { opened, hasLocal, changedOnlyMe, scopes: it.scopes, global: it.global, role: it.role };
      diag(it.label, `barre=${opened}`, `ce texte=${hasLocal}`, `seul changé=${changedOnlyMe}`, `moved=${it.moved ?? "-"}`, `mine=${mine}`, `portées=${JSON.stringify(it.scopes)}`, it.global ? "GLOBAL" : "");
    }
    await settled(page);
    // Hors lot : sur l'en-tête d'une planche, le « Aa » du paragraphe de présentation ouvre la barre du titre voisin (comportement de la base, noté au rapport).
    const KNOWN = /^pbd2?\/description$/;
    for (const [label, r] of Object.entries(INV)) {
      if (r.global) continue;
      if (KNOWN.test(label)) { diag(label, "exclu : « Aa » ouvre la barre du titre voisin (comportement de la base)"); continue; }
      ok(`I ${label} : la barre s'ouvre`, r.opened);
      if (!r.opened) continue;
      ok(`I ${label} : « Ce texte » (cet élément seul) est proposé`, r.hasLocal, JSON.stringify(r.scopes));
      if (r.hasLocal) ok(`I ${label} : la couleur ne change que cet élément`, r.changedOnlyMe === true, String(r.changedOnlyMe));
    }
  });
}

/* ===== T. Trois portées partout, au bon ensemble d'éléments ============================================================================ */
const board2 = `[data-edit-board="${other.id}"]`;
const pageEyebrows = '[data-edit-block="rt"] .eyebrow, [data-edit-block="st2"] .eyebrow, [data-edit-block="cv"] .eyebrow, [data-edit-block="pgrid"] .eyebrow';
const pageTitles = '[data-edit-block="rt"] h2, [data-edit-block="st2"] h2, [data-edit-block="cv"] h2';
const pageBodies = '[data-edit-block="rt"] p:not(.eyebrow), [data-edit-block="st2"] p:not(.eyebrow)';
const BODY = ":is(p, li):not(.eyebrow, .caption-text, .strip-caption)";
const colorsOf = (f, sel) => f.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.getBoundingClientRect().width > 0).map((e) => getComputedStyle(e).color), sel);
/** Un cran de couleur de la barre qui n'est aucune des couleurs déjà montrées (le test ne doit pas réussir « par hasard »). */
const pickSwatch = async (f, avoid = [], skip = []) => {
  const n = await f.locator(".lk-bar .tc-swatches [role=radio]").count();
  for (let i = 0; i < n; i++) {
    if (skip.includes(i)) continue;
    const c = await swatchColor(f, i);
    if (!avoid.includes(c)) return i;
  }
  return 0;
};
const same = (list, v) => list.length > 0 && list.every((c) => c === v);
const none = (list, v) => list.length > 0 && list.every((c) => c !== v);
/** Types de texte d'une planche de projet : le texte à régler, les éléments de la planche qui doivent suivre, ceux qui ne le doivent pas. */
const TYPES = [
  { id: "étiquette", open: `${bitem("brt")} [data-inline="eyebrow"]`, one: /^Cette étiquette$/, proj: /^Toutes les étiquettes du projet$/, inside: `${board} .eyebrow`, outside: [pageEyebrows, `${board2} .eyebrow`], store: "eyebrow", site: /^Tout le site$/ },
  { id: "titre", open: `${bitem("brt")} [data-inline="title"]`, one: /^Ce titre$/, proj: /^Tous les titres du projet$/, inside: `${board} :is(h1, h2, h3)`, outside: [pageTitles, `${board2} :is(h1, h2, h3)`], store: "h2", site: /^Tout le site$/ },
  { id: "texte", open: `${bitem("brt")} [data-inline="paragraphs.0"]`, one: /^Ce texte$/, proj: /^Tous les textes du projet$/, inside: `${board} ${BODY}`, outside: [pageBodies, `${board2} ${BODY}`], store: "body", site: /^Tout le site$/ },
  { id: "titre de légende", open: `${bitem("bimg")} [data-cap="title"]`, one: /^Ce titre$/, proj: /^Tous les titres de légende du projet$/, inside: `${board} [data-cap="title"]`, outside: ['[data-edit-block="pimg"] [data-cap="title"]', `${board2} [data-cap="title"]`], store: "cap.title", site: /^Tout le site$/ },
  { id: "légende", open: `${bitem("bimg")} [data-cap="legend"]`, one: /^Cette légende$/, proj: /^Toutes les légendes du projet$/, inside: `${board} [data-cap="legend"]`, outside: ['[data-edit-block="pimg"] [data-cap="legend"]', `${board2} [data-cap="legend"]`], store: "cap.legend", site: /^Tout le site$/ },
  { id: "date de légende", open: `${bitem("bimg")} [data-cap="date"]`, one: /^Cette date$/, proj: /^Toutes les dates du projet$/, inside: `${board} [data-cap="date"]`, outside: ['[data-edit-block="pimg"] [data-cap="date"]', `${board2} [data-cap="date"]`], store: "cap.date", site: /^Tout le site$/ },
];
if (run("T")) {
  await section("T", async () => {
    await resetScene();
    let f = await reopen();
    // T1 libellés et ordre : « Ce/cette <type> » · « Tous les <type> du projet » · « Tout le site » (à droite).
    for (const t of TYPES) {
      ok(`T1 ${t.id} : la barre s'ouvre`, await openByAa(f, t.open));
      const sc = (await scopes(f)).map((s) => s.text);
      ok(`T1 ${t.id} : trois portées, dans l'ordre, « Tout le site » à droite`, sc.length === 3 && t.one.test(sc[0]) && t.proj.test(sc[1]) && t.site.test(sc[2]), JSON.stringify(sc));
      await closeBar(f);
    }
    // T2 hors planche de projet : deux portées seulement, « Tout le projet » absent ; les autres libellés ne changent pas.
    const OUT = [
      ["étiquette de page", '[data-edit-block="rt"] [data-inline="eyebrow"]', /^Cette étiquette$/, /^Tous les « Étiquette »$/],
      ["titre de page", '[data-edit-block="rt"] [data-inline="title"]', /^Ce titre$/, /^Tous les titres$/],
      ["texte de page", '[data-edit-block="rt"] [data-inline="paragraphs.0"]', /^Ce texte$/, /^Tous les « Texte »$/],
      ["légende de page", '[data-edit-block="pimg"] [data-cap="legend"]', /^Cette légende$/, /^Tous les « Légende »$/],
    ];
    for (const [id, sel, one, siteRe] of OUT) {
      ok(`T2 ${id} : la barre s'ouvre`, await openByAa(f, sel));
      const sc = (await scopes(f)).map((s) => s.text);
      ok(`T2 ${id} : « Ce/cette … » et « Tous les … » seulement (pas de portée projet)`, sc.length === 2 && one.test(sc[0]) && siteRe.test(sc[1]), JSON.stringify(sc));
      await closeBar(f);
    }
    // T3 la portée « Tout le projet » de chaque type ne touche que les éléments de ce type dans CETTE planche.
    for (const t of TYPES) {
      await resetScene();
      f = await reopen();
      const baseIn = await colorsOf(f, t.inside);
      const baseOut = await Promise.all(t.outside.map((s) => colorsOf(f, s)));
      ok(`T3 ${t.id} : la barre s'ouvre`, await openByAa(f, t.open));
      await scopeBtn(f, t.proj).click();
      const sw = await pickSwatch(f, [...baseIn, ...baseOut.flat()]);
      const wanted = await swatchColor(f, sw);
      await swatchBtn(f, sw).click();
      await sleep(500);
      const inside = await colorsOf(f, t.inside);
      ok(`T3 ${t.id} : tous les éléments de ce type dans la planche prennent la valeur (${inside.length})`, same(inside, wanted), JSON.stringify({ inside, wanted }));
      for (const [i, sel] of t.outside.entries()) ok(`T3 ${t.id} : …jamais ceux de ${i === 0 ? "la page" : "l'autre planche"}`, JSON.stringify(await colorsOf(f, sel)) === JSON.stringify(baseOut[i]), sel);
      await settled(page);
      await sleep(1200);
      ok(`T3 ${t.id} : …et après l'acquittement du serveur`, same(await colorsOf(f, t.inside), wanted));
      const pt = pageBlock("pbd").props.look?.projectText?.[t.store];
      ok(`T3 ${t.id} : écrit dans les props du bloc « planche de projet » (look.projectText.${t.store})`, Boolean(pt?.color), JSON.stringify(pageBlock("pbd").props.look) ?? "absent");
      ok(`T3 ${t.id} : …pas dans la table des projets`, !(boardDraft(BOARD_ID) ?? []).some((i) => i.captionStyle) && !JSON.stringify(pageBlock("pbd2").props).includes("projectText"));
      await closeBar(f);
      f = await reopen();
      ok(`T3 ${t.id} : …et après le rechargement`, same(await colorsOf(f, t.inside), wanted));
    }
    // T4 « Ce texte » ne touche que lui, y compris dans la planche (les voisins gardent le style du projet ou du site).
    await resetScene();
    f = await reopen();
    const e1 = `${bitem("brt")} [data-inline="eyebrow"]`;
    const e2 = `${bitem("brt2")} [data-inline="eyebrow"]`;
    const before2 = await colorOf(f, e2);
    ok("T4 barre d'une étiquette de planche", await openByAa(f, e1));
    await scopeBtn(f, /^Cette étiquette$/).click();
    const own = await swatchColor(f, SW);
    await swatchBtn(f, SW).click();
    await settled(page);
    ok("T4 « Cette étiquette » : cette étiquette seule change", (await colorOf(f, e1)) === own && (await colorOf(f, e2)) === before2);
    ok("T4 …écrite dans le composant (look.text.eyebrow)", boardItem("brt")?.props.look?.text?.eyebrow?.color === "secondary", JSON.stringify(boardItem("brt")?.props.look));
    await closeBar(f);
  });
}

/* ===== P. Priorités, « Revenir » par portée, pastille ================================================================================== */
if (run("P")) {
  await section("P", async () => {
    await resetScene();
    let f = await reopen();
    const one = `${bitem("brt")} [data-inline="eyebrow"]`;
    const mate = `${bitem("brt2")} [data-inline="eyebrow"]`;
    const pageEy = '[data-edit-block="rt"] [data-inline="eyebrow"]';
    const other1 = `${board2} .eyebrow`;
    const theme = { one: await colorOf(f, one), page: await colorOf(f, pageEy) };
    const dots = async () => (await scopes(f)).map((s) => s.dot);
    const resetText = async () => ((await resetBtn(f).textContent()) ?? "").trim();
    // P1 site : toutes les étiquettes (page, planche, autre planche).
    ok("P1 barre", await openByAa(f, one));
    ok("P1 aucune pastille au départ", (await dots()).every((d) => !d), JSON.stringify(await scopes(f)));
    await scopeBtn(f, /^Tout le site$/).click();
    const iSite = await pickSwatch(f, [theme.one, theme.page]);
    const cSite = await swatchColor(f, iSite);
    await swatchBtn(f, iSite).click();
    await settled(page);
    await sleep(900);
    ok("P1 site : l'étiquette de la planche, celle de la page et celles de l'autre planche suivent", (await colorOf(f, one)) === cSite && (await colorOf(f, pageEy)) === cSite && (await colorOf(f, other1)) === cSite);
    ok("P1 pastille sur « Tout le site » seulement", JSON.stringify(await dots()) === "[false,false,true]", JSON.stringify(await scopes(f)));
    // P2 projet : passe devant le site, seulement dans la planche.
    await scopeBtn(f, /du projet$/).click();
    const iProj = await pickSwatch(f, [theme.one, theme.page, cSite]);
    const cProj = await swatchColor(f, iProj);
    await swatchBtn(f, iProj).click();
    await settled(page);
    await sleep(900);
    ok("P2 projet : devant le site, dans la planche", (await colorOf(f, one)) === cProj && (await colorOf(f, mate)) === cProj);
    ok("P2 …la page et l'autre planche gardent le site", (await colorOf(f, pageEy)) === cSite && (await colorOf(f, other1)) === cSite);
    ok("P2 pastilles : projet et site", JSON.stringify(await dots()) === "[false,true,true]", JSON.stringify(await scopes(f)));
    // P3 élément : passe devant le projet.
    await scopeBtn(f, /^Cette étiquette$/).click();
    const iOne = await pickSwatch(f, [theme.one, theme.page, cSite, cProj]);
    const cOne = await swatchColor(f, iOne);
    await swatchBtn(f, iOne).click();
    await settled(page);
    await sleep(900);
    ok("P3 élément : devant le projet, lui seul", (await colorOf(f, one)) === cOne && (await colorOf(f, mate)) === cProj);
    ok("P3 pastilles sur les trois portées", JSON.stringify(await dots()) === "[true,true,true]", JSON.stringify(await scopes(f)));
    await shot(page, "P3-trois-pastilles");
    // P4 « Revenir » par portée : chacun ne retire que son niveau.
    ok("P4 « Revenir au style du projet » pour l'élément", /projet/i.test(await resetText()), await resetText());
    await resetBtn(f).click();
    await settled(page);
    await sleep(900);
    ok("P4 élément revenu : reprend le projet", (await colorOf(f, one)) === cProj && JSON.stringify(await dots()) === "[false,true,true]", JSON.stringify(await scopes(f)));
    await scopeBtn(f, /du projet$/).click();
    ok("P4 « Revenir au style du site » pour le projet", /site/i.test(await resetText()), await resetText());
    await resetBtn(f).click();
    await settled(page);
    await sleep(1200);
    ok("P4 projet revenu : reprend le site (planche) ; page et autre planche inchangées", (await colorOf(f, one)) === cSite && (await colorOf(f, mate)) === cSite && (await colorOf(f, pageEy)) === cSite);
    ok("P4 …plus rien dans le bloc", !pageBlock("pbd").props.look?.projectText, JSON.stringify(pageBlock("pbd").props.look));
    await scopeBtn(f, /^Tout le site$/).click();
    ok("P4 « Revenir au thème » pour le site", /thème/i.test(await resetText()), await resetText());
    await resetBtn(f).click();
    await settled(page);
    await sleep(1200);
    ok("P4 site revenu : le thème", (await colorOf(f, one)) === theme.one && (await colorOf(f, pageEy)) === theme.page, JSON.stringify({ now: await colorOf(f, one), theme }));
    ok("P4 aucune pastille", (await dots()).every((d) => !d), JSON.stringify(await scopes(f)));
    await closeBar(f);
  });
}

/* ===== R. Rechargement, publication, public = éditeur, anciennes données ================================================================ */
// Public : hors visionneuse (la boîte sombre qui s'ouvre sur une image a ses propres couleurs, pas de visionneuse sur la toile).
const publicColors = async (pub, sel) => pub.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => !e.closest(".lightbox, dialog, [role=dialog], [hidden]")).map((e) => getComputedStyle(e).color), sel);
if (run("R")) {
  await section("R", async () => {
    await resetScene({ lean: true });
    let f = await reopen();
    // Un réglage par type : projet (titres, étiquettes, textes) et élément.
    const SET = [
      { t: TYPES[0], sw: SW },
      { t: TYPES[1], sw: SW2 },
      { t: TYPES[2], sw: SW3 },
    ];
    const wanted = {};
    for (const s of SET) {
      ok(`R1 barre ${s.t.id}`, await openByAa(f, s.t.open));
      await scopeBtn(f, s.t.proj).click();
      wanted[s.t.id] = await swatchColor(f, s.sw);
      await swatchBtn(f, s.sw).click();
      await settled(page);
      await closeBar(f);
    }
    f = await reopen();
    for (const s of SET) ok(`R1 ${s.t.id} : le réglage du projet reste après le rechargement`, same(await colorsOf(f, s.t.inside), wanted[s.t.id]));
    const edited = {};
    for (const s of SET) edited[s.t.id] = await colorsOf(f, s.t.inside);
    // Publication : le public montre la même chose que l'éditeur.
    await page.getByRole("button", { name: "Publier", exact: true }).click();
    ok("R2 publication", await waitFor(() => sql((db) => db.prepare("select draft from pages where id = ?").get(pageId)).draft === null && boardDraft(BOARD_ID) === null, 120000));
    await sleep(2500);
    ok("R2 le réglage est publié avec le bloc de la page", pageBlockPublished(0)?.look?.projectText?.eyebrow?.color === "secondary", JSON.stringify(pageBlockPublished(0)?.look));
    // Visiteur anonyme (un contexte neuf) : la session de l'administrateur montrerait la page en vue brouillon, pas la page publique.
    const anon = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const pub = await anon.newPage();
    pub.setDefaultTimeout(30000);
    await pub.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
    const pubBoard = `[data-pscope] `;
    for (const s of SET) {
      const sel = s.t.inside.replace(board, "[data-pscope]");
      const cols = await publicColors(pub, sel);
      ok(`R2 public : ${s.t.id} du projet = ${wanted[s.t.id]}`, same(cols, wanted[s.t.id]), JSON.stringify(cols));
      ok(`R2 public = éditeur : mêmes couleurs que sur la toile`, JSON.stringify(cols.slice().sort()) === JSON.stringify(edited[s.t.id].slice().sort()) || cols.every((c) => c === wanted[s.t.id]));
    }
    diag("R2 public : repères de planche", await pub.evaluate(() => JSON.stringify([...document.querySelectorAll("[data-pscope]")].map((e) => e.getAttribute("data-pscope") + ":" + e.tagName.toLowerCase()))));
    for (const s of SET.slice(1)) {
      const sel = s.t.inside.replace(board, "[data-pscope]");
      const rows = await pub.evaluate((q) => [...document.querySelectorAll(q)].map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 40)} "${e.textContent.trim().slice(0, 20)}" ${getComputedStyle(e).color} < ${[...Array(3)].reduce((a, _) => (a.c ? { c: a.c.parentElement, s: a.s + " " + (a.c.parentElement?.tagName.toLowerCase() ?? "") + "." + String(a.c.parentElement?.className).slice(0, 25) } : a), { c: e, s: "" }).s}`), sel);
      for (const r of rows) diag(`R2 public ${s.t.id}`, r);
    }
    const eyPage = await publicColors(pub, '[data-block-uid="rt"] .eyebrow, .page-top .eyebrow');
    void pubBoard;
    void eyPage;
    await anon.close();
  });
  await section("R-legacy", async () => {
    // Anciennes données : un style de légendes du projet rangé avec la suite (lot 98), sans aucun réglage de portée « projet » dans le bloc.
    await resetScene();
    const layout = BOARD_ITEMS();
    layout[0] = { ...layout[0], captionStyle: { title: { color: "tertiary" } } };
    setBoardDraft(BOARD_ID, pageId, layout);
    let f = await reopen();
    const titles = () => colorsOf(f, `${board} [data-cap="title"]`);
    const tertiary = await (async () => {
      ok("R3 barre d'un titre de légende de planche", await openByAa(f, `${bitem("bimg")} [data-cap="title"]`));
      await scopeBtn(f, /^Tout le site$/).click();
      const c = await swatchColor(f, SW3);
      await closeBar(f);
      return c;
    })();
    const t0 = await titles();
    ok("R3 l'ancien style des légendes du projet s'affiche toujours (titres de la planche)", same(t0, tertiary), JSON.stringify({ t0, tertiary }));
    ok("R3 …la portée projet porte la pastille, avec la valeur de l'ancien style", await openByAa(f, `${bitem("bimg")} [data-cap="title"]`));
    const sc = await scopes(f);
    ok("R3 …pastille sur « Tous les titres de légende du projet »", sc[1]?.dot === true && sc[0]?.dot === false, JSON.stringify(sc));
    // Modifier la portée projet range le réglage dans le bloc et retire l'ancien (sinon « Revenir » le ferait renaître).
    await scopeBtn(f, /du projet$/).click();
    const c2 = await swatchColor(f, SW);
    await swatchBtn(f, SW).click();
    await settled(page);
    await sleep(1200);
    ok("R4 la nouvelle valeur remplace l'ancienne", same(await titles(), c2));
    ok("R4 …rangée dans le bloc", pageBlock("pbd").props.look?.projectText?.["cap.title"]?.color === "secondary");
    ok("R4 …et l'ancien style du projet est retiré de la suite", !(boardDraft(BOARD_ID) ?? []).some((i) => i.captionStyle?.title), JSON.stringify((boardDraft(BOARD_ID) ?? []).map((i) => i.captionStyle)));
    await resetBtn(f).click();
    await settled(page);
    await sleep(1200);
    ok("R4 « Revenir » : le site, pas l'ancien style", none(await titles(), tertiary) || same(await titles(), (await colorsOf(f, '[data-edit-block="pimg"] [data-cap="title"]'))[0]), JSON.stringify(await titles()));
    await closeBar(f);
  });
}

/* ===== S. Portée site seule (même geste sur la base : comparaison) ===================================================================== */
if (run("S")) {
  await section("S", async () => {
    await resetScene();
    let f = await reopen();
    const sel = '[data-edit-block="rt"] [data-inline="eyebrow"]';
    const theme = await colorOf(f, sel);
    ok("S1 barre d'une étiquette de page", await openByAa(f, sel));
    await scopeBtn(f, /^Tous les « Étiquette »$/).click();
    const i = await pickSwatch(f, [theme]);
    const c = await swatchColor(f, i);
    await swatchBtn(f, i).click();
    await settled(page);
    await sleep(1500);
    ok("S1 le site règle les étiquettes", (await colorOf(f, sel)) === c);
    await resetBtn(f).click();
    await settled(page);
    await sleep(2500);
    const live = await colorOf(f, sel);
    diag("S2 après « Revenir au thème », sans rechargement", live === theme ? "thème" : "ancienne valeur");
    ok("S2 « Revenir au thème » : l'étiquette reprend le thème (sans rechargement)", live === theme, `${live} ≠ ${theme}`);
    await closeBar(f);
    f = await reopen();
    ok("S2 …et après le rechargement", (await colorOf(f, sel)) === theme);
  });
}

/* ===== L. Anciennes données : rendu identique (mêmes lignes sur la base et sur le code du lot, à comparer) ============================ */
const styleLines = (f) =>
  f.evaluate(() => {
    const out = [];
    const nodes = [...document.querySelectorAll("main *")].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && !e.closest("script, style, .pe-layer, .lightbox, dialog"));
    nodes.forEach((e, i) => {
      const cs = getComputedStyle(e);
      out.push(`${i} ${e.tagName.toLowerCase()}${e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\s+/).slice(0, 3).join(".") : ""} "${e.textContent.trim().slice(0, 24)}" ${cs.color} ${cs.fontSize} ${cs.fontWeight} ${cs.fontStyle} ${cs.textTransform} ${cs.letterSpacing} ${cs.fontFamily.slice(0, 30)}`);
    });
    return out;
  });
if (run("L")) {
  await section("L", async () => {
    await resetScene({ lean: true });
    const blocks = PAGE_BLOCKS().filter((b) => LEAN.has(b.uid));
    const look = (b, text) => Object.assign(b, { props: { ...b.props, look: { text } } });
    look(blocks.find((b) => b.uid === "stt"), { title: { color: "primary" }, eyebrow: { italic: true } });
    look(blocks.find((b) => b.uid === "rt"), { "paragraphs.0": { weight: 700 }, eyebrow: { color: "tertiary" } });
    look(blocks.find((b) => b.uid === "pbd"), { title: { color: "secondary" }, description: { italic: true }, "captions.xx.title": { color: "primary" } });
    setDraft(pageId, blocks);
    const layout = BOARD_ITEMS();
    layout[0] = { ...layout[0], captionStyle: { title: { color: "tertiary" }, legend: { weight: 700 }, date: { italic: true } } };
    layout[2] = { ...layout[2], props: { ...layout[2].props, look: { text: { eyebrow: { color: "primary" } } } } };
    setBoardDraft(BOARD_ID, pageId, layout);
    const f = await reopen();
    for (const l of await styleLines(f)) console.log(`LEGE ${l}`);
    await page.getByRole("button", { name: "Publier", exact: true }).click();
    ok("L publication", await waitFor(() => sql((db) => db.prepare("select draft from pages where id = ?").get(pageId)).draft === null && boardDraft(BOARD_ID) === null, 120000));
    await sleep(2500);
    // Visiteur anonyme (un contexte neuf) : la session de l'administrateur montrerait la page en vue brouillon, pas la page publique.
    const anon = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const pub = await anon.newPage();
    pub.setDefaultTimeout(30000);
    await pub.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
    const lines = await styleLines(pub);
    for (const l of lines) console.log(`LEGP ${l}`);
    const html = await pub.evaluate(() => document.querySelector("main")?.innerHTML.replace(/\/media\/[^"')\s]+/g, "/media/X").replace(/_next\/[^"')\s]+/g, "_next/X").replace(/ id="[^"]*"/g, "").replace(/\s+/g, " ") ?? "");
    console.log(`LEGH longueur du HTML public de la page : ${html.length}`);
    for (const l of html.split(/(?<=>)/)) console.log(`LEGX ${l.slice(0, 220)}`);
    ok("L le public rend les anciennes données", lines.length > 20);
    await anon.close();
  });
}

if (errors.length) console.log("pageerror:", errors.slice(0, 5).join(" || "));
await browser.close();
console.log(failures ? `ÉCHEC : ${failures}` : "TOUT PASSE");
process.exit(failures ? 1 : 0);
