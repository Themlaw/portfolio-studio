#!/usr/bin/env node
/**
 * Lot 131 « Étapes » (bloc `steps` : comparer / étapes / tourner) : tests UNITAIRES (sans serveur), données synthétiques.
 *  S  Schéma : modes, 8 images au plus, anciennes données sans le bloc inchangées, valeurs illisibles refusées.
 *  R  Registre : type, groupe, références de médias (usages, sauvegarde), textes en place, fond, journal, condition de publication.
 *  P  Fonctions pures (src/blocks/etapes.ts) : position du curseur, index d'un glisser, clavier.
 *  V  Rendu (EtapesView) : repli lisible sans JS, ARIA, aucun script ni repère d'édition en public, pas de rotation automatique.
 *  C  CSS et sécurité : clip-path, prefers-reduced-motion, import dans globals.css, ni eval ni HTML injecté.
 * Usage : node --import tsx scripts/test-etapes131.mjs   (inclus dans npm test)
 */
import { readFileSync, existsSync } from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const T = (s) => ({ fr: s, en: s });
const load = async (p) => {
  try {
    return await import(p);
  } catch (e) {
    ok(`module ${p} chargé`, false, String(e.message).split("\n")[0]);
    return null;
  }
};
const E = await load("../src/blocks/etapes.ts");
const V = await load("../src/blocks/EtapesView.tsx");
const { BLOCKS } = await import("../src/blocks/registry.ts");
const { extractRefs, mediaUsageIndex } = await import("../src/blocks/refs.ts");
const { TEXT_PATH_RE } = await import("../src/lib/look.ts");
const { supportsFond } = await import("../src/themes/fond.ts");
const { groupEntries } = await import("../src/blocks/groups.ts");
const def = BLOCKS.steps;

/* ---- S. schéma ---- */
ok("S1 le type `steps` est au registre", Boolean(def));
if (def) {
  const item = (n) => ({ media: n, label: T(`Étape ${n}`) });
  const s = (p) => def.schema.safeParse(p);
  ok("S2 trois modes lus", ["compare", "steps", "turn"].every((m) => s({ mode: m, items: [item(1), item(2)] }).success));
  ok("S3 mode inconnu refusé", !s({ mode: "spirale", items: [item(1), item(2)] }).success);
  ok("S4 8 images au plus", s({ mode: "steps", items: Array.from({ length: 8 }, (_, i) => item(i + 1)) }).success && !s({ mode: "steps", items: Array.from({ length: 9 }, (_, i) => item(i + 1)) }).success);
  ok("S5 média non entier ou négatif refusé", !s({ items: [{ media: -1 }] }).success && !s({ items: [{ media: "a" }] }).success && !s({ items: [{ media: 1.5 }] }).success);
  ok("S6 sans réglage : valide (mode `compare` par défaut dans les helpers)", s({ items: [] }).success && (!E || E.stepsMode({}) === "compare"));
  ok("S7 vue et format lus, vue inconnue refusée", s({ mode: "steps", view: "scroll", ratio: "3:2", items: [item(1)] }).success && !s({ view: "cube", items: [] }).success);
  ok("S8 `look`, `surface`, `background` acceptés (ajoutés par le registre)", s({ items: [], look: { text: {} }, surface: undefined }).success);
  ok("S9 position de départ 0 à 100 seulement", s({ start: 30, items: [] }).success && !s({ start: 101, items: [] }).success && !s({ start: -1, items: [] }).success);
  ok("S10 légende trop longue refusée", !s({ items: [{ media: 1, label: { fr: "x".repeat(300), en: "" } }] }).success);
}

