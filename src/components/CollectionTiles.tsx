import type { CSSProperties } from "react";

import type { PictureSources } from "@/lib/images/variants";

import Picture, { type CropFallback } from "./Picture";

import { coverFactor, parseRatio, scaleSizes } from "@/lib/images/sizes";
import { MAX_TILES, TILE_GEOMETRY, type TileSize } from "@/blocks/collection-pages";

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
  /** Rapport de ce qui est affiché : borne la largeur de la tuile pour que sa hauteur reste sous le plafond. */
  shownRatio: number;
  /** Liste manuelle : rang de l'entrée dans la liste du bloc (retrait et ordre depuis la toile). */
  itemIndex?: number;
  /** Liste manuelle : la page de l'entrée n'existe plus ou n'est plus publiée (signalée sur la toile, absente en public). */
  broken?: boolean;
  /** Page de collection de l'entrée (couverture choisie sur la tuile, lot 26). */
  pageId?: number;
  /** La couverture a été choisie sur la tuile (sinon : celle de la collection) : « Couverture automatique » la retire. */
  ownCover?: boolean;
  /** Vue brouillon : la collection n'a aucune œuvre publiée (avis dans la tuile, rien en public). */
  empty?: boolean;
  /** Nom de la collection dans l'avis « vide » (Personnages, Décors, Animation). */
  collectionName?: string;
};

export default function CollectionTiles({
  tiles,
  cta,
  ratio,
  size = "medium",
  edit,
  manual,
  itemCount = 0,
  candidates = [],
}: {
  tiles: Tile[];
  cta: string;
  /** Format imposé des images (sinon celui de chaque image). */
  ratio?: string;
  /** Taille des images : part de la largeur et plafond de hauteur (lot 22). */
  size?: TileSize;
  /** Vue brouillon de l'éditeur : repère du cadrage des images. */
  edit?: boolean;
  /** Vue brouillon, entrées choisies à la main : retirer, monter, descendre, ajouter depuis la toile (lot 22). */
  manual?: boolean;
  itemCount?: number;
  /** Pages de collection sans entrée (proposées par « + Ajouter une entrée »). */
  candidates?: { pageId: number; title: string }[];
}) {
  const tools = Boolean(edit && manual);
  const toolbar = (i: number) => (
    <span className="pe-tile-tools" role="group" aria-label="Entrée">
      <button type="button" data-edit-tile-op="up" data-index={i} disabled={i === 0} aria-label="Monter l'entrée" title="Monter l'entrée">↑</button>
      <button type="button" data-edit-tile-op="down" data-index={i} disabled={i >= itemCount - 1} aria-label="Descendre l'entrée" title="Descendre l'entrée">↓</button>
      <button type="button" data-edit-tile-op="remove" data-index={i} className="pe-danger" aria-label="Retirer l'entrée" title="Retirer l'entrée">✕</button>
    </span>
  );
  /** Couverture (lot 26), depuis la tuile : choisir une image, ou revenir à celle de la collection. */
  const coverTools = (tile: Tile) => (
    <span className="pe-tile-cover" role="group" aria-label={`Couverture de l'entrée « ${tile.title} »`}>
      <button type="button" data-edit-tile-op="cover" data-index={tile.itemIndex} data-page-id={tile.pageId} title="Choisir l'image de couverture de cette entrée dans la médiathèque, ou en envoyer une">
        Changer la couverture
      </button>
      {tile.ownCover && (
        <button type="button" data-edit-tile-op="cover-clear" data-index={tile.itemIndex} data-page-id={tile.pageId} title="Reprendre la couverture de la collection">
          Couverture automatique
        </button>
      )}
    </span>
  );
  const fixed = ratio && ratio !== "auto" ? ratio : undefined;
  const geo = TILE_GEOMETRY[size];
  return (
    <div className="tiles flex flex-col gap-[var(--t-space-l)]" data-size={size} {...(fixed ? { "data-ratio": fixed } : {})}>
      {tiles.map((tile) =>
        tile.broken ? (
          <p key={tile.key} data-edit-invalid="" data-tile-broken="" className="pe-tile-broken">
            Cette entrée mène à une page supprimée ou non publiée : elle est masquée sur le site. Choisis une autre page, ou retire-la.
            {tools && tile.itemIndex !== undefined && toolbar(tile.itemIndex)}
          </p>
        ) : tile.empty ? (
          <p key={tile.key} data-edit-invalid="" data-tile-empty="" className="pe-tile-broken">
            Cette collection n&apos;a encore aucune œuvre publiée.{" "}
            <span className="pe-tile-empty-why">
              La tuile « {tile.title || tile.collectionName} » n&apos;apparaît pas sur le site tant que la collection {tile.collectionName ? `« ${tile.collectionName} » ` : ""}est vide : publie une œuvre dans cette collection.
            </span>
            {tools && tile.itemIndex !== undefined && toolbar(tile.itemIndex)}
          </p>
        ) : (
        <Link
          key={tile.key}
          href={tile.href}
          className={`tile mat-hover group grid items-center gap-8 md:grid-cols-12${edit ? " relative" : ""}`}
        >
          {tools && tile.itemIndex !== undefined && toolbar(tile.itemIndex)}
          {edit && coverTools(tile)}
          <div className="tile-img">
            <div className="tile-media mat" style={{ "--ir": tile.shownRatio.toFixed(4) } as CSSProperties}>
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
                  sizes={scaleSizes(geo.sizes, coverFactor(tile.width / Math.max(1, tile.height), parseRatio(fixed), Number(tile.cropStyle?.["--crop-zoom"]) || 1))}
                  className="h-auto w-full rounded-[2px]"
                  cropped={tile.free}
                  fallback={tile.fallback}
                />
              </span>
            </div>
          </div>

          <div className="tile-txt">
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
        ),
      )}
      {tools && (
        <div className="pe-tile-add-row">
          <button type="button" className="pe-tile-add" data-edit-tile-add="" data-candidates={JSON.stringify(candidates)} disabled={itemCount >= MAX_TILES || candidates.length === 0}>
            + Ajouter une entrée
          </button>
          {candidates.length === 0 && itemCount < MAX_TILES && <span className="pe-tile-add-note">Toutes les pages de collection ont déjà une entrée.</span>}
        </div>
      )}
    </div>
  );
}
