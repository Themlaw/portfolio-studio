#!/usr/bin/env node
/**
 * Lot 99 « images qui défilent : hauteur fixe, barre du kit, flèches lisibles et immobiles » (serveur requis, base neuve, une connexion
 * admin ; chromium, ou BROWSER=firefox pour B et F). Images, légendes et DESSINS DU KIT SYNTHÉTIQUES (scripts/lib/defil99.mjs : dégradés
 * de couleurs avec saturation variable, jamais le kit de l'artiste). Souris réelle pour les clics.
 *
 *  H  Hauteur du rail mesurée à 5 positions de défilement (écart 0 px) : images de formats variés (panorama, très haute, carré, minuscule,
 *     portrait) et légendes de longueurs variées, projet ET carrousel à liste propre, site public et éditeur, 1440 et 390 px ; hauteur
 *     aussi constante PENDANT le défilement animé (échantillonnage à chaque image) et pendant le chargement des images (retardées).
 *  A  Flèches sans kit : au moins 32 × 32 px, immobiles (même position verticale à toutes les positions et pour toutes les images, centrées
 *     sur la hauteur constante du bandeau), plusieurs clics de suite au MÊME point de l'écran, sans bouger même quand une légende grandit.
 *  K  Kit synthétique importé par le vrai parcours (PSD → import → thème en ligne) : barre de défilement (B) et flèches (F) rendues
 *     exactement comme dessinées : style calculé (aucun masque, aucune teinte, aucun carré), pixels comparés au calque, taille prévue par le
 *     kit, position identique d'une image à l'autre ; chromium et firefox.
 *  P  Parité au pixel des autres blocs, hors bandeaux (BATT_PARITY_WRITE=dossier sur la base, BATT_PARITY_READ=dossier sur le lot ; sinon ignorée).
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=H,A,K] [BROWSER=firefox] [SHOTS=dossier] node scripts/e2e-defilement99.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium, firefox } from "playwright";
import sharp from "sharp";

import { paint } from "./lib/crop-fixtures.mjs";
import { ARROW_BOX, arrowSvg, barSvg } from "./lib/defil99.mjs";
import { installKitFrameTheme } from "./lib/cadres62.mjs";
import { canvas, login, pageIdOf, q1, setBoardDraft, setDraft, sleep, sql, waitFor } from "./lib/grille31d.mjs";

const BASE = process.env.BASE ?? "http://localhost:3820";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const ENGINE = process.env.BROWSER === "firefox" ? firefox : chromium;
const SHOTS = process.env.SHOTS ?? path.join(process.env.BATTERY_DIR ?? tmpdir(), "shots-defilement99");
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const info = (label, v) => console.log(`INFO ${label}${v === undefined ? "" : ` : ${typeof v === "string" ? v : JSON.stringify(v)}`}`);

const browser = await ENGINE.launch(ENGINE === chromium ? { args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] } : {});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
page.setDefaultNavigationTimeout(180000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);

/* ---- Images et légendes de test (synthétiques) -------------------------------------------------------------------------- */
async function upload(name, buffer) {
  const res = await page.request.post(`${BASE}/admin/api/upload`, { headers: { origin: BASE }, multipart: { file: { name, mimeType: "image/png", buffer } }, timeout: 180000 });
  if (res.status() >= 300) throw new Error(`envoi de ${name} : ${res.status()}`);
}
const mediaOf = (name) => q1("select id, status from media where original_name = ? order by id desc", name);
async function ensure(name, w, h, seed) {
  if (!mediaOf(name)) await upload(name, await paint(w, h, seed));
  if (!(await waitFor(() => mediaOf(name)?.status === "ready", 240000))) throw new Error(`${name} : ${JSON.stringify(mediaOf(name))}`);
  return mediaOf(name).id;
}
const PANO = await ensure("99-panorama.png", 6000, 1200, 1);
const HAUT = await ensure("99-haut.png", 900, 5000, 2);
const CARRE = await ensure("99-carre.png", 1200, 1200, 3);
const MINI = await ensure("99-mini.png", 120, 80, 4);
const GRAND = await ensure("99-grand.png", 3000, 2000, 5);
const PORTRAIT = await ensure("99-portrait.png", 1000, 1500, 6);

