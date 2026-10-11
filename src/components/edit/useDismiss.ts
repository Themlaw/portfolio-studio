"use client";

/**
 * Fermeture d'un menu flottant (lot 6) — UN mécanisme pour tous les popovers,
 * menus et barres de l'éditeur (toile et panneau) : clic (ou toucher) à
 * l'extérieur, Échap, et passage du focus à l'autre cadre (cliquer dans le
 * panneau ferme les menus de la toile, et inversement ; les deux documents
 * sont de même origine mais ne voient pas les clics l'un de l'autre).
 *
 *   const ref = useRef<HTMLDivElement>(null);
 *   useDismiss(ref, onClose);
 *   <div ref={ref} …>
 *
 * Ce que le hook ignore :
 * - un clic dans le menu lui-même ou dans un menu OUVERT PLUS TARD (sous-menu,
 *   même porté ailleurs dans le DOM, s'il utilise le hook lui aussi) ;
 * - un clic sur le bouton qui l'a ouvert (`aria-expanded="true"`) : c'est lui
 *   qui bascule, sinon le menu se refermerait puis se rouvrirait ;
 * - les `<select>` natifs (leur liste n'est pas dans le DOM : aucun clic ne
 *   remonte, et la perte de focus du cadre qu'ils provoquent n'en est pas une) ;
 * - le défilement (aucun écouteur) et les barres de défilement du document.
 *
 * Fermer par l'extérieur ne perd rien : les menus de l'éditeur appliquent
 * chaque réglage au moment où on le choisit ; `onDismiss` est appelé comme le
 * bouton « fermer » (✕) — jamais pour annuler. Un menu qui garde un brouillon
 * non validé (formulaire) l'applique ou le jette dans son `onDismiss`.
 */
import { useEffect, useRef, type RefObject } from "react";

type Options = {
  /** Faux : le menu est fermé ou inerte, rien n'est écouté. */
  enabled?: boolean;
  /** Cibles qui ne ferment pas le menu en plus de lui-même (ex. le texte en cours de saisie). */
  ignore?: (target: Element) => boolean;
  /** Échap ferme aussi le menu (par défaut oui ; seul le plus récent à la fois). */
  escape?: boolean;
};

/** Menus ouverts, du plus ancien au plus récent (pour Échap et les sous-menus). */
const open: { id: symbol; ref: RefObject<HTMLElement | null> }[] = [];

export function useDismiss(ref: RefObject<HTMLElement | null>, onDismiss: () => void, { enabled = true, ignore, escape = true }: Options = {}) {
  const latest = useRef({ onDismiss, ignore });
  useEffect(() => {
    latest.current = { onDismiss, ignore };
  });

  useEffect(() => {
    if (!enabled) return;
    const id = Symbol("dismiss");
    open.push({ id, ref });
    const doc = ref.current?.ownerDocument ?? document;
    const win = doc.defaultView ?? window;

    const onPointerDown = (e: PointerEvent) => {
      const el = ref.current;
      const t = e.target;
      if (!el || !(t instanceof Element)) return;
      if (el.contains(t)) return;
      // Clic dans un menu ouvert après celui-ci (sous-menu porté ailleurs).
      const mine = open.findIndex((o) => o.id === id);
      if (open.slice(mine + 1).some((o) => o.ref.current?.contains(t))) return;
      // Le bouton qui a ouvert le menu le referme lui-même.
      if (t.closest('[aria-expanded="true"]')) return;
      // Barre de défilement du document : ni clic ni intention de fermer.
      const root = doc.documentElement;
      if (t === root && (e.clientX >= root.clientWidth || e.clientY >= root.clientHeight)) return;
      if (latest.current.ignore?.(t)) return;
      latest.current.onDismiss();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!escape || e.key !== "Escape" || e.defaultPrevented) return;
      if (open[open.length - 1]?.id !== id) return;
      latest.current.onDismiss();
    };

    // Le focus passe à l'autre cadre (clic dans le panneau, ou dans la toile).
    // Alt-Tab ou liste d'un <select> : le cadre garde le focus du document, rien ne se ferme.
    const onBlur = () => {
      win.setTimeout(() => {
        const frame = doc.activeElement instanceof win.HTMLIFrameElement;
        let toParent = false;
        try {
          toParent = win.parent !== win && win.parent.document.hasFocus();
        } catch {}
        if (frame || toParent) latest.current.onDismiss();
      }, 0);
    };

    doc.addEventListener("pointerdown", onPointerDown, true);
    doc.addEventListener("keydown", onKeyDown);
    win.addEventListener("blur", onBlur);
    return () => {
      doc.removeEventListener("pointerdown", onPointerDown, true);
      doc.removeEventListener("keydown", onKeyDown);
      win.removeEventListener("blur", onBlur);
      const at = open.findIndex((o) => o.id === id);
      if (at >= 0) open.splice(at, 1);
    };
  }, [enabled, escape, ref]);
}
