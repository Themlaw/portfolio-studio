#!/usr/bin/env node
/**
 * Lot 51 (v0.28) : publication unifiée. UN chromium, base NEUVE (seed), une connexion admin.
 *
 *  A. Page neuve : « Publier » dans l'éditeur demande confirmation (une fois), met contenu ET page en ligne
 *     (200 public) ; en-tête, liste des pages disent la même chose (« En ligne »).
 *  B. « Retirer du site » (liste des pages) : 404 public, état « Pas encore en ligne ».
 *  C. « Enregistrer » dans les infos de la page : ne publie JAMAIS le brouillon de contenu.
 *  D. Changement d'adresse d'une page en ligne : ancienne adresse gardée en redirection (défaut), ou non.
 *
 * Usage : BASE=http://localhost:3640 DATA_DIR=/root/pf-51 ADMIN_EMAIL=… ADMIN_PASSWORD=… SHOTS=/dossier node scripts/e2e-publication51.mjs
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const DB = path.join(process.env.DATA_DIR ?? "data", "portfolio.db");
const SHOTS = process.env.SHOTS ?? "screenshots/publication51";
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
function ok(label, cond, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (sql, ...args) => {
  const db = new Database(DB, { readonly: true });
  try {
    return db.prepare(sql).all(...args);
  } finally {
    db.close();
  }
};
const L = (t) => ({ fr: t, en: t });
/** Écrit un brouillon comme le fait l'enregistrement automatique (version augmentée). */
function writeDraft(id, patch) {
  const db = new Database(DB);
  try {
    const row = db.prepare("select title, slug, meta, published, draft from pages where id = ?").get(id);
    const base = row.draft
      ? JSON.parse(row.draft)
      : { title: JSON.parse(row.title), slug: JSON.parse(row.slug), meta: JSON.parse(row.meta), published: Boolean(row.published), inMenu: false, accent: null, blocks: [] };
    db.prepare("update pages set draft = ?, draft_rev = draft_rev + 1 where id = ?").run(JSON.stringify({ ...base, ...patch }), id);
  } finally {
    db.close();
  }
}
const row = (id) => q("select published, slug, draft, draft_rev from pages where id = ?", id)[0];
async function waitFor(fn, timeout = 60000) {
  for (const end = Date.now() + timeout; Date.now() < end; await sleep(300)) if (await fn()) return true;
  return false;
}
async function anon(p) {
  const r = await fetch(BASE + p, { redirect: "manual" });
  return { status: r.status, location: r.headers.get("location"), html: await r.text() };
}

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(`${BASE}/admin/connexion`, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL);
await page.fill("#password", PASSWORD);
await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/admin/connexion"), { timeout: 90000 }), page.click("button[type=submit]")]);

async function canvas() {
  const handle = await page.waitForSelector("iframe.ve-frame", { timeout: 120000 });
  const f = await handle.contentFrame();
  await f.waitForSelector("html[data-edit-mode]", { timeout: 180000 });
  return f;
}
/** Attend un toast ; en cas d'échec, montre ce que la barre d'enregistrement disait. */
async function toastOf(text) {
  try {
    await page.locator(".a-toast", { hasText: text }).first().waitFor({ timeout: 20000 });
  } catch (e) {
    console.log("TOAST ABSENT :", text, "|", (await page.locator(".a-savebar, .a-alert, .a-toast").allTextContents()).join(" / "));
    await page.screenshot({ path: `${SHOTS}/echec-toast.png` });
    throw e;
  }
}
const status = async () => ((await page.locator(".ve-status").textContent()) ?? "").trim();

