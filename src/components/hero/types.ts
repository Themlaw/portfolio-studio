import type { CSSProperties } from "react";

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
  /** Libellé de l'indicateur de défilement (défaut : message de l'interface) et son affichage. */
  scroll: string;
  showScroll: boolean;
  /** Libellé du bouton demoreel (hero projecteur). */
  reel: string;
  background?: HeroBackground | null;
  /** Vue brouillon de l'éditeur : repères des textes et du fond (jamais en public). */
  edit?: boolean;
  /** Styles locaux des textes (barre typographique de l'éditeur, lot 2). */
  styles?: { eyebrow?: CSSProperties; statement?: CSSProperties; name?: CSSProperties; role?: CSSProperties; scroll?: CSSProperties; reel?: CSSProperties };
};

/** Repères d'édition : texte du bloc (data-inline) ou texte commun au site (data-site-inline). */
export function heroMarks(content: HeroContent) {
  const e = Boolean(content.edit);
  const st = (s: CSSProperties | undefined) => (s ? { style: s } : {});
  return {
    eyebrow: { ...(e ? { "data-inline": "eyebrow", "data-placeholder": "Étiquette" } : {}), ...st(content.styles?.eyebrow) },
    name: { ...(e ? { "data-site-inline": "name", "data-placeholder": "Ton nom", "data-site-hint": "commun à toutes les pages" } : {}), ...st(content.styles?.name) },
    // Phrase d'accroche : texte à passage surligné, édité par la toile avec sa propre barre (EditLayer).
    statement: { ...(e ? { "data-inline": "statement", "data-marked": "" } : {}), ...st(content.styles?.statement) },
    scroll: { ...(e ? { "data-inline": "scroll", "data-placeholder": "Faire défiler" } : {}), ...st(content.styles?.scroll) },
    reel: { ...(e ? { "data-inline": "reel", "data-placeholder": "Demoreel" } : {}), ...st(content.styles?.reel) },
    // `data-hero-text` (public aussi) : le fond du métier se règle (src/app/look.css).
    role: { "data-hero-text": "role", ...(e ? { "data-site-inline": "role", "data-placeholder": "Ton métier", "data-site-hint": "commun à toutes les pages" } : {}), ...st(content.styles?.role) },
  };
}
