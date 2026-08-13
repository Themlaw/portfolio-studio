import { getTranslations, setRequestLocale } from "next-intl/server";

import CollectionTiles, { type Tile } from "@/components/CollectionTiles";
import Eyebrow from "@/components/Eyebrow";
import Hero from "@/components/Hero";
import ProjectStrip from "@/components/ProjectStrip";
import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import {
  countCollection,
  getCollectionCover,
  getFeaturedProjects,
  type Collection,
} from "@/lib/gallery";

const TILES: { collection: Collection; href: Tile["href"] }[] = [
  { collection: "characters", href: "/characters" },
  { collection: "backgrounds", href: "/backgrounds" },
  { collection: "animation", href: "/animation" },
];

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);

  const t = await getTranslations("home");
  const tc = await getTranslations("collections");
  const tg = await getTranslations("gallery");
  const tSite = await getTranslations("site");

  const projects = getFeaturedProjects(locale as AppLocale, 2);

  const tiles: Tile[] = TILES.flatMap(({ collection, href }) => {
    const cover = getCollectionCover(collection, locale as AppLocale);
    if (!cover) return [];
    return [
      {
        href,
        eyebrow: tc(`${collection}.eyebrow`),
        title: tc(`${collection}.title`),
        intro: tc(`${collection}.intro`),
        count: tg("count", { count: countCollection(collection) }),
        image: cover.image,
        imageAlt: cover.title,
        width: cover.width,
        height: cover.height,
      },
    ];
  });

  return (
    <>
      <Hero />

      <section className="shell pt-[var(--section-gap)]">
        <header className="mb-[clamp(2.5rem,5vw,4rem)] max-w-2xl">
          <Eyebrow>{t("collections.eyebrow")}</Eyebrow>
          <h2 className="mt-4 font-display text-[clamp(2.25rem,6vw,4.5rem)] text-ink">
            {t("collections.title")}
          </h2>
        </header>
        <CollectionTiles tiles={tiles} cta={t("collections.view")} />
      </section>

      <section className="shell pt-[var(--section-gap)]">
        <header className="max-w-2xl">
          <Eyebrow>{t("projects.eyebrow")}</Eyebrow>
          <h2 className="mt-4 font-display text-[clamp(2rem,5vw,3.75rem)] text-ink">
            {t("projects.title")}
          </h2>
          <p className="mt-5 text-base leading-relaxed text-ink-soft">
            {t("projects.intro")}
          </p>
        </header>
      </section>

      {projects.map((project, index) => (
        <ProjectStrip
          key={project.slug}
          project={project}
          deep={index % 2 === 0}
        />
      ))}

      <section className="shell">
        <Link className="link-underline text-sm" href="/characters">
          {t("projects.more")} <span aria-hidden="true">→</span>
        </Link>
      </section>

      <section className="shell pt-[var(--section-gap)]">
        <div className="rounded-lg border border-line bg-surface px-[clamp(1.5rem,5vw,4rem)] py-[clamp(2.5rem,6vw,4.5rem)] text-center shadow-card">
          <Eyebrow>{t("contact.eyebrow")}</Eyebrow>
          <h2 className="mx-auto mt-4 max-w-2xl font-display text-[clamp(2rem,5vw,3.5rem)] text-ink">
            {t("contact.title")}
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-sm leading-relaxed text-ink-soft">
            {t("contact.intro")}
          </p>
          <a className="btn mt-8" href={`mailto:${tSite("email")}`}>
            {t("contact.cta")}
            <span aria-hidden="true">→</span>
          </a>
        </div>
      </section>
    </>
  );
}
