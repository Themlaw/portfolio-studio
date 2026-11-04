#!/usr/bin/env node
/**
 * Lot 110 « roue des couleurs qui ne ferme plus rien, et couleur du trait du kit », UN chromium. Serveur requis, base NEUVE, une connexion admin.
 * Données SYNTHÉTIQUES (images peintes, kit synthétique du lot 99 : jamais le kit de l'artiste).
 *
 *  A  Roue des couleurs, depuis chaque endroit où elle s'ouvre : texte EN SAISIE (barre « Aa »), texte seulement choisi (barre « Aa »),
 *     Fond & carte d'un bloc, panneau Couleurs du site, sélecteur de l'administration (couleur des boutons d'une page). Souris et tactile,
 *     1024 et 390 px. Un clic / un toucher / un glisser dans le carré et la bande ne ferme NI la roue, NI la barre, NI le menu, NI l'éditeur ;
 *     la couleur s'applique (mesurée), survit au rechargement et à la publication (texte).
 *  B  Couleur du trait du kit : par défaut du site, soulignement de l'en-tête, chaque rangée d'images qui défilent. Teinte + opacité mélangées au
 *     dessin d'origine (barre en couleurs d'origine : pixels ; soulignement : couleur calculée), éditeur ET public, valeurs par endroit,
 *     défaut strictement inchangé (aucune variable --stroke-, mêmes pixels, mêmes styles), retour au dessin d'origine.
 * Usage : BASE=… ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… [ONLY=A,B] node scripts/e2e-couleur110.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium, firefox } from "playwright";
import sharp from "sharp";

import { paint } from "./lib/crop-fixtures.mjs";
import { installKitFrameTheme } from "./lib/cadres62.mjs";
import { canvas, login, pageIdOf, q1, setBoardDraft, setDraft, sleep, sql, waitFor } from "./lib/grille31d.mjs";

const BASE = process.env.BASE ?? "http://localhost:3001";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(process.env.BATTERY_DIR ?? tmpdir(), "shots-couleur110");
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

/* ================================================ A : la roue ======================================================================== */
if (run("A")) {
  for (const [name, opts, touch] of MODES.filter((_, i) => !process.env.BATT_MODE || String(i) === process.env.BATT_MODE)) {
    const { ctx, page } = await authed(opts);
    try {
      const F = await openEditorOn(page);
      const PARA = '[data-inline="paragraphs.0"]';
      const para = F.locator(PARA).first();
      await para.scrollIntoViewIfNeeded();
      /** Les gestes dans la roue (un geste dans le carré, la bande, un glisser) ; `still()` dit si tout est resté ouvert. */
      const wheelTour = async (label, { root, still, applied, host = F, scope = ".cp" }) => {
        const cp = host.locator(scope).first();
        ok(`${name} · ${label} : la roue est ouverte`, await cp.waitFor({ timeout: 8000 }).then(() => true, () => false));
        await sleep(400);
        const plane = host.locator(`${scope} .cp-sv`).first();
        const hue = host.locator(`${scope} .cp-hue`).first();
        const before = await applied();
        await gesture(page, touch, plane, 0.3, 0.3);
        await sleep(500);
        ok(`${name} · ${label} : un ${touch ? "toucher" : "clic"} dans le carré ne ferme rien`, await still(), "fermé");
        ok(`${name} · ${label} : la couleur s'applique (carré)`, await until(async () => (await applied()) !== before, 8000));
        const afterPlane = await applied();
        await gesture(page, touch, hue, 0.5, 0.6);
        await sleep(500);
        ok(`${name} · ${label} : un geste sur la bande de teinte ne ferme rien`, await still());
        ok(`${name} · ${label} : la teinte change la couleur`, await until(async () => (await applied()) !== afterPlane, 8000));
        const afterHue = await applied();
        await drag(page, touch, plane, [0.2, 0.2], [0.8, 0.7]);
        await sleep(600);
        ok(`${name} · ${label} : un glisser dans le carré ne ferme rien (aperçu en direct)`, await still());
        ok(`${name} · ${label} : le glisser change la couleur`, await until(async () => (await applied()) !== afterHue, 8000));
        void root;
        return applied();
      };

      /* A1 : texte EN SAISIE (double-clic / double-toucher), barre « Aa » ouverte par la saisie. */
      {
        const b = await para.boundingBox();
        if (touch) {
          const ty = Math.max(8, b.height - 8); // la barre du bloc recouvre le haut du texte sur un écran étroit : on touche sa dernière ligne
          if (opts.viewport.width >= 600) {
            await page.touchscreen.tap(b.x + 30, b.y + ty);
            await sleep(80);
            await page.touchscreen.tap(b.x + 30, b.y + ty);
          } else await para.dispatchEvent("dblclick"); // 390 px : la barre du bloc recouvre le texte au premier toucher ; la saisie est lancée par l'évènement, les gestes de la roue restent tactiles
        } else await para.dblclick({ position: { x: 30, y: 8 } });
        ok(`${name} · A1 saisie ouverte, barre « Aa » ouverte`, await until(async () => (await F.locator(".lk-bar").count()) === 1 && (await F.locator("[data-editing]").count()) >= 1, 10000));
        await (touch ? F.locator(".lk-bar .tc-wheel").tap() : F.locator(".lk-bar .tc-wheel").click());
        const colorOf = () => F.evaluate((s) => getComputedStyle(document.querySelector(s)).color, PARA);
        const still = async () => (await F.locator(".lk-bar").count()) === 1 && (await F.locator(".lk-bar .cp").count()) === 1 && (await alive(page, F));
        const last = await wheelTour("texte en saisie", { root: ".lk-bar", still, applied: colorOf });
        ok(`${name} · A1 la saisie du texte est toujours en cours après les gestes`, (await F.locator("[data-editing]").count()) >= 1);
        // Persistance : on valide, on recharge, la couleur est au brouillon puis en ligne.
        await F.locator(".lk-bar .cp-foot button", { hasText: "Fermer" }).click().catch(() => {});
        await page.keyboard.press("Escape");
        await page.waitForFunction(() => !/Enregistrement/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, { timeout: 120000 });
        await sleep(800);
        const F2 = await (async () => {
          await page.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
          const f = await canvas(page);
          await sleep(1800);
          return f;
        })();
        const reloaded = await F2.evaluate((s) => getComputedStyle(document.querySelector(s)).color, PARA);
        ok(`${name} · A1 la couleur survit au rechargement (${reloaded})`, near(rgbOf(reloaded), rgbOf(last), 2), `${reloaded} / ${last}`);
        if (!touch && name.startsWith("souris")) {
          ok(`${name} · A1 publication`, await publishNow(page));
          const pub = await ctx.newPage();
          await pub.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
          const pc = await pub.evaluate(() => [...document.querySelectorAll("p")].find((p) => /Texte d.essai/.test(p.textContent))?.style.color || getComputedStyle([...document.querySelectorAll("p")].find((p) => /Texte d.essai/.test(p.textContent))).color);
          ok(`${name} · A1 couleur publiée = couleur choisie (${pc})`, near(rgbOf(pc), rgbOf(last), 2), `${pc} / ${last}`);
          await pub.close();
        }
        await page.screenshot({ path: path.join(SHOTS, `A1-${name.replace(/\W+/g, "-")}.png`) }).catch(() => {});
      }

      /* A1b : texte seulement CHOISI (barre ouverte par « Aa » au survol : souris seulement, le toucher n'a pas de survol, sa barre s'ouvre par la saisie, A1). */
      if (!touch) {
        const F3 = await openEditorOn(page);
        const t = F3.locator(PARA).first();
        await t.scrollIntoViewIfNeeded();
        let opened = false;
        for (let i = 0; i < 4 && !opened; i++) {
          await page.mouse.move(5, 5);
          await sleep(150);
          const b = await t.boundingBox();
          if (touch) await page.touchscreen.tap(b.x + 20, b.y + 6);
          else await t.hover();
          await sleep(500);
          const aa = F3.locator(".lk-aa");
          if (await aa.count()) {
            await (touch ? aa.tap().catch(() => {}) : aa.click().catch(() => {}));
            opened = await until(async () => (await F3.locator(".lk-bar").count()) === 1, 5000);
          }
        }
        ok(`${name} · A1b barre « Aa » ouverte sans saisie`, opened);
        if (opened) {
          await (touch ? F3.locator(".lk-bar .tc-wheel").tap() : F3.locator(".lk-bar .tc-wheel").click());
          const still = async () => (await F3.locator(".lk-bar .cp").count()) === 1 && (await alive(page, F3));
          await wheelTour("texte choisi", { still, applied: () => F3.evaluate((s) => getComputedStyle(document.querySelector(s)).color, PARA), host: F3 });
        }
      }

      /* A2 : Fond & carte d'un bloc. */
      {
        const F4 = await openEditorOn(page);
        const blk = F4.locator("[data-edit-block]:not([data-edit-parent])").first();
        await blk.scrollIntoViewIfNeeded();
        await (touch ? blk.tap() : blk.click());
        const btn = F4.locator('.pe-tools [data-testid="fond-button"]');
        await btn.waitFor({ timeout: 20000 });
        await (touch ? btn.tap() : btn.click());
        const menu = F4.locator('[data-testid="fond-menu"]');
        await menu.waitFor({ timeout: 20000 });
        await F4.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
        await (touch ? menu.locator('[data-testid="fond-section-fond"] [data-kind="color"]').tap() : menu.locator('[data-testid="fond-section-fond"] [data-kind="color"]').click());
        const w = menu.locator('.tc-wheel[aria-label="Couleur personnalisée"]').first();
        await w.scrollIntoViewIfNeeded();
        await (touch ? w.tap() : w.click());
        const dot = () => w.evaluate((el) => el.querySelector(".tc-wheel-dot")?.style.background ?? "none");
        await wheelTour("Fond & carte", { still: async () => (await menu.isVisible()) && (await F4.locator(".cp").count()) === 1 && (await alive(page, F4)), applied: async () => {
          const d = await dot();
          return d;
        }, host: F4 });
      }

      /* A3 : panneau Couleurs du site (dans le panneau de l'éditeur, hors toile ; sur 390 px il est dans un tiroir : non couvert ici, voir le rapport). */
      if (opts.viewport.width >= 600) {
        await openEditorOn(page);
        await page.getByRole("tab", { name: "Réglages" }).click().catch(() => {});
        if (touch && opts.viewport.width < 600) await sleep(500);
        const role = page.locator(".lc-role").first();
        await role.scrollIntoViewIfNeeded();
        await (touch ? role.tap() : role.click());
        const chip = () => role.locator(".lc-chip").evaluate((el) => el.style.background);
        await wheelTour("panneau Couleurs", { still: async () => (await page.locator(".lc-role[aria-expanded=true]").count()) === 1 && (await page.locator(".cp").count()) === 1 && (await page.locator("iframe.ve-frame").count()) === 1, applied: chip, host: page });
      }

      /* A4 : sélecteur de l'administration (couleur des boutons d'une page). */
      {
        await page.goto(`${BASE}/admin/pages/${pageId}`, { waitUntil: "networkidle" });
        const sw = page.getByRole("switch", { name: "Boutons et liens de cette page" });
        if (!(await sw.isChecked())) await page.locator("label.a-toggle", { hasText: "Boutons et liens de cette page" }).click();
        const chip = page.locator('[data-testid="page-buttons-color"] .cpw-chip');
        await chip.waitFor({ timeout: 10000 });
        await (touch ? chip.tap() : chip.click());
        await wheelTour("administration", { still: async () => (await page.locator(".cp").count()) === 1 && /admin\/pages\/\d+$/.test(page.url()), applied: () => chip.evaluate((el) => el.style.background), host: page });
      }
    } catch (e) {
      ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 6).join(" "));
      await page.screenshot({ path: path.join(SHOTS, `erreur-A-${name.replace(/\W+/g, "-")}.png`) }).catch(() => {});
    } finally {
      await ctx.close();
    }
  }
}

