#!/usr/bin/env node
/**
 * « Fond & carte » (lot 100) : modèle des deux sections (src/themes/fondcarte.ts) sur les deux couches stockées. Module pur, sans navigateur.
 *  - LECTURE : tout ancien réglage (carte pleine / en retrait, fond bord à bord / avec marge, carte ET fond emboîtés) se range dans la bonne section ;
 *  - ÉCRITURE : bloc à deux couches (Fond dehors = `surface` pleine largeur, Carte dedans = `background` avec marge) ; une seule section = sa couche gardée ;
 *    une seule couche (planche) = les sections s'excluent ; les données écrites relisent exactement ce qu'on a écrit, et passent les schémas de v0.31 ;
 *  - MATRICE : (Fond aucun / couleur / papier) × (Carte aucune / couleur / papier) × (deux couches / fond seul / carte seule) ;
 *  - R9 : aucune couleur imposée : le premier « Couleur » ne prend jamais « bgDeep » (le jaune de certains thèmes) ; jamais deux fois la même section ;
 *  - R9b : régler la Carte garde le Fond, et inversement.
 * Usage : node --import tsx scripts/test-fondcarte100.mjs   (inclus dans npm test)
 */
import { readBackground } from "../src/themes/fond.ts";
import { aroundColor, freshZone, isPair, readFondCarte, setSlot, writeFondCarte } from "../src/themes/fondcarte.ts";
import { FALLBACK_CARD, readSurface } from "../src/themes/surface.ts";
import { FIRST_COLOR, zoneKind, zoneWithKind } from "../src/themes/zone.ts";

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const canon = (v) => (v && typeof v === "object" ? (Array.isArray(v) ? v.map(canon) : Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))) : v);
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const D = FALLBACK_CARD;
const PAIR = { canCard: true, canFond: true };
const BG_ONLY = { canCard: false, canFond: true };
const CARD_ONLY = { canCard: true, canFond: false };
const stored = (w) => ({ ...(w.surface ? { surface: w.surface } : {}), ...(w.background ? { background: w.background } : {}) });

/* ---- Lecture des anciens réglages ---------------------------------------------------------------------------------------------- */
{
  const r = (s, d = D) => readFondCarte(s, d);
  ok("lecture : rien = deux sections vides", r({}).fond === null && r({}).carte === null);
  ok("lecture : ancienne carte en retrait = section Carte", r({ surface: { color: "primary12", width: "inset" } }).carte?.layer === "card" && r({ surface: { color: "primary12", width: "inset" } }).fond === null);
  ok("lecture : ancienne carte pleine largeur = section Fond", r({ surface: { color: "ink", width: "full" } }).fond?.layer === "card" && r({ surface: { color: "ink", width: "full" } }).carte === null);
  ok("lecture : carte sans largeur = celle du thème (en retrait par défaut)", r({ surface: { color: "ink" } }).carte !== null && r({ surface: { color: "ink" } }, { ...D, width: "full" }).fond !== null);
  ok("lecture : ancien fond bord à bord = section Fond", r({ background: { kind: "color", color: "primary" } }).fond?.layer === "fond");
  ok("lecture : ancien fond avec marge = section Carte", r({ background: { kind: "color", color: "primary", inset: "m" } }).carte?.layer === "fond");
  const echo = r({ surface: { color: "surface", width: "inset" }, background: { kind: "color", color: "bgDeep" } });
  ok("lecture : carte en retrait ET fond emboîté (ancien « Echo ») : Carte = la carte, Fond = le fond", echo.carte?.layer === "card" && echo.fond?.layer === "fond");
  const both = r({ surface: { color: "ink", width: "full" }, background: { kind: "wallpaper", wallpaper: 3, inset: "l" } });
  ok("lecture : fond pleine largeur dehors + fond avec marge dedans : Fond = dehors, Carte = dedans", both.fond?.layer === "card" && both.carte?.layer === "fond");
  ok("lecture : un papier peint est lu comme tel", zoneKind(r({ background: { kind: "wallpaper", wallpaper: 7 } }).fond) === "wallpaper");
}

