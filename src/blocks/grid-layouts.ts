/**
 * Agencements d'une grille : motif de cellules répété ligne après ligne
 * (« 1+2 » = une grande puis deux petites, etc.). Les composants remplissent
 * les cellules dans l'ordre ; changer d'agencement ne retire rien. Module pur
 * (serveur, éditeur, toile).
 */
export const GRID_LAYOUTS = ["1", "1+2", "2", "3", "2x2", "4", "2+1"] as const;
export type GridLayout = (typeof GRID_LAYOUTS)[number];
/** Cellules d'un motif (places libres de la toile). */
export const GRID_PATTERN: Record<GridLayout, number> = { "1": 1, "1+2": 3, "2": 2, "3": 3, "2x2": 4, "4": 4, "2+1": 3 };

/**
 * Colonnes occupées par la cellule n° `index` (0 = première) sur écran large
 * (≥ 768 px) : sert à estimer la largeur affichée d'une image de cellule
 * (attribut `sizes`). Sur mobile, une colonne (deux pour « 2x2 » et « 4 »).
 */
export function cellShare(layout: GridLayout, index: number): number {
  switch (layout) {
    case "1":
      return 1;
    case "1+2":
      return index % 3 === 0 ? 1 : 2;
    case "2+1":
      return index % 3 === 2 ? 1 : 2;
    case "3":
      return 3;
    case "4":
      return 4;
    default:
      return 2; // « 2 » et « 2x2 »
  }
}
