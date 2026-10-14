#!/usr/bin/env node
/**
 * Protocole éditeur ↔ toile (src/lib/edit/protocol.ts) : un message d'une
 * autre origine ou d'une autre fenêtre est ignoré, un message malformé aussi
 * (sans exception), un champ non déclaré `inline` est refusé.
 * Usage : node --import tsx scripts/test-protocol.mjs   (inclus dans npm test)
 */
import { acceptFromCanvas, acceptToCanvas, EDIT_MSG, inlineAllowed, moveTo, setLocalizedAt } from "../src/lib/edit/protocol.ts";
import { isMarkedRange, markedProblem, parseMarked, toggleRange, toMarkup, wordAt } from "../src/lib/marked.ts";
import { asSiteName, navKeys, SiteNameSchema, siteNameFor, socialKeys, uniqueKeys } from "../src/lib/site-schema.ts";

let failures = 0;
const ok = (label, cond) => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
};

const ORIGIN = "https://portfolio.example";
const frame = { name: "toile" };
const other = { name: "autre" };
const msg = (data, origin = ORIGIN, source = frame) => ({ origin, source, data: { type: EDIT_MSG, ...data } });

// v0.15 : textes d'un projet depuis la toile (présentation comprise, bornée).
ok("project-text : présentation acceptée (2000 car.)", acceptFromCanvas(msg({ kind: "project-text", board: 3, field: "description", locale: "fr", value: "x".repeat(2000) }), ORIGIN, frame)?.field === "description");
ok("project-text : présentation trop longue / champ inconnu refusés", acceptFromCanvas(msg({ kind: "project-text", board: 3, field: "description", locale: "fr", value: "x".repeat(2001) }), ORIGIN, frame) === null && acceptFromCanvas(msg({ kind: "project-text", board: 3, field: "featured", locale: "fr", value: "1" }), ORIGIN, frame) === null);
ok("message valide accepté", acceptFromCanvas(msg({ kind: "select", uid: "b1" }), ORIGIN, frame)?.uid === "b1");
ok("select : `click` (choisi d'un clic) accepté, valeur autre refusée", acceptFromCanvas(msg({ kind: "select", uid: "b1", click: true }), ORIGIN, frame)?.click === true && acceptFromCanvas(msg({ kind: "select", uid: "b1", click: "oui" }), ORIGIN, frame) === null);
ok("autre origine ignorée", acceptFromCanvas(msg({ kind: "select", uid: "b1" }, "https://evil.example"), ORIGIN, frame) === null);
ok("autre fenêtre (source) ignorée", acceptFromCanvas(msg({ kind: "select", uid: "b1" }, ORIGIN, other), ORIGIN, frame) === null);
ok("source absente ignorée", acceptFromCanvas(msg({ kind: "select", uid: "b1" }), ORIGIN, null) === null);
ok("type d'enveloppe étranger ignoré", acceptFromCanvas({ origin: ORIGIN, source: frame, data: { type: "autre", kind: "select", uid: "b1" } }, ORIGIN, frame) === null);
const malformed = [
  null,
  "texte",
  42,
  { type: EDIT_MSG },
  { type: EDIT_MSG, kind: "inconnu" },
  { type: EDIT_MSG, kind: "op", op: "rm -rf", uid: "b1" },
  { type: EDIT_MSG, kind: "move", uid: "b1", index: -1 },
  { type: EDIT_MSG, kind: "move", uid: "b1", index: 1.5 },
  { type: EDIT_MSG, kind: "text", uid: "b1", path: "__proto__.x", locale: "fr", value: "x" },
  { type: EDIT_MSG, kind: "text", uid: "b1", path: "title", locale: "de", value: "x" },
  { type: EDIT_MSG, kind: "text", uid: "b1", path: "title", locale: "fr", value: "x".repeat(2001) },
  { type: EDIT_MSG, kind: "select", uid: "<script>" },
];
let threw = false;
let accepted = 0;
for (const data of malformed) {
  try {
    if (acceptFromCanvas({ origin: ORIGIN, source: frame, data }, ORIGIN, frame) !== null) accepted++;
  } catch {
    threw = true;
  }
}
ok("messages malformés ignorés, sans exception", !threw && accepted === 0);
ok("éditeur → toile : mode valide accepté", acceptToCanvas(msg({ kind: "mode", mode: "edit" }), ORIGIN, frame)?.mode === "edit");
ok("éditeur → toile : mode inconnu ignoré", acceptToCanvas(msg({ kind: "mode", mode: "admin" }), ORIGIN, frame) === null);
ok("éditeur → toile : coordonnées non numériques ignorées", acceptToCanvas(msg({ kind: "drag", x: "1", y: 2, label: "x" }), ORIGIN, frame) === null);

