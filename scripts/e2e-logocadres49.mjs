#!/usr/bin/env node
/**
 * Lot 49 « logo à la couleur du thème, cadres qui ne s'appliquent pas » (ticket 34). Chromium, serveur requis, base neuve.
 *  LG  Logo : signature du kit (masque) et nom du site : la couleur choisie pour « Nom du site » (barre « Aa », Tous les « Nom du site »)
 *      s'applique à la signature dessinée, sur la toile et en public ; sans choix : l'encre du thème (parité).
 *  CD  Cadres : une photo cadrée (`look.frame` / `slotFrame` / `it.frame`) a sa bordure partout où on peut la poser (image seule, case de
 *      grille, grille justifiée, carte, fond, fond image, cadrage ancien, planche libre), sur la toile, en public, sur téléphone.
 *  KT  Kit PSD réimporté (logo en trois couleurs, cadre redessiné) : la revue dit que le logo garde ses couleurs, le thème porte `colors`,
 *      le public montre les trois couleurs d'origine (pas l'encre du thème) ; le cadre dessiné habille les photos (image seule, grille,
 *      planche libre, carrousel) en plus des entrées de collection ; un cadre choisi pour une photo passe avant.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=LG,CD] [SHOTS=dossier] node scripts/e2e-logocadres49.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";
import sharp from "sharp";

import { paint } from "./lib/crop-fixtures.mjs";
import { login, pageIdOf, q1, waitFor } from "./lib/medias-setup.mjs";
import { activateThemeUi, gotoThemesPage } from "./lib/theme-live.mjs";
import { gotoIdle } from "./lib/idle.mjs";

const BASE = process.env.BASE ?? "http://localhost:3340";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(tmpdir(), "e2e-logocadres49");
const DATA = process.env.DATA_DIR ?? "data";
const DB = path.join(DATA, "portfolio.db");
mkdirSync(SHOTS, { recursive: true });
sharp.cache(false);
sharp.concurrency(1);

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const info = (label, v) => console.log(`INFO ${label} : ${typeof v === "string" ? v : JSON.stringify(v)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (fn) => {
  const db = new Database(DB);
  db.pragma("busy_timeout = 5000");
  try {
    return fn(db);
  } finally {
    db.close();
  }
};

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
page.setDefaultNavigationTimeout(180000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);

async function canvas() {
  const handle = await page.waitForSelector("iframe.ve-frame", { timeout: 120000 });
  const fr = await handle.contentFrame();
  await fr.waitForSelector("html[data-edit-mode]", { timeout: 180000 });
  return fr;
}
async function openEditor(id) {
  await page.goto(`${BASE}/admin/pages/${id}/editer`, { waitUntil: "domcontentloaded" });
  const fr = await canvas();
  if (await page.getByRole("button", { name: "Abandonner les modifications" }).count()) {
    await page.getByRole("button", { name: "Abandonner les modifications" }).click();
    await Promise.all([
      page.waitForEvent("framenavigated", { predicate: (x) => x === page.mainFrame(), timeout: 60000 }),
      page.getByRole("dialog").getByRole("button", { name: "Abandonner les modifications" }).click(),
    ]);
    return canvas();
  }
  await sleep(1500);
  return fr;
}
async function settled() {
  await page.waitForFunction(() => !/Enregistrement/.test(document.querySelector(".ve-status")?.textContent ?? ""), null, { timeout: 120000 });
  await sleep(500);
}
async function publish() {
  await settled();
  await page.getByRole("button", { name: "Publier", exact: true }).click();
  return waitFor(async () => /En ligne/.test((await page.locator(".ve-status").textContent()) ?? ""), 120000);
}
const until = (f, fn, arg, timeout = 30000) =>
  f.waitForFunction(fn, arg, { timeout, polling: 200 }).then(
    () => true,
    () => false,
  );
const section = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 8).join(" "));
    await page.screenshot({ path: path.join(SHOTS, `erreur-${name}.png`) }).catch(() => {});
  }
};


/** Écrit le brouillon d'une page, l'ouvre dans l'éditeur et publie par le bouton (journalise ce que dit l'éditeur en cas d'échec). */
async function publishBlocks(pg, base, pageId, mutate, done, timeout = 240000) {
  sql((db) => {
    const row = db.prepare("select title, slug, meta, nav_order from pages where id = ?").get(pageId);
    const draft = {
      title: JSON.parse(row.title),
      slug: JSON.parse(row.slug),
      meta: row.meta ? JSON.parse(row.meta) : { title: { fr: "", en: "" }, description: { fr: "", en: "" } },
      published: true,
      inMenu: row.nav_order !== null,
      accent: null,
      blocks: mutate([]),
    };
    db.prepare("update pages set draft = ?, draft_updated_at = unixepoch(), draft_rev = draft_rev + 1 where id = ?").run(JSON.stringify(draft), pageId);
  });
  await pg.goto(`${base}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
  await canvas();
  await sleep(1500);
  await pg.getByRole("button", { name: "Publier", exact: true }).click();
  const goLive = pg.locator("dialog[open]").getByRole("button", { name: "Mettre en ligne" });
  if (await goLive.waitFor({ timeout: 3000 }).then(() => true, () => false)) await goLive.click();
  const ok2 = await waitFor(() => done(), timeout);
  if (!ok2) {
    info("éditeur après Publier", {
      status: await pg.locator(".ve-status").textContent().catch(() => "?"),
      alerts: await pg.locator('[role=alert], [role=dialog], .ve-error, [data-testid*=error]').allTextContents().catch(() => []),
    });
    await pg.screenshot({ path: path.join(SHOTS, "echec-publication.png") }).catch(() => {});
  }
  await sleep(800);
  return ok2;
}

const GREEN = "#12ab34";
const GREEN_RGB = "rgb(18, 171, 52)";

/* ============================================================================================================================
 * LG. Logo
 * ========================================================================================================================== */
const SIG_KEY = "c0e4a2c0e4a20049";
const SIG_ID = "signature-49";
const SIG_NAME = "Signature 49";
function installSignatureTheme() {
  const dir = path.join(DATA, "media", "kit");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${SIG_KEY}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80" viewBox="0 0 240 80"><rect x="0" y="10" width="240" height="60" rx="12" fill="#000"/></svg>`);
  sql((db) => {
    const base = JSON.parse(db.prepare("select data from themes where id = 'carnet-d-atelier'").get().data);
    const theme = { ...base, id: SIG_ID, name: SIG_NAME, preset: false, assets: { ...base.assets, kit: { signature: { svg: `/media/kit/${SIG_KEY}.svg`, w: 240, h: 80 } } } };
    db.prepare("insert or replace into themes (id, name, preset, data, updated_at) values (?, ?, 0, ?, unixepoch())").run(SIG_ID, SIG_NAME, JSON.stringify(theme));
  });
}
async function activateTheme(name) {
  // Lot 60 : « Utiliser ce modèle » / « En faire mon thème », puis « Publier » (scripts/lib/theme-live.mjs).
  await activateThemeUi(page, BASE, name);
}
/** Couleurs rendues du logo dans un document : nom (texte), signature (fond du masque). */
const readLogo = (fr) =>
  fr.evaluate(() => {
    const rgb = (el, p) => (el ? getComputedStyle(el)[p] : null);
    const brand = document.querySelector(".site-header .site-brand");
    const sig = document.querySelector(".site-header .site-signature");
    return {
      brandColor: rgb(brand, "color"),
      textColor: rgb(document.querySelector(".site-header .site-brand-text"), "color"),
      sigDisplay: rgb(sig, "display"),
      sigBg: rgb(sig, "backgroundColor"),
      kit: document.documentElement.hasAttribute("data-kit-signature"),
      ink: (() => {
        const p = document.createElement("span");
        p.style.color = "var(--color-ink)";
        document.body.appendChild(p);
        const v = getComputedStyle(p).color;
        p.remove();
        return v;
      })(),
    };
  });
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
      /* le « Aa » suit le survol */
    }
  }
  return false;
}