const T = (s) => ({ fr: s, en: s });
const LONG = "Une légende très longue, qui revient plusieurs fois à la ligne sous une image étroite, pour réserver la place de la plus haute des légendes du bandeau. ".repeat(2);
const pageId = pageIdOf("personnages");
const PROJECT = q1("select id, slug from projects order by id limit 1");
const MEDIA = [PANO, HAUT, CARRE, MINI, GRAND, PORTRAIT];
const TITLES = ["Panorama d'essai", "Grande tour", "", "Minuscule", "Un titre un peu plus long pour la grande image", "Portrait"];
const DESCS = ["Une vue d'ensemble", LONG, "", "Courte", "Une légende moyenne sur deux lignes environ, pas plus", ""];
sql((db) => {
  const slots = db.prepare("select id from slots where project_id = ? order by position").all(PROJECT.id);
  slots.slice(0, MEDIA.length).forEach((s, i) => db.prepare("update slots set media_id = ?, title = ?, description = ?, aspect = null where id = ?").run(MEDIA[i], JSON.stringify(T(TITLES[i])), JSON.stringify(T(DESCS[i])), s.id));
  db.prepare("update projects set draft_layout = null, draft_layout_page_id = null where id = ?").run(PROJECT.id);
});
const LAYOUT = [
  { uid: "s1", type: "strip", props: {} },
  { uid: "c1", type: "strip", props: { source: "own", media: [PORTRAIT, PANO, MINI, HAUT, CARRE, GRAND, PORTRAIT, CARRE, MINI, GRAND, PORTRAIT, CARRE, HAUT, GRAND] } },
];
const BOARD = [{ uid: "pbd", type: "project-board", props: { project: PROJECT.slug } }];
const ABOVE = [
  { uid: "t0", type: "rich-text", props: { paragraphs: [T("Texte au-dessus du carrousel, hors des bandeaux.")] } },
  { uid: "i0", type: "image", props: { mediaId: CARRE, width: "wide" } },
];
const OTHERS = [
  { uid: "t1", type: "rich-text", props: { paragraphs: [T("Texte de fin, hors du carrousel.")] } },
  { uid: "i1", type: "image", props: { mediaId: GRAND, width: "wide" } },
];

async function publishBlocks(blocks) {
  sql((db) => db.prepare("update projects set layout = ? where id = ?").run(JSON.stringify(LAYOUT), PROJECT.id));
  setDraft(pageId, blocks);
  await page.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
  await canvas(page);
  await sleep(2500);
  const publish = page.getByRole("button", { name: "Publier", exact: true });
  await waitFor(async () => !(await publish.isDisabled()), 30000);
  await publish.click();
  const confirm = page.locator("dialog[open]").getByRole("button", { name: "Mettre en ligne" });
  if (await confirm.waitFor({ timeout: 3000 }).then(() => true, () => false)) await confirm.click();
  const done = await waitFor(() => sql((db) => db.prepare("select draft from pages where id = ?").get(pageId)).draft === null, 180000);
  await sleep(1500);
  return done;
}
ok("P0 publication de la page de test", await publishBlocks([...ABOVE, ...BOARD, ...OTHERS]));

async function publicPage(options = {}, url = "/fr/personnages") {
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  const p = await c.newPage();
  p.setDefaultTimeout(45000);
  p.on("pageerror", (e) => errors.push(`public : ${e.message}`));
  await p.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
  await p.evaluate(() => document.fonts.ready);
  return p;
}
/** Éditeur ouvert sur la planche (brouillon avec le carrousel), largeur d'aperçu donnée : retourne la toile (cadre). */
async function editorCanvas(device) {
  setDraft(pageId, [...ABOVE, ...BOARD, ...OTHERS]);
  setBoardDraft(PROJECT.id, pageId, LAYOUT);
  await page.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
  let fr = await canvas(page);
  await sleep(1500);
  if (device) {
    await page.getByRole("group", { name: "Largeur d'aperçu" }).getByRole("button", { name: device }).click();
    await sleep(2500);
    fr = await (await page.waitForSelector("iframe.ve-frame")).contentFrame();
    await fr.waitForSelector("html[data-edit-mode]", { timeout: 60000 });
  }
  await fr.waitForSelector(".strip-rail", { timeout: 60000 });
  await sleep(1500);
  return fr;
}
const shot = (target, name) => target.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});
const section = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 6).join(" "));
    await page.screenshot({ path: path.join(SHOTS, `erreur-${name.replace(/\W+/g, "-")}.png`) }).catch(() => {});
  }
};

/* ---- Sondes (dans la page ou la toile) ---------------------------------------------------------------------------------- */
/** Une mesure par bandeau : hauteur du rail, du cadre, position des flèches relative au haut du cadre, bloc qui suit. */
const probe = () =>
  [...document.querySelectorAll(".strip-rail")].map((rail) => {
    const vp = rail.closest(".strip-viewport");
    const r = rail.getBoundingClientRect();
    const v = vp.getBoundingClientRect();
    const rel = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { y: +(b.top - v.top).toFixed(2), h: +b.height.toFixed(2), w: +b.width.toFixed(2), cy: +(b.top + b.height / 2 - v.top).toFixed(2), x: +(b.left - v.left).toFixed(2) };
    };
    const frames = [...rail.querySelectorAll(":scope .strip-frame")];
    const pad = parseFloat(getComputedStyle(rail).paddingBottom) || 0;
    const content = Math.max(0, ...frames.map((f) => f.getBoundingClientRect().bottom - r.top)) + pad;
    const boxes = frames.map((f) => Math.round(f.querySelector(".strip-media")?.getBoundingClientRect().height ?? 0));
    return {
      id: rail.id,
      railH: +r.height.toFixed(2),
      vpH: +v.height.toFixed(2),
      content: +content.toFixed(2),
      slack: rail.scrollWidth - rail.clientWidth,
      scroll: Math.round(rail.scrollLeft),
      prev: rel(vp.querySelector(".strip-nav-prev")),
      next: rel(vp.querySelector(".strip-nav-next")),
      boxes,
      pageH: document.documentElement.scrollHeight,
    };
  });
