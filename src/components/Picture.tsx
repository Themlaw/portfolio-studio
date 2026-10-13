import Image from "next/image";

import type { Rect } from "@/lib/images/crop";
import type { PictureSources } from "@/lib/images/variants";

import CroppedPicture from "./CroppedPicture";
import PictureMarkup from "./PictureMarkup";

/** Image entière servie à la place d'une variante recadrée qui n'a pas pu être préparée (voir CroppedPicture). */
export type CropFallback = {
  src: string;
  sources: PictureSources | null;
  width: number;
  height: number;
  /** `sizes` de l'image entière (plus large que le cadre : la zone gardée en est une partie). */
  sizes?: string;
  /** Recadrage libre : la zone à montrer dans l'image entière (positionnée en CSS). Absent : ancien cadrage, géré par le CSS de la page. */
  rect?: Rect;
};

/**
 * Image publique. Média téléversé : <picture> (AVIF puis WebP en srcset,
 * `sizes` fourni par l'appelant, dimensions, fond = couleur dominante pendant
 * le chargement, chargement différé sauf `priority`). `largest` : seulement la
 * plus grande variante (lightbox). Sans sources (SVG du seed) : la même balise
 * qu'avant (next/image, non optimisée).
 */
export default function Picture({
  src,
  sources,
  alt,
  width,
  height,
  sizes,
  className,
  priority = false,
  largest = false,
  cropped = false,
  fallback,
}: {
  src: string;
  sources?: PictureSources | null;
  alt: string;
  width: number;
  height: number;
  sizes?: string;
  className?: string;
  priority?: boolean;
  largest?: boolean;
  /** Variante recadrée (extraite de l'original) : l'image EST la zone gardée, aucun décalage ni zoom CSS à lui appliquer. */
  cropped?: boolean;
  /** Variante recadrée générée à la demande : si elle échoue (serveur occupé), l'image entière avec son cadrage CSS, puis nouvel essai plus tard. */
  fallback?: CropFallback;
}) {
  if (!sources) {
    return <Image src={src} alt={alt} width={width} height={height} sizes={sizes} className={className} priority={priority} />;
  }
  if (cropped && fallback) {
    return <CroppedPicture sources={sources} alt={alt} width={width} height={height} sizes={sizes} className={className} priority={priority} fallback={fallback} />;
  }
  return <PictureMarkup sources={sources} alt={alt} width={width} height={height} sizes={sizes} className={className} priority={priority} largest={largest} cropped={cropped} />;
}
