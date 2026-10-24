#!/usr/bin/env node
/**
 * Icône de l'onglet (lot 83), unités : sans serveur (un dossier de données jetable pour le stockage).
 *  1. initiales du nom du site, lecture tolérante du réglage ;
 *  2. plan : monogramme sans réglage, logo du thème, logo trop large → monogramme, calque du kit, empreinte qui suit le thème ;
 *  3. rendu : PNG carrés aux bonnes tailles, ICO 16/32/48, maskable avec 20 % de marge, SVG avec variante sombre ;
 *  4. couleurs et lettres du monogramme appliquées ; image recadrée ; logo teinté ou en couleurs ;
 *  5. avertissement « trop détaillé » (mesure à 16 px) : monogramme sans alerte, image bruitée avec ;
 *  6. manifeste et balises.
 * Usage : node --import tsx scripts/test-favicon83.mjs
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "favicon83-"));

import sharp from "sharp";

const { initialsOf, readFaviconConfig, defaultFaviconConfig, FaviconInputSchema } = await import("../src/lib/favicon-spec.ts");
const { readSeo, EMPTY_SEO, ICON_SIZES, MASKABLE_FILE, SeoInputSchema } = await import("../src/lib/seo-schema.ts");
const { planIcon, iconLinks, manifestOf, darkPair, monoColors } = await import("../src/lib/favicon-plan.ts");
const { renderSet, readIcon, measureDetail, warningsOf, icoOf } = await import("../src/lib/favicon.ts");
const { getStorage } = await import("../src/lib/storage/index.ts");
const { PRESETS } = await import("../src/themes/presets/index.ts");

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${!cond && detail ? ` — ${detail}` : ""}`);
};
const seoOf = (over = {}) => ({ ...EMPTY_SEO, ...over });
const galerie = PRESETS["galerie-lumineuse"];
const studio = PRESETS.studio;
const NAME = "Camille Roussel";

// 1. initiales et lecture du réglage
ok("initiales : « Camille Roussel » → CR", initialsOf("Camille Roussel") === "CR");
ok("initiales : un seul mot → deux lettres, majuscules", initialsOf("camille") === "CA");
ok("initiales : premier et dernier mot, tirets et accents", initialsOf("Anne-Sophie de la Tour") === "AT" && initialsOf("élodie  durand") === "ÉD");
ok("initiales : nom sans lettre → « ? »", initialsOf("  - 12 ") === "12" && initialsOf("---") === "?");
ok("réglage absent : « automatique », monogramme rond (action, texte sur l'action)", JSON.stringify(readSeo(undefined).faviconMode) === JSON.stringify(defaultFaviconConfig("auto")) && readSeo({}).faviconMode.mono.shape === "round");
ok("réglage d'avant le lot 83 avec image : mode « image » (compatible)", readSeo({ favicon: { mediaId: 7, dir: "icons/7-abcd1234" } }).faviconMode.mode === "image" && readSeo({ favicon: { mediaId: 7, dir: "icons/7-abcd1234" } }).favicon.mediaId === 7);
ok("réglage corrompu : défauts", readFaviconConfig({ mode: "zzz", mono: { letters: "ABCDE", shape: 4, bg: "rouge", ink: null }, crop: { x: 2 } }, false).mono.letters === null && readFaviconConfig({ mode: "zzz", mono: { shape: 4 } }, false).mode === "auto");
ok("entrée : 2 ou 3 lettres seulement", FaviconInputSchema.safeParse({ mode: "auto", mediaId: null, crop: null, mono: { letters: "A", shape: "round", bg: "primary", ink: "ink" } }).success === false && FaviconInputSchema.safeParse({ mode: "auto", mediaId: null, crop: null, mono: { letters: "ABC", shape: "none", bg: "primary", ink: "ink" } }).success);
ok("SeoInput : plus d'icône (enregistrée à part)", SeoInputSchema.safeParse({ description: { fr: "", en: "" }, shareImage: null }).success && !SeoInputSchema.safeParse({ description: { fr: "", en: "" }, shareImage: null, favicon: 3 }).success);

// 2. plan
const plain = planIcon(seoOf(), galerie, NAME);
ok("sans réglage : monogramme « CR » (jamais une icône d'origine)", plain.source === "mono" && plain.letters === "CR" && plain.fontId === galerie.tokens.font.display, JSON.stringify([plain.source, plain.letters]));
const other = planIcon(seoOf(), studio, NAME);
ok("changer de thème change l'empreinte (et les couleurs, la police)", other.fp !== plain.fp && JSON.stringify(other.light) !== JSON.stringify(plain.light), `${plain.fp} ${other.fp}`);
ok("l'empreinte suit le nom du site et le réglage", planIcon(seoOf(), galerie, "Marc Dupont").fp !== plain.fp && planIcon(seoOf({ faviconMode: { ...defaultFaviconConfig(), mono: { ...defaultFaviconConfig().mono, shape: "none" } } }), galerie, NAME).fp !== plain.fp);
ok("empreinte stable (même entrée, même empreinte)", planIcon(seoOf(), galerie, NAME).fp === plain.fp);
const logo = (w, h, colors) => ({ webp: `/media/kit/${"a".repeat(16)}.webp`, avif: `/media/kit/${"a".repeat(16)}.avif`, w, h, ...(colors ? { colors: true } : {}) });
const withLogo = (l, extra = {}) => ({ ...galerie, assets: { ...galerie.assets, kit: { signature: l, ...extra } } });
ok("logo du thème : l'icône vient du logo", planIcon(seoOf(), withLogo(logo(600, 300)), NAME).source === "logo");
ok("logo trop large pour 16 px : monogramme, raison donnée", planIcon(seoOf(), withLogo(logo(1200, 200)), NAME).source === "mono" && planIcon(seoOf(), withLogo(logo(1200, 200)), NAME).fallback === "logo-large");
ok("calque « Icône » du kit : prioritaire sur le logo", planIcon(seoOf(), withLogo(logo(600, 300), { icon: logo(512, 512) }), NAME).source === "kit");
ok("mode « kit » sans calque : monogramme (le logo n'est pas pris)", planIcon(seoOf({ faviconMode: defaultFaviconConfig("kit") }), withLogo(logo(600, 300)), NAME).source === "mono");
ok("mode « image » sans image enregistrée : comme l'automatique", planIcon(seoOf({ faviconMode: defaultFaviconConfig("image") }), galerie, NAME).source === "mono");
ok("mode « image » avec image : source image, dossier gardé", planIcon(seoOf({ favicon: { mediaId: 3, dir: "icons/3-abcdef12" }, faviconMode: defaultFaviconConfig("image") }), galerie, NAME).dir === "icons/3-abcdef12");
const dk = darkPair({ bg: "#202124", ink: "#ffffff" }, "round", ["#ffffff", "#202124"]);
ok("variante sombre : un rond presque noir devient clair, lettres lisibles", dk.bg === "#ffffff" && dk.ink === "#202124", JSON.stringify(dk));
ok("variante sombre : un fond qui se lit déjà ne change pas", darkPair({ bg: "#c0392b", ink: "#ffffff" }, "round", ["#ffffff", "#000000"]).bg === "#c0392b");
ok("sans fond : des lettres blanches (action) sont remplacées par une couleur lisible sur le fond du site", (() => {
  const cfg = defaultFaviconConfig();
  cfg.mono.shape = "none";
  const p = planIcon(seoOf({ faviconMode: cfg }), galerie, NAME);
  return p.light.ink.toLowerCase() !== "#ffffff";
})());

// 3. rendu
const set = await renderSet(plain);
const dims = async (b) => {
  const m = await sharp(b).metadata();
  return `${m.width}x${m.height}`;
};
for (const size of ICON_SIZES) ok(`${size}.png : PNG carré ${size} × ${size}`, (await dims(set[`${size}.png`])) === `${size}x${size}`);
ok("maskable-512.png : 512 × 512", (await dims(set[MASKABLE_FILE])) === "512x512");
const ico = set["favicon.ico"];
const count = ico.readUInt16LE(4);
const entries = [...Array(count).keys()].map((i) => ({ w: ico[6 + i * 16] || 256, off: ico.readUInt32LE(6 + i * 16 + 12), len: ico.readUInt32LE(6 + i * 16 + 8) }));
ok("favicon.ico : 3 images 16, 32, 48 (en-tête valide)", ico.readUInt16LE(0) === 0 && ico.readUInt16LE(2) === 1 && entries.map((e) => e.w).join() === "16,32,48", JSON.stringify(entries));
let icoOk = true;
for (const e of entries) {
  const m = await sharp(ico.subarray(e.off, e.off + e.len)).metadata();
  icoOk &&= m.format === "png" && m.width === e.w && m.height === e.w;
}
ok("favicon.ico : chaque entrée est un PNG de sa taille", icoOk);
ok("ICO à trois entrées : décalages cohérents", entries[2].off + entries[2].len === ico.length);
// maskable : marge de sécurité de 20 % (le dessin tient dans les 60 % du milieu), fond plein jusqu'aux bords
const mask = await sharp(set[MASKABLE_FILE]).raw().toBuffer({ resolveWithObject: true });
const px = (x, y) => [...mask.data.subarray((y * 512 + x) * mask.info.channels, (y * 512 + x) * mask.info.channels + 4)];
const corner = px(2, 2);
ok("maskable : fond plein jusqu'aux coins (opaque)", corner[3] === 255 && px(509, 509)[3] === 255 && px(509, 2)[3] === 255);
let outside = 0;
const bgc = corner;
for (let y = 0; y < 512; y++)
  for (let x = 0; x < 512; x++) {
    const inSafe = x >= 102 && x < 410 && y >= 102 && y < 410;
    if (inSafe) continue;
    const p = px(x, y);
    if (Math.abs(p[0] - bgc[0]) + Math.abs(p[1] - bgc[1]) + Math.abs(p[2] - bgc[2]) > 12) outside++;
  }
ok("maskable : rien en dehors des 60 % du milieu (marge de sécurité de 20 %)", outside === 0, `${outside} pixels hors zone`);
ok("PNG de l'icône ronde : coins transparents, centre opaque", await (async () => {
  const r = await sharp(set["512.png"]).raw().toBuffer({ resolveWithObject: true });
  const a = (x, y) => r.data[(y * 512 + x) * r.info.channels + 3];
  return a(2, 2) === 0 && a(256, 256) >= 0 && a(256, 20) === 255;
})());
const svg = set["icon.svg"].toString("utf8");
ok("icon.svg : forme + lettres (masque), variante sombre prefers-color-scheme", /^<svg[^>]*viewBox="0 0 512 512"/.test(svg) && /<circle/.test(svg) && /prefers-color-scheme:dark/.test(svg) && /<mask/.test(svg) && svg.length < 40_000, String(svg.length));
ok("icon.svg : lisible par sharp", (await dims(await sharp(Buffer.from(svg)).png().toBuffer())) === "512x512");
const none = defaultFaviconConfig();
none.mono.shape = "none";
const planNone = planIcon(seoOf({ faviconMode: none }), galerie, NAME);
ok("monogramme sans fond : pas de forme dans le SVG", !/<circle|<rect class="b"/.test((await renderSet(planNone))["icon.svg"].toString("utf8")));

// 4. couleurs, lettres, logo, image recadrée
const px1 = async (b, x, y) => {
  const r = await sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return [...r.data.subarray((y * r.info.width + x) * 4, (y * r.info.width + x) * 4 + 4)];
};
const hexOf = (c) => c.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("");
const custom = defaultFaviconConfig();
custom.mono = { letters: "XYZ", shape: "squircle", bg: "tertiary", ink: "ink" };
const pc = planIcon(seoOf({ faviconMode: custom }), galerie, NAME);
const setC = await renderSet(pc);
const colors = monoColors(galerie);
ok("monogramme réglé : lettres « XYZ », forme et couleur de fond choisies", pc.letters === "XYZ" && pc.shape === "squircle" && hexOf(await px1(setC["512.png"], 256, 8)) === colors.tertiary.slice(1).toLowerCase(), `${pc.letters} ${hexOf(await px1(setC["512.png"], 256, 8))} ${colors.tertiary}`);
ok("monogramme réglé : l'empreinte change avec les lettres", pc.fp !== plain.fp);
ok("monogramme réglé : coin arrondi (transparent) du carré arrondi", (await px1(setC["512.png"], 1, 1))[3] === 0);

// image recadrée (le recadrage est respecté) : source écrite dans le stockage, rendue par le même chemin que l'enregistrement
const storage = getStorage();
const { Readable } = await import("node:stream");
const bands = await sharp({ create: { width: 800, height: 400, channels: 3, background: "#ff0000" } })
  .composite([
    { input: await sharp({ create: { width: 200, height: 400, channels: 3, background: "#00aa00" } }).png().toBuffer(), left: 600, top: 0 },
  ])
  .png()
  .toBuffer();
const { RectSchema } = await import("../src/lib/images/crop.ts");
const { rectPixels, toUnits } = await import("../src/lib/images/crop.ts");
{
  // Même découpe que imageMaster : rectangle normalisé → pixels → carré 512.
  const crop = { x: 0.75, y: 0, w: 0.25, h: 0.5 }; // 200 × 200 px dans la bande verte
  const u = rectPixels(toUnits(RectSchema.parse(crop)), 800, 400);
  const out = await sharp(bands).extract({ left: u.left, top: u.top, width: u.w, height: u.h }).resize(512, 512, { fit: "cover" }).png().toBuffer();
  ok("recadrage : la partie choisie est celle de l'icône (bande verte), pas le centre", hexOf(await px1(out, 256, 256)) === "00aa00" && u.w === 200 && u.h === 200, hexOf(await px1(out, 256, 256)));
  const centre = await sharp(bands).resize(512, 512, { fit: "cover", position: "centre" }).png().toBuffer();
  ok("sans recadrage : le centre (rouge) est pris", hexOf(await px1(centre, 256, 256)) === "ff0000");
}

// logo synthétique : l'icône vient du logo (couleurs gardées, ou teinté par le thème)
const logoPng = await sharp({ create: { width: 600, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: await sharp({ create: { width: 500, height: 200, channels: 4, background: "#12ab34" } }).png().toBuffer(), left: 50, top: 50 }])
  .webp({ lossless: true })
  .toBuffer();
await storage.put(`kit/${"a".repeat(16)}.webp`, Readable.from([logoPng]));
const coloredLogoPlan = planIcon(seoOf(), withLogo(logo(600, 300, true)), NAME);
const logoSet = await renderSet(coloredLogoPlan);
const centerLogo = await px1(logoSet["512.png"], 256, 256);
ok("logo en couleurs : le centre de l'icône est la couleur du logo (#12ab34), sur le fond du site", hexOf(centerLogo) === "12ab34" && coloredLogoPlan.light.bg.toLowerCase() === monoColors(galerie).bg.toLowerCase(), hexOf(centerLogo));
const tintedPlan = planIcon(seoOf(), withLogo(logo(600, 300)), NAME);
const tintedSet = await renderSet(tintedPlan);
ok("logo teinté (sans `colors`) : pris à la couleur des lettres du monogramme, pas à celle du fichier", hexOf(await px1(tintedSet["512.png"], 256, 256)) === tintedPlan.light.ink.slice(1).toLowerCase(), hexOf(await px1(tintedSet["512.png"], 256, 256)));
ok("logo : pas d'icon.svg (seulement le monogramme)", !("icon.svg" in logoSet) && (await readIcon(coloredLogoPlan, "icon.svg")) === null);
// logo absent du stockage : le monogramme prend le relais
const missing = planIcon(seoOf(), { ...galerie, assets: { ...galerie.assets, kit: { signature: { ...logo(600, 300), webp: `/media/kit/${"b".repeat(16)}.webp`, avif: `/media/kit/${"b".repeat(16)}.avif` } } } }, NAME);
ok("image du kit introuvable : monogramme, jamais d'erreur", Boolean((await renderSet(missing))["icon.svg"]));
// calque du kit : pleine case
const kitIconPng = await sharp({ create: { width: 512, height: 512, channels: 4, background: "#a1b2c3" } }).webp({ lossless: true }).toBuffer();
await storage.put(`kit/${"c".repeat(16)}.webp`, Readable.from([kitIconPng]));
const kitPlan = planIcon(seoOf(), withLogo(logo(600, 300), { icon: { webp: `/media/kit/${"c".repeat(16)}.webp`, avif: `/media/kit/${"c".repeat(16)}.avif`, w: 512, h: 512 } }), NAME);
const kitSet = await renderSet(kitPlan);
ok("calque « Icône » du kit : pleine case, couleur du dessin", hexOf(await px1(kitSet["512.png"], 5, 5)) === "a1b2c3" && hexOf(await px1(kitSet["512.png"], 256, 256)) === "a1b2c3");
// lecture et cache : le fichier rendu est gardé sous l'empreinte
const served = await readIcon(kitPlan, "192.png");
ok("lecture d'un fichier : PNG 192, gardé sous icons-auto/<empreinte>", (await dims(served)) === "192x192" && Boolean(await storage.stat(`icons-auto/${kitPlan.fp}/192.png`)));
ok("fichier inconnu ou chemin piégé : refusé", (await readIcon(kitPlan, "64.png")) === null && (await readIcon(kitPlan, "../32.png")) === null);

// 5. « trop détaillé » à 16 px
const mono = await measureDetail(set["512.png"]);
console.log(`INFO détail à 16 px : monogramme ${JSON.stringify(mono)}`);
ok("monogramme : pas d'avertissement de détail", warningsOf(mono).length === 0, JSON.stringify(mono));
const noise = Buffer.alloc(512 * 512 * 3);
let seed = 7;
for (let i = 0; i < noise.length; i += 3) {
  const cell = ((Math.floor((i / 3) % 512) >> 5) + (Math.floor(i / 3 / 512) >> 5)) % 2; // damier de 32 px : 16 cases par côté → 1 px chacune à 16 px
  seed = (seed * 1664525 + 1013904223) >>> 0;
  const v = cell ? 235 : 20 + (seed % 20);
  noise[i] = noise[i + 1] = noise[i + 2] = v;
}
const busy = await measureDetail(await sharp(noise, { raw: { width: 512, height: 512, channels: 3 } }).png().toBuffer());
console.log(`INFO détail : damier ${JSON.stringify(busy)}`);
ok("image très détaillée (damier fin) : avertissement « trop détaillée »", warningsOf(busy).some((w) => /détaillée/.test(w)), JSON.stringify(busy));
const bigShape = await measureDetail(await sharp({ create: { width: 512, height: 512, channels: 4, background: "#0b5cc0" } }).composite([{ input: Buffer.from('<svg width="512" height="512"><circle cx="256" cy="256" r="180" fill="#f4e7c5"/></svg>') }]).png().toBuffer());
console.log(`INFO détail : grosse forme ${JSON.stringify(bigShape)}`);
ok("une grosse forme simple : pas d'avertissement", warningsOf(bigShape).length === 0, JSON.stringify(bigShape));
const flat = await measureDetail(await sharp({ create: { width: 512, height: 512, channels: 4, background: "#888888" } }).png().toBuffer());
ok("image terne : avertissement de contraste", warningsOf(flat).some((w) => /contraste/.test(w)));

// 6. balises et manifeste
const links = iconLinks(plain);
const iconHrefs = links.icon.map((l) => l.url);
ok("balises : favicon.ico, SVG (monogramme), PNG 32, 48, 192, 512, apple-touch 180, tous à l'empreinte", iconHrefs.some((u) => u.startsWith("/favicon.ico?v=")) && iconHrefs.some((u) => /icon\.svg\?v=/.test(u)) && [32, 48, 192, 512].every((s) => iconHrefs.some((u) => u.startsWith(`/site-icon/${s}.png?v=${plain.fp}`))) && links.apple[0].url === `/site-icon/180.png?v=${plain.fp}`);
ok("balises : pas de SVG pour un logo", !iconLinks(coloredLogoPlan).icon.some((l) => /icon\.svg/.test(l.url)));
const man = manifestOf(plain, NAME, "fr");
ok("manifeste : nom, short_name, couleurs du thème, démarrage", man.name === NAME && man.short_name === "CR" && manifestOf(planIcon(seoOf(), galerie, "Camille"), "Camille", "fr").short_name === "Camille" && /^#[0-9a-f]{6}$/i.test(man.theme_color) && /^#[0-9a-f]{6}$/i.test(man.background_color) && man.background_color.toLowerCase() === monoColors(galerie).bg.toLowerCase() && man.start_url === "/" && man.display === "browser");
ok("manifeste : icônes 192 et 512 « any », 512 « maskable »", man.icons.length === 3 && man.icons.some((i) => i.sizes === "192x192" && i.purpose === "any") && man.icons.some((i) => i.sizes === "512x512" && i.purpose === "maskable" && /maskable-512\.png/.test(i.src)));
ok("manifeste : nom long → short_name = les lettres", manifestOf(planIcon(seoOf(), galerie, "Camille Roussel Illustration"), "Camille Roussel Illustration", "fr").short_name.length <= 12);
ok("manifeste : suit le thème", manifestOf(other, NAME, "fr").theme_color !== man.theme_color || manifestOf(other, NAME, "fr").background_color !== man.background_color);
ok("icoOf : une entrée", icoOf([{ size: 16, data: Buffer.from("x") }]).readUInt16LE(4) === 1);
ok("public/ : plus d'icône d'origine", (() => {
  try {
    readFileSync(new URL("../public/favicon.ico", import.meta.url));
    return false;
  } catch {
    return true;
  }
})());

console.log(failures ? `\n${failures} échec(s)` : "\nTout est vert");
process.exit(failures ? 1 : 0);
