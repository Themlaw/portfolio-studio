import type { ReactNode } from "react";

import { boxActive, type BoardBox } from "@/blocks/board-layout";

/**
 * Largeur et alignement d'un composant de la planche (lot 31b) : UN réglage pour tous les types. Sans réglage, ou à
 * 100 %, aucune enveloppe (rendu d'avant, au pixel). Réduit : le composant se place dans une colonne de la largeur
 * choisie (en % du cadre du site), à gauche, au centre ou à droite ; ses propres marges de page sont neutralisées
 * dans la colonne (src/app/globals.css, `.board-box`). Sous 640 px la colonne reprend toute la largeur : à cette
 * taille un tiers d'écran ne montre plus rien.
 */
export default function BoardBox({ box, children }: { box?: BoardBox; children: ReactNode }) {
  if (!boxActive(box)) return <>{children}</>;
  return (
    <div className="shell board-box-row">
      <div className="board-box" data-align={box.align ?? "center"} style={{ ["--bw" as string]: `${box.width}%` }}>
        {children}
      </div>
    </div>
  );
}
