import Image from "next/image";

import type { PictureSources } from "@/lib/images/variants";

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
}) {
  if (!sources) {
    return <Image src={src} alt={alt} width={width} height={height} sizes={sizes} className={className} priority={priority} />;
  }
  return (
    // display: contents → l'<img> garde la mise en page et les classes prévues.
    <picture style={{ display: "contents" }}>
      {sources.avif && <source type="image/avif" srcSet={largest ? sources.largest.avif : sources.avif} sizes={largest ? undefined : sizes} />}
      <source type="image/webp" srcSet={largest ? sources.largest.webp : sources.webp} sizes={largest ? undefined : sizes} />
      <img
        src={sources.largest.webp}
        alt={alt}
        width={width}
        height={height}
        className={className}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        {...(cropped ? { "data-cropped": "" } : {})}
        fetchPriority={priority ? "high" : undefined}
        style={sources.color ? { backgroundColor: sources.color } : undefined}
      />
    </picture>
  );
}
