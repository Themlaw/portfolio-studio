#!/usr/bin/env node
/**
 * Archive d'import de thème (src/lib/themes/zip.ts), contrôle des SVG
 * importés (svg-check.ts) et des clés inconnues (src/themes/strict.ts) :
 * archives piégées construites à la main, refusées AVANT toute décompression
 * dangereuse. Inclus dans npm test.
 */
import { deflateRawSync } from "node:zlib";

const { readZip, writeZip, isSafeEntryName, crc32 } = await import(new URL("../src/lib/themes/zip.ts", import.meta.url));
const { svgProblem } = await import(new URL("../src/lib/themes/svg-check.ts", import.meta.url));
const { unknownKeys } = await import(new URL("../src/themes/strict.ts", import.meta.url));

import { rawZip } from "./lib/zip-fixtures.mjs";

const LIMITS = { maxEntries: 40, maxEntryBytes: 6 * 1024 * 1024, maxTotalBytes: 30 * 1024 * 1024, maxRatio: 60 };
let failures = 0;
let count = 0;
const ok = (label, pass, detail = "") => {
  count++;
  if (!pass) {
    failures++;
    console.error(`FAIL  ${label}${detail ? " — " + detail : ""}`);
  }
};
const rejects = (label, buf, pattern, limits = LIMITS) => {
  try {
    readZip(buf, limits);
    ok(label, false, "acceptée");
  } catch (e) {
    ok(label, pattern.test(e.message), e.message);
  }
};

// Aller-retour.
const json = Buffer.from(JSON.stringify({ a: "é".repeat(2000) }));
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z" fill="#000"/></svg>');
const zip = writeZip([{ name: "theme.json", data: json }, { name: "assets/0123456789abcdef.svg", data: svg }]);
const back = readZip(zip, LIMITS);
ok("aller-retour : deux entrées, contenu identique", back.length === 2 && back[0].data.equals(json) && back[1].data.equals(svg));
ok("CRC-32 connu (« 123456789 » → cbf43926)", crc32(Buffer.from("123456789")).toString(16) === "cbf43926");

// Noms piégés.
for (const name of ["../evil.json", "assets/../../x", "/etc/passwd", "C:/x", "a\\b", "assets/./x", "a//b", "théme.json", "a b"]) {
  ok(`nom refusé : ${name}`, !isSafeEntryName(name));
}
rejects("archive avec ../ refusée", rawZip([{ name: "../theme.json", body: json, crc: crc32(json) }]), /refusé/);
rejects("doublon refusé", rawZip([{ name: "theme.json", body: json, crc: crc32(json) }, { name: "theme.json", body: json, crc: crc32(json) }]), /double/);

// Trop de fichiers.
rejects(
  "plus de 40 fichiers refusés",
  rawZip(Array.from({ length: 41 }, (_, i) => ({ name: `f${i}.txt`, body: Buffer.from("x"), crc: crc32(Buffer.from("x")) }))),
  /Trop de fichiers/,
);

// Bombes : taille déclarée, taux, déclaration mensongère.
const zeros = Buffer.alloc(50 * 1024 * 1024);
const bomb = deflateRawSync(zeros, { level: 9 });
rejects("bombe : 50 Mo déclarés pour une entrée → refusée sans décompresser", rawZip([{ name: "theme.json", body: bomb, method: 8, usize: zeros.length, crc: crc32(zeros) }]), /trop gros/);
const five = Buffer.alloc(5 * 1024 * 1024);
rejects("bombe : taux de compression anormal refusé", rawZip([{ name: "theme.json", body: deflateRawSync(five, { level: 9 }), method: 8, usize: five.length, crc: crc32(five) }]), /anormalement compressé/);
const t0 = Date.now();
rejects("bombe : taille déclarée mensongère (1 Ko pour 50 Mo) → décompression arrêtée à la borne", rawZip([{ name: "theme.json", body: bomb, method: 8, usize: 1024, crc: 0 }]), /plus gros que déclaré|illisible/);
ok("… en moins de 2 s", Date.now() - t0 < 2000, `${Date.now() - t0} ms`);
let total = 0;
const many = Array.from({ length: 8 }, (_, i) => {
  const d = Buffer.alloc(5 * 1024 * 1024, i + 1);
  total += d.length;
  return { name: `assets/${i}.bin`, body: d, crc: crc32(d) };
});
rejects(`total décompressé au-delà de 30 Mo refusé (${total / 1024 / 1024} Mo)`, rawZip(many), /trop grosse/);

