"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";

import { signOutAction } from "@/app/admin/actions";

import { useDismiss } from "../edit/useDismiss";
import { Toaster } from "./editing";
import { QueueIndicator, UploadQueueProvider } from "./UploadQueue";

/** `sub` : entrée rangée sous la précédente, légèrement en retrait (aucune pour l'instant : « Papiers peints » est un onglet de l'éditeur de thème, lot 61). */
const NAV: { href: string; label: string; sub?: boolean }[] = [
  { href: "/admin", label: "Tableau de bord" },
  { href: "/admin/themes", label: "Thèmes" },
  { href: "/admin/papiers-peints", label: "Papiers peints", sub: true },
  { href: "/admin/cadres", label: "Cadres", sub: true },
  { href: "/admin/pages", label: "Pages" },
  { href: "/admin/medias", label: "Médiathèque" },
  { href: "/admin/messages", label: "Messages" },
  { href: "/admin/reglages", label: "Réglages" },
  { href: "/admin/sauvegardes", label: "Sauvegardes", sub: true },
];

function isCurrent(pathname: string, href: string) {
  return href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Cadre de l'admin : barre latérale fixe (≥ 900px) ou menu repliable
 * (< 900px), contenu à droite.
 */
export default function AdminShell({
  siteName,
  userEmail,
  unreadMessages = 0,
  children,
}: {
  siteName: string;
  userEmail: string;
  /** Messages arrivés depuis la dernière visite de la page Messages : pastille sur « Messages » (lot 52). */
  unreadMessages?: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // Le menu mobile est ouvert « pour une page donnée » : naviguer le referme.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  // Menu mobile : un clic en dehors le referme (comme tous les menus flottants).
  const sidebar = useRef<HTMLElement>(null);
  useDismiss(sidebar, () => setOpenOn(null), { enabled: open });

  const brand = (
    <Link href="/admin" className="a-brand">
      {siteName}
      <small>administration</small>
    </Link>
  );

  return (
    <UploadQueueProvider>
    <div className="a-app">
      <div className="a-topbar">
        {brand}
        <QueueIndicator />
        <button
          type="button"
          className="a-btn"
          aria-expanded={open}
          aria-controls="a-sidebar"
          onClick={() => setOpenOn(open ? null : pathname)}
        >
          {open ? "Fermer" : "Menu"}
        </button>
      </div>

      <aside ref={sidebar} id="a-sidebar" className="a-sidebar" data-open={open}>
        {brand}
        <nav className="a-nav" aria-label="Administration">
          <ul>
            {NAV.map((item) => (
              <li key={item.href} data-sub={item.sub ? "" : undefined}>
                <Link href={item.href} aria-current={isCurrent(pathname, item.href) ? "page" : undefined}>
                  {item.label}
                  {item.href === "/admin/messages" && unreadMessages > 0 && !isCurrent(pathname, item.href) && (
                    <span className="a-nav-badge" data-testid="messages-badge" title={`${unreadMessages} nouveau${unreadMessages > 1 ? "x" : ""} message${unreadMessages > 1 ? "s" : ""}`}>
                      {unreadMessages > 99 ? "99+" : unreadMessages}
                      <span className="sr-only"> nouveau{unreadMessages > 1 ? "x" : ""} message{unreadMessages > 1 ? "s" : ""}</span>
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {/* File d'envoi globale : visible seulement s'il y a des envois. */}
        <QueueIndicator />
        <div className="a-user">
          <span className="a-user-email mono" title={userEmail}>
            {userEmail}
          </span>
          <div className="a-user-actions">
            <a className="a-btn" href="/" target="_blank" rel="noopener">
              Voir le site <span aria-hidden="true">↗</span>
            </a>
            <form action={signOutAction}>
              <button type="submit" className="a-btn a-btn-quiet">
                Se déconnecter
              </button>
            </form>
          </div>
        </div>
      </aside>

      <main className="a-main" id="contenu">
        {children}
      </main>
      <Toaster />
    </div>
    </UploadQueueProvider>
  );
}
