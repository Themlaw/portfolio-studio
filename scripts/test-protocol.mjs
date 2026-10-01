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
