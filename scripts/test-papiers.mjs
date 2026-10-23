#!/usr/bin/env node
/**
 * Papiers peints (lot 35), sans serveur ni navigateur (inclus dans npm test) :
 *  1. Schémas : `props.background` { kind: "wallpaper" } (strict, borné, couleur dessous facultative), papier d'une page, papier des cartes,
 *     `surface.paperWallpaper`.
 *  2. Rendu pur : variables d'un motif (variante couvrant la tuile, téléphone à 60 %, motif absent = rien), fusion des voisins, attributs.
 *  3. Raccord du motif entre composants fusionnés (`chainOffsets`), références à un motif (`wallpaperIdsOf`).
 *  4. Base réelle (dossier temporaire) : importer, doublon, refus d'un format sans transparence, fichier caché de la médiathèque, usages
 *     (composant, papier de page publié et en brouillon, cartes du site), corbeille → le motif quitte le rendu, restauration, purge
 *     (le fichier suit), papier d'une page enregistré par savePage sans effacer la couleur des boutons.
 * Usage : node --import tsx scripts/test-papiers.mjs
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { BackgroundSchema, PagePaperSchema, CardWallpaperSchema, SurfaceSchema } from "../src/themes/schema.ts";
import { fondAttributes, fondColor, fondJoins, fondKey, fondStyle, readBackground } from "../src/themes/fond.ts";
import { paperAttributes } from "../src/themes/surface.ts";
import { resolvePalette } from "../src/themes/palette.ts";
import { chainOffsets, defaultWallpaperSize, effectivePaint, pickFile, readCardWallpaper, readPagePaper, wallpaperIdsOf, wallpaperVars } from "../src/themes/wallpaper.ts";
import { BLOCKS } from "../src/blocks/registry.ts";
import { loadPreset } from "./lib/presets.mjs";

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const bg = (p) => BackgroundSchema.safeParse(p).success;

/* ---- 1. Schémas --------------------------------------------------------------------------------------- */
ok("fond papier peint : un motif seul, avec couleur dessous, taille, opacité", bg({ kind: "wallpaper", wallpaper: 3 }) && bg({ kind: "wallpaper", wallpaper: 3, color: "bgDeep" }) && bg({ kind: "wallpaper", wallpaper: 3, color: "#aabbcc", size: 300, opacity: 0.5 }));
ok(
  "fond papier peint : identifiant absent / nul / fractionnaire, taille et opacité hors bornes, clé inconnue, couleur invalide refusés",
  !bg({ kind: "wallpaper" }) &&
    !bg({ kind: "wallpaper", wallpaper: 0 }) &&
    !bg({ kind: "wallpaper", wallpaper: 1.5 }) &&
    !bg({ kind: "wallpaper", wallpaper: "3" }) &&
    !bg({ kind: "wallpaper", wallpaper: 3, size: 23 }) &&
    !bg({ kind: "wallpaper", wallpaper: 3, size: 1201 }) &&
    !bg({ kind: "wallpaper", wallpaper: 3, opacity: -0.04 }) &&
    !bg({ kind: "wallpaper", wallpaper: 3, opacity: 1.01 }) &&
    !bg({ kind: "wallpaper", wallpaper: 3, url: "/x.png" }) &&
    !bg({ kind: "wallpaper", wallpaper: 3, color: "rouge" }),
);
ok("fond de couleur d'avant : inchangé", bg({ kind: "color", color: "primary" }) && !bg({ kind: "color" }) && !bg({ kind: "paper" }));
ok("readBackground : un papier peint illisible = aucun fond (jamais une erreur)", readBackground({ kind: "wallpaper", wallpaper: -1 }) === undefined && readBackground({ kind: "wallpaper", wallpaper: 2 })?.kind === "wallpaper");
ok(
  "registre : le papier peint fait partie du schéma de chaque bloc ; invalide = ignoré sans masquer le bloc",
  (() => {
    const base = { paragraphs: [{ fr: "a", en: "a" }] };
    const good = BLOCKS["rich-text"].schema.safeParse({ ...base, background: { kind: "wallpaper", wallpaper: 4, size: 200 } });
    const bad = BLOCKS["rich-text"].schema.safeParse({ ...base, background: { kind: "wallpaper", wallpaper: "x" } });
    return good.success && good.data.background?.kind === "wallpaper" && bad.success && bad.data.background === undefined;
  })(),
);
ok("papier d'une page : aucun, ou un motif (taille, opacité bornées)", PagePaperSchema.safeParse({ mode: "none" }).success && PagePaperSchema.safeParse({ mode: "wallpaper", wallpaper: 2, size: 120, opacity: 0.3 }).success && !PagePaperSchema.safeParse({ mode: "wallpaper" }).success && !PagePaperSchema.safeParse({ mode: "site" }).success && !PagePaperSchema.safeParse({ mode: "none", wallpaper: 2 }).success);
ok("papier d'une page : lecture tolérante", readPagePaper(null) === undefined && readPagePaper({ mode: "wallpaper", wallpaper: "x" }) === undefined && readPagePaper({ mode: "none" })?.mode === "none");
ok("papier des cartes du site : un motif, borné", CardWallpaperSchema.safeParse({ wallpaper: 5, size: 90, opacity: 0.2 }).success && !CardWallpaperSchema.safeParse({}).success && readCardWallpaper({ wallpaper: 0 }) === undefined && readCardWallpaper({ wallpaper: 5 })?.wallpaper === 5);
ok("carte : paperWallpaper + paperSize, bornés ; paperOpacity garde son plafond de 0,6", SurfaceSchema.safeParse({ paperWallpaper: 3, paperSize: 200, paperOpacity: 0.5 }).success && !SurfaceSchema.safeParse({ paperWallpaper: 0 }).success && !SurfaceSchema.safeParse({ paperWallpaper: 3, paperSize: 5 }).success && !SurfaceSchema.safeParse({ paperWallpaper: 3, paperOpacity: 0.7 }).success);

