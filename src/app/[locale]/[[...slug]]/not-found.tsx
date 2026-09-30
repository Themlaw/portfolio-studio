import NotFoundView from "@/components/NotFoundView";

/**
 * Filet de sécurité pour un notFound() éventuel. Les slugs inconnus, eux, sont
 * servis par le proxy (src/proxy.ts) : rendu serveur complet, statut 404,
 * aucun cache long.
 */
export default function NotFound() {
  return <NotFoundView />;
}