/* ================================================ B : le trait ======================================================================= */
if (run("B")) {
  try {
    await installKitFrameTheme(setup, BASE, undefined, "defil99");
    seed();
    const { ctx, page } = await authed({ viewport: { width: 1440, height: 900 } });
    const PUBLIC = `${BASE}/fr/personnages`;
    const pubPage = async () => {
      const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
      const p = await c.newPage();
      p.setDefaultTimeout(45000);
      p.on("pageerror", (e) => errors.push(`public : ${e.message}`));
      await p.goto(PUBLIC, { waitUntil: "networkidle" });
      await p.evaluate(() => document.fonts.ready);
      return { c, p };
    };
    /** Mesures du trait : soulignement de la page courante, et pour chaque barre : couleur moyenne de la poignée (pixels) et variables lues. */
    const measure = async (p, target) => {
      await p.mouse.move(2, 2);
      await sleep(300);
      const under = await p.evaluate(() => {
        const el = document.querySelector(".site-header .nav-underline.w-full") ?? document.querySelector(".site-header .nav-underline");
        return el ? { bg: getComputedStyle(el).backgroundColor, h: getComputedStyle(el).height } : null;
      });
      await until(async () => (await p.locator(".rail-bar:not([hidden])").count()) >= 2, 30000);
      const bars = [];
      const n = await p.locator(".rail-bar").count();
      for (let i = 0; i < n; i++) {
        const bar = p.locator(".rail-bar").nth(i);
        await bar.scrollIntoViewIfNeeded();
        await sleep(300);
        const vars = await bar.evaluate((el) => {
          const cs = getComputedStyle(el);
          return { c: cs.getPropertyValue("--stroke-c").trim(), a: cs.getPropertyValue("--stroke-a").trim() };
        });
        const th = p.locator(".rail-bar-thumb").nth(i);
        const buf = await th.screenshot({ type: "png" });
        const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        // Bande centrale de la poignée (hors bouts arrondis), moyenne par canal.
        const x0 = Math.floor(info.width * 0.3);
        const x1 = Math.floor(info.width * 0.7);
        const y0 = Math.floor(info.height * 0.35);
        const y1 = Math.ceil(info.height * 0.65);
        const sum = [0, 0, 0];
        let cnt = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) for (let k = 0; k < 3; k++) sum[k] += data[(y * info.width + x) * 4 + k], k === 2 && cnt++;
        bars.push({ mean: sum.map((s) => s / Math.max(1, cnt)), vars });
      }
      void target;
      return { under, bars, html: await p.content() };
    };
    const base = await (async () => {
      const { c, p } = await pubPage();
      const m = await measure(p);
      await c.close();
      return m;
    })();
    info("trait · mesure de départ", { under: base.under, barres: base.bars.length, moyennes: base.bars.map((b) => b.mean.map(Math.round)) });
    ok("B0 deux barres (projet + carrousel) et un soulignement mesurés", base.bars.length >= 2 && Boolean(base.under));
    ok("B0b défaut : aucune variable --stroke- dans la page publique", !/--stroke-/.test(base.html));
    ok("B0c défaut : aucune variable --stroke- lue sur les barres", base.bars.every((b) => !b.vars.c && !b.vars.a));

    const F = await openEditorOn(page);
    const settle = async () => {
      await page.waitForFunction(() => !/Enregistrement/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, { timeout: 120000 });
      await sleep(800);
    };
    /** Règle une section StrokeField : couleur (code hexadécimal dans la roue) puis opacité (curseur). */
    const setStroke = async (testid, hex, opacity) => {
      const sec = page.locator(`[data-testid="${testid}"]`);
      await sec.scrollIntoViewIfNeeded();
      await sec.locator(".cpw-chip").click();
      const input = page.locator('.cp input[aria-label="Code couleur"]');
      await input.fill(hex);
      await input.press("Enter");
      await sleep(400);
      await page.keyboard.press("Escape");
      const slider = sec.locator('input[type="range"]');
      await slider.evaluate((el, v) => {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        set.call(el, String(v));
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }, opacity);
      await settle();
    };
    const SITE = { hex: "#e11d48", a: 0.5 };
    const HEAD = { hex: "#2563eb", a: 0.8 };
    const RAIL = { hex: "#16a34a", a: 0.7 };

    /* B1 : défaut du site. */
    await page.getByRole("tab", { name: "Réglages" }).click().catch(() => {});
    await setStroke("site-stroke", SITE.hex, Math.round(SITE.a * 100));
    const live = await F.evaluate(() => ({ c: getComputedStyle(document.documentElement).getPropertyValue("--stroke-c").trim(), a: getComputedStyle(document.documentElement).getPropertyValue("--stroke-a").trim() }));
    ok("B1 éditeur : la couleur du site est posée en direct sur la toile", live.c === "#e11d48" && live.a === "50%", JSON.stringify(live));
    const editorBar = await F.evaluate(() => {
      const el = document.querySelector(".site-header .nav-underline");
      return el ? getComputedStyle(el).backgroundColor : null;
    });
    ok("B1b éditeur : le soulignement de l'en-tête prend la couleur du site", Boolean(editorBar) && !near(rgbOf(editorBar), rgbOf(base.under.bg), 3), `${editorBar} / ${base.under.bg}`);
    const draftStyles = sql((db) => JSON.parse(db.prepare("select value from settings where key = 'siteDraft'").get()?.value ?? "null"))?.snap?.styles?.stroke;
    ok("B1c brouillon du site : stroke.all = {#e11d48, 50}", draftStyles?.all?.color === SITE.hex && draftStyles?.all?.opacity === 50, JSON.stringify(draftStyles));
    const logRow = sql((db) => {
      try {
        return null;
      } catch {
        return null;
      }
    });
    void logRow;

    /* B2 : soulignement de l'en-tête (réglage propre). */
    await F.locator(".site-header").first().click({ position: { x: 4, y: 4 } }).catch(() => {});
    await F.locator("[data-edit-global=header]").first().click({ position: { x: 8, y: 8 }, force: true }).catch(() => {});
    const hs = page.locator('[data-testid="header-stroke"]');
    ok("B2 l'en-tête choisi montre son réglage « Couleur du soulignement »", await hs.waitFor({ timeout: 15000 }).then(() => true, () => false));
    await setStroke("header-stroke", HEAD.hex, Math.round(HEAD.a * 100));

    /* B3 : une rangée (le carrousel c1). */
    const pickRail = async (fr) => {
      const frame = fr.locator('[data-edit-bitem="c1"]').first();
      await frame.scrollIntoViewIfNeeded();
      const b = await frame.boundingBox();
      await page.mouse.move(b.x + 30, b.y + 30);
      await sleep(400);
      await frame.locator('[data-edit-bitem-op="settings"]').first().click({ force: true });
    };
    await pickRail(F);
    await page.getByRole("tab", { name: "Réglages" }).click().catch(() => {});
    const rs = page.locator('[data-testid="rail-stroke"]');
    ok("B3 la rangée choisie montre « Couleur du trait »", await rs.waitFor({ timeout: 15000 }).then(() => true, () => false));
    await setStroke("rail-stroke", RAIL.hex, Math.round(RAIL.a * 100));
    const c1Stroke = () => sql((db) => JSON.parse(db.prepare("select draft_layout from projects where id = ?").get(PROJECT.id)?.draft_layout ?? "null"))?.find?.((i) => i.uid === "c1")?.props?.stroke;
    await until(async () => c1Stroke()?.opacity === 70, 15000);
    const layoutC1 = { props: { stroke: c1Stroke() } };
    ok("B3b brouillon de la planche : props.stroke de la rangée = {#16a34a, 70}", layoutC1?.props?.stroke?.color === RAIL.hex && layoutC1?.props?.stroke?.opacity === 70, JSON.stringify(layoutC1?.props?.stroke));
    await page.screenshot({ path: path.join(SHOTS, "B3-editeur.png") }).catch(() => {});

    /* Publication, puis mesures sur le site public. */
    ok("B4 publication", await publishNow(page));
    const { c: pc, p: pp } = await pubPage();
    const after = await measure(pp);
    await pp.screenshot({ path: path.join(SHOTS, "B4-public.png") }).catch(() => {});
    await pc.close();
    ok("B4b public : variables du site dans la feuille (--stroke-c, --stroke-nav-c)", /--stroke-c:#e11d48/.test(after.html) && /--stroke-nav-c:#2563eb/.test(after.html));
    // Soulignement : teinte de l'en-tête (80 %) sur la couleur d'origine.
    const wantUnder = blend(rgbOf(base.under.bg), hexRgb(HEAD.hex), HEAD.a);
    ok(`B5 public : soulignement = couleur d'origine + ${HEAD.hex} à ${HEAD.a * 100} % (${after.under.bg})`, near(rgbOf(after.under.bg), wantUnder, 6), `${after.under.bg} / attendu ${wantUnder.map(Math.round)}`);
    // Barre 1 (projet) : réglage du site ; barre 2 (carrousel) : son propre réglage.
    ok("B4c public : les deux barres sont mesurées", after.bars.length >= 2, String(after.bars.length));
    const [b1, b2] = after.bars;
    const w1 = blend(base.bars[0].mean, hexRgb(SITE.hex), SITE.a);
    const w2 = blend(base.bars[1].mean, hexRgb(RAIL.hex), RAIL.a);
    ok(`B6 public : la barre du projet porte la couleur du site (${b1.mean.map(Math.round)} ≈ ${w1.map(Math.round)})`, near(b1.mean, w1, 18), `${b1.mean} / ${w1}`);
    ok(`B7 public : la barre du carrousel porte SA couleur (${b2.mean.map(Math.round)} ≈ ${w2.map(Math.round)})`, near(b2.mean, w2, 18), `${b2.mean} / ${w2}`);
    ok("B7b public : chaque endroit a sa couleur (les deux barres diffèrent)", !near(b1.mean, b2.mean, 25));
    ok("B7c public : la variable propre de la rangée est posée sur sa barre seulement", b2.vars.c === RAIL.hex && b1.vars.c === SITE.hex, JSON.stringify([b1.vars, b2.vars]));

    /* Rechargement de l'éditeur : les réglages sont relus. */
    const F5 = await openEditorOn(page);
    const reread = await F5.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--stroke-c").trim());
    ok("B8 éditeur rouvert : la couleur du site est relue", reread === "#e11d48", reread);

    /* B9 : retour au dessin d'origine. */
    await page.getByRole("tab", { name: "Réglages" }).click().catch(() => {});
    const resetFor = async (testid) => {
      const b = page.locator(`[data-testid="${testid}-reset"]`);
      await b.scrollIntoViewIfNeeded();
      if (await b.isEnabled()) await b.click();
      await settle();
    };
    await resetFor("site-stroke");
    await F5.locator("[data-edit-global=header]").first().click({ position: { x: 8, y: 8 }, force: true }).catch(() => {});
    await page.locator('[data-testid="header-stroke"]').waitFor({ timeout: 15000 });
    await resetFor("header-stroke");
    await pickRail(F5);
    await page.locator('[data-testid="rail-stroke"]').waitFor({ timeout: 15000 });
    await resetFor("rail-stroke");
    ok("B9 publication après retour au dessin d'origine", await publishNow(page));
    const { c: rc, p: rp } = await pubPage();
    const reset = await measure(rp);
    await rc.close();
    ok("B9b défaut retrouvé : aucune variable --stroke- dans la page publique", !/--stroke-/.test(reset.html));
    ok("B9c soulignement identique au départ", near(rgbOf(reset.under.bg), rgbOf(base.under.bg), 1), `${reset.under.bg} / ${base.under.bg}`);
    ok("B9d barres identiques au départ (pixels)", reset.bars.every((b, i) => near(b.mean, base.bars[i].mean, 6)), JSON.stringify(reset.bars.map((b) => b.mean.map(Math.round))));
    await ctx.close();
  } catch (e) {
    ok("B : exception inattendue", false, String(e.stack ?? e.message).split("\n").slice(0, 8).join(" | "));
    await setup.screenshot({ path: path.join(SHOTS, "erreur-B.png") }).catch(() => {});
  }
}


