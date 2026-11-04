#!/usr/bin/env node
/**
 * Hotfix v0.33.4 « la barre Aa ne ferme plus la saisie », UN chromium. Serveur requis, base NEUVE, une connexion admin. Données SYNTHETIQUES.
 * Pour CHAQUE contrôle de la barre « Aa » d'un texte en saisie (police, taille, graisse, italique, majuscules, espacement, taille +/-, couleur de la
 * palette, roue, fond du texte, alignement), souris 1024, tactile 1024, tactile 390 : ouvrir, choisir une valeur, puis la barre est toujours ouverte, la
 * saisie toujours en cours, la valeur appliquée (mesurée) ; ensuite on tape encore au clavier (le texte a gardé / retrouvé le focus), on valide, on
 * recharge (valeurs conservées), on publie (souris 1024) et la page publiée porte les valeurs.
 *  P  Position des listes (police, taille, graisse) : ancrées à LEUR bouton, dans l'écran, à 390, 720 et 1024 px.
 * Usage : BASE=… ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… [ONLY=A,P] [BATT_MODE=0|1|2] node scripts/e2e-barreaa114.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";
import sharp from "sharp";

import { paint } from "./lib/crop-fixtures.mjs";
import { installKitFrameTheme } from "./lib/cadres62.mjs";
import { canvas, login, pageIdOf, q1, setBoardDraft, setDraft, sleep, sql, waitFor } from "./lib/grille31d.mjs";

const BASE = process.env.BASE ?? "http://localhost:3001";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(process.env.BATTERY_DIR ?? tmpdir(), "shots-barreaa114");
mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const info = (label, v) => console.log(`INFO ${label}${v === undefined ? "" : ` : ${typeof v === "string" ? v : JSON.stringify(v)}`}`);
const until = async (fn, timeout = 20000) => {
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(250)) if (await fn()) return true;
  return false;
};
const rgbOf = (css) => {
  if (/^#[0-9a-f]{6}$/i.test(css.trim())) return [1, 3, 5].map((i) => parseInt(css.trim().slice(i, i + 2), 16));
  const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(css) ?? /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(css);
  if (!m) return null;
  const k = /color\(srgb/.test(css) ? 255 : 1;
  return [Number(m[1]) * k, Number(m[2]) * k, Number(m[3]) * k];
};
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const near = (a, b, tol) => Boolean(a && b) && a.every((v, i) => Math.abs(v - b[i]) <= tol);
const blend = (base, tint, a) => base.map((v, i) => v * (1 - a) + tint[i] * a);

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const errors = [];

/* ---- Données de test --------------------------------------------------------------------------------------------------- */
const admin = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const setup = await admin.newPage();
setup.setDefaultTimeout(60000);
setup.setDefaultNavigationTimeout(180000);
await login(setup, BASE);
async function ensure(name, w, h, seed) {
  const row = () => q1("select id, status from media where original_name = ? order by id desc", name);
  if (!row()) {
    const res = await setup.request.post(`${BASE}/admin/api/upload`, { headers: { origin: BASE }, multipart: { file: { name, mimeType: "image/png", buffer: await paint(w, h, seed) } }, timeout: 180000 });
    if (res.status() >= 300) throw new Error(`envoi de ${name} : ${res.status()}`);
  }
  if (!(await waitFor(() => row()?.status === "ready", 240000))) throw new Error(name);
  return row().id;
}
const CARRE = await ensure("110-carre.png", 1200, 1200, 3);
const PANO = await ensure("110-panorama.png", 6000, 1200, 1);
const GRAND = await ensure("110-grand.png", 3000, 2000, 5);
const PORTRAIT = await ensure("110-portrait.png", 1000, 1500, 6);
const T = (s) => ({ fr: s, en: s });
const pageId = pageIdOf("personnages");
const PROJECT = q1("select id, slug from projects order by id limit 1");
sql((db) => {
  const slots = db.prepare("select id from slots where project_id = ? order by position").all(PROJECT.id);
  [PANO, GRAND, PORTRAIT, CARRE, PANO, GRAND].forEach((m, i) => slots[i] && db.prepare("update slots set media_id = ?, title = ?, description = ?, aspect = null where id = ?").run(m, JSON.stringify(T(`Image ${i + 1}`)), JSON.stringify(T("")), slots[i].id));
  db.prepare("update projects set draft_layout = null, draft_layout_page_id = null where id = ?").run(PROJECT.id);
});
const LAYOUT = [
  { uid: "s1", type: "strip", props: {} },
  { uid: "c1", type: "strip", props: { source: "own", media: [PORTRAIT, PANO, GRAND, CARRE, PORTRAIT, PANO, GRAND, CARRE, PORTRAIT, PANO, GRAND, CARRE] } },
];
const BLOCKS = [
  { uid: "t0", type: "rich-text", props: { paragraphs: [T("Texte d'essai pour la roue des couleurs, assez long pour être choisi et modifié.")] } },
  { uid: "pbd", type: "project-board", props: { project: PROJECT.slug } },
  { uid: "t1", type: "rich-text", props: { paragraphs: [T("Texte de fin.")] } },
];
async function publishNow(p) {
  const publish = p.getByRole("button", { name: "Publier", exact: true });
  await p.waitForFunction(() => !/Enregistrement/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, { timeout: 120000 });
  await waitFor(async () => !(await publish.isDisabled()), 30000);
  await publish.click();
  const confirm = p.locator("dialog[open]").getByRole("button", { name: "Mettre en ligne" });
  if (await confirm.waitFor({ timeout: 3000 }).then(() => true, () => false)) await confirm.click();
  return waitFor(async () => /En ligne/.test((await p.locator(".ve-status").textContent().catch(() => "")) ?? ""), 180000);
}
function seed() {
  sql((db) => db.prepare("update projects set layout = ? where id = ?").run(JSON.stringify(LAYOUT), PROJECT.id));
  setDraft(pageId, BLOCKS);
}
seed();

