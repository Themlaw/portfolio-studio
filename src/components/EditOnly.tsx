"use client";

import { useSyncExternalStore, type ReactNode } from "react";

/**
 * Commandes d'édition de la toile (lot 31) : rendues SEULEMENT quand la toile de l'éditeur est en mode édition
 * (`html[data-edit-canvas]`, posé par EditLayer). Jamais dans le HTML serveur, jamais en Aperçu, jamais en public, ni dans
 * une page de brouillon ouverte hors de l'éditeur : elles ne sont même pas dans le DOM. `fallback` : ce qui se montre sinon.
 */
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-edit-canvas"] });
  return () => observer.disconnect();
}

export default function EditOnly({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  const on = useSyncExternalStore(
    subscribe,
    () => document.documentElement.hasAttribute("data-edit-canvas"),
    () => false,
  );
  return <>{on ? children : fallback}</>;
}
