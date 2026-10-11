/**
 * Archives de thème pour les tests (e2e-themes, test-auth) : une archive
 * valide (avec un élément dessiné SVG) et une série d'archives malveillantes,
 * chacune avec le motif du message de refus attendu.
 */
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";

import sharp from "sharp";

import { rawZip } from "./zip-fixtures.mjs";

const { writeZip, crc32 } = await import(new URL("../../src/lib/themes/zip.ts", import.meta.url));

const manifest = (theme) => Buffer.from(JSON.stringify({ format: "portfolio-theme", version: 1, theme }));
const stored = (name, data) => ({ name, body: data, crc: crc32(data) });
const hash16 = (data) => createHash("sha256").update(data).digest("hex").slice(0, 16);

/** Archive valide : `base` (thème livré) renommé, avec une signature SVG dessinée. */
export function validPackage(base, name = "Thème importé e2e") {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><path d="M4 30C30 4 60 40 116 8" fill="none" stroke="#000" stroke-width="6"/></svg>');
  const h = hash16(svg);
  const theme = { ...base, name, assets: { ...base.assets, kit: { signature: { svg: `/media/kit/${h}.svg`, w: 120, h: 40 } } } };
  return { zip: writeZip([{ name: "theme.json", data: manifest(theme) }, { name: `assets/${h}.svg`, data: svg }]), kitPath: `/media/kit/${h}.svg` };
}

