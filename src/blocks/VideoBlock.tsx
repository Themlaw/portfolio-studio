import { z } from "zod";

import AnimationShowcase from "@/components/AnimationShowcase";
import { getCollection, getReel, type LocalizedArtwork } from "@/lib/gallery";
import { getMedia } from "@/lib/media";

import { localized, tr, type BlockContext } from "./types";

export const videoSchema = z.object({
  reelEyebrow: localized,
  cardsEyebrow: localized,
  cardsTitle: localized,
  /** Demoreel hébergée (médiathèque) ; absente : la demoreel YouTube de la collection. */
  reelMediaId: z.number().int().positive().optional(),
});

/** Identifiant YouTube (11 caractères) : il finit dans l'URL d'une iframe. */
export const youtubeId = z.string().regex(/^[\w-]{11}$/);

/** Écarte un identifiant vidéo invalide (log) plutôt que de l'injecter. */
function safeVideo<T extends { videoId?: string; slug: string }>(item: T): T {
  if (item.videoId === undefined || youtubeId.safeParse(item.videoId).success) return item;
  console.error(`[blocks] video : identifiant vidéo invalide pour « ${item.slug} », ignoré`);
  return { ...item, videoId: undefined };
}

/** Vitrine animation : la demoreel puis les plans de la collection. */
export default async function VideoBlock({ props, ctx }: { props: z.infer<typeof videoSchema>; ctx: BlockContext }) {
  const [youtubeReel, all, hosted] = await Promise.all([getReel(ctx.locale), getCollection("animation", ctx.locale), getMedia(props.reelMediaId)]);
  // Demoreel hébergée : titre (texte alternatif) et durée viennent du média.
  const reel: LocalizedArtwork | undefined =
    hosted?.video
      ? {
          id: `media-${hosted.id}`,
          slug: `media-${hosted.id}`,
          collection: "animation",
          title: hosted.alt ? tr(hosted.alt, ctx.locale) : "",
          alt: hosted.alt ? tr(hosted.alt, ctx.locale) : "",
          description: "",
          image: hosted.url,
          sources: hosted.sources ?? undefined,
          video: hosted.video,
          width: hosted.width ?? 1280,
          height: hosted.height ?? 720,
          year: 0,
          featured: false,
          duration: hosted.video.durationLabel,
        }
      : youtubeReel && safeVideo(youtubeReel);
  return (
    <section className="shell">
      <AnimationShowcase
        reel={reel}
        items={all.filter((item) => !item.reel).map(safeVideo)}
        texts={{
          reelEyebrow: tr(props.reelEyebrow, ctx.locale),
          cardsEyebrow: tr(props.cardsEyebrow, ctx.locale),
          cardsTitle: tr(props.cardsTitle, ctx.locale),
        }}
      />
    </section>
  );
}
