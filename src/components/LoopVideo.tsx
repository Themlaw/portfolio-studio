"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import type { VideoView } from "@/lib/media";

/** Préférence « réduire les animations », lue sans état intermédiaire. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  );
}

/**
 * Boucle d'animation dans une planche : muette, en boucle, jouée seulement
 * quand elle est visible (pause hors champ). Un bouton pause / lecture
 * (WCAG 2.2.2) reste dans l'arbre d'accessibilité, visible au survol et au
 * focus ; avec « réduire les animations », la boucle démarre arrêtée sur son
 * poster et le bouton ▶ reste affiché. Le bouton est un frère du bouton qui
 * ouvre la visionneuse (jamais imbriqué).
 */
export default function LoopFrame({
  video,
  width,
  height,
  mediaClassName,
  label,
  openLabel,
  onOpen,
  openRef,
  caption,
  texts,
}: {
  video: VideoView;
  width: number;
  height: number;
  mediaClassName?: string;
  /** Texte alternatif de l'œuvre, sinon son titre. */
  label: string;
  openLabel: string;
  onOpen: () => void;
  openRef?: (node: HTMLButtonElement | null) => void;
  caption: React.ReactNode;
  texts: { pause: string; play: string };
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const reduced = useReducedMotion();
  // null : comportement par défaut (lecture, sauf « réduire les animations »).
  const [choice, setChoice] = useState<"play" | "pause" | null>(null);
  const wantPlay = choice === "play" || (choice === null && !reduced);
  const [visible, setVisible] = useState(false);
  const sd = video.sources.mp4.at(-1)!;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (wantPlay && visible) void el.play().catch(() => {});
    else el.pause();
  }, [wantPlay, visible]);

  return (
    <div className="strip-frame group relative" data-loop={wantPlay ? "playing" : "paused"}>
      <button ref={openRef} type="button" onClick={onOpen} aria-label={openLabel} className="block w-full text-left">
        <span className="strip-media">
          <video
            ref={ref}
            poster={video.sources.poster.largest.webp}
            preload={wantPlay ? "metadata" : "none"}
            muted
            loop
            playsInline
            width={width}
            height={height}
            className={mediaClassName}
            aria-label={label}
            tabIndex={-1}
            style={video.sources.poster.color ? { backgroundColor: video.sources.poster.color } : undefined}
          >
            <source src={sd.src} type="video/mp4" />
          </video>
        </span>
        {caption}
      </button>
      <button
        type="button"
        className={`loop-toggle absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-btn bg-surface/90 text-primary shadow-card transition-opacity focus-visible:opacity-100 group-hover:opacity-100 ${
          wantPlay ? "opacity-0" : "opacity-100"
        }`}
        aria-label={wantPlay ? texts.pause : texts.play}
        onClick={() => setChoice(wantPlay ? "pause" : "play")}
      >
        {wantPlay ? (
          <svg width="12" height="14" viewBox="0 0 12 14" aria-hidden="true">
            <rect x="1" y="1" width="3.5" height="12" fill="currentColor" />
            <rect x="7.5" y="1" width="3.5" height="12" fill="currentColor" />
          </svg>
        ) : (
          <svg width="14" height="16" viewBox="0 0 16 18" aria-hidden="true">
            <path d="M2 1.5 14.5 9 2 16.5Z" fill="currentColor" />
          </svg>
        )}
      </button>
    </div>
  );
}
