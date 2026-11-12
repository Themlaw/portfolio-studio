#!/usr/bin/env node
/**
 * Lot 128 « titres dans les composants », étape 1 : tests UNITAIRES (sans serveur), données synthétiques.
 *  S  Schéma : anciennes props sans `head` valides à l'identique ; `head` illisible ignoré (le bloc s'affiche) ; types titrables.
 *  O  Opérations de la pastille (`field-op`) : « + Titre » crée `head.title`, « Retirer » retire la clé (aucune clé vide résiduelle), sous-titre,
 *     dessous, sur l'image ; case de grille justifiée = `captionTitle`, case non justifiée = `head`.
 *  L  Niveau de titre : h2 en premier niveau, h3 dans un conteneur qui AFFICHE un titre, jamais h1, plafond h4.
 *  T  `TEXT_PATH_RE` accepte `head.title` ; le protocole accepte les nouvelles opérations ; le registre déclare les textes en place.
 *  R  Rendu : titre h2/h3, sous-titre <p class="eyebrow">, vide = rien, aucun repère d'édition en public, style local (Aa) lu dans `look.text`.
 * Usage : node --import tsx scripts/test-titres128.mjs   (inclus dans npm test)
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const T = (s) => ({ fr: s, en: s });
const E = { fr: "", en: "" };

const load = async (path) => {
  try {
    return await import(path);
  } catch (e) {
    ok(`module ${path} chargé`, false, String(e.message).split("\n")[0]);
    return null;
  }
};
const head = await load("../src/blocks/head.ts");
const Head = await load("../src/blocks/Head.tsx");
const { BLOCKS } = await import("../src/blocks/registry.ts");
const { TEXT_PATH_RE } = await import("../src/lib/look.ts");
const { acceptFromCanvas, EDIT_MSG } = await import("../src/lib/edit/protocol.ts");
const { FIELD_OP_NAMES, fieldOpDef } = await import("../src/blocks/optional-fields.ts");

/* ---- S. schéma ---------------------------------------------------------------------------------------------- */
const TYPES = ["image", "video-single", "free-board", "project-board", "random-work"];
ok("S1 types titrables : image, vidéo, planche libre, projet, œuvre au hasard", Boolean(head) && TYPES.every((t) => head.HEAD_TYPES.includes(t)) && head.HEAD_TYPES.length === TYPES.length);
ok("S2 la grille garde ses champs (jamais deux titres) : pas de `head`", Boolean(head) && !head.HEAD_TYPES.includes("grid") && !head.HEAD_TYPES.includes("section-title") && !head.HEAD_TYPES.includes("rich-text"));
const oldImage = { mediaId: 3, width: "wide", caption: T("Légende") };
const parsedOld = BLOCKS.image.schema.safeParse(oldImage);
ok("S3 anciennes props (sans `head`) valides, aucune clé `head` ajoutée à la lecture", parsedOld.success && !("head" in parsedOld.data), JSON.stringify(parsedOld.data));
const withHead = BLOCKS.image.schema.safeParse({ ...oldImage, head: { eyebrow: T("Printemps"), title: T("Carnet"), at: "below" } });
ok("S4 `head` lu : sous-titre, titre, position", withHead.success && withHead.data.head?.title?.fr === "Carnet" && withHead.data.head?.eyebrow?.fr === "Printemps" && withHead.data.head?.at === "below");
for (const bad of [{ title: "pas localisé" }, { title: T("x"), at: "dessus" }, "texte", 12, [1]]) {
  const p = BLOCKS.image.schema.safeParse({ ...oldImage, head: bad });
  ok(`S5 \`head\` illisible (${JSON.stringify(bad)}) ignoré, le bloc reste lisible`, p.success && !("head" in p.data) || (p.success && p.data.head === undefined), JSON.stringify(p.success ? p.data : p.error.issues));
}
for (const t of TYPES) {
  const p = BLOCKS[t].schema.safeParse({ ...BLOCKS[t].defaults, head: { title: T("x") } });
  ok(`S6 ${t} : le schéma lit \`head\``, p.success && p.data.head?.title?.fr === "x", JSON.stringify(p.success ? p.data : p.error.issues));
}
ok("S7 grille : `head` ignoré (pas de clé conservée)", !("head" in (BLOCKS.grid.schema.safeParse({ layout: "2", children: [], head: { title: T("x") } }).data ?? { head: 1 })));

