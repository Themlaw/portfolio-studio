/**
 * Modèle unique d'une grille (lot 31d), pour la grille d'une page ET celle d'une planche de projet : mêmes
 * réglages, même rendu (`GridBlock`), mêmes opérations sur la toile (`applyGridOp`). Module pur (serveur,
 * éditeur, toile, tests Node).
 *
 * Un agencement est un motif de cases répété ligne après ligne (« 1+2 » = une grande puis deux petites…).
 * Les images remplissent les cases dans l'ordre ; changer d'agencement ne retire rien.
 *
 * - Agencements prédéfinis : « 1 », « 1+2 », « 2 », « 3 », « 2x2 », « 4 », « 2+1 » (v0.13) ; « portrait-left »
 *   et « portrait-right » (une grande case sur deux rangées d'un côté, deux cases empilées de l'autre ; la case 1
 *   est toujours le portrait).
 * - « Sur mesure » (`custom`) : 2 à 4 colonnes ; chaque case a sa largeur (1 à `cols` colonnes) et sa hauteur
 *   (1 ou 2 rangées), `spans[i]` pour l'image n° i. Rendu en CSS grid (`grid-column` / `grid-row: span`), flux
 *   `dense` : aucun trou, même si une case haute précède une case large (l'ordre de lecture est alors celui des
 *   numéros affichés sur la toile, pas forcément celui de l'écran).
 * - Choisir un agencement prédéfini puis le modifier (changer la taille d'une case) passe en « Sur mesure » en
 *   gardant exactement la même disposition (`toCustom`) ; `mirror` inverse gauche et droite.
 */
export const GRID_LAYOUTS = ["1", "1+2", "2", "3", "2x2", "4", "2+1", "portrait-left", "portrait-right", "custom"] as const;
export type GridLayout = (typeof GRID_LAYOUTS)[number];

/** Taille d'une case : colonnes occupées (1 à `cols`) et rangées (1 ou 2). */
export type Span = { w: number; h: number };

export const CUSTOM_COLS = [2, 3, 4] as const;
export const DEFAULT_CUSTOM_COLS = 3;
export const MAX_SPAN_W = 4;
export const MAX_SPAN_H = 2;
/** Cases au plus dans une grille (page ou planche). */
export const MAX_GRID_CELLS = 24;

type Preset = { cols: number; mirror?: boolean; cells: Span[] };
const one: Span = { w: 1, h: 1 };
/** Motif de chaque agencement prédéfini (colonnes de l'écran large ≥ 768 px, cases du motif dans l'ordre). */
const PRESETS: Record<Exclude<GridLayout, "custom">, Preset> = {
  "1": { cols: 1, cells: [one] },
  "1+2": { cols: 2, cells: [{ w: 2, h: 1 }, one, one] },
  "2": { cols: 2, cells: [one, one] },
  "3": { cols: 3, cells: [one, one, one] },
  "2x2": { cols: 2, cells: [one, one, one, one] },
  "4": { cols: 4, cells: [one, one, one, one] },
  "2+1": { cols: 2, cells: [one, one, { w: 2, h: 1 }] },
  "portrait-left": { cols: 2, cells: [{ w: 1, h: 2 }, one, one] },
  "portrait-right": { cols: 2, mirror: true, cells: [{ w: 1, h: 2 }, one, one] },
};

/** Cellules d'un motif (places libres de la toile). */
export const GRID_PATTERN: Record<GridLayout, number> = { "1": 1, "1+2": 3, "2": 2, "3": 3, "2x2": 4, "4": 4, "2+1": 3, "portrait-left": 3, "portrait-right": 3, custom: 1 };

/** Libellés simples (menu des agencements, info-bulles). */
export const GRID_LAYOUT_LABELS: Record<GridLayout, string> = {
  "1": "1 grand",
  "1+2": "1 grand + 2 petits dessous",
  "2": "2 côte à côte",
  "3": "3 côte à côte",
  "2x2": "4 petits (2 × 2)",
  "4": "4 en ligne",
  "2+1": "2 petits + 1 grand",
  "portrait-left": "Portrait à gauche + 2 à droite",
  "portrait-right": "Portrait à droite + 2 à gauche",
  custom: "Sur mesure",
};

