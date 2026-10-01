"use client";

import LoopFrame from "./LoopVideo";
import Picture from "./Picture";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import Lightbox from "@/components/Lightbox";
import RailScrollbar from "@/components/RailScrollbar";
import type { LocalizedProject } from "@/lib/gallery";

/**
 * La planche de projet : l'unité de lecture du site.
 *
 * Un en-tête qui dit de quoi il s'agit (nature, période, rôle), puis une
 * bande d'images à hauteur commune qui défile horizontalement et déborde
 * volontairement à droite — on doit sentir que le projet continue hors cadre.
 *
 * Pas de carte, pas de passe-partout, pas d'ombre : les images sont posées
 * bord à bord comme des photogrammes sur une table lumineuse. La légende
 * reste visible en permanence, elle n'est pas une récompense au survol.
 */
/**
 * Largeur affichée d'une image de bande : hauteur du rail
 * (--strip-h = clamp(260px, 34vw, 420px)) × ratio de l'image.
 */
function stripSizes(width: number, height: number): string {
  const ratio = width / Math.max(1, height);
  const px = (h: number) => `${Math.ceil(h * ratio)}px`;
  return `(min-width: 1236px) ${px(420)}, (min-width: 765px) calc(34vw * ${ratio.toFixed(3)}), ${px(260)}`;
}