/* ---- R. registre ---- */
if (def) {
  ok("R1 groupe « media », libellé et description", def.group === "media" && /tapes/.test(def.label) && def.description.length > 10 && typeof def.order === "number");
  ok("R2 proposé dans le panneau « Ajouter »", groupEntries(Object.values(BLOCKS).filter((b) => b.group).map((b) => ({ ...b, hidden: b.deprecated }))).some((g) => g.entries.some((e) => e.type === "steps")));
  const props = { mode: "steps", items: [{ media: 11 }, { media: 12 }, { media: 13 }] };
  ok("R3 références : chaque image est un média utilisé", JSON.stringify(extractRefs("steps", props).media) === "[11,12,13]", JSON.stringify(extractRefs("steps", props)));
  const idx = mediaUsageIndex({ slots: [], blocks: [{ id: 1, pageId: 5, type: "steps", props }] });
  ok("R4 la médiathèque sait où l'image est utilisée (blocage de suppression)", (idx.get(12) ?? []).length === 1 && idx.get(12)[0].type === "steps");
  ok("R5 références dans un bloc rangé sans `items` : aucune, sans erreur", extractRefs("steps", {}).media.length === 0 && extractRefs("steps", { items: "x" }).media.length === 0);
  ok("R6 textes en place : titre, étiquette, légende et titre de chaque étape", ["title", "eyebrow", "items.*.label", "items.*.caption"].every((p) => def.inline.includes(p)));
  ok("R7 chemins de style (Aa) acceptés", ["title", "eyebrow", "items.0.label", "items.7.caption"].every((p) => TEXT_PATH_RE.test(p)));
  ok("R8 reçoit un fond", supportsFond("steps"));
  ok("R9 le résumé nomme le mode", /\{(mode|items)\}/.test(def.summary));
  const pc = def.publishCheck;
  ok("R10 publication : comparer exige 2 images", Boolean(pc) && pc({ mode: "compare", items: [{ media: 1 }] }, {}) !== null && pc({ mode: "compare", items: [{ media: 1 }, { media: 2 }] }, {}) === null);
  ok("R11 publication : étapes et tourner exigent 2 images au moins", pc({ mode: "steps", items: [{ media: 1 }] }, {}) !== null && pc({ mode: "turn", items: [{ media: 1 }, { media: 2 }] }, {}) === null && pc({ mode: "turn", items: [] }, {}) !== null);
  ok("R12 publication : une étape sans image est refusée", pc({ mode: "steps", items: [{ media: 1 }, {}] }, {}) !== null);
  ok("R13 le brouillon incomplet reste créable (défauts valides)", def.schema.safeParse(def.defaults).success);
  ok("R14 pas de champ `look` dans les défauts ni dans le schéma propre", !("look" in def.defaults));
}
const human = readFileSync(new URL("../src/lib/journal/human.ts", import.meta.url), "utf8");
ok("R15 le journal nomme le bloc « Étapes »", /steps: "Étapes"|"steps": "Étapes"/.test(human));
ok("R16 vignette du panneau « Ajouter »", /steps:\s*\(|"steps":\s*\(/.test(readFileSync(new URL("../src/components/admin/editor/thumbs.tsx", import.meta.url), "utf8")));

/* ---- P. fonctions pures ---- */
if (E) {
  const rect = { left: 100, width: 400 };
  ok("P1 position du curseur : milieu = 50", E.comparePos(300, rect) === 50);
  ok("P2 position bornée à 0 et 100", E.comparePos(-50, rect) === 0 && E.comparePos(9999, rect) === 100);
  ok("P3 largeur nulle : 50 (pas de NaN)", E.comparePos(10, { left: 0, width: 0 }) === 50);
  ok("P4 glisser vers la gauche d'une largeur entière avance d'une vue (tourner, 6 vues)", E.turnIndex(0, -400, 400, 6, 1) === 1);
  ok("P5 glisser tourne en boucle", E.turnIndex(0, 400, 400, 6, 1) === 5 && E.turnIndex(5, -400, 400, 6, 1) === 0);
  ok("P6 un glisser de moins d'une demi-vue ne change rien", E.turnIndex(2, -30, 400, 6, 1) === 2);
  ok("P7 clavier : flèches, début, fin (sans boucle pour les étapes)", E.keyIndex("ArrowRight", 0, 4, false) === 1 && E.keyIndex("ArrowLeft", 0, 4, false) === 0 && E.keyIndex("End", 0, 4, false) === 3 && E.keyIndex("Home", 2, 4, false) === 0);
  ok("P8 clavier : boucle pour le tourner", E.keyIndex("ArrowLeft", 0, 4, true) === 3 && E.keyIndex("ArrowRight", 3, 4, true) === 0);
  ok("P9 autre touche : null", E.keyIndex("a", 1, 4, false) === null);
  ok("P10 pas de vue : index 0", E.keyIndex("ArrowRight", 0, 0, true) === 0 || E.keyIndex("ArrowRight", 0, 0, true) === null);
  ok("P11 stepsItems : borné à 8, compare = 2 premières, entrées sans média ignorées", E.stepsItems({ mode: "steps", items: Array.from({ length: 12 }, (_, i) => ({ media: i + 1 })) }).length === 8 && E.stepsItems({ mode: "compare", items: [{ media: 1 }, { media: 2 }, { media: 3 }] }).length === 2 && E.stepsItems({ items: [{}, { media: 4 }, null, "x"] }).length === 1);
  ok("P12 mode et vue : valeurs inconnues → défauts", E.stepsMode({ mode: "x" }) === "compare" && E.stepsView({ view: "x" }) === "tabs" && E.stepsView({ view: "strip" }) === "strip");
  ok("P13 départ du curseur : 50 par défaut, borné", E.compareStart({}) === 50 && E.compareStart({ start: 20 }) === 20 && E.compareStart({ start: 500 }) === 100);
}

/* ---- V. rendu ---- */
const ph = (i) => h("img", { key: i, src: `/x${i}.png`, alt: `v${i}`, className: "steps-pic" });
const items = (n, withText = true) => Array.from({ length: n }, (_, i) => ({ label: withText ? `Étape ${i + 1}` : "", caption: withText ? `Légende ${i + 1}` : "" }));
const texts = { before: "Avant", after: "Après", slider: "Comparer avant et après", prev: "Vue précédente", next: "Vue suivante", views: "Vues", steps: "Étapes" };
const render = (props) => renderToStaticMarkup(h(V.default ?? V.EtapesView, { ratio: "3:2", start: 50, texts, edit: false, ...props, pics: (props.items ?? items(2)).map((_, i) => ph(i + 1)) }));
if (V) {
  const c = render({ mode: "compare", items: items(2) });
  ok("V1 comparer : deux images, un input range accessible", (c.match(/<img /g) ?? []).length === 2 && /<input[^>]*type="range"/.test(c) && /aria-label="Comparer avant et après"/.test(c) && /min="0"/.test(c) && /max="100"/.test(c));
  ok("V2 comparer : valeur de départ 50 et variable CSS --pos", /value="50"/.test(c) && /--pos:\s*50%/.test(c));
  ok("V3 comparer : étiquettes Avant / Après visibles sans JS", c.includes("Avant") && c.includes("Après"));
  ok("V4 comparer : format commun en variable CSS", /--sr:\s*3 \/ 2/.test(c) || /--sr:3\/2/.test(c));
  ok("V5 comparer : repli sans JS = pas encore prêt (le CSS cache le curseur tant que data-ready manque)", !/data-ready/.test(c) && /data-steps-mode="compare"/.test(c));
  const t = render({ mode: "steps", view: "tabs", items: items(4) });
  ok("V6 étapes/onglets : tablist, 4 onglets, 4 panneaux TOUS dans le HTML (lisible sans JS)", /role="tablist"/.test(t) && (t.match(/role="tab"/g) ?? []).length === 4 && (t.match(/role="tabpanel"/g) ?? []).length === 4);
  ok("V7 onglets : un seul aria-selected=true, le premier ; tabindex itinérant", (t.match(/aria-selected="true"/g) ?? []).length === 1 && /tabindex="-1"/.test(t) && /aria-controls=/.test(t) && /aria-labelledby=/.test(t));
  ok("V8 légendes de chaque étape présentes", [1, 2, 3, 4].every((n) => t.includes(`Légende ${n}`) && t.includes(`Étape ${n}`)));
  const st = render({ mode: "steps", view: "strip", items: items(3) });
  ok("V9 frise : 3 figures, numérotées, sans tablist", /data-steps-view="strip"/.test(st) && (st.match(/<figure/g) ?? []).length === 3 && !/role="tablist"/.test(st));
  const sc = render({ mode: "steps", view: "scroll", items: items(3) });
  ok("V10 défilement : 3 figures empilées, vue `scroll`", /data-steps-view="scroll"/.test(sc) && (sc.match(/<figure/g) ?? []).length === 3);
  const tu = render({ mode: "turn", items: items(5, false) });
  ok("V11 tourner : groupe étiqueté, boutons précédente / suivante, zone vive pour la vue courante", /role="group"/.test(tu) && tu.includes("Vue précédente") && tu.includes("Vue suivante") && /aria-live="polite"/.test(tu) && (tu.match(/data-steps-frame/g) ?? []).length === 5);
  ok("V12 tourner : focusable au clavier, pas d'auto-rotation (aucun attribut autoplay / data-auto)", /tabindex="0"/.test(tu) && !/autoplay|data-auto|data-spin/i.test(tu));
  ok("V13 tourner : un compteur « 1 / 5 »", /1 \/ 5/.test(tu));
  for (const [n, html] of [["compare", c], ["tabs", t], ["strip", st], ["scroll", sc], ["turn", tu]]) {
    ok(`V14 ${n} : aucun script, gestionnaire en ligne, repère d'édition`, !/<script|\son[a-z]+=|data-edit|data-inline|dangerouslySet/i.test(html));
  }
  const ed = render({ mode: "steps", view: "tabs", items: items(2), edit: true });
  ok("V15 en édition : repères de texte en place sur les titres d'étape", /data-inline="items\.0\.label"/.test(ed) && /data-inline="items\.1\.caption"/.test(ed));
  const one = render({ mode: "steps", view: "tabs", items: items(1, false) });
  ok("V16 une seule étape sans texte : aucun onglet vide, rend tout de même l'image", (one.match(/<img /g) ?? []).length === 1);
}

/* ---- C. CSS et sécurité ---- */
const cssPath = new URL("../src/app/etapes.css", import.meta.url);
ok("C1 etapes.css existe et est importé par globals.css", existsSync(cssPath) && /etapes\.css/.test(readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8")));
if (existsSync(cssPath)) {
  const css = readFileSync(cssPath, "utf8");
  ok("C2 découpe par clip-path et variable --pos", /clip-path:\s*inset\([^)]*var\(--pos/.test(css));
  ok("C3 prefers-reduced-motion respecté (aucune transition ni défilement doux)", /prefers-reduced-motion:\s*reduce/.test(css));
  ok("C4 curseur masqué tant que le script n'a pas pris la main", /:not\(\[data-ready\]\)/.test(css));
  ok("C5 couleurs par les tokens du thème (aucune couleur en dur)", !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")));
  ok("C6 cible tactile de 44 px au moins pour les boutons et la poignée", /44px/.test(css));
}
for (const f of ["etapes.ts", "EtapesView.tsx", "EtapesBlock.tsx"]) {
  const p = new URL(`../src/blocks/${f}`, import.meta.url);
  const src = existsSync(p) ? readFileSync(p, "utf8") : "";
  ok(`C7 ${f} : ni eval, ni new Function, ni HTML injecté, ni script tiers`, src.length > 0 && !/\beval\(|new Function|dangerouslySetInnerHTML|<script|innerHTML/.test(src));
}
console.log(failures ? `\n${failures} échec(s)` : "\nTout passe");
process.exit(failures ? 1 : 0);
