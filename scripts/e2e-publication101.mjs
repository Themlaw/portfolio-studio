#!/usr/bin/env node
/**
 * Lot 101 (v0.32.1) : publication d'une page dont un projet CRÉÉ DANS LE BROUILLON n'a pas d'emplacement avec image.
 * UN chromium, base NEUVE (seed), une connexion, données SYNTHÉTIQUES (images générées, projets posés en base).
 *
 *  A. Images seulement dans les composants de la planche (suite publiée, surcouche de la page, carrousel à liste propre) : publiable ;
 *     public correct (200, planche, « N œuvres », images chargées, image de partage valide, accueil et collections intacts).
 *  B. Image ajoutée en brouillon dans un emplacement (draft_media_id, media_id NULL) : publiable, l'emplacement est appliqué.
 *  C. Planche vraiment vide : toujours refusée (aucun emplacement, emplacement vide, place retirée ou supprimée, composants vides,
 *     média à la corbeille ou disparu) ; rien n'est écrit.
 *  D. Deux planches dans une page, une vide : refus, erreur sur la seule planche vide ; une fois remplie, publication.
 *
 * Usage : BASE=http://localhost:4100 DATA_DIR=… ADMIN_EMAIL=… ADMIN_PASSWORD=… SHOTS=/dossier node scripts/e2e-publication101.mjs
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import { chromium } from "playwright";

import { paint } from "./lib/crop-fixtures.mjs";
import { login, pageIdOf, q1, sleep, sql, waitFor } from "./lib/grille31d.mjs";

const BASE = process.env.BASE ?? "http://localhost:3001";
const SHOTS = process.env.SHOTS ?? "screenshots/publication101";
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
function ok(label, cond, detail = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
}
const L = (t) => ({ fr: t, en: t });

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions", "--js-flags=--max-old-space-size=256"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
// Visiteur anonyme : la vue publique, pas la vue brouillon de l'admin.
const anon = await browser.newContext({ viewport: { width: 1440, height: 900 } });
page.setDefaultTimeout(60000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await login(page, BASE);

/* ---- Images synthétiques ---------------------------------------------------------------------------------------------------- */
async function ensure(name, w, h, seed) {
  const row = () => q1("select id, status from media where original_name = ? order by id desc", name);
  if (!row()) {
    const res = await page.request.post(`${BASE}/admin/api/upload`, { headers: { origin: BASE }, multipart: { file: { name, mimeType: "image/png", buffer: await paint(w, h, seed) } }, timeout: 180000 });
    if (res.status() >= 300) throw new Error(`envoi de ${name} : ${res.status()}`);
  }
  if (!(await waitFor(() => row()?.status === "ready", 240000))) throw new Error(`${name} : ${JSON.stringify(row())}`);
  return row().id;
}
const M1 = await ensure("101-a.png", 1200, 800, 1);
const M2 = await ensure("101-b.png", 800, 1200, 2);
const M3 = await ensure("101-c.png", 1000, 1000, 3);
const TRASHED = await ensure("101-corbeille.png", 900, 600, 4);
sql((db) => db.prepare("update media set deleted_at = unixepoch() where id = ?").run(TRASHED));
const GONE = 987654;

