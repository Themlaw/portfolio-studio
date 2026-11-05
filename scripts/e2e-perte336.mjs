#!/usr/bin/env node
/**
 * Correctif v0.33.6, point 1 : « Publier » puis un réglage de couleur (même session) ne doit rien perdre du contenu propre de la planche de projet.
 * Scène : brouillon de projet TENU par la page (données d'avant le lot 111) ; « Publier » le range dans la copie propre du bloc Projet (foldHeldDrafts) ;
 * l'éditeur doit alors reprendre cette copie. Preuve par la BASE (props.layout du bloc, brouillon de page, version publiée), puis par l'affichage.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… node scripts/e2e-perte336.mjs
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


const ownOf = (blocks) => {
  const b = (blocks ?? []).find((x) => x.type === "project-board");
  return { layout: b?.props?.layout ? b.props.layout.length : 0, text: b?.props?.text ? 1 : 0 };
};
const publishedOwn = () => {
  const rows = sql((db) => db.prepare("select type, props from blocks where page_id = ? order by position").all(pageId));
  return ownOf(rows.map((r) => ({ type: r.type, props: JSON.parse(r.props) })));
};
const draftOwn = () => {
  const d = sql((db) => db.prepare("select draft from pages where id = ?").get(pageId))?.draft;
  return d ? ownOf(JSON.parse(d).blocks) : null;
};
const heldLayout = () => sql((db) => db.prepare("select draft_layout from projects where id = ?").get(BOARD_ID))?.draft_layout != null;
const count = (m) => Object.keys(m).length;
try {
  await section("P", async () => {
    resetScene();
    F = await reopen();
    const start = await readColors(F);
    ok("P0 point de départ : brouillon de projet tenu par la page, planche à 29 textes ou plus", heldLayout() && count(start) >= 29, `${count(start)} textes, tenu=${heldLayout()}`);
    await publishNow();
    const pub1 = publishedOwn();
    diag("P1 après Publier : copie propre publiée", JSON.stringify(pub1), "brouillon de page", JSON.stringify(draftOwn()), "brouillon de projet tenu", String(heldLayout()));
    ok("P1 « Publier » range la planche dans la copie propre du bloc Projet publié", pub1.layout > 0);
    const afterPublish = await readColors(F);
    await colorText(F, '[data-edit-block="b1"] [data-cap="legend"]', 4);
    await closeBar(F);
    await settled(page);
    await sleep(2500);
    const dr = draftOwn();
    diag("P2 après la couleur : brouillon de page", JSON.stringify(dr), "publié", JSON.stringify(publishedOwn()));
    ok("P2 PERTE (brouillon) : le brouillon de page enregistré garde la copie propre de la planche", dr === null || dr.layout === pub1.layout, `brouillon ${JSON.stringify(dr)} (publié ${pub1.layout} composants)`);
    ok("P2b la version publiée n'a pas été touchée par le réglage", publishedOwn().layout === pub1.layout);
    const S = await readColors(F);
    ok("P3 AFFICHAGE : la toile garde tous ses textes", count(S) >= count(afterPublish), `${count(S)} au lieu de ${count(afterPublish)}`);
    F = await reopen();
    const R = await readColors(F);
    ok("P4 après rechargement : la planche garde ses textes", count(R) >= count(afterPublish), `${count(R)} au lieu de ${count(afterPublish)}`);
    await publishNow();
    ok("P5 PERTE (publié) : une seconde publication ne perd pas la planche", publishedOwn().layout === pub1.layout, `publié ${JSON.stringify(publishedOwn())}`);
    const pub = await publicColors(Object.keys(afterPublish));
    ok("P6 page publique : tous les textes de la planche sont encore là", Object.keys(pub).length >= count(afterPublish) - 3, `${Object.keys(pub).length} trouvés sur ${count(afterPublish)}`);
  });
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} ÉCHEC(S)` : "\nTout passe");
process.exit(failures ? 1 : 0);
