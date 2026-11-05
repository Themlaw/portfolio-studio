#!/usr/bin/env node
/**
 * Lot 124 : portées propres à l'en-tête et au pied de page — unités.
 * - Schéma des styles du site : `texts` (un texte, clé `data-site-text`) et `zones` (menu, pied de page) ; clés inconnues refusées, anciennes données relues.
 * - Feuille `siteStylesCss` : sans réglage, rien de plus qu'avant ; la zone passe devant les styles de rôle, le texte seul devant la zone ; jamais d'injection.
 * - Nettoyage et rebase des styles (un réglage en attente sur une autre page n'est pas écrasé) ; message de la toile.
 * Usage : node --import tsx scripts/test-portee124.mjs   (inclus dans npm test)
 */
import { FromCanvasSchema } from "../src/lib/edit/protocol.ts";
import { cleanSiteStyles, rebaseSiteStyles, siteStylesCss, SiteStylesSchema, siteTextZone } from "../src/lib/look.ts";

let failures = 0;
let count = 0;
function ok(label, cond, detail = "") {
  count++;
  if (!cond) {
    failures++;
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/* ---- Schéma ------------------------------------------------------------------------------ */
for (const k of ["brand", "n:p3", "n:l:/contact", "f:email", "f:role", "f:credit", "f:copy", "f:eb-nav", "f:n:p3", "f:s:Instagram|https://exemple.test/x"]) {
  ok(`clé acceptée : ${k}`, SiteStylesSchema.safeParse({ texts: { [k]: { color: "secondary" } } }).success, k);
}
for (const k of ["", "menu", "p3", "x:email", "f:", "n:", "role"]) ok(`clé refusée : « ${k} »`, !SiteStylesSchema.safeParse({ texts: { [k]: { color: "secondary" } } }).success, k);
ok("style illisible refusé", !SiteStylesSchema.safeParse({ texts: { brand: { color: "rouge-vif" } } }).success);
ok("zones : menu et pied de page", SiteStylesSchema.safeParse({ zones: { menu: { weight: 700 }, footer: { italic: true } } }).success);
ok("zones : une autre zone refusée", !SiteStylesSchema.safeParse({ zones: { header: { weight: 700 } } }).success);
ok("anciennes données relues telles quelles", SiteStylesSchema.safeParse({ roles: { menu: { color: "primary" } }, radius: "soft" }).success);
ok("zone d'un texte", siteTextZone("n:p3") === "menu" && siteTextZone("f:email") === "footer" && siteTextZone("f:n:p3") === "footer" && siteTextZone("brand") === null);

/* ---- Feuille ------------------------------------------------------------------------------ */
const before = siteStylesCss({ roles: { menu: { color: "secondary" }, body: { font: "theme:display" } } });
ok("sans zone ni texte : feuille identique", siteStylesCss({ roles: { menu: { color: "secondary" }, body: { font: "theme:display" } }, texts: {}, zones: {} }) === before);
ok("sans réglage : rien", siteStylesCss(undefined) === "" && siteStylesCss({}) === "");
const zone = siteStylesCss({ zones: { menu: { color: "tertiary", weight: 700 }, footer: { italic: true } } });
ok("zone du menu : liens de l'en-tête et bouton « Menu »", zone.includes('.site-header :is([data-site-text^="n:"], [data-site-text="menu-btn"])'), zone);
ok("zone du pied : textes repérés du pied", zone.includes('footer :is([data-site-text^="f:"])'), zone);
ok("la zone ne touche pas le contenu", !zone.includes("#contenu"), zone);
ok("la couleur choisie est publiée (--user-ink)", zone.includes("--user-ink:"), zone);
ok("le libellé en édition (<span>) prend la police", /> span\{[^}]*font-weight:700/.test(zone), zone);
const one = siteStylesCss({ texts: { "n:p3": { color: "primary" }, brand: { size: "3xl" } } });
ok("texte seul : sélecteur sur sa clé", one.includes('[data-site-text="n:p3"]') && one.includes('[data-site-text="brand"]'), one);
// Spécificité : texte seul (6 :root) > zone (4 :root) > styles de rôle du site (3 :root)
const both = siteStylesCss({ roles: { menu: { color: "secondary" } }, zones: { menu: { color: "tertiary" } }, texts: { "n:p3": { color: "primary" } } });
const lines = both.split("\n");
const idx = (re) => lines.findIndex((l) => re.test(l));
ok("ordre : site, zone, texte seul", idx(/^:root:root:root \.site-header/) >= 0 && idx(/^:root:root:root \.site-header/) < idx(/^:root:root:root:root :is\(\.site-header/) && idx(/^:root:root:root:root :is\(\.site-header/) < idx(/^:root:root:root:root:root:root :is\(\[data-site-text/), both);
ok("la zone est plus spécifique que le rôle, le texte seul que la zone", lines.some((l) => l.startsWith(":root:root:root:root:root:root ")) && lines.some((l) => l.startsWith(":root:root:root:root :is(.site-header")), both);
// Fond du texte : sur l'élément seul, pas sur son <span>
const box = siteStylesCss({ texts: { "f:role": { backdrop: "band", backdropColor: "primary" } } });
ok("fond : posé sur l'élément seul", /\[data-site-text="f:role"\]\)\{[^}]*background:/.test(box) && !/> span\{[^}]*background/.test(box), box);
// Injection
const evil = siteStylesCss({ texts: { 'n:x"]{}</style><b>': { color: "primary" } } });
ok("clé dangereuse : aucune balise, guillemet échappé", !evil.includes("</style") && !evil.replace(/\\"/g, "").includes('"]{}'), evil);
ok("clé refusée par le schéma : aucune règle", siteStylesCss({ texts: { "x:y": { color: "primary" } } }) === "");
ok("police Google : pas de balise", !siteStylesCss({ zones: { menu: { font: "google:Test</style>" } } }).includes("</style"));

/* ---- Nettoyage ----------------------------------------------------------------------------- */
const clean = cleanSiteStyles({ texts: { brand: { color: undefined }, "n:p3": { color: "primary" } }, zones: { menu: {}, footer: { italic: true } } });
ok("nettoyage : texte vide retiré, texte réglé gardé", !clean?.texts?.brand && clean?.texts?.["n:p3"]?.color === "primary");
ok("nettoyage : zone vide retirée, zone réglée gardée", !clean?.zones?.menu && clean?.zones?.footer?.italic === true);
ok("nettoyage : tout vide = thème seul", cleanSiteStyles({ texts: {}, zones: {} }) === undefined);
ok("nettoyage : les autres champs sont gardés", cleanSiteStyles({ radius: "soft", texts: { brand: { weight: 700 } } })?.radius === "soft");

/* ---- Rebase (réglage en attente sur une autre page) ---------------------------------------- */
const base = { texts: { brand: { weight: 400 } } };
const mine = { texts: { brand: { weight: 400 }, "n:p3": { color: "primary" } }, zones: { menu: { italic: true } } };
const theirs = { texts: { brand: { weight: 400 }, "f:role": { color: "secondary" } }, zones: { footer: { weight: 700 } } };
const merged = rebaseSiteStyles(base, mine, theirs);
ok("rebase : mon texte posé, celui de l'autre page gardé", merged?.texts?.["n:p3"]?.color === "primary" && merged?.texts?.["f:role"]?.color === "secondary");
ok("rebase : ma zone posée, celle de l'autre page gardée", merged?.zones?.menu?.italic === true && merged?.zones?.footer?.weight === 700);
const undone = rebaseSiteStyles({ texts: { "n:p3": { color: "primary" } } }, {}, { texts: { "n:p3": { color: "primary" }, brand: { weight: 700 } } });
ok("rebase : un réglage que j'ai retiré l'est, les autres restent", !undone?.texts?.["n:p3"] && undone?.texts?.brand?.weight === 700);

/* ---- Message de la toile ------------------------------------------------------------------- */
ok("message site-text-style valide", FromCanvasSchema.safeParse({ kind: "site-text-style", key: "n:p3", style: { color: "#a1b2c3" } }).success);
ok("message site-text-style : null (Revenir)", FromCanvasSchema.safeParse({ kind: "site-text-style", key: "brand", style: null }).success);
ok("message site-text-style : clé inconnue refusée", !FromCanvasSchema.safeParse({ kind: "site-text-style", key: "role", style: null }).success);
ok("message site-text-style : couleur injectée refusée", !FromCanvasSchema.safeParse({ kind: "site-text-style", key: "brand", style: { color: "#a1b2c3;}</style>" } }).success);
ok("message site-zone-style valide", FromCanvasSchema.safeParse({ kind: "site-zone-style", zone: "footer", style: { weight: 600 } }).success);
ok("message site-zone-style : zone inconnue refusée", !FromCanvasSchema.safeParse({ kind: "site-zone-style", zone: "body", style: null }).success);

console.log(failures ? `${failures} échec(s) sur ${count}` : `OK ${count} vérifications`);
process.exit(failures ? 1 : 0);
