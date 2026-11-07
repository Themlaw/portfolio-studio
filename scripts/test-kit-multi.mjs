#!/usr/bin/env node
/**
 * Kit v4 (lot 17e) : trois PSD aérés dans une archive .zip, dessins en grand
 * réduits par le site, décor à calques libres.
 *  - export (3 PSD + archive) → réimport sans rien toucher = 0 élément modifié ;
 *    fichiers reconnus par leur rôle (taille du document, identifiant), jamais
 *    par leur nom ; fichiers manquants : « pas envoyé » ;
 *  - icône redessinée à 512 × 512 → réduite à 128 × 128 sans crénelage ;
 *    curseur : point chaud ramené à la taille du curseur ;
 *  - décor : 5 calques libres → 5 plans ; calque vide, masqué : ignorés ;
 *    plan retiré ou déplacé : reconnu inchangé (composition changée) ; plus de 8 : refusé ;
 *  - archive : lecture défensive (taille annoncée, chiffrement, PSD absent) ;
 *  - anciens kits mono-fichier (fichier de test synthétique) toujours lisibles.
 * Usage : npm test (via tsx)
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const kit = (f) => import(new URL(`../src/lib/kit/${f}`, import.meta.url));
const { buildKitMulti } = await kit("build-multi.ts");
const { importKit } = await kit("import.ts");
const { loadManifests, exportIdOf } = await kit("manifest.ts");
const { KIT_FILES, KIT_ROLES, KIT_V4_VERSION, DECOR_HEAD, DECOR_CANVAS, frameOf, ALL_SLOTS, MAX_DECOR_PLANS, roleOfSize, slotsOfFile, slotsOfRole, LEGACY_LOGO_DOC } = await kit("spec.ts");
const { decorApplicable, isApplicable } = await kit("mirror.ts");
const { writeZipFile, listZip, extractEntry, KitZipError } = await kit("zip-archive.ts");
const { ensureAgPsd } = await kit("ag-psd-node.ts");
const { PRESETS } = await import(new URL("../src/themes/presets/index.ts", import.meta.url));
const { readPsd, writePsdBuffer } = await import("ag-psd");
const sharp = (await import("sharp")).default;

let failures = 0;
const ok = (label, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${!cond && detail ? " — " + detail : ""}`);
};
ensureAgPsd();
const tmp = mkdtempSync(path.join(os.tmpdir(), "kit-multi-"));
const READ = { useImageData: true, skipCompositeImageData: true, skipThumbnail: true };

/* ---- Export -------------------------------------------------------------- */
const theme = PRESETS["galerie-lumineuse"];
const exportId = exportIdOf(theme.id, "test", KIT_V4_VERSION);
const dir = path.join(tmp, "export");
const manifestDir = path.join(dir, "manifests");
const t0 = Date.now();
const built = await buildKitMulti(theme, path.join(root, "public"), { exportId, themeVersion: "test", siteName: "Camille Roussel", manifestDir, outDir: dir });
console.log(`      export : ${Date.now() - t0} ms, ${built.files.map((f) => `${f.file} ${Math.round(f.bytes / 1048576)} Mo`).join(", ")}, ${built.stats.layers} calques`);
const file = (role) => built.files.find((f) => f.role === role).path;
ok("trois fichiers : décor, logo et papier, icônes et curseurs", KIT_ROLES.every((r) => built.files.some((f) => f.role === r && f.file === KIT_FILES[r].file)));
const docs = Object.fromEntries(KIT_ROLES.map((r) => [r, readPsd(readFileSync(file(r)), { ...READ, skipLayerImageData: true })]));
ok("documents aux tailles du kit (distinctes), RVB 8 bits", KIT_ROLES.every((r) => docs[r].width === KIT_FILES[r].doc.width && docs[r].height === KIT_FILES[r].doc.height && docs[r].bitsPerChannel === 8));
ok("cases ≥ 512 × 512 pour les icônes et les curseurs", ALL_SLOTS.filter((s) => s.kind === "icon" || s.kind === "cursor").every((s) => s.draw.w >= 512 && s.draw.h >= 512));
const top = (r) => docs[r].children.at(-1);
ok("consigne en tête de chaque document (calque LISEZ-MOI tout en haut, verrouillé)", KIT_ROLES.every((r) => top(r).name === "LISEZ-MOI" && top(r).protected?.position));
ok("plus de groupe « Palette » dans aucun fichier", KIT_ROLES.every((r) => !JSON.stringify(docs[r].children.map((c) => c.name)).match(/palette/i)));
const decorLayers = docs.decor.children.filter((l) => !/^(LISEZ-MOI|_guides)$/.test(l.name)).map((l) => l.name);
ok("le décor actuel est découpé en ses 5 plans, calques libres de premier niveau", decorLayers.length === 5 && decorLayers[0].startsWith("Plan 1") && decorLayers[4].startsWith("Plan 5"), decorLayers.join("|"));
ok("l'identifiant du kit et le rôle sont dans `_guides` de chaque fichier", KIT_ROLES.every((r) => docs[r].children.find((c) => c.name === "_guides").children.some((c) => c.name.includes(exportId) && c.name.includes(`role-${r}`))));

