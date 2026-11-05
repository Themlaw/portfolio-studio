#!/usr/bin/env node
/**
 * Lot 124 « portées propres à l'en-tête et au pied de page » (chromium, serveur requis, base neuve). Souris et clavier réels ; données SYNTHÉTIQUES.
 *  A  Libellés et ordre des portées de chaque texte d'en-tête et de pied : « Ce lien / ce texte » · « Tout le menu » (ou « Tout le pied de page ») · « Tout le site » à droite ;
 *     le nom du site n'a pas de zone.
 *  B  Chaque texte × chaque portée : la valeur (italique) atteint le bon ensemble d'éléments et AUCUN texte du contenu ; « Tout le site » d'un pied atteint le contenu de même type,
 *     jamais l'inverse sur le menu.
 *  C  Priorités élément > zone > site > thème, « Revenir » par portée, pastille sur la portée qui porte la valeur.
 *  D  Écriture (styles du site : texts / zones), rechargement, publication, site public (1440 px) et téléphone (390 px, menu burger).
 *  E  Indépendance : un réglage « Tous les Texte » du contenu ne touche plus le pied qui a son réglage de zone ; le réglage d'un pied ne touche pas le contenu.
 *  R  Anciennes données : styles de rôle seuls, rendu calculé de l'en-tête et du pied (écrit dans $DUMP pour comparaison avec la base).
 * Captures : $SHOTS. Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=A,B,C,D,E,R] [SHOTS=dossier] [DUMP=fichier] node scripts/e2e-portee124.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { publishBlocks } from "./lib/page-draft.mjs";
import { login, openEditor, pageIdOf, q1, setDraft, settled, sleep, sql, waitFor } from "./lib/grille31d.mjs";

const BASE = process.env.BASE ?? "http://localhost:5220";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(process.env.BATTERY_DIR ?? tmpdir(), "shots-portee124");
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const diag = (...parts) => console.log(`DIAG ${parts.join(" | ")}`);
const T$ = (s) => ({ fr: s, en: s });

const INSTA = "https://www.instagram.com/exemple.test/";
const BEHANCE = "https://www.behance.net/exemple-test";

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);
const pageId = pageIdOf("personnages");
const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `${name}.png`) }).catch(() => {});
const section = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.stack ?? e.message).split("\n").slice(0, 6).join(" "));
    await shot(page, `erreur-${name}`);
  }
};

/* ---- Scène : un menu de trois liens, deux réseaux, un contenu qui montre les mêmes types de texte ---------------------------------------------- */
const PAGE_BLOCKS = () => [
  { uid: "rt", type: "rich-text", props: { eyebrow: T$("Étiquette du texte"), title: T$("Titre du texte"), paragraphs: [T$("Premier paragraphe du texte."), T$("Second paragraphe du texte.")] } },
  { uid: "prf", type: "profile", props: { eyebrow: T$("Étiquette du profil"), paragraphs: [T$("Accroche du profil.")], contactEyebrow: T$("Écrire"), contactLabel: T$("Écrire"), socialEyebrow: T$("Réseaux") } },
];
/**
 * Le brouillon commun du site (menu de la base, deux réseaux, adresse synthétique) : il est lu sans cache, donc visible à l'éditeur tout de suite ;
 * les réglages « publiés » passent ensuite par « Publier » (revalidation du cache comme pour l'artiste).
 */
function resetScene({ styles } = {}) {
  sql((db) => {
    const site = JSON.parse(db.prepare("select value from settings where key = 'site'").get().value);
    const nav = db.prepare("select id from pages where nav_order is not null order by nav_order").all().map((p) => ({ kind: "page", pageId: p.id }));
    const snap = {
      identity: { name: site.name, role: site.role, email: "contact@exemple.test", credit: site.credit },
      nav,
      socials: [{ label: "Instagram", href: INSTA }, { label: "Behance", href: BEHANCE }],
      ...(styles ? { styles } : {}),
    };
    db.prepare("delete from settings where key = 'styles'").run();
    db.prepare("insert into settings (key, value) values ('siteDraft', ?) on conflict(key) do update set value = excluded.value").run(JSON.stringify({ pageId, snap }));
  });
  setDraft(pageId, PAGE_BLOCKS());
}
const siteStyles = () => {
  const draft = q1("select value from settings where key = 'siteDraft'");
  if (draft) return JSON.parse(draft.value).snap.styles ?? {};
  const pub = q1("select value from settings where key = 'styles'");
  return pub ? JSON.parse(pub.value) : {};
};

