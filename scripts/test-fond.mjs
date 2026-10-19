#!/usr/bin/env node
/**
 * Fond de couleur d'un composant (lot 32) : schéma de `props.background` (union par `kind`, strict, borné), lecture tolérante,
 * grands composants concernés, fusion des composants consécutifs, couleurs lisibles (tous les presets), protocole éditeur ↔ toile,
 * schéma commun des blocs du registre.
 * Usage : node --import tsx scripts/test-fond.mjs   (inclus dans npm test)
 */
import { acceptFromCanvas, EDIT_MSG } from "../src/lib/edit/protocol.ts";
import { BLOCKS } from "../src/blocks/registry.ts";
import { resolvePalette } from "../src/themes/palette.ts";
import { SURFACE_TOKENS } from "../src/themes/schema.ts";
import { BackgroundSchema, FOND_TYPES, fondAround, fondAttributes, fondColor, fondInset, fondJoins, fondRound, fondKey, fondStyle, readBackground, supportsFond } from "../src/themes/fond.ts";
import { cardBorderSignature, cardStyle, resolveSurface } from "../src/themes/surface.ts";
import { loadPreset, presetSlugs } from "./lib/presets.mjs";

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const parses = (v) => BackgroundSchema.safeParse(v).success;

ok("fond : couleur par jeton ou #rrggbb[aa] valide", parses({ kind: "color", color: "primary" }) && parses({ kind: "color", color: "bgDeep" }) && parses({ kind: "color", color: "#f6d6e4" }) && parses({ kind: "color", color: "#f6d6e480" }) && SURFACE_TOKENS.every((t) => parses({ kind: "color", color: t })));
ok("fond : nature inconnue, couleur manquante ou invalide, clé inconnue refusées", !parses({ kind: "paper" }) && !parses({ kind: "color" }) && !parses({ color: "bg" }) && !parses({ kind: "color", color: "red" }) && !parses({ kind: "color", color: "#FFF" }) && !parses({ kind: "color", color: "bg", extra: 1 }) && !parses(null) && !parses("bg") && !parses([]));
ok("readBackground : illisible = aucun fond (jamais une erreur)", readBackground(undefined) === undefined && readBackground({ kind: "color", color: "nope" }) === undefined && readBackground([]) === undefined && fondColor(readBackground({ kind: "color", color: "ink" })) === "ink");

ok("grands composants : Grille, Image, Vidéo, Texte, Titre, Planche, Lien vers une page… ; pas l'Ouverture ni les anciens types", ["grid", "image", "video-single", "rich-text", "section-title", "project-board", "page-link"].every(supportsFond) && !supportsFond("hero") && !supportsFond("featured-project") && !supportsFond("collection-intro") && !supportsFond("video"));
ok("tous les types listés existent et ne sont pas retirés de la palette", FOND_TYPES.every((t) => BLOCKS[t] && !BLOCKS[t].deprecated), FOND_TYPES.filter((t) => !BLOCKS[t] || BLOCKS[t].deprecated).join());

ok("registre : `background` fait partie du schéma de chaque bloc, invalide = ignoré sans masquer le bloc", (() => {
  const d = BLOCKS["rich-text"];
  const base = { paragraphs: [{ fr: "a", en: "a" }] };
  const good = d.schema.safeParse({ ...base, background: { kind: "color", color: "primary" } });
  const bad = d.schema.safeParse({ ...base, background: { kind: "color", color: "zzz" } });
  return good.success && good.data.background?.color === "primary" && bad.success && bad.data.background === undefined;
})());

ok("fusion : clés égales et non nulles voisines", (() => {
  const a = fondKey({ kind: "color", color: "primary" }, false);
  const b = fondKey({ kind: "color", color: "ink" }, false);
  const j = fondJoins([a, a, a, b, null, b, null]);
  return JSON.stringify(j.map((x) => [x.prev, x.next])) === JSON.stringify([[false, true], [true, true], [true, false], [false, false], [false, false], [false, false], [false, false]]);
})());
ok("fusion : sans fond, jamais ; une carte et la page ne fusionnent pas", fondKey(undefined, false) === null && fondJoins([null, null]).every((x) => !x.prev && !x.next) && fondKey({ kind: "color", color: "ink" }, true) !== fondKey({ kind: "color", color: "ink" }, false) && fondKey({ kind: "color", color: "ink" }, true) === fondKey({ kind: "color", color: "ink" }, true));
ok("fusion : une couleur libre identique fusionne", (() => {
  const k = fondKey({ kind: "color", color: "#aabbcc" }, false);
  return fondJoins([k, k])[0].next && !fondJoins([k, fondKey({ kind: "color", color: "#aabbcd" }, false)])[0].next;
})());
ok("attributs : aucun voisin = data-fond seul ; voisins = data-join-prev / next", JSON.stringify(fondAttributes({ prev: false, next: false })) === '{"data-fond":"on"}' && JSON.stringify(fondAttributes({ prev: true, next: true })) === '{"data-fond":"on","data-join-prev":"","data-join-next":""}');

const BT = Object.fromEntries(await Promise.all(presetSlugs().map(async (slug) => [slug, await loadPreset(slug)])));
ok("lisibilité : tous les presets × tous les jetons, un texte est choisi et les variables --card-* sont posées", presetSlugs().every((slug) => {
  const t = BT[slug];
  const palette = resolvePalette(t.tokens.color, t.tokens.palette);
  return SURFACE_TOKENS.every((tok) => {
    const f = fondStyle({ kind: "color", color: tok }, palette);
    return f.vars["--card-bg"] === f.style.bg && Boolean(f.vars["--card-ink"]) && f.style.ratio > 1;
  });
}));

