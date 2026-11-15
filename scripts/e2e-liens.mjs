#!/usr/bin/env node
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { makePdf } from "./lib/medias-setup.mjs";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");

const DB = path.join(process.env.DATA_DIR ?? "data", "portfolio.db");
const q1 = (sql, ...args) => {
  const db = new Database(DB, { readonly: true });
  try { return db.prepare(sql).get(...args); } finally { db.close(); }
};

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

await login();

// ---- PDF de test ---------------------------------------------------------
const pdfName = "lot3-cv.pdf";
let pdfRow = q1("select id, status from media where original_name = ? order by id desc", pdfName);
if (!pdfRow) {
  const file = makePdf(2, pdfName);
  await page.goto(`${BASE}/admin/medias`, { waitUntil: "networkidle" });
  await page.locator("input[type=file]").first().setInputFiles(file);
  // attendre traitement
  for (let i = 0; i < 60; i++) {
    pdfRow = q1("select id, status from media where original_name = ? order by id desc", pdfName);
    if (pdfRow?.status === "ready") break;
    await page.waitForTimeout(2000);
  }
}
ok("PDF de test prêt", pdfRow?.status === "ready", JSON.stringify(pdfRow));

const imgRow = q1("select original_name from media where kind = 'image' and status = 'ready' and deleted_at is null limit 1");
const vidRow = q1("select original_name from media where kind = 'video' and status = 'ready' and deleted_at is null limit 1");
ok("image de test présente", !!imgRow?.original_name);
ok("vidéo de test présente", !!vidRow?.original_name);

async function createLink(slug, title, mediaName, allowDownload = true, enabled = true) {
  await page.goto(`${BASE}/admin/liens`, { waitUntil: "networkidle" });
  await page.getByTestId("link-create").click();
  const form = page.getByTestId("link-form");
  await form.getByTestId("link-slug").fill(slug);
  await form.getByTestId("link-title-fr").fill(title);
  await form.getByTestId("link-pick-media").click();
  const dialog = page.locator("dialog[open]");
  await dialog.getByTitle(mediaName).click();
  await page.waitForTimeout(800);
  const cbDl = form.getByTestId("link-allow-download");
  if (allowDownload) await cbDl.check(); else await cbDl.uncheck();
  const swEn = form.getByTestId("link-enabled-switch");
  const enState = await swEn.getAttribute("aria-checked");
  if (enabled && enState !== "true") await swEn.click();
  if (!enabled && enState === "true") await swEn.click();
  await form.getByTestId("link-save").click();
  await page.waitForTimeout(1500);
}

const suffix = Date.now();
const slugPdf = `cv-test-${suffix}`;
const slugImg = `img-test-${suffix}`;
const slugVid = `vid-test-${suffix}`;

await createLink(slugPdf, "CV test", pdfName, true, true);
await createLink(slugImg, "Image test", imgRow.original_name, false, true);
await createLink(slugVid, "Vidéo test", vidRow.original_name, true, true);

// ---- Vérifications publiques --------------------------------------------
for (const [slug, expectDl] of [[slugPdf, true], [slugImg, false], [slugVid, true]]) {
  const res = await fetch(`${BASE}/fr/l/${slug}`);
  const html = await res.text();
  ok(`${slug} : 200`, res.status === 200, String(res.status));
  ok(`${slug} : noindex`, /noindex/.test(html));
  ok(`${slug} : titre présent`, html.includes("test"));
  ok(`${slug} : bouton téléchargement ${expectDl ? "présent" : "absent"}`, expectDl ? html.includes(`data-testid="share-download"`) : !html.includes(`data-testid="share-download"`));
}

// désactivation
await page.goto(`${BASE}/admin/liens`, { waitUntil: "networkidle" });
const row = page.locator("[data-testid='link-row']", { hasText: slugPdf });
await row.getByTestId("link-edit").click();
const form = page.getByTestId("link-form");
const swDis = form.getByTestId("link-enabled-switch");
if (await swDis.getAttribute("aria-checked") === "true") await swDis.click();
await form.getByTestId("link-save").click();
await page.waitForTimeout(1500);
const resDisabled = await fetch(`${BASE}/fr/l/${slugPdf}`);
ok("lien désactivé : 404", resDisabled.status === 404, String(resDisabled.status));

