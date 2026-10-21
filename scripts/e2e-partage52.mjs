#!/usr/bin/env node
/**
 * Lot 52 « partage, référencement, descriptions d'images, messages » (ticket 38). Chromium, serveur requis, base neuve.
 *  PT  Réglages « Partage et moteurs de recherche » : description du site, image de partage, icône (déclinée en tailles) ;
 *      balises og:* / twitter:card / titre « Page — Nom du site » en public, image de la page puis du site, hreflang.
 *  SM  sitemap.xml (pages publiées, toutes langues, hreflang) et robots.txt qui le cite.
 *  AL  Description des images : champ visible dans la médiathèque et au choix ; avertissement NON bloquant à la publication
 *      (liste, lien) ; bouton « Agrandir l'image » annoncé avec la description ou le titre, jamais la date.
 *  TR  Page non traduite : pastille dans la liste des pages et avertissement à la publication.
 *  MS  Messages : pastille du menu, carte du tableau de bord, ligne « Les messages arrivent ici », retour à zéro après la visite.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=PT,SM] [SHOTS=dossier] node scripts/e2e-partage52.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";
import sharp from "sharp";

import { publishBlocks } from "./lib/page-draft.mjs";
import { login, pageIdOf } from "./lib/medias-setup.mjs";

const BASE = process.env.BASE ?? "http://localhost:3650";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const SHOTS = process.env.SHOTS ?? path.join(tmpdir(), "e2e-partage52");
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
const section = async (name, fn) => {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 8).join(" "));
    await page.screenshot({ path: path.join(SHOTS, `erreur-${name}.png`) }).catch(() => {});
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

/** Corps HTML d'une page publique (sans cookie : comme un robot de réseau social). */
async function html(url) {
  const res = await fetch(`${BASE}${url}`, { headers: { "user-agent": "e2e-partage52" } });
  return { status: res.status, text: await res.text(), type: res.headers.get("content-type") ?? "" };
}
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
/** Valeur du contenu d'une balise <meta property|name=…>, ou null. */
function meta(text, key) {
  for (const tag of text.match(/<meta\s[^>]*>/g) ?? []) {
    const k = /(?:property|name)="([^"]+)"/.exec(tag)?.[1];
    if (k === key) return decode(/content="([^"]*)"/.exec(tag)?.[1] ?? "");
  }
  return null;
}
const titleOf = (text) => decode(/<title>([^<]*)<\/title>/.exec(text)?.[1] ?? "");

async function upload(name, buffer) {
  const res = await ctx.request.post(`${BASE}/admin/api/upload`, { multipart: { file: { name, mimeType: "image/png", buffer } }, headers: { origin: BASE } });
  const body = await res.json();
  if (!body.ok) throw new Error(`envoi refusé : ${JSON.stringify(body)}`);
  return body.media.id;
}
const png = (w, h, rgb) => sharp({ create: { width: w, height: h, channels: 3, background: rgb } }).png().toBuffer();
const mediaReady = async (id) => {
  for (const end = Date.now() + 120000; Date.now() < end; await sleep(500)) {
    if (sql((db) => db.prepare("select status from media where id = ?").get(id))?.status === "ready") return true;
  }
  return false;
};
const siteNameFr = () => {
  const v = JSON.parse(sql((db) => db.prepare("select value from settings where key = 'site'").get())?.value ?? "{}").name;
  return typeof v === "string" ? v : (v?.fr ?? "");
};