/* ---- Projets créés dans le brouillon de la page --------------------------------------------------------------------------- */
const PAGE = pageIdOf("a-propos");
const PAGE2 = pageIdOf("personnages");
let seq = 0;
const stripOfProject = { uid: "strip", type: "strip", props: {} };
const grid = (uid, ids) => ({ uid, type: "grid", props: { layout: "2", gap: "normal", align: "stretch", ratio: "auto", top: "gap", children: ids.map((id, i) => ({ uid: `${uid}k${i}`, type: "image", props: { mediaId: id } })) } });
const image = (uid, id) => ({ uid, type: "image", props: { mediaId: id, width: "wide" } });
/** `slots` : [{ media, state, draftMedia, mine }]. `layout`, `draftLayout` : suites. Renvoie { id, slug, title }. */
function project({ title, layout = null, draftLayout = null, slots = [], created = PAGE }) {
  const slug = `p101-${++seq}`;
  return sql((db) => {
    const pos = (db.prepare("select coalesce(max(position), 0) + 1 p from projects").get()).p;
    const info = db
      .prepare("insert into projects (slug, title, context, description, year, position, draft_page_id, layout, draft_layout, draft_layout_page_id) values (?, ?, ?, ?, '2026', ?, ?, ?, ?, ?)")
      .run(slug, JSON.stringify(L(title)), JSON.stringify(L("")), JSON.stringify(L("")), pos, created, layout && JSON.stringify(layout), draftLayout && JSON.stringify(draftLayout), draftLayout ? created : null);
    const id = Number(info.lastInsertRowid);
    slots.forEach((s, i) => {
      db.prepare(
        "insert into slots (project_id, position, media_id, slug, collection, title, description, year, draft_state, draft_media_id, draft_page_id, draft_position) values (?, ?, ?, ?, 'characters', ?, ?, 2026, ?, ?, ?, ?)",
      ).run(id, i, s.media ?? null, `${slug}-s${i}`, JSON.stringify(L(`Plan ${i}`)), JSON.stringify(L("")), s.state ?? null, s.draftMedia ?? null, s.state || s.draftMedia ? created : null, s.state ? i : null);
    });
    return { id, slug, title };
  });
}
const board = (uid, p) => ({ uid, type: "project-board", props: { project: p.slug } });
const counts = { uid: "cnt", type: "section-title", props: { title: L("Lot 101"), counts: true } };
const setDraft = (pageId, blocks) =>
  sql((db) => {
    const row = db.prepare("select title, slug, meta, nav_order from pages where id = ?").get(pageId);
    const draft = { title: JSON.parse(row.title), slug: JSON.parse(row.slug), meta: row.meta ? JSON.parse(row.meta) : { title: L(""), description: L("") }, published: true, inMenu: row.nav_order !== null, accent: null, blocks };
    db.prepare("update pages set draft = ?, draft_updated_at = unixepoch(), draft_rev = draft_rev + 1 where id = ?").run(JSON.stringify(draft), pageId);
  });
const hasDraft = (pageId) => Boolean(q1("select draft from pages where id = ?", pageId)?.draft);
const projectRow = (id) => q1("select draft_page_id, layout, draft_layout from projects where id = ?", id);

/** Écrit le brouillon, ouvre l'éditeur, clique « Publier » ; rend { published, problems } une fois le brouillon vidé ou la liste d'erreurs affichée. */
async function publish(pageId, blocks) {
  setDraft(pageId, blocks);
  await page.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
  const btn = page.getByRole("button", { name: "Publier", exact: true });
  await btn.waitFor({ timeout: 120000 });
  await page.waitForFunction(() => !!document.querySelector("iframe.ve-frame"), null, { timeout: 120000 });
  await sleep(2500);
  await btn.click();
  const confirm = page.locator("dialog[open]").getByRole("button", { name: "Mettre en ligne" });
  if (await confirm.waitFor({ timeout: 2000 }).then(() => true, () => false)) await confirm.click();
  let text = "";
  let refused = false;
  const done = await waitFor(async () => {
    if (!hasDraft(pageId)) return true;
    text = await page.locator("body").innerText();
    refused = /aucune image/.test(text);
    return refused;
  }, 90000);
  if (!refused) text = await page.locator("body").innerText();
  return { published: done && !hasDraft(pageId), refused: refused && hasDraft(pageId), text };
}

/** Page publique : statut, planche présente, compteurs, images chargées, image de partage. */
async function publicState(slugFr, p) {
  const res = await fetch(`${BASE}/fr/${slugFr}`);
  const html = await res.text();
  const pub = await anon.newPage();
  await pub.goto(`${BASE}/fr/${slugFr}`, { waitUntil: "networkidle" });
  await sleep(800);
  const sec = pub.locator(`[aria-labelledby="project-${p.slug}"]`);
  const info = await sec.first().evaluate((el) => {
    const imgs = [...el.querySelectorAll("img")];
    return { text: el.innerText, imgs: imgs.length, broken: imgs.filter((i) => !i.complete || i.naturalWidth === 0).length };
  }).catch(() => null);
  const pageText = await pub.locator("main").innerText().catch(() => "");
  await pub.screenshot({ path: path.join(SHOTS, `public-${p.slug}.png`), fullPage: true }).catch(() => {});
  await pub.close();
  const og = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1] ?? null;
  const ogStatus = og ? (await fetch(og.startsWith("http") ? og.replace(/^https?:\/\/[^/]+/, BASE) : BASE + og)).status : null;
  return { status: res.status, info, pageText, og, ogStatus, html };
}
const why = (r) => (r.text.match(/Le projet «[^\n]*|Publication impossible[^\n]*/g) ?? []).join(" | ") || r.text.slice(0, 120);
const intact = async () => {
  const out = {};
  for (const u of ["/fr", "/en", "/fr/personnages", "/fr/a-propos", "/sitemap.xml"]) out[u] = (await fetch(BASE + u)).status;
  return out;
};

