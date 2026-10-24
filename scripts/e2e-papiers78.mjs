#!/usr/bin/env node
/**
 * Page « Papiers peints » rendue à l'admin (lot 78, correctif v0.30.1), UN chromium. Serveur requis, base NEUVE (seed), une connexion.
 *  A. Entrée « Papiers peints » dans le menu, sous Thèmes ; la page /admin/papiers-peints s'affiche (pas de redirection) avec la bibliothèque.
 *  B. Import de deux PNG synthétiques depuis la page, compteurs d'utilisation présents.
 *  C. Suppression depuis la page : le motif va à la corbeille de la page, qui le montre.
 *  D. L'onglet « Mes papiers peints » de l'éditeur de thème marche toujours, avec le lien « Gérer la bibliothèque » vers la page.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [SHOTS=…] node scripts/e2e-papiers78.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { chromium } from "playwright";
import sharp from "sharp";

import { login, q1, waitFor } from "./lib/grille31d.mjs";
import { autoOpenFine } from "./lib/zone66.mjs";

const BASE = process.env.BASE ?? "http://localhost:3001";
const SHOTS = process.env.SHOTS ?? "screenshots/papiers78";
mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};

const mk = async (name, color) => {
  const f = path.join(SHOTS, name);
  const dot = await sharp({ create: { width: 40, height: 40, channels: 4, background: color } }).png().toBuffer();
  writeFileSync(f, await sharp({ create: { width: 96, height: 96, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: dot, left: 28, top: 28 }]).png().toBuffer());
  return f;
};
const F1 = await mk("ronds-bleus.png", "#3b6fd1");
const F2 = await mk("ronds-rouges.png", "#d13b4a");

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await autoOpenFine(ctx);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);

await page.goto(`${BASE}/admin/themes`, { waitUntil: "networkidle" });
ok("A1 « Papiers peints » est dans le menu", (await page.locator('.a-nav a[href="/admin/papiers-peints"]').count()) === 1);
await page.locator('.a-nav a[href="/admin/papiers-peints"]').click();
await page.waitForURL(/\/admin\/papiers-peints$/, { timeout: 20000 }).catch(() => {});
ok("A2 la page s'affiche (pas de redirection) avec la bibliothèque", new URL(page.url()).pathname === "/admin/papiers-peints" && (await page.locator('[data-testid="wallpaper-library"]').isVisible()), page.url());
ok("A3 l'entrée du menu est la page courante", (await page.locator('.a-nav a[href="/admin/papiers-peints"]').getAttribute("aria-current")) === "page");

await page.locator('[data-testid="wallpaper-input"]').setInputFiles([F1, F2]);
ok("B1 import de deux PNG : deux motifs prêts", await waitFor(async () => (await page.locator('[data-testid="wallpaper"][data-status="ready"]').count()) === 2, 120000));
ok("B2 deux lignes en base", q1("select count(*) n from wallpapers where deleted_at is null")?.n === 2, JSON.stringify(q1("select count(*) n from wallpapers")));
ok("B3 un compteur d'utilisation par motif", (await page.locator('[data-testid="wallpaper-uses"]').count()) === 2);
await page.screenshot({ path: path.join(SHOTS, "page.png") });

await page.locator('[data-testid="wallpaper"]').first().locator('[data-testid="wallpaper-delete"]').click();
await page.getByRole("button", { name: "Mettre à la corbeille" }).click();
ok("C1 un motif part à la corbeille", await waitFor(async () => (await page.locator('[data-testid="wallpaper"]').count()) === 1, 30000));
ok("C2 la corbeille de la page le montre", await page.locator('[data-testid="wallpaper-trash"]').waitFor({ timeout: 20000 }).then(() => true, () => false));
await page.reload({ waitUntil: "networkidle" });
ok("C3 après rechargement : 1 motif + 1 en corbeille", (await page.locator('[data-testid="wallpaper"]').count()) === 1 && (await page.locator('[data-testid="wallpaper-trash"] [data-testid="wallpaper-restore"]').count()) === 1);

await page.goto(`${BASE}/admin/themes`, { waitUntil: "networkidle" });
const href = "/admin/themes/galerie-lumineuse";
await page.goto(`${BASE}${href}?etape=papier&onglet=papiers-peints`, { waitUntil: "networkidle" });
ok("D1 l'onglet du thème marche : bibliothèque visible", (await page.locator('[data-testid="paper-tab-wallpapers"]').getAttribute("aria-selected")) === "true" && (await page.locator('[data-testid="wallpaper-library"]').isVisible()));
ok("D2 … avec le lien « Gérer la bibliothèque »", (await page.locator('[data-testid="manage-wallpapers"]').getAttribute("href")) === "/admin/papiers-peints");
await page.locator('[data-testid="manage-wallpapers"]').click();
await page.waitForURL(/\/admin\/papiers-peints$/, { timeout: 20000 }).catch(() => {});
ok("D3 le lien mène à la page", new URL(page.url()).pathname === "/admin/papiers-peints" && (await page.locator('[data-testid="wallpaper-library"]').isVisible()));

ok("Z aucune erreur JavaScript de page", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures === 0 ? "OK" : `${failures} échec(s)`);
process.exit(failures === 0 ? 0 : 1);
