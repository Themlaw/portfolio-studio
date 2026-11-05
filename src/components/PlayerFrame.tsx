"use client";

import { Frame } from "./AnimationShowcase";
import type { LocalizedArtwork } from "@/lib/gallery";
import type { MediaLook } from "@/lib/look";

/**
 * Vidéo en mode « Lecteur » posée hors d'un bloc vidéo (planche libre, lot 116) : le même cadre que partout (`Frame` : image d'attente,
 * badge ▶ + durée, un clic ouvre la visionneuse avec le son). Enveloppe cliente : un composant serveur ne peut pas passer de fonction.
 */
export default function PlayerFrame({ item, mediaLook, ratio, edit, attrs }: { item: LocalizedArtwork; mediaLook?: MediaLook; ratio: number; edit?: boolean; attrs?: Record<string, string | undefined> }) {
  return <Frame item={item} playing={false} onPlay={() => {}} mediaLook={mediaLook} ratio={ratio} grow={false} edit={edit} attrs={attrs} />;
}
