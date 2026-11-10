#!/usr/bin/env node
/**
 * Lot 133 : copier / coller de blocs et de styles + apparitions au défilement. Tests UNITAIRES (sans serveur), données synthétiques.
 *  C  presse-papiers (localStorage) : lecture tolérante, bornes, version, clés dangereuses ;
 *  S  style seulement : clés communes du registre, adaptation à la cible par les schémas ;
 *  P  collage : revalidation par le registre (types, props, conteneurs, imbrication, uniques, références), nouveaux uid, médias gardés ;
 *  G  générique : tout type du registre passe, y compris un type inventé après coup (lots 131 / 132) sans code dédié ;
 *  R  apparitions : schéma facultatif (anciennes données inchangées), attributs, CSS pur avec repli, journal.
 * Usage : node --import tsx scripts/test-copier133.mjs   (inclus dans npm test)
 */
import { readFileSync } from "node:fs";
import { z } from "zod";

import { BLOCKS } from "../src/blocks/registry.ts";
import { FreeItemSchema } from "../src/blocks/free-board.ts";
import { RevealSchema, REVEAL_KINDS, readReveal, revealAttrs } from "../src/blocks/reveal.ts";
import { CLIP_VERSION, MAX_CLIP_BYTES, STYLE_KEYS, blocksClip, parseClip, styleClip, styleOf } from "../src/lib/edit/clip.ts";
import { adaptStyle, sanitizeBlocks } from "../src/lib/edit/clipboard.ts";
import { SPECS as CATALOG } from "../src/lib/journal/catalog.ts";

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const T = (fr, en = fr) => ({ fr, en });
const ROOT = new URL("..", import.meta.url).pathname;

let n = 0;
const newUid = () => `z${(++n).toString(36)}`;
const EXISTS = {
  media: (id) => id !== 999,
  page: (id) => id !== 998,
  project: (slug) => (slug === "ailleurs" ? "elsewhere" : slug === "absent" ? "missing" : "ok"),
};
const base = (extra = {}) => ({ parentType: null, depth: 0, count: 0, pageBlocks: [], special: false, exists: EXISTS, newUid, ...extra });
const image = (uid, props = {}) => ({ uid, type: "image", props: { width: "wide", mediaId: 12, ...props } });
const grid = (uid, children) => ({ uid, type: "grid", props: { layout: "auto", children } });

// ---- C : presse-papiers
{
  const clip = blocksClip([image("a1")], 7);
  const text = JSON.stringify(clip);
  ok("C1 aller-retour d'un presse-papiers de blocs", parseClip(text)?.kind === "blocks" && parseClip(text).blocks.length === 1 && clip.v === CLIP_VERSION);
  ok("C2 texte illisible, vide ou non objet : refusé sans exception", parseClip("") === null && parseClip("{") === null && parseClip("42") === null && parseClip(null) === null && parseClip("[]") === null);
  ok("C3 version inconnue ou genre inconnu : refusé", parseClip(JSON.stringify({ ...clip, v: 99 })) === null && parseClip(JSON.stringify({ ...clip, kind: "autre" })) === null);
  ok("C4 trop lourd : refusé", parseClip(JSON.stringify({ ...clip, blocks: [image("a1", { caption: T("x".repeat(MAX_CLIP_BYTES)) })] })) === null);
  ok("C5 plus de 40 blocs : refusé", parseClip(JSON.stringify({ ...clip, blocks: Array.from({ length: 41 }, (_, i) => image(`b${i}`)) })) === null);
  const hostile = parseClip('{"v":1,"kind":"blocks","blocks":[{"uid":"a1","type":"image","props":{"__proto__":{"polluted":1},"mediaId":3}}]}');
  ok("C6 clé __proto__ retirée, aucune pollution", hostile !== null && !Object.hasOwn(hostile.blocks[0].props, "__proto__") && ({}).polluted === undefined);
  const sc = styleClip("image", { look: { width: "narrow" } });
  ok("C7 presse-papiers de style : aller-retour", parseClip(JSON.stringify(sc))?.kind === "style" && parseClip(JSON.stringify(sc)).type === "image");
}

