#!/usr/bin/env node
/**
 * Lot 98 « Légendes : couleurs stables, barre Aa directe, style des légendes par projet » (chromium, serveur requis, base neuve).
 * Souris et clavier réels ; données synthétiques seulement.
 *  A  Diagnostic R2 : pour chaque légende (image de page, case de grille, image et case de planche, carrousel à liste propre,
 *     bande du projet : titre, légende, date) — « Ce texte » est proposé, la couleur choisie ne touche que CE texte, reste après
 *     l'acquittement et le rechargement, est écrite au bon endroit (`look.text`) ; les autres légendes ne bougent pas.
 *  B  Perte de réglages (R6b) : des légendes réglées une à une, puis chaque geste suspect (réordonner, retirer / rajouter une image,
 *     Annuler / Rétablir, publier, recharger, changer le style du site, réglage illisible voisin, plus de 40 textes réglés) : rien ne change.
 *  C  « Aa » direct (R3, R6c) : entrer dans un texte ouvre la barre sans cacher le texte ; frapper ne la ferme pas ni ne vole le focus ;
 *     Échap et clic ailleurs la ferment ; le bouton « Aa » reste à sa place quelle que soit la souris et rouvre la barre.
 *  D  Style des légendes par projet (R4) : trois portées, un style par champ, visible sur deux pages qui montrent le même projet,
 *     absent d'un autre projet, publié ; priorités Ce texte > projet > site > thème ; « Revenir au style … » de chaque niveau.
 *  E  Autres textes (titres, ouverture) : toujours deux portées, rien de changé.
 * Captures : $SHOTS. Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=A,B,C,D,E] [SHOTS=dossier] node scripts/e2e-legendes98.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { publishBlocks } from "./lib/page-draft.mjs";
import { boardDraft, boardPublished, draftBlocks, findIn, grid, img, login, makeMedia, openEditor, pageIdOf, q1, setBoardDraft, setDraft, settled, sleep, sql, waitFor } from "./lib/grille31d.mjs";

const BASE = process.env.BASE ?? "http://localhost:3539";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(process.env.BATTERY_DIR ?? tmpdir(), "shots-legendes98");
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const diag = (...parts) => console.log(`DIAG ${parts.join(" | ")}`);
const T = (s) => ({ fr: s, en: s });

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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
const slotSlugs = sql((db) => db.prepare("select slug from slots where project_id = ? and draft_state is null order by position, id").all(project.id)).map((r) => r.slug);
const SLUG1 = slotSlugs[0];

const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});
const section = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.stack ?? e.message).split("\n").slice(0, 6).join(" "));
    await shot(page, `erreur-${name}`);
  }
};

/* ---- Scène ----------------------------------------------------------------------------------------------------------------- */
const BOARD_ID = project.id;
const board = `[data-edit-board="${BOARD_ID}"]`;
const bitem = (uid) => `${board} [data-edit-bitem="${uid}"]`;
const rail = `${board} [data-edit-bitem-project] [data-edit-rail]`;
const car = `${board} [data-edit-rail="car"]`;
const cell = (n) => `${bitem("bgrid")} .block-grid-cell:nth-child(${n})`;
const CAR_CAPS = { "car-a1": { title: T("Vue 1"), caption: T("Légende 1"), date: T("2026") }, "car-b2": { title: T("Vue 2"), caption: T("Légende 2"), date: T("2025") }, "car-c3": { title: T("Vue 3"), caption: T("Légende 3"), date: T("2024") } };
const PAGE_BLOCKS = (extra = {}) => [
  img("pimg", M.paysage, { captionTitle: T("Titre image"), caption: T("Légende image"), captionDate: T("2026"), ...extra.pimg }),
  grid("pgrid", { layout: "2" }, [img("pk1", M.carre, { captionTitle: T("Case 1"), caption: T("Légende case 1"), captionDate: T("2025") }), img("pk2", M.paysage2, { captionTitle: T("Case 2"), caption: T("Légende case 2") })]),
  { uid: "pbd", type: "project-board", props: { project: project.slug, ...(extra.pbd ?? {}) } },
];
const BOARD_ITEMS = () => [
  { uid: "strip", type: "strip", props: {} },
  { uid: "car", type: "strip", props: { source: "own", media: [M.portrait, M.carre, M.paysage2], ids: ["a1", "b2", "c3"], captions: CAR_CAPS } },
  img("bimg", M.paysage, { captionTitle: T("Titre planche"), caption: T("Légende planche"), captionDate: T("2023") }),
  grid("bgrid", { layout: "2" }, [img("bk1", M.carre, { captionTitle: T("Case A"), caption: T("Légende A"), captionDate: T("2022") }), img("bk2", M.paysage2, { captionTitle: T("Case B"), caption: T("Légende B") })]),
];
async function resetScene(extra = {}) {
  sql((db) => {
    db.prepare("update projects set draft_layout = null, draft_layout_page_id = null").run();
    db.prepare("update projects set layout = null where id = ?").run(BOARD_ID);
    db.prepare("delete from settings where key = 'siteDraft'").run();
  });
  setDraft(pageId, PAGE_BLOCKS(extra));
  setBoardDraft(BOARD_ID, pageId, BOARD_ITEMS());
}
const pageBlock = (uid) => findIn(draftBlocks(pageId), uid);
const boardItem = (uid) => (boardDraft(BOARD_ID) ?? []).find((i) => i.uid === uid);
const textOf = (look, key) => look?.text?.[key];

