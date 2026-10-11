#!/usr/bin/env node
/**
 * Palette du thème et curseurs dessinés (lot 4) :
 *  - migration à rendu identique : pour chaque preset, chaque variable de
 *    couleur émise est celle de l'ancienne règle (valeurs enregistrées telles
 *    quelles, eyebrow → secondary, voile / ombre selon clair-sombre) ;
 *  - auto / forcé : retour à auto, une base qui change entraîne ses nuances
 *    auto et pas les choisies, normalisation idempotente, OKLCH aller-retour ;
 *  - dérivation : texte secondaire auto toujours AA, texte des boutons lisible ;
 *  - schéma : bloc palette, nuances facultatives, curseurs (chemins PNG du kit,
 *    point chaud 0–31) ; CSS des curseurs (repli obligatoire, HiDPI, désactivés) ;
 *  - visibilité d'un curseur sur les fonds.
 * Usage : npm test (via tsx : css.ts a des imports sans extension)
 */
const { PRESETS } = await import(new URL("../src/themes/presets/index.ts", import.meta.url));
const { ThemeSchema } = await import(new URL("../src/themes/schema.ts", import.meta.url));
const { themeToCss, themeVariables, themeAttributes, relativeLuminance } = await import(new URL("../src/themes/css.ts", import.meta.url));
const P = await import(new URL("../src/themes/palette.ts", import.meta.url));
const { contrastReport } = await import(new URL("../src/themes/contrast.ts", import.meta.url));
const { cursorVisibility, cursorProblem } = await import(new URL("../src/themes/cursor.ts", import.meta.url));

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? " — " + detail : ""}`);
};

/* ---- Migration : rendu identique ------------------------------------------ */
// Ancienne règle de css.ts (avant la palette), recopiée ici comme référence.
function oldColorVars(theme) {
  const c = theme.tokens.color;
  const light = relativeLuminance(c.bg) >= 0.2;
  return {
    "--t-color-bg": c.bg,
    "--t-color-bg-deep": c.bgDeep,
    "--t-color-surface": c.surface,
    "--t-color-ink": c.ink,
    "--t-color-ink-soft": c.inkSoft,
    "--t-color-line": c.line,
    "--t-color-primary": c.primary,
    "--t-color-primary-hover": c.primaryHover,
    "--t-color-on-primary": c.onPrimary,
    "--t-color-secondary": c.secondary,
    "--t-color-tertiary": c.tertiary,
    "--t-color-eyebrow": c.eyebrow ?? c.secondary,
    "--t-color-accent-glow": c.accentGlow ?? "transparent",
    "--t-color-scrim": light ? c.ink : c.bg,
    "--t-color-on-scrim": light ? c.bg : c.ink,
    "--t-color-shadow": light ? c.ink : "#000000",
  };
}
for (const [id, theme] of Object.entries(PRESETS)) {
  const now = themeVariables(theme);
  const old = oldColorVars(theme);
  const diff = Object.entries(old).filter(([k, v]) => now[k] !== v);
  ok(`migration ${id} : variables de couleur identiques à l'ancienne règle`, diff.length === 0, JSON.stringify(diff.map(([k, v]) => [k, v, now[k]])));
  if (!theme.tokens.palette) {
    // Thème d'avant ce modèle : nuances enregistrées toutes « choisies ».
    ok(`migration ${id} : nuances enregistrées « choisies », facultatives « auto »`, P.STORED_NUANCES.every((k) => !P.isAuto(theme.tokens.color, theme.tokens.palette, k)) && ["shadow", "scrim", "onScrim"].every((k) => P.isAuto(theme.tokens.color, theme.tokens.palette, k)));
  } else {
    // Thème livré avec palette (v0.14, intégration) : valeurs enregistrées = valeurs dérivées (déjà normalisé).
    const norm = P.normalizePalette(theme.tokens.color, theme.tokens.palette);
    ok(`palette ${id} : nuances auto enregistrées à jour (${theme.tokens.palette.auto?.join(", ")}), facultatives « auto »`, P.STORED_NUANCES.every((k) => norm[k] === theme.tokens.color[k]) && ["shadow", "scrim", "onScrim"].every((k) => P.isAuto(theme.tokens.color, theme.tokens.palette, k)), JSON.stringify(P.STORED_NUANCES.filter((k) => norm[k] !== theme.tokens.color[k])));
  }
  // Un thème enregistré tel quel (JSON) relu par le schéma : même feuille.
  ok(`migration ${id} : thème relu du JSON → même CSS`, themeToCss(ThemeSchema.parse(JSON.parse(JSON.stringify(theme)))) === themeToCss(theme));
}

