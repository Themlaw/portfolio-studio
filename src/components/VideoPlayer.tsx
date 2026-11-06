"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import type { VideoView } from "@/lib/media";

import { useReducedMotion } from "./LoopVideo";
import { ExitFullscreenIcon, FullscreenIcon, PauseIcon, PlayIcon, SoundOffIcon, SoundOnIcon } from "./video-icons";
import { MANAGED_ATTR, useSoloPlayback } from "./video-playback";

/** Délai sans geste avant de masquer les commandes pendant la lecture. */
const IDLE_MS = 2500;
const SEEK_STEP = 10;

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };
type IosVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

/**
 * Lecteur vidéo du site (bloc « Vidéo » en mode lecteur, visionneuse) :
 * commandes maison sur un <video> natif — mêmes sources qu'avant (1080 sur
 * grand écran, 720 sinon), donc même lecture progressive en HTTP Range (206).
 *
 * Commandes : lecture / pause, barre de progression cliquable et glissable
 * (retour en arrière compris), temps écoulé / durée, « Revoir » à la fin,
 * reculer / avancer de 10 s, son (muet, volume), plein écran. Clavier
 * (focus sur le lecteur) : Espace ou K, ← / → (± 10 s), Début / Fin, F (plein écran), M (muet). Les commandes se
 * masquent pendant la lecture après un moment sans geste et reviennent au
 * moindre mouvement, au focus ou à la pause. Couleurs : jetons du thème
 * (classes .vp-*, globals/medias.css). Aucun état React à chaque image : la
 * progression est peinte dans un requestAnimationFrame.
 */
