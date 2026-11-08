/**
 * Icônes des vidéos : UN fichier, un composant par dessin (contrat communs aux lots 121 et 127 : `contrat-icones-video-121-127.md`).
 * Elles se colorent par `currentColor` ; aucune ne porte de nom accessible (le bouton qui les porte a le sien : `aria-hidden`).
 *
 * Lot 121 (icônes dessinées dans le kit Photoshop) : chaque icône porte `data-vicon="<clé>"` et sa taille (`--vi`, en px).
 * Quand le thème a un dessin pour cette icône (`kit.vicons`, groupe « 5 · Vidéo » du kit), le CSS (variants.css, règles
 * `[data-kit-vicon-<clé>]`) efface le SVG ci-dessous et pose le dessin en masque teinté (même règle que les autres icônes du kit).
 * Sans dessin : le SVG d'origine, rendu identique à celui d'avant le lot.
 *
 * Où elles servent :
 * - SoundOnIcon / SoundOffIcon ... bouton son des boucles (LoopVideo.tsx, `LoopSound`) et du lecteur (VideoPlayer.tsx, `data-vp="mute"`) ;
 * - FullscreenIcon / ExitFullscreenIcon ... bouton plein écran des boucles et des lecteurs (lot 127, video-fullscreen.tsx) et barre du lecteur (VideoPlayer.tsx) ;
 * - LoopIcon / PlayIcon / PauseIcon ... badge vidéo (VideoBadge.tsx), gros bouton et barre du lecteur (VideoPlayer.tsx).
 * Fond du badge dessiné : CSS seul (`[data-kit-vicon-badge] .vid-badge`, variants.css).
 */
import type { CSSProperties } from "react";

type Size = { size?: number };
/** Lecture et pause : tailles du site différentes selon l'endroit (badge, gros bouton, barre du lecteur). Absent : taille du badge. */
type Box = { width?: number; height?: number };

/** Taille du dessin du kit (côté du carré, px) : le plus grand côté du SVG d'origine. */
const vi = (w: number, h = w): CSSProperties => ({ "--vi": `${Math.max(w, h)}px` }) as CSSProperties;

/** Haut-parleur avec ondes : le son est actif. */
export function SoundOnIcon({ size = 16 }: Size) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" data-icon="sound-on" data-vicon="sound" style={vi(size)}>
      <path d="M4 9h4l5-4v14l-5-4H4Z" fill="currentColor" />
      <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** Haut-parleur barré : le son est coupé. */
export function SoundOffIcon({ size = 16 }: Size) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" data-icon="sound-off" data-vicon="muted" style={vi(size)}>
      <path d="M4 9h4l5-4v14l-5-4H4Z" fill="currentColor" />
      <path d="m16 9 5 6m0-6-5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}

/** Quatre coins qui s'écartent : passer en plein écran. */
export function FullscreenIcon({ size = 16 }: Size) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" data-icon="fullscreen" data-vicon="fullscreen" style={vi(size)}>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** Quatre coins qui se resserrent : quitter le plein écran. */
export function ExitFullscreenIcon({ size = 16 }: Size) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" data-icon="fullscreen-exit" data-vicon="exitFullscreen" style={vi(size)}>
      <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/** Deux flèches en cercle : boucle. */
export function LoopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" data-icon="loop" data-vicon="loop" style={vi(14)}>
      <path d="M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

/** Triangle : lecture (taille du badge par défaut ; `width` / `height` pour le gros bouton et la barre du lecteur). */
export function PlayIcon({ width = 12, height = 14 }: Box = {}) {
  return (
    <svg width={width} height={height} viewBox="0 0 16 18" aria-hidden="true" data-icon="play" data-vicon="play" style={vi(width, height)}>
      <path d="M2 1.5 14.5 9 2 16.5Z" fill="currentColor" />
    </svg>
  );
}

/** Deux barres : pause (taille du badge par défaut ; `width` / `height` pour la barre du lecteur). */
export function PauseIcon({ width = 10, height = 12 }: Box = {}) {
  return (
    <svg width={width} height={height} viewBox="0 0 12 14" aria-hidden="true" data-icon="pause" data-vicon="pause" style={vi(width, height)}>
      <rect x="1" y="1" width="3.5" height="12" fill="currentColor" />
      <rect x="7.5" y="1" width="3.5" height="12" fill="currentColor" />
    </svg>
  );
}

/** Noms des icônes vidéo (clés de `kit.vicons`). */
export type VideoIconName = "play" | "pause" | "loop" | "sound" | "muted" | "fullscreen" | "exitFullscreen";

/** Point d'accès par nom (`<VideoIcon name="fullscreen" />`) : la même icône que l'export nommé correspondant. */
export function VideoIcon({ name, size, width, height }: { name: VideoIconName; size?: number; width?: number; height?: number }) {
  switch (name) {
    case "play":
      return <PlayIcon width={width} height={height} />;
    case "pause":
      return <PauseIcon width={width} height={height} />;
    case "loop":
      return <LoopIcon />;
    case "sound":
      return <SoundOnIcon size={size} />;
    case "muted":
      return <SoundOffIcon size={size} />;
    case "fullscreen":
      return <FullscreenIcon size={size} />;
    case "exitFullscreen":
      return <ExitFullscreenIcon size={size} />;
  }
}
