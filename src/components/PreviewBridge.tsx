"use client";

import { useEffect, useState } from "react";

import { HighlightBoxes, useRoleHighlight } from "@/components/edit/highlight";
import { BASE_KEYS, type BaseKey } from "@/themes/palette";

/**
 * Aperçu en direct de l'éditeur de thème (rendu seulement en aperçu admin).
 * L'éditeur, affiché sur la même origine, envoie au cadre la feuille de
 * tokens et les attributs de variantes calculés depuis le formulaire ; le
 * cadre les applique sans rechargement. Messages d'une autre origine ignorés.
 *
 * Lot 19b : `portfolio:highlight` { role } surligne les éléments qui utilisent un rôle de couleur (même code que
 * la toile de l'éditeur visuel, components/edit/highlight.tsx) ; la légende « utilisé par » repart vers l'éditeur
 * (`portfolio:highlight-info`).
 */
type ThemeMessage = { type: "portfolio:theme"; css: string; attrs: Record<string, string> };

const ALLOWED_ATTR = /^data-(theme|scheme|header|hero|strip|caption|lightbox|button|texture)$/;

const reportInfo = (role: BaseKey, count: number, uses: string[]) =>
  window.parent.postMessage({ type: "portfolio:highlight-info", role, count, uses }, window.location.origin);

export default function PreviewBridge() {
  const [role, setRole] = useState<BaseKey | null>(null);
  const found = useRoleHighlight(role, reportInfo);
  useEffect(() => {
    if (window.parent === window) return;
    document.documentElement.setAttribute("data-preview-framed", "");
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const data = event.data as ThemeMessage | { type: "portfolio:highlight"; role: unknown };
      if (data?.type === "portfolio:highlight") {
        setRole(typeof data.role === "string" && (BASE_KEYS as readonly string[]).includes(data.role) ? (data.role as BaseKey) : null);
        return;
      }
      if (data?.type !== "portfolio:theme" || typeof data.css !== "string") return;
      const style = document.getElementById("theme");
      if (style) style.textContent = data.css;
      // On règle les couleurs du THÈME : celles que le site pose par-dessus (éditeur visuel) sont mises de côté.
      document.getElementById("site-palette")?.setAttribute("media", "not all");
      for (const [name, value] of Object.entries(data.attrs ?? {})) {
        if (ALLOWED_ATTR.test(name) && typeof value === "string") document.documentElement.setAttribute(name, value);
      }
    };
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ type: "portfolio:ready" }, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  return found ? (
    <div className="pe-host" data-preview-highlight="">
      <div className="pe-layer">
        <HighlightBoxes found={found} />
      </div>
    </div>
  ) : null;
}
