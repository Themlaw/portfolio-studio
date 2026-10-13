/**
 * Archive ZIP du kit v4, lue et écrite SUR LE DISQUE, en flux (les PSD pèsent
 * des dizaines de Mo : pas question de les tenir en mémoire, contrairement à
 * l'archive de thème, `src/lib/themes/zip.ts`, bornée à 12 Mo).
 *
 *  - écriture : méthode « stocké » (un PSD est déjà compressé en RLE), CRC-32 calculé
 *    en un premier passage ; ni ZIP64 ni chiffrement ;
 *  - lecture défensive (envoi de l'artiste) : répertoire central lu depuis la fin
 *    du fichier, nombre d'entrées borné, noms jamais utilisés comme chemins, seules les
 *    entrées `.psd` sont extraites, taille déclarée ET taille réellement produite
 *    bornées (bombe de décompression), chiffrement et ZIP64 refusés.
 */
import { createReadStream, createWriteStream } from "node:fs";
import { open, stat } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { crc32, createInflateRaw } from "node:zlib";

export class KitZipError extends Error {}

export type ZipSource = { name: string; file: string } | { name: string; data: Buffer };

const u16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};

/** Date et heure MS-DOS d'un instant. */
function dosTime(d: Date): { time: number; date: number } {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

/** CRC-32 d'un fichier, lu en flux. */
async function fileCrc(file: string): Promise<{ crc: number; size: number }> {
  let crc = 0;
  let size = 0;
  for await (const chunk of createReadStream(file)) {
    crc = crc32(chunk as Buffer, crc);
    size += (chunk as Buffer).length;
  }
  return { crc, size };
}

/** Écrit l'archive (entrées stockées, noms UTF-8) ; les entrées `file` sont recopiées en flux. */
export async function writeZipFile(out: string, sources: ZipSource[], now = new Date()): Promise<number> {
  const stream = createWriteStream(out);
  let offset = 0;
  const write = (buf: Buffer) =>
    new Promise<void>((resolve, reject) => {
      stream.write(buf, (error) => (error ? reject(error) : resolve()));
      offset += buf.length;
    });
  const { time, date } = dosTime(now);
  const central: Buffer[] = [];
  try {
    for (const s of sources) {
      const name = Buffer.from(s.name, "utf8");
      const { crc, size } = "data" in s ? { crc: crc32(s.data), size: s.data.length } : await fileCrc(s.file);
      if (size > 0xfffffffe) throw new KitZipError("Fichier trop gros pour l'archive.");
      const header = offset;
      await write(Buffer.concat([u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(time), u16(date), u32(crc), u32(size), u32(size), u16(name.length), u16(0), name]));
      if ("data" in s) await write(s.data);
      else {
        for await (const chunk of createReadStream(s.file)) await write(chunk as Buffer);
      }
      central.push(Buffer.concat([u32(0x02014b50), u16(0x031e), u16(20), u16(0x0800), u16(0), u16(time), u16(date), u32(crc), u32(size), u32(size), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(header), name]));
    }
    const start = offset;
    for (const c of central) await write(c);
    const length = offset - start;
    await write(Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(length), u32(start), u16(0)]));
  } finally {
    await new Promise<void>((resolve) => stream.end(() => resolve()));
  }
  return offset;
}

export type ZipEntryInfo = { name: string; method: number; compressed: number; size: number; offset: number; flags: number };

/** Répertoire central (depuis la fin du fichier) ; refuse ZIP64, entrées trop nombreuses, répertoire démesuré. */
export async function listZip(file: string, maxEntries = 200): Promise<ZipEntryInfo[]> {
  const total = (await stat(file)).size;
  const fh = await open(file, "r");
  try {
    const tail = Buffer.alloc(Math.min(total, 22 + 0xffff));
    await fh.read(tail, 0, tail.length, total - tail.length);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new KitZipError("Archive illisible : ce n'est pas un .zip valide.");
    const count = tail.readUInt16LE(eocd + 10);
    const dirSize = tail.readUInt32LE(eocd + 12);
    const dirOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) throw new KitZipError("Archive trop grande (ZIP64) : envoie les .psd directement.");
    if (count > maxEntries) throw new KitZipError(`Archive trop chargée : ${maxEntries} fichiers au plus.`);
    if (dirSize > 4 * 1024 * 1024 || dirOffset + dirSize > total) throw new KitZipError("Archive illisible : répertoire invalide.");
    const dir = Buffer.alloc(dirSize);
    await fh.read(dir, 0, dirSize, dirOffset);
    const out: ZipEntryInfo[] = [];
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (p + 46 > dir.length || dir.readUInt32LE(p) !== 0x02014b50) throw new KitZipError("Archive illisible : répertoire invalide.");
      const flags = dir.readUInt16LE(p + 8);
      const method = dir.readUInt16LE(p + 10);
      const compressed = dir.readUInt32LE(p + 20);
      const size = dir.readUInt32LE(p + 24);
      const nameLen = dir.readUInt16LE(p + 28);
      const extraLen = dir.readUInt16LE(p + 30);
      const commentLen = dir.readUInt16LE(p + 32);
      const offset = dir.readUInt32LE(p + 42);
      if (p + 46 + nameLen > dir.length) throw new KitZipError("Archive illisible : répertoire invalide.");
      const name = dir.toString(flags & 0x0800 ? "utf8" : "latin1", p + 46, p + 46 + nameLen);
      out.push({ name, method, compressed, size, offset, flags });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  } finally {
    await fh.close();
  }
}

/** Extrait une entrée vers `dest` ; `maxBytes` borne ce qui est réellement écrit (pas seulement la taille déclarée). */
export async function extractEntry(file: string, entry: ZipEntryInfo, dest: string, maxBytes: number): Promise<number> {
  if (entry.flags & 1) throw new KitZipError(`« ${entry.name} » est chiffré : envoie une archive sans mot de passe.`);
  if (entry.method !== 0 && entry.method !== 8) throw new KitZipError(`« ${entry.name} » : compression non prise en charge (stocké ou deflate seulement).`);
  if (entry.size > maxBytes) throw new KitZipError(`« ${entry.name} » fait ${Math.round(entry.size / 1048576)} Mo : ${Math.round(maxBytes / 1048576)} Mo au plus.`);
  const fh = await open(file, "r");
  let start: number;
  try {
    const head = Buffer.alloc(30);
    await fh.read(head, 0, 30, entry.offset);
    if (head.readUInt32LE(0) !== 0x04034b50) throw new KitZipError("Archive illisible : entrée invalide.");
    start = entry.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
  } finally {
    await fh.close();
  }
  let written = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      written += chunk.length;
      if (written > Math.min(maxBytes, entry.size)) return cb(new KitZipError(`« ${entry.name} » dépasse sa taille annoncée : archive refusée.`));
      cb(null, chunk);
    },
  });
  const raw = createReadStream(file, { start, end: start + entry.compressed - 1 });
  try {
    if (entry.method === 8) await pipeline(raw, createInflateRaw(), limit, createWriteStream(dest));
    else await pipeline(raw, limit, createWriteStream(dest));
  } catch (error) {
    if (error instanceof KitZipError) throw error;
    throw new KitZipError(`« ${entry.name} » est illisible : archive corrompue.`);
  }
  if (written !== entry.size) throw new KitZipError(`« ${entry.name} » est incomplet : archive corrompue.`);
  return written;
}
