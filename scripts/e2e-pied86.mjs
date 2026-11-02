#!/usr/bin/env node
/**
 * Lot 86 « pied de page : réseaux et e-mail en édition » (chromium, serveur requis, base neuve, une connexion admin).
 * Données SYNTHÉTIQUES : adresse contact@exemple.test, réseaux fictifs (Instagram, Behance) sur des profils inventés.
 *  S  Mise en place (dans l'éditeur, comme l'artiste) : deux réseaux, adresse e-mail du pied.
 *  H  La poignée d'un réseau est collée à la ligne (< 48 px du texte) et reste visible pendant le trajet de la souris, pas à pas.
 *  K  Clavier et toucher : un lien focalisé ou touché montre la barre ; Alt + flèche et flèches sur la poignée déplacent.
 *  G  Glisser la poignée réordonne ; recharger l'éditeur : l'ordre est gardé.
 *  M  390 px : la barre reste dans la fenêtre.
 *  E  En édition, aucun lien (e-mail, réseau, tel:) n'ouvre quoi que ce soit : action par défaut annulée, ni navigation, ni onglet, ni window.open.
 *  P  Site public : href intacts (mailto: compris), clic non empêché, le profil s'ouvre ; ordre publié = ordre du brouillon.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=S,H,…] [SHOTS=dossier] node scripts/e2e-pied86.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { canvas, login, pageIdOf, q1, settled, sleep, sql, waitFor } from "./lib/grille31d.mjs";

const BASE = process.env.BASE ?? "http://localhost:3880";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(process.env.BATTERY_DIR ?? tmpdir(), "shots-pied86");
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const info = (label) => console.log(`INFO ${label}`);

const EMAIL = "contact@exemple.test";
const INSTA = "https://www.instagram.com/exemple.test/";
const BEHANCE = "https://www.behance.net/exemple-test";

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
// Toute navigation de la page de l'éditeur, de la toile ou d'un nouvel onglet est notée.
const navs = [];
page.on("framenavigated", (fr) => navs.push(fr.url()));
const popups = [];
ctx.on("page", (p) => {
  if (p !== page) popups.push(p.url());
});
await login(page, BASE);

const pageId = pageIdOf("personnages");
const siteDraft = () => {
  const row = q1("select value from settings where key = 'siteDraft'");
  return row ? JSON.parse(row.value) : null;
};
const draftSocials = () => (siteDraft()?.snap.socials ?? []).filter((s) => s.href.startsWith("https://")).map((s) => s.label);
const rest = async () => {
  await settled(page);
  await sleep(1200);
  await settled(page);
};
async function openEditor() {
  await page.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
  const f = await canvas(page);
  await sleep(2000);
  return f;
}
const footerEnd = async (f) => {
  await f.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
  await sleep(500);
};
const socialLinks = (f) => f.locator("footer [data-social-index] a");
const labelsOnCanvas = (f) => f.evaluate(() => [...document.querySelectorAll("footer [data-social-index]")].sort((a, b) => (Number(a.style.order) || 0) - (Number(b.style.order) || 0)).map((li) => li.textContent.trim()));
const tools = (f) => f.locator('.pe-item-tools[data-kind="social"]');
const footerShot = async (f, name) => {
  const b = await f.locator("footer").boundingBox();
  if (b) await page.screenshot({ path: path.join(SHOTS, name), clip: { x: Math.max(0, b.x), y: Math.max(0, b.y), width: Math.min(b.width, page.viewportSize().width), height: Math.min(b.height, page.viewportSize().height - Math.max(0, b.y)) } }).catch(() => {});
};

// Base neuve : les trois réseaux d'exemple du seed (adresse « # », donc jamais rendus) sont écartés. Ils portent les mêmes noms que
// ceux qu'on ajoute (Instagram…) et fausseraient les clés d'identification des lignes. Le brouillon du site naît de ce réglage.
sql((db) => db.prepare("update settings set value = '[]' where key = 'socials'").run());
let f = await openEditor();

/* ---- S. Mise en place ------------------------------------------------------------------------------------------------------ */
// Le brouillon laissé par un essai précédent est écarté d'emblée (base neuve : normalement rien).
await footerEnd(f);
for (const [menu, href] of [
  ["Instagram", INSTA],
  ["Behance", BEHANCE],
]) {
  await f.locator('[data-testid="social-add"]').first().click();
  await f.getByRole("menuitem", { name: menu }).click();
  await f.getByLabel("Adresse du profil").fill(href);
  await f.getByRole("button", { name: "Ajouter", exact: true }).click();
  await rest();
  await footerEnd(f);
}
const emailEl = f.locator('footer [data-site-inline="email"]');
await emailEl.dblclick();
await page.keyboard.press("ControlOrMeta+a");
await page.keyboard.type(EMAIL);
await page.keyboard.press("Enter");
await rest();
await footerEnd(f);
ok("S1 réseaux du brouillon : Instagram puis Behance", JSON.stringify(draftSocials().slice(-2)) === JSON.stringify(["Instagram", "Behance"]), JSON.stringify(draftSocials()));
ok("S2 adresse e-mail du brouillon", siteDraft()?.snap.site?.email === EMAIL || JSON.stringify(siteDraft()).includes(EMAIL), (await emailEl.textContent()) ?? "");
await footerShot(f, "S-pied.png");

