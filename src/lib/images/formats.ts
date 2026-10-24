/**
 * Formats d'image (cadres) : UNE SEULE liste pour tous les réglages (image, grille, portrait, entrées des
 * collections, cadrage). Module pur, lu par les schémas, les éditeurs et la toile.
 *
 * - `auto` s'affiche « Libre » : le cadre garde le format de l'image, ou celui du cadrage libre posé dessus.
 * - 16:9 et 4:5 ne sont plus proposés, mais restent VALIDES et rendus (contenus déjà enregistrés) : aucune
 *   migration de données, les clés existantes ne changent pas. Leur libellé est celui des autres formats (lot 69 :
 *   jamais de mention « ancien format » à l'écran) ; ils n'apparaissent que sur un réglage qui les porte déjà.
 * - Un réglage neuf n'en porte jamais : le format par défaut est « Libre » (`auto`), dans le panneau comme dans la fenêtre.
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
  "16:9": "Paysage 16:9",
  "4:5": "Portrait 4:5",
};

/**
 * Valeur CSS de `--box-r` (largeur ÷ hauteur) d'un format de la liste, ou `undefined` pour « Libre » / une clé inconnue. Le composant
 * qui impose un format la pose (portrait du profil, tuiles de collection) et la feuille lit `aspect-ratio: var(--box-r)` : plus de
 * table « format -> aspect-ratio » recopiée en CSS (lot 75, R5). Forme « w / h » (un rapport, pas un `calc`) : le navigateur arrondit comme avec l'ancienne table (un `calc` donnait 1 px de plus sur l'accueil).
 */
export function ratioCss(key: string | undefined): string | undefined {
  if (!key || key === "auto" || !(RATIO_VALUES as readonly string[]).includes(key)) return undefined;
  const [w, h] = key.split(":");
  return `${w} / ${h}`;
}

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
