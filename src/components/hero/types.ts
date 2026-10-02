import type { PictureSources } from "@/lib/images/variants";
import type { VideoView } from "@/lib/media";

/** Image ou vidéo de fond choisie dans l'éditeur (remplace le décor du thème). */
export type HeroBackground = {
  src: string;
  sources: PictureSources | null;
  video: VideoView | null;
  width: number;
  height: number;
};

/** Textes du hero : identité (réglages) + bloc « hero » (base). */
export type HeroContent = {
  name: string;
  role: string;
  eyebrow: string;
  /** Phrase du hero type-only ; <mark>…</mark> signale le mot mis en valeur. */
  statement: string;
  /** Chemin (sans langue) de la page animation, pour le bouton demoreel. */
  reelHref: string;
  background?: HeroBackground | null;
  /** Vue brouillon de l'éditeur : repères des textes et du fond (jamais en public). */
  edit?: boolean;
};

/** Repères d'édition : texte du bloc (data-inline) ou texte commun au site (data-site-inline). */
export function heroMarks(content: HeroContent) {
  const e = Boolean(content.edit);
  return {
    eyebrow: e ? { "data-inline": "eyebrow", "data-placeholder": "Étiquette" } : {},
    name: e ? { "data-site-inline": "name", "data-placeholder": "Ton nom", "data-site-hint": "commun à toutes les pages" } : {},
    role: e ? { "data-site-inline": "role", "data-placeholder": "Ton métier", "data-site-hint": "commun à toutes les pages" } : {},
  };
}
