#!/usr/bin/env node
/**
 * Pages admin : renommage en place et ordre des pages (indépendant du menu).
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… node scripts/e2e-pages-ordre.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");

let failures = 0;
function ok(label, cond, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch({ args: ["--disable-gpu"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
page.setDefaultNavigationTimeout(120000);

async function login() {
  await page.goto(`${BASE}/admin/connexion`, { waitUntil: "networkidle" });
  if (page.url().includes("/connexion")) {
    await page.fill("#email", EMAIL);
    await page.fill("#password", PASSWORD);
    await page.click("button[type=submit]");
    await page.waitForURL(`${BASE}/admin`);
  }
}

const suffix = Date.now();
const titleA = `Page alpha ${suffix}`;
const titleB = `Page beta ${suffix}`;
const slugA = `page-alpha-${suffix}`;
const slugB = `page-beta-${suffix}`;

await login();

// ---- Création de deux pages ---------------------------------------------
async function createPage(title, slug) {
  await page.goto(`${BASE}/admin/pages`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Créer une page" }).click();
  const d = page.locator("dialog[open]");
  await d.getByLabel("Titre en français").fill(title);
  await d.getByLabel("Adresse en français").fill(slug);
  await d.getByRole("button", { name: "Créer la page" }).click();
  await page.waitForURL(/\/admin\/pages\/\d+\/editer$/, { timeout: 90000 });
  return Number(page.url().split("/").at(-2));
}

const idA = await createPage(titleA, slugA);
const idB = await createPage(titleB, slugB);
ok("deux pages créées", idA > 0 && idB > 0);

// ---- Ordre public avant --------------------------------------------------
const homeBefore = await (await fetch(`${BASE}/fr`)).text();

// ---- Renommage de la page A ---------------------------------------------
await page.goto(`${BASE}/admin/pages`, { waitUntil: "networkidle" });
const rowA = page.locator("tr", { hasText: titleA });
await rowA.getByTestId("rename-page").click();
await page.getByTestId("rename-fr").fill("Alpha renommée");
await page.getByTestId("rename-en").fill("Renamed alpha");
await page.getByTestId("rename-save").click();
await page.waitForTimeout(1000);
await page.reload({ waitUntil: "networkidle" });
const rowA2 = page.locator("tr", { hasText: "Alpha renommée" });
ok("renommer : nouveau nom dans la liste", (await rowA2.count()) === 1);
ok("renommer : slug inchangé", (await rowA2.textContent()).includes(slugA));

// sélecteur de l'éditeur
await page.goto(`${BASE}/admin/pages/${idA}/editer`, { waitUntil: "networkidle" });
const select = page.locator("select.a-input");
ok("renommer : nouveau nom dans le sélecteur", (await select.textContent()).includes("Alpha renommée"));
ok("renommer : slug inchangé dans le sélecteur (id présent)", (await select.locator(`option[value="${idA}"]`).count()) === 1);

// ---- Ordre : descendre/remonte -----------------------------------------
await page.goto(`${BASE}/admin/pages`, { waitUntil: "networkidle" });
// ordre attendu par défaut : idA puis idB (par identifiant). On déplace idB au-dessus de idA.
const rowB = page.locator("tr", { hasText: titleB });
await rowB.getByTestId("page-up").click();
await page.getByRole("button", { name: "Enregistrer l'ordre" }).click();
await page.waitForTimeout(1000);
await page.reload({ waitUntil: "networkidle" });
const rows = page.locator("tbody tr");
const firstText = await rows.nth(0).textContent();
const secondText = await rows.nth(1).textContent();
ok("ordre : page B avant page A après Monter", firstText.includes(titleB) && secondText.includes("Alpha renommée"));

// sélecteur de l'éditeur
await page.goto(`${BASE}/admin/pages/${idA}/editer`, { waitUntil: "networkidle" });
const opts = await page.locator("select.a-input option").allTextContents();
const idxB = opts.findIndex((t) => t.includes(titleB));
const idxA = opts.findIndex((t) => t.includes("Alpha renommée"));
ok("ordre : même ordre dans le sélecteur", idxB >= 0 && idxA >= 0 && idxB < idxA);

// ---- Menu public inchangé -----------------------------------------------
const homeAfter = await (await fetch(`${BASE}/fr`)).text();
ok("menu public inchangé", homeBefore === homeAfter);

// ---- Nettoyage ----------------------------------------------------------
for (const id of [idA, idB]) {
  await page.goto(`${BASE}/admin/pages`, { waitUntil: "networkidle" });
  // find row by id? use title-ish; idB still titleB, idA renamed
  const txt = id === idA ? "Alpha renommée" : titleB;
  const r = page.locator("tr", { hasText: txt });
  await r.getByRole("button", { name: "Supprimer" }).click();
  await page.locator("dialog[open]").getByRole("button", { name: "Supprimer" }).click();
  await page.locator("dialog[open]").waitFor({ state: "detached" });
}

await browser.close();
console.log(`\n${failures === 0 ? "OK" : failures + " ECHEC(S)"}`);
process.exit(failures === 0 ? 0 : 1);