if (run("LG"))
  await section("LG", async () => {
    installSignatureTheme();
    await activateTheme(SIG_NAME);
    const f = await openEditor(1);
    const before = await readLogo(f);
    info("LG toile avant réglage", before);
    ok("LG0 le thème a une signature (toile : data-kit-signature, signature affichée)", before.kit && before.sigDisplay === "block", JSON.stringify(before));
    ok("LG0 sans réglage : la signature a l'encre du thème", before.sigBg === before.ink, `${before.sigBg} / ${before.ink}`);

    // Survol du logo dessiné (lot 84) : une signature est une image, pas du texte : plus de bouton « Aa ». Le nom du site se règle autrement
    // (ici : la même intention que celle de la barre « Aa », envoyée par la toile).
    await page.mouse.move(700, 8);
    await sleep(200);
    await f.locator(".site-header .site-signature").hover();
    await sleep(800);
    info("LG hover signature : Aa", await f.locator(".lk-aa").count());
    ok("LG1 survol de la signature dessinée : plus de bouton « Aa » (lot 84)", (await f.locator(".lk-aa").count()) === 0);
    // Le CSS : la couleur du nom du site teinte la signature (le pointeur quitte le logo : le survol met le texte en « primary »).
    await page.mouse.move(900, 400);
    await sleep(400);
    const probe = await f.evaluate(async (g) => {
      const b = document.querySelector(".site-header .site-brand");
      b.style.color = g;
      await new Promise((r) => setTimeout(r, 600));
      const s = getComputedStyle(document.querySelector(".site-header .site-signature")).backgroundColor;
      b.style.color = "";
      return s;
    }, GREEN);
    ok("LG1b la couleur du nom du site teinte aussi la signature (toile)", probe === GREEN_RGB, probe);
    await f.evaluate((c) => window.parent.postMessage({ type: "portfolio:edit", kind: "site-style", role: "brand", style: { color: c }, seq: 90001 }, window.location.origin), GREEN);
    await settled();
    await page.keyboard.press("Escape");
    ok("LG1 la couleur est enregistrée dans les styles du site (rôle « brand »)", await waitFor(() => JSON.stringify(sql((db) => db.prepare("select value from settings where key = 'siteDraft'").get())?.value ?? "").includes(GREEN), 30000));
    let lg;
    await waitFor(async () => (lg = await readLogo(f)).brandColor === GREEN_RGB, 15000);
    info("LG toile après couleur", lg);
    ok("LG2 toile : le nom du site a la couleur choisie", lg.brandColor === GREEN_RGB, JSON.stringify(lg));
    ok("LG2 toile : la signature dessinée a AUSSI la couleur choisie (et non l'encre du thème)", lg.sigBg === GREEN_RGB, JSON.stringify(lg));
    await page.screenshot({ path: path.join(SHOTS, "lg-toile.png") });
    ok("LG3 publication", await publish());

    const visitor = await ctx.newPage();
    await visitor.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
    const pub = await readLogo(visitor);
    info("LG public", pub);
    ok("LG4 public : le nom du site a la couleur choisie", pub.brandColor === GREEN_RGB, JSON.stringify(pub));
    ok("LG4 public : la signature dessinée a la couleur choisie", pub.kit && pub.sigBg === GREEN_RGB, JSON.stringify(pub));
    await visitor.screenshot({ path: path.join(SHOTS, "lg-public.png"), clip: { x: 0, y: 0, width: 1440, height: 160 } });
    await visitor.close();
  });

