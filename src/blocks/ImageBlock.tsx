import { z } from "zod";

import Picture from "@/components/Picture";
import { coverFactor, parseRatio, scaleSizes } from "@/lib/images/sizes";
import { getMedia } from "@/lib/media";

import { inline, localized, mediaRef, tr, type BlockContext } from "./types";

export const imageSchema = z.object({
  mediaId: mediaRef.optional(),
  caption: localized.optional(),
  /** Largeur : colonne de texte, large (cadre du site), pleine largeur. */
  width: z.enum(["text", "wide", "full"]).default("wide"),
  /** Format imposé (l'image est alors cadrée : « Cadrer » sur la toile). Auto : son format. */
  ratio: z.enum(["auto", "16:9", "4:3", "1:1", "4:5", "3:4"]).optional(),
});

/**
 * Une image seule (page, conteneur ou cellule de grille). Sur la toile : une
 * place « Dépose une image ici » tant qu'elle n'en a pas, et la barre
 * Remplacer / Retirer au survol (couche d'édition, `data-edit-media`).
 * Publication refusée sans image (registre).
 */
export default async function ImageBlock({ props, ctx }: { props: z.infer<typeof imageSchema>; ctx: BlockContext }) {
  const media = await getMedia(props.mediaId);
  const image = media && !media.video && !media.pdf ? media : null;
  if (!image && !ctx.edit) return null;
  // Cadre au format imposé (le sien, sinon celui de la grille) + zoom du cadrage : l'image est
  // affichée plus large que son cadre, `sizes` doit en tenir compte (variante nette).
  const box = parseRatio(props.ratio && props.ratio !== "auto" ? props.ratio : ctx.cell ? ctx.cellRatio : undefined);
  const stretch = image ? coverFactor((image.width ?? 1200) / Math.max(1, image.height ?? 800), box, ctx.look?.crop?.mediaId?.zoom) : 1;
  const cols = ctx.cell ? (ctx.cellColumns ?? 2) : 1;
  const baseSizes =
    cols > 1
      ? `(min-width: 1236px) ${Math.round(1200 / cols)}px, (min-width: 768px) ${(100 / cols).toFixed(1)}vw, 100vw`
      : ctx.cell || props.width !== "full"
        ? "(min-width: 1236px) 1200px, 100vw"
        : "100vw";
  const caption = props.caption ? tr(props.caption, ctx.locale) : "";
  const body = (
    <figure className={`block-image ${ctx.cell ? "" : props.width === "text" ? "max-w-2xl" : ""}`} data-width={props.width} {...(props.ratio && props.ratio !== "auto" ? { "data-ratio": props.ratio } : {})}>
      {image ? (
        <span className={ctx.look?.crop?.mediaId ? "block-image-frame" : "block"} data-edit-media={ctx.edit ? "mediaId" : undefined} data-edit-media-kind={ctx.edit ? "image" : undefined}>
          <Picture
            src={image.url}
            sources={image.sources}
            alt={image.alt ? tr(image.alt, ctx.locale) : caption}
            width={image.width ?? 1200}
            height={image.height ?? 800}
            sizes={scaleSizes(baseSizes, stretch)}
            className="block-image-media h-auto w-full rounded-strip"
          />
        </span>
      ) : (
        <span className="pe-media-empty" data-edit-media="mediaId" data-edit-media-kind="image" lang="fr">
          Dépose une image ici
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