export default function VideoPlayer({
  video,
  width,
  height,
  label,
  autoPlay = false,
  loop = false,
  muted: startMuted = false,
  className = "",
  videoClassName = "",
}: {
  video: VideoView;
  width: number;
  height: number;
  label?: string;
  autoPlay?: boolean;
  loop?: boolean;
  muted?: boolean;
  className?: string;
  videoClassName?: string;
}) {
  const t = useTranslations("player");
  const reduced = useReducedMotion();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const seekRef = useRef<HTMLDivElement | null>(null);
  const fillRef = useRef<HTMLDivElement | null>(null);
  const bufferRef = useRef<HTMLDivElement | null>(null);
  const frame = useRef(0);
  const idleTimer = useRef<number | undefined>(undefined);
  const scrub = useRef<{ resume: boolean; x: number | null } | null>(null);

  const [state, setState] = useState<"paused" | "playing" | "ended">("paused");
  const [muted, setMuted] = useState(startMuted);
  const [volume, setVolume] = useState(1);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(video.duration || 0);
  const [fullscreen, setFullscreen] = useState(false);
  const [idle, setIdle] = useState(false);
  // Une autre vidéo démarre (lot 116) : celle-ci est mise en pause par le gestionnaire commun ; son état suit l'événement « pause ».
  useSoloPlayback(videoRef);
  const hasAudio = video.hasAudio;

  const hd = video.sources.mp4.find((s) => Math.min(s.w, s.h) >= 1080);
  const sd = video.sources.mp4.find((s) => s !== hd) ?? video.sources.mp4[0];

  const durationRef = useRef(duration);
  useEffect(() => {
    durationRef.current = duration;
  }, [duration]);

  /** Progression et tampon peints directement (une fois par image au plus ; en continu pendant la lecture). */
  const schedule = useCallback(() => {
    const paintFrame = () => {
      frame.current = 0;
      const v = videoRef.current;
      if (!v) return;
      const d = v.duration || durationRef.current || 0;
      const s = scrub.current;
      if (s && s.x !== null && seekRef.current && d) {
        const rect = seekRef.current.getBoundingClientRect();
        v.currentTime = Math.min(d, Math.max(0, ((s.x - rect.left) / rect.width) * d));
        s.x = null;
      }
      const p = d ? Math.min(1, v.currentTime / d) : 0;
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${p.toFixed(4)})`;
      seekRef.current?.style.setProperty("--vp-p", p.toFixed(4));
      if (bufferRef.current && v.buffered.length && d) {
        bufferRef.current.style.transform = `scaleX(${Math.min(1, v.buffered.end(v.buffered.length - 1) / d).toFixed(4)})`;
      }
      if (!v.paused && !v.ended) frame.current = requestAnimationFrame(paintFrame);
    };
    if (!frame.current) frame.current = requestAnimationFrame(paintFrame);
  }, []);

  /** Un geste : commandes visibles, masquées de nouveau après un moment si la lecture continue. */
  const wake = useCallback(() => {
    setIdle(false);
    window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      const v = videoRef.current;
      const inBar = rootRef.current?.querySelector(".vp-bar")?.contains(document.activeElement);
      if (v && !v.paused && !v.ended && !inBar && !scrub.current) setIdle(true);
    }, IDLE_MS);
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const sync = () => {
      const next = v.ended ? "ended" : v.paused ? "paused" : "playing";
      setState(next);
      // Lecture : compte à rebours du masquage ; arrêt ou fin : commandes visibles.
      if (next === "playing") wake();
      else {
        window.clearTimeout(idleTimer.current);
        setIdle(false);
      }
      schedule();
    };
    const onTime = () => setTime(v.currentTime);
    const onMeta = () => {
      if (Number.isFinite(v.duration)) setDuration(v.duration);
      schedule();
    };
    const onVolume = () => {
      setMuted(v.muted);
      setVolume(v.volume);
    };
    const events: [string, () => void][] = [
      ["play", sync],
      ["playing", sync],
      ["pause", sync],
      ["ended", sync],
      ["seeked", schedule],
      ["progress", schedule],
      ["timeupdate", onTime],
      ["loadedmetadata", onMeta],
      ["durationchange", onMeta],
      ["volumechange", onVolume],
    ];
    for (const [name, fn] of events) v.addEventListener(name, fn);
    // Pas de bouton « caster » superposé par le navigateur (commandes maison).
    v.disableRemotePlayback = true;
    sync();
    onMeta();
    return () => {
      for (const [name, fn] of events) v.removeEventListener(name, fn);
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [schedule, wake]);

  // Lecture automatique demandée (visionneuse) : jamais en « réduire les animations » pour une boucle.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !autoPlay || (loop && reduced)) return;
    void v.play().catch(() => {});
  }, [autoPlay, loop, reduced]);

  useEffect(() => {
    const onFs = () => {
      const doc = document as FsDoc;
      setFullscreen((doc.fullscreenElement ?? doc.webkitFullscreenElement) === rootRef.current);
    };
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("webkitfullscreenchange", onFs);
      window.clearTimeout(idleTimer.current);
    };
  }, []);

  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.ended) v.currentTime = 0;
    if (v.paused || v.ended) void v.play().catch(() => {});
    else v.pause();
  }, []);

  const seekBy = useCallback(
    (delta: number) => {
      const v = videoRef.current;
      if (!v) return;
      const d = v.duration || duration;
      v.currentTime = Math.min(d || Infinity, Math.max(0, v.currentTime + delta));
      setTime(v.currentTime);
      schedule();
    },
    [duration, schedule],
  );

  const seekTo = useCallback(
    (seconds: number) => {
      const v = videoRef.current;
      if (!v) return;
      v.currentTime = Math.min(v.duration || duration || 0, Math.max(0, seconds));
      setTime(v.currentTime);
      schedule();
    },
    [duration, schedule],
  );

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (v) v.muted = !v.muted;
  }, []);

  const toggleFullscreen = useCallback(() => {
    const root = rootRef.current as FsEl | null;
    const doc = document as FsDoc;
    if (!root) return;
    if (doc.fullscreenElement ?? doc.webkitFullscreenElement) {
      if (document.exitFullscreen) void document.exitFullscreen().catch(() => {});
      else doc.webkitExitFullscreen?.();
      return;
    }
    if (root.requestFullscreen) void root.requestFullscreen().catch(() => {});
    else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
    // iPhone : seul l'élément vidéo passe en plein écran (lecteur du système).
    else (videoRef.current as IosVideo | null)?.webkitEnterFullscreen?.();
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    const onButton = target.tagName === "BUTTON";
    // Curseur de volume : ses flèches règlent le volume, pas la position.
    if (target.tagName === "INPUT" && (event.key === "ArrowLeft" || event.key === "ArrowRight")) return;
    const onSlider = target === seekRef.current;
    const key = event.key;
    let handled = true;
    if ((key === " " && !onButton) || key === "k" || key === "K") toggle();
    else if (key === "ArrowLeft") seekBy(-SEEK_STEP);
    else if (key === "ArrowRight") seekBy(SEEK_STEP);
    else if (key === "Home" && onSlider) seekTo(0);
    else if (key === "End" && onSlider) seekTo(duration);
    else if (key === "PageUp" && onSlider) seekBy(duration / 10);
    else if (key === "PageDown" && onSlider) seekBy(-duration / 10);
    else if (key === "f" || key === "F") toggleFullscreen();
    else if (key === "m" || key === "M") toggleMute();
    else handled = false;
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
      wake();
    }
  };

  /** Position sous le pointeur, appliquée tout de suite (clic, fin du glisser). */
  const seekAt = (clientX: number) => {
    const v = videoRef.current;
    const el = seekRef.current;
    const d = v?.duration || duration;
    if (!v || !el || !d) return;
    const rect = el.getBoundingClientRect();
    v.currentTime = Math.min(d, Math.max(0, ((clientX - rect.left) / rect.width) * d));
    setTime(v.currentTime);
    schedule();
  };

  const onSeekDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    if (!v || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    scrub.current = { resume: !v.paused && !v.ended, x: null };
    v.pause();
    rootRef.current?.setAttribute("data-scrubbing", "");
    seekAt(event.clientX);
  };
  const onSeekMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!scrub.current) return;
    scrub.current.x = event.clientX;
    schedule();
  };
  const onSeekUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const s = scrub.current;
    if (!s) return;
    scrub.current = null;
    rootRef.current?.removeAttribute("data-scrubbing");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    // Dernière position du glisser appliquée telle quelle (pas d'image de retard).
    if (event.type === "pointerup") seekAt(event.clientX);
    const v = videoRef.current;
    if (v && s.resume) void v.play().catch(() => {});
  };

  const playLabel = state === "ended" ? t("replay") : state === "playing" ? t("pause") : t("play");
  const valueText = t("time", { current: clock(time), total: clock(duration) });

  return (
    <div
      ref={rootRef}
      className={`vp ${className}`}
      data-state={state}
      data-idle={idle || undefined}
      data-fullscreen={fullscreen || undefined}
      role="group"
      aria-label={label ? t("label", { title: label }) : t("labelNoTitle")}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerMove={wake}
      onPointerDown={wake}
      onFocus={wake}
    >
      <video
        ref={videoRef}
        {...{ [MANAGED_ATTR]: "" }}
        poster={video.sources.poster.largest.webp}
        preload="metadata"
        playsInline
        muted={startMuted}
        loop={loop}
        width={width}
        height={height}
        className={`vp-video ${videoClassName}`}
        aria-label={label}
        tabIndex={-1}
        onClick={toggle}
        onDoubleClick={toggleFullscreen}
        style={video.sources.poster.color ? { backgroundColor: video.sources.poster.color } : undefined}
      >
        {hd && <source src={hd.src} type="video/mp4" media="(min-width: 1280px)" />}
        <source src={sd.src} type="video/mp4" />
      </video>

      {state !== "playing" && (
        <button type="button" className="vp-big" onClick={toggle} aria-label={label ? `${playLabel} — ${label}` : playLabel}>
          {state === "ended" ? (
            <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
              <path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7Z" fill="currentColor" />
            </svg>
          ) : (
            <PlayIcon width={22} height={24} />
          )}
          {state === "ended" && <span className="vp-big-text">{t("replay")}</span>}
        </button>
      )}

      <div className="vp-bar" role="group" aria-label={t("controls")}>
        <button type="button" className="vp-btn" onClick={toggle} aria-label={playLabel} data-vp="play">
          {state === "playing" ? (
            <PauseIcon width={12} height={14} />
          ) : state === "ended" ? (
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7Z" fill="currentColor" />
            </svg>
          ) : (
            <PlayIcon width={13} height={15} />
          )}
        </button>

        <button type="button" className="vp-btn vp-skip" onClick={() => seekBy(-SEEK_STEP)} aria-label={t("back")} data-vp="back">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7Z" fill="currentColor" />
          </svg>
          <span className="vp-skip-num" aria-hidden="true">
            10
          </span>
        </button>
        <button type="button" className="vp-btn vp-skip" onClick={() => seekBy(SEEK_STEP)} aria-label={t("forward")} data-vp="forward">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" style={{ transform: "scaleX(-1)" }}>
            <path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7Z" fill="currentColor" />
          </svg>
          <span className="vp-skip-num" aria-hidden="true">
            10
          </span>
        </button>

        <span className="vp-time" aria-hidden="true">
          {clock(time)} <span className="vp-time-sep">/</span> {clock(duration)}
        </span>

        <div
          ref={seekRef}
          className="vp-seek"
          role="slider"
          tabIndex={0}
          aria-label={t("seek")}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={valueText}
          onPointerDown={onSeekDown}
          onPointerMove={onSeekMove}
          onPointerUp={onSeekUp}
          onPointerCancel={onSeekUp}
        >
          <div className="vp-seek-track">
            <div ref={bufferRef} className="vp-seek-buffer" />
            <div ref={fillRef} className="vp-seek-fill" />
          </div>
          <div className="vp-seek-thumb" />
        </div>

        {hasAudio && (
          <>
        <button type="button" className="vp-btn" onClick={toggleMute} aria-label={muted ? t("unmute") : t("mute")} aria-pressed={muted} data-vp="mute">
          {muted ? <SoundOffIcon size={18} /> : <SoundOnIcon size={18} />}
        </button>

        <input
          type="range"
          className="vp-volume"
          min={0}
          max={1}
          step={0.05}
          value={muted ? 0 : volume}
          aria-label={t("volume")}
          data-vp="volume"
          onChange={(event) => {
            const v = videoRef.current;
            if (!v) return;
            const next = Number(event.target.value);
            v.volume = next;
            v.muted = next === 0;
          }}
        />
          </>
        )}

        <button type="button" className="vp-btn" onClick={toggleFullscreen} aria-label={fullscreen ? t("exitFullscreen") : t("fullscreen")} data-vp="fullscreen">
          {fullscreen ? <ExitFullscreenIcon size={18} /> : <FullscreenIcon size={18} />}
        </button>
      </div>
    </div>
  );
}
