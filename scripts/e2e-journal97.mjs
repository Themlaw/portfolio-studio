#!/usr/bin/env node
/**
 * Lot 97 « journal d'édition » (chromium, serveur requis, base neuve, données SYNTHÉTIQUES). L'artiste travaille dans l'éditeur ;
 * chaque geste d'écriture doit laisser une entrée LISIBLE dans le journal (base à part `edit-log.db`) et une ligne JSON sur stdout :
 *  T  une modification de texte (brouillon) ;  S  le nom du site modifié depuis une page (brouillon du site) ;
 *  P  une publication ;  D  un abandon ;  C  un refus de conflit (+ l'échec vu par le navigateur) ;  E  des erreurs JS du navigateur ;
 *  R  un réglage (avec un e-mail synthétique) ;  X  rien de secret dans la table ni sur stdout (e-mail, mot de passe, jeton, cookie) ;
 *  L  pas de bruit pour les lectures ;  A  /api/log : auth admin, même origine, taille et débit bornés ;
 *  J  l'écran Journal : liste lisible, filtres (page, type, résultat, date), détails dépliables, lien depuis Réglages ;  M  coût < 2 ms.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [RUNNER_TEMP=…] [SHOTS=dossier] node scripts/e2e-journal97.mjs
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium, request as pwRequest } from "playwright";

import { canvas, login, openEditor, pageIdOf, q1, setDraft, settled, sleep, sql, waitFor } from "./lib/grille31d.mjs";

const BASE = process.env.BASE ?? "http://localhost:3880";
const DATA = process.env.DATA_DIR ?? "data";
const SHOTS = process.env.SHOTS ?? path.join(process.env.BATTERY_DIR ?? tmpdir(), "shots-journal97");
mkdirSync(SHOTS, { recursive: true });
const SERVER_LOG = process.env.SERVER_LOG ?? path.join(process.env.RUNNER_TEMP ?? tmpdir(), "logs", "journal97-server.log");

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${String(detail).slice(0, 700)}` : ""}`);
};
const info = (label) => console.log(`INFO ${label}`);

/** Lecture du journal (fichier à part, lecture seule). */
function journal(where = "1=1", ...args) {
  const file = path.join(DATA, "edit-log.db");
  if (!existsSync(file)) return [];
  const db = new Database(file, { readonly: true });
  try {
    db.pragma("busy_timeout = 5000");
    return db.prepare(`select * from edit_log where ${where} order by id`).all(...args).map((r) => ({ ...r, summary: r.summary ? JSON.parse(r.summary) : null }));
  } finally {
    db.close();
  }
}
const lastOf = (where, ...args) => journal(where, ...args).at(-1);
const serverLines = () => (existsSync(SERVER_LOG) ? readFileSync(SERVER_LOG, "utf8").split("\n").filter((l) => /^\{"t":"(edit|client)"/.test(l)) : null);

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.setDefaultTimeout(60000);
page.on("dialog", (d) => d.accept());
await login(page, BASE);

const P = pageIdOf("personnages");
const T = (s) => ({ fr: s, en: s });
const pageTitle = () => JSON.parse(q1("select title from pages where id = ?", P).title).fr;
const TEXT_UID = "j97t";
setDraft(P, [{ uid: TEXT_UID, type: "rich-text", props: { paragraphs: [T("Texte de départ synthétique")] } }]);
const before0 = journal().length;

/** Modifie le paragraphe du bloc Texte dans l'éditeur, comme l'artiste (double-clic, remplacer, valider). */
async function editParagraph(f, text) {
  // Après une publication ou un abandon, les uid sont ceux de la base (b0…) : on cible le bloc Texte par son type.
  const sel = `[data-edit-block][data-edit-type="rich-text"] [data-inline="paragraphs.0"]`;
  for (let i = 0; i < 6; i++) {
    try {
      await f.locator(sel).scrollIntoViewIfNeeded();
      await f.locator(sel).dblclick({ timeout: 8000 });
      break;
    } catch {
      await sleep(1000);
    }
  }
  await page.keyboard.press("Control+A");
  await page.keyboard.type(text);
  await page.keyboard.press("Escape");
  await settled(page);
}

/* ---- T : modification de texte ------------------------------------------------------------------------------------------- */
let f = await openEditor(page, BASE, P);
await settled(page);
await editParagraph(f, "Texte modifié par le test 97");
const T1 = await waitFor(() => journal("action = 'saveDraftAction' and result = 'ok'").length > 0, 60000).then(() => lastOf("action = 'saveDraftAction' and result = 'ok'"));
ok("T1 la modification de texte laisse une entrée « brouillon enregistré »", Boolean(T1), JSON.stringify(journal().slice(before0)));
ok("T2 l'entrée est lisible : « Bloc « Texte » modifié depuis la page … : brouillon »", T1 && T1.label === `Bloc « Texte » modifié depuis la page ${pageTitle()} : brouillon`, T1?.label);
ok("T3 …avec type, version de la page avant → après, durée, version de l'application, utilisateur interne", T1 && T1.type === "modification" && T1.rev_to === T1.rev_from + 1 && T1.ms >= 0 && /^\d+\.\d+\.\d+/.test(T1.version) && T1.user && !T1.user.includes("@") && T1.page_id === P, JSON.stringify(T1));
ok("T4 …et le résumé donne le chemin du champ touché et la valeur courte", T1 && T1.summary.changes.some((c) => /^blocks\[rich-text:j97t\]\.props\.paragraphs/.test(c.p) && /modifié par le test 97/.test(c.b ?? "")), JSON.stringify(T1?.summary));

/* ---- S : nom du site modifié depuis la page (brouillon du site) ------------------------------------------------------------- */
const nameSel = '.site-brand-text[data-site-inline="name"]';
for (let i = 0; i < 6; i++) {
  try {
    await f.locator(nameSel).first().dblclick({ timeout: 8000 });
    break;
  } catch {
    await sleep(1000);
  }
}
await page.keyboard.press("Control+A");
await page.keyboard.type("Nom synthétique 97");
await page.keyboard.press("Enter");
await settled(page);
const S1 = await waitFor(() => journal("action = 'siteDraftAction' and result = 'ok'").length > 0, 60000).then(() => lastOf("action = 'siteDraftAction' and result = 'ok'"));
ok("S1 « Nom du site modifié depuis la page … : brouillon »", S1 && S1.label === `Nom du site modifié depuis la page ${pageTitle()} : brouillon`, S1?.label ?? JSON.stringify(journal("action like 'site%'")));
ok("S2 le résumé montre l'ancienne et la nouvelle valeur du nom", S1 && S1.summary.changes.some((c) => /^identity\.name/.test(c.p) && /Nom synthétique 97/.test(c.b ?? "")), JSON.stringify(S1?.summary));

/* ---- P : publication ------------------------------------------------------------------------------------------------------- */
const publish = page.getByRole("button", { name: "Publier", exact: true });
await waitFor(async () => !(await publish.isDisabled()), 30000);
await publish.click();
const confirm = page.locator("dialog[open]").getByRole("button", { name: "Mettre en ligne" });
if (await confirm.waitFor({ timeout: 3000 }).then(() => true, () => false)) await confirm.click();
const P1 = await waitFor(() => journal("action = 'publishDraftAction' and result = 'ok'").length > 0, 120000).then(() => lastOf("action = 'publishDraftAction' and result = 'ok'"));
ok("P1 la publication laisse une entrée de type « publication »", P1 && P1.type === "publication" && P1.page_id === P, JSON.stringify(P1));
ok("P2 …lisible : « Page publiée depuis la page … : publié », version avant → après", P1 && P1.label === `Page publiée depuis la page ${pageTitle()} : publié` && P1.rev_to > P1.rev_from, P1?.label);
await sleep(2500);

/* ---- D : abandon ------------------------------------------------------------------------------------------------------------- */
f = await openEditor(page, BASE, P);
await settled(page);
const savesBefore = journal("action = 'saveDraftAction'").length;
await editParagraph(f, "Texte à abandonner 97");
await waitFor(() => journal("action = 'saveDraftAction'").length > savesBefore, 60000);
await sleep(1500);
const discardBtn = page.getByRole("button", { name: "Abandonner les modifications" });
if (!(await discardBtn.first().waitFor({ timeout: 20000 }).then(() => true, () => false))) {
  await page.screenshot({ path: `${SHOTS}/debug-abandon.png` });
  info(`DEBUG boutons : ${(await page.getByRole("button").allInnerTexts()).join(" | ").slice(0, 600)} ; statut : ${await page.locator(".ve-status").innerText().catch(() => "?")} ; brouillon en base : ${q1("select draft is not null as d, draft_rev from pages where id = ?", P) && JSON.stringify(q1("select draft is not null as d, draft_rev from pages where id = ?", P))}`);
}
await discardBtn.first().click();
await Promise.all([page.waitForEvent("framenavigated", { predicate: (fr) => fr === page.mainFrame(), timeout: 60000 }), page.getByRole("dialog").getByRole("button", { name: "Abandonner les modifications" }).click()]);
const D1 = await waitFor(() => journal("action = 'discardDraftAction'").length > 0, 60000).then(() => lastOf("action = 'discardDraftAction'"));
ok("D1 l'abandon laisse une entrée de type « abandon », lisible", D1 && D1.type === "abandon" && D1.result === "ok" && D1.label === `Brouillon abandonné depuis la page ${pageTitle()} : brouillon`, D1?.label);

/* ---- C : refus de conflit ------------------------------------------------------------------------------------------------------- */
f = await canvas(page);
await settled(page);
await sleep(2000);
const revNow = q1("select draft_rev from pages where id = ?", P).draft_rev;
sql((db) => db.prepare("update pages set draft_rev = draft_rev + 1 where id = ?").run(P)); // « un autre onglet » a écrit entre-temps
await editParagraph(f, "Texte en conflit 97");
const C1 = await waitFor(() => journal("action = 'saveDraftAction' and result = 'conflit'").length > 0, 60000).then(() => lastOf("action = 'saveDraftAction' and result = 'conflit'"));
ok("C1 un refus de conflit laisse une entrée « conflit »", Boolean(C1), JSON.stringify(journal().slice(-4).map((x) => [x.action, x.result])));
ok("C2 …lisible (« refusé, la page avait été modifiée ailleurs »), avec la version tentée et la version en base", C1 && /refusé, la page avait été modifiée ailleurs/.test(C1.label) && C1.rev_from === revNow && C1.rev_to === revNow + 1, `${C1?.label} ${C1?.rev_from}>${C1?.rev_to} (attendu ${revNow}>${revNow + 1})`);
const C3 = await waitFor(() => journal("kind = 'client' and action = 'client.save' and result = 'conflit'").length > 0, 30000);
ok("C3 le navigateur signale aussi le conflit (version du client, chemin de la page)", C3 && /saveDraftAction/.test(lastOf("kind = 'client' and result = 'conflit'").label) && lastOf("kind = 'client' and result = 'conflit'").target.startsWith(`/admin/pages/${P}/`));

/* ---- E : erreurs JS du navigateur ----------------------------------------------------------------------------------------------- */
page.on("pageerror", () => {}); // l'erreur est voulue
await page.evaluate(() => {
  setTimeout(() => {
    throw new Error("Erreur synthétique 97 jean.dupont@exemple.test");
  }, 0);
  void Promise.reject(new Error("Rejet synthétique 97"));
});
const E1 = await waitFor(() => journal("kind = 'client' and action = 'client.error'").length > 0, 30000);
const E2 = await waitFor(() => journal("kind = 'client' and action = 'client.rejection'").length > 0, 30000);
ok("E1 une erreur JS non rattrapée est journalisée (type « erreur », page, version du client)", E1 && lastOf("action = 'client.error'").type === "erreur" && /Erreur synthétique 97/.test(lastOf("action = 'client.error'").label) && lastOf("action = 'client.error'").version.length > 0, JSON.stringify(lastOf("action = 'client.error'")));
ok("E2 un rejet de promesse est journalisé", E2 && /Rejet synthétique 97/.test(lastOf("action = 'client.rejection'").label));
ok("E3 l'e-mail contenu dans le message est masqué", !JSON.stringify(journal("kind = 'client'")).includes("jean.dupont"));

/* ---- R : réglage avec un e-mail synthétique -------------------------------------------------------------------------------------- */
await page.goto(`${BASE}/admin/reglages`, { waitUntil: "networkidle" });
const EMAIL97 = "secret.97@exemple.test";
await page.getByLabel("Adresse de contact").fill(EMAIL97);
await page.getByRole("button", { name: "Enregistrer" }).first().click();
const R1 = await waitFor(() => journal("action = 'saveSettingsAction'").length > 0, 60000).then(() => lastOf("action = 'saveSettingsAction'"));
ok("R1 un réglage laisse une entrée de type « reglage »", R1 && R1.type === "reglage", JSON.stringify(R1));
ok("R2 …sans l'e-mail saisi (le chemin du champ reste, la valeur est masquée)", R1 && !JSON.stringify(R1).includes("secret.97"), JSON.stringify(R1?.summary));

/* ---- L : pas de bruit pour les lectures ------------------------------------------------------------------------------------------- */
const countBefore = journal().length;
const linesBefore = serverLines()?.length;
for (const u of ["/admin", "/admin/pages", "/admin/projets", "/admin/medias", "/admin/themes", "/admin/messages", "/admin/sauvegardes", "/admin/cadres", "/admin/papiers-peints", "/fr", "/fr/personnages"]) await page.goto(`${BASE}${u}`, { waitUntil: "domcontentloaded" });
await sleep(1500);
ok("L1 onze pages lues (admin et site) : aucune entrée de plus dans le journal", journal().length === countBefore, `${countBefore} → ${journal().length}`);
if (linesBefore !== undefined) ok("L2 …et aucune ligne de plus sur stdout", serverLines().length === linesBefore, `${linesBefore} → ${serverLines().length}`);
else info(`L2 journal du serveur introuvable (${SERVER_LOG}) : contrôle de stdout ignoré`);

/* ---- X : aucun secret ------------------------------------------------------------------------------------------------------------ */
const cookies = await ctx.cookies();
const secrets = [process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD, process.env.BETTER_AUTH_SECRET, EMAIL97, ...cookies.map((c) => decodeURIComponent(c.value)).filter((v) => v.length >= 16).flatMap((v) => [v, v.split(".")[0]])].filter(Boolean);
const dump = JSON.stringify(journal());
const lines = serverLines() ?? [];
const leakDb = secrets.filter((s) => dump.includes(s));
const leakOut = secrets.filter((s) => lines.some((l) => l.includes(s)));
ok(`X1 ni e-mail, ni mot de passe, ni secret, ni cookie de session dans la table (${secrets.length} valeurs cherchées)`, leakDb.length === 0, leakDb.map((s) => s.slice(0, 6)).join());
ok("X2 …ni sur stdout", leakOut.length === 0, leakOut.map((s) => s.slice(0, 6)).join());
const anyAt = dump.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/gi);
ok("X3 aucune adresse e-mail, même d'essai, dans la table", !anyAt, String(anyAt));
ok("X4 le journal est dans un fichier à part : portfolio.db n'a pas de table edit_log (les sauvegardes ne bougent pas, une restauration le laisse intact)", existsSync(path.join(DATA, "edit-log.db")) && !sql((db) => db.prepare("select name from sqlite_master where name = 'edit_log'").get()));

