#!/usr/bin/env node
/**
 * Palette et logo du site (lot 17f) : schémas bornés, forme canonique, feuilles générées sans injection,
 * nuances recalculées, contraste AA (publication), messages de la toile, rendu IDENTIQUE sans réglage
 * sur les presets (parité).
 * Usage : node --import tsx scripts/test-site-look.mjs   (inclus dans npm test)
 */
import { readFileSync } from "node:fs";

import {
  LOGO_ALIGNS,
  LOGO_ANCHORS,
  LOGO_X_MAX,
  LOGO_X_MIN,
  cleanLogo,
  cleanSitePalette,
  cleanSiteStyles,
  LOGO_MODES,
  LOGO_SIZE_MAX,
  LOGO_SIZE_MIN,
  logoCss,
  LogoSchema,
  SitePaletteSchema,
  siteStylesCss,
  SiteStylesSchema,
} from "../src/lib/look.ts";
import { FromCanvasSchema, ToCanvasSchema } from "../src/lib/edit/protocol.ts";
import { SiteSnapSchema } from "../src/lib/site-schema.ts";
import { colorVariables, sitePaletteCss, sitePaletteVariables, themeVariables } from "../src/themes/css.ts";
import { contrastRatio, resolvePalette } from "../src/themes/palette.ts";
import { applySitePalette, autoAdjustBase, themeFixesNuance, effectiveSitePalette, nuanceOrigin, nuancesUnder, rolePairs, sitePaletteIssues, sitePaletteProblem, SITE_NUANCES, SITE_ROLES } from "../src/themes/site-palette.ts";
import { PRESETS } from "../src/themes/presets/index.ts";

let failures = 0;
let count = 0;
function ok(label, cond, detail = "") {
  count++;
  if (!cond) failures++;
  if (!cond) console.log(`FAIL ${label}${detail ? ` — ${detail}` : ""}`);
}

/* ---- Schémas ----------------------------------------------------------------------------- */
ok("palette : #rrggbb minuscules accepté", SitePaletteSchema.safeParse({ bg: "#faf6ee", primary: "#2e4e9e" }).success);
for (const bad of ["#FAF6EE", "#fff", "#faf6ee80", "rgb(1,2,3)", "red", "#faf6e;", "#12345g", "</style>"]) ok(`palette : ${bad} refusé`, !SitePaletteSchema.safeParse({ bg: bad }).success);
ok("palette (lot 29) : les neuf nuances se choisissent (#rrggbb ou « auto »)", ["bgDeep", "line", "inkSoft", "shadow", "primaryHover", "onPrimary", "eyebrow", "scrim", "onScrim"].every((k) => SitePaletteSchema.safeParse({ [k]: "#000000" }).success && SitePaletteSchema.safeParse({ [k]: "auto" }).success));
ok("palette : nuance invalide ou clé inconnue refusée", !SitePaletteSchema.safeParse({ scrim: "#FFF" }).success && !SitePaletteSchema.safeParse({ scrim: "autre" }).success && !SitePaletteSchema.safeParse({ scrim: "#00000080" }).success && !SitePaletteSchema.safeParse({ ombre: "#000000" }).success);
ok("palette : « auto » refusé pour une base", !SitePaletteSchema.safeParse({ bg: "auto" }).success);
ok("palette : les six bases acceptées", SitePaletteSchema.safeParse({ bg: "#000000", surface: "#000000", ink: "#000000", primary: "#000000", secondary: "#000000", tertiary: "#000000" }).success);
ok("logo : bornes de taille", LogoSchema.safeParse({ size: LOGO_SIZE_MIN }).success && LogoSchema.safeParse({ size: LOGO_SIZE_MAX }).success && !LogoSchema.safeParse({ size: LOGO_SIZE_MIN - 1 }).success && !LogoSchema.safeParse({ size: LOGO_SIZE_MAX + 1 }).success);
ok("logo : taille entière", !LogoSchema.safeParse({ size: 40.5 }).success && !LogoSchema.safeParse({ size: "40" }).success);
ok("logo : deux comportements proposés (+ l'ancien « overhang » encore lu), aucun autre", LOGO_MODES.length === 2 && [...LOGO_MODES, "overhang"].every((m) => LogoSchema.safeParse({ mode: m }).success) && !LogoSchema.safeParse({ mode: "sticky" }).success);
ok("logo : clé inconnue refusée", !LogoSchema.safeParse({ size: 40, width: 3 }).success);
ok("styles du site : palette et logo acceptés", SiteStylesSchema.safeParse({ palette: { bg: "#ffffff" }, logo: { size: 80, mode: "shrink" } }).success);
ok("snapshot du site : porte la palette et le logo", SiteSnapSchema.safeParse({ identity: { name: { fr: "A", en: "" }, role: { fr: "", en: "" }, email: "", credit: { fr: "", en: "" } }, nav: [], socials: [], styles: { palette: { ink: "#101010" }, logo: { size: 64 } } }).success);

