"use client";

import { Children, useEffect, useState, type ReactNode } from "react";

/**
 * « Un au hasard » (lot 89) : montre UN des éléments reçus, tiré à chaque visite, dans le navigateur.
 *
 * Pourquoi côté client : la page est rendue une fois puis servie depuis le cache (ISR) ; un tirage fait au rendu serait le même pour tous
 * les visiteurs jusqu'à la prochaine invalidation. Le serveur envoie donc tous les candidats (cachés), le navigateur en révèle un.
 * Avant le tirage rien n'est visible (jamais un candidat « par défaut » remplacé ensuite : pas de clignotement) ; sans JavaScript, le
 * premier candidat s'affiche (`<noscript>`). Un seul candidat : composant inutile, l'appelant rend l'élément tel quel.
 */
export default function RandomPick({ children, className }: { children: ReactNode; className?: string }) {
  const items = Children.toArray(children);
  const [index, setIndex] = useState<number | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- le tirage ne peut se faire qu'après l'hydratation : le serveur (et son cache) n'ont pas de hasard à offrir.
    setIndex(Math.floor(Math.random() * items.length));
  }, [items.length]);
  return (
    <div className={className} data-random-pick="" data-picked={index === null ? undefined : String(index)}>
      {items.map((child, i) => (
        <div key={i} hidden={index !== i} data-random-item={i}>
          {child}
        </div>
      ))}
      <noscript>
        <style>{"[data-random-item='0']{display:block!important}"}</style>
      </noscript>
    </div>
  );
}
