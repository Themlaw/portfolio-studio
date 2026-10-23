import type { CSSProperties } from "react";
import { getTranslations } from "next-intl/server";
import { z } from "zod";

import MediaFrame from "@/components/MediaFrame";
import Picture from "@/components/Picture";
import { claimEager } from "@/lib/eager";
import ViewerScope from "@/components/ViewerScope";
import { RATIO_VALUES } from "@/lib/images/formats";
import { cropSources } from "@/lib/images/crop";
import { signCrop } from "@/lib/images/crop-cache";
import { resolveCrop } from "@/lib/images/crop-view";
import { coverFactor, parseRatio, scaleSizes } from "@/lib/images/sizes";
import { ORIGINALS_PREFIX } from "@/lib/images/variants";
import { getMedia, mediaUrl } from "@/lib/media";
import { mediaLookAttrs } from "@/lib/look";
import { viewerAttrs } from "@/lib/viewer";

import { AUTO_PANORAMA_RATIO } from "./grid-layouts";

import { BlockCaption, capHost, captionPart } from "./caption";
import { localizedText, mediaRef, tr, type BlockContext } from "./types";

export const imageSchema = z.object({
  mediaId: mediaRef.optional(),
  /** Légende, Titre et Date facultatifs sous l'image (lot 39) ; texte long permis : la ligne revient à la ligne. */
  caption: localizedText.optional(),
  captionTitle: localizedText.optional(),
  captionDate: localizedText.optional(),
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
  /** Agrandir au clic (lot 44) : la visionneuse des images qui défilent. Absent = oui ; `false` la coupe. Dans une grille, l'image n'est dans le défilement que si la grille s'agrandit aussi. */
  zoom: z.boolean().optional(),
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
 * Fond (lot 41) : `look.imageBg` colore la boîte de l'image (derrière un PNG détouré) ; rien par défaut.
 * Cadre (lot 34) : `look.frame` {size, color} pose une bordure dans la boîte de l'image (jamais de rognage de la boîte, ni de
 * changement de sa taille extérieure) ; rien par défaut. Une image seule ne
 * dépasse jamais 85 % de la hauteur de l'écran (CSS `data-solo`, sans rognage ; pas dans une grille, qui fixe
 * elle-même la géométrie de ses cases).
 */