// État optimiste (lot 6) : numéro d'intention de la toile, acquittement de l'éditeur.
ok("intention numérotée : seq conservé", acceptFromCanvas(msg({ kind: "text", uid: "b1", path: "title", locale: "fr", value: "x", seq: 7 }), ORIGIN, frame)?.seq === 7);
ok("intention sans numéro : acceptée, sans seq", acceptFromCanvas(msg({ kind: "select", uid: "b1" }), ORIGIN, frame)?.seq === undefined);
ok("numéro invalide (négatif, décimal, texte) : message accepté mais seq retiré", [-3, 1.5, "7", 0, 4e9].every((seq) => acceptFromCanvas(msg({ kind: "select", uid: "b1", seq }), ORIGIN, frame)?.seq === undefined));
ok("éditeur → toile : refresh avec révision et acquittement", (() => {
  const m = acceptToCanvas(msg({ kind: "refresh", rev: 12, upTo: 5 }), ORIGIN, frame);
  return m?.kind === "refresh" && m.rev === 12 && m.upTo === 5;
})());
ok("éditeur → toile : refresh sans paramètres accepté", acceptToCanvas(msg({ kind: "refresh" }), ORIGIN, frame)?.kind === "refresh");
ok("éditeur → toile : settle valide accepté", acceptToCanvas(msg({ kind: "settle", rev: 3, upTo: -1 }), ORIGIN, frame)?.kind === "settle");
ok("éditeur → toile : settle sans révision ignoré", acceptToCanvas(msg({ kind: "settle", upTo: 2 }), ORIGIN, frame) === null);
ok("éditeur → toile : revert valide accepté", acceptToCanvas(msg({ kind: "revert", seq: 7 }), ORIGIN, frame)?.kind === "revert");
ok("éditeur → toile : revert sans numéro, nul, négatif ou énorme ignoré", [{}, { seq: 0 }, { seq: -1 }, { seq: 1.5 }, { seq: 2e9 }, { seq: "7" }].every((x) => acceptToCanvas(msg({ kind: "revert", ...x }), ORIGIN, frame) === null));
ok("éditeur → toile : revert d'une autre origine ignoré", acceptToCanvas({ ...msg({ kind: "revert", seq: 7 }), origin: "https://evil.example" }, ORIGIN, frame) === null);
ok("éditeur → toile : révision négative ou décimale ignorée", acceptToCanvas(msg({ kind: "refresh", rev: -1 }), ORIGIN, frame) === null && acceptToCanvas(msg({ kind: "refresh", rev: 1.5 }), ORIGIN, frame) === null);

