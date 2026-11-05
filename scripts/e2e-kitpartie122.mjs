#!/usr/bin/env node
/**
 * Lot 122 : kit Photoshop PAR PARTIE (téléchargement et réimport). Données SYNTHÉTIQUES : le kit est
 * exporté par le serveur, les retouches sont simulées (simulate-multi.mts) ; aucun fichier réel.
 *
 *  P1  Export prêt : l'API donne les trois parties (fichier, libellé, éléments, poids) et la durée.
 *  P2  Archive complète : inchangée (pièce jointe kit-<thème>.zip, trois PSD + LISEZ-MOI).
 *  P3  Chaque partie : UN .psd (8BPS), pièce jointe au nom du fichier du kit, mêmes octets et même
 *      structure de calques (noms, rectangles, groupes) que dans l'archive.
 *  P4  Refus : partie inconnue (400), thème inconnu (404), sans session (pas de fichier).
 *  P5  Réimport d'une seule partie retouchée (icônes, logo, décor) : seule cette partie est lue,
 *      seuls ses éléments retouchés changent ; à l'application, le reste du thème est strictement
 *      identique ; l'export du thème obtenu a les mêmes empreintes pour tout ce qui n'a pas été touché.
 *  P6  Réimport de l'archive complète : comme avant (17 éléments, une flèche redessinée) ; l'archive
 *      telle que téléchargée : rien de modifié.
 *  P7  Anciennes données : kit en cache sans fichier de durée (.meta) : tout marche, durée absente.
 *  P8  Page Kit (navigateur) : trois entrées avec libellé, éléments et poids ; chaque bouton
 *      télécharge le bon fichier ; le bouton du kit complet télécharge toujours le .zip.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [SHOTS=dossier] node scripts/e2e-kitpartie122.mjs
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { chromium } from "playwright";

import { login as pageLogin } from "./lib/medias-setup.mjs";

const BASE = process.env.BASE ?? "http://localhost:3001";
const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;
if (!EMAIL || !PASSWORD) throw new Error("Définir ADMIN_EMAIL et ADMIN_PASSWORD");
const DATA = process.env.DATA_DIR ?? "./data";
const SHOTS = process.env.SHOTS ?? path.join(tmpdir(), "e2e-kitpartie122");
const DIR = path.join(tmpdir(), "e2e-kitpartie122-work");
rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
const THEME = "galerie-lumineuse";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};

const login = await fetch(`${BASE}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ email: EMAIL, password: PASSWORD }) });
const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
if (!login.ok || !cookie) throw new Error(`connexion refusée (${login.status})`);
const H = { cookie, origin: BASE };
const get = (u) => fetch(`${BASE}${u}`, { headers: { cookie } });

async function upload(data, name, { themeId = THEME, type = "application/octet-stream" } = {}) {
  const init = await fetch(`${BASE}/admin/api/upload/init`, { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify({ name, size: data.length, type, purpose: { kind: "kit", themeId } }) });
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
const tree = (file) => JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "scripts/kit-poc/psd-tree.mts", file], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim().split("\n").pop());
const ready = async (themeId) => {
  let body = {};
  for (let i = 0; i < 120 && !body.ready; i++) {
    body = await (await fetch(`${BASE}/admin/api/theme-kit/${themeId}`, { method: "POST", headers: H })).json().catch(() => ({}));
    if (!body.ready) await sleep(2000);
  }
  return body;
};
const created = [];
const ROLES = ["decor", "logo", "icones"];
const FILES = { decor: "1-decor-accueil.psd", logo: "2-logo-papier.psd", icones: "3-icones-curseurs.psd" };
const LABELS = { decor: "1 · Décor d'accueil", logo: "2 · Logo et papier", icones: "3 · Icônes et curseurs" };

/* ---- P1 / P2. Export et archive complète ------------------------------------------------------ */
const kitUrl = `/admin/api/theme-kit/${THEME}`;
const state = await ready(THEME);
ok("P1 export du kit prêt", state.ready === true);
ok("P1 l'API donne les trois parties (fichier, libellé, éléments, poids) dans l'ordre du kit", Array.isArray(state.parts) && state.parts.map((p) => p.role).join() === ROLES.join() && state.parts.every((p) => p.file === FILES[p.role] && p.label === LABELS[p.role] && p.elements.length > 0 && p.bytes > 100000), JSON.stringify(state.parts?.map((p) => [p.role, p.file, p.bytes])));
const dl = await get(kitUrl);
const zipBytes = Buffer.from(await dl.arrayBuffer());
ok("P2 archive complète : .zip en pièce jointe kit-galerie-lumineuse.zip (comme avant)", dl.ok && /application\/zip/.test(dl.headers.get("content-type") ?? "") && /attachment; filename="kit-galerie-lumineuse\.zip"/.test(dl.headers.get("content-disposition") ?? "") && zipBytes.subarray(0, 2).toString("latin1") === "PK");
ok("P1 l'API donne le poids de l'archive et la durée de génération", state.zipBytes === zipBytes.length && state.zipBytes > state.parts?.reduce((n, p) => n + p.bytes, 0) && state.ms > 0, JSON.stringify({ z: state.zipBytes, ms: state.ms }));
const kitZip = path.join(DIR, "kit.zip");
writeFileSync(kitZip, zipBytes);
const inZip = path.join(DIR, "dans-archive");
sim("extract", kitZip, inZip);

