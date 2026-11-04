#!/usr/bin/env node
/**
 * Lot 26 (v0.20) — couleurs et logo, tests unitaires (inclus dans npm test) :
 *  1. Vocabulaire unique : les six rôles portent le même nom partout (panneau « Couleurs », choix de carte, couleur d'un texte,
 *     rapports de contraste), dans le même ordre ; le kit PSD garde ses libellés.
 *  2. Image du logo : schéma, canon, feuille de style.
 *  3. Couverture d'une tuile : entrées automatiques et manuelles, schéma, références (médias protégés), collection vide.
 *  4. Protocole de la toile : tile-op « cover » / « cover-clear », site-look avec une image de logo.
 * Usage : node --import tsx scripts/test-couleurs26.mjs
 */
import assert from "node:assert/strict";

import {
  autoEntries,
  COLLECTION_NAMES,
  editsFromItems,
  itemsFromEntries,
  manualEntries,
  tileVisibility,
} from "../src/blocks/collection-pages.ts";
import { collectionTilesSchema } from "../src/blocks/CollectionTilesBlock.tsx";
import { extractRefs } from "../src/blocks/refs.ts";
import { cleanLogo, cleanSiteStyles, logoCss, LogoSchema, PALETTE, PALETTE_DISPLAY, PALETTE_LABELS, SiteStylesSchema } from "../src/lib/look.ts";
import { FromCanvasSchema } from "../src/lib/edit/protocol.ts";
import { CONTRAST_PAIRS } from "../src/themes/contrast.ts";
import { BASE_KEYS, BASE_LABELS, NUANCE_NAMES, paletteLabel, ROLE_NAMES } from "../src/themes/palette.ts";
import { SITE_ROLES } from "../src/themes/site-palette.ts";
import { SURFACE_DA_NAMES, SURFACE_DA_TOKENS, SURFACE_TOKEN_LABELS } from "../src/themes/surface.ts";

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`PASS  ${name}`);
};
const L = (fr, en = "") => ({ fr, en });

/* ---- 1. Vocabulaire ------------------------------------------------------------------------------------------ */

test("les six rôles : un nom chacun, dans l'ordre de la palette", () => {
  assert.deepEqual(Object.keys(ROLE_NAMES), [...BASE_KEYS]);
  assert.deepEqual(Object.values(ROLE_NAMES), ["Fond de page", "Cartes et encadrés", "Texte", "Boutons et liens", "Accent", "Ornements"]);
  assert.equal(new Set(Object.values(ROLE_NAMES)).size, 6, "aucun nom en double");
});

test("panneau « Couleurs » (SITE_ROLES), choix de carte et fond de texte : les mêmes noms, le même ordre", () => {
  assert.deepEqual(SITE_ROLES.map((r) => r.name), BASE_KEYS.map((k) => ROLE_NAMES[k]));
  assert.deepEqual(SITE_ROLES.map((r) => r.key), [...BASE_KEYS]);
  assert.deepEqual([...SURFACE_DA_TOKENS], [...BASE_KEYS]);
  for (const k of BASE_KEYS) {
    assert.equal(SURFACE_DA_NAMES[k], ROLE_NAMES[k], `choix de carte ${k}`);
    assert.equal(SURFACE_TOKEN_LABELS[k], ROLE_NAMES[k], `libellé de jeton ${k}`);
  }
  assert.equal(SURFACE_TOKEN_LABELS.secondary12, "Accent, teinte 12 %", "les teintes reprennent le nom du rôle");
});

