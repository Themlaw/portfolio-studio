/**
 * Archive ZIP minimale pour l'export / l'import de thème, sans dépendance.
 *
 * Écriture : entrées compressées (deflate) ou stockées, sans zip64.
 * Lecture : DÉFENSIVE, c'est une surface d'envoi (docs/THEMES.md) :
 *  - le répertoire central fait foi ; chaque en-tête local est recoupé ;
 *  - refus : zip64, multi-volume, chiffrement, méthode autre que 0/8,
 *    noms absolus, `..`, `\`, caractères de contrôle, doublons ;
 *  - bornes AVANT décompression (nombre d'entrées, taille déclarée par
 *    entrée et au total, taux de compression) puis décompression plafonnée
 *    (`maxOutputLength`) : une « bombe » s'arrête à la borne, jamais en mémoire ;
 *  - taille réelle et CRC-32 vérifiés après décompression.
 * Module pur (node:zlib seulement) : testé directement par scripts/test-theme-zip.mjs.
 */
import { deflateRawSync, inflateRawSync } from "node:zlib";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (ZIP). */
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export class ZipError extends Error {}

export type ZipLimits = {
  /** Nombre maximal d'entrées (dossiers compris). */
  maxEntries: number;
  /** Taille décompressée maximale d'une entrée (octets). */
  maxEntryBytes: number;
  /** Taille décompressée totale maximale (octets). */
  maxTotalBytes: number;
  /** Taux de compression maximal (décompressé / compressé) au-delà de 64 Ko. */
  maxRatio: number;
};

export type ZipEntry = { name: string; data: Buffer };

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

/** Nom d'entrée acceptable : relatif, sans remontée, ASCII imprimable sans `\`. */
export function isSafeEntryName(name: string): boolean {
  if (!name || name.length > 200) return false;
  if (!/^[\x21-\x7e]+$/.test(name)) return false; // ni espace, ni contrôle, ni non-ASCII
  if (name.includes("\\") || name.startsWith("/") || /^[a-zA-Z]:/.test(name)) return false;
  return name.split("/").every((part, i, all) => part !== ".." && part !== "." && (part !== "" || i === all.length - 1));
}

/* ---- Écriture --------------------------------------------------------------- */

export function writeZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  // Date DOS fixe (1980-01-01) : une même donnée donne la même archive.
  const dosTime = 0;
  const dosDate = (0 << 9) | (1 << 5) | 1;
  for (const { name, data } of entries) {
    if (!isSafeEntryName(name)) throw new ZipError(`nom d'entrée invalide : ${name}`);
    const nameBuf = Buffer.from(name, "utf8");
    const deflated = deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const crc = crc32(data) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOC_SIG, 0);
    local.writeUInt16LE(20, 4); // version requise
    local.writeUInt16LE(0x0800, 6); // noms en UTF-8
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CEN_SIG, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(useDeflate ? 8 : 0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cen = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cen.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cen, eocd]);
}

/* ---- Lecture ---------------------------------------------------------------- */

export function readZip(buf: Buffer, limits: ZipLimits): ZipEntry[] {
  if (buf.length < 22) throw new ZipError("Ce fichier n'est pas une archive ZIP.");
  if (buf.readUInt32LE(0) !== LOC_SIG) throw new ZipError("Ce fichier n'est pas une archive ZIP.");
  // Fin du répertoire central : dans les 22 + 65535 derniers octets.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG && i + 22 + buf.readUInt16LE(i + 20) === buf.length) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("Archive ZIP illisible (fin de répertoire introuvable).");
  const disk = buf.readUInt16LE(eocd + 4);
  const cdDisk = buf.readUInt16LE(eocd + 6);
  const onDisk = buf.readUInt16LE(eocd + 8);
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (disk !== 0 || cdDisk !== 0 || onDisk !== total) throw new ZipError("Archive en plusieurs volumes : non acceptée.");
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new ZipError("Archive ZIP64 : non acceptée.");
  if (total > limits.maxEntries) throw new ZipError(`Trop de fichiers dans l'archive (${total}) : ${limits.maxEntries} au plus.`);
  if (cdOffset + cdSize > eocd) throw new ZipError("Archive ZIP incohérente.");

  const seen = new Set<string>();
  const entries: ZipEntry[] = [];
  let declaredTotal = 0;
  let p = cdOffset;
  for (let n = 0; n < total; n++) {
    if (p + 46 > cdOffset + cdSize || buf.readUInt32LE(p) !== CEN_SIG) throw new ZipError("Archive ZIP incohérente (répertoire central).");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;

    if (!isSafeEntryName(name)) throw new ZipError(`Nom de fichier refusé dans l'archive : « ${name.slice(0, 80)} ».`);
    if (seen.has(name)) throw new ZipError(`Fichier en double dans l'archive : « ${name} ».`);
    seen.add(name);
    if (flags & 0x1) throw new ZipError("Archive chiffrée : non acceptée.");
    if (method !== 0 && method !== 8) throw new ZipError(`Méthode de compression non acceptée (${method}).`);
    if (csize === 0xffffffff || usize === 0xffffffff) throw new ZipError("Archive ZIP64 : non acceptée.");
    if (usize > limits.maxEntryBytes) throw new ZipError(`« ${name} » est trop gros une fois décompressé (${usize} octets).`);
    declaredTotal += usize;
    if (declaredTotal > limits.maxTotalBytes) throw new ZipError("L'archive est trop grosse une fois décompressée.");
    if (usize > 64 * 1024 && usize / Math.max(1, csize) > limits.maxRatio) throw new ZipError(`« ${name} » est anormalement compressé : archive refusée.`);
    if (method === 0 && csize !== usize) throw new ZipError("Archive ZIP incohérente (taille).");

    // En-tête local : signature, même nom, données dans le fichier.
    if (localOffset + 30 > cdOffset || buf.readUInt32LE(localOffset) !== LOC_SIG) throw new ZipError("Archive ZIP incohérente (en-tête local).");
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const lName = buf.subarray(localOffset + 30, localOffset + 30 + lNameLen).toString("utf8");
    if (lName !== name) throw new ZipError("Archive ZIP incohérente (noms).");
    const start = localOffset + 30 + lNameLen + lExtraLen;
    if (start + csize > cdOffset) throw new ZipError("Archive ZIP incohérente (données).");
    if (name.endsWith("/")) {
      if (usize !== 0) throw new ZipError("Archive ZIP incohérente (dossier).");
      continue; // dossier : rien à lire
    }
    const raw = buf.subarray(start, start + csize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else {
      try {
        // Plafond = taille déclarée (+1 pour détecter un dépassement) : une
        // déclaration mensongère ne fait jamais décompresser plus.
        data = inflateRawSync(raw, { maxOutputLength: usize + 1 });
      } catch {
        throw new ZipError(`« ${name} » est illisible ou plus gros que déclaré.`);
      }
    }
    if (data.length !== usize) throw new ZipError(`« ${name} » : taille réelle différente de la taille déclarée.`);
    if ((crc32(data) >>> 0) !== crc) throw new ZipError(`« ${name} » est abîmé (somme de contrôle).`);
    entries.push({ name, data });
  }
  return entries;
}
