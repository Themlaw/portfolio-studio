#!/usr/bin/env node
/**
 * Lot 113 « Planche libre : choisir l'espace qu'elle prend, la recadrer par ses bords et ses coins » (chromium, serveur requis, base neuve).
 * ÉCRIT AVANT le code produit (échoue sur la base 7f64836). Images : PNG synthétiques générés ici. Gestes à la souris réelle
 * (`page.mouse`) ou au doigt (CDP `Input.dispatchTouchEvent`, contexte `hasTouch`).
 *
 *  N  Non-régression : six planches d'avant (3:2, 4:3, 1:1, 16:9, hauteur libre, éléments débordants à x/y négatifs, rotation, z, phone scale / stack),
 *     rendu de la toile et du site en ligne (1440, 1024, 390) : géométrie et empreinte de l'image de chaque planche IDENTIQUES à
 *     tests/golden/planche113-empreintes.json (enregistré sur la base avec GOLDEN=record) ; aucune donnée réécrite à l'ouverture.
 *  H  Poignées : 8 repères (bords et coins), assez grands, rien ne les recouvre.
 *  C  Recadrage à la souris par chaque bord et chaque coin : dimensions mesurées, images immobiles à l'écran, pas de saut au premier mouvement,
 *     ré-agrandir (jusqu'à l'état d'avant et au-delà vers le bas), format du panneau « Hauteur libre ».
 *  E  Échap annule le geste, Annuler / Rétablir, rechargement, publication : site = éditeur (cadre et images, ±1 %), téléphone.
 *  M  Magnétisme : formats repères (badge), bord collé au contenu, Alt le coupe.
 *  W  Largeur du bloc (curseur aimanté de la barre) : le cadre suit, recadrage conservé.
 *  T  Tactile 390 et 1024 : bord bas, coin, bord latéral ; poignées ≥ 40 px.
 *  G  Planche libre dans une cellule de grille : insertion depuis la case libre, rendu, recadrage haut/bas = hauteur de la rangée, bord latéral =
 *     largeur de la case (aimant sur les colonnes), autres cellules intactes, déplacement d'une image dans la planche, téléphone, site = éditeur.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=N,H,C,E,M,W,T,G] [GOLDEN=record] node scripts/e2e-planche113.mjs
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";
import sharp from "sharp";

import { draftBlocks, login, openEditor, pageIdOf, q1, setDraft, settled, sleep, sql, waitFor } from "./lib/grille31d.mjs";
import { publishBlocks } from "./lib/page-draft.mjs";

const BASE = process.env.BASE ?? "http://localhost:4400";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const GOLDEN = path.join(import.meta.dirname, "..", "tests", "golden", "planche113-empreintes.json");
const RECORD = process.env.GOLDEN === "record";
const SHOTS = process.env.SHOTS ?? path.join(process.env.BATTERY_DIR ?? tmpdir(), "shots-planche113");
mkdirSync(SHOTS, { recursive: true });
sharp.cache(false);
sharp.concurrency(1);

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);

/* ---- Images synthétiques ---------------------------------------------------------------------------------------------------- */
const svg = (w, h, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`);
const SPECS = {
  "113-fleur.png": svg(900, 1200, '<rect width="900" height="1200" fill="#fff3"/><circle cx="450" cy="300" r="240" fill="#e0407a"/><rect x="430" y="520" width="40" height="640" fill="#2f7d32"/>'),
  "113-vase.png": svg(700, 1100, '<path d="M250 40 H450 L430 260 C700 420 640 1000 520 1060 H180 C60 1000 0 420 270 260 Z" fill="#3b6fb6"/>'),
  "113-etoile.png": svg(1000, 1000, '<polygon points="500,40 620,380 980,380 690,590 800,940 500,730 200,940 310,590 20,380 380,380" fill="#f2b600"/>'),
  "113-feuille.png": svg(1400, 900, '<path d="M60 840 C80 300 600 40 1340 60 C1320 700 800 900 60 840 Z" fill="#43a047"/>'),
  "113-carre.png": svg(800, 800, '<rect width="800" height="800" fill="#7e57c2"/><circle cx="400" cy="400" r="260" fill="#ffee58"/>'),
};
const mediaOf = (name) => q1("select id, status from media where original_name = ? order by id desc", name);
const ids = {};
for (const [name, body] of Object.entries(SPECS)) {
  if (!mediaOf(name)) {
    const buffer = await sharp(body).png().toBuffer();
    const res = await page.request.post(`${BASE}/admin/api/upload`, { headers: { origin: BASE }, multipart: { file: { name, mimeType: "image/png", buffer } }, timeout: 180000 });
    if (res.status() >= 300) throw new Error(`envoi de ${name} : ${res.status()}`);
  }
  if (!(await waitFor(() => mediaOf(name)?.status === "ready", 180000))) throw new Error(`${name} : ${JSON.stringify(mediaOf(name))}`);
  ids[name.replace(/^113-|\.png$/g, "")] = mediaOf(name).id;
}
const RATIO = { fleur: 900 / 1200, vase: 700 / 1100, etoile: 1, feuille: 1400 / 900, carre: 1 };
const pageId = pageIdOf("personnages");

/* ---- Aides ------------------------------------------------------------------------------------------------------------------ */
const section = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 8).join(" "));
    await page.screenshot({ path: path.join(SHOTS, `erreur-${name}.png`) }).catch(() => {});
  }
};
const it = (id, media, x, y, w, rot = 0, z = 0, extra = {}) => ({ id, media: ids[media], x, y, w, rot, z, ...extra });
const FB = (uid, items, extra = {}) => ({ uid, type: "free-board", props: { format: "3:2", phone: "scale", items, ...extra } });
const L = (t) => ({ fr: t, en: t });
const sep = (uid, t) => ({ uid, type: "section-title", props: { title: L(t) } });
const draftOf = () => draftBlocks(pageId);
const propsOf = (uid) => {
  const find = (list) => {
    for (const b of list) {
      if (b.uid === uid) return b.props;
      const k = find(b.props?.children ?? []);
      if (k) return k;
    }
    return null;
  };
  return find(draftOf()) ?? {};
};
const savedProps = (type) => sql((db) => db.prepare("select props from blocks where page_id = ? and type = ? order by position").all(pageId, type)).map((r) => JSON.parse(r.props));
let f;
async function open() {
  f = await openEditor(page, BASE, pageId);
  await settled(page);
  await f.waitForFunction(() => [...document.querySelectorAll(".free-item img")].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 60000 }).catch(() => {});
}
const zoneOf = (uid) => f.locator(`[data-edit-block="${uid}"] .free-board[data-edit-free]`).first();
const itemOf = (uid, id) => zoneOf(uid).locator(`:scope > .free-item[data-free-item="${id}"]`);
const center = async (loc) => {
  const b = await loc.boundingBox();
  if (!b) throw new Error("élément sans boîte");
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
};
const scrollTo = async (loc) => {
  await loc.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await sleep(500);
};
const click = async (loc) => {
  const { x, y } = await center(loc);
  await page.mouse.move(x, y, { steps: 3 });
  await page.mouse.click(x, y);
};
/** Cadre et images en pixels de la fenêtre. */
const geom = (uid) =>
  zoneOf(uid).evaluate((z) => {
    const r = z.getBoundingClientRect();
    return { frame: { x: r.left, y: r.top, w: r.width, h: r.height }, items: [...z.querySelectorAll(":scope > .free-item")].map((el) => { const b = el.getBoundingClientRect(); return { id: el.dataset.freeItem, x: b.left, y: b.top, w: b.width, h: b.height }; }), next: [...document.querySelectorAll("h1,h2,h3,h4,p,span,div")].filter((x) => !x.children.length && x.textContent.includes("S113b")).at(-1)?.getBoundingClientRect().top ?? null };
  });
const still = (a, b, tol = 0.8) => a.items.length === b.items.length && a.items.every((i, k) => near(i.x, b.items[k].x, tol) && near(i.y, b.items[k].y, tol) && near(i.w, b.items[k].w, tol) && near(i.h, b.items[k].h, tol));
const undo = async () => {
  await page.locator('button[aria-label="Défaire"]').evaluate((b) => b.click());
  await settled(page);
};
const redo = async () => {
  await page.locator('button[aria-label="Rétablir"]').evaluate((b) => b.click());
  await settled(page);
};
const HANDLES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
const handle = (h) => f.getByTestId(`free-crop-${h}`);
/** Sélectionne la planche en appuyant sur une de ses images (les poignées du cadre s'affichent). */
async function select(uid, id) {
  await scrollTo(zoneOf(uid));
  await click(itemOf(uid, id));
  await handle("s").waitFor({ timeout: 10000 });
}
/** Glisse une poignée de (dx, dy) pixels ; options : alt, hold (laisse enfoncé), esc (Échap avant de relâcher), steps. */
async function cropDrag(h, dx, dy, { alt = false, hold = false, esc = false } = {}) {
  const { x, y } = await center(handle(h));
  if (alt) await page.keyboard.down("Alt");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + Math.sign(dx) * 4, y + Math.sign(dy) * 4, { steps: 2 });
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await sleep(200);
  if (esc) await page.keyboard.press("Escape");
  if (hold) return;
  await page.mouse.up();
  if (alt) await page.keyboard.up("Alt");
  await sleep(300);
}
async function publicPage(width, height, options = {}) {
  const c = await browser.newContext({ viewport: { width, height }, ...options });
  const p = await c.newPage();
  p.setDefaultTimeout(30000);
  p.on("pageerror", (e) => errors.push(`public : ${e.message}`));
  await p.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
  await p.waitForFunction(() => [...document.querySelectorAll(".free-item img")].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 30000 }).catch(() => {});
  return p;
}
async function publish(mutate) {
  await page.goto("about:blank");
  const row = sql((db) => db.prepare("select draft from pages where id = ?").get(pageId));
  const nblocks = row.draft ? JSON.parse(row.draft).blocks.length : sql((db) => db.prepare("select count(*) as n from blocks where page_id = ?").get(pageId)).n;
  const ready = () => sql((db) => db.prepare("select draft from pages where id = ?").get(pageId)).draft === null && sql((db) => db.prepare("select count(*) as n from blocks where page_id = ?").get(pageId)).n === nblocks;
  const end = Date.now() + 240000;
  while (Date.now() < end) {
    if (await publishBlocks(page, BASE, pageId, mutate, ready, 60000).catch(() => false)) {
      await sleep(3000);
      return true;
    }
  }
  return false;
}
/** Géométrie normalisée d'un document (toile ou public) : cadre en % de la colonne, images en % du cadre. */
const NORM = (root) =>
  root.evaluate(() =>
    [...document.querySelectorAll(".free-board")].map((z) => {
      const r = z.getBoundingClientRect();
      const col = z.parentElement.getBoundingClientRect();
      return {
        fx: ((r.left - col.left) / col.width) * 100,
        fw: (r.width / col.width) * 100,
        fa: r.width / r.height,
        items: [...z.querySelectorAll(":scope > .free-item")].map((el) => { const b = el.getBoundingClientRect(); return { x: ((b.left - r.left) / r.width) * 100, y: ((b.top - r.top) / r.height) * 100, w: (b.width / r.width) * 100 }; }),
      };
    }),
  );
const sameNorm = (a, b, tol = 1) => a.length === b.length && a.every((z, i) => near(z.fx, b[i].fx, tol) && near(z.fw, b[i].fw, tol) && near(z.fa, b[i].fa, 0.03) && z.items.length === b[i].items.length && z.items.every((m, k) => near(m.x, b[i].items[k].x, tol) && near(m.y, b[i].items[k].y, tol) && near(m.w, b[i].items[k].w, tol)));

/* ================================================ N : non-régression ================================================ */
const OLD = () => [
  sep("n0", "NR0"),
  FB("na", [it("a1", "fleur", 10, 10, 30), it("a2", "vase", 50, 20, 25, 15, 1), it("a3", "feuille", 30, 55, 40, 0, 0)]),
  FB("nb", [it("b1", "etoile", -20, -30, 60, 0, 0), it("b2", "vase", 80, 70, 30, -25, 1)], { format: "4:3" }),
  FB("nc", [it("c1", "carre", 5, 5, 40, 0, 0), it("c2", "fleur", 55, 30, 30, 0, 1), it("c3", "etoile", 20, 60, 25, 45, 2)], { format: "1:1", phone: "stack" }),
  FB("nd", [it("d1", "feuille", 0, 0, 100, 0, 0), it("d2", "carre", 60, 40, 35, 30, 3), it("d3", "vase", 10, 50, 20, -10, 2)], { format: "16:9" }),
  FB("ne", [it("e1", "fleur", 15, 15, 25, 0, 0), it("e2", "etoile", 55, 35, 30, 0, 1)], { format: "free", aspect: 2.2 }),
  FB("nf", [it("f1", "carre", 140, 140, 20, 0, 0), it("f2", "vase", -10, 90, 30, 0, 1)], { zoom: false }),
  sep("n9", "NR9"),
];
const FPRINT = async (root, withShots) => {
  const rows = await root.evaluate(() =>
    [...document.querySelectorAll(".free-board")].map((z) => {
      const r = z.getBoundingClientRect();
      const q = (n) => Math.round(n * 100) / 100;
      return { w: q(r.width), h: q(r.height), items: [...z.querySelectorAll(":scope > .free-item")].map((el) => { const b = el.getBoundingClientRect(); return [el.dataset.freeItem ?? "", q(b.left - r.left), q(b.top - r.top), q(b.width), q(b.height), getComputedStyle(el).zIndex]; }) };
    }),
  );
  if (!withShots) return rows;
  const out = [];
  const zones = root.locator(".free-board");
  for (let i = 0; i < rows.length; i++) {
    const loc = zones.nth(i);
    await loc.scrollIntoViewIfNeeded();
    await sleep(250);
    const buf = await loc.screenshot().catch(() => Buffer.alloc(0));
    out.push({ ...rows[i], sha: createHash("sha256").update(buf).digest("hex").slice(0, 16) });
  }
  return out;
};
let golden = existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, "utf8")) : {};
const fresh = {};
if (run("N"))
  await section("N", async () => {
    setDraft(pageId, OLD());
    const before = JSON.stringify(draftOf());
    await open();
    for (const uid of ["na", "nb", "nc", "nd", "ne", "nf"]) await zoneOf(uid).waitFor({ state: "attached" });
    fresh.editor = await FPRINT(f, true);
    await sleep(1500);
    ok("N1 ouvrir l'éditeur ne réécrit aucune donnée (brouillon identique)", JSON.stringify(draftOf()) === before);
    ok("N1b aucune planche d'avant ne porte de crop", draftOf().every((b) => b.props.crop === undefined));
    ok("N1c les planches d'avant n'ont pas de variable de recadrage dans le DOM", await f.evaluate(() => [...document.querySelectorAll(".free-board")].every((z) => !z.hasAttribute("data-crop") && !z.style.getPropertyValue("--fb-cw"))));
    ok("N2 publication", await publish((b) => b));
    ok("N2b la publication n'a rien réécrit : propriétés identiques", JSON.stringify(savedProps("free-board").map((p) => p.items.length)) === JSON.stringify(OLD().filter((b) => b.type === "free-board").map((b) => b.props.items.length)) && savedProps("free-board").every((p) => p.crop === undefined));
    for (const [w, h] of [[1440, 900], [1024, 800], [390, 844]]) {
      const p = await publicPage(w, h, w < 500 ? { isMobile: true, hasTouch: true } : {});
      fresh[`public${w}`] = await FPRINT(p, true);
      await p.context().close();
    }
    if (RECORD) {
      mkdirSync(path.dirname(GOLDEN), { recursive: true });
      writeFileSync(GOLDEN, `${JSON.stringify(fresh, null, 1)}\n`);
      golden = fresh;
      ok("N0 empreintes enregistrées (GOLDEN=record)", true);
    }
    ok("N3 empreintes de référence présentes (tests/golden/planche113-empreintes.json)", Boolean(golden.editor && golden.public1440 && golden.public1024 && golden.public390));
    for (const key of ["editor", "public1440", "public1024", "public390"]) {
      const a = fresh[key];
      const b = golden[key] ?? [];
      const geomOk = a.length === b.length && a.every((r, i) => r.w === b[i].w && r.h === b[i].h && JSON.stringify(r.items) === JSON.stringify(b[i].items));
      ok(`N4 ${key} : géométrie identique à l'empreinte d'avant`, geomOk, JSON.stringify(a.map((r, i) => [r.w, r.h, b[i]?.w, b[i]?.h])));
      ok(`N5 ${key} : image de chaque planche identique (empreinte)`, a.length === b.length && a.every((r, i) => r.sha === b[i].sha), JSON.stringify(a.map((r, i) => [r.sha, b[i]?.sha])));
    }
  });

/* ================================================ banc commun H, C, E, M, W, T ================================================ */
// Plan 3:2 ; fleur (x10 y10 w30 : bas à 70 %), vase (x50 y15 w25 : bas à ≈ 73,9 %).
const BENCH = () => [sep("s0", "S113a"), FB("fb1", [it("a1", "fleur", 10, 10, 30, 0, 0), it("a2", "vase", 50, 15, 25, 0, 1)]), sep("s1", "S113b")];
const CONTENT_BOTTOM = 15 + (25 * 1.5) / RATIO.vase;
const cropOfDraft = () => propsOf("fb1").crop;

if (run("H") || run("C") || run("E") || run("M") || run("W"))
  await section("banc", async () => {
    setDraft(pageId, BENCH());
    await open();
  });

if (run("H"))
  await section("H", async () => {
    await select("fb1", "a1");
    for (const h of HANDLES) ok(`H1 poignée « ${h} » présente`, (await handle(h).count()) === 1);
    const g = { frame: await zoneOf("fb1").boundingBox() };
    const spots = {};
    for (const h of HANDLES) {
      const b = await handle(h).boundingBox();
      spots[h] = b;
      ok(`H2 poignée « ${h} » assez grande (≥ 24 px à la souris)`, b && b.width >= 24 && b.height >= 24, JSON.stringify(b));
      const topmost = await handle(h).evaluate((el) => { const r = el.getBoundingClientRect(); const t = el.ownerDocument.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return t === el || el.contains(t); });
      ok(`H3 poignée « ${h} » : rien ne la recouvre`, topmost);
    }
    ok("H4 « n » au milieu du bord haut, « se » au coin bas droit", near(spots.n.x + spots.n.width / 2, g.frame.x + g.frame.width / 2, 3) && near(spots.n.y + spots.n.height / 2, g.frame.y, 4) && near(spots.se.x + spots.se.width / 2, g.frame.x + g.frame.width, 4) && near(spots.se.y + spots.se.height / 2, g.frame.y + g.frame.height, 4), JSON.stringify([spots.n, spots.se, g.frame]));
    ok("H5 l'ancienne poignée « hauteur » n'existe plus (remplacée par le bord bas)", (await f.getByTestId("free-height").count()) === 0);
    await page.keyboard.press("Escape");
  });

if (run("C"))
  await section("C", async () => {
    await open();
    await select("fb1", "a1");
    const g0 = await geom("fb1");
    // Pas de saut au premier mouvement : 10 px de glissé = 10 px de hauteur.
    const hs = await center(handle("s"));
    await page.keyboard.down("Alt");
    await page.mouse.move(hs.x, hs.y);
    await page.mouse.down();
    await page.mouse.move(hs.x, hs.y - 1, { steps: 1 });
    const gj = await geom("fb1");
    ok("C0 un souffle (1 px) ne bouge rien", near(gj.frame.h, g0.frame.h, 0.6));
    await page.mouse.move(hs.x, hs.y - 10, { steps: 5 });
    await sleep(200);
    const g10 = await geom("fb1");
    ok("C0b pas de saut : 10 px de glissé = 10 px de moins (±1,5)", near(g0.frame.h - g10.frame.h, 10, 1.5), `${g0.frame.h} → ${g10.frame.h}`);
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await sleep(300);
    await settled(page);
    await undo();

    const cases = [
      ["s", 0, -90, { h: -90, w: 0, x: 0, y: 0 }],
      ["n", 0, 70, { h: -70, w: 0, x: 0, y: 70 }],
      ["e", -140, 0, { h: 0, w: -140, x: 0, y: 0 }],
      ["w", 120, 0, { h: 0, w: -120, x: 120, y: 0 }],
      ["se", -100, -60, { h: -60, w: -100, x: 0, y: 0 }],
      ["nw", 90, 50, { h: -50, w: -90, x: 90, y: 50 }],
      ["ne", -80, 40, { h: -40, w: -80, x: 0, y: 40 }],
      ["sw", 110, -70, { h: -70, w: -110, x: 110, y: 0 }],
    ];
    for (const [h, dx, dy, exp] of cases) {
      await open();
      await select("fb1", "a1");
      const a = await geom("fb1");
      await cropDrag(h, dx, dy, { alt: true });
      await settled(page);
      const b = await geom("fb1");
      ok(`C1 ${h} : hauteur ${exp.h} px, largeur ${exp.w} px (±3)`, near(b.frame.h - a.frame.h, exp.h, 3) && near(b.frame.w - a.frame.w, exp.w, 3), `${JSON.stringify(a.frame)} → ${JSON.stringify(b.frame)}`);
      ok(`C2 ${h} : le cadre s'est déplacé de (${exp.x}, ${exp.y}) (±3)`, near(b.frame.x - a.frame.x, exp.x, 3) && near(b.frame.y - a.frame.y, exp.y, 3), `${JSON.stringify(a.frame)} → ${JSON.stringify(b.frame)}`);
      ok(`C3 ${h} : les images ne bougent pas à l'écran (±0,8 px)`, still(a, b), JSON.stringify([a.items, b.items]));
      const c = cropOfDraft();
      const exped = { t: exp.y / a.frame.h, b: -(exp.h + exp.y) / a.frame.h, l: exp.x / a.frame.w, r: -(exp.w + exp.x) / a.frame.w };
      ok(`C4 ${h} : crop écrit dans le brouillon (en % du plan, ±1,5)`, c && ["t", "r", "b", "l"].every((k) => near(c[k] ?? 0, exped[k] * 100, 1.5)), JSON.stringify([c, exped]));
      ok(`C5 ${h} : format, images et téléphone intacts dans les données`, propsOf("fb1").format === "3:2" && propsOf("fb1").items.length === 2 && propsOf("fb1").items[0].x === 10 && propsOf("fb1").phone === "scale");
      if (h === "n" || h === "s") ok(`C6 ${h} : le bloc suivant ${h === "s" ? "remonte" : "reste en place"}`, h === "s" ? near(a.next - b.next, 90, 3) : near(a.next, b.next, 3), `${a.next} → ${b.next}`);
      await undo();
      ok(`C7 ${h} : Annuler rend le cadre d'avant`, await waitFor(() => cropOfDraft() === undefined));
    }

    // Ré-agrandir : rogner puis tirer le bord bas vers le bas jusqu'à l'état d'avant, puis au-delà.
    await open();
    await select("fb1", "a1");
    const a0 = await geom("fb1");
    await cropDrag("s", 0, -100, { alt: true });
    await settled(page);
    await cropDrag("s", 0, 100, { alt: true });
    await settled(page);
    const a1 = await geom("fb1");
    ok("C8 ré-agrandir : le cadre retrouve sa hauteur d'avant (±3), crop effacé ou nul", near(a1.frame.h, a0.frame.h, 3) && (cropOfDraft() === undefined || Math.abs(cropOfDraft().b ?? 0) < 1.5), JSON.stringify([a0.frame, a1.frame, cropOfDraft()]));
    await cropDrag("s", 0, 80, { alt: true });
    await settled(page);
    const a2 = await geom("fb1");
    ok("C9 au-delà du plan d'origine vers le bas : le cadre grandit (b < 0), images immobiles", near(a2.frame.h - a1.frame.h, 80, 3) && cropOfDraft()?.b < 0 && still(a0, a2), JSON.stringify([a1.frame, a2.frame, cropOfDraft()]));
    await undo();
    await undo();
    await undo();
    // Le bord gauche ne dépasse jamais la colonne : on ne peut pas tirer « w » vers l'extérieur.
    await select("fb1", "a1");
    const b0 = await geom("fb1");
    await cropDrag("w", -80, 0, { alt: true });
    await settled(page);
    ok("C10 le bord gauche ne sort pas de la colonne (pas de crop négatif)", near((await geom("fb1")).frame.w, b0.frame.w, 2) && (cropOfDraft()?.l ?? 0) >= 0);

    // Panneau Réglages : le format « Hauteur libre » apparaît dès qu'on recadre ; un cran de format efface le recadrage.
    await cropDrag("s", 0, -100, { alt: true });
    await settled(page);
    const sel = page.getByLabel("Format de la zone");
    for (let k = 0; k < 3 && !(await sel.count()); k++) {
      await click(itemOf("fb1", "a1"));
      await page.getByRole("tab", { name: "Réglages" }).click().catch(() => {});
      await sleep(1200);
    }
    ok("C11 le panneau montre « Hauteur libre » quand le cadre est recadré", (await sel.count()) === 1 && (await sel.inputValue()) === "free", await sel.inputValue().catch(() => "?"));
    await sel.selectOption("16:9");
    ok("C12 choisir un cran de format (16:9) efface le recadrage", await waitFor(() => propsOf("fb1").format === "16:9" && propsOf("fb1").crop === undefined), JSON.stringify(propsOf("fb1")));
  });