/** PNG carré de `side` px (curseur de test : carré sombre au contour clair). */
async function cursorPng(side, shade = 20) {
  const inner = Math.round(side * 0.6);
  const dark = await sharp({ create: { width: inner, height: inner, channels: 4, background: { r: shade, g: shade, b: shade, alpha: 1 } } }).png().toBuffer();
  return sharp({ create: { width: side, height: side, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
    .composite([{ input: dark, left: Math.round((side - inner) / 2), top: Math.round((side - inner) / 2) }])
    .png()
    .toBuffer();
}

/**
 * Archive valide avec les données des lots 2 et 4 : curseurs PNG (32 et 64 px),
 * palette avec une nuance auto à la valeur FAUSSE (doit être recalculée),
 * mise en page et typographie du thème.
 */
export async function richPackage(base, name = "Thème riche (test)") {
  const [p1, p2] = await Promise.all([cursorPng(32), cursorPng(64)]);
  const h1 = hash16(p1);
  const h2 = hash16(p2);
  const theme = {
    ...base,
    name,
    tokens: {
      ...base.tokens,
      color: { ...base.tokens.color, primaryHover: "#00ff00" },
      palette: { auto: ["primaryHover"] },
      layout: { spaceS: "0.5rem", mediaRadius: "none", heroRoleBackdrop: "band" },
      type: { h2: { weight: 700 }, caption: { case: "upper", tracking: 0.08 } },
    },
    assets: { ...base.assets, kit: { cursors: { default: { png: `/media/kit/${h1}.png`, png2x: `/media/kit/${h2}.png`, x: 2, y: 3 } } } },
  };
  return {
    zip: writeZip([{ name: "theme.json", data: manifest(theme) }, { name: `assets/${h1}.png`, data: p1 }, { name: `assets/${h2}.png`, data: p2 }]),
    cursorPath: `/media/kit/${h1}.png`,
  };
}

/** Archives refusées propres aux lots 2 et 4 (curseurs, voile). */
export async function maliciousRichPackages(base) {
  const [p32, p64, p64b] = await Promise.all([cursorPng(32), cursorPng(64), cursorPng(64, 60)]);
  const h32 = hash16(p32);
  const h64 = hash16(p64);
  const h64b = hash16(p64b);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>');
  const hs = hash16(svg);
  const cur = (png, png2x) => ({ ...base, name: "Piège curseur", assets: { kit: { cursors: { default: { png, png2x, x: 0, y: 0 } } } } });
  return [
    ["curseur 1x de 64 px (taille fausse)", writeZip([{ name: "theme.json", data: manifest(cur(`/media/kit/${h64b}.png`, `/media/kit/${h64}.png`)) }, { name: `assets/${h64b}.png`, data: p64b }, { name: `assets/${h64}.png`, data: p64 }]), /il faut 32/],
    ["curseur : même PNG en 1x et en 2x", writeZip([{ name: "theme.json", data: manifest(cur(`/media/kit/${h64}.png`, `/media/kit/${h64}.png`)) }, { name: `assets/${h64}.png`, data: p64 }]), /il faut 32/],
    ["curseur : SVG nommé .png", writeZip([{ name: "theme.json", data: manifest(cur(`/media/kit/${hs}.png`, `/media/kit/${h64}.png`)) }, { name: `assets/${hs}.png`, data: svg }, { name: `assets/${h64}.png`, data: p64 }]), /différent de son nom|pas une image/],
    ["PNG hors curseur (signature)", writeZip([{ name: "theme.json", data: manifest({ ...base, name: "Piège png", assets: { kit: { signature: { svg: `/media/kit/${h32}.png`, w: 1, h: 1 } } } }) }, { name: `assets/${h32}.png`, data: p32 }]), /Thème invalide/],
    ["voile illisible (palette)", writeZip([{ name: "theme.json", data: manifest({ ...base, name: "Piège voile", tokens: { ...base.tokens, color: { ...base.tokens.color, scrim: "#777777", onScrim: "#888888" } } }) }]), /voile/],
    ["typographie : police téléchargée refusée", writeZip([{ name: "theme.json", data: manifest({ ...base, name: "Piège typo", tokens: { ...base.tokens, type: { h1: { font: "g:Roboto" } } } }) }]), /Thème invalide/],
  ];
}

/** [libellé, archive, motif du refus] — aucune ne doit créer de thème. */
export function maliciousPackages(base) {
  const ok = manifest({ ...base, name: "Piège" });
  const zeros = Buffer.alloc(40 * 1024 * 1024);
  const bomb = deflateRawSync(zeros, { level: 9 });
  const evilSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(document.cookie)</script></svg>');
  const eh = hash16(evilSvg);
  const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
  const ph = hash16(png);
  return [
    ["chemin ../ (zip slip)", rawZip([stored("theme.json", ok), stored("../../../../tmp/pwn.txt", Buffer.from("x"))]), /refusé/],
    ["chemin absolu", rawZip([stored("theme.json", ok), stored("/etc/cron.d/x", Buffer.from("x"))]), /refusé/],
    ["bombe de décompression (40 Mo déclarés)", rawZip([{ name: "theme.json", body: bomb, method: 8, usize: zeros.length, crc: crc32(zeros) }]), /trop gros/],
    ["bombe à taille mensongère", rawZip([{ name: "theme.json", body: bomb, method: 8, usize: 2048, crc: 0 }]), /plus gros que déclaré|illisible/],
    ["trop de fichiers", rawZip([stored("theme.json", ok), ...Array.from({ length: 45 }, (_, i) => stored(`assets/${String(i).padStart(16, "0")}.svg`, Buffer.from("x")))]), /Trop de fichiers/],
    ["fichier inattendu (HTML)", writeZip([{ name: "theme.json", data: ok }, { name: "index.html", data: Buffer.from("<script>alert(1)</script>") }]), /inattendu/],
    ["CSS libre dans une valeur (injection)", writeZip([{ name: "theme.json", data: manifest({ ...base, tokens: { ...base.tokens, radius: { ...base.tokens.radius, sm: "0;}body{background:url(https://evil.example/x)" } } }) }]), /Thème invalide/],
    ["réglage inconnu (css libre)", writeZip([{ name: "theme.json", data: manifest({ ...base, tokens: { ...base.tokens, css: "body{display:none}" } }) }]), /inconnus/],
    ["URL externe en calque du hero", writeZip([{ name: "theme.json", data: manifest({ ...base, variants: { ...base.variants, hero: "parallax-layers" }, assets: { heroLayers: ["https://evil.example/a.svg"] } }) }]), /Thème invalide/],
    ["calque inexistant", writeZip([{ name: "theme.json", data: manifest({ ...base, assets: { heroLayers: ["/themes/nulle-part/x.svg"] } }) }]), /introuvable/],
    ["contraste insuffisant", writeZip([{ name: "theme.json", data: manifest({ ...base, tokens: { ...base.tokens, color: { ...base.tokens.color, inkSoft: base.tokens.color.bg } } }) }]), /Contraste/],
    ["SVG avec script", writeZip([{ name: "theme.json", data: manifest({ ...base, assets: { kit: { signature: { svg: `/media/kit/${eh}.svg`, w: 10, h: 10 } } } }) }, { name: `assets/${eh}.svg`, data: evilSvg }]), /refusé/],
    ["image déguisée (PNG nommé .webp)", writeZip([{ name: "theme.json", data: manifest({ ...base, assets: { kit: { signature: { avif: `/media/kit/${ph}.avif`, webp: `/media/kit/${ph}.webp`, w: 1, h: 1 } } } }) }, { name: `assets/${ph}.webp`, data: png }, { name: `assets/${ph}.avif`, data: png }]), /pas une image/],
    ["asset au hash falsifié", writeZip([{ name: "theme.json", data: manifest({ ...base, assets: { kit: { signature: { svg: "/media/kit/0123456789abcdef.svg", w: 10, h: 10 } } } }) }, { name: "assets/0123456789abcdef.svg", data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') }]), /différent de son nom/],
    ["pas une archive (PNG)", png, /pas une archive/],
    ["format inconnu", writeZip([{ name: "theme.json", data: Buffer.from(JSON.stringify({ format: "autre", theme: base })) }]), /format attendu/],
  ];
}