/* ---- Gestes (souris ou toucher réel) ------------------------------------------------------------------------------------- */
async function gesture(page, touch, loc, fx, fy) {
  const b = await loc.boundingBox();
  const x = b.x + b.width * fx;
  const y = b.y + b.height * fy;
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}
/** Glisser dans un élément : souris, ou toucher via CDP (touchStart / touchMove / touchEnd). */
async function drag(page, touch, loc, from, to) {
  const b = await loc.boundingBox();
  const p = (f) => ({ x: b.x + b.width * f[0], y: b.y + b.height * f[1] });
  const a = p(from);
  const z = p(to);
  if (!touch) {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move((a.x + z.x) / 2, (a.y + z.y) / 2, { steps: 4 });
    await page.mouse.move(z.x, z.y, { steps: 4 });
    await page.mouse.up();
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: a.x, y: a.y }] });
  for (let i = 1; i <= 6; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: a.x + ((z.x - a.x) * i) / 6, y: a.y + ((z.y - a.y) * i) / 6 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}
const MODES = [
  ["souris 1024", { viewport: { width: 1024, height: 800 } }, false],
  ["tactile 1024", { viewport: { width: 1024, height: 800 }, hasTouch: true, isMobile: true }, true],
  ["tactile 390", { viewport: { width: 390, height: 700 }, hasTouch: true, isMobile: true }, true],
];
const authed = async (opts) => {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(180000);
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page, BASE);
  return { ctx, page };
};
async function openEditorOn(page) {
  seed();
  await page.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
  const f = await canvas(page);
  await sleep(2000);
  return f;
}
const alive = (page, f) => f.evaluate(() => Boolean(document.documentElement.hasAttribute("data-edit-mode"))).then((v) => v && page.locator("iframe.ve-frame").count().then((n) => n === 1), () => false);

