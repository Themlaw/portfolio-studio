#!/usr/bin/env node
/**
 * Cartes de rubrique (lot 17c) : schéma strict et borné, lecture tolérante, réglages par défaut du thème,
 * variante lisible du texte (tous les presets × tous les jetons), protocole éditeur ↔ toile, texte d'aide
 * de la rubrique Texte, et rien de changé pour les thèmes livrés. Lot 19b : jetons dérivés (teintes douces de la DA :
 * calculées sur la palette, bornées, lisibles, qui suivent un changement de palette).
 * Usage : node --import tsx scripts/test-surface.mjs   (inclus dans npm test)
 */
import { readFileSync } from "node:fs";

import { acceptFromCanvas, acceptToCanvas, EDIT_MSG } from "../src/lib/edit/protocol.ts";
import { CUSTOM_COLOR_RE } from "../src/lib/color.ts";
import { helpTextProblem, titleHelpProblem, HELP_TEXT, TEXT_STARTERS } from "../src/blocks/help-text.ts";
import { resolvePalette, contrastRatio, mixOklab, opaqueOn } from "../src/themes/palette.ts";
import { ThemeSchema, SURFACE_TINTS, SURFACE_TOKENS } from "../src/themes/schema.ts";
import { cardBackground, cardStyle, cardVars, cleanSurface, FALLBACK_CARD, readSurface, resolveSurface, SURFACE_DA_NAMES, SURFACE_DA_TOKENS, SURFACE_TOKEN_LABELS, SurfaceSchema, surfaceAttributes, tintParts } from "../src/themes/surface.ts";
import { loadPreset, presetSlugs } from "./lib/presets.mjs";

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const parses = (v) => SurfaceSchema.safeParse(v).success;

/* ---- Schéma ------------------------------------------------------------------------------------------ */

