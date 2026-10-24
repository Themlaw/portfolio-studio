#!/usr/bin/env node
/**
 * Lot 75 (unification R4 + R5, A5) — tests unitaires (inclus dans npm test), volet « unif75 » :
 *  T1  Une seule écriture `media-look` : le réducteur est le même pour une rubrique, une case, un composant de planche, une place de
 *      carrousel et une image de la Planche libre ; `null` retire, une action = un patch ; l'intention remplace bitem-frame, bitem-imgbg et
 *      free-op « style » ; `slotLook` remplace les cinq cartes par place (lecture tolérante de l'ancien format) ; aucune donnée perdue.
 *  T2  Feuilles de style : un seul sélecteur de cadre et de fond (lint), une seule base `.zone` pour le calque de papier, aucun tableau de
 *      formats ni de rayons recopié (R5 : `--box-r` posé par le composant, `--t-radius-*` émis par css.ts).
 *  M   Migration 0030 : on rejoue une base v0.30 réaliste (publié, brouillons, planches, brouillons de planche) ; chaque réglage relu après la
 *      migration est celui d'avant, valeur par valeur ; idempotente ; draft_rev augmenté.
 * Usage : node --import tsx scripts/test-media-look75.mjs
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { applyFreeLook, freeItems } from "../src/blocks/free-board.ts";
import { seedSlotLooks, migrateSlotLooks } from "../src/lib/db/slot-look.ts";
import { applyMediaPatch, applyMediaPatchToFree, MediaPatchSchema, slotOf } from "../src/lib/edit/media-look.ts";
import { EDIT_MSG, acceptFromCanvas } from "../src/lib/edit/protocol.ts";
import { FrameSchema, LookSchema, cleanLook, mediaLookAttrs, readLook, upgradeFrame, upgradeLook } from "../src/lib/look.ts";
import { RATIO_VALUES, ratioCss } from "../src/lib/images/formats.ts";
import { RADIUS_VALUES, layoutVariables } from "../src/themes/css.ts";

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`PASS  ${name}`);
};
const ROOT = new URL("../", import.meta.url).pathname;
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const walk = (dir, out = []) => {
  for (const f of readdirSync(path.join(ROOT, dir))) {
    const rel = path.join(dir, f);
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
};
const clone = (v) => JSON.parse(JSON.stringify(v));
const BAND = { kind: "band", width: "epais", color: "primary" };

/* ---- T1. Le réducteur ---------------------------------------------------------------------------------------------- */

test("T1 patch : seuls les champs présents changent, null retire, un patch vide est refusé", () => {
  assert.ok(MediaPatchSchema.safeParse({ frame: BAND }).success);
  assert.ok(MediaPatchSchema.safeParse({ bg: null, radius: "soft", pano: "scroll", video: "loop" }).success);
  assert.ok(!MediaPatchSchema.safeParse({}).success, "rien à changer");
  assert.ok(!MediaPatchSchema.safeParse({ bg: "red" }).success);
  assert.ok(!MediaPatchSchema.safeParse({ radius: "huge" }).success);
  assert.ok(!MediaPatchSchema.safeParse({ frame: BAND, extra: 1 }).success, "clé inconnue refusée");
  assert.ok(MediaPatchSchema.safeParse({ frame: { size: "thick" } }).success, "ancienne forme de cadre acceptée");
});

test("T1 rubrique, case, composant de planche : cadre, fond d'image, arrondi sur `look`, null les retire", () => {
  const a = applyMediaPatch({ spaceTop: "m" }, { frame: BAND, bg: "card", radius: "soft" });
  assert.deepEqual(a.look, { spaceTop: "m", frame: BAND, imageBg: "card", radius: "soft" });
  const b = applyMediaPatch(a.look, { frame: null });
  assert.deepEqual(b.look, { spaceTop: "m", imageBg: "card", radius: "soft" });
  const c = applyMediaPatch(b.look, { bg: null, radius: null });
  assert.deepEqual(c.look, { spaceTop: "m" });
  assert.equal(applyMediaPatch({ frame: BAND }, { frame: null }).look, undefined, "plus aucun réglage : pas de look du tout");
  assert.equal(applyMediaPatch(undefined, { bg: null }).look, undefined);
  assert.ok("error" in applyMediaPatch({}, { pano: "scroll" }), "le panorama ne se règle que sur une place de carrousel");
  assert.ok("error" in applyMediaPatch({}, { video: "loop" }), "la lecture non plus");
  const src = { frame: BAND };
  const copy = clone(src);
  applyMediaPatch(src, { bg: "card" });
  assert.deepEqual(src, copy, "l'entrée n'est jamais modifiée");
});

