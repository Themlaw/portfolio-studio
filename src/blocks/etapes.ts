/**
 * Bloc « Étapes » (lot 131, type `steps`) : trois lectures d'une même suite d'images.
 *  - comparer (`compare`) : deux images recadrées pareil, un curseur les sépare (avant / après) ;
 *  - étapes (`steps`) : onglets, frise ou défilement, une légende par étape (croquis, valeurs, couleur, final) ;
 *  - tourner (`turn`) : glisser ou flèches pour passer d'une vue à l'autre (turnaround), jamais d'auto-rotation.
 * Module pur (aucun import) : lu par le schéma, le rendu, la vue cliente, l'éditeur et les tests Node.
 */

export const STEPS_MODES = ["compare", "steps", "turn"] as const;
export type StepsMode = (typeof STEPS_MODES)[number];
export const STEPS_VIEWS = ["tabs", "strip", "scroll"] as const;
export type StepsView = (typeof STEPS_VIEWS)[number];

/** Images au plus (une étape = une image). */
export const MAX_STEPS = 8;

export const STEPS_MODE_LABELS: Record<StepsMode, string> = { compare: "Avant / après", steps: "Étapes (making-of)", turn: "Tourner (turnaround)" };
export const STEPS_MODE_HINTS: Record<StepsMode, string> = {
  compare: "Deux images recadrées pareil, séparées par un curseur : le visiteur le glisse (ou le règle au clavier).",
  steps: "Une suite d'images avec une légende par étape (croquis, valeurs, couleur, final).",
  turn: "Plusieurs vues d'un même sujet : on les fait défiler en glissant ou avec les flèches. Rien ne tourne tout seul.",
};
export const STEPS_VIEW_LABELS: Record<StepsView, string> = { tabs: "Onglets : une étape à la fois", strip: "Frise : toutes les étapes côte à côte", scroll: "Défilement : les unes sous les autres" };

const obj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

export function stepsMode(props: unknown): StepsMode {
  const m = obj(props) ? props.mode : undefined;
  return (STEPS_MODES as readonly unknown[]).includes(m) ? (m as StepsMode) : "compare";
}
export function stepsView(props: unknown): StepsView {
  const v = obj(props) ? props.view : undefined;
  return (STEPS_VIEWS as readonly unknown[]).includes(v) ? (v as StepsView) : "tabs";
}
/** Position de départ du curseur (0 à 100, 50 par défaut). */
export function compareStart(props: unknown): number {
  const s = obj(props) ? props.start : undefined;
  return typeof s === "number" && Number.isFinite(s) ? Math.max(0, Math.min(100, s)) : 50;
}

export type StepItem = { media: number; label?: { fr: string; en: string }; caption?: { fr: string; en: string } };

/** Étapes lisibles, dans l'ordre : sans média ignorées, 8 au plus, deux seulement pour « comparer ». */
export function stepsItems(props: unknown): StepItem[] {
  const raw = obj(props) && Array.isArray(props.items) ? props.items : [];
  const list = raw.filter((x): x is StepItem => obj(x) && Number.isInteger(x.media) && (x.media as number) > 0).slice(0, MAX_STEPS);
  return stepsMode(props) === "compare" ? list.slice(0, 2) : list;
}

/** Position (0 à 100) du pointeur sur la scène ; 50 si la scène n'a pas de largeur. */
export function comparePos(clientX: number, rect: { left: number; width: number }): number {
  if (!(rect.width > 0)) return 50;
  return Math.round(Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)));
}

const mod = (n: number, m: number) => ((n % m) + m) % m;

/**
 * Vue atteinte en glissant (turnaround) : `dx` pixels vers la droite sur une scène de `width` pixels ;
 * glisser d'une largeur fait défiler `perWidth` vues, vers la gauche = vue suivante. En boucle.
 */
export function turnIndex(start: number, dx: number, width: number, count: number, perWidth: number): number {
  if (count <= 0) return 0;
  if (!(width > 0)) return mod(start, count);
  return mod(start + Math.round((-dx / width) * perWidth), count);
}

/** Touche → index (flèches, Début, Fin) ; `loop` : passe de la dernière à la première. Null : touche ignorée. */
export function keyIndex(key: string, index: number, count: number, loop: boolean): number | null {
  if (count <= 0) return null;
  const last = count - 1;
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return index >= last ? (loop ? 0 : last) : index + 1;
    case "ArrowLeft":
    case "ArrowUp":
      return index <= 0 ? (loop ? last : 0) : index - 1;
    case "Home":
      return 0;
    case "End":
      return last;
    default:
      return null;
  }
}

/** Condition de publication (en plus du schéma) : message, ou null. */
export function stepsProblem(props: Record<string, unknown>): string | null {
  const raw = Array.isArray(props.items) ? props.items : [];
  if (raw.some((x) => !obj(x) || !Number.isInteger(x.media))) return "Une étape n'a pas encore d'image : choisis-la, ou retire l'étape.";
  const mode = stepsMode(props);
  const n = raw.length;
  if (mode === "compare") return n === 2 ? null : "Choisis les deux images à comparer (avant et après).";
  if (n < 2) return mode === "turn" ? "Ajoute au moins deux vues à faire tourner." : "Ajoute au moins deux étapes.";
  return null;
}