// Réseaux visibles dans le pied : on travaille avec les deux derniers (les autres, sans adresse, ne sont pas rendus).
const rendered = await labelsOnCanvas(f);
info(`réseaux rendus : ${JSON.stringify(rendered)}`);
const A = "Instagram";
const B = "Behance";
const linkOf = (label) => f.locator("footer [data-social-index] a", { hasText: label });

/* ---- H. La poignée est collée à la ligne et reste atteignable --------------------------------------------------------------- */
if (run("H")) try {
  await footerEnd(f);
  const la = linkOf(A);
  await la.scrollIntoViewIfNeeded();
  const lb = await la.boundingBox();
  await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2, { steps: 6 });
  await tools(f).waitFor({ timeout: 10000 });
  const grip = tools(f).locator(".pe-grip-sm");
  const gb = await grip.boundingBox();
  const gap = gb.x - (lb.x + lb.width);
  ok("H1 la poignée s'affiche à moins de 48 px du texte du réseau", gap >= -4 && gap <= 48, `écart ${Math.round(gap)} px`);
  ok("H2 la poignée est à la hauteur de la ligne", gb.y < lb.y + lb.height && gb.y + gb.height > lb.y, `ligne ${Math.round(lb.y)}–${Math.round(lb.y + lb.height)}, poignée ${Math.round(gb.y)}–${Math.round(gb.y + gb.height)}`);
  await page.screenshot({ path: path.join(SHOTS, "H-poignee-pres-du-texte.png"), clip: { x: Math.max(0, lb.x - 120), y: Math.max(0, lb.y - 60), width: 420, height: 130 } }).catch(() => {});
  // Trajet pas à pas de la souris, du texte à la poignée : la barre ne disparaît à aucun moment.
  await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2);
  const tx = gb.x + gb.width / 2;
  const ty = gb.y + gb.height / 2;
  let gone = -1;
  const N = 30;
  for (let i = 1; i <= N; i++) {
    await page.mouse.move(lb.x + lb.width / 2 + ((tx - lb.x - lb.width / 2) * i) / N, lb.y + lb.height / 2 + ((ty - lb.y - lb.height / 2) * i) / N);
    await sleep(40);
    if ((await tools(f).count()) === 0 && gone < 0) gone = i;
  }
  ok("H3 la barre reste visible pendant le trajet, pas à pas, jusqu'à la poignée", gone < 0 && (await tools(f).count()) === 1, gone >= 0 ? `disparue au pas ${gone}/${N}` : "");
  // Le pointeur quitte vraiment la zone : la barre finit par s'effacer.
  await page.mouse.move(40, 120, { steps: 5 });
  ok("H4 loin de la ligne, la barre s'efface", await waitFor(async () => (await tools(f).count()) === 0, 5000));
} catch (e) {
  ok("H section interrompue", false, String(e.message).split("\n")[0]);
}

