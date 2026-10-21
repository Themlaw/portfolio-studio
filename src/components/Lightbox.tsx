"use client";

import Picture from "./Picture";
import PictureMarkup from "./PictureMarkup";
import { useReducedMotion } from "./LoopVideo";
import VideoPlayer from "./VideoPlayer";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslations } from "next-intl";

import type { ViewerItem } from "@/lib/viewer";

/** Part de l'écran occupée au plus par l'image agrandie (lot 54) : 92 vw sur 88 vh, proportions gardées. */
const MAX_VW = 92;
const MAX_VH = 88;

/** URLs d'un srcset (« url 480w, url 960w »). */
const urlsOf = (srcset: string) => srcset.split(",").map((s) => s.trim().split(/\s+/)[0]).filter(Boolean);

/**
 * Version déjà chargée de cette image dans la page (la vignette, de la variante que le navigateur a choisie), à montrer
 * tout de suite pendant que la grande arrive. Aucune requête de plus : on lit les images déjà affichées.
 */
function loadedPreview(item: ViewerItem): string | undefined {
  if (typeof document === "undefined" || !item.sources) return undefined;
  const urls = new Set([...urlsOf(item.sources.avif), ...urlsOf(item.sources.webp)]);
  for (const img of document.querySelectorAll<HTMLImageElement>("img")) {
    if (img.closest(".lightbox")) continue;
    const src = img.currentSrc;
    if (src && img.complete && img.naturalWidth > 0 && [...urls].some((u) => src.endsWith(u) || src === new URL(u, document.baseURI).href)) return src;
  }
  return undefined;
}

/** Image agrandie : version déjà chargée tout de suite, indicateur discret, puis remplacement par la variante adaptée à l'écran. */
function LightboxImage({ item }: { item: ViewerItem }) {
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLImageElement | null>(null);
  const preview = useMemo(() => loadedPreview(item), [item]);
  useEffect(() => {
    if (ref.current?.complete && ref.current.naturalWidth > 0) setLoaded(true);
  }, []);
  const ratio = item.width / Math.max(1, item.height);
  const sizes = `min(${MAX_VW}vw, ${(MAX_VH * ratio).toFixed(2)}vh)`;
  if (!item.sources) {
    return (
      <div className="lightbox-frame" style={{ "--lb-r": ratio.toFixed(4) } as CSSProperties}>
        <Picture src={item.image} sources={item.sources} alt={item.alt} width={item.width} height={item.height} sizes={sizes} className="lightbox-image" priority />
      </div>
    );
  }
  return (
    <div className="lightbox-frame lb-frame" data-loaded={loaded ? "" : undefined} style={{ "--lb-r": ratio.toFixed(4), ...(loaded || preview || !item.sources.color ? {} : { backgroundColor: item.sources.color }) } as CSSProperties}>
      {preview && !loaded && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt="" aria-hidden="true" width={item.width} height={item.height} className="lb-preview" />
      )}
      <PictureMarkup
        sources={item.sources}
        alt={item.alt}
        width={item.width}
        height={item.height}
        sizes={sizes}
        className="lightbox-image lb-main"
        priority
        imgRef={ref}
        onLoad={() => setLoaded(true)}
        style={{ opacity: loaded ? 1 : 0 }}
      />
      {!loaded && <span className="lb-spinner" aria-hidden="true" />}
    </div>
  );
}

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
  const hasText = Boolean(active.title || (!active.plain && active.alt) || active.description || active.date);
  // Image suivante et précédente : chargées d'avance, avec les mêmes `sizes` (donc la même variante que celle qu'on affichera).
  const neighbours = solo ? [] : [...new Set([(index + 1) % items.length, (index - 1 + items.length) % items.length])].filter((i) => i !== index);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={active.title || active.alt}
      data-caption={hasText ? "" : undefined}
      data-thumbs={solo ? undefined : ""}
      className="lightbox fixed inset-0 z-[80] flex flex-col"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="lightbox-head flex shrink-0 items-center justify-between gap-4 px-5 md:px-8">
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

        <figure className="flex min-h-0 w-full flex-1 flex-col items-center justify-center">
          {active.video ? (
            <div className="lightbox-frame" style={{ "--lb-r": (active.width / Math.max(1, active.height)).toFixed(4) } as CSSProperties}>
              <VideoPlayer
                key={active.id}
                video={active.video}
                width={active.width}
                height={active.height}
                videoClassName="lightbox-image object-contain"
                autoPlay={active.video.loop && !reduced}
                muted={active.video.loop}
                loop={active.video.loop}
                label={active.title || active.alt}
              />
            </div>
          ) : (
            <LightboxImage key={active.id} item={active} />
          )}
          {neighbours.map((i) => {
            const n = items[i];
            return n.video || !n.sources ? null : (
              <div key={n.id} hidden aria-hidden="true">
                <PictureMarkup sources={n.sources} alt="" width={n.width} height={n.height} sizes={`min(${MAX_VW}vw, ${((MAX_VH * n.width) / Math.max(1, n.height)).toFixed(2)}vh)`} eager />
              </div>
            );
          })}
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
      <div className="lightbox-caption mx-auto w-full max-w-2xl shrink-0 overflow-y-auto px-6 pb-3 pt-3 text-center empty:hidden">
        {(active.title || (!active.plain && active.alt)) && (
          <h2 className="font-display text-xl text-on-scrim md:text-2xl">
            {active.title || active.alt}
          </h2>
        )}
        <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-on-scrim/70 empty:hidden md:line-clamp-3">
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