const PARA = '[data-inline="paragraphs.0"]';
const PROPS = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "textTransform", "letterSpacing", "color", "textAlign"];
const readStyle = (F) => F.evaluate(([s, props]) => { const cs = getComputedStyle(document.querySelector(s)); return Object.fromEntries(props.map((p) => [p, cs[p]])); }, [PARA, PROPS]);

if (run("A")) {
  for (const [name, opts, touch] of MODES.filter((_, i) => !process.env.BATT_MODE || String(i) === process.env.BATT_MODE)) {
    const { ctx, page } = await authed(opts);
    try {
      const F = await openEditorOn(page);
      const para = F.locator(PARA).first();
      await para.scrollIntoViewIfNeeded();
      const b = await para.boundingBox();
      if (touch) {
        if (opts.viewport.width >= 600) {
          const ty = Math.max(8, b.height - 8);
          await page.touchscreen.tap(b.x + 30, b.y + ty);
          await sleep(80);
          await page.touchscreen.tap(b.x + 30, b.y + ty);
        } else await para.dispatchEvent("dblclick");
      } else await para.dblclick({ position: { x: 30, y: 8 } });
      ok(`${name} · saisie ouverte, barre « Aa » ouverte`, await until(async () => (await F.locator(".lk-bar").count()) === 1 && (await F.locator("[data-editing]").count()) >= 1, 10000));
      const tap = (loc) => (touch ? loc.tap() : loc.click());
      const still = async () => (await F.locator(".lk-bar").count()) === 1 && (await F.locator("[data-editing]").count()) >= 1 && (await alive(page, F));
      const lastKey = {};
      /** Un contrôle : l'action, puis barre ouverte, saisie en cours, et la propriété `prop` a changé. */
      const control = async (label, prop, action) => {
        const before = (await readStyle(F))[prop];
        try {
          await action();
        } catch (e) {
          ok(`${name} · ${label} : geste possible`, false, String(e.message).split("\n")[0]);
          await page.screenshot({ path: path.join(SHOTS, `fail-${label.replace(/\W+/g, "-")}-${name.replace(/\W+/g, "-")}.png`) }).catch(() => {});
          info("ouverts", await F.evaluate(() => ({ bars: document.querySelectorAll(".lk-bar").length, lists: document.querySelectorAll(".ms-list").length, fm: document.querySelectorAll(".fm").length, active: document.activeElement?.className, editing: document.querySelectorAll("[data-editing]").length })));
          return;
        }
        await sleep(500);
        ok(`${name} · ${label} : la barre est toujours ouverte et la saisie toujours en cours`, await still(), `barres ${await F.locator(".lk-bar").count()}, saisies ${await F.locator("[data-editing]").count()}`);
        ok(`${name} · ${label} : la valeur est appliquée (${prop})`, await until(async () => (await readStyle(F))[prop] !== before, 8000), `reste ${before}`);
        lastKey[prop] = (await readStyle(F))[prop];
      };
      // Police : liste avec recherche
      await control("police", "fontFamily", async () => {
        await tap(F.locator(".lk-bar .tc-font"));
        await F.locator(".fm-search").waitFor({ timeout: 5000 });
        await F.locator(".fm-search").fill("Rowdies");
        ok(`${name} · police : la recherche (saisie dans la liste) ne ferme pas la barre`, await still());
        await tap(F.locator(".fm-item[data-font]").first());
      });
      // Taille, graisse : listes
      const MS = F.locator(".lk-bar .ms-button");
      await control("taille", "fontSize", async () => {
        await tap(MS.nth(0));
        await F.locator(".ms-list").waitFor({ timeout: 5000 });
        await tap(F.locator(".ms-list [role=option]:not([aria-disabled=true])").nth(5));
      });
      await control("graisse", "fontWeight", async () => {
        await tap(MS.nth(1));
        await F.locator(".ms-list").waitFor({ timeout: 5000 });
        await tap(F.locator(".ms-list [role=option]:not([aria-disabled=true])").nth(1));
      });
      await control("taille plus grande", "fontSize", () => tap(F.locator('.lk-bar [aria-label="Plus grand"]')));
      await control("italique", "fontStyle", () => tap(F.locator(".lk-bar .tc-italic")));
      await control("majuscules", "textTransform", () => tap(F.locator(".lk-bar .tc-caps")));
      await control("espacement des lettres", "letterSpacing", () => tap(F.locator('.lk-bar [aria-label="Espacer les lettres"]')));
      await control("couleur de la palette", "color", () => tap(F.locator(".lk-bar .tc-swatch[role=radio]").nth(2)));
      await control("alignement", "textAlign", () => tap(F.locator('.lk-bar [aria-label="Alignement"] [role=radio]').nth(1)));
      await control("roue des couleurs", "color", async () => {
        await tap(F.locator(".lk-bar .tc-wheel"));
        const plane = F.locator(".cp .cp-sv").first();
        await plane.waitFor({ timeout: 5000 });
        await gesture(page, touch, plane, 0.8, 0.3);
      });
      await F.locator(".lk-bar .cp-foot button", { hasText: "Fermer" }).click().catch(() => {});
      ok(`${name} · fond du texte : un choix ne ferme ni la barre ni la saisie`, await (async () => {
        await tap(F.locator('.lk-bar [data-backdrop]').nth(1));
        await sleep(500);
        return still();
      })());
      // On tape encore : le texte a gardé (ou retrouvé) le focus.
      const marker = `Zq${name.length}`;
      await page.keyboard.type(marker);
      ok(`${name} · on peut encore taper dans le texte après tous ces choix`, await until(async () => (await para.textContent())?.includes(marker), 5000), (await para.textContent())?.slice(0, 80));
      // Valider, recharger : valeurs conservées.
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !/Enregistrement/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, { timeout: 120000 });
      await sleep(800);
      await page.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
      const F2 = await canvas(page);
      await sleep(1800);
      const after = await readStyle(F2);
      for (const k of Object.keys(lastKey)) ok(`${name} · ${k} conservé après rechargement`, k === "color" || after[k] === lastKey[k], `${after[k]} / ${lastKey[k]}`);
      ok(`${name} · couleur conservée après rechargement`, near(rgbOf(after.color), rgbOf(lastKey.color), 2), `${after.color} / ${lastKey.color}`);
      ok(`${name} · le texte tapé est conservé`, ((await F2.locator(PARA).first().textContent()) ?? "").includes(marker));
      if (!touch) {
        ok(`${name} · publication`, await publishNow(page));
        const pub = await ctx.newPage();
        await pub.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
        const pr = await pub.evaluate(([props]) => { const e = [...document.querySelectorAll("p")].find((p) => /Texte d.essai/.test(p.textContent)); const cs = getComputedStyle(e); return Object.fromEntries(props.map((p) => [p, cs[p]])); }, [PROPS]);
        for (const k of ["fontFamily", "fontSize", "fontWeight", "fontStyle", "textTransform", "letterSpacing", "textAlign"]) ok(`${name} · publié : ${k}`, pr[k] === after[k], `${pr[k]} / ${after[k]}`);
        await pub.close();
      }
      await page.screenshot({ path: path.join(SHOTS, `A-${name.replace(/\W+/g, "-")}.png`) }).catch(() => {});
    } catch (e) {
      ok(`${name} : exception inattendue`, false, String(e.stack ?? e.message).split("\n").slice(0, 6).join(" | "));
    }
    await ctx.close();
  }
}

