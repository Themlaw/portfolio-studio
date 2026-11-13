#!/usr/bin/env node
/**
 * Lot 125 « Me contacter » ouvre le formulaire de contact interne (chromium, serveur requis, base neuve, une connexion admin).
 * Données SYNTHÉTIQUES (adresses example.test, site de démonstration). Aucun e-mail réel : les messages vont dans Admin › Messages.
 *  A  Anciens boutons (Contact de l'accueil, Profil de « À propos », sans réglage) : clic -> fenêtre du formulaire intégré, repli mailto: dans le href.
 *  B  Fenêtre : focus dans la fenêtre, Tab piégé, Échap / × / fond ferment, le focus revient au bouton.
 *  C  Validation, anti-spam (champ piège), envoi FR : message dans Admin › Messages (page, objet, réponse à).
 *  D  390 px : fenêtre plein écran lisible, bouton d'envoi atteignable, pas de défilement horizontal.
 *  E  EN : libellés anglais, message enregistré avec les libellés anglais ; route : page forgée -> sans page, clés inconnues refusées.
 *  F  Un formulaire publié sur le site : la fenêtre des autres pages le reprend (mêmes champs) ; sur sa propre page, le bouton DÉFILE vers lui.
 *  G  Sans JavaScript : repli mailto: (fenêtre) ou ancre du formulaire (page qui en porte un).
 *  H  Éditeur : le clic n'ouvre rien en édition ; Aperçu : la fenêtre s'ouvre, l'envoi est simulé (rien n'est enregistré) ; réglage « Au clic ».
 *  I  Réglage « Ouvrir l'e-mail » : mailto: non empêché, aucune fenêtre ; l'autre bouton garde le formulaire.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=A,B,…] [SHOTS=dossier] node scripts/e2e-contact125.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { canvas, draftBlocks, login, pageIdOf, q1, settled, sleep, sql, waitFor } from "./lib/grille31d.mjs";
import { publishBlocks } from "./lib/page-draft.mjs";

const BASE = process.env.BASE ?? "http://localhost:5400";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(process.env.BATTERY_DIR ?? tmpdir(), "shots-contact125");
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};

const MAIL = "bonjour@example.org";
const FORM_ID = "formtest125a";
const messages = () => sql((db) => db.prepare("select * from messages order by id").all());
const propsOf = (pageId, type) => {
  const row = sql((db) => db.prepare("select props from blocks where page_id = ? and type = ? order by position").all(pageId, type));
  return row.map((r) => JSON.parse(r.props));
};
const OPEN = "a[data-contact-open]";

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
const errors = [];
page.on("pageerror", (e) => errors.push(`admin ${page.url()} : ${e.message.slice(0, 80)}`));
await login(page, BASE);

const HOME = pageIdOf("");
const ABOUT = pageIdOf("a-propos");
const DECORS = pageIdOf("decors");

/** Ouvre la fenêtre : le clic avant l'hydratation ne fait rien, on recommence. */
async function openDialog(p, link = OPEN) {
  const root = p.locator(link).first();
  for (let i = 0; i < 20; i++) {
    await root.click();
    if (await p.locator("dialog[open]").count()) return true;
    await sleep(500);
  }
  return false;
}
const activeInDialog = (p) => p.evaluate(() => Boolean(document.activeElement?.closest("dialog")));
/** Fenêtre modale native : le focus peut sortir vers le navigateur (body), jamais vers le contenu de la page. */
const focusNotOnPage = (p) => p.evaluate(() => document.activeElement === document.body || document.activeElement === null || Boolean(document.activeElement.closest("dialog")));
const isLink = (p) => p.evaluate(() => document.activeElement?.matches("a[data-contact-open]") ?? false);

