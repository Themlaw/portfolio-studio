#!/usr/bin/env node
/**
 * Import d'un kit PSD (src/lib/kit) :
 *  - noms tolérés (casse, accents, espaces, tirets, numérotation, anciens noms
 *    v1), calques ignorés (guides, aperçus, lisez-moi), sous-groupes ;
 *  - aplatissement : modes de fusion simples, opacité, avertissement sinon,
 *    calque recadré par Photoshop replacé dans sa case ;
 *  - préalable sans décodage : signature, dimensions ;
 *  - fichier RÉEL de l'artiste (tests/fixtures/kit-synthetique.psd,
 *    kit v1 réenregistré par Photoshop, flèche droite redessinée) : seule
 *    « Flèche droite » ressort redessinée, vectorisée en masque dans sa boîte
 *    128 × 128, fidélité du contour mesurée ; tout le reste inchangé.
 *    Manifeste de référence : empreintes du kit v1 d'origine (legacy-manifest.mts).
 * Usage : npm test (via tsx)
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const kit = (f) => import(new URL(`../src/lib/kit/${f}`, import.meta.url));
const { looseName, SLOTS, DOC_V1 } = await kit("spec.ts");
const { resolveSlots, flattenSlot, SlotRefusal, treeStats, treeProblem, MAX_NESTING, hasZipChannels } = await kit("resolve.ts");
const { findReference } = await kit("manifest.ts");
const { importKit, PSD_READ_OPTIONS } = await kit("import.ts");
const { preflightPsd, preflightProblem, PsdPreflightError } = await kit("psd-header.ts");
const { DEFAULT_LIMITS } = await kit("limits.ts");
const { ensureAgPsd } = await kit("ag-psd-node.ts");
const { readPsd, writePsdBuffer } = await import("ag-psd");

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? " — " + detail : ""}`);
};
const tmp = mkdtempSync(path.join(os.tmpdir(), "kit-test-"));

/* ---- Noms -------------------------------------------------------------- */
const names = [
  ["Plan 1 — le plus lointain (ciel)", "plan-1"],
  ["Plan 5 — premier plan", "plan-5"],
  ["PLAN_3", "plan-3"],
  ["plan-2", "plan-2"],
  ["1 · Paysage d'accueil", "paysage-d-accueil"],
  ["Flèche  Droite", "fleche-droite"],
  ["fleche_gauche", "fleche-gauche"],
  ["6 · Icônes", "icones"],
  ["Papier (tuile)", "papier"],
  ["4 · Cadre des images agrandies", "cadre-des-images-agrandies"],
  ["4 · Cadre des entrées de collection", "cadre-des-entrees-de-collection"],
];
ok("noms réduits (casse, accents, espaces, tirets, numérotation, précisions)", names.every(([n, want]) => looseName(n) === want), JSON.stringify(names.map(([n]) => looseName(n))));

const L = (name, extra = {}) => ({ name, left: 0, top: 0, right: 1, bottom: 1, ...extra });
const tree = [
  L("LISEZ-MOI"),
  { name: "_guides", children: [L("repères"), L("kit k2-0123456789ab — ne pas supprimer")] },
  { name: "1 · Paysage d'accueil", children: [L("Aperçu — ne pas modifier"), L("Plan 1 — le plus lointain (ciel)"), L("plan_2"), { name: "montagnes", children: [L("PLAN 3"), L("Plan 4")] }, L("Plan 5 — premier plan"), L("nuages")] },
  { name: "2 · Signature", children: [L("Aperçu — ne pas modifier"), L("Signature"), { name: "mes essais", children: [L("trait fin"), L("ombre")] }] },
  { name: "Héro", children: [] },
  L("papier"),
  { name: "6 · ICONES", children: [L("Flèche gauche"), L("fleche-droite"), L("Fermer"), L("lecture"), L("doodle")] },
  { name: "accessoires", children: [L("scotch")] },
];
// Cadre (lot médias) : la carte a changé de nom ; un kit v2/v3 déjà exporté
// (ancien nom) comme un kit neuf donnent le même emplacement.
for (const group of ["4 · Cadre des images agrandies", "4 · Cadre des entrées de collection"]) {
  const r = resolveSlots([{ name: group, children: [L("Aperçu — ne pas modifier"), L("Cadre")] }], "v2");
  ok(`cadre : groupe « ${group} » → emplacement cadre`, r.sources.has("cadre"), [...r.sources.keys()].join(","));
}
const res = resolveSlots(tree, "v2");
ok("identifiant d'export lu dans un nom de calque de _guides", res.exportId === "k2-0123456789ab", String(res.exportId));
const found = new Set(res.sources.keys());
const want = SLOTS.map((s) => s.id).filter((id) => !["cadre", "trait"].includes(id));
ok("emplacements trouvés (v2, v1, noms libres, sous-groupe traversé)", want.every((id) => found.has(id)) && !found.has("cadre"), [...found].join(","));
ok("groupe d'un élément à un emplacement : tout son contenu (sous-groupe compris), sans l'aperçu", res.sources.get("signature")?.nodes.map((n) => n.name).join("|") === "Signature|mes essais");
ok("calque inconnu dans un élément à plusieurs emplacements : ignoré et signalé", res.ignored.some((m) => m.startsWith("1 · Paysage d'accueil / nuages")) && res.ignored.some((m) => m.includes("doodle")), res.ignored.join(" ; "));
ok("aperçus, guides et LISEZ-MOI jamais lus comme emplacements", !res.ignored.some((m) => /apercu|aperçu|repères|lisez/i.test(m)), res.ignored.join(" ; "));

