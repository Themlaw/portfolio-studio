import type { CSSProperties, ReactNode } from "react";

import { fondAttributes, fondStyle, type Background, type FondJoin } from "@/themes/fond";
import type { WallpaperLookup } from "@/themes/wallpaper";
import type { CardPalette } from "@/themes/surface";

/**
 * Enveloppe du fond de couleur d une rubrique (lot 32) : bord à bord de son conteneur, sur toute la hauteur du composant.
 * Composant sans état et sans import serveur : le rendu des blocs (BlockList, `withFond`) et la planche composée
 * (ProjectStrip, côté client) posent la MÊME enveloppe, avec les mêmes attributs de fusion que `fondJoins` calcule.
 */
export default function FondWrap({ background, join, palette, lookup, edit, children }: { background: Background; join: FondJoin; palette: CardPalette; lookup?: WallpaperLookup; edit?: boolean; children: ReactNode }) {
  const { vars } = fondStyle(background, palette, lookup, join.around);
  return (
    <div className="fond-bloc" {...fondAttributes(join, background)} style={vars as CSSProperties} {...(edit ? { "data-edit-background": JSON.stringify(background) } : {})}>
      {children}
    </div>
  );
}
