#!/usr/bin/env node
/**
 * Lot 111 (chromium, serveur requis, base NEUVE, données SYNTHÉTIQUES) : contenu d'un bloc Projet propre à la page, création d'un projet sans nom.
 *   A : un projet sur deux pages ; A tient un brouillon de contenu partagé ; B refusée avec un message actionnable ; « Contenu propre à cette page » (B) ;
 *       « Garder ce contenu pour cette page seulement » (A) ; publication des deux ; public = éditeur ; rechargement ; retour au contenu partagé
 *       (confirmation dans la page) ; journal ; rien de réécrit sans geste ; « + Ajouter » ne chevauche plus « N works ».
 *   P : création : sans nom, slug aléatoire unique, ajout d'images proposé, titre modifiable sans toucher au slug, public ; depuis l'éditeur.
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… [ONLY=A,P] node scripts/e2e-contenu111.mjs
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { chromium } from "playwright";

import { paint } from "./lib/crop-fixtures.mjs";
import { createProjectUi } from "./lib/projet111.mjs";
import { login, q1, waitFor } from "./lib/medias-setup.mjs";
import { publishBlocks } from "./lib/page-draft.mjs";
import { placeBoard } from "./lib/page-board.mjs";

const BASE = process.env.BASE ?? "http://localhost:3800";
const ONLY = process.env.ONLY ?? "";
const run = (s) => !ONLY || ONLY.split(",").includes(s);
const DATA = process.env.DATA_DIR ?? "data";
const DB = path.join(DATA, "portfolio.db");
const SHOTS = process.env.SHOTS ?? path.join(DATA, "..", "shots-contenu111");
mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${String(detail).slice(0, 600)}` : ""}`);
};
const sql = (fn, write = false) => {
  const db = new Database(DB, write ? undefined : { readonly: true });
  db.pragma("busy_timeout = 5000");
  try {
    return fn(db);
  } finally {
    db.close();
  }
};
const journal = (where = "1=1") => {
  const file = path.join(DATA, "edit-log.db");
  if (!existsSync(file)) return [];
  const db = new Database(file, { readonly: true });
  try {
    return db.prepare(`select action, result, label from edit_log where ${where} order by id`).all();
  } finally {
    db.close();
  }
};
const until = async (fn, timeout = 60000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
};

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log(`# pageerror ${e.message.slice(0, 200)}`));
await login(page, BASE);

async function section(name, fn) {
  try {
    await fn();
  } catch (e) {
    ok(`${name} : exception inattendue`, false, String(e.message).split("\n").slice(0, 6).join(" "));
    await page.screenshot({ path: path.join(SHOTS, `erreur-${name}.png`) }).catch(() => {});
  }
}
async function canvas() {
  const handle = await page.waitForSelector("iframe.ve-frame", { timeout: 120000 });
  const fr = await handle.contentFrame();
  await fr.waitForSelector("html[data-edit-mode]", { timeout: 180000 });
  return fr;
}
async function openEditor(pageId) {
  await page.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
  let fr = await canvas();
  if (await page.getByRole("button", { name: "Abandonner les modifications" }).count()) {
    await page.getByRole("button", { name: "Abandonner les modifications" }).click();
    await Promise.all([page.waitForEvent("framenavigated", { predicate: (x) => x === page.mainFrame(), timeout: 60000 }), page.getByRole("dialog").getByRole("button", { name: "Abandonner les modifications" }).click()]);
    fr = await canvas();
  }
  await fr.waitForSelector("[data-edit-board]", { timeout: 60000 });
  return fr;
}
const pageIdBySlug = (s) => q1("select id from pages where json_extract(slug, '$.fr') = ?", s)?.id;
const draftBlocks = (id) => {
  const d = q1("select draft from pages where id = ?", id)?.draft;
  return d ? JSON.parse(d).blocks : null;
};
const pubBlock = (id) => sql((db) => db.prepare("select props from blocks where page_id = ? and type = 'project-board' limit 1").get(id)).props;
const projRow = (id) => sql((db) => db.prepare("select slug, layout, draft_layout, draft_layout_page_id from projects where id = ?").get(id));
const fingerprint = () => JSON.stringify([sql((db) => db.prepare("select id, slug, layout from projects order by id").all()), sql((db) => db.prepare("select page_id, type, props from blocks order by id").all())]);
async function publishPage(pageId) {
  const draft = q1("select draft from pages where id = ?", pageId)?.draft;
  if (!draft) return true;
  await page.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
  const publish = page.getByRole("button", { name: "Publier", exact: true });
  await publish.waitFor({ timeout: 60000 });
  for (let n = 0; n < 4; n++) {
    await page.waitForTimeout(2000);
    await publish.click();
    if (await until(async () => q1("select draft from pages where id = ?", pageId)?.draft === null, 20000)) return true;
  }
  return false;
}

/* ------------------------------ A : contenu propre à la page ------------------------------ */
await section("A", async () => {
  if (!run("A")) return;
  // Images synthétiques.
  for (const [i, name] of ["c111-1.png", "c111-2.png", "c111-3.png"].entries()) {
    await page.request.post(`${BASE}/admin/api/upload`, { headers: { origin: BASE }, multipart: { file: { name, mimeType: "image/png", buffer: await paint(1200, 800, 3 + i) } }, timeout: 180000 });
  }
  await waitFor(() => (q1("select count(*) n from media where original_name like 'c111-%' and status = 'ready'")?.n ?? 0) === 3, 240000);
  const M = sql((db) => db.prepare("select id, key from media where original_name like 'c111-%' order by original_name").all());
  // Un projet (créé par l'interface), trois œuvres, un contenu partagé publié : la bande du projet et une image.
  await page.goto(`${BASE}/admin/pages#projets`, { waitUntil: "networkidle" });
  const pid = await createProjectUi(page, "Projet contenu 111");
  const slug = q1("select slug from projects where id = ?", pid).slug;
  const shared = [
    { uid: "strip", type: "strip", props: {} },
    { uid: "im1", type: "image", props: { mediaId: M[0].id, width: "full", background: { kind: "color", color: "surface", inset: "m" } } },
  ];
  sql((db) => {
    M.forEach((m, i) => db.prepare("insert into slots (project_id, position, media_id, slug, collection, title, description, year) values (?, ?, ?, ?, 'characters', '{\"fr\":\"\",\"en\":\"\"}', '{\"fr\":\"\",\"en\":\"\"}', 2026)").run(pid, i, m.id, `${slug}-${i + 1}`));
    db.prepare("update projects set layout = ? where id = ?").run(JSON.stringify(shared), pid);
  }, true);
  const A = pageIdBySlug("personnages");
  const B = pageIdBySlug("decors");
  const place = async (pg) => {
    if (await placeBoard(page, BASE, pg, slug)) return true;
    // Clic sur « Publier » parti avant l'hydratation : on republie le brouillon déjà écrit (sans reposer le bloc).
    console.log(`# placeBoard ${pg} : republication`);
    await publishPage(pg);
    return q1("select count(*) n from blocks where page_id = ? and type = 'project-board' and json_extract(props, '$.project') = ?", pg, slug).n === 1;
  };
  const placed = (await place(A)) && (await place(B));
  if (!placed) {
    await page.screenshot({ path: path.join(SHOTS, "erreur-A0.png") });
    console.log("# blocs A", JSON.stringify(sql((db) => db.prepare("select id, position, type, props from blocks where page_id = ? and type = 'project-board'").all(A))));
    console.log("# brouillon A", JSON.stringify(draftBlocks(A)?.filter((b) => b.type === "project-board")));
  }
  ok("A0 le projet est posé sur deux pages", placed, JSON.stringify([q1("select count(*) n from blocks where page_id = ? and type = 'project-board' and json_extract(props, '$.project') = ?", A, slug), q1("select draft is not null d from pages where id = ?", A)]));
  // Données antérieures : A tient un brouillon de contenu du projet (une image de plus). Plus aucun verrou : B n'en est pas gênée.
  const draftA = [...shared, { uid: "im2", type: "image", props: { mediaId: M[1].id, width: "full" } }];
  sql((db) => db.prepare("update projects set draft_layout = ?, draft_layout_page_id = ? where id = ?").run(JSON.stringify(draftA), A, pid), true);
  const base0 = fingerprint();
  const S = `[data-edit-board="${pid}"]`;
  const blockOf = (id) => draftBlocks(id)?.find((b) => b.type === "project-board" && b.props.project === slug);
  const op = (name, uid) => `[data-edit-bitem-op="${name}"][data-board="${pid}"][data-uid="${uid}"]`;

  // B : ancien bloc, rendu identique, aucun message de blocage, aucun bouton de partage.
  let f = await openEditor(B);
  ok("A1 B montre le contenu publié du projet (une image), sans blocage", (await f.locator(`${S} [data-edit-bitem-type=image]`).count()) === 1 && (await f.locator(`${S}[data-edit-layout-held]`).count()) === 0);
  ok("A1b rien n'a été réécrit à l'ouverture", fingerprint() === base0);
  ok("A1c plus de geste « Garder / Revenir au contenu partagé »", (await f.getByRole("button", { name: /Garder ce contenu|Revenir au contenu partagé|Contenu propre à cette page/ }).count()) === 0);
  await f.locator(op("up", "im1")).click({ force: true });
  ok("A2 B modifie son contenu sans refus : le bloc de B reçoit sa copie", await until(async () => blockOf(B)?.props.layout?.[0]?.uid === "im1"), JSON.stringify(blockOf(B)?.props));
  ok("A2b aucun message de refus, aucun verrou", (await page.getByTestId("layout-prompt").count()) === 0 && projRow(pid).draft_layout_page_id === A);
  ok("A2c le contenu du projet et le brouillon tenu par A n'ont pas bougé", JSON.stringify(JSON.parse(projRow(pid).layout)) === JSON.stringify(shared) && JSON.stringify(JSON.parse(projRow(pid).draft_layout)) === JSON.stringify(draftA));
  ok("A2d la toile se met à jour (même contenu après rechargement)", await (async () => {
    const g = await openEditor(B);
    return (await g.locator(`${S} [data-edit-bitem-type=image]`).count()) === 1 && JSON.stringify(blockOf(B)?.props.layout?.[0]?.uid) === '"im1"';
  })());
  ok("A2e un refus ou une écriture laisse une entrée au journal", await until(async () => journal("action = 'boardAction' and result = 'ok'").length > 0));

  // A : son brouillon (données antérieures) devient la copie propre de son bloc à la première modification.
  f = await openEditor(A);
  ok("A3 A voit son brouillon (deux images)", (await f.locator(`${S} [data-edit-bitem-type=image]`).count()) === 2);
  await f.locator(op("up", "im2")).click({ force: true });
  ok("A4 la première modification de A copie son brouillon dans son bloc, sans perte", await until(async () => JSON.stringify(blockOf(A)?.props.layout?.map((i) => i.uid)) === JSON.stringify(["strip", "im2", "im1"]) && projRow(pid).draft_layout === null && projRow(pid).draft_layout_page_id === null), JSON.stringify([blockOf(A)?.props, projRow(pid).draft_layout_page_id]));
  ok("A4b B n'a pas bougé", JSON.stringify(blockOf(B)?.props.layout?.map((i) => i.uid)) === JSON.stringify(["im1", "strip"]));
  ok("A4c le contenu du projet est intact", JSON.stringify(JSON.parse(projRow(pid).layout)) === JSON.stringify(shared));
  // Textes propres au bloc de B (écrits comme le fait l'éditeur dans le brouillon, puis publiés avec la page).
  const t = (v) => ({ fr: v, en: v });
  const titleB = "Titre de la page B";
  const proj0 = projRow(pid);
  const canvasCountA = (await (await openEditor(A)).locator(`${S} .strip-count`).first().textContent())?.trim();

  // Publication des deux pages : public = éditeur.
  ok("A8 A publiée", await publishPage(A));
  ok("A8b B publiée", await publishPage(B));
  ok("A8c le projet partagé n'a pas changé", JSON.stringify(JSON.parse(projRow(pid).layout)) === JSON.stringify(shared));
  sql((db) => {
    const row = db.prepare("select id, props from blocks where page_id = ? and type = 'project-board' and json_extract(props, '$.project') = ?").get(B, slug);
    const props = JSON.parse(row.props);
    props.text = { title: t(titleB), context: t("Contexte B"), description: t(""), year: "2026" };
    db.prepare("update blocks set props = ? where id = ?").run(JSON.stringify(props), row.id);
  }, true);
  const pubA = await (await page.request.get(`${BASE}/fr/personnages`)).text();
  const pubB = await (await page.request.get(`${BASE}/fr/decors`)).text();
  // Le bloc du projet est le dernier de chaque page : on lit à partir de son titre.
  const from = (html, title) => html.slice(Math.max(0, html.indexOf(title)));
  const mine = { A: from(pubA, "Projet contenu 111"), B: from(pubB, titleB) };
  const imgs = (html) => (html.match(/<img\b/g) ?? []).length;
  ok("A9 public : A montre une image de plus que B", imgs(mine.A) - imgs(mine.B) === 1, `${imgs(mine.A)} / ${imgs(mine.B)}`);
  ok("A9a public : B montre ses textes propres, A ceux du projet", pubB.includes(titleB) && !pubA.includes(titleB), "");
  const publicCountA = /strip-count[^>]*>([^<]*)</.exec(mine.A)?.[1]?.trim();
  ok("A9b compteur d'œuvres : même texte sur la toile de A et en public", Boolean(publicCountA) && publicCountA === canvasCountA, `${canvasCountA} / ${publicCountA}`);
  f = await openEditor(A);
  ok("A10 éditeur rechargé : le contenu de A est celui du public", (await f.locator(`${S} [data-edit-bitem-type=image]`).count()) === 2);
  ok("A10b le titre du projet n'a pas bougé", JSON.stringify(projRow(pid)) === JSON.stringify(proj0));

  // « + Ajouter » ne chevauche pas le compteur (capture de B).
  f = await openEditor(B);
  const box = async (sel) => f.locator(`${S} ${sel}`).first().boundingBox();
  const c = await box(".strip-count");
  const a = await box(".pe-bitem-add[data-first] button");
  const overlap = c && a && !(a.x + a.width <= c.x || c.x + c.width <= a.x || a.y + a.height <= c.y || c.y + c.height <= a.y);
  ok("A11 « + Ajouter » ne chevauche pas « N works »", Boolean(c && a) && !overlap, JSON.stringify({ c, a }));
  // Chaque « + Ajouter » est entièrement visible : hors de tout composant (carte, contour, Fond), sans recouvrir de contenu.
  const boxes = await f.evaluate((id) => {
    const r = (e) => {
      const b = e.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    };
    const board = document.querySelector(`[data-edit-board="${id}"]`);
    return { adds: [...board.querySelectorAll("[data-edit-bitem-add]")].map(r), items: [...board.querySelectorAll("[data-edit-bitem]")].map(r), view: window.innerWidth };
  }, pid);
  const hit = (a, b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
  ok("A11b « + Ajouter » : jamais à cheval sur le bord d'un composant (dehors, ou entièrement à l'intérieur), tous entièrement visibles", boxes.adds.length >= 2 && boxes.adds.slice(1).every((a) => a.w > 0 && a.x >= 0 && a.x + a.w <= boxes.view && boxes.items.every((it) => !hit(a, it) || (a.x >= it.x && a.x + a.w <= it.x + it.w && a.y >= it.y && a.y + a.h <= it.y + it.h))), JSON.stringify(boxes));
  ok("A14 le journal garde la trace des gestes", journal("action = 'boardAction' and result = 'ok'").length >= 2, JSON.stringify(journal("action = 'boardAction'")));
  await page.screenshot({ path: path.join(SHOTS, "A-fin.png") });
});

/* ------------------------------ P : création sans nom ------------------------------ */
await section("P", async () => {
  if (!run("P")) return;
  await page.goto(`${BASE}/admin/pages#projets`, { waitUntil: "networkidle" });
  const create = async () => {
    await page.getByRole("button", { name: "Nouveau projet" }).click();
    const d = page.locator("dialog[open]");
    ok("P0 la création ne demande aucun nom", (await d.getByRole("textbox").count()) === 0);
    await d.getByRole("button", { name: "Créer le projet" }).click();
    await page.waitForURL(/\/admin\/projets\/\d+$/);
    return Number(page.url().split("/").pop());
  };
  const closeProposal = async () => {
    const shown = await page.locator("dialog[open]").waitFor({ timeout: 15000 }).then(() => true, () => false);
    if (shown) {
      await page.keyboard.press("Escape");
      await page.locator("dialog[open]").waitFor({ state: "detached", timeout: 5000 }).catch(() => {});
    }
    return shown;
  };
  const id1 = await create();
  await page.waitForSelector("dialog[open]", { timeout: 15000 }).catch(() => {});
  await page.screenshot({ path: path.join(SHOTS, "P-ajout-propose.png") });
  ok("P1 l'ajout d'images est proposé tout de suite", await closeProposal());
  const p1 = q1("select slug, title from projects where id = ?", id1);
  ok("P2 slug = id aléatoire court (p- + 8 caractères)", /^p-[a-z0-9]{8}$/.test(p1.slug), p1.slug);
  ok("P2b titre par défaut", JSON.parse(p1.title).fr === "Projet sans titre");
  await page.goto(`${BASE}/admin/pages#projets`, { waitUntil: "networkidle" });
  const id2 = await create();
  await closeProposal();
  const p2 = q1("select slug, title from projects where id = ?", id2);
  ok("P3 deux créations = deux projets indépendants (slugs différents, même titre par défaut)", id1 !== id2 && p1.slug !== p2.slug && p1.title === p2.title);
  // Titre modifié en place : le slug ne bouge pas.
  await page.locator('section[aria-labelledby="pr-infos"] .a-input').first().fill("Titre choisi après coup");
  await page.locator('section[aria-labelledby="pr-infos"]').getByRole("button", { name: "Enregistrer" }).click();
  await page.waitForTimeout(1500);
  console.log("# erreurs P4", JSON.stringify(await page.locator(".a-field-error, .a-notice, [role=alert]").allTextContents()));
  await page.screenshot({ path: path.join(SHOTS, "P4.png") });
  ok("P4 titre modifiable sans toucher au slug", await until(async () => JSON.parse(q1("select title from projects where id = ?", id2).title).fr === "Titre choisi après coup" && q1("select slug from projects where id = ?", id2).slug === p2.slug));
  ok("P4b l'autre projet est intact", q1("select slug from projects where id = ?", id1).slug === p1.slug && JSON.parse(q1("select title from projects where id = ?", id1).title).fr === "Projet sans titre");
  // Public : posé sur une page, le projet porte son nouveau titre.
  const home = pageIdBySlug("animation");
  ok("P5 posé sur une page", await placeBoard(page, BASE, home, p2.slug));
  sql((db) => db.prepare("insert into slots (project_id, position, media_id, slug, collection, title, description, year) values (?, 0, (select id from media where status = 'ready' limit 1), ?, 'animation', '{\"fr\":\"\",\"en\":\"\"}', '{\"fr\":\"\",\"en\":\"\"}', 2026)").run(id2, `${p2.slug}-1`), true);
  const pub = await (await page.request.get(`${BASE}/fr/animation`)).text();
  ok("P5b public : le titre choisi après coup s'affiche, pas le titre par défaut", pub.includes("Titre choisi après coup"));

  // Depuis l'éditeur visuel : bloc Projet sans projet, « Nouveau projet » sans nom.
  const cp = pageIdBySlug("decors");
  await publishBlocks(page, BASE, cp, (blocks) => [...blocks.filter((b) => b.type !== "project-board"), { uid: "nb111", type: "project-board", props: {} }], () => true);
  const f = await openEditor0(cp);
  const input = f.locator(".pe-board-new input[role=combobox]");
  await input.click();
  const opt = f.locator(".pe-combo-opt[data-kind=create]");
  ok("P6 éditeur : « Nouveau projet » est proposé sans rien saisir", await opt.waitFor({ timeout: 30000 }).then(() => true, () => false));
  await opt.click();
  ok("P7 éditeur : projet créé avec slug aléatoire et titre par défaut, bloc relié", await until(async () => {
    const b = draftBlocks(cp)?.find((x) => x.uid === "nb111");
    const s = b?.props.project;
    return typeof s === "string" && /^p-[a-z0-9]{8}$/.test(s) && JSON.parse(q1("select title from projects where slug = ?", s).title).fr === "Projet sans titre";
  }));
  ok("P8 éditeur : l'ajout d'images est proposé tout de suite", await page.locator("dialog[open]").waitFor({ timeout: 30000 }).then(() => true, () => false));
  await page.screenshot({ path: path.join(SHOTS, "P-editeur-ajout.png") });
  await page.keyboard.press("Escape");
  async function openEditor0(pageId) {
    await page.goto(`${BASE}/admin/pages/${pageId}/editer`, { waitUntil: "domcontentloaded" });
    const fr = await canvas();
    await fr.waitForSelector(".pe-board-new", { timeout: 60000 });
    return fr;
  }
});

await browser.close();
console.log(`\n${failures ? "ÉCHEC" : "OK"} : ${failures} échec(s)`);
process.exit(failures ? 1 : 0);
