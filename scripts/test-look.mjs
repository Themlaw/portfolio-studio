#!/usr/bin/env node
/**
 * Mise en page (lot 2) : schémas bornés (réglages des blocs, styles du site,
 * polices du catalogue), résolution global / local, feuilles générées sans
 * injection, cadrage (fenêtre gardée ↔ point focal + zoom), lecture des
 * réponses de Google Fonts (hôtes fixes), messages de la toile.
 * Usage : node --import tsx scripts/test-look.mjs   (inclus dans npm test)
 */
import {
  cleanLook,
  cleanSiteStyles,
  cropFromWindow,
  cropVars,
  cropWindow,
  FRAME_DEFAULT_COLOR,
  FRAME_SIZES,
  frameAttrs,
  frameColorCss,
  FrameSchema,
  fontStack,
  isFontRef,
  lookAttributes,
  LookSchema,
  needsCrop,
  readLook,
  resolveTextStyle,
  siteStylesCss,
  SiteStylesSchema,
  textStyleDecls,
  textStyleObject,
  TextStyleSchema,
  themeTypeCss,
} from "../src/lib/look.ts";
import { hslToRgb, normalizeCustomColor, parseColor, rgbaToHex, rgbToHsv, hsvToRgb, wheelGradient, hueStripGradient, saturationPlane, planeToSv, stripToHue } from "../src/lib/color.ts";
import { SIZE_LABELS, SIZE_VALUES, SIZES } from "../src/lib/look.ts";
import { ThemeSchema } from "../src/themes/schema.ts";
import { fontFaceCss, googleCssUrl, parseGoogleCss, readLibrary } from "../src/lib/fonts/faces.ts";
import { FromCanvasSchema } from "../src/lib/edit/protocol.ts";
import { SiteSnapSchema } from "../src/lib/site-schema.ts";
import { GOOGLE_FONTS, googleFamily, nearestWeight } from "../src/themes/google-fonts.ts";
import { layoutVariables, themeAttributes } from "../src/themes/css.ts";
import { PRESETS } from "../src/themes/presets/index.ts";

let failures = 0;
let count = 0;
function ok(label, cond, detail = "") {
  count++;
  if (!cond) failures++;
  if (!cond) console.log(`FAIL ${label}${detail ? ` — ${detail}` : ""}`);
}
const near = (a, b, eps = 0.01) => Math.abs(a - b) < eps;

/* ---- Catalogue de polices ----------------------------------------------------- */
ok("catalogue Google : plus de 1000 familles", GOOGLE_FONTS.length > 1000, String(GOOGLE_FONTS.length));
ok("catalogue : noms sûrs (lettres, chiffres, espaces)", GOOGLE_FONTS.every((f) => /^[A-Za-z0-9 ]{1,60}$/.test(f.family)));
ok("catalogue : chaque famille a au moins une graisse", GOOGLE_FONTS.every((f) => f.weights.length > 0));
ok("catalogue : Inter connue, graisses 100–900", googleFamily("Inter")?.weights.length === 9);
ok("graisse la plus proche (Lato 500 → 400)", nearestWeight(googleFamily("Lato"), 500, false) === 400);

/* ---- Polices référencées ----------------------------------------------------------- */
for (const ref of ["theme:display", "theme:caption", "embed:caveat", "g:Inter", "g:Playfair Display"]) ok(`police valide ${ref}`, isFontRef(ref));
for (const ref of ["theme:x", "embed:arial", "g:Evil Font", "g:Inter;}", "url(x)", "g:", "Inter"]) ok(`police refusée ${ref}`, !isFontRef(ref));
ok("pile CSS Google : famille entre guillemets + repli", fontStack("g:Inter") === '"Inter", ui-sans-serif, system-ui, sans-serif', fontStack("g:Inter"));
ok("pile CSS du thème : variable", fontStack("theme:display") === "var(--t-font-display)");