/* ---- stdout --------------------------------------------------------------------------------------------------------------------- */
if (serverLines()) {
  const parsed = serverLines().map((l) => JSON.parse(l));
  // PR #64 : les connexions et téléchargements écrivent aussi une ligne {"t":"edit"} (type « compte » / « telechargement », sans durée) : O1 vise les écritures.
  const edits = parsed.filter((l) => l.t === "edit" && l.type !== "compte" && l.type !== "telechargement");
  ok("O1 stdout : une ligne JSON {\"t\":\"edit\"} par écriture, courte, avec action, résultat, version, durée", edits.length >= 6 && edits.every((l) => l.a && l.r && l.v && typeof l.ms === "number" && JSON.stringify(l).length < 450), `${edits.length} lignes ; ${serverLines()[0]}`);
  ok("O2 …et une ligne {\"t\":\"client\"} par erreur du navigateur", parsed.some((l) => l.t === "client" && l.a === "client.error") && parsed.some((l) => l.t === "client" && l.a === "client.save"));
  const aud = edits.map((l) => l.aud).filter((x) => typeof x === "number");
  const saves = edits.filter((l) => l.a === "saveDraftAction").map((l) => l.aud);
  const avg = aud.reduce((a, b) => a + b, 0) / Math.max(1, aud.length);
  const median = [...aud].sort((x, y) => x - y)[Math.floor(aud.length / 2)] ?? 0;
  const bg = edits.map((l) => l.bg).filter((x) => typeof x === "number").sort((x, y) => x - y);
  info(`M1 coût du journal par écriture, sur le chemin de la requête (capture d'avant) : médiane ${median.toFixed(2)} ms, moyenne ${avg.toFixed(2)} ms, max ${Math.max(...aud).toFixed(2)} ms sur ${aud.length} écritures ; en différé après la réponse (résumé + SQLite) : médiane ${(bg[Math.floor(bg.length / 2)] ?? 0).toFixed(2)} ms, max ${(bg.at(-1) ?? 0).toFixed(2)} ms ; saveDraftAction : ${saves.map((x) => x.toFixed(2)).join(" / ")} ms`);
  ok("M1 coût médian du journal < 2 ms par action (la première écriture d'un processus, à froid, peut dépasser)", aud.length >= 6 && median < 2, `${median}`);
} else info("O/M : journal du serveur introuvable, contrôles de stdout ignorés");