ok("`{}` est une carte valide (réglages du thème)", parses({}));
ok("jetons, couleur libre, largeurs et coins valides", parses({ color: "primary", width: "full", corners: "round" }) && parses({ color: "#f6d6e4", width: "inset", corners: "square" }) && parses({ color: "#f6d6e480" }));
ok("tous les jetons sont acceptés", SURFACE_TOKENS.every((t) => parses({ color: t })), SURFACE_TOKENS.join());
ok("strict : clé inconnue refusée", !parses({ color: "bg", radius: 4 }) && !parses({ bg: "bg" }));
ok("couleur : majuscules, 3 chiffres, nom CSS, url, injection refusés", ["#F6D6E4", "#fff", "red", "url(x)", "#ffffff;}", "var(--x)", "primary ", "#12345g", "#1234567", "#12345678aa"].every((c) => !parses({ color: c })));
ok("largeur et coins : valeurs inconnues refusées", !parses({ width: "wide" }) && !parses({ corners: "pill" }) && !parses({ width: 3 }));
ok("couleur bornée (9 caractères)", !parses({ color: "#" + "a".repeat(40) }));
ok("null, tableau, chaîne : pas une carte", !parses(null) && !parses([]) && !parses("surface"));
const schemaSource = readFileSync(new URL("../src/themes/schema.ts", import.meta.url), "utf8");
const schemaRegex = /export const SurfaceSchema[\s\S]*?\.regex\(\/(.+?)\/,/.exec(schemaSource)?.[1];
ok("même format que la couleur d'un texte (CUSTOM_COLOR_RE)", schemaRegex === CUSTOM_COLOR_RE.source, `${schemaRegex} vs ${CUSTOM_COLOR_RE.source}`);

/* ---- Lecture tolérante, réglages par défaut ----------------------------------------------------------------- */

ok("readSurface : absent / illisible = pas de carte", readSurface(undefined) === undefined && readSurface(null) === undefined && readSurface("x") === undefined && readSurface([]) === undefined);
ok("readSurface : `{}` reste une carte", JSON.stringify(readSurface({})) === "{}");
ok("readSurface : un champ invalide est ignoré, les autres gardés", JSON.stringify(readSurface({ color: "rose", width: "full", corners: "x" })) === '{"width":"full"}');
ok("resolveSurface : le bloc, puis le thème, puis la carte d'origine", (() => {
  const theme = { color: "bgDeep", width: "full", corners: "square" };
  const a = resolveSurface({}, theme);
  const b = resolveSurface({ color: "ink", corners: "round" }, theme);
  const c = resolveSurface({});
  return JSON.stringify(a) === JSON.stringify(theme) && b.color === "ink" && b.width === "full" && b.corners === "round" && JSON.stringify(c) === JSON.stringify(FALLBACK_CARD);
})());
ok("cleanSurface : retire les champs vides, `{}` reste", JSON.stringify(cleanSurface({ color: undefined, width: "full" })) === '{"width":"full"}' && JSON.stringify(cleanSurface({})) === "{}");
ok("attributs de l'enveloppe", JSON.stringify(surfaceAttributes({ color: "bg", width: "inset", corners: "round" })) === '{"data-surface":"on","data-width":"inset","data-corners":"round"}');

/* ---- Thème : carte par défaut ---------------------------------------------------------------------------------- */

const slugs = presetSlugs();
const themes = await Promise.all(slugs.map(async (s) => [s, await loadPreset(s)]));
ok("8 presets livrés", themes.length === 8, String(themes.length));
ok("aucun preset livré ne porte de carte par défaut (rendu inchangé)", themes.every(([, t]) => !t.tokens.layout?.card));
const withCard = (t, card) => ThemeSchema.safeParse({ ...t, tokens: { ...t.tokens, layout: { ...t.tokens.layout, card } } });
const base = themes[0][1];
ok("thème : carte par défaut valide acceptée", withCard(base, { color: "bgDeep", width: "full", corners: "square" }).success && withCard(base, {}).success);
ok("thème : clé inconnue de la carte par défaut refusée ; couleur inconnue ignorée (lecture tolérante, repli sur le défaut)", !withCard(base, { radius: 3 }).success && withCard(base, { color: "nope" }).data?.tokens.layout?.card?.color === undefined && withCard(base, { color: "#ABCDEF" }).data?.tokens.layout?.card?.color === undefined);

/* ---- Lisibilité : tous les presets × tous les jetons ----------------------------------------------------------- */

const AA = 4.5;
const bad = [];
let warned = 0;
for (const [slug, raw] of themes) {
  const t = ThemeSchema.parse(raw);
  const p = resolvePalette(t.tokens.color, t.tokens.palette);
  for (const token of SURFACE_TOKENS) {
    const s = cardStyle(token, p);
    const bgOf = opaqueOn(cardBackground(token, p), p.bg);
    const shown = contrastRatio(s.ink, bgOf);
    if (Math.abs(shown - s.ratio) > 0.01) bad.push(`${slug}/${token}: ratio annoncé ${s.ratio.toFixed(2)} ≠ ${shown.toFixed(2)}`);
    if (s.ok !== s.ratio >= AA) bad.push(`${slug}/${token}: ok incohérent`);
    if (!s.ok) warned++;
    // Tout ce qui se pose sur la carte se lit : texte secondaire, liens, étiquettes.
    for (const [name, c] of [["inkSoft", s.inkSoft], ["link", s.link], ["eyebrow", s.eyebrow], ["accent", s.accent]]) {
      if (s.ok && contrastRatio(c, bgOf) < AA) bad.push(`${slug}/${token}: ${name} ${c} ${contrastRatio(c, bgOf).toFixed(2)}`);
    }
    if (s.btnBg === s.btnFg) bad.push(`${slug}/${token}: bouton invisible`);
  }
  // Les fonds du thème (texte et fonds AA par construction) sont toujours lisibles.
  for (const token of ["bg", "bgDeep", "surface", "ink"]) if (!cardStyle(token, p).ok) bad.push(`${slug}/${token}: illisible`);
  // « Action » : le texte des boutons du thème se lit dessus.
  if (!cardStyle("primary", p).ok) bad.push(`${slug}/primary: illisible`);
  // Teintes douces (12 % et 25 % de la couleur dans le fond de page) : le texte du thème s'y lit toujours.
  for (const token of SURFACE_TINTS) if (!cardStyle(token, p).ok) bad.push(`${slug}/${token}: teinte illisible`);
}
ok("presets × jetons : texte, texte secondaire, liens et étiquettes lisibles (AA) dans chaque carte", bad.length === 0, bad.slice(0, 4).join(" | "));
console.log(`      (${warned} couple(s) preset × jeton sous AA : signalés dans l'éditeur, jamais bloquants)`);

const p0 = resolvePalette(ThemeSchema.parse(base).tokens.color, ThemeSchema.parse(base).tokens.palette);
const dark = cardStyle("#101820", p0);
const light = cardStyle("#fdf6ec", p0);
ok("couleur libre sombre : texte clair ; claire : texte sombre", contrastRatio(dark.ink, "#101820") >= AA && contrastRatio(light.ink, "#fdf6ec") >= AA && dark.ink !== light.ink, `${dark.ink} / ${light.ink}`);
const mid = cardStyle("#8a8a8a", p0);
ok("teinte moyenne : aucun texte du thème ne passe AA, signalé", !mid.ok && mid.ratio < AA, mid.ratio.toFixed(2));
ok("couleur libre translucide : lue sur le fond du thème", cardStyle("#00000010", p0).ok);
const vars = cardVars(dark);
ok("variables de la carte : toutes présentes, aucune vide", ["--card-bg", "--card-ink", "--card-ink-soft", "--card-line", "--card-link", "--card-link-hover", "--card-eyebrow", "--card-accent", "--card-btn-bg", "--card-btn-fg", "--card-btn-hover"].every((k) => vars[k]));
ok("variables : rien d'injectable (pas de ; { } < >)", Object.values(vars).every((v) => !/[;{}<>]/.test(v)));

/* ---- Jetons dérivés : teintes douces de la DA (lot 19b) ------------------------------------------------------------ */

ok("jetons : 6 couleurs de la DA nommées + 8 teintes (4 couleurs × 12 % et 25 %), liste bornée", SURFACE_DA_TOKENS.length === 6 && SURFACE_TINTS.length === 8 && SURFACE_TOKENS.length === 15, String(SURFACE_TOKENS.length));
ok("jetons : chaque jeton a un libellé en clair, les teintes disent leur couleur et leur force", SURFACE_TOKENS.every((t) => typeof SURFACE_TOKEN_LABELS[t] === "string" && SURFACE_TOKEN_LABELS[t].length > 0) && SURFACE_TOKEN_LABELS.primary12 === "Boutons et liens, teinte 12 %" && SURFACE_TOKEN_LABELS.tertiary25 === "Ornements, teinte 25 %");
ok("jetons : les noms de la DA sont ceux du panneau « Couleurs »", SURFACE_DA_NAMES.bg === "Fond de page" && SURFACE_DA_NAMES.surface === "Cartes et encadrés" && SURFACE_DA_NAMES.primary === "Boutons et liens" && SURFACE_DA_NAMES.secondary === "Accent" && SURFACE_DA_NAMES.tertiary === "Ornements" && SURFACE_DA_NAMES.ink === "Texte");
ok("jetons : tintParts lit la couleur et le pourcentage", JSON.stringify(tintParts("secondary25")) === '{"base":"secondary","percent":25}' && tintParts("ink12").percent === 12);
ok("schéma : un jeton de teinte est accepté, une teinte inventée refusée (pas de hex figé, pas de pourcentage libre)", parses({ color: "primary12" }) && parses({ color: "ink25" }) && !parses({ color: "primary13" }) && !parses({ color: "bg12" }) && !parses({ color: "primary-soft" }) && !parses({ color: "accent12" }));
{
  const win = { name: "toile" };
  ok("schéma : les nouveaux jetons passent le protocole éditeur ↔ toile", acceptFromCanvas({ origin: "https://portfolio.example", source: win, data: { type: EDIT_MSG, kind: "surface", uid: "b1", surface: { color: "secondary12" } } }, "https://portfolio.example", win)?.kind === "surface");
}
{
  const t0 = ThemeSchema.parse(base);
  const pal = resolvePalette(t0.tokens.color, t0.tokens.palette);
  const soft = cardBackground("primary12", pal);
  const tint = cardBackground("primary25", pal);
  ok("teinte douce : la couleur mélangée au fond de page (12 % puis 25 %)", soft === mixOklab(pal.bg, pal.primary, 0.12) && tint === mixOklab(pal.bg, pal.primary, 0.25));
  ok("teinte douce : de plus en plus proche de la couleur, jamais plus qu'elle", contrastRatio(soft, pal.bg) <= contrastRatio(tint, pal.bg) && contrastRatio(tint, pal.bg) <= contrastRatio(pal.primary, pal.bg));
  ok("jeton de base : la couleur de la palette, couleur libre inchangée", cardBackground("tertiary", pal) === pal.tertiary && cardBackground("#aabbcc", pal) === "#aabbcc");
  // Suivre un changement de palette : le MÊME jeton donne une autre couleur quand la palette change (jamais figé).
  const changed = resolvePalette({ ...t0.tokens.color, primary: "#7a1f10", bg: "#fbf3e3" }, t0.tokens.palette);
  ok("teinte douce : suit un changement de palette (même jeton, autre couleur)", cardBackground("primary12", changed) !== soft && cardBackground("primary12", changed) === mixOklab(changed.bg, changed.primary, 0.12));
  ok("teinte douce : stockée en jeton, jamais en hex (la carte garde `primary12`)", resolveSurface({ color: "primary12" }).color === "primary12" && JSON.stringify(readSurface({ color: "primary12" })) === '{"color":"primary12"}');
  // Ornements translucides (transparence acceptée) : la teinte se lit sur le fond de page, jamais sur du noir.
  const translucent = { ...pal, tertiary: "rgba(0, 0, 0, 0.5)" };
  const tt = cardBackground("tertiary12", translucent);
  ok("teinte d'une couleur translucide : lue sur le fond de page", tt === mixOklab(translucent.bg, opaqueOn("rgba(0, 0, 0, 0.5)", translucent.bg), 0.12));
}

/* ---- Protocole ---------------------------------------------------------------------------------------------- */

const ORIGIN = "https://portfolio.example";
const frame = { name: "toile" };
const msg = (data) => ({ origin: ORIGIN, source: frame, data: { type: EDIT_MSG, ...data } });
const from = (data) => acceptFromCanvas(msg(data), ORIGIN, frame);
ok("protocole : intention `surface` acceptée (carte, `{}`, retrait)", from({ kind: "surface", uid: "b1", surface: { color: "#aabbcc", width: "full" } })?.kind === "surface" && from({ kind: "surface", uid: "b1", surface: {} })?.kind === "surface" && from({ kind: "surface", uid: "b1", surface: null })?.kind === "surface");
ok("protocole : `surface` invalide refusée (couleur, clé, uid)", ["rose", "#ABC", 3].every((c) => from({ kind: "surface", uid: "b1", surface: { color: c } }) === null) && from({ kind: "surface", uid: "b1", surface: { x: 1 } }) === null && from({ kind: "surface", uid: "B 1", surface: {} }) === null && from({ kind: "surface", uid: "b1" }) === null);
ok("protocole : seq conservé sur `surface`", acceptFromCanvas({ origin: ORIGIN, source: frame, data: { type: EDIT_MSG, kind: "surface", uid: "b1", surface: {}, seq: 7 } }, ORIGIN, frame)?.seq === 7);
ok("protocole : `insert` (choix, texte, titre, titre + texte) accepté", ["choose", "text", "title", "title-text"].every((what) => from({ kind: "insert", parent: null, index: 3, what })?.kind === "insert") && from({ kind: "insert", parent: "g1", index: 0, what: "text" })?.parent === "g1");
ok("protocole : `insert` invalide refusé", from({ kind: "insert", parent: null, index: -1, what: "text" }) === null && from({ kind: "insert", parent: null, index: 1, what: "image" }) === null && from({ kind: "insert", parent: "x y", index: 1, what: "text" }) === null && from({ kind: "insert", index: 1, what: "text" }) === null);
ok("protocole : `field-op` (titre / étiquette ajoutés ou retirés) accepté", ["add-title", "remove-title", "add-eyebrow", "remove-eyebrow"].every((op) => from({ kind: "field-op", uid: "b1", op })?.kind === "field-op"));
ok("protocole : `field-op` invalide refusé", from({ kind: "field-op", uid: "b1", op: "add-intro" }) === null && from({ kind: "field-op", uid: "x y", op: "add-title" }) === null && from({ kind: "field-op", op: "add-title" }) === null);
const to = (data) => acceptToCanvas(msg(data), ORIGIN, frame);
ok("protocole : `edit-text` vers la toile (chemin borné)", to({ kind: "edit-text", uid: "b2", path: "paragraphs.0" })?.kind === "edit-text" && to({ kind: "edit-text", uid: "b2", path: "title" })?.kind === "edit-text" && to({ kind: "edit-text", uid: "b2", path: "__proto__.x" }) === null && to({ kind: "edit-text", uid: "b2", path: "a".repeat(81) }) === null);

/* ---- Texte d'aide ---------------------------------------------------------------------------------------------- */

ok("rubriques de texte : trois choix, « Texte » sans titre, « Titre » = bloc Titre sans présentation, « Titre + texte » complet", TEXT_STARTERS.text.block === "rich-text" && !("title" in TEXT_STARTERS.text.props) && TEXT_STARTERS.title.block === "section-title" && TEXT_STARTERS.title.props.title === HELP_TEXT.title && !("intro" in TEXT_STARTERS.title.props) && !("paragraphs" in TEXT_STARTERS.title.props) && TEXT_STARTERS["title-text"].block === "rich-text" && TEXT_STARTERS["title-text"].props.title === HELP_TEXT.title && Object.keys(TEXT_STARTERS).join() === "text,title,title-text");
ok("rubriques de texte : champ édité d'emblée", TEXT_STARTERS.text.edit === "paragraphs.0" && TEXT_STARTERS.title.edit === "title" && TEXT_STARTERS["title-text"].edit === "title");
ok("un Titre dont le titre est resté le texte d'aide : publication refusée ; titre remplacé, vide ou lié au projet : rien à signaler", titleHelpProblem({ title: HELP_TEXT.title }) !== null && titleHelpProblem({ title: { fr: "Bonjour", en: HELP_TEXT.title.en } }) !== null && titleHelpProblem({ title: { fr: "Bonjour", en: "" } }) === null && titleHelpProblem({ title: { fr: "", en: "" } }) === null && titleHelpProblem({ title: HELP_TEXT.title, linked: true }) === null);
ok("texte d'aide resté tel quel : publication refusée (paragraphe ou titre, dans l'une ou l'autre langue)", helpTextProblem({ paragraphs: [HELP_TEXT.paragraph] }) !== null && helpTextProblem({ title: HELP_TEXT.title, paragraphs: [{ fr: "Bonjour", en: "" }] }) !== null && helpTextProblem({ paragraphs: [{ fr: "Bonjour", en: HELP_TEXT.paragraph.en }] }) !== null);
ok("texte remplacé ou vide : rien à signaler", helpTextProblem({ paragraphs: [{ fr: "Bonjour", en: "Hello" }] }) === null && helpTextProblem({ title: { fr: "", en: "" }, paragraphs: [{ fr: "", en: "" }] }) === null && helpTextProblem({}) === null);

/* ---- Bloc Texte (lot 19a) : un champ n'existe que s'il a été demandé -------------------------------------------- */

try {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createElement } = await import("react");
  const RichText = (await import("../src/blocks/RichTextBlock.tsx")).default;
  const SectionTitle = (await import("../src/blocks/SectionTitleBlock.tsx")).default;
  const Rich = RichText.default ?? RichText;
  const Title = SectionTitle.default ?? SectionTitle;
  const L = (fr, en = "") => ({ fr, en });
  const html = (props, edit = false) => renderToStaticMarkup(createElement(Rich, { props, ctx: { locale: "fr", pageId: 1, edit } }));
  // Rendu public d'un bloc avec titre : identique à celui de la v0.17 (HTML mesuré avant le lot 19a).
  const TITLED =
    '<section class="shell pt-[var(--section-gap)]"><div class="max-w-2xl"><p class="eyebrow ">E</p><h2 class="mt-4 font-display text-[clamp(2rem,5vw,3.5rem)] text-ink">T</h2><div class="mt-6 space-y-6 text-base leading-relaxed text-ink-soft"><p>P1</p><p>P2</p></div></div></section>';
  ok("Texte : rendu public d'un bloc avec titre et étiquette inchangé (au caractère près)", html({ eyebrow: L("E"), title: L("T"), paragraphs: [L("P1"), L("P2")] }) === TITLED);
  const alone = html({ paragraphs: [L("P")] });
  ok("Texte seul (public) : ni titre, ni étiquette, aucune marge réservée au-dessus du paragraphe", !/<h2|eyebrow|mt-6|mt-4/.test(alone) && /<p>P<\/p>/.test(alone), alone);
  ok("Texte à titre vide (ancien défaut) : public identique à un Texte seul", html({ title: L("", ""), paragraphs: [L("P")] }) === alone);
  const edit = html({ paragraphs: [L("P")] }, true);
  ok("Texte seul (toile) : aucun champ de titre ni texte gris « Titre » ; « + Ajouter un titre » proposé", !/<h2|data-inline="title"|data-placeholder="Titre"|data-inline="eyebrow"/.test(edit) && /data-edit-field-op="add-title"/.test(edit), edit);
  const editTitled = html({ title: L("T"), paragraphs: [L("P")] }, true);
  ok("Texte avec titre (toile) : champ saisissable, « Retirer le titre » proposé, pas de « Ajouter »", /data-inline="title"/.test(editTitled) && /data-edit-field-op="remove-title"/.test(editTitled) && !/add-title/.test(editTitled));
  ok("Texte : aucun bouton ni repère d'édition en public", !/data-edit-field-op|pe-field/.test(html({ title: L("T"), paragraphs: [L("P")] })) && !/data-edit-field-op|pe-field/.test(alone));
  const title = async (props, edit = false) => renderToStaticMarkup(await Title({ props, ctx: { locale: "fr", pageId: 1, edit } }));
  const titleEdit = await title({ title: L("T") }, true);
  ok("Titre seul (toile) : pas de champ « Présentation » ni d'étiquette grise ; « + Ajouter une étiquette » proposé", !/data-inline="intro"|data-inline="eyebrow"|Présentation/.test(titleEdit) && /data-edit-field-op="add-eyebrow"/.test(titleEdit), titleEdit);
  const titlePublic = await title({ title: L("T") });
  ok("Titre seul (public) : le titre, rien d'autre (ni étiquette vide, ni présentation vide)", /<h2[^>]*>T<\/h2>/.test(titlePublic) && !/eyebrow|<p/.test(titlePublic), titlePublic);
  ok("Titre avec étiquette et présentation (anciens blocs) : champs conservés sur la toile", /data-inline="eyebrow"/.test(await title({ eyebrow: L(""), title: L("T"), intro: L("") }, true)) && /data-inline="intro"/.test(await title({ eyebrow: L(""), title: L("T"), intro: L("") }, true)));
} catch (e) {
  ok("blocs Texte et Titre rendables par Node", false, String(e).slice(0, 300));
}