async function reopen() {
  const f = await openEditor(page, BASE, pageId);
  await settled(page);
  await f.locator('[data-edit-block="rt"]').first().waitFor({ state: "attached", timeout: 60000 }).catch(() => {});
  await sleep(1200);
  return f;
}

/* ---- Souris et barre (mêmes gestes que portee119) ---------------------------------------------------------------------------------------------- */
const center = async (loc) => {
  await loc.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "instant" }));
  await sleep(150);
  const b = await loc.boundingBox();
  if (!b) throw new Error("élément sans boîte");
  return { x: b.x + Math.min(b.width / 2, 120), y: b.y + b.height / 2 };
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
async function openByAa(f, sel, nth = 0) {
  await closeBar(f);
  const target = f.locator(sel).nth(nth);
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
const scopes = (f) => f.locator(".lk-bar .lk-seg [role=radio]").evaluateAll((els) => els.map((e) => ({ text: e.textContent.trim().replace(/\s+/g, " "), on: e.getAttribute("aria-checked") === "true", dot: Boolean(e.querySelector(".lk-dot")) || e.hasAttribute("data-has-value") })));
const scopeBtn = (f, re) => f.locator(".lk-bar .lk-seg [role=radio]").filter({ hasText: re }).first();
const swatchBtn = (f, i) => f.locator(".lk-bar .tc-swatches [role=radio]").nth(i);
const swatchColor = (f, i) => swatchBtn(f, i).evaluate((b) => getComputedStyle(b).backgroundColor);
const resetBtn = (f) => f.locator(".lk-bar .tc-reset");
const italicBtn = (f) => f.locator(".lk-bar .tc-italic");
const capsBtn = (f) => f.locator(".lk-bar .tc-caps");
const SW = 4;
const SW2 = 3;
const SW3 = 5;
const quiet = async () => {
  await settled(page);
  await sleep(900);
};

/* ---- Éléments de l'en-tête et du pied, mesure -------------------------------------------------------------------------------------------------- */
const NAV = '.site-header nav:not(#nav-mobile) [data-site-text^="n:"]';
const byKey = (key) => `[data-site-text="${key}"]:not(#nav-mobile *)`;
/** Mesure `prop` (style calculé) de chaque texte repéré de l'en-tête et du pied, plus quelques textes du contenu. `edit` : repères de l'éditeur pour le contenu. */
const MEASURE = `(arg) => {
  const out = {};
  const put = (name, el) => { if (el && el.getBoundingClientRect().width > 0) out[name] = getComputedStyle(el)[arg.prop]; };
  for (const el of document.querySelectorAll('[data-site-text]')) {
    if (el.closest('#nav-mobile')) continue;
    const k = el.getAttribute('data-site-text');
    if (k === 'menu-btn') continue;
    put(k, el);
  }
  const root = arg.edit ? '[data-edit-block="rt"]' : '#contenu';
  put('rt-eyebrow', document.querySelector(root + ' .eyebrow'));
  put('rt-title', document.querySelector(root + ' h2, ' + root + ' h1'));
  put('rt-p', document.querySelector(root + ' p:not(.eyebrow)'));
  put('prf-email', document.querySelector((arg.edit ? '[data-edit-block="prf"]' : '#contenu') + ' .email-link'));
  return out;
}`;
const measure = (p, prop, edit = true) => p.evaluate(`(${MEASURE})(${JSON.stringify({ prop, edit })})`);
const changed = (a, b) => Object.keys(b).filter((k) => a[k] !== b[k]).sort();
const keysOf = (f) => f.evaluate(() => [...document.querySelectorAll("[data-site-text]")].filter((e) => !e.closest("#nav-mobile") && e.getAttribute("data-site-text") !== "menu-btn" && e.getBoundingClientRect().width > 0).map((e) => e.getAttribute("data-site-text")));
const isEb = (k) => /^f:(eb-|copy)/.test(k);
/** Ensemble attendu pour une valeur posée sur `key` à la portée `scope`. */
function expected(scope, key, names) {
  if (scope === "local") return [key];
  if (scope === "zone") return names.filter((k) => (key.startsWith("n:") ? k.startsWith("n:") : k.startsWith("f:")));
  if (key === "brand") return ["brand"];
  if (key.startsWith("n:")) return names.filter((k) => k.startsWith("n:"));
  if (isEb(key)) return names.filter((k) => isEb(k) || k === "rt-eyebrow");
  return names.filter((k) => (k.startsWith("f:") && !isEb(k)) || k === "rt-p" || k === "prf-email");
}
const expectLabels = (key) => {
  const one = key.startsWith("n:") || key.startsWith("f:n:") || key.startsWith("f:s:") ? /^Ce lien$/ : isEb(key) ? /^Cette étiquette$/ : /^Ce texte$/;
  if (key === "brand") return [one, /^Tout le site$/];
  return [one, key.startsWith("n:") ? /^Tout le menu$/ : /^Tout le pied de page$/, /^Tout le site$/];
};
const ZONE_RE = (key) => (key.startsWith("n:") ? /^Tout le menu$/ : /^Tout le pied de page$/);
const bodyScope = (key) => (key === "brand" ? 0 : 1);
void bodyScope;

const FOOT_FIXED = ["f:eb-contact", "f:email", "f:role", "f:eb-nav", "f:eb-name", "f:copy", "f:credit"];
let ALL = [];

/* ===== A. Libellés et ordre des portées ============================================================================================================== */
if (run("A")) {
  await section("A", async () => {
    resetScene();
    const f = await reopen();
    ALL = await keysOf(f);
    diag("textes repérés", JSON.stringify(ALL));
    ok("A0 le nom, les liens du menu, les textes du pied et les réseaux sont repérés", ALL.includes("brand") && ALL.filter((k) => k.startsWith("n:")).length >= 3 && FOOT_FIXED.every((k) => ALL.includes(k)) && ALL.filter((k) => k.startsWith("f:s:")).length === 2, JSON.stringify(ALL));
    for (const key of ALL) {
      const opened = await openByAa(f, byKey(key));
      ok(`A ${key} : la barre s'ouvre`, opened);
      if (!opened) continue;
      const sc = (await scopes(f)).map((s) => s.text);
      const want = expectLabels(key);
      ok(`A ${key} : ${want.length} portées, dans l'ordre, « Tout le site » à droite`, sc.length === want.length && want.every((re, i) => re.test(sc[i])), JSON.stringify(sc));
      ok(`A ${key} : la portée de départ est « ce lien / ce texte »`, (await scopes(f))[0]?.on === true);
      await closeBar(f);
    }
    // Le contenu garde ses libellés d'avant (le lot 120 : deux portées hors planche).
    ok("A contenu : la barre d'un texte de page s'ouvre", await openByAa(f, '[data-edit-block="rt"] [data-inline="paragraphs.0"]'));
    const sc = (await scopes(f)).map((s) => s.text);
    ok("A contenu : « Ce texte » · « Tous les « Texte » » (inchangé)", sc.length === 2 && /^Ce texte$/.test(sc[0]) && /^Tous les « Texte »$/.test(sc[1]), JSON.stringify(sc));
    await closeBar(f);
  });
}

/* ===== B. Chaque texte × chaque portée ================================================================================================================= */
if (run("B")) {
  await section("B", async () => {
    resetScene();
    let f = await reopen();
    ALL = await keysOf(f);
    const names0 = Object.keys(await measure(f, "fontStyle"));
    ok("B0 mesure de départ : aucun texte en italique", Object.values(await measure(f, "fontStyle")).every((v) => v === "normal"));
    for (const scope of ["local", "zone", "role"]) {
      for (const key of ALL) {
        if (scope === "zone" && key === "brand") continue;
        const tag = `B ${key} / ${scope === "local" ? "ce texte" : scope === "zone" ? "zone" : "tout le site"}`;
        if (!(await openByAa(f, byKey(key)))) {
          ok(`${tag} : la barre s'ouvre`, false);
          continue;
        }
        const re = scope === "local" ? expectLabels(key)[0] : scope === "zone" ? ZONE_RE(key) : /^Tout le site$/;
        await scopeBtn(f, re).click();
        const before = await measure(f, "fontStyle");
        await italicBtn(f).click();
        await sleep(450);
        const after = await measure(f, "fontStyle");
        const got = changed(before, after).filter((k) => after[k] === "italic");
        const want = expected(scope, key, names0).sort();
        ok(`${tag} : atteint ${want.length} élément(s), aucun autre (contenu compris)`, JSON.stringify(got) === JSON.stringify(want), JSON.stringify({ got, want }));
        await quiet();
        // « Revenir » rend l'état d'avant, pour la portée choisie seule.
        await resetBtn(f).click();
        await quiet();
        ok(`${tag} : « Revenir » rétablit l'état d'avant`, JSON.stringify(await measure(f, "fontStyle")) === JSON.stringify(before), JSON.stringify(changed(before, await measure(f, "fontStyle"))));
        await closeBar(f);
      }
    }
    ok("B fin : rien n'est resté dans les styles du site", Object.keys(siteStyles().texts ?? {}).length === 0 && Object.keys(siteStyles().zones ?? {}).length === 0 && Object.keys(siteStyles().roles ?? {}).length === 0, JSON.stringify(siteStyles()));
    f = await reopen();
    ok("B fin : après rechargement, aucun texte en italique", Object.values(await measure(f, "fontStyle")).every((v) => v === "normal"));
  });
}

/* ===== C. Priorités, « Revenir » par portée, pastilles ======================================================================================================= */
if (run("C")) {
  await section("C", async () => {
    resetScene();
    const f = await reopen();
    ALL = await keysOf(f);
    const navKeys = ALL.filter((k) => k.startsWith("n:"));
    const [k0, k1] = navKeys;
    const color = (key) => f.locator(byKey(key)).first().evaluate((el) => getComputedStyle(el).color);
    const dots = async () => (await scopes(f)).map((s) => s.dot);
    const resetText = async () => ((await resetBtn(f).textContent()) ?? "").trim();
    const theme = [await color(k0), await color(k1)];
    // C1 site (« Menu ») : tous les liens.
    ok("C1 barre du premier lien", await openByAa(f, byKey(k0)));
    ok("C1 aucune pastille au départ", (await dots()).every((d) => !d), JSON.stringify(await scopes(f)));
    await scopeBtn(f, /^Tout le site$/).click();
    const cSite = await swatchColor(f, SW);
    await swatchBtn(f, SW).click();
    await quiet();
    ok("C1 site : les deux liens suivent", (await color(k0)) === cSite && (await color(k1)) === cSite, JSON.stringify([await color(k0), await color(k1), cSite]));
    ok("C1 pastille sur « Tout le site » seulement", JSON.stringify(await dots()) === "[false,false,true]", JSON.stringify(await scopes(f)));
    // C2 zone : passe devant le site.
    await scopeBtn(f, /^Tout le menu$/).click();
    const cZone = await swatchColor(f, SW2);
    await swatchBtn(f, SW2).click();
    await quiet();
    ok("C2 zone : tous les liens du menu, devant le site", (await color(k0)) === cZone && (await color(k1)) === cZone, JSON.stringify([await color(k0), await color(k1), cZone]));
    ok("C2 pastilles : zone et site", JSON.stringify(await dots()) === "[false,true,true]", JSON.stringify(await scopes(f)));
    // C3 élément : passe devant la zone, lui seul.
    await scopeBtn(f, /^Ce lien$/).click();
    const cOne = await swatchColor(f, SW3);
    await swatchBtn(f, SW3).click();
    await quiet();
    ok("C3 élément : ce lien seul, devant la zone", (await color(k0)) === cOne && (await color(k1)) === cZone, JSON.stringify([await color(k0), await color(k1), cOne, cZone]));
    ok("C3 pastilles sur les trois portées", JSON.stringify(await dots()) === "[true,true,true]", JSON.stringify(await scopes(f)));
    await shot(page, "C3-trois-pastilles");
    const st = siteStyles();
    ok("C3 écrit dans les styles du site : texts, zones, roles", st.texts?.[k0]?.color === "tertiary" && st.zones?.menu?.color === "primary" && st.roles?.menu?.color === "secondary", JSON.stringify(st));
    // C4 « Revenir » par portée.
    ok("C4 « Revenir au style du menu » pour le lien", /menu/i.test(await resetText()), await resetText());
    await resetBtn(f).click();
    await quiet();
    ok("C4 lien revenu : reprend la zone ; pastilles zone et site", (await color(k0)) === cZone && JSON.stringify(await dots()) === "[false,true,true]", JSON.stringify([await color(k0), await scopes(f)]));
    await scopeBtn(f, /^Tout le menu$/).click();
    ok("C4 « Revenir au style du site » pour la zone", /site/i.test(await resetText()), await resetText());
    await resetBtn(f).click();
    await quiet();
    ok("C4 zone revenue : reprend le site", (await color(k0)) === cSite && (await color(k1)) === cSite);
    await scopeBtn(f, /^Tout le site$/).click();
    ok("C4 « Revenir au thème » pour le site", /thème/i.test(await resetText()), await resetText());
    await resetBtn(f).click();
    await quiet();
    ok("C4 site revenu : couleurs du thème", (await color(k0)) === theme[0] && (await color(k1)) === theme[1] && JSON.stringify(await dots()) === "[false,false,false]", JSON.stringify([await color(k0), theme, await scopes(f)]));
    await closeBar(f);

    // C5 pied de page : zone puis texte seul (la couleur du « Texte » du site ne s'applique pas au pied : seulement sa police), « Revenir ».
    const colorF = (key) => f.locator(byKey(key)).first().evaluate((el) => getComputedStyle(el).color);
    const fk = ["f:role", "f:credit", "f:email", "f:n:" + k0.slice(2)].filter((k) => ALL.includes(k));
    const themeF = await Promise.all(fk.map(colorF));
    ok("C5 barre du métier (pied)", await openByAa(f, byKey("f:role")));
    await scopeBtn(f, /^Tout le pied de page$/).click();
    const fz = await swatchColor(f, SW2);
    await swatchBtn(f, SW2).click();
    await quiet();
    ok("C5 zone du pied : tous les textes du pied suivent", (await Promise.all(fk.map(colorF))).every((c) => c === fz), JSON.stringify(await Promise.all(fk.map(colorF))));
    ok("C5 …le menu et le contenu ne bougent pas", (await color(k0)) === theme[0] && (await f.locator('[data-edit-block="rt"] p:not(.eyebrow)').first().evaluate((el) => getComputedStyle(el).color)) !== fz);
    await scopeBtn(f, /^Ce texte$/).click();
    const fo = await swatchColor(f, SW3);
    await swatchBtn(f, SW3).click();
    await quiet();
    ok("C5 texte seul : le métier seul, devant la zone", (await colorF("f:role")) === fo && (await colorF("f:credit")) === fz, JSON.stringify([await colorF("f:role"), await colorF("f:credit"), fo, fz]));
    ok("C5 pastilles : texte et zone", JSON.stringify(await dots()) === "[true,true,false]", JSON.stringify(await scopes(f)));
    await resetBtn(f).click();
    await quiet();
    await scopeBtn(f, /^Tout le pied de page$/).click();
    await resetBtn(f).click();
    await quiet();
    ok("C5 « Revenir » : couleurs du thème", JSON.stringify(await Promise.all(fk.map(colorF))) === JSON.stringify(themeF), JSON.stringify([await Promise.all(fk.map(colorF)), themeF]));
    await closeBar(f);
    ok("C fin : plus rien dans les styles du site", !siteStyles().texts && !siteStyles().zones && !siteStyles().roles, JSON.stringify(siteStyles()));
  });
}

/* ===== D. Écriture, rechargement, publication, public, téléphone ================================================================================================= */
if (run("D")) {
  await section("D", async () => {
    resetScene();
    let f = await reopen();
    ALL = await keysOf(f);
    const navKeys = ALL.filter((k) => k.startsWith("n:"));
    const [k0, k1] = navKeys;
    const base = await measure(f, "color");
    const pick = async (key, scopeRe, sw, tool) => {
      ok(`D mise en place : barre de ${key}`, await openByAa(f, byKey(key)));
      await scopeBtn(f, scopeRe).click();
      const c = sw === undefined ? null : await swatchColor(f, sw);
      if (tool === "italic") await italicBtn(f).click();
      else if (tool === "caps") await capsBtn(f).click();
      else await swatchBtn(f, sw).click();
      await quiet();
      await closeBar(f);
      return c;
    };
    const cLink = await pick(k1, /^Ce lien$/, SW);
    await pick(k0, /^Tout le menu$/, undefined, "italic");
    await pick("f:eb-nav", /^Tout le pied de page$/, undefined, "caps");
    const cRole = await pick("f:role", /^Ce texte$/, SW2);
    const cBrand = await pick("brand", /^Ce texte$/, SW3);
    const st = siteStyles();
    ok("D1 écrit : texte du lien, zone du menu, zone du pied, métier, nom", st.texts?.[k1]?.color === "secondary" && st.zones?.menu?.italic === true && st.zones?.footer?.case === "upper" && st.texts?.["f:role"]?.color === "primary" && st.texts?.brand?.color === "tertiary", JSON.stringify(st));
    ok("D1 …dans le brouillon du site, pas encore publié", Boolean(q1("select 1 as x from settings where key = 'siteDraft'")) && !q1("select value from settings where key = 'styles'"));
    const edit = { color: await measure(f, "color"), style: await measure(f, "fontStyle"), caps: await measure(f, "textTransform") };
    const expectState = (m, label) => {
      ok(`${label} : le lien réglé a sa couleur, le nom la sienne, le métier la sienne`, m.color[k1] === cLink && m.color.brand === cBrand && m.color["f:role"] === cRole, JSON.stringify({ k1: m.color[k1], cLink, brand: m.color.brand, cBrand, role: m.color["f:role"], cRole }));
      ok(`${label} : tous les liens du menu en italique, rien d'autre`, navKeys.every((k) => m.style[k] === "italic") && ALL.filter((k) => !k.startsWith("n:")).every((k) => m.style[k] === "normal"), JSON.stringify(m.style));
      ok(`${label} : tout le pied en majuscules, pas le nom du site`, ALL.filter((k) => k.startsWith("f:")).every((k) => m.caps[k] === "uppercase") && m.caps.brand !== "uppercase", JSON.stringify(m.caps));
      ok(`${label} : le contenu garde ses couleurs d'avant`, ["rt-eyebrow", "rt-title", "rt-p"].every((k) => m.color[k] === base[k]), JSON.stringify([m.color, base]));
    };
    expectState(edit, "D2 éditeur");
    await shot(page, "D2-editeur");
    // D3 rechargement.
    f = await reopen();
    expectState({ color: await measure(f, "color"), style: await measure(f, "fontStyle"), caps: await measure(f, "textTransform") }, "D3 après rechargement");
    ok("D3 la barre rouverte montre les pastilles", (await openByAa(f, byKey(k1))) && JSON.stringify((await scopes(f)).map((s) => s.dot)) === "[true,true,false]", JSON.stringify(await scopes(f)));
    await closeBar(f);
    // D4 publication : par l'éditeur ; le brouillon du site devient le réglage publié.
    const published = await publishBlocks(page, BASE, pageId, (blocks) => blocks, () => !q1("select 1 as x from settings where key = 'siteDraft'") && Boolean(q1("select value from settings where key = 'styles'")), 90000);
    ok("D4 publié : le brouillon du site est vidé, les styles sont publiés", published);
    const pub = JSON.parse(q1("select value from settings where key = 'styles'")?.value ?? "{}");
    ok("D4 …texts et zones dans les styles publiés", pub.texts?.[k1]?.color === "secondary" && pub.zones?.menu?.italic === true && pub.zones?.footer?.case === "upper", JSON.stringify(pub));
    // D5 site public (visiteur anonyme), grand écran.
    const anon = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const pp = await anon.newPage();
    pp.setDefaultTimeout(60000);
    await pp.goto(`${BASE}/fr/personnages`, { waitUntil: "load" });
    await sleep(1500);
    const m = { color: await measure(pp, "color", false), style: await measure(pp, "fontStyle", false), caps: await measure(pp, "textTransform", false) };
    expectState(m, "D5 public 1440");
    ok("D5 public = éditeur (mêmes couleurs de l'en-tête et du pied)", ALL.every((k) => m.color[k] === edit.color[k]), JSON.stringify(ALL.filter((k) => m.color[k] !== edit.color[k])));
    await shot(pp, "D5-public");
    // D6 téléphone : menu burger.
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const mp = await phone.newPage();
    mp.setDefaultTimeout(60000);
    await mp.goto(`${BASE}/fr/personnages`, { waitUntil: "load" });
    await sleep(1500);
    const burger = mp.locator('button[aria-controls="nav-mobile"]');
    ok("D6 le bouton « Menu » est montré à 390 px", await burger.isVisible());
    const btnStyle = await burger.evaluate((b) => getComputedStyle(b).fontStyle);
    ok("D6 …et prend le style de la zone du menu (italique)", btnStyle === "italic", btnStyle);
    await burger.click();
    await sleep(500);
    const mobile = await mp.evaluate(() =>
      [...document.querySelectorAll('#nav-mobile [data-site-text^="n:"]')].map((a) => ({ key: a.getAttribute("data-site-text"), color: getComputedStyle(a).color, style: getComputedStyle(a).fontStyle })),
    );
    ok("D6 liens du menu burger : tous en italique (zone)", mobile.length >= 3 && mobile.every((l) => l.style === "italic"), JSON.stringify(mobile));
    ok("D6 …et le lien réglé a sa couleur, les autres non", mobile.find((l) => l.key === k1)?.color === cLink && mobile.filter((l) => l.key !== k1).every((l) => l.color !== cLink), JSON.stringify(mobile));
    await shot(mp, "D6-burger");
    await anon.close();
    await phone.close();
    // D7 retour à l'état de départ pour la suite.
    resetScene();
  });
}

/* ===== E. Indépendance du contenu et du pied ================================================================================================================ */
if (run("E")) {
  await section("E", async () => {
    resetScene();
    let f = await reopen();
    ALL = await keysOf(f);
    const m0 = await measure(f, "textTransform");
    // E1 : « Tous les « Texte » » du contenu en majuscules : le pied (police seule du texte) les suit, comme avant le lot.
    ok("E1 barre d'un paragraphe de page", await openByAa(f, '[data-edit-block="rt"] [data-inline="paragraphs.0"]'));
    await scopeBtn(f, /^Tous les « Texte »$/).click();
    await capsBtn(f).click();
    await quiet();
    const m1 = await measure(f, "textTransform");
    ok("E1 contenu : le paragraphe est en majuscules", m1["rt-p"] === "uppercase", m1["rt-p"]);
    ok("E1 sans réglage de zone, le pied reprend la police du « Texte » du site (rendu d'avant)", m1["f:role"] === "uppercase" && m1["f:credit"] === "uppercase" && m1["f:email"] === "uppercase", JSON.stringify(m1));
    ok("E1 …mais ni le menu, ni le nom, ni les étiquettes du pied", m1["brand"] === m0["brand"] && ALL.filter((k) => k.startsWith("n:")).every((k) => m1[k] === m0[k]) && isEb("f:eb-nav") && m1["f:eb-nav"] === m0["f:eb-nav"], JSON.stringify(m1));
    await closeBar(f);
    // E2 : le pied a son réglage de zone (casse normale) : le « Texte » du contenu ne le touche plus.
    ok("E2 barre du métier (pied)", await openByAa(f, byKey("f:role")));
    await scopeBtn(f, /^Tout le pied de page$/).click();
    await capsBtn(f).click(); // normal -> MAJUSCULES
    await quiet();
    await capsBtn(f).click(); // MAJUSCULES -> normal (réglage de zone « casse normale »)
    await quiet();
    ok("E2 le réglage de zone est « casse normale »", siteStyles().zones?.footer?.case === "normal", JSON.stringify(siteStyles().zones));
    const m2 = await measure(f, "textTransform");
    ok("E2 le pied revient à la casse normale malgré le « Texte » du site en majuscules", ["f:role", "f:credit", "f:email"].every((k) => m2[k] === "none"), JSON.stringify(m2));
    ok("E2 …le contenu, lui, reste en majuscules", m2["rt-p"] === "uppercase", m2["rt-p"]);
    await closeBar(f);
    // E3 : le « Texte » du site garde la main sur ce que la zone ne règle pas (propriété par propriété : site > thème), sans toucher à la casse de la zone.
    ok("E3 barre du paragraphe", await openByAa(f, '[data-edit-block="rt"] [data-inline="paragraphs.0"]'));
    await scopeBtn(f, /^Tous les « Texte »$/).click();
    await italicBtn(f).click();
    await quiet();
    const m3 = await measure(f, "textTransform");
    const i3 = await measure(f, "fontStyle");
    ok("E3 la zone du pied garde sa casse malgré le site en majuscules", ["f:role", "f:credit", "f:email"].every((k) => m3[k] === "none") && m3["rt-p"] === "uppercase", JSON.stringify(m3));
    ok("E3 …et ce que la zone ne règle pas (italique) vient du site, comme le contenu", ["f:role", "f:credit", "f:email", "rt-p"].every((k) => i3[k] === "italic"), JSON.stringify(i3));
    await closeBar(f);
    f = await reopen();
    const m4 = await measure(f, "textTransform");
    ok("E4 après rechargement : même partage entre le pied et le contenu", ["f:role", "f:credit", "f:email"].every((k) => m4[k] === "none") && m4["rt-p"] === "uppercase", JSON.stringify(m4));
    resetScene();
  });
}

/* ===== R. Anciennes données : styles de rôle seuls, rendu identique à la base ============================================================================================= */
if (run("R")) {
  await section("R", async () => {
    resetScene({ styles: { roles: { menu: { color: "secondary", weight: 700 }, brand: { italic: true }, body: { font: "theme:display", case: "upper" }, eyebrow: { color: "tertiary", tracking: 0.1 } } } });
    const done = await publishBlocks(page, BASE, pageId, (blocks) => blocks, () => !q1("select 1 as x from settings where key = 'siteDraft'") && Boolean(q1("select value from settings where key = 'styles'")), 90000);
    ok("R0 anciennes données publiées (styles de rôle seuls)", done);
    const anon = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const pp = await anon.newPage();
    pp.setDefaultTimeout(60000);
    await pp.goto(`${BASE}/fr/personnages`, { waitUntil: "load" });
    await sleep(1500);
    const PROPS = ["color", "fontFamily", "fontSize", "fontWeight", "fontStyle", "textTransform", "letterSpacing", "textDecorationLine", "backgroundColor", "paddingTop", "paddingLeft", "textShadow"];
    const dump = await pp.evaluate((props) => {
      const out = [];
      for (const el of document.querySelectorAll(".site-header, .site-header *, footer, footer *")) {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const path = (() => {
          const parts = [];
          for (let e = el; e && e.tagName !== "BODY"; e = e.parentElement) parts.unshift(e.tagName.toLowerCase() + ([...(e.parentElement?.children ?? [])].indexOf(e) + 1));
          return parts.join(">");
        })();
        out.push({ path, w: r.width > 0, ...Object.fromEntries(props.map((p) => [p, cs[p]])) });
      }
      return out;
    }, PROPS);
    diag("éléments mesurés (anciennes données)", String(dump.length));
    ok("R1 l'en-tête et le pied portent leurs styles de rôle (menu en gras, nom en italique)", dump.some((d) => d.fontWeight === "700") && dump.some((d) => d.fontStyle === "italic"));
    if (process.env.DUMP) writeFileSync(process.env.DUMP, JSON.stringify(dump, null, 1));
    // L'éditeur et le public rendent la même chose pour l'en-tête et le pied.
    const f = await reopen();
    const edit = await measure(f, "textTransform");
    const pubm = await measure(pp, "textTransform", false);
    ok("R2 éditeur = public (casse) pour l'en-tête et le pied", ["brand", "f:role", "f:credit", "f:email", "f:eb-nav"].every((k) => edit[k] === pubm[k]), JSON.stringify({ edit, pubm }));
    await anon.close();
    resetScene();
  });
}

ok("aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `ÉCHEC : ${failures}` : "OK");
process.exit(failures ? 1 : 0);
