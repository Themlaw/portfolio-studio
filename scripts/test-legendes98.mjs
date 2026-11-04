#!/usr/bin/env node
/**
 * Lot 98 : légendes et barre « Aa » — unités.
 * - Les clés de style des légendes de bande (`captions.<place>.<champ>`) passent le schéma des réglages (elles étaient refusées : le style posé
 *   sur une légende de carrousel, ou de la bande du projet, était écarté en silence puis perdu au rechargement).
 * - Un style de texte illisible, ou en trop, ne fait jamais perdre les autres (lecture entrée par entrée) ; plafond relevé.
 * - Style des légendes d'un projet : forme dans la suite, lecture, fusion (« Ce texte » > projet), champ d'une légende.
 * - Planche publique (docs/SECURITE.md N8) : `ProjectStrip` ne reçoit ni la suite de composants brute (`layout`), ni l'en-tête
 *   masqué ; seul le style des légendes du projet en est extrait.
 * Usage : node --import tsx scripts/test-legendes98.mjs   (inclus dans npm test)
 */
import { captionFieldOf, layoutProblem, projectCaptionStyle } from "../src/blocks/board-layout.ts";
import { captionCss, captionStylesOf } from "../src/blocks/caption-style.ts";
import { LookSchema, MAX_TEXT_STYLES, readLook, TEXT_PATH_RE } from "../src/lib/look.ts";
import { FromCanvasSchema } from "../src/lib/edit/protocol.ts";
import { BoardOpSchema } from "../src/lib/edit/boards.ts";
import { stripProject } from "../src/blocks/strip-project.ts";
import { readFileSync } from "node:fs";