const scrollTo = async (target, index, frac) => {
  await target.evaluate(
    ([i, f]) => {
      const rail = document.querySelectorAll(".strip-rail")[i];
      rail.scrollTo({ left: Math.round((rail.scrollWidth - rail.clientWidth) * f), behavior: "instant" });
    },
    [index, frac],
  );
  await sleep(500);
};
/** Souris au centre du cadre du bandeau `i` (les flèches n'apparaissent qu'au survol du cadre). */
const hoverRail = async (p, i) => {
  const b = await p.locator(".strip-viewport").nth(i).boundingBox();
  await p.mouse.move(b.x + b.width / 2 - 20, b.y + b.height / 2 - 10);
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
  await sleep(500);
};
/** Clic réel sur la flèche suivante du bandeau `i`. */
const nextBoxClick = async (p, i) => {
  await hoverRail(p, i);
  const b = await p.locator(".strip-viewport").nth(i).locator(".strip-nav-next").boundingBox();
  await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 3 });
  await p.mouse.down();
  await p.mouse.up();
};
const spread = (values) => +(Math.max(...values) - Math.min(...values)).toFixed(2);

/** H : hauteur du rail et position des flèches à 5 positions de défilement, pour chaque bandeau de `target`. */
async function heights(target, tag) {
  const base = await target.evaluate(probe);
  ok(`${tag} : deux bandeaux (projet et carrousel à liste propre) avec de quoi défiler`, base.length >= 2 && base.every((b) => b.slack > 200), JSON.stringify(base.map((b) => b.slack)));
  for (let i = 0; i < base.length; i++) {
    const rows = [];
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      await scrollTo(target, i, f);
      rows.push((await target.evaluate(probe))[i]);
    }
    ok(`${tag} bandeau ${i + 1} : hauteur du rail identique aux 5 positions (écart 0 px)`, spread(rows.map((r) => r.railH)) === 0, rows.map((r) => r.railH).join(" / "));
    ok(`${tag} bandeau ${i + 1} : hauteur du cadre et du bloc qui suit identiques (page ${rows[0].pageH} px)`, spread(rows.map((r) => r.vpH)) === 0 && spread(rows.map((r) => r.pageH)) === 0, rows.map((r) => `${r.vpH}/${r.pageH}`).join(" "));
    ok(`${tag} bandeau ${i + 1} : hauteur des images identique aux 5 positions`, rows.every((r) => JSON.stringify(r.boxes) === JSON.stringify(rows[0].boxes)), JSON.stringify(rows.map((r) => r.boxes)));
    ok(`${tag} bandeau ${i + 1} : la plus haute légende a sa place (rien ne dépasse du rail)`, Math.abs(rows[0].railH - rows[0].content) <= 1 || rows[0].railH >= rows[0].content, `${rows[0].railH} < ${rows[0].content}`);
    const navs = rows.filter((r) => r.prev && r.next);
    ok(`${tag} bandeau ${i + 1} : flèches à la même hauteur aux 5 positions (écart 0 px)`, navs.length === 5 && spread(navs.map((r) => r.prev.cy)) === 0 && spread(navs.map((r) => r.next.cy)) === 0 && spread(navs.map((r) => r.prev.cy - r.next.cy)) === 0, JSON.stringify(navs.map((r) => [r.prev.cy, r.next.cy])));
    await scrollTo(target, i, 0);
  }
  return base;
}