/* ---- Forme canonique (un brouillon identique au publié ne doit pas ressembler à une modification) ------ */
ok("logo : « Fixe » seul = aucun réglage", cleanLogo({ mode: "fixed" }) === undefined && cleanLogo({}) === undefined);
ok("logo : taille + Fixe → taille seule", JSON.stringify(cleanLogo({ size: 72, mode: "fixed" })) === JSON.stringify({ size: 72 }));
ok("logo : « Réduit » gardé, l'ancien « overhang » devient « Fixe » (comportement de base depuis le lot 68)", cleanLogo({ mode: "shrink" })?.mode === "shrink" && cleanLogo({ mode: "overhang" }) === undefined && JSON.stringify(cleanLogo({ size: 90, mode: "overhang" })) === JSON.stringify({ size: 90 }));
ok("palette vide = aucun réglage", cleanSitePalette({}) === undefined);
ok("styles : palette et logo vides disparaissent", cleanSiteStyles({ palette: {}, logo: { mode: "fixed" } }) === undefined);
ok("styles : palette et logo gardés", JSON.stringify(cleanSiteStyles({ palette: { bg: "#ffffff" }, logo: { size: 90 } })) === JSON.stringify({ palette: { bg: "#ffffff" }, logo: { size: 90 } }));

/* ---- Feuille du logo --------------------------------------------------------------------------- */
ok("logo : aucun réglage → aucune règle (rendu du thème)", logoCss(undefined) === "" && logoCss({}) === "" && logoCss({ mode: "fixed" }) === "");
const fixed = logoCss({ size: 80 });
ok("logo fixe : taille posée sur l'en-tête", fixed.includes(":root:root:root{--lg:80") && fixed.includes(":root:root:root .site-header{--lh:var(--lh-top)}"));
ok("logo fixe : hauteur du logo ; la barre garde sa rangée naturelle (min-height), jamais celle du logo", fixed.includes(".site-signature{height:var(--lh)") && fixed.includes(".site-header-bar{min-height:calc(var(--bh) + 2*var(--bp))}") && !fixed.includes(".site-header-bar{height:"));
ok("logo : mobile proportionnel et plafonné (24–64 px)", fixed.includes("clamp(24px,calc(var(--lg)*.75px),64px)"));
ok("logo fixe : pas de réduction au défilement", !fixed.includes("[data-scrolled]"));
const shrink = logoCss({ size: 120, mode: "shrink" });
const hang = logoCss({ size: 120, mode: "overhang" });
ok("logo : la page ne bouge pas (--header-h du thème gardé), rangée naturelle du nom, de la signature du kit", !fixed.includes("--header-h") && fixed.includes("--bh:1.125rem") && fixed.includes("[data-kit-signature]{--bh:2.25rem}") && fixed.includes("[data-kit-signature]{--bh:2.6rem}"));
ok("logo réduit : état défilé posé par l'en-tête", shrink.includes("[data-scrolled]{--lh:var(--lh-min)}") && shrink.includes("--lh-min:max(24px,calc(var(--lh-top)*.6))"));
ok("logo plus grand que la barre : il déborde dessous (marge basse négative), la mise en page ne suit que la rangée naturelle", fixed.includes(".site-brand{display:flex;align-items:center;height:var(--lh);margin-bottom:min(0px,calc(var(--bh) - var(--lh)))") && shrink.includes("margin-bottom:min(0px,calc(var(--bh) - var(--lh)))"));
ok("logo : l'ancien « overhang » donne la même feuille que « Fixe »", hang === logoCss({ size: 120 }) && !hang.includes("[data-scrolled]"));
ok("logo : le menu ne passe pas à la ligne (la barre ne grandit pas)", fixed.includes("nav a,") && fixed.includes("white-space:nowrap"));
ok("logo : transitions seulement sans demande de mouvement réduit", [fixed, shrink, hang].every((c) => { const at = c.indexOf("@media (prefers-reduced-motion:no-preference)"); return at > 0 && c.indexOf("transition") > at && !c.slice(0, at).includes("transition"); }));
ok("logo : en-tête centré : même règle (la rangée naturelle, pas de hauteur forcée)", !shrink.includes("[data-header=\"centered\"]") && !shrink.includes(".site-header-bar{height:"));
ok("logo : jamais de « < » ni de point-virgule libre", ![fixed, shrink, hang].some((c) => c.includes("<")));
ok("logo : valeur invalide → feuille vide", logoCss({ size: 9999 }) === "" && logoCss({ mode: "x;}" }) === "");
ok("styles de rôle inchangés : la feuille des rôles ne porte pas le logo", !siteStylesCss({ logo: { size: 90 }, palette: { bg: "#ffffff" } }).includes("--lg"));


