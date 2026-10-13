#!/usr/bin/env node
/**
 * Éléments dessinés du thème (assets.kit) : schéma (chemins de kit seulement,
 * aucune injection CSS), variables et attributs émis, et garantie de parité
 * (sans kit : aucune variable, aucun attribut de plus).
 * Usage : npm test (via tsx : css.ts a des imports sans extension)
 */
const { PRESETS } = await import(new URL("../src/themes/presets/index.ts", import.meta.url));
const { ThemeSchema } = await import(new URL("../src/themes/schema.ts", import.meta.url));
const { kitAttributes, kitVariables, themeAttributes, themeToCss } = await import(new URL("../src/themes/css.ts", import.meta.url));
const { TILE_REPEAT, tileRepeatStats } = await import(new URL("../src/lib/kit/formats.ts", import.meta.url));
const { readFileSync } = await import("node:fs");

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? " — " + detail : ""}`);
};

const base = PRESETS["galerie-lumineuse"];
const svg = (h) => `/media/kit/${h.repeat(16).slice(0, 16)}.svg`;
const img = (h, w = 100, hh = 50) => ({ svg: svg(h), w, h: hh });
const withKit = (kit) => ({ ...base, id: "test-kit", preset: false, assets: { ...base.assets, kit } });

ok("sans kit : aucune variable --t-kit-*, aucun attribut data-kit-* (parité)", !themeToCss(base).includes("--t-kit") && !Object.keys(themeAttributes(base)).some((k) => k.startsWith("data-kit")));
ok("kit vide : rien non plus", Object.keys(kitVariables({})).length === 0 && Object.keys(kitAttributes({})).length === 0);

const full = withKit({
  plans: [{ avif: "/media/kit/0123456789abcdef.avif", webp: "/media/kit/0123456789abcdef.webp", w: 2880, h: 1600, x: 0, y: 0, thumbhash: "seYJHIR3d3dweHh3d3eIgHcHhw==" }, null],
  signature: img("a", 1200, 300),
  paper: { image: { avif: "/media/kit/bbbbbbbbbbbbbbbb.avif", webp: "/media/kit/cccccccccccccccc.webp", w: 512, h: 512 }, overHero: 0.35 },
  frame: { image: img("d", 300, 300), slice: [48, 48, 48, 48] },
  stroke: img("e", 1200, 80),
  icons: { arrowLeft: img("f"), close: img("1") },
  tape: img("2", 400, 160),
});
ok("thème avec kit complet : valide", ThemeSchema.safeParse(full).success, JSON.stringify(ThemeSchema.safeParse(full).error?.issues?.[0]));
const css = themeToCss(ThemeSchema.parse(full));
ok("variables émises (signature, papier image-set, cadre, trait, icônes, scotch)", ["--t-kit-signature:url(\"/media/kit/aaaaaaaaaaaaaaaa.svg\")", "--t-kit-paper:image-set(", "--t-kit-frame-slice:48 48 48 48", "--t-kit-paper-size:256px 256px", "--t-kit-icon-arrow-left", "--t-kit-tape-ratio:400 / 160"].every((s) => css.includes(s)), css.slice(0, 300));
const attrs = Object.keys(themeAttributes(ThemeSchema.parse(full)));
ok("attributs : seulement ceux des assets présents", attrs.includes("data-kit-icon-arrow-left") && attrs.includes("data-kit-icon-close") && !attrs.includes("data-kit-icon-play") && attrs.includes("data-kit-paper-hero"), attrs.join(","));

for (const [label, bad] of [
  ["chemin hors /media/kit", "/themes/x/y.svg"],
  ["url( injectée", '/media/kit/0123456789abcdef.svg") ; background:url("//evil'],
  ["remontée de dossier", "/media/kit/../originals/x.svg"],
  ["extension inattendue", "/media/kit/0123456789abcdef.html"],
  ["hachage trop court", "/media/kit/abc.svg"],
]) {
  ok(`refus : ${label}`, !ThemeSchema.safeParse(withKit({ signature: { svg: bad, w: 10, h: 10 } })).success);
}
ok("refus : asset sans SVG ni paire AVIF + WebP", !ThemeSchema.safeParse(withKit({ stroke: { avif: "/media/kit/0123456789abcdef.avif", w: 10, h: 10 } })).success);
ok("décor libre (kit v4) : jusqu'à 8 plans, plansOnly accepté", ThemeSchema.safeParse(withKit({ plans: Array(8).fill(null), plansOnly: true })).success);
ok("refus : plus de 8 plans", !ThemeSchema.safeParse(withKit({ plans: Array(9).fill(null) })).success);
ok("refus : clé inconnue (strict)", !ThemeSchema.safeParse(withKit({ logo: img("a") })).success);
ok("refus : ThumbHash non base64", !ThemeSchema.safeParse(withKit({ signature: { ...img("a"), thumbhash: "<script>" } })).success);

ok("refus : papier sur le hero au-delà du plafond (0.6)", !ThemeSchema.safeParse(withKit({ paper: { image: img("b"), overHero: 0.9 } })).success);
const variantsCss = readFileSync(new URL("../src/themes/variants.css", import.meta.url), "utf8");
ok("papier sur le hero : opacité par défaut discrète (0.35)", variantsCss.includes("opacity: var(--t-kit-paper-hero, 0.35)"));

// Papier sous le bandeau (lot 17a) : par défaut le bandeau collant est un aplat ; l'option remet la tuile.
ok("papier : bandeau du haut en aplat par défaut (règle CSS, sans data-kit-paper-header)", /\[data-kit-paper\]:not\(\[data-kit-paper-header\]\) \.site-header \{[^}]*background-color: var\(--color-bg\);[^}]*background-image: none;/.test(variantsCss));
ok("papier : pas d'attribut data-kit-paper-header par défaut", !attrs.includes("data-kit-paper-header"));
const under = ThemeSchema.parse(withKit({ paper: { image: img("b"), overHero: 0.35, underHeader: true } }));
ok("papier : option underHeader → data-kit-paper-header", Object.keys(themeAttributes(under)).includes("data-kit-paper-header"));
ok("refus : underHeader non booléen", !ThemeSchema.safeParse(withKit({ paper: { image: img("b"), underHeader: "oui" } })).success);

// Répétition visible d'une tuile : un grain passe, un motif à l'échelle de la tuile est signalé.
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const tile = (fn, size = 512) => {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = fn(x, y, size);
    data.set([v + 4, v, v - 10, 255], (y * size + x) * 4);
  }
  return { width: size, height: size, data };
};
const flags = (t) => {
  const r = tileRepeatStats(t);
  return { r, warn: r.rho > TILE_REPEAT.rho && r.contrast > TILE_REPEAT.contrast };
};
const grain = flags(tile(() => 238 + (rand() - 0.5) * 24));
ok("tuile : grain fin seul, pas d'avertissement", !grain.warn, JSON.stringify(grain.r));
const k = (2 * Math.PI) / 512;
const gingham = flags(tile((x, y) => 238 + Math.sin(7 * k * y) * 3 + Math.cos(11 * k * x) * 2 + Math.sin(3 * k * x + 2 * k * y) * 4 + (rand() - 0.5) * 10));
ok("tuile : motif à l'échelle de la tuile (vichy du fixture), avertissement", gingham.warn, JSON.stringify(gingham.r));
const faint = flags(tile((x, y) => 238 + Math.sin(7 * k * y) * 0.6 + (rand() - 0.5) * 10));
ok("tuile : motif imperceptible (< 1.5 niveau), pas d'avertissement", !faint.warn, JSON.stringify(faint.r));
console.log(`      mesures : grain ${JSON.stringify(grain.r)} ; vichy ${JSON.stringify(gingham.r)} ; motif faible ${JSON.stringify(faint.r)}`);

if (failures) {
  console.error(`test-theme-kit : ${failures} échec(s)`);
  process.exit(1);
}
console.log("test-theme-kit : OK");
