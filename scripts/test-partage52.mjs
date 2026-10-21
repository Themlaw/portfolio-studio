#!/usr/bin/env node
/**
 * Lot 52 — partage et référencement (unités, sans serveur ni base) :
 *  1. `tabTitle` : « Page — Nom du site », sans doublon ;
 *  2. `readSeo` : lecture tolérante du réglage, schéma d'entrée strict ;
 *  3. `untranslatedCount` : textes { fr, en } sans traduction, titre compris ;
 *  4. `pickShareVariant` : variante ≥ 1200 px, sinon la plus grande.
 * Usage : node --import tsx scripts/test-partage52.mjs
 */
import assert from "node:assert/strict";

const { tabTitle, readSeo, SeoInputSchema, ICON_SIZES } = await import("../src/lib/seo-schema.ts");
const { untranslatedCount, untranslatedLabel } = await import("../src/lib/translation-gaps.ts");
const { pickShareVariant } = await import("../src/lib/seo.ts");

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`ok ${name}`);
};

test("tabTitle : « Page — Nom du site »", () => {
  assert.equal(tabTitle("Personnages", "Camille Roussel"), "Personnages — Camille Roussel");
  assert.equal(tabTitle("Perf", "Camille Roussel"), "Perf — Camille Roussel");
});
test("tabTitle : pas de doublon, accueil = nom du site", () => {
  assert.equal(tabTitle("Camille Roussel — Illustratrice", "Camille Roussel"), "Camille Roussel — Illustratrice");
  assert.equal(tabTitle("", "Camille Roussel"), "Camille Roussel");
  assert.equal(tabTitle("Perf", ""), "Perf");
});
test("readSeo : défaut, valeurs valides, champs corrompus ignorés", () => {
  assert.deepEqual(readSeo(undefined), { description: { fr: "", en: "" }, shareImage: null, favicon: null });
  const ok = readSeo({ description: { fr: "a", en: "b" }, shareImage: 4, favicon: { mediaId: 7, dir: "icons/7-abcd1234" } });
  assert.deepEqual(ok, { description: { fr: "a", en: "b" }, shareImage: 4, favicon: { mediaId: 7, dir: "icons/7-abcd1234" } });
  const bad = readSeo({ description: 3, shareImage: "x", favicon: { mediaId: 7, dir: "../../etc" } });
  assert.deepEqual(bad, { description: { fr: "", en: "" }, shareImage: null, favicon: null });
});
test("SeoInputSchema : strict, bornes", () => {
  const good = { description: { fr: "x", en: "" }, shareImage: null, favicon: 3 };
  assert.equal(SeoInputSchema.safeParse(good).success, true);
  assert.equal(SeoInputSchema.safeParse({ ...good, extra: 1 }).success, false);
  assert.equal(SeoInputSchema.safeParse({ ...good, shareImage: -1 }).success, false);
  assert.equal(SeoInputSchema.safeParse({ ...good, description: { fr: "x".repeat(301), en: "" } }).success, false);
});
test("ICON_SIZES : onglet, iPhone, Android", () => {
  for (const s of [32, 180, 192, 512]) assert.ok(ICON_SIZES.includes(s));
});
test("untranslatedCount : titre et textes localisés, à tout niveau", () => {
  assert.equal(untranslatedCount({ fr: "A", en: "A" }, []), 0);
  assert.equal(untranslatedCount({ fr: "A", en: "" }, []), 1);
  const blocks = [
    { props: { title: { fr: "T", en: "" }, paragraphs: [{ fr: "p1", en: "" }, { fr: "p2", en: "ok" }, { fr: "", en: "" }] } },
    { props: { children: [{ type: "x", props: { label: { fr: "l", en: "  " } } }], size: "wide" } },
  ];
  assert.equal(untranslatedCount({ fr: "A", en: "A" }, blocks), 3);
});
test("untranslatedLabel : singulier et pluriel", () => {
  assert.equal(untranslatedLabel(1), "1 texte n'est pas traduit en anglais");
  assert.equal(untranslatedLabel(3), "3 textes ne sont pas traduits en anglais");
});
test("pickShareVariant : au moins 1200 px, sinon la plus grande", () => {
  const set = "/media/img/a/480.webp 480w, /media/img/a/960.webp 960w, /media/img/a/1600.webp 1600w, /media/img/a/2400.webp 2400w";
  const r = pickShareVariant(set, { url: "/media/img/a/2400.webp", w: 2400, h: 1260 });
  assert.equal(r.url, "/media/img/a/1600.webp");
  assert.equal(r.width, 1600);
  assert.equal(r.height, 840);
  const small = pickShareVariant("/media/img/b/480.webp 480w, /media/img/b/960.webp 960w", { url: "/media/img/b/960.webp", w: 960, h: 480 });
  assert.equal(small.url, "/media/img/b/960.webp");
});

console.log(`\n${passed} tests passés`);