let failures = 0;
let count = 0;
function ok(label, cond, detail = "") {
  count++;
  if (!cond) {
    failures++;
    console.log(`FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/* ---- Clés de style des légendes ---------------------------------------------------- */
for (const k of ["captions.marin-eclaireur.title", "captions.car-a1.caption", "captions.k1.date", "captionTitle", "children.0.props.captionTitle", "site.name".replace(".", ""), "title"]) ok(`clé acceptée : ${k}`, TEXT_PATH_RE.test(k), k);
for (const k of ["captions..title", "captions.A-b.title", "captions.x-y.autre", "captions.x-y", "bad key!", "../etc", `captions.a-${"a".repeat(60)}.title`, ""]) ok(`clé refusée : ${k}`, !TEXT_PATH_RE.test(k), k);
ok("le schéma accepte un style de légende de carrousel", LookSchema.safeParse({ text: { "captions.car-a1.title": { color: "secondary" } } }).success);
ok("…et celui d'une légende de la bande du projet", LookSchema.safeParse({ text: { "captions.marin-eclaireur.caption": { color: "primary" } } }).success);

/* ---- Lecture tolérante entrée par entrée ---------------------------------------------- */
{
  const mixed = readLook({ text: { caption: { color: "secondary" }, "mauvaise clé !": { color: "primary" }, captionTitle: { color: "pas-une-couleur" }, "captions.a-1.date": { color: "tertiary" } } });
  ok("un style illisible ne fait pas perdre les autres", mixed?.text?.caption?.color === "secondary" && mixed?.text?.["captions.a-1.date"]?.color === "tertiary", JSON.stringify(mixed));
  ok("…les entrées illisibles sont écartées", !mixed?.text || (!("mauvaise clé !" in mixed.text) && !("captionTitle" in mixed.text)));
  const many = { caption: { color: "secondary" } };
  for (let i = 0; i < 100; i++) many[`remplissage.${i % 100}.x${String.fromCharCode(97 + (i % 26))}`] = { color: "primary" };
  const wide = readLook({ text: many });
  ok("plus de 40 styles : gardés (plafond relevé)", Object.keys(wide?.text ?? {}).length > 40 && wide?.text?.caption?.color === "secondary", String(Object.keys(wide?.text ?? {}).length));
  ok("le plafond reste borné", MAX_TEXT_STYLES >= 200 && MAX_TEXT_STYLES <= 1000);
  const huge = {};
  for (let i = 0; i < MAX_TEXT_STYLES + 50; i++) huge[`captions.k${i}.date`] = { color: "primary" };
  ok("au-delà du plafond : on garde le plafond, pas rien", Object.keys(readLook({ text: huge })?.text ?? {}).length === MAX_TEXT_STYLES);
  ok("l'écriture (schéma strict) refuse toujours plus que le plafond", !LookSchema.safeParse({ text: huge }).success);
  ok("autres réglages gardés à côté d'un style illisible", readLook({ spaceTop: "l", text: { "x y": { color: "primary" } } })?.spaceTop === "l");
}

/* ---- Style des légendes du projet (suite de la planche) --------------------------------- */
{
  const strip = { uid: "strip", type: "strip", props: {} };
  const img = { uid: "bimg", type: "image", props: { mediaId: 1 } };
  const withStyle = { ...strip, captionStyle: { title: { color: "secondary" }, date: { italic: true } } };
  ok("une suite avec un style de légendes est valide", layoutProblem([withStyle, img]) === null);
  ok("sans style : valide", layoutProblem([strip, img]) === null);
  ok("champ inconnu refusé", layoutProblem([{ ...strip, captionStyle: { autre: { color: "primary" } } }]) !== null);
  ok("un style qui n'est pas un objet est refusé", layoutProblem([{ ...strip, captionStyle: { title: "rouge" } }]) !== null);
  ok("captionStyle non objet refusé", layoutProblem([{ ...strip, captionStyle: [1] }]) !== null);
  ok("projectCaptionStyle : le style porté par le premier composant qui en a un", projectCaptionStyle([strip, { ...img, captionStyle: { legend: { bold: true } } }])?.legend !== undefined);
  ok("projectCaptionStyle : aucun", projectCaptionStyle([strip, img]) === undefined && projectCaptionStyle([{ ...strip, captionStyle: {} }]) === undefined);
  const styles = captionStylesOf([withStyle, img]);
  ok("captionStylesOf relit chaque champ avec le schéma", styles?.title?.color === "secondary" && styles?.date?.italic === true && !styles?.legend, JSON.stringify(styles));
  ok("captionStylesOf ignore un champ illisible", captionStylesOf([{ ...strip, captionStyle: { title: { color: "rouge-vif" }, legend: { color: "primary" } } }])?.title === undefined);
  // Fusion : « Ce texte » passe devant le projet.
  const css = captionCss({ color: "secondary", italic: true }, { color: "primary" });
  ok("« Ce texte » l'emporte sur le projet (couleur)", css?.color === "var(--t-color-primary)", JSON.stringify(css));
  ok("…le reste du style du projet demeure (italique)", css?.fontStyle === "italic");
  ok("projet seul", captionCss({ color: "secondary" }, undefined)?.color === "var(--t-color-secondary)");
  ok("rien du tout : pas de style", captionCss(undefined, undefined) === undefined);
}

/* ---- Champ d'une légende ------------------------------------------------------------------ */
for (const [path, field] of [["captionTitle", "title"], ["caption", "legend"], ["description", "legend"], ["captionDate", "date"], ["captions.car-a1.title", "title"], ["captions.car-a1.caption", "legend"], ["captions.car-a1.date", "date"]]) ok(`champ de ${path}`, captionFieldOf(path) === field);
for (const path of ["title", "eyebrow", "context", "year", "site.name", "paragraphs.0"]) ok(`pas un champ de légende : ${path}`, captionFieldOf(path) === null, String(captionFieldOf(path)));

/* ---- Messages de la toile et opération de planche ---------------------------------------------- */
ok("intention board-captions valide", FromCanvasSchema.safeParse({ kind: "board-captions", board: 3, style: { title: { color: "primary" } } }).success);
ok("…style nul (retour au site)", FromCanvasSchema.safeParse({ kind: "board-captions", board: 3, style: null }).success);
ok("…champ inconnu refusé", !FromCanvasSchema.safeParse({ kind: "board-captions", board: 3, style: { x: {} } }).success);
ok("…style invalide refusé", !FromCanvasSchema.safeParse({ kind: "board-captions", board: 3, style: { title: { color: "rouge" } } }).success);
ok("opération captions-style valide", BoardOpSchema.safeParse({ op: "captions-style", style: { legend: { size: "l" } } }).success);
ok("…nulle", BoardOpSchema.safeParse({ op: "captions-style", style: null }).success);
ok("l'intention look accepte la clé d'une légende de bande", FromCanvasSchema.safeParse({ kind: "look", uid: "abc", look: { text: { "captions.car-a1.title": { color: "primary" } } } }).success);

/* ---- N8 : la planche ne transporte que ce qu'elle affiche ---------------------------- */
{
  const L = (s) => s;
  const project = {
    slug: "secret",
    year: "2026",
    featured: true,
    title: L("Nom affiché"),
    context: L("Client sous NDA"),
    description: L("Présentation cachée"),
    count: 3,
    artworks: [],
    layout: [
      { uid: "s1", type: "strip", props: {}, captionStyle: { title: { color: "secondary" } } },
      { uid: "g1", type: "grid", props: { title: { fr: "brouillon FR", en: "draft EN" }, converted: { type: "strip", props: { items: [{ mediaId: 999 }] } }, children: [{ type: "image", props: { mediaId: 4242 } }] } },
    ],
  };
  const out = stripProject(project, false);
  const json = JSON.stringify(out);
  ok("N8 aucune suite de composants transmise (`layout` absent)", !("layout" in out), Object.keys(out).join(","));
  ok("N8 ni l'ancienne forme `converted`, ni les réglages bruts, ni les médias retirés", !/converted|brouillon FR|draft EN|4242|999/.test(json), json);
  ok("N8 en-tête masqué : contexte, année et présentation absents", !/NDA|Présentation cachée|2026/.test(json) && out.context === "" && out.description === "" && out.year === "", json);
  ok("N8 le nom reste (étiquettes de la bande pour les lecteurs d'écran)", out.title === "Nom affiché");
  ok("N8 le style des légendes du projet est extrait", out.captionStyles?.title?.color === "secondary", JSON.stringify(out.captionStyles));
  ok("N8 champs inutiles retirés (`featured`)", !("featured" in out));
  const shown = stripProject(project, true);
  ok("N8 en-tête affiché : contexte, année et présentation présents", shown.context === "Client sous NDA" && shown.year === "2026" && shown.description === "Présentation cachée");
  const edit = stripProject({ ...project, edit: { id: 1, draft: false } }, false);
  ok("N8 toile de l'éditeur : l'en-tête reste (modifiable en place)", edit.context === "Client sous NDA" && edit.edit?.id === 1);
  const src = readFileSync(new URL("../src/components/ProjectStrip.tsx", import.meta.url), "utf8");
  ok("N8 ProjectStrip ne lit plus `project.layout`", !/project\.layout/.test(src));
  for (const f of ["ProjectBoardBlock", "FeaturedProjectsBlock", "CollectionProjectsBlock"]) {
    const block = readFileSync(new URL(`../src/blocks/${f}.tsx`, import.meta.url), "utf8");
    ok(`N8 ${f} passe un projet réduit à ProjectStrip`, /<ProjectStrip[^>]*project=\{stripProject\(/.test(block));
  }
}

console.log(failures ? `ECHEC : ${failures} sur ${count}` : `OK : ${count} vérifications`);
process.exit(failures ? 1 : 0);