/* ---- Aplatissement (petit PSD réel : écrit puis relu) ------------------- */
ensureAgPsd();
const rect = (w, h, [r, g, b, a]) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) data.set([r, g, b, a], i);
  return { width: w, height: h, data };
};
const sig = SLOTS.find((s) => s.id === "signature");
const sx = sig.v1.x;
const sy = sig.v1.y;
const small = writePsdBuffer(
  {
    width: DOC_V1.width,
    height: DOC_V1.height,
    children: [
      {
        name: "2 · Signature",
        children: [
          // Fond rouge recadré « à la Photoshop » (pas à l'origine de la case).
          { name: "fond", left: sx + 10, top: sy + 10, right: sx + 110, bottom: sy + 60, imageData: rect(100, 50, [200, 40, 40, 255]) },
          { name: "gris multiplié", blendMode: "multiply", left: sx + 10, top: sy + 10, right: sx + 60, bottom: sy + 60, imageData: rect(50, 50, [128, 128, 128, 255]) },
          { name: "voile", opacity: 0.5, left: sx + 60, top: sy + 10, right: sx + 110, bottom: sy + 60, imageData: rect(50, 50, [0, 0, 255, 255]) },
          { name: "incrustation", blendMode: "overlay", left: sx + 200, top: sy + 10, right: sx + 210, bottom: sy + 20, imageData: rect(10, 10, [0, 0, 0, 255]) },
          { name: "dépasse", left: sx - 20, top: sy + 100, right: sx + 10, bottom: sy + 110, imageData: rect(30, 10, [0, 0, 0, 255]) },
        ],
      },
    ],
  },
  { noBackground: true },
);
const smallPsd = readPsd(small, { useRawData: true, useImageData: true, skipCompositeImageData: true, skipThumbnail: true });
const warnings = [];
const flat = flattenSlot(resolveSlots(smallPsd.children, "v1").sources.get("signature"), "v1", (m) => warnings.push(m));
const px = (x, y) => Array.from(flat.img.data.subarray((y * flat.img.width + x) * 4, (y * flat.img.width + x) * 4 + 4));
const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 1);
ok("multiplication : rouge × gris", near(px(20, 20), [100, 20, 20, 255]), JSON.stringify(px(20, 20)));
ok("opacité 50 % : bleu à moitié sur rouge", near(px(80, 20), [100, 20, 148, 255]), JSON.stringify(px(80, 20)));
ok("calque recadré replacé à sa position dans la case", near(px(10, 10), [100, 20, 20, 255]) && px(9, 9)[3] === 0, JSON.stringify(px(9, 9)));
ok("mode de fusion non pris en charge : avertissement", warnings.some((m) => m.includes("« overlay »") && m.includes("incrustation")), warnings.join(" ; "));
ok("pixels hors de la case : coupés et signalés", flat.overflow === true);

/* ---- Préalable sans décodage ------------------------------------------- */
const fixture = path.join(root, "tests/fixtures/kit-synthetique.psd");
const pre = await preflightPsd(fixture);
ok("fichier de l'artiste : en-tête accepté (2880 × 2560, RVB 8 bits)", preflightProblem(pre, DEFAULT_LIMITS) === null && pre.width === 2880, JSON.stringify(pre));
const big = Buffer.from(readFileSync(fixture));
big.writeUInt32BE(30000, 14);
big.writeUInt32BE(30000, 18);
writeFileSync(path.join(tmp, "grand.psd"), big);
const bigPre = await preflightPsd(path.join(tmp, "grand.psd")).catch(() => null);
ok("document trop grand : refusé avant décodage", bigPre && /30000 × 30000/.test(preflightProblem(bigPre, DEFAULT_LIMITS) ?? ""), bigPre && preflightProblem(bigPre, DEFAULT_LIMITS));
writeFileSync(path.join(tmp, "faux.psd"), Buffer.from("\x89PNG\r\n\x1a\n" + "0".repeat(64), "latin1"));
const notPsd = await preflightPsd(path.join(tmp, "faux.psd")).then(() => null, (e) => e);
ok("signature invalide : refusée (PsdPreflightError)", notPsd instanceof PsdPreflightError, String(notPsd));