/** Ce qui, dans les réglages d'une grille, décrit la disposition des cases. */
export type GridShape = { layout?: string; cols?: number; spans?: Span[]; mirror?: boolean };

export const isGridLayout = (v: unknown): v is GridLayout => typeof v === "string" && (GRID_LAYOUTS as readonly string[]).includes(v);

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(n)));

/** Colonnes d'une grille « Sur mesure » (2 à 4). */
export const customCols = (shape: GridShape): number => clamp(shape.cols ?? DEFAULT_CUSTOM_COLS, 2, 4);

/** Disposition effective : colonnes, inversion gauche / droite, et taille de chacune des `count` premières cases. */
export function gridCells(shape: GridShape, count: number): { cols: number; mirror: boolean; cells: Span[] } {
  const layout = isGridLayout(shape.layout) ? shape.layout : "2";
  if (layout === "custom") {
    const cols = customCols(shape);
    const cells = Array.from({ length: count }, (_, i) => {
      const s = shape.spans?.[i];
      return { w: clamp(s?.w ?? 1, 1, cols), h: clamp(s?.h ?? 1, 1, MAX_SPAN_H) };
    });
    return { cols, mirror: Boolean(shape.mirror), cells };
  }
  const p = PRESETS[layout];
  return { cols: p.cols, mirror: Boolean(p.mirror), cells: Array.from({ length: count }, (_, i) => p.cells[i % p.cells.length]) };
}

/** Cases libres montrées sur la toile après les `count` images (jamais en public) : leur taille, dans l'ordre. */
export function freeCells(shape: GridShape, count: number): Span[] {
  if (count >= MAX_GRID_CELLS) return [];
  const layout = isGridLayout(shape.layout) ? shape.layout : "2";
  if (layout === "custom") return [{ w: 1, h: 1 }];
  const p = PRESETS[layout];
  const free = count === 0 ? p.cells.length : (p.cells.length - (count % p.cells.length)) % p.cells.length;
  return Array.from({ length: free }, (_, i) => p.cells[(count + i) % p.cells.length]);
}

/** Les mêmes réglages en « Sur mesure », pour `count` images : la disposition ne change pas (rien n'est perdu). */
export function toCustom(shape: GridShape, count: number): Required<Pick<GridShape, "cols" | "mirror">> & { spans: Span[]; layout: "custom" } {
  const g = gridCells(shape, count);
  const layout = isGridLayout(shape.layout) ? shape.layout : "2";
  // Les motifs d'une seule colonne (« 1 ») deviennent deux colonnes, chaque case sur toute la largeur.
  if (layout === "1") return { layout: "custom", cols: 2, mirror: false, spans: g.cells.map(() => ({ w: 2, h: 1 })) };
  if (layout === "custom") return { layout: "custom", cols: g.cols, mirror: g.mirror, spans: g.cells };
  return { layout: "custom", cols: g.cols, mirror: g.mirror, spans: g.cells.map((c) => ({ ...c })) };
}

/**
 * Colonnes occupées par la cellule n° `index` (0 = première) sur écran large
 * (≥ 768 px) : sert à estimer la largeur affichée d'une image de cellule
 * (attribut `sizes`). Sur mobile, une colonne (deux pour « 2x2 » et « 4 »).
 */
export function cellShare(layout: GridLayout | GridShape, index: number, count = index + 1): number {
  const shape: GridShape = typeof layout === "string" ? { layout } : layout;
  const g = gridCells(shape, Math.max(count, index + 1));
  const l = isGridLayout(shape.layout) ? shape.layout : "2";
  if (l === "custom") return g.cols / Math.max(1, g.cells[index].w);
  switch (l) {
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
      return 2; // « 2 », « 2x2 », portraits
  }
}

/**
 * Position de chaque case (colonne et rangée de départ, base 0) : le même placement que le rendu CSS (flux `dense`,
 * première place libre). Sert aux vignettes d'agencement et aux tests ; `mirror` inverse gauche et droite.
 */
