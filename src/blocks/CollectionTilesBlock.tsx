import { getTranslations } from "next-intl/server";
import { z } from "zod";

import CollectionTiles, { type Tile } from "@/components/CollectionTiles";
import Eyebrow from "@/components/Eyebrow";
import { countCollection, getCollectionCover } from "@/lib/gallery";
import { cropSources } from "@/lib/images/crop";
import { scaleSizes } from "@/lib/images/sizes";
import { signCrop } from "@/lib/images/crop-cache";
import { cropVars } from "@/lib/look";
import { mediaUrl } from "@/lib/media";
import { hrefForPage } from "@/lib/pages";

import { collection, inline, localized, pageRef, tr, type BlockContext, localizedText } from "./types";

export const collectionTilesSchema = z.object({
  eyebrow: localized,
  title: localized,
  /** Format imposé des images (elles sont alors cadrées : « Cadrer » sur la toile). Auto : leur format. */
  ratio: z.enum(["auto", "16:9", "3:2", "4:3", "1:1", "4:5"]).optional(),
  items: z.array(
    z.object({ collection, pageId: pageRef, eyebrow: localized, title: localized, intro: localizedText }),
  ).max(12),
});

export default async function CollectionTilesBlock({
  props,
  ctx,
}: {
  props: z.infer<typeof collectionTilesSchema>;
  ctx: BlockContext;
}) {
  const t = await getTranslations("home.collections");
  const tg = await getTranslations("gallery");

  const tiles: Tile[] = [];
  for (const item of props.items) {
    const cover = await getCollectionCover(item.collection, ctx.locale);
    if (!cover) continue;
    const crop = ctx.look?.tileCrop?.[item.collection];
    // Recadrage libre (lot 17d) : variante extraite de l'ORIGINAL de la couverture ; la tuile prend le rapport du rectangle.
    const free = crop?.rect && cover.mediaId && cover.sources && !cover.video ? cropSources({ id: cover.mediaId, width: cover.width, height: cover.height }, crop.rect, signCrop, mediaUrl, cover.sources.color) : null;
    tiles.push({
      key: item.collection,
      ...(crop && !crop.rect ? { cropStyle: cropVars(crop) } : {}),
      ...(free ? { free: true } : {}),
      ...(free && crop?.rect && cover.sources
        ? { fallback: { src: cover.image, sources: cover.sources, width: cover.width, height: cover.height, sizes: scaleSizes("(min-width: 768px) 66vw, 100vw", 1 / crop.rect.w), rect: crop.rect } }
        : {}),
      ...(ctx.edit && cover.mediaId && cover.sources && !cover.video ? { full: { src: cover.image, ratio: cover.width / Math.max(1, cover.height), w: cover.width, h: cover.height } } : {}),
      href: await hrefForPage(item.pageId, ctx.locale),
      eyebrow: tr(item.eyebrow, ctx.locale),
      title: tr(item.title, ctx.locale),
      intro: tr(item.intro, ctx.locale),
      count: tg("count", { count: await countCollection(item.collection) }),
      image: cover.image,
      sources: free ? free.sources : cover.sources,
      imageAlt: cover.alt,
      width: free ? free.width : cover.width,
      height: free ? free.height : cover.height,
    });
  }

  return (
    <section className="shell pt-[var(--section-gap)]">
      <header className="title-head mb-[var(--t-space-l)] max-w-2xl">
        <Eyebrow {...inline(ctx, "eyebrow")}>{tr(props.eyebrow, ctx.locale)}</Eyebrow>
        <h2 className="mt-4 font-display text-[clamp(2.25rem,6vw,4.5rem)] text-ink" {...inline(ctx, "title")}>
          {tr(props.title, ctx.locale)}
        </h2>
      </header>
      <CollectionTiles tiles={tiles} cta={t("view")} ratio={props.ratio} edit={ctx.edit} />
    </section>
  );
}
