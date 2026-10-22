#!/usr/bin/env node
/**
 * Parcours de bout en bout des projets, planches et médiathèque (phase 4b),
 * avec UN seul chromium. Serveur dev requis (redémarré puis pré-chauffé),
 * une connexion par le vrai formulaire.
 *
 * Images générées par sharp : JPEG 6000×4000 avec EXIF GPS et orientation 6,
 * PNG transparent, WebP. Parcours : créer un projet, y déposer les 3 images,
 * réordonner, retirer une image (la place reste), la remettre depuis la
 * médiathèque, supprimer un emplacement, renseigner le texte alternatif ;
 * côté public : <picture> AVIF/WebP, ordre, emplacement vide masqué,
 * visionneuse sur la plus grande variante ; médiathèque : suppression
 * bloquée par un bloc, suppression qui vide un emplacement. L'état initial
 * est restauré (projet et images de test supprimés).
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… node scripts/e2e-planche.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { execFileSync } from "node:child_process";

import { chromium } from "playwright";

import { pageIdOf, placeBoard, projectSlugOf, removeBoard } from "./lib/page-board.mjs";
import sharp from "sharp";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");

let failures = 0;
function ok(label, cond, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
}

/* ---- Images de test ------------------------------------------------------ */
const DIR = path.join(tmpdir(), "e2e-planche");
mkdirSync(DIR, { recursive: true });
const FILES = {
  grand: path.join(DIR, "e2e-grand.jpg"),
  transparent: path.join(DIR, "e2e-transparent.png"),
  paysage: path.join(DIR, "e2e-paysage.webp"),
};
const FIXTURES = `
import sharp from "sharp";
const FILES = ${JSON.stringify(FILES)};
const big = '<svg xmlns="http://www.w3.org/2000/svg" width="6000" height="4000"><rect width="100%" height="100%" fill="#c0503a"/><rect x="200" y="200" width="1800" height="900" fill="#f2d16b"/></svg>';
await sharp(Buffer.from(big))
  .jpeg({ quality: 85 })
  .withExif({ IFD0: { Make: "TestCam", Model: "Secret-1" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "48/1 51/1 2400/100", GPSLongitudeRef: "E", GPSLongitude: "2/1 21/1 300/100" } })
  .withMetadata({ orientation: 6 })
  .toFile(FILES.grand);
const disc = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><circle cx="600" cy="450" r="300" fill="#2f6b46"/></svg>';
await sharp({ create: { width: 1200, height: 900, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: Buffer.from(disc) }])
  .png()
  .toFile(FILES.transparent);
await sharp({ create: { width: 1600, height: 1000, channels: 3, background: "#8a5a00" } }).webp().toFile(FILES.paysage);
`;

// Génération dans un processus à part : la mémoire de sharp (image de 6000 px)
// est rendue avant de lancer chromium.
execFileSync(process.execPath, ["--input-type=module", "-e", FIXTURES], { stdio: "inherit" });

// Chromium sobre (VM de dev à 2 Go + swap) : pas de GPU, peu de processus de rendu.
const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && !/favicon/.test(m.text()) && errors.push(m.text().slice(0, 200)));
page.on("dialog", (d) => d.accept());
const toast = (text) => page.locator(".a-toast", { hasText: text }).first().waitFor({ timeout: 20000 });
const tile = (label) => page.locator(".a-strip > .a-sortable-item", { has: page.locator(`.a-slot-title:text-is("${label}"), .a-slot-open:text-is("${label}")`) });
const titles = () => page.locator(".a-strip > .a-sortable-item").evaluateAll((els) => els.map((e) => e.querySelector(".a-slot-title, .a-slot-open")?.textContent?.trim()));
// Côté public : même contexte (aucun aperçu actif, le site public est rendu
// comme pour un visiteur) et un seul onglet : un seul processus de rendu.
const pub = page;

async function moveWithKeyboard(handleName, key, times) {
  await page.getByRole("button", { name: handleName }).focus();
  await page.keyboard.press("Space");
  await page.waitForTimeout(200);
  for (let i = 0; i < times; i++) {
    await page.keyboard.press(key);
    await page.waitForTimeout(200);
  }
  await page.keyboard.press("Space");
  await page.waitForTimeout(400);
}
async function openSlot(label) {
  await tile(label).locator(".a-slot-image, .a-slot-open").first().click();
  await page.locator(".a-slot-panel").waitFor();
}
let projectId = null;

