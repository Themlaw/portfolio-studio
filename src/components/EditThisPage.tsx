"use client";

/**
 * Bouton discret « Modifier cette page », pour l'artiste connectée. Rien au
 * rendu serveur : le HTML en cache public ne le contient jamais. Dans le
 * navigateur, seulement si le cookie indicateur `portfolio-admin` existe
 * (posé par le proxy quand l'admin est ouvert avec une session), la session
 * est vérifiée côté serveur avant d'afficher le bouton. Jamais dans un cadre
 * (toile de l'éditeur, aperçu de thème).
 */
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { onPublished } from "@/lib/publish-signal";

export const ADMIN_HINT_COOKIE = "portfolio-admin";

export default function EditThisPage() {
  const [href, setHref] = useState<string | null>(null);
  const router = useRouter();
  // Lot 118 : après « Publier » dans l'éditeur (autre onglet), cette page abandonne le cache de navigation de Next et se relit.
  useEffect(() => {
    if (window.parent !== window) return;
    if (!document.cookie.split("; ").some((c) => c.startsWith(`${ADMIN_HINT_COOKIE}=`))) return;
    return onPublished(() => router.refresh());
  }, [router]);
  useEffect(() => {
    if (window.parent !== window) return;
    if (!document.cookie.split("; ").some((c) => c.startsWith(`${ADMIN_HINT_COOKIE}=`))) return;
    const controller = new AbortController();
    fetch(`/admin/api/editeur/session?chemin=${encodeURIComponent(window.location.pathname)}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { admin?: boolean; editUrl?: string | null } | null) => {
        if (data?.admin && typeof data.editUrl === "string" && data.editUrl.startsWith("/admin/")) setHref(data.editUrl);
        // Session terminée : l'indicateur ne sert plus.
        else if (data && !data.admin) document.cookie = `${ADMIN_HINT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  if (!href) return null;
  return (
    // Styles en ligne : aucune feuille de l'admin dans le bundle public.
    <a
      className="pe-edit-this"
      href={href}
      lang="fr"
      style={{
        position: "fixed",
        right: 14,
        bottom: 14,
        zIndex: 60,
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        padding: "7px 12px",
        border: "1px solid #d2d5da",
        borderRadius: 999,
        background: "#ffffff",
        color: "#1f2226",
        font: "500 12.5px/1.2 var(--font-figtree), ui-sans-serif, system-ui, sans-serif",
        letterSpacing: 0,
        textTransform: "none",
        textDecoration: "none",
        opacity: 0.85,
        boxShadow: "0 6px 18px rgba(31, 34, 38, 0.2)",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M11.3 2.3a1.5 1.5 0 0 1 2.1 0l.3.3a1.5 1.5 0 0 1 0 2.1L6 12.4l-3 .6.6-3z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
      Modifier cette page
    </a>
  );
}
