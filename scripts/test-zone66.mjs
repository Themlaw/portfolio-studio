#!/usr/bin/env node
/**
 * Fond unique (lot 66, « Surface » commune) : modèle `Zone` (src/themes/zone.ts) sur les deux couches stockées (`surface`, `background`).
 *  - ANTI-PERTE DE DONNÉES : toute carte et tout fond lisibles sortent de `readZone` puis `zoneToStored` strictement identiques (aucun
 *    champ perdu, ajouté ou réordonné), y compris la carte ET le fond emboîté d'un même bloc ;
 *  - R5 : changer de nature ne remplace jamais un choix (mémoire), « Couleur » cache le papier du site, jamais de motif choisi à la place de l'artiste ;
 *  - R6 : l'opacité d'un motif descend à 0 ; `paper: "under"` d'un fond est accepté, et sépare la fusion des voisins ;
 *  - protocole : l'intention `fond` (deux couches) et `page-settings` passent le schéma, une couche illisible est refusée.
 * Usage : node --import tsx scripts/test-zone66.mjs   (inclus dans npm test)
 */
import { acceptFromCanvas, EDIT_MSG } from "../src/lib/edit/protocol.ts";
import { BackgroundSchema, fondAttributes, fondKey, readBackground } from "../src/themes/fond.ts";
import { WALLPAPER_OPACITY_MIN } from "../src/themes/schema.ts";
import { readSurface, resolvePaper, resolveSurface } from "../src/themes/surface.ts";
import { readZone, zoneExtent, zoneInLayer, zoneKind, zoneToBackground, zoneToStored, zoneToSurface, zoneWithKind } from "../src/themes/zone.ts";

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
// Égalité profonde, sans tenir compte de l'ordre des clés (le schéma zod ordonne les champs à sa façon).
const canon = (v) => (v && typeof v === "object" ? (Array.isArray(v) ? v.map(canon) : Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))) : v);
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

/* ---- Anti-perte : aller-retour sans aucune différence ---------------------------------------------------------------------- */

const colors = [undefined, "surface", "bgDeep", "primary12", "ink", "#aa5500", "#aa550080"];
const cards = [];
for (const color of colors)
  for (const width of [undefined, "full", "inset"])
    for (const corners of [undefined, "square", "round", "s", "m", "l"])
      for (const border of [undefined, false, {}, { width: "thick" }, { width: "thin", color: "primary" }])
        for (const wp of [undefined, { paperWallpaper: 3 }, { paperWallpaper: 3, paperSize: 120, paperOpacity: 0.3 }, { paperWallpaper: 4, paper: "under" }, { paperOpacity: 0.2 }, { paper: "over", paperOpacity: 0.5 }, { paper: "under" }, { paperOpacity: 0 }])
          cards.push({ ...(color ? { color } : {}), ...(width ? { width } : {}), ...(corners ? { corners } : {}), ...(border !== undefined ? { border } : {}), ...(wp ?? {}) });
let bad = 0;
let lastBad = "";
for (const c of cards) {
  const s = readSurface(c);
  if (!s) continue;
  const { zone, inner } = readZone({ surface: s });
  const out = zoneToStored(zone, { surface: s });
  if (!same(out.surface, s) || out.background !== null || inner !== null) {
    bad++;
    lastBad = JSON.stringify([c, out.surface]);
  }
}
ok(`aller-retour : ${cards.length} cartes (couleur, largeur, coins, bordure, papier, papier peint, opacité 0) ressortent à l'identique`, bad === 0, `${bad} écarts, dernier : ${lastBad}`);

const fonds = [];
for (const color of colors.filter(Boolean))
  for (const inset of [undefined, "s", "m", "l"])
    for (const round of [undefined, "s", "m", "l"])
      for (const paper of [undefined, "under"]) {
        fonds.push({ kind: "color", color, ...(inset ? { inset } : {}), ...(round ? { round } : {}), ...(paper ? { paper } : {}) });
        for (const wp of [{ wallpaper: 2 }, { wallpaper: 2, size: 90, opacity: 0.5 }, { wallpaper: 2, opacity: 0 }, { wallpaper: 7, size: 24 }])
          fonds.push({ kind: "wallpaper", ...wp, color, ...(inset ? { inset } : {}), ...(round ? { round } : {}), ...(paper ? { paper } : {}) });
      }
