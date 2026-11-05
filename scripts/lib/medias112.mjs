/**
 * Images SYNTHÉTIQUES du lot 112 : aplats colorés (jamais une vraie photo) portant une date de création inventée, en EXIF (JPEG, PNG
 * fragment eXIf) ou en texte PNG (« Creation Time »). Aucune donnée réelle.
 */
import { crc32 } from "node:zlib";

import sharp from "sharp";

/** Bloc EXIF TIFF (sans préfixe) : IFD0 → pointeur ExifIFD → DateTimeOriginal (0x9003) et/ou DateTimeDigitized (0x9004). */
export function tiffExif({ original, digitized }, order = "II") {
  const le = order === "II";
  const entries = [];
  if (original) entries.push([0x9003, original]);
  if (digitized) entries.push([0x9004, digitized]);
  const w16 = (b, o, v) => (le ? b.writeUInt16LE(v, o) : b.writeUInt16BE(v, o));
  const w32 = (b, o, v) => (le ? b.writeUInt32LE(v, o) : b.writeUInt32BE(v, o));
  const ifd0Len = 2 + 12 + 4;
  const exifIfdOff = 8 + ifd0Len;
  const exifIfdLen = 2 + entries.length * 12 + 4;
  const buf = Buffer.alloc(exifIfdOff + exifIfdLen + entries.length * 20);
  buf.write(order, 0, "latin1");
  w16(buf, 2, 42);
  w32(buf, 4, 8);
  w16(buf, 8, 1);
  w16(buf, 10, 0x8769);
  w16(buf, 12, 4);
  w32(buf, 14, 1);
  w32(buf, 18, exifIfdOff);
  w32(buf, 22, 0);
  w16(buf, exifIfdOff, entries.length);
  entries.forEach(([tag, value], i) => {
    const e = exifIfdOff + 2 + i * 12;
    const data = exifIfdOff + exifIfdLen + i * 20;
    w16(buf, e, tag);
    w16(buf, e + 2, 2);
    w32(buf, e + 4, 20);
    w32(buf, e + 8, data);
    buf.write(`${value}\0`, data, "latin1");
  });
  return buf;
}

/** Aplat coloré (sans aucune métadonnée), `seed` change la teinte : un contenu distinct = un fichier distinct. */
export async function flat(w, h, seed) {
  const r = (seed * 53) % 256;
  const g = (seed * 97 + 40) % 256;
  const b = (seed * 29 + 120) % 256;
  return sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } });
}

/** JPEG avec date EXIF ({ original, digitized } au format « AAAA:MM:JJ HH:MM:SS »), ou sans date. */
export async function jpegDated(w, h, seed, dates = {}) {
  const img = await flat(w, h, seed);
  // Un point de bruit propre à `seed` : deux graines = deux contenus (sha256 distincts).
  const buf = await img.composite([{ input: { create: { width: 3, height: 3, channels: 3, background: { r: seed % 256, g: (seed >> 8) % 256, b: 7 } } }, left: 1, top: 1 }]).jpeg({ quality: 80 }).toBuffer();
  if (!dates.original && !dates.digitized) return buf;
  const block = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiffExif(dates)]);
  const seg = Buffer.alloc(4 + block.length);
  seg[0] = 0xff;
  seg[1] = 0xe1;
  seg.writeUInt16BE(2 + block.length, 2);
  block.copy(seg, 4);
  // APP1 juste après SOI (et après un éventuel APP0 JFIF : l'ordre n'a pas d'importance pour les lecteurs EXIF).
  return Buffer.concat([buf.subarray(0, 2), seg, buf.subarray(2)]);
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "latin1");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/** PNG (aplat) avec, au choix, un fragment eXIf ({ original, digitized }) et/ou des textes tEXt { clé: valeur } (avant ou après les pixels). */
export async function pngDated(w, h, seed, { exif, text = {}, textAfter = {} } = {}) {
  const img = await flat(w, h, seed);
  const png = await img.composite([{ input: { create: { width: 3, height: 3, channels: 3, background: { r: seed % 256, g: (seed >> 8) % 256, b: 9 } } }, left: 1, top: 1 }]).png().toBuffer();
  const ihdrEnd = 8 + 12 + 13;
  const before = [];
  if (exif) before.push(chunk("eXIf", tiffExif(exif, "MM")));
  for (const [k, v] of Object.entries(text)) before.push(chunk("tEXt", Buffer.from(`${k}\0${v}`, "latin1")));
  const after = Object.entries(textAfter).map(([k, v]) => chunk("tEXt", Buffer.from(`${k}\0${v}`, "latin1")));
  const iend = png.length - 12;
  return Buffer.concat([png.subarray(0, ihdrEnd), ...before, png.subarray(ihdrEnd, iend), ...after, png.subarray(iend)]);
}

/** Millisecondes UTC d'une date EXIF « AAAA:MM:JJ HH:MM:SS ». */
export const exifMs = (s) => {
  const m = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
};
