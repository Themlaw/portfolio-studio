import type { Metadata } from "next";
import { setRequestLocale } from "next-intl/server";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { Link } from "@/i18n/navigation";
import type { AppLocale } from "@/i18n/routing";
import Picture from "@/components/Picture";
import CvPages from "@/components/CvPages";
import VideoCard from "@/components/VideoCard";
import { getMedia } from "@/lib/media";
import { readPublicShareLink } from "@/lib/edit/share-links";
import { downloadName } from "@/lib/pdf/limits";
import type { LocalizedArtwork } from "@/lib/gallery";

export const dynamic = "force-dynamic";

type Params = Promise<{ locale: string; slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, slug } = await params;
  const link = readPublicShareLink(slug);
  const media = link ? await getMedia(link.mediaId) : null;
  const title =
    link?.title?.[locale as "fr" | "en"] ||
    link?.title?.fr ||
    link?.title?.en ||
    media?.alt?.[locale as "fr" | "en"] ||
    media?.alt?.fr ||
    link?.slug ||
    slug;
  return { title, robots: { index: false, follow: false } };
}

export default async function ShareLinkPage({ params }: { params: Params }) {
  const { locale: raw, slug } = await params;
  const locale = raw as AppLocale;
  setRequestLocale(locale);

  const link = readPublicShareLink(slug);
  if (!link) notFound();

  const media = await getMedia(link.mediaId);
  if (!media) notFound();

  const title =
    link.title?.[locale] ||
    link.title?.fr ||
    link.title?.en ||
    media.alt?.[locale] ||
    media.alt?.fr ||
    media.alt?.en ||
    link.slug;

  const t = await getTranslations({ locale, namespace: "share" });
  const tcv = await getTranslations({ locale, namespace: "cv" });

  const renderFile = () => {
    if (media.pdf) {
      return (
        <>
          <CvPages pages={media.pdf.pages} alt={media.alt?.[locale] || title} texts={{ page: tcv("page"), open: tcv("open"), pages: tcv("pages") }} />
          {link.allowDownload && (
            <div className="mt-6">
              <a className="btn" href={`${media.pdf.href}?name=${downloadName(link.slug)}`} download={`${downloadName(link.slug)}.pdf`}>
                {t("download")}
              </a>
            </div>
          )}
        </>
      );
    }
    if (media.video) {
      const item: LocalizedArtwork = {
        id: `media-${media.id}`,
        slug: `media-${media.id}`,
        collection: "animation",
        title,
        alt: media.alt?.[locale] || title,
        description: "",
        image: media.url,
        sources: media.sources ?? undefined,
        video: media.video,
        width: media.width ?? 1280,
        height: media.height ?? 720,
        year: 0,
        featured: false,
        duration: media.video.durationLabel,
      };
      return (
        <>
          <VideoCard item={item} look="plain" mode="player" texts={{ eyebrow: "", title, description: "" }} solo />
          {link.allowDownload && (
            <div className="mt-6">
              <a className="btn" href={media.video.sources.mp4[0]?.src ?? media.url} download={downloadName(link.slug)}>
                {t("download")}
              </a>
            </div>
          )}
        </>
      );
    }
    // image
    return (
      <>
        <Picture src={media.url} sources={media.sources} alt={media.alt?.[locale] || title} width={media.width ?? 1200} height={media.height ?? 800} sizes="100vw" className="block-image-media" />
        {link.allowDownload && (
          <div className="mt-6">
            <a className="btn" href={media.url} download={downloadName(link.slug)}>
              {t("download")}
            </a>
          </div>
        )}
      </>
    );
  };

  return (
    <section className="shell pt-[var(--section-gap)]">
      <h1 className="font-display text-[clamp(2rem,5vw,3.25rem)] text-ink">{title}</h1>
      <div className="mt-6">{renderFile()}</div>
      <div className="mt-8">
        <Link href="/" className="a-btn a-btn-quiet">
          {t("back")}
        </Link>
      </div>
    </section>
  );
}
