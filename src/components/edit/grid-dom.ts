/**
 * Repères DOM de la grille unifiée (lot 31d), lus par les calques de la toile (EditLayer, BoardLayer, GridLayer).
 * `GridBlock` pose, sur la toile seulement :
 * - `.block-grid[data-edit-grid]` : la grille ;
 * - `.block-grid-cell[data-edit-cell=<uid>][data-cell-index][data-cell-type]` : une case remplie ;
 * - `.block-grid-cell[data-edit-cell-free][data-cell-index]` : une place libre.
 * La grille est une rubrique de la page (enveloppe `data-edit-block`) ou un composant de planche (cadre `data-edit-bitem`).
 */

export type GridRef = {
  grid: HTMLElement;
  /** uid de la rubrique (page) ou du composant (planche). */
  uid: string;
  /** Planche de projet, sinon undefined (rubrique de page). */
  board?: number;
  /** Réglages du composant de planche tels que la toile les a lus (JSON), repli de l'éditeur. */
  props?: string;
};

/** La grille qui contient (ou est) cet élément, avec son propriétaire ; null si ce n'est pas une grille de la toile. */
export function gridRefOf(el: Element | null): GridRef | null {
  const grid = el?.closest<HTMLElement>("[data-edit-grid]") ?? null;
  if (!grid) return null;
  const frame = grid.closest<HTMLElement>("[data-edit-bitem]");
  if (frame?.dataset.editBitem) {
    const board = Number(frame.dataset.board);
    return board ? { grid, uid: frame.dataset.editBitem, board, props: (frame.dataset.editBitemProps ?? "").slice(0, 100_000) || undefined } : null;
  }
  const uid = grid.closest<HTMLElement>("[data-edit-block]")?.dataset.editBlock;
  return uid ? { grid, uid } : null;
}

/** Cases (remplies puis libres) d'une grille, dans l'ordre. */
export const cellsOf = (grid: Element): HTMLElement[] => [...grid.querySelectorAll<HTMLElement>(":scope > .block-grid-cell[data-cell-index]")];

/** Rang de la case (0 = première). */
export const cellIndex = (cell: Element): number => Number((cell as HTMLElement).dataset.cellIndex ?? -1);
