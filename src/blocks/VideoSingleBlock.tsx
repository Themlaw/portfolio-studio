import { z } from "zod";

import VideoCard from "@/components/VideoCard";
import { getArtwork, type LocalizedArtwork } from "@/lib/gallery";
import { parseRatio } from "@/lib/images/sizes";
import { getMedia } from "@/lib/media";
import { viewerAttrs } from "@/lib/viewer";

import { localized, localizedText, mediaRef, textStyle, tr, type BlockContext } from "./types";
import { withSound } from "./video-sound";
import { editI18n } from "./edit-i18n";

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
  /**
   * Lecture choisie par l'illustratrice (lot 36) : « loop » = Boucle (muette, sur place, un clic met en pause) ;
   * « player » = Lecteur (image d'attente, un clic ouvre la vidéo en grand). Migration 0027 : toute vidéo existante
   * reçoit explicitement le mode qui équivaut à son comportement d'avant.
   */
  mode: z.enum(["player", "loop"]).default("player"),
  /**
   * Son au départ (lot 127) : « off » = la vidéo démarre muette (le bouton son la remet) ; absent = activé (le défaut, jamais écrit : « Activé » retire
   * le champ). Sans effet pour une vidéo sans son.
   */
  sound: z.enum(["on", "off"]).optional(),
  eyebrow: localized.optional(),
  /** Titre (sinon le texte alternatif de la vidéo, ou le titre du plan). */
  title: localized.optional(),
  description: localizedText.optional(),
  /**
   * Titre et Date facultatifs sous la vidéo (lot 39). La Légende est `description`. Dans la présentation « Vidéo seule » les trois
   * se posent sous la vidéo (composant commun) ; « Carte » et « Mise en avant » gardent leur titre et leur légende, et reçoivent la date.
   */
  captionTitle: localizedText.optional(),
  captionDate: localizedText.optional(),
});

/** UNE vidéo (v0.13). Sans vidéo : rien en public, « Choisir une vidéo » sur la toile. */
export default async function VideoSingleBlock({ props, ctx }: { props: z.infer<typeof videoSingleSchema>; ctx: BlockContext }) {
  const { ta, lang } = await editI18n({ edit: Boolean(ctx.edit || ctx.gridCanvas) });
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
      video: withSound(hosted.video, props.sound),
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
    captionTitle: props.captionTitle ? tr(props.captionTitle, ctx.locale) : "",
    date: props.captionDate ? tr(props.captionDate, ctx.locale) : "",
  };
  const body = item ? (
    <VideoCard
      item={item}
      look={props.variant}
      mode={props.mode}
      texts={texts}
      edit={ctx.edit}
      // Habillage : le même que celui d'une photo (cadre, fond, arrondi) ; format : celui de la grille de la case, sinon celui de la vidéo (lot 64).
      mediaLook={{ frame: ctx.look?.frame, bg: ctx.look?.imageBg }}
      ratio={ctx.cell ? (parseRatio(ctx.cellRatio) ?? undefined) : undefined}
      solo={!ctx.cell}
      marks={Boolean(ctx.edit || ctx.inlineEdit)}
      prefix={ctx.inlinePrefix}
      styles={{ eyebrow: textStyle(ctx, "eyebrow").style, title: textStyle(ctx, "title").style, description: textStyle(ctx, "description").style, captionTitle: textStyle(ctx, "captionTitle").style, captionDate: textStyle(ctx, "captionDate").style }}
    />
  ) : ctx.edit ? (
    <div className="pe-media-empty pe-media-video" data-edit-media="mediaId" data-edit-media-kind="video" lang={lang}>
      <span>{ta("dropVideo")}</span>
      <button type="button" className="pe-empty-action" data-edit-empty-media="mediaId">
        {ta("pickFromLibrary")}
      </button>
    </div>
  ) : ctx.gridCanvas && ctx.cell ? (
    // Case vide d'une grille de planche (ancienne donnée) : le même choix que pour une place libre.
    <div className="pe-media-empty pe-media-video" lang={lang}>
      <span>{ta("emptyCell")}</span>
      <button type="button" className="pe-empty-action" data-edit-cell-media="video">
        {ta("addVideo")}
      </button>
    </div>
  ) : null;
  if (!body) return null;
  // Dans une grille qui s'agrandit au clic (lot 44) : une vidéo hébergée fait partie du défilement de la visionneuse (le lecteur
  // ou la pause en boucle gardent leur clic). Une vidéo YouTube n'a pas de fichier à montrer : hors du défilement.
  if (ctx.cell && ctx.cellViewer && !ctx.edit && !ctx.inlineEdit && !ctx.gridCanvas && item?.video) {
    return (
      <div style={{ display: "contents" }} {...viewerAttrs({ id: item.id, image: item.image, sources: item.sources, alt: item.alt, width: item.width, height: item.height, title: texts.captionTitle || texts.title, description: texts.description, date: texts.date || undefined, video: item.video, plain: true }, "", true)}>
        {body}
      </div>
    );
  }
  if (ctx.cell) return body;
  return <section className="shell pt-[var(--section-gap)]">{body}</section>;
}
