#!/usr/bin/env node
/**
 * Lot 70 « sélection des textes, style du menu par page, polices récentes » (chromium, serveur de DEV, base neuve, une connexion admin).
 *  S  (R1) Textes empilés : chaque texte se sélectionne seul. Un clic sur la ligne 2 d'une légende (ou sur la date) ouvre la saisie
 *     de CETTE ligne, même quand la pastille « Aa » d'une autre ligne vient d'apparaître ; la pastille ne recouvre jamais un autre
 *     texte modifiable (toile : légende de planche sur deux lignes + date, titre / étiquette / introduction, page et planche).
 *  M  (R2) Le style « Tout le site » du menu (lot 124 : la barre propose aussi « Ce lien » et « Tout le menu ») marche sur toutes les pages : accueil, chaque page, page en brouillon, lien actif et inactif,
 *     et quand l'en-tête est déjà modifié depuis une autre page ; tous les liens du menu changent, et le réglage reste (autre page, en ligne).
 *  F  (R4) Polices récentes : choisir deux polices, les revoir dans « Récentes » (dernière choisie en tête, sans doublon, 6 au plus),
 *     après rechargement, côté serveur (réglage du site), partout où l'on choisit une police.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=S,M,F] [SHOTS=dossier] node scripts/e2e-textes70.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { boardDraft, img, login, makeMedia, openEditor, pageIdOf, q1, setBoardDraft, setDraft, settled, sleep, sql, waitFor } from "./lib/grille31d.mjs";

const BASE = process.env.BASE ?? "http://localhost:3860";
const ONLY = process.env.ONLY || process.env.BATT_TXT || "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(tmpdir(), "e2e-textes70");
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
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
const project = q1("select id, slug from projects order by id limit 1");
const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});
const section = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 8).join(" "));
    await shot(page, `erreur-${name}`);
  }
};

const CAPS = { captionTitle: T("Planche de design pour mon projet personnel « Balade »"), caption: T("Planche 01"), captionDate: T("11/2025") };
const PAGE = () => [
  { uid: "h2", type: "section-title", props: { eyebrow: T("Étiquette de rubrique"), title: T("Titre de rubrique"), intro: T("Présentation de la rubrique, en deux phrases courtes. La seconde ferme le paragraphe.") } },
  img("pimg", M.paysage, CAPS),
  { uid: "pbd", type: "project-board", props: { project: project.slug } },
];
const BOARD = () => [img("bimg", M.paysage, CAPS)];

const away = async () => {
  await page.mouse.move(5, 5);
  await sleep(300);
};
const center = async (loc) => {
  await loc.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  await sleep(200);
  const b = await loc.boundingBox();
  if (!b) throw new Error("élément sans boîte");
  return { x: b.x + Math.min(b.width / 2, 120), y: b.y + b.height / 2, b };
};
/** Un point DU TEXTE (début de la ligne), pas le milieu d'une boîte pleine largeur : coordonnées de la PAGE (pas du cadre). */
const textPoint = async (loc) => {
  await loc.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  await sleep(200);
  const p = await loc.evaluate((el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    const b = r.getClientRects()[0] ?? el.getBoundingClientRect();
    return { x: b.left + Math.min(b.width / 2, 40), y: b.top + b.height / 2 };
  });
  const off = await page.locator("iframe.ve-frame").boundingBox();
  return { x: p.x + off.x, y: p.y + off.y };
};

/* Texte en cours de saisie : l'élément lui-même (`data-editing`, page) ou le champ posé dessus (`.pe-text-editor`, planche). */
const editing = (f, hostSel) =>
  f.evaluate((host) => {
    const name = (el) => el.dataset.cap ?? el.dataset.inline ?? el.dataset.siteInline ?? el.tagName;
    const el = document.querySelector("[data-editing]");
    if (el) return name(el);
    const ed = document.querySelector(".pe-text-editor");
    if (!ed) return null;
    const r = ed.getBoundingClientRect();
    let best = null;
    for (const cand of document.querySelectorAll(`${host ?? "body"} [data-cap], ${host ?? "body"} [data-inline]`)) {
      const b = cand.getBoundingClientRect();
      if (b.width < 1) continue;
      const d = Math.abs(b.top - r.top) + Math.abs(b.left - 6 - r.left);
      if (!best || d < best.d) best = { d, n: name(cand) };
    }
    return best && best.d < 14 ? best.n : "?";
  }, hostSel ?? null);
