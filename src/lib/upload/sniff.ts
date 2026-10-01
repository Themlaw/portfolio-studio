/**
 * Type d'un fichier image d'après sa SIGNATURE (premiers octets), jamais
 * d'après son extension ni le Content-Type envoyé. Liste blanche : JPEG, PNG,
 * WebP, AVIF, GIF. Tout le reste (SVG, HTML, PDF…) est refusé.
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
