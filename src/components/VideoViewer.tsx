"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";

import type { VideoView } from "@/lib/media";

import VideoPlayer from "./VideoPlayer";
import { startsMuted } from "./visitor-sound";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Visionneuse d'une vidéo en grand (mode « Lecteur ») : fond sombre plein cadre (celui de la visionneuse d'images),
 * la vidéo centrée avec son vrai lecteur (VideoPlayer : lecture / pause, ± 10 s, progression, son, plein écran).
 * Se ferme par ×, Échap ou un clic hors de la vidéo. Le focus est piégé dedans (Tab boucle sur les commandes),
 * placé sur le lecteur (donc Espace, ← / →, M, F répondent tout de suite), puis rendu au déclencheur à la fermeture.
 * Posée dans <body> : un parent transformé (carte qui se soulève au survol) ne la déplace pas.
 */
export default function VideoViewer({
  video,
  width,
  height,
  title,
  fullscreen = false,
  onClose,
}: {
  video: VideoView;
  width: number;
  height: number;
  title: string;
  /** Ouverte par le bouton « Plein écran » du cadre (lot 127) : le lecteur se met en plein écran. */
  fullscreen?: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("player");
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  // Avant la première image : le focus est dans la visionneuse et le piège en place dès l'ouverture (pas de Tab perdu entre les deux).
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.querySelector<HTMLElement>(".vp")?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement);
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (!dialog.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      // Retour au déclencheur (s'il est encore là).
      if (trigger && document.contains(trigger)) trigger.focus();
    };
  }, []);

  const ratio = width > 0 && height > 0 ? width / height : 16 / 9;

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={title ? t("viewer", { title }) : t("viewerNoTitle")}
      className="video-viewer fixed inset-0 z-[80] flex flex-col"
      data-testid="video-viewer"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex items-center justify-between gap-4 px-5 py-4 md:px-8" onClick={(event) => event.target === event.currentTarget && onClose()}>
        <span className="eyebrow min-w-0 truncate text-on-scrim">{title}</span>
        <button type="button" onClick={onClose} className="btn btn-ghost border-line/30 text-on-scrim hover:bg-on-scrim/10 hover:text-on-scrim" data-testid="video-viewer-close">
          {t("close")}
          <span aria-hidden="true" data-icon="close">
            ✕
          </span>
        </button>
      </div>
      <div
        className="video-viewer-stage"
        onClick={(event) => {
          // Hors de la vidéo (les bords noirs de la scène) : fermeture.
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div style={{ aspectRatio: String(ratio), width: `min(100%, calc((100dvh - 7rem) * ${ratio.toFixed(4)}))` }}>
          <VideoPlayer video={video} width={width} height={height} label={title} autoPlay muted={startsMuted(video)} startFullscreen={fullscreen} className="h-full w-full" videoClassName="h-full w-full bg-scrim object-contain" />
        </div>
      </div>
    </div>,
    document.body,
  );
}
