/**
 * Pictogramme d'un agencement de grille (panneau de l'éditeur et barre de la
 * toile) : cellules dessinées en currentColor, aucune couleur propre.
 */
export const LAYOUT_LABELS: Record<string, string> = {
  "1": "1 grand",
  "1+2": "1 grand + 2 petits dessous",
  "2": "2 côte à côte",
  "3": "3 côte à côte",
  "2x2": "4 petits (2 × 2)",
  "4": "4 en ligne",
  "2+1": "2 petits + 1 grand",
};

const CELLS: Record<string, [number, number, number, number][]> = {
  "1": [[2, 2, 28, 18]],
  "1+2": [
    [2, 2, 28, 10],
    [2, 14, 13, 6],
    [17, 14, 13, 6],
  ],
  "2": [
    [2, 2, 13, 18],
    [17, 2, 13, 18],
  ],
  "3": [
    [2, 2, 8, 18],
    [12, 2, 8, 18],
    [22, 2, 8, 18],
  ],
  "2x2": [
    [2, 2, 13, 8],
    [17, 2, 13, 8],
    [2, 12, 13, 8],
    [17, 12, 13, 8],
  ],
  "4": [
    [2, 2, 5.5, 18],
    [9.5, 2, 5.5, 18],
    [17, 2, 5.5, 18],
    [24.5, 2, 5.5, 18],
  ],
  "2+1": [
    [2, 2, 13, 6],
    [17, 2, 13, 6],
    [2, 10, 28, 10],
  ],
};

export default function GridLayoutIcon({ layout }: { layout: string }) {
  return (
    <svg width="32" height="22" viewBox="0 0 32 22" aria-hidden="true" focusable="false">
      {(CELLS[layout] ?? CELLS["2"]).map(([x, y, w, h], i) => (
        <rect key={i} x={x} y={y} width={w} height={h} rx="1.5" fill="currentColor" />
      ))}
    </svg>
  );
}