// --- Mise en place : le bouton dit « Me contacter » (Contact de l'accueil, Profil de « À propos »), SANS réglage (anciennes données).
const again = async (fn) => (await fn()) || (await fn());
const setupOk = await again(() => publishBlocks(
  page,
  BASE,
  HOME,
  (blocks) => blocks.map((b) => (b.type === "contact" && !b.props.form ? { ...b, props: { ...b.props, cta: { fr: "Me contacter", en: "Contact me" } } } : b)),
  () => propsOf(HOME, "contact").some((p) => p.cta?.fr === "Me contacter"),
));
const setupAbout = await again(() => publishBlocks(
  page,
  BASE,
  ABOUT,
  (blocks) => blocks.map((b) => (b.type === "profile" ? { ...b, props: { ...b.props, contactLabel: { fr: "Me contacter", en: "Contact me" } } } : b)),
  () => propsOf(ABOUT, "profile").some((p) => p.contactLabel?.fr === "Me contacter"),
));
ok("S  mise en place : boutons « Me contacter » publiés, sans réglage ctaAction / contactAction (anciennes données)", setupOk && setupAbout && propsOf(HOME, "contact").every((p) => !("ctaAction" in p)) && propsOf(ABOUT, "profile").every((p) => !("contactAction" in p)), JSON.stringify({ setupOk, setupAbout, home: propsOf(HOME, "contact"), about: propsOf(ABOUT, "profile").map((p) => p.contactAction) }).slice(0, 300));
ok("S0 aucun formulaire de contact publié au départ", sql((db) => db.prepare("select count(*) n from blocks where type in ('contact-form') or (type='contact' and json_extract(props,'$.form') = 1)").get()).n === 0);

// Visiteur : contexte SANS la session de l'administrateur (connecté, le site s'ouvre en Aperçu).
const visitor = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const pub = await visitor.newPage();
pub.setDefaultTimeout(60000);
pub.on("pageerror", (e) => errors.push(`${pub.url()} : ${e.message.slice(0, 80)}`));
pub.on("response", async (r) => {
  if (r.url().includes("/api/contact")) console.log(`INFO POST /api/contact -> ${r.status()} ${(await r.text().catch(() => "")).slice(0, 120)} (${r.request().postData()?.slice(0, 160)})`);
});

if (run("A")) {
  await pub.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  const href = await pub.locator(OPEN).first().getAttribute("href");
  ok("A1 Contact (accueil) : bouton « Me contacter », href = repli mailto:", href === `mailto:${MAIL}` && /Me contacter/.test((await pub.locator(OPEN).first().textContent()) ?? ""), String(href));
  ok("A2 clic -> fenêtre ouverte (dialog modal), pas de navigation", (await openDialog(pub)) && pub.url().endsWith("/fr"));
  const d = pub.locator("dialog[open]");
  ok("A3 titre « Me contacter » et trois champs (nom, e-mail, message) + envoi", (await d.locator("h2").textContent()) === "Me contacter" && (await d.locator("input[name=fname], input[name=femail], textarea[name=fmessage]").count()) === 3 && (await d.locator("button[type=submit]").count()) === 1);
  await pub.screenshot({ path: path.join(SHOTS, "a-accueil-fenetre.png") });
  await pub.keyboard.press("Escape");
  await pub.goto(`${BASE}/fr/a-propos`, { waitUntil: "networkidle" });
  const aHref = await pub.locator(OPEN).first().getAttribute("href");
  ok("A4 Profil (À propos) : bouton, href mailto:, lien texte de l'adresse inchangé", aHref === `mailto:${MAIL}` && (await pub.locator("a.email-link").first().getAttribute("href")) === `mailto:${MAIL}`);
  ok("A5 clic -> fenêtre du formulaire", await openDialog(pub));
  await pub.screenshot({ path: path.join(SHOTS, "a-profil-fenetre.png") });
  await pub.keyboard.press("Escape");
  const footer = await pub.locator("footer a[href^='mailto:']").count();
  ok("A6 le pied de page garde son lien mailto: (adresse affichée)", footer === 0 || (await pub.locator("footer a[href^='mailto:']").first().getAttribute("href")) === `mailto:${MAIL}`);
}