/* ---- Lot 84 : place verticale et position horizontale du logo ------------------------------------------- */
{
  // Parité avec la v0.31.0 : sans align, x ni anchor, la feuille est identique OCTET pour OCTET à celle publiée (fixture générée par le code de rel/v0310).
  const legacy = JSON.parse(readFileSync(new URL("./lib/logo-css-v031.json", import.meta.url), "utf8"));
  ok("lot 84 : fixture v0.31 lue (15 réglages)", legacy.length === 15);
  for (const { logo, css } of legacy) ok(`lot 84 : parité v0.31 de ${JSON.stringify(logo)} (feuille identique)`, logoCss(logo) === css);
  ok("lot 84 : les valeurs par défaut explicites (top, 0, gauche) sont la v0.31 aussi", logoCss({ size: 120, align: "top", x: 0, anchor: "left" }) === logoCss({ size: 120 }) && cleanLogo({ align: "top", x: 0, anchor: "left" }) === undefined);
  ok("lot 84 : trois places verticales, trois ancrages", LOGO_ALIGNS.join() === "top,center,grow" && LOGO_ANCHORS.join() === "left,center,right");
  ok("lot 84 : schéma — valeurs inconnues et hors bornes refusées", !LogoSchema.safeParse({ align: "bottom" }).success && !LogoSchema.safeParse({ anchor: "middle" }).success && !LogoSchema.safeParse({ x: LOGO_X_MAX + 1 }).success && !LogoSchema.safeParse({ x: LOGO_X_MIN - 1 }).success && !LogoSchema.safeParse({ x: 1.5 }).success && LogoSchema.safeParse({ x: LOGO_X_MIN, anchor: "right", align: "grow" }).success);
  ok("lot 84 : forme canonique — top / 0 / left jamais écrits, le reste gardé", JSON.stringify(cleanLogo({ size: 80, align: "center", x: 30, anchor: "right" })) === JSON.stringify({ size: 80, align: "center", x: 30, anchor: "right" }) && JSON.stringify(cleanLogo({ align: "grow" })) === JSON.stringify({ align: "grow" }) && JSON.stringify(cleanLogo({ x: -12 })) === JSON.stringify({ x: -12 }));
  const base = logoCss({ size: 120 });
  const center = logoCss({ size: 120, align: "center" });
  const grow = logoCss({ size: 120, align: "grow" });
  ok("lot 84 centré : la feuille v0.31 est gardée, les règles s'y ajoutent", center.startsWith(base.slice(0, base.indexOf("@media (prefers-reduced-motion"))) && center.length > base.length);
  ok("lot 84 centré : marges haute et basse égales (boîte = la rangée), logo coupé aux limites de la barre (clip-path), menu téléphone sans réserve", center.includes("margin-block:min(0px,calc((var(--bh) - var(--lh))/2))") && center.includes("clip-path:inset(max(0px,calc((var(--lh) - var(--bh))/2 - var(--bp)))") && center.includes("#nav-mobile{padding-top:0}"));
  ok("lot 84 centré : la barre garde sa rangée naturelle (la bande dessous ne bouge pas)", center.includes(".site-header-bar{min-height:calc(var(--bh) + 2*var(--bp))}") && !center.includes("--lh-top)) + 2*var(--bp))"));
  ok("lot 84 « La barre s'agrandit » : barre = logo (réglé, pas défilé) + la marge du thème ; plus de débordement", grow.includes(".site-header-bar{min-height:calc(max(var(--bh),var(--lh-top)) + 2*var(--bp))}") && grow.includes(".site-brand{margin-block:0}") && !grow.includes("clip-path:inset"));
  const shrinkGrow = logoCss({ size: 120, mode: "shrink", align: "grow" });
  ok("lot 84 « La barre s'agrandit » + réduit au défilement : la barre suit la taille du haut (la page ne saute pas)", shrinkGrow.includes("[data-scrolled]{--lh:var(--lh-min)}") && shrinkGrow.includes("max(var(--bh),var(--lh-top))"));
  const moved = logoCss({ size: 60, x: 40 });
  ok("lot 84 position : décalage ×0,75 et 120 px au plus sur téléphone, entier en px sur grand écran, plafond mesuré lu", moved.includes("--lx:40") && moved.includes("clamp(-120px,calc(var(--lx)*.75px),120px)") && moved.includes("@media (min-width:48rem){:root:root:root{--lxs:calc(var(--lx)*1px)}}") && moved.includes("translate:clamp(var(--lx-lo,-1rem),calc(0px + var(--lxs)),var(--lx-hi,"));
  ok("lot 84 position : ancrage centre et droite lisent les marges mesurées", logoCss({ anchor: "center" }).includes("calc(var(--lx-mid,0px) + var(--lxs))") && logoCss({ anchor: "right", x: -10 }).includes("calc(var(--lx-hi,0px) + var(--lxs))") && logoCss({ anchor: "right", x: -10 }).includes("--lx:-10"));
  ok("lot 84 : transitions du décalage et de la place seulement sans demande de mouvement réduit", [center, grow, moved].every((c) => { const at = c.lastIndexOf("@media (prefers-reduced-motion:no-preference)"); return at > 0 && c.indexOf("translate .5s") > at; }));
  ok("lot 84 : jamais de « < » ni de valeur libre", ![center, grow, moved].some((c) => c.includes("<")) && logoCss({ align: "x;}", x: 1 }) === "" && logoCss({ x: 99999 }) === "");
  ok("lot 84 : protocole — site-look porte align, x et anchor ; valeurs hors schéma refusées", FromCanvasSchema.safeParse({ kind: "site-look", palette: {}, logo: { align: "center", x: 30, anchor: "center" } }).success && ToCanvasSchema.safeParse({ kind: "site-look", palette: {}, logo: { align: "grow" } }).success && !FromCanvasSchema.safeParse({ kind: "site-look", palette: {}, logo: { x: 5000 } }).success && !FromCanvasSchema.safeParse({ kind: "site-look", palette: {}, logo: { align: "autre" } }).success);
  ok("lot 84 : snapshot du site porte les nouveaux champs", SiteSnapSchema.safeParse({ identity: { name: { fr: "A", en: "" }, role: { fr: "", en: "" }, email: "", credit: { fr: "", en: "" } }, nav: [], socials: [], styles: { logo: { size: 90, align: "center", x: 12 } } }).success);
  // Retour à la v0.31.0 : sa LogoSchema est stricte, elle refuserait ces champs (voir le rapport).
}

