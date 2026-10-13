import type { PictureSources } from "@/lib/images/variants";

import Picture, { type CropFallback } from "./Picture";

import { coverFactor, parseRatio, scaleSizes } from "@/lib/images/sizes";

import Eyebrow from "@/components/Eyebrow";
import { Link } from "@/i18n/navigation";

export type Tile = {
  /** Collection montrée (clé du cadrage de la tuile, `look.tileCrop`). */
  key: string;
  /** Variables de cadrage (`--crop-pos`, `--crop-zoom`) : point focal et zoom choisis sur la toile. */
  cropStyle?: Record<string, string>;
  /** Recadrage libre : l'image est la zone gardée (variante extraite de l'original), la tuile prend son rapport. */
  free?: boolean;
  /** Recadrage libre : l'image entière à montrer si la variante recadrée n'est pas prête. */
  fallback?: CropFallback;
  /** Vue brouillon : l'image ENTIÈRE de la couverture (modale « Cadrer l'image »). */
  full?: { src: string; ratio: number; w: number; h: number };
  /** Chemin sans langue, résolu depuis la page cible en base. */
  href: string;
  eyebrow: string;
  title: string;
  intro: string;
  count: string;
  image: string;
  sources?: PictureSources;
  imageAlt: string;
  width: number;
  height: number;
};

export default function CollectionTiles({
  tiles,
  cta,
  ratio,
  edit,
}: {
  tiles: Tile[];
  cta: string;
  /** Format imposé des images (sinon celui de chaque image). */
  ratio?: string;
  /** Vue brouillon de l'éditeur : repère du cadrage des images. */
  edit?: boolean;
}) {
  const fixed = ratio && ratio !== "auto" ? ratio : undefined;
  return (
    <div className="tiles flex flex-col gap-[var(--t-space-l)]" {...(fixed ? { "data-ratio": fixed } : {})}>
      {tiles.map((tile, index) => (
        <Link
          key={tile.href}
          href={tile.href}
          className="tile mat-hover group grid items-center gap-8 md:grid-cols-12"
        >
          <div
            className={`md:col-span-8 ${
              index % 2 === 1 ? "md:order-2 md:col-start-5" : ""
            }`}
          >
            <div className="tile-media mat">
              <span
                className="tile-frame"
                style={tile.cropStyle}
                {...(tile.cropStyle ? { "data-crop": "" } : {})}
                {...(tile.free ? { "data-free": "" } : {})}
                {...(edit && (fixed || tile.full) ? { "data-edit-tile": tile.key } : {})}
                {...(edit && tile.full ? { "data-full-src": tile.full.src, "data-full-ratio": tile.full.ratio.toFixed(5), "data-full-px": `${tile.full.w}x${tile.full.h}` } : {})}
              >
                <Picture
                  src={tile.image}
                  sources={tile.sources}
                  alt={tile.imageAlt}
                  width={tile.width}
                  height={tile.height}
                  // Image rognée par le format imposé et zoomée par le cadrage : affichée plus large que sa tuile.
                  sizes={scaleSizes("(min-width: 768px) 66vw, 100vw", coverFactor(tile.width / Math.max(1, tile.height), parseRatio(fixed), Number(tile.cropStyle?.["--crop-zoom"]) || 1))}
                  className="h-auto w-full rounded-[2px]"
                  cropped={tile.free}
                  fallback={tile.fallback}
                />
              </span>
            </div>
          </div>

          <div
            className={`md:col-span-4 ${
              index % 2 === 1 ? "md:order-1 md:row-start-1" : ""
            }`}
          >
            <Eyebrow>{tile.eyebrow}</Eyebrow>
            <h3 className="mt-3 font-display text-[clamp(2rem,4.4vw,3.25rem)] text-ink transition-colors group-hover:text-primary">
              {tile.title}
            </h3>
            <p className="mt-4 text-sm leading-relaxed text-ink-soft">
              {tile.intro}
            </p>
            <p className="eyebrow mt-6 flex items-center gap-2">
              {cta}
              <span
                aria-hidden="true"
                className="transition-transform duration-500 ease-soft group-hover:translate-x-1"
              >
                →
              </span>
            </p>
            <p className="eyebrow mt-2">{tile.count}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}