/* ---- 2. Rendu pur -------------------------------------------------------------------------------------- */
const entry = { id: 3, name: "Fleurs", w: 1200, h: 600, size: 300, opacity: 0.8, files: [{ w: 480, url: "/media/img/aaaaaaaaaaaaaaaa/480.webp" }, { w: 960, url: "/media/img/aaaaaaaaaaaaaaaa/960.webp" }, { w: 1200, url: "/media/img/aaaaaaaaaaaaaaaa/1200.webp" }] };
ok("variante : la plus petite qui couvre la tuile en double densité, sinon la plus large", pickFile(entry, 200) === entry.files[0].url && pickFile(entry, 300) === entry.files[1].url && pickFile(entry, 1000) === entry.files[2].url);
ok(
  "variables : image, taille, téléphone à 60 %, rapport, opacité du motif par défaut",
  (() => {
    const v = wallpaperVars(entry);
    return v["--wp-img"] === 'url("/media/img/aaaaaaaaaaaaaaaa/960.webp")' && v["--wp-size"] === "300px" && v["--wp-size-m"] === "180px" && v["--wp-ratio"] === "0.5" && v["--wp-opacity"] === "0.8";
  })(),
);
ok(
  "variables : les réglages posés remplacent ceux du motif ; carte = préfixe --card-wp ; tuile jamais sous 24 px sur téléphone",
  (() => {
    const v = wallpaperVars(entry, { size: 40, opacity: 0.25 }, "--card-wp");
    return v["--card-wp-size"] === "40px" && v["--card-wp-size-m"] === "24px" && v["--card-wp-opacity"] === "0.25" && v["--card-wp-img"].includes("480.webp") && !("--wp-img" in v);
  })(),
);
ok("motif absent de la bibliothèque (supprimé, à la corbeille) : aucune variable, l'endroit perd son motif", Object.keys(wallpaperVars(undefined, { size: 100 })).length === 0 && Object.keys(wallpaperVars({ ...entry, files: [] })).length === 0);
ok("effectivePaint : taille bornée", effectivePaint(entry, { size: 5000 }).size === 1200 && effectivePaint(entry, { size: 3 }).size === 24 && effectivePaint(entry).opacity === 0.8);
ok("taille de départ d'un motif importé : moitié de sa largeur, entre 80 et 600 px", defaultWallpaperSize(1200) === 600 && defaultWallpaperSize(4000) === 600 && defaultWallpaperSize(100) === 80 && defaultWallpaperSize(null) === 300);