for (const inset of [undefined, "m"]) fonds.push({ kind: "wallpaper", wallpaper: 5, ...(inset ? { inset } : {}) });
bad = 0;
lastBad = "";
for (const f of fonds) {
  const b = readBackground(f);
  if (!b) {
    bad++;
    lastBad = "illisible " + JSON.stringify(f);
    continue;
  }
  const { zone, inner } = readZone({ background: b });
  const out = zoneToStored(zone, { background: b });
  if (!same(out.background, b) || out.surface !== null || inner !== null) {
    bad++;
    lastBad = JSON.stringify([f, out.background]);
  }
}
ok(`aller-retour : ${fonds.length} fonds (couleur, motif, marge, coins, papier, opacité 0) ressortent à l'identique`, bad === 0, `${bad} écarts, dernier : ${lastBad}`);

// Un bloc qui porte une carte ET un fond (rendu emboîté d'avant) : les deux couches sont gardées, chacune réglable sans toucher l'autre.
const card = { color: "primary12", width: "inset", corners: "m", border: { width: "thin" } };
const fond = { kind: "wallpaper", wallpaper: 2, color: "bgDeep", size: 80, round: "s", inset: "s" };
const both = readZone({ surface: card, background: fond });
ok("carte + fond emboîté : la zone est la carte, le fond est la couche emboîtée", both.zone?.layer === "card" && both.inner?.layer === "fond");
const w1 = zoneToStored({ ...both.zone, color: "ink" }, { surface: card, background: fond });
ok("… régler la carte ne touche pas le fond emboîté", same(w1.background, fond) && w1.surface.color === "ink" && same({ ...w1.surface, color: "primary12" }, readSurface(card)));
const w2 = zoneToStored({ ...both.inner, size: 120 }, { surface: card, background: fond });
ok("… régler le fond emboîté ne touche pas la carte", same(w2.surface, card) && w2.background.size === 120);
ok("« Aucun » (zone null) retire les deux couches", same(zoneToStored(null, { surface: card, background: fond }), { surface: null, background: null }));
ok("illisible : une carte ou un fond illisibles ne donnent pas de zone (jamais une exception)", readZone({ surface: 12, background: { kind: "x" } }).zone === null && readZone({}).zone === null);

/* ---- R5 : changer de nature ne remplace jamais un choix --------------------------------------------------------------------- */

const wpFond = zoneToStored.length && readZone({ background: { kind: "wallpaper", wallpaper: 9, size: 150, opacity: 0.4, color: "primary" } }).zone;
const toColor = zoneWithKind(wpFond, "color", { wallpaper: { id: 9, size: 150, opacity: 0.4 } });
ok("Papier peint → Couleur : la couleur d'avant est gardée, le motif part, le papier du site est caché", zoneKind(toColor) === "color" && toColor.color === "primary" && toColor.wallpaper === undefined && toColor.paper === "under", JSON.stringify(toColor));
const back = zoneWithKind(toColor, "wallpaper", { wallpaper: { id: 9, size: 150, opacity: 0.4 }, color: "primary" }, 9);
ok("… puis Couleur → Papier peint : le MÊME motif revient avec sa taille et son opacité (jamais un autre)", back.wallpaper === 9 && back.size === 150 && back.opacity === 0.4 && back.color === "primary", JSON.stringify(back));
const none = zoneWithKind(toColor, "wallpaper", {});
ok("Papier peint sans motif choisi avant : rien n'est choisi à la place de l'artiste (zone inchangée)", same(none, toColor));
const fresh = zoneWithKind({ layer: "fond", extent: "full" }, "color", {});
ok("Couleur sur une zone neuve : la couleur de carte du thème (lot 100 : plus « bgDeep »), papier du site caché", fresh.color === "surface" && fresh.paper === "under" && same(zoneToBackground(fresh), { kind: "color", color: "surface", paper: "under" }));
const cardWp = zoneWithKind({ layer: "card", extent: "inset", paper: "under" }, "wallpaper", {}, 4);
ok("Papier peint sur une carte : le papier « sous la carte » (qui cacherait le motif) est retiré", cardWp.wallpaper === 4 && cardWp.paper === undefined && zoneToSurface(cardWp).paperWallpaper === 4);
const sw = readSurface({ color: "surface" });
ok("Couleur sur une carte : « sous la carte » (le papier du site n'est pas redessiné)", resolvePaper(zoneToSurface(zoneWithKind(readZone({ surface: sw }).zone, "color", {})), { onCards: true, opacity: 0.35 }).over === false);
ok("Couleur sans réglage : le papier du site reste visible sur une carte (rendu d'avant gardé tant que l'artiste ne choisit rien)", resolvePaper(sw, { onCards: true, opacity: 0.35 }).over === true);

