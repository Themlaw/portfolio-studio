"use client";

import type { RefObject } from "react";
import { useTranslations } from "next-intl";

import { FullscreenIcon } from "./video-icons";

type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };
type IosVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

/** Élément actuellement en plein écran (API standard, sinon préfixée). */
export function fullscreenElement(): Element | null {
  const doc = document as FsDoc;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

/**
 * Passe `target` en plein écran. iPhone : Safari n'offre pas l'API sur un élément quelconque, seulement sur la vidéo
 * (`webkitEnterFullscreen`, lecteur du système) : repli sur `video`.
 */
export function enterFullscreen(target: HTMLElement, video: HTMLVideoElement | null): void {
  const el = target as FsEl;
  const ios = () => {
    const v = video as IosVideo | null;
    if (!v?.webkitEnterFullscreen) return;
    try {
      v.webkitEnterFullscreen();
    } catch {
      // Une boucle qui n'a encore rien chargé (preload « none ») : iOS refuse tant que la vidéo n'a pas ses métadonnées ; on les charge, puis on réessaie.
      v.preload = "metadata";
      v.addEventListener(
        "loadedmetadata",
        () => {
          try {
            v.webkitEnterFullscreen?.();
          } catch {}
        },
        { once: true },
      );
      v.load();
    }
  };
  if (typeof el.requestFullscreen === "function") void el.requestFullscreen().catch(ios);
  else if (typeof el.webkitRequestFullscreen === "function") el.webkitRequestFullscreen();
  else ios();
}

export function exitFullscreen(): void {
  const doc = document as FsDoc;
  if (typeof document.exitFullscreen === "function") void document.exitFullscreen().catch(() => {});
  else doc.webkitExitFullscreen?.();
}

/**
 * Bouton « Plein écran » posé sur une vidéo (lot 127), EN BAS À GAUCHE (le badge reste en bas à droite, le bouton son en haut à droite) :
 * même style que les badges (`.vid-badge`, jetons du thème), cible de 44 px au doigt, focus visible. Posé en frère de l'élément qui
 * porte le clic de la vidéo (jamais dedans : pas de bouton dans un bouton), il n'arrête ni ne lance la lecture.
 * - boucle : la vidéo elle-même passe en plein écran (`videoRef`), ses commandes natives apparaissent le temps du plein écran (LoopVideo.tsx) ;
 * - lecteur dans la page : `onActivate` ouvre le lecteur, qui se met en plein écran (VideoViewer).
 * L'icône vient de video-icons.tsx.
 */
export function FullscreenButton({
  videoRef,
  onActivate,
  rail = false,
}: {
  videoRef?: RefObject<HTMLVideoElement | null>;
  onActivate?: () => void;
  /** Place d'un carrousel : le bouton est posé sur la case entière (pas dans la boîte du média), calé sur la hauteur de la bande. */
  rail?: boolean;
}) {
  const t = useTranslations("player");
  return (
    <button
      type="button"
      className={`vid-badge vid-fs${rail ? " vid-fs-rail" : ""}`}
      data-testid="video-fullscreen"
      aria-label={t("fullscreen")}
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        if (onActivate) return onActivate();
        const video = videoRef?.current ?? null;
        if (!video) return;
        if (fullscreenElement() === video) exitFullscreen();
        else enterFullscreen(video, video);
      }}
    >
      <FullscreenIcon />
    </button>
  );
}
