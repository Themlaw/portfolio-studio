#!/usr/bin/env node
/**
 * Fond d'un texte (lot 21) : UNE définition pour tous les rôles et les textes de blocs. Schéma borné (jeton,
 * teinte douce ou #rrggbb[aa], comme les cartes), déclarations identiques à celles d'avant en « Auto »,
 * couleur du fond (variables du thème, halo de l'ombre douce), lisibilité (règle des cartes sur les 8 presets,
 * choix de couleur du texte respecté), feuille des styles du site sur les sept rôles, menu sans boîte doublée,
 * réglages enregistrés avant le lot (`roleBackdrop`) inchangés, aucune injection.
 * Usage : node --import tsx scripts/test-text-backdrop.mjs   (inclus dans npm test)
 */
import { BACKDROP_BLOCKED, BACKDROPS, lookAttributes, LookSchema, readLook, ROLES, SiteStylesSchema, siteStylesCss, textStyleDecls, textStyleObject, TextStyleSchema } from "../src/lib/look.ts";
import { backdropColorCss, backdropContrast, backdropDecls } from "../src/themes/text-backdrop.ts";
import { contrastRatio, opaqueOn, resolvePalette } from "../src/themes/palette.ts";
import { cardBackground, cardStyle } from "../src/themes/surface.ts";
import { SURFACE_TOKENS, ThemeSchema } from "../src/themes/schema.ts";
import { loadPreset, presetSlugs } from "./lib/presets.mjs";

let failures = 0;
let count = 0;
const ok = (label, cond, detail = "") => {
  count++;
  if (!cond) failures++;
  if (!cond) console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
};
const parses = (v) => TextStyleSchema.safeParse(v).success;
const decl = (style, prop, palette) => Object.fromEntries(textStyleDecls(style, palette))[prop];

const themes = await Promise.all(presetSlugs().map(async (s) => [s, ThemeSchema.parse(await loadPreset(s))]));
ok("8 presets livrés", themes.length === 8, String(themes.length));
const palette = resolvePalette(themes[0][1].tokens.color, themes[0][1].tokens.palette);

/* ---- Schéma ------------------------------------------------------------------------------------------- */
ok("fond : les quatre choix, avec ou sans couleur", BACKDROPS.every((b) => parses({ backdrop: b }) && parses({ backdrop: b, backdropColor: "primary" })));
ok("couleur : tous les jetons et teintes douces des cartes", SURFACE_TOKENS.every((t) => parses({ backdrop: "band", backdropColor: t })));
ok("couleur libre #rrggbb et #rrggbbaa", parses({ backdrop: "band", backdropColor: "#f6d6e4" }) && parses({ backdrop: "highlight", backdropColor: "#f6d6e480" }));
ok("refusés : fond inconnu, couleur nommée, majuscules, 3 chiffres, injection, trop long", [{ backdrop: "glow" }, { backdropColor: "red" }, { backdropColor: "#F6D6E4" }, { backdropColor: "#fff" }, { backdropColor: "url(x)" }, { backdropColor: "primary13" }, { backdropColor: "#ffffff;}" }, { backdropColor: "#" + "a".repeat(40) }].every((v) => !parses(v)));
ok("strict : clé inconnue toujours refusée, ancien style (sans fond) toujours valide", !parses({ backdrop: "band", glow: 1 }) && parses({ size: "l", color: "ink" }));
ok("styles du site : le fond se règle sur chacun des sept rôles", ROLES.length === 7 && ROLES.every((r) => SiteStylesSchema.safeParse({ roles: { [r]: { backdrop: "band", backdropColor: "tertiary25" } } }).success));
ok("réglages d'un bloc : le fond d'un texte précis (look.text)", LookSchema.safeParse({ text: { "site.role": { backdrop: "highlight" }, eyebrow: { backdrop: "shadow", backdropColor: "#112233" } } }).success);

