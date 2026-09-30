import { z } from "zod";

import AnimationShowcase from "@/components/AnimationShowcase";
import { getCollection, getReel } from "@/lib/gallery";

import { localized, tr, type BlockContext } from "./types";

export const videoSchema = z.object({
  reelEyebrow: localized,
  cardsEyebrow: localized,
  cardsTitle: localized,
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
  const [reel, all] = await Promise.all([getReel(ctx.locale), getCollection("animation", ctx.locale)]);
  return (
    <section className="shell">
      <AnimationShowcase
        reel={reel && safeVideo(reel)}
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