/** Choisit une image dans la boîte « Choisir une image » ouverte par le n-ième bouton de la zone. */
async function pickImage(zone, nth, mediaName) {
  await zone.getByRole("button", { name: /Choisir une image|Changer d'image/ }).nth(nth).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator(`.a-media-tile[title="${mediaName}"]`).click();
  await dialog.getByRole("button", { name: "Utiliser cette image" }).click();
  await dialog.waitFor({ state: "hidden" });
}
const saved = async (scope) => scope.getByText("Enregistré", { exact: false }).first().waitFor({ timeout: 30000 });

const SHARE_NAME = `partage52-${Date.now()}.png`;
const ICON_NAME = `icone52-${Date.now()}.png`;
let shareId = 0;
let iconId = 0;

/* ---------------------------------------------------------------- PT */
if (run("PT") || run("SM")) await section("PT", async () => {
  const site = siteNameFr();
  info("nom du site", site);
  // Avant tout réglage : un titre « Page — Nom du site », des balises de partage, pas d'icône personnalisée.
  const before = await html("/fr/a-propos");
  ok("PT1 titre d'onglet « Page — Nom du site »", titleOf(before.text).endsWith(` — ${site}`) && titleOf(before.text).length > site.length + 3, titleOf(before.text));
  ok("PT1 og:title, og:type, og:site_name, twitter:card présents", Boolean(meta(before.text, "og:title")) && meta(before.text, "og:type") === "website" && meta(before.text, "og:site_name") === site && Boolean(meta(before.text, "twitter:card")), `${meta(before.text, "og:title")}|${meta(before.text, "og:type")}|${meta(before.text, "twitter:card")}`);
  ok("PT1 og:url est celle de la page et og:locale suit la langue", /\/fr\/a-propos$/.test(meta(before.text, "og:url") ?? "") && meta(before.text, "og:locale") === "fr_FR", `${meta(before.text, "og:url")} ${meta(before.text, "og:locale")}`);
  const home = await html("/fr");
  ok("PT1 l'accueil s'intitule du seul nom du site (pas de doublon)", titleOf(home.text) === site || titleOf(home.text).startsWith(site), titleOf(home.text));
  const fav = await fetch(`${BASE}/favicon.ico`);
  ok("PT1 pas d'icône choisie : aucune balise /site-icon, /favicon.ico répond", !/<link[^>]*site-icon/.test(before.text) && fav.status === 200, `${fav.status} ${before.text.match(/<link[^>]*icon[^>]*>/g)?.join(" ") ?? "aucune balise"}`);

  shareId = await upload(SHARE_NAME, await png(1200, 630, { r: 200, g: 80, b: 60 }));
  iconId = await upload(ICON_NAME, await png(600, 600, { r: 30, g: 120, b: 220 }));
  ok("PT2 images de test prêtes", (await mediaReady(shareId)) && (await mediaReady(iconId)));

  await page.goto(`${BASE}/admin/reglages`, { waitUntil: "networkidle" });
  const form = page.getByTestId("seo-form");
  await form.waitFor();
  ok("PT2 section « Partage et moteurs de recherche » dans les réglages", await form.getByRole("heading", { name: "Partage et moteurs de recherche" }).isVisible());
  await form.getByRole("textbox", { name: "Description du site" }).fill("Illustratrice et character designer : projets, décors et animation.");
  await pickImage(form, 0, SHARE_NAME);
  await pickImage(form, 1, ICON_NAME);
  ok("PT2 l'aperçu du lien partagé montre l'image choisie", (await form.getByTestId("share-preview").locator("img").count()) === 1);
  await page.screenshot({ path: path.join(SHOTS, "pt-reglages.png"), fullPage: true });
  await form.getByRole("button", { name: "Enregistrer" }).click();
  await saved(form);
  await sleep(1200);
  const stored = JSON.parse(sql((db) => db.prepare("select value from settings where key = 'seo'").get())?.value ?? "{}");
  ok("PT2 réglage enregistré (image, icône, description)", stored.shareImage === shareId && stored.favicon?.mediaId === iconId && /Illustratrice/.test(stored.description?.fr ?? ""), JSON.stringify(stored));

  // Public : la page sans image à elle prend la première image de son contenu, sinon celle du site ; description du site à défaut.
  await page.goto(`${BASE}/admin/pages/${pageIdOf("a-propos")}`, { waitUntil: "networkidle" });
  await page.locator("section[aria-labelledby=pe-seo]").getByRole("textbox", { name: "Description", exact: true }).fill("");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await saved(page.locator("body"));
  await sleep(1000);
  const after = await html("/fr/a-propos");
  ok("PT3 og:image est une image servie par le site", /\/media\/img\//.test(meta(after.text, "og:image") ?? ""), String(meta(after.text, "og:image")));
  ok("PT3 og:image en adresse absolue, avec largeur et hauteur", /^https?:\/\//.test(meta(after.text, "og:image") ?? "") && Number(meta(after.text, "og:image:width")) > 0 && Number(meta(after.text, "og:image:height")) > 0, `${meta(after.text, "og:image:width")}x${meta(after.text, "og:image:height")}`);
  ok("PT3 twitter:card = summary_large_image avec une image", meta(after.text, "twitter:card") === "summary_large_image" && Boolean(meta(after.text, "twitter:image")), String(meta(after.text, "twitter:card")));
  ok("PT3 page sans description : celle du site", /Illustratrice et character designer/.test(meta(after.text, "og:description") ?? "") && /Illustratrice et character designer/.test(meta(after.text, "description") ?? ""), String(meta(after.text, "og:description")));
  // Image de partage propre à la page : elle passe avant celle du site.
  const own = await upload(`page52-${Date.now()}.png`, await png(1200, 630, { r: 10, g: 160, b: 90 }));
  await mediaReady(own);
  const ownKey = sql((db) => db.prepare("select sha256 from media where id = ?").get(own))?.sha256?.slice(0, 16);
  await page.goto(`${BASE}/admin/pages/${pageIdOf("a-propos")}`, { waitUntil: "networkidle" });
  const seoPanel = page.locator("section[aria-labelledby=pe-seo]");
  await seoPanel.getByRole("textbox", { name: "Description", exact: true }).fill("Qui je suis et comment je travaille.");
  await pickImage(seoPanel, 0, sql((db) => db.prepare("select original_name from media where id = ?").get(own)).original_name);
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await saved(page.locator("body"));
  await sleep(1000);
  const pageOwn = await html("/fr/a-propos");
  ok("PT4 description de la page prioritaire", meta(pageOwn.text, "og:description") === "Qui je suis et comment je travaille.", String(meta(pageOwn.text, "og:description")));
  ok("PT4 image de la page prioritaire sur celle du site", Boolean(ownKey) && (meta(pageOwn.text, "og:image") ?? "").includes(ownKey), `${meta(pageOwn.text, "og:image")} (attendu ${ownKey})`);
  const en = await html("/en/about");
  ok("PT4 version anglaise : og:locale en_US, titre « … — nom »", meta(en.text, "og:locale") === "en_US" && / — /.test(titleOf(en.text)), `${meta(en.text, "og:locale")} ${titleOf(en.text)}`);
  ok("PT4 hreflang des deux langues dans la page", /hreflang="fr"/i.test(pageOwn.text) && /hreflang="en"/i.test(pageOwn.text));

  // Icône : balises dans <head>, chaque taille servie en PNG carré à la bonne dimension.
  ok("PT5 balises d'icône dans <head> (32, 192, apple 180)", /rel="icon"[^>]*site-icon\/32\.png/.test(pageOwn.text) || /site-icon\/32\.png[^>]*rel="icon"/.test(pageOwn.text), pageOwn.text.match(/<link[^>]*icon[^>]*>/g)?.join(" ") ?? "aucune");
  ok("PT5 balise apple-touch-icon", /apple-touch-icon|rel="apple/.test(pageOwn.text) && /site-icon\/180\.png/.test(pageOwn.text));
  for (const size of [32, 48, 180, 192, 512]) {
    const res = await fetch(`${BASE}/site-icon/${size}.png`);
    const buf = Buffer.from(await res.arrayBuffer());
    const m = res.status === 200 ? await sharp(buf).metadata() : null;
    ok(`PT5 /site-icon/${size}.png : PNG ${size} × ${size}`, res.status === 200 && res.headers.get("content-type") === "image/png" && m?.width === size && m?.height === size, `${res.status} ${m?.width}x${m?.height}`);
  }
  ok("PT5 taille inconnue : 404", (await fetch(`${BASE}/site-icon/64.png`)).status === 404 && (await fetch(`${BASE}/site-icon/..%2f32.png`)).status === 404);
});

/* ---------------------------------------------------------------- SM */
if (run("SM")) await section("SM", async () => {
  const sm = await html("/sitemap.xml");
  ok("SM1 /sitemap.xml répond en XML", sm.status === 200 && /xml/.test(sm.type), `${sm.status} ${sm.type}`);
  const locs = [...sm.text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  info("sitemap", `${locs.length} adresses`);
  ok("SM1 pages publiées dans les deux langues (accueil, À propos, About)", locs.some((l) => /\/fr$/.test(l)) && locs.some((l) => /\/en$/.test(l)) && locs.some((l) => /\/fr\/a-propos$/.test(l)) && locs.some((l) => /\/en\/about$/.test(l)), locs.join(" "));
  ok("SM1 adresses absolues", locs.every((l) => /^https?:\/\//.test(l)));
  ok("SM1 hreflang (xhtml:link) pour chaque langue", /xhtml:link[^>]*hreflang="fr"/.test(sm.text) && /xhtml:link[^>]*hreflang="en"/.test(sm.text));
  ok("SM1 aucune page d'administration ni 404 réservée", !locs.some((l) => /\/admin|_404/.test(l)));
  // Une page dépubliée disparaît du plan.
  const id = sql((db) => db.prepare("select id from pages where json_extract(slug,'$.fr') = 'animation'").get())?.id;
  await page.goto(`${BASE}/admin/pages`, { waitUntil: "networkidle" });
  const row = page.locator("tr", { hasText: "/animation" }).first();
  await row.getByRole("button", { name: /Retirer du site|Dépublier/ }).click();
  const confirm = page.getByRole("dialog");
  if (await confirm.count()) await confirm.getByRole("button", { name: /Retirer du site|Dépublier|Confirmer/ }).click();
  await sleep(1500);
  const sm2 = await html("/sitemap.xml");
  ok("SM2 une page dépubliée n'est plus dans le plan du site", !/\/fr\/animation</.test(sm2.text), `id ${id}`);
  await row.getByRole("button", { name: /Mettre en ligne|Publier/ }).click();
  await sleep(1200);
  const sm3 = await html("/sitemap.xml");
  ok("SM2 republiée, elle y revient", /\/fr\/animation</.test(sm3.text));
  const robots = await html("/robots.txt");
  ok("SM3 robots.txt cite le plan du site et garde /admin fermé", /Sitemap: https?:\/\/[^\s]+\/sitemap\.xml/i.test(robots.text) && /Disallow: \/admin/.test(robots.text), robots.text.replace(/\n/g, " | "));
});

/* ---------------------------------------------------------------- AL */
if (run("AL") || run("TR")) await section("AL", async () => {
  const a = await upload(`sans-desc-a-${Date.now()}.png`, await png(900, 600, { r: 120, g: 60, b: 160 }));
  const b = await upload(`sans-desc-b-${Date.now()}.png`, await png(900, 600, { r: 60, g: 160, b: 160 }));
  ok("AL0 images de test prêtes", (await mediaReady(a)) && (await mediaReady(b)));
  const pid = pageIdOf("a-propos");
  // Page : 2 images sans description, un texte français sans traduction.
  const done = () => sql((db) => db.prepare("select draft from pages where id = ?").get(pid))?.draft === null;
  const published = await publishBlocks(
    page,
    BASE,
    pid,
    (blocks) => [
      ...blocks.filter((x) => !String(x.uid).startsWith("al52")),
      { uid: "al52a", type: "image", props: { mediaId: a, width: "wide" } },
      { uid: "al52b", type: "image", props: { mediaId: b, width: "wide" } },
      { uid: "al52t", type: "rich-text", props: { paragraphs: [{ fr: "Un texte seulement en français.", en: "" }] } },
    ],
    done,
    120000,
  );
  ok("AL1 la publication aboutit : les avertissements ne bloquent pas", published);
  const warn = page.getByTestId("publish-warnings");
  await warn.waitFor({ timeout: 30000 });
  await page.screenshot({ path: path.join(SHOTS, "al-avertissement.png") });
  const altLine = warn.getByTestId("warn-alt");
  ok("AL2 avertissement : « 2 images sans description », avec les noms", /2 images sans description/.test((await altLine.innerText()) ?? "") && /sans-desc-a/.test(await altLine.innerText()), await altLine.innerText().catch(() => "absent"));
  ok("AL2 le message de publication reste un succès (la page est en ligne)", /Publié|C'est publié/.test((await page.locator(".ve-status").textContent()) ?? "") || (await warn.innerText()).includes("publié"));
  const link = altLine.getByRole("link", { name: "Compléter les descriptions" });
  ok("AL2 lien vers la médiathèque filtrée sur les images sans description", (await link.getAttribute("href"))?.includes("filtre=sans-description") === true, String(await link.getAttribute("href")));
  const tr = warn.getByTestId("warn-translation");
  ok("AL3 avertissement de traduction dans la même fenêtre", /n'est pas traduit en anglais|ne sont pas traduits en anglais/.test(await tr.innerText().catch(() => "")), await tr.innerText().catch(() => "absent"));

  await link.click();
  await page.waitForURL(/\/admin\/medias/);
  await page.getByTestId("alt-field").waitFor();
  const field = page.getByTestId("alt-field");
  ok("AL4 la médiathèque s'ouvre sur l'image à décrire, champ « Description de l'image » visible", await field.getByText("Description de l'image (pour les personnes malvoyantes et Google)").isVisible());
  ok("AL4 filtre « Sans description » actif, les deux images y sont", (await page.locator('.a-seg button[aria-pressed="true"]', { hasText: "Sans description" }).count()) === 1 && (await page.locator(".a-media-tile").filter({ hasText: "sans-desc-a" }).count()) === 1 && (await page.locator(".a-media-tile").filter({ hasText: "sans-desc-b" }).count()) === 1);
  await page.screenshot({ path: path.join(SHOTS, "al-mediatheque.png") });
  await field.getByRole("textbox").first().fill("Une forme violette sur fond uni");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).first().click();
  await page.getByText("Description enregistrée").first().waitFor({ timeout: 30000 });
  const alt = sql((db) => db.prepare("select alt from media where id = ?").get(a))?.alt;
  ok("AL4 la description est enregistrée", /forme violette/.test(alt ?? ""), String(alt));

  // Au moment du choix : une image sans description se décrit sur place.
  await page.goto(`${BASE}/admin/reglages`, { waitUntil: "networkidle" });
  const form = page.getByTestId("seo-form");
  await form.getByRole("button", { name: /Choisir une image|Changer d'image/ }).first().click();
  const dlg = page.getByRole("dialog");
  await dlg.locator(".a-media-tile", { hasText: "sans-desc-b" }).click();
  const inline = dlg.getByTestId("pick-alt");
  ok("AL5 au choix : l'image sans description propose son champ", await inline.isVisible());
  await inline.getByRole("textbox").first().fill("Un aplat turquoise");
  await inline.getByRole("button", { name: "Enregistrer la description" }).click();
  await page.getByText("Description enregistrée").first().waitFor({ timeout: 30000 });
  ok("AL5 description enregistrée depuis le sélecteur", /turquoise/.test(sql((db) => db.prepare("select alt from media where id = ?").get(b))?.alt ?? ""));
  await dlg.getByRole("button", { name: "Annuler" }).click().catch(() => {});

  // Republication : plus aucun avertissement d'image.
  const again = await publishBlocks(page, BASE, pid, (blocks) => blocks.map((x) => (x.props?.paragraphs?.[0]?.fr === "Un texte seulement en français." ? { ...x, props: { paragraphs: [{ fr: "Un texte seulement en français.", en: "Only in French? No longer." }] } } : x)), done, 120000);
  ok("AL6 republication réussie", again);
  await sleep(1500);
  const w2 = page.getByTestId("publish-warnings");
  ok("AL6 plus d'avertissement : tout est décrit et traduit", (await w2.count()) === 0, (await w2.count()) ? await w2.innerText() : "");

  // Visionneuse : « Agrandir l'image » annoncé avec la description ou le titre, jamais la date.
  const pub = await ctx.newPage();
  await pub.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
  const labels = await pub.locator("[aria-label$=\"Agrandir l'image\"]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  info("libellés de la visionneuse", labels.slice(0, 4));
  ok("AL7 des boutons « Agrandir l'image » existent sur la page", labels.length > 0);
  ok("AL7 aucun ne s'annonce avec la seule date (année)", labels.every((l) => !/^\d{4}\s+—/.test(l ?? "")), labels.filter((l) => /^\d{4}\s+—/.test(l ?? "")).join(" | "));
  ok("AL7 chacun est précédé d'un texte (description ou titre)", labels.every((l) => (l ?? "").length > "Agrandir l'image".length + 3), labels.join(" | "));
  // Page publique vue SANS session (la session admin active le mode brouillon : la toile n'ouvre pas la visionneuse).
  const aboutHtml = (await html("/fr/a-propos")).text;
  const aboutLabels = [...aboutHtml.matchAll(/aria-label="([^"]*)"/g)].map((m) => decode(m[1])).filter((l) => /Agrandir l'image$/.test(l));
  info("libellés de la page À propos", aboutLabels);
  ok("AL7 image de bloc : annoncée avec sa description", aboutLabels.some((l) => /forme violette/.test(l ?? "")), aboutLabels.join(" | "));
  await pub.close();
});

/* ---------------------------------------------------------------- TR */
if (run("TR")) await section("TR", async () => {
  // État de départ : la page « À propos » vient d'être rendue entièrement traduite ; on retire UNE traduction (brouillon → publication).
  const pid = pageIdOf("a-propos");
  const done = () => sql((db) => db.prepare("select draft from pages where id = ?").get(pid))?.draft === null;
  await publishBlocks(page, BASE, pid, (blocks) => [...blocks.filter((x) => x.props?.paragraphs?.[0]?.fr !== "Sans traduction."), { uid: "tr52", type: "rich-text", props: { paragraphs: [{ fr: "Sans traduction.", en: "" }, { fr: "Aussi sans traduction.", en: "" }] } }], done, 120000);
  await page.getByTestId("warn-translation").waitFor({ timeout: 30000 });
  const text = await page.getByTestId("warn-translation").innerText();
  ok("TR1 la publication avertit : « 2 textes ne sont pas traduits en anglais »", /2 textes ne sont pas traduits en anglais/.test(text), text);
  await page.goto(`${BASE}/admin/pages`, { waitUntil: "networkidle" });
  const row = page.locator("tr", { hasText: "/a-propos" }).first();
  ok("TR2 liste des pages : « Pas traduit en anglais » sur la page concernée", (await row.getByTestId("untranslated").count()) === 1 && /Pas traduit en anglais/.test(await row.getByTestId("untranslated").innerText()));
  const others = await page.locator("tbody tr").filter({ hasNot: page.getByTestId("untranslated") }).count();
  ok("TR2 les pages entièrement traduites n'ont pas l'indicateur", others >= 1);
  await page.screenshot({ path: path.join(SHOTS, "tr-liste.png") });
  // Traduit : l'indicateur disparaît.
  await publishBlocks(page, BASE, pid, (blocks) => blocks.map((x) => (x.props?.paragraphs?.[0]?.fr === "Sans traduction." ? { ...x, props: { paragraphs: [{ fr: "Sans traduction.", en: "Translated." }, { fr: "Aussi sans traduction.", en: "Also translated." }] } } : x)), done, 120000);
  await sleep(1200);
  await page.goto(`${BASE}/admin/pages`, { waitUntil: "networkidle" });
  ok("TR3 une fois traduite, la page n'a plus l'indicateur", (await page.locator("tr", { hasText: "/a-propos" }).first().getByTestId("untranslated").count()) === 0);
});

/* ---------------------------------------------------------------- MS */
if (run("MS")) await section("MS", async () => {
  sql((db) => db.prepare("delete from messages").run());
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  ok("MS1 sans message : pas de pastille, carte « Aucun nouveau message »", (await page.getByTestId("messages-badge").count()) === 0 && /Aucun nouveau message/.test(await page.getByTestId("dash-messages").innerText()));
  const ins = sql((db) => {
    const s = db.prepare("insert into messages (subject, fields, reply_to, ip_hash) values (?, ?, ?, ?)");
    s.run("Question sur une commande", JSON.stringify([{ label: "Ton nom", value: "Alice" }, { label: "Ton message", value: "Bonjour !" }]), "alice@example.org", "h1");
    s.run("Collaboration", JSON.stringify([{ label: "Ton nom", value: "Bob" }, { label: "Ton message", value: "Un projet ?" }]), null, "h2");
    return true;
  });
  ok("MS1 messages ajoutés", ins);
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  const badge = page.getByTestId("messages-badge");
  ok("MS2 pastille « 2 » sur « Messages » dans le menu", (await badge.count()) === 1 && (await badge.innerText()).trim().startsWith("2"), await badge.innerText().catch(() => "absente"));
  ok("MS2 la pastille se lit aussi pour un lecteur d'écran", /2 nouveaux messages/.test((await badge.textContent()) ?? ""));
  const card = page.getByTestId("dash-messages");
  ok("MS3 carte « 2 nouveaux messages » sur le tableau de bord", /2 nouveaux messages/.test(await card.innerText()) && (await card.getAttribute("data-unread")) === "2", await card.innerText());
  await page.screenshot({ path: path.join(SHOTS, "ms-tableau.png") });
  await card.getByRole("link").click();
  await page.waitForURL(/\/admin\/messages/);
  ok("MS4 « Les messages arrivent ici. Pense à passer voir. » quand aucun e-mail n'est configuré", (await page.getByTestId("messages-no-email").innerText()).trim() === "Les messages arrivent ici. Pense à passer voir.");
  ok("MS4 les 2 messages sont marqués « Nouveau »", (await page.locator(".a-message[data-new]").count()) === 2 && /2 nouveaux messages/.test(await page.getByTestId("messages-new-count").innerText()));
  await page.screenshot({ path: path.join(SHOTS, "ms-messages.png") });
  await sleep(1500);
  const seen = JSON.parse(sql((db) => db.prepare("select value from settings where key = 'messagesSeen'").get())?.value ?? "0");
  ok("MS5 la visite marque les messages comme vus", seen >= 2, String(seen));
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  ok("MS5 de retour : plus de pastille, carte à zéro", (await page.getByTestId("messages-badge").count()) === 0 && (await page.getByTestId("dash-messages").getAttribute("data-unread")) === "0");
  sql((db) => db.prepare("insert into messages (subject, fields, ip_hash) values (?, ?, ?)").run("Encore un", JSON.stringify([{ label: "Ton message", value: "Salut" }]), "h3"));
  await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  ok("MS6 un nouveau message : pastille « 1 », carte au singulier", (await page.getByTestId("messages-badge").innerText()).trim().startsWith("1") && /1 nouveau message(?!s)/.test(await page.getByTestId("dash-messages").innerText()));
  sql((db) => db.prepare("delete from messages").run());
});

console.log(errors.length ? `ERREURS PAGE : ${errors.slice(0, 5).join(" | ")}` : "aucune erreur de page");
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout est vert");
process.exit(failures ? 1 : 0);