console.log("== A. Images seulement dans les composants de la planche");
{
  const a1 = project({ title: "Projet A1 composants", layout: [stripOfProject, grid("g1", [M1, M2]), image("im1", M3)] });
  const r = await publish(PAGE, [counts, board("b1", a1)]);
  ok("A1 suite publiée du projet (grille + image), aucun emplacement : publiable", r.published, why(r));
  ok("A1 le projet n'est plus un projet de brouillon", projectRow(a1.id).draft_page_id === null);
  const s = await publicState("a-propos", a1);
  ok("A1 public : 200 et planche présente", s.status === 200 && s.info !== null, JSON.stringify(s.info));
  ok("A1 public : « 3 œuvres » (en-tête de page)", /3 œuvres · 1 projet/i.test(s.pageText), s.pageText.slice(0, 200));
  ok("A1 public : images de la planche affichées, aucune cassée", (s.info?.imgs ?? 0) >= 3 && s.info?.broken === 0, JSON.stringify(s.info));
  ok("A1 image de partage : absente ou valide (jamais cassée)", s.ogStatus === null || s.ogStatus === 200, `${s.og} ${s.ogStatus}`);
  const i = await intact();
  ok("A1 accueil, collections, sitemap : 200", Object.values(i).every((c) => c === 200), JSON.stringify(i));

  const a2 = project({ title: "Projet A2 surcouche", layout: null, draftLayout: [stripOfProject, grid("g2", [M2, M3])] });
  const r2 = await publish(PAGE, [counts, board("b2", a2)]);
  ok("A2 suite portée par le brouillon de la page (draft_layout) : publiable", r2.published, why(r2));
  ok("A2 la suite du brouillon est devenue la suite publiée DU BLOC de la page (lot 111) ; le projet n'est pas touché", Boolean(q1("select 1 x from blocks where props like '%\"g2\"%' limit 1")) && projectRow(a2.id).draft_layout === null);
  const s2 = await publicState("a-propos", a2);
  ok("A2 public : 200, « 2 œuvres », images chargées", s2.status === 200 && /2 œuvres · 1 projet/i.test(s2.pageText) && (s2.info?.imgs ?? 0) >= 2 && s2.info?.broken === 0, `${s2.pageText.slice(0, 120)} ${JSON.stringify(s2.info)}`);

  const a3 = project({ title: "Projet A3 carrousel", layout: [stripOfProject, { uid: "rail", type: "strip", props: { source: "own", media: [null, M1, M3], ids: ["p0", "p1", "p2"] } }] });
  const r3 = await publish(PAGE, [counts, board("b3", a3)]);
  ok("A3 carrousel à liste propre (une place vide + 2 images) : publiable", r3.published, why(r3));
  const s3 = await publicState("a-propos", a3);
  ok("A3 public : « 2 œuvres », images chargées", s3.status === 200 && /2 œuvres · 1 projet/i.test(s3.pageText) && s3.info?.broken === 0 && (s3.info?.imgs ?? 0) >= 2, `${s3.pageText.slice(0, 120)} ${JSON.stringify(s3.info)}`);

}

