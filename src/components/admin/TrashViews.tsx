import Link from "next/link";

/**
 * Bascule « liste / Corbeille » d'un écran (Pages, Projets) : deux liens (`?vue=corbeille`), l'état est dans
 * l'adresse, la corbeille se partage et survit au rechargement.
 */
export default function TrashViews({ base, label, view, trashCount }: { base: string; label: string; view: "liste" | "corbeille"; trashCount: number }) {
  return (
    <nav className="a-views" aria-label="Vue">
      <Link href={base} aria-current={view === "liste" ? "page" : undefined}>
        {label}
      </Link>
      <Link href={`${base}?vue=corbeille`} aria-current={view === "corbeille" ? "page" : undefined} data-testid="vue-corbeille">
        Corbeille
        {trashCount > 0 && <span className="a-views-count">{trashCount}</span>}
      </Link>
    </nav>
  );
}
