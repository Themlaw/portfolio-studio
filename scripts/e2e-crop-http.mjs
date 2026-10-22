#!/usr/bin/env node
/**
 * Lot 17d, version SANS navigateur (HTTP + sharp) : pour les machines où chromium ne se lance pas.
 * Couvre ce qui se vérifie sur le HTML servi et les octets des variantes : rapport et personnage de chaque
 * recadrage libre (pixels de la variante servie), netteté (plus grande largeur proposée ≥ pixels affichés × DPR
 * quand l'original le permet), attributs du plafond de hauteur / du panorama pleine largeur, route publique
 * /media/crop (signature, bornes, lecture seule, rien écrit sur le disque, 304).
 * Les mesures de mise en page réelle (hauteur ≤ 85 % de l'écran, modale) restent à e2e-crop.mjs (chromium).
 * Usage : ADMIN_EMAIL=… ADMIN_PASSWORD=… DATA_DIR=… BASE=… node scripts/e2e-crop-http.mjs
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import sharp from "sharp";

import { paint, perso, sheet } from "./lib/crop-fixtures.mjs";
import { pageIdOf, q1, waitFor } from "./lib/medias-setup.mjs";

const BASE = process.env.BASE ?? "http://localhost:3103";
const DATA = process.env.DATA_DIR ?? "data";
const DB = path.join(DATA, "portfolio.db");
sharp.cache(false);
sharp.concurrency(1);

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
};

/* ---- session (pot de cookies minimal) ------------------------------------------------- */
const jar = new Map();
const store = (res) => {
  for (const c of res.headers.getSetCookie()) {
    const [kv] = c.split(";");
    const i = kv.indexOf("=");
    jar.set(kv.slice(0, i), kv.slice(i + 1));
  }
};
const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
const call = async (p, init = {}, withCookie = true) => {
  const res = await fetch(BASE + p, { redirect: "manual", ...init, headers: { origin: BASE, ...(withCookie ? { cookie: cookie() } : {}), ...init.headers } });
  if (withCookie) store(res);
  return res;
};
const login = await call("/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }) });
if (login.status !== 200) throw new Error(`connexion : ${login.status}`);

const mediaOf = (name) => q1("select id, status, width, height from media where original_name = ? order by id desc", name);
async function ensure(name, make) {
  if (!mediaOf(name)) {
    const form = new FormData();
    form.set("file", new Blob([await make()], { type: "image/png" }), name);
    const res = await call("/admin/api/upload", { method: "POST", body: form });
    if (res.status >= 300) throw new Error(`envoi ${name} : ${res.status}`);
  }
  if (!(await waitFor(() => mediaOf(name)?.status === "ready", 240000))) throw new Error(`${name} : ${JSON.stringify(mediaOf(name))}`);
  return mediaOf(name).id;
}
const SHEET = await ensure("17d-planche.png", sheet);
const PORTRAIT = await ensure("17d-portrait.png", () => paint(1200, 2400, 4));
const PANO = await ensure("17d-pano.png", () => paint(10000, 2500, 1));
const pageId = pageIdOf("personnages");

const P1 = { x: 0, y: 0, w: 0.5, h: 0.5 };
const P3 = { x: 0, y: 0.5, w: 0.5, h: 0.5 };
const P2 = { x: 0.52, y: 0.04, w: 0.44, h: 0.42 };
const P4 = { x: 0.55, y: 0.54, w: 0.2, h: 0.4 };
const img = (uid, mediaId, props = {}, crop) => ({ uid, type: "image", props: { mediaId, width: "wide", ...props, ...(crop ? { look: { crop: { mediaId: crop } } } : {}) } });
const rectCrop = (rect) => ({ x: 50, y: 50, zoom: 1, rect });
const LAYOUT = [
  img("a-rouge", SHEET, {}, rectCrop(P1)),
  img("a-bleu", SHEET, {}, rectCrop(P3)),
  { uid: "g-persos", type: "grid", props: { layout: "2", gap: "normal", align: "stretch", ratio: "auto", top: "gap", children: [img("c-vert", SHEET, {}, rectCrop(P2)), img("c-jaune", SHEET, {}, rectCrop(P4))] } },
  img("b-portrait", PORTRAIT),
  img("b-pano-plein", PANO, { width: "full" }),
  img("b-pano-169", PANO, { width: "full", ratio: "16:9" }),
  img("b-pano-169-cover", PANO, { width: "full", ratio: "16:9", fit: "cover" }),
  { uid: "g-decors", type: "grid", props: { layout: "3", gap: "normal", align: "stretch", ratio: "4:5", top: "gap", children: [img("d1", PANO, {}, { x: 50, y: 50, zoom: 1.5 }), img("d2", PANO), img("d3", PORTRAIT)] } },
];
{
  const db = new Database(DB);
  db.pragma("busy_timeout = 5000");
  const row = db.prepare("select title, slug, meta, nav_order from pages where id = ?").get(pageId);
  const draft = { title: JSON.parse(row.title), slug: JSON.parse(row.slug), meta: row.meta ? JSON.parse(row.meta) : { title: { fr: "", en: "" }, description: { fr: "", en: "" } }, published: true, inMenu: row.nav_order !== null, accent: null, blocks: LAYOUT };
  db.prepare("update pages set draft = ?, draft_updated_at = unixepoch(), draft_rev = draft_rev + 1 where id = ?").run(JSON.stringify(draft), pageId);
  db.close();
}

/* ---- la page en vue brouillon ---------------------------------------------------------- */
const toile = await call(`/admin/api/editeur/toile?page=${pageId}&langue=fr`, { headers: { "sec-fetch-site": "same-origin" } });
const html = await (await call(toile.headers.get("location") ?? "/fr")).text();
const IMG_RE = /<img\b[^>]*>/g;
function blockOf(uid) {
  const i = html.indexOf(`data-edit-block="${uid}"`);
  if (i < 0) return null;
  const rest = html.slice(i + 1);
  const next = rest.search(/data-edit-block="/);
  return html.slice(i, next < 0 ? undefined : i + 1 + next);
}
const attr = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
function imgOf(uid) {
  const b = blockOf(uid);
  const tag = b?.match(/<img\b[^>]*block-image-media[^>]*>/)?.[0];
  if (!tag) return null;
  const picture = b.slice(0, b.indexOf(tag) + tag.length).split("<picture").pop();
  const srcsetWebp = /<source[^>]*type="image\/webp"[^>]*srcset="([^"]*)"/i.exec(picture)?.[1] ?? /<source[^>]*srcset="([^"]*)"[^>]*type="image\/webp"/i.exec(picture)?.[1] ?? "";
  const options = srcsetWebp.split(",").map((x) => x.trim().split(/\s+/)).filter((x) => x[0]).map(([u, w]) => ({ url: u.replaceAll("&amp;", "&"), w: Number(w.replace("w", "")) }));
  const fig = b.match(/<figure\b[^>]*>/)?.[0] ?? "";
  // Lot 64 : la boîte du média (MediaFrame) porte `data-fit` ; la figure garde le format imposé, le plafond et la taille.
  const frame = b.match(/<span\b[^>]*class="media-frame[^>]*>/)?.[0] ?? "";
  return { tag, fig, frame, w: Number(attr(tag, "width")), h: Number(attr(tag, "height")), cropped: / data-cropped/.test(tag), options, sizes: attr(tag, "sizes") };
}
ok("la page brouillon expose les blocs de l'éditeur", Boolean(blockOf("a-rouge")), `${html.length} octets`);

const anon = (p, init = {}) => fetch(BASE + p, { redirect: "manual", ...init });
const near = (a, b, tol = 0.015) => Math.abs(a / b - 1) < tol;
const cases = [
  ["a-rouge", "red", P1, 4800 * P1.w, 2400 * P1.h],
  ["a-bleu", "blue", P3, 4800 * P3.w, 2400 * P3.h],
  ["c-vert", "green", P2, 4800 * P2.w, 2400 * P2.h],
  ["c-jaune", "yellow", P4, 4800 * P4.w, 2400 * P4.h],
];
const rects = new Set();
for (const [uid, color, , pw, ph] of cases) {
  const m = imgOf(uid);
  ok(`L ${uid} : image recadrée trouvée`, Boolean(m?.cropped), m?.tag.slice(0, 120));
  if (!m) continue;
  ok(`L ${uid} : attributs width/height au rapport du recadrage (${(pw / ph).toFixed(2)})`, near(m.w / m.h, pw / ph), `${m.w}×${m.h}`);
  ok(`L ${uid} : cadre libre (data-free)`, / data-free/.test(m.fig), m.fig);
  const best = m.options.at(-1);
  ok(`L ${uid} : variantes extraites (/media/crop/…)`, m.options.length >= 2 && m.options.every((o) => /^\/media\/crop\/\d+\/x\d+y\d+w\d+h\d+-[0-9a-f]{20}\/\d+\.webp$/.test(o.url)), m.options.map((o) => o.w).join(","));
  rects.add(best.url.replace(/\/\d+\.webp$/, ""));
  ok(`L ${uid} : plus grande variante = pixels de l'original (netteté maximale, ${Math.round(pw)} px)`, Math.abs(best.w - Math.round(pw)) <= 1, String(best.w));
  const res = await anon(best.url);
  const body = Buffer.from(await res.arrayBuffer());
  const meta = await sharp(body).metadata();
  ok(`L ${uid} : variante servie (200), montre le personnage ${color} et lui seul`, res.status === 200 && (await perso(body)) === color, `${res.status} ${meta.width}×${meta.height}`);
  ok(`L ${uid} : dimensions de la variante au rapport exact`, near(meta.width / meta.height, pw / ph, 0.005), `${meta.width}×${meta.height}`);
}
ok("L même planche posée 4 fois : 4 rectangles distincts", rects.size === 4, String(rects.size));

// Portrait et panoramas : attributs qui pilotent le plafond de 85 % et l'image entière.
const por = imgOf("b-portrait");
ok("L portrait : image entière, plafond de hauteur (data-solo, --ir = 0,5)", !por.cropped && / data-solo/.test(por.fig) && /--ir:\s*0\.5000/.test(por.fig), por.fig);
const pano = imgOf("b-pano-plein");
ok("L panorama pleine largeur : entier, non recadré, rapport 4:1", !pano.cropped && pano.w / pano.h === 4 && !/data-ratio/.test(pano.fig), `${pano.w}×${pano.h} ${pano.fig}`);
const p169 = imgOf("b-pano-169");
ok("L pleine largeur + 16:9 : « Image entière » (data-fit=contain), non recadré", / data-fit="contain"/.test(p169.frame) && !p169.cropped, p169.frame);
const c169 = imgOf("b-pano-169-cover");
ok("L pleine largeur + 16:9 + « Remplir la case » : fenêtre extraite 16:9 de l'original", c169.cropped && near(c169.w / c169.h, 16 / 9, 0.01) && !/data-fit/.test(c169.frame), `${c169.w}×${c169.h} ${c169.frame}`);
for (const uid of ["d1", "d2"]) {
  const m = imgOf(uid);
  ok(`L décor ${uid} dans une case 4:5 : fenêtre extraite (nette) au rapport de la case`, m.cropped && near(m.w / m.h, 0.8, 0.02), `${m.w}×${m.h}`);
}
ok("L décor d3 (portrait déjà proche de 4:5) : image entière", !imgOf("d3").cropped);
ok("L plafond de hauteur : sur les images seules, pas dans les cases de grille", !!imgOf("b-portrait").fig.includes("data-solo") && ["d1", "d2", "d3", "c-vert"].every((u) => !imgOf(u).fig.includes("data-solo")));

/* ---- T : tuiles de collection (recadrage libre, schéma déjà accepté) --------------------- */
{
  // La couverture « personnages » devient la planche (le seed n'a que des SVG sans variantes), puis recadrage libre de la tuile.
  const db = new Database(DB);
  db.pragma("busy_timeout = 5000");
  const home = db.prepare("select id, title, slug, meta, nav_order, draft from pages where slug like '%\"fr\":\"\"%' order by id limit 1").get();
  const tiles = db.prepare("select props from blocks where page_id = ? and type = 'collection-tiles'").get(home.id);
  db.prepare("update slots set media_id = ? where id = (select id from slots where collection = 'characters' and featured = 1 order by id limit 1)").run(SHEET);
  const props = { ...JSON.parse(tiles.props), ratio: "16:9", look: { tileCrop: { characters: rectCrop(P2) } } };
  const draft = { title: JSON.parse(home.title), slug: JSON.parse(home.slug), meta: home.meta ? JSON.parse(home.meta) : { title: { fr: "", en: "" }, description: { fr: "", en: "" } }, published: true, inMenu: home.nav_order !== null, accent: null, blocks: [{ uid: "t-tuiles", type: "collection-tiles", props }] };
  db.prepare("update pages set draft = ?, draft_updated_at = unixepoch(), draft_rev = draft_rev + 1 where id = ?").run(JSON.stringify(draft), home.id);
  db.close();
  const t = await call(`/admin/api/editeur/toile?page=${home.id}&langue=fr`, { headers: { "sec-fetch-site": "same-origin" } });
  const h = await (await call(t.headers.get("location") ?? "/fr")).text();
  const i = h.indexOf('data-edit-tile="characters"');
  const frame = i < 0 ? "" : h.slice(h.lastIndexOf("<span", i), h.indexOf("</picture>", i));
  ok("T tuile « personnages » : cadre libre (data-free), repère d'édition avec l'image entière", / data-free/.test(frame) && /data-full-src="[^"]+"/.test(frame) && /data-full-px="4800x2400"/.test(frame), frame.slice(0, 200));
  ok("T tuile libre : pas de variables de point focal ni de data-crop", !/data-crop=|--crop-pos|--crop-zoom/.test(frame));
  const timg = /<img\b[^>]*>/.exec(frame)?.[0] ?? "";
  const tw = Number(attr(timg, "width"));
  const th = Number(attr(timg, "height"));
  ok("T tuile libre : image recadrée au rapport du rectangle (2112 × 1008), variantes /media/crop/", / data-cropped/.test(timg) && near(tw / th, 2112 / 1008, 0.01) && /\/media\/crop\//.test(timg), `${tw}×${th} ${timg.slice(0, 120)}`);
  const tsrc = /src="([^"]+)"/.exec(timg)?.[1];
  const tres = tsrc ? await anon(tsrc) : null;
  const tbody = tres ? Buffer.from(await tres.arrayBuffer()) : Buffer.alloc(0);
  ok("T tuile libre : la variante montre le personnage vert", tres?.status === 200 && (await perso(tbody)) === "green", String(tres?.status));
}

/* ---- R : route publique ---------------------------------------------------------------- */
const good = imgOf("a-rouge").options.at(-1).url;
const cacheDir = path.join(DATA, "cache", "crops");
const filesNow = () => (existsSync(cacheDir) ? readdirSync(cacheDir, { recursive: true }).length : 0);
const r0 = await anon(good);
const cc = r0.headers.get("cache-control") ?? "";
ok("R variante servie à un visiteur : 200, image, cache d'un an immuable, nosniff, CSP", r0.status === 200 && /^image\/(avif|webp)$/.test(r0.headers.get("content-type") ?? "") && /immutable/.test(cc) && /max-age=31536000/.test(cc) && r0.headers.get("x-content-type-options") === "nosniff" && /default-src 'none'/.test(r0.headers.get("content-security-policy") ?? ""), `${r0.status} ${cc}`);
await r0.arrayBuffer();
const head = await anon(good, { method: "HEAD" });
ok("R HEAD : 200 sans corps, Content-Length", head.status === 200 && Number(head.headers.get("content-length")) > 0);
const parts = /^(\/media\/crop\/)(\d+)\/(x\d+y\d+w\d+h\d+)-([0-9a-f]{20})\/(\d+)\.(avif|webp)$/.exec(good);
const [, base, id, rect, sig, width, fmt] = parts;
const flip = (s) => s.slice(0, -1) + (s.endsWith("0") ? "1" : "0");
const before = filesNow();
const bad = {
  "signature modifiée": `${base}${id}/${rect}-${flip(sig)}/${width}.${fmt}`,
  "signature d'un autre rectangle": `${base}${id}/x1y1w5000h5000-${sig}/${width}.${fmt}`,
  "rectangle jamais écrit, signature inventée": `${base}${id}/x0y0w10000h10000-${"0".repeat(20)}/960.${fmt}`,
  "autre média, même signature": `${base}${Number(id) + 1}/${rect}-${sig}/${width}.${fmt}`,
  "média inexistant": `${base}99999/${rect}-${sig}/${width}.${fmt}`,
  "largeur hors liste (signature valide)": `${base}${id}/${rect}-${sig}/1234.${fmt}`,
  "largeur énorme": `${base}${id}/${rect}-${sig}/9000.${fmt}`,
  "largeur 4 chiffres hors liste": `${base}${id}/${rect}-${sig}/4999.${fmt}`,
  "format inconnu": `${base}${id}/${rect}-${sig}/${width}.gif`,
  "remontée de dossier": `${base}${id}/${rect}-${sig}/..%2F..%2F${width}.${fmt}`,
  "remontée de dossier (..)": `${base}${id}/../${rect}-${sig}/${width}.${fmt}`,
  "remontée vers les originaux": `/media/crop/..%2Foriginals%2F${q1("select key from media where id = ?", SHEET).key.split("/")[1]}`,
  "rectangle trop petit": `${base}${id}/x0y0w50h50-${sig}/${width}.${fmt}`,
  "segments en trop": `${base}${id}/${rect}-${sig}/${width}.${fmt}/x`,
  "zéros en tête": `${base}0${id}/${rect}-${sig}/${width}.${fmt}`,
  "signature en majuscules": `${base}${id}/${rect}-${sig.toUpperCase()}/${width}.${fmt}`,
};
for (const [label, p] of Object.entries(bad)) {
  const res = await anon(p);
  ok(`R refusé : ${label}`, res.status === 404, `${res.status} ${p.slice(0, 90)}`);
  await res.arrayBuffer();
}
for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
  const res = await anon(good, { method, body: method === "DELETE" ? undefined : "x", headers: { origin: BASE } });
  ok(`R ${method} refusé (lecture seule)`, res.status === 405 || res.status === 404, String(res.status));
}
ok("R l'original reste introuvable", (await anon("/media/" + q1("select key from media where id = ?", SHEET).key)).status === 404);
ok("R aucune variante écrite par les demandes refusées", filesNow() === before, `${before} → ${filesNow()}`);
const r304 = await anon(good, { headers: { "if-none-match": r0.headers.get("etag") } });
ok("R If-None-Match → 304", r304.status === 304, String(r304.status));
// Une largeur de la liste mais pas servie par ce recadrage (supérieure aux pixels de l'original) : refusée.
const tooWide = await anon(`${base}${id}/${rect}-${sig}/3600.${fmt}`);
ok("R largeur de la liste mais au-delà des pixels du recadrage (agrandissement) : refusée", tooWide.status === 404, String(tooWide.status));
// Concurrence : rafale de demandes de la MÊME variante non encore générée → une seule génération, toutes 200.
const burst = imgOf("c-vert").options[0].url;
const rs = await Promise.all(Array.from({ length: 12 }, () => anon(burst)));
ok("R rafale de 12 demandes d'une même variante : toutes servies (fusion des demandes)", rs.every((r) => r.status === 200), rs.map((r) => r.status).join(","));
await Promise.all(rs.map((r) => r.arrayBuffer()));

console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
