#!/usr/bin/env node
/**
 * Écran « Sécurité du compte » (audit de sécurité, P3), dans un vrai navigateur (chromium), deux appareils simulés par deux
 * contextes :
 *  S1 l'écran liste les deux sessions (navigateur, IP, « Cette session ») ; lien dans le menu de l'admin ;
 *  S2 mauvais mot de passe actuel : refusé, rien ne change, l'autre appareil reste connecté ;
 *  S3 changer le mot de passe DÉCONNECTE l'autre contexte (il revient sur la connexion), la session en cours reste ouverte ;
 *  S4 l'ancien mot de passe ne marche plus, le nouveau oui ;
 *  S5 « Déconnecter les autres sessions » (confirmation qui nomme le nombre) coupe un troisième appareil ;
 *  S6 remise en état : mot de passe d'origine reposé depuis l'écran.
 * Chaque contexte a son X-Forwarded-For (limite de 5 connexions par minute et par IP).
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… BASE=… node scripts/e2e-compte.mjs
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
const NEW_PASSWORD = `${PASSWORD}-change-e2e`;
const SHOTS = process.env.SHOTS;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
if (!EMAIL || !PASSWORD) {
  console.error("ADMIN_EMAIL et ADMIN_PASSWORD sont requis");
  process.exit(2);
}

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions"] });
let ip = 10;
const device = async () => browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${ip++}` } });
const login = async (page, password) => {
  await page.goto(`${BASE}/admin/connexion`, { waitUntil: "domcontentloaded" });
  await page.fill("#email", EMAIL);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
  return page.waitForURL(`${BASE}/admin`, { timeout: 20000 }).then(
    () => true,
    () => false,
  );
};
const loggedIn = async (page) => {
  await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
  return !page.url().includes("/admin/connexion");
};
const shot = async (page, name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
const changePassword = async (page, current, next) => {
  await page.goto(`${BASE}/admin/compte`, { waitUntil: "networkidle" });
  await page.fill('[data-testid="mdp-actuel"]', current);
  await page.fill('[data-testid="mdp-nouveau"]', next);
  await page.fill('[data-testid="mdp-confirmation"]', next);
  await page.click('[data-testid="mdp-changer"]');
};
const toastText = (page, re) =>
  page
    .locator(".a-toast", { hasText: re })
    .first()
    .waitFor({ timeout: 15000 })
    .then(
      () => true,
      () => false,
    );

let restored = false;
const A = await (await device()).newPage();
try {
  const B = await (await device()).newPage();
  ok("S0 deux appareils connectés", (await login(A, PASSWORD)) && (await login(B, PASSWORD)));

  await A.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
  ok("S1 lien « Sécurité du compte » dans le menu de l'admin", (await A.locator('.a-sidebar a[href="/admin/compte"]').count()) === 1);
  await A.goto(`${BASE}/admin/compte`, { waitUntil: "networkidle" });
  const rows = A.locator('[data-testid="ligne-session"]');
  ok("S1 les deux sessions sont listées, une seule marquée « Cette session »", (await rows.count()) === 2 && (await A.locator('[data-testid="ligne-session"][data-current="true"]').count()) === 1, String(await rows.count()));
  ok("S1 IP et navigateur affichés", /198\.51\.100\.\d+/.test(await rows.first().innerText()) && /Chrome/.test(await rows.first().innerText()), await rows.first().innerText());
  await shot(A, "s1-compte");

  await changePassword(A, "pas-le-bon-mot-de-passe", NEW_PASSWORD);
  ok("S2 mauvais mot de passe actuel : refusé", await toastText(A, /incorrect/i));
  ok("S2 l'autre appareil reste connecté après un refus", await loggedIn(B));

  await changePassword(A, PASSWORD, NEW_PASSWORD);
  ok("S3 mot de passe changé (message)", await toastText(A, /Mot de passe changé/));
  ok("S3 l'AUTRE contexte est déconnecté (retour à la connexion)", !(await loggedIn(B)), B.url());
  ok("S3 la session en cours reste ouverte", await loggedIn(A), A.url());
  await shot(A, "s3-apres-changement");

  const C = await (await device()).newPage();
  ok("S4 l'ancien mot de passe ne marche plus", !(await login(C, PASSWORD)));
  ok("S4 le nouveau mot de passe marche", await login(C, NEW_PASSWORD));

  await A.goto(`${BASE}/admin/compte`, { waitUntil: "networkidle" });
  ok("S5 la nouvelle session apparaît (2 sessions)", (await rows.count()) === 2, String(await rows.count()));
  await A.click('[data-testid="deconnecter-autres"]');
  const dialog = A.locator("dialog.a-dialog[open]");
  ok("S5 confirmation qui nomme le nombre de sessions", /Déconnecter 1 autre session/.test(await dialog.innerText()), await dialog.innerText());
  await dialog.getByRole("button", { name: "Déconnecter" }).click();
  ok("S5 message « 1 autre session déconnectée »", await toastText(A, /1 autre session déconnectée/));
  ok("S5 le troisième appareil est déconnecté", !(await loggedIn(C)));
  ok("S5 la session en cours reste ouverte", await loggedIn(A));

  await changePassword(A, NEW_PASSWORD, PASSWORD);
  restored = await toastText(A, /Mot de passe changé/);
  ok("S6 remise en état : mot de passe d'origine reposé", restored);
} catch (error) {
  failures++;
  console.log(`FAIL exception : ${error?.stack ?? error}`);
} finally {
  if (!restored) console.log(`ATTENTION : le mot de passe de ${EMAIL} est peut-être resté « ${NEW_PASSWORD} » (reset-password.mjs pour le remettre)`);
  await browser.close();
}
console.log(failures ? `\n${failures} échec(s)` : "\nTout est vert");
process.exit(failures ? 1 : 0);