if (run("E"))
  await section("E", async () => {
    setDraft(pageId, BENCH());
    await open();
    await select("fb1", "a1");
    const a = await geom("fb1");
    // Échap pendant le geste.
    await cropDrag("s", 0, -90, { alt: true, hold: true, esc: true });
    const mid = await geom("fb1");
    ok("E1 Échap : le cadre revient à l'état d'avant, bouton toujours enfoncé", near(mid.frame.h, a.frame.h, 1.5), `${a.frame.h} → ${mid.frame.h}`);
    await page.mouse.move(mid.frame.x + 50, mid.frame.y + mid.frame.h, { steps: 3 });
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await sleep(800);
    await settled(page);
    const after = await geom("fb1");
    ok("E2 Échap : rien n'est écrit (pas de crop), même en relâchant ailleurs", cropOfDraft() === undefined && near(after.frame.h, a.frame.h, 1.5));
    const hist = await page.locator('button[aria-label="Défaire"]').isDisabled();
    ok("E3 Échap : aucun pas d'historique (Annuler grisé)", hist, String(hist));

    await select("fb1", "a1");
    await cropDrag("se", -150, -80, { alt: true });
    await settled(page);
    const c1 = cropOfDraft();
    const g1 = await geom("fb1");
    ok("E4 recadrage coin « se » écrit", Boolean(c1?.r > 5 && c1?.b > 5), JSON.stringify(c1));
    await undo();
    ok("E5 Annuler : crop retiré et cadre d'avant", await waitFor(() => cropOfDraft() === undefined) && near((await geom("fb1")).frame.h, a.frame.h, 2));
    await redo();
    ok("E6 Rétablir : crop revenu, cadre identique", await waitFor(() => JSON.stringify(cropOfDraft()) === JSON.stringify(c1)) && near((await geom("fb1")).frame.h, g1.frame.h, 2));

    await open();
    const rel = await geom("fb1");
    const relTo = (g) => g.items.map((i) => [i.x - g.frame.x, i.y - g.frame.y, i.w, i.h]);
    ok("E7 rechargement de l'éditeur : même cadre, mêmes images (dans le cadre)", near(rel.frame.w, g1.frame.w, 2) && near(rel.frame.h, g1.frame.h, 2) && relTo(rel).every((r, k) => r.every((v, j) => near(v, relTo(g1)[k][j], 1.5))), JSON.stringify([g1.frame, rel.frame]));
    const edNorm = await NORM(f);

    ok("E8 publication", await publish((b) => b));
    ok("E9 le crop est publié tel quel", JSON.stringify(savedProps("free-board")[0]?.crop) === JSON.stringify(c1), JSON.stringify(savedProps("free-board")[0]));
    for (const [w, h] of [[1440, 900], [1024, 800]]) {
      const p = await publicPage(w, h);
      const pubNorm = await NORM(p);
      ok(`E10 site à ${w} px = éditeur (cadre et images, ±1 %)`, sameNorm(edNorm, pubNorm), JSON.stringify([edNorm, pubNorm]));
      await p.context().close();
    }
    const ph = await publicPage(390, 844, { isMobile: true, hasTouch: true });
    const phNorm = await NORM(ph);
    const over = await ph.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
    ok("E11 téléphone (390, à l'échelle) : même composition, aucun débordement", sameNorm(edNorm, phNorm) && over, JSON.stringify([edNorm, phNorm]));
    await ph.context().close();
    ok("E12 rien d'édition dans le HTML public (aucun repère de poignée)", await (async () => { const p = await publicPage(1440, 900); const html = await p.content(); await p.context().close(); return !/free-crop|data-edit-free/.test(html); })());
    // Téléphone « empilé » : le recadrage ne s'applique pas à la colonne empilée.
    ok("E12b publication du mode « empilées »", await publish((b) => b.map((x) => (x.type === "free-board" ? { ...x, props: { ...x.props, phone: "stack" } } : x))));
    ok("E12c le mode empilé est publié (phone: stack, crop gardé)", savedProps("free-board")[0]?.phone === "stack" && Boolean(savedProps("free-board")[0]?.crop), JSON.stringify(savedProps("free-board")[0]));
    const st = await publicPage(390, 844, { isMobile: true, hasTouch: true });
    const stk = await st.evaluate(() => { const z = document.querySelector(".free-board"); const r = z.getBoundingClientRect(); const pcs = getComputedStyle(z.parentElement); return { phone: z.dataset.phone, vw: innerWidth, w: r.width, col: z.parentElement.clientWidth - parseFloat(pcs.paddingLeft) - parseFloat(pcs.paddingRight), flex: getComputedStyle(z).display, over: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 }; });
    ok("E13 téléphone « empilées » : colonne pleine largeur malgré le recadrage, sans débordement", stk.flex === "flex" && near(stk.w, stk.col, 1) && stk.over, JSON.stringify(stk));
    await st.context().close();
  });

