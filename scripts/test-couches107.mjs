#!/usr/bin/env node
/**
 * Couches (lot 107) : module pur, sans navigateur.
 *  - le bloc réel (surface = carte à contour, background = papier peint en retrait « l ») : chaque réglage du menu « Fond & carte » n'écrit que sa
 *    couche et sa clé, le retrait du fond n'est jamais perdu ni imposé, et la carte ne reçoit pas de largeur qu'elle n'avait pas ;
 *  - « Aucun » sur une section laisse l'autre couche telle quelle ;
 *  - réglages de mise en page (`look`) : `width`, `marginTop`, `marginBottom`, `spaceSides` facultatifs, anciennes données relues à l'identique ;
 *  - attributs de rendu (`data-ps`) seulement pour un côté réglé.
 * Usage : node --import tsx scripts/test-couches107.mjs   (inclus dans npm test)
 */
import { readLook, lookAttributes, cleanLook, LookSchema, spaceStyle, outerStyle } from "../src/lib/look.ts";
import { FALLBACK_CARD, resolveSurface } from "../src/themes/surface.ts";
import { freshZone, readLayout, setSlot, writeFondCarte } from "../src/themes/fondcarte.ts";

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const canon = (v) => (v && typeof v === "object" ? (Array.isArray(v) ? v.map(canon) : Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]))) : v);
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const PAIR = { canCard: true, canFond: true };
const PANEL = { canCard: false, canFond: true };
// Carte du thème : en retrait (le cas réel) ou pleine largeur.
const INSET = resolveSurface({ width: "inset" });
const FULL = resolveSurface({ width: "full" });

const REAL = { surface: { color: "#dbff91", corners: "m", border: { width: "medium", color: "#fd6593" }, paper: "under" }, background: { kind: "wallpaper", wallpaper: 1, color: "primary12", inset: "l" } };

