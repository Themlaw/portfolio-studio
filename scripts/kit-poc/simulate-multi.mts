/**
 * Retouches simulées du kit v4 (aller-retour sans Photoshop), pour les e2e : l'archive
 * exportée est ouverte, un fichier est retouché comme le ferait Photoshop (calque
 * recadré à son contenu), le reste est réécrit tel quel.
 *
 * Usage : node --import tsx scripts/kit-poc/simulate-multi.mts <commande> <kit.zip> <sortie> [...]
 *   extract   <kit.zip> <dossier>             : les trois PSD, sous leur nom d'export
 *   icone     <kit.zip> <sortie.psd>          : « Flèche droite » redessinée EN GRAND (360 px dans la case 512)
 *   decor     <kit.zip> <sortie.psd>          : décor libre : plans 1, 3 et 5 gardés, un nouveau calque « nuages »
 *                                               inséré avant le dernier : 4 plans, dont un redessiné
 *   zip       <kit.zip> <icone.psd> <sortie>  : l'archive avec le fichier d'icônes remplacé par la version retouchée
 *   studio    <kit.zip> <sortie.psd> [--opaque-logo] : fichier « logo et papier » retouché (lot 17a) : tuile de
 *                                               cœurs 1024 × 1024 et logo 2400 × 600
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { readPsd, writePsdBuffer, type Layer } from "ag-psd";
import sharp from "sharp";

import { ensureAgPsd } from "@/lib/kit/ag-psd-node";
import { ALL_SLOTS, CURSOR_DRAWING_LAYER, DECOR_HEAD, drawScale, frameOf, HOTSPOT_LAYER, KIT_FILES, KIT_ROLES, SLOTS, type KitRole } from "@/lib/kit/spec";
import { extractEntry, listZip, writeZipFile } from "@/lib/kit/zip-archive";

const [cmd, zipPath, out, ...rest] = process.argv.slice(2);
if (!cmd || !zipPath || !out) throw new Error("usage : simulate-multi.mts <commande> <kit.zip> <sortie> …");
ensureAgPsd();
const work = mkdtempSync(path.join(tmpdir(), "sim-multi-"));
const READ = { useImageData: true, skipCompositeImageData: true, skipThumbnail: true } as const;

/** Extrait les trois PSD de l'archive (chemins par rôle). */
async function extractAll(): Promise<Record<KitRole, string>> {
  const entries = await listZip(zipPath);
  const files = {} as Record<KitRole, string>;
  for (const role of KIT_ROLES) {
    const e = entries.find((x) => x.name === KIT_FILES[role].file);
    if (!e) throw new Error(`${KIT_FILES[role].file} absent de l'archive`);
    files[role] = path.join(work, KIT_FILES[role].file);
    await extractEntry(zipPath, e, files[role], 400 * 1024 * 1024);
  }
  return files;
}

const find = (list: Layer[] | undefined, name: string): Layer | undefined => {
  for (const l of list ?? []) {
    if (l.name === name) return l;
    const inner = find(l.children, name);
    if (inner) return inner;
  }
  return undefined;
};
const raster = async (svg: string) => {
  const { data, info } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
};
const write = (psd: ReturnType<typeof readPsd>, file: string) => writeFileSync(file, writePsdBuffer({ width: psd.width, height: psd.height, children: psd.children }, { noBackground: true }));

