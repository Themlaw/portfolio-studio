import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import AnimationShowcase from "@/components/AnimationShowcase";
import Eyebrow from "@/components/Eyebrow";
import type { AppLocale } from "@/i18n/routing";
import { getCollection, getReel } from "@/lib/gallery";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale,
    namespace: "collections.animation.meta",
  });
  return { title: t("title"), description: t("description") };
}

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);

  const tc = await getTranslations("collections.animation");
  const reel = getReel(locale as AppLocale);
  const items = getCollection("animation", locale as AppLocale).filter(
    (item) => !item.reel,
  );

  return (
    <section className="shell pt-[clamp(6rem,14vh,10rem)]">
      <header className="mb-[clamp(2.5rem,5vw,4rem)] max-w-2xl">
        <Eyebrow>{tc("eyebrow")}</Eyebrow>
        <h1 className="mt-4 font-display text-[clamp(2.75rem,8vw,6rem)] text-ink">
          {tc("title")}
        </h1>
        <p className="mt-6 text-base leading-relaxed text-ink-soft">
          {tc("intro")}
        </p>
      </header>

      <AnimationShowcase reel={reel} items={items} />
    </section>
  );
}