/* ---- Palette du site sur les presets --------------------------------------------------------------- */
const ids = Object.keys(PRESETS);
ok("8 presets livrés (ou plus)", ids.length >= 8, String(ids.length));
for (const id of ids) {
  const theme = PRESETS[id];
  const tag = `[${id}]`;
  ok(`${tag} sans surcharge : feuille vide (parité)`, sitePaletteCss(theme.tokens, undefined) === "" && sitePaletteCss(theme.tokens, {}) === "");
  ok(`${tag} colorVariables = les variables de couleur de themeVariables`, Object.entries(colorVariables(theme.tokens.color, theme.tokens.palette)).every(([k, v]) => themeVariables(theme)[k] === v));
  const swapped = theme.tokens.color.bg === "#123456" ? "#654321" : "#123456";
  const vars = sitePaletteVariables(theme.tokens, { bg: swapped });
  ok(`${tag} fond de page : --t-color-bg posé, texte inchangé`, vars["--t-color-bg"] === swapped && !("--t-color-ink" in vars));
  ok(`${tag} fond de page : les nuances qui en dépendent suivent`, "--t-color-bg-deep" in vars && "--t-color-line" in vars && vars["--t-color-bg-deep"] !== themeVariables(theme)["--t-color-bg-deep"]);
  const css = sitePaletteCss(theme.tokens, { bg: swapped, primary: "#aa2200" });
  ok(`${tag} feuille : :root:root, couleurs posées, color-scheme`, css.startsWith(":root:root{color-scheme:") && css.includes(`--t-color-bg:${swapped}`) && css.includes("--t-color-primary:#aa2200"));
  ok(`${tag} feuille : survol et texte des boutons recalculés avec « Boutons et liens »`, sitePaletteVariables(theme.tokens, { primary: "#aa2200" })["--t-color-primary-hover"] !== undefined);
  const all = sitePaletteVariables(theme.tokens, {}, true);
  ok(`${tag} aperçu complet : revient exactement aux couleurs du thème`, Object.entries(all).every(([k, v]) => themeVariables(theme)[k] === v) && Object.keys(all).length >= 12);
  ok(`${tag} sans surcharge : aucun problème de contraste ajouté`, JSON.stringify(sitePaletteIssues(theme.tokens.color, theme.tokens.palette, undefined)) === JSON.stringify(sitePaletteIssues(theme.tokens.color, theme.tokens.palette, {})));
  // Le thème d'origine n'est jamais modifié.
  const before = JSON.stringify(theme.tokens.color);
  applySitePalette(theme.tokens.color, theme.tokens.palette, { bg: swapped, ink: "#101010" });
  ok(`${tag} le thème n'est pas modifié (copie)`, JSON.stringify(theme.tokens.color) === before);
}