/* ---- Écriture : couches ---------------------------------------------------------------------------------------------------------- */
{
  const fond = { layer: "card", extent: "full", color: "#112233" };
  const carte = { layer: "card", extent: "inset", color: "#445566" };
  const w = writeFondCarte({ fond, carte }, PAIR);
  ok("écriture, deux couches : Fond = `surface` pleine largeur dehors", w.surface?.width === "full" && w.surface?.color === "#112233", JSON.stringify(w));
  ok("écriture, deux couches : Carte = `background` avec marge dedans (couleur gardée)", w.background?.inset === "m" && w.background?.kind === "color" && w.background?.color === "#445566", JSON.stringify(w));
  const back = readFondCarte(stored(w), D);
  ok("écriture : relue, chaque section retrouve sa couleur", back.fond?.color === "#112233" && back.carte?.color === "#445566" && aroundColor(back) === "#112233");
  ok("écriture : idempotente (écrire ce qu'on vient de lire ne change rien)", same(writeFondCarte(back, PAIR), w));
  const only = writeFondCarte({ fond: null, carte }, PAIR);
  ok("écriture, Carte seule : elle garde sa couche (carte en retrait, comme avant)", only.surface?.width === "inset" && only.background === null, JSON.stringify(only));
  const onlyF = writeFondCarte({ fond: { layer: "fond", extent: "full", color: "#112233" }, carte: null }, PAIR);
  ok("écriture, Fond seul, ancien bord à bord : il garde sa couche `background`", onlyF.background?.kind === "color" && !onlyF.background.inset && onlyF.surface === null);
  ok("écriture : tout vide = les deux couches retirées", writeFondCarte({ fond: null, carte: null }, PAIR).surface === null && writeFondCarte({ fond: null, carte: null }, PAIR).background === null);
  const bg = writeFondCarte({ fond: null, carte: freshZone("carte", BG_ONLY) }, BG_ONLY);
  ok("une seule couche (planche) : la Carte est un fond avec marge M", bg.background?.inset === "m" && bg.surface === null, JSON.stringify(bg));
  const cd = writeFondCarte({ fond: freshZone("fond", CARD_ONLY), carte: null }, CARD_ONLY);
  ok("une seule couche (carte seule) : le Fond est une carte pleine largeur", cd.surface?.width === "full" && cd.background === null, JSON.stringify(cd));
  const ex = setSlot({ fond: { layer: "fond", extent: "full", color: "#112233" }, carte: null }, "carte", { layer: "fond", extent: "inset", margin: "m", color: "#445566" }, BG_ONLY);
  ok("composant sans carte de page (planche, case, imbriqué) : choisir la Carte GARDE le Fond (lot 105 : Fond et Carte partout)", ex.fond !== null && ex.carte !== null);
  const ex2 = setSlot({ fond: { layer: "card", extent: "full" }, carte: { layer: "fond", extent: "inset" } }, "carte", null, PAIR);
  ok("deux couches : vider la Carte garde le Fond (R9b)", ex2.fond !== null && ex2.carte === null);
  const ex3 = setSlot({ fond: { layer: "card", extent: "full" }, carte: { layer: "fond", extent: "inset" } }, "fond", null, PAIR);
  ok("deux couches : vider le Fond garde la Carte (R9b)", ex3.carte !== null && ex3.fond === null);
  // Un ancien « Echo » (carte en retrait + fond emboîté) passe en ordre normal à la première écriture, sans rien perdre d'autre.
  const echo = readFondCarte({ surface: { color: "surface", width: "inset", corners: "m" }, background: { kind: "color", color: "bgDeep" } }, D);
  const echoW = writeFondCarte(echo, PAIR);
  const echoKeep = writeFondCarte(echo, PAIR, false);
  ok("ancien Echo RÉGLÉ (pas ajouté) : chaque section garde sa couche, rien n'est déplacé ni perdu", echoKeep.surface?.width === "inset" && echoKeep.surface?.corners === "m" && echoKeep.background?.color === "bgDeep" && !echoKeep.background?.inset, JSON.stringify(echoKeep));
  ok("ancien Echo : relu après écriture = comme avant (idempotent)", same(writeFondCarte(readFondCarte(stored(echoKeep), D), PAIR, false), echoKeep));
  ok("ancien Echo ajouté-normalisé : le fond est dehors (pleine largeur), la carte dedans (marge, coins gardés)", echoW.surface?.width === "full" && echoW.surface?.color === "bgDeep" && echoW.background?.inset === "m" && echoW.background?.round === "m", JSON.stringify(echoW));
}