/* ---- A : /api/log ------------------------------------------------------------------------------------------------------------------ */
const anon = await pwRequest.newContext();
const body = (o) => ({ headers: { origin: BASE, "content-type": "application/json" }, data: JSON.stringify(o) });
ok("A1 sans session : 401", (await anon.post(`${BASE}/api/log`, body({ kind: "error", message: "x" }))).status() === 401);
await anon.dispose();
ok("A2 autre origine : 403", (await page.request.post(`${BASE}/api/log`, { headers: { origin: "https://autre.example", "content-type": "application/json" }, data: JSON.stringify({ kind: "error", message: "x" }) })).status() === 403);
ok("A3 JSON invalide : 400 ; événement invalide : 400", (await page.request.post(`${BASE}/api/log`, { headers: { origin: BASE, "content-type": "application/json" }, data: "{pas du json" })).status() === 400 && (await page.request.post(`${BASE}/api/log`, body({ kind: "bizarre", message: "x" }))).status() === 400);
ok("A4 corps de plus de 8 Ko : 413", (await page.request.post(`${BASE}/api/log`, body({ kind: "error", message: "x".repeat(9000) }))).status() === 413);
ok("A5 événement valide : 204", (await page.request.post(`${BASE}/api/log`, body({ kind: "error", message: "Erreur d'essai A5", path: "/admin" }))).status() === 204);
const stored = lastOf("kind = 'client' and label like '%Erreur d''essai A5%'");
ok("A6 …stocké avec la page et la version du client", Boolean(stored) && stored.target === "/admin", JSON.stringify(stored));
let limited = 0;
for (let i = 0; i < 60; i++) if ((await page.request.post(`${BASE}/api/log`, body({ kind: "error", message: `rafale ${i}`, path: "/admin" }))).status() === 429) limited++;
ok("A7 débit limité : des 429 au-delà de 40 événements par minute", limited >= 10, String(limited));

