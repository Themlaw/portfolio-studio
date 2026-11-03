#!/usr/bin/env node
/**
 * « Fond & carte PARTOUT » (lot 105) : extension rétro-compatible de `props.background` (`border` + `card`), module pur, sans navigateur.
 *  - ANCIENNES DONNÉES : toutes celles de la v0.33.0 passent les schémas, se relisent à l'identique, se réécrivent à l'identique ;
 *  - NOUVELLES DONNÉES : `border` (Fin / Moyen / Épais + couleur) et `card` (le panneau intérieur) relus tels qu'écrits, idempotents ;
 *  - HÔTES SANS CARTE DE PAGE (composant de planche, case de grille, composant imbriqué) : Fond ET Carte, chacun avec ses coins et son contour ;
 *  - RETOUR ARRIÈRE : un schéma strict de la v0.33.0 refuse le bloc entier `background` écrit en v0.33.1 (le Fond est ignoré, jamais une erreur de page).
 * Usage : node --import tsx scripts/test-fondcard105.mjs   (inclus dans npm test)
 */
import { z } from "zod";

import { fondKey, readBackground } from "../src/themes/fond.ts";
import { BackgroundSchema } from "../src/themes/schema.ts";
import { FALLBACK_CARD } from "../src/themes/surface.ts";
import { freshZone, readFondCarte, setSlot, writeFondCarte } from "../src/themes/fondcarte.ts";
import { zoneWithKind } from "../src/themes/zone.ts";

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const canon = (v) => (v && typeof v === "object" ? (Array.isArray(v) ? v.map(canon) : Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))) : v);
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const D = FALLBACK_CARD;
const HOST = { canCard: false, canFond: true }; // composant de planche, case de grille, composant imbriqué
const PAIR = { canCard: true, canFond: true };

/* ---- Anciennes données (v0.33.0) : inchangées ---------------------------------------------------------------------------------- */
{
  const OLD = [
    { kind: "color", color: "primary" },
    { kind: "color", color: "primary", inset: "m", round: "l", paper: "under" },
    { kind: "wallpaper", wallpaper: 3, inset: "s" },
    { kind: "color", color: "#f6d6e4", round: "m" },
  ];
  ok("anciens fonds : tous valides", OLD.every((b) => BackgroundSchema.safeParse(b).success));
  ok("anciens fonds : relus à l'identique (aucune clé ajoutée)", OLD.every((b) => same(readBackground(b), b)));
  ok("anciens fonds : réécrits à l'identique par le menu (idempotent)", OLD.every((b) => {
    const w = writeFondCarte(readFondCarte({ background: b }, D), HOST, false);
    return same(readFondCarte({ background: w.background ?? undefined }, D), readFondCarte({ background: b }, D));
  }));
  ok("ancien fond sans `border` ni `card` : la clé de fusion d'avant", fondKey({ kind: "color", color: "primary" }, false) === "primary|page");
}

/* ---- Contour et coins du Fond ; Carte intérieure -------------------------------------------------------------------------------- */
{
  const bg = { kind: "color", color: "primary", round: "m", border: { width: "thin" }, card: { kind: "wallpaper", wallpaper: 4, inset: "l", round: "l", border: { width: "thick", color: "ink" }, paper: "under" } };
  ok("Fond + Carte intérieure (contour, coins, marge, papier) : valide", BackgroundSchema.safeParse(bg).success, JSON.stringify(BackgroundSchema.safeParse(bg).error?.issues?.[0]));
  ok("relu tel qu'écrit", same(readBackground(bg), bg));
  ok("la Carte n'est pas elle-même imbriquable (une seule couche de panneau)", !BackgroundSchema.safeParse({ ...bg, card: { ...bg.card, card: { kind: "color", color: "ink" } } }).success);
  ok("contour inconnu refusé, clé inconnue refusée", !BackgroundSchema.safeParse({ kind: "color", color: "primary", border: { width: "huge" } }).success && !BackgroundSchema.safeParse({ kind: "color", color: "primary", extra: 1 }).success);
  ok("le contour et la Carte changent la clé de fusion (pas de fusion avec un voisin différent)", fondKey(bg, false) !== fondKey({ kind: "color", color: "primary" }, false));
}

