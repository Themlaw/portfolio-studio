"use client";

import { createElement, useRef, useState, type HTMLAttributes, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";

import { createPortal } from "react-dom";

import Lightbox from "@/components/Lightbox";
import type { ViewerItem } from "@/lib/viewer";

type Found = { el: HTMLElement; item: ViewerItem };

/**
 * Zone « cliquer pour agrandir » (lot 44, voir src/lib/viewer.ts) : au clic (ou Entrée / Espace) sur un élément
 * `[data-viewer-item]` de son contenu, ouvre la visionneuse de la bande d images (Lightbox : flèches, ← → Échap, balayage au
 * doigt, compteur, légende, boucle) sur CET élément, avec tous ceux de la zone dans l ordre du document. Le focus revient
 * à l élément à la fermeture. Sur la toile de l éditeur le clic sert à éditer : jamais de visionneuse.
 */
export default function ViewerScope({ as = "div", children, ...rest }: { as?: "div" | "section" | "span"; children: ReactNode } & HTMLAttributes<HTMLElement>) {
  const ref = useRef<HTMLElement | null>(null);
  const back = useRef<HTMLElement | null>(null);
  const [state, setState] = useState<{ items: ViewerItem[]; index: number } | null>(null);

  const open = (el: HTMLElement) => {
    if (document.documentElement.hasAttribute("data-edit-canvas")) return;
    const found: Found[] = [];
    ref.current?.querySelectorAll<HTMLElement>("[data-viewer-item]").forEach((node) => {
      try {
        const item = JSON.parse(node.dataset.viewerItem ?? "") as ViewerItem;
        if (item && typeof item.image === "string") found.push({ el: node, item });
      } catch {
        // donnée illisible : l élément est ignoré
      }
    });
    const index = found.findIndex((f) => f.el === el);
    if (index < 0) return;
    back.current = el;
    setState({ items: found.map((f) => f.item), index });
  };

  const target = (event: MouseEvent | KeyboardEvent): HTMLElement | null => {
    const hit = (event.target as HTMLElement).closest<HTMLElement>("[data-viewer-item]");
    return hit && !hit.hasAttribute("data-viewer-passive") && ref.current?.contains(hit) ? hit : null;
  };

  const close = () => {
    setState(null);
    const el = back.current;
    back.current = null;
    // Après le démontage de la visionneuse (qui reprend son propre focus).
    requestAnimationFrame(() => el?.focus());
  };

  return (
    <>
      {createElement(
        as,
        {
          ...rest,
          ref,
          onClick: (event: MouseEvent<HTMLElement>) => {
            const el = target(event);
            if (el) open(el);
          },
          onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            const el = target(event);
            if (el && el === event.target) {
              event.preventDefault();
              open(el);
            }
          },
        },
        children,
      )}
      {state &&
        // Dans <body> : un parent transformé ne déplace pas la visionneuse (comme VideoViewer).
        createPortal(<Lightbox items={state.items} index={state.index} bare={state.items.length < 2} onIndexChange={(index) => setState((s) => (s ? { ...s, index } : s))} onClose={close} />, document.body)}
    </>
  );
}
