/**
 * Type d'un fichier image d'après sa SIGNATURE (premiers octets), jamais
 * d'après son extension ni le Content-Type envoyé. Liste blanche : JPEG, PNG,
 * WebP, AVIF, GIF ; vidéos (plus bas) ; PDF (bloc CV : `%PDF-` au tout début,
 * sniffPdf). Tout le reste (SVG, HTML…) est refusé.
 * Module pur (sans import) : testé directement par Node (scripts/test-sniff.mjs).
 */

export type ImageType = { mime: string; ext: string; label: string };

export const ACCEPTED_LABEL = "JPEG, PNG, WebP, AVIF, GIF";
export const REJECTED_MESSAGE = `Ce type de fichier n'est pas accepté. Formats possibles : ${ACCEPTED_LABEL}.`;

/** Octets nécessaires à la détection. */
export const SNIFF_BYTES = 64;

const ascii = (b: Uint8Array, start: number, end: number) => String.fromCharCode(...b.subarray(start, end));

export function sniffImage(head: Uint8Array): ImageType | null {
  const b = head;
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg", label: "JPEG" };
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) {
    return { mime: "image/png", ext: "png", label: "PNG" };
  }
  if (b.length >= 6 && (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a")) return { mime: "image/gif", ext: "gif", label: "GIF" };
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return { mime: "image/webp", ext: "webp", label: "WebP" };
  // ISO-BMFF : boîte ftyp en tête ; marque majeure ou compatible avif/avis.
  if (b.length >= 16 && ascii(b, 4, 8) === "ftyp") {
    const size = (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3];
    const end = Math.min(b.length, size > 0 ? size : b.length);
    const brands: string[] = [ascii(b, 8, 12)];
    for (let i = 16; i + 4 <= end; i += 4) brands.push(ascii(b, i, i + 4));
    if (brands.some((x) => x === "avif" || x === "avis")) return { mime: "image/avif", ext: "avif", label: "AVIF" };
  }
  return null;
}

export type VideoType = { container: "mov" | "matroska"; mime: string; ext: string; label: string };

export const VIDEO_ACCEPTED_LABEL = "MP4, MOV, WebM";
export const VIDEO_REJECTED_MESSAGE = `Ce type de fichier n'est pas accepté. Formats vidéo possibles : ${VIDEO_ACCEPTED_LABEL}. Images : ${ACCEPTED_LABEL}. Documents : PDF.`;

/**
 * PDF : « %PDF-1.x » ou « %PDF-2.x » dès le PREMIER octet (la norme tolère
 * des octets devant l'en-tête ; nous non : un polyglotte HTML/PDF ou ZIP/PDF
 * est refusé). La structure est vérifiée ensuite par pdfinfo.
 */
export function sniffPdf(head: Uint8Array): boolean {
  if (head.length < 8) return false;
  return /^%PDF-[12]\.\d/.test(ascii(head, 0, 8));
}

/**
 * Conteneur vidéo d'après la signature : famille ISO-BMFF (MP4, MOV : boîte
 * ftyp, hors marques d'image AVIF/HEIF) ou EBML (WebM, Matroska). À confirmer
 * par ffprobe (piste vidéo réelle).
 */
export function sniffVideo(head: Uint8Array): VideoType | null {
  const b = head;
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) {
    return { container: "matroska", mime: "video/webm", ext: "webm", label: "WebM" };
  }
  if (b.length >= 12 && ascii(b, 4, 8) === "ftyp") {
    const size = (b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3];
    const end = Math.min(b.length, size > 0 ? size : b.length);
    const brands: string[] = [ascii(b, 8, 12)];
    for (let i = 16; i + 4 <= end; i += 4) brands.push(ascii(b, i, i + 4));
    const image = ["avif", "avis", "heic", "heix", "mif1", "msf1"];
    if (brands.every((x) => image.includes(x))) return null;
    if (image.includes(brands[0])) return null;
    const qt = brands[0] === "qt  ";
    return { container: "mov", mime: qt ? "video/quicktime" : "video/mp4", ext: qt ? "mov" : "mp4", label: qt ? "MOV" : "MP4" };
  }
  return null;
}

/**
 * Nom d'origine affichable : sans chemin (« ../ », « C:\ »), sans caractère de
 * contrôle ni de mise en forme bidirectionnelle, 120 caractères au plus.
 */
export function cleanFilename(name: string | null | undefined): string {
  const base = String(name ?? "")
    .split(/[\\/]/)
    .pop()!
    .replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .trim()
    .slice(0, 120);
  return base && base !== "." && base !== ".." ? base : "image";
}
