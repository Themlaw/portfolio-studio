/**
 * Corbeille (lot 23) : pages, projets et médias supprimés restent 30 jours restaurables, puis un job les
 * purge (src/lib/edit/trash.ts). Module pur (aucun import) : lu aussi par l'interface.
 */
export const TRASH_DAYS = 30;
const DAY_MS = 86_400_000;

/** Date (ms) de la purge d'un élément mis à la corbeille à `deletedAt` (ms). */
export const purgeAt = (deletedAt: number): number => deletedAt + TRASH_DAYS * DAY_MS;

/** Jours restants avant la purge (au moins 0). */
export function daysLeft(deletedAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((purgeAt(deletedAt) - now) / DAY_MS));
}
