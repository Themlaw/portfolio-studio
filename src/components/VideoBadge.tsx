import type { ReactNode } from "react";

import { LoopIcon, PauseIcon, PlayIcon } from "./video-icons";

/**
 * Badge d'une vidéo (lot 116) : UN composant pour tous les contextes (bloc vidéo, case de grille, rail, carrousel, planche de projet,
 * planche libre), même coin (bas droit), même style (jetons du thème, `.vid-badge` de medias.css), même information :
 * - `player` (Lecteur) : ▶ puis la durée ;
 * - `loop` (Boucle) : l'icône boucle, et l'état lecture / pause quand la boucle est cliquable (`playing`).
 * Posé dans la boîte de la vidéo (position absolue) ; jamais un contrôle seul : le bouton qui le porte a son nom.
 * Les dessins (boucle, lecture, pause) viennent de video-icons.tsx (lot 127 : un seul fichier d'icônes vidéo, remplaçable par le kit au lot 121).
 */
export default function VideoBadge({ kind, duration, playing, label, className = "", extra }: { kind: "loop" | "player"; duration?: string; playing?: boolean; label?: string; className?: string; extra?: ReactNode }) {
  if (kind === "loop") {
    return (
      <span className={`vid-badge loop-mark ${className}`} aria-hidden="true" data-badge="loop" data-mark={playing ? "pause" : "play"}>
        {playing ? <PauseIcon /> : <PlayIcon />}
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
