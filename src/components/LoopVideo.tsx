"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";

import type { MediaLook } from "@/lib/look";
import type { VideoView } from "@/lib/media";

import MediaFrame from "./MediaFrame";
import VideoBadge from "./VideoBadge";
import { SoundOffIcon, SoundOnIcon } from "./video-icons";
import { MANAGED_ATTR, useEditCanvas, useSoloPlayback } from "./video-playback";

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

/** Repère d'une boucle : le badge commun (icône boucle + état lecture / pause), voir VideoBadge. */
export function LoopMark({ playing }: { playing: boolean }) {
  return <VideoBadge kind="loop" playing={playing} />;
}

/**
 * Bouton son d'une boucle qui a du son (lot 116) : la boucle démarre muette (règle du site) ; ce bouton remet le son et lance la
 * lecture si elle était à l'arrêt. Absent pour une boucle sans son, et sur la toile en mode édition (le clic y sert à choisir).
 */
export function LoopSound({ videoRef, onUnmute }: { videoRef: React.RefObject<HTMLVideoElement | null>; onUnmute: () => void }) {
  const t = useTranslations("player");
  const [muted, setMuted] = useState(true);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const sync = () => setMuted(v.muted);
    v.addEventListener("volumechange", sync);
    sync();
    return () => v.removeEventListener("volumechange", sync);
  }, [videoRef]);
  return (
    <button
      type="button"
      className="vid-badge vid-sound"
      data-testid="loop-sound"
      data-muted={muted ? "true" : "false"}
      aria-pressed={!muted}
      aria-label={muted ? t("unmute") : t("mute")}
      onClick={(event) => {
        event.stopPropagation();
        const v = videoRef.current;
        if (!v) return;
        v.muted = !v.muted;
        if (!v.muted) onUnmute();
      }}
    >
      {muted ? <SoundOffIcon size={16} /> : <SoundOnIcon size={16} />}
    </button>
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

  // Une autre vidéo de la page démarre (lot 116) : cette boucle renonce, elle ne repart pas en revenant à l'écran.
  useSoloPlayback(ref, () => setWantPlay(false));

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

  return { wantPlay, toggle: () => setWantPlay((p) => !p), play: () => setWantPlay(true) };
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
  poster,
}: {
  video: VideoView;
  width: number;
  height: number;
  className?: string;
  label?: string;
  edit?: boolean;
  /** Image d'attente choisie (sinon celle de la vidéo). */
  poster?: string;
}) {
  const t = useTranslations("player");
  const ref = useRef<HTMLVideoElement>(null);
  const { wantPlay, toggle, play } = useLoopPlayback(ref);
  const canvas = useEditCanvas(edit);
  const sd = video.sources.mp4.at(-1)!;
  const action = wantPlay ? t("loopPause") : t("loopPlay");

  return (
    <>
    <div
      className="loop-click absolute inset-0"
      data-loop={wantPlay ? "playing" : "paused"}
      role="button"
      tabIndex={0}
      aria-label={label ? `${action} — ${label}` : action}
      onClick={() => {
        if (!canvas) toggle();
      }}
      onKeyDown={(event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          if (!canvas) toggle();
        }
      }}
    >
      <video
        ref={ref}
        {...{ [MANAGED_ATTR]: "" }}
        poster={poster ?? video.sources.poster.largest.webp}
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
    {video.hasAudio && !canvas && <LoopSound videoRef={ref} onUnmute={play} />}
    </>
  );
}

/**
 * Boucle d'animation dans la bande d'images (mode « Boucle ») : muette, en boucle, arrêtée sur son image d'attente jusqu'au
 * clic (lot 62). Le cadre entier est un bouton lecture / pause (un clic ou un toucher lance, un autre met en pause ;
 * WCAG 2.2.2), avec le repère discret en coin. Habillage (`mediaLook`, lots 34, 62 et 64) : cadre, fond, arrondi de la boîte de la vidéo (MediaFrame).
 */
export default function LoopFrame({
  video,
  width,
  height,
  label,
  caption,
  texts,
  mediaLook,
}: {
  video: VideoView;
  width: number;
  height: number;
  /** Texte alternatif de l'œuvre, sinon son titre. */
  label: string;
  caption: React.ReactNode;
  texts: { pause: string; play: string };
  mediaLook?: MediaLook;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const { wantPlay, toggle, play } = useLoopPlayback(ref);
  const sd = video.sources.mp4.at(-1)!;
  const action = wantPlay ? texts.pause : texts.play;

  return (
    <div className="strip-frame group relative" data-loop={wantPlay ? "playing" : "paused"} data-video-mode="loop">
      <button type="button" onClick={toggle} aria-label={label ? `${action} — ${label}` : action} className="loop-click block w-full text-left">
        <span className="strip-media">
          <MediaFrame kind="video" look={mediaLook} ratio={width / Math.max(1, height)}>
            <video
              ref={ref}
              {...{ [MANAGED_ATTR]: "" }}
              poster={video.sources.poster.largest.webp}
              preload={wantPlay ? "metadata" : "none"}
              muted
              loop
              playsInline
              width={width}
              height={height}
              tabIndex={-1}
              aria-hidden="true"
              style={video.sources.poster.color ? { backgroundColor: video.sources.poster.color } : undefined}
            >
              <source src={sd.src} type="video/mp4" />
            </video>
            <LoopMark playing={wantPlay} />
          </MediaFrame>
        </span>
        {caption}
      </button>
      {video.hasAudio && <LoopSound videoRef={ref} onUnmute={play} />}
    </div>
  );
}
