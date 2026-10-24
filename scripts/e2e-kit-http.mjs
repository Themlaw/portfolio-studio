#!/usr/bin/env node
/**
 * Kit Photoshop v4 (lot 17e) de bout en bout, SANS navigateur (HTTP + base) : serveur
 * dev requis (redémarré puis pré-chauffé), un compte admin. Pendant de e2e-kit.mjs
 * (playwright) quand chromium n'est pas disponible.
 *
 *  H1. Export : l'archive .zip (3 PSD + LISEZ-MOI.txt), pièce jointe, mise en cache.
 *  H2. Envoi : refus d'un PNG nommé .psd, d'une archive sans PSD, d'un « .zip » qui n'en est pas un ;
 *      l'archive entière, un seul PSD, deux PSD d'un envoi groupé ; lot refermé refusé.
 *  H3. Revue (HTML du serveur) : groupée par fichier, « pas envoyé : inchangé », décor libre, résumé.
 *  H4. Application : copie brouillon (décor libre de 4 plans, `plansOnly`) ; flèche de l'artiste et son miroir ;
 *      thème en ligne inchangé.
 *  H5. Aller-retour sans fin : le kit de la copie réimporté tel quel → rien de modifié.
 *  H6. Ancien kit (fichier réel de l'artiste) : toujours reçu et lu, sans titre de fichier.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… [BASE=http://localhost:3001] [DATA_DIR=./data] node scripts/e2e-kit-http.mjs
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const DATA = process.env.DATA_DIR ?? "./data";
const DIR = path.join(tmpdir(), "e2e-kit-http");
mkdirSync(DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};

/* ---- Session ---------------------------------------------------------------- */
const login = await fetch(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
if (!login.ok || !cookie) throw new Error(`connexion refusée (${login.status})`);
const H = { cookie, origin: BASE };
const get = (u, extra = {}) => fetch(`${BASE}${u}`, { headers: { cookie }, ...extra });

/* ---- Outils : envoi par morceaux, attente d'un import ------------------------ */
async function upload(data, name, { themeId = "galerie-lumineuse", batch, type = "application/octet-stream" } = {}) {
  const init = await fetch(`${BASE}/admin/api/upload/init`, { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ name, size: data.length, type, purpose: { kind: "kit", themeId, ...(batch ? { batch } : {}) } }) });
  const ib = await init.json().catch(() => ({}));
  if (init.status !== 200) return { stage: "init", status: init.status, body: ib };
  const id = ib.upload.id;
  for (let offset = 0; offset < data.length; ) {
    const part = data.subarray(offset, offset + 8 * 1024 * 1024);
    const r = await fetch(`${BASE}/admin/api/upload/${id}/chunk?offset=${offset}`, { method: "PUT", headers: { ...H, "content-length": String(part.length) }, body: part });
    const b = await r.json().catch(() => ({}));
    if (r.status !== 200) return { stage: "chunk", status: r.status, body: b };
    offset = b.upload.offset;
  }
  const done = await fetch(`${BASE}/admin/api/upload/${id}/complete`, { method: "POST", headers: H });
  return { stage: "complete", status: done.status, body: await done.json().catch(() => ({})) };
}
async function waitImport(themeId, id, ms = 240000) {
  const end = Date.now() + ms;
  let st = {};
  while (Date.now() < end && id) {
    st = await (await get(`/admin/api/theme-kit/${themeId}/import/${id}`)).json().catch(() => ({}));
    if (st.status === "done" || st.status === "failed") break;
    await sleep(1000);
  }
  return st;
}
const rapportOf = (id) => JSON.parse(readFileSync(path.join(DATA, "kit-imports", id, "out", "rapport.json"), "utf8"));
const tsx = (code) => execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], { env: { ...process.env, DATA_DIR: DATA }, encoding: "utf8" });
const themeData = (id) =>
  JSON.parse(
    tsx(`import { getDb, schema } from "./src/lib/db/index.ts"; import { eq } from "drizzle-orm";
     console.log(getDb().select().from(schema.themes).where(eq(schema.themes.id, ${JSON.stringify(id)})).get()?.data ?? "null");`),
  );