/* ---- Archive .zip ---------------------------------------------------------- */
const zip = path.join(tmp, "kit.zip");
await writeZipFile(zip, [...KIT_ROLES.map((r) => ({ name: KIT_FILES[r].file, file: file(r) })), { name: "LISEZ-MOI.txt", data: Buffer.from("bonjour é", "utf8") }]);
const entries = await listZip(zip);
ok("archive : 3 PSD et le LISEZ-MOI.txt", entries.length === 4 && entries.some((e) => e.name === "LISEZ-MOI.txt") && KIT_ROLES.every((r) => entries.some((e) => e.name === KIT_FILES[r].file)), entries.map((e) => e.name).join(","));
const extracted = {};
for (const [i, e] of entries.entries()) {
  const dest = path.join(tmp, `ex-${i}.bin`);
  await extractEntry(zip, e, dest, 400 * 1048576);
  extracted[e.name] = dest;
}
ok("archive : relue octet pour octet", KIT_ROLES.every((r) => Buffer.compare(readFileSync(extracted[KIT_FILES[r].file]), readFileSync(file(r))) === 0));
ok("archive : LISEZ-MOI.txt en UTF-8", readFileSync(extracted["LISEZ-MOI.txt"], "utf8") === "bonjour é");
// Défenses : taille annoncée mensongère, chiffrement, pas un zip.
const forged = Buffer.from(readFileSync(zip));
const eocd = forged.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
const dirOff = forged.readUInt32LE(eocd + 16);
forged.writeUInt32LE(10, dirOff + 24); // taille décompressée annoncée : 10 octets pour le premier PSD
writeFileSync(path.join(tmp, "menteur.zip"), forged);
const liar = await listZip(path.join(tmp, "menteur.zip"));
let liarErr = null;
await extractEntry(path.join(tmp, "menteur.zip"), liar[0], path.join(tmp, "menteur.bin"), 400 * 1048576).catch((e) => (liarErr = e));
ok("archive : taille annoncée mensongère (bombe) → refusée pendant l'écriture", liarErr instanceof KitZipError && /taille annoncée/.test(liarErr.message), String(liarErr));
let bigErr = null;
await extractEntry(zip, entries[0], path.join(tmp, "trop.bin"), 1024).catch((e) => (bigErr = e));
ok("archive : entrée plus grande que la limite → refusée avant extraction", bigErr instanceof KitZipError && /au plus/.test(bigErr.message), String(bigErr));
const enc = Buffer.from(readFileSync(zip));
enc.writeUInt16LE(1, dirOff + 8);
writeFileSync(path.join(tmp, "chiffre.zip"), enc);
let encErr = null;
await extractEntry(path.join(tmp, "chiffre.zip"), (await listZip(path.join(tmp, "chiffre.zip")))[0], path.join(tmp, "c.bin"), 400 * 1048576).catch((e) => (encErr = e));
ok("archive : entrée chiffrée → refusée", encErr instanceof KitZipError && /chiffré/.test(encErr.message), String(encErr));
writeFileSync(path.join(tmp, "faux.zip"), Buffer.from("PK pas vraiment une archive".repeat(10)));
ok("archive : fichier qui n'est pas un zip → refusé", await listZip(path.join(tmp, "faux.zip")).then(() => false, (e) => e instanceof KitZipError));