const palette = resolvePalette((await loadPreset("pro")).tokens.color, (await loadPreset("pro")).tokens.palette);
const lookup = (id) => (id === 3 ? entry : undefined);
const wpOnly = { kind: "wallpaper", wallpaper: 3 };
const wpColor = { kind: "wallpaper", wallpaper: 3, color: "ink" };
ok(
  "texte lisible : sans couleur dessous, l'encre du thème ; avec couleur, même logique que le fond de couleur",
  (() => {
    const a = fondStyle(wpOnly, palette, lookup);
    const b = fondStyle(wpColor, palette, lookup);
    const c = fondStyle({ kind: "color", color: "ink" }, palette);
    return a.style.ink === palette.ink && a.vars["--wp-img"] !== undefined && b.style.ink === c.style.ink && b.style.ok === c.style.ok && b.vars["--card-bg"] === c.vars["--card-bg"] && b.vars["--wp-size"] === "300px";
  })(),
);
ok("fondStyle sans bibliothèque : pas de variables --wp (motif disparu), couleurs lisibles intactes", (() => {
  const v = fondStyle(wpColor, palette).vars;
  return !("--wp-img" in v) && Boolean(v["--card-ink"]);
})());
ok("fondColor : la couleur dessous, ou rien", fondColor(wpOnly) === undefined && fondColor(wpColor) === "ink");
ok(
  "attributs : papier peint = data-wallpaper ; sans couleur dessous = data-fond-clear ; fond de couleur d'avant inchangé",
  JSON.stringify(fondAttributes({ prev: false, next: false })) === '{"data-fond":"on"}' &&
    JSON.stringify(fondAttributes({ prev: false, next: false }, { kind: "color", color: "ink" })) === '{"data-fond":"on"}' &&
    JSON.stringify(fondAttributes({ prev: true, next: false }, wpOnly)) === '{"data-fond":"on","data-join-prev":"","data-wallpaper":"","data-fond-clear":""}' &&
    JSON.stringify(fondAttributes({ prev: false, next: true }, wpColor)) === '{"data-fond":"on","data-join-next":"","data-wallpaper":""}',
);

/* ---- fusion des voisins ---- */
const k = (b, card = false) => fondKey(b, card);
ok("fusion : même motif ET mêmes réglages = fusion", k(wpOnly) === k({ kind: "wallpaper", wallpaper: 3 }) && fondJoins([k(wpOnly), k(wpOnly), k(wpOnly)]).map((j) => `${j.prev ? 1 : 0}${j.next ? 1 : 0}`).join() === "01,11,10");
ok(
  "fusion : un autre motif, une autre taille, une autre opacité ou une autre couleur dessous = pas de fusion",
  k(wpOnly) !== k({ kind: "wallpaper", wallpaper: 4 }) && k(wpOnly) !== k({ kind: "wallpaper", wallpaper: 3, size: 200 }) && k(wpOnly) !== k({ kind: "wallpaper", wallpaper: 3, opacity: 0.5 }) && k(wpOnly) !== k(wpColor) && k(wpColor) !== k({ kind: "wallpaper", wallpaper: 3, color: "primary" }),
);
ok("fusion : un papier peint ne fusionne jamais avec une couleur, ni une carte avec la page", k(wpColor) !== k({ kind: "color", color: "ink" }) && k(wpOnly, true) !== k(wpOnly, false) && fondJoins([k(wpOnly), k({ kind: "color", color: "ink" }), k(undefined)]).every((j) => !j.prev && !j.next));