/* ---- « Auto » : rendu d'avant ---------------------------------------------------------------------------- */
const auto = (b) => Object.fromEntries(backdropDecls(b, undefined));
ok("Auto ombre douce : le halo du thème (--role-shadow)", auto("shadow")["text-shadow"] === "var(--role-shadow)" && auto("shadow").background === "none");
ok("Auto bandeau : fond du thème à 86 %, boîte en ligne", auto("band").background === "color-mix(in srgb, var(--color-bg) 86%, transparent)" && auto("band").display === "inline-block" && auto("band").padding === "0.45em 0.8em");
ok("Auto surlignage : couleur principale, texte sur-principal, coupure clonée", auto("highlight").background === "var(--color-primary)" && auto("highlight").color === "var(--user-ink, var(--color-on-primary))" && auto("highlight").display === "inline" && auto("highlight")["box-decoration-break"] === "clone");
ok("Auto ne lit pas la palette : même résultat avec et sans", JSON.stringify(backdropDecls("band", undefined, { palette })) === JSON.stringify(backdropDecls("band", undefined)));
ok("Aucun : efface le fond du thème (rien d'autre)", JSON.stringify(auto("none")) === JSON.stringify({ background: "none", padding: "0", "text-shadow": "none" }));
ok("Aucun ignore la couleur", JSON.stringify(textStyleDecls({ backdrop: "none", backdropColor: "primary" })) === JSON.stringify(textStyleDecls({ backdrop: "none" })));
ok("sans fond : aucune déclaration de fond", textStyleDecls({ size: "l" }).every(([k]) => k === "font-size"));
ok("la couleur sans fond est sans effet", textStyleDecls({ backdropColor: "primary" }).length === 0);

/* ---- Couleur ---------------------------------------------------------------------------------------------- */
ok("jeton : variable du thème (suit la palette)", backdropColorCss("primary") === "var(--t-color-primary)" && backdropColorCss("bgDeep") === "var(--t-color-bg-deep)");
ok("teinte douce : mélange Oklab de la couleur sur le fond de page", backdropColorCss("primary12") === "color-mix(in oklab, var(--t-color-primary) 12%, var(--t-color-bg))" && backdropColorCss("ink25").includes("25%"));
ok("couleur libre : telle quelle (alpha compris)", backdropColorCss("#a1b2c3") === "#a1b2c3" && backdropColorCss("#a1b2c380") === "#a1b2c380");
ok("bandeau coloré : la couleur exacte", decl({ backdrop: "band", backdropColor: "secondary" }, "background") === "var(--t-color-secondary)");
ok("surlignage coloré : la couleur exacte", decl({ backdrop: "highlight", backdropColor: "#a1b2c3" }, "background") === "#a1b2c3");
const halo = decl({ backdrop: "shadow", backdropColor: "#a1b2c3" }, "text-shadow");
ok("ombre douce colorée : le halo de CETTE couleur (16 couches + diffusion), la pastille s'applique", halo.split("#a1b2c3").length - 1 === 17 && halo.includes("color-mix(in srgb, #a1b2c3 60%, transparent)"));
ok("halo : même empilement que --role-shadow (16 rayons du thème, puis la diffusion)", (halo.match(/0 0 \d+px/g) ?? []).length === 17);

/* ---- Lisibilité ---------------------------------------------------------------------------------------------- */
ok("sans palette : le fond reste posé, aucune couleur de texte inventée", decl({ backdrop: "band", backdropColor: "ink" }, "color") === undefined && decl({ backdrop: "band", backdropColor: "ink" }, "background") === "var(--t-color-ink)");
const bad = [];
for (const [slug, t] of themes) {
  const p = resolvePalette(t.tokens.color, t.tokens.palette);
  for (const token of SURFACE_TOKENS) {
    for (const b of ["shadow", "band", "highlight"]) {
      const c = decl({ backdrop: b, backdropColor: token }, "color", p);
      const want = cardStyle(token, p).ink;
      if (c !== `var(--user-ink, ${want})`) bad.push(`${slug}/${b}/${token}: ${c}`);
    }
    // Le texte rendu lisible l'est vraiment (AA) sauf si aucun des trois candidats ne passe (déjà signalé pour les cartes).
    const s = cardStyle(token, p);
    if (s.ok && contrastRatio(s.ink, opaqueOn(cardBackground(token, p), p.bg)) < 4.5) bad.push(`${slug}/${token}: contraste`);
  }
}
ok("8 presets × jetons × 3 fonds : la couleur du texte est celle de la règle des cartes", bad.length === 0, bad.slice(0, 3).join(" | "));
ok("couleur de texte choisie : jamais écrasée (local : sa déclaration suit)", decl({ backdrop: "band", backdropColor: "ink", color: "primary" }, "color", palette) === "var(--t-color-primary)" && textStyleDecls({ backdrop: "band", backdropColor: "ink", color: "primary" }, palette).filter(([k]) => k === "color").length === 1);
ok("couleur libre du texte : gardée", decl({ backdrop: "highlight", backdropColor: "primary", color: "#445566" }, "color", palette) === "#445566");
ok("style React : custom property absente, camelCase conservé", textStyleObject({ backdrop: "highlight" })?.boxDecorationBreak === "clone" && textStyleObject({ backdrop: "highlight" })?.WebkitBoxDecorationBreak === "clone");
// Alerte : texte de couleur choisie sur un fond coloré.
const low = backdropContrast("ink", "ink", palette);
ok("alerte : encre sur fond encre = illisible", low !== null && !low.ok && low.ratio < 1.5);
ok("pas d'alerte : encre sur fond de page", backdropContrast("bg", "ink", palette)?.ok === true);
ok("alerte : couleur libre de texte mesurée aussi", backdropContrast("primary", "#" + "0".repeat(6), palette) !== null);
ok("rien à mesurer : fond Auto ou texte non choisi", backdropContrast(undefined, "ink", palette) === null && backdropContrast("primary", undefined, palette) === null);
ok("teintes du texte : « Encre douce » et « Étiquettes » reconnues", backdropContrast("primary", "ink-soft", palette) !== null && backdropContrast("primary", "eyebrow", palette) !== null);

