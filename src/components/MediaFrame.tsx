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
  /** Largeur ÷ hauteur de la zone intérieure : ce que le média montre (son format, ou le format imposé). Le cadre ne la change JAMAIS : le média n'est jamais rogné de plus. Absent : suit son contenu. */
  ratio?: number;
  /** Format de la CASE qui contient la boîte (rangées justifiées, grille, carrousel, Planche libre : sa taille ne dépend pas du cadre). Par défaut `ratio` ; « Image entière » : le format imposé. */
  caseRatio?: number;
  /** Sans case : la boîte GRANDIT de l'épaisseur du cadre (image ou vidéo seule : rien à aligner), la zone intérieure garde son format. */
  grow?: boolean;
  /** Le fond de l'artiste remplit la CASE (image entière : les bandes vides sont colorées) et non la boîte. */
  caseBg?: boolean;
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

export default function MediaFrame({ look, ratio, caseRatio, grow = false, caseBg = false, fit, kind = "image", className, style, as: As = "span", children, ...rest }: MediaFrameProps) {
  const render = mediaLookAttrs(look);
  const own = caseBg ? { attrs: Object.fromEntries(Object.entries(render.attrs).filter(([k]) => k !== "data-img-bg")), style: Object.fromEntries(Object.entries(render.style).filter(([k]) => k !== "--img-bg")) } : render;
  const frame = (
    <As
      {...rest}
      className={className ? `media-frame ${className}` : "media-frame"}
      data-kind={kind}
      {...(fit === "contain" ? { "data-fit": "contain" } : {})}
      {...own.attrs}
      style={{ ...(ratio && Number.isFinite(ratio) && ratio > 0 ? { "--box-r": ratio.toFixed(5) } : {}), ...own.style, ...style } as CSSProperties}
    >
      {children}
    </As>
  );
  if (grow) return frame;
  const r = caseRatio ?? ratio;
  return (
    <As
      className="media-box"
      {...(caseBg && render.attrs["data-img-bg"] !== undefined ? { "data-img-bg": "" } : {})}
      style={{ ...(r && Number.isFinite(r) && r > 0 ? { "--case-r": r.toFixed(5) } : {}), ...(caseBg && render.style["--img-bg"] ? { "--img-bg": render.style["--img-bg"] } : {}) } as CSSProperties}
    >
      {frame}
    </As>
  );
}