/* ---- Style d'un texte -------------------------------------------------------------- */
ok("style complet valide", TextStyleSchema.safeParse({ font: "g:Inter", size: "xl", scale: 1.1, weight: 700, italic: true, case: "upper", tracking: 0.12, color: "primary", align: "center" }).success);
for (const [label, bad] of [
  ["graisse hors crans", { weight: 450 }],
  ["taille hors échelle", { size: "12px" }],
  ["ajustement > ×2", { scale: 3 }],
  ["interlettrage > 0,4 em", { tracking: 1 }],
  ["couleur nommée hors palette", { color: "red" }],
  ["couleur libre en majuscules (format non normalisé)", { color: "#FF0000" }],
  ["couleur libre abrégée", { color: "#f00" }],
  ["couleur libre avec injection", { color: "#ff0000;}body{x:y" }],
  ["couleur libre : bonne longueur (9) mais suffixe parasite (ancre $)", { color: "#ff0000;}" }],
  ["couleur libre rgb()", { color: "rgb(1,2,3)" }],
  ["couleur libre trop longue", { color: "#ff000000ff" }],
  ["clé inconnue", { fontFamily: "Arial" }],
  ["police hors catalogue", { font: "g:Comic Sans MS" }],
]) ok(`style refusé : ${label}`, !TextStyleSchema.safeParse(bad).success);

const resolved = resolveTextStyle({ font: "g:Inter", size: "xl", color: "ink", italic: true }, { color: "primary", italic: false });
ok("résolution : le local surcharge le global, propriété par propriété", resolved.font === "g:Inter" && resolved.size === "xl" && resolved.color === "primary" && resolved.italic === false);
ok("résolution : sans local, le global", resolveTextStyle({ weight: 600 }, undefined).weight === 600);
ok("résolution : sans rien, vide", Object.keys(resolveTextStyle(undefined, undefined)).length === 0);

const decls = Object.fromEntries(textStyleDecls({ size: "l", scale: 1.2, weight: 600, case: "upper", tracking: 0.1, color: "ink-soft", align: "right", italic: false }));
ok("déclarations : taille ajustée", decls["font-size"] === "calc(1.25rem * 1.2)", decls["font-size"]);
ok("déclarations : couleur de la palette du thème", decls.color === "var(--t-color-ink-soft)");
ok("déclarations : casse, italique, interlettrage, alignement", decls["text-transform"] === "uppercase" && decls["font-style"] === "normal" && decls["letter-spacing"] === "0.1em" && decls["text-align"] === "right");
ok("déclarations : style invalide → rien", textStyleDecls({ color: "red;}body{x" }).length === 0);
ok("style React : camelCase", textStyleObject({ weight: 700, case: "upper" })?.textTransform === "uppercase");
ok("style React : vide → undefined", textStyleObject({}) === undefined);

/* ---- Échelle des tailles (lot 7) ------------------------------------------------------- */
// Valeur calculée d'un cran à une largeur d'écran (rem = 16 px, vw = 1 % de la largeur).
const px = (value, width) => {
  const one = (t) => (t.endsWith("rem") ? parseFloat(t) * 16 : t.endsWith("vw") ? (parseFloat(t) * width) / 100 : NaN);
  const m = /^clamp\((.+), (.+), (.+)\)$/.exec(value);
  return m ? Math.min(one(m[3]), Math.max(one(m[1]), one(m[2]))) : one(value);
};
for (const width of [320, 390, 768, 1024, 1280, 1440, 1920, 2560]) {
  const sizes = SIZES.map((sz) => px(SIZE_VALUES[sz], width));
  ok(`échelle des tailles strictement croissante à ${width} px`, sizes.every((v, i) => Number.isFinite(v) && (i === 0 || v > sizes[i - 1] + 1)), sizes.join(" "));
}
ok("échelle : chaque cran a un libellé avec sa valeur", SIZES.every((sz) => /\d+ px|\d+–\d+ px/.test(SIZE_LABELS[sz])));
ok("échelle : le plus grand cran dépasse le titre d'accueil (144 px à 1440)", px(SIZE_VALUES["7xl"], 1440) > 144 + 20);
ok("taille : « 1em » jamais émis (parent ≠ thème)", !textStyleDecls({ scale: 1.5 }).some(([k]) => k === "font-size"));
ok("taille : ajustement sans cran ignoré", textStyleDecls({ scale: 1.5 }).length === 0);
ok("feuille du site : surcharge les variantes du thème (spécificité)", siteStylesCss({ roles: { h1: { size: "xl" } } }).startsWith(":root:root:root #contenu h1{font-size:1.5rem}"));