/* ---- papier d'une carte ---- */
ok(
  "papier de carte : motif → data-paper-wp, « dessus », variables --card-wp-* ; « sous » respecté ; rien tant que la carte ne le demande pas",
  (() => {
    const a = paperAttributes({ paperWallpaper: 3, paperSize: 200 }, lookup);
    const b = paperAttributes({ paperWallpaper: 3, paper: "under" }, lookup);
    const c = paperAttributes({ color: "bg" }, lookup);
    return a.attrs["data-paper-wp"] === "" && a.attrs["data-paper"] === "over" && a.vars["--card-wp-size"] === "200px" && b.attrs["data-paper"] === "under" && Object.keys(c.attrs).length === 0 && Object.keys(c.vars).length === 0;
  })(),
);
ok("papier de carte : motif supprimé = aucune variable ni attribut (la carte reste opaque)", (() => {
  const a = paperAttributes({ paperWallpaper: 99 }, lookup);
  return Object.keys(a.attrs).length === 0 && Object.keys(a.vars).length === 0;
})());

/* ---- 3. Raccord et références ------------------------------------------------------------------------- */
ok(
  "raccord : la trame se poursuit (hauteurs cumulées modulo la tuile) ; une chaîne repart de zéro",
  (() => {
    const it = (h, prev, next) => ({ joinPrev: prev, joinNext: next, height: h, tile: 100 });
    const offs = chainOffsets([it(250, false, true), it(130, true, true), it(80, true, false), it(300, false, false)]);
    return offs[0] === 0 && offs[1] === -50 && offs[2] === -80 && offs[3] === 0;
  })(),
);
ok("raccord : un voisin non fusionné n'hérite de rien ; tuile inconnue = aucun décalage", chainOffsets([{ joinPrev: false, joinNext: true, height: 70, tile: 0 }, { joinPrev: true, joinNext: false, height: 70, tile: 0 }]).every((y) => y === 0) && chainOffsets([{ joinPrev: false, joinNext: false, height: 10, tile: 50 }, { joinPrev: true, joinNext: false, height: 10, tile: 50 }])[1] === 0);
ok(
  "références : fond, papier de carte, composants d'un conteneur (deux niveaux)",
  (() => {
    const node = { type: "grid", props: { background: { kind: "wallpaper", wallpaper: 7 }, surface: { paperWallpaper: 8 }, children: [{ type: "image", props: { background: { kind: "wallpaper", wallpaper: 9 }, children: [{ type: "x", props: { background: { kind: "wallpaper", wallpaper: 10 }, children: [{ type: "y", props: { background: { kind: "wallpaper", wallpaper: 11 } } }] } }] } }] } };
    const ids = wallpaperIdsOf(node);
    return ids.includes(7) && ids.includes(8) && ids.includes(9) && ids.includes(10) && !ids.includes(11) && wallpaperIdsOf({ type: "x", props: { background: { kind: "color", color: "ink" } } }).length === 0 && wallpaperIdsOf({ type: "x", props: null }).length === 0;
  })(),
);

/* ---- 4. Base réelle ------------------------------------------------------------------------------------ */
const dir = mkdtempSync(path.join(tmpdir(), "pf-test-papiers-"));
process.env.DATA_DIR = dir;
const log = console.log;
console.log = () => {};
const { bootstrap } = await import("../src/lib/db/bootstrap.ts");
await bootstrap();
const { getDb, schema } = await import("../src/lib/db/index.ts");
const { eq } = await import("drizzle-orm");
const W = await import("../src/lib/edit/wallpapers.ts");
const { savePage, createPage } = await import("../src/lib/edit/pages.ts");
const { purgeTrash, purgeOne, purgeMedia } = await import("../src/lib/edit/trash.ts");
const { listMediaForAdmin, getWallpaperUses, getPageForEdit, getAdminCounts, getEditorContext } = await import("../src/lib/admin.ts");
const { wallpaperUsages, findWallpaperUsages } = await import("../src/lib/references.ts");
const { listWallpapersForAdmin, entryOf } = await import("../src/lib/wallpapers.ts");
const { readDraft, saveDraft } = await import("../src/lib/edit/drafts.ts");
console.log = log;

const db = getDb();
const L = (s) => ({ fr: s, en: s });
const DAY = 86_400_000;
const addMedia = (name, { mime = "image/png", status = "ready", dominantColor = null, kind = "image" } = {}) =>
  db
    .insert(schema.media)
    .values({ key: `originals/${name}.png`, sha256: name.padEnd(64, "0"), kind, mime, originalName: `${name}.png`, size: 1, width: 800, height: 400, dominantColor, variants: { v: 1, files: [{ key: `img/${name.padEnd(16, "0").slice(0, 16)}/480.webp`, format: "webp", w: 480, h: 240, size: 1 }, { key: `img/${name.padEnd(16, "0").slice(0, 16)}/800.webp`, format: "webp", w: 800, h: 400, size: 1 }] }, status, alt: L("") })
    .returning({ id: schema.media.id })
    .get().id;