/* ---- O. opérations --------------------------------------------------------------------------------------------- */
if (head) {
  const op = (type, props, name, where) => head.applyHeadOp(type, props, name, where);
  const a = op("image", oldImage, "add-head");
  ok("O1 « + Titre » crée head.title vide dans les deux langues et demande la saisie en place", a && JSON.stringify(a.props.head) === JSON.stringify({ title: E }) && a.edit === "head.title", JSON.stringify(a));
  ok("O2 l'original n'est pas modifié (copie)", !("head" in oldImage));
  ok("O3 « + Titre » deux fois : sans effet (null)", op("image", a.props, "add-head") === null);
  const r = op("image", { ...a.props, head: { title: T("Carnet"), eyebrow: T("Hiver"), at: "below" } }, "remove-head");
  ok("O4 « Retirer le titre » retire la clé `head` entière (aucune clé vide résiduelle)", r && !("head" in r.props) && Object.keys(r.props).sort().join() === "caption,mediaId,width", JSON.stringify(r));
  ok("O5 « Retirer » sans titre : sans effet", op("image", oldImage, "remove-head") === null);
  const e = op("image", a.props, "add-head-eyebrow");
  ok("O6 « + Sous-titre » crée head.eyebrow et le met en saisie ; le titre reste", e && JSON.stringify(e.props.head) === JSON.stringify({ title: E, eyebrow: E }) && e.edit === "head.eyebrow", JSON.stringify(e));
  ok("O7 « + Sous-titre » sans titre : refusé", op("image", oldImage, "add-head-eyebrow") === null);
  const er = op("image", { head: { title: T("A"), eyebrow: T("B") } }, "remove-head-eyebrow");
  ok("O8 « Retirer le sous-titre » ne retire que lui", er && JSON.stringify(er.props.head) === JSON.stringify({ title: T("A") }), JSON.stringify(er));
  const below = op("image", { head: { title: T("A") } }, "add-head-below");
  ok("O9 « Mettre dessous » pose at:below ; « Mettre dessus » le retire", below?.props.head.at === "below" && !("at" in op("image", below.props, "remove-head-below").props.head));
  const over = op("image", { head: { title: T("A"), at: "below" } }, "add-head-over");
  ok("O10 « Sur l'image » (image, planche libre) remplace dessous", over?.props.head.at === "over" && op("free-board", { head: { title: T("A") } }, "add-head-over")?.props.head.at === "over");
  ok("O11 « Sur l'image » refusé pour un projet, une vidéo, œuvre au hasard", ["project-board", "video-single", "random-work"].every((t) => op(t, { head: { title: T("A") } }, "add-head-over") === null));
  ok("O12 types hors liste refusés (grille, texte, titre)", ["grid", "rich-text", "section-title", "contact"].every((t) => op(t, {}, "add-head") === null));
  ok("O13 clés hostiles refusées", op("image", { __proto__: null }, "add-__proto__") === null && op("constructor", {}, "add-head") === null);

  // Pastilles proposées
  const names = (type, props, where) => head.headOpsFor(type, props, where).map((o) => o.op);
  ok("O14 bloc de page sans titre : une seule pastille « + Titre »", JSON.stringify(names("image", oldImage, { cell: false, justified: false })) === JSON.stringify(["add-head"]));
  const withAll = { head: { title: T("A") } };
  ok("O15 avec titre (image) : retirer, sous-titre, dessous, sur l'image", JSON.stringify(names("image", withAll, { cell: false, justified: false })) === JSON.stringify(["remove-head", "add-head-eyebrow", "add-head-below", "add-head-over"]), JSON.stringify(names("image", withAll, { cell: false, justified: false })));
  ok("O16 projet : pas de « Sur l'image »", !names("project-board", withAll, { cell: false, justified: false }).some((n) => n.endsWith("over")));
  ok("O17 libellés lisibles", head.headOpsFor("image", oldImage, { cell: false, justified: false })[0].label === "+ Titre" && head.headOpsFor("image", withAll, { cell: false, justified: false })[0].label === "Retirer le titre");
  ok("O18 case de grille JUSTIFIÉE : « + Titre » écrit captionTitle (jamais `head`)", JSON.stringify(names("image", oldImage, { cell: true, justified: true })) === JSON.stringify(["add-cap-title"]) && JSON.stringify(names("image", { captionTitle: T("x") }, { cell: true, justified: true })) === JSON.stringify(["remove-cap-title"]));
  ok("O19 case de grille NON justifiée : même geste qu'un bloc de page, sans « Sur l'image »", JSON.stringify(names("image", withAll, { cell: true, justified: false })) === JSON.stringify(["remove-head", "add-head-eyebrow", "add-head-below"]));
  const def = fieldOpDef("image", "cap-title");
  ok("O20 `cap-title` : table des champs facultatifs (image, vidéo, planche libre → captionTitle)", def?.prop === "captionTitle" && fieldOpDef("video-single", "cap-title")?.prop === "captionTitle" && fieldOpDef("free-board", "cap-title")?.prop === "captionTitle");
}