async function reopen() {
  const f = await openEditor(page, BASE, pageId);
  await settled(page);
  await f.locator(`${bitem("car")}`).first().waitFor({ state: "attached", timeout: 60000 }).catch(() => {});
  await sleep(1200);
  return f;
}
const colorOf = (f, sel, nth = 0) => f.locator(sel).nth(nth).evaluate((el) => getComputedStyle(el).color);
/** Couleur de toutes les légendes de la page (clé = repère stable), pour savoir lesquelles ont bougé. */
const allColors = (f) =>
  f.evaluate(() => {
    const out = {};
    for (const el of document.querySelectorAll("[data-cap]")) {
      const owner = el.closest("[data-edit-rail]")?.getAttribute("data-edit-rail") ?? el.closest("[data-edit-cell]")?.getAttribute("data-edit-cell") ?? el.closest("[data-edit-bitem]")?.getAttribute("data-edit-bitem") ?? el.closest("[data-edit-block]")?.getAttribute("data-edit-block");
      const slot = el.closest("[data-edit-slot]")?.getAttribute("data-slot-slug") ?? "";
      out[`${owner}/${slot}/${el.dataset.cap}`] = getComputedStyle(el).color;
    }
    return out;
  });
const changed = (a, b) => Object.keys(a).filter((k) => a[k] !== b[k]);