/* ---- Feuille des styles du site : un seul mécanisme pour tous les rôles ----------------------------------------- */
for (const role of ROLES) {
  const css = siteStylesCss({ roles: { [role]: { backdrop: "band", backdropColor: "primary12" } } }, palette);
  ok(`rôle ${role} : bandeau coloré dans la feuille`, css.includes("color-mix(in oklab, var(--t-color-primary) 12%, var(--t-color-bg))") && css.includes("display:inline-block"));
  const none = siteStylesCss({ roles: { [role]: { backdrop: "none" } } });
  ok(`rôle ${role} : « Aucun » dans la feuille`, none.includes("text-shadow:none") && none.includes("background:none"));
}
const menu = siteStylesCss({ roles: { menu: { backdrop: "band", backdropColor: "secondary" } } }, palette);
ok("menu : la boîte est posée sur le lien seul (pas doublée sur le <span>)", menu.includes(":root:root:root .site-header nav a{") && !/nav :is\(a, a > span\)\{[^}]*padding/.test(menu));
const withColor = siteStylesCss({ roles: { caption: { color: "ink-soft", backdrop: "band", backdropColor: "tertiary" } } }, palette);
ok("rôle à couleur choisie : publiée dans --user-ink (un fond local ne l'écrase pas)", withColor.includes("--user-ink:var(--t-color-ink-soft)"));
ok("rôle sans couleur choisie : pas de --user-ink", !siteStylesCss({ roles: { caption: { backdrop: "band", backdropColor: "tertiary" } } }, palette).includes("--user-ink:"));
ok("injection : valeur refusée → feuille vide", siteStylesCss({ roles: { body: { backdrop: "band", backdropColor: "red;}body{x" } } }, palette) === "");
ok("aucun '<' dans la feuille", !siteStylesCss({ roles: { body: { backdrop: "shadow", backdropColor: "#112233" } } }, palette).includes("<"));

/* ---- Existant ---------------------------------------------------------------------------------------------------- */
ok("ancien fond du métier (look.roleBackdrop) : lu et rendu comme avant", readLook({ roleBackdrop: "band" })?.roleBackdrop === "band" && lookAttributes({ roleBackdrop: "shadow" })?.["data-role-bd"] === "shadow");
ok("styles existants : mêmes déclarations qu'avant le lot", JSON.stringify(textStyleDecls({ size: "l", weight: 600, color: "ink", align: "center" })) === JSON.stringify([["font-size", "1.25rem"], ["font-weight", "600"], ["color", "var(--t-color-ink)"], ["text-align", "center"]]));
ok("sans fond ni palette : la règle du rôle est celle d'avant (+ le choix de couleur publié à part)", siteStylesCss({ roles: { h1: { size: "3xl", color: "primary" } } }) === ":root:root:root #contenu h1{font-size:clamp(2.25rem, 5vw, 3.25rem);color:var(--t-color-primary)}\n:root:root:root #contenu h1{--user-ink:var(--t-color-primary)}" && siteStylesCss({ roles: { h1: { size: "3xl" } } }) === ":root:root:root #contenu h1{font-size:clamp(2.25rem, 5vw, 3.25rem)}");
ok("aucun rôle ne bloque le fond aujourd'hui (la ligne reste active)", ROLES.every((r) => BACKDROP_BLOCKED[r] === undefined));

if (failures) {
  console.error(`test-text-backdrop : ÉCHEC (${failures}/${count})`);
  process.exit(1);
}
console.log(`test-text-backdrop : OK (${count} contrôles)`);
