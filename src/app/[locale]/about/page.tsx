import type { Metadata } from "next";
import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";

import Eyebrow from "@/components/Eyebrow";
import { SOCIALS } from "@/components/SiteFooter";
import type { AppLocale } from "@/i18n/routing";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "about.meta" });
  return { title: t("title"), description: t("description") };
}

export default async function Page({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);

  const t = await getTranslations("about");
  const tSite = await getTranslations("site");

  return (
    <section className="shell pt-[clamp(6rem,14vh,10rem)]">
      <div className="grid gap-[clamp(2.5rem,6vw,5rem)] md:grid-cols-12">
        <div className="md:col-span-5 lg:col-span-4">
          <div className="mat md:sticky md:top-28">
            <Image
              src="/artworks/portrait.svg"
              alt={t("portraitAlt")}
              width={900}
              height={1100}
              sizes="(min-width: 768px) 33vw, 100vw"
              className="h-auto w-full rounded-[2px]"
              priority
            />
            <p className="eyebrow pt-3">{t("basedIn")}</p>
          </div>
        </div>

        <div className="md:col-span-7 lg:col-span-7 lg:col-start-6">
          <Eyebrow>{t("eyebrow")}</Eyebrow>
          <h1 className="mt-4 font-display text-[clamp(2.75rem,7vw,5rem)] text-ink">
            {tSite("name")}
          </h1>
          <p className="mt-4 font-caption text-[0.72rem] tracking-[0.2em] uppercase text-secondary">
            {tSite("role")}
          </p>

          <div className="mt-10 space-y-6 text-base leading-relaxed text-ink-soft">
            <p className="text-ink">{t("bio1")}</p>
            <p>{t("bio2")}</p>
            <p>{t("bio3")}</p>
          </div>

          <hr className="rule my-12" />

          <div className="grid gap-10 sm:grid-cols-2">
            <div>
              <Eyebrow>{t("contactEyebrow")}</Eyebrow>
              <a
                href={`mailto:${tSite("email")}`}
                className="link-underline mt-3 block font-display text-xl break-words lg:text-2xl"
              >
                {tSite("email")}
              </a>
              <a className="btn mt-6" href={`mailto:${tSite("email")}`}>
                {t("contactLabel")}
                <span aria-hidden="true">→</span>
              </a>
            </div>

            <div>
              <Eyebrow>{t("socialEyebrow")}</Eyebrow>
              <ul className="mt-3 space-y-2">
                {SOCIALS.map((s) => (
                  <li key={s.label}>
                    <a
                      href={s.href}
                      className="text-ink-soft transition-colors hover:text-primary"
                    >
                      {s.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
