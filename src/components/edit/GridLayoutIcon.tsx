import { GRID_LAYOUT_LABELS, gridCells, placeCells, type GridShape } from "@/blocks/grid-layouts";

/**
 * Pictogramme d'un agencement de grille (panneau de l'éditeur et barre de la toile) : cases dessinées en currentColor,
 * aucune couleur propre. La vignette est calculée par le modèle (`placeCells`) : elle montre exactement la disposition
 * du rendu, y compris le portrait à gauche / à droite et l'exemple « Sur mesure ».
 */
export const LAYOUT_LABELS: Record<string, string> = GRID_LAYOUT_LABELS;

const W = 32;
const H = 22;
const PAD = 2;
const GAP = 1.6;

/** Cases d'un agencement : un motif entier pour un agencement prédéfini, un exemple parlant pour « Sur mesure ». */
function sample(shape: GridShape): { cols: number; mirror: boolean; cells: { w: number; h: number }[] } {
  // « Automatique » : un panorama sur toute la largeur, un portrait sur deux rangées, deux cases normales.
  if (shape.layout === "auto") return { cols: 2, mirror: false, cells: [{ w: 2, h: 1 }, { w: 1, h: 2 }, { w: 1, h: 1 }, { w: 1, h: 1 }] };
  if (shape.layout === "custom" && !shape.spans) return { cols: 3, mirror: false, cells: [{ w: 1, h: 2 }, { w: 2, h: 1 }, { w: 1, h: 1 }, { w: 1, h: 1 }] };
  const count = shape.layout === "custom" ? Math.max(1, shape.spans?.length ?? 1) : ({ "1": 1, "1+2": 3, "2": 2, "3": 3, "2x2": 4, "4": 4, "2+1": 3, "portrait-left": 3, "portrait-right": 3 } as Record<string, number>)[shape.layout ?? "2"] ?? 2;
  const g = gridCells(shape, count);
  return g;
}

export default function GridLayoutIcon({ layout, shape }: { layout?: string; shape?: GridShape }) {
  const base: GridShape = shape ?? { layout: layout ?? "2" };
  const s = sample(base.layout === "custom" ? base : { ...base, layout: base.layout ?? "2" });
  const cells = s.cells;
  const placed = placeCells(s.cols, cells, s.mirror);
  const rows = Math.max(1, ...placed.map((p) => p.row + p.h));
  const cw = (W - 2 * PAD - GAP * (s.cols - 1)) / s.cols;
  const ch = (H - 2 * PAD - GAP * (rows - 1)) / rows;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true" focusable="false">
      {placed.map((p, i) => (
        <rect key={i} x={PAD + p.col * (cw + GAP)} y={PAD + p.row * (ch + GAP)} width={p.w * cw + (p.w - 1) * GAP} height={p.h * ch + (p.h - 1) * GAP} rx="1.5" fill="currentColor" />
      ))}
    </svg>
  );
}