/* ---- Blocs : `surface` au registre (illisible = ignoré, jamais le bloc masqué) ------------------------------------ */

try {
  const { BLOCKS } = await import("../src/blocks/registry.ts");
  const schema = BLOCKS["rich-text"].schema;
  const withSurface = (surface) => schema.safeParse({ paragraphs: [{ fr: "a", en: "b" }], surface });
  ok("registre : `surface` valide conservée sur un bloc", withSurface({ color: "ink", width: "full" }).data?.surface?.color === "ink");
  ok("registre : `surface` illisible ignorée, le bloc reste valide", withSurface({ color: "rose" }).success && withSurface({ color: "rose" }).data.surface === undefined && withSurface("x").success);
  ok("registre : tous les blocs acceptent `surface`", Object.values(BLOCKS).every((b) => !(b.schema.def?.shape) || "surface" in b.schema.def.shape));
  ok("registre : la publication du texte d'aide est refusée par le bloc Texte", BLOCKS["rich-text"].publishCheck?.({ paragraphs: [HELP_TEXT.paragraph] }, {}) !== null);
} catch (e) {
  ok("registre des blocs chargeable par Node", false, String(e).slice(0, 200));
}

/* ---- Carte par défaut du thème : lecture tolérante (v0.18.1) ----------------------------------------------- */
{
  const base = await loadPreset(presetSlugs()[0]);
  const withCard = (card) => ThemeSchema.safeParse({ ...base, tokens: { ...base.tokens, layout: { ...(base.tokens.layout ?? {}), card } } });
  const bad = withCard({ color: "nouvelleteinte99", width: "inset", corners: "round" });
  ok("un jeton de carte inconnu (venu d'une version suivante) ne fait pas rejeter le thème", bad.success, bad.success ? "" : JSON.stringify(bad.error.issues).slice(0, 200));
  ok("… il retombe sur la valeur par défaut (color absente), le reste est gardé", bad.success && bad.data.tokens.layout?.card?.color === undefined && bad.data.tokens.layout?.card?.width === "inset" && bad.data.tokens.layout?.card?.corners === "round");
  ok("un jeton connu et une couleur libre restent lus tels quels", withCard({ color: "primary12" }).data?.tokens.layout?.card?.color === "primary12" && withCard({ color: "#f6d6e4" }).data?.tokens.layout?.card?.color === "#f6d6e4");
  ok("un champ inconnu de la carte reste refusé (schéma strict)", !withCard({ colour: "bg" }).success);
}

console.log(failures ? `test-surface : ${failures} échec(s)` : "test-surface : OK");
process.exit(failures ? 1 : 0);
