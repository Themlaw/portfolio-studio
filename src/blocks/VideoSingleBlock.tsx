import { z } from "zod";

import VideoCard from "@/components/VideoCard";
import { getArtwork, type LocalizedArtwork } from "@/lib/gallery";
import { getMedia } from "@/lib/media";

import { localized, localizedText, mediaRef, textStyle, tr, type BlockContext } from "./types";

/** Identifiant YouTube (11 caractères) : il finit dans l'URL d'une iframe. */
const youtubeId = /^[\w-]{11}$/;

export const videoSingleSchema = z.object({
  /** Vidéo de la médiathèque. */
  mediaId: mediaRef.optional(),
  /** Ou un plan de la collection (emplacement de planche, par son slug) : vidéos YouTube migrées. */
  slot: z.string().regex(/^[a-z0-9-]+$/).max(80).optional(),
  /** Image d'attente (sinon celle de la vidéo). */
  posterMediaId: mediaRef.optional(),
  /** Présentation (ancien nom `look`, repris par la mise en page du lot 2 : migration 0016). */
  variant: z.enum(["feature", "card", "plain"]).default("card"),
  /** Lecteur avec contrôles, ou boucle muette (vidéo de la médiathèque). */
  mode: z.enum(["player", "loop"]).default("player"),
  eyebrow: localized.optional(),
  /** Titre (sinon le texte alternatif de la vidéo, ou le titre du plan). */
  title: localized.optional(),
  description: localizedText.optional(),
});

/** UNE vidéo (v0.13). Sans vidéo : rien en public, « Choisir une vidéo » sur la toile. */
export default async function VideoSingleBlock({ props, ctx }: { props: z.infer<typeof videoSingleSchema>; ctx: BlockContext }) {
  const [hosted, artwork, poster] = await Promise.all([
    getMedia(props.mediaId),
    props.slot && !props.mediaId ? getArtwork(props.slot, ctx.locale) : null,
    getMedia(props.posterMediaId),
  ]);
  let item: LocalizedArtwork | null = null;
  if (hosted?.video) {
    const alt = hosted.alt ? tr(hosted.alt, ctx.locale) : "";
    item = {
      id: `media-${hosted.id}`,
      slug: `media-${hosted.id}`,
      collection: "animation",
      title: alt,
      alt,
      description: "",
      image: hosted.url,
      sources: hosted.sources ?? undefined,
      video: hosted.video,
      width: hosted.width ?? 1280,
      height: hosted.height ?? 720,
      year: 0,
      featured: false,
      duration: hosted.video.durationLabel,
    };
  } else if (artwork) {
    item = artwork.videoId && !youtubeId.test(artwork.videoId) ? { ...artwork, videoId: undefined } : artwork;
  }
  if (item && poster && !poster.video) item = { ...item, image: poster.url, sources: poster.sources ?? undefined, width: poster.width ?? item.width, height: poster.height ?? item.height };
  const texts = {
    eyebrow: props.eyebrow ? tr(props.eyebrow, ctx.locale) : "",
    title: (props.title && tr(props.title, ctx.locale)) || item?.title || "",
    description: (props.description && tr(props.description, ctx.locale)) || item?.description || "",
  };
  const body = item ? (
    <VideoCard item={item} look={props.variant} loop={props.mode === "loop"} texts={texts} edit={ctx.edit} styles={{ description: textStyle(ctx, "description").style }} />
  ) : ctx.edit ? (
    <div className="pe-media-empty pe-media-video" data-edit-media="mediaId" data-edit-media-kind="video" lang="fr">
      <span>Dépose une vidéo ici</span>
      <button type="button" className="pe-empty-action" data-edit-empty-media="mediaId">
        Choisir dans la médiathèque
      </button>
    </div>
  ) : ctx.gridCanvas && ctx.cell ? (
    // Case vide d'une grille de planche (ancienne donnée) : le même choix que pour une place libre.
    <div className="pe-media-empty pe-media-video" lang="fr">
      <span>Case vide</span>
      <button type="button" className="pe-empty-action" data-edit-cell-media="video">
        + Vidéo
      </button>
    </div>
  ) : null;
  if (!body) return null;
  if (ctx.cell) return body;
  return <section className="shell pt-[var(--section-gap)]">{body}</section>;
}
