/**
 * Structure des calques d'un PSD (noms, rectangles, ordre, groupes) en JSON, SANS les pixels
 * (lot 122 : comparer une partie téléchargée au même fichier du kit complet).
 * Usage : node --import tsx scripts/kit-poc/psd-tree.mts <fichier.psd>   (une ligne JSON sur stdout)
 */
import { readFileSync } from "node:fs";

import { readPsd, type Layer } from "ag-psd";

import { ensureAgPsd } from "@/lib/kit/ag-psd-node";

const file = process.argv[2];
if (!file) throw new Error("usage : psd-tree.mts <fichier.psd>");
ensureAgPsd();
type Node = { name: string; box: [number, number, number, number]; hidden: boolean; locked: boolean; children?: Node[] };
const walk = (list: Layer[] | undefined): Node[] =>
  (list ?? []).map((l) => ({ name: l.name ?? "", box: [l.left ?? 0, l.top ?? 0, l.right ?? 0, l.bottom ?? 0], hidden: Boolean(l.hidden), locked: Boolean(l.protected?.composite || l.protected?.position || l.protected?.transparency), ...(l.children ? { children: walk(l.children) } : {}) }));
const psd = readPsd(readFileSync(file), { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true });
process.stdout.write(`${JSON.stringify({ width: psd.width, height: psd.height, children: walk(psd.children) })}\n`);
