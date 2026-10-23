"use client";

/**
 * Polices récentes (lot 70) côté navigateur : lecture et écriture passent par le serveur (`/admin/api/fonts/recent`, réglage du site),
 * jamais par le navigateur lui-même. Utilisé par TOUS les endroits où l'on choisit une police (menu des polices de la toile, des
 * styles du site, de l'éditeur de thème guidé). Une erreur réseau n'empêche jamais de choisir : la liste est une commodité.
 */
import { useCallback, useEffect, useState } from "react";

const URL = "/admin/api/fonts/recent";
export const RECENT_MAX = 6;

const asList = (j: { fonts?: unknown } | null): string[] | null => (Array.isArray(j?.fonts) ? (j.fonts as unknown[]).filter((f): f is string => typeof f === "string") : null);

export function useRecentFonts(): { recent: string[]; remember: (ref: string) => void } {
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    fetch(URL, { credentials: "same-origin", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { fonts?: unknown } | null) => {
        const list = asList(j);
        if (live && list) setRecent(list);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const remember = useCallback((ref: string) => {
    setRecent((prev) => [ref, ...prev.filter((r) => r !== ref)].slice(0, RECENT_MAX));
    // `keepalive` : l'écriture part même si le menu se ferme (et se démonte) aussitôt après le choix.
    void fetch(URL, { method: "POST", credentials: "same-origin", keepalive: true, headers: { "content-type": "application/json" }, body: JSON.stringify({ font: ref }) })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { fonts?: unknown } | null) => {
        const list = asList(j);
        if (list) setRecent(list);
      })
      .catch(() => {});
  }, []);
  return { recent, remember };
}