/* ---- Fichier réel de l'artiste ------------------------------------------ */
const manifest = JSON.parse(readFileSync(path.join(root, "tests/fixtures/kit-galerie-lumineuse-v1.manifest.json"), "utf8"));
const out = path.join(tmp, "out");
const t0 = Date.now();
const report = await importKit(fixture, out, { manifests: [manifest], themeId: "galerie-lumineuse" });
const ms = Date.now() - t0;
const byId = Object.fromEntries(report.slots.map((s) => [s.id, s]));
const redrawn = report.slots.filter((s) => s.change === "redrawn").map((s) => s.id);
ok("kit d'origine reconnu par le contenu (kit v1 sans identifiant)", report.reference?.exportId === "legacy-galerie-lumineuse-v1" && report.reference.how === "contenu", JSON.stringify(report.reference));
ok("seule « Flèche droite » est redessinée", redrawn.length === 1 && redrawn[0] === "icones/fleche-droite", redrawn.join(","));
ok("tout le reste : inchangé, pas reconverti", report.slots.filter((s) => s.id !== "icones/fleche-droite").every((s) => s.change === "unchanged" && !s.files), report.slots.map((s) => `${s.id}:${s.change}`).join(" "));
const arrow = byId["icones/fleche-droite"];
ok("flèche vectorisée en masque SVG", arrow.chosen === "svg-mask" && arrow.files?.[0]?.endsWith(".mask.svg"), JSON.stringify({ chosen: arrow.chosen, files: arrow.files }));
const svg = readFileSync(path.join(out, arrow.files[0]), "utf8");
ok("flèche normalisée dans sa boîte 128 × 128 (recadrée 97 × 85 par Photoshop)", /viewBox="0 0 128 128"/.test(svg), svg.slice(0, 120));
ok(`fidélité du contour mesurée : écart ${arrow.fidelity?.deviation} px ≤ 0,6`, arrow.fidelity && arrow.fidelity.deviation <= 0.6);
ok("aperçu « après » écrit", Boolean(arrow.preview) && readFileSync(path.join(out, arrow.preview)).length > 100);
ok("aucun avertissement sur le fichier de l'artiste", report.slots.every((s) => s.status === "ok"), report.slots.filter((s) => s.status !== "ok").map((s) => `${s.id}: ${s.messages}`).join(" ; "));
console.log(`      import du fichier réel : ${ms} ms, pic ${report.peakMb} Mo`);

/* ---- Paire de flèches : miroir (case cochée par défaut dans la revue) ---- */
const { arrowMirror, mirrorSvg } = await kit("mirror.ts");
const sharp = (await import("sharp")).default;
const pair = arrowMirror(report);
ok("une seule flèche redessinée : miroir proposé de la droite vers la gauche", pair?.from.id === "icones/fleche-droite" && pair.to === "icones/fleche-gauche", JSON.stringify(pair && { from: pair.from.id, to: pair.to }));
const mirrored = mirrorSvg(svg);
const render = async (text) => sharp(Buffer.from(text)).resize(128, 128).ensureAlpha().extractChannel(3).raw().toBuffer();
const orig = await render(svg);
const flopped = Buffer.alloc(orig.length);
for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) flopped[y * 128 + x] = orig[y * 128 + 127 - x];
const mine = await render(mirrored);
let diff = 0;
let sum = 0;
for (let i = 0; i < mine.length; i++) {
  diff = Math.max(diff, Math.abs(mine[i] - flopped[i]));
  sum += Math.abs(mine[i] - flopped[i]);
}
const mean = sum / mine.length;
// Lissage des bords pas tout à fait symétrique au rendu : écart moyen < 0,5 niveau, bords < 32.
ok(`flèche gauche = miroir de la flèche droite (retournement, pas de nouveau tracé ; écart moyen ${mean.toFixed(2)}, max ${diff} niveaux)`, mean < 0.5 && diff < 32 && mirrored.includes(svg.slice(svg.indexOf(">") + 1, svg.indexOf(">") + 40)), String(diff));
const both = { ...report, slots: report.slots.map((x) => (x.id === "icones/fleche-gauche" ? { ...arrow, id: x.id } : x)) };
ok("deux flèches redessinées : pas de miroir proposé", arrowMirror(both) === null);

/* ---- Polices embarquées pour la signature pré-remplie ------------------- */
const { KIT_FONTS } = await kit("fonts.ts");
const { FONT_IDS } = await import(new URL("../src/themes/schema.ts", import.meta.url));
const { existsSync } = await import("node:fs");
ok("une police embarquée (OFL, fichier + licence) par police du catalogue", FONT_IDS.every((id) => KIT_FONTS[id] && existsSync(path.join(root, "public/kit/fonts", KIT_FONTS[id].file)) && existsSync(path.join(root, "public/kit/fonts", `OFL-${KIT_FONTS[id].file.replace(/\.ttf$/, "")}.txt`))), FONT_IDS.join(","));

