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
import { DECOR_HEAD, frameOf, KIT_FILES, KIT_ROLES, SLOTS, type KitRole } from "@/lib/kit/spec";
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
  } else if (cmd === "decor") {
    const psd = readPsd(readFileSync(files.decor), READ);
    const plans = psd.children!.filter((l) => /^Plan \d/.test(l.name ?? ""));
    const rest = psd.children!.filter((l) => !/^Plan \d/.test(l.name ?? ""));
    // Nuages dessinés dans le ciel : un nouveau calque, nom libre, inséré devant les collines.
    const clouds = await raster(`<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="500"><g fill="#ffffff" fill-opacity="0.85"><ellipse cx="500" cy="260" rx="420" ry="90"/><ellipse cx="1500" cy="180" rx="560" ry="110"/><ellipse cx="1900" cy="360" rx="300" ry="70"/></g></svg>`);
    const nuages: Layer = { name: "mes nuages", left: 1800, top: DECOR_HEAD + 200, right: 1800 + clouds.width, bottom: DECOR_HEAD + 200 + clouds.height, imageData: clouds };
    psd.children = [plans[0], nuages, plans[2], plans[4], ...rest];
    write(psd, out);
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