/* ================================================ C : le liseré du coin arrondi ====================================================== */
/* Un contour épais aux coins arrondis : sur le bord COURBE extérieur (et intérieur) du contour, aucun pixel ne doit porter la couleur du fond de la
   zone (Carte ou Fond) peint dessous. Anticrénelage : un pixel du bord est un mélange contour / dehors (ou contour / dedans) ; s'il s'écarte de ce
   segment de couleurs, c'est que la couleur de la zone transparaît. Mesuré sur les quatre coins, zoom 1× et 2×, coins s/m/l, contour moyen et épais. */
if (run("C")) {
  try {
    const PINK = "#ff2d95", INK = "#101010", GREEN = "#2ecc71";
    const CASES = [];
    for (const c of ["s", "m", "l"]) for (const bw of ["medium", "thick"]) {
      CASES.push({ name: `carte · coins ${c} · ${bw}`, props: { surface: { color: PINK, corners: c, width: "inset", border: { width: bw, color: INK } } } });
      CASES.push({ name: `fond en retrait · coins ${c} · ${bw}`, props: { background: { kind: "color", color: PINK, round: c, inset: "m", border: { width: bw, color: INK } } } });
      CASES.push({ name: `carte autour d'un fond · coins ${c} · ${bw}`, props: { surface: { color: GREEN, corners: c, width: "inset", border: { width: bw, color: INK } }, background: { kind: "color", color: PINK, round: c, inset: "m", border: { width: bw, color: INK } } } });
      CASES.push({ name: `fond autour d'une carte · coins ${c} · ${bw}`, props: { background: { kind: "color", color: GREEN, round: c, inset: "m", border: { width: bw, color: INK }, card: { kind: "color", color: PINK, round: c, border: { width: bw, color: INK } } } } });
    }
    const blocks = CASES.map((k, n) => ({ uid: `c110${n}`, type: "rich-text", props: { paragraphs: [T(`C110x${n}x texte`)], ...k.props } }));
    setDraft(pageId, blocks);
    const { ctx, page } = await authed({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
    await canvas(page);
    await sleep(2000);
    ok("C0 publication des cas de coins", await publishNow(page));
    await ctx.close();
    const dist2seg = (p, a, b) => {
      const ab = b.map((v, i) => v - a[i]);
      const ap = p.map((v, i) => v - a[i]);
      const t = Math.max(0, Math.min(1, ap.reduce((s2, v, i) => s2 + v * ab[i], 0) / Math.max(1e-9, ab.reduce((s2, v) => s2 + v * v, 0))));
      return Math.hypot(...p.map((v, i) => v - (a[i] + t * ab[i])));
    };
    for (const dsf of [1, 2]) {
      const c2 = await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: dsf });
      const p2 = await c2.newPage();
      p2.setDefaultTimeout(60000);
      await p2.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
      for (const [n, k] of CASES.entries()) {
        const zones = await p2.evaluateHandle((t) => {
          const e = [...document.querySelectorAll("p")].find((x) => x.textContent.includes(t));
          return [...document.querySelectorAll(".zone")].filter((z) => z.contains(e) && getComputedStyle(z).borderTopWidth !== "0px" && parseFloat(getComputedStyle(z).borderTopLeftRadius) > 0);
        }, `C110x${n}x`);
        const count = await zones.evaluate((zs) => zs.length);
        let worst = 0, innerWorst = 0, where = "", measured = 0;
        for (let i = 0; i < Math.min(count, 1); i++) {
          const el = (await zones.evaluateHandle((zs, j) => zs[j], i)).asElement();
          await el.scrollIntoViewIfNeeded();
          const info = await el.evaluate((z) => {
            const cs = getComputedStyle(z);
            const r = z.getBoundingClientRect();
            return { w: r.width, h: r.height, bw: parseFloat(cs.borderTopWidth), R: ["TopLeft", "TopRight", "BottomRight", "BottomLeft"].map((q) => parseFloat(cs[`border${q}Radius`])), bc: cs.borderTopColor, bg: cs.getPropertyValue("--card-bg").trim() || cs.backgroundColor };
          });
          const buf = await el.screenshot({ type: "png" });
          const { data, info: im } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
          const S = im.width / info.w;
          const at = (x, y) => [0, 1, 2].map((q) => data[(Math.min(im.height - 1, Math.max(0, Math.round(y))) * im.width + Math.min(im.width - 1, Math.max(0, Math.round(x)))) * 3 + q]);
          const INKRGB = rgbOf(info.bc);
          for (let corner = 0; corner < 4; corner++) {
            const R = Math.min(info.R[corner], info.w / 2, info.h / 2) * S;
            const bw = info.bw * S;
            if (R < 3 || bw < 2) continue;
            const sx = corner === 0 || corner === 3 ? 1 : -1;
            const sy = corner === 0 || corner === 1 ? 1 : -1;
            const px = (x, y) => at(sx > 0 ? x : im.width - 1 - x, sy > 0 ? y : im.height - 1 - y);
            const OUT = px(0, 0);
            const IN = rgbOf(info.bg);
            measured++;
            for (let a = 20; a <= 70; a += 3) {
              const rad = (a * Math.PI) / 180;
              for (const [rr, from, to, tag] of [[R, INKRGB, OUT, "extérieur"], ...(R - bw >= 4 ? [[R - bw, INKRGB, IN, "intérieur"]] : [])]) {
                for (const d of [-0.75, 0, 0.75]) {
                  const x = R - Math.cos(rad) * (rr + d);
                  const y = R - Math.sin(rad) * (rr + d);
                  const dev = dist2seg(px(x, y), from, to);
                  if (tag === "intérieur") { if (dev > innerWorst) innerWorst = dev; continue; }
                  if (dev > worst) [worst, where] = [dev, `zone ${i} coin ${corner} bord ${tag} angle ${a}° (${px(x, y)} entre ${from.map(Math.round)} et ${to.map(Math.round)})`];
                }
              }
            }
          }
        }
        info(`C ${dsf}× · ${k.name} : bord intérieur, écart max ${innerWorst.toFixed(0)}`);
        ok(`C ${dsf}× · ${k.name} : le bord courbe EXTÉRIEUR du contour ne porte pas la couleur de la zone (écart max ${worst.toFixed(0)}, ${measured} coins)`, measured > 0 && worst <= 40, where);
      }
      await c2.close();
    }
  } catch (e) {
    ok("C : exception inattendue", false, String(e.stack ?? e.message).split("\n").slice(0, 8).join(" | "));
  }
}