// suppression
await page.goto(`${BASE}/admin/liens`, { waitUntil: "networkidle" });
const row2 = page.locator("[data-testid='link-row']", { hasText: slugPdf });
await row2.getByTestId("link-delete").click();
await page.locator("dialog[open]").getByRole("button", { name: "Supprimer" }).click();
await page.waitForTimeout(1500);
const resDeleted = await fetch(`${BASE}/fr/l/${slugPdf}`);
ok("lien supprimé : 404", resDeleted.status === 404, String(resDeleted.status));

// slug déjà pris
const before = q1("select count(*) n from share_links").n;
await createLink(slugImg, "doublon", imgRow.original_name, true, true);
ok("slug déjà pris : message d'erreur", await page.getByText("déjà pris").first().isVisible());
ok("slug déjà pris : aucun lien ajouté", q1("select count(*) n from share_links").n === before);

// redirection sans langue
const r = await fetch(`${BASE}/l/${slugImg}`, { redirect: "manual" });
ok("/l/slug redirige", r.status === 307 || r.status === 308 || r.status === 302 || r.status === 301, String(r.status));
const loc = r.headers.get("location") || "";
ok("redirection vers /fr/l/slug", loc.includes(`/fr/l/${slugImg}`), loc);

// média lié apparaît comme utilisé : vérifier share_links table
const cnt = q1("select count(*) n from share_links").n;
ok("liens en base", cnt >= 2, String(cnt));



// ---- Audio (lecteur intégré) ----------------------------------------------
const wavName = `audio-test-${suffix}.wav`;
const wavPath = path.join("/tmp/opencode", wavName);
// WAV 1 s de silence, en-tête RIFF écrit à la main.
const sampleRate = 8000;
const numSamples = sampleRate;
const dataSize = numSamples * 2;
const buf = Buffer.alloc(44 + dataSize);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write("WAVE", 8);
buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
buf.write("data", 36); buf.writeUInt32LE(dataSize, 40);
fs.mkdirSync(path.dirname(wavPath), { recursive: true });
fs.writeFileSync(wavPath, buf);

const slugAudioNoDl = `audio-nodl-${suffix}`;
const slugAudioDl = `audio-dl-${suffix}`;

async function createAudioLink(slug, allowDownload) {
  await page.goto(`${BASE}/admin/liens`, { waitUntil: "networkidle" });
  await page.getByTestId("link-create").click();
  const form = page.getByTestId("link-form");
  await form.getByTestId("link-slug").fill(slug);
  await form.getByTestId("link-title-fr").fill("Audio test");
  await form.locator('input[type="file"]').first().setInputFiles(wavPath);
  for (let i = 0; i < 60; i++) {
    const r = q1("select id, status from media where original_name = ? order by id desc", wavName);
    if (r?.status === "ready") break;
    await page.waitForTimeout(2000);
  }
  await page.waitForTimeout(1000);
  const cbDl = form.getByTestId("link-allow-download");
  if (allowDownload) await cbDl.check().catch(() => {}); else await cbDl.uncheck().catch(() => {});
  const swEn = form.getByTestId("link-enabled-switch");
  if (await swEn.getAttribute("aria-checked") !== "true") await swEn.click();
  await form.getByTestId("link-save").click();
  await page.waitForTimeout(1500);
}

await createAudioLink(slugAudioNoDl, false);
await createAudioLink(slugAudioDl, true);

// Page sans téléchargement : lecteur audio, pas de bouton
const resNoDl = await fetch(`${BASE}/fr/l/${slugAudioNoDl}`);
const htmlNoDl = await resNoDl.text();
ok("audio no-dl : 200", resNoDl.status === 200, String(resNoDl.status));
ok("audio no-dl : <audio>", /<audio/.test(htmlNoDl));
ok("audio no-dl : pas de bouton", !htmlNoDl.includes('data-testid="share-download"'));

// Page avec téléchargement : bouton présent
const resDl = await fetch(`${BASE}/fr/l/${slugAudioDl}`);
const htmlDl = await resDl.text();
ok("audio dl : bouton présent", htmlDl.includes('data-testid="share-download"'));

