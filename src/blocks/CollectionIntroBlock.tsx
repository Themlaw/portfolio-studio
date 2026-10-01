import { getTranslations } from "next-intl/server";
import { z } from "zod";

import Eyebrow from "@/components/Eyebrow";
import { countCollection, getProjectsForCollection } from "@/lib/gallery";

import { collection, localized, tr, type BlockContext, localizedText } from "./types";

export const collectionIntroSchema = z.object({
  collection,
  eyebrow: localized,
  title: localized,
  intro: localizedText,
  /** Compteurs « N œuvres · M projets » sous l'intro. */
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
      <Eyebrow>{tr(props.eyebrow, ctx.locale)}</Eyebrow>
      <h1 className="mt-4 font-display text-[clamp(2.75rem,8vw,6rem)] text-ink">{tr(props.title, ctx.locale)}</h1>
      <p className="mt-6 text-base leading-relaxed text-ink-soft">{tr(props.intro, ctx.locale)}</p>
    </>
  );

  if (!props.showCounts) {
    return (
      <section className="shell pt-[clamp(6rem,14vh,10rem)]">
        <header className="mb-[clamp(2.5rem,5vw,4rem)] max-w-2xl">{heading}</header>
      </section>
    );
  }

  const tg = await getTranslations("gallery");
  const tp = await getTranslations("projects");
  const [works, projects] = await Promise.all([
    countCollection(props.collection),
    getProjectsForCollection(props.collection, ctx.locale),
  ]);

  return (
    <section className="shell pb-[clamp(1rem,3vw,2rem)] pt-[clamp(6rem,14vh,10rem)]">
      <header className="max-w-2xl">
        {heading}
        <p className="eyebrow mt-6">
          {tg("count", { count: works })} · {tp("count", { count: projects.length })}
        </p>
      </header>
    </section>
  );
}
