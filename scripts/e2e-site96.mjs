#!/usr/bin/env node
/**
 * Lot 96 « le brouillon du site ne dépend plus d'une page » (chromium, serveur de DEV ou start, base neuve, une connexion admin).
 * Données SYNTHÉTIQUES seulement (noms « Atelier Test96 »…).
 *  N  nom modifié depuis la page B, puis ouverture de l'accueil : l'ouverture (hero) et l'en-tête montrent le nouveau nom en
 *     brouillon, le public l'ancien ; « Publier » l'accueil (sans autre modification de page) : le public montre le nouveau nom,
 *     le brouillon du site a disparu.
 *  S  style « Tous les « Légende » » réglé depuis B : visible sur A en brouillon, publié avec A (public, toutes les pages).
 *  D  « Abandonner » sur une page : le brouillon du site reste ; « Annuler ces changements du site » (confirmation dans la page) l'efface.
 *  C  reprise d'un `siteDraft` { pageId, snap } d'une base v0.31.1 (sans version) : rien de perdu, visible partout, publié par une
 *     autre page ; `pageId` toujours écrit (retour arrière lisible).
 *  T  deux onglets sur deux pages : pas d'écrasement silencieux (« Modifié ailleurs », le brouillon du premier reste).
 *  R  écran Réglages : enregistre malgré un brouillon du site, publie ses champs, les reporte dans le brouillon (menu et styles intacts),
 *     la version du brouillon change ; la page qui l'a modifié à la corbeille : rien ne se perd.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=N,S,D,C,T,R ou BATT_SITE96=… sous test-all-local.sh] [SHOTS=dossier] node scripts/e2e-site96.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { img, login, makeMedia, openEditor, pageIdOf, setDraft, settled, sleep, sql, waitFor } from "./lib/grille31d.mjs";

const BASE = process.env.BASE ?? "http://localhost:3960";
const ONLY = process.env.ONLY || process.env.BATT_SITE96 || "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(tmpdir(), "e2e-site96");
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
page.on("console", (m) => m.type() === "error" && console.log(`console.error: ${m.text().slice(0, 300)}`));
await login(page, BASE);
const M = await makeMedia(page, BASE);
const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});
const section = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 8).join(" "));
    let i = 0;
    for (const p of ctx.pages()) await shot(p, `erreur-${name}-${i++}`);
  }
};

const HOME = pageIdOf("");
const A = pageIdOf("personnages");
const B = pageIdOf("decors");
const C3 = pageIdOf("animation");
const setting = (key) => {
  const row = sql((db) => db.prepare("select value from settings where key = ?").get(key));
  return row ? JSON.parse(row.value) : null;
};
const siteDraft = () => setting("siteDraft");
const siteRev = () => setting("siteDraftRev") ?? 0;
const pageHasDraft = (id) => sql((db) => db.prepare("select draft is not null as d from pages where id = ?").get(id)).d === 1;
const reset = () =>
  sql((db) => {
    db.prepare("delete from settings where key in ('siteDraft','siteDraftRev','styles')").run();
    db.prepare("update pages set draft = null, draft_updated_at = null where draft is not null").run();
  });
const restoreName = (name) =>
  sql((db) => {
    const row = db.prepare("select value from settings where key = 'site'").get();
    const v = JSON.parse(row.value);
    v.name = name;
    db.prepare("update settings set value = ? where key = 'site'").run(JSON.stringify(v));
  });
const publishedName = () => setting("site").name;

const BRAND = '[data-edit-global="header"] [data-site-inline="name"]';
/** Nom du site tel que la toile le montre : en-tête et ouverture (hero). */
const shownNames = (f) =>
  f.evaluate(() => ({
    all: [...document.querySelectorAll('[data-site-inline="name"]')].map((e) => e.textContent.trim()),
    hero: [...document.querySelectorAll('[data-edit-type="hero"] [data-site-inline="name"]')].map((e) => e.textContent.trim()),
  }));
