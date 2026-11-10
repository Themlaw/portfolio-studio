/**
 * Lecture d'une vidéo, au choix de l'illustratrice (lot 36) : module pur, lu par les rendus, les panneaux et barres de
 * l'éditeur et la migration.
 *
 * - « Boucle » (`loop`) : la vidéo tourne en boucle, muette, dans la page ; un clic ou un toucher la met en pause, un autre la relance.
 * - « Lecteur » (`player`) : la page montre l'image d'attente avec un bouton lecture ; un clic ouvre la vidéo en grand avec son lecteur.
 *
 * Où c'est stocké : `props.mode` d'un composant Vidéo (page, case de grille, composant de planche) ; `props.videoMode` d'une bande
 * (« Images qui défilent », bande du projet), où l'absence veut dire « chaque vidéo suit sa nature » (animation courte et muette
 * en boucle, vidéo longue en lecteur), le comportement d'avant.
 */

import { FR_LABELS } from "./block-msg";

export type VideoMode = "loop" | "player";
export const VIDEO_MODES: VideoMode[] = ["loop", "player"];
export const isVideoMode = (v: unknown): v is VideoMode => v === "loop" || v === "player";

/** Libellés courts (barres de la toile). */
export const VIDEO_MODE_LABELS: Record<VideoMode, string> = FR_LABELS.videoMode.label; // interface : t("videoMode.label." + mode)
/** Une phrase par mode (panneau). */
export const VIDEO_MODE_HINTS: Record<VideoMode, string> = FR_LABELS.videoMode.hint; // interface : t("videoMode.hint." + mode)

/** Options du panneau (liste déroulante) d'un composant Vidéo (français ; interface : `t("videoMode.option." + value)`). */
export const VIDEO_MODE_OPTIONS: { value: VideoMode; label: string }[] = [
  { value: "loop", label: FR_LABELS.videoMode.option.loop },
  { value: "player", label: FR_LABELS.videoMode.option.player },
];

/** Mode d'un composant Vidéo : sans réglage, le lecteur (le comportement d'avant). */
/** Options du panneau dans la langue de `tl` (espace blockRegLabels). */
export const videoModeOptions = (tl: (key: string) => string): { value: VideoMode; label: string }[] => VIDEO_MODES.map((m) => ({ value: m, label: tl(`videoMode.option.${m}`) }));

export const modeOf = (props: Record<string, unknown> | undefined): VideoMode => (isVideoMode(props?.mode) ? props.mode : "player");