/* ---- P3. Chaque partie = le fichier de l'archive -------------------------------------------------- */
const partFile = {};
for (const role of ROLES) {
  const res = await get(`${kitUrl}?part=${role}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const file = path.join(DIR, `partie-${FILES[role]}`);
  writeFileSync(file, bytes);
  partFile[role] = file;
  const head = res.headers;
  ok(`P3 ${role} : un seul .psd en pièce jointe « ${FILES[role]} »`, res.status === 200 && /image\/vnd\.adobe\.photoshop/.test(head.get("content-type") ?? "") && head.get("content-disposition") === `attachment; filename="${FILES[role]}"` && bytes.subarray(0, 4).toString("latin1") === "8BPS" && Number(head.get("content-length")) === bytes.length && bytes.length === state.parts.find((p) => p.role === role).bytes, `${res.status} ${head.get("content-type")} ${head.get("content-disposition")}`);
  const ref = readFileSync(path.join(inZip, FILES[role]));
  ok(`P3 ${role} : mêmes octets que le fichier de l'archive complète`, Buffer.compare(bytes, ref) === 0, `${bytes.length} / ${ref.length}`);
  const a = tree(file);
  const b = tree(path.join(inZip, FILES[role]));
  const names = (n) => n.children?.map((c) => c.name) ?? [];
  ok(`P3 ${role} : même structure de calques (noms, rectangles, groupes) que le kit complet`, JSON.stringify(a) === JSON.stringify(b) && a.children.length > 2, `${a.children.length} / ${b.children.length}`);
  console.log(`  ${role} : ${a.width} × ${a.height}, groupes de premier niveau : ${names(a).join(" | ")}`);
}

/* ---- P4. Refus --------------------------------------------------------------------------------- */
const bad = await get(`${kitUrl}?part=inconnue`);
ok("P4 partie inconnue : 400, message clair", bad.status === 400 && /inconnue/.test((await bad.json()).message ?? ""), String(bad.status));
const nothere = await get(`/admin/api/theme-kit/theme-qui-nexiste-pas?part=logo`);
ok("P4 thème inconnu : 404", nothere.status === 404, String(nothere.status));
const anon = await fetch(`${BASE}${kitUrl}?part=logo`, { redirect: "manual" });
const anonBytes = Buffer.from(await anon.arrayBuffer());
ok("P4 sans session : aucun fichier servi", anonBytes.subarray(0, 4).toString("latin1") !== "8BPS" && anon.status !== 200, String(anon.status));

/* ---- P5. Réimport d'une seule partie ------------------------------------------------------------ */
const manifestsDir = path.join(DATA, "cache/kits/manifests");
const manifestOf = (themeId) =>
  readdirSync(manifestsDir)
    .filter((n) => n.endsWith(".json"))
    .map((n) => JSON.parse(readFileSync(path.join(manifestsDir, n), "utf8")))
    .filter((m) => m.themeId === themeId)
    .sort((x, y) => (x.exportId < y.exportId ? 1 : -1));
const original = JSON.parse(readFileSync(path.join(manifestsDir, `${createHash("sha256").update(`${THEME}:${state.version}:4`).digest("hex").slice(0, 12).replace(/^/, "k2-")}.json`), "utf8"));
const hashesOf = (m) => Object.fromEntries(Object.entries(m.slots).map(([k, v]) => [k, v.hash]));
const sourceBefore = themeData(THEME);
/** Mon thème (lot 60) : chaque application en crée une nouvelle version ; la base de la suivante est la version en cours. */
const mineData = () =>
  JSON.parse(
    tsx(`import { getDb, schema } from "./src/lib/db/index.ts"; import { eq } from "drizzle-orm";
     console.log(getDb().select().from(schema.themes).where(eq(schema.themes.mine, true)).get()?.data ?? "null");`),
  );
/** Champs du thème qui portent chaque partie (assets du kit). */
const FIELDS = {
  decor: (t) => ({ plans: t.assets.kit?.plans ?? null, plansOnly: t.assets.kit?.plansOnly ?? null, hero: t.assets.heroLayers ?? null }),
  logo: (t) => ({ signature: t.assets.kit?.signature ?? null, paper: t.assets.kit?.paper ?? null, icon: t.assets.kit?.icon ?? null, stroke: t.assets.kit?.stroke ?? null }),
  icones: (t) => ({ icons: t.assets.kit?.icons ?? null, cursors: t.assets.kit?.cursors ?? null, frame: t.assets.kit?.frame ?? null, tape: t.assets.kit?.tape ?? null }),
};
const edited = { icones: path.join(DIR, "icones-retouche.psd"), logo: path.join(DIR, "logo-retouche.psd"), decor: path.join(DIR, "decor-retouche.psd") };
// Les retouches simulées partent de l'archive : la partie en a les mêmes octets (P3).
sim("icone", kitZip, edited.icones);
sim("studio", kitZip, edited.logo);
sim("decor", kitZip, edited.decor);
const REDRAWN = { icones: "icones/fleche-droite", logo: null, decor: null };
for (const role of ["icones", "logo", "decor"]) {
  const up = await upload(readFileSync(edited[role]), `${role}-retouche.psd`);
  const id = up.body.kitImport?.id;
  const st = await waitImport(THEME, id);
  const r = st.status === "done" ? rapportOf(id) : null;
  const received = r?.files.filter((f) => f.received).map((f) => f.id).join();
  ok(`P5 ${role} : le fichier d'une seule partie est reconnu, seule cette partie est lue`, up.status === 200 && received === role && r.files.length === 3 && r.reference?.how === "identifiant", JSON.stringify({ up: up.status, f: r?.files }));
  const redrawn = r?.slots.filter((s) => s.change === "redrawn").map((s) => s.id).sort().join();
  const others = r?.slots.filter((s) => s.file !== role) ?? [];
  ok(`P5 ${role} : aucun élément des autres parties dans la revue, retouches détectées (${redrawn})`, others.length === 0 && redrawn.length > 0 && (REDRAWN[role] === null || redrawn === REDRAWN[role].split(",").sort().join()), JSON.stringify({ redrawn, others: others.length }));
  const unchanged = r?.slots.filter((s) => s.change === "unchanged") ?? [];
  ok(`P5 ${role} : les éléments non retouchés de la partie gardent l'empreinte du kit exporté`, unchanged.length > 0 && unchanged.every((s) => s.hash === (s.from !== undefined ? original.slots[`hero/plan-${s.from + 1}`] : original.slots[s.id])?.hash), JSON.stringify(unchanged.map((s) => [s.id, s.from, s.hash])));
  const html = await (await get(`/admin/themes/${THEME}/kit?import=${id}`)).text();
  const absent = ROLES.filter((x) => x !== role);
  ok(`P5 ${role} : la revue dit « pas envoyé : inchangé » pour les deux autres parties`, absent.every((x) => new RegExp(`data-file="${x}" data-received="false"`).test(html)) && (html.match(/pas envoyé : inchangé/g) ?? []).length >= 2);
  // Application : une nouvelle version de Mon thème ; les autres parties sont strictement celles de la version précédente (ou du thème source).
  const baseBefore = mineData() ?? sourceBefore;
  const applied = tsx(`import { applyKitImport } from "./src/lib/kit/apply.ts"; console.log(JSON.stringify(await applyKitImport(${JSON.stringify(THEME)}, ${JSON.stringify(id)}, { mirror: false })));`);
  const aj = JSON.parse(applied.trim().split("\n").pop());
  const draftId = aj.data?.id;
  if (draftId) created.push(draftId);
  const draft = draftId ? themeData(draftId) : null;
  ok(`P5 ${role} : application réussie (copie brouillon)`, aj.ok === true && draft?.preset === false, applied.slice(0, 200));
  if (draft) {
    const same = absent.every((x) => JSON.stringify(FIELDS[x](draft)) === JSON.stringify(FIELDS[x](baseBefore)));
    ok(`P5 ${role} : les deux autres parties du thème sont strictement identiques à la version précédente`, same, absent.map((x) => `${x}:${JSON.stringify(FIELDS[x](draft)).slice(0, 80)}`).join(" | "));
    ok(`P5 ${role} : la partie envoyée a bien changé dans le thème`, JSON.stringify(FIELDS[role](draft)) !== JSON.stringify(FIELDS[role](baseBefore)));
    ok(`P5 ${role} : le thème source est inchangé`, JSON.stringify(themeData(THEME)) === JSON.stringify(sourceBefore));
  }
  // Empreintes : le kit du thème obtenu, pour tout ce qui n'est pas retouché, a celles du kit d'origine (icônes seulement : un export suffit).
  if (role === "icones" && draftId) {
    const dReady = await ready(draftId);
    const m = manifestOf(draftId)[0];
    const diff = m ? Object.keys(original.slots).filter((k) => m.slots[k]?.hash !== original.slots[k].hash) : ["(pas de manifeste)"];
    ok("P5 icones : l'export du thème obtenu a les mêmes empreintes que le kit d'origine, sauf la flèche retouchée", dReady.ready && diff.join() === "icones/fleche-droite", JSON.stringify({ ready: dReady.ready, diff }));
  }
}

/* ---- P6. Archive complète : comme avant ----------------------------------------------------------- */
const zipEdited = path.join(DIR, "kit-retouche.zip");
sim("zip", kitZip, zipEdited, edited.icones);
const upZip = await upload(readFileSync(zipEdited), "kit-retouche.zip", { type: "application/zip" });
const idZip = upZip.body.kitImport?.id;
const stZip = await waitImport(THEME, idZip);
const rZip = stZip.status === "done" ? rapportOf(idZip) : null;
ok("P6 archive complète retouchée : 17 éléments (décor 5, logo 4, icônes 8), seule la flèche droite redessinée", rZip?.slots.length === 17 && rZip.slots.filter((s) => s.change === "redrawn").map((s) => s.id).join() === "icones/fleche-droite" && rZip.files.map((f) => `${f.id}:${f.slots}`).join() === "decor:5,logo:4,icones:8", JSON.stringify(rZip?.files));
const upRaw = await upload(zipBytes, "kit-tel-quel.zip", { type: "application/zip" });
const stRaw = await waitImport(THEME, upRaw.body.kitImport?.id);
const rRaw = stRaw.status === "done" ? rapportOf(upRaw.body.kitImport.id) : null;
ok("P6 archive telle que téléchargée : 17 éléments, rien de modifié", rRaw?.slots.length === 17 && rRaw.slots.every((s) => s.change === "unchanged"), JSON.stringify(rRaw?.slots.filter((s) => s.change !== "unchanged").map((s) => s.id)));
const upPart = await upload(readFileSync(partFile.logo), FILES.logo);
const stPart = await waitImport(THEME, upPart.body.kitImport?.id);
const rPart = stPart.status === "done" ? rapportOf(upPart.body.kitImport.id) : null;
ok("P6 une partie telle que téléchargée : 4 éléments lus, rien de modifié", rPart?.slots.length === 4 && rPart.slots.every((s) => s.change === "unchanged"), JSON.stringify(rPart?.slots.map((s) => [s.id, s.change])));

/* ---- P7. Ancien kit en cache (sans fichier de durée) ------------------------------------------------ */
const cache = path.join(DATA, "cache/kits");
const metas = readdirSync(cache).filter((n) => n.startsWith(`${THEME}-`) && n.endsWith(".zip.meta"));
ok("P7 la durée de génération est gardée à côté de l'archive (.meta)", metas.length === 1, metas.join());
for (const n of metas) rmSync(path.join(cache, n));
const old = await (await fetch(`${BASE}${kitUrl}`, { method: "POST", headers: H })).json();
ok("P7 ancien kit sans .meta : prêt, trois parties avec leur poids, durée absente", old.ready === true && old.parts?.length === 3 && old.parts.every((p) => p.bytes > 0) && old.ms === null, JSON.stringify({ r: old.ready, ms: old.ms }));
const oldPart = Buffer.from(await (await get(`${kitUrl}?part=icones`)).arrayBuffer());
ok("P7 ancien kit : la partie se télécharge, mêmes octets", Buffer.compare(oldPart, readFileSync(partFile.icones)) === 0);

/* ---- P8. Page Kit dans le navigateur ------------------------------------------------------------------ */
const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
await pageLogin(page, BASE);
await page.goto(`${BASE}/admin/themes/${THEME}/kit`, { waitUntil: "networkidle" });
const entries = page.locator('[data-testid="kit-parts"] li[data-part]');
ok("P8 trois entrées « par partie », dans l'ordre du kit", (await entries.count()) === 3 && (await entries.evaluateAll((els) => els.map((e) => e.getAttribute("data-part")))).join() === ROLES.join());
for (const role of ROLES) {
  const text = (await page.locator(`li[data-part="${role}"]`).textContent()) ?? "";
  ok(`P8 ${role} : libellé « ${LABELS[role]} », éléments et poids affichés`, text.includes(LABELS[role]) && /\d+(,\d)? (Ko|Mo)/.test(text), text.slice(0, 160));
}
ok("P8 la durée de génération n'est pas inventée quand elle est inconnue", !/Génération du kit/.test((await page.locator('[data-testid="kit-parts"]').textContent()) ?? ""));
await page.screenshot({ path: path.join(SHOTS, "P8-parties.png"), fullPage: true });
for (const role of ROLES) {
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), page.locator(`[data-testid="kit-part-${role}"]`).click()]);
  const saved = path.join(DIR, `navigateur-${role}.psd`);
  await download.saveAs(saved);
  ok(`P8 ${role} : le bouton télécharge « ${FILES[role]} », mêmes octets que le kit complet`, download.suggestedFilename() === FILES[role] && Buffer.compare(readFileSync(saved), readFileSync(path.join(inZip, FILES[role]))) === 0, download.suggestedFilename());
  await page.waitForFunction((r) => !document.querySelector(`[data-testid="kit-part-${r}"]`)?.hasAttribute("disabled"), role, { timeout: 30000 });
}
const [zipDl] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), page.locator('[data-testid="kit-download"]').click()]);
ok("P8 le bouton du kit complet télécharge toujours kit-galerie-lumineuse.zip", zipDl.suggestedFilename() === "kit-galerie-lumineuse.zip");
await page.waitForFunction(() => !document.querySelector('[data-testid="kit-download"]')?.hasAttribute("disabled"), null, { timeout: 30000 });
// Envoi d'une partie seule par la page.
await page.setInputFiles('[data-testid="kit-file"]', edited.icones);
await page.waitForURL(/\/kit\?import=/, { timeout: 180000 });
await page.locator(".a-kit-card").first().waitFor({ timeout: 240000 });
const reviewText = (await page.locator("#kit-review").locator("..").textContent()) ?? "";
ok("P8 envoi d'une partie par la page : revue de cette partie, « pas envoyé : inchangé » pour les autres", (reviewText.match(/pas envoyé : inchangé/g) ?? []).length === 2 && /Flèche droite : redessinée/.test(reviewText));
await page.screenshot({ path: path.join(SHOTS, "P8-reimport-partiel.png"), fullPage: true });
await browser.close();

// Ménage : copies brouillon créées par ce parcours.
if (created.length) {
  tsx(`import { getDb, schema } from "./src/lib/db/index.ts"; import { inArray } from "drizzle-orm";
   getDb().delete(schema.themes).where(inArray(schema.themes.id, ${JSON.stringify(created)})).run();`);
  console.log(`brouillons supprimés : ${created.join(", ")}`);
}
console.log(failures ? `kitpartie122 : ${failures} échec(s)` : "kitpartie122 : tout est bon");
process.exit(failures ? 1 : 0);
