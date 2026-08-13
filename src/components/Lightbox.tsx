"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";

import type { LocalizedArtwork } from "@/lib/gallery";

/**
 * Vue plein écran d'une œuvre.
 * Le parent possède l'index : la lightbox est toujours « scopée » à la liste
 * qu'on lui passe (les œuvres d'un projet), donc ← et → ne sortent jamais
 * du projet ouvert.
 *
 * C'est le seul endroit du site où survit le passe-partout (`.mat`) : ailleurs
 * les images sont montrées bord à bord.
 */
export default function Lightbox({
  items,
  index,
  onIndexChange,
  onClose,
}: {
  items: LocalizedArtwork[];
  /** null = fermée */
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const t = useTranslations("gallery");
  const closeRef = useRef<HTMLButtonElement | null>(null);

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

  if (index === null) return null;
  const active = items[index];
  if (!active) return null;

  const solo = items.length < 2;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={active.title}
      className="fixed inset-0 z-[80] flex flex-col bg-ink/92 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex items-center justify-between gap-4 px-5 py-4 md:px-8">
        <span className="eyebrow text-bg">
          {t("position", { index: index + 1, total: items.length })}
        </span>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="btn btn-ghost border-line/30 text-bg hover:bg-bg/10 hover:text-bg"
        >
          {t("close")}
          <span aria-hidden="true">✕</span>
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-center gap-2 px-2 md:px-6">
        {!solo && (
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label={t("previous")}
            className="shrink-0 rounded-btn px-3 py-6 text-2xl text-bg/70 transition-colors hover:text-bg"
          >
            ←
          </button>
        )}

        <figure className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4">
          <div className="mat max-h-[62vh] max-w-full overflow-hidden">
            <Image
              src={active.image}
              alt={active.title}
              width={active.width}
              height={active.height}
              className="max-h-[56vh] w-auto max-w-full object-contain"
              priority
            />
          </div>
        </figure>

        {!solo && (
          <button
            type="button"
            onClick={() => go(1)}
            aria-label={t("next")}
            className="shrink-0 rounded-btn px-3 py-6 text-2xl text-bg/70 transition-colors hover:text-bg"
          >
            →
          </button>
        )}
      </div>

      <div className="mx-auto w-full max-w-2xl px-6 pb-10 pt-6 text-center">
        <h2 className="font-display text-2xl text-bg md:text-3xl">
          {active.title}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-bg/70">
          {active.description}
        </p>
        {!solo && <p className="eyebrow mt-5 text-bg/45">{t("hint")}</p>}
      </div>
    </div>
  );
}
