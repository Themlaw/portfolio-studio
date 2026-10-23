#!/usr/bin/env node
/**
 * Lot 69 « grille <-> images qui défilent » : tests unitaires de la conversion de données (inclus dans npm test), sans serveur.
 *  1. aller-retour grille -> carrousel -> grille : l'état de départ revient EXACTEMENT (réglages sans équivalent compris) ;
 *  2. la forme carrousel : images, ordre, légendes, cadres, fonds d'image, arrondis, lectures vidéo, réglages communs ;
 *  3. les retouches faites dans le carrousel passent dans la grille au retour ;
 *  4. carrousel d'origine -> grille -> carrousel : retour exact aussi ;
 *  5. refus (bande du projet, trop d'images, autre type), entrée jamais modifiée, formats acceptés par les schémas.
 * Usage : node --import tsx scripts/test-grille69.mjs
 */
import assert from "node:assert/strict";

import { layoutProblem, railIds, railList } from "../src/blocks/board-layout.ts";
import { gridSchema } from "../src/blocks/GridBlock.tsx";
import { convertItem, convertTarget, readStash } from "../src/blocks/grid-strip.ts";
import { formatOptions, FORMAT_LABELS } from "../src/lib/images/formats.ts";

let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log(`PASS  ${name}`);
};
const T = (s) => ({ fr: s, en: `${s} (en)` });
const clone = (v) => JSON.parse(JSON.stringify(v));
let n = 0;
const ctx = (look, kinds = {}) => ({ kinds: { 11: "image", 12: "image", 13: "video", 14: "image", 15: "image", 16: "video", ...kinds }, newUid: () => `new${++n}`, look });

/** Une grille de planche riche : tout ce que l'artiste peut y avoir réglé. */
const grid = () => ({
  uid: "grille1",
  type: "grid",
  box: { width: 67, align: "left" },
  props: {
    layout: "custom",
    cols: 3,
    spans: [{ w: 2, h: 1 }, { w: 1, h: 2 }, { w: 1, h: 1 }, { w: 1, h: 1 }],
    mirror: true,
    alone: [true, false, false, false],
    gap: "wide",
    align: "center",
    ratio: "4:5",
    top: "none",
    eyebrow: T("Série"),
    title: T("Titre de la grille"),
    captionTitle: T("Sous la grille"),
    caption: T("Légende de la grille"),
    captionDate: T("2026"),
    zoom: false,
    look: { radius: "soft", spaceTop: "m", imageSize: "large" },
    background: { kind: "color", color: "paper" },
    children: [
      { uid: "ka1", type: "image", props: { width: "wide", mediaId: 11, caption: T("Première"), captionTitle: T("Titre 1"), captionDate: T("mai"), ratio: "1:1", fit: "cover", look: { frame: { size: 6, color: "ink" }, imageBg: "#ffffff", crop: { mediaId: { x: 10, y: 20, zoom: 1.5 } } } } },
      { uid: "kb2", type: "image", props: { width: "wide", mediaId: 12, look: { radius: "strong" } } },
      { uid: "kc3", type: "video-single", props: { variant: "card", mode: "loop", mediaId: 13, posterMediaId: 14, description: T("Une vidéo"), title: T("Titre vidéo"), look: { frame: { size: 4, color: "accent" } } } },
      { uid: "kd4", type: "image", props: { width: "wide" } },
    ],
  },
});
const blockLook = () => ({ spaceTop: "l", slotFrame: { "autre-x1": { size: 2, color: "ink" } }, slotPano: { "grille1-ka1": "scroll" } });

test("69a aller-retour grille -> carrousel -> grille : état de départ exact, réglages de la rubrique intacts", () => {
  const g = grid();
  const look0 = blockLook();
  const a = convertItem(clone(g), "strip", ctx(clone(look0)));
  assert.ok(!("error" in a), JSON.stringify(a));
  assert.equal(a.item.type, "strip");
  assert.deepEqual(a.item.box, g.box, "la largeur du composant reste");
  assert.equal(a.item.uid, g.uid);
  const b = convertItem(clone(a.item), "grid", ctx(clone(a.look)));
  assert.ok(!("error" in b), JSON.stringify(b));
  assert.deepEqual(b.item, g, "la grille revient exactement");
  assert.deepEqual(b.look, look0, "la rubrique de la page retrouve ses réglages (aucune trace des places)");
});

