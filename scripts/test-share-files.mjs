#!/usr/bin/env node
import assert from "node:assert/strict";

const a = await import(new URL("../src/lib/pdf/limits.ts", import.meta.url));
const b = await import(new URL("../src/lib/upload/sniff.ts", import.meta.url));
const sniffAudio = b.sniffAudio;
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
  assert.equal(decideUploadKind(headUnknown, { kind: "kit", themeId: "x" }), null);
});
test("decision : PDF avec purpose file -> pdf", () => {
  assert.equal(decideUploadKind(headPdf, "file"), "pdf");
});
test("decision : image avec purpose file -> image", () => {
  assert.equal(decideUploadKind(headPng, "file"), "image");
});


// Audio detection
const headMp3Id3 = bytes("ID3", [3, 0, 0, 0, 0, 0]);
const headMp3Sync = bytes([0xff, 0xfb, 0x90, 0x00]);
const headWav = bytes("RIFF", [0,0,0,0], "WAVE", "fmt ");
const headOgg = bytes("OggS", [0, 2, 0, 0]);
const headFlac = bytes("fLaC", [0, 0, 0, 0]);
const headM4a = bytes([0,0,0,0x20], "ftyp", "M4A ", [0,0,0,0]);
const headHtml = bytes("<!doctype html><script>alert(1)</script>");
const headMp4Video = bytes([0,0,0,0x20], "ftyp", "isom", [0,0,0,0], "isom");

test("audio : MP3 ID3 detecte", () => { assert.equal(sniffAudio(headMp3Id3).mime, "audio/mpeg"); });
test("audio : MP3 sync detecte", () => { assert.equal(sniffAudio(headMp3Sync).mime, "audio/mpeg"); });
test("audio : WAV detecte", () => { assert.equal(sniffAudio(headWav).mime, "audio/wav"); });
test("audio : OGG detecte", () => { assert.equal(sniffAudio(headOgg).mime, "audio/ogg"); });
test("audio : FLAC detecte", () => { assert.equal(sniffAudio(headFlac).mime, "audio/flac"); });
test("audio : M4A detecte", () => { assert.equal(sniffAudio(headM4a).mime, "audio/mp4"); });
test("audio : HTML n est pas audio", () => { assert.equal(sniffAudio(headHtml), null); });
test("audio : MP4 video reste video", () => { assert.equal(b.sniffVideo(headMp4Video) !== null, true); assert.equal(sniffAudio(headMp4Video), null); });
test("decision : audio avec purpose file -> audio", () => { assert.equal(b.decideUploadKind(headWav, "file"), "audio"); });
test("decision : audio sans purpose (médiathèque) -> refus", () => { assert.equal(b.decideUploadKind(headWav), null); });
test("decision : HTML avec purpose file -> file", () => { assert.equal(b.decideUploadKind(headHtml, "file"), "file"); });

console.log(`\n${passed} tests passes`);
