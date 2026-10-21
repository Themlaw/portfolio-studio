/**
 * Écriture d'une archive tar (ustar + enregistrements PAX pour les noms longs et les fichiers de plus de 8 Gio), en flux :
 * le contenu des fichiers n'est jamais chargé en mémoire. Lecture par n'importe quel `tar` (tar xzf) ; le script
 * scripts/restore-backup.mjs sait aussi l'extraire sans `tar` (l'image de production n'a pas de shell).
 */
import { createReadStream } from "node:fs";
import { setImmediate as tick } from "node:timers/promises";

export type TarSource = { file: string } | { data: Buffer };
export type TarEntry = { name: string; size: number; mtime: number; source: TarSource };

const BLOCK = 512;
const octal = (n: number, width: number) => `${Math.floor(n).toString(8).padStart(width - 1, "0")}\0`;

function paxRecord(key: string, value: string): Buffer {
  const body = ` ${key}=${value}\n`;
  let len = Buffer.byteLength(body) + 1;
  while (String(len).length + Buffer.byteLength(body) !== len) len = String(len).length + Buffer.byteLength(body);
  return Buffer.from(`${len}${body}`);
}

function header(name: string, size: number, mtime: number, type: string, mode = 0o644): Buffer {
  const b = Buffer.alloc(BLOCK);
  b.write(name.slice(0, 100), 0, 100, "utf8");
  b.write(octal(mode, 8), 100, 8, "ascii");
  b.write(octal(0, 8), 108, 8, "ascii"); // uid
  b.write(octal(0, 8), 116, 8, "ascii"); // gid
  b.write(octal(Math.min(size, 0o77777777777), 12), 124, 12, "ascii");
  b.write(octal(mtime, 12), 136, 12, "ascii");
  b.write("        ", 148, 8, "ascii"); // somme de contrôle : huit espaces pendant le calcul
  b.write(type, 156, 1, "ascii");
  b.write("ustar\0", 257, 6, "ascii");
  b.write("00", 263, 2, "ascii");
  let sum = 0;
  for (const byte of b) sum += byte;
  b.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return b;
}

const pad = (n: number) => (BLOCK - (n % BLOCK)) % BLOCK;

/** Nom sûr dans l'archive : segments non vides, ni « . » ni « .. », séparateur « / ». */
export function isSafeEntryName(name: string): boolean {
  return name.length > 0 && !name.startsWith("/") && name.split("/").every((s) => s !== "" && s !== "." && s !== "..") && !name.includes("\0");
}

/** Résultat d'un flux : octets de contenu lus en moins que prévu (fichier raccourci en cours de route), complétés de zéros. */
export type TarReport = { shortfall: number };

/**
 * Générateur de blocs tar. Un fichier qui rétrécit ou disparaît pendant la lecture est complété de zéros (l'en-tête a
 * déjà annoncé sa taille) ; un fichier qui grossit est tronqué : l'archive reste valide dans tous les cas.
 */
export async function* tarChunks(entries: Iterable<TarEntry>, report: TarReport = { shortfall: 0 }): AsyncGenerator<Buffer> {
  for (const e of entries) {
    if (!isSafeEntryName(e.name)) throw new Error(`Nom d'archive refusé : ${JSON.stringify(e.name)}`);
    const records: Buffer[] = [];
    if (Buffer.byteLength(e.name) > 100) records.push(paxRecord("path", e.name));
    if (e.size > 0o77777777777) records.push(paxRecord("size", String(e.size)));
    if (records.length) {
      const body = Buffer.concat(records);
      yield header("PaxHeader", body.length, e.mtime, "x");
      yield body;
      if (pad(body.length)) yield Buffer.alloc(pad(body.length));
    }
    yield header(e.name, e.size, e.mtime, "0");
    let written = 0;
    if ("data" in e.source) {
      yield e.source.data;
      written = e.source.data.length;
    } else if (e.size > 0) {
      try {
        for await (const chunk of createReadStream(e.source.file, { start: 0, end: e.size - 1, highWaterMark: 256 * 1024 })) {
          yield chunk as Buffer;
          written += (chunk as Buffer).length;
          await tick(); // cède la main : les requêtes du site passent entre deux blocs
        }
      } catch {
        // fichier disparu : complété ci-dessous
      }
    }
    if (written < e.size) {
      report.shortfall += e.size - written;
      let missing = e.size - written;
      while (missing > 0) {
        const n = Math.min(missing, 1 << 20);
        yield Buffer.alloc(n);
        missing -= n;
      }
    }
    if (pad(e.size)) yield Buffer.alloc(pad(e.size));
  }
  yield Buffer.alloc(BLOCK * 2); // fin d'archive
}
