"use client";

import { useEffect } from "react";

/**
 * Aperçu en direct de l'éditeur de thème (rendu seulement en aperçu admin).
 * L'éditeur, affiché sur la même origine, envoie au cadre la feuille de
 * tokens et les attributs de variantes calculés depuis le formulaire ; le
 * cadre les applique sans rechargement. Messages d'une autre origine ignorés.
 */
type ThemeMessage = { type: "portfolio:theme"; css: string; attrs: Record<string, string> };

const ALLOWED_ATTR = /^data-(theme|scheme|header|hero|strip|caption|lightbox|button|texture)$/;

export default function PreviewBridge() {
  useEffect(() => {
    if (window.parent === window) return;
    document.documentElement.setAttribute("data-preview-framed", "");
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== window.parent) return;
      const data = event.data as ThemeMessage;
      if (data?.type !== "portfolio:theme" || typeof data.css !== "string") return;
      const style = document.getElementById("theme");
      if (style) style.textContent = data.css;
      for (const [name, value] of Object.entries(data.attrs ?? {})) {
        if (ALLOWED_ATTR.test(name) && typeof value === "string") document.documentElement.setAttribute(name, value);
      }
    };
    window.addEventListener("message", onMessage);
    window.parent.postMessage({ type: "portfolio:ready" }, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  return null;
}