/* ---- Matrice : (Fond × Carte) × couches ------------------------------------------------------------------------------------------ */
{
  const KINDS = [null, "color", "wallpaper"];
  const make = (slot, kind, caps) => {
    if (!kind) return null;
    const z0 = freshZone(slot, caps);
    return zoneWithKind(z0, kind, {}, kind === "wallpaper" ? 5 : undefined);
  };
  let n = 0;
  let bad = [];
  for (const [name, caps] of [["deux couches", PAIR], ["fond seul", BG_ONLY], ["carte seule", CARD_ONLY]]) {
    for (const fk of KINDS) {
      for (const ck of KINDS) {
        n++;
        let fc = { fond: null, carte: null };
        fc = setSlot(fc, "fond", make("fond", fk, caps), caps);
        if (ck || fk === null) fc = setSlot(fc, "carte", make("carte", ck, caps), caps);
        const w = writeFondCarte(fc, caps);
        const s = stored(w);
        const back = readFondCarte(s, D);
        const wantF = caps.canFond ? fk : ck ? null : fk;
        const wantC = isPair(caps) ? ck : ck;
        const schemaOk = (!w.surface || readSurface(w.surface)) && (!w.background || readBackground(w.background));
        const kindOf = (z) => (z ? zoneKind(z) : null);
        const exp = `${wantF}/${wantC}`;
        const got = `${kindOf(back.fond)}/${kindOf(back.carte)}`;
        if (exp !== got || !schemaOk) bad.push(`${name} ${fk}/${ck} : attendu ${exp}, lu ${got}`);
        // Les données écrites ne contiennent aucune couleur imposée « bgDeep ».
        if (JSON.stringify(w).includes("bgDeep")) bad.push(`${name} ${fk}/${ck} : bgDeep imposé`);
        if (!same(writeFondCarte(back, caps), w)) bad.push(`${name} ${fk}/${ck} : pas idempotent`);
      }
    }
  }
  ok(`matrice : ${n} combinaisons (Fond × Carte × couches) : lues comme écrites, valides, idempotentes, sans bgDeep`, bad.length === 0, bad.slice(0, 4).join(" | "));
}

/* ---- R9 : aucune couleur imposée ------------------------------------------------------------------------------------------------- */
{
  ok("le premier « Couleur » n'est plus « bgDeep » (jaune vif sur certains thèmes)", FIRST_COLOR !== "bgDeep" && FIRST_COLOR === "surface");
  const bad = [];
  for (const caps of [PAIR, BG_ONLY, CARD_ONLY]) for (const slot of ["fond", "carte"]) {
    const z = zoneWithKind(freshZone(slot, caps), "color", {});
    const w = writeFondCarte({ fond: slot === "fond" ? z : null, carte: slot === "carte" ? z : null }, caps);
    if (JSON.stringify(w).includes("bgDeep")) bad.push(`${slot}`);
  }
  ok("aucune section neuve ne s'écrit avec « bgDeep »", bad.length === 0, bad.join(","));
  ok("sans Fond, rien n'entoure la carte (c'est le fond de la page)", aroundColor({ fond: null, carte: { layer: "card", extent: "inset" } }) === undefined);
}

console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
