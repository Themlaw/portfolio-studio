#!/usr/bin/env node
/**
 * Liens partageables : validation du slug, schéma zod de l'action, exception du proxy.
 * Usage : node --import tsx scripts/test-share-links.mjs
 */
import assert from "node:assert/strict";

import { isShareLinkPath, normalizeShareSlug } from "../src/lib/share-links.ts";
import { ShareLinkSchema } from "../src/lib/edit/share-links.ts";

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`PASS  ${name}`);
};

test("slug accepté : cv", () => {
  assert.equal(ShareLinkSchema.safeParse({ slug: "cv", title: null, mediaId: 1, allowDownload: true, enabled: true }).success, true);
});
test("slug accepté : bande-demo-2026", () => {
  assert.equal(ShareLinkSchema.safeParse({ slug: "bande-demo-2026", title: null, mediaId: 1, allowDownload: true, enabled: true }).success, true);
});
for (const slug of ["CV", "a/b", "..", "", "a".repeat(61), "l é"]) {
  test(`slug refusé : ${JSON.stringify(slug)}`, () => {
    assert.equal(ShareLinkSchema.safeParse({ slug, title: null, mediaId: 1, allowDownload: true, enabled: true }).success, false);
  });
}

test("proxy : l/cv passe", () => {
  assert.equal(isShareLinkPath("l/cv"), true);
});
for (const rest of ["l/", "l/CV", "l/a/b", "lx/cv", "l/%2e%2e"]) {
  test(`proxy : ${rest} ne passe pas`, () => {
    assert.equal(isShareLinkPath(rest), false);
  });
}

test("normalize : CV -> cv", () => {
  assert.equal(normalizeShareSlug("CV"), "cv");
});
test("normalize : bande_demo -> bande-demo", () => {
  assert.equal(normalizeShareSlug("bande_demo"), "bande-demo");
});
test("normalize : Démo Reel 2026 ! -> demo-reel-2026", () => {
  assert.equal(normalizeShareSlug("Démo Reel 2026 !"), "demo-reel-2026");
});
test("normalize : --a--b-- -> a-b", () => {
  assert.equal(normalizeShareSlug("--a--b--"), "a-b");
});
test("normalize : 80 caractères -> 60", () => {
  assert.equal(normalizeShareSlug("a".repeat(80)).length, 60);
});
test("normalize : chaîne vide -> vide", () => {
  assert.equal(normalizeShareSlug(""), "");
});

console.log(`\n${passed} tests passés`);