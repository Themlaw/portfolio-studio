/**
 * Son au départ d'une vidéo, au choix de l'artiste (lot 127) : module pur, lu par les rendus, les panneaux et barres de l'éditeur.
 *
 * - « Activé » (`on`, le défaut) : la vidéo parle dès que le visiteur la lance (le navigateur n'autorise le son qu'après un geste du
 *   visiteur : voir src/components/visitor-sound.ts) ;
 * - « Coupé » (`off`) : la vidéo démarre muette, le bouton son la remet.
 * Sans effet pour une vidéo sans son. Le choix du visiteur (bouton son) prime pendant sa visite.
 *
 * Où c'est stocké (champ facultatif, sans migration ; absent = activé, « Activé » retire le champ) : `props.sound` d'un composant Vidéo
 * (page, case de grille, composant de planche), `look.slotLook[place].sound` d'une place de carrousel, `sound` d'une ligne de la Planche libre.
 */

export type VideoSound = "on" | "off";
export const VIDEO_SOUNDS: VideoSound[] = ["on", "off"];
export const isVideoSound = (v: unknown): v is VideoSound => v === "on" || v === "off";

/** Réglage d'une vidéo : sans réglage (ou valeur inconnue), activé. */
export const soundOf = (props: Record<string, unknown> | undefined): VideoSound => (props?.sound === "off" ? "off" : "on");

export const VIDEO_SOUND_LABELS: Record<VideoSound, string> = { on: "Activé", off: "Coupé" };
export const VIDEO_SOUND_HINTS: Record<VideoSound, string> = {
  on: "Son activé : la vidéo parle dès que le visiteur la lance (le navigateur l'exige après un clic).",
  off: "Son coupé : la vidéo démarre sans le son, le bouton son le remet.",
};
export const VIDEO_SOUND_OPTIONS: { value: VideoSound; label: string }[] = [
  { value: "on", label: "Activé" },
  { value: "off", label: "Coupé" },
];

/**
 * Copie d'une vidéo (VideoView) portant le réglage « Son au départ » de CE rendu. Le réglage est propre à l'emplacement, pas au média :
 * on ne l'écrit jamais dans le média, seulement dans la copie que reçoivent les composants. Sans effet pour une vidéo sans son.
 */
export function withSound<V extends { hasAudio: boolean }>(video: V, sound: unknown): V & { soundOff?: boolean } {
  return sound === "off" && video.hasAudio ? { ...video, soundOff: true } : video;
}

/** Repères de la boîte d'une vidéo AVEC son (barres de la toile et tests) : `data-video-audio` et `data-video-sound` (on | off). Rien sans son. */
export function soundAttrs(video: { hasAudio: boolean; soundOff?: boolean } | null | undefined): Record<string, string> {
  return video?.hasAudio ? { "data-video-audio": "", "data-video-sound": video.soundOff ? "off" : "on" } : {};
}
