/**
 * Quel rectangle de l'original afficher pour un emplacement (module pur) :
 *  - recadrage libre (`crop.rect`) : ce rectangle, le cadre prend son rapport ;
 *  - ancien cadrage (point focal + zoom) dans un cadre au format imposé : sa
 *    fenêtre est un rectangle de l'original, servi tel quel au lieu d'une
 *    image entière agrandie par CSS (floue) ;
 *  - image sans cadrage dans un cadre qui la rogne fortement (décor dans une
 *    case portrait) : la fenêtre centrée, pour la même raison.
 * Ni l'un ni l'autre : null, l'image entière est servie comme avant.
 */
import { cropWindow, type Crop } from "@/lib/look";

import { isWholeImage, type Rect } from "./crop";

/** Au-delà de ce rapport de largeur entre l'image affichée et son cadre, on sert la fenêtre au lieu de l'image entière. */
export const STRETCH_MIN = 1.5;

export type ResolvedCrop = { rect: Rect; /** Recadrage libre : le cadre suit le rectangle. */ free: boolean };

export function resolveCrop(crop: Crop | undefined, imageRatio: number, boxRatio: number | null, cover: boolean): ResolvedCrop | null {
  if (crop?.rect) return isWholeImage(crop.rect) ? null : { rect: crop.rect, free: true };
  const box = boxRatio ?? imageRatio;
  if (crop) {
    const win = cropWindow(crop, imageRatio, box);
    return win.width < 0.995 || win.height < 0.995 ? { rect: { x: win.left, y: win.top, w: win.width, h: win.height }, free: false } : null;
  }
  if (!boxRatio || !cover || imageRatio / boxRatio < STRETCH_MIN) return null;
  const win = cropWindow({ x: 50, y: 50, zoom: 1 }, imageRatio, boxRatio);
  return { rect: { x: win.left, y: win.top, w: win.width, h: win.height }, free: false };
}