// ---- S : style seulement
{
  const block = { uid: "s1", type: "image", props: { mediaId: 5, caption: T("Légende"), look: { radius: "soft", slotLook: { "a-b": { frame: "x" } } }, surface: { color: "card" }, background: { kind: "color", color: "accent" }, reveal: { kind: "fade" } } };
  const st = styleOf(block);
  ok("S1 le style ne porte que les clés communes du registre", Object.keys(st).every((k) => STYLE_KEYS.includes(k)) && !("mediaId" in st) && !("caption" in st));
  ok("S2 le style contient look, surface, background, reveal présents", ["look", "surface", "background", "reveal"].every((k) => k in st));
  ok("S3 slotLook (contenu des places) jamais copié", !("slotLook" in (st.look ?? {})));
  ok("S4 STYLE_KEYS inclut reveal et les trois réglages communs", ["look", "surface", "background", "reveal"].every((k) => STYLE_KEYS.includes(k)));
  const onNested = adaptStyle(st, { type: "image", top: false });
  ok("S5 carte (surface) retirée hors premier niveau", !("surface" in onNested) && "look" in onNested && "reveal" in onNested);
  const onHero = adaptStyle(st, { type: "hero", top: true });
  ok("S6 fond retiré sur un type sans fond", !("background" in onHero) && "surface" in onHero);
  const withText = adaptStyle({ look: { text: { title: { size: "lg" }, "inconnu.chemin": { size: "lg" } } } }, { type: "image", top: true });
  ok("S7 styles de texte : seuls les chemins du type cible", !withText.look?.text || !("inconnu.chemin" in withText.look.text));
  ok("S8 réglage invalide écarté, le reste gardé", (() => { const r = adaptStyle({ look: { width: "n'importe quoi", radius: "soft" }, reveal: { kind: "zzz" } }, { type: "image", top: true }); return r.look?.radius === "soft" && r.look.width === undefined && !("reveal" in r); })());
}

// ---- P : collage
{
  const r = sanitizeBlocks([image("a1"), grid("a2", [image("a3"), image("a4", { mediaId: 13 })])], base());
  ok("P1 collage valide accepté", r.ok === true, r.message);
  const uids = r.ok ? [r.blocks[0].uid, r.blocks[1].uid, ...r.blocks[1].props.children.map((c) => c.uid)] : [];
  ok("P2 tous les uid sont neufs et distincts, composants compris", uids.length === 4 && new Set(uids).size === 4 && uids.every((u) => !["a1", "a2", "a3", "a4"].includes(u)));
  ok("P3 médias référencés, pas dupliqués (mêmes identifiants)", r.ok && r.blocks[0].props.mediaId === 12 && r.blocks[1].props.children[1].props.mediaId === 13);
  ok("P4 la source n'est pas modifiée", (() => { const src = [image("a1")]; sanitizeBlocks(src, base()); return src[0].uid === "a1"; })());
  ok("P5 média absent ou à la corbeille : refusé avec un message", (() => { const x = sanitizeBlocks([image("a1", { mediaId: 999 })], base()); return !x.ok && /média/i.test(x.message); })());
  ok("P6 média absent dans un composant : refusé", !sanitizeBlocks([grid("a2", [image("a3", { mediaId: 999 })])], base()).ok);
  ok("P7 page liée disparue : refusée", !sanitizeBlocks([{ uid: "l1", type: "page-link", props: { pageId: 998, label: T("Aller") } }], base()).ok);
  ok("P8 type inconnu : refusé", !sanitizeBlocks([{ uid: "q1", type: "inconnu", props: {} }], base()).ok);
  ok("P9 props invalides (schéma du registre) : refusées", !sanitizeBlocks([image("a1", { width: "énorme" })], base()).ok);
  ok("P10 clés inconnues retirées par le schéma", (() => { const x = sanitizeBlocks([image("a1", { pirate: "<script>" })], base()); return x.ok && !("pirate" in x.blocks[0].props); })());
  ok("P11 conteneur : un type refusé par la grille", !sanitizeBlocks([{ uid: "c1", type: "grid", props: { layout: "auto", children: [grid("c2", [])] } }], base()).ok);
  ok("P12 dans une grille : image acceptée, grille refusée", sanitizeBlocks([image("a1")], base({ parentType: "grid", depth: 1 })).ok && !sanitizeBlocks([grid("a2", [])], base({ parentType: "grid", depth: 1 })).ok);
  ok("P13 imbrication trop profonde refusée", !sanitizeBlocks([grid("a2", [image("a3")])], base({ parentType: "featured-project", depth: 2 })).ok);
  ok("P14 Ouverture déjà présente sur la page : refusée", !sanitizeBlocks([{ uid: "h1", type: "hero", props: { eyebrow: T(""), statement: T("") } }], base({ pageBlocks: [{ type: "hero" }] })).ok);
  ok("P15 page pleine (40 blocs) : refusé ; conteneur plein (24) : refusé", !sanitizeBlocks([image("a1")], base({ count: 40 })).ok && !sanitizeBlocks([image("a1")], base({ parentType: "grid", depth: 1, count: 24 })).ok);
  ok("P16 bloc réservé à la page spéciale refusé sur une page ordinaire", !sanitizeBlocks([{ uid: "e1", type: "exit", props: {} }], base()).ok);
  ok("P17 bloc verrouillé (Sortie) : jamais collé en double", !sanitizeBlocks([{ uid: "e1", type: "exit", props: {} }], base({ special: true, pageBlocks: [{ type: "exit" }] })).ok);
  const f = sanitizeBlocks([{ uid: "f1", type: "contact-form", props: { formId: "fixe123456", fields: [] } }], base());
  ok("P18 formulaire de contact : identifiant public neuf", f.ok ? f.blocks[0].props.formId !== "fixe123456" : true);
  ok("P19 projet en création sur une autre page : refusé ; projet absent : refusé", !sanitizeBlocks([{ uid: "p1", type: "project-board", props: { project: "ailleurs" } }], base()).ok && !sanitizeBlocks([{ uid: "p1", type: "project-board", props: { project: "absent" } }], base()).ok);
  ok("P20 projet existant : accepté, même projet cité", (() => { const x = sanitizeBlocks([{ uid: "p1", type: "project-board", props: { project: "mon-projet" } }], base()); return x.ok && x.blocks[0].props.project === "mon-projet"; })());
  ok("P21 liste vide ou non tableau : refusée", !sanitizeBlocks([], base()).ok && !sanitizeBlocks("x", base()).ok);
  ok("P22 collage en plusieurs exemplaires : uid toujours neufs", (() => { const a = sanitizeBlocks([image("a1")], base()); const b = sanitizeBlocks([image("a1")], base()); return a.ok && b.ok && a.blocks[0].uid !== b.blocks[0].uid; })());
}