// Planches (phase 7b).
ok("planches : déplacement d'image valide accepté", acceptFromCanvas(msg({ kind: "slot-move", board: 3, key: "s12", index: 2 }), ORIGIN, frame)?.key === "s12");
ok("planches : clé d'emplacement mal formée ignorée", acceptFromCanvas(msg({ kind: "slot-op", board: 3, key: "../12", op: "remove" }), ORIGIN, frame) === null);
ok("planches : opération inconnue ignorée", acceptFromCanvas(msg({ kind: "slot-op", board: 3, key: "s12", op: "detruire" }), ORIGIN, frame) === null);
ok("planches : fichiers qui n'en sont pas → ignoré", acceptFromCanvas(msg({ kind: "files", target: { kind: "board", board: 3, index: 0 }, files: ["/etc/passwd"] }), ORIGIN, frame) === null);
ok("planches : vrais fichiers acceptés", acceptFromCanvas(msg({ kind: "files", target: { kind: "board", board: 3, index: 0 }, files: [new File(["x"], "a.png", { type: "image/png" })] }), ORIGIN, frame)?.files.length === 1);
ok("planches : cible de dépôt inconnue ignorée", acceptFromCanvas(msg({ kind: "drop-target", target: { kind: "ailleurs" } }), ORIGIN, frame) === null);
const ghost = { id: "g1", board: 3, index: 0, label: "x", aspect: 1, progress: 0.5, phase: "upload" };
ok("fantôme : aperçu blob: accepté", acceptToCanvas(msg({ kind: "ghosts", items: [{ ...ghost, preview: "blob:https://portfolio.example/abc" }] }), ORIGIN, frame)?.items.length === 1);
ok("fantôme : aperçu javascript: ignoré", acceptToCanvas(msg({ kind: "ghosts", items: [{ ...ghost, preview: "javascript:alert(1)" }] }), ORIGIN, frame) === null);

ok("lot 22 : entrées à la main, ajout / retrait / ordre acceptés", ["add", "remove", "up", "down"].every((op) => acceptFromCanvas(msg({ kind: "tile-op", uid: "t1", op, index: 2, pageId: 5 }), ORIGIN, frame)?.op === op));
ok("lot 22 : champs facultatifs d'un Titre (présentation, compteurs) acceptés", ["add-intro", "remove-intro", "add-counts", "remove-counts"].every((op) => acceptFromCanvas(msg({ kind: "field-op", uid: "t1", op }), ORIGIN, frame)?.op === op));
ok("lot 22 : taille des images des entrées acceptée", acceptFromCanvas(msg({ kind: "tile-size", uid: "t1", size: "large" }), ORIGIN, frame)?.size === "large");

// Conteneurs, médias de blocs, en-tête commun (v0.13).
ok("v0.13 : déplacement dans un conteneur accepté", acceptFromCanvas(msg({ kind: "move", uid: "b3", index: 1, parent: "n1abc" }), ORIGIN, frame)?.parent === "n1abc");
ok("v0.13 : déplacement vers la page (parent null) accepté", acceptFromCanvas(msg({ kind: "move", uid: "b3", index: 0, parent: null }), ORIGIN, frame)?.parent === null);
const badV13 = [
  { kind: "move", uid: "b3", index: 1, parent: "../x" },
  { kind: "move", uid: "b3", index: 1, parent: "<b>" },
  { kind: "move", uid: "b3", index: 999, parent: "c1" },
  { kind: "drag-index", index: -1, parent: null },
  { kind: "op", op: "explode", uid: "b3" },
  { kind: "media-op", uid: "b3", field: "props", op: "replace" },
  { kind: "media-op", uid: "b3", field: "mediaId", op: "delete-all" },
  { kind: "layout", uid: "g1", layout: "9" },
  { kind: "tile-size", uid: "t1", size: "huge" },
  { kind: "tile-size", uid: "../t", size: "small" },
  { kind: "tile-op", uid: "t1", op: "explode" },
  { kind: "tile-op", uid: "t1", op: "remove", index: 24 },
  { kind: "tile-op", uid: "t1", op: "remove", index: -1 },
  { kind: "tile-op", uid: "t1", op: "add", pageId: 0 },
  { kind: "tile-op", uid: "../t", op: "up", index: 0 },
  { kind: "field-op", uid: "t1", op: "add-counter" },
  { kind: "site-text", field: "password", locale: "fr", value: "x" },
  { kind: "site-text", field: "nav", index: 99, locale: "fr", value: "x" },
  { kind: "site-text", field: "name", locale: "fr", value: "x".repeat(201) },
  { kind: "site-op", op: "nav-add-page", pageId: -1 },
  { kind: "site-op", op: "nav-add-link", href: "", label: "x" },
  { kind: "site-op", op: "drop-table", index: 0 },
  { kind: "drop-target", target: { kind: "media", uid: "b3", field: "__proto__" } },
  { kind: "drop-target", target: { kind: "cell", uid: "../g" } },
];
let v13Accepted = 0;
let v13Threw = false;
for (const data of badV13) {
  try {
    if (acceptFromCanvas(msg(data), ORIGIN, frame) !== null) v13Accepted++;
  } catch {
    v13Threw = true;
  }
}
ok("v0.13 : messages malformés (chemins d'enfant, champs, opérations) ignorés", !v13Threw && v13Accepted === 0, `${v13Accepted} acceptés`);
ok("v0.13 : opération de réseau valide acceptée", acceptFromCanvas(msg({ kind: "site-op", op: "social-add", href: "https://www.behance.net/x", label: "Behance", network: "behance" }), ORIGIN, frame)?.op === "social-add");
ok("v0.13 : cible « média d'un bloc » acceptée", acceptFromCanvas(msg({ kind: "drop-target", target: { kind: "media", uid: "b3", field: "backgroundMediaId" } }), ORIGIN, frame)?.target.field === "backgroundMediaId");
ok("v0.13 : glisser de la palette — le type du bloc ne remplace pas l'enveloppe", acceptToCanvas(msg({ kind: "drag", x: 1, y: 2, label: "x", blockType: "grid", nesting: 1 }), ORIGIN, frame)?.blockType === "grid");
ok("v0.13 : liste de projets (« pas encore sur une page »)", acceptToCanvas(msg({ kind: "projects", list: [{ slug: "a", title: "A", onPage: false }] }), ORIGIN, frame)?.list[0].onPage === false);