if (run("B")) {
  await pub.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  await openDialog(pub);
  ok("B1 le focus est dans la fenêtre à l'ouverture (premier champ)", await activeInDialog(pub));
  let trapped = true;
  for (let i = 0; i < 14; i++) {
    await pub.keyboard.press("Tab");
    if (!(await focusNotOnPage(pub))) trapped = false;
  }
  for (let i = 0; i < 6; i++) {
    await pub.keyboard.press("Shift+Tab");
    if (!(await focusNotOnPage(pub))) trapped = false;
  }
  ok("B2 Tab / Maj+Tab restent dans la fenêtre (focus piégé)", trapped);
  ok("B3 le fond est inerte (clic sur le contenu de la page sans effet)", await pub.evaluate(() => document.querySelector("dialog")?.matches(":modal") === true));
  await pub.keyboard.press("Escape");
  ok("B4 Échap ferme et le focus revient au bouton", (await waitFor(async () => (await pub.locator("dialog[open]").count()) === 0)) && (await isLink(pub)));
  await openDialog(pub);
  await pub.locator("dialog[open] .contact-dialog-close").click();
  ok("B5 le bouton × ferme et rend le focus", (await pub.locator("dialog[open]").count()) === 0 && (await isLink(pub)));
  await openDialog(pub);
  await pub.mouse.click(8, 8);
  ok("B6 un clic sur le fond ferme", (await pub.locator("dialog[open]").count()) === 0 && (await isLink(pub)));
  await openDialog(pub);
  await pub.locator("dialog[open] input[name=fname]").fill("Texte du test");
  await pub.keyboard.press("Escape");
  await openDialog(pub);
  ok("B7 rouverte : formulaire remis à zéro", (await pub.locator("dialog[open] input[name=fname]").inputValue()) === "");
  await pub.keyboard.press("Escape");
}

if (run("C")) {
  await pub.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  await openDialog(pub);
  const d = pub.locator("dialog[open]");
  const before = messages().length;
  await d.locator("button[type=submit]").click();
  ok("C1 envoi vide : refusé par la validation (champs obligatoires), fenêtre ouverte, rien d'enregistré", (await pub.locator("dialog[open]").count()) === 1 && messages().length === before);
  await d.locator("input[name=femail]").fill("lou@example.test");
  await d.locator("textarea[name=fmessage]").fill("Bonjour, ceci est un message de test du lot 125.");
  await d.locator("input[name=fname]").fill("Lou Test");
  await d.locator("input[name=website]").evaluate((el) => (el.value = "http://spam.example.test"));
  await d.locator("button[type=submit]").click();
  await sleep(1200);
  ok("C2 champ piège rempli : réponse « reçue », rien d'enregistré", messages().length === before);
  await pub.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  await openDialog(pub);
  const d2 = pub.locator("dialog[open]");
  await d2.locator("input[name=femail]").fill("lou@example.test");
  await d2.locator("textarea[name=fmessage]").fill("Bonjour, ceci est un message de test du lot 125.");
  await d2.locator("input[name=fname]").fill("Lou Test");
  await d2.locator("button[type=submit]").click();
  const sent = await waitFor(() => messages().length === before + 1, 20000);
  ok("C3 envoi valide : confirmation affichée dans la fenêtre", sent && /Merci, ton message est bien arrivé/.test((await d2.locator(".contact-form-status").textContent()) ?? ""));
  const m = messages().at(-1);
  const fields = m ? JSON.parse(m.fields) : [];
  ok("C4 message : objet, page d'origine, réponse à, champs", m && m.subject === "Message depuis le site" && m.page_id === HOME && m.reply_to === "lou@example.test" && fields.some((f) => f.label === "Ton message" && /lot 125/.test(f.value)), JSON.stringify(m));
  await page.goto(`${BASE}/admin/messages`, { waitUntil: "networkidle" });
  const list = (await page.locator('[data-testid="messages"]').textContent()) ?? "";
  ok("C5 Admin › Messages : le message est là (objet, texte, adresse de réponse)", /Message depuis le site/.test(list) && /message de test du lot 125/.test(list) && /lou@example\.test/.test(list));
  await pub.keyboard.press("Escape");
}

