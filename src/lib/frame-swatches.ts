/**
 * Pastilles de couleur du cadre « Bordure » (lot 95) : lesquelles montrer. Module pur (aucun import), lu par le menu Cadre et par les tests.
 *
 * Une pastille n'est utile que si elle donne un cadre qu'on VOIT et qui diffère des autres :
 *  - doublon : deux jetons qui valent la même couleur dans le thème (le texte et « Couleur par défaut », « Texte d'étiquette » qui retombe sur
 *    « Détails » en auto…) : on ne garde que la première, dans l'ordre d'affichage ;
 *  - confondue avec le fond de la page (« Fond de page », souvent « Cartes et champs ») : le cadre disparaîtrait contre le papier.
 * Rien n'est perdu : la valeur enregistrée d'un cadre n'est jamais touchée ni masquée (une pastille masquée comme doublon est remplacée par sa
 * jumelle, qui s'affiche cochée ; une pastille confondue avec le fond reste affichée tant qu'elle est le choix enregistré).
 */

export type Rgb = { r: number; g: number; b: number };

/** Contraste minimal d'un cadre avec le fond de la page : dessous, la bande ne se distingue pas du papier. */
export const FRAME_MIN_CONTRAST = 1.3;
/** Écart maximal par canal (sur 255) entre deux jetons que l'œil ne distingue pas : même pastille. */
export const FRAME_TWIN_TOLERANCE = 6;

const lin = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = ({ r, g, b }: Rgb) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const close = (a: Rgb, b: Rgb) => Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b)) <= FRAME_TWIN_TOLERANCE;

export type SwatchPlan<K extends string> = {
  /** Pastilles à afficher, dans l'ordre d'affichage. */
  shown: K[];
  /** Pastille masquée comme doublon → celle qui la remplace (« default » : « Couleur par défaut »). */
  twin: Partial<Record<K, K | "default">>;
  /** Pastilles masquées parce que confondues avec le fond de la page. */
  blended: K[];
};

/**
 * @param order   ordre d'affichage des jetons
 * @param colors  couleur calculée de chaque jeton (absent : illisible, la pastille est gardée)
 * @param def     couleur de « Couleur par défaut » (toujours affichée, première)
 * @param page    couleur du fond de la page (absent : rien n'est masqué pour cette raison)
 * @param stored  jeton enregistré dans le cadre (jamais masqué comme « confondu avec le fond »)
 */
export function planFrameSwatches<K extends string>(order: readonly K[], colors: Partial<Record<K, Rgb>>, def: Rgb | undefined, page: Rgb | undefined, stored?: string): SwatchPlan<K> {
  const kept: { key: K | "default"; rgb: Rgb }[] = def ? [{ key: "default", rgb: def }] : [];
  const plan: SwatchPlan<K> = { shown: [], twin: {}, blended: [] };
  for (const key of order) {
    const rgb = colors[key];
    if (!rgb) {
      plan.shown.push(key);
      continue;
    }
    const twin = kept.find((k) => close(k.rgb, rgb));
    if (twin) {
      plan.twin[key] = twin.key;
      continue;
    }
    if (page && contrastRatio(rgb, page) < FRAME_MIN_CONTRAST && key !== stored) {
      plan.blended.push(key);
      continue;
    }
    kept.push({ key, rgb });
    plan.shown.push(key);
  }
  return plan;
}