// v0.16 : champ ajouté avec un identifiant choisi par la toile, état « en cours » d'Annuler / Rétablir.
ok("form-field add : identifiant de la toile accepté", acceptFromCanvas(msg({ kind: "form-field", uid: "b3", op: "add", fieldType: "text", id: "fk3j9a2b" }), ORIGIN, frame)?.id === "fk3j9a2b");
ok("form-field add : identifiant mal formé refusé", ["x", "F1234567", "f<b>", "f", "f".repeat(30), "../x"].every((id) => acceptFromCanvas(msg({ kind: "form-field", uid: "b3", op: "add", fieldType: "text", id }), ORIGIN, frame) === null));
ok("pending : libellé accepté, null accepté, trop long / autre type refusés", acceptToCanvas(msg({ kind: "pending", label: "Annulation en cours…" }), ORIGIN, frame)?.label === "Annulation en cours…" && acceptToCanvas(msg({ kind: "pending", label: null }), ORIGIN, frame)?.label === null && acceptToCanvas(msg({ kind: "pending", label: "x".repeat(61) }), ORIGIN, frame) === null && acceptToCanvas(msg({ kind: "pending", label: 3 }), ORIGIN, frame) === null);
ok("pending : la toile ne peut pas en émettre (sens éditeur → toile seulement)", acceptFromCanvas(msg({ kind: "pending", label: "x" }), ORIGIN, frame) === null);