/* ================================================ P : position des listes de la barre « Aa » ================================================ */
if (run("P")) {
  const SIZES = [
    ["souris 1024", { viewport: { width: 1024, height: 800 } }, false],
    ["tactile 720", { viewport: { width: 720, height: 800 }, hasTouch: true, isMobile: true }, true],
    ["tactile 390", { viewport: { width: 390, height: 700 }, hasTouch: true, isMobile: true }, true],
  ];
  for (const [name, opts, touch] of SIZES) {
    const { ctx, page } = await authed(opts);
    try {
      const F = await openEditorOn(page);
      const para = F.locator(PARA).first();
      await para.scrollIntoViewIfNeeded();
      const b = await para.boundingBox();
      if (touch && opts.viewport.width < 600) await para.dispatchEvent("dblclick");
      else if (touch) {
        const ty = Math.max(8, b.height - 8);
        await page.touchscreen.tap(b.x + 30, b.y + ty);
        await sleep(80);
        await page.touchscreen.tap(b.x + 30, b.y + ty);
      } else await para.dblclick({ position: { x: 30, y: 8 } });
      ok(`${name} · P saisie et barre ouvertes`, await until(async () => (await F.locator(".lk-bar").count()) === 1 && (await F.locator("[data-editing]").count()) >= 1, 10000));
      const tap = (loc) => (touch ? loc.tap() : loc.click());
      const geo = (btn, list) => F.evaluate(([bs, ls]) => {
        const bt = document.querySelector(bs)?.getBoundingClientRect();
        const li = document.querySelector(ls)?.getBoundingClientRect();
        return bt && li ? { b: [bt.left, bt.top, bt.right, bt.bottom], l: [li.left, li.top, li.right, li.bottom], vw: document.documentElement.clientWidth, vh: window.innerHeight } : null;
      }, [btn, list]);
      /** Liste ancrée à son bouton (juste dessous ou juste dessus, sans trou de plus de 24 px) et toute dans l'écran. */
      const anchored = (label, g) => {
        if (!g) return ok(`${name} · ${label} : la liste est ouverte`, false);
        const [bl, bt, br, bb] = g.b, [ll, lt, lr, lb] = g.l;
        const below = lt >= bb - 1 && lt - bb <= 24, above = lb <= bt + 1 && bt - lb <= 24;
        ok(`${name} · ${label} : ancrée à son bouton (dessous ${Math.round(lt - bb)} px, dessus ${Math.round(bt - lb)} px)`, below || above);
        ok(`${name} · ${label} : toute dans l'écran`, ll >= -1 && lr <= g.vw + 1 && lt >= -1 && lb <= g.vh + 1, `[${g.l.map(Math.round)}] écran ${g.vw}x${g.vh}`);
        ok(`${name} · ${label} : alignée sur son bouton (horizontalement)`, ll <= br && lr >= bl);
      };
      await tap(F.locator(".lk-bar .tc-font"));
      await F.locator(".fm").waitFor({ timeout: 5000 });
      await sleep(400);
      anchored("liste des polices", await geo(".lk-bar .tc-font", ".fm"));
      await F.locator(".fm-search").press("Escape").catch(() => {});
      await sleep(300);
      if (await F.locator(".fm").count()) await tap(F.locator(".lk-bar .tc-font"));
      await sleep(300);
      for (const [i, label] of [[0, "liste des tailles"], [1, "liste des graisses"]]) {
        await tap(F.locator(".lk-bar .ms-button").nth(i));
        await F.locator(".ms-list").waitFor({ timeout: 5000 });
        await sleep(300);
        anchored(label, await F.evaluate(([n]) => { const bt = document.querySelectorAll(".lk-bar .ms-button")[n].getBoundingClientRect(); const li = document.querySelector(".ms-list").getBoundingClientRect(); return { b: [bt.left, bt.top, bt.right, bt.bottom], l: [li.left, li.top, li.right, li.bottom], vw: document.documentElement.clientWidth, vh: window.innerHeight }; }, [i]));
        await F.locator(".ms-list").press("Escape").catch(() => {});
        await sleep(300);
      }
      await page.screenshot({ path: path.join(SHOTS, `P-${name.replace(/\W+/g, "-")}.png`) }).catch(() => {});
    } catch (e) {
      ok(`${name} : P exception inattendue`, false, String(e.stack ?? e.message).split("\n").slice(0, 6).join(" | "));
    }
    await ctx.close();
  }
}

ok("aucune erreur de page (pageerror)", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} ÉCHEC(S)` : "\nTout passe.");
process.exit(failures ? 1 : 0);