test("couleur d'un texte : les six rôles sous leur nom, puis les deux nuances", () => {
  assert.deepEqual([...PALETTE_DISPLAY].sort(), [...PALETTE].sort(), "tout choix du schéma est affiché, une seule fois");
  assert.deepEqual(PALETTE_DISPLAY.slice(0, 6), ["bg", "surface", "ink", "primary", "secondary", "tertiary"], "ordre du panneau « Couleurs »");
  for (const [palette, role] of [["bg", "bg"], ["surface", "surface"], ["ink", "ink"], ["primary", "primary"], ["secondary", "secondary"], ["tertiary", "tertiary"]]) assert.equal(PALETTE_LABELS[palette], ROLE_NAMES[role]);
  assert.equal(PALETTE_LABELS["ink-soft"], NUANCE_NAMES["ink-soft"]);
  assert.equal(PALETTE_LABELS.eyebrow, NUANCE_NAMES.eyebrow);
  const labels = Object.values(PALETTE_LABELS);
  assert.equal(new Set(labels).size, labels.length, "aucun libellé en double");
  assert.ok(!labels.some((l) => /^(Encre|Encre douce|Principale|Secondaire|Tertiaire|Fond|Surface)$/.test(l)), "plus d'ancien nom");
});

test("rapports de contraste : les noms des rôles (aucun « Liens et actions », « Accent secondaire »)", () => {
  const labels = CONTRAST_PAIRS.map((p) => p.label);
  assert.ok(labels.includes("Boutons et liens sur fond de page"));
  assert.ok(labels.includes("Accent sur cartes et encadrés"));
  assert.ok(labels.includes("Texte sur fond de page"));
  assert.ok(!labels.some((l) => /Liens et actions|Accent secondaire|sur surface|sur fond$/.test(l)), labels.join(" ; "));
});

test("le kit PSD garde ses libellés (un kit exporté s'importe d'après eux)", () => {
  assert.deepEqual(BASE_LABELS, { bg: "Fond", surface: "Surface", ink: "Texte", primary: "Action", secondary: "Accent secondaire", tertiary: "Détails" });
  assert.equal(paletteLabel("primaryHover"), "Action · survol");
});

/* ---- 2. Image du logo ----------------------------------------------------------------------------------------- */

test("logo : l'image (mediaId) est un entier positif, rien d'autre", () => {
  assert.ok(LogoSchema.safeParse({ mediaId: 12 }).success);
  assert.ok(LogoSchema.safeParse({ size: 60, mode: "shrink", mediaId: 3 }).success);
  for (const bad of [0, -1, 1.5, "12", null]) assert.ok(!LogoSchema.safeParse({ mediaId: bad }).success, String(bad));
  assert.ok(!LogoSchema.safeParse({ mediaId: 1, src: "x.png" }).success, "aucune adresse libre");
});

test("logo : l'image survit au nettoyage ; seule, elle compte comme un réglage", () => {
  assert.deepEqual(cleanLogo({ mediaId: 7 }), { mediaId: 7 });
  assert.deepEqual(cleanLogo({ mode: "fixed", mediaId: 7, size: 50 }), { size: 50, mediaId: 7 });
  assert.equal(cleanLogo({ mode: "fixed" }), undefined);
  assert.equal(cleanLogo({ mediaId: undefined }), undefined, "retirer l'image = plus de réglage");
  assert.deepEqual(cleanSiteStyles({ logo: { mediaId: 4 } }), { logo: { mediaId: 4 } });
  assert.ok(SiteStylesSchema.safeParse({ logo: { mediaId: 4 } }).success);
});

