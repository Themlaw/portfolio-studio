/**
 * Activité de l artiste (lot 118) : horodatage du dernier geste d édition (server action ou route d écriture enveloppée
 * par le journal, src/lib/journal/audit.ts). Sert à distinguer une session de travail du BRUIT d écriture de fond
 * (traitements d images, progressions, nettoyages) : `PRAGMA data_version` voit les deux, sans pouvoir les séparer.
 * Module sans dépendance : importable par le journal comme par le planificateur. État sur globalThis (Next charge les modules plusieurs fois).
 */
const G = globalThis as typeof globalThis & { __portfolioUserAt?: number };

export function noteUserActivity(now = Date.now()): void {
  G.__portfolioUserAt = now;
}

export function lastUserActivityAt(): number {
  return G.__portfolioUserAt ?? 0;
}