const sim = (...args) => execFileSync(process.execPath, ["--import", "tsx", "scripts/kit-poc/simulate-multi.mts", ...args], { stdio: "ignore" });
const created = [];

/* ---- H1. Export -------------------------------------------------------------- */
const kitUrl = "/admin/api/theme-kit/galerie-lumineuse";
let ready = false;
for (let i = 0; i < 120 && !ready; i++) {
  ready = (await (await fetch(`${BASE}${kitUrl}`, { method: "POST", headers: H })).json()).ready === true;
  if (!ready) await sleep(2000);
}
ok("H1 export du kit v4 (file lourde) prêt", ready);
const dl = await get(kitUrl);
const zipBytes = Buffer.from(await dl.arrayBuffer());
ok("H1 archive .zip en pièce jointe (kit-galerie-lumineuse.zip)", dl.ok && /application\/zip/.test(dl.headers.get("content-type") ?? "") && /attachment; filename="kit-galerie-lumineuse\.zip"/.test(dl.headers.get("content-disposition") ?? "") && zipBytes.subarray(0, 2).toString("latin1") === "PK");
const kitZip = path.join(DIR, "kit-v4.zip");
writeFileSync(kitZip, zipBytes);
const parts = path.join(DIR, "parts");
sim("extract", kitZip, parts);
ok("H1 trois PSD (8BPS) dans l'archive, sous leurs noms d'export", ["1-decor-accueil.psd", "2-logo-papier.psd", "3-icones-curseurs.psd"].every((n) => existsSync(path.join(parts, n)) && readFileSync(path.join(parts, n)).subarray(0, 4).toString("latin1") === "8BPS"));
const iconPsd = path.join(DIR, "icones-modifie.psd");
const decorPsd = path.join(DIR, "decor-libre.psd");
const zipEdited = path.join(DIR, "kit-v4-modifie.zip");
sim("icone", kitZip, iconPsd);
sim("decor", kitZip, decorPsd);
sim("zip", kitZip, zipEdited, iconPsd);
const bytes = (f) => readFileSync(f);

/* ---- H2. Refus ------------------------------------------------------------------ */
const png = await sharp({ create: { width: 640, height: 360, channels: 3, background: "#6c8ebf" } }).png().toBuffer();
const badPng = await upload(png, "pas-un-kit.psd");
ok("H2 PNG nommé .psd : 415, message clair", badPng.status === 415 && /pas un fichier Photoshop/.test(badPng.body.message ?? ""), `${badPng.status} ${badPng.body.message}`);
const notZip = await upload(Buffer.from("PK ce n'est pas une archive ".repeat(20)), "faux.zip");
ok("H2 « .zip » qui n'en est pas un : refusé (415)", notZip.status === 415 && /zip/i.test(notZip.body.message ?? ""), `${notZip.status} ${notZip.body.message}`);
// Archive légitime sans aucun PSD (un PNG dedans).
const noPsdZip = path.join(DIR, "sans-psd.zip");
execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `import { writeZipFile } from "./src/lib/kit/zip-archive.ts"; await writeZipFile(${JSON.stringify(noPsdZip)}, [{ name: "image.png", data: Buffer.from(${JSON.stringify(png.toString("base64"))}, "base64") }]);`]);
const noPsd = await upload(bytes(noPsdZip), "sans-psd.zip", { type: "application/zip" });
ok("H2 archive sans aucun PSD : refusée (422), message clair", noPsd.status === 422 && /Aucun fichier Photoshop/.test(noPsd.body.message ?? ""), `${noPsd.status} ${noPsd.body.message}`);
const badExt = await upload(Buffer.from("x"), "kit.png");
ok("H2 extension .png : refusée avant tout octet (415)", badExt.status === 415, String(badExt.status));
const tooMany = await upload(bytes(kitZip), "x.zip", { batch: { id: "11111111-2222-4333-8444-555555555555", last: true } });
ok("H2 archive dans un envoi groupé : refusée", tooMany.status === 400, `${tooMany.status} ${tooMany.body.message}`);

