import { z } from "zod";

import Picture from "@/components/Picture";
import { getMedia } from "@/lib/media";

import { inline, localized, mediaRef, tr, type BlockContext } from "./types";

export const imageSchema = z.object({
  mediaId: mediaRef.optional(),
  caption: localized.optional(),
  /** Largeur : colonne de texte, large (cadre du site), pleine largeur. */
  width: z.enum(["text", "wide", "full"]).default("wide"),
});

/**
 * Une image seule (page, conteneur ou cellule de grille). Sur la toile : une
 * place « Dépose une image ici » tant qu'elle n'en a pas, et la barre
 * Remplacer / Retirer au survol (couche d'édition, `data-edit-media`).
 * Publication refusée sans image (registre).
 */
export default async function ImageBlock({ props, ctx }: { props: z.infer<typeof imageSchema>; ctx: BlockContext }) {
  const media = await getMedia(props.mediaId);
  const image = media && !media.video ? media : null;
  if (!image && !ctx.edit) return null;
  const caption = props.caption ? tr(props.caption, ctx.locale) : "";
  const body = (
    <figure className={`block-image ${ctx.cell ? "" : props.width === "text" ? "max-w-2xl" : ""}`} data-width={props.width}>
      {image ? (
        <span className="block" data-edit-media={ctx.edit ? "mediaId" : undefined} data-edit-media-kind={ctx.edit ? "image" : undefined}>
          <Picture
            src={image.url}
            sources={image.sources}
            alt={image.alt ? tr(image.alt, ctx.locale) : caption}
            width={image.width ?? 1200}
            height={image.height ?? 800}
            sizes={ctx.cell ? "(min-width: 768px) 50vw, 100vw" : props.width === "full" ? "100vw" : "(min-width: 1236px) 1200px, 100vw"}
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