// Divers.
rejects("chiffrement refusé", rawZip([{ name: "theme.json", body: json, flags: 1, crc: crc32(json) }]), /chiffrée/);
rejects("méthode inconnue (bzip2) refusée", rawZip([{ name: "theme.json", body: json, method: 12, crc: crc32(json) }]), /Méthode/);
rejects("CRC faux refusé", rawZip([{ name: "theme.json", body: json, crc: 1234 }]), /somme de contrôle/);
rejects("pas un ZIP (PNG) refusé", Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"), /pas une archive/);
rejects("archive tronquée refusée", zip.subarray(0, zip.length - 30), /illisible|incohérente|pas une archive/);

// SVG importés.
const good = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><path fill="url(#g)" d="M0 0h4v4z"/><use href="#g"/></svg>';
ok("SVG de dessin accepté", svgProblem(Buffer.from(good)) === null, svgProblem(Buffer.from(good)));
const goodXlink = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 4 4"><defs><path id="p" d="M0 0h4"/></defs><use xlink:href="#p" fill="url(#p)"/><title>caf&#233;</title></svg>';
ok("SVG avec xlink:href interne et texte accentué accepté", svgProblem(Buffer.from(goodXlink)) === null, svgProblem(Buffer.from(goodXlink)));
for (const [label, bad] of [
  ["script", '<svg><script>alert(1)</script></svg>'],
  ["onload", '<svg onload="alert(1)"><path d="M0 0"/></svg>'],
  ["foreignObject", "<svg><foreignObject><div/></foreignObject></svg>"],
  ["DOCTYPE/entité", '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>'],
  ["href externe", '<svg><use href="https://evil.example/a.svg#x"/></svg>'],
  ["xlink:href javascript", '<svg><a xlink:href="javascript:alert(1)"><path/></a></svg>'],
  ["image embarquée", '<svg><image href="data:image/png;base64,AAAA"/></svg>'],
  ["url() externe", '<svg><path style="fill:url(https://evil.example/x)"/></svg>'],
  ["<style> @import", "<svg><style>@import url(//evil)</style></svg>"],
  ["HTML déguisé", "<html><body>x</body></html>"],
  // Sonde de l'audit v0.14 (p1-pure) : contournements par préfixe, guillemets, échappements.
  ["href préfixe x:", '<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="http://www.w3.org/1999/xlink"><use x:href="https://evil.example/a.svg#z"/></svg>'],
  ["href sans guillemets", '<svg xmlns="http://www.w3.org/2000/svg"><use href=https://evil.example/a.svg#z /></svg>'],
  ["href majuscules", '<svg xmlns="http://www.w3.org/2000/svg"><use HREF="https://evil.example/a.svg#z"/></svg>'],
  ["href entité", '<svg xmlns="http://www.w3.org/2000/svg"><use href="&#104;ttps://evil.example/x#a"/></svg>'],
  ["style url() par entité", '<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:u&#114;l(https://evil.example/)"/></svg>'],
  ["style url() par échappement CSS", '<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:u\\72l(https://evil.example/)"/></svg>'],
  ["attribut de présentation url() externe", '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(https://evil.example/x)"/></svg>'],
  ["feImage (hors liste)", '<svg xmlns="http://www.w3.org/2000/svg"><feImage href="#a"/></svg>'],
  ["onload après tabulation", '<svg xmlns="http://www.w3.org/2000/svg"\tonload="alert(1)"></svg>'],
  ["onload après barre oblique", '<svg xmlns="http://www.w3.org/2000/svg"/onload="alert(1)"></svg>'],
  ["set/animate", '<svg xmlns="http://www.w3.org/2000/svg"><set attributeName="href" to="javascript:alert(1)"/></svg>'],
  ["élément préfixé svg:a", '<svg xmlns="http://www.w3.org/2000/svg"><svg:a xmlns:svg="http://www.w3.org/2000/svg"/></svg>'],
  ["data: par entité", '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(#a)" style="background:url(&#100;ata:x)"/></svg>'],
]) {
  ok(`SVG refusé : ${label}`, svgProblem(Buffer.from(bad)) !== null);
}

// Clés inconnues.
ok("clés inconnues détectées (imbriquées)", unknownKeys({ a: { b: 1, css: "x" }, c: [{ d: 1, e: 2 }] }, { a: { b: 1 }, c: [{ d: 1 }] }).join() === "a.css,c[0].e");

if (failures) {
  console.error(`test-theme-zip : ${failures} échec(s) sur ${count}`);
  process.exit(1);
}
console.log(`test-theme-zip : OK (${count} vérifications : archive, bombes, chemins, SVG, clés inconnues)`);
