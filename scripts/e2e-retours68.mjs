#!/usr/bin/env node
/**
 * Lot 68 « retours rapides » (chromium, serveur de DEV requis pour /api/theme-preview, base neuve, une connexion admin).
 *  V  Visionneuse = cadrage : ce que la visionneuse montre est ce que la page montre (recadrage libre, ancien cadrage,
 *     format imposé, case de grille, planche, Planche libre), en grand et net (variante recadrée haute définition).
 *  L  Logo plus grand sans agrandir la barre : la hauteur de la barre ne dépend pas de la taille du logo (390 / 1024 / 1440,
 *     logo texte et logo image, en-tête collant, menu téléphone, éditeur = public).
 *  T  Typographie : « Tous les titres » change TOUS les titres (titre de page, rubriques, projets, tuiles), en direct sur la toile et
 *     en ligne ; chaque texte du site appartient à UN rôle (aucun texte sans rôle) ; un même rôle a la même police partout ;
 *     inventaire des polices réellement appliquées (trois thèmes).
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=V,L,T] [SHOTS=dossier] node scripts/e2e-retours68.mjs
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { boardDraft, grid, img, login, makeMedia, openEditor, pageIdOf, q1, setBoardDraft, setDraft, settled, sleep, sql, waitFor } from "./lib/grille31d.mjs";

const BASE = process.env.BASE ?? "http://localhost:3830";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(tmpdir(), "e2e-retours68");
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);
const M = await makeMedia(page, BASE);
const pageId = pageIdOf("personnages");
const project = q1("select id, slug from projects order by id limit 1");

const T = (s) => ({ fr: s, en: s });
const cap = (n) => ({ captionTitle: T(`Titre ${n}`), caption: T(`Légende ${n}`), captionDate: T(`Date ${n}`) });
const rect = (x, y, w, h) => ({ mediaId: { x: 50, y: 50, zoom: 1, rect: { x, y, w, h } } });
const withCrop = (crop) => ({ look: { crop } });
const text = (uid, t) => ({ uid, type: "rich-text", props: { paragraphs: [T(t)] } });
const FREE = { x: 0.1, y: 0.15, w: 0.5, h: 0.4 };
const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});

/* Page de test : tout ce qui porte un texte ou une image recadrée. */
const PAGE = () => [
  { uid: "h1", type: "section-title", props: { main: true, eyebrow: T("Étiquette de page"), title: T("Titre de la page"), intro: T("Introduction de la page, un paragraphe."), counts: true } },
  text("t1", "Un texte courant avant les images."),
  { uid: "h2", type: "section-title", props: { eyebrow: T("Étiquette de rubrique"), title: T("Titre de rubrique"), intro: T("Présentation de la rubrique.") } },
  img("free", M.paysage, { ...cap("libre"), ...withCrop(rect(FREE.x, FREE.y, FREE.w, FREE.h)) }),
  img("pano", M.panorama, { ...cap("pano"), ...withCrop(rect(0.3, 0, 0.3, 1)) }),
  img("ratio", M.paysage, { ...cap("format"), ratio: "1:1" }),
  img("legacy", M.portrait, { ...cap("ancien"), ratio: "1:1", look: { crop: { mediaId: { x: 50, y: 20, zoom: 1.6 } } } }),
  grid("g", { layout: "2", ratio: "1:1" }, [img("c1", M.paysage, { ...cap("c1"), ...withCrop(rect(0.2, 0.2, 0.5, 0.6)) }), img("c2", M.portrait, cap("c2")), img("c3", M.carre, cap("c3")), img("c4", M.paysage2, cap("c4"))]),
  {
    uid: "fb",
    type: "free-board",
    props: { format: "3:2", phone: "scale", items: [{ id: "f1", media: M.paysage, x: 5, y: 8, w: 40, rot: 0, z: 0 }, { id: "f2", media: M.portrait, x: 52, y: 6, w: 30, rot: 0, z: 1 }] },
  },
  { uid: "pl", type: "page-link", props: { label: T("Voir la suite"), pageId: pageIdOf("decors") } },
  {
    uid: "cf",
    type: "contact",
    props: {
      form: true,
      formId: "ftest68",
      title: T("Écris-moi"),
      intro: T("Un mot pour commencer."),
      fields: [
        { id: "fname", type: "text", required: false, label: T("Ton nom") },
        { id: "femail", type: "email", required: true, label: T("Ton e-mail"), placeholder: T("nom@domaine.fr"), reply: true },
        { id: "fmessage", type: "textarea", required: true, label: T("Ton message") },
      ],
      submit: T("Envoyer"),
      success: T("Merci."),
      error: T("Erreur."),
      subject: T("Message"),
    },
  },
  { uid: "pbd", type: "project-board", props: { project: project.slug } },
];
const BOARD = () => [
  { uid: "bimg", type: "image", props: { mediaId: M.paysage, width: "wide", ...cap("planche"), ...withCrop(rect(0.5, 0.1, 0.4, 0.8)) } },
  { uid: "bg", type: "grid", props: { layout: "2", gap: "normal", align: "stretch", ratio: "auto", top: "gap", children: [img("bk1", M.paysage, { ...cap("p1"), ...withCrop(rect(0.1, 0.1, 0.6, 0.5)) }), img("bk2", M.carre, cap("p2"))] } },
];