/* ---- Étendue, couches ----------------------------------------------------------------------------------------------------------- */

const theme = resolveSurface({});
ok("étendue : une carte sans réglage suit celle du thème ; un fond est « pleine largeur » sans marge", zoneExtent({ layer: "card" }, theme) === "inset" && zoneExtent({ layer: "card" }, { ...theme, width: "full" }) === "full" && zoneExtent({ layer: "fond", extent: "full" }) === "full" && zoneExtent({ layer: "fond", extent: "inset", margin: "l" }) === "inset");
const conv = zoneInLayer({ layer: "fond", extent: "inset", margin: "l", color: "ink", corners: "m" }, "card");
ok("fond → carte (pour la bordure) : couleur, étendue et coins gardés", conv.layer === "card" && conv.color === "ink" && conv.extent === "inset" && conv.corners === "m" && conv.margin === undefined);

/* ---- R6 et papier du fond ----------------------------------------------------------------------------------------------------- */

ok("R6 : l'opacité d'un motif peut valoir 0 (et reste bornée à 1)", WALLPAPER_OPACITY_MIN === 0 && BackgroundSchema.safeParse({ kind: "wallpaper", wallpaper: 1, opacity: 0 }).success && !BackgroundSchema.safeParse({ kind: "wallpaper", wallpaper: 1, opacity: -0.01 }).success && !BackgroundSchema.safeParse({ kind: "wallpaper", wallpaper: 1, opacity: 1.01 }).success);
ok("fond : `paper: \"under\"` accepté (couleur et motif), toute autre valeur refusée", BackgroundSchema.safeParse({ kind: "color", color: "bg", paper: "under" }).success && BackgroundSchema.safeParse({ kind: "wallpaper", wallpaper: 1, paper: "under" }).success && !BackgroundSchema.safeParse({ kind: "color", color: "bg", paper: "over" }).success);
ok("fond : `data-paper=\"under\"` posé sur l'enveloppe (look.css n'y redessine pas le papier du site) ; absent sinon", fondAttributes({ prev: false, next: false }, { kind: "color", color: "bg", paper: "under" })["data-paper"] === "under" && !("data-paper" in fondAttributes({ prev: false, next: false }, { kind: "color", color: "bg" })));
ok("fusion : deux fonds de même couleur dont l'un cache le papier du site ne fusionnent pas (rendus différents)", fondKey({ kind: "color", color: "bg", paper: "under" }, false) !== fondKey({ kind: "color", color: "bg" }, false) && fondKey({ kind: "color", color: "bg", paper: "under" }, false) === fondKey({ kind: "color", color: "bg", paper: "under" }, false));

/* ---- Protocole ------------------------------------------------------------------------------------------------------------------- */

const accept = (msg) => acceptFromCanvas({ origin: "http://x", source: "frame", data: { type: EDIT_MSG, seq: 1, ...msg } }, "http://x", "frame");
ok("protocole : `fond` (carte + fond d'un coup, ou null) accepté", Boolean(accept({ kind: "fond", uid: "ab12", surface: { color: "surface" }, background: { kind: "color", color: "bg", paper: "under" } })) && Boolean(accept({ kind: "fond", uid: "ab12", surface: null, background: null })));
ok("protocole : `fond` avec une couche illisible, ou sans l'une des deux clés, est refusé", !accept({ kind: "fond", uid: "ab12", surface: { color: "nope" }, background: null }) && !accept({ kind: "fond", uid: "ab12", surface: null }));
ok("protocole : `page-settings` (« Régler » le papier peint de la page) accepté ; une cible inconnue refusée", Boolean(accept({ kind: "page-settings", focus: "wallpaper" })) && Boolean(accept({ kind: "page-settings" })) && !accept({ kind: "page-settings", focus: "autre" }));

console.log(failures ? `\n${failures} échec(s)` : "\nOK");
process.exit(failures ? 1 : 0);