if (run("M"))
  await section("M", async () => {
    setDraft(pageId, BENCH());
    await open();
    await select("fb1", "a1");
    const a = await geom("fb1");
    const W = a.frame.w;
    const H0 = a.frame.h;
    // 16:9 : hauteur = W × 9/16 ; on s'arrête 6 px au-dessus, magnétisme actif.
    const target = (W * 9) / 16;
    await cropDrag("s", 0, target + 6 - H0, { hold: true });
    const badge = await f.getByTestId("free-crop-badge").textContent().catch(() => "");
    ok("M1 le badge du geste annonce le repère « 16:9 »", /16:9/.test(badge ?? ""), String(badge));
    await page.mouse.up();
    await sleep(300);
    await settled(page);
    const g = await geom("fb1");
    ok("M2 le format du cadre colle à 16:9 (±0,3 %)", near(g.frame.w / g.frame.h, 16 / 9, 0.006), `${g.frame.w / g.frame.h}`);
    await undo();
    // 4:3 en agrandissant, 1:1 aussi.
    await cropDrag("s", 0, (W * 3) / 4 + 5 - H0, { hold: true });
    ok("M3 agrandi : badge « 4:3 »", /4:3/.test((await f.getByTestId("free-crop-badge").textContent().catch(() => "")) ?? ""));
    await page.mouse.up();
    await sleep(300);
    await settled(page);
    ok("M3b format 4:3 exact, cadre plus haut qu'avant, images immobiles", near((await geom("fb1")).frame.w / (await geom("fb1")).frame.h, 4 / 3, 0.006) && still(a, await geom("fb1")));
    await undo();
    // Bord collé au contenu.
    const contentY = a.frame.y + (CONTENT_BOTTOM / 100) * H0;
    await cropDrag("s", 0, contentY + 3 - (a.frame.y + H0), { hold: true });
    ok("M4 badge « contenu » près du bas des images", /contenu/i.test((await f.getByTestId("free-crop-badge").textContent().catch(() => "")) ?? ""));
    await page.mouse.up();
    await sleep(300);
    await settled(page);
    ok("M5 le bas du cadre colle au bas des images (b = 100 − bas du contenu, ±0,3)", near(cropOfDraft()?.b ?? -1, 100 - CONTENT_BOTTOM, 0.3), JSON.stringify([cropOfDraft(), 100 - CONTENT_BOTTOM]));
    await undo();
    // Alt coupe le magnétisme.
    await cropDrag("s", 0, target + 6 - H0, { alt: true });
    await settled(page);
    const g2 = await geom("fb1");
    ok("M6 Alt : aucun magnétisme (hauteur exacte au pixel près)", near(g2.frame.h, target + 6, 1.5), `${g2.frame.h} vs ${target + 6}`);
    await undo();
  });