export function placeCells(cols: number, cells: Span[], mirror = false): { col: number; row: number; w: number; h: number }[] {
  const taken: boolean[][] = [];
  const free = (r: number, c: number, w: number, h: number) => {
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) if (taken[y]?.[x]) return false;
    return true;
  };
  return cells.map((cell) => {
    const w = Math.min(cell.w, cols);
    for (let r = 0; ; r++) {
      for (let c = 0; c + w <= cols; c++) {
        if (!free(r, c, w, cell.h)) continue;
        for (let y = r; y < r + cell.h; y++) for (let x = c; x < c + w; x++) (taken[y] ??= [])[x] = true;
        return { col: mirror ? cols - c - w : c, row: r, w, h: cell.h };
      }
    }
  });
}

/* ---- Opérations de la toile et du panneau -------------------------------------------------------------- */

export type GridChild = { uid: string; type: string; props: Record<string, unknown> };
type Props = Record<string, unknown>;

export type GridModelOp =
  /** Réglages de la grille. Un changement de colonnes ou d'inversion passe en « Sur mesure ». */
  | { op: "set"; layout?: GridLayout; gap?: string; ratio?: string; align?: string; cols?: number; mirror?: boolean }
  | { op: "remove"; index: number }
  | { op: "swap"; a: number; b: number }
  /** `to` : rang final de la case. */
  | { op: "move"; from: number; to: number }
  /** Largeur / hauteur relative (« Plus large » = dw +1…) ; passe en « Sur mesure ». */
  | { op: "span"; index: number; dw?: number; dh?: number }
  /** « Adapter aux images » : `ratios[i]` = largeur / hauteur de l'image n° i. */
  | { op: "adapt"; ratios: number[] }
  /** Image posée dans la case n° `index` (au-delà de la dernière : ajoutée à la suite) ; remplace le média, garde le reste. */
  | { op: "put"; index: number; child: GridChild };

const kids = (p: Props): GridChild[] => (Array.isArray(p.children) ? (p.children as GridChild[]) : []);
const spansOf = (p: Props, n: number): Span[] => {
  const raw = Array.isArray(p.spans) ? (p.spans as Span[]) : [];
  return Array.from({ length: n }, (_, i) => ({ w: clamp(raw[i]?.w ?? 1, 1, MAX_SPAN_W), h: clamp(raw[i]?.h ?? 1, 1, MAX_SPAN_H) }));
};

/** Taille de case voulue d'après le format de l'image (largeur / hauteur) : portrait sur 2 rangées, panorama sur 2 colonnes. */
export function adaptSpan(ratio: number, cols: number): Span {
  if (!Number.isFinite(ratio) || ratio <= 0) return { w: 1, h: 1 };
  if (ratio < 0.85) return { w: 1, h: 2 };
  if (ratio > 3) return { w: cols, h: 1 };
  if (ratio > 1.9) return { w: Math.min(2, cols), h: 1 };
  return { w: 1, h: 1 };
}

/**
 * Applique une opération aux réglages d'une grille (`children` compris) : nouveaux réglages, ou un message en
 * français. Les tailles de cases (`spans`) suivent toujours l'ordre des images, même sous un agencement prédéfini
 * (revenir à « Sur mesure » les retrouve).
 */