const m1 = addMedia("aa11aa11aa11aa11");
const mJpeg = addMedia("bb22bb22bb22bb22", { mime: "image/jpeg" });
const mVideo = addMedia("cc33cc33cc33cc33", { kind: "video", mime: "video/mp4" });
const mOpaque = addMedia("dd44dd44dd44dd44", { dominantColor: "#aabbcc" });
const mFailed = addMedia("ee55ee55ee55ee55", { status: "failed" });

const mediaCountBefore = getAdminCounts().media;
const created = W.createWallpaper(m1);
ok("import : un PNG devient un papier peint (nom d'après le fichier, taille de départ, opacité pleine)", created.ok && created.data.reused === false && created.data.name === "aa11aa11aa11aa11" && listWallpapersForAdmin()[0].size === 400 && listWallpapersForAdmin()[0].opacity === 1, JSON.stringify(created));
const wp = created.data.id;
ok("import : le même fichier une seconde fois = le motif existant (aucun doublon)", (() => {
  const again = W.createWallpaper(m1);
  return again.ok && again.data.reused && again.data.id === wp && listWallpapersForAdmin().length === 1;
})());
ok("import : JPEG, vidéo, fichier absent ou traitement échoué refusés avec un message clair", !W.createWallpaper(mJpeg).ok && /PNG ou WebP/.test(W.createWallpaper(mJpeg).message) && !W.createWallpaper(mVideo).ok && !W.createWallpaper(999999).ok && !W.createWallpaper(mFailed).ok && !W.createWallpaper("x").ok && !W.createWallpaper(-1).ok);
ok("import : un fichier sans transparence est accepté, signalé (opaque)", (() => {
  const r = W.createWallpaper(mOpaque);
  return r.ok && listWallpapersForAdmin().find((w) => w.id === r.data.id).opaque === true && listWallpapersForAdmin().find((w) => w.id === wp).opaque === false;
})());
const wp2 = listWallpapersForAdmin().find((w) => w.mediaId === mOpaque).id;
ok("médiathèque : le fichier d'un papier peint n'y apparaît pas (ni dans les compteurs ni dans les choix de l'éditeur) ; les autres restent", !listMediaForAdmin().some((m) => m.id === m1 || m.id === mOpaque) && listMediaForAdmin().some((m) => m.id === mJpeg) && getAdminCounts().media === mediaCountBefore - 2 && !getEditorContext().media.some((m) => m.id === m1) && getEditorContext().wallpapers.some((w) => w.id === wp));
ok("rendu : le motif prêt a une entrée avec ses variantes WebP ; un fichier en traitement n'en a pas", (() => {
  const row = db.select().from(schema.wallpapers).where(eq(schema.wallpapers.id, wp)).get();
  const media = db.select().from(schema.media).where(eq(schema.media.id, m1)).get();
  const e = entryOf(row, media);
  const pending = entryOf(row, { ...media, variants: null });
  return e && e.files.length === 2 && e.files[0].url.endsWith("/480.webp") && e.w === 800 && pending === null;
})());

ok("renommer / régler : nom borné, taille et opacité bornées", W.renameWallpaper(wp, "  Fleurs  ").ok && listWallpapersForAdmin().find((w) => w.id === wp).name === "Fleurs" && !W.renameWallpaper(wp, "").ok && !W.renameWallpaper(wp, "x".repeat(61)).ok && !W.renameWallpaper(999, "a").ok && W.saveWallpaperPaint(wp, { size: 250, opacity: 0.4 }).ok && !W.saveWallpaperPaint(wp, { size: 10, opacity: 0.4 }).ok && !W.saveWallpaperPaint(wp, { size: 250, opacity: 2 }).ok && !W.saveWallpaperPaint(wp, { size: 250, opacity: 0.4, x: 1 }).ok && listWallpapersForAdmin().find((w) => w.id === wp).size === 250);