/* ---- Hôtes sans carte de page : Fond ET Carte ------------------------------------------------------------------------------------ */
{
  const kinds = [null, "color", "wallpaper"];
  const make = (slot, kind) => (kind ? zoneWithKind(freshZone(slot, HOST), kind, {}, kind === "wallpaper" ? 7 : undefined) : null);
  const bad = [];
  for (const fk of kinds) for (const ck of kinds) {
    let fc = { fond: null, carte: null };
    fc = setSlot(fc, "fond", make("fond", fk), HOST);
    if (ck || fk === null) fc = setSlot(fc, "carte", make("carte", ck), HOST);
    const w = writeFondCarte(fc, HOST);
    const back = readFondCarte({ ...(w.background ? { background: w.background } : {}) }, D);
    const kindOf = (z) => (z ? (z.kind ?? z.color ? (z.wallpaper !== undefined || z.kind === "wallpaper" ? "wallpaper" : "color") : null) : null);
    if (w.surface) bad.push(`${fk}/${ck} : une couche \`surface\` écrite sur un hôte sans carte de page`);
    if ((fk !== null) !== (back.fond !== null) || (ck !== null) !== (back.carte !== null)) bad.push(`${fk}/${ck} : lu ${kindOf(back.fond)}/${kindOf(back.carte)}`);
    if (!same(writeFondCarte(back, HOST), w)) bad.push(`${fk}/${ck} : pas idempotent`);
    if (w.background && !BackgroundSchema.safeParse(w.background).success) bad.push(`${fk}/${ck} : écriture invalide`);
  }
  ok("matrice 3 × 3 (Fond × Carte) sur un composant : lue comme écrite, valide, idempotente, une seule couche stockée", bad.length === 0, bad.slice(0, 4).join(" | "));
  const both = writeFondCarte(setSlot(setSlot({ fond: null, carte: null }, "fond", make("fond", "color"), HOST), "carte", make("carte", "color"), HOST), HOST);
  ok("Fond + Carte : stockés ensemble dans `background` (Fond dehors, `card` dedans)", both.background?.card !== undefined && both.surface === undefined || both.surface === null);
}

/* ---- Retour arrière : la v0.33.0 ignore proprement ------------------------------------------------------------------------------- */
{
  // Schéma de la v0.33.0 (clés d'avant, strict) : il refuse le bloc entier s'il voit `border` ou `card`.
  const OLD_SCHEMA = z.union([
    z.object({ kind: z.literal("color"), color: z.string(), inset: z.enum(["s", "m", "l"]).optional(), round: z.enum(["s", "m", "l"]).optional(), paper: z.enum(["under", "over"]).optional() }).strict(),
    z.object({ kind: z.literal("wallpaper"), wallpaper: z.number(), color: z.string().optional(), inset: z.enum(["s", "m", "l"]).optional(), round: z.enum(["s", "m", "l"]).optional(), paper: z.enum(["under", "over"]).optional() }).strict(),
  ]);
  ok("les anciennes données passent le schéma de la v0.33.0 (sanity)", OLD_SCHEMA.safeParse({ kind: "color", color: "primary", inset: "m" }).success);
  ok("des données du lot 105 sont refusées par la v0.33.0 : `background` ignoré, le bloc se rend sans fond (jamais d'erreur de page)", !OLD_SCHEMA.safeParse({ kind: "color", color: "primary", border: { width: "thin" } }).success && !OLD_SCHEMA.safeParse({ kind: "color", color: "primary", card: { kind: "color", color: "ink" } }).success);
}

console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
