/**
 * Date de création d'un fichier de la médiathèque (lot 112), lue dans ses métadonnées : lecture seule, jamais de décodage
 * des pixels, jamais d'exception (un fichier illisible n'a simplement pas de date).
 *  - JPEG / WebP / TIFF / HEIC : EXIF `DateTimeOriginal`, sinon `CreateDate` (DateTimeDigitized) ;
 *  - PNG : fragment `eXIf`, sinon texte `Creation Time` (ou `exif:DateTimeOriginal`, écrit par ImageMagick) ;
 *  - vidéo : `creation_time` du conteneur (ffprobe) ;
 *  - PDF et le reste : aucune.
 * Les dates EXIF n'ont pas de fuseau : lues comme UTC (seul l'ordre compte). Hors 1990 → demain : ignorée (horloge d'appareil
 * jamais réglée, date farfelue).
 */
import { open } from "node:fs/promises";

import sharp from "sharp";

const MIN_MS = Date.UTC(1990, 0, 1);

/** « 2024:05:17 14:03:09 » (EXIF) ou n'importe quelle date ISO / RFC 2822 → ms UTC, ou null. */
export function parseTakenDate(raw: string): number | null {
  const s = raw.replace(/\0/g, "").trim();
  if (!s) return null;
  const exif = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s);
  const ms = exif ? Date.UTC(+exif[1], +exif[2] - 1, +exif[3], +exif[4], +exif[5], +exif[6]) : Date.parse(s);
  if (!Number.isFinite(ms)) return null;
  return ms >= MIN_MS && ms <= Date.now() + 86_400_000 ? ms : null;
}

/** Date d'un bloc EXIF (avec ou sans le préfixe « Exif\0\0 » des segments JPEG). */
export function exifTakenAt(block: Uint8Array | null | undefined): number | null {
  if (!block || block.length < 14) return null;
  const buf = Buffer.from(block.buffer, block.byteOffset, block.length);
  const base = buf.subarray(0, 4).toString("latin1") === "Exif" ? 6 : 0;
  const order = buf.subarray(base, base + 2).toString("latin1");
  if (order !== "II" && order !== "MM") return null;
  const le = order === "II";
  const u16 = (o: number) => (o >= 0 && o + 2 <= buf.length ? (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o)) : -1);
  const u32 = (o: number) => (o >= 0 && o + 4 <= buf.length ? (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o)) : -1);
  if (u16(base + 2) !== 42) return null;
  /** Entrées d'un IFD : étiquette → { type, count, offset de la valeur }. */
  const ifd = (offset: number) => {
    const out = new Map<number, { type: number; count: number; value: number }>();
    const at = base + offset;
    const n = u16(at);
    if (n < 0 || n > 512) return out;
    for (let i = 0; i < n; i++) {
      const e = at + 2 + i * 12;
      const tag = u16(e);
      if (tag < 0) break;
      out.set(tag, { type: u16(e + 2), count: u32(e + 4), value: e + 8 });
    }
    return out;
  };
  const text = (e: { type: number; count: number; value: number } | undefined): string | null => {
    if (!e || e.type !== 2 || e.count < 19 || e.count > 64) return null;
    const start = e.count > 4 ? base + u32(e.value) : e.value;
    return start < 0 || start + e.count > buf.length ? null : buf.subarray(start, start + e.count).toString("latin1");
  };
  const first = u32(base + 4);
  if (first < 8) return null;
  const root = ifd(first);
  const exifPtr = root.get(0x8769);
  const sub = exifPtr ? ifd(u32(exifPtr.value)) : new Map();
  for (const raw of [text(sub.get(0x9003)), text(sub.get(0x9004))]) {
    const t = raw ? parseTakenDate(raw) : null;
    if (t !== null) return t;
  }
  return null;
}

/** Texte « mot-clé \0 valeur » d'un fragment tEXt ; iTXt : « mot-clé \0 drapeau compression langue \0 mot traduit \0 texte ». */
function pngText(kind: string, data: Buffer): { key: string; value: string } | null {
  const z = data.indexOf(0);
  if (z < 1) return null;
  const key = data.subarray(0, z).toString("latin1");
  if (kind === "tEXt") return { key, value: data.subarray(z + 1).toString("latin1") };
  if (data[z + 1] !== 0) return null; // iTXt compressé : ignoré
  const l = data.indexOf(0, z + 3);
  const t = l < 0 ? -1 : data.indexOf(0, l + 1);
  return t < 0 ? null : { key, value: data.subarray(t + 1).toString("utf8") };
}

const PNG_KEYS = ["Creation Time", "exif:DateTimeOriginal", "exif:DateTimeDigitized"];

/** Date d'un PNG : parcours des fragments (en-têtes seulement, les données de pixels sont sautées). */
export async function pngTakenAt(file: string): Promise<number | null> {
  const fh = await open(file, "r");
  try {
    const head = Buffer.alloc(8);
    if ((await fh.read(head, 0, 8, 0)).bytesRead < 8 || head.readUInt32BE(0) !== 0x89504e47) return null;
    const size = (await fh.stat()).size;
    let pos = 8;
    let text: number | null = null;
    for (let guard = 0; pos + 12 <= size && guard < 4000; guard++) {
      const h = Buffer.alloc(8);
      await fh.read(h, 0, 8, pos);
      const len = h.readUInt32BE(0);
      const kind = h.subarray(4, 8).toString("latin1");
      if (kind === "IEND") break;
      if ((kind === "eXIf" || kind === "tEXt" || kind === "iTXt") && len <= 1_000_000) {
        const data = Buffer.alloc(len);
        await fh.read(data, 0, len, pos + 8);
        if (kind === "eXIf") {
          const t = exifTakenAt(data);
          if (t !== null) return t;
        } else if (text === null) {
          const e = pngText(kind, data);
          if (e && PNG_KEYS.includes(e.key)) text = parseTakenDate(e.value);
        }
      }
      pos += 12 + len;
    }
    return text;
  } finally {
    await fh.close();
  }
}

/** Date de création d'une vidéo déjà sondée (ffprobe), ou null. */
export function probeTakenAt(probe: { tags: { format: Record<string, string>; streams: Record<string, string>[] } }): number | null {
  const raw = probe.tags.format.creation_time ?? probe.tags.streams.map((s) => s.creation_time).find(Boolean);
  return raw ? parseTakenDate(raw) : null;
}

/** Date de création d'un original (chemin local), ou null. Ne lève jamais. */
export async function readTakenAt(kind: "image" | "video" | "pdf", mime: string, file: string): Promise<number | null> {
  try {
    if (kind === "pdf") return null;
    if (kind === "video") {
      const { runProbe } = await import("@/lib/video/probe");
      const probe = await runProbe(file, mime === "video/webm" ? "matroska" : "mov", 15_000);
      return probeTakenAt(probe);
    }
    if (mime === "image/png") return await pngTakenAt(file);
    const meta = await sharp(file, { limitInputPixels: false }).metadata();
    return exifTakenAt(meta.exif);
  } catch {
    return null;
  }
}