/* ---- usages ---- */
const pageB = createPage({ title: L("Papier B"), slug: L("papier-b") }).data.id;
const block = (props) => ({ type: "rich-text", props: { paragraphs: [{ fr: "a", en: "a" }], ...props } });
const pagePayload = (blocks, extra = {}) => ({ title: L("Papier B"), slug: L("papier-b"), meta: { title: L(""), description: L("") }, published: true, inMenu: false, accent: null, blocks, ...extra });
const saved = savePage(pageB, pagePayload([block({ background: { kind: "wallpaper", wallpaper: wp, size: 120 } }), block({ surface: { paperWallpaper: wp } })], { wallpaper: { mode: "wallpaper", wallpaper: wp2 } }));
ok("page : un composant à papier peint, un papier de carte et le papier de la page s'enregistrent", saved.ok, JSON.stringify(saved));
ok("page : le papier de la page est relu tel quel (formulaire et éditeur)", JSON.stringify(getPageForEdit(pageB).wallpaper) === JSON.stringify({ mode: "wallpaper", wallpaper: wp2 }));
ok("page : sans le champ (ancien appelant), le papier de la page est conservé ; null = comme le site", (() => {
  const keep = savePage(pageB, pagePayload([block({})]));
  const kept = JSON.stringify(getPageForEdit(pageB).wallpaper) === JSON.stringify({ mode: "wallpaper", wallpaper: wp2 });
  const clear = savePage(pageB, pagePayload([block({})], { wallpaper: null }));
  return keep.ok && kept && clear.ok && getPageForEdit(pageB).wallpaper === null;
})());
ok("page : la couleur des boutons et le papier peint cohabitent dans le même réglage", (() => {
  const r = savePage(pageB, pagePayload([block({})], { accent: "#2e4e9e", wallpaper: { mode: "none" } }));
  const row = db.select().from(schema.pages).where(eq(schema.pages.id, pageB)).get();
  const back = savePage(pageB, pagePayload([block({})], { accent: null, wallpaper: null }));
  return r.ok && JSON.stringify(row.themeOverrides) === JSON.stringify({ primary: "#2e4e9e", wallpaper: { mode: "none" } }) && back.ok && db.select().from(schema.pages).where(eq(schema.pages.id, pageB)).get().themeOverrides === null;
})());
ok("page : un papier de page invalide est refusé", !savePage(pageB, pagePayload([block({})], { wallpaper: { mode: "wallpaper", wallpaper: 0 } })).ok && !savePage(pageB, pagePayload([block({})], { wallpaper: { mode: "autre" } })).ok);

// État de référence pour les usages : fond + carte (publiés), papier de page (brouillon), cartes du site.
savePage(pageB, pagePayload([block({ background: { kind: "wallpaper", wallpaper: wp } }), block({ surface: { paperWallpaper: wp } })]));
const state = readDraft(pageB);
const drafted = saveDraft(pageB, { ...state.draft, wallpaper: { mode: "wallpaper", wallpaper: wp } }, state.rev);
ok("brouillon : le papier de la page est enregistré dans le brouillon (et relu)", drafted.ok && JSON.stringify(readDraft(pageB).draft.wallpaper) === JSON.stringify({ mode: "wallpaper", wallpaper: wp }), JSON.stringify(drafted));
ok("brouillon d'avant sans papier : celui de la page publiée", (() => {
  const s = readDraft(pageB);
  const raw = db.select().from(schema.pages).where(eq(schema.pages.id, pageB)).get().draft;
  const old = { ...raw };
  delete old.wallpaper;
  db.update(schema.pages).set({ draft: old }).where(eq(schema.pages.id, pageB)).run();
  const r = readDraft(pageB);
  db.update(schema.pages).set({ draft: raw }).where(eq(schema.pages.id, pageB)).run();
  return s.draft.wallpaper?.mode === "wallpaper" && r.draft.wallpaper === null;
})());
ok("cartes du site : un motif de la bibliothèque, null pour retirer, un motif inconnu refusé", W.saveCardWallpaper({ wallpaper: wp, size: 90, opacity: 0.2 }).ok && !W.saveCardWallpaper({ wallpaper: 99999 }).ok && !W.saveCardWallpaper({ wallpaper: wp, size: 3 }).ok && !W.saveCardWallpaper({}).ok);
const uses = findWallpaperUsages(wp);
ok(
  "usages : composant, papier de carte, papier de page (brouillon) et cartes du site, une fois chacun",
  uses.filter((u) => u.kind === "block" && u.pageId === pageB).length === 1 /* un par page et par type */ && uses.some((u) => u.kind === "page" && u.pageId === pageB) && uses.some((u) => u.kind === "cards") && getWallpaperUses(wp).some((u) => u.kind === "cards") && getWallpaperUses(wp).some((u) => u.kind === "block" && u.blockType && u.pageTitle === "Papier B"),
  JSON.stringify(uses),
);
ok("usages : un motif jamais posé n'en a aucun", wallpaperUsages().get(wp2) === undefined || wallpaperUsages().get(wp2).length === 0);