/* ---- K. Clavier et toucher --------------------------------------------------------------------------------------------------- */
if (run("K")) try {
  await footerEnd(f);
  await page.mouse.move(40, 120);
  await waitFor(async () => (await tools(f).count()) === 0, 5000);
  await linkOf(A).focus();
  ok("K1 un réseau qui prend le focus montre sa barre", await waitFor(async () => (await tools(f).count()) === 1, 5000));
  const before = await labelsOnCanvas(f);
  await page.keyboard.press("Alt+ArrowDown");
  await rest();
  const after = await labelsOnCanvas(f);
  ok("K2 Alt + ↓ sur un réseau le descend d'un cran", before.indexOf(A) < before.indexOf(B) && after.indexOf(A) > after.indexOf(B), `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  ok("K3 le brouillon du site garde le nouvel ordre", draftSocials().indexOf(A) > draftSocials().indexOf(B), JSON.stringify(draftSocials()));
  // Flèches sur la poignée elle-même.
  await linkOf(A).focus();
  await tools(f).waitFor({ timeout: 5000 });
  await tools(f).locator(".pe-grip-sm").focus();
  await page.keyboard.press("ArrowUp");
  await rest();
  const back = await labelsOnCanvas(f);
  ok("K4 ↑ sur la poignée remonte le réseau", back.indexOf(A) < back.indexOf(B), JSON.stringify(back));
  // Toucher : un appui sur la ligne montre la barre (aucun survol au doigt).
  await page.mouse.move(40, 120);
  await waitFor(async () => (await tools(f).count()) === 0, 5000);
  const lb = await linkOf(B).boundingBox();
  await page.touchscreen.tap(lb.x + 4, lb.y + lb.height / 2);
  ok("K5 au doigt, un appui sur le réseau montre la barre et sa poignée", await waitFor(async () => (await tools(f).locator(".pe-grip-sm").count()) === 1, 5000));
} catch (e) {
  ok("K section interrompue", false, String(e.message).split("\n")[0]);
}

/* ---- G. Glisser, puis recharger --------------------------------------------------------------------------------------------- */
if (run("G")) try {
  await footerEnd(f);
  const order0 = await labelsOnCanvas(f);
  const la = await linkOf(order0[0]).boundingBox();
  await page.mouse.move(la.x + la.width / 2, la.y + la.height / 2, { steps: 4 });
  await tools(f).waitFor({ timeout: 10000 });
  const gb = await tools(f).locator(".pe-grip-sm").boundingBox();
  const lb = await linkOf(order0[order0.length - 1]).boundingBox();
  await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2, { steps: 6 });
  await page.mouse.down();
  await page.mouse.move(gb.x + gb.width / 2, lb.y + lb.height + 6, { steps: 10 });
  await page.mouse.up();
  await rest();
  const order1 = await labelsOnCanvas(f);
  ok("G1 glisser la poignée sous le dernier réseau le descend en dernier", order1[order1.length - 1] === order0[0], `${JSON.stringify(order0)} → ${JSON.stringify(order1)}`);
  const stored = draftSocials().filter((l) => order1.includes(l));
  ok("G2 le brouillon du site a le même ordre", JSON.stringify(stored) === JSON.stringify(order1), JSON.stringify(draftSocials()));
  f = await openEditor();
  await footerEnd(f);
  const order2 = await labelsOnCanvas(f);
  ok("G3 après rechargement de l'éditeur, l'ordre est gardé", JSON.stringify(order2) === JSON.stringify(order1), `${JSON.stringify(order1)} → ${JSON.stringify(order2)}`);
} catch (e) {
  ok("G section interrompue", false, String(e.message).split("\n")[0]);
}

/* ---- M. 390 px ---------------------------------------------------------------------------------------------------------------- */
if (run("M")) try {
  await page.setViewportSize({ width: 390, height: 844 });
  await sleep(1500);
  f = await canvas(page);
  await footerEnd(f);
  const inner = await f.evaluate(() => document.documentElement.clientWidth);
  info(`largeur de la toile : ${inner}`);
  let allIn = true;
  let worst = "";
  const labels = await labelsOnCanvas(f);
  for (const label of labels) {
    const l = linkOf(label);
    await l.scrollIntoViewIfNeeded();
    const b = await l.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
    await tools(f).waitFor({ timeout: 10000 });
    const r = await tools(f).evaluate((el) => {
      const x = el.getBoundingClientRect();
      return { left: x.left, right: x.right, w: document.documentElement.clientWidth };
    });
    if (r.left < 0 || r.right > r.w + 0.5) {
      allIn = false;
      worst = JSON.stringify({ label, ...r });
    }
    await footerShot(f, `M-390-${label}.png`);
  }
  ok("M1 à 390 px, la barre (poignée comprise) reste dans la fenêtre pour chaque réseau", allIn && labels.length > 0, worst);
  const sw = await f.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok("M2 à 390 px, la page ne déborde pas à l'horizontale", sw <= 1, `${sw} px`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await sleep(1500);
  f = await canvas(page);
} catch (e) {
  ok("M section interrompue", false, String(e.message).split("\n")[0]);
}

/* ---- E. En édition, aucun lien n'ouvre quoi que ce soit ---------------------------------------------------------------------- */
if (run("E")) try {
  await footerEnd(f);
  // Observateur posé APRÈS la couche d'édition (même nœud, même phase : il passe après elle) : il voit si l'action par défaut a été annulée.
  await f.evaluate(() => {
    window.__lk = [];
    window.__open = [];
    const o = window.open;
    window.open = (...a) => {
      window.__open.push(String(a[0]));
      return null;
    };
    void o;
    for (const t of ["click", "auxclick"]) document.addEventListener(t, (e) => {
      const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (a) window.__lk.push({ t, href: a.getAttribute("href"), dp: e.defaultPrevented });
    }, true);
    // Lien tel: de contrôle, posé dans le pied.
    const tel = document.createElement("a");
    tel.href = "tel:+000000000";
    tel.id = "tel-test";
    tel.textContent = "Appel d'essai";
    tel.style.cssText = "display:inline-block;padding:6px 10px";
    document.querySelector("footer .shell")?.appendChild(tel);
  });
  const lk = () => f.evaluate(() => window.__lk.splice(0));
  const navN = navs.length;
  const popN = popups.length;
  const email = f.locator('footer [data-site-inline="email"]');
  const notOpened = (rows, href) => rows.length > 0 && rows.filter((r) => r.href === href || href === "*").every((r) => r.dp === true);

  // 1. Clic simple sur l'adresse (hors saisie).
  await email.scrollIntoViewIfNeeded();
  await email.click();
  let rows = await lk();
  ok("E1 clic sur l'adresse e-mail (hors saisie) : mailto: annulé", rows.some((r) => r.href === `mailto:${EMAIL}`) && notOpened(rows, `mailto:${EMAIL}`), JSON.stringify(rows));
  // 2. Double-clic : la saisie démarre ; puis clics DANS le texte en cours de modification (le cas du retour de l'artiste).
  await page.keyboard.press("Escape");
  await email.dblclick();
  await sleep(300);
  await lk();
  const editing = await f.evaluate(() => document.activeElement?.getAttribute("data-site-inline") === "email" || document.activeElement?.closest?.("[data-site-inline='email']") !== null);
  ok("E2 le double-clic démarre la saisie dans l'adresse", editing);
  const eb = await email.boundingBox();
  await page.mouse.click(eb.x + eb.width * 0.25, eb.y + eb.height / 2);
  await page.mouse.click(eb.x + eb.width * 0.7, eb.y + eb.height / 2);
  rows = await lk();
  ok("E3 clics dans l'adresse PENDANT la saisie : mailto: annulé à chaque clic", rows.length >= 2 && notOpened(rows, `mailto:${EMAIL}`), JSON.stringify(rows));
  const stillEditing = await f.evaluate(() => Boolean(document.activeElement?.closest?.("[data-site-inline='email']")));
  ok("E4 le clic modifie le texte : la saisie continue (curseur dans l'adresse)", stillEditing);
  await page.keyboard.press("End");
  await page.keyboard.type("x");
  ok("E5 la frappe va dans l'adresse", ((await email.textContent()) ?? "").endsWith("x"), (await email.textContent()) ?? "");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Enter");
  await rest();
  // 3. Réseaux : clic gauche, clic du milieu.
  for (const label of [A, B]) {
    const l = linkOf(label);
    const href = await l.getAttribute("href");
    await l.scrollIntoViewIfNeeded();
    await lk();
    await l.click();
    rows = await lk();
    ok(`E6 clic sur « ${label} » : lien annulé`, rows.length >= 1 && notOpened(rows, href), JSON.stringify(rows));
    await l.click({ button: "middle" });
    rows = await lk();
    ok(`E7 clic du milieu sur « ${label} » : lien annulé`, rows.length >= 1 && rows.every((r) => r.dp === true), JSON.stringify(rows));
    await l.focus();
    await page.keyboard.press("Enter");
    rows = await lk();
    ok(`E8 touche Entrée sur « ${label} » : lien annulé`, rows.every((r) => r.dp === true), JSON.stringify(rows));
    await page.keyboard.press("Escape");
  }
  // 4. tel:
  await f.locator("#tel-test").click();
  rows = await lk();
  ok("E9 lien tel: : action annulée", rows.length >= 1 && notOpened(rows, "tel:+000000000"), JSON.stringify(rows));
  await sleep(500);
  ok("E10 aucune navigation (éditeur, toile)", navs.length === navN, JSON.stringify(navs.slice(navN)));
  ok("E11 aucun nouvel onglet", popups.length === popN, JSON.stringify(popups.slice(popN)));
  ok("E12 aucun window.open", (await f.evaluate(() => window.__open)).length === 0, JSON.stringify(await f.evaluate(() => window.__open)));
  await f.evaluate(() => document.getElementById("tel-test")?.remove());
  ok("E13 l'adresse reste « " + EMAIL + " » après ces clics", ((await email.textContent()) ?? "").trim() === EMAIL, (await email.textContent()) ?? "");
} catch (e) {
  ok("E section interrompue", false, String(e.message).split("\n")[0]);
}

/* ---- P. Site public ----------------------------------------------------------------------------------------------------------- */
if (run("P")) try {
  const wantOrder = draftSocials().filter((l) => l === A || l === B);
  await page.getByRole("button", { name: "Publier", exact: true }).click();
  const confirm = page.locator("dialog[open]").getByRole("button", { name: "Mettre en ligne" });
  if (await confirm.waitFor({ timeout: 4000 }).then(() => true, () => false)) await confirm.click();
  ok("P0 publication", await waitFor(() => q1("select draft from pages where id = ?", pageId)?.draft === null, 120000));
  await sleep(1500);
  const pub = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // Aucun accès au vrai réseau : les profils fictifs sont servis par un bouchon.
  await pub.route(/instagram\.com|behance\.net/, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>profil</title><p>profil fictif</p>" }));
  const pp = await pub.newPage();
  const html = async () => pp.content();
  await pp.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  ok("P1 public : aucun repère d'édition", !/data-edit-|data-social-index|pe-item-tools/.test(await html()));
  const mail = pp.locator("footer a[href^='mailto:']").first();
  ok("P2 public : l'adresse garde son lien mailto:", (await mail.getAttribute("href")) === `mailto:${EMAIL}`, (await mail.getAttribute("href")) ?? "absent");
  ok("P3 public : l'adresse est affichée", ((await mail.textContent()) ?? "").replace(/\s/g, "") === EMAIL, (await mail.textContent()) ?? "");
  const links = pp.locator("footer .social-link");
  const shown = await links.evaluateAll((els) => els.map((a) => ({ label: a.textContent.trim(), href: a.getAttribute("href"), target: a.getAttribute("target"), rel: a.getAttribute("rel") })));
  const insta = shown.find((s) => s.label === A);
  const behance = shown.find((s) => s.label === B);
  ok("P4 public : Instagram garde son href, target _blank, rel noopener noreferrer me", insta?.href === INSTA && insta.target === "_blank" && insta.rel === "noopener noreferrer me", JSON.stringify(insta));
  ok("P5 public : Behance garde son href", behance?.href === BEHANCE, JSON.stringify(behance));
  const published = shown.map((s) => s.label).filter((l) => l === A || l === B);
  ok("P6 public : ordre des réseaux = ordre choisi en édition", published.length === 2 && JSON.stringify(published) === JSON.stringify(wantOrder), `${JSON.stringify(published)} ≠ ${JSON.stringify(wantOrder)}`);
  // Les clics ne sont PAS empêchés.
  await pp.evaluate(() => {
    window.__dp = [];
    window.addEventListener("click", (e) => {
      const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (a) window.__dp.push({ href: a.getAttribute("href"), dp: e.defaultPrevented });
    });
  });
  await mail.scrollIntoViewIfNeeded();
  await mail.click({ noWaitAfter: true });
  let dp = await pp.evaluate(() => window.__dp.splice(0));
  ok("P7 public : clic sur l'e-mail, defaultPrevented faux", dp.length === 1 && dp[0].href === `mailto:${EMAIL}` && dp[0].dp === false, JSON.stringify(dp));
  const popup = pub.waitForEvent("page", { timeout: 15000 }).catch(() => null);
  await links.filter({ hasText: A }).first().click();
  const np = await popup;
  dp = await pp.evaluate(() => window.__dp.splice(0));
  ok("P8 public : clic sur Instagram, defaultPrevented faux", dp.length === 1 && dp[0].dp === false, JSON.stringify(dp));
  ok("P9 public : Instagram s'ouvre dans un nouvel onglet vers le profil", Boolean(np) && (await np.evaluate(() => location.href).catch(() => "")).startsWith("https://www.instagram.com/exemple.test"), np ? np.url() : "aucun onglet");
  await np?.close();
  await pp.screenshot({ path: path.join(SHOTS, "P-public-pied.png"), clip: await pp.locator("footer").boundingBox().then((b) => ({ x: 0, y: Math.max(0, b.y), width: 1440, height: Math.min(b.height, 900) })).catch(() => undefined) }).catch(() => {});
  await pub.close();
} catch (e) {
  ok("P section interrompue", false, String(e.message).split("\n")[0]);
}

ok("Z aucune erreur de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
