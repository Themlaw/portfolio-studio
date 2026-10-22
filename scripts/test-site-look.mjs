#!/usr/bin/env node
/**
 * Palette et logo du site (lot 17f) : schémas bornés, forme canonique, feuilles générées sans injection,
 * nuances recalculées, contraste AA (publication), messages de la toile, rendu IDENTIQUE sans réglage
 * sur les presets (parité).
 * Usage : node --import tsx scripts/test-site-look.mjs   (inclus dans npm test)
 */
import {
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
ok("logo : trois comportements, aucun autre", LOGO_MODES.length === 3 && LOGO_MODES.every((m) => LogoSchema.safeParse({ mode: m }).success) && !LogoSchema.safeParse({ mode: "sticky" }).success);
ok("logo : clé inconnue refusée", !LogoSchema.safeParse({ size: 40, width: 3 }).success);
ok("styles du site : palette et logo acceptés", SiteStylesSchema.safeParse({ palette: { bg: "#ffffff" }, logo: { size: 80, mode: "shrink" } }).success);
ok("snapshot du site : porte la palette et le logo", SiteSnapSchema.safeParse({ identity: { name: { fr: "A", en: "" }, role: { fr: "", en: "" }, email: "", credit: { fr: "", en: "" } }, nav: [], socials: [], styles: { palette: { ink: "#101010" }, logo: { size: 64 } } }).success);

/* ---- Forme canonique (un brouillon identique au publié ne doit pas ressembler à une modification) ------ */
ok("logo : « Fixe » seul = aucun réglage", cleanLogo({ mode: "fixed" }) === undefined && cleanLogo({}) === undefined);
ok("logo : taille + Fixe → taille seule", JSON.stringify(cleanLogo({ size: 72, mode: "fixed" })) === JSON.stringify({ size: 72 }));
ok("logo : comportement gardé", cleanLogo({ mode: "overhang" })?.mode === "overhang");
ok("palette vide = aucun réglage", cleanSitePalette({}) === undefined);
ok("styles : palette et logo vides disparaissent", cleanSiteStyles({ palette: {}, logo: { mode: "fixed" } }) === undefined);
ok("styles : palette et logo gardés", JSON.stringify(cleanSiteStyles({ palette: { bg: "#ffffff" }, logo: { size: 90 } })) === JSON.stringify({ palette: { bg: "#ffffff" }, logo: { size: 90 } }));

/* ---- Feuille du logo --------------------------------------------------------------------------- */
ok("logo : aucun réglage → aucune règle (rendu du thème)", logoCss(undefined) === "" && logoCss({}) === "" && logoCss({ mode: "fixed" }) === "");
const fixed = logoCss({ size: 80 });
ok("logo fixe : taille posée sur l'en-tête", fixed.includes(":root:root:root{--lg:80") && fixed.includes(":root:root:root .site-header{--lh:var(--lh-top)}"));
ok("logo fixe : hauteur du logo et de la barre", fixed.includes(".site-signature{height:var(--lh)") && fixed.includes(".site-header-bar{height:calc("));
ok("logo : mobile proportionnel et plafonné (24–64 px)", fixed.includes("clamp(24px,calc(var(--lg)*.75px),64px)"));
ok("logo fixe : pas de réduction au défilement", !fixed.includes("[data-scrolled]"));
const shrink = logoCss({ size: 120, mode: "shrink" });
const hang = logoCss({ size: 120, mode: "overhang" });
ok("logo : --header-h suit la hauteur de l'en-tête au repos (ouverture de la page)", fixed.includes("--header-h:calc(max(var(--lh-top),2rem) + 2*var(--bp))") && hang.includes("--header-h:calc(var(--lb) + 2*var(--bp))"));
ok("logo réduit : état défilé posé par l'en-tête", shrink.includes("[data-scrolled]{--lh:var(--lh-min)}") && shrink.includes("--lh-min:max(24px,calc(var(--lh-top)*.6))"));
ok("logo réduit : marge basse compense la hauteur perdue (aucun décalage)", shrink.includes("margin-bottom:calc(max(var(--lh-top),2rem) - max(var(--lh),2rem))"));
ok("logo débordant : barre à hauteur fixe, logo aligné en haut", hang.includes("align-self:flex-start") && hang.includes(".site-header-bar{height:calc(var(--lb) + 2*var(--bp))}") && !hang.includes("[data-scrolled]"));
ok("logo : transitions seulement sans demande de mouvement réduit", [fixed, shrink, hang].every((c) => { const at = c.indexOf("@media (prefers-reduced-motion:no-preference)"); return at > 0 && c.indexOf("transition") > at && !c.slice(0, at).includes("transition"); }));
ok("logo : en-tête centré géré", shrink.includes('[data-header="centered"] .site-header-bar{height:auto}'));
ok("logo : jamais de « < » ni de point-virgule libre", ![fixed, shrink, hang].some((c) => c.includes("<")));
ok("logo : valeur invalide → feuille vide", logoCss({ size: 9999 }) === "" && logoCss({ mode: "x;}" }) === "");
ok("styles de rôle inchangés : la feuille des rôles ne porte pas le logo", !siteStylesCss({ logo: { size: 90 }, palette: { bg: "#ffffff" } }).includes("--lg"));

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
