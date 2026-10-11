"use client";

import Picture from "./Picture";
import VideoPlayer from "./VideoPlayer";
import { useState } from "react";
import { useTranslations } from "next-intl";

import Eyebrow from "@/components/Eyebrow";
import type { LocalizedArtwork } from "@/lib/gallery";

export function PlayBadge({ label }: { label: string }) {
  return (
    <span className="pointer-events-none flex items-center gap-3">
      <span className="flex h-14 w-14 items-center justify-center rounded-btn bg-surface/90 shadow-card transition-transform duration-500 ease-soft group-hover:scale-110">
        <svg width="16" height="18" viewBox="0 0 16 18" aria-hidden="true" data-icon="play" className="text-primary">
          <path d="M2 1.5 14.5 9 2 16.5Z" fill="var(--color-primary)" />
        </svg>
      </span>
      <span className="eyebrow text-on-scrim">{label}</span>
    </span>
  );
}

export function Frame({
  item,
  playing,
  onPlay,
  large = false,
}: {
  item: LocalizedArtwork;
  playing: boolean;
  onPlay: () => void;
  large?: boolean;
}) {
  const t = useTranslations("animation");

  return (
    <div className="mat">
      <div className="relative aspect-video w-full overflow-hidden rounded-[2px] bg-scrim">
        {playing && item.video ? (
          <VideoPlayer
            video={item.video}
            width={item.width}
            height={item.height}
            className="absolute inset-0"
            videoClassName="h-full w-full bg-scrim object-contain"
            autoPlay
            label={item.title}
          />
        ) : playing && item.videoId ? (
          <iframe
            className="absolute inset-0 h-full w-full"
            src={`https://www.youtube-nocookie.com/embed/${item.videoId}?autoplay=1&rel=0`}
            title={item.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <>
            <Picture
              src={item.image}
              sources={item.sources}
              alt={item.alt}
              width={item.width}
              height={item.height}
              sizes={large ? "100vw" : "(min-width: 768px) 50vw, 100vw"}
              className={`absolute inset-0 h-full w-full object-cover transition-transform duration-[1200ms] ease-soft ${
                playing ? "pan-play" : "group-hover:scale-[1.03]"
              }`}
              priority={large}
            />
            {playing && (
              <>
                <span
                  aria-hidden="true"
                  className="sweep-play absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-surface/45 to-transparent"
                />
                <span className="absolute bottom-3 left-3 eyebrow rounded-sm bg-scrim/60 px-2 py-1 text-on-scrim">
                  {t("placeholder")}
                </span>
              </>
            )}
            {!playing && (
              <span
                aria-hidden="true"
                className="absolute inset-0 bg-gradient-to-t from-scrim/55 via-transparent to-transparent"
              />
            )}
            {!playing && (
              <button
                type="button"
                onClick={onPlay}
                aria-label={t("playAria", { title: item.title })}
                className="video-play group absolute inset-0 flex items-end p-5 md:p-7"
              >
                <PlayBadge label={t("play")} />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function AnimationShowcase({
  reel,
  items,
  texts,
}: {
  reel?: LocalizedArtwork;
  items: LocalizedArtwork[];
  /** Textes éditoriaux du bloc « video ». */
  texts: { reelEyebrow: string; cardsEyebrow: string; cardsTitle: string };
}) {
  const [playing, setPlaying] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-[var(--section-gap)]">
      {reel && (
        <section aria-labelledby="reel-title">
          <Eyebrow>{texts.reelEyebrow}</Eyebrow>
          <h2
            id="reel-title"
            className="mt-3 mb-8 font-display text-[clamp(2rem,5vw,3.5rem)] text-ink"
          >
            {reel.title}
          </h2>
          <div className="group">
            <Frame
              item={reel}
              large
              playing={playing === reel.id}
              onPlay={() => setPlaying(reel.id)}
            />
          </div>
          <div className="mt-5 flex flex-wrap items-baseline justify-between gap-4">
            <p className="max-w-xl text-sm leading-relaxed text-ink-soft">
              {reel.description}
            </p>
            {reel.duration && <p className="eyebrow">{reel.duration}</p>}
          </div>
        </section>
      )}

      <section aria-labelledby="shots-title">
        <Eyebrow>{texts.cardsEyebrow}</Eyebrow>
        <h2
          id="shots-title"
          className="mt-3 mb-8 font-display text-[clamp(1.75rem,4vw,2.75rem)] text-ink"
        >
          {texts.cardsTitle}
        </h2>

        <ul className="grid gap-[clamp(1.5rem,3vw,2.5rem)] md:grid-cols-2">
          {items.map((item) => (
            <li key={item.id} className="group mat-hover">
              <Frame
                item={item}
                playing={playing === item.id}
                onPlay={() => setPlaying(item.id)}
              />
              <div className="mt-4 flex items-baseline justify-between gap-4">
                <h3 className="font-display text-xl text-ink transition-colors group-hover:text-primary">
                  {item.title}
                </h3>
                <span className="eyebrow shrink-0">
                  {item.duration ?? item.year}
                </span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                {item.description}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
