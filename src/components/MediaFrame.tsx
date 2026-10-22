import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

import { mediaLookAttrs, type MediaLook } from "@/lib/look";

/**
 * LA boîte d'une photo ou d'une vidéo (lot 64, A5 R1) : un seul porteur, pour l'image seule, la vidéo seule, la case d'une grille (page
 * et planche), le composant d'une planche, la place d'un carrousel, l'image de la Planche libre.
 *
 *  - Elle a EXACTEMENT la taille du média : c'est sur elle que se posent le cadre (bande ou cadre du thème), le fond, l'arrondi, le format
 *    (`--box-r` = largeur ÷ hauteur), le repère d'édition (`data-edit-media`) et l'attribut de la visionneuse (`data-viewer-item`). Un
 *    clic à côté de la photo n'ouvre rien ; les outils de la toile se calent sur elle.
 *  - Elle est un bloc au format fixe (`aspect-ratio`, `box-sizing: border-box`) : le cadre est DANS sa boîte, donc la taille extérieure ne
 *    change jamais (une grille garde ses rangées alignées, la Planche libre garde sa hauteur). Le média la remplit (`object-fit`).
 *  - Aucune règle d'habillage ailleurs que dans src/app/media-frame.css (et le cadre du kit, src/themes/variants.css, qui s'y accroche).
 *
 * Composant sans état : rendu côté serveur (blocs) comme côté client (VideoCard, StripRail).
 */
export type MediaFrameProps = Omit<HTMLAttributes<HTMLElement>, "style" | "className" | "children"> & {
  /** Cadre, fond et arrondi propre du média (voir `mediaLookAttrs`) ; absent = rien (le cadre du site « sur toutes les photos » reste appliqué aux photos). */
  look?: MediaLook;
  /** Largeur ÷ hauteur de la boîte : le format du média, ou le format imposé. Absent : la boîte suit son contenu. */
  ratio?: number;
  /** « contain » : le média entier, bandes vides si besoin (le fond de l'artiste les remplit) ; « cover » (défaut) : la boîte est remplie, le média rogné. */
  fit?: "contain" | "cover";
  /** Les vidéos n'ont jamais le cadre du réglage du site, et un fond de chargement (voile). */
  kind?: "image" | "video";
  className?: string;
  style?: CSSProperties;
  as?: "span" | "div";
  children: ReactNode;
  [data: `data-${string}`]: string | undefined;
};

export default function MediaFrame({ look, ratio, fit, kind = "image", className, style, as: As = "span", children, ...rest }: MediaFrameProps) {
  const render = mediaLookAttrs(look);
  return (
    <As
      {...rest}
      className={className ? `media-frame ${className}` : "media-frame"}
      data-kind={kind}
      {...(fit === "contain" ? { "data-fit": "contain" } : {})}
      {...render.attrs}
      style={{ ...(ratio && Number.isFinite(ratio) && ratio > 0 ? { "--box-r": ratio.toFixed(5) } : {}), ...render.style, ...style } as CSSProperties}
    >
      {children}
    </As>
  );
}
