import { getTranslations } from "next-intl/server";
import { z } from "zod";

import Eyebrow from "@/components/Eyebrow";
import { boardWorkCount } from "@/lib/gallery";

import { ownLayoutOf } from "./board-layout";
import { boardRefs, countKey, pageCounts } from "./tree";
import { collection, inline, localized, textStyle, tr, type BlockContext, localizedText } from "./types";

export const collectionIntroSchema = z.object({
  collection,
  eyebrow: localized,
  title: localized,
  intro: localizedText,
  /**
   * Compteurs « N œuvres · M projets » sous l'intro, calculés depuis la page :
   * M = planches de projet présentes (conteneurs compris), N = images et
   * vidéos qu'elles affichent (places vides exclues).
   */
  showCounts: z.boolean().default(true),
});

/**
 * En-tête d'une page de collection. Avec compteurs : suivi des planches de
 * projet ; sans (animation) : la marge basse sépare de la vitrine qui suit.
 */
export default async function CollectionIntroBlock({
  props,
  ctx,
}: {
  props: z.infer<typeof collectionIntroSchema>;
  ctx: BlockContext;
}) {
  const heading = (
    <>
      <Eyebrow {...inline(ctx, "eyebrow")}>{tr(props.eyebrow, ctx.locale)}</Eyebrow>
      <h1 className="mt-4 font-display text-[clamp(2.75rem,8vw,6rem)] text-ink" {...inline(ctx, "title")}>
        {tr(props.title, ctx.locale)}
      </h1>
      <p className="mt-6 text-base leading-relaxed text-ink-soft" {...inline(ctx, "intro")}>
        {tr(props.intro, ctx.locale)}
      </p>
    </>
  );

  if (!props.showCounts) {
    return (
      <section className="page-top shell">
        <header className="page-head mb-[var(--t-space-l)] max-w-2xl">{heading}</header>
      </section>
    );
  }

  const tg = await getTranslations("gallery");
  const tp = await getTranslations("projects");
  // Compté depuis le contenu de la page (brouillon sur la toile, version publiée en ligne).
  const blocks = ctx.pageBlocks ?? [];
  const known = new Map<string, number | null>();
  await Promise.all(
    boardRefs(blocks).map(async (b) => {
      const key = countKey(b.slug, b.collection, b.block);
      if (!known.has(key)) known.set(key, null);
      known.set(key, await boardWorkCount(b.slug, b.collection, ownLayoutOf(b.block.props)));
    }),
  );
  const counts = pageCounts(blocks, (slug, c, block) => known.get(countKey(slug, c, block)) ?? null);

  return (
    <section className="page-top shell pb-[clamp(1rem,3vw,2rem)]">
      <header className="page-head max-w-2xl">
        {heading}
        <p className="eyebrow mt-6" {...(ctx.edit ? { title: "Compté automatiquement depuis les projets de cette page", "data-edit-counter": "", "data-look-key": "counts" } : {})} {...textStyle(ctx, "counts")}>
          {tg("count", { count: counts.works })} · {tp("count", { count: counts.projects })}
        </p>
      </header>
    </section>
  );
}