/* ---- Kit d'un autre thème : jamais référence, signalé ------------------ */
const hashes = new Map(report.slots.filter((x) => x.hash).map((x) => [x.id, x.hash]));
const other = findReference(null, hashes, [manifest], "pro");
ok("kit exporté depuis un autre thème : pas de référence (rien d'« inchangé »), thème d'origine signalé", other.reference === null && other.foreign?.manifest.themeId === "galerie-lumineuse", JSON.stringify({ ref: other.reference, foreign: other.foreign?.manifest.exportId }));

/* ---- Limites recomptées sur l'arbre analysé (arbre simulé en mémoire) --- */
const rectL = (n, w = 10, h = 10) => Array.from({ length: n }, (_, i) => ({ name: `c${i}`, left: 0, top: 0, right: w, bottom: h }));
let deep = { name: "feuille", left: 0, top: 0, right: 1, bottom: 1 };
for (let i = 0; i < 14; i++) deep = { name: `g${i}`, children: [deep] };
const lim = { maxLayers: DEFAULT_LIMITS.maxLayers, maxLayerArea: DEFAULT_LIMITS.maxLayerArea };
const doc = { width: 4000, height: 4000 };
ok("arbre : trop de calques (y compris ceux que l'en-tête ne voit pas) → refus", /130 calques/.test(treeProblem(treeStats(rectL(130)), lim, doc) ?? ""));
ok("arbre : surface cumulée trop grande → refus", /mégapixels/.test(treeProblem(treeStats(rectL(6, 4000, 4000)), lim, doc) ?? ""));
ok("arbre : imbrication trop profonde → refus", /niveaux/.test(treeProblem(treeStats([deep]), lim, doc) ?? ""));
ok("arbre : un calque plus grand que tout le document → refus", /plus grand que tout le document/.test(treeProblem(treeStats([{ name: "x", left: -5000, top: 0, right: 5000, bottom: 10 }]), lim, doc) ?? ""));
ok(`arbre du fichier réel de l'artiste : accepté (${report.tree?.layers} calques et groupes, profondeur ${report.tree?.depth})`, report.tree && treeProblem(report.tree, lim, { width: 2880, height: 2560 }) === null);

/* ---- En-têtes légitimes hors limites (générés avec ag-psd) -------------- */
const tiny = (n = 1) => Array.from({ length: n }, (_, i) => ({ name: `calque ${i}`, left: i, top: 0, right: i + 2, bottom: 2, imageData: rect(2, 2, [10, 20, 30, 255]) }));
const save = async (name, buf, patch) => {
  const b = Buffer.from(buf);
  patch?.(b);
  const f = path.join(tmp, name);
  writeFileSync(f, b);
  return preflightProblem(await preflightPsd(f), DEFAULT_LIMITS) ?? "";
};
const v1doc = { width: DOC_V1.width, height: DOC_V1.height };
ok("PSB refusé", /PSB/.test(await save("grand.psb", writePsdBuffer({ ...v1doc, children: tiny() }, { noBackground: true, psb: true }))));
ok("CMJN refusé", /CMJN/.test(await save("cmjn.psd", writePsdBuffer({ ...v1doc, children: tiny() }, { noBackground: true }), (b) => b.writeUInt16BE(4, 24))));
ok("16 bits refusé", /16 bits/.test(await save("16b.psd", writePsdBuffer({ ...v1doc, children: tiny() }, { noBackground: true }), (b) => b.writeUInt16BE(16, 22))));
ok("trop de calques refusé (en-tête)", /calques : 120 au plus/.test(await save("calques.psd", writePsdBuffer({ ...v1doc, children: tiny(130) }, { noBackground: true }))));
const full = rect(DOC_V1.width, DOC_V1.height, [200, 200, 200, 255]);
const big11 = Array.from({ length: 11 }, (_, i) => ({ name: `pleine ${i}`, left: 0, top: 0, right: DOC_V1.width, bottom: DOC_V1.height, imageData: full }));
ok("surface trop grande refusée (11 calques pleine toile)", /mégapixels/.test(await save("surface.psd", writePsdBuffer({ ...v1doc, children: big11 }, { noBackground: true }))));

