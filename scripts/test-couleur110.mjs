#!/usr/bin/env node
/**
 * Lot 110 : couleur du trait du kit. Schémas bornés, forme canonique, feuille générée (variables seulement quand un réglage existe),
 * aucune injection, rendu IDENTIQUE sans réglage (aucune variable --stroke-, feuille inchangée), gestes de la roue sans vol de focus.
 * Usage : node --import tsx scripts/test-couleur110.mjs   (inclus dans npm test)
 */
import { readFileSync } from "node:fs";

import { cleanSiteStyles, readTint, siteStylesCss, SiteStylesSchema, StrokeTintSchema, tintVars } from "../src/lib/look.ts";

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};

ok("teinte valide acceptée", StrokeTintSchema.safeParse({ color: "#e11d48", opacity: 50 }).success);
for (const bad of [{ color: "red", opacity: 50 }, { color: "#E11D48", opacity: 50 }, { color: "#e11d48", opacity: 0 }, { color: "#e11d48", opacity: 101 }, { color: "#e11d48", opacity: 50.5 }, { color: "#e11d48" }, { color: "#e11d48", opacity: 50, x: 1 }, { color: "url(x);}", opacity: 5 }])
  ok(`teinte refusée ${JSON.stringify(bad)}`, !StrokeTintSchema.safeParse(bad).success);
ok("readTint : illisible = undefined", readTint({ color: "x" }) === undefined && readTint(null) === undefined);
ok("variables de la teinte", JSON.stringify(tintVars({ color: "#e11d48", opacity: 50 })) === JSON.stringify({ "--stroke-c": "#e11d48", "--stroke-a": "50%", "--stroke-ao": "0.5" }));
ok("variables de l'en-tête", JSON.stringify(tintVars({ color: "#2563eb", opacity: 80 }, "nav-")) === JSON.stringify({ "--stroke-nav-c": "#2563eb", "--stroke-nav-a": "80%" }));

// Sans réglage : feuille et styles inchangés.
ok("sans réglage : aucune variable --stroke- dans la feuille", !/--stroke-/.test(siteStylesCss(undefined)) && !/--stroke-/.test(siteStylesCss({ radius: "m" })));
ok("sans réglage : styles canoniques inchangés", cleanSiteStyles({ radius: "m" })?.stroke === undefined && cleanSiteStyles({ stroke: {} }) === undefined);
const set = { stroke: { all: { color: "#e11d48", opacity: 50 }, header: { color: "#2563eb", opacity: 80 } } };
ok("styles du site : stroke accepté", SiteStylesSchema.safeParse(set).success);
const css = siteStylesCss(set);
ok("feuille : couleur du site et de l'en-tête", /:root:root:root\{--stroke-c:#e11d48;--stroke-a:50%;--stroke-ao:0\.5\}/.test(css) && /\.site-header\{--stroke-nav-c:#2563eb;--stroke-nav-a:80%\}/.test(css), css);
ok("feuille : en-tête seul, rien pour le reste", !/--stroke-c/.test(siteStylesCss({ stroke: { header: set.stroke.header } })));
ok("styles : teinte invalide refusée par le schéma", !SiteStylesSchema.safeParse({ stroke: { all: { color: "#zzzzzz", opacity: 10 } } }).success);
ok("styles : clé inconnue refusée", !SiteStylesSchema.safeParse({ stroke: { rule: set.stroke.all } }).success);
ok("canonique : réglage conservé", JSON.stringify(cleanSiteStyles(set)?.stroke) === JSON.stringify(set.stroke));

// Feuilles du kit : repli sur le dessin d'origine quand rien n'est réglé (variables invalides = var() de repli).
const v = readFileSync("src/themes/variants.css", "utf8");
ok("variants.css : soulignement, filets et barre retombent sur la couleur d'avant", /background-color: var\(--st-nav, var\(--color-primary\)\)/.test(v) && /background: var\(--st-rule, var\(--color-line\)\)/.test(v) && /var\(--st-thumb, var\(--color-primary\)\)/.test(v) && /var\(--st-track, color-mix\(in srgb, var\(--color-ink\) 28%, var\(--color-line\)\)\)/.test(v));
ok("variants.css : calque teinté des barres en couleurs, opacité 0 sans réglage", /opacity: var\(--stroke-ao, 0\)/.test(v));

// Roue : le focus d'un texte en saisie n'est pas volé.
const plane = readFileSync("src/components/edit/ColorPlane.tsx", "utf8");
const picker = readFileSync("src/components/edit/ColorPicker.tsx", "utf8");
ok("roue : le carré et la bande ne prennent pas le focus d'un texte en saisie", /textHoldsFocus\(e\.currentTarget\.ownerDocument\)/.test(plane));
ok("roue : l'ouverture ne prend pas le focus d'un texte en saisie", /!textHoldsFocus\(box\.current\.ownerDocument\)/.test(picker));

console.log(failures ? `\n${failures} ÉCHEC(S)` : "\nTout passe");
process.exit(failures ? 1 : 0);