if (run("W"))
  await section("W", async () => {
    setDraft(pageId, BENCH());
    await open();
    await select("fb1", "a1");
    await cropDrag("s", 0, -100, { alt: true });
    await settled(page);
    const a = await geom("fb1");
    await page.keyboard.press("Escape");
    // Barre du bloc : « Largeur » (curseur aimanté, le même composant que les autres blocs).
    await scrollTo(zoneOf("fb1"));
    await f.locator('[data-edit-block="fb1"]').first().click({ position: { x: 4, y: 4 } }).catch(() => {});
    const btn = f.locator('.pe-tools [data-testid="width-button"]');
    ok("W1 la barre du bloc propose « Largeur »", (await btn.count()) === 1);
    if (await btn.count()) {
      await btn.click();
      const slider = f.locator('[data-testid="slider-width"] input[type=range]');
      await slider.waitFor({ timeout: 20000 });
      await slider.fill("64");
      ok("W2 la largeur est écrite (look.width = 64)", await waitFor(() => propsOf("fb1").look?.width === 64), JSON.stringify(propsOf("fb1").look));
      await page.keyboard.press("Escape");
      await settled(page);
      const b = await geom("fb1");
      ok("W3 le cadre suit la largeur du bloc (≈ 64 % de sa largeur d'avant, ±3 %), recadrage conservé", near(b.frame.w / a.frame.w, 0.64, 0.07) && cropOfDraft()?.b > 5, JSON.stringify([a.frame, b.frame]));
      ok("W4 même format de cadre qu'avant", near(b.frame.w / b.frame.h, a.frame.w / a.frame.h, 0.03));
      ok("W5 les images gardent leur place dans le cadre (en % du cadre)", (() => { const ia = a.items[0], ib = b.items[0]; return near((ib.x - b.frame.x) / b.frame.w, (ia.x - a.frame.x) / a.frame.w, 0.01) && near((ib.y - b.frame.y) / b.frame.h, (ia.y - a.frame.y) / a.frame.h, 0.01); })());
    }
  });

