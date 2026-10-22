"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";

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

/** Repère pause / lecture d'une boucle : discret, dans l'arbre d'accessibilité par le bouton qui le porte (jamais seul). */
export function LoopMark({ playing }: { playing: boolean }) {
  return (
    <span className="loop-mark" aria-hidden="true" data-mark={playing ? "pause" : "play"}>
      {playing ? (
        <svg width="12" height="14" viewBox="0 0 12 14">
          <rect x="1" y="1" width="3.5" height="12" fill="currentColor" />
          <rect x="7.5" y="1" width="3.5" height="12" fill="currentColor" />
        </svg>
      ) : (
        <svg width="14" height="16" viewBox="0 0 16 18" data-icon="play">
          <path d="M2 1.5 14.5 9 2 16.5Z" fill="currentColor" />
        </svg>
      )}
    </span>
  );
}

/**
 * Lecture d'une boucle (lot 62) : la vidéo NE DÉMARRE JAMAIS toute seule (ni au chargement, ni en arrivant à l'écran, ni en
 * défilant) : elle montre son image d'attente. Un clic la lance, un autre la met en pause ; elle boucle tant qu'elle joue.
 * Lancée, elle se met en pause quand elle sort de l'écran et reprend quand elle revient (rien ne tourne hors champ).
 */
export function useLoopPlayback(ref: React.RefObject<HTMLVideoElement | null>) {
  const [wantPlay, setWantPlay] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (wantPlay && visible) void el.play().catch((e: unknown) => {
        // Seul un refus du navigateur remet le repère à « lecture » ; une lecture interrompue par une pause (défilement) n'est pas un refus.
        if (e instanceof DOMException && e.name === "NotAllowedError") setWantPlay(false);
      });
    else el.pause();
  }, [ref, wantPlay, visible]);

  return { wantPlay, toggle: () => setWantPlay((p) => !p) };
}

/**
 * Mode « Boucle » d'une vidéo de page (composant Vidéo, case de grille) : muette, en boucle, sur place, à l'arrêt sur son
 * image d'attente tant qu'on n'a pas cliqué. Un clic ou un toucher la lance, un autre la met en pause ; Espace et Entrée font de même au clavier (le cadre est un bouton).
 * Un petit repère pause / lecture le dit sans gêner. Sur la toile de l'éditeur (`edit`) le clic ne fait rien : il
 * sert à choisir le composant.
 */
export function LoopClick({
  video,
  width,
  height,
  className,
  label,
  edit = false,
}: {
  video: VideoView;
  width: number;
  height: number;
  className?: string;
  label?: string;
  edit?: boolean;
}) {
  const t = useTranslations("player");
  const ref = useRef<HTMLVideoElement>(null);
  const { wantPlay, toggle } = useLoopPlayback(ref);
  const sd = video.sources.mp4.at(-1)!;
  const action = wantPlay ? t("loopPause") : t("loopPlay");

  return (
    <div
      className="loop-click absolute inset-0"
      data-loop={wantPlay ? "playing" : "paused"}
      role="button"
      tabIndex={0}
      aria-label={label ? `${action} — ${label}` : action}
      onClick={() => {
        if (!edit) toggle();
      }}
      onKeyDown={(event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          if (!edit) toggle();
        }
      }}
    >
      <video
        ref={ref}
        poster={video.sources.poster.largest.webp}
        preload={wantPlay ? "metadata" : "none"}
        muted
        loop
        playsInline
        width={width}
        height={height}
        className={className}
        tabIndex={-1}
        aria-hidden="true"
        style={video.sources.poster.color ? { backgroundColor: video.sources.poster.color } : undefined}
      >
        <source src={sd.src} type="video/mp4" />
      </video>
      <LoopMark playing={wantPlay} />
    </div>
  );
}

/**
 * Boucle d'animation dans la bande d'images (mode « Boucle ») : muette, en boucle, arrêtée sur son image d'attente jusqu'au
 * clic (lot 62). Le cadre entier est un bouton lecture / pause (un clic ou un toucher lance, un autre met en pause ;
 * WCAG 2.2.2), avec le repère discret en coin. Cadre (`frame`, lots 34 et 62) : le choix de l'artiste, posé sur le cadre.
 */
export default function LoopFrame({
  video,
  width,
  height,
  mediaClassName,
  label,
  caption,
  texts,
  frame,
}: {
  video: VideoView;
  width: number;
  height: number;
  mediaClassName?: string;
  /** Texte alternatif de l'œuvre, sinon son titre. */
  label: string;
  caption: React.ReactNode;
  texts: { pause: string; play: string };
  frame?: { attrs: Record<string, string>; style: React.CSSProperties } | null;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const { wantPlay, toggle } = useLoopPlayback(ref);
  const sd = video.sources.mp4.at(-1)!;
  const action = wantPlay ? texts.pause : texts.play;

  return (
    <div className="strip-frame group relative" data-loop={wantPlay ? "playing" : "paused"} data-video-mode="loop" {...frame?.attrs} style={frame?.style}>
      <button type="button" onClick={toggle} aria-label={label ? `${action} — ${label}` : action} className="loop-click block w-full text-left">
        <span className="strip-media">
          <span className="relative block">
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
            tabIndex={-1}
            aria-hidden="true"
            style={video.sources.poster.color ? { backgroundColor: video.sources.poster.color } : undefined}
          >
            <source src={sd.src} type="video/mp4" />
          </video>
          <LoopMark playing={wantPlay} />
          </span>
        </span>
        {caption}
      </button>
    </div>
  );
}
