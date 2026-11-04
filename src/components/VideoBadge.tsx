import type { ReactNode } from "react";

/** Icône « boucle » (deux flèches en cercle). */
export function LoopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" data-icon="loop">
      <path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

export function PlayIcon() {
  return (
    <svg width="12" height="14" viewBox="0 0 16 18" aria-hidden="true" data-icon="play">
      <path d="M2 1.5 14.5 9 2 16.5Z" fill="currentColor" />
    </svg>
  );
}

/**
 * Badge d'une vidéo (lot 116) : UN composant pour tous les contextes (bloc vidéo, case de grille, rail, carrousel, planche de projet,
 * planche libre), même coin (bas droit), même style (jetons du thème, `.vid-badge` de medias.css), même information :
 * - `player` (Lecteur) : ▶ puis la durée ;
 * - `loop` (Boucle) : l'icône boucle, et l'état lecture / pause quand la boucle est cliquable (`playing`).
 * Posé dans la boîte de la vidéo (position absolue) ; jamais un contrôle seul : le bouton qui le porte a son nom.
 */
export default function VideoBadge({ kind, duration, playing, label, className = "", extra }: { kind: "loop" | "player"; duration?: string; playing?: boolean; label?: string; className?: string; extra?: ReactNode }) {
  if (kind === "loop") {
    return (
      <span className={`vid-badge loop-mark ${className}`} aria-hidden="true" data-badge="loop" data-mark={playing ? "pause" : "play"}>
        {playing ? (
          <svg width="10" height="12" viewBox="0 0 12 14" aria-hidden="true">
            <rect x="1" y="1" width="3.5" height="12" fill="currentColor" />
            <rect x="7.5" y="1" width="3.5" height="12" fill="currentColor" />
          </svg>
        ) : (
          <PlayIcon />
        )}
        <LoopIcon />
        {extra}
      </span>
    );
  }
  return (
    <span className={`vid-badge ${className}`} data-badge="player">
      <PlayIcon />
      {duration ? <span className="vid-badge-time">{duration}</span> : null}
      {label ? <span className="sr-only"> — {label}</span> : null}
    </span>
  );
}