/** Applique un réglage à une section comme le menu (réglage d'une section déjà là, rien d'ajouté). */
function apply(stored, defaults, caps, slot, patch) {
  const { fc, outer } = readLayout(stored, defaults);
  const z = fc[slot];
  const w = writeFondCarte(setSlot(fc, slot, { ...z, ...patch }, caps), caps, false, outer ?? undefined);
  return { ...(w.surface ? { surface: w.surface } : {}), ...(w.background ? { background: w.background } : {}) };
}
function diff(a, b) {
  const fl = (o, p = "", out = {}) => {
    for (const [k, v] of Object.entries(o ?? {})) (v && typeof v === "object" ? fl(v, `${p}${k}.`, out) : (out[`${p}${k}`] = JSON.stringify(v)));
    return out;
  };
  const x = fl(a), y = fl(b);
  return [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((k) => x[k] !== y[k]);
}

for (const [name, D] of [["carte du thème en retrait", INSET], ["carte du thème pleine", FULL]]) {
  const { fc, outer } = readLayout(REAL, D);
  ok(`[${name}] les deux couches sont lues, une dehors`, fc.fond && fc.carte && outer !== null);
  // Une section pour chaque couche : on cherche celle qui porte la couche « card » (surface) et celle du fond.
  const slotOf = (layer) => (fc.fond.layer === layer ? "fond" : "carte");
  const sCard = slotOf("card"), sFond = slotOf("fond");
  const cases = [
    ["couleur de la carte", sCard, { color: "secondary" }, ["surface.color"]],
    ["coins de la carte", sCard, { corners: "l" }, ["surface.corners"]],
    ["contour de la carte", sCard, { border: { width: "thick" } }, ["surface.border.width", "surface.border.color"]],
    ["papier de la carte", sCard, { paper: "over" }, ["surface.paper"]],
    ["couleur sous le papier peint", sFond, { color: "secondary" }, ["background.color"]],
    ["coins du fond", sFond, { corners: "l" }, ["background.round"]],
    ["contour du fond", sFond, { border: { width: "thin", color: "#fd6593" } }, ["background.border.width", "background.border.color"]],
    ["marge du fond", sFond, { margin: "s" }, ["background.inset"]],
    ["papier du fond", sFond, { paper: "under" }, ["background.paper"]],
  ];
  for (const [label, slot, patch, allowed] of cases) {
    const out = apply(REAL, D, PAIR, slot, patch);
    const d = diff(REAL, out);
    ok(`[${name}] ${label} : seule sa clé change (${d.join(",") || "rien"})`, d.length > 0 && d.every((k) => allowed.includes(k)), d.join(","));
    ok(`[${name}] ${label} : les deux couches et le retrait du fond sont gardés`, Boolean(out.surface) && Boolean(out.background) && (label === "marge du fond" || out.background.inset === "l") && out.surface.width === undefined);
  }
  // Aucun sur une section : l'autre couche est identique.
  for (const slot of ["fond", "carte"]) {
    const { fc: f0, outer: o0 } = readLayout(REAL, D);
    const w = writeFondCarte(setSlot(f0, slot, null, PAIR), PAIR, false, o0 ?? undefined);
    const goneLayer = f0[slot].layer === "card" ? "surface" : "background";
    const keep = goneLayer === "surface" ? "background" : "surface";
    ok(`[${name}] « Aucun » sur ${slot} : l'autre couche (${keep}) est intacte, l'une disparaît`, same(w[keep], REAL[keep]) && w[goneLayer] === null);
  }
  // Rien n'est réécrit à la lecture seule.
  const w0 = writeFondCarte(readLayout(REAL, D).fc, PAIR, false, readLayout(REAL, D).outer ?? undefined);
  ok(`[${name}] relire puis réécrire sans réglage rend les données à l'identique`, same({ surface: w0.surface, background: w0.background }, REAL));
}

// Variantes : retrait s / m, couleur au lieu de papier.
for (const inset of ["s", "m", "l"]) for (const bg of [{ kind: "color", color: "primary12" }, { kind: "wallpaper", wallpaper: 2 }]) {
  const stored = { surface: REAL.surface, background: { ...bg, inset } };
  const slotFond = readLayout(stored, INSET).fc.fond.layer === "fond" ? "fond" : "carte";
  const out = apply(stored, INSET, PAIR, slotFond, { corners: "m" });
  ok(`variante ${bg.kind}/${inset} : régler les coins du fond garde le retrait et la carte`, out.background.inset === inset && out.background.round === "m" && same(out.surface, stored.surface));
}

// Hôte sans carte de rubrique (panneau `background.card`) : un panneau lu comme Carte dedans est réécrit tel quel.
{
  const stored = { background: { kind: "color", color: "primary", card: { kind: "color", color: "secondary", inset: "l" } } };
  const { fc, outer } = readLayout(stored, INSET);
  const w = writeFondCarte(setSlot(fc, "carte", { ...fc.carte, corners: "m" }, PANEL), PANEL, false, outer ?? undefined);
  ok("panneau : régler les coins de la carte n'écrit que `card.round`, marge « l » gardée, fond extérieur intact", w.background.card.round === "m" && w.background.card.inset === "l" && w.background.color === "primary" && w.background.inset === undefined);
}

// Réglages de mise en page.
{
  const OLD = [{ spaceTop: "m" }, { spaceBottom: "xl", radius: "soft" }, { titleH: "center" }, {}];
  ok("anciens `look` : relus à l'identique", OLD.every((l) => same(readLook(l) ?? {}, l)));
  ok("anciens `look` : aucun attribut nouveau", OLD.every((l) => { const a = lookAttributes(readLook(l)) ?? {}; return !("data-ps" in a); }));
  const N = { width: "medium", marginTop: "l", marginBottom: "none", spaceSides: "m", spaceTop: "s" };
  ok("nouveaux `look` : valides, relus et nettoyés à l'identique", LookSchema.safeParse(N).success && same(cleanLook(readLook(N)), N));
  ok("`width` inconnue refusée", !LookSchema.safeParse({ width: "huge" }).success && !LookSchema.safeParse({ spaceSides: "xl" }).success);
  ok("`spaceSides` donne `data-ps`, `width` et les marges n'en donnent pas (enveloppe extérieure)", lookAttributes(readLook({ spaceSides: "m" }))?.["data-ps"] === "m" && lookAttributes(readLook({ width: "wide", marginTop: "s" })) === null);
  // Lot 108 : valeurs numériques facultatives (curseurs aimantés), les noms restent lus à l'identique.
  const NUM = { width: 64, marginTop: 20, marginBottom: 0, spaceTop: 45, spaceBottom: 7, spaceSides: 33 };
  ok("108 : valeurs numériques valides, relues et nettoyées à l'identique", LookSchema.safeParse(NUM).success && same(cleanLook(readLook(NUM)), NUM));
  ok("108 : bornes (largeur 30..99, espaces 0..240, côtés 0..160, entiers)", !LookSchema.safeParse({ width: 100 }).success && !LookSchema.safeParse({ width: 29 }).success && !LookSchema.safeParse({ spaceTop: 241 }).success && !LookSchema.safeParse({ spaceTop: -1 }).success && !LookSchema.safeParse({ spaceSides: 161 }).success && !LookSchema.safeParse({ marginTop: 1.5 }).success);
  ok("108 : un nom et un nombre cohabitent, 0 px est un réglage (pas absent)", same(readLook({ spaceTop: "m", spaceBottom: 0 }), { spaceTop: "m", spaceBottom: 0 }));
  ok("108 : lecture tolérante d'une clé numérique invalide, les autres gardées", same(readLook({ spaceTop: 999, spaceBottom: "l" }), { spaceBottom: "l" }));
  const a = lookAttributes(readLook({ spaceTop: 45, spaceBottom: "l", spaceSides: 33 })) ?? {};
  ok("108 : attributs n pour un nombre, le nom sinon", a["data-pt"] === "n" && a["data-pb"] === "l" && a["data-ps"] === "n");
  const st = spaceStyle(readLook({ spaceTop: 45, spaceSides: 33 })), os = outerStyle(readLook({ width: 64, marginTop: 20 }));
  ok("108 : variables CSS des nombres (dedans / dehors)", st["--kn-pt"] === "45px" && st["--kn-ps"] === "33px" && !("--kn-pb" in st) && os["--kn-w"] === "64%" && os["--kn-mt"] === "20px");
  ok("108 : aucun style pour des noms seuls", spaceStyle(readLook({ spaceTop: "m" })) === undefined && outerStyle(readLook({ width: "wide" })) === undefined);
  // Lot 108 : l'ordre est celui de la pose. Carte d'abord puis Fond : la Carte reste dehors, le Fond se pose dedans en retrait ; Fond d'abord puis Carte : ordre du lot 100.
  {
    const card = { surface: { color: "secondary", corners: "m", border: { width: "medium", color: "primary" }, paper: "under" } };
    const { fc } = readLayout(card, INSET);
    const added = setSlot(fc, "fond", freshZone("fond", PAIR), PAIR);
    const w = writeFondCarte(added, PAIR, true, undefined, "carte");
    ok("108 : un Fond ajouté à une Carte se pose DEDANS, la Carte reste dehors telle quelle", same(w.surface, card.surface) && w.background?.inset === "m", JSON.stringify(w));
    const fondOnly = { background: { kind: "color", color: "primary12" } };
    const r2 = readLayout(fondOnly, INSET);
    const w2 = writeFondCarte(setSlot(r2.fc, "carte", freshZone("carte", PAIR), PAIR), PAIR, true, undefined, "fond");
    ok("108 : une Carte ajoutée à un Fond reste dedans (ordre du lot 100 inchangé)", w2.surface?.width === "full" && w2.background?.inset === "m", JSON.stringify(w2));
    const again = readLayout({ ...(w.surface ? { surface: w.surface } : {}), ...(w.background ? { background: w.background } : {}) }, INSET);
    ok("108 : relue, la structure a deux sections, la Carte dehors", again.outer === "carte" && again.fc.fond && again.fc.carte);
  }
}

console.log(failures ? `\n${failures} ÉCHEC(S)` : "\nTout passe");
process.exit(failures ? 1 : 0);