const pro = PRESETS[ids[0]];
const eff = effectiveSitePalette(pro.tokens.color, pro.tokens.palette, { ink: "#ffeedd" });
ok("texte : le texte secondaire est recalculé depuis le nouveau texte", eff.ink === "#ffeedd" && eff.inkSoft !== resolvePalette(pro.tokens.color, pro.tokens.palette).inkSoft);
ok("six rôles, et chaque nuance est rangée sous un rôle ou sous « Image agrandie »", SITE_ROLES.length === 6 && SITE_ROLES.every((r) => ["bg", "surface", "ink", "primary", "secondary", "tertiary"].includes(r.key)) && Object.keys(SITE_NUANCES).length === 9 && SITE_ROLES.flatMap((r) => nuancesUnder(r.key)).concat(nuancesUnder("lightbox")).length === 9);
ok("nuances rangées : survol et texte des boutons sous « Boutons et liens », voile et texte sur le voile sous « Image agrandie »", nuancesUnder("primary").join() === "primaryHover,onPrimary" && nuancesUnder("lightbox").join() === "scrim,onScrim" && nuancesUnder("ink").includes("eyebrow") && nuancesUnder("bg").join() === "bgDeep,line");
{
  const t = pro.tokens;
  const base = resolvePalette(t.color, t.palette);
  const e = effectiveSitePalette(t.color, t.palette, { primaryHover: "#112233", eyebrow: "#445566", scrim: "#0a0b0c", onScrim: "#fefefe" });
  ok("nuances choisies : appliquées (survol, étiquettes, voile, texte du voile)", e.primaryHover === "#112233" && e.eyebrow === "#445566" && e.scrim === "#0a0b0c" && e.onScrim === "#fefefe");
  ok("nuances choisies : les autres couleurs ne bougent pas", e.bg === base.bg && e.ink === base.ink && e.primary === base.primary && e.inkSoft === base.inkSoft);
  const withBase = effectiveSitePalette(t.color, t.palette, { primary: "#aa3322", primaryHover: "#112233" });
  ok("une nuance choisie survit au changement de sa base (le survol ne se recalcule plus)", withBase.primaryHover === "#112233" && withBase.primary === "#aa3322");
  // Lot 30 : « Revenir… » efface le choix. Un « auto » déjà enregistré (v0.22.0) = pas de choix.
  const none = effectiveSitePalette(t.color, t.palette, {});
  const legacy = effectiveSitePalette(t.color, t.palette, { scrim: "auto", primaryHover: "auto" });
  ok("« auto » hérité de la v0.22.0 : lu comme « pas de choix » (valeur du thème, ou calcul si le thème n'en fixe pas)", JSON.stringify(legacy) === JSON.stringify(none), `${legacy.primaryHover} ${none.primaryHover}`);
  ok("« auto » hérité : origine = celle sans choix", nuanceOrigin(t.color, t.palette, { primaryHover: "auto" }, "primaryHover") === nuanceOrigin(t.color, t.palette, {}, "primaryHover") && nuanceOrigin(t.color, t.palette, { scrim: "auto" }, "scrim") === "auto");
  ok("« auto » hérité : rien n'est émis dans la feuille du site", sitePaletteCss(t, { primaryHover: "auto", scrim: "auto" }) === "");
  const fixed = nuanceOrigin(t.color, t.palette, {}, "primaryHover") === "theme";
  ok("le thème pro fixe son survol (hypothèse des tests suivants)", fixed && nuanceOrigin(t.color, t.palette, {}, "scrim") === "auto");
  ok("thème fixe la nuance : retour = valeur du thème (la clé effacée rend exactement la valeur d'avant), libellé « couleur du thème »", themeFixesNuance(t.color, t.palette, { primaryHover: "#101010" }, "primaryHover") === true && effectiveSitePalette(t.color, t.palette, {}).primaryHover === base.primaryHover && effectiveSitePalette(t.color, t.palette, { primaryHover: "#101010" }).primaryHover === "#101010");
  ok("thème ne fixe pas la nuance : retour = calcul, libellé « automatique »", themeFixesNuance(t.color, t.palette, { scrim: "#0a0b0c" }, "scrim") === false && effectiveSitePalette(t.color, t.palette, {}).scrim === base.scrim);
  ok("une base changée rend le survol calculé : plus de « couleur du thème » à rétablir", themeFixesNuance(t.color, t.palette, { primary: "#aa3322", primaryHover: "#101010" }, "primaryHover") === false);
  const autoHover = Object.values(PRESETS).find((p) => p.tokens.palette?.auto?.includes("primaryHover"));
  ok("un préréglage dont le survol est « auto » : retour = calcul, libellé « automatique »", Boolean(autoHover) && themeFixesNuance(autoHover.tokens.color, autoHover.tokens.palette, { primaryHover: "#101010" }, "primaryHover") === false);
  ok("origine d'une nuance : choisie / automatique / thème", nuanceOrigin(t.color, t.palette, { scrim: "#000000" }, "scrim") === "site" && nuanceOrigin(t.color, t.palette, { scrim: "auto" }, "scrim") === "auto" && nuanceOrigin(t.color, t.palette, { bg: "#ffffff" }, "bgDeep") === "auto");
  ok("voile choisi : la visionneuse prend sa couleur telle quelle ; calculé, gris neutre", sitePaletteCss(t, { scrim: "#0a0b0c" }).includes("--t-color-viewer:#0a0b0c") && !sitePaletteCss(t, { scrim: "auto", primary: "#aa3322" }).includes("--t-color-viewer:#0a0b0c"));
  ok("feuille du site : les nuances choisies sont émises", sitePaletteCss(t, { scrim: "#0a0b0c", primaryHover: "#112233" }).includes("--t-color-scrim:#0a0b0c") && sitePaletteCss(t, { scrim: "#0a0b0c", primaryHover: "#112233" }).includes("--t-color-primary-hover:#112233"));
}
ok("chaque rôle a un nom parlant et une phrase", SITE_ROLES.every((r) => r.name.length > 3 && r.phrase.endsWith(".")) && SITE_ROLES.some((r) => r.name === "Fond de page") && SITE_ROLES.some((r) => r.name === "Cartes et encadrés") && SITE_ROLES.some((r) => r.name === "Boutons et liens"));