console.log("== B. Image ajoutée en brouillon dans un emplacement");
{
  const b1 = project({ title: "Projet B1 brouillon", slots: [{ media: null, state: "added", draftMedia: M1 }] });
  const r = await publish(PAGE, [counts, board("b5", b1)]);
  ok("B1 emplacement « added », media_id NULL, draft_media_id posé : publiable", r.published, why(r));
  const slot = q1("select media_id, draft_state, draft_media_id from slots where project_id = ?", b1.id);
  ok("B1 l'image du brouillon est devenue l'image de l'emplacement", slot?.media_id === M1 && slot.draft_state === null && slot.draft_media_id === null, JSON.stringify(slot));
  const s = await publicState("a-propos", b1);
  ok("B1 public : « 1 œuvre », image chargée", s.status === 200 && /1 œuvre · 1 projet/i.test(s.pageText) && (s.info?.imgs ?? 0) >= 1 && s.info?.broken === 0, `${s.pageText.slice(0, 120)} ${JSON.stringify(s.info)}`);

  const b2 = project({ title: "Projet B2 place sans brouillon", slots: [{ media: M2 }] });
  ok("B2 emplacement publié avec image (cas d'avant) : toujours publiable", (await publish(PAGE, [counts, board("b6", b2)])).published);

  const b3 = project({ title: "Projet B3 remplacée", slots: [{ media: M3, state: "removed", draftMedia: M1 }] });
  const r3 = await publish(PAGE, [counts, board("b7", b3)]);
  ok("B3 image publiée, retirée dans ce brouillon : refusée (rien ne sera montré)", r3.refused && !r3.published, why(r3));
}

console.log("== C. Planche vraiment vide : toujours refusée");
{
  const cases = {
    "C1 aucun emplacement, suite par défaut": project({ title: "Vide C1" }),
    "C2 emplacement sans image": project({ title: "Vide C2", slots: [{ media: null }] }),
    "C3 place retirée du brouillon (retired), image restée": project({ title: "Vide C3", slots: [{ media: M1, state: "retired" }] }),
    "C4 place « added » retirée (removed), image du brouillon oubliée": project({ title: "Vide C4", slots: [{ media: null, state: "removed", draftMedia: M2 }] }),
    "C5 composants vides (grille, image, carrousel sans média)": project({ title: "Vide C5", layout: [stripOfProject, grid("g5", []), { uid: "im5", type: "image", props: { width: "wide" } }, { uid: "rl5", type: "strip", props: { source: "own", media: [null], ids: ["p0"] } }] }),
    "C6 composants dont le média est à la corbeille": project({ title: "Vide C6", layout: [stripOfProject, image("im6", TRASHED), grid("g6", [TRASHED])] }),
    "C7 composants dont le média a disparu": project({ title: "Vide C7", layout: [stripOfProject, image("im7", GONE)] }),
    "C8 suite du brouillon vide, suite publiée garnie (la surcouche l'emporte)": project({ title: "Vide C8", layout: [stripOfProject, image("im8", M1)], draftLayout: [stripOfProject] }),
    "C9 image dans un emplacement mais suite SANS bande, image seule vide": project({ title: "Vide C9", layout: [{ uid: "im9", type: "image", props: { width: "wide" } }] }),
  };
  for (const [label, p] of Object.entries(cases)) {
    const r = await publish(PAGE, [board(`c-${p.id}`, p)]);
    const row = projectRow(p.id);
    ok(`${label} : refusée avec le message habituel, rien n'est écrit`, r.refused && !r.published && row?.draft_page_id === PAGE && hasDraft(PAGE) && r.text.includes(`Le projet « ${p.title} » n'a encore aucune image`), why(r));
  }
  await page.screenshot({ path: path.join(SHOTS, "C-refus.png") });
}

console.log("== D. Deux planches, une vide");
{
  const full = project({ title: "Projet D plein", layout: [stripOfProject, image("imd", M2)] });
  const empty = project({ title: "Projet D vide" });
  const r = await publish(PAGE, [board("d1", full), board("d2", empty)]);
  ok("D1 refus, erreur sur la seule planche vide", r.refused && r.text.includes("Projet D vide") && !r.text.includes("Le projet « Projet D plein »"), why(r));
  ok("D1 rien n'est publié : les deux projets restent des projets de brouillon", projectRow(full.id).draft_page_id === PAGE && projectRow(empty.id).draft_page_id === PAGE);
  sql((db) => db.prepare("update projects set layout = ? where id = ?").run(JSON.stringify([stripOfProject, image("imd2", M3)]), empty.id));
  const r2 = await publish(PAGE, [board("d1", full), board("d2", empty)]);
  ok("D2 planche vide remplie par un composant : publication des deux", r2.published && projectRow(full.id).draft_page_id === null && projectRow(empty.id).draft_page_id === null, why(r2));
}

ok("aucune erreur de page non gérée", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} échec(s)` : "\nTout est vert");
process.exit(failures ? 1 : 0);