/* ---- corbeille ---- */
ok("corbeille : un motif UTILISÉ se met à la corbeille (permis, contrairement à un média) et quitte la bibliothèque", (() => {
  const r = W.trashWallpaper(wp);
  return r.ok && r.data.name === "Fleurs" && !listWallpapersForAdmin().some((w) => w.id === wp) && listWallpapersForAdmin(true).some((w) => w.id === wp) && !W.trashWallpaper(wp).ok;
})());
ok("corbeille : il disparaît du rendu (plus d'entrée) sans toucher aux endroits qui le citent", findWallpaperUsages(wp).length >= 3 && !listWallpapersForAdmin().some((w) => w.id === wp));
ok("corbeille : les cartes du site refusent un motif à la corbeille ; restauré, il revient", (() => {
  const refused = !W.saveCardWallpaper({ wallpaper: wp }).ok;
  const r = W.restoreWallpaper(wp);
  return refused && r.ok && listWallpapersForAdmin().some((w) => w.id === wp) && !W.restoreWallpaper(wp).ok;
})());
const old = new Date(Date.now() - 31 * DAY);
W.trashWallpaper(wp2);
await (async () => {
  db.update(schema.wallpapers).set({ deletedAt: old }).where(eq(schema.wallpapers.id, wp2)).run();
  // Le fichier est à la corbeille des médias, mais la ligne du motif le retient : jamais purgé sous ses pieds.
  db.update(schema.media).set({ deletedAt: old }).where(eq(schema.media.id, mOpaque)).run();
  const keptByRow = await purgeMedia(mOpaque);
  console.log = () => {};
  const report = await purgeTrash();
  console.log = log;
  ok("purge : après 30 jours le motif part, son fichier passe à la corbeille des médias avec la même date et part dans le même tour", keptByRow === false && report.wallpapers === 1 && !db.select().from(schema.wallpapers).where(eq(schema.wallpapers.id, wp2)).get() && !db.select().from(schema.media).where(eq(schema.media.id, mOpaque)).get(), JSON.stringify(report));
})();
ok("purge : un motif encore à la corbeille depuis moins de 30 jours reste ; la médiathèque ne retrouve pas son fichier tant qu'il y est", (() => {
  const w3 = W.createWallpaper(addMedia("ff66ff66ff66ff66")).data.id;
  W.trashWallpaper(w3);
  return !listMediaForAdmin().some((m) => m.originalName === "ff66ff66ff66ff66.png") && db.select().from(schema.wallpapers).where(eq(schema.wallpapers.id, w3)).get() !== undefined;
})());
await (async () => {
  const w4m = addMedia("1177117711771177");
  const w4 = W.createWallpaper(w4m).data.id;
  W.trashWallpaper(w4);
  const r = await purgeOne("wallpaper", w4);
  ok("purge immédiate d'un motif de la corbeille", r.ok && !db.select().from(schema.wallpapers).where(eq(schema.wallpapers.id, w4)).get());
  ok("purge immédiate : refusée si le motif n'est pas à la corbeille", !(await purgeOne("wallpaper", wp)).ok);
})();

process.exit(failures ? 1 : 0);