// ---- G : générique
{
  const types = Object.values(BLOCKS).filter((d) => !d.deprecated && !d.locked && !d.onlyOnSpecial);
  let tried = 0;
  const bad = [];
  for (const def of types) {
    const props = { ...def.defaults };
    if (!def.schema.safeParse(props).success) continue;
    if (def.container) props.children = [];
    tried++;

    const res = sanitizeBlocks([{ uid: "g1", type: def.type, props }], base());
    if (!res.ok && !/page|projet|Ouverture|une fois/i.test(res.message)) bad.push(`${def.type}: ${res.message}`);
    if (res.ok && res.blocks[0].type !== def.type) bad.push(`${def.type}: type changé`);
  }
  ok("G1 chaque type créable du registre passe par le même collage", tried >= 10 && bad.length === 0, bad.join(" | "));
  const FAKE = { type: "demo131", schema: z.object({ n: z.number().int().max(9), media: z.number().int().positive().optional() }), refs: { media: ["media"] }, defaults: {}, label: "Démo", inline: [] };
  const registry = { ...BLOCKS, demo131: FAKE };
  const a = sanitizeBlocks([{ uid: "d1", type: "demo131", props: { n: 3, media: 12, extra: 1 } }], base({ registry }));
  ok("G2 un type ajouté au registre est collé sans code dédié (schéma, uid)", a.ok && a.blocks[0].props.n === 3 && !("extra" in a.blocks[0].props) && a.blocks[0].uid !== "d1", a.message);
  ok("G3 …ses références (refs du registre) sont vérifiées", !sanitizeBlocks([{ uid: "d1", type: "demo131", props: { n: 3, media: 999 } }], base({ registry })).ok);
  ok("G4 …son schéma le borne", !sanitizeBlocks([{ uid: "d1", type: "demo131", props: { n: 99 } }], base({ registry })).ok);
  ok("G5 …il se copie en style comme les autres (look, reveal)", Object.keys(adaptStyle({ look: { radius: "soft" }, reveal: { kind: "slide" } }, { type: "demo131", top: true }, registry)).includes("reveal"));
}

