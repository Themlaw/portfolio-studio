"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { signOutAction } from "@/app/admin/actions";

import { Toaster } from "./editing";
import { QueueIndicator, UploadQueueProvider } from "./UploadQueue";

const NAV = [
  { href: "/admin", label: "Tableau de bord" },
  { href: "/admin/themes", label: "Thèmes" },
  { href: "/admin/pages", label: "Pages" },
  { href: "/admin/projets", label: "Projets" },
  { href: "/admin/medias", label: "Médiathèque" },
  { href: "/admin/reglages", label: "Réglages" },
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
  children,
}: {
  siteName: string;
  userEmail: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  // Le menu mobile est ouvert « pour une page donnée » : naviguer le referme.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;

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

      <aside id="a-sidebar" className="a-sidebar" data-open={open}>
        {brand}
        <nav className="a-nav" aria-label="Administration">
          <ul>
            {NAV.map((item) => (
              <li key={item.href}>
                <Link href={item.href} aria-current={isCurrent(pathname, item.href) ? "page" : undefined}>
                  {item.label}
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
