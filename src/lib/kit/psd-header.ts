/**
 * Lecture préalable d'un PSD SANS rien décoder : en-tête (signature, version,
 * mode, profondeur, dimensions), puis enregistrements des calques (nombre,
 * rectangles déclarés, nombre de couches). Quelques Ko lus par position :
 * de quoi refuser un fichier hors limites avant de le charger en mémoire.
 */
import { open, stat } from "node:fs/promises";

export type PsdPreflight = {
  fileBytes: number;
  version: 1 | 2;
  channels: number;
  width: number;
  height: number;
  depth: number;
  /** 3 = RVB. */
  colorMode: number;
  layerCount: number;
  /** Surface déclarée de tous les calques (px), pour estimer le décodage. */
  layerArea: number;
  /** Plus grand calque déclaré (px). */
  largestLayer: number;
};

export class PsdPreflightError extends Error {}

const COLOR_MODES: Record<number, string> = { 0: "bitmap", 1: "niveaux de gris", 2: "couleurs indexées", 3: "RVB", 4: "CMJN", 7: "multicanal", 8: "bichromie", 9: "Lab" };

export async function preflightPsd(file: string, maxLayers = 400): Promise<PsdPreflight> {
  const fileBytes = (await stat(file)).size;
  const fh = await open(file, "r");
  try {
    let pos = 0;
    const read = async (n: number) => {
      const buf = Buffer.alloc(n);
      const { bytesRead } = await fh.read(buf, 0, n, pos);
      if (bytesRead !== n) throw new PsdPreflightError("Fichier PSD tronqué.");
      pos += n;
      return buf;
    };
    const head = await read(26);
    if (head.toString("latin1", 0, 4) !== "8BPS") throw new PsdPreflightError("Ce n'est pas un fichier Photoshop (.psd).");
    const version = head.readUInt16BE(4);
    if (version !== 1 && version !== 2) throw new PsdPreflightError("Version de PSD inconnue.");
    const channels = head.readUInt16BE(12);
    const height = head.readUInt32BE(14);
    const width = head.readUInt32BE(18);
    const depth = head.readUInt16BE(22);
    const colorMode = head.readUInt16BE(24);
    const big = version === 2;
    // Données du mode couleur, ressources d'image : sautées. (Longueur lue
    // AVANT d'avancer : `pos += await read()` perdrait les 4 octets lus.)
    const colorModeLen = (await read(4)).readUInt32BE(0);
    pos += colorModeLen;
    const resourcesLen = (await read(4)).readUInt32BE(0);
    pos += resourcesLen;
    // Calques et masques.
    const lmLen = big ? Number((await read(8)).readBigUInt64BE(0)) : (await read(4)).readUInt32BE(0);
    let layerCount = 0;
    let layerArea = 0;
    let largestLayer = 0;
    if (lmLen > 0) {
      const liLen = big ? Number((await read(8)).readBigUInt64BE(0)) : (await read(4)).readUInt32BE(0);
      if (liLen > 0) {
        layerCount = Math.abs((await read(2)).readInt16BE(0));
        if (layerCount > maxLayers) {
          return { fileBytes, version, channels, width, height, depth, colorMode, layerCount, layerArea: 0, largestLayer: 0 };
        }
        for (let i = 0; i < layerCount; i++) {
          const rec = await read(18);
          const top = rec.readInt32BE(0);
          const left = rec.readInt32BE(4);
          const bottom = rec.readInt32BE(8);
          const right = rec.readInt32BE(12);
          const nch = rec.readUInt16BE(16);
          pos += nch * (big ? 10 : 6) + 12; // infos de couches, signature, mode de fusion, opacité, drapeaux
          const extra = (await read(4)).readUInt32BE(0);
          pos += extra;
          const area = Math.max(0, bottom - top) * Math.max(0, right - left);
          layerArea += area;
          largestLayer = Math.max(largestLayer, area);
        }
      }
    }
    return { fileBytes, version: version as 1 | 2, channels, width, height, depth, colorMode, layerCount, layerArea, largestLayer };
  } finally {
    await fh.close();
  }
}

/** `sizes` : tailles de document admises (kit v2, et v1 encore importé). */
export type PreflightLimits = {
  maxFileBytes: number;
  maxLayers: number;
  maxLayerArea: number;
  sizes: { width: number; height: number }[];
  /** Surface cumulée admise pour un document de cette taille (kit v4 : le décor accepte jusqu'à 8 plans pleine toile) ; sinon `maxLayerArea`. */
  areaFor?: (width: number, height: number) => number;
};
/** Surface cumulée de calques admise pour un document. */
export const layerAreaLimit = (limits: Pick<PreflightLimits, "maxLayerArea" | "areaFor">, width: number, height: number) => limits.areaFor?.(width, height) ?? limits.maxLayerArea;

/** Refus clair, avant tout décodage. */
export function preflightProblem(p: PsdPreflight, limits: PreflightLimits): string | null {
  const mb = (n: number) => `${Math.round(n / 1024 / 1024)} Mo`;
  if (p.fileBytes > limits.maxFileBytes) return `Le fichier fait ${mb(p.fileBytes)} : ${mb(limits.maxFileBytes)} au plus. Supprime les calques inutiles (ou fusionne-les), puis réenregistre.`;
  if (p.version === 2) return "Format PSB (grand document) non pris en charge : enregistre en PSD.";
  if (p.colorMode !== 3) return `Le document est en mode ${COLOR_MODES[p.colorMode] ?? p.colorMode} : passe-le en RVB (Image > Mode > Couleurs RVB).`;
  if (p.depth !== 8) return `Le document est en ${p.depth} bits par couche : passe-le en 8 bits (Image > Mode > 8 bits/couche).`;
  if (!limits.sizes.some((z) => z.width === p.width && z.height === p.height)) {
    const want = limits.sizes[0];
    return limits.sizes.length > 3
      ? `Le document fait ${p.width} × ${p.height} px : ce n'est la taille d'aucun fichier du kit (ne redimensionne pas la zone de travail, et envoie les .psd du kit tels quels).`
      : `Le document fait ${p.width} × ${p.height} px : garde ${want.width} × ${want.height} (ne redimensionne pas la zone de travail).`;
  }
  if (p.layerCount > limits.maxLayers) return `Le document contient ${p.layerCount} calques : ${limits.maxLayers} au plus. Fusionne ou supprime les calques en trop.`;
  const maxArea = layerAreaLimit(limits, p.width, p.height);
  if (p.layerArea > maxArea) {
    return `Les calques couvrent ${Math.round(p.layerArea / 1e6)} mégapixels au total : ${Math.round(maxArea / 1e6)} au plus. Supprime ou rogne les calques pleine toile en trop.`;
  }
  return null;
}
