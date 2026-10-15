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
import { BackgroundSchema, FOND_TYPES, fondAttributes, fondColor, fondJoins, fondKey, fondStyle, readBackground, supportsFond } from "../src/themes/fond.ts";
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

const win = {};
ok("protocole : l'intention `background` passe, une nature inconnue ou un champ en trop non", (() => {
  const msg = (background) => acceptFromCanvas({ origin: "http://x", source: win, data: { type: EDIT_MSG, kind: "background", uid: "ab-1", background } }, "http://x", win);
  const good = msg({ kind: "color", color: "bg" });
  const none = msg(null);
  const bad = msg({ kind: "paper", id: 1 });
  return Boolean(good) && good.kind === "background" && Boolean(none) && bad === null;
})());

console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