test("T1 place de carrousel : tout dans slotLook[slug], les autres places et réglages restent, une entrée vide disparaît", () => {
  const look0 = { spaceTop: "l", slotLook: { "r1-aa": { frame: BAND }, "r1-bb": { pano: "scroll" } } };
  const a = applyMediaPatch(look0, { radius: "strong", video: "player", bg: "#ffffff" }, "r1-aa");
  assert.deepEqual(a.look.slotLook["r1-aa"], { frame: BAND, radius: "strong", video: "player", bg: "#ffffff" });
  assert.deepEqual(a.look.slotLook["r1-bb"], { pano: "scroll" });
  assert.equal(a.look.spaceTop, "l");
  const b = applyMediaPatch(a.look, { frame: null, radius: null, video: null, bg: null }, "r1-aa");
  assert.deepEqual(b.look, { spaceTop: "l", slotLook: { "r1-bb": { pano: "scroll" } } }, "place sans réglage : retirée");
  const c = applyMediaPatch(b.look, { pano: null }, "r1-bb");
  assert.deepEqual(c.look, { spaceTop: "l" }, "plus aucune place : plus de slotLook");
  assert.equal(slotOf(a.look, "r1-aa").radius, "strong");
  assert.deepEqual(slotOf(a.look, "inconnue"), {});
  assert.equal(slotOf(undefined, "x").frame, undefined);
  // La carte écrite est valide pour le schéma (et ne contient plus d'ancienne clé).
  assert.ok(LookSchema.safeParse(a.look).success);
  assert.equal(Object.keys(a.look).some((k) => /^slot(Frame|Bg|Radius|Pano|Video)$/.test(k)), false);
});