export default async function ImageBlock({ props, ctx }: { props: z.infer<typeof imageSchema>; ctx: BlockContext }) {
  // Avant tout await : l'ordre des réclamations est celui du document (lot 54).
  const eager = claimEager(1) > 0;
  const media = await getMedia(props.mediaId);
  const image = media && !media.video && !media.pdf ? media : null;
  // Toile : la page en vue brouillon, ou une grille de planche (lot 31d : mêmes repères de média et de case que sur une page).
  const canvas = Boolean(ctx.edit || ctx.gridCanvas);
  if (!image && !canvas) return null;
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
  // Grille « Automatique » : un panorama y occupe toute la largeur de la grille (une seule colonne pour le choix de la variante).
  const cols = ctx.cell ? (ctx.cellAuto && natural >= AUTO_PANORAMA_RATIO ? 1 : (ctx.cellColumns ?? 2)) : 1;
  const baseSizes =
    cols > 1
      ? `(min-width: 1236px) ${Math.round(1200 / cols)}px, (min-width: 768px) ${(100 / cols).toFixed(1)}vw, 100vw`
      : ctx.cell || props.width !== "full"
        ? "(min-width: 1236px) 1200px, 100vw"
        : "100vw";
  const caption = props.caption ? tr(props.caption, ctx.locale) : "";
  // Cliquer pour agrandir (lot 44) : public ET Aperçu (lot 64 : l'Aperçu est le rendu de la toile, sans `data-edit-canvas`) ; la toile en édition garde le clic pour éditer (ViewerScope n'ouvre rien tant que `data-edit-canvas` est posé).
  const zoomable = Boolean(image) && !canvas && !ctx.inlineEdit && props.zoom !== false && (!ctx.cell || ctx.cellViewer === true);
  const viewer =
    zoomable && image
      ? viewerAttrs(
          {
            id: `media-${image.id}`,
            image: image.url,
            sources: image.sources ?? undefined,
            alt: image.alt ? tr(image.alt, ctx.locale) : caption,
            width: image.width ?? 1200,
            height: image.height ?? 800,
            title: props.captionTitle ? tr(props.captionTitle, ctx.locale) : "",
            description: caption,
            date: props.captionDate ? tr(props.captionDate, ctx.locale) : undefined,
            plain: true,
          },
          // Le bouton s'annonce avec la description (sinon la légende), puis « Agrandir l'image » (lot 52).
          [image.alt ? tr(image.alt, ctx.locale) : caption, (await getTranslations({ locale: ctx.locale, namespace: "gallery" }))("open")].filter(Boolean).join(" — "),
        )
      : null;
  const ratioAttr = !free && props.ratio && props.ratio !== "auto" ? { "data-ratio": props.ratio } : {};
  const editFull = canvas && image ? { "data-full-src": image.url, "data-full-ratio": natural.toFixed(5), "data-full-px": `${image.width ?? 0}x${image.height ?? 0}` } : {};
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
  // Cadre (lot 34, `look.frame`) et fond (lot 41, `look.imageBg`) : habillage de la boîte de la PHOTO (MediaFrame), jamais d'une place vide ni de la figure.
  const mediaLook = image ? { frame: ctx.look?.frame, bg: ctx.look?.imageBg } : undefined;
  // Format de la boîte : celui de la zone gardée (cadrage libre), sinon le format imposé, sinon celui de l'image (cadrée ou entière).
  const contain = Boolean(image && box && !cover && !free);
  const boxRatio = free || contain ? frameRatio : (box ?? frameRatio);
  const boxLook = mediaLookAttrs({ bg: ctx.look?.imageBg });
  const photo = image ? (
    <MediaFrame
      look={contain ? { frame: ctx.look?.frame } : mediaLook}
      ratio={boxRatio}
      fit={contain ? undefined : "cover"}
      data-edit-media={canvas ? "mediaId" : undefined}
      data-edit-media-kind={canvas ? "image" : undefined}
      {...editFull}
      {...(viewer ?? {})}
    >
      <Picture
        src={image.url}
        sources={cropped ? cropped.sources : image.sources}
        alt={image.alt ? tr(image.alt, ctx.locale) : caption}
        width={cropped ? cropped.width : (image.width ?? 1200)}
        height={cropped ? cropped.height : (image.height ?? 800)}
        sizes={scaleSizes(baseSizes, stretch)}
        className="block-image-media"
        cropped={Boolean(cropped)}
        fallback={fallback}
        priority={eager}
      />
    </MediaFrame>
  ) : null;
  const body = (
    <figure
      className={`block-image ${ctx.cell ? "" : props.width === "text" ? "max-w-2xl" : ""}`}
      data-width={props.width}
      {...capHost(ctx)}
      {...(ctx.cell ? {} : { "data-solo": "" })}
      {...(!ctx.cell && ctx.look?.imageSize ? { "data-size": ctx.look.imageSize } : {})}
      {...(!ctx.cell && ctx.look?.imageAlign ? { "data-align": ctx.look.imageAlign } : {})}
      {...(canvas && forced ? { "data-edit-box": forced } : {})}
      {...(free ? { "data-free": "" } : ratioAttr)}
      style={{ "--ir": shownRatio.toFixed(4) } as CSSProperties}
    >
      {image ? (
        contain ? (
          // « Image entière » dans un format imposé (lot 64) : la case garde son format (bandes vides, fond choisi) ; le cadre entoure la PHOTO.
          <span className="media-box" {...boxLook.attrs} style={{ "--box-r": box!.toFixed(5), ...boxLook.style } as CSSProperties}>
            {photo}
          </span>
        ) : (
          photo
        )
      ) : ctx.edit ? (
        <span className="pe-media-empty" data-edit-media="mediaId" data-edit-media-kind="image" lang="fr">
          <span>Dépose une image ici</span>
          <button type="button" className="pe-empty-action" data-edit-empty-media="mediaId">
            Choisir dans la médiathèque
          </button>
        </span>
      ) : (
        // Case vide d'une grille de planche (ancienne donnée) : le même choix que pour une place libre.
        <span className="pe-media-empty" lang="fr">
          <span>Case vide</span>
          <button type="button" className="pe-empty-action" data-edit-cell-media="image">
            + Image
          </button>
        </span>
      )}
      <BlockCaption as="figcaption" ctx={ctx} title={captionPart(ctx, "captionTitle", props.captionTitle)} legend={captionPart(ctx, "caption", props.caption)} date={captionPart(ctx, "captionDate", props.captionDate)} />
    </figure>
  );
  if (ctx.cell) return body;
  const sectionClass = props.width === "full" ? "block-bleed pt-[var(--section-gap)]" : "shell pt-[var(--section-gap)]";
  return viewer ? (
    <ViewerScope as="section" className={sectionClass}>
      {body}
    </ViewerScope>
  ) : (
    <section className={sectionClass}>{body}</section>
  );
}