/* ---- Réimport sans rien toucher : 0 élément modifié ------------------------- */
const manifests = await loadManifests(manifestDir);
// Fichiers renommés et mélangés : reconnus par leur contenu, pas par leur nom.
const shuffled = [
  { path: extracted[KIT_FILES.icones.file], name: "a.psd" },
  { path: extracted[KIT_FILES.decor.file], name: "mon-decor-final-v7.psd" },
  { path: extracted[KIT_FILES.logo.file], name: "c.psd" },
];
const r0 = await importKit(shuffled, path.join(tmp, "out0"), { manifests, themeId: theme.id });
const changed0 = r0.slots.filter((s) => s.change !== "unchanged");
ok("réimport des 3 fichiers sans rien toucher : 0 élément modifié", r0.ok && r0.slots.length === 25 && changed0.length === 0 && r0.slots.every((s) => s.status === "ok"), changed0.map((s) => `${s.id}:${s.change}`).join(" ") || r0.problem);
ok("kit d'origine reconnu par l'identifiant (mêmes fichiers renommés)", r0.reference?.how === "identifiant" && r0.reference.exportId === exportId, JSON.stringify(r0.reference));
ok("revue : un bloc par fichier, dans l'ordre du kit, tous reçus", r0.files.map((f) => `${f.id}${f.received ? "" : "!"}`).join(",") === "decor,logo,icones" && r0.files.map((f) => f.slots).join(",") === "5,4,8", JSON.stringify(r0.files));
ok("décor : même composition que l'export", r0.decor?.structure === "unchanged" && r0.decor.count === 5 && !decorApplicable(r0));
ok("aucun élément à appliquer", r0.slots.filter(isApplicable).length === 0);
console.log(`      réimport : pic ${r0.peakMb} Mo`);

/* ---- Fichiers manquants ----------------------------------------------------- */
const rLogo = await importKit({ path: extracted[KIT_FILES.logo.file], name: "logo.psd" }, path.join(tmp, "out-logo"), { manifests, themeId: theme.id });
ok("un seul fichier envoyé : les autres « pas envoyés » (inchangés), kit reconnu par son identifiant", rLogo.files.map((f) => `${f.id}:${f.received}`).join(",") === "decor:false,logo:true,icones:false" && rLogo.slots.length === 4 && rLogo.reference?.how === "identifiant" && rLogo.slots.every((s) => s.change === "unchanged"), JSON.stringify(rLogo.files));
const rTwo = await importKit([extracted[KIT_FILES.decor.file], extracted[KIT_FILES.icones.file]], path.join(tmp, "out-two"), { manifests, themeId: theme.id });
ok("deux fichiers sur trois : le logo est « pas envoyé »", rTwo.files.find((f) => f.id === "logo")?.received === false && rTwo.slots.length === 13);
const dup = await importKit([extracted[KIT_FILES.logo.file], extracted[KIT_FILES.logo.file]], path.join(tmp, "out-dup"), { manifests });
ok("deux fois le même fichier : refusé, message clair", dup.ok === false && /Deux fichiers sont « 2 · Logo et papier »/.test(dup.problem ?? ""), dup.problem);

