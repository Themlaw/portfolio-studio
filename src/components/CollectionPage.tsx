import { getTranslations } from "next-intl/server";

import Eyebrow from "@/components/Eyebrow";
import ProjectStrip from "@/components/ProjectStrip";
import type { AppLocale } from "@/i18n/routing";
import {
  countCollection,
  getProjectsForCollection,
  type Collection,
} from "@/lib/gallery";

/**
 * Page de collection (personnages / décors).
 *
 * On n'aligne pas des images en vrac : on empile les projets qui ont
 * demandé ce métier, chacun réduit à ce qu'il en contient. Le lecteur voit
 * pour qui le travail a été fait avant de voir les images.
 */
export default async function CollectionPage({
  collection,
  locale,
}: {
  collection: Exclude<Collection, "animation">;
  locale: AppLocale;
}) {
  const tc = await getTranslations("collections");
  const tg = await getTranslations("gallery");
  const tp = await getTranslations("projects");
  const projects = getProjectsForCollection(collection, locale);

  return (
    <>
      <section className="shell pb-[clamp(1rem,3vw,2rem)] pt-[clamp(6rem,14vh,10rem)]">
        <header className="max-w-2xl">
          <Eyebrow>{tc(`${collection}.eyebrow`)}</Eyebrow>
          <h1 className="mt-4 font-display text-[clamp(2.75rem,8vw,6rem)] text-ink">
            {tc(`${collection}.title`)}
          </h1>
          <p className="mt-6 text-base leading-relaxed text-ink-soft">
            {tc(`${collection}.intro`)}
          </p>
          <p className="eyebrow mt-6">
            {tg("count", { count: countCollection(collection) })} ·{" "}
            {tp("count", { count: projects.length })}
          </p>
        </header>
      </section>

      {projects.map((project, index) => (
        <ProjectStrip
          key={project.slug}
          project={project}
          deep={index % 2 === 1}
        />
      ))}
    </>
  );
}
