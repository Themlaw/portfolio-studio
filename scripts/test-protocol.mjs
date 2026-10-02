#!/usr/bin/env node
/**
 * Protocole éditeur ↔ toile (src/lib/edit/protocol.ts) : un message d'une
 * autre origine ou d'une autre fenêtre est ignoré, un message malformé aussi
 * (sans exception), un champ non déclaré `inline` est refusé.
 * Usage : node --import tsx scripts/test-protocol.mjs   (inclus dans npm test)
 */
import { acceptFromCanvas, acceptToCanvas, EDIT_MSG, inlineAllowed, moveTo, setLocalizedAt } from "../src/lib/edit/protocol.ts";

let failures = 0;
const ok = (label, cond) => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
};

const ORIGIN = "https://portfolio.example";
const frame = { name: "toile" };
const other = { name: "autre" };
const msg = (data, origin = ORIGIN, source = frame) => ({ origin, source, data: { type: EDIT_MSG, ...data } });

ok("message valide accepté", acceptFromCanvas(msg({ kind: "select", uid: "b1" }), ORIGIN, frame)?.uid === "b1");
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