export function applyGridOp(props: Props, op: GridModelOp): { props: Props } | { error: string } {
  const list = kids(props);
  const n = list.length;
  const hasSpans = Array.isArray(props.spans);
  const sp = (): Span[] => spansOf(props, n);
  const withOrder = (order: number[]): Props => ({
    ...props,
    children: order.map((i) => list[i]),
    ...(hasSpans ? { spans: order.map((i) => sp()[i]) } : {}),
  });
  switch (op.op) {
    case "set": {
      const { op: _o, layout, cols, mirror, ...rest } = op;
      void _o;
      let next: Props = { ...props };
      for (const [k, v] of Object.entries(rest)) if (v !== undefined) next[k] = v;
      const current = isGridLayout(props.layout) ? props.layout : "2";
      if (layout !== undefined && layout !== current) {
        if (layout === "custom") next = { ...next, ...toCustom(props as GridShape, n) };
        else next.layout = layout;
      }
      if (cols !== undefined || mirror !== undefined) {
        // Régler les colonnes ou l'inversion n'a de sens qu'en « Sur mesure » : on y passe sans rien changer à la disposition.
        if (next.layout !== "custom") next = { ...next, ...toCustom(next as GridShape, n) };
        if (cols !== undefined) {
          const c = clamp(cols, 2, 4);
          next.cols = c;
          next.spans = spansOf(next, n).map((s) => ({ ...s, w: Math.min(s.w, c) }));
        }
        if (mirror !== undefined) {
          if (mirror) next.mirror = true;
          else delete next.mirror;
        }
      }
      return { props: next };
    }
    case "remove": {
      if (op.index < 0 || op.index >= n) return { error: "Cette case n'existe plus." };
      return { props: withOrder(Array.from({ length: n }, (_, i) => i).filter((i) => i !== op.index)) };
    }
    case "swap": {
      if (op.a < 0 || op.b < 0 || op.a >= n || op.b >= n) return { error: "Cette case n'existe plus." };
      const order = Array.from({ length: n }, (_, i) => i);
      [order[op.a], order[op.b]] = [order[op.b], order[op.a]];
      return { props: withOrder(order) };
    }
    case "move": {
      if (op.from < 0 || op.from >= n || op.to < 0 || op.to >= n) return { error: "Cette case n'existe plus." };
      const order = Array.from({ length: n }, (_, i) => i);
      const [x] = order.splice(op.from, 1);
      order.splice(op.to, 0, x);
      return { props: withOrder(order) };
    }
    case "span": {
      if (op.index < 0 || op.index >= n) return { error: "Cette case n'existe plus." };
      const base = props.layout === "custom" ? { ...props } : { ...props, ...toCustom(props as GridShape, n) };
      const cols = customCols(base as GridShape);
      const spans = spansOf(base, n);
      const s = spans[op.index];
      spans[op.index] = { w: clamp(s.w + (op.dw ?? 0), 1, cols), h: clamp(s.h + (op.dh ?? 0), 1, MAX_SPAN_H) };
      return { props: { ...base, layout: "custom", cols, spans } };
    }
    case "adapt": {
      if (n === 0) return { error: "Ajoute d'abord des images." };
      const cols = props.layout === "custom" ? customCols(props as GridShape) : DEFAULT_CUSTOM_COLS;
      const spans = Array.from({ length: n }, (_, i) => adaptSpan(op.ratios[i] ?? 1.5, cols));
      const next: Props = { ...props, layout: "custom", cols, spans };
      if (props.layout !== "custom") delete next.mirror;
      return { props: next };
    }
    case "put": {
      if (op.index < 0 || op.index > n) return { error: "Cette case n'existe plus." };
      if (op.index === n) {
        if (n >= MAX_GRID_CELLS) return { error: `${MAX_GRID_CELLS} cases au plus par grille.` };
        return { props: { ...props, children: [...list, op.child], ...(hasSpans ? { spans: [...sp(), { w: 1, h: 1 }] } : {}) } };
      }
      const old = list[op.index];
      // Même sorte de média : le média change, le reste (légende, cadre, recadrage…) est gardé ; sinon la case est refaite.
      // Le recadrage (`look.crop`) était celui de l'ancienne image : il n'est pas repris.
      const keep = (): GridChild => {
        const { look, ...rest } = old.props;
        const { crop: _c, ...restLook } = (look ?? {}) as Props;
        void _c;
        return { ...old, props: { ...rest, mediaId: op.child.props.mediaId, ...(Object.keys(restLook).length ? { look: restLook } : {}) } };
      };
      const merged: GridChild = old.type === op.child.type ? keep() : op.child;
      return { props: { ...props, children: list.map((c, i) => (i === op.index ? merged : c)) } };
    }
  }
}
