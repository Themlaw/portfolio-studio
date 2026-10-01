#!/usr/bin/env node
/** Détection de type par signature et nettoyage des noms (src/lib/upload/sniff.ts). */
const { sniffImage, cleanFilename } = await import(new URL("../src/lib/upload/sniff.ts", import.meta.url));

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? " — " + detail : ""}`);
};
const bytes = (...parts) => new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));

ok("JPEG", sniffImage(bytes([0xff, 0xd8, 0xff, 0xe0], "JFIF"))?.mime === "image/jpeg");
ok("PNG", sniffImage(bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a], "....IHDR"))?.mime === "image/png");
ok("GIF89a", sniffImage(bytes("GIF89a", [1, 0, 1, 0]))?.mime === "image/gif");
ok("WebP", sniffImage(bytes("RIFF", [0, 0, 0, 0], "WEBPVP8 "))?.mime === "image/webp");
ok("AVIF (marque majeure)", sniffImage(bytes([0, 0, 0, 0x1c], "ftypavif", [0, 0, 0, 0], "avifmif1miaf"))?.mime === "image/avif");
ok("AVIF (marque compatible)", sniffImage(bytes([0, 0, 0, 0x1c], "ftypmif1", [0, 0, 0, 0], "mif1avifmiaf"))?.mime === "image/avif");
ok("HEIC refusé", sniffImage(bytes([0, 0, 0, 0x18], "ftypheic", [0, 0, 0, 0], "mif1heic")) === null);
ok("SVG refusé", sniffImage(bytes('<svg xmlns="http://www.w3.org/2000/svg">')) === null);
ok("SVG avec BOM/espaces refusé", sniffImage(bytes([0xef, 0xbb, 0xbf], '  <?xml version="1.0"?><svg>')) === null);
ok("HTML refusé", sniffImage(bytes("<!doctype html><script>alert(1)</script>")) === null);
ok("RIFF non WebP (WAV) refusé", sniffImage(bytes("RIFF", [0, 0, 0, 0], "WAVEfmt ")) === null);
ok("vide refusé", sniffImage(new Uint8Array()) === null);
ok("nom : chemin retiré", cleanFilename("../../etc/passwd") === "passwd");
ok("nom : chemin Windows retiré", cleanFilename("C:\\Users\\x\\photo.jpg") === "photo.jpg");
ok("nom : caractères de contrôle retirés", cleanFilename("pho\u0000to\n\u202e.jpg") === "photo.jpg");
ok("nom : « .. » seul → image", cleanFilename("..") === "image");
ok("nom : vide → image", cleanFilename("") === "image");
ok("nom : 120 caractères au plus", cleanFilename("a".repeat(500)).length === 120);

if (failures) {
  console.error(`test-sniff : ${failures} échec(s)`);
  process.exit(1);
}
console.log("test-sniff : OK");
