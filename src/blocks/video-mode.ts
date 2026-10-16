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

export type VideoMode = "loop" | "player";
export const VIDEO_MODES: VideoMode[] = ["loop", "player"];
export const isVideoMode = (v: unknown): v is VideoMode => v === "loop" || v === "player";

/** Libellés courts (barres de la toile). */
export const VIDEO_MODE_LABELS: Record<VideoMode, string> = { loop: "Boucle", player: "Lecteur" };
/** Une phrase par mode (panneau). */
export const VIDEO_MODE_HINTS: Record<VideoMode, string> = {
  loop: "Boucle : la vidéo tourne en boucle, sans le son. Un clic la met en pause, un autre la relance.",
  player: "Lecteur : un clic ouvre la vidéo en grand, avec ses commandes et le son.",
};

/** Options du panneau (liste déroulante) d'un composant Vidéo. */
export const VIDEO_MODE_OPTIONS: { value: VideoMode; label: string }[] = [
  { value: "loop", label: "Boucle (sans le son)" },
  { value: "player", label: "Lecteur (s'ouvre en grand)" },
];

/** Mode d'un composant Vidéo : sans réglage, le lecteur (le comportement d'avant). */
export const modeOf = (props: Record<string, unknown> | undefined): VideoMode => (isVideoMode(props?.mode) ? props.mode : "player");