/* ---- Couleur libre (lot 7) -------------------------------------------------------------- */
ok("couleur libre valide : #rrggbb", TextStyleSchema.safeParse({ color: "#a1b2c3" }).success);
ok("couleur libre valide : #rrggbbaa (translucide)", TextStyleSchema.safeParse({ color: "#a1b2c380" }).success);
ok("couleur libre : écrite telle quelle dans color:", Object.fromEntries(textStyleDecls({ color: "#a1b2c3" })).color === "#a1b2c3");
ok("couleur de palette inchangée", Object.fromEntries(textStyleDecls({ color: "primary" })).color === "var(--t-color-primary)");
ok("couleur libre : style React", textStyleObject({ color: "#a1b2c380" })?.color === "#a1b2c380");
ok("couleur libre dans le message de la toile (site-style)", FromCanvasSchema.safeParse({ kind: "site-style", role: "h1", style: { color: "#a1b2c3" } }).success);
ok("couleur libre injectée refusée dans le message de la toile", !FromCanvasSchema.safeParse({ kind: "site-style", role: "h1", style: { color: "#a1b2c3;}</style>" } }).success);
ok("feuille du site : couleur libre", siteStylesCss({ roles: { body: { color: "#102030" } } }).includes("{color:#102030}"));
ok("feuille du site : couleur libre injectée → vide", siteStylesCss({ roles: { body: { color: "#102030;}x{" } } }) === "");
const norm = (v) => normalizeCustomColor(v);
ok("normalisation : #ABC → #aabbcc", norm("#ABC") === "#aabbcc");
ok("normalisation : sans # et majuscules", norm("A1B2C3") === "#a1b2c3");
ok("normalisation : rgb(255, 0, 0)", norm("rgb(255, 0, 0)") === "#ff0000");
ok("normalisation : rgba avec opacité", norm("rgba(0, 0, 0, 0.5)") === "#00000080");
ok("normalisation : hsl(120, 100%, 25%)", norm("hsl(120, 100%, 25%)") === "#008000", norm("hsl(120, 100%, 25%)"));
ok("normalisation : opaque sans suffixe alpha", norm("#112233ff") === "#112233");
for (const bad of ["", "rouge", "#12", "#12345", "rgb(1,2)", "rgb(a,b,c)", "#ff0000;}", "url(x)", "x".repeat(200)]) ok(`normalisation : refus de « ${bad.slice(0, 20)} »`, norm(bad) === null);
const hsvTrip = rgbToHsv(parseColor("#3366cc"));
ok("aller-retour RGB ↔ HSV", rgbaToHex(hsvToRgb(hsvTrip)) === "#3366cc");
ok("HSL → RGB (gris, bleu pur)", rgbaToHex(hslToRgb({ h: 0, s: 0, l: 0.5, a: 1 })) === "#808080" && rgbaToHex(hslToRgb({ h: 240, s: 1, l: 0.5, a: 1 })) === "#0000ff");
ok("dégradé de la roue : calculé, valide", /^conic-gradient\((#[0-9a-f]{6} \d+%(, )?){13}\)$/.test(wheelGradient()));

/* ---- Sélecteur « à la Photoshop » (lot 29) : carré saturation × luminosité, bande de teinte --------- */
{
  // Aller-retour hex → HSV → hex exact : un échantillon régulier de tout le cube RVB, bornes comprises.
  let bad = 0;
  let n = 0;
  for (let r = 0; r < 256; r += r < 250 ? 17 : 5) for (let g = 0; g < 256; g += g < 250 ? 17 : 5) for (let b = 0; b < 256; b += b < 250 ? 17 : 5) {
    const hex = rgbaToHex({ r, g, b, a: 1 });
    const hsv = rgbToHsv(parseColor(hex));
    const back = rgbaToHex(hsvToRgb(hsv));
    n++;
    if (back !== hex || hsv.h < 0 || hsv.h >= 360 || hsv.s < 0 || hsv.s > 1 || hsv.v < 0 || hsv.v > 1) bad++;
  }
  ok(`hsv ↔ hex : aller-retour exact et bornes respectées (${n} couleurs)`, bad === 0, `${bad} écarts`);
  const hx = (h, s, v) => rgbaToHex(hsvToRgb({ h, s, v, a: 1 }));
  ok("hsv : coins du carré (blanc, noir, couleur pure) et gris sans saturation", hx(200, 0, 1) === "#ffffff" && hx(200, 0, 0) === "#000000" && hx(200, 1, 0) === "#000000" && hx(0, 1, 1) === "#ff0000" && hx(120, 1, 1) === "#00ff00" && hx(240, 1, 1) === "#0000ff" && hx(77, 0, 0.5) === "#808080");
  ok("hsv : 360° = 0° (le haut et le bas de la bande sont tous deux rouges)", hx(360, 1, 1) === hx(0, 1, 1));
  ok("hsv : un gris garde la teinte donnée (le curseur ne saute pas)", rgbToHsv(parseColor("#808080"), 210).h === 210 && rgbToHsv(parseColor("#000000"), 33).h === 33);
  ok("carré : gauche → droite = saturation, haut → bas = luminosité décroissante", JSON.stringify(planeToSv(0, 0)) === '{"s":0,"v":1}' && JSON.stringify(planeToSv(1, 1)) === '{"s":1,"v":0}' && planeToSv(0.5, 0.25).s === 0.5 && planeToSv(0.5, 0.25).v === 0.75);
  ok("carré : hors du carré = bornes", JSON.stringify(planeToSv(-4, 9)) === '{"s":0,"v":0}' && JSON.stringify(planeToSv(7, -2)) === '{"s":1,"v":1}');
  ok("bande : rouge en haut (360°), bas = 0°, milieu = cyan (180°)", stripToHue(0) === 360 && stripToHue(1) === 0 && stripToHue(0.5) === 180 && stripToHue(-1) === 360 && stripToHue(3) === 0);
  ok("bande : magenta, bleu, cyan, vert, jaune du haut vers le bas", [1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6].map((f) => hx(stripToHue(f), 1, 1)).join() === "#ff00ff,#0000ff,#00ffff,#00ff00,#ffff00");
  const strip = hueStripGradient();
  ok("dégradé de la bande : vertical, 13 arrêts calculés, rouge aux deux bouts", /^linear-gradient\(to bottom, (#[0-9a-f]{6} \d+%(, )?){13}\)$/.test(strip) && strip.includes("#ff0000 0%") && strip.includes("#ff0000 100%"));
  const plane = saturationPlane(0);
  ok("fond du carré : couleur pure de la teinte + voiles blanc (gauche) et noir (bas), rien d'écrit à la main", plane.backgroundColor === "#ff0000" && /to top, #000000, transparent/.test(plane.backgroundImage) && /to right, #ffffff, transparent/.test(plane.backgroundImage) && saturationPlane(240).backgroundColor === "#0000ff");
}

/* ---- Réglages d'un bloc ------------------------------------------------------------- */
const look = { spaceTop: "s", spaceBottom: "none", radius: "none", titleH: "center", titleV: "middle", text: { title: { size: "3xl" }, "paragraphs.0": { italic: true }, "site.role": { color: "primary" } }, crop: { mediaId: { x: 30, y: 70, zoom: 1.5 } }, roleBackdrop: "shadow" };
ok("look complet valide", LookSchema.safeParse(look).success, JSON.stringify(LookSchema.safeParse(look).error?.issues?.[0]));
for (const [label, bad] of [
  ["espace hors crans", { spaceTop: "huge" }],
  ["espace en px libre", { spaceTop: "12px" }],
  ["arrondi inconnu", { radius: "pill" }],
  ["zoom > 4", { crop: { mediaId: { x: 50, y: 50, zoom: 5 } } }],
  ["point focal > 100 %", { crop: { mediaId: { x: 150, y: 50, zoom: 1 } } }],
  ["cadrage d'un champ inconnu", { crop: { evil: { x: 50, y: 50, zoom: 1 } } }],
  ["chemin de texte invalide", { text: { "__proto__.x;": { italic: true } } }],
  ["trop de styles de texte", { text: Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`t${String.fromCharCode(97 + (i % 26))}x${"a".repeat(Math.floor(i / 26) + 1)}`, { italic: true }])) }],
  ["clé inconnue", { margin: "10px" }],
]) ok(`look refusé : ${label}`, !LookSchema.safeParse(bad).success);
const tolerant = readLook({ spaceTop: "m", radius: "pill", bogus: 1 });
ok("lecture tolérante : garde ce qui passe", tolerant?.spaceTop === "m" && !("radius" in tolerant) && !("bogus" in tolerant), JSON.stringify(tolerant));
ok("lecture tolérante : rien de valide → undefined", readLook({ bogus: 1 }) === undefined && readLook(null) === undefined);
ok("nettoyage : clés vides retirées", JSON.stringify(cleanLook({ spaceTop: undefined, text: {}, crop: { mediaId: undefined }, radius: "soft" })) === '{"radius":"soft"}');
ok("nettoyage : tout vide → undefined", cleanLook({ text: {} }) === undefined);
/* Cadrage des tuiles de collection (lot 11) : un cadrage par collection, bornes du cadrage commun. */
ok("tileCrop valide", LookSchema.safeParse({ tileCrop: { characters: { x: 20, y: 80, zoom: 2 }, animation: { x: 50, y: 50, zoom: 1.5 } } }).success);
for (const [label, bad] of [
  ["tuile d'une collection inconnue", { tileCrop: { evil: { x: 50, y: 50, zoom: 1 } } }],
  ["tuile : zoom > 4", { tileCrop: { characters: { x: 50, y: 50, zoom: 5 } } }],
  ["tuile : point focal < 0", { tileCrop: { characters: { x: -1, y: 50, zoom: 1 } } }],
  ["tuile : clé en trop", { tileCrop: { characters: { x: 50, y: 50, zoom: 1, rotate: 3 } } }],
]) ok(`look refusé : ${label}`, !LookSchema.safeParse(bad).success);
ok("nettoyage : cadrage de tuile vidé retiré", JSON.stringify(cleanLook({ tileCrop: { characters: undefined }, radius: "soft" })) === '{"radius":"soft"}');
ok("variables d'un cadrage (point focal, zoom)", JSON.stringify(cropVars({ x: 12.345, y: 80, zoom: 2 })) === '{"--crop-pos":"12.35% 80%","--crop-zoom":"2"}');
const attrs = lookAttributes(look);
ok("attributs de l'enveloppe", attrs["data-pt"] === "s" && attrs["data-pb"] === "none" && attrs["data-radius"] === "none" && attrs["data-th"] === "center" && attrs["data-tv"] === "middle" && attrs["data-crop"] === "" && attrs["data-role-bd"] === "shadow");
ok("aucun réglage d'enveloppe → pas d'enveloppe", lookAttributes({ text: { title: { italic: true } } }) === null && lookAttributes(undefined) === null);

/* ---- Styles du site ------------------------------------------------------------------- */
const styles = { radius: "none", roles: { h1: { font: "g:Inter", weight: 700 }, menu: { case: "normal", tracking: 0.05 }, caption: { color: "eyebrow" } } };
ok("styles du site valides", SiteStylesSchema.safeParse(styles).success);
ok("styles du site : rôle inconnu refusé", !SiteStylesSchema.safeParse({ roles: { footer: { italic: true } } }).success);
const css = siteStylesCss(styles);
ok("feuille : arrondi du site", css.includes(":root{--media-radius:0px}"));
ok("feuille : Titre 1", css.includes('#contenu h1{font-family:"Inter", ui-sans-serif, system-ui, sans-serif;font-weight:700}'), css);
ok("feuille : menu après légendes (le dernier gagne)", css.indexOf(".site-header nav") > css.indexOf(".caption-text"));
ok("feuille : styles invalides → vide", siteStylesCss({ roles: { h1: { color: "</style><script>" } } }) === "");
ok("feuille : jamais de « < »", !siteStylesCss(styles).includes("<"));
ok("nettoyage des styles : rôles vides retirés", JSON.stringify(cleanSiteStyles({ roles: { h1: {}, h2: { italic: true } } })) === '{"roles":{"h2":{"italic":true}}}');
ok("nettoyage des styles : rien → undefined", cleanSiteStyles({ roles: {} }) === undefined);
const snap = { identity: { name: { fr: "A", en: "" }, role: { fr: "", en: "" }, email: "", credit: { fr: "", en: "" } }, nav: [], socials: [] };
ok("brouillon du site : sans styles (données d'avant) valide", SiteSnapSchema.safeParse(snap).success);
ok("brouillon du site : avec styles valide", SiteSnapSchema.safeParse({ ...snap, styles }).success);
ok("brouillon du site : styles invalides refusés", !SiteSnapSchema.safeParse({ ...snap, styles: { roles: { h1: { font: "g:Nope" } } } }).success);

/* ---- Cadrage ---------------------------------------------------------------------------- */
// Image 3:2 dans un cadre carré : la fenêtre couvre 2/3 de la largeur, toute la hauteur.
let w = cropWindow({ x: 50, y: 50, zoom: 1 }, 1.5, 1);
ok("fenêtre centrée (3:2 dans 1:1)", near(w.width, 2 / 3) && near(w.height, 1) && near(w.left, 1 / 6) && near(w.top, 0), JSON.stringify(w));
w = cropWindow({ x: 0, y: 50, zoom: 1 }, 1.5, 1);
ok("point focal à gauche : fenêtre collée à gauche", near(w.left, 0));
w = cropWindow({ x: 100, y: 100, zoom: 2 }, 1.5, 1);
ok("zoom ×2 : fenêtre moitié, collée en bas à droite", near(w.width, 1 / 3) && near(w.height, 0.5) && near(w.left + w.width, 1) && near(w.top + w.height, 1), JSON.stringify(w));
// Image portrait 4:5 dans un cadre 16:9 : la fenêtre couvre toute la largeur.
w = cropWindow({ x: 50, y: 20, zoom: 1 }, 0.8, 16 / 9);
ok("portrait dans paysage : toute la largeur", near(w.width, 1) && near(w.height, 0.8 / (16 / 9)));
for (const c of [{ x: 30, y: 70, zoom: 1.5 }, { x: 0, y: 100, zoom: 3 }, { x: 85, y: 50, zoom: 1 }]) {
  const win = cropWindow(c, 1.5, 0.8);
  const back = cropFromWindow(win.left, win.top, c.zoom, 1.5, 0.8);
  ok(`aller-retour fenêtre ↔ cadrage ${JSON.stringify(c)}`, near(back.x, c.x, 0.05) && near(back.y, c.y, 0.05) && near(back.zoom, c.zoom), JSON.stringify(back));
}
ok("cadrage hors bornes ramené (zoom ≤ 4, % ≤ 100)", cropFromWindow(2, 2, 9, 1.5, 1).zoom === 4 && cropFromWindow(2, 2, 9, 1.5, 1).x === 100);
ok("cadrage valide pour le schéma", LookSchema.safeParse({ crop: { mediaId: cropFromWindow(0.1, 0.2, 1.7, 1.5, 1) } }).success);
ok("au bon format : rien à cadrer", !needsCrop(1.5, 1.505) && needsCrop(1.5, 1));

/* ---- Polices téléchargées par le serveur -------------------------------------------------- */
ok("adresse Google : hôte fixe, famille encodée", googleCssUrl("Playfair Display", 700, true) === "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@1,700&display=swap");
const sample = `/* latin-ext */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/inter/v20/abc-ext.woff2) format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5, U+1E00-1E9F;
}
/* latin */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 700;
  src: url(https://fonts.gstatic.com/s/inter/v20/abc.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131;
}
/* cyrillic */
@font-face {
  font-family: 'Inter';
  font-weight: 700;
  src: url(https://evil.example/x.woff2) format('woff2');
}`;
const faces = parseGoogleCss(sample);
ok("feuille Google lue : 2 faces sur gstatic, hôte étranger ignoré", faces.length === 2 && faces.every((f) => f.url.startsWith("https://fonts.gstatic.com/")), JSON.stringify(faces));
ok("feuille Google : sous-ensembles et plages", faces[0].subset === "latin-ext" && faces[1].subset === "latin" && faces[1].range === "U+0000-00FF, U+0131");
const textCss = "@font-face { font-family: 'Lora'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/l/font?kit=abc&skey=def&v=v37) format('woff2'); }";
ok("aperçu (text=) : adresse gstatic /l/font acceptée, sous-ensemble « text »", parseGoogleCss(textCss)[0]?.subset === "text");
ok("adresse /l/font refusée pour un sous-ensemble nommé", parseGoogleCss(`/* latin */ ${textCss}`).length === 0);
const lib = readLibrary({
  Inter: [{ weight: 700, italic: false, subset: "latin", file: "0123456789abcdef.woff2", range: "U+0000-00FF", bytes: 1000 }],
  "Comic Sans MS": [{ weight: 400, italic: false, subset: "latin", file: "fedcba9876543210.woff2", range: "U+0000-00FF", bytes: 1000 }],
  Lato: [{ weight: 400, italic: false, subset: "latin", file: "../../etc/passwd", range: "U+0000-00FF", bytes: 1 }],
});
ok("bibliothèque : familles hors catalogue et fichiers douteux ignorés", Object.keys(lib).join() === "Inter", Object.keys(lib).join());
const faceCss = fontFaceCss(lib);
ok("@font-face servi par le site (/fonts/…), jamais Google", faceCss.includes('src:url("/fonts/0123456789abcdef.woff2")') && !faceCss.includes("gstatic") && !faceCss.includes("googleapis"));

/* ---- Messages de la toile ------------------------------------------------------------------- */
ok("message look valide", FromCanvasSchema.safeParse({ kind: "look", uid: "b1", look: { spaceTop: "m" } }).success);
ok("message look : réinitialiser (null)", FromCanvasSchema.safeParse({ kind: "look", uid: "b1", look: null }).success);
ok("message look : valeur libre refusée", !FromCanvasSchema.safeParse({ kind: "look", uid: "b1", look: { spaceTop: "13px" } }).success);
ok("message site-style valide", FromCanvasSchema.safeParse({ kind: "site-style", role: "h1", style: { font: "g:Inter" } }).success);
ok("message site-style : rôle inconnu refusé", !FromCanvasSchema.safeParse({ kind: "site-style", role: "body;x", style: null }).success);

/* ---- Thème : resserrement et arrondi ---------------------------------------------------------- */
const gl = PRESETS["galerie-lumineuse"];
const vars = layoutVariables(gl);
ok("galerie-lumineuse : images sans arrondi", vars["--t-media-radius"] === "0px");
ok("galerie-lumineuse : haut de page resserré", vars["--t-page-top"] !== "clamp(6rem, 14vh, 10rem)");
ok("galerie-lumineuse : métier de l'ouverture en ombre douce (contraste mesuré)", themeAttributes(gl)["data-hero-role"] === "shadow");
const pro = PRESETS.pro;
ok("thème sans bloc layout : espaces d'avant, aucun arrondi imposé", layoutVariables(pro)["--t-page-top"] === "clamp(6rem, 14vh, 10rem)" && !("--t-media-radius" in layoutVariables(pro)) && !("data-hero-role" in themeAttributes(pro)));

/* ---- Typographie du thème (tokens.type, intégration lots 2 + 5) ------------------------------- */
ok("thème sans tokens.type : aucune règle", themeTypeCss(pro) === "");
for (const id of ["planche-de-story", "salle-de-montage", "studio", "fanzine-riso"]) {
  const t = PRESETS[id];
  ok(`${id} : layout complet (crans, arrondi des images)`, ["spaceS", "spaceM", "spaceL", "spaceXL", "pageTop", "stripPad", "mediaRadius"].every((k) => t.tokens.layout?.[k]));
  ok(`${id} : typographie du thème émise (sélecteurs des rôles du site)`, themeTypeCss(t).includes("{") && !themeTypeCss(t).includes("<"));
}
ok("salle-de-montage : titres en capitales 800", /#contenu h1\{[^}]*text-transform:uppercase[^}]*\}/.test(themeTypeCss(PRESETS["salle-de-montage"])) && themeTypeCss(PRESETS["salle-de-montage"]).includes("font-weight:800"));
ok("studio : légendes en bas de casse, titres serrés", themeTypeCss(PRESETS.studio).includes("text-transform:none") && themeTypeCss(PRESETS.studio).includes("letter-spacing:-0.02em"));
const typed = (type) => ThemeSchema.safeParse({ ...pro, tokens: { ...pro.tokens, type } }).success;
ok("tokens.type : polices du thème seulement (ni Google ni embarquée), crans bornés, rôle inconnu refusé", typed({ h1: { font: "display", weight: 700 } }) && !typed({ h1: { font: "g:Roboto" } }) && !typed({ h1: { font: "embed:kalam" } }) && !typed({ h1: { weight: 750 } }) && !typed({ h1: { tracking: 2 } }) && !typed({ titre: { weight: 700 } }) && !typed({ h1: { color: "red" } }));
ok("tokens.type : police du thème → variable du thème", themeTypeCss({ tokens: { type: { h2: { font: "display" } } } }).includes("font-family:var(--t-font-display)"));

/* ---- Arrondi par image d'une planche (intégration lots 2 + 3) ------------------------------------ */
ok("look.slotRadius : crans par slug d'emplacement acceptés", LookSchema.safeParse({ slotRadius: { "vallee-suspendue": "none", "duo-marche": "strong" } }).success);
ok("look.slotRadius : slug invalide, cran inconnu, plus de 200 entrées refusés", !LookSchema.safeParse({ slotRadius: { "../x": "none" } }).success && !LookSchema.safeParse({ slotRadius: { a: "huge" } }).success && !LookSchema.safeParse({ slotRadius: Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`s-${i}`, "soft"])) }).success);
ok("look.slotRadius : lecture tolérante (réglage invalide ignoré, le reste gardé)", JSON.stringify(readLook({ spaceTop: "m", slotRadius: { "<x>": "none" } })) === JSON.stringify({ spaceTop: "m" }));

/* ---- Cadre autour d'une photo (lot 34) ------------------------------------------------------------ */
ok("look.frame : trois épaisseurs, couleur facultative (palette ou #rrggbb[aa])", FRAME_SIZES.join() === "thin,medium,thick" && ["thin", "medium", "thick"].every((size) => LookSchema.safeParse({ frame: { size } }).success) && LookSchema.safeParse({ frame: { size: "thick", color: "tertiary" } }).success && LookSchema.safeParse({ frame: { size: "thin", color: "#a1b2c3" } }).success && LookSchema.safeParse({ frame: { size: "thin", color: "#a1b2c3cc" } }).success);
ok("look.frame : épaisseur inconnue ou absente, couleur invalide, clé en trop refusées", ["xl", "", 6, undefined].every((size) => !FrameSchema.safeParse({ size }).success) && !FrameSchema.safeParse({}).success && ["red", "#fff", "#A1B2C3", "url(x)", "var(--x)", "#a1b2c3;x"].every((color) => !FrameSchema.safeParse({ size: "thin", color }).success) && !FrameSchema.safeParse({ size: "thin", width: 40 }).success);
ok("look.slotFrame : cadres par slug d'emplacement, slug invalide / cadre invalide / plus de 200 entrées refusés", LookSchema.safeParse({ slotFrame: { "vallee-suspendue": { size: "medium" }, "duo-marche": { size: "thick", color: "#112233" } } }).success && !LookSchema.safeParse({ slotFrame: { "../x": { size: "thin" } } }).success && !LookSchema.safeParse({ slotFrame: { a: { size: "huge" } } }).success && !LookSchema.safeParse({ slotFrame: Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`s-${i}`, { size: "thin" }])) }).success);
ok("couleur par défaut du cadre : le texte du thème (suit le thème)", FRAME_DEFAULT_COLOR === "ink" && frameColorCss(undefined) === "var(--t-color-ink)");
ok("couleur du cadre : palette → variable du thème, libre → telle quelle, valeur inconnue → défaut", frameColorCss("tertiary") === "var(--t-color-tertiary)" && frameColorCss("surface") === "var(--t-color-surface)" && frameColorCss("#a1b2c3") === "#a1b2c3" && frameColorCss("#a1b2c3cc") === "#a1b2c3cc" && frameColorCss("red; background:url(x)") === "var(--t-color-ink)");
ok("frameAttrs : aucun cadre par défaut ; un cadre valide donne data-frame + --frame-color ; un cadre invalide est ignoré", frameAttrs(undefined) === null && frameAttrs({ size: "huge" }) === null && JSON.stringify(frameAttrs({ size: "medium" })) === JSON.stringify({ "data-frame": "medium", style: { "--frame-color": "var(--t-color-ink)" } }) && frameAttrs({ size: "thin", color: "#000000" })?.style["--frame-color"] === "#000000");
ok("look.frame : lecture tolérante (cadre invalide ignoré, le reste gardé), cadre seul = réglage non vide, nettoyage", JSON.stringify(readLook({ spaceTop: "m", frame: { size: "huge" } })) === JSON.stringify({ spaceTop: "m" }) && JSON.stringify(readLook({ frame: { size: "thin", color: "primary" } })) === JSON.stringify({ frame: { size: "thin", color: "primary" } }) && cleanLook({ frame: undefined, slotFrame: {} }) === undefined && JSON.stringify(cleanLook({ slotFrame: { a: { size: "thin" } } })) === JSON.stringify({ slotFrame: { a: { size: "thin" } } }));
ok("look.frame : pas d'attribut sur l'enveloppe du bloc (le cadre est posé par l'image elle-même)", lookAttributes({ frame: { size: "thin" } }) === null);

if (failures) {
  console.error(`test-look : ÉCHEC (${failures}/${count})`);
  process.exit(1);
}
console.log(`test-look : OK (${count} contrôles)`);
