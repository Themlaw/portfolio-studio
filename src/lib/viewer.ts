import type { CropFallback } from "@/components/Picture";
import type { PictureSources } from "@/lib/images/variants";
import type { VideoView } from "@/lib/media";

/**
 * Visionneuse « cliquer pour agrandir » (lot 44) : ce qu un composant donne à la visionneuse (Lightbox) pour UNE image ou
 * UNE vidéo. `LocalizedArtwork` (bande d images) y est directement compatible.
 *
 * Branchement d un composant (module sans état, lu par le serveur) :
 * 1. le composant pose `viewerAttrs(item)` sur l élément cliquable (image ou case) ;
 * 2. il est rendu DANS un `ViewerScope` (src/components/ViewerScope.tsx), qui rassemble les éléments `[data-viewer-item]` de
 *    son contenu DANS L ORDRE DU DOCUMENT, ouvre la visionneuse sur celui qu on a cliqué et fait défiler les autres en boucle.
 *    Une image seule : sa section est le ViewerScope. Une grille : toute la grille. Planche libre (lot 42) : un ViewerScope
 *    autour de la planche, `viewerAttrs` sur chaque image ; rien d autre à écrire.
 * 3. `passive: true` : l élément est dans la suite mais son clic reste à lui (vidéo en lecteur ou en boucle).
 */
export type ViewerItem = {
  id: string;
  image: string;
  sources?: PictureSources;
  alt: string;
  width: number;
  height: number;
  /** Titre, Légende, Date (lot 39) affichés sous l image. */
  title: string;
  description: string;
  date?: string;
  video?: VideoView;
  /**
   * Image recadrée (lot 68) : `sources`, `width` et `height` sont ceux du RECADRAGE montré par la page (variante haute définition
   * extraite de l'original) ; si elle n'est pas prête (générée à la demande), l'image entière cadrée en CSS, puis nouvel essai.
   */
  fallback?: CropFallback;
  /** Ne pas montrer le texte alternatif en titre quand il n y a pas de titre (images des blocs : la légende est facultative). */
  plain?: boolean;
};

/** Attributs de l élément cliquable : données de la visionneuse, rôle de bouton, libellé (accessibilité). */
export function viewerAttrs(item: ViewerItem, label: string, passive = false): Record<string, string | number> {
  const json = JSON.stringify(item);
  return passive ? { "data-viewer-item": json, "data-viewer-passive": "" } : { "data-viewer-item": json, role: "button", tabIndex: 0, "aria-haspopup": "dialog", "aria-label": label };
}
