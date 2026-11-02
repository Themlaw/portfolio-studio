"use client";

/**
 * Remet la page à sa place après un changement de langue fait avec le sélecteur (lot 87). Le sélecteur
 * (LocaleSwitcher) retient le bloc visible dans sessionStorage puis navigue SANS remonter en haut ; ce composant,
 * posé dans la mise en page de la langue, applique la position dès que la nouvelle page est affichée (avant la
 * peinture : pas de saut visible) et la corrige le temps que les images et les polices se posent.
 * Il ne fait rien pour une autre navigation : le passage retenu n'est lu que s'il vise exactement la page d'arrivée.
 */
import { useLayoutEffect } from "react";
import { usePathname } from "next/navigation";

import { normalizePath, settleSnap, takeRecord } from "@/lib/lang-scroll";

export default function LangScrollRestore() {
  const pathname = usePathname();
  useLayoutEffect(() => {
    const rec = takeRecord();
    if (!rec || normalizePath(rec.to) !== normalizePath(pathname)) return;
    // Page sans équivalent dans l'autre langue (404) : comme avant, en haut.
    if (document.querySelector("[data-not-found]")) {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      return;
    }
    return settleSnap(window, rec.snap);
  }, [pathname]);
  return null;
}