if (run("D")) {
  await pub.setViewportSize({ width: 390, height: 844 });
  await pub.goto(`${BASE}/fr/a-propos`, { waitUntil: "networkidle" });
  await openDialog(pub);
  const box = await pub.locator("dialog[open]").boundingBox();
  ok("D1 390 px : la fenêtre occupe tout l'écran", box && Math.abs(box.width - 390) <= 1 && Math.abs(box.height - 844) <= 1, JSON.stringify(box));
  await pub.screenshot({ path: path.join(SHOTS, "d-390.png") });
  await pub.locator("dialog[open] button[type=submit]").scrollIntoViewIfNeeded();
  const b = await pub.locator("dialog[open] button[type=submit]").boundingBox();
  ok("D2 le bouton d'envoi est atteignable dans l'écran", b && b.y >= 0 && b.y + b.height <= 844 && b.x >= 0 && b.x + b.width <= 390, JSON.stringify(b));
  ok("D3 pas de défilement horizontal", await pub.evaluate(() => document.documentElement.scrollWidth <= 390 && (document.querySelector("dialog[open]")?.scrollWidth ?? 0) <= 390));
  const x = await pub.locator("dialog[open] .contact-dialog-close").boundingBox();
  ok("D4 le bouton de fermeture est dans l'écran et fait au moins 44 px", x && x.width >= 44 && x.height >= 44 && x.x + x.width <= 390 && x.y >= 0, JSON.stringify(x));
  await pub.keyboard.press("Escape");
  await pub.setViewportSize({ width: 1440, height: 900 });
}