// Service du média : audio/wav, pas attachment, Range -> 206
const audioRow = q1("select key from media where original_name = ? and kind = 'audio' order by id desc", wavName);
const mediaUrl = `${BASE}/media/${audioRow.key}`;
const rHead = await fetch(mediaUrl);
ok("audio media : 200", rHead.status === 200, String(rHead.status));
ok("audio media : Content-Type audio/wav", (rHead.headers.get("content-type") || "").includes("audio/wav"), rHead.headers.get("content-type") || "");
ok("audio media : pas attachment", !(rHead.headers.get("content-disposition") || "").includes("attachment"));
const rRange = await fetch(mediaUrl, { headers: { Range: "bytes=0-99" } });
ok("audio media : Range -> 206", rRange.status === 206, String(rRange.status));

// Téléchargement forcé
const rDl = await fetch(`${mediaUrl}?name=mon-audio&dl=1`);
ok("audio media dl : attachment", (rDl.headers.get("content-disposition") || "").includes("attachment"), rDl.headers.get("content-disposition") || "");


// ---- Nouveaux comportements (modale, aperçu, interrupteur) ------------------
await page.goto(`${BASE}/admin/liens`, { waitUntil: "networkidle" });
await page.getByTestId("link-create").click();
ok("formulaire dans dialog[open]", await page.locator("dialog[open][data-testid='link-form']").count() === 1);
await page.getByTestId("link-cancel").click();
await page.waitForTimeout(300);

// normalisation du slug pendant la frappe
await page.getByTestId("link-create").click();
const fNorm = page.getByTestId("link-form");
await fNorm.getByTestId("link-slug").fill("Bande_Demo");
const slugNorm = await fNorm.getByTestId("link-slug").inputValue();
ok("slug normalisé pendant la frappe", slugNorm === "bande-demo", slugNorm);
const addrText = (await fNorm.locator("p.mono").first().textContent()) || "";
ok("adresse finale affichée", addrText.endsWith("/l/bande-demo"), addrText);
await fNorm.getByTestId("link-cancel").click();
await page.waitForTimeout(300);

// aucune balise média dans la liste par défaut
const mediaInList = await page.locator("[data-testid='link-row'] img, [data-testid='link-row'] video, [data-testid='link-row'] audio").count();
ok("aucun média dans la liste par défaut", mediaInList === 0);

// aperçu s'ouvre et se ferme
const firstRow = page.locator("[data-testid='link-row']").first();
await firstRow.getByTestId("link-preview").click();
await page.waitForTimeout(500);
ok("aperçu ouvert", await page.locator("[data-testid='link-preview-dialog'][open]").count() === 1);
await page.keyboard.press("Escape");
await page.waitForTimeout(500);
ok("aperçu fermé", await page.locator("[data-testid='link-preview-dialog'][open]").count() === 0);

// ---- Remplacement du fichier d'un lien -------------------------------------
const slugPdfReplace = `pdf-replace-${suffix}`;
await createLink(slugPdfReplace, "Titre PDF remplace", pdfName, true, true);

const replaceRow = page.locator("[data-testid='link-row']", { hasText: slugPdfReplace }).first();
await replaceRow.getByTestId("link-replace").click();
await page.waitForTimeout(800);
await page.locator("dialog[open]").getByTitle(imgRow.original_name).click();
await page.waitForTimeout(2000);

const resReplace = await fetch(`${BASE}/fr/l/${slugPdfReplace}`);
const htmlReplace = await resReplace.text();
ok("remplacement : 200", resReplace.status === 200, String(resReplace.status));
ok("remplacement : image affichée", /<img|<picture/.test(htmlReplace));
ok("remplacement : titre conservé", htmlReplace.includes("remplace"));

// interrupteur de ligne : coupe puis rallume sans recharger
const switchRow = page.locator("[data-testid='link-row']", { hasText: slugImg }).first();
const rowSwitch = switchRow.getByTestId("link-enabled-switch");
if (await rowSwitch.getAttribute("aria-checked") !== "true") await rowSwitch.click();
await page.waitForTimeout(500);
await rowSwitch.click();
await page.waitForTimeout(1200);
const rOff = await fetch(`${BASE}/fr/l/${slugImg}`);
ok("interrupteur ligne désactivé -> 404", rOff.status === 404, String(rOff.status));
await rowSwitch.click();
await page.waitForTimeout(1200);
const rOn = await fetch(`${BASE}/fr/l/${slugImg}`);
ok("interrupteur ligne réactivé -> 200", rOn.status === 200, String(rOn.status));

await browser.close();
console.log(`\n${failures === 0 ? "OK" : failures + " ECHEC(S)"}`);
process.exit(failures === 0 ? 0 : 1);