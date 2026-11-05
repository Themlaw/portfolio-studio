"use client";

/**
 * Une seule vidéo à la fois sur la page (lot 116). Gestionnaire commun, sans dépendance entre blocs : toute vidéo « gérée »
 * (`data-managed-video`, posée par les boucles et le lecteur) qui démarre met en pause les autres vidéos gérées de la page. La vidéo
 * mise en pause reçoit l'événement `video-yield` : une boucle y renonce (elle ne redémarre pas toute seule en revenant à l'écran).
 * Valable partout où ces composants sont rendus : bloc vidéo, case de grille, rail, carrousel, planche de projet, planche libre, aperçu
 * de l'éditeur et site en ligne. Le fond animé de l'accueil (muet, décoratif) n'est pas géré.
 */
import { useEffect, useSyncExternalStore } from "react";

export const MANAGED_ATTR = "data-managed-video";
export const YIELD_EVENT = "video-yield";

let installed = false;
function install() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener(
    "play",
    (event) => {
      const started = event.target;
      if (!(started instanceof HTMLVideoElement) || !started.hasAttribute(MANAGED_ATTR)) return;
      for (const other of document.querySelectorAll<HTMLVideoElement>(`video[${MANAGED_ATTR}]`)) {
        if (other === started) continue;
        // Aussi pour une boucle déjà en pause parce qu'elle est hors écran : elle veut encore jouer, elle y renonce.
        other.dispatchEvent(new Event(YIELD_EVENT));
        if (!other.paused) other.pause();
      }
    },
    true,
  );
}

/** Installe le gestionnaire (une fois) et prévient `onYield` quand une autre vidéo prend la main. */
export function useSoloPlayback(ref: React.RefObject<HTMLVideoElement | null>, onYield?: () => void) {
  useEffect(() => {
    install();
    const el = ref.current;
    if (!el || !onYield) return;
    el.addEventListener(YIELD_EVENT, onYield);
    return () => el.removeEventListener(YIELD_EVENT, onYield);
  }, [ref, onYield]);
}

/**
 * Toile de l'éditeur en mode ÉDITION (`data-edit-canvas`) : le clic sert à choisir le composant. En Aperçu et en public ce repère est
 * absent : les vidéos se lisent comme pour un visiteur. `edit` (rendu serveur) ne suffit pas : l'Aperçu garde les mêmes balises.
 */
export function useEditCanvas(edit: boolean): boolean {
  const active = useSyncExternalStore(
    (onChange) => {
      const mo = new MutationObserver(onChange);
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-edit-canvas"] });
      return () => mo.disconnect();
    },
    () => document.documentElement.hasAttribute("data-edit-canvas"),
    () => true,
  );
  return edit && active;
}