/* ================================================ T : tactile ================================================ */
if (run("T"))
  for (const [name, vp] of [["tactile 1024", { width: 1024, height: 800 }], ["tactile 390", { width: 390, height: 844 }]]) {
    await section(`T ${name}`, async () => {
      setDraft(pageId, BENCH());
      const tctx = await browser.newContext({ viewport: vp, hasTouch: true, isMobile: true, storageState: await ctx.storageState() });
      const tp = await tctx.newPage();
      tp.setDefaultTimeout(60000);
      await tp.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
      const fh = await tp.waitForSelector("iframe.ve-frame", { timeout: 120000 });
      const tf = await fh.contentFrame();
      await tf.waitForSelector("html[data-edit-mode]", { timeout: 180000 });
      await sleep(2500);
      const cdp = await tctx.newCDPSession(tp);
      const zone = tf.locator('[data-edit-block="fb1"] .free-board[data-edit-free]').first();
      const gm = () => zone.evaluate((z) => { const r = z.getBoundingClientRect(); return { frame: { x: r.left, y: r.top, w: r.width, h: r.height }, items: [...z.querySelectorAll(":scope > .free-item")].map((el) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; }) }; });
      await zone.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await sleep(500);
      const first = zone.locator(':scope > .free-item[data-free-item="a1"]');
      await first.tap();
      const hd = (h) => tf.getByTestId(`free-crop-${h}`);
      await hd("s").waitFor({ timeout: 10000 });
      for (const h of ["s", "se", "e"]) {
        const b = await hd(h).boundingBox();
        ok(`T1 ${name} : poignée « ${h} » assez grande pour le doigt (≥ 40 px)`, b && b.width >= 40 && b.height >= 40, JSON.stringify(b));
      }
      const touch = async (h, dx, dy) => {
        const b = await hd(h).boundingBox();
        const x = b.x + b.width / 2;
        const y = b.y + b.height / 2;
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 1 }] });
        for (let k = 1; k <= 8; k++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + (dx * k) / 8, y: y + (dy * k) / 8, id: 1 }] });
        await sleep(150);
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await sleep(500);
        await settled(tp);
      };
      const g0 = await gm();
      const win0 = await tp.evaluate(() => scrollY);
      await touch("s", 0, -50);
      const g1 = await gm();
      ok(`T2 ${name} : bord bas au doigt : cadre plus bas de 50 px (±12, magnétisme), images immobiles`, near(g0.frame.h - g1.frame.h, 50, 12) && g1.items.every((i, k) => near(i.x, g0.items[k].x, 1) && near(i.y, g0.items[k].y, 1)), JSON.stringify([g0.frame, g1.frame]));
      ok(`T3 ${name} : la page n'a pas défilé pendant le geste`, near(await tp.evaluate(() => scrollY), win0, 2));
      await first.tap();
      await touch("se", -40, -30);
      const g2 = await gm();
      ok(`T4 ${name} : coin au doigt : largeur et hauteur réduites`, g2.frame.w < g1.frame.w - 15 && g2.frame.h < g1.frame.h - 10, JSON.stringify([g1.frame, g2.frame]));
      await first.tap();
      await touch("e", -30, 0);
      ok(`T5 ${name} : bord latéral au doigt : largeur réduite`, (await gm()).frame.w < g2.frame.w - 15);
      ok(`T6 ${name} : crop écrit`, Boolean(propsOf("fb1").crop?.b > 0 && propsOf("fb1").crop?.r > 0), JSON.stringify(propsOf("fb1").crop));
      await tctx.close();
    });
  }