test("T1 image de la Planche libre : cadre, fond, arrondi sur sa ligne ; même résultat que le réducteur commun", () => {
  const props = { format: "3:2", phone: "scale", items: [{ id: "a", media: 1, x: 10, y: 10, w: 30, rot: 0, z: 0 }, { id: "b", media: 2, x: 50, y: 10, w: 30, rot: 0, z: 1 }] };
  const r = applyFreeLook(props, "a", { frame: BAND, bg: "card", radius: "medium" });
  const [a, b] = freeItems(r.props);
  assert.deepEqual([a.frame, a.bg, a.radius], [BAND, "card", "medium"]);
  assert.deepEqual([b.frame, b.bg, b.radius], [undefined, undefined, undefined], "l'autre image n'a pas bougé");
  const t = applyFreeLook(r.props, "a", { frame: null, bg: null, radius: null });
  const [a2] = freeItems(t.props);
  assert.ok(!("frame" in a2) && !("bg" in a2) && !("radius" in a2));
  assert.match(applyFreeLook(props, "zz", { bg: "card" }).error, /n'est plus/);
  assert.ok("error" in applyFreeLook(props, "a", { pano: "scroll" }));
  const one = applyMediaPatchToFree(props.items[0], { radius: "soft" });
  assert.equal(one.item.radius, "soft");
});

test("T1 rendu : `mediaLookAttrs` donne le même habillage pour un même réglage, quel que soit le conteneur qui l'a lu", () => {
  const data = { frame: BAND, bg: "card", radius: "soft" };
  const fromBlock = applyMediaPatch(undefined, { frame: BAND, bg: "card", radius: "soft" }).look;
  const fromSlot = slotOf(applyMediaPatch(undefined, { frame: BAND, bg: "card", radius: "soft" }, "p-aa").look, "p-aa");
  const fromFree = applyMediaPatchToFree({}, { frame: BAND, bg: "card", radius: "soft" }).item;
  const expect = mediaLookAttrs(data);
  assert.deepEqual(mediaLookAttrs({ frame: fromBlock.frame, bg: fromBlock.imageBg, radius: fromBlock.radius }), expect);
  assert.deepEqual(mediaLookAttrs(fromSlot), expect);
  assert.deepEqual(mediaLookAttrs(fromFree), expect);
});

test("T1 ancien format relu : les cinq cartes par place deviennent slotLook, sans rien changer à l'affichage", () => {
  const old = {
    spaceTop: "m",
    slotFrame: { "a-1": { size: "thick", color: "primary" }, "a-2": { kind: "theme" } },
    slotBg: { "a-1": "card", "a-3": "#112233" },
    slotRadius: { "a-2": "strong" },
    slotPano: { "a-3": "scroll" },
    slotVideo: { "a-4": "player", "a-1": "loop" },
  };
  const want = {
    spaceTop: "m",
    slotLook: {
      "a-1": { frame: { kind: "band", width: "epais", color: "primary" }, bg: "card", video: "loop" },
      "a-2": { frame: { kind: "theme" }, radius: "strong" },
      "a-3": { bg: "#112233", pano: "scroll" },
      "a-4": { video: "player" },
    },
  };
  assert.deepEqual(readLook(old), want);
  assert.deepEqual(LookSchema.parse(old), want);
  assert.deepEqual(readLook(clone(want)), want, "la nouvelle forme se relit à l'identique");
  const up = upgradeLook(old);
  assert.equal(Object.keys(up).some((k) => /^slot(Frame|Bg|Radius|Pano|Video)$/.test(k)), false);
  assert.deepEqual(upgradeLook(up), up, "idempotent");
  assert.equal(upgradeLook({ spaceTop: "m" }).spaceTop, "m");
  const same = { spaceTop: "m" };
  assert.equal(upgradeLook(same), same, "rien à convertir : le même objet");
  // Une valeur déjà posée dans slotLook prime sur l'ancienne carte.
  assert.deepEqual(upgradeLook({ slotRadius: { x: "soft" }, slotLook: { x: { radius: "none" } } }), { slotLook: { x: { radius: "none" } } });
  // Lecture tolérante place par place, champ par champ.
  assert.deepEqual(readLook({ slotLook: { ok: { radius: "soft", frame: { kind: "huge" } }, "../x": { radius: "soft" } } }), { slotLook: { ok: { radius: "soft" } } });
  assert.deepEqual(cleanLook({ slotLook: { a: { frame: undefined }, b: { bg: "card" } } }), { slotLook: { b: { bg: "card" } } });
  assert.ok(FrameSchema.safeParse(upgradeFrame({ size: "thin" })).success);
});

test("T1 protocole : media-look pour chaque cible ; plus de bitem-frame, bitem-imgbg ni de free-op « style »", () => {
  const origin = "http://localhost";
  const parent = {};
  const send = (data) => acceptFromCanvas({ origin, source: parent, data: { type: EDIT_MSG, ...data } }, origin, parent);
  const targets = [
    { kind: "block", uid: "b1" },
    { kind: "item", board: 3, uid: "i1" },
    { kind: "cell", board: 3, grid: "g1", uid: "c1" },
    { kind: "cell", board: 3, grid: "g1", uid: "c1", props: "{}" },
    { kind: "slot", uid: "p1", slug: "r1-aa" },
    { kind: "free", uid: "f1", id: "a1" },
    { kind: "free", uid: "f1", board: 3, props: "{}", id: "a1" },
  ];
  for (const target of targets) {
    assert.ok(send({ kind: "media-look", target, patch: { frame: BAND } }) !== null, JSON.stringify(target));
    assert.ok(send({ kind: "media-look", target, patch: { frame: null, bg: null, radius: null } }) !== null);
  }
  for (const bad of [{ kind: "slot", uid: "p1", slug: "../x" }, { kind: "free", uid: "f1", id: "A 1" }, { kind: "item", board: 0, uid: "i1" }, { kind: "vide", uid: "x" }]) assert.equal(send({ kind: "media-look", target: bad, patch: { bg: null } }), null, JSON.stringify(bad));
  assert.equal(send({ kind: "media-look", target: targets[0], patch: {} }), null, "patch vide");
  assert.equal(send({ kind: "bitem-frame", board: 1, uid: "b1", frame: null }), null);
  assert.equal(send({ kind: "bitem-imgbg", board: 1, uid: "b1", bg: null }), null);
  assert.equal(send({ kind: "free-op", uid: "f1", op: { op: "style", id: "a1", radius: null } }), null);
});

test("T1 source : un seul chemin d'écriture (aucune trace des anciennes intentions ni des cinq cartes hors lecture/migration)", () => {
  const files = [...walk("src")].filter((f) => /\.(ts|tsx)$/.test(f));
  const lines = (re) => files.flatMap((f) => read(f).split("\n").map((l, i) => ({ f, i: i + 1, l })).filter(({ l }) => re.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l)));
  assert.deepEqual(lines(/"bitem-frame"|"bitem-imgbg"|"item-frame"|"item-imgbg"/), [], "anciennes intentions / opérations");
  assert.deepEqual(lines(/op: "style"|z\.literal\("style"\)/), [], "ancienne opération de la Planche libre");
  const old = lines(/\b(slotFrame|slotBg|slotRadius|slotPano|slotVideo)\b/).filter(({ f }) => !/src\/lib\/(look|db\/slot-look|db\/frame-choice)\.ts$/.test(f));
  assert.deepEqual(old, [], "les cinq cartes ne se lisent plus que par upgradeLook (look.ts) et la migration");
  // Tout appel d'écriture d'habillage passe par `sendMediaLook` / `sendOwnMediaLook` / `sendSlotLook` (LookLayer) ou la planche libre.
  const writers = files.filter((f) => /media-look/.test(read(f)) || /sendMediaLook|sendOwnMediaLook|sendSlotLook/.test(read(f)));
  for (const need of ["src/lib/edit/boards.ts", "src/components/admin/editor/VisualEditor.tsx", "src/components/edit/LookLayer.tsx", "src/components/BoardLayer.tsx", "src/components/edit/FreeLayer.tsx", "src/components/edit/GridLayer.tsx", "src/components/EditLayer.tsx"]) assert.ok(writers.includes(need), need);
  // Le réducteur est importé, jamais recopié.
  assert.match(read("src/lib/edit/boards.ts"), /applyMediaPatch\(/);
  assert.match(read("src/components/admin/editor/VisualEditor.tsx"), /applyMediaPatch\(/);
  assert.match(read("src/blocks/free-board.ts"), /applyMediaPatchToFree\(/);
});

/* ---- T2. Feuilles de style ------------------------------------------------------------------------------------------ */

/** Règles d'une feuille : { context, selectors[], body } (les @media sont un contexte, pas une règle). */
function rulesOf(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  const stack = [];
  let buf = "";
  for (const ch of text) {
    if (ch === "{") {
      stack.push({ prelude: buf.trim(), body: "", rule: !buf.trim().startsWith("@") });
      buf = "";
    } else if (ch === "}") {
      const top = stack.pop();
      if (top?.rule) rules.push({ context: stack.map((s) => s.prelude).join(" | "), selectors: top.prelude.split(",").map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean), body: buf.trim() });
      buf = "";
    } else buf += ch;
  }
  return rules;
}

test("T2 cadre et fond d'image : chaque sélecteur [data-frame…] / [data-img-bg] vise `.media-frame` (ou sa case `.media-box`) et n'existe qu'UNE fois (par contexte)", () => {
  const seen = new Map();
  let n = 0;
  for (const f of walk("src").filter((x) => x.endsWith(".css"))) {
    for (const r of rulesOf(read(f))) {
      for (const sel of r.selectors) {
        if (!/\[data-(frame(-w|-id)?|img-bg)([=\]~|^$*])/.test(sel)) continue;
        n++;
        assert.match(sel, /\.media-(frame|box)/, `${f} : ${sel}`);
        const key = `${r.context}§${sel}`;
        assert.ok(!seen.has(key), `sélecteur en double : ${sel} (${seen.get(key)} et ${f})`);
        seen.set(key, f);
      }
    }
  }
  assert.ok(n >= 6, `${n} sélecteurs trouvés`);
  // Le cadre du thème pose `background-clip: padding-box` (le fond de la photo ne passe pas sous le dessin).
  assert.match(read("src/app/media-frame.css") + read("src/themes/variants.css"), /background-clip:\s*padding-box/);
});

test("T2 zone : UNE base `.zone` (couleurs lisibles, conteneur, rayons, calque de papier) ; la carte et le fond n'ajoutent que leurs différences", () => {
  const css = read("src/app/look.css");
  const rules = rulesOf(css);
  // Calque de papier : une seule règle `::before` qui dessine une image de fond pour une zone, et c'est `.zone::before`.
  const layers = rules.filter((r) => r.selectors.some((s) => /(\.surface-card|\.fond-bloc|\.zone)[^,]*::before$/.test(s)) && /background-image/.test(r.body));
  assert.equal(layers.length, 1, layers.map((r) => r.selectors.join(" , ")).join(" || "));
  assert.deepEqual(layers[0].selectors, [".zone::before"]);
  assert.match(layers[0].body, /background-image:\s*var\(--zp-img\)/);
  // Aucune variante ne redessine le calque : elles posent seulement `--zp-*`.
  const variants = rules.filter((r) => /--zp-content:\s*""/.test(r.body));
  assert.ok(variants.length >= 4, `${variants.length} variantes`);
  for (const r of variants) assert.ok(!/(position|inset|z-index|pointer-events|background-repeat):/.test(r.body.replace(/isolation:[^;]+;|position:\s*relative;/g, "")), r.selectors[0]);
  // Le remplacement des couleurs du thème par les variantes lisibles n'existe qu'une fois, sur la base.
  const remaps = rules.filter((r) => /--color-ink:\s*var\(--card-ink\)/.test(r.body));
  assert.equal(remaps.length, 1);
  assert.ok(remaps[0].selectors.every((s) => s.startsWith(".zone[")), remaps[0].selectors.join(" , "));
  // Rayons Petit / Moyen / Grand : trois valeurs écrites une fois (jetons), lues par la carte et le fond.
  assert.equal((css.match(/--zone-r-s:\s*10px/g) ?? []).length, 1);
  assert.equal((css.match(/\b36px\b/g) ?? []).length, 1);
  assert.match(css, /\.surface-card\[data-surface="on"\]\[data-corners="l"\]\s*\{\s*--card-r:\s*var\(--zone-r-l\)/);
  assert.match(css, /\.fond-bloc\[data-fond="on"\]\[data-fond-round="l"\]\s*\{\s*--fond-r:\s*var\(--zone-r-l\)/);
  // La carte et le fond posent la base.
  assert.match(read("src/components/ZoneWrap.tsx"), /className="zone surface-card"/);
  assert.match(read("src/components/FondWrap.tsx"), /className="zone fond-bloc"/);
  assert.match(read("src/blocks/BlockList.tsx"), /className="zone fond-bloc"/);
});

test("R5 formats : plus de tableau « format -> aspect-ratio » en CSS ; le composant pose `--box-r`", () => {
  for (const f of walk("src").filter((x) => x.endsWith(".css") && !x.includes("/admin/"))) {
    for (const r of rulesOf(read(f))) {
      if (!r.selectors.some((s) => /\[data-ratio="/.test(s))) continue;
      assert.ok(!/aspect-ratio:\s*\d/.test(r.body), `${f} : ${r.selectors.join(" , ")} écrit un format en dur`);
    }
  }
  assert.equal(ratioCss("auto"), undefined);
  assert.equal(ratioCss(undefined), undefined);
  assert.equal(ratioCss("inconnu"), undefined);
  assert.equal(ratioCss("4:3"), "calc(4 / 3)");
  assert.equal(ratioCss("1:1"), "calc(1 / 1)");
  for (const k of RATIO_VALUES) if (k !== "auto") assert.match(ratioCss(k), /^calc\(\d+ \/ \d+\)$/, k);
  assert.match(read("src/blocks/ProfileBlock.tsx"), /"--box-r": ratioCss\(/);
  assert.match(read("src/components/CollectionTiles.tsx"), /"--box-r": ratioCss\(/);
  const look = read("src/app/look.css");
  assert.match(look, /\.profile-portrait\[data-ratio\]:not\(\[data-ratio="auto"\]\) img \{ aspect-ratio: var\(--box-r\)/);
  assert.match(look, /\.tiles\[data-ratio\] \.tile-frame img \{ aspect-ratio: var\(--box-r\)/);
});

test("R5 rayons : `.blk[data-radius]` lit `--t-radius-*` émis par css.ts (mêmes valeurs qu'avant : 0, 4, 10, 20 px)", () => {
  const vars = layoutVariables({ tokens: {} });
  assert.deepEqual(Object.fromEntries(Object.entries(vars).filter(([k]) => k.startsWith("--t-radius-"))), { "--t-radius-none": "0px", "--t-radius-soft": "4px", "--t-radius-medium": "10px", "--t-radius-strong": "20px" });
  assert.deepEqual({ ...RADIUS_VALUES }, { none: "0px", soft: "4px", medium: "10px", strong: "20px" });
  const rules = rulesOf(read("src/app/look.css")).filter((r) => r.selectors.some((s) => s.startsWith(".blk[data-radius=")));
  assert.equal(rules.length, 4);
  for (const r of rules) assert.match(r.body, /^--media-radius:\s*var\(--t-radius-(none|soft|medium|strong)\);?$/, r.selectors[0]);
});

/* ---- M. Migration 0030 sur une base v0.30 réaliste ------------------------------------------------------------------- */

function freshDb() {
  const db = new Database(":memory:");
  const dir = path.join(ROOT, "drizzle/");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    for (const stmt of readFileSync(dir + f, "utf8").split("--> statement-breakpoint")) if (stmt.trim()) db.exec(stmt);
  }
  return db;
}
const T = (s) => ({ fr: s, en: s });
const TJ = (s) => JSON.stringify(T(s));
const kid = (uid, type, props) => ({ uid, type, props });
/** Une rubrique « Planche d'un projet » d'une page v0.30 : les cinq cartes par place, anciens cadres compris. */
const boardLook = () => ({
  spaceTop: "m",
  radius: "soft",
  slotRadius: { "pa-s1": "strong", "c1-aa": "none" },
  slotFrame: { "pa-s1": { size: "thick", color: "tertiary" }, "pa-s2": { kind: "theme" }, "c1-aa": { kind: "band", width: "fin", color: "#112233" }, "c1-bb": { size: "none" } },
  slotBg: { "pa-s1": "card", "c1-aa": "#ffffff", "pa-s3": "secondary" },
  slotPano: { "pa-s2": "scroll" },
  slotVideo: { "c1-bb": "player", "pa-s3": "loop" },
});
function expectedSlots(legacy) {
  // Calculé À LA MAIN depuis les cinq cartes (sans passer par upgradeLook) : ce que chaque place affichait avant.
  const out = {};
  const put = (map, field, norm = (v) => v) => {
    for (const [slug, v] of Object.entries(map ?? {})) (out[slug] ??= {})[field] = norm(v);
  };
  put(legacy.slotFrame, "frame", (f) => upgradeFrame(f));
  put(legacy.slotBg, "bg");
  put(legacy.slotRadius, "radius");
  put(legacy.slotPano, "pano");
  put(legacy.slotVideo, "video");
  return out;
}

test("M migration 0030 : une base v0.30 réaliste ressort identique (publié, brouillons, planches, brouillons de planche), idempotente", () => {
  const db = freshDb();
  const legacy = boardLook();
  const page = db.prepare("insert into pages (slug, title, meta, nav_order, published, draft, draft_rev) values (?, ?, null, ?, 1, ?, 4)");
  const draft = (blocks) => JSON.stringify({ title: T("x"), blocks });
  const gridKids = [kid("g1", "image", { mediaId: 1, look: { frame: { size: "medium" }, imageBg: "card" } }), kid("g2", "video-single", { mediaId: 2, mode: "loop" })];
  const blocks = () => [
    kid("pb1", "project-board", { project: "pa", look: legacy }),
    kid("gr1", "grid", { layout: "2", children: gridKids, look: { spaceTop: "s" } }),
    kid("fb1", "free-board", { format: "3:2", items: [{ id: "a1", media: 1, x: 1, y: 1, w: 20, frame: { size: "thin" }, bg: "card", radius: "soft" }] }),
    kid("pb2", "project-board", { project: "pb", look: { slotLook: { "pb-s1": { radius: "soft" } }, slotRadius: { "pb-s1": "strong", "pb-s2": "none" } } }),
    kid("ct1", "container", { children: [kid("pb3", "project-board", { project: "pc", look: { slotBg: { "pc-s1": "card" } } })] }),
  ];
  const p1 = page.run(TJ("a"), TJ("A"), 0, draft(blocks())).lastInsertRowid;
  const p2 = page.run(TJ("b"), TJ("B"), 1, draft([kid("t1", "rich-text", { paragraphs: [] })])).lastInsertRowid;
  const p3 = page.run(TJ("c"), TJ("C"), 2, null).lastInsertRowid;
  const ins = db.prepare("insert into blocks (page_id, position, type, props) values (?, ?, ?, ?)");
  blocks().forEach((b, i) => ins.run(p1, i, b.type, JSON.stringify(b.props)));
  ins.run(p3, 0, "project-board", JSON.stringify({ project: "pa", look: { slotFrame: { x: { size: "thin" } } } }));
  ins.run(p3, 1, "rich-text", JSON.stringify({ paragraphs: [] }));
  const project = db.prepare("insert into projects (slug, title, context, description, year, featured, position, layout, draft_layout, draft_layout_page_id) values (?, ?, ?, ?, '2024', 0, ?, ?, ?, ?)");
  const layout = [kid("strip", "strip", {}), kid("rail", "strip", { source: "own", media: [1, 2], ids: ["aa", "bb"], look: { slotFrame: { "rail-aa": { size: "thin" } } } })];
  const over = [kid("strip", "strip", {}), kid("rail", "strip", { source: "own", media: [1], ids: ["aa"], look: { slotBg: { "rail-aa": "card" } } })];
  project.run("pa", TJ("Pa"), TJ("c"), TJ(""), 1, JSON.stringify(layout), JSON.stringify(over), p2);
  project.run("pb", TJ("Pb"), TJ("c"), TJ(""), 2, null, null, null);

  // Avant : tout ce que chaque rubrique affichait, valeur par valeur (lu par le lecteur tolérant d'avant la migration).
  const allLooks = (db) => {
    const found = [];
    const visit = (node, where) => {
      if (Array.isArray(node)) node.forEach((c, i) => visit(c, `${where}[${i}]`));
      else if (node && typeof node === "object") {
        for (const [k, v] of Object.entries(node)) {
          if (k === "look") found.push([`${where}.look`, v]);
          visit(v, `${where}.${k}`);
        }
      }
    };
    for (const r of db.prepare("select id, props from blocks order by id").all()) visit(JSON.parse(r.props), `block${r.id}`);
    for (const r of db.prepare("select id, draft from pages where draft is not null order by id").all()) visit(JSON.parse(r.draft), `draft${r.id}`);
    for (const r of db.prepare("select id, layout, draft_layout from projects order by id").all()) {
      if (r.layout) visit(JSON.parse(r.layout), `layout${r.id}`);
      if (r.draft_layout) visit(JSON.parse(r.draft_layout), `dlayout${r.id}`);
    }
    return found;
  };
  const before = allLooks(db);
  assert.ok(before.length >= 12, `${before.length} look trouvés`);
  const beforeRead = before.map(([w, v]) => [w, readLook(clone(v)) ?? null]);
  const hasLegacy = (v) => v && typeof v === "object" && Object.keys(v).some((k) => /^slot(Frame|Bg|Radius|Pano|Video)$/.test(k));
  assert.ok(before.some(([, v]) => hasLegacy(v)));

  const rep = seedSlotLooks(db);
  assert.deepEqual(rep, { published: 4, drafts: 1, layouts: 1, draftLayouts: 1 });
  const after = allLooks(db);
  assert.equal(after.length, before.length, "aucun look perdu ni ajouté");
  assert.equal(after.some(([, v]) => hasLegacy(v)), false, "plus aucune ancienne carte");
  after.forEach(([w, v], i) => {
    assert.equal(w, before[i][0]);
    assert.deepEqual(readLook(clone(v)) ?? null, beforeRead[i][1], `${w} : réglages relus identiques`);
    assert.deepEqual(LookSchema.safeParse(v).success, true, `${w} : valide pour le schéma`);
  });
  // Place par place, champ par champ : ce que la planche v0.30 affichait (calculé à la main) est ce que slotLook donne.
  const pb1 = JSON.parse(db.prepare("select props from blocks where type = 'project-board' order by id limit 1").get().props);
  const want = expectedSlots(legacy);
  assert.deepEqual(Object.keys(pb1.look.slotLook).sort(), Object.keys(want).sort());
  for (const [slug, fields] of Object.entries(want)) assert.deepEqual(slotOf(readLook(pb1.look), slug), fields, slug);
  assert.equal(pb1.look.spaceTop, "m");
  assert.equal(pb1.look.radius, "soft", "l'arrondi du bloc n'est pas celui d'une place");
  // Une valeur déjà à la nouvelle forme prime (pb2) ; les autres champs de l'ancienne carte la complètent.
  const pb2 = JSON.parse(db.prepare("select props from blocks where type = 'project-board' order by id limit 1 offset 1").get().props);
  assert.deepEqual(pb2.look.slotLook, { "pb-s1": { radius: "soft" }, "pb-s2": { radius: "none" } });
  // Draft_rev : réécrit +1, la page qui tient la surcouche de planche +1, les autres inchangés.
  const rows = db.prepare("select id, draft_rev from pages order by id").all();
  assert.deepEqual(rows.map((r) => r.draft_rev), [5, 5, 4]);
  const layoutRow = db.prepare("select layout, draft_layout from projects order by id").all();
  assert.deepEqual(JSON.parse(layoutRow[0].layout)[1].props.look, { slotLook: { "rail-aa": { frame: { size: "thin" } } } }, "ancien cadre gardé tel quel (relu par FrameSchema)");
  assert.deepEqual(readLook(JSON.parse(layoutRow[0].layout)[1].props.look).slotLook["rail-aa"].frame, { kind: "band", width: "fin" });
  assert.equal(layoutRow[1].layout, null);
  // Les autres contenus n'ont pas bougé (cases de grille, Planche libre, textes).
  const gr = JSON.parse(db.prepare("select props from blocks where type = 'grid'").get().props);
  assert.deepEqual(gr.children, gridKids);
  const fb = JSON.parse(db.prepare("select props from blocks where type = 'free-board'").get().props);
  assert.deepEqual(fb.items[0], { id: "a1", media: 1, x: 1, y: 1, w: 20, frame: { size: "thin" }, bg: "card", radius: "soft" });
  // Idempotente : un deuxième passage ne change rien.
  const snap = () => JSON.stringify([db.prepare("select props from blocks order by id").all(), db.prepare("select id, draft, draft_rev from pages order by id").all(), db.prepare("select layout, draft_layout from projects order by id").all()]);
  const s1 = snap();
  assert.deepEqual(seedSlotLooks(db), { published: 0, drafts: 0, layouts: 0, draftLayouts: 0 });
  assert.equal(snap(), s1);
  db.close();
});

test("M migration 0030 : parcours d'un arbre, idempotent, journal et bootstrap", () => {
  const tree = [kid("a", "project-board", { look: { slotBg: { s1: "card" }, spaceTop: "l" } }), kid("b", "container", { children: [kid("c", "project-board", { look: { slotVideo: { s2: "loop" }, slotPano: { s2: "scroll" } } })] }), kid("d", "image", { look: { frame: { kind: "none" } } })];
  assert.equal(migrateSlotLooks(tree), true);
  assert.deepEqual(tree[0].props.look, { spaceTop: "l", slotLook: { s1: { bg: "card" } } });
  assert.deepEqual(tree[1].props.children[0].props.look, { slotLook: { s2: { video: "loop", pano: "scroll" } } });
  assert.deepEqual(tree[2].props.look, { frame: { kind: "none" } });
  assert.equal(migrateSlotLooks(tree), false);
  const dir = path.join(ROOT, "drizzle/");
  assert.ok(readdirSync(dir).includes("0030_slot_look.sql"));
  assert.doesNotMatch(readFileSync(dir + "0030_slot_look.sql", "utf8").replace(/--.*$/gm, ""), /\b(create|alter|drop|insert|update|delete)\b/i, "aucun SQL de schéma ni de données : migration de contenu seulement");
  const journal = JSON.parse(readFileSync(dir + "meta/_journal.json", "utf8"));
  const last = journal.entries.at(-1);
  assert.equal(last.tag, "0030_slot_look");
  assert.ok(last.when > 1792102152374, "le `when` suit celui de 0029");
  const when = journal.entries.map((e) => e.when);
  assert.deepEqual([...when].sort((a, b) => a - b), when, "journal chronologique");
  assert.match(read("src/lib/db/bootstrap.ts"), /"0030_slot_look"/);
});

console.log(`\n${passed} test(s) réussi(s)`);
