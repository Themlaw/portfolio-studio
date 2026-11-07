"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";

import { soundAttrs } from "@/blocks/video-sound";
import type { MediaLook } from "@/lib/look";
import type { VideoView } from "@/lib/media";

import MediaFrame from "./MediaFrame";
import VideoBadge from "./VideoBadge";
import { FullscreenButton, fullscreenElement } from "./video-fullscreen";
import { SoundOffIcon, SoundOnIcon } from "./video-icons";
import { MANAGED_ATTR, useEditCanvas, useSoloPlayback } from "./video-playback";
import { setVisitorSound, startPlayback, subscribeVisitorSound, unmuteOnGesture, wantsSound } from "./visitor-sound";

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
 * Bouton son d'une boucle qui a du son (lots 116 et 127), en haut à droite. Il dit la vérité : « son actif » ou « muet » (vidéo en lecture :
 * l'état réel de la vidéo ; à l'arrêt : ce que la lecture fera, réglage de l'artiste ou choix du visiteur). Un clic règle le son ET en
 * fait le choix du visiteur (il prime sur le réglage de toutes les vidéos de la page pendant la visite), et lance la lecture si on
 * remet le son. Absent pour une boucle sans son, et sur la toile en mode édition (le clic y sert à choisir).
 */
export function LoopSound({ videoRef, soundOn, onUnmute }: { videoRef: React.RefObject<HTMLVideoElement | null>; soundOn: boolean; onUnmute: () => void }) {
  const t = useTranslations("player");
  const [muted, setMuted] = useState(!wantsSound(soundOn));
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const sync = () => setMuted(!v.paused ? v.muted : !wantsSound(soundOn));
    const events = ["volumechange", "play", "pause"] as const;
    for (const name of events) v.addEventListener(name, sync);
    const off = subscribeVisitorSound(sync);
    sync();
    return () => {
      for (const name of events) v.removeEventListener(name, sync);
      off();
    };
  }, [videoRef, soundOn]);
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
        const target = !(!v.paused ? !v.muted : wantsSound(soundOn));
        setVisitorSound(target);
        v.muted = !target;
        if (target) onUnmute();
      }}
    >
      {muted ? <SoundOffIcon /> : <SoundOnIcon />}
    </button>
  );
}

/**
 * Lecture d'une boucle (lot 62) : la vidéo NE DÉMARRE JAMAIS toute seule (ni au chargement, ni en arrivant à l'écran, ni en
 * défilant) : elle montre son image d'attente. Un clic la lance, un autre la met en pause ; elle boucle tant qu'elle joue.
 * Lancée, elle se met en pause quand elle sort de l'écran et reprend quand elle revient (rien ne tourne hors champ).
 */
export function useLoopPlayback(ref: React.RefObject<HTMLVideoElement | null>, video: VideoView) {
  const [wantPlay, setWantPlay] = useState(false);
  const [visible, setVisible] = useState(false);
  const audio = video.hasAudio;
  const soundOn = !video.soundOff;

  // Une autre vidéo de la page démarre (lot 116) : cette boucle renonce, elle ne repart pas en revenant à l'écran. Une seule vidéo à la
  // fois a du son (lot 127) : la boucle mise de côté est muette (jamais deux boucles sonores).
  useSoloPlayback(ref, () => {
    setWantPlay(false);
    if (ref.current) ref.current.muted = true;
  });

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
    if (!(wantPlay && visible)) {
      el.pause();
      return;
    }
    // Son activé (lot 127) : on tente la lecture AVEC son ; le navigateur peut la refuser avant un geste du visiteur, la boucle joue alors
    // muette et prend le son au premier geste. Le choix du visiteur (bouton son) prime sur le réglage de l'artiste.
    let cancelled = false;
    let off: (() => void) | undefined;
    const withSound = audio && wantsSound(soundOn);
    void startPlayback(el, withSound).then((result) => {
      if (cancelled) return;
      // Seul un refus du navigateur remet le repère à « lecture » ; une lecture interrompue par une pause (défilement) n'est pas un refus.
      if (result === "blocked") setWantPlay(false);
      else if (result === "muted" && withSound) off = unmuteOnGesture(el, () => wantsSound(soundOn));
    });
    return () => {
      cancelled = true;
      off?.();
    };
  }, [ref, wantPlay, visible, audio, soundOn]);

  // Plein écran (lot 127) : la vidéo montre ses commandes natives le temps du plein écran ; au retour, l'état (lecture ou pause) est celui
  // où le visiteur l'a laissée.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let inside = false;
    const onChange = () => {
      const now = fullscreenElement() === el;
      if (now) {
        inside = true;
        el.controls = true;
      } else if (inside) {
        inside = false;
        el.controls = false;
        setWantPlay(!el.paused);
      }
    };
    const onIosEnd = () => {
      el.controls = false;
      setWantPlay(!el.paused);
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    el.addEventListener("webkitendfullscreen", onIosEnd);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
      el.removeEventListener("webkitendfullscreen", onIosEnd);
    };
  }, [ref]);

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
  const { wantPlay, toggle, play } = useLoopPlayback(ref, video);
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
        // En plein écran, les clics sont ceux des commandes natives de la vidéo : ils ne touchent pas à la boucle.
        if (!canvas && fullscreenElement() !== ref.current) toggle();
      }}
      onKeyDown={(event) => {
        if (event.key === " " || event.key === "Enter") {
          event.preventDefault();
          if (!canvas && fullscreenElement() !== ref.current) toggle();
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
    {video.hasAudio && !canvas && <LoopSound videoRef={ref} soundOn={!video.soundOff} onUnmute={play} />}
    {!canvas && <FullscreenButton videoRef={ref} />}
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
  edit = false,
}: {
  video: VideoView;
  width: number;
  height: number;
  /** Texte alternatif de l'œuvre, sinon son titre. */
  label: string;
  caption: React.ReactNode;
  texts: { pause: string; play: string };
  mediaLook?: MediaLook;
  /** Vue brouillon de l'éditeur : sur la toile en mode édition, pas de bouton plein écran (le clic choisit la place). */
  edit?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const { wantPlay, toggle, play } = useLoopPlayback(ref, video);
  const canvas = useEditCanvas(edit);
  const sd = video.sources.mp4.at(-1)!;
  const action = wantPlay ? texts.pause : texts.play;

  return (
    <div className="strip-frame group relative" data-loop={wantPlay ? "playing" : "paused"} data-video-mode="loop" {...soundAttrs(video)}>
      <button
        type="button"
        onClick={() => {
          if (fullscreenElement() !== ref.current) toggle();
        }}
        aria-label={label ? `${action} — ${label}` : action}
        className="loop-click block w-full text-left"
      >
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
      {video.hasAudio && <LoopSound videoRef={ref} soundOn={!video.soundOff} onUnmute={play} />}
      {!canvas && <FullscreenButton videoRef={ref} rail />}
    </div>
  );
}
