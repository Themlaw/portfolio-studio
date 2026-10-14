import type { CSSProperties } from "react";
import { z } from "zod";

import Picture from "@/components/Picture";
import { RATIO_VALUES } from "@/lib/images/formats";
import { cropSources } from "@/lib/images/crop";
import { signCrop } from "@/lib/images/crop-cache";
import { resolveCrop } from "@/lib/images/crop-view";
import { coverFactor, parseRatio, scaleSizes } from "@/lib/images/sizes";
import { ORIGINALS_PREFIX } from "@/lib/images/variants";
import { getMedia, mediaUrl } from "@/lib/media";

import { inline, localized, mediaRef, tr, type BlockContext } from "./types";

export const imageSchema = z.object({
  mediaId: mediaRef.optional(),
  caption: localized.optional(),
  /** Largeur : colonne de texte, large (cadre du site), pleine largeur. */
  width: z.enum(["text", "wide", "full"]).default("wide"),
  /** Format imposé (l'image est alors cadrée : « Cadrer » sur la toile). Auto : son format. */
  ratio: z.enum(RATIO_VALUES).optional(),
  /**
   * Dans un cadre au format imposé : « contain » = image entière (bandes vides si besoin), « cover » =
   * cadre rempli (image rognée). Sans choix : entière pour un bloc pleine largeur (un décor
   * panoramique se voit en entier), cadre rempli sinon (comportement d'avant).
   */
  fit: z.enum(["contain", "cover"]).optional(),
});

/**
 * Une image seule (page, conteneur ou cellule de grille). Sur la toile : une
 * place « Dépose une image ici » tant qu'elle n'en a pas, et la barre
 * Remplacer / Retirer au survol (couche d'édition, `data-edit-media`).
 * Publication refusée sans image (registre).
 *
 * Recadrage (lot 17d) : un rectangle libre (`look.crop.mediaId.rect`) donne une
 * variante extraite de l'ORIGINAL ; le cadre prend alors son rapport et ignore le
 * format imposé. Un ancien cadrage (point focal + zoom) dans un cadre au format
 * imposé est servi de la même façon (sa fenêtre), donc net. Une image seule ne
 * dépasse jamais 85 % de la hauteur de l'écran (CSS `data-solo`, sans rognage ; pas dans une grille, qui fixe
 * elle-même la géométrie de ses cases).
 */
export default async function ImageBlock({ props, ctx }: { props: z.infer<typeof imageSchema>; ctx: BlockContext }) {
  const media = await getMedia(props.mediaId);
  const image = media && !media.video && !media.pdf ? media : null;
  if (!image && !ctx.edit) return null;
  const natural = image ? (image.width ?? 1200) / Math.max(1, image.height ?? 800) : 1;
  // Cadre au format imposé (le sien, sinon celui de la grille).
  const forced = props.ratio && props.ratio !== "auto" ? props.ratio : ctx.cell ? ctx.cellRatio : undefined;
  const box = parseRatio(forced);
  const crop = ctx.look?.crop?.mediaId;
  const legacy = Boolean(crop && !crop.rect);
  const fit = props.fit ?? (props.width === "full" && !ctx.cell ? "contain" : "cover");
  const cover = fit === "cover" || legacy;
  const raster = Boolean(image?.sources && image.key.startsWith(ORIGINALS_PREFIX) && image.width && image.height);
  const resolved = image && raster ? resolveCrop(crop, natural, box, cover) : null;
  const cropped = image && resolved ? cropSources({ id: image.id, width: image.width!, height: image.height! }, resolved.rect, signCrop, mediaUrl, image.sources?.color ?? null) : null;
  const free = Boolean(resolved?.free);
  const frameRatio = cropped ? cropped.width / cropped.height : natural;
  // Image entière dans un cadre qui n'a pas son format : rien n'est rogné, pas d'agrandissement à prévoir.
  const stretch = !image || cropped || !cover ? 1 : coverFactor(natural, box, crop?.zoom);
  // Rapport de ce qui est affiché (plafond de hauteur) : le rectangle libre, sinon le cadre imposé, sinon l'image.
  const shownRatio = free ? frameRatio : (box ?? natural);
  const cols = ctx.cell ? (ctx.cellColumns ?? 2) : 1;
  const baseSizes =
    cols > 1
      ? `(min-width: 1236px) ${Math.round(1200 / cols)}px, (min-width: 768px) ${(100 / cols).toFixed(1)}vw, 100vw`
      : ctx.cell || props.width !== "full"
        ? "(min-width: 1236px) 1200px, 100vw"
        : "100vw";
  const caption = props.caption ? tr(props.caption, ctx.locale) : "";
  const ratioAttr = !free && props.ratio && props.ratio !== "auto" ? { "data-ratio": props.ratio } : {};
  const editFull = ctx.edit && image ? { "data-full-src": image.url, "data-full-ratio": natural.toFixed(5), "data-full-px": `${image.width ?? 0}x${image.height ?? 0}` } : {};
  // Repli si la variante recadrée n'est pas prête (générée à la demande, une à la fois) : l'image entière, cadrée en CSS.
  const fallback =
    cropped && image?.sources
      ? {
          src: image.url,
          sources: image.sources,
          width: image.width ?? 1200,
          height: image.height ?? 800,
          sizes: scaleSizes(baseSizes, free && resolved ? 1 / resolved.rect.w : coverFactor(natural, box, crop?.zoom)),
          ...(free && resolved ? { rect: resolved.rect } : {}),
        }
      : undefined;
  const body = (
    <figure
      className={`block-image ${ctx.cell ? "" : props.width === "text" ? "max-w-2xl" : ""}`}
      data-width={props.width}
      {...(ctx.cell ? {} : { "data-solo": "" })}
      {...(ctx.edit && forced ? { "data-edit-box": forced } : {})}
      {...(free ? { "data-free": "" } : { ...ratioAttr, ...(box && !cover ? { "data-fit": "contain" } : {}) })}
      style={{ "--ir": shownRatio.toFixed(4) } as CSSProperties}
    >
      {image ? (
        <span
          className={legacy ? "block-image-frame" : "block"}
          data-edit-media={ctx.edit ? "mediaId" : undefined}
          data-edit-media-kind={ctx.edit ? "image" : undefined}
          {...editFull}
        >
          <Picture
            src={image.url}
            sources={cropped ? cropped.sources : image.sources}
            alt={image.alt ? tr(image.alt, ctx.locale) : caption}
            width={cropped ? cropped.width : (image.width ?? 1200)}
            height={cropped ? cropped.height : (image.height ?? 800)}
            sizes={scaleSizes(baseSizes, stretch)}
            className="block-image-media h-auto w-full rounded-strip"
            cropped={Boolean(cropped)}
            fallback={fallback}
          />
        </span>
      ) : (
        <span className="pe-media-empty" data-edit-media="mediaId" data-edit-media-kind="image" lang="fr">
          <span>Dépose une image ici</span>
          <button type="button" className="pe-empty-action" data-edit-empty-media="mediaId">
            Choisir dans la médiathèque
          </button>
        </span>
      )}
      {(caption || ctx.edit) && (
        <figcaption className="strip-caption mt-3" {...inline(ctx, "caption")} {...(ctx.edit ? { "data-placeholder": "Légende" } : {})}>
          {caption}
        </figcaption>
      )}
    </figure>
  );
  if (ctx.cell) return body;
  return <section className={props.width === "full" ? "pt-[var(--section-gap)]" : "shell pt-[var(--section-gap)]"}>{body}</section>;
}