/* ================================================ G : grille ================================================ */
const GRID = (extra = {}) => ({ uid: "gr", type: "grid", props: { layout: "custom", cols: 3, ratio: "4:3", gap: "normal", align: "stretch", children: [{ uid: "ci", type: "image", props: { width: "wide", mediaId: ids.feuille } }, { uid: "cf", type: "free-board", props: { format: "3:2", phone: "scale", items: [{ id: "g1", media: ids.fleur, x: 10, y: 10, w: 30, rot: 0, z: 0 }, { id: "g2", media: ids.etoile, x: 50, y: 30, w: 25, rot: 0, z: 1 }] } }, { uid: "cj", type: "image", props: { width: "wide", mediaId: ids.carre } }], spans: [{ w: 1, h: 1 }, { w: 2, h: 1 }, { w: 1, h: 1 }], ...extra } });
const cellEl = (uid) => f.locator(`[data-edit-block="${uid}"]`).first();
if (run("G"))
  await section("G", async () => {
    // G1 : planche en cellule, rendu.
    setDraft(pageId, [sep("s0", "S113a"), GRID(), sep("s1", "S113b")]);
    await open();
    const info = () =>
      f.evaluate(() => {
        const cells = [...document.querySelectorAll(".block-grid .block-grid-cell")].filter((c) => !c.hasAttribute("data-edit-cell-free"));
        const gr = document.querySelector(".block-grid").getBoundingClientRect();
        return { gw: gr.width, gh: gr.height, cells: cells.map((c) => { const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, free: Boolean(c.querySelector(".free-board")), shell: Boolean(c.querySelector(".free-board-section.shell")) }; }) };
      });
    const i0 = await info();
    ok("G1 la planche libre est rendue dans sa cellule (3 cellules, la 2e est la planche), sans enveloppe de section", i0.cells.length === 3 && i0.cells[1].free && !i0.cells[1].shell, JSON.stringify(i0));
    ok("G2 la planche remplit la largeur de sa cellule (span 2 sur 3)", i0.cells[1].w > i0.cells[0].w * 1.8);
    const free = f.locator(".block-grid-cell .free-board[data-edit-free]").first();
    const fbShapes = (z) => near(z.items[0].w / z.items[0].h, RATIO.fleur, 0.03) && near(z.items[1].w / z.items[1].h, RATIO.etoile, 0.04);
    const fb = () => free.evaluate((z) => { const r = z.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, items: [...z.querySelectorAll(":scope > .free-item")].map((el) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; }) }; });
    // G3 : déplacer une image dans la planche en cellule.
    await free.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await sleep(500);
    const g1 = free.locator(':scope > .free-item[data-free-item="g1"]');
    const c1 = await center(g1);
    await page.mouse.move(c1.x, c1.y);
    await page.mouse.down();
    await page.mouse.move(c1.x + 20, c1.y + 10, { steps: 3 });
    await page.mouse.move(c1.x + 60, c1.y + 30, { steps: 6 });
    await page.mouse.up();
    await settled(page);
    const mv = propsOf("cf").items.find((i) => i.id === "g1");
    ok("G3 glisser une image de la planche en cellule la déplace (x et y changent)", mv.x > 10 + 3 && mv.y > 10 + 2, JSON.stringify(mv));
    ok("G3b la grille et les autres cellules ne bougent pas", JSON.stringify(propsOf("gr").spans) === JSON.stringify(GRID().props.spans) && propsOf("gr").layout === "custom");
    ok("G3c les images de la planche gardent leur forme dans la cellule (format du média, ±3 %)", fbShapes(await fb()), JSON.stringify(await fb()));
    // G4 : recadrer le bas dans la cellule.
    await click(g1);
    await handle("s").waitFor({ timeout: 10000 });
    const before = await info();
    const fb0 = await fb();
    await cropDrag("s", 0, -60, { alt: true });
    await settled(page);
    const after = await info();
    const fb1 = await fb();
    ok("G4 bord bas dans la cellule : la planche est plus basse de 60 px (±3), images immobiles", near(fb0.h - fb1.h, 60, 3) && fb1.items.every((m, k) => near(m.x, fb0.items[k].x, 1) && near(m.y, fb0.items[k].y, 1)), JSON.stringify([fb0, fb1]));
    ok("G5 la hauteur de la rangée suit (la grille est plus basse) sans toucher aux autres cellules (largeurs identiques)", after.gh < before.gh - 20 && near(after.cells[0].w, before.cells[0].w, 1) && near(after.cells[2].w, before.cells[2].w, 1), JSON.stringify([before, after]));
    ok("G5b après recadrage : formes des images intactes, cadre = 3:2 recadré", fbShapes(fb1), JSON.stringify([fb1, propsOf("cf").crop]));
    ok("G6 crop écrit sur la planche seule ; spans et ratio de la grille intacts", propsOf("cf").crop?.b > 5 && JSON.stringify(propsOf("gr").spans) === JSON.stringify(GRID().props.spans) && propsOf("gr").ratio === "4:3");
    // G7 : bord latéral = largeur de la case (aimant sur les colonnes).
    await click(g1);
    await handle("e").waitFor({ timeout: 10000 });
    const colW = before.gw / 3;
    await cropDrag("e", -colW * 0.95, 0, { alt: false });
    await settled(page);
    const sp = propsOf("gr").spans;
    ok("G7 bord droit tiré d'une colonne vers la gauche : la case passe à 1 colonne (aimant sur les colonnes), autres cases intactes", sp?.[1]?.w === 1 && sp[0].w === 1 && sp[2].w === 1 && propsOf("gr").layout === "custom", JSON.stringify(sp));
    ok("G7b les cellules voisines gardent leur ratio 4:3 (largeur ÷ hauteur de leur image)", await f.evaluate(() => [...document.querySelectorAll('.block-grid .block-image .media-frame, .block-grid .block-image .media-box')].every((m) => { const r = m.getBoundingClientRect(); return r.height === 0 || Math.abs(r.width / r.height - 4 / 3) < 0.08; })));
    await undo();
    ok("G7c Annuler rend la largeur de case d'avant", await waitFor(() => propsOf("gr").spans?.[1]?.w === 2));
    await undo();
    ok("G7d Annuler rend la planche non recadrée", await waitFor(() => propsOf("cf").crop === undefined));
    // G8 : insertion d'une planche libre depuis une case libre.
    setDraft(pageId, [sep("s0", "S113a"), { uid: "gr", type: "grid", props: { layout: "2", ratio: "4:3", children: [{ uid: "ci", type: "image", props: { width: "wide", mediaId: ids.feuille } }] } }, sep("s1", "S113b")]);
    await open();
    const freeBtn = f.locator('.block-grid [data-edit-cell-free] [data-edit-cell-text="free"]').first();
    ok("G8 une case libre propose « Planche libre »", (await freeBtn.count()) === 1);
    if (await freeBtn.count()) {
      await freeBtn.scrollIntoViewIfNeeded();
      await freeBtn.click();
      ok("G8b la planche libre est insérée comme 2e composant de la grille", await waitFor(() => propsOf("gr").children?.length === 2 && propsOf("gr").children[1].type === "free-board"), JSON.stringify(propsOf("gr")));
      await settled(page);
      ok("G8c la planche vide montre « + Image » dans sa case", (await f.locator(".block-grid-cell .free-board[data-edit-free] [data-edit-free-add]").count()) === 1);
      await undo();
      ok("G8d Annuler retire la planche insérée", await waitFor(() => propsOf("gr").children?.length === 1));
    }
    // G9 : site en ligne = éditeur, téléphone.
    setDraft(pageId, [sep("s0", "S113a"), GRID({ }), sep("s1", "S113b")]);
    await open();
    const free2 = f.locator(".block-grid-cell .free-board[data-edit-free]").first();
    await free2.evaluate((el) => el.scrollIntoView({ block: "center" }));
    await sleep(400);
    await click(free2.locator(':scope > .free-item[data-free-item="g1"]'));
    await handle("s").waitFor({ timeout: 10000 });
    await cropDrag("s", 0, -50, { alt: true });
    await settled(page);
    ok("G9a le recadrage de la planche en cellule est écrit avant la publication", propsOf("cf").crop?.b > 3, JSON.stringify(propsOf("cf")));
    const parts = (root) => root.evaluate(() => { const z = document.querySelector(".block-grid-cell .free-board"); const chain = []; for (let e = z; e && !e.classList.contains("block-grid"); e = e.parentElement) chain.push(`${e.tagName.toLowerCase()}.${[...e.classList].join(".")}:${Math.round(e.getBoundingClientRect().height * 10) / 10}`); return chain; });
    console.log(`# G9 crop=${JSON.stringify(propsOf("cf").crop)} chaine editeur=${JSON.stringify(await parts(f))}`);
    const edNorm = await NORM(f);
    const edInfo = await info();
    ok("G9 publication", await publish((b) => b));
    const p = await publicPage(1440, 900);
    const pubNorm = await NORM(p);
    console.log(`# G9 chaine public=${JSON.stringify(await parts(p))}`);
    const pubInfo = await p.evaluate(() => { const cells = [...document.querySelectorAll(".block-grid .block-grid-cell")]; const g = document.querySelector(".block-grid").getBoundingClientRect(); return { gw: g.width, gh: g.height, ws: cells.map((c) => c.getBoundingClientRect().width / g.width) }; });
    ok("G9b site = éditeur : composition de la planche (cadre et images, ±1 %)", sameNorm(edNorm, pubNorm), JSON.stringify([edNorm, pubNorm]));
    // La toile ajoute sous chaque case les champs de légende (absents du site) : on compare les largeurs des cases, pas la hauteur de la grille.
    ok("G9c site = éditeur : proportions des cellules (±1 %)", pubInfo.ws.every((w, k) => near(w, edInfo.cells[k].w / edInfo.gw, 0.01)), JSON.stringify([pubInfo, edInfo]));
    ok("G9d public : pas de section de planche imbriquée ni de repères d'édition", await p.evaluate(() => !document.querySelector(".block-grid .free-board-section.shell") && !document.querySelector("[data-edit-free]")));
    await p.context().close();
    const ph = await publicPage(390, 844, { isMobile: true, hasTouch: true });
    const phInfo = await ph.evaluate(() => { const g = document.querySelector(".block-grid"); const gr = g.getBoundingClientRect(); const z = g.querySelector(".free-board").getBoundingClientRect(); return { gw: gr.width, zw: z.width, over: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 }; });
    ok("G10 téléphone : la planche de la cellule prend la largeur de la grille (1 colonne), sans débordement", near(phInfo.zw, phInfo.gw, 2) && phInfo.over, JSON.stringify(phInfo));
    await ph.context().close();
  });

ok("aucune erreur de page pendant la suite", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout est vert");
process.exit(failures ? 1 : 0);