console.log("== A. Un seul « Publier »");
await page.goto(`${BASE}/admin/pages`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Créer une page" }).click();
const d = page.locator("dialog[open]");
await d.getByLabel("Titre en français").fill("Carnets 51");
await d.getByLabel("Titre en anglais").fill("Sketchbooks 51");
await d.getByLabel("Adresse en français").fill("carnets-51");
await d.getByLabel("Adresse en anglais").fill("sketchbooks-51");
await d.getByRole("button", { name: "Créer la page" }).click();
await page.waitForURL(/\/admin\/pages\/\d+\/editer$/, { timeout: 90000 });
const id = Number(page.url().split("/").at(-2));
ok("A0 page neuve : 404 public", (await anon("/fr/carnets-51")).status === 404);
await canvas();
await page.goto(`${BASE}/admin/pages`, { waitUntil: "networkidle" });
await page.goto(`${BASE}/admin/pages/${id}/editer`, { waitUntil: "domcontentloaded" });
// Contenu écrit comme l'enregistrement automatique l'aurait fait.
writeDraft(id, { blocks: [{ uid: "b0", type: "section-title", props: { title: L("Titre de base") } }] });
await page.reload({ waitUntil: "domcontentloaded" });
await canvas();
await sleep(1500);
ok("A1 en-tête : « Pas encore en ligne »", /Pas encore en ligne/.test(await status()), await status());
await page.screenshot({ path: `${SHOTS}/A1-avant.png` });
const publishBtn = page.getByRole("button", { name: "Publier", exact: true });
await publishBtn.click();
const dlg = page.locator("dialog[open]");
ok("A2 confirmation « Mettre cette page en ligne ? » (visible par tous)", await dlg.waitFor({ timeout: 10000 }).then(() => true, () => false) && /Mettre cette page en ligne/.test((await dlg.textContent()) ?? "") && /visible par tous/.test((await dlg.textContent()) ?? ""));
await page.screenshot({ path: `${SHOTS}/A2-confirmation.png` });
await dlg.getByRole("button", { name: "Annuler" }).click();
await sleep(500);
ok("A3 annuler : toujours 404, rien n'est publié", (await anon("/fr/carnets-51")).status === 404 && row(id).published === 0);
await publishBtn.click();
await page.locator("dialog[open]").getByRole("button", { name: "Mettre en ligne" }).click();
ok("A4 en-tête : « En ligne » juste après", await waitFor(async () => /^En ligne/.test(await status()), 120000), await status());
ok("A5 toast : la page est en ligne", (await page.locator(".a-toast", { hasText: "la page est en ligne" }).count()) >= 1);
ok("A6 public : 200 avec le contenu", await waitFor(async () => { const r = await anon("/fr/carnets-51"); return r.status === 200 && r.html.includes("Titre de base"); }));
ok("A7 le bouton Publier se grise (rien à publier)", await publishBtn.isDisabled());
await page.screenshot({ path: `${SHOTS}/A7-apres.png` });
await page.goto(`${BASE}/admin/pages`, { waitUntil: "networkidle" });
const tr = () => page.locator("tr", { hasText: "Carnets 51" });
ok("A8 liste : « En ligne », pas « Pas encore en ligne »", await waitFor(async () => (await tr().getByText("En ligne", { exact: true }).count()) === 1 && (await tr().getByText("Pas encore en ligne").count()) === 0, 15000));
await page.screenshot({ path: `${SHOTS}/A8-liste.png` });

console.log("== B. Retirer du site");
await tr().getByRole("button", { name: "Retirer du site" }).click();
await toastOf("retirée du site");
ok("B1 public : 404", await waitFor(async () => (await anon("/fr/carnets-51")).status === 404));
ok("B2 liste : « Pas encore en ligne » et bouton « Mettre en ligne »", await waitFor(async () => (await tr().getByText("Pas encore en ligne").count()) === 1 && (await tr().getByRole("button", { name: "Mettre en ligne" }).count()) === 1, 15000));
await page.goto(`${BASE}/admin/pages/${id}/editer`, { waitUntil: "domcontentloaded" });
await canvas();
await sleep(1000);
ok("B3 éditeur : « Pas encore en ligne » à nouveau, Publier actif", /Pas encore en ligne/.test(await status()) && !(await publishBtn.isDisabled()), await status());
await publishBtn.click();
await page.locator("dialog[open]").getByRole("button", { name: "Mettre en ligne" }).click();
ok("B4 remise en ligne sans modification : 200", await waitFor(async () => (await anon("/fr/carnets-51")).status === 200, 90000));
ok("B5 en-tête : « En ligne »", await waitFor(async () => /^En ligne/.test(await status())));

console.log("== C. Les infos n'ont pas publié le brouillon");
writeDraft(id, { blocks: [{ uid: "b0", type: "section-title", props: { title: L("Titre brouillon") } }] });
await page.goto(`${BASE}/admin/pages/${id}`, { waitUntil: "networkidle" });
ok("C0 le formulaire annonce des modifications non publiées", (await page.getByText("modifications non publiées").count()) >= 1);
await page.getByLabel("Adresse en anglais").fill("sketchbooks-51-b");
await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
await toastOf("renvoie vers la nouvelle");
const after = await anon("/fr/carnets-51");
ok("C1 public : le contenu est celui d'avant (pas de fuite du brouillon)", after.status === 200 && after.html.includes("Titre de base") && !after.html.includes("Titre brouillon"), `${after.status}`);
const r1 = row(id);
ok("C2 brouillon conservé avec son contenu", JSON.parse(r1.draft ?? "null")?.blocks?.[0]?.props?.title?.fr === "Titre brouillon");
ok("C3 adresse anglaise changée (publié et brouillon)", JSON.parse(r1.slug).en === "sketchbooks-51-b" && JSON.parse(r1.draft).slug.en === "sketchbooks-51-b");
await page.screenshot({ path: `${SHOTS}/C-infos.png` });
// Ouvert dans l'éditeur, le brouillon est bien là, avec la nouvelle adresse ; « Publier » le publie.
await page.goto(`${BASE}/admin/pages/${id}/editer`, { waitUntil: "domcontentloaded" });
await canvas();
await sleep(1000);
ok("C4 éditeur : « Modifications non publiées »", /Modifications non publiées/.test(await status()), await status());
await publishBtn.click();
ok("C5 Publier : le brouillon devient public (page déjà en ligne : pas de confirmation)", await waitFor(async () => (await anon("/fr/carnets-51")).html.includes("Titre brouillon"), 90000));
ok("C6 l'adresse changée dans les infos a survécu à la publication", JSON.parse(row(id).slug).en === "sketchbooks-51-b");

console.log("== D. Changer l'adresse d'une page en ligne");
await page.goto(`${BASE}/admin/pages/${id}`, { waitUntil: "networkidle" });
ok("D0 pas de case « ancienne adresse » tant que l'adresse ne change pas", (await page.getByText("Garder l'ancienne adresse").count()) === 0);
await page.getByLabel("Adresse en français").fill("croquis-51");
const keep = page.getByRole("switch", { name: "Garder l'ancienne adresse" });
ok("D1 la case « Garder l'ancienne adresse » apparaît, cochée par défaut", (await keep.count()) === 1 && (await keep.isChecked()));
await page.screenshot({ path: `${SHOTS}/D1-redirection.png` });
await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
await toastOf("renvoie vers la nouvelle");
const old = await anon("/fr/carnets-51");
ok("D2 ancienne adresse : redirection vers la nouvelle", old.status === 308 && /\/fr\/croquis-51$/.test(old.location ?? ""), `${old.status} ${old.location}`);
ok("D3 nouvelle adresse : 200", (await anon("/fr/croquis-51")).status === 200);
// Deuxième changement, case décochée : l'adresse précédente n'est pas gardée, la première suit la page (chaîne).
await page.goto(`${BASE}/admin/pages/${id}`, { waitUntil: "networkidle" });
await page.getByLabel("Adresse en français").fill("croquis-51b");
await page.locator("label.a-toggle", { hasText: "Garder l'ancienne adresse" }).click();
await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
await toastOf("ne marcheront plus");
ok("D4 case décochée : l'adresse quittée répond 404", (await anon("/fr/croquis-51")).status === 404);
const chain = await anon("/fr/carnets-51");
ok("D5 la toute première adresse suit la page (aucun lien cassé en chaîne)", chain.status === 308 && /\/fr\/croquis-51b$/.test(chain.location ?? ""), `${chain.status} ${chain.location}`);
// Page retirée du site : sa redirection ne mène nulle part.
{
  const db = new Database(DB);
  db.prepare("update pages set published = 0 where id = ?").run(id);
  db.close();
}
ok("D6 page retirée du site : l'ancienne adresse répond 404, pas de redirection", await waitFor(async () => (await anon("/fr/carnets-51")).status === 404));

ok("aucune erreur JavaScript dans la page", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout est bon.");
process.exit(failures ? 1 : 0);