try {
  await page.goto(`${BASE}/admin/connexion`, { waitUntil: "networkidle" });
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]");
  await page.waitForURL(`${BASE}/admin`);

  // ---- Projet et envoi --------------------------------------------------------
  await page.goto(`${BASE}/admin/projets`, { waitUntil: "networkidle" });
  if (await page.locator(".a-project-card", { hasText: "Planche e2e" }).count()) throw new Error("un projet « Planche e2e » existe déjà : supprime-le d'abord");
  await page.getByRole("button", { name: "Nouveau projet" }).click();
  await page.locator("dialog[open]").getByLabel("Titre en français").fill("Planche e2e");
  await page.locator("dialog[open]").getByRole("button", { name: "Créer le projet" }).click();
  await page.waitForURL(/\/admin\/projets\/\d+$/);
  projectId = Number(page.url().split("/").pop());
  ok("P1 projet créé → éditeur de planche", projectId > 0);
  // v0.13 : la planche se pose sur la page Personnages (plus d'apparition automatique).
  {
    const editorUrl = page.url();
    ok("P1b planche du projet posée sur la page Personnages", await placeBoard(page, BASE, pageIdOf("personnages"), projectSlugOf(projectId)));
    await page.goto(editorUrl, { waitUntil: "networkidle" });
  }

  await page.locator(".a-strip-end input[type=file]").setInputFiles([FILES.grand, FILES.transparent, FILES.paysage]);
  await page.waitForFunction(
    () => document.querySelectorAll(".a-strip .a-slot").length === 3 && !document.querySelector('.a-strip .a-slot[data-status="processing"]'),
    null,
    { timeout: 120000 },
  );
  ok("P2 3 images déposées : 3 emplacements prêts, sans titre", (await titles()).join(",") === "Emplacement 1,Emplacement 2,Emplacement 3", (await titles()).join(","));
  // Le nom de fichier n'est jamais publié : ni dans le HTML ni dans le flux RSC.
  {
    const html = await (await fetch(`${BASE}/fr/personnages`)).text();
    ok("P2b aucun nom de fichier sur le site (images sans titre)", !/e2e-(grand|transparent|paysage)/.test(html) && html.includes("/media/img/"));
  }
  // Titre suggéré d'après le nom du fichier, appliqué d'un clic.
  for (const [i, title] of [[1, "E2e grand"], [2, "E2e transparent"], [3, "E2e paysage"]]) {
    await openSlot(`Emplacement ${i}`);
    const panelS = page.locator(".a-slot-panel");
    await panelS.getByRole("button", { name: `Titre suggéré : ${title}` }).click();
    await panelS.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await toast("Emplacement enregistré");
    await page.waitForTimeout(500);
  }
  ok("P2c titres suggérés appliqués", (await titles()).join(",") === "E2e grand,E2e transparent,E2e paysage", (await titles()).join(","));
  const w = await tile("E2e grand").evaluate((el) => el.getBoundingClientRect().width);
  ok("P3 orientation EXIF appliquée : emplacement portrait (180 × 2/3 = 120 px)", Math.abs(w - 120) <= 2, String(w));

  // ---- Réordonner, retirer, remplir, supprimer --------------------------------
  await moveWithKeyboard("Déplacer E2e paysage", "ArrowLeft", 2);
  await toast("Ordre de la planche enregistré");
  await page.waitForTimeout(800);
  ok("P4 réordonnée au clavier", (await titles()).join(",") === "E2e paysage,E2e grand,E2e transparent", (await titles()).join(","));

  await openSlot("E2e grand");
  await page.locator(".a-slot-panel").getByRole("button", { name: "Retirer l'image" }).click();
  ok("P5 confirmation nommant l'emplacement", /Retirer l'image de « E2e grand » \?/.test(await page.locator("dialog[open] h2").innerText()));
  await page.locator("dialog[open]").getByRole("button", { name: "Retirer l'image" }).click();
  await toast("Image retirée");
  await page.waitForTimeout(800);
  const wEmpty = await tile("E2e grand").evaluate((el) => el.getBoundingClientRect().width);
  ok("P6 la place reste, vide, à la largeur de l'image retirée", (await page.locator(".a-strip .a-slot-empty").count()) === 1 && (await titles()).length === 3 && Math.abs(wEmpty - 120) <= 2, String(wEmpty));

  await page.locator(".a-strip .a-slot-empty").getByRole("button", { name: "Choisir dans la médiathèque" }).click();
  const picker = page.locator("dialog[open]");
  await picker.getByPlaceholder("Rechercher par nom ou tag…").fill("e2e-grand");
  await picker.locator(".a-media-tile", { hasText: "e2e-grand.jpg" }).first().click();
  await toast("Image placée");
  await page.waitForTimeout(800);
  ok("P7 place remplie depuis la médiathèque", (await page.locator(".a-strip .a-slot-empty").count()) === 0);

  await page.locator(".a-sidepanel").getByRole("button", { name: "Fermer le panneau" }).click().catch(() => {});
  await openSlot("E2e transparent");
  await page.locator(".a-slot-panel").getByRole("button", { name: "Supprimer l'emplacement" }).click();
  await page.locator("dialog[open]").getByRole("button", { name: "Supprimer l'emplacement" }).click();
  await toast("Emplacement supprimé");
  await page.waitForTimeout(800);
  ok("P8 emplacement supprimé", (await titles()).join(",") === "E2e paysage,E2e grand", (await titles()).join(","));

  await openSlot("E2e grand");
  const panel = page.locator(".a-slot-panel");
  ok("P9 avertissement : texte alternatif manquant", await panel.locator(".a-notice", { hasText: "Texte alternatif manquant" }).isVisible());
  await panel.getByLabel("Texte alternatif de l'image", { exact: true }).fill("Rectangle jaune sur fond brique");
  await panel.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await toast("Emplacement enregistré");

  // ---- Côté public ------------------------------------------------------------
  await pub.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
  const strip = pub.locator("section", { has: pub.getByRole("heading", { name: "Planche e2e" }) }).first();
  await strip.waitFor({ timeout: 15000 });
  const pics = strip.locator(".strip-rail picture");
  ok("P10 public : 2 images dans l'ordre (paysage puis grand)", (await pics.count()) === 2 && (await strip.locator(".strip-rail img").nth(1).getAttribute("alt")) === "Rectangle jaune sur fond brique");
  const avif = await pics.first().locator('source[type="image/avif"]').getAttribute("srcset");
  const webp = await pics.first().locator('source[type="image/webp"]').getAttribute("srcset");
  ok("P11 srcset AVIF puis WebP, plusieurs largeurs", /\/media\/img\/[0-9a-f]{16}\/480\.avif 480w/.test(avif ?? "") && /\.webp \d+w/.test(webp ?? ""), `${avif} | ${webp}`);
  const html = await pub.content();
  ok("P12 l'original n'apparaît jamais, ni aucun nom de fichier", !html.includes("/media/originals/") && !/e2e-(grand|transparent|paysage)/.test(html));
  const r = await fetch(`${BASE}${(avif ?? "").split(" ")[0]}`);
  ok("P13 variante servie (image/avif, cache immuable)", r.status === 200 && r.headers.get("content-type") === "image/avif" && /immutable/.test(r.headers.get("cache-control") ?? ""));
  const buf = Buffer.from(await (await fetch(`${BASE}${(webp ?? "").split(", ").at(-1).split(" ")[0]}`)).arrayBuffer());
  const meta = await sharp(buf).metadata();
  ok("P14 aucune métadonnée EXIF/GPS dans les variantes", !meta.exif && !meta.xmp, JSON.stringify({ exif: Boolean(meta.exif) }));
  await strip.locator(".strip-rail button").nth(1).click();
  const lb = pub.locator('[role="dialog"]').first();
  await lb.waitFor();
  const lbAvif = await lb.locator('picture source[type="image/avif"]').first().getAttribute("srcset");
  ok("P15 visionneuse : la plus grande variante seulement", /\/2400\.avif$/.test(lbAvif ?? ""), lbAvif ?? "");
  await pub.keyboard.press("Escape");

  // Emplacement vide masqué côté public.
  await page.goto(`${BASE}/admin/projets/${projectId}`, { waitUntil: "networkidle" });
  await openSlot("E2e paysage");
  await page.locator(".a-slot-panel").getByRole("button", { name: "Retirer l'image" }).click();
  await page.locator("dialog[open]").getByRole("button", { name: "Retirer l'image" }).click();
  await toast("Image retirée");
  await pub.goto(`${BASE}/fr/personnages`, { waitUntil: "networkidle" });
  const strip2 = pub.locator("section", { has: pub.getByRole("heading", { name: "Planche e2e" }) }).first();
  ok("P16 emplacement vide masqué sur le site", (await strip2.locator(".strip-rail picture").count()) === 1);

  // ---- Médiathèque --------------------------------------------------------------
  await page.goto(`${BASE}/admin/medias`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("Rechercher par nom ou tag…").fill("portrait");
  await page.locator(".a-media-tile", { hasText: "portrait.svg" }).click();
  await page.locator(".a-sidepanel").getByRole("button", { name: "Supprimer l'image" }).click();
  await page.locator("dialog[open]").getByRole("button", { name: "Supprimer" }).click();
  await page.locator("dialog[open] .a-refs li").first().waitFor();
  ok("P17 suppression bloquée par un bloc, liste affichée", /Profil/.test(await page.locator("dialog[open] .a-refs").innerText()));
  await page.locator("dialog[open]").getByRole("button", { name: "Annuler" }).click();

  await page.getByPlaceholder("Rechercher par nom ou tag…").fill("e2e-grand");
  await page.locator(".a-media-tile", { hasText: "e2e-grand.jpg" }).click();
  await page.locator(".a-sidepanel .a-refs li").first().waitFor();
  await page.locator(".a-sidepanel").getByRole("button", { name: "Supprimer l'image" }).click();
  ok("P18 confirmation : les emplacements gardent leur place", /gardent leur place/.test(await page.locator("dialog[open]").innerText()));
  await page.locator("dialog[open]").getByRole("button", { name: "Supprimer" }).click();
  await toast("1 emplacement vidé");
  await page.goto(`${BASE}/admin/projets/${projectId}`, { waitUntil: "networkidle" });
  ok("P19 l'emplacement est vide, à sa place", (await page.locator(".a-strip .a-slot-empty").count()) === 2);
} catch (e) {
  failures++;
  console.log("FAIL exception :", e.message.split("\n")[0]);
  await page.screenshot({ path: "e2e-echec.png", fullPage: true }).catch(() => {});
}

// ---- Restauration : projet et images de test supprimés ------------------------------
try {
  await page.goto(`${BASE}/admin/projets`, { waitUntil: "networkidle" });
  // v0.13 : un projet cité par une page ne se supprime pas ; sa planche part d'abord.
  for (const slug of [projectId && projectSlugOf(projectId)].filter(Boolean)) await removeBoard(page, BASE, pageIdOf("personnages"), slug);
  await page.goto(`${BASE}/admin/projets`, { waitUntil: "networkidle" });
  while (await page.locator(".a-project-card", { hasText: "Planche e2e" }).count()) {
    await page.locator(".a-project-card", { hasText: "Planche e2e" }).first().getByRole("button", { name: "Supprimer" }).click();
    await page.locator("dialog[open]").getByRole("button", { name: "Supprimer le projet" }).click();
    await toast("supprimé");
    await page.reload({ waitUntil: "networkidle" });
  }
  await page.goto(`${BASE}/admin/medias`, { waitUntil: "networkidle" });
  await page.getByPlaceholder("Rechercher par nom ou tag…").fill("e2e-");
  while (await page.locator(".a-media-tile").count()) {
    await page.locator(".a-media-tile").first().click();
    await page.locator(".a-sidepanel").getByRole("button", { name: "Supprimer l'image" }).click();
    await page.locator("dialog[open]").getByRole("button", { name: "Supprimer" }).click();
    await toast("Image supprimée");
    await page.waitForTimeout(600);
  }
  ok("Z1 état initial restauré (projet et images de test supprimés)", (await page.locator(".a-media-tile").count()) === 0);
} catch (e) {
  failures++;
  console.log("FAIL restauration :", e.message.split("\n")[0]);
}

ok("Z aucune erreur JavaScript dans l'admin", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `e2e-planche : ${failures} échec(s)` : "e2e-planche : OK");
process.exit(failures ? 1 : 0);