ok("fusion : deux cartes de bordures différentes (ou l'une sans bordure) ne fusionnent pas ; bordure égale : oui", (() => {
  const bg = { kind: "color", color: "ink" };
  const k = (border) => fondKey(bg, true, border);
  return fondJoins([k("medium/#111"), k("")])[0].next === false && fondJoins([k("medium/#111"), k("thick/#111")])[0].next === false && fondJoins([k("medium/#111"), k("medium/#111")])[0].next === true && fondKey(bg, false, "medium/#111") === fondKey(bg, false);
})());
ok("signature de bordure : vide sans bordure, largeur + couleur calculée sinon", (() => {
  const t = BT[presetSlugs()[0]];
  const p = resolvePalette(t.tokens.color, t.tokens.palette);
  const style = cardStyle("surface", p);
  const none = cardBorderSignature(resolveSurface({}), style, p);
  const some = cardBorderSignature(resolveSurface({ border: { width: "thick" } }), style, p);
  const colored = cardBorderSignature(resolveSurface({ border: { width: "thick", color: "primary" } }), style, p);
  return none === "" && some.startsWith("thick/") && colored.startsWith("thick/") && some !== colored;
})());

const win = {};
ok("protocole : l'intention `background` passe, une nature inconnue ou un champ en trop non", (() => {
  const msg = (background) => acceptFromCanvas({ origin: "http://x", source: win, data: { type: EDIT_MSG, kind: "background", uid: "ab-1", background } }, "http://x", win);
  const good = msg({ kind: "color", color: "bg" });
  const none = msg(null);
  const bad = msg({ kind: "paper", id: 1 });
  return Boolean(good) && good.kind === "background" && Boolean(none) && bad === null;
})());

/* ---- Marge et coins (lot 43) ---- */
ok("marge / coins : S, M, L acceptés sur couleur ET papier peint, le reste refusé, absent = comportement d'avant", parses({ kind: "color", color: "primary", inset: "m", round: "l" }) && parses({ kind: "wallpaper", wallpaper: 3, inset: "s" }) && !parses({ kind: "color", color: "primary", inset: "xl" }) && !parses({ kind: "color", color: "primary", round: 8 }) && parses({ kind: "color", color: "primary" }));
ok("marge / coins : lecture tolérante (valeur illisible = ni fond ni erreur) et accesseurs", (() => {
  const bg = readBackground({ kind: "color", color: "primary", inset: "m", round: "s" });
  return fondInset(bg) === "m" && fondRound(bg) === "s" && readBackground({ kind: "color", color: "primary", inset: "zz" }) === undefined && fondRound(readBackground({ kind: "color", color: "primary", round: "m" })) === undefined && fondInset(undefined) === undefined;
})());
ok("marge : un fond avec marge ne fusionne jamais ; sans marge, la clé d'avant est inchangée (coins seuls sans effet)", (() => {
  const plain = { kind: "color", color: "primary" };
  const inset = { kind: "color", color: "primary", inset: "m" };
  return fondKey(inset, false) === null && fondKey({ ...plain, round: "m" }, false) === fondKey(plain, false) && fondKey(plain, false) === "primary|page" && fondJoins([fondKey(inset, false), fondKey(inset, false)]).every((j) => !j.prev && !j.next);
})());
ok("couleur autour : celle du voisin bord à bord (avant, sinon après) ; jamais celle d'un voisin à marge ; rien sans marge", (() => {
  const green = { kind: "color", color: "primary" };
  const beige = { kind: "color", color: "bgDeep", inset: "m" };
  const other = { kind: "color", color: "ink" };
  const wpNoColor = { kind: "wallpaper", wallpaper: 1 };
  return fondAround([green, beige], 1) === "primary" && fondAround([beige, other], 0) === "ink" && fondAround([green, beige, other], 1) === "primary" && fondAround([beige, beige], 0) === undefined && fondAround([green, beige], 0) === undefined && fondAround([undefined, beige, undefined], 1) === undefined && fondAround([wpNoColor, beige], 1) === undefined && fondAround([beige], 0) === undefined;
})());
ok("fondJoins avec les fonds : `around` seulement sur les composants à marge", (() => {
  const bgs = [{ kind: "color", color: "primary" }, { kind: "color", color: "bgDeep", inset: "s" }];
  const j = fondJoins(bgs.map((b) => fondKey(b, false)), bgs);
  return j[0].around === undefined && j[1].around === "primary" && fondJoins([null, null])[0].around === undefined;
})());
ok("attributs et variables : data-fond-inset / data-fond-round posés seulement avec marge ; --fond-around calculé sur la palette", (() => {
  const t = BT[presetSlugs()[0]];
  const p = resolvePalette(t.tokens.color, t.tokens.palette);
  const none = fondAttributes({ prev: false, next: false }, { kind: "color", color: "primary" });
  const roundOnly = fondAttributes({ prev: false, next: false }, { kind: "color", color: "primary", round: "m" });
  const both = fondAttributes({ prev: false, next: false }, { kind: "color", color: "primary", inset: "l", round: "s" });
  const withAround = fondStyle({ kind: "color", color: "bgDeep", inset: "m" }, p, undefined, "primary").vars;
  const noInset = fondStyle({ kind: "color", color: "bgDeep" }, p, undefined, "primary").vars;
  return !("data-fond-inset" in none) && !("data-fond-round" in roundOnly) && both["data-fond-inset"] === "l" && both["data-fond-round"] === "s" && typeof withAround["--fond-around"] === "string" && withAround["--fond-around"] === cardStyle("primary", p).bg && !("--fond-around" in noInset);
})());

console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
