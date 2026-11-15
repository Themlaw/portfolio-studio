#!/usr/bin/env node
import assert from "node:assert/strict";

const a = await import(new URL("../src/lib/pdf/limits.ts", import.meta.url));
const b = await import(new URL("../src/lib/upload/sniff.ts", import.meta.url));
const fileDownloadName = a.fileDownloadName;
const decideUploadKind = b.decideUploadKind;

const bytes = (...parts) => new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`PASS  ${name}`); };

test("nom : Rapport final.DOCX -> rapport-final.docx", () => {
  assert.equal(fileDownloadName("Rapport final.DOCX"), "rapport-final.docx");
});
test("nom : extension etrange -> sans extension", () => {
  assert.equal(fileDownloadName("a.<script>"), "a");
});
test("nom : vide -> fichier", () => {
  assert.equal(fileDownloadName(""), "fichier");
});

const headPdf = bytes("%PDF-1.4\n");
const headPng = bytes([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
const headUnknown = bytes("hello world");

test("decision : contenu inconnu sans purpose -> refus", () => {
  assert.equal(decideUploadKind(headUnknown), null);
  assert.equal(decideUploadKind(headUnknown, undefined), null);
});
test("decision : contenu inconnu avec purpose file -> file", () => {
  assert.equal(decideUploadKind(headUnknown, "file"), "file");
  assert.equal(decideUploadKind(headUnknown, { kind: "file" }), "file");
});
test("decision : PDF avec purpose file -> pdf", () => {
  assert.equal(decideUploadKind(headPdf, "file"), "pdf");
});
test("decision : image avec purpose file -> image", () => {
  assert.equal(decideUploadKind(headPng, "file"), "image");
});

console.log(`\n${passed} tests passes`);
