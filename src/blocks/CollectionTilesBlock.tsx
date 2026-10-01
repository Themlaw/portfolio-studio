import { getTranslations } from "next-intl/server";
import { z } from "zod";

import CollectionTiles, { type Tile } from "@/components/CollectionTiles";
import Eyebrow from "@/components/Eyebrow";
import { countCollection, getCollectionCover } from "@/lib/gallery";
import { hrefForPage } from "@/lib/pages";

import { collection, inline, localized, pageRef, tr, type BlockContext, localizedText } from "./types";

export const collectionTilesSchema = z.object({
  eyebrow: localized,
  title: localized,
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
    tiles.push({
      href: await hrefForPage(item.pageId, ctx.locale),
      eyebrow: tr(item.eyebrow, ctx.locale),
      title: tr(item.title, ctx.locale),
      intro: tr(item.intro, ctx.locale),
      count: tg("count", { count: await countCollection(item.collection) }),
      image: cover.image,
      sources: cover.sources,
      imageAlt: cover.alt,
      width: cover.width,
      height: cover.height,
    });
  }

  return (
    <section className="shell pt-[var(--section-gap)]">
      <header className="mb-[clamp(2.5rem,5vw,4rem)] max-w-2xl">
        <Eyebrow {...inline(ctx, "eyebrow")}>{tr(props.eyebrow, ctx.locale)}</Eyebrow>
        <h2 className="mt-4 font-display text-[clamp(2.25rem,6vw,4.5rem)] text-ink" {...inline(ctx, "title")}>
          {tr(props.title, ctx.locale)}
        </h2>
      </header>
      <CollectionTiles tiles={tiles} cta={t("view")} />
    </section>
  );
}