/* ---- H2/H3. L'archive entière (icônes retouchées dedans) ---------------------------------- */
const upZip = await upload(bytes(zipEdited), "kit-v4-modifie.zip", { type: "application/zip" });
const idZip = upZip.body.kitImport?.id;
const stZip = await waitImport("galerie-lumineuse", idZip);
const rZip = stZip.status === "done" ? rapportOf(idZip) : null;
ok("H2 archive entière : importée, 17 éléments (décor 5, logo 4, icônes 8), seule la flèche droite redessinée", upZip.status === 200 && rZip?.slots.length === 17 && rZip.slots.filter((s) => s.change === "redrawn").map((s) => s.id).join() === "icones/fleche-droite" && rZip.files.map((f) => `${f.id}:${f.slots}`).join() === "decor:5,logo:4,icones:8", JSON.stringify({ st: stZip, f: rZip?.files }));
ok("H2 archive : les PSD extraits sont supprimés après l'import", !readdirSync(path.join(DATA, "kit-imports", idZip)).some((n) => /\.psd$/.test(n)));
const htmlZip = await (await get(`/admin/themes/galerie-lumineuse/kit?import=${idZip}`)).text();
ok("H3 revue de l'archive : un bloc par fichier, tous reçus, flèche droite redessinée", ["decor", "logo", "icones"].every((f) => new RegExp(`data-file="${f}" data-received="true"`).test(htmlZip)) && htmlZip.includes("Flèche droite : redessinée"), htmlZip.slice(0, 0));

/* ---- Un seul PSD : les autres fichiers « pas envoyé : inchangé » ------------------------------- */
const upOne = await upload(bytes(iconPsd), "icones-modifie.psd");
const idOne = upOne.body.kitImport?.id;
const stOne = await waitImport("galerie-lumineuse", idOne);
const rOne = stOne.status === "done" ? rapportOf(idOne) : null;
const htmlOne = await (await get(`/admin/themes/galerie-lumineuse/kit?import=${idOne}`)).text();
ok("H2 un seul PSD (nom quelconque) : reconnu comme le fichier d'icônes, 8 éléments", rOne?.files.map((f) => `${f.id}:${f.received}`).join() === "decor:false,logo:false,icones:true" && rOne.slots.length === 8 && rOne.reference?.how === "identifiant", JSON.stringify(rOne?.files));
ok("H3 revue d'un seul PSD : « pas envoyé : inchangé » pour le décor et le logo", (htmlOne.match(/pas envoyé : inchangé/g) ?? []).length >= 2 && /data-file="decor" data-received="false"/.test(htmlOne) && /data-file="logo" data-received="false"/.test(htmlOne));

