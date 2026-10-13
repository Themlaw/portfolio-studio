/**
 * Mémoire de décodage d'une image (module pur, utilisable côté client).
 *
 * Un PNG classique ou un JPEG de base se décodent en flux (quelques lignes en
 * mémoire, quelle que soit la taille). Un PNG entrelacé (Adam7), un JPEG
 * progressif, un AVIF/HEIF ou un WebP ne se lisent qu'entiers : leur image
 * décodée tient en mémoire, et le conteneur (1 Gio, serveur compris) ne le
 * supporte pas au-delà de quelques centaines de Mo. On l'estime depuis
 * l'en-tête et on refuse AVANT de décoder, avec un message qui dit quoi faire.
 */

export type DecodeMeta = {
  format?: string;
  width: number;
  height: number;
  channels?: number;
  depth?: string;
  isProgressive?: boolean;
};

/** Plafond de la mémoire de décodage d'une image, en Mo (le conteneur : 1 Gio, serveur et encodeurs compris). */
export function decodeBudgetMb(): number {
  return Math.max(50, Number(process.env.IMAGE_DECODE_BUDGET_MB || 350));
}

/** Octets décodés par pixel pour un format lu en entier ; 0 = lu en flux (mémoire négligeable). */
function bytesPerPixel(meta: DecodeMeta): number {
  const channels = meta.channels ?? 4;
  switch (meta.format) {
    case "png":
      return meta.isProgressive ? channels * (meta.depth === "ushort" ? 2 : 1) : 0;
    case "jpeg":
      // Progressif : coefficients DCT de toute l'image (2 octets × composantes).
      return meta.isProgressive ? 6 : 0;
    case "heif":
    case "avif":
      return 6;
    default:
      // WebP, GIF, TIFF… : image décodée d'un bloc (RGBA 8 bits, 16 bits sinon).
      return 4 * (meta.depth === "ushort" ? 2 : 1);
  }
}

/** Mémoire estimée (Mo) du décodage ; 0 si l'image est lue en flux. */
export function decodeMemoryMb(meta: DecodeMeta): number {
  return Math.round((meta.width * meta.height * bytesPerPixel(meta)) / 1e6);
}

/** Message à l'artiste si l'image est trop lourde à décoder, sinon null. */
export function decodeProblem(meta: DecodeMeta): string | null {
  const mb = decodeMemoryMb(meta);
  const budget = decodeBudgetMb();
  if (mb <= budget) return null;
  const advice =
    meta.format === "png"
      ? "Réexporte-la en PNG non entrelacé (décoche « Entrelacé »), ou en JPEG."
      : meta.format === "jpeg"
        ? "Réexporte-la en JPEG de base (non progressif)."
        : "Réexporte-la en PNG ou en JPEG, ou réduis-la.";
  return `Cette image est trop lourde à ouvrir (${mb} Mo de mémoire, ${budget} Mo au plus pour ce format). ${advice}`;
}

/** Image à partir de laquelle son traitement est « lourd » (Mpx) : exclusion mutuelle avec les kits (src/lib/jobs/memory-gate.ts). */
export function heavyImageMpx(): number {
  return Math.max(1, Number(process.env.IMAGE_HEAVY_MPX || 16));
}

/**
 * Le traitement de cette image pèse-t-il sur la mémoire du conteneur ? Oui au-delà de `heavyImageMpx` pixels
 * (tampons de réduction et d'encodage), ou si elle se décode d'un bloc (> 100 Mo) ; sans dimensions lisibles, par prudence.
 */
export function isHeavyImage(meta: DecodeMeta): boolean {
  if (!meta.width || !meta.height) return true;
  return (meta.width * meta.height) / 1e6 > heavyImageMpx() || decodeMemoryMb(meta) > 100;
}