test("69b la forme carrousel garde images, ordre, légendes, cadres, fonds, arrondis, lectures", () => {
  const g = grid();
  const a = convertItem(clone(g), "strip", ctx(blockLook()));
  const p = a.item.props;
  assert.equal(p.source, "own");
  assert.deepEqual(railList(p), [11, 12, 13, null], "images dans l'ordre ; case vide = place vide");
  const ids = railIds(p);
  assert.equal(new Set(ids).size, 4);
  assert.ok(ids.every((id) => /^[a-z0-9]{1,12}$/.test(id)));
  const slug = (i) => `grille1-${ids[i]}`;
  assert.deepEqual(p.captions[slug(0)], { title: T("Titre 1"), caption: T("Première"), date: T("mai") });
  assert.deepEqual(p.captions[slug(2)], { caption: T("Une vidéo") }, "la légende d'une vidéo");
  assert.equal(p.captions[slug(1)], undefined);
  const lk = a.look;
  assert.deepEqual(lk.slotFrame[slug(0)], { size: 6, color: "ink" });
  assert.deepEqual(lk.slotFrame[slug(2)], { size: 4, color: "accent" });
  assert.equal(lk.slotFrame["autre-x1"].size, 2, "un réglage d'une autre place reste");
  assert.equal(lk.slotBg[slug(0)], "#ffffff");
  assert.equal(lk.slotRadius[slug(1)], "strong", "arrondi propre à la case");
  assert.equal(lk.slotRadius[slug(0)], "soft", "sinon celui de la grille");
  assert.equal(lk.slotVideo[slug(2)], "loop");
  assert.equal(lk.slotVideo[slug(0)], undefined, "une image n'a pas de lecture");
  assert.equal(lk.slotPano[slug(0)], "scroll", "ce que la conversion ne gère pas reste");
  assert.deepEqual(p.look, g.props.look, "espace, arrondi du composant : communs");
  assert.deepEqual(p.background, g.props.background, "fond du composant : commun");
  assert.equal(layoutProblem([a.item]), null, "le carrousel passe le contrôle de forme de la planche");
  const stash = readStash(p.converted, "grid");
  assert.ok(stash && stash.props.layout === "custom" && stash.props.ratio === "4:5" && stash.props.gap === "wide", "agencement, format, espace gardés");
  assert.ok(JSON.stringify(stash.props).includes("\"crop\""), "le recadrage est gardé");
  assert.ok(JSON.stringify(stash.props).includes("posterMediaId"), "l'image d'attente est gardée");
});

test("69c retouches faites dans le carrousel : reprises dans la grille (ordre, légende, cadre, image ajoutée, place retirée)", () => {
  const g = grid();
  const a = convertItem(clone(g), "strip", ctx(blockLook()));
  const ids = railIds(a.item.props);
  const props = clone(a.item.props);
  const look = clone(a.look);
  // ordre : la 2e image passe en tête ; la place vide est retirée ; une image (15) et une vidéo (16) sont ajoutées.
  const order = [1, 0, 2];
  props.media = [...order.map((i) => props.media[i]), 15, 16];
  const newIds = [...order.map((i) => ids[i]), "nouv1", "nouv2"];
  props.ids = newIds;
  props.captions[`grille1-${ids[0]}`].caption = T("Première, modifiée");
  delete look.slotFrame[`grille1-${ids[2]}`];
  look.slotBg[`grille1-${ids[1]}`] = "card";
  const b = convertItem({ ...a.item, props }, "grid", ctx(look, { 15: "image", 16: "video" }));
  assert.ok(!("error" in b), JSON.stringify(b));
  const kids = b.item.props.children;
  assert.deepEqual(kids.map((k) => k.uid).slice(0, 3), ["kb2", "ka1", "kc3"], "ordre repris, cases d'origine retrouvées");
  assert.deepEqual(kids.map((k) => k.props.mediaId), [12, 11, 13, 15, 16]);
  assert.deepEqual(kids.map((k) => k.type), ["image", "image", "video-single", "image", "video-single"]);
  assert.deepEqual(kids[1].props.caption, T("Première, modifiée"));
  assert.deepEqual(kids[1].props.captionTitle, T("Titre 1"), "le titre non touché revient tel quel");
  assert.deepEqual(kids[1].props.look.crop, g.props.children[0].props.look.crop, "recadrage d'origine gardé");
  assert.equal(kids[1].props.ratio, "1:1");
  assert.equal(kids[2].props.look?.frame, undefined, "cadre retiré dans le carrousel : retiré dans la grille");
  assert.equal(kids[2].props.posterMediaId, 14, "image d'attente gardée");
  assert.equal(kids[0].props.look.imageBg, "card", "fond posé dans le carrousel");
  assert.equal(kids[3].uid.startsWith("new"), true);
  assert.equal(kids[4].props.mode, "player");
  assert.equal(b.item.props.layout, "custom", "agencement d'origine gardé");
  assert.equal(b.item.props.ratio, "4:5");
  assert.equal(b.look.slotFrame["autre-x1"].size, 2);
  assert.equal(Object.keys(b.look.slotFrame).some((k) => k.startsWith("grille1-")), false, "plus de trace des places dans la rubrique");
  assert.ok(gridSchema.safeParse(b.item.props).success, "la grille obtenue passe le schéma");
});

