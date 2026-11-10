import Link from "next/link";

import { getAdminT } from "@/i18n/admin-server";

/**
 * Bascule « liste / Corbeille » d'un écran (Pages, Projets) : deux liens (`?vue=corbeille`), l'état est dans
 * l'adresse, la corbeille se partage et survit au rechargement.
 */
export default async function TrashViews({ base, label, view, trashCount }: { base: string; label: string; view: "liste" | "corbeille"; trashCount: number }) {
  const t = await getAdminT("trash");
  return (
    <nav className="a-views" aria-label={t("viewLabel")}>
      <Link href={base} aria-current={view === "liste" ? "page" : undefined}>
        {label}
      </Link>
      <Link href={`${base}?vue=corbeille`} aria-current={view === "corbeille" ? "page" : undefined} data-testid="vue-corbeille">
        {t("trash")}
        {trashCount > 0 && <span className="a-views-count">{trashCount}</span>}
      </Link>
    </nav>
  );
}