/* ---- Contraste AA à la publication ---------------------------------------------------------------- */
const bad = { bg: pro.tokens.color.ink };
ok("texte = fond → problème de contraste", typeof sitePaletteProblem(pro.tokens.color, pro.tokens.palette, bad) === "string" && sitePaletteProblem(pro.tokens.color, pro.tokens.palette, bad).includes("illisible"));
ok("fond sombre sur thème clair : détecté, message avec le ratio", /\d,\d\d:1/.test(sitePaletteProblem(pro.tokens.color, pro.tokens.palette, bad) ?? ""));
ok("contraste de la palette effective : même formule que le thème", Math.abs(contrastRatio("#000000", "#ffffff") - 21) < 0.01);

/* ---- Ajuster automatiquement ---------------------------------------------------------------------- */
{
  const g = PRESETS["galerie-lumineuse"].tokens;
  // Un fond un peu trop teinté fait échouer les étiquettes sur le fond profond (nuance recalculée) : l'ajustement le voit.
  ok("fond trop teinté : problème détecté", sitePaletteIssues(g.color, g.palette, { bg: "#f1ead9" }).length > 0);
  ok("fond trop teinté : le couple « sur fond des blocs » est rattaché au rôle « Fond de page »", rolePairs(g.color, g.palette, { bg: "#f1ead9" }, "bg").some((p) => !p.ok && /fond des blocs/.test(p.label)));
  ok("rôle « Cartes et encadrés » non concerné par ce défaut", rolePairs(g.color, g.palette, { bg: "#f1ead9" }, "surface").every((p) => p.ok));
  const fixedBg = autoAdjustBase(g.color, g.palette, { bg: "#f1ead9" }, "bg");
  ok("fond trop teinté : ajusté à une teinte proche qui passe (nuances comprises)", typeof fixedBg === "string" && sitePaletteIssues(g.color, g.palette, { bg: fixedBg }).length === 0, String(fixedBg));
  ok("ajusté = même famille de teinte (plus clair que la saisie, pas un blanc de secours)", fixedBg !== "#ffffff" && parseInt(fixedBg.slice(1, 3), 16) >= 0xf1);
  const fixedInk = autoAdjustBase(g.color, g.palette, { ink: "#eee6d4" }, "ink");
  ok("texte illisible : ajusté pour passer sur les trois fonds", typeof fixedInk === "string" && sitePaletteIssues(g.color, g.palette, { ink: fixedInk }).length === 0, String(fixedInk));
  const fixedPrimary = autoAdjustBase(g.color, g.palette, { primary: "#f0e0d0" }, "primary");
  ok("boutons et liens clairs : ajustés (texte des boutons recalculé)", typeof fixedPrimary === "string" && sitePaletteIssues(g.color, g.palette, { primary: fixedPrimary }).length === 0, String(fixedPrimary));
  ok("rôle sans contrôle (ornements) : rien à ajuster", autoAdjustBase(g.color, g.palette, { tertiary: "#ffffff" }, "tertiary") === null);
  for (const id of ids) {
    const t = PRESETS[id].tokens;
    const worst = autoAdjustBase(t.color, t.palette, { ink: t.color.bg }, "ink");
    ok(`[${id}] texte = fond : l'ajustement trouve une encre lisible ou renonce (jamais une valeur qui échoue)`, worst === null || sitePaletteIssues(t.color, t.palette, { ink: worst }).filter((i) => /Texte/.test(i.label)).length === 0, String(worst));
  }
}

