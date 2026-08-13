import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import CollectionPage from "@/components/CollectionPage";
import type { AppLocale } from "@/i18n/routing";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale,
    namespace: "collections.backgrounds.meta",
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
  return (
    <CollectionPage collection="backgrounds" locale={locale as AppLocale} />
  );
}