/* ================================================================================================================================ */
/* H : hauteur constante                                                                                                              */
/* ================================================================================================================================ */
if (run("H")) {
  for (const w of [1440, 390]) await section(`H public ${w}`, async () => {
    const p = await publicPage({ viewport: { width: w, height: w === 390 ? 844 : 900 }, deviceScaleFactor: w === 390 ? 2 : 1 });
    await p.locator(".strip-rail").first().scrollIntoViewIfNeeded();
    await shot(p, `H-public-${w}-depart`);
    await heights(p, `H public ${w} px`);
    await p.context().close();
  });
  for (const [device, w] of [
    ["Grand écran", 1440],
    ["Téléphone", 390],
  ])
    await section(`H éditeur ${w}`, async () => {
      const fr = await editorCanvas(device);
      await heights(fr, `H éditeur ${w} px`);
      await shot(page, `H-editeur-${w}`);
    });

  // Pendant le défilement animé : on échantillonne la hauteur à chaque image, flèche « suivante » cliquée quatre fois.
  await section("H défilement animé", async () => {
    const p = await publicPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "no-preference" });
    await p.locator(".strip-rail").nth(1).scrollIntoViewIfNeeded();
    await hoverRail(p, 1);
    info("H état initial des flèches du premier bandeau", await p.evaluate(() => {
      const vp = document.querySelectorAll(".strip-viewport")[1];
      const rail = vp.querySelector(".strip-rail");
      return { atStart: vp.dataset.atStart, atEnd: vp.dataset.atEnd, overflows: vp.dataset.overflows, slack: rail.scrollWidth - rail.clientWidth, left: rail.scrollLeft, next: vp.querySelector(".strip-nav-next")?.disabled, prev: vp.querySelector(".strip-nav-prev")?.disabled };
    }));
    await p.evaluate(() => {
      window.__h = [];
      const rail = document.querySelectorAll(".strip-rail")[1];
      const vp = rail.closest(".strip-viewport");
      const tick = () => {
        window.__h.push([rail.getBoundingClientRect().height, document.documentElement.scrollHeight, vp.querySelector(".strip-nav-next")?.getBoundingClientRect().top - vp.getBoundingClientRect().top]);
        window.__raf = requestAnimationFrame(tick);
      };
      tick();
    });
    for (let i = 0; i < 4; i++) {
      await nextBoxClick(p, 1);
      await sleep(900);
    }
    const samples = await p.evaluate(() => {
      cancelAnimationFrame(window.__raf);
      return window.__h;
    });
    ok(`H défilement animé (flèche suivante ×4, ${samples.length} images) : hauteur du rail, de la page et position des flèches ne bougent jamais`, new Set(samples.map((s) => s[0])).size === 1 && new Set(samples.map((s) => s[1])).size === 1 && new Set(samples.map((s) => s[2])).size === 1, JSON.stringify([...new Set(samples.map((s) => s.join("/")))].slice(0, 6)));
    await p.context().close();
  });

  // Pendant le chargement : les images arrivent lentement, rien ne saute (cases de taille fixe).
  for (const w of [1440, 390]) await section(`H chargement ${w}`, async () => {
    const c = await browser.newContext({ viewport: { width: w, height: 900 } });
    const p = await c.newPage();
    await p.route(/\/img\//, async (route) => {
      await sleep(1500);
      await route.continue().catch(() => {});
    });
    await p.goto(`${BASE}/fr/personnages`, { waitUntil: "commit" });
    await p.waitForSelector(".strip-rail", { timeout: 60000 });
    await p.evaluate(() => document.fonts.ready);
    const before = await p.evaluate(probe);
    await p.waitForLoadState("networkidle");
    await sleep(500);
    const after = await p.evaluate(probe);
    ok(`H chargement ${w} px : la hauteur du rail et des cases ne change pas quand les images arrivent`, before.length === after.length && before.every((b, i) => b.railH === after[i].railH && JSON.stringify(b.boxes) === JSON.stringify(after[i].boxes)), JSON.stringify([before.map((b) => b.railH), after.map((b) => b.railH)]));
    await c.close();
  });
}

/* ================================================================================================================================ */
/* A : flèches sans kit                                                                                                               */
/* ================================================================================================================================ */
if (run("A")) await section("A flèches sans kit", async () => {
  const p = await publicPage();
  await p.locator(".strip-rail").nth(1).scrollIntoViewIfNeeded();
  await hoverRail(p, 1);
  const m = await p.evaluate(probe);
  ok("A1 flèches du thème : au moins 32 × 32 px (et 40 px au doigt : taille du thème 44 px)", m.every((b) => b.prev.w >= 32 && b.prev.h >= 32 && b.next.w >= 40 && b.next.h >= 40), JSON.stringify(m.map((b) => [b.prev.w, b.prev.h])));
  // Plusieurs clics de suite au MÊME point de l'écran (un seul calcul de position) : chaque clic avance d'une image.
  const rail = p.locator(".strip-rail").nth(1);
  const nextBox = await p.locator(".strip-viewport").nth(1).locator(".strip-nav-next").boundingBox();
  const x = nextBox.x + nextBox.width / 2;
  const y = nextBox.y + nextBox.height / 2;
  const scrolls = [];
  for (let i = 0; i < 4; i++) {
    await p.mouse.move(x - 5, y - 5);
    await p.mouse.move(x, y, { steps: 3 });
    const hit = await p.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest(".strip-nav")?.className ?? "", [x, y]);
    await p.mouse.down();
    await p.mouse.up();
    await sleep(1000);
    scrolls.push([hit.includes("strip-nav-next"), await rail.evaluate((r) => Math.round(r.scrollLeft))]);
  }
  ok("A2 quatre clics au même point : la flèche est toujours sous la souris et chaque clic fait avancer la bande", scrolls.every((s, i) => s[0] && (i === 0 ? s[1] > 0 : s[1] > scrolls[i - 1][1])), JSON.stringify(scrolls));
  await shot(p, "A-public-apres-clics");
  await p.context().close();

  // Éditeur : une légende qui grandit ne déplace pas les flèches (centrées sur la hauteur des images).
  const fr = await editorCanvas("Grand écran");
  await fr.locator(".strip-rail").first().scrollIntoViewIfNeeded();
  const before = (await fr.evaluate(probe))[0];
  await fr.evaluate((text) => {
    const cap = document.querySelector(".strip-rail .media-caption [data-cap]");
    if (cap) cap.textContent = text;
  }, LONG.repeat(2));
  await sleep(500);
  const grown = (await fr.evaluate(probe))[0];
  ok("A3 éditeur : la légende grandit, le rail s'agrandit à la place de la plus haute, les flèches restent au même endroit (écart 0 px)", grown.railH >= before.railH && grown.prev.cy === before.prev.cy && grown.next.cy === before.next.cy, JSON.stringify([before.railH, grown.railH, before.prev.cy, grown.prev.cy]));
});