test("logo : la feuille de style règle aussi l'image (hauteur du logo, transition)", () => {
  const css = logoCss({ mediaId: 5 });
  assert.match(css, /\.site-logo-img\{height:var\(--lhe\);max-width:100%;object-fit:contain\}/);
  assert.match(css, /\.site-logo-img\{transition:height/);
  assert.equal(logoCss({}), "", "sans réglage : le rendu du thème");
});

/* ---- 3. Couverture d'une tuile ------------------------------------------------------------------------------------ */

const pageC = { pageId: 2, collection: "characters", eyebrow: L("E"), title: L("Persos"), intro: L("I") };
const pageB = { pageId: 3, collection: "backgrounds", eyebrow: L("E"), title: L("Décors"), intro: L("I") };

test("automatique : la couverture choisie (edits[].mediaId) suit sa page ; une valeur invalide est ignorée", () => {
  const out = autoEntries([pageC, pageB], [{ pageId: 2, mediaId: 40 }, { pageId: 3, mediaId: -2 }]);
  assert.equal(out[0].mediaId, 40);
  assert.equal(out[1].mediaId, undefined);
  assert.deepEqual(out[0].edited, {}, "une couverture n'est pas un texte modifié");
  assert.equal(autoEntries([pageC], [{ pageId: 2, title: L("Autre") }])[0].mediaId, undefined);
});

test("manuel : la couverture est portée par l'entrée ; auto → manuel → auto ne la perd pas", () => {
  const items = itemsFromEntries(autoEntries([pageC, pageB], [{ pageId: 2, mediaId: 40 }]));
  assert.equal(items[0].mediaId, 40);
  assert.ok(!("mediaId" in items[1]), "pas de clé vide");
  assert.equal(manualEntries(items, new Set([2, 3]))[0].mediaId, 40);
  const edits = editsFromItems(items, [pageC, pageB]);
  assert.deepEqual(edits, [{ pageId: 2, mediaId: 40 }]);
});

test("schéma du bloc : mediaId accepté dans les entrées et les modifications, entier positif seulement", () => {
  const base = { eyebrow: L(""), title: L("T") };
  assert.ok(collectionTilesSchema.safeParse({ ...base, mode: "auto", edits: [{ pageId: 2, mediaId: 9 }] }).success);
  assert.ok(collectionTilesSchema.safeParse({ ...base, mode: "manual", items: [{ collection: "characters", pageId: 2, eyebrow: L(""), title: L("a"), intro: L(""), mediaId: 9 }] }).success);
  assert.ok(!collectionTilesSchema.safeParse({ ...base, mode: "auto", edits: [{ pageId: 2, mediaId: 0 }] }).success);
  assert.ok(!collectionTilesSchema.safeParse({ ...base, mode: "auto", edits: [{ pageId: 2, mediaId: "9" }] }).success);
});

test("références : l'image d'une tuile compte comme utilisée (suppression du média bloquée)", () => {
  const manual = extractRefs("collection-tiles", { items: [{ pageId: 2, mediaId: 11 }, { pageId: 3 }] });
  assert.deepEqual(manual.media, [11]);
  assert.deepEqual(manual.pages, [2, 3]);
  assert.deepEqual(extractRefs("collection-tiles", { mode: "auto", edits: [{ pageId: 2, mediaId: 12 }, { pageId: 3, title: L("x") }] }).media, [12]);
});

test("collection vide : avis sur la toile, rien en public ; sinon la tuile", () => {
  assert.equal(tileVisibility(0, true), "notice");
  assert.equal(tileVisibility(0, false), "hidden");
  assert.equal(tileVisibility(1, true), "tile");
  assert.equal(tileVisibility(5, false), "tile");
  assert.deepEqual(COLLECTION_NAMES, { characters: "Personnages", backgrounds: "Décors", animation: "Animation" });
});

/* ---- 4. Protocole de la toile ---------------------------------------------------------------------------------------- */

test("protocole : tile-op « cover » et « cover-clear » (rang ou page), refus du reste", () => {
  const ok = (m) => FromCanvasSchema.safeParse({ kind: "tile-op", uid: "b1", ...m }).success;
  assert.ok(ok({ op: "cover", pageId: 4 }));
  assert.ok(ok({ op: "cover", index: 0 }));
  assert.ok(ok({ op: "cover-clear", pageId: 4 }));
  assert.ok(ok({ op: "up", index: 1 }), "les gestes d'avant sont intacts");
  assert.ok(!ok({ op: "cover", index: 99 }), "rang borné");
  assert.ok(!ok({ op: "cover", pageId: -1 }));
  assert.ok(!ok({ op: "cover-all" }));
});

test("protocole : site-look porte l'image du logo (entier positif)", () => {
  const ok = (logo) => FromCanvasSchema.safeParse({ kind: "site-look", palette: {}, logo }).success;
  assert.ok(ok({ mediaId: 8, size: 60 }));
  assert.ok(!ok({ mediaId: 0 }));
  assert.ok(!ok({ mediaId: "8" }));
});

console.log(`\ntest-couleurs26 : OK (${passed} tests)`);
