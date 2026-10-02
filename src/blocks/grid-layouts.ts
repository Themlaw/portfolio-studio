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
