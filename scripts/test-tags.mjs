#!/usr/bin/env node
/**
 * Règles pures des tags : clé normalisée, nettoyage, bornes, classement des
 * suggestions (exact > début > début de mot > contient ; usages à rang égal).
 * Usage : npm test
 */
const { cleanTagLabel, rankTags, tagKey, tagLabelProblem } = await import(new URL("../src/lib/tag-key.ts", import.meta.url));

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? " — " + detail : ""}`);
};

ok("clé : accents, casse et espaces", tagKey("  Décor   Nuit ") === "decor nuit" && tagKey("ÉTÉ") === "ete");
ok("nettoyage : caractères invisibles retirés", cleanTagLabel(`a${String.fromCharCode(0x200b)}b${String.fromCharCode(0x202e)}c`) === "abc");
ok("bornes : vide et 41 caractères refusés, 40 acceptés", Boolean(tagLabelProblem("   ")) && Boolean(tagLabelProblem("x".repeat(41))) && tagLabelProblem("x".repeat(40)) === null);
ok("bornes : 40 caractères comptés en points de code (é = 1)", tagLabelProblem("é".repeat(40)) === null);
const ch = (...codes) => String.fromCodePoint(...codes);
// Formes de compatibilité (NFKC) : pleine chasse, ligatures.
ok("NFKC : « ＤÉＣＯＲ » (pleine chasse) = « décor »", tagKey(ch(0xff24) + "É" + ch(0xff23, 0xff2f, 0xff32)) === "decor", tagKey(ch(0xff24) + "É" + ch(0xff23, 0xff2f, 0xff32)));
ok("NFKC : « ﬁlm » (ligature) = « film »", tagKey(ch(0xfb01) + "lm") === "film");
ok("ß → ss : « Straße » = « strasse », « STRASSE » aussi", tagKey("Straße") === "strasse" && tagKey("STRASSE") === "strasse");
// Invisibles : Cf (zéro-largeur, bidi, BOM), Cc, remplissages hangul, blanc braille.
for (const [name, code] of [
  ["zéro-largeur U+200B", 0x200b],
  ["joint U+200D", 0x200d],
  ["bidi U+202E", 0x202e],
  ["isolat bidi U+2066", 0x2066],
  ["BOM U+FEFF", 0xfeff],
  ["contrôle U+0007", 0x07],
  ["remplissage hangul U+3164", 0x3164],
  ["remplissage hangul U+115F", 0x115f],
  ["remplissage hangul U+1160", 0x1160],
  ["blanc braille U+2800", 0x2800],
]) {
  ok(`invisible retiré : ${name}`, cleanTagLabel(`ab${ch(code)}cd`) === "abcd" && tagKey(`ab${ch(code)}cd`) === "abcd", JSON.stringify(cleanTagLabel(`ab${ch(code)}cd`)));
}
ok("tabulation et retour à la ligne = une espace", cleanTagLabel("a\tb\nc") === "a b c");
// Clé vide refusée : que des invisibles, ou que des signes combinants.
ok("clé vide refusée : que des remplissages / blancs braille", Boolean(tagLabelProblem(ch(0x3164, 0x2800, 0x200b))));
ok("clé vide refusée : que des signes combinants", Boolean(tagLabelProblem(ch(0x301, 0x302, 0x308))), String(tagLabelProblem(ch(0x301, 0x302, 0x308))));
ok("un emoji seul reste un tag valable", tagLabelProblem(ch(0x1f3a8)) === null && tagKey(ch(0x1f3a8)) === ch(0x1f3a8));

const options = [
  { label: "aspersion", count: 9 },
  { label: "Perso secondaire", count: 1 },
  { label: "personnage", count: 5 },
  { label: "décor perso", count: 3 },
  { label: "pers", count: 0 },
  { label: "lune", count: 7 },
];
const ranked = rankTags(options, "PERS").map((o) => o.label);
ok("classement : exact, puis début (plus utilisé d'abord), puis début de mot, puis contient", JSON.stringify(ranked) === JSON.stringify(["pers", "personnage", "Perso secondaire", "décor perso", "aspersion"]), ranked.join(", "));
ok("classement : sans accents (« decor » trouve « décor perso »)", rankTags(options, "decor")[0]?.label === "décor perso");
ok("classement : saisie vide = tous, les plus utilisés d'abord", rankTags(options, "")[0].label === "aspersion" && rankTags(options, "").length === options.length);

if (failures) {
  console.error(`test-tags : ${failures} échec(s)`);
  process.exit(1);
}
console.log("test-tags : OK");
