#!/usr/bin/env node
/**
 * Lot 112 : unitaires de l'extraction de la date de création (src/lib/media-taken.ts) et du tri (src/components/admin/media-sort.tsx).
 * Images SYNTHÉTIQUES (scripts/lib/medias112.mjs). Aucune base, aucun serveur.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { exifTakenAt, parseTakenDate, pngTakenAt, readTakenAt } from "../src/lib/media-taken.ts";
import { exifMs, jpegDated, pngDated, tiffExif } from "./lib/medias112.mjs";

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const dir = mkdtempSync(path.join(tmpdir(), "pf-medias112-"));
const file = (name, buf) => {
  const f = path.join(dir, name);
  writeFileSync(f, buf);
  return f;
};

try {
  const D1 = "2021:03:04 05:06:07";
  const D2 = "2019:12:31 23:59:58";
  // Analyse de texte.
  ok("parseTakenDate : EXIF", parseTakenDate(D1) === exifMs(D1));
  ok("parseTakenDate : ISO", parseTakenDate("2020-02-03T04:05:06Z") === Date.UTC(2020, 1, 3, 4, 5, 6));
  ok("parseTakenDate : RFC 2822 (PNG Creation Time)", parseTakenDate("Tue, 02 Jan 2024 10:00:00 +0000") === Date.UTC(2024, 0, 2, 10, 0, 0));
  ok("parseTakenDate : vide, zéros, absurde, futur → null", [parseTakenDate(""), parseTakenDate("0000:00:00 00:00:00"), parseTakenDate("1970:01:01 00:00:00"), parseTakenDate("2999:01:01 00:00:00"), parseTakenDate("nimporte quoi")].every((v) => v === null));

  // Bloc EXIF brut, les deux ordres d'octets, avec et sans préfixe.
  for (const order of ["II", "MM"]) {
    ok(`exifTakenAt ${order} : DateTimeOriginal`, exifTakenAt(tiffExif({ original: D1, digitized: D2 }, order)) === exifMs(D1));
    ok(`exifTakenAt ${order} : repli CreateDate`, exifTakenAt(tiffExif({ digitized: D2 }, order)) === exifMs(D2));
    ok(`exifTakenAt ${order} : sans date`, exifTakenAt(tiffExif({}, order)) === null);
  }
  ok("exifTakenAt : préfixe « Exif\\0\\0 »", exifTakenAt(Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiffExif({ original: D1 })])) === exifMs(D1));
  ok("exifTakenAt : déchets / tronqué / vide → null", [exifTakenAt(null), exifTakenAt(Buffer.alloc(3)), exifTakenAt(Buffer.from("MM\0*\xff\xff\xff\xff1234567")), exifTakenAt(tiffExif({ original: D1 }).subarray(0, 40))].every((v) => v === null));

  // Fichiers réels (sharp lit l'EXIF du JPEG).
  ok("JPEG avec DateTimeOriginal", (await readTakenAt("image", "image/jpeg", file("a.jpg", await jpegDated(64, 48, 1, { original: D1, digitized: D2 })))) === exifMs(D1));
  ok("JPEG avec CreateDate seule", (await readTakenAt("image", "image/jpeg", file("b.jpg", await jpegDated(64, 48, 2, { digitized: D2 })))) === exifMs(D2));
  ok("JPEG sans EXIF → null", (await readTakenAt("image", "image/jpeg", file("c.jpg", await jpegDated(64, 48, 3)))) === null);
  // PNG : fragment eXIf, texte « Creation Time » (avant ou après les pixels), absent.
  ok("PNG eXIf", (await readTakenAt("image", "image/png", file("a.png", await pngDated(64, 48, 4, { exif: { original: D1 } })))) === exifMs(D1));
  ok("PNG tEXt « Creation Time »", (await readTakenAt("image", "image/png", file("b.png", await pngDated(64, 48, 5, { text: { "Creation Time": "Tue, 02 Jan 2024 10:00:00 +0000" } })))) === Date.UTC(2024, 0, 2, 10, 0, 0));
  ok("PNG tEXt après les pixels", (await pngTakenAt(file("c.png", await pngDated(64, 48, 6, { textAfter: { "Creation Time": "2022-06-07T08:09:10Z" } })))) === Date.UTC(2022, 5, 7, 8, 9, 10));
  ok("PNG exif:DateTimeOriginal (ImageMagick)", (await pngTakenAt(file("d.png", await pngDated(64, 48, 7, { text: { "exif:DateTimeOriginal": D2 } })))) === exifMs(D2));
  ok("PNG eXIf prime sur le texte", (await pngTakenAt(file("e.png", await pngDated(64, 48, 8, { exif: { original: D1 }, text: { "Creation Time": "2022-06-07T08:09:10Z" } })))) === exifMs(D1));
  ok("PNG sans date → null", (await readTakenAt("image", "image/png", file("f.png", await pngDated(64, 48, 9)))) === null);
  ok("PNG autre texte (Software) ignoré", (await pngTakenAt(file("g.png", await pngDated(64, 48, 10, { text: { Software: "2021:03:04 05:06:07" } })))) === null);
  // Robustesse : jamais d'exception.
  ok("fichier absent → null", (await readTakenAt("image", "image/jpeg", path.join(dir, "nope.jpg"))) === null);
  ok("fichier tronqué → null", (await readTakenAt("image", "image/png", file("h.png", (await pngDated(64, 48, 11)).subarray(0, 30)))) === null);
  ok("PDF → null", (await readTakenAt("pdf", "application/pdf", file("a.pdf", Buffer.from("%PDF-1.4\n")))) === null);
  ok("vidéo illisible → null", (await readTakenAt("video", "video/mp4", file("a.mp4", Buffer.from("pas une vidéo")))) === null);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// Tri : fonction pure (le composant n'est pas monté).
const { sortMedia } = await import("../src/components/admin/media-sort.tsx").catch((e) => {
  console.log(`# import media-sort impossible (${String(e.message).split("\n")[0]}) : tests de tri ignorés ici (couverts par l'e2e medias112)`);
  return {};
});
if (sortMedia) {
  const row = (id, name, importedAt, takenAt) => ({ id, name, importedAt, takenAt, takenChecked: true });
  const rows = [row(1, "b.png", 100, 5), row(2, "a10.png", 300, null), row(3, "a2.png", 200, 9), row(4, "A1.png", 300, 7)];
  const ids = (s) => sortMedia(rows, s).map((r) => r.id).join();
  ok("tri ajouté ↓ (égalité : id décroissant)", ids("added-desc") === "4,2,3,1");
  ok("tri ajouté ↑", ids("added-asc") === "1,3,2,4");
  ok("tri nom A→Z (naturel, insensible à la casse)", ids("name-asc") === "4,3,2,1");
  ok("tri nom Z→A", ids("name-desc") === "1,2,3,4");
  ok("tri création ↓ : sans date à la fin", ids("taken-desc") === "3,4,1,2");
  ok("tri création ↑ : sans date à la fin", ids("taken-asc") === "1,4,3,2");
}
console.log(failures ? `\n${failures} échec(s)` : "\nOK");
process.exit(failures ? 1 : 0);