/* ---- L. niveau ----------------------------------------------------------------------------------------------- */
if (head) {
  ok("L1 premier niveau : h2", head.headTag(2) === "h2");
  ok("L2 niveau 3 : h3 ; 4 et plus : h4 (plafond)", head.headTag(3) === "h3" && head.headTag(4) === "h4" && head.headTag(9) === "h4");
  ok("L3 jamais h1 (niveau 0, 1, négatif, absent)", [0, 1, -3, undefined, NaN].every((n) => head.headTag(n) === "h2"));
  const grid = (title) => ({ type: "grid", props: { layout: "2", children: [], ...(title ? { title } : {}) } });
  ok("L4 un conteneur AVEC titre affiché fait passer ses composants à +1", head.childLevel(2, grid(T("Escales"))) === 3);
  ok("L5 un conteneur sans titre ne consomme aucun niveau (pas de saut)", head.childLevel(2, grid(undefined)) === 2);
  ok("L6 titre vide (clé présente, texte vide) : aucun niveau consommé", head.childLevel(2, grid(E)) === 2);
  ok("L7 niveau d'un bloc hors conteneur : inchangé", head.childLevel(2, { type: "image", props: {} }) === 2);
}

/* ---- T. chemins, protocole, registre ----------------------------------------------------------------------------- */
ok("T1 TEXT_PATH_RE accepte head.title et head.eyebrow", TEXT_PATH_RE.test("head.title") && TEXT_PATH_RE.test("head.eyebrow"));
const origin = "https://portfolio.example";
const frame = { name: "toile" };
const msg = (data) => ({ origin, source: frame, data: { type: EDIT_MSG, ...data } });
const wanted = ["add-head", "remove-head", "add-head-eyebrow", "remove-head-eyebrow", "add-head-below", "remove-head-below", "add-head-over", "remove-head-over", "add-cap-title", "remove-cap-title"];
ok("T2 le protocole accepte les nouvelles opérations de la pastille", wanted.every((op) => acceptFromCanvas(msg({ kind: "field-op", uid: "b1", op }), origin, frame)?.op === op), wanted.filter((op) => !acceptFromCanvas(msg({ kind: "field-op", uid: "b1", op }), origin, frame)).join());
ok("T3 le protocole refuse toujours une opération inconnue", ["add-head-x", "toggle-head", "add-"].every((op) => acceptFromCanvas(msg({ kind: "field-op", uid: "b1", op }), origin, frame) === null));
ok("T4 FIELD_OP_NAMES contient les noms courts", ["head", "head-eyebrow", "head-below", "head-over", "cap-title"].every((n) => FIELD_OP_NAMES.includes(n)));
ok("T5 registre : textes en place `head.title` / `head.eyebrow` des seuls types titrables", TYPES.every((t) => BLOCKS[t].inline.includes("head.title") && BLOCKS[t].inline.includes("head.eyebrow")) && !BLOCKS.grid.inline.includes("head.title") && !BLOCKS["rich-text"].inline.includes("head.title"));

