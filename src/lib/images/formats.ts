/**
 * Formats d'image (cadres) : UNE SEULE liste pour tous les réglages (image, grille, portrait, entrées des
 * collections, cadrage). Module pur, lu par les schémas, les éditeurs et la toile.
 *
 * - `auto` s'affiche « Libre » : le cadre garde le format de l'image, ou celui du cadrage libre posé dessus.
 * - 16:9 et 4:5 ne sont plus proposés, mais restent VALIDES et rendus (contenus déjà enregistrés) : aucune
 *   migration de données, les clés existantes ne changent pas.
 */

export const FORMAT_KEYS = ["auto", "1:1", "3:4", "2:3", "4:3", "3:2", "2:1", "21:9"] as const;
/** Anciens formats : acceptés et rendus, plus proposés. */
export const LEGACY_FORMAT_KEYS = ["16:9", "4:5"] as const;
export const RATIO_VALUES = [...FORMAT_KEYS, ...LEGACY_FORMAT_KEYS] as const;
export type FormatKey = (typeof RATIO_VALUES)[number];

export const FORMAT_LABELS: Record<FormatKey, string> = {
  auto: "Libre",
  "1:1": "Carré 1:1",
  "3:4": "Portrait 3:4",
  "2:3": "Portrait 2:3",
  "4:3": "Paysage 4:3",
  "3:2": "Paysage 3:2",
  "2:1": "Panoramique 2:1",
  "21:9": "Panoramique 21:9",
  "16:9": "Paysage 16:9 (ancien format)",
  "4:5": "Portrait 4:5 (ancien format)",
};

/** Options de la liste de formats ; un ancien format déjà choisi reste affiché tant qu'il est en place. */
export function formatOptions(current?: string): { value: string; label: string }[] {
  const list: { value: string; label: string }[] = FORMAT_KEYS.map((k) => ({ value: k, label: FORMAT_LABELS[k] }));
  if (current && (LEGACY_FORMAT_KEYS as readonly string[]).includes(current)) list.push({ value: current, label: FORMAT_LABELS[current as FormatKey] });
  return list;
}

/** Format de la liste le plus proche de `ratio` (largeur / hauteur), à 3 % près ; sinon null (cadrage « libre »). */
export function detectFormat(ratio: number): Exclude<FormatKey, "auto"> | null {
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  let best: Exclude<FormatKey, "auto"> | null = null;
  let gap = 0.03;
  for (const k of FORMAT_KEYS) {
    if (k === "auto") continue;
    const [w, h] = k.split(":").map(Number);
    const d = Math.abs(ratio / (w / h) - 1);
    if (d <= gap) {
      gap = d;
      best = k;
    }
  }
  return best;
}
