#!/usr/bin/env node
/**
 * Intégration v0.34b : non-régression du HTML public sur des pages SYNTHÉTIQUES d'ANCIEN format (aucune clé des lots 121, 127, 128, 129 :
 * ni `head`, ni `sound`, ni `padTop` / `padBottom`). Outil, pas une suite de la batterie.
 *
 *  dump     : (serveur requis, base neuve) sème les pages, les publie, puis écrit le HTML public normalisé (FR et EN) dans OUT.
 *             ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… OUT=dossier SRC=dossier-des-vidéos node scripts/html-regress034b.mjs dump
 *  compare  : node scripts/html-regress034b.mjs compare <dossierRef> <dossierNouveau>
 *             fichier par fichier : identique, ou différences brutes ; puis, sur le NOUVEAU seulement, retrait des différences ATTENDUES
 *             (bouton plein écran, son par défaut, attributs des icônes vidéo) et reste à expliquer (doit être vide).
 * Les médias sont les mêmes d'une base à l'autre (images peintes avec la même graine, vidéos générées une fois dans SRC).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const mode = process.argv[2] ?? "dump";

/* ---------- Normalisation : seules les valeurs qui changent à chaque build disparaissent ---------- */
export function normalize(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/g, "")
    .replace(/<link\b[^>]*rel="(?:preload|modulepreload|prefetch)"[^>]*>/g, "")
    .replace(/(\/_next\/static\/)[^"')\s]+/g, "$1X")
    .replace(/\s(?:nonce|data-dpl-id)="[^"]*"/g, "")
    .replace(/(https?:\/\/localhost):\d+/g, "$1:PORT")
    .replace(/(\/_next\/image\?url=[^"&]+&amp;w=\d+&amp;q=\d+)/g, "$1")
    .replace(/></g, ">\n<");
}

/* ---------- Différences ATTENDUES (lots 121 et 127), retirées du HTML NOUVEAU ---------- */
/** Lot 127 : le rail de la bande enveloppe son bouton « Lecteur » dans `<div class="strip-fs-wrap">` (rapport du lot 127) : on retire l'enveloppe (ouvrante ET fermante). */
function unwrapFs(html) {
  const out = html.split("\n");
  for (let i = 0; i < out.length; i++) {
    if (!/^<div class="strip-fs-wrap">$/.test(out[i])) continue;
    let depth = 0;
    for (let j = i; j < out.length; j++) {
      depth += (out[j].match(/<div\b/g) ?? []).length - (out[j].match(/<\/div>/g) ?? []).length;
      if (depth === 0) {
        out.splice(j, 1);
        break;
      }
    }
    out.splice(i, 1);
    i--;
  }
  return out.join("\n");
}

/** Appliqué aux DEUX côtés : le bouton son d'une boucle (son activé par défaut : état, nom et icône changent) et ses attributs. */
export function withoutExpected(html) {
  return unwrapFs(
    html
      // Lot 127 : bouton plein écran (boucles, lecteurs, rail) ; son par défaut (attributs et état des boutons son).
      .replace(/<button[^>]*vid-fs[^>]*>[\s\S]*?<\/button>\n?/g, "")
      .replace(/<button[^>]*vid-sound[^>]*>[\s\S]*?<\/button>\n?/g, "")
      .replace(/\sdata-video-sound="(?:on|off)"/g, "")
      .replace(/\sdata-video-audio=""/g, "")
      // Lot 121 : chaque icône vidéo porte sa clé du kit et sa taille.
      .replace(/(<svg\b[^>]*?)\sdata-vicon="[^"]*"/g, "$1")
      .replace(/(<svg\b[^>]*?)\sstyle="--vi:[^"]*"/g, "$1")
  );
}

if (mode === "compare") {
  const [a, b] = [process.argv[3], process.argv[4]];
  const files = [...new Set([...readdirSync(a), ...readdirSync(b)])].filter((f) => f.endsWith(".html")).sort();
  const port = (h) => h.replace(/(https?:\/\/localhost):\d+/g, "$1:PORT");
  const lines = (s) => s.split("\n");
  // Diff exact (ordre et multiplicité des lignes) : `diff -U0`, pas une comparaison d'ensembles.
  const diff = (p, q) => {
    const dir = mkdtempSync(path.join(tmpdir(), "regress034b-"));
    writeFileSync(path.join(dir, "a"), `${p}\n`);
    writeFileSync(path.join(dir, "b"), `${q}\n`);
    let out = "";
    try {
      out = execFileSync("diff", ["-U0", path.join(dir, "a"), path.join(dir, "b")], { encoding: "utf8", maxBuffer: 1 << 26 });
    } catch (e) {
      out = e.stdout ?? "";
    }
    rmSync(dir, { recursive: true, force: true });
    const ls = out.split("\n").filter((l) => !/^(---|\+\+\+|@@)/.test(l));
    return { onlyRef: ls.filter((l) => l.startsWith("-")).map((l) => l.slice(1)), onlyNew: ls.filter((l) => l.startsWith("+")).map((l) => l.slice(1)) };
  };
  let identical = 0;
  let expectedOnly = 0;
  let residual = 0;
  for (const f of files) {
    if (!existsSync(path.join(a, f)) || !existsSync(path.join(b, f))) {
      console.log(`MANQUE ${f}`);
      residual++;
      continue;
    }
    const x = port(readFileSync(path.join(a, f), "utf8"));
    const y = port(readFileSync(path.join(b, f), "utf8"));
    if (x === y) {
      identical++;
      console.log(`IDENTIQUE ${f} (${lines(x).length} lignes)`);
      continue;
    }
    const raw = diff(x, y);
    const left = diff(withoutExpected(x), withoutExpected(y));
    const none = left.onlyRef.length === 0 && left.onlyNew.length === 0;
    if (none) expectedOnly++;
    else residual++;
    console.log(`${none ? "ATTENDU  " : "RESTE    "} ${f} : ${raw.onlyRef.length + raw.onlyNew.length} lignes différentes brutes ; après retrait des différences attendues : ${left.onlyRef.length} dans la référence seule, ${left.onlyNew.length} dans le nouveau seul`);
    if (!none) {
      for (const l of left.onlyRef.slice(0, 8)) console.log(`   - ${l.slice(0, 220)}`);
      for (const l of left.onlyNew.slice(0, 8)) console.log(`   + ${l.slice(0, 220)}`);
    }
  }
  console.log(`RESULTAT : ${files.length} pages : ${identical} identiques, ${expectedOnly} ne diffèrent que par les changements ATTENDUS, ${residual} avec un RESTE inexpliqué`);
  process.exit(residual === 0 ? 0 : 1);
}

/* ---------- dump ---------- */
const { chromium } = await import("playwright");
const { boardDraft, grid, img, login, makeMedia, openEditor, pageIdOf, q1, setBoardDraft, setDraft, settled, sleep, sql, waitFor } = await import("./lib/grille31d.mjs");

const BASE = process.env.BASE ?? "http://localhost:4200";
const OUT = process.env.OUT ?? "./html-out";
const SRC = process.env.SRC ?? "./html-src";
mkdirSync(OUT, { recursive: true });
mkdirSync(SRC, { recursive: true });

const ff = (...args) => execFileSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"] });
const V = ["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=15", "-t", "3"];
const A = ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100"];
const X264 = ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-bitexact", "-fflags", "+bitexact", "-flags:v", "+bitexact"];
const FILES = {
  avec: { file: "r34b-avec-son.mp4", args: [...V, ...A, ...X264, "-c:a", "aac", "-ac", "2", "-shortest"] },
  sans: { file: "r34b-sans-son.mp4", args: [...V, ...X264, "-an"] },
};
for (const v of Object.values(FILES)) if (!existsSync(path.join(SRC, v.file))) ff(...v.args, path.join(SRC, v.file));

const browser = await chromium.launch({ args: ["--disable-gpu", "--renderer-process-limit=2", "--disable-extensions"] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
page.setDefaultTimeout(60000);
await login(page, BASE);
const row = (name) => q1("select id, status from media where original_name = ? order by id desc", name);
const VM = {};
for (const [k, v] of Object.entries(FILES)) {
  await page.goto(`${BASE}/admin/medias`, { waitUntil: "networkidle" });
  await page.locator("input[type=file]").first().setInputFiles(path.join(SRC, v.file));
  if (!(await waitFor(() => row(v.file)?.status === "ready", 300000))) throw new Error(`${v.file} : ${JSON.stringify(row(v.file))}`);
  VM[k] = row(v.file).id;
}
const M = await makeMedia(page, BASE);
const project = q1("select id, slug from projects order by id limit 1");

const L = (fr, en = fr) => ({ fr, en });
const CARD = { color: "surface", corners: "m", width: "inset" };
const FOND = { kind: "color", color: "ink", inset: "m", round: "s" };
const fit = (id, media, x, y, w, extra = {}) => ({ id, media, x, y, w, rot: 0, z: 0, ...extra });
const vid = (uid, media, props = {}) => ({ uid, type: "video-single", props: { mediaId: media, variant: "card", ...props } });
const cap = { captionTitle: L("Titre de légende"), caption: L("Texte de légende"), captionDate: L("2026") };
const PAGES = {
  personnages: [
    { uid: "r1", type: "rich-text", props: { eyebrow: L("Étiquette"), title: L("Un titre de texte"), paragraphs: [L("Premier paragraphe synthétique."), L("Second paragraphe.")] } },
    img("i1", M.paysage, { surface: CARD, ...cap, look: { spaceTop: "m", spaceBottom: "l" } }),
    img("i2", M.carre, { background: FOND, surface: CARD, look: { spaceSides: "m" } }),
    img("i3", M.portrait, { width: "text", ...cap }),
    grid("g1", { layout: "3", title: L("Une grille"), caption: L("Sous la grille") }, [img("g1a", M.paysage, cap), img("g1b", M.portrait), img("g1c", M.carre, { surface: CARD })]),
    { uid: "f1", type: "free-board", props: { format: "3:2", phone: "scale", crop: { t: 0, r: 0, b: 30, l: 0 }, surface: CARD, items: [fit("a", M.portrait, 8, 6, 26), fit("b", M.carre, 40, 10, 30, { z: 1 })], ...cap } },
    { uid: "f2", type: "free-board", props: { format: "16:9", phone: "stack", background: FOND, items: [fit("a", M.paysage, 10, 10, 40), fit("b", M.panorama, 30, 40, 50)] } },
  ],
  decors: [
    vid("v1", VM.avec, { mode: "loop", title: L("Boucle") }),
    vid("v2", VM.avec, { mode: "player", title: L("Lecteur") }),
    vid("v3", VM.sans, { mode: "loop", title: L("Boucle sans son") }),
    vid("v4", VM.sans, { mode: "player", variant: "plain" }),
    grid("g2", { layout: "2" }, [vid("g2a", VM.avec, { variant: "plain", mode: "loop" }), vid("g2b", VM.avec, { variant: "plain", mode: "player" })]),
    { uid: "p1", type: "project-board", props: { project: project.slug } },
  ],
  animation: [
    { uid: "fv", type: "free-board", props: { format: "3:2", phone: "scale", zoom: false, items: [fit("a", VM.avec, 5, 5, 25), fit("b", VM.avec, 40, 5, 25, { video: "player" }), fit("c", VM.sans, 5, 50, 25), fit("d", M.paysage, 40, 50, 25)] } },
    img("ia", M.paysage, { surface: CARD }),
    { uid: "rt", type: "rich-text", props: { title: L("Texte de fin"), paragraphs: [L("Un dernier paragraphe.")] } },
  ],
};
// Planche du projet de la page « decors » : rails (bandes), grille, planche libre, vidéo seule (ancien format : aucune clé de son).
const own = (uid, media, ids) => ({ uid, type: "strip", props: { source: "own", media, ids } });
const BOARD = [
  own("c1", [M.paysage, VM.avec, M.carre, VM.sans], ["a1", "b2", "c3", "d4"]),
  own("c2", [VM.avec], ["aa1"]),
  vid("bv", VM.avec, { mode: "player", variant: "plain" }),
  { uid: "bg", type: "grid", props: { layout: "2", gap: "normal", align: "stretch", ratio: "auto", top: "gap", children: [vid("bk1", VM.avec, { variant: "plain", mode: "loop" }), vid("bk2", VM.sans, { variant: "plain", mode: "player" })] } },
  { uid: "bfb", type: "free-board", props: { format: "3:2", phone: "scale", zoom: false, items: [fit("ba", VM.avec, 5, 5, 25), fit("bp", VM.avec, 40, 5, 25, { video: "player" })] } },
];
const countOf = (pageId) => sql((db) => db.prepare("select count(*) as n from blocks where page_id = ?").get(pageId)).n;
for (const [slug, blocks] of Object.entries(PAGES)) {
  const pageId = pageIdOf(slug);
  setDraft(pageId, JSON.parse(JSON.stringify(blocks)));
  if (slug === "decors") setBoardDraft(project.id, pageId, BOARD);
  const fr = await openEditor(page, BASE, pageId);
  await settled(page);
  void fr;
  await page.getByRole("button", { name: "Publier", exact: true }).click();
  const confirm = page.locator("dialog[open]").getByRole("button", { name: "Mettre en ligne" });
  if (await confirm.waitFor({ timeout: 4000 }).then(() => true, () => false)) await confirm.click();
  const done = await waitFor(() => sql((db) => db.prepare("select draft from pages where id = ?").get(pageId)).draft === null && (slug !== "decors" || boardDraft(project.id) === null), 120000);
  if (!done) throw new Error(`publication de ${slug} sans effet`);
  await sleep(2500);
}
await browser.close();

/* Crawl : l'accueil, les trois pages semées, et tous les liens internes de l'accueil (FR et EN). */
const get = async (p) => {
  const r = await fetch(`${BASE}${p}`, { redirect: "follow" });
  return { status: r.status, html: await r.text() };
};
const hrefs = (html) => [...new Set([...html.matchAll(/href="(\/(?:fr|en)(?:\/[a-z0-9-]+)*)"/g)].map((m) => m[1]))];
const paths = new Set(["/fr", "/en", ...Object.keys(PAGES).flatMap((s) => [`/fr/${s}`, `/en/${s}`])]);
for (const loc of ["fr", "en"]) for (const h of hrefs((await get(`/${loc}`)).html)) paths.add(h);
let n = 0;
for (const p of [...paths].sort()) {
  const { status, html } = await get(p);
  if (status !== 200) {
    console.log(`SKIP ${p} (${status})`);
    continue;
  }
  writeFileSync(path.join(OUT, `${p.slice(1).replace(/\//g, "_")}.html`), normalize(html));
  n++;
}
console.log(`DUMP ${n} pages dans ${OUT}`);