/* ================================================ C2 : liseré du coin, sur un papier peint ============================================ */
/* Cas de l'utilisateur : un Fond papier peint (motif contrasté, couleur dessous jaune pâle) autour d'une Carte lilas clair au contour rose épais, coins
   arrondis (« Fond autour d'une Carte », et « Carte dans un Fond en retrait »), plus la Carte à papier peint `paper: under`. Zoom 1×, 2× et 3×. Sur l'anneau de
   2 px autour de l'arc EXTÉRIEUR du contour de la Carte, chaque pixel est un mélange contour / papier peint voisin : aucune autre couleur (lilas de la carte,
   jaune dessous, blanc). Mesure : distance du pixel au segment [couleur du contour, pixel du papier peint juste à côté]. */
if (run("C") || run("C2")) {
  try {
    const PINK = "#ff2d95", LILAC = "#d9c8f5", YELLOW = "#fff3a8";
    const tile = path.join(tmpdir(), "tartan110.png");
    await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#f4e27a"/><rect x="0" y="6" width="48" height="10" fill="#2d6a4f"/><rect x="6" y="0" width="10" height="48" fill="#1d3557"/><rect x="0" y="30" width="48" height="4" fill="#d62828"/></svg>`)).png().toFile(tile);
    const before = sql((db) => db.prepare("select id from wallpapers").all()).length;
    await setup.goto(`${BASE}/admin/papiers-peints`, { waitUntil: "domcontentloaded" });
    await setup.locator('[data-testid="wallpaper-input"]').setInputFiles([tile]);
    await waitFor(async () => (await setup.locator('[data-testid="wallpaper"][data-status="ready"]').count()) >= before + 1, 180000);
    const WP = sql((db) => db.prepare("select id from wallpapers order by id").all()).map((r) => r.id).at(-1);
    const bord = { width: "thick", color: PINK };
    const CASES2 = [];
    for (const c of ["s", "m", "l"]) {
      CASES2.push({ name: `fond autour d'une carte · coins ${c}`, props: { background: { kind: "wallpaper", wallpaper: WP, color: YELLOW, round: c, inset: "m", card: { kind: "color", color: LILAC, round: c, border: bord } } } });
      CASES2.push({ name: `carte dans un fond en retrait · coins ${c}`, ext: "page", props: { surface: { color: LILAC, corners: c, width: "full", border: bord }, background: { kind: "wallpaper", wallpaper: WP, color: YELLOW, round: c, inset: "m" } } });
      CASES2.push({ name: `carte à papier dessous · coins ${c}`, ext: "page", props: { surface: { color: LILAC, corners: c, width: "inset", border: bord, paperWallpaper: WP, paper: "under" } } });
    }
    setDraft(pageId, CASES2.map((k, n) => ({ uid: `d110${n}`, type: "rich-text", props: { paragraphs: [T(`D110x${n}x texte`)], ...k.props } })));
    const { ctx, page } = await authed({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
    await canvas(page);
    await sleep(2000);
    ok("C2-0 publication des cas à papier peint", await publishNow(page));
    await ctx.close();
    const LILAC_RGB = [0xd9, 0xc8, 0xf5];
    /** Part de couleur de la carte (lilas) dans un pixel : pixel ≈ a·contour + b·lilas + (1−a−b)·papier, moindres carrés pour chaque couleur de papier possible ; on garde le meilleur ajustement. */
    const leakOf = (pt, ink, wps) => {
      let best = { res: 1e9, b: 0 };
      for (const w of wps) {
        const y = pt.map((v, i) => v - w[i]), u = ink.map((v, i) => v - w[i]), v2 = LILAC_RGB.map((v, i) => v - w[i]);
        const dot = (p1, p2) => p1.reduce((t, x, i) => t + x * p2[i], 0);
        const uu = dot(u, u), vv = dot(v2, v2), uv = dot(u, v2), yu = dot(y, u), yv = dot(y, v2);
        const det = uu * vv - uv * uv;
        if (Math.abs(det) < 1e-6) continue;
        const a = Math.max(0, Math.min(1, (yu * vv - yv * uv) / det));
        const b = Math.max(0, Math.min(1, (yv * uu - yu * uv) / det));
        const res = Math.hypot(...y.map((x, i) => x - a * u[i] - b * v2[i]));
        if (res < best.res) best = { res, b };
      }
      return best.b;
    };
    const PINK_RGB = [0xff, 0x2d, 0x95];
    const PAL = [[0xf4, 0xe2, 0x7a], [0x2d, 0x6a, 0x4f], [0xd6, 0x28, 0x28], [0x1d, 0x35, 0x57]];
    const dist2seg = (p, a, b) => {
      const ab = b.map((v, i) => v - a[i]);
      const ap = p.map((v, i) => v - a[i]);
      const t = Math.max(0, Math.min(1, ap.reduce((s2, v, i) => s2 + v * ab[i], 0) / Math.max(1e-9, ab.reduce((s2, v) => s2 + v * v, 0))));
      return Math.hypot(...p.map((v, i) => v - (a[i] + t * ab[i])));
    };
    const sane = Math.min(...[[0xd9, 0xc8, 0xf5], [0xff, 0xf3, 0xa8], [255, 255, 255]].map((f) => Math.min(...[PINK_RGB, ...PAL].flatMap((u, x) => [PINK_RGB, ...PAL].slice(x).map((v) => dist2seg(f, u, v))))));
    ok(`C2-1 les couleurs interdites (carte, dessous, blanc) sont loin de tout mélange contour / motif (${sane.toFixed(0)} > 40)`, sane > 40);
    for (const dsf of [1, 2, 3]) {
      const eng = process.env.BATT_C2_ENGINE === "firefox" ? await firefox.launch() : null;
      const c2 = await (eng ?? browser).newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: dsf });
      const p2 = await c2.newPage();
      p2.setDefaultTimeout(60000);
      await p2.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
      // A/B : BATT_C2_OLD=1 rend l'ancien dessin (couleur de la zone sous le contour) pour mesurer ce que le correctif change.
      if (process.env.BATT_C2_OLD) await p2.addStyleTag({ content: ".surface-card[data-border], .fond-bloc[data-fond-border] { background-image: none !important; background-clip: border-box !important; background-color: var(--card-bg) !important; }" });
      for (const [n, k] of CASES2.entries()) {
        const zones = await p2.evaluateHandle((t) => {
          const e = [...document.querySelectorAll("p")].find((x) => x.textContent.includes(t));
          return [...document.querySelectorAll(".zone")].filter((z) => z.contains(e) && parseFloat(getComputedStyle(z).borderTopWidth) >= 4 && parseFloat(getComputedStyle(z).borderTopLeftRadius) > 0);
        }, `D110x${n}x`);
        const count = await zones.evaluate((zs) => zs.length);
        let worst = 0, where = "", measured = 0, leak = 0, leakAt = "";
        for (let i = 0; i < count; i++) {
          const el = (await zones.evaluateHandle((zs, j) => zs[j], i)).asElement();
          await el.scrollIntoViewIfNeeded();
          const info = await el.evaluate((z) => {
            const cs = getComputedStyle(z);
            const r = z.getBoundingClientRect();
            return { w: r.width, h: r.height, bw: parseFloat(cs.borderTopWidth), R: ["TopLeft", "TopRight", "BottomRight", "BottomLeft"].map((q) => parseFloat(cs[`border${q}Radius`])), bc: cs.borderTopColor };
          });
          const shot = async () => {
            const buf = await el.screenshot({ type: "png" });
            const { data, info: im } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
            return { data, im };
          };
          const A = await shot();
          // Référence : la même zone dont la couleur de carte est remplacée par celle du contour (aucun lilas nulle part) ; tout écart avec le rendu réel sur l'anneau est de la couleur de la carte.
          await el.evaluate((z, c) => z.style.setProperty("--card-bg", c, "important"), info.bc);
          const B = await shot();
          await el.evaluate((z) => z.style.removeProperty("--card-bg"));
          const S = A.im.width / info.w;
          const mk = (sh) => (x, y) => [0, 1, 2].map((q) => sh.data[(Math.min(sh.im.height - 1, Math.max(0, Math.round(y))) * sh.im.width + Math.min(sh.im.width - 1, Math.max(0, Math.round(x)))) * 3 + q]);
          const atA = mk(A), atB = mk(B);
          const INK = rgbOf(info.bc);
          for (let corner = 0; corner < 4; corner++) {
            const R = Math.min(info.R[corner], info.w / 2, info.h / 2) * S;
            if (R < 6 * S) continue;
            const sx = corner === 0 || corner === 3 ? 1 : -1;
            const sy = corner === 0 || corner === 1 ? 1 : -1;
            const px = (at, x, y) => at(sx > 0 ? x : A.im.width - 1 - x, sy > 0 ? y : A.im.height - 1 - y);
            measured++;
            for (let a = 15; a <= 75; a += 3) {
              const rad = (a * Math.PI) / 180;
              const at2 = (at, rr) => px(at, R - Math.cos(rad) * rr, R - Math.sin(rad) * rr);
              for (const d of [-1.5, -1, -0.5, 0, 0.5, 1, 1.5]) {
                const pt = at2(atA, R + d * S);
                const ends = k.ext === "page" ? [INK, at2(atA, R + 4 * S)] : [INK, ...PAL];
                const dev = Math.min(...ends.flatMap((u, x) => ends.slice(x).map((v) => dist2seg(pt, u, v))));
                if (dev > worst) [worst, where] = [dev, `zone ${i} coin ${corner} angle ${a}° d ${d}px : ${pt} (contour ${INK.map(Math.round)})`];
                const diff = Math.hypot(...pt.map((v, q) => v - at2(atB, R + d * S)[q]));
                if (diff > leak) [leak, leakAt] = [diff, `zone ${i} coin ${corner} angle ${a}° d ${d}px : réel ${pt} / sans lilas ${at2(atB, R + d * S)}`];
              }
            }
          }
          if (process.env.BATT_SHOT && worst > 40) await el.screenshot({ path: path.join(SHOTS, `C2-${dsf}x-${n}-${i}.png`) });
        }
        ok(`C2 ${dsf}× · ${k.name} : l'anneau extérieur du contour ne porte que le contour et le papier peint (écart max ${worst.toFixed(0)}, ${measured} coins)`, measured > 0 && worst <= 40, where);
        ok(`C2 ${dsf}× · ${k.name} : aucune couleur de la carte (lilas) au bord extérieur du contour (écart max avec le rendu sans lilas : ${leak.toFixed(0)}/441)`, measured > 0 && leak <= 12, leakAt);
      }
      await c2.close();
      await eng?.close();
    }
  } catch (e) {
    ok("C2 : exception inattendue", false, String(e.stack ?? e.message).split("\n").slice(0, 8).join(" | "));
  }
}

ok("aucune erreur de page (pageerror)", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} ÉCHEC(S)` : "\nTout passe");
process.exit(failures ? 1 : 0);