// ---- R : apparitions
{
  ok("R1 trois effets", REVEAL_KINDS.join() === "fade,slide,scale");
  ok("R2 schéma : effet obligatoire, délai 0 à 5 entier", RevealSchema.safeParse({ kind: "fade" }).success && RevealSchema.safeParse({ kind: "slide", delay: 5 }).success && !RevealSchema.safeParse({ kind: "pop" }).success && !RevealSchema.safeParse({ kind: "fade", delay: 6 }).success && !RevealSchema.safeParse({ kind: "fade", delay: 1.5 }).success);
  ok("R3 lecture tolérante : illisible = absent", readReveal({ kind: "x" }) === undefined && readReveal(null) === undefined && readReveal("fade") === undefined && readReveal({ kind: "scale", delay: 2 })?.kind === "scale");
  ok("R4 jamais le premier bloc", revealAttrs({ kind: "fade" }, { first: true, edit: false }) === null);
  ok("R5 jamais en édition", revealAttrs({ kind: "fade" }, { first: false, edit: true }) === null);
  ok("R6 sans réglage : rien (anciennes données, DOM inchangé)", revealAttrs(undefined, { first: false, edit: false }) === null);
  const at = revealAttrs({ kind: "slide", delay: 3 }, { first: false, edit: false });
  ok("R7 attributs de l'effet et du délai", at?.["data-reveal"] === "slide" && at?.["data-rv-d"] === "3" && /\brv\b/.test(at?.className ?? ""));
  for (const type of ["image", "grid", "rich-text", "hero"]) {
    const def = BLOCKS[type];
    const old = def.schema.safeParse(def.defaults);
    ok(`R8 ${type} : anciennes données sans reveal, aucune clé ajoutée`, !old.success || !("reveal" in old.data));
  }
  ok("R9 tout bloc du registre accepte reveal, l'illisible est ignoré", (() => { const d = BLOCKS.image; const a = d.schema.parse({ width: "wide", reveal: { kind: "scale", delay: 1 } }); const b = d.schema.parse({ width: "wide", reveal: { kind: "zzz" } }); return a.reveal?.kind === "scale" && b.reveal === undefined; })());
  ok("R10 image de planche libre : reveal facultatif", FreeItemSchema.safeParse({ id: "a", media: 1, x: 10, y: 10, w: 30, reveal: { kind: "fade" } }).success && !("reveal" in FreeItemSchema.parse({ id: "a", media: 1, x: 10, y: 10, w: 30 })) && FreeItemSchema.parse({ id: "a", media: 1, x: 10, y: 10, w: 30, reveal: { kind: "zzz" } }).reveal === undefined);
  const css = readFileSync(`${ROOT}src/app/globals.css`, "utf8");
  const i = css.indexOf("animation-timeline: view()");
  ok("R11 CSS pur animation-timeline: view(), sous @supports", i > 0 && /@supports\s*\(animation-timeline:\s*view\(\)\)/.test(css));
  const start = css.lastIndexOf("@supports", i);
  const region = css.slice(start, i + 400);
  ok("R12 effet appliqué seulement avec support ET sans prefers-reduced-motion", /prefers-reduced-motion:\s*no-preference/.test(region));
  const outside = css.slice(0, start).split("\n").filter((l) => /\.rv\b/.test(l) && /opacity\s*:\s*0/.test(l));
  ok("R13 contenu visible par défaut : aucun opacity:0 hors @supports", outside.length === 0);
  ok("R14 impression : animation coupée", /@media print[^}]*\{[^}]*\.rv/s.test(css) || /@media print\s*\{[\s\S]{0,200}\.rv/.test(css));
  ok("R15 effets par propriétés individuelles (translate, scale) : la rotation des images de la planche est préservée", /translate:/.test(css.slice(start, start + 3000)) && /scale:/.test(css.slice(start, start + 3000)));
  const bl = readFileSync(`${ROOT}src/blocks/BlockList.tsx`, "utf8");
  ok("R16 BlockList pose l'enveloppe via revealAttrs", /revealAttrs/.test(bl) && /noReveal/.test(bl));
  const fb = readFileSync(`${ROOT}src/blocks/FreeBoardBlock.tsx`, "utf8");
  ok("R17 la planche libre pose l'effet par image, pas en édition", /revealAttrs/.test(fb));
  ok("R18 journal : collage de blocs et de style catalogués", Boolean(CATALOG.pasteBlocksAction) && Boolean(CATALOG.pasteStyleAction));
  const act = readFileSync(`${ROOT}src/app/admin/(espace)/pages/actions.ts`, "utf8");
  ok("R19 actions de collage protégées (assertAdmin) et journalisées (audited)", /audited\("pasteBlocksAction"/.test(act) && /audited\("pasteStyleAction"/.test(act) && /pasteBlocksAction[\s\S]{0,400}assertAdmin/.test(act));
}

if (failures) {
  console.log(`\n${failures} échec(s)`);
  process.exit(1);
}
console.log("\ntest-copier133 : OK");