// Accroche à passage surligné : balisage <mark> seul, jamais de HTML.
ok("marked : texte simple et passage surligné valides", markedProblem("Je dessine des <mark>mondes</mark>") === null && markedProblem("sans balisage") === null && markedProblem("") === null);
ok("marked : autre balisage, imbrication, passage vide ou ouvert refusés", ["<b>x</b>", "a <img src=x onerror=alert(1)>", "<mark>a<mark>b</mark></mark>", "<mark></mark>", "<mark>a", "a</mark>", "<MARK>a</MARK>", "<mark><b>x</b></mark>", "<mark>a<img src=x></mark>"].every((t) => markedProblem(t) !== null));
// Accroches de la v0.15 : un « < » ou un « > » isolé est du texte (jamais interprété), la publication n'est pas bloquée.
ok("marked : « < » et « > » isolés acceptés comme texte", ["I <3 dessiner", "x > y", "a < b", "<3", "1 << 2 >> 1", "I <3 <mark>mondes</mark>", "<mark>a <3 b</mark> > c", "</3"].every((t) => markedProblem(t) === null));
ok("marked : un chevron isolé est rendu en nœud texte (jamais du HTML)", JSON.stringify(parseMarked("I <3 <mark>x</mark>")) === JSON.stringify([{ text: "I <3 ", mark: false }, { text: "x", mark: true }]));
ok("marked : lecture identique au rendu d'avant (parseMarked)", JSON.stringify(parseMarked("a <mark>b</mark> c <mark>d</mark>")) === JSON.stringify([{ text: "a ", mark: false }, { text: "b", mark: true }, { text: " c ", mark: false }, { text: "d", mark: true }]));
ok("marked : toMarkup fond les voisins, retire les passages vides et ce qui ressemble à une balise", toMarkup([{ text: "a", mark: false }, { text: "b<i>", mark: false }, { text: "", mark: true }, { text: "c", mark: true }, { text: "d", mark: true }]) === "abi><mark>cd</mark>");
ok("marked : toMarkup garde « <3 », et deux passages voisins ne recomposent pas une balise", toMarkup([{ text: "I <3 ", mark: false }, { text: "x", mark: true }]) === "I <3 <mark>x</mark>" && markedProblem(toMarkup([{ text: "a<", mark: false }, { text: "mark>b", mark: false }, { text: "</", mark: false }, { text: "<b", mark: false }])) === null && toMarkup([{ text: "<<b", mark: true }, { text: "</<i", mark: false }]) === "<mark>b</mark>/i");
// Longueur maximale : coupée sur le texte, jamais dans une balise ; le résultat reste valide.
{
  const long = [{ text: "a".repeat(30), mark: false }, { text: "b".repeat(30), mark: true }, { text: "c".repeat(30), mark: false }];
  let cutOk = true;
  for (let max = 0; max <= 120; max++) {
    const out = toMarkup(long, max);
    if (out.length > max || markedProblem(out) !== null || (out.includes("<mark>") && !out.includes("</mark>"))) cutOk = false;
  }
  ok("marked : toMarkup(max) coupe le texte, jamais une balise, pour toute longueur", cutOk);
  ok("marked : toMarkup(max) sans dépassement garde tout", toMarkup(long, 1000) === toMarkup(long));
}
// Aller-retour : aucune sortie de toMarkup n'est refusée par markedProblem.
ok("marked : toMarkup(« Cœur < » + passage + « s ») est accepté", markedProblem(toMarkup([{ text: "Cœur <", mark: false }, { text: "amour", mark: true }, { text: "s", mark: false }])) === null);
{
  const alphabet = ["<", ">", "/", "a", "b", "m", "mark", "<mark>", "</mark>", "<b", "</", " ", "œ", "😀", "é", "\u0000"];
  let seed = 12345;
  const rnd = (n) => Math.floor((seed = (seed * 1103515245 + 12345) % 2147483648) / 65536) % n;
  let bad = null;
  for (let i = 0; i < 3000 && !bad; i++) {
    const ps = Array.from({ length: 1 + rnd(5) }, () => ({ text: Array.from({ length: rnd(5) }, () => alphabet[rnd(alphabet.length)]).join(""), mark: rnd(2) === 0 }));
    for (const max of [Infinity, 40, 7]) {
      const out = toMarkup(ps.map((p) => ({ ...p })), max);
      if (markedProblem(out) !== null || out.length > max) bad = JSON.stringify({ ps, max, out });
    }
  }
  ok("marked : fuzz, aucune sortie de toMarkup n'est refusée", bad === null, bad ?? "");
}
// Troncature : jamais au milieu d'une paire de substitution ni d'un graphème.
{
  const emoji = [{ text: "ab😀😀", mark: false }];
  const lone = (s) => /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s);
  let cutEmoji = true;
  for (let max = 0; max <= 7; max++) if (lone(toMarkup(emoji, max))) cutEmoji = false;
  ok("marked : toMarkup(max) ne coupe pas un émoji en deux", cutEmoji && toMarkup(emoji, 3) === "ab" && toMarkup(emoji, 4) === "ab😀");
  ok("marked : toMarkup(max) ne coupe pas un graphème composé", toMarkup([{ text: "a👨‍👩‍👧", mark: false }], 5) === "a");
}
const parts = parseMarked("Je dessine des mondes");
ok("marked : surligner un intervalle, les espaces de bordure ne le sont pas", toMarkup(toggleRange(parts, 15, 22)) === "Je dessine des <mark>mondes</mark>" && toMarkup(toggleRange(parts, 14, 22)) === "Je dessine des <mark>mondes</mark>");
ok("marked : re-basculer retire le surlignage ; un surlignage partiel est complété", toMarkup(toggleRange(toggleRange(parts, 15, 21), 15, 21)) === "Je dessine des mondes" && toMarkup(toggleRange(parseMarked("ab <mark>cd</mark> ef"), 0, 8)) === "<mark>ab cd ef</mark>");
ok("marked : isMarkedRange et wordAt", isMarkedRange(parseMarked("a <mark>bc</mark>"), 2, 4) && !isMarkedRange(parseMarked("a <mark>bc</mark>"), 0, 4) && wordAt("Je dessine des mondes", 16).join() === "15,21" && wordAt("a  b", 2).join() === "2,2");