/* ---- OKLCH -------------------------------------------------------------- */
const samples = ["#faf9f6", "#232629", "#2e4e9e", "#e3a93e", "#161b26", "#b13e2b", "#7e8f77", "#ffffff", "#000000"];
ok("OKLCH aller-retour exact (#rrggbb)", samples.every((h) => P.fromOklch(P.toOklch(h)) === h), samples.map((h) => P.fromOklch(P.toOklch(h))).join(","));
const vivid = P.fromOklch({ l: 0.7, c: 0.5, h: 30 });
ok("OKLCH hors gamut : chroma réduite, couleur valide", /^#[0-9a-f]{6}$/.test(vivid), vivid);

/* ---- Auto / forcé --------------------------------------------------------- */
const g = PRESETS["galerie-lumineuse"];
const c0 = g.tokens.color;
let st = P.setNuance(c0, undefined, "primaryHover", null);
ok("revenir à auto : nuance enregistrée listée dans palette.auto", st.palette?.auto?.includes("primaryHover") === true, JSON.stringify(st.palette));
ok("auto : valeur = dérivation OKLCH (action un cran plus foncée)", st.color.primaryHover === P.deriveNuance("primaryHover", P.resolvePalette(c0)) && P.toOklch(st.color.primaryHover).l < P.toOklch(c0.primary).l, st.color.primaryHover);
const moved = P.setBase(st.color, st.palette, "primary", "#8a2be2");
ok("base changée : la nuance auto suit", moved.primaryHover !== st.color.primaryHover && moved.primaryHover === P.deriveNuance("primaryHover", { ...P.resolvePalette(moved, st.palette) }), moved.primaryHover);
const forced = P.setNuance(c0, undefined, "bgDeep", "#eeeeee");
const moved2 = P.setBase(forced.color, forced.palette, "bg", "#fefefe");
ok("base changée : la nuance choisie ne bouge pas", moved2.bgDeep === "#eeeeee");
ok("normalisation idempotente", JSON.stringify(P.normalizePalette(moved, st.palette)) === JSON.stringify(moved));
const back = P.setNuance(st.color, st.palette, "primaryHover", "#123456");
ok("valeur choisie : sort de palette.auto (bloc retiré s'il est vide)", back.palette === undefined && back.color.primaryHover === "#123456");
const eb = P.setNuance(c0, undefined, "eyebrow", "#654321");
ok("nuance facultative choisie : présente ; auto : absente", eb.color.eyebrow === "#654321" && P.setNuance(eb.color, eb.palette, "eyebrow", null).color.eyebrow === undefined);
ok("libellés du kit", P.paletteLabel("primaryHover") === "Action · survol" && P.paletteLabel("bg") === "Fond" && P.paletteLabel("scrim") === "Visionneuse · voile");

/* ---- Dérivation ------------------------------------------------------------ */
for (const [id, theme] of Object.entries(PRESETS)) {
  let all = { ...theme.tokens.color };
  let pal;
  for (const k of P.STORED_NUANCES) {
    const n = P.setNuance(all, pal, k, null);
    all = n.color;
    pal = n.palette;
  }
  const failing = contrastReport(all).filter((p) => !p.ok && ["inkSoft", "onPrimary"].includes(p.fg));
  ok(`dérivation ${id} : texte secondaire et texte des boutons auto lisibles (AA)`, failing.length === 0, failing.map((p) => `${p.label} ${p.ratio.toFixed(2)}`).join(", "));
}
const salle = P.resolvePalette(P.setNuance(PRESETS["salle-de-projection"].tokens.color, undefined, "onPrimary", null).color, { auto: ["onPrimary"] });
ok("dérivation : texte des boutons sombre sur un ambre (thème sombre)", salle.onPrimary === "#161b26", salle.onPrimary);
ok("dérivation : survol plus clair sur un thème sombre", P.toOklch(P.deriveNuance("primaryHover", P.resolvePalette(PRESETS["salle-de-projection"].tokens.color))).l > P.toOklch("#e3a93e").l);

/* ---- Schéma ----------------------------------------------------------------- */
const withTokens = (tokens) => ({ ...g, id: "t-pal", preset: false, tokens: { ...g.tokens, ...tokens } });
ok("schéma : palette.auto valide", ThemeSchema.safeParse(withTokens({ palette: { auto: ["bgDeep", "onPrimary"] } })).success);
ok("schéma : clé inconnue dans palette.auto refusée", !ThemeSchema.safeParse(withTokens({ palette: { auto: ["bg"] } })).success);
ok("schéma : nuance facultative opaque seulement (pas d'injection)", !ThemeSchema.safeParse(withTokens({ color: { ...c0, scrim: "red;}body{" } })).success && ThemeSchema.safeParse(withTokens({ color: { ...c0, scrim: "#101010" } })).success);
const auto = ThemeSchema.parse(withTokens({ palette: { auto: ["primaryHover"] }, color: { ...c0, primaryHover: "#000000" } }));
ok("rendu : nuance auto recalculée même si la valeur enregistrée est périmée", themeVariables(auto)["--t-color-primary-hover"] === P.deriveNuance("primaryHover", P.resolvePalette(c0)));

/* ---- Curseurs : schéma et CSS ------------------------------------------------ */
const cur = (x = 2, y = 2) => ({ png: "/media/kit/0123456789abcdef.png", png2x: "/media/kit/fedcba9876543210.png", x, y });
const withCursors = (cursors) => ({ ...g, id: "t-cur", preset: false, assets: { ...g.assets, kit: { cursors } } });
const tc = ThemeSchema.parse(withCursors({ default: cur(), pointer: cur(13, 1) }));
const vars = themeVariables(tc);
ok("curseurs : --t-cursor-default PNG 32 + point chaud + repli auto", vars["--t-cursor-default"] === 'url("/media/kit/0123456789abcdef.png") 2 2, auto', vars["--t-cursor-default"]);
ok("curseurs : --t-cursor-pointer repli pointer", vars["--t-cursor-pointer"] === 'url("/media/kit/0123456789abcdef.png") 13 1, pointer', vars["--t-cursor-pointer"]);
ok("curseurs : HiDPI image-set 1x / 2x", vars["--t-cursor-default-hd"]?.startsWith('image-set(url("/media/kit/0123456789abcdef.png") 1x, url("/media/kit/fedcba9876543210.png") 2x) 2 2, auto'));
ok("curseurs : attributs data-kit-cursor(-pointer)", "data-kit-cursor" in themeAttributes(tc) && "data-kit-cursor-pointer" in themeAttributes(tc));
const off = ThemeSchema.parse(withCursors({ default: cur(), off: true }));
ok("curseurs désactivés : aucune variable ni attribut", !themeToCss(off).includes("--t-cursor") && !("data-kit-cursor" in themeAttributes(off)));
ok("sans curseur : rien (parité)", !themeToCss(g).includes("--t-cursor") && !Object.keys(themeAttributes(g)).some((k) => k.startsWith("data-kit-cursor")));
ok("schéma : point chaud hors de 0–31 refusé", !ThemeSchema.safeParse(withCursors({ default: cur(32, 0) })).success);
ok("schéma : chemin de curseur hors kit / non PNG refusé", !ThemeSchema.safeParse(withCursors({ default: { ...cur(), png: "/media/kit/0123456789abcdef.svg" } })).success && !ThemeSchema.safeParse(withCursors({ default: { ...cur(), png: "https://x.test/a.png" } })).success);

/* ---- Visibilité d'un curseur ----------------------------------------------------- */
const px = (pixels) => Uint8ClampedArray.from(pixels.flat());
const arrow = px([...Array(60).fill([0, 0, 0, 255]), ...Array(40).fill([255, 255, 255, 255])]);
const pale = px(Array(100).fill([240, 240, 240, 255]));
ok("curseur noir au contour blanc : visible sur blanc et sur noir", cursorVisibility(arrow, ["#ffffff", "#000000"]).every((r) => r.visible >= 0.15) && cursorProblem(arrow, [{ hex: "#faf9f6", label: "le fond" }]) === null);
ok("curseur gris clair sur fond clair : avertissement", /presque invisible sur le fond/.test(cursorProblem(pale, [{ hex: "#faf9f6", label: "le fond" }]) ?? ""));

console.log(failures ? `\n${failures} échec(s)` : "\ntest-palette : tout passe");
process.exit(failures ? 1 : 0);
