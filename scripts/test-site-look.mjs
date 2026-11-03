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
  LOGO_FITS,
  LOGO_MARGINS,
  LOGO_MOBILES,
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
ok("logo fixe : taille posée sur l'en-tête", fixed.includes(":root:root:root{--lg:80") && fixed.includes(":root:root:root .site-header{--lh:var(--lh-top);--bar:calc(var(--bh) + 2*var(--bp));--lm:0.25rem}"));
ok("logo fixe (lot 106) : hauteur affichée plafonnée à la barre moins les marges ; la barre garde sa rangée naturelle (min-height = --bar), jamais celle du logo", fixed.includes(".site-header{--lhe:max(0px,min(var(--lh),calc(var(--bar) - 2*var(--lm))))}") && fixed.includes(".site-signature{height:var(--lhe)") && fixed.includes(".site-logo-img{height:var(--lhe);max-width:100%;object-fit:contain}") && fixed.includes(".site-header-bar{min-height:var(--bar)}") && !fixed.includes(".site-header-bar{height:"));
ok("logo : mobile proportionnel et plafonné (24–64 px)", fixed.includes("clamp(24px,calc(var(--lg)*.75px),64px)"));
ok("logo fixe : pas de réduction au défilement", !fixed.includes("[data-scrolled]"));
const shrink = logoCss({ size: 120, mode: "shrink" });
const hang = logoCss({ size: 120, mode: "overhang" });
ok("logo : la page ne bouge pas (--header-h du thème gardé), rangée naturelle du nom, de la signature du kit", !fixed.includes("--header-h") && fixed.includes("--bh:1.125rem") && fixed.includes("[data-kit-signature]{--bh:2.25rem}") && fixed.includes("[data-kit-signature]{--bh:2.6rem}"));
ok("logo réduit : état défilé posé par l'en-tête", shrink.includes("[data-scrolled]{--lh:var(--lh-min)}") && shrink.includes("--lh-min:max(24px,calc(var(--lh-top)*.6))"));
ok("logo plus grand que la barre (lot 106) : il ne déborde plus ni ne se coupe ; sa boîte ne pèse que la rangée naturelle (marges haute et basse égales), pas de clip-path", fixed.includes(".site-brand{display:flex;align-items:center;height:var(--lhe);margin-block:calc((var(--bh) - var(--lhe))/2)") && !fixed.includes("clip-path:inset") && !fixed.includes("margin-bottom:min(0px") && shrink.includes("margin-block:calc((var(--bh) - var(--lhe))/2)"));
ok("logo : l'ancien « overhang » donne la même feuille que « Fixe »", hang === logoCss({ size: 120 }) && !hang.includes("[data-scrolled]"));
ok("logo : le menu ne passe pas à la ligne (la barre ne grandit pas)", fixed.includes("nav a,") && fixed.includes("white-space:nowrap"));
ok("logo : transitions seulement sans demande de mouvement réduit", [fixed, shrink, hang].every((c) => { const at = c.indexOf("@media (prefers-reduced-motion:no-preference)"); return at > 0 && c.indexOf("transition") > at && !c.slice(0, at).includes("transition"); }));
ok("logo : en-tête centré : même règle (la rangée naturelle, pas de hauteur forcée)", !shrink.includes("[data-header=\"centered\"]") && !shrink.includes(".site-header-bar{height:"));
ok("logo : jamais de « < » ni de point-virgule libre", ![fixed, shrink, hang].some((c) => c.includes("<")));
ok("logo : valeur invalide → feuille vide", logoCss({ size: 9999 }) === "" && logoCss({ mode: "x;}" }) === "");
ok("styles de rôle inchangés : la feuille des rôles ne porte pas le logo", !siteStylesCss({ logo: { size: 90 }, palette: { bg: "#ffffff" } }).includes("--lg"));