/* ---- Deux PSD choisis ensemble : envoi groupé, décor libre ------------------------------------- */
const batchId = "6f1d5c1e-8a53-4c0f-9d6e-3b2a7c9e4f10";
const b1 = await upload(bytes(decorPsd), "decor-libre.psd", { batch: { id: batchId, last: false } });
const midJobs = tsx(`import { getDb, schema } from "./src/lib/db/index.ts"; console.log(getDb().select().from(schema.jobs).all().filter((j) => j.kind === "kit-import" && JSON.stringify(j.payload).includes(${JSON.stringify(batchId)})).length);`).trim();
ok("H2 envoi groupé : le premier fichier ne lance PAS l'import", b1.status === 200 && b1.body.kitImport?.id === batchId && midJobs === "0", `${b1.status} jobs=${midJobs}`);
const b2 = await upload(bytes(iconPsd), "icones-modifie.psd", { batch: { id: batchId, last: true } });
const stBatch = await waitImport("galerie-lumineuse", batchId);
const rBatch = stBatch.status === "done" ? rapportOf(batchId) : null;
ok("H2 envoi groupé : le dernier lance un seul import des deux fichiers (décor 4 plans, logo « pas envoyé », icônes 8)", b2.status === 200 && rBatch?.files.map((f) => `${f.id}:${f.received}:${f.slots}`).join() === "decor:true:4,logo:false:0,icones:true:8", JSON.stringify({ b2: b2.status, f: rBatch?.files, st: stBatch }));
const reopened = await upload(bytes(iconPsd), "icones-modifie.psd", { batch: { id: batchId, last: true } });
ok("H2 lot refermé : un fichier de plus est refusé (409)", reopened.status === 409, `${reopened.status} ${reopened.body.message}`);
const decorPlans = rBatch?.slots.filter((s) => s.id.startsWith("decor/")) ?? [];
ok("H3 décor libre : 4 plans, 3 inchangés (copies de plans exportés, rangs 0, 2, 4), « mes nuages » redessiné", decorPlans.length === 4 && decorPlans.map((s) => s.from ?? "-").join() === "0,-,2,4" && decorPlans.filter((s) => s.change === "redrawn").length === 1 && /mes nuages/.test(decorPlans[1].label), JSON.stringify(decorPlans.map((s) => [s.id, s.change, s.from, s.label])));
const htmlBatch = await (await get(`/admin/themes/galerie-lumineuse/kit?import=${batchId}`)).text();
ok("H3 revue : résumé du décor « composition changée », fichier logo « pas envoyé : inchangé », carte « mes nuages »", /composition changée/.test(htmlBatch) && /data-file="logo" data-received="false"/.test(htmlBatch) && /mes nuages/.test(htmlBatch) && /data-slot="decor\/2"/.test(htmlBatch));
const imgs = (await Promise.all(["decor--1/avant", "decor--2/apres", "decor--3/avant"].map(async (p) => (await get(`/admin/api/theme-kit/galerie-lumineuse/import/${batchId}/preview/${p}`)).status))).join();
ok("H3 aperçus du décor : « avant » du plan inchangé (plan exporté), « après » du plan redessiné", imgs === "200,200,200", imgs);

/* ---- H4. Application : copie brouillon ------------------------------------------------------------ */
const activeBefore = tsx(`import { getDb, schema } from "./src/lib/db/index.ts"; import { eq } from "drizzle-orm"; console.log(getDb().select().from(schema.settings).where(eq(schema.settings.key, "activeThemeId")).get()?.value ?? "");`).trim();
const sourceBefore = JSON.stringify(themeData("galerie-lumineuse"));
const applied = tsx(`import { applyKitImport } from "./src/lib/kit/apply.ts"; console.log(JSON.stringify(await applyKitImport("galerie-lumineuse", ${JSON.stringify(batchId)}, { mirror: true })));`);
const appliedJson = JSON.parse(applied.trim().split("\n").pop());
const draftId = appliedJson.data?.id;
if (draftId) created.push(draftId);
const draft = draftId ? themeData(draftId) : null;
ok("H4 application : copie brouillon (non active), décor libre de 4 plans qui remplacent TOUT le décor (plansOnly)", appliedJson.ok === true && draft?.preset === false && draft.assets.kit.plansOnly === true && draft.assets.kit.plans.length === 4 && draft.assets.kit.plans.every((p) => p && p.w <= 2880 && p.h <= 1600), applied.slice(0, 200));
const arrowUrl = draft?.assets?.kit?.icons?.arrowRight?.svg;
const leftUrl = draft?.assets?.kit?.icons?.arrowLeft?.svg;
const served = arrowUrl ? await fetch(`${BASE}${arrowUrl}`) : null;
const leftSvg = leftUrl ? await (await fetch(`${BASE}${leftUrl}`)).text() : "";
ok("H4 application : flèche de l'artiste (réduite à 128 × 128, masque SVG) et son miroir", served?.status === 200 && /svg/.test(served.headers.get("content-type") ?? "") && leftUrl !== arrowUrl && /matrix\(-1 0 0 1 128 0\)/.test(leftSvg), `${arrowUrl} ${served?.status}`);
const sourceAfter = JSON.stringify(themeData("galerie-lumineuse"));
const activeAfter = tsx(`import { getDb, schema } from "./src/lib/db/index.ts"; import { eq } from "drizzle-orm"; console.log(getDb().select().from(schema.settings).where(eq(schema.settings.key, "activeThemeId")).get()?.value ?? "");`).trim();
ok("H4 application : thème source et thème en ligne inchangés", sourceAfter === sourceBefore && activeAfter === activeBefore);
// L'accueil de la copie (4 plans, aucun calque SVG du thème en plus) : heroStack (test-theme-kit) et e2e-kit.mjs (navigateur).