test("69d carrousel d'origine -> grille -> carrousel : retour exact (lectures, panorama, place vide)", () => {
  const strip = {
    uid: "rail1",
    type: "strip",
    box: { width: 50 },
    props: { source: "own", media: [11, null, 13], ids: ["aa1", "bb2", "cc3"], videoMode: "loop", look: { spaceTop: "s" }, captions: { "rail1-aa1": { caption: T("Une"), date: T("2026") }, "rail1-cc3": { title: T("Clip") } } },
  };
  const look0 = { slotFrame: { "rail1-aa1": { size: 8, color: "ink" } }, slotRadius: { "rail1-bb2": "none" }, slotPano: { "rail1-aa1": "scroll" }, slotVideo: { "rail1-cc3": "player" } };
  const a = convertItem(clone(strip), "grid", ctx(clone(look0)));
  assert.ok(!("error" in a), JSON.stringify(a));
  assert.equal(a.item.type, "grid");
  assert.deepEqual(a.item.box, strip.box);
  assert.deepEqual(a.item.props.children.map((k) => k.props.mediaId), [11, undefined, 13]);
  assert.deepEqual(a.item.props.children.map((k) => k.type), ["image", "image", "video-single"]);
  assert.deepEqual(a.item.props.children[0].props.caption, T("Une"));
  assert.deepEqual(a.item.props.children[0].props.look.frame, { size: 8, color: "ink" });
  assert.equal(a.item.props.children[1].props.look.radius, "none");
  assert.equal(a.item.props.children[2].props.mode, "player");
  assert.equal(a.look.slotPano["rail1-aa1"], "scroll", "le panorama (sans équivalent) reste dans la rubrique");
  assert.equal(gridSchema.safeParse(a.item.props).success, true);
  const b = convertItem(clone(a.item), "strip", ctx(clone(a.look)));
  assert.ok(!("error" in b), JSON.stringify(b));
  const { converted: _c, ...back } = b.item.props;
  void _c;
  assert.deepEqual(back, strip.props, "le carrousel revient exactement (hors mémoire)");
  assert.deepEqual(b.look, look0);
});

test("69e plusieurs allers-retours : la mémoire ne grossit pas", () => {
  let cur = grid();
  let look = blockLook();
  const size = (x) => JSON.stringify(x).length;
  const sizes = [];
  for (let i = 0; i < 4; i++) {
    const a = convertItem(clone(cur), "strip", ctx(clone(look)));
    const b = convertItem(clone(a.item), "grid", ctx(clone(a.look)));
    cur = b.item;
    look = b.look;
    sizes.push(size(cur));
  }
  assert.deepEqual(cur, grid());
  assert.equal(new Set(sizes).size, 1);
});

test("69f refus : bande du projet, trop d'images, autre type, mauvais sens ; l'entrée n'est jamais modifiée", () => {
  const project = { uid: "strip", type: "strip", props: {} };
  const r = convertItem(project, "grid", ctx(undefined));
  assert.ok("error" in r && /images du projet/.test(r.error));
  assert.ok("reason" in convertTarget(project));
  assert.ok("error" in convertItem({ uid: "t", type: "rich-text", props: {} }, "grid", ctx(undefined)));
  const many = { uid: "m", type: "strip", props: { source: "own", media: Array.from({ length: 30 }, (_, i) => i + 1) } };
  const e = convertItem(many, "grid", ctx(undefined));
  assert.ok("error" in e && /24/.test(e.error), JSON.stringify(e));
  assert.ok("error" in convertItem(grid(), "grid", ctx(undefined)));
  const g = grid();
  const frozen = clone(g);
  convertItem(g, "strip", ctx(blockLook()));
  assert.deepEqual(g, frozen);
  const empty = convertItem({ uid: "v", type: "grid", props: { layout: "auto", children: [] } }, "strip", ctx(undefined));
  assert.deepEqual(empty.item.props.media, []);
  assert.equal(empty.look, undefined);
  const backEmpty = convertItem(empty.item, "grid", ctx(undefined));
  assert.deepEqual(backEmpty.item.props, { layout: "auto", children: [] });
});

test("69g un format ancien reste affiché, sans « (ancien format) » nulle part", () => {
  assert.ok(!Object.values(FORMAT_LABELS).some((l) => /ancien/i.test(l)));
  assert.ok(!formatOptions("4:5").some((o) => /ancien/i.test(o.label)));
  assert.equal(formatOptions("4:5").at(-1).label, "Portrait 4:5");
  assert.equal(formatOptions("auto")[0].label, "Libre");
});

console.log(`${passed} tests passés`);
