#!/usr/bin/env node
/**
 * Lot 44 — visionneuse « cliquer pour agrandir » (unités, sans serveur ni base) :
 *  1. `viewerAttrs` : élément cliquable (rôle bouton, libellé, focusable) ou passif (vidéo : aucun rôle) ; les données reviennent à l'identique ;
 *  2. schémas : `zoom` booléen facultatif sur Image et Grille (absent = oui), refus d'une autre valeur ; une donnée existante reste valide.
 * Usage : node --import tsx scripts/test-visionneuse44.mjs
 */
import assert from "node:assert/strict";

const { viewerAttrs } = await import("../src/lib/viewer.ts");
const { imageSchema } = await import("../src/blocks/ImageBlock.tsx");
const { gridSchema } = await import("../src/blocks/GridBlock.tsx");

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`ok ${name}`);
};

const item = { id: "media-1", image: "/m/a.webp", alt: "a", width: 10, height: 20, title: "T", description: "L", date: "2026", plain: true };

test("viewerAttrs : bouton accessible, données intactes", () => {
  const a = viewerAttrs(item, "Agrandir l'image");
  assert.equal(a.role, "button");
  assert.equal(a.tabIndex, 0);
  assert.equal(a["aria-label"], "Agrandir l'image");
  assert.equal(a["aria-haspopup"], "dialog");
  assert.deepEqual(JSON.parse(a["data-viewer-item"]), item);
  assert.ok(!("data-viewer-passive" in a));
});

test("viewerAttrs : passif (vidéo), sans rôle ni focus", () => {
  const a = viewerAttrs(item, "", true);
  assert.equal("data-viewer-passive" in a, true);
  assert.ok(!("role" in a) && !("tabIndex" in a));
});

test("schémas : zoom absent, vrai ou faux", () => {
  for (const schema of [imageSchema, gridSchema]) {
    assert.equal(schema.safeParse({}).success, true);
    assert.equal(schema.safeParse({}).data.zoom, undefined);
    assert.equal(schema.safeParse({ zoom: false }).data.zoom, false);
    assert.equal(schema.safeParse({ zoom: true }).data.zoom, true);
    assert.equal(schema.safeParse({ zoom: "non" }).success, false);
  }
});

console.log(`${passed} tests OK`);
process.exit(0);
