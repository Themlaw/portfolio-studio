import type { CSSProperties, Ref } from "react";

import type { PictureSources } from "@/lib/images/variants";

/**
 * Balise <picture> d'une image téléversée (AVIF puis WebP en srcset, fond = couleur dominante pendant le
 * chargement). Partagée par Picture (serveur) et CroppedPicture (client, repli d'un recadrage) : même HTML.
 */
export default function PictureMarkup({
  sources,
  alt,
  width,
  height,
  sizes,
  className,
  priority = false,
  largest = false,
  cropped = false,
  style,
  imgRef,
  onError,
  onLoad,
  eager = false,
  hidden = false,
}: {
  sources: PictureSources;
  alt: string;
  width: number;
  height: number;
  sizes?: string;
  className?: string;
  priority?: boolean;
  largest?: boolean;
  cropped?: boolean;
  style?: CSSProperties;
  imgRef?: Ref<HTMLImageElement>;
  onError?: () => void;
  onLoad?: () => void;
  /** Chargement immédiat sans priorité élevée (sonde de repli). */
  eager?: boolean;
  hidden?: boolean;
}) {
  return (
    // display: contents → l'<img> garde la mise en page et les classes prévues.
    <picture style={{ display: "contents" }}>
      {sources.avif && <source type="image/avif" srcSet={largest ? sources.largest.avif : sources.avif} sizes={largest ? undefined : sizes} />}
      <source type="image/webp" srcSet={largest ? sources.largest.webp : sources.webp} sizes={largest ? undefined : sizes} />
      <img
        ref={imgRef}
        src={sources.largest.webp}
        alt={alt}
        width={width}
        height={height}
        className={className}
        loading={priority || eager ? "eager" : "lazy"}
        decoding="async"
        {...(cropped ? { "data-cropped": "" } : {})}
        {...(hidden ? { "aria-hidden": true } : {})}
        fetchPriority={priority ? "high" : undefined}
        onError={onError}
        onLoad={onLoad}
        style={{ ...(sources.color ? { backgroundColor: sources.color } : {}), ...style }}
      />
    </picture>
  );
}