const rename = async (f, name, p = page) => {
  await f.locator(BRAND).dblclick();
  await p.keyboard.press("ControlOrMeta+a");
  await p.keyboard.type(name);
  await p.keyboard.press("Enter");
  await settled(p);
};
/** Public (visiteur sans session). */
const pub = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const pp = await pub.newPage();
const publicBrand = async (url = "/fr") => {
  await pp.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" });
  return (await pp.locator(".site-header .site-brand").first().textContent())?.trim();
};
/** « Publier » : attend la fin réelle (toast « Publié »), pas seulement l'état « En ligne » déjà affiché avant le clic. */
const publish = async () => {
  await page.getByRole("button", { name: "Publier", exact: true }).click();
  // Le toast est « ✓ Publié : la page est en ligne » (la coche précède le texte : /^Publié/ ne le trouvait jamais, et l'attente de 120 s était avalée par le catch).
  await page.getByText(/Publié : la page est en ligne/).first().waitFor({ timeout: 120000 });
  await sleep(1200);
};

try {
  const ORIGINAL = publishedName().fr;
  const NEW = "Atelier Test96";

  /* ======================================== N. Nom du site vu depuis l'accueil ======================================== */
  if (run("N")) {
    await section("N", async () => {
      reset();
      restoreName({ fr: ORIGINAL, en: "" });
      let f = await openEditor(page, BASE, B);
      await settled(page);
      await rename(f, NEW);
      const d = siteDraft();
      ok("N1 nom modifié depuis la page B : brouillon du site écrit", d?.snap?.identity?.name?.fr === NEW, JSON.stringify(d?.snap?.identity?.name));
      ok("N2 …rattaché à B (dernière page qui l'a modifié, pour un retour en v0.31.x)", d?.pageId === B, String(d?.pageId));
      ok("N3 …sans toucher au brouillon de la page B", !pageHasDraft(B));
      ok("N4 version du brouillon du site écrite", siteRev() >= 1, String(siteRev()));
      f = await openEditor(page, BASE, HOME);
      await settled(page);
      const names = await shownNames(f);
      ok("N5 accueil : l'en-tête ET l'ouverture montrent le nouveau nom en brouillon", names.hero.length >= 1 && names.all.length >= 2 && names.all.every((n) => n === NEW), JSON.stringify(names));
      await shot(page, "N-accueil");
      ok("N6 le chip « En-tête modifié » est visible sur l'accueil", (await page.getByText("En-tête modifié").count()) >= 1);
      ok("N7 le public montre toujours l'ancien nom", (await publicBrand()) === ORIGINAL);
      const publishBtn = page.getByRole("button", { name: "Publier", exact: true });
      ok("N8 « Publier » est actif sur l'accueil (rien d'autre à publier)", await publishBtn.isEnabled());
      const revBefore = siteRev();
      await publish();
      ok("N9 « Publier » l'accueil : le nom est publié", publishedName().fr === NEW, JSON.stringify(publishedName()));
      ok("N10 …le brouillon du site a disparu", siteDraft() === null);
      ok("N11 …la version du brouillon a avancé", siteRev() > revBefore, `${revBefore} → ${siteRev()}`);
      ok("N12 public : nouveau nom sur l'accueil et sur une autre page", (await publicBrand()) === NEW && (await publicBrand("/fr/decors")) === NEW);
      ok("N13 plus de chip sur l'accueil", (await page.getByText("En-tête modifié").count()) === 0);
      f = await openEditor(page, BASE, B);
      await settled(page);
      ok("N14 page B : plus de brouillon du site, nom publié", (await shownNames(f)).all.every((n) => n === NEW) && (await page.getByText("En-tête modifié").count()) === 0);
    });
  }

  /* ======================================== S. Style « Tous les Légende » ======================================== */
  if (run("S")) {
    await section("S", async () => {
      reset();
      const PAGE = () => [img("pimg", M.paysage, { captionTitle: T("Légende de test"), caption: T("Planche 01"), captionDate: T("11/2025") })];
      // Pages A et B publiées avec une image légendée : brouillon puis « Publier ».
      for (const id of [A, B]) {
        setDraft(id, PAGE());
        await openEditor(page, BASE, id);
        await settled(page);
        await publish();
      }
      reset();
      const f = await openEditor(page, BASE, B);
      await settled(page);
      const capCase = (fr) => fr.evaluate(() => [...document.querySelectorAll("[data-cap]")].map((e) => getComputedStyle(e).textTransform));
      ok("S0 départ : légendes en casse normale sur B", (await capCase(f)).length > 0 && (await capCase(f)).every((t) => t !== "uppercase"), JSON.stringify(await capCase(f)));
      const tab = page.getByRole("tab", { name: "Réglages" });
      if (await tab.count()) await tab.first().click().catch(() => {});
      await page.locator(".lp-role", { hasText: /^Légende/ }).first().click();
      await page.locator(".lp-role-body .tc-caps").first().click();
      await settled(page);
      await sleep(1500);
      const sd = siteDraft();
      ok("S1 le style est dans le brouillon du site", sd?.snap?.styles?.roles?.caption?.case === "upper", JSON.stringify(sd?.snap?.styles?.roles));
      ok("S2 …visible sur B en brouillon", (await capCase(f)).every((t) => t === "uppercase"), JSON.stringify(await capCase(f)));
      const fa = await openEditor(page, BASE, A);
      await settled(page);
      ok("S3 …visible sur A en brouillon (une autre page)", (await capCase(fa)).length > 0 && (await capCase(fa)).every((t) => t === "uppercase"), JSON.stringify(await capCase(fa)));
      await shot(page, "S-page-A");
      const pubCase = async (url) => {
        await pp.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded" });
        return pp.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => e.children.length === 0 && /^(Légende de test|Planche 01)$/.test(e.textContent.trim())).map((e) => getComputedStyle(e).textTransform));
      };
      const before = await pubCase("/fr/personnages");
      ok("S4 public avant publication : pas de majuscules", before.length > 0 && !before.includes("uppercase"), JSON.stringify(before));
      await publish();
      ok("S5 publié avec A : réglage « styles » du site écrit, brouillon disparu", setting("styles")?.roles?.caption?.case === "upper" && siteDraft() === null);
      const afterA = await pubCase("/fr/personnages");
      const afterB = await pubCase("/fr/decors");
      ok("S6 public : légendes en majuscules sur A ET sur B", afterA.length > 0 && afterA.every((t) => t === "uppercase") && afterB.length > 0 && afterB.every((t) => t === "uppercase"), `${JSON.stringify(afterA)} / ${JSON.stringify(afterB)}`);
    });
  }

  /* ======================================== D. Abandonner / Annuler les changements du site ======================================== */
  if (run("D")) {
    await section("D", async () => {
      reset();
      restoreName({ fr: ORIGINAL, en: "" });
      setDraft(B, [img("dimg", M.carre)]);
      let f = await openEditor(page, BASE, B);
      await settled(page);
      await rename(f, "Atelier Abandon96");
      const rev0 = siteRev();
      ok("D1 départ : un brouillon de page ET un brouillon du site", pageHasDraft(B) && siteDraft()?.snap?.identity?.name?.fr === "Atelier Abandon96");
      await page.getByRole("button", { name: "Abandonner les modifications" }).first().click();
      await page.getByRole("dialog").getByRole("button", { name: "Abandonner les modifications" }).click();
      await waitFor(() => !pageHasDraft(B), 30000);
      await sleep(1500);
      ok("D2 « Abandonner » : le brouillon de la page B est effacé", !pageHasDraft(B));
      ok("D3 …le brouillon du site reste, intact", siteDraft()?.snap?.identity?.name?.fr === "Atelier Abandon96" && siteRev() === rev0, `${JSON.stringify(siteDraft()?.snap?.identity?.name)} rev ${rev0} → ${siteRev()}`);
      f = await openEditor(page, BASE, B);
      await settled(page);
      ok("D4 après rechargement, l'éditeur montre toujours le nouveau nom et le chip", (await shownNames(f)).all.every((n) => n === "Atelier Abandon96") && (await page.getByText("En-tête modifié").count()) >= 1);
      const btn = page.getByTestId("site-discard");
      ok("D5 le bouton « Annuler ces changements du site » est dans le chip", (await btn.count()) === 1 && /Annuler ces changements du site/.test((await btn.textContent()) ?? ""));
      let native = 0;
      page.once("dialog", (d) => {
        native++;
        void d.dismiss();
      });
      await btn.click();
      const dlg = page.getByRole("dialog");
      await dlg.waitFor({ timeout: 10000 });
      ok("D6 confirmation dans la page (pas de confirm() du navigateur)", native === 0 && (await dlg.textContent())?.includes("Annuler les changements du site"));
      await shot(page, "D-confirmation");
      await dlg.getByRole("button", { name: "Annuler ces changements du site" }).click();
      await waitFor(() => siteDraft() === null, 30000);
      await sleep(1500);
      ok("D7 « Annuler ces changements du site » : le brouillon du site est effacé", siteDraft() === null);
      const back = await waitFor(async () => (await shownNames(f)).all.every((n) => n === ORIGINAL), 30000);
      ok("D8 …la toile revient au nom publié, plus de chip", back && (await page.getByText("En-tête modifié").count()) === 0, JSON.stringify(await shownNames(f)));
      ok("D9 …le nom publié n'a pas changé", publishedName().fr === ORIGINAL);
      ok("D10 …la version du brouillon a avancé", siteRev() > rev0, `${rev0} → ${siteRev()}`);
    });
  }

  /* ======================================== C. Brouillon d'une base v0.31.1 ======================================== */
  if (run("C")) {
    await section("C", async () => {
      reset();
      restoreName({ fr: ORIGINAL, en: "" });
      const nav = setting("nav") ?? [];
      // Brouillon tel que la v0.31.1 l'écrit : { pageId, snap }, sans version, rattaché à C3.
      const snap = {
        identity: { name: { fr: "Atelier Repris96", en: "Taken-over Test96" }, role: T("Illustration de test"), email: "contact@example.test", credit: T("Crédit de test") },
        nav: [...nav, { kind: "link", href: "https://example.test/lien", label: T("Lien test96") }],
        socials: [{ label: "Behance", href: "https://www.behance.net/test96", kind: "behance" }],
        styles: { roles: { menu: { case: "upper" } } },
      };
      sql((db) => db.prepare("insert into settings (key, value) values ('siteDraft', ?) on conflict(key) do update set value = excluded.value").run(JSON.stringify({ pageId: C3, snap })));
      const f = await openEditor(page, BASE, A);
      await settled(page);
      ok("C1 page A (pas la page d'origine) : l'éditeur montre le nom du brouillon repris", (await shownNames(f)).all.every((n) => n === "Atelier Repris96"), JSON.stringify(await shownNames(f)));
      ok("C2 …le menu repris (lien libre) et les majuscules du menu sont là", (await f.locator('.site-header a[href="https://example.test/lien"]').count()) >= 1 && (await f.evaluate(() => getComputedStyle(document.querySelector(".site-header nav:not(#nav-mobile) a.caption-text") ?? document.body).textTransform)) === "uppercase");
      ok("C3 …aucun message de verrou", (await page.getByText(/en cours de modification sur la page/).count()) === 0);
      await rename(f, "Atelier Repris96 bis");
      const d = siteDraft();
      ok("C4 modifier depuis A : tout le reste du brouillon est conservé", d?.snap?.identity?.email === "contact@example.test" && d?.snap?.socials?.length === 1 && d?.snap?.styles?.roles?.menu?.case === "upper" && d?.snap?.nav?.some((i) => i.kind === "link" && i.href === "https://example.test/lien"), JSON.stringify(d?.snap).slice(0, 300));
      ok("C5 …le nom est modifié et pageId = A (dernière page)", d?.snap?.identity?.name?.fr === "Atelier Repris96 bis" && d?.snap?.identity?.name?.en === "Taken-over Test96" && d?.pageId === A, `${JSON.stringify(d?.snap?.identity?.name)} / ${d?.pageId}`);
      // Publication par une AUTRE page que celle d'origine et que A.
      await openEditor(page, BASE, B);
      await settled(page);
      await publish();
      const after = setting("site");
      ok("C6 publié depuis B : identité, réseaux, menu et styles du brouillon repris sont en ligne", after.name.fr === "Atelier Repris96 bis" && after.email === "contact@example.test" && setting("socials")?.[0]?.href === "https://www.behance.net/test96" && setting("styles")?.roles?.menu?.case === "upper" && setting("nav")?.some((i) => i.kind === "link" && i.href === "https://example.test/lien"), JSON.stringify(after));
      ok("C7 …le brouillon du site a disparu", siteDraft() === null);
    });
  }

  /* ======================================== T. Deux onglets ======================================== */
  if (run("T")) {
    await section("T", async () => {
      reset();
      restoreName({ fr: ORIGINAL, en: "" });
      const f1 = await openEditor(page, BASE, A);
      await settled(page);
      const page2 = await ctx.newPage();
      page2.setDefaultTimeout(60000);
      const f2 = await openEditor(page2, BASE, B);
      await settled(page2);
      // Onglet 1 écrit en premier.
      await rename(f1, "Premier onglet96");
      const rev1 = siteRev();
      ok("T1 onglet 1 (page A) : brouillon du site écrit", siteDraft()?.snap?.identity?.name?.fr === "Premier onglet96");
      // Onglet 2, resté sur l'ancienne version du site : son écriture est refusée, rien n'est écrasé.
      await f2.locator(BRAND).dblclick();
      await page2.keyboard.press("ControlOrMeta+a");
      await page2.keyboard.type("Second onglet96");
      await page2.keyboard.press("Enter");
      const blocked = await waitFor(async () => /Modifié ailleurs/.test((await page2.locator(".ve-status").textContent()) ?? ""), 60000);
      ok("T2 onglet 2 (page B) : « Modifié ailleurs », refus explicite", blocked, await page2.locator(".ve-status").textContent());
      ok("T3 …le brouillon du premier onglet n'est pas écrasé", siteDraft()?.snap?.identity?.name?.fr === "Premier onglet96" && siteRev() === rev1, `${JSON.stringify(siteDraft()?.snap?.identity?.name)} rev ${rev1} → ${siteRev()}`);
      await shot(page2, "T-onglet2");
      // Rechargé, l'onglet 2 reprend l'état et peut écrire.
      const f2b = await openEditor(page2, BASE, B);
      await settled(page2);
      ok("T4 onglet 2 rechargé : montre « Premier onglet96 »", (await shownNames(f2b)).all.every((n) => n === "Premier onglet96"));
      await rename(f2b, "Second onglet96", page2);
      ok("T5 …et son écriture passe (page B)", siteDraft()?.snap?.identity?.name?.fr === "Second onglet96" && siteDraft()?.pageId === B, `${JSON.stringify(siteDraft()?.snap?.identity?.name)} / ${siteDraft()?.pageId} / statut ${await page2.locator(".ve-status").textContent()}`);
      // Publication dans l'onglet 2, écriture dans l'onglet 1 (resté sur l'ancienne version).
      await page2.getByRole("button", { name: "Publier", exact: true }).click();
      await waitFor(() => siteDraft() === null, 60000);
      await f1.locator(BRAND).dblclick();
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.type("Tardif96");
      await page.keyboard.press("Enter");
      const blocked2 = await waitFor(async () => /Modifié ailleurs/.test((await page.locator(".ve-status").textContent()) ?? ""), 60000);
      ok("T6 onglet 1 après une publication faite ailleurs : « Modifié ailleurs », rien d'écrit", blocked2 && siteDraft() === null && publishedName().fr === "Second onglet96", `${blocked2} ${JSON.stringify(siteDraft())} ${publishedName().fr}`);
      await page2.close();
    });
  }

  /* ======================================== R. Écran Réglages, page à la corbeille ======================================== */
  if (run("R")) {
    await section("R", async () => {
      reset();
      restoreName({ fr: ORIGINAL, en: "" });
      const nav0 = setting("nav") ?? [];
      const snap = {
        identity: { name: T("Atelier Reglages96"), role: T("Rôle d'origine"), email: "avant@example.test", credit: T("") },
        nav: [...nav0, { kind: "link", href: "https://example.test/menu", label: T("Menu test96") }],
        socials: [],
        styles: { roles: { menu: { case: "upper" } } },
      };
      sql((db) => db.prepare("insert into settings (key, value) values ('siteDraft', ?) on conflict(key) do update set value = excluded.value").run(JSON.stringify({ pageId: C3, snap })));
      await page.goto(`${BASE}/admin/reglages`, { waitUntil: "domcontentloaded" });
      const notice = page.getByTestId("site-draft-notice");
      await notice.waitFor({ timeout: 60000 });
      const text = (await notice.textContent()) ?? "";
      ok("R1 Réglages : l'avis des modifications en attente est là (sans page détentrice ni refus)", /n.importe quelle page/.test(text) && !/refusé/.test(text), text.slice(0, 120));
      const email = page.getByLabel("Adresse de contact");
      const save = page.getByRole("button", { name: "Enregistrer", exact: true }).first();
      // Hydratation : on rejoue la saisie jusqu'à ce que le bouton « Enregistrer » s'active.
      for (let essai = 0; essai < 60 && !(await save.isEnabled().catch(() => false)); essai++) {
        await email.fill("");
        await email.fill("apres@example.test");
        await sleep(1000);
      }
      const rev0 = siteRev();
      await save.click();
      await waitFor(() => setting("site")?.email === "apres@example.test", 30000);
      await sleep(500);
      ok("R2 Réglages : enregistre malgré le brouillon, l'e-mail est publié tout de suite", setting("site")?.email === "apres@example.test");
      ok("R2b …le formulaire montrait le nom EN ATTENTE (pas l'ancien) : il n'est pas ré-écrasé, il est publié avec", setting("site")?.name?.fr === "Atelier Reglages96", JSON.stringify(setting("site")?.name));
      const d = siteDraft();
      ok("R3 …le brouillon du site a repris l'e-mail, gardé le menu et les styles", d?.snap?.identity?.email === "apres@example.test" && d?.snap?.nav?.some((i) => i.kind === "link" && i.href === "https://example.test/menu") && d?.snap?.styles?.roles?.menu?.case === "upper", JSON.stringify(d?.snap).slice(0, 250));
      ok("R4 …la version du brouillon a avancé", siteRev() > rev0, `${rev0} → ${siteRev()}`);
      // La page d'origine du brouillon est à la corbeille : le brouillon reste.
      sql((db) => db.prepare("update pages set deleted_at = unixepoch() where id = ?").run(C3));
      const f = await openEditor(page, BASE, A);
      await settled(page);
      ok("R5 la page d'origine est à la corbeille : l'éditeur montre toujours le brouillon du site", (await shownNames(f)).all.every((n) => n === "Atelier Reglages96") && siteDraft() !== null);
      sql((db) => db.prepare("update pages set deleted_at = null where id = ?").run(C3));
    });
  }
} finally {
  ok("aucune exception JavaScript dans l'éditeur", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
}
console.log(failures ? `\n${failures} ÉCHEC(S)` : "\nTout passe");
process.exit(failures ? 1 : 0);
