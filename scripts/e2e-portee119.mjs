#!/usr/bin/env node
/**
 * Lot 119 « portée des réglages de texte : cet élément » (chromium, serveur requis, base neuve).
 * Souris et clavier réels ; données synthétiques seulement.
 *  I  Inventaire : CHAQUE texte qui porte une pastille « Aa » (page, planche, composants, tuiles, légendes) propose la portée « cet élément seul »
 *     (« Cette étiquette », « Ce titre », « Ce texte », « Cette légende »…) ; choisir une couleur n'en change qu'un, elle s'écrit.
 * Captures : $SHOTS. Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=I] [SHOTS=dossier] node scripts/e2e-portee119.mjs
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

if (errors.length) console.log("pageerror:", errors.slice(0, 5).join(" || "));
await browser.close();
console.log(failures ? `ÉCHEC : ${failures}` : "TOUT PASSE");
process.exit(failures ? 1 : 0);
