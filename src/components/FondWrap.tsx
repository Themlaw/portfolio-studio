import type { CSSProperties, ReactNode } from "react";

import { fondAttributes, fondStyle, type Background, type FondJoin } from "@/themes/fond";
import type { WallpaperLookup } from "@/themes/wallpaper";
import type { CardPalette } from "@/themes/surface";

const NO_JOIN: FondJoin = { prev: false, next: false };

/**
 * Enveloppe du fond de couleur d une rubrique (lot 32) : bord à bord de son conteneur, sur toute la hauteur du composant. Composant sans état et
 * sans import serveur : le rendu des blocs (BlockList, `withFond`) et la planche composée (ProjectStrip, côté client) posent la MÊME enveloppe, avec les
 * mêmes attributs de fusion que `fondJoins` calcule.
 * `.fond-in` (lot 47) : couche intérieure sans boîte (`display: contents`). Avec une marge, elle reprend la largeur que la marge retire à
 * l'enveloppe (look.css) : la couleur est rognée, JAMAIS le contenu, qui garde la largeur et la place qu'il a sans fond.
 * Lot 105 : `background.card` = la Carte d'un composant, un panneau en retrait DANS le fond (deuxième enveloppe `.fond-bloc[data-fond-panel]`, mêmes
 * règles de largeur : un fond posé dans un fond). `edit` : le panneau est toujours là (éteint sans carte) pour que la toile puisse le montrer tout de suite.
 */
export default function FondWrap({ background, join, palette, lookup, edit, zone, children }: { background: Background; join: FondJoin; palette: CardPalette; lookup?: WallpaperLookup; edit?: boolean; zone?: Record<string, string>; children: ReactNode }) {
  const { vars } = fondStyle(background, palette, lookup, join.around);
  const panel = background.card ? ({ ...background.card, inset: background.card.inset ?? "m" } as Background) : null;
  const inner = panel ? (
    <div className="zone fond-bloc" data-fond-panel="" {...fondAttributes(NO_JOIN, panel)} style={fondStyle(panel, palette, lookup).vars as CSSProperties}>
      <div className="fond-in">{children}</div>
    </div>
  ) : edit ? (
    <div className="zone fond-bloc" data-fond-panel="" data-fond="off">
      <div className="fond-in">{children}</div>
    </div>
  ) : (
    children
  );
  return (
    <div className="zone fond-bloc" {...fondAttributes(join, background)} style={{ ...vars, ...zone } as CSSProperties} {...(edit ? { "data-edit-background": JSON.stringify(background) } : {})}>
      <div className="fond-in">{inner}</div>
    </div>
  );
}