/* ---- Messages de la toile ------------------------------------------------------------------------- */
ok("toile → éditeur : site-look accepté", FromCanvasSchema.safeParse({ kind: "site-look", palette: { bg: "#ffffff" }, logo: { size: 64, mode: "shrink" } }).success);
ok("toile → éditeur : couleur injectée refusée", !FromCanvasSchema.safeParse({ kind: "site-look", palette: { bg: "#fff;}</style>" }, logo: {} }).success);
ok("toile → éditeur : taille hors bornes refusée", !FromCanvasSchema.safeParse({ kind: "site-look", palette: {}, logo: { size: 500 } }).success);
ok("toile → éditeur : légende du surlignage", FromCanvasSchema.safeParse({ kind: "highlight-info", role: "primary", count: 12, uses: ["titres", "liens"] }).success && FromCanvasSchema.safeParse({ kind: "highlight-info", role: null, count: 0, uses: [] }).success);
ok("toile → éditeur : rôle inconnu refusé", !FromCanvasSchema.safeParse({ kind: "highlight-info", role: "inkSoft", count: 1, uses: [] }).success);
ok("éditeur → toile : site-look et highlight", ToCanvasSchema.safeParse({ kind: "site-look", palette: { ink: "#101010" }, logo: {} }).success && ToCanvasSchema.safeParse({ kind: "highlight", role: "bg" }).success && ToCanvasSchema.safeParse({ kind: "highlight", role: null }).success);
ok("éditeur → toile : rôle inconnu refusé", !ToCanvasSchema.safeParse({ kind: "highlight", role: "scrim" }).success);

if (failures) {
  console.error(`test-site-look : ÉCHEC (${failures}/${count})`);
  process.exit(1);
}
console.log(`test-site-look : OK (${count} contrôles)`);