export default function ProjectStrip({
  project,
  deep = false,
  headingLevel = "h2",
}: {
  project: LocalizedProject;
  /** Fond papier profond, pour séparer deux projets sans boîte ni bordure. */
  deep?: boolean;
  headingLevel?: "h2" | "h3";
}) {
  const t = useTranslations("projects");
  const tg = useTranslations("gallery");
  const Heading = headingLevel;

  const railId = `rail-${project.slug}`;
  const railRef = useRef<HTMLDivElement | null>(null);
  const triggerRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const lastFocused = useRef<number | null>(null);

  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [overflows, setOverflows] = useState(false);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  // Les flèches n'apparaissent que si la bande dépasse réellement du cadre.
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    const measure = () => {
      const slack = rail.scrollWidth - rail.clientWidth;
      setOverflows(slack > 8);
      setAtStart(rail.scrollLeft <= 8);
      setAtEnd(rail.scrollLeft >= slack - 8);
    };

    measure();
    rail.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(rail);

    return () => {
      rail.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [project.artworks.length]);

  const scrollBy = useCallback((direction: 1 | -1) => {
    const rail = railRef.current;
    if (!rail) return;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    rail.scrollBy({
      left: direction * Math.round(rail.clientWidth * 0.8),
      behavior: reduced ? "auto" : "smooth",
    });
  }, []);

  // Rendre le focus à la vignette d'origine à la fermeture de la lightbox.
  useEffect(() => {
    if (openIndex !== null) {
      lastFocused.current = openIndex;
      return;
    }
    if (lastFocused.current !== null) {
      triggerRefs.current[lastFocused.current]?.focus();
      lastFocused.current = null;
    }
  }, [openIndex]);

  return (
    <section
      className={`strip py-[clamp(3rem,7vw,5.5rem)] ${deep ? "strip-deep bg-bg-deep" : ""}`}
      aria-labelledby={`project-${project.slug}`}
    >
      <header className="shell flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div className="max-w-2xl">
          <p className="eyebrow">
            {/* Séparateur seulement entre deux parties non vides ; mêmes nœuds de texte
                qu'avant quand les deux existent (parité au pixel). */}
            {project.context && project.year ? (
              <>
                {project.context} · {project.year}
              </>
            ) : (
              project.context || project.year
            )}
          </p>
          <Heading
            id={`project-${project.slug}`}
            className="mt-3 font-display text-[clamp(2.2rem,5.5vw,3.5rem)] text-ink"
          >
            {project.title}
          </Heading>
          <p className="mt-4 text-base leading-relaxed text-ink-soft">
            {project.description}
          </p>
        </div>

        <div className="flex items-center gap-4">
          <span className="eyebrow">
            {tg("count", { count: project.artworks.length })}
          </span>
          {overflows && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => scrollBy(-1)}
                aria-label={t("scrollPrev", { project: project.title })}
                disabled={atStart}
                className="rail-arrow"
              >
                <span aria-hidden="true" data-icon="arrow-left">←</span>
              </button>
              <button
                type="button"
                onClick={() => scrollBy(1)}
                aria-label={t("scrollNext", { project: project.title })}
                disabled={atEnd}
                className="rail-arrow"
              >
                <span aria-hidden="true" data-icon="arrow-right">→</span>
              </button>
            </div>
          )}
        </div>
      </header>

      <div
        ref={railRef}
        id={railId}
        className="strip-rail"
        role="group"
        aria-label={project.title}
      >
        {project.artworks.map((artwork, index) => {
          const caption = (
            <span className="strip-caption-row flex items-baseline justify-between gap-4">
              <span className="strip-caption transition-colors group-hover:text-ink">
                {artwork.title}
              </span>
              <span className="strip-caption shrink-0">
                {artwork.year}
              </span>
            </span>
          );
          const openLabel = `${artwork.title || artwork.alt || artwork.year} — ${tg("open")}`;
          if (artwork.video?.loop) {
            return (
              <LoopFrame
                key={artwork.id}
                video={artwork.video}
                width={artwork.width}
                height={artwork.height}
                mediaClassName="h-[var(--strip-h)] w-auto max-w-none rounded-strip"
                label={artwork.alt || artwork.title}
                openLabel={openLabel}
                onOpen={() => setOpenIndex(index)}
                openRef={(node) => {
                  triggerRefs.current[index] = node;
                }}
                caption={caption}
                texts={{ pause: tg("pauseLoop"), play: tg("playLoop") }}
              />
            );
          }
          return (
          <button
            key={artwork.id}
            type="button"
            ref={(node) => {
              triggerRefs.current[index] = node;
            }}
            onClick={() => setOpenIndex(index)}
            aria-label={openLabel}
            className="strip-frame group text-left"
          >
            <span className="strip-media">
              {artwork.video ? (
                <span className="relative block">
                  <Picture
                    src={artwork.image}
                    sources={artwork.sources}
                    alt={artwork.alt}
                    width={artwork.width}
                    height={artwork.height}
                    sizes={stripSizes(artwork.width, artwork.height)}
                    className="h-[var(--strip-h)] w-auto max-w-none rounded-strip"
                  />
                  <span className="strip-duration absolute bottom-2 right-2 rounded-sm bg-scrim/75 px-2 py-0.5 text-xs text-on-scrim">
                    <span aria-hidden="true">▶ </span>
                    {artwork.video.durationLabel}
                    <span className="sr-only"> — {tg("playVideo")}</span>
                  </span>
                </span>
              ) : (
                // Image : la même balise qu'avant (parité visuelle).
                <Picture
                  src={artwork.image}
                  sources={artwork.sources}
                  alt={artwork.alt}
                  width={artwork.width}
                  height={artwork.height}
                  sizes={artwork.sources ? stripSizes(artwork.width, artwork.height) : "(min-width: 1024px) 640px, 60vw"}
                  className="h-[var(--strip-h)] w-auto max-w-none rounded-strip"
                />
              )}
            </span>
            {caption}
          </button>
          );
        })}
      </div>

      {overflows && (
        <div className="shell mt-[clamp(0.75rem,1.5vw,1.25rem)]">
          <RailScrollbar
            railRef={railRef}
            railId={railId}
            label={t("scrollbar", { project: project.title })}
          />
        </div>
      )}

      <Lightbox
        items={project.artworks}
        index={openIndex}
        onIndexChange={setOpenIndex}
        onClose={() => setOpenIndex(null)}
      />
    </section>
  );
}