// v0.16 : nom du site fr / en.
ok("nom du site : { fr, en } accepté, en vide accepté", SiteNameSchema.safeParse({ fr: "Camille", en: "" }).success && SiteNameSchema.safeParse({ fr: "Camille", en: "Studio" }).success);
ok("nom du site : l'ancienne chaîne est lue comme { fr, en vide }", JSON.stringify(SiteNameSchema.parse("Camille")) === JSON.stringify({ fr: "Camille", en: "" }) && JSON.stringify(asSiteName("Camille")) === JSON.stringify({ fr: "Camille", en: "" }));
ok("nom du site : fr vide / trop long / champ inconnu refusés", [{ fr: "", en: "x" }, { fr: " ", en: "" }, { fr: "x".repeat(81), en: "" }, { fr: "a", en: "x".repeat(81) }, { fr: "a", en: "", de: "x" }, 3, null].every((v) => !SiteNameSchema.safeParse(v).success));
ok("nom du site : l'anglais vide reprend le français", siteNameFor({ fr: "Camille", en: "" }, "en") === "Camille" && siteNameFor({ fr: "Camille", en: " " }, "en") === "Camille" && siteNameFor({ fr: "Camille", en: "Studio" }, "en") === "Studio" && siteNameFor({ fr: "Camille", en: "Studio" }, "fr") === "Camille" && siteNameFor("Ancien", "en") === "Ancien");
ok("clés des listes : stables, doublons distingués", JSON.stringify(uniqueKeys(["a", "b", "a", "a"])) === JSON.stringify(["a", "b", "a#2", "a#3"]) && JSON.stringify(navKeys([{ pageId: 2, href: "/x" }, { href: "https://e.fr" }])) === JSON.stringify(["p2", "l:https://e.fr"]) && socialKeys([{ label: " Insta ", href: "https://i.fr " }])[0] === "Insta|https://i.fr");

ok("inline : chemin déclaré accepté", inlineAllowed(["eyebrow", "title", "paragraphs.*"], "paragraphs.3"));
ok("inline : chemin non déclaré refusé", !inlineAllowed(["eyebrow", "title"], "intro"));
ok("inline : indice sur un champ non listé refusé", !inlineAllowed(["title"], "title.0"));
ok("inline : joker sur un nom refusé", !inlineAllowed(["paragraphs.*"], "paragraphs.x"));

const props = { title: { fr: "a", en: "b" }, paragraphs: [{ fr: "p", en: "q" }] };
const next = setLocalizedAt(props, "paragraphs.0", "en", "Q");
ok("setLocalizedAt : seule la langue visée change", next.paragraphs[0].en === "Q" && next.paragraphs[0].fr === "p" && props.paragraphs[0].en === "q");
ok("setLocalizedAt : clé dangereuse ignorée", setLocalizedAt(props, "__proto__", "fr", "x").polluted === undefined && {}.fr === undefined);
ok("moveTo : déplacement vers le bas", moveTo(["a", "b", "c"], 0, 2).join("") === "bac");
ok("moveTo : sans effet sur place", moveTo(["a", "b", "c"], 1, 2).join("") === "abc");

console.log(failures ? `test-protocol : ${failures} échec(s)` : "test-protocol : OK");
process.exit(failures ? 1 : 0);