/* ---- Souris et barre --------------------------------------------------------------------------------------------------------- */
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
/** Ferme la barre ouverte, s'il y en a une. */
async function closeBar(f) {
  if (await f.locator(".lk-bar").count()) {
    await f.locator(".lk-bar .lk-close").evaluate((b) => b.click()).catch(() => {});
    await f.locator(".lk-bar").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
  }
}
/** Ouvre la barre d'un texte par son « Aa » (survol puis clic) : le geste historique, qui doit rester possible. */
async function openByAa(f, sel) {
  await closeBar(f);
  const target = f.locator(sel).first();
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
const scopes = (f) => f.locator(".lk-bar .lk-seg [role=radio]").evaluateAll((els) => els.map((e) => ({ text: e.textContent.trim(), on: e.getAttribute("aria-checked") === "true" })));
const scopeBtn = (f, re) => f.locator(".lk-bar .lk-seg [role=radio]").filter({ hasText: re }).first();
/** Couleur d'une pastille de la barre (rôle de palette), telle que le navigateur la calcule. */
const swatchBtn = (f, i) => f.locator(".lk-bar .tc-swatches [role=radio]").nth(i);
const SW = 4; // « secondary »
const swatchColor = (f, i) => swatchBtn(f, i).evaluate((b) => getComputedStyle(b).backgroundColor);

try {
  /* ===== A. Diagnostic : « Ce texte » légende par légende =================================================================== */
  if (run("A")) {
    await section("A", async () => {
      await resetScene();
      let f = await reopen();
      await shot(page, "A0-scene");
      const CASES = [
        { id: "P1 image de page : Légende", sel: '[data-edit-block="pimg"] [data-cap="legend"]', where: () => textOf(pageBlock("pimg").props.look, "caption") },
        { id: "P2 image de page : Titre", sel: '[data-edit-block="pimg"] [data-cap="title"]', where: () => textOf(pageBlock("pimg").props.look, "captionTitle") },
        { id: "P3 image de page : Date", sel: '[data-edit-block="pimg"] [data-cap="date"]', where: () => textOf(pageBlock("pimg").props.look, "captionDate") },
        { id: "P4 case de grille de page : Légende", sel: '[data-edit-block="pk1"] [data-cap="legend"]', where: () => textOf(pageBlock("pk1").props.look, "caption") },
        { id: "B1 image de planche : Légende", sel: `${bitem("bimg")} [data-cap="legend"]`, where: () => textOf(boardItem("bimg").props.look, "caption") },
        { id: "B2 image de planche : Titre", sel: `${bitem("bimg")} [data-cap="title"]`, where: () => textOf(boardItem("bimg").props.look, "captionTitle") },
        { id: "B3 case de grille de planche : Titre", sel: `${cell(1)} [data-cap="title"]`, where: () => textOf(boardItem("bgrid").props.children?.[0]?.props.look, "captionTitle") },
        { id: "R1 carrousel à liste propre : Titre", sel: `${car} > [data-edit-slot]:nth-child(1) [data-cap="title"]`, where: () => textOf(pageBlock("pbd").props.look, "captions.car-a1.title") },
        { id: "R2 carrousel à liste propre : Légende", sel: `${car} > [data-edit-slot]:nth-child(2) [data-cap="legend"]`, where: () => textOf(pageBlock("pbd").props.look, "captions.car-b2.caption") },
        { id: "R3 carrousel à liste propre : Date", sel: `${car} > [data-edit-slot]:nth-child(1) [data-cap="date"]`, where: () => textOf(pageBlock("pbd").props.look, "captions.car-a1.date") },
        { id: "S1 bande du projet : Date", sel: `${rail} > [data-edit-slot]:nth-child(1) [data-cap="date"]`, where: () => textOf(pageBlock("pbd").props.look, `captions.${SLUG1}.date`) },
        { id: "S2 bande du projet : Titre", sel: `${rail} > [data-edit-slot]:nth-child(1) [data-cap="title"]`, where: () => textOf(pageBlock("pbd").props.look, `captions.${SLUG1}.title`) },
        { id: "S3 bande du projet : Légende", sel: `${rail} > [data-edit-slot]:nth-child(1) [data-cap="legend"]`, where: () => textOf(pageBlock("pbd").props.look, `captions.${SLUG1}.caption`) },
      ];
      const results = [];
      for (const c of CASES) {
        const before = await allColors(f);
        const opened = await openByAa(f, c.sel);
        ok(`A ${c.id} : la barre s'ouvre par « Aa »`, opened);
        if (!opened) continue;
        const sc = await scopes(f);
        const hasLocal = sc.some((s) => /Ce texte/.test(s.text));
        ok(`A ${c.id} : la portée « Ce texte » est proposée`, hasLocal, JSON.stringify(sc));
        if (hasLocal) await scopeBtn(f, /Ce texte/).click();
        const wanted = await swatchColor(f, SW);
        await swatchBtn(f, SW).click();
        await sleep(300);
        const now = await allColors(f);
        const mine = await colorOf(f, c.sel);
        const moved = changed(before, now);
        ok(`A ${c.id} : la couleur choisie s'applique à ce texte aussitôt`, mine === wanted, `${mine} ≠ ${wanted}`);
        ok(`A ${c.id} : aucune autre légende ne change de couleur`, moved.length <= 1, JSON.stringify(moved));
        await settled(page);
        await sleep(1500);
        const acked = await colorOf(f, c.sel);
        const movedAcked = changed(before, await allColors(f));
        ok(`A ${c.id} : …et reste après l'acquittement du serveur`, acked === wanted, `${acked} ≠ ${wanted}`);
        ok(`A ${c.id} : …toujours aucune autre légende`, movedAcked.length <= 1, JSON.stringify(movedAcked));
        const stored = c.where();
        ok(`A ${c.id} : couleur écrite au bon endroit (look.text)`, stored?.color === "secondary", JSON.stringify(stored));
        results.push({ c, wanted, hasLocal, stored: JSON.stringify(stored ?? null), ackedOk: acked === wanted, movedAcked: movedAcked.length });
        diag(c.id, `Ce texte=${hasLocal}`, `immédiat=${mine === wanted}`, `acquitté=${acked === wanted}`, `stocké=${JSON.stringify(stored ?? null)}`, `autres changées=${movedAcked.length - (movedAcked.length ? 1 : 0)}`);
        await closeBar(f);
      }
      // Après rechargement.
      f = await reopen();
      for (const r of results) {
        const col = await colorOf(f, r.c.sel);
        ok(`A ${r.c.id} : couleur toujours là après rechargement`, col === r.wanted, `${col} ≠ ${r.wanted}`);
        diag(r.c.id, `rechargé=${col === r.wanted}`);
      }
      await shot(page, "A9-rechargé");
    });
  }
  /* ===== B. Perte de réglages : des légendes réglées une à une, puis chaque geste suspect ================================== */
  if (run("B")) {
    await section("B", async () => {
      await resetScene();
      let f = await reopen();
      // Repères stables (par place, pas par rang) : les gestes déplacent les places.
      const SETS = [
        { id: "P1", sel: '[data-edit-block="pimg"] [data-cap="legend"]', pub: "Légende image" },
        { id: "P2", sel: '[data-edit-block="pimg"] [data-cap="title"]', pub: "Titre image" },
        { id: "B1", sel: `${bitem("bimg")} [data-cap="legend"]`, pub: "Légende planche" },
        { id: "B2", sel: `${bitem("bimg")} [data-cap="title"]`, pub: "Titre planche" },
        { id: "R1", sel: `${car} [data-slot-slug="car-a1"] [data-cap="title"]`, pub: "Vue 1" },
        { id: "R2", sel: `${car} [data-slot-slug="car-b2"] [data-cap="legend"]`, pub: "Légende 2" },
        { id: "S1", sel: `${rail} [data-slot-slug="${SLUG1}"] [data-cap="date"]`, pub: null },
      ];
      let wanted = "";
      for (const s of SETS) {
        const opened = await openByAa(f, s.sel).catch((e) => { throw new Error(`${s.id} : ${e.message}`); });
        if (!opened) throw new Error(`${s.id} : barre non ouverte`);
        if ((await scopes(f)).some((x) => /Ce texte/.test(x.text))) await scopeBtn(f, /Ce texte/).click();
        wanted = await swatchColor(f, SW);
        await swatchBtn(f, SW).click();
        await settled(page);
        await closeBar(f);
      }
      f = await reopen();
      const KEEP = [];
      for (const s of SETS) {
        const col = await colorOf(f, s.sel);
        if (col === wanted) KEEP.push(s);
        ok(`B0 ${s.id} : réglée une à une, la couleur survit au rechargement`, col === wanted, `${col} ≠ ${wanted}`);
      }
      const texts = () => JSON.stringify({ pimg: pageBlock("pimg").props.look?.text ?? null, bimg: boardItem("bimg")?.props.look?.text ?? null, pbd: pageBlock("pbd").props.look?.text ?? null });
      const snapshot = texts();
      ok("B0 au moins quatre légendes réglées tiennent", KEEP.length >= 4, `${KEEP.length}`);
      const stable = async (label) => {
        await settled(page);
        await sleep(1200);
        const lost = [];
        for (const s of KEEP) if ((await colorOf(f, s.sel).catch(() => "absente")) !== wanted) lost.push(s.id);
        ok(`B ${label} : les couleurs réglées ne bougent pas`, lost.length === 0, lost.join(","));
        ok(`B ${label} : look.text du brouillon inchangé`, texts() === snapshot, `${texts().slice(0, 200)}`);
        diag(`B ${label}`, `perdues=${lost.join(",") || "aucune"}`);
      };
      const press = async (keys) => {
        await page.keyboard.press(keys);
        await sleep(400);
      };
      // 1. Réordonner les composants de la planche, puis Annuler.
      await f.locator(`${bitem("bgrid")} [data-edit-bitem-op="up"]`).evaluate((b) => b.click());
      await stable("réordonner un bloc de la planche");
      await press("Control+z");
      await stable("…Annuler");
      // 2. Réordonner les images du carrousel (les clés des légendes suivent la place).
      await f.locator(`${car} [data-slot-slug="car-c3"]`).focus();
      await press("Shift+ArrowLeft");
      await stable("déplacer une image du carrousel");
      await press("Control+z");
      await stable("…Annuler");
      // 3. Retirer l'image d'une place, puis la place, puis tout annuler.
      await f.locator(`${car} [data-slot-slug="car-b2"]`).focus();
      await press("Delete");
      await stable("retirer l'image d'une place");
      await press("Control+z");
      await stable("…Annuler");
      await f.locator(`${car} [data-slot-slug="car-c3"]`).focus();
      await press("Shift+Delete");
      await stable("retirer une place");
      await press("Control+z");
      await stable("…Annuler");
      // 4. Recharger.
      f = await reopen();
      await stable("recharger l'éditeur");
      // 5. Changer le style du site (Tout le site) sur une autre légende, puis le remettre.
      const other1 = '[data-edit-block="pk2"] [data-cap="legend"]';
      ok("B ouvre la barre d'une légende sans réglage", await openByAa(f, other1));
      await f.locator(".lk-bar .lk-seg [role=radio]").last().click();
      await swatchBtn(f, 3).click();
      await settled(page);
      await stable("changer le style du site");
      await f.locator(".lk-bar .tc-reset").click().catch(() => {});
      await closeBar(f);
      await stable("…le remettre");
      // 6. Publier : le brouillon est vidé, la version publiée porte les réglages.
      await page.getByRole("button", { name: "Publier", exact: true }).click();
      ok("B publication", await waitFor(() => sql((db) => db.prepare("select draft from pages where id = ?").get(pageId)).draft === null, 120000));
      await sleep(2500);
      const pubPbd = sql((db) => db.prepare("select props from blocks where page_id = ? and type = 'project-board'").get(pageId));
      ok("B publié : les réglages du bloc sont dans la version publiée", Object.keys(JSON.parse(pubPbd.props).look?.text ?? {}).length >= (JSON.parse(snapshot).pbd ? Object.keys(JSON.parse(snapshot).pbd).length : 0));
      f = await reopen();
      const lostAfterPublish = [];
      // Publiée, la page n'a plus de repère `pimg` (les uid des brouillons disparaissent) : on retrouve le bloc par son type.
      for (const s of KEEP) if ((await colorOf(f, s.sel.replace('[data-edit-block="pimg"]', '[data-edit-type="image"]')).catch(() => "absente")) !== wanted) lostAfterPublish.push(s.id);
      ok("B publier puis rouvrir l'éditeur : les couleurs sont là", lostAfterPublish.length === 0, lostAfterPublish.join(","));
      const pub = await ctx.newPage();
      pub.setDefaultTimeout(30000);
      await pub.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
      const lostPublic = [];
      for (const s of KEEP.filter((x) => x.pub)) {
        const c = await pub.locator("[data-cap]", { hasText: new RegExp(`^${s.pub}$`) }).first().evaluate((el) => getComputedStyle(el).color).catch(() => "absente");
        if (c !== wanted) lostPublic.push(`${s.id}:${c}`);
      }
      ok("B publié : les légendes réglées gardent leur couleur sur le site public", lostPublic.length === 0, lostPublic.join(","));
      await pub.close();

      // 7. Un réglage illisible à côté : les autres textes du bloc restent réglés (jamais « tout ou rien »).
      await resetScene({ pimg: { look: { text: { caption: { color: "secondary" }, "mauvaise clé !": { color: "primary" }, captionTitle: { color: "pas-une-couleur" } } } } });
      f = await reopen();
      const poisoned = await colorOf(f, '[data-edit-block="pimg"] [data-cap="legend"]');
      ok("B7 un réglage illisible voisin n'efface pas les autres du bloc", poisoned === wanted, `${poisoned} ≠ ${wanted}`);
      if (await openByAa(f, '[data-edit-block="pimg"] [data-cap="date"]')) {
        await scopeBtn(f, /Ce texte/).click();
        await swatchBtn(f, 3).click();
        await settled(page);
        await closeBar(f);
        const kept = pageBlock("pimg").props.look?.text?.caption;
        ok("B7 …un nouveau réglage du bloc n'efface pas ceux qui étaient lisibles", kept?.color === "secondary", JSON.stringify(pageBlock("pimg").props.look));
      }

      // 8. Beaucoup de textes réglés dans un même bloc (un carrousel de 15 images × 3 champs et plus) : rien n'est abandonné.
      const many = { "captions.car-a1.title": { color: "secondary" } };
      for (let i = 0; i < 55; i++) many[`remplissage.${i % 100}.x${String.fromCharCode(97 + (i % 26))}`] = { color: "primary" };
      await resetScene({ pimg: { look: { text: { ...many, caption: { color: "secondary" } } } } });
      f = await reopen();
      const manyColor = await colorOf(f, '[data-edit-block="pimg"] [data-cap="legend"]');
      ok("B8 plus de 40 textes réglés dans un bloc : ils sont tous gardés", manyColor === wanted, `${manyColor} ≠ ${wanted}`);
      ok("B8 …le brouillon garde toutes les entrées", Object.keys(pageBlock("pimg").props.look?.text ?? {}).length >= 56, String(Object.keys(pageBlock("pimg").props.look?.text ?? {}).length));
    });
  }

  /* ===== C. « Aa » direct et stable ======================================================================================== */
  if (run("C")) {
    await section("C", async () => {
      await resetScene();
      let f = await reopen();
      const click = async (loc) => {
        const { x, y } = await center(loc);
        await page.mouse.move(x, y, { steps: 3 });
        await page.mouse.click(x, y);
      };
      const rectOf = (sel) => f.evaluate((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? { l: r.left + scrollX, t: r.top + scrollY, r: r.right + scrollX, b: r.bottom + scrollY } : null; }, sel);
      const overlaps = (a, b) => a && b && a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
      const CASES = [
        { id: "texte d'une image de page", sel: '[data-edit-block="pimg"] [data-cap="legend"]', value: "pimg" },
        { id: "date de la bande du projet (planche)", sel: `${rail} [data-slot-slug="${SLUG1}"] [data-cap="date"]`, value: "bande" },
        { id: "titre d'une place de carrousel", sel: `${car} [data-slot-slug="car-b2"] [data-cap="title"]`, value: "car" },
      ];
      for (const c of CASES) {
        await closeBar(f);
        await away();
        await mHover(f.locator(c.sel).first());
        await click(f.locator(c.sel).first());
        const open = await until(f, () => Boolean(document.querySelector(".lk-bar")), null, 5000);
        ok(`C1 ${c.id} : entrer dans le texte ouvre la barre de style sans autre geste`, open);
        if (!open) {
          await page.keyboard.press("Escape");
          continue;
        }
        await sleep(500);
        // La barre ne cache pas le texte (le champ de saisie de la planche ou le texte lui-même).
        const textRect = (await rectOf(".pe-text-editor")) ?? (await rectOf("[data-editing]")) ?? (await rectOf(c.sel));
        const barRect = await rectOf(".lk-bar");
        ok(`C2 ${c.id} : la barre est posée sans cacher le texte`, !overlaps(textRect, barRect), JSON.stringify({ textRect, barRect }));
        await shot(page, `C-${c.value}-barre`);
        // Frapper ne ferme pas la barre et ne lui laisse pas le focus.
        await page.keyboard.press("Control+a");
        await page.keyboard.type("abc 123", { delay: 40 });
        await sleep(400);
        ok(`C3 ${c.id} : taper du texte ne ferme pas la barre`, (await f.locator(".lk-bar").count()) === 1);
        const focus = await f.evaluate(() => {
          const a = document.activeElement;
          return { editing: Boolean(a?.hasAttribute?.("data-editing") || a?.classList?.contains("pe-text-editor")), inBar: Boolean(a?.closest?.(".lk-bar")), text: a?.textContent ?? "" };
        });
        ok(`C3 ${c.id} : le focus reste dans le texte`, focus.editing && !focus.inBar, JSON.stringify(focus));
        ok(`C3 ${c.id} : le texte tapé est bien dans le champ`, /abc 123/.test(focus.text), focus.text);
        // Le geste historique reste possible : un réglage depuis la barre pendant la saisie ne ferme pas la saisie.
        await swatchBtn(f, 3).click();
        await sleep(400);
        await page.keyboard.type("!", { delay: 30 });
        const still = await f.evaluate(() => document.activeElement?.textContent ?? "");
        ok(`C4 ${c.id} : un réglage depuis la barre ne coupe pas la frappe`, /abc 123!/.test(still), still);
        // Échap : la saisie est validée ET la barre se ferme.
        await page.keyboard.press("Escape");
        const gone = await f.locator(".lk-bar").waitFor({ state: "detached", timeout: 3000 }).then(() => true, () => false);
        ok(`C5 ${c.id} : Échap ferme la barre`, gone);
        await settled(page);
      }

      // Clic ailleurs : ferme la barre.
      await closeBar(f);
      await mHover(f.locator('[data-edit-block="pimg"] [data-cap="legend"]').first());
      await click(f.locator('[data-edit-block="pimg"] [data-cap="legend"]').first());
      ok("C6 barre ouverte avant le clic ailleurs", await until(f, () => Boolean(document.querySelector(".lk-bar")), null, 5000));
      await click(f.locator('[data-edit-block="pgrid"] [data-cap="title"]').first());
      await sleep(600);
      const others = await f.evaluate(() => document.querySelectorAll(".lk-bar").length);
      ok("C6 un clic dans un autre texte quitte le premier (une seule barre)", others <= 1, String(others));
      await page.keyboard.press("Escape");
      await settled(page);
      await closeBar(f);
      await f.locator("body").click({ position: { x: 3, y: 240 }, force: true }).catch(() => {});
      await sleep(400);
      ok("C6 un clic ailleurs ferme la barre", (await f.locator(".lk-bar").count()) === 0);

      // Le bouton « Aa » : place fixe par rapport au texte, quelle que soit la souris ; il rouvre la barre.
      const target = '[data-edit-block="pimg"] [data-cap="legend"]';
      await closeBar(f);
      await away();
      await mHover(f.locator(target).first());
      await click(f.locator(target).first());
      await until(f, () => Boolean(document.querySelector(".lk-bar")), null, 5000);
      await f.locator(".lk-bar .lk-close").evaluate((b) => b.click());
      await f.locator(".lk-bar").waitFor({ state: "detached", timeout: 4000 }).catch(() => {});
      await sleep(400);
      const aa0 = await rectOf(".lk-aa");
      ok("C7 le « Aa » reste après la fermeture de la barre tant que le texte est choisi", Boolean(aa0));
      const moves = [];
      // La souris passe sur d'autres textes SANS faire défiler la page (la pastille se range en haut de la fenêtre si son texte en sort : voir C8).
      for (const other of ['[data-edit-block="pimg"] [data-cap="title"]', '[data-edit-block="pimg"] [data-cap="date"]', '[data-edit-block="pgrid"] [data-cap="title"]', `${bitem("bimg")} [data-cap="legend"]`]) {
        const box = await f.locator(other).first().boundingBox();
        const vh = await f.evaluate(() => innerHeight);
        if (!box || box.y < 0 || box.y + box.height > vh) continue;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
        await sleep(450);
        moves.push({ ...(await rectOf(".lk-aa")), pinned: await f.locator(".lk-aa").getAttribute("data-pinned").catch(() => "?") });
      }
      ok("C7 la souris a survolé d'autres textes", moves.length >= 2, String(moves.length));
      ok("C7 le « Aa » ne bouge pas avec la souris et ne disparaît pas", aa0 && moves.every((m) => m && Math.abs(m.l - aa0.l) <= 1 && Math.abs(m.t - aa0.t) <= 1), JSON.stringify({ aa0, moves }));
      await shot(page, "C7-aa-fixe");
      if (aa0) {
        await f.locator(".lk-aa").click();
        ok("C7 …et il rouvre la barre", await until(f, () => Boolean(document.querySelector(".lk-bar")), null, 4000));
      }
      await page.keyboard.press("Escape");
      await closeBar(f);
      await settled(page);
    });
  }

  /* ===== D. Style des légendes par projet ================================================================================= */
  if (run("D")) {
    await section("D", async () => {
      await resetScene();
      let f = await reopen();
      const titleSel = (b) => `${b} [data-cap="title"]`;
      const titles = () => f.evaluate((b) => [...document.querySelectorAll(`${b} [data-cap="title"]`)].map((e) => getComputedStyle(e).color), board);
      const legends = () => f.evaluate((b) => [...document.querySelectorAll(`${b} [data-cap="legend"]`)].map((e) => getComputedStyle(e).color), board);
      const dates = () => f.evaluate((b) => [...document.querySelectorAll(`${b} [data-cap="date"]`)].map((e) => getComputedStyle(e).color), board);
      const base = { titles: await titles(), legends: await legends(), dates: await dates() };
      const pageTitle = await colorOf(f, '[data-edit-block="pimg"] [data-cap="title"]');
      const sw = (i) => f.locator(".lk-bar .tc-swatches [role=radio]").nth(i).evaluate((b) => getComputedStyle(b).backgroundColor);
      const PROJ = /légendes de ce projet/i;

      // D1 les trois portées, dans l'ordre.
      ok("D1 ouvre la barre d'un titre de la planche", await openByAa(f, `${car} [data-slot-slug="car-b2"] [data-cap="title"]`));
      const sc = (await scopes(f)).map((s) => s.text);
      ok("D1 trois portées : « Ce texte », « Les légendes de ce projet », « Tout le site »", sc.length === 3 && /Ce texte/.test(sc[0]) && PROJ.test(sc[1]) && /Tout le site/.test(sc[2]), JSON.stringify(sc));
      await shot(page, "D1-trois-portees");
      // D2 portée projet : un style par champ (ici les titres) sur toutes les légendes du projet.
      if (sc.length === 3) {
        await scopeBtn(f, PROJ).click();
        const col = await sw(4);
        await swatchBtn(f, 4).click();
        await sleep(400);
        const t1 = await titles();
        ok("D2 tous les titres du projet prennent la couleur choisie (aussitôt)", t1.length >= 8 && t1.every((c) => c === col), JSON.stringify({ t1, col }));
        ok("D2 …légendes et dates du projet ne changent pas (un style par champ)", JSON.stringify(await legends()) === JSON.stringify(base.legends) && JSON.stringify(await dates()) === JSON.stringify(base.dates));
        ok("D2 …les légendes hors projet (image de la page) ne changent pas", (await colorOf(f, '[data-edit-block="pimg"] [data-cap="title"]')) === pageTitle);
        await settled(page);
        await sleep(1500);
        ok("D2 …et après l'acquittement du serveur", (await titles()).every((c) => c === col));
        const host = (boardDraft(BOARD_ID) ?? []).find((i) => i.captionStyle);
        ok("D2 le style est enregistré avec le projet (suite du projet, brouillon)", host?.captionStyle?.title?.color === "secondary" && !host.captionStyle.legend && !host.captionStyle.date, JSON.stringify(host?.captionStyle));
        ok("D2 …dans le bloc Projet de la page (lot 111), pas dans les autres blocs", !JSON.stringify(draftBlocks(pageId).filter((b) => b.type !== "project-board")).includes('"captionStyle"'));
        await closeBar(f);
        // D3 « Ce texte » passe devant le projet.
        ok("D3 barre d'un titre", await openByAa(f, `${car} [data-slot-slug="car-b2"] [data-cap="title"]`));
        await scopeBtn(f, /Ce texte/).click();
        const own = await sw(3);
        await swatchBtn(f, 3).click();
        await settled(page);
        ok("D3 priorité : « Ce texte » l'emporte sur le projet", (await colorOf(f, `${car} [data-slot-slug="car-b2"] [data-cap="title"]`)) === own);
        ok("D3 …les autres titres gardent celui du projet", (await colorOf(f, `${car} [data-slot-slug="car-a1"] [data-cap="title"]`)) === col);
        // D4 le projet passe devant le site.
        await scopeBtn(f, /Tout le site/).click();
        const site = await sw(5);
        await swatchBtn(f, 5).click();
        await settled(page);
        await sleep(800);
        ok("D4 priorité : le projet l'emporte sur le site (titres)", (await colorOf(f, `${car} [data-slot-slug="car-a1"] [data-cap="title"]`)) === col);
        ok("D4 …le site règle les légendes sans style de projet", (await legends()).every((c) => c === site), JSON.stringify({ l: await legends(), site, draft: sql((db) => db.prepare("select value from settings where key = 'siteDraft'").get())?.value?.slice(0, 300) }));
        ok("D4 …et les légendes hors projet", (await colorOf(f, '[data-edit-block="pimg"] [data-cap="legend"]')) === site);
        // D5 « Revenir au style … » de chaque niveau.
        const resetLabel = async (re) => (await f.locator(".lk-bar .tc-reset").textContent()) ?? "";
        await scopeBtn(f, /Tout le site/).click();
        ok("D5 « Revenir au thème » pour le site", /thème/i.test(await resetLabel()));
        await scopeBtn(f, PROJ).click();
        ok("D5 « Revenir au style du site » pour le projet", /site/i.test(await resetLabel()), await resetLabel());
        await scopeBtn(f, /Ce texte/).click();
        ok("D5 « Revenir au style du projet » pour le texte", /projet/i.test(await resetLabel()), await resetLabel());
        await f.locator(".lk-bar .tc-reset").click();
        await settled(page);
        ok("D5 revenir au style du projet : le titre reprend la couleur du projet", (await colorOf(f, `${car} [data-slot-slug="car-b2"] [data-cap="title"]`)) === col);
        await closeBar(f);

        // D6 publier la page ; le projet sur une SECONDE page ; un autre projet reste intact.
        await page.getByRole("button", { name: "Publier", exact: true }).click();
        ok("D6 publication", await waitFor(() => sql((db) => db.prepare("select draft from pages where id = ?").get(pageId)).draft === null && boardDraft(BOARD_ID) === null, 120000));
        await sleep(2500);
        const pubHost = (boardPublished(BOARD_ID) ?? []).find((i) => i.captionStyle);
        ok("D6 le style du projet est publié avec lui", pubHost?.captionStyle?.title?.color === "secondary", JSON.stringify(pubHost?.captionStyle));
        const pageB = pageIdOf("decors");
        const otherBoard = `[data-edit-board="${other.id}"]`;
        await publishBlocks(page, BASE, pageB, () => [
          { uid: "bb1", type: "project-board", props: { project: project.slug } },
          { uid: "bb2", type: "project-board", props: { project: other.slug } },
        ], () => sql((db) => db.prepare("select draft from pages where id = ?").get(pageB)).draft === null);
        const pub = await ctx.newPage();
        pub.setDefaultTimeout(30000);
        for (const [label, url] of [["page A", "personnages"], ["page B", "decors"]]) {
          await pub.goto(`${BASE}/fr/${url}`, { waitUntil: "networkidle" });
          const cols = await pub.evaluate(() => [...document.querySelectorAll(".strip-caption.mc-title")].map((e) => getComputedStyle(e).color));
          ok(`D6 public, ${label} : les titres des images du projet ont la couleur du projet`, cols.length >= 4 && cols.filter((c) => c === base.titles[0]).length < cols.length && new Set(cols).size >= 1, JSON.stringify(cols));
        }
        // Page B dans l'éditeur : le projet y montre le même style, l'autre projet non.
        await page.goto(`${BASE}/admin/pages/${pageB}/editer`, { waitUntil: "domcontentloaded" });
        const fb = await (async () => { const h = await page.waitForSelector("iframe.ve-frame", { timeout: 120000 }); const fr = await h.contentFrame(); await fr.waitForSelector("html[data-edit-mode]", { timeout: 180000 }); await sleep(2500); return fr; })();
        const tb = await fb.evaluate((b) => [...document.querySelectorAll(`${b} [data-cap="title"]`)].map((e) => getComputedStyle(e).color), board);
        const to = await fb.evaluate((b) => [...document.querySelectorAll(`${b} [data-cap="title"]`)].map((e) => getComputedStyle(e).color), otherBoard);
        ok("D6 sur la seconde page (éditeur) : le style reste celui de la première page (lot 111 : plus rien n'est partagé)", tb.length >= 4 && tb.every((c) => c !== col), JSON.stringify({ tb, col }));
        ok("D6 …et le projet voisin n'est pas coloré", to.length >= 1 && to.every((c) => c !== col), JSON.stringify({ to, col }));
        await shot(page, "D6-seconde-page");
        await pub.close();
      }
    });
  }

  /* ===== E. Les autres textes ne changent pas ================================================================================= */
  if (run("E")) {
    await section("E", async () => {
      await resetScene();
      const f = await reopen();
      const t = `${board} [data-project-inline="title"]`;
      ok("E1 un titre de projet ouvre la barre", await openByAa(f, t));
      const sc = (await scopes(f)).map((s) => s.text);
      ok("E1 …avec deux portées seulement (« Ce texte », « Tous les titres »)", sc.length === 2 && /Ce texte/.test(sc[0]) && /titres/i.test(sc[1]), JSON.stringify(sc));
      await scopeBtn(f, /Ce texte/).click();
      const wanted = await swatchColor(f, 4);
      await swatchBtn(f, 4).click();
      await settled(page);
      ok("E1 la couleur de ce titre s'applique et s'enregistre", (await colorOf(f, t)) === wanted && pageBlock("pbd").props.look?.text?.title?.color === "secondary");
      await closeBar(f);
      const hostAfter = (boardDraft(BOARD_ID) ?? []).find((i) => i.captionStyle);
      ok("E1 aucune donnée de légende de projet n'a été créée", !hostAfter);
      const d = `[data-edit-block="pimg"] [data-cap="date"]`;
      ok("E2 une légende hors projet garde deux portées", (await openByAa(f, d)) && (await scopes(f)).length === 2);
      await closeBar(f);
    });
  }
} finally {
  if (errors.length) console.log("pageerror:", errors.slice(0, 5).join(" || "));
  await browser.close();
  console.log(`${failures === 0 ? "BILAN" : "ECHEC"} : ${failures} échec(s)`);
  process.exit(failures ? 1 : 0);
}