/* ---- Lots 84 et 106 : place verticale, position horizontale, ajustement, marges, mobile ----------------------- */
{
  // Rétrocompatibilité (lot 106) : la feuille v0.31.0 (fixture générée par le code de rel/v0310) n'est plus reproduite octet pour octet (le logo est
  // maintenant centré et jamais coupé), mais : sans réglage elle reste VIDE ; les variables de taille (prologue : --lg, --bp, --bh, --lh-top, --lh-min,
  // kit, grand écran, réduction au défilement) restent identiques à l'octet ; toute ancienne donnée est lue sans erreur.
  const legacy = JSON.parse(readFileSync(new URL("./lib/logo-css-v031.json", import.meta.url), "utf8"));
  ok("lot 106 : fixture v0.31 lue (15 réglages)", legacy.length === 15);
  const prologue = (css) => css.split("\n").slice(0, 3).join("\n");
  const shrinkRule = (css) => css.split("\n").filter((r) => r.includes("[data-scrolled]{--lh:var(--lh-min)}"));
  for (const { logo, css } of legacy) {
    const now = logoCss(logo);
    ok(`lot 106 : ancienne donnée ${JSON.stringify(logo)} lue sans erreur (schéma, forme canonique)`, LogoSchema.safeParse(logo).success && (cleanLogo(logo) === undefined) === (css === ""));
    ok(`lot 106 : ancienne donnée ${JSON.stringify(logo)} : sans réglage la feuille reste vide, sinon tailles v0.31 identiques à l'octet (prologue, réduction au défilement)`, css === "" ? now === "" : prologue(now) === prologue(css) && JSON.stringify(shrinkRule(now)) === JSON.stringify(shrinkRule(css)));
    ok(`lot 106 : ancienne donnée ${JSON.stringify(logo)} : plus de débordement ni de coupe`, css === "" || (now.includes("--lhe") && !now.includes("clip-path") && !now.includes("margin-bottom:min(0px")));
  }
  ok("lot 106 : les valeurs par défaut explicites (center, 0, gauche, contain, small, reduced) sont le rendu de base", logoCss({ size: 120, align: "center", x: 0, anchor: "left", fit: "contain", margin: "small", mobile: "reduced" }) === logoCss({ size: 120 }) && cleanLogo({ align: "center", x: 0, anchor: "left", fit: "contain", margin: "small", mobile: "reduced" }) === undefined);
  ok("lot 106 : places verticales, ancrages, ajustements, marges, mobiles", LOGO_ALIGNS.join() === "center,top,bottom,grow" && LOGO_ANCHORS.join() === "left,center,right" && LOGO_FITS.join() === "contain,cover" && LOGO_MARGINS.join() === "none,small,normal" && LOGO_MOBILES.join() === "reduced,same");
  ok("lot 106 : schéma — valeurs inconnues et hors bornes refusées", !LogoSchema.safeParse({ align: "middle" }).success && !LogoSchema.safeParse({ fit: "fill" }).success && !LogoSchema.safeParse({ margin: "huge" }).success && !LogoSchema.safeParse({ mobile: "none" }).success && !LogoSchema.safeParse({ anchor: "middle" }).success && !LogoSchema.safeParse({ x: LOGO_X_MAX + 1 }).success && !LogoSchema.safeParse({ x: LOGO_X_MIN - 1 }).success && !LogoSchema.safeParse({ x: 1.5 }).success && LogoSchema.safeParse({ x: LOGO_X_MIN, anchor: "right", align: "bottom", fit: "cover", margin: "none", mobile: "same" }).success);
  ok("lot 106 : forme canonique — center / 0 / left / contain / small / reduced jamais écrits, le reste gardé", JSON.stringify(cleanLogo({ size: 80, align: "top", x: 30, anchor: "right" })) === JSON.stringify({ size: 80, align: "top", x: 30, anchor: "right" }) && JSON.stringify(cleanLogo({ align: "grow" })) === JSON.stringify({ align: "grow" }) && JSON.stringify(cleanLogo({ x: -12 })) === JSON.stringify({ x: -12 }) && JSON.stringify(cleanLogo({ fit: "cover", margin: "none", mobile: "same", align: "bottom" })) === JSON.stringify({ align: "bottom", fit: "cover", margin: "none", mobile: "same" }) && JSON.stringify(cleanLogo({ margin: "normal" })) === JSON.stringify({ margin: "normal" }));
  const base = logoCss({ size: 120 });
  const center = logoCss({ size: 120, align: "center" });
  const top = logoCss({ size: 120, align: "top" });
  const bottom = logoCss({ size: 120, align: "bottom" });
  const grow = logoCss({ size: 120, align: "grow" });
  ok("lot 106 centré (anciennes données « center » comprises) = rendu de base : centré, entier, sans coupe", center === base && !center.includes("--ly") && !center.includes("clip-path"));
  ok("lot 106 haut / bas : même boîte, décalée (--ly) jusqu'au bord de la barre à la marge près ; aucune coupe", top.includes("--ly:calc(1*(var(--lm) + var(--lhe)/2 - var(--bar)/2))") && bottom.includes("--ly:calc(-1*(var(--lm) + var(--lhe)/2 - var(--bar)/2))") && top.includes(".site-brand{translate:0 var(--ly,0px)}") && !top.includes("clip-path") && !bottom.includes("clip-path"));
  ok("lot 106 : la barre garde sa rangée naturelle (la bande dessous ne bouge pas) en centré, haut et bas", [center, top, bottom].every((c) => c.includes(".site-header-bar{min-height:var(--bar)}")));
  ok("lot 84 « La barre s'agrandit » (lot 106 : marges) : barre = logo (réglé, pas défilé) + 2 marges (celles du thème par défaut) ; plus de débordement ; logo non plafonné", grow.includes(".site-header-bar{min-height:calc(max(var(--bh),var(--lh-top)) + 2*var(--lm))}") && grow.includes("margin-block:calc(var(--lm) - var(--bp))") && grow.includes("--lm:var(--bp)") && grow.includes("{--lhe:var(--lh)}") && !grow.includes("clip-path:inset"));
  const shrinkGrow = logoCss({ size: 120, mode: "shrink", align: "grow" });
  ok("lot 84 « La barre s'agrandit » + réduit au défilement : la barre suit la taille du haut (la page ne saute pas)", shrinkGrow.includes("[data-scrolled]{--lh:var(--lh-min)}") && shrinkGrow.includes("max(var(--bh),var(--lh-top))"));
  const cover = logoCss({ size: 60, fit: "cover" });
  ok("lot 106 : « Remplir la hauteur » : toute la hauteur de la barre, object-fit: cover, le défaut reste contain", cover.includes("{--lhe:var(--bar)}") && cover.includes("object-fit:cover") && base.includes("object-fit:contain") && !base.includes("object-fit:cover"));
  ok("lot 106 : marges — aucune, petite (défaut), normale", logoCss({ margin: "none" }).includes("--lm:0px") && base.includes("--lm:0.25rem") && logoCss({ margin: "normal" }).includes("--lm:0.75rem"));
  ok("lot 106 : mobile « Même logo » : la taille du grand écran aussi sur téléphone ; par défaut ×0,75", logoCss({ size: 60, mobile: "same" }).split("\n").some((r) => r === ":root:root:root{--lh-top:calc(var(--lg)*1px)}") && !logoCss({ size: 60 }).split("\n").some((r) => r === ":root:root:root{--lh-top:calc(var(--lg)*1px)}"));
  const moved = logoCss({ size: 60, x: 40 });
  ok("lot 84 position : décalage ×0,75 et 120 px au plus sur téléphone, entier en px sur grand écran, plafond mesuré lu", moved.includes("--lx:40") && moved.includes("clamp(-120px,calc(var(--lx)*.75px),120px)") && moved.includes("@media (min-width:48rem){:root:root:root{--lxs:calc(var(--lx)*1px)}}") && moved.includes("translate:clamp(var(--lx-lo,-1rem),calc(0px + var(--lxs)),var(--lx-hi,"));
  ok("lot 106 : position + haut : le décalage vertical s'ajoute au décalage horizontal (un seul `translate`)", logoCss({ size: 60, x: 40, align: "bottom" }).includes(") var(--ly,0px)}"));
  ok("lot 84 position : ancrage centre et droite lisent les marges mesurées", logoCss({ anchor: "center" }).includes("calc(var(--lx-mid,0px) + var(--lxs))") && logoCss({ anchor: "right", x: -10 }).includes("calc(var(--lx-hi,0px) + var(--lxs))") && logoCss({ anchor: "right", x: -10 }).includes("--lx:-10"));
  ok("lot 84 : transitions du décalage et de la place seulement sans demande de mouvement réduit", [top, bottom, moved].every((c) => { const at = c.lastIndexOf("@media (prefers-reduced-motion:no-preference)"); return at > 0 && c.indexOf("translate .5s") > at; }) && [grow, center].every((c) => c.indexOf("transition") > c.indexOf("@media (prefers-reduced-motion:no-preference)")));
  ok("lot 84 : jamais de « < » ni de valeur libre", ![center, top, grow, moved, cover].some((c) => c.includes("<")) && logoCss({ align: "x;}", x: 1 }) === "" && logoCss({ x: 99999 }) === "" && logoCss({ margin: "1px;}" }) === "");
  ok("lot 84 : protocole — site-look porte align, x, anchor, fit, margin, mobile ; valeurs hors schéma refusées", FromCanvasSchema.safeParse({ kind: "site-look", palette: {}, logo: { align: "bottom", x: 30, anchor: "center", fit: "cover", margin: "none", mobile: "same" } }).success && ToCanvasSchema.safeParse({ kind: "site-look", palette: {}, logo: { align: "grow" } }).success && !FromCanvasSchema.safeParse({ kind: "site-look", palette: {}, logo: { x: 5000 } }).success && !FromCanvasSchema.safeParse({ kind: "site-look", palette: {}, logo: { align: "autre" } }).success && !FromCanvasSchema.safeParse({ kind: "site-look", palette: {}, logo: { fit: "autre" } }).success);
  ok("lot 84 : snapshot du site porte les nouveaux champs", SiteSnapSchema.safeParse({ identity: { name: { fr: "A", en: "" }, role: { fr: "", en: "" }, email: "", credit: { fr: "", en: "" } }, nav: [], socials: [], styles: { logo: { size: 90, align: "center", x: 12, fit: "cover", margin: "normal", mobile: "same" } } }).success);
  // Retour à la v0.33.0 : sa LogoSchema est stricte, elle refuserait fit, margin, mobile et align « bottom » (voir le rapport).
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