/* ---- H5. Aller-retour sans fin ------------------------------------------------------------------------ */
let draftReady = {};
for (let i = 0; i < 120 && !draftReady.ready; i++) {
  draftReady = await (await fetch(`${BASE}/admin/api/theme-kit/${draftId}`, { method: "POST", headers: H })).json().catch(() => ({}));
  if (!draftReady.ready) await sleep(2000);
}
const draftZip = Buffer.from(await (await get(`/admin/api/theme-kit/${draftId}`)).arrayBuffer());
const again = await upload(draftZip, `kit-${draftId}.zip`, { themeId: draftId, type: "application/zip" });
const stAgain = await waitImport(draftId, again.body.kitImport?.id);
const rAgain = stAgain.status === "done" ? rapportOf(again.body.kitImport.id) : null;
const modified = rAgain?.slots.filter((s) => s.change !== "unchanged") ?? [];
ok(`H5 kit de la copie (décor de 4 plans + flèche de l'artiste) réimporté tel quel : ${rAgain?.slots.length} éléments, 0 modifié`, draftReady.ready && rAgain?.reference?.how === "identifiant" && rAgain.slots.length === 16 && modified.length === 0 && rAgain.decor?.structure === "unchanged" && rAgain.decor.count === 4, JSON.stringify({ n: rAgain?.slots.length, modified: modified.map((s) => `${s.id}:${s.change}`), decor: rAgain?.decor }));

/* ---- H6. Ancien kit mono-fichier (fichier réel de l'artiste) ---------------------------------------------- */
const manifests = path.join(DATA, "cache/kits/manifests");
mkdirSync(manifests, { recursive: true });
if (!existsSync(path.join(manifests, "legacy-galerie-lumineuse-v1.json"))) copyFileSync("tests/fixtures/kit-galerie-lumineuse-v1.manifest.json", path.join(manifests, "legacy-galerie-lumineuse-v1.json"));
const legacy = await upload(bytes("tests/fixtures/kit-synthetique.psd"), "kit-synthetique.psd");
const stLegacy = await waitImport("galerie-lumineuse", legacy.body.kitImport?.id);
const rLegacy = stLegacy.status === "done" ? rapportOf(legacy.body.kitImport.id) : null;
const htmlLegacy = await (await get(`/admin/themes/galerie-lumineuse/kit?import=${legacy.body.kitImport?.id}`)).text();
ok("H6 ancien kit v1 : reçu et lu (14 éléments, seule la flèche droite redessinée), sans titre de fichier", rLegacy?.layout === "v1" && rLegacy.slots.length === 14 && rLegacy.slots.filter((s) => s.change === "redrawn").map((s) => s.id).join() === "icones/fleche-droite" && !/data-file=/.test(htmlLegacy) && htmlLegacy.includes("Flèche droite : redessinée"), JSON.stringify({ l: rLegacy?.layout, n: rLegacy?.slots.length }));

// Ménage : copies brouillon et imports créés par ce parcours.
tsx(`import { getDb, schema } from "./src/lib/db/index.ts"; import { inArray } from "drizzle-orm";
 getDb().delete(schema.themes).where(inArray(schema.themes.id, ${JSON.stringify(created)})).run();`);
console.log(`brouillons supprimés : ${created.join(", ")}`);
if (failures) {
  console.error(`e2e-kit-http : ${failures} échec(s)`);
  process.exit(1);
}
console.log("e2e-kit-http : OK");