/* ================================================================================================================================ */
/* P : parité au pixel des autres blocs                                                                                               */
/* ================================================================================================================================ */
const PARITY_WRITE = process.env.BATT_PARITY_WRITE || process.env.PARITY_WRITE;
const PARITY_READ = process.env.BATT_PARITY_READ || process.env.PARITY_READ;
if (run("P") && (PARITY_WRITE || PARITY_READ)) {
  const dir = PARITY_WRITE ?? PARITY_READ;
  mkdirSync(dir, { recursive: true });
  for (const w of [1440, 390]) {
    const p = await publicPage({ viewport: { width: w, height: 900 } });
    // Sans le kit : texte et image seule, AU-DESSUS du carrousel (rien ne peut les déplacer : parité stricte) et en dessous (suivent la hauteur du bandeau).
    const targets = [
      { loc: p.locator("main p", { hasText: "Texte au-dessus" }).first(), above: true, name: "texte" },
      { loc: p.locator(".block-image img").first(), above: true, name: "image" },
      { loc: p.locator("main p", { hasText: "Texte de fin" }).first(), above: false, name: "texte" },
      { loc: p.locator(".block-image img").last(), above: false, name: "image" },
    ];
    let n = 0;
    for (const { loc, above, name } of targets) {
      if (!(await loc.count())) continue;
      await loc.scrollIntoViewIfNeeded();
      await sleep(300);
      const buf = await loc.screenshot().catch(() => null);
      if (!buf) continue;
      const file = path.join(dir, `parite-${w}-${n++}.png`);
      if (PARITY_WRITE) writeFileSync(file, buf);
      else {
        const ref = await sharp(readFileSync(file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const cur = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const sameSize = ref.info.width === cur.info.width && ref.info.height === cur.info.height;
        let diff = 0;
        let worst = 0;
        if (sameSize)
          for (let i = 0; i < ref.data.length; i += 4) {
            const d = Math.max(Math.abs(ref.data[i] - cur.data[i]), Math.abs(ref.data[i + 1] - cur.data[i + 1]), Math.abs(ref.data[i + 2] - cur.data[i + 2]));
            if (d) diff++;
            worst = Math.max(worst, d);
          }
        if (!sameSize || diff) writeFileSync(path.join(SHOTS, `parite-${w}-${n - 1}-actuel.png`), buf);
        ok(`P ${w} px bloc ${n} (${name} ${above ? "au-dessus" : "sous"} les bandeaux) : identique au pixel à la base`, sameSize && diff === 0, `${ref.info.width}×${ref.info.height} contre ${cur.info.width}×${cur.info.height}, ${diff} pixel(s) différent(s), écart max ${worst}`);
      }
    }
    ok(`P ${w} px : ${n} blocs hors bandeau mesurés`, n === 4);
    await p.context().close();
  }
}

/* ================================================================================================================================ */
/* K : kit synthétique                                                                                                                */
/* ================================================================================================================================ */
/** Pixels RGBA d'un SVG, rogné à son contenu (calque rogné comme Photoshop) ou posé dans sa case. */
async function rgba(svg, fit) {
  const { data, info } = await sharp(Buffer.from(svg), { density: 72 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, fit };
}
async function cropAlpha(svg) {
  const img = await rgba(svg);
  let [t, b, l, r] = [img.h, -1, img.w, -1];
  for (let y = 0; y < img.h; y++) for (let x = 0; x < img.w; x++) if (img.data[(y * img.w + x) * 4 + 3]) [t, b, l, r] = [Math.min(t, y), Math.max(b, y), Math.min(l, x), Math.max(r, x)];
  return sharp(img.data, { raw: { width: img.w, height: img.h, channels: 4 } }).extract({ left: l, top: t, width: r - l + 1, height: b - t + 1 });
}
const meanDiff = (a, b, pick) => {
  let n = 0;
  let sum = 0;
  let worst = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (!pick(i)) continue;
    const d = (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3;
    sum += d;
    worst = Math.max(worst, d);
    n++;
  }
  return { n, mean: n ? sum / n : 999, worst };
};
const sat = (r, g, b) => {
  const max = Math.max(r, g, b);
  return max ? (max - Math.min(r, g, b)) / max : 0;
};

if (run("K")) await section("K kit", async () => {
  await installKitFrameTheme(page, BASE, undefined, "defil99");
  const kit = (() => {
    const active = JSON.parse(q1("select value from settings where key = 'activeThemeId'").value);
    return JSON.parse(q1("select data from themes where id = ?", active).data).assets?.kit ?? {};
  })();
  info("kit importé : trait", { w: kit.stroke?.w, h: kit.stroke?.h, svg: Boolean(kit.stroke?.svg), color: Boolean(kit.stroke?.color) });
  info("kit importé : flèches", { gauche: kit.icons?.arrowLeft && { w: kit.icons.arrowLeft.w, h: kit.icons.arrowLeft.h, color: Boolean(kit.icons.arrowLeft.color) }, droite: kit.icons?.arrowRight && { w: kit.icons.arrowRight.w, h: kit.icons.arrowRight.h, color: Boolean(kit.icons.arrowRight.color) } });
  ok("K0 l'import garde le dessin en couleurs d'origine du trait et des deux flèches (à côté du masque)", Boolean(kit.stroke?.color && kit.icons?.arrowLeft?.color && kit.icons?.arrowRight?.color));
  ok("K0b le masque teinté (soulignement, filets) est toujours là", Boolean(kit.stroke?.svg || kit.stroke?.avif));
  const html = await (await fetch(`${BASE}/fr/personnages`)).text();
  ok("K0c le site public pose les attributs de couleur (data-kit-stroke-color, data-kit-icon-arrow-*-color)", /data-kit-stroke-color/.test(html) && /data-kit-icon-arrow-left-color/.test(html) && /data-kit-icon-arrow-right-color/.test(html));

  // ---- B : barre de défilement --------------------------------------------------------------------------------------------
  const barRef = await cropAlpha(barSvg());
  const barMeta = await barRef.clone().raw().toBuffer({ resolveWithObject: true });
  const BW = barMeta.info.width;
  const BH = barMeta.info.height;
  /** La poignée attendue : trois tranches (bouts de la moitié de la hauteur à l'échelle, milieu étiré), même découpe que variants.css. */
  const expectedThumb = async (tw, th) => {
    const cap = th / 2;
    const capSrc = Math.round(BH / 2);
    const left = await sharp(barMeta.data, { raw: { width: BW, height: BH, channels: 4 } }).extract({ left: 0, top: 0, width: capSrc, height: BH }).resize(Math.round(cap), th, { fit: "fill" }).raw().toBuffer();
    const right = await sharp(barMeta.data, { raw: { width: BW, height: BH, channels: 4 } }).extract({ left: BW - capSrc, top: 0, width: capSrc, height: BH }).resize(Math.round(cap), th, { fit: "fill" }).raw().toBuffer();
    const mid = await sharp(barMeta.data, { raw: { width: BW, height: BH, channels: 4 } }).extract({ left: capSrc, top: 0, width: BW - 2 * capSrc, height: BH }).resize(tw - 2 * Math.round(cap), th, { fit: "fill" }).raw().toBuffer();
    const out = Buffer.alloc(tw * th * 4);
    const put = (buf, w, x0) => {
      for (let y = 0; y < th; y++) buf.copy(out, (y * tw + x0) * 4, y * w * 4, (y + 1) * w * 4);
    };
    put(left, Math.round(cap), 0);
    put(mid, tw - 2 * Math.round(cap), Math.round(cap));
    put(right, Math.round(cap), tw - Math.round(cap));
    return out;
  };
  for (const w of [1440, 390]) {
    const p = await publicPage({ viewport: { width: w, height: w === 390 ? 844 : 900 }, deviceScaleFactor: 1 });
    const bar = p.locator(".rail-bar").first();
    await bar.scrollIntoViewIfNeeded();
    await p.mouse.move(2, 2);
    await sleep(500);
    const style = await p.evaluate(() => {
      const thumb = document.querySelector(".rail-bar-thumb");
      const cs = getComputedStyle(thumb);
      const track = getComputedStyle(document.querySelector(".rail-bar-track"), "::before");
      return {
        thumb: { mask: cs.maskImage || cs.webkitMaskImage, bg: cs.backgroundImage, bgc: cs.backgroundColor, bis: cs.borderImageSource, filter: cs.filter, opacity: cs.opacity, h: cs.height },
        track: { mask: track.maskImage || track.webkitMaskImage, bg: track.backgroundImage, bis: track.borderImageSource, opacity: track.opacity },
        sc: getComputedStyle(document.querySelector(".strip-rail")).scrollbarColor,
      };
    });
    info(`B style de la barre ${w} px`, style);
    const noMask = (v) => !v || v === "none";
    ok(`B1 ${w} px : la poignée est le dessin du kit (image en couleurs), sans masque, sans fond uni, sans filtre`, /kit\//.test(style.thumb.bis) && noMask(style.thumb.mask) && noMask(style.thumb.bg) && /rgba\(0, 0, 0, 0\)|transparent/.test(style.thumb.bgc) && style.thumb.filter === "none" && style.thumb.opacity === "1", JSON.stringify(style.thumb));
    ok(`B2 ${w} px : la piste est le même dessin, éclairci par l'opacité seule (aucune couleur appliquée par-dessus)`, /kit\//.test(style.track.bis) && noMask(style.track.mask) && noMask(style.track.bg) && Number(style.track.opacity) < 1, JSON.stringify(style.track));
    // Pixels : la poignée au repos, comparée au calque du kit synthétique.
    const box = await p.locator(".rail-bar-thumb").first().boundingBox();
    const tw = Math.round(box.width);
    const th = Math.round(box.height);
    const clip = { x: Math.round(box.x), y: Math.round(box.y), width: tw, height: th };
    const png = await p.screenshot({ clip });
    await writeFileSync(path.join(SHOTS, `B-poignee-${w}-${ENGINE === chromium ? "chromium" : "firefox"}.png`), png);
    const got = await sharp(png).ensureAlpha().raw().toBuffer();
    const exp = await expectedThumb(tw, th);
    // Cœur du dessin : on évite les 2 px de bord (rééchantillonnage, position fractionnaire) et les coins arrondis transparents.
    const inner = (i) => {
      const px = (i / 4) % tw;
      const py = Math.floor(i / 4 / tw);
      return px >= 10 && px < tw - 10 && py >= 3 && py < th - 3 && exp[i + 3] > 250;
    };
    const d = meanDiff(got, exp, inner);
    ok(`B3 ${w} px : pixels de la poignée = calque du kit (écart moyen ${d.mean.toFixed(1)} / 255 sur ${d.n} pixels)`, d.n > 100 && d.mean <= 14, JSON.stringify(d));
    // Variations de couleurs et de saturation conservées : pas de teinte unique.
    const sats = [];
    const hues = [];
    for (let x = 10; x < tw - 10; x += Math.max(1, Math.floor((tw - 20) / 8))) {
      const i = ((Math.floor(th / 2)) * tw + x) * 4;
      sats.push(sat(got[i], got[i + 1], got[i + 2]));
      hues.push([got[i], got[i + 1], got[i + 2]]);
    }
    const hueSpread = Math.max(...hues.map((c) => Math.abs(c[0] - hues[0][0]) + Math.abs(c[1] - hues[0][1]) + Math.abs(c[2] - hues[0][2])));
    ok(`B4 ${w} px : les couleurs varient le long de la barre (dégradé conservé, écart ${Math.round(hueSpread)}) et ne sont pas grisées (saturation ≥ 0,35)`, hueSpread > 120 && Math.min(...sats) >= 0.35, JSON.stringify({ hueSpread, sats: sats.map((s) => +s.toFixed(2)) }));
    // Survol : seule l'épaisseur change, jamais la teinte.
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
    await sleep(500);
    const hov = await p.evaluate(() => {
      const cs = getComputedStyle(document.querySelector(".rail-bar-thumb"));
      return { bis: cs.borderImageSource, filter: cs.filter, h: cs.height, bg: cs.backgroundImage, mask: cs.maskImage || cs.webkitMaskImage };
    });
    ok(`B5 ${w} px : au survol la poignée s'épaissit (${style.thumb.h} → ${hov.h}) sans changer de dessin ni de teinte`, hov.bis === style.thumb.bis && hov.filter === "none" && noMask(hov.mask) && noMask(hov.bg) && parseFloat(hov.h) > parseFloat(style.thumb.h), JSON.stringify(hov));
    await shot(p, `B-barre-${w}-${ENGINE === chromium ? "chromium" : "firefox"}`);
    await p.context().close();
  }
  // Éditeur : même rendu.
  {
    const fr = await editorCanvas("Grand écran");
    const style = await fr.evaluate(() => {
      const cs = getComputedStyle(document.querySelector(".rail-bar-thumb"));
      return { bis: cs.borderImageSource, mask: cs.maskImage || cs.webkitMaskImage, bg: cs.backgroundImage };
    });
    ok("B6 éditeur : la barre est le dessin du kit (image en couleurs, sans masque)", /kit\//.test(style.bis) && (!style.mask || style.mask === "none") && (!style.bg || style.bg === "none"), JSON.stringify(style));
  }

  // ---- F : flèches ---------------------------------------------------------------------------------------------------------
  const arrowCase = async (which) => {
    const piece = await rgba(arrowSvg(which));
    const canvasRaw = await sharp({ create: { width: ARROW_BOX.case, height: ARROW_BOX.case, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: piece.data, raw: { width: piece.w, height: piece.h, channels: 4 }, left: ARROW_BOX.x, top: ARROW_BOX.y }])
      .raw()
      .toBuffer();
    return canvasRaw;
  };
  for (const w of [1440, 390]) {
    const p = await publicPage({ viewport: { width: w, height: w === 390 ? 844 : 900 }, deviceScaleFactor: 1 });
    // Au milieu du carrousel : les deux flèches sont actives et visibles (survol du cadre).
    await p.locator(".strip-rail").nth(1).scrollIntoViewIfNeeded();
    await scrollTo(p, 1, 0.4);
    await hoverRail(p, 1);
    const info1 = await p.evaluate(() => {
      const one = (sel) => {
        const el = document.querySelectorAll(".strip-viewport")[1].querySelector(sel);
        const cs = getComputedStyle(el);
        const b = el.getBoundingClientRect();
        return { w: +b.width.toFixed(2), h: +b.height.toFixed(2), border: cs.borderTopWidth, bgc: cs.backgroundColor, bgi: cs.backgroundImage, shadow: cs.boxShadow, radius: cs.borderTopLeftRadius, mask: cs.maskImage || cs.webkitMaskImage, filter: cs.filter, opacity: cs.opacity, glyph: getComputedStyle(el.querySelector("[data-icon]")).display };
      };
      return { prev: one(".strip-nav-prev"), next: one(".strip-nav-next") };
    });
    info(`F style des flèches ${w} px`, info1);
    const scale = w === 390 ? 1 : 1;
    const wantL = [Math.round(kit.icons.arrowLeft.w * 0.5 * scale), Math.round(kit.icons.arrowLeft.h * 0.5 * scale)];
    const wantR = [Math.round(kit.icons.arrowRight.w * 0.5 * scale), Math.round(kit.icons.arrowRight.h * 0.5 * scale)];
    const plain = (s) => s.border === "0px" && /rgba\(0, 0, 0, 0\)|transparent/.test(s.bgc) && s.shadow === "none" && s.radius === "0px" && (!s.mask || s.mask === "none") && s.filter === "none" && s.glyph === "none";
    ok(`F1 ${w} px : flèches sans carré (ni bordure, ni fond, ni ombre, ni arrondi, ni masque, ni filtre), le dessin du kit en image`, info1.prev.opacity === "1" && info1.next.opacity === "1" && plain(info1.prev) && plain(info1.next) && /kit\//.test(info1.prev.bgi) && /kit\//.test(info1.next.bgi), JSON.stringify(info1));
    ok(`F2 ${w} px : taille prévue par le kit, la moitié de sa case (${wantL.join(" × ")} px), bien plus grande que la flèche d'avant (18 px)`, Math.abs(info1.prev.w - wantL[0]) <= 1 && Math.abs(info1.prev.h - wantL[1]) <= 1 && Math.abs(info1.next.w - wantR[0]) <= 1 && Math.abs(info1.next.h - wantR[1]) <= 1 && info1.prev.w >= 40, JSON.stringify([info1.prev.w, info1.prev.h, info1.next.w, info1.next.h, wantL, wantR]));
    // Pixels : le carré (zones transparentes du dessin) montre le fond de la page ; le dessin a ses couleurs.
    for (const [which, sel] of [
      ["right", ".strip-nav-next"],
      ["left", ".strip-nav-prev"],
    ]) {
      const b = await p.locator(".strip-viewport").nth(1).locator(sel).boundingBox();
      const clip = { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
      const shown = await sharp(await p.screenshot({ clip })).ensureAlpha().raw().toBuffer();
      await p.addStyleTag({ content: ".strip-nav { visibility: hidden !important; }" });
      await sleep(150);
      const hidden = await sharp(await p.screenshot({ clip })).ensureAlpha().raw().toBuffer();
      await p.evaluate(() => [...document.querySelectorAll("style")].at(-1)?.remove());
      await sleep(250);
      const ref = await sharp(await arrowCase(which), { raw: { width: ARROW_BOX.case, height: ARROW_BOX.case, channels: 4 } }).resize(clip.width, clip.height, { fit: "fill" }).raw().toBuffer();
      // Hors du dessin (alpha nul dans la référence, avec 3 px de marge) : exactement le fond de la page, aucun carré, aucun voile.
      const outsideStrict = (i) => {
        const x = (i / 4) % clip.width;
        const y = Math.floor(i / 4 / clip.width);
        // Au moins 3 px de marge autour du dessin (le rééchantillonnage déborde d'un pixel).
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < clip.width && yy < clip.height && ref[(yy * clip.width + xx) * 4 + 3] > 0) return false;
        }
        return true;
      };
      const out = meanDiff(shown, hidden, (i) => outsideStrict(i));
      ok(`F3 ${w} px flèche ${which} : hors du dessin, le fond de la page apparaît tel quel (pas de carré : écart ${out.worst.toFixed(0)} sur ${out.n} pixels)`, out.n > 50 && out.worst <= 2, JSON.stringify(out));
      const inside = meanDiff(shown, ref, (i) => ref[i + 3] > 250);
      // Le dessin est posé sur le fond : on compare les pixels pleins (alpha 255) au calque.
      ok(`F4 ${w} px flèche ${which} : pixels du dessin = calque du kit (écart moyen ${inside.mean.toFixed(1)} / 255 sur ${inside.n} pixels)`, inside.n > 100 && inside.mean <= 22, JSON.stringify(inside));
      if (w === 1440) writeFileSync(path.join(SHOTS, `F-fleche-${which}-${ENGINE === chromium ? "chromium" : "firefox"}.png`), await p.screenshot({ clip }));
    }
    await shot(p, `F-fleches-${w}-${ENGINE === chromium ? "chromium" : "firefox"}`);
    await p.context().close();
  }
  // Immobiles avec le kit : même hauteur aux 5 positions, même point de clic d'une image à l'autre.
  {
    const p = await publicPage();
    await heights(p, "K public 1440 px avec le kit");
    await p.locator(".strip-rail").nth(1).scrollIntoViewIfNeeded();
    await hoverRail(p, 1);
    const nextBox = await p.locator(".strip-viewport").nth(1).locator(".strip-nav-next").boundingBox();
    const x = nextBox.x + nextBox.width / 2;
    const y = nextBox.y + nextBox.height / 2;
    const scrolls = [];
    for (let i = 0; i < 4; i++) {
      await p.mouse.move(x - 4, y - 4);
      await p.mouse.move(x, y, { steps: 3 });
      const hit = await p.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest(".strip-nav")?.className ?? "", [x, y]);
      await p.mouse.down();
      await p.mouse.up();
      await sleep(1000);
      scrolls.push([hit.includes("strip-nav-next"), await p.locator(".strip-rail").nth(1).evaluate((r) => Math.round(r.scrollLeft))]);
    }
    ok("F5 flèche du kit : quatre clics au même point, chaque clic fait avancer la bande (position identique d'une image à l'autre)", scrolls.every((s, i) => s[0] && (i === 0 ? s[1] > 0 : s[1] > scrolls[i - 1][1])), JSON.stringify(scrolls));
    await p.context().close();
  }
});

ok("aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
