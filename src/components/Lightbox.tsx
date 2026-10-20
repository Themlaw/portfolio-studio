"use client";

import Picture from "./Picture";
import { useReducedMotion } from "./LoopVideo";
import VideoPlayer from "./VideoPlayer";
import { useCallback, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";

import type { ViewerItem } from "@/lib/viewer";

/**
 * Vue plein écran d'une œuvre.
 * Le parent possède l'index : la lightbox est toujours « scopée » à la liste
 * qu'on lui passe (les œuvres d'un projet), donc ← et → ne sortent jamais
 * du projet ouvert.
 *
 * L'image agrandie est posée à nu (ni passe-partout ni cadre du kit) sur un
 * fond gris neutre (`--color-viewer`) ; la variante data-lightbox règle la
 * taille (plein cadre : src/themes/variants.css). Navigation : flèches,
 * ← / → et Échap au clavier, balayage horizontal au doigt.
 */
export default function Lightbox({
  items,
  index,
  onIndexChange,
  onClose,
  bare = false,
}: {
  items: ViewerItem[];
  /** Image seule (lot 44) : ni compteur ni flèches ni vignettes. */
  bare?: boolean;
  /** null = fermée */
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const reduced = useReducedMotion();
  const t = useTranslations("gallery");
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const thumbRefs = useRef<(HTMLButtonElement | null)[]>([]);
  /** Début d'un balayage au doigt (ou au stylet) sur la scène. */
  const swipe = useRef<{ id: number; x: number; y: number; t: number } | null>(null);

  const go = useCallback(
    (delta: number) => {
      if (index === null) return;
      onIndexChange((index + delta + items.length) % items.length);
    },
    [index, items.length, onIndexChange],
  );

  useEffect(() => {
    if (index === null) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        go(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        go(-1);
      }
    };

    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [index, go, onClose]);

  // La vignette courante se remet toujours dans le champ.
  useEffect(() => {
    if (index === null) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches;
    thumbRefs.current[index]?.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [index]);

  if (index === null) return null;
  const active = items[index];
  if (!active) return null;

  const solo = items.length < 2;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={active.title || active.alt}
      className="lightbox fixed inset-0 z-[80] flex flex-col"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex items-center justify-between gap-4 px-5 py-4 md:px-8">
        <span className="eyebrow text-on-scrim">
          {bare ? "" : t("position", { index: index + 1, total: items.length })}
        </span>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="btn btn-ghost border-line/30 text-on-scrim hover:bg-on-scrim/10 hover:text-on-scrim"
        >
          {t("close")}
          <span aria-hidden="true" data-icon="close">✕</span>
        </button>
      </div>

      {/* Les flèches sont en superposition, pas dans le flux : sur un écran
          étroit elles prenaient 80px de large et écrasaient l'image. */}
      <div
        className="lightbox-stage relative flex min-h-0 flex-1 touch-pan-y items-center px-2 md:px-6"
        onPointerDown={(event) => {
          if (event.pointerType === "mouse" || solo) return;
          swipe.current = { id: event.pointerId, x: event.clientX, y: event.clientY, t: event.timeStamp };
        }}
        onPointerUp={(event) => {
          const s = swipe.current;
          swipe.current = null;
          if (!s || s.id !== event.pointerId) return;
          const dx = event.clientX - s.x;
          const dy = event.clientY - s.y;
          // Geste franc et surtout horizontal (un balayage, pas un défilement ni un appui).
          if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5 && event.timeStamp - s.t < 800) go(dx < 0 ? 1 : -1);
        }}
        onPointerCancel={() => {
          swipe.current = null;
        }}
      >
        {!solo && (
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label={t("previous")}
            className="absolute left-0 top-1/2 z-10 -translate-y-1/2 rounded-btn px-3 py-6 text-2xl text-on-scrim/70 transition-colors hover:text-on-scrim"
          >
            <span data-icon="arrow-left">←</span>
          </button>
        )}

        <figure className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-4">
          <div className="lightbox-frame max-h-[62vh] max-w-full overflow-hidden">
            {active.video ? (
              <VideoPlayer
                key={active.id}
                video={active.video}
                width={active.width}
                height={active.height}
                videoClassName="lightbox-image max-h-[44vh] w-auto max-w-full object-contain md:max-h-[56vh]"
                autoPlay={active.video.loop && !reduced}
                muted={active.video.loop}
                loop={active.video.loop}
                label={active.title || active.alt}
              />
            ) : (
              <Picture
                src={active.image}
                sources={active.sources}
                alt={active.alt}
                width={active.width}
                height={active.height}
                className={`lightbox-image max-h-[44vh] w-auto max-w-full object-contain ${active.date ? "md:max-h-[46vh]" : "md:max-h-[56vh]"}`}
                priority
                largest
              />
            )}
          </div>
        </figure>

        {!solo && (
          <button
            type="button"
            onClick={() => go(1)}
            aria-label={t("next")}
            className="absolute right-0 top-1/2 z-10 -translate-y-1/2 rounded-btn px-3 py-6 text-2xl text-on-scrim/70 transition-colors hover:text-on-scrim"
          >
            <span data-icon="arrow-right">→</span>
          </button>
        )}
      </div>

      {/* Sur petit écran le texte cède la place à l'image : description
          écourtée et rappel clavier masqué (il n'y a pas de clavier). */}
      <div className="mx-auto w-full max-w-2xl px-6 pt-4 text-center pb-4 md:pt-6">
        {(active.title || (!active.plain && active.alt)) && (
          <h2 className="font-display text-xl text-on-scrim md:text-3xl">
            {active.title || active.alt}
          </h2>
        )}
        <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-on-scrim/70 empty:hidden md:mt-3 md:line-clamp-none">
          {active.description}
        </p>
        {active.date && <p className="eyebrow mt-2 text-on-scrim/70" data-lightbox-date="">{active.date}</p>}
        {!solo && (
          <p className="eyebrow mt-4 hidden text-on-scrim/70 md:block">{t("hint")}</p>
        )}
      </div>

      {!solo && (
        <div
          className="lb-thumbs mx-auto w-full max-w-full px-4 pb-6 pt-5 md:px-8"
          role="group"
          aria-label={t("thumbs")}
        >
          {/* Marges auto : la rangée est centrée tant qu'elle tient, et
              s'aligne à gauche dès qu'elle doit défiler. */}
          <div className="mx-auto flex gap-2">
            {items.map((item, i) => (
              <button
                key={item.id}
                type="button"
                ref={(node) => {
                  thumbRefs.current[i] = node;
                }}
                onClick={() => onIndexChange(i)}
                aria-label={item.title || item.alt || String(i + 1)}
                aria-current={i === index}
                className="lb-thumb"
              >
                <Picture
                  src={item.image}
                  sources={item.sources}
                  alt=""
                  width={item.width}
                  height={item.height}
                  sizes="120px"
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
