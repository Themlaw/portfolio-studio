"use client";

/**
 * Raccord du motif entre composants fusionnés (lot 35) : deux composants voisins qui montrent le même papier peint se touchent sans
 * espace ; chacun dessine sa propre trame depuis son coin, donc la trame se couperait à la jonction. Ici, côté navigateur seulement
 * (les hauteurs ne se connaissent pas avant), chaque composant d'une chaîne reçoit `--wp-y` = hauteur de ce qui précède modulo la
 * hauteur d'une tuile (`chainOffsets`, pur). Recalculé quand une taille change (images, polices, largeur de fenêtre) ou que la toile
 * déplace une jonction. Avant l'hydratation (ou sans JavaScript) la trame repart simplement au coin de chaque composant.
 * Ne rend rien ; absent des pages sans papier peint de composant.
 */
import { useEffect } from "react";

import { chainOffsets } from "@/themes/wallpaper";

const SELECTOR = '.fond-bloc[data-fond="on"][data-wallpaper]';

/** Recalcule `--wp-y` de tous les fonds à papier peint de la page. */
export function alignWallpapers(root: ParentNode = document): void {
  const els = [...root.querySelectorAll<HTMLElement>(SELECTOR)];
  if (!els.length) return;
  const phone = window.matchMedia("(max-width: 767px)").matches;
  const items = els.map((el) => {
    const cs = getComputedStyle(el);
    const size = Number.parseFloat(cs.getPropertyValue(phone ? "--wp-size-m" : "--wp-size"));
    const ratio = Number.parseFloat(cs.getPropertyValue("--wp-ratio"));
    return { joinPrev: el.hasAttribute("data-join-prev"), joinNext: el.hasAttribute("data-join-next"), height: el.getBoundingClientRect().height, tile: Number.isFinite(size) && Number.isFinite(ratio) ? size * ratio : 0 };
  });
  chainOffsets(items).forEach((y, i) => {
    if (y === 0) els[i].style.removeProperty("--wp-y");
    else els[i].style.setProperty("--wp-y", `${y}px`);
  });
}

export default function WallpaperAlign() {
  useEffect(() => {
    let frame = 0;
    const run = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => alignWallpapers());
    };
    run();
    const ro = new ResizeObserver(run);
    for (const el of document.querySelectorAll(SELECTOR)) ro.observe(el);
    // Jonctions ajoutées / retirées, composants ajoutés ou retirés (toile) : on recalcule et on réobserve.
    const mo = new MutationObserver(() => {
      ro.disconnect();
      for (const el of document.querySelectorAll(SELECTOR)) ro.observe(el);
      run();
    });
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-join-prev", "data-join-next", "data-wallpaper", "data-fond"] });
    window.addEventListener("resize", run);
    void document.fonts?.ready.then(run);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", run);
    };
  }, []);
  return null;
}