/* ---- J : écran Journal ---------------------------------------------------------------------------------------------------------- */
await page.goto(`${BASE}/admin/reglages`, { waitUntil: "networkidle" });
await page.locator('[data-testid="journal-link"] a').click();
await page.waitForURL(`${BASE}/admin/journal`);
ok("J1 lien « Ouvrir le journal » depuis Réglages ; entrée « Journal » dans le menu", (await page.getByRole("heading", { name: "Journal", level: 1 }).count()) === 1 && (await page.locator("nav a", { hasText: "Journal" }).count()) >= 1);
const entries = page.locator('[data-testid="journal-entry"]');
const total = Number(await page.locator('[data-testid="journal-count"]').getAttribute("data-total"));
ok("J2 la liste montre les entrées, la plus récente d'abord", total >= 8 && (await entries.count()) === Math.min(total, 100), String(total));
const texts = await entries.locator("summary").allInnerTexts();
ok("J3 une non-développeuse lit « Nom du site modifié depuis la page … : brouillon »", texts.some((t) => t.includes(`Nom du site modifié depuis la page ${pageTitle()} : brouillon`)), texts.slice(0, 4).join(" | "));
const target = entries.filter({ hasText: "Page publiée depuis la page" }).first();
await target.locator("summary").click();
ok("J4 les détails se déplient : type, version de la page, durée, version du site, compte", await target.locator("dl").isVisible() && /Publication/.test(await target.locator("dl").innerText()) && /Version de la page/.test(await target.locator("dl").innerText()) && /Version du site/.test(await target.locator("dl").innerText()));
await page.screenshot({ path: `${SHOTS}/journal-1440.png`, fullPage: false });
async function filter(select, value) {
  await page.goto(`${BASE}/admin/journal`, { waitUntil: "domcontentloaded" });
  await page.locator(`select[name="${select}"]`).selectOption(value);
  await Promise.all([page.waitForURL(/journal\?/), page.getByRole("button", { name: "Filtrer" }).click()]);
}
await filter("resultat", "conflit");
const rc = await entries.evaluateAll((els) => els.map((e) => e.dataset.result));
ok("J5 filtre Résultat = Conflit : seulement des conflits (serveur et navigateur)", rc.length >= 2 && rc.every((r) => r === "conflit"), JSON.stringify(rc));
await filter("type", "publication");
const rt = await entries.evaluateAll((els) => els.map((e) => e.dataset.type));
ok("J6 filtre Type = Publication", rt.length >= 1 && rt.every((r) => r === "publication"), JSON.stringify(rt));
await filter("page", String(P));
const rp = await entries.allInnerTexts();
ok("J7 filtre Page : seulement les entrées de cette page (pas les réglages)", rp.length >= 5 && rp.length < total && !rp.some((t) => /Réglages du site/.test(t)), `${rp.length}/${total}`);
await page.goto(`${BASE}/admin/journal`, { waitUntil: "domcontentloaded" });
const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
const today = new Date().toISOString().slice(0, 10);
await page.locator('input[name="du"]').fill(tomorrow);
await Promise.all([page.waitForURL(/journal\?/), page.getByRole("button", { name: "Filtrer" }).click()]);
ok("J8 filtre de date : « du » après-demain = aucune entrée", Number(await page.locator('[data-testid="journal-count"]').getAttribute("data-total")) === 0);
await page.goto(`${BASE}/admin/journal?du=${today}&au=${tomorrow}`, { waitUntil: "domcontentloaded" });
ok("J9 filtre de date : d'aujourd'hui à après-demain = tout", Number(await page.locator('[data-testid="journal-count"]').getAttribute("data-total")) >= total);
await page.screenshot({ path: `${SHOTS}/journal-filtre.png` });
const phone = await browser.newContext({ viewport: { width: 390, height: 800 }, storageState: await ctx.storageState() });
const pp = await phone.newPage();
await pp.goto(`${BASE}/admin/journal`, { waitUntil: "networkidle" });
ok("J10 téléphone : pas de défilement horizontal", await pp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await pp.screenshot({ path: `${SHOTS}/journal-390.png` });
await phone.close();

await browser.close();
console.log(failures ? `${failures} échec(s)` : "Tout est vert");
process.exit(failures ? 1 : 0);