/* ---- Redessin d'une icône à 512 × 512 ----------------------------------------- */
const disc = (w, h, fn) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (fn(x, y)) data.set([20, 40, 90, 255], (y * w + x) * 4);
  return { width: w, height: h, data };
};
const mutate = async (role, edit, name) => {
  const psd = readPsd(readFileSync(file(role)), READ);
  edit(psd);
  const out = path.join(tmp, name);
  writeFileSync(out, writePsdBuffer({ width: psd.width, height: psd.height, children: psd.children }, { noBackground: true }));
  return out;
};
const find = (list, name) => {
  for (const l of list) {
    if (l.name === name) return l;
    const f = l.children && find(l.children, name);
    if (f) return f;
  }
};
const closeSlot = ALL_SLOTS.find((s) => s.id === "icones/fermer");
const fr = frameOf(closeSlot, "multi");
// Disque plein de 360 px de diamètre, bords durs (aucun lissage) dans la case 512 × 512.
const D = 360;
const hard = disc(D, D, (x, y) => (x - D / 2 + 0.5) ** 2 + (y - D / 2 + 0.5) ** 2 <= (D / 2) ** 2);
const iconPsd = await mutate(
  "icones",
  (psd) => {
    const l = find(psd.children, "Fermer");
    Object.assign(l, { left: fr.x + 76, top: fr.y + 76, right: fr.x + 76 + D, bottom: fr.y + 76 + D, imageData: hard });
  },
  "icone-modifiee.psd",
);
const rIcon = await importKit({ path: iconPsd, name: "i.psd" }, path.join(tmp, "out-icone"), { manifests, themeId: theme.id, keepCrops: true });
const redrawn = rIcon.slots.filter((s) => s.change === "redrawn");
ok("icône redessinée à 512 × 512 : seule « Fermer » est redessinée", redrawn.length === 1 && redrawn[0].id === "icones/fermer", redrawn.map((s) => s.id).join(","));
const ic = redrawn[0];
const svg = ic?.files?.[0] ? readFileSync(path.join(tmp, "out-icone", ic.files[0]), "utf8") : "";
ok("icône réduite à 128 × 128 : masque SVG dans la boîte 128 × 128, contour fidèle", ic?.chosen === "svg-mask" && /viewBox="0 0 128 128"/.test(svg) && ic.fidelity.deviation <= 0.6, JSON.stringify({ chosen: ic?.chosen, vb: svg.slice(0, 90), fid: ic?.fidelity }));
const small = await sharp(path.join(tmp, "out-icone", ic.preview)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
ok("aperçu réduit : 128 × 128", small.info.width === 128 && small.info.height === 128, `${small.info.width} × ${small.info.height}`);
let edge = 0;
let full = 0;
for (let i = 3; i < small.data.length; i += 4) {
  if (small.data[i] > 16 && small.data[i] < 240) edge++;
  else if (small.data[i] >= 240) full++;
}
// Disque de 360 px → 90 px de diamètre : ≈ 6 360 px pleins, ≈ 280 px de bord ; un bord crénelé (plus proche voisin) n'aurait AUCUN niveau intermédiaire.
ok(`réduction de qualité, sans crénelage (${edge} pixels de bord lissés, ${full} pleins)`, edge > 150 && full > 5500 && full < 7200, `${edge} / ${full}`);
// Fidélité à la référence idéale (disque de 90 px rendu en vectoriel).
const ideal = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><circle cx="64" cy="64" r="45" fill="#000"/></svg>')).ensureAlpha().extractChannel(3).raw().toBuffer();
let diff = 0;
for (let i = 0; i < 128 * 128; i++) diff += Math.abs(ideal[i] - small.data[i * 4 + 3]);
ok(`aperçu proche d'un disque idéal de 90 px (écart moyen ${(diff / 16384).toFixed(2)} niveau)`, diff / 16384 < 3, String(diff / 16384));
// Teinte par le thème : le masque ne garde que la forme.
ok("icône monochrome : servie en masque (teinte par le thème), pas la couleur dessinée", ic.chosen === "svg-mask" && !/fill="#142a5a"/i.test(svg));

/* ---- Icône du site (lot 83) : case de 512 × 512 dans le fichier « logo » ------------------------------------------ */
const iconSlot = ALL_SLOTS.find((s) => s.id === "icone-site");
ok("icône du site : case 512 × 512 (échelle 1) dans le fichier « logo »", iconSlot?.at?.role === "logo" && iconSlot.draw.w === 512 && iconSlot.draw.h === 512 && iconSlot.multiOnly === true && iconSlot.kind === "appicon");
ok("ancien fichier « logo » (3000 × 4640, d'avant le lot 83) : toujours reconnu, sans la case de l'icône", roleOfSize(LEGACY_LOGO_DOC.width, LEGACY_LOGO_DOC.height) === "logo" && !slotsOfFile("logo", LEGACY_LOGO_DOC.width, LEGACY_LOGO_DOC.height).some((s) => s.id === "icone-site") && slotsOfFile("logo", KIT_FILES.logo.doc.width, KIT_FILES.logo.doc.height).some((s) => s.id === "icone-site") && slotsOfRole("icones").every((s) => s.id !== "icone-site"));
{
  // Aucun calque touché : l'icône actuelle (gabarit, ici) est « inchangée » ; redessinée en couleurs, elle est redessinée et gardée en bitmap.
  const f = frameOf(iconSlot, "multi");
  const ico = disc(300, 300, (x, y) => (x - 150) ** 2 + (y - 150) ** 2 <= 150 ** 2);
  for (let i = 0; i < ico.data.length; i += 4) if (ico.data[i + 3]) ico.data.set([200, 60, 40, 255], i);
  const psdIcon = await mutate(
    "logo",
    (psd) => {
      const l = find(psd.children, "Icône du site");
      Object.assign(l, { left: f.x + 106, top: f.y + 106, right: f.x + 406, bottom: f.y + 406, imageData: ico });
    },
    "icone-site.psd",
  );
  const rIco = await importKit({ path: psdIcon, name: "l.psd" }, path.join(tmp, "out-icone-site"), { manifests, themeId: theme.id, keepCrops: true });
  const sIco = rIco.slots.find((s) => s.id === "icone-site");
  ok("icône du site redessinée : « redessinée », en bitmap (couleurs gardées), appliquée", rIco.ok && sIco?.change === "redrawn" && sIco.status !== "error" && /avif/.test(sIco.chosen ?? "") && isApplicable(sIco) && rIco.slots.filter((x) => x.change === "redrawn").length === 1, JSON.stringify({ c: sIco?.change, ch: sIco?.chosen, st: sIco?.status, m: sIco?.messages }));
  const prev = sIco?.preview ? await sharp(path.join(tmp, "out-icone-site", sIco.preview)).metadata() : null;
  ok("icône du site : aperçu « après » carré", Boolean(prev) && prev.width === prev.height, `${prev?.width}x${prev?.height}`);
}

/* ---- Logo en grand : réduit de moitié ------------------------------------------ */
const sigSlot = ALL_SLOTS.find((s) => s.id === "signature");
const sf = frameOf(sigSlot, "multi");
const logoPsd = await mutate(
  "logo",
  (psd) => {
    const l = find(psd.children, "Signature");
    const w = 2000;
    const h = 300;
    Object.assign(l, { left: sf.x + 100, top: sf.y + 150, right: sf.x + 100 + w, bottom: sf.y + 150 + h, imageData: disc(w, h, (x, y) => y > 120 && y < 180 && x > 40 && x < w - 40) });
  },
  "logo-modifie.psd",
);
const rLogo2 = await importKit({ path: logoPsd, name: "l.psd" }, path.join(tmp, "out-logo2"), { manifests, themeId: theme.id });
const sg = rLogo2.slots.find((s) => s.id === "signature");
ok("logo dessiné en 2400 × 600 : réduit de moitié (boîte de 960 × 30 px)", sg.change === "redrawn" && sg.box.w >= 955 && sg.box.w <= 965 && sg.box.h >= 28 && sg.box.h <= 33, JSON.stringify(sg.box));

/* ---- Curseur : point chaud ramené à la taille du curseur ------------------------ */
const curSlot = ALL_SLOTS.find((s) => s.id === "curseur/normal");
const cf = frameOf(curSlot, "multi");
const curPsd = await mutate(
  "icones",
  (psd) => {
    const g = find(psd.children, "Normal");
    const drawing = g.children.find((l) => l.name === "Dessin");
    Object.assign(drawing, { left: cf.x + 40, top: cf.y + 40, right: cf.x + 40 + 300, bottom: cf.y + 40 + 360, imageData: disc(300, 360, (x, y) => x < 300 - y * 0.8 && x > 20 && y > 20) });
    const m = g.children.find((l) => l.name === "point chaud");
    for (const k of ["left", "right"]) m[k] += 48; // 6 px de la case 64 × 64
    for (const k of ["top", "bottom"]) m[k] += 64; // 8 px
  },
  "curseur-modifie.psd",
);
const rCur = await importKit({ path: curPsd, name: "c.psd" }, path.join(tmp, "out-curseur"), { manifests, themeId: theme.id });
const cn = rCur.slots.find((s) => s.id === "curseur/normal");
ok("curseur dessiné en 512 × 512 : point chaud (4,4)+(6,8) → (5, 6) px CSS", cn.change === "redrawn" && cn.hotspot?.x === 5 && cn.hotspot?.y === 6, JSON.stringify({ c: cn.change, h: cn.hotspot, m: cn.messages }));
const png2 = cn.files.find((f) => f.endsWith(".2x.png"));
const png1 = cn.files.find((f) => !f.endsWith(".2x.png"));
const md = [await sharp(path.join(tmp, "out-curseur", png1)).metadata(), await sharp(path.join(tmp, "out-curseur", png2)).metadata()];
ok("curseur : PNG 32 × 32 et 64 × 64", md[0].width === 32 && md[1].width === 64 && md[1].height === 64);
ok("curseur « clic » laissé tel quel → inchangé", rCur.slots.find((s) => s.id === "curseur/clic").change === "unchanged");

/* ---- Décor à calques libres -------------------------------------------------------- */
const layerAtDecor = (name, x, y, w, h, color, extra = {}) => ({ name, left: x, top: DECOR_HEAD + y, right: x + w, bottom: DECOR_HEAD + y + h, imageData: { width: w, height: h, data: new Uint8ClampedArray(w * h * 4).map((_, i) => (i % 4 === 3 ? 255 : color[i % 4])) }, ...extra });
const freeDecor = async (children, name) => {
  const psd = readPsd(readFileSync(file("decor")), { ...READ, skipLayerImageData: true });
  const guides = psd.children.filter((l) => /^(LISEZ-MOI|_guides)$/.test(l.name));
  const out = path.join(tmp, name);
  // Calques libres (noms quelconques) sous les calques verrouillés.
  writeFileSync(out, writePsdBuffer({ width: psd.width, height: psd.height, children: [...children, ...guides] }, { noBackground: true }));
  return out;
};
const five = await freeDecor(
  [
    layerAtDecor("ciel", 0, 0, 800, 500, [200, 220, 240]),
    layerAtDecor("nuages", 300, 100, 600, 200, [255, 255, 255]),
    layerAtDecor("herbe", 0, 800, 900, 400, [90, 120, 90]),
    { name: "sapins", children: [layerAtDecor("a", 100, 900, 200, 500, [20, 60, 30]), layerAtDecor("b", 500, 950, 200, 450, [20, 60, 30])] },
    layerAtDecor("brume devant", 0, 1500, 1200, 300, [230, 230, 240]),
  ],
  "decor-5.psd",
);
const r5 = await importKit({ path: five, name: "d.psd" }, path.join(tmp, "out-5"), { manifests, themeId: theme.id });
const plans5 = r5.slots.filter((s) => s.id.startsWith("decor/"));
ok("décor à 5 calques libres (noms quelconques, un groupe) → 5 plans", r5.ok && plans5.length === 5 && plans5.map((s) => s.id).join() === "decor/1,decor/2,decor/3,decor/4,decor/5" && plans5.every((s) => s.change === "redrawn" && s.files?.length), plans5.map((s) => `${s.id}:${s.change}:${s.status}`).join(" ") || r5.problem);
ok("décor libre : chaque plan converti (SVG ou AVIF), composition « changée », à appliquer", r5.decor?.count === 5 && r5.decor.structure === "changed" && decorApplicable(r5) && plans5.every((s) => ["svg", "avif"].includes(s.chosen)), JSON.stringify(r5.decor));
ok("décor libre : les plans gardent le nom du calque dans la revue", /ciel/.test(plans5[0].label) && /sapins/.test(plans5[3].label), plans5.map((s) => s.label).join(" | "));
const three = await freeDecor(
  [
    layerAtDecor("fond", 0, 0, 500, 400, [200, 220, 240]),
    layerAtDecor("vide", 0, 0, 10, 10, [0, 0, 0], { imageData: { width: 10, height: 10, data: new Uint8ClampedArray(400) } }),
    layerAtDecor("masqué", 0, 100, 400, 400, [255, 0, 0], { hidden: true }),
    layerAtDecor("hors du cadre", 0, -500, 300, 300, [255, 0, 0]),
    layerAtDecor("devant", 100, 1000, 700, 300, [30, 30, 30]),
    layerAtDecor("milieu", 100, 600, 700, 300, [60, 90, 60]),
  ],
  "decor-3.psd",
);
const r3 = await importKit({ path: three, name: "d.psd" }, path.join(tmp, "out-3"), { manifests, themeId: theme.id });
ok("décor : calque vide, masqué et hors du cadre ignorés → 3 plans, dans l'ordre de la pile", r3.slots.filter((s) => s.id.startsWith("decor/")).length === 3 && r3.slots.filter((s) => s.id.startsWith("decor/")).map((s) => s.source).join() === "fond,devant,milieu" && r3.ignoredLayers.some((m) => /masqué/.test(m)) && r3.ignoredLayers.some((m) => /vide|hors/.test(m)), `${r3.slots.map((s) => s.source)} | ${r3.ignoredLayers.join(" ; ")}`);
// Calque oublié (nom donné d'office par Photoshop) : jamais appliqué en silence, listé dans la revue.
const oubli = await freeDecor(
  [
    layerAtDecor("fond", 0, 0, 500, 400, [200, 220, 240]),
    layerAtDecor("Calque 12 copie", 0, 100, 400, 400, [255, 0, 0]),
    layerAtDecor("Layer 3", 0, 100, 400, 400, [255, 0, 0]),
    layerAtDecor("devant", 100, 1000, 700, 300, [30, 30, 30]),
  ],
  "decor-oubli.psd",
);
const rOubli = await importKit({ path: oubli, name: "d.psd" }, path.join(tmp, "out-oubli"), { manifests, themeId: theme.id });
ok(
  "décor : calque au nom d'office (« Calque 12 copie », « Layer 3 ») non appliqué, listé « nom non reconnu »",
  rOubli.ok && rOubli.slots.filter((s) => s.id.startsWith("decor/")).map((s) => s.source).join() === "fond,devant" && rOubli.ignoredLayers.some((m) => m.includes("Calque “Calque 12 copie” ignoré : nom non reconnu")) && rOubli.ignoredLayers.some((m) => /Layer 3/.test(m)),
  `${rOubli.slots.map((s) => s.source)} | ${rOubli.ignoredLayers.join(" ; ")}`,
);
// Fichier tronqué : message exact, jamais « vérifie l'espace disque ».
{
  const { readFileSync } = await import("node:fs");
  const buf = readFileSync(five);
  const cut = path.join(tmp, "tronque.psd");
  writeFileSync(cut, buf.subarray(0, Math.floor(buf.length * 0.4)));
  let rCut;
  try {
    rCut = await importKit({ path: cut, name: "t.psd" }, path.join(tmp, "out-cut"), { manifests, themeId: theme.id });
  } catch (e) {
    rCut = { ok: false, problem: `exception : ${e.message}` };
  }
  ok("fichier tronqué : « Le fichier semble abîmé ou incomplet »", rCut.ok === false && /Le fichier semble abîmé ou incomplet/.test(rCut.problem ?? ""), JSON.stringify({ ok: rCut.ok, problem: rCut.problem, slots: rCut.slots?.length, ign: rCut.ignoredLayers }));
}
const many = await freeDecor(Array.from({ length: MAX_DECOR_PLANS + 1 }, (_, i) => layerAtDecor(`p${i}`, i * 40, i * 40, 100, 100, [10 * i, 50, 50])), "decor-9.psd");
const r9 = await importKit({ path: many, name: "d.psd" }, path.join(tmp, "out-9"), { manifests, themeId: theme.id });
ok(`décor : plus de ${MAX_DECOR_PLANS} plans → refusé, message clair`, r9.ok === false && new RegExp(`plus de ${MAX_DECOR_PLANS} plans`).test(r9.problem ?? ""), r9.problem);
const none = await freeDecor([], "decor-0.psd");
const r0d = await importKit({ path: none, name: "d.psd" }, path.join(tmp, "out-0d"), { manifests, themeId: theme.id });
ok("décor sans aucun plan : inchangé (le décor actuel est gardé)", r0d.ok && r0d.slots.length === 0 && !r0d.decor && !decorApplicable(r0d) && r0d.ignoredLayers.some((m) => /aucun plan/.test(m)), JSON.stringify(r0d.ignoredLayers));

// Plans retirés ou déplacés : reconnus inchangés (copie du plan exporté), composition changée.
const reordered = await mutate(
  "decor",
  (psd) => {
    const plans = psd.children.filter((l) => /^Plan \d/.test(l.name));
    const rest = psd.children.filter((l) => !/^Plan \d/.test(l.name));
    // On retire les plans 2 et 4, et on échange l'ordre du 1 et du 5.
    psd.children = [plans[4], plans[2], plans[0], ...rest];
  },
  "decor-reordonne.psd",
);
const rr = await importKit({ path: reordered, name: "d.psd" }, path.join(tmp, "out-ro"), { manifests, themeId: theme.id });
const rrPlans = rr.slots.filter((s) => s.id.startsWith("decor/"));
ok("plans retirés / réordonnés : 3 plans, chacun reconnu comme copie d'un plan exporté (pas reconverti)", rrPlans.length === 3 && rrPlans.map((s) => s.from).join() === "4,2,0" && rrPlans.every((s) => s.change === "unchanged" && !s.files), rrPlans.map((s) => `${s.id}:${s.change}:${s.from}`).join(" "));
ok("composition changée sans pixel redessiné : à appliquer quand même", rr.decor.structure === "changed" && decorApplicable(rr) && rr.slots.filter(isApplicable).length === 0, JSON.stringify(rr.decor));

/* ---- Rôle et nom de fichier ---------------------------------------------------------- */
const lying = await mutate(
  "decor",
  (psd) => {
    const id = find(psd.children, psd.children.find((l) => l.name === "_guides").children.find((l) => l.name.includes("role-decor")).name);
    id.name = id.name.replace("role-decor", "role-logo");
  },
  "decor-menteur.psd",
);
const rl = await importKit({ path: lying, name: "x.psd" }, path.join(tmp, "out-lie"), { manifests });
ok("rôle de l'identifiant incohérent avec la taille du document : refusé, message clair", rl.ok === false && /se déclare « 2 · Logo et papier »/.test(rl.problem ?? ""), rl.problem);
const wrong = await importKit([{ path: extracted[KIT_FILES.logo.file], name: "1-decor-accueil.psd" }], path.join(tmp, "out-nom"), { manifests });
ok("un fichier nommé « 1-decor-accueil.psd » mais qui est le logo : reconnu comme le logo (le nom n'a aucune importance)", wrong.files.find((f) => f.received)?.id === "logo" && wrong.slots.length === 4);

/* ---- Anciens kits mono-fichier ---------------------------------------------------------- */
const legacy = await importKit(path.join(root, "tests/fixtures/kit-synthetique.psd"), path.join(tmp, "out-legacy"), { manifests: [JSON.parse(readFileSync(path.join(root, "tests/fixtures/kit-galerie-lumineuse-v1.manifest.json"), "utf8"))], themeId: "galerie-lumineuse" });
ok("ancien kit v1 (fichier de test synthétique) : toujours lisible, un seul bloc « mono », seule la flèche droite redessinée", legacy.ok && legacy.layout === "v1" && legacy.files.length === 1 && legacy.files[0].id === "mono" && legacy.slots.filter((s) => s.change === "redrawn").map((s) => s.id).join() === "icones/fleche-droite", JSON.stringify({ l: legacy.layout, f: legacy.files, r: legacy.slots.filter((s) => s.change === "redrawn").map((s) => s.id) }));
const mixed = await importKit([path.join(root, "tests/fixtures/kit-synthetique.psd"), extracted[KIT_FILES.logo.file]], path.join(tmp, "out-mix"), {});
ok("ancien kit envoyé avec d'autres fichiers : refusé, message clair", mixed.ok === false && /ancien kit en un seul fichier/.test(mixed.problem ?? ""), mixed.problem);

void DECOR_CANVAS;
mkdirSync(tmp, { recursive: true });
rmSync(tmp, { recursive: true, force: true });
if (failures) {
  console.error(`test-kit-multi : ${failures} échec(s)`);
  process.exit(1);
}
console.log("test-kit-multi : OK");