/** Ferme la barre de style d'un texte (elle reste ouverte après Échap) pour que la pastille « Aa » redevienne visible. */
const closeBar = async (f) => {
  if (await f.locator(".lk-bar").count()) await f.locator(".lk-close").click({ timeout: 3000 }).catch(() => {});
  await sleep(150);
};
/** Ce qui reçoit réellement un clic en (x, y). */
const dump = (f) => f.evaluate(() => ({ ae: (document.activeElement?.outerHTML ?? "").slice(0, 90), de: document.querySelectorAll("[data-editing]").length, ed: document.querySelectorAll(".pe-text-editor").length, bar: document.querySelectorAll(".lk-bar").length, aa: document.querySelectorAll(".lk-aa").length, sel: [...document.querySelectorAll("[data-edit-selected]")].map((e) => e.dataset.editSelected ?? e.dataset.editBlock ?? "?").join(",") }));
const hitAt = async (f, x, y) => { const off = await page.locator("iframe.ve-frame").boundingBox(); return f.evaluate(([px, py]) => { const e = document.elementFromPoint(px, py); return e ? `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 30)}${e.dataset?.cap ? "[" + e.dataset.cap + "]" : ""}` : null; }, [x - off.x, y - off.y]); };

try {
  /* ======================================== S. Sélection des textes empilés ======================================== */
  if (run("S")) {
    await section("S", async () => {
      setDraft(pageId, PAGE());
      setBoardDraft(project.id, pageId, BOARD());
      const f = await openEditor(page, BASE, pageId);
      await settled(page);
      const TEXT_SEL = "[data-inline], [data-site-inline], [data-slot-inline], [data-project-inline], [data-look-key]";
      const HOSTS = [
        ["page, légende de l'image", '[data-edit-block="pimg"]'],
        ["planche, légende de l'image", '[data-edit-board] [data-edit-bitem="bimg"]'],
      ];
      for (const [label, host] of HOSTS) {
        const fields = ["title", "legend", "date"];
        // Le pointeur sur la photo : le composant est survolé (ses trois champs existent).
        const imgLoc = f.locator(`${host} img`).first();
        const overImg = async () => {
          await imgLoc.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
          await sleep(200);
          const ib = await imgLoc.boundingBox();
          await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2, { steps: 3 });
          await sleep(350);
        };
        await overImg();
        const fieldLoc = (n) => f.locator(`${host} [data-cap="${n}"]`).first();
        for (const n of fields) await fieldLoc(n).waitFor({ state: "attached" });
        for (const a of fields) {
          for (const b of fields) {
            if (a === b) continue;
            // 1. le pointeur survole la ligne `a` : sa pastille « Aa » apparaît.
            await page.keyboard.press("Escape");
            await closeBar(f);
            await away();
            await overImg();
            const pa = await textPoint(fieldLoc(a));
            await page.mouse.move(pa.x - 6, pa.y - 6);
            await page.mouse.move(pa.x, pa.y, { steps: 3 });
            await sleep(450);
            // La pastille ne recouvre aucun AUTRE texte modifiable.
            const clash = await f.evaluate(
              ([sel, hostSel, from]) => {
                const aa = document.querySelector(".lk-aa");
                if (!aa) return { none: true };
                const r = aa.getBoundingClientRect();
                const hits = [];
                for (const el of document.querySelectorAll(sel)) {
                  if (el.matches(`${hostSel} [data-cap="${from}"]`)) continue;
                  const b = el.getBoundingClientRect();
                  if (b.width < 1 || b.height < 1) continue;
                  const w = Math.min(r.right, b.right) - Math.max(r.left, b.left);
                  const h = Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top);
                  if (w > 1 && h > 1) hits.push(`${el.dataset.cap ?? el.dataset.inline ?? el.dataset.siteInline ?? el.tagName}:${Math.round(w)}x${Math.round(h)}`);
                }
                return { hits, aa: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] };
              },
              [TEXT_SEL, host, a],
            );
            if (!clash.none) ok(`S1 ${label} : « Aa » de ${a} ne recouvre aucun autre texte (${clash.hits.join(",") || "libre"})`, clash.hits.length === 0, JSON.stringify(clash));
            else ok(`S1 ${label} : « Aa » apparaît au survol de ${a}`, false, "pastille absente");
            if (a === "legend" && b === "title") await shot(page, `S-${label.slice(0, 4)}-aa-legende`);
            // 2. le pointeur va sur la ligne `b` et clique : la saisie est celle de `b`.
            const pb = await textPoint(fieldLoc(b));
            await page.mouse.move(pb.x, pb.y, { steps: 6 });
            const hit = await hitAt(f, pb.x, pb.y);
            await page.mouse.click(pb.x, pb.y);
            await sleep(500);
            const got = await editing(f, host);
            ok(`S2 ${label} : survol ${a} puis clic sur ${b} → saisie de ${b}`, got === b, `saisie = ${got} ; cliqué : ${hit} ; ${JSON.stringify(await dump(f))}`);
            // Pour le lot 65 (position des barres, hors périmètre ici) : la barre ouverte recouvre-t-elle une AUTRE ligne ? Information seulement.
            const covers = await f.evaluate(([hostSel, cur]) => {
              const bar = document.querySelector(".lk-bar");
              if (!bar) return null;
              const r = bar.getBoundingClientRect();
              const out = [];
              for (const el of document.querySelectorAll(`${hostSel} [data-cap]`)) {
                if (el.dataset.cap === cur) continue;
                const b = el.getBoundingClientRect();
                if (b.width > 0 && Math.min(r.right, b.right) - Math.max(r.left, b.left) > 1 && Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top) > 1) out.push(el.dataset.cap);
              }
              return out;
            }, [host, b]);
            if (covers && covers.length) console.log(`INFO S-barre ${label} : la barre de ${b} recouvre ${covers.join(", ")} (position des barres : lot 65)`);
          }
        }
        await page.keyboard.press("Escape");
        await away();
      }
      // Titre / étiquette / introduction empilés (bloc Titre de rubrique) : le texte survolé puis visé est CELUI QUE LA BARRE RÈGLE,
      // et un double-clic écrit dans celui-là.
      const sec = '[data-edit-block="h2"]';
      const pairs = [
        ["eyebrow", "title"],
        ["title", "intro"],
        ["intro", "title"],
        ["title", "eyebrow"],
      ];
      for (const [a, b] of pairs) {
        const loc = (n) => f.locator(`${sec} [data-inline="${n}"]`).first();
        await page.keyboard.press("Escape");
        await closeBar(f);
        await away();
        const pa = await textPoint(loc(a));
        await page.mouse.move(pa.x - 6, pa.y - 6);
        await page.mouse.move(pa.x, pa.y, { steps: 3 });
        await sleep(450);
        const pb = await textPoint(loc(b));
        await page.mouse.move(pb.x, pb.y, { steps: 6 });
        await sleep(450);
        const aa = await f.locator(".lk-aa").boundingBox();
        const hitAa = aa ? await hitAt(f, aa.x + aa.width / 2, aa.y + aa.height / 2) : "absente";
        ok(`S3 titre de rubrique : survol ${a} puis ${b} : la pastille « Aa » est cliquable (rien ne la recouvre)`, Boolean(aa) && /lk-aa/.test(hitAa), String(hitAa));
        if (aa) {
          await page.mouse.click(aa.x + aa.width / 2, aa.y + aa.height / 2);
          await f.locator(".lk-bar").waitFor({ timeout: 8000 });
          const target = await f.locator(".lk-bar").getAttribute("data-text-target");
          ok(`S3 …et la barre ouverte règle ${b} (pas ${a})`, target === b, `barre = ${target}`);
          await page.keyboard.press("Escape");
          await f.locator(".lk-close").click({ timeout: 3000 }).catch(() => {});
        }
        await away();
        const pb2 = await textPoint(loc(b));
        await page.mouse.dblclick(pb2.x, pb2.y);
        await sleep(500);
        const got = await editing(f, sec);
        ok(`S3 …et un double-clic sur ${b} y écrit`, got === b, `saisie = ${got} ; ${JSON.stringify(await dump(f))}`);
        await page.keyboard.press("Escape");
      }
      await page.keyboard.press("Escape");
    });
  }

  /* ======================================== M. Style « Tous les Menu » sur chaque page ======================================== */
  if (run("M")) {
    await section("M", async () => {
      const reset = () =>
        sql((db) => {
          db.prepare("delete from settings where key in ('siteDraft','styles')").run();
        });
      const pages = sql((db) => db.prepare("select id, json_extract(slug,'$.fr') as slug from pages where deleted_at is null order by id").all());
      const menuLinks = (f) => f.evaluate(() => [...document.querySelectorAll(".site-header nav:not(#nav-mobile) a.caption-text")].map((a) => ({ t: a.textContent.trim(), fs: getComputedStyle(a).fontStyle, active: a.getAttribute("aria-current") === "page" })));
      /** Ouvre la barre de style d'un lien du menu : pastille « Aa » au survol (le geste de l'artiste). */
      const openBar = async (f, target) => {
        await closeBar(f);
        const b = await target.boundingBox();
        await page.mouse.move(b.x + b.width / 2 - 3, b.y + b.height / 2 - 3);
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 3 });
        await f.locator(".lk-aa").waitFor({ timeout: 8000 });
        // La barre du lien (déplacer, retirer) apparaît un instant après le survol : la pastille s'écarte d'elle, on attend qu'elle se pose.
        await sleep(900);
        const aa = await f.locator(".lk-aa").boundingBox();
        const hit = await hitAt(f, aa.x + aa.width / 2, aa.y + aa.height / 2);
        const geo = /lk-aa/.test(hit) ? "" : JSON.stringify(await f.evaluate(() => ({ aa: document.querySelector(".lk-aa")?.getBoundingClientRect().toJSON(), tools: [...document.querySelectorAll(".pe-layer button, .pe-layer [role=toolbar]")].filter((e) => !e.closest(".lk-aa,.lk-bar")).map((e) => [e.className, Math.round(e.getBoundingClientRect().left), Math.round(e.getBoundingClientRect().top), Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)].join(" ")), links: [...document.querySelectorAll(".site-header nav [data-site-inline]")].map((e) => [Math.round(e.getBoundingClientRect().left), Math.round(e.getBoundingClientRect().top), Math.round(e.getBoundingClientRect().width), Math.round(e.getBoundingClientRect().height)].join(" ")) })));
        ok("M-Aa la pastille « Aa » d'un lien du menu est cliquable (rien ne la recouvre)", /lk-aa/.test(hit), `${hit} ${geo}`);
        await page.mouse.click(aa.x + aa.width / 2, aa.y + aa.height / 2);
        await f.locator(".lk-bar").waitFor();
      };
      /** Ouvre le style du rôle Menu depuis le lien `which` ("active" | "inactive"), l'applique (italique), mesure. */
      const apply = async (f, which, label) => {
        const links = await menuLinks(f);
        ok(`M0 ${label} : le menu a ses liens`, links.length >= 3, JSON.stringify(links));
        const idx = links.findIndex((l) => (which === "active" ? l.active : !l.active));
        const target = f.locator(".site-header nav:not(#nav-mobile) a.caption-text [data-site-inline=nav]").nth(Math.max(0, idx));
        await target.scrollIntoViewIfNeeded();
        await page.keyboard.press("Escape");
        await away();
        await openBar(f, target);
        const radio = (await f.locator(".lk-bar .lk-seg").textContent()) ?? "";
        ok(`M1 ${label} : la barre propose « Ce lien · Tout le menu · Tout le site »`, /^Ce lien\s*Tout le menu\s*Tout le site$/.test(radio.trim()), radio);
        await f.locator(".lk-bar [role=radio]", { hasText: /^Tout le site$/ }).click();
        await f.locator(".lk-bar .tc-italic").click();
        await sleep(2500);
        const after = await menuLinks(f);
        ok(`M2 ${label} : tous les liens du menu passent en italique (${after.filter((l) => l.fs === "italic").length}/${after.length})`, after.length >= 3 && after.every((l) => l.fs === "italic"), JSON.stringify(after));
        await page.keyboard.press("Escape");
        return after;
      };
      // Brouillon d'une page : retirée du site (« page en brouillon »).
      const draftPage = pages.find((p) => p.slug === "decors");
      sql((db) => {
        const row = db.prepare("select draft from pages where id = ?").get(draftPage.id);
        const d = row.draft ? JSON.parse(row.draft) : null;
        if (d) {
          d.published = false;
          db.prepare("update pages set draft = ? where id = ?").run(JSON.stringify(d), draftPage.id);
        }
      });
      const cases = pages.map((p) => ({ id: p.id, slug: p.slug || "(accueil)" }));
      for (const c of cases) {
        for (const which of ["active", "inactive"]) {
          reset();
          const f = await openEditor(page, BASE, c.id);
          await settled(page);
          await apply(f, which, `page ${c.slug}, lien ${which === "active" ? "actif" : "inactif"}`);
          await settled(page);
          await shot(page, `M-${c.slug.replace(/\W+/g, "")}-${which}`);
        }
      }
      // En-tête déjà modifié depuis une AUTRE page : le style du menu doit marcher aussi sur celle-ci.
      reset();
      const [first, second] = cases.filter((c) => c.slug !== "(accueil)");
      let f = await openEditor(page, BASE, first.id);
      await settled(page);
      await apply(f, "inactive", `page ${first.slug} (première)`);
      await settled(page);
      f = await openEditor(page, BASE, second.id);
      await settled(page);
      const links2 = await menuLinks(f);
      const idx = links2.findIndex((l) => !l.active);
      const target = f.locator(".site-header nav:not(#nav-mobile) a.caption-text [data-site-inline=nav]").nth(Math.max(0, idx));
      await target.scrollIntoViewIfNeeded();
      await openBar(f, target);
      await f.locator(".lk-bar [role=radio]", { hasText: /^Tout le site$/ }).click();
      await f.locator(".lk-bar .tc-caps").click();
      await sleep(3000);
      const links3 = await f.evaluate(() => [...document.querySelectorAll(".site-header nav:not(#nav-mobile) a.caption-text")].map((a) => `${getComputedStyle(a).textTransform}/${getComputedStyle(a).fontStyle}`));
      ok(`M3 page ${second.slug}, en-tête déjà modifié depuis ${first.slug} : le style du menu s'applique quand même (majuscules), et le réglage de ${first.slug} est repris (italique) : ${links3.join(",")}`, links3.length >= 3 && links3.every((t) => t === "uppercase/italic"), JSON.stringify(links3));
      const holder = sql((db) => JSON.parse(db.prepare("select value from settings where key = 'siteDraft'").get().value).pageId);
      ok(`M3 …le brouillon de l'en-tête est maintenant porté par la page ${second.slug}`, holder === second.id, String(holder));
      await shot(page, "M-deuxieme-page");
      await settled(page);
      // Publication depuis cette page : le style est en ligne sur TOUTES les pages publiques.
      await page.getByRole("button", { name: "Publier", exact: true }).click();
      await waitFor(async () => /En ligne/.test((await page.locator(".ve-status").textContent()) ?? ""), 120000);
      await sleep(2500);
      for (const u of ["/fr", ...cases.filter((c) => c.slug !== "(accueil)" && c.id !== draftPage.id).map((c) => `/fr/${c.slug}`)]) {
        const c2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const pp = await c2.newPage();
        await pp.goto(BASE + u, { waitUntil: "networkidle" });
        const st = await pp.evaluate(() => [...document.querySelectorAll(".site-header nav:not(#nav-mobile) a.caption-text")].map((a) => getComputedStyle(a).fontStyle));
        ok(`M5 en ligne ${u} : tous les liens du menu en italique (${st.length})`, st.length >= 3 && st.every((s) => s === "italic"), JSON.stringify(st));
        await c2.close();
      }
      // Menu compact (téléphone) : les liens du panneau suivent le même rôle.
      const c3 = await browser.newContext({ viewport: { width: 390, height: 800 } });
      const pm = await c3.newPage();
      await pm.goto(`${BASE}/fr/animation`, { waitUntil: "networkidle" });
      await pm.locator(".site-header button[aria-controls=nav-mobile]").click();
      const mob = await pm.evaluate(() => [...document.querySelectorAll("#nav-mobile a")].map((a) => getComputedStyle(a).fontStyle));
      const mobBtn = await pm.evaluate(() => getComputedStyle(document.querySelector(".site-header button[aria-controls=nav-mobile]")).fontStyle);
      ok(`M6 menu téléphone : liens et bouton « Menu » au même style (${mob.length} liens)`, mob.length >= 3 && mob.every((s) => s === "italic") && mobBtn === "italic", JSON.stringify({ mob, mobBtn }));
      await c3.close();
      reset();
    });
  }

  /* ======================================== F. Polices récentes ======================================== */
  if (run("F")) {
    await section("F", async () => {
      sql((db) => {
        db.prepare("delete from settings where key in ('siteDraft','styles','recentFonts')").run();
      });
      // Une image d'abord : un titre tout en haut de la page ouvre sa barre de style au-dessus du haut du document (hors d'atteinte : lot 65).
      setDraft(pageId, [img("pimg0", M.paysage), ...PAGE()]);
      setBoardDraft(project.id, pageId, BOARD());
      const labelOf = (ref) => ref;
      // Route compilée à la demande en dev : on la réchauffe (sinon les écritures du premier choix traînent).
      await page.request.get(`${BASE}/admin/api/fonts/recent`);
      const openMenu = async (f) => {
        await page.keyboard.press("Escape");
        await away();
        const target = f.locator('[data-edit-block="h2"] [data-inline="title"]').first();
        // Au milieu de la fenêtre : la barre de style (haute) s'ouvre au-dessus du texte sans sortir de la toile.
        await target.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
        await sleep(250);
        const b = await target.boundingBox();
        await page.mouse.move(b.x + 20, b.y + b.height / 2 - 2);
        await page.mouse.move(b.x + 24, b.y + b.height / 2, { steps: 3 });
        await f.locator(".lk-aa").waitFor({ timeout: 8000 });
        await sleep(300);
        await f.locator(".lk-aa").click();
        await f.locator(".lk-bar").waitFor();
        await f.locator(".lk-bar [role=radio]", { hasText: /^Tous les/ }).click();
        await f.locator(".lk-bar .tc-font").click();
        await f.locator(".fm").waitFor();
        await sleep(800);
      };
      const recents = (f) => f.locator(".fm [data-recent-font]").evaluateAll((els) => els.map((e) => e.getAttribute("data-recent-font")));
      let f = await openEditor(page, BASE, pageId);
      await settled(page);
      await openMenu(f);
      ok("F1 aucune police choisie : pas de section « Récentes »", (await f.locator(".fm", { hasText: "Récentes" }).count()) === 0 || (await recents(f)).length === 0);
      const pick = async (ref) => {
        await f.locator(`.fm [data-font="${ref}"]`).last().click();
        await sleep(1500);
        await openMenu(f);
      };
      await pick("embed:caveat");
      await pick("embed:kalam");
      ok("F2 après deux choix : « Récentes » = la dernière en tête, puis la précédente", JSON.stringify(await recents(f)) === JSON.stringify(["embed:kalam", "embed:caveat"]), JSON.stringify(await recents(f)));
      await pick("embed:caveat");
      ok("F3 re-choisir une police ne la duplique pas : elle remonte en tête", JSON.stringify(await recents(f)) === JSON.stringify(["embed:caveat", "embed:kalam"]), JSON.stringify(await recents(f)));
      for (const ref of ["embed:figtree", "embed:inter-tight", "embed:bowlby-one", "embed:big-shoulders", "embed:courier-prime"]) await pick(ref);
      const six = await recents(f);
      ok("F4 six récentes au plus, la plus ancienne sort", six.length === 6 && six[0] === "embed:courier-prime" && !six.includes("embed:kalam"), JSON.stringify(six));
      // Mémorisation côté SERVEUR (réglage du site), pas dans le navigateur.
      const stored = sql((db) => db.prepare("select value from settings where key = 'recentFonts'").get());
      ok("F5 les récentes sont dans les réglages du site (serveur)", Boolean(stored) && JSON.stringify(JSON.parse(stored.value)) === JSON.stringify(six), stored?.value ?? "absent");
      // Après rechargement ET dans un navigateur neuf (autre profil) : même liste.
      f = await openEditor(page, BASE, pageId);
      await settled(page);
      await openMenu(f);
      ok("F6 après rechargement : mêmes récentes, même ordre", JSON.stringify(await recents(f)) === JSON.stringify(six), JSON.stringify(await recents(f)));
      await shot(page, "F-recentes");
      await f.locator(".fm [data-font]").first().evaluate((e) => e.scrollIntoView());
      // Le chargement reste paresseux : aucune police Google n'est demandée tant qu'on n'en choisit pas ni ne défile jusqu'à elle.
      const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const p2 = await ctx2.newPage();
      await login(p2, BASE);
      const f2 = await openEditor(p2, BASE, pageId);
      await settled(p2);
      const t2 = f2.locator('[data-edit-block="h2"] [data-inline="title"]').first();
      await t2.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
      await sleep(250);
      const b2 = await t2.boundingBox();
      await p2.mouse.move(b2.x + 20, b2.y + b2.height / 2 - 2);
      await p2.mouse.move(b2.x + 24, b2.y + b2.height / 2, { steps: 3 });
      await f2.locator(".lk-aa").waitFor({ timeout: 8000 });
      await sleep(300);
      await f2.locator(".lk-aa").click();
      await f2.locator(".lk-bar [role=radio]", { hasText: /^Tous les/ }).click();
      await f2.locator(".lk-bar .tc-font").click();
      await f2.locator(".fm").waitFor();
      await sleep(1000);
      const r2 = await f2.locator(".fm [data-recent-font]").evaluateAll((els) => els.map((e) => e.getAttribute("data-recent-font")));
      ok("F7 autre navigateur (autre profil) : mêmes récentes", JSON.stringify(r2) === JSON.stringify(six), JSON.stringify(r2));
      await ctx2.close();
      // Une police inconnue ou une saisie forgée n'entre pas dans la liste.
      const bad = await page.request.post(`${BASE}/admin/api/fonts/recent`, { headers: { origin: BASE, "content-type": "application/json" }, data: { font: "g:Pas Une Police<script>" } });
      ok("F8 police inconnue refusée (400)", bad.status() === 400, String(bad.status()));
      const foreign = await page.request.post(`${BASE}/admin/api/fonts/recent`, { headers: { origin: "http://evil.example", "content-type": "application/json" }, data: { font: "embed:caveat" } });
      ok("F9 origine étrangère refusée (403)", foreign.status() === 403, String(foreign.status()));
      // Éditeur de thème guidé (étape « Textes ») : les mêmes récentes, et un choix d'ici les alimente.
      const tsx = (code) => execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { encoding: "utf8", env: { ...process.env, DATA_DIR: process.env.DATA_DIR } });
      const themeId = JSON.parse(tsx('import { duplicateTheme } from "./src/lib/edit/themes.ts"; console.log(JSON.stringify(duplicateTheme("galerie-lumineuse").data.id));').trim().split("\n").pop());
      await page.goto(`${BASE}/admin/themes/${encodeURIComponent(themeId)}?etape=textes`, { waitUntil: "networkidle" });
      await page.locator(".a-guide-head").waitFor();
      const gRecent = async () => {
        // La liste vient du serveur (requête après l'affichage) : on attend qu'elle arrive.
        await waitFor(async () => (await page.locator('[data-testid="font-recent-display"] [data-font-recent]').count()) > 0, 8000);
        return page.locator('[data-testid="font-recent-display"] [data-font-recent]').evaluateAll((els) => els.map((e) => e.getAttribute("data-font-recent")));
      };
      const before = await gRecent();
      ok("F10 éditeur guidé : « Récentes » = les polices embarquées déjà choisies, la dernière en tête", before.length >= 1 && before[0] === "courier-prime", JSON.stringify(before));
      await page.locator('[data-font-role="display"] input[type=radio]:not(:checked)').first().check({ force: true });
      await sleep(1200);
      await page.goto(`${BASE}/admin/themes/${encodeURIComponent(themeId)}?etape=textes`, { waitUntil: "networkidle" });
      await page.locator(".a-guide-head").waitFor();
      const after = await gRecent();
      const stored2 = JSON.parse(sql((db) => db.prepare("select value from settings where key = 'recentFonts'").get()).value);
      ok("F11 …un choix fait ici passe en tête (mémorisé par le serveur, comme sur la toile)", after[0] === stored2[0].replace("embed:", "") && stored2[0] !== "embed:courier-prime", JSON.stringify({ after, stored2 }));
      await shot(page, "F-guide-recentes");
      sql((db) => db.prepare("delete from themes where id = ?").run(themeId));
      void labelOf;
      void boardDraft;
    });
  }
} finally {
  await browser.close();
}
ok("aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(failures ? `ÉCHECS : ${failures}` : "TOUT VERT");
process.exit(failures ? 1 : 0);
