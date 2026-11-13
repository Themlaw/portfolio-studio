/**
 * Ordre d'affichage des pages dans l'écran admin « Pages » et dans le
 * sélecteur de page de l'éditeur visuel. Indépendant de l'ordre du menu
 * du site (`navOrder` / réglage `nav`).
 *
 * Fonction pure : tri d'une liste de pages à partir d'un ordre enregistré
 * (identifiants). Les pages absentes de l'ordre enregistré vont à la fin,
 * par identifiant. Les doublons et les identifiants inconnus sont ignorés.
 */
export function orderPages<T extends { id: number }>(
  pages: readonly T[],
  order: readonly number[] | null | undefined,
): T[] {
  const ids = Array.isArray(order) ? order : [];
  const byId = new Map<number, T>();
  for (const p of pages) byId.set(p.id, p);
  const result: T[] = [];
  const seen = new Set<number>();
  for (const raw of ids) {
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) continue;
    if (seen.has(raw)) continue;
    const p = byId.get(raw);
    if (!p) continue;
    result.push(p);
    seen.add(raw);
  }
  const rest = pages.filter((p) => !seen.has(p.id)).slice().sort((a, b) => a.id - b.id);
  return [...result, ...rest];
}