/* ---- Imbrication > 8 niveaux et calque plus grand que sa case ------------ */
let nest = { name: "trait fin", left: sx + 10, top: sy + 10, right: sx + 12, bottom: sy + 12, imageData: rect(2, 2, [0, 0, 0, 255]) };
for (let i = 0; i < MAX_NESTING + 2; i++) nest = { name: `sous-groupe ${i}`, children: [nest] };
const nestedPsd = readPsd(writePsdBuffer({ ...v1doc, children: [{ name: "2 · Signature", children: [nest] }] }, { noBackground: true }), { useRawData: true, useImageData: true, skipCompositeImageData: true, skipThumbnail: true });
let nestErr = null;
try {
  flattenSlot(resolveSlots(nestedPsd.children, "v1").sources.get("signature"), "v1", () => {});
} catch (e) {
  nestErr = e;
}
ok(`imbrication au-delà de ${MAX_NESTING} niveaux : refusée, message clair`, nestErr instanceof SlotRefusal && /8 niveaux au plus/.test(nestErr.message), String(nestErr));
const huge = rect(1800, 900, [0, 0, 0, 255]);
const hugePsd = readPsd(writePsdBuffer({ ...v1doc, children: [{ name: "2 · Signature", children: [{ name: "Signature", left: sx, top: sy, right: sx + 1800, bottom: sy + 900, imageData: huge }] }] }, { noBackground: true }), { useRawData: true, useImageData: true, skipCompositeImageData: true, skipThumbnail: true });
let hugeErr = null;
try {
  flattenSlot(resolveSlots(hugePsd.children, "v1").sources.get("signature"), "v1", () => {});
} catch (e) {
  hugeErr = e;
}
ok("calque plus grand que sa case : refusé AVANT décodage (« dépasse sa case : recadre-le »)", hugeErr instanceof SlotRefusal && /dépasse sa case \(1800 × 900 px/.test(hugeErr.message) && /recadre-le/.test(hugeErr.message), String(hugeErr));

/* ---- Câblage : importKit contrôle bien l'arbre lu (arbre simulé injecté) -- */
const wired = await importKit(fixture, path.join(tmp, "out-arbre"), { manifests: [manifest], themeId: "galerie-lumineuse", simulatedTree: rectL(130) });
ok("importKit applique le contrôle de l'arbre lu (130 calques injectés → refus avant décodage)", wired.ok === false && /130 calques/.test(wired.problem ?? "") && wired.slots.length === 0, wired.problem ?? "accepté");

/* ---- Lecture ag-psd bornée (motifs, composite) --------------------------- */
ok("readPsd : totalMemoryLimit de 64 Mo, pixels des calques non décodés", PSD_READ_OPTIONS.totalMemoryLimit === 64 << 20 && PSD_READ_OPTIONS.useRawData === true && PSD_READ_OPTIONS.skipCompositeImageData === true);

/* ---- Canal ZIP refusé avant décodage (PSD légitime écrit par ag-psd) ---- */
const zipPsd = readPsd(writePsdBuffer({ ...v1doc, children: [{ name: "2 · Signature", children: [{ name: "Signature", left: sx + 10, top: sy + 10, right: sx + 110, bottom: sy + 60, imageData: rect(100, 50, [0, 0, 0, 255]) }] }] }, { noBackground: true, compress: true }), { ...PSD_READ_OPTIONS });
const zipSource = resolveSlots(zipPsd.children, "v1").sources.get("signature");
const zipSeen = hasZipChannels(zipSource.nodes[0]);
let zipErr = null;
try {
  flattenSlot(zipSource, "v1", () => {});
} catch (e) {
  zipErr = e;
}
ok("canal compressé en ZIP : détecté et refusé avant décodage (« Compression ZIP non prise en charge »)", zipSeen && zipErr instanceof SlotRefusal && /Compression ZIP non prise en charge/.test(zipErr.message), String(zipErr));
ok("fichier réel de l'artiste : aucun canal ZIP (RLE Photoshop)", !readPsd(readFileSync(fixture), { ...PSD_READ_OPTIONS }).children.some(function z(l) { return hasZipChannels(l) || (l.children ?? []).some(z); }));

/* ---- Kit v3 : palette et curseurs, aller-retour réel (export → modif ag-psd → import) ---- */
{
  const { buildKit } = await kit("build.ts");
  const { readHotspot, dominantColor, shapeFill, sameColor } = await kit("extras.ts");
  const { withKitColors, kitColorFailures } = await kit("apply.ts");
  const { CURSOR_SLOTS, SWATCH_SLOTS, frameOf: frameOfV, CURSOR_DEFAULT_HOTSPOT, SLOTS: SLOTS_ALL } = await kit("spec.ts");
  const { PRESETS } = await import(new URL("../src/themes/presets/index.ts", import.meta.url));
  const P = await import(new URL("../src/themes/palette.ts", import.meta.url));
  // Thème de test : survol de l'action en « auto », le reste comme le preset.
  const base = PRESETS["galerie-lumineuse"];
  const auto = P.setNuance(base.tokens.color, undefined, "primaryHover", null);
  const theme = { ...base, id: "test-v3", preset: false, tokens: { ...base.tokens, color: auto.color, palette: auto.palette } };
  const mdir = path.join(tmp, "manifests-v3");
  const { psd, manifest: m3 } = await buildKit(theme, path.join(root, "public"), { exportId: "k2-00000000beef", themeVersion: "t", siteName: "Camille Roussel", manifestDir: mdir });
  const back = readPsd(psd, { useImageData: true, skipCompositeImageData: true, skipThumbnail: true });
  ok("kit v3 : 4000 × 4880, groupes « 8 · Palette » et « 9 · Curseur »", back.width === 4000 && back.height === 4880 && ["8 · Palette", "9 · Curseur"].every((n) => back.children.some((l) => l.name === n)), `${back.width} × ${back.height}`);
  const group = (n) => back.children.find((l) => l.name === n);
  const swatchNames = group("8 · Palette").children.filter((l) => !/^Aperçu/.test(l.name)).map((l) => l.name);
  ok(`une pastille nommée par couleur et par nuance (${swatchNames.length})`, swatchNames.length === SWATCH_SLOTS.length && swatchNames.includes("Action · survol") && swatchNames.includes("Fond · profond") && swatchNames.includes("Visionneuse · voile"), swatchNames.join(", "));
  ok("pastilles pré-remplies avec les couleurs actuelles (manifeste)", m3.colors.primary === "#2e4e9e" && m3.colors.primaryHover === auto.color.primaryHover && m3.colors.line === "#e5e2db");
  const normal = group("9 · Curseur").children.find((l) => l.name === "Normal");
  ok("curseur : groupe « Normal » = dessin + repère « point chaud »", normal?.children?.map((l) => l.name).join("|") === "Dessin|point chaud");

  // Modifications « dans Photoshop » : survol repeint, accent (base) repeint, curseur normal redessiné et point chaud déplacé.
  const paint = (layer, [r, g, b]) => {
    const d = layer.imageData.data;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) d.set([r, g, b, 255], i);
  };
  const pal = group("8 · Palette").children;
  paint(pal.find((l) => l.name === "Action · survol"), [0x8b, 0x1e, 0x3f]);
  paint(pal.find((l) => l.name === "Accent secondaire"), [0x8a, 0x4a, 0x20]);
  const drawing = normal.children.find((l) => l.name === "Dessin");
  const zone = frameOfV(CURSOR_SLOTS[0], "v2");
  const cw = 64;
  const cur = new Uint8ClampedArray(cw * cw * 4);
  for (let y = 6; y < 40; y++) for (let x = 6; x < 30; x++) cur.set(x < 9 || y < 9 || x > 26 || y > 36 ? [255, 255, 255, 255] : [200, 30, 60, 255], (y * cw + x) * 4);
  Object.assign(drawing, { left: zone.x, top: zone.y, right: zone.x + cw, bottom: zone.y + cw, imageData: { width: cw, height: cw, data: cur } });
  const marker = normal.children.find((l) => l.name === "point chaud");
  for (const k of ["left", "right"]) marker[k] += 6;
  for (const k of ["top", "bottom"]) marker[k] += 8;
  // Logo collé avec son fond opaque (1200 × 300) : refusé, sinon un rectangle plein dans le bandeau.
  const sigLayer = group("2 · Signature").children.find((l) => l.name === "Signature");
  const sz = frameOfV(SLOTS_ALL.find((x) => x.id === "signature"), "v2");
  Object.assign(sigLayer, { left: sz.x, top: sz.y, right: sz.x + 1200, bottom: sz.y + 300, imageData: { width: 1200, height: 300, data: new Uint8ClampedArray(1200 * 300 * 4).fill(255) } });
  const edited = path.join(tmp, "kit-v3-modifie.psd");
  writeFileSync(edited, writePsdBuffer({ width: back.width, height: back.height, children: back.children }, { noBackground: true }));

  const current = P.resolvePalette(theme.tokens.color, theme.tokens.palette);
  const r3 = await importKit(edited, path.join(tmp, "out-v3"), { manifests: [m3], themeId: "test-v3", palette: current });
  const col = (k) => r3.colors?.find((c) => c.key === k);
  ok(`import : kit d'origine reconnu (${r3.reference?.how})`, r3.reference?.exportId === "k2-00000000beef", JSON.stringify(r3.reference));
  ok("import : survol repeint → changé, lu #8b1e3f", col("primaryHover")?.change === "changed" && col("primaryHover")?.after === "#8b1e3f" && col("primaryHover")?.before === current.primaryHover, JSON.stringify(col("primaryHover")));
  ok("import : base « Accent secondaire » repeinte → changée", col("secondary")?.change === "changed" && col("secondary")?.after === "#8a4a20");
  const unchanged = r3.colors.filter((c) => c.change === "unchanged").length;
  ok(`import : les ${SWATCH_SLOTS.length - 2} autres pastilles inchangées`, unchanged === SWATCH_SLOTS.length - 2, r3.colors.filter((c) => c.change !== "unchanged").map((c) => c.key).join(","));
  const cn = r3.slots.find((x) => x.id === "curseur/normal");
  const cc = r3.slots.find((x) => x.id === "curseur/clic");
  const sg = r3.slots.find((x) => x.id === "signature");
  ok("import : logo opaque (fond plein) → erreur claire, pas un rectangle plein dans le bandeau", sg?.status === "error" && /rectangle plein/.test(sg.messages.join(" ")), JSON.stringify({ status: sg?.status, msg: sg?.messages }));
  ok("import : curseur normal redessiné, point chaud déplacé (4,4)+(6,8) px de la case → (5, 6) px CSS", cn?.change === "redrawn" && cn.hotspot?.x === 5 && cn.hotspot?.y === 6, JSON.stringify({ change: cn?.change, hotspot: cn?.hotspot, msg: cn?.messages }));
  ok("import : curseur « clic » laissé tel quel → inchangé (curseur du système gardé)", cc?.change === "unchanged", cc?.change);
  const png = cn?.files?.find((f) => !f.endsWith(".2x.png"));
  const png2 = cn?.files?.find((f) => f.endsWith(".2x.png"));
  const m1 = png ? await sharp(path.join(tmp, "out-v3", png)).metadata() : {};
  const m2 = png2 ? await sharp(path.join(tmp, "out-v3", png2)).metadata() : {};
  ok(`import : PNG 32 × 32 (${readFileSync(path.join(tmp, "out-v3", png)).length} o) et 64 × 64 (${readFileSync(path.join(tmp, "out-v3", png2)).length} o)`, m1.width === 32 && m1.height === 32 && m2.width === 64 && m2.height === 64 && m1.format === "png");
  ok("import : curseur au contour blanc visible sur les fonds (pas d'avertissement)", !cn.messages.some((x) => /invisible/.test(x)), cn.messages.join(" | "));

  // Application : survol forcé, accent secondaire changé ; étiquettes (auto) suivent ; contraste vérifié.
  const tokens = withKitColors(theme.tokens, r3);
  ok("application : survol devient « choisi » (#8b1e3f), sorti de palette.auto", tokens.color.primaryHover === "#8b1e3f" && !tokens.palette?.auto?.includes("primaryHover"), JSON.stringify(tokens.palette));
  ok("application : étiquettes (auto) suivent le nouvel accent secondaire", P.resolvePalette(tokens.color, tokens.palette).eyebrow === "#8a4a20");
  ok("application : contraste AA tenu", kitColorFailures(theme, r3).length === 0, kitColorFailures(theme, r3).join(" ; "));
  // Base changée, nuance auto inchangée : elle reste auto et suit la base.
  const r3b = { ...r3, colors: [{ key: "primary", label: "Action", change: "changed", before: "#2e4e9e", after: "#1d3b80", messages: [] }] };
  const t2 = withKitColors(theme.tokens, r3b);
  ok("pastille inchangée d'une nuance auto : reste auto, suit sa base repeinte", t2.palette?.auto?.includes("primaryHover") && t2.color.primaryHover === P.deriveNuance("primaryHover", P.resolvePalette(t2.color, t2.palette)) && t2.color.primaryHover !== auto.color.primaryHover);
  const bad = { ...r3, colors: [{ key: "inkSoft", label: "Texte · secondaire", change: "changed", before: "#686d73", after: "#dddddd", messages: [] }] };
  ok("application : couleur repeinte illisible → refus motivé", kitColorFailures(theme, bad).some((x) => /Texte secondaire/.test(x)));

  // Lecture des pastilles : pixel dominant, calque de forme Photoshop, comparaison.
  const half = { width: 4, height: 1, data: Buffer.from([10, 20, 30, 255, 10, 20, 30, 255, 10, 20, 30, 255, 200, 0, 0, 255]) };
  ok("pastille : couleur la plus présente (75 %)", (() => { const d = dominantColor(half); return d.r === 10 && d.g === 20 && d.b === 30 && d.share === 0.75; })());
  ok("pastille : calque de forme → couleur de remplissage (RVB et FRGB)", shapeFill([{ name: "x", vectorFill: { type: "color", color: { r: 12, g: 34, b: 56 } } }])?.g === 34 && shapeFill([{ name: "x", vectorFill: { type: "color", color: { fr: 1, fg: 0, fb: 0.5 } } }])?.b === 128);
  ok("comparaison de couleurs : hex et rgba", sameColor("#E5E2DB", "#e5e2db") && sameColor("rgba(237, 232, 220, 0.14)", "rgba(237,232,220,0.14)") && !sameColor("#000000", "#000001"));
  ok("point chaud : repère supprimé → défaut + message", readHotspot(undefined, zone, CURSOR_DEFAULT_HOTSPOT.default).message?.includes("introuvable"));
  ok("ancien kit (v1, fichier réel) : ni palette ni curseurs rapportés", !report.colors && report.extras?.palette === false && !report.slots.some((x) => x.id.startsWith("curseur/")), JSON.stringify(report.extras));
}