/* ============================================================================================================================
 * CD. Cadres
 * ========================================================================================================================== */
if (run("CD"))
  await section("CD", async () => {
    const upload = async (name, buffer) => {
      const res = await page.request.post(`${BASE}/admin/api/upload`, { headers: { origin: BASE }, multipart: { file: { name, mimeType: "image/png", buffer } }, timeout: 180000 });
      return res.status();
    };
    const mediaOf = (name) => q1("select id, status from media where original_name = ? order by id desc", name);
    async function ensure(name, make) {
      if (!mediaOf(name)) await upload(name, await make());
      if (!(await waitFor(() => mediaOf(name)?.status === "ready", 180000))) throw new Error(`${name} : ${JSON.stringify(mediaOf(name))}`);
      return mediaOf(name).id;
    }
    const A = await ensure("49-paysage.png", () => paint(1500, 1000, 1));
    const B = await ensure("49-portrait.png", () => paint(1000, 1500, 2));
    const pageId = pageIdOf("personnages");
    const FR = { kind: "band", width: "epais", color: GREEN };
    const img = (uid, mediaId, props = {}) => ({ uid, type: "image", props: { mediaId, width: "wide", look: { frame: FR }, ...props } });
    const grid = (uid, layout, ratio, children, extra = {}) => ({ uid, type: "grid", props: { layout, gap: "normal", align: "stretch", ratio, top: "gap", children, ...extra } });
    const kids = (p) => [img(`${p}a`, A), img(`${p}b`, B)];
    // [étiquette, bloc, nombre de cadres attendus]
    const cases = [
      ["image seule", img("c1", A), 1],
      ["image + fond image", img("c2", A, { look: { frame: FR, imageBg: "#ffee00" } }), 1],
      ["image cadrage ancien", img("c3", A, { look: { frame: FR, crop: { mediaId: { x: 30, y: 40, zoom: 1.4 } } } }), 1],
      ["image dans une carte", img("c4", A, { surface: {} }), 1],
      ["image sur fond de couleur", img("c5", A, { background: { kind: "color", color: "ink" } }), 1],
      ["grille 1:1", grid("g1", "2", "1:1", kids("g1")), 2],
      ["grille auto", grid("g2", "2", "auto", kids("g2")), 2],
      ["grille 3 colonnes", grid("g3", "3", "auto", kids("g3")), 2],
      ["grille 4:5", grid("g4", "2", "4:5", kids("g4")), 2],
      ["grille dans une carte", grid("g5", "2", "1:1", kids("g5"), { surface: {} }), 2],
      ["grille sur fond", grid("g6", "2", "auto", kids("g6"), { background: { kind: "color", color: "ink" } }), 2],
      ["grille carte à bordure", grid("g7", "2", "1:1", kids("g7"), { surface: { width: "inset", corners: "l", border: { width: "thick" } } }), 2],
      ["planche libre", { uid: "f1", type: "free-board", props: { format: "3:2", phone: "scale", items: [{ id: "a1", media: A, x: 10, y: 10, w: 30, frame: FR }, { id: "a2", media: B, x: 50, y: 30, w: 30, frame: FR }] } }, 2],
      ["planche libre sur fond", { uid: "f2", type: "free-board", props: { format: "3:2", phone: "scale", background: { kind: "color", color: "ink" }, items: [{ id: "a1", media: A, x: 10, y: 10, w: 30, frame: FR }] } }, 1],
    ];
    const expected = cases.flatMap(([label, , n]) => Array.from({ length: n }, () => label));
    const published = () => q1("select count(*) n from blocks where page_id = ?", pageId).n === cases.length;
    const done = await publishBlocks(page, BASE, pageId, () => cases.map((c) => c[1]), published, 300000);
    info("CD0 blocs en base", sql((db) => db.prepare("select position, type, json_extract(props,'$.children[0].uid') c from blocks where page_id = ? order by position").all(pageId)));
    if (!done) info("CD0 état de l'éditeur", await page.evaluate(() => document.body.innerText.slice(0, 600)));
    ok("CD0 page publiée", done);

    /** Une boîte de média par cadre posé (`.media-frame[data-frame]`, lot 64) : la bordure rendue de la boîte qui la porte. */
    const scan = (fr) =>
      fr.evaluate(() => {
        const out = [];
        for (const t of document.querySelectorAll(".media-frame[data-frame]")) {
          const kind = t.dataset.kind === "video" ? "video" : t.closest("figure.block-image") ? "image" : t.closest(".strip-frame") ? "strip" : t.closest(".free-item") ? "free" : "?";
          const cs = getComputedStyle(t);
          out.push({ kind, w: parseFloat(cs.borderTopWidth), color: cs.borderTopColor, style: cs.borderTopStyle });
        }
        return { frames: out, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
    const report = (where, res) => {
      const bad = [];
      res.frames.forEach((s, i) => {
        if (!(s.w > 0 && s.style === "solid" && s.color === GREEN_RGB)) bad.push(`${i}:${expected[i] ?? "?"}[${s.kind}] w=${s.w} ${s.style} ${s.color}`);
      });
      ok(`CD ${where} : ${res.frames.length} cadre(s) rendus pour ${expected.length} posés`, res.frames.length === expected.length, `${res.frames.length} / ${expected.length}`);
      ok(`CD ${where} : chaque cadre posé a sa bordure (verte, pleine)`, bad.length === 0, bad.join(" | "));
    };

    const visitor = await ctx.newPage();
    await visitor.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
    await visitor.waitForTimeout(800);
    const pubD = await scan(visitor);
    report("public bureau", pubD);
    info("CD public bureau", pubD.frames.map((s, i) => `${i}:${expected[i]}:${s.kind}:${s.w}`));
    await visitor.screenshot({ path: path.join(SHOTS, "cd-public.png"), fullPage: true });
    await visitor.setViewportSize({ width: 390, height: 800 });
    await visitor.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
    await visitor.waitForTimeout(800);
    const pubP = await scan(visitor);
    report("public téléphone", pubP);
    ok("CD public téléphone : aucun débordement horizontal", pubP.overflowX <= 1, `${pubP.overflowX}`);
    await visitor.screenshot({ path: path.join(SHOTS, "cd-public-phone.png"), fullPage: true });
    await visitor.close();

    const f = await openEditor(pageId);
    await sleep(2500);
    info("CD toile blocs", await f.evaluate(() => [...document.querySelectorAll("[data-edit-block]")].map((e) => e.getAttribute("data-edit-block")).join(",")));
    const toile = await scan(f);
    report("toile", toile);
    info("CD toile", toile.frames.map((s, i) => `${i}:${expected[i]}:${s.kind}:${s.w}`));
    await page.screenshot({ path: path.join(SHOTS, "cd-toile.png") });
  });

/* ============================================================================================================================
 * KT. Kit PSD réimporté
 * ========================================================================================================================== */
if (run("KT"))
  await section("KT", async () => {
    const DIR = path.join(tmpdir(), "e2e-logocadres49-kit");
    mkdirSync(DIR, { recursive: true });
    const sleep2 = sleep;
    const kitUrl = `${BASE}/admin/api/theme-kit/studio`;
    let ready = false;
    for (let i = 0; i < 90 && !ready; i++) {
      const res = await page.request.post(kitUrl, { headers: { origin: BASE } });
      ready = (await res.json()).ready === true;
      if (!ready) await sleep2(2000);
    }
    ok("KT0 export du kit de Studio prêt", ready);
    const kitFile = path.join(DIR, "kit-studio.zip");
    writeFileSync(kitFile, await (await page.request.get(kitUrl)).body());
    const edited = path.join(DIR, "retour49.zip");
    execFileSync(process.execPath, ["--import", "tsx", "scripts/kit-poc/simulate-multi.mts", "retour49", kitFile, edited], { stdio: "inherit" });

    await gotoIdle(page, `${BASE}/admin/themes/studio/kit`);
    await page.setInputFiles('[data-testid="kit-file"]', edited);
    await page.waitForURL(/\/kit\?import=/, { timeout: 180000 });
    await page.locator(".a-kit-card").nth(2).waitFor({ timeout: 240000 });
    await page.waitForLoadState("networkidle");
    await page.waitForFunction(() => [...document.querySelectorAll(".a-kit-card img")].every((i) => i.complete), null, { timeout: 30000 });
    await page.screenshot({ path: path.join(SHOTS, "kt-revue.png"), fullPage: true });
    const cards = await page.$$eval(".a-kit-card", (els) => els.map((e) => ({ slot: e.dataset.slot, change: e.dataset.change, status: e.dataset.status, msgs: [...e.querySelectorAll("li")].map((l) => l.textContent), text: e.textContent })));
    const sig = cards.find((c) => c.slot === "signature");
    const cad = cards.find((c) => c.slot === "cadre");
    info("KT revue signature", sig);
    info("KT revue cadre", cad);
    ok("KT1 revue : le logo est reconnu changé", sig?.change === "redrawn", JSON.stringify(sig));
    ok("KT1 revue : le message dit que le logo garde ses couleurs", /garde ses couleurs/.test((sig?.msgs ?? []).join(" ")), JSON.stringify(sig?.msgs));
    ok("KT1 revue : plus de « elle prend la couleur du thème » pour ce logo", !/prend la couleur du thème/.test((sig?.msgs ?? []).join(" ")));
    ok("KT1 revue : le cadre redessiné est reconnu changé", cad?.change === "redrawn", JSON.stringify(cad));
    // Lot 60 : le kit crée une version de Mon thème (brouillon), publiée plus bas.
    await Promise.all([page.waitForURL(/\/admin\/themes\?nouvelle=\d+&via=kit/, { timeout: 60000 }), page.getByRole("button", { name: /^Appliquer à mon thème/ }).click()]);
    const draftId = sql((db) => db.prepare("select id from themes where mine = 1").get()).id;
    const data = JSON.parse(sql((db) => db.prepare("select data from themes where id = ?").get(draftId))?.data ?? "null");
    ok("KT2 thème : la signature est rangée « en couleurs » (colors), en SVG ou AVIF, pas en masque", data?.assets?.kit?.signature?.colors === true, JSON.stringify(data?.assets?.kit?.signature));
    ok("KT2 thème : le cadre est rangé", Boolean(data?.assets?.kit?.frame), JSON.stringify(data?.assets?.kit?.frame));

    // Contenu : photos SANS cadre choisi, pour voir le cadre du thème.
    const A = q1("select id from media where status = 'ready' and kind = 'image' order by id limit 1")?.id;
    const pageId = pageIdOf("decors");
    const project = q1("select slug from projects order by id limit 1")?.slug;
    const blocks = [
      { uid: "k1", type: "image", props: { mediaId: A, width: "wide" } },
      { uid: "k2", type: "image", props: { mediaId: A, width: "wide", look: { frame: { kind: "band", width: "epais", color: GREEN } } } },
      { uid: "k3", type: "grid", props: { layout: "2", gap: "normal", align: "stretch", ratio: "1:1", top: "gap", children: [{ uid: "k3a", type: "image", props: { mediaId: A } }, { uid: "k3b", type: "image", props: { mediaId: A } }] } },
      { uid: "k4", type: "free-board", props: { format: "3:2", phone: "scale", items: [{ id: "a1", media: A, x: 10, y: 10, w: 30 }] } },
      { uid: "k5", type: "project-board", props: { project } },
    ];
    const done = await publishBlocks(page, BASE, pageId, () => blocks, () => q1("select count(*) n from blocks where page_id = ?", pageId).n === blocks.length, 300000);
    if (!done) info("KT3 état de l'éditeur", await page.evaluate(() => document.body.innerText.slice(0, 600)));
    ok("KT3 page publiée", done);
    await gotoThemesPage(page, BASE);
    await page.getByTestId("mine-publish").click();
    await page.locator("dialog[open]").getByRole("button", { name: "Publier", exact: true }).click();
    await page.locator("dialog[open]").waitFor({ state: "detached" });
    await sleep2(1500);
    // Lot 62 : le cadre dessiné n'est posé d'office sur aucune photo ; ici on active « Cadre du thème sur toutes les photos » (écran Thèmes)
    // pour voir le cadre sur les photos SANS choix, comme avant.
    await gotoIdle(page, `${BASE}/admin/themes`);
    await page.locator('[data-testid="frame-all-on"]').click();
    ok("KT3b réglage « Cadre du thème sur toutes les photos » activé", await waitFor(() => Boolean(q1("select value from settings where key = 'themeFrameAll'")), 20000));
    await sleep2(1500);

    const pub = await ctx.newPage();
    pub.setDefaultTimeout(60000);
    await pub.goto(`${BASE}/fr/decors`, { waitUntil: "networkidle" });
    await pub.waitForTimeout(800);
    const frames = await pub.evaluate(() => {
      const bi = (sel) => [...document.querySelectorAll(sel)].map((el) => {
        const cs = getComputedStyle(el);
        return { src: cs.borderImageSource.slice(0, 40), w: parseFloat(cs.borderTopWidth), color: cs.borderTopColor };
      });
      return {
        solo: bi("figure.block-image .media-frame:not([data-frame])").slice(0, 3),
        chosen: bi("figure.block-image .media-frame[data-frame]"),
        free: bi(".free-item .media-frame"),
        strip: bi(".strip-frame .strip-media .media-frame").slice(0, 2),
        tile: bi(".tile-media").slice(0, 1),
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    info("KT public cadres", frames);
    const drawn = (l) => l.length > 0 && l.every((x) => x.src.startsWith("url(") || x.src.startsWith("image-set") || x.src.includes("kit")) && l.every((x) => x.w > 4);
    ok("KT4 public : image seule et cases de grille portent le cadre dessiné", drawn(frames.solo) && frames.solo.length >= 3, JSON.stringify(frames.solo));
    ok("KT4 public : planche libre", drawn(frames.free), JSON.stringify(frames.free));
    ok("KT4 public : image de carrousel / planche", drawn(frames.strip), JSON.stringify(frames.strip));
    ok("KT4 public : un cadre choisi pour la photo (vert) passe avant le cadre dessiné", frames.chosen.length === 1 && frames.chosen[0].src === "none" && frames.chosen[0].color === GREEN_RGB, JSON.stringify(frames.chosen));
    await pub.screenshot({ path: path.join(SHOTS, "kt-public-decors.png"), fullPage: true });

    // Logo : trois couleurs d'origine dans l'en-tête.
    await pub.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
    await pub.waitForTimeout(800);
    const sigCss = await pub.evaluate(() => {
      const el = document.querySelector(".site-header .site-signature");
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { attr: document.documentElement.getAttribute("data-kit-signature"), img: cs.backgroundImage.slice(0, 40), mask: cs.maskImage ?? cs.webkitMaskImage, rect: { x: r.x, y: r.y, w: r.width, h: r.height } };
    });
    info("KT public signature", sigCss);
    ok("KT5 public : la signature est en couleurs (image de fond, aucun masque)", sigCss.attr === "colors" && sigCss.img.startsWith("url(") && (!sigCss.mask || sigCss.mask === "none"), JSON.stringify(sigCss));
    const shot = await pub.screenshot({ clip: { x: Math.max(0, sigCss.rect.x), y: Math.max(0, sigCss.rect.y), width: Math.max(2, sigCss.rect.w), height: Math.max(2, sigCss.rect.h) } });
    await pub.screenshot({ path: path.join(SHOTS, "kt-public-logo.png"), clip: { x: 0, y: 0, width: 1440, height: 170 } });
    const { data: px, info: pinfo } = await sharp(shot).raw().toBuffer({ resolveWithObject: true });
    const count = (c) => {
      let n = 0;
      for (let i = 0; i < px.length; i += pinfo.channels) if (Math.abs(px[i] - c[0]) < 40 && Math.abs(px[i + 1] - c[1]) < 40 && Math.abs(px[i + 2] - c[2]) < 40) n++;
      return n;
    };
    const reds = count([0xe8, 0x31, 0x2a]);
    const greens = count([0x1f, 0x9d, 0x55]);
    const blues = count([0x2a, 0x4b, 0xd7]);
    ok("KT5 public : le rouge, le vert et le bleu du logo sont à l'écran", reds > 50 && greens > 50 && blues > 50, `${reds}/${greens}/${blues}`);
    await pub.close();
  });

console.log(errors.length ? `ERREURS PAGE : ${errors.slice(0, 5).join(" | ")}` : "aucune erreur de page");
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout est vert");
process.exit(failures ? 1 : 0);