async function publishAll() {
  setDraft(pageId, PAGE());
  setBoardDraft(project.id, pageId, BOARD());
  await openEditor(page, BASE, pageId);
  await settled(page);
  await page.getByRole("button", { name: "Publier", exact: true }).click();
  const done = await waitFor(() => sql((db) => db.prepare("select draft from pages where id = ?").get(pageId)).draft === null && boardDraft(project.id) === null, 120000);
  if (!done) console.log("INFO publication refusée : " + ((await page.locator("[role=alert], [role=status], .ve-status, .a-field-error, dialog[open]").allTextContents()).join(" | ").slice(0, 600)));
  await sleep(3000);
  return done;
}
async function publicPage(width = 1440, height = 900) {
  const c = await browser.newContext({ viewport: { width, height } });
  const p = await c.newPage();
  p.setDefaultTimeout(30000);
  p.on("pageerror", (e) => errors.push(`public : ${e.message}`));
  await p.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
  return p;
}

try {
  ok("P publication de la page de test", await publishAll());

  /* ======================================== V. Visionneuse = cadrage ======================================== */
  if (run("V")) {
    const p = await publicPage();
    const lb = p.locator(".lightbox");
    const items = p.locator("[data-viewer-item]");
    const n = await items.count();
    ok("V0 la page de test a ses images agrandissables", n >= 9, String(n));
    // Chaque image agrandissable : la visionneuse montre CE QUE LA PAGE MONTRE (même rapport largeur/hauteur que la photo vue), en grand et net.
    const checks = [];
    for (let i = 0; i < n; i++) {
      const it = items.nth(i);
      if (!(await it.locator("img").count())) continue;
      await it.scrollIntoViewIfNeeded();
      const id = JSON.parse((await it.getAttribute("data-viewer-item")) ?? "{}").id ?? `#${i}`;
      const onPage = await it.locator("img").first().evaluate((e) => {
        const r = e.getBoundingClientRect();
        return { ratio: r.width / r.height, w: r.width };
      });
      await it.click();
      await lb.waitFor();
      // La variante recadrée est préparée à la demande : on attend l'image nette (jusqu'à 60 s).
      const shown = await (async () => {
        const end = Date.now() + 60000;
        let last = null;
        while (Date.now() < end) {
          last = await lb.locator("img.lb-main, img.lightbox-image").last().evaluate((e) => {
            const r = e.getBoundingClientRect();
            return { ratio: r.width / r.height, w: r.width, nat: e.naturalWidth, natH: e.naturalHeight, src: e.currentSrc, done: e.complete && e.naturalWidth > 0, vis: e.closest("[data-loaded]") !== null || getComputedStyle(e).opacity === "1" };
          });
          if (last.done && last.vis) break;
          await sleep(400);
        }
        return last;
      })();
      checks.push({ id, onPage, shown });
      if (i === 0 || /free|c1|bk1/.test(id)) await shot(p, `V-${id.replace(/[^a-z0-9]+/gi, "-")}`);
      await p.keyboard.press("Escape");
      await lb.waitFor({ state: "detached" });
    }
    for (const c of checks) {
      const same = Math.abs(c.shown.ratio / c.onPage.ratio - 1) < 0.03;
      ok(`V1 ${c.id} : la visionneuse montre le cadrage de la page (rapport ${c.onPage.ratio.toFixed(3)} → ${c.shown.ratio.toFixed(3)})`, same, JSON.stringify(c));
    }
    // Ordre de la page : 0 libre, 1 panorama, 2 format imposé, 3 ancien cadrage, 4-7 grille, 8-9 Planche libre, puis la planche du projet.
    const free = checks[0];
    ok("V2 recadrage libre : la visionneuse est le rectangle choisi (rapport 1,875), pas l'original (1,5)", Boolean(free) && near(free.shown.ratio, 1.875, 0.06), JSON.stringify(free));
    ok("V3 recadrage libre : variante recadrée de la route signée, nette (au moins 90 % de la taille affichée ou de la zone, 750 px)", Boolean(free) && /\/media\/crop\//.test(free.shown.src) && free.shown.nat >= Math.min(free.shown.w, 750) * 0.9, JSON.stringify(free));
    const fmt = checks[2];
    ok("V4 format imposé 1:1 (paysage rogné par le cadre) : visionneuse carrée", Boolean(fmt) && near(fmt.shown.ratio, 1, 0.04), JSON.stringify(fmt));
    const fbs = checks.filter((c) => /^media-\d+-f\d/.test(c.id));
    ok("V5 Planche libre : ses 2 images s'ouvrent, telles qu'elles sont posées (originales)", fbs.length === 2 && fbs.every((c) => c.shown.done), JSON.stringify(checks.map((c) => c.id)));
    await p.context().close();
  }

  /* ======================================== L. Logo sans agrandir la barre ======================================== */
  if (run("L")) {
    const measure = async (p) =>
      p.evaluate(() => {
        const bar = document.querySelector(".site-header-bar").getBoundingClientRect();
        const brand = document.querySelector(".site-header .site-brand").getBoundingClientRect();
        const logo = document.querySelector(".site-header .site-logo-img, .site-header .site-signature");
        const l = logo && getComputedStyle(logo).display !== "none" ? logo.getBoundingClientRect() : brand;
        const main = document.querySelector("#contenu").getBoundingClientRect();
        const head = document.querySelector(".site-header").getBoundingClientRect();
        return { barH: bar.height, barBottom: bar.bottom + scrollY, logoH: l.height, logoBottom: l.bottom + scrollY, brandH: brand.height, mainTop: main.top + scrollY, headTop: head.top, headH: head.height, overflowX: document.documentElement.scrollWidth - innerWidth };
      });
    const WIDTHS = [390, 1024, 1440];
    const readAll = async () => {
      const out = {};
      for (const w of WIDTHS) {
        const p = await publicPage(w, 900);
        out[w] = await measure(p);
        await p.evaluate(() => scrollTo(0, 700));
        await sleep(900);
        out[w].scrolled = await measure(p);
        out[w].p = p;
      }
      return out;
    };
    const ref = await readAll();
    for (const w of WIDTHS) await ref[w].p.context().close();

    const siteDraftStyles = () => JSON.parse(q1("select value from settings where key = 'siteDraft'")?.value ?? "null")?.snap?.styles;
    const f = await openEditor(page, BASE, pageId);
    await sleep(1500);
    await page.getByRole("tab", { name: "Réglages" }).click();
    const canvasBar = () => f.evaluate(() => document.querySelector(".site-header-bar").getBoundingClientRect().height);
    const barBefore = await canvasBar();
    await page.locator("#lp-logo-size").fill("120");
    await sleep(1200);
    const brandH = await f.evaluate(() => document.querySelector(".site-header .site-brand").getBoundingClientRect().height);
    ok("L1 éditeur : le logo grandit (120 px)", near(brandH, 120, 2), String(brandH));
    ok("L2 éditeur : la barre garde sa hauteur (même hauteur qu'avant le réglage)", near(await canvasBar(), barBefore, 1), `${barBefore} → ${await canvasBar()}`);
    await shot(page, "L-editeur-120");
    await settled(page);
    await page.getByRole("button", { name: "Publier", exact: true }).click();
    await waitFor(async () => /En ligne/.test((await page.locator(".ve-status").textContent()) ?? ""), 120000);
    await sleep(2500);

    const check = async (tag, size) => {
      const cur = await readAll();
      for (const w of WIDTHS) {
        const a = ref[w];
        const b = cur[w];
        const wantLogo = w >= 768 ? size : Math.min(64, Math.max(24, size * 0.75));
        ok(`L3 ${tag} ${w} px : le logo est grand (${wantLogo} px)`, near(b.logoH, wantLogo, 2), JSON.stringify([b.logoH, b.brandH]));
        ok(`L4 ${tag} ${w} px : la barre garde sa hauteur d'origine (${a.barH.toFixed(0)} px)`, near(b.barH, a.barH, 1), `${a.barH} → ${b.barH}`);
        ok(`L5 ${tag} ${w} px : le contenu ne descend pas`, near(b.mainTop, a.mainTop, 1), `${a.mainTop} → ${b.mainTop}`);
        ok(`L6 ${tag} ${w} px : en-tête collant au défilement, barre inchangée, pas de débordement horizontal`, near(b.scrolled.headTop, 0, 1) && near(b.scrolled.barH, a.barH, 1) && b.overflowX <= 0, JSON.stringify(b.scrolled));
        ok(`L7 ${tag} ${w} px : le logo dépasse sous la barre sans la grandir (ou tient dedans)`, b.logoBottom >= b.barBottom - 1 || b.logoH <= b.barH, JSON.stringify([b.logoBottom, b.barBottom]));
      }
      await shot(cur[1440].p, `L-${tag}-1440`);
      await shot(cur[390].p, `L-${tag}-390`);
      // Menu téléphone : s'ouvre sous la barre, sans la déplacer.
      const ph = cur[390].p;
      await ph.evaluate(() => scrollTo(0, 0));
      await ph.getByRole("button", { name: /menu/i }).first().click();
      await sleep(500);
      const menu = await ph.evaluate(() => {
        const n = document.querySelector("#nav-mobile").getBoundingClientRect();
        const bar = document.querySelector(".site-header-bar").getBoundingClientRect();
        const logo = document.querySelector(".site-header .site-brand").getBoundingClientRect();
        const link = document.querySelector("#nav-mobile a").getBoundingClientRect();
        return { top: n.top, barBottom: bar.bottom, barH: bar.height, shown: !document.querySelector("#nav-mobile").hidden, logoBottom: logo.bottom, linkTop: link.top };
      });
      ok(`L8 ${tag} menu téléphone : ouvert sous la barre (barre inchangée), liens sous le logo`, menu.shown && menu.top >= menu.barBottom - 1 && near(menu.barH, ref[390].barH, 1) && menu.linkTop >= menu.logoBottom - 1, JSON.stringify(menu));
      await shot(ph, `L-${tag}-menu-390`);
      for (const w of WIDTHS) await cur[w].p.context().close();
    };
    await check("texte", 120);

    // Logo image : choisi dans la médiathèque par le panneau Logo, taille 160, publié par l'éditeur.
    const f2 = await openEditor(page, BASE, pageId);
    await sleep(1500);
    await page.getByRole("tab", { name: "Réglages" }).click();
    await page.getByTestId("logo-choose").click();
    await page.getByRole("button", { name: "Choisir 31d-carre.png" }).click();
    await page.locator("#lp-logo-size").fill("160");
    await sleep(1500);
    ok("L9 logo image : posé dans l'en-tête de l'éditeur", await f2.locator(".site-header .site-logo-img").count().then((c) => c > 0), JSON.stringify(siteDraftStyles()));
    ok("L10 logo image de 160 px : la barre de l'éditeur garde sa hauteur", near(await f2.evaluate(() => document.querySelector(".site-header-bar").getBoundingClientRect().height), barBefore, 1));
    await settled(page);
    await page.getByRole("button", { name: "Publier", exact: true }).click();
    await waitFor(async () => /En ligne/.test((await page.locator(".ve-status").textContent()) ?? ""), 120000);
    await sleep(2500);
    await check("image", 160);
  }

  /* ======================================== T. Typographie par rôle ======================================== */
  if (run("T")) {
    const src = readFileSync(new URL("../src/lib/look.ts", import.meta.url), "utf8");
    const block = (name) => src.match(new RegExp(`${name}[^=]*= \\{([\\s\\S]*?)\\n?\\};`))[1];
    const parseSel = (b) => Object.fromEntries([...b.matchAll(/(\w+): "(.*?)",?\s*$/gm)].map((m) => [m[1], m[2]]));
    const SEL = parseSel(block("export const ROLE_SELECTORS: Record<Role, string>"));
    const FONT_ONLY = (() => {
      try {
        return parseSel(block("export const ROLE_FONT_ONLY_SELECTORS"));
      } catch {
        return {};
      }
    })();
    const ROLES = ["body", "caption", "eyebrow", "h2", "h1", "menu", "brand"];
    const css = ROLES.flatMap((r) => [`:root:root:root ${SEL[r]}{--role-mark:${r}}`, ...(FONT_ONLY[r] ? [`:root:root:root ${FONT_ONLY[r]}{--role-mark:${r}}`] : [])]).join("\n");
    ok("T0 sélecteurs des rôles lus dans le code", ROLES.every((r) => SEL[r]), JSON.stringify(SEL));

    /* T1. « Tous les titres » dans l'éditeur : repro de « ça ne marche pas » */
    {
      const f = await openEditor(page, BASE, pageId);
      const titles = () => f.evaluate(() => [...document.querySelectorAll("#contenu h1, #contenu h2, #contenu h3")].map((e) => ({ tag: e.tagName, t: e.textContent.trim().slice(0, 24), ff: getComputedStyle(e).fontFamily })));
      const before = await titles();
      const target = f.locator("#contenu h2").first();
      await target.scrollIntoViewIfNeeded();
      await page.mouse.move(700, 8);
      await sleep(200);
      await target.hover();
      await f.locator(".lk-aa").waitFor({ timeout: 8000 });
      await f.locator(".lk-aa").click();
      await f.locator(".lk-bar").waitFor();
      const label = (await f.locator(".lk-bar .lk-seg").textContent()) ?? "";
      ok("T1a la barre propose « Tous les titres »", /Tous les titres/.test(label), label);
      await f.locator(".lk-bar [role=radio]", { hasText: /^Tous les/ }).click();
      await f.locator(".lk-bar .tc-font").click();
      await f.locator('.fm-item[data-font="embed:chelsea-market"]').first().click();
      await sleep(2500);
      const after = await titles();
      const changed = after.filter((a) => /helsea/i.test(a.ff));
      ok(`T1b « Tous les titres » → police choisie : TOUS les titres de la toile changent (${changed.length}/${after.length})`, after.length >= 3 && changed.length === after.length, JSON.stringify(after.filter((a) => !/helsea/i.test(a.ff))));
      ok("T1c les textes qui ne sont pas des titres ne changent pas", await f.evaluate(() => [...document.querySelectorAll("#contenu p:not(.eyebrow, .caption-text)")].every((e) => !/helsea/i.test(getComputedStyle(e).fontFamily))));
      await shot(page, "T1-toile-tous-les-titres");
      ok("T1d (avant) les titres avaient la police du thème", before.every((b) => !/helsea/i.test(b.ff)));
      await settled(page);
      await page.getByRole("button", { name: "Publier", exact: true }).click();
      await waitFor(async () => /En ligne/.test((await page.locator(".ve-status").textContent()) ?? ""), 120000);
      await sleep(2500);
      for (const u of ["/fr/personnages", "/fr", "/fr/decors", "/fr/a-propos"]) {
        const pp = await publicPage();
        await pp.goto(BASE + u, { waitUntil: "networkidle" });
        const all = await pp.evaluate(() => [...document.querySelectorAll("#contenu h1, #contenu h2, #contenu h3")].map((e) => getComputedStyle(e).fontFamily));
        ok(`T1e en ligne ${u} : ${all.length} titres, tous dans la police choisie`, all.length > 0 && all.every((ff) => /helsea/i.test(ff)), JSON.stringify([...new Set(all)]));
        await pp.context().close();
      }
      // Retour au thème (le reste des mesures part des polices du thème).
      sql((db) => {
        db.prepare("delete from settings where key = 'styles'").run();
        const row = db.prepare("select value from settings where key = 'siteDraft'").get();
        if (row) {
          const v = JSON.parse(row.value);
          if (v?.snap?.styles?.roles) delete v.snap.styles.roles;
          db.prepare("update settings set value = ? where key = 'siteDraft'").run(JSON.stringify(v));
        }
      });
    }

    /* T2/T3. Chaque texte a UN rôle ; un rôle = une police (3 thèmes, 5 pages + la page de test) */
    const THEMES = ["studio", "fanzine-riso", "carnet-d-atelier"];
    const PAGES = ["/fr", "/fr/personnages", "/fr/decors", "/fr/animation", "/fr/a-propos"];
    const probe = ([rolesCss]) => {
      const style = document.createElement("style");
      style.textContent = rolesCss;
      document.head.appendChild(style);
      const out = [];
      const seen = new Set();
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) {
        const txt = w.currentNode.textContent.trim();
        const el = w.currentNode.parentElement;
        if (!txt || seen.has(el) || el.closest("script,style,noscript,.preview-banner,.sr-only,[aria-hidden='true']")) continue;
        seen.add(el);
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (cs.display === "none" || cs.visibility === "hidden" || !r.width || !r.height) continue;
        // Flèches et signes seuls : pictogrammes, pas du texte.
        if (!/[\p{L}\p{N}]/u.test(txt)) continue;
        const anc = [];
        for (let e = el, i = 0; e && i < 3; e = e.parentElement, i++) anc.push(e.tagName.toLowerCase() + (typeof e.className === "string" && e.className ? "." + e.className.trim().split(/\s+/).slice(0, 3).join(".") : ""));
        out.push({ path: anc.join(" < "), text: txt.slice(0, 24), role: cs.getPropertyValue("--role-mark").trim(), ff: cs.fontFamily.split(",")[0].replace(/"/g, ""), fs: cs.fontSize, fw: cs.fontWeight, tag: el.tagName.toLowerCase() });
      }
      return out;
    };
    const gaps = new Map();
    const fams = new Map();
    const inventory = [];
    for (const theme of THEMES) {
      const pp = await publicPage();
      await pp.goto(`${BASE}/api/theme-preview?id=${theme}&redirect=/fr`, { waitUntil: "networkidle" });
      for (const u of PAGES) {
        await pp.goto(BASE + u, { waitUntil: "networkidle" });
        for (const r of await pp.evaluate(probe, [css])) {
          if (!r.role) {
            const k = `${theme}|${r.path}`;
            gaps.set(k, (gaps.get(k) ?? 0) + 1);
          } else {
            const k = `${theme}|${r.role}`;
            const set = fams.get(k) ?? new Map();
            set.set(r.ff, `${set.get(r.ff) ?? ""}${set.has(r.ff) ? "" : r.path + " :: " + r.text}`);
            fams.set(k, set);
          }
          inventory.push([theme, u, r.role || "(aucun)", r.ff, r.fs, r.fw, r.path.split(" < ")[0], r.text].join("\t"));
        }
      }
      await pp.context().close();
    }
    writeFileSync(path.join(SHOTS, "typo-inventaire.tsv"), inventory.join("\n"));
    ok(`T2 chaque texte du site appartient à un rôle (textes sans rôle : ${gaps.size})`, gaps.size === 0, [...gaps.keys()].slice(0, 12).join(" || "));
    for (const theme of THEMES) {
      for (const r of ROLES) {
        const set = fams.get(`${theme}|${r}`);
        if (!set) continue;
        ok(`T3 ${theme} : rôle « ${r} » = une seule police partout`, set.size === 1, JSON.stringify([...set]));
      }
    }
  }

  ok("aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  failures++;
  console.log(`FAIL exception — ${e?.stack ?? e}`);
}
await browser.close();
console.log(`\n=== retours68 : ${failures === 0 ? "PASS" : `FAIL (${failures})`}`);
process.exit(failures ? 1 : 0);