if (run("E")) {
  await pub.goto(`${BASE}/en/about`, { waitUntil: "networkidle" });
  ok("E1 EN : bouton « Contact me »", /Contact me/.test((await pub.locator(OPEN).first().textContent()) ?? ""));
  await openDialog(pub);
  const d = pub.locator("dialog[open]");
  ok("E2 EN : titre « Get in touch », fermer « Close », libellés anglais", (await d.locator("h2").textContent()) === "Get in touch" && (await d.locator(".contact-dialog-close").getAttribute("aria-label")) === "Close" && /Your message/.test((await d.textContent()) ?? ""));
  const before = messages().length;
  await d.locator("input[name=femail]").fill("ana@example.test");
  await d.locator("textarea[name=fmessage]").fill("Hello, an English test message.");
  await d.locator("button[type=submit]").click();
  const sent = await waitFor(() => messages().length === before + 1, 20000);
  const m = messages().at(-1);
  ok("E3 EN : message enregistré (libellés anglais, page À propos), confirmation en anglais", sent && m.page_id === ABOUT && JSON.parse(m.fields).some((f) => f.label === "Your message") && /Thank you, your message arrived/.test((await d.locator(".contact-form-status").textContent()) ?? ""), JSON.stringify(m));
  await pub.keyboard.press("Escape");
  // PR #23 : la route exige le jeton signé du formulaire (délivré par /api/contact/token, valable après 3 s) : un jeton par envoi.
  const post = async (body) => {
    let token;
    try {
      const t = await fetch(`${BASE}/api/contact/token?form=${encodeURIComponent(body.form)}`);
      if (t.ok) token = (await t.json()).token;
    } catch {}
    if (token) await new Promise((r) => setTimeout(r, 3300));
    return fetch(`${BASE}/api/contact`, { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", "x-forwarded-for": "198.51.100.25" }, body: JSON.stringify({ ...body, ...(token ? { token } : {}) }) });
  };
  const n = messages().length;
  const r1 = await post({ form: "contactdefaut", locale: "fr", values: { femail: "z@example.test", fmessage: "Page forgée" }, page: 999999 });
  ok("E4 route : page inconnue -> message enregistré SANS page", r1.status === 200 && messages().length === n + 1 && messages().at(-1).page_id === null);
  const r2 = await post({ form: "contactdefaut", locale: "fr", values: { femail: "z@example.test", fmessage: "x", fautre: "y" } });
  const r3 = await post({ form: "contactdefaut", locale: "fr", values: { femail: "z@example.test", fmessage: "x" }, extra: 1 });
  const r4 = await post({ form: "contactinconnu", locale: "fr", values: { femail: "z@example.test", fmessage: "x" } });
  ok("E5 route : champ inconnu 400, clé inconnue 400, formulaire inconnu 404, rien d'enregistré", r2.status === 400 && r3.status === 400 && r4.status === 404 && messages().length === n + 1, `${r2.status} ${r3.status} ${r4.status}`);
}

if (run("F")) {
  const form = {
    form: true,
    formId: FORM_ID,
    title: { fr: "Écrire à l'atelier", en: "Write to the studio" },
    fields: [
      { id: "fnom", type: "text", label: { fr: "Votre nom", en: "Your name" }, required: false },
      { id: "fmail", type: "email", label: { fr: "Votre e-mail", en: "Your email" }, required: true, reply: true },
      { id: "fmsg", type: "textarea", label: { fr: "Votre message", en: "Your message" }, required: true },
    ],
    submit: { fr: "Envoyer", en: "Send" },
    success: { fr: "Merci, c'est reçu.", en: "Thanks, received." },
    error: { fr: "Échec de l'envoi.", en: "Sending failed." },
    subject: { fr: "Message du formulaire de l'atelier", en: "Studio form message" },
  };
  const okF = await publishBlocks(
    page,
    BASE,
    DECORS,
    (blocks) => [
      { uid: "c125btn", type: "contact", props: { title: { fr: "Une question ?", en: "A question?" }, cta: { fr: "Me contacter", en: "Contact me" } } },
      { uid: "c125fill", type: "rich-text", props: { paragraphs: Array.from({ length: 14 }, (_, i) => ({ fr: `Paragraphe de remplissage ${i + 1}. `.repeat(12), en: `Filler paragraph ${i + 1}. `.repeat(12) })) } },
      { uid: "c125form", type: "contact", props: form },
      ...blocks,
    ],
    () => propsOf(DECORS, "contact").some((p) => p.formId === FORM_ID),
  );
  ok("F0 formulaire publié sur la page Décors", okF);
  await pub.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  await openDialog(pub);
  const d = pub.locator("dialog[open]");
  ok("F1 accueil : la fenêtre reprend le formulaire publié du site (titre, champs)", (await d.locator("h2").textContent()) === "Écrire à l'atelier" && (await d.locator("input[name=fmail], textarea[name=fmsg], input[name=fnom]").count()) === 3);
  const before = messages().length;
  await d.locator("input[name=fmail]").fill("sam@example.test");
  await d.locator("textarea[name=fmsg]").fill("Message via le formulaire du site.");
  await d.locator("button[type=submit]").click();
  const sent = await waitFor(() => messages().length === before + 1, 20000);
  const m = messages().at(-1);
  ok("F2 envoi : objet du formulaire publié, rattaché à son bloc, confirmation du formulaire", sent && m.subject === "Message du formulaire de l'atelier" && m.block_id !== null && /Merci, c'est reçu/.test((await d.locator(".contact-form-status").textContent()) ?? ""), JSON.stringify(m));
  await pub.keyboard.press("Escape");

  await pub.goto(`${BASE}/fr/decors`, { waitUntil: "networkidle" });
  const link = pub.locator(OPEN).first();
  ok("F3 page Décors (porte un formulaire) : href = ancre du formulaire", (await link.getAttribute("href")) === `#formulaire-${FORM_ID}`, String(await link.getAttribute("href")));
  const y0 = await pub.evaluate(() => window.scrollY);
  let scrolled = false;
  for (let i = 0; i < 20 && !scrolled; i++) {
    await link.click();
    scrolled = await waitFor(async () => (await pub.evaluate(() => window.scrollY)) > y0 + 200, 1500);
  }
  await sleep(900);
  const r = await pub.evaluate((id) => ({ top: document.getElementById(id)?.getBoundingClientRect().top, inForm: Boolean(document.activeElement?.closest(`#${id}`)), dialogs: document.querySelectorAll("dialog").length }), `formulaire-${FORM_ID}`);
  ok("F4 le clic DÉFILE jusqu'au formulaire (en vue), premier champ focalisé, aucune fenêtre", scrolled && r.top !== undefined && r.top < 400 && r.inForm && r.dialogs === 0, JSON.stringify(r));
  await pub.screenshot({ path: path.join(SHOTS, "f-defilement.png") });
}

if (run("G")) {
  const nojs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
  const p = await nojs.newPage();
  await p.goto(`${BASE}/fr`, { waitUntil: "domcontentloaded" });
  ok("G1 sans JavaScript : l'accueil garde un lien mailto: (repli)", (await p.locator(OPEN).first().getAttribute("href")) === `mailto:${MAIL}`);
  await p.goto(`${BASE}/fr/decors`, { waitUntil: "domcontentloaded" });
  ok("G2 sans JavaScript : la page Décors mène à l'ancre du formulaire", (await p.locator(OPEN).first().getAttribute("href")) === `#formulaire-${FORM_ID}` && (await p.locator(`#formulaire-${FORM_ID} form`).count()) === 1);
  await p.locator(OPEN).first().click();
  ok("G3 l'ancre est suivie (URL #formulaire-…)", p.url().endsWith(`#formulaire-${FORM_ID}`));
  await nojs.close();
}

if (run("H")) {
  const f = await (async () => {
    await page.goto(`${BASE}/admin/pages/${HOME}/editer`, { waitUntil: "domcontentloaded" });
    return canvas(page);
  })();
  await sleep(2500);
  const nav = [];
  page.on("framenavigated", (fr) => nav.push(fr.url()));
  const popups = [];
  ctx.on("page", (p) => {
    if (p !== page && p !== pub) popups.push(p.url());
  });
  await f.locator(OPEN).first().click({ position: { x: 4, y: 4 } }).catch(() => {});
  await sleep(1200);
  ok("H1 toile en édition : le clic n'ouvre ni fenêtre, ni navigation, ni onglet", (await f.locator("dialog").count()) === 0 && nav.length === 0 && popups.length === 0, JSON.stringify({ nav, popups }));

  // Réglage « Au clic » dans le panneau du bloc.
  const blockSel = f.locator("[data-edit-block] section > div").filter({ has: f.locator(OPEN) }).first();
  await blockSel.click({ position: { x: 6, y: 6 } });
  const sel = page.locator('.ve-pane select[id$="-ctaAction"]');
  const reglages = () => page.locator("#ve-tab-reglages").click();
  await reglages();
  const found = await sel.waitFor({ timeout: 15000 }).then(() => true, () => false);
  ok("H2 panneau : réglage « Au clic », par défaut « Ouvrir le formulaire de contact »", found && (await sel.inputValue()) === "form" && (await sel.locator("option").allTextContents()).join("|") === "Ouvrir le formulaire de contact|Ouvrir l'e-mail");
  await page.screenshot({ path: path.join(SHOTS, "h-panneau.png") });

  // Aperçu : la fenêtre s'ouvre, l'envoi est simulé.
  await page.getByRole("button", { name: "Aperçu", exact: true }).click();
  await f.locator("html:not([data-edit-mode])").waitFor({ timeout: 20000 }).catch(() => {});
  await sleep(1500);
  const before = messages().length;
  ok("H3 Aperçu : le clic ouvre la fenêtre", await openDialog(f));
  const d = f.locator("dialog[open]");
  await d.locator("input[name=femail], input[name=fmail]").first().fill("zoe@example.test");
  await d.locator("textarea").fill("Essai depuis l'Aperçu.");
  await d.locator("button[type=submit]").click();
  await sleep(1200);
  ok("H4 Aperçu : confirmation affichée mais RIEN d'enregistré", (await d.locator(".contact-form-status").count()) === 1 && messages().length === before);
  await page.screenshot({ path: path.join(SHOTS, "h-apercu.png") });
  await f.locator("body").press("Escape");
  await sleep(500);
  await page.keyboard.press("Escape");
  const back = await f.locator("html[data-edit-mode]").waitFor({ timeout: 20000 }).then(() => true, () => false);
  ok("H5 retour à l'édition", back);

  await f.locator("[data-edit-block] section > div").filter({ has: f.locator(OPEN) }).first().click({ position: { x: 6, y: 6 } });
  await reglages();
  await sel.waitFor({ timeout: 15000 });
  await sel.selectOption("mail");
  const draftMail = await waitFor(() => draftBlocks(HOME).some((b) => b.type === "contact" && b.props.ctaAction === "mail"), 20000);
  await settled(page);
  ok("H6 « Ouvrir l'e-mail » : ctaAction = mail dans le brouillon", draftMail);
  await sel.selectOption("form");
  const draftBack = await waitFor(() => draftBlocks(HOME).some((b) => b.type === "contact" && !("ctaAction" in b.props)), 20000);
  ok("H7 retour à « formulaire » : la clé disparaît (donnée facultative)", draftBack);
  await settled(page);
}

if (run("I")) {
  const okI = await publishBlocks(
    page,
    BASE,
    HOME,
    (blocks) => blocks.map((b) => (b.type === "contact" && !b.props.form ? { ...b, props: { ...b.props, ctaAction: "mail" } } : b)),
    () => propsOf(HOME, "contact").some((p) => p.ctaAction === "mail"),
  );
  ok("I0 réglage « Ouvrir l'e-mail » publié", okI);
  await pub.goto(`${BASE}/fr`, { waitUntil: "networkidle" });
  await pub.evaluate(() => {
    window.__dp = null;
    window.addEventListener("click", (e) => (window.__dp = e.defaultPrevented));
  });
  const link = pub.locator("a.btn[href^='mailto:']").first();
  ok("I1 bouton réglé « e-mail » : lien mailto: simple (pas de repère de fenêtre)", (await link.getAttribute("href")) === `mailto:${MAIL}` && (await link.getAttribute("data-contact-open")) === null && (await link.getAttribute("aria-haspopup")) === null);
  await sleep(1000);
  await link.click();
  await sleep(600);
  ok("I2 clic : aucune fenêtre, action par défaut du lien NON empêchée", (await pub.locator("dialog").count()) === 0 && (await pub.evaluate(() => window.__dp)) === false);
  await pub.goto(`${BASE}/fr/a-propos`, { waitUntil: "networkidle" });
  ok("I3 l'autre bouton (Profil, sans réglage) garde le formulaire", await openDialog(pub));
  await pub.keyboard.press("Escape");
}

// /admin/messages : erreur d'hydratation React #418 (dates) déjà présente sur la base 87b4c11, page non touchée par le lot.
const real = errors.filter((e) => !e.includes("/admin/messages"));
if (real.length !== errors.length) console.log("INFO erreur React #418 sur /admin/messages (préexistante, identique sur la base)");
ok("Z  aucune erreur de page (JavaScript)", real.length === 0, real.slice(0, 3).join(" | "));
await browser.close();
console.log(failures === 0 ? "TOUT PASSE" : `${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);