/* ---- R. rendu --------------------------------------------------------------------------------------------------- */
if (Head && head) {
  const ctx = (extra = {}) => ({ locale: "fr", pageId: 1, ...extra });
  const render = async (props, extra = {}) => renderToStaticMarkup(await (Head.default ?? Head.Head)({ head: props.head, ctx: ctx(extra.ctx), level: extra.level ?? 2, at: props.head?.at, ...(extra.rest ?? {}) }));
  const html = await render({ head: { eyebrow: T("Printemps 2026"), title: T("Carnet de mer") } });
  ok("R1 premier niveau : <h2> pour le titre, <p class=eyebrow> pour le sous-titre (jamais un titre)", /<h2[^>]*>Carnet de mer<\/h2>/.test(html) && /<p[^>]*class="eyebrow[^"]*"[^>]*>Printemps 2026<\/p>/.test(html) && !/<h1/.test(html), html);
  ok("R2 le sous-titre précède le titre", html.indexOf("Printemps") < html.indexOf("Carnet"));
  ok("R3 niveau 3 : <h3>", /<h3[^>]*>Carnet de mer<\/h3>/.test(await render({ head: { title: T("Carnet de mer") } }, { level: 3 })));
  ok("R4 public : aucun repère d'édition (data-inline, data-placeholder)", !/data-inline|data-placeholder|pe-/.test(html), html);
  ok("R5 titre vide (public) : rien du tout, pas même l'enveloppe", await render({ head: { title: E } }) === "" && await render({ head: { title: E, eyebrow: E } }) === "" && await render({ head: undefined }) === "");
  const h6 = await await render({ head: { title: E, eyebrow: T("Seul") } });
  ok("R6 titre vide + sous-titre rempli : seul le sous-titre", /Seul/.test(h6) && !/<h2/.test(h6));
  const edit = await render({ head: { title: E } }, { ctx: { edit: true } });
  ok("R7 toile : titre vide présent, `data-inline=\"head.title\"` et indication", /data-inline="head\.title"/.test(edit) && /data-placeholder="Titre"/.test(edit) && /<h2/.test(edit), edit);
  const edit2 = await render({ head: { title: T("A"), eyebrow: E } }, { ctx: { edit: true } });
  ok("R8 toile : sous-titre vide présent avec son repère", /data-inline="head\.eyebrow"/.test(edit2) && /data-placeholder="Sous-titre"/.test(edit2), edit2);
  const styled = await render({ head: { title: T("A") } }, { ctx: { look: { text: { "head.title": { italic: true } } } } });
  ok("R9 style local (barre Aa, `look.text[head.title]`) posé en ligne, même en public", /<h2[^>]*style="[^"]*italic/.test(styled), styled);
  const below = await render({ head: { title: T("A"), at: "below" } });
  ok("R10 dessous : `data-at=\"below\"`", /data-at="below"/.test(below), below);
  const above = await render({ head: { title: T("A") } });
  ok("R11 dessus : `data-at=\"above\"`", /data-at="above"/.test(above), above);
  const over = await render({ head: { title: T("A"), at: "over" } }, { rest: { over: true } });
  ok("R12 sur l'image : `data-at=\"over\"`", /data-at="over"/.test(over), over);
  const en = renderToStaticMarkup(await (Head.default ?? Head.Head)({ head: { title: { fr: "Carnet", en: "Notebook" } }, ctx: ctx({ locale: "en" }), level: 2 }));
  ok("R13 langue : le texte anglais en anglais", /Notebook/.test(en) && !/Carnet/.test(en));
  ok("R14 plafond : niveau 7 rendu en <h4>", /<h4/.test(await render({ head: { title: T("A") } }, { level: 7 })));
}

console.log(failures ? `${failures} ÉCHEC(S)` : "TOUT PASSE");
process.exit(failures ? 1 : 0);