/* ---- Palette : gestes naturels de Photoshop (lot 17a), aller-retour PSD réel ---- */
{
  const { readSwatchSlot, compareSwatches } = await kit("extras.ts");
  const { frameOf: frameOfS, SWATCH_SLOTS: SW } = await kit("spec.ts");
  const { swatchRaster } = await kit("build.ts");
  const slot = SW.find((x) => x.paletteKey === "bg");
  const f = frameOfS(slot, "v2");
  const before = "#f4f1ea";
  const layer = (name, color, mutate) => {
    const r = swatchRaster(color, 150);
    const data = new Uint8ClampedArray(r.data);
    mutate?.(data);
    return { name, left: f.x, top: f.y, right: f.x + 150, bottom: f.y + 150, imageData: { width: 150, height: 150, data } };
  };
  const paintLeft = (share) => (d) => {
    for (let y = 0; y < 150; y++) for (let x = 0; x < 150 * share; x++) if (d[(y * 150 + x) * 4 + 3]) d.set([192, 57, 43, 255], (y * 150 + x) * 4);
  };
  /** Lit la pastille « Fond » d'un groupe « 8 · Palette » comme l'import (fichier réécrit puis relu). */
  const readBg = (children) => {
    const buf = writePsdBuffer({ width: 4000, height: 4880, children: [{ name: "8 · Palette", children }] }, { noBackground: true });
    const tree = readPsd(buf, { ...PSD_READ_OPTIONS });
    const { sources, ignored } = resolveSlots(tree.children, "v2");
    const src = sources.get(slot.id);
    if (!src) return { ignored };
    const [c] = compareSwatches([readSwatchSlot(slot, src, "v2", before)], null, { bg: before });
    return { ...c, ignored };
  };
  const painted = (label, r) => ok(`palette : ${label} → changé, #c0392b`, r.change === "changed" && r.after === "#c0392b", JSON.stringify(r));
  painted("pot de peinture sur toute la pastille", readBg([layer("Fond", "#c0392b")]));
  const part = readBg([layer("Fond", before, paintLeft(0.3))]);
  painted("coup de pinceau sur 30 % de la pastille (la couleur d'avant reste majoritaire)", part);
  ok("palette : repeint partiel annoncé dans la revue", part.messages?.some((m) => /repeinte en partie \(30 %/.test(m)), JSON.stringify(part.messages));
  const added = readBg([layer("Fond", before), layer("Calque 1", "#c0392b")]);
  painted("nouveau calque posé sur la pastille (« Calque 1 »)", added);
  ok("palette : le calque ajouté n'est pas « ignoré »", added.ignored.length === 0, added.ignored.join(" ; "));
  const under = readBg([layer("Calque 1", "#c0392b"), layer("Fond", before)]);
  ok("palette : calque ajouté SOUS la pastille → la pastille couvre, inchangé", under.change === "unchanged", JSON.stringify(under));
  painted("pastille supprimée, remplacée par un nouveau calque", readBg([layer("Calque 1", "#c0392b")]));
  painted("incrustation couleur (style de calque)", readBg([{ ...layer("Fond", before), effects: { solidFill: [{ enabled: true, present: true, color: { r: 192, g: 57, b: 43 }, opacity: 1, blendMode: "normal" }] } }]));
  const off = readBg([{ ...layer("Fond", before), effects: { solidFill: [{ enabled: false, present: true, color: { r: 192, g: 57, b: 43 }, opacity: 1, blendMode: "normal" }] } }]);
  ok("palette : incrustation couleur désactivée → inchangé", off.change === "unchanged", JSON.stringify(off));
  const shape = readBg([{ name: "Fond", left: f.x, top: f.y, right: f.x + 150, bottom: f.y + 150, vectorFill: { type: "color", color: { r: 192, g: 57, b: 43 } } }]);
  ok("palette : calque de forme (couleur de remplissage)", shape.change === "changed" && shape.after === "#c0392b" && shape.how === "forme", JSON.stringify(shape));
  const stray = readBg([layer("Fond", before, paintLeft(0.01))]);
  ok("palette : un grain isolé (1 %) n'est pas un repeint", stray.change === "unchanged", JSON.stringify(stray));
  const far = readBg([layer("Fond", before), { name: "Calque 2", left: f.x + 160, top: f.y, right: f.x + 230, bottom: f.y + 70, imageData: { width: 70, height: 70, data: new Uint8ClampedArray(70 * 70 * 4).fill(255) } }]);
  ok("palette : calque hors de toute pastille → ignoré avec la raison", far.change === "unchanged" && far.ignored.some((m) => /Calque 2.*hors de toute pastille/.test(m)), JSON.stringify(far.ignored));
  const adj = resolveSlots([{ name: "8 · Palette", children: [{ name: "Teinte/Saturation 1", left: f.x, top: f.y, right: f.x + 150, bottom: f.y + 150, adjustment: { type: "hue/saturation" } }] }], "v2");
  ok("palette : calque de réglage → ignoré, dit clairement", adj.ignored.some((m) => /calque de réglage/.test(m)), JSON.stringify(adj.ignored));
}

rmSync(tmp, { recursive: true, force: true });
if (failures) {
  console.error(`test-kit-import : ${failures} échec(s)`);
  process.exit(1);
}
console.log("test-kit-import : OK");