try {
  const files = await extractAll();
  if (cmd === "extract") {
    mkdirSync(out, { recursive: true });
    for (const role of KIT_ROLES) writeFileSync(path.join(out, KIT_FILES[role].file), readFileSync(files[role]));
  } else if (cmd === "icone") {
    const psd = readPsd(readFileSync(files.icones), READ);
    const arrow = find(psd.children, "Flèche droite");
    if (!arrow) throw new Error("calque « Flèche droite » introuvable");
    // Flèche pleine dessinée en grand (368 × 320), posée à 72 px et 88 px du coin de la case 512 × 512 (calque rogné, comme Photoshop).
    const img = await raster(`<svg xmlns="http://www.w3.org/2000/svg" width="368" height="320"><path d="M8 112 H208 V16 L360 160 L208 304 V208 H8 Z" fill="#1f2a6b"/></svg>`);
    const box = frameOf(SLOTS.find((s) => s.id === "icones/fleche-droite")!, "multi");
    Object.assign(arrow, { left: box.x + 72, top: box.y + 88, right: box.x + 72 + img.width, bottom: box.y + 88 + img.height, imageData: img });
    write(psd, out);
  } else if (cmd === "cursor") {
    const psd = readPsd(readFileSync(files.icones), READ);
    // Crayon (pointe en haut à gauche) et main ronde, dessinés sur 64 × 64 puis agrandis à la case du kit.
    const DRAWINGS = {
      normal: { svg: `<path d="M6 6 L20 44 L28 36 L52 60 L60 52 L36 28 L44 20 Z" fill="#2b1d3a" stroke="#ffffff" stroke-width="3" stroke-linejoin="round" paint-order="stroke"/>`, hotspot: { x: 6, y: 6 } },
      clic: { svg: `<circle cx="32" cy="34" r="20" fill="#2b1d3a" stroke="#ffffff" stroke-width="3"/><path d="M28 4 L36 4 L36 30 L28 30 Z" fill="#2b1d3a" stroke="#ffffff" stroke-width="3" stroke-linejoin="round" paint-order="stroke"/>`, hotspot: { x: 32, y: 5 } },
    } as const;
    for (const slot of ALL_SLOTS.filter((x) => x.kind === "cursor")) {
      const group = find(psd.children, slot.layer);
      const drawing = group?.children?.find((l) => l.name === CURSOR_DRAWING_LAYER);
      const marker = group?.children?.find((l) => l.name === HOTSPOT_LAYER);
      if (!drawing || !marker) throw new Error(`curseur « ${slot.layer} » incomplet`);
      const spec = DRAWINGS[slot.cursor as "normal" | "clic"] ?? DRAWINGS[slot.layer.toLowerCase() as "normal" | "clic"];
      const k = drawScale(slot);
      const side = 64 * k;
      const img = await raster(`<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 64 64">${spec.svg}</svg>`);
      let [t, b, l, r] = [side, -1, side, -1];
      for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) if (img.data[(y * side + x) * 4 + 3]) [t, b, l, r] = [Math.min(t, y), Math.max(b, y), Math.min(l, x), Math.max(r, x)];
      const w = r - l + 1;
      const h = b - t + 1;
      const crop = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) crop.set(img.data.subarray(((t + y) * side + l) * 4, ((t + y) * side + l + w) * 4), y * w * 4);
      const f = frameOf(slot, "multi");
      Object.assign(drawing, { left: f.x + l, top: f.y + t, right: f.x + l + w, bottom: f.y + t + h, imageData: { width: w, height: h, data: crop } });
      const mw = (marker.right ?? 0) - (marker.left ?? 0);
      const mh = (marker.bottom ?? 0) - (marker.top ?? 0);
      marker.left = f.x + spec.hotspot.x * k + Math.floor(k / 2) - Math.floor((mw - 1) / 2);
      marker.top = f.y + spec.hotspot.y * k + Math.floor(k / 2) - Math.floor((mh - 1) / 2);
      marker.right = marker.left + mw;
      marker.bottom = marker.top + mh;
    }
    write(psd, out);
  } else if (cmd === "decor") {
    const psd = readPsd(readFileSync(files.decor), READ);
    const plans = psd.children!.filter((l) => /^Plan \d/.test(l.name ?? ""));
    const rest = psd.children!.filter((l) => !/^Plan \d/.test(l.name ?? ""));
    // Nuages dessinés dans le ciel : un nouveau calque, nom libre, inséré devant les collines.
    const clouds = await raster(`<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="500"><g fill="#ffffff" fill-opacity="0.85"><ellipse cx="500" cy="260" rx="420" ry="90"/><ellipse cx="1500" cy="180" rx="560" ry="110"/><ellipse cx="1900" cy="360" rx="300" ry="70"/></g></svg>`);
    const nuages: Layer = { name: "mes nuages", left: 1800, top: DECOR_HEAD + 200, right: 1800 + clouds.width, bottom: DECOR_HEAD + 200 + clouds.height, imageData: clouds };
    psd.children = [plans[0], nuages, plans[2], plans[4], ...rest];
    write(psd, out);
  } else if (cmd === "retour49") {
    // Lot 49 : le logo en TROIS couleurs (lot « logo et papier ») et un cadre redessiné (lot « icônes et curseurs »), archive complète.
    const logoPsd = readPsd(readFileSync(files.logo), READ);
    const sig = find(logoPsd.children, "Signature");
    if (!sig) throw new Error("calque « Signature » introuvable");
    const sf = frameOf(SLOTS.find((x) => x.id === "signature")!, "multi");
    const logo = await raster(`<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="600"><rect x="120" y="120" width="500" height="360" rx="60" fill="#e8312a"/><circle cx="900" cy="300" r="190" fill="#1f9d55"/><rect x="1180" y="160" width="900" height="280" rx="40" fill="#2a4bd7"/></svg>`);
    Object.assign(sig, { left: sf.x, top: sf.y, right: sf.x + 2400, bottom: sf.y + 600, imageData: logo });
    const logoFile = path.join(work, "logo-retouche.psd");
    write(logoPsd, logoFile);
    const iconPsd = readPsd(readFileSync(files.icones), READ);
    const cadre = find(iconPsd.children, "Cadre");
    if (!cadre) throw new Error("calque « Cadre » introuvable");
    const cf = frameOf(SLOTS.find((x) => x.id === "cadre")!, "multi");
    const k = cf.w / 300;
    const e = (v: number) => Math.round(v * k);
    // Bordure de 48 px (à l'échelle 300) : filet orange extérieur de 14 px, vide 6, filet vert de 8 ; centre transparent.
    const frame = await raster(`<svg xmlns="http://www.w3.org/2000/svg" width="${cf.w}" height="${cf.h}"><rect x="${e(7)}" y="${e(7)}" width="${cf.w - e(14)}" height="${cf.h - e(14)}" fill="none" stroke="#ff7a00" stroke-width="${e(14)}"/><rect x="${e(30)}" y="${e(30)}" width="${cf.w - e(60)}" height="${cf.h - e(60)}" fill="none" stroke="#1f9d55" stroke-width="${e(8)}"/></svg>`);
    Object.assign(cadre, { left: cf.x, top: cf.y, right: cf.x + cf.w, bottom: cf.y + cf.h, imageData: frame });
    const iconFile = path.join(work, "icones-retouche.psd");
    write(iconPsd, iconFile);
    await writeZipFile(out, [
      { name: KIT_FILES.decor.file, file: files.decor },
      { name: KIT_FILES.logo.file, file: logoFile },
      { name: KIT_FILES.icones.file, file: iconFile },
      { name: "LISEZ-MOI.txt", data: Buffer.from("kit retouché (lot 49)\n") },
    ]);
  } else if (cmd === "zip") {
    const edited = rest[0];
    if (!edited) throw new Error("usage : zip <kit.zip> <icone.psd> <sortie>");
    await writeZipFile(out, [
      { name: KIT_FILES.decor.file, file: files.decor },
      { name: KIT_FILES.logo.file, file: files.logo },
      { name: KIT_FILES.icones.file, file: edited },
      { name: "LISEZ-MOI.txt", data: Buffer.from("kit retouché (e2e)\n") },
    ]);
  } else if (cmd === "studio") {
    const opaqueLogo = rest.includes("--opaque-logo");
    const psd = readPsd(readFileSync(files.logo), READ);
    const paper = find(psd.children, "Papier (tuile)");
    const sig = find(psd.children, "Signature");
    if (!paper || !sig) throw new Error("calques du fichier logo introuvables");
    const hearts = Array.from({ length: 16 }, (_, i) => {
      const cx = 128 + (i % 4) * 256;
      const cy = 128 + Math.floor(i / 4) * 256;
      return `<path transform="translate(${cx} ${cy}) scale(2.2)" d="M0 14 C-34 -8 -18 -34 0 -16 C18 -34 34 -8 0 14Z" fill="#f4b6c6"/>`;
    }).join("");
    const tf = frameOf(SLOTS.find((s) => s.id === "papier")!, "multi");
    Object.assign(paper, { left: tf.x, top: tf.y, right: tf.x + 1024, bottom: tf.y + 1024, imageData: await raster(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#fdf0f3"/>${hearts}</svg>`) });
    const sf = frameOf(SLOTS.find((s) => s.id === "signature")!, "multi");
    const logo = opaqueLogo
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="600"><rect width="2400" height="600" fill="#ffffff"/><text x="120" y="400" font-family="serif" font-size="300" fill="#c21e56">Mon Studio</text></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="600"><text x="120" y="400" font-family="serif" font-size="300" fill="#c21e56">Mon Studio</text></svg>`;
    Object.assign(sig, { left: sf.x, top: sf.y, right: sf.x + 2400, bottom: sf.y + 600, imageData: await raster(logo) });
    write(psd, out);
  } else throw new Error(`commande inconnue : ${cmd}`);
  console.log("écrit", out);
} finally {
  rmSync(work, { recursive: true, force: true });
}
